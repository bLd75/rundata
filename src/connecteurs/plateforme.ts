/**
 * What every platform connector gives (src/connecteurs/helloasso.ts first): the association that the keys pasted on
 * rundata.re belong to, and its public events, nothing else. The rest is common to all platforms: the encrypted
 * secret (chiffre.ts), the rows (scripts/connecteurs.sql), the pages, the reading by the scheduled event, the agenda.
 *
 * A platform's keys often open more than the public events (HelloAsso's: the orders, the payments, the
 * participants). A connector never asks for more: its calls go through `garde`, which refuses before any fetch a path
 * outside the platform's closed list.
 */

/** The association the keys belong to, as the platform names it. */
export interface Organisation {
  /** Its identifier on the platform (HelloAsso: its slug). */
  id: string;
  nom: string;
  commune?: string;
  code_postal?: string;
  /** Its public page on the platform. */
  lien: string;
}

/** One public event, as kept in `evenements_connectes`. */
export interface EvenementPublic {
  /** Its identifier on the platform (HelloAsso: the form's slug). */
  id: string;
  /** When the platform says it last changed. */
  maj: string;
  titre: string;
  /** Local times at La Réunion, « 2026-11-14T18:00 ». */
  debut: string;
  fin?: string;
  lieu?: string;
  adresse?: string;
  commune?: string;
  code_postal?: string;
  /** « Gratuit », « 10 € », « de 5 à 15 € ». */
  prix?: string;
  /** Its first sentence, as the other agendas keep (providers/agenda-mots.ts, `lead`). */
  description?: string;
  /** Its page on the platform. */
  lien: string;
}

/** An access opened for one reading. */
export interface Acces {
  /** What the reading's calls carry (HelloAsso: a 30-minute access token), never kept. */
  jeton: string;
  /** The secret to keep from now on, when the platform turns it (HelloAsso's refresh token): written before the reading. */
  secret?: string;
}

/**
 * The platform refused the keys or the kept secret (HelloAsso: `invalid_grant`, 401): read as a withdrawal, the link
 * and its events are deleted. Never a platform's silence (a 5xx, a timeout): that one keeps the last reading.
 */
export class AccesRefuse extends Error {
  constructor(public plateforme: string, public etape: string, public status?: number) {
    super(`${plateforme} : ${etape} refusé${status ? ` (HTTP ${status})` : ""}`);
    this.name = "AccesRefuse";
  }
}

/** The keys verified: who they belong to, and the secret to keep (never the keys themselves). */
export interface Verification {
  organisation: Organisation;
  secret: string;
}

export interface Plateforme {
  id: string;
  nom: string;
  /** The fields the association pastes, by name. */
  champs: readonly string[];
  /** The association the keys administer; throws AccesRefuse when the platform refuses them. */
  verifier(cles: Record<string, string>): Promise<Verification>;
  /**
   * The one door to the platform for a reading, from the kept secret; throws AccesRefuse when the platform refuses it.
   * A platform that later gives us a partner client changes this alone.
   */
  acceder(secret: string): Promise<Acces>;
  /**
   * Its public events to come. `connus`: those kept from the last reading, by id, so that an event not changed since
   * is not read again in detail.
   */
  lire(jeton: string, organisation: string, connus: ReadonlyMap<string, EvenementPublic>): Promise<EvenementPublic[]>;
}

/** A postcode of La Réunion: the associations and the events taken are the island's only. */
export const reunionnais = (codePostal: string | undefined) => /^974\d\d$/.test(codePostal?.trim() ?? "");

/** Thrown before any fetch for a path outside a platform's closed list. */
export class CheminInterdit extends Error {
  constructor(plateforme: string, chemin: string) {
    super(`${plateforme} : appel refusé hors de la liste fermée (${chemin.split("?")[0]})`);
    this.name = "CheminInterdit";
  }
}

/**
 * `chemin` if one of `permis` matches it whole and its first group, when it has one, is `organisation`: an association's
 * keys never read another's. Throws CheminInterdit otherwise.
 */
export function garde(plateforme: string, permis: readonly RegExp[], chemin: string, organisation?: string): string {
  for (const re of permis) {
    const m = re.exec(chemin);
    if (m && m.index === 0 && m[0] === chemin && (m[1] === undefined || m[1] === organisation)) return chemin;
  }
  throw new CheminInterdit(plateforme, chemin);
}
