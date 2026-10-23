/**
 * How well a station speaks for the place asked about. La Réunion goes from sea level to 3 000 m within
 * 20 km and has a wet windward east and a dry leeward west: a seaside station must never quietly answer
 * for Cilaos. Every answer says how far, how much lower or higher, and on which side the station is.
 */
import { bearingDeg, compass, distanceKm, versant, type Versant } from "../geo.js";
import type { Place } from "../places/resolve.js";
import type { Station } from "../types.js";

export type Pertinence = "bonne" | "moyenne" | "faible";

export interface Fit {
  distance_km: number;
  direction: string;
  ecart_altitude_m: number | null;
  versant: Versant;
  pertinence: Pertinence;
  avertissements: string[];
  /** Lower is better: km, plus 3 km per 100 m of altitude difference, plus 8 km for the other side. */
  score: number;
}

export function fit(place: Place, station: Station): Fit {
  const d = distanceKm(place.lon, place.lat, station.lon, station.lat);
  const dAlt = place.altitude_m == null ? null : station.altitude_m - place.altitude_m;
  const vPlace = versant(place.lon, place.lat);
  const vStation = versant(station.lon, station.lat);
  const sameSide = vPlace === vStation;
  const absAlt = Math.abs(dAlt ?? 0);

  const avertissements: string[] = [];
  if (absAlt > 150) {
    const sens = dAlt! < 0 ? "plus bas" : "plus haut";
    avertissements.push(
      `La station est ${absAlt} m ${sens} que ${place.nom} : la température y est généralement différente ` +
        `(de l'ordre de 0,6 °C de moins par 100 m de montée), le vent et la pluie aussi.`,
    );
  }
  if (!sameSide) {
    avertissements.push(
      `La station est sur le versant ${vStation}, ${place.nom} sur le versant ${vPlace} : ` +
        `nuages, pluie et vent peuvent y être très différents.`,
    );
  }
  if (d > 20) avertissements.push(`La station est loin (${Math.round(d)} km).`);

  const pertinence: Pertinence =
    d <= 8 && absAlt <= 150 && sameSide ? "bonne" : d <= 20 && absAlt <= 400 ? "moyenne" : "faible";

  return {
    distance_km: Math.round(d * 10) / 10,
    direction: compass(bearingDeg(place.lon, place.lat, station.lon, station.lat)),
    ecart_altitude_m: dAlt,
    versant: vStation,
    pertinence,
    avertissements,
    score: d + (3 * absAlt) / 100 + (sameSide ? 0 : 8),
  };
}
