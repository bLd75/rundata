/**
 * The revision of what each family of pages' copies holds (#272): the copy of `web:<family>` or
 * `web:<family>:<slug>` kept across a deploy only while its family's number stays the same (cache.ts, `outdated`).
 *
 * Raise a family's number in the PR that changes what its build puts in the copy: a field added, removed or computed
 * otherwise, a wording, a link or a source taken from the copy, a provider or tool its build calls that now answers
 * otherwise (a change of `src/tools/meteo.ts` can reach `lieu`, `commune` and `meteo`). Do not raise it for a change of
 * the page around the copy (web/pages.ts and the like, rendered at each view) nor for a change that leaves the copy the
 * same: the data centers then keep their copies across the deploy, instead of building them all again at once, which
 * the first views and the scheduled event pay for. A number forgotten shows the old copy until its next build, at its
 * usual rate (at most six hours, for the calendar).
 *
 * A family not listed here is built again after every deploy, as before this table: list a new family once its copy
 * is settled. A change that makes the new code unable to read an old copy raises `CACHE_FORMAT` instead (cache.ts).
 */
export const RENDU_REVISION: Readonly<Record<string, number>> = {
  actualites: 2,
  agenda: 9,
  air: 1,
  bornes: 1,
  bus: 1,
  calendrier: 1,
  commune: 1,
  coupures: 2,
  courant: 2,
  cyclones: 2,
  dae: 1,
  dechets: 1,
  eau: 1,
  electricite: 3,
  enfants: 4,
  historique: 1,
  lieu: 1,
  mer: 1,
  meteo: 1,
  randonnees: 1,
  secheresse: 1,
  sentiers: 1,
  sport: 6,
  trafic: 1,
  velos: 1,
  volcan: 1,
};

/** `web:lieu:le-port` → `lieu`. */
export const familyOf = (key: string) => key.slice("web:".length).split(":")[0];
