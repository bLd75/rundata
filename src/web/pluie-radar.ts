/**
 * The rain the radar sees now, for the rain layer of /meteo's map: the latest lame d'eau (providers/radar.ts),
 * resampled on the map's own grid (the altitudes' one, scripts/build-altitudes.py), one character a cell. The page's
 * script asks for it when the layer is first shown and lets drops fall where it rains. Nothing of its own is stored:
 * the image is the one the tools read, kept 4 minutes by each data center, and this answer 5 minutes by the browser.
 */
import type { Cache } from "../cache.js";
import * as radar from "../providers/radar.js";
import { H, W } from "./map.js";
import island from "../places/island.json" with { type: "json" };

export const PATH = "/meteo/pluie-radar.json";

// The altitudes' grid: 125 cells across, the map's proportions.
export const GW = 125;
export const GH = Math.round((GW * H) / W);

/** Rain rates in mm/h at which a cell goes up a class, « 1 » to « 8 » (the smallest step of the radar is 0.12 mm/h). */
export const CLASSES = [0.1, 0.5, 1, 2, 4, 8, 16, 32];
// Below this quality index (0 to 100), the relief hides the cell from both radars: its rain may be missed.
const POOR = 50;

export interface RainGrid {
  /** Start and end of the radar's 5 minutes, ISO UTC. */
  debut: string;
  fin: string;
  /** The radars reporting a malfunction, by name. */
  pannes: string[];
  w: number;
  h: number;
  /** One character a cell, row by row from the north-west: « . » not seen, « 0 » no rain, « 1 » to « 8 » the classes. */
  pluie: string;
  /** « 1 » where the radars see badly (quality index under POOR), else « 0 ». */
  mal_vu: string;
}

/** The radar's image on the map's grid: the strongest rain seen within each cell, its mean quality. */
export function grid(img: radar.RadarImage): RainGrid {
  const [lon0, lat0, lon1, lat1] = island.bbox;
  const rain = radar.unb64(img.pluie);
  const quality = radar.unb64(img.qualite);
  const { row0, row1, col0, col1 } = radar.WINDOW;
  const width = col1 - col0;
  // The cells' edges on the radar's grid: its columns follow the longitude alone, its rows the latitude alone.
  const cols = Array.from({ length: GW + 1 }, (_, i) => radar.pixel(lon0 + (i / GW) * (lon1 - lon0), lat1).col);
  const rows = Array.from({ length: GH + 1 }, (_, j) => radar.pixel(lon0, lat1 - (j / GH) * (lat1 - lat0)).row);
  let pluie = "";
  let mal = "";
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      let max = -1;
      let qs = 0;
      let qn = 0;
      for (let r = Math.max(row0, rows[j]); r <= Math.min(row1 - 1, rows[j + 1]); r++) {
        for (let c = Math.max(col0, cols[i]); c <= Math.min(col1 - 1, cols[i + 1]); c++) {
          const k = (r - row0) * width + (c - col0);
          const v = rain[k];
          if (v !== radar.NODATA) max = Math.max(max, v === radar.UNDETECT ? 0 : v * 0.12);
          if (quality[k] <= 100) {
            qs += quality[k];
            qn++;
          }
        }
      }
      pluie += max < 0 ? "." : String(CLASSES.filter((x) => max >= x).length);
      mal += qn && qs / qn < POOR ? "1" : "0";
    }
  }
  return { debut: img.debut, fin: img.fin, pannes: img.pannes, w: GW, h: GH, pluie, mal_vu: mal };
}

/** The answer of PATH: the grid, or 503 when the radar cannot be read (never an empty grid passed off as no rain). */
export async function rainGrid(cache: Cache): Promise<Response> {
  const headers = { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" };
  try {
    if (!radar.enabled()) throw new Error("radar non configuré");
    const img = await radar.image(cache);
    return new Response(JSON.stringify(grid(img.value)), { headers: { ...headers, "cache-control": "public, max-age=300" } });
  } catch {
    return new Response(JSON.stringify({ erreur: "image radar indisponible" }), { status: 503, headers: { ...headers, "cache-control": "no-store" } });
  }
}
