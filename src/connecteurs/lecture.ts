/**
 * The scheduled reading of the associations' platforms (connecteurs/connexions.ts): at each scheduled run, the one
 * active link read longest ago, when more than 6 hours ago, so that a run never reads more than one association.
 *
 * - The kept secret opens the access (`Plateforme.acceder`); a secret the platform turns is written before the reading.
 * - The events read replace the link's in `evenements_connectes`: only those changed are written, those gone deleted.
 * - The platform refuses the secret (the keys were changed, the access withdrawn there): the link is deleted, its events
 *   with it, and its address told.
 * - Any other failure keeps the last events read, said with their hour (the agenda, providers/agenda-connecteurs.ts):
 *   a platform that does not answer has not emptied its agenda. After 25 days without a successful reading, its address
 *   is reminded once, with a second link to withdraw; after 30, the link expires (scripts/connecteurs.sql), told too.
 *
 * Never a token, a secret nor what the platform answered in the logs: the step and the status only.
 */
import { jetonNeuf, empreinteJeton } from "../propositions.js";
import * as chiffre from "./chiffre.js";
import * as connexions from "./connexions.js";
import { AccesRefuse, type EvenementPublic } from "./plateforme.js";
import { enLigne } from "../web/connecteurs-drapeau.js";

/** How often an association is read. */
export const RELECTURE_SECONDES = 6 * 3600;
export const RAPPEL_JOURS = 25;
export const EXPIRATION_JOURS = 30;
/** The withdrawal link of the reminder, followed by its secret and connexions.RETRAIT (web/connecteurs.ts). */
export const CONNEXION_URL = "https://rundata.re/associations/connexion/";

interface Due {
  id: number;
  plateforme: string;
  organisation: string;
  nom: string;
  email: string | null;
  jeton: string;
  secret: string | null;
  confirme_le: number | null;
  modere_le: number | null;
  reussi_le: number | null;
  rappel_le: number | null;
}

const DUE = `SELECT id, plateforme, organisation, nom, email, jeton, secret, confirme_le, modere_le, reussi_le, rappel_le
FROM connexions WHERE etat = 'actif' AND COALESCE(lu_le, 0) <= ? ORDER BY COALESCE(lu_le, 0), id LIMIT 1`;

export const CHAMPS = ["id", "maj", "titre", "debut", "fin", "lieu", "adresse", "commune", "code_postal", "prix", "description", "lien"] as const;

/** What a reading did, for the scheduled run's log line: never a name nor an address. */
export interface Rapport {
  connexion: number;
  issue: "lu" | "echec" | "retire" | "expire";
  evenements?: number;
  ecrits?: number;
  effaces?: number;
  erreur?: string;
  rappel?: true;
}

const day = (t: number) => new Date(t * 1000 + 4 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join("/");
/** The failure in a few words: the step and the status, never the platform's answer. */
const enBref = (err: unknown) => (err instanceof Error ? err.name : "erreur").slice(0, 40);
/** An event as kept, for comparing: the same fields, in the same order, absent ones null. */
const ligne = (e: Partial<EvenementPublic>) => JSON.stringify(CHAMPS.map((k) => e[k] ?? null));

/**
 * Reads the link due, if any. `apres`: what to do once its events left the agenda (withdrawn, expired), the agendas'
 * copy written again. Undefined when there was nothing to read, or no database, e-mail or key.
 */
export async function lireUne(now = new Date(), apres?: () => Promise<void>): Promise<Rapport | undefined> {
  const d = connexions.portes();
  // Nothing before the flag (web/connecteurs-drapeau.ts): the tables may not exist yet, and no link can be made.
  if (!d || !connexions.enabled() || !enLigne()) return undefined;
  const t = Math.floor(now.getTime() / 1000);
  const [c] = await d.all<Due>(DUE, t - RELECTURE_SECONDES);
  if (!c) return undefined;
  // Marked read first: a run that dies on it leaves it for 6 hours, not for the next run.
  await d.run("UPDATE connexions SET lu_le = ? WHERE id = ?", t, c.id);
  const p = connexions.PLATEFORMES[c.plateforme];
  try {
    if (!p || !c.secret) throw new Error("connexion illisible");
    const ad = chiffre.lien(c.plateforme, c.organisation, c.jeton);
    const secret = await chiffre.dechiffrer(c.secret, ad);
    const acces = await p.acceder(secret);
    if (acces.secret && acces.secret !== secret) await d.run("UPDATE connexions SET secret = ? WHERE id = ?", await chiffre.chiffrer(acces.secret, ad), c.id);
    const gardes = await d.all<EvenementPublic>(`SELECT ${CHAMPS.join(", ")} FROM evenements_connectes WHERE connexion = ?`, c.id);
    const connus = new Map(gardes.map((e) => [e.id, Object.fromEntries(Object.entries(e).filter(([, v]) => v !== null)) as unknown as EvenementPublic]));
    const lus = await p.lire(acces.jeton, c.organisation, connus);
    const avant = new Map(gardes.map((e) => [e.id, ligne(e)]));
    const changes = lus.filter((e) => avant.get(e.id) !== ligne(e));
    const effaces = await d.run("DELETE FROM evenements_connectes WHERE connexion = ? AND id NOT IN (SELECT value FROM json_each(?))", c.id, JSON.stringify(lus.map((e) => e.id)));
    if (changes.length) {
      const champ = (k: string) => `json_extract(value, '$.${k}')`;
      await d.run(`INSERT OR REPLACE INTO evenements_connectes (connexion, ${CHAMPS.join(", ")}) SELECT ?, ${CHAMPS.map(champ).join(", ")} FROM json_each(?)`, c.id, JSON.stringify(changes));
    }
    await d.run("UPDATE connexions SET reussi_le = ?, echecs = 0, erreur = NULL, rappel_le = NULL, jeton_retrait = NULL WHERE id = ?", t, c.id);
    return { connexion: c.id, issue: "lu", evenements: lus.length, ecrits: changes.length, effaces };
  } catch (err) {
    if (err instanceof AccesRefuse) {
      // Refused by the platform: nothing kept, the address told (its words, marketing's).
      await d.run("DELETE FROM connexions WHERE id = ?", c.id);
      if (c.email) await connexions.envoyer(c.email, connexions.messageRetire(c.nom, p?.nom ?? c.plateforme, "plateforme"));
      await apres?.().catch(() => {});
      console.error(`connecteurs : accès refusé par ${c.plateforme} (${err.etape}${err.status ? ` ${err.status}` : ""}), connexion ${c.id} retirée`);
      return { connexion: c.id, issue: "retire", erreur: `${err.etape}${err.status ? ` ${err.status}` : ""}` };
    }
    const erreur = enBref(err);
    await d.run("UPDATE connexions SET echecs = echecs + 1, erreur = ? WHERE id = ?", erreur, c.id);
    console.error(`connecteurs : lecture ${c.plateforme} impossible, connexion ${c.id} (${erreur})`);
    // Counted from its last successful reading; from its moderation when it never had one.
    const depuis = c.reussi_le ?? c.modere_le ?? c.confirme_le ?? t;
    const nom = p?.nom ?? c.plateforme;
    if (t - depuis >= EXPIRATION_JOURS * 86400) {
      // The trigger wipes its secret, its address and its events.
      await d.run("UPDATE connexions SET etat = 'expire' WHERE id = ?", c.id);
      if (c.email) await connexions.envoyer(c.email, connexions.messageExpiree(c.nom, nom, day(depuis)));
      await apres?.().catch(() => {});
      return { connexion: c.id, issue: "expire", erreur };
    }
    if (t - depuis >= RAPPEL_JOURS * 86400 && !c.rappel_le && c.email) {
      // A second link, of which only the hash is kept: the first one, in the confirmation e-mail, still works.
      const secretLien = jetonNeuf();
      await d.run("UPDATE connexions SET jeton_retrait = ?, rappel_le = ? WHERE id = ?", await empreinteJeton(secretLien), t, c.id);
      const sent = await connexions.envoyer(c.email, connexions.messageRappel(c.nom, nom, day(depuis), day(depuis + EXPIRATION_JOURS * 86400), `${CONNEXION_URL}${secretLien}${connexions.RETRAIT}`));
      return { connexion: c.id, issue: "echec", erreur, ...(sent ? { rappel: true as const } : {}) };
    }
    return { connexion: c.id, issue: "echec", erreur };
  }
}
