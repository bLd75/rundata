import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handle } from "../src/app.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { DAES } from "../src/providers/dae.js";
import { IDS } from "../src/providers/irve.js";
import visuals from "../src/web/presse.json" with { type: "json" };

const NOW = new Date("2026-10-24T04:00:00Z");
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());
const fr = (n: number) => n.toLocaleString("fr-FR").replace(/ /g, " ");
const page = async (c = cache()) => {
  const r = await handle(new Request("https://rundata.re/presse", { headers: { accept: "text/html" } }), c);
  expect(r.status).toBe(200);
  return r.text();
};

describe("press page", () => {
  it("has the release signed by the team, with the press contact", async () => {
    const html = await page();
    expect(html).toContain("<h1>rundata.re, pour la presse</h1>");
    expect(html).toContain("Toute La Réunion en direct, sur une seule page… et dans votre assistant IA");
    expect(html).toContain(`Contact presse : <a href="mailto:contact@rundata.re">contact@rundata.re</a>`);
    expect(html).toContain("<p>L'équipe rundata.re</p>");
    // As the communication kit sends it: the news in, no figure of stations in the text, nothing announced that has shipped.
    expect(html).toContain("<li><b>Actualités</b> : les informations des médias de l'île");
    expect(html).toContain("les stations Météo-France de la côte aux sommets, relevées toutes les 6 minutes");
    expect(html).not.toContain("D'autres rubriques arrivent");
    expect(html).toContain(`<link rel="canonical" href="https://rundata.re/presse">`);
  });

  it("counts its key figures in the data it serves", async () => {
    const html = await page();
    expect(html).toContain(`<span class="fig">${fr(DAES.length)}</span><span>défibrillateurs`);
    expect(html).toContain(`<span class="fig">${fr(IDS.size)}</span><span>points de recharge`);
    expect(html).toMatch(/<span class="fig">\d+<\/span><span>outils dans le connecteur/);
    // The counts of the day only once this data center has them: nothing is fetched for this page.
    expect(html).not.toContain("événements dans les deux semaines");
    expect(html).not.toContain("fermés aujourd");
  });

  it("adds the day's counts from the copies already there", async () => {
    const c = cache();
    await c.get("web:agenda", 600, async () => ({ nombre: 37 }));
    await c.get("web:randonnees", 600, async () => ({ fermes: 56 }));
    const html = await page(c);
    expect(html).toContain(`<span class="fig">37</span><span>événements dans les deux semaines qui viennent`);
    expect(html).toContain("dont 56 fermés aujourd");
  });

  it("offers each visual as a thumbnail and an HD download, free to use with the credit", async () => {
    const html = await page();
    expect(html).toContain("Utilisation libre des visuels avec la mention rundata.re.");
    for (const [id, v] of Object.entries(visuals)) {
      expect(html).toContain(`<img src="${v.vignette}" width="${v.vignette_largeur}" height="${v.vignette_hauteur}" loading="lazy"`);
      expect(html).toContain(`<a class="dl" href="${v.hd}" download="rundata-${id}.jpg">Télécharger (HD)</a>`);
      // Static assets beside the Worker, kept for good by browsers: their names change with their content.
      for (const f of [v.hd, v.vignette]) {
        expect(f).toMatch(/^\/presse\/rundata-[a-z-]+\.[0-9a-f]{10}\.(jpg|webp)$/);
        expect(existsSync(new URL(`../public${f}`, import.meta.url))).toBe(true);
      }
    }
    expect(readFileSync(new URL("../public/_headers", import.meta.url), "utf8")).toContain("/presse/*\n  Cache-Control: public, max-age=31536000, immutable");
    expect(html).toContain(`download="rundata-drapeau.svg"`);
  });

  it("is linked from every footer and listed in the sitemap, not on the home page's tiles", async () => {
    const home = await (await handle(new Request("https://rundata.re/", { headers: { accept: "text/html" } }), cache())).text();
    const foot = home.slice(home.indexOf(`<footer class="foot">`));
    expect(foot).toContain(`<a href="/presse">presse</a>`);
    expect(home.slice(0, home.indexOf(`<footer class="foot">`))).not.toContain(`href="/presse"`);
    const map = await (await handle(new Request("https://rundata.re/sitemap.xml"), cache())).text();
    expect(map).toContain("<loc>https://rundata.re/presse</loc>");
  });
});
