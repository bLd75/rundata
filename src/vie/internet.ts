/**
 * How the premises of each commune can be connected to the internet (src/vie/internet.json, scripts/build-internet.py):
 * « Ma connexion internet » of the ARCEP, the premises (homes and business premises) counted by the best technology
 * they are eligible to, as the operators declare them at the end of a quarter. Eligible is not connected. One release a
 * quarter, bundled: no read at all.
 */
import { INSEE } from "../places/insee.js";
import type { SourceInfo } from "../types.js";
import data from "./internet.json" with { type: "json" };

/** The technologies, best first, as the ARCEP ranks them for the very high speed. */
export const TECHNOS = ["fibre", "cable", "cuivre_30", "thd_radio", "cuivre_8", "4g_fixe", "hd_radio", "satellite"] as const;
export type Techno = (typeof TECHNOS)[number];
export type Commune = { locaux: number } & Partial<Record<Techno, number>>;

const COMMUNES = data.communes as Record<string, Commune>;
/** The end of the quarter declared, « 2026-06-30 ». */
export const AU = data.au;

export const ofCommune = (nom: string): Commune | undefined => COMMUNES[INSEE[nom]];
export const ofInsee = (insee: string): Commune | undefined => COMMUNES[insee];

/** The share of the premises whose best technology is this one, in %, one decimal. */
export const part = (c: Commune, t: Techno) => Math.round((1000 * (c[t] ?? 0)) / c.locaux) / 10;

/** « 97,1 % ». */
export const pct = (x: number) => `${String(x).replace(".", ",")}\u00a0%`;

/** « 30/06/2026 ». */
export const date = (iso = AU) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
/** « 30 juin 2026 ». */
export const dateLongue = (iso = AU) => `${Number(iso.slice(8, 10))} ${MOIS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

export const SOURCE: SourceInfo = {
  id: "arcep_connexion",
  nom: "Ma connexion internet (statistiques d'éligibilité par commune)",
  organisme: "Arcep",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Arcep, Ma connexion internet",
  url: "https://www.data.gouv.fr/datasets/ma-connexion-internet",
};
