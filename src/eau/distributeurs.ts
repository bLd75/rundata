/**
 * Who distributes the water of each commune (src/eau/distributeurs.json, scripts/build-distributeurs.py: the ARS's
 * sanitary control), and where its notices of cuts are read (src/providers/avis-eau.ts).
 */
import data from "./distributeurs.json" with { type: "json" };

export interface Distributeur {
  /** As people know it: « runéo », « La Créole ». */
  nom: string;
  /** Its site, when its notices are read here. */
  site?: string;
  /** Whether its notices of cuts for this commune are read (its feed, or the CIREST's for the east). */
  avis: boolean;
}

// The ARS's names, as people write them.
const NAMES: Record<string, string> = {
  "CISE REUNION": "CISE Réunion", RUNEO: "runéo", SUDEAU: "Sudeau", "STÉ PUBLIQUE LOCALE SOURCES ET EAUX": "SPL Sources et Eaux",
  O2LEST: "O2LEST", "EAUX DE LA POSSESSION": "Eaux de La Possession", DIONEO: "Dionéo", "DERICHEBOURG AQUA OI": "Derichebourg Aqua OI",
  "LA CREOLE": "La Créole", RECIL: "RECIL", "MAIRIE DE L'ÉTANG-SALÉ": "la mairie de L'Étang-Salé",
};
// The distributors with a feed of notices, read for every commune they serve.
const FEEDS: Record<string, string> = { DIONEO: "https://dioneo.re/", RUNEO: "https://www.runeo.re/", "EAUX DE LA POSSESSION": "https://www.eauxdelapossession.re/" };
// The CIREST publishes the notices of its six communes, whoever distributes their water.
export const CIREST = { communes: ["Bras-Panon", "Saint-André", "La Plaine-des-Palmistes", "Saint-Benoît", "Sainte-Rose", "Salazie"], site: "https://www.cirest.fr/categorie/communique/communique-eau/" };
export const BUILT = data.construit;
export const SOURCE = data.source;

/** The distributors the ARS names for a commune whose samples name more than one: none is chosen. */
export function plusieurs(commune: string): string[] | undefined {
  return (data.plusieurs as Record<string, string[]>)[commune]?.map((x) => NAMES[x] ?? x);
}

export function distributeur(commune: string): Distributeur | undefined {
  const raw = (data.communes as Record<string, string | null>)[commune];
  if (!raw) return undefined;
  const feed = FEEDS[raw];
  const east = CIREST.communes.includes(commune);
  return { nom: NAMES[raw] ?? raw, site: feed ?? (east ? CIREST.site : undefined), avis: !!feed || east };
}
