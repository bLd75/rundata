import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { counted, SCHEDULED_BUDGET } from "../src/budget.js";
import { Cache, MemoryStore, TieredStore } from "../src/cache.js";
import type { Info } from "../src/providers/actualites.js";
import * as seismes from "../src/providers/seismes.js";
import * as onf from "../src/providers/sentiers.js";
import { activityPosts, phaseOf } from "../src/providers/volcan.js";
import { perDay, quakeSummary, volcanSeismes } from "../src/tools/volcan.js";
import { volcanLive, volcanPage } from "../src/web/domains.js";
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
    // With the source it was read from, as KV keeps it: a last copy of it says whose it is (fraicheur.ts).
    expect(got.from).toBe(seismes.SOURCE.id);
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
    const said = "La source « Séismes localisés par l'Observatoire volcanologique du Piton de la Fournaise (OVPF-IPGP) » n'a pas répondu à notre dernière lecture : ce qui vient d'elle date de notre lecture du 26/10 à 17:59.";
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

describe("the earthquakes of a copy two days old: the days after it are not read, never 0", () => {
  // 28/10/2026 at 12:00 in La Réunion; the catalogue last read on 26/10 at 19:00.
  const LATER = new Date("2026-10-28T08:00:00Z");
  const READ = new Date("2026-10-26T15:00:00Z");
  const quake = (time: string): seismes.Seisme => ({ id: time, time, lon: 55.71, lat: -21.24, profondeur_km: -1, magnitude: 0.8, type_magnitude: "Md" });
  // 20/10 at 14:00: in the 7 days before the read, not in the 7 days before now; 26/10 at 10:00: the read's day.
  const list = [quake("2026-10-26T06:00:00.000Z"), quake("2026-10-24T06:00:00.000Z"), quake("2026-10-20T10:00:00.000Z")];

  it("counts the read's day up to its time, marks the days after it « non_lu » without a count", () => {
    const days = perDay(list, LATER, READ);
    expect(days).toHaveLength(30);
    expect(days.at(-3)).toEqual({ jour: "2026-10-26", nombre: 1, jusqu_a: "19:00" });
    expect(days.slice(-2)).toEqual([{ jour: "2026-10-27", non_lu: true }, { jour: "2026-10-28", non_lu: true }]);
    expect(days.filter((d) => "en_cours" in d)).toHaveLength(0);
    // Fresh, the same list: today « en cours », every day a count.
    expect(perDay(list, LATER).at(-1)).toEqual({ jour: "2026-10-28", nombre: 0, en_cours: true });
  });

  it("counts the 7 and 30 days before the read, and says up to when", () => {
    const q = quakeSummary(list, LATER, READ);
    expect(q.sous_le_volcan["7_jours"]).toBe(3);
    expect(q.lus_jusqu_au).toBe("26/10 à 19:00");
    expect(quakeSummary(list, LATER).sous_le_volcan["7_jours"]).toBe(2);
    expect(quakeSummary(list, LATER)).not.toHaveProperty("lus_jusqu_au");
  });

  function cache() {
    const store = new MemoryStore();
    const t = LATER.getTime();
    void store.put(seismes.KEY, { value: list, fetchedAt: READ.getTime() });
    void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky.json"))), fetchedAt: t });
    void store.put("volcan:pitonlive", { value: JSON.parse(fixture("pitonlive_state.json")), fetchedAt: t });
    void store.put("volcan:prefecture:phase", { value: null, fetchedAt: t });
    const may = { titre: "Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos", lien: "https://www.reunion.gouv.fr/x", publie: "2026-05-07T08:00:00.000Z" } as Info;
    void store.put("volcan:prefecture:derniere-phase", { value: phaseOf([may]), fetchedAt: t });
    return new Cache(store, () => t);
  }

  it("says it in the answer, on /volcan, under the bars and on the tile", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = body(await volcanSeismes(cache(), LATER));
    expect(r.seismes.lus_jusqu_au).toBe("26/10 à 19:00");
    expect(r.resume).toContain("Séismes localisés par l'OVPF jusqu'à notre lecture du 26/10 à 19:00 : 3 sous le volcan en 7 jours et 3 en 30 jours (magnitude max 0,8)\u00a0; 0 ailleurs sur l'île en 30 jours. Les jours suivants ne sont pas comptés.");
    expect(r.resume).toContain("26/10 1 (jusqu'à 19:00), 27/10 non lu, 28/10 non lu.");
    expect(r.resume).not.toMatch(/2[78]\/10 0/);
    const html = volcanPage("https://rundata.re", { value: r, fetchedAt: LATER, stale: false }, LATER);
    expect(html).toContain(`<li class="nolu" aria-label="27/10 : non lu"></li><li class="nolu" aria-label="28/10 : non lu"></li></ol>`);
    expect(html).toContain(`<li aria-label="26/10 (jusqu'à 19:00) : 1">`);
    expect(html).toContain(`<span>28/10 (non lu)</span>`);
    expect(html).toContain(`<p>Le 26/10 jusqu'à 19:00 : <b>1</b>. Les jours suivants ne sont pas lus. Le plus en un jour sur ces 30 jours : <b>1</b>, le 20/10.</p>`);
    expect(html).not.toContain("Aujourd'hui (en cours)");
    expect(html).toContain(`Séismes localisés par l'OVPF sous le volcan, jusqu&#39;à notre lecture du 26/10 à 19:00 : <b>3</b> en 7 jours`);
    expect(html).toContain(`<span>Sous le volcan, jusqu&#39;à notre lecture du 26/10 à 19:00 : <b>3</b> en 30 jours, magnitude max 0,8</span>`);
    expect(html).toContain(`<p class="lead">Séismes localisés par l'OVPF sous le volcan, jusqu&#39;à notre lecture du 26/10 à 19:00 : <b>3</b> en 7 jours, <b>3</b> en 30 jours.</p>`);
    expect(volcanLive({ value: r, fetchedAt: LATER, stale: false }, LATER)!.detail).toContain("3 séismes localisés par l'OVPF sous le volcan en 7 jours, jusqu'à notre lecture du 26/10 à 19:00");
  });
});
