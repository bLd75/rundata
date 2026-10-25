/**
 * The GPS traces of the hikes, as GPX files:
 * - the hiking routes of OpenStreetMap (GR R1, R2, R3, Piton des Neiges, Roche Écrite, Dolomieu…), whole from start to
 *   end, bundled with the server with their altitudes, climb and descent (src/traces/traces.json,
 *   scripts/build-traces.py), and the ONF trails each follows, whose state is read live;
 * - every trail of the ONF's map, read from the ONF when asked (one request, the trail's own line at full resolution,
 *   with its state), the altitude of each point from the IGN (one request, kept a month: the ground does not move).
 *   Its climb and descent, for the lists, come from the bundle.
 */
import type { Cache, Cached } from "../cache.js";
import { distanceKm } from "../geo.js";
import { getJson, postJson } from "../http.js";
import type { SourceInfo } from "../types.js";
import { ALTIMETRIE } from "./ign.js";
import data from "../traces/traces.json" with { type: "json" };
import { SOURCE as ONF_SOURCE, type Statut } from "./sentiers.js";

export const SOURCES = {
  osm: {
    id: "osm_randonnees",
    nom: "Itinéraires de randonnée d'OpenStreetMap",
    organisme: "Contributeurs d'OpenStreetMap",
    licence: "ODbL 1.0",
    attribution: "© les contributeurs d'OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
  },
  ign: ALTIMETRIE,
} satisfies Record<string, SourceInfo>;

const SERVICE = "https://services1.arcgis.com/Y4HgaQpzkE7kenlE/arcgis/rest/services/Sentiers_La_Reunion_public/FeatureServer/5/query";
const ALTI = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";
const ALTI_MAX = 5000;
// The state of a trail changes with the prefect's orders: an hour, as for the map. The ground does not change.
const FRESH_SECONDS = 3600;
const ALTI_SECONDS = 30 * 86400;
// Climb and descent count from one turning point to the next once past this, as in the build script.
const STEP_M = 10;

export interface Point {
  lon: number;
  lat: number;
  ele?: number;
}

export interface Randonnee {
  slug: string;
  nom: string;
  osm: number;
  ref?: string;
  operateur?: string;
  km: number;
  dplus: number;
  dmoins: number;
  alt_min?: number;
  alt_max?: number;
  boucle: boolean;
  /** Its sector (src/traces/secteurs.ts) when at least half of it lies there; a crossing of the island has none. */
  secteur?: string;
  /** The sectors it runs through, the main one first. */
  secteurs?: string[];
  /** The ONF trails it follows, by name. */
  sentiers_onf: string[];
  /** Where it follows each of them: [piece, first point, last point] of its own lines. */
  portions?: Record<string, [number, number, number][]>;
  /** Polylines (Google's encoding, 5 decimals), one per piece of the route. */
  lignes: string[];
  altitudes: (number | null)[][];
}

export interface SentierStats {
  slug: string;
  /** Its names in the ONF's layer (« X » and « X (hors gestion ONF) » are one trail). */
  onf: string[];
  /** Its sector (src/traces/secteurs.ts): where the most of it lies. */
  secteur?: string;
  km: number;
  dplus: number;
  dmoins: number;
  alt_min?: number;
  alt_max?: number;
}

export const RANDONNEES = data.randonnees as unknown as Randonnee[];
/** By the trail's name as src/providers/sentiers.ts gives it. */
export const SENTIERS = data.sentiers as Record<string, SentierStats>;
export const BUILT = data.construit;
const RANDO_BY_SLUG = new Map(RANDONNEES.map((r) => [r.slug, r]));
const TRAIL_BY_SLUG = new Map(Object.entries(SENTIERS).map(([nom, s]) => [s.slug, { nom, ...s }]));
export const randonnee = (slug: string) => RANDO_BY_SLUG.get(slug);
export const sentier = (slug: string) => TRAIL_BY_SLUG.get(slug);

/** Google's polyline encoding, latitude first, 5 decimals → [lon, lat]. */
export function decode(s: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let shift = 0;
    let v = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      v |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return v & 1 ? ~(v >> 1) : v >> 1;
  };
  while (i < s.length) {
    lat += next();
    lon += next();
    out.push([lon / 1e5, lat / 1e5]);
  }
  return out;
}

/** A route's pieces with the altitude of each point. */
export function routePieces(r: Randonnee): Point[][] {
  return r.lignes.map((l, k) => decode(l).map(([lon, lat], j) => ({ lon, lat, ele: r.altitudes[k]?.[j] ?? undefined })));
}

/** The stretches of a route along one of its ONF trails, as points of the route's own lines: where a closure is. */
export function portionsOf(r: Randonnee, nom: string, pieces = routePieces(r)): Point[][] {
  return (r.portions?.[nom] ?? []).map(([k, a, b]) => pieces[k]?.slice(a, b + 1) ?? []).filter((p) => p.length > 1);
}

/** Length in km and, when the points have altitudes, climb and descent in m. */
export function measure(pieces: Point[][]): { km: number; dplus?: number; dmoins?: number; alt_min?: number; alt_max?: number } {
  let km = 0;
  let up = 0;
  let down = 0;
  const alts: number[] = [];
  for (const p of pieces) {
    for (let i = 1; i < p.length; i++) km += distanceKm(p[i - 1].lon, p[i - 1].lat, p[i].lon, p[i].lat);
    const z = p.map((x) => x.ele).filter((v): v is number => v != null);
    alts.push(...z);
    let ref = z[0];
    for (const v of z) {
      if (v - ref >= STEP_M) (up += v - ref), (ref = v);
      else if (ref - v >= STEP_M) (down += ref - v), (ref = v);
    }
  }
  const min = alts.reduce((m, v) => Math.min(m, v), Infinity);
  const max = alts.reduce((m, v) => Math.max(m, v), -Infinity);
  return {
    km: Math.round(km * 10) / 10,
    ...(alts.length ? { dplus: Math.round(up), dmoins: Math.round(down), alt_min: Math.round(min), alt_max: Math.round(max) } : {}),
  };
}

/** One piece of an ONF trail, with its state. */
export interface Troncon {
  statut: Statut;
  cause?: string;
  info?: string;
  points: Point[];
}

export interface TraceOnf {
  nom: string;
  troncons: Troncon[];
}

interface Feature {
  attributes: Record<string, string | number | null>;
  geometry?: { paths?: [number, number][][] };
}

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "") || undefined;
function statut(v: unknown): Statut {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("hors gestion")) return "hors gestion ONF";
  if (s.includes("ferm")) return "fermé";
  if (s.includes("ouvert")) return "ouvert";
  return "inconnu";
}

export function parseTrace(nom: string, features: Feature[]): TraceOnf {
  return {
    nom,
    troncons: features.flatMap((f) =>
      (f.geometry?.paths ?? []).filter((p) => p.length > 1).map((p) => ({
        statut: statut(f.attributes.WS_Statut),
        cause: clean(f.attributes.WS_InfCaus),
        info: clean(f.attributes.WS_InfDate),
        points: p.map(([lon, lat]) => ({ lon, lat })),
      }))),
  };
}

/** The altitude of each point from the IGN; the trail's points beyond what one request takes are left without. */
async function altitudes(cache: Cache, key: string, points: Point[]): Promise<(number | null)[]> {
  const asked = points.slice(0, ALTI_MAX);
  const { value } = await cache.get(`ign:${key}:${asked.length}`, ALTI_SECONDS, async () => {
    const r = await postJson<{ elevations: number[] }>(SOURCES.ign.id, ALTI, {
      lon: asked.map((p) => p.lon.toFixed(6)).join("|"),
      lat: asked.map((p) => p.lat.toFixed(6)).join("|"),
      resource: "ign_rge_alti_wld",
      zonly: "true",
    }, 20_000);
    // -99999 where the model has no ground (the sea).
    return r.elevations.map((z) => (z > -1000 ? Math.round(z * 10) / 10 : null));
  });
  return value;
}

/** An ONF trail at full resolution, with its state and its altitudes: two requests, the second kept a month. */
export async function traceOnf(cache: Cache, t: { nom: string } & SentierStats): Promise<Cached<TraceOnf>> {
  return cache.get(`onf:trace:${t.slug}`, FRESH_SECONDS, async () => {
    const where = `WS_NomIti IN (${t.onf.map((n) => `'${n.replace(/'/g, "''")}'`).join(",")})`;
    const url = `${SERVICE}?${new URLSearchParams({
      where,
      outFields: "WS_NomIti,WS_Statut,WS_InfCaus,WS_InfDate",
      returnGeometry: "true",
      outSR: "4326",
      geometryPrecision: "6",
      f: "json",
    })}`;
    const body = await getJson<{ features?: Feature[]; error?: unknown }>(ONF_SOURCE.id, url, 20_000);
    if (!body.features?.length) throw new Error(`sentier introuvable sur la carte de l'ONF : ${t.nom}`);
    const trace = parseTrace(t.nom, body.features);
    try {
      const z = await altitudes(cache, t.slug, trace.troncons.flatMap((x) => x.points));
      let i = 0;
      for (const x of trace.troncons) for (const p of x.points) p.ele = z[i++] ?? undefined;
    } catch {
      // Without altitudes, the trace is still the trace.
    }
    return trace;
  });
}

// Attributes are in double quotes: an apostrophe (« l'ONF ») stays as it is.
const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const coord = (n: number) => n.toFixed(6).replace(/\.?0+$/, "");

/** A point of the file shown by GPS apps with its name: where a closed trail starts. */
export interface Waypoint {
  lon: number;
  lat: number;
  ele?: number;
  nom: string;
  description?: string;
}

/** A GPX 1.1 file: one track, one segment per piece, the source and its licence in the metadata, the waypoints first. */
export function gpx(opts: {
  nom: string;
  description: string;
  page: string;
  auteur: string;
  licence?: string;
  pieces: Point[][];
  waypoints?: Waypoint[];
  now: Date;
}): string {
  const all = opts.pieces.flat();
  const lats = all.map((p) => p.lat);
  const lons = all.map((p) => p.lon);
  const bounds = all.length
    ? `<bounds minlat="${coord(Math.min(...lats))}" minlon="${coord(Math.min(...lons))}" maxlat="${coord(Math.max(...lats))}" maxlon="${coord(Math.max(...lons))}"/>`
    : "";
  const wpt = (w: Waypoint) =>
    `<wpt lat="${coord(w.lat)}" lon="${coord(w.lon)}">${w.ele != null ? `<ele>${w.ele}</ele>` : ""}<name>${xml(w.nom)}</name>` +
    `${w.description ? `<desc>${xml(w.description)}</desc>` : ""}<sym>Danger Area</sym><type>danger</type></wpt>\n`;
  const seg = (p: Point[]) =>
    `<trkseg>\n${p.map((x) => `<trkpt lat="${coord(x.lat)}" lon="${coord(x.lon)}">${x.ele != null ? `<ele>${x.ele}</ele>` : ""}</trkpt>`).join("\n")}\n</trkseg>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="rundata.re" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
<metadata><name>${xml(opts.nom)}</name><desc>${xml(opts.description)}</desc>` +
    `<author><name>rundata.re</name><link href="https://rundata.re"><text>rundata.re</text></link></author>` +
    `<copyright author="${xml(opts.auteur)}">${opts.licence ? `<license>${xml(opts.licence)}</license>` : ""}</copyright>` +
    `<link href="${xml(opts.page)}"><text>${xml(opts.nom)} sur rundata.re</text></link><time>${opts.now.toISOString().slice(0, 19)}Z</time>${bounds}</metadata>
${(opts.waypoints ?? []).map(wpt).join("")}<trk><name>${xml(opts.nom)}</name><desc>${xml(opts.description)}</desc><type>hiking</type>
${opts.pieces.filter((p) => p.length > 1).map(seg).join("\n")}
</trk>
</gpx>
`;
}
