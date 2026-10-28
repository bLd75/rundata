import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Cached } from "../src/cache.js";
import { communePage } from "../src/web/commune.js";
import { CSS, layout, sourcesLast } from "../src/web/pages.js";
import { pageOf } from "../src/web/places.js";

const O = "https://rundata.re";
const head = { title: "Saint-Denis aujourd'hui", description: "La journée", path: "/aujourdhui/saint-denis", jsonld: [] };
const SRC = '<p class="sources">Sources : Météo-France (Licence Ouverte Etalab 2.0) ; Atmo Réunion (ODbL).</p>';

describe("the sources of a page", () => {
  it("are said last, just above the footer, after the links and the feedback form", () => {
    const html = layout(O, head, "", `<section><p>La journée.</p>${SRC}<p class="note"><a href="/communes/saint-denis">Saint-Denis en direct →</a></p></section>`);
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(main).not.toContain("Sources :");
    expect(main).toContain("Saint-Denis en direct →");
    const at = html.indexOf(SRC);
    expect(at).toBeGreaterThan(html.indexOf('id="avis"'));
    expect(html.indexOf("<footer", at)).toBeGreaterThan(at);
    expect(html.slice(at + SRC.length, html.indexOf("<footer"))).not.toContain("<a ");
  });

  it("keep their words, every producer and licence in full, in their order", () => {
    const second = '<p class="sources">Sources : ONF (Licence Ouverte Etalab 2.0). Mis à jour à 09:50.</p>';
    const [main, sources] = sourcesLast(`<section>a${SRC}b</section><section>c${second}</section>`);
    expect(main).toBe("<section>ab</section><section>c</section>");
    expect(sources).toEqual([SRC, second]);
    expect(sourcesLast("<p>rien</p>")).toEqual(["<p>rien</p>", []]);
  });

  it("leave behind what they said of the data itself: the bus warning stays by the commune's tiles", () => {
    const air = JSON.parse(readFileSync(new URL("./fixtures/pages/qualite_air.json", import.meta.url), "utf8"));
    const now = new Date("2026-10-23T14:40:00Z");
    const html = communePage(O, pageOf("sainte-marie")!, { place: null, air: { value: air, fetchedAt: now, stale: false } as Cached<never> }, now);
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(main).toMatch(/<\/ul>\s*<p class="note">Bus : horaires théoriques publiés par les réseaux, sans les retards\. Mairie : /);
    expect(main).not.toContain("Sources :");
    const at = html.indexOf('<p class="sources">Sources : ');
    expect(at).toBeGreaterThan(html.indexOf('id="avis"'));
    expect(html.slice(at, html.indexOf("</p>", at))).not.toContain("Bus :");
  });

  it("hold the producers and their licences alone, in every page's code: no hour, no warning", () => {
    const dir = new URL("../src/web/", import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const code = readFileSync(new URL(f, dir), "utf8");
      for (let at = code.indexOf('<p class="sources">Sources : '); at >= 0; at = code.indexOf('<p class="sources">Sources : ', at + 1)) {
        // The paragraph's words outside its ${…}: « Sources : », and nothing but punctuation after.
        let words = "";
        for (let i = at, depth = 0; !code.startsWith("</p>", i); i++) {
          if (code.startsWith("${", i)) (depth++, i++);
          else if (depth && code[i] === "{") depth++;
          else if (depth && code[i] === "}") depth--;
          else if (!depth) words += code[i];
        }
        expect(words.replace('<p class="sources">Sources : ', ""), f).toMatch(/^[\s,();.]*$/);
      }
    }
  });

  it("are in small, in the muted colour", () => {
    expect(CSS).toContain(".sources{margin:0 0 .3rem;font-size:.75rem;line-height:1.35;color:var(--muted)}");
  });

  it("are written as such on every page", () => {
    const dir = new URL("../src/web/", import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      expect(readFileSync(new URL(f, dir), "utf8"), f).not.toContain('<p class="note">Sources');
    }
  });
});
