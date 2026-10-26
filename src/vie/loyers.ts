/**
 * The rents asked in the ads of each commune (src/vie/loyers.json, scripts/build-loyers.py): the « Carte des loyers »
 * of the ministry in charge of housing, estimated by the ANIL from the ads of SeLoger and leboncoin. A rent per m²,
 * charges included, predicted for a reference home let unfurnished; neither a median nor a rent signed. One vintage a
 * year, bundled: no read at all.
 */
import { INSEE } from "../places/insee.js";
import type { SourceInfo } from "../types.js";
import data from "./loyers.json" with { type: "json" };

export const KINDS = ["appartement", "appartement_1_2_pieces", "appartement_3_pieces_et_plus", "maison"] as const;
export type Kind = (typeof KINDS)[number];

export interface Loyer {
  /** €/m², charges included. */
  loyer_m2: number;
  /** The 95 % prediction interval, €/m². */
  bas: number;
  haut: number;
  /** Ads in the commune. */
  annonces: number;
  /** The model's adjusted R². */
  r2: number;
  /** Estimated over a wider area (below 100 ads in the commune): its kind, and its ads. */
  zone?: string;
  annonces_zone?: number;
}

export const MILLESIME = data.millesime;
const COMMUNES = data.communes as Record<string, Partial<Record<Kind, Loyer>>>;

/** The ANIL's reference homes (guide of the 2025 vintage), the surface each estimate is for. */
export const SURFACE: Record<Kind, number> = { appartement: 52, appartement_1_2_pieces: 37, appartement_3_pieces_et_plus: 72, maison: 92 };

/** The ANIL asks for caution below 30 ads in the commune, or when the model's R² is under 0.5. */
export const fragile = (l: Loyer) => l.annonces < 30 || l.r2 < 0.5;

export const ofCommune = (nom: string): Partial<Record<Kind, Loyer>> | undefined => COMMUNES[INSEE[nom]];
export const ofInsee = (insee: string): Partial<Record<Kind, Loyer>> | undefined => COMMUNES[insee];

/** « 15,09 €/m² ». */
export const m2 = (x: number) => `${x.toFixed(2).replace(".", ",")}\u00a0€/m²`;

export const SOURCE: SourceInfo = {
  id: "anil_loyers",
  nom: `Carte des loyers ${data.millesime} (indicateurs de loyers d'annonce par commune)`,
  organisme: "ANIL, pour le ministère chargé du logement",
  licence: "Licence Ouverte Etalab 2.0",
  // The wording the ANIL asks for (guide of the vintage, « Conditions d'utilisation des données »).
  attribution: "Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin",
  url: "https://www.data.gouv.fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/",
};
