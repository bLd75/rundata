import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { whenFailed, whenRead } from "../src/http.js";
import { AGENDAS, WEEZEVENT, planifies, parQui, WZ_BILLETTERIE, WZ_PUBLIE_PAR, avecRef, configureWeezevent, parseWeezevent, type AgendaStore } from "../src/providers/agenda.js";
import { FICHES, FAMILLES } from "../src/producteurs.js";
import { eventRow } from "../src/tools/agenda.js";

// What `/event/search/` answers, in the shape of Weezevent's doc (https://api.weezevent.com/doc/, read on 26/10/2026):
// one event of the island, one of the mainland, one without a ticketing page.
const SEARCH = {
  last_update: "2026-10-26 18:00:00",
  count: 3,
  events: [
    {
      id: 1203451,
      title: "DESINVOLT 30/10/26 - 20 YEARS REKIDS",
      site_url: "https://desinvolt.example",
      description: "&lt;p&gt;Une nuit de musique électronique au Mont Vert. Dix artistes.&lt;/p&gt;",
      image: "https://www.weezevent.com/uploads/evenement_affiche/affiche_1203451.png",
      category: { id: 3, name: "Soirée" },
      period: { start: "2026-10-30 21:00:00", end: "2026-10-31 05:00:00" },
      price: { min: 15, max: 22.5 },
      venue: { name: "Domaine du Mont Vert", address: "Chemin du Mont Vert", zip_code: "97410", city: "St Pierre", state: "", country: { code: "RE", name: "La Réunion" }, coordinates: { long: "0.0000000", lat: "0.0000000" } },
      extras: { minisite_url: "https://my.weezevent.com/desinvolt-301026-20-years-rekids" },
    },
    {
      id: 88,
      title: "Concert à Lyon",
      category: { id: 1, name: "Concert" },
      period: { start: "2026-11-02 20:00:00", end: "2026-11-02 23:00:00" },
      price: { min: 30, max: 30 },
      venue: { name: "Salle", address: "Rue", zip_code: "69001", city: "Lyon", country: { code: "FR", name: "France" } },
      extras: { minisite_url: "https://my.weezevent.com/lyon" },
    },
    {
      id: 89,
      title: "Sans billetterie",
      period: { start: "2026-11-03 20:00:00" },
      venue: { zip_code: "97400", city: "Saint-Denis" },
      extras: {},
    },
  ],
};

const NOW = new Date("2026-10-26T14:00:00Z");
const direct: AgendaStore = { get: async (_k, _s, load) => ({ value: await load(), fetchedAt: NOW, stale: false }) };
const COMPTE = { username: "compte", password: "mot de passe", apiKey: "cle-api" };

describe("Weezevent's agenda (providers/agenda.ts, WEEZEVENT)", () => {
  it("keeps the events of La Réunion, linked to their ticketing page with ref=rundata, said shared by an organiser", () => {
    const { evenements, ailleurs } = parseWeezevent(SEARCH);
    expect(ailleurs).toBe(1);
    expect(evenements).toEqual([
      {
        id: "weezevent:1203451",
        titre: "DESINVOLT 30/10/26 - 20 YEARS REKIDS",
        seances: [{ debut: "2026-10-30T21:00", fin: "2026-10-31T05:00" }],
        lieu: "Domaine du Mont Vert, Chemin du Mont Vert",
        commune: "Saint-Pierre",
        prix: "de 15\u00a0€ à 22,50\u00a0€",
        categories: ["Soirée"],
        description: expect.stringMatching(/^Une nuit de musique électronique au Mont Vert\./),
        lien: "https://my.weezevent.com/desinvolt-301026-20-years-rekids?ref=rundata",
        billetterie: "https://my.weezevent.com/desinvolt-301026-20-years-rekids?ref=rundata",
        billetterie_texte: "Billets et infos sur Weezevent",
        publie_par: "un organisateur, via Weezevent",
      },
    ]);
    // Coordinates of 0 are not a place; no buyer's data, no organiser's person, no picture kept.
    expect(JSON.stringify(evenements)).not.toMatch(/lon|lat|affiche|desinvolt\.example/);
  });

  it("writes its words and its prices as given, never « gratuit » from a 0", () => {
    expect(WZ_PUBLIE_PAR).toBe("un organisateur, via Weezevent");
    expect(WZ_BILLETTERIE).toBe("Billets et infos sur Weezevent");
    expect(avecRef("https://my.weezevent.com/a?lang=fr")).toBe("https://my.weezevent.com/a?lang=fr&ref=rundata");
    const one = (price: object) => parseWeezevent({ events: [{ ...SEARCH.events[0], price }] as never }).evenements[0].prix;
    expect(one({ min: 12, max: 12 })).toBe("12\u00a0€");
    expect(one({ min: 0, max: 0 })).toBeUndefined();
    expect(one({ min: null, max: null })).toBeUndefined();
    expect(one({ min: "0", max: "10" })).toBe("de 0\u00a0€ à 10\u00a0€");
    // With an offset, converted to La Réunion's time.
    const at = parseWeezevent({ events: [{ ...SEARCH.events[0], period: { start: "2026-10-30T17:00:00+00:00" } }] as never }).evenements[0];
    expect(at.seances).toEqual([{ debut: "2026-10-30T21:00" }]);
  });

  it("names Weezevent and its link on the site and in the answers", () => {
    const [e] = parseWeezevent(SEARCH).evenements;
    const row = eventRow(e, e.seances);
    expect(row.publie_par).toBe("un organisateur, via Weezevent");
    expect(row.billetterie).toBe(row.lien);
    expect(row.billetterie_texte).toBe("Billets et infos sur Weezevent");
    // On the site, with its capital (marketing, 26/10); the others as they write themselves.
    expect(parQui(row.publie_par)).toBe("Un organisateur, via Weezevent");
    expect(parQui("reunion.fr")).toBe("reunion.fr");
  });

  it("is a source of its own, not under an open licence, read by the scheduled event", () => {
    expect(AGENDAS).toContain(WEEZEVENT);
    expect(WEEZEVENT.planifie).toBe(true);
    expect(WEEZEVENT.source.licence).toBe("Pas sous licence ouverte\u00a0: événements publics que chaque organisateur choisit de diffuser dans l'agenda de Weezevent, repris avec l'accord écrit de Weezevent. Ils ne font pas partie de nos données ouvertes.");
    expect(WEEZEVENT.source.attribution).toBe("un organisateur, via Weezevent");
    expect(FAMILLES[FICHES.weezevent.famille].ouverte).toBe(false);
  });

  describe("its reading", () => {
    let calls: { url: string; init?: RequestInit }[];
    let search: () => Response;
    let seen: string[];
    beforeEach(() => {
      calls = [];
      seen = [];
      search = () => Response.json(SEARCH);
      whenRead((url) => seen.push(url));
      whenFailed((_s, url) => seen.push(`échec ${url}`));
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/auth/access_token")) return Response.json({ accessToken: "f4b6b917cee00f13d57e3c84f56656b9" });
        return search();
      });
    });
    afterEach(() => {
      configureWeezevent({});
      whenRead(undefined);
      whenFailed(undefined);
      vi.unstubAllGlobals();
    });

    it("reads nothing without rundata.re's account, and is neither read nor said unread by the scheduled event", async () => {
      configureWeezevent({});
      expect((await WEEZEVENT.load(direct, NOW)).value).toEqual([]);
      expect(calls).toEqual([]);
      expect(planifies()).not.toContain(WEEZEVENT);
      configureWeezevent(COMPTE);
      expect(planifies()).toContain(WEEZEVENT);
    });

    it("asks the token once, then searches La Réunion from today; the key never reaches the hooks", async () => {
      configureWeezevent(COMPTE);
      expect((await WEEZEVENT.load(direct, NOW)).value.map((e) => e.id)).toEqual(["weezevent:1203451"]);
      expect(calls[0].url).toBe("https://api.weezevent.com/auth/access_token");
      expect(String(calls[0].init?.body)).toBe("username=compte&password=mot+de+passe&api_key=cle-api");
      const q = new URL(calls[1].url).searchParams;
      expect(Object.fromEntries(q)).toEqual({ country: "RE", date_start: "2026-10-26", max_result: "500", api_key: "cle-api", access_token: "f4b6b917cee00f13d57e3c84f56656b9" });
      // Kept: the next reading asks no token.
      await WEEZEVENT.load(direct, NOW);
      expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/auth/access_token", "/event/search/", "/event/search/"]);
      // A failure as well as a read: the address without the key nor the token.
      search = () => new Response("", { status: 503 });
      await expect(WEEZEVENT.load(direct, NOW)).rejects.toThrow(/HTTP 503/);
      expect(seen.length).toBe(5);
      expect(seen.join(" ")).not.toMatch(/cle-api|f4b6b917|mot/);
      expect(seen.at(-1)).toBe("échec https://api.weezevent.com/event/search/?country=RE&date_start=2026-10-26&max_result=500");
    });

    it("asks the token again after the API refused it", async () => {
      configureWeezevent(COMPTE);
      search = () => new Response("", { status: 401 });
      await expect(WEEZEVENT.load(direct, NOW)).rejects.toThrow(/HTTP 401/);
      search = () => Response.json(SEARCH);
      await WEEZEVENT.load(direct, NOW);
      expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/auth/access_token", "/event/search/", "/auth/access_token", "/event/search/"]);
    });
  });
});
