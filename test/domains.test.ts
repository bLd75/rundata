import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cached } from "../src/cache.js";
import { Cache, MemoryStore } from "../src/cache.js";
import * as transit from "../src/providers/transit.js";
import * as annuaire from "../src/providers/annuaire.js";
import { communePage } from "../src/web/commune.js";
import { buildBus, communeStops, type CommuneData, type TraficAnswer } from "../src/web/data.js";
import { airPage, busPage, calendrierPage, electricitePage, volcanPage } from "../src/web/domains.js";
import { homePage } from "../src/web/home.js";
import { DESCRIPTION_MAX } from "../src/web/pages.js";
import { pageOf } from "../src/web/places.js";
import { site } from "../src/web/site.js";
import { deadAnchors, doubleIds, mapLinks } from "./cartes.js";

const NOW = new Date("2026-10-23T14:40:00Z");
const ORIGIN = "https://rundata.re";
// The tools' answers of 23/10/2026, as the pages get them.
const answer = (tool: string) => JSON.parse(readFileSync(new URL(`./fixtures/pages/${tool}.json`, import.meta.url), "utf8"));
const cached = <T>(value: T): Cached<T> => ({ value, fetchedAt: new Date(NOW.getTime() - 60_000), stale: false }) as Cached<T>;

const desc = (html: string) => html.match(/name="description" content="([^"]*)"/)![1].replace(/&#39;|&amp;|&quot;/g, "'");
const jsonld = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);

// By feed, as scripts/build-transit.py writes them to the database.
const rows = JSON.parse(readFileSync(new URL("./fixtures/transit/rows.json", import.meta.url), "utf8")) as Record<
  string,
  { passes: { id: number }[]; patterns: { id: number }[] }
>;
const fake: transit.TransitDb = {
  all: async <T>(sql: string, keys: unknown) =>
    (JSON.parse(String(keys)) as [string, number][]).flatMap(([feed, id]) =>
      (/FROM passes/.test(sql) ? rows[feed]?.passes : rows[feed]?.patterns)?.filter((r) => r.id === id).map((r) => ({ feed, ...r })) ?? [],
    ) as T[],
};

describe("domain pages", () => {
  const pages = {
    volcan: volcanPage(ORIGIN, cached(answer("volcan_seismes")), NOW),
    air: airPage(ORIGIN, cached(answer("qualite_air")), NOW),
    electricite: electricitePage(ORIGIN, cached(answer("electricite")), NOW),
    calendrier: calendrierPage(ORIGIN, cached(answer("calendrier")), NOW),
  };

  it("show what the tool answers right now", () => {
    expect(pages.volcan).toContain("L&#39;OVPF et la préfecture n&#39;ont pas annoncé d&#39;éruption dans les textes que nous avons lus.");
    expect(pages.volcan).toContain(`Enclos : <b>« réouverture partielle »</b> selon le <a href="https://www.reunion.gouv.fr/x">communiqué de la préfecture du 07/05</a>.`);
    expect(pages.air).toMatch(/<p class="big">moyen<\/p>/);
    expect(pages.air).toContain("var(--aq2)"); // the map without a measure: the forecast, a dot in each commune
    // Each coloured commune leads to its line in the list.
    expect(mapLinks(pages.air).length).toBeGreaterThan(20);
    expect(mapLinks(pages.air)[0].label).toMatch(/^[^:]+ : indice \d sur 6, \p{L}[^,]*, voir le détail$/u);
    expect(deadAnchors(pages.air)).toEqual([]);
    expect(doubleIds(pages.air)).toEqual([]);
    expect(pages.air).toContain("L&#39;Etang-Salé");
    // Out of an alert too, high on the page: the OVPF's Facebook page, a link only.
    expect(pages.volcan.replace(/&#39;/g, "'").replaceAll("\u00a0", " ")).toContain(`<p class="lead">L'OVPF publie aussi sur Facebook, que nous ne lisons pas : <a href="https://www.facebook.com/ObsVolcanoPitonFournaise">suivre sa page officielle ↗</a></p>`);
    expect(pages.volcan).not.toContain("facebook.com/plugins");
    expect(pages.electricite).toContain(`<span class="big">100 %</span>`);
    expect(pages.electricite).toContain("bioliquide");
    expect(pages.calendrier).toContain("Prochain jour férié : <b>Toussaint</b>");
    expect(pages.calendrier).toContain("date de reprise pas encore publiée");
    expect(pages.calendrier).not.toContain("reprise le pas encore");
    expect(pages.calendrier).toContain("reprise des cours le <b>lundi 26 octobre 2026</b>");
  });

  it("keep their descriptions within what search engines show, with a breadcrumb", () => {
    for (const page of Object.values(pages)) {
      expect(desc(page).length, desc(page)).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(jsonld(page)[0]["@type"]).toBe("BreadcrumbList");
    }
  });

  it("still explain themselves with no data yet", () => {
    for (const page of [volcanPage(ORIGIN, null, NOW), airPage(ORIGIN, null, NOW), electricitePage(ORIGIN, null, NOW), calendrierPage(ORIGIN, null, NOW), busPage(ORIGIN, null, NOW)]) {
      expect(page).toContain("rechargez la page");
      expect(desc(page).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });
});

describe("bus page", () => {
  beforeEach(() => transit.configure(fake));
  afterEach(() => transit.configure(undefined));

  it("lists the networks and the next departures at the bus stations", async () => {
    const data = await buildBus(NOW);
    expect(data.reseaux.map((r) => r.nom)).toContain("Car Jaune");
    const sp = data.gares.find((g) => g.commune === "Saint-Pierre")!;
    expect(sp.arrets.map((a) => a.reseau).sort()).toEqual(["Alternéo", "Car Jaune", "CarSud"]);
    expect(sp.departs.length).toBeGreaterThan(3);
    const page = busPage(ORIGIN, cached(data), NOW);
    expect(page).toContain("Gare de Saint-Pierre");
    expect(page).toContain("Horaires théoriques");
    // The wait under the direction, as on a stop's page: beside it, a delay announced left the direction 85 px on a phone.
    expect(page).toContain(`<ul class="rows departs"><li><b>`);
    expect(page).not.toContain(`<ul class="rows"><li><b>`);
  });

  it("without the timetables, sends people to the connector", async () => {
    transit.configure(undefined);
    const page = busPage(ORIGIN, cached(await buildBus(NOW)), NOW);
    expect(page).toContain("le prochain bus à la gare de Saint-Pierre");
  });
});

describe("home page tiles", () => {
  beforeEach(() => transit.configure(fake));
  afterEach(() => transit.configure(undefined));

  it("say each category in a few words, from its page's last copy", async () => {
    const live = {
      meteo: null,
      volcan: cached(answer("volcan_seismes")),
      air: cached(answer("qualite_air")),
      electricite: cached(answer("electricite")),
      calendrier: cached(answer("calendrier")),
      bus: cached(await buildBus(NOW)),
      trafic: cached({ bus: null, routes_forestieres: { interdites: [{ route: "RF58" }], principales: [] }, sources: [] } as unknown as TraficAnswer),
    };
    const page = homePage(ORIGIN, live, NOW);
    const tile = (name: string) => page.match(new RegExp(`<h3><a href="/[a-z]+">${name}</a></h3>(.*?)</li>`))![1];
    expect(tile("Volcan")).toContain(`<p class="tv">Pas d'éruption annoncée</p>`);
    expect(tile("Volcan")).toContain("OVPF et préfecture, textes lus à ");
    expect(tile("Volcan")).toContain("Enclos : « réouverture partielle » (préfecture, 07/05)");
    expect(tile("Air")).toContain(`<span class="aq aq2">moyen</span>`);
    expect(tile("Électricité")).toContain(`<p class="tv">100\u202f% renouvelable</p>`);
    expect(tile("Calendrier")).toContain(`<p class="tv">Vacances scolaires</p>`);
    expect(tile("Calendrier")).toContain("Toussaint dans 9 j");
    // The Région's official map; Waze only on /trafic, beside its own map.
    expect(tile("Circulation").replaceAll("\u00a0", " ")).toContain(`<p class="tv">Carte officielle</p><p class="td all">bouchons, accidents et travaux : infotrafic.re ; 1 route forestière fermée</p>`);
    expect(page).not.toMatch(/waze/i);
    // A time, not « dans 3 min »: the page may be a few minutes old.
    expect(tile("Bus")).toMatch(/<p class="tv">(demain )?(\d\d:\d\d|\d+\u00a0h)<\/p><p class="td">prochain départ de la gare de Saint-/);
    // Those without a page give a question to ask.
    expect(page).toContain("« La mairie de Saint-Paul est ouverte ? »");
    // The sample exchange takes its answer from the data of the moment.
    expect(page).toMatch(/<p class="bubble ai">(Non, pas d'éruption|Ligne |\d+\u202f% de sources)/);
  });
});

describe("commune page", () => {
  const p = pageOf("saint-pierre")!;
  const mairies = JSON.parse(readFileSync(new URL("./fixtures/annuaire_mairie.json", import.meta.url), "utf8")).results.map(annuaire.office);
  const live = (commune: CommuneData) => ({
    place: null,
    commune: cached(commune),
    air: cached(answer("qualite_air")),
    volcan: cached(answer("volcan_seismes")),
    electricite: cached(answer("electricite")),
    calendrier: cached(answer("calendrier")),
  });
  const tile = (page: string, name: string) => page.match(new RegExp(`<h3>(?:<a href="[^"]+">)?${name}(?:</a>)?</h3>(.*?)</li>`, "s"))![1];

  it("finds the commune's bus station, or the stops near its centre, never Le Port's ferry terminal", () => {
    expect(communeStops(p).gare).toBe(true);
    expect(communeStops(p).groups.map((g) => g.reseau).sort()).toEqual(["alterneo", "carjaune", "carsud"]);
    const port = communeStops(pageOf("le-port")!);
    expect(port.gare).toBe(false);
    expect(port.groups.map((g) => g.nom)).not.toContain("Gare Maritime");
  });

  it("says the air of the commune, its town hall open or closed now, and the departures still to come", () => {
    const departs: NonNullable<CommuneData["bus"]>["departs"] = [
      { heure: "18:30", dans_min: -11, ligne: "S1", direction: "Gare du Tampon", reseau: "Car Jaune", arret: "Gare de St-Pierre" },
      { heure: "18:50", dans_min: 11, ligne: "S2", direction: "St-Joseph", reseau: "Car Jaune", arret: "Gare de St-Pierre" },
    ];
    const velos = [
      { nom: "ZAC Maxime Rivière", commune: "Saint-Pierre", velos_electriques: 6, places_libres: 4, maj: "18:38" },
      { nom: "IUT", commune: "Saint-Pierre", velos_electriques: 0, places_libres: 8, maj: "18:38" },
    ];
    const mairie = { ...mairies[0], horaires: [{ de: "lundi", a: "vendredi", plages: [["08:00", "16:00"]] as [string, string][] }] };
    const page = communePage(ORIGIN, p, live({ mairie, bus: { gare: true, arrets: [], departs }, velos, sources: [] }), NOW);
    expect(tile(page, "Air")).toContain(`<span class="aq aq2">moyen</span>`);
    // 18h40 on a Friday.
    expect(tile(page, "Mairie")).toContain(`<p class="tv">Fermée</p><p class="td">aujourd'hui 8\u00a0h–16\u00a0h`);
    // « Y aller » under its address, from the directory's position, and the sheet once.
    expect(tile(page, "Mairie")).toContain(`<p class="ya"><a class="aller" href="https://www.google.com/maps/dir/?api=1&amp;destination=${mairie.lat},${mairie.lon}" rel="noopener" data-a="${mairie.adresse}"`);
    expect(page.match(/<dialog id="aller"/g)).toHaveLength(1);
    expect(communePage(ORIGIN, p, live({ mairie: { ...mairie, lat: null, lon: null }, bus: { gare: true, arrets: [], departs }, velos, sources: [] }), NOW)).not.toContain('<dialog id="aller"');
    expect(tile(page, "Bus")).toContain(`<p class="tv">18:50</p>`);
    expect(tile(page, "Bus")).toContain("dans 10 min"); // built a minute ago
    expect(tile(page, "Bus")).not.toContain("S1");
    expect(tile(page, "Vélos")).toContain(`<p class="tv">6 vélos</p>`);
    expect(tile(page, "Vélos")).toContain("<li><span>ZAC Maxime Rivière<small><b>6</b>\u00a0vélos · 4\u00a0places</small></span>");
    expect(tile(page, "Volcan")).toContain("Pas d'éruption");
    expect(tile(page, "Soleil et calendrier")).toMatch(/<p class="tv">\d\d:\d\d–\d\d:\d\d<\/p>/);
    expect(desc(page).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(jsonld(page)[0].itemListElement.map((x: { name: string }) => x.name)).toEqual(["rundata.re", "Communes", "Saint-Pierre"]);
    expect(page).not.toMatch(/waze/i);
  });
});

describe("routes", () => {
  beforeEach(() => vi.stubGlobal("fetch", async () => new Response("down", { status: 503 })));
  afterEach(() => vi.unstubAllGlobals());

  it("serve each domain page, without its live block when the source is down", async () => {
    for (const path of ["/meteo", "/volcan", "/air", "/electricite", "/calendrier", "/bus", "/velos", "/volcan/"]) {
      const cache = new Cache(new MemoryStore(), () => NOW.getTime(), false);
      const r = (await site(new Request(`${ORIGIN}${path}`), cache, () => undefined, NOW))!;
      expect(r.status, path).toBe(200);
      expect(await r.text()).toContain(`<link rel="canonical" href="${ORIGIN}${path.replace(/\/$/, "")}">`);
    }
  });

  it("give the home page each tile's last copy, and bring the oldest one up to date afterwards", async () => {
    const cache = new Cache(new MemoryStore(), () => NOW.getTime(), false);
    const at = (minutes: number) => ({ value: answer("volcan_seismes"), fetchedAt: NOW.getTime() - minutes * 60_000 });
    const store = (cache as unknown as { store: MemoryStore }).store;
    await store.put("web:volcan", at(30));
    await store.put("web:meteo", { value: { stations: [], mer: [{ nom: "Plage de Saint-Leu", valeur: 25.2, jour: "2026-10-21", distance_km: 3 }], sources: [], indisponibles: [] }, fetchedAt: NOW.getTime() });
    const pending: Promise<unknown>[] = [];
    const r = (await site(new Request(`${ORIGIN}/`), cache, (p) => pending.push(p), NOW))!;
    const text = await r.text();
    expect(text).toContain(`<p class="tv">Pas d'éruption annoncée</p>`);
    expect(text).toContain(`<p class="tv">25\u202f°C</p>`); // the sea, from the weather's copy
    // The tiles never built come first: one of them is being built, the volcano's copy is left as it is.
    expect(pending.length).toBe(1);
    await Promise.all(pending);
    expect((await store.get("web:volcan"))!.fetchedAt).toBe(at(30).fetchedAt);
  });
});
