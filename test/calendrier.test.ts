import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { breaks, parisDate, schoolBreaks, sun } from "../src/providers/calendrier.js";
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
    expect(html).toContain(`content="Vacances scolaires 2026-2027 à La Réunion (974), calendrier austral : vacances en cours du 10 octobre au 25 octobre. Jours fériés dont le 20 décembre.">`);
    expect(html).toMatch(/Vacances après 1ère période <span class="badge m">en cours<\/span><\/th><td>samedi 10 octobre 2026<\/td><td>lundi 26 octobre 2026<\/td>/);
    expect(html).toContain("Vacances d&#39;Été austral");
  });
});
