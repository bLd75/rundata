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
}

const current = new AsyncLocalStorage<Lecture[]>();

/** Runs `fn`, and returns with its value the entries the cache served it. */
export async function withLectures<T>(fn: () => Promise<T>): Promise<{ value: T; lectures: Lecture[] }> {
  const lectures: Lecture[] = [];
  const value = await current.run(lectures, fn);
  return { value, lectures };
}

/** Called by the cache for each entry it serves; nothing outside a tool call. */
export function noteLecture(l: Lecture) {
  current.getStore()?.push(l);
}
