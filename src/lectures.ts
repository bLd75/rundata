/**
 * The cache entries a tool call read, for the freshness of its answer (tools/citer.ts): when rundata.re read each
 * source, and whether one was served from its last copy because the source did not answer. Noted by the cache
 * (cache.ts) in the context of the call, so that no tool has to say it.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface Lecture {
  key: string;
  fetchedAt: number;
  /** The source failed: this is its last good copy. */
  stale: boolean;
  /** How long the entry is fresh: a day or more means reference data (stations, lists), not a measurement. */
  freshSeconds: number;
  /** For a last copy: the id of the source that did not answer (`SourceInfo.id`), when its error said it. */
  source?: string;
  /** For a last copy: its source did not fail, it was too slow for the answer (`callDeadline`). */
  tardive?: true;
  /** The source the entry was read from (`SourceInfo.id`), when it was one, fresh or not (`withSource`). */
  from?: string;
}

const current = new AsyncLocalStorage<Lecture[]>();
const asked = new AsyncLocalStorage<Set<string>>();
// When the tool call being answered stops waiting for a source that has a copy (`withLectures`), in ms (Date.now).
const until = new AsyncLocalStorage<number>();

/**
 * Runs `fn`, and returns with its value the entries the cache served it. `waitMs`: past that much time from now, a
 * source with a copy is no longer waited for: its copy is served, said as such, and its read ends after the answer
 * (cache.ts).
 */
export async function withLectures<T>(fn: () => Promise<T>, waitMs?: number): Promise<{ value: T; lectures: Lecture[] }> {
  const lectures: Lecture[] = [];
  const run = () => current.run(lectures, fn);
  const value = await (waitMs == null ? run() : until.run(Date.now() + waitMs, run));
  return { value, lectures };
}

/** When the tool call being answered stops waiting for a source that has a copy; nothing outside one that set it. */
export const callDeadline = () => until.getStore();

/** Called by the cache for each entry it serves; nothing outside a tool call. */
export function noteLecture(l: Lecture) {
  current.getStore()?.push(l);
}

/** Runs `fn` (a cache load), and returns with its value the source it asked, when it asked one and only one. */
export async function withSource<T>(fn: () => Promise<T>): Promise<{ value: T; from?: string }> {
  const ids = new Set<string>();
  const value = await asked.run(ids, fn);
  return { value, ...(ids.size === 1 && { from: [...ids][0] }) };
}

/** Called by http.ts for each source asked; nothing outside a cache load. */
export function noteSource(id: string) {
  asked.getStore()?.add(id);
}
