/**
 * Boats to Mauritius: there is no regular passenger line between Réunion and Mauritius (the Mauritius Pride stopped
 * at the end of 2015; the Mauritius Trochetia serves only Rodrigues and Agaléga, its Réunion line suspended). Said
 * in plain words, with the day it was checked, by transports and on /bus. Checked by hand every six months: a line
 * that came back would make the sentence false without anyone seeing it.
 */
import { normalize } from "../places/resolve.js";

/** The day the absence of a line was last checked. */
export const VERIFIE = "2026-10-24";

const day = VERIFIE.split("-").reverse().join("/");

/** marketing's words, as given. */
export const T = {
  outil:
    `Il n'y a pas de liaison maritime régulière de passagers entre La Réunion et Maurice (vérifié le ${day}). ` +
    "Le Mauritius Pride a cessé fin 2015, et le Mauritius Trochetia ne dessert plus que Rodrigues et Agaléga, depuis Maurice : " +
    "sa ligne vers La Réunion est suspendue. Maurice se rejoint en avion (Air Austral, Air Mauritius), environ 45 min de vol. " +
    "Rodrigues se rejoint depuis Maurice.",
  h3: "Et le bateau pour Maurice ?",
  page:
    // Non-breaking spaces: the names and the duration are not cut at the end of a line.
    "Aucun bateau régulier ne transporte de passagers entre La Réunion et Maurice. Le Mauritius\u00a0Trochetia relie Maurice à Rodrigues " +
    "et Agaléga, mais sa ligne vers La Réunion est suspendue. Pour Maurice, il faut prendre l'avion : Air\u00a0Austral ou Air\u00a0Mauritius, " +
    "environ 45\u00a0minutes de vol.",
  verifie: `Vérifié le ${day}.`,
};

// Words of a crossing, not of a bus stop: « Jules Ferry », « Chemin Bateau », « Fonds Maurice », « Maurice Tomi » are stops.
const CROSSING = /\b(ferry|ferries|bateaux?|navette maritime|traversee|liaison maritime|mauritius|rodrigues|ile maurice)\b|\b(pour|vers|a|rejoindre|aller a) maurice\b/;
const STOPS = /\b(jules ferry|chemin bateau)\b/;

/** Whether what was asked of transports is a boat to Mauritius or Rodrigues rather than a bus stop. */
export function asksCrossing(asked: string): boolean {
  const q = normalize(asked);
  return CROSSING.test(q.replace(STOPS, " "));
}
