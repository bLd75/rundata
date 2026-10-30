import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import * as climat from "../src/providers/climat.js";
import * as meteofrance from "../src/providers/meteofrance.js";
import { REGISTRY } from "../src/registre.js";
import { type Historique, rle } from "../src/web/pluie-retro.js";
import { configure, fill, freshSeconds, heures, HEURES, holes, merge, PATHS, type Semaine, type Sources } from "../src/web/rejeu.js";
import { site } from "../src/web/site.js";

const csv = readFileSync(new URL("./fixtures/meteofrance_horaire.csv", import.meta.url), "utf8");
const hourly = meteofrance.parseHourly(csv, Date.parse("2026-10-25T08:57:00Z"));
const N = HEURES["7j"];
const at = (iso: string) => new Date(iso);
const ID = "97416463";

/** A store in memory, as KV, counting its writes. */
function sources(semaine: Semaine | null, six: Historique | null = null, day: Historique | null = null) {
  const kept = { semaine, writes: 0 };
  const s: Sources = {
    six: async () => six,
    day: async () => day,
    semaine: { get: async () => kept.semaine, put: async (w) => void ((kept.semaine = w), kept.writes++) },
  };
  return { s, kept };
}

afterEach(() => {
  configure(undefined);
  climat.configure(undefined, undefined);
  meteofrance.configure({});
});

describe("the stations' week", () => {
  it("takes the package's 24 hours at the end of 169, the newest last, in the package's units", () => {
    const w = merge(null, hourly, at("2026-10-25T08:57:00Z"))!;
    expect(w.fin).toBe("2026-10-25T08:00:00Z");
    expect(w.st[ID].t).toHaveLength(N);
    // 97416463 at 08:00Z: 25.7 °C, 32 km/h from 130°; at 07:00Z, 24.7 °C.
    expect([w.st[ID].t[N - 1], w.st[ID].ff[N - 1], w.st[ID].dd[N - 1], w.st[ID].t[N - 2]]).toEqual([25.7, 32, 130, 24.7]);
    expect(w.st[ID].t.slice(0, N - 24).every((v) => v === null)).toBe(true);
  });

  it("keeps its hours when a newer package comes, shifted to end at the newest", () => {
    const w = merge(null, hourly, at("2026-10-25T08:57:00Z"))!;
    // A package ending an hour later, with no station yet: what was last is now one before.
    const shifted = { end: "2026-10-25T09:00:00Z", rr: {}, mesures: {} };
    const next = merge(w, shifted, at("2026-10-25T09:20:00Z"))!;
    expect(next.fin).toBe("2026-10-25T09:00:00Z");
    expect([next.st[ID].t[N - 2], next.st[ID].t[N - 1]]).toEqual([25.7, null]);
    // A package older than what is kept changes nothing; nothing newer than now is taken.
    expect(merge(next, hourly, at("2026-10-25T09:20:00Z"))!.st[ID].t[N - 2]).toBe(25.7);
    expect(merge(null, hourly, at("2026-10-25T07:00:00Z"))).toBeNull();
  });

  it("fills the hours no station has from the archive, whose hours are local time and wind m/s", () => {
    const w = merge(null, hourly, at("2026-10-25T08:57:00Z"))!;
    const empty = holes(w);
    expect(empty).toHaveLength(N - 24);
    // The hour ending at 2026-10-20 08:00Z is 12 h local on the 20th: index (20 − 1) × 24 + 12.
    const k = 19 * 24 + 12;
    const T = Array(31 * 24).fill(null);
    const FF = Array(31 * 24).fill(null);
    T[k] = 26.1;
    FF[k] = 5;
    const filled = fill(w, new Map([[ID, new Map([[202610, { T, FF }]])]]), at("2026-10-25T08:57:00Z"));
    const i = N - 1 - (Date.parse(w.fin) - Date.parse("2026-10-20T08:00:00Z")) / 3_600_000;
    expect([filled.st[ID].t[i], filled.st[ID].ff[i]]).toEqual([26.1, 18]);
    expect(filled.d1).toBe("2026-10-25T08:57:00.000Z");
    expect(holes(filled)).toHaveLength(N - 25);
  });

  it("gives a file its last hours at the stations that measured any, with their place and altitude", () => {
    const w = merge(null, hourly, at("2026-10-25T08:57:00Z"))!;
    const six = heures(w, HEURES["6h"])!;
    expect(six.fin).toBe("2026-10-25T08:00:00Z");
    const s = six.st.find((x) => x.id === ID)!;
    expect(s.t).toHaveLength(7);
    expect(s.t[6]).toBe(25.7);
    expect([typeof s.x, typeof s.y, s.alt > 0]).toEqual(["number", "number", true]);
    // A week of nothing but the package: the stations without hours are left out, none is empty.
    expect(six.st.every((x) => x.t.some((v) => v != null) || x.rr.some((v) => v != null) || x.ff.some((v) => v != null))).toBe(true);
    expect(heures(null, 7)).toBeNull();
  });
});

describe("the replay bar's files", () => {
  it("are kept as long as nothing newer can be in them", () => {
    expect(freshSeconds("6h", at("2026-10-25T08:57:00Z"))).toBe(300);
    expect(freshSeconds("24h", at("2026-10-25T08:57:00Z"))).toBe(900);
    // At 08:57 the hour of 09:00 is in the package at about 09:15; at 09:20 the next is that of 10:00, at 10:15.
    expect(freshSeconds("7j", at("2026-10-25T08:57:00Z"))).toBe(18 * 60);
    expect(freshSeconds("7j", at("2026-10-25T09:20:00Z"))).toBe(55 * 60);
  });

  it("answer the radar of their length and the stations' hours, and the week without radar", async () => {
    const now = at("2026-10-25T08:57:00Z");
    const image = (fin: string) => ({ fin, pannes: [], pluie: rle("0".repeat(14_000)), mal_vu: rle("0".repeat(14_000)) });
    const six: Historique = { w: 125, h: 112, entrees: [image("2026-10-25T01:00:00Z"), image("2026-10-25T08:55:00Z")] };
    const { s } = sources(merge(null, hourly, now), six, six);
    configure(s);
    const get = async (p: string) => {
      const res = await site(new Request(`https://rundata.re${p}`), new Cache(new MemoryStore(), () => now.getTime()), () => {}, now);
      return { res: res!, body: await res!.json() };
    };
    const a = await get(PATHS["6h"]);
    expect(a.res.headers.get("cache-control")).toBe("public, max-age=300");
    // Over 6 hours old, the image of 01:00 is left out; the 24 hours keep it.
    expect(a.body.radar.entrees.map((e: { fin: string }) => e.fin)).toEqual(["2026-10-25T08:55:00Z"]);
    expect(a.body.heures.heures).toBe(7);
    expect((await get(PATHS["24h"])).body.radar.entrees).toHaveLength(2);
    const w = await get(PATHS["7j"]);
    expect(w.res.headers.get("cache-control")).toBe("public, max-age=1080");
    expect(w.body.radar).toBeUndefined();
    expect(w.body.heures.st[0].t).toHaveLength(N);
  });

  it("say they have no history when KV holds none, and read the archive for the week's holes at most once in 6 hours", async () => {
    let now = at("2026-10-25T08:57:00Z");
    const cache = () => new Cache(new MemoryStore(), () => now.getTime());
    const { s, kept } = sources(merge(null, hourly, now));
    configure(s);
    let reads = 0;
    climat.configure(undefined, { all: async () => (reads++, []) as never });
    const later: Promise<unknown>[] = [];
    const get = async (p: string) => (await (await site(new Request(`https://rundata.re${p}`), cache(), (w) => void later.push(w), now))!.json());
    await get(PATHS["7j"]);
    await Promise.all(later);
    // The archive had nothing: the week says when it was read, written once.
    expect([reads, kept.writes, kept.semaine!.d1]).toEqual([1, 1, "2026-10-25T08:57:00.000Z"]);
    now = at("2026-10-25T10:00:00Z");
    await get(PATHS["7j"]);
    expect([reads, kept.writes]).toEqual([1, 1]);
    now = at("2026-10-25T15:00:00Z");
    await get(PATHS["7j"]);
    await Promise.all(later);
    expect([reads, kept.writes]).toEqual([2, 2]);
    configure(sources(null).s);
    expect(await get(PATHS["6h"])).toEqual({ radar: null, heures: null });
  });

  it("are written by the files only: the scheduled event neither reads nor writes the week", async () => {
    const worker = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
    expect(worker).not.toContain("rejeu.passage");
    expect(worker).not.toContain("semaine des stations");
    expect(Object.keys(await import("../src/web/rejeu.js"))).not.toContain("passage");
    expect(REGISTRY.filter((e) => e.from.includes("src/web/rejeu.ts") && e.trigger === "planifiée")).toEqual([]);
  });
});
