import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { configure } from "../src/providers/mf-auth.js";
import * as mf from "../src/providers/vigilance.js";
import { alerte, vigilanceNow, BANNER_WAIT_MS } from "../src/web/data.js";
import { communePage } from "../src/web/commune.js";
import { homePage } from "../src/web/home.js";
import { pageOf } from "../src/web/places.js";
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
// A commune's tiles have no category class: the one that leads to /vigilance.
const communeTile = (page: string) => page.match(/<li class="tile">(?:(?!<\/li>).)*?href="\/vigilance">Vigilance<\/a>.*?<\/li>/s)![0];
const banner = (page: string) => page.match(/<div class="alerte vg[^>]*>(.*?)<\/div><\/div>/s)?.[1];

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
  const home = homePage(ORIGIN, { meteo: null, vigilance: v }, NOW, a);
  const commune = communePage(ORIGIN, pageOf("saint-benoit")!, { place: null, vigilance: v }, NOW, a);
  return { v, a, tile: vigilanceTile(home), banner: banner(home), commune: communeTile(commune), logs: warn.mock.calls.map((c) => String(c[0])) };
}

/** The banner's line on a phone and its sentence on wider screens, with what follows them. */
const said = (after: string) => [
  `<span class="txt">Vigilance jaune pluies-orages <span class="nw">· Est</span>${after}</span>`,
  `<span>⚠ Vigilance Météo-France : jaune fortes pluies / orages (Est).${after}</span>`,
];

describe("the vigilance while Météo-France is late", () => {
  it("serves the last reading kept, without its time within 15 min: tile and banner", async () => {
    const { v, a, tile, banner, logs } = await late(10);
    expect(v?.stale).toBe(true);
    // One line for each page that stopped waiting (the tile's, the banner's), once Météo-France has answered.
    expect(logs).toHaveLength(2);
    for (const l of logs) expect(l).toMatch(/^source mf_vigilance trop lente : lecture gardée du 26\/10 04:00 servie, lue après \d+ ms \(attente 1500 ms\)$/);
    expect(v?.fetchedAt).toEqual(new Date(NOW.getTime() - 10 * 60_000));
    expect(a?.texte).toBe("Vigilance Météo-France : jaune fortes pluies / orages (Est).");
    expect(a?.lue).toBeUndefined();
    expect(tile).toContain(`<p class="td">fortes pluies / orages (Est)</p>`);
    for (const s of said("")) expect(banner).toContain(s);
  });

  it("says when the reading kept was read beyond 15 min, in full on a phone", async () => {
    const { a, tile, banner, commune } = await late(30);
    expect(a?.lue).toBe("lue à 03:40");
    expect(tile).toContain(`<p class="td all">fortes pluies / orages (Est) · lue à 03:40</p>`);
    expect(commune).toContain(`<p class="td all">fortes pluies / orages pour la zone Est · lue à 03:40</p>`);
    for (const s of said(" · lue à 03:40")) expect(banner).toContain(s);
  });

  it("says Météo-France has not answered since, beyond an hour, however old the reading kept", async () => {
    const { v, tile, banner, logs } = await late(120);
    expect(v?.stale).toBe(true);
    expect(logs[0]).toMatch(/^source mf_vigilance trop lente : lecture gardée du 26\/10 02:10 servie, lue après/);
    expect(tile).toContain(`<p class="td all">fortes pluies / orages (Est) · lue à 02:10, sans réponse depuis</p>`);
    for (const s of said(" · lue à 02:10, sans réponse depuis")) expect(banner).toContain(s);
    // Read another day: the day too.
    expect((await late(26 * 60)).tile).toContain(" · lue le 25/10 à 02:10, sans réponse depuis</p>");
  });

  it("says the time of the last reading kept when Météo-France fails, not only when it is late", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).includes("/token") ? Response.json({ access_token: "t", expires_in: 3600 }) : new Response("", { status: 503 }));
    const { v, tile, banner } = await late(180);
    expect(v?.stale).toBe(true);
    expect(tile).toContain(" · lue à 01:10, sans réponse depuis</p>");
    for (const s of said(" · lue à 01:10, sans réponse depuis")) expect(banner).toContain(s);
  });

  it("says it is updating when nothing was kept", async () => {
    const { v, a, tile, banner } = await late();
    expect(v).toBeNull();
    expect(a).toBeUndefined();
    expect(banner).toBeUndefined();
    expect(tile).toContain(WAIT);
  });
});
