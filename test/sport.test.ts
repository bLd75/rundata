import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_BUDGET, count, counted } from "../src/budget.js";
import { Cache, MemoryStore, type CacheEntry } from "../src/cache.js";
import { parseRss, type Info } from "../src/providers/actualites.js";
import { parseSportsregions } from "../src/providers/agenda.js";
import { frenchDays, parisDay, parseGolf, parseLsar, parseVolley } from "../src/providers/sport.js";
import { avisIn, avisPresse, daysIn, parseLrvb } from "../src/providers/sport-avis.js";
import { clubOf, clubsNamed, zoneOf } from "../src/sport/clubs.js";
import { quand, sportTool, window } from "../src/tools/sport.js";
import { sportPage } from "../src/web/domains.js";
import type { SportAnswer } from "../src/web/data.js";
import { withVide } from "../src/vide.js";

// The communes' sites read, as once they have agreed (test/autorisations.test.ts for what is said until then).
vi.mock("../src/providers/autorisations.js", () => import("./autorisees.js"));

// The sources on Saturday 24/10/2026 in the morning: the Grand Raid over since the 18th, the 6th round of handball on
// the 30th (the 5th played on the 9th to 11th), volley R1 played on Friday night and again tonight, a rally this
// weekend, a regatta at Saint-Paul next weekend. Volley: the five pools of the league (R1M, R1F, R2F, 2MA, 2MB); the
// league's home page with its notice of the 23rd (« toutes les rencontres … prévues ce samedi 24 octobre 2026 sont
// annulées » because of a strike; Friday and Sunday kept), which the FFVB's pages do not show.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/sport/${f}`, import.meta.url));
const NOW = new Date("2026-10-24T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());
const latin1 = (f: string) => new TextDecoder("latin1").decode(fixture(f));
/** A cache holding a copy of the news, as the `actualites` tool leaves it. */
async function withNews(infos: Info[]) {
  const store = new MemoryStore();
  await store.put("actualites:fil", { value: { infos, prefecture: [], indisponible: [] }, fetchedAt: NOW.getTime() });
  return new Cache(store, () => NOW.getTime());
}
/** A cache holding the agendas' copy as `evenements` leaves it, with the sports programmes of three communes and an event. */
function withAgendas() {
  const store = new MemoryStore();
  const at = NOW.getTime() - 3600_000;
  const evt = (id: string, titre: string, debut: string, fin: string, commune: string, publie_par: string, lien: string) =>
    ({ id, titre, seances: [{ debut, fin }], commune, categories: [], lien, publie_par });
  void store.put("agendas", {
    value: {
      "agenda:la_possession": { value: [evt("p:1", "Agenda sportif du 22 au 24 octobre", "2026-10-22", "2026-10-24", "La Possession", "Ville de La Possession", "https://www.lapossession.re/agenda/890500")], fetchedAt: at },
      "agenda:etang_sale": { value: [evt("e:1", "Planning des compétitions sportives du 23 au 25 octobre 2026", "2026-10-23", "2026-10-25", "L'Étang-Salé", "Ville de L'Étang-Salé", "https://www.letangsale.fr/planning")], fetchedAt: at },
      "agenda:saint_benoit": { value: [
        evt("b:1", "Agenda sportif", "2026-10-23", "2026-10-25", "Saint-Benoît", "Ville de Saint-Benoît", "https://www.saint-benoit.re/evenements/articles/9592-agenda-sportif"),
        evt("b:2", "Agenda sportif", "2026-10-16", "2026-10-18", "Saint-Benoît", "Ville de Saint-Benoît", "https://www.saint-benoit.re/evenements/articles/9500-agenda-sportif"),
      ], fetchedAt: at },
      "agenda:bras_panon": { value: [evt("r:1", "1er Rally National Grand Est", "2026-10-24", "2026-10-25", "Bras-Panon", "Ville de Bras-Panon", "https://www.braspanon.re/rally")], fetchedAt: at },
    },
    fetchedAt: at,
  });
  return new Cache(store, () => NOW.getTime());
}
const info = (titre: string, publie: string, extra: Partial<Info> = {}): Info =>
  ({ titre, media: "Clicanoo", lien: `https://www.clicanoo.re/article/sport/${publie.slice(0, 10)}/x`, publie, heure: true, communes: [], lieux: [], sujets: ["sport"], ...extra });

function file(url: string): string | undefined {
  if (url.includes("livetrail")) return url.endsWith("global-event") ? "livetrail_event.json" : url.endsWith("summaries") ? "livetrail_summaries.json" : "livetrail_lives.json";
  if (url.includes("ffhandball")) return `ffhb_d1${url.includes("masculin") ? "sm" : "sf"}${url.includes("journee-5") ? "_j5" : ""}.html`;
  if (url.includes("ffvbbeach")) return `ffvb_${url.split("poule=")[1].toLowerCase()}.html`;
  if (url.includes("lrvb.re")) return "lrvb_home.html";
  if (url.includes("ffvoile")) return "ffvoile.json";
  if (url.includes("ffgolf")) return "ffgolf.json";
  if (url.includes("lsar")) return "lsar.json";
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

  it("reads the R2 pools, without the teams that rest", () => {
    const r2f = parseVolley(latin1("ffvb_r2f.html"), "R2F");
    expect(r2f.matchs.some((m) => /x{3}/i.test(m.domicile + m.exterieur))).toBe(false);
    expect(r2f.matchs.find((m) => m.date === "2026-10-25T17:00")).toMatchObject({ domicile: "SDOVB 2", exterieur: "TGV 2A", salle: "SAINT-FRANCOIS", poule: "R2F" });
    const ma = parseVolley(latin1("ffvb_2ma.html"), "2MA");
    expect(ma.matchs.filter((m) => m.date.startsWith("2026-10-25")).map((m) => `${m.domicile} – ${m.exterieur}`)).toEqual(["USAB 3 – TGV 2", "PAC – ALN BP VB"]);
    expect(parseVolley(latin1("ffvb_2mb.html"), "2MB").matchs.length).toBeGreaterThan(20);
  });

  it("knows the clubs behind the acronyms, and the parts of the island", () => {
    expect(clubOf("volley", "VBSP 2")).toMatchObject({ nom: "Volley-Ball de Saint-Pierre", commune: "Saint-Pierre" });
    expect(clubOf("volley", "TGV 2A")?.commune).toBe("Le Tampon");
    expect(clubOf("volley", "VBC ST LEU 2")?.commune).toBe("Saint-Leu");
    expect(clubOf("handball", "Saint Pierre Handball Club 1")?.commune).toBe("Saint-Pierre");
    expect(clubsNamed("vbsp").map((c) => c.club.sigle)).toEqual(["VBSP"]);
    expect(clubsNamed("Tampon Gecko Volley").map((c) => c.club.sigle)).toEqual(["TGV"]);
    expect(clubsNamed("le TGV").map((c) => c.club.sigle)).toEqual(["TGV"]);
    // A town names no club: « Saint-Denis » is the town of two volley clubs and four handball ones.
    expect(clubsNamed("Saint-Denis")).toEqual([]);
    expect(zoneOf("dans le sud")?.communes).toContain("Le Tampon");
    expect(zoneOf("l'Ouest")?.nom).toBe("Ouest");
    expect(zoneOf("Saint-Pierre")).toBeUndefined();
  });

  it("reads the days a notice names, and only what it calls off", () => {
    expect(daysIn("prévues ce samedi 24 octobre 2026 sont annulées", "2026-10-23", false)).toEqual(["2026-10-24"]);
    expect(daysIn("les rencontres du vendredi 23 et du dimanche 25 octobre", "2026-10-23", false)).toEqual(["2026-10-23", "2026-10-25"]);
    expect(daysIn("match du 31/10/26 à 20:30", "2026-10-23", false)).toEqual(["2026-10-31"]);
    expect(daysIn("les compétitions ce samedi", "2026-10-24", true)).toEqual(["2026-10-24"]);
    expect(daysIn("les compétitions ce samedi", "2026-10-24", false)).toEqual([]);
    const meta = { source: "LRVB", lien: "https://lrvb.re/", ref: "2026-10-23", relative: false, sport: "volley" as const };
    expect(avisIn("✅ Sont maintenues :les rencontres indoor du vendredi 23 et du dimanche 25 octobre", meta)).toEqual([]);
    expect(avisIn("Les tournois de beach-volley du samedi 24 octobre sont annulés.", meta)).toEqual([]);
    expect(avisIn("Le match R1M TGV / RCO du samedi 31 octobre est reporté au dimanche 1er novembre.", meta)[0]).toMatchObject({
      statut: "reporté", jours: ["2026-10-31"], reporte_au: "2026-11-01", tous: false, equipes: ["TGV", "RCO"], poules: ["R1M"],
    });
    const lrvb = parseLrvb(fixture("lrvb_home.html").toString(), NOW);
    expect(lrvb).toHaveLength(1);
    expect(lrvb[0]).toMatchObject({ statut: "annulé", jours: ["2026-10-24"], tous: true, a_rejouer: true, lien: "https://www.facebook.com/655290129938154/posts/1770758655057957" });
  });

  it("finds the clubs of Saint-Pierre, and the matches of the south played away", async () => {
    const b = body(await sportTool(cache(), "volley", "Saint-Pierre", "a_venir", NOW));
    const vbsp = b.a_venir.filter((r: { epreuve: string }) => /VBSP/.test(r.epreuve));
    expect(vbsp.length).toBe(b.a_venir.length);
    expect(b.a_venir.find((r: { epreuve: string }) => r.epreuve === "VBSP 2 – TGV 2B")).toMatchObject({
      equipes: "Volley-Ball de Saint-Pierre (2) – Tampon Gecko Volley (2B)",
      lieu: "Gymnase Axel Ablancourt, Saint-Pierre",
      commune: "Saint-Pierre",
    });
    expect(b.a_venir.find((r: { epreuve: string }) => r.epreuve === "TGV – VBSP")).toMatchObject({ commune: "Le Tampon", deplacement: "club de Saint-Pierre en déplacement au Tampon" });
    // « volley dimanche dans le sud »: none is played in the south; the Tampon plays at Saint-Paul and Saint-Denis.
    const away = await withVide("sport", () => sportTool(cache(), "volley", "le sud", "dimanche", NOW));
    const s = body(away.value);
    // Its clubs playing away are an answer: not counted as a question left without one (vide.ts).
    expect(away.vide).toBe(false);
    expect(s.resume).toBe("Aucun rendez-vous de volley-ball trouvé dans le Sud dimanche 25/10\u00a0; 2 matchs de clubs du Sud à l'extérieur.");
    expect(s.a_venir.map((r: { epreuve: string; commune: string }) => `${r.epreuve} (${r.commune})`)).toEqual(["USAB 3 – TGV 2 (Saint-Paul)", "SDOVB 2 – TGV 2A (Saint-Denis)"]);
    const club = body(await sportTool(cache(), undefined, "VBSP", "a_venir", NOW));
    expect(club.a_venir.every((r: { epreuve: string }) => /VBSP/.test(r.epreuve))).toBe(true);
    expect(club.lieu).toMatchObject({ trouve: "du VBSP (Volley-Ball de Saint-Pierre)" });
  });

  it("gives every match of a Sunday, R2 included, and says when the data was read", async () => {
    const b = body(await sportTool(cache(), "volley", undefined, "dimanche", NOW));
    expect(b.resume).toBe("3 rendez-vous de volley-ball à La Réunion dimanche 25/10.");
    expect(b.a_venir.map((r: { epreuve: string; competition: string; quand: string }) => `${r.quand} ${r.epreuve} (${r.competition})`)).toEqual([
      "dimanche 25/10 à 15:00 PAC – ALN BP VB (R2 masculine, poule A)",
      "dimanche 25/10 à 16:00 USAB 3 – TGV 2 (R2 masculine, poule A)",
      "dimanche 25/10 à 17:00 SDOVB 2 – TGV 2A (R2 féminine)",
    ]);
    expect(b.a_venir.some((r: { etat?: string }) => r.etat)).toBe(false);
    expect(b.mise_a_jour[0]).toEqual({ source: "Volley-ball : championnats régionaux de la Ligue de La Réunion (FFVB)", lu: "samedi 24/10 à 08:00", dernier_resultat: "vendredi 23/10 à 21:00" });
    expect(b.classements.map((c: { competition: string }) => c.competition)).toHaveLength(5);
  });

  it("marks the matches the league called off, with its notice", async () => {
    const b = body(await sportTool(cache(), "volley", undefined, "samedi", NOW));
    expect(b.a_venir).toHaveLength(10);
    expect(b.a_venir.every((r: { etat: string; selon: string; lien_avis: string }) =>
      r.etat === "annulée" && r.selon === "la Ligue réunionnaise de volley-ball (LRVB), à rejouer à une date à fixer" && r.lien_avis.includes("1770758655057957"))).toBe(true);
    expect(b.resume).toBe("10 rendez-vous de volley-ball à La Réunion samedi 24/10\u00a0; tous annulés ou reportés d'après la Ligue réunionnaise de volley-ball (LRVB).");
    expect(b.avis).toEqual([expect.objectContaining({ jours: ["samedi 24/10"], extrait: expect.stringMatching(/toutes les rencontres indoor et outdoor prévues ce samedi 24 octobre 2026 sont annulées\.$/) })]);
    // Sunday's matches are not touched.
    const w = body(await sportTool(cache(), "volley", undefined, "ce_week_end", NOW));
    expect(w.a_venir.filter((r: { etat?: string }) => !r.etat).map((r: { quand: string }) => r.quand.slice(0, 14))).toEqual(Array(3).fill("dimanche 25/10"));
    // No FFVB match is lost: every match of the pools is there, called off or not.
    const all = ["ffvb_r1m.html", "ffvb_r1f.html", "ffvb_r2f.html", "ffvb_2ma.html", "ffvb_2mb.html"].flatMap((f) => parseVolley(latin1(f)).matchs);
    expect(w.a_venir.length + (w.resultats?.length ?? 0)).toBe(all.filter((m) => m.date >= "2026-10-24" && m.date < "2026-10-26").length);
  });

  it("crosses the news: a match it calls off, or a day to check with the club", async () => {
    down = /lrvb/;
    // Clicanoo on Saturday morning: « les ligues sportives préfèrent reporter les compétitions ce samedi », no sport named.
    const clicanoo = parseRss(fixture("../actualites/clicanoo.xml").toString(), "Clicanoo");
    const vague = body(await sportTool(await withNews(clicanoo), "volley", undefined, "samedi", NOW));
    expect(vague.a_venir.some((r: { etat?: string }) => r.etat)).toBe(false);
    expect(vague.a_verifier).toEqual([expect.objectContaining({ jour: "samedi 24/10", titre: "Face aux tensions sociales, les ligues sportives préfèrent reporter les compétitions ce samedi", selon: "Clicanoo, samedi 24/10 à 10:50" })]);
    expect(vague.resume).toMatch(/vérifier auprès du club\.$/);
    // A sentence that names the sport, the teams and the day marks those matches only.
    const precise = [info("Volley-ball : le match entre le TGV et le RCO de ce samedi est reporté", "2026-10-24T02:00:00Z")];
    const b = body(await sportTool(await withNews(precise), "volley", undefined, "samedi", NOW));
    expect(b.a_venir.filter((r: { etat?: string }) => r.etat).map((r: { epreuve: string; etat: string; selon: string }) => `${r.epreuve} ${r.etat} ${r.selon}`)).toEqual([
      "TGV – RCO reportée Clicanoo",
      "TGV – RCO reportée Clicanoo",
    ]);
    // Old news, or another sport, marks nothing.
    expect(avisPresse([info("Volley : tous les matchs de samedi sont annulés", "2026-10-17T02:00:00Z")], NOW).avis).toEqual([]);
    expect(avisPresse([info("Football : tous les matchs de samedi sont annulés", "2026-10-24T02:00:00Z")], NOW).avis).toEqual([]);
  });

  it("parses the golf and motor sport sources", () => {
    const g = parseGolf(JSON.parse(fixture("ffgolf.json").toString()));
    expect(g[1]).toMatchObject({ nom: "TROPHEES ROSES 2026 - ODYSSEA", debut: "2026-10-25", fin: "2026-10-25", commune: "L'Étang-Salé" });
    const l = JSON.parse(fixture("lsar.json").toString());
    const auto = parseLsar(l.content.rendered, l.link);
    expect(auto.find((e) => e.nom.startsWith("Rallye National Ronde"))).toMatchObject({ debut: "2026-09-05", fin: "2026-09-06", etat: "annulée", detail: "Rallyes" });
    expect(auto.find((e) => /1000 KM/.test(e.nom))).toMatchObject({ debut: "2026-12-05", fin: "2026-12-06" });
  });

  it("gives what is on and the latest results across the island, and the Grand Raid in its season", async () => {
    const b = body(await sportTool(cache(), undefined, undefined, undefined, NOW));
    expect(b.a_venir.some((r: { epreuve: string; quand: string }) => r.epreuve === "VB2CO – SVB" && r.quand === "samedi 24/10 à 20:00")).toBe(true);
    expect(b.a_venir.some((r: { sport: string; quand: string }) => r.sport === "sport auto" && r.quand === "du samedi 24/10 au dimanche 25/10")).toBe(true);
    expect(b.resultats.map((r: { score: string }) => r.score)).toContain("3-0");
    expect(b.grand_raid.courses[0]).toMatchObject({ course: "Diagonale des fous (180 km, 10200 m D+)", partants: 2766, arrives: 2126, abandons: 640 });
    expect(b.grand_raid.courses[0].podium[0]).toBe("1. Hugo DECK (FR) 22 h 54 min");
    expect(b.indisponible).toBeUndefined();
    expect(b.a_venir.find((r: { epreuve: string; quand: string }) => r.epreuve === "VB2CO – SVB" && r.quand === "samedi 24/10 à 20:00")).toMatchObject({ etat: "annulée" });
  });

  it("links to the communes' sports programmes from the agendas' copy, without reading them", async () => {
    const b = body(await sportTool(withAgendas(), undefined, undefined, undefined, NOW));
    expect(b.programmes_communes).toEqual([
      { type: "programme sportif de la commune", commune: "La Possession", titre: "Agenda sportif du 22 au 24 octobre", dates: "du jeudi 22/10 au samedi 24/10", lien: "https://www.lapossession.re/agenda/890500", source: "site de la commune de La Possession, lu le samedi 24/10 à 07:00", publie_par: "Ville de La Possession", lu_le: "samedi 24/10 à 07:00" },
      { type: "programme sportif de la commune", commune: "L'Étang-Salé", titre: "Planning des compétitions sportives du 23 au 25 octobre 2026", dates: "du vendredi 23/10 au dimanche 25/10", lien: "https://www.letangsale.fr/planning", source: "site de la commune de L'Étang-Salé, lu le samedi 24/10 à 07:00", publie_par: "Ville de L'Étang-Salé", lu_le: "samedi 24/10 à 07:00" },
    ]);
    expect(b.programmes_a_savoir).toMatch(/ne lit pas ce document, il en donne seulement le lien/);
    expect(b.resume).toContain("2 programmes sportifs de commune (La Possession, L'Étang-Salé), en lien seulement");
    expect(b.sources.map((s: { source: string }) => s.source)).toEqual(expect.arrayContaining(["Agenda de la Ville de La Possession", "Agenda de la Ville de L'Étang-Salé"]));
    // Not Saint-Benoît's, whose site is never linked (src/liens.ts), even from its agenda's copy.
    expect(JSON.stringify(b)).not.toContain("saint-benoit.re");
    const page = sportPage("https://rundata.re", { value: { ...b, classements: [] }, fetchedAt: NOW, stale: false }, NOW);
    expect(page).toContain("Programmes sportifs des communes");
    expect(page).not.toContain("saint-benoit.re");
    // A commune's own; none for one sport, a club, or the results.
    expect(body(await sportTool(withAgendas(), undefined, "La Possession", "ce_week_end", NOW)).programmes_communes.map((p: { commune: string }) => p.commune)).toEqual(["La Possession"]);
    expect(body(await sportTool(withAgendas(), "volley", undefined, undefined, NOW)).programmes_communes).toBeUndefined();
    expect(body(await sportTool(withAgendas(), undefined, "VBSP", "a_venir", NOW)).programmes_communes).toBeUndefined();
    expect(body(await sportTool(withAgendas(), undefined, undefined, "resultats", NOW)).programmes_communes).toBeUndefined();
    // Without the agendas' copy, nothing is read for them.
    expect(body(await sportTool(cache(), undefined, undefined, undefined, NOW)).programmes_communes).toBeUndefined();
  });

  it("gives the volley league's tournaments from the agendas' copy, their place as the league says", async () => {
    const store = new MemoryStore();
    const at = NOW.getTime() - 3600_000;
    const tournoi = { id: "Ligue réunionnaise de volley-ball:8790", titre: "King Saison 6 Solo étape 2", seances: [{ debut: "2026-11-01" }], lieu: "lieu à venir (voir la page de la Ligue)", categories: ["OUTDOOR"], lien: "https://lrvb.re/calendrier2/king-saison-6-solo-etape-2/", publie_par: "Ligue réunionnaise de volley-ball" };
    // The scheduled event's copy, in KV.
    await store.put("agendas:planifies", { value: { "agenda:lrvb": { value: [tournoi], fetchedAt: at } }, fetchedAt: at });
    const ligue = () => new Cache(store, () => NOW.getTime());
    const b = body(await sportTool(ligue(), "volley", undefined, "a_venir", NOW));
    expect(b.a_venir.find((r: { epreuve: string }) => r.epreuve === "King Saison 6 Solo étape 2")).toEqual({
      sport: "volley-ball", quand: "dimanche 01/11", epreuve: "King Saison 6 Solo étape 2", detail: "Ligue réunionnaise de volley-ball",
      lieu: "lieu à venir (voir la page de la Ligue)", lien: "https://lrvb.re/calendrier2/king-saison-6-solo-etape-2/",
    });
    expect(b.sources.map((s: { source: string }) => s.source)).toContain("Volley-ball : tournois ouverts de la Ligue réunionnaise (King, Green 3X3)");
    // Not for another sport, nor for a commune (its place is not known yet).
    expect(body(await sportTool(ligue(), "handball", undefined, "a_venir", NOW)).a_venir?.map((r: { epreuve: string }) => r.epreuve) ?? []).not.toContain("King Saison 6 Solo étape 2");
    expect(body(await sportTool(ligue(), "volley", "Saint-Pierre", "a_venir", NOW)).a_venir?.map((r: { epreuve: string }) => r.epreuve) ?? []).not.toContain("King Saison 6 Solo étape 2");
  });

  it("says the tournaments and the clubs' events it has no young copy of, with why", async () => {
    const store = new MemoryStore();
    const at = NOW.getTime() - 49 * 3600_000;
    const tournoi = { id: "Ligue réunionnaise de volley-ball:8790", titre: "King Saison 6 Solo étape 2", seances: [{ debut: "2026-11-01" }], lieu: "lieu à venir (voir la page de la Ligue)", categories: ["OUTDOOR"], lien: "https://lrvb.re/calendrier2/king-saison-6-solo-etape-2/", publie_par: "Ligue réunionnaise de volley-ball" };
    // The league's copy read 49 hours ago, the clubs' calendar never read and its reading failed.
    await store.put("agendas:planifies", { value: { "agenda:lrvb": { value: [tournoi], fetchedAt: at }, "echec:sportsregions": { value: true, fetchedAt: NOW.getTime() } }, fetchedAt: NOW.getTime() });
    const b = body(await sportTool(new Cache(store, () => NOW.getTime()), "volley", undefined, "a_venir", NOW));
    expect(b.a_venir?.map((r: { epreuve: string }) => r.epreuve) ?? []).not.toContain("King Saison 6 Solo étape 2");
    const since = `dernière lecture le ${quand(new Date(at + 4 * 3600_000).toISOString().slice(0, 16))}`;
    const tried = `dernière lecture sans succès (${quand(new Date(NOW.getTime() + 4 * 3600_000).toISOString().slice(0, 16))})`;
    expect(b.non_lus).toEqual([`Ligue réunionnaise de volley-ball : ${since}`, `Clubs sportifs (Sportsregions) : ${tried}`]);
    // Handball: the clubs' calendar only. The Grand Raid: neither.
    expect(body(await sportTool(new Cache(store, () => NOW.getTime()), "handball", undefined, "a_venir", NOW)).non_lus).toEqual([`Clubs sportifs (Sportsregions) : ${tried}`]);
    expect(body(await sportTool(new Cache(store, () => NOW.getTime()), "grand_raid", undefined, undefined, NOW)).non_lus).toBeUndefined();
  });

  it("reads the scheduled event's copies from KV once, cold, within the budget", async () => {
    // Every read or write of a store counts, as in the Worker.
    class Counted extends MemoryStore {
      reads = 0;
      async get(key: string, freshAfter?: number) {
        count(1, "read");
        this.reads++;
        return super.get(key, freshAfter);
      }
      async put(key: string, e: CacheEntry) {
        count(1, true);
        return super.put(key, e);
      }
    }
    const kv = new Counted();
    const at = NOW.getTime() - 3600_000;
    const tournoi = { id: "Ligue réunionnaise de volley-ball:8790", titre: "King Saison 6 Solo étape 2", seances: [{ debut: "2026-11-01" }], lieu: "lieu à venir (voir la page de la Ligue)", categories: ["OUTDOOR"], lien: "https://lrvb.re/calendrier2/king-saison-6-solo-etape-2/", publie_par: "Ligue réunionnaise de volley-ball" };
    await kv.put("agendas:planifies", { value: { "agenda:lrvb": { value: [tournoi], fetchedAt: at } }, fetchedAt: at });
    kv.reads = 0;
    const c = new Cache(new Counted(), () => NOW.getTime(), true, kv);
    const cold = await counted(PAGE_BUDGET, () => sportTool(c, "volley", undefined, "a_venir", NOW));
    expect(body(cold.value).a_venir.map((r: { epreuve: string }) => r.epreuve)).toContain("King Saison 6 Solo étape 2");
    expect(cold.used).toBeLessThanOrEqual(PAGE_BUDGET);
    expect(kv.reads).toBe(1);
  });

  it("gives the clubs' events from the agendas' copy, their place only when the club gave one, of the sport asked", async () => {
    const store = new MemoryStore();
    const at = NOW.getTime() - 3600_000;
    const pages = [1, 2, 3, 4].map((n) => readFileSync(new URL(`./fixtures/agenda/sportsregions_${n}.html`, import.meta.url), "utf8"));
    // The scheduled event's copy, in KV.
    await store.put("agendas:planifies", { value: { "agenda:sportsregions": { value: parseSportsregions(pages).evenements, fetchedAt: at } }, fetchedAt: at });
    const clubs = () => new Cache(store, () => NOW.getTime());
    const epreuves = (b: { a_venir?: { epreuve: string }[] }) => (b.a_venir ?? []).map((r) => r.epreuve);
    const golf = body(await sportTool(clubs(), "golf", undefined, "a_venir", NOW));
    expect(golf.a_venir.find((r: { epreuve: string }) => r.epreuve === "GRAND PRIX LRGR DE BOURBON")).toEqual({
      sport: "golf", quand: "du samedi 31/10 au dimanche 01/11", epreuve: "GRAND PRIX LRGR DE BOURBON", detail: "Organisé par Ligue Régionale de Golf de La Réunion (Le Tampon)",
      lieu: "non précisé (voir la page de l'événement)", lien: expect.stringMatching(/^https:\/\/[\w.-]+\/evenements\/2026\/10\/31\//),
    });
    expect(golf.sources.map((s: { source: string }) => s.source)).toContain("Sportsregions (calendrier des clubs), publié par chaque club");
    expect(epreuves(golf)).not.toContain("Triathlon TRI SALAZES");
    // Every sport when none is asked; none of another sport.
    expect(epreuves(body(await sportTool(clubs(), undefined, undefined, "a_venir", NOW)))).toEqual(expect.arrayContaining(["Triathlon TRI SALAZES", "Tir en salle du Port"]));
    const hand = body(await sportTool(clubs(), "handball", undefined, "a_venir", NOW));
    expect(epreuves(hand).filter((e) => /TRI SALAZES|BOURBON|Tir en salle/.test(e))).toEqual([]);
    expect(hand.sources.map((s: { source: string }) => s.source)).not.toContain("Sportsregions (calendrier des clubs), publié par chaque club");
    // In a commune: those its title names only, never by the club's address (the golf league's, at Le Tampon, plays
    // its Grand Prix at the Golf de Bourbon).
    expect(epreuves(body(await sportTool(clubs(), undefined, "Le Port", "a_venir", NOW)))).toEqual(expect.arrayContaining(["Tir en salle du Port", "Compétition au Port (18m)"]));
    expect(epreuves(body(await sportTool(clubs(), "golf", "Le Tampon", "a_venir", NOW)))).not.toContain("GRAND PRIX LRGR DE BOURBON");
    expect(epreuves(body(await sportTool(clubs(), undefined, "Saint-André", "a_venir", NOW)))).not.toContain("Triathlon TRI SALAZES");
    expect(epreuves(body(await sportTool(clubs(), undefined, "Saint-Denis", "a_venir", NOW)))).not.toContain("Tir en salle du Port");
    // The event's own place when the club gave one, and its commune with it.
    expect(body(await sportTool(clubs(), undefined, "Cilaos", "a_venir", NOW)).a_venir.find((r: { epreuve: string }) => r.epreuve === "Week-end PREPA 0-3000")).toMatchObject({ lieu: "Gîte Bec a li, 4 chemin des Framboises", detail: "Organisé par Leu Triathlon" });
    // The members' sessions: not told by default; to a member, said reserved, with the club's site.
    const libre = (b: { a_venir?: { epreuve: string }[] }) => (b.a_venir ?? []).filter((r) => r.epreuve.startsWith("Jeu libre"));
    expect(libre(body(await sportTool(clubs(), undefined, undefined, "a_venir", NOW)))).toEqual([]);
    expect(libre(body(await sportTool(clubs(), undefined, undefined, "a_venir", NOW, false)))).toEqual([]);
    const member = libre(body(await sportTool(clubs(), undefined, undefined, "a_venir", NOW, true)));
    expect(member.length).toBeGreaterThan(0);
    expect(member[0]).toMatchObject({ sport: "badminton", acces: "réservé aux adhérents de Badminton Club de Saint-Pierre", site_du_club: "https://www.bcspi.re", lieu: "non précisé (voir la page de l'événement)" });
    expect(body(await sportTool(clubs(), "golf", undefined, "a_venir", NOW, true)).a_venir.every((r: { acces?: string }) => !r.acces)).toBe(true);
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
    const here = b.a_venir.filter((r: { deplacement?: string }) => !r.deplacement);
    expect(here.every((r: { lieu: string; commune: string }) => /Bassin Bleu|SAINT PAUL/i.test(r.lieu) || r.commune === "Saint-Paul")).toBe(true);
    expect(here.some((r: { epreuve: string }) => r.epreuve === "VB2CO – SVB")).toBe(true);
  });

  it("says basket has no official source", async () => {
    const b = body(await sportTool(cache(), "basket", undefined, undefined, NOW));
    expect(b.resume).toMatch(/^Le calendrier et les résultats officiels du basket \(FFBB\) ne sont pas encore lus/);
    expect(b.periode).toBeUndefined();
  });

  it("says football has no official source", async () => {
    const b = body(await sportTool(cache(), "football", undefined, undefined, NOW));
    expect(b.resume).toMatch(/^Les résultats officiels du football \(FFF, Ligue réunionnaise\) ne sont pas lisibles par ce service\./);
    expect(b.a_venir).toBeUndefined();
  });

  it("keeps a championship whose page did not answer, said with the hour it was read, never left out", async () => {
    let t = NOW.getTime();
    const c = new Cache(new MemoryStore(), () => t);
    await sportTool(c, "handball", undefined, undefined, NOW);
    // Past its three hours the women's D1 does not answer: its standings of 08:00 stay, said.
    t += 3 * 3600_000 + 60_000;
    down = /feminin/;
    const b = body(await sportTool(c, "handball", undefined, undefined, new Date(t)));
    expect(b.injoignable).toEqual([{ competition: "handball, D1 féminine", texte: "Lu aujourd'hui à 08:00 : le site de la Fédération française de handball n'a pas répondu depuis. Ce qui suit peut avoir changé : voir son site.", site: expect.stringContaining("feminin") }]);
    expect(b.resume).toContain("Championnat de handball D1 féminine : lu aujourd'hui à 08:00, sans réponse depuis (voir injoignable).");
    // Nothing read before: its read said failed.
    const b2 = body(await sportTool(cache(), "handball", undefined, undefined, NOW));
    expect(b2.injoignable[0].texte).toBe("Le site de la Fédération française de handball n'a pas répondu à notre dernière lecture (aujourd'hui à 08:00) : nous ne savons pas ce qu'il annonce en ce moment.");
  });

  it("answers without a source that is down, and names it", async () => {
    down = /ffhandball/;
    const b = body(await sportTool(cache(), undefined, undefined, undefined, NOW));
    expect(b.indisponible).toEqual(["Handball : championnats régionaux de la Ligue de La Réunion (FFHB)"]);
    down = /lrvb/;
    const v = body(await sportTool(cache(), "volley", undefined, "samedi", NOW));
    expect(v.indisponible).toEqual(["Volley-ball : avis de la Ligue réunionnaise (annulations, reports)"]);
    expect(v.a_venir).toHaveLength(10);
    expect(b.a_venir.some((r: { sport: string }) => r.sport === "volley-ball")).toBe(true);
  });
});

describe("the count of /sport", () => {
  // 26/10/2026: « 39 » on the page for the 77 the tool counted, the triathlon left out and the motor sport named without any.
  const row = (sport: string, epreuve: string) => ({ sport, epreuve, quand: "samedi 31/10 à 18:00", competition: "Championnat" });
  const answer = {
    resume: "", non_couvert: "", sources: [], classements: [],
    a_venir: [row("volley-ball", "Match A"), { ...row("handball", "Match B"), etat: "annulée" }, row("triathlon", "Triathlon de Saint-Paul")],
    a_venir_en_tout: 77,
  } as unknown as SportAnswer;

  it("is the tool's, with the sports there are, and says the list keeps the first", () => {
    const page = sportPage("https://rundata.re", { value: answer, fetchedAt: NOW, stale: false }, NOW);
    expect(page).toContain(`<span class="big">77</span><p>rendez-vous officiels dans les quinze prochains jours : handball, volley et triathlon ; les 3 premiers ci-dessous.</p>`);
    expect(page).toContain("Triathlon de Saint-Paul");
    // All of them listed: the count alone.
    // A sport only beyond the first: named too.
    const beyond = sportPage("https://rundata.re", { value: { ...answer, sports_a_venir: ["volley-ball", "handball", "triathlon", "golf"] }, fetchedAt: NOW, stale: false }, NOW);
    expect(beyond).toContain("quinze prochains jours\u00a0: handball, volley, golf et triathlon\u00a0; les 3 premiers ci-dessous.");
    const few = sportPage("https://rundata.re", { value: { ...answer, a_venir_en_tout: undefined }, fetchedAt: NOW, stale: false }, NOW);
    expect(few).toContain(`<span class="big">3</span><p>rendez-vous officiels dans les quinze prochains jours : handball, volley et triathlon.</p>`);
  });
});
