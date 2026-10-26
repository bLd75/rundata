/**
 * The ATMO air quality index of each commune of La Réunion, computed by Atmo Réunion and published by the Atmo France
 * federation as an open WFS layer (no account). One call gives the 24 communes for today and tomorrow. It is the
 * day's forecast index (1 good to 6 extremely bad, with one sub-index per pollutant), not an hourly measurement.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "atmo_indice",
  nom: "Indice ATMO de la qualité de l'air par commune (Atmo Réunion, via Atmo France)",
  organisme: "Atmo Réunion, observatoire agréé de la qualité de l'air",
  licence: "ODbL 1.0",
  attribution: "Atmo Réunion / Atmo France",
  url: "https://www.atmo-reunion.net",
};

const URL =
  "https://data.atmo-france.org/geoserver/ind/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=ind_atmo_2021" +
  "&outputFormat=application/json&cql_filter=" + encodeURIComponent("code_zone LIKE '974%'") +
  "&propertyName=code_zone,lib_zone,date_ech,code_qual,code_no2,code_o3,code_pm10,code_pm25,code_so2,date_maj";
// Published once a day around 12:30; read every hour.
const FRESH_SECONDS = 60 * 60;

export const LEVELS = ["", "bon", "moyen", "dégradé", "mauvais", "très mauvais", "extrêmement mauvais"];
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
  mis_a_jour: string;
}

type Props = { code_zone: string; lib_zone: string; date_ech: string; code_qual: number; date_maj: string } & Record<string, unknown>;

export function parse(json: { features: { properties: Props }[] }): Index[] {
  return json.features.map(({ properties: p }) => ({
    insee: p.code_zone,
    commune: p.lib_zone,
    jour: p.date_ech.slice(0, 10),
    niveau: p.code_qual,
    sous_indices: Object.fromEntries(Object.keys(POLLUTANTS).map((k) => [k, Number(p[k])])),
    mis_a_jour: p.date_maj,
  }));
}

export async function indices(cache: Cache): Promise<Cached<Index[]>> {
  return cache.get("atmo:974", FRESH_SECONDS, async () => parse(await getJson(SOURCE.id, URL, 20_000)));
}
