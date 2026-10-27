import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import * as chiffre from "../src/connecteurs/chiffre.js";
import * as connexions from "../src/connecteurs/connexions.js";
import * as connecteurs from "../src/web/connecteurs.js";
import * as formulaires from "../src/web/propositions.js";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ACCESS = "eyJhbGciOiJIUzI1NiJ9.acces.signature";
const REFRESH = "rafraichissement-premier";
const ORG = { organizationSlug: "club-de-petanque", name: "Club de pétanque du Tampon", city: "Le Tampon", zipCode: "97430", url: "https://www.helloasso.com/associations/club-de-petanque" };

let db: DatabaseSync;
let sent: { to: string; subject: string; text: string }[];
let orgs: unknown[];
let token: { status: number; body: unknown };
let logged: string[];

const rows = <T = Record<string, unknown>>(sql: string) => db.prepare(sql).all() as T[];
/** A page's text as written here, before the site's French typography (web/typo.ts). */
const plain = (html: string) => html.replace(/’|&#39;/g, "'").replace(/[\u00a0\u202f]/g, " ");

beforeEach(() => {
  sent = [];
  logged = [];
  orgs = [ORG];
  token = { status: 200, body: { access_token: ACCESS, refresh_token: REFRESH, token_type: "bearer", expires_in: 1799 } };
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../scripts/connecteurs.sql", import.meta.url), "utf8"));
  chiffre.configure(KEY);
  connexions.configure(
    async (sql, ...params) => Number(db.prepare(sql).run(...(params as (string | number | null)[])).changes),
    async <T>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as (string | number | null)[])) as T[],
    async (m) => (sent.push(m), true),
  );
  formulaires.ouvrir(true);
  connecteurs.ouvrir(true);
  formulaires.configure(undefined, async (t) => t === "humain");
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.hostname !== "api.helloasso.com") return new Response("", { status: 503 });
    if (u.pathname === "/oauth2/token") return new Response(JSON.stringify(token.body), { status: token.status });
    if (u.pathname === "/v5/users/me/organizations" && new Headers(init?.headers).get("Authorization") === `Bearer ${ACCESS}`) return new Response(JSON.stringify(orgs));
    return new Response("", { status: 404 });
  });
  for (const level of ["log", "warn", "error", "info"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  chiffre.configure(undefined);
  connexions.configure(undefined);
  formulaires.configure(undefined);
  formulaires.ouvrir(formulaires.ASSOCIATIONS_EN_LIGNE);
  connecteurs.ouvrir(connecteurs.CONNECTEURS_EN_LIGNE);
  // Never a key, a token nor a link's secret in what is logged.
  for (const line of logged) for (const s of ["le-secret-client", ACCESS, REFRESH]) expect(line).not.toContain(s);
});

const get = (path: string) => handle(new Request(`https://rundata.re${path}`, { headers: { accept: "text/html" } }), new Cache());
const post = (path: string, fields: Record<string, string>) =>
  handle(new Request(`https://rundata.re${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" }, body: new URLSearchParams(fields).toString() }), new Cache());
const CLES = { plateforme: "helloasso", client_id: "id-client", client_secret: "le-secret-client", email: "club@example.org", "cf-turnstile-response": "humain" };

/** The keys verified, « C'est bien nous » clicked: the e-mailed link's secret. */
async function relie(email = "club@example.org"): Promise<string> {
  const r = await post(connecteurs.RELIER_PATH, { ...CLES, email });
  const scelle = /name="attente" value="([^"]+)"/.exec(await r.text())![1];
  expect((await post(connecteurs.CONFIRMER_PATH, { attente: scelle, choix: "oui" })).status).toBe(200);
  return /\/associations\/connexion\/([\w-]+)\n/.exec(sent.at(-1)!.text)![1];
}

describe("« Relier votre plateforme »", () => {
  it("answers nothing before the flag, and shows no card", async () => {
    connecteurs.ouvrir(false);
    expect((await get(connecteurs.RELIER_PATH)).status).toBe(404);
    expect((await post(connecteurs.CONFIRMER_PATH, { choix: "oui" })).status).toBe(404);
    expect((await get(`${connecteurs.CONNEXION_PATH}abcdefghijklmnopqrstuv`)).status).toBe(404);
    expect(await (await get("/associations")).text()).not.toContain(connecteurs.RELIER_PATH);
    const conf = plain(await (await get("/confidentialite")).text());
    expect(conf).not.toContain("HelloAsso");
    expect(conf).toContain("Seuls les deux formulaires des clubs et associations demandent une adresse électronique (voir <a href=\"#associations-donnees\">« Ce que les clubs et associations envoient »</a>).");
    expect(conf).toContain("<b>Contre les abus</b>, pour les deux formulaires,");
  });

  it("shows its card on /associations, its form, and its paragraph on /confidentialite", async () => {
    const page = plain(await (await get("/associations")).text());
    expect(page).toContain("Relier votre plateforme");
    expect(page).toContain(`href="${connecteurs.RELIER_PATH}">Relier HelloAsso</a>`);
    const form = plain(await (await get(connecteurs.RELIER_PATH)).text());
    expect(form).toContain("<h1>Relier votre plateforme à rundata.re</h1>");
    expect(form).toContain("Nous ne lisons jamais vos commandes, paiements, dons, participants ni adhérents, même si vos clés le permettent.");
    expect(form).toContain("<button type=\"submit\">Vérifier mes clés</button>");
    const conf = plain(await (await get("/confidentialite")).text());
    expect(conf).toContain("Les associations reliées à une plateforme (HelloAsso)");
    expect(conf).toContain("et <a href=\"#plateformes-donnees\">« Les associations reliées à une plateforme »</a>).");
    expect(conf).toContain("La vérification anti-robot des trois formulaires des clubs et associations y garde aussi une donnée");
    expect(conf).toContain("<b>Contre les abus</b>, pour les trois formulaires,");
  });

  it("asks HelloAsso which association the keys administer, writes nothing, and never gives the secret back", async () => {
    const r = await post(connecteurs.RELIER_PATH, CLES);
    expect(r.status).toBe(200);
    const html = plain(await r.text());
    expect(html).toContain("C'est bien votre association ?");
    expect(html).toContain("<b>Club de pétanque du Tampon</b>");
    expect(html).toContain("En confirmant, vous recevrez un e-mail à club@example.org.");
    expect(html).not.toContain("le-secret-client");
    expect(html).not.toContain(REFRESH);
    expect(html).not.toContain("déjà reliée");
    expect(rows("SELECT * FROM connexions")).toEqual([]);
  });

  it("says what went wrong: fields, refused keys, no association, outside the island, HelloAsso silent", async () => {
    let r = await post(connecteurs.RELIER_PATH, { ...CLES, client_id: "", email: "club@" });
    expect(r.status).toBe(422);
    let html = plain(await r.text());
    expect(html).toContain('id="faux-client_id"');
    expect(html).toContain('id="faux-email"');
    expect(html).not.toContain("le-secret-client");
    token = { status: 400, body: { error: "invalid_client" } };
    html = plain(await (await post(connecteurs.RELIER_PATH, CLES)).text());
    expect(html).toContain("HelloAsso n'a pas reconnu ces clés.");
    expect(html).toContain('value="id-client"');
    expect(html).not.toContain("le-secret-client");
    token = { status: 200, body: { access_token: ACCESS, refresh_token: REFRESH } };
    orgs = [];
    expect(plain(await (await post(connecteurs.RELIER_PATH, CLES)).text())).toContain("Ces clés ne sont rattachées à aucune association sur HelloAsso.");
    orgs = [{ ...ORG, zipCode: "75011", city: "Paris" }];
    expect(plain(await (await post(connecteurs.RELIER_PATH, CLES)).text())).toContain("n'a pas son adresse à La Réunion (code postal en 974)");
    token = { status: 503, body: {} };
    r = await post(connecteurs.RELIER_PATH, CLES);
    expect(r.status).toBe(503);
    expect(plain(await r.text())).toContain("La vérification n'a pas pu se faire pour l'instant. Rien n'a été gardé.");
    // A robot, or no Turnstile: nothing asked to HelloAsso.
    expect((await post(connecteurs.RELIER_PATH, { ...CLES, "cf-turnstile-response": "robot" })).status).toBe(503);
    expect(rows("SELECT * FROM connexions")).toEqual([]);
  });

  it("keeps nothing on « Ce n'est pas nous », nor for a verification changed or older than 30 minutes", async () => {
    const html = await (await post(connecteurs.RELIER_PATH, CLES)).text();
    const scelle = /name="attente" value="([^"]+)"/.exec(html)![1];
    expect(plain(await (await post(connecteurs.CONFIRMER_PATH, { attente: scelle, choix: "non" })).text())).toContain("Rien n'a été gardé. Si ces clés ne sont pas celles de votre association");
    const changed = `${scelle.slice(0, -4)}AAAA`;
    const r = await post(connecteurs.CONFIRMER_PATH, { attente: changed, choix: "oui" });
    expect(r.status).toBe(410);
    expect(plain(await r.text())).toContain("La vérification a expiré. Rien n'a été gardé");
    expect(await connexions.ouvrir(scelle, new Date(Date.now() + 31 * 60_000))).toBeUndefined();
    expect(await connexions.ouvrir(scelle)).toMatchObject({ plateforme: "helloasso", organisation: { id: "club-de-petanque" }, secret: REFRESH });
    expect(rows("SELECT * FROM connexions")).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe("the link, once « C'est bien nous » is clicked", () => {
  it("keeps the refresh token encrypted for its row, the link's secret as a hash, and e-mails both links", async () => {
    const secret = await relie();
    const [row] = rows<Record<string, string>>("SELECT * FROM connexions");
    expect(row).toMatchObject({ plateforme: "helloasso", organisation: "club-de-petanque", nom: "Club de pétanque du Tampon", commune: "Le Tampon", code_postal: "97430", etat: "a_confirmer", email: "club@example.org" });
    expect(JSON.stringify(row)).not.toContain(REFRESH);
    expect(JSON.stringify(row)).not.toContain("le-secret-client");
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(await chiffre.dechiffrer(row.secret, chiffre.lien("helloasso", "club-de-petanque", row.jeton))).toBe(REFRESH);
    const m = sent[0];
    expect(m.subject).toBe("Confirmez la connexion de Club de pétanque du Tampon à rundata.re");
    expect(m.text).toContain("Vous avez relié le compte HelloAsso de Club de pétanque du Tampon (Le Tampon) à rundata.re.");
    expect(m.text).toContain(`https://rundata.re/associations/connexion/${secret}\n`);
    expect(m.text).toContain(`https://rundata.re/associations/connexion/${secret}/retirer\n`);
    expect(m.text).toContain("\nL'équipe rundata.re\nrundata.re · https://rundata.re/associations");
  });

  it("confirms only on the button: opening the link changes nothing", async () => {
    const secret = await relie();
    const page = await get(`${connecteurs.CONNEXION_PATH}${secret}`);
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
    expect(plain(await page.text())).toContain("L'association Club de pétanque du Tampon (Le Tampon) sera reliée à rundata.re avec l'adresse club@example.org.");
    expect(rows("SELECT etat FROM connexions")).toEqual([{ etat: "a_confirmer" }]);
    const done = plain(await (await post(`${connecteurs.CONNEXION_PATH}${secret}`, {})).text());
    expect(done).toContain("C'est confirmé");
    expect(rows("SELECT etat FROM connexions")).toEqual([{ etat: "a_moderer" }]);
    // Sent again by a double click: said as done.
    expect(plain(await (await post(`${connecteurs.CONNEXION_PATH}${secret}`, {})).text())).toContain("C'est confirmé");
    // Opened later: no longer valid for confirming.
    expect(plain(await (await get(`${connecteurs.CONNEXION_PATH}${secret}`)).text())).toContain("Ce lien n'est plus valable");
    expect(plain(await (await get(`${connecteurs.CONNEXION_PATH}inconnu-inconnu-inconnu`)).text())).toContain("Ce lien n'est plus valable");
  });

  it("replaces the association's link at once when it is confirmed again, and tells the first address", async () => {
    const first = await relie("ancien@example.org");
    await post(`${connecteurs.CONNEXION_PATH}${first}`, {});
    db.prepare("UPDATE connexions SET etat = 'actif'").run();
    db.prepare("INSERT INTO evenements_connectes (connexion, id, maj, titre, debut, lien) SELECT id, 'e', 'm', 'T', '2026-11-14T18:00', 'https://x' FROM connexions").run();
    const html = plain(await (await post(connecteurs.RELIER_PATH, { ...CLES, email: "nouveau@example.org" })).text());
    expect(html).toContain("Cette association est déjà reliée à rundata.re.");
    const scelle = /name="attente" value="([^"]+)"/.exec(html)![1];
    await post(connecteurs.CONFIRMER_PATH, { attente: scelle, choix: "oui" });
    const second = /\/associations\/connexion\/([\w-]+)\n/.exec(sent.at(-1)!.text)![1];
    // Both wait side by side until the new one is confirmed.
    expect(rows("SELECT email, etat FROM connexions ORDER BY id")).toEqual([{ email: "ancien@example.org", etat: "actif" }, { email: "nouveau@example.org", etat: "a_confirmer" }]);
    await post(`${connecteurs.CONNEXION_PATH}${second}`, {});
    expect(rows("SELECT email, etat FROM connexions")).toEqual([{ email: "nouveau@example.org", etat: "actif" }]);
    expect(rows("SELECT * FROM evenements_connectes")).toEqual([]);
    expect(sent.at(-1)).toMatchObject({ to: "ancien@example.org", subject: "La connexion de Club de pétanque du Tampon à rundata.re a été remplacée" });
  });

  it("withdraws only on the button: the row and its events go at once, and an e-mail says so", async () => {
    const secret = await relie();
    await post(`${connecteurs.CONNEXION_PATH}${secret}`, {});
    db.prepare("INSERT INTO evenements_connectes (connexion, id, maj, titre, debut, lien) SELECT id, 'e', 'm', 'T', '2026-11-14T18:00', 'https://x' FROM connexions").run();
    const page = plain(await (await get(`${connecteurs.CONNEXION_PATH}${secret}/retirer`)).text());
    expect(page).toContain("L'association Club de pétanque du Tampon est reliée à rundata.re depuis le ");
    expect(page).toContain("<button type=\"submit\">Retirer l'accès</button>");
    expect(rows("SELECT COUNT(*) AS n FROM connexions")).toEqual([{ n: 1 }]);
    const done = plain(await (await post(`${connecteurs.CONNEXION_PATH}${secret}/retirer`, {})).text());
    expect(done).toContain("C'est fait. Le jeton d'accès et votre adresse sont effacés");
    expect(rows("SELECT * FROM connexions")).toEqual([]);
    expect(rows("SELECT * FROM evenements_connectes")).toEqual([]);
    expect(sent.at(-1)).toMatchObject({ to: "club@example.org", subject: "La connexion de Club de pétanque du Tampon à rundata.re est retirée" });
    expect(sent.at(-1)!.text).toContain("Vous avez retiré l'accès de rundata.re au compte HelloAsso de Club de pétanque du Tampon.");
    const again = await get(`${connecteurs.CONNEXION_PATH}${secret}/retirer`);
    expect(again.status).toBe(404);
    expect(plain(await again.text())).toContain("Cette connexion n'existe plus");
  });

  it("refuses everything without the encryption key: nothing kept in clear instead", async () => {
    chiffre.configure(undefined);
    const r = await post(connecteurs.RELIER_PATH, CLES);
    expect(r.status).toBe(503);
    expect(rows("SELECT * FROM connexions")).toEqual([]);
  });
});
