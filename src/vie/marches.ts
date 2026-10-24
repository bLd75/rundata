/**
 * The markets of La Réunion as OpenStreetMap maps them (src/vie/marches.json, scripts/build-marches.py): the forains
 * and the covered markets its contributors have mapped, with their days and hours when given. Not all of them.
 */
import { distanceKm } from "../geo.js";
import { communeAt } from "../places/resolve.js";
import type { SourceInfo } from "../types.js";
import data from "./marches.json" with { type: "json" };

export interface Marche {
  nom: string;
  horaires: string | null;
  horaires_osm: string | null;
  note: string | null;
  adresse: string | null;
  lon: number;
  lat: number;
  osm: string;
}

export const OSM: SourceInfo = {
  id: "osm_marches",
  nom: "Marchés cartographiés dans OpenStreetMap",
  organisme: "Les contributeurs d'OpenStreetMap",
  licence: "ODbL",
  attribution: "© les contributeurs d'OpenStreetMap",
  url: "https://www.openstreetmap.org/",
};

let withCommune: (Marche & { commune: string })[] | undefined;
/** Every market with its commune, worked out once from where it is. */
export const MARCHES = () => (withCommune ??= (data.marches as Marche[]).map((m) => ({ ...m, commune: communeAt(m.lon, m.lat) })));

export const inCommune = (commune: string) => MARCHES().filter((m) => m.commune === commune);

export function nearest(lon: number, lat: number, max = 5) {
  return MARCHES().map((m) => ({ ...m, km: distanceKm(lon, lat, m.lon, m.lat) })).sort((a, b) => a.km - b.km).slice(0, max);
}
