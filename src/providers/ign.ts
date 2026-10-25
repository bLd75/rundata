/**
 * The IGN's ground altitudes (RGE ALTI, the Géoplateforme's altimetry service): read for a point by fiche_terrain
 * (terrain.ts) and for every point of a trail (traces.ts). One source, said the same way everywhere.
 */
import type { SourceInfo } from "../types.js";

export const ALTIMETRIE: SourceInfo = {
  id: "ign_altimetrie",
  nom: "Altitudes du sol (RGE ALTI, service d'altimétrie de la Géoplateforme)",
  organisme: "IGN",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "IGN, RGE ALTI",
  url: "https://geoservices.ign.fr/documentation/services/services-geoplateforme/altimetrie",
};
