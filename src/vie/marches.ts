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

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
/** « 06:00 » → « 6 h », « 18:30 » → « 18 h 30 ». */
const hour = (t: string) => {
  const [h, m] = t.split(":");
  return `${Number(h)} h${m && m !== "00" ? ` ${m}` : ""}`;
};

/**
 * The hours of a market on the day of `now` at La Réunion, from its OpenStreetMap rules (« Fr 08:00-18:00;Sa
 * 08:00-12:00 », « Mo-Sa 07:00-17:00 »): « de 8 h à 18 h », or undefined when it is not held that day or its days are
 * not given in that form.
 */
export function hoursOn(m: Marche, now: Date): string | undefined {
  const today = new Date(now.getTime() + 4 * 3600_000).getUTCDay();
  for (const rule of (m.horaires_osm ?? "").split(";")) {
    const r = /^\s*([A-Za-z,-]+)\s+([\d:,\s-]+)$/.exec(rule);
    if (!r) continue;
    const held = r[1].split(",").some((d) => {
      const [from, to = from] = d.split("-").map((x) => DAYS.indexOf(x));
      return from >= 0 && to >= 0 && (from <= to ? from <= today && today <= to : today >= from || today <= to);
    });
    if (held) return r[2].split(",").map((span) => span.trim().split("-").map(hour)).map(([de, a]) => `de ${de} à ${a}`).join(" et ");
  }
  return undefined;
}

/** The commune's markets held on the day of `now`, with their hours that day. */
export const heldOn = (commune: string, now: Date) =>
  inCommune(commune).flatMap((m) => {
    const h = hoursOn(m, now);
    return h ? [{ ...m, horaires_aujourd_hui: h }] : [];
  });
