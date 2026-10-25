import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handle } from "../src/app.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { DAES } from "../src/providers/dae.js";
import { STATIONS_EN_SERVICE } from "../src/providers/meteofrance-stations.js";
import { IDS } from "../src/providers/irve.js";
import icons from "../src/web/icons.json" with { type: "json" };
import visuals from "../src/web/presse.json" with { type: "json" };
import { homePage } from "../src/web/home.js";

const NOW = new Date("2026-10-24T04:00:00Z");
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());
const fr = (n: number) => n.toLocaleString("fr-FR").replace(/ /g, " ");
const page = async (c = cache()) => {
  const r = await handle(new Request("https://rundata.re/presse", { headers: { accept: "text/html" } }), c);
  expect(r.status).toBe(200);
  return r.text();
};

describe("press page", () => {
  it("has the release, ending on the press contact", async () => {
    const html = await page();
    expect(html).toContain("<h1>rundata.re, pour la presse</h1>");
    expect(html).toContain("Toute La Réunion en direct, sur une seule page… et dans votre assistant IA");
    expect(html).toContain(`Contact presse\u00a0: Benjamin, pour l'équipe rundata.re — <a href="mailto:contact@rundata.re">contact@rundata.re</a>`);
    // One signature: the release ends on its contact line, as the communication kit's communiqué does.
    expect(html).not.toContain("<p>L'équipe rundata.re</p>");
    expect(html).toContain("Le sentier du Piton des Neiges\u00a0: sa trace GPS, sa longueur et son dénivelé.");
    // As the communication kit sends it: the news in, no figure of stations in the text, nothing announced that has shipped.
    expect(html).toContain("<li><b>Actualités</b>\u00a0: les informations des médias de l'île");
    expect(html).toContain("les stations Météo-France de la côte aux sommets, relevées toutes les 6 minutes");
    expect(html).not.toContain("D'autres rubriques arrivent");
    // The team speaks, not an unnamed user; the site is « en continu », not every five minutes.
    expect(html).toContain("explique l'équipe de rundata.re.</p>");
    expect(html).not.toContain("premiers utilisateurs");
    expect(html).toContain("commune par commune, mise à jour en continu, chaque donnée avec son heure.");
    expect(html).not.toContain("cinq minutes");
    expect(html).toContain(`<link rel="canonical" href="https://rundata.re/presse">`);
  });

  it("says what the connector receives, never that no personal data is collected (the host keeps logs with the address)", async () => {
    const said = "le connecteur ne reçoit que la question posée à l'outil, par exemple «\u00a0Saint-Paul\u00a0», jamais votre conversation.";
    const html = await page();
    // « Saint-Paul » kept on one line: cut at its hyphen, it read « Saint- / Paul » at 390 px.
    expect(html).toContain(`Rien à installer, pas de compte\u00a0: ${said.replace("«\u00a0Saint-Paul\u00a0»", '<span style="white-space:nowrap">«\u00a0Saint-Paul\u00a0»</span>')}`);
    const home = homePage("https://rundata.re", null, NOW);
    expect(home).toContain(`compris par la plupart des assistants IA. Il${said.slice("le connecteur".length)}</p>`);
    for (const h of [html, home]) expect(h).not.toMatch(/donnée personnelle/);
  });

  it("names the press contact once, by first name, in the release's contact line only", async () => {
    const html = await page();
    expect(html.match(/Benjamin/g)).toHaveLength(1);
    // Not in the title, the description, the og tags or the JSON-LD: the page's head carries none of it.
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain('<script type="application/ld+json">');
    expect(head).not.toContain("Benjamin");
    // The hero's button writes to the team's address, unnamed.
    expect(html).toContain(`href="mailto:contact@rundata.re">Contact presse</a>`);
  });

  it("counts its key figures in the data it serves", async () => {
    const html = await page();
    expect(html).toContain(`<span class="fig">${fr(DAES.length)}</span><span>défibrillateurs`);
    expect(html).toContain(`<span class="fig">${fr(IDS.size)}</span><span>points de recharge`);
    expect(html).toMatch(/<span class="fig">\d+<\/span><span>outils dans le connecteur/);
    // The stations that publish, the count the connector gives too.
    expect(html).toContain(`<span class="fig">${STATIONS_EN_SERVICE}</span><span>stations Météo-France en direct`);
    expect(html).toContain("et les retards quand le réseau les publie");
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
    // Reused for weeks: the label dates the captures, and says when they show an alert.
    expect(await page()).toContain(`<p class="eyebrow">Captures du 25 octobre 2026, pendant l'alerte 1 du Piton de la Fournaise.</p>`);
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
    // The symbol of the brand, never the flag, in SVG and PNG 1024, and its two lockups: files beside the Worker.
    expect(html).not.toContain("drapeau");
    for (const [key, name] of [["symbole-svg", "rundata-symbole.svg"], ["symbole-1024", "rundata-symbole-1024.png"], ["lockup-nuit", "rundata-logo-fond-sombre.svg"], ["lockup-sable", "rundata-logo-fond-clair.svg"]] as const) {
      expect(html).toContain(`href="${icons[key]}" download="${name}"`);
      expect(existsSync(new URL(`../public${icons[key]}`, import.meta.url))).toBe(true);
    }
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

describe("the stations in service", () => {
  it("are those of a recorded 6-minute packet, the count meteo_actuelle and sources_donnees give", () => {
    const csv = readFileSync(new URL("./fixtures/meteofrance_6min.csv", import.meta.url), "utf8");
    expect(new Set(csv.match(/^[^;\n]*;[^;\n]*;974\d{5}(?=;)/gm)!.map((l) => l.split(";")[2])).size).toBe(STATIONS_EN_SERVICE);
  });
});
