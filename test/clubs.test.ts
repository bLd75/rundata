import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as espace from "../src/clubs/espace.js";
import { adresseDeLaFiche, clubsDeLAccueil, type ClubMonClub } from "../src/clubs/monclub.js";
import * as drapeau from "../src/web/club-drapeau.js";
import { changements, ecrire, erreur, refDe, retirer } from "../scripts/club-verifie.js";
import { breakerMs, Cache, MemoryStore } from "../src/cache.js";
import { ACCUEIL, ADRESSE, CLUBS, fiche } from "./monclub.js";

// Thursday 29 October 2026, 10:00 at La Réunion.
const NOW = new Date("2026-10-29T06:00:00Z");
const later = (s: number) => new Date(NOW.getTime() + s * 1000);
// The connections that ask, from documentation ranges.
const IP = "203.0.113.7";
const IP2 = "2001:db8:aa:bb:1:2:3:4";

describe("MonClub", () => {
  it("lists the island's clubs of the map, with their commune, and not the league, a practice nor the clubs elsewhere", () => {
    expect(clubsDeLAccueil(ACCUEIL)).toEqual([
      { ref: "101", nom: "HANDBALL CLUB DU TAMPON", commune: "Le Tampon", fiche: `${CLUBS}handball-club-du-tampon/` },
      { ref: "102", nom: "ST PIERRE HAND & CO", commune: "Saint-Pierre", fiche: `${CLUBS}st-pierre-hand/` },
      // A CEDEX of the island: the town it names.
      { ref: "103", nom: "CLUB DE HAND DE STE MARIE", commune: "Sainte-Marie", fiche: `${CLUBS}club-de-hand-de-ste-marie/` },
    ]);
  });

  it("throws when the map is missing or cut, rather than reading « no club »", () => {
    expect(() => clubsDeLAccueil("<html><body>Maintenance</body></html>")).toThrow(/carte des clubs introuvable/);
    expect(() => clubsDeLAccueil(ACCUEIL.slice(0, ACCUEIL.indexOf("feature") + 400))).toThrow(/carte des clubs introuvable/);
  });

  it("reads the federation's address on the club's page, and no other", () => {
    expect(adresseDeLaFiche(fiche("101", ADRESSE), "101")).toBe(ADRESSE);
    expect(adresseDeLaFiche(fiche("101", ADRESSE.toUpperCase()), "101")).toBe(ADRESSE);
    // Another club's page, an address the club typed, none at all.
    expect(adresseDeLaFiche(fiche("101", ADRESSE), "102")).toBeUndefined();
    expect(adresseDeLaFiche(fiche("101", "club.tampon@gmail.com"), "101")).toBeUndefined();
    expect(adresseDeLaFiche(fiche("101", "5974001@ffhandball.net"), "101")).toBeUndefined();
    expect(adresseDeLaFiche(fiche("101", undefined), "101")).toBeUndefined();
    // A neighbour's post on the page does not count for this one, even when the club's own has no address.
    expect(adresseDeLaFiche(fiche("101", ADRESSE, { ref: "102", email: "5974002@reunion.ffhandball.net" }), "101")).toBe(ADRESSE);
    expect(adresseDeLaFiche(fiche("101", undefined, { ref: "102", email: "5974002@reunion.ffhandball.net" }), "101")).toBeUndefined();
    expect(adresseDeLaFiche(fiche("102", "5974002@reunion.ffhandball.net", { ref: "101", email: "club.tampon@gmail.com" }), "101")).toBeUndefined();
  });

  it("reads a page with a character reference past Unicode, as written", () => {
    expect(adresseDeLaFiche(`<p>&#x110000; &#99999999999;</p>${fiche("101", ADRESSE)}`, "101")).toBe(ADRESSE);
    expect(clubsDeLAccueil(`<p>&#x110000;</p>${ACCUEIL}`)).toHaveLength(3);
  });
});

describe("screen 1's search", () => {
  const clubs: espace.ClubVu[] = [
    { id: 1, nom: "HANDBALL CLUB DU TAMPON", commune: "Le Tampon", activite: "Handball" },
    { id: 2, nom: "ST PIERRE HAND & CO", commune: "Saint-Pierre", activite: "Handball" },
    { id: 3, nom: "Club de pétanque de l'Étang", commune: "L'Étang-Salé", activite: "Pétanque" },
  ];
  const ids = (q: string) => espace.chercher(clubs, q).map((c) => c.id);

  it("finds a club by the start of its words, its town or its activity, accents and « St » as typed", () => {
    expect(ids("hand")).toEqual([1, 2]);
    expect(ids("saint pierre")).toEqual([2]);
    expect(ids("st pie")).toEqual([2]);
    expect(ids("TAMPON")).toEqual([1]);
    expect(ids("petanque etang")).toEqual([3]);
    expect(ids("étang-salé")).toEqual([3]);
    expect(ids("volley")).toEqual([]);
  });

  it("proposes nothing under three letters", () => {
    expect(ids("ha")).toEqual([]);
    expect(ids(" h a ")).toEqual([]);
    expect(ids("han")).toEqual([1, 2]);
  });

  it("masks an address: its first character, five dots, its domain; at level 3 its domain too", () => {
    expect(espace.masquer(ADRESSE)).toBe("5•••••@reunion.ffhandball.net");
    expect(espace.masquer("c@gmail.com")).toBe("c•••••@gmail.com");
    expect(espace.masquer("club.petanque@mon-domaine.re", false)).toBe("c•••@m•••.re");
    expect(espace.masque({ source: "manuel" }, "contact@gmail.com")).toBe("c•••@g•••.com");
    expect(espace.masque({ source: "monclub" }, ADRESSE)).toBe("5•••••@reunion.ffhandball.net");
  });

  it("counts a connection by its address in IPv4, by its /64 in IPv6", () => {
    expect(espace.reseau(IP)).toBe(IP);
    expect(espace.reseau(IP2)).toBe("2001:db8:aa:bb::/64");
    expect(espace.reseau("2001:0db8:00aa:00bb:ffff::1")).toBe("2001:db8:aa:bb::/64");
    expect(espace.reseau("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(espace.reseau("::ffff:203.0.113.7")).toBe(IP);
  });
});

describe("the space's tables", () => {
  let db: DatabaseSync;
  let sent: { to: string; subject: string; text: string }[];
  let pages: Record<string, string>;
  let reads: string[];
  const rows = <T = Record<string, unknown>>(sql: string) => db.prepare(sql).all() as T[];
  const tout = () => JSON.stringify(["clubs", "acces", "envois"].map((t) => rows(`SELECT * FROM ${t}`)));
  const lire = async (): Promise<ClubMonClub[]> => clubsDeLAccueil(ACCUEIL);
  const lireTrop = async (): Promise<ClubMonClub[]> => [...clubsDeLAccueil(ACCUEIL), ...Array.from({ length: 8 }, (_, i) => ({ ref: `20${i}`, nom: `CLUB ${i}`, commune: "Saint-Paul", fiche: `${CLUBS}club-${i}/` }))];
  const secretDe = (m: { text: string }) => /\/acces\/([\w-]+)\n/.exec(m.text)![1];

  beforeEach(async () => {
    sent = [];
    reads = [];
    pages = { [`${CLUBS}handball-club-du-tampon/`]: fiche("101", ADRESSE), [`${CLUBS}st-pierre-hand/`]: fiche("102", "club.saint-pierre@gmail.com") };
    db = new DatabaseSync(":memory:");
    db.exec(readFileSync(new URL("../scripts/clubs.sql", import.meta.url), "utf8"));
    espace.configure(
      async (sql, ...params) => Number(db.prepare(sql).run(...(params as (string | number | null)[])).changes),
      async <T>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as (string | number | null)[])) as T[],
      async (m) => (sent.push(m), true),
    );
    drapeau.ouvrir(true);
    vi.stubGlobal("fetch", async (url: string) => {
      reads.push(String(url));
      const page = pages[String(url)];
      return page ? new Response(page) : new Response("", { status: 503 });
    });
    expect(await espace.relireAnnuaire(NOW, lireTrop)).toEqual({ lus: 11, retires: 0 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    espace.configure(undefined);
    drapeau.ouvrir(drapeau.CLUB_EN_LIGNE);
  });

  const leTampon = async () => (await espace.club(rows<{ id: number }>("SELECT id FROM clubs WHERE ref = '101'")[0].id))!;

  it("reads the directory once a week, and withdraws the clubs gone from the map", async () => {
    expect(rows("SELECT ref, niveau, nom, commune, activite FROM clubs WHERE ref = '101'")).toEqual([{ ref: "101", niveau: 1, nom: "HANDBALL CLUB DU TAMPON", commune: "Le Tampon", activite: "Handball" }]);
    // Not due before six days and a half.
    expect(await espace.relireAnnuaire(later(6 * 86400), lire)).toBeUndefined();
    const lu = await espace.relireAnnuaire(later(7 * 86400), async () => (await lireTrop()).filter((c) => c.ref !== "102"));
    expect(lu).toEqual({ lus: 10, retires: 1 });
    expect((await espace.proposes()).map((c) => c.nom)).not.toContain("ST PIERRE HAND & CO");
    // Back on the map: proposed again, the same row.
    await espace.relireAnnuaire(later(14 * 86400), lireTrop);
    expect((await espace.proposes()).length).toBe(11);
    expect(rows("SELECT COUNT(*) AS n FROM clubs")).toEqual([{ n: 11 }]);
  });

  it("changes nothing on a map that looks cut, nor before the flag", async () => {
    await expect(espace.relireAnnuaire(later(7 * 86400), lire)).rejects.toThrow(/3 clubs seulement/);
    expect(rows("SELECT COUNT(*) AS n FROM clubs WHERE retire_le IS NOT NULL")).toEqual([{ n: 0 }]);
    drapeau.ouvrir(false);
    expect(await espace.relireAnnuaire(later(7 * 86400), lireTrop)).toBeUndefined();
    expect(await espace.purger(later(7 * 86400))).toBe(0);
  });

  it("e-mails a link to the address read now on the club's page, and keeps the address nowhere", async () => {
    const c = await leTampon();
    const d = await espace.demander(c, "https://rundata.re/associations/club/acces/", IP, NOW);
    expect(d).toEqual({ issue: "ok", masque: "5•••••@reunion.ffhandball.net" });
    expect(reads).toEqual([`${CLUBS}handball-club-du-tampon/`]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(ADRESSE);
    expect(sent[0].subject).toBe("Votre espace sur rundata.re");
    expect(sent[0].text).toContain("Quelqu'un a demandé à ouvrir l'espace de HANDBALL CLUB DU TAMPON sur rundata.re. Nous écrivons à l'adresse que la Fédération française de handball a créée pour votre club.");
    expect(sent[0].text).toContain("Pour l'ouvrir, touchez ce lien (valable 48 heures) :\nhttps://rundata.re/associations/club/acces/");
    expect(sent[0].text).toContain("Ce n'est pas vous ? Ne faites rien : sans clic, rien ne se passe.");
    // The trace: the club, the kind, the time; the link: its hash.
    expect(rows("SELECT type, t FROM envois")).toEqual([{ type: "lien", t: NOW.getTime() / 1000 }]);
    expect(tout()).not.toContain("@");
    expect(tout()).not.toContain(secretDe(sent[0]));
  });

  it("sends nothing when the page gives another address, or does not answer", async () => {
    const saintPierre = (await espace.club(rows<{ id: number }>("SELECT id FROM clubs WHERE ref = '102'")[0].id))!;
    expect(await espace.demander(saintPierre, "https://rundata.re/x/", IP, NOW)).toEqual({ issue: "absente" });
    pages = {};
    expect(await espace.demander(await leTampon(), "https://rundata.re/x/", IP, NOW)).toEqual({ issue: "indisponible" });
    expect(sent).toEqual([]);
    // Each link asked counts, sent or not.
    expect(rows("SELECT COUNT(*) AS n FROM envois")).toEqual([{ n: 2 }]);
  });

  it("sends at most five links a day to a club, counted before the page is read", async () => {
    const c = await leTampon();
    for (let i = 0; i < espace.LIENS_PAR_CLUB_JOUR; i++) expect((await espace.demander(c, "https://rundata.re/x/", `198.51.100.${i}`, later(i))).issue).toBe("ok");
    const lus = reads.length;
    expect(await espace.demander(c, "https://rundata.re/x/", "198.51.100.99", later(10))).toEqual({ issue: "limite" });
    expect(reads).toHaveLength(lus);
    expect(sent).toHaveLength(espace.LIENS_PAR_CLUB_JOUR);
    // A day later, again.
    expect((await espace.demander(c, "https://rundata.re/x/", IP, later(86400 + 5))).issue).toBe("ok");
  });

  it("sends at most three links a day from one connection, so that one alone never uses up a club's day", async () => {
    const c = await leTampon();
    for (let i = 0; i < espace.LIENS_PAR_CONNEXION_JOUR; i++) expect((await espace.demander(c, "https://rundata.re/x/", IP, later(i))).issue).toBe("ok");
    const lus = reads.length;
    expect(await espace.demander(c, "https://rundata.re/x/", IP, later(10))).toEqual({ issue: "limite-connexion" });
    expect(reads).toHaveLength(lus);
    // Another connection may; whatever the club, and from any address of its /64, three times.
    expect((await espace.demander(c, "https://rundata.re/x/", IP2, later(20))).issue).toBe("ok");
    const saintPierre = (await espace.club(rows<{ id: number }>("SELECT id FROM clubs WHERE ref = '102'")[0].id))!;
    expect((await espace.demander(saintPierre, "https://rundata.re/x/", IP2, later(21))).issue).toBe("absente");
    expect((await espace.demander(saintPierre, "https://rundata.re/x/", "2001:db8:aa:bb:9::9", later(22))).issue).toBe("absente");
    expect((await espace.demander(saintPierre, "https://rundata.re/x/", "2001:db8:aa:bb:9::9", later(23))).issue).toBe("limite-connexion");
    // Never the address in the table; its fingerprint for a day only.
    expect(tout()).not.toContain("203.0.113");
    expect(tout()).not.toContain("2001:db8");
    expect(rows("SELECT COUNT(*) AS n FROM envois WHERE source IS NOT NULL")).toEqual([{ n: 6 }]);
    await espace.demander(c, "https://rundata.re/x/", IP, later(86400 + 30));
    expect(rows("SELECT COUNT(*) AS n FROM envois WHERE source IS NOT NULL")).toEqual([{ n: 1 }]);
    await espace.purger(later(2 * 86400 + 60));
    expect(rows("SELECT COUNT(*) AS n FROM envois WHERE source IS NOT NULL")).toEqual([{ n: 0 }]);
  });

  it("sends at most fifty links a day to all the clubs together", async () => {
    const c = await leTampon();
    const t = NOW.getTime() / 1000;
    for (let i = 0; i < espace.LIENS_EN_TOUT_JOUR; i++) db.prepare("INSERT INTO envois (club, type, t) VALUES (?, 'lien', ?)").run(1000 + i, t - 60);
    expect(await espace.demander(c, "https://rundata.re/x/", IP, NOW)).toEqual({ issue: "limite-totale" });
    expect(sent).toEqual([]);
  });

  it("shows screen 2's mask from the cache for ten minutes, never the address, and never a silent source's issue", async () => {
    let now = NOW.getTime();
    const cache = new Cache(new MemoryStore(), () => now);
    const c = await leTampon();
    expect(await espace.apercu(c, cache)).toEqual({ masque: "5•••••@reunion.ffhandball.net" });
    expect(await espace.apercu(c, cache)).toEqual({ masque: "5•••••@reunion.ffhandball.net" });
    expect(reads).toHaveLength(1);
    expect(JSON.stringify(await cache.peek(`club:apercu:${c.id}`))).not.toContain(ADRESSE);
    now += (espace.APERCU_SECONDES + 1) * 1000;
    pages = {};
    expect(await espace.apercu(c, cache)).toEqual({ issue: "indisponible" });
    // Back once the cache's breaker for a silent source closes.
    pages = { [`${CLUBS}handball-club-du-tampon/`]: fiche("101", ADRESSE) };
    now += breakerMs(espace.APERCU_SECONDES) + 1000;
    expect(await espace.apercu(c, cache)).toEqual({ masque: "5•••••@reunion.ffhandball.net" });
  });

  it("opens the space once per e-mailed link, the agreement the first time only, and a new personal link replaces the old", async () => {
    const c = await leTampon();
    await espace.demander(c, "https://rundata.re/associations/club/acces/", IP, NOW);
    const s1 = secretDe(sent[0]);
    // Opening the link changes nothing.
    expect(await espace.lien(s1, later(60))).toMatchObject({ club: { nom: "HANDBALL CLUB DU TAMPON" }, premiere: true });
    expect(await espace.lien(s1, later(60))).toMatchObject({ premiere: true });
    const p1 = (await espace.ouvrir(s1, later(120)))!;
    expect(p1).toMatch(/^[\w-]{22}$/);
    // Used once.
    expect(await espace.lien(s1, later(130))).toBeUndefined();
    expect(await espace.ouvrir(s1, later(130))).toBeUndefined();
    expect(rows("SELECT verifie_le, accord_le FROM clubs WHERE ref = '101'")).toEqual([{ verifie_le: NOW.getTime() / 1000 + 120, accord_le: NOW.getTime() / 1000 + 120 }]);
    // Its first view says to keep it; the next ones do not.
    expect(await espace.espace(p1, later(140))).toMatchObject({ club: { nom: "HANDBALL CLUB DU TAMPON" }, nouveau: true });
    expect(await espace.espace(p1, later(150))).toMatchObject({ nouveau: false });
    // A second link: no agreement asked again, and the first personal link no longer opens.
    await espace.demander(c, "https://rundata.re/associations/club/acces/", IP, later(200));
    const s2 = secretDe(sent[1]);
    expect(await espace.lien(s2, later(210))).toMatchObject({ premiere: false });
    const p2 = (await espace.ouvrir(s2, later(220)))!;
    expect(await espace.espace(p1, later(230))).toBeUndefined();
    expect(await espace.espace(p2, later(230))).toMatchObject({ nouveau: true });
    expect(rows("SELECT accord_le FROM clubs WHERE ref = '101'")).toEqual([{ accord_le: NOW.getTime() / 1000 + 120 }]);
    expect(rows("SELECT COUNT(*) AS n FROM acces WHERE type = 'espace'")).toEqual([{ n: 1 }]);
  });

  it("cuts the club's other e-mailed links once one is used", async () => {
    const c = await leTampon();
    await espace.demander(c, "https://rundata.re/associations/club/acces/", IP, NOW);
    await espace.demander(c, "https://rundata.re/associations/club/acces/", IP, later(10));
    const [s1, s2] = sent.map(secretDe);
    const p = (await espace.ouvrir(s2, later(20)))!;
    expect(await espace.lien(s1, later(30))).toBeUndefined();
    expect(await espace.ouvrir(s1, later(30))).toBeUndefined();
    expect(await espace.espace(p, later(40))).toBeDefined();
    expect(rows("SELECT type FROM acces")).toEqual([{ type: "espace" }]);
  });

  it("opens nothing for a club withdrawn from its source", async () => {
    const c = await leTampon();
    await espace.demander(c, "https://rundata.re/associations/club/acces/", IP, NOW);
    await espace.demander(c, "https://rundata.re/associations/club/acces/", IP, later(10));
    const p = (await espace.ouvrir(secretDe(sent[1]), later(20)))!;
    await espace.demander(c, "https://rundata.re/associations/club/acces/", IP2, later(30));
    const s3 = secretDe(sent[2]);
    await espace.relireAnnuaire(later(7 * 86400), async () => (await lireTrop()).filter((x) => x.ref !== "101"));
    expect(await espace.lien(s3, later(7 * 86400 + 10))).toBeUndefined();
    expect(await espace.ouvrir(s3, later(7 * 86400 + 10))).toBeUndefined();
    expect(await espace.espace(p, later(7 * 86400 + 10))).toBeUndefined();
  });

  it("lets an e-mailed link go after 48 hours, and a personal link after 12 months without use", async () => {
    const c = await leTampon();
    await espace.demander(c, "https://rundata.re/associations/club/acces/", IP, NOW);
    const s1 = secretDe(sent[0]);
    expect(await espace.lien(s1, later(espace.LIEN_SECONDES + 1))).toBeUndefined();
    await espace.demander(c, "https://rundata.re/associations/club/acces/", IP, later(10));
    const p = (await espace.ouvrir(secretDe(sent[1]), later(20)))!;
    // Used after 11 months: valid 12 months from then.
    expect(await espace.espace(p, later(330 * 86400))).toBeDefined();
    expect(await espace.espace(p, later(330 * 86400 + espace.ESPACE_SECONDES - 10))).toBeDefined();
    expect(await espace.espace(p, later(330 * 86400 + 2 * espace.ESPACE_SECONDES))).toBeUndefined();
    // The daily purge: the old links and the old trace.
    expect(await espace.purger(later(1100 * 86400))).toBeGreaterThan(0);
    expect(rows("SELECT * FROM acces")).toEqual([]);
    expect(rows("SELECT * FROM envois")).toEqual([]);
  });

  it("writes a club checked by hand with its address, used then wiped 12 months after its last use", async () => {
    const m = { nom: "Club de pétanque du Tampon", commune: "Le Tampon", activite: "Pétanque", le: "2026-10-28" };
    expect(erreur(m)).toBeUndefined();
    expect(erreur({ ...m, commune: "Tampon" })).toMatch(/--commune/);
    expect(erreur({ ...m, le: "28/10/2026" })).toMatch(/--le/);
    db.exec(ecrire(m, "petanque.tampon@example.org", NOW));
    // Again: one row, its address changed.
    db.exec(ecrire(m, "bureau.petanque@example.org", NOW));
    const id = rows<{ id: number }>(`SELECT id FROM clubs WHERE ref = '${refDe(m)}'`)[0].id;
    const c = (await espace.club(id))!;
    expect(c).toMatchObject({ source: "manuel", niveau: 3, nom: "Club de pétanque du Tampon", activite: "Pétanque" });
    expect(espace.jourMois(c.adresse_le!)).toBe("28/10");
    expect(await espace.adresseOfficielle(c)).toEqual({ adresse: "bureau.petanque@example.org" });
    expect(await espace.demander(c, "https://rundata.re/associations/club/acces/", IP, NOW)).toEqual({ issue: "ok", masque: "b•••@e•••.org" });
    expect(sent[0].text).toContain("Nous écrivons à l'adresse vérifiée avec vous le 28/10.");
    expect(reads).toEqual([]);
    await espace.purger(later(espace.TRACE_SECONDES + 86400));
    expect(rows(`SELECT email FROM clubs WHERE id = ${id}`)).toEqual([{ email: null }]);
    expect(await espace.club(id)).toBeUndefined();
  });

  it("keeps a club checked again 12 months from then, and cuts the links of its old address only", async () => {
    const m = { nom: "Club de pétanque du Tampon", commune: "Le Tampon", activite: "Pétanque", le: "2026-10-28" };
    db.exec(ecrire(m, "petanque.tampon@example.org", NOW));
    const id = rows<{ id: number }>(`SELECT id FROM clubs WHERE ref = '${refDe(m)}'`)[0].id;
    await espace.demander((await espace.club(id))!, "https://rundata.re/associations/club/acces/", IP, NOW);
    const p = (await espace.ouvrir(secretDe(sent[0]), later(60)))!;
    expect(await espace.espace(p, later(120))).toBeDefined();
    // The same address checked again: its links stay.
    db.exec(ecrire(m, "petanque.tampon@example.org", later(180)));
    expect(await espace.espace(p, later(240))).toBeDefined();
    // A new address, 13 months later: the old one's links cut, and the new one kept 12 months from its check.
    const t13 = 395 * 86400;
    db.exec(ecrire({ ...m, le: "2027-11-27" }, "bureau.petanque@example.org", later(t13)));
    expect(rows(`SELECT * FROM acces WHERE club = ${id}`)).toEqual([]);
    expect(rows(`SELECT utilise_le FROM clubs WHERE id = ${id}`)).toEqual([{ utilise_le: null }]);
    await espace.purger(later(t13 + 86400));
    expect(rows(`SELECT email FROM clubs WHERE id = ${id}`)).toEqual([{ email: "bureau.petanque@example.org" }]);
  });

  it("reads the clubs a withdrawal returned in wrangler's output", () => {
    const m = { nom: "Club de pétanque du Tampon", commune: "Le Tampon" };
    db.exec(ecrire({ ...m, activite: "Pétanque", le: "2026-10-28" }, "petanque.tampon@example.org", NOW));
    // The statements as wrangler runs them, and its output (as read from wrangler 4, locally, 31/10/2026).
    const out = (sql: string) => JSON.stringify(sql.split(";\n").map((q) => ({ results: db.prepare(q.replace(/;$/, "")).all(), success: true, meta: { duration: 0 } })));
    expect(changements(out(retirer(m, later(60))))).toBe(1);
    expect(changements(out(retirer({ ...m, nom: "Club inconnu" }, later(60))))).toBe(0);
    expect(changements(`🌀 Executing on remote database\n${out(retirer({ ...m, nom: "Club inconnu" }, later(60)))}`)).toBe(0);
    expect(changements(`▲ [WARNING] une mise à jour de wrangler existe\n${out(retirer(m, later(90)))}`)).toBe(1);
    expect(changements("")).toBeUndefined();
    expect(changements("erreur")).toBeUndefined();
  });

  it("withdraws a club checked by hand: no longer proposed, its address and links gone", async () => {
    const m = { nom: "Club de pétanque du Tampon", commune: "Le Tampon", activite: "Pétanque", le: "2026-10-28" };
    db.exec(ecrire(m, "petanque.tampon@example.org", NOW));
    const id = rows<{ id: number }>(`SELECT id FROM clubs WHERE ref = '${refDe(m)}'`)[0].id;
    await espace.demander((await espace.club(id))!, "https://rundata.re/x/", IP, NOW);
    db.exec(retirer(m, later(60)));
    expect(rows(`SELECT email, retire_le FROM clubs WHERE id = ${id}`)).toEqual([{ email: null, retire_le: NOW.getTime() / 1000 + 60 }]);
    expect(rows(`SELECT * FROM acces WHERE club = ${id}`)).toEqual([]);
    expect(await espace.club(id)).toBeUndefined();
  });

  it("never writes an address of level 1 in the table, even by hand", () => {
    expect(() => db.exec("UPDATE clubs SET email = 'x@example.org' WHERE ref = '101'")).toThrow(/CHECK/);
  });
});
