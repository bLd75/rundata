import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { counted, SCHEDULED_BUDGET } from "../src/budget.js";
import { Cache, type CacheEntry, MemoryStore, TieredStore } from "../src/cache.js";
import { configure } from "../src/providers/mf-auth.js";
import * as mf from "../src/providers/vigilance.js";
import { alerte, vigilanceNow, BANNER_WAIT_MS } from "../src/web/data.js";
import { homePage } from "../src/web/home.js";
import { type Kv, kvKey, SHARED, SharedFallback, warmShared } from "../src/web/partagees.js";
import { unzip } from "../src/zip.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const NOW = new Date("2026-10-26T04:48:20Z");
const ORIGIN = "https://rundata.re";

async function yellow(): Promise<mf.Vigilance> {
  const zip = fixture("vigilance_om.zip");
  const files = await unzip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, (n) => n.endsWith("_FMEE_.txt"));
  const v = mf.parse(JSON.parse(files.get("CDPV95_FMEE_.txt")!), JSON.parse(files.get("CDPV96_FMEE_.txt")!));
  v.zones[mf.ISLAND][mf.CYCLONE] = [];
  v.zones["VIGI974-12"][12] = [{ couleur: 2, debut: "2026-10-25T00:00:00Z" }];
  return v;
}

/** A KV namespace in memory. */
class FakeKv implements Kv {
  data = new Map<string, string>();
  async get(key: string) {
    const v = this.data.get(key);
    return v ? JSON.parse(v) : null;
  }
  async put(key: string, value: string) {
    this.data.set(key, value);
  }
  async list({ prefix }: { prefix: string }) {
    return { keys: [...this.data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
  }
}

/** A data center's cache as the Worker builds it (worker.ts): memory, then the data center's cache with KV behind. */
const center = (edge: MemoryStore, kv: Kv, at: Date) =>
  new Cache(new TieredStore(new MemoryStore(), new SharedFallback(edge, kv, () => at.getTime())), () => at.getTime(), false);

const vigilanceTile = (page: string) => page.match(/<li class="tile k-vigilance[^"]*">(.*?)<\/li>/s)![1];
const banner = (page: string) => page.match(/<div class="alerte vg[^>]*>(.*?)<\/div><\/div>/s)?.[1];

// Météo-France's zip: how many times it was asked for, and how long it takes to answer.
let zips = 0;
let delayMs = 0;

beforeEach(() => {
  zips = 0;
  delayMs = 0;
  configure({ applicationId: "test" });
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).includes("/token")) return Response.json({ access_token: "t", expires_in: 3600 });
    zips++;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return new Response(fixture("vigilance_om.zip"));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  configure({});
});

/** The home page of a data center whose cache holds `edge`, with Météo-France answering after `delayMs`. */
async function view(edge: MemoryStore, kv: Kv) {
  const cache = center(edge, kv, NOW);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const pending: Promise<unknown>[] = [];
  const background = (p: Promise<unknown>) => void pending.push(p);
  const [v, a] = await Promise.all([vigilanceNow(cache, background, BANNER_WAIT_MS, NOW), alerte(cache, background, NOW)]);
  const asked = zips;
  await Promise.all(pending);
  const home = homePage(ORIGIN, { meteo: null, vigilance: v }, NOW, a);
  return { v, a, asked, tile: vigilanceTile(home), banner: banner(home) };
}

/** A data center that last read the vigilance `ageMin` minutes ago, and has kept that reading since. */
async function readThere(ageMin: number): Promise<MemoryStore> {
  const edge = new MemoryStore();
  await edge.put(mf.KEY, { value: await yellow(), fetchedAt: NOW.getTime() - ageMin * 60_000 });
  return edge;
}

/** KV holding the scheduled event's copy, read `ageMin` minutes ago. */
async function keptInKv(ageMin: number): Promise<FakeKv> {
  const kv = new FakeKv();
  const entry: CacheEntry = { value: await yellow(), fetchedAt: NOW.getTime() - ageMin * 60_000 };
  await kv.put(kvKey(mf.KEY), JSON.stringify(entry));
  return kv;
}

describe("the vigilance kept by the scheduled event", () => {
  it("is one copy for every data center: none says Météo-France has not answered while it does", async () => {
    // The scheduled event, in one data center, 2 minutes ago.
    const entry = SHARED.find((s) => s.key === mf.KEY);
    expect(entry?.every).toBe(5);
    const kv = new FakeKv();
    const at = new Date(NOW.getTime() - 2 * 60_000);
    const warmed = await counted(SCHEDULED_BUDGET, () => warmShared(center(new MemoryStore(), kv, at), kv, at, [entry!]));
    expect(warmed.value.written).toEqual([mf.KEY]);
    // A page in another data center, which last read the vigilance 13 hours ago, while Météo-France is late.
    delayMs = BANNER_WAIT_MS + 300;
    zips = 0;
    const { v, a, asked, tile, banner } = await view(await readThere(13 * 60), kv);
    expect(asked).toBe(0);
    expect(v?.stale).toBe(false);
    expect(v?.fetchedAt).toEqual(at);
    expect(a?.lue).toBeUndefined();
    // Météo-France's own answer (green), not the yellow kept 13 hours ago in that data center.
    expect(tile).toContain(`<p class="td all">Pas d'alerte cyclonique ni de vigilance particulière. <a href="https://vigilance.meteofrance.fr/fr/la-reunion" rel="noopener">Consulter le site officiel de Météo-France</a></p>`);
    expect(banner).toBeUndefined();
    expect(tile).not.toContain("lue");
  });

  it("is read from Météo-France as before when KV has no copy", async () => {
    const { v, asked, tile } = await view(new MemoryStore(), new FakeKv());
    expect(asked).toBeGreaterThan(0);
    expect(v?.stale).toBe(false);
    expect(v?.fetchedAt).toEqual(NOW);
    expect(tile).toContain(`<p class="td all">Pas d'alerte cyclonique ni de vigilance particulière. <a href="https://vigilance.meteofrance.fr/fr/la-reunion" rel="noopener">Consulter le site officiel de Météo-France</a></p>`);
  });

  it("is read from Météo-France as before when the scheduled event no longer keeps it", async () => {
    const { v, asked, tile } = await view(new MemoryStore(), await keptInKv(2 * 60));
    expect(asked).toBeGreaterThan(0);
    expect(v?.fetchedAt).toEqual(NOW);
    expect(tile).not.toContain("lue");
  });

  it("says when it was read, while Météo-France is late and the scheduled event no longer keeps it", async () => {
    delayMs = BANNER_WAIT_MS + 300;
    const { v, asked, tile } = await view(new MemoryStore(), await keptInKv(2 * 60));
    expect(asked).toBeGreaterThan(0);
    expect(v?.stale).toBe(true);
    expect(tile).toContain(`<p class="td all">fortes pluies / orages (Est) · lue à 06:48, sans réponse depuis. <a href="https://vigilance.meteofrance.fr/fr/la-reunion" rel="noopener">Consulter le site officiel de Météo-France</a></p>`);
  });
});
