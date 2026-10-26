import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as chiffre from "../src/connecteurs/chiffre.js";
import { CHEMINS, DETAILS_MAX, evenement, HELLOASSO, heureLocale, lireLe, prix } from "../src/connecteurs/helloasso.js";
import { AccesRefuse, CheminInterdit, garde, reunionnais, type EvenementPublic } from "../src/connecteurs/plateforme.js";

// Thursday 29 October 2026, 10:00 at La Réunion.
const NOW = new Date("2026-10-29T06:00:00Z");
const KEY = Buffer.alloc(32, 7).toString("base64");

describe("the encryption of the kept secrets", () => {
  afterEach(() => chiffre.configure(undefined));

  it("gives back what it encrypted, for the same row only", async () => {
    chiffre.configure(KEY);
    expect(chiffre.enabled()).toBe(true);
    const ad = chiffre.lien("helloasso", "club-de-petanque", "abc");
    const value = await chiffre.chiffrer("le-jeton-de-rafraichissement", ad);
    expect(value).toMatch(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    expect(value).not.toContain("jeton");
    expect(await chiffre.dechiffrer(value, ad)).toBe("le-jeton-de-rafraichissement");
    // Copied into another row, it does not open.
    await expect(chiffre.dechiffrer(value, chiffre.lien("helloasso", "autre-club", "abc"))).rejects.toThrow();
    // Two encryptions of the same value differ (a fresh IV each time).
    expect(await chiffre.chiffrer("le-jeton-de-rafraichissement", ad)).not.toBe(value);
  });

  it("stays closed without a key, or with one that is not 32 bytes, and never encrypts nothing instead", async () => {
    expect(chiffre.enabled()).toBe(false);
    await expect(chiffre.chiffrer("x", chiffre.lien("helloasso", "a", "b"))).rejects.toThrow(/pas de clé/);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    chiffre.configure(Buffer.alloc(16, 1).toString("base64"));
    expect(chiffre.enabled()).toBe(false);
    // The log names the secret, never its value.
    expect(errors.mock.calls.flat().join(" ")).not.toContain(Buffer.alloc(16, 1).toString("base64"));
    errors.mockRestore();
  });

  it("does not open a value of another key", async () => {
    chiffre.configure(KEY);
    const ad = chiffre.lien("helloasso", "club", "abc");
    const value = await chiffre.chiffrer("secret", ad);
    chiffre.configure(Buffer.alloc(32, 9).toString("base64"));
    await expect(chiffre.dechiffrer(value, ad)).rejects.toThrow();
  });
});

describe("the closed list of a platform's calls", () => {
  const ok = [
    "/v5/users/me/organizations",
    "/v5/organizations/club-de-petanque/forms?formTypes=Event&states=Public&pageSize=50",
    "/v5/organizations/club-de-petanque/forms?formTypes=Event&states=Public&pageSize=50&continuationToken=abc%3D",
    "/v5/organizations/club-de-petanque/forms/Event/tournoi-de-noel/public",
  ];
  const refused = [
    "/v5/organizations/club-de-petanque/orders",
    "/v5/organizations/club-de-petanque/payments",
    "/v5/organizations/club-de-petanque/items",
    "/v5/organizations/club-de-petanque/forms/Event/tournoi-de-noel/orders",
    "/v5/organizations/club-de-petanque/forms/Event/tournoi-de-noel/items",
    "/v5/organizations/club-de-petanque/forms/Event/tournoi-de-noel",
    "/v5/organizations/club-de-petanque/forms/Membership/adhesion/public",
    "/v5/organizations/club-de-petanque/forms?formTypes=Event&states=Private&pageSize=50",
    "/v5/organizations/club-de-petanque/forms?formTypes=Event&states=Public&pageSize=50&withCount=true",
    "/v5/payments/12",
    "/v5/users/me/organizations/../payments",
  ];

  it("lets through HelloAsso's three calls for the linked association only", () => {
    for (const c of ok) expect(garde("helloasso", CHEMINS, c, "club-de-petanque")).toBe(c);
    expect(() => garde("helloasso", CHEMINS, ok[1], "autre-club")).toThrow(CheminInterdit);
  });

  it("refuses the orders, payments, items and anything else", () => {
    for (const c of refused) expect(() => garde("helloasso", CHEMINS, c, "club-de-petanque"), c).toThrow(CheminInterdit);
  });

  it("never writes a path to the orders, payments, items or refunds in the connectors' code", () => {
    const dir = new URL("../src/connecteurs/", import.meta.url);
    for (const f of readdirSync(dir)) {
      const source = readFileSync(new URL(f, dir), "utf8");
      for (const m of source.matchAll(/\/v5\/[^\s"'`]*/g)) expect(m[0], `${f} : ${m[0]}`).not.toMatch(/orders|payments|items|refund|members/i);
    }
  });

  it("knows La Réunion's postcodes", () => {
    expect(reunionnais("97410")).toBe(true);
    expect(reunionnais(" 97400 ")).toBe(true);
    expect(reunionnais("97600")).toBe(false);
    expect(reunionnais("75011")).toBe(false);
    expect(reunionnais(undefined)).toBe(false);
  });
});

describe("HelloAsso", () => {
  const ACCESS = "eyJhbGciOiJIUzI1NiJ9.acces.signature";
  const REFRESH = "rafraichissement-nouveau";
  let calls: { url: string; method: string; body?: string; auth?: string }[];
  let answers: Record<string, () => Response>;
  let logged: string[];

  const json = (v: unknown, status = 200) => () => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

  beforeEach(() => {
    calls = [];
    logged = [];
    answers = {
      "POST /oauth2/token": json({ access_token: ACCESS, refresh_token: REFRESH, token_type: "bearer", expires_in: 1799 }),
    };
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      calls.push({ url: u.pathname + u.search, method, body: init?.body ? String(init.body) : undefined, auth: headers.get("Authorization") ?? undefined });
      expect(u.hostname).toBe("api.helloasso.com");
      const answer = answers[`${method} ${u.pathname}`];
      return answer ? answer() : new Response("not found", { status: 404 });
    });
    for (const level of ["log", "warn", "error", "info"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // Never a token nor a key in what is logged.
    for (const line of logged) for (const s of [ACCESS, REFRESH, "le-secret-client", "ancien-jeton"]) expect(line).not.toContain(s);
  });

  /** Every call made was one of the closed list. */
  const allowed = () => {
    for (const c of calls) if (c.url !== "/oauth2/token") expect(CHEMINS.some((re) => re.test(c.url)), c.url).toBe(true);
  };

  describe("verifying the pasted keys", () => {
    it("finds the one association they administer, and keeps the refresh token, never the keys", async () => {
      answers["GET /v5/users/me/organizations"] = json([
        { organizationSlug: "club-de-petanque", name: "Club de pétanque du Tampon ", city: "Le Tampon", zipCode: "97430", url: "https://www.helloasso.com/associations/club-de-petanque", role: "OrganizationAdmin" },
      ]);
      const v = await HELLOASSO.verifier({ client_id: " id-client ", client_secret: "le-secret-client" });
      expect(v).toEqual({
        organisation: { id: "club-de-petanque", nom: "Club de pétanque du Tampon", commune: "Le Tampon", code_postal: "97430", lien: "https://www.helloasso.com/associations/club-de-petanque" },
        secret: REFRESH,
      });
      expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /oauth2/token", "GET /v5/users/me/organizations"]);
      expect(new URLSearchParams(calls[0].body)).toEqual(new URLSearchParams({ grant_type: "client_credentials", client_id: "id-client", client_secret: "le-secret-client" }));
      expect(calls[1].auth).toBe(`Bearer ${ACCESS}`);
      expect(JSON.stringify(v)).not.toContain("le-secret-client");
      allowed();
    });

    it("says refused when HelloAsso refuses the keys, when they are missing, or when they administer no single association", async () => {
      answers["POST /oauth2/token"] = json({ error: "invalid_client" }, 400);
      await expect(HELLOASSO.verifier({ client_id: "a", client_secret: "le-secret-client" })).rejects.toBeInstanceOf(AccesRefuse);
      await expect(HELLOASSO.verifier({ client_id: "a", client_secret: " " })).rejects.toBeInstanceOf(AccesRefuse);
      answers["POST /oauth2/token"] = json({ access_token: ACCESS, refresh_token: REFRESH });
      answers["GET /v5/users/me/organizations"] = json([]);
      await expect(HELLOASSO.verifier({ client_id: "a", client_secret: "le-secret-client" })).rejects.toBeInstanceOf(AccesRefuse);
      answers["GET /v5/users/me/organizations"] = json([{ organizationSlug: "a", name: "A" }, { organizationSlug: "b", name: "B" }]);
      await expect(HELLOASSO.verifier({ client_id: "a", client_secret: "le-secret-client" })).rejects.toBeInstanceOf(AccesRefuse);
    });

    it("tells HelloAsso's silence apart from a refusal", async () => {
      answers["POST /oauth2/token"] = json({}, 503);
      const err = await HELLOASSO.verifier({ client_id: "a", client_secret: "le-secret-client" }).catch((e) => e);
      expect(err).not.toBeInstanceOf(AccesRefuse);
      expect(String(err)).toContain("HTTP 503");
    });
  });

  describe("opening a reading", () => {
    it("trades the kept refresh token for an access token and the next refresh token", async () => {
      expect(await HELLOASSO.acceder("ancien-jeton")).toEqual({ jeton: ACCESS, secret: REFRESH });
      expect(new URLSearchParams(calls[0].body)).toEqual(new URLSearchParams({ grant_type: "refresh_token", refresh_token: "ancien-jeton" }));
    });

    it("reads a refused refresh token (the keys changed on HelloAsso) as a withdrawal", async () => {
      answers["POST /oauth2/token"] = json({ error: "invalid_grant" }, 400);
      const err = await HELLOASSO.acceder("ancien-jeton").catch((e) => e);
      expect(err).toBeInstanceOf(AccesRefuse);
      expect(err.message).not.toContain("ancien-jeton");
    });
  });

  describe("reading the public events", () => {
    const form = (slug: string, extra: Record<string, unknown> = {}) => ({
      formSlug: slug,
      formType: "Event",
      state: "Public",
      title: `Événement ${slug}`,
      startDate: "2026-11-14T18:00:00+04:00",
      endDate: "2026-11-14T23:00:00+04:00",
      url: `https://www.helloasso.com/associations/club-de-petanque/evenements/${slug}`,
      meta: { createdAt: "2026-10-01T10:00:00+02:00", updatedAt: "2026-10-20T10:00:00+02:00" },
      ...extra,
    });
    const details = (place: Record<string, string> | undefined, tiers: unknown[]) => json({ place, tiers, organizationName: "Club", description: "Tournoi ouvert à tous. Inscription sur place, buvette." });

    it("takes the public events to come, with their place and price, and nothing of the rest", async () => {
      answers["GET /v5/organizations/club-de-petanque/forms"] = json({
        data: [
          form("tournoi-de-noel"),
          form("soiree-privee", { state: "Private" }),
          form("adhesion-2026", { formType: "Membership" }),
          form("tournoi-passe", { startDate: "2026-10-01T09:00:00+04:00", endDate: "2026-10-01T18:00:00+04:00" }),
          form("dans-deux-ans", { startDate: "2028-11-14T18:00:00+04:00", endDate: "2028-11-14T23:00:00+04:00" }),
          form("Slug_Bizarre"),
          form("a-paris"),
        ],
        pagination: { totalCount: 7 },
      });
      answers["GET /v5/organizations/club-de-petanque/forms/Event/tournoi-de-noel/public"] = details(
        { name: "Boulodrome de la Pointe", address: "rue du Stade", city: "Le Tampon", zipCode: "97430" },
        [{ price: 500, tierType: "Registration" }, { price: 1500, tierType: "Registration" }, { price: 2000, tierType: "Donation" }],
      );
      answers["GET /v5/organizations/club-de-petanque/forms/Event/a-paris/public"] = details({ name: "Salle", city: "Paris", zipCode: "75011" }, []);
      const out = await lireLe(ACCESS, "club-de-petanque", new Map(), NOW);
      expect(out).toEqual([
        {
          id: "tournoi-de-noel",
          maj: "2026-10-20T10:00:00+02:00",
          titre: "Événement tournoi-de-noel",
          debut: "2026-11-14T18:00",
          fin: "2026-11-14T23:00",
          lieu: "Boulodrome de la Pointe",
          adresse: "rue du Stade",
          commune: "Le Tampon",
          code_postal: "97430",
          prix: "de 5 à 15 €",
          description: "Tournoi ouvert à tous.",
          lien: "https://www.helloasso.com/associations/club-de-petanque/evenements/tournoi-de-noel",
        },
      ]);
      expect(calls.map((c) => c.url)).toEqual([
        "/v5/organizations/club-de-petanque/forms?formTypes=Event&states=Public&pageSize=50",
        "/v5/organizations/club-de-petanque/forms/Event/tournoi-de-noel/public",
        "/v5/organizations/club-de-petanque/forms/Event/a-paris/public",
      ]);
      expect(calls.every((c) => c.auth === `Bearer ${ACCESS}`)).toBe(true);
      allowed();
    });

    it("reads an event in detail again only when HelloAsso says it changed, at most DETAILS_MAX a time", async () => {
      const slugs = Array.from({ length: DETAILS_MAX + 3 }, (_, i) => `evenement-${i}`);
      answers["GET /v5/organizations/club-de-petanque/forms"] = json({ data: slugs.map((s) => form(s)) });
      for (const s of slugs) answers[`GET /v5/organizations/club-de-petanque/forms/Event/${s}/public`] = details({ name: "Salle", city: "Saint-Pierre", zipCode: "97410" }, []);
      const known: EvenementPublic = { id: "evenement-0", maj: "2026-10-20T10:00:00+02:00", titre: "Gardé", debut: "2026-11-14T18:00", lien: "https://x" };
      const old: EvenementPublic = { ...known, id: "evenement-1", maj: "2026-10-02T10:00:00+02:00" };
      const out = await lireLe(ACCESS, "club-de-petanque", new Map([[known.id, known], [old.id, old]]), NOW);
      const detailed = calls.filter((c) => c.url.endsWith("/public")).map((c) => c.url.split("/")[6]);
      expect(detailed).toHaveLength(DETAILS_MAX);
      expect(detailed).not.toContain("evenement-0");
      expect(detailed[0]).toBe("evenement-1");
      expect(out.find((e) => e.id === "evenement-0")).toBe(known);
      expect(out).toHaveLength(1 + DETAILS_MAX);
    });

    it("follows the pages, and stops at a refused call before fetching it", async () => {
      let page = 0;
      answers["GET /v5/organizations/club-de-petanque/forms"] = () => {
        page++;
        return json({ data: Array.from({ length: page === 1 ? 50 : 1 }, (_, i) => form(`p${page}-${i}`, { state: "Draft" })), pagination: { continuationToken: `jeton${page}` } })();
      };
      expect(await lireLe(ACCESS, "club-de-petanque", new Map(), NOW)).toEqual([]);
      expect(calls.map((c) => c.url)).toEqual([
        "/v5/organizations/club-de-petanque/forms?formTypes=Event&states=Public&pageSize=50",
        "/v5/organizations/club-de-petanque/forms?formTypes=Event&states=Public&pageSize=50&continuationToken=jeton1",
      ]);
      calls = [];
      await expect(lireLe(ACCESS, "Club De Petanque", new Map(), NOW)).rejects.toBeInstanceOf(CheminInterdit);
      expect(calls).toEqual([]);
    });
  });

  it("says prices and times as the site does", () => {
    expect(prix([{ price: 0, tierType: "Registration" }])).toBe("Gratuit");
    expect(prix([{ price: 1000, tierType: "Registration" }])).toBe("10 €");
    expect(prix([{ price: 750, tierType: "Payment" }])).toBe("7,50 €");
    expect(prix([{ price: 0 }, { price: 1200 }])).toBe("de 0 à 12 €");
    expect(prix([{ price: 500, tierType: "Donation" }])).toBeUndefined();
    expect(prix(undefined)).toBeUndefined();
    expect(heureLocale("2026-11-14T14:00:00Z")).toBe("2026-11-14T18:00");
    expect(heureLocale("2026-11-14T16:00:00+02:00")).toBe("2026-11-14T18:00");
    expect(heureLocale("2026-11-14T18:00:00")).toBe("2026-11-14T18:00");
    expect(heureLocale("demain")).toBeUndefined();
    // A description written in HTML gives none, never one cut out of its tags.
    const base = { formSlug: "a", title: "A", startDate: "2026-11-14T18:00:00+04:00", url: "https://x" };
    expect(evenement({ ...base, description: "<p>Venez nombreux.</p>" })?.description).toBeUndefined();
    expect(evenement({ ...base, description: "Venez   nombreux. Buvette." })?.description).toBe("Venez nombreux.");
  });
});

describe("the connectors' tables (scripts/connecteurs.sql)", () => {
  let db: DatabaseSync;
  const T = Math.floor(NOW.getTime() / 1000);
  const add = (etat: string, t = T, organisation = "club", jeton = `j${Math.random()}`) =>
    db.prepare("INSERT INTO connexions (t, plateforme, organisation, nom, lien, secret, email, jeton, etat) VALUES (?, 'helloasso', ?, 'Club', 'https://x', 'v1.a.b', 'club@example.org', ?, ?)").run(t, organisation, jeton, etat).lastInsertRowid as number;
  const event = (connexion: number, id = "e") => db.prepare("INSERT INTO evenements_connectes (connexion, id, maj, titre, debut, lien) VALUES (?, ?, 'm', 'T', '2026-11-14T18:00', 'https://x')").run(connexion, id);
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    const sql = readFileSync(new URL("../scripts/connecteurs.sql", import.meta.url), "utf8");
    db.exec(sql);
    // Safe to run again.
    db.exec(sql);
  });

  it("deletes a withdrawn link's events with it", () => {
    const a = add("actif");
    const b = add("actif", T, "autre");
    event(a, "e1");
    event(a, "e2");
    event(b);
    db.prepare("DELETE FROM connexions WHERE id = ?").run(a);
    expect(count("SELECT COUNT(*) n FROM evenements_connectes")).toBe(1);
  });

  it("keeps neither secret, address nor events of a refused or expired link", () => {
    const a = add("actif");
    event(a);
    db.prepare("UPDATE connexions SET etat = 'expire' WHERE id = ?").run(a);
    expect(db.prepare("SELECT secret, email, nom FROM connexions WHERE id = ?").get(a)).toEqual({ secret: null, email: null, nom: "Club" });
    expect(count("SELECT COUNT(*) n FROM evenements_connectes")).toBe(0);
  });

  it("holds one confirmed link per association and platform, a new one waiting beside it", () => {
    add("actif");
    add("a_confirmer");
    expect(() => add("a_moderer")).toThrow(/UNIQUE/);
    expect(() => add("actif", T, "club", "same")).toThrow(/UNIQUE/);
  });

  it("forgets the unconfirmed links after 48 hours and the fingerprints after a day", () => {
    const old = add("a_confirmer", T - 49 * 3600);
    db.prepare("UPDATE connexions SET source = 'empreinte' WHERE id = ?").run(old);
    const recent = add("a_confirmer", T - 47 * 3600);
    db.prepare("UPDATE connexions SET source = 'empreinte' WHERE id = ?").run(recent);
    const day = add("actif", T - 25 * 3600, "autre");
    db.prepare("UPDATE connexions SET source = 'empreinte' WHERE id = ?").run(day);
    add("actif", T, "troisieme");
    // The 47-hour-old link stays, its fingerprint gone with the day-old one's.
    expect(db.prepare("SELECT id, source FROM connexions WHERE etat = 'a_confirmer'").all()).toEqual([{ id: recent, source: null }]);
    expect(db.prepare("SELECT source FROM connexions WHERE id = ?").get(day)).toEqual({ source: null });
    const fresh = add("actif", T + 3600, "quatrieme");
    db.prepare("UPDATE connexions SET source = 'empreinte' WHERE id = ?").run(fresh);
    add("actif", T + 2 * 3600, "cinquieme");
    expect(db.prepare("SELECT source FROM connexions WHERE id = ?").get(fresh)).toEqual({ source: "empreinte" });
  });
});
