/**
 * What the web pages show, taken from the same code as the MCP tools and kept as one shared cache entry per page.
 *
 * A page is served from its last copy, however old (its times say so), and refreshed in the background once that
 * copy is older than a few minutes: crawlers and refreshes never wait for upstream sources, and a page served from
 * cache costs at most one subrequest (the edge read). Only a page never built in this data center waits, a few
 * seconds at most, and is otherwise sent without its live block while the build goes on.
 */
import { left } from "../budget.js";
import { localTime } from "../geo.js";
import type { Cache, Cached } from "../cache.js";
import { INSEE } from "../places/insee.js";
import * as annuaire from "../providers/annuaire.js";
import * as rt from "../providers/gtfsrt.js";
import * as transit from "../providers/transit.js";
import * as velos from "../providers/velos.js";
import * as maregraphes from "../providers/maregraphes.js";
import * as mf from "../providers/vigilance.js";
import { qualiteAir } from "../tools/air.js";
import { calendrier } from "../tools/calendrier.js";
import { electricite } from "../tools/electricite.js";
import { BEACHES, seaTour, temperatureMer } from "../tools/mer.js";
import { gaugeRow, gauges } from "../tools/maree.js";
import { islandTour, meteoActuelle } from "../tools/meteo.js";
import { previsionMeteo } from "../tools/prevision.js";
import { named } from "../tools/annuaire.js";
import { alertsFor, applyRealtime, departureRow, departures, findStops, nearStops, realtimeFeeds, spread } from "../tools/transports.js";
import { cyclone, highest, raised } from "../tools/vigilance.js";
import { COMMUNES as BIKE_COMMUNES, velosLibreService } from "../tools/velos.js";
import { volcanSeismes } from "../tools/volcan.js";
import { type Observation, why } from "../types.js";
import { coastal, type PlacePage } from "./places.js";

export const FRESH_SECONDS = 5 * 60; // the stations publish every 6 minutes
const KEEP_SECONDS = 24 * 3600;
const WAIT_MS = 4000;
// Below this many subrequests left, a place page is built without its forecast rather than risk the limit.
const FORECAST_MIN_LEFT = 10;

export type Background = (work: Promise<unknown>) => void;

export interface StationNow {
  nom: string;
  source: string;
  lon: number;
  lat: number;
  altitude_m: number;
  /** ISO time of the measurement. */
  time: string;
  stale: boolean;
  temperature?: number;
  humidite?: number;
  vent?: number;
  /** Where the wind comes from, in degrees. */
  direction?: number;
  rafales?: number;
  pluie_6min?: number;
  pluie_1h?: number;
}

export interface SeaNow {
  nom: string;
  valeur: number;
  /** Day of the satellite pass, YYYY-MM-DD. */
  jour: string;
  distance_km: number;
}

export interface Credit {
  source: string;
  licence: string;
  attribution: string;
}

export interface HomeData {
  stations: StationNow[];
  mer: SeaNow[];
  sources: Credit[];
  indisponibles: string[];
}

/** The answers of the tools for one place, as they would reach a model (parsed). */
export interface PlaceData {
  meteo?: MeteoAnswer;
  mer?: MerAnswer;
  prevision?: PrevisionAnswer;
}

export interface StationAnswer {
  station: string;
  source: string;
  altitude_m: number;
  heure_mesure: string;
  age_min: number;
  mesures: Record<string, string>;
  avertissements: string[];
  distance_km?: number;
  direction?: string;
  pertinence?: string;
}

export interface MeteoAnswer {
  resume: string;
  stations: StationAnswer[];
  sources: Credit[];
}

export interface MerAnswer {
  resume: string;
  mesure?: { temperature_eau: string; jour_mesure: string; distance_km: number };
  sources: Credit[];
}

export interface PrevisionAnswer {
  resume: string;
  jours?: {
    jour: string;
    ciel_en_journee?: string;
    temperature_min?: string;
    temperature_max?: string;
    pluie?: string;
    rafales_max?: string;
  }[];
  modele?: { nom: string; maille_km: number; run_du_modele?: string };
  avertissements?: string[];
  sources: Credit[];
}

const num = (o: Observation, variable: string) => {
  const v = o.readings.find((r) => r.variable === variable)?.valeur;
  return typeof v === "number" ? v : undefined;
};

function stationNow(o: Observation, stale: boolean): StationNow {
  const s = o.station;
  return {
    nom: s.nom,
    source: s.source,
    lon: s.lon,
    lat: s.lat,
    altitude_m: s.altitude_m,
    time: o.time.toISOString(),
    stale,
    temperature: num(o, "temperature"),
    humidite: num(o, "humidite"),
    vent: num(o, "vent_moyen"),
    direction: num(o, "vent_direction"),
    rafales: num(o, "rafales"),
    pluie_6min: num(o, "pluie_6min"),
    pluie_1h: num(o, "pluie_1h"),
  };
}

const credit = (s: { nom: string; licence: string; attribution: string }): Credit => ({
  source: s.nom,
  licence: s.licence,
  attribution: s.attribution,
});

export async function buildHome(cache: Cache, now = new Date()): Promise<HomeData> {
  const [air, sea] = await Promise.allSettled([islandTour(cache, now), seaTour(cache, now)]);
  const out: HomeData = { stations: [], mer: [], sources: [], indisponibles: [] };
  if (air.status === "fulfilled") {
    out.stations = air.value.tour.map(({ o, stale }) => stationNow(o, stale));
    out.sources.push(...air.value.sources.map(credit));
    out.indisponibles.push(...air.value.down);
  } else console.error("page : tour de l'île indisponible", why(air.reason));
  if (sea.status === "fulfilled" && sea.value) {
    for (const { p, r } of sea.value.readings) {
      if (r) out.mer.push({ nom: p.nom, valeur: r.valeur, jour: r.mesure.jour_mesure, distance_km: r.mesure.distance_km });
    }
    out.sources.push(...sea.value.used.map((g) => credit(g.source)));
  } else out.indisponibles.push("Température de la mer par satellite");
  if (!out.stations.length && !out.mer.length) throw new Error("aucune donnée pour la page d'accueil");
  return out;
}

/** One spot of the coast on the page /mer; no value where the satellites saw nothing near it. */
export interface BeachNow {
  nom: string;
  commune: string;
  lon: number;
  lat: number;
  valeur?: number;
  jour?: string;
  distance_km?: number;
}

export interface SeaData {
  plages: BeachNow[];
  /** The two tide gauges; missing on a copy made before they were read. */
  maree?: ReturnType<typeof gaugeRow>[];
  sources: Credit[];
}

export async function buildSea(cache: Cache, now = new Date()): Promise<SeaData> {
  const [t, tide] = await Promise.all([seaTour(cache, now, BEACHES), gauges(cache, now)]);
  if (!t) throw new Error("aucune mesure satellite de la mer");
  const read = tide.some((g) => g.reading);
  return {
    plages: t.readings.map(({ p, r }) => ({
      nom: p.nom,
      commune: p.commune,
      lon: p.lon,
      lat: p.lat,
      ...(r ? { valeur: r.valeur, jour: r.mesure.jour_mesure, distance_km: r.mesure.distance_km } : {}),
    })),
    ...(read ? { maree: tide.map((g) => gaugeRow(g, now)) } : {}),
    sources: [...t.used.map((g) => credit(g.source)), ...(read ? [credit(maregraphes.SOURCE)] : [])],
  };
}

function answer<T>(r: { content: { text: string }[]; isError?: boolean }): T | undefined {
  return r.isError ? undefined : (JSON.parse(r.content[0].text) as T);
}

/** Measurements, then the sea, then the forecast, which sizes its downloads from the subrequests left. */
export async function buildPlace(cache: Cache, p: PlacePage, now = new Date()): Promise<PlaceData> {
  const out: PlaceData = {};
  out.meteo = answer<MeteoAnswer>(await meteoActuelle(cache, p.lieu, now));
  if (coastal(p)) out.mer = answer<MerAnswer>(await temperatureMer(cache, p.lieu, now));
  if (left() >= FORECAST_MIN_LEFT) {
    try {
      out.prevision = answer<PrevisionAnswer>(await previsionMeteo(cache, p.lieu, undefined, now));
    } catch (err) {
      console.error(`page ${p.slug} : prévision indisponible`, why(err));
    }
  }
  if (!out.meteo && !out.prevision) throw new Error(`aucune donnée pour ${p.nom}`);
  return out;
}

/** The answer of a tool, or an error when it has none: the page then keeps its last copy. */
function needed<T>(r: { content: { text: string }[]; isError?: boolean }, what: string): T {
  const a = answer<T>(r);
  if (!a) throw new Error(`aucune donnée pour la page ${what}`);
  return a;
}

export interface VolcanAnswer {
  resume: string;
  etat?: {
    eruption_en_cours: boolean;
    niveau_orsec: string;
    derniere_eruption_fin?: string;
    deformation?: string;
    acces_enclos?: { statut: string; detail?: string; source?: string; lien?: string };
  };
  publications_ovpf?: { date: string; texte: string; lien?: string }[];
  seismes?: {
    sous_le_volcan: { "30_jours": number; "7_jours": number; magnitude_max_30j: number | null };
    ailleurs_sur_l_ile: { "30_jours": number; magnitude_max_30j: number | null };
    derniers: { heure: string; magnitude: number; profondeur_km: number; lieu: string }[];
    note: string;
  };
  avertissements: string[];
  sources: Credit[];
}

export const buildVolcan = async (cache: Cache, now = new Date()) => needed<VolcanAnswer>(await volcanSeismes(cache, now), "volcan");

export interface AirAnswer {
  resume: string;
  communes?: { commune: string; niveau: number; qualite: string; polluants: string[] }[];
  nature: string;
  avertissements: string[];
  sources: Credit[];
}

export const buildAir = async (cache: Cache, now = new Date()) => needed<AirAnswer>(await qualiteAir(cache, undefined, now), "air");

export interface VeloStation {
  nom: string;
  commune: string;
  distance_m?: number;
  velos_electriques: number;
  trottinettes?: number;
  places_libres?: number;
  etat?: string;
  maj: string;
}

export interface VelosAnswer {
  resume: string;
  communes?: { commune: string; stations: number; velos_disponibles: number }[];
  stations: VeloStation[];
  service: string;
  donnees: string;
  sources: Credit[];
}

export const buildVelos = async (cache: Cache) => needed<VelosAnswer>(await velosLibreService(cache, undefined), "velos");

export interface ElectriciteAnswer {
  resume: string;
  production?: {
    heure: string;
    total_mw: number;
    parts: { filiere: string; mw: number; part_pct: number; renouvelable: boolean }[];
    renouvelable_pct: number;
    statut: string;
  };
  meteo_electricite?: {
    maintenant?: { signal: string; recharge_conseillee_pct?: number };
    periodes_de_tension: { quand: string; signal: string; recharge_conseillee_pct?: number }[];
    jusqu_au?: string;
    explication: string;
  };
  avertissements: string[];
  sources: Credit[];
}

export const buildElectricite = async (cache: Cache, now = new Date()) => needed<ElectriciteAnswer>(await electricite(cache, now), "électricité");

export interface CalendrierAnswer {
  resume: string;
  jours_feries?: { aujourd_hui: string | null; prochains: { date: string; nom: string; dans_jours: number }[]; note: string };
  vacances_scolaires?: {
    en_cours: { nom: string; debut: string; reprise_des_cours: string } | null;
    a_venir: { nom: string; debut: string; reprise_des_cours: string }[];
    note: string;
  };
  soleil?: { lieu: string; lever: string; coucher: string; duree_du_jour: string; note: string };
  sources: Credit[];
}

/** The tool says « indisponible » for a source that failed; with both down, the page keeps its last copy. */
export async function buildCalendrier(cache: Cache, now = new Date()): Promise<CalendrierAnswer> {
  const a = needed<Record<string, unknown>>(await calendrier(cache, undefined, now), "calendrier");
  const part = <T>(v: unknown) => (typeof v === "object" && v !== null ? (v as T) : undefined);
  const out = { ...a, jours_feries: part(a.jours_feries), vacances_scolaires: part(a.vacances_scolaires) } as CalendrierAnswer;
  if (!out.jours_feries && !out.vacances_scolaires) throw new Error("aucune donnée pour la page calendrier");
  return out;
}

/** The bus stations shown on the page /bus, as the tool finds them. */
export const GARES = [
  "gare routière Saint-Denis",
  "gare routière Saint-Pierre",
  "gare routière Saint-Paul",
  "gare routière du Tampon",
  "gare routière Saint-André",
  "gare routière Saint-Benoît",
  "gare routière Saint-Louis",
  "gare Saint-Joseph",
];

export interface GareNow {
  commune: string;
  /** The stop's name in each network that serves it. */
  arrets: { nom: string; reseau: string }[];
  departs: ReturnType<typeof departureRow>[];
}

export interface BusData {
  gares: GareNow[];
  reseaux: { nom: string; exploitant: string; lignes: number; valide_jusqu_au: string | null }[];
  /** The networks whose departures come with their real-time feed, and the time of the feed (« 20:56 »). */
  temps_reel?: { reseau: string; heure: string }[];
  /** Their traffic alerts in force. */
  alertes?: { reseau: string; titre: string; detail?: string }[];
  sources: Credit[];
}

/** The traffic alerts in force on these networks' feeds, each once. */
function allAlerts(feeds: Map<string, rt.Realtime>, now: Date) {
  const out: { reseau: string; titre: string; detail?: string }[] = [];
  for (const [net, f] of feeds) {
    for (const a of f.alerts) {
      if (rt.active(a, now.getTime() / 1000) && !out.some((x) => x.titre === a.titre)) out.push({ reseau: transit.NETWORKS[net].nom, titre: a.titre, detail: a.texte });
    }
  }
  return out;
}

const feedTimes = (feeds: Map<string, rt.Realtime>) =>
  [...feeds].map(([n, f]) => ({ reseau: transit.NETWORKS[n].nom, heure: localTime(new Date(f.at * 1000)).split(" ")[1] }));

/**
 * The networks, always; the next departures at the main bus stations where the timetables are at hand (the Worker),
 * with the real-time feeds when `cache` is given.
 */
export async function buildBus(now = new Date(), cache?: Cache): Promise<BusData> {
  const lines = new Map<string, number>();
  for (const [net] of transit.ROUTES) lines.set(net, (lines.get(net) ?? 0) + 1);
  const reseaux = Object.entries(transit.NETWORKS).map(([id, n]) => ({ nom: n.nom, exploitant: n.exploitant, lignes: lines.get(id) ?? 0, valide_jusqu_au: n.valide_jusqu_au }));
  const gares: GareNow[] = [];
  const feeds = cache && transit.enabled() ? await realtimeFeeds(rt.withRealtime(), cache, now) : new Map<string, rt.Realtime>();
  if (transit.enabled()) {
    for (const q of GARES) {
      const { groups } = findStops(q);
      if (!groups.length) continue;
      let list = await departures(groups, now);
      if (list.length < 3) list = await departures(groups, now, 20 * 3600);
      list = applyRealtime(list, feeds, now);
      gares.push({
        commune: groups[0].commune,
        arrets: groups.map((g) => ({ nom: g.nom, reseau: transit.NETWORKS[g.reseau]?.nom ?? g.reseau })),
        departs: spread(list, 8).map(departureRow),
      });
    }
  }
  // Only the networks whose departures shown come from their feed.
  const used = new Set(gares.flatMap((g) => g.departs.filter((d) => d.retard_min !== undefined || d.temps_reel).map((d) => d.reseau)));
  const times = feedTimes(feeds).filter((t) => used.has(t.reseau));
  const alertes = allAlerts(feeds, now);
  const live = { ...(times.length ? { temps_reel: times } : {}), ...(alertes.length ? { alertes } : {}) };
  return { gares, reseaux, ...live, sources: [credit(transit.SOURCE), ...(times.length || alertes.length ? [credit(rt.SOURCE)] : [])] };
}

/** What a commune's page adds to its weather: its town hall, and the next buses at its bus station or near its centre. */
export interface CommuneData {
  mairie?: annuaire.Office;
  bus?: {
    /** At the commune's bus station, or at the stops nearest its centre. */
    gare: boolean;
    arrets: { nom: string; reseau: string }[];
    departs: ReturnType<typeof departureRow>[];
    alertes?: { reseau: string; lignes?: string[]; titre: string; detail?: string }[];
  };
  /** The commune's Altervélo stations, those with bikes first (Saint-Pierre, Saint-Louis, L'Étang-Salé). */
  velos?: VeloStation[];
  sources: Credit[];
}

/**
 * The commune's bus station, when « gare <commune> » finds stops by that name (not Le Port's « Gare Maritime »);
 * otherwise the stops nearest its centre.
 */
export function communeStops(p: PlacePage): { gare: boolean; groups: transit.StopGroup[] } {
  const { groups, near } = findStops(`gare ${p.nom}`);
  if (!near.length && groups.length && groups.every((g) => /\bgare\b/i.test(g.nom) && !/maritime/i.test(g.nom))) return { gare: true, groups };
  return { gare: false, groups: nearStops(p.place.lon, p.place.lat).map((x) => x.g) };
}

/** The town hall itself, not the other offices of the commune that the search for « mairie » also finds. */
async function townHall(cache: Cache, p: PlacePage): Promise<annuaire.Office | undefined> {
  const list = (await annuaire.search(cache, "mairie", INSEE[p.nom])).value;
  return list.find((o) => /^Mairie - /.test(o.nom)) ?? named(list, "mairie")[0];
}

export async function buildCommune(cache: Cache, p: PlacePage, now = new Date()): Promise<CommuneData> {
  const out: CommuneData = { sources: [] };
  const [mairie, bus, bikes] = await Promise.allSettled([
    townHall(cache, p),
    (async () => {
      if (!transit.enabled()) return undefined;
      const { gare, groups } = communeStops(p);
      if (!groups.length) return undefined;
      let list = await departures(groups, now);
      if (list.length < 3) list = await departures(groups, now, 20 * 3600);
      const feeds = await realtimeFeeds(groups.map((g) => g.reseau), cache, now);
      const shown = spread(applyRealtime(list, feeds, now), 6);
      const alertes = alertsFor(groups, shown, feeds, now);
      return {
        gare,
        arrets: groups.map((g) => ({ nom: g.nom, reseau: transit.NETWORKS[g.reseau]?.nom ?? g.reseau })),
        departs: shown.map(departureRow),
        ...(alertes.length ? { alertes } : {}),
      };
    })(),
    BIKE_COMMUNES.includes(p.nom) ? velosLibreService(cache, p.nom, now).then((r) => answer<VelosAnswer>(r)?.stations) : Promise.resolve(undefined),
  ]);
  if (mairie.status === "fulfilled" && mairie.value) {
    out.mairie = mairie.value;
    out.sources.push(credit(annuaire.SOURCE));
  } else if (mairie.status === "rejected") console.error(`page ${p.slug} : mairie indisponible`, why(mairie.reason));
  if (bus.status === "fulfilled" && bus.value) {
    out.bus = bus.value;
    out.sources.push(credit(transit.SOURCE));
    if (bus.value.departs.some((d) => "retard_min" in d || "temps_reel" in d)) out.sources.push(credit(rt.SOURCE));
  } else if (bus.status === "rejected") console.error(`page ${p.slug} : bus indisponibles`, why(bus.reason));
  if (bikes.status === "fulfilled" && bikes.value?.length) {
    out.velos = bikes.value;
    out.sources.push(credit(velos.SOURCE));
  } else if (bikes.status === "rejected") console.error(`page ${p.slug} : vélos indisponibles`, why(bikes.reason));
  if (!out.mairie && !out.bus) throw new Error(`aucune donnée de commune pour ${p.nom}`);
  return out;
}

/** The banner of every page while a vigilance is above green: its worst colour and one sentence. */
export interface Alerte {
  couleur: number;
  texte: string;
}

export const BANNER_WAIT_MS = 1500;

export function alerteOf(v: mf.Vigilance, now: Date): Alerte | undefined {
  const periods = v.zones[mf.ISLAND]?.[mf.CYCLONE];
  if (periods && highest(periods) >= 2) return { couleur: highest(periods), texte: `Météo-France : ${cyclone(v, now)}` };
  const r = raised(v);
  if (!r.length) return undefined;
  const list = r.slice(0, 3).map((x) => `${x.couleur_max} ${x.phenomene.toLowerCase()} (${x.zone.split(" :")[0]})`);
  return { couleur: r[0].max, texte: `Vigilance Météo-France : ${list.join(", ")}${r.length > 3 ? "…" : ""}.` };
}

/**
 * Météo-France's vigilance, waited for at most `waitMs` (then left to finish in the background for the next page).
 * Null when the key is missing, the source fails with nothing in cache, or it is late.
 */
export async function vigilanceNow(cache: Cache, background: Background, waitMs: number): Promise<Cached<mf.Vigilance> | null> {
  if (!mf.enabled()) return null;
  const work = mf.vigilance(cache);
  try {
    const got = await within(work, waitMs);
    if (!got) background(work.catch(() => undefined));
    return got;
  } catch (err) {
    console.error(`source ${mf.SOURCE.id} indisponible:`, why(err));
    return null;
  }
}

/** The banner for a page: never throws, never holds a page more than a second and a half. */
export async function alerte(cache: Cache, background: Background, now = new Date()): Promise<Alerte | undefined> {
  const v = await vigilanceNow(cache, background, BANNER_WAIT_MS);
  return v ? alerteOf(v.value, now) : undefined;
}

/** `work`, or null if it takes longer than `ms`. */
async function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)));
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The last copy of a page's data and when it was built, refreshed in the background when older than
 * FRESH_SECONDS. Null when there is none yet and it takes more than a few seconds to build.
 *
 * `reader`: the fetcher of an AI assistant, which reads the page once and answers from it. It waits up to `waitMs`
 * for an old copy to be refreshed instead of getting it as it is.
 */
export async function snapshot<T>(
  cache: Cache,
  key: string,
  build: () => Promise<T>,
  background: Background,
  now = new Date(),
  waitMs = WAIT_MS,
  reader = false,
): Promise<Cached<T> | null> {
  const any = cache.get(key, KEEP_SECONDS, build);
  let got: Cached<T> | null;
  try {
    got = await within(any, waitMs);
  } catch (err) {
    console.error(`page ${key} : données indisponibles`, why(err));
    return null;
  }
  if (!got) {
    background(any.catch(() => undefined));
    return null;
  }
  if (now.getTime() - got.fetchedAt.getTime() > FRESH_SECONDS * 1000) {
    const fresh = cache.get(key, FRESH_SECONDS, build);
    const logged = fresh.catch((err) => console.error(`page ${key} : rafraîchissement impossible`, why(err)));
    if (reader) {
      const newer = await within(logged, waitMs);
      if (newer) return newer;
    }
    background(logged);
  }
  return got;
}
