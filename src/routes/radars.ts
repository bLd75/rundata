/**
 * The fixed speed cameras of La Réunion (src/routes/radars.json, scripts/build-radars.py): the ministry of the
 * Interior's list on data.gouv.fr, bundled, updated once a year. Where each one stands is public information, said as
 * the ministry lists it, with the day of its file: a camera put up since, or missing from it, is not here. Never the
 * mobile checks, nor anything to dodge a camera.
 */
import { distanceKm } from "../geo.js";
import { communeAt } from "../places/resolve.js";
import { enumeration } from "../tools/format.js";
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
  /** « ETT ». */
  type: string;
  /** Its type as the dataset's page defines it, word for word; none for a type it does not define. */
  definition: string | null;
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

/**
 * A camera with its commune, that of the nearest place of the gazetteer. Never that place itself: a beach named for a
 * camera on a boulevard would be repeated as where it stands (marketing, 26/10).
 */
export interface RadarPlace extends Radar {
  commune: string;
}

let placed: RadarPlace[] | undefined;
/** Each camera with its commune, worked out once per isolate. */
export function radars(): RadarPlace[] {
  placed ??= RADARS.map((r) => ({ ...r, commune: communeAt(r.lon, r.lat) }));
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

/** What is said with the list, wherever it is shown (marketing, 26/10). « Once a year »: the dataset's page says so. */
export const RESERVE = () =>
  `Liste des radars fixes publiée par le ministère de l'Intérieur, fichier du ${fichierDu()}, mise à jour une fois par an : un radar installé depuis, ou absent du fichier, n'y figure pas. Les contrôles mobiles n'y sont pas.`;

const fixes = (n: number) => `${n} ${n > 1 ? "radars fixes" : "radar fixe"}`;
/** The speed limits of these cameras, the lowest first: « 70\u00a0km/h ». */
export const vitesses = (list: Radar[]) => [...new Set(list.map((r) => r.vma_kmh).filter((v): v is number => v != null))].sort((x, y) => x - y).map((v) => `${v}\u00a0km/h`);

/** One camera in a tool's answer. */
export const row = (r: RadarPlace) => ({
  numero: r.numero,
  type: r.definition ? `${r.type} : ${r.definition}` : r.type,
  vitesse_max_kmh: r.vma_kmh ?? undefined,
  commune: r.commune,
  mis_en_service: r.mis_en_service?.split("-").reverse().join("/"),
  carte: carte(r),
});

/** The field `radars_fixes` of actualites: a commune's cameras, or the island's by commune. `dans`: « à Saint-Denis ». */
export function forTool(commune?: string, dans?: string) {
  const list = commune ? inCommune(commune) : radars();
  const liste = `dans la liste du ministère de l'Intérieur (fichier du ${fichierDu()})`;
  const limits = vitesses(list);
  const resume = commune
    ? list.length
      ? `${fixes(list.length)} ${dans} ${liste}${limits.length ? `, limité${list.length > 1 ? "s" : ""} à ${enumeration(limits)}` : ""}.`
      : `Aucun radar fixe ${dans} ${liste}.`
    : `${fixes(list.length)} à La Réunion ${liste}.`;
  return {
    resume,
    radars: commune && list.length ? list.map(row) : undefined,
    par_commune: commune ? undefined : byCommune().map((c) => ({ commune: c.commune, nombre: c.radars.length, vitesses_max: vitesses(c.radars) })),
    a_savoir: RESERVE(),
    page: "https://rundata.re/trafic#radars",
  };
}
