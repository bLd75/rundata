import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import * as espace from "../src/clubs/espace.js";
import { clubsDeLAccueil } from "../src/clubs/monclub.js";
import * as club from "../src/web/club.js";
import * as formulaires from "../src/web/propositions.js";
import { ACCUEIL, ADRESSE, CLUBS, fiche } from "./monclub.js";

// Thursday 29 October 2026, 10:00 at La Réunion: the directory's reading. The pages read the clock.
const NOW = new Date("2026-10-29T06:00:00Z");

let db: DatabaseSync;
let sent: { to: string; subject: string; text: string }[];
let pages: Record<string, string>;
let logged: string[];
let tampon: number;

const rows = <T = Record<string, unknown>>(sql: string) => db.prepare(sql).all() as T[];
/** A page's text as written here, before the site's French typography (web/typo.ts). */
const plain = (html: string) => html.replace(/’|&#39;/g, "'").replace(/[  ]/g, " ");

beforeEach(async () => {
  sent = [];
  logged = [];
  pages = { [`${CLUBS}handball-club-du-tampon/`]: fiche("101", ADRESSE), [`${CLUBS}st-pierre-hand/`]: fiche("102", "club.saint-pierre@gmail.com") };
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../scripts/clubs.sql", import.meta.url), "utf8"));
  espace.configure(
    async (sql, ...params) => Number(db.prepare(sql).run(...(params as (string | number | null)[])).changes),
    async <T>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as (string | number | null)[])) as T[],
    async (m) => (sent.push(m), true),
  );
  formulaires.ouvrir(true);
  club.ouvrir(true);
  formulaires.configure(undefined, async (t, _adresse, attendu) => t === "humain" && attendu.action === "club");
  const lus = clubsDeLAccueil(ACCUEIL);
  await espace.relireAnnuaire(NOW, async () => [...lus, ...Array.from({ length: 8 }, (_, i) => ({ ref: `20${i}`, nom: `CLUB DE VOLLEY ${i}`, commune: "Saint-Paul", fiche: `${CLUBS}club-${i}/` }))]);
  tampon = rows<{ id: number }>("SELECT id FROM clubs WHERE ref = '101'")[0].id;
  vi.stubGlobal("fetch", async (url: string) => {
    const page = pages[String(url)];
    return page ? new Response(page) : new Response("", { status: 503 });
  });
  for (const level of ["log", "warn", "error", "info"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  espace.configure(undefined);
  formulaires.configure(undefined);
  formulaires.ouvrir(formulaires.ASSOCIATIONS_EN_LIGNE);
  club.ouvrir(club.CLUB_EN_LIGNE);
  // Never the address in what is logged.
  for (const line of logged) expect(line).not.toContain(ADRESSE);
});

const get = (path: string) => handle(new Request(`https://rundata.re${path}`, { headers: { accept: "text/html" } }), new Cache());
const post = (path: string, fields: Record<string, string>) =>
  handle(new Request(`https://rundata.re${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" }, body: new URLSearchParams(fields).toString() }), new Cache());

/** The link asked for the club and its e-mail's secret. */
async function demande(id = tampon): Promise<string> {
  expect((await post(club.DEMANDE_PATH, { club: String(id), "cf-turnstile-response": "humain" })).status).toBe(200);
  return /\/associations\/club\/acces\/([\w-]+)\n/.exec(sent.at(-1)!.text)![1];
}

describe("the clubs' own space", () => {
  it("answers nothing before its flag", async () => {
    club.ouvrir(false);
    for (const p of [club.CLUB_PATH, `${club.DEMANDE_PATH}?club=${tampon}`, `${club.ACCES_PATH}abcdefghijklmnopqrstuv`, `${club.ESPACE_PATH}abcdefghijklmnopqrstuv`]) expect((await get(p)).status, p).toBe(404);
    expect((await post(club.DEMANDE_PATH, { club: String(tampon), "cf-turnstile-response": "humain" })).status).toBe(404);
    expect(sent).toEqual([]);
    expect(await (await get("/associations")).text()).not.toContain(club.CLUB_PATH);
  });

  it("screen 1: one field, the clubs proposed as typed, and the usual form when none is found", async () => {
    let html = plain(await (await get(club.CLUB_PATH)).text());
    expect(html).toContain("<h1>Votre espace</h1>");
    expect(html).toContain('<label for="c-q">Le nom de votre club ou association</label>');
    expect(html).toContain("Tapez les premières lettres : nous cherchons dans les annuaires officiels des clubs et associations.");
    expect(html).toContain('<option value="HANDBALL CLUB DU TAMPON">Le Tampon · Handball</option>');
    expect(html).toContain('<meta name="robots" content="noindex">');
    html = plain(await (await get(`${club.CLUB_PATH}?q=hand+tampon`)).text());
    expect(html).toContain(`<li><a href="${club.DEMANDE_PATH}?club=${tampon}" rel="nofollow">HANDBALL CLUB DU TAMPON<span>Le Tampon · Handball</span></a></li>`);
    expect(html).not.toContain("ST PIERRE HAND &amp; CO<span>");
    html = plain(await (await get(`${club.CLUB_PATH}?q=badminton`)).text());
    expect(html).toContain("Nous ne trouvons pas ce club dans les annuaires officiels. Vous pouvez proposer vos dates avec le formulaire habituel : elles sont relues avant de s'afficher.");
    expect(html).toContain(`<a class="btn sun" href="${formulaires.PROPOSER_PATH}?ref=club">Proposer un événement</a>`);
  });

  it("screen 2: the address read now on the club's page, shown masked, never whole", async () => {
    const r = await get(`${club.DEMANDE_PATH}?club=${tampon}`);
    expect(r.status).toBe(200);
    const html = plain(await r.text());
    expect(html).toContain('<h2 id="h-club">HANDBALL CLUB DU TAMPON · Le Tampon</h2>');
    expect(html).toContain("Nous envoyons un lien à l'adresse que la Fédération française de handball a créée pour votre club :");
    expect(html).toContain("<b>5•••••@reunion.ffhandball.net</b>");
    expect(html).toContain('<button type="submit">Envoyer le lien</button>');
    expect(html).toContain("Ce n'est plus la bonne adresse ?");
    expect(html).toContain("Pour votre sécurité, nous n'utilisons que l'adresse donnée par la Fédération française de handball. Faites-la corriger par la Fédération française de handball, puis revenez.");
    expect(html).toContain('data-action="club"');
    expect(html).not.toContain(ADRESSE);
    expect(html).not.toContain("5974001");
    expect(sent).toEqual([]);
  });

  it("screen 1: says so when the list of the clubs cannot be read", async () => {
    espace.configure(async () => 0, async () => {
      throw new Error("D1 muette");
    });
    const r = await get(`${club.CLUB_PATH}?q=hand`);
    expect(r.status).toBe(503);
    expect(plain(await r.text())).toContain("La liste des clubs ne répond pas pour l'instant. Réessayez dans quelques minutes ; si ça dure, écrivez-nous à contact@rundata.re.");
  });

  it("screen 2: reads the club's page once in ten minutes, however often it is opened, and keeps only the mask", async () => {
    const reads: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => (reads.push(String(url)), new Response(pages[String(url)] ?? "", { status: pages[String(url)] ? 200 : 503 })));
    const cache = new Cache();
    const open = () => handle(new Request(`https://rundata.re${club.DEMANDE_PATH}?club=${tampon}`, { headers: { accept: "text/html" } }), cache);
    for (let i = 0; i < 3; i++) expect(plain(await (await open()).text())).toContain("<b>5•••••@reunion.ffhandball.net</b>");
    expect(reads).toEqual([`${CLUBS}handball-club-du-tampon/`]);
    expect(JSON.stringify(await cache.peek(`club:apercu:${tampon}`))).not.toContain(ADRESSE);
    // The send reads the page again, whatever the mask kept.
    await demande();
    expect(reads).toHaveLength(2);
  });

  it("screen 2: says why nothing can be sent when the page gives another address, or does not answer, or the club is unknown", async () => {
    const saintPierre = rows<{ id: number }>("SELECT id FROM clubs WHERE ref = '102'")[0].id;
    let r = await get(`${club.DEMANDE_PATH}?club=${saintPierre}`);
    expect(r.status).toBe(422);
    let html = plain(await r.text());
    expect(html).toContain("La page de votre club chez la Fédération française de handball ne donne plus l'adresse que la fédération a créée pour lui. Rien n'a été envoyé.");
    expect(html).not.toContain("club.saint-pierre");
    pages = {};
    r = await get(`${club.DEMANDE_PATH}?club=${tampon}`);
    expect(r.status).toBe(503);
    expect(plain(await r.text())).toContain("La vérification de l'adresse ne répond pas pour l'instant. Rien n'a été envoyé. Réessayez dans quelques minutes ; si ça dure, écrivez-nous à contact@rundata.re.");
    expect((await get(`${club.DEMANDE_PATH}?club=999`)).status).toBe(404);
    expect((await get(`${club.DEMANDE_PATH}?club=abc`)).status).toBe(404);
  });

  it("sends the link only to a person, and says where it went, masked", async () => {
    let r = await post(club.DEMANDE_PATH, { club: String(tampon), "cf-turnstile-response": "robot" });
    expect(r.status).toBe(503);
    r = await post(club.DEMANDE_PATH, { club: String(tampon), "cf-turnstile-response": "humain", site_web: "x" });
    expect(r.status).toBe(503);
    expect(sent).toEqual([]);
    r = await post(club.DEMANDE_PATH, { club: String(tampon), "cf-turnstile-response": "humain" });
    expect(r.status).toBe(200);
    const html = plain(await r.text());
    expect(html).toContain("C'est parti.");
    expect(html).toContain("Ouvrez l'e-mail envoyé à 5•••••@reunion.ffhandball.net et touchez le lien. Il vaut 48 heures.");
    expect(html).toContain(`Rien reçu après quelques minutes ? Regardez dans les indésirables, ou <a href="${club.DEMANDE_PATH}?club=${tampon}" rel="nofollow">renvoyez le lien</a>.`);
    expect(html).not.toContain(ADRESSE);
    expect(sent.map((m) => m.to)).toEqual([ADRESSE]);
    // A form of another site.
    const ailleurs = await handle(new Request(`https://rundata.re${club.DEMANDE_PATH}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://example.org" }, body: `club=${tampon}&cf-turnstile-response=humain` }), new Cache());
    expect(ailleurs.status).toBe(403);
  });

  it("caps the links of a club at five a day", async () => {
    for (let i = 0; i < espace.LIENS_PAR_CLUB_JOUR; i++) await demande();
    const r = await post(club.DEMANDE_PATH, { club: String(tampon), "cf-turnstile-response": "humain" });
    expect(r.status).toBe(429);
    expect(plain(await r.text())).toContain("Trop de liens ont été demandés aujourd'hui pour ce club. Rien n'a été envoyé : utilisez le dernier e-mail reçu, ou réessayez demain.");
    expect(sent).toHaveLength(espace.LIENS_PAR_CLUB_JOUR);
  });

  it("screen 3: opening the link changes nothing; « Ouvrir mon espace » leads to the personal link, kept secret", async () => {
    const s = await demande();
    const r = await get(`${club.ACCES_PATH}${s}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("x-robots-tag")).toBe("noindex");
    let html = plain(await r.text());
    expect(html).toContain("<h1>HANDBALL CLUB DU TAMPON</h1>");
    expect(html).toContain("En ouvrant votre espace, vous confirmez agir pour ce club ou cette association. Les dates que vous publiez sont ouvertes au public, et publiées sous Licence Ouverte 2.0 : tout le monde peut les réutiliser, en citant votre club.");
    expect(html).toContain('<button type="submit">Ouvrir mon espace</button>');
    expect(html).toContain('<link rel="canonical" href="https://rundata.re/associations/club">');
    expect(rows("SELECT verifie_le, accord_le FROM clubs WHERE ref = '101'")).toEqual([{ verifie_le: null, accord_le: null }]);
    const o = await post(`${club.ACCES_PATH}${s}`, {});
    expect(o.status).toBe(303);
    const location = o.headers.get("location")!;
    expect(location).toMatch(/^\/associations\/club\/[\w-]{22}$/);
    // Used once.
    expect((await get(`${club.ACCES_PATH}${s}`)).status).toBe(404);
    expect((await post(`${club.ACCES_PATH}${s}`, {})).status).toBe(410);
    html = plain(await (await get(`${club.ACCES_PATH}${s}`)).text());
    expect(html).toContain("Ce lien n'est plus valable.");
    expect(html).toContain(`<a class="btn sun" href="${club.CLUB_PATH}">Recevoir un nouveau lien</a>`);

    // « Mon agenda »: the club, the day of its verification, and the first time, to keep the page.
    const a = await get(location);
    expect(a.status).toBe(200);
    expect(a.headers.get("referrer-policy")).toBe("no-referrer");
    html = plain(await a.text());
    expect(html).toContain("<h1>HANDBALL CLUB DU TAMPON</h1>");
    // The pages read the clock: verified today.
    expect(html).toContain(`Vérifié le ${espace.jourMois(Math.floor(Date.now() / 1000))}`);
    expect(html).toContain("Vos prochaines dates");
    expect(html).toContain("Gardez cette page : ajoutez-la à vos favoris ou à l'écran d'accueil de votre téléphone. Pour revenir sans elle, demandez un nouveau lien depuis la page Associations.");
    expect(html).not.toContain(location.slice(-22));
    expect(plain(await (await get(location)).text())).not.toContain("Gardez cette page");

    // A second link: no agreement asked again, and the old personal link no longer opens.
    const s2 = await demande();
    html = plain(await (await get(`${club.ACCES_PATH}${s2}`)).text());
    expect(html).not.toContain("En ouvrant votre espace");
    const location2 = (await post(`${club.ACCES_PATH}${s2}`, {})).headers.get("location")!;
    expect((await get(location)).status).toBe(404);
    expect((await get(location2)).status).toBe(200);
  });

  it("never gives the secrets nor the address back in a page or a log", async () => {
    const s = await demande();
    const html = await (await get(`${club.ACCES_PATH}${s}`)).text();
    // Only in the form's own address.
    expect(html.split(s).length - 1).toBe(1);
    expect(html).toContain(`action="${club.ACCES_PATH}${s}"`);
    expect(logged.join("\n")).not.toContain(s);
  });
});
