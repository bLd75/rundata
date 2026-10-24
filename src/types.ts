/**
 * What kind of number this is. Measurements and forecasts never share an answer: forecasts only come out of
 * the prevision_meteo tool, labelled as such.
 */
export type Nature =
  | "mesure" // in situ sensor reading
  | "mesure_satellite" // satellite radiometer reading, not interpolated
  | "derive" // computed from measurements (e.g. humidity from temperature and dew point)
  | "prevision"; // numerical weather model output

export interface Station {
  source: string;
  id: string;
  nom: string;
  lon: number;
  lat: number;
  altitude_m: number;
  /** What the station measures, in the vocabulary of Reading.variable. */
  variables: string[];
}

export interface Reading {
  variable: string;
  valeur: number | string;
  unite?: string;
  nature: Nature;
}

export interface Observation {
  station: Station;
  time: Date;
  readings: Reading[];
  /** The upstream message as received (METAR text…), for whoever wants to check. */
  brut?: string;
}

export interface SourceInfo {
  id: string;
  nom: string;
  organisme: string;
  licence: string;
  attribution: string;
  url: string;
}

/** Thrown when an upstream source cannot be reached and nothing is cached. */
export class UpstreamError extends Error {
  constructor(public source: string, message: string, public status?: number) {
    super(`${source}: ${message}`);
  }
}

/** An error as text, for console.error: the Worker's logs keep only the stack of an Error, without its message. */
export function why(err: unknown): string {
  if (err instanceof UpstreamError) return err.message;
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}

export interface ForecastModel {
  nom: string;
  /** Grid spacing: nothing smaller than this is resolved (a cirque, one side of a ridge). */
  maille_km: number;
  echeance_jours: number;
  mise_a_jour: string;
}

/** One stretch of a forecast: an hour (ECMWF) or three (AROME), from `time`. */
export interface ForecastHour {
  time: Date;
  duree_h: number;
  /** At `time`. */
  temperature: number | null;
  /** Over the stretch. */
  pluie_mm: number | null;
  /** WMO weather code. */
  code: number | null;
  nuages_pct: number | null;
  vent_kmh: number | null;
  /** Strongest gust of the stretch. */
  rafales_kmh: number | null;
  vent_dir: number | null;
  /** The cloud layer over the place's cell (AROME only): null for no cloud, or no top above the base. */
  nuages_base_m?: number | null;
  nuages_sommet_m?: number | null;
  /** The model it comes from, when an answer mixes two. */
  modele?: ForecastModel;
}

export interface ForecastDay {
  /** Local date, "2026-10-23". */
  date: string;
  code: number | null;
  tmin: number | null;
  tmax: number | null;
  pluie_mm: number | null;
  rafales_max_kmh: number | null;
  /** Which model gave which hours, when the day mixes two. */
  modeles?: string;
}

/** A model forecast at one place, whatever the model. */
export interface Forecast {
  model: ForecastModel;
  source: SourceInfo;
  /** Start of the model run, when the source says. */
  runAt?: Date;
  /** Centre of the grid cell the values come from. */
  grid: { lat: number; lon: number };
  /** Altitude the temperatures were brought to. */
  altitude_m: number;
  /** Height of the model's (smoothed) terrain at the place, when known. */
  relief_m?: number;
  /** Later hours that come from another run of the same model (the newest one is not all out yet). */
  suite?: { runAt: Date; from: Date }[];
  /** Other models whose values fill in where this one stops. */
  relais?: { model: ForecastModel; source: SourceInfo; runAt?: Date; from: Date }[];
  hours: ForecastHour[];
  days: ForecastDay[];
}
