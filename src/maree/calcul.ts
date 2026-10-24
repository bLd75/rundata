/**
 * The tide computed by rundata from the SHOM gauges' measurements: the harmonic constants fitted offline by
 * scripts/build-maree.py (constantes.json), summed here for the hours to come, without any request. Not the SHOM's
 * prediction, which is not open data: the answers say so, and cite REFMAR.
 *
 * The formulas are those of the script, line for line (astronomy, Schureman's nodal corrections, the sum, and the rule
 * that finds the high and low waters), so that what the server computes is what the script checked against a month of
 * measurements it did not use.
 */
import data from "./constantes.json" with { type: "json" };

export const LABEL = "calcul de rundata d'après les mesures, pas la prédiction officielle du SHOM";
export const CITATION = data.citation;

const D = Math.PI / 180;

function astro(t: number) {
  const c = (t / 86400 + 2440587.5 - 2451545.0) / 36525;
  return {
    T: 180 + 15 * (t / 3600),
    s: 218.3164477 + 481267.88123421 * c,
    h: 280.46646 + 36000.76983 * c,
    p: 83.3532465 + 4069.0137287 * c,
    N: 125.04452 - 1934.136261 * c,
    p1: 282.94 + 1.7192 * c,
  };
}

type Base = "Mm" | "Mf" | "O1" | "J1" | "OO1" | "M2" | "K1" | "K2";

function nodal(N: number): Record<Base, [number, number]> {
  const n = N * D;
  const i = 5.145 * D;
  const w = 23.452 * D;
  const I = Math.acos(Math.cos(w) * Math.cos(i) - Math.sin(w) * Math.sin(i) * Math.cos(n));
  const e1 = Math.atan((Math.cos(0.5 * (w - i)) / Math.cos(0.5 * (w + i))) * Math.tan(0.5 * n)) - 0.5 * n;
  const e2 = Math.atan((Math.sin(0.5 * (w - i)) / Math.sin(0.5 * (w + i))) * Math.tan(0.5 * n)) - 0.5 * n;
  const xi = -(e1 + e2);
  const nu = e1 - e2;
  const nup = Math.atan2(Math.sin(2 * I) * Math.sin(nu), Math.sin(2 * I) * Math.cos(nu) + 0.3347);
  const nupp2 = Math.atan2(Math.sin(I) ** 2 * Math.sin(2 * nu), Math.sin(I) ** 2 * Math.cos(2 * nu) + 0.0727);
  const sI = Math.sin(I);
  const s2I = Math.sin(2 * I);
  return {
    Mm: [(2 / 3 - sI ** 2) / 0.5021, 0],
    Mf: [sI ** 2 / 0.1578, (-2 * xi) / D],
    O1: [(sI * Math.cos(I / 2) ** 2) / 0.38, (2 * xi - nu) / D],
    J1: [s2I / 0.7214, -nu / D],
    OO1: [(sI * Math.sin(I / 2) ** 2) / 0.0164, (-2 * xi - nu) / D],
    M2: [Math.cos(I / 2) ** 4 / 0.9154, (2 * xi - 2 * nu) / D],
    K1: [Math.sqrt(0.8965 * s2I ** 2 + 0.6001 * s2I * Math.cos(nu) + 0.1006), -nup / D],
    K2: [Math.sqrt(19.0444 * sI ** 4 + 2.7702 * sI ** 2 * Math.cos(2 * nu) + 0.0981), -nupp2 / D],
  };
}

// name: multipliers of (T, s, h, p, p1), phase in degrees, nodal factors as [base, power].
const CONSTITUENTS: Record<string, [number[], number, [Base, number][]]> = {
  Sa: [[0, 0, 1, 0, 0], 0, []],
  Ssa: [[0, 0, 2, 0, 0], 0, []],
  Mm: [[0, 1, 0, -1, 0], 0, [["Mm", 1]]],
  Mf: [[0, 2, 0, 0, 0], 0, [["Mf", 1]]],
  "2Q1": [[1, -4, 1, 2, 0], 90, [["O1", 1]]],
  Q1: [[1, -3, 1, 1, 0], 90, [["O1", 1]]],
  RHO1: [[1, -3, 3, -1, 0], 90, [["O1", 1]]],
  O1: [[1, -2, 1, 0, 0], 90, [["O1", 1]]],
  P1: [[1, 0, -1, 0, 0], 90, []],
  S1: [[1, 0, 0, 0, 0], 180, []],
  K1: [[1, 0, 1, 0, 0], -90, [["K1", 1]]],
  J1: [[1, 1, 1, -1, 0], -90, [["J1", 1]]],
  OO1: [[1, 2, 1, 0, 0], -90, [["OO1", 1]]],
  "2N2": [[2, -4, 2, 2, 0], 0, [["M2", 1]]],
  MU2: [[2, -4, 4, 0, 0], 0, [["M2", 1]]],
  N2: [[2, -3, 2, 1, 0], 0, [["M2", 1]]],
  NU2: [[2, -3, 4, -1, 0], 0, [["M2", 1]]],
  M2: [[2, -2, 2, 0, 0], 0, [["M2", 1]]],
  L2: [[2, -1, 2, -1, 0], 180, [["M2", 1]]],
  T2: [[2, 0, -1, 0, 1], 0, []],
  S2: [[2, 0, 0, 0, 0], 0, []],
  K2: [[2, 0, 2, 0, 0], 0, [["K2", 1]]],
  MO3: [[3, -4, 3, 0, 0], 90, [["M2", 1], ["O1", 1]]],
  M3: [[3, -3, 3, 0, 0], 0, [["M2", 1.5]]],
  MK3: [[3, -2, 3, 0, 0], -90, [["M2", 1], ["K1", 1]]],
  MN4: [[4, -5, 4, 1, 0], 0, [["M2", 2]]],
  M4: [[4, -4, 4, 0, 0], 0, [["M2", 2]]],
  MS4: [[4, -2, 2, 0, 0], 0, [["M2", 1]]],
  S4: [[4, 0, 0, 0, 0], 0, []],
  M6: [[6, -6, 6, 0, 0], 0, [["M2", 3]]],
  "2MS6": [[6, -4, 4, 0, 0], 0, [["M2", 2]]],
};

export interface Constants {
  nom: string;
  z0: number;
  constantes: (string | number)[][];
  controle: Check | null;
}

export interface Check {
  mois: string;
  ecart_heure_min: { mediane: number; p90: number; max: number };
  ecart_hauteur_cm: { mediane: number; p90: number; max: number };
  /** Corrected by the gauge's measurement of the hours before, as the server does. */
  ecart_hauteur_recalee_cm?: { mediane: number; p90: number; max: number };
  part_sous_10_min: number;
  part_sous_5_cm: number;
}

/** The constants of a gauge (110 Pointe des Galets, 832 Sainte-Marie), if the script could fit them. */
export function constantsOf(gauge: string): Constants | undefined {
  return (data.maregraphes as Record<string, Constants>)[gauge];
}

/**
 * The height at `t` (seconds since 1970, UTC), in metres above the chart datum. `nod`: the nodal corrections when the
 * caller has them already; they move by 0.05° of the node a day, nothing over a day or two.
 */
export function height(c: Constants, t: number, nod = nodal(astro(t).N)): number {
  return sum(c.z0, terms(c, nod), t);
}

interface Term {
  k: number[];
  /** Phase + nodal angle − phase lag, in degrees. */
  shift: number;
  /** Nodal factor × amplitude. */
  amp: number;
}

/** Each constituent's factors for a given node: worked out once for all the points of a computation. */
function terms(c: Constants, nod: Record<Base, [number, number]>): Term[] {
  return (c.constantes as [string, number, number][]).map(([name, amp, g]) => {
    const [k, phase, factors] = CONSTITUENTS[name];
    let f = 1;
    let u = 0;
    for (const [base, power] of factors) {
      f *= nod[base][0] ** power;
      u += power * nod[base][1];
    }
    return { k, shift: phase + u - g, amp: f * amp };
  });
}

function sum(z0: number, ts: Term[], t: number): number {
  const a = astro(t);
  let h = z0;
  for (const { k, shift, amp } of ts) {
    const v = k[0] * a.T + k[1] * a.s + k[2] * a.h + k[3] * a.p + k[4] * a.p1 + shift;
    h += amp * Math.cos((v % 360) * D);
  }
  return h;
}

interface Point {
  t: number;
  h: number;
}

function smooth(points: Point[], half: number): Point[] {
  const out: Point[] = [];
  let lo = 0;
  let hi = 0;
  let total = 0;
  for (const p of points) {
    while (hi < points.length && points[hi].t <= p.t + half) total += points[hi++].h;
    while (points[lo].t < p.t - half) total -= points[lo++].h;
    out.push({ t: p.t, h: total / (hi - lo) });
  }
  return out;
}

export interface Turn {
  type: "pleine_mer" | "basse_mer";
  /** Seconds since 1970, UTC. */
  t: number;
  h: number;
}

/** The highest (lowest) point within ± span, refined by a parabola: the script's rule. */
function turns(points: Point[], span = 2.5 * 3600): Turn[] {
  const out: Turn[] = [];
  let j0 = 0;
  points.forEach((p, i) => {
    while (points[j0].t < p.t - span) j0++;
    if (p.t - points[0].t < span || points[points.length - 1].t - p.t < span) return;
    let hi = true;
    let lo = true;
    for (let j = j0; j < points.length && points[j].t <= p.t + span; j++) {
      if (points[j].h > p.h) hi = false;
      if (points[j].h < p.h) lo = false;
    }
    if (!hi && !lo) return;
    let t = p.t;
    if (i > 0 && i < points.length - 1) {
      const [a, b, c] = [points[i - 1].h, p.h, points[i + 1].h];
      const den = a - 2 * b + c;
      if (den) t += ((0.5 * (a - c)) / den) * (points[i + 1].t - p.t);
    }
    out.push({ type: hi ? "pleine_mer" : "basse_mer", t, h: p.h });
  });
  return out.filter((e, k) => k === 0 || out[k - 1].type !== e.type);
}

const STEP = 600;
const SMOOTH = 1800;
const MARGIN = 3 * 3600;

/** The high and low waters computed from `from` (seconds) over `hours`. */
export function nextTurns(c: Constants, from: number, hours: number): Turn[] {
  const start = Math.floor((from - MARGIN) / STEP) * STEP;
  const ts = terms(c, nodal(astro(from).N));
  const points: Point[] = [];
  for (let t = start; t <= from + hours * 3600 + MARGIN; t += STEP) points.push({ t, h: sum(c.z0, ts, t) });
  return turns(smooth(points, SMOOTH)).filter((e) => e.t >= from && e.t <= from + hours * 3600);
}
