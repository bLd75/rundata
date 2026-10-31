/**
 * The small charts of the pages, drawn on the server in SVG: lines, bars, a band between two lines, arrows of the wind.
 * No library and no request; without a script they are read as drawn (station.ts, the history of /historique).
 */
import { esc } from "./map.js";
import { fr } from "../tools/format.js";

const num = (n: number) => fr(Math.round(n * 10) / 10);

export interface Line {
  pts: (number | null)[];
  cls: string;
}

export const known = (xs: (number | null | undefined)[]) => xs.filter((v): v is number => v != null);

/**
 * A small chart: lines, bars, a band between two lines, arrows of the wind above. `labels` under every `every` value;
 * the scale from the values, or from `min` and `max`. `h`: its height (266 by default, for 600 wide). `barCls`: a class
 * of its own for some bars; `marks`: a dot under the axis on those days (a grey day), so that the colour does not say it
 * alone. `data`: attributes for the script that reads a day's values (« data-v="…" »).
 */
export function chart(o: {
  label: string; labels: string[]; every: number; lines?: Line[]; bars?: (number | null)[]; band?: [(number | null)[], (number | null)[]]; arrows?: (number | null)[];
  min?: number; max?: number; h?: number; barCls?: (string | undefined)[]; marks?: boolean[]; data?: string;
}): string {
  const W = 600, H = o.h ?? 266, L = 52, R = 10, TOP = o.arrows ? 40 : 18, B = o.marks ? 58 : 44;
  const all = [...(o.lines ?? []).flatMap((l) => l.pts), ...(o.bars ?? []), ...(o.band ? [...o.band[0], ...o.band[1]] : [])].filter((v): v is number => v != null);
  let lo = o.min ?? Math.floor(Math.min(...all) - 1);
  let hi = o.max ?? Math.ceil(Math.max(...all) + 1);
  if (!(hi - lo >= 2)) hi = lo + 2;
  // Whole numbers on the three lines.
  if ((hi - lo) % 2) hi++;
  const n = o.labels.length;
  const x = (i: number) => Math.round((L + ((i + 0.5) * (W - L - R)) / n) * 10) / 10;
  const y = (v: number) => Math.round((TOP + ((hi - v) * (H - TOP - B)) / (hi - lo)) * 10) / 10;
  const ticks = [lo, (lo + hi) / 2, hi];
  let s = `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label)}"${o.data ? ` ${o.data}` : ""}>`;
  s += ticks.map((t) => `<line class="gr" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 8}" y="${y(t) + 7}" text-anchor="end">${num(t)}</text>`).join("");
  if (o.bars) {
    const w = Math.round((((W - L - R) / n) * 0.62) * 10) / 10;
    s += o.bars.map((b, i) => (b != null && b > 0 ? `<rect class="br${o.barCls?.[i] ? ` ${o.barCls[i]}` : ""}" x="${Math.round((x(i) - w / 2) * 10) / 10}" y="${y(b)}" width="${w}" height="${Math.round((y(lo) - y(b)) * 10) / 10}" rx="2"/>` : "")).join("");
  }
  if (o.marks) s += o.marks.map((m, i) => (m ? `<circle class="mk" cx="${x(i)}" cy="${y(lo) + 11}" r="5"/>` : "")).join("");
  if (o.band) {
    // Only where both ends are there: a hole stays a hole.
    const ok = o.band[0].map((v, i) => v != null && o.band![1][i] != null);
    if (ok.every(Boolean)) s += `<path class="bd" d="M${o.band[1].map((v, i) => `${x(i)},${y(v!)}`).join("L")}L${o.band[0].map((v, i) => `${x(i)},${y(v!)}`).reverse().join("L")}Z"/>`;
  }
  for (const l of o.lines ?? []) s += `<path class="${l.cls}" d="${l.pts.map((p, i) => (p == null ? "" : `${i && l.pts[i - 1] != null ? "L" : "M"}${x(i)},${y(p)}`)).join("")}"/>`;
  if (o.arrows) s += o.arrows.map((d, i) => (d == null || i % 2 ? "" : `<path class="wa" d="M0 6V-6M-4-2l4-4 4 4" transform="translate(${x(i)} ${TOP - 20}) rotate(${(d + 180) % 360})"/>`)).join("");
  s += o.labels.map((t, i) => (i % o.every ? "" : `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${t}</text>`)).join("");
  return `${s}</svg>`;
}
