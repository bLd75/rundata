/**
 * Cloudflare Worker entry: the same MCP endpoint as the Node server (app.ts), at the edge.
 *
 * Upstream answers are kept in isolate memory and in the Cloudflare cache of the data center, so that one
 * METAR call serves every isolate there for five minutes. The Cloudflare cache only works on a custom domain
 * (on *.workers.dev its calls do nothing). The AROME grids, filled every few minutes by the scheduled event,
 * live in KV instead: the event runs in some data center, the questions in all the others.
 */
import { configurerEquipe, failed, handle } from "./app.js";
import { BUILD_BUDGET, PAGE_BUDGET, SCHEDULED_BUDGET, count, counted, later, readsSaid, reponseSaid, scheduled, spent } from "./budget.js";
import { Cache, CACHE_FORMAT, MemoryStore, TieredStore, type CacheEntry, type CacheStore } from "./cache.js";
import { KvStore } from "./kv.js";
import { toutesLesSources, VERSION } from "./server.js";
import { audience, device, language, origin, point, TEAM, teamVisit, visitor, type Hit } from "./metrics.js";
import * as irve from "./providers/irve.js";
import * as eauIle from "./eau/ile.js";
import * as carburants from "./providers/carburants.js";
import * as prefectureCopie from "./providers/prefecture-copie.js";
import * as airMesures from "./providers/air-mesures.js";
import * as capteurs from "./providers/capteurs.js";
import * as emploi from "./providers/emploi.js";
import * as sitesHs from "./providers/sites-hs.js";
import * as marchesPublics from "./providers/marches-publics.js";
import * as ovpfOcr from "./providers/ovpf-ocr.js";
import * as meteofrance from "./providers/meteofrance.js";
import * as candhis from "./providers/candhis.js";
import * as radar from "./providers/radar.js";
import * as vigilanceCarte from "./providers/vigilance-carte.js";
import * as cmrsCarte from "./providers/cmrs-carte.js";
import * as feux from "./providers/feux.js";
import * as transit from "./providers/transit.js";
import * as climat from "./providers/climat.js";
import * as avis from "./avis.js";
import * as limite from "./limite.js";
import { refusRobot } from "./robots.js";
import * as chiffre from "./connecteurs/chiffre.js";
import * as connexions from "./connecteurs/connexions.js";
import * as lecture from "./connecteurs/lecture.js";
import * as propositions from "./propositions.js";
import * as sansReponse from "./sans-reponse.js";
import { whenFailed, whenRead } from "./http.js";
import * as formulaires from "./web/propositions.js";
import { rafraichirConnecteurs, refreshPlanned } from "./tools/agenda.js";
import { prefetchForecasts } from "./tools/prevision.js";
import { listShared, SHARED, SHARED_AFTER, SharedFallback, warmShared } from "./web/partagees.js";
import { configurerDefiOpenai } from "./web/site.js";
import * as pluieRetro from "./web/pluie-retro.js";
import * as rejeu from "./web/rejeu.js";
import { why } from "./types.js";
import { configure as metaWebhookSecrets } from "./meta-webhook.js";
import { cheminMasque } from "./chemin-secret.js";

// How long the edge keeps an entry. Much longer than any freshness window: an old copy is what gets served,
// marked as such, while a source is down.
const KEEP_SECONDS = 7 * 24 * 3600;

class EdgeStore implements CacheStore {
  // Per shape of the entries (cache.ts): a deploy keeps the data center's cache unless it changes that shape.
  private url(key: string) {
    return `https://cache.reunion-temps-reel.internal/upstream/format-${CACHE_FORMAT}/${encodeURIComponent(key)}`;
  }
  async get(key: string) {
    try {
      count(1, "read");
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
      count(1, true);
      await (await caches.open("upstream")).put(this.url(key), body);
    } catch {
      // same
    }
  }
}

/** The part of a KV namespace binding used here. */
interface KvNamespace {
  get(key: string, type: "json"): Promise<unknown>;
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  put(key: string, value: string | ArrayBuffer, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{ keys: { name: string; metadata?: unknown }[]; list_complete: boolean; cursor?: string }>;
}

/** The Worker's bindings and secrets. */
interface Env {
  METEOFRANCE_APPLICATION_ID?: string;
  METEOFRANCE_API_KEY?: string;
  /** Optional: NASA FIRMS's MAP_KEY, for the fires seen by satellite (src/providers/feux.ts). */
  FIRMS_MAP_KEY?: string;
  /** Optional: the Cerema's key to the Candhis buoys, asked by the scheduled event (src/providers/candhis.ts). */
  CANDHIS_API_KEY?: string;
  STORE?: KvNamespace;
  USAGE?: AnalyticsDataset;
  TRANSIT?: D1Database;
  CLIMAT?: D1Database;
  CLIMAT_H?: D1Database;
  AVIS?: D1Database;
  /** Optional: the salt of the feedback senders' fingerprints (src/avis.ts). */
  AVIS_SEL?: string;
  /** Optional: the secret key of the Turnstile widget of the clubs' forms (web/propositions.ts). */
  TURNSTILE_SECRET?: string;
  /** Optional, both or nothing: the verify token chosen for Meta's webhook, and the Meta app's secret (src/meta-webhook.ts). */
  META_VERIFY_TOKEN?: string;
  META_APP_SECRET?: string;
  /** Optional: the key that encrypts the secrets of the associations' platforms (src/connecteurs/chiffre.ts), 32 bytes in base64. */
  CONNECTEURS_CLE?: string;
  /** Optional: the token of OpenAI's plugin portal, served at /.well-known/openai-apps-challenge (web/site.ts). */
  OPENAI_APPS_CHALLENGE?: string;
  /** Optional: the team's secret, sent by its scripts in the header `rundata-jeton` so that their calls are not counted (src/app.ts). */
  EQUIPE_JETON?: string;
  /** Cloudflare Email Sending: the confirmation of the events the clubs propose (src/propositions.ts). */
  EMAIL?: propositions.EmailBinding;
  /** Browser Rendering: the picture of Météo-France's official map of the vigilance (src/providers/vigilance-carte.ts). */
  BROWSER?: vigilanceCarte.Browser;
  /** Rate Limiting: the calls to /mcp and the forms' sends, per address and per minute (src/limite.ts). */
  LIMITE_MCP?: limite.Limiteur;
  LIMITE_FORMULAIRES?: limite.Limiteur;
}

/** The part of a D1 binding used here. */
interface D1Statement {
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
interface D1Database {
  prepare(sql: string): { bind(...values: unknown[]): D1Statement };
  /** Several statements in one call, in one transaction. */
  batch(statements: D1Statement[]): Promise<unknown[]>;
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
  // The team's visits are written « interne », whatever their User-Agent says (metrics.ts, teamVisit).
  const team = teamVisit(headers, new URL(request.url));
  const cf = (request as { cf?: { country?: unknown; asn?: unknown } }).cf;
  // The network: a browser from Meta's is Meta checking a link (metrics.ts, META_ASN).
  const asn = typeof cf?.asn === "number" ? cf.asn : undefined;
  const who = team ? TEAM : visitor(headers.get("user-agent") ?? "", asn);
  const country = String(cf?.country ?? "");
  // The campaign's channel, a page of the site (« interne ») or the referring site (metrics.ts, origin).
  const from = origin(headers.get("referer"), new URL(request.url));
  return (hit: Hit) => {
    if (hit.kind === "mcp" || hit.kind === "rpc") console.log(logLine(hit, who, country));
    if (!usage) return;
    try {
      // A signal comes from a page's browser: read as a page view is (web/signaux.ts).
      const page = hit.kind === "page" || hit.kind === "signal";
      usage.writeDataPoint(point(hit, { who, country, from, audience: page ? (team ? TEAM : audience(headers, asn, country)) : "", language: page ? language(headers.get("accept-language")) : "", mode: page && headers.get("rundata-mode") === "app" ? "app" : "", device: page ? device(headers, asn) : "" }));
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
  feux.configure(env.FIRMS_MAP_KEY);
  const d1 = env.TRANSIT;
  const kv = env.STORE;
  // One Météo-France token for every isolate, so that one taking its own does not void the others' (providers/mf-auth.ts).
  meteofrance.share(kv && {
    get: async () => (await kv.get(meteofrance.TOKEN_KV_KEY, "json")) as meteofrance.Token | null,
    put: (t, ttl) => kv.put(meteofrance.TOKEN_KV_KEY, JSON.stringify(t), { expirationTtl: ttl }),
  });
  // Asked by the scheduled event below and kept in KV (src/providers/candhis.ts): without KV, the key is not used.
  candhis.configure(kv && env.CANDHIS_API_KEY, kv && (async () => {
    count();
    return (await kv.get(candhis.KEY, "json")) as candhis.Etat | null;
  }));
  // The replay bar's files (web/rejeu.ts): the radar's last 6 hours and its 24 hours a quarter of an hour apart, kept by
  // the scheduled event below (web/pluie-retro.ts), and the stations' week, written only by the files that read it.
  rejeu.configure(kv && {
    six: async () => (await kv.get(pluieRetro.KV_KEY, "json")) as pluieRetro.Historique | null,
    day: async () => (await kv.get(pluieRetro.LONG_KV_KEY, "json")) as pluieRetro.Historique | null,
    semaine: {
      get: async () => (await kv.get(rejeu.SEMAINE_KV_KEY, "json")) as rejeu.Semaine | null,
      put: (w) => kv.put(rejeu.SEMAINE_KV_KEY, JSON.stringify(w), { expirationTtl: rejeu.SEMAINE_KV_TTL_SECONDS }),
    },
  });
  // Filtered from the national file by the scheduled event below (src/providers/irve.ts).
  irve.configure(kv && (async () => {
    count();
    return (await kv.get("irve:etat", "json")) as irve.Live | null;
  }));
  // Gathered site by site and commune by commune by .github/workflows/eau.yml (src/eau/ile.ts).
  eauIle.configure(kv && (async () => {
    count();
    return (await kv.get("eau:ile", "json")) as eauIle.Ile | null;
  }));
  // Read every 15 minutes from the prefecture by scripts/prefecture.ts, on a machine of the project: its site cuts the
  // connection of the Workers (src/providers/prefecture-copie.ts).
  prefectureCopie.configure(
    async () => {
      if (!kv) return null;
      count();
      return (await kv.get(prefectureCopie.KV_KEY, "json")) as prefectureCopie.Copie | null;
    },
    async (lien) => {
      if (!kv) return null;
      count();
      return (await kv.get(prefectureCopie.pageKey(lien), "json")) as prefectureCopie.PageCopie | null;
    },
  );
  // Read every hour from the LCSQA's files by the scheduled event below, and kept in KV (src/providers/air-mesures.ts).
  airMesures.configure(async () => {
    if (!kv) return null;
    count();
    return (await kv.get(airMesures.KV_KEY, "json")) as airMesures.Copie | null;
  });
  // Read every 15 minutes from Sensor.Community by the scheduled event below, and kept in KV (src/providers/capteurs.ts).
  capteurs.configure(async () => {
    if (!kv) return null;
    count();
    return (await kv.get(capteurs.KV_KEY, "json")) as capteurs.Stocke | null;
  });
  // Read by the scheduled event below (one offer's page every 5 minutes, the feed every hour), and kept in KV
  // (src/providers/emploi.ts).
  emploi.configure(async () => {
    if (!kv) return null;
    count();
    return (await kv.get(emploi.KV_KEY, "json")) as emploi.Copie | null;
  });
  // Read once a day from the Arcep's file by the scheduled event below, and kept in KV (src/providers/sites-hs.ts).
  sitesHs.configure(async () => {
    if (!kv) return null;
    count();
    return (await kv.get(sitesHs.KV_KEY, "json")) as sitesHs.Copie | null;
  });
  // Read every hour from the BOAMP by the scheduled event below, and kept in KV (src/providers/marches-publics.ts).
  marchesPublics.configure(async () => {
    if (!kv) return null;
    count();
    return (await kv.get(marchesPublics.KV_KEY, "json")) as marchesPublics.Copie | null;
  });
  // Read every day from the prefecture by scripts/carburants.ts, on a machine of the project: never by the
  // Worker, even without the store.
  carburants.configure(async () => {
    if (!kv) return null;
    count();
    return (await kv.get("carburants:prix", "json")) as carburants.Prix | null;
  });
  // Météo-France's official map of the vigilance: its bulletin and its picture kept by the scheduled event.
  const cartes: vigilanceCarte.Store | undefined = kv && {
    json: (key) => kv.get(key, "json"),
    bytes: (key) => kv.get(key, "arrayBuffer"),
    put: (key, value, ttl) => kv.put(key, value, ttl ? { expirationTtl: ttl } : undefined),
  };
  vigilanceCarte.configure(cartes, env.BROWSER);
  // The RSMC's forecast track map, read by the scheduled event while a system is active.
  cmrsCarte.configure(cartes);
  // The text of the OVPF's releases given in images, read by a collector outside the Worker (scripts/ovpf-ocr.ts).
  ovpfOcr.configure(kv && (async (key: string) => {
    count();
    return (await kv.get(key, "json")) as ovpfOcr.Stocke | null;
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
  // The feedback of the tool donner_avis and of the site's form: one row each (scripts/avis.sql).
  const avisDb = env.AVIS;
  // Counted as every D1 call: an invocation's calls to the bound services are limited together (budget.ts).
  const avisRun = avisDb && (async (sql: string, ...params: unknown[]) => (count(1, true), (await avisDb.prepare(sql).bind(...params).run()).meta.changes));
  avis.configure(avisRun, env.AVIS_SEL);
  // The links and events the clubs send, in the same database (scripts/propositions.sql); a proposal's link is e-mailed
  // through Cloudflare, and without the binding a proposal is refused rather than kept unconfirmable.
  propositions.configure(
    avisRun,
    env.EMAIL && propositions.envoiCloudflare(env.EMAIL),
    avisDb && (async <T>(sql: string, ...params: unknown[]) => (count(), (await avisDb.prepare(sql).bind(...params).all<T>()).results)),
  );
  formulaires.configure(env.TURNSTILE_SECRET);
  configurerEquipe(env.EQUIPE_JETON);
  configurerDefiOpenai(env.OPENAI_APPS_CHALLENGE);
  metaWebhookSecrets(env.META_VERIFY_TOKEN, env.META_APP_SECRET);
  // The associations' links to their platform, in the same database (scripts/connecteurs.sql): the platform's secret
  // encrypted with CONNECTEURS_CLE, the link e-mailed like a proposal's. Without the key, nothing is linked.
  chiffre.configure(env.CONNECTEURS_CLE);
  connexions.configure(
    avisRun,
    avisDb && (async <T>(sql: string, ...params: unknown[]) => (count(), (await avisDb.prepare(sql).bind(...params).all<T>()).results)),
    env.EMAIL && propositions.envoiCloudflare(env.EMAIL),
  );
  // The public sites that do not answer, in the same database (scripts/sans-reponse.sql): a failed read is written
  // after the response, and only when it changes the host's state (sans-reponse.ts counts its own calls).
  sansReponse.configure(
    avisDb && (async (sql: string, ...params: unknown[]) => (await avisDb.prepare(sql).bind(...params).run()).meta.changes),
    avisDb && (async <T>(sql: string, ...params: unknown[]) => (await avisDb.prepare(sql).bind(...params).all<T>()).results),
    avisDb && (async (statements) => void (await avisDb.batch(statements.map((x) => avisDb.prepare(x.sql).bind(...x.params))))),
  );
  sansReponse.inscrire(toutesLesSources());
  whenFailed((source, url, err) => {
    const constat = sansReponse.constatDe(err);
    if (constat) later(sansReponse.noter(source, url, constat));
  });
  whenRead((url) => sansReponse.lu(url));
  // Without the KV binding, the bundles stay in the data center's cache like everything else.
  // The page copies shared by every data center are read from KV when the data center's cache has none (web/partagees.ts).
  // Each page's copy says which version built it: one of another version is built again at its first view (cache.ts).
  const edge = env.STORE ? new SharedFallback(new EdgeStore(), env.STORE, Date.now, VERSION) : new EdgeStore();
  return (cache ??= new Cache(new TieredStore(new MemoryStore(), edge), Date.now, false, env.STORE && new KvStore(env.STORE), VERSION));
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const arrived = Date.now();
    // A named robot on an address robots.txt forbids it, before anything is read or built (robots.ts).
    const robot = refusRobot(request);
    if (robot) return robot;
    // A connection past its threshold is answered before anything is read or built.
    const trop = await limite.refuse(request, { mcp: env.LIMITE_MCP, formulaire: env.LIMITE_FORMULAIRES });
    if (trop) return trop;
    const c = setup(env);
    // A page served from its last copy refreshes it after the response (web/data.ts); an agenda too slow for the
    // answer is still stored (tools/agenda.ts).
    // The path as the log lines write it, without the secret of a club's link (chemin-secret.ts).
    const path = cheminMasque(new URL(request.url).pathname);
    const { value, used, settled } = await counted(PAGE_BUDGET, () => handle(request, c, later, recorder(env, request)).catch((err) => failed(path, err)), (p) => ctx.waitUntil(p));
    // Once the work after the response is done too: it counts against the same budget.
    ctx.waitUntil(settled().then((total) => {
      const after = total.used > used ? `, dont ${total.used - used} après la réponse` : "";
      const refused = total.refused ? `, ${total.refused} refusées (budget de ${PAGE_BUDGET})` : "";
      if (total.used) console.log(`sous-requêtes : ${total.used} (${path})${after}${refused}${readsSaid(total.reads)}`);
    }));
    // The wait of the visitor, apart from the invocation's duration (which counts the work after the response).
    console.log(reponseSaid(Date.now() - arrived, path));
    return value;
  },

  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const c = setup(env);
    const kv = env.STORE;
    // The AROME grids first; then, with what is left of the invocation, the shared page copies that are due, and the
    // forecast's ensemble with what they left.
    // Its own budget, enough for every copy that is due: past it a subrequest is refused here (budget.ts).
    const reads = counted(SCHEDULED_BUDGET, async () => {
      scheduled();
      const arome = await prefetchForecasts(c).catch((err) => (console.error("préchargement AROME impossible", why(err)), null));
      const aromeUsed = spent();
      // One listing of KV for both.
      const listing = kv ? listShared(kv) : undefined;
      // The copies built alongside (the rivers', minutes long), waited for after everything else: never before it.
      const held: Promise<void>[] = [];
      const hold = (work: Promise<void>) => void held.push(work);
      const first = kv ? await warmShared(c, kv, new Date(), SHARED, listing, hold) : { written: [], left: [] };
      const after = kv ? await warmShared(c, kv, new Date(), SHARED_AFTER, listing, hold) : { written: [], left: [] };
      // Last, with what is left: the agendas read only here.
      const agendas = kv ? await refreshPlanned(c).catch((err) => (console.error("agendas planifiés impossibles", why(err)), null)) : null;
      await Promise.all(held);
      const copies = { written: [...first.written, ...after.written], left: [...first.left, ...after.left] };
      return { arome, aromeUsed, copies, agendas };
      // What a read hands over after it (a failed read written down) finishes within the event.
    }, (p) => ctx.waitUntil(p))
      .then(({ value, used, reads }) => console.log(`préchargement AROME : ${JSON.stringify(value.arome)}, sous-requêtes : ${value.aromeUsed}` +
        (value.copies.written.length ? ` ; copies partagées : ${value.copies.written.join(", ")}` : "") +
        (value.copies.left.length ? ` ; reportées : ${value.copies.left.map((x) => `${x.key} (${x.why})`).join(", ")}` : "") +
        (value.agendas?.lus.length || value.agendas?.gardes.length || value.agendas?.trop_vieilles.length ? ` ; agendas planifiés : ${JSON.stringify(value.agendas)}` : "") +
        (value.copies.written.length || value.copies.left.length || value.agendas?.lus.length ? `, sous-requêtes en tout : ${used}` : "") +
        // Each source's reads in the event: one read more often than its freshness says its copy did not carry over.
        readsSaid(reads)))
      .catch((err) => console.error("préchargement impossible", why(err)));
    ctx.waitUntil(reads);
    const now = new Date();
    // Every 15 minutes, at 5, 20, 35 and 50 past the hour: La Réunion's part of the national file of the charging points
    // (about 9 Mo), once the reads above are done, so that the file is never in memory with their copies.
    if (kv && irve.refreshDue(now)) {
      ctx.waitUntil(reads.then(() => counted(BUILD_BUDGET, () => irve.refresh(async (live) => {
        count(1, true);
        await kv.put("irve:etat", JSON.stringify(live), { expirationTtl: irve.LIVE_TTL_SECONDS });
      }, now)))
        .then(({ value, used, reads }) => console.log(`bornes de recharge : ${value} points de La Réunion, sous-requêtes : ${used}${readsSaid(reads)}`))
        .catch((err) => console.error("bornes de recharge : état impossible", why(err))));
    }
    // Every 30 minutes, at 10 and 40 past the hour: the Candhis buoys' last half hour, one request per type of buoy,
    // kept in KV (src/providers/candhis.ts), once the reads above are done. Nothing without the key.
    if (kv && candhis.configured() && candhis.refreshDue(now)) {
      ctx.waitUntil(reads.then(() => counted(BUILD_BUDGET, async () => {
        count();
        const before = (await kv.get(candhis.KEY, "json")) as candhis.Etat | null;
        return candhis.refresh(before, async (etat) => {
          count(1, true);
          await kv.put(candhis.KEY, JSON.stringify(etat), { expirationTtl: candhis.TTL_SECONDS });
        }, now);
      }))
        .then(({ value, used, reads }) => console.log(`bouées Candhis : ${value}, sous-requêtes : ${used}${readsSaid(reads)}`))
        .catch((err) => console.error("bouées Candhis : lecture impossible", why(err))));
    }
    // Every run: the radar's latest image added to its last 6 hours in KV when it is new, or a gap when it cannot be
    // read or is too old (web/pluie-retro.ts), once the reads above are done. One read of KV; one write when it changed.
    // About once a quarter of an hour, one more read and write: the 24 hours, an image a quarter of an hour.
    if (kv && radar.enabled()) {
      ctx.waitUntil(reads.then(() => counted(BUILD_BUDGET, () => pluieRetro.passage({
        get: async () => (await kv.get(pluieRetro.KV_KEY, "json")) as pluieRetro.Historique | null,
        put: (h) => kv.put(pluieRetro.KV_KEY, JSON.stringify(h), { expirationTtl: pluieRetro.KV_TTL_SECONDS }),
      }, c, now, {
        get: async () => (await kv.get(pluieRetro.LONG_KV_KEY, "json")) as pluieRetro.Historique | null,
        put: (h) => kv.put(pluieRetro.LONG_KV_KEY, JSON.stringify(h), { expirationTtl: pluieRetro.LONG_KV_TTL_SECONDS }),
      })))
        .then(({ value, used, reads }) => console.log(`historique radar : ${value}, sous-requêtes : ${used}${readsSaid(reads)}`))
        .catch((err) => console.error("historique radar : passage impossible", why(err))));
    }
    // Every hour, at 45 past: the measures at Atmo Réunion's stations, La Réunion's lines of the LCSQA's national file
    // (up to 12.5 Mo, read line by line), kept in KV when the latest hour changed, once the reads above are done.
    if (kv && airMesures.refreshDue(now)) {
      ctx.waitUntil(reads.then(() => counted(BUILD_BUDGET, async () => {
        count();
        const before = (await kv.get(airMesures.KV_KEY, "json")) as airMesures.Copie | null;
        return airMesures.collect(before, async (copie) => {
          count(1, true);
          await kv.put(airMesures.KV_KEY, JSON.stringify(copie), { expirationTtl: airMesures.KV_TTL_SECONDS });
        }, now);
      }))
        .then(({ value, used, reads }) => console.log(`mesures de l'air : ${value}, sous-requêtes : ${used}${readsSaid(reads)}`))
        .catch((err) => console.error("mesures de l'air : lecture impossible", why(err))));
    }
    // Every 15 minutes, at 10, 25, 40 and 55 past: the sensors of private people on Sensor.Community over the island,
    // one request, kept in KV for 2 hours (src/providers/capteurs.ts), once the reads above are done.
    if (kv && capteurs.refreshDue(now)) {
      ctx.waitUntil(reads.then(() => counted(BUILD_BUDGET, async () => {
        count();
        const before = (await kv.get(capteurs.KV_KEY, "json")) as capteurs.Stocke | null;
        return capteurs.collect(before, async (stocke) => {
          count(1, true);
          await kv.put(capteurs.KV_KEY, JSON.stringify(stocke), { expirationTtl: capteurs.KV_TTL_SECONDS });
        }, now);
      }))
        .then(({ value, used, reads }) => console.log(`capteurs amateurs : ${value}, sous-requêtes : ${used}${readsSaid(reads)}`))
        .catch((err) => console.error("capteurs amateurs : lecture impossible", why(err))));
    }
    // Every event: one page of an offer of the public sector at La Réunion, the newest not read yet or else each in
    // turn, for its employer and closing date, and every hour at 25 past the feed besides; kept in KV when they
    // changed, once the reads above are done.
    if (kv) {
      ctx.waitUntil(reads.then(() => counted(BUILD_BUDGET, async () => {
        count();
        const before = (await kv.get(emploi.KV_KEY, "json")) as emploi.Copie | null;
        return emploi.collect(before, async (copie) => {
          count(1, true);
          await kv.put(emploi.KV_KEY, JSON.stringify(copie), { expirationTtl: emploi.KV_TTL_SECONDS });
        }, now);
      }))
        .then(({ value, used, reads }) => console.log(`offres d'emploi : ${value}, sous-requêtes : ${used}${readsSaid(reads)}`))
        .catch((err) => console.error("offres d'emploi : lecture impossible", why(err))));
    }
    // Every hour at half past, from 14:30 to 23:30 in La Réunion, until the file of the day is read: the mobile sites out of
    // service at La Réunion, its lines of the Arcep's national file (0.5 to 2.2 Mo), kept in KV, once the reads above
    // are done.
    if (kv && sitesHs.refreshDue(now)) {
      ctx.waitUntil(reads.then(() => counted(BUILD_BUDGET, async () => {
        count();
        const before = (await kv.get(sitesHs.KV_KEY, "json")) as sitesHs.Copie | null;
        return sitesHs.collect(before, async (copie) => {
          count(1, true);
          await kv.put(sitesHs.KV_KEY, JSON.stringify(copie), { expirationTtl: sitesHs.KV_TTL_SECONDS });
        }, now);
      }))
        .then(({ value, used, reads }) => console.log(`sites mobiles hors service : ${value}, sous-requêtes : ${used}${readsSaid(reads)}`))
        .catch((err) => console.error("sites mobiles hors service : lecture impossible", why(err))));
    }
    // Every hour, at 35 past: the public procurement notices open at La Réunion (BOAMP), the full text of the new ones
    // only, kept in KV when they changed, once the reads above are done.
    if (kv && marchesPublics.refreshDue(now)) {
      ctx.waitUntil(reads.then(() => counted(BUILD_BUDGET, async () => {
        count();
        const before = (await kv.get(marchesPublics.KV_KEY, "json")) as marchesPublics.Copie | null;
        return marchesPublics.collect(before, async (copie) => {
          count(1, true);
          await kv.put(marchesPublics.KV_KEY, JSON.stringify(copie), { expirationTtl: marchesPublics.KV_TTL_SECONDS });
        }, now);
      }))
        .then(({ value, used, reads }) => console.log(`marchés publics : ${value}, sous-requêtes : ${used}${readsSaid(reads)}`))
        .catch((err) => console.error("marchés publics : lecture impossible", why(err))));
    }
    // Every 30 minutes while GDACS has an active system: the RSMC's list of bulletins at 15 and 45 past the hour, its
    // track map at 20 and 50, one request each, kept in KV (src/providers/cmrs-carte.ts), once the reads above are done.
    if (kv && cmrsCarte.due(now)) {
      ctx.waitUntil(reads.then(() => counted(BUILD_BUDGET, () => cmrsCarte.passage(c, now)))
        .then(({ value, used, reads }) => console.log(`carte du CMRS : ${value}, sous-requêtes : ${used}${readsSaid(reads)}`))
        .catch((err) => console.error("carte du CMRS : lecture impossible", why(err))));
    }
    // Once a day, at 06:00 in La Réunion: each public site that did not answer asked again (sans-reponse.ts), once the
    // reads above are done, so that its one GET is never part of a run of ours.
    if (sansReponse.heureDuPassage(now)) {
      ctx.waitUntil(reads.then(() => counted(BUILD_BUDGET, () => sansReponse.reverifier(now)))
        .then(({ value, used, reads }) => value && console.log(`sites sans réponse : ${value.essayes} revérifiés${value.changes.length ? `, ${value.changes.join(", ")}` : ""}, sous-requêtes : ${used}${readsSaid(reads)}`))
        .catch((err) => console.error("sites sans réponse : revérification impossible", why(err))));
    }
    // Once a day, at 00:20 in La Réunion (and 00:35 when the day's last hour was not out yet): the day before at each
    // Météo-France station, from the hourly package, kept in KV for historique_meteo until the daily file is loaded at
    // noon, once the reads above are done.
    if (kv && meteofrance.enabled() && meteofrance.veilleDue(now)) {
      ctx.waitUntil(reads.then(() => counted(BUILD_BUDGET, () => meteofrance.keepVeille(c, now)))
        .then(({ value, used, reads }) => value && console.log(`veille : ${value.jour}, ${Object.keys(value.stations).length} stations${value.complet ? "" : " (dernière heure absente)"}, sous-requêtes : ${used}${readsSaid(reads)}`))
        .catch((err) => console.error("veille : cumul impossible", why(err))));
    }
    // Once a day, at 04:00 in La Réunion (the run between 00:00 and 00:05 UTC): what the clubs sent is forgotten on
    // time even on the days nothing new is proposed (scripts/propositions.sql), and their links to a platform the same
    // (scripts/connecteurs.sql).
    if (now.getUTCHours() === 0 && now.getUTCMinutes() < 5) {
      ctx.waitUntil(propositions.purger(now)
        .then((n) => console.log(`propositions : purge quotidienne, ${n} lignes`))
        .catch((err) => console.error("propositions : purge impossible", why(err))));
      ctx.waitUntil(connexions.purger(now)
        .then((n) => console.log(`connecteurs : purge quotidienne, ${n} lignes`))
        .catch((err) => console.error("connecteurs : purge impossible", why(err))));
    }
    // At each run, once the reads above are done: the one association's platform due, if any (every 6 hours each).
    ctx.waitUntil(reads.then(() => counted(BUILD_BUDGET, () => lecture.lireUne(now, () => rafraichirConnecteurs(c, now))))
      .then(({ value, used }) => value && console.log(`connecteurs : ${JSON.stringify(value)}, sous-requêtes : ${used}`))
      .catch((err) => console.error("connecteurs : lecture impossible", why(err))));
  },
};
