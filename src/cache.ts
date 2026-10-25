/**
 * Upstream cache shared by every user of the server.
 *
 * Each source is fetched at most once per `freshSeconds`, whatever the number of questions: one METAR call
 * serves everyone for five minutes. When the source is down, the last good copy is served with `stale: true`
 * (its measurement times say how old it is), and failures are remembered for a minute (longer for a source that
 * stays down for days) so that an outage does not turn every question into a new request against a server that is
 * already struggling.
 */
import { costOf } from "./budget.js";
import { cacheTally } from "./metrics.js";

import { noteLecture } from "./lectures.js";
import { UpstreamError, why } from "./types.js";
import { familyOf, RENDU_REVISION } from "./web/revisions.js";

/**
 * The shape of what the stores keep (a source's answer, a page's copy), in the keys of the data center's cache and of
 * the shared copies in KV (worker.ts, web/partagees.ts). Raised only by a change that makes the new code unable to read
 * an entry the old code wrote (a field renamed, removed, or newly required): a deploy then starts from empty stores.
 * Any other deploy keeps them, so that the data centers stay warm. A copy that still breaks a page is caught there
 * (web/site.ts) and built again. A page's copy is built again at its first view after the deploy that raises its
 * family's revision (`outdated`).
 */
export const CACHE_FORMAT = "2";

export interface CacheEntry {
  value: unknown;
  fetchedAt: number;
  /** For a page's copy: the subrequests its build took (budget.ts), for the isolates that have not built it yet. */
  cost?: number;
  /** For a page's copy: the revision of the code that built it (`stampOf`). */
  version?: string;
}

/**
 * A page's copy (web/data.ts): the answer of the code that built it, wording and links included. A deploy keeps the
 * stores, so such a copy outlives the code that built it.
 */
export const isCopy = (key: string) => key.startsWith("web:");

/**
 * What a page's copy built by the code of `version` (server.ts) is stamped with: its family's revision
 * (web/revisions.ts, #272), or the version itself for a family not listed there. Nothing for another key, or
 * when the code has no version (tests, Node).
 */
export const stampOf = (key: string, version: string | undefined) => {
  if (version == null || !isCopy(key)) return undefined;
  const revision = RENDU_REVISION[familyOf(key)];
  return revision != null ? `rendu-${revision}` : version;
};

/**
 * Whether `entry`, kept under `key`, is a page's copy stamped otherwise than the code of `version` stamps it
 * (#269, #272): due at once, whatever its age, so that a page shows what its code says from the first view
 * after the deploy that changed it. It stays the copy served if its build fails. A copy written before the stamps were
 * kept has none: built again once.
 */
export const outdated = (key: string, entry: { version?: string } | undefined, version: string | undefined) =>
  entry != null && stampOf(key, version) != null && entry.version !== stampOf(key, version);

/** Where entries live: process memory on Node; memory in front of the Cloudflare cache in the Worker. */
export interface CacheStore {
  /** `freshAfter`: an entry fetched since then will do, so slower stores need not be asked (nor paid for). */
  get(key: string, freshAfter?: number): Promise<CacheEntry | undefined>;
  put(key: string, entry: CacheEntry): Promise<void>;
}

export class MemoryStore implements CacheStore {
  private entries = new Map<string, CacheEntry>();
  async get(key: string) {
    return this.entries.get(key);
  }
  async put(key: string, entry: CacheEntry) {
    this.entries.set(key, entry);
  }
}

/**
 * Several stores, fastest first, written together. A store is only asked when the ones before it have nothing
 * fresh enough, and the newest entry wins; what a slower store had is copied into the faster ones. In the Worker,
 * isolate memory answers without I/O while the shared edge cache lets one isolate's fetch serve the others.
 */
export class TieredStore implements CacheStore {
  private stores: CacheStore[];
  constructor(...stores: CacheStore[]) {
    this.stores = stores;
  }
  async get(key: string, freshAfter?: number) {
    let newest: CacheEntry | undefined;
    let from = 0;
    for (let i = 0; i < this.stores.length; i++) {
      const e = await this.stores[i].get(key, freshAfter);
      if (e && (!newest || e.fetchedAt > newest.fetchedAt)) {
        newest = e;
        from = i;
      }
      if (newest && freshAfter != null && newest.fetchedAt >= freshAfter) break;
    }
    if (newest) for (let i = 0; i < from; i++) await this.stores[i].put(key, newest);
    return newest;
  }
  async put(key: string, entry: CacheEntry) {
    await Promise.all(this.stores.map((s) => s.put(key, entry)));
  }
}

/** The last good copy, served because `error` stopped its refresh: with the source that did not answer, if it said. */
const lastCopy = <T>(hit: CacheEntry, error: unknown): Cached<T> =>
  ({ value: hit.value as T, fetchedAt: new Date(hit.fetchedAt), stale: true, ...(error instanceof UpstreamError && { source: error.source }) });

export interface Cached<T> {
  value: T;
  fetchedAt: Date;
  /** True when the source failed and this is the last good copy. */
  stale: boolean;
  /** With `stale`: the id of the source that did not answer, when its error said it (an UpstreamError). */
  source?: string;
  /** What its build took, when it was measured (`peek` only). */
  cost?: number;
  /** A page's copy built by another version of the code (`outdated`, `peek` only). */
  outdated?: boolean;
}

const FAILURE_BACKOFF_SECONDS = 60;
// The invocation ran out of subrequests: not the source's fault, so not remembered against it.
const OUT_OF_BUDGET = /Too many subrequests/;
// Bundles kept in memory per process; older ones (an AROME run replaced by the next) are dropped.
const MAX_BUNDLES = 8;

/**
 * Entries kept together as one entry of a store: one read and at most one write per question, however many entries
 * it uses. In the Worker every read or write of a shared store is a subrequest, and subrequests are limited.
 */
export interface Bundle {
  /** Whether the entry is there, however old. No I/O. */
  has(key: string): boolean;
  /** The entry and how long ago it was stored, in ms, however old. No I/O. */
  peek(key: string): (CacheEntry & { ageMs: number }) | undefined;
  /** Stores `value` under `key` (written by `save`). */
  set(key: string, value: unknown): void;
  /** As `Cache.get`, within the bundle. */
  get<T>(key: string, freshSeconds: number, load: () => Promise<T>): Promise<Cached<T>>;
  /** Forgets the entries `keep` rejects (not written by itself). */
  drop(keep: (key: string) => boolean): void;
  /** Writes the bundle back if something was added. */
  save(): Promise<void>;
}

interface BundleState {
  entries: Record<string, CacheEntry>;
  syncedAt: number;
}

export class Cache {
  private inflight = new Map<string, Promise<Cached<unknown>>>();
  private failures = new Map<string, { at: number; error: unknown }>();
  private bundles = new Map<string, BundleState>();

  /**
   * `dedupe` lets concurrent questions share one upstream request. The Worker turns it off: there, a request
   * awaiting a fetch started by another request fails if that other request is cancelled first.
   * `durable` holds the bundles that must outlive the data center's cache (the Worker's KV: written by the
   * scheduled prefetch in one data center, read by questions in all of them).
   * `version`: the code's (server.ts); each page's copy is stamped with its family's revision (`stampOf`), and a copy
   * stamped otherwise is built again (`outdated`).
   */
  constructor(
    private store: CacheStore = new MemoryStore(),
    private now: () => number = Date.now,
    private dedupe = true,
    private durable: CacheStore = store,
    readonly version?: string,
  ) {}

  /** `backoffSeconds`: how long a failure is remembered (in this process) before the source is asked again. */
  async get<T>(key: string, freshSeconds: number, load: () => Promise<T>, backoffSeconds = FAILURE_BACKOFF_SECONDS): Promise<Cached<T>> {
    const hit = await this.store.get(key, this.now() - freshSeconds * 1000);
    return this.noted(key, freshSeconds, await this.serve(key, hit, freshSeconds, load, (e) => this.store.put(key, e), backoffSeconds));
  }

  /**
   * As `get`, from the entry the caller has just read (`peek`, or an older `get`) instead of reading the stores again:
   * served if fresh enough, else loaded, the entry being the copy served if the source fails.
   */
  async getFrom<T>(key: string, have: Cached<T> | undefined, freshSeconds: number, load: () => Promise<T>): Promise<Cached<T>> {
    const hit = have && { value: have.value, fetchedAt: have.fetchedAt.getTime(), ...(have.cost != null && { cost: have.cost }), ...(!have.outdated && { version: stampOf(key, this.version) }) };
    return this.noted(key, freshSeconds, await this.serve(key, hit, freshSeconds, load, (e) => this.store.put(key, e)));
  }

  /** Tells the tool call being answered, if any, what it was served (lectures.ts): its answer says how fresh it is. */
  private noted<T>(key: string, freshSeconds: number, c: Cached<T>): Cached<T> {
    noteLecture({ key, fetchedAt: c.fetchedAt.getTime(), stale: c.stale, freshSeconds, ...(c.source && { source: c.source }) });
    return c;
  }

  /**
   * The newest entry stored under `key`, however old, without loading it. `freshAfter` (a time, ms): an entry fetched
   * since then in a faster store will do, so slower stores (the data center's cache, a subrequest each) are asked only
   * otherwise.
   */
  async peek<T>(key: string, freshAfter?: number): Promise<Cached<T> | undefined> {
    const hit = await this.store.get(key, freshAfter);
    return hit && { value: hit.value as T, fetchedAt: new Date(hit.fetchedAt), stale: false, ...(hit.cost != null && { cost: hit.cost }), ...(outdated(key, hit, this.version) && { outdated: true }) };
  }

  /** The value kept under `key` in the durable store (the Worker's KV), however old: what must outlive a deploy. */
  async kept<T>(key: string): Promise<Cached<T> | undefined> {
    const hit = await this.durable.get(key);
    return hit && { value: hit.value as T, fetchedAt: new Date(hit.fetchedAt), stale: true };
  }

  /** Keeps `value` under `key` in the durable store. */
  async keep(key: string, value: unknown): Promise<void> {
    await this.durable.put(key, { value, fetchedAt: this.now() });
  }

  /**
   * The bundle stored under `key`. The copy in memory is merged with the stored one when it is older than
   * `syncSeconds`, so that another isolate's additions arrive; two isolates saving at the same time may lose one's
   * additions, which are then fetched again later.
   */
  async bundle(key: string, syncSeconds: number, durable = false): Promise<Bundle> {
    const store = durable ? this.durable : this.store;
    let state = this.bundles.get(key);
    if (!state) {
      state = { entries: {}, syncedAt: -Infinity };
      this.bundles.set(key, state);
      if (this.bundles.size > MAX_BUNDLES) this.bundles.delete(this.bundles.keys().next().value!);
    }
    if (this.now() - state.syncedAt >= syncSeconds * 1000) {
      state.syncedAt = this.now();
      const stored = (await store.get(key))?.value as Record<string, CacheEntry> | undefined;
      for (const [k, e] of Object.entries(stored ?? {})) {
        if (!state.entries[k] || e.fetchedAt > state.entries[k].fetchedAt) state.entries[k] = e;
      }
    }
    const s = state;
    let added = false;
    return {
      has: (k) => k in s.entries,
      peek: (k) => (k in s.entries ? { ...s.entries[k], ageMs: this.now() - s.entries[k].fetchedAt } : undefined),
      set: (k, value) => {
        s.entries[k] = { value, fetchedAt: this.now() };
        added = true;
      },
      get: async <T>(k: string, freshSeconds: number, load: () => Promise<T>) =>
        this.noted(`${key}|${k}`, freshSeconds, await this.serve(`${key}|${k}`, s.entries[k], freshSeconds, load, async (e) => {
          s.entries[k] = e;
          added = true;
        })),
      drop: (keep) => {
        for (const k of Object.keys(s.entries)) if (!keep(k)) delete s.entries[k];
      },
      save: async () => {
        if (!added) return;
        added = false;
        await store.put(key, { value: s.entries, fetchedAt: this.now() });
      },
    };
  }

  private async serve<T>(
    key: string,
    hit: CacheEntry | undefined,
    freshSeconds: number,
    load: () => Promise<T>,
    put: (e: CacheEntry) => Promise<void>,
    backoffSeconds = FAILURE_BACKOFF_SECONDS,
  ): Promise<Cached<T>> {
    if (hit && this.now() - hit.fetchedAt < freshSeconds * 1000 && !outdated(key, hit, this.version)) {
      cacheTally().hits++;
      return { value: hit.value as T, fetchedAt: new Date(hit.fetchedAt), stale: false };
    }
    cacheTally().loads++;
    const failed = this.failures.get(key);
    if (failed && this.now() - failed.at < backoffSeconds * 1000) {
      if (hit) return lastCopy<T>(hit, failed.error);
      throw failed.error;
    }
    let pending = this.dedupe ? this.inflight.get(key) : undefined;
    if (!pending) {
      pending = this.refresh(key, hit, load, put);
      if (this.dedupe) this.inflight.set(key, pending);
    }
    return pending as Promise<Cached<T>>;
  }

  private async refresh<T>(
    key: string,
    hit: CacheEntry | undefined,
    load: () => Promise<T>,
    put: (e: CacheEntry) => Promise<void>,
  ): Promise<Cached<T>> {
    try {
      const value = await load();
      // A page's build is measured under its key (budget.ts `measured`): what it took goes with its copy.
      const cost = costOf(key);
      const entry: CacheEntry = { value, fetchedAt: this.now(), ...(cost != null && { cost }), ...(stampOf(key, this.version) != null && { version: stampOf(key, this.version) }) };
      await put(entry);
      this.failures.delete(key);
      return { value, fetchedAt: new Date(entry.fetchedAt), stale: false };
    } catch (error) {
      if (!OUT_OF_BUDGET.test(String((error as Error)?.message ?? error))) {
        this.failures.set(key, { at: this.now(), error });
        // The source answered, but reading it failed (its page changed shape…): ours to mend, said in the logs only.
        if (!(error instanceof UpstreamError)) console.error(`lecture sans aboutir : ${key}`, why(error));
      }
      if (hit) return lastCopy<T>(hit, error);
      throw error;
    } finally {
      this.inflight.delete(key);
    }
  }
}
