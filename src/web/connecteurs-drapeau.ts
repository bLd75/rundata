/**
 * Whether « Relier votre plateforme » answers (web/connecteurs.ts) and shows on /associations and /confidentialite:
 * on only once the D1 tables exist (scripts/connecteurs.sql), the Worker has CONNECTEURS_CLE, and the associations'
 * events are read into the agenda.
 */
export const CONNECTEURS_EN_LIGNE = false;
let ouvert = CONNECTEURS_EN_LIGNE;
export const enLigne = () => ouvert;
/** For the tests: the pages opened or closed whatever the flag. */
export function ouvrir(v: boolean) {
  ouvert = v;
}
