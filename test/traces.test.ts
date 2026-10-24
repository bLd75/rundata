import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { decode, gpx, measure, RANDONNEES, routePieces, SENTIERS } from "../src/providers/traces.js";
import { routesNamed, sentiersRandonnee } from "../src/tools/sentiers.js";

// The ONF's map on 24/10/2026 (test/fixtures/onf), one trail of it at full resolution (one point in twenty kept) with
// its altitudes from the IGN, and the hikes of OpenStreetMap bundled in src/traces/traces.json.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());
const BOT = { headers: { "user-agent": "Googlebot" } };

describe("traces GPS", () => {
  let asked: string[];
  let down: RegExp | undefined;
  beforeEach(() => {
    asked = [];
    down = undefined;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      asked.push(url);
      if (down?.test(url)) return new Response("", { status: 503 });
      if (url.includes("geopf.fr")) {
        expect(JSON.parse(String(init?.body)).resource).toBe("ign_rge_alti_wld");
        return new Response(fixture("traces/ign_le-bloc-piton-des-neiges.json"));
      }
      if (url.includes("/5/query") && url.includes("WS_NomIti+IN")) return new Response(fixture("traces/onf_le-bloc-piton-des-neiges.json"));
      if (url.includes("/5/query")) return new Response(fixture("onf/sentiers.json"));
      if (url.includes("/4/query")) return new Response(fixture("onf/routes.json"));
      if (url.includes("arcgis")) return new Response(fixture("onf/couche.json"));
      return new Response("", { status: 404 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("bundles the hikes of OpenStreetMap with their altitudes and the ONF trails they follow", () => {
    const pdn = RANDONNEES.find((r) => r.slug === "sentier-du-piton-des-neiges")!;
    expect(pdn).toMatchObject({ nom: "Sentier du Piton des Neiges", sentiers_onf: ["Le Bloc - Piton des Neiges"] });
    const pieces = routePieces(pdn);
    expect(pieces[0][0].lon).toBeCloseTo(55.483, 2);
    // Recomputed from the bundle, the climb is the build's; the length, from the line before simplifying, a little more.
    const m = measure(pieces);
    expect(m).toMatchObject({ dplus: pdn.dplus, dmoins: pdn.dmoins, alt_max: pdn.alt_max });
    expect(m.km).toBeGreaterThan(pdn.km * 0.93);
    expect(pdn.alt_max).toBeGreaterThan(3000);
    expect(pdn.dplus).toBeGreaterThan(1500);
    expect(decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
    expect(SENTIERS["Le Bloc - Piton des Neiges"]).toMatchObject({ slug: "le-bloc-piton-des-neiges", onf: ["Le Bloc - Piton des Neiges"] });
    expect(RANDONNEES.map((r) => r.slug)).toContain("gr-r2");
  });

  it("writes a GPX 1.1 file with its source and licence", () => {
    const g = gpx({
      nom: "A & B",
      description: "d",
      page: "https://rundata.re/x",
      auteur: "© les contributeurs d'OpenStreetMap",
      licence: "https://opendatacommons.org/licenses/odbl/1-0/",
      pieces: [[{ lon: 55.5, lat: -21.1, ele: 1200.5 }, { lon: 55.51, lat: -21.11 }]],
      now: NOW,
    });
    expect(g).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1" creator="rundata.re"/);
    expect(g).toContain("<name>A &amp; B</name>");
    expect(g).toContain(`<copyright author="© les contributeurs d'OpenStreetMap"><license>https://opendatacommons.org/licenses/odbl/1-0/</license></copyright>`);
    expect(g).toContain(`<trkpt lat="-21.1" lon="55.5"><ele>1200.5</ele></trkpt>\n<trkpt lat="-21.11" lon="55.51"></trkpt>`);
    expect(g).toContain(`<bounds minlat="-21.11" minlon="55.5" maxlat="-21.1" maxlon="55.51"/>`);
  });

  it("finds a hike by its name and gives its trace, its climb and the state of its trails", async () => {
    expect(routesNamed("la trace du Piton des Neiges").map((r) => r.nom)).toEqual(["Sentier du Piton des Neiges"]);
    const b = body(await sentiersRandonnee(cache(), "la trace du Piton des Neiges", NOW));
    expect(b.randonnees[0]).toMatchObject({
      randonnee: "Sentier du Piton des Neiges",
      etat: "tronçons suivis par l'ONF ouverts",
      troncons_onf: [{ sentier: "Le Bloc - Piton des Neiges", etat: "ouvert" }],
      trace_gpx: "https://rundata.re/randonnees/sentier-du-piton-des-neiges.gpx",
    });
    expect(b.resume).toMatch(/^Sentier du Piton des Neiges \(OpenStreetMap\) : 7,8 km, \d+ m de dénivelé positif ; tronçons suivis par l'ONF ouverts ; trace GPS https:\/\/rundata\.re\/randonnees\/sentier-du-piton-des-neiges\.gpx\./);
    expect(b.sentiers_nommes.find((s: { sentier: string }) => s.sentier === "Le Bloc - Piton des Neiges")).toMatchObject({
      etat: "ouvert",
      trace_gpx: "https://rundata.re/sentiers/le-bloc-piton-des-neiges.gpx",
      page: "https://rundata.re/sentiers/le-bloc-piton-des-neiges",
    });
    expect(routesNamed("GR R2").map((r) => r.slug)).toEqual(["gr-r2"]);
  });

  it("names the closed trails of a hike", async () => {
    const r2 = RANDONNEES.find((r) => r.slug === "gr-r2")!;
    const b = body(await sentiersRandonnee(cache(), "trace GR R2", NOW));
    const closed = b.randonnees[0].troncons_onf.filter((t: { etat: string }) => t.etat === "fermé");
    expect(b.randonnees[0].troncons_onf).toHaveLength(r2.sentiers_onf.length);
    if (closed.length) expect(b.randonnees[0].etat).toMatch(/^\d+ tronçons? fermés? : /);
  });

  it("gives the hikes with a trace around a place, and the trace of each open trail", async () => {
    const b = body(await sentiersRandonnee(cache(), "Cilaos", NOW));
    expect(b.autour.randonnees_avec_trace.map((r: { randonnee: string }) => r.randonnee)).toContain("Sentier du Piton des Neiges");
    expect(b.autour.sentiers_ouverts.find((s: { sentier: string }) => s.sentier === "Le Bloc - Piton des Neiges")).toMatchObject({ trace_gpx: "https://rundata.re/sentiers/le-bloc-piton-des-neiges.gpx" });
  });

  it("serves an ONF trail's GPX: its line and state from the ONF, its altitudes from the IGN, in two requests", async () => {
    const c = cache();
    const res = await handle(new Request("https://rundata.re/sentiers/le-bloc-piton-des-neiges.gpx"), c);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/gpx+xml; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="le-bloc-piton-des-neiges.gpx"');
    const g = await res.text();
    expect(g.match(/<trkpt /g)).toHaveLength(61);
    expect(g).toContain(`<trkpt lat="-21.123471" lon="55.483276"><ele>1371.5</ele></trkpt>`);
    expect(g).toMatch(/État d'après la carte de l'ONF le \d\d\/\d\d\/\d{4} à \d\d:\d\d : ouvert\./);
    expect(g).toContain(`<copyright author="ONF La Réunion"></copyright>`);
    expect(asked).toHaveLength(2);
    // The second download is served from the cache.
    await handle(new Request("https://rundata.re/sentiers/le-bloc-piton-des-neiges.gpx"), c);
    expect(asked).toHaveLength(2);
  });

  it("serves a hike's GPX from the bundle, with OpenStreetMap's licence and the trails' state", async () => {
    const res = await handle(new Request("https://rundata.re/randonnees/sentier-du-piton-des-neiges.gpx"), cache());
    const g = await res.text();
    expect(g).toContain("<name>Sentier du Piton des Neiges</name>");
    expect(g).toContain("<license>https://opendatacommons.org/licenses/odbl/1-0/</license>");
    expect(g).toMatch(/Sentiers de l'ONF le \d\d\/\d\d\/\d{4} à \d\d:\d\d : tronçons suivis par l'ONF ouverts\./);
    expect(g).toMatch(/<ele>\d+<\/ele>/);
    expect(asked.some((u) => u.includes("geopf"))).toBe(false);
  });

  it("shows a page per trail and per hike, with the map, the profile and the download", async () => {
    const page = await (await handle(new Request("https://rundata.re/randonnees/sentier-du-piton-des-neiges", BOT), cache())).text();
    expect(page).toContain("<h1>Sentier du Piton des Neiges</h1>");
    expect(page).toContain(`href="/randonnees/sentier-du-piton-des-neiges.gpx" download`);
    expect(page).toContain(`<svg class="map terrain zoom"`);
    expect(page).toContain(`<svg class="profile"`);
    expect(page).toContain(`<a href="/sentiers/le-bloc-piton-des-neiges">Le Bloc - Piton des Neiges</a>`);
    const trail = await (await handle(new Request("https://rundata.re/sentiers/le-bloc-piton-des-neiges", BOT), cache())).text();
    expect(trail).toContain("Ouvert d'après l'ONF");
    expect(trail).toContain(`<a href="/randonnees/sentier-du-piton-des-neiges">Sentier du Piton des Neiges</a>`);
    expect((await handle(new Request("https://rundata.re/sentiers/nulle-part.gpx"), cache())).status).toBe(404);
  });

  it("says when the ONF does not answer, rather than a file without its state", async () => {
    down = /arcgis/;
    const res = await handle(new Request("https://rundata.re/sentiers/le-bloc-piton-des-neiges.gpx"), cache());
    expect(res.status).toBe(503);
  });
});
