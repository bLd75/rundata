/**
 * The IGN's ground altitudes (RGE ALTI, the Géoplateforme's altimetry service): read for a point by fiche_terrain
 * (terrain.ts) and for every point of a trail (traces.ts). One source, said the same way everywhere. And the BD TOPO's
 * main roads and inhabited places, drawn on the pages' maps (web/routes.json, written by scripts/build-routes.py), and
 * the Géoplateforme's layer of aerial photos, the colours of the maps' relief (public/relief-*.webp, by
 * scripts/build-relief.py).
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

export const BDTOPO: SourceInfo = {
  id: "ign_bdtopo",
  nom: "Routes et noms de lieux des cartes (BD TOPO)",
  organisme: "IGN",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "IGN, BD TOPO",
  url: "https://geoservices.ign.fr/bdtopo",
};

export const PHOTOS: SourceInfo = {
  id: "ign_photos_aeriennes",
  nom: "Photographies aériennes du relief des cartes (couche Photographies aériennes de la Géoplateforme)",
  organisme: "IGN",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "IGN, Photographies aériennes (Géoplateforme)",
  url: "https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/diffusion/wms-raster/",
};
