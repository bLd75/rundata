/**
 * Pioupiou / OpenWindMap wind beacons. No key, a reading every 4 minutes.
 *
 * Community licence: free for any use with attribution, on condition that every other weather sensor
 * shown alongside is open data too (no CC BY-NC source in the same answer without an extended licence).
 * https://developers.pioupiou.fr/data-licensing/
 */
import type { Cache } from "../cache.js";
import { inReunion } from "../geo.js";
import { getJson } from "../http.js";
import type { Observation, SourceInfo, Station } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "pioupiou",
  nom: "Balises de vent Pioupiou (OpenWindMap)",
  organisme: "Réseau participatif OpenWindMap",
  licence: "Licence communautaire OpenWindMap (attribution obligatoire)",
  attribution: "Wind data (c) contributors of the OpenWindMap wind network <https://openwindmap.org>",
  url: "https://developers.pioupiou.fr/api/live/",
};

const ALL = "https://api.pioupiou.fr/v1/live/all";
const ONE = "https://api.pioupiou.fr/v1/live/";
// The full list (450 KB, every beacon in the world) is only read once a day to find the ones in Réunion.
const DISCOVERY_SECONDS = 24 * 3600;
const FRESH_SECONDS = 2 * 60;
// A beacon that has not reported for this long is switched off or broken.
const MAX_SILENCE_MS = 2 * 3600 * 1000;

export interface PioupiouJson {
  id: number;
  meta: { name: string };
  location: { latitude: number | null; longitude: number | null };
  measurements: {
    date: string | null;
    wind_heading: number | null;
    wind_speed_avg: number | null;
    wind_speed_max: number | null;
  };
  status: { state: string };
}

export function station(p: PioupiouJson): Station {
  return {
    source: "pioupiou", id: String(p.id), nom: `Balise ${p.meta.name.trim()}`,
    lon: p.location.longitude!, lat: p.location.latitude!,
    // Beacons sit on take-off and landing sites; their altitude is not published. Cambaie is at sea level.
    altitude_m: p.id === 1300 ? 5 : 0,
    variables: ["vent"],
  };
}

export function inReunionBeacons(all: PioupiouJson[]): PioupiouJson[] {
  return all.filter(
    (p) => p.location.latitude != null && p.location.longitude != null && inReunion(p.location.longitude, p.location.latitude),
  );
}

export function parse(p: PioupiouJson, now: Date): Observation | null {
  const m = p.measurements;
  if (!m.date || p.status.state !== "on" || m.wind_speed_avg == null) return null;
  const time = new Date(m.date);
  if (now.getTime() - time.getTime() > MAX_SILENCE_MS) return null;
  const readings: Observation["readings"] = [
    { variable: "vent_moyen", valeur: Math.round(m.wind_speed_avg), unite: "km/h", nature: "mesure" },
  ];
  if (m.wind_heading != null) {
    readings.push({ variable: "vent_direction", valeur: Math.round(m.wind_heading), unite: "° (d'où vient le vent)", nature: "mesure" });
  }
  if (m.wind_speed_max != null) {
    readings.push({ variable: "rafales", valeur: Math.round(m.wind_speed_max), unite: "km/h", nature: "mesure" });
  }
  return { station: station(p), time, readings };
}

async function beacons(cache: Cache): Promise<PioupiouJson[]> {
  const all = await cache.get("pioupiou:all", DISCOVERY_SECONDS, async () =>
    inReunionBeacons((await getJson<{ data: PioupiouJson[] }>(SOURCE.id, ALL, 30_000)).data),
  );
  return all.value;
}

export async function observations(cache: Cache, now = new Date()) {
  const list = await beacons(cache);
  const raw = await cache.get("pioupiou:live", FRESH_SECONDS, () =>
    Promise.all(list.map(async (b) => (await getJson<{ data: PioupiouJson }>(SOURCE.id, ONE + b.id)).data)),
  );
  return { ...raw, value: raw.value.map((p) => parse(p, now)).filter((o): o is Observation => o !== null) };
}
