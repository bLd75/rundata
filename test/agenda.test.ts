import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKER_FREE_LIMIT, count, counted, left } from "../src/budget.js";
import { Cache, MemoryStore, TieredStore, type CacheEntry } from "../src/cache.js";
import { communeOf, datesIn, parseReunionFr, parseTribe } from "../src/providers/agenda.js";
import { agenda, gather, periode } from "../src/tools/agenda.js";
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
  if (url.includes("letampon")) return "rss_le-tampon.xml";
  if (url.includes("saintlouis")) return "rss_saint-louis.xml";
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

  it("reads reunion.fr's agenda from its page", () => {
    const list = parseReunionFr(fixture("irt_agenda.html"));
    expect(list.map((e) => [e.titre, e.commune, e.seances])).toEqual([
      ["Dan Ron Mafate", "Saint-Paul", [{ debut: "2026-10-23", fin: "2026-10-24" }]],
      ["Fête de l'ail", "Petite-Île", [{ debut: "2026-10-23", fin: "2026-10-25" }]],
    ]);
    expect(() => parseReunionFr("<html></html>")).toThrow();
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
    expect(b.nombre).toBe(56);
    expect(b.evenements).toHaveLength(40);
    expect(b.evenements.filter((e: { titre: string }) => e.titre === "Visite guidée de la Maison Carrère")).toHaveLength(1);
    expect(b.evenements[1]).toMatchObject({ titre: "Fête de l'ail", quand: "du vendredi 23/10 au dimanche 25/10", commune: "Petite-Île", publie_par: "reunion.fr" });
    const all = body(await agenda(c, undefined, undefined, undefined, NOW, 300));
    expect(new Set(all.evenements.map((e: { publie_par: string }) => e.publie_par))).toEqual(new Set(["reunion.fr", "Ville du Tampon", "Ville du Port", "Mairie des Trois-Bassins", "CINOR", "Mairie de Saint-Paul", "Ville de Saint-André",
      "Le Séchoir", "TÉAT La Réunion", "Cité des Arts", "Kabardock", "Bisik", "Théâtre Luc Donat", "CDNOI", "Léspas"]));
    // Last year's posts of Saint-Louis are past; nothing of theirs.
    expect(b.evenements.some((e: { publie_par: string }) => e.publie_par === "Ville de Saint-Louis")).toBe(false);
    expect(asked.every((ua) => ua === "rundata.re (contact@rundata.re)")).toBe(true);
    // Nineteen agendas, and the pages of the four shows on both TÉAT stages.
    expect(asked).toHaveLength(23);
  });

  it("answers tonight, with the hours", async () => {
    const b = body(await agenda(cache(), undefined, "ce_soir", "concert", NOW));
    expect(b.resume).toBe("4 événements (concerts et musique) à La Réunion ce soir.");
    expect(b.evenements.map((e: { titre: string }) => e.titre)).toEqual(["CALOGERO", "Olivier Ker Ourio", "DKLO TAN ROUGE", "Somèn kréol – Plato Zartis"]);
    expect(b.evenements[0]).toMatchObject({ lieu: "TÉAT Plein Air", commune: "Saint-Paul", genres: ["concert"], publie_par: "TÉAT La Réunion" });
    expect(b.evenements[3]).toMatchObject({ quand: "samedi 24/10 de 18:00 à 23:00", commune: "Les Trois-Bassins" });
  });

  it("answers for a commune, with what its agenda gives", async () => {
    const b = body(await agenda(cache(), "Saint-Gilles", "a_venir", undefined, NOW));
    expect(b.lieu.commune).toBe("Saint-Paul");
    expect(b.evenements.map((e: { titre: string }) => e.titre)).toContain("La Koupe Kartié – Saint-Gilles-les-Bains");
    expect(b.evenements.every((e: { commune: string }) => e.commune === "Saint-Paul")).toBe(true);
  });

  it("says when a commune publishes no agenda, and what there is elsewhere", async () => {
    const b = body(await agenda(cache(), "Saint-Pierre", "ce_week_end", undefined, NOW));
    expect(b.resume).toMatch(/^Aucun événement trouvé à Saint-Pierre ce week-end .*ni la mairie de Saint-Pierre ni une salle de la commune ne publient d'agenda lisible.* ailleurs sur l'île\.$/);
    expect(b.ailleurs_sur_l_ile.length).toBeGreaterThan(0);
  });

  it("answers without the agendas that fail, and names them", async () => {
    down = /reunion\.fr|openagenda/;
    const b = body(await agenda(cache(), undefined, "ce_week_end", undefined, NOW));
    expect(b.indisponible).toEqual(["CINOR", "Office de tourisme du Nord", "reunion.fr"]);
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
      const cold = await counted(WORKER_FREE_LIMIT, () => agenda(c, undefined, undefined, undefined, NOW));
      expect(body(cold.value).indisponible).toBeUndefined();
      expect(cold.used).toBeLessThanOrEqual(40);
      const warm = await counted(WORKER_FREE_LIMIT, () => agenda(c, undefined, undefined, undefined, NOW));
      expect(body(warm.value).nombre).toBe(body(cold.value).nombre);
      expect(warm.used).toBeLessThanOrEqual(2);
    });

    it("leaves for later the agendas it has no subrequests for, names them, and the next calls read them", async () => {
      const c = isolate();
      const first = await counted(WORKER_FREE_LIMIT, async () => {
        count(30); // what the invocation did before
        return agenda(c, undefined, undefined, undefined, NOW);
      });
      expect(first.used).toBeLessThanOrEqual(WORKER_FREE_LIMIT);
      const named = body(first.value).indisponible as string[];
      expect(named.length).toBeGreaterThan(0);
      expect(body(first.value).nombre).toBeGreaterThan(0);
      let rest = named;
      for (let i = 0; i < 5 && rest?.length; i++) {
        const next = await counted(WORKER_FREE_LIMIT, async () => {
          count(30);
          return agenda(c, undefined, undefined, undefined, NOW);
        });
        expect(next.used).toBeLessThanOrEqual(WORKER_FREE_LIMIT);
        rest = body(next.value).indisponible;
      }
      expect(rest).toBeUndefined();
    });

    it("keeps reading a slow agenda after the response, and stores it for the next question", async () => {
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        if (url.includes("kabardock")) await new Promise((r) => setTimeout(r, 300));
        const f = file(url, typeof init?.body === "string" ? init.body : undefined);
        return f ? new Response(bytes(f)) : new Response("", { status: 503 });
      });
      const edge = new EdgeLike();
      const kept: Promise<unknown>[] = [];
      const { value, settled } = await counted(WORKER_FREE_LIMIT, () => gather(isolate(edge), NOW, 100), (p) => kept.push(p));
      expect(value.find((g) => g.agenda.id === "kabardock")?.value).toBeUndefined();
      expect(kept).toHaveLength(1);
      await settled();
      // Another isolate of the data center, the Kabardock now down: its copy is there, fresh.
      vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
      const other = await counted(WORKER_FREE_LIMIT, () => gather(isolate(edge), NOW, 100));
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
