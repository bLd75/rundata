import { describe, expect, it } from "vitest";
import { Cache, type Cached, MemoryStore } from "../src/cache.js";
import { daysApart, sinceMidnight } from "../src/geo.js";
import { communePage } from "../src/web/commune.js";
import { type AirAnswer, type CalendrierAnswer, FRESH_SECONDS, joursDuJour, snapshot } from "../src/web/data.js";
import { calendrierLive, calendrierPage, feriesDuJour } from "../src/web/domains.js";
import { pageOf } from "../src/web/places.js";
import { tileFreshMs } from "../src/web/site.js";

// La Réunion is UTC+4: 00:15 on Tuesday 27/10 is 20:15 UTC on the 26th.
const at = (local: string) => new Date(`${local}+04:00`);
const MIDNIGHT_PAST = at("2026-10-27T00:15:00");

describe("the words of the day in a copy made the day before", () => {
  it("counts the days in La Réunion, not in UTC", () => {
    expect(daysApart(at("2026-10-26T23:59:00"), at("2026-10-27T00:00:00"))).toBe(1);
    expect(daysApart(at("2026-10-27T00:00:00"), at("2026-10-27T23:59:00"))).toBe(0);
    expect(daysApart(at("2026-10-26T21:06:00"), at("2026-11-01T08:00:00"))).toBe(6);
  });

  it("starts the forecast at today's day: never « lundi » on a Tuesday", () => {
    const jours = [{ jour: "lundi 26/10" }, { jour: "mardi 27/10" }, { jour: "mercredi 28/10" }];
    // The copy of Saint-Denis read on 27/10 at 00:15: made on the 26th at 21:06.
    expect(joursDuJour(jours, at("2026-10-26T21:06:00"), MIDNIGHT_PAST).map((j) => j.jour)).toEqual(["mardi 27/10", "mercredi 28/10"]);
    expect(joursDuJour(jours, at("2026-10-26T10:00:00"), at("2026-10-26T12:00:00")).map((j) => j.jour)).toEqual(["lundi 26/10", "mardi 27/10", "mercredi 28/10"]);
    // None of today's in a copy of the day before: nothing rather than a day that is over.
    expect(joursDuJour([{ jour: "lundi 26/10" }], at("2026-10-26T21:06:00"), MIDNIGHT_PAST)).toEqual([]);
    expect(joursDuJour(undefined, MIDNIGHT_PAST, MIDNIGHT_PAST)).toEqual([]);
  });

  it("counts the days to a public holiday from today, on the island's page and its tiles", () => {
    // The shared copy read on 27/10 at 00:26: made on the 26th at 22:15, « Toussaint dans 6 j ».
    const value: CalendrierAnswer = {
      jours_feries: {
        aujourd_hui: null,
        prochains: [
          { date: "dimanche 1er novembre 2026", nom: "Toussaint", dans_jours: 6 },
          { date: "mercredi 11 novembre 2026", nom: "11 novembre", dans_jours: 16 },
        ],
        note: "",
      },
      sources: [],
    } as unknown as CalendrierAnswer;
    const copy = { value, fetchedAt: at("2026-10-26T22:15:00"), stale: false };
    expect(feriesDuJour(copy, MIDNIGHT_PAST)?.prochains.map((x) => [x.nom, x.dans_jours])).toEqual([["Toussaint", 5], ["11 novembre", 15]]);
    expect(calendrierLive(copy, MIDNIGHT_PAST)?.valeur).toBe("Toussaint dans 5 j");
    const page = calendrierPage("https://rundata.re", copy, MIDNIGHT_PAST);
    expect(page).toContain("(dans 5 jours)");
    expect(page).toContain("(dans 15 j)");
    expect(page).not.toContain("dans 6");
    // The day itself, from the same copy: today's holiday, and the next one after it.
    const toussaint = at("2026-11-01T08:00:00");
    expect(feriesDuJour(copy, toussaint)).toMatchObject({ aujourd_hui: "Toussaint", prochains: [{ nom: "11 novembre", dans_jours: 10 }] });
    expect(calendrierLive(copy, toussaint)?.valeur).toBe("Férié : Toussaint");
    // A copy of today: as it is.
    expect(feriesDuJour({ ...copy, fetchedAt: at("2026-10-26T23:00:00") }, at("2026-10-26T23:30:00"))).toBe(value.jours_feries);
  });
});

// The eve of the Toussaint: a copy made at 23:59 on Saturday 31/10 and read at 00:01 on Sunday 01/11 is two minutes
// old, within the five of FRESH_SECONDS, but what it says of « aujourd'hui » is Saturday's.
describe("a copy made before midnight, read after it", () => {
  const EVE = at("2026-10-31T23:59:00");
  const AFTER = at("2026-11-01T00:01:00");

  it("counts the seconds since midnight in La Réunion", () => {
    expect(sinceMidnight(EVE)).toBe(86_340);
    expect(sinceMidnight(AFTER)).toBe(60);
    expect(sinceMidnight(at("2026-11-01T00:00:00"))).toBe(0);
  });

  /** A page's copy built at `made`, then read at `read` by a person (no reader): what is served, and how many builds. */
  async function served(made: Date, read: Date, buildMs = 0) {
    let t = made.getTime();
    const c = new Cache(new MemoryStore(), () => t);
    let n = 0;
    const build = async () => {
      n++;
      if (buildMs) await new Promise((r) => setTimeout(r, buildMs));
      return `copie ${n}`;
    };
    await snapshot(c, "web:commune:saint-pierre", build, () => {}, made);
    t = read.getTime();
    const behind: Promise<unknown>[] = [];
    const got = await snapshot(c, "web:commune:saint-pierre", build, (p) => behind.push(p), read, 200);
    const now = n;
    await Promise.all(behind);
    return { value: got?.value, builtBefore: now, built: n };
  }

  it("builds the page's copy again at 00:01 and waits for it, where at 23:59 the same age is served as it is", async () => {
    expect(await served(EVE, AFTER)).toEqual({ value: "copie 2", builtBefore: 2, built: 2 });
    expect(await served(at("2026-10-31T23:57:00"), EVE)).toEqual({ value: "copie 1", builtBefore: 1, built: 1 });
    // Made after midnight: as young, served as it is.
    expect(await served(at("2026-11-01T00:00:30"), AFTER)).toEqual({ value: "copie 1", builtBefore: 1, built: 1 });
  });

  it("serves the copy of the eve when its build takes longer than the page waits, and builds it behind", async () => {
    expect(await served(EVE, AFTER, 400)).toEqual({ value: "copie 1", builtBefore: 2, built: 2 });
  });

  it("brings a tile of the eve up to date at 00:01, however young", () => {
    const due = (made: Date, read: Date) => read.getTime() - made.getTime() >= tileFreshMs(read);
    expect(due(EVE, AFTER)).toBe(true);
    expect(due(at("2026-10-31T23:56:00"), EVE)).toBe(false);
    expect(due(at("2026-11-01T00:00:30"), AFTER)).toBe(false);
    expect(tileFreshMs(at("2026-11-01T12:00:00"))).toBe(FRESH_SECONDS * 1000);
  });

  it("dates the air's forecast of the eve's copy, until it is built again", () => {
    const p = pageOf("saint-pierre")!;
    const value = { resume: "", nature: "", avertissements: [], sources: [], communes: [{ commune: "Saint-Pierre", niveau: 2, qualite: "moyen", polluants: ["ozone"] }] } as AirAnswer;
    const air = (fetchedAt: Date): Cached<AirAnswer> => ({ value, fetchedAt, stale: false });
    const page = (fetchedAt: Date, now: Date) => communePage("https://rundata.re", p, { place: null, commune: null, air: air(fetchedAt) }, now);
    expect(page(EVE, at("2026-10-31T23:59:30"))).toContain("indice ATMO prévu pour aujourd'hui (ozone)");
    expect(page(EVE, AFTER)).toContain("indice ATMO prévu pour le 31/10 (ozone)");
    expect(page(EVE, AFTER)).not.toContain("prévu pour aujourd'hui");
  });
});
