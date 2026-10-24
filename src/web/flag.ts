/**
 * Lo Mahavéli, the popular flag of La Réunion (Guy Pignolet, 1975): a red volcano on a blue field, five yellow rays
 * of sunlight fanning out from its summit. Not official, but flown and worn all over the island.
 */
// Geometry of the reference drawing (Wikimedia Commons, « Proposed flag of Réunion (VAR) »), halved:
// the volcano's base is the whole bottom edge; the rays go to the left and right edges, the two top corners and straight up.
const RAYS = "M0 18.5v3L60 18.5v3zM30 20 0 2.5V0H2.5zM30 20 57.5 0H60V2.5zM30 20 28.5 0h3z";

/** viewBox 0 0 60 40 (3:2). */
export const FLAG_INNER =
  `<rect width="60" height="40" fill="#2563d8"/>` + `<path d="M30 20L60 40H0Z" fill="#e3262d"/>` + `<path d="${RAYS}" fill="#ffd400"/>`;

export function flag(cls = "flag", label = "Drapeau de La Réunion (Lo Mahavéli)"): string {
  return `<svg class="${cls}" viewBox="0 0 60 40" role="img" aria-label="${label}"><title>${label}</title>${FLAG_INNER}</svg>`;
}
