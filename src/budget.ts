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
}

const current = new AsyncLocalStorage<Tally>();

/** Runs `fn` with its own tally; returns its result and the number of subrequests it made. */
export async function counted<T>(limit: number, fn: () => Promise<T>): Promise<{ value: T; used: number }> {
  const tally = { used: 0, limit, shared: new Map<string, unknown>() };
  const value = await current.run(tally, fn);
  return { value, used: tally.used };
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
