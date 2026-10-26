/**
 * The ONF's reception areas in the forests (src/traces/aires.json, scripts/build-aires.py): the layer « Aires
 * d'accueil » of its map of the trails, bundled. Each by its name as the ONF writes it (« RF du Maido - pk13.1 »,
 * « Affouches - RF20 - Kiosque pk10.3 »), with no type: nothing is said of what a place has or allows.
 */
import { distanceKm } from "../geo.js";
import { communeAt } from "../places/resolve.js";
import type { SourceInfo } from "../types.js";
import data from "./aires.json" with { type: "json" };

export const SOURCE: SourceInfo = {
  id: "onf_aires_accueil",
  nom: "Aires d'accueil des forêts (ONF La Réunion)",
  organisme: "Office national des forêts, direction régionale de La Réunion",
  licence: "Information publique (carte des sentiers de l'ONF)",
  attribution: "ONF La Réunion",
  url: "https://www.onf.fr/vivre-la-foret/+/b90::randonnee-la-reunion-connaitre-les-sentiers-fermes.html",
};

export interface Aire {
  nom: string;
  lon: number;
  lat: number;
}

export const AIRES = data.aires as Aire[];
/** When the ONF last edited the layer: « 2026-05-20 ». */
export const MISE_A_JOUR = data.mise_a_jour as string | null;

/** An area with how far it is, in km. */
export interface AireNear extends Aire {
  distance_km: number;
}

const rounded = (km: number) => Math.round(km * 10) / 10;

/** The areas within `km` of a point, the nearest first. */
export function near(lon: number, lat: number, km: number): AireNear[] {
  return AIRES.map((x) => ({ ...x, distance_km: distanceKm(lon, lat, x.lon, x.lat) }))
    .filter((x) => x.distance_km <= km)
    .sort((x, y) => x.distance_km - y.distance_km)
    .map((x) => ({ ...x, distance_km: rounded(x.distance_km) }));
}

/** The areas within `km` of a line (a trail), the nearest to it first. */
export function along(points: [number, number][], km: number): AireNear[] {
  if (!points.length) return [];
  return AIRES.map((x) => ({ ...x, distance_km: Math.min(...points.map(([lon, lat]) => distanceKm(lon, lat, x.lon, x.lat))) }))
    .filter((x) => x.distance_km <= km)
    .sort((x, y) => x.distance_km - y.distance_km)
    .map((x) => ({ ...x, distance_km: rounded(x.distance_km) }));
}

let communes: Map<string, Aire[]> | undefined;
/** The areas of a commune (that of the nearest place of the gazetteer), by name. */
export function inCommune(commune: string): Aire[] {
  if (!communes) {
    communes = new Map();
    for (const x of AIRES) {
      const c = communeAt(x.lon, x.lat);
      communes.set(c, [...(communes.get(c) ?? []), x]);
    }
  }
  return communes.get(commune) ?? [];
}

/** Where an area stands on OpenStreetMap's map. */
export const carte = (x: Pick<Aire, "lon" | "lat">) => `https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=17/${x.lat}/${x.lon}`;
