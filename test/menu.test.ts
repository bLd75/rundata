import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WITH_PAGE } from "../src/web/categories.js";
import * as enfants from "../src/vie/enfants.js";
import type { Alerte } from "../src/web/data.js";
import { homePage, type HomeLive } from "../src/web/home.js";
import { esc } from "../src/web/map.js";
import { meteoPage, SOCIAL } from "../src/web/pages.js";
import { type VolcanAlerte, withVolcan } from "../src/web/volcan-alerte.js";

const O = "https://rundata.re";
const NOW = new Date("2026-10-25T06:00:00Z");
const VIGILANCE: Alerte = { couleur: 3, texte: "Vigilance Météo-France : orange fortes pluies / orages (Est).", court: { couleur: "orange", phenomenes: ["Fortes pluies / orages"], zones: ["Est : Sainte-Suzanne, Saint-André"] } };
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

describe("the alerts on a phone", () => {
  // The words of the vigilance's line on a page other than /vigilance.
  const said = (a: Alerte) => [...meteoPage(O, null, NOW, a).matchAll(/<a class="ligne" href="[^"]+">(?:<span aria-hidden="true">[^<]+<\/span>)?<span class="txt">(.*?)<\/span><span aria-hidden="true">→/g)].map((m) => m[1]);
  // The HTML of a line's words: the last part kept whole in its own span, the apostrophe escaped. Compared as HTML,
  // never with the tags taken out.
  const frag = (t: string) => {
    const i = t.lastIndexOf(" · ");
    return i < 0 ? esc(t) : `${esc(t.slice(0, i))} <span class="nw">· ${esc(t.slice(i + 3))}</span>`;
  };
  const frags = (ts: string[]) => ts.map(frag);
  const vigilance = (couleur: string, phenomenes: string[], zones: string[]): Alerte => ({ couleur: 2, texte: "Vigilance Météo-France : …", court: { couleur, phenomenes, zones } });
  const LAND = ["Nord : Saint-Denis", "Est : Saint-Benoît", "Sud-Est : Saint-Joseph", "Sud : Saint-Pierre", "Ouest : Saint-Paul"];
  const coasts = (n: number) => Array.from({ length: n }, (_, i) => `Zone côtière ${i}`);

  it("are one line each, stacked without a gap, the vigilance then the volcano, each to its page", () => {
    const home = withVolcan(VOLCAN, () => homePage(O, null, NOW, VIGILANCE));
    const lines = [...home.matchAll(/<a class="ligne" href="([^"]+)"><span aria-hidden="true">([^<]+)<\/span><span class="txt">(.*?)<\/span><span aria-hidden="true">→<\/span>/g)].map((m) => [m[1], m[2], m[3]]);
    expect(lines).toEqual([
      ["/vigilance", "⚠", frag("Vigilance orange pluies-orages · Est")],
      ["/volcan", "🌋", frag("Volcan\u00a0: alerte\u00a01 du préfet · Enclos interdit")],
    ]);
    // The sentences stay on wider screens: only below 600 px the line replaces them, never cut with « … ».
    expect(home).toContain(".ligne{display:none}");
    expect(home).toContain("@media (max-width:599.98px){[data-court]>.wrap,[data-court]>.card{display:none}");
    expect(home).toContain(".ligne .txt{flex:1;min-width:0}");
    expect(home).not.toContain("text-overflow:ellipsis");
    // On two lines, the break comes before the last « · », never inside « Sud-Est » nor « Enclos interdit ».
    expect(home).toContain('<span class="txt">Vigilance orange pluies-orages <span class="nw">· Est</span></span>');
    expect(home).toContain(".ligne .nw{white-space:nowrap}");
    expect(home).toContain(".volcan-une[data-court]{padding:0;max-width:none}");
  });

  it("say the vigilance's colour, two phenomena at most by their short names, and the zones named, counted or whole (marketing)", () => {
    expect(said(vigilance("jaune", ["Fortes pluies / orages"], ["Sud-Est : Saint-Joseph, Saint-Philippe"]))).toEqual(frags(["Vigilance jaune pluies-orages · Sud-Est"]));
    expect(said(vigilance("orange", ["Vents forts"], LAND))).toEqual(frags(["Vigilance orange vents forts · toute l'île"]));
    expect(said(vigilance("jaune", ["Fortes pluies / orages"], LAND.slice(2, 4)))).toEqual(frags(["Vigilance jaune pluies-orages · Sud-Est, Sud"]));
    expect(said(vigilance("jaune", ["Fortes pluies / orages"], LAND.slice(0, 3)))).toEqual(frags(["Vigilance jaune pluies-orages · 3 zones"]));
    expect(said(vigilance("jaune", ["Vagues - submersion"], coasts(3)))).toEqual(frags(["Vigilance jaune vagues-submersion · 3 zones côtières"]));
    expect(said(vigilance("jaune", ["Vagues - submersion"], coasts(1)))).toEqual(frags(["Vigilance jaune vagues-submersion · 1 zone côtière"]));
    expect(said(vigilance("orange", ["Vagues - submersion"], coasts(8)))).toEqual(frags(["Vigilance orange vagues-submersion · toutes les côtes"]));
    expect(said(vigilance("orange", ["Fortes pluies / orages", "Vents forts", "Vagues - submersion"], [LAND[1], ...coasts(2)]))).toEqual(frags(["Vigilance orange pluies-orages, vents forts · Est, 2 zones côtières"]));
  });

  it("give the cyclone alert to the prefect, with the schools closed on a line of their own (marketing)", () => {
    const cyclone = (c: number, prevue = false, ecoles?: boolean): Alerte => ({ couleur: c, texte: "Météo-France : …", ecoles, court: { cyclone: c, prevue } });
    expect(said(cyclone(2))).toEqual(frags(["Pré-alerte cyclonique du préfet"]));
    expect(said(cyclone(3))).toEqual(frags(["Alerte cyclonique orange du préfet"]));
    expect(said(cyclone(4))).toEqual(frags(["Alerte cyclonique rouge du préfet"]));
    expect(said(cyclone(6))).toEqual(frags(["Phase de sauvegarde cyclonique du préfet"]));
    expect(said(cyclone(3, true))).toEqual(frags(["Alerte cyclonique prévue par le préfet"]));
    const schools = meteoPage(O, null, NOW, cyclone(4, false, true));
    expect(said(cyclone(4, false, true))).toEqual(frags(["Alerte cyclonique rouge du préfet", "Écoles et crèches fermées"]));
    expect(schools).toContain('<a class="ligne" href="/ecoles-cyclone"><span class="txt">Écoles et crèches fermées</span><span aria-hidden="true">→</span></a>');
  });
});
