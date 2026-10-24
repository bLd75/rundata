/**
 * What is on in La Réunion: fêtes, concerts, marchés, festivals, municipal events. No one publishes the whole island,
 * so the agendas that can be read are put together:
 * - Saint-Paul, Le Port and Les Trois-Bassins run The Events Calendar on WordPress, whose REST API gives each event
 *   with its hours, place and price;
 * - the CINOR (Saint-Denis, Sainte-Marie, Sainte-Suzanne) and the tourist office of the North publish on OpenAgenda;
 * - the agenda of reunion.fr, the island's tourist board, lists the big fêtes and festivals: its page carries the
 *   list as data (`itemsData`), dates and commune included;
 * - Le Tampon, Saint-Louis and Saint-André publish an RSS feed of their agenda whose dates are in the text (« Du 5 au
 *   10 octobre 2026 », « 19 et 20 désanm »);
 * - the concert halls and theatres publish their programme on their own site (src/providers/salles.ts), Le Séchoir
 *   (Saint-Leu) with The Events Calendar.
 * Nineteen requests in all, each source cached on its own: one that fails leaves the others answering.
 */
import type { Cache, Cached } from "../cache.js";
import { getText } from "../http.js";
import { INSEE } from "../places/insee.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import type { SourceInfo } from "../types.js";
import { communesIn, strip } from "./avis-eau.js";
import { monthOf, statusOf, type Statut } from "./agenda-mots.js";
import { SALLES, SOURCE as SALLES_SOURCE, TIMEOUT_MS } from "./salles.js";

export { communesIn, monthOf, statusOf, type Statut };

export const SOURCES = {
  mairies: {
    id: "agenda_mairies",
    nom: "Agendas des mairies de Saint-Paul, du Port, des Trois-Bassins, du Tampon et de Saint-Louis",
    organisme: "Communes de La Réunion",
    licence: "Information publique (agendas municipaux)",
    attribution: "Villes de Saint-Paul, Le Port, Les Trois-Bassins, Le Tampon et Saint-Louis",
    url: "https://www.mairie-saintpaul.re/evenements/",
  },
  openagenda: {
    id: "openagenda",
    nom: "OpenAgenda : agendas de la CINOR et de l'Office de tourisme intercommunal du Nord",
    organisme: "CINOR, Office de Tourisme Intercommunal du Nord de La Réunion",
    licence: "Licence Ouverte Etalab 2.0",
    attribution: "CINOR, Office de Tourisme Intercommunal du Nord de La Réunion, via OpenAgenda",
    url: "https://openagenda.com/cinor-territoire-du-nord-de-la-reunion",
  },
  reunionfr: {
    id: "reunion_fr",
    nom: "Agenda de reunion.fr, site officiel du tourisme de La Réunion",
    organisme: "Île de La Réunion Tourisme",
    licence: "Information publique (agenda touristique)",
    attribution: "Île de La Réunion Tourisme, reunion.fr",
    url: "https://www.reunion.fr/organisez/actualites-de-l-ile/agenda/",
  },
} satisfies Record<string, SourceInfo>;

// The sites are asked who is reading: some answer an unnamed robot with an error page.
const HEADERS = { "User-Agent": "rundata.re (contact@rundata.re)" };
const FRESH_SECONDS = 3600;
const AHEAD_DAYS = 45;
const TEXT_MAX = 300;

/** One occurrence, in local time: « 2026-10-24T14:00 », or « 2026-10-24 » when the source gives no hour. */
export interface Seance {
  debut: string;
  fin?: string;
}

export interface Evenement {
  /** To recognise the same event published twice. */
  id: string;
  titre: string;
  seances: Seance[];
  lieu?: string;
  commune?: string;
  lon?: number;
  lat?: number;
  prix?: string;
  categories: string[];
  description?: string;
  lien: string;
  /** Who publishes it: « Mairie de Saint-Paul », « reunion.fr ». */
  publie_par: string;
  /** When the source says so; « reporté » keeps the dates the source gives (the new ones, when it has them). */
  statut?: Statut;
  /** Where to book, when it is not the event's own page. */
  billetterie?: string;
}

export interface Agenda {
  id: string;
  nom: string;
  source: SourceInfo;
  /** The commune of a mairie's agenda, for an event that names no other. */
  commune?: string;
  load: (cache: Cache, now: Date) => Promise<Cached<Evenement[]>>;
}

const localDay = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
/** Any ISO time with its offset → La Réunion's: « 2026-10-28T09:00:00+04:00 » → « 2026-10-28T09:00 ». */
export const toLocal = (iso: string) => new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 16);
const short = (s: string) => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 1).replace(/\s+\S*$/, "")}…` : s);
// NFKC: the posts copied from social networks write in « mathematical » letters (𝗩𝗔𝗖𝗔𝗡𝗖𝗘𝗦, 𝟮𝟰 𝗼𝗰𝘁𝗼𝗯𝗿𝗲).
const clean = (html: string) => strip(html).normalize("NFKC").replace(/\s+/g, " ").trim();

const BARE = new Map(Object.keys(INSEE).map((n) => [normalize(n).replace(/^(le|la|les|l) /, ""), n]));
/** The commune a field names: « TROIS BASSINS », « St Paul », « 97400 Saint-Denis ». */
export function communeOf(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const bare = normalize(text).replace(/\bst\b/g, "saint").replace(/\bste\b/g, "sainte").replace(/^(le|la|les|l) /, "");
  return BARE.get(bare) ?? communesIn(text)[0];
}

// ---------------------------------------------------------------- The Events Calendar (WordPress)

interface TribeEvent {
  id: number;
  title: string;
  description: string;
  url: string;
  all_day: boolean;
  start_date: string;
  end_date: string;
  cost: string;
  categories: { name: string }[];
  venue: { venue?: string; address?: string; city?: string } | unknown[];
}

/**
 * The hours as the mairie typed them. Saint-Paul's site is set to Paris time (« 08:00:00 », Europe/Paris, for its
 * « Matinées agricoles » at 8 h): its pages show 8h00, so the wall-clock hour is the one to keep, not the UTC one.
 */
const tribeTime = (s: string, allDay: boolean) => (allDay ? s.slice(0, 10) : s.slice(0, 16).replace(" ", "T"));

/** A venue's events away from home are titled after the place: « DKLO > TAN ROUGE ». */
function awayAt(title: string): string | undefined {
  const at = /(?:>|&gt;)\s*([^<>]+)$/.exec(title)?.[1];
  return at ? resolvePlace(at)?.lieu.commune : undefined;
}

export function parseTribe(body: { events: TribeEvent[] }, nom: string, commune: string, home?: string): Evenement[] {
  // A venue's school performances (« Scolaires ») are not open to the public.
  return body.events.filter((e) => !e.categories.some((c) => /^scolaires?$/i.test(c.name.trim()))).map((e) => {
    const venue = Array.isArray(e.venue) ? {} : (e.venue as { venue?: string; address?: string; city?: string });
    const debut = tribeTime(e.start_date, e.all_day);
    const fin = tribeTime(e.end_date, e.all_day);
    // Without the page builder's shortcodes some sites leave in the text (« [et_pb_section …] »), the last one often
    // cut short by the source.
    const description = clean(e.description).replace(/\[\/?[a-z][\w-]*(?:\s[^\]]*)?(?:\]|$)/g, " ").replace(/\s+/g, " ").trim();
    const statut = statusOf(clean(e.title), description);
    return {
      ...(statut ? { statut } : {}),
      id: `${nom}:${e.id}`,
      titre: clean(e.title),
      seances: [{ debut, fin: fin !== debut ? fin : undefined }],
      lieu: [venue.venue, venue.address].map((x) => x && clean(x)).filter(Boolean).join(", ") || home,
      commune: communeOf(venue.city) ?? awayAt(e.title) ?? commune,
      prix: clean(e.cost ?? "") || undefined,
      categories: e.categories.map((c) => clean(c.name)),
      description: description ? short(description) : undefined,
      lien: e.url,
      publie_par: nom,
    };
  });
}

function tribe(id: string, nom: string, site: string, commune: string, source: SourceInfo = SOURCES.mairies, home?: string): Agenda {
  return {
    id,
    nom,
    source,
    commune,
    load: (cache, now) =>
      cache.get(`agenda:${id}`, FRESH_SECONDS, async () => {
        const day = localDay(now);
        const url = `${site}/wp-json/tribe/events/v1/events?start_date=${day}&end_date=${addDays(day, AHEAD_DAYS)}&per_page=50`;
        return parseTribe(JSON.parse(await getText(source.id, url, TIMEOUT_MS, HEADERS)), nom, commune, home);
      }),
  };
}

// ---------------------------------------------------------------- OpenAgenda

interface OaEvent {
  uid: number;
  title: Record<string, string>;
  description?: Record<string, string>;
  conditions?: Record<string, string> | null;
  keywords?: Record<string, string[]> | null;
  timings: { begin: string; end: string }[];
  location?: { name?: string; address?: string; city?: string; latitude?: number; longitude?: number } | null;
  canonicalUrl: string;
  /** 1 scheduled, 2 rescheduled, 3 moved online, 4 postponed, 5 full, 6 cancelled. */
  status?: number;
}

const fr = (m: Record<string, string> | null | undefined) => (m ? m.fr ?? Object.values(m)[0] : undefined);
// The « conditions » field holds a price, a booking, or any other note: only the first two are a price.
const PRICE = /€|eur\b|gratuit|tarif|entr[ée]e|libre|inscri|r[ée]serv|payant/i;

const OA_STATUS: Record<number, Statut> = { 4: "reporté", 5: "complet", 6: "annulé" };

export function parseOpenAgenda(body: { events: OaEvent[] }, nom: string): Evenement[] {
  return body.events.map((e) => {
    const l = e.location ?? {};
    const statut = (e.status && OA_STATUS[e.status]) || statusOf(clean(fr(e.title) ?? ""));
    return {
      ...(statut ? { statut } : {}),
      id: `openagenda:${e.uid}`,
      titre: clean(fr(e.title) ?? ""),
      seances: e.timings.map((t) => ({ debut: toLocal(t.begin), fin: toLocal(t.end) })),
      lieu: [l.name, l.address].filter(Boolean).join(", ") || undefined,
      commune: communeOf(l.city) ?? communeOf(l.address),
      lon: l.longitude ?? undefined,
      lat: l.latitude ?? undefined,
      prix: PRICE.test(fr(e.conditions) ?? "") ? clean(fr(e.conditions)!) : undefined,
      categories: (e.keywords?.fr ?? []).slice(0, 5),
      description: fr(e.description) ? short(clean(fr(e.description)!)) : undefined,
      lien: e.canonicalUrl,
      publie_par: nom,
    };
  });
}

function openAgenda(id: string, nom: string, uid: number): Agenda {
  return {
    id,
    nom,
    source: SOURCES.openagenda,
    load: (cache) =>
      cache.get(`agenda:${id}`, FRESH_SECONDS, async () => {
        // The public export of the agenda's page, without a key (the v2 API needs one).
        const url = `https://openagenda.com/agendas/${uid}/events.v2.json?relative%5B%5D=current&relative%5B%5D=upcoming&size=100`;
        return parseOpenAgenda(JSON.parse(await getText(SOURCES.openagenda.id, url, TIMEOUT_MS, HEADERS)), nom);
      }),
  };
}

// ---------------------------------------------------------------- reunion.fr

interface IrtItem {
  sheetId: string;
  bordereau?: string;
  title: string;
  link: string;
  town?: string;
  gps?: { latitude?: string; longitude?: string } | null;
  dates?: { start?: { startDate?: string; startTime?: string | null }; end?: { endDate?: string } }[] | null;
  desc?: string | null;
}

/** The JSON array a page's script assigns to `name` (« var itemsData = [...]; »), read bracket by bracket. */
export function scriptArray(html: string, name: string): unknown[] | null {
  const at = html.indexOf(`var ${name} = [`);
  if (at < 0) return null;
  const from = html.indexOf("[", at);
  let depth = 0;
  let quoted = false;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quoted) {
      if (ch === "\\") i++;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      if (--depth === 0) return JSON.parse(html.slice(from, i + 1)) as unknown[];
    }
  }
  return null;
}

export function parseReunionFr(html: string): Evenement[] {
  const items = scriptArray(html, "itemsData");
  if (!items) throw new Error("agenda de reunion.fr : liste absente de la page");
  return (items as IrtItem[]).filter((it) => !it.bordereau || it.bordereau === "FMA").map((it) => {
    const time = (d?: string | null) => (d && /^\d\d:\d\d/.test(d) ? `T${d.slice(0, 5)}` : "");
    const seances = (it.dates ?? []).filter((d) => d.start?.startDate).map((d) => {
      const debut = toLocal(d.start!.startDate!).slice(0, 10);
      const fin = d.end?.endDate ? toLocal(d.end.endDate).slice(0, 10) : undefined;
      return { debut: debut + time(d.start!.startTime), fin: fin && fin !== debut ? fin : undefined };
    });
    const lat = Number(it.gps?.latitude);
    const lon = Number(it.gps?.longitude);
    return {
      id: `reunion.fr:${it.sheetId}`,
      titre: clean(it.title),
      seances,
      commune: communeOf(it.town),
      lon: Number.isFinite(lon) && lon ? lon : undefined,
      lat: Number.isFinite(lat) && lat ? lat : undefined,
      categories: [],
      description: it.desc ? short(clean(it.desc)) : undefined,
      lien: it.link,
      publie_par: "reunion.fr",
    };
  });
}

const reunionFr: Agenda = {
  id: "reunion_fr",
  nom: "reunion.fr",
  source: SOURCES.reunionfr,
  load: (cache) => cache.get("agenda:reunion_fr", FRESH_SECONDS, async () => parseReunionFr(await getText(SOURCES.reunionfr.id, SOURCES.reunionfr.url, TIMEOUT_MS, HEADERS))),
};

// ---------------------------------------------------------------- RSS with the dates in the text

const MONTH = "(janv(?:ier)?|janvi[eé]|f[eé]v(?:rier)?|f[eé]vri[eé]|mars|avr(?:il)?|mai|juin|zuin|juil(?:let)?|zuiy[eé]|ao[uû]t|sept(?:embre)?|sektanm|septanm|oct(?:obre)?|oktob|nov(?:embre)?|novanm|d[eé]c(?:embre)?|d[eé]sanm)\\.?";
const DAY = "(\\d{1,2})(?:er)?";
const WEEKDAY = "(?:(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\\s+)?";
const YEAR = "(?:\\s+(20\\d\\d))?";
// « du 5 au 10 octobre 2026 », « 2 au 22 décembre », « 14-15 novembre », « du 30 octobre au 2 novembre »
const RANGE = new RegExp(`${WEEKDAY}${DAY}(?:\\s+${MONTH}${YEAR})?\\s*(?:au|-|–)\\s*${WEEKDAY}${DAY}\\s+${MONTH}${YEAR}`, "iu");
// « les 5, 12, 19 et 26 octobre 2026 », « 19 et 20 désanm », « vendredi 18 et samedi 19 septembre »
const LIST = new RegExp(`${DAY}((?:\\s*,\\s*\\d{1,2})*)\\s+et\\s+${WEEKDAY}${DAY}\\s+${MONTH}${YEAR}`, "iu");
// « mercredi 28 octobre 2026 »
const SINGLE = new RegExp(`${WEEKDAY}${DAY}\\s+${MONTH}${YEAR}`, "iu");
// « Octobre 2026 »: the whole month
const MONTH_ONLY = new RegExp(`^${MONTH}\\s+(20\\d\\d)\\b`, "iu");
// « de 6h à 14h », « De 9h00 à 16h00 », « 18h-23h »
const HOURS = /\b(\d{1,2})\s?h\s?(\d\d)?\s*(?:à|a|-|–)\s*(\d{1,2})\s?h\s?(\d\d)?/iu;

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * The days a text announces, from its first date phrase. A date without its year is the next one after the item's
 * publication (an agenda announces what comes); the hours, when the text gives one span, apply to each day.
 */
export function datesIn(text: string, published: Date): Seance[] {
  const pub = localDay(published);
  const year = (m: number, d: number, y?: string) => {
    if (y) return Number(y);
    const py = Number(pub.slice(0, 4));
    // Published in late December about « 3 janvier »: next year. Two months of slack for a late post.
    return iso(py, m, d) < addDays(pub, -60) ? py + 1 : py;
  };
  const hits = [
    { re: RANGE, kind: "range" },
    { re: LIST, kind: "list" },
    { re: SINGLE, kind: "single" },
    { re: MONTH_ONLY, kind: "month" },
  ].map((p) => ({ ...p, m: p.re.exec(text) })).filter((p) => p.m) as { re: RegExp; kind: string; m: RegExpExecArray }[];
  if (!hits.length) return [];
  hits.sort((x, y) => x.m.index - y.m.index || y.m[0].length - x.m[0].length);
  const { kind, m } = hits[0];
  let days: Seance[] = [];
  if (kind === "range") {
    const m2 = monthOf(m[5].toLowerCase())!;
    const m1 = m[2] ? monthOf(m[2].toLowerCase())! : m2;
    const y2 = year(m2, Number(m[4]), m[6]);
    const y1 = m[3] ? Number(m[3]) : m1 > m2 ? y2 - 1 : y2;
    days = [{ debut: iso(y1, m1, Number(m[1])), fin: iso(y2, m2, Number(m[4])) }];
  } else if (kind === "list") {
    const mo = monthOf(m[4].toLowerCase())!;
    const nums = [m[1], ...(m[2].match(/\d{1,2}/g) ?? []), m[3]].map(Number);
    const y = year(mo, nums[0], m[5]);
    days = nums.map((d) => ({ debut: iso(y, mo, d) }));
  } else if (kind === "single") {
    const mo = monthOf(m[2].toLowerCase())!;
    days = [{ debut: iso(year(mo, Number(m[1]), m[3]), mo, Number(m[1])) }];
  } else {
    const mo = monthOf(m[1].toLowerCase())!;
    const y = Number(m[2]);
    days = [{ debut: iso(y, mo, 1), fin: iso(y, mo, lastDay(y, mo)) }];
  }
  if (days.some((d) => Number(d.debut.slice(8, 10)) > lastDay(Number(d.debut.slice(0, 4)), Number(d.debut.slice(5, 7))))) return [];
  const h = HOURS.exec(text.slice(m.index, m.index + 400));
  if (h && days.every((d) => !d.fin) && Number(h[1]) < 24 && Number(h[3]) < 24) {
    const hm = (hh: string, mm?: string) => `${hh.padStart(2, "0")}:${mm ?? "00"}`;
    days = days.map((d) => ({ debut: `${d.debut}T${hm(h[1], h[2])}`, fin: `${d.debut}T${hm(h[3], h[4])}` }));
  }
  return days;
}

const tag = (item: string, t: string) => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(item)?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() ?? "";

export function parseRss(xml: string, nom: string, commune: string): Evenement[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const titre = clean(tag(item, "title"));
    // WordPress closes each excerpt with « L'article X est apparu en premier sur Le Tampon. »
    const texte = clean(tag(item, "description")).replace(/\s*\[…\]\s*L.article .*$/u, " […]").trim();
    const published = new Date(tag(item, "pubDate"));
    const seances = datesIn(titre, published).length ? datesIn(`${titre} ${texte}`, published) : datesIn(texte, published);
    if (!seances.length) return [];
    const lien = clean(tag(item, "link"));
    const statut = statusOf(titre, texte);
    return [{
      ...(statut ? { statut } : {}),
      id: lien,
      titre: titre.replace(new RegExp(`^${DAY}[^:]{0,40}:\\s*`, "u"), ""),
      seances,
      commune,
      categories: [],
      description: short(texte),
      lien,
      publie_par: nom,
    }];
  });
}

function rss(id: string, nom: string, url: string, commune: string): Agenda {
  return {
    id,
    nom,
    source: SOURCES.mairies,
    commune,
    load: (cache) => cache.get(`agenda:${id}`, FRESH_SECONDS, async () => parseRss(await getText(SOURCES.mairies.id, url, TIMEOUT_MS, HEADERS), nom, commune)),
  };
}

export const AGENDAS: Agenda[] = [
  tribe("saint_paul", "Mairie de Saint-Paul", "https://www.mairie-saintpaul.re", "Saint-Paul"),
  tribe("le_port", "Ville du Port", "https://www.ville-port.re", "Le Port"),
  tribe("trois_bassins", "Mairie des Trois-Bassins", "https://trois-bassins.re", "Les Trois-Bassins"),
  rss("le_tampon", "Ville du Tampon", "https://letampon.fr/agenda/feed/", "Le Tampon"),
  rss("saint_louis", "Ville de Saint-Louis", "https://saintlouis.re/agenda/evenements?format=feed&type=rss", "Saint-Louis"),
  rss("saint_andre", "Ville de Saint-André", "https://www.saint-andre.re/category/agenda/feed/", "Saint-André"),
  tribe("sechoir", "Le Séchoir", "https://www.lesechoir.com", "Saint-Leu", SALLES_SOURCE, "Le Séchoir"),
  openAgenda("cinor", "CINOR", 50316469),
  openAgenda("oti_nord", "Office de tourisme du Nord", 32570974),
  reunionFr,
  ...SALLES,
];

/**
 * The communes whose own agenda is read (the CINOR's for the North), or that have a hall whose programme is, besides
 * reunion.fr for the whole island.
 */
export const COVERED = ["Saint-Paul", "Le Port", "Les Trois-Bassins", "Le Tampon", "Saint-Louis", "Saint-André", "Saint-Denis", "Sainte-Marie", "Sainte-Suzanne", "Saint-Leu", "Saint-Benoît"];
