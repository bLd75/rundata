/**
 * Subrequests of the current invocation. A Cloudflare Worker may make a limited number per invocation (fetches,
 * Cache API and KV calls alike) and fails the next ones, so every upstream or store call is counted here.
 *
 * The rule, for every page and tool: an invocation makes at most WORKER_BUDGET subrequests, the work after its response
 * included, well under the platform's limit. A tenth of it is kept for the cache: for writing to it what was read, which
 * is what saves the next visits from reading it again, and half of that tenth for reading a copy already stored too, so
 * that a question late in its budget is still served the copy one read away rather than an error. Past it a subrequest
 * is refused here, as the platform would refuse it: a refused read of the cache is a copy not found, a refused load is
 * not held against the source (the copy in memory, if any, is served), and the Worker's log says how many were refused. Work that may wait (a tile brought up to date after the response, an agenda, the
 * AROME grids) is sized from `left()` and the cost of its last run (`costOf`), and is left to a later visit otherwise.
 * Outside a counted invocation (Node, tests) nothing is limited.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const WORKER_FREE_LIMIT = 50;
/** What a page or a tool may use, the work after the response included. */
export const WORKER_BUDGET = 40;

interface Tally {
  used: number;
  /** The subrequests asked for past the budget. */
  refused: number;
  limit: number;
  /** Things shared by everything the invocation does, such as the Météo-France OAuth session. */
  shared: Map<string, unknown>;
  /** The work left to finish after the response, and how to keep the invocation alive for it (the Worker's waitUntil). */
  later: Promise<unknown>[];
  keep?: (work: Promise<unknown>) => void;
}

/** A part of the invocation whose subrequests are measured (a page's build), within the ones it is part of. */
interface Job {
  key: string;
  used: number;
  refused: number;
  done: boolean;
  parent?: Job;
}

const current = new AsyncLocalStorage<Tally>();
const jobs = new AsyncLocalStorage<Job>();
// What each job took the last times it ran in this isolate: the most of them, refused subrequests included.
const costs = new Map<string, number>();

/** A subrequest past the invocation's budget. « Too many subrequests », as the platform says it (cache.ts). */
export class OutOfBudget extends Error {
  constructor(limit: number) {
    super(`Too many subrequests: the invocation's budget of ${limit} is spent`);
  }
}

/**
 * Runs `fn` with its own tally; returns its result, the number of subrequests it made by then, and `settled`: the
 * numbers once the work handed to `later` is done too, since that work counts against the same budget.
 */
export async function counted<T>(
  limit: number,
  fn: () => Promise<T>,
  keep?: (work: Promise<unknown>) => void,
): Promise<{ value: T; used: number; settled: () => Promise<{ used: number; refused: number }> }> {
  const tally: Tally = { used: 0, refused: 0, limit, shared: new Map<string, unknown>(), later: [], keep };
  const value = await current.run(tally, fn);
  const settled = async () => {
    // Work done later may hand over more work.
    for (let n = -1; n !== tally.later.length; ) {
      n = tally.later.length;
      await Promise.allSettled(tally.later);
    }
    return { used: tally.used, refused: tally.refused };
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

/** The part of the budget kept for the cache: writes may use all of it, reads of a stored copy half of it. */
const kept = (t: Tally) => Math.floor(t.limit / 10);

/**
 * To call right before each subrequest (`kind`: true for a copy written to the cache, "read" for a copy read from it):
 * throws `OutOfBudget` instead when the invocation has none left for it.
 */
export function count(n = 1, kind: boolean | "read" = false) {
  const t = current.getStore();
  if (!t) return;
  const room = kind === true ? t.limit : kind === "read" ? t.limit - Math.ceil(kept(t) / 2) : t.limit - kept(t);
  const refused = t.used + n > room;
  if (refused) t.refused += n;
  else t.used += n;
  for (let j = jobs.getStore(); j; j = j.parent) {
    if (refused) j.refused += n;
    else j.used += n;
    // Work a job handed over after it returned still counts as its own.
    if (j.done) costs.set(j.key, Math.max(costs.get(j.key) ?? 0, j.used + j.refused));
  }
  if (refused) throw new OutOfBudget(t.limit);
}

/**
 * Runs `fn` as the job `key` (a page's build) and remembers how many subrequests it took, so that it is started again
 * only when they are left (`costOf`). Outside a counted invocation it just runs.
 */
export async function measured<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!current.getStore()) return fn();
  const job: Job = { key, used: 0, refused: 0, done: false, parent: jobs.getStore() };
  try {
    return await jobs.run(job, fn);
  } finally {
    job.done = true;
    costs.set(key, Math.max(costs.get(key) ?? 0, job.used + job.refused));
  }
}

/**
 * Runs `fn` outside the job it is called from: its subrequests count for the invocation, not for the job's cost
 * (`costOf`). For work a build does only with what is left, and not every time, such as a PDF read once.
 */
export function unmeasured<T>(fn: () => Promise<T>): Promise<T> {
  return jobs.exit(fn);
}

/** The most subrequests the job `key` has taken in this isolate, if it has run here. */
export function costOf(key: string): number | undefined {
  return costs.get(key);
}

/** Subrequests the invocation has made so far; none outside a counted invocation. */
export function spent(): number {
  return current.getStore()?.used ?? 0;
}

/** Subrequests the invocation may still make, besides the writes to the cache. */
export function left(): number {
  const t = current.getStore();
  return t ? t.limit - kept(t) - t.used : Infinity;
}

/** One `make()` per invocation under `key`; outside a counted invocation, a new one each call. */
export function perInvocation<T>(key: string, make: () => T): T {
  const t = current.getStore();
  if (!t) return make();
  if (!t.shared.has(key)) t.shared.set(key, make());
  return t.shared.get(key) as T;
}
