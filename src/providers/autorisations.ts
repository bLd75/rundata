/**
 * The communes whose site's terms forbid taking its information without their authorisation (Petite-Île, Cilaos,
 * Saint-Philippe, Saint-Joseph, Le Tampon, Saint-André, L'Étang-Salé, La Possession, Bras-Panon, Saint-Benoît, then
 * Saint-Denis, Saint-Pierre and Sainte-Rose, as their legal notices read on 25/10/2026), and where their answer stands.
 * The same rule for every commune of the island: one whose site is not read at all is said so too. Until a commune has agreed, nothing is read
 * on its site: not its agenda, not its news (src/providers/agenda.ts, `site_commune`), and what was kept of them is no
 * longer served. Each answer says so instead (tools/agenda.ts, `mentionCommune`).
 *
 * Those whose terms allow taking their information, on conditions they write (Saint-Louis, Saint-Leu, La
 * Plaine-des-Palmistes: « à des fins d'information », not commercial), are here too, « permise », to be named as such.
 * A commune that is not here: its site's terms say nothing.
 */
export interface Autorisation {
  /**
   * « a_demander » until the letter asking for it has gone, « demandee » once it has, « refusee » only after a written
   * no, « accordee » after a yes; « permise » when the site's own terms allow it, without asking.
   */
  etat: "a_demander" | "demandee" | "accordee" | "permise" | "refusee";
  /** What its site publishes, read once it agrees: its agenda's events, the events announced in its news, or both. */
  publie: "événements" | "actualités" | "événements et actualités";
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
  "La Plaine-des-Palmistes": { etat: "permise", publie: "actualités" },
  "Petite-Île": { etat: "a_demander", publie: "événements" },
  "Saint-André": { etat: "a_demander", publie: "événements" },
  "Saint-Benoît": { etat: "a_demander", publie: "événements" },
  "Saint-Denis": { etat: "a_demander", publie: "actualités" },
  "Saint-Joseph": { etat: "a_demander", publie: "actualités" },
  "Saint-Leu": { etat: "permise", publie: "actualités" },
  "Saint-Louis": { etat: "permise", publie: "événements" },
  "Saint-Philippe": { etat: "a_demander", publie: "actualités" },
  "Saint-Pierre": { etat: "a_demander", publie: "événements et actualités" },
  "Sainte-Rose": { etat: "a_demander", publie: "événements et actualités" },
};

/** Whether what its commune's site publishes may be taken: yes for a commune whose site asks nothing, or allows it. */
export const autorisee = (commune: string | undefined) => !commune || ["accordee", "permise"].includes(AUTORISATIONS[commune]?.etat ?? "accordee");

/** The communes whose site is not read until they agree, in the list's order. */
export const nonAutorisees = () => Object.keys(AUTORISATIONS).filter((c) => !autorisee(c));
