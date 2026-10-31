import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { KV_KEEP_SECONDS, type KvBinding, KvStore } from "../src/kv.js";
import { ALTI_SECONDS, decode, gpx, measure, portionsOf, RANDONNEES, routePieces, SENTIERS, sentier, traceOnf } from "../src/providers/traces.js";
import { routesNamed, secteur, sentiersRandonnee } from "../src/tools/sentiers.js";
import { buildTrail, trailGpx } from "../src/web/data.js";
import { SECTEURS as SECTEURS_RANDO } from "../src/traces/secteurs.js";

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
  // The ONF trails to show closed, whatever the map of the day says.
  let shut: RegExp | undefined;
  // The trail's own trace closed on weekdays, open on weekends by its notice.
  let weekend: boolean;
  const map = () => {
    const m = JSON.parse(fixture("onf/sentiers.json"));
    for (const f of m.features) {
      if (shut?.test(String(f.attributes.WS_NomIti))) Object.assign(f.attributes, { WS_Statut: "Sentier fermé", WS_InfCaus: "Éboulement", WS_InfDate: "Réouverture prévue le 15/11/2026" });
    }
    return JSON.stringify(m);
  };
  beforeEach(() => {
    asked = [];
    down = undefined;
    shut = undefined;
    weekend = false;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      asked.push(url);
      if (down?.test(url)) return new Response("", { status: 503 });
      if (url.includes("geopf.fr")) {
        expect(JSON.parse(String(init?.body)).resource).toBe("ign_rge_alti_wld");
        return new Response(fixture("traces/ign_le-bloc-piton-des-neiges.json"));
      }
      if (url.includes("/5/query") && url.includes("WS_NomIti+IN")) {
        const t = JSON.parse(fixture("traces/onf_le-bloc-piton-des-neiges.json"));
        for (const f of t.features) if (weekend) Object.assign(f.attributes, { WS_Statut: "Sentier fermé", WS_InfCaus: "Fermé du lundi au vendredi, ouvert le week-end", WS_InfDate: "02/01/27" });
        return new Response(JSON.stringify(t));
      }
      if (url.includes("/5/query")) return new Response(map());
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
    expect(b.resume).toMatch(/^Sentier du Piton des Neiges \(OpenStreetMap\) : 7,8 km, \d+ m de dénivelé positif\u00a0; tronçons suivis par l'ONF ouverts\u00a0; trace GPS https:\/\/rundata\.re\/randonnees\/sentier-du-piton-des-neiges\.gpx\./);
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

  it("says a trail open on a Saturday when its notice opens it on weekends, citing it, and closed on a Monday", async () => {
    weekend = true;
    const t = sentier("le-bloc-piton-des-neiges")!;
    const saturday = await buildTrail(cache(), t, NOW);
    expect(saturday).toMatchObject({ etat: "Ouvert aujourd'hui d'après l'avis de l'ONF : « Fermé du lundi au vendredi, ouvert le week-end »", ferme: false });
    expect(await trailGpx(cache(), "https://rundata.re", t, NOW)).toContain(" : ouvert aujourd'hui d'après l'avis de l'ONF (« Fermé du lundi au vendredi, ouvert le week-end »).");
    const monday = new Date("2026-10-26T04:00:00Z");
    expect(await buildTrail(cache(), t, monday)).toMatchObject({ etat: "Fermé : Fermé du lundi au vendredi, ouvert le week-end (02/01/27)", ferme: true });
  });

  it("warns first, everywhere, when a hike crosses a closed trail", async () => {
    shut = /^Le Bloc - Piton des Neiges$/;
    const bloc = "Le Bloc - Piton des Neiges";
    const r2 = RANDONNEES.find((r) => r.slug === "gr-r2")!;
    expect(r2.sentiers_onf).toContain(bloc);

    // The tool: the closure opens the summary, and has its own field.
    const b = body(await sentiersRandonnee(cache(), "la trace du GR R2", NOW));
    expect(b.resume).toMatch(/^ATTENTION : GR R2 emprunte \d+ sentiers? fermés? : .*Le Bloc - Piton des Neiges \(Éboulement\)/);
    expect(b.avertissement.sentiers_fermes).toContainEqual({
      sentier: bloc, cause: "Éboulement", reouverture: "Réouverture prévue le 15/11/2026",
      page: "https://rundata.re/sentiers/le-bloc-piton-des-neiges", randonnees: ["GR R2"],
    });

    // The GPX: a waypoint where the hike enters the closed trail, before the track.
    const g = await (await handle(new Request("https://rundata.re/randonnees/gr-r2.gpx"), cache())).text();
    const start = portionsOf(r2, bloc)[0][0];
    expect(g).toContain(`<wpt lat="${start.lat}" lon="${start.lon}"><ele>${start.ele}</ele><name>FERMÉ : Le Bloc - Piton des Neiges – Éboulement</name>` +
      `<desc>Sentier fermé d'après la carte de l'ONF : Éboulement (Réouverture prévue le 15/11/2026). S'y engager est interdit.</desc><sym>Danger Area</sym><type>danger</type></wpt>`);
    expect(g.indexOf("<wpt")).toBeLessThan(g.indexOf("<trk>"));

    // The hike's page: a red band above the map and the download, the closed stretch drawn on the map.
    const page = await (await handle(new Request("https://rundata.re/randonnees/gr-r2", BOT), cache())).text();
    expect(page).toContain("Attention\u00a0: ");
    expect(page).toMatch(/<li><a href="\/sentiers\/le-bloc-piton-des-neiges">Le Bloc - Piton des Neiges<\/a>\u00a0: Éboulement · Réouverture prévue le 15\/11\/2026<\/li>/);
    expect(page.indexOf("alarm-band")).toBeLessThan(page.indexOf("Télécharger le GPX"));
    expect(page.indexOf("alarm-band")).toBeLessThan(page.indexOf(`<svg class="map terrain zoom"`));
    expect(page).toContain(`<path class="trk ferme"`);
    expect(page).toContain(`<a href="/randonnees">Randonnée</a>`);

    // The hikers' page: the card says it, and the closures are listed above the hikes.
    const hub = await (await handle(new Request("https://rundata.re/randonnees", BOT), cache())).text();
    const card = hub.slice(hub.indexOf(`<a href="/randonnees/gr-r2">GR R2</a></h3>`) - 300, hub.indexOf(`href="/randonnees/gr-r2.gpx"`));
    expect(card).toContain(`class="card hike closed"`);
    expect(card).toContain(`<a href="/sentiers/le-bloc-piton-des-neiges">Le Bloc - Piton des Neiges</a>\u00a0: Éboulement`);
    expect(hub).toMatch(/\d+ itinéraires coupés par une fermeture<\/h3>/);

    // The closures' page: the closed trail with the hikes it cuts.
    const list = await (await handle(new Request("https://rundata.re/sentiers", BOT), cache())).text();
    expect(list).toMatch(/Coupe\u00a0: (<a href="\/randonnees\/[a-z0-9-]+">[^<]+<\/a>, )*<a href="\/randonnees\/gr-r2">GR R2<\/a>/);
    expect(list).toContain(`<a class="btn sun" href="/randonnees">`);
  });

  it("finds hikes by length and climb around a place", async () => {
    const b = body(await sentiersRandonnee(cache(), "Cilaos", NOW, { longueur_min_km: 5, longueur_max_km: 15 }));
    for (const r of b.autour.randonnees_avec_trace ?? []) expect(r.longueur_km).toBeGreaterThanOrEqual(5);
    for (const s of b.autour.sentiers_ouverts) expect(s.longueur_km).toBeLessThanOrEqual(15);
    expect(b.autour.sentiers_ouverts.length).toBeGreaterThan(0);
    const island = body(await sentiersRandonnee(cache(), undefined, NOW, { denivele_max_m: 300 }));
    expect(island.randonnees_avec_trace.every((r: { denivele_positif_m: number }) => r.denivele_positif_m <= 300)).toBe(true);
    expect(island.sentiers_ouverts.every((s: { denivele_positif_m: number }) => s.denivele_positif_m <= 300)).toBe(true);
  });

  it("puts each trail in its area", () => {
    expect(secteur(55.424, -21.069).secteur).toBe("Mafate");
    expect(secteur(55.388, -21.07).secteur).toBe("Hauts de l'Ouest");
    expect(secteur(55.475, -21.13).secteur).toBe("Cilaos");
    expect(secteur(55.7, -21.23).secteur).toBe("Volcan");
    expect(secteur(55.45, -20.9).secteur).toBe("Nord");
  });

  it("shows every hike and trail on the hikers' page, light enough for a phone", async () => {
    const res = await handle(new Request("https://rundata.re/randonnees", BOT), cache());
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("<h1>Randonnée à La Réunion");
    expect(page).toContain(`<svg id="hmap" class="map terrain hikes"`);
    expect(page.match(/<path class="rte"/g)).toHaveLength(RANDONNEES.length);
    expect(page).toContain(`<form id="rf" class="card filter" hidden`);
    expect(page.match(/<details class="card sect">/g)!.length).toBeGreaterThanOrEqual(8);
    // Every hike and trail is in the list, with what the filter reads.
    expect(page.match(/<li class="card hike/g)).toHaveLength(RANDONNEES.length);
    expect(page).toMatch(/<li data-k="s\d+" data-km="[\d.]+" data-dp="\d*" data-e="[ofi]" data-b="[01]"><span><a href="\/sentiers\//);
    expect(page.length).toBeLessThan(300_000);
  });

  it("says when the ONF does not answer, rather than a file without its state", async () => {
    down = /arcgis/;
    const res = await handle(new Request("https://rundata.re/sentiers/le-bloc-piton-des-neiges.gpx"), cache());
    expect(res.status).toBe(503);
  });

  it("gives every trail and every route its sector, computed with the traces", () => {
    const names = new Set(SECTEURS_RANDO.map((x) => x.nom));
    for (const t of Object.values(SENTIERS)) expect(names.has(t.secteur!)).toBe(true);
    expect(SENTIERS["Aurère - Îlet à Malheur"].secteur).toBe("Mafate");
    expect(SENTIERS["Le Bloc - Piton des Neiges"].secteur).toBe("Cilaos");
    // A crossing of the island has no sector of its own, but the ones it runs through.
    const r2 = RANDONNEES.find((r) => r.slug === "gr-r2")!;
    expect(r2.secteur).toBeUndefined();
    expect(r2.secteurs).toEqual(expect.arrayContaining(["Mafate", "Volcan"]));
    expect(RANDONNEES.find((r) => r.slug === "gr-r3")!.secteur).toBe("Mafate");
  });

  it("has a page per sector, its closed trails first, linked from the hikers' page", async () => {
    shut = /^Aurère - Îlet à Malheur$/;
    const res = await handle(new Request("https://rundata.re/randonnees/mafate", BOT), cache());
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("<title>Randonnée Mafate\u00a0: traces GPS et sentiers ouverts · 974</title>");
    expect(page).toContain("<h1>Randonnée à Mafate</h1>");
    expect(page).toContain(`<li><a href="/randonnees">Randonnée</a></li><li aria-current="page">Mafate</li>`);
    // The map of the day has 4 closed there; the one closed here is among them, with why.
    expect(page).toContain(`id="h-fermes">5 sentiers fermés à Mafate</h2>`);
    expect(page).toContain(`<li><a href="/sentiers/aurere-ilet-a-malheur">Aurère - Îlet à Malheur</a>\u00a0: Éboulement · Réouverture prévue le 15/11/2026</li>`);
    expect(page).toContain(`href="/randonnees/gr-r3"`);
    expect(page).toContain("ravitaillés par hélicoptère");
    expect(page).toContain(`<a href="/randonnees/mafate" aria-current="page">Mafate</a>`);
    expect((await handle(new Request("https://rundata.re/randonnees/nulle-part", BOT), cache())).status).toBe(404);
    const hub = await (await handle(new Request("https://rundata.re/randonnees", BOT), cache())).text();
    expect(hub).toContain(`<a href="/randonnees/sud-sauvage">Sud sauvage</a>`);
  });

  it("says a trail's sector in its title, its trail and its first sentence", async () => {
    const page = await (await handle(new Request("https://rundata.re/sentiers/aurere-ilet-a-malheur", BOT), cache())).text();
    expect(page).toContain("<title>Aurère - Îlet à Malheur (Mafate)\u00a0: trace GPX, état ONF · 974</title>");
    expect(page).toContain(`<li><a href="/randonnees/mafate">Mafate</a></li><li aria-current="page">Aurère - Îlet à Malheur</li>`);
    expect(page).toMatch(/<p class="lead part-of">Sentier de l'ONF à Mafate, sur le <a href="\/randonnees\/gr-r2">GR R2<\/a> et le <a href="\/randonnees\/gr-r3">GR R3<\/a>\./);
  });
});

describe("a trail's altitudes from the IGN", () => {
  let ign: number;
  // The ONF's trace with its first point moved by about 10 m, as when the ONF redraws a trail.
  let moved: boolean;
  beforeEach(() => {
    ign = 0;
    moved = false;
    vi.stubGlobal("fetch", async (url: string) => {
      const u = new URL(url);
      if (u.hostname === "data.geopf.fr") {
        ign++;
        return new Response(fixture("traces/ign_le-bloc-piton-des-neiges.json"));
      }
      if (u.pathname.endsWith("/FeatureServer/5/query")) {
        const t = JSON.parse(fixture("traces/onf_le-bloc-piton-des-neiges.json"));
        if (moved) t.features[0].geometry.paths[0][0][0] += 0.0001;
        return new Response(JSON.stringify(t));
      }
      return new Response("", { status: 404 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  // The Worker's KV, with the time each entry was asked to live.
  const kv = () => {
    const entries = new Map<string, { value: string; ttl?: number }>();
    const binding: KvBinding = {
      get: async (k) => (entries.has(k) ? JSON.parse(entries.get(k)!.value) : null),
      put: async (k, value, o) => void entries.set(k, { value, ttl: o?.expirationTtl }),
    };
    return { entries, binding };
  };
  // A data center: its own memory, KV shared with the others.
  const center = (k: KvBinding) => new Cache(new MemoryStore(), () => NOW.getTime(), false, new KvStore(k));
  const T = sentier("le-bloc-piton-des-neiges")!;
  const ign_keys = (k: ReturnType<typeof kv>) => [...k.entries.keys()].filter((x) => x.startsWith("lecture:ign:"));

  it("are kept a year in KV under the trace's fingerprint, and another data center reads them there", async () => {
    const k = kv();
    const first = (await traceOnf(center(k.binding), T)).value;
    expect(ign).toBe(1);
    expect(first.troncons[0].points[0].ele).toBe(1371.5);
    const [key] = ign_keys(k);
    expect(key).toMatch(/^lecture:ign:le-bloc-piton-des-neiges:[0-9a-f]{16}$/);
    expect(k.entries.get(key)!.ttl).toBe(ALTI_SECONDS);
    expect(ALTI_SECONDS).toBe(365 * 86400);
    const second = (await traceOnf(center(k.binding), T)).value;
    expect(ign).toBe(1);
    expect(second.troncons[0].points.map((p) => p.ele)).toEqual(first.troncons[0].points.map((p) => p.ele));
  });

  it("are read again once when the ONF changes the trace, under another key", async () => {
    const k = kv();
    await traceOnf(center(k.binding), T);
    moved = true;
    await traceOnf(center(k.binding), T);
    await traceOnf(center(k.binding), T);
    expect(ign).toBe(2);
    expect(ign_keys(k)).toHaveLength(2);
  });

  it("leave KV's three days to the other entries", async () => {
    const k = kv();
    await center(k.binding).island("feux:ile", 1800, async () => [1]);
    await new KvStore(k.binding).put("arome:x", { value: 1, fetchedAt: NOW.getTime() });
    expect(k.entries.get("lecture:feux:ile")!.ttl).toBe(KV_KEEP_SECONDS);
    expect(k.entries.get("arome:x")!.ttl).toBe(KV_KEEP_SECONDS);
    expect(KV_KEEP_SECONDS).toBe(3 * 24 * 3600);
  });
});
