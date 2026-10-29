/**
 * The antennas of the island (src/vie/antennes.json, scripts/build-antennes.py), from two files of the ANFR: each mobile
 * antenna support with its operators, their generations and the state declared (en service, techniquement opérationnel,
 * projet approuvé), once a week; and the supports of FM radio, TNT and DAB+ stations over 5 W, once a month. A state
 * declared, never whether an antenna works right now. Bundled: no read at all.
 */
import { distanceKm } from "../geo.js";
import { INSEE } from "../places/insee.js";
import type { SourceInfo } from "../types.js";
import data from "./antennes.json" with { type: "json" };

export const OPERATEURS = ["Orange", "SFR Réunion", "Free", "Zeop"] as const;
export type Operateur = (typeof OPERATEURS)[number];
/** As declared to the ANFR, the most advanced first. */
export const ETATS = ["service", "operationnel", "projet"] as const;
export type Etat = (typeof ETATS)[number];
/** Each state's generations, « 2345 » for 2G to 5G. */
export type Generations = Partial<Record<Etat, string>>;

export interface Support {
  id: number;
  lon: number;
  lat: number;
  /** Height in metres, 0 when not declared. */
  h: number;
  insee: string;
  nature?: string;
  ops: Partial<Record<Operateur, Generations>>;
}

export interface Emetteur {
  id: number;
  lon: number;
  lat: number;
  h: number;
  insee: string;
  nature?: string;
  /** Stations of each kind on the support. */
  fm?: number;
  tnt?: number;
  dab?: number;
  /** TDF only; a private site is never named. */
  exploitants?: string[];
}

export const SUPPORTS = data.supports as Support[];
export const EMETTEURS = data.emetteurs as Emetteur[];
/** The days of the files, « 2026-10-22 » and « 2026-09-30 ». */
export const MOBILE_DU = data.mobile.fichier_du;
export const RADIO_DU = data.radio_tv.fichier_du;

/** The supports within `m` metres of the point, the closest first, each with its distance. */
export function near<T extends { lon: number; lat: number }>(list: T[], lon: number, lat: number, m = 500): (T & { d: number })[] {
  return list
    .map((x) => ({ ...x, d: distanceKm(lon, lat, x.lon, x.lat) * 1000 }))
    .filter((x) => x.d <= m)
    .sort((a, b) => a.d - b.d);
}

/** The generations a support has in that state, by any operator. */
export const generations = (s: Support, etat: Etat) => new Set(Object.values(s.ops).flatMap((g) => [...(g?.[etat] ?? "")]));

/** The commune's supports and broadcast supports. */
export function ofCommune(nom: string) {
  const insee = INSEE[nom];
  return { supports: SUPPORTS.filter((s) => s.insee === insee), emetteurs: EMETTEURS.filter((e) => e.insee === insee) };
}

/** « 22/10/2026 ». */
export const date = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export const SOURCE_MOBILE: SourceInfo = {
  id: "anfr_observatoire_mobile",
  nom: "Données sur les réseaux mobiles (antennes 2G, 3G, 4G, 5G)",
  organisme: "ANFR",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "ANFR, données sur les réseaux mobiles",
  url: data.mobile.page,
};

export const SOURCE_RADIO: SourceInfo = {
  id: "anfr_installations_5w",
  nom: "Données sur les installations radioélectriques de plus de 5 watts (émetteurs FM, TNT, DAB+)",
  organisme: "ANFR",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "ANFR, installations radioélectriques de plus de 5 watts",
  url: data.radio_tv.page,
};
