import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CSS, layout, sourcesLast } from "../src/web/pages.js";

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
