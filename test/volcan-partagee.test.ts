import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { counted, SCHEDULED_BUDGET } from "../src/budget.js";
import { Cache, MemoryStore, TieredStore } from "../src/cache.js";
import type { Info } from "../src/providers/actualites.js";
import * as seismes from "../src/providers/seismes.js";
import * as onf from "../src/providers/sentiers.js";
import { activityPosts, phaseOf } from "../src/providers/volcan.js";
import { volcanSeismes } from "../src/tools/volcan.js";
import { volcanPage } from "../src/web/domains.js";
import { esc } from "../src/web/map.js";
import { type Kv, SHARED, SharedFallback, warmShared } from "../src/web/partagees.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
// 26/10/2026 at 19:26, heure de La Réunion.
const NOW = new Date("2026-10-26T15:26:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const entry = (key: string) => SHARED.find((s) => s.key === key)!;

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the earthquakes and the ONF's map, kept by the scheduled event", () => {
  it("are built before /volcan's copy, which embeds them", () => {
    expect(entry(seismes.KEY).before).toContain("web:volcan");
    expect(entry(onf.KEY).before).toContain("web:volcan");
  });

  it("are one copy for every data center: /volcan's copy, built where the event falls, reads the newest", async () => {
    // The event, in one data center, 5 minutes ago: the catalogue and the map read.
    const map: onf.Carte = { sentiers: [], routes: [], mise_a_jour: "2026-10-26T15:00:00.000Z" };
    vi.stubGlobal("fetch", async () => new Response(fixture("ipgp_seismes.txt")));
    const kv = new FakeKv();
    const at = new Date(NOW.getTime() - 5 * 60_000);
    const quakes = { ...entry(seismes.KEY), build: (_c: Cache, now: Date) => seismes.read(now) };
    const maps = { ...entry(onf.KEY), build: async () => map };
    const warmed = await counted(SCHEDULED_BUDGET, () => warmShared(center(new MemoryStore(), kv, at), kv, at, [quakes, maps]));
    expect(warmed.value.written).toEqual([seismes.KEY, onf.KEY]);

    // Another data center, whose own copies are a day old (no view there since): it reads KV's, not its own, and asks
    // neither the IPGP nor the ONF.
    let asked = 0;
    vi.stubGlobal("fetch", async () => (asked++, new Response("", { status: 503 })));
    const edge = new MemoryStore();
    const dayAgo = NOW.getTime() - 86_400_000;
    await edge.put(seismes.KEY, { value: [], fetchedAt: dayAgo });
    await edge.put(onf.KEY, { value: { sentiers: [], routes: [] }, fetchedAt: dayAgo });
    const there = center(edge, kv, NOW);
    const got = await seismes.seismes(there, NOW);
    expect(got.fetchedAt.getTime()).toBe(at.getTime());
    expect(got.value).toHaveLength(18);
    expect((await there.peek<onf.Carte>(onf.KEY))?.value.mise_a_jour).toBe(map.mise_a_jour);
    expect(asked).toBe(0);
  });

  it("are the same last copy everywhere when the IPGP does not answer: the event's, not another data center's of the day before", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const kv = new FakeKv();
    // A day after the test above: what this isolate wrote to KV then is older (partagees.ts, `wrote`).
    const now = new Date(NOW.getTime() + 86_400_000);
    const read = now.getTime() - 2 * 3600_000;
    // Where the event falls: the copy read 2 hours ago, the catalogue silent since.
    const here = new MemoryStore();
    await here.put(seismes.KEY, { value: seismes.parse(fixture("ipgp_seismes.txt")), fetchedAt: read });
    const quakes = { ...entry(seismes.KEY), build: (_c: Cache, at: Date) => seismes.read(at) };
    const warmed = await counted(SCHEDULED_BUDGET, () => warmShared(center(here, kv, now), kv, now, [quakes]));
    expect(warmed.value).toEqual({ written: [seismes.KEY], left: [] });
    // Where the assistant asks: a copy of the day before, KV's served instead.
    const there = new MemoryStore();
    await there.put(seismes.KEY, { value: [], fetchedAt: now.getTime() - 86_400_000 });
    const got = await seismes.seismes(center(there, kv, now), now);
    expect(got.fetchedAt.getTime()).toBe(read);
    expect(got.value).toHaveLength(18);
  });
});

describe("/volcan when the IPGP's catalogue does not answer", () => {
  /** Every source fresh but the earthquakes, last read at 17:59; nothing answers. */
  function cache() {
    const store = new MemoryStore();
    const t = NOW.getTime();
    void store.put(seismes.KEY, { value: seismes.parse(fixture("ipgp_seismes.txt")), fetchedAt: Date.parse("2026-10-26T13:59:00Z") });
    void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky.json"))), fetchedAt: t });
    void store.put("volcan:pitonlive", { value: JSON.parse(fixture("pitonlive_state.json")), fetchedAt: t });
    void store.put("volcan:prefecture:phase", { value: null, fetchedAt: t });
    const may = { titre: "Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos", lien: "https://www.reunion.gouv.fr/x", publie: "2026-05-07T08:00:00.000Z" } as Info;
    void store.put("volcan:prefecture:derniere-phase", { value: phaseOf([may]), fetchedAt: t });
    return new Cache(store, () => t);
  }

  it("says from which read the earthquakes come, in the answer and on the page, with the words of the answer's warning", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const said = "La source « Séismes localisés par l'Observatoire volcanologique du Piton de la Fournaise » n'a pas répondu à notre dernière lecture : ce qui vient d'elle date de notre lecture du 26/10 à 17:59.";
    const r = body(await volcanSeismes(cache(), NOW));
    expect(r.seismes.copie).toBe(said);
    const html = volcanPage("https://rundata.re", { value: r, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain(`<p class="note">${esc(said)} `);
  });

  it("says nothing more when it answers", async () => {
    vi.stubGlobal("fetch", async (url: string) => new Response(new URL(url).hostname === "ws.ipgp.fr" ? fixture("ipgp_seismes.txt") : "", { status: new URL(url).hostname === "ws.ipgp.fr" ? 200 : 503 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = body(await volcanSeismes(cache(), NOW));
    expect(r.seismes.copie).toBeUndefined();
  });
});
