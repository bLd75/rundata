import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import * as propositions from "../src/propositions.js";
import { FORMS_CSS } from "../src/web/formulaires-style.js";
import * as formulaires from "../src/web/propositions.js";

// Thursday 29 October 2026, 10:00 at La Réunion.
const NOW = new Date("2026-10-29T06:00:00Z");
const later = (hours: number) => new Date(NOW.getTime() + hours * 3600_000);
let db: DatabaseSync;
let sent: { to: string; subject: string; text: string }[];

/** The real tables and triggers (scripts/propositions.sql), in memory, behind the door the Worker gives. */
function plug(send: propositions.Envoi | null = async (m) => (sent.push(m), true)) {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../scripts/propositions.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../scripts/propositions-b.sql", import.meta.url), "utf8"));
  propositions.configure(
    async (sql, ...params) => Number(db.prepare(sql).run(...(params as (string | number | null)[])).changes),
    send ?? undefined,
    async <T>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as (string | number | null)[])) as T[],
  );
}
/** A page's text as written here, before the site's French typography (web/typo.ts). */
const plain = (html: string) => html.replace(/’/g, "'").replace(/[\u00a0\u202f]/g, " ");
const rows = <T = Record<string, unknown>>(sql: string) => db.prepare(sql).all() as T[];

beforeEach(() => {
  sent = [];
  plug();
  // Each test opens the space itself: closed, nothing of it answers.
  formulaires.ouvrir(false);
});
afterEach(() => {
  propositions.configure(undefined);
  formulaires.configure(undefined);
  formulaires.ouvrir(formulaires.ASSOCIATIONS_EN_LIGNE);
});

const PROPOSITION = {
  titre: "Tournoi de pétanque du club",
  date: "2026-11-07",
  debut: "14:00",
  fin: "18:00",
  repete: "",
  jusqu_au: "",
  commune: "Saint-Pierre",
  lieu: "Boulodrome de Terre-Sainte",
  organisateur: "Pétanque club de Terre-Sainte",
  description: "Tournoi en doublettes, ouvert à tous.",
  prix: "5 € la doublette",
  lien: "https://www.facebook.com/events/123",
  email: "club@example.org",
  accord: "oui",
  vous_etes: "association",
};
const read = (fields: Record<string, string>, now = NOW) => propositions.lireProposition(new URLSearchParams(fields), formulaires.COMMUNES, now);

describe("what a club sends: the fields read", () => {
  it("reads a proposal, with « gratuit » ticked instead of a price", () => {
    const r = read(PROPOSITION);
    expect(r).toEqual({ proposition: { ...PROPOSITION, repete: undefined, jusqu_au: undefined, accord: undefined, vous_etes: undefined } });
    const free = read({ ...PROPOSITION, prix: "", gratuit: "oui" });
    expect("proposition" in free && free.proposition.prix).toBe("gratuit");
  });

  it("names every field to correct: a past or far date, a repetition without its end, no e-mail, no consent", () => {
    expect(read({ ...PROPOSITION, date: "2026-10-28" })).toEqual({ erreurs: ["date"] });
    expect(read({ ...PROPOSITION, date: "2027-10-30" })).toEqual({ erreurs: ["date"] });
    expect(read({ ...PROPOSITION, date: "2026-02-30" })).toEqual({ erreurs: ["date"] });
    expect(read({ ...PROPOSITION, repete: "semaine" })).toEqual({ erreurs: ["jusqu_au"] });
    // Three months from today at most, after the first date.
    expect(read({ ...PROPOSITION, repete: "semaine", jusqu_au: "2027-01-29" })).toHaveProperty("proposition.jusqu_au", "2027-01-29");
    expect(read({ ...PROPOSITION, repete: "mois", jusqu_au: "2027-01-30" })).toEqual({ erreurs: ["jusqu_au"] });
    expect(read({ ...PROPOSITION, repete: "mois", jusqu_au: "2026-11-07" })).toEqual({ erreurs: ["jusqu_au"] });
    expect(read({ ...PROPOSITION, repete: "chaque jour", jusqu_au: "2026-12-01" })).toEqual({ erreurs: ["repete"] });
    expect(read({ ...PROPOSITION, email: "club@", accord: "", commune: "Paris", lien: "javascript:alert(1)", prix: "", debut: "25:00" })).toEqual({ erreurs: ["debut", "commune", "prix", "lien", "email", "accord"] });
    expect(read({})).toEqual({ erreurs: ["vous_etes", "titre", "date", "debut", "commune", "lieu", "organisateur", "description", "prix", "email", "accord"] });
  });

  it("shows no contact unless asked: the e-mail when its box is ticked, or another contact given", () => {
    expect(read(PROPOSITION)).toHaveProperty("proposition.contact_public", undefined);
    expect(read({ ...PROPOSITION, email_public: "oui" })).toHaveProperty("proposition.contact_public", "club@example.org");
    expect(read({ ...PROPOSITION, email_public: "oui", contact_public: "0262 12 34 56" })).toHaveProperty("proposition.contact_public", "0262 12 34 56");
    expect(read({ ...PROPOSITION, contact_public: "contact@club.example" })).toHaveProperty("proposition.contact_public", "contact@club.example");
    expect(read({ ...PROPOSITION, contact_public: "voir Facebook" })).toEqual({ erreurs: ["contact_public"] });
  });

  it("sends a business or a public body to the guide before anything else: the form is for non-profit associations", () => {
    expect(read({ ...PROPOSITION, vous_etes: "commerce", email: "" })).toEqual({ erreurs: ["hors_perimetre"] });
    expect(read({ ...PROPOSITION, vous_etes: "public" })).toEqual({ erreurs: ["hors_perimetre"] });
    expect(read({ ...PROPOSITION, vous_etes: "particulier" })).toEqual({ erreurs: ["vous_etes"] });
  });

  it("blanks a phone number or an address in what is published, never in the author's e-mail", () => {
    const r = read({ ...PROPOSITION, description: "Inscriptions au 0692 12 34 56 ou à jean@example.org." });
    expect(r).toHaveProperty("proposition.description", "Inscriptions au [numéro retiré] ou à [courriel retiré].");
    expect(r).toHaveProperty("proposition.email", "club@example.org");
  });

  it("reads a link given, and refuses one without its organisation's say", () => {
    const f = new URLSearchParams({ nom: "Club de volley de Saint-Paul", commune: "Saint-Paul", lien: "https://calendar.google.com/calendar/ical/x/public/basic.ics", contact: "contact@club.example", agit: "oui" });
    expect(propositions.lireLien(f, formulaires.COMMUNES, "/associations")).toEqual({
      lien: { nom: "Club de volley de Saint-Paul", commune: "Saint-Paul", lien: "https://calendar.google.com/calendar/ical/x/public/basic.ics", contact: "contact@club.example", page: "/associations" },
    });
    f.delete("agit");
    f.set("lien", "calendar.google.com");
    expect(propositions.lireLien(f, formulaires.COMMUNES, "/associations")).toEqual({ erreurs: ["lien", "agit"] });
  });
});

describe("what is kept, and for how long (scripts/propositions.sql)", () => {
  const proposition = () => (read(PROPOSITION) as { proposition: propositions.Proposition }).proposition;

  it("keeps a proposal waiting for its confirmation, its secret only as a hash, and mails the link to its author", async () => {
    expect(await propositions.enregistrerProposition(proposition(), "203.0.113.7", "https://rundata.re/associations/proposition/", NOW)).toBe("ok");
    const [row] = rows("SELECT * FROM propositions");
    expect(row).toMatchObject({ etat: "a_confirmer", titre: "Tournoi de pétanque du club", date: "2026-11-07", derniere_date: "2026-11-07", email: "club@example.org", repete: null });
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("club@example.org");
    const secret = /https:\/\/rundata\.re\/associations\/proposition\/([\w-]{22})\n/.exec(sent[0].text)![1];
    expect(row.jeton).toBe(await propositions.empreinteJeton(secret));
    expect(row.jeton).not.toContain(secret);
    expect(sent[0].text).toContain("sur rundata.re\u00a0: «\u00a0Tournoi de pétanque du club\u00a0», le 07/11/2026 à 14:00, Boulodrome de Terre-Sainte (Saint-Pierre).");
    expect(sent[0].subject).toBe("Confirmez votre événement «\u00a0Tournoi de pétanque du club\u00a0» sur rundata.re");
    expect(sent[0].text).toContain("\nL'équipe rundata.re\nrundata.re · https://rundata.re/associations");
  });

  it("refuses a proposal it could not confirm: without a way to send, nothing is kept", async () => {
    plug(null);
    expect(await propositions.enregistrerProposition(proposition(), "203.0.113.7", "https://rundata.re/x/", NOW)).toBe("indisponible");
    expect(rows("SELECT * FROM propositions")).toHaveLength(0);
  });

  it("takes five proposals a day from one sender, then refuses; another sender still gets through", async () => {
    for (let i = 0; i < propositions.PROPOSITIONS_PAR_JOUR; i++) expect(await propositions.enregistrerProposition(proposition(), "203.0.113.7", "https://rundata.re/x/", later(i))).toBe("ok");
    expect(await propositions.enregistrerProposition(proposition(), "203.0.113.7", "https://rundata.re/x/", later(6))).toBe("limite");
    expect(await propositions.enregistrerProposition(proposition(), "198.51.100.2", "https://rundata.re/x/", later(6))).toBe("ok");
    expect(sent).toHaveLength(propositions.PROPOSITIONS_PAR_JOUR + 1);
  });

  it("forgets a proposal never confirmed after 48 hours, and the author's address 30 days after the event", async () => {
    await propositions.enregistrerProposition(proposition(), "203.0.113.7", "https://rundata.re/x/", NOW);
    await propositions.enregistrerProposition(proposition(), "203.0.113.7", "https://rundata.re/x/", NOW);
    db.exec("UPDATE propositions SET etat = 'publie', contact_public = 'contact@club.example' WHERE id = 2");
    // The next day, the senders' fingerprints are wiped.
    await propositions.enregistrerProposition(proposition(), "198.51.100.2", "https://rundata.re/x/", later(25));
    expect(rows("SELECT id, source IS NULL AS sans FROM propositions ORDER BY id")).toEqual([{ id: 1, sans: 1 }, { id: 2, sans: 1 }, { id: 3, sans: 0 }]);
    // Two days later, the first never confirmed is gone.
    await propositions.enregistrerProposition(proposition(), "198.51.100.2", "https://rundata.re/x/", later(49));
    expect(rows<{ id: number }>("SELECT id FROM propositions ORDER BY id").map((r) => r.id)).toEqual([2, 3, 4]);
    db.exec("UPDATE propositions SET etat = 'publie'");
    // 7 November + 30 days: on 7 December the address stays, on 8 December it goes.
    await propositions.enregistrerProposition(proposition(), "198.51.100.2", "https://rundata.re/x/", new Date("2026-12-07T06:00:00Z"));
    expect(rows("SELECT COUNT(*) AS n FROM propositions WHERE email IS NULL")).toEqual([{ n: 0 }]);
    await propositions.enregistrerProposition(proposition(), "198.51.100.2", "https://rundata.re/x/", new Date("2026-12-08T06:00:00Z"));
    expect(rows("SELECT id, email, contact_public FROM propositions WHERE id <= 4 ORDER BY id")).toEqual([2, 3, 4].map((id) => ({ id, email: null, contact_public: null })));
  });

  it("keeps a repeated event's address until 30 days after its last date", async () => {
    const p = { ...proposition(), repete: "semaine" as const, jusqu_au: "2027-01-20" };
    await propositions.enregistrerProposition(p, "203.0.113.7", "https://rundata.re/x/", NOW);
    db.exec("UPDATE propositions SET etat = 'publie'");
    await propositions.enregistrerProposition(proposition(), "198.51.100.2", "https://rundata.re/x/", new Date("2027-02-19T06:00:00Z"));
    expect(rows("SELECT derniere_date, email FROM propositions WHERE id = 1")).toEqual([{ derniere_date: "2027-01-20", email: "club@example.org" }]);
    expect(sent[0].text).toContain(", le 07/11/2026, chaque semaine jusqu'au 20/01/2027 à 14:00,");
  });

  it("takes five links a day from one sender", async () => {
    const l = { nom: "Club", commune: "Saint-Paul", lien: "https://club.example/agenda.ics", page: "/associations" };
    for (let i = 0; i < propositions.LIENS_PAR_JOUR; i++) expect(await propositions.enregistrerLien(l, "203.0.113.7", later(i))).toBe("ok");
    expect(await propositions.enregistrerLien(l, "203.0.113.7", later(6))).toBe("limite");
    expect(await propositions.enregistrerLien(l, "203.0.113.7", later(30))).toBe("ok");
    expect(rows("SELECT contact FROM liens")).toHaveLength(6);
  });
});

describe("the e-mail, through Cloudflare's binding", () => {
  it("sends from evenements@rundata.re, answers going to contact@, and logs a refusal by its code only", async () => {
    const calls: unknown[] = [];
    const ok = propositions.envoiCloudflare({ send: async (m) => (calls.push(m), { messageId: "x" }) });
    expect(await ok({ to: "club@example.org", subject: "S", text: "T" })).toBe(true);
    expect(calls).toEqual([{ from: { email: "evenements@rundata.re", name: "rundata.re" }, to: "club@example.org", subject: "S", text: "T", replyTo: "contact@rundata.re" }]);
    const logged: string[] = [];
    const error = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.join(" "));
    try {
      const refused = propositions.envoiCloudflare({ send: async () => { throw Object.assign(new Error("recipient club@example.org suppressed"), { code: "E_RECIPIENT_SUPPRESSED" }); } });
      expect(await refused({ to: "club@example.org", subject: "S", text: "T" })).toBe(false);
    } finally {
      console.error = error;
    }
    expect(logged).toEqual(["propositions : e-mail refusé E_RECIPIENT_SUPPRESSED"]);
  });
});

describe("the forms on the site (web/propositions.ts)", () => {
  const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
    handle(new Request(`https://rundata.re${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields).toString() }), new Cache());
  const human = () => formulaires.configure(undefined, async (token) => token === "jeton-turnstile");

  it("count a Turnstile token only if Cloudflare made it for this site and this form", async () => {
    const answers: Record<string, unknown>[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async () => Response.json(answers.shift())) as typeof fetch;
    const warn = console.warn;
    console.warn = () => {};
    try {
      formulaires.configure("secret");
      const f = new URLSearchParams({ "cf-turnstile-response": "jeton" });
      const attendu = { hostname: "rundata.re", action: "proposer" } as const;
      answers.push({ success: true, hostname: "rundata.re", action: "proposer" });
      expect(await formulaires.human(f, "203.0.113.7", attendu)).toBe(true);
      answers.push({ success: true, hostname: "autre-site.example", action: "proposer" });
      expect(await formulaires.human(f, "203.0.113.7", attendu)).toBe(false);
      answers.push({ success: true, hostname: "rundata.re", action: "lien" });
      expect(await formulaires.human(f, "203.0.113.7", attendu)).toBe(false);
      answers.push({ success: false, hostname: "rundata.re", action: "proposer" });
      expect(await formulaires.human(f, "203.0.113.7", attendu)).toBe(false);
    } finally {
      globalThis.fetch = real;
      console.warn = warn;
      formulaires.configure(undefined);
    }
    // Each form tells Cloudflare which it is.
    expect(formulaires.widget("lien")).toContain('data-action="lien"');
  });

  it("are out, and answer nothing while the space is closed", async () => {
    expect(formulaires.ASSOCIATIONS_EN_LIGNE).toBe(true);
    expect((await handle(new Request("https://rundata.re/associations/proposer", { headers: { accept: "text/html" } }), new Cache())).status).toBe(404);
    expect((await post("/associations/lien", { nom: "Club" })).status).toBe(404);
  });

  it("shows the proposal's form without a script, every field labelled, the consent and the e-mail's use said", async () => {
    formulaires.ouvrir(true);
    const r = await handle(new Request("https://rundata.re/associations/proposer", { headers: { accept: "text/html" } }), new Cache());
    expect(r.status).toBe(200);
    const html = plain(await r.text());
    expect(html).toContain('<form class="card fo" method="post" action="/associations/proposer"');
    for (const name of ["vous_etes", "titre", "date", "debut", "fin", "repete", "jusqu_au", "commune", "lieu", "organisateur", "description", "prix", "gratuit", "lien", "email", "email_public", "contact_public", "accord", "site_web"]) expect(html).toContain(`name="${name}"`);
    for (const [, id] of html.matchAll(/<input id="(p-[a-z]+)"/g)) expect(html).toContain(`for="${id}"`);
    expect(html).toContain("Jusqu'au (3 mois au plus)");
    expect(html).toContain("J'agis pour cette association, cet événement est ouvert au public, et je le publie sous Licence Ouverte 2.0 : tout le monde pourra le réutiliser librement, en citant l'association.");
    expect(html).toContain("Il n'est publié que si vous le demandez, et il est effacé 30 jours après la dernière date de l'événement, comme le contact public.");
    // A form itself: no feedback form below it, where an event could be typed by mistake; the WhatsApp button stays.
    expect(html).not.toContain('action="/avis"');
    expect(html).toContain("Partager sur WhatsApp");
    expect(html).toContain('<span class="aide bloc">Non publié, sauf si vous le choisissez plus bas.');
    expect(html.match(/<option>Saint-Pierre<\/option>/g)).toHaveLength(1);
    // Cloudflare's check, its script on this page only.
    expect(html).toContain('<div class="cf-turnstile" data-sitekey="0x4AAAAAAFlHv_IRLDHVZqlo"');
    expect(html.match(/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/g)).toHaveLength(1);
  });

  it("gives the form back with what was typed and the fields to correct", async () => {
    formulaires.ouvrir(true);
    human();
    const r = await post("/associations/proposer", { ...PROPOSITION, email: "pas-une-adresse", titre: "Kermesse <école>" }, { origin: "https://rundata.re" });
    expect(r.status).toBe(422);
    const html = await r.text();
    expect(html).toContain('value="Kermesse &lt;école&gt;"');
    expect(html).toMatch(/name="email" type="email" value="pas-une-adresse"[^>]*aria-invalid="true" aria-describedby="faux-email"/);
    expect(html).toContain('<p class="faux" id="faux-email">');
    expect(html).not.toContain('id="faux-titre"');
    expect(rows("SELECT * FROM propositions")).toHaveLength(0);
  });

  it("turns a business away politely, keeping nothing", async () => {
    formulaires.ouvrir(true);
    human();
    const r = await post("/associations/proposer", { ...PROPOSITION, vous_etes: "commerce", "cf-turnstile-response": "jeton-turnstile" }, { origin: "https://rundata.re" });
    expect(r.status).toBe(200);
    expect(plain(await r.text())).toContain("Pour l'instant, ce formulaire est réservé aux associations à but non lucratif. Pour publier vos événements vous-même, en flux ouvert, suivez le guide : <a href=\"/publier\">rundata.re/publier</a>.");
    expect(rows("SELECT * FROM propositions")).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("keeps a proposal only past Turnstile, then says to check the mailbox", async () => {
    formulaires.ouvrir(true);
    human();
    const robot = await post("/associations/proposer", PROPOSITION, { origin: "https://rundata.re" });
    expect(robot.status).toBe(503);
    expect(rows("SELECT * FROM propositions")).toHaveLength(0);
    const r = await post("/associations/proposer", { ...PROPOSITION, "cf-turnstile-response": "jeton-turnstile" }, { origin: "https://rundata.re", "cf-connecting-ip": "203.0.113.7" });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Vérifiez votre boîte e-mail");
    expect(rows("SELECT etat FROM propositions")).toEqual([{ etat: "a_confirmer" }]);
    expect(sent[0].text).toContain("https://rundata.re/associations/proposition/");
  });

  it("lets nothing through without Turnstile's key, from another site, or from the hidden field", async () => {
    formulaires.ouvrir(true);
    expect((await post("/associations/proposer", { ...PROPOSITION, "cf-turnstile-response": "jeton-turnstile" })).status).toBe(503);
    human();
    expect((await post("/associations/proposer", { ...PROPOSITION, "cf-turnstile-response": "jeton-turnstile" }, { origin: "https://evil.example" })).status).toBe(403);
    const bot = await post("/associations/proposer", { ...PROPOSITION, "cf-turnstile-response": "jeton-turnstile", site_web: "http://spam.example" });
    expect(await bot.text()).toContain("Vérifiez votre boîte e-mail");
    expect(rows("SELECT * FROM propositions")).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("keeps a link and sends the browser back to its page, never elsewhere", async () => {
    formulaires.ouvrir(true);
    human();
    const fields = { nom: "Club de volley", commune: "Saint-Paul", lien: "https://club.example/agenda.ics", agit: "oui", page: "/publier", "cf-turnstile-response": "jeton-turnstile" };
    const r = await post("/associations/lien", fields, { origin: "https://rundata.re" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("https://rundata.re/publier#lien-merci");
    expect(rows("SELECT nom, commune, lien, contact, page FROM liens")).toEqual([{ nom: "Club de volley", commune: "Saint-Paul", lien: "https://club.example/agenda.ics", contact: null, page: "/publier" }]);
    expect((await post("/associations/lien", { ...fields, agit: "" })).headers.get("location")).toBe("https://rundata.re/publier#lien-erreur");
    expect((await post("/associations/lien", { ...fields, page: "//evil.example/x" })).headers.get("location")).toBe("https://rundata.re/associations#lien-merci");
    expect((await handle(new Request("https://rundata.re/associations/lien"), new Cache())).status).toBe(405);
  });

  it("shows the link form's outcome by CSS alone", () => {
    const html = plain(formulaires.lienForm("/associations"));
    for (const id of ["lien-merci", "lien-limite", "lien-erreur"]) expect(html).toContain(`id="${id}"`);
    expect(FORMS_CSS).toContain(".fo .msg:target");
    expect(html).toContain("Merci. Nous vérifions que votre lien se lit bien ; vos événements apparaissent ensuite sur rundata.re, en général sous 48 h.");
  });
});

/** A proposal kept through the form's path; its secret, as e-mailed. */
async function propose(fields: Record<string, string> = {}, now = NOW): Promise<string> {
  const r = read({ ...PROPOSITION, ...fields }, now) as { proposition: propositions.Proposition };
  expect(await propositions.enregistrerProposition(r.proposition, "203.0.113.7", "https://rundata.re/associations/proposition/", now)).toBe("ok");
  return /\/associations\/proposition\/([\w-]{22})\n/.exec(sent.at(-1)!.text)![1];
}
const publish = () => db.exec("UPDATE propositions SET etat = 'publie' WHERE etat = 'a_moderer'");
const etat = () => rows<{ etat: string }>("SELECT etat FROM propositions ORDER BY id").map((r) => r.etat);

describe("the secret link: what its author can change (src/propositions.ts)", () => {
  it("finds the proposal by its secret only, and confirms it once, into the moderation", async () => {
    const secret = await propose();
    expect(await propositions.parJeton("x".repeat(22))).toBeUndefined();
    expect(await propositions.parJeton("pas un secret")).toBeUndefined();
    const l = await propositions.parJeton(secret);
    expect(l).toMatchObject({ etat: "a_confirmer", titre: "Tournoi de pétanque du club" });
    expect(l).not.toHaveProperty("jeton");
    expect(l).not.toHaveProperty("source");
    expect(await propositions.agir(secret, { kind: "confirmer" }, later(1))).toBe(true);
    expect(await propositions.agir(secret, { kind: "confirmer" }, later(2))).toBe(false);
    expect(etat()).toEqual(["a_moderer"]);
    expect(await propositions.visibles(NOW)).toEqual([]);
  });

  it("withdraws a proposal not yet published, never shown; calls off a published one, shown « annulé »", async () => {
    const first = await propose();
    await propositions.agir(first, { kind: "confirmer" }, NOW);
    // Cancelling before the confirmation: nothing to call off yet.
    const second = await propose({ titre: "Loto du club" });
    expect(await propositions.agir(second, { kind: "annuler" }, NOW)).toBe(false);
    expect(await propositions.agir(first, { kind: "annuler" }, NOW)).toBe(true);
    expect(etat()).toEqual(["retire", "a_confirmer"]);
    expect(await propositions.visibles(NOW)).toEqual([]);
    const third = await propose({ titre: "Kermesse" });
    await propositions.agir(third, { kind: "confirmer" }, NOW);
    publish();
    expect(await propositions.agir(third, { kind: "annuler" }, NOW)).toBe(true);
    expect((await propositions.visibles(NOW)).map((l) => [l.titre, l.etat])).toEqual([["Kermesse", "annule"]]);
    // Called off is final.
    expect(await propositions.agir(third, { kind: "reporter", date: "2026-11-21" }, NOW)).toBe(false);
  });

  it("postpones to a day within the year, a repeated event becoming a single one", async () => {
    const secret = await propose({ repete: "semaine", jusqu_au: "2026-12-26" });
    await propositions.agir(secret, { kind: "confirmer" }, NOW);
    publish();
    expect(await propositions.agir(secret, { kind: "reporter", date: "2026-10-28" }, NOW)).toBe(false);
    expect(await propositions.agir(secret, { kind: "reporter", date: "2026-11-31" }, NOW)).toBe(false);
    expect(await propositions.agir(secret, { kind: "reporter", date: "2026-11-21" }, NOW)).toBe(true);
    expect(rows("SELECT etat, date, reporte_au, repete, jusqu_au, derniere_date FROM propositions")).toEqual([
      { etat: "reporte", date: "2026-11-07", reporte_au: "2026-11-21", repete: null, jusqu_au: null, derniere_date: "2026-11-21" },
    ]);
  });

  it("extends a repeated event up to three months from the day it is asked, never shortens it", async () => {
    const secret = await propose({ repete: "semaine", jusqu_au: "2026-12-26" });
    await propositions.agir(secret, { kind: "confirmer" }, NOW);
    publish();
    expect(await propositions.agir(secret, { kind: "prolonger", jusqu_au: "2026-12-12" }, NOW)).toBe(false);
    expect(await propositions.agir(secret, { kind: "prolonger", jusqu_au: "2027-01-30" }, NOW)).toBe(false);
    expect(await propositions.agir(secret, { kind: "prolonger", jusqu_au: "2027-01-29" }, NOW)).toBe(true);
    // A month later, three months from then.
    expect(await propositions.agir(secret, { kind: "prolonger", jusqu_au: "2027-02-27" }, later(24 * 30))).toBe(true);
    expect(rows("SELECT jusqu_au, derniere_date FROM propositions")).toEqual([{ jusqu_au: "2027-02-27", derniere_date: "2027-02-27" }]);
    // Not a single event.
    const single = await propose({ titre: "Loto" });
    await propositions.agir(single, { kind: "confirmer" }, NOW);
    expect(await propositions.agir(single, { kind: "prolonger", jusqu_au: "2026-12-01" }, NOW)).toBe(false);
  });

  it("removes the public contact at once; keeps a correction aside for the moderation, the published version shown", async () => {
    const secret = await propose({ contact_public: "0262 12 34 56" });
    await propositions.agir(secret, { kind: "confirmer" }, NOW);
    publish();
    expect((await propositions.visibles(NOW))[0].contact_public).toBe("0262 12 34 56");
    expect(await propositions.agir(secret, { kind: "retirer_contact" }, NOW)).toBe(true);
    expect((await propositions.visibles(NOW))[0].contact_public).toBeNull();
    const fixed = propositions.lireProposition(new URLSearchParams({ ...PROPOSITION, titre: "Grand tournoi de pétanque", email: "", accord: "", vous_etes: "" }), formulaires.COMMUNES, NOW, { email: "club@example.org" });
    expect(fixed).toHaveProperty("proposition.titre", "Grand tournoi de pétanque");
    expect(await propositions.agir(secret, { kind: "corriger", p: (fixed as { proposition: propositions.Proposition }).proposition }, NOW)).toBe(true);
    const [row] = rows<{ etat: string; titre: string; email: string; correction: string }>("SELECT etat, titre, email, correction FROM propositions");
    expect(row).toMatchObject({ etat: "publie", titre: "Tournoi de pétanque du club", email: "club@example.org" });
    expect(JSON.parse(row.correction)).toMatchObject({ titre: "Grand tournoi de pétanque", derniere_date: "2026-11-07" });
    expect(row.correction).not.toContain("club@example.org");
    expect((await propositions.visibles(NOW)).map((l) => l.titre)).toEqual(["Tournoi de pétanque du club"]);
    // Calling off drops the correction waiting: nothing left to read.
    expect(await propositions.agir(secret, { kind: "annuler" }, NOW)).toBe(true);
    expect(rows("SELECT etat, correction FROM propositions")).toEqual([{ etat: "annule", correction: null }]);
  });

  it("changes a proposal not published yet in place, still waiting for the moderation", async () => {
    const secret = await propose();
    await propositions.agir(secret, { kind: "confirmer" }, NOW);
    const fixed = read({ ...PROPOSITION, titre: "Grand tournoi" }) as { proposition: propositions.Proposition };
    expect(await propositions.agir(secret, { kind: "corriger", p: fixed.proposition }, NOW)).toBe(true);
    expect(rows("SELECT etat, titre, correction FROM propositions")).toEqual([{ etat: "a_moderer", titre: "Grand tournoi", correction: null }]);
  });

  it("changes nothing once the event's last date is past", async () => {
    const secret = await propose();
    await propositions.agir(secret, { kind: "confirmer" }, NOW);
    publish();
    const after = new Date("2026-11-08T06:00:00Z");
    expect(await propositions.agir(secret, { kind: "annuler" }, after)).toBe(false);
    expect(await propositions.agir(secret, { kind: "reporter", date: "2026-11-21" }, after)).toBe(false);
    expect(await propositions.visibles(after)).toEqual([]);
  });

  it("forgets on time without a new proposal: the daily purge runs the trigger's deletions", async () => {
    const secret = await propose();
    await propose({ titre: "Jamais confirmé" });
    await propositions.agir(secret, { kind: "confirmer" }, NOW);
    publish();
    // 40 days after the event: the unconfirmed one gone, the address and fingerprint wiped, the event kept.
    expect(await propositions.purger(new Date("2026-12-17T06:00:00Z"))).toBeGreaterThan(0);
    expect(rows("SELECT titre, email, source FROM propositions")).toEqual([{ titre: "Tournoi de pétanque du club", email: null, source: null }]);
    // A year after its last date (07/11/2026), not after its proposal.
    expect(await propositions.purger(new Date("2027-11-06T06:00:00Z"))).toBe(0);
    expect(await propositions.purger(new Date("2027-11-08T06:00:00Z"))).toBe(1);
    expect(rows("SELECT * FROM propositions")).toEqual([]);
  });

  it("keeps a repeated event extended over a year while it goes on", async () => {
    const secret = await propose({ repete: "semaine", jusqu_au: "2027-01-28" });
    await propositions.agir(secret, { kind: "confirmer" }, NOW);
    publish();
    let now = NOW;
    for (let i = 0; i < 5; i++) {
      now = new Date(now.getTime() + 85 * 86400_000);
      expect(await propositions.agir(secret, { kind: "prolonger", jusqu_au: propositions.addMonths(new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10), 3) }, now)).toBe(true);
    }
    // More than a year after its proposal, through a new proposal's trigger and the daily purge.
    await propose({ titre: "Autre", date: new Date(now.getTime() + 10 * 86400_000).toISOString().slice(0, 10) }, now);
    await propositions.purger(now);
    expect(rows("SELECT titre FROM propositions ORDER BY id")).toEqual([{ titre: "Tournoi de pétanque du club" }, { titre: "Autre" }]);
  });
});

describe("the published proposals as an agenda (providers/agenda-propositions.ts)", () => {
  const ligne = (over: Partial<propositions.Ligne> = {}): propositions.Ligne => ({
    id: 3, t: Date.parse("2026-10-25T08:00:00Z") / 1000, etat: "publie", titre: "Soirée dansante", date: "2026-11-07", debut: "20:00", fin: "02:00",
    repete: null, jusqu_au: null, commune: "Saint-Paul", lieu: "Salle polyvalente", organisateur: "Association Lèv la tèt", description: "Bal maloya.",
    prix: "5 €", lien: null, email: "x@example.org", contact_public: null, derniere_date: "2026-11-07", motif: null, reporte_au: null, ...over,
  });

  it("tells each occurrence, an end past midnight on the next day, the author's address never", async () => {
    const { evenement } = await import("../src/providers/agenda-propositions.js");
    const e = evenement(ligne());
    expect(e).toMatchObject({ id: "proposition-3", publie_par: "Association Lèv la tèt", lien: "", seances: [{ debut: "2026-11-07T20:00", fin: "2026-11-08T02:00" }], propose: { le: "2026-10-25" } });
    expect(JSON.stringify(e)).not.toContain("x@example.org");
    const weekly = evenement(ligne({ repete: "semaine", jusqu_au: "2026-11-28", fin: null }));
    expect(weekly.seances.map((s) => s.debut)).toEqual(["2026-11-07T20:00", "2026-11-14T20:00", "2026-11-21T20:00", "2026-11-28T20:00"]);
    const monthly = evenement(ligne({ date: "2026-10-31", repete: "mois", jusqu_au: "2027-01-31", fin: null }));
    expect(monthly.seances.map((s) => s.debut.slice(0, 10))).toEqual(["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31"]);
    expect(evenement(ligne({ etat: "reporte", reporte_au: "2026-11-21" }))).toMatchObject({ statut: "reporté", reporte_au: "2026-11-21", seances: [{ debut: "2026-11-21T20:00" }] });
    expect(evenement(ligne({ etat: "annule", contact_public: "0262 00 00 00" }))).toMatchObject({ statut: "annulé", propose: { contact: "0262 00 00 00" } });
  });

  it("says « Proposé par l'organisateur sur rundata.re » with the day, never when it was read, and the contact only if chosen", async () => {
    const { evenement } = await import("../src/providers/agenda-propositions.js");
    const { eventRow } = await import("../src/tools/agenda.js");
    const e = { ...evenement(ligne({ contact_public: "contact@lev.re" })), lu_le: "2026-10-29T10:00" };
    const row = eventRow(e, e.seances);
    expect(row).toMatchObject({ publie_par: "Association Lèv la tèt", propose: "Proposé par l'organisateur sur rundata.re le 25/10/2026", contact: "contact@lev.re", lu_le: undefined, lien: undefined });
    expect(JSON.stringify(row)).not.toMatch(/vérifié/i);
    expect(eventRow(evenement(ligne()), evenement(ligne()).seances).contact).toBeUndefined();
  });

  it("gives search engines the association as organiser, and its price", async () => {
    const { evenement } = await import("../src/providers/agenda-propositions.js");
    const { eventRow } = await import("../src/tools/agenda.js");
    const { agendaEvents } = await import("../src/web/domains.js");
    const row = (l: propositions.Ligne) => eventRow(evenement(l), evenement(l).seances);
    const [paid, free, other] = agendaEvents([row(ligne()), row(ligne({ prix: "gratuit" })), row(ligne({ prix: "5 € adultes, gratuit enfants" }))]) as Record<string, unknown>[];
    expect(paid).toMatchObject({ organizer: { "@type": "Organization", name: "Association Lèv la tèt" }, offers: { "@type": "Offer", price: 5, priceCurrency: "EUR" } });
    expect(free).toMatchObject({ offers: { price: 0, priceCurrency: "EUR" } });
    expect(other).toMatchObject({ offers: { description: "5 € adultes, gratuit enfants" } });
  });

  it("is read from the table once a quarter of an hour, counted as one read", async () => {
    const { PROPOSITIONS } = await import("../src/providers/agenda-propositions.js");
    const { AGENDAS, COVERED } = await import("../src/providers/agenda.js");
    expect(AGENDAS).toContain(PROPOSITIONS);
    expect(COVERED).not.toContain(undefined);
    const secret = await propose();
    await propositions.agir(secret, { kind: "confirmer" }, NOW);
    publish();
    const got = await PROPOSITIONS.load(new Cache(), NOW);
    expect(got.value.map((e) => e.titre)).toEqual(["Tournoi de pétanque du club"]);
  });
});

describe("the open feed (web/flux-associations.ts)", () => {
  async function published() {
    const a = await propose({ contact_public: "0262 12 34 56", description: "Tournoi en doublettes, ouvert à tous ; buvette, grillades." });
    const b = await propose({ titre: "Loto annulé", email_public: "oui" });
    for (const s of [a, b]) await propositions.agir(s, { kind: "confirmer" }, NOW);
    publish();
    await propositions.agir(b, { kind: "annuler" }, NOW);
    return propositions.visibles(NOW);
  }

  it("writes the licence in the JSON, the public contact only if chosen, the author's address never", async () => {
    const { jsonFeed } = await import("../src/web/flux-associations.js");
    const feed = jsonFeed(await published(), NOW) as { licence: { nom: string }; evenements: Record<string, unknown>[] };
    expect(feed.licence.nom).toBe("Licence Ouverte 2.0 (Etalab)");
    expect(feed.evenements[0]).toMatchObject({ titre: "Tournoi de pétanque du club", seances: [{ debut: "2026-11-07T14:00:00+04:00", fin: "2026-11-07T18:00:00+04:00" }], organisateur: "Pétanque club de Terre-Sainte", contact: "0262 12 34 56", propose_le: "2026-10-29" });
    // The author asked for their address as the public contact: shown as that, never as the author's.
    expect(feed.evenements[1]).toMatchObject({ statut: "annulé", contact: "club@example.org" });
    expect(Object.keys(feed.evenements[1])).not.toContain("email");
  });

  it("writes a calendar any app reads: UTC times, escaped text, folded lines, a call-off said", async () => {
    const { icsFeed } = await import("../src/web/flux-associations.js");
    const ics = icsFeed(await published(), NOW);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261107T100000Z\r\nDTEND:20261107T140000Z");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SUMMARY:ANNULÉ\u00a0: Loto annulé");
    expect(ics.replace(/\r\n /g, "")).toContain("buvette\\, grillades.");
    expect(ics.replace(/\r\n /g, "")).toContain("Licence Ouverte 2.0 (Etalab)");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("answers at its stable address once the page is out, for anyone", async () => {
    await published();
    expect((await handle(new Request("https://rundata.re/associations/evenements.json"), new Cache())).status).toBe(404);
    formulaires.ouvrir(true);
    const r = await handle(new Request("https://rundata.re/associations/evenements.json"), new Cache());
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await r.json()) as { evenements: unknown[] }).evenements).toHaveLength(2);
    const ics = await handle(new Request("https://rundata.re/associations/evenements.ics"), new Cache());
    expect(ics.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
  });
});

describe("the secret link's page (web/propositions.ts)", () => {
  const page = (secret: string, query = "") => handle(new Request(`https://rundata.re/associations/proposition/${secret}${query}`, { headers: { accept: "text/html" } }), new Cache());
  const act = (secret: string, fields: Record<string, string>, cache = new Cache(), origin = "https://rundata.re") =>
    handle(new Request(`https://rundata.re/associations/proposition/${secret}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: new URLSearchParams(fields).toString() }), cache);

  it("changes nothing when opened (a mail scanner opens links), keeps the secret out of the canonical address and other sites", async () => {
    formulaires.ouvrir(true);
    const secret = await propose();
    const r = await page(secret);
    expect(r.status).toBe(200);
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("x-robots-tag")).toBe("noindex");
    const html = plain(await r.text());
    expect(etat()).toEqual(["a_confirmer"]);
    expect(html).toContain('<input type="hidden" name="action" value="confirmer"><button type="submit">Confirmer l\'événement</button>');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toMatch(new RegExp(`(canonical|og:url)[^>]*${secret}`));
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    // Nothing to share: a volunteer would think they share their link.
    expect(html).not.toContain("Partager sur WhatsApp");
    expect(html).toContain('<span class="badge ambre">À confirmer</span> le 07/11/2026, de 14:00 à 18:00, Boulodrome de Terre-Sainte (Saint-Pierre).');
    expect((await page("x".repeat(22))).status).toBe(404);
  });

  it("confirms by POST, then says so on the page it sends back to", async () => {
    formulaires.ouvrir(true);
    const secret = await propose();
    expect((await act(secret, { action: "confirmer" }, new Cache(), "https://ailleurs.example")).status).toBe(403);
    const r = await act(secret, { action: "confirmer" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`https://rundata.re/associations/proposition/${secret}?fait=confirmer`);
    expect(etat()).toEqual(["a_moderer"]);
    const html = plain(await (await page(secret, "?fait=confirmer")).text());
    expect(html).toContain("Merci, l'événement est confirmé.");
    expect(html).toContain("En cours de relecture");
    expect(html).toContain("Retirer la proposition");
    expect(html).toContain("Corriger l'événement");
    expect(html).not.toContain('name="email"');
  });

  it("calls off only when its box is ticked, and writes the agendas' copy at once", async () => {
    formulaires.ouvrir(true);
    const secret = await propose();
    await propositions.agir(secret, { kind: "confirmer" }, NOW);
    publish();
    expect((await act(secret, { action: "annuler" })).status).toBe(409);
    const cache = new Cache();
    expect((await act(secret, { action: "annuler", sur: "oui" }, cache)).status).toBe(303);
    const { BUNDLE, BUNDLE_SYNC_SECONDS } = await import("../src/providers/agenda.js");
    const copy = (await cache.bundle(BUNDLE, BUNDLE_SYNC_SECONDS)).peek("agenda:propositions");
    expect((copy!.value as { statut?: string }[])[0].statut).toBe("annulé");
  });

  it("gives a correction back with its mistakes, and sends a right one to the moderation", async () => {
    formulaires.ouvrir(true);
    const secret = await propose();
    await propositions.agir(secret, { kind: "confirmer" }, NOW);
    publish();
    const { email: _e, accord: _a, vous_etes: _v, ...fields } = PROPOSITION;
    const wrong = await act(secret, { ...fields, action: "corriger", date: "2026-10-01" });
    expect(wrong.status).toBe(422);
    expect(await wrong.text()).toContain('id="faux-date"');
    expect((await act(secret, { ...fields, action: "corriger", titre: "Grand tournoi" })).status).toBe(303);
    expect(rows("SELECT etat, titre, email FROM propositions")).toEqual([{ etat: "publie", titre: "Tournoi de pétanque du club", email: "club@example.org" }]);
    const html = plain(await (await page(secret, "?fait=corriger")).text());
    expect(html).toContain('<span class="badge vert">Publié</span>');
    expect(html).toContain("Votre correction attend la relecture, en général sous 24 heures ; en attendant, la version ci-dessus reste affichée.");
    expect(html).toContain("En attendant, la version actuelle reste affichée.");
    // The form shows the correction waiting, to go on from it.
    expect(html).toContain('name="titre" value="Grand tournoi"');
  });
});

describe("the clubs' and associations' space (web/associations.ts)", () => {
  const get = (path: string) => handle(new Request(`https://rundata.re${path}`, { headers: { accept: "text/html" } }), new Cache());
  const ligne = (id: number, organisateur: string, date = "2026-11-07"): propositions.Ligne => ({
    id, t: Date.parse("2026-10-25T08:00:00Z") / 1000, etat: "publie", titre: `Tournoi ${id}`, date, debut: "14:00", fin: null, repete: null, jusqu_au: null,
    commune: "Saint-Pierre", lieu: "Stade", organisateur, description: "Ouvert à tous.", prix: "Gratuit", lien: null, email: "x@example.org",
    contact_public: null, derniere_date: date, motif: null, reporte_au: null,
  });
  /** A cache whose agendas' copy holds these proposed events only. */
  const copie = async (lignes: propositions.Ligne[]) => {
    const { evenement } = await import("../src/providers/agenda-propositions.js");
    const value = lignes.map(evenement);
    return { bundle: async () => ({ peek: (k: string) => (k === "agenda:propositions" ? { value, ageMs: 0, fetchedAt: NOW.getTime() } : undefined) }) } as never;
  };

  it("answers at /associations, the short addresses sent there with their query, nothing while closed", async () => {
    for (const path of ["/associations", "/clubs", "/asso"]) expect((await get(path)).status).toBe(404);
    formulaires.ouvrir(true);
    const r = await get("/associations");
    expect(r.status).toBe(200);
    const html = plain(await r.text());
    expect(html).toContain("<h1>Espace clubs et associations</h1>");
    expect(html).toContain('href="/associations/proposer"');
    expect(html).toContain('<input type="hidden" name="page" value="/associations">');
    expect(html).toContain('href="/associations/evenements.ics"');
    expect(html).toContain('"@type":"HowTo"');
    expect(html).toMatch(/<meta property="og:image" content="https:\/\/rundata\.re\/og\/associations\.[0-9a-f]{10}\.png">/);
    // No figure before there are ten clubs; the empty list says what to do.
    expect(html).not.toContain("clubs et associations lus par rundata.re");
    expect(html).toContain("Les premiers événements de clubs et d'associations arrivent : ");
    expect(html).toContain("et la date à laquelle nous l'avons lu ou à laquelle vous l'avez proposé.");
    // One WhatsApp button, the relay's; the feedback form stays.
    expect(html.match(/Partager sur WhatsApp/g)).toHaveLength(1);
    expect(html).not.toContain("Une info utile chaque matin");
    expect(html).toContain('action="/avis"');
    for (const path of ["/clubs?ref=affiche", "/asso/?ref=affiche"]) {
      const to = await get(path);
      expect(to.status).toBe(301);
      expect(to.headers.get("location")).toBe("https://rundata.re/associations?ref=affiche");
    }
  });

  it("proves with the coming events of clubs, and counts them from ten clubs on", async () => {
    const { preuve, associationsPage } = await import("../src/web/associations.js");
    const few = await preuve(await copie([ligne(1, "Club A"), ligne(2, "club a "), ligne(3, "Club B", "2026-12-20")]), NOW);
    // Two names (the same club written twice), one event beyond the two weeks.
    expect(few.clubs).toBe(2);
    expect(few.evenements).toBe(2);
    expect(plain(associationsPage("https://rundata.re", few))).not.toContain("lus par rundata.re");
    const ten = await preuve(await copie(Array.from({ length: 10 }, (_, i) => ligne(i + 1, `Club ${i + 1}`))), NOW);
    expect(ten.clubs).toBe(10);
    const html = plain(associationsPage("https://rundata.re", ten));
    expect(html).toContain("10 clubs et associations lus par rundata.re ; 10 de leurs événements dans les deux prochaines semaines.");
    expect(html).toContain("Tournoi 1");
  });

  it("finds the agendas the scheduled event alone reads in its own copies", async () => {
    const { preuve } = await import("../src/web/associations.js");
    const { PLANIFIES } = await import("../src/providers/agenda.js");
    const { evenement } = await import("../src/providers/agenda-propositions.js");
    const tournoi = { ...evenement(ligne(1, "Ligue réunionnaise de volley-ball")), id: "lrvb-1" };
    const cache = {
      bundle: async (name: string) => ({
        peek: (k: string) => (name === PLANIFIES && k === "agenda:lrvb" ? { value: [tournoi], ageMs: 0, fetchedAt: NOW.getTime() } : undefined),
      }),
    } as never;
    const p = await preuve(cache, NOW);
    expect(p.prochains.map((x) => x.e.publie_par)).toEqual(["Ligue réunionnaise de volley-ball"]);
  });

  it("counts no Sportsregions club while its calendar is not read, its copy kept or not; its card says « Pas lu »", async () => {
    const { preuve, associationsPage } = await import("../src/web/associations.js");
    const { PLANIFIES } = await import("../src/providers/agenda.js");
    const { evenement } = await import("../src/providers/agenda-propositions.js");
    const clubs = [{ ...evenement(ligne(1, "Badminton Club de Saint-Pierre")), id: "sportsregions:a" }];
    const cache = {
      bundle: async (name: string) => ({
        peek: (k: string) => (name === PLANIFIES && k === "agenda:sportsregions" ? { value: clubs, ageMs: 0, fetchedAt: NOW.getTime() } : undefined),
      }),
    } as never;
    const p = await preuve(cache, NOW);
    expect([p.clubs, p.prochains]).toEqual([0, []]);
    const html = plain(associationsPage("https://rundata.re", p));
    // With the sites not read: the form.
    expect(html).toContain("<h3>AssoConnect, Sportsregions, Wix, e-monsite, Google Sites</h3>");
    expect(html).not.toContain("Sportsregions (le site du club)");
    expect(html.match(/<span class="etat lu">Déjà lu<\/span>/g)).toHaveLength(3);
  });

  it("reads the proposed events from the table when the agendas' copy has none yet", async () => {
    const { preuve } = await import("../src/web/associations.js");
    const s = await propose();
    await propositions.agir(s, { kind: "confirmer" }, NOW);
    publish();
    const p = await preuve(new Cache(), NOW);
    expect(p.prochains.map((x) => x.e.titre)).toEqual(["Tournoi de pétanque du club"]);
    expect(p.clubs).toBe(1);
  });

  it("is linked from the footer, /publier, /a-propos, the sitemap and the form's breadcrumb, only once out", async () => {
    const closed = plain(await (await get("/confidentialite")).text());
    expect(closed).not.toContain('href="/associations"');
    expect(closed).not.toContain('id="associations-donnees"');
    expect(closed).toContain("<p>rundata.re ne demande ni compte, ni nom, ni adresse électronique. Le site");
    expect(plain(await (await get("/conditions")).text())).not.toContain('id="evenements-proposes"');
    expect(plain(await (await get("/publier")).text())).not.toContain('id="lien"');
    expect(plain(await (await get("/presse")).text())).not.toContain("Clubs et associations : comment");
    formulaires.ouvrir(true);
    // Under the dated press release, never inside it.
    const presse = plain(await (await get("/presse")).text());
    expect(presse).toContain('</article><p>Clubs et associations : comment ils publient leurs événements sur rundata.re, gratuitement et en données ouvertes, <a href="https://rundata.re/associations">rundata.re/associations</a></p></section>');
    const privacy = plain(await (await get("/confidentialite")).text());
    expect(privacy).toContain('<li><a href="/associations">Clubs et associations</a></li>');
    expect(privacy).toContain('<h2 id="associations-donnees">');
    expect(privacy).toContain("La vérification anti-robot (Cloudflare Turnstile) voit l'adresse au moment de l'envoi, sans que nous la gardions.");
    expect(privacy).toContain('Seuls les deux formulaires des clubs et associations demandent une adresse électronique (voir <a href="#associations-donnees">« Ce que les clubs et associations envoient »</a>).');
    expect(privacy).toContain("Pour consulter ou faire effacer ce que nous gardons, écrivez à <b>contact@rundata.re</b> : nous répondons sous un mois.");
    expect(privacy).not.toContain("Aucune donnée ne permet de vous identifier");
    const terms = plain(await (await get("/conditions")).text());
    expect(terms).toContain('<p id="evenements-proposes"><b>Événements proposés par les clubs et associations.</b> L\'association qui propose un événement en est responsable : ');
    expect(terms).toContain("La mention « Proposé par l'organisateur » signale que l'événement n'a pas été vérifié par rundata.re.");
    const publier = plain(await (await get("/publier")).text());
    expect(publier).toContain("Petit club, peu de temps ? Commencez par l'");
    expect(publier).toContain('<input type="hidden" name="page" value="/publier">');
    expect(publier.indexOf('id="lien"')).toBeLessThan(publier.indexOf('<section id="exemples"'));
    expect(plain(await (await get("/a-propos")).text())).toContain('href="/associations"');
    const map = await (await handle(new Request("https://rundata.re/sitemap.xml"), new Cache())).text();
    for (const loc of ["https://rundata.re/associations", "https://rundata.re/associations/proposer"]) expect(map).toContain(`<loc>${loc}</loc>`);
    const form = plain(await (await get("/associations/proposer")).text());
    expect(form).toContain('"position":2,"name":"Clubs et associations","item":"https://rundata.re/associations"');
    expect(form).toContain('href="/confidentialite#associations-donnees"');
  });

  it("says, under both forms' anti-robot check, that it keeps something in the browser, and where it is explained", async () => {
    expect(plain(await (await get("/confidentialite")).text())).not.toContain('href="#abus"');
    formulaires.ouvrir(true);
    const privacy = plain(await (await get("/confidentialite")).text());
    expect(privacy).toContain('<p id="abus"><b>Contre les abus</b>');
    expect(privacy).toContain('(voir <a href="#retours">« Les retours »</a>). La vérification anti-robot des deux formulaires des clubs et associations y garde aussi une donnée (voir <a href="#abus">« Contre les abus »</a>).');
    expect(privacy).toContain("C'est du stockage local du navigateur, pas un cookie.");
    const note = '<p class="note">La vérification anti-robot de Cloudflare garde une donnée dans votre navigateur (pas un cookie) : <a href="/confidentialite#abus">ce que c\'est</a>.</p>';
    // Right under the widget, on the event form and on the link form (/associations, /publier).
    for (const path of ["/associations/proposer", "/associations", "/publier"]) {
      const html = plain(await (await get(path)).text());
      expect(html.match(/<div class="cf-turnstile"[^>]*><\/div>\s*<p class="note">[^<]*<a href="\/confidentialite#abus">/g), path).toHaveLength(1);
      expect(html, path).toContain(note);
    }
  });
});
