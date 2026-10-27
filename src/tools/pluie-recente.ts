/**
 * « Il a plu quand ? » for a place: the rain of the last hours at the nearest rain gauge, hour by hour, the time of
 * the last rain and the total since midnight, from the Météo-France stations (meteofrance.ts, hourly package and
 * 6-minute slots). Réunion time is UTC+4 all year.
 */
import { a, fr, heure, paire, tranche } from "./format.js";
import type { RecentRain } from "../providers/meteofrance.js";
import type { Fit } from "./representativeness.js";

const HOUR_MS = 3_600_000;
const SLOT_MS = 6 * 60_000;
const LOCAL_MS = 4 * HOUR_MS;
// Hours listed: twelve, or all the hours kept when the last rain is older.
const LISTED = 12;
// Past this, the newest hour is not late: its copy is stuck (meteofrance.ts serves its last copy when it cannot read it).
const STUCK_MS = 90 * 60_000;

/** Every hour, how it is written: one hour from the first time to the second, Réunion time. */
export const CONVENTION =
  "Chaque ligne va de la première heure à la seconde (heure de La Réunion) : « 14\u00a0h–15\u00a0h : 1,4 mm », c'est la pluie tombée entre 14\u00a0h et 15\u00a0h.";

const day = (ms: number) => Math.floor((ms + LOCAL_MS) / (24 * HOUR_MS));
/** Minutes since midnight, Réunion time; the times written by format.ts (« 19:12 », « 18\u00a0h », « 18\u00a0h–19\u00a0h »). */
const mins = (ms: number) => {
  const d = new Date(ms + LOCAL_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const hm = (ms: number) => heure(mins(ms));
const span = (from: number, to: number) => tranche(mins(from), mins(to));
const between = (from: number, to: number) => paire(mins(from), mins(to));
/** « aujourd'hui », « hier », or the date, for the day `ms` falls in. */
const dayWord = (ms: number, now: number) =>
  day(ms) === day(now) ? "aujourd'hui" : day(ms) === day(now) - 1 ? "hier" : new Date(ms + LOCAL_MS).toISOString().slice(8, 10) + "/" + new Date(ms + LOCAL_MS).toISOString().slice(5, 7);
const mm = (x: number) => `${fr(Math.round(x * 10) / 10)} mm`;

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
  // The hours stuck on an old copy: the slots kept (an hour) start well after its end, the time between was not read.
  const first = slots.length ? Date.parse(slots.at(-1)!.time) - SLOT_MS : end;
  const stuck = newest != null && newest - end > STUCK_MS && first > end;
  const from = stuck ? first : end;
  const expected = newest ? Math.round((newest - from) / SLOT_MS) : 0;
  const read = slots.filter((s) => s.rr != null);
  const partial = read.reduce((sum, s) => sum + s.rr!, 0);
  const partialWhole = read.length === expected;

  // The last rain: in the hour under way to the 6 minutes, else to the hour.
  let derniere: string | undefined;
  const wetSlot = slots.find((s) => s.rr != null && s.rr > 0);
  if (wetSlot) {
    const e = Date.parse(wetSlot.time);
    const [x, y] = between(e - SLOT_MS, e);
    derniere = `${dayWord(e - SLOT_MS, t)} entre ${x} et ${y}`;
  } else {
    const k = hours.findIndex((v) => v != null && v > 0);
    if (k >= 0) {
      const e = end - k * HOUR_MS;
      // Before hours not read: it may have rained since (marketing).
      const [g0, g1] = between(end, from);
      const gap = stuck ? ` (de ${g0} à ${g1}, non lue : il a pu pleuvoir pendant ce temps)` : "";
      const [x, y] = between(e - HOUR_MS, e);
      derniere = `${dayWord(e - HOUR_MS, t)} entre ${x} et ${y}${gap}`;
    }
  }
  const allRead = !stuck && hours.every((v) => v != null);
  const since = end - hours.length * HOUR_MS;
  // The hours not read said, or an assistant would read a dry evening into it (marketing).
  const [u0, u1] = between(end, from);
  const unread = stuck ? ` (de ${u0} à ${u1}, non lue)` : "";
  derniere ??= allRead ? `pas de pluie mesurée depuis ${dayWord(since, t)} ${hm(since)}` : `pas de pluie mesurée dans les heures disponibles${unread}`;

  // Since midnight, Réunion time: the full hours that began today, then the hour under way.
  const midnight = day(t) * 24 * HOUR_MS - LOCAL_MS;
  const today = hours.filter((_, k) => end - (k + 1) * HOUR_MS >= midnight);
  const missing = stuck || today.some((v) => v == null) || !partialWhole || end - today.length * HOUR_MS > midnight;
  const total = today.reduce<number>((sum, v) => sum + (v ?? 0), 0) + partial;
  const upTo = newest ?? end;
  const [c0, c1] = paire(0, mins(upTo));
  const cumul = `${missing ? "au moins " : ""}${mm(total)} de ${c0} à ${c1}`;

  const k0 = hours.findIndex((v) => v != null && v > 0);
  const listed = k0 >= LISTED ? hours.length : LISTED;
  const lines = hours.slice(0, listed).map((v, k) => {
    const e = end - k * HOUR_MS;
    const prefix = day(e - HOUR_MS) < day(t) ? `${dayWord(e - HOUR_MS, t)} ` : "";
    return `${prefix}${span(e - HOUR_MS, e)} : ${v == null ? "non mesurée" : mm(v)}`;
  });
  if (stuck) lines.unshift(`${day(end) < day(t) ? `${dayWord(end, t)} ` : ""}${span(end, from)} : non lue (notre lecture n'a pas abouti)`);
  if (newest) lines.unshift(`${span(from, newest)} : ${partialWhole ? "" : "au moins "}${mm(partial)} (${stuck ? "dernières mesures lues, toutes les 6 minutes" : "heure en cours"})`);

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
    resume: `Pluie à ${station.nom} (pluviomètre, ${fr(station.fit.distance_km)} km) : ${derniere.startsWith("pas de") ? derniere : `dernière pluie ${derniere}`}\u00a0; ${cumul} (depuis minuit).${bruine ? ` ${bruine}` : ""}`,
  };
}
