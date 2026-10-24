import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { frenchDays, parisDay, parseGolf, parseLsar, parseNews, parseVolley } from "../src/providers/sport.js";
import { sportTool, window } from "../src/tools/sport.js";

// The sources on Saturday 24/10/2026 in the morning: the Grand Raid over since the 18th, the 6th round of handball on
// the 30th (the 5th played on the 9th to 11th), volley R1 played on Friday night and again tonight, a rally this
// weekend, a regatta at Saint-Paul next weekend.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/sport/${f}`, import.meta.url));
const NOW = new Date("2026-10-24T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());

function file(url: string): string | undefined {
  if (url.includes("livetrail")) return url.endsWith("global-event") ? "livetrail_event.json" : url.endsWith("summaries") ? "livetrail_summaries.json" : "livetrail_lives.json";
  if (url.includes("ffhandball")) return `ffhb_d1${url.includes("masculin") ? "sm" : "sf"}${url.includes("journee-5") ? "_j5" : ""}.html`;
  if (url.includes("ffvbbeach")) return url.endsWith("R1M") ? "ffvb_r1m.html" : "ffvb_r1f.html";
  if (url.includes("ffvoile")) return "ffvoile.json";
  if (url.includes("ffgolf")) return "ffgolf.json";
  if (url.includes("lsar")) return "lsar.json";
  if (url.includes("la1ere")) return "la1ere_sport.xml";
}

describe("sport", () => {
  let down: RegExp | undefined;
  beforeEach(() => {
    down = undefined;
    vi.stubGlobal("fetch", async (url: string) => {
      const f = file(url);
      return f && !down?.test(url) ? new Response(fixture(f)) : new Response("", { status: 503 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the dates of each source in local time", () => {
    expect(parisDay("2026-10-24T22:00:00Z")).toBe("2026-10-25");
    expect(parisDay("2026-10-25T21:59:59Z", true)).toBe("2026-10-25");
    expect(frenchDays("24/25/26 juillet 2026")).toEqual({ debut: "2026-07-24", fin: "2026-07-26" });
    expect(frenchDays("28 février/1er mars 2026")).toEqual({ debut: "2026-02-28", fin: "2026-03-01" });
    expect(window("ce_week_end", NOW)).toEqual({ du: "2026-10-24", au: "2026-10-25" });
    expect(window("ce_week_end", new Date("2026-10-21T04:00:00Z"))).toEqual({ du: "2026-10-23", au: "2026-10-25" });
  });

  it("parses a volley results page, its sets, halls and standings", () => {
    const v = parseVolley(new TextDecoder("latin1").decode(fixture("ffvb_r1m.html")));
    expect(v.matchs).toHaveLength(90);
    expect(v.matchs.find((m) => m.domicile === "VBC ST LEU" && m.date === "2026-10-23T20:30")).toMatchObject({ exterieur: "VBSP", score: "0-3", detail: "21:25, 20:25, 22:25" });
    expect(v.matchs.find((m) => m.date === "2026-10-24T20:00" && m.domicile === "VB2CO")).toMatchObject({ salle: "PLATEAU CAILLOU", score: undefined });
    expect(v.classement[0]).toEqual({ place: 1, equipe: "VBSP", points: 9, joues: 3 });
  });

  it("parses the golf, motor sport and news sources", () => {
    const g = parseGolf(JSON.parse(fixture("ffgolf.json").toString()));
    expect(g[1]).toMatchObject({ nom: "TROPHEES ROSES 2026 - ODYSSEA", debut: "2026-10-25", fin: "2026-10-25", commune: "L'Étang-Salé" });
    const l = JSON.parse(fixture("lsar.json").toString());
    const auto = parseLsar(l.content.rendered, l.link);
    expect(auto.find((e) => e.nom.startsWith("Rallye National Ronde"))).toMatchObject({ debut: "2026-09-05", fin: "2026-09-06", etat: "annulée", detail: "Rallyes" });
    expect(auto.find((e) => /1000 KM/.test(e.nom))).toMatchObject({ debut: "2026-12-05", fin: "2026-12-06" });
    const n = parseNews(fixture("la1ere_sport.xml").toString());
    expect(n).toHaveLength(30);
    expect(n[0]).toMatchObject({ titre: "Les cyclistes de l'île Maurice brillent au Kenya pour les championnats d'Afrique 2026", rubrique: "cyclisme" });
  });

  it("gives what is on and the latest results across the island, and the Grand Raid in its season", async () => {
    const b = body(await sportTool(cache(), undefined, undefined, undefined, NOW));
    expect(b.a_venir.some((r: { epreuve: string; quand: string }) => r.epreuve === "VB2CO – SVB" && r.quand === "samedi 24/10 à 20:00")).toBe(true);
    expect(b.a_venir.some((r: { sport: string; quand: string }) => r.sport === "sport auto" && r.quand === "du samedi 24/10 au dimanche 25/10")).toBe(true);
    expect(b.resultats.map((r: { score: string }) => r.score)).toContain("3-0");
    expect(b.grand_raid.courses[0]).toMatchObject({ course: "Diagonale des fous (180 km, 10200 m D+)", partants: 2766, arrives: 2126, abandons: 640 });
    expect(b.grand_raid.courses[0].podium[0]).toBe("1. Hugo DECK (FR) 22 h 54 min");
    expect(b.indisponible).toBeUndefined();
  });

  it("gives the last handball round and the standings", async () => {
    const b = body(await sportTool(cache(), "handball", undefined, "resultats", NOW));
    expect(b.a_venir).toBeUndefined();
    expect(b.resultats.find((r: { epreuve: string }) => r.epreuve === "Saint Pierre Handball Club – Case Cressonniere")).toMatchObject({ score: "31-27", quand: "vendredi 09/10 à 20:30", competition: "D1 masculine" });
    expect(b.classements[0].classement[0]).toBe("1. Saint Pierre Handball Club 14 pts (5 j)");
    expect(b.grand_raid).toBeUndefined();
  });

  it("keeps the events of a commune", async () => {
    const b = body(await sportTool(cache(), undefined, "Saint-Paul", "a_venir", NOW));
    const names = b.a_venir.map((r: { epreuve: string }) => r.epreuve);
    expect(names).toContain("Coupe regional de la réunion");
    expect(b.a_venir.every((r: { lieu: string }) => /Bassin Bleu|SAINT PAUL/i.test(r.lieu))).toBe(true);
  });

  it("says football has no official source and gives the news", async () => {
    const b = body(await sportTool(cache(), "football", undefined, undefined, NOW));
    expect(b.resume).toMatch(/^Les résultats officiels du football \(FFF, Ligue réunionnaise\) ne sont pas lisibles par ce service\./);
    expect(b.a_venir).toBeUndefined();
  });

  it("answers without a source that is down, and names it", async () => {
    down = /ffhandball/;
    const b = body(await sportTool(cache(), undefined, undefined, undefined, NOW));
    expect(b.indisponible).toEqual(["Handball : championnats régionaux de la Ligue de La Réunion (FFHB)"]);
    expect(b.a_venir.some((r: { sport: string }) => r.sport === "volley-ball")).toBe(true);
  });
});
