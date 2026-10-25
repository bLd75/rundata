/**
 * The water restrictions of the drought orders in force in La Réunion, from VigiEau (the State's service, open API,
 * no account). The prefect's order sets a level per commune and per resource: the tap water (« eau potable », AEP),
 * the rivers and springs (« eaux superficielles », SUP) and the groundwater (« eaux souterraines », SOU), each from
 * vigilance to crisis, with what each use may or may not do (watering, car washing, swimming pools…).
 *
 * The zones of La Réunion are the 24 communes: zone 04_974_15 is Saint-Paul (97415). One call gives them all.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "vigieau",
  nom: "Restrictions d'eau en cas de sécheresse (VigiEau, arrêtés préfectoraux)",
  organisme: "Ministère de la Transition écologique (VigiEau)\u00a0; préfecture de La Réunion",
  licence: "Licence Ouverte 2.0",
  attribution: "VigiEau, préfecture de La Réunion",
  url: "https://vigieau.gouv.fr",
};

const URL = "https://api.vigieau.gouv.fr/api/zones/departement/974";
// The orders change every few weeks; VigiEau republishes them within the day.
const FRESH_SECONDS = 3600;

export type Ressource = "AEP" | "SUP" | "SOU";
export const RESSOURCES: Record<Ressource, string> = {
  AEP: "eau du robinet",
  SUP: "rivières et sources",
  SOU: "nappes souterraines",
};
export const LEVELS = ["vigilance", "alerte", "alerte_renforcee", "crise"] as const;
export type Niveau = (typeof LEVELS)[number];
export const LEVEL_NAMES: Record<Niveau, string> = {
  vigilance: "vigilance",
  alerte: "alerte",
  alerte_renforcee: "alerte renforcée",
  crise: "crise",
};

export interface Usage {
  nom: string;
  restriction: string;
  /** Who it applies to. */
  particulier: boolean;
  entreprise: boolean;
  collectivite: boolean;
  exploitation: boolean;
}

export interface Zone {
  /** INSEE code of the commune. */
  insee: string;
  ressource: Ressource;
  nom: string;
  niveau: Niveau;
  /** YYYY-MM-DD. */
  depuis?: string;
  jusqu_au?: string;
  arrete?: string;
  usages: Usage[];
}

interface Raw {
  code: string;
  type: string;
  nom: string;
  niveauGravite: string;
  arrete?: { cheminFichier?: string; dateDebutValidite?: string | null; dateFinValidite?: string | null } | null;
  usages?: { nom: string; description: string; concerneParticulier?: boolean; concerneEntreprise?: boolean; concerneCollectivite?: boolean; concerneExploitation?: boolean }[];
}

// The texts carry zero-width joiners and hard line breaks from the order's tables; a break becomes « ; », after a
// no-break space that the collapse of the spaces would turn back into an ordinary one.
const tidy = (s: string) => s.replace(/[​-‍﻿]/g, "").replace(/\s*\n\s*/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n/g, "\u00a0; ").trim();

export function parse(raw: Raw[]): Zone[] {
  return raw
    .filter((z) => /^04_974_\d\d$/.test(z.code) && ["AEP", "SUP", "SOU"].includes(z.type) && LEVELS.includes(z.niveauGravite as Niveau))
    .map((z) => ({
      insee: `974${z.code.slice(-2)}`,
      ressource: z.type as Ressource,
      nom: tidy(z.nom),
      niveau: z.niveauGravite as Niveau,
      depuis: z.arrete?.dateDebutValidite?.slice(0, 10),
      jusqu_au: z.arrete?.dateFinValidite?.slice(0, 10) ?? undefined,
      arrete: z.arrete?.cheminFichier,
      usages: (z.usages ?? []).map((u) => ({
        nom: tidy(u.nom),
        restriction: tidy(u.description),
        particulier: !!u.concerneParticulier,
        entreprise: !!u.concerneEntreprise,
        collectivite: !!u.concerneCollectivite,
        exploitation: !!u.concerneExploitation,
      })),
    }));
}

export async function zones(cache: Cache): Promise<Cached<Zone[]>> {
  return cache.get("vigieau:974", FRESH_SECONDS, async () => parse(await getJson<Raw[]>(SOURCE.id, URL, 20_000)));
}
