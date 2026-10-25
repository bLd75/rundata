/**
 * « Il a plu quand ? » for a place: the rain of the last hours at the nearest rain gauge, hour by hour, the time of
 * the last rain and the total since midnight, from the Météo-France stations (meteofrance.ts, hourly package and
 * 6-minute slots). Réunion time is UTC+4 all year.
 */
import { a, fr } from "./format.js";
import type { RecentRain } from "../providers/meteofrance.js";
import type { Fit } from "./representativeness.js";

const HOUR_MS = 3_600_000;
const SLOT_MS = 6 * 60_000;
const LOCAL_MS = 4 * HOUR_MS;
// Hours listed: twelve, or all the hours kept when the last rain is older.
const LISTED = 12;

/** Every hour, how it is written: one hour from the first time to the second, Réunion time. */
export const CONVENTION =
  "Chaque ligne va de la première heure à la seconde (heure de La Réunion) : « 14 h–15 h : 1,4 mm », c'est la pluie tombée entre 14 h et 15 h.";

const day = (ms: number) => Math.floor((ms + LOCAL_MS) / (24 * HOUR_MS));
const hm = (ms: number) => {
  const d = new Date(ms + LOCAL_MS);
  return d.getUTCMinutes() ? `${d.getUTCHours()} h ${String(d.getUTCMinutes()).padStart(2, "0")}` : `${d.getUTCHours()} h`;
};
/** « aujourd'hui », « hier », or the date, for the day `ms` falls in. */
const dayWord = (ms: number, now: number) =>
  day(ms) === day(now) ? "aujourd'hui" : day(ms) === day(now) - 1 ? "hier" : new Date(ms + LOCAL_MS).toISOString().slice(8, 10) + "/" + new Date(ms + LOCAL_MS).toISOString().slice(5, 7);
const mm = (x: number) => (x ? `${fr(Math.round(x * 10) / 10)} mm` : "0");

export interface StationRain {
  id: string;
  nom: string;
  fit: Fit;
}

/**
 * The block for `station`, or undefined when it has no hourly rain. `drizzle` says the sky is loaded while the gauge
 * and the radar measure nothing: the gauge counts by steps of 0.2 mm, so a light drizzle may not show.
 */
export function recentRainBlock(rain: RecentRain, station: StationRain, lieu: string, now: Date, drizzle: boolean) {
  const hours = rain.hourly.rr[station.id];
  if (!hours) return undefined;
  const t = now.getTime();
  const end = Date.parse(rain.hourly.end);
  const slots = rain.slots(station.id);

  // The hour under way, from the 6-minute slots after the newest full hour.
  const newest = slots[0] ? Date.parse(slots[0].time) : undefined;
  const expected = newest ? Math.round((newest - end) / SLOT_MS) : 0;
  const read = slots.filter((s) => s.rr != null);
  const partial = read.reduce((sum, s) => sum + s.rr!, 0);
  const partialWhole = read.length === expected;

  // The last rain: in the hour under way to the 6 minutes, else to the hour.
  let derniere: string | undefined;
  const wetSlot = slots.find((s) => s.rr != null && s.rr > 0);
  if (wetSlot) {
    const e = Date.parse(wetSlot.time);
    derniere = `${dayWord(e - SLOT_MS, t)} entre ${hm(e - SLOT_MS)} et ${hm(e)}`;
  } else {
    const k = hours.findIndex((v) => v != null && v > 0);
    if (k >= 0) {
      const e = end - k * HOUR_MS;
      derniere = `${dayWord(e - HOUR_MS, t)} entre ${hm(e - HOUR_MS)} et ${hm(e)}`;
    }
  }
  const allRead = hours.every((v) => v != null);
  const since = end - hours.length * HOUR_MS;
  derniere ??= allRead ? `pas de pluie mesurée depuis ${dayWord(since, t)} ${hm(since)}` : "pas de pluie mesurée dans les heures disponibles";

  // Since midnight, Réunion time: the full hours that began today, then the hour under way.
  const midnight = day(t) * 24 * HOUR_MS - LOCAL_MS;
  const today = hours.filter((_, k) => end - (k + 1) * HOUR_MS >= midnight);
  const missing = today.some((v) => v == null) || !partialWhole || end - today.length * HOUR_MS > midnight;
  const total = today.reduce<number>((sum, v) => sum + (v ?? 0), 0) + partial;
  const upTo = newest ?? end;
  const cumul = `${missing ? "au moins " : ""}${mm(total)} de 0 h à ${hm(upTo)}`;

  const k0 = hours.findIndex((v) => v != null && v > 0);
  const listed = k0 >= LISTED ? hours.length : LISTED;
  const lines = hours.slice(0, listed).map((v, k) => {
    const e = end - k * HOUR_MS;
    const prefix = day(e - HOUR_MS) < day(t) ? `${dayWord(e - HOUR_MS, t)} ` : "";
    return `${prefix}${hm(e - HOUR_MS)}–${hm(e)} : ${v == null ? "non mesurée" : mm(v)}`;
  });
  if (newest) lines.unshift(`${hm(end)}–${hm(newest)} : ${partialWhole ? "" : "au moins "}${mm(partial)} (heure en cours)`);

  const avertissements = [...station.fit.avertissements];
  if (station.fit.pertinence !== "bonne") {
    avertissements.push(`Pluie mesurée à ${station.nom}, pas ${a(lieu)} : elle peut y être très différente. Ne pas dire qu'il a plu ou non ${a(lieu)} sans le préciser.`);
  }
  const bruine = drizzle
    ? "Le pluviomètre et le radar ne mesurent pas de pluie, mais le ciel est chargé : une bruine ou une pluie très faible peut leur échapper (un pluviomètre compte la pluie par 0,2 mm)."
    : undefined;
  return {
    station: station.nom,
    distance_km: station.fit.distance_km,
    ecart_altitude_m: station.fit.ecart_altitude_m,
    pertinence: station.fit.pertinence,
    nature: "mesure (pluviomètre Météo-France)",
    derniere_pluie: derniere,
    cumul_depuis_minuit: cumul,
    par_heure: lines,
    convention: CONVENTION,
    bruine,
    avertissements,
    resume: `Pluie à ${station.nom} (pluviomètre, ${fr(station.fit.distance_km)} km) : ${derniere.startsWith("pas de") ? derniere : `dernière pluie ${derniere}`} ; ${cumul} (depuis minuit).${bruine ? ` ${bruine}` : ""}`,
  };
}
