import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WITH_PAGE } from "../src/web/categories.js";
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
    expect(menu(page).slice(0, 3)).toEqual(["agenda", "sentiers", "meteo"]);
    expect(menu(page).slice(-3)).toEqual(["communes", "mer", "bus"]);
  });

  it("puts the vigilance first while it is above green, the volcano first while in alert, both when both are", () => {
    expect(bar(meteoPage(O, null, NOW, VIGILANCE))).toEqual(["vigilance", "agenda", "sentiers", "meteo", "communes"]);
    expect(bar(withVolcan(VOLCAN, () => meteoPage(O, null, NOW)))).toEqual(["volcan", "agenda", "sentiers", "meteo", "communes"]);
    const both = withVolcan(VOLCAN, () => meteoPage(O, null, NOW, VIGILANCE));
    expect(bar(both)).toEqual(["vigilance", "volcan", "agenda", "sentiers", "meteo", "communes"]);
    expect(menu(both).slice(0, 5)).toEqual(["vigilance", "volcan", "agenda", "sentiers", "meteo"]);
    // The home page shows the volcano's alert itself, without the banner: the bar still has it first.
    expect(bar(withVolcan(VOLCAN, () => homePage(O, null, NOW)))[0]).toBe("volcan");
  });

  it("keeps every page in the menu, quiet or not", () => {
    const all = [...WITH_PAGE.map((c) => c.key), "communes"].sort();
    for (const page of [meteoPage(O, null, NOW), withVolcan(VOLCAN, () => meteoPage(O, null, NOW, VIGILANCE))]) {
      expect([...menu(page)].sort()).toEqual(all);
    }
  });

  it("orders the home page's tiles as the menu, those without a page after them", () => {
    const quiet = homePage(O, null, NOW);
    expect(tiles(quiet).slice(0, 3)).toEqual(["agenda", "sentiers", "meteo"]);
    expect(tiles(quiet).slice(-4)).toEqual(["mer", "bus", "services", "terrain"]);
    expect(tiles(homePage(O, null, NOW, VIGILANCE))[0]).toBe("vigilance");
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
