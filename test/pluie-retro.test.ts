import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILD_BUDGET, counted } from "../src/budget.js";
import { Cache, MemoryStore } from "../src/cache.js";
import * as meteofrance from "../src/providers/meteofrance.js";
import type { RainGrid } from "../src/web/pluie-radar.js";
import { auQuart, type Entree, type Historique, passage, quarters, rle, suivant, unrle } from "../src/web/pluie-retro.js";
import { site } from "../src/web/site.js";

// The real lame d'eau of 22/10/2026 05:35–05:40 UTC, as in pluie-radar.test.ts.
const h5 = readFileSync(new URL("./fixtures/radar_lame_eau.h5", import.meta.url));
const csv = readFileSync(new URL("./fixtures/meteofrance_horaire.csv", import.meta.url), "utf8");
/** The same image, its times moved 5 minutes on: 05:40–05:45, the next one. */
const later = (() => {
  const b = Buffer.from(h5);
  const move = (from: string, to: string) => { for (let i = b.indexOf(from); i >= 0; i = b.indexOf(from, i + 1)) b.write(to, i, "latin1"); };
  move("054000", "054500");
  move("053500", "054000");
  return b;
})();

/** A grid of the map's size ending at `fin`, dry but for one shower of class `c`. */
function shot(fin: string, c = 3): RainGrid {
  const pluie = ".".repeat(400) + "0".repeat(13_000) + String(c).repeat(200) + "0".repeat(400);
  const debut = new Date(Date.parse(fin) - 5 * 60_000).toISOString().replace(".000", "");
  return { debut, fin, pannes: [], w: 125, h: 112, pluie, mal_vu: "0".repeat(13_988) + "1".repeat(12) };
}
const at = (iso: string) => new Date(iso);
const kinds = (h: Historique | undefined) => h?.entrees.map((e: Entree) => ("trou" in e ? `trou ${e.de.slice(11, 16)}-${e.a.slice(11, 16)}` : e.fin.slice(11, 16)));

describe("the runs of characters of a kept grid", () => {
  it("come back the same, and a dry grid takes a few bytes", () => {
    const g = shot("2026-10-29T13:00:00Z");
    expect(rle(".....00011")).toBe(".5,03,12,");
    expect(unrle(rle(g.pluie))).toBe(g.pluie);
    expect(unrle(rle(g.mal_vu))).toBe(g.mal_vu);
    expect(rle(g.pluie).length).toBeLessThan(40);
  });
});

describe("the radar's last 6 hours, run after run", () => {
  it("adds a new image, and writes nothing for the same one read again", () => {
    const one = suivant(null, shot("2026-10-29T13:00:00Z"), at("2026-10-29T13:05:20Z"));
    expect(kinds(one)).toEqual(["13:00"]);
    expect(suivant(one!, shot("2026-10-29T13:00:00Z"), at("2026-10-29T13:10:20Z"))).toBeUndefined();
    const two = suivant(one!, shot("2026-10-29T13:05:00Z"), at("2026-10-29T13:10:20Z"));
    expect(kinds(two)).toEqual(["13:00", "13:05"]);
    expect(unrle((two!.entrees[1] as { pluie: string }).pluie)).toBe(shot("2026-10-29T13:05:00Z").pluie);
  });

  it("writes a gap for an image missed between two kept", () => {
    const one = suivant(null, shot("2026-10-29T13:00:00Z"), at("2026-10-29T13:05:20Z"))!;
    expect(kinds(suivant(one, shot("2026-10-29T13:15:00Z"), at("2026-10-29T13:20:20Z")))).toEqual(["13:00", "trou 13:00-13:10", "13:15"]);
  });

  it("writes a gap when the radar cannot be read, stretches it run after run, and closes it at the next image", () => {
    const one = suivant(null, shot("2026-10-29T13:00:00Z"), at("2026-10-29T13:05:20Z"))!;
    const down = suivant(one, new Error("HTTP 503"), at("2026-10-29T13:10:20Z"))!;
    expect(kinds(down)).toEqual(["13:00", "trou 13:00-13:10"]);
    expect(suivant(down, new Error("HTTP 503"), at("2026-10-29T13:12:00Z"))).toBeUndefined();
    const longer = suivant(down, new Error("HTTP 503"), at("2026-10-29T13:15:20Z"))!;
    expect(kinds(longer)).toEqual(["13:00", "trou 13:00-13:15"]);
    expect(kinds(suivant(longer, shot("2026-10-29T13:20:00Z"), at("2026-10-29T13:25:20Z")))).toEqual(["13:00", "trou 13:00-13:15", "13:20"]);
  });

  it("takes an image over 45 minutes old for a gap, never for the sky of now", () => {
    const one = suivant(null, shot("2026-10-29T13:00:00Z"), at("2026-10-29T13:05:20Z"))!;
    expect(kinds(suivant(one, shot("2026-10-29T13:00:00Z"), at("2026-10-29T13:50:20Z")))).toEqual(["13:00", "trou 13:00-13:50"]);
    // Nothing kept before it: nothing to say, nothing written.
    expect(suivant(null, shot("2026-10-29T13:00:00Z"), at("2026-10-29T13:50:20Z"))).toBeUndefined();
    expect(suivant(null, new Error("HTTP 503"), at("2026-10-29T13:50:20Z"))).toBeUndefined();
  });

  it("forgets what is over 6 hours old, and starts again on a grid of another size", () => {
    let h: Historique | undefined;
    for (let k = 0; k <= 80; k++) {
      const fin = new Date(Date.parse("2026-10-29T10:00:00Z") + k * 5 * 60_000).toISOString().replace(".000", "");
      h = suivant(h ?? null, shot(fin), new Date(Date.parse(fin) + 5 * 60_000)) ?? h;
    }
    // Written at 16:45: the images ending after 10:45, 71 of them.
    expect(h!.entrees).toHaveLength(71);
    expect(kinds(h)![0]).toBe("10:50");
    expect(kinds(suivant(h!, { ...shot("2026-10-29T16:45:00Z"), w: 100 }, at("2026-10-29T16:50:20Z")))).toEqual(["16:45"]);
  });
});

describe("the radar's 24 hours, an image a quarter of an hour", () => {
  const image = (fin: string): Entree => ({ fin, pannes: [], pluie: "", mal_vu: "" });
  const gap = (de: string, a: string): Entree => ({ trou: true, de: `2026-10-29T${de}:00Z`, a: `2026-10-29T${a}:00Z` });
  const t = (hm: string) => `2026-10-29T${hm}:00Z`;

  it("take the image of each quarter, or the next within 5 minutes with its own time, else the gap it falls in", () => {
    const six = [image(t("13:00")), image(t("13:05")), image(t("13:10")), image(t("13:20")), gap("13:20", "13:50"), image(t("13:55")), image(t("14:00"))];
    expect(kinds({ w: 1, h: 1, entrees: quarters(six) })).toEqual(["13:00", "13:20", "trou 13:20-13:50", "14:00"]);
  });

  it("keep what came before the 6 hours, join the two with a gap where they do not meet, and forget past 24 hours", () => {
    const before: Historique = { w: 125, h: 112, entrees: [image("2026-10-28T12:00:00Z"), image(t("02:00")), image(t("02:15"))] };
    const six: Historique = { w: 125, h: 112, entrees: [image(t("08:00")), image(t("08:15")), image(t("08:20"))] };
    const day = auQuart(before, six, at("2026-10-29T13:20:20Z"));
    expect(kinds(day)).toEqual(["02:00", "02:15", "trou 02:15-07:45", "08:00", "08:15"]);
    // Another grid: the 6 hours alone.
    expect(kinds(auQuart({ ...before, w: 100 }, six, at("2026-10-29T13:20:20Z")))).toEqual(["08:00", "08:15"]);
  });
});

describe("a run of the scheduled event", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    meteofrance.configure({});
  });

  it("costs a read of KV, a token and the image when cold; the image again then, but never a second token", async () => {
    meteofrance.configure({ applicationId: "test" });
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(String(url).includes("/token") ? "jeton" : "radar");
      return String(url).includes("/token") ? Response.json({ access_token: "t", expires_in: 3600 }) : new Response(h5);
    });
    let kept: Historique | null = null;
    const store = { get: async () => kept, put: async (h: Historique) => void (kept = h) };
    let clock = Date.parse("2026-10-22T05:42:00Z");
    const cache = new Cache(new MemoryStore(), () => clock);
    const run = () => counted(BUILD_BUDGET, () => passage(store, cache, new Date(clock)));
    // Cold isolate: KV read, token, image, KV write.
    const cold = await run();
    expect([cold.used, asked]).toEqual([4, ["jeton", "radar"]]);
    expect(cold.value).toBe("image finie à 2026-10-22T05:40:00Z, 1 entrées écrites, jetons Météo-France pris : 1");
    // 5 minutes later the data center's copy is too old: KV read and the image again, the same one, nothing written.
    clock += 5 * 60_000;
    const warm = await run();
    expect([warm.used, asked]).toEqual([2, ["jeton", "radar", "radar"]]);
    expect(warm.value).toBe("image finie à 2026-10-22T05:40:00Z, rien à écrire, jetons Météo-France pris : 0");
  });

  it("reads and writes the 24 hours only when a new quarter of an hour ends the 6 hours", async () => {
    meteofrance.configure({ applicationId: "test" });
    vi.stubGlobal("fetch", async (url: string) => (String(url).includes("/token") ? Response.json({ access_token: "t", expires_in: 3600 }) : new Response(h5)));
    // The fixture's image ends at 05:40: no quarter. Kept before it, the one of 05:30.
    let kept: Historique | null = suivant(null, { ...shot("2026-10-22T05:30:00Z"), w: 125, h: 112 }, at("2026-10-22T05:35:20Z"))!;
    let day: Historique | null = null;
    let dayOps = 0;
    const store = { get: async () => kept, put: async (h: Historique) => void (kept = h) };
    const long = { get: async () => (dayOps++, day), put: async (h: Historique) => void (dayOps++, (day = h)) };
    const now = at("2026-10-22T05:42:00Z");
    const r = await counted(BUILD_BUDGET, () => passage(store, new Cache(new MemoryStore(), () => now.getTime()), now, long));
    // 05:40 is not a quarter: the quarters still end at 05:30, nothing read nor written for the 24 hours.
    expect(kinds(kept!)).toEqual(["05:30", "trou 05:30-05:35", "05:40"]);
    expect([dayOps, day, r.value]).toEqual([0, null, expect.not.stringContaining("24 h")]);
    // Kept before it, 05:20 only: the quarter of 05:30 is now a gap, and the 24 hours are read and written once.
    kept = suivant(null, shot("2026-10-22T05:20:00Z"), at("2026-10-22T05:25:20Z"))!;
    const again = await counted(BUILD_BUDGET, () => passage(store, new Cache(new MemoryStore(), () => now.getTime()), now, long));
    expect(kinds(day!)).toEqual(["trou 05:20-05:35"]);
    expect([dayOps, again.value]).toEqual([2, expect.stringContaining("24 h : 1 entrées écrites")]);
  });

  it("writes a gap when the radar answers an error, without throwing, after reading it twice more", async () => {
    meteofrance.configure({ applicationId: "test" });
    vi.stubGlobal("fetch", async (url: string) => (String(url).includes("/token") ? Response.json({ access_token: "t", expires_in: 3600 }) : new Response("", { status: 503 })));
    let kept: Historique | null = suivant(null, shot("2026-10-29T13:00:00Z"), at("2026-10-29T13:05:20Z"))!;
    const store = { get: async () => kept, put: async (h: Historique) => void (kept = h) };
    const now = at("2026-10-29T13:10:20Z");
    const waits: number[] = [];
    const r = await counted(BUILD_BUDGET, () => passage(store, new Cache(new MemoryStore(), () => now.getTime()), now, undefined, async (ms) => void waits.push(ms)));
    expect(r.value).toMatch(/^illisible \(.*503.*\), rattrapage : 2 lectures de plus, image due toujours absente, 2 entrées écrites/);
    expect(waits).toEqual([60_000, 60_000]);
    expect(kinds(kept!)).toEqual(["13:00", "trou 13:00-13:10"]);
  });

  // 30/10/2026: 9 images missed in 24 hours, each lost once the next was out. Météo-France serves its latest only.
  describe("without the image due", () => {
    /** One run at `now` over a history ending at 05:35, the radar answering `answers` in turn (then the last again). */
    async function run(now: string, answers: (Buffer | number)[]) {
      meteofrance.configure({ applicationId: "test" });
      const asked: string[] = [];
      let i = 0;
      vi.stubGlobal("fetch", async (url: string) => {
        if (String(url).includes("/token")) return Response.json({ access_token: "t", expires_in: 3600 });
        const a = answers[Math.min(i++, answers.length - 1)];
        asked.push(typeof a === "number" ? String(a) : a === later ? "05:45" : "05:40");
        return typeof a === "number" ? new Response("", { status: a }) : new Response(a);
      });
      let kept: Historique | null = suivant(null, { ...shot("2026-10-22T05:35:00Z"), w: 125, h: 112 }, at("2026-10-22T05:40:20Z"))!;
      const store = { get: async () => kept, put: async (h: Historique) => void (kept = h) };
      const waits: number[] = [];
      const clock = Date.parse(now);
      const r = await counted(BUILD_BUDGET, () => passage(store, new Cache(new MemoryStore(), () => clock), new Date(clock), undefined, async (ms) => void waits.push(ms)));
      return { said: r.value, used: r.used, asked, waits, kinds: kinds(kept!) };
    }

    it("reads the radar again a minute later and keeps the image that was late", async () => {
      // At 05:50:20 the image due is 05:40–05:45; the radar still gives 05:35–05:40, then the one due.
      const r = await run("2026-10-22T05:50:20Z", [h5, later]);
      expect(r.asked).toEqual(["05:40", "05:45"]);
      expect(r.waits).toEqual([60_000]);
      expect(r.kinds).toEqual(["05:35", "05:40", "05:45"]);
      expect(r.said).toBe("image finie à 2026-10-22T05:45:00Z, rattrapage : 1 lecture de plus, image due lue, 3 entrées écrites, jetons Météo-France pris : 1");
      // KV read, token, image, the image again, KV write.
      expect(r.used).toBe(5);
    });

    it("catches up the image after an error, without a gap left", async () => {
      const r = await run("2026-10-22T05:45:20Z", [500, h5]);
      expect(r.asked).toEqual(["500", "05:40"]);
      expect(r.kinds).toEqual(["05:35", "05:40"]);
      expect(r.said).toMatch(/^image finie à 2026-10-22T05:40:00Z, rattrapage : 1 lecture de plus, image due lue, 2 entrées écrites/);
    });

    it("stops after two more reads, and then says the gap as before", async () => {
      const r = await run("2026-10-22T05:50:20Z", [h5]);
      expect(r.asked).toEqual(["05:40", "05:40", "05:40"]);
      expect(r.waits).toEqual([60_000, 60_000]);
      expect(r.kinds).toEqual(["05:35", "05:40"]);
      expect(r.said).toMatch(/^image finie à 2026-10-22T05:40:00Z, rattrapage : 2 lectures de plus, image due toujours absente, /);
    });

    it("says a copy the cache kept as such, never as the image read", async () => {
      meteofrance.configure({ applicationId: "test" });
      let fail = false;
      vi.stubGlobal("fetch", async (url: string) => (String(url).includes("/token") ? Response.json({ access_token: "t", expires_in: 3600 }) : fail ? new Response("", { status: 500 }) : new Response(h5)));
      let clock = Date.parse("2026-10-22T05:41:00Z");
      const cache = new Cache(new MemoryStore(), () => clock);
      let kept: Historique | null = null;
      const store = { get: async () => kept, put: async (h: Historique) => void (kept = h) };
      await counted(BUILD_BUDGET, () => passage(store, cache, new Date(clock), undefined, async () => {}));
      // 15 minutes on, the radar fails: the cache gives its copy of 05:40, and the two reads more fail too.
      [clock, fail] = [Date.parse("2026-10-22T05:56:20Z"), true];
      const r = await counted(BUILD_BUDGET, () => passage(store, cache, new Date(clock), undefined, async () => {}));
      expect(r.value).toMatch(/^copie gardée, image finie à 2026-10-22T05:40:00Z, rattrapage : 2 lectures de plus, image due toujours absente, /);
      // A copy within STALE_MS is no gap yet: the next image read writes it, from 05:40 to its start.
      expect(kinds(kept!)).toEqual(["05:40"]);
    });

    it("reads the radar once only when the image due is there", async () => {
      const r = await run("2026-10-22T05:45:20Z", [h5, later]);
      expect([r.asked, r.waits, r.kinds]).toEqual([["05:40"], [], ["05:35", "05:40"]]);
      expect(r.said).not.toContain("rattrapage");
    });
  });
});

describe("the 3 hours' replay of before", () => {
  it("is no longer served: the replay bar's files took its place (rejeu.ts)", async () => {
    const now = at("2026-10-29T13:12:00Z");
    const res = await site(new Request("https://rundata.re/meteo/retro-3h.json"), new Cache(new MemoryStore(), () => now.getTime()), () => {}, now);
    expect(res?.status).toBe(404);
  });
});
