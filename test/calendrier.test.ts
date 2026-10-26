import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { breaks, moon, moonLight, nextPhases, parisDate, schoolBreaks, sun } from "../src/providers/calendrier.js";
import { calendrier, longDate } from "../src/tools/calendrier.js";
import { buildCalendrier } from "../src/web/data.js";
import { calendrierPage } from "../src/web/domains.js";

const fixture = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

function cacheAt(now: Date) {
  const store = new MemoryStore();
  void store.put("calendrier:scolaire", { value: breaks(fixture("calendrier_scolaire.json").results), fetchedAt: now.getTime() });
  void store.put(`calendrier:feries:${now.getUTCFullYear()}`, { value: fixture("jours_feries.json"), fetchedAt: now.getTime() });
  return new Cache(store, () => now.getTime());
}

describe("calendar", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the latest school years when the ministry has more than the 100 rows the API gives", async () => {
    // 35 school years of 5 breaks: 175 rows, sorted and cut to the limit as the API does.
    const rows = Array.from({ length: 35 }, (_, k) => 1993 + k).flatMap((y) =>
      ["Vacances après 1ère période", "Vacances de Noël", "Vacances après 3ème période", "Vacances après 4ème période", "Début des Vacances d'Hiver austral"].map((description, i) => {
        const start = new Date(Date.UTC(y + (i ? 1 : 0), [9, 11, 2, 4, 6][i], 10, 22)).toISOString().replace(".000Z", "+00:00");
        return { description, start_date: start, end_date: start, annee_scolaire: `${y}-${y + 1}` };
      }));
    let asked = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      const u = new URL(url);
      expect(u.hostname).toBe("data.education.gouv.fr");
      asked++;
      const [field, dir] = u.searchParams.get("order_by")!.split(" ");
      const sorted = [...rows].sort((x, y) => (x as Record<string, string>)[field].localeCompare((y as Record<string, string>)[field]) * (dir === "desc" ? -1 : 1));
      return new Response(JSON.stringify({ total_count: rows.length, results: sorted.slice(0, Number(u.searchParams.get("limit"))) }));
    });
    const now = new Date("2026-10-25T08:00:00Z");
    const got = (await schoolBreaks(new Cache(new MemoryStore(), () => now.getTime()))).value;
    expect(asked).toBe(1);
    expect(got).toHaveLength(100);
    const years = new Set(got.map((b) => b.annee_scolaire));
    expect(years).toContain("2026-2027");
    expect(years).toContain("2027-2028");
    expect(got.at(-1)!.annee_scolaire).toBe("2027-2028");
    // Still in order, the oldest first.
    expect(got.map((b) => b.debut)).toEqual([...got.map((b) => b.debut)].sort());
  });

  it("reads the ministry's dates as Paris midnights", () => {
    expect(parisDate("2026-10-09T22:00:00+00:00")).toBe("2026-10-10");
    expect(parisDate("2026-10-25T23:00:00+00:00")).toBe("2026-10-26");
    expect(longDate("2026-12-20")).toBe("dimanche 20 décembre 2026");
  });

  it("computes sunrise and sunset within a few minutes of the almanac", () => {
    const s = sun("2026-10-23", 55.45, -20.88);
    expect(s.lever.toISOString().slice(11, 16)).toBe("01:41");
    expect(s.coucher.toISOString().slice(11, 16)).toBe("14:23");
  });

  // The Moon by PyEphem 4.2 (full theory, 1010 hPa, 25 °C), local times: rising, setting, % lit at local noon.
  const EPHEM: [string, number, number, string, string, number][] = [
    ["2026-10-26", 55.4481, -20.8789, "18:49", "05:23", 99.81],
    ["2026-10-30", 55.4481, -20.8789, "23:12", "09:05", 77.6],
    ["2026-11-03", 55.4481, -20.8789, "01:36", "13:19", 33.91],
    ["2026-11-09", 55.4481, -20.8789, "05:11", "18:47", 0.19],
    ["2026-11-15", 55.4481, -20.8789, "10:08", "23:42", 30.18],
    ["2026-11-20", 55.4481, -20.8789, "14:31", "02:01", 77.42],
    ["2027-01-14", 55.4481, -20.8789, "11:06", "23:05", 34.55],
    ["2027-06-21", 55.4481, -20.8789, "19:50", "08:40", 95.21],
    ["2026-10-30", 55.4781, -21.3393, "23:13", "09:04", 77.6],
    ["2026-11-15", 55.4781, -21.3393, "10:07", "23:43", 30.18],
    ["2027-06-21", 55.4781, -21.3393, "19:49", "08:41", 95.21],
  ];
  const minutes = (d: Date) => (d.getTime() + 4 * 3600_000) / 60_000 % 1440;
  const hhmm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

  it("computes moonrise, moonset and how much is lit within two minutes and a point of an ephemeris", () => {
    for (const [day, lon, lat, lever, coucher, lit] of EPHEM) {
      const m = moon(day, lon, lat);
      expect(Math.abs(minutes(m.lever!) - hhmm(lever)), `${day} lever`).toBeLessThanOrEqual(2);
      expect(Math.abs(minutes(m.coucher!) - hhmm(coucher)), `${day} coucher`).toBeLessThanOrEqual(2);
      expect(Math.abs(moonLight(new Date(`${day}T12:00:00+04:00`)).fraction * 100 - lit)).toBeLessThan(1);
    }
  });

  it("says when the Moon does not rise or set that day", () => {
    expect(moon("2026-10-31", 55.4481, -20.8789).lever).toBeNull();
    expect(moon("2026-11-16", 55.4481, -20.8789).coucher).toBeNull();
  });

  it("finds the main phases of the Moon within five minutes of an ephemeris", () => {
    const ephem = [
      ["dernier quartier", "2026-10-03T13:24Z"], ["nouvelle lune", "2026-10-10T15:50Z"], ["premier quartier", "2026-10-18T16:12Z"],
      ["pleine lune", "2026-10-26T04:11Z"], ["dernier quartier", "2026-11-01T20:28Z"], ["nouvelle lune", "2026-11-09T07:02Z"],
      ["premier quartier", "2026-11-17T11:47Z"], ["pleine lune", "2026-11-24T14:53Z"], ["dernier quartier", "2026-12-01T06:08Z"],
      ["nouvelle lune", "2026-12-09T00:51Z"], ["premier quartier", "2026-12-17T05:42Z"], ["pleine lune", "2026-12-24T01:28Z"],
    ];
    const got = nextPhases(new Date("2026-10-01T00:00:00Z"), 12);
    got.forEach((p, i) => {
      expect(p.phase).toBe(ephem[i][0]);
      expect(Math.abs(p.at.getTime() - Date.parse(ephem[i][1])) / 60_000).toBeLessThanOrEqual(5);
    });
  });

  it("tells the Moon of the day, computed, with the next phases", async () => {
    const now = new Date("2026-10-26T14:10:00Z");
    const r = body(await calendrier(cacheAt(now), "Saint-Denis", now));
    // Saint-Denis at 34 m: its horizon a little lower than the sea level of the ephemeris above.
    expect(r.resume).toContain("Lune : pleine lune à 08:13, éclairée à 100 %, coucher à 05:24, lever à 18:48 (calcul astronomique).");
    expect(r.lune).toMatchObject({ lieu: "Saint-Denis", phase: "pleine lune à 08:13", eclairee_pct: 100, lever: "18:48", coucher: "05:24" });
    expect(r.lune.prochaines_phases[0]).toEqual({ phase: "dernier quartier", date: "lundi 2 novembre 2026", heure: "00:30" });
    expect(r.lune.note).toMatch(/^Calculé, pas mesuré : .* elle s'y lève plus tard et s'y couche plus tôt\.$/);
    // No rising that day: said, and left out of the summary.
    const later = new Date("2026-10-31T08:00:00Z");
    const l = body(await calendrier(cacheAt(later), "Saint-Denis", later));
    expect(l.lune.lever).toBe("pas de lever de Lune ce jour");
    expect(l.resume).toMatch(/Lune : Lune décroissante, éclairée à \d+ %, coucher à 10:1\d \(calcul astronomique\)\./);
  });

  it("says holidays under way, the next public holiday and the sun", async () => {
    const now = new Date("2026-10-22T23:30:00Z");
    const r = body(await calendrier(cacheAt(now), "Maïdo", now));
    expect(r.resume).toContain("Nous sommes le vendredi 23 octobre 2026 à La Réunion.");
    expect(r.resume).toContain("Prochain jour férié : Toussaint, dimanche 1er novembre 2026 (dans 9 jours).");
    expect(r.resume).toContain("Vacances scolaires en cours (Vacances après 1ère période) : reprise des cours le lundi 26 octobre 2026.");
    expect(r.soleil.lieu).toMatch(/Maïdo/);
    expect(r.jours_feries.prochains.map((x: { nom: string }) => x.nom)).toContain("Abolition de l'esclavage");
  });

  it("lists every break of the school year on the page, aimed at « vacances scolaires Réunion 2026-2027 »", async () => {
    const now = new Date("2026-10-22T23:30:00Z");
    const data = { value: await buildCalendrier(cacheAt(now), now), fetchedAt: now };
    expect(data.value.annees_scolaires?.map((a) => a.annee)).toEqual(["2026-2027"]);
    const html = calendrierPage("https://rundata.re", data, now);
    expect(html).toContain("<title>Vacances scolaires Réunion 2026-2027, jours fériés · 974</title>");
    expect(html).toContain("<h1>Vacances scolaires et jours fériés à La Réunion</h1>");
    expect(html).toContain(`<h2 id="h-vac-0">Vacances scolaires 2026-2027 (académie de La Réunion)</h2>`);
    expect(html).toContain(`content="Vacances scolaires 2026-2027 à La Réunion (974), calendrier austral\u00a0: vacances en cours du 10 octobre au 25 octobre. Jours fériés dont le 20 décembre.">`);
    expect(html).toMatch(/Vacances après 1ère période <span class="badge m">en cours<\/span><\/th><td>samedi 10 octobre 2026<\/td><td>lundi 26 octobre 2026<\/td>/);
    expect(html).toContain("Vacances d&#39;Été austral");
  });
});
