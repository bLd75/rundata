/**
 * The ATMO air quality index of each commune of La Réunion, computed by Atmo Réunion and published by the Atmo France
 * federation as an open WFS layer (no account). One call gives the 24 communes for each day of the last diffusion
 * (the day itself and the next ones). It is the day's forecast index (1 good to 6 extremely bad, with one sub-index per
 * pollutant), not an hourly measurement. What the site and the tool say of how it is made comes from Atmo France's
 * calculation guide (GUIDE) alone.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";
import { INSEE } from "../places/insee.js";

export const SOURCE: SourceInfo = {
  id: "atmo_indice",
  nom: "Indice ATMO de la qualité de l'air par commune (Atmo Réunion, via Atmo France)",
  organisme: "Atmo Réunion, observatoire agréé de la qualité de l'air",
  licence: "ODbL 1.0",
  attribution: "Atmo Réunion / Atmo France",
  url: "https://www.atmo-reunion.net",
};

/** Atmo France's calculation guide of the index, version of 14/12/2020, in application of the order of 10 July 2020. */
export const GUIDE = "https://www.airpl.org/sites/default/files/reports/guide_calcul_nouvel_indice_ATMO_VF_version14decembre2020%281%29.pdf";
/** Atmo France's page of the index on data.gouv.fr, with its licence (ODbL). */
export const DIFFUSION = "https://www.data.gouv.fr/datasets/indice-de-la-qualite-de-lair-quotidien-par-commune-indice-atmo";
export const ODBL = "https://opendatacommons.org/licenses/odbl/1-0/";

/** Who makes the index, who spreads it, under which licence. */
export const PROVENANCE = {
  producteur: "Atmo Réunion, observatoire agréé de la qualité de l'air",
  diffuseur: "Atmo France, couche WFS ind_atmo_2021",
  licence: "ODbL 1.0",
  licence_lien: ODBL,
  fiche: DIFFUSION,
  site: "https://www.atmo-reunion.net",
};

/** The step the island's answer keeps (marketing, 30/10/2026): what changes what can be said by a busy road. */
export const FOND = "Il décrit l'air « de fond », loin des sources de pollution comme les axes de trafic routier.";

/** How the index is made, in the words of the guide (GUIDE), nothing it does not say. */
export const METHODE = [
  "C'est une prévision : l'indice décrit la qualité de l'air prévue sur une journée de 24 h, comptée à partir de 0 h TU (4 h à La Réunion).",
  "Les observatoires agréés comme Atmo Réunion le calculent de préférence avec leurs modèles, qui intègrent la météo, l'inventaire des émissions de polluants, des plateformes de prévision de la qualité de l'air et les mesures des stations de fond\u00a0; à défaut, avec la mesure de fond.",
  "Chaque polluant reçoit un sous-indice selon sa concentration : moyenne de la journée pour les particules PM2,5 et PM10, maximum horaire de la journée pour l'ozone, le dioxyde d'azote et le dioxyde de soufre.",
  "L'indice est le plus mauvais des cinq sous-indices. Calculé avec un modèle, celui d'une commune est l'indice du point du modèle le plus dégradé dans la commune.",
  FOND,
  "Il est diffusé chaque jour au plus tard à 12 h, heure locale, ou à 14 h en cas de difficulté.",
];

const URL =
  "https://data.atmo-france.org/geoserver/ind/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=ind_atmo_2021" +
  "&outputFormat=application/json&cql_filter=" + encodeURIComponent("code_zone LIKE '974%'") +
  "&propertyName=code_zone,lib_zone,date_ech,code_qual,code_no2,code_o3,code_pm10,code_pm25,code_so2,date_dif";
// Diffused once a day (date_dif), at 12 h local time at the latest by the guide; read every hour.
const FRESH_SECONDS = 60 * 60;

export const LEVELS = ["", "bon", "moyen", "dégradé", "mauvais", "très mauvais", "extrêmement mauvais"];
/** A level or sub-index in words; by the guide, 0 when it is missing and 7 for an event (an accident's emissions). */
export const level = (n: number) => (n === 0 ? "indisponible" : n === 7 ? "événement" : (LEVELS[n] ?? `niveau ${n}`));
export const POLLUTANTS: Record<string, string> = {
  code_pm10: "particules PM10",
  code_pm25: "particules fines PM2,5",
  code_o3: "ozone",
  code_no2: "dioxyde d'azote",
  code_so2: "dioxyde de soufre",
};

export interface Index {
  insee: string;
  commune: string;
  /** Local date YYYY-MM-DD. */
  jour: string;
  niveau: number;
  /** Sub-index per pollutant, keyed as in POLLUTANTS. */
  sous_indices: Record<string, number>;
  /** When Atmo Réunion diffused it (date_dif, ISO, UTC). */
  diffuse_le?: string;
}

type Props = { code_zone: string; lib_zone: string; date_ech: string; code_qual: number; date_dif?: string } & Record<string, unknown>;

// The commune's name from its INSEE code, as everywhere on the site: the layer writes « Petite-Ile », without its accent.
const NAMES = Object.fromEntries(Object.entries(INSEE).map(([nom, code]) => [code, nom]));

export function parse(json: { features: { properties: Props }[] }): Index[] {
  return json.features.map(({ properties: p }) => ({
    insee: p.code_zone,
    commune: NAMES[p.code_zone] ?? p.lib_zone,
    jour: p.date_ech.slice(0, 10),
    niveau: p.code_qual,
    sous_indices: Object.fromEntries(Object.keys(POLLUTANTS).map((k) => [k, Number(p[k])])),
    ...(p.date_dif && { diffuse_le: p.date_dif }),
  }));
}

export async function indices(cache: Cache): Promise<Cached<Index[]>> {
  return cache.get("atmo:974", FRESH_SECONDS, async () => parse(await getJson(SOURCE.id, URL, 20_000)));
}
