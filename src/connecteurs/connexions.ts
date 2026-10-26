/**
 * The links of the associations to their platform (« Relier votre plateforme », web/connecteurs.ts), in the D1 table
 * `connexions` (scripts/connecteurs.sql), next to the proposals. The words of the e-mails are marketing's
 * (marketing/relier-plateforme-helloasso.md).
 *
 * 1. The association pastes its keys: the platform says which association they administer (`verifier`), and nothing
 *    is written yet. What it said, and the secret to keep, travel to the next screen sealed (`sceller`): encrypted
 *    with the Worker's key, for 30 minutes, never in the table.
 * 2. « C'est bien nous »: one row waiting for its confirmation (`enregistrer`), its secret encrypted for that row, and
 *    the link e-mailed; the link carries a secret drawn here, of which the table keeps only the hash.
 * 3. The link: confirmed (`confirmer`), the row waits for the moderation, once per association; a link of an
 *    association already linked replaces the old one at once, and the old address is told.
 * 4. Withdrawn through the same link (`retirer`): the row and its events are deleted (triggers), and an e-mail says so.
 *
 * Without the database, the e-mail or the encryption key, nothing is verified nor kept: « indisponible ».
 */
import { empreinte, type Run } from "../avis.js";
import { empreinteJeton, jetonNeuf, type All, type Envoi, type Issue } from "../propositions.js";
import * as chiffre from "./chiffre.js";
import { HELLOASSO } from "./helloasso.js";
import { AccesRefuse, reunionnais, type Organisation, type Plateforme } from "./plateforme.js";

export const PLATEFORMES: Readonly<Record<string, Plateforme>> = { [HELLOASSO.id]: HELLOASSO };

/** Links a sender may start in a day, and everyone together: enough for an association, not for a script. */
export const CONNEXIONS_PAR_JOUR = 5;
export const CONNEXIONS_EN_TOUT_JOUR = 50;
/** How long the verified keys wait for « C'est bien nous ». */
export const ATTENTE_SECONDES = 30 * 60;

let run: Run | undefined;
let all: All | undefined;
let envoi: Envoi | undefined;

/** The table's doors, to write and to read (worker.ts, the feedback's database), and how the e-mails go. */
export function configure(db: Run | undefined, select?: All, send?: Envoi) {
  run = db;
  all = select;
  envoi = send;
}

/** Whether a link can be made: the table, the e-mail and the encryption key. */
export const enabled = () => !!run && !!all && !!envoi && chiffre.enabled();

// ---------------------------------------------------------------- 1. the keys verified

/** What the platform said of the keys, carried to « C'est bien nous ». */
export interface Attente {
  plateforme: string;
  organisation: Organisation;
  /** The secret to keep (HelloAsso's refresh token), never the keys. */
  secret: string;
  email: string;
  /** When the keys were verified, Unix seconds. */
  t: number;
}

export type Verdict =
  | { issue: "ok"; attente: Attente; dejaReliee: boolean }
  /** refuse: the platform refused the keys; association: they administer no single association; hors_ile: its address is not in 974. */
  | { issue: "refuse" | "association" | "hors_ile" | "indisponible" };

/** The keys pasted for `plateforme`, asked to the platform. Nothing is written. */
export async function verifier(plateforme: string, cles: Record<string, string>, email: string, now = new Date()): Promise<Verdict> {
  const p = PLATEFORMES[plateforme];
  if (!p || !enabled()) return { issue: "indisponible" };
  let v;
  try {
    v = await p.verifier(cles);
  } catch (err) {
    if (err instanceof AccesRefuse) return { issue: err.etape === "association" ? "association" : "refuse" };
    // Never the error's whole text: the platform's answer stays out of the logs.
    console.error(`connecteurs : vérification ${plateforme} impossible`, err instanceof Error ? err.name : "erreur");
    return { issue: "indisponible" };
  }
  if (!reunionnais(v.organisation.code_postal)) return { issue: "hors_ile" };
  let dejaReliee = false;
  try {
    dejaReliee = (await all!<{ n: number }>(DEJA, plateforme, v.organisation.id))[0]?.n > 0;
  } catch {
    return { issue: "indisponible" };
  }
  return { issue: "ok", attente: { plateforme, organisation: v.organisation, secret: v.secret, email, t: Math.floor(now.getTime() / 1000) }, dejaReliee };
}

const DEJA = "SELECT COUNT(*) AS n FROM connexions WHERE plateforme = ? AND organisation = ? AND etat IN ('a_moderer', 'actif')";

/** The verification sealed for the page: « <nonce>.<encrypted> », opened only here, unchanged, within 30 minutes. */
export async function sceller(a: Attente): Promise<string> {
  const nonce = jetonNeuf();
  return `${nonce}.${await chiffre.chiffrer(JSON.stringify(a), chiffre.lien("attente", nonce, ""))}`;
}

/** The verification back; undefined when it was changed, comes from elsewhere, or waited too long. */
export async function ouvrir(scelle: string, now = new Date()): Promise<Attente | undefined> {
  const at = scelle.indexOf(".");
  if (at < 1 || scelle.length > 8192) return undefined;
  try {
    const a = JSON.parse(await chiffre.dechiffrer(scelle.slice(at + 1), chiffre.lien("attente", scelle.slice(0, at), ""))) as Attente;
    const age = Math.floor(now.getTime() / 1000) - a.t;
    return age >= 0 && age <= ATTENTE_SECONDES && PLATEFORMES[a.plateforme] ? a : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- 2. « C'est bien nous »

const INSERT = `INSERT INTO connexions (t, plateforme, organisation, nom, commune, code_postal, lien, secret, email, jeton, etat, source)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'a_confirmer', ?
WHERE (SELECT COUNT(*) FROM connexions WHERE source = ? AND t > ?) < ? AND (SELECT COUNT(*) FROM connexions WHERE t > ?) < ?`;

/**
 * Writes the link waiting for its confirmation, its secret encrypted for this row, and e-mails the link: `base`
 * followed by the link's secret. Refused in the same statement when its sender, or everyone together, started too
 * many today. A link whose e-mail could not be sent stays unconfirmed, and goes after 48 hours like any other.
 */
export async function enregistrer(a: Attente, adresse: string, base: string, now = new Date()): Promise<Issue> {
  if (!enabled()) return "indisponible";
  const t = Math.floor(now.getTime() / 1000);
  const source = await empreinte(adresse, now);
  const secretLien = jetonNeuf();
  const jeton = await empreinteJeton(secretLien);
  const o = a.organisation;
  try {
    const secret = await chiffre.chiffrer(a.secret, chiffre.lien(a.plateforme, o.id, jeton));
    const changed = await run!(INSERT, t, a.plateforme, o.id, o.nom, o.commune ?? null, o.code_postal ?? null, o.lien, secret, a.email, jeton, source, source, t - 86400, CONNEXIONS_PAR_JOUR, t - 86400, CONNEXIONS_EN_TOUT_JOUR);
    if (changed === 0) return "limite";
  } catch (err) {
    console.error("connecteurs : écriture impossible", err instanceof Error ? err.message : String(err));
    return "indisponible";
  }
  return (await envoyer(a.email, messageConfirmation(o, PLATEFORMES[a.plateforme].nom, `${base}${secretLien}`, `${base}${secretLien}${RETRAIT}`))) ? "ok" : "indisponible";
}

/** The end of the withdrawal link: the same page, opened on its button. */
export const RETRAIT = "/retirer";

async function envoyer(to: string, m: { subject: string; text: string }): Promise<boolean> {
  try {
    return await envoi!({ to, ...m });
  } catch {
    // Never the error's text: it may hold the address.
    console.error("connecteurs : e-mail impossible");
    return false;
  }
}

// ---------------------------------------------------------------- 3 and 4. the link

export type EtatConnexion = "a_confirmer" | "a_moderer" | "actif" | "refuse" | "expire";

/** A link as kept, without its secret nor its sender's fingerprint. */
export interface Connexion {
  id: number;
  t: number;
  plateforme: string;
  organisation: string;
  nom: string;
  commune: string | null;
  lien: string;
  email: string | null;
  etat: EtatConnexion;
  confirme_le: number | null;
}

const COLONNES = "id, t, plateforme, organisation, nom, commune, lien, email, etat, confirme_le";

/** The link a secret opens; undefined when there is none (withdrawn, expired, never confirmed). Changes nothing. */
export async function trouver(secretLien: string): Promise<Connexion | undefined> {
  if (!all || !/^[\w-]{16,64}$/.test(secretLien)) return undefined;
  const jeton = await empreinteJeton(secretLien);
  return (await all<Connexion>(`SELECT ${COLONNES} FROM connexions WHERE jeton = ?`, jeton))[0];
}

/**
 * Confirms the link: it waits for the moderation, or, when it replaces a link of the same association, takes its
 * place at once (the association was checked then), and the old address is told. Confirming twice changes nothing.
 */
export async function confirmer(secretLien: string, now = new Date()): Promise<Connexion | undefined> {
  const c = await trouver(secretLien);
  if (!c || c.etat !== "a_confirmer" || !run || !all) return c;
  const t = Math.floor(now.getTime() / 1000);
  const old = (await all<Connexion>(`SELECT ${COLONNES} FROM connexions WHERE plateforme = ? AND organisation = ? AND etat IN ('a_moderer', 'actif') AND id != ?`, c.plateforme, c.organisation, c.id))[0];
  if (old) await run("DELETE FROM connexions WHERE id = ?", old.id);
  const etat = old?.etat === "actif" ? "actif" : "a_moderer";
  await run("UPDATE connexions SET etat = ?, confirme_le = ?, modere_le = ? WHERE id = ? AND etat = 'a_confirmer'", etat, t, etat === "actif" ? t : null, c.id);
  if (old?.email && old.email !== c.email) await envoyer(old.email, messageRemplacee(old.nom, PLATEFORMES[old.plateforme]?.nom ?? old.plateforme));
  return { ...c, etat, confirme_le: t };
}

/** Withdraws the link: the row and its events go at once, and an e-mail says so. The link's name, or undefined. */
export async function retirer(secretLien: string): Promise<{ nom: string } | undefined> {
  const c = await trouver(secretLien);
  if (!c || !run) return undefined;
  await run("DELETE FROM connexions WHERE id = ?", c.id);
  if (c.email) await envoyer(c.email, messageRetire(c.nom, PLATEFORMES[c.plateforme]?.nom ?? c.plateforme, "eux"));
  return { nom: c.nom };
}

// ---------------------------------------------------------------- the e-mails (marketing's words)

const SIGNATURE = ["", "L'équipe rundata.re", "rundata.re · https://rundata.re/associations"];
const nommee = (o: Pick<Organisation, "nom" | "commune">) => (o.commune ? `${o.nom} (${o.commune})` : o.nom);

export function messageConfirmation(o: Organisation, plateforme: string, confirmation: string, retrait: string): { subject: string; text: string } {
  return {
    subject: `Confirmez la connexion de ${o.nom} à rundata.re`,
    text: [
      "Bonjour,",
      "",
      `Vous avez relié le compte ${plateforme} de ${nommee(o)} à rundata.re.`,
      "",
      "Pour confirmer, ouvrez ce lien\u00a0:",
      confirmation,
      "",
      `Nous vérifions ensuite une fois que c'est bien une association de l'île, en général sous 24 heures. Ses événements publics ${plateforme} s'affichent alors sur rundata.re, relus toutes les 6 heures.`,
      "",
      "Nous lisons seulement vos événements publics. Nous ne lisons jamais vos commandes, paiements, dons, participants ni adhérents.",
      "",
      "Gardez ce message. Pour retirer l'accès, à tout moment\u00a0:",
      retrait,
      "Le jeton d'accès et votre adresse sont alors effacés, et vos événements quittent rundata.re au même moment.",
      "",
      "Ce n'est pas vous\u00a0? Ignorez ce message\u00a0: sans confirmation, tout est effacé sous 48 heures.",
      ...SIGNATURE,
    ].join("\n"),
  };
}

/** `par`: « eux », withdrawn through the link; « plateforme », the platform refused the kept secret. */
export function messageRetire(nom: string, plateforme: string, par: "eux" | "plateforme"): { subject: string; text: string } {
  return {
    subject: `La connexion de ${nom} à rundata.re est retirée`,
    text: [
      "Bonjour,",
      "",
      par === "eux"
        ? `Vous avez retiré l'accès de rundata.re au compte ${plateforme} de ${nom}.`
        : `${plateforme} a refusé l'accès de rundata.re au compte de ${nom}, par exemple parce que les clés ont été changées.`,
      "",
      "Le jeton d'accès et votre adresse sont effacés, et vos événements ne s'affichent plus sur rundata.re.",
      "",
      "Pour relier à nouveau votre association, plus tard\u00a0: https://rundata.re/associations",
      ...SIGNATURE,
    ].join("\n"),
  };
}

export function messageRemplacee(nom: string, plateforme: string): { subject: string; text: string } {
  return {
    subject: `La connexion de ${nom} à rundata.re a été remplacée`,
    text: [
      "Bonjour,",
      "",
      `Quelqu'un a relié à nouveau le compte ${plateforme} de ${nom} à rundata.re, avec une autre adresse e-mail, et l'a confirmé. Cette nouvelle connexion remplace la vôtre\u00a0: votre adresse et l'ancien jeton d'accès sont effacés.`,
      "",
      "Si vous ne connaissez pas cette démarche, écrivez-nous\u00a0: contact@rundata.re",
      ...SIGNATURE,
    ].join("\n"),
  };
}
