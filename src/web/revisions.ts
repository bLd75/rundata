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
  actualites: 9,
  agenda: 18,
  air: 9,
  bornes: 2,
  bus: 6,
  calendrier: 2,
  chiffres: 7,
  commune: 7,
  coupures: 4,
  courant: 4,
  crues: 1,
  cyclones: 3,
  dae: 2,
  dechets: 1,
  eau: 1,
  electricite: 10,
  emploi: 3,
  enfants: 10,
  historique: 4,
  lieu: 7,
  "marches-publics": 2,
  mer: 2,
  meteo: 4,
  randonnees: 6,
  secheresse: 1,
  sentiers: 4,
  sport: 13,
  station: 1,
  trafic: 2,
  velos: 2,
  volcan: 8,
};

/** `web:lieu:le-port` → `lieu`. */
export const familyOf = (key: string) => key.slice("web:".length).split(":")[0];

/**
 * The revision of what a source's entry holds, as RENDU_REVISION for the pages' copies: an entry of `key` kept
 * across a deploy only while its number stays the same (cache.ts, `outdated`), so that a page built again after the
 * deploy is not built from what the old code read. Listed by key (`actualites:fil`) or by the first part of the keys
 * (`agenda` for every `agenda:<id>`).
 *
 * Raise a source's number, or list it at 1, in the PR that changes what its read keeps: a field, a link, a medium, a
 * filter. Raise the families of pages built from it too (RENDU_REVISION). A source not listed keeps its entry across
 * every deploy, as before this table. An entry out of date is still served when the source does not answer: the old
 * copy, dated, is worth more than nothing.
 */
export const SOURCE_REVISION: Readonly<Record<string, number>> = {
  // With the time the prefecture's list was last asked (prefectureLue), which it is every 15 minutes only.
  // With the time the prefecture's list shown was read (prefectureReussie), kept while its site does not answer.
  // The island's news only: France's and the world's left out (`local`).
  "actualites:fil": 4,
  // Read again with its written agreement of 28/10/2026, without the price and the sentence an older entry kept.
  "agenda:bras_panon": 1,
  // The WordPress agendas, with their venue's position when the site gives one (« Y aller » of /evenements).
  "agenda:lrvb": 1,
  "agenda:saint_paul": 1,
  "agenda:le_port": 1,
  "agenda:trois_bassins": 1,
  "agenda:sainte_marie": 1,
  "agenda:sechoir": 1,
  // With the time Atmo Réunion diffused the index (date_dif, `diffuse_le`), which an older entry lacks.
  atmo: 1,
};

/** The revision of the source whose entry is kept under `key`: its own, else its first part's. */
export const sourceRevision = (key: string): number | undefined => SOURCE_REVISION[key] ?? SOURCE_REVISION[key.split(":")[0]];
