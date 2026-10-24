/**
 * Sport in La Réunion: what is on, the latest results, the standings. No source gathers it, so one per federation or
 * event, each read only where its robots.txt allows it and without a key:
 *
 * - Grand Raid (October): Livetrail, the timing platform the organiser links to; per race the counts (starters,
 *   finishers, retirements, still racing) and the published podiums. Nothing nominative beyond the podiums.
 * - Handball: the regional D1, men and women, from the FFHB's competition pages (the matches of the next and of the
 *   last round, the standings).
 * - Volleyball: every pool of the league (R1 and R2, men and women), from the FFVB's results pages (every match of the
 *   season, the sets). Cancellations are not there: see sport-avis.ts.
 * - Sailing: the regattas of the league from the FFVoile's API (calendar, results published or not).
 * - Golf: the club competitions of the three courses from ffgolf's search.
 * - Motor sport: the calendar of the Ligue du sport automobile de La Réunion (rallies, karting, acceleration).
 * - The sport news of Réunion La 1ère (titles and links only): the only open source on football, whose results the
 *   FFF does not let be read.
 *
 * Several publish local hours with a Paris offset (« 20:30+01:00 » for a match at 20:30 in La Réunion): the clock time
 * is kept, the offset dropped.
 */
import type { Cache, Cached } from "../cache.js";
import { getBytes, getJson, getText } from "../http.js";
import type { SourceInfo } from "../types.js";
import { textOf } from "./avis-eau.js";

export const SOURCES = {
  livetrail: {
    id: "livetrail",
    nom: "Grand Raid de La Réunion : suivi et classements (Livetrail)",
    organisme: "Association Grand Raid ; Livetrail (chronométrage)",
    licence: "Information publique (résultats publiés par l'organisateur)",
    attribution: "Grand Raid de La Réunion, Livetrail",
    url: "https://grandraid-reunion.v3.livetrail.net/",
  },
  ffhb: {
    id: "ffhb",
    nom: "Handball : championnats régionaux de la Ligue de La Réunion (FFHB)",
    organisme: "Fédération française de handball",
    licence: "Information publique (résultats officiels)",
    attribution: "FFHB, Ligue réunionnaise de handball",
    url: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/regional/o-ligue-de-la-reunion-31/",
  },
  ffvb: {
    id: "ffvb",
    nom: "Volley-ball : championnats régionaux de la Ligue de La Réunion (FFVB)",
    organisme: "Fédération française de volley",
    licence: "Information publique (résultats officiels)",
    attribution: "FFVB, Ligue réunionnaise de volley-ball",
    url: "https://www.ffvbbeach.org/ffvbapp/resu/vbspo_calendrier.php?saison=2026/2027&codent=LIRE",
  },
  lrvb: {
    id: "lrvb",
    nom: "Volley-ball : avis de la Ligue réunionnaise (annulations, reports)",
    organisme: "Ligue réunionnaise de volley-ball (LRVB)",
    licence: "Information publique (avis officiels de la Ligue, cités avec leur lien)",
    attribution: "LRVB",
    url: "https://lrvb.re/",
  },
  ffvoile: {
    id: "ffvoile",
    nom: "Voile : régates de la Ligue de La Réunion (FFVoile)",
    organisme: "Fédération française de voile",
    licence: "Information publique (calendrier officiel)",
    attribution: "FFVoile, Ligue réunionnaise de voile",
    url: "https://regates.ffvoile.fr/",
  },
  ffgolf: {
    id: "ffgolf",
    nom: "Golf : compétitions des clubs de La Réunion (ffgolf)",
    organisme: "Fédération française de golf",
    licence: "Information publique (calendrier officiel)",
    attribution: "ffgolf, Ligue de golf de La Réunion",
    url: "https://www.ffgolf.org/",
  },
  lsar: {
    id: "lsar",
    nom: "Sport automobile : calendrier de la Ligue du sport automobile de La Réunion",
    organisme: "Ligue du sport automobile de La Réunion (LSAR)",
    licence: "Information publique (calendrier officiel)",
    attribution: "LSAR",
    url: "https://lsar.re/calendrier2026/",
  },
  la1ere: {
    id: "la1ere_sport",
    nom: "Actualité sportive de Réunion La 1ère (titres et liens)",
    organisme: "France Télévisions, Réunion La 1ère",
    licence: "Titres et liens seulement ; articles sur le site de Réunion La 1ère",
    attribution: "Réunion La 1ère",
    url: "https://la1ere.franceinfo.fr/reunion/sport/",
  },
} satisfies Record<string, SourceInfo>;

const UA_JSON = { Accept: "application/json" };

/** « 2026-10-30T20:30:00+01:00 » (a local hour with a Paris offset) → « 2026-10-30T20:30 ». */
export const clock = (s: string) => s.slice(0, 16);

/**
 * A day of ffgolf, written as Paris midnight in UTC: it starts at « 2026-10-24T22:00:00Z » and ends at
 * « 2026-10-25T21:59:59Z » for the 25th. Half a day later than a start, or earlier than an end, is that day.
 */
export const parisDay = (iso: string, end = false) => new Date(new Date(iso).getTime() + (end ? -12 : 12) * 3600_000).toISOString().slice(0, 10);

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', "#039": "'", "#39": "'", nbsp: " ", rsquo: "’", ndash: "–", hellip: "…", apos: "'" };
/** The entities of a text whose tags are out, never a « < » or « > » that would make a tag again. */
const decode = (s: string) =>
  s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? (/^#\d+$/.test(e) && e !== "#60" && e !== "#62" ? String.fromCodePoint(Number(e.slice(1))) : m));
const clean = (html: string) => decode(textOf(html)).replace(/\s+/g, " ").trim();
/** A table cell of the FFVB: plain text, or a few tags around it. */
const cell = (html: string) => {
  const t = html.includes("<") ? textOf(html) : html;
  return (t.includes("&") ? decode(t) : t).replace(/\s+/g, " ").trim();
};

// ---------------------------------------------------------------- Grand Raid

export interface Coureur {
  rang: number;
  nom: string;
  pays?: string;
  /** « 22 h 54 min » for the winner, « + 57 min » behind for the others. */
  temps: string;
}

export interface Course {
  id: string;
  nom: string;
  distance_km: number;
  denivele_m: number;
  /** Local, « 2026-10-15T22:00 ». */
  depart: string;
  lieu_depart: string;
  statut: "à venir" | "en cours" | "terminée";
  inscrits?: number;
  partants?: number;
  arrives?: number;
  abandons?: number;
  en_course?: number;
  podium: Coureur[];
  podium_femmes: Coureur[];
}

export interface GrandRaid {
  edition: string;
  debut: string;
  fin: string;
  courses: Course[];
  lien: string;
}

interface RawSummary { raceId: string; fullname: string; distance: number; elevationGain: number; startDate: string; startPlace: string; status: string }
interface RawHead { rank: number; firstName: string; lastName: string; countryCode?: string; raceTime?: number; diffToFirst?: number }
interface RawLive { raceId: string; status: string; stats?: { registered?: number; starter?: number; finisher?: number; dnf?: number; onRace?: number }; headRanking?: { scratch?: RawHead[]; female?: RawHead[] } }
interface RawEvent { name: string; startDate: string; endDate: string }

const STATUS: Record<string, Course["statut"]> = { FINISHED: "terminée", RUNNING: "en cours", STARTED: "en cours", LIVE: "en cours" };

export function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

function runners(list: RawHead[] | undefined): Coureur[] {
  const winner = list?.find((r) => r.raceTime != null)?.raceTime;
  return (list ?? []).slice(0, 3).map((r) => ({
    rang: r.rank,
    nom: `${r.firstName} ${r.lastName}`.trim(),
    pays: r.countryCode || undefined,
    temps: r.raceTime != null ? duration(r.raceTime) : r.diffToFirst != null ? `+ ${duration(r.diffToFirst)}${winner != null ? ` (${duration(winner + r.diffToFirst)})` : ""}` : "",
  }));
}

export function parseGrandRaid(event: RawEvent, summaries: RawSummary[], lives: RawLive[]): GrandRaid {
  const live = new Map(lives.map((l) => [l.raceId, l]));
  return {
    edition: event.name,
    debut: event.startDate.slice(0, 10),
    fin: event.endDate.slice(0, 10),
    lien: SOURCES.livetrail.url,
    courses: summaries.map((s) => {
      const l = live.get(s.raceId);
      const st = l?.stats ?? {};
      return {
        id: s.raceId,
        nom: s.fullname,
        distance_km: Math.round(s.distance / 1000),
        denivele_m: s.elevationGain,
        depart: clock(s.startDate),
        lieu_depart: s.startPlace,
        statut: STATUS[l?.status ?? s.status] ?? "à venir",
        inscrits: st.registered,
        partants: st.starter || undefined,
        arrives: st.finisher || undefined,
        abandons: st.dnf || undefined,
        en_course: st.onRace || undefined,
        podium: runners(l?.headRanking?.scratch),
        podium_femmes: runners(l?.headRanking?.female),
      };
    }),
  };
}

const LIVETRAIL = "https://api.v3.livetrail.net/api/events";

/** The edition of the year, else the last one (the tenant of a year opens a few months before the race). */
export async function grandRaid(cache: Cache, now = new Date()): Promise<Cached<GrandRaid>> {
  return cache.get("sport:grandraid", 30 * 60, async () => {
    const year = now.getUTCFullYear();
    let lastErr: unknown;
    for (const y of [year, year - 1]) {
      const h = { ...UA_JSON, "X-Tenant": `grandraid-reunion_${y}` };
      try {
        const [event, summaries, lives] = await Promise.all(
          ["global-event", "races/summaries", "races/lives"].map((p) => getText(SOURCES.livetrail.id, `${LIVETRAIL}/${p}`, 12_000, h).then(JSON.parse)),
        );
        return parseGrandRaid(event as RawEvent, summaries as RawSummary[], lives as RawLive[]);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  });
}

// ---------------------------------------------------------------- matches (handball, volley)

export interface Match {
  /** Local, « 2026-10-30T20:30 » (or a date alone). */
  date: string;
  domicile: string;
  exterieur: string;
  /** « 31-27 », « 3-0 » once played. */
  score?: string;
  /** Volley: the sets, « 25:20, 25:22, 25:21 ». */
  detail?: string;
  salle?: string;
  /** Volley: the FFVB's pool code, « R2F ». */
  poule?: string;
}

export interface Rang {
  place: number;
  equipe: string;
  points: number;
  joues: number;
}

export interface Championnat {
  sport: "handball" | "volley";
  nom: string;
  matchs: Match[];
  classement: Rang[];
  lien: string;
}

/** The value of a smartfire component of the FFHB's pages (JSON, HTML-escaped in an attribute). */
function component(html: string, name: string): Record<string, unknown> | undefined {
  const m = new RegExp(`<smartfire-component name='${name}' attributes="([^"]*)"`).exec(html);
  if (!m) return undefined;
  return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")) as Record<string, unknown>;
}

const title = (s: string) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());

interface RawRencontre { date: string | null; equipe1Libelle: string; equipe2Libelle: string; equipe1Score: string | null; equipe2Score: string | null }
interface RawClassement { place: string; point: string; joue: string; equipe_libelle: string }

/** One page of an FFHB competition: the matches of the round shown, the standings, the rounds and the pool. */
export function parseHandball(html: string) {
  const list = component(html, "competitions---rencontre-list") as { selected_numero_journee?: string; poule?: { ext_pouleId: string; journees: string }; rencontres?: RawRencontre[] } | undefined;
  const ranking = component(html, "competitions---mini-classement-or-ads") as { classements?: RawClassement[] } | undefined;
  return {
    journee: Number(list?.selected_numero_journee ?? 0),
    poule: list?.poule?.ext_pouleId,
    matchs: (list?.rencontres ?? []).map((r): Match => ({
      date: r.date ? clock(r.date) : "",
      domicile: title(r.equipe1Libelle),
      exterieur: title(r.equipe2Libelle),
      score: r.equipe1Score != null && r.equipe2Score != null ? `${r.equipe1Score}-${r.equipe2Score}` : undefined,
    })),
    classement: (ranking?.classements ?? []).map((c): Rang => ({ place: Number(c.place), equipe: title(c.equipe_libelle), points: Number(c.point), joues: Number(c.joue) })),
  };
}

const HB_BASE = "https://www.ffhandball.fr/competitions/saison-2026-2027-22/regional";
export const HANDBALL = [
  { nom: "D1 masculine", slug: "d1-senior-masculin-2026-2027-32624" },
  { nom: "D1 féminine", slug: "d1-senior-feminin-2026-2027-32657" },
];

/** A competition: its page shows the next round; the round before gives the latest results. */
async function handballOne(c: (typeof HANDBALL)[number]): Promise<Championnat> {
  const url = `${HB_BASE}/${c.slug}/`;
  const next = parseHandball(await getText(SOURCES.ffhb.id, url, 15_000));
  const prev = next.journee > 1 && next.poule
    ? parseHandball(await getText(SOURCES.ffhb.id, `${HB_BASE}/${c.slug}/poule-${next.poule}/journee-${next.journee - 1}/`, 15_000))
    : undefined;
  return { sport: "handball", nom: c.nom, matchs: [...(prev?.matchs ?? []), ...next.matchs], classement: next.classement, lien: url };
}

const VB_BASE = "https://www.ffvbbeach.org/ffvbapp/resu/vbspo_calendrier.php?saison=2026/2027&codent=LIRE&poule=";
// Every pool the league publishes (its index page, vbspo_home.php): five pages a reading.
export const VOLLEY = [
  { nom: "R1 masculine", poule: "R1M" },
  { nom: "R1 féminine", poule: "R1F" },
  { nom: "R2 féminine", poule: "R2F" },
  { nom: "R2 masculine, poule A", poule: "2MA" },
  { nom: "R2 masculine, poule B", poule: "2MB" },
];
// A team that has no match that round.
const BYE = /^x+$/i;

/** A results page of the FFVB: one row per match (code, date, hour, teams, sets won, sets), then the standings. */
export function parseVolley(html: string, poule?: string): Pick<Championnat, "matchs" | "classement"> {
  const matchs: Match[] = [];
  const classement: Rang[] = [];
  for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    // Most rows are layout: only a match (« R2FA012 ») or a rank (« 1. ») is read further.
    const first = /^\s*<td[^>]*>\s*([^<]*?)\s*<\/td>/i.exec(row)?.[1];
    if (!first || !(/^[A-Z0-9]{3,}\d{3}$/.test(first) || /^\d+\.$/.test(first))) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => cell(c[1]));
    if (/^[A-Z0-9]{3,}\d{3}$/.test(cells[0] ?? "") && /^\d\d\/\d\d\/\d\d$/.test(cells[1] ?? "")) {
      if (BYE.test(cells[3]) || BYE.test(cells[5])) continue;
      const [d, m, y] = cells[1].split("/");
      const played = /^\d$/.test(cells[6] ?? "") && /^\d$/.test(cells[7] ?? "");
      matchs.push({
        date: `20${y}-${m}-${d}${/^\d\d:\d\d$/.test(cells[2]) ? `T${cells[2]}` : ""}`,
        domicile: cells[3],
        exterieur: cells[5],
        score: played ? `${cells[6]}-${cells[7]}` : undefined,
        detail: played && cells[8] ? cells[8] : undefined,
        salle: !played && cells[7] ? cells[7] : undefined,
        poule,
      });
    } else if (/^\d+\.$/.test(cells[0] ?? "") && cells[1] && /^\d+$/.test(cells[2] ?? "")) {
      classement.push({ place: parseInt(cells[0]), equipe: cells[1], points: Number(cells[2]), joues: Number(cells[3]) });
    }
  }
  return { matchs, classement };
}

async function volleyOne(c: (typeof VOLLEY)[number]): Promise<Championnat> {
  const url = VB_BASE + c.poule;
  // The FFVB's pages are in ISO-8859-1.
  const html = new TextDecoder("latin1").decode(await getBytes(SOURCES.ffvb.id, url, 15_000));
  return { sport: "volley", nom: c.nom, ...parseVolley(html, c.poule), lien: url };
}

export async function championnats(cache: Cache, which: "handball" | "volley"): Promise<Cached<Championnat[]>> {
  // Volley: an hour, for a match moved or called off at the last minute.
  return cache.get(`sport:${which}`, which === "volley" ? 3600 : 3 * 3600, async () => {
    const parts = await Promise.allSettled(which === "handball" ? HANDBALL.map(handballOne) : VOLLEY.map(volleyOne));
    if (parts.every((p) => p.status === "rejected")) throw (parts[0] as PromiseRejectedResult).reason;
    return parts.flatMap((p) => (p.status === "fulfilled" ? [p.value] : []));
  });
}

// ---------------------------------------------------------------- events (sailing, golf, motor sport)

export interface Epreuve {
  sport: "voile" | "golf" | "sport auto";
  nom: string;
  /** YYYY-MM-DD, local. */
  debut: string;
  fin: string;
  lieu?: string;
  commune?: string;
  detail?: string;
  /** Results published (sailing), or cancelled / postponed. */
  etat?: "résultats publiés" | "annulée" | "reportée";
  lien?: string;
}

interface RawRegate { competitionId: number; competitionNom: string; dateDebut: string; dateFin: string; club?: { nom: string }; bateaux?: { nom: string }[]; avecResultats: boolean; competitionAnnulee: boolean; competitionInvalidee: boolean }

// The clubs of the league, for where a regatta is sailed.
const SAILING_CLUBS: Record<string, string> = { ANSP: "Saint-Pierre", "CN Portois": "Le Port", "BN DE L'OUEST": "Saint-Paul", "CN SAINT PAUL": "Saint-Paul", "CN SAINT-PAUL": "Saint-Paul" };

export function parseRegates(raw: { data: RawRegate[] }): Epreuve[] {
  return raw.data
    .filter((r) => !r.competitionInvalidee)
    .map((r) => ({
      sport: "voile" as const,
      nom: r.competitionNom.replace(/\s+/g, " ").trim(),
      debut: r.dateDebut.slice(0, 10),
      fin: r.dateFin.slice(0, 10),
      lieu: r.club?.nom,
      commune: r.club ? SAILING_CLUBS[r.club.nom] : undefined,
      detail: [...new Set((r.bateaux ?? []).map((b) => title(b.nom)))].join(", ") || undefined,
      etat: r.competitionAnnulee ? ("annulée" as const) : r.avecResultats ? ("résultats publiés" as const) : undefined,
      lien: `https://regates.ffvoile.fr/competitions/${r.competitionId}/`,
    }));
}

export async function regates(cache: Cache, now = new Date()): Promise<Cached<Epreuve[]>> {
  return cache.get("sport:voile", 6 * 3600, async () => {
    const since = new Date(now.getTime() - 60 * 86400_000).toISOString().slice(0, 10);
    return parseRegates(await getJson<{ data: RawRegate[] }>(SOURCES.ffvoile.id, `https://regates.ffvoile.fr/api/competitions/?ligue=31&sortOrder=ASC&page=1&limit=50&dateDebutMin=${since}`, 12_000));
  });
}

interface RawGolf { nom: string; dateDebut: string; dateFin: string; golfLabel: string; nbTrous?: number; formeJeu?: string; formuleJeu?: string; lienResultatsFleole?: string | null; lienDeparts?: string | null }

const COURSES: Record<string, { nom: string; commune: string }> = {
  "GOLF DU BASSIN BLEU": { nom: "Golf du Bassin Bleu (Saint-Gilles-les-Hauts)", commune: "Saint-Paul" },
  "GOLF DE BOURBON": { nom: "Golf de Bourbon (L'Étang-Salé)", commune: "L'Étang-Salé" },
  "GOLF CLUB DU COLORADO": { nom: "Golf du Colorado (La Montagne)", commune: "Saint-Denis" },
};

export function parseGolf(raw: { documents: RawGolf[] }): Epreuve[] {
  return raw.documents.map((g) => ({
    sport: "golf" as const,
    nom: g.nom.replace(/\.$/, "").trim(),
    debut: parisDay(g.dateDebut),
    fin: parisDay(g.dateFin, true),
    lieu: COURSES[g.golfLabel]?.nom ?? title(g.golfLabel),
    commune: COURSES[g.golfLabel]?.commune,
    detail: [g.nbTrous ? `${g.nbTrous} trous` : "", g.formeJeu, g.formuleJeu].filter(Boolean).join(", ") || undefined,
    lien: g.lienResultatsFleole || g.lienDeparts || undefined,
  }));
}

export async function golf(cache: Cache, now = new Date()): Promise<Cached<Epreuve[]>> {
  return cache.get("sport:golf", 6 * 3600, async () => {
    const day = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
    const q = new URLSearchParams({ "search[leagues][]": "14", "search[date][date_from]": `${day} 00:00:00`, offset: "0", limit: "40" });
    const body = await getText(SOURCES.ffgolf.id, `https://www.ffgolf.org/search/club-tournament?${q}`, 12_000, { ...UA_JSON, "X-Requested-With": "XMLHttpRequest" });
    return parseGolf(JSON.parse(body) as { documents: RawGolf[] });
  });
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « 24/25/26 juillet 2026 », « 3 octobre 2026 », « 28 février/1er mars 2026 » → first and last day. */
export function frenchDays(text: string): { debut: string; fin: string } | undefined {
  const t = text.toLowerCase().replace(/1er/g, "1");
  const year = /(\d{4})/.exec(t)?.[1];
  if (!year) return undefined;
  const parts = [...t.replace(year, " ").matchAll(/(\d{1,2})(?=[\s/]|$)(?:\s+([a-zéû]+))?/g)].map((m) => ({ d: Number(m[1]), month: m[2] ? MONTHS.indexOf(m[2]) : -1 })).filter((p) => p.d <= 31);
  if (!parts.length) return undefined;
  // A day without its month takes the next one named.
  for (let i = parts.length - 1, next = -1; i >= 0; i--) {
    if (parts[i].month >= 0) next = parts[i].month;
    else parts[i].month = next;
  }
  if (parts.some((p) => p.month < 0)) return undefined;
  const iso = (p: { d: number; month: number }) => `${year}-${String(p.month + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  return { debut: iso(parts[0]), fin: iso(parts.at(-1)!) };
}

/** The calendar of the LSAR: a title per discipline, then four cells per event (date, event, area, organiser). */
export function parseLsar(html: string, link: string): Epreuve[] {
  const start = html.indexOf('id="tabcalweb"');
  const part = start >= 0 ? html.slice(start, html.indexOf("</div>", start)) : html;
  const out: Epreuve[] = [];
  let discipline = "";
  let row: string[] = [];
  for (const [, attrs, inner] of part.matchAll(/<p([^>]*)>([\s\S]*?)<\/p>/gi)) {
    if (/titre_bordure/.test(attrs)) {
      discipline = clean(inner);
      row = [];
      continue;
    }
    if (/titre_col/.test(attrs)) continue;
    row.push(inner);
    if (row.length < 4) continue;
    const [date, nom, secteur, organisateur] = row;
    row = [];
    const days = frenchDays(clean(date));
    if (!days) continue;
    const name = clean(nom);
    const etat = /<s>/i.test(date) || /annul/i.test(name) ? "annulée" : /report/i.test(name) ? "reportée" : undefined;
    out.push({
      sport: "sport auto",
      nom: name.replace(/\s*[-–]\s*(Annulé|Reporté)e?\s*$/i, ""),
      ...days,
      lieu: [clean(secteur), clean(organisateur)].filter((x) => x && x !== "-").join(", ") || undefined,
      detail: discipline.charAt(0) + discipline.slice(1).toLowerCase(),
      etat,
      lien: link,
    });
  }
  return out;
}

export async function sportAuto(cache: Cache): Promise<Cached<Epreuve[]>> {
  return cache.get("sport:auto", 24 * 3600, async () => {
    const page = await getJson<{ link: string; content: { rendered: string } }>(SOURCES.lsar.id, "https://lsar.re/wp-json/wp/v2/posts/15268?_fields=link,content", 12_000);
    return parseLsar(page.content.rendered, page.link);
  });
}

// ---------------------------------------------------------------- news

export interface Article {
  titre: string;
  lien: string;
  /** ISO. */
  publie: string;
  /** « football », « cyclisme »… when the newsroom files it so. */
  rubrique?: string;
}

const NOT_A_SPORT = /^(sport|monde|océan indien|afrique|outre-mer|la réunion|réunion|france)$/i;

export function parseNews(xml: string): Article[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const tag = (t: string) => clean((new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(item)?.[1] ?? "").replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1"));
    const cats = [...item.matchAll(/<category domain="https:\/\/la1ere\.franceinfo\.fr\/sport\/([^"]+)">([^<]*)<\/category>/g)].map((m) => clean(m[2]));
    return {
      titre: tag("title"),
      lien: tag("link"),
      publie: new Date(tag("pubDate")).toISOString(),
      rubrique: cats.find((c) => !NOT_A_SPORT.test(c))?.toLowerCase(),
    };
  });
}

export async function actualite(cache: Cache): Promise<Cached<Article[]>> {
  return cache.get("sport:actu", 30 * 60, async () => parseNews(await getText(SOURCES.la1ere.id, "https://la1ere.franceinfo.fr/reunion/sport/rss", 12_000)));
}
