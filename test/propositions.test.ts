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
  propositions.configure(async (sql, ...params) => Number(db.prepare(sql).run(...(params as (string | number | null)[])).changes), send ?? undefined);
}
/** A page's text as written here, before the site's French typography (web/typo.ts). */
const plain = (html: string) => html.replace(/’/g, "'").replace(/[\u00a0\u202f]/g, " ");
const rows = <T = Record<string, unknown>>(sql: string) => db.prepare(sql).all() as T[];

beforeEach(() => {
  sent = [];
  plug();
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

  it("answer nothing before the page goes out", async () => {
    expect(formulaires.ASSOCIATIONS_EN_LIGNE).toBe(false);
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
