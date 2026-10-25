/**
 * Whether the clubs' and associations' space answers (web/associations.ts, web/propositions.ts) and is linked from the
 * other pages: on only once the D1 tables exist (scripts/propositions.sql, scripts/propositions-b.sql).
 */
export const ASSOCIATIONS_EN_LIGNE = true;
let ouvert = ASSOCIATIONS_EN_LIGNE;
export const enLigne = () => ouvert;
/** For the tests: the space opened or closed whatever the flag. */
export function ouvrir(v: boolean) {
  ouvert = v;
}
