/**
 * Subrequests of the current invocation. Every upstream or store call is counted here (fetches, Cache API, KV and D1
 * calls alike), against a budget per kind of invocation, well under the platform's limits.
 *
 * The platform: SUBREQUEST_LIMIT per invocation; SERVICE_OPS_LIMIT calls to KV, D1 and the other bound
 * services together per invocation (a bulk KV call counts as one); at most six connections waiting for their headers
 * at once, the next ones queued; 30 s of CPU for a scheduled event that runs more often than hourly. Fetches are not
 * billed; CPU time and KV operations past the month's included ones are.
 *
 * The budgets: SCHEDULED_BUDGET for the scheduled event, which builds every shared copy that is due; PAGE_BUDGET for a
 * visit or a tool call, the work after its response included; BUILD_BUDGET for one page's copy (`measured`), so that
 * a build gone wrong stops there. They are all under SERVICE_OPS_LIMIT, and every KV and D1 call is counted: the
 * platform's limit on them is never reached. How often a source is read does not depend on them: every read waits for
 * its copy to be due (cache.ts), the budget only lets it happen now rather than at a later visit.
 *
 * A tenth of a budget is kept for the cache: for writing to it what was read, which is what saves the next visits from
 * reading it again, and half of that tenth for reading a copy already stored too, so that a question late in its budget
 * is still served the copy one read away rather than an error. Past it a subrequest is refused here: a refused read of
 * the cache is a copy not found, a refused load is not held against the source (the copy in memory, if any, is
 * served), and the Worker's log says how many were refused. Work that may wait (a tile brought up to date after the
 * response, an agenda, the AROME grids) is sized from `left()` and the cost of its last run (`costOf`), and is left to a
 * later visit otherwise. Outside a counted invocation (Node, tests) nothing is limited.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** What the platform allows an invocation. */
export const SUBREQUEST_LIMIT = 10_000;
/** Calls to KV, D1 and the other bound services, together, per invocation. */
export const SERVICE_OPS_LIMIT = 1_000;
/**
 * The scheduled event, every 5 minutes: the AROME grids (MAX_NEW_GRIDS at most, providers/arome.ts), every shared copy
 * that is due (about 115 subrequests when all are, from cold, web/partagees.ts), the planned agendas, with room for a
 * slow day. Half of SERVICE_OPS_LIMIT.
 */
export const SCHEDULED_BUDGET = 500;
/**
 * A visit or a tool call, the work after its response included: its own reads, and the copies it brings up to date
 * after the response (a page's dearest, about 35 from cold). Lower than the scheduled event's, which does the bulk.
 */
export const PAGE_BUDGET = 200;
/** One page's copy (`measured`): about three times the dearest measured (a place's or the traffic's, about 35). */
export const BUILD_BUDGET = 100;

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
  /** The reads of each source (http.ts), by its id: logged with the subrequests (worker.ts), to see how often each is asked. */
  reads: Map<string, number>;
  /** Subrequests set aside for work running beside the rest (`reserve`): left out of what `left` says is left. */
  reserved: number;
}

/** A part of the invocation whose subrequests are measured (a page's build), within the ones it is part of. */
interface Job {
  key: string;
  /** What it may use, besides what the invocation has left (BUILD_BUDGET). */
  limit: number;
  used: number;
  refused: number;
  done: boolean;
  parent?: Job;
}

const current = new AsyncLocalStorage<Tally>();
const jobs = new AsyncLocalStorage<Job>();
// What each job took the last times it ran in this isolate: the most of them, refused subrequests included.
const costs = new Map<string, number>();

/** A subrequest past the invocation's budget, or a build's. « Too many subrequests », as the platform says it (cache.ts). */
export class OutOfBudget extends Error {
  constructor(limit: number) {
    super(`Too many subrequests: the budget of ${limit} is spent`);
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
): Promise<{ value: T; used: number; reads: Map<string, number>; settled: () => Promise<{ used: number; refused: number; reads: Map<string, number> }> }> {
  const tally: Tally = { used: 0, refused: 0, limit, shared: new Map<string, unknown>(), later: [], keep, reads: new Map(), reserved: 0 };
  const value = await current.run(tally, fn);
  const settled = async () => {
    // Work done later may hand over more work.
    for (let n = -1; n !== tally.later.length; ) {
      n = tally.later.length;
      await Promise.allSettled(tally.later);
    }
    return { used: tally.used, refused: tally.refused, reads: tally.reads };
  };
  return { value, used: tally.used, reads: tally.reads, settled };
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
  // The budget it would go past: the invocation's, or that of a build it is part of.
  let over = t.used + n > room ? t.limit : undefined;
  for (let j = jobs.getStore(); j && over === undefined; j = j.parent) if (j.used + n > j.limit) over = j.limit;
  const refused = over !== undefined;
  if (refused) t.refused += n;
  else t.used += n;
  for (let j = jobs.getStore(); j; j = j.parent) {
    if (refused) j.refused += n;
    else j.used += n;
    // Work a job handed over after it returned still counts as its own.
    if (j.done) costs.set(j.key, Math.max(costs.get(j.key) ?? 0, j.used + j.refused));
  }
  if (refused) throw new OutOfBudget(over!);
}

/** Counts a read of `source` (its id), once its subrequest is counted: nothing outside a counted invocation. */
export function countRead(source: string) {
  const t = current.getStore();
  if (t) t.reads.set(source, (t.reads.get(source) ?? 0) + 1);
}

/** « , lectures : prefecture_communiques 2, ipgp_ovpf_seismes 1 »: the reads of each source, the most read first; "" without one. */
export const readsSaid = (reads: Map<string, number>) =>
  reads.size ? `, lectures : ${[...reads].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s, n]) => `${s} ${n}`).join(", ")}` : "";

/**
 * Runs `fn` as the job `key` (a page's build) and remembers how many subrequests it took, so that it is started again
 * only when they are left (`costOf`). Past `limit`, its subrequests are refused, whatever the invocation has left.
 * Outside a counted invocation it just runs.
 */
export async function measured<T>(key: string, fn: () => Promise<T>, limit = BUILD_BUDGET): Promise<T> {
  if (!current.getStore()) return fn();
  const job: Job = { key, limit, used: 0, refused: 0, done: false, parent: jobs.getStore() };
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
  return t ? t.limit - kept(t) - t.used - t.reserved : Infinity;
}

/**
 * Sets `n` subrequests aside for work that runs beside the rest of the invocation (a copy built alongside,
 * partagees.ts): what the rest sizes itself on (`left`) leaves them out until `release` is called, once it is done.
 */
export function reserve(n: number): () => void {
  const t = current.getStore();
  if (!t) return () => {};
  t.reserved += n;
  let released = false;
  return () => {
    if (!released) t.reserved -= n;
    released = true;
  };
}

const SCHEDULED = "budget:planifie";

/** Marks this invocation as the scheduled event's (worker.ts): nobody waits for its answer. */
export function scheduled(): void {
  current.getStore()?.shared.set(SCHEDULED, true);
}

/** Whether this invocation is the scheduled event's; outside a counted invocation, not. */
export const isScheduled = () => current.getStore()?.shared.get(SCHEDULED) === true;

/** One `make()` per invocation under `key`; outside a counted invocation, a new one each call. */
export function perInvocation<T>(key: string, make: () => T): T {
  const t = current.getStore();
  if (!t) return make();
  if (!t.shared.has(key)) t.shared.set(key, make());
  return t.shared.get(key) as T;
}
