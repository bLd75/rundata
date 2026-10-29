import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Cache } from "../src/cache.js";
import * as climat from "../src/providers/climat.js";
import * as meteofrance from "../src/providers/meteofrance.js";
import { INSEE } from "../src/places/insee.js";
import { stationHistory } from "../src/tools/historique.js";
import { inseeCommune } from "../src/web/meteo-carte.js";
import { esc } from "../src/web/map.js";
import { meteoPage } from "../src/web/pages.js";
import { type StationData, STATIONS, stationOf, stationPage, stationPath, stationTitle } from "../src/web/station.js";

// Real rows: the 6-minute and hourly packages of the tests, and the archive's days (scripts/build-climat.py) up to 23 October 2026.
const NOW = new Date("2026-10-24T08:00:00Z");
const GILLOT = "97418110";
let db: DatabaseSync;

beforeAll(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./fixtures/historique/climat.sql", import.meta.url), "utf8"));
});
afterEach(() => climat.configure(undefined));

const plug = () => climat.configure({ all: async <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as (string | number)[])) as T[] });
const row = meteofrance.parseCsv(readFileSync(new URL("./fixtures/meteofrance_6min.csv", import.meta.url), "utf8")).find((r) => r.id === GILLOT)!;
const hourly = meteofrance.parseHourly(readFileSync(new URL("./fixtures/meteofrance_horaire.csv", import.meta.url), "utf8"), Date.parse("2026-10-25T08:57:00Z"));

async function data(o: Partial<StationData> = {}): Promise<StationData> {
  const obs = meteofrance.observation(row, null)!;
  return {
    id: GILLOT,
    nom: "Saint-Denis Gillot (aéroport)",
    altitude_m: 8,
    derniere: { time: obs.time.toISOString(), mesures: Object.fromEntries(obs.readings.map((r) => [r.variable, r.valeur as number])) },
    heures: meteofrance.stationHours(hourly, GILLOT),
    historique: await stationHistory(new Cache(), GILLOT, NOW),
    ...o,
  };
}
const page = (d: StationData) => stationPage("https://rundata.re", { value: d, fetchedAt: NOW, stale: false }, d.id, NOW);

describe("a station's page", () => {
  it("is titled by the station's short name, never by another commune", () => {
    expect(stationTitle("Saint-Denis Gillot (aéroport)")).toBe("Gillot aéroport");
    const communes = Object.keys(INSEE);
    for (const s of STATIONS) {
      const t = stationTitle(s.nom);
      expect(communes.filter((c) => c !== inseeCommune(s.id) && t.includes(c)), s.nom).toEqual([]);
    }
  });

  it("exists for every station of the list, the CIRAD's too, titled by its owner", () => {
    expect(stationOf(GILLOT)?.nom).toBe("Saint-Denis Gillot (aéroport)");
    expect(STATIONS).toEqual(meteofrance.stations());
    expect(stationPath(GILLOT)).toBe("/meteo/station/97418110");
    expect(stationTitle("La Mare - CIRAD")).toBe("La Mare CIRAD");
  });

  it("says its last measure: the temperature, where it was measured, then the box", async () => {
    plug();
    const d = await data();
    // The 6-minute measure of the 22nd, at 12:18 on the 25th: just after the last hour of the package.
    const html = page({ ...d, derniere: { ...d.derniere!, time: "2026-10-25T08:18:00Z" } });
    expect(html).toContain(`<li aria-current="page">Gillot aéroport</li>`);
    expect(html).toContain(`<h1>Gillot <span class="n974">aéroport</span></h1>\n    <p class="hook">Ce que mesure cette station en ce moment, et son historique depuis 1953.</p>`);
    expect(html).toContain("<title>Gillot aéroport : station météo en direct et historique");
    expect(html).toContain(`<span class="big span">27,9 °C</span><p>mesurés sous abri à <b>12:18</b> par la station Météo-France de l'aéroport, à Sainte-Marie, 8 m d'altitude.</p>`);
    expect(html).toContain("<h3>La dernière mesure, à 12:18</h3>");
    for (const k of ["Vent moyen", "Humidité", "Point de rosée", "Pluie", "Pression (niveau de la mer)", "Soleil"]) expect(html).toContain(`<li><span>${k}</span>`);
    // Rain and sunshine of the last round hour of the package.
    expect(html).toContain("<li><span>Pluie</span><b>0 mm en 6 min, 0 mm de 11:00 à 12:00</b></li>");
    expect(html).toContain("<li><span>Soleil</span><b>20 min de 11:00 à 12:00</b></li>");
    expect(html).toContain(`Mesures de Météo-France, toutes les 6 minutes. <a href="/meteo#stations">Les autres stations →</a>`);
  });

  it("draws its last 24 hours, dated, never « hier »", async () => {
    plug();
    const html = page(await data());
    expect(html).toContain("<p>Heure par heure, de 13:00 le 24/10 à 12:00 le 25/10 : de 21,3 °C à 29 °C, 0 mm de pluie, rafale la plus forte 28 km/h entre 13:00 et 14:00.</p>");
    expect(html).toContain(`<p class="sta-0">Pas de pluie mesurée ces 24 heures.</p>`);
    expect(html).toContain("les flèches montrent où va le vent (un vent d'est vient de l'est).");
    expect(html.match(/<svg class="ch" /g)).toHaveLength(4);
    expect(html).not.toMatch(/hier|aujourd/);
  });

  it("gives its last 30 days, its year month by month and its records, from the archive", async () => {
    plug();
    const html = page(await data());
    expect(html).toContain("<p>Du 24/09 au 23/10 : 16,8 mm de pluie en 6 jours (normale d&#39;environ 43 mm) ; maximales de 28,4 °C en moyenne (normale 26,8 °C) ; 6,5 h de soleil par jour.</p>");
    expect(html).not.toContain("≈");
    expect(html).toContain("<h2 id=\"h-an\">Mois par mois en 2026</h2>");
    expect(html).toContain("Depuis janvier : 713 mm de pluie, 55 % de la normale.");
    expect(html).toContain("<tr><td>Janvier</td><td><b>140 mm</b><small>normale 270</small></td>");
    expect(html).toContain(`<p class="note">Octobre jusqu'au 23/10.</p>`);
    expect(html).toContain(`<h2 id="h-rec">Les records de la station</h2>`);
    for (const k of ["Température la plus haute", "Température la plus basse", "Pluie en un jour", "Rafale la plus forte"]) expect(html).toMatch(new RegExp(`<span>${k}</span><b>[^<]+</b><small>le \\d\\d/\\d\\d/\\d{4}</small>`));
  });

  it("is described by what it measures, its commune and altitude when it fits", async () => {
    plug();
    expect(page(await data())).toContain(`<meta name="description" content="Ce que mesure la station Météo-France Gillot aéroport (Sainte-Marie, 8\u202fm d&#39;altitude) en ce moment\u00a0: température, pluie, vent, et son historique depuis 1953.">`);
    const hist = (await data()).historique;
    for (const s of STATIONS) {
      const d: StationData = { id: s.id, nom: s.nom, altitude_m: s.altitude_m, derniere: { time: "2026-10-24T07:54:00Z", mesures: { temperature: 20, pluie_6min: 0, vent_moyen: 5 } }, heures: [], historique: hist };
      const desc = page(d).match(/<meta name="description" content="([^"]+)"/)![1].replaceAll("&#39;", "'");
      expect(desc.length, s.nom).toBeLessThanOrEqual(160);
    }
  });

  it("says a rain gauge's rain, and since when a silent station has said nothing, never that it is broken", async () => {
    const pluie = page(await data({ derniere: { time: "2026-10-25T08:18:00Z", mesures: { pluie_6min: 0.2 } }, historique: undefined }));
    expect(pluie).toContain("<p>Pluie mesurée à <b>12:18</b> par la station Météo-France de l'aéroport, à Sainte-Marie, 8\u202fm d'altitude.</p>");
    expect(pluie).toContain(`<meta name="description" content="Ce que mesure la station Météo-France Gillot aéroport (Sainte-Marie, 8\u202fm d&#39;altitude) en ce moment\u00a0: température, pluie, vent.">`);
    expect(page(await data({ derniere: undefined, historique: undefined }))).toContain("rundata.re n&#39;a pas de mesure de cette station depuis le 25/10 à 12:00. <a href=\"/meteo#stations\">Les autres stations →</a>");
    expect(page(await data({ derniere: undefined, heures: [], historique: undefined }))).toContain("rundata.re n&#39;a reçu aucune mesure de cette station.");
  });

  it("leaves out the sunshine of an hour wholly at night", async () => {
    const d = await data({ historique: undefined });
    const night = { ...d, derniere: { ...d.derniere!, time: "2026-10-24T19:30:00Z" }, heures: [{ ...d.heures[0], fin: "2026-10-24T19:00:00Z", ins: 0 }] };
    expect(page(night)).not.toContain("<li><span>Soleil</span>");
    const evening = { ...night, derniere: { ...d.derniere!, time: "2026-10-24T15:30:00Z" }, heures: [{ ...d.heures[0], fin: "2026-10-24T15:00:00Z", ins: 0 }] };
    expect(page(evening)).toContain("<li><span>Soleil</span><b>0\u202fmin de 18:00 à 19:00</b></li>");
  });

  it("gives the last round hour's rain and sunshine only when it ends before the last measure", async () => {
    // The 6-minute measure of the 22nd, the hours of the 25th: no hour in the box.
    const html = page(await data({ historique: undefined }));
    expect(html).toContain("<li><span>Pluie</span><b>0\u202fmm en 6\u202fmin</b></li>");
    expect(html).not.toContain("<li><span>Soleil</span>");
  });

  it("says when rundata.re has no history of the station, without an empty chart", async () => {
    const sans = page(await data({ historique: undefined }));
    expect(sans).toContain(`<p class="note">rundata.re n'a pas l'historique de cette station.</p>`);
    expect(sans).toContain(`<p class="hook">Ce que mesure cette station en ce moment.</p>`);
    const seule = page(await data({ historique: undefined, heures: [] }));
    expect(seule).toContain("Dernière mesure seulement : rundata.re n'a pas l'historique de cette station.");
    expect(seule).not.toContain(`<svg class="ch"`);
  });

  it("is linked from its row on /meteo, a CIRAD station's too", () => {
    const cirad = STATIONS.find((s) => / - CIRAD$/.test(s.nom))!;
    const st = (id: string, nom: string) => ({ nom, id, source: "meteofrance", lon: 55.5, lat: -21.1, altitude_m: 10, time: "2026-10-24T07:54:00Z", stale: false, temperature: 25 });
    const html = meteoPage("https://rundata.re", { value: { stations: [], toutes: [st(GILLOT, "Saint-Denis Gillot (aéroport)"), st(cirad.id, cirad.nom)], mer: [], sources: [], indisponibles: [] }, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain(`<h4><a href="/meteo/station/97418110">Saint-Denis Gillot (aéroport)</a></h4>`);
    expect(html).toContain(`<h4><a href="${stationPath(cirad.id)}">${esc(cirad.nom)}</a></h4>`);
  });

  it("says a CIRAD station's owner, and Météo-France as who sends its measures", async () => {
    const cirad = STATIONS.find((s) => / - CIRAD$/.test(s.nom))!;
    const html = page({ ...(await data({ historique: undefined })), id: cirad.id, nom: "La Mare - CIRAD", altitude_m: 68 });
    expect(html).toContain(`<h1>La Mare <span class="n974">CIRAD</span></h1>`);
    expect(html).toMatch(/<p>mesurés à <b>\d\d:\d\d<\/b> par la station du CIRAD, à /);
    expect(html).toContain("Mesures du CIRAD, diffusées par Météo-France, toutes les 6\u202fminutes.");
    expect(html).toContain(`<meta name="description" content="Ce que mesure la station La Mare du CIRAD (`);
  });

  it("is the history of a station that sends nothing any more, dated with its year, never « en direct »", async () => {
    plug();
    const d = await data({ derniere: undefined, heures: [] });
    const h = d.historique!;
    const later = new Date(Date.parse(h.jusqu_au) + 400 * 86_400_000);
    const year = (ymd: string) => ymd.split("-").reverse().join("/");
    const html = stationPage("https://rundata.re", { value: d, fetchedAt: later, stale: false }, d.id, later);
    expect(html).toContain("<title>Gillot aéroport : historique de la station météo");
    expect(html).toContain(`<p class="hook">L&#39;historique de cette station, de ${h.depuis} au ${year(h.jusqu_au)}.</p>`);
    expect(html).toContain(`rundata.re n&#39;a pas de mesure de cette station depuis le ${year(h.jusqu_au)}.`);
    expect(html).toContain(`<h2 id="h-30">Les 30 derniers jours de mesure</h2>`);
    expect(html).toContain(`<p>Du ${year(h.trente.du)} au ${year(h.trente.au)} : `);
    expect(html).toContain(`content="L&#39;historique de la station Météo-France Gillot aéroport (Sainte-Marie, 8\u202fm d&#39;altitude), de ${h.depuis} au ${year(h.jusqu_au)}."`);
    expect(html).not.toContain("Mesure en direct");
  });
});
