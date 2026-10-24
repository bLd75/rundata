import { describe, expect, it } from "vitest";
import * as mf from "../src/providers/vigilance.js";
import { quotidienLine } from "../src/tools/ecoles.js";
import { alertePage, PDF, STEPS, TITLE } from "../src/web/alerte-cyclone.js";

// Saturday 24 October 2026, 14:00 at La Réunion.
const NOW = new Date("2026-10-24T10:00:00Z");
const at = (local: string) => new Date(`${local}+04:00`).toISOString().replace(".000", "");
const bulletin = (cyclone: [number, string][]) =>
  mf.parse({ update_time: at("2026-10-24T06:00:00"), timelaps: { domain_ids: [{ domain_id: mf.ISLAND, phenomenon_items: [{ phenomenon_id: mf.CYCLONE, timelaps_items: cyclone.map(([color_id, b]) => ({ color_id, begin_time: at(b) })) }] }] } });
const page = (v: mf.Vigilance) => alertePage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW);

describe("/alerte-cyclone, the plan step by step", () => {
  it("has a section per step, in marketing's order, each line with its page of the plan", () => {
    expect(STEPS.map((s) => s.titre)).toEqual(["Pré-alerte", "Alerte orange", "Alerte rouge", "Alerte violette", "Phase de sauvegarde", "Fin de l'alerte"]);
    for (const s of STEPS) for (const l of s.lignes) expect(l.pages.length, l.texte).toBeGreaterThan(0);
    const html = page(bulletin([]));
    expect(html).toContain(`<title>${TITLE}</title>`);
    expect(html).toContain("<h1>Alerte cyclonique : ce qui ferme, ce qui continue</h1>");
    expect(html).toContain("Pas d&#39;alerte cyclonique en cours à La Réunion.");
    expect(html).toContain(`<a href="${PDF}#page=20" rel="noopener">p. 20</a>`);
    expect(html).toContain("« NE SORTEZ EN AUCUN CAS »");
    expect(html).toContain("<h3>Les bus roulent-ils pendant une alerte cyclonique ?</h3>");
    // No FAQPage markup (marketing), no colour for the pré-alerte (two official sources disagree on it).
    expect(html).not.toContain("FAQPage");
    expect(html).not.toMatch(/pr[ée]-alerte[^.]{0,30}jaune|jaune[^.]{0,30}pr[ée]-alerte/i);
  });

  it("says the step in force, linked to its section, from Météo-France's bulletin", () => {
    const html = page(bulletin([[9, "2026-10-24T06:00:00"]]));
    expect(html).toContain('Alerte rouge en vigueur à La Réunion (bulletin de Météo-France).</b> <a href="#rouge">Ce que prévoit ce niveau ↓</a>');
  });

  it("gives the tool one line in an alert, in marketing's words, and none outside one", () => {
    expect(quotidienLine(bulletin([[8, "2026-10-24T06:00:00"]]), NOW)).toBe("En alerte orange, selon le dispositif ORSEC Cyclones : écoles et crèches fermées, « l'activité économique continue » (p. 17). Détail : rundata.re/alerte-cyclone.");
    expect(quotidienLine(bulletin([]), NOW)).toBeUndefined();
  });
});
