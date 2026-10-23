import { describe, expect, it } from "vitest";
import { resolvePlace } from "../src/places/resolve.js";
import { stations } from "../src/providers/metar.js";
import { fit } from "../src/tools/representativeness.js";

const [gillot, pierrefonds] = stations();
const place = (q: string) => resolvePlace(q)!.lieu;

describe("fit", () => {
  it("Gillot speaks well for Sainte-Marie", () => {
    expect(fit(place("Sainte-Marie"), gillot).pertinence).toBe("bonne");
  });

  it("no airport speaks well for Cilaos", () => {
    const f = fit(place("Cilaos"), pierrefonds);
    expect(f.pertinence).toBe("faible");
    expect(f.avertissements.join(" ")).toMatch(/plus bas/);
  });

  it("warns when the station is on the other side of the island", () => {
    const f = fit(place("Saint-Benoît"), pierrefonds);
    expect(f.avertissements.join(" ")).toMatch(/versant/);
  });

  it("prefers the nearer airport", () => {
    const p = place("Saint-Louis");
    expect(fit(p, pierrefonds).score).toBeLessThan(fit(p, gillot).score);
  });
});
