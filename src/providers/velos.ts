/**
 * Altervélo, the shared bikes of the CIVIS (Saint-Pierre, Saint-Louis, L'Étang-Salé): its GBFS v3 feed, run by
 * Ecovélo. No key, live (ttl 0), Licence Ouverte.
 *
 * Only the stations are read. The feed also lists bikes outside any station, but many of these are flat or
 * gathered at the workshop: one cannot count on them.
 */
import type { Cache } from "../cache.js";
import { getJson } from "../http.js";
import { communeAt } from "../places/resolve.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "altervelo",
  nom: "Altervélo, vélos en libre-service de la CIVIS (flux GBFS)",
  organisme: "CIVIS, exploité par Ecovélo",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Altervélo, CIVIS / Ecovélo, via transport.data.gouv.fr",
  url: "https://transport.data.gouv.fr/datasets/velos-a-assistance-electrique-en-libre-service-saint-pierre-la-reunion-civis-altervelo",
};

const BASE = "https://api.gbfs.v3.0.ecovelo.mobi/altervelo/";
// Stations move a few times a year; their status is read again every minute at most.
const INFO_SECONDS = 24 * 3600;
const STATUS_SECONDS = 60;

/** What each kind of vehicle of the feed is, in words. */
export const KINDS: Record<string, "velo" | "trottinette"> = { titibike: "velo", x2: "velo", knot: "trottinette", pony: "trottinette" };

export interface InfoJson {
  station_id: string;
  name: { language: string; text: string }[];
  lat: number;
  lon: number;
  capacity?: number;
}

export interface StatusJson {
  station_id: string;
  is_installed: boolean;
  is_renting: boolean;
  is_returning: boolean;
  last_reported: string;
  num_vehicles_available: number;
  num_docks_available?: number;
  vehicle_types_available?: { vehicle_type_id: string; count: number }[];
}

export interface Station {
  id: string;
  nom: string;
  commune: string;
  lon: number;
  lat: number;
  capacite?: number;
}

export interface StationNow extends Station {
  /** Electric bikes and scooters ready to take. */
  velos: number;
  trottinettes: number;
  /** Free docks to leave one. */
  places?: number;
  /** False when the station is shut, or renting or taking back nothing. */
  location: boolean;
  retour: boolean;
  /** ISO time the station last reported. */
  maj: string;
}

/** The stations, without the operator's test station. */
export function parseInfo(list: InfoJson[]): Station[] {
  return list
    .filter((s) => !/^test$/i.test(s.name[0]?.text.trim() ?? "") && (s.capacity ?? 2) > 1)
    .map((s) => ({
      id: s.station_id,
      nom: (s.name.find((n) => n.language === "fr") ?? s.name[0]).text.trim(),
      commune: communeAt(s.lon, s.lat),
      lon: s.lon,
      lat: s.lat,
      ...(s.capacity ? { capacite: s.capacity } : {}),
    }));
}

/** Each station with what it has now; a station the status leaves out is left out. */
export function merge(stations: Station[], status: StatusJson[]): StationNow[] {
  const by = new Map(status.map((s) => [s.station_id, s]));
  return stations.flatMap((s) => {
    const x = by.get(s.id);
    if (!x) return [];
    const count = (kind: string) =>
      x.vehicle_types_available
        ? x.vehicle_types_available.filter((t) => KINDS[t.vehicle_type_id] === kind).reduce((n, t) => n + t.count, 0)
        : kind === "velo" ? x.num_vehicles_available : 0;
    return [{
      ...s,
      velos: count("velo"),
      trottinettes: count("trottinette"),
      ...(x.num_docks_available != null ? { places: x.num_docks_available } : {}),
      location: x.is_installed && x.is_renting,
      retour: x.is_installed && x.is_returning,
      maj: new Date(x.last_reported).toISOString(),
    }];
  });
}

/** The stations, without their bikes: read again once a day (/chiffres counts them). */
export const info = (cache: Cache) =>
  cache.get("velos:info", INFO_SECONDS, async () =>
    parseInfo((await getJson<{ data: { stations: InfoJson[] } }>(SOURCE.id, `${BASE}station_information.json`)).data.stations),
  );

export async function stations(cache: Cache) {
  const [fixed, status] = await Promise.all([
    info(cache),
    cache.get("velos:status", STATUS_SECONDS, async () =>
      (await getJson<{ data: { stations: StatusJson[] } }>(SOURCE.id, `${BASE}station_status.json`)).data.stations,
    ),
  ]);
  return { value: merge(fixed.value, status.value), fetchedAt: status.fetchedAt, stale: fixed.stale || status.stale };
}
