import { describe, expect, it } from "vitest";
import { resolvePlace } from "../src/places/resolve.js";
import { stations as mfStations } from "../src/providers/meteofrance.js";
import { stations } from "../src/providers/metar.js";
import { fit, mieux } from "../src/tools/representativeness.js";

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

  it("puts the better relevance first, then the lower score: Gros Piton before Saint-Benoît for Sainte-Rose", () => {
    const p = place("Sainte-Rose");
    const mf = (nom: string) => mfStations().find((s) => s.nom === nom)!;
    const piton = fit(p, mf("Gros Piton Sainte-Rose"));
    const benoit = fit(p, mf("Saint-Benoît"));
    // By score alone Saint-Benoît came first, nearer in altitude but further and only « moyenne ».
    expect([piton.pertinence, benoit.pertinence]).toEqual(["bonne", "moyenne"]);
    expect(benoit.score).toBeLessThan(piton.score);
    expect([benoit, piton].sort(mieux)).toEqual([piton, benoit]);
    // At equal relevance, the lower score: both airports are « faible » for Sainte-Rose.
    const [g, pf] = [fit(p, gillot), fit(p, pierrefonds)];
    expect([g.pertinence, pf.pertinence]).toEqual(["faible", "faible"]);
    const [near, far] = g.score < pf.score ? [g, pf] : [pf, g];
    expect([far, near].sort(mieux)).toEqual([near, far]);
  });
});
