/**
 * The communes whose site's terms forbid taking its information without their authorisation (Petite-Île, Cilaos,
 * Saint-Philippe, Saint-Joseph, Le Tampon, Saint-André, L'Étang-Salé, La Possession, Bras-Panon, Saint-Benoît, as
 * their legal notices read on 25/10/2026), and where their answer stands. Until a commune has agreed, nothing is read
 * on its site: not its agenda, not its news (src/providers/agenda.ts, `site_commune`), and what was kept of them is no
 * longer served. Each answer says so instead (tools/agenda.ts, `mentionCommune`).
 *
 * A commune that is not here: its site's terms allow it, or say nothing.
 */
export interface Autorisation {
  /**
   * « a_demander » until the letter asking for it has gone, « demandee » once it has, « refusee » only after a written
   * no, « accordee » after a yes.
   */
  etat: "a_demander" | "demandee" | "accordee" | "refusee";
  /** What its site publishes that is read: its agenda's events, or the events announced in its news. */
  publie: "événements" | "actualités";
  /** The day the letter went, « 2026-10-26 », as given by who sent it: never guessed. */
  demandee_le?: string;
  /** The day of its written no. */
  refusee_le?: string;
}

export const AUTORISATIONS: Record<string, Autorisation> = {
  "Bras-Panon": { etat: "a_demander", publie: "événements" },
  Cilaos: { etat: "a_demander", publie: "actualités" },
  "L'Étang-Salé": { etat: "a_demander", publie: "événements" },
  "La Possession": { etat: "a_demander", publie: "événements" },
  "Le Tampon": { etat: "a_demander", publie: "événements" },
  "Petite-Île": { etat: "a_demander", publie: "événements" },
  "Saint-André": { etat: "a_demander", publie: "événements" },
  "Saint-Benoît": { etat: "a_demander", publie: "événements" },
  "Saint-Joseph": { etat: "a_demander", publie: "actualités" },
  "Saint-Philippe": { etat: "a_demander", publie: "actualités" },
};

/** Whether what its commune's site publishes may be taken: yes for a commune whose site asks nothing. */
export const autorisee = (commune: string | undefined) => !commune || (AUTORISATIONS[commune]?.etat ?? "accordee") === "accordee";

/** The communes whose site is not read until they agree, in the list's order. */
export const nonAutorisees = () => Object.keys(AUTORISATIONS).filter((c) => !autorisee(c));
