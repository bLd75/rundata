import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, type Cached, MemoryStore } from "../src/cache.js";
import { buildCrues, type CruesAnswer } from "../src/web/data.js";
import { cruesPage } from "../src/web/domains.js";
import { deadAnchors, doubleIds } from "./cartes.js";

// Vigicrues Réunion on 23/10/2026 at 23:45 UTC (03:45 in La Réunion), as in crues.test.ts: no flood vigilance, the
// ravine des Cabris rising from dry, three gauges without a level.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-23T23:52:00Z");
const ORIGIN = "https://rundata.re";
// The page's words: links and bold read inline, the other tags as spaces, the typography's no-break spaces as spaces.
const words = (html: string) =>
  html.replace(/<\/?(a|b)\b[^>]*>/g, "").replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'").replace(/\u00a0/g, " ").replace(/\s+/g, " ");

let vigilance = fixture("vigicrues_vigilance.json");
async function page(): Promise<{ html: string; data: Cached<CruesAnswer> }> {
  const value = await buildCrues(new Cache(new MemoryStore(), () => NOW.getTime()), NOW);
  const data = { value, fetchedAt: new Date(NOW.getTime() - 60_000), stale: false };
  return { html: cruesPage(ORIGIN, data, NOW), data };
}

describe("the /crues page", () => {
  beforeEach(() => {
    vigilance = fixture("vigicrues_vigilance.json");
    vi.stubGlobal("fetch", async (url: string, init?: { body?: URLSearchParams }) =>
      new Response(url.endsWith("vigilance.php") ? vigilance : fixture(`vigicrues_${init?.body?.get("mesure")}.json`), { headers: { "content-type": "application/json" } }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("says the vigilance first, from Vigicrues Réunion, then the gauges measured lately, the others counted apart", async () => {
    const { html } = await page();
    const w = words(html);
    expect(html).toContain("<title>Crues Réunion en direct : rivières et vigilance · 974</title>");
    expect(w).toMatch(/Crues des rivières 974/);
    expect(w).toContain("Pas de vigilance crues en cours d'après Vigicrues Réunion : toutes les rivières suivies sont au vert.");
    expect(w).toContain("Dernier bulletin le 07/08 à 06:22 : Vigicrues Réunion n'en publie qu'en vigilance jaune ou plus.");
    expect(w).toMatch(/En hausse sur la dernière demi-heure \(mesures de 03:45\) : Cabris - RN3 \(ravine des Cabris, Saint-Pierre\), 0,06 m[^.]*\. Les 2 autres n'ont pas de mesure récente\./);
    // Never said of the rivers by the page itself.
    expect(w).not.toMatch(/pas de crue|aucune rivière en crue|en panne|hors ligne|ne répond pas/i);
  });

  it("gives the advice on fords always, and the Creole question", async () => {
    const w = words((await page()).html);
    expect(w).toContain("Pluies fortes ou crue : ne jamais traverser un radier submergé ni une ravine en eau, à pied ou en voiture. Vigilance pluies de Météo-France : la vigilance zone par zone.");
    expect(w).toContain("Larivyèr i mont Sin-Bénoi ? Gèt si https://rundata.re/crues é di amwin.");
    expect(w).toContain("La rivière monte-t-elle à Saint-Benoît ? Lis https://rundata.re/crues et dis-moi si l'eau monte.");
    expect(words(cruesPage(ORIGIN, null, NOW))).toContain("Pluies fortes ou crue : ne jamais traverser un radier submergé");
  });

  it("folds the rivers when all are green, and gives each gauge its line, by river, with its reference floods", async () => {
    const { html, data } = await page();
    const w = words(html);
    expect(w).toContain("Les 21 rivières suivies, toutes au vert d'après Vigicrues Réunion");
    const silent = data.value.stations.find((s) => s.hauteur_m == null)!;
    expect(w).toContain(`${silent.station} · ${silent.commune} Pas de mesure dans notre lecture de 03:51.`);
    expect(w).toMatch(/Saint-Denis - Amont · Saint-Denis -?\d+,?\d* m, (stable|en hausse|en baisse) · [\d,]+ m³\/s · mesurée à \d\d:\d\d/);
    expect(w).toMatch(/Saint-Denis - Amont · Saint-Denis [^]*?Crues de référence [^]*?1,5 m · 43 m³\/s · Cyclone Dumile \(janvier 2013\)/);
    expect(w).toContain("Sources : Vigicrues Réunion (vigilance crues, hauteurs et débits des rivières), © VIGICRUES, DEAL Réunion (Licence Ouverte Etalab). Lu le 24/10 à 03:51. Le site officiel : vigicrues-reunion.re ↗.");
    expect(deadAnchors(html)).toEqual([]);
    expect(doubleIds(html)).toEqual([]);
  });

  it("names the one gauge without a recent measurement", async () => {
    const { data } = await page();
    const silent = data.value.stations.filter((s) => s.hauteur_m == null);
    const [one, ...others] = silent;
    const stations = data.value.stations.map((s) => (others.includes(s) ? { ...s, hauteur_m: 0.2, tendance_30_min: "stable" as const, heure_mesure: "24/10 03:45" } : s));
    const w = words(cruesPage(ORIGIN, { ...data, value: { ...data.value, stations } }, NOW));
    expect(w).toMatch(new RegExp(`0,06 m[^.]*\\. Une station n'a pas de mesure récente : ${one.station}\\.`));
  });

  it("draws each gauge on the map, a ring for one without a recent measurement, and says its line aloud", async () => {
    const { html, data } = await page();
    const silent = data.value.stations.find((s) => s.hauteur_m == null)!;
    expect(html).toContain(`aria-label="${silent.station} · ${silent.commune} : pas de mesure dans notre lecture de 03:51, voir le détail"`);
    expect(html).toMatch(/aria-label="Cabris - RN3 · Saint-Pierre : 0,06\u00a0m, en hausse · 0\u00a0m³\/s · mesurée à 03:45, voir le détail"/);
    expect(html.match(/style="fill:#fff;stroke:#5a6672;stroke-width:8"/g)).toHaveLength(data.value.stations.filter((s) => s.hauteur_m == null || s.avertissement).length);
    expect(words(html)).toContain("Stations de la DEAL : ↑ en hausse · stable ou en baisse · sans mesure récente.");
    expect(words(html)).toContain("Votre IA, branchée sur les rivières de l'île");
  });

  it("says a late gauge's last level with its time, never its trend", async () => {
    const { data } = await page();
    const late = { ...data.value.stations[0], hauteur_m: 0.18, tendance_30_min: "en hausse" as const, heure_mesure: "24/10 02:00", avertissement: "Dernière mesure il y a 112 min." };
    const value = { ...data.value, stations: [late, ...data.value.stations.slice(1)] };
    const w = words(cruesPage(ORIGIN, { ...data, value }, NOW));
    expect(w).toContain(`${late.station} · ${late.commune} 0,18 m à 02:00 · pas de mesure plus récente`);
    expect(w).not.toMatch(new RegExp(`${late.station} \\(`));
  });

  it("says a vigilance in force first, with the bulletin's own words, and the colour on the river's gauges", async () => {
    const orange = JSON.parse(vigilance);
    orange[0] = [true, 3, "2026-10-24 03:30:00", "Fortes pluies sur l'ouest.", "Hausse attendue cet après-midi.", "", "", 0];
    orange.find((r: unknown[]) => r[0] === "rivière des Galets")[1] = 3;
    vigilance = JSON.stringify(orange);
    const w = words((await page()).html);
    expect(w).toContain("Vigilance crues orange pour rivière des Galets, d'après Vigicrues Réunion (bulletin n° 3 du 24/10 à 03:30).");
    expect(w).toContain("Ce que dit le bulletin : « Fortes pluies sur l'ouest. »");
    expect(w).toContain("À venir : « Hausse attendue cet après-midi. »");
    expect(w).toContain("rivière des Galets (vert au bulletin précédent) orange");
    expect(w).toMatch(/rivière des Galets orange [^]*?Galets/);
    expect(w).not.toContain("toutes au vert");
  });

  it("says when the vigilance could not be read, and when no gauge was measured lately", async () => {
    const { data } = await page();
    const silent = data.value.stations.map((s) => ({ ...s, hauteur_m: null, avertissement: undefined }));
    const w = words(cruesPage(ORIGIN, { ...data, value: { ...data.value, vigilance_crues: undefined, stations: silent } }, NOW));
    expect(w).toContain("Vigilance crues absente de notre lecture de 03:51 : voir vigicrues-reunion.re ↗.");
    expect(w).toContain("Aucune des 29 stations n'a de mesure de moins de 30 minutes dans notre lecture de 03:51 : nous ne savons pas pour l'instant si les rivières montent.");
  });
});
