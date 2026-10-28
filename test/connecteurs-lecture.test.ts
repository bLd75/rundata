import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import * as chiffre from "../src/connecteurs/chiffre.js";
import * as connexions from "../src/connecteurs/connexions.js";
import { lireUne } from "../src/connecteurs/lecture.js";
import * as propositions from "../src/propositions.js";
import { empreinteJeton } from "../src/propositions.js";
import { CONNECTEURS, evenements } from "../src/providers/agenda-connecteurs.js";
import { AGENDAS } from "../src/providers/agenda.js";
import { toutesLesSources } from "../src/server.js";
import { eventRow } from "../src/tools/agenda.js";
import * as connecteurs from "../src/web/connecteurs.js";
import { ICS_PATH, JSON_PATH } from "../src/web/flux-associations.js";
import * as formulaires from "../src/web/propositions.js";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ACCESS = "eyJhbGciOiJIUzI1NiJ9.acces.signature";
const FIRST = "rafraichissement-premier";
const H = 3600_000;
// Thursday 29 October 2026, 10:00 at La Réunion: the events below are to come, whatever the day the tests run.
const NOW = new Date("2026-10-29T06:00:00Z");
const ORG = "club-de-petanque";
const PAGE = `https://www.helloasso.com/associations/${ORG}/evenements/`;

let db: DatabaseSync;
let sent: { to: string; subject: string; text: string }[];
let logged: string[];
let forms: unknown[];
let token: { status: number; body: unknown };
let turned: number;
let refreshUsed: string[];

const rows = <T = Record<string, unknown>>(sql: string) => db.prepare(sql).all() as T[];
const form = (slug: string, extra: Record<string, unknown> = {}) => ({
  formSlug: slug,
  formType: "Event",
  state: "Public",
  title: `Tournoi ${slug}`,
  startDate: "2026-11-14T18:00:00+04:00",
  endDate: "2026-11-14T23:00:00+04:00",
  url: `${PAGE}${slug}`,
  meta: { createdAt: "2026-10-01T10:00:00+02:00", updatedAt: "2026-10-20T10:00:00+02:00" },
  ...extra,
});

/** One active link, its refresh token encrypted for its row, moderated `jours` days before NOW. */
async function relie(jours = 1): Promise<number> {
  const jeton = await empreinteJeton("le-secret-du-lien-envoye");
  const secret = await chiffre.chiffrer(FIRST, chiffre.lien("helloasso", ORG, jeton));
  const t = Math.floor(NOW.getTime() / 1000) - jours * 86400;
  return Number(db.prepare(`INSERT INTO connexions (t, plateforme, organisation, nom, commune, code_postal, lien, secret, email, jeton, etat, confirme_le, modere_le)
    VALUES (?, 'helloasso', ?, 'Club de pétanque du Tampon', 'Le Tampon', '97430', 'https://www.helloasso.com/associations/club-de-petanque', ?, 'club@example.org', ?, 'actif', ?, ?)`)
    .run(t, ORG, secret, jeton, t, t).lastInsertRowid);
}
const secretGarde = async () => {
  const [r] = rows<{ secret: string; jeton: string }>("SELECT secret, jeton FROM connexions");
  return chiffre.dechiffrer(r.secret, chiffre.lien("helloasso", ORG, r.jeton));
};

beforeEach(() => {
  sent = [];
  logged = [];
  turned = 0;
  refreshUsed = [];
  forms = [form("noel"), form("paques", { title: "Tournoi de Pâques", startDate: "2026-12-05T09:00:00+04:00", endDate: "2026-12-05T17:00:00+04:00" })];
  token = { status: 200, body: undefined };
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../scripts/connecteurs.sql", import.meta.url), "utf8"));
  chiffre.configure(KEY);
  connecteurs.ouvrir(true);
  connexions.configure(
    async (sql, ...params) => Number(db.prepare(sql).run(...(params as (string | number | null)[])).changes),
    async <T>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as (string | number | null)[])) as T[],
    async (m) => (sent.push(m), true),
  );
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    expect(u.hostname).toBe("api.helloasso.com");
    if (u.pathname === "/oauth2/token") {
      refreshUsed.push(new URLSearchParams(String(init?.body)).get("refresh_token") ?? "");
      if (token.body !== undefined) return new Response(JSON.stringify(token.body), { status: token.status });
      return new Response(JSON.stringify({ access_token: ACCESS, refresh_token: `rafraichissement-${++turned}`, expires_in: 1799 }));
    }
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${ACCESS}`);
    if (u.pathname === `/v5/organizations/${ORG}/forms`) return new Response(JSON.stringify({ data: forms }));
    const slug = /\/forms\/Event\/([^/]+)\/public$/.exec(u.pathname)?.[1];
    if (slug) return new Response(JSON.stringify({ place: { name: "Boulodrome", city: slug === "paques" ? "St Pierre" : "Le Tampon", zipCode: "97430" }, tiers: [{ price: 500, tierType: "Registration" }], description: "Ouvert à tous. Buvette." }));
    return new Response("", { status: 404 });
  });
  for (const level of ["log", "warn", "error", "info"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  chiffre.configure(undefined);
  connexions.configure(undefined);
  connecteurs.ouvrir(connecteurs.CONNECTEURS_EN_LIGNE);
  // Never a token, a kept secret nor an address in what is logged.
  for (const line of logged) for (const s of [ACCESS, FIRST, "rafraichissement-1", "club@example.org"]) expect(line).not.toContain(s);
});

describe("the scheduled reading of a linked association", () => {
  it("reads the one due, keeps the turned secret, and writes its events", async () => {
    const id = await relie();
    const r = await lireUne(NOW);
    expect(r).toEqual({ connexion: id, issue: "lu", evenements: 2, ecrits: 2, effaces: 0 });
    expect(refreshUsed).toEqual([FIRST]);
    expect(await secretGarde()).toBe("rafraichissement-1");
    expect(rows("SELECT id, titre, debut, commune, prix FROM evenements_connectes ORDER BY debut")).toEqual([
      { id: "noel", titre: "Tournoi noel", debut: "2026-11-14T18:00", commune: "Le Tampon", prix: "5 €" },
      { id: "paques", titre: "Tournoi de Pâques", debut: "2026-12-05T09:00", commune: "St Pierre", prix: "5 €" },
    ]);
    expect(rows("SELECT lu_le, reussi_le, echecs FROM connexions")).toEqual([{ lu_le: NOW.getTime() / 1000, reussi_le: NOW.getTime() / 1000, echecs: 0 }]);
    // Read again only after 6 hours.
    expect(await lireUne(new Date(NOW.getTime() + 5 * H))).toBeUndefined();
    expect(refreshUsed).toHaveLength(1);
  });

  it("writes only what changed, deletes what is gone, and reads the details of the changed ones only", async () => {
    await relie();
    await lireUne(NOW);
    forms = [form("noel", { title: "Grand tournoi de Noël", meta: { updatedAt: "2026-10-28T10:00:00+02:00" } })];
    const r = await lireUne(new Date(NOW.getTime() + 6 * H));
    expect(r).toMatchObject({ issue: "lu", evenements: 1, ecrits: 1, effaces: 1 });
    expect(refreshUsed).toEqual([FIRST, "rafraichissement-1"]);
    expect(rows("SELECT id, titre FROM evenements_connectes")).toEqual([{ id: "noel", titre: "Grand tournoi de Noël" }]);
    // Nothing changed: nothing written.
    expect(await lireUne(new Date(NOW.getTime() + 12 * H))).toMatchObject({ issue: "lu", evenements: 1, ecrits: 0, effaces: 0 });
  });

  it("keeps the last events when the platform does not answer, and says since when", async () => {
    await relie();
    await lireUne(NOW);
    token = { status: 503, body: {} };
    const later = new Date(NOW.getTime() + 6 * H);
    expect(await lireUne(later)).toMatchObject({ issue: "echec" });
    expect(rows("SELECT echecs FROM connexions")).toEqual([{ echecs: 1 }]);
    expect(rows("SELECT COUNT(*) AS n FROM evenements_connectes")).toEqual([{ n: 2 }]);
    expect(await secretGarde()).toBe("rafraichissement-1");
    const [e] = await evenements(later);
    expect(e.via).toEqual({ plateforme: "HelloAsso", lu: "2026-10-29T10:00", sans_reponse: true });
    expect(eventRow(e, e.seances).source).toBe("l'association Club de pétanque du Tampon, via HelloAsso, lu sur HelloAsso le jeudi 29/10 à 10:00, pas de réponse depuis");
    expect(sent).toEqual([]);
  });

  it("withdraws the link when the platform refuses its secret, and tells its address", async () => {
    await relie();
    await lireUne(NOW);
    token = { status: 400, body: { error: "invalid_grant" } };
    const apres = vi.fn(async () => {});
    expect(await lireUne(new Date(NOW.getTime() + 6 * H), apres)).toMatchObject({ issue: "retire" });
    expect(rows("SELECT * FROM connexions")).toEqual([]);
    expect(rows("SELECT * FROM evenements_connectes")).toEqual([]);
    expect(apres).toHaveBeenCalledOnce();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "club@example.org", subject: "La connexion de Club de pétanque du Tampon à rundata.re est retirée" });
    expect(sent[0].text).toContain("HelloAsso a refusé l'accès de rundata.re au compte de Club de pétanque du Tampon");
  });

  it("reminds once after 25 days without a good reading, with a second link that withdraws, the first still working", async () => {
    await relie(26);
    token = { status: 503, body: {} };
    const r = await lireUne(NOW);
    expect(r).toMatchObject({ issue: "echec", rappel: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Club de pétanque du Tampon\u00a0: reliez à nouveau votre compte HelloAsso");
    expect(sent[0].text).toContain("Depuis le 03/10/2026, nous n'arrivons plus à lire les événements de Club de pétanque du Tampon sur HelloAsso. Sans lecture d'ici le 02/11/2026, la connexion expirera");
    const second = /https:\/\/rundata\.re\/associations\/connexion\/([\w-]+)\/retirer\n/.exec(sent[0].text)![1];
    expect(rows("SELECT jeton_retrait IS NOT NULL AS j FROM connexions")).toEqual([{ j: 1 }]);
    expect(JSON.stringify(rows("SELECT * FROM connexions"))).not.toContain(second);
    expect((await connexions.trouver(second))?.nom).toBe("Club de pétanque du Tampon");
    expect((await connexions.trouver("le-secret-du-lien-envoye"))?.nom).toBe("Club de pétanque du Tampon");
    // Once only.
    await lireUne(new Date(NOW.getTime() + 6 * H));
    expect(sent).toHaveLength(1);
    expect(await connexions.retirer(second)).toEqual({ nom: "Club de pétanque du Tampon" });
    expect(rows("SELECT * FROM connexions")).toEqual([]);
  });

  it("expires after 30 days without a good reading: nothing kept, its address told", async () => {
    await relie(31);
    token = { status: 503, body: {} };
    expect(await lireUne(NOW)).toMatchObject({ issue: "expire" });
    expect(rows("SELECT etat, secret, email FROM connexions")).toEqual([{ etat: "expire", secret: null, email: null }]);
    expect(sent[0]).toMatchObject({ to: "club@example.org", subject: "La connexion de Club de pétanque du Tampon à rundata.re a expiré" });
    expect(sent[0].text).toContain("depuis le 28/09/2026. La connexion a expiré");
  });

  it("reads nothing without the key, nor a link not active", async () => {
    await relie();
    db.prepare("UPDATE connexions SET etat = 'a_moderer'").run();
    expect(await lireUne(NOW)).toBeUndefined();
    db.prepare("UPDATE connexions SET etat = 'actif'").run();
    chiffre.configure(undefined);
    expect(await lireUne(NOW)).toBeUndefined();
    expect(refreshUsed).toEqual([]);
  });

  it("does nothing before the flag: no reading, no purge, no agenda, no source listed", async () => {
    await relie();
    connecteurs.ouvrir(false);
    expect(await lireUne(NOW)).toBeUndefined();
    expect(await connexions.purger(new Date(NOW.getTime() + 60 * 86400_000))).toBe(0);
    let asked = false;
    const store = { get: async () => ((asked = true), { value: [], fetchedAt: NOW, stale: false }) };
    expect((await CONNECTEURS.load(store as never, NOW)).value).toEqual([]);
    expect(asked).toBe(false);
    expect(toutesLesSources().map((s) => s.id)).not.toContain("helloasso_associations");
    expect(toutesLesSources(true).map((s) => s.id)).toContain("helloasso_associations");
    expect(refreshUsed).toEqual([]);
    expect(rows("SELECT lu_le FROM connexions")).toEqual([{ lu_le: null }]);
  });
});

describe("the linked associations' agenda", () => {
  it("gives their events to come, by the commune's official name, « via HelloAsso » with the hour of the reading", async () => {
    await relie();
    await lireUne(NOW);
    const events = await evenements(NOW);
    expect(events.map((e) => [e.titre, e.commune, e.publie_par])).toEqual([
      ["Tournoi noel", "Le Tampon", "Club de pétanque du Tampon"],
      ["Tournoi de Pâques", "Saint-Pierre", "Club de pétanque du Tampon"],
    ]);
    const row = eventRow(events[0], events[0].seances);
    expect(row.source).toBe("l'association Club de pétanque du Tampon, via HelloAsso, lu le jeudi 29/10 à 10:00");
    expect(row.via).toEqual({ plateforme: "HelloAsso", lu: "lu le jeudi 29/10 à 10:00" });
    expect(row.lu_le).toBeUndefined();
    // Past: no longer given.
    expect(await evenements(new Date("2026-12-06T06:00:00Z"))).toEqual([]);
  });

  it("is one of the agendas, whole island, and gives nothing without the database", async () => {
    expect(AGENDAS).toContain(CONNECTEURS);
    expect(CONNECTEURS.couvre).toEqual([]);
    connexions.configure(undefined);
    expect(await evenements(NOW)).toEqual([]);
  });
});

describe("the open data", () => {
  afterEach(() => {
    propositions.configure(undefined);
    formulaires.ouvrir(formulaires.ASSOCIATIONS_EN_LIGNE);
  });

  it("never gives the events read on a platform in the agenda ICS and JSON: the platform has not allowed it", async () => {
    db.exec(readFileSync(new URL("../scripts/propositions.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../scripts/propositions-b.sql", import.meta.url), "utf8"));
    propositions.configure(
      async (sql, ...params) => Number(db.prepare(sql).run(...(params as (string | number | null)[])).changes),
      undefined,
      async <T>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as (string | number | null)[])) as T[],
    );
    formulaires.ouvrir(true);
    await relie();
    await lireUne(NOW);
    expect(rows("SELECT COUNT(*) AS n FROM evenements_connectes")).toEqual([{ n: 2 }]);
    for (const path of [JSON_PATH, ICS_PATH]) {
      const r = await handle(new Request(`https://rundata.re${path}`), new Cache());
      expect(r.status, path).toBe(200);
      const body = await r.text();
      expect(body, path).not.toContain("Tournoi");
      expect(body, path).not.toContain("HelloAsso");
    }
  });
});
