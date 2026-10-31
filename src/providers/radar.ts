/**
 * Rain seen by Météo-France's radars (Le Colorado and Piton Villers), from the API DPRadar: the "lame d'eau" mosaic
 * of La Réunion at 500 m, a new image every 5 minutes, as ODIM HDF5. Each pixel holds the rain of the last 5
 * minutes in hundredths of a millimetre, with a quality index beside it (the relief hides the bottom of the cirques
 * from both radars). Only the island and its near sea are kept: two chunks of the 2000 × 2300 grid.
 * Format and georeferencing checked against h5py and pyproj.
 */
import type { Cache, Cached } from "../cache.js";
import { BBOX } from "../geo.js";
import { crop, datasets } from "../hdf5.js";
import { getBytes } from "../http.js";
import type { SourceInfo } from "../types.js";
import { download, session } from "./mf-auth.js";

export { enabled } from "./mf-auth.js";

export const SOURCE: SourceInfo = {
  id: "mf_radar",
  nom: "Lame d'eau radar de La Réunion (Météo-France)",
  organisme: "Météo-France",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Météo-France",
  url: "https://portail-api.meteofrance.fr/",
};

const URL = "https://public-api.meteofrance.fr/public/DPRadar/v1/mosaiques/REUNION/observations/LAME_D_EAU/produit?maille=500";
const FRESH_SECONDS = 4 * 60;
const ROWS = 2000;
const COLS = 2300;
const PIXEL_M = 500;
/** A pixel the radars do not see, and one they see without rain. */
export const NODATA = 65535;
export const UNDETECT = 65534;

// Ellipsoidal Mercator of the composite (/where/projdef): +proj=merc +lat_ts=-20.387 +x_0=-5323837.27 +y_0=2681326.18.
const A = 6378137;
const E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);
const E = Math.sqrt(E2);
const TS = (-20.387 * Math.PI) / 180;
const K0 = Math.cos(TS) / Math.sqrt(1 - E2 * Math.sin(TS) ** 2);

/** Row and column of the composite's grid (row 0 at the north) for a point. */
export function pixel(lon: number, lat: number): { row: number; col: number } {
  const phi = (lat * Math.PI) / 180;
  const s = Math.sin(phi);
  const x = A * K0 * ((lon * Math.PI) / 180) - 5323837.27;
  const y = A * K0 * Math.log(Math.tan(Math.PI / 4 + phi / 2) * ((1 - E * s) / (1 + E * s)) ** (E / 2)) + 2681326.18;
  return { col: Math.floor(x / PIXEL_M), row: Math.floor((ROWS * PIXEL_M - y) / PIXEL_M) };
}

// The part of the grid kept: the island's box.
const NW = pixel(BBOX.lonMin, BBOX.latMax);
const SE = pixel(BBOX.lonMax, BBOX.latMin);
export const WINDOW = { row0: NW.row, row1: SE.row + 1, col0: NW.col, col1: SE.col + 1 };

export interface RadarImage {
  /** Start and end of the 5 minutes, ISO UTC. */
  debut: string;
  fin: string;
  /** The radars of the mosaic reporting a malfunction, by name. */
  pannes: string[];
  /** Hundredths of a millimetre in 5 min, row by row over WINDOW, as 16-bit integers in base64. */
  pluie: string;
  /** Quality index 0 to 100 (254 and 255: none), same layout. */
  qualite: string;
}

const b64 = (a: Uint16Array) => {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
/** A grid of the image (`pluie`, `qualite`) back to its integers, row by row over WINDOW. */
export const unb64 = (s: string) => {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Uint16Array(bytes.buffer);
};

/** An ODIM attribute holding a short string ("20261022", "053500", "False"), found by its name. */
function attribute(text: string, name: string, pattern: RegExp): string {
  const at = text.indexOf(name);
  const m = at < 0 ? null : pattern.exec(text.slice(at + name.length, at + name.length + 48));
  if (!m) throw new Error(`radar : attribut ${name} introuvable`);
  return m[0];
}

/** Each radar's metadata ("PLC:Piton Villers") is followed by its own "malfunc" flag. */
export function failing(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/PLC:([^,\0]+)/g)) {
    const at = text.indexOf("malfunc", m.index);
    if (at >= 0 && /True/.test(text.slice(at, at + 40))) out.push(m[1]);
  }
  return out;
}

const iso = (date: string, time: string) =>
  `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`;

export async function parse(data: ArrayBuffer): Promise<RadarImage> {
  const text = new TextDecoder("latin1").decode(new Uint8Array(data));
  // Refuse anything but the product this code was written for.
  if (!text.includes("ACRR") || !text.includes("QIND")) throw new Error("radar : ce n'est pas une lame d'eau ODIM");
  const sets = datasets(data);
  const rain = sets.find((d) => d.size === 2 && d.cols === COLS);
  const quality = sets.find((d) => d.size === 1 && d.cols === COLS);
  if (!rain || !quality) throw new Error("radar : grilles introuvables");
  const { row0, row1, col0, col1 } = WINDOW;
  return {
    debut: iso(attribute(text, "startdate", /\d{8}/), attribute(text, "starttime", /\d{6}/)),
    fin: iso(attribute(text, "enddate", /\d{8}/), attribute(text, "endtime", /\d{6}/)),
    pannes: failing(text),
    pluie: b64(await crop(data, rain, row0, row1, col0, col1)),
    qualite: b64(await crop(data, quality, row0, row1, col0, col1)),
  };
}

/** The latest image, read from Météo-France without the cache (one subrequest): the history catching up one it missed. */
export async function read(): Promise<RadarImage> {
  const get = (source: string, url: string, timeoutMs: number, headers?: Record<string, string>) =>
    getBytes(source, url, timeoutMs, { ...headers, Accept: "application/x-hdf" });
  return parse(await download(URL, session(SOURCE.id), get, 20_000));
}

export async function image(cache: Cache): Promise<Cached<RadarImage>> {
  return cache.get("radar:2", FRESH_SECONDS, read);
}

export interface RainAt {
  /** mm/h at the pixel of the place, null where the radars do not see. */
  mm_h: number | null;
  /** Highest and mean mm/h within the radius, over the pixels seen. */
  max_mm_h: number | null;
  moyenne_mm_h: number | null;
  /** Share of the pixels within the radius that saw rain (≥ 0.12 mm/h, the smallest step). */
  part_pluie: number;
  /** Mean quality index within the radius, 0 to 1. */
  qualite: number | null;
}

/** The rain at a point and around it, in mm/h (5-minute amounts × 12). */
export function rainAt(img: RadarImage, lon: number, lat: number, radiusKm = 2): RainAt | null {
  const { row, col } = pixel(lon, lat);
  const { row0, row1, col0, col1 } = WINDOW;
  if (row < row0 || row >= row1 || col < col0 || col >= col1) return null;
  const width = col1 - col0;
  const rain = unb64(img.pluie);
  const quality = unb64(img.qualite);
  const mmh = (v: number) => (v === NODATA ? null : v === UNDETECT ? 0 : Math.round(v * 0.12 * 10) / 10);
  const reach = Math.ceil((radiusKm * 1000) / PIXEL_M) + 1;
  let max = -1;
  let sum = 0;
  let seen = 0;
  let wet = 0;
  let qsum = 0;
  let qn = 0;
  for (let r = Math.max(row0, row - reach); r < Math.min(row1, row + reach + 1); r++) {
    for (let c = Math.max(col0, col - reach); c < Math.min(col1, col + reach + 1); c++) {
      // Pixel centres within the radius, measured on the grid (500 m steps are close enough to ground metres here).
      if (Math.hypot(r - row, c - col) * PIXEL_M > radiusKm * 1000) continue;
      const i = (r - row0) * width + (c - col0);
      const q = quality[i];
      if (q <= 100) {
        qsum += q / 100;
        qn++;
      }
      const v = mmh(rain[i]);
      if (v === null) continue;
      seen++;
      sum += v;
      if (v > 0) wet++;
      if (v > max) max = v;
    }
  }
  return {
    mm_h: mmh(rain[(row - row0) * width + (col - col0)]),
    max_mm_h: seen ? max : null,
    moyenne_mm_h: seen ? Math.round((sum / seen) * 10) / 10 : null,
    part_pluie: seen ? Math.round((wet / seen) * 100) / 100 : 0,
    qualite: qn ? Math.round((qsum / qn) * 100) / 100 : null,
  };
}
