/**
 * What is on in La Réunion: fêtes, concerts, marchés, festivals, municipal events. No one publishes the whole island,
 * so the agendas that can be read are put together:
 * - Saint-Paul, Le Port and Les Trois-Bassins run The Events Calendar on WordPress, whose REST API gives each event
 *   with its hours, place and price;
 * - the CINOR (Saint-Denis, Sainte-Marie, Sainte-Suzanne) and the tourist office of the North publish on OpenAgenda;
 * - the agenda of reunion.fr, the island's tourist board, lists the big fêtes and festivals: its page carries the
 *   list as data (`itemsData`), dates and commune included;
 * - Le Tampon, Saint-Louis, Saint-André and L'Étang-Salé publish an RSS feed of their agenda whose dates are in the
 *   text (« Du 5 au 10 octobre 2026 », « 19 et 20 désanm »);
 * - La Possession publishes its agenda (IntraMuros) as an RSS feed with each date as data;
 * - Petite-Île shows its agenda as a page, « Du 28 octobre au 31 octobre », « Le 14 octobre de 10h00 à 11h00 »;
 * - Bras-Panon (a page a month) and Saint-Benoît show theirs as pages too, and the tourist office of the East (OTI Est)
 *   lists the events of its six communes on one page;
 * - the concert halls and theatres publish their programme on their own site (src/providers/salles.ts), Le Séchoir
 *   (Saint-Leu) with The Events Calendar.
 * Each source cached on its own: one that fails leaves the others answering.
 *
 * The agendas of the mairies are public information (CRPA, art. L321-1): each event keeps its facts only, at most the
 * first sentence of its text, the name of who published it, a link to its page and the hour it was read. Each says it
 * comes from its commune's site, with that hour (art. L322-1, `site_commune`). Where the site's terms ask for an
 * authorisation, not even the sentence (`faits`) until it is given; where they allow a link to the home page only, a
 * link there (`accueil`). Each source is one line of AGENDAS: taking it out stops its reading, its events, its credit
 * and its coverage at once.
 */
import type { Bundle, Cache, Cached } from "../cache.js";
import { getBytes, getText, httpUrl } from "../http.js";
import { INSEE } from "../places/insee.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import type { SourceInfo } from "../types.js";
import { communesIn, strip } from "./avis-eau.js";
import { annonceEvenement, extrait, lead, monthOf, statusOf, type Statut } from "./agenda-mots.js";
import { SALLES, SOURCE as SALLES_SOURCE, TIMEOUT_MS, tokens } from "./salles.js";
import { SOURCES as SPORT_SOURCES } from "./sport.js";
import { PROPOSITIONS } from "./agenda-propositions.js";
import { autorisee } from "./autorisations.js";

export { communesIn, lead, monthOf, statusOf, type Statut };

export const SOURCES = {
  mairies: {
    id: "agenda_mairies",
    // Named after the mairies read, once AGENDAS is known.
    nom: "Agendas des mairies",
    organisme: "Communes de La Réunion",
    licence: "Information publique (agendas municipaux)",
    attribution: "Villes",
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

/** A commune's agenda as its own source: credited only while its line is in AGENDAS. */
function mairie(id: string, nom: string, url: string, licence = "Information publique (agenda municipal)"): SourceInfo {
  return { id: `agenda_${id}`, nom: `Agenda de la ${nom}`, organisme: nom, licence, attribution: nom, url };
}

/**
 * The clause of Saint-Louis's, Saint-Leu's and La Plaine-des-Palmistes's legal notices (read on 25/10/2026): their
 * information may be reproduced « à des fins d'information et en aucune manière à des fins commerciales ». Saint-Louis
 * and La Plaine-des-Palmistes add « ne pas modifier »: their titles, days and places are kept as they write them.
 */
const REPRISE_INFORMATION = "Reprise autorisée à des fins d'information, sans usage commercial (mentions légales du site)";

/**
 * The licence of a commune's site that writes no condition of reuse (Sainte-Marie, Salazie, as read on 25/10/2026):
 * never said to allow it, only that it writes nothing (marketing, 25/10).
 */
const SANS_CONDITION = "\u00a0; aucune condition de reprise écrite sur le site";

// The sites are asked who is reading: some answer an unnamed robot with an error page.
const HEADERS = { "User-Agent": "rundata.re (contact@rundata.re)" };
const FRESH_SECONDS = 3600;
const AHEAD_DAYS = 45;
/** What the tourist office of the East's terms ask to show with what is taken from it. */
export const OTI_EST = "OTI EST REUNION — Droits réservés";

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
  /**
   * The genres the rest of its text named, beyond its first sentence (« concert » in a programme's third line): for the
   * search only, never shown nor returned. Only the first sentence of a source's text is kept (extrait()).
   */
  themes?: string[];
  /** The children's ages its text gives, in its words (« de 6 mois à 6 ans », « dès 10 ans »): never guessed. */
  age?: string;
  lien: string;
  /** Who publishes it: « Mairie de Saint-Paul », « reunion.fr ». */
  publie_par: string;
  /** When the source says so; « reporté » keeps the dates the source gives (the new ones, when it has them). */
  statut?: Statut;
  /** When the state comes from the news, not from the organiser (src/providers/agenda-presse.ts): who said it. */
  selon?: { media: string; lien: string; publie: string };
  /** The new day the news gives a postponed event, « 2026-12-05 ». */
  reporte_au?: string;
  /** Where to book, when it is not the event's own page. */
  billetterie?: string;
  /** When rundata.re read it, in local time: set by the tool from the agenda's copy, not by the source. */
  lu_le?: string;
  /** « site de la commune du Tampon », when it comes from a commune's site: set by the tool from its agenda. */
  site_commune?: string;
  /**
   * The club that publishes it, and the commune of its address (Sportsregions): for the sport tool, never said as the
   * event's place.
   */
  organisateur?: { nom: string; commune?: string; sport?: string; site?: string };
  /** A session for the club's members (« Jeu libre », a weekly outing): told only to who says they are one. */
  reserve_adherents?: boolean;
  /** Who organises it, as the site's own agenda names them (The Events Calendar): never the town hall that publishes it. */
  organise_par?: string[];
  /**
   * The event's own picture, only from OpenAgenda under the Licence Ouverte 2.0, with its author (the picture's credits,
   * else the agenda that licenses it): for the search engines' box (JSON-LD), never shown on the page.
   */
  image?: { url: string; auteur: string };
  /**
   * Proposed by its organiser on rundata.re (src/providers/agenda-propositions.ts): the day it was, and the contact its
   * author chose to show, if any. Never « checked ».
   */
  propose?: { le: string; contact?: string };
}

/**
 * A commune's sports programme (« Agenda sportif du 22 au 24 octobre », « Planning des compétitions sportives du 23 au
 * 25 octobre 2026 »): the matches of all its clubs in one document, not an event. Read with its agenda, it is told by
 * the sport tool, not by evenements (tools/sport.ts); a sports event with its own title (a rally, a match) stays.
 */
export const PROGRAMME_SPORTIF = /^(?:(?:le|la|l['’])\s*)?(?:agenda|planning|programme|calendrier)s?\s+(?:sporti(?:f|ve)s?|des\s+(?:comp[ée]titions|manifestations|rencontres|matchs)\s+sportives?)(?![\p{L}])/iu;
export const programmeSportif = (e: Pick<Evenement, "titre">) => PROGRAMME_SPORTIF.test(e.titre);

/**
 * Where an agenda keeps its copy: its entry in the bundle of all the agendas (tools/agenda.ts), one read and one write
 * per invocation whatever their number. A `Cache` will do too.
 */
export type AgendaStore = Pick<Bundle, "get">;

// Every agenda's copy in one entry of the cache: one read and at most one write per invocation, whatever their number
// (a read and a write each would take two subrequests per agenda). An isolate looks for another's copies once a minute.
// The data center's cache: those of the agendas read by the questions.
export const BUNDLE = "agendas";
export const BUNDLE_SYNC_SECONDS = 60;
// Those of the agendas read by the scheduled event (`planifie`), in KV, written by it only: it runs in any data center,
// and the questions are answered in all of them (in the data center's cache, its copies were seen only where it ran).
export const PLANIFIES = "agendas:planifies";

/** The copies of the agendas read by the scheduled event: one read of KV per isolate and per minute at most. */
export const planifiees = (cache: Pick<Cache, "bundle">) => cache.bundle(PLANIFIES, BUNDLE_SYNC_SECONDS, true);

/** How long the copy of an agenda read by the scheduled event is served: past it, a tournament may have been called off. */
export const PLANIFIE_MAX_AGE_SECONDS = 48 * 3600;

/** The copy of an agenda read by the scheduled event, if young enough to be served, with the time it was read. */
export function copiePlanifiee(bundle: Pick<Bundle, "peek">, agenda: Agenda): Cached<Evenement[]> | undefined {
  const hit = bundle.peek(`agenda:${agenda.id}`);
  return hit && hit.ageMs <= PLANIFIE_MAX_AGE_SECONDS * 1000 ? { value: servis(agenda, hit.value as Evenement[]), fetchedAt: new Date(hit.fetchedAt), stale: false } : undefined;
}

/** Beside its copy, when the last reading of an agenda read by the scheduled event failed (tools/agenda.ts). */
export const echecPlanifie = (agenda: Agenda) => `echec:${agenda.id}`;

/**
 * Why the copy of an agenda read by the scheduled event is not served, to be said rather than nothing (La Réunion's
 * times): its last good reading, when older than PLANIFIE_MAX_AGE_SECONDS; without a copy, its last reading that
 * failed (`essai`), or none yet (just put online). Undefined when it is served.
 */
export function nonServie(bundle: Pick<Bundle, "peek">, agenda: Agenda): { depuis: string } | { essai?: string } | undefined {
  const local = (t: number) => toLocal(new Date(t).toISOString());
  const hit = bundle.peek(`agenda:${agenda.id}`);
  if (hit) return hit.ageMs <= PLANIFIE_MAX_AGE_SECONDS * 1000 ? undefined : { depuis: local(hit.fetchedAt) };
  const failed = bundle.peek(echecPlanifie(agenda));
  return failed ? { essai: local(failed.fetchedAt) } : {};
}

/**
 * An agenda's events as they may be shown, from its copy whatever its age: without their sentence (`faits`), linking to
 * the home page (`accueil`). Applied where a copy is served, not where it is read, so that a copy read before its
 * site's terms were known is served as they ask too.
 */
export function servis(agenda: Agenda, events: Evenement[]): Evenement[] {
  if (!agenda.faits && !agenda.accueil) return events;
  return events.map((e) => {
    const out = { ...e };
    if (agenda.faits) delete out.description;
    if (agenda.accueil) out.lien = agenda.accueil;
    return out;
  });
}

export interface Agenda {
  id: string;
  nom: string;
  source: SourceInfo;
  /** The commune of a mairie's agenda, for an event that names no other. */
  commune?: string;
  /** The communes whose agenda this is, when not only `commune` (an intercommunality's): what COVERED is made of. */
  couvre?: string[];
  /** The fetches one reading makes, when more than one: an invocation reads the agendas its subrequests allow. */
  requetes?: number;
  /**
   * Read by the scheduled event only (tools/agenda.ts, `refreshPlanned`), never by a question, its copy kept in KV
   * (PLANIFIES): a question serves it while it is younger than PLANIFIE_MAX_AGE_SECONDS, else goes without it.
   */
  planifie?: boolean;
  /** What is read of the commune when it is not an agenda (a mairie's news): said in the answer for that commune. */
  partiel?: string;
  /** For an agenda read by the scheduled event: the seconds between two readings, when not an hour. */
  relecture?: number;
  /**
   * Published by clubs or associations (a league, the clubs' sites, the proposed events), not by a town hall nor a
   * hall: what the counter of /associations counts (web/associations.ts).
   */
  club?: boolean;
  /**
   * Read on its commune's own site: « site de la commune du Tampon », each of its events saying so with the hour it was
   * read, and anything the site's terms ask to show with it (Le Port's « © www.ville-port.re »).
   */
  site_commune?: string;
  /** Its site's terms ask for an authorisation to reproduce it: its events keep their facts, without their sentence. */
  faits?: boolean;
  /** Its site's terms allow a link to its home page only: this page, for each of its events. */
  accueil?: string;
  /** It publishes its clubs' sports programmes (`programmeSportif`), which the tool sport links to: said when not read. */
  programmes?: true;
  /** One `cache.get("agenda:<id>", …)`, nothing else of the cache. */
  load: (cache: AgendaStore, now: Date) => Promise<Cached<Evenement[]>>;
}

const localDay = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
/** Any ISO time with its offset → La Réunion's: « 2026-10-28T09:00:00+04:00 » → « 2026-10-28T09:00 ». */
export const toLocal = (iso: string) => new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 16);
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
  organizer?: { organizer?: string }[] | unknown;
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

/** The organisers the site names, each once; nothing when it names none. */
function organisers(o: TribeEvent["organizer"]): { organise_par?: string[] } {
  const names = Array.isArray(o) ? [...new Set(o.map((x) => clean((x as { organizer?: string })?.organizer ?? "")).filter(Boolean))] : [];
  return names.length ? { organise_par: names } : {};
}

export function parseTribe(body: { events: TribeEvent[] }, nom: string, commune: string | undefined, home?: string): Evenement[] {
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
      ...organisers(e.organizer),
      categories: e.categories.map((c) => clean(c.name)),
      ...extrait(description),
      lien: e.url,
      publie_par: nom,
    };
  });
}

function tribe(id: string, nom: string, site: string, commune: string | undefined, source: SourceInfo = SOURCES.mairies, home?: string): Agenda {
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
  image?: { base?: string; filename?: string } | null;
  imageCredits?: string | null;
  rights?: { license?: { id?: string }; licensor?: { name?: string } } | null;
}

/** The event's picture when its rights are the Licence Ouverte 2.0, with its credits or else its licensor as author. */
function oaImage(e: OaEvent): { image?: { url: string; auteur: string } } {
  const url = e.image?.base && e.image.filename ? httpUrl(`${e.image.base}${e.image.filename}`) : undefined;
  const auteur = clean(e.imageCredits ?? "") || clean(e.rights?.licensor?.name ?? "");
  return url && auteur && e.rights?.license?.id === "etalab-2.0" ? { image: { url, auteur } } : {};
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
      ...extrait(clean(fr(e.description) ?? "")),
      lien: e.canonicalUrl,
      publie_par: nom,
      ...oaImage(e),
    };
  });
}

function openAgenda(id: string, nom: string, uid: number, couvre: string[]): Agenda {
  return {
    id,
    nom,
    source: SOURCES.openagenda,
    couvre,
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
  if (!items) {
    // The page as it is, its list empty (« var itemsData = ""; », a total of 0): the site publishes none, not a list we
    // no longer find. Said apart in the logs, with the hour the site gave its page (« Generated at », its own clock).
    const vide = /var itemsData = "";/.test(html);
    const genere = html.match(/<!-- Generated at ([0-9-]+ [0-9:]+) -->/)?.[1];
    throw new Error(vide ? `agenda de reunion.fr : liste vide publiée (page générée le ${genere ?? "?"})` : "agenda de reunion.fr : liste absente de la page");
  }
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
      ...extrait(clean(it.desc ?? "")),
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

const STAMP = /^\d{1,2}\s\p{L}+\s20\d\d\s\d\d:\d\d\s*/u;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const tag = (item: string, t: string) => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(item)?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() ?? "";

export function parseRss(xml: string, nom: string, commune: string, first = false): Evenement[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const titre = clean(tag(item, "title"));
    // WordPress closes each excerpt with « L'article X est apparu en premier sur Le Tampon. »
    const full = clean(tag(item, "description")).replace(/\s*\[…\]\s*L.article .*$/u, " […]").trim();
    // A commune's own feed: without what comes before its text, the hour of its posting (iCagenda, « 24 Octobre 2026
    // 09:20 »), a label (« EVENEMENT », Drupal's « Texte de l'article ») or the title again.
    const texte = first ? full.replace(STAMP, "").replace(/^(?:[ÉE]V[ÉE]NEMENT\s+)?/iu, "").replace(new RegExp(`^${escapeRe(titre)}\\s*(?:Texte de l'article\\s*)?`, "u"), "") : full;
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
      ...extrait(texte),
      lien,
      publie_par: nom,
    }];
  });
}

/** `source`: a commune's own (mairie()), credited apart from the other mairies. */
function rss(id: string, nom: string, url: string, commune: string, source?: SourceInfo): Agenda {
  const from = source ?? SOURCES.mairies;
  return {
    id,
    nom,
    source: from,
    commune,
    load: (cache) => cache.get(`agenda:${id}`, FRESH_SECONDS, async () => parseRss(await getText(from.id, url, TIMEOUT_MS, HEADERS), nom, commune, !!source)),
  };
}

// ---------------------------------------------------------------- A mairie's news (WordPress, SPIP)

/**
 * A mairie with no agenda that announces some of its events in its news. An article is an event only when its title
 * (a feed's: its title or its first sentence) gives the event's day, today or later, and announces an event rather than
 * a service (annonceEvenement); anything else is left out, never guessed: an article whose day cannot be read is no
 * event. What comes of it is small municipal events, not an agenda (`partiel`).
 */
function newsEvent(titre: string, texte: string, dated: string, lien: string, published: Date, now: Date, nom: string, commune: string): Evenement[] {
  if (!annonceEvenement(titre)) return [];
  const today = localDay(now);
  const seances = datesIn(dated, published).filter((s) => (s.fin ?? s.debut).slice(0, 10) >= today);
  if (!seances.length) return [];
  const statut = statusOf(titre, texte);
  return [{ ...(statut ? { statut } : {}), id: lien, titre, seances, commune, categories: [], ...extrait(texte), lien, publie_par: nom }];
}

interface WpPost { date: string; link: string; title: { rendered: string }; excerpt?: { rendered: string } }

/** WordPress posts: the day in the title (« … le 25 octobre », « … le 28 octobre 2026 »). */
export function parseWpNews(posts: WpPost[], nom: string, commune: string, now: Date): Evenement[] {
  return posts.flatMap((p) => {
    const titre = clean(p.title.rendered);
    // WordPress dates a post in the site's time (La Réunion's here), without an offset.
    return newsEvent(titre, clean(p.excerpt?.rendered ?? "").replace(/\s*\[(?:…|&hellip;)\]\s*$/u, ""), titre, p.link, new Date(`${p.date}+04:00`), now, nom, commune);
  });
}

/** A SPIP feed: the day in the title or in the first sentence (« Du 7 au 11 novembre 2026, … »). */
export function parseSpipNews(xml: string, nom: string, commune: string, now: Date): Evenement[] {
  return [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const titre = clean(tag(item, "title"));
    const texte = clean(tag(item, "description"));
    const published = new Date(tag(item, "dc:date") || tag(item, "pubDate"));
    return newsEvent(titre, texte, `${titre} ${lead(texte)}`, clean(tag(item, "link")), published, now, nom, commune);
  });
}

/**
 * Salazie's site lists its categories « Agenda » and « Actualités » as pages: its feeds lead back to them and its
 * robots.txt forbids /wp-json/. Each post is a loop item: its id, its title, its excerpt. Its page is `?p=<id>`, which
 * the site sends on to the post.
 */
export function salazieItems(html: string): { id: string; titre: string; texte: string; lien: string }[] {
  return html.split(/(?=<div[^>]*\be-loop-item\b)/).filter((part) => part.startsWith("<div")).flatMap((item) => {
    const id = /\bpost-(\d+)\b/.exec(item)?.[1];
    const titre = /<h1[^>]*elementor-heading-title[^>]*>([\s\S]*?)<\/h1>/.exec(item)?.[1];
    if (!id || !titre) return [];
    const texte = /theme-post-excerpt\.default">([\s\S]*?)<\/div>/.exec(item)?.[1] ?? "";
    return [{ id, titre: clean(titre), texte: clean(texte).replace(/\s*\[(?:…|&hellip;)\]\s*$/u, ""), lien: `${SALAZIE}/?p=${id}` }];
  });
}

/** Salazie's « Agenda »: the day as data, « Date de l'événement: 14/11/22 », today or later. */
export function parseSalazie(html: string, now: Date): Evenement[] {
  const today = localDay(now);
  return salazieItems(html).flatMap((it) => {
    const d = /Date de l[’']événement\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{2}(?:\d{2})?)/u.exec(it.texte);
    if (!d) return [];
    const debut = `${d[3].length === 2 ? `20${d[3]}` : d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
    if (debut < today) return [];
    const texte = it.texte.slice(d.index + d[0].length).trim();
    const statut = statusOf(it.titre, texte);
    return [{ ...(statut ? { statut } : {}), id: it.lien, titre: it.titre, seances: [{ debut }], commune: "Salazie", categories: [], ...extrait(texte), lien: it.lien, publie_par: "Ville de Salazie" }];
  });
}

/**
 * Salazie's « Actualités »: an event only when its title or its first sentence gives its day (newsEvent). Its page dates
 * no post: a day without its year is not placed in one (an epoch's publication puts it in the past), never guessed.
 */
export function parseSalazieNews(html: string, now: Date): Evenement[] {
  return salazieItems(html).flatMap((it) => newsEvent(it.titre, it.texte, `${it.titre} ${lead(it.texte)}`, it.lien, new Date(0), now, "Ville de Salazie", "Salazie"));
}

function news(id: string, nom: string, site: string, url: string, commune: string, parse: (body: string, now: Date) => Evenement[], licence = "Information publique (actualités municipales)"): Agenda {
  const source: SourceInfo = {
    id: `actus_${id}`,
    nom: `Actualités de la ${nom} (événements annoncés)`,
    organisme: nom,
    licence,
    attribution: nom,
    url: site,
  };
  return {
    id,
    nom,
    source,
    commune,
    planifie: true,
    partiel: `seuls les événements annoncés dans les actualités de la ${nom} sont lus, ce n'est pas un agenda complet`,
    load: (cache, now) => cache.get(`agenda:${id}`, FRESH_SECONDS, async () => parse(await getText(source.id, url, TIMEOUT_MS, HEADERS), now)),
  };
}

const WP_NEWS = "/wp-json/wp/v2/posts?per_page=20&_fields=date,link,title,excerpt";
const SALAZIE = "https://ville-salazie.fr";
export const ACTUS_MAIRIES: Agenda[] = [
  { ...news("saint_philippe", "Mairie de Saint-Philippe", "https://saintphilippe.re/", `https://saintphilippe.re${WP_NEWS}`, "Saint-Philippe",
    (body, now) => parseWpNews(JSON.parse(body), "Mairie de Saint-Philippe", "Saint-Philippe", now)), site_commune: "site de la commune de Saint-Philippe", faits: true },
  // Its category « Actualité » (17): the others are notices.
  { ...news("cilaos", "Ville de Cilaos", "https://ville-cilaos.fr/", `https://ville-cilaos.fr${WP_NEWS}&categories=17`, "Cilaos",
    (body, now) => parseWpNews(JSON.parse(body), "Ville de Cilaos", "Cilaos", now)), site_commune: "site de la commune de Cilaos", faits: true },
  // Its feed of articles; not `?page=ical`, whose dates are the articles' publication, not events.
  { ...news("saint_joseph", "Ville de Saint-Joseph", "https://saintjoseph.re/", "https://saintjoseph.re/spip.php?page=backend", "Saint-Joseph",
    (body, now) => parseSpipNews(body, "Ville de Saint-Joseph", "Saint-Joseph", now)), site_commune: "site de la commune de Saint-Joseph", faits: true },
  // Its news (Joomla), apart from its agenda (« saint_louis »): the events it announces there, such as the associations'
  // forum. A feed of the same shape as SPIP's.
  { ...news("saint_louis_actus", "Ville de Saint-Louis", "https://saintlouis.re/actualites", "https://saintlouis.re/actualites?format=feed&type=rss", "Saint-Louis",
    (body, now) => parseSpipNews(body, "Ville de Saint-Louis", "Saint-Louis", now), REPRISE_INFORMATION), site_commune: "site de la commune de Saint-Louis" },
  // Its category « Actualité » (4): its « À faire à Saint-Leu » has had nothing since March 2025. Its terms allow its
  // information and keep its « œuvres » (its texts, its photos): the facts only, without the article's sentence.
  { ...news("saint_leu", "Ville de Saint-Leu", "https://www.saintleu.re/", `https://www.saintleu.re${WP_NEWS}&categories=4`, "Saint-Leu",
    (body, now) => parseWpNews(JSON.parse(body), "Ville de Saint-Leu", "Saint-Leu", now), REPRISE_INFORMATION), site_commune: "site de la commune de Saint-Leu", faits: true },
  // Two types of its own: « agenda » and « actus ». Its posts are the council's deliberations and the mayor's orders.
  // Its terms ask for « https://www.ville-plainedespalmistes.fr » on what is taken from it.
  ...(["agenda", "actus"] as const).map((type) => {
    const read = news(`plaine_des_palmistes_${type}`, "Ville de La Plaine-des-Palmistes", "https://www.ville-plainedespalmistes.fr/", `https://www.ville-plainedespalmistes.fr/wp-json/wp/v2/${type}?per_page=20&_fields=date,link,title,excerpt`, "La Plaine-des-Palmistes",
      (body, now) => parseWpNews(JSON.parse(body), "Ville de La Plaine-des-Palmistes", "La Plaine-des-Palmistes", now), REPRISE_INFORMATION);
    // Its agenda credited as such, not as a second « Actualités ».
    return {
      ...read,
      ...(type === "agenda" && { source: { ...read.source, nom: "Agenda de la Ville de La Plaine-des-Palmistes (événements annoncés avec leur date)" } }),
      partiel: "seuls les événements que la Ville de La Plaine-des-Palmistes annonce avec leur date dans son agenda et ses actualités sont lus, ce n'est pas un agenda complet",
      site_commune: "site de la commune de La Plaine-des-Palmistes (©\u00a0https://www.ville-plainedespalmistes.fr)",
    };
  }),
  // No condition written on their sites: their facts only all the same, as for the others (marketing, 25/10).
  { ...news("sainte_marie_actus", "Ville de Sainte-Marie", "https://www.ville-saintemarie.re/", `https://www.ville-saintemarie.re${WP_NEWS}`, "Sainte-Marie",
    (body, now) => parseWpNews(JSON.parse(body), "Ville de Sainte-Marie", "Sainte-Marie", now), `Information publique (actualités municipales)${SANS_CONDITION}`), site_commune: "site de la commune de Sainte-Marie", faits: true },
  { ...news("salazie_actus", "Ville de Salazie", `${SALAZIE}/`, `${SALAZIE}/category/actualites/`, "Salazie", parseSalazieNews, `Information publique (actualités municipales)${SANS_CONDITION}`),
    site_commune: "site de la commune de Salazie", faits: true },
];

// ---------------------------------------------------------------- IntraMuros (La Possession)

/**
 * The RSS of an agenda kept on IntraMuros, each date as data: `ev:startdate`, `ev:enddate`, and `xCal:rdate` for an
 * event on some days of a span (« Parentali'thé », one Wednesday a month). Midnight to 23:59:59 is a day without hours.
 */
export function parseIntraMuros(xml: string, nom: string, commune: string): Evenement[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const start = tag(item, "ev:startdate");
    const end = tag(item, "ev:enddate") || start;
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(start)) return [];
    const allDay = start.slice(11, 16) === "00:00" && end.slice(11, 16) === "23:59";
    const days = tag(item, "xCal:rdate").split(",").map((d) => d.trim()).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d));
    const span = (d: string) => (allDay ? { debut: d } : { debut: `${d}T${start.slice(11, 16)}`, fin: `${d}T${end.slice(11, 16)}` });
    const seances = days.length ? days.map(span)
      : allDay ? [{ debut: start.slice(0, 10), fin: end.slice(0, 10) !== start.slice(0, 10) ? end.slice(0, 10) : undefined }]
      : [{ debut: start.slice(0, 16), fin: end.slice(0, 16) }];
    const titre = clean(tag(item, "title"));
    const where = clean(tag(item, "ev:location"));
    const [lat, lon] = tag(item, "georss:point").split(/\s+/).map(Number);
    const category = clean(tag(item, "category"));
    const lien = clean(tag(item, "link"));
    const statut = statusOf(titre);
    return [{
      ...(statut ? { statut } : {}),
      id: lien,
      titre,
      seances,
      // « La Possession », or the title again (« Agenda sportif du 22 au 24 octobre »), is no place.
      lieu: where && where !== titre && normalize(where) !== normalize(commune) ? where : undefined,
      commune: communeOf(where) ?? commune,
      lon: Number.isFinite(lon) ? lon : undefined,
      lat: Number.isFinite(lat) ? lat : undefined,
      categories: category ? [category] : [],
      lien,
      publie_par: nom,
    }];
  });
}

function intraMuros(id: string, nom: string, url: string, commune: string, source: SourceInfo): Agenda {
  return {
    id,
    nom,
    source,
    commune,
    load: (cache) => cache.get(`agenda:${id}`, FRESH_SECONDS, async () => parseIntraMuros(await getText(source.id, url, TIMEOUT_MS, HEADERS), nom, commune)),
  };
}

// ---------------------------------------------------------------- iCalendar (.ics)

/**
 * An agenda published as an iCalendar file (RFC 5545): the « adresse publique au format iCal » of a Google calendar,
 * Outlook's published calendar, Nextcloud's public link, The Events Calendar's `?ical=1`. Each VEVENT gives:
 * - DTSTART and DTEND: a day (VALUE=DATE, an all-day event whose DTEND is the day after the last), a UTC time (« Z »,
 *   said in La Réunion's hour) or a time with a TZID or none, kept as typed: a mairie's site set to Paris time still
 *   types its events in La Réunion's hour (Saint-Paul's `TZID=Europe/Paris`, like its The Events Calendar above);
 * - SUMMARY, LOCATION, URL, CATEGORIES, GEO, and the first sentence of DESCRIPTION (of its first line); STATUS:CANCELLED
 *   is « annulé »;
 * - RRULE: the occurrences in the days read, for FREQ DAILY, WEEKLY (BYDAY), MONTHLY (BYMONTHDAY, or BYDAY with its
 *   rank, « 1SA », « -1FR ») and YEARLY (DTSTART's day), with INTERVAL, COUNT and UNTIL; EXDATE takes days out, and
 *   a VEVENT with a RECURRENCE-ID replaces the day it names. Any other part of a rule (BYSETPOS, BYWEEKNO, BYYEARDAY,
 *   BYMONTH, BYHOUR, an hourly rule…) is not expanded: the event keeps its first date only.
 * Not read: DURATION, VTODO and VJOURNAL, and a private event (CLASS other than PUBLIC) or one without a SUMMARY, like
 * the « Occupé » of a calendar that shows only its busy hours.
 */
const ICS_MAX_SEANCES = 60;

/** The lines of the file, unfolded before decoding: a fold may cut a character in two (« é » is two bytes). */
function icsLines(data: ArrayBuffer | string): string[] {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    // CRLF or LF followed by a space or a tab: the line goes on.
    if (b === 13 && bytes[i + 1] === 10 && (bytes[i + 2] === 32 || bytes[i + 2] === 9)) { i += 2; continue; }
    if (b === 10 && (bytes[i + 1] === 32 || bytes[i + 1] === 9)) { i += 1; continue; }
    out.push(b);
  }
  return new TextDecoder().decode(new Uint8Array(out)).split(/\r?\n/).filter((l) => l.trim());
}

interface IcsProp {
  params: Record<string, string>;
  value: string;
}

/** « DTSTART;TZID="Indian/Reunion":20261031T080000 »: the name, its parameters (a quoted one may hold « : »), the value. */
function icsProp(line: string): [string, IcsProp] | undefined {
  let i = 0;
  let quoted = false;
  for (; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) break;
  }
  if (i === line.length) return undefined;
  const [name, ...parts] = line.slice(0, i).split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const params = Object.fromEntries(parts.map((p) => {
    const at = p.indexOf("=");
    return [p.slice(0, at).toUpperCase(), p.slice(at + 1).replace(/^"|"$/g, "")];
  }));
  return [name.toUpperCase(), { params, value: line.slice(i + 1) }];
}

/** A TEXT value: « \, » « \; » « \\ » and « \n » for a new line. */
const icsText = (s: string) => s.replace(/\\([\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
/** A list of TEXT values (CATEGORIES): split on the commas not escaped. */
const icsList = (s: string) => s.split(/(?<!\\),/).map((x) => clean(icsText(x))).filter(Boolean);

/** A day, and its hour when it has one, in La Réunion: « 20261031T040000Z » → 2026-10-31 08:00. */
interface IcsTime {
  day: string;
  hm?: string;
}

function icsTime(p: IcsProp | undefined): IcsTime | undefined {
  const m = p && /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)\d\d(Z)?)?$/.exec(p.value.trim());
  if (!m) return undefined;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || p!.params.VALUE === "DATE") return { day };
  if (!m[6]) return { day, hm: `${m[4]}:${m[5]}` };
  const local = toLocal(`${day}T${m[4]}:${m[5]}:00Z`);
  return { day: local.slice(0, 10), hm: local.slice(11, 16) };
}

const minutes = (t: IcsTime) => Date.parse(`${t.day}T${t.hm ?? "00:00"}:00Z`) / 60_000;
const fromMinutes = (n: number) => new Date(n * 60_000).toISOString().slice(0, 16);
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/**
 * The days a VEVENT's RRULE gives up to `last`, its first included, at the hour `hm` of its DTSTART; undefined when a
 * part of the rule is not read.
 */
function icsDays(start: string, hm: string | undefined, rrule: string, last: string): string[] | undefined {
  const r = Object.fromEntries(rrule.split(";").map((kv) => kv.split("=") as [string, string]).map(([k, v]) => [k.toUpperCase(), v]));
  const known = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "WKST"]);
  if (Object.keys(r).some((k) => !known.has(k))) return undefined;
  const interval = Math.max(1, Number(r.INTERVAL) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  // UNTIL is an instant: « 20261026T235959Z » is the 27th at 3:59 here, and an occurrence at 19:00 that day is after it.
  const until = r.UNTIL ? icsTime({ params: {}, value: r.UNTIL }) : undefined;
  const end = until && until.day < last ? until.day : last;
  const before = (day: string) => !until || `${day}T${hm ?? "00:00"}` <= `${until.day}T${until.hm ?? "23:59"}`;
  const byday = r.BYDAY?.split(",").map((d) => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(d.trim()));
  if (byday?.some((d) => !d)) return undefined;
  const bymonthday = r.BYMONTHDAY?.split(",").map(Number);
  const [y0, m0, d0] = start.split("-").map(Number);
  const days: string[] = [];
  const take = (day: string) => {
    if (day >= start && day <= end && before(day) && days.length < count) days.push(day);
  };
  // Each period of the rule (a day, a week, a month, a year), from the first, while its days can still be read.
  for (let n = 0; days.length < count && n < 20_000; n += interval) {
    if (r.FREQ === "DAILY") {
      const day = addDays(start, n);
      if (day > end) break;
      if (!byday || byday.some((d) => WEEKDAYS.indexOf(d![2]) === weekday(day))) take(day);
    } else if (r.FREQ === "WEEKLY") {
      // The week of DTSTART, from its Monday.
      const monday = addDays(addDays(start, -((weekday(start) + 6) % 7)), 7 * n);
      if (monday > end) break;
      const wanted = byday ? byday.map((d) => WEEKDAYS.indexOf(d![2])) : [weekday(start)];
      for (let k = 0; k < 7; k++) if (wanted.includes(weekday(addDays(monday, k)))) take(addDays(monday, k));
    } else if (r.FREQ === "MONTHLY" || r.FREQ === "YEARLY") {
      if (r.FREQ === "YEARLY" && (byday || bymonthday)) return undefined;
      const months = r.FREQ === "MONTHLY" ? n : 12 * n;
      const y = y0 + Math.floor((m0 - 1 + months) / 12);
      const m = ((m0 - 1 + months) % 12) + 1;
      if (iso(y, m, 1) > end) break;
      const size = lastDay(y, m);
      const found: number[] = [];
      if (byday) {
        for (const d of byday) {
          const all = Array.from({ length: size }, (_, i) => i + 1).filter((x) => weekday(iso(y, m, x)) === WEEKDAYS.indexOf(d![2]));
          const rank = d![1] ? Number(d![1]) : 0;
          found.push(...(rank === 0 ? all : [all.at(rank > 0 ? rank - 1 : rank)].filter((x): x is number => x !== undefined)));
        }
      } else {
        // A day the month lacks (the 31st, February the 29th) is skipped, as the RFC says.
        found.push(...(bymonthday ?? [d0]).map((x) => (x < 0 ? size + 1 + x : x)).filter((x) => x >= 1 && x <= size));
      }
      for (const x of [...new Set(found)].sort((a, b) => a - b)) take(iso(y, m, x));
    } else return undefined;
  }
  return days;
}

/**
 * `commune`: the agenda's, for an event whose place names none. `now`: only the occurrences from today to AHEAD_DAYS
 * ahead are kept, as the other readers ask their sources for, and an event with none is left out.
 */
export function parseIcs(data: ArrayBuffer | string, nom: string, page: string, now: Date, commune?: string): Evenement[] {
  const vevents: Map<string, IcsProp[]>[] = [];
  let current: Map<string, IcsProp[]> | undefined;
  let depth = 0;
  for (const line of icsLines(data)) {
    const prop = icsProp(line);
    if (!prop) continue;
    const [name, p] = prop;
    if (name === "BEGIN" && p.value.toUpperCase() === "VEVENT") { current = new Map(); depth = 0; continue; }
    if (!current) continue;
    // A VALARM inside the event has its own DESCRIPTION.
    if (name === "BEGIN") { depth++; continue; }
    if (name === "END" && depth) { depth--; continue; }
    if (name === "END") { vevents.push(current); current = undefined; continue; }
    if (!depth) current.set(name, [...(current.get(name) ?? []), p]);
  }
  const today = localDay(now);
  const last = addDays(today, AHEAD_DAYS);
  const one = (v: Map<string, IcsProp[]>, name: string) => v.get(name)?.[0];
  // The days a VEVENT with a RECURRENCE-ID replaces, by UID.
  const replaced = new Map<string, Set<string>>();
  for (const v of vevents) {
    const uid = one(v, "UID")?.value;
    const day = icsTime(one(v, "RECURRENCE-ID"))?.day;
    if (uid && day) replaced.set(uid, (replaced.get(uid) ?? new Set()).add(day));
  }
  return vevents.flatMap((v) => {
    const summary = one(v, "SUMMARY");
    const klass = one(v, "CLASS")?.value.toUpperCase();
    const start = icsTime(one(v, "DTSTART"));
    if (!summary || !start || (klass && klass !== "PUBLIC")) return [];
    const uid = one(v, "UID")?.value ?? `${start.day}:${summary.value}`;
    const recurrence = icsTime(one(v, "RECURRENCE-ID"))?.day;
    const endTime = icsTime(one(v, "DTEND"));
    // An all-day event ends the day before its DTEND; a timed one, at its DTEND.
    const length = endTime ? minutes(endTime) - minutes(start) - (start.hm ? 0 : 24 * 60) : undefined;
    const rule = one(v, "RRULE")?.value;
    const skip = new Set([
      ...(replaced.get(uid) ?? []),
      ...(v.get("EXDATE") ?? []).flatMap((x) => x.value.split(",").map((value) => icsTime({ params: x.params, value })?.day)),
    ]);
    const days = (!recurrence && rule && icsDays(start.day, start.hm, rule, last)) || [start.day];
    const seances = days
      .filter((day) => recurrence || !skip.has(day))
      .map((day): Seance => {
        const debut = start.hm ? `${day}T${start.hm}` : day;
        if (length === undefined || length <= 0) return { debut };
        const fin = fromMinutes(minutes({ day, hm: start.hm }) + length);
        return { debut, fin: start.hm ? fin : fin.slice(0, 10) };
      })
      .filter((s) => (s.fin ?? s.debut).slice(0, 10) >= today && s.debut.slice(0, 10) <= last)
      .slice(0, ICS_MAX_SEANCES);
    if (!seances.length) return [];
    const titre = clean(icsText(summary.value));
    // Its first line: a line break ends a sentence that has no full stop (« Journée d'observance\nPour masquer… »).
    const texte = clean(icsText(one(v, "DESCRIPTION")?.value ?? "").split("\n").find((l) => l.trim()) ?? "");
    const lieu = clean(icsText(one(v, "LOCATION")?.value ?? "")) || undefined;
    const [lat, lon] = (one(v, "GEO")?.value ?? "").split(";").map(Number);
    const statut = one(v, "STATUS")?.value.toUpperCase() === "CANCELLED" ? "annulé" : statusOf(titre, texte);
    return [{
      ...(statut ? { statut } : {}),
      id: `${nom}:${uid}${recurrence ? `:${recurrence}` : ""}`,
      titre,
      seances,
      lieu,
      commune: communeOf(lieu) ?? commune,
      lon: Number.isFinite(lon) && one(v, "GEO") ? lon : undefined,
      lat: Number.isFinite(lat) && one(v, "GEO") ? lat : undefined,
      categories: (v.get("CATEGORIES") ?? []).flatMap((c) => icsList(c.value)).slice(0, 5),
      description: texte ? lead(texte) : undefined,
      lien: httpUrl(one(v, "URL")?.value.trim()) ?? page,
      publie_par: nom,
    }];
  });
}

/**
 * An agenda read from its iCalendar address. `page`: where a person sees the agenda, the link of an event that gives
 * none. A « webcal:// » address (Apple, Outlook) is read over https.
 */
export function ics(id: string, nom: string, url: string, page: string, source: SourceInfo, commune?: string): Agenda {
  const address = url.replace(/^webcals?:\/\//i, "https://");
  return {
    id,
    nom,
    source,
    commune,
    load: (cache, now) => cache.get(`agenda:${id}`, FRESH_SECONDS, async () => parseIcs(await getBytes(source.id, address, TIMEOUT_MS, HEADERS), nom, page, now, commune)),
  };
}

// ---------------------------------------------------------------- Petite-Île

/**
 * Petite-Île's agenda page: for each event its link, its title, « access_time » and the days (« Du 28 octobre au 31
 * octobre », « Le 14 octobre de 10h00 à 11h00 », without the year), « location_on » and the place, then the start of
 * its text. The page lists the past ones too, after the coming ones.
 */
export function parsePetiteIle(html: string, now: Date, nom = "Ville de Petite-Île"): Evenement[] {
  // The list only, from its first row to the footer: the menus around it are four fifths of the page.
  const from = html.indexOf("views-row");
  const to = html.indexOf("<footer", from);
  const t = tokens(html.slice(Math.max(0, from), to > 0 ? to : undefined));
  const out: Evenement[] = [];
  for (let i = 1; i + 1 < t.length; i++) {
    if (t[i].t !== "access_time") continue;
    const titre = t[i - 1].t && clean(t[i - 1].t!);
    // The list gives the hours in UTC as if they were local (« de 05h00 à 08h00 » for « De 9h à 12h » on the event's
    // own page, whose <time> says 05:00:00Z): they are put back to La Réunion's.
    const seances = (t[i + 1].t ? datesIn(t[i + 1].t!, now) : []).map((x) => (x.debut.length > 10 ? { debut: toLocal(`${x.debut}:00Z`), fin: x.fin && toLocal(`${x.fin}:00Z`) } : x));
    let k = i - 2;
    while (k >= 0 && !t[k].href) k--;
    const href = t[k]?.href;
    if (!titre || !seances.length || !href?.includes("/agenda/")) continue;
    let j = i + 2;
    const lieu = t[j]?.t === "location_on" && t[j + 1]?.t ? clean(t[(j += 2) - 1].t!) : undefined;
    const texte = t[j]?.t ? clean(t[j].t!) : "";
    const lien = new URL(href, "https://www.petite-ile.re/").toString();
    const statut = statusOf(titre, texte);
    out.push({
      ...(statut ? { statut } : {}),
      id: lien,
      titre,
      seances,
      lieu: lieu && !/^commune(?: de |$)/i.test(lieu) ? lieu : undefined,
      commune: "Petite-Île",
      categories: [],
      ...extrait(texte ? texte.replace(/\.\.\.$/, "…") : ""),
      lien,
      publie_par: nom,
    });
  }
  return out;
}

const SAINT_LOUIS = mairie("saint_louis", "Ville de Saint-Louis", "https://saintlouis.re/agenda", REPRISE_INFORMATION);
const ETANG_SALE = mairie("etang_sale", "Ville de L'Étang-Salé", "https://www.letangsale.fr/mes-acces-rapides/telechargements/l-agenda-des-manifestations");
const LA_POSSESSION = mairie("la_possession", "Ville de La Possession", "https://www.lapossession.re/agenda");
// Credited by their home page, the only page their terms allow a link to; their agenda page is read.
const PETITE_ILE = mairie("petite_ile", "Ville de Petite-Île", "https://www.petite-ile.re/");
const PETITE_ILE_AGENDA = "https://www.petite-ile.re/actualites/agenda/";

const SAINTE_MARIE = mairie("sainte_marie", "Ville de Sainte-Marie", "https://www.ville-saintemarie.re/agenda/", `Information publique (agenda municipal)${SANS_CONDITION}`);
const SALAZIE_AGENDA = mairie("salazie", "Ville de Salazie", `${SALAZIE}/category/10-agenda/`, `Information publique (agenda municipal)${SANS_CONDITION}`);

/** Read by the scheduled event: it publishes seldom (its last event, 21/02/2025, as read on 25/10/2026). */
const salazie: Agenda = {
  id: "salazie",
  nom: "Ville de Salazie",
  source: SALAZIE_AGENDA,
  commune: "Salazie",
  planifie: true,
  load: (cache, now) => cache.get("agenda:salazie", FRESH_SECONDS, async () => parseSalazie(await getText(SALAZIE_AGENDA.id, SALAZIE_AGENDA.url, TIMEOUT_MS, HEADERS), now)),
};

const BRAS_PANON = mairie("bras_panon", "Ville de Bras-Panon", "https://www.braspanon.re/fr/ev/2512733/agenda-1634");
const SAINT_BENOIT = mairie("saint_benoit", "Ville de Saint-Benoît", "https://www.saint-benoit.re/");
const SAINT_BENOIT_AGENDA = "https://www.saint-benoit.re/evenements/general";
const OTI_EST_SOURCE: SourceInfo = {
  id: "agenda_oti_est",
  nom: "Agenda de l'Office de tourisme intercommunal de l'Est (Côté Est Réunion)",
  organisme: "OTI EST REUNION",
  licence: "Reproduction autorisée avec la source, sans modification (mentions légales de reunionest.fr)",
  attribution: OTI_EST,
  url: "https://www.reunionest.fr/agenda-et-evenements",
};
const EST = ["Saint-André", "Bras-Panon", "Saint-Benoît", "La Plaine-des-Palmistes", "Salazie", "Sainte-Rose"];

const brasPanon: Agenda = {
  id: "bras_panon",
  nom: "Ville de Bras-Panon",
  source: BRAS_PANON,
  commune: "Bras-Panon",
  // This month's page and the next one's: the 45 days ahead.
  requetes: 2,
  load: (cache, now) =>
    cache.get("agenda:bras_panon", FRESH_SECONDS, async () => {
      const day = localDay(now);
      const months = [day, `${addDays(`${day.slice(0, 7)}-01`, 32).slice(0, 7)}-01`].map((d) => `${d.slice(0, 4)}/${d.slice(5, 7)}`);
      const pages = await Promise.all(months.map((m) => getText(BRAS_PANON.id, `${BRAS_PANON.url}/${m}`, TIMEOUT_MS, HEADERS)));
      // An event of two months is on both pages.
      return [...new Map(pages.flatMap((h) => parseBrasPanon(h, now)).map((e) => [e.id, e])).values()];
    }),
};

const saintBenoit: Agenda = {
  id: "saint_benoit",
  nom: "Ville de Saint-Benoît",
  source: SAINT_BENOIT,
  commune: "Saint-Benoît",
  load: (cache, now) => cache.get("agenda:saint_benoit", FRESH_SECONDS, async () => parseSaintBenoit(await getText(SAINT_BENOIT.id, SAINT_BENOIT_AGENDA, TIMEOUT_MS, HEADERS), now)),
};

const otiEst: Agenda = {
  id: "oti_est",
  nom: "Office de tourisme de l'Est",
  source: OTI_EST_SOURCE,
  couvre: EST,
  load: (cache, now) => cache.get("agenda:oti_est", FRESH_SECONDS, async () => parseOtiEst(await getText(OTI_EST_SOURCE.id, OTI_EST_SOURCE.url, TIMEOUT_MS, HEADERS), now)),
};

const petiteIle: Agenda = {
  id: "petite_ile",
  nom: "Ville de Petite-Île",
  source: PETITE_ILE,
  commune: "Petite-Île",
  load: (cache, now) => cache.get("agenda:petite_ile", FRESH_SECONDS, async () => parsePetiteIle(await getText(PETITE_ILE.id, PETITE_ILE_AGENDA, TIMEOUT_MS, HEADERS), now)),
};

// ---------------------------------------------------------------- Bras-Panon, Saint-Benoît

/**
 * Bras-Panon's agenda, a page a month: for each event its link, its title, the days and hours (« 24 Octobre 2026
 * (09:00 - 10:00) », « 24 - 25 Octobre 2026 (09:00) »), « location_on » and the place, « account_balance_wallet » and
 * the price, then a sentence.
 */
export function parseBrasPanon(html: string, now: Date, nom = "Ville de Bras-Panon"): Evenement[] {
  // The list only: from the link of its first event to the footer.
  const from = html.lastIndexOf('href="/fr/ev/', html.indexOf("location_on"));
  const to = html.indexOf("<footer", from);
  const t = tokens(html.slice(Math.max(0, from - 10), to > 0 ? to : undefined));
  const out: Evenement[] = [];
  for (let i = 0; i + 2 < t.length; i++) {
    const href = t[i].href;
    const titre = t[i + 1].t;
    const quand = t[i + 2].t;
    if (!href || !/^\/fr\/ev\/\d+\/\d+\//.test(href) || !titre || !quand) continue;
    const days = datesIn(quand, now);
    if (!days.length) continue;
    const h = /\((\d\d:\d\d)(?:\s*-\s*(\d\d:\d\d))?\)/.exec(quand);
    const seances = h && days.length === 1 && !days[0].fin ? [{ debut: `${days[0].debut}T${h[1]}`, ...(h[2] ? { fin: `${days[0].debut}T${h[2]}` } : {}) }] : days;
    const place: string[] = [];
    let prix: string | undefined;
    let texte = "";
    let j = i + 3;
    if (t[j]?.t === "location_on") for (j++; j < t.length && t[j].t && t[j].t !== "account_balance_wallet"; j++) place.push(t[j].t!);
    if (t[j]?.t === "account_balance_wallet") {
      prix = t[j + 1]?.t;
      texte = t[j + 2]?.t ?? "";
    }
    const lieu = place.filter((x) => !/^\d{5}\b/.test(x) && normalize(x) !== normalize("Bras-Panon")).join(", ");
    const lien = `https://www.braspanon.re${href}`;
    const statut = statusOf(clean(titre), texte);
    out.push({
      ...(statut ? { statut } : {}),
      id: lien,
      titre: clean(titre),
      seances,
      lieu: lieu || undefined,
      commune: "Bras-Panon",
      prix: prix ? clean(prix) : undefined,
      categories: [],
      ...extrait(texte ? clean(texte) : ""),
      lien,
      publie_par: nom,
    });
  }
  return out;
}

/**
 * Saint-Benoît's events: for each, its category (a link), its title, who it is for (« Tout public »), its days
 * (« Du 23 au 25 octobre », « Mercredi 28 octobre 2026 de 09h30 à 10h30 », without the year most often), its text, and
 * the link to its page. One without a date (« Tous les premiers jeudis du mois ») is left out.
 */
export function parseSaintBenoit(html: string, now: Date, nom = "Ville de Saint-Benoît"): Evenement[] {
  const from = html.indexOf('<article class="content shadow event');
  const t = tokens(html.slice(Math.max(0, from), html.lastIndexOf("</article>") + 10));
  const out: Evenement[] = [];
  let block: string[] = [];
  for (const x of t) {
    if (x.href && /\/evenements\/[a-z-]+$/.test(x.href)) {
      block = [];
      continue;
    }
    if (x.t) {
      block.push(x.t);
      continue;
    }
    if (!x.href || !/\/evenements\/articles\/\d+/.test(x.href) || block.length < 3) continue;
    const [, titre, ...rest] = block;
    block = [];
    // The days: the first short line after the title that has some.
    const at = rest.findIndex((r) => r.length < 120 && datesIn(r, now).length);
    if (at < 0) continue;
    const seances = datesIn(rest[at], now);
    const texte = rest.slice(at + 1).find((r) => r.length > 20);
    const statut = statusOf(clean(titre), texte);
    out.push({
      ...(statut ? { statut } : {}),
      id: x.href,
      titre: clean(titre),
      seances,
      commune: "Saint-Benoît",
      categories: at > 0 && rest[0].length < 40 ? [clean(rest[0])] : [],
      ...extrait(texte ? clean(texte) : ""),
      lien: x.href,
      publie_par: nom,
    });
  }
  return out;
}

// ---------------------------------------------------------------- Office de tourisme de l'Est

/**
 * The tourist office of the East's agenda: for each event its link, its days (« Le samedi 24 octobre 2026 », « Du 30
 * octobre 2026 au 1er novembre 2026 »), its title and its commune. Its terms allow a reproduction that cites « OTI EST
 * REUNION » with « Droits réservés » and alters nothing: each event says so, and its title is kept as written. The
 * markets that follow the events have no date.
 */
export function parseOtiEst(html: string, now: Date): Evenement[] {
  const from = html.indexOf('<main class="container-fluid">');
  const to = html.indexOf("Les marchés de l", from);
  const t = tokens(html.slice(Math.max(0, from), to > 0 ? to : undefined));
  const out: Evenement[] = [];
  for (let i = 0; i + 3 < t.length; i++) {
    const href = t[i].href;
    if (!href?.startsWith("https://www.reunionest.fr/agenda/") || !t[i + 1].t || !t[i + 2].t) continue;
    const seances = /^(?:Le|Du)\s/.test(t[i + 1].t!) ? datesIn(t[i + 1].t!, now) : [];
    if (!seances.length) continue;
    const titre = t[i + 2].t!;
    const statut = statusOf(titre);
    out.push({
      ...(statut ? { statut } : {}),
      id: href,
      titre,
      seances,
      commune: communeOf(t[i + 3].t),
      categories: [],
      lien: href,
      publie_par: OTI_EST,
    });
  }
  return out;
}

const NORD = ["Saint-Denis", "Sainte-Marie", "Sainte-Suzanne"];

/**
 * The volley league's calendar: its open tournaments (« King Saison 6 » solo and duo, « Green 3X3 »), all over the
 * island. Their place is often not given yet (« Infos à venir »): said so, never guessed.
 * Read by the scheduled event: the questions' subrequests all go to the communes' agendas.
 */
export const LIGUE_VOLLEY: Agenda = {
  ...tribe("lrvb", "Ligue réunionnaise de volley-ball", "https://lrvb.re", undefined, SPORT_SOURCES.lrvb_tournois, "lieu à venir (voir la page de la Ligue)"),
  planifie: true,
  club: true,
};

// ---------------------------------------------------------------- Sportsregions: the clubs' calendar

interface SportsEventLd {
  "@type"?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  location?: { name?: string; address?: { streetAddress?: string; addressLocality?: string; postalCode?: string } };
  organizer?: { name?: string; url?: string };
  sport?: string;
  url?: string;
}

// The portal's pages read at most, 30 events each (on 25/10/2026, the whole calendar on four: 109 events, eleven months).
const SR_PAGES = 5;
// The members' sessions (« Jeu libre - Adultes », « Entraînement jeunes »): not open to the public, kept for the members.
const CRENEAU = /\b(?:jeux? libres?|entra[iî]nements?|cr[ée]neaux?|s[ée]ances?)\b/i;
// The same title from the same club this many times in what is read: a regular session (the weekly dive outings).
const CRENEAU_FOIS = 3;

/** What a members' session is said to be: « réservé aux adhérents de Badminton Club de Saint-Pierre ». */
export const reserve = (e: Pick<Evenement, "organisateur" | "publie_par">) => `réservé aux adhérents de ${e.organisateur?.nom ?? e.publie_par}`;

/** Sportsregions' times are the club's wall-clock ones, marked « Z » all the same; 00:00 is the whole day. */
const srTime = (s: string) => (s.length < 16 || s.slice(11, 16) === "00:00" ? s.slice(0, 10) : s.slice(0, 16));

/**
 * The event's own place, when its club gave one: then the portal names it « Localisation », its address the event's
 * (« Gîte Bec a li, 4 chemin des Framboises », Cilaos). Else it is the club's address, named after the club.
 */
const lieuSaisi = (e: SportsEventLd) => !!e.location?.name && clean(e.location.name) !== clean(e.organizer?.name ?? "");

/** The commune a title names: « Journée 1 interclubs - Saint-Paul », « FITA Salle St André », « Compétition au Port ». */
function communeDuTitre(titre: string): string | undefined {
  const t = titre.replace(/\bSte?\b\.?(?=\s)/gi, (x) => (/e/i.test(x) ? "Sainte" : "Saint")).replace(/\b(?:au|du)\s+Port\b/gi, "Le Port");
  return communesIn(t)[0];
}

/**
 * The events of the portal's pages: those of the clubs of La Réunion (postal code 974), the members' sessions marked
 * (`reserve_adherents`). `adherents` and `ailleurs` count them, and the clubs left out, for the log.
 */
export function parseSportsregions(pages: string[]): { evenements: Evenement[]; adherents: number; ailleurs: number } {
  const all = pages.flatMap((html) =>
    [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
      try {
        const e = JSON.parse(m[1]) as SportsEventLd;
        return e["@type"] === "SportsEvent" && e.name && e.startDate && e.url ? [e] : [];
      } catch {
        return [];
      }
    }),
  );
  // Each once, by its link: a page may repeat the last one of the page before.
  const here = [...new Map(all.filter((e) => e.location?.address?.postalCode?.startsWith("974")).map((e) => [e.url, e])).values()];
  const club = (e: SportsEventLd) => clean(e.organizer?.name ?? "");
  const key = (e: SportsEventLd) => `${normalize(clean(e.name!))}|${club(e)}`;
  const times = new Map<string, number>();
  for (const e of here) times.set(key(e), (times.get(key(e)) ?? 0) + 1);
  const members = (e: SportsEventLd) => CRENEAU.test(e.name!) || times.get(key(e))! >= CRENEAU_FOIS;
  const evenements = here.map((e): Evenement => {
    const titre = clean(e.name!);
    const address = e.location?.address;
    const saisi = lieuSaisi(e);
    const debut = srTime(e.startDate!);
    const fin = e.endDate ? srTime(e.endDate) : undefined;
    const nom = club(e) || "un club";
    const commune = communeOf(address?.addressLocality);
    const lieu = saisi ? [clean(e.location!.name!), clean(address?.streetAddress ?? "")].filter((x) => x && !/^localisation$/i.test(x)).join(", ") : "";
    const duClub = saisi ? undefined : commune;
    const sport = e.sport && !/^divers$/i.test(e.sport.trim()) ? clean(e.sport) : undefined;
    const statut = statusOf(titre);
    const site = httpUrl(e.organizer?.url);
    return {
      ...(statut ? { statut } : {}),
      ...(members(e) ? { reserve_adherents: true } : {}),
      id: `sportsregions:${e.url}`,
      titre,
      seances: [{ debut, fin: fin && fin !== debut && fin !== debut.slice(0, 10) ? fin : undefined }],
      ...(lieu ? { lieu } : {}),
      commune: (saisi ? commune : undefined) ?? communeDuTitre(titre),
      categories: ["Sport", ...(sport ? [sport] : [])],
      description: `Organisé par ${nom}${duClub ? ` (${duClub})` : ""}`,
      lien: e.url!,
      publie_par: nom,
      organisateur: { nom, ...(duClub ? { commune: duClub } : {}), sport, ...(site ? { site } : {}) },
    };
  });
  return { evenements, adherents: evenements.filter((e) => e.reserve_adherents).length, ailleurs: all.filter((e) => !e.location?.address?.postalCode?.startsWith("974")).length };
}

/**
 * The calendar of the clubs of La Réunion on Sportsregions, the platform many clubs keep their site on: what each one
 * publishes in its « Événements » (competitions, open days, galas), 30 to a page, each in its JSON-LD (SportsEvent).
 * Its place (`location`) is the event's when the club gave one (lieuSaisi), else the club's address, never said as the
 * event's place: then only who organises it, and the event's commune only when its title names one. The members' sessions are kept, marked, and told only
 * to who says they are a member (tools/agenda.ts, tools/sport.ts: `adherent`). Read by the scheduled event every six
 * hours, its pages one after the other; the portal's RSS feed is not to be read (robots.txt), its pages are.
 */
export const SPORTSREGIONS: Agenda = {
  id: "sportsregions",
  nom: "Clubs sportifs (Sportsregions)",
  source: SPORT_SOURCES.sportsregions,
  requetes: SR_PAGES,
  planifie: true,
  relecture: 6 * 3600,
  club: true,
  load: (cache) =>
    cache.get("agenda:sportsregions", 6 * 3600, async () => {
      const url = SPORT_SOURCES.sportsregions.url;
      const pages = [await getText(SPORT_SOURCES.sportsregions.id, url, TIMEOUT_MS, HEADERS)];
      // The last page the first one links to: past SR_PAGES, the calendar's end is not read, and the log says so (a
      // line to watch: /associations promises the clubs « sous 48 h », true only while the calendar fits).
      const linked = Math.max(1, ...[...pages[0].matchAll(/[?&]page=(\d+)/g)].map((m) => +m[1]));
      const last = Math.min(SR_PAGES, linked);
      for (let n = 2; n <= last; n++) pages.push(await getText(SPORT_SOURCES.sportsregions.id, `${url}?page=${n}`, TIMEOUT_MS, HEADERS));
      const { evenements, adherents, ailleurs } = parseSportsregions(pages);
      console.log(`agenda sportsregions : ${pages.length} pages sur ${linked} liées, ${evenements.length} événements dont ${adherents} réservés aux adhérents, ${ailleurs} hors de La Réunion`);
      if (linked > SR_PAGES) console.warn(`agenda sportsregions : arrêt à ${SR_PAGES} pages (SR_PAGES), le calendrier en lie ${linked} : ses derniers événements ne sont pas lus`);
      return evenements;
    }),
};

// The terms of each commune's site, read on 25/10/2026: those that ask for an authorisation to reproduce it (`faits`),
// those that allow a link to their home page only (`accueil`).
/** Every agenda that can be read, before the communes' authorisations (AGENDAS). */
export const LISIBLES: Agenda[] = [
  { ...tribe("saint_paul", "Mairie de Saint-Paul", "https://www.mairie-saintpaul.re", "Saint-Paul"), site_commune: "site de la commune de Saint-Paul" },
  // Its terms ask for « www.ville-port.re » on what is taken from it.
  { ...tribe("le_port", "Ville du Port", "https://www.ville-port.re", "Le Port"), site_commune: "site de la commune du Port (©\u00a0www.ville-port.re)" },
  { ...tribe("trois_bassins", "Mairie des Trois-Bassins", "https://trois-bassins.re", "Les Trois-Bassins"), site_commune: "site de la commune des Trois-Bassins" },
  { ...tribe("sainte_marie", "Ville de Sainte-Marie", "https://www.ville-saintemarie.re", "Sainte-Marie", SAINTE_MARIE), site_commune: "site de la commune de Sainte-Marie", faits: true },
  { ...salazie, site_commune: "site de la commune de Salazie", faits: true },
  { ...rss("le_tampon", "Ville du Tampon", "https://letampon.fr/agenda/feed/", "Le Tampon"), site_commune: "site de la commune du Tampon", faits: true, accueil: "https://letampon.fr/" },
  // Its whole agenda, all its categories: « /agenda/evenements » has had nothing to come since September 2026.
  { ...rss("saint_louis", "Ville de Saint-Louis", "https://saintlouis.re/agenda?format=feed&type=rss", "Saint-Louis", SAINT_LOUIS), site_commune: "site de la commune de Saint-Louis" },
  { ...rss("saint_andre", "Ville de Saint-André", "https://www.saint-andre.re/category/agenda/feed/", "Saint-André"), site_commune: "site de la commune de Saint-André", faits: true },
  tribe("sechoir", "Le Séchoir", "https://www.lesechoir.com", "Saint-Leu", SALLES_SOURCE, "Le Séchoir"),
  { ...rss("etang_sale", "Ville de L'Étang-Salé", "https://www.letangsale.fr/mes-acces-rapides/telechargements/l-agenda-des-manifestations?format=feed&type=rss", "L'Étang-Salé", ETANG_SALE), site_commune: "site de la commune de L'Étang-Salé", faits: true, programmes: true },
  { ...intraMuros("la_possession", "Ville de La Possession", "https://www.lapossession.re/agenda/rss", "La Possession", LA_POSSESSION), site_commune: "site de la commune de La Possession", faits: true, programmes: true },
  { ...petiteIle, site_commune: "site de la commune de Petite-Île", faits: true, accueil: PETITE_ILE.url },
  { ...brasPanon, site_commune: "site de la commune de Bras-Panon", faits: true },
  { ...saintBenoit, site_commune: "site de la commune de Saint-Benoît", faits: true, accueil: SAINT_BENOIT.url, programmes: true },
  otiEst,
  openAgenda("cinor", "CINOR", 50316469, NORD),
  openAgenda("oti_nord", "Office de tourisme du Nord", 32570974, NORD),
  LIGUE_VOLLEY,
  ...ACTUS_MAIRIES,
  SPORTSREGIONS,
  reunionFr,
  ...SALLES,
  PROPOSITIONS,
];

/**
 * The agendas read: not those of a commune's site whose terms ask its authorisation, until it is given
 * (src/providers/autorisations.ts, `agenda:<id>`). One left out is not read, and its copies, already kept, are not served.
 */
export const AGENDAS: Agenda[] = LISIBLES.filter((a) => autorisee(`agenda:${a.id}`));

// The mairies' agendas credited by name: those read only, one left out until it agrees no longer named.
const mairiesLues = AGENDAS.filter((a) => a.source === SOURCES.mairies).map((a) => a.commune!);
const ofCommune = (c: string) => c.replace(/^Le /, "du ").replace(/^Les /, "des ").replace(/^(?!du |des )/, "de ");
const listed = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} et ${xs.at(-1)}` : xs.join(""));
SOURCES.mairies.nom = `Agendas des mairies ${listed(mairiesLues.map(ofCommune))}`;
SOURCES.mairies.attribution = `Villes de ${listed(mairiesLues)}`;

/**
 * The home pages some events link to instead of their own page (`accueil`): opened in a new window, as the terms of
 * Petite-Île's and Saint-Benoît's sites ask.
 */
export const ACCUEILS = new Set(LISIBLES.flatMap((a) => (a.accueil ? [a.accueil] : [])));

/**
 * The communes whose own agenda is read (the CINOR's for the North), or that have a hall whose programme is, besides
 * reunion.fr for the whole island.
 */
export const COVERED: string[] = [...new Set(AGENDAS.flatMap((a) => a.couvre ?? (a.commune ? [a.commune] : [])))];

/** Why a commune without any agenda read has none, when there is more to say than that. */
export const SANS_AGENDA: Record<string, string> = {
  "Saint-Pierre": "la page agenda de la mairie de Saint-Pierre est vide et le Kerveguen n'est pas encore lu",
};

/**
 * The communes' sports programmes in the agendas' last copy, for the sport tool: one read of the bundle, never a
 * source read for this. Each once, by its link.
 */
export async function programmesSportifs(cache: Pick<Cache, "bundle">): Promise<{ e: Evenement; agenda: Agenda; fetchedAt: Date }[]> {
  return programmesIn(await cache.bundle(BUNDLE, BUNDLE_SYNC_SECONDS));
}

/**
 * What the sport tool takes from the agendas' last copies, in one read of each bundle (two reads of one at once would
 * see it empty): the volley league's tournaments, the clubs' events (Sportsregions), and the communes' sports
 * programmes when `programmes`.
 */
export async function sportDesAgendas(cache: Pick<Cache, "bundle">, programmes: boolean) {
  const [bundle, planned] = await Promise.all([cache.bundle(BUNDLE, BUNDLE_SYNC_SECONDS), planifiees(cache)]);
  return {
    programmes: programmes ? programmesIn(bundle) : undefined,
    tournois: copiePlanifiee(planned, LIGUE_VOLLEY),
    clubs: copiePlanifiee(planned, SPORTSREGIONS),
    // Why either is not served, to be said.
    nonServies: { tournois: nonServie(planned, LIGUE_VOLLEY), clubs: nonServie(planned, SPORTSREGIONS) },
  };
}

function programmesIn(bundle: Pick<Bundle, "peek">): { e: Evenement; agenda: Agenda; fetchedAt: Date }[] {
  const seen = new Set<string>();
  return AGENDAS.flatMap((agenda) => {
    const hit = bundle.peek(`agenda:${agenda.id}`);
    // Each once by its own link, before it may be replaced by the site's home page.
    return servis(agenda, (hit ? (hit.value as Evenement[]) : []).filter((e) => programmeSportif(e) && !seen.has(e.lien) && seen.add(e.lien)))
      .map((e) => ({ e, agenda, fetchedAt: new Date(hit!.fetchedAt) }));
  });
}

/** The sources of the agendas read, each once. */
export const SOURCES_LUES: SourceInfo[] = [...new Set(AGENDAS.map((a) => a.source))];
