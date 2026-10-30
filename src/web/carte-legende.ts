/**
 * The legend of a map of points on the island (marketing's charter of the maps, 31/10/2026): under the map, each mark
 * drawn as on the map then what it means, in the secondary text's colour, never a coloured word; then on a line of its
 * own the nature, source and time of what the map shows (« Mesure de …, la plus récente à HH:MM »).
 */
import { esc } from "./map.js";

/** A count, which is neither good nor bad: the night's colour, on every map that counts (/enfants, /defibrillateurs). */
export const COUNT_COLOR = "#14202b";

/** A mark as the map draws it (map.ts, marker()): a disc, a pill, a ring (nothing lately), the hot spot's triangle. */
export interface Cle {
  forme: "rond" | "pastille" | "anneau" | "triangle";
  couleur: string;
  /** What the mark holds: a count, a value, a symbol (« ✓ », « × »). */
  texte?: string;
  /** What it means. */
  dit: string;
}

const svg = (box: string, shape: string, texte?: string) =>
  `<svg viewBox="${box}" aria-hidden="true">${shape}${texte ? `<text y="11">${esc(texte)}</text>` : ""}</svg>`;

function mark(c: Cle): string {
  switch (c.forme) {
    case "pastille":
      return svg("-60 -30 120 60", `<rect x="-56" y="-24" width="112" height="48" rx="24" fill="${c.couleur}"/>`, c.texte);
    case "anneau":
      return svg("-37 -37 74 74", `<circle r="30" fill="#fff" stroke="${c.couleur}" stroke-width="8"/>`);
    case "triangle":
      return svg("-40 -42 80 80", `<path d="M0 -36L35 28H-35Z" fill="${c.couleur}"/>`);
    default:
      return svg("-37 -37 74 74", `<circle r="34" fill="${c.couleur}"/>`, c.texte);
  }
}

/** The legend's two parts: the marks, then `ligne` (HTML: it may hold a link). */
export const legende = (cles: Cle[], ligne?: string): string =>
  (cles.length ? `<span class="mlg">${cles.map((c) => `<span>${mark(c)}${esc(c.dit)}</span>`).join("")}</span>` : "") +
  (ligne ? `<span class="mls">${ligne}</span>` : "");

/** Its style, in the page's sheet. At 1.6 rem, a disc's figures are 11 px high, a pill's 13 px. */
export const LEGENDE_CSS = `.mlg{display:flex;flex-wrap:wrap;gap:.3rem .9rem;margin-bottom:.35rem}.mlg>span{display:inline-flex;align-items:center;gap:.4rem}` +
  `.mlg svg{height:1.6rem;width:auto;flex:none;overflow:visible}.mlg circle:not([stroke]),.mlg rect,.mlg path{stroke:#fff;stroke-width:5}` +
  `.mlg text{fill:#fff;font:700 30px system-ui,sans-serif;text-anchor:middle}.mls{display:block}`;
