import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Cached } from "../src/cache.js";
import * as houle from "../src/providers/houle.js";
import * as seismes from "../src/providers/seismes.js";
import * as vigieau from "../src/providers/vigieau.js";
import { credits } from "../src/tools/format.js";
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

  it("leave the footer without the site's sources, and a link to them all; a page without its own keeps the site's", () => {
    const own = layout(O, head, "", `<p>La journée.</p>${SRC}`);
    const foot = own.slice(own.indexOf("<footer"));
    expect(foot).not.toContain("<h3>Sources</h3>");
    expect(foot).toContain('<a href="/chiffres">Toutes les sources →</a>');
    expect(foot).toContain("Ces données sont fournies telles quelles, sans garantie.");
    const bare = layout(O, { ...head, path: "/a-propos" }, "", "<p>Qui fait rundata.re.</p>");
    const none = bare.slice(bare.indexOf("<footer"));
    expect(none).toContain("<h3>Sources</h3>");
    expect(none).toContain("Air : Atmo Réunion (ODbL).");
    expect(none).toContain("Volcan : préfecture de La Réunion, OVPF-IPGP (CC BY 4.0)");
    expect(none).not.toContain("Toutes les sources");
  });

  it("of a commune name every tile's producer, the footer no longer naming them", () => {
    const fixture = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/pages/${n}.json`, import.meta.url), "utf8"));
    const now = new Date("2026-10-23T14:40:00Z");
    const cached = (value: unknown) => ({ value, fetchedAt: now, stale: false }) as Cached<never>;
    const mer = { plages: [{ nom: "Boucan Canot", commune: "Saint-Paul", lon: 55.22, lat: -21.03, houle: { hauteur_m: 1.4 } }], sources: credits([houle.SOURCE]) };
    const html = communePage(O, pageOf("saint-paul")!, {
      place: null,
      mer: cached(mer),
      secheresse: cached({ communes: [], sources: credits([vigieau.SOURCE]) }),
      volcan: cached({ ...fixture("volcan_seismes"), sources: credits([seismes.SOURCE]) }),
      electricite: cached(fixture("electricite")),
    }, now);
    const block = html.slice(html.indexOf('<div class="wrap fin-sources">'), html.indexOf("<footer"));
    expect(block).toContain("Prévision des vagues du modèle WAM du Centre européen (ECMWF), via Open-Meteo (CC BY 4.0");
    expect(block).toContain("Séismes localisés par l&#39;Observatoire volcanologique du Piton de la Fournaise (OVPF-IPGP) (CC BY 4.0)");
    expect(block).toContain("cartographiés dans OpenStreetMap (ODbL 1.0)");
    expect(block).toContain("(EDF SEI) (Licence Ouverte Etalab 2.0)");
    expect(block).toContain("Restrictions d&#39;eau en cas de sécheresse (VigiEau, arrêtés préfectoraux) (Licence Ouverte Etalab 2.0)");
    // The island's map beside the commune's name: its contours, its relief, its roads and the names of the communes.
    expect(block).toContain(`<p class="sources">Carte : contours des communes de geo.api.gouv.fr, relief, photographies aériennes, routes et noms de lieux de l'IGN (RGE ALTI, couche Photographies aériennes de la Géoplateforme, BD TOPO), sous Licence Ouverte Etalab 2.0.</p>`);
    expect(html.slice(html.indexOf("<footer"))).not.toContain("<h3>Sources</h3>");
  });
});
