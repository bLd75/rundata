/**
 * The symbol of rundata.re, the « Point chaud » (25/10/2026): La Réunion was born of a hot spot, at the top of the
 * volcano (the red triangle), and its two yellow waves run down the slopes: the live. In the colours of Lo Mahavéli,
 * without being the flag, which stays content (flag.ts) wherever it shows La Réunion.
 *
 * Copied as they are from the brand kit's files (marketing: identite/logo/svg/point-chaud.svg, -petit.svg), on a grid
 * of 48; never redrawn here.
 */

/** The tile: blue, rounded corners (11 on 48). */
export const LOGO_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><rect width="48" height="48" rx="11" fill="#2563d8"/><path d="M24 27.75L37.75 37.25H10.25Z" fill="#e3262d"/><circle cx="24" cy="24.5" r="3.25" fill="#ffcf1f"/><path d="M15.809 26.772A8.5 8.5 0 1 1 32.191 26.772" fill="none" stroke="#ffcf1f" stroke-width="3.25" stroke-linecap="round"/><path d="M11.113 29.97A14 14 0 1 1 36.887 29.97" fill="none" stroke="#ffcf1f" stroke-width="3.25" stroke-linecap="round"/></svg>`;

/** The small one, fewer and thicker strokes, for 16 and 32 px: the favicon a tab shows. */
export const LOGO_PETIT_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><rect width="48" height="48" rx="11" fill="#2563d8"/><path d="M24 25.5L40 37.5H8Z" fill="#e3262d"/><circle cx="24" cy="21.5" r="4.5" fill="#ffcf1f"/><path d="M13.453 24.624A11 11 0 1 1 34.547 24.624" fill="none" stroke="#ffcf1f" stroke-width="4.5" stroke-linecap="round"/></svg>`;

const TILE_INNER = LOGO_SVG.slice(LOGO_SVG.indexOf(">") + 1, -"</svg>".length);

/** The symbol in the page (the header, the footer), named « rundata.re » for screen readers. */
export function logo(cls = "logo", label = "rundata.re"): string {
  return `<svg class="${cls}" viewBox="0 0 48 48" role="img" aria-label="${label}"><title>${label}</title>${TILE_INNER}</svg>`;
}
