/**
 * The public defibrillators of La Réunion, from Géo'DAE, the national base of automated external defibrillators
 * (ministry of health): a list bundled with the server (src/dae/dae.json, scripts/build-dae.py), rebuilt by hand from
 * the national file, which is updated every day but changes little from one month to the next.
 */
import data from "../dae/dae.json" with { type: "json" };
import type { SourceInfo } from "../types.js";

/** The day the bundled list was last rebuilt. */
export const BUILT = data.construit;

export const SOURCE: SourceInfo = {
  id: "geodae",
  nom: "Géo'DAE, base nationale des défibrillateurs",
  organisme: "Ministère chargé de la santé",
  licence: "Licence Ouverte 2.0",
  attribution: "Géo'DAE (ministère chargé de la santé)",
  url: "https://www.data.gouv.fr/datasets/geodae-base-nationale-des-defibrillateurs",
};

export interface Dae {
  nom: string;
  adresse: string;
  commune: string;
  lon: number;
  lat: number;
  /** Outside the building: reachable at any hour. */
  exterieur: boolean;
  /** Reachable by anyone, when the place is open. */
  acces_libre: boolean;
  emplacement?: string;
  etage?: string;
  horaires?: string;
  exploitant?: string;
}

export const DAES: Dae[] = data.defibrillateurs;
