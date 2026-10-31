/**
 * Whether the clubs' own space answers (web/club.ts): on only once the D1 tables exist (scripts/clubs.sql), the
 * directory is read, « Mon agenda » publishes, and marketing's card is on /associations.
 */
export const CLUB_EN_LIGNE = false;
let ouvert = CLUB_EN_LIGNE;
export const enLigne = () => ouvert;
/** For the tests: the space opened or closed whatever the flag. */
export function ouvrir(v: boolean) {
  ouvert = v;
}
