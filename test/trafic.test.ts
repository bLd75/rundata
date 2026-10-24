import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache, MemoryStore } from "../src/cache.js";
import type { Fil, Info } from "../src/providers/actualites.js";
import { buildTrafic, roadNewsNow, withRoadNews } from "../src/web/data.js";
import { traficPage } from "../src/web/domains.js";

// The ONF's map of 24/10/2026 (test/fixtures/onf): 4 forest roads closed. The buses' timetables live in D1, absent here.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/onf/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T04:00:00Z");
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());
const BOT = { headers: { "user-agent": "Googlebot", accept: "text/html" } };

describe("circulation", () => {
  let down: RegExp | undefined;
  let asked: string[] = [];
  beforeEach(() => {
    down = undefined;
    asked = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      if (down?.test(url)) return new Response("", { status: 503 });
      if (url.includes("/5/query")) return new Response(fixture("sentiers.json"));
      if (url.includes("/4/query")) return new Response(fixture("routes.json"));
      if (url.includes("arcgis")) return new Response(fixture("couche.json"));
      return new Response("", { status: 404 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("says plainly it has no traffic data, and points to Waze and to the Région", async () => {
    const res = await handle(new Request("https://rundata.re/trafic", BOT), cache());
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("<h1>Bouchons et circulation à La Réunion");
    expect(page).toContain("rundata.re n'a pas la mesure des bouchons : la Région ne la rend pas réutilisable pour l'instant.");
    expect(page).toContain(`href="https://www.infotrafic.re/"`);
    // Waze's map, which brings cookies, is not in the page: only on a click.
    expect(page).not.toContain("<iframe");
    expect(page).toContain(`<button type="button" id="wz-go"`);
    expect(page.match(/href="https:\/\/www\.waze\.com\/ul\?ll=-?[\d.]+,[\d.]+&amp;zoom=\d+"/g)!.length).toBeGreaterThanOrEqual(5);
    expect(page).toContain("embed.waze.com/fr/iframe?zoom=");
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
      expect(page).toContain(`<h3>Signalé par les médias</h3><ul class="plain"><li><a href="https://www.reunion.gouv.fr/a" rel="noopener">Violences urbaines : bilan de la nuit</a> <span class="note">Préfecture de La Réunion, aujourd&#39;hui</span></li><li><a href="https://imazpress.com/0.5" rel="noopener">Barrage levé au rond-point des Casernes</a> <span class="note">Imaz Press, en direct, aujourd&#39;hui à 07:30</span>`);
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
      // A day on: the views of the tests above have asked for it already (once a minute at most).
      expect(await roadNewsNow(c, (p) => later.push(p), new Date(NOW.getTime() + 86400_000))).toBeUndefined();
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
