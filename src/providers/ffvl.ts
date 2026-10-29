/**
 * The weather beacons of the Fédération française de vol libre (FFVL), from its open data on data.gouv.fr (Licence
 * Ouverte 2.0, no key): the readings of every beacon of its network in one file, written again every 5 minutes. A
 * beacon sends a reading about every 30 minutes.
 *
 * Only the wind is kept: a beacon's temperature is taken in its box, on a roof or a pole, not under shelter, and is not
 * comparable with a station's. The beacons of La Réunion are listed here from the network's list (`balises.json`, read
 * on 30 October 2026), with what places them only: that list also names each beacon's contact, never kept.
 * https://www.data.gouv.fr/datasets/reseau-de-balises-meteo-de-la-ffvl-federation-francaise-de-vol-libre
 */
import type { Cache } from "../cache.js";
import { getJson } from "../http.js";
import type { Observation, SourceInfo, Station } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "ffvl",
  nom: "Balises météo de la FFVL",
  organisme: "Fédération française de vol libre (FFVL)",
  licence: "Licence Ouverte 2.0",
  attribution: "FFVL",
  url: "https://www.data.gouv.fr/datasets/reseau-de-balises-meteo-de-la-ffvl-federation-francaise-de-vol-libre",
};

// The stable link of the readings' file; it is redirected to the file of the moment (2 subrequests a read).
const RELEVES = "https://www.data.gouv.fr/api/1/datasets/r/047b2ab9-627f-4e5f-9d68-5b948433c61d";
/** The file is written again every 5 minutes. */
export const FRESH_SECONDS = 5 * 60;
/** A beacon sends about every 30 minutes: silent for longer than two of them and a quarter of an hour, it is left out. */
export const MAX_SILENCE_MS = 75 * 60_000;

/**
 * The beacons of La Réunion in the network's list, its test beacons left out, named as marketing chose (30/10/2026):
 * Kélonia with its accent, as the IGN writes it; the Maïdo's without « Piton … 2000 », not on the summit. Bellemène,
 * stolen in 2019, and Piton Textor, not installed, send nothing.
 */
export const BALISES: readonly { id: number; nom: string; lat: number; lon: number; altitude_m: number }[] = [
  { id: 164, nom: "Balise de Kélonia", lat: -21.1526, lon: 55.2802, altitude_m: 10 },
  { id: 169, nom: "Balise de Matouta", lat: -21.3588, lon: 55.6964, altitude_m: 445 },
  { id: 170, nom: "Balise du Maïdo", lat: -21.0595, lon: 55.3819, altitude_m: 2004 },
  { id: 171, nom: "Balise de Bellemène", lat: -21.0222, lon: 55.3219, altitude_m: 725 },
  { id: 172, nom: "Balise du Piton Textor", lat: -21.1875, lon: 55.635, altitude_m: 2124 },
  { id: 1012, nom: "Balise du Trou d'Eau", lat: -21.1013, lon: 55.2441, altitude_m: 10 },
];

/** A reading of `releves.json`: speeds in km/h, directions in degrees (where the wind comes from), its time with its offset. */
export interface Releve {
  idbalise: number;
  date?: string;
  vitesseVentMoy?: number | null;
  vitesseVentMax?: number | null;
  directVentMoy?: number | null;
}

export function station(b: (typeof BALISES)[number]): Station {
  return { source: "ffvl", id: String(b.id), nom: b.nom, lon: b.lon, lat: b.lat, altitude_m: b.altitude_m, variables: ["vent"] };
}

/** The wind of the beacons of La Réunion that sent within MAX_SILENCE_MS. */
export function parse(releves: Releve[], now: Date): Observation[] {
  const out: Observation[] = [];
  for (const b of BALISES) {
    const r = releves.find((x) => x.idbalise === b.id);
    if (!r?.date || r.vitesseVentMoy == null) continue;
    const time = new Date(r.date);
    if (Number.isNaN(time.getTime()) || now.getTime() - time.getTime() > MAX_SILENCE_MS || time.getTime() > now.getTime() + 5 * 60_000) continue;
    const readings: Observation["readings"] = [{ variable: "vent_moyen", valeur: Math.round(r.vitesseVentMoy), unite: "km/h", nature: "mesure" }];
    if (r.directVentMoy != null) readings.push({ variable: "vent_direction", valeur: Math.round(r.directVentMoy), unite: "° (d'où vient le vent)", nature: "mesure" });
    if (r.vitesseVentMax != null) readings.push({ variable: "rafales", valeur: Math.round(r.vitesseVentMax), unite: "km/h", nature: "mesure" });
    out.push({ station: station(b), time, readings });
  }
  return out;
}

export async function observations(cache: Cache, now = new Date()) {
  // Only the beacons of La Réunion are kept of the network's 190.
  const ids = new Set(BALISES.map((b) => b.id));
  const raw = await cache.get("ffvl:releves", FRESH_SECONDS, async () => (await getJson<Releve[]>(SOURCE.id, RELEVES, 20_000)).filter((r) => ids.has(r.idbalise)));
  return { ...raw, value: parse(raw.value, now) };
}
