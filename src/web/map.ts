/**
 * The island as an inline SVG: coastline and communes from src/places/island.json (scripts/build-island.py), with
 * markers placed by the same projection. Colours come from the page's CSS, so the map follows its light and dark
 * themes.
 */
import island from "../places/island.json" with { type: "json" };

const [LON0, LAT0, LON1, LAT1] = island.bbox;
export const W = island.w;
export const H = island.h;

export function project(lon: number, lat: number): [number, number] {
  return [Math.round(((lon - LON0) / (LON1 - LON0)) * W), Math.round(((LAT1 - lat) / (LAT1 - LAT0)) * H)];
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface Marker {
  lon: number;
  lat: number;
  /** Short text inside the marker: « 24° », « 15 km/h ». */
  label: string;
  /** Name next to the marker on wide screens, and in the tooltip. */
  name: string;
  color?: string;
  /** Round for a temperature, a pill for anything else. */
  round?: boolean;
}

const PEAKS = [
  { name: "Piton des Neiges", alt: "3 070 m", lon: 55.4783, lat: -21.0989 },
  { name: "Piton de la Fournaise", alt: "2 632 m", lon: 55.7083, lat: -21.2444 },
];

function marker(m: Marker): string {
  const [x, y] = project(m.lon, m.lat);
  const fill = m.color ?? "var(--ink)";
  const w = Math.max(64, m.label.length * 19 + 24);
  const shape = m.round
    ? `<circle cx="${x}" cy="${y}" r="34" fill="${fill}"/>`
    : `<rect x="${x - w / 2}" y="${y - 24}" width="${w}" height="48" rx="24" fill="${fill}"/>`;
  return `<g class="mk"><title>${esc(m.name)}</title>${shape}` +
    `<text x="${x}" y="${y + 11}" class="mv">${esc(m.label)}</text>` +
    `<text x="${x}" y="${y + 66}" class="mn">${esc(m.name)}</text></g>`;
}

/**
 * `highlight`: the commune whose page this is. `pin`: the place asked about, drawn as a dot with its name.
 * `peaks`: the two summits, for orientation on the island-wide map. `fills`: a colour per commune (the vigilance map).
 */
export function islandMap(opts: {
  markers?: Marker[];
  highlight?: string;
  pin?: { lon: number; lat: number; name: string };
  peaks?: boolean;
  fills?: Record<string, string>;
  /** The hero's island: relief shading from the summits, a lagoon glow along the coast, the two volcanoes marked. */
  relief?: boolean;
  label: string;
}): string {
  const paths = island.paths.map((p) => `<path d="${p.d}"/>`).join("");
  const hl = opts.highlight ? island.paths.find((p) => p.nom === opts.highlight) : undefined;
  const fills = island.paths
    .filter((p) => opts.fills?.[p.nom])
    .map((p) => `<path d="${p.d}" style="fill:${opts.fills![p.nom]}"/>`)
    .join("");
  let extra = "";
  if (hl) extra += `<path class="hl" d="${hl.d}"/>`;
  if (opts.peaks) {
    for (const p of PEAKS) {
      const [x, y] = project(p.lon, p.lat);
      extra += `<g class="pk"><path d="M${x - 14} ${y + 10}L${x} ${y - 14}L${x + 14} ${y + 10}Z"/>` +
        `<text x="${x}" y="${y + 40}">${esc(p.name)}</text><text x="${x}" y="${y + 66}">${p.alt}</text></g>`;
    }
  }
  if (opts.pin) {
    const [x, y] = project(opts.pin.lon, opts.pin.lat);
    extra += `<g class="pin"><circle cx="${x}" cy="${y}" r="16"/><circle cx="${x}" cy="${y}" r="34" class="halo"/>` +
      `<text x="${x}" y="${y - 50}">${esc(opts.pin.name)}</text></g>`;
  }
  if (opts.relief) {
    // Lit from the Piton des Neiges: bare heights, green slopes, darker lowlands; the coast glows like a lagoon.
    const [cx, cy] = project(PEAKS[0].lon, PEAKS[0].lat);
    const [vx, vy] = project(PEAKS[1].lon, PEAKS[1].lat);
    const defs = `<radialGradient id="relief" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${Math.round(W * 0.62)}">` +
      `<stop offset="0" stop-color="#e9dcb8"/><stop offset=".12" stop-color="#a8c98e"/><stop offset=".38" stop-color="#4f9a6e"/>` +
      `<stop offset=".75" stop-color="#2a6f5c"/><stop offset="1" stop-color="#1d5a52"/></radialGradient>` +
      `<radialGradient id="lava" gradientUnits="userSpaceOnUse" cx="${vx}" cy="${vy}" r="${Math.round(W * 0.16)}">` +
      `<stop offset="0" stop-color="#c2553a" stop-opacity=".75"/><stop offset="1" stop-color="#c2553a" stop-opacity="0"/></radialGradient>` +
      `<filter id="glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>`;
    const peaks = PEAKS.map((p) => {
      const [x, y] = project(p.lon, p.lat);
      return `<g class="pk"><path d="M${x - 16} ${y + 12}L${x} ${y - 16}L${x + 16} ${y + 12}Z"/><text x="${x}" y="${y + 44}">${esc(p.name)}</text></g>`;
    }).join("");
    return `<svg class="map relief" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}">` +
      `<defs><g id="isl">${paths}</g>${defs}</defs>` +
      `<use href="#isl" class="halo" filter="url(#glow)"/><use href="#isl" class="coast"/>` +
      `<use href="#isl" fill="url(#relief)"/><use href="#isl" fill="url(#lava)"/><use href="#isl" class="borders"/>` +
      peaks + (opts.markers ?? []).map(marker).join("") + `</svg>`;
  }
  return `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}">` +
    `<defs><g id="isl">${paths}</g></defs>` +
    `<rect class="sea" width="${W}" height="${H}" rx="28"/>` +
    `<use href="#isl" class="coast"/><use href="#isl" class="land"/>${fills}<use href="#isl" class="borders"/>` +
    extra + (opts.markers ?? []).map(marker).join("") + `</svg>`;
}
