/**
 * Cloudflare Worker entry: the same MCP endpoint as the Node server (app.ts), at the edge.
 *
 * Upstream answers are kept in isolate memory and in the Cloudflare cache of the data center, so that one
 * METAR call serves every isolate there for five minutes. The Cloudflare cache only works on a custom domain
 * (on *.workers.dev its calls do nothing). The AROME grids, filled every few minutes by the scheduled event,
 * live in KV instead: the event runs in some data center, the questions in all the others.
 */
import { handle } from "./app.js";
import { WORKER_FREE_LIMIT, count, counted, later } from "./budget.js";
import { Cache, MemoryStore, TieredStore, type CacheEntry, type CacheStore } from "./cache.js";
import { audience, language, point, visitor, type Hit } from "./metrics.js";
import { VERSION } from "./server.js";
import * as irve from "./providers/irve.js";
import * as eauIle from "./eau/ile.js";
import * as meteofrance from "./providers/meteofrance.js";
import * as transit from "./providers/transit.js";
import * as climat from "./providers/climat.js";
import { prefetchForecasts } from "./tools/prevision.js";
import { why } from "./types.js";

// How long the edge keeps an entry. Much longer than any freshness window: an old copy is what gets served,
// marked as such, while a source is down.
const KEEP_SECONDS = 7 * 24 * 3600;
// An AROME run's bundle is of no use once a few newer runs exist.
const KV_KEEP_SECONDS = 3 * 24 * 3600;

class EdgeStore implements CacheStore {
  // Per version: a copy written by the previous code (a page's data, a source's answer) may lack what the new code
  // reads, and the page would fail until the copy expires. A deploy starts afresh; the KV bundles are not affected.
  private url(key: string) {
    return `https://cache.reunion-temps-reel.internal/upstream/${VERSION}/${encodeURIComponent(key)}`;
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
  CLIMAT?: D1Database;
  CLIMAT_H?: D1Database;
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
 * One point per MCP message or page view (metrics.ts: `point` lists the columns, for the SQL API), and one log line
 * per MCP message, with the same fields.
 */
function recorder(env: Env, request: Request) {
  const usage = env.USAGE;
  const headers = request.headers;
  const who = visitor(headers.get("user-agent") ?? "");
  const country = String((request as { cf?: { country?: unknown } }).cf?.country ?? "");
  let from = "";
  try {
    const ref = new URL(headers.get("referer") ?? "");
    if (ref.host !== new URL(request.url).host) from = ref.host;
  } catch {}
  // A link shared by the campaign carries its channel (« ?ref=fb », « ?ref=presse-zinfos »): it wins over the referer.
  const tag = new URL(request.url).searchParams.get("ref")?.replace(/[^\w.-]/g, "").slice(0, 40);
  if (tag) from = `ref:${tag}`;
  return (hit: Hit) => {
    if (hit.kind !== "page") console.log(logLine(hit, who, country));
    if (!usage) return;
    try {
      const page = hit.kind === "page";
      usage.writeDataPoint(point(hit, { who, country, from, audience: page ? audience(headers) : "", language: page ? language(headers.get("accept-language")) : "" }));
    } catch (err) {
      console.error("analytics : écriture impossible", why(err));
    }
  };
}

/** The log line of an MCP message: an object, whose fields the Workers logs keep apart. */
function logLine(hit: Hit, visitor: string, country: string) {
  const line: Record<string, unknown> = {
    message: `mcp ${hit.method || hit.name}${hit.kind === "mcp" ? ` ${hit.name}` : ""} : ${hit.outcome}`,
    method: hit.method, tool: hit.kind === "mcp" ? hit.name : undefined, client: hit.client, client_version: hit.clientVersion,
    protocol: hit.protocol, outcome: hit.outcome, error: hit.message, args: hit.args, place: hit.detail, place_status: hit.place,
    commune: hit.commune, ms: hit.ms, subrequests: hit.subrequests, cache_hits: hit.cacheHits, cache_loads: hit.cacheLoads,
    size: hit.size, visitor, country,
  };
  for (const k of Object.keys(line)) if (line[k] === undefined || line[k] === "") delete line[k];
  return line;
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
  const climatDb = env.CLIMAT;
  const hourlyDb = env.CLIMAT_H;
  // The daily measurements since 1900 and the hourly ones since 2000, imported by scripts/build-climat.py and
  // scripts/build-climat-h.py, the current year and month by .github/workflows/climat.yml.
  climat.configure(
    climatDb && { all: async <T>(sql: string, ...params: unknown[]) => (await climatDb.prepare(sql).bind(...params).all<T>()).results },
    hourlyDb && { all: async <T>(sql: string, ...params: unknown[]) => (await hourlyDb.prepare(sql).bind(...params).all<T>()).results },
  );
  // Without the KV binding, the bundles stay in the data center's cache like everything else.
  return (cache ??= new Cache(new TieredStore(new MemoryStore(), new EdgeStore()), Date.now, false, env.STORE && new KvStore(env.STORE)));
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const c = setup(env);
    // A page served from its last copy refreshes it after the response (web/data.ts); an agenda too slow for the
    // answer is still stored (tools/agenda.ts).
    const { value, used, settled } = await counted(WORKER_FREE_LIMIT, () => handle(request, c, later, recorder(env, request)), (p) => ctx.waitUntil(p));
    const path = new URL(request.url).pathname;
    // Once the work after the response is done too: it counts against the same limit.
    ctx.waitUntil(settled().then((total) => {
      if (total) console.log(`sous-requêtes : ${total} (${path})${total > used ? `, dont ${total - used} après la réponse` : ""}`);
    }));
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
