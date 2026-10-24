import { describe, expect, it } from "vitest";
import { constantsOf, height, nextTurns } from "../src/maree/calcul.js";

// Values of scripts/build-maree.py (predict and turns) with the same constants: the server computes what the script checked.
const at = (iso: string) => Date.parse(iso) / 1000;
const hm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);

describe("the computed tide", () => {
  it("sums the constants as the script does, years after the fit", () => {
    const cases: [string, string, number][] = [
      ["110", "2026-10-24T12:00:00Z", 0.466913],
      ["110", "2027-03-01T00:00:00Z", 0.68708],
      ["110", "2030-06-15T06:30:00Z", 0.518859],
      ["832", "2026-10-24T12:00:00Z", 0.458998],
      ["832", "2027-03-01T00:00:00Z", 0.707236],
      ["832", "2030-06-15T06:30:00Z", 0.541324],
    ];
    for (const [g, iso, h] of cases) expect(height(constantsOf(g)!, at(iso))).toBeCloseTo(h, 5);
  });

  it("finds the same high and low waters as the script", () => {
    const day = at("2026-10-25T00:00:00Z");
    const port = nextTurns(constantsOf("110")!, day, 24);
    expect(port.map((e) => [e.type, hm(e.t), Math.round(e.h * 1000) / 1000])).toEqual([
      ["basse_mer", "02:30", 0.298],
      ["pleine_mer", "08:34", 0.887],
      ["basse_mer", "14:52", 0.241],
      ["pleine_mer", "21:07", 0.848],
    ]);
    const marie = nextTurns(constantsOf("832")!, day, 24);
    expect(marie.map((e) => hm(e.t))).toEqual(["02:24", "08:25", "14:42", "20:53"]);
  });

  it("keeps the check of the script with the constants", () => {
    for (const g of ["110", "832"]) {
      const c = constantsOf(g)!;
      expect(c.controle!.ecart_hauteur_cm.mediane).toBeLessThan(10);
      expect(c.constantes.length).toBeGreaterThan(20);
    }
  });
});
