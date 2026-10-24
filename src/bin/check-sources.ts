/**
 * The daily check of the sources, through rundata.re itself (scripts/check-sources.ts, run by
 * .github/workflows/sources.yml): a few tools called on /mcp and a few pages, each failing when what it shows is
 * older than its source should allow, says a source did not answer, or gives the volcano's ORSEC level as unknown.
 * Nothing here asks a source directly: what is checked is what a visitor gets.
 */
import { decodeText, textOf } from "../providers/avis-eau.js";

/** Who the check is, for the Worker: served like a crawler that waits for the data, and not counted in the usage. */
export const AGENT = "rundata-check/1 (+github actions)";

const HOUR = 3600_000;
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** The local (UTC+4) parts of `now`. */
const local = (now: Date) => {
  const d = new Date(now.getTime() + 4 * HOUR);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

/**
 * A time as the answers write it, in Réunion time unless it says otherwise: « 24/10 15:25 heure de La Réunion »,
 * « 24/10 20:36 », « 23/10/2026 à 21:49 », « 2026-10-22 » (that day at 0 h), or ISO with its zone. Without a year,
 * the one that does not put it more than a day ahead of `now`.
 */
export function parseTime(s: unknown, now: Date): Date | undefined {
  if (typeof s !== "string") return undefined;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? undefined : new Date(t);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(Date.parse(`${s}T00:00:00+04:00`));
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?:\s+(?:à\s+)?(\d{1,2})[:h](\d{2}))?/.exec(s.trim());
  if (!m) return undefined;
  const at = (y: number) => new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0)) - 4 * HOUR);
  if (m[3]) return at(Number(m[3]));
  const y = local(now).year;
  return at(y).getTime() > now.getTime() + 24 * HOUR ? at(y - 1) : at(y);
}

const ageHours = (t: Date, now: Date) => (now.getTime() - t.getTime()) / HOUR;
const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${String(Math.round(h * 10) / 10).replace(".", ",")} h`);

/** One problem with what was read: what, and why. */
export interface Probleme {
  point: string;
  motif: string;
}

/** A dated field no older than `max` hours: the problem if it is missing, unreadable or too old. */
function fresh(point: string, what: string, value: unknown, max: number, now: Date): Probleme[] {
  const t = parseTime(value, now);
  if (!t) return [{ point, motif: `${what} absente ou illisible` }];
  const age = ageHours(t, now);
  return age > max ? [{ point, motif: `${what} d'il y a ${hours(age)} (seuil ${hours(max)})` }] : [];
}

type Payload = Record<string, any>;

export interface ToolCheck {
  /** The point's name in the summary. */
  point: string;
  tool: string;
  args: Record<string, string>;
  /** The problems of the answer, beyond the ones every answer is checked for. */
  check: (p: Payload, now: Date) => Probleme[];
}

/** The newest of the dated fields `key` in a list (stations, tide gauges). */
const newest = (list: unknown, key: string, now: Date) =>
  (Array.isArray(list) ? list : [])
    .map((x) => parseTime(x?.[key], now))
    .filter((t): t is Date => !!t)
    .sort((a, b) => b.getTime() - a.getTime())[0]
    ?.toISOString();

const none = () => [];

export const TOOLS: ToolCheck[] = [
  {
    point: "volcan_seismes",
    tool: "volcan_seismes",
    args: {},
    check: (p, now) => {
      const point = "volcan_seismes";
      const e = p.etat ?? {};
      const niveau = typeof e.niveau_orsec === "string" ? e.niveau_orsec : "";
      const out: Probleme[] = [];
      if (!niveau || /vérifier|non lu/i.test(niveau)) out.push({ point, motif: `niveau ORSEC inconnu (« ${niveau || "absent"} »)` });
      else if (!/^vigilance/i.test(niveau) && !e.communique_prefecture) out.push({ point, motif: `niveau ${niveau} sans communiqué de la préfecture lu` });
      // pitonlive higher than the release (`ecart_prefecture`): the eruption is the release's word, not pitonlive's.
      if (/alerte 2/i.test(niveau) && !e.eruption_en_cours && !e.ecart_prefecture) out.push({ point, motif: "Alerte 2 sans éruption en cours dans l'état lu" });
      // The OVPF's newest post is an image nobody reads: after a day, someone must look at it.
      const first = Array.isArray(p.publications_ovpf) ? p.publications_ovpf[0] : undefined;
      const at = parseTime(first?.date, now);
      if (e.image_ovpf_plus_recente && at && ageHours(at, now) > 24) {
        out.push({ point, motif: `la publication la plus récente de l'OVPF est une image non lue depuis ${hours(ageHours(at, now))}` });
      }
      return out;
    },
  },
  { point: "vigilance_meteo", tool: "vigilance_meteo", args: {}, check: (p, now) => fresh("vigilance_meteo", "bulletin", p.emise, 18, now) },
  {
    point: "meteo_actuelle (Saint-Denis)",
    tool: "meteo_actuelle",
    args: { lieu: "Saint-Denis" },
    check: (p, now) => fresh("meteo_actuelle (Saint-Denis)", "mesure", newest(p.stations, "heure_mesure", now), 3, now),
  },
  {
    point: "prevision_meteo (Saint-Denis)",
    tool: "prevision_meteo",
    args: { lieu: "Saint-Denis" },
    check: (p, now) => fresh("prevision_meteo (Saint-Denis)", "run du modèle", p.modele?.run_du_modele, 24, now),
  },
  {
    point: "temperature_mer (Saint-Gilles)",
    tool: "temperature_mer",
    args: { lieu: "Saint-Gilles" },
    check: (p, now) => fresh("temperature_mer (Saint-Gilles)", "lecture", p.fraicheur?.lue_a, 48, now),
  },
  { point: "cyclones", tool: "cyclones", args: {}, check: none },
  {
    point: "qualite_air",
    tool: "qualite_air",
    args: {},
    check: (p, now) => [
      ...fresh("qualite_air", "lecture", p.fraicheur?.lue_a, 26, now),
      ...(/aujourd'hui/.test(String(p.resume ?? "")) ? [] : [{ point: "qualite_air", motif: "pas d'indice du jour" }]),
    ],
  },
  { point: "electricite", tool: "electricite", args: {}, check: (p, now) => fresh("electricite", "production", p.production?.heure, 3, now) },
  {
    point: "crues_rivieres",
    tool: "crues_rivieres",
    args: {},
    check: (p, now) => fresh("crues_rivieres", "mesure", newest(p.stations, "heure_mesure", now), 3, now),
  },
  {
    point: "maree (Saint-Pierre)",
    tool: "maree",
    args: { lieu: "Saint-Pierre" },
    check: (p, now) => fresh("maree (Saint-Pierre)", "mesure", newest(p.maregraphes, "heure_mesure", now), 3, now),
  },
  {
    point: "transports (gare de Saint-Denis)",
    tool: "transports",
    args: { arret: "Gare routière, Saint-Denis" },
    check: (p, now) => {
      // « … en temps réel par le réseau (flux de 07:02) … »: the feed's time, the day of the check.
      const flux = /flux de (\d{1,2}:\d{2})/.exec(String(p.horaires ?? ""))?.[1];
      if (!flux) return [{ point: "transports (gare de Saint-Denis)", motif: "pas de temps réel dans les départs" }];
      const l = local(now);
      return fresh("transports (gare de Saint-Denis)", "flux temps réel", `${l.day}/${l.month}/${l.year} ${flux}`, 0.5, now);
    },
  },
  { point: "actualites (routes)", tool: "actualites", args: { sujet: "routes" }, check: (p, now) => fresh("actualites (routes)", "lecture", p.fraicheur?.lue_a, 2, now) },
  {
    point: "carburants",
    tool: "annuaire_services_publics",
    args: { quoi: "carburants" },
    check: (p, now) => {
      // The order comes out by the last day of the month; from the 3rd, the month's must be read (carburants.yml).
      const l = local(now);
      if (l.day < 3) return [];
      const month = `${MONTHS[l.month - 1]} ${l.year}`;
      return String(p.en_vigueur_depuis ?? "").endsWith(month) ? [] : [{ point: "carburants", motif: `prix en vigueur depuis « ${p.en_vigueur_depuis ?? "?"} », pas ${month}` }];
    },
  },
  { point: "coupures_eau", tool: "coupures_eau", args: {}, check: none },
];

/** What every answer is checked for: an error, a last copy served for a source that did not answer. */
export function checkAnswer(c: ToolCheck, result: { isError?: boolean; content?: { type: string; text?: string }[] } | undefined, now: Date): Probleme[] {
  const text = result?.content?.[0]?.text ?? "";
  if (!result || result.isError) return [{ point: c.point, motif: `erreur de l'outil : ${text.slice(0, 160) || "réponse vide"}` }];
  let p: Payload;
  try {
    p = JSON.parse(text);
  } catch {
    return [{ point: c.point, motif: "réponse illisible" }];
  }
  const out: Probleme[] = [];
  if (p.fraicheur?.copie_de_secours) out.push({ point: c.point, motif: `copie de secours : ${p.fraicheur.avertissement ?? "source injoignable"}` });
  else if (p.fraicheur?.avertissement) out.push({ point: c.point, motif: String(p.fraicheur.avertissement) });
  return [...out, ...c.check(p, now)];
}

export interface PageCheck {
  path: string;
  /** How old the page's data may be (its JSON-LD dateModified), in hours. */
  max?: number;
  check?: (html: string, now: Date) => Probleme[];
}

export const PAGES: PageCheck[] = [
  { path: "/" },
  {
    path: "/volcan",
    max: 2,
    check: (html) => (/à vérifier sur/.test(html) ? [{ point: "/volcan", motif: "niveau ou accès à l'Enclos « à vérifier »" }] : []),
  },
  { path: "/vigilance", max: 2 },
  { path: "/meteo/saint-denis", max: 2 },
  { path: "/mer", max: 6 },
  {
    path: "/carburants",
    check: (html, now) => {
      const l = local(now);
      if (l.day < 3) return [];
      const month = `${MONTHS[l.month - 1]} ${l.year}`;
      return html.includes(`<h1>Prix des carburants à La Réunion, ${month}</h1>`) ? [] : [{ point: "/carburants", motif: `le titre ne dit pas ${month}` }];
    },
  },
  { path: "/trafic", max: 2 },
  { path: "/cyclones" },
];

// What a page says of a source that did not answer (web/pages.ts, web/domains.ts).
const DOWN = /ne répond(?:ent)? pas|Momentanément indisponible|indisponible pour le moment|Copie de secours/i;

/** A page: served with its live block, saying no source is down, its data fresh enough. */
export function checkPage(c: PageCheck, status: number, cacheControl: string, html: string, now: Date): Probleme[] {
  const point = c.path;
  if (status !== 200) return [{ point, motif: `HTTP ${status}` }];
  // A page without its live block is never kept (web/site.ts): « no-store ».
  if (/no-store/.test(cacheControl)) return [{ point, motif: "servie sans son bloc en direct" }];
  const out: Probleme[] = [];
  // The page's text, its tags dropped character by character (avis-eau.ts): a pattern over HTML misses some tags.
  const down = DOWN.exec(decodeText(textOf(html)));
  if (down) out.push({ point, motif: `dit « ${down[0]} »` });
  if (c.max) out.push(...fresh(point, "donnée", /"dateModified":"([^"]+)"/.exec(html)?.[1], c.max, now));
  return [...out, ...(c.check?.(html, now) ?? [])];
}
