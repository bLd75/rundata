/**
 * The pharmacies, hospitals and clinics of La Réunion (src/sante/etablissements.json, scripts/build-sante.py: the
 * FINESS register of the ministry of health), and where to learn which pharmacy is on duty: only the service the
 * ARS La Réunion points to knows it.
 */
import { distanceKm } from "../geo.js";
import type { SourceInfo } from "../types.js";
import data from "./etablissements.json" with { type: "json" };

export interface Etablissement {
  finess: string;
  type: "pharmacie" | "hopital" | "clinique";
  nom: string;
  adresse: string;
  commune: string;
  telephone: string | null;
  lon: number;
  lat: number;
}

export const ETABLISSEMENTS = data.etablissements as Etablissement[];
export const BUILT = data.construit;

export const FINESS: SourceInfo = {
  id: "finess",
  nom: "FINESS, fichier national des établissements sanitaires et sociaux",
  organisme: "Ministère de la Santé",
  licence: "Licence Ouverte 2.0",
  attribution: "Ministère de la Santé, FINESS",
  url: "https://www.data.gouv.fr/datasets/finess-extraction-du-fichier-des-etablissements/",
};

export const ARS_GARDE: SourceInfo = {
  id: "ars_garde",
  nom: "Trouver la pharmacie de garde la plus proche (ARS La Réunion)",
  organisme: "Agence régionale de santé La Réunion",
  licence: "Information publique",
  attribution: "ARS La Réunion",
  url: "https://www.lareunion.ars.sante.fr/trouver-la-pharmacie-de-garde-la-plus-proche-0",
};

export const SANTE_FR: SourceInfo = {
  id: "sante_fr_urgences",
  nom: "Urgences : les numéros utiles à La Réunion (Santé.fr)",
  organisme: "Santé.fr, service public d'information en santé",
  licence: "Information publique",
  attribution: "Santé.fr",
  url: "https://www.sante.fr/ocean-indien-numeros-utiles-en-cas-durgence",
};

/** The duty pharmacy, as the ARS La Réunion says to find it. */
export const GARDE = {
  site: "https://www.3237.fr/",
  telephone: "32 37 (numéro payant : 0,35 € TTC la minute)",
  quand: "la nuit, le dimanche et les jours fériés",
  a_savoir: [
    "Se munir de l'ordonnance et de la carte Vitale.",
    "Pendant sa garde, la pharmacie peut garder sa porte fermée pour sa sécurité : une sonnette est à côté de la porte.",
  ],
};

/** The nearest of a kind, the nearest first. */
export function nearest(lon: number, lat: number, types: Etablissement["type"][], max = 5): (Etablissement & { km: number })[] {
  return ETABLISSEMENTS.filter((e) => types.includes(e.type))
    .map((e) => ({ ...e, km: distanceKm(lon, lat, e.lon, e.lat) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, max);
}

export const inCommune = (commune: string, types: Etablissement["type"][]) => ETABLISSEMENTS.filter((e) => e.commune === commune && types.includes(e.type));
