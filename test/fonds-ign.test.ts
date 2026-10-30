import { describe, expect, it } from "vitest";
import { communeMap, FONDS, FONDS_SCRIPT, IGN_TUILES, islandMap, mapCredit, traceMap } from "../src/web/map.js";
import { legalPage } from "../src/web/pages.js";
import { politique } from "../src/web/securite.js";

const commune = communeMap({ commune: "Saint-Paul", spots: [{ lon: 55.27, lat: -21.01, i: 0, t: "parc", f: "jeux", name: "Un parc" }], label: "Carte", id: "ecm" });
const trace = traceMap({ lines: [{ etat: "ouvert", points: [[55.45, -21.1], [55.46, -21.11]] }], label: "Carte : la trace" });

describe("the IGN's backgrounds on the zoomed maps", () => {
  it("are offered in marketing's order, the relief chosen, shown by the script only", () => {
    for (const [html, k] of [[commune, "ecm"], [trace, "t"]]) {
      expect(html).toContain(`<div class="tabs fonds" role="radiogroup" aria-label="Fond de la carte" data-fd="${k}" hidden>`);
      expect([...html.matchAll(/<label for="fd-[a-z]+-[a-z]+">([^<]+)<\/label>/g)].map((m) => m[1])).toEqual(["Relief", "Plan IGN", "Photo aérienne"]);
      expect(html).toContain(`id="fd-${k}-relief" value="relief" checked>`);
      expect(html).toContain(`<script>${FONDS_SCRIPT}</script>`);
    }
  });

  it("say they are loading after a second, the relief kept under the tiles meanwhile", () => {
    for (const [html, k] of [[commune, "ecm"], [trace, "t"]]) expect(html).toContain(`</svg><p class="fd-w" id="fd-w-${k}" role="status"></p><div class="tabs fonds"`);
    expect(FONDS.filter((f) => f.layer).map((f) => f.attente)).toEqual(["Chargement du plan…", "Chargement de la photo aérienne…"]);
    expect(FONDS_SCRIPT).toContain("slow=setTimeout(()=>{if(msg){msg.textContent=say;place()}},1000)");
    expect(FONDS_SCRIPT).toContain("if(ep===epoch&&--pend===0)quiet()");
  });

  it("load nothing from the IGN until the visitor picks one: no tile in the page, only its address in the script", () => {
    for (const html of [commune, trace]) {
      expect(html.replace(`<script>${FONDS_SCRIPT}</script>`, "")).not.toContain(IGN_TUILES);
      expect(html).not.toMatch(/<image href="https:/);
    }
    expect(FONDS_SCRIPT).toContain(`"${IGN_TUILES}/wmts?SERVICE=WMTS&REQUEST=GetTile`);
    expect(FONDS_SCRIPT).toContain('if(!cur)return;');
  });

  it("lay the tiles over the relief, under our roads, and on a commune again over the dimmed island", () => {
    expect(trace).toMatch(/clip-path="url\(#isl-clip\)"\/><g id="fd-t" class="fd"><\/g><g class="rd"/);
    expect(commune).toContain('<g id="fd-ecm" class="fd"></g><use href="#isl" class="dim"/>');
    expect(commune).toMatch(/clip-path="url\(#com-clip\)"\/><use href="#fd-ecm" clip-path="url\(#com-clip\)"\/><g class="rd"/);
  });

  it("name the chosen one on the line « Carte : », never on a map without the choice", () => {
    expect(mapCredit(commune)).toContain("de l'IGN (RGE ALTI, BD TOPO)<span class=\"fd-c\"></span>, sous Licence Ouverte Etalab 2.0.");
    expect(mapCredit(islandMap({ label: "L'île" }))).not.toContain("fd-c");
    expect(FONDS.filter((f) => f.credit).map((f) => f.credit)).toEqual(["Plan IGN", "Photo aérienne IGN"]);
  });

  it("are aerial photos and a plan, never « satellite »", () => {
    expect(`${commune}${trace}${FONDS_SCRIPT}${JSON.stringify(FONDS)}`).not.toMatch(/satellite/i);
  });

  it("come from the IGN's tiles alone: images only, nothing else let in", () => {
    const csp = politique([]);
    expect(csp).toContain(`img-src 'self' ${IGN_TUILES};`);
    expect(csp).toContain("connect-src 'self';");
    expect(csp.match(/data\.geopf\.fr/g)).toHaveLength(1);
  });

  it("are told on /confidentialite", () => {
    expect(legalPage("https://rundata.re", "confidentialite")).toContain(
      "<p id=\"fonds-ign\">Si vous choisissez le fond Plan IGN ou Photo aérienne, votre navigateur charge ces images chez l'IGN (data.geopf.fr), qui reçoit alors votre adresse IP.</p>",
    );
  });
});
