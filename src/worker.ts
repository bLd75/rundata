/**
 * Cloudflare Worker entry: the same MCP endpoint as the Node server (app.ts), at the edge.
 *
 * Upstream answers are kept in isolate memory and in the Cloudflare cache of the data center, so that one
 * METAR call serves every isolate there for five minutes. The Cloudflare cache only works on a custom domain
 * (on *.workers.dev its calls do nothing). The AROME grids, filled every few minutes by the scheduled event,
 * live in KV instead: the event runs in some data center, the questions in all the others.
 */
import { handle } from "./app.js";
import { WORKER_FREE_LIMIT, count, counted } from "./budget.js";
import { Cache, MemoryStore, TieredStore, type CacheEntry, type CacheStore } from "./cache.js";
import { visitor, type Hit } from "./metrics.js";
import * as irve from "./providers/irve.js";
import * as eauIle from "./eau/ile.js";
import * as meteofrance from "./providers/meteofrance.js";
import * as transit from "./providers/transit.js";
import { prefetchForecasts } from "./tools/prevision.js";
import { why } from "./types.js";

// How long the edge keeps an entry. Much longer than any freshness window: an old copy is what gets served,
// marked as such, while a source is down.
const KEEP_SECONDS = 7 * 24 * 3600;
// An AROME run's bundle is of no use once a few newer runs exist.
const KV_KEEP_SECONDS = 3 * 24 * 3600;

class EdgeStore implements CacheStore {
  private url(key: string) {
    return `https://cache.reunion-temps-reel.internal/upstream/${encodeURIComponent(key)}`;
  }
  async get(key: string) {
    try {
      count();
      const r = await (await caches.open("upstream")).match(this.url(key));
      return r ? ((await r.json()) as CacheEntry) : undefined;
    } catch {
      return undefined; // a cache problem must never cost an answer
    }
  }
  async put(key: string, entry: CacheEntry) {
    try {
      const body = new Response(JSON.stringify(entry), {
        headers: { "content-type": "application/json", "cache-control": `max-age=${KEEP_SECONDS}` },
      });
      count();
      await (await caches.open("upstream")).put(this.url(key), body);
    } catch {
      // same
    }
  }
}

/** The part of a KV namespace binding used here. */
interface KvNamespace {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

class KvStore implements CacheStore {
  constructor(private kv: KvNamespace) {}
  async get(key: string) {
    try {
      return ((await this.kv.get(key, "json")) ?? undefined) as CacheEntry | undefined;
    } catch {
      return undefined;
    }
  }
  async put(key: string, entry: CacheEntry) {
    try {
      await this.kv.put(key, JSON.stringify(entry), { expirationTtl: KV_KEEP_SECONDS });
    } catch (err) {
      console.error("KV : écriture impossible", why(err)); // free plan: 1 000 writes a day
    }
  }
}

/** The Worker's bindings and secrets. */
interface Env {
  METEOFRANCE_APPLICATION_ID?: string;
  METEOFRANCE_API_KEY?: string;
  STORE?: KvNamespace;
  USAGE?: AnalyticsDataset;
  TRANSIT?: D1Database;
}

/** The part of a D1 binding used here. */
interface D1Database {
  prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }> } };
}

/** The part of a Workers Analytics Engine binding used here. */
interface AnalyticsDataset {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}

/**
 * One point per tool call or page view (metrics.ts). Columns, for the SQL API: index1 and blob1 = kind (mcp, page),
 * blob2 = tool or path, blob3 = place asked or « bouton », blob4 = visitor, blob5 = country, blob6 = referring site;
 * double1 = 1 if answered without error.
 */
function recorder(env: Env, request: Request) {
  const usage = env.USAGE;
  if (!usage) return undefined;
  const who = visitor(request.headers.get("user-agent") ?? "");
  const country = String((request as { cf?: { country?: unknown } }).cf?.country ?? "");
  let from = "";
  try {
    const ref = new URL(request.headers.get("referer") ?? "");
    if (ref.host !== new URL(request.url).host) from = ref.host;
  } catch {}
  return (hit: Hit) => {
    try {
      usage.writeDataPoint({ indexes: [hit.kind], blobs: [hit.kind, hit.name, hit.detail ?? "", who, country, from], doubles: [hit.ok ? 1 : 0] });
    } catch (err) {
      console.error("analytics : écriture impossible", why(err));
    }
  };
}

let cache: Cache | undefined;

function setup(env: Env): Cache {
  meteofrance.configure({ applicationId: env.METEOFRANCE_APPLICATION_ID, apiKey: env.METEOFRANCE_API_KEY });
  const d1 = env.TRANSIT;
  const kv = env.STORE;
  // Filtered from the national file by .github/workflows/irve.yml (src/providers/irve.ts).
  irve.configure(kv && (async () => {
    count();
    return (await kv.get("irve:etat", "json")) as irve.Live | null;
  }));
  // Gathered site by site and commune by commune by .github/workflows/eau.yml (src/eau/ile.ts).
  eauIle.configure(kv && (async () => {
    count();
    return (await kv.get("eau:ile", "json")) as eauIle.Ile | null;
  }));
  transit.configure(d1 && { all: async <T>(sql: string, ...params: unknown[]) => (await d1.prepare(sql).bind(...params).all<T>()).results });
  // Without the KV binding, the bundles stay in the data center's cache like everything else.
  return (cache ??= new Cache(new TieredStore(new MemoryStore(), new EdgeStore()), Date.now, false, env.STORE && new KvStore(env.STORE)));
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const c = setup(env);
    // A page served from its last copy refreshes it after the response (web/data.ts).
    const { value, used } = await counted(WORKER_FREE_LIMIT, () => handle(request, c, (p) => ctx.waitUntil(p), recorder(env, request)));
    if (used) console.log(`sous-requêtes : ${used} (${new URL(request.url).pathname})`);
    return value;
  },

  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const c = setup(env);
    ctx.waitUntil(
      counted(WORKER_FREE_LIMIT, () => prefetchForecasts(c))
        .then(({ value, used }) => console.log(`préchargement AROME : ${JSON.stringify(value)}, sous-requêtes : ${used}`))
        .catch((err) => console.error("préchargement AROME impossible", why(err))),
    );
  },
};
