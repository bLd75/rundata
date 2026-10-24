/**
 * Subrequests of the current invocation. A Cloudflare Worker may make a limited number per invocation (fetches,
 * Cache API and KV calls alike) and fails the next ones, so every upstream or store call is counted here, and the AROME
 * grids, the only thing a question downloads in variable number, are sized from what is left.
 * Outside a counted invocation (Node, tests) nothing is limited.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const WORKER_FREE_LIMIT = 50;

interface Tally {
  used: number;
  limit: number;
  /** Things shared by everything the invocation does, such as the Météo-France OAuth session. */
  shared: Map<string, unknown>;
  /** The work left to finish after the response, and how to keep the invocation alive for it (the Worker's waitUntil). */
  later: Promise<unknown>[];
  keep?: (work: Promise<unknown>) => void;
}

const current = new AsyncLocalStorage<Tally>();

/**
 * Runs `fn` with its own tally; returns its result, the number of subrequests it made by then, and `settled`: the
 * number once the work handed to `later` is done too, since that work counts against the same limit.
 */
export async function counted<T>(
  limit: number,
  fn: () => Promise<T>,
  keep?: (work: Promise<unknown>) => void,
): Promise<{ value: T; used: number; settled: () => Promise<number> }> {
  const tally: Tally = { used: 0, limit, shared: new Map<string, unknown>(), later: [], keep };
  const value = await current.run(tally, fn);
  const settled = async () => {
    // Work done later may hand over more work.
    for (let n = -1; n !== tally.later.length; ) {
      n = tally.later.length;
      await Promise.allSettled(tally.later);
    }
    return tally.used;
  };
  return { value, used: tally.used, settled };
}

/**
 * Work to finish after the response, wherever it starts (a page, a tool): the Worker keeps the invocation alive for it.
 * Outside a counted invocation (Node, tests) it just runs.
 */
export function later(work: Promise<unknown>) {
  const t = current.getStore();
  if (!t) return;
  t.later.push(work);
  t.keep?.(work);
}

/** To call right before each subrequest. */
export function count(n = 1) {
  const t = current.getStore();
  if (t) t.used += n;
}

/** Subrequests the invocation may still make. */
export function left(): number {
  const t = current.getStore();
  return t ? t.limit - t.used : Infinity;
}

/** One `make()` per invocation under `key`; outside a counted invocation, a new one each call. */
export function perInvocation<T>(key: string, make: () => T): T {
  const t = current.getStore();
  if (!t) return make();
  if (!t.shared.has(key)) t.shared.set(key, make());
  return t.shared.get(key) as T;
}
