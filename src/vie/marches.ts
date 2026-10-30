/**
 * The markets of La Réunion as OpenStreetMap maps them (src/vie/marches.json, scripts/build-marches.py): the forains
 * and the covered markets its contributors have mapped, with their days and hours when given. Not all of them.
 */
import { distanceKm } from "../geo.js";
import { communeAt } from "../places/resolve.js";
import { minutees, paire } from "../tools/format.js";
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
  licence: "ODbL 1.0",
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

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
/** « 06:00 » → minutes after midnight. */
const minutes = (t: string) => {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m ?? 0);
};

/**
 * The spans of a place's hours on the day of `now` at La Réunion, in minutes after midnight, from its OpenStreetMap
 * rules (« Fr 08:00-18:00;Sa 08:00-12:00 », « Mo-Sa 07:00-17:00 »), or undefined when it is not open that day or its
 * days are not given in that form.
 */
export function spansOn(m: Pick<Marche, "horaires_osm">, now: Date): [number, number][] | undefined {
  const today = new Date(now.getTime() + 4 * 3600_000).getUTCDay();
  for (const rule of (m.horaires_osm ?? "").split(";")) {
    const r = RULE.exec(rule);
    if (!r) continue;
    const held = r[1].split(",").some((d) => {
      const [from, to = from] = d.split("-").map((x) => DAYS.indexOf(x));
      return from >= 0 && to >= 0 && (from <= to ? from <= today && today <= to : today >= from || today <= to);
    });
    if (held) return spansOf(r[2]);
  }
  return undefined;
}

const RULE = /^\s*([A-Za-z,-]+)\s+([\d:,\s-]+)$/;
const spansOf = (times: string) => times.split(",").map((span) => span.trim().split("-").map(minutes) as [number, number]);

/** Whether a place's hours are written with their minutes, on every day: when one of its times, any day, has some (minutees()). */
export const withMinutes = (m: Pick<Marche, "horaires_osm">) =>
  minutees((m.horaires_osm ?? "").split(";").flatMap((rule) => {
    const r = RULE.exec(rule);
    return r ? spansOf(r[2]) : [];
  }));

/**
 * The hours of a market on the day of `now` (spansOn()): « de 8 h à 18 h », « de 06:00 à 12:00 » when another of its
 * times has minutes (withMinutes()), or undefined when it is not held that day.
 */
export const hoursOn = (m: Pick<Marche, "horaires_osm">, now: Date) => {
  const all = withMinutes(m);
  return spansOn(m, now)?.map(([de, a]) => `de ${paire(de, a, all).join(" à ")}`).join(" et ");
};

/** The commune's markets held on the day of `now`, with their hours that day. */
export const heldOn = (commune: string, now: Date) =>
  inCommune(commune).flatMap((m) => {
    const h = hoursOn(m, now);
    return h ? [{ ...m, horaires_aujourd_hui: h }] : [];
  });
