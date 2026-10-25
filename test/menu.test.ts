import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WITH_PAGE } from "../src/web/categories.js";
import * as enfants from "../src/vie/enfants.js";
import type { Alerte } from "../src/web/data.js";
import { homePage, type HomeLive } from "../src/web/home.js";
import { meteoPage, SOCIAL } from "../src/web/pages.js";
import { type VolcanAlerte, withVolcan } from "../src/web/volcan-alerte.js";

const O = "https://rundata.re";
const NOW = new Date("2026-10-25T06:00:00Z");
const VIGILANCE: Alerte = { couleur: 3, texte: "Vigilance Météo-France : orange fortes pluies / orages (Est)." };
const VOLCAN: VolcanAlerte = { niveau: "Alerte 1", eruption: false };

// The keys in the bar on wide screens and in the menu's grid, in their order.
const bar = (html: string) => [...html.match(/<nav class="quick"[^>]*>(.*?)<\/nav>/s)![1].matchAll(/class="k-([a-z]+)"/g)].map((m) => m[1]);
const menu = (html: string) => [...html.match(/<ul class="grid">(.*?)<\/ul>/s)![1].matchAll(/class="k-([a-z]+)"/g)].map((m) => m[1]);
const facts = (html: string) => [...(html.match(/<ul class="facts-live"[^>]*>(.*?)<\/ul>/s)?.[1] ?? "").matchAll(/<li class="k-([a-z]+)"/g)].map((m) => m[1]);
const tiles = (html: string) => [...html.match(/<ul class="tiles"[^>]*>(.*?)<\/ul>/s)![1].matchAll(/<li class="tile k-([a-z]+)/g)].map((m) => m[1]);

describe("the order of the pages", () => {
  it("puts the events, the hikes and the weather in the bar, without the vigilance, the volcano, the sea or the buses when all is quiet", () => {
    const page = meteoPage(O, null, NOW);
    expect(bar(page)).toEqual(["agenda", "sentiers", "meteo", "communes"]);
    expect(page).toContain('<a class="k-sentiers" href="/randonnees">');
    // The children's page right after the events in the menu, not in the bar.
    expect(menu(page).slice(0, 4)).toEqual(["agenda", "enfants", "sentiers", "meteo"]);
    expect(menu(page).slice(-3)).toEqual(["communes", "mer", "bus"]);
  });

  it("puts the vigilance first while it is above green, the volcano first while in alert, both when both are", () => {
    expect(bar(meteoPage(O, null, NOW, VIGILANCE))).toEqual(["vigilance", "agenda", "sentiers", "meteo", "communes"]);
    expect(bar(withVolcan(VOLCAN, () => meteoPage(O, null, NOW)))).toEqual(["volcan", "agenda", "sentiers", "meteo", "communes"]);
    const both = withVolcan(VOLCAN, () => meteoPage(O, null, NOW, VIGILANCE));
    expect(bar(both)).toEqual(["vigilance", "volcan", "agenda", "sentiers", "meteo", "communes"]);
    expect(menu(both).slice(0, 6)).toEqual(["vigilance", "volcan", "agenda", "enfants", "sentiers", "meteo"]);
    // The home page shows the volcano's alert itself, without the banner: the bar still has it first.
    expect(bar(withVolcan(VOLCAN, () => homePage(O, null, NOW)))[0]).toBe("volcan");
  });

  it("keeps every page in the menu, quiet or not", () => {
    const all = [...WITH_PAGE.map((c) => c.key), "communes"].sort();
    for (const page of [meteoPage(O, null, NOW), withVolcan(VOLCAN, () => meteoPage(O, null, NOW, VIGILANCE))]) {
      expect([...menu(page)].sort()).toEqual(all);
    }
  });

  it("orders the home page's tiles as the menu, the traffic and a quiet vigilance and volcano with the sea and the buses at the end", () => {
    const quiet = homePage(O, null, NOW);
    expect(tiles(quiet)).toEqual(["agenda", "enfants", "sentiers", "meteo", "actualites", "historique", "cyclones", "velos", "bornes", "coupures", "dae",
      "secheresse", "sport", "eau", "air", "electricite", "calendrier", "trafic", "vigilance", "volcan", "mer", "bus", "services", "terrain"]);
    // Nothing hidden, and the menu keeps its order.
    expect([...tiles(quiet)].sort()).toEqual([...tiles(homePage(O, null, NOW, VIGILANCE))].sort());
    expect(menu(quiet).slice(-3)).toEqual(["communes", "mer", "bus"]);
  });

  it("puts the home page's vigilance and volcano tiles back first while in force, the other one still at the end", () => {
    const vigilance = tiles(homePage(O, null, NOW, VIGILANCE));
    expect(vigilance.slice(0, 5)).toEqual(["vigilance", "agenda", "enfants", "sentiers", "meteo"]);
    expect(vigilance.slice(-6)).toEqual(["trafic", "volcan", "mer", "bus", "services", "terrain"]);
    const volcan = tiles(withVolcan(VOLCAN, () => homePage(O, null, NOW)));
    expect(volcan.slice(0, 3)).toEqual(["volcan", "agenda", "enfants"]);
    expect(volcan.slice(-6)).toEqual(["trafic", "vigilance", "mer", "bus", "services", "terrain"]);
    const both = tiles(withVolcan(VOLCAN, () => homePage(O, null, NOW, VIGILANCE)));
    expect(both.slice(0, 3)).toEqual(["vigilance", "volcan", "agenda"]);
    expect(both.slice(-5)).toEqual(["trafic", "mer", "bus", "services", "terrain"]);
  });

  it("gives the children's tile the number of places, then the playgrounds, the parks and the pools, with nothing to fetch", () => {
    const tile = homePage(O, null, NOW).match(/<li class="tile k-enfants">(.*?)<\/li>/s)![1];
    expect(tile).toContain('<a href="/enfants">Enfants</a>');
    expect(tile).toContain(`<p class="tv">${enfants.LIEUX.length} lieux</p>`);
    const n = (k: string) => enfants.LIEUX.filter((l) => l.type === k).length;
    expect(tile).toContain(`<p class="td">${n("aire_de_jeux")} aires de jeux · ${n("parc")} parcs et jardins · ${n("piscine")} piscines · …</p>`);
    expect(tile).not.toContain("rechargez la page");
  });

  it("puts the events and the hikes in « En ce moment », the volcano only in alert, never the sea", () => {
    const quiet = { value: JSON.parse(readFileSync(new URL("./fixtures/pages/volcan_seismes.json", import.meta.url), "utf8")), fetchedAt: NOW, stale: false };
    const live = {
      // The sea measured, no station's temperature: the sea is still not in the boxes.
      meteo: { value: { stations: [], mer: [{ nom: "Plage de Saint-Leu", valeur: 25.2, jour: "2026-10-21", distance_km: 3 }], sources: [], indisponibles: [] }, fetchedAt: NOW, stale: false },
      volcan: quiet,
      agenda: { value: { nombre: 42, ce_week_end: [] }, fetchedAt: NOW, stale: false },
      sentiers: { value: { points: [], suivis: 120, randonnees: [] }, fetchedAt: NOW, stale: false },
    } as unknown as HomeLive;
    const page = homePage(O, live, NOW);
    expect(facts(page)).toEqual(["agenda", "sentiers"]);
    expect(page).toContain("<b>42 événements</b>");
    // A volcano in alert in the copy of /volcan: first.
    const etat = { ...quiet.value.etat, niveau_orsec: "Alerte 1" };
    expect(facts(homePage(O, { ...live, volcan: { ...quiet, value: { ...quiet.value, etat } } } as HomeLive, NOW))).toEqual(["volcan", "agenda", "sentiers"]);
  });

  it("gives the boxes of « En ce moment » one height, their content centred, a box alone on its row as wide as the others", () => {
    const page = homePage(O, null, NOW);
    expect(page).toContain(".facts-live{list-style:none;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:1fr;");
    expect(page).toContain(".facts-live li{display:flex}.facts-live a{flex:1;display:grid;");
    expect(page).toContain("align-content:center;");
    expect(page).not.toContain(".facts-live li:last-child");
  });

  it("links rundata.re's accounts from the bar, the menu and the home page's hero, counted as visits from the site", () => {
    const page = meteoPage(O, null, NOW);
    const header = page.match(/<header class="top">(.*?)<\/header>/s)![1];
    const top = header.match(/<nav class="follow-top"[^>]*>(.*?)<\/nav>/s)![1];
    const sheet = header.match(/<nav class="sheet"[^>]*>(.*?)<\/nav>/s)![1];
    const hero = homePage(O, null, NOW).match(/<p class="social hero-follow">(.*?)<\/p>/s)![1];
    for (const s of SOCIAL) {
      const link = `<a href="${s.url}?ref=site" rel="noopener" aria-label="rundata.re sur ${s.nom}">`;
      expect(top).toContain(`${link}${s.svg}</a>`);
      expect(sheet).toContain(`${link}${s.svg}${s.nom}</a>`);
      expect(hero).toContain(`${link}${s.svg}${s.nom}</a>`);
    }
  });
});
