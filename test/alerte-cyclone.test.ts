import { describe, expect, it } from "vitest";
import type { Cyclone } from "../src/providers/prefecture.js";
import * as mf from "../src/providers/vigilance.js";
import { quotidienLine } from "../src/tools/ecoles.js";
import { cyclone } from "../src/tools/vigilance.js";
import { alerteOf } from "../src/web/data.js";
import { vigilancePage } from "../src/web/pages.js";
import { pageOf } from "../src/web/places.js";
import { rssItems } from "../src/web/rss.js";
import { alertePage, FAQ, PDF, STEPS, TITLE } from "../src/web/alerte-cyclone.js";
import { cited, DSO, onPages, quotes } from "./dso.js";

// Saturday 24 October 2026, 14:00 at La Réunion.
const NOW = new Date("2026-10-24T10:00:00Z");
const at = (local: string) => new Date(`${local}+04:00`).toISOString().replace(".000", "");
const bulletin = (cyclone: [number, string][]) =>
  mf.parse({ update_time: at("2026-10-24T06:00:00"), timelaps: { domain_ids: [{ domain_id: mf.ISLAND, phenomenon_items: [{ phenomenon_id: mf.CYCLONE, timelaps_items: cyclone.map(([color_id, b]) => ({ color_id, begin_time: at(b) })) }] }] } });
const page = (v: mf.Vigilance, decision?: Cyclone) => alertePage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW, undefined, decision);
const LEVEE = "https://www.reunion.gouv.fr/Actualites/Cyclone-Test/Levee";
const lifted = (reouverture?: Cyclone["reouverture"]): Cyclone => ({ decision: { niveau: "levee", titre: "Levée de l'alerte cyclonique", lien: LEVEE, jour: "2026-10-24" }, reouverture });

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

describe("/alerte-cyclone and the tool quote the plan, page by page", () => {
  it("gives a line per step, each made of quotations of the plan found on the pages it gives", () => {
    const codes: [number, string][] = [[7, "pré-alerte"], [8, "alerte orange"], [9, "alerte rouge"], [10, "alerte violette"], [6, "phase de sauvegarde"]];
    for (const [code, step] of codes) {
      const line = quotidienLine(bulletin([[code, "2026-10-24T06:00:00"]]), NOW);
      expect(line, step).toMatch(new RegExp(`^En ${step}, selon le dispositif ORSEC Cyclones : .* Détail : rundata\\.re/alerte-cyclone\\.$`));
      const said = cited(line!);
      expect(said.length, step).toBeGreaterThan(0);
      for (const { quote, pages } of said) expect(onPages(quote, pages), `${step}, p. ${pages.join("-")} : « ${quote} »`).toBe(true);
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

describe("/alerte-cyclone when the alert is lifted", () => {
  // The phase de sauvegarde from 06:00 to 12:00, then nothing: lifted, as the bulletin says it.
  const over = mf.parse({
    update_time: at("2026-10-24T06:00:00"),
    timelaps: { domain_ids: [{ domain_id: mf.ISLAND, phenomenon_items: [{ phenomenon_id: mf.CYCLONE, timelaps_items: [{ color_id: 6, begin_time: at("2026-10-24T06:00:00"), end_time: at("2026-10-24T12:00:00") }, { color_id: -1, begin_time: at("2026-10-24T12:00:00") }] }] }] },
  });

  it("says it from the bulletin, linked to the end of the alert, without a release of the prefecture", () => {
    expect(page(over)).toContain('<b>Alerte levée (bulletin de Météo-France).</b> <a href="#fin">Ce que prévoit la fin d&#39;alerte ↓</a>');
  });

  it("takes /ecoles-cyclone's sentences when a release of the prefecture says the end, or the reopening", () => {
    expect(page(over, lifted())).toContain(`<b>Alerte levée, d&#39;après le communiqué de la préfecture du samedi 24/10 : <a href="${LEVEE}" rel="noopener">« Levée de l&#39;alerte cyclonique » →</a> La réouverture des écoles`);
    const reopen = { titre: "Réouverture des établissements scolaires lundi", lien: "https://www.reunion.gouv.fr/Actualites/Cyclone-Test/Reouverture", jour: "2026-10-24" };
    expect(page(over, lifted(reopen))).toContain(`<b>Alerte levée. Réouverture des écoles annoncée par la préfecture le samedi 24/10 : <a href="${reopen.lien}" rel="noopener">« ${reopen.titre} » →</a>`);
  });

  it("shows the phase de sauvegarde, not the end, while the bulletin gives it", () => {
    const html = page(bulletin([[6, "2026-10-24T06:00:00"]]), lifted());
    expect(html).toContain('Phase de sauvegarde en vigueur à La Réunion (bulletin de Météo-France).</b> <a href="#sauvegarde">Ce que prévoit ce niveau ↓</a>');
    expect(html).not.toContain("Alerte levée");
  });
});

describe("the pré-alerte has no colour", () => {
  // The prefecture dropped its yellow (release of 26/11/2024), Météo-France's documentation keeps it: none is said.
  const COLOUR = /pr[ée]-alerte[^.]{0,40}jaune|jaune[^.]{0,40}pr[ée]-alerte/i;
  const pre = bulletin([[7, "2026-10-24T06:00:00"]]);

  it("in the tools, the RSS feeds and on /vigilance, /alerte-cyclone", () => {
    expect(cyclone(pre, NOW)).toBe("ALERTE CYCLONIQUE pré-alerte, « je m'informe » : menace potentielle dans les jours à venir.");
    const [item] = rssItems(pageOf("cilaos")!, { vigilance: { value: pre, fetchedAt: NOW, stale: false } }, NOW);
    expect(item.title).toBe("Pré-alerte cyclonique à La Réunion");
    expect(`${item.title} ${item.description}`).not.toMatch(/jaune/i);
    const vigilance = vigilancePage("https://rundata.re", { value: pre, fetchedAt: NOW, stale: false }, NOW);
    expect(vigilance).toContain(`<span class="vg vgpre">pré-alerte</span></li>`);
    for (const html of [vigilance, page(pre)]) expect(html).not.toMatch(COLOUR);
  });

  it("nor a yellow ground: the badge and the banner are neutral, as its box in the plan's table (p. 9)", () => {
    const a = alerteOf(pre, NOW);
    expect(a).toMatchObject({ couleur: 2, neutre: true });
    const html = vigilancePage("https://rundata.re", { value: pre, fetchedAt: NOW, stale: false }, NOW, a);
    expect(html).toContain('<div class="alerte vg vgpre" role="status">');
    expect(html).not.toMatch(/class="[^"]*\bvg2\b[^"]*">(?:⚠ )?[^<]*pr[ée]-alerte/i);
    // An orange alert keeps its colour; a yellow vigilance for rain too.
    expect(alerteOf(bulletin([[8, "2026-10-24T06:00:00"]]), NOW)?.neutre).toBeUndefined();
  });
});
