import { describe, expect, it } from "vitest";
import { ligne } from "../src/web/mesure.js";

describe("the agendas' cold views, timed", () => {
  it("says each step of a view that built its page's data, for the agendas' pages only", () => {
    const m = { avant: 40, agendas: 1012, enCours: 7, places: { taken: 5, waiting: 2 }, actualites: 30, construction: 1100, finConstruction: 0, ecriture: 4650 };
    expect(ligne("web:agenda", m, 0)).toBe(
      "vue web:agenda : avant les agendas 40 ms, agendas 1012 ms (7 encore en cours, places http 5 prises et 2 en attente), actualités 30 ms, construction 1100 ms, écriture 4650 ms, rendu 0 ms",
    );
    expect(ligne("web:enfants", { construction: 900 }, 3)).toBe(
      "vue web:enfants : avant les agendas ?, agendas ? (? encore en cours, places http ? prises et ? en attente), actualités ?, construction 900 ms, écriture ?, rendu 3 ms",
    );
  });

  it("says nothing for a view served from its copy, nor for another page", () => {
    expect(ligne("web:agenda", {}, 0)).toBeUndefined();
    expect(ligne("web:meteo", { construction: 900 }, 0)).toBeUndefined();
  });
});
