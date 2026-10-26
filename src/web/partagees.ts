/**
 * The page copies that the tool resume_du_jour and the commune pages share, kept warm for every data center. The
 * copies live in the data center's cache, per version: after a deploy, or at a quiet hour, the tool found most of them
 * missing until someone opened those pages. The scheduled event, after the AROME prefetch, refreshes the ones due in
 * KV, which every data center reads; it is the only writer. A page or the tool reads KV only when its data center's
 * cache has no copy, and copies what it read there.
 */
import { costOf, count, left, measured, spent, unmeasured } from "../budget.js";
import { type Cache, CACHE_FORMAT, type CacheEntry, type CacheStore, outdated, stampOf } from "../cache.js";
import * as ensemble from "../providers/ensemble.js";
import * as ovpfPdf from "../providers/ovpf-pdf.js";
import * as seismes from "../providers/seismes.js";
import * as onf from "../providers/sentiers.js";
import * as mf from "../providers/vigilance.js";
import { why } from "../types.js";
import { buildActualites, buildAir, buildCalendrier, buildCoupures, buildCourant, buildCrues, buildElectricite, buildSea, buildTrafic, buildVolcan, type CruesAnswer, FRESH_SECONDS, type VolcanAnswer } from "./data.js";
import { floodRaised } from "./domains.js";
import { alerteVolcan } from "./volcan-alerte.js";
import { type CourantAnswer, followed } from "../tools/courant.js";
import { buildSatellites, SATELLITES, satellitesEvery } from "../tools/mer.js";
import { buildChiffres, buildEvenements, EVENEMENTS_KEY, evenementsEvery, KEY as CHIFFRES } from "../chiffres.js";

/** The part of a KV namespace binding used here. */
export interface Kv {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{ keys: { name: string; metadata?: unknown }[]; list_complete: boolean; cursor?: string }>;
}

export interface Shared {
  key: string;
  build: (cache: Cache, now: Date) => Promise<unknown>;
  /** How often its copy in KV is refreshed, in minutes: each refresh is one KV write. Given the last copy, if it depends on it. */
  every: number | ((last: unknown) => number);
  /** The subrequests its build takes from a cold cache, as measured: what an isolate that has not built it yet expects. */
  cold?: number;
  /** Its build's CPU time, ms, as measured: required by the budget's registry (src/registre.ts). */
  cpu?: number;
  /** When `every` depends on the last copy: its usual value and its shortest, in minutes (src/registre.ts). */
  range?: { usual: number; shortest: number };
  /**
   * Where its refreshes fall, in minutes after midnight UTC, modulo `every` (0 if not said): at the events where the
   * minutes since midnight UTC, less this, are a multiple of `every`. The copies of one rate go in different events.
   */
  offset?: number;
  /**
   * Copies whose build embeds this one: when both are due in the same event, this one is built first, else they would
   * carry its previous copy until their next build.
   */
  before?: string[];
}

// About 890 KV writes a day in all: 288 for the vigilance, every 5 minutes, 144 for the earthquakes, every 10 minutes, 96 for the rivers, every 15 minutes (288 while a river is in yellow flood vigilance or above), 24 for the ONF's map, 48 a day for each of the five every 30 minutes, 24 for the air and 24 for the counts
// of /chiffres (4 more for their events, 24 while an agenda does not answer), 12 for the power
// cuts the mairies relay (48 while the site of one of them does not answer), 8 for the sea, 8 for the satellites' grids (48 while ACSPO lacks a day it should have), 4 for the calendar; the volcano's, every 5 minutes during an alert, adds up to 240 more while it lasts (the banner
// of every page reads it). The events stay out: their build takes most of an invocation (they will come in a bundle).
// The cold costs: each build measured alone with `wrangler dev` from an empty cache, plus one. The traffic's: about 28
// in the event's logs at 21:20, 25 October 2026, its 8 bus stations' timetables read together (2 reads of D1 instead
// of 16 to 32: 31 at 4 o'clock before), plus one, rounded up; the tests counted 19, their cache counting none of the
// reads of the buses' feeds in real time. The volcano's: its four sources, each a
// read, a fetch and a write, plus one, and the list of the silent sites (sans-reponse.ts: a read, 2 of D1 and a write). The power cuts': one fetch per mairie and one for Saint-André's PDF letters, plus one.
// The sea's: 18 when it read the satellites, less the 5 they took (13 against 8 in the same test, 25 October 2026): the
// grids are their own copy. The grids': ACSPO's four files, a read and a write, MODIS's three more where ACSPO sees
// nothing near a beach, plus one.
// Their offsets (minutes after midnight UTC) spread them over the events: the five every 30 minutes one in each event
// of the half hour but the first, which the hourly agendas and the AROME grids take (BUDGET.md, the busiest event);
// the electricity's power cuts with the electricity, which embeds them.
export const SHARED: Shared[] = [
  // Météo-France's vigilance, every 5 minutes, in every event: the banner and the vigilance tile of every page read it,
  // and a data center's own copy, kept while Météo-France was late, could be hours old where no one had asked
  // (26 October 2026). Its cold cost: the token and the zip, plus one. Its CPU: unzipping and parsing La Réunion's two
  // files, 63 ms the first time in Node and 6 ms after, rounded up.
  { key: mf.KEY, build: () => mf.read(), every: 5, cold: 3, cpu: 70, offset: 0 },
  // The rivers, every 15 minutes, every 5 while a river is in yellow flood vigilance or above: the home page's tile
  // read a data center's own copy, which no view had brought up to date for two hours while Vigicrues Réunion answered
  // (26 October 2026). Its cold cost: Vigicrues' vigilance, heights and flows, plus one. Its CPU: parsing them, 43 ms
  // the first time in Node and 4 ms after, rounded up. At minutes 10, 25, 40 and 55, with the news, the water cuts, the
  // air and the satellites' grids: the lightest of the three series of events a rate of 15 minutes can take.
  { key: "web:crues", build: buildCrues, every: (last) => (floodRaised(last as CruesAnswer | undefined).length ? 5 : 15), cold: 4, cpu: 50, range: { usual: 15, shortest: 5 }, offset: 10 },
  { key: "web:actualites", build: buildActualites, every: 30, cold: 10, cpu: 190, offset: 10 },
  { key: "web:trafic", build: buildTrafic, every: 30, cold: 30, cpu: 160, offset: 5 },
  { key: "web:electricite", build: buildElectricite, every: 30, cold: 7, cpu: 80, offset: 20 },
  { key: "web:coupures", build: buildCoupures, every: 30, cold: 7, cpu: 60, offset: 25 },
  { key: "web:air", build: buildAir, every: 60, cold: 4, cpu: 40, offset: 40 },
  // Built only here: the copy of /mer, the pages and temperature_mer read it, never the satellites.
  { key: SATELLITES, build: buildSatellites, every: (last) => satellitesEvery(last), cold: 10, cpu: 110, range: { usual: 3 * 60, shortest: 30 }, offset: 55 },
  { key: "web:mer", build: buildSea, every: 3 * 60, cold: 13, cpu: 110, offset: 75 },
  { key: "web:calendrier", build: buildCalendrier, every: 6 * 60, cold: 8, cpu: 40, offset: 130 },
  // The earthquakes and the ONF's map, which /volcan's copy embeds: built in the data center of the event, it read that
  // data center's own copies, which no view had brought up to date (26 October 2026: 8 earthquakes in 7 days and the
  // map of 07:35 on the page at 19:21, 10 and the map of 19:25 in volcan_seismes at 19:26). The earthquakes every 10
  // minutes, their freshness, in the volcano's events; the map every hour, its freshness, before the volcano's and
  // /chiffres's. Their cold costs: the catalogue, plus one; the map's two layers and its date, plus one. Their CPU:
  // parsing them, estimated from /sentiers's.
  { key: seismes.KEY, build: (_cache, now) => seismes.read(now), every: 10, cold: 2, cpu: 10, offset: 5, before: ["web:volcan"] },
  { key: onf.KEY, build: () => onf.lire(), every: 60, cold: 4, cpu: 40, offset: 45, before: ["web:volcan", CHIFFRES] },
  // The PDF of the OVPF's newest release, read here only (providers/ovpf-pdf.ts), once the copy is built and outside its
  // cost: three more, with what is left, when there is a new one or a failed one to ask again.
  { key: "web:volcan", build: async (cache, now) => {
    const v = await buildVolcan(cache, now);
    await unmeasured(() => ovpfPdf.readNewest(cache, now.getTime()));
    return v;
  }, every: (last) => (alerteVolcan(last as VolcanAnswer | undefined) ? 5 : 30), cold: 17, cpu: 110, range: { usual: 30, shortest: 5 }, offset: 15 },
  // Every 2 hours; every 30 minutes while a mairie followed did not answer, so that its notices come back soon after
  // its site does. The page of electricity carries this copy (web/data.ts): built after it.
  { key: "web:courant", build: buildCourant, every: (last) => ((last as CourantAnswer | undefined)?.indisponibles?.some(followed) ? 30 : 2 * 60), cold: 7, cpu: 30, range: { usual: 2 * 60, shortest: 30 }, offset: 20, before: ["web:electricite"] },
  // The counts of /chiffres and sources_donnees (chiffres.ts), beside the electricity's copy, of 7: the events of the
  // half hour's first minute are their events'. Its cold cost: its copy before, the weather sources' last observations
  // (Météo-France's packets, the airports', the beacon's), the bikes' stations, the ONF's map (3), the copies of the
  // water and power cuts and of the events, the silent sites (a read, 2 of D1), the clubs' calendar, plus one; counted
  // from the code.
  { key: CHIFFRES, build: buildChiffres, every: 60, cold: 25, cpu: 60, offset: 50 },
  // Its events, the whole agenda as /evenements reads it (55 measured there): every 6 hours, in the half hour's first
  // event, which no copy every 30 minutes takes; every hour while an agenda did not answer (chiffres.ts).
  { key: EVENEMENTS_KEY, build: buildEvenements, every: evenementsEvery, cold: 56, cpu: 200, range: { usual: 6 * 60, shortest: 60 }, offset: 30, before: [CHIFFRES] },
];
/**
 * Warmed after SHARED, with what it left, so that they never go short for these: the confidence of the forecast
 * days (prevision_meteo, weather pages), read by questions and never fetched by them. Eight more writes a day.
 */
export const SHARED_AFTER: Shared[] = [
  // Its run time and the ensemble, plus one.
  { key: ensemble.KEY, build: () => ensemble.build(), every: 3 * 60, cold: 3, cpu: 40, offset: 100 },
];
const KEYS = new Set([...SHARED, ...SHARED_AFTER].map((s) => s.key));

/**
 * How often the scheduled event refreshes the copy of `key`, in minutes, given that copy; undefined for a copy it does
 * not keep (a page's own, built by its views).
 */
export function scheduledEvery(key: string, value: unknown): number | undefined {
  const s = [...SHARED, ...SHARED_AFTER].find((x) => x.key === key);
  return s && everyOf(s, value);
}
// The calendar's copy, the least often refreshed, outlives its next refresh by far.
const KV_TTL_SECONDS = 24 * 3600;
// A build whose cost is known nowhere is taken to cost this much (web/site.ts does the same).
const COST_UNKNOWN = 25;
// Besides the build: the data center's cache, then KV, asked for the copy before it is built (SharedFallback).
const LOOKUP = 2;
// Left to the agendas read after the copies (worker.ts) by a copy due only because another revision built it: on a day
// of deploys a few minutes apart, every event would otherwise spend its whole budget on them.
export const AFTER_DEPLOY_RESERVE = 12;
// The scheduled event's period (wrangler.jsonc, every 5 minutes): the first event of a slot is the one this soon after it.
const EVENT_MS = 5 * 60_000;
// Past its time by this much, a copy is tried at its cold cost, and said to be late when it is left again.
const LATE_MINUTES = 60;

/** A copy in KV, with what its build took (`cost`), for the isolates that have not built it yet. */
type KvEntry = CacheEntry & { cost?: number };

/**
 * What the scheduled event needs of a copy, written as the KV key's metadata: when it was built, what its build took,
 * how often it is refreshed given its value (`Shared.every`), and by which version of the code. One listing of the keys
 * gives it for every copy.
 */
interface KvMeta {
  fetchedAt: number;
  cost?: number;
  every?: number;
  version?: string;
}

/**
 * What a build is expected to take: the most of what it took in this isolate, what it took when its KV copy was
 * written, and its cold cost. After a deploy, every isolate is new and KV has no copy of the version: the cold cost.
 */
function expected(s: Shared, kept?: number): number {
  const known = [costOf(s.key), kept, s.cold].filter((n): n is number => n != null);
  return known.length ? Math.max(...known) : COST_UNKNOWN;
}

/** Per shape of the entries, as the data center's cache (cache.ts): a deploy that keeps it keeps the copies. */
const KV_PREFIX = `copie:format-${CACHE_FORMAT}:`;
export const kvKey = (key: string) => `${KV_PREFIX}${key}`;

/**
 * The metadata of every shared copy in KV, by KV key, in one subrequest (a page of a listing holds 1 000 keys); a key
 * written before the metadata has none. Undefined when KV does not answer: the copies are then read one by one.
 */
async function kvList(kv: Kv): Promise<Map<string, KvMeta | undefined> | undefined> {
  try {
    const found = new Map<string, KvMeta | undefined>();
    let cursor: string | undefined;
    do {
      count();
      const page = await kv.list({ prefix: KV_PREFIX, cursor });
      for (const k of page.keys) found.set(k.name, typeof (k.metadata as KvMeta)?.fetchedAt === "number" ? (k.metadata as KvMeta) : undefined);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return found;
  } catch {
    return undefined;
  }
}

async function kvGet(kv: Kv, key: string): Promise<KvEntry | undefined> {
  try {
    count(1, "read");
    return ((await kv.get(kvKey(key), "json")) ?? undefined) as KvEntry | undefined;
  } catch {
    return undefined; // a store problem must never cost an answer
  }
}

/**
 * The data center's cache, and KV behind it for the shared copies only: asked when the cache has none, only one older
 * than FRESH_SECONDS (a data center that served the page once, then slept), or one of another revision (`outdated`,
 * cache.ts), at the cost of one read instead of a build. The newer of the two is served, one of this revision before one
 * of another, and KV's is put in the cache, so that the data center's next isolates find it there. Never written to KV.
 */
export class SharedFallback implements CacheStore {
  constructor(private edge: CacheStore, private kv: Kv, private now: () => number = Date.now, private version?: string) {}
  async get(key: string, freshAfter?: number) {
    const e = await this.edge.get(key, freshAfter);
    const old = (x: CacheEntry) => outdated(key, x, this.version);
    if (!KEYS.has(key) || (e && this.now() - e.fetchedAt <= FRESH_SECONDS * 1000 && !old(e))) return e;
    const shared = await kvGet(this.kv, key);
    if (!shared || (e && (old(e) === old(shared) ? shared.fetchedAt <= e.fetchedAt : old(shared)))) return e;
    await this.edge.put(key, shared);
    return shared;
  }
  put(key: string, entry: CacheEntry) {
    return this.edge.put(key, entry);
  }
}

/** What a scheduled event did with the shared copies: those written to KV, and those due but left, with why. */
export interface Warmed {
  written: string[];
  left: { key: string; why: string }[];
}

/**
 * The scheduled event's part: each shared copy whose KV copy is due, the most overdue first, built (or taken from
 * the data center's cache when fresh there) and written to KV, while the whole invocation stays within its budget; a
 * build that would not fit, after a full AROME prefetch, waits for a later event. The event runs under the same
 * budget as a page (worker.ts), so a build that costs more than it was thought to is cut there, not past it.
 */
// What this isolate last wrote to KV, per key: a listing may not show a write of the last minute yet (KV is
// eventually consistent), and this isolate knows its own.
const wrote = new Map<string, KvMeta>();

/** « 75 min », « 16 h ». */
const ago = (ms: number) => (ms < 2 * 3600_000 ? `${Math.round(ms / 60_000)} min` : `${Math.floor(ms / 3600_000)} h`);

/** When the slot `now` falls in began (ms): a copy's refreshes fall at its offset plus multiples of its rate. */
export function slotStart(now: number, every: number, offset = 0): number {
  const period = every * 60_000;
  return now - ((((now - offset * 60_000) % period) + period) % period);
}

/** How often `s` is refreshed, given its copy's value. */
const everyOf = (s: Shared, value: unknown) => (typeof s.every === "number" ? s.every : s.every(value));

/** One listing of the copies in KV, for the event's two calls of warmShared (worker.ts): one subrequest, not two. */
export const listShared = (kv: Kv) => kvList(kv);

export async function warmShared(cache: Cache, kv: Kv, now = new Date(), list = SHARED, listing = listShared(kv)): Promise<Warmed> {
  // The ages and costs of all the copies from one listing; a copy read whole only when the listing has no metadata for
  // it (written before it was kept there), or when KV did not list. The event's second call shares the first's: what
  // this isolate wrote since, `wrote` knows.
  const listed = await listing;
  const ages = await Promise.all(list.map(async (s): Promise<{ s: Shared; at?: number; kept?: number; every: number; old: boolean }> => {
    const k = kvKey(s.key);
    const meta = wrote.get(k) ?? listed?.get(k);
    if (meta) return { s, at: meta.fetchedAt, kept: meta.cost, every: meta.every ?? everyOf(s, undefined), old: outdated(s.key, meta, cache.version) };
    if (listed && !listed.has(k)) return { s, every: everyOf(s, undefined), old: false };
    const e = await kvGet(kv, s.key);
    return { s, at: e?.fetchedAt, kept: e?.cost, every: everyOf(s, e?.value), old: outdated(s.key, e, cache.version) };
  }));
  // A copy of another revision (cache.ts, `outdated`) is due at once, by its age: after a deploy they are all due, and
  // go the oldest first, over as many events as their builds take within the budget, less what the agendas keep.
  const due = ages
    .map(({ s, at, kept, every, old }) => {
      const age = at == null ? Infinity : now.getTime() - at;
      // Due in the first event of its slot as well, once half its rate has gone by: written a few seconds into the event
      // of its last slot, a copy is a few seconds short of its rate at the next one, and went an event late each time
      // (the volcano's, every 5 minutes in an alert, went every 10). Half its rate keeps one built off its slots (after a
      // deploy, or left for the budget) from going twice in a row; it is back on them at its next refresh.
      const slot = slotStart(now.getTime(), every, s.offset);
      const onSlot = at != null && age >= every * 30_000 && at < slot && now.getTime() - slot < EVENT_MS;
      // A copy of another revision is due anyway, for its version, with the agendas' reserve.
      const byRate = onSlot && !old ? Math.max(0, age - every * 60_000) : age - every * 60_000;
      return { s, at, kept, over: old && byRate < 0 ? age : byRate, version: old && byRate < 0 };
    })
    .filter((x) => x.over >= 0)
    // Not by subtraction: the copies never written are all overdue by Infinity, and Infinity - Infinity is NaN.
    .sort((a, b) => (a.over === b.over ? 0 : a.over < b.over ? 1 : -1));
  // A copy that others embed goes before them, whatever their delays.
  for (const x of [...due]) {
    const [i, first] = [due.indexOf(x), due.findIndex((y) => x.s.before?.includes(y.s.key))];
    if (first >= 0 && first < i) due.splice(first, 0, ...due.splice(i, 1));
  }
  const out: Warmed = { written: [], left: [] };
  for (const { s, at, kept, over, version } of due) {
    // An hour past its time, a copy is expected at its cold cost: what it took at a dearer hour, kept with its last
    // copy, must not hold it back until that copy expires (web:trafic, 31 at 04:00, never under 33 since).
    // Its build stays within the budget all the same. Past its time by its rate only: a copy due for its version
    // is overdue by its age, and keeps what it is expected to take and the agendas' reserve.
    const late = !version && over >= LATE_MINUTES * 60_000;
    const leave = (why: string) => {
      out.left.push({ key: s.key, why });
      // One line to search for in the Worker's logs: a copy left an hour past its time, about twelve events in a row.
      if (late) console.error(`copie partagée en retard : ${s.key}, ${at == null ? "jamais écrite" : `écrite il y a ${ago(now.getTime() - at)}`}, reportée (${why})`);
    };
    // The copy looked up, then built, within what is left besides the writes; the writes (the data center's cache,
    // KV) go in the part kept for them.
    const cost = LOOKUP + (late && s.cold != null ? s.cold : expected(s, kept));
    if (cost > left() - (version ? AFTER_DEPLOY_RESERVE : 0)) {
      leave(`${version ? "autre version, " : ""}budget : ${spent()} faites, ${cost} prévues`);
      continue;
    }
    try {
      // Never the data center's copy that KV already has: at 5 minutes, the one of the last event would still be fresh.
      const fresh = at == null ? FRESH_SECONDS : Math.min(FRESH_SECONDS, Math.floor((now.getTime() - at) / 1000) - 1);
      const got = await cache.get(s.key, fresh, () => measured(s.key, () => s.build(cache, now)));
      // The source failed and the cache served its last copy: spread all the same when KV has none as new, so that
      // every data center serves the same last copy (26/10/2026: the IPGP's catalogue silent, /volcan said the copy of
      // 17:59 kept where the event falls, volcan_seismes the one of the day before, kept where the assistant asked).
      if (got.stale && at != null && got.fetchedAt.getTime() <= at) {
        leave("copie de secours");
        continue;
      }
      if (at != null && got.fetchedAt.getTime() <= at) {
        leave("pas plus récente que celle de KV");
        continue;
      }
      count(1, true);
      const version = stampOf(s.key, cache.version);
      const entry: KvEntry = { value: got.value, fetchedAt: got.fetchedAt.getTime(), cost: costOf(s.key) ?? kept, ...(version && { version }) };
      const meta: KvMeta = { fetchedAt: entry.fetchedAt, cost: entry.cost, every: everyOf(s, got.value), ...(version && { version }) };
      await kv.put(kvKey(s.key), JSON.stringify(entry), { expirationTtl: KV_TTL_SECONDS, metadata: meta });
      wrote.set(kvKey(s.key), meta);
      out.written.push(s.key);
    } catch (err) {
      leave(`erreur : ${why(err).slice(0, 80)}`);
    }
  }
  return out;
}
