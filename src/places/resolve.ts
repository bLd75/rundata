/**
 * Free-text place → point with altitude. "plage de l'Hermitage", "St Pierre", "cilaos", "-21.05, 55.22".
 * Built on src/places/gazetteer.json (scripts/build-gazetteer.py): communes, villages, quartiers, beaches,
 * peaks, viewpoints and freshwater pools from OpenStreetMap, with IGN altitudes.
 */
import gazetteer from "./gazetteer.json" with { type: "json" };
import { inReunion } from "../geo.js";

export interface Place {
  nom: string;
  type: string;
  lon: number;
  lat: number;
  altitude_m: number | null;
  commune: string;
  population?: number;
}

export interface Resolution {
  lieu: Place;
  correspondance: "exacte" | "partielle" | "approchee" | "coordonnees";
  /** Other places the text could mean, when the match is not exact. */
  autres: Place[];
}

// Words that carry no identity ("plage de la …"), dropped from both the question and the names.
const FILLER = new Set([
  "a", "au", "aux", "d", "de", "des", "du", "en", "l", "la", "le", "les", "sur", "pres", "vers", "cote", "plage",
  "commune", "ville", "quartier", "ile", "reunion", "974", "the", "beach", "in", "at", "near", "town",
]);
const SPELLING: Record<string, string> = { st: "saint", ste: "sainte", hermitage: "ermitage" };
const BEACH_WORDS = /\b(plage|beach|lagon|baignade|se baigner)\b/;

// When several places match equally well, the more common meaning wins.
const RANK: Record<string, number> = {
  commune: 0, localite: 1, plage: 2, quartier: 3, sommet: 4, point_de_vue: 5, bassin: 6, port: 7, baie: 8,
  cap: 9, lieu_dit: 10,
};

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .map((t) => SPELLING[t] ?? t)
    .filter((t) => t && !FILLER.has(t));
}

interface Entry {
  place: Place;
  tokens: string[];
  key: string;
  alias: boolean;
}

const PLACES = gazetteer.places as Place[];
const byName = new Map(PLACES.map((p) => [p.nom, p]));
const INDEX: Entry[] = [
  ...PLACES.map((place) => ({ place, tokens: tokens(place.nom), alias: false })),
  ...Object.entries(gazetteer.aliases as Record<string, string>).map(([alias, target]) => ({
    place: byName.get(target)!,
    tokens: tokens(alias),
    alias: true,
  })),
]
  .filter((e) => e.tokens.length > 0)
  .map((e) => ({ ...e, key: e.tokens.join(" ") }));

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

function similar(a: string, b: string): number {
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function score(q: string[], e: Entry): { score: number; kind: Resolution["correspondance"] } | null {
  const qk = q.join(" ");
  if (qk === e.key) return { score: e.alias ? 101 : 100, kind: "exacte" };
  const inName = q.every((t) => e.tokens.includes(t));
  if (inName) return { score: 80 - 3 * (e.tokens.length - q.length), kind: "partielle" };
  // The question carries extra words around the name ("il fait beau à cilaos aujourd'hui").
  const inQuestion = e.tokens.every((t) => q.includes(t));
  if (inQuestion) return { score: 50 + 5 * e.tokens.length, kind: "partielle" };
  // Typos: every name token close to some question token.
  if (e.tokens.length <= q.length + 1) {
    const sims = e.tokens.map((t) => Math.max(...q.map((u) => similar(t, u))));
    const avg = sims.reduce((a, b) => a + b, 0) / sims.length;
    if (Math.min(...sims) >= 0.7 && avg >= 0.8) return { score: 40 * avg, kind: "approchee" };
  }
  return null;
}

const COORDS = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/;

export function resolvePlace(text: string): Resolution | null {
  const m = COORDS.exec(text);
  if (m) {
    let [a, b] = [parseFloat(m[1].replace(",", ".")), parseFloat(m[2].replace(",", "."))];
    if (Math.abs(a) > 50) [a, b] = [b, a]; // "55.22, -21.05": longitude first
    if (!inReunion(b, a)) return null;
    return {
      lieu: { nom: `${a.toFixed(4)}, ${b.toFixed(4)}`, type: "coordonnees", lon: b, lat: a, altitude_m: null, commune: "" },
      correspondance: "coordonnees",
      autres: [],
    };
  }

  const q = tokens(text);
  if (q.length === 0) return null;
  const wantsBeach = BEACH_WORDS.test(normalize(text));
  const rank = (p: Place) => (wantsBeach && p.type === "plage" ? -1 : RANK[p.type] ?? 99);

  const matches = INDEX.flatMap((e) => {
    const s = score(q, e);
    return s ? [{ ...s, place: e.place }] : [];
  }).sort(
    (x, y) =>
      y.score - x.score || rank(x.place) - rank(y.place) || (y.place.population ?? 0) - (x.place.population ?? 0),
  );
  if (matches.length === 0) return null;

  const best = matches[0];
  const seen = new Set([best.place.nom]);
  const autres: Place[] = [];
  if (best.kind !== "exacte") {
    for (const m of matches.slice(1)) {
      if (autres.length >= 3) break;
      if (!seen.has(m.place.nom)) {
        seen.add(m.place.nom);
        autres.push(m.place);
      }
    }
  }
  return { lieu: best.place, correspondance: best.kind, autres };
}

export const GAZETTEER_ATTRIBUTION: string = gazetteer.attribution;
