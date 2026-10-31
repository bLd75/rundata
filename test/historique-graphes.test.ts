import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Cache } from "../src/cache.js";
import normales from "../src/historique/normales.json" with { type: "json" };
import chaud from "../src/historique/plus-chaud.json" with { type: "json" };
import * as climat from "../src/providers/climat.js";
import { historiqueMeteo } from "../src/tools/historique.js";
import type { HistoriqueAnswer } from "../src/web/data.js";
import { historiquePage } from "../src/web/domains.js";
import { GRAPHES_SCRIPT, graphes, warmer } from "../src/web/historique-graphes.js";

// Real rows of the archive (scripts/build-climat.py): the six stations of the tour, 2025 and 2026 up to 23 October.
const NOW = new Date("2026-10-24T08:00:00Z");
let db: DatabaseSync;
beforeAll(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./fixtures/historique/climat.sql", import.meta.url), "utf8"));
});
afterEach(() => climat.configure(undefined));
const plug = () => climat.configure({ all: async <T>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as (string | number)[])) as T[] });
const json = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const island = async (series?: boolean) => json(await historiqueMeteo(new Cache(), undefined, series ? { series } : {}, NOW)) as HistoriqueAnswer;
const at = (value: HistoriqueAnswer) => ({ value, fetchedAt: NOW, stale: false });
const svgs = (html: string, id: string) => html.match(new RegExp(`<section aria-labelledby="${id}">.*?</section>`, "s"))![0].match(/<svg .*?<\/svg>/gs) ?? [];

describe("the days of /historique", () => {
  it("gives the six stations day by day, with the normal of each day, for the page only", async () => {
    plug();
    const d = await island(true);
    for (const s of d.stations) {
      expect(s.jours).toHaveLength(30);
      expect(s.jours![0].date).toBe("24/09/2026");
      expect(Object.keys(s.jours![29]).filter((k) => !["date", "pluie_mm", "tmin", "tmax", "soleil_h", "soleil_pct"].includes(k))).toEqual([]);
    }
    // Gillot: September's and October's rain shared out day by day, about the 30 days' normal.
    const g = d.stations[0];
    const rr = (normales.stations as unknown as Record<string, { rr: number[] }>)["97418110"].rr;
    expect(g.normale_jour!.pluie_mm![0]).toBe(Math.round((rr[8] / 30) * 10) / 10);
    expect(g.normale_jour!.pluie_mm![29]).toBe(Math.round((rr[9] / 31) * 10) / 10);
    expect(Math.abs(g.normale_jour!.pluie_mm!.reduce((a, b) => a + b, 0) - g.pluie!.normale_mm!)).toBeLessThan(1);
    expect(g.normale_jour!.tmax).toHaveLength(30);
    // The tool's answer stays the summaries.
    plug();
    expect((await island()).stations.some((s) => s.jours || s.normale_jour)).toBe(false);
  });

  it("draws the rain summed, the temperatures on the normal's band and the sunshine, each said in words", async () => {
    plug();
    const d = await island(true);
    const html = historiquePage("https://rundata.re", at(d), NOW);
    expect(svgs(html, "h-g-pluie")).toHaveLength(6);
    expect(svgs(html, "h-g-temp")).toHaveLength(6);
    const sun = d.stations.filter((s) => s.jours!.some((j) => j.soleil_h != null)).length;
    expect(svgs(html, "h-g-soleil")).toHaveLength(sun);
    for (const s of [...svgs(html, "h-g-pluie"), ...svgs(html, "h-g-temp"), ...svgs(html, "h-g-soleil")]) {
      expect(s).toMatch(/aria-label="[^"]*mesurées? par Météo-France à [^"]+ du 24\/09 au \d\d\/10/);
      expect(s).toMatch(/data-k="(pluie|temp|soleil)" data-d="24\/09,25\/09,[^"]*,23\/10"/);
    }
    expect(svgs(html, "h-g-pluie")[0]).toContain(`${d.stations[0].pluie!.total_mm.toString().replace(".", ",")} mm mesurés`);
    expect(svgs(html, "h-g-temp")[0]).toContain('class="bd"');
    expect(html).toContain("normale 1991-2020");
    // The window's first day, as the copy is built: not a date written in.
    expect(html).toContain("La pluie tombée depuis le 24/09, additionnée");
    expect(html).toContain("chaque jour depuis le 24/09");
    expect(html.indexOf(`<script>${GRAPHES_SCRIPT}</script>`)).toBeGreaterThan(html.indexOf('id="h-g-chaud"'));
    // Without the days, no chart and no script.
    const bare = { ...d, stations: d.stations.map(({ jours: _, normale_jour: __, ...s }) => s) };
    expect(graphes(bare)).toBe("");
    expect(historiquePage("https://rundata.re", at(bare), NOW)).not.toContain(GRAPHES_SCRIPT);
  });

  it("leaves a hole for a day not measured, never a zero, and dots the grey days", () => {
    const days = Array.from({ length: 10 }, (_, i) => ({ date: `${String(i + 1).padStart(2, "0")}/10/2026`, pluie_mm: i === 4 ? undefined : 2, tmin: 20, tmax: i === 4 ? undefined : 28, soleil_h: i === 4 ? undefined : 6, soleil_pct: i === 2 ? 10 : 60 }));
    const row = { zone: "nord", station: "Une station", altitude_m: 10, lon: 55.5, lat: -21, jours: days, normale_jour: { pluie_mm: days.map(() => 1), tmax: days.map(() => 27), tmin: days.map(() => 19), soleil_h: days.map(() => 7) } };
    const out = graphes({ resume: "", periode: { du: "01/10/2026", au: "10/10/2026", jours: 10 }, stations: [row], a_savoir: [], sources: [] });
    const rain = out.match(/<path class="ln-p" d="([^"]+)"/)![1];
    // The line stops at the 4th day and starts again at the 6th: two pieces, 9 points.
    expect(rain.match(/M/g)).toHaveLength(2);
    expect(rain.match(/[ML]/g)).toHaveLength(9);
    expect(out.match(/<path class="ln-t" d="([^"]+)"/)![1].match(/M/g)).toHaveLength(2);
    expect(out.match(/<rect class="br g"/g)).toHaveLength(1);
    expect(out.match(/<circle class="mk"/g)).toHaveLength(1);
    expect(out).toContain('data-s="2,2,2,2,,2,2,2,2,2;');
  });
});

describe("« Il fait plus chaud qu'avant ? »", () => {
  it("gives each year at Gillot against the 1991-2020 normal, from the build, never read at a view", () => {
    const ys = chaud.annees as [number, number][];
    expect(chaud.poste).toBe("97418110");
    expect(ys[0][0]).toBe(1953);
    ys.forEach(([y], i) => i && expect(y).toBeGreaterThan(ys[i - 1][0]));
    // The normal is the mean of the years 1991-2020: their gaps sum to about nothing.
    const ref = ys.filter(([y]) => y >= 1991 && y <= 2020);
    expect(ref).toHaveLength(30);
    expect(Math.abs(ref.reduce((s, [, g]) => s + g, 0) / ref.length)).toBeLessThan(0.01);
    const svg = warmer();
    expect(svg.match(/<rect class="up"/g)).toHaveLength(ys.filter(([, g]) => g >= 0).length);
    expect(svg.match(/<rect class="dn"/g)).toHaveLength(ys.filter(([, g]) => g < 0).length);
    expect(svg).toMatch(/aria-label="Écart de la température moyenne de chaque année à la normale 1991-2020 \(24,45 °C\), mesuré par Météo-France à Saint-Denis Gillot \(aéroport\), de 1953 à \d{4}/);
    expect(svg).toContain("Mesures brutes de la station, sans correction d'un changement d'abri ou d'emplacement.");
    expect(gzipSync(svg).length).toBeLessThan(3000);
  });

  it("says the figures of the JSON built, never typed: the first and last ten years, the warmest", () => {
    const ys = chaud.annees as [number, number][];
    const mean = (xs: [number, number][]) => xs.reduce((s, [, g]) => s + g, 0) / xs.length;
    const said = (v: number) => `${v > 0 ? "+" : "\u2212"}${Math.abs(Math.round(v * 10) / 10).toString().replace(".", ",")}\u00a0°C`;
    const hot = ys.reduce((b, v) => (v[1] > b[1] ? v : b));
    const first = ys.slice(0, 10), last = ys.slice(-10);
    const text = warmer().match(/<div class="sec-h">.*?<\/div>/s)![0];
    expect(text).toContain(`(${chaud.normale_c.toString().replace(".", ",")}\u00a0°C)`);
    expect(text).toContain(`De ${first[0][0]} à ${first[9][0]}\u00a0: ${said(mean(first))} en moyenne.`);
    expect(text).toContain(`De ${last[0][0]} à ${last[9][0]}\u00a0: ${said(mean(last))}.`);
    expect(text).toContain(`Année la plus chaude\u00a0: ${hot[0]}, ${said(hot[1])}.`);
    // As built on 31/10/2026 (scripts/build-plus-chaud.py): −0,84 °C, +0,48 °C, 2019 at +0,89 °C.
    expect(text).toContain("De 1953 à 1962\u00a0: \u22120,8\u00a0°C en moyenne. De 2016 à 2025\u00a0: +0,5\u00a0°C. Année la plus chaude\u00a0: 2019, +0,9\u00a0°C.");
  });
});
