/**
 * The places to go with children in La Réunion (src/vie/enfants.json, scripts/build-enfants.py): OpenStreetMap's
 * playgrounds, parks, zoos, leisure parks, game halls, museums and libraries; Data ES's pools, free-access sports and
 * climbing walls; Basilic's libraries. Not all of them: the day-care, the holiday centres (monenfant.fr, whose data may
 * not be reused) and the private activities no open map has are missing, and the page and the tool say so.
 *
 * An age is a fact only when the source gives it (OpenStreetMap's min_age / max_age, the organiser's text for an
 * event); else an indication by kind of place, always marked as rundata.re's (marketing/enfants-textes.md §3).
 */
import { distanceKm } from "../geo.js";
import { ageRange } from "../providers/agenda-mots.js";
import type { SourceInfo } from "../types.js";
import data from "./enfants.json" with { type: "json" };
import { hoursOn } from "./marches.js";

export type Kind = "aire_de_jeux" | "parc" | "piscine" | "mediatheque" | "animaux" | "loisirs" | "salle_jeux" | "sport" | "escalade" | "musee" | "ludotheque";

export interface Lieu {
  /** Empty for an unnamed playground. */
  nom: string;
  type: Kind;
  commune: string;
  /** The district of an unnamed playground, when the gazetteer has one within 1.5 km. */
  quartier?: string | null;
  lon: number;
  lat: number;
  source: "osm" | "data_es" | "basilic";
  /** Its page in the source: OpenStreetMap's object, Data ES's sheet. */
  lien?: string;
  /** The ages OpenStreetMap gives, in years. */
  age?: { min?: number; max?: number };
  horaires_osm?: string;
  site?: string;
  adresse?: string;
  /** Data ES's kind of equipment: the pools of an installation (« Bassin ludique, bassin sportif »), « Skatepark ». */
  detail?: string;
  /** Basilic's network of libraries. */
  reseau?: string;
  /** The other sources that list the same place. */
  aussi?: { source: string; lien?: string }[];
}

/** The day the bundled list was last rebuilt. */
export const BUILT: string = data.construit;
export const LIEUX = data.lieux as Lieu[];

export const SOURCES: Record<Lieu["source"], SourceInfo> = {
  osm: {
    id: "osm_enfants",
    nom: "Aires de jeux, parcs, zoos, musées et bibliothèques cartographiés dans OpenStreetMap",
    organisme: "Les contributeurs d'OpenStreetMap",
    licence: "ODbL",
    attribution: "© les contributeurs d'OpenStreetMap",
    url: "https://www.openstreetmap.org/",
  },
  data_es: {
    id: "data_es",
    nom: "Data ES, recensement des équipements sportifs",
    organisme: "Ministère des Sports",
    licence: "Licence Ouverte",
    attribution: "Data ES (ministère des Sports)",
    url: "https://equipements.sports.gouv.fr/",
  },
  basilic: {
    id: "basilic",
    nom: "Basilic, base des lieux et équipements culturels",
    organisme: "Ministère de la Culture",
    licence: "Licence Ouverte 2.0",
    attribution: "Basilic (ministère de la Culture)",
    url: "https://www.data.gouv.fr/datasets/base-des-lieux-et-des-equipements-culturels",
  },
};

const NBSP = "\u00a0";
/** French spacing: a non-breaking space before « : ; ? ! », inside the guillemets, between a number and « ans ». */
export const typo = (s: string) =>
  s.replace(/ ([:;?!»])/g, `${NBSP}$1`).replace(/« /g, `«${NBSP}`).replace(/(\d) (ans|mois)(?!\p{L})/gu, `$1${NBSP}$2`);

/** The age bands, in the filters' order: a place is in each band its ages overlap. */
export const BANDS = [
  { key: "0-3", nom: "Tout-petits, 0–3 ans", de: 0, a: 3 },
  { key: "3-6", nom: "3–6 ans", de: 3, a: 6 },
  { key: "6-12", nom: "6–12 ans", de: 6, a: 12 },
  { key: "12-17", nom: "Ados, 12–17 ans", de: 12, a: 18 },
] as const;
export type Band = (typeof BANDS)[number]["key"];

const ALL: Band[] = BANDS.map((b) => b.key);

/**
 * The page's types, in its order (the agenda's « Activités et spectacles » comes first, on the page), and the bands a
 * kind of place is indicated for when no source gives its ages.
 */
export const TYPES: { type: Kind; nom: string; court: string; indicatif: Band[] }[] = [
  { type: "aire_de_jeux", nom: "Aires de jeux", court: "aires de jeux", indicatif: ["3-6", "6-12"] },
  { type: "parc", nom: "Parcs et jardins", court: "parcs et jardins", indicatif: ALL },
  { type: "piscine", nom: "Piscines", court: "piscines", indicatif: ALL },
  { type: "mediatheque", nom: "Médiathèques et bibliothèques", court: "médiathèques", indicatif: ALL },
  { type: "animaux", nom: typo("Animaux : zoos, parcs animaliers, aquarium"), court: "zoos et aquarium", indicatif: ALL },
  { type: "loisirs", nom: "Parcs de loisirs et parcs aquatiques", court: "parcs de loisirs", indicatif: ALL },
  { type: "salle_jeux", nom: "Salles de jeux et trampoline", court: "salles de jeux", indicatif: ["6-12", "12-17"] },
  { type: "sport", nom: typo("Sport en accès libre : skateparks, city-stades"), court: "skateparks et city-stades", indicatif: ["6-12", "12-17"] },
  { type: "escalade", nom: "Escalade", court: "escalade", indicatif: ["6-12", "12-17"] },
  { type: "musee", nom: "Musées", court: "musées", indicatif: ALL },
  { type: "ludotheque", nom: "Ludothèques", court: "ludothèques", indicatif: ALL },
];
export const typeOf = (k: Kind) => TYPES.find((t) => t.type === k)!;

/** The name of an unnamed playground: « Aire de jeux, Bérive », or « Aire de jeux » without a district. */
export const nameOf = (l: Lieu) => l.nom || `Aire de jeux${l.quartier ? `, ${l.quartier}` : ""}`;

/** The bands a range of ages overlaps: « 6 mois – 6 ans » is in 0–3 and 3–6, not in 6–12. */
export const bandsOf = (r: { min?: number; max?: number }): Band[] =>
  BANDS.filter((b) => (r.min ?? 0) < b.a && (r.max ?? 18) > b.de).map((b) => b.key);

/** « 0.5 » → « 6 mois », « 3 » → « 3 ». */
const years = (n: number) => (n < 1 ? `${Math.round(n * 12)}${NBSP}mois` : String(n));
/** OpenStreetMap's ages in words: « 3–14 ans », « 6 mois – 6 ans », « dès 3 ans », « jusqu'à 8 ans ». */
export function agesSaid(r: { min?: number; max?: number }): string {
  const ans = (n: number) => `${n}${NBSP}an${n > 1 ? "s" : ""}`;
  if (r.min != null && r.max != null) return r.min < 1 ? `${years(r.min)} – ${ans(r.max)}` : `${r.min}–${r.max}${NBSP}ans`;
  if (r.min != null) return `dès ${r.min < 1 ? years(r.min) : ans(r.min)}`;
  return `jusqu'à ${ans(r.max!)}`;
}

export const INDICATIF_NOTE = typo("Indication de rundata.re selon le type de lieu : ni l'exploitant ni la carte ne précisent d'âge.");
export const AGES_NOTE = typo("Les âges en gras viennent de l'organisateur ou de la carte. Ceux marqués « indicatif » sont notre estimation selon le type de lieu, pas une règle du lieu.");
export const NO_AGE = "Âge non précisé";

export interface Age {
  /** The badge: « 3–14 ans », « 6–12 ans · indicatif », « Tous âges · indicatif », « Âge non précisé ». */
  texte: string;
  /** Given by the source (the map, the organiser), not by rundata.re. */
  fait: boolean;
  bands: Band[];
}

/** The badge of an indicated band list: « 3–12 ans · indicatif », « Tous âges · indicatif ». */
function indicated(bands: Band[]): string {
  if (bands.length === BANDS.length) return "Tous âges · indicatif";
  const [first, last] = [BANDS.find((b) => b.key === bands[0])!, BANDS.find((b) => b.key === bands.at(-1))!];
  return `${first.de}–${Math.min(last.a, 17)}${NBSP}ans · indicatif`;
}

/** A place's ages: the map's when it gives them, else the indication of its kind. */
export function ageOf(l: Lieu): Age {
  if (l.age) return { texte: agesSaid(l.age), fait: true, bands: bandsOf(l.age) };
  const bands = typeOf(l.type).indicatif;
  return { texte: indicated(bands), fait: false, bands };
}

/** An event's ages: the organiser's words when it gives them, else « Âge non précisé », in every band. */
export function eventAge(said: string | undefined): Age {
  const r = said ? ageRange(said) : undefined;
  return r ? { texte: said!, fait: true, bands: bandsOf(r) } : { texte: NO_AGE, fait: false, bands: ALL };
}

export const inCommune = (commune: string) => LIEUX.filter((l) => l.commune === commune);

export function nearest(lon: number, lat: number, list = LIEUX, max = 5) {
  return list.map((l) => ({ ...l, km: distanceKm(lon, lat, l.lon, l.lat) })).sort((a, b) => a.km - b.km).slice(0, max);
}

/** The hours of the day of `now` OpenStreetMap gives (« de 9 h à 17 h »), or undefined. */
export const hoursToday = (l: Lieu, now: Date) => (l.horaires_osm ? hoursOn({ horaires_osm: l.horaires_osm }, now) : undefined);

/** The sources of a list of places, each once, in OpenStreetMap, Data ES, Basilic order. */
export const sourcesOf = (list: Lieu[]) =>
  (["osm", "data_es", "basilic"] as const).filter((s) => list.some((l) => l.source === s || l.aussi?.some((a) => a.source === s))).map((s) => SOURCES[s]);
