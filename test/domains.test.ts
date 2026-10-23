import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cached } from "../src/cache.js";
import { Cache, MemoryStore } from "../src/cache.js";
import * as transit from "../src/providers/transit.js";
import { buildBus } from "../src/web/data.js";
import { airPage, busPage, calendrierPage, electricitePage, volcanPage } from "../src/web/domains.js";
import { homePage } from "../src/web/home.js";
import { DESCRIPTION_MAX } from "../src/web/pages.js";
import { site } from "../src/web/site.js";

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
    expect(pages.volcan).toContain("Pas d'éruption en cours");
    expect(pages.volcan).toContain("Accès à l'Enclos : <b>partiellement ouvert</b>");
    expect(pages.air).toMatch(/<p class="big">moyen<\/p>/);
    expect(pages.air).toContain("var(--aq2)"); // the map, coloured by commune
    expect(pages.air).toContain("L&#39;Etang-Salé");
    expect(pages.electricite).toContain(`<span class="big">43 %</span>`);
    expect(pages.electricite).toContain("bioénergies (bagasse, biomasse, biogaz)");
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
    };
    const page = homePage(ORIGIN, live, NOW);
    const tile = (name: string) => page.match(new RegExp(`<h3><a href="/[a-z]+">${name}</a></h3>(.*?)</li>`))![1];
    expect(tile("Volcan")).toContain(`<p class="tv">Pas d'éruption</p>`);
    expect(tile("Volcan")).toContain("Enclos partiellement ouvert");
    expect(tile("Air")).toContain(`<span class="aq aq2">moyen</span>`);
    expect(tile("Électricité")).toContain(`<p class="tv">43\u202f% renouvelable</p>`);
    expect(tile("Calendrier")).toContain(`<p class="tv">Vacances scolaires</p>`);
    expect(tile("Calendrier")).toContain("Toussaint dans 9 j");
    // A time, not « dans 3 min »: the page may be a few minutes old.
    expect(tile("Bus")).toMatch(/<p class="tv">(demain )?\d+h\d\d<\/p><p class="td">prochain départ de la gare de Saint-/);
    // Those without a page give a question to ask.
    expect(page).toContain("« La mairie de Saint-Paul est ouverte ? »");
    // The sample exchange takes its answer from the data of the moment.
    expect(page).toMatch(/<p class="bubble ai">(Non, pas d'éruption|Ligne |\d+\u202f% de sources)/);
  });
});

describe("routes", () => {
  beforeEach(() => vi.stubGlobal("fetch", async () => new Response("down", { status: 503 })));
  afterEach(() => vi.unstubAllGlobals());

  it("serve each domain page, without its live block when the source is down", async () => {
    for (const path of ["/meteo", "/volcan", "/air", "/electricite", "/calendrier", "/bus", "/volcan/"]) {
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
    expect(text).toContain(`<p class="tv">Pas d'éruption</p>`);
    expect(text).toContain(`<p class="tv">25\u202f°C</p>`); // the sea, from the weather's copy
    // The tiles never built come first: one of them is being built, the volcano's copy is left as it is.
    expect(pending.length).toBe(1);
    await Promise.all(pending);
    expect((await store.get("web:volcan"))!.fetchedAt).toBe(at(30).fetchedAt);
  });
});
