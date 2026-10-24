import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as mf from "../src/providers/vigilance.js";
import { quotidienLine } from "../src/tools/ecoles.js";
import { alertePage, FAQ, PDF, STEPS, TITLE } from "../src/web/alerte-cyclone.js";

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

// The plan's pages, copied from the PDF (tables included): every quotation must be found, word for word, on the
// page(s) given next to it. Case, accents and punctuation aside: the tables set the text out in cells and lines, and
// the headings in capitals without accents (« JE ME TIENS INFORME DES CONSIGNES »).
const DSO = new Map(
  readFileSync(new URL("./fixtures/cyclones/dso-2026-182.txt", import.meta.url), "utf8")
    .split(/^=== p\. /m)
    .slice(1)
    .map((block) => [Number(block.slice(0, block.indexOf("\n"))), block.slice(block.indexOf("\n") + 1)] as const),
);
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’]/g, "'").replace(/[,.;:]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const onPages = (quote: string, pages: number[]) => norm(pages.map((p) => DSO.get(p) ?? "").join(" ")).includes(norm(quote));
const quotes = (s: string) => [...s.matchAll(/« ([^«»]+) »/g)].map((m) => m[1]);

describe("/alerte-cyclone and the tool quote the plan, page by page", () => {
  it("gives a line per step, each made of quotations of the plan found on the pages it gives", () => {
    const codes: [number, string][] = [[7, "pré-alerte"], [8, "alerte orange"], [9, "alerte rouge"], [10, "alerte violette"], [6, "phase de sauvegarde"]];
    for (const [code, step] of codes) {
      const line = quotidienLine(bulletin([[code, "2026-10-24T06:00:00"]]), NOW);
      expect(line, step).toMatch(new RegExp(`^En ${step}, selon le dispositif ORSEC Cyclones : .* Détail : rundata\\.re/alerte-cyclone\\.$`));
      // Each « (p. N) » or « (p. N-M) » closes the quotations written since the previous one.
      const parts = [...line!.matchAll(/(.*?)\(p\. (\d+)(?:-(\d+))?\)/g)];
      expect(parts.length, step).toBeGreaterThan(0);
      for (const [, text, from, to] of parts) {
        const pages = Array.from({ length: Number(to ?? from) - Number(from) + 1 }, (_, i) => Number(from) + i);
        expect(quotes(text).length, `${step}: ${text}`).toBeGreaterThan(0);
        for (const q of quotes(text)) expect(onPages(q, pages), `${step}, p. ${pages.join("-")} : « ${q} »`).toBe(true);
      }
    }
    // No line says what the plan does not: the four deductions marketing struck out.
    const all = codes.map(([code]) => quotidienLine(bulletin([[code, "2026-10-24T06:00:00"]]), NOW)).join(" ");
    expect(all).not.toMatch(/pas de fermeture|pendant le passage|Ces activités cessent/);
  });

  it("quotes the plan on the page: every quotation of a step or of the FAQ is on its page", () => {
    const lines = [...STEPS.flatMap((s) => s.lignes), ...FAQ.flatMap((f) => f.a)].filter((l) => l.pages.length);
    for (const l of lines) {
      const said = l.cite ? [l.texte] : quotes(l.texte);
      for (const q of said) if (l.pages.every((p) => DSO.has(p))) expect(onPages(q, l.pages), `p. ${l.pages.join("-")} : « ${q} »`).toBe(true);
    }
    for (const s of STEPS) if (s.devise) expect(onPages(s.devise, [17, 18]), s.devise).toBe(true);
  });
});
