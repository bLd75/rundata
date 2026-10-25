import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as transit from "../src/providers/transit.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { departures, findStops, searchStops, stopPageDepartures, tripRun } from "../src/tools/transports.js";
import { searchPage, SEARCH_MAX, stopPage } from "../src/web/arret.js";
import { busPage } from "../src/web/domains.js";
import { site } from "../src/web/site.js";
import { tripGonePage, tripPage } from "../src/web/trajet.js";

// The rows of the database for Saint-Pierre's bus station, as in test/transports.test.ts (GTFS of 23/10/2026).
const rows = JSON.parse(readFileSync(new URL("./fixtures/transit/rows.json", import.meta.url), "utf8")) as Record<
  string,
  { passes?: { id: number }[]; patterns?: { id: number }[]; pattern_stops?: { id: number }[] }
>;
const fake: transit.TransitDb = {
  all: async <T>(sql: string, keys: unknown) =>
    (JSON.parse(String(keys)) as [string, number][]).flatMap(([feed, id]) =>
      (/FROM passes/.test(sql) ? rows[feed]?.passes : /FROM pattern_stops/.test(sql) ? rows[feed]?.pattern_stops : rows[feed]?.patterns)
        ?.filter((r) => r.id === id).map((r) => ({ feed, ...r })) ?? [],
    ) as T[],
};
// Friday 23/10/2026, 7h30 in La Réunion.
const NOW = new Date("2026-10-23T03:30:00Z");
const O = "https://rundata.re";
const station = () => transit.pageOfStop(findStops("gare routière Saint-Pierre").groups.find((g) => g.reseau === "carjaune")!.ids[0])!;

beforeEach(() => transit.configure(fake));
afterEach(() => transit.configure(undefined));

describe("the stop pages", () => {
  it("are one per name and commune, all networks together, and fewer than 1 000 of them are indexed", () => {
    const pages = [...transit.stopPages().values()];
    expect(pages.length).toBeGreaterThan(4000);
    const indexed = pages.filter((p) => p.indexe);
    // The sitemap holds them: more would read as thin content (scripts/build-transit.py, INDEX_LINES and INDEX_PASSES).
    expect(indexed.length).toBeGreaterThan(300);
    expect(indexed.length).toBeLessThan(1000);
    expect(new Set(pages.map((p) => p.slug)).size).toBe(pages.length);
    const p = station();
    expect(p.slug).toBe("saint-pierre/gare-de-saint-pierre");
    expect(p.indexe).toBe(true);
    expect(transit.pageOfStop(-1)).toBeUndefined();
    expect(transit.pageOfStop(1e9)).toBeUndefined();
  });

  it("give the next buses of all lines, each leading to its trip with this stop chosen, and the lines in the description", async () => {
    const p = station();
    const d = await stopPageDepartures(p.groups, NOW);
    expect(d.departs.length).toBeGreaterThan(2);
    expect(d.departs[0].trajet).toMatch(/^\/bus\/trajet\/carjaune\/\d+\/[^?]+\?jour=20261023&arret=\d+#arret-\d+$/);
    expect(d.lignes).toContain("S2");
    const html = stopPage(O, p, d, NOW);
    expect(html).toContain("<title>Arrêt Gare de St-Pierre : prochains bus · 974</title>");
    expect(html).toContain("<h1>Arrêt Gare de St-Pierre</h1>");
    expect(html).toContain("Les prochains bus qui passent à cet arrêt, toutes lignes et tous réseaux confondus. Chaque départ mène à son parcours, arrêt par arrêt.");
    // Car Jaune's and Alternéo's stops of that name, one page. (The French spacing of the page comes at the response: typo.ts.)
    expect(html).toContain(`<p class="lead">Saint-Pierre · Car Jaune : Gare de St-Pierre · Alternéo : `);
    const description = html.match(/<meta name="description" content="([^"]*)">/)![1];
    expect(description.replace(/&#39;/g, "'").length).toBeLessThanOrEqual(160);
    // Its name says its commune: the commune goes before the lines do.
    expect(description).toMatch(/^Prochains bus à l&#39;arrêt Gare de St-Pierre, tous réseaux\u00a0: lignes [^,]+(, [^,]+)*( et \d+ autres)?, (directions et heures de passage, )?d&#39;après les horaires et les annonces en direct( de Car Jaune et Alternéo)?\.$/);
    expect(html).toContain(`<link rel="canonical" href="${O}/bus/arret/saint-pierre/gare-de-saint-pierre">`);
    expect(html).not.toContain(`content="noindex"`);
    expect(html).toContain("Sinon, horaires théoriques publiés par chaque réseau, sans les retards ni les déviations. Mis à jour à 07:30.");
  });

  it("are not indexed below the threshold, and say the commune unless the name has it", async () => {
    const quiet = [...transit.stopPages().values()].find((p) => !p.indexe && p.groups[0].reseau === "carjaune" && !transit.expand(p.nom).includes(transit.expand(p.commune)))!;
    const lignes = Array.from({ length: 30 }, (_, i) => `L${i + 1}`);
    const html = stopPage(O, quiet, { departs: [], alertes: [], lignes, direct: [], sources: [transit.SOURCE] }, NOW);
    // As many lines as its 160 signs allow, then how many more.
    const description = html.match(/<meta name="description" content="([^"]*)">/)![1];
    expect(description.replace(/&#39;/g, "'").length).toBeLessThanOrEqual(160);
    expect(description).toMatch(/: lignes L1(, L\d+)* et \d+ autres, (directions et heures de passage, )?d&#39;après les horaires/);
    expect(html).toContain(`<meta name="robots" content="noindex">`);
    expect(html).toContain(`<title>Arrêt ${quiet.nom}, ${quiet.commune} : prochains bus · 974</title>`.replace(/'/g, "&#39;"));
    expect(html).toContain("Pas de départ prévu dans les prochaines heures.");
  });
});

describe("the search for a stop", () => {
  it("finds the stops by their name, within a commune when given, never the stops near a place", () => {
    expect(searchStops("gare routière Saint-Pierre").map((p) => p.slug)).toContain("saint-pierre/gare-de-saint-pierre");
    const mairies = searchStops("mairie");
    expect(mairies.length).toBeGreaterThan(SEARCH_MAX);
    expect(searchStops("mairie Le Tampon").every((p) => p.commune === "Le Tampon")).toBe(true);
    expect(searchStops("plage de l'Hermitage zzz")).toEqual([]);
    expect(searchStops("xqzw")).toEqual([]);
  });

  it("lists the stops to choose from, the first 20, or says what to type; never indexed", () => {
    const html = searchPage(O, "mairie", searchStops("mairie"));
    expect(html).toMatch(/<h2>\d+ arrêts pour « mairie » : choisissez le vôtre<\/h2>/);
    expect(html.match(/<li><span><a href="\/bus\/arret\//g)).toHaveLength(SEARCH_MAX);
    expect(html).toContain(`Les ${SEARCH_MAX} premiers sont affichés : ajoutez la commune pour affiner.`);
    expect(html).toContain(`<meta name="robots" content="noindex">`);
    expect(html).toContain(`value="mairie"`);
    expect(searchPage(O, "xqzw", [])).toContain("Aucun arrêt de bus trouvé pour « xqzw ». Donnez le nom de l'arrêt et sa commune (« Gare routière, Saint-Pierre »).");
  });

  it("goes straight to the stop when one answers, works without a script, and sends an empty search back to /bus", async () => {
    const cache = new Cache(new MemoryStore(), () => NOW.getTime());
    const get = (path: string) => site(new Request(`${O}${path}`), cache, () => {}, NOW);
    const one = searchStops("gare de saint pierre car jaune");
    expect(one).toHaveLength(1);
    const r = (await get(`/bus/arret?q=${encodeURIComponent("gare de saint pierre car jaune")}`))!;
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`/bus/arret/${one[0].slug}`);
    expect((await get("/bus/arret?q="))!.headers.get("location")).toBe("/bus");
    expect((await get("/bus/arret/nulle-part/rien"))!.status).toBe(404);
    const page = (await get("/bus/arret/saint-pierre/gare-de-saint-pierre"))!;
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<h1>Arrêt Gare de St-Pierre</h1>");
    // The form on /bus, a plain GET.
    const bus = busPage(O, null, NOW);
    expect(bus).toContain(`<form class="card filter" role="search" action="/bus/arret" method="get"><label class="q">Arrêt de bus <input name="q" type="search" placeholder="Mairie, Le Tampon"`);
    expect(bus).toContain(`<button class="btn sun" type="submit">Chercher</button>`);
  });
});

describe("the trip's links to the stops", () => {
  it("lead each stop of a trip to its page, and an old link to the stop it named", async () => {
    const CJ = transit.NETWORKS.carjaune;
    const withStops = new Set(rows[CJ.stops_feed!].pattern_stops!.map((r) => CJ.first_pattern + r.id));
    const d = (await departures(findStops("gare routière Saint-Pierre").groups, NOW)).find((x) => x.reseau === "carjaune" && withStops.has(x.pattern))!;
    const t = (await tripRun("carjaune", d.pattern - CJ.first_pattern, d.trip, 20261023, NOW))!;
    const html = tripPage(O, "/x", t, d.stop, NOW);
    expect(html).toContain(`<a href="/bus/arret/saint-pierre/gare-de-saint-pierre">Gare de St-Pierre</a>`);
    expect(html.match(/<span><a href="\/bus\/arret\//g)).toHaveLength(t.arrets!.length);
    const gone = tripGonePage(O, "/x", "carjaune", undefined, false, station());
    expect(gone).toContain(`<a href="/bus/arret/saint-pierre/gare-de-saint-pierre">Prochains bus à Gare de St-Pierre →</a>`);
  });
});
