import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { buildTrafic } from "../src/web/data.js";
import { traficPage } from "../src/web/domains.js";

// The ONF's map of 24/10/2026 (test/fixtures/onf): 4 forest roads closed. The buses' timetables live in D1, absent here.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/onf/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T04:00:00Z");
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());
const BOT = { headers: { "user-agent": "Googlebot", accept: "text/html" } };

describe("circulation", () => {
  let down: RegExp | undefined;
  beforeEach(() => {
    down = undefined;
    vi.stubGlobal("fetch", async (url: string) => {
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
    expect(page).toContain("<h1>Circulation à La Réunion");
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

  it("has a place for what the media report on the roads", async () => {
    const d = { ...(await buildTrafic(cache(), NOW)), medias: [{ titre: "Barrage levé à Saint-Louis", lien: "https://example.org/a", source: "Média" }] };
    expect(traficPage("https://rundata.re", { value: d, fetchedAt: NOW }, NOW)).toContain(`<h3>Signalé par les médias</h3><ul class="plain"><li><a href="https://example.org/a">Barrage levé à Saint-Louis</a>`);
  });

  it("is on the home page and in the menu", async () => {
    const home = await (await handle(new Request("https://rundata.re/", BOT), cache())).text();
    expect(home).toContain(`href="/trafic"`);
  });
});
