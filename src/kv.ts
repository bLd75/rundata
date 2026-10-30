/**
 * The bundles that must outlive the data center's cache (the AROME grids: cache.ts `durable`), kept in the Worker's KV.
 * Each read or write is a subrequest, counted like the data center's cache (worker.ts EdgeStore).
 */
import { count } from "./budget.js";
import type { CacheEntry, CacheStore } from "./cache.js";
import { why } from "./types.js";

// An AROME run's bundle is of no use once a few newer runs exist. The default: an entry asks for longer (`put`).
export const KV_KEEP_SECONDS = 3 * 24 * 3600;

/** The part of the KV binding read and written here (worker.ts KvNamespace). */
export interface KvBinding {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export class KvStore implements CacheStore {
  constructor(private kv: KvBinding) {}
  async get(key: string) {
    try {
      count(1, "read");
      return ((await this.kv.get(key, "json")) ?? undefined) as CacheEntry | undefined;
    } catch {
      return undefined;
    }
  }
  async put(key: string, entry: CacheEntry, keepSeconds = KV_KEEP_SECONDS) {
    try {
      count(1, true);
      await this.kv.put(key, JSON.stringify(entry), { expirationTtl: keepSeconds });
    } catch (err) {
      console.error("KV : écriture impossible", why(err)); // free plan: 1 000 writes a day
    }
  }
}
