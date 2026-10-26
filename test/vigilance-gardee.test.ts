import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { configure } from "../src/providers/mf-auth.js";
import * as mf from "../src/providers/vigilance.js";
import { alerte, vigilanceNow, BANNER_WAIT_MS } from "../src/web/data.js";
import { homePage } from "../src/web/home.js";
import { unzip } from "../src/zip.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const NOW = new Date("2026-10-26T00:10:00Z");
const ORIGIN = "https://rundata.re";
const WAIT = `<p class="td all">Se met à jour : rechargez la page dans quelques secondes.</p>`;

async function yellow(): Promise<mf.Vigilance> {
  const zip = fixture("vigilance_om.zip");
  const files = await unzip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, (n) => n.endsWith("_FMEE_.txt"));
  const v = mf.parse(JSON.parse(files.get("CDPV95_FMEE_.txt")!), JSON.parse(files.get("CDPV96_FMEE_.txt")!));
  v.zones[mf.ISLAND][mf.CYCLONE] = [];
  v.zones["VIGI974-12"][12] = [{ couleur: 2, debut: "2026-10-25T00:00:00Z" }];
  return v;
}

const vigilanceTile = (page: string) => page.match(/<li class="tile k-vigilance[^"]*">(.*?)<\/li>/s)![1];

beforeEach(() => {
  configure({ applicationId: "test" });
  // Météo-France answers, but later than a page waits for it.
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).includes("/token")) return Response.json({ access_token: "t", expires_in: 3600 });
    await new Promise((resolve) => setTimeout(resolve, BANNER_WAIT_MS + 300));
    return new Response(fixture("vigilance_om.zip"));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  configure({});
});

/** The vigilance as a page gets it while Météo-France is late, with the last reading kept `ageMin` minutes ago. */
async function late(ageMin?: number) {
  const store = new MemoryStore();
  if (ageMin != null) await store.put(mf.KEY, { value: await yellow(), fetchedAt: NOW.getTime() - ageMin * 60_000 });
  const cache = new Cache(store, () => NOW.getTime(), false);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const pending: Promise<unknown>[] = [];
  const background = (p: Promise<unknown>) => void pending.push(p);
  const [v, a] = await Promise.all([vigilanceNow(cache, background, BANNER_WAIT_MS, NOW), alerte(cache, background, NOW)]);
  await Promise.all(pending);
  return { v, a, tile: vigilanceTile(homePage(ORIGIN, { meteo: null, vigilance: v }, NOW, a)), logs: warn.mock.calls.map((c) => String(c[0])) };
}

describe("the vigilance while Météo-France is late", () => {
  it("serves the last reading kept within the hour: tile and banner", async () => {
    const { v, a, tile, logs } = await late(10);
    expect(v?.stale).toBe(true);
    // One line for each page that stopped waiting (the tile's, the banner's), once Météo-France has answered.
    expect(logs).toHaveLength(2);
    for (const l of logs) expect(l).toMatch(/^source mf_vigilance trop lente : lecture gardée du 26\/10 04:00 servie, lue après \d+ ms \(attente 1500 ms\)$/);
    expect(v?.fetchedAt).toEqual(new Date(NOW.getTime() - 10 * 60_000));
    expect(a?.texte).toBe("Vigilance Météo-France : jaune fortes pluies / orages (Est).");
    expect(tile).toContain("jaune");
    expect(tile).not.toContain("Se met à jour");
  });

  it("does not serve a reading kept more than an hour ago, which does not say its time", async () => {
    const { v, a, tile, logs } = await late(120);
    expect(v).toBeNull();
    expect(logs[0]).toMatch(/^source mf_vigilance trop lente : aucune lecture gardée servie, lue après/);
    expect(a).toBeUndefined();
    expect(tile).toContain(WAIT);
  });

  it("says it is updating when nothing was kept", async () => {
    const { v, a, tile } = await late();
    expect(v).toBeNull();
    expect(a).toBeUndefined();
    expect(tile).toContain(WAIT);
  });
});
