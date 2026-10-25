import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_BUDGET, count, counted, left } from "../src/budget.js";
import { Cache, MemoryStore, TieredStore, type CacheEntry } from "../src/cache.js";
import { ACTUS_MAIRIES, AGENDAS, COVERED, LIGUE_VOLLEY, OTI_EST, SOURCES_LUES, SPORTSREGIONS, communeOf, programmeSportif, programmesSportifs, datesIn, lead, parseBrasPanon, parseIntraMuros, parseOpenAgenda, parseOtiEst, parsePetiteIle, parseReunionFr, parseRss, parseSaintBenoit, parseSalazie, parseSalazieNews, parseSpipNews, parseSportsregions, parseTribe, parseWpNews, salazieItems, toLocal } from "../src/providers/agenda.js";
import { annonceEvenement, extrait } from "../src/providers/agenda-mots.js";
import { parseBisik } from "../src/providers/salles.js";
import { agenda, COUVERTURE, gather, MAIRIES_LUES, periode, refreshPlanned } from "../src/tools/agenda.js";
import { agendaHours } from "../src/web/domains.js";
import { quand } from "../src/tools/sport.js";

// The communes' sites read, as once they have agreed (test/autorisations.test.ts for what is said until then).
vi.mock("../src/providers/autorisations.js", () => import("./autorisees.js"));

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
  if (url.includes("saintphilippe.re")) return "actus_saint-philippe.json";
  if (url.includes("ville-cilaos.fr")) return "actus_cilaos.json";
  // Sainte-Marie and Salazie on Sunday 25/10/2026 at 22:03: nothing to come, in their agendas as in their news.
  if (url.includes("ville-saintemarie.re/wp-json/tribe")) return "tribe_sainte-marie.json";
  if (url.includes("ville-saintemarie.re/wp-json/wp")) return "actus_sainte-marie.json";
  if (url.includes("ville-salazie.fr/category/10-agenda")) return "salazie_agenda.html";
  if (url.includes("ville-salazie.fr/category/actualites")) return "salazie_actus.html";
  if (url.includes("saintjoseph.re")) return "rss_saint-joseph.xml";
  if (url.includes("letampon")) return "rss_le-tampon.xml";
  if (url.includes("saintlouis.re/actualites")) return "rss_saint-louis-actus.xml";
  if (url.includes("saintlouis")) return "rss_saint-louis.xml";
  if (url.includes("saintleu.re")) return "actus_saint-leu.json";
  if (url.includes("plainedespalmistes.fr/wp-json/wp/v2/agenda")) return "agenda_plaine-des-palmistes.json";
  if (url.includes("plainedespalmistes.fr/wp-json/wp/v2/actus")) return "actus_plaine-des-palmistes.json";
  if (url.includes("lapossession")) return "rss_la-possession.xml";
  if (url.includes("letangsale")) return "rss_etang-sale.xml";
  if (url.includes("petite-ile")) return "petite-ile.html";
  if (url.includes("braspanon")) return url.endsWith("/2026/11") ? "bras-panon_2026-11.html" : url.endsWith("/2026/10") ? "bras-panon_2026-10.html" : undefined;
  if (url.includes("saint-benoit")) return "saint-benoit.html";
  if (url.includes("reunionest")) return "oti-est.html";
  if (url.includes("50316469")) return "openagenda_cinor.json";
  if (url.includes("32570974")) return "openagenda_otnord.json";
  if (url.includes("reunion.fr")) return "irt_agenda.html";
  // The clubs' calendar on Sunday 25/10/2026: four pages.
  if (url.includes("sportsregions")) return `sportsregions_${/[?&]page=(\d+)/.exec(url)?.[1] ?? "1"}.html`;
}
const PORTAIL = "https://portail.sportsregions.fr/reunion/calendrier-clubs-sportifs-en-reunion";
/** One club event in the portal's JSON-LD, as its pages write it. */
const ld = (name: string, startDate: string, club: string, postalCode = "97410", url = `https://club.example/evenements/${encodeURIComponent(name)}-${startDate}`) =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "SportsEvent", name, startDate, endDate: startDate.slice(0, 10), location: { "@type": "Place", name: club, address: { "@type": "PostalAddress", addressLocality: "SAINT PIERRE", postalCode } }, organizer: { "@type": "SportsOrganization", name: club }, sport: "Badminton", url })}</script>`;

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
    // The mairies' news, read by the scheduled event too, and Salazie's agenda before the league: their sites answer.
    const MAIRIES = ["saint_philippe", "cilaos", "saint_joseph", "saint_louis_actus", "saint_leu", "plaine_des_palmistes_agenda", "plaine_des_palmistes_actus", "sainte_marie_actus", "salazie_actus"];
    const titles = (b: { evenements?: { titre: string }[] }) => (b.evenements ?? []).map((e) => e.titre);
    const entry = async (store: MemoryStore) => ((await store.get("agendas:planifies"))?.value as Record<string, CacheEntry> | undefined)?.["agenda:lrvb"];
    const isLeague = (u: string) => new URL(u).hostname === "lrvb.re";
    beforeEach(() => {
      urls = [];
      league = () => new Response(bytes("tribe_lrvb.json"));
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        urls.push(url);
        if (isLeague(url)) return league();
        const f = file(url, typeof init?.body === "string" ? init.body : undefined);
        return f ? new Response(bytes(f)) : new Response("", { status: 503 });
      });
    });

    it("is read there only, once an hour, and its copy served to the questions for 48 hours", async () => {
      let t = NOW.getTime();
      const store = new MemoryStore();
      const at = () => new Cache(store, () => t);
      // A question never reads it, and says it has not been read yet while there is no copy (just put online).
      const before = body(await agenda(at(), undefined, undefined, undefined, NOW));
      expect(urls.some(isLeague)).toBe(false);
      expect(before.indisponible).toBeUndefined();
      expect(before.non_lus).toContain("Ligue réunionnaise de volley-ball : première lecture dans quelques minutes");
      expect(titles(before)).not.toContain(KING);
      expect(await refreshPlanned(at(), NOW)).toEqual({ lus: ["salazie", "lrvb", ...MAIRIES, "sportsregions"], gardes: [], reportes: [], trop_vieilles: [] });
      expect(urls.filter(isLeague)).toHaveLength(1);
      // Another isolate serves it, with the time it was read.
      const after = body(await agenda(at(), undefined, undefined, "King", NOW));
      expect(after.evenements.find((e: { titre: string }) => e.titre === KING)).toMatchObject({ lieu: "lieu à venir (voir la page de la Ligue)", lu_le: expect.stringContaining("08:00") });
      // Not again within the hour.
      t += 30 * 60_000;
      expect(await refreshPlanned(at(), new Date(t))).toEqual({ lus: [], gardes: [], reportes: [], trop_vieilles: [] });
      expect(urls.filter(isLeague)).toHaveLength(1);
      const read = body(await agenda(at(), undefined, undefined, undefined, NOW));
      expect(read.non_lus).toBeUndefined();
      expect(read.resume).not.toContain("sans lecture récente");
      // Past 48 hours unread, it is not served any more, and said with the time of its last reading, never left out.
      t = NOW.getTime() + 49 * 3600_000;
      const late = body(await agenda(at(), undefined, undefined, "King", new Date(t)));
      expect(titles(late)).not.toContain(KING);
      expect(late.indisponible).toBeUndefined();
      const since = `dernière lecture le ${quand(toLocal(NOW.toISOString()))}`;
      expect(late.non_lus).toContain(`Ligue réunionnaise de volley-ball : ${since}`);
      // In the summary, only a commune's own: the whole island's are in the field.
      expect(late.resume).not.toContain("sans lecture récente");
      // For a commune: its own agendas, said in the summary too, and those of the whole island, not the other communes'.
      const leu = body(await agenda(at(), "Saint-Leu", undefined, undefined, new Date(t)));
      expect(leu.non_lus).toEqual(expect.arrayContaining([`Ville de Saint-Leu : ${since}`, `Ligue réunionnaise de volley-ball : ${since}`]));
      expect(leu.non_lus.some((x: string) => x.startsWith("Ville de Saint-Louis"))).toBe(false);
      expect(leu.resume).toContain(`sans lecture récente : Ville de Saint-Leu, ${since} (voir non_lus).`);
      // La Plaine-des-Palmistes' agenda and news, one source name: named once.
      const plaine = body(await agenda(at(), "La Plaine-des-Palmistes", undefined, undefined, new Date(t)));
      expect(plaine.non_lus.filter((x: string) => x.startsWith("Ville de La Plaine-des-Palmistes"))).toHaveLength(1);
    });

    it("says its last reading failed, and when, when it has no copy to keep", async () => {
      const store = new MemoryStore();
      const at = () => new Cache(store, () => NOW.getTime());
      league = () => new Response("", { status: 503 });
      expect((await refreshPlanned(at(), NOW)).gardes).toEqual(["lrvb"]);
      const b = body(await agenda(at(), undefined, undefined, undefined, NOW));
      expect(b.non_lus).toEqual([`Ligue réunionnaise de volley-ball : dernière lecture sans succès (${quand(toLocal(NOW.toISOString()))})`]);
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
      expect(await refreshPlanned(at(), new Date(t))).toEqual({ lus: ["salazie", ...MAIRIES], gardes: ["lrvb"], reportes: [], trop_vieilles: [] });
      expect(await entry(store)).toEqual(first);
      // Not tried again at each scheduled event: only once its next reading is due, an hour after the failure.
      const tries = urls.filter(isLeague).length;
      t += 55 * 60_000;
      expect(await refreshPlanned(at(), new Date(t))).toEqual({ lus: [], gardes: [], reportes: [], trop_vieilles: [] });
      expect(urls.filter(isLeague)).toHaveLength(tries);
      t += 5 * 60_000;
      league = () => new Response(JSON.stringify({ events: [] }));
      expect(await refreshPlanned(at(), new Date(t))).toEqual({ lus: ["salazie", ...MAIRIES], gardes: ["lrvb"], reportes: [], trop_vieilles: [] });
      expect(await entry(store)).toEqual(first);
      // Finding nothing counts as a failure too: not read again within the hour; past it, read, and the copy replaced.
      t += 30 * 60_000;
      league = () => new Response(bytes("tribe_lrvb.json"));
      expect(await refreshPlanned(at(), new Date(t))).toEqual({ lus: [], gardes: [], reportes: [], trop_vieilles: [] });
      t += 30 * 60_000;
      expect(await refreshPlanned(at(), new Date(t))).toEqual({ lus: ["salazie", "lrvb", ...MAIRIES], gardes: [], reportes: [], trop_vieilles: [] });
      const second = await entry(store);
      expect(second?.fetchedAt).toBe(t);
      // Still failing two days on: the copy, no longer served, is said too old in the scheduled event's log (the clubs'
      // calendar, read every six hours, is read again). Saint-Leu's news, its one event past by then, find nothing:
      // kept the same way.
      t += 49 * 3600_000;
      league = () => new Response("", { status: 503 });
      expect(await refreshPlanned(at(), new Date(t))).toEqual({ lus: ["salazie", ...MAIRIES.filter((m) => m !== "saint_leu"), "sportsregions"], gardes: ["lrvb", "saint_leu"], reportes: [], trop_vieilles: ["lrvb", "saint_leu"] });
      expect(await entry(store)).toEqual(second);
    });

    it("writes when it failed even if it read nothing else, so that the next scheduled events, in other isolates, do not try again", async () => {
      let t = NOW.getTime();
      class Counting extends MemoryStore {
        puts = 0;
        async put(key: string, e: CacheEntry) {
          this.puts++;
          return super.put(key, e);
        }
      }
      const store = new Counting();
      const at = () => new Cache(store, () => t);
      await refreshPlanned(at(), NOW);
      // The league's copy two hours old, the others fresh: the league is the only one due.
      const stored = (await store.get("agendas:planifies"))!;
      const entries = stored.value as Record<string, CacheEntry>;
      entries["agenda:lrvb"] = { ...entries["agenda:lrvb"], fetchedAt: NOW.getTime() - 2 * 3600_000 };
      await store.put("agendas:planifies", stored);
      const copy = await entry(store);
      store.puts = 0;
      t += 5 * 60_000;
      league = () => new Response("", { status: 503 });
      expect(await refreshPlanned(at(), new Date(t))).toEqual({ lus: [], gardes: ["lrvb"], reportes: [], trop_vieilles: [] });
      expect(store.puts).toBe(1);
      expect(await entry(store)).toEqual(copy);
      // A new isolate at each scheduled event: not tried again within the hour, and nothing written.
      const tries = urls.filter(isLeague).length;
      for (let i = 0; i < 11; i++) {
        t += 5 * 60_000;
        expect((await refreshPlanned(at(), new Date(t))).gardes).toEqual([]);
      }
      expect(urls.filter(isLeague)).toHaveLength(tries);
      // Read again once it answers: the failure forgotten with the new copy, in the same write.
      league = () => new Response(bytes("tribe_lrvb.json"));
      t += 5 * 60_000;
      store.puts = 0;
      expect((await refreshPlanned(at(), new Date(t))).lus).toContain("lrvb");
      expect(store.puts).toBe(1);
      expect(Object.keys((await store.get("agendas:planifies"))?.value as Record<string, CacheEntry>)).not.toContain("echec:lrvb");
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
      const { value } = await counted(PAGE_BUDGET, async () => {
        count(left() - 5); // what the scheduled event did before: 5 left, KEEP_LEFT 4 of them
        return refreshPlanned(new Cache(store, () => NOW.getTime()), NOW);
      });
      expect(value).toEqual({ lus: [], gardes: [], reportes: ["salazie", "lrvb", ...MAIRIES, "sportsregions"], trop_vieilles: [] });
      expect(urls).toEqual([]);
      expect(store.puts).toBe(0);
    });

    it("is kept in KV: read once an hour whatever the data center the scheduled event runs in, served in all of them", async () => {
      let t = NOW.getTime();
      // Each data center its own cache, KV shared by all.
      const kv = new MemoryStore();
      const [edgeA, edgeB] = [new MemoryStore(), new MemoryStore()];
      const at = (edge: MemoryStore) => new Cache(edge, () => t, true, kv);
      // A copy left in a data center's cache before, by an earlier version: not served, and dropped there.
      const before = NOW.getTime() - 3 * 3600_000;
      await edgeB.put("agendas", { value: { "agenda:lrvb": { value: [{ id: "x", titre: "Tournoi d'avant", seances: [{ debut: "2026-11-01" }], categories: [], lien: "https://lrvb.re/x", publie_par: "Ligue réunionnaise de volley-ball" }], fetchedAt: before } }, fetchedAt: before });
      expect((await refreshPlanned(at(edgeA), NOW)).lus).toContain("lrvb");
      expect(await edgeA.get("agendas:planifies")).toBeUndefined();
      // A question answered in the other data center serves it, with the time it was read.
      expect(titles(body(await agenda(at(edgeB), undefined, undefined, "King", NOW)))).toContain(KING);
      expect(titles(body(await agenda(at(edgeB), undefined, undefined, "Tournoi", NOW)))).not.toContain("Tournoi d'avant");
      expect(Object.keys((await edgeB.get("agendas"))?.value as Record<string, CacheEntry>)).not.toContain("agenda:lrvb");
      // The next scheduled events, in either data center, do not read it again within the hour; past it, once.
      t += 5 * 60_000;
      expect(await refreshPlanned(at(edgeB), new Date(t))).toEqual({ lus: [], gardes: [], reportes: [], trop_vieilles: [] });
      t += 50 * 60_000;
      expect((await refreshPlanned(at(edgeA), new Date(t))).lus).toEqual([]);
      t += 10 * 60_000;
      expect((await refreshPlanned(at(edgeB), new Date(t))).lus).toContain("lrvb");
      expect(urls.filter(isLeague)).toHaveLength(2);
    });
  });

  describe("the clubs' calendar (Sportsregions), read by the scheduled event", () => {
    // Salazie's agenda and the mairies' news, read by the scheduled event before it.
    const MAIRIES = ["saint_philippe", "cilaos", "saint_joseph", "saint_louis_actus", "saint_leu", "plaine_des_palmistes_agenda", "plaine_des_palmistes_actus", "sainte_marie_actus", "salazie_actus"];
    const pages = [1, 2, 3, 4].map((n) => fixture(`sportsregions_${n}.html`));
    let urls: string[];
    beforeEach(() => {
      urls = [];
      vi.stubGlobal("fetch", async (url: string) => {
        urls.push(url);
        const f = file(url);
        return f ? new Response(bytes(f)) : new Response("", { status: 503 });
      });
    });

    it("reads the clubs' events, the members' sessions marked, the club's address never as the event's place", () => {
      const { evenements, adherents, ailleurs } = parseSportsregions(pages);
      // 109 on the four pages: 61 sessions for the members (« Jeu libre », « Entraînement », the weekly dive outings).
      expect([evenements.length, adherents, ailleurs]).toEqual([109, 61, 0]);
      const members = evenements.filter((e) => e.reserve_adherents);
      expect(members.every((e) => /jeu libre|entra[iî]nement|^plong[ée]e$/i.test(e.titre))).toBe(true);
      expect(evenements.filter((e) => !e.reserve_adherents).some((e) => /jeu libre|entra[iî]nement|^plong[ée]e$/i.test(e.titre))).toBe(false);
      expect(members.find((e) => e.titre.startsWith("Jeu libre"))!.organisateur).toEqual({ nom: "Badminton Club de Saint-Pierre", commune: "Saint-Pierre", sport: "Badminton", site: "https://www.bcspi.re" });
      // The commune of its title only; the club's in what it says of who organises it.
      expect(evenements.find((e) => e.titre === "Journée 1 interclubs - Saint-Paul")).toEqual({
        id: "sportsregions:https://bcsa.sportsregions.fr/evenements/2026/10/25/journee-1-interclubs-saint-paul-2558506",
        titre: "Journée 1 interclubs - Saint-Paul",
        seances: [{ debut: "2026-10-25T08:00" }],
        commune: "Saint-Paul",
        categories: ["Sport", "Badminton"],
        description: "Organisé par Badminton Club Saint-André (BCSA) (Saint-André)",
        lien: "https://bcsa.sportsregions.fr/evenements/2026/10/25/journee-1-interclubs-saint-paul-2558506",
        publie_par: "Badminton Club Saint-André (BCSA)",
        organisateur: { nom: "Badminton Club Saint-André (BCSA)", commune: "Saint-André", sport: "Badminton", site: "https://bcsa.sportsregions.fr" },
      });
      // Midnight: whole days. The golf league's address is at Le Tampon, its Grand Prix at the Golf de Bourbon.
      const gp = evenements.find((e) => e.titre === "GRAND PRIX LRGR DE BOURBON")!;
      expect([gp.seances, gp.commune]).toEqual([[{ debut: "2026-10-31", fin: "2026-11-01" }], undefined]);
      expect(evenements.find((e) => e.titre === "Compétition au Port (18m)")!.commune).toBe("Le Port");
      expect(evenements.find((e) => e.titre === "FITA Salle St André (25m-18m)")!.commune).toBe("Saint-André");
      // The event's own place, when the club gave one (« Localisation »): its commune too, the club's then unknown.
      expect(evenements.find((e) => e.titre === "Week-end PREPA 0-3000")).toMatchObject({
        lieu: "Gîte Bec a li, 4 chemin des Framboises",
        commune: "Cilaos",
        description: "Organisé par Leu Triathlon",
        organisateur: { nom: "Leu Triathlon", sport: "Triathlon", site: "https://leu-triathlon.sportsregions.fr" },
      });
      expect(evenements.find((e) => e.titre === "Week-end PREPA 0-3000")!.organisateur).not.toHaveProperty("commune");
      expect(evenements.filter((e) => e.lieu).map((e) => [e.lieu, e.commune])).toEqual([
        ["Gîte Bec a li, 4 chemin des Framboises", "Cilaos"],
        ["Parc du colosse", "Saint-André"],
        ["Stade Sarda Garriga", "Saint-André"],
        ["Parc du Colosse", "Saint-André"],
      ]);
      // Else the club's address is never said as the event's place.
      expect(evenements.filter((e) => e.lieu === undefined)).toHaveLength(105);
    });

    it("leaves out the clubs of elsewhere, and marks a title of the same club three times or more", () => {
      const twice = [ld("Tournoi de Noël", "2026-12-19T08:00:00Z", "BC Sud"), ld("Tournoi de Noël", "2026-12-20T08:00:00Z", "BC Sud")];
      const thrice = ["2026-11-03", "2026-11-10", "2026-11-17"].map((d) => ld("Sortie du mardi", `${d}T06:00:00Z`, "BC Sud"));
      const { evenements, adherents, ailleurs } = parseSportsregions([[...twice, ...thrice, ld("Open de Djibouti", "2026-11-14T08:00:00Z", "Club de Djibouti", "77000"), ld("Séance découverte", "2026-11-07T09:00:00Z", "BC Sud")].join("\n")]);
      expect(evenements.map((e) => [e.titre, e.seances[0].debut, !!e.reserve_adherents])).toEqual([
        ["Tournoi de Noël", "2026-12-19T08:00", false], ["Tournoi de Noël", "2026-12-20T08:00", false],
        ["Sortie du mardi", "2026-11-03T06:00", true], ["Sortie du mardi", "2026-11-10T06:00", true], ["Sortie du mardi", "2026-11-17T06:00", true],
        ["Séance découverte", "2026-11-07T09:00", true],
      ]);
      expect([adherents, ailleurs]).toEqual([4, 1]);
      // The same event on two pages is one.
      expect(parseSportsregions([twice[0], twice[0]]).evenements).toHaveLength(1);
      // A place named otherwise than the club: the event's, its name kept.
      const salle = ld("Tournoi d'automne", "2026-11-21T08:00:00Z", "BC Sud").replace('"name":"BC Sud","address":{"@type":"PostalAddress",', '"name":"Gymnase Paul-Julius-Bénard","address":{"@type":"PostalAddress","streetAddress":"rue Hubert Delisle",');
      expect(parseSportsregions([salle]).evenements[0]).toMatchObject({ lieu: "Gymnase Paul-Julius-Bénard, rue Hubert Delisle", commune: "Saint-Pierre", description: "Organisé par BC Sud" });
      // A block that is not an event, or not JSON, is passed over.
      expect(parseSportsregions(['<script type="application/ld+json">{ "@type": "BreadcrumbList" }</script><script type="application/ld+json">{ oops</script>']).evenements).toEqual([]);
    });

    it("reads its pages one after the other up to the last one linked, five at most, and says what it left out", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const { value } = await SPORTSREGIONS.load(cache(), NOW);
      expect(urls).toEqual([PORTAIL, `${PORTAIL}?page=2`, `${PORTAIL}?page=3`, `${PORTAIL}?page=4`]);
      expect(value).toHaveLength(109);
      expect(log).toHaveBeenCalledWith("agenda sportsregions : 4 pages, 109 événements dont 61 réservés aux adhérents, 0 hors de La Réunion");
      urls = [];
      vi.stubGlobal("fetch", async (url: string) => (urls.push(url), new Response(`${pages[0]}<a href="/reunion/calendrier-clubs-sportifs-en-reunion?page=9">9</a>`)));
      await SPORTSREGIONS.load(cache(), NOW);
      expect(urls).toHaveLength(SPORTSREGIONS.requetes!);
      log.mockRestore();
    });

    it("is read every six hours, served to the questions as an agenda of the whole island", async () => {
      const titles = (b: { evenements?: { titre: string }[] }) => (b.evenements ?? []).map((e) => e.titre);
      vi.spyOn(console, "log").mockImplementation(() => {});
      let t = NOW.getTime();
      const store = new MemoryStore();
      const at = () => new Cache(store, () => t);
      expect((await refreshPlanned(at(), NOW)).lus).toContain("sportsregions");
      const read = () => urls.filter((u) => u.includes("sportsregions")).length;
      expect(read()).toBe(4);
      t += 5 * 3600_000;
      expect((await refreshPlanned(at(), new Date(t))).lus).not.toContain("sportsregions");
      expect(read()).toBe(4);
      t += 3600_000;
      expect((await refreshPlanned(at(), new Date(t))).lus).toContain("sportsregions");
      expect(read()).toBe(8);
      const b = body(await agenda(at(), undefined, "à venir", "Grand Prix", new Date(t)));
      expect(b.evenements.find((e: { titre: string }) => e.titre === "GRAND PRIX LRGR DE BOURBON")).toMatchObject({ description: "Organisé par Ligue Régionale de Golf de La Réunion (Le Tampon)", publie_par: "Ligue Régionale de Golf de La Réunion" });
      // Not in a commune by the club's address.
      expect(titles(body(await agenda(at(), "Le Tampon", "à venir", "Grand Prix", new Date(t))))).not.toContain("GRAND PRIX LRGR DE BOURBON");
      // The members' sessions: not told by default; to a member, said reserved, with the club's site.
      const libre = (b: { evenements?: { titre: string }[] }) => (b.evenements ?? []).filter((e) => e.titre.startsWith("Jeu libre"));
      expect(libre(body(await agenda(at(), undefined, "à venir", "Jeu libre", new Date(t))))).toEqual([]);
      expect(libre(body(await agenda(at(), undefined, "à venir", undefined, new Date(t), 200)))).toEqual([]);
      const member = libre(body(await agenda(at(), undefined, "à venir", "Jeu libre", new Date(t), undefined, true)));
      expect(member.length).toBeGreaterThan(0);
      expect(member[0]).toMatchObject({ acces: "réservé aux adhérents de Badminton Club de Saint-Pierre", site_du_club: "https://www.bcspi.re", publie_par: "Badminton Club de Saint-Pierre" });
      // An event open to all says nothing of it.
      const gp = body(await agenda(at(), undefined, "à venir", "Grand Prix", new Date(t), undefined, true)).evenements.find((e: { titre: string }) => e.titre === "GRAND PRIX LRGR DE BOURBON");
      expect([gp.acces, gp.site_du_club]).toEqual([undefined, undefined]);
      vi.mocked(console.log).mockRestore();
    });

    it("fits with the volley league in what the scheduled event has left, or waits for a later one", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      // As KV in the Worker: each read and write of the bundle is a subrequest.
      class Kv extends MemoryStore {
        async get(key: string) {
          count(1);
          return super.get(key);
        }
        async put(key: string, e: CacheEntry) {
          count(1);
          return super.put(key, e);
        }
      }
      // 22 left: the bundle's read, Salazie's agenda, the league's page, the mairies' nine readings, the four pages, the
      // write, and KEEP_LEFT (4) still left.
      const both = await counted(PAGE_BUDGET, async () => {
        count(left() - 22);
        const out = await refreshPlanned(new Cache(new Kv(), () => NOW.getTime()), NOW);
        return { out, left: left() };
      });
      expect(both.value.out).toEqual({ lus: ["salazie", "lrvb", ...MAIRIES, "sportsregions"], gardes: [], reportes: [], trop_vieilles: [] });
      expect(both.value.left).toBe(5);
      // One fewer: the league and the mairies only, the clubs' calendar at a later run (its copy served meanwhile).
      urls = [];
      const one = await counted(PAGE_BUDGET, async () => {
        count(left() - 21);
        return refreshPlanned(new Cache(new Kv(), () => NOW.getTime()), NOW);
      });
      expect(one.value).toEqual({ lus: ["salazie", "lrvb", ...MAIRIES], gardes: [], reportes: ["sportsregions"], trop_vieilles: [] });
      expect(urls.filter((u) => u.includes("sportsregions"))).toEqual([]);
      vi.mocked(console.log).mockRestore();
    });
  });

  describe("a mairie's news (Saint-Philippe, Cilaos, Saint-Joseph)", () => {
    const seen = (list: { titre: string; seances: unknown[] }[]) => list.map((e) => [e.titre, e.seances]);

    it("keeps only the articles that give an event's day, today or later, and no service notice", () => {
      expect(seen(parseWpNews(JSON.parse(fixture("actus_saint-philippe.json")), "Mairie de Saint-Philippe", "Saint-Philippe", NOW))).toEqual([
        ["« Union » : repas de partage et séance poétique le 25 octobre", [{ debut: "2026-10-25" }]],
        ["Dépistage respiratoire gratuit à Saint-Philippe le 18 novembre", [{ debut: "2026-11-18" }]],
      ]);
      // Not « Distribution de compost à Cilaos : suspension temporaire le 27 octobre 2026 », a day and a service; nor
      // the Café des Aidants of the 22nd, past.
      const cilaos = parseWpNews(JSON.parse(fixture("actus_cilaos.json")), "Ville de Cilaos", "Cilaos", NOW);
      expect(seen(cilaos)).toEqual([["Journée de prévention de l’AVC à Cilaos le 28 octobre 2026", [{ debut: "2026-10-28" }]]]);
      expect(cilaos[0]).toMatchObject({ commune: "Cilaos", publie_par: "Ville de Cilaos", lien: expect.stringContaining("ville-cilaos.fr") });
      expect(parseWpNews([{ date: "2026-10-23T10:00:00", link: "https://ville-cilaos.fr/conseil", title: { rendered: "Séance du conseil municipal le 28 octobre 2026" } }], "Ville de Cilaos", "Cilaos", NOW)).toEqual([]);
      // The day in the first sentence (« Du 7 au 11 novembre 2026, … »); not the hours of the swimming pools, nor the
      // holidays' stays, which give no day.
      expect(seen(parseSpipNews(fixture("rss_saint-joseph.xml"), "Ville de Saint-Joseph", "Saint-Joseph", NOW))).toEqual([
        ["Safran en fête 2026 : cinq jours de festivités à la Plaine des Grègues", [{ debut: "2026-11-07", fin: "2026-11-11" }]],
        ["La Caravane Santé fait étape à Saint-Joseph le 24 octobre 2026", [{ debut: "2026-10-24T09:00", fin: "2026-10-24T15:00" }]],
      ]);
      // Saint-Louis's news (Joomla, a feed of the same shape), on 25/10/2026: calls for traders and applicants only
      // (« Forum des associations 2026 : appel aux professionnels de la restauration rapide », its day the forum's),
      // never an event's announcement to the public.
      expect(parseSpipNews(fixture("rss_saint-louis-actus.xml"), "Ville de Saint-Louis", "Saint-Louis", NOW)).toEqual([]);
      expect(["Toussaint : appel à candidatures pour la vente de fleurs le 31 octobre", "Kermesse du 10 octobre : appel aux forains", "Brocante du 8 novembre : avis de publicité"].filter(annonceEvenement)).toEqual([]);
      expect(annonceEvenement("Fête de la musique le 21 juin : concerts au parc")).toBe(true);
      // Saint-Leu's « Actualité »: the one event with its days in its title; not the Grand Raid's reception, whose day
      // is only in the article.
      expect(seen(parseWpNews(JSON.parse(fixture("actus_saint-leu.json")), "Ville de Saint-Leu", "Saint-Leu", NOW))).toEqual([
        ["La Fête des Artichauts et du Terroir revient au Plate du 23 au 25 octobre 2026", [{ debut: "2026-10-23", fin: "2026-10-25" }]],
      ]);
      // La Plaine-des-Palmistes's agenda and news, on 25/10/2026: nothing with its day in its title.
      expect(parseWpNews(JSON.parse(fixture("agenda_plaine-des-palmistes.json")), "Ville de La Plaine-des-Palmistes", "La Plaine-des-Palmistes", NOW)).toEqual([]);
      expect(parseWpNews(JSON.parse(fixture("actus_plaine-des-palmistes.json")), "Ville de La Plaine-des-Palmistes", "La Plaine-des-Palmistes", NOW)).toEqual([]);
    });

    it("reads Saint-Louis's whole agenda, whose events keep their title as the commune writes it", () => {
      expect(parseRss(fixture("rss_saint-louis-agenda.xml"), "Ville de Saint-Louis", "Saint-Louis", true).map((e) => [e.titre, e.seances, e.lien])).toEqual([
        ["Mois des séniors : Saint-Louis y mèt ses gramounes en lèr", [{ debut: "2026-10-02", fin: "2026-10-28" }], "https://saintlouis.re/agenda-menu/3107-mois-des-seniors-saint-louis-y-met-ses-gramounes-en-ler"],
      ]);
      const saintLouis = AGENDAS.filter((a) => a.commune === "Saint-Louis");
      expect(saintLouis.map((a) => a.id)).toEqual(["saint_louis", "saint_louis_actus"]);
      expect(saintLouis.every((a) => a.source.licence === "Reprise autorisée à des fins d'information, sans usage commercial (mentions légales du site)" && a.site_commune === "site de la commune de Saint-Louis")).toBe(true);
    });

    it("says what else is read in Saint-Leu, its news being no full agenda: Le Séchoir's programme", async () => {
      const b = body(await agenda(cache(), "Saint-Leu", undefined, undefined, NOW));
      expect(b.resume).toContain("Saint-Leu : seuls les événements annoncés dans les actualités de la Ville de Saint-Leu sont lus, ce n'est pas un agenda complet\u00a0; s'y ajoutent le programme du Séchoir et les grands événements de reunion.fr");
      expect(body(await agenda(cache(), "Saint-Philippe", undefined, undefined, NOW)).resume).toContain("ce n'est pas un agenda complet, avec les grands événements de reunion.fr");
    });

    it("credits Saint-Leu and La Plaine-des-Palmistes as their terms ask, « © https://www.ville-plainedespalmistes.fr » included", () => {
      const of = (c: string) => AGENDAS.filter((a) => a.commune === c && a.site_commune);
      expect(of("Saint-Leu").map((a) => [a.id, a.site_commune])).toEqual([["saint_leu", "site de la commune de Saint-Leu"]]);
      expect(of("La Plaine-des-Palmistes").map((a) => [a.id, a.site_commune])).toEqual([
        ["plaine_des_palmistes_agenda", "site de la commune de La Plaine-des-Palmistes (©\u00a0https://www.ville-plainedespalmistes.fr)"],
        ["plaine_des_palmistes_actus", "site de la commune de La Plaine-des-Palmistes (©\u00a0https://www.ville-plainedespalmistes.fr)"],
      ]);
      expect([...of("Saint-Leu"), ...of("La Plaine-des-Palmistes")].every((a) => a.planifie && /^Reprise autorisée à des fins d'information/.test(a.source.licence))).toBe(true);
      // Saint-Leu's terms keep its texts: its events without their sentence. La Plaine-des-Palmistes's allow them.
      expect([...of("Saint-Leu"), ...of("La Plaine-des-Palmistes")].map((a) => !!a.faits)).toEqual([true, false, false]);
      expect(of("La Plaine-des-Palmistes").map((a) => a.source.nom)).toEqual(["Agenda de la Ville de La Plaine-des-Palmistes (événements annoncés avec leur date)", "Actualités de la Ville de La Plaine-des-Palmistes (événements annoncés)"]);
    });

    it("reads Sainte-Marie's news and Salazie's pages, which had nothing to come on 25/10/2026", () => {
      // Not the two calls for applications for the stalls of the brocante de Beauséjour (« … jusqu'au 26 octobre 8h00 »):
      // their day is a deadline.
      expect(parseWpNews(JSON.parse(fixture("actus_sainte-marie.json")), "Ville de Sainte-Marie", "Sainte-Marie", NOW)).toEqual([]);
      // No feed and no API on Salazie's site: its posts as its category pages list them, each linked by its id.
      const items = salazieItems(fixture("salazie_agenda.html"));
      expect(items).toHaveLength(6);
      expect(items.find((i) => i.titre === "Rando tec tec carte de la réunion")).toEqual({ id: "1023", titre: "Rando tec tec carte de la réunion", texte: "Date de l’événement: 14/11/22", lien: "https://ville-salazie.fr/?p=1023" });
      expect(parseSalazie(fixture("salazie_agenda.html"), NOW)).toEqual([]);
      // Its day as the page writes it, an event while it is to come: on 01/11/2022, the four of them still to come.
      const before = parseSalazie(fixture("salazie_agenda.html"), new Date("2022-11-01T04:00:00Z"));
      expect(before.map((e) => e.seances[0].debut)).toEqual(["2022-11-14", "2024-02-26", "2024-06-18", "2025-02-21"]);
      expect([before[0].titre, before[0].lien, before[0].commune, before[0].publie_par]).toEqual(["Rando tec tec carte de la réunion", "https://ville-salazie.fr/?p=1023", "Salazie", "Ville de Salazie"]);
      expect(parseSalazieNews(fixture("salazie_actus.html"), NOW)).toEqual([]);
      // A news item is an event when its title gives its day with the year: the page dates no post, so a day without
      // its year is never placed in one.
      const post = (titre: string) => `<div class="elementor e-loop-item post-9"><h1 class="elementor-heading-title">${titre}</h1><div class="elementor-widget" data-widget_type="theme-post-excerpt.default"><p>Ouvert à tous.</p></div></div>`;
      expect(parseSalazieNews(post("Concert de la Fête du chouchou le 14 novembre 2026"), NOW).map((e) => [e.titre, e.seances, e.lien])).toEqual([["Concert de la Fête du chouchou le 14 novembre 2026", [{ debut: "2026-11-14" }], "https://ville-salazie.fr/?p=9"]]);
      expect(parseSalazieNews(post("Concert de la Fête du chouchou le 14 novembre"), NOW)).toEqual([]);
    });

    it("credits Sainte-Marie's and Salazie's sites without saying they allow it, and keeps their facts only", () => {
      for (const id of ["sainte_marie", "salazie", "sainte_marie_actus", "salazie_actus"]) {
        const a = AGENDAS.find((x) => x.id === id)!;
        expect(a.source.licence).toMatch(/^Information publique \((?:agenda|actualités) municipa(?:l|les)\)\u00a0; aucune condition de reprise écrite sur le site$/);
        expect(a).toMatchObject({ faits: true, site_commune: expect.stringMatching(/^site de la commune de (?:Sainte-Marie|Salazie)$/) });
      }
      // Salazie's are read by the scheduled event; Sainte-Marie's agenda by the questions, one subrequest.
      expect(AGENDAS.filter((x) => ["sainte_marie", "salazie"].includes(x.id)).map((x) => [x.id, !!x.planifie])).toEqual([["sainte_marie", false], ["salazie", true]]);
    });

    it("says it is no full agenda, in the answer for the commune and in the coverage", async () => {
      const c = cache();
      await refreshPlanned(c, NOW);
      const b = body(await agenda(c, "Saint-Philippe", undefined, undefined, NOW));
      expect(b.resume).toContain("Saint-Philippe : seuls les événements annoncés dans les actualités de la Mairie de Saint-Philippe sont lus, ce n'est pas un agenda complet");
      expect(b.evenements.map((e: { titre: string }) => e.titre)).toContain("« Union » : repas de partage et séance poétique le 25 octobre");
      // Its site's terms ask for an authorisation: the facts, without the sentence of the article, and where they come from.
      const union = b.evenements.find((e: { titre: string }) => e.titre.startsWith("« Union »"));
      expect(parseWpNews(JSON.parse(fixture("actus_saint-philippe.json")), "Mairie de Saint-Philippe", "Saint-Philippe", NOW).find((e) => e.titre.startsWith("« Union »"))?.description).toBeTruthy();
      expect(union.description).toBeUndefined();
      expect(union.source).toBe("site de la commune de Saint-Philippe, lu le samedi 24/10 à 08:00");
      expect(union.lien).toContain("saintphilippe.re/");
      expect(COUVERTURE).toContain("Actualités des mairies, pour les seuls événements qu'elles annoncent avec leur date (pas un agenda complet) : Saint-Philippe, Cilaos, Saint-Joseph, Saint-Louis, Saint-Leu, La Plaine-des-Palmistes, Sainte-Marie, Salazie.");
      expect(MAIRIES_LUES).not.toContain("Saint-Philippe");
      expect(ACTUS_MAIRIES.every((a) => a.planifie && AGENDAS.includes(a))).toBe(true);
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

  it("reads the feed of L'Étang-Salé, the first sentence of its text only", () => {
    const etang = parseRss(fixture("rss_etang-sale.xml"), "Ville de L'Étang-Salé", "L'Étang-Salé", true);
    expect(etang.map((e) => [e.titre, e.seances, e.description])).toEqual([
      ["Planning des compétitions sportives du 23 au 25 octobre 2026", [{ debut: "2026-10-23", fin: "2026-10-25" }], undefined],
      // Without the hour of its posting (« 24 Octobre 2026 09:20 ») nor its label (« EVENEMENT »).
      ["Marche Solidaire contre la polio", [{ debut: "2026-10-24" }], "Rendez-vous demain, samedi 24 octobre pour la marche solidaire contre la polio !"],
    ]);
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

  it("says which commune's site each event of a mairie comes from and when it was read, keeping what each site's terms allow", async () => {
    const all = body(await agenda(cache(), undefined, undefined, undefined, NOW, 300));
    type Row = { publie_par: string; source?: string; description?: string; lien?: string };
    const by = (p: string): Row[] => all.evenements.filter((e: Row) => e.publie_par === p);
    const tampon = by("Ville du Tampon");
    expect(tampon.length).toBeGreaterThan(0);
    // Its terms ask for an authorisation, and allow a link to the home page only.
    expect(tampon.every((e) => e.source === "site de la commune du Tampon, lu le samedi 24/10 à 08:00" && !e.description && e.lien === "https://letampon.fr/")).toBe(true);
    // Le Port's allow reproducing them, with « www.ville-port.re », never cut from its « © ».
    expect(by("Ville du Port").every((e) => e.source === "site de la commune du Port (©\u00a0www.ville-port.re), lu le samedi 24/10 à 08:00")).toBe(true);
    expect(by("Ville du Port").some((e) => e.description)).toBe(true);
    expect(by("Mairie de Saint-Paul")[0].source).toBe("site de la commune de Saint-Paul, lu le samedi 24/10 à 08:00");
    for (const [p, commune] of [["Ville de Saint-André", "de Saint-André"], ["Ville de L'Étang-Salé", "de L'Étang-Salé"], ["Ville de La Possession", "de La Possession"], ["Ville de Petite-Île", "de Petite-Île"], ["Ville de Bras-Panon", "de Bras-Panon"], ["Ville de Saint-Benoît", "de Saint-Benoît"]]) {
      expect(by(p).length, p).toBeGreaterThan(0);
      expect(by(p).every((e) => !e.description && e.source === `site de la commune ${commune}, lu le samedi 24/10 à 08:00`), p).toBe(true);
    }
    expect(by("Ville de Petite-Île").every((e) => e.lien === "https://www.petite-ile.re/")).toBe(true);
    expect(by("Ville de Saint-Benoît").every((e) => e.lien === "https://www.saint-benoit.re/")).toBe(true);
    // Bras-Panon's terms say nothing of links: each its own page.
    expect(by("Ville de Bras-Panon").every((e) => e.lien?.startsWith("https://www.braspanon.re/fr/ev/"))).toBe(true);
    // Not a commune's site: no such line.
    expect(all.evenements.filter((e: Row) => ["reunion.fr", "CINOR", "TÉAT La Réunion", "OTI EST REUNION — Droits réservés"].includes(e.publie_par)).every((e: Row) => e.source === undefined)).toBe(true);
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
    // By the same rules as the agenda tool: Saint-Benoît's links to its home page, no sentence of the text.
    const programmes = await programmesSportifs(c);
    expect(programmes.find(({ agenda }) => agenda.id === "saint_benoit")?.e.lien).toBe("https://www.saint-benoit.re/");
    expect(programmes.every(({ e }) => !e.description)).toBe(true);
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
    expect(b.remises).toBeUndefined();
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
      const cold = await counted(PAGE_BUDGET, () => agenda(c, undefined, undefined, undefined, NOW));
      expect(body(cold.value).indisponible).toBeUndefined();
      expect(cold.used).toBeLessThanOrEqual(40);
      const warm = await counted(PAGE_BUDGET, () => agenda(c, undefined, undefined, undefined, NOW));
      expect(body(warm.value).nombre).toBe(body(cold.value).nombre);
      expect(warm.used).toBeLessThanOrEqual(2);
    });

    it("reads the scheduled event's copies from KV once, cold, within the budget", async () => {
      const kv = new EdgeLike(); // each read or write of KV counts too
      await refreshPlanned(new Cache(new MemoryStore(), () => NOW.getTime(), false, kv), NOW);
      const reads = vi.spyOn(kv, "get");
      const c = new Cache(new TieredStore(new MemoryStore(), new EdgeLike()), () => NOW.getTime(), false, kv);
      const cold = await counted(PAGE_BUDGET, () => agenda(c, undefined, undefined, undefined, NOW));
      expect(body(cold.value).indisponible).toBeUndefined();
      expect(cold.used).toBeLessThanOrEqual(40);
      expect(reads).toHaveBeenCalledTimes(1);
      const king = await counted(PAGE_BUDGET, () => agenda(c, undefined, undefined, "King", NOW));
      expect(body(king.value).evenements.map((e: { titre: string }) => e.titre)).toContain("King Saison 6 Solo étape 2");
      expect(king.used).toBeLessThanOrEqual(2);
      expect(reads).toHaveBeenCalledTimes(1);
    });

    it("leaves for later the agendas it has no subrequests for, names them, and the next calls read them", async () => {
      const c = isolate();
      const first = await counted(PAGE_BUDGET, async () => {
        count(PAGE_BUDGET - PAGE_BUDGET / 10 - 16); // what the invocation did before: 16 left for the agendas
        return agenda(c, undefined, undefined, undefined, NOW);
      });
      expect(first.used).toBeLessThanOrEqual(PAGE_BUDGET);
      const named = body(first.value).indisponible as string[];
      expect(named.length).toBeGreaterThan(0);
      expect(body(first.value).resume).toContain(`non lu${named.length > 1 ? "s" : ""} cette fois : ${named.join(", ")}`);
      expect(body(first.value).nombre).toBeGreaterThan(0);
      // Left to the next question, not silent: said apart (the pages' « Lecture remise à la suivante »).
      expect(body(first.value).remises).toEqual(named);
      let rest = named;
      for (let i = 0; i < 5 && rest?.length; i++) {
        const next = await counted(PAGE_BUDGET, async () => {
          count(20);
          return agenda(c, undefined, undefined, undefined, NOW);
        });
        expect(next.used).toBeLessThanOrEqual(PAGE_BUDGET);
        rest = body(next.value).indisponible;
      }
      expect(rest).toBeUndefined();
      expect(body((await counted(PAGE_BUDGET, () => agenda(c, undefined, undefined, undefined, NOW))).value).resume).not.toContain("non lu");
    });

    it("keeps reading a slow agenda after the response, and stores it for the next question", async () => {
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        if (url.includes("kabardock")) await new Promise((r) => setTimeout(r, 300));
        const f = file(url, typeof init?.body === "string" ? init.body : undefined);
        return f ? new Response(bytes(f)) : new Response("", { status: 503 });
      });
      const edge = new EdgeLike();
      const kept: Promise<unknown>[] = [];
      const { value, settled } = await counted(PAGE_BUDGET, () => gather(isolate(edge), NOW, 100), (p) => kept.push(p));
      expect(value.find((g) => g.agenda.id === "kabardock")?.value).toBeUndefined();
      expect(kept).toHaveLength(1);
      await settled();
      // Another isolate of the data center, the Kabardock now down: its copy is there, fresh.
      vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
      const other = await counted(PAGE_BUDGET, () => gather(isolate(edge), NOW, 100));
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
