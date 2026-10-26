import { describe, expect, it } from "vitest";
import { daysApart } from "../src/geo.js";
import { type CalendrierAnswer, joursDuJour } from "../src/web/data.js";
import { calendrierLive, calendrierPage, feriesDuJour } from "../src/web/domains.js";

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
