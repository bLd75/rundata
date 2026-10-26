/**
 * The sources whose site's terms forbid taking their information without their authorisation, and where their answer
 * stands, one line per source: a commune's agenda or news (Petite-Île, Cilaos, Saint-Philippe, Saint-Joseph, Le
 * Tampon, Saint-André, L'Étang-Salé, La Possession, Bras-Panon, Saint-Benoît, then Saint-Denis, Saint-Pierre and
 * Sainte-Rose, whose site is not read at all, as their legal notices read on 25/10/2026), the notices of power cuts a
 * commune relays (Cilaos, Saint-Philippe, Saint-André, Sainte-Suzanne). The same rule for every commune of the island. Until
 * a source has agreed, nothing is read of it, and what was kept of it is no longer served: each answer says so instead,
 * in marketing's words (tools/non-repris.ts).
 *
 * Those whose terms allow taking their information, on conditions they write (Saint-Louis, Saint-Leu, La
 * Plaine-des-Palmistes: « à des fins d'information », not commercial), are here too, « permise », to be named as such.
 * A source that is not here: its site's terms say nothing.
 */
export interface Autorisation {
  /** The commune whose site it is. */
  commune: string;
  /**
   * What is read there once it agrees: its agenda's events, the events announced in its news, both, the notices of
   * power cuts it relays.
   */
  publie: "événements" | "actualités" | "événements et actualités" | "avis de coupure d'électricité";
  /**
   * « a_demander » until the letter asking for it has gone, « demandee » once it has, « refusee » only after a written
   * no, « accordee » after a yes; « permise » when the site's own terms allow it, without asking.
   */
  etat: "a_demander" | "demandee" | "accordee" | "permise" | "refusee";
  /** The day the letter went, « 2026-10-26 », as given by who sent it: never guessed. */
  demandee_le?: string;
  /** The day of its written no. */
  refusee_le?: string;
}

/**
 * By source: `agenda:<id>` for an agenda or a mairie's news (src/providers/agenda.ts, LISIBLES, or a commune whose site
 * is not read at all: `agenda:saint_denis`), `courant:<commune>`
 * for the notices of power cuts a mairie relays (src/providers/coupures-courant.ts, MAIRIES). In the order said.
 */
export const AUTORISATIONS: Record<string, Autorisation> = {
  "agenda:bras_panon": { commune: "Bras-Panon", publie: "événements", etat: "a_demander" },
  "agenda:cilaos": { commune: "Cilaos", publie: "actualités", etat: "a_demander" },
  "agenda:etang_sale": { commune: "L'Étang-Salé", publie: "événements", etat: "a_demander" },
  "agenda:la_possession": { commune: "La Possession", publie: "événements", etat: "a_demander" },
  "agenda:le_tampon": { commune: "Le Tampon", publie: "événements", etat: "a_demander" },
  "agenda:petite_ile": { commune: "Petite-Île", publie: "événements", etat: "a_demander" },
  "agenda:plaine_des_palmistes": { commune: "La Plaine-des-Palmistes", publie: "actualités", etat: "permise" },
  "agenda:saint_andre": { commune: "Saint-André", publie: "événements", etat: "a_demander" },
  "agenda:saint_benoit": { commune: "Saint-Benoît", publie: "événements", etat: "a_demander" },
  "agenda:saint_denis": { commune: "Saint-Denis", publie: "actualités", etat: "a_demander" },
  "agenda:saint_joseph": { commune: "Saint-Joseph", publie: "actualités", etat: "a_demander" },
  "agenda:saint_leu": { commune: "Saint-Leu", publie: "actualités", etat: "permise" },
  "agenda:saint_louis": { commune: "Saint-Louis", publie: "événements", etat: "permise" },
  "agenda:saint_philippe": { commune: "Saint-Philippe", publie: "actualités", etat: "a_demander" },
  "agenda:saint_pierre": { commune: "Saint-Pierre", publie: "événements et actualités", etat: "a_demander" },
  "agenda:sainte_rose": { commune: "Sainte-Rose", publie: "événements et actualités", etat: "a_demander" },
  "courant:Cilaos": { commune: "Cilaos", publie: "avis de coupure d'électricité", etat: "a_demander" },
  "courant:Saint-André": { commune: "Saint-André", publie: "avis de coupure d'électricité", etat: "a_demander" },
  "courant:Saint-Philippe": { commune: "Saint-Philippe", publie: "avis de coupure d'électricité", etat: "a_demander" },
  "courant:Sainte-Suzanne": { commune: "Sainte-Suzanne", publie: "avis de coupure d'électricité", etat: "a_demander" },
};

/** Whether a source may be read: yes for one whose site asks nothing, or allows it. */
export const autorisee = (source: string) => ["accordee", "permise"].includes(AUTORISATIONS[source]?.etat ?? "accordee");

/** The sources of a kind (`agenda`, `courant`) not read until they agree, in the list's order. */
export const nonAutorisees = (famille: string): Autorisation[] =>
  Object.entries(AUTORISATIONS).filter(([k]) => k.startsWith(`${famille}:`) && !autorisee(k)).map(([, a]) => a);

/** A commune's source of that kind, while it has not agreed. */
export const nonAutorisee = (famille: string, commune: string | undefined) => nonAutorisees(famille).find((a) => a.commune === commune);

/**
 * A medium or a site whose terms forbid reading it by a program, its titles included: not read at all, and said instead
 * where it was (tools/non-repris.ts). France Télévisions' terms (franceinfo.fr/cgu.html, art. 13.2 and 13.3), read on
 * 26/10/2026, forbid any automated access to extract or reuse the content of its sites, metadata included.
 */
export interface MediaNonRepris {
  nom: string;
  /** Who sets the terms. */
  organisme: string;
  /** The day its terms were read, « 2026-10-26 », and where they are; the day its reading stopped. */
  lues_le: string;
  conditions: string;
  non_lue_depuis: string;
  /** Where its information is, for the reader: its site, and its sport. */
  site: string;
  site_sport?: string;
  /** « a_demander » while no letter has gone: nothing is said of a request. */
  etat: "a_demander" | "demandee" | "accordee" | "refusee";
  /** The day the letter went, as given by who sent it: never guessed. */
  demandee_le?: string;
}

export const MEDIAS: Record<string, MediaNonRepris> = {
  "media:la1ere": {
    nom: "Réunion La 1ère",
    organisme: "France Télévisions",
    lues_le: "2026-10-26",
    conditions: "https://www.franceinfo.fr/cgu.html",
    non_lue_depuis: "2026-10-26",
    site: "https://la1ere.franceinfo.fr/reunion/",
    site_sport: "https://la1ere.franceinfo.fr/reunion/sport/",
    etat: "a_demander",
  },
  // The tourist board's site (Île de La Réunion Tourisme): its legal notice, dated 01/10/2026 and read on 26/10, forbids
  // reproducing the site or any of its elements without the prior written authorisation of the Comité Réunionnais du
  // Tourisme. Its agenda of the big fêtes and festivals is no longer read.
  "site:reunion_fr": {
    nom: "reunion.fr",
    organisme: "Comité Réunionnais du Tourisme",
    lues_le: "2026-10-26",
    conditions: "https://www.reunion.fr/mentions-legales/",
    non_lue_depuis: "2026-10-26",
    site: "https://www.reunion.fr/organisez/actualites-de-l-ile/agenda/",
    etat: "a_demander",
  },
};
