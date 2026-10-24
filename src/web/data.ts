/**
 * What the web pages show, taken from the same code as the MCP tools and kept as one shared cache entry per page.
 *
 * A page is served from its last copy, however old (its times say so), and refreshed in the background once that
 * copy is older than a few minutes: crawlers and refreshes never wait for upstream sources, and a page served from
 * cache costs at most one subrequest (the edge read). Only a page never built in this data center waits, a few
 * seconds at most, and is otherwise sent without its live block while the build goes on.
 */
import { left, measured } from "../budget.js";
import { distanceKm, localTime } from "../geo.js";
import type { Cache, Cached } from "../cache.js";
import { INSEE } from "../places/insee.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import * as cal from "../providers/calendrier.js";
import * as annuaire from "../providers/annuaire.js";
import * as carburants from "../providers/carburants.js";
import * as rt from "../providers/gtfsrt.js";
import * as transit from "../providers/transit.js";
import * as irve from "../providers/irve.js";
import * as velos from "../providers/velos.js";
import * as maregraphes from "../providers/maregraphes.js";
import * as mf from "../providers/vigilance.js";
import { qualiteAir } from "../tools/air.js";
import { calendrier } from "../tools/calendrier.js";
import { electricite } from "../tools/electricite.js";
import * as houle from "../providers/houle.js";
import { BEACHES, seaTour, temperatureMer, waveLine, wavesNow } from "../tools/mer.js";
import { gaugeRow, gauges } from "../tools/maree.js";
import { islandTour, meteoActuelle } from "../tools/meteo.js";
import { previsionMeteo } from "../tools/prevision.js";
import { named } from "../tools/annuaire.js";
import { alertsFor, applyRealtime, departureRow, departures, findStops, nearStops, realtimeFeeds, spread } from "../tools/transports.js";
import { cyclone, highest, raised } from "../tools/vigilance.js";
import { COMMUNES as BIKE_COMMUNES, velosLibreService } from "../tools/velos.js";
import { bornesRecharge, count as countPoints, stationRow } from "../tools/bornes.js";
import { ile, type Ile } from "../eau/ile.js";
import * as baignadesSource from "../providers/baignades.js";
import * as eauPotableSource from "../providers/eaupotable.js";
import { COMMON as EAU_COMMON } from "../tools/eau.js";
import { credits } from "../tools/format.js";
import * as onf from "../providers/sentiers.js";
import { routeRow, secteur, SECTEURS, sentiersRandonnee, trailSecteur } from "../tools/sentiers.js";
import { pathOf } from "./map.js";
import { restrictionsEau } from "../tools/secheresse.js";
import * as daeSource from "../providers/dae.js";
import { access as daeAccess, byCommune as daeByCommune, daeRow, URGENCE as DAE_URGENCE } from "../tools/dae.js";
import { COVERED as CUT_COVERED, coupuresEau, type noticeRow } from "../tools/coupures.js";
import { volcanSeismes } from "../tools/volcan.js";
import * as sportSource from "../providers/sport.js";
import { grandRaidRow, sportTool, type SportRow } from "../tools/sport.js";
import * as gdacs from "../providers/cyclones.js";
import { cyclones, type activeRow, type seasonRow } from "../tools/cyclones.js";
import { historiqueMeteo } from "../tools/historique.js";
import { agenda, type EventRow } from "../tools/agenda.js";
import * as actuSource from "../providers/actualites.js";
import { A_SAVOIR as ACTU_A_SAVOIR, COUVERTURE as ACTU_COUVERTURE, infoRow, quand as newsTime, type InfoRow } from "../tools/actualites.js";
import { type Observation, why } from "../types.js";
import * as traces from "../providers/traces.js";
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
  etat_de_la_mer?: { maintenant: { heures: string; hauteur: string; periode?: string; venant?: string }; jours: { jour: string; hauteur_max: string }[] };
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
    indice_uv_max?: string;
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
  /** The waves FORECAST near the beach; missing on a copy made before they were read. */
  houle?: { hauteur_m: number; maintenant: string; heure: string; max: string; max_jour: string };
}

export interface SeaData {
  plages: BeachNow[];
  /** The two tide gauges; missing on a copy made before they were read. */
  maree?: ReturnType<typeof gaugeRow>[];
  sources: Credit[];
}

export async function buildSea(cache: Cache, now = new Date()): Promise<SeaData> {
  const [t, tide, w] = await Promise.all([seaTour(cache, now, BEACHES), gauges(cache, now), wavesNow(cache)]);
  if (!t && !w) throw new Error("ni mesure satellite de la mer, ni prévision des vagues");
  const read = tide.some((g) => g.reading);
  return {
    plages: BEACHES.map((n, i) => {
      const p = resolvePlace(n)!.lieu;
      const r = t?.readings[i].r;
      const l = w ? waveLine(w.value, p.lon, p.lat, now) : null;
      return {
        nom: p.nom,
        commune: p.commune,
        lon: p.lon,
        lat: p.lat,
        ...(r ? { valeur: r.valeur, jour: r.mesure.jour_mesure, distance_km: r.mesure.distance_km } : {}),
        ...(l ? { houle: { hauteur_m: l.hauteur_m, maintenant: l.maintenant, heure: l.heure, max: l.max, max_jour: l.max_jour } } : {}),
      };
    }),
    ...(read ? { maree: tide.map((g) => gaugeRow(g, now)) } : {}),
    sources: [...(t?.used.map((g) => credit(g.source)) ?? []), ...(w ? [credit(houle.SOURCE)] : []), ...(read ? [credit(maregraphes.SOURCE)] : [])],
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
    eruption?: { name?: string; started_at?: string; public_summary?: string };
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

export type BorneStation = ReturnType<typeof stationRow> & { lon: number; lat: number; libres: number; total: number };

export interface BornesAnswer {
  resume: string;
  communes: { commune: string; stations: number; points: number; libres?: number }[];
  recharge_rapide: ReturnType<typeof stationRow>[];
  /** Every station of the island, for the page (not in the tool's answer). */
  stations: BorneStation[];
  recharge: string;
  donnees: string;
  avertissement?: string;
  sources: Credit[];
}

/** The tool's overview, plus every station; without the live state the page keeps its last copy. */
export async function buildBornes(cache: Cache, now = new Date()): Promise<BornesAnswer> {
  const a = needed<Omit<BornesAnswer, "stations">>(await bornesRecharge(cache, undefined, false, now), "bornes");
  if (a.communes.every((c) => c.libres == null)) throw new Error("état des bornes indisponible");
  const live = (await irve.live(cache)).value;
  const stations = irve.STATIONS.map((s) => {
    const c = countPoints([s], live);
    return { ...stationRow(s, live, now, undefined, false), lon: s.lon, lat: s.lat, libres: c.libres, total: c.total };
  });
  return { ...a, stations };
}

export type EauAnswer = Ile & { a_savoir: typeof EAU_COMMON; sources: Credit[] };

/** The bathing sites and the tap water of every commune, gathered by the workflow (src/eau/ile.ts). */
export async function buildEau(cache: Cache, now = new Date()): Promise<EauAnswer> {
  const { value } = await ile(cache, now);
  return { ...value, a_savoir: EAU_COMMON, sources: credits([eauPotableSource.SOURCE, baignadesSource.SOURCE]) };
}

export interface SentiersAnswer {
  resume: string;
  fermes_par_commune: { commune: string; sentiers_fermes: { sentier: string; cause?: string; precision?: string; longueur_km?: number; page?: string; randonnees?: { nom: string; slug: string }[] }[] }[];
  routes_forestieres_fermees: { route: string; circulation: string; cause?: string; precision?: string }[];
  carte_mise_a_jour?: string;
  a_savoir: string[];
  sources: Credit[];
  /** The middle of each closed trail, for the map (not in the tool's answer). */
  points: { nom: string; lon: number; lat: number }[];
  /** How many trails the ONF follows, open or not. */
  suivis: number;
  /** The hikes with a GPS trace, from the bundle. */
  randonnees: { nom: string; slug: string; km: number; dplus: number; boucle: boolean }[];
}

/** The tool's overview of the island, plus where each closed trail is. */
export async function buildSentiers(cache: Cache, now = new Date()): Promise<SentiersAnswer> {
  const a = needed<Omit<SentiersAnswer, "points" | "suivis" | "randonnees">>(await sentiersRandonnee(cache, undefined, now), "sentiers");
  const carte = (await onf.carte(cache)).value;
  const points = carte.sentiers
    .filter((t) => t.statut === "fermé" && t.points.length)
    .map((t) => {
      const [lon, lat] = t.points[Math.floor(t.points.length / 2)];
      return { nom: t.nom, lon, lat };
    });
  const randonnees = [...traces.RANDONNEES]
    .sort((x, y) => x.nom.localeCompare(y.nom, "fr"))
    .map((r) => ({ nom: r.nom, slug: r.slug, km: r.km, dplus: r.dplus, boucle: r.boucle }));
  // Each closed trail with the hikes it cuts.
  const fermes_par_commune = a.fermes_par_commune.map((c) => ({ ...c, sentiers_fermes: c.sentiers_fermes.map((t) => ({ ...t, randonnees: hikesThrough(t.sentier) })) }));
  return { ...a, fermes_par_commune, points, suivis: new Set(carte.sentiers.map((t) => t.nom)).size, randonnees };
}

/** The hikes that follow an ONF trail, by its name. */
export const hikesThrough = (nom: string) => traces.RANDONNEES.filter((r) => r.sentiers_onf.includes(nom)).map((r) => ({ nom: r.nom, slug: r.slug }));

// ---------------------------------------------------------------- the hikers' page: every hike and trail, filterable

type Etat = "ouvert" | "fermé" | "inconnu";
const etatOf = (s: onf.Statut): Etat => (s === "ouvert" || s === "fermé" ? s : "inconnu");

export interface HikeCard {
  /** Its key on the map and in the filter. */
  k: string;
  nom: string;
  slug: string;
  km: number;
  dplus: number;
  dmoins: number;
  alt_max?: number;
  boucle: boolean;
  secteur: string;
  /** Its ONF trails closed now, with why and until when. */
  fermes: { sentier: string; slug?: string; cause?: string; precision?: string }[];
  /** Its ONF trails outside the ONF's management: state unknown. */
  inconnus: string[];
  /** How many ONF trails it follows. */
  onf: number;
}

export interface TrailItem {
  k: string;
  nom: string;
  slug?: string;
  commune: string;
  km: number;
  dplus?: number;
  etat: Etat;
  /** Closed in part only: some of its pieces are open. */
  partiel?: boolean;
  cause?: string;
  precision?: string;
  boucle: boolean;
  randonnees: { nom: string; slug: string }[];
}

export interface RandonneesAnswer {
  randonnees: HikeCard[];
  secteurs: { secteur: string; communes: string[]; sentiers: TrailItem[] }[];
  /** The map's lines, already projected: the hikes, and each piece of an ONF trail with its state. */
  lignes: { k: string; genre: "randonnee" | "sentier"; etat: Etat | ""; d: string; href: string; nom: string }[];
  fermes: number;
  suivis: number;
  carte_mise_a_jour?: string;
  sources: Credit[];
}

const LOOP_M = 150;
const CROSSING_KM = 40;

/** Every hike with its trace and every ONF trail, with their state now and where they are; and the island's map of them. */
export async function buildRandonnees(cache: Cache): Promise<RandonneesAnswer> {
  const carte = (await onf.carte(cache)).value;
  const byName = new Map<string, onf.Sentier[]>();
  for (const s of carte.sentiers) byName.set(s.nom, [...(byName.get(s.nom) ?? []), s]);

  const routes = [...traces.RANDONNEES].sort((x, y) => x.nom.localeCompare(y.nom, "fr"));
  const randonnees: HikeCard[] = routes.map((r, i) => {
    const row = routeRow(r, carte);
    const longest = traces.decode([...r.lignes].sort((a, b) => b.length - a.length)[0] ?? "");
    const middle = longest[Math.floor(longest.length / 2)];
    return {
      k: `r${i}`,
      nom: r.nom,
      slug: r.slug,
      km: r.km,
      dplus: r.dplus,
      dmoins: r.dmoins,
      alt_max: r.alt_max,
      boucle: r.boucle,
      // Computed with the traces; a crossing of the island has no one sector.
      secteur: r.secteur ?? (r.secteurs && r.secteurs.length > 1 ? "plusieurs secteurs" : r.km >= CROSSING_KM ? "plusieurs secteurs" : middle ? secteur(...middle).secteur : ""),
      fermes: (row.troncons_onf ?? []).filter((t) => t.etat === "fermé").map((t) => ({ sentier: t.sentier, slug: traces.SENTIERS[t.sentier]?.slug, cause: t.cause, precision: t.precision })),
      inconnus: (row.troncons_onf ?? []).filter((t) => t.etat !== "fermé" && t.etat !== "ouvert").map((t) => t.sentier),
      onf: r.sentiers_onf.length,
    };
  });

  const names = [...byName.keys()].sort((x, y) => x.localeCompare(y, "fr"));
  const items: (TrailItem & { secteur: string })[] = names.map((nom, i) => {
    const parts = byName.get(nom)!;
    const shut = parts.find((x) => x.statut === "fermé");
    const open = parts.some((x) => x.statut === "ouvert");
    const at = parts.find((x) => x.points.length);
    const mid = at?.points[Math.floor(at.points.length / 2)];
    const where = { secteur: trailSecteur(nom, mid) ?? "Hauts de l'Ouest", commune: mid ? secteur(...mid).commune : "" };
    const stats = traces.SENTIERS[nom];
    const one = parts.length === 1 && parts[0].points.length > 2 ? parts[0].points : undefined;
    return {
      k: `s${i}`,
      nom,
      slug: stats?.slug,
      commune: where.commune,
      secteur: where.secteur,
      km: stats?.km ?? Math.round(parts.reduce((t, x) => t + x.longueur_km, 0) * 10) / 10,
      dplus: stats?.dplus,
      etat: shut ? "fermé" : open ? "ouvert" : "inconnu",
      ...(shut && open ? { partiel: true } : {}),
      cause: shut?.cause,
      precision: shut?.info,
      boucle: !!one && distanceKm(...one[0], ...one[one.length - 1]) * 1000 < LOOP_M,
      randonnees: hikesThrough(nom),
    };
  });
  const secteurs = SECTEURS.map((z) => {
    const list = items.filter((t) => t.secteur === z.nom);
    return { secteur: z.nom, communes: [...new Set(list.map((t) => t.commune))].sort((x, y) => x.localeCompare(y, "fr")), sentiers: list.map(({ secteur: _, ...t }) => t) };
  }).filter((z) => z.sentiers.length);

  const key = new Map(items.map((t) => [t.nom, t]));
  const lignes: RandonneesAnswer["lignes"] = [
    ...randonnees.map((h, i) => ({ k: h.k, genre: "randonnee" as const, etat: "" as const, d: routes[i].lignes.map((l) => pathOf(traces.decode(l))).join(""), href: `/randonnees/${h.slug}`, nom: h.nom })),
    ...carte.sentiers.filter((x) => x.points.length > 1).map((x) => {
      const t = key.get(x.nom)!;
      return { k: t.k, genre: "sentier" as const, etat: etatOf(x.statut), d: pathOf(x.points), href: t.slug ? `/sentiers/${t.slug}` : "/sentiers", nom: x.nom };
    }),
  ].filter((l) => l.d);
  return {
    randonnees,
    secteurs,
    lignes,
    fermes: items.filter((t) => t.etat === "fermé").length,
    suivis: items.length,
    carte_mise_a_jour: carte.mise_a_jour,
    sources: credits([traces.SOURCES.osm, onf.SOURCE, traces.SOURCES.ign]),
  };
}

// ---------------------------------------------------------------- a trail's or a hike's page

const PROFILE_MAX = 400;

/** The altitude every so often along the pieces, end to end, for the profile: a few hundred points at most. */
export function profileOf(pieces: traces.Point[][]): { km: number; ele: number }[] {
  const out: { km: number; ele: number }[] = [];
  let km = 0;
  for (const p of pieces) {
    for (let i = 0; i < p.length; i++) {
      if (i) km += distanceKm(p[i - 1].lon, p[i - 1].lat, p[i].lon, p[i].lat);
      if (p[i].ele != null) out.push({ km: Math.round(km * 1000) / 1000, ele: p[i].ele! });
    }
  }
  const every = Math.ceil(out.length / PROFILE_MAX);
  return out.filter((_, i) => i % every === 0 || i === out.length - 1);
}

const ETAT_CLASS: Record<string, string> = { ouvert: "ouvert", fermé: "ferme" };
const lineOf = (points: traces.Point[], etat: string) => ({ etat: ETAT_CLASS[etat] ?? "inconnu", points: points.map((x) => [x.lon, x.lat] as [number, number]) });

export interface TraceAnswer {
  nom: string;
  slug: string;
  /** « sentier » for an ONF trail, « randonnee » for a hike of OpenStreetMap. */
  genre: "sentier" | "randonnee";
  km: number;
  dplus?: number;
  dmoins?: number;
  alt_min?: number;
  alt_max?: number;
  boucle?: boolean;
  /** The state, in a sentence. */
  etat: string;
  ferme: boolean;
  troncons: { sentier?: string; etat: string; cause?: string; precision?: string; page?: string }[];
  lignes: ReturnType<typeof lineOf>[];
  profil: { km: number; ele: number }[];
  /** The other trace: the hikes an ONF trail is part of, or nothing. */
  randonnees: { nom: string; slug: string }[];
  /** A hike's ONF trails closed now, and those whose state is not known. */
  fermes: { sentier: string; cause?: string; precision?: string; page?: string }[];
  inconnus: { sentier: string; page?: string }[];
  sources: Credit[];
}

/** An ONF trail: its line and state read from the ONF, its altitudes from the IGN. */
export async function buildTrail(cache: Cache, t: { nom: string } & traces.SentierStats): Promise<TraceAnswer> {
  const tr = (await traces.traceOnf(cache, t)).value;
  const pieces = tr.troncons.map((x) => x.points);
  const m = traces.measure(pieces);
  const shut = tr.troncons.filter((x) => x.statut === "fermé");
  const open = tr.troncons.some((x) => x.statut === "ouvert");
  const states = [...new Map(tr.troncons.map((x) => [`${x.statut}|${x.cause ?? ""}`, { etat: x.statut, cause: x.cause, precision: x.info }])).values()];
  return {
    nom: t.nom,
    slug: t.slug,
    genre: "sentier",
    km: t.km || m.km,
    dplus: t.dplus ?? m.dplus,
    dmoins: t.dmoins ?? m.dmoins,
    alt_min: t.alt_min ?? m.alt_min,
    alt_max: t.alt_max ?? m.alt_max,
    etat: shut.length
      ? `Fermé${shut[0].cause ? ` : ${shut[0].cause}` : ""}${shut[0].info ? ` (${shut[0].info})` : ""}${open ? ", en partie" : ""}`
      : open ? "Ouvert d'après l'ONF" : "Hors gestion ONF : état non connu",
    ferme: shut.length > 0,
    troncons: states,
    lignes: tr.troncons.map((x) => lineOf(x.points, x.statut)),
    profil: profileOf(pieces),
    randonnees: hikesThrough(t.nom),
    fermes: [],
    inconnus: [],
    sources: credits([onf.SOURCE, traces.SOURCES.ign]),
  };
}

/** A hike of OpenStreetMap, from the bundle; the state of the ONF trails it follows, live. */
export async function buildRoute(cache: Cache, r: traces.Randonnee): Promise<TraceAnswer> {
  const carte = await onf.carte(cache).then((c) => c.value).catch(() => null);
  const row = carte ? routeRow(r, carte) : null;
  const pieces = traces.routePieces(r);
  const slugOf = (nom: string) => traces.SENTIERS[nom]?.slug;
  const troncons = (row?.troncons_onf ?? r.sentiers_onf.map((sentier) => ({ sentier, etat: "inconnu" as const, cause: undefined, precision: undefined })))
    .map((x) => ({ sentier: x.sentier, etat: x.etat as string, cause: x.cause, precision: x.precision, page: slugOf(x.sentier) && `/sentiers/${slugOf(x.sentier)}` }));
  const fermes = troncons.filter((x) => x.etat === "fermé");
  return {
    nom: r.nom,
    slug: r.slug,
    genre: "randonnee",
    km: r.km,
    dplus: r.dplus,
    dmoins: r.dmoins,
    alt_min: r.alt_min,
    alt_max: r.alt_max,
    boucle: r.boucle,
    etat: row ? row.etat.charAt(0).toUpperCase() + row.etat.slice(1) : "État des sentiers de l'ONF indisponible pour le moment",
    ferme: !!row?.troncons_onf?.some((x) => x.etat === "fermé"),
    troncons,
    // The hike in one colour, its stretches on a closed trail over it in red.
    lignes: [
      ...pieces.map((p) => ({ etat: "", points: p.map((x) => [x.lon, x.lat] as [number, number]) })),
      ...fermes.flatMap((f) => traces.portionsOf(r, f.sentier, pieces).map((p) => lineOf(p, "fermé"))),
    ],
    profil: profileOf(pieces),
    randonnees: [],
    fermes: fermes.map(({ sentier, cause, precision, page }) => ({ sentier, cause, precision, page })),
    inconnus: troncons.filter((x) => x.etat !== "fermé" && x.etat !== "ouvert").map(({ sentier, page }) => ({ sentier: sentier!, page })),
    sources: credits([traces.SOURCES.osm, onf.SOURCE, traces.SOURCES.ign]),
  };
}

const stamp = (now: Date) => {
  const l = new Date(now.getTime() + 4 * 3600_000).toISOString();
  return `${l.slice(8, 10)}/${l.slice(5, 7)}/${l.slice(0, 4)} à ${l.slice(11, 16)}`;
};
const figures = (x: { km: number; dplus?: number; dmoins?: number }) =>
  `${String(x.km).replace(".", ",")} km${x.dplus != null ? `, dénivelé +${x.dplus} m / -${x.dmoins ?? 0} m` : ""}`;

/** An ONF trail's GPX: its state when downloaded in the description, the ONF as author. */
export async function trailGpx(cache: Cache, origin: string, t: { nom: string } & traces.SentierStats, now = new Date()): Promise<string> {
  const tr = (await traces.traceOnf(cache, t)).value;
  const shut = tr.troncons.filter((x) => x.statut === "fermé");
  const etat = shut.length
    ? `FERMÉ${shut[0].cause ? ` (${shut[0].cause})` : ""}${shut[0].info ? `, ${shut[0].info}` : ""}`
    : tr.troncons.some((x) => x.statut === "ouvert") ? "ouvert" : "hors gestion ONF, état non connu";
  return traces.gpx({
    nom: t.nom,
    description: `${t.nom}, sentier de l'ONF à La Réunion : ${figures(t)}. État d'après la carte de l'ONF le ${stamp(now)} : ${etat}. ` +
      "Trace : ONF La Réunion. Altitudes : IGN, RGE ALTI (Licence Ouverte). Un sentier fermé est interdit ; vérifier son état et la vigilance météo avant de partir.",
    page: `${origin}/sentiers/${t.slug}`,
    auteur: "ONF La Réunion",
    pieces: tr.troncons.map((x) => x.points),
    waypoints: shut.map((x) => closedPoint(t.nom, x.cause, x.info, x.points[0])),
    now,
  });
}

/** Where a closed trail starts, as a GPX waypoint: its name says it in the hiker's GPS app. */
function closedPoint(nom: string, cause: string | undefined, info: string | undefined, at: traces.Point): traces.Waypoint {
  return {
    lon: at.lon,
    lat: at.lat,
    ele: at.ele,
    nom: `FERMÉ : ${nom}${cause ? ` – ${cause}` : ""}`,
    description: `Sentier fermé d'après la carte de l'ONF${cause ? ` : ${cause}` : ""}${info ? ` (${info})` : ""}. S'y engager est interdit.`,
  };
}

/** Where the hike enters one of its ONF trails: its first stretch along it, or else its point nearest that trail. */
function entry(r: traces.Randonnee, pieces: traces.Point[][], nom: string, carte: onf.Carte): traces.Point | undefined {
  const first = traces.portionsOf(r, nom, pieces)[0]?.[0];
  if (first) return first;
  const line = carte.sentiers.filter((s) => s.nom === nom).flatMap((s) => s.points);
  let best: traces.Point | undefined;
  let min = Infinity;
  for (const p of pieces.flat()) {
    for (const [lon, lat] of line) {
      const d = distanceKm(p.lon, p.lat, lon, lat);
      if (d < min) [best, min] = [p, d];
    }
  }
  return best;
}

/** A hike's GPX, from the bundle: OpenStreetMap as author (ODbL), the ONF trails' state when downloaded, a waypoint where each closed one starts. */
export async function routeGpx(cache: Cache, origin: string, r: traces.Randonnee, now = new Date()): Promise<string> {
  const carte = await onf.carte(cache).then((c) => c.value).catch(() => null);
  const row = carte ? routeRow(r, carte) : null;
  const etat = row ? row.etat : "état des sentiers de l'ONF indisponible au téléchargement";
  const pieces = traces.routePieces(r);
  const waypoints = (row?.troncons_onf ?? []).filter((t) => t.etat === "fermé").flatMap((t) => {
    const at = entry(r, pieces, t.sentier, carte!);
    return at ? [closedPoint(t.sentier, t.cause, t.precision, at)] : [];
  });
  return traces.gpx({
    nom: r.nom,
    description: `${r.nom}, itinéraire de randonnée à La Réunion : ${figures(r)}${r.boucle ? ", en boucle" : ""}. Sentiers de l'ONF le ${stamp(now)} : ${etat}. ` +
      "Itinéraire © les contributeurs d'OpenStreetMap (ODbL). Altitudes : IGN, RGE ALTI (Licence Ouverte). Un sentier fermé est interdit ; vérifier son état et la vigilance météo avant de partir.",
    page: `${origin}/randonnees/${r.slug}`,
    auteur: "© les contributeurs d'OpenStreetMap",
    licence: "https://opendatacommons.org/licenses/odbl/1-0/",
    pieces,
    waypoints,
    now,
  });
}

export interface SecheresseAnswer {
  resume: string;
  communes: { commune: string; eau_du_robinet?: string; rivieres_et_sources?: string; nappes?: string }[];
  arrete_du?: string;
  echelle: string;
  a_savoir: string;
  sources: Credit[];
  /** What a private person may not do at each level of the tap water, from one commune at that level. */
  interdits: { niveau: string; communes: string[]; restrictions: { usage: string; restriction: string }[] }[];
}

/** The island's overview, plus what each level forbids to a private person. */
export async function buildSecheresse(cache: Cache, now = new Date()): Promise<SecheresseAnswer> {
  void now;
  const a = needed<Omit<SecheresseAnswer, "interdits">>(await restrictionsEau(cache, undefined), "sécheresse");
  const levels = [...new Set(a.communes.map((c) => c.eau_du_robinet).filter((x): x is string => !!x))];
  const interdits = [];
  for (const niveau of levels) {
    const communes = a.communes.filter((c) => c.eau_du_robinet === niveau).map((c) => c.commune);
    const one = needed<{ restrictions_eau_du_robinet?: { usage: string; restriction: string }[] }>(await restrictionsEau(cache, communes[0]), "sécheresse");
    interdits.push({ niveau, communes, restrictions: one.restrictions_eau_du_robinet ?? [] });
  }
  return { ...a, interdits };
}

export interface CoupuresAnswer {
  resume: string;
  ne_pas_boire?: string[];
  avis: ReturnType<typeof noticeRow>[];
  couverture: string;
  a_savoir: string;
  sources: Credit[];
  communes_suivies: string[];
}

export async function buildCoupures(cache: Cache, now = new Date()): Promise<CoupuresAnswer> {
  const a = needed<Omit<CoupuresAnswer, "communes_suivies">>(await coupuresEau(cache, undefined, now), "coupures");
  return { ...a, communes_suivies: CUT_COVERED };
}

export interface SportAnswer {
  resume: string;
  a_venir?: SportRow[];
  resultats?: SportRow[];
  actualite?: { titre: string; publie_le: string; lien: string }[];
  indisponible?: string[];
  non_couvert: string;
  sources: Credit[];
  classements: { competition: string; lignes: sportSource.Rang[]; lien: string }[];
  grand_raid?: ReturnType<typeof grandRaidRow>;
}

/** The tool's answer for the whole island, with the standings and the last Grand Raid, which it gives only when asked. */
export async function buildSport(cache: Cache, now = new Date()): Promise<SportAnswer> {
  const a = needed<Omit<SportAnswer, "classements" | "grand_raid">>(await sportTool(cache, undefined, undefined, undefined, now), "sport");
  const [hb, vb, gr] = await Promise.all([
    sportSource.championnats(cache, "handball").catch(() => undefined),
    sportSource.championnats(cache, "volley").catch(() => undefined),
    sportSource.grandRaid(cache, now).catch(() => undefined),
  ]);
  const classements = [...(hb?.value ?? []), ...(vb?.value ?? [])].map((c) => ({
    competition: `${c.sport === "handball" ? "Handball" : "Volley-ball"}, ${c.nom}`,
    lignes: c.classement,
    lien: c.lien,
  }));
  return { ...a, classements, grand_raid: gr ? grandRaidRow(gr.value) : undefined };
}

export interface CyclonesAnswer {
  resume: string;
  alerte_cyclonique?: string;
  systemes_actifs?: Omit<ReturnType<typeof activeRow>, "trajectoire">[];
  saison_en_cours: { nom: string; systemes: ReturnType<typeof seasonRow>[] };
  saison_precedente?: { nom: string; systemes: ReturnType<typeof seasonRow>[] };
  a_savoir: string;
  phases_alerte: string;
  saison: string;
  consulter: Record<string, string>;
  sources: Credit[];
  /** The tracks to draw: the active systems', or the last system's when none is active. */
  traces: { nom: string; observee: [number, number][]; prevue: [number, number][]; etiquette: string; actif: boolean }[];
}

/** The tool's answer for the island, with the tracks it leaves out of its text. */
/** The last 30 days at six stations, one per climate of the island, against their normal. */
export interface HistoriqueAnswer {
  resume: string;
  periode: { du: string; au: string; jours: number };
  stations: {
    zone: string;
    station: string;
    altitude_m: number;
    lon: number;
    lat: number;
    pluie?: { total_mm: number; jours_de_pluie: number; normale_mm?: number; rapport_a_la_normale?: string; jour_le_plus_pluvieux?: { date: string; mm: number } };
    temperatures?: { maximales_moyenne?: number; maximales_normale?: number; minimales_moyenne?: number; minimales_normale?: number; jour_le_plus_chaud?: { date: string; tx: number } };
    ensoleillement?: { heures_par_jour?: number; normale_heures_par_jour?: number; jours_gris: number; jours_ensoleilles: number; jours_mesures: number };
  }[];
  a_savoir: string[];
  sources: Credit[];
  /** Yesterday and last night hour by hour at Saint-Denis, when the hourly archive answers. */
  heures?: HourlyAnswer;
}

export interface HourlyAnswer {
  resume: string;
  heure_par_heure: {
    stations: { station: string; mesure: string }[];
    heures: { heure: string; pluie_mm?: number; temperature?: number; vent_kmh?: number; vent_de?: string; rafale_kmh?: number; soleil_min?: number }[];
  };
}

const HOURLY_PLACE = "Saint-Denis";

export async function buildHistorique(cache: Cache, now = new Date()): Promise<HistoriqueAnswer> {
  const d = needed<HistoriqueAnswer>(await historiqueMeteo(cache, undefined, {}, now), "historique");
  const day = (t: number) => new Date(t + 4 * 3600_000).toISOString().slice(0, 10);
  try {
    const h = answer<HourlyAnswer>(await historiqueMeteo(cache, HOURLY_PLACE, { du: day(now.getTime() - 86_400_000), au: day(now.getTime()), detail: "heure" }, now));
    if (h?.heure_par_heure?.heures.length) d.heures = h;
  } catch (err) {
    console.error("page historique : heures indisponibles", why(err));
  }
  return d;
}

export async function buildCyclones(cache: Cache, now = new Date()): Promise<CyclonesAnswer> {
  const a = needed<Omit<CyclonesAnswer, "traces">>(await cyclones(cache, undefined, now), "cyclones");
  const list = (await gdacs.systemes(cache, now)).value.filter((s) => s.debut <= now.toISOString());
  const active = await gdacs.actifs(cache, list, now);
  const pair = (p: gdacs.Point): [number, number] => [p.lon, p.lat];
  let traces: CyclonesAnswer["traces"] = active
    .filter((x) => x.trajectoire?.observee.length)
    .map(({ systeme, trajectoire: t }) => ({ nom: systeme.nom, observee: t!.observee.map(pair), prevue: t!.prevue.map(pair), etiquette: t!.observee.at(-1)!.stade, actif: true }));
  const last = list[0];
  if (!active.length && last) {
    const t = await gdacs.trajectoire(cache, last).catch(() => undefined);
    if (t?.value.observee.length) {
      const d = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
      traces = [{ nom: last.nom, observee: t.value.observee.map(pair), prevue: [], etiquette: `${d(last.debut)} – ${d(last.fin)}`, actif: false }];
    }
  }
  return { ...a, traces };
}

export interface AgendaAnswer {
  resume: string;
  nombre: number;
  evenements?: EventRow[];
  autres?: string;
  indisponible?: string[];
  couverture: string;
  a_savoir: string;
  sources: Credit[];
  ce_week_end: EventRow[];
}

// The page lists every event of the two weeks, the connector at most 40 an answer.
const PAGE_EVENTS = 300;

/** The next two weeks for the whole island, and this weekend's apart: the same agendas, read once. */
export async function buildAgenda(cache: Cache, now = new Date()): Promise<AgendaAnswer> {
  const a = needed<Omit<AgendaAnswer, "ce_week_end">>(await agenda(cache, undefined, undefined, undefined, now, PAGE_EVENTS), "agenda");
  const weekend = answer<{ evenements?: EventRow[] }>(await agenda(cache, undefined, "ce_week_end", undefined, now));
  return { ...a, ce_week_end: weekend?.evenements ?? [] };
}

export interface ActualitesAnswer {
  /** The last 24 hours, newest first, the live entries apart. */
  infos: InfoRow[];
  en_direct: InfoRow[];
  prefecture: InfoRow[];
  /** Whether people are in the streets or roads blocked: a live blog, or news of it in the last hours. */
  chaud: boolean;
  indisponible: string[];
  couverture: string;
  a_savoir: string;
  sources: Credit[];
}

const NEWS_HOURS = 24;
const NEWS_LISTED = 40;
const HOT_HOURS = 6;

/** The island's news of the last day, as the page lists it. */
export async function buildActualites(cache: Cache, now = new Date()): Promise<ActualitesAnswer> {
  const f = (await actuSource.fil(cache, now)).value;
  const since = new Date(now.getTime() - NEWS_HOURS * 3600_000).toISOString();
  const recent = new Date(now.getTime() - HOT_HOURS * 3600_000).toISOString();
  const day = f.infos.filter((i) => i.publie >= since);
  return {
    infos: day.filter((i) => !i.direct).slice(0, NEWS_LISTED).map((i) => infoRow(i, now)),
    en_direct: day.filter((i) => i.direct).slice(0, 12).map((i) => infoRow(i, now)),
    prefecture: f.prefecture.slice(0, 4).map((i) => infoRow(i, now)),
    chaud: day.some((i) => i.publie >= recent && (i.direct || i.sujets.includes("mobilisation"))),
    indisponible: f.indisponible,
    couverture: ACTU_COUVERTURE,
    a_savoir: ACTU_A_SAVOIR,
    sources: credits([actuSource.SOURCES.medias, actuSource.SOURCES.prefecture]),
  };
}

export interface DaeAnswer {
  total: number;
  communes: { commune: string; lon: number; lat: number; nombre: number; toute_heure: number; liste: ReturnType<typeof daeRow>[] }[];
  urgence: string;
}

const DAE_LISTED = 12;

/** Static (the list is bundled): by commune, those reachable at any hour first. */
export async function buildDae(): Promise<DaeAnswer> {
  return {
    total: daeSource.DAES.length,
    communes: daeByCommune().map(({ commune, list }) => ({
      commune,
      lon: list.reduce((n, d) => n + d.lon, 0) / list.length,
      lat: list.reduce((n, d) => n + d.lat, 0) / list.length,
      nombre: list.length,
      toute_heure: list.filter((d) => daeAccess(d).includes("toute heure") || daeAccess(d).includes("24 h")).length,
      liste: list.slice(0, DAE_LISTED).map((d) => daeRow(d)),
    })),
    urgence: DAE_URGENCE,
  };
}

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
  /** The school year under way (from July, the one that starts in August) and the next once published, every break of each. */
  annees_scolaires?: { annee: string; vacances: { nom: string; debut: string; reprise: string | null }[] }[];
  sources: Credit[];
}

/** The tool says « indisponible » for a source that failed; with both down, the page keeps its last copy. */
export async function buildCalendrier(cache: Cache, now = new Date()): Promise<CalendrierAnswer> {
  const a = needed<Record<string, unknown>>(await calendrier(cache, undefined, now), "calendrier");
  const part = <T>(v: unknown) => (typeof v === "object" && v !== null ? (v as T) : undefined);
  const out = { ...a, jours_feries: part(a.jours_feries), vacances_scolaires: part(a.vacances_scolaires) } as CalendrierAnswer;
  if (!out.jours_feries && !out.vacances_scolaires) throw new Error("aucune donnée pour la page calendrier");
  // The same list the tool has just read, from the cache.
  const all = out.vacances_scolaires ? (await cal.schoolBreaks(cache).catch(() => undefined))?.value : undefined;
  if (all) {
    const [y, m] = new Date(now.getTime() + 4 * 3600_000).toISOString().split("-").map(Number);
    const first = m >= 7 ? y : y - 1;
    out.annees_scolaires = [`${first}-${first + 1}`, `${first + 1}-${first + 2}`]
      .map((annee) => ({ annee, vacances: all.filter((b) => b.annee_scolaire === annee).map(({ nom, debut, reprise }) => ({ nom, debut, reprise })) }))
      .filter((x) => x.vacances.length);
  }
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

// ---------------------------------------------------------------- circulation: what we have, without traffic data

/** The forest roads people drive to: the volcano, the Maïdo, Bébour-Bélouve. */
const MAIN_ROADS = /\((RF05|RF08|RF02)\)/;
// A delay under this is the timetable's slack, not the road.
export const LATE_MIN = 3;

export interface TraficAnswer {
  /** The buses late on leaving the main bus stations, and the networks' notices (detours): what the feeds say. */
  bus: {
    retards: { gare: string; reseau: string; ligne: string; direction: string; heure: string; retard_min: number }[];
    /** How many departures with a real-time time were looked at. */
    suivis: number;
    temps_reel: { reseau: string; heure: string }[];
    alertes: { reseau: string; titre: string; detail?: string }[];
  } | null;
  /** The ONF's forest roads: those closed to traffic, and the state of the main ones. */
  routes_forestieres: {
    interdites: { route: string; cause?: string; precision?: string }[];
    principales: { route: string; circulation: string; cause?: string; precision?: string }[];
    mise_a_jour?: string;
  } | null;
  /** The Enclos of the volcano, from the volcano's page when it has been built. */
  enclos?: { statut: string; detail?: string; source?: string; lien?: string };
  /** The month's maximum fuel prices, set by the prefect. */
  carburants?: carburants.Prix;
  /** What the media report on the roads and the blockades in the last hours, newest first. */
  medias?: { titre: string; lien: string; source: string; heure?: string }[];
  sources: Credit[];
}

/**
 * Around the traffic, which no open source measures: the buses' delays and detours (the bus page's data), the forest
 * roads of the ONF, the Enclos. Each part on its own: one source down leaves the others.
 */
// The news of the roads on /trafic: the subjects, how far back, how many.
const ROAD_NEWS = ["route", "mobilisation"];
const ROAD_NEWS_HOURS = 6;
const ROAD_NEWS_MAX = 6;
// A headline is told here when its title is about the roads or the street, not only its text: the subjects come from
// the summary too, and a live entry on the night's fires (« Rentrez vos poubelles ! ») or on postponed matches is no
// news of the roads. A gathering is, but not a sporting one.
const ROAD_TITLE = /\b(?:barrages?|blocages?|bloqu\w*|filtrants?|manifestation\w*|manifestant\w*|rassembl\w*(?! sporti)|cortege|operation escargot|routes?|inforoutes?|circulation|trafic|bouchons?|embouteillage\w*|accidents?|rn ?\d+|quatre voies|littoral|basculement|radiers?|deviation\w*|chaussee|deplacements?|rond point|bus)\b/;
// The préfecture's communiqués on the protests and the roads (bilans, bans, closures): dated by the day only, kept a
// day, two at most, above the media's.
const PREFECTURE_HOURS = 24;
const PREFECTURE_MAX = 2;
// The news older than this is read again after the response, for the next view: on a day of blockades, /trafic should
// not wait for someone to open /actualites. Not more often than once a minute per isolate, and only with the
// subrequests it takes (the feeds, the préfecture, the live pages, the store).
const ROAD_NEWS_STALE_SECONDS = 15 * 60;
const ROAD_NEWS_RETRY_MS = 60_000;
const ROAD_NEWS_MIN_LEFT = 14;
let roadNewsAsked = -Infinity;

/** The headlines of the last hours on the roads, the blockades and the protests, newest first. */
export function roadNews(news: actuSource.Fil | undefined, now: Date): NonNullable<TraficAnswer["medias"]> {
  const after = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
  const onRoads = (i: actuSource.Info) => i.sujets.some((s) => ROAD_NEWS.includes(s));
  const row = (i: actuSource.Info) => ({ titre: i.titre, lien: i.lien, source: `${i.media}${i.direct ? ", en direct" : ""}`, heure: newsTime(i, now) });
  const prefecture = (news?.prefecture ?? []).filter((i) => i.publie >= after(PREFECTURE_HOURS) && onRoads(i)).slice(0, PREFECTURE_MAX);
  const medias = (news?.infos ?? []).filter((i) => i.publie >= after(ROAD_NEWS_HOURS) && onRoads(i) && ROAD_TITLE.test(normalize(i.titre))).slice(0, ROAD_NEWS_MAX);
  return [...prefecture, ...medias].map(row);
}

/**
 * The news as last read (for /actualites, the tool, the home page's tile), without reading the feeds for this view.
 * When there is none (a new version, a data center that never read it) or it is old, it is read again afterwards.
 */
export async function roadNewsNow(cache: Cache, background: Background, now = new Date()): Promise<actuSource.Fil | undefined> {
  const got = await cache.peek<actuSource.Fil>("actualites:fil").catch(() => undefined);
  const old = !got || now.getTime() - got.fetchedAt.getTime() > ROAD_NEWS_STALE_SECONDS * 1000;
  if (old && now.getTime() - roadNewsAsked > ROAD_NEWS_RETRY_MS && left() >= ROAD_NEWS_MIN_LEFT) {
    roadNewsAsked = now.getTime();
    background(actuSource.fil(cache, now).catch((err) => console.error("trafic : actualités indisponibles", why(err))));
  }
  return got?.value;
}

/** The page's data with the headlines of now: the page's copy lasts minutes, a blockade should not wait for it. */
export function withRoadNews(d: TraficAnswer, news: actuSource.Fil | undefined, now: Date): TraficAnswer {
  const medias = roadNews(news, now);
  const credit = credits([
    ...(medias.some((m) => m.source !== actuSource.SOURCES.prefecture.organisme) ? [actuSource.SOURCES.medias] : []),
    ...(medias.some((m) => m.source === actuSource.SOURCES.prefecture.organisme) ? [actuSource.SOURCES.prefecture] : []),
  ]);
  const ours = new Set(credits([actuSource.SOURCES.medias, actuSource.SOURCES.prefecture]).map((c) => c.source));
  const { medias: _, ...rest } = d;
  return { ...rest, ...(medias.length ? { medias } : {}), sources: [...d.sources.filter((s) => !ours.has(s.source)), ...credit] };
}

export async function buildTrafic(cache: Cache, now = new Date()): Promise<TraficAnswer> {
  const [bus, carte, volcan, fuel] = await Promise.all([
    cache.get("web:bus", FRESH_SECONDS, () => buildBus(now, cache)).then((c) => c.value).catch((err) => (console.error("trafic : bus indisponibles", why(err)), null)),
    onf.carte(cache).then((c) => c.value).catch((err) => (console.error("trafic : routes forestières indisponibles", why(err)), null)),
    cache.peek<VolcanAnswer>("web:volcan").catch(() => null),
    carburants.prix(cache, now).then((c) => c.value).catch((err) => (console.error("trafic : prix des carburants indisponibles", why(err)), null)),
  ]);
  const live = bus?.gares.flatMap((g) => g.departs.filter((d) => d.retard_min !== undefined).map((d) => ({ gare: g.commune, d }))) ?? [];
  const roads = carte?.routes ?? [];
  return {
    bus: bus
      ? {
          retards: live.filter(({ d }) => d.retard_min! >= LATE_MIN)
            .sort((a, b) => b.d.retard_min! - a.d.retard_min!)
            .map(({ gare, d }) => ({ gare, reseau: d.reseau, ligne: d.ligne, direction: d.direction, heure: d.heure, retard_min: d.retard_min! })),
          suivis: live.length,
          temps_reel: bus.temps_reel ?? [],
          alertes: bus.alertes ?? [],
        }
      : null,
    routes_forestieres: carte
      ? {
          interdites: roads.filter((r) => /interdit/i.test(r.circulation)).map((r) => ({ route: r.nom, cause: r.cause, precision: r.info })),
          // One line per road: the ONF's map cuts some in sections with their own hours.
          principales: [...new Set(roads.filter((r) => MAIN_ROADS.test(r.nom)).map((r) => r.nom))].map((nom) => {
            const parts = roads.filter((r) => r.nom === nom);
            const shut = parts.find((r) => /interdit/i.test(r.circulation));
            return { route: nom, circulation: shut?.circulation ?? [...new Set(parts.map((r) => r.circulation))].join(" ; "), cause: shut?.cause, precision: shut?.info };
          }),
          mise_a_jour: carte.mise_a_jour,
        }
      : null,
    ...(volcan?.value.etat?.acces_enclos ? { enclos: volcan.value.etat.acces_enclos } : {}),
    ...(fuel ? { carburants: fuel } : {}),
    // The media's headlines are added when the page is served (withRoadNews), not kept in its copy.
    sources: [...(bus ? bus.sources : []), ...(carte ? credits([onf.SOURCE]) : []), ...(fuel ? credits([carburants.SOURCE]) : [])],
  };
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
  // Each build is measured: a tile is brought up to date only when what it took last time is left (web/site.ts).
  const run = () => measured(key, build);
  const any = cache.get(key, KEEP_SECONDS, run);
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
    const fresh = cache.get(key, FRESH_SECONDS, run);
    const logged = fresh.catch((err) => console.error(`page ${key} : rafraîchissement impossible`, why(err)));
    if (reader) {
      const newer = await within(logged, waitMs);
      if (newer) return newer;
    }
    background(logged);
  }
  return got;
}
