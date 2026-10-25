/**
 * The SHOM tide gauges of La Réunion (RONIM network, REFMAR): the sea level they measure every minute, a few minutes
 * late, above the chart datum (zéro hydrographique). No key, Licence Ouverte, with a citation of its own.
 *
 * Only what was measured: the SHOM's tide predictions are not open data, so the times of high and low water given
 * here are those the gauge saw, never those to come.
 */
import type { Cache } from "../cache.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "refmar",
  nom: "Marégraphes du SHOM à La Réunion (réseau RONIM)",
  organisme: "SHOM",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "REFMAR. http://dx.doi.org/10.17183/REFMAR#RONIM",
  url: "https://data.shom.fr/donnees/refmar",
};

export interface Gauge {
  id: string;
  nom: string;
  commune: string;
  lon: number;
  lat: number;
}

export const GAUGES: Gauge[] = [
  { id: "110", nom: "Pointe des Galets", commune: "Le Port", lon: 55.285115, lat: -20.934891 },
  { id: "832", nom: "Sainte-Marie", commune: "Sainte-Marie", lon: 55.536904, lat: -20.892808 },
];

const BASE = "https://services.data.shom.fr/maregraphie/observation/json/";
// A tide is about 12 h 25 min from one high water to the next: 15 hours always hold the last high and the last low,
// with the hours around them that show they were turning points.
const WINDOW_HOURS = 15;
const FRESH_SECONDS = 5 * 60;

export interface Point {
  t: number;
  h: number;
}

interface ObservationJson {
  data: { value: number; timestamp: string }[];
}

/** « 2026/10/23 23:37:00 », in UTC. */
export function parse(json: ObservationJson): Point[] {
  return json.data
    .map((d) => ({ t: Date.parse(d.timestamp.replace(/\//g, "-").replace(" ", "T") + "Z"), h: d.value }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.h))
    .sort((a, b) => a.t - b.t);
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");

export async function series(cache: Cache, gauge: Gauge, now = new Date()) {
  return cache.get(`maree:${gauge.id}`, FRESH_SECONDS, async () => {
    const end = now.getTime();
    const url = `${BASE}${gauge.id}?sources=1&dtStart=${iso(end - WINDOW_HOURS * 3600_000)}&dtEnd=${iso(end)}`;
    return parse(await getJson<ObservationJson>(SOURCE.id, url));
  });
}

export interface Extremum {
  type: "pleine_mer" | "basse_mer";
  t: number;
  h: number;
}

export interface Reading {
  /** The level now: the mean of the last minutes, as the sea swells by a few centimetres from one minute to the next. */
  h: number;
  t: number;
  tendance: "montante" | "descendante" | "étale";
  extremes: Extremum[];
}

/** Moving mean over ± half a window, for the turning points and the trend. */
function smooth(points: Point[], halfMinutes: number): Point[] {
  const half = halfMinutes * 60_000;
  let lo = 0;
  let hi = 0;
  let sum = 0;
  return points.map((p) => {
    while (hi < points.length && points[hi].t <= p.t + half) sum += points[hi++].h;
    while (points[lo].t < p.t - half) sum -= points[lo++].h;
    return { t: p.t, h: sum / (hi - lo) };
  });
}

export function read(points: Point[]): Reading | null {
  if (points.length < 30) return null;
  const last = points[points.length - 1];
  const recent = points.filter((p) => p.t > last.t - 5 * 60_000);
  const h = recent.reduce((s, p) => s + p.h, 0) / recent.length;

  const s = smooth(points, 15);
  // Rising or falling by more than 2 cm over the last half hour; less is the slack of the turn.
  const before = [...s].reverse().find((p) => p.t <= last.t - 30 * 60_000);
  const now = s[s.length - 1];
  const d = before ? now.h - before.h : 0;
  const tendance = d > 0.02 ? "montante" : d < -0.02 ? "descendante" : "étale";

  // A turning point is the highest (lowest) of the smoothed curve within 2 h 30 on each side (the next one is about
  // 6 hours away), which the data must reach on both sides: a high water still going on is not one yet.
  const extremes: Extremum[] = [];
  const span = 2.5 * 3600_000;
  for (let i = 0; i < s.length; i++) {
    const p = s[i];
    if (p.t - s[0].t < span || last.t - p.t < span / 3) continue;
    const around = s.filter((q) => Math.abs(q.t - p.t) <= span);
    if (around.every((q) => q.h <= p.h)) extremes.push({ type: "pleine_mer", t: p.t, h: p.h });
    else if (around.every((q) => q.h >= p.h)) extremes.push({ type: "basse_mer", t: p.t, h: p.h });
  }
  // Two equal points on a flat top would make two: keep the first of each run.
  const turns = extremes.filter((e, i) => i === 0 || extremes[i - 1].type !== e.type);
  return { h: Math.round(h * 100) / 100, t: last.t, tendance, extremes: turns.map((e) => ({ ...e, h: Math.round(e.h * 100) / 100 })) };
}
