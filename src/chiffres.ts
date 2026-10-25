/**
 * rundata.re en chiffres: the page /chiffres and the block `chiffres` of sources_donnees count the same things, in
 * marketing's words (25 October 2026), validated by the user. Every figure is counted by the code, never written by
 * hand, and exact: what the code holds (the sources, their producers and licences, the tools, the lists bundled with
 * the site) at each view, at no cost; what only the sources know (stations read, trails closed, events to come, sites
 * that do not answer…) in one copy shared by every data center, `web:chiffres`, built by the scheduled event every hour
 * (web/partagees.ts). A count whose source does not answer keeps the copy before's, with its hour: it never drops to 0.
 *
 * Never counted here: the reads per day, the subrequests and the inner rates, which speak of our infrastructure, nor
 * how many people come; never a ranking of producers. The clubs of Sportsregions are counted, never named: the field is
 * typed freely by each club, and may carry a person's name.
 */
import type { Cache, Cached } from "./cache.js";
import { localTime } from "./geo.js";
import { INSEE } from "./places/insee.js";
import { normalize } from "./places/resolve.js";
import { AGENDAS, copiePlanifiee, planifiees, SOURCES_LUES, SPORTSREGIONS, type Evenement } from "./providers/agenda.js";
import { DAES } from "./providers/dae.js";
import { IDS as POINTS_DE_CHARGE, STATIONS as BORNES } from "./providers/irve.js";
import { GAUGES } from "./providers/maregraphes.js";
import * as onf from "./providers/sentiers.js";
import { SOURCES as SPORT_SOURCES } from "./providers/sport.js";
import { RANDONNEES } from "./providers/traces.js";
import * as transit from "./providers/transit.js";
import * as velos from "./providers/velos.js";
import { NOUVEAUTES } from "./nouveautes.js";
import { compte, FAMILLES, FICHES, producteursDe, type Famille } from "./producteurs.js";
import { etat, publiques } from "./sans-reponse.js";
import { agenda } from "./tools/agenda.js";
import { ahead, type CourantAnswer, followed } from "./tools/courant.js";
import { providers as weatherProviders } from "./tools/meteo.js";
import { type SourceInfo, why } from "./types.js";
import type { CoupuresAnswer } from "./web/data.js";
import { CATEGORIES } from "./web/categories.js";

export const PATH = "/chiffres";
export const LIEN = `https://rundata.re${PATH}`;
/** The copy shared by the page and sources_donnees (web/partagees.ts). */
export const KEY = "web:chiffres";
/** The events to come, the dearest count (the whole agenda): its own copy, every 6 hours. */
export const EVENEMENTS_KEY = "web:chiffres:evenements";

// --- The domains --------------------------------------------------------------------------------------------------

/**
 * Each category of the menu (web/categories.ts) and the sources it shows, by id, and how often its quickest source is
 * read again at most, in minutes: that source's cache (`de`, src/providers). None for a domain whose sources are lists
 * bundled with the site, read again at each version of it; `question` for one read at each question (an address). A rate
 * not known here (its source not read, without its key) is left out, never « — » (marketing).
 */
export interface Domaine {
  categorie: string;
  sources: () => string[];
  cadence?: { minutes: number; de: string };
  question?: true;
}

const ids = (...list: string[]) => () => list;
const DAY = 24 * 60;

export const DOMAINES: Domaine[] = [
  // Météo-France's packets are asked again every 2 minutes (providers/meteofrance.ts, RECHECK_SECONDS).
  { categorie: "meteo", sources: ids("meteofrance", "metar", "pioupiou", "mf_radar", "openmeteo", "arome", "openmeteo_ens", "cams_uv"), cadence: { minutes: 2, de: "meteofrance" } },
  // The floods with the vigilance: no category of their own; their levels every 5 minutes, as the vigilance.
  { categorie: "vigilance", sources: ids("mf_vigilance", "vigicrues"), cadence: { minutes: 5, de: "mf_vigilance" } },
  { categorie: "cyclones", sources: ids("gdacs_cyclones"), cadence: { minutes: 30, de: "gdacs_cyclones" } },
  // Written to D1 once a day (.github/workflows/climat.yml).
  { categorie: "historique", sources: ids("mf_climatologie", "mf_climatologie_horaire"), cadence: { minutes: DAY, de: "mf_climatologie" } },
  { categorie: "actualites", sources: ids("medias_locaux", "prefecture_communiques"), cadence: { minutes: 5, de: "medias_locaux" } },
  // The OVPF's earthquakes every 10 minutes (providers/seismes.ts).
  { categorie: "volcan", sources: ids("ipgp_ovpf_seismes", "ovpf_bluesky", "prefecture_communiques", "pitonlive"), cadence: { minutes: 10, de: "ipgp_ovpf_seismes" } },
  // The tide gauges every 5 minutes (providers/maregraphes.ts).
  { categorie: "mer", sources: ids("acspo", "modis", "openmeteo_houle", "refmar"), cadence: { minutes: 5, de: "refmar" } },
  // The buses' delays every minute (providers/gtfsrt.ts).
  { categorie: "bus", sources: ids("gtfs_reunion", "gtfs_rt_reunion"), cadence: { minutes: 1, de: "gtfs_rt_reunion" } },
  { categorie: "velos", sources: ids("altervelo"), cadence: { minutes: 1, de: "altervelo" } },
  // The workflow writes the charge points' states every 15 minutes (.github/workflows/irve.yml).
  { categorie: "bornes", sources: ids("irve"), cadence: { minutes: 15, de: "irve" } },
  { categorie: "coupures", sources: ids("avis_eau"), cadence: { minutes: 15, de: "avis_eau" } },
  { categorie: "dae", sources: ids("geodae") },
  { categorie: "secheresse", sources: ids("vigieau"), cadence: { minutes: 60, de: "vigieau" } },
  // The tap water every 6 hours (providers/eaupotable.ts, and the workflow of /eau); the shark decree is bundled.
  { categorie: "eau", sources: ids("eau_potable", "eaux_baignade", "risque_requin"), cadence: { minutes: 6 * 60, de: "eau_potable" } },
  { categorie: "sentiers", sources: ids("onf_sentiers", "osm_randonnees", "nasa_firms"), cadence: { minutes: 60, de: "onf_sentiers" } },
  // The Grand Raid's runners every 30 minutes (providers/sport.ts).
  { categorie: "sport", sources: () => Object.values(SPORT_SOURCES).map((s) => s.id), cadence: { minutes: 30, de: "livetrail" } },
  // Every agenda read (providers/agenda.ts), the scheduled ones every hour.
  { categorie: "agenda", sources: () => SOURCES_LUES.map((s) => s.id), cadence: { minutes: 60, de: "agenda_mairies" } },
  { categorie: "enfants", sources: ids("osm_enfants", "data_es", "basilic") },
  { categorie: "air", sources: ids("atmo_indice"), cadence: { minutes: 60, de: "atmo_indice" } },
  // EDF's mix every 4 minutes (providers/edf.ts).
  { categorie: "electricite", sources: ids("edf_sei_reunion", "mairies_edf"), cadence: { minutes: 4, de: "edf_sei_reunion" } },
  { categorie: "calendrier", sources: ids("education_calendrier", "jours_feries"), cadence: { minutes: DAY, de: "education_calendrier" } },
  // The TCO's dumps every 30 minutes (providers/tco.ts).
  { categorie: "services", sources: ids("annuaire_administration", "prefecture_carburants", "tco_decheteries", "tco_collecte", "finess", "ars_garde", "sante_fr_urgences", "osm_marches"), cadence: { minutes: 30, de: "tco_decheteries" } },
  { categorie: "terrain", sources: ids("ban_geocodage", "cadastre_apicarto", "gpu_zone_urba", "gpu_ppr", "georisques", "dvf_cerema", "dvf_etalab", "ign_altimetrie"), question: true },
];

/** Counted, never named here: pitonlive.com, an unofficial site, said only beside the official sources (marketing). */
const NON_NOMMES = new Set(["pitonlive"]);

/** « toutes les 5 min », « chaque heure », « toutes les 6 h », « chaque jour ». */
export function cadenceEnMots(minutes: number): string {
  if (minutes === 1) return "chaque minute";
  if (minutes < 60) return `toutes les ${minutes} min`;
  if (minutes === 60) return "chaque heure";
  if (minutes < DAY) return `toutes les ${minutes / 60} h`;
  return "chaque jour";
}

// --- The copy -----------------------------------------------------------------------------------------------------

/** A count, and when it was made (ISO): a count kept from the copy before says its own hour. */
export interface Compte {
  nombre: number;
  le: string;
}

/** What only the sources know, counted by the scheduled event every hour. */
export interface Copie {
  stations_meteo?: Compte;
  velos?: Compte;
  sentiers?: Compte & { fermes: number };
  coupures_eau?: Compte;
  coupures_electricite?: Compte;
  /** The public sites that do not answer, and the last daily recheck (seconds). */
  sans_reponse?: Compte & { passage?: number };
  evenements?: Compte;
  /** The clubs of Sportsregions that are not producers already: never their names. */
  clubs?: Compte;
  /** When this copy was built (ISO): a count of another hour was kept from the copy before, or from another copy. */
  construite_le?: string;
}

/** The events' copy; `sans`: the agendas that did not answer, when the list is in part or missing (never counted). */
export interface EvenementsCopie {
  nombre?: number;
  sans?: string[];
}

/** Every 6 hours; every hour while the last list was in part, rather than at every event of 5 minutes. */
export const evenementsEvery = (last: unknown) => ((last as EvenementsCopie | undefined)?.sans?.length ? 60 : 6 * 60);

// A weather observation older than this is not « read » (tools/meteo.ts says it old past the same).
const OBSERVATION_MS = 90 * 60_000;

/**
 * A name as a key, so that a body written two ways counts once: case, accents, punctuation and spaces aside, « St » and
 * « Ste » as « Saint » and « Sainte », and a « Ville », « Mairie » or « Commune » of X as the commune's canonical name.
 */
export function cle(nom: string): string {
  return normalize(nom).replace(/\bste\b/g, "sainte").replace(/\bst\b/g, "saint").replace(/^(?:ville|mairie) /, "commune ");
}

/** Every producer the code names, as keys: those of every entry of producteurs.ts. */
const clesProducteurs = () => new Set(Object.keys(FICHES).flatMap((id) => producteursDe({ id } as SourceInfo, AGENDAS)).map(cle));

/** The clubs named in Sportsregions' last copy that the code does not name already. A club never named does not count. */
export function clubs(evenements: Pick<Evenement, "organisateur">[], connus = clesProducteurs()): number {
  const noms = evenements.map((e) => e.organisateur?.nom ?? "").filter((n) => n && n !== "un club");
  return new Set(noms.map(cle).filter((k) => k && !connus.has(k))).size;
}

/** The stations whose observation is recent, in every weather source; undefined when a source failed or is stale. */
async function stationsMeteo(cache: Cache, now: Date): Promise<number | undefined> {
  const got = await Promise.all(weatherProviders().map((p) => p.observations(cache, now)));
  if (got.some((g) => g.stale)) return undefined;
  const recent = got.flatMap((g) => g.value).filter((o) => now.getTime() - o.time.getTime() <= OBSERVATION_MS);
  return new Set(recent.map((o) => `${o.station.source}:${o.station.id}`)).size || undefined;
}

/**
 * The events of the next two weeks on the whole island, as /evenements counts them. An agenda that does not answer
 * leaves the list in part: the copy says which, is never counted (the count before is kept with its hour), and is
 * tried again an hour later (`evenementsEvery`). Not written, it would be due again at every event.
 */
export async function buildEvenements(cache: Cache, now = new Date()): Promise<EvenementsCopie> {
  const r = await agenda(cache, undefined, undefined, undefined, now, 1);
  // No agenda answered: no list at all, tried again an hour later as well.
  if ("isError" in r && r.isError) return { sans: ["agenda"] };
  const a = JSON.parse(r.content[0].text) as { nombre: number; indisponible?: string[] };
  return { nombre: a.nombre, ...(a.indisponible?.length ? { sans: a.indisponible } : {}) };
}

/**
 * The copy: each count read again, or the copy before's when its read fails (with its hour). The water and power cuts
 * and the events are counted from their own shared copies, never read again here.
 */
export async function buildChiffres(cache: Cache, now = new Date()): Promise<Copie> {
  const before = (await cache.peek<Copie>(KEY).catch(() => undefined))?.value ?? {};
  const le = now.toISOString();
  const recompte = async <K extends keyof Copie>(key: K, read: () => Promise<Omit<NonNullable<Copie[K]>, "le"> | undefined>): Promise<Copie[K]> => {
    try {
      const v = await read();
      return v ? ({ ...v, le } as Copie[K]) : before[key];
    } catch (err) {
      console.error(`chiffres : ${key} non compté, la copie d'avant est gardée`, why(err));
      return before[key];
    }
  };
  // A shared copy as it is: its count, at its hour.
  const copie = async <T>(key: string, count: (v: T, at: Date) => number | undefined): Promise<Compte | undefined> => {
    const c = await cache.peek<T>(key).catch(() => undefined);
    const n = c && !c.stale ? count(c.value, c.fetchedAt) : undefined;
    return n === undefined ? undefined : { nombre: n, le: c!.fetchedAt.toISOString() };
  };
  const out: Copie = { construite_le: le };
  out.stations_meteo = await recompte("stations_meteo", async () => {
    const n = await stationsMeteo(cache, now);
    return n === undefined ? undefined : { nombre: n };
  });
  out.velos = await recompte("velos", async () => {
    const info = await velos.info(cache);
    return info.stale ? undefined : { nombre: info.value.length };
  });
  out.sentiers = await recompte("sentiers", async () => {
    const c = await onf.carte(cache);
    if (c.stale) return undefined;
    const noms = (s: onf.Sentier[]) => new Set(s.map((t) => t.nom)).size;
    return { nombre: noms(c.value.sentiers), fermes: noms(c.value.sentiers.filter((t) => t.statut === "fermé")) };
  });
  out.coupures_eau = (await copie<CoupuresAnswer>("web:coupures", (v) => v.avis.filter((a) => a.coupure?.etat !== "terminée").length)) ?? before.coupures_eau;
  out.coupures_electricite = (await copie<CourantAnswer>("web:courant", (v, at) => v.avis.filter((a) => followed(a.commune) && ahead(a, at)).length)) ?? before.coupures_electricite;
  out.sans_reponse = await recompte("sans_reponse", async () => {
    const e = await etat(cache);
    return { nombre: publiques(e.lignes).filter((l) => l.statut === "injoignable" || l.statut === "bloque").length, ...(e.passage ? { passage: e.passage } : {}) };
  });
  // Its own copy, every 6 hours, built before this one when both are due (web/partagees.ts).
  out.evenements = (await copie<EvenementsCopie>(EVENEMENTS_KEY, (v) => (v.sans?.length ? undefined : v.nombre))) ?? before.evenements;
  out.clubs = await recompte("clubs", async () => {
    const c = copiePlanifiee(await planifiees(cache), SPORTSREGIONS);
    return c ? { nombre: clubs(c.value) } : undefined;
  });
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Copie;
}

// --- What the page and the tool say -------------------------------------------------------------------------------

/** « 26/10 à 08:00 », heure de La Réunion. */
export const aLHeure = (d: Date) => localTime(d).replace(" ", " à ");

const nombre = (c: Compte | undefined) => (c ? { nombre: c.nombre, compte_le: aLHeure(new Date(c.le)) } : undefined);

/**
 * Everything counted, as sources_donnees gives it and the page shows it. `sources`: those read (server.ts,
 * toutesLesSources); `copie`: the last copy, or none yet (the counts of the sources are then left out, never 0);
 * `outils`: the tools the server registers.
 */
export function chiffres(sources: SourceInfo[], copie: Cached<Copie> | undefined, now: Date, outils: number) {
  const c = compte(sources);
  const k = copie?.value ?? {};
  const lues = new Set(sources.map((s) => s.id));
  const familles = (Object.keys(FAMILLES) as Famille[]).filter((f) => c.licences[f]);
  const par_domaine = DOMAINES.map((d) => {
    const cat = CATEGORIES.find((x) => x.key === d.categorie)!;
    const ici = sources.filter((s) => d.sources().includes(s.id) && FICHES[s.id] && !FICHES[s.id].horsCompte);
    return {
      domaine: cat.nom,
      sources: ici.length,
      producteurs: [...new Set(ici.filter((s) => !NON_NOMMES.has(s.id)).flatMap((s) => producteursDe(s)))].sort((a, b) => a.localeCompare(b, "fr")),
      ...(d.question ? { cadence: "à chaque question" } : !d.cadence ? { cadence: "à chaque version du site" } : lues.has(d.cadence.de) ? { cadence: cadenceEnMots(d.cadence.minutes) } : {}),
      ...(cat.path ? { page: cat.path } : {}),
    };
  }).filter((d) => d.sources);
  const sentiers = k.sentiers ? { ...nombre(k.sentiers)!, fermes: k.sentiers.fermes } : undefined;
  return {
    sources: c.sources,
    // The clubs' count comes with the copy: without it, the producers the code names.
    producteurs: c.producteurs.length + (k.clubs?.nombre ?? 0),
    licences: Object.fromEntries(familles.map((f) => [FAMILLES[f].nom, c.licences[f]])) as Record<string, number>,
    sous_licence_ouverte: c.ouvertes,
    /** The open families present, as the sentence of the licences names them. */
    licences_ouvertes: familles.filter((f) => FAMILLES[f].ouverte).map((f) => FAMILLES[f].nom),
    communes: Object.keys(INSEE).length,
    outils,
    par_domaine,
    terrain: {
      stations_meteo: nombre(k.stations_meteo),
      maregraphes: GAUGES.length,
      defibrillateurs: DAES.length,
      points_de_recharge: POINTS_DE_CHARGE.size,
      stations_de_recharge: BORNES.length,
      stations_de_velos: nombre(k.velos),
      ...(transit.enabled() ? { lignes_de_bus: transit.ROUTES.length, reseaux_de_bus: Object.keys(transit.NETWORKS).length } : {}),
      sentiers_onf: sentiers,
      randonnees_gps: RANDONNEES.length,
    },
    en_ce_moment: {
      evenements_deux_semaines: nombre(k.evenements),
      avis_coupure_eau: nombre(k.coupures_eau),
      avis_coupure_electricite: nombre(k.coupures_electricite),
    },
    manque: {
      sites_sans_reponse: k.sans_reponse ? { ...nombre(k.sans_reponse)!, ...(k.sans_reponse.passage ? { derniere_reverification: aLHeure(new Date(k.sans_reponse.passage * 1000)) } : {}) } : undefined,
    },
    nouveautes: NOUVEAUTES.length,
    // The build's hour, not the write's: a build that ends the minute after would mark every count as kept.
    compte_le: aLHeure(copie ? new Date(copie.value.construite_le ?? copie.fetchedAt) : now),
    lien: LIEN,
  };
}

export type Chiffres = ReturnType<typeof chiffres>;

const pluriel = (n: number, un: string, des: string) => `${n} ${n > 1 ? des : un}`;

/**
 * sources_donnees' summary, in marketing's words: « rundata.re lit 71 sources publiques, dont 52 sous licence
 * ouverte, de 48 producteurs\u00a0; 28 outils, une page du jour pour chacune des 24 communes\u00a0; 3 sites publics sans réponse en ce
 * moment (voir sites_sans_reponse). Compté le 26/10 à 08:00 : https://rundata.re/chiffres ».
 */
export function resume(c: Chiffres): string {
  const s = c.manque.sites_sans_reponse;
  const silence = !s ? "" : s.nombre
    ? `\u00a0; ${pluriel(s.nombre, "site public sans réponse", "sites publics sans réponse")} en ce moment (voir sites_sans_reponse)`
    : s.derniere_reverification ? `\u00a0; aucun site public sans réponse à la revérification du ${s.derniere_reverification.slice(0, 5)} (voir sites_sans_reponse)` : "";
  return `rundata.re lit ${c.sources} sources publiques, dont ${c.sous_licence_ouverte} sous licence ouverte, de ${c.producteurs} producteurs\u00a0; ` +
    `${c.outils} outils, une page du jour pour chacune des ${c.communes} communes${silence}. Compté le ${c.compte_le} : ${c.lien}`;
}
