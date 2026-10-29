import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HomeData, StationNow } from "../src/web/data.js";
import { esc, project } from "../src/web/map.js";
import { ALT_PATH, communeOf, METEO_SCRIPT, rainPill, stationsMap, ventText, windPill } from "../src/web/meteo-carte.js";
import { CSS, meteoPage, stationId } from "../src/web/pages.js";

const NOW = new Date("2026-10-22T05:30:00Z");
const at = "2026-10-22T05:18:00Z";

const st = (o: Partial<StationNow> & { nom: string }): StationNow => ({
  source: "meteofrance", lon: 55.5, lat: -21.1, altitude_m: 10, time: at, stale: false, ...o,
});

// Stations of the tour (named on the map) and others (dots), with and without each measure.
const GILLOT = st({ nom: "Saint-Denis Gillot (aéroport)", id: "97418110", lon: 55.528667, lat: -20.892167, altitude_m: 8, temperature: 27.9, vent: 18, direction: 70, rafales: 21, pluie_1h: 0 });
const PLAINE = st({ nom: "Plaine des Cafres", id: "97422440", lon: 55.572833, lat: -21.209167, altitude_m: 1560, temperature: 17.2, vent: 12, direction: 95, pluie_1h: 2.4 });
const BRAS_SEC = st({ nom: "Bras-Sec", id: "97422445", lon: 55.525167, lat: -21.205667, altitude_m: 1210, temperature: 19.1, pluie_1h: 0.4 });
const PLUVIO = st({ nom: "Bélouve", id: "97421260", lon: 55.5365, lat: -21.060833, altitude_m: 1500, pluie_1h: 0 });
const BALISE = st({ nom: "Balise Cambaie", source: "pioupiou", id: "1300", lon: 55.29, lat: -20.98, altitude_m: 20, vent: 22, direction: 200 });
const ALL = [GILLOT, PLAINE, BRAS_SEC, PLUVIO, BALISE];

const links = (html: string) => [...html.matchAll(/<a class="mk([^"]*)" href="([^"]+)"/g)].map((m) => ({ cls: m[1], href: m[2] }));

describe("the wind and the commune of a station", () => {
  it("says where the wind comes from in words, on 8 points, never abbreviated", () => {
    expect(ventText({ ...GILLOT, direction: 70 })).toBe("vent d'est 18 km/h, rafales 21 km/h");
    expect(ventText({ ...GILLOT, direction: 350, rafales: undefined })).toBe("vent du nord 18 km/h");
    expect(ventText({ ...GILLOT, direction: 225 })).toMatch(/^vent du sud-ouest /);
    expect(ventText({ ...GILLOT, direction: 270 })).toMatch(/^vent d'ouest /);
    // Calm: no direction measured, the speed alone.
    expect(ventText({ ...GILLOT, vent: 0, direction: undefined, rafales: undefined })).toBe("vent 0 km/h");
    expect(ventText(PLUVIO)).toBeUndefined();
  });

  it("puts the wind and the rain of a tile in small pills, said in full to a screen reader and on hover", () => {
    const w = windPill(GILLOT);
    // An arrow where the wind goes: from 70°, towards 250°.
    expect(w).toContain(`style="transform:rotate(250deg)"`);
    expect(w).toContain(`18 km/h</span>`);
    expect(w).toContain(`<span class="sr">${esc("vent d'est 18 km/h, rafales 21 km/h")}</span>`);
    expect(windPill({ ...GILLOT, vent: 0, direction: undefined, rafales: undefined })).not.toContain("<svg");
    expect(windPill(PLUVIO)).toBe("");
    expect(rainPill(PLAINE)).toContain(`<span class="pl wet" title="${esc("2,4 mm de pluie dans l'heure")}">`);
    expect(rainPill(GILLOT)).toContain(`<span class="sr">${esc("pas de pluie mesurée depuis 1 h")}</span>`);
    expect(rainPill({ ...GILLOT, pluie_1h: undefined, pluie_6min: 0.2 })).toContain(esc("0,2 mm de pluie en 6 min"));
    expect(rainPill(BALISE)).toBe("");
  });

  it("finds a Météo-France station's commune from its INSEE code, another's from the nearest Météo-France station", () => {
    expect(communeOf(GILLOT, ALL)).toBe("Sainte-Marie");
    expect(communeOf(PLAINE, ALL)).toBe("Le Tampon");
    expect(communeOf(PLUVIO, ALL)).toBe("Salazie");
    // The beacon has no INSEE code: Gillot, the nearest Météo-France station of the list, gives its commune.
    expect(communeOf(BALISE, [GILLOT, PLAINE, BALISE])).toBe("Sainte-Marie");
  });
});

describe("the map of every station on /meteo", () => {
  it("draws one link per station for every measure, each to its row, hidden where the measure shown is missing", () => {
    const html = stationsMap(ALL);
    const l = links(html);
    expect(l.map((x) => x.href).sort()).toEqual(ALL.map((s) => `#${stationId(s.nom)}`).sort());
    expect(html).toContain("les 5 stations météo et leur dernière mesure, à 09:18");
    const of = (href: string) => l.find((x) => x.href === href)!.cls;
    expect(of("#st-plaine-des-cafres")).toBe(" has-t has-p has-v");
    expect(of("#st-belouve")).toBe(" has-p");
    // The wind beacon measures the wind alone: on the map under the wind only.
    expect(of(`#${stationId(BALISE.nom)}`)).toBe(" has-v");
    // The bubble's value for each measure, and the time and source said with the right agreement.
    expect(html).toContain(`data-tvt="${esc("17,2 °C")}"`);
    expect(html).toContain(`data-tvp="${esc("2,4 mm en 1 h")}"`);
    expect(html).toContain(`data-tvp="${esc("pas de pluie mesurée en 1 h")}"`);
    expect(html).toContain(`data-td="${esc("mesurée à 09:18 par Météo-France")}"`);
    expect(html).toContain(esc("Plaine des Cafres · 1 560 m : 17,2 °C, 2,4 mm en 1 h, vent d'est 12 km/h, mesures de 09:18 par Météo-France, voir le détail"));
    expect(ventText(PLAINE)).toBe("vent d'est 12\u202fkm/h");
    expect(html).toContain(`data-tvv="${esc(ventText(PLAINE)!)}"`);
  });

  it("animates the wind between the anemometers in the browser, with the measures on top, and says the movement is no measure", () => {
    const html = stationsMap(ALL);
    expect(html).toContain(`<label for="wxl-v">Vent</label>`);
    // Where each wind goes, in km/h along the map's x and y (y down): from 70°, Gillot's goes west and a little south.
    const [x, y] = project(GILLOT.lon, GILLOT.lat);
    const data = JSON.parse(html.match(/data-vent="([^"]+)"/)![1].replaceAll("&quot;", '"')) as number[][];
    expect(data).toHaveLength(3);
    const g = data.find((d) => d[0] === x && d[1] === y)!;
    expect(g[2]).toBeCloseTo(-18 * Math.sin((70 * Math.PI) / 180), 1);
    expect(g[3]).toBeCloseTo(18 * Math.cos((70 * Math.PI) / 180), 1);
    expect(g[2]).toBeLessThan(0);
    // Two canvases, the speed's veil and the particles, never a picture made in the page.
    expect(html).toContain(`<canvas class="flux" `);
    expect(html).not.toContain("data:");
    // The measure in a pill: an arrow where the wind goes (from 200°, towards 20°) and the speed.
    expect(html).toMatch(/<g class="sh l-v wv">[^]*?rotate\(20\)"\/><text [^>]*>22<\/text><\/g>/);
    expect(html).toContain("3 anémomètres, vent moyen mesuré en km/h, le plus récent à 09:18. La flèche montre où va le vent (un vent d'est vient de l'est). Entre les stations, le mouvement et les couleurs sont <b>estimés</b> à partir des stations voisines : ce n'est pas une mesure.");
    // The rain layer asks the radar's grid when first shown, with a place in its legend for what the radar sees.
    expect(html).toContain(`<canvas class="voile" data-pluie="/meteo/pluie-radar.json" data-alt="${ALT_PATH}" `);
    expect(html).toContain(`Point blanc : pas de pluie mesurée. <span data-radar hidden></span>`);
    // No anemometer: no tab, no canvas, no script data.
    expect(stationsMap([BALISE])).toContain("1 anémomètre, vent moyen");
    const calm = stationsMap([BRAS_SEC, PLUVIO]);
    expect(calm).not.toContain(`id="wxl-v"`);
    expect(calm).not.toContain("data-vent");
  });

  it("writes the values of the tour's stations only, the others as dots told by the bubble", () => {
    const html = stationsMap(ALL);
    expect(html).toContain(`<text class="mv l-t" `);
    expect(html).toMatch(/<text class="mv l-t" [^>]*>28°<\/text>/);
    expect(html).toMatch(/<text class="mv l-t" [^>]*>17°<\/text>/);
    expect(html).not.toMatch(/<text class="mv l-t" [^>]*>19°<\/text>/);
    // Rain of 1 mm or more is written everywhere; less, at a station of the tour only.
    expect(html).toMatch(/<text class="mv l-p" [^>]*>2,4<\/text>/);
    expect(html).not.toMatch(/<text class="mv l-p" [^>]*>0,4<\/text>/);
  });

  it("estimates between the stations in the browser, from the temperatures measured and the altitudes' file, and says it is no measure", () => {
    const html = stationsMap(ALL);
    // The stations with a temperature only: x, y on the map, altitude, temperature.
    const data = [GILLOT, PLAINE, BRAS_SEC].map((s) => [...project(s.lon, s.lat), s.altitude_m, s.temperature]);
    expect(html).toContain(`data-voile="${esc(JSON.stringify(data))}"`);
    expect(html).toContain(`data-alt="${ALT_PATH}"`);
    expect(existsSync(new URL(`../public${ALT_PATH}`, import.meta.url))).toBe(true);
    // A canvas, never a picture made in the page: the site's policy allows none (img-src 'self').
    expect(html).toContain(`<canvas class="voile" `);
    expect(html).not.toContain("data:");
    // The legend's words are the page's own, written as they are (no value of a source in them).
    expect(html).toContain("3 stations, température mesurée sous abri, la plus récente à 09:18. Entre les stations, les couleurs sont <b>estimées selon l'altitude</b> : ce n'est pas une mesure.");
  });

  it("says one station in the singular, and leaves out the tab of a measure no station has", () => {
    const html = stationsMap([PLAINE, { ...BRAS_SEC, pluie_1h: undefined }]);
    expect(html).toContain("1 pluviomètre, pluie de la dernière heure");
    const rainOnly = stationsMap([PLUVIO]);
    expect(rainOnly).not.toContain(`id="wxl-t"`);
    expect(rainOnly).toContain(`<input type="radio" name="wxl" id="wxl-p" class="on" checked>`);
    expect(stationsMap([GILLOT])).toContain(`<input type="radio" name="wxl" id="wxl-t" class="on" checked>`);
  });

  it("says the rain of the last 6 minutes, tab and legend, while no station has the hour yet", () => {
    const hour = stationsMap(ALL);
    expect(hour).toContain(`<label for="wxl-p">Pluie 1 h</label>`);
    expect(hour).toContain("4 pluviomètres, pluie de la dernière heure en mm, la plus récente à 09:18. Point blanc : pas de pluie mesurée.");
    const six = stationsMap(ALL.map((s) => ({ ...s, pluie_6min: s.pluie_1h, pluie_1h: undefined })));
    expect(six).toContain(`<label for="wxl-p">Pluie 6 min</label>`);
    expect(six).toContain("4 pluviomètres, pluie des 6 dernières minutes seulement, en mm, la plus récente à 09:18 : l'heure complète n'est pas encore disponible.");
    expect(six).toContain(`data-tvp="${esc("2,4 mm en 6 min")}"`);
  });
});

describe("the page /meteo with every station", () => {
  const home = (toutes?: StationNow[]): HomeData => ({
    stations: [GILLOT, PLAINE], toutes, sources: [], indisponibles: [],
    mer: [{ nom: "Plage de Boucan Canot", valeur: 25.4, jour: "2026-10-21", distance_km: 2 }],
  });
  const page = (toutes?: StationNow[]) => meteoPage("https://rundata.re", { value: home(toutes), fetchedAt: NOW, stale: false }, NOW);

  it("puts the map at the top, the stations' list in the middle, the sea and the forecasts below", () => {
    const html = page(ALL);
    const map = html.indexOf(`<figure class="card mapcard airmap wxmap">`);
    const list = html.indexOf(`<ul class="stations" id="stl">`);
    const sea = html.indexOf(`id="h-mer"`);
    const forecast = html.indexOf(`id="h-communes"`);
    expect(map).toBeGreaterThan(0);
    expect(html.indexOf("<main")).toBeGreaterThan(map);
    expect(list).toBeGreaterThan(map);
    expect(sea).toBeGreaterThan(list);
    expect(forecast).toBeGreaterThan(sea);
    expect(html.match(/<li class="st tgt"/g)).toHaveLength(5);
    expect(html).toContain(esc("Les 5 stations, de la côte aux sommets"));
    expect(html).toContain("Pour chaque commune, les cirques, le volcan et les plages : la mesure de la station qui représente le mieux le lieu (proche, à une altitude voisine, du même versant) et la prévision sur 7 jours, aujourd'hui compris");
    expect(html).toContain(esc("IGN, RGE ALTI, pour les altitudes des couleurs estimées (Licence Ouverte 2.0)"));
    expect(html).toContain(esc("Météo-France, lame d'eau radar, pour la pluie estimée (Licence Ouverte 2.0)"));
  });

  it("folds the list after 12 stations, with a button for the rest; filters and sorts it, with its script on /meteo alone", () => {
    const many = Array.from({ length: 14 }, (_, i) => st({ nom: `Station ${String.fromCharCode(65 + i)}`, id: `974111${String(i).padStart(2, "0")}`, altitude_m: i * 100, temperature: 25 - i / 2 }));
    const html = page(many);
    expect(html).toContain(`<ul class="stations plie" id="stl">`);
    expect(html).toContain(`Voir les 14 stations</button>`);
    expect(html).toContain(`<span id="sttri">Trier par</span>`);
    expect(html.split(METEO_SCRIPT)).toHaveLength(2);
    expect(page(ALL)).not.toContain(`Voir les 5 stations`);
    expect(() => new Function(METEO_SCRIPT)).not.toThrow();
    // What the radar sees, said by the script once its grid has come: rain, none, or an image too old to show.
    expect(METEO_SCRIPT).toContain(`"En bleu : la pluie estimée par le radar de Météo-France à "`);
    expect(METEO_SCRIPT).toContain(`"Le radar de Météo-France ne voit pas de pluie à "`);
    expect(METEO_SCRIPT).toContain(`" et n'est pas affichée."`);
    // The hatches' sentence comes after a hatched square, styled by the page, which ties it to the hatches on the map.
    expect(METEO_SCRIPT).toContain(`i.className="hsw";say.append(" ",i,bad)`);
    expect(CSS).toContain(".wxmap .hsw{");
  });

  it("dates a measure of another day in the list, and says it old", () => {
    const html = page([GILLOT, { ...BRAS_SEC, time: "2026-10-21T15:00:00Z" }]);
    expect(html).toContain(`<span class="when">21/10 19:00 (ancienne)</span>`);
    expect(html).toContain(`<span class="when">09:18</span>`);
  });

  it("keeps the former page for a copy made before every station was kept", () => {
    const html = page(undefined);
    expect(html).not.toContain("wxmap");
    expect(html).toContain(esc("La mer au large"));
    expect(html).not.toContain(METEO_SCRIPT);
  });
});

describe("the station bubble on /meteo's map", () => {
  it("is placed against the map's figure, which is its containing block (not the page's top)", () => {
    const html = stationsMap([st({ nom: "Le Port", temperature: 26.5 })]);
    // The script computes the bubble's left and top from its parent's box: the figure.
    expect(html).toMatch(/^<figure class="card mapcard airmap wxmap">[\s\S]*<a class="mtip" data-mtip[\s\S]*<\/figure>$/);
    expect(CSS).toContain(".wxmap{position:relative}");
  });
});
