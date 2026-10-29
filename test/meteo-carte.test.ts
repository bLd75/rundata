import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import type { HomeData, StationNow } from "../src/web/data.js";
import { apart, esc, NOMS_SCRIPT, project } from "../src/web/map.js";
import { ALT_PATH, communeOf, landBreeze, METEO_SCRIPT, rainPill, rejeuScript, rejeuScriptPath, stationsMap, ventText, windPill } from "../src/web/meteo-carte.js";
import { CSS, meteoPage, stationId } from "../src/web/pages.js";
import { site } from "../src/web/site.js";

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

  it("moves apart wind pills that would cover each other, each tied to its place, and leaves the others on theirs", () => {
    // Two anemometers 600 m apart, as Pointe des Trois-Bassins and the FFVL's beacon of the Trou d'Eau.
    const pointe = st({ nom: "Pointe des Trois-Bassins", lon: 55.2386, lat: -21.0978, vent: 5, direction: 120 });
    const trou = st({ nom: "Balise du Trou d'Eau", source: "ffvl", id: "1012", lon: 55.2441, lat: -21.1013, vent: 1, direction: 78 });
    const html = stationsMap([GILLOT, pointe, trou]);
    const rects = [...html.matchAll(/<g class="sh l-v wv"><rect x="([\d.-]+)" y="([\d.-]+)"/g)].map((m) => [+m[1] + 46, +m[2] + 24]);
    expect(rects).toHaveLength(3);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      expect(Math.abs(rects[i][0] - rects[j][0]) >= 96 || Math.abs(rects[i][1] - rects[j][1]) >= 48).toBe(true);
    }
    // Set aside, not one above the other: the room above and below stays for « Saint-Paul » on a phone.
    const [g0, g1] = project(GILLOT.lon, GILLOT.lat).map(Math.round);
    const moved = rects.filter(([x, y]) => x !== g0 || y !== g1);
    expect(moved).toHaveLength(2);
    expect(Math.abs(moved[0][0] - moved[1][0])).toBeGreaterThanOrEqual(96);
    // Gillot, alone, on its place; the two others each tied to theirs, under every pill, in the wind's layer only.
    expect(rects).toContainEqual(project(GILLOT.lon, GILLOT.lat).map(Math.round));
    const ties = html.match(/<g class="l-v wt" aria-hidden="true">(.*?)<\/g>/)![1];
    // A white line on a night edge, and a white dot on the place (marketing).
    expect(ties.match(/<line class="o" /g)).toHaveLength(2);
    expect(ties.match(/<line class="i" /g)).toHaveLength(2);
    for (const s of [pointe, trou]) expect(ties).toContain(`<circle cx="${project(s.lon, s.lat)[0]}" cy="${project(s.lon, s.lat)[1]}" r="9"/>`);
    expect(html.indexOf(`class="l-v wt"`)).toBeLessThan(html.indexOf(`class="sh l-v wv"`));
    expect(stationsMap(ALL)).not.toContain(`class="l-v wt"`);
    expect(CSS).toContain(".wxmap .wt .o{stroke:#0b1f36;");
    expect(CSS).toContain(".wxmap .wt .i{stroke:#fff;");
    // No name of a place on a line or a dot.
    expect(NOMS_SCRIPT).toContain(",.wt line,.wt circle\")");
  });

  it("sets two pills on one place one above the other, unless asked to set them aside (the wind's)", () => {
    const two = [{ lon: 55.5, lat: -21.1, label: "", name: "a" }, { lon: 55.5, lat: -21.1, label: "", name: "b" }];
    const [a, b] = apart(two, [96, 96]);
    expect(a[0]).toBe(b[0]);
    const [c, d] = apart(two, [96, 96], 3);
    expect(c[1]).toBe(d[1]);
    expect(Math.abs(c[0] - d[0])).toBeGreaterThanOrEqual(96);
  });

  it("leaves a wind without its direction out of where the air goes, and keeps a calm in", () => {
    const sans = st({ nom: "Sans direction", lon: 55.4, lat: -21.0, vent: 14 });
    const calme = st({ nom: "Calme", lon: 55.6, lat: -21.3, vent: 0 });
    const html = stationsMap([GILLOT, sans, calme]);
    const data = JSON.parse(html.match(/data-vent="([^"]+)"/)![1].replaceAll("&quot;", '"')) as number[][];
    expect(data.map((d) => d.slice(0, 2))).toEqual([project(GILLOT.lon, GILLOT.lat), project(calme.lon, calme.lat)]);
    expect(data[1].slice(2)).toEqual([0, 0]);
    // Still a measure of the map and of its legend.
    expect(html).toContain("3 anémomètres, vent moyen");
    expect(html).toMatch(/<g class="sh l-v wv"><rect [^>]*\/><circle [^>]*\/><text [^>]*>14<\/text><\/g>/);
    // No direction at all: the measures without the movement.
    const seul = stationsMap([sans]);
    expect(seul).toContain(`id="wxl-v"`);
    expect(seul).not.toContain("data-vent");
  });

  describe("the land breeze, at night", () => {
    // 23:00 in La Réunion; 09:18 the morning before, by day.
    const NUIT = "2026-10-22T19:00:00Z";
    const cote = (nom: string, lon: number, lat: number, direction: number, o: Partial<StationNow> = {}) => st({ nom, lon, lat, altitude_m: 10, vent: 8, direction, time: NUIT, ...o });
    // Each coast's wind goes to its sea: the north's from 160°, the east's from 230°, the south's from 10°; the west's, from 40°, along its coast.
    const nuit = [cote("Nord", 55.53, -20.89, 160), cote("Est", 55.71, -21.03, 230), cote("Sud", 55.42, -21.32, 10), cote("Ouest", 55.29, -20.94, 40)];
    const breeze = " La nuit, l'air descend des pentes vers la mer (brise de terre). ";

    it("is said when the coast's winds go to the sea on two sides of the island at least", () => {
      expect(landBreeze(nuit)).toBe(true);
      expect(stationsMap(nuit)).toContain(`(un vent d'est vient de l'est).${breeze}Entre les stations`);
      expect(landBreeze(nuit.slice(1, 3))).toBe(true);
    });

    it("is not said by day, nor on one side alone: the trade wind blows to the western sea", () => {
      expect(landBreeze(nuit.map((s) => ({ ...s, time: at })))).toBe(false);
      expect(stationsMap(nuit.map((s) => ({ ...s, time: at })))).not.toContain("brise de terre");
      // The trade wind at night, from 110°: on the east, north and south coasts it comes from the sea or along them.
      const alize = nuit.map((s) => ({ ...s, direction: 110 }));
      expect(landBreeze(alize)).toBe(false);
      expect(landBreeze(nuit.slice(2))).toBe(false);
    });

    it("counts the coast's live winds only: not the heights, an old measure, a calm or a wind without its direction", () => {
      const [n, e, s] = nuit;
      expect(landBreeze([n, { ...e, altitude_m: 1500 }])).toBe(false);
      expect(landBreeze([n, { ...e, stale: true }])).toBe(false);
      expect(landBreeze([n, { ...e, vent: 0 }])).toBe(false);
      expect(landBreeze([n, { ...e, direction: undefined }])).toBe(false);
      // Most of a side's: one wind to the sea against two from it is not the side's.
      expect(landBreeze([n, e, cote("Est 2", 55.7, -21.0, 70), cote("Est 3", 55.72, -21.06, 90)])).toBe(false);
      expect(landBreeze([n, e, s, cote("Est 2", 55.7, -21.0, 70)])).toBe(true);
    });
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
    // The replay bar (marketing's words): hidden without a script, no length chosen, its script asked on a first touch.
    expect(html).toContain(`<div class="rj" data-rejeu="${rejeuScriptPath()}" data-fin="${ALL.reduce((m, x) => (x.time > m ? x.time : m), "")}" hidden><fieldset class="tabs"><legend>Revoir :</legend>` +
      `<input type="radio" name="rjd" id="rjd-6h" value="6h"><label for="rjd-6h">6\u00a0h</label><input type="radio" name="rjd" id="rjd-24h" value="24h"><label for="rjd-24h">24\u00a0h</label>` +
      `<input type="radio" name="rjd" id="rjd-7j" value="7j"><label for="rjd-7j">7\u00a0jours</label></fieldset><button type="button" class="rj-b" aria-label="Lire les 6\u00a0dernières heures">▶ Lire</button>` +
      `<input type="range" min="0" max="1" step="any" value="1" aria-label="Moment affiché sur la carte" hidden><span class="rj-q" hidden></span>` +
      `<span class="rj-ko" hidden>L'historique n'a pas pu être chargé : la carte reste sur la dernière mesure. <button type="button">Réessayer</button></span><span class="sr" aria-live="polite"></span></div>`);
    expect(html).toContain(`<g class="rj-st"></g><g class="rj-t" aria-hidden="true"><text class="rj-d" x="24" y="782"></text><text class="rj-h" x="24" y="846"></text><text class="rj-s" x="24" y="886"></text></g>`);
    // A replay legend for each layer, the temperatures' too.
    expect(html.match(/<span class="lg lg-[tpv](?: on)?"><span class="lg-now">/g)).toHaveLength(3);
    expect(html.match(/<span class="rj-lg"><\/span>/g)).toHaveLength(3);
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
    expect(METEO_SCRIPT).toContain(`"En bleu : la pluie estimée par le radar de Météo-France "+(past?"le "+dm_(j.fin)+" à "+hm(j.fin):at_(j.fin))+" ; plus c'est foncé, plus elle est forte."`);
    expect(METEO_SCRIPT).toContain(`"Le radar de Météo-France ne voit pas de pluie "+(tail?"sur l'île ":"")+at_(j.fin)+"."`);
    // In the replay, a past image: its date and the past tense, never "hier".
    expect(METEO_SCRIPT).toContain(`"Le "+dm_(j.fin)+" à "+hm(j.fin)+", le radar de Météo-France ne voyait pas de pluie."`);
    expect(METEO_SCRIPT).toContain(`say_(n,bad,{el},"",1)`);
    expect(METEO_SCRIPT).toContain(`" et n'est pas affichée."`);
    // The hatches' sentence comes after a hatched square, styled by the page, which ties it to the hatches on the map.
    expect(METEO_SCRIPT).toContain(`w.append(i,"\u00a0Hachures");el.append(" ",w,bad.slice(9))`);
    expect(CSS).toContain(".wxmap .hsw{");
    for (const words of [`"sur l'île "`, `"Pas d'image radar à "+hm(e.a)+"."`, `"Pas d'image radar de "+hm(e.de)+" à "+hm(e.a)+"."`, `"hier à "`, `b.textContent="Chargement…"`, `b.textContent="▶ Lire"`]) {
      expect(METEO_SCRIPT).toContain(words);
    }
    // The replay's own script is not in the page: it is asked on a first touch of the bar.
    expect(METEO_SCRIPT).not.toContain("❚❚ Pause");
    expect(CSS).toContain(".wxmap.rejeu:not(.rj-fin) :is(.lg-now,.sts,.mtip){display:none}");
    expect(CSS).toContain("@media (prefers-reduced-motion:reduce){.wxmap .rj-b{display:none}}");
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

describe("the map's layers in Safari", () => {
  // In a foreignObject, Safari paints what has a layer of its own (a positioned element, a canvas drawn on the
  // graphics card) unscaled, below and right of the map, over the legend and the text (iPhone, 29/10).
  it("stacks a layer's canvases without positioning them", () => {
    const rules = [...CSS.replace(/\/\*[^]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => /\.wxmap [^,]*(\.vt|canvas|\.voile|\.flux)/.test(sel));
    expect(rules.map(([, sel]) => sel.trim())).toEqual(expect.arrayContaining([".wxmap .vt", ".wxmap .vt canvas", ".wxmap .voile"]));
    for (const [, sel, body] of rules) expect(`${sel.trim()} ${body}`).not.toMatch(/position:|transform|will-change/);
    expect(CSS).toContain(".wxmap .vt{display:grid;grid-template:100%/100%;");
  });

  it("draws the map's canvases by the processor, the canvases made off the page alone otherwise", () => {
    expect(METEO_SCRIPT).toContain(`const c2d=(c)=>c.getContext("2d",{willReadFrequently:true});`);
    expect(METEO_SCRIPT.match(/c2d\(/g)!.length).toBeGreaterThanOrEqual(5);
    for (const line of METEO_SCRIPT.split("\n")) {
      for (const [, canvas] of line.matchAll(/(\w+)\.getContext\("2d"\)/g)) expect(line).toContain(`${canvas}=document.createElement("canvas")`);
    }
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

describe("the replay bar's own script", () => {
  it("is served at its address, kept a year there, a script the page's policy lets run ('self')", async () => {
    const get = (p: string) => site(new Request(`https://rundata.re${p}`), new Cache(new MemoryStore()), () => {});
    const res = (await get(rejeuScriptPath()))!;
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.text()).toBe(rejeuScript());
    // Another version's address (a copy of the page kept offline) gets today's for a few minutes only.
    expect((await get("/meteo/rejeu-ancien.js"))!.headers.get("cache-control")).toBe("public, max-age=300");
    expect(rejeuScriptPath()).toMatch(/^\/meteo\/rejeu-\w+\.js$/);
  });

  it("says marketing's words, plays in 12 s, and never says « temps réel » nor « prévision »", () => {
    const js = rejeuScript();
    expect(() => new Function(js)).not.toThrow();
    for (const words of [`"❚❚ Pause"`, `"↻ Relire"`, `"▶ Lire"`, `"Mettre en pause"`, `"Relire"`, `"Chargement…"`, `"Lire les 24 dernières heures"`, `"Lire les 7 derniers jours"`,
      `w="mesuré"`, `w="estimé"`, `w="dernière mesure"`, `", estimé entre les mesures de "+hmm(r.a.t)+" et de "+hmm(r.z.t)`, `"Pluie de "+hmm(r.h.t-36e5)+" à "+hmm(r.h.t)`,
      `"Historique gardé depuis le "+dm(S)+" à "+hmm(S)+"."`, `". Pas d'image radar de "`, `PLAY=12000`,
      `"Température sous abri de "+x+" de Météo-France, une mesure par heure.`, `" de Météo-France, une mesure par heure. Entre eux, le mouvement et les couleurs sont estimés : ce n'est pas une mesure. Les aéroports et les balises de vent ne sont pas dans ce rejeu."`,
      `"Pluie de chaque heure, en mm, mesurée par "+x+" de Météo-France. Point blanc : pas de pluie mesurée."`, `.lg-now .lgs`]) {
      expect(js).toContain(words);
    }
    expect(js).not.toMatch(/temps r[ée]el|prévision/i);
    expect(js).not.toContain("OpenWindMap");
    // The data it is given (the stations named on the map, the colours) cannot close a script.
    expect(js).not.toContain("</");
  });
});
