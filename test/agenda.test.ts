import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKER_BUDGET, count, counted, left } from "../src/budget.js";
import { Cache, MemoryStore, TieredStore, type CacheEntry } from "../src/cache.js";
import { AGENDAS, COVERED, LIGUE_VOLLEY, OTI_EST, SOURCES_LUES, communeOf, programmeSportif, programmesSportifs, datesIn, lead, parseBrasPanon, parseIntraMuros, parseOpenAgenda, parseOtiEst, parsePetiteIle, parseReunionFr, parseRss, parseSaintBenoit, parseTribe } from "../src/providers/agenda.js";
import { extrait } from "../src/providers/agenda-mots.js";
import { parseBisik } from "../src/providers/salles.js";
import { agenda, gather, periode, refreshPlanned } from "../src/tools/agenda.js";
import { agendaHours } from "../src/web/domains.js";

// The agendas on Saturday 24/10/2026 in the morning: the Fête de l'ail at Petite-Île (23 to 25), a concert tonight at
// Les Trois-Bassins, the Dragon Boat festival tomorrow at Le Port, the Koupe Kartié next Saturday at Saint-Gilles.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/agenda/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());

const bytes = (f: string) => readFileSync(new URL(`./fixtures/agenda/${f}`, import.meta.url));

function file(url: string, form?: string): string | undefined {
  // The pages of two of the shows on both TÉAT stages; the others do not answer.
  if (url.includes("yannick-noah")) return "teat_yannick-noah.html";
  if (url.includes("seetickets.fr/booder")) return "seetickets_booder.html";
  if (url.endsWith("teat.re/programmation/")) return form?.includes("Plein") ? "teat_plein-air.html" : "teat_champ-fleuri.html";
  if (url.includes("citedesarts")) return url.includes("debut_programmation") ? "citedesarts_2.html" : "citedesarts_1.html";
  if (url.includes("kabardock")) return "kabardock.html";
  if (url.includes("bisik")) return "bisik.html";
  if (url.includes("theatrelucdonat")) return "luc-donat.html";
  if (url.includes("cdnoi")) return "cdnoi.html";
  if (url.includes("lespas")) return "lespas.html";
  if (url.includes("lesechoir")) return "sechoir.json";
  if (url.includes("saint-andre")) return "rss_saint-andre.xml";
  if (url.includes("mairie-saintpaul")) return "tribe_saint-paul.json";
  if (url.includes("ville-port")) return "tribe_le-port.json";
  if (url.includes("trois-bassins")) return "tribe_trois-bassins.json";
  if (url.includes("lrvb.re")) return "tribe_lrvb.json";
  if (url.includes("letampon")) return "rss_le-tampon.xml";
  if (url.includes("saintlouis")) return "rss_saint-louis.xml";
  if (url.includes("lapossession")) return "rss_la-possession.xml";
  if (url.includes("entredeux")) return "rss_entre-deux.xml";
  if (url.includes("letangsale")) return "rss_etang-sale.xml";
  if (url.includes("petite-ile")) return "petite-ile.html";
  if (url.includes("braspanon")) return url.endsWith("/2026/11") ? "bras-panon_2026-11.html" : url.endsWith("/2026/10") ? "bras-panon_2026-10.html" : undefined;
  if (url.includes("saint-benoit")) return "saint-benoit.html";
  if (url.includes("reunionest")) return "oti-est.html";
  if (url.includes("50316469")) return "openagenda_cinor.json";
  if (url.includes("32570974")) return "openagenda_otnord.json";
  if (url.includes("reunion.fr")) return "irt_agenda.html";
}

describe("agenda", () => {
  let down: RegExp | undefined;
  let asked: string[];
  beforeEach(() => {
    down = undefined;
    asked = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      asked.push(new Headers(init?.headers).get("User-Agent") ?? "");
      const f = file(url, typeof init?.body === "string" ? init.body : undefined);
      return f && !down?.test(url) ? new Response(bytes(f)) : new Response("", { status: 503 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the dates written in a text", () => {
    const pub = new Date("2026-10-01T08:00:00Z");
    expect(datesIn("Du 5 au 10 octobre 2026, la Semaine Bleue", pub)).toEqual([{ debut: "2026-10-05", fin: "2026-10-10" }]);
    expect(datesIn("Les 5, 12, 19 et 26 octobre 2026 Permanences", pub).map((s) => s.debut)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(datesIn("Dimanche 4 octobre 2026 … ce Dimanche 4 octobre 2026, de 6h à 14h, pour une", pub)).toEqual([{ debut: "2026-10-04T06:00", fin: "2026-10-04T14:00" }]);
    expect(datesIn("19 et 20 désanm : Fèt Kaf", new Date("2025-12-19T09:00:00Z")).map((s) => s.debut)).toEqual(["2025-12-19", "2025-12-20"]);
    expect(datesIn("les vendredi 18 et samedi 19 septembre 2026", pub).map((s) => s.debut)).toEqual(["2026-09-18", "2026-09-19"]);
    expect(datesIn("du 30 octobre au 2 novembre", pub)).toEqual([{ debut: "2026-10-30", fin: "2026-11-02" }]);
    // Announced in December for early January: next year.
    expect(datesIn("3 janvier : bal", new Date("2026-12-20T08:00:00Z"))).toEqual([{ debut: "2027-01-03" }]);
    expect(datesIn("Rien de daté ici", pub)).toEqual([]);
  });

  it("keeps the hours a mairie typed, whatever time zone its site claims", () => {
    // Saint-Paul's site says Europe/Paris; its page shows « 8h00 » for these morning sessions.
    const [e] = parseTribe(JSON.parse(fixture("tribe_saint-paul.json")), "Mairie de Saint-Paul", "Saint-Paul");
    expect(e.seances).toEqual([{ debut: "2026-10-27T08:00", fin: "2026-10-27T12:00" }]);
    expect(communeOf("TROIS BASSINS")).toBe("Les Trois-Bassins");
    expect(communeOf("St Paul")).toBe("Saint-Paul");
  });

  it("reads the volley league's tournaments, their place « à venir » as the league says", async () => {
    const { value } = await LIGUE_VOLLEY.load(cache(), NOW);
    expect(value.map((e) => [e.titre, e.seances, e.lieu, e.commune, e.publie_par])).toEqual([
      ["King Saison 6 Solo étape 2", [{ debut: "2026-11-01" }], "lieu à venir (voir la page de la Ligue)", undefined, "Ligue réunionnaise de volley-ball"],
      ["Green 3X3 Etape 4", [{ debut: "2026-11-08" }], "lieu à venir (voir la page de la Ligue)", undefined, "Ligue réunionnaise de volley-ball"],
      ["King Saison 6 Duo étape 2", [{ debut: "2026-12-06" }], "lieu à venir (voir la page de la Ligue)", undefined, "Ligue réunionnaise de volley-ball"],
    ]);
    expect(value[0].lien).toBe("https://lrvb.re/calendrier2/king-saison-6-solo-etape-2/");
    // An agenda of the whole island: it covers no commune.
    expect(AGENDAS).toContain(LIGUE_VOLLEY);
    expect(COVERED).not.toContain(undefined);
  });

  describe("an agenda read by the scheduled event (the volley league)", () => {
    let urls: string[];
    let league: () => Response;
    const KING = "King Saison 6 Solo étape 2";
    const titles = (b: { evenements?: { titre: string }[] }) => (b.evenements ?? []).map((e) => e.titre);
    const entry = async (store: MemoryStore) => ((await store.get("agendas"))?.value as Record<string, CacheEntry> | undefined)?.["agenda:lrvb"];
    beforeEach(() => {
      urls = [];
      league = () => new Response(bytes("tribe_lrvb.json"));
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        urls.push(url);
        if (url.includes("lrvb.re")) return league();
        const f = file(url, typeof init?.body === "string" ? init.body : undefined);
        return f ? new Response(bytes(f)) : new Response("", { status: 503 });
      });
    });

    it("is read there only, once an hour, and its copy served to the questions for 48 hours", async () => {
      let t = NOW.getTime();
      const store = new MemoryStore();
      const at = () => new Cache(store, () => t);
      // A question never reads it, and says nothing of it while there is no copy.
      const before = body(await agenda(at(), undefined, undefined, undefined, NOW));
      expect(urls.some((u) => u.includes("lrvb.re"))).toBe(false);
      expect(before.indisponible).toBeUndefined();
      expect(titles(before)).not.toContain(KING);
      expect(await refreshPlanned(at(), NOW)).toEqual({ lus: ["lrvb"], gardes: [], reportes: [] });
      expect(urls.filter((u) => u.includes("lrvb.re"))).toHaveLength(1);
      // Another isolate serves it, with the time it was read.
      const after = body(await agenda(at(), undefined, undefined, "King", NOW));
      expect(after.evenements.find((e: { titre: string }) => e.titre === KING)).toMatchObject({ lieu: "lieu à venir (voir la page de la Ligue)", lu_le: expect.stringContaining("08:00") });
      // Not again within the hour.
      t += 30 * 60_000;
      expect(await refreshPlanned(at(), new Date(t))).toEqual({ lus: [], gardes: [], reportes: [] });
      expect(urls.filter((u) => u.includes("lrvb.re"))).toHaveLength(1);
      // Past 48 hours unread, it is not served any more, and still not named.
      t = NOW.getTime() + 49 * 3600_000;
      const late = body(await agenda(at(), undefined, undefined, "King", new Date(t)));
      expect(titles(late)).not.toContain(KING);
      expect(late.indisponible).toBeUndefined();
    });

    it("keeps its copy and its time when the reading fails or finds nothing", async () => {
      let t = NOW.getTime();
      const store = new MemoryStore();
      const at = () => new Cache(store, () => t);
      await refreshPlanned(at(), NOW);
      const first = await entry(store);
      expect((first?.value as unknown[]).length).toBe(3);
      t += 2 * 3600_000;
      league = () => new Response("", { status: 503 });
      expect(await refreshPlanned(at(), new Date(t))).toEqual({ lus: [], gardes: ["lrvb"], reportes: [] });
      expect(await entry(store)).toEqual(first);
      league = () => new Response(JSON.stringify({ events: [] }));
      expect(await refreshPlanned(at(), new Date(t))).toEqual({ lus: [], gardes: ["lrvb"], reportes: [] });
      expect(await entry(store)).toEqual(first);
    });

    it("reads nothing and writes nothing when the invocation cannot pay for its reading and the write", async () => {
      class Counting extends MemoryStore {
        puts = 0;
        async put(key: string, e: CacheEntry) {
          this.puts++;
          return super.put(key, e);
        }
      }
      const store = new Counting();
      const { value } = await counted(WORKER_BUDGET, async () => {
        count(left() - 5); // what the scheduled event did before: 5 left, KEEP_LEFT 4 of them
        return refreshPlanned(new Cache(store, () => NOW.getTime()), NOW);
      });
      expect(value).toEqual({ lus: [], gardes: [], reportes: ["lrvb"] });
      expect(urls).toEqual([]);
      expect(store.puts).toBe(0);
    });

    it("is written back as it was by a question that writes the bundle", async () => {
      const store = new MemoryStore();
      const at = NOW.getTime() - 3 * 3600_000;
      const copy = [{ id: "Ligue réunionnaise de volley-ball:8790", titre: KING, seances: [{ debut: "2026-11-01" }], lieu: "lieu à venir (voir la page de la Ligue)", categories: [], lien: "https://lrvb.re/calendrier2/king-saison-6-solo-etape-2/", publie_par: "Ligue réunionnaise de volley-ball" }];
      await store.put("agendas", { value: { "agenda:lrvb": { value: copy, fetchedAt: at } }, fetchedAt: at });
      // A cold question reads every other agenda and writes the bundle.
      const b = body(await agenda(new Cache(store, () => NOW.getTime()), undefined, undefined, "King", NOW));
      expect(titles(b)).toContain(KING);
      const written = (await store.get("agendas"))?.value as Record<string, CacheEntry>;
      expect(Object.keys(written).length).toBeGreaterThan(10);
      expect(written["agenda:lrvb"]).toEqual({ value: copy, fetchedAt: at });
    });
  });

  it("reads reunion.fr's agenda from its page", () => {
    const list = parseReunionFr(fixture("irt_agenda.html"));
    expect(list.map((e) => [e.titre, e.commune, e.seances])).toEqual([
      ["Dan Ron Mafate", "Saint-Paul", [{ debut: "2026-10-23", fin: "2026-10-24" }]],
      ["Fête de l'ail", "Petite-Île", [{ debut: "2026-10-23", fin: "2026-10-25" }]],
    ]);
    expect(() => parseReunionFr("<html></html>")).toThrow();
  });

  it("reads La Possession's agenda, each date as data", () => {
    const list = parseIntraMuros(fixture("rss_la-possession.xml"), "Ville de La Possession", "La Possession");
    expect(list).toHaveLength(16);
    // Some days of a span, with their hours.
    expect(list.find((e) => e.titre === "Parentali'thé - Les ateliers du samedi")!.seances.slice(0, 2)).toEqual([
      { debut: "2026-08-29T09:30", fin: "2026-08-29T11:00" }, { debut: "2026-09-12T09:30", fin: "2026-09-12T11:00" },
    ]);
    expect(list.find((e) => e.titre === "Journée d'Accès au droit")).toMatchObject({ seances: [{ debut: "2026-10-24T08:30", fin: "2026-10-24T12:30" }], lieu: undefined, commune: "La Possession" });
    // Midnight to 23:59:59: days without hours.
    expect(list.find((e) => e.titre === "Les Folies culturelles du mois d'octobre")).toMatchObject({ seances: [{ debut: "2026-10-07", fin: "2026-10-28" }], lieu: "Médiathèque Héva", categories: ["Animation"], lien: "https://www.lapossession.re/agenda/890434" });
    expect(list.find((e) => e.titre === "Agenda sportif du 22 au 24 octobre")!.lieu).toBeUndefined();
    // The facts only: the feed's text is the dates again.
    expect(list.every((e) => !e.description && e.publie_par === "Ville de La Possession")).toBe(true);
  });

  it("reads Petite-Île's agenda page, its hours put back from UTC", () => {
    const list = parsePetiteIle(fixture("petite-ile.html"), NOW);
    expect(list.find((e) => e.titre === "Semaine créole")).toMatchObject({ seances: [{ debut: "2026-10-28", fin: "2026-10-31" }], lieu: undefined, commune: "Petite-Île", description: "SEMAINE CRÉOLE À PETITE-ÎLE : ANOU TRANSMÈT NOUT LANG !", lien: "https://www.petite-ile.re/actualites/agenda/semaine-creole" });
    // « de 05h00 à 08h00 » on the list, « De 9h à 12h » on the event's page.
    expect(list.find((e) => e.titre.startsWith("OCTOBRE ROSE"))!.seances).toEqual([{ debut: "2026-10-03T09:00", fin: "2026-10-03T12:00" }]);
    expect(list.find((e) => e.titre === "Spectacle - La vie d’Oursin")).toMatchObject({ seances: [{ debut: "2026-10-14T14:00", fin: "2026-10-14T15:00" }], lieu: "Bibliothèque du Centre-Ville" });
    expect(list.find((e) => e.titre.startsWith("Bibliobus"))!.lieu).toBeUndefined();
    expect(list.every((e) => !e.description || e.description.length <= 200)).toBe(true);
  });

  it("reads the feeds of L'Étang-Salé and L'Entre-Deux, the first sentence of their text only", () => {
    const etang = parseRss(fixture("rss_etang-sale.xml"), "Ville de L'Étang-Salé", "L'Étang-Salé", true);
    expect(etang.map((e) => [e.titre, e.seances, e.description])).toEqual([
      ["Planning des compétitions sportives du 23 au 25 octobre 2026", [{ debut: "2026-10-23", fin: "2026-10-25" }], undefined],
      // Without the hour of its posting (« 24 Octobre 2026 09:20 ») nor its label (« EVENEMENT »).
      ["Marche Solidaire contre la polio", [{ debut: "2026-10-24" }], "Rendez-vous demain, samedi 24 octobre pour la marche solidaire contre la polio !"],
    ]);
    const [show] = parseRss(fixture("rss_entre-deux.xml"), "Mairie de l'Entre-Deux", "Entre-Deux", true);
    expect(show).toMatchObject({ titre: "Mille et une vies, l'histoire d'une âme", seances: [{ debut: "2026-10-10" }], commune: "Entre-Deux" });
    expect(show.description).toMatch(/^« Mille et une vies, l’histoire d’une âme » L’association Bellydance/);
    expect(show.description!.length).toBeLessThanOrEqual(200);
    expect(lead("Du 23 au 25 octobre l’ail est en fête au Domaine du Relais !Ouverture de la fête foraine dès le vendredi.")).toBe("Du 23 au 25 octobre l’ail est en fête au Domaine du Relais !");
  });

  it("keeps only the first sentence of every agenda's text, capped when it never ends", () => {
    expect(lead("Concert gratuit de l'école de musique, ouvert à tous. Buvette sur place. Venez nombreux !")).toBe("Concert gratuit de l'école de musique, ouvert à tous.");
    const endless = `Grand bal la kour ${"avec les groupes du quartier ".repeat(12)}`;
    expect(lead(endless).length).toBeLessThanOrEqual(200);
    expect(lead(endless)).toMatch(/^Grand bal la kour avec les groupes du quartier .*\S…$/);
    const read = [
      parseTribe(JSON.parse(fixture("tribe_le-port.json")), "Ville du Port", "Le Port"),
      parseTribe(JSON.parse(fixture("sechoir.json")), "Le Séchoir", "Saint-Leu"),
      parseOpenAgenda(JSON.parse(fixture("openagenda_cinor.json")), "CINOR"),
      parseRss(fixture("rss_le-tampon.xml"), "Ville du Tampon", "Le Tampon"),
      parseReunionFr(fixture("irt_agenda.html")),
      parseBisik(fixture("bisik.html")),
    ];
    for (const events of read) {
      const texts = events.map((e) => e.description).filter((d): d is string => !!d);
      expect(texts.length).toBeGreaterThan(0);
      for (const d of texts) {
        expect(d.length).toBeLessThanOrEqual(200);
        expect(lead(d)).toBe(d);
      }
    }
    // The DKLO's programme at Tan Rouge, many shows long: its first sentence.
    const dklo = read[1].find((e) => /TAN ROUGE/.test(e.titre))!;
    expect(dklo.description).toBe("14h30 & 17h Les contes Calumet – Contes 2×30 min Les Contes Calumet, spectacle ZINZIN de Jean Bernard Ifanohiza.");
    // Of the rest of its programme, only the genres it names.
    expect(dklo.themes).toEqual(expect.arrayContaining(["concert"]));
    expect(extrait("Atelier ouvert à tous. Puis concert de maloya.")).toEqual({ description: "Atelier ouvert à tous.", themes: ["concert"] });
    expect(extrait("Concert de maloya. Avec un autre concert.")).toEqual({ description: "Concert de maloya." });
  });

  it("reads Bras-Panon's agenda, a page a month, with the hours and the price", () => {
    const oct = parseBrasPanon(fixture("bras-panon_2026-10.html"), NOW);
    expect(oct).toHaveLength(10);
    expect(oct[0]).toMatchObject({ titre: "Atelier Pop Up Safari", seances: [{ debut: "2026-10-24T09:00", fin: "2026-10-24T10:00" }], commune: "Bras-Panon", lieu: undefined, prix: "Gratuit", description: "Fais surgir les animaux de la savane !", lien: "https://www.braspanon.re/fr/ev/2512733/1991459/atelier-pop-up-safari/2026/10/24", publie_par: "Ville de Bras-Panon" });
    // Over two days: the days, without the hour of the first.
    expect(oct.find((e) => e.titre === "1er Rally National Grand Est")!.seances).toEqual([{ debut: "2026-10-24", fin: "2026-10-25" }]);
    expect(parseBrasPanon(fixture("bras-panon_2026-11.html"), NOW).find((e) => e.titre === "Nout' Marché de Nuit à Bras-Panon")!.seances).toEqual([{ debut: "2026-11-10T17:00", fin: "2026-11-10T22:30" }]);
  });

  it("reads Saint-Benoît's events, the days without their year, and leaves out those without a date", () => {
    const list = parseSaintBenoit(fixture("saint-benoit.html"), NOW);
    expect(list.some((e) => e.titre === "Soirée Karaoké")).toBe(false); // « Tous les premiers jeudis du mois »
    expect(list.find((e) => e.titre === "Agenda sportif")).toMatchObject({ seances: [{ debut: "2026-10-23", fin: "2026-10-25" }], categories: ["Tout public"], commune: "Saint-Benoît", lien: "https://www.saint-benoit.re/evenements/articles/9592-agenda-sportif" });
    expect(list.find((e) => e.titre === "Atelier “Kaniki”")!.seances).toEqual([{ debut: "2026-10-28T09:30", fin: "2026-10-28T10:30" }]);
    expect(list.find((e) => e.titre.startsWith("Urban Konection"))!.seances).toEqual([{ debut: "2026-11-28" }]);
  });

  it("reads the tourist office of the East, its titles as written and its terms on each event", () => {
    const list = parseOtiEst(fixture("oti-est.html"), NOW);
    expect(list).toHaveLength(10);
    expect(list.every((e) => e.publie_par === OTI_EST && !e.description)).toBe(true);
    expect(list[1]).toMatchObject({ titre: "🎀 Grande Marche Rose : rendez-vous le 24 octobre ! 🎀", seances: [{ debut: "2026-10-24" }], commune: "Saint-Benoît" });
    expect(list.find((e) => e.titre.startsWith("FOLIES FLORALES"))).toMatchObject({ seances: [{ debut: "2026-10-30", fin: "2026-11-01" }], commune: "La Plaine-des-Palmistes" });
    // The markets, without a date, are not events.
    expect(list.some((e) => /^Marché forain/.test(e.titre))).toBe(false);
  });

  it("takes each source from one line of the agendas: its reading, its credit and its coverage", () => {
    const possession = AGENDAS.find((a) => a.id === "la_possession")!;
    expect(COVERED).toContain("La Possession");
    expect(SOURCES_LUES).toContain(possession.source);
    expect(COVERED).not.toContain("Saint-Pierre");
    expect(COVERED.every((c) => AGENDAS.some((a) => a.commune === c || a.couvre?.includes(c)))).toBe(true);
    expect(new Set(AGENDAS.map((a) => a.id)).size).toBe(AGENDAS.length);
  });

  it("understands when", () => {
    expect(periode("ce_week_end", NOW)).toMatchObject({ du: "2026-10-24", au: "2026-10-25", nom: "ce week-end" });
    expect(periode("ce week-end", new Date("2026-10-21T04:00:00Z"))).toMatchObject({ du: "2026-10-23", au: "2026-10-25" });
    expect(periode("ce soir", NOW)).toMatchObject({ du: "2026-10-24", au: "2026-10-24", soir: true });
    expect(periode("demain", NOW)).toMatchObject({ du: "2026-10-25", au: "2026-10-25" });
    expect(periode("samedi", NOW)).toMatchObject({ du: "2026-10-24", au: "2026-10-24" });
    expect(periode("mardi", NOW)).toMatchObject({ du: "2026-10-27", au: "2026-10-27" });
    expect(periode("31/10", NOW)).toMatchObject({ du: "2026-10-31", au: "2026-10-31" });
    expect(periode("n'importe quand", NOW)).toMatchObject({ du: "2026-10-24", au: "2026-11-07", incompris: true });
  });

  it("gives the island's next two weeks, the same event once, from every agenda", async () => {
    const c = cache();
    const b = body(await agenda(c, undefined, undefined, undefined, NOW));
    expect(b.resume).toBe("40 événements à La Réunion dans les deux semaines qui viennent (du samedi 24/10 au samedi 07/11).".replace("40", String(b.nombre)));
    // Without the sports programmes of La Possession, L'Étang-Salé and Saint-Benoît: the sport tool's.
    expect(b.nombre).toBe(101);
    expect(b.evenements).toHaveLength(40);
    expect(b.evenements.filter((e: { titre: string }) => e.titre === "Visite guidée de la Maison Carrère")).toHaveLength(1);
    // Published by reunion.fr and by Petite-Île, told once: the commune's, which gives the place.
    expect(b.evenements.find((e: { titre: string }) => /^Fête de l'ail/.test(e.titre))).toMatchObject({ titre: "Fête de l'ail 2026", quand: "du vendredi 23/10 au dimanche 25/10", lieu: "Domaine du Relais", commune: "Petite-Île", publie_par: "Ville de Petite-Île", lu_le: "samedi 24/10 à 08:00" });
    expect(b.evenements.filter((e: { titre: string }) => /^Fête de l'ail/.test(e.titre))).toHaveLength(1);
    const all = body(await agenda(c, undefined, undefined, undefined, NOW, 300));
    expect(new Set(all.evenements.map((e: { publie_par: string }) => e.publie_par))).toEqual(new Set(["reunion.fr", "Ville du Tampon", "Ville du Port", "Mairie des Trois-Bassins", "CINOR", "Mairie de Saint-Paul", "Ville de Saint-André",
      "Le Séchoir", "TÉAT La Réunion", "Cité des Arts", "Kabardock", "Bisik", "Théâtre Luc Donat", "CDNOI", "Léspas", "Ville de La Possession", "Ville de L'Étang-Salé",
      "Ville de Petite-Île", "Ville de Bras-Panon", "Ville de Saint-Benoît", "OTI EST REUNION — Droits réservés"]));
    // Last year's posts of Saint-Louis are past; nothing of theirs.
    expect(b.evenements.some((e: { publie_par: string }) => e.publie_par === "Ville de Saint-Louis")).toBe(false);
    expect(asked.every((ua) => ua === "rundata.re (contact@rundata.re)")).toBe(true);
    // Twenty-seven agendas (two pages for Bras-Panon), and the pages of the four shows on both TÉAT stages.
    expect(asked).toHaveLength(31);
  });

  it("leaves the communes' sports programmes to the sport tool, not the sports events", async () => {
    for (const t of ["Agenda sportif", "Agenda sportif du 22 au 24 octobre", "Planning des compétitions sportives du 23 au 25 octobre 2026", "Programme sportif du week-end", "Le calendrier sportif de novembre", "Planning des rencontres sportives"]) {
      expect(programmeSportif({ titre: t }), t).toBe(true);
    }
    for (const t of ["1er Rally National Grand Est", "Grand Raid 2026", "Match de gala : Saint-Pierre – Le Tampon", "Agenda culturel", "Sportifs à l'honneur", "Planning des vacances", "Programme sport-santé"]) {
      expect(programmeSportif({ titre: t }), t).toBe(false);
    }
    const c = cache();
    const all = body(await agenda(c, undefined, undefined, undefined, NOW, 300));
    const titles = all.evenements.map((e: { titre: string }) => e.titre);
    expect(titles.filter((t: string) => programmeSportif({ titre: t }))).toEqual([]);
    expect(titles).toContain("1er Rally National Grand Est");
    // Read with their agendas, kept in their copy for the sport tool.
    expect((await programmesSportifs(c)).map(({ e, agenda }) => [agenda.id, e.titre, e.seances])).toEqual([
      ["etang_sale", "Planning des compétitions sportives du 23 au 25 octobre 2026", [{ debut: "2026-10-23", fin: "2026-10-25" }]],
      ["la_possession", "Agenda sportif du 22 au 24 octobre", [{ debut: "2026-10-22", fin: "2026-10-24" }]],
      ["saint_benoit", "Agenda sportif", [{ debut: "2026-10-23", fin: "2026-10-25" }]],
    ]);
  });

  it("answers tonight, with the hours", async () => {
    const b = body(await agenda(cache(), undefined, "ce_soir", "concert", NOW));
    expect(b.resume).toBe("5 événements (concerts et musique) à La Réunion ce soir.");
    // A day without hours may be tonight: the musical of the East is.
    // The DKLO at Tan Rouge says « Cirque et musique » only after its first sentence: that text is not kept, the genre
    // it names is (`themes`), so the search still finds it.
    expect(b.evenements.map((e: { titre: string }) => e.titre)).toEqual(["CALOGERO", "Olivier Ker Ourio", "Une nouvelle comédie musicale indienne signée Sivayanama", "DKLO TAN ROUGE", "Somèn kréol – Plato Zartis"]);
    expect(b.evenements[0]).toMatchObject({ lieu: "TÉAT Plein Air", commune: "Saint-Paul", genres: ["concert"], publie_par: "TÉAT La Réunion" });
    expect(b.evenements[4]).toMatchObject({ quand: "samedi 24/10 de 18:00 à 23:00", commune: "Les Trois-Bassins" });
    // The genres are never returned as words of the source: no `themes` in a row.
    expect(b.evenements[3]).not.toHaveProperty("themes");
    expect(b.evenements[3].description).toBe("14h30 & 17h Les contes Calumet – Contes 2×30 min Les Contes Calumet, spectacle ZINZIN de Jean Bernard Ifanohiza.");
  });

  it("answers for a commune, with what its agenda gives", async () => {
    const b = body(await agenda(cache(), "Saint-Gilles", "a_venir", undefined, NOW));
    expect(b.lieu.commune).toBe("Saint-Paul");
    expect(b.evenements.map((e: { titre: string }) => e.titre)).toContain("La Koupe Kartié – Saint-Gilles-les-Bains");
    expect(b.evenements.every((e: { commune: string }) => e.commune === "Saint-Paul")).toBe(true);
  });

  it("says when a commune publishes no agenda, and what there is elsewhere", async () => {
    const b = body(await agenda(cache(), "Saint-Pierre", "ce_week_end", undefined, NOW));
    expect(b.resume).toMatch(/^Aucun événement trouvé à Saint-Pierre ce week-end .*la page agenda de la mairie de Saint-Pierre est vide et le Kerveguen n'est pas encore lu : seuls les grands événements de reunion.fr y figurent.* ailleurs sur l'île\.$/);
    expect(b.ailleurs_sur_l_ile.length).toBeGreaterThan(0);
  });

  it("answers without the agendas that fail, and names them", async () => {
    down = /reunion\.fr|openagenda/;
    const b = body(await agenda(cache(), undefined, "ce_week_end", undefined, NOW));
    expect(b.indisponible).toEqual(["CINOR", "Office de tourisme du Nord", "reunion.fr"]);
    expect(b.resume).toContain("3 agendas non lus cette fois : CINOR, Office de tourisme du Nord, reunion.fr (liste peut-être incomplète, à redemander dans une minute).");
    expect(b.evenements.length).toBeGreaterThan(0);
    down = /./;
    expect((await agenda(cache(), undefined, undefined, undefined, NOW)).isError).toBe(true);
  });

  it("does not wait for a slow agenda: its last copy, or nothing", async () => {
    let t = NOW.getTime();
    const c = new Cache(new MemoryStore(), () => t);
    await gather(c, NOW);
    // Seven hours later every copy is old; the Kabardock answers late, the Bisik not at all and had no copy kept.
    t += 7 * 3600_000;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("kabardock") || url.includes("bisik")) await new Promise((r) => setTimeout(r, 300));
      const f = file(url, typeof init?.body === "string" ? init.body : undefined);
      return f ? new Response(bytes(f)) : new Response("", { status: 503 });
    });
    const fresh = new Cache(new MemoryStore(), () => t);
    const [kept, none] = await Promise.all([gather(c, new Date(t), 100), gather(fresh, new Date(t), 100)]);
    expect(kept.find((g) => g.agenda.id === "kabardock")?.value?.stale).toBe(true);
    expect(none.find((g) => g.agenda.id === "bisik")?.value).toBeUndefined();
    expect(none.find((g) => g.agenda.id === "cinor")?.value?.value.length).toBeGreaterThan(0);
  });

  describe("within a Worker invocation's subrequests", () => {
    // Every fetch and every read or write of the data center's cache counts; past 50 the invocation fails.
    class EdgeLike extends MemoryStore {
      async get(key: string) {
        count();
        if (left() < 0) throw new Error("Too many subrequests by single Worker invocation");
        return super.get(key);
      }
      async put(key: string, entry: CacheEntry) {
        count();
        if (left() < 0) throw new Error("Too many subrequests by single Worker invocation");
        return super.put(key, entry);
      }
    }
    const isolate = (edge = new EdgeLike()) => new Cache(new TieredStore(new MemoryStore(), edge), () => NOW.getTime(), false);

    it("reads every agenda on a cold call, well under the limit, then nearly nothing", async () => {
      const c = isolate();
      const cold = await counted(WORKER_BUDGET, () => agenda(c, undefined, undefined, undefined, NOW));
      expect(body(cold.value).indisponible).toBeUndefined();
      expect(cold.used).toBeLessThanOrEqual(40);
      const warm = await counted(WORKER_BUDGET, () => agenda(c, undefined, undefined, undefined, NOW));
      expect(body(warm.value).nombre).toBe(body(cold.value).nombre);
      expect(warm.used).toBeLessThanOrEqual(2);
    });

    it("leaves for later the agendas it has no subrequests for, names them, and the next calls read them", async () => {
      const c = isolate();
      const first = await counted(WORKER_BUDGET, async () => {
        count(20); // what the invocation did before
        return agenda(c, undefined, undefined, undefined, NOW);
      });
      expect(first.used).toBeLessThanOrEqual(WORKER_BUDGET);
      const named = body(first.value).indisponible as string[];
      expect(named.length).toBeGreaterThan(0);
      expect(body(first.value).resume).toContain(`non lu${named.length > 1 ? "s" : ""} cette fois : ${named.join(", ")}`);
      expect(body(first.value).nombre).toBeGreaterThan(0);
      let rest = named;
      for (let i = 0; i < 5 && rest?.length; i++) {
        const next = await counted(WORKER_BUDGET, async () => {
          count(20);
          return agenda(c, undefined, undefined, undefined, NOW);
        });
        expect(next.used).toBeLessThanOrEqual(WORKER_BUDGET);
        rest = body(next.value).indisponible;
      }
      expect(rest).toBeUndefined();
      expect(body((await counted(WORKER_BUDGET, () => agenda(c, undefined, undefined, undefined, NOW))).value).resume).not.toContain("non lu");
    });

    it("keeps reading a slow agenda after the response, and stores it for the next question", async () => {
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        if (url.includes("kabardock")) await new Promise((r) => setTimeout(r, 300));
        const f = file(url, typeof init?.body === "string" ? init.body : undefined);
        return f ? new Response(bytes(f)) : new Response("", { status: 503 });
      });
      const edge = new EdgeLike();
      const kept: Promise<unknown>[] = [];
      const { value, settled } = await counted(WORKER_BUDGET, () => gather(isolate(edge), NOW, 100), (p) => kept.push(p));
      expect(value.find((g) => g.agenda.id === "kabardock")?.value).toBeUndefined();
      expect(kept).toHaveLength(1);
      await settled();
      // Another isolate of the data center, the Kabardock now down: its copy is there, fresh.
      vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
      const other = await counted(WORKER_BUDGET, () => gather(isolate(edge), NOW, 100));
      const kabardock = other.value.find((g) => g.agenda.id === "kabardock")?.value;
      expect(kabardock?.stale).toBe(false);
      expect(kabardock?.value.length).toBeGreaterThan(0);
    });
  });

  it("shows the hours of a row within its day", () => {
    expect(agendaHours("samedi 24/10 de 18:00 à 23:00")).toBe("18:00 – 23:00");
    expect(agendaHours("du dimanche 25/10 à 08:30 au lundi 26/10 à 16:00")).toBe("jusqu'au lundi 26/10");
    expect(agendaHours("mercredi 28/10")).toBe("");
  });
});
