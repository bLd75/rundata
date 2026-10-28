import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Alerte } from "../src/web/data.js";
import { agendaPage, randonneesPage, traficPage } from "../src/web/domains.js";
import { FONDS, MENTION, withSaveData } from "../src/web/fonds.js";
import files from "../src/web/fonds.json" with { type: "json" };
import { homePage } from "../src/web/home.js";
import { CSS, meteoPage, seaPage } from "../src/web/pages.js";
import { withVolcan } from "../src/web/volcan-alerte.js";

const NOW = new Date("2026-10-28T06:00:00Z");
const O = "https://rundata.re";
const PAGES: Record<string, (alerte?: Alerte) => string> = {
  "/meteo": (a) => meteoPage(O, null, NOW, a),
  "/randonnees": (a) => randonneesPage(O, null, NOW, a),
  "/trafic": (a) => traficPage(O, null, NOW, a),
  "/evenements": (a) => agendaPage(O, null, NOW, a),
  "/mer": (a) => seaPage(O, null, NOW, a),
};
const vigilance = (couleur: number, nom: string): Alerte => ({ couleur, texte: `Vigilance Météo-France : ${nom} fortes pluies (Est).`, court: { couleur: nom, phenomenes: ["Fortes pluies"], zones: ["Est"] } });
const picture = (html: string) => html.match(/<img class="fond"[^>]*>/)?.[0];

describe("the illustrations behind the band", () => {
  it("show each page's own picture, decorative and in low priority, with the mention beside it", () => {
    expect(Object.keys(FONDS).sort()).toEqual(Object.keys(PAGES).sort());
    for (const [path, render] of Object.entries(PAGES)) {
      const html = render();
      const img = picture(html);
      expect(img, path).toBeDefined();
      const f = files[FONDS[path].nom];
      expect(img).toContain(`src="/fonds/${f["480"]}"`);
      expect(img).toContain(`/fonds/${f["1024"]} 1024w`);
      expect(img).toContain('alt=""');
      expect(img).toContain('fetchpriority="low"');
      expect(html).toContain(`<p class="fond-ia">${MENTION}</p>`);
      // Behind the band's text, not in the page's flow.
      expect(html.indexOf(img!)).toBeGreaterThan(html.indexOf('<div class="band">'));
      expect(html.indexOf(img!)).toBeLessThan(html.indexOf("<h1"));
    }
  });

  it("are not on the home page", () => {
    expect(picture(homePage(O, null, NOW))).toBeUndefined();
  });

  it("stay under a yellow vigilance, and leave every page under an orange or red one or a cyclone alert", () => {
    for (const render of Object.values(PAGES)) {
      expect(picture(render(vigilance(2, "jaune")))).toBeDefined();
      expect(picture(render(vigilance(3, "orange")))).toBeUndefined();
      expect(picture(render(vigilance(4, "rouge")))).toBeUndefined();
      // The pré-alerte too: no calm picture while a cyclone is announced.
      expect(picture(render({ couleur: 2, neutre: true, texte: "Météo-France : pré-alerte cyclonique.", court: { cyclone: 2, prevue: false } }))).toBeUndefined();
      expect(render(vigilance(3, "orange"))).not.toContain(MENTION);
    }
  });

  it("leave every page while the volcano is in alert or erupting", () => {
    for (const render of Object.values(PAGES)) {
      expect(picture(withVolcan({ niveau: "Alerte 1", eruption: false }, () => render()))).toBeUndefined();
      expect(picture(withVolcan({ eruption: true }, () => render()))).toBeUndefined();
    }
  });

  it("are not written when the browser asks to save data", () => {
    const ask = (h: Record<string, string>) => new Request(`${O}/mer`, { headers: h });
    expect(picture(withSaveData(ask({ "save-data": "on" }), () => seaPage(O, null, NOW)))).toBeUndefined();
    expect(picture(withSaveData(ask({}), () => seaPage(O, null, NOW)))).toBeDefined();
  });

  it("fade out, stay out of print, and never add height to the band", () => {
    expect(CSS).toContain(".band>.fond{position:absolute;");
    expect(CSS).toContain("mask-image:linear-gradient(to bottom,");
    expect(CSS).toContain("@media print{.band>.fond,.fond-ia{display:none}}");
  });

  it("are light files, named after their content and kept a year", () => {
    for (const f of Object.values(files)) {
      // The phone's copy shares the bandwidth of the page's stylesheet and font: within 16 KB, it delays them little.
      for (const [width, max] of [["480", 16], ["1024", 120]] as const) {
        expect(f[width]).toMatch(/^[a-z-]+-\d+\.[0-9a-f]{10}\.webp$/);
        expect(statSync(new URL(`../public/fonds/${f[width]}`, import.meta.url)).size, f[width]).toBeLessThanOrEqual(max * 1024);
      }
    }
    expect(readFileSync(new URL("../public/_headers", import.meta.url), "utf8")).toMatch(/^\/fonds\/\*\n {2}Cache-Control: public, max-age=31536000, immutable$/m);
  });
});
