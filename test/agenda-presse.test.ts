import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { type Fil, type Info, parseImazLive } from "../src/providers/actualites.js";
import type { Evenement } from "../src/providers/agenda.js";
import { annonces, distinctive, withNews } from "../src/providers/agenda-presse.js";
import { parseKabardock } from "../src/providers/salles.js";
import { agenda } from "../src/tools/agenda.js";

// The Kabardock read as if it had agreed (test/non-reprises.test.ts says what is said until it does).
vi.mock("../src/providers/autorisations.js", () => import("./autorisees.js"));

// Saturday 24/10/2026, a day of mobilisation: Imaz Press's live blog says « À Saint-Pierre, le Festival Mizik O Marmay
// est annulé, tandis qu'au Port, le concert de Cédric "Analyse" est reporté au 5 décembre » (entry of 10:27).
const NOW = new Date("2026-10-24T08:05:00Z");
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const live = () => parseImazLive(fixture("actualites/imaz_live.html"), "https://imazpress.com/live", NOW);
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

const event = (titre: string, commune: string, debut: string, extra: Partial<Evenement> = {}): Evenement => ({
  id: `${titre}|${commune}|${debut}`, titre, commune, seances: [{ debut }], categories: [], lien: "https://example.re/e", publie_par: "test", ...extra,
});

describe("events cancelled or postponed by the news", () => {
  it("reads the two announcements of the live blog, clause by clause, with the new date", () => {
    const list = annonces(live(), NOW);
    expect(list.map(({ statut, commune, reporte_au, media }) => ({ statut, commune, reporte_au, media }))).toEqual([
      { statut: "annulé", commune: "Saint-Pierre", reporte_au: undefined, media: "Imaz Press" },
      { statut: "reporté", commune: "Le Port", reporte_au: "2026-12-05", media: "Imaz Press" },
    ]);
    // The headline « Plusieurs événements… annulés ou reportés » says no event: no verb, no commune.
    expect(annonces([{ ...live()[0], resume: undefined, extraits: undefined }], NOW)).toEqual([]);
  });

  it("marks the Kabardock's concert postponed, from Imaz Press, the organiser's page having moved it already", () => {
    const kab = parseKabardock(fixture("agenda/kabardock.html"), NOW);
    const cedric = kab.find((e) => /analyse/i.test(e.titre))!;
    expect(cedric.commune).toBe("Le Port");
    expect(cedric.statut).toBeUndefined();
    const marked = withNews(kab, live(), NOW);
    const after = marked.find((e) => e.id === cedric.id)!;
    expect(after.statut).toBe("reporté");
    expect(after.reporte_au).toBe("2026-12-05");
    expect(after.selon).toEqual({ media: "Imaz Press", lien: "https://imazpress.com/live", publie: expect.any(String) });
    // Nothing else of the Kabardock's programme is touched.
    expect(marked.filter((e) => e.statut).length).toBe(kab.filter((e) => e.statut).length + 1);
  });

  it("marks the festival cancelled in Saint-Pierre only, by its own words, near the news", () => {
    const list = [
      event("Festival Mizik O Marmay", "Saint-Pierre", "2026-10-24T14:00"),
      // Same name elsewhere, or months later: another event.
      event("Festival Mizik O Marmay", "Saint-Louis", "2026-10-24T14:00"),
      event("Festival Mizik O Marmay", "Saint-Pierre", "2027-03-20"),
      // « marmay » alone, or only generic words, is not enough.
      event("Activités marmay", "Saint-Pierre", "2026-10-24"),
      event("Festival de la musique", "Saint-Pierre", "2026-10-24"),
      event("Concert", "Le Port", "2026-10-24T20:00"),
    ];
    const out = withNews(list, live(), NOW);
    expect(out.map((e) => e.statut ?? null)).toEqual(["annulé", null, null, null, null, null]);
    expect(distinctive("Cédric « Analyse » et ses invités")).toEqual(["cedric", "analyse"]);
    expect(distinctive("Festival de la musique")).toEqual([]);
  });

  it("keeps the organiser's own state, and needs the news to be recent", () => {
    const own = event("Festival Mizik O Marmay", "Saint-Pierre", "2026-10-24", { statut: "annulé" });
    expect(withNews([own], live(), NOW)[0].selon).toBeUndefined();
    // « Complet » on the organiser's page, cancelled in the news: cancelled.
    expect(withNews([{ ...own, statut: "complet" }], live(), NOW)[0].statut).toBe("annulé");
    const old = live().map((i): Info => ({ ...i, publie: "2026-10-20T06:00:00.000Z" }));
    expect(withNews([event("Festival Mizik O Marmay", "Saint-Pierre", "2026-10-24")], old, NOW)[0].statut).toBeUndefined();
  });
});

describe("the evenements tool and the news", () => {
  let asked: string[];
  beforeEach(() => {
    asked = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      return url.includes("kabardock") ? new Response(fixture("agenda/kabardock.html")) : new Response("", { status: 503 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());
  const withFil = async () => {
    const c = cache();
    await c.get<Fil>("actualites:fil", 300, async () => ({ infos: live(), prefecture: [], indisponible: [] }));
    return c;
  };

  it("says who announced the postponement, from the news already read", async () => {
    const r = body(await agenda(await withFil(), "Le Port", "2026-12-05", undefined, NOW));
    const row = r.evenements.find((e: { titre: string }) => /analyse/i.test(e.titre));
    expect(row.statut).toBe("REPORTÉ");
    expect(row.statut_d_apres).toEqual({ media: "Imaz Press", lien: "https://imazpress.com/live" });
    expect(row.reporte_au).toBe("samedi 05/12");
    expect(r.resume).toContain("reporté au samedi 05/12 (d'après Imaz Press)");
    // No feed of the news is read for this.
    expect(asked.some((u) => /imazpress|clicanoo|la1ere|freedom|parallelesud|temoignages|reunion\.gouv/.test(u))).toBe(false);
  });

  it("without a copy of the news, tells what the organisers say, and fetches no news", async () => {
    const r = body(await agenda(cache(), "Le Port", "2026-12-05", undefined, NOW));
    const row = r.evenements.find((e: { titre: string }) => /analyse/i.test(e.titre));
    expect(row.statut).toBeUndefined();
    expect(asked.some((u) => /imazpress|clicanoo|la1ere/.test(u))).toBe(false);
  });
});
