import { describe, expect, it } from "vitest";
import * as mf from "../src/providers/vigilance.js";
import { alertePage, STEPS } from "../src/web/alerte-cyclone.js";
import type { CyclonesAnswer } from "../src/web/data.js";
import { cyclonesPage } from "../src/web/domains.js";
import { kitPage, SECTIONS, TITLE, VITAL } from "../src/web/kit-cyclone.js";
import { cited, onPages } from "./dso.js";

describe("/kit-cyclone, the plan's list", () => {
  it("quotes the plan only, each line found on its page", () => {
    for (const s of SECTIONS) {
      for (const l of s.lignes) {
        expect(l.cite, l.texte).toBe(true);
        expect(onPages(l.texte, l.pages), `p. ${l.pages.join("-")} : « ${l.texte} »`).toBe(true);
      }
      if (s.devise) expect(onPages(s.devise, [16, 17, 18]), s.devise).toBe(true);
    }
    // The patients at high vital risk: who acts, quoted.
    expect(cited(VITAL)).toEqual([{ quote: "contact individuellement avec les patients dont ils ont la charge", pages: [24] }]);
    expect(onPages(cited(VITAL)[0].quote, [24])).toBe(true);
  });

  it("is a page of its own, linked from /alerte-cyclone's pré-alerte, with no number the plan does not give", () => {
    const html = kitPage("https://rundata.re");
    expect(html).toContain(`<title>${TITLE}</title>`);
    expect(html).toContain("<h1>Que faut-il avoir chez soi pour un cyclone ?</h1>");
    expect(html).toContain("« Vérifiez vos réserves (conserves, eau, piles pour radio et lampes, médicaments,…) au sein de votre kit d&#39;urgence »");
    expect(html).toContain('rel="noopener">p. 17</a>');
    // The plan gives no telephone number: none in the page's text, the pages of the plan aside.
    const text = html.slice(html.indexOf("<h1>"), html.indexOf("</main>")).replace(/<a [^>]*>p\. [\d-]+<\/a>/g, "").replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/\b(?:112|114|15|17|18|196)\b/);
    expect(STEPS[0].lignes.some((l) => l.lien?.href === "/kit-cyclone")).toBe(true);
    expect(alertePage("https://rundata.re", null)).toContain('<a href="/kit-cyclone">');
    // In the pré-alerte, the state at the top points to it too.
    const NOW = new Date("2026-10-24T10:00:00Z");
    const pre = mf.parse({ update_time: "2026-10-24T02:00:00Z", timelaps: { domain_ids: [{ domain_id: mf.ISLAND, phenomenon_items: [{ phenomenon_id: mf.CYCLONE, timelaps_items: [{ color_id: 7, begin_time: "2026-10-24T02:00:00Z" }] }] }] } });
    expect(alertePage("https://rundata.re", { value: pre, fetchedAt: NOW, stale: false }, NOW)).toContain('<a href="#pre-alerte">Ce que prévoit ce niveau ↓</a> · <a href="/kit-cyclone">Le kit d&#39;urgence du plan →</a>');
  });

  it("is linked from /cyclones out of an alert and in pré-alerte, not once the schools are closed", () => {
    const NOW = new Date("2026-10-24T10:00:00Z");
    const answer = (niveau?: number) =>
      ({ resume: "Aucun système actif.", ecoles: niveau === undefined ? undefined : { niveau }, saison_en_cours: { nom: "2026-2027", systemes: [] }, a_savoir: "", phases_alerte: "", saison: "", consulter: {}, sources: [], traces: [] }) as unknown as CyclonesAnswer;
    const page = (niveau?: number) => cyclonesPage("https://rundata.re", { value: answer(niveau), fetchedAt: NOW, stale: false }, NOW);
    const LINK = `<a href="/kit-cyclone">Se préparer : le kit d'urgence du plan →</a>`;
    expect(page()).toContain(LINK);
    expect(page(-1)).toContain(LINK);
    expect(page(2)).toContain(LINK);
    expect(page(3)).not.toContain(LINK);
  });
});
