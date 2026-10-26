/**
 * What the clubs and associations send through /associations (marketing's spec, espace-associations.md §3 and §4):
 * the link of their agenda (« Nous donner votre lien ») and the events they propose themselves (« Proposer un
 * événement »). One row each in the D1 tables `liens` and `propositions` (scripts/propositions.sql), next to the
 * feedback (src/avis.ts), read with a script by whoever moderates.
 *
 * A proposal waits for its author to click the link sent to the e-mail address given (never published), then for a
 * moderator; nothing shows before. The link carries a secret drawn here; only its hash is kept, so a copy of the table
 * cannot act for the author. The address is wiped 30 days after the event's last date, a proposal never confirmed
 * after 48 hours, the sender's fingerprint after a day (triggers in the SQL).
 *
 * Against a flood: the same fingerprint as the feedback (a salted hash of the address and the day), at most
 * PROPOSITIONS_PAR_JOUR proposals and LIENS_PAR_JOUR links a day from one sender, PROPOSITIONS_PAR_ADRESSE_JOUR to one
 * e-mail address, and a cap for everyone together; Turnstile in front (web/propositions.ts). The confirmation e-mail
 * holds nothing the sender wrote, only the day, the commune and the link: it cannot carry a stranger's message. The e-mail goes through `Envoi`, plugged by worker.ts once a way to send
 * is chosen: without one, a proposal is refused as « indisponible », never kept unconfirmable.
 */
import { empreinte, nettoie, type Run } from "./avis.js";

export const LIENS_PAR_JOUR = 5;
export const LIENS_EN_TOUT_JOUR = 50;
export const PROPOSITIONS_PAR_JOUR = 5;
/** To the same address, from anyone: the confirmation e-mails one inbox gets in a day. */
export const PROPOSITIONS_PAR_ADRESSE_JOUR = 3;
export const PROPOSITIONS_EN_TOUT_JOUR = 100;
/** How far ahead an event may be proposed, and how long a weekly or monthly one may repeat from the day it is sent. */
export const JOURS_AVANT_MAX = 365;
export const REPETITION_MOIS_MAX = 3;

export const NOM_MAX = 120;
export const LIEN_MAX = 500;
export const CONTACT_MAX = 120;
export const DESCRIPTION_MAX = 300;
export const PRIX_MAX = 60;
export const EMAIL_MAX = 254;

/** « Nous donner votre lien ». */
export interface Lien {
  nom: string;
  commune: string;
  lien: string;
  /** The organisation's e-mail or phone, to warn it when the link stops answering; never published. */
  contact?: string;
  /** The page of the form. */
  page: string;
}

export type Repetition = "semaine" | "mois";

/** « Proposer un événement », as checked by `lireProposition`. */
export interface Proposition {
  titre: string;
  /** Local day « 2026-11-14 », and times « 18:00 ». */
  date: string;
  debut: string;
  fin?: string;
  repete?: Repetition;
  /** The last day of a repeated event. */
  jusqu_au?: string;
  commune: string;
  lieu: string;
  organisateur: string;
  description: string;
  /** « gratuit », or the price as written (« 5 €, gratuit pour les enfants »). */
  prix: string;
  lien?: string;
  email: string;
  /**
   * The contact shown with the event, only when its author asks (the user, 25/10): the e-mail above, or another
   * (the club's address or phone). Wiped with the e-mail, 30 days after the event.
   */
  contact_public?: string;
}

let run: Run | undefined;

/** The send of one e-mail; true once accepted. */
export type Envoi = (m: { to: string; subject: string; text: string }) => Promise<boolean>;
let envoi: Envoi | undefined;

/** Who the confirmations come from; an answer goes to the address people already write to. */
export const EXPEDITEUR = { email: "evenements@rundata.re", name: "rundata.re" };
export const REPONSE = "contact@rundata.re";

/** The part of Cloudflare's send_email binding used here (Email Sending, Workers Paid). */
export interface EmailBinding {
  send(m: { from: { email: string; name?: string }; to: string; subject: string; text: string; replyTo?: string }): Promise<{ messageId: string }>;
}

/**
 * Sending through Cloudflare. A refusal is logged by its code only (« E_RECIPIENT_SUPPRESSED »): its message may name
 * the address, and the logs leave Cloudflare (Loki).
 */
export const envoiCloudflare = (binding: EmailBinding): Envoi => async (m) => {
  try {
    await binding.send({ from: EXPEDITEUR, to: m.to, subject: m.subject, text: m.text, replyTo: REPONSE });
    return true;
  } catch (err) {
    console.error("propositions : e-mail refusé", String((err as { code?: unknown })?.code ?? "sans code"));
    return false;
  }
};

/** Reads rows. */
export type All = <T>(sql: string, ...params: unknown[]) => Promise<T[]>;
let all: All | undefined;

/**
 * `db` and `select`: the D1 tables' doors (worker.ts, the feedback's database), to write and to read; `send`: how the
 * confirmation is sent.
 */
export function configure(db: Run | undefined, send?: Envoi, select?: All) {
  run = db;
  envoi = send;
  all = select;
}

export const enabled = () => !!run;

const localDay = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
/** The same day `n` months later, or the month's last when it has no such day (31/01 + 1 → 28/02). */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

/** A real day « 2026-11-14 » (not « 2026-02-30 »). */
const isDay = (s: string) => /^\d{4}-\d\d-\d\d$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** An http(s) address with a host, as given; undefined otherwise. */
export function httpLink(s: string | null | undefined): string | undefined {
  const t = (s ?? "").trim();
  if (!t || t.length > LIEN_MAX) return undefined;
  try {
    const u = new URL(t);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") && !u.username && !u.password ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** One e-mail address, in a plain spelling; undefined otherwise. */
export function emailOf(s: string | null | undefined): string | undefined {
  const t = (s ?? "").trim();
  return t.length <= EMAIL_MAX && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(t) ? t : undefined;
}

/** A phone number as people write it (« 0262 12 34 56 », « +262 692 12 34 56 »): 9 to 15 digits. */
const isPhone = (s: string) => /^\+?[\d\s.()-]{9,20}$/.test(s) && (s.match(/\d/g) ?? []).length >= 9 && (s.match(/\d/g) ?? []).length <= 15;

/** A text field: cleaned like the feedback (no control characters, no phone or address in it), on one line. */
const texte = (s: string | null, max: number) => {
  const raw = (s ?? "").replace(/\s+/g, " ");
  return raw.length <= max * 2 ? nettoie(raw, max) : undefined;
};

/** The fields of « Nous donner votre lien »; the names of the missing or wrong ones otherwise. */
export function lireLien(f: URLSearchParams, communes: readonly string[], page: string): { lien: Lien } | { erreurs: string[] } {
  const erreurs: string[] = [];
  const nom = texte(f.get("nom"), NOM_MAX);
  if (!nom || nom.length < 2) erreurs.push("nom");
  const commune = f.get("commune") ?? "";
  if (!communes.includes(commune)) erreurs.push("commune");
  const lien = httpLink(f.get("lien"));
  if (!lien) erreurs.push("lien");
  // The organisation's address or phone, kept as given: it is what the field asks for, and is never shown.
  const c = (f.get("contact") ?? "").replace(/\s+/g, " ").trim();
  if (c.length > CONTACT_MAX) erreurs.push("contact");
  if (f.get("agit") !== "oui") erreurs.push("agit");
  return erreurs.length ? { erreurs } : { lien: { nom: nom!, commune, lien: lien!, contact: c || undefined, page } };
}

/**
 * The fields of « Proposer un événement », checked against the day; the names of the missing or wrong ones otherwise.
 * A correction through the secret link (`correction`) keeps the author's address and asks again neither who they are
 * nor their consent.
 */
export function lireProposition(f: URLSearchParams, communes: readonly string[], now: Date, correction?: { email: string }): { proposition: Proposition } | { erreurs: string[] } {
  const erreurs: string[] = [];
  const today = localDay(now);
  const titre = texte(f.get("titre"), NOM_MAX);
  if (!titre || titre.length < 3) erreurs.push("titre");
  const date = (f.get("date") ?? "").trim();
  if (!isDay(date) || date < today || date > addDays(today, JOURS_AVANT_MAX)) erreurs.push("date");
  const debut = (f.get("debut") ?? "").trim();
  if (!isTime(debut)) erreurs.push("debut");
  const fin = (f.get("fin") ?? "").trim();
  if (fin && !isTime(fin)) erreurs.push("fin");
  const r = f.get("repete") ?? "";
  const repete = r === "semaine" || r === "mois" ? r : undefined;
  if (r && !repete) erreurs.push("repete");
  const jusqu = (f.get("jusqu_au") ?? "").trim();
  // A repeated event says until when, three months at most from today: then its author's address can be wiped.
  if (repete && (!isDay(jusqu) || jusqu <= date || jusqu > addMonths(today, REPETITION_MOIS_MAX))) erreurs.push("jusqu_au");
  const commune = f.get("commune") ?? "";
  if (!communes.includes(commune)) erreurs.push("commune");
  const lieu = texte(f.get("lieu"), NOM_MAX);
  if (!lieu || lieu.length < 2) erreurs.push("lieu");
  const organisateur = texte(f.get("organisateur"), NOM_MAX);
  if (!organisateur || organisateur.length < 2) erreurs.push("organisateur");
  const description = texte(f.get("description"), DESCRIPTION_MAX);
  if (!description || description.length < 3) erreurs.push("description");
  const prix = f.get("gratuit") === "oui" ? "gratuit" : texte(f.get("prix"), PRIX_MAX);
  if (!prix) erreurs.push("prix");
  const given = (f.get("lien") ?? "").trim();
  const lien = httpLink(given);
  if (given && !lien) erreurs.push("lien");
  const email = correction ? correction.email : emailOf(f.get("email"));
  if (!email) erreurs.push("email");
  // A contact to show with the event: another one given, or the e-mail when its box is ticked; none by default.
  const autre = (f.get("contact_public") ?? "").replace(/\s+/g, " ").trim();
  const contact_public = autre ? (autre.length <= CONTACT_MAX && (emailOf(autre) || isPhone(autre)) ? autre : undefined) : f.get("email_public") === "oui" ? email : undefined;
  if (autre && !contact_public) erreurs.push("contact_public");
  if (!correction && f.get("accord") !== "oui") erreurs.push("accord");
  // The form is for non-profit associations only, for now (the user, 25/10): a business or a public body is sent to
  // the guide before anything else.
  const qui = f.get("vous_etes");
  if (!correction && (qui === "commerce" || qui === "public")) return { erreurs: ["hors_perimetre"] };
  if (!correction && qui !== "association") erreurs.unshift("vous_etes");
  if (erreurs.length) return { erreurs };
  return {
    proposition: { titre: titre!, date, debut, fin: fin || undefined, repete, jusqu_au: repete ? jusqu : undefined, commune, lieu: lieu!, organisateur: organisateur!, description: description!, prix: prix!, lien, email: email!, contact_public },
  };
}

export type Issue = "ok" | "limite" | "indisponible";

const INSERT_LIEN = `INSERT INTO liens (t, nom, commune, lien, contact, page, source)
SELECT ?, ?, ?, ?, ?, ?, ?
WHERE (SELECT COUNT(*) FROM liens WHERE source = ? AND t > ?) < ? AND (SELECT COUNT(*) FROM liens WHERE t > ?) < ?`;

/** Writes one link, refused in the same statement when its sender, or everyone together, sent too many today. */
export async function enregistrerLien(l: Lien, adresse: string, now = new Date()): Promise<Issue> {
  if (!run) return "indisponible";
  const t = Math.floor(now.getTime() / 1000);
  const source = await empreinte(adresse, now);
  try {
    const changed = await run(INSERT_LIEN, t, l.nom, l.commune, l.lien, l.contact ?? null, l.page, source, source, t - 86400, LIENS_PAR_JOUR, t - 86400, LIENS_EN_TOUT_JOUR);
    return changed > 0 ? "ok" : "limite";
  } catch (err) {
    console.error("liens : écriture impossible", err instanceof Error ? err.message : String(err));
    return "indisponible";
  }
}

/** 128 random bits, written for an address (base64url). */
export function jetonNeuf(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What the table keeps of a secret: its SHA-256, in hex. */
export async function empreinteJeton(jeton: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jeton)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The day after which the author's address is no longer needed: the event's last date. */
export const derniereDate = (p: Pick<Proposition, "date" | "jusqu_au">) => p.jusqu_au ?? p.date;

const INSERT_PROPOSITION = `INSERT INTO propositions (t, etat, jeton, titre, date, debut, fin, repete, jusqu_au, commune, lieu, organisateur, description, prix, lien, email, contact_public, derniere_date, source)
SELECT ?, 'a_confirmer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
WHERE (SELECT COUNT(*) FROM propositions WHERE source = ? AND t > ?) < ? AND (SELECT COUNT(*) FROM propositions WHERE email = ? AND t > ?) < ?
  AND (SELECT COUNT(*) FROM propositions WHERE t > ?) < ?`;

/** « 2026-11-07 » → « 07/11/2026 ». */
const jour = (day: string) => day.split("-").reverse().join("/");

/**
 * The confirmation e-mail of a proposal: when and where, the link, and what happens next. Sent before anyone has shown
 * the address is theirs, it holds nothing the sender wrote (neither title nor place): the day and hour are checked, the
 * commune one of the list; the rest shows on the link's page.
 */
export function messageConfirmation(p: Proposition, lien: string): { subject: string; text: string } {
  return {
    subject: "Confirmez votre événement sur rundata.re",
    text: [
      "Bonjour,",
      "",
      `Un événement a été proposé sur rundata.re avec cette adresse, pour le ${jour(p.date)}${p.repete ? `, chaque ${p.repete} jusqu'au ${jour(p.jusqu_au!)},` : ""} à ${p.debut} à ${p.commune}.`,
      "",
      "Pour le voir et le confirmer, ouvrez ce lien\u00a0:",
      lien,
      "",
      "Nous le relisons ensuite, en général sous 24 heures, avant qu'il s'affiche. Gardez ce message\u00a0: le même lien vous permet ensuite de corriger l'événement, de l'annuler ou de le reporter.",
      "",
      "Ce n'est pas vous\u00a0? Ignorez ce message\u00a0: sans confirmation, la proposition et votre adresse sont effacées sous 48 heures.",
      "",
      "L'équipe rundata.re",
      "rundata.re · https://rundata.re/associations",
    ].join("\n"),
  };
}

/**
 * Writes one proposal waiting for its confirmation and sends the link to its author, `base` followed by the secret.
 * Refused in the same statement when its sender, its address, or everyone together, got too many today. A proposal whose e-mail
 * could not be sent stays unconfirmed, and goes after 48 hours like any other.
 */
export async function enregistrerProposition(p: Proposition, adresse: string, base: string, now = new Date()): Promise<Issue> {
  if (!run || !envoi) return "indisponible";
  const t = Math.floor(now.getTime() / 1000);
  const source = await empreinte(adresse, now);
  const jeton = jetonNeuf();
  try {
    const changed = await run(
      INSERT_PROPOSITION,
      t, await empreinteJeton(jeton), p.titre, p.date, p.debut, p.fin ?? null, p.repete ?? null, p.jusqu_au ?? null, p.commune, p.lieu, p.organisateur, p.description, p.prix, p.lien ?? null, p.email, p.contact_public ?? null, derniereDate(p), source,
      source, t - 86400, PROPOSITIONS_PAR_JOUR, p.email, t - 86400, PROPOSITIONS_PAR_ADRESSE_JOUR, t - 86400, PROPOSITIONS_EN_TOUT_JOUR,
    );
    if (changed === 0) return "limite";
  } catch (err) {
    console.error("propositions : écriture impossible", err instanceof Error ? err.message : String(err));
    return "indisponible";
  }
  try {
    const m = messageConfirmation(p, `${base}${jeton}`);
    return (await envoi({ to: p.email, ...m })) ? "ok" : "indisponible";
  } catch {
    // Never the error's text: it may hold the address.
    console.error("propositions : e-mail de confirmation impossible");
    return "indisponible";
  }
}

// ---------------------------------------------------------------- after the form: the secret link, the moderation

/** `retire`: withdrawn by its author before it was published, never shown. */
export type EtatProposition = "a_confirmer" | "a_moderer" | "publie" | "refuse" | "annule" | "reporte" | "retire";

/** A proposal as kept, without its secret, its sender's fingerprint nor, past its use, its author's address. */
export interface Ligne {
  id: number;
  t: number;
  etat: EtatProposition;
  titre: string;
  date: string;
  debut: string;
  fin: string | null;
  repete: Repetition | null;
  jusqu_au: string | null;
  commune: string;
  lieu: string;
  organisateur: string;
  description: string;
  prix: string;
  lien: string | null;
  email: string | null;
  contact_public: string | null;
  derniere_date: string;
  motif: string | null;
  reporte_au: string | null;
  /** A correction of the published event waiting for the moderation, as JSON (`Correction`); scripts/propositions-b.sql. */
  correction: string | null;
}

/** The fields of a correction kept aside while the published version stays shown. */
export type Correction = Omit<Proposition, "email"> & { derniere_date: string };

const COLONNES = "id, t, etat, titre, date, debut, fin, repete, jusqu_au, commune, lieu, organisateur, description, prix, lien, email, contact_public, derniere_date, motif, reporte_au, correction";
/** What the public sees: published, and called off or postponed after it, until its last date. */
export const VISIBLES: readonly EtatProposition[] = ["publie", "annule", "reporte"];

/** Whether the proposals can be read (the Worker with its database). */
export const lisible = () => !!all;

/** The proposal a secret leads to, if any. */
export async function parJeton(jeton: string): Promise<Ligne | undefined> {
  if (!all || !/^[\w-]{22}$/.test(jeton)) return undefined;
  return (await all<Ligne>(`SELECT ${COLONNES} FROM propositions WHERE jeton = ?`, await empreinteJeton(jeton)))[0];
}

/** The proposals the public sees, from today on; [] without the database. */
export async function visibles(now: Date): Promise<Ligne[]> {
  if (!all) return [];
  return all<Ligne>(`SELECT ${COLONNES} FROM propositions WHERE etat IN ('publie', 'annule', 'reporte') AND derniere_date >= ? ORDER BY coalesce(reporte_au, date), debut, id`, localDay(now));
}

/** Whether a proposal can still be changed by its author: not refused, not called off, its last date not past. */
export const modifiable = (l: Ligne, now: Date) => !["refuse", "annule", "retire"].includes(l.etat) && l.derniere_date >= localDay(now);

export type Action =
  | { kind: "confirmer" }
  | { kind: "annuler" }
  | { kind: "reporter"; date: string }
  | { kind: "prolonger"; jusqu_au: string }
  | { kind: "retirer_contact" }
  | { kind: "corriger"; p: Proposition };

/** Whether the change shows at once (the public sees it) rather than after the moderation. */
export const visibleAussitot = (a: Action) => a.kind !== "confirmer" && a.kind !== "corriger";

/**
 * One change by the author, in one statement that also checks the state it starts from: a confirmation sends the
 * proposal to the moderation; a correction of a published event waits for it aside, the published version shown
 * meanwhile (one not published yet is simply changed); calling off, postponing, extending a repeated event and
 * removing the public contact show at once, and drop a correction waiting (calling off, postponing) or its contact.
 * False when the state did not allow it (already confirmed, past, refused…).
 */
export async function agir(jeton: string, a: Action, now = new Date()): Promise<boolean> {
  if (!run || !/^[\w-]{22}$/.test(jeton)) return false;
  const t = Math.floor(now.getTime() / 1000);
  const h = await empreinteJeton(jeton);
  const today = localDay(now);
  const open = `jeton = ? AND derniere_date >= ? AND etat NOT IN ('refuse', 'annule', 'retire')`;
  let sql: string;
  let params: unknown[];
  switch (a.kind) {
    case "confirmer":
      sql = `UPDATE propositions SET etat = 'a_moderer', confirme_le = ? WHERE jeton = ? AND etat = 'a_confirmer'`;
      params = [t, h];
      break;
    case "annuler":
      // Not published yet: withdrawn, never shown; published: shown called off, so that no one goes for nothing.
      sql = `UPDATE propositions SET etat = CASE etat WHEN 'a_moderer' THEN 'retire' ELSE 'annule' END, correction = NULL, modifie_le = ? WHERE ${open} AND etat <> 'a_confirmer'`;
      params = [t, h, today];
      break;
    case "reporter":
      if (!isDay(a.date) || a.date < today || a.date > addDays(today, JOURS_AVANT_MAX)) return false;
      // A postponed repeated event becomes a single date: its new one.
      sql = `UPDATE propositions SET etat = CASE etat WHEN 'publie' THEN 'reporte' ELSE etat END, reporte_au = ?, repete = NULL, jusqu_au = NULL, derniere_date = ?, correction = NULL, modifie_le = ? WHERE ${open} AND etat IN ('publie', 'reporte', 'a_moderer')`;
      params = [a.date, a.date, t, h, today];
      break;
    case "prolonger":
      if (!isDay(a.jusqu_au) || a.jusqu_au > addMonths(today, REPETITION_MOIS_MAX)) return false;
      sql = `UPDATE propositions SET jusqu_au = ?, derniere_date = ?, modifie_le = ? WHERE ${open} AND repete IS NOT NULL AND jusqu_au < ?`;
      params = [a.jusqu_au, a.jusqu_au, t, h, today, a.jusqu_au];
      break;
    case "retirer_contact":
      sql = `UPDATE propositions SET contact_public = NULL, correction = json_remove(correction, '$.contact_public'), modifie_le = ? WHERE jeton = ? AND (contact_public IS NOT NULL OR json_extract(correction, '$.contact_public') IS NOT NULL)`;
      params = [t, h];
      break;
    case "corriger": {
      const p = a.p;
      const aside: Correction = { titre: p.titre, date: p.date, debut: p.debut, fin: p.fin, repete: p.repete, jusqu_au: p.jusqu_au, commune: p.commune, lieu: p.lieu, organisateur: p.organisateur, description: p.description, prix: p.prix, lien: p.lien, contact_public: p.contact_public, derniere_date: derniereDate(p) };
      try {
        if ((await run(`UPDATE propositions SET correction = ?, motif = NULL, modifie_le = ? WHERE ${open} AND etat IN ('publie', 'reporte')`, JSON.stringify(aside), t, h, today)) > 0) return true;
      } catch (err) {
        console.error("propositions : changement impossible", err instanceof Error ? err.message : String(err));
        return false;
      }
      sql = `UPDATE propositions SET etat = 'a_moderer', titre = ?, date = ?, debut = ?, fin = ?, repete = ?, jusqu_au = ?, commune = ?, lieu = ?, organisateur = ?, description = ?, prix = ?, lien = ?, contact_public = ?, derniere_date = ?, reporte_au = NULL, modifie_le = ? WHERE ${open} AND etat = 'a_moderer'`;
      params = [p.titre, p.date, p.debut, p.fin ?? null, p.repete ?? null, p.jusqu_au ?? null, p.commune, p.lieu, p.organisateur, p.description, p.prix, p.lien ?? null, p.contact_public ?? null, derniereDate(p), t, h, today];
      break;
    }
  }
  try {
    return (await run(sql, ...params)) > 0;
  } catch (err) {
    console.error("propositions : changement impossible", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * The deletions of the table's trigger (scripts/propositions-b.sql), for the days nothing is proposed: run once a day
 * by the scheduled event. Returns the rows changed.
 */
export async function purger(now = new Date()): Promise<number> {
  if (!run) return 0;
  const t = Math.floor(now.getTime() / 1000);
  const today = localDay(now);
  let n = 0;
  n += await run("UPDATE propositions SET source = NULL WHERE source IS NOT NULL AND t < ?", t - 86400);
  n += await run("DELETE FROM propositions WHERE etat = 'a_confirmer' AND t < ?", t - 172800);
  n += await run("UPDATE propositions SET email = NULL, contact_public = NULL, correction = NULL WHERE (email IS NOT NULL OR contact_public IS NOT NULL OR correction IS NOT NULL) AND derniere_date < ?", addDays(today, -30));
  // A year after the event's last date, not after its proposal: a weekly training extended stays while it goes on.
  n += await run("DELETE FROM propositions WHERE derniere_date < ?", addMonths(today, -12));
  n += await run("UPDATE liens SET source = NULL WHERE source IS NOT NULL AND t < ?", t - 86400);
  n += await run("DELETE FROM liens WHERE t < ?", t - 31536000);
  return n;
}
