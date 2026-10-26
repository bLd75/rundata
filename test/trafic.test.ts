import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache, MemoryStore } from "../src/cache.js";
import * as carburants from "../src/providers/carburants.js";
import type { Fil, Info } from "../src/providers/actualites.js";
import { buildTrafic, roadNewsNow, withRoadNews } from "../src/web/data.js";
import { traficPage } from "../src/web/domains.js";
import { islandMap } from "../src/web/map.js";

// The ONF's map of 24/10/2026 (test/fixtures/onf): 4 forest roads closed. The buses' timetables live in D1, absent here.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/onf/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T04:00:00Z");
// The views tested before the fake clock run at the real time: past NOW since 25/10/2026.
const LOADED = Date.now();
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());
const BOT = { headers: { "user-agent": "Googlebot", accept: "text/html" } };

describe("circulation", () => {
  let down: RegExp | undefined;
  let asked: string[] = [];
  beforeEach(() => {
    down = undefined;
    asked = [];
    // The month's fuel prices, as the workflow stores them.
    const prix = carburants.parseRelease(readFileSync(new URL("./fixtures/carburants_octobre.html", import.meta.url), "utf8"), "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Prix-des-carburants-en-octobre");
    carburants.configure(async () => prix ?? null);
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      if (down?.test(url)) return new Response("", { status: 503 });
      if (url.includes("/5/query")) return new Response(fixture("sentiers.json"));
      if (url.includes("/4/query")) return new Response(fixture("routes.json"));
      if (url.includes("arcgis")) return new Response(fixture("couche.json"));
      return new Response("", { status: 404 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    carburants.configure(undefined);
  });

  it("says plainly it has no traffic data, and points to the Région's official map first, Waze's only below it", async () => {
    const res = await handle(new Request("https://rundata.re/trafic", BOT), cache());
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("<h1>Bouchons et circulation à La Réunion");
    expect(page).toContain("rundata.re n'a pas la mesure des bouchons\u00a0: la Région ne la rend pas réutilisable pour l'instant.");
    expect(page).toContain(`href="https://www.infotrafic.re/"`);
    // The month's maximum fuel prices, beside the roads.
    expect(page.replaceAll("\u00a0", " ")).toContain("<h3>Prix des carburants</h3><p>Prix maximum depuis le 1er octobre 2026, fixés par le préfet : sans plomb 2,00 €/litre (+0,17 €) ; gazole 1,80 €/litre (+0,12 €) ; gaz 20,81 € la bouteille de 12,5 kg (+0,21 €), 18 € avec aides locales.</p>");
    // Waze's map, which brings cookies, is not in the page: only on a click.
    expect(page).not.toContain("<iframe");
    expect(page).toContain(`<button type="button" id="wz-go"`);
    expect(page.match(/href="https:\/\/www\.waze\.com\/ul\?ll=-?[\d.]+,[\d.]+&amp;zoom=\d+"/g)!.length).toBeGreaterThanOrEqual(5);
    expect(page).toContain("embed.waze.com/fr/iframe?zoom=");
    // The official map first, in the band; Waze's below it, before what rundata.re reads, and named nowhere else but
    // in the lead that says so and in the box that says why.
    expect(page).toContain(`<a class="btn sun" href="https://www.infotrafic.re/">`);
    expect(page).toContain("Carte officielle (infotrafic.re) ↗</a>");
    const map = page.indexOf(`<figure class="card mapcard wz">`);
    expect(page.indexOf('id="h-officiel"')).toBeLessThan(map);
    expect(map).toBeLessThan(page.indexOf('id="h-nous"'));
    const why = page.indexOf('<section aria-labelledby="h-pourquoi">');
    const below = "Plus bas, la carte de Waze les montre aussi.";
    expect(page).toContain(below);
    const rest = page.slice(0, map) + page.slice(page.indexOf("</figure>", map), why) + page.slice(page.indexOf("</section>", why), page.indexOf("<script>", why));
    expect(rest.replace(below, "")).not.toMatch(/waze/i);
  });

  it("gives what is open: the forest roads closed, the main ones, the buses' delays", async () => {
    const d = await buildTrafic(cache(), NOW);
    expect(d.routes_forestieres!.interdites.map((r) => r.route)).toContain("Route Forestière de la Scierie (RF58)");
    expect(d.routes_forestieres!.interdites).toHaveLength(4);
    expect(d.routes_forestieres!.principales.map((r) => r.route)).toEqual(expect.arrayContaining(["Route Forestière du Maïdo (RF08)", "Route Forestière du Volcan (RF05) de Piton Sec au Pas des Sables"]));
    // No timetables here: no delay, said as such.
    expect(d.bus).toMatchObject({ retards: [], suivis: 0 });
    const page = traficPage("https://rundata.re", { value: d, fetchedAt: NOW }, NOW);
    expect(page).toContain("Retards des bus, pas une mesure des bouchons");
    expect(page).toMatch(/Route Forestière de la Scierie \(RF58\)<small>Sécurité, décision n°18\/2025<\/small><\/span><span class="q-mauvaise">interdite/);
    expect(page).not.toContain("Signalé par les médias");
  });

  it("lists the fixed speed cameras by commune, each on the map, with the day of the ministry's file", async () => {
    const page = traficPage("https://rundata.re", { value: await buildTrafic(cache(), NOW), fetchedAt: NOW }, NOW);
    const card = page.slice(page.indexOf('<div class="card" id="radars">'), page.indexOf("</div>", page.indexOf('id="radars"')));
    expect(card).toContain("<h3>Radars fixes</h3>");
    expect(card).toContain("24 radars fixes à La Réunion, d'après la liste publiée par le ministère de l'Intérieur (fichier du 30/12/2025).");
    expect(card).toMatch(/<li><span>Saint-Denis<small>70\u00a0km\/h, 90\u00a0km\/h<\/small><\/span><span class="score">6<\/span><\/li>/);
    expect(card).toMatch(/<li>Saint-Denis, 70\u00a0km\/h[ \u00a0]: <a href="https:\/\/www\.openstreetmap\.org\/[^"]+" rel="noopener">la carte ↗<\/a><\/li>/);
    expect(card.match(/rel="noopener">la carte ↗<\/a>/g)).toHaveLength(24);
    expect(card).not.toContain("près de");
    const map = card.slice(card.indexOf('<svg class="map'), card.indexOf("</svg>", card.indexOf('<svg class="map')));
    expect(map).toContain('aria-label="24 radars fixes à La Réunion, d&#39;après la liste publiée par le ministère de l&#39;Intérieur (fichier du 30/12/2025)."');
    expect(map.match(/<g class="mk">/g)).toHaveLength(24);
    expect(map).toMatch(/<title>Saint-Denis, 70\u00a0km\/h<\/title><rect [^>]+\/><text [^>]+class="mv">70<\/text><\/g>/);
    expect(map).toMatch(/class="mv">110<\/text>/);
    expect(map).not.toContain('class="mn"');
    expect(card).toContain("fichier du 30/12/2025, mise à jour une fois par an");
    expect(card).not.toMatch(/mobiles? (?!n)|attention|évite|ralenti|flash|piège/i);
  });

  it("draws no camera's pill over another's: those too close moved apart, each tied to its place by a dot and a line", () => {
    const mapOf = (page: string) => {
      const card = page.slice(page.indexOf('<div class="card" id="radars">'));
      return card.slice(card.indexOf('<svg class="map'), card.indexOf("</svg>", card.indexOf('<svg class="map')));
    };
    const map = mapOf(traficPage("https://rundata.re", null, NOW));
    const pills = [...map.matchAll(/<rect class="sh" x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="48"/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3] }));
    expect(pills).toHaveLength(24);
    const over = pills.flatMap((a, i) => pills.slice(i + 1).filter((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + 48 && b.y < a.y + 48).map((b) => [a, b]));
    expect(over).toEqual([]);
    expect(pills.every((p) => p.x >= 0 && p.x + p.w <= 1000 && p.y >= 0 && p.y + 48 <= 896)).toBe(true);
    // Saint-Denis's six within a few hundred metres, and the pairs of the South and the West: under every pill, a dot
    // at each moved one's place, a line to its pill.
    const ties = map.slice(map.indexOf('<g class="ties"'), map.indexOf('<g class="mk">'));
    expect(map.indexOf('<g class="ties" aria-hidden="true">')).toBeGreaterThan(0);
    const lines = [...ties.matchAll(/<line x1="\d+" y1="\d+" x2="(\d+)" y2="(\d+)"/g)].map((m) => [+m[1], +m[2]]);
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(ties.match(/<circle /g)).toHaveLength(lines.length);
    expect(lines.every(([x, y]) => pills.some((p) => p.x + p.w / 2 === x && p.y + 24 === y))).toBe(true);
    // The same places at each build.
    expect(mapOf(traficPage("https://rundata.re", null, NOW))).toBe(map);
  });

  it("leaves the other maps' markers where they are", () => {
    const two = [{ lon: 55.45, lat: -20.88, label: "70", name: "a" }, { lon: 55.4505, lat: -20.8801, label: "90", name: "b" }];
    expect(islandMap({ markers: two, label: "x" })).not.toContain('class="ties"');
    expect(islandMap({ markers: two, label: "x", apart: true })).toContain('<g class="ties" aria-hidden="true"><line ');
  });

  it("still answers when the ONF does not", async () => {
    down = /arcgis/;
    const d = await buildTrafic(cache(), NOW);
    expect(d.routes_forestieres).toBeNull();
    expect(traficPage("https://rundata.re", { value: d, fetchedAt: NOW }, NOW)).toContain("La carte de l'ONF ne répond pas pour le moment.");
  });

  describe("what the media report on the roads", () => {
    const at = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
    const info = (titre: string, h: number, sujets: string[], extra: Partial<Info> = {}): Info => ({ titre, media: "Imaz Press", lien: `https://imazpress.com/${h}`, publie: at(h), heure: true, communes: [], lieux: [], sujets, ...extra });
    const fil = (): Fil => ({
      infos: [
        info("Barrage levé au rond-point des Casernes", 0.5, ["mobilisation", "route"], { direct: true }),
        info("Fête de la Saint-Louis : le programme", 1, ["culture"]),
        info("Accident sur la quatre-voies à Sainte-Marie", 2, ["route"], { media: "Clicanoo", lien: "https://www.clicanoo.re/a" }),
        info("Route du Littoral basculée cette nuit", 8, ["route"]),
        // Tagged from their text, not about the roads.
        info("Rentrez vos poubelles !", 1.5, ["mobilisation", "securite"], { direct: true }),
        info("Le CROS salue le report des rassemblements sportifs", 2.5, ["mobilisation", "sport"]),
      ],
      prefecture: [
        info("Violences urbaines : bilan de la nuit", 3, ["mobilisation"], { media: "Préfecture de La Réunion", lien: "https://www.reunion.gouv.fr/a", heure: false }),
        info("Fête de la science : le programme", 3, ["culture"], { media: "Préfecture de La Réunion", lien: "https://www.reunion.gouv.fr/b", heure: false }),
        info("Interdiction de manifester à Saint-Pierre", 30, ["mobilisation"], { media: "Préfecture de La Réunion", lien: "https://www.reunion.gouv.fr/c", heure: false }),
      ],
      indisponible: [],
    });
    const feeds = /imazpress|clicanoo|la1ere|freedom|parallelesud|temoignages|reunion\.gouv/;
    // The page is served at NOW, whatever the day the tests run.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    it("tells the headlines from the news already read, newest first, without reading the feeds", async () => {
      const c = cache();
      await c.get<Fil>("actualites:fil", 300, async () => fil());
      const d = withRoadNews(await buildTrafic(c, NOW), fil(), NOW);
      // The préfecture's communiqué of the day first, then the media's headlines on the roads.
      expect(d.medias).toEqual([
        { titre: "Violences urbaines : bilan de la nuit", lien: "https://www.reunion.gouv.fr/a", source: "Préfecture de La Réunion", heure: "aujourd'hui" },
        { titre: "Barrage levé au rond-point des Casernes", lien: "https://imazpress.com/0.5", source: "Imaz Press, en direct", heure: "aujourd'hui à 07:30" },
        { titre: "Accident sur la quatre-voies à Sainte-Marie", lien: "https://www.clicanoo.re/a", source: "Clicanoo", heure: "aujourd'hui à 06:00" },
      ]);
      expect(d.sources.map((s) => s.source)).toEqual(expect.arrayContaining(["Communiqués de presse de la préfecture de La Réunion"]));
      const page = await (await handle(new Request("https://rundata.re/trafic", BOT), c)).text();
      expect(page).toContain(`<h3>Signalé par les médias</h3><ul class="plain"><li><a href="https://www.reunion.gouv.fr/a" rel="noopener">Violences urbaines\u00a0: bilan de la nuit</a> <span class="note">Préfecture de La Réunion, aujourd&#39;hui</span></li><li><a href="https://imazpress.com/0.5" rel="noopener">Barrage levé au rond-point des Casernes</a> <span class="note">Imaz Press, en direct, aujourd&#39;hui à\u00a007:30</span>`);
      for (const no of ["Route du Littoral basculée", "Rentrez vos poubelles", "rassemblements sportifs", "Fête de la science", "Interdiction de manifester"]) expect(page).not.toContain(no);
      // The news is fresh: its feeds are not asked again for this page.
      expect(asked.some((u) => feeds.test(u))).toBe(false);
    });

    it("shows headlines that arrive after the page's copy was built", async () => {
      // The copy of /trafic built before anyone read the news (a new version), then the news read for /actualites.
      const c = cache();
      const first = await (await handle(new Request("https://rundata.re/trafic", BOT), c)).text();
      expect(first).not.toContain("Signalé par les médias");
      await c.get<Fil>("actualites:fil", 300, async () => fil());
      const next = await (await handle(new Request("https://rundata.re/trafic", BOT), c)).text();
      expect(next).toContain("Barrage levé au rond-point des Casernes");
      expect(next).toContain("Accident sur la quatre-voies à Sainte-Marie");
    });

    it("reads the news after the response when there is none, or when it is old", async () => {
      const c = cache();
      const later: Promise<unknown>[] = [];
      // A day on: the views of the tests above have asked for it already (once a minute at most), at the real time.
      expect(await roadNewsNow(c, (p) => later.push(p), new Date(Math.max(LOADED, NOW.getTime()) + 86400_000))).toBeUndefined();
      expect(later).toHaveLength(1);
      await Promise.all(later);
      expect(asked.some((u) => feeds.test(u))).toBe(true);
      // Fresh news: nothing read.
      const fresh = cache();
      await fresh.get<Fil>("actualites:fil", 300, async () => fil());
      const none: Promise<unknown>[] = [];
      expect((await roadNewsNow(fresh, (p) => none.push(p), new Date(NOW.getTime() + 5 * 60_000)))?.infos).toHaveLength(6);
      expect(none).toHaveLength(0);
    });
  });

  it("is on the home page and in the menu", async () => {
    const home = await (await handle(new Request("https://rundata.re/", BOT), cache())).text();
    expect(home).toContain(`href="/trafic"`);
  });
});
