/**
 * The words said of the fires seen by satellite (providers/feux.ts), the same in the tools and on the pages: the
 * label of every point, the emergency numbers on every surface, and what a quiet day does not prove (worded by
 * marketing).
 */
import { distanceKm, localTime } from "../geo.js";
import * as feux from "../providers/feux.js";

export const URGENCE = "Vous voyez un feu ? Appelez le 18 ou le 112.";
export const INTRO = "Points chauds repérés par les satellites VIIRS de la NASA ces dernières 24 h, en 4 à 6 passages par jour. Détection satellite, faux positifs possibles : toit chaud, site industriel, brûlage autorisé.";
export const QUIET = "Aucun feu détecté par satellite ces dernières 24 h. Les nuages et les heures entre deux passages peuvent en masquer.";

const localDay = (d: Date) => new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10);

/** « 14:20 », or « hier à 14:20 » for the day before (Réunion time): the window is 24 hours. */
export function at(t: string, now: Date): string {
  const d = new Date(t);
  const hm = localTime(d).split(" ")[1];
  return localDay(d) === localDay(now) ? hm : `hier à ${hm}`;
}
/** « à 14:20 », « hier à 14:20 ». */
export const when = (t: string, now: Date) => (at(t, now).startsWith("hier") ? at(t, now) : `à ${at(t, now)}`);

/** A point of the list on the site: « Feu détecté près de Bois-de-Nèfles, à 14:20 · confiance forte ». */
export const listLine = (d: feux.Detection, now: Date) => `Feu détecté près de ${d.lieu}, ${when(d.t, now)} · confiance ${d.confiance}`;

/** A commune's tile: the newest of its detections. */
export function tileLine(list: feux.Detection[], now: Date): string {
  return list.length === 1
    ? `feu détecté par satellite ${when(list[0].t, now)} (faux positifs possibles)`
    : `${list.length} feux détectés par satellite, le dernier ${when(list[0].t, now)} (faux positifs possibles)`;
}

/** A detection in a tool's answer, with its distance to the place asked. */
export function row(d: feux.Detection, now: Date, from?: { lon: number; lat: number }) {
  return {
    heure: localTime(new Date(d.t)),
    quand: at(d.t, now),
    pres_de: d.lieu,
    commune: d.commune,
    confiance: d.confiance,
    satellite: d.satellite,
    puissance_mw: d.frp_mw ?? undefined,
    distance_km: from ? Math.round(distanceKm(from.lon, from.lat, d.lon, d.lat) * 10) / 10 : undefined,
    position: { lat: d.lat, lon: d.lon },
  };
}

/** The block of sentiers_randonnee: always there once FIRMS answers, the quiet day said as such. */
export function block(f: feux.Feux, now: Date, from?: { lon: number; lat: number }) {
  const n = f.detections.length;
  return {
    avertissement: `${feux.LABEL[0].toUpperCase()}${feux.LABEL.slice(1)} : toit chaud, site industriel, brûlage autorisé.`,
    urgence: URGENCE,
    resume: n ? `${n} point${n > 1 ? "s" : ""} chaud${n > 1 ? "s" : ""} détecté${n > 1 ? "s" : ""} par satellite ces dernières 24 h, le dernier près de ${f.detections[0].lieu} (${f.detections[0].commune}) ${when(f.detections[0].t, now)}.` : QUIET,
    detections: n ? f.detections.map((d) => row(d, now, from)) : undefined,
    satellites: f.satellites,
  };
}

/** The vigilance's line: only when something was seen. */
export function vigilanceLine(f: feux.Feux, now: Date): string | undefined {
  const n = f.detections.length;
  if (!n) return undefined;
  const last = f.detections[0];
  return `${n} feu${n > 1 ? "x" : ""} de végétation détecté${n > 1 ? "s" : ""} par satellite ces dernières 24 h, le dernier près de ${last.lieu} (${last.commune}) ${when(last.t, now)} : ${feux.LABEL}. ${URGENCE} Détails avec sentiers_randonnee.`;
}
