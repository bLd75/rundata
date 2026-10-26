/**
 * The fixed speed cameras of La Réunion (src/routes/radars.json, scripts/build-radars.py): the ministry of the
 * Interior's list on data.gouv.fr, bundled, updated once a year. Where each one stands is public information, said as
 * the ministry lists it, with the day of its file: a camera put up since, or missing from it, is not here. Never the
 * mobile checks, nor anything to dodge a camera.
 */
import { distanceKm } from "../geo.js";
import { placeAt } from "../places/resolve.js";
import type { SourceInfo } from "../types.js";
import data from "./radars.json" with { type: "json" };

export const SOURCE: SourceInfo = {
  id: "radars_fixes",
  nom: "Radars fixes (ministère de l'Intérieur)",
  organisme: "Ministère de l'Intérieur",
  licence: "Licence Ouverte 2.0",
  attribution: "Ministère de l'Intérieur, liste des radars fixes en France",
  url: data.page,
};

export interface Radar {
  numero: string;
  /** « radar vitesse fixe de nouvelle génération », as the dataset's page defines its type. */
  type: string;
  /** The speed limit it checks, km/h. */
  vma_kmh: number | null;
  /** « 2021-05-04 ». */
  mis_en_service: string | null;
  lon: number;
  lat: number;
}

export const RADARS = data.radars as Radar[];
/** The day the ministry put its file online: « 2025-12-30 ». */
export const FICHIER_DU: string = data.fichier_du;

export interface RadarPlace extends Radar {
  commune: string;
  /** The nearest place of the gazetteer: « Bois de Nèfles ». */
  pres_de: string;
}

let placed: RadarPlace[] | undefined;
/** Each camera with its commune and the nearest place, worked out once per isolate. */
export function radars(): RadarPlace[] {
  placed ??= RADARS.map((r) => {
    const p = placeAt(r.lon, r.lat);
    return { ...r, commune: p.commune, pres_de: p.nom };
  });
  return placed;
}

/** The cameras of a commune, or within `km` of a point. */
export const inCommune = (commune: string) => radars().filter((r) => r.commune === commune);
export const near = (lon: number, lat: number, km: number) => radars().filter((r) => distanceKm(lon, lat, r.lon, r.lat) <= km);

/** The communes with a camera, the most first, then by name. */
export function byCommune(): { commune: string; radars: RadarPlace[] }[] {
  const by = new Map<string, RadarPlace[]>();
  for (const r of radars()) by.set(r.commune, [...(by.get(r.commune) ?? []), r]);
  return [...by.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "fr"))
    .map(([commune, list]) => ({ commune, radars: list.sort((a, b) => (a.vma_kmh ?? 0) - (b.vma_kmh ?? 0) || a.numero.localeCompare(b.numero)) }));
}

/** Where a camera stands on OpenStreetMap's map. */
export const carte = (r: Pick<Radar, "lon" | "lat">) => `https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=17/${r.lat}/${r.lon}`;

/** « 30/12/2025 ». */
export const fichierDu = () => FICHIER_DU.split("-").reverse().join("/");

/** What is said with the list, wherever it is shown (words to be checked by marketing). */
export const RESERVE = () =>
  `Liste des radars fixes publiée par le ministère de l'Intérieur, fichier du ${fichierDu()}, mise à jour une fois par an : un radar installé depuis, ou absent du fichier, n'y figure pas. Les contrôles mobiles n'y sont pas.`;

const fixes = (n: number) => `${n} ${n > 1 ? "radars fixes" : "radar fixe"}`;
const kmh = (list: Radar[]) => [...new Set(list.map((r) => r.vma_kmh).filter((v): v is number => v != null))].sort((x, y) => x - y).map((v) => `${v} km/h`);

/** One camera in a tool's answer. */
export const row = (r: RadarPlace) => ({
  numero: r.numero,
  type: r.type,
  vitesse_max_kmh: r.vma_kmh ?? undefined,
  commune: r.commune,
  lieu_le_plus_proche: r.pres_de,
  mis_en_service: r.mis_en_service?.split("-").reverse().join("/"),
  carte: carte(r),
});

/** The field `radars_fixes` of actualites: a commune's cameras, or the island's by commune. `dans`: « à Saint-Denis ». */
export function forTool(commune?: string, dans?: string) {
  const list = commune ? inCommune(commune) : radars();
  const resume = commune
    ? list.length
      ? `${fixes(list.length)} ${dans} dans la liste du ministère de l'Intérieur (${kmh(list).join(", ")}).`
      : `Aucun radar fixe ${dans} dans la liste du ministère de l'Intérieur.`
    : `${fixes(list.length)} à La Réunion dans la liste du ministère de l'Intérieur.`;
  return {
    resume,
    radars: commune && list.length ? list.map(row) : undefined,
    par_commune: commune ? undefined : byCommune().map((c) => ({ commune: c.commune, nombre: c.radars.length, vitesses_max: kmh(c.radars) })),
    a_savoir: RESERVE(),
    page: "https://rundata.re/trafic#radars",
  };
}
