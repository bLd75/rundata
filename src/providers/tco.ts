/**
 * « Météo des déchèteries » of the Territoire de l'Ouest (data.tco.re, Licence Ouverte): for each déchèterie of the
 * TCO and each kind of waste, whether its skip still takes it (true) or is full and refuses it (false), filled in by
 * the staff about every two hours, each site with its own time. The sites themselves are bundled
 * (src/vie/decheteries.json).
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "tco_decheteries",
  nom: "Météo des déchèteries du Territoire de l'Ouest",
  organisme: "Territoire de l'Ouest (TCO)",
  licence: "Licence Ouverte (Etalab)",
  attribution: "Territoire de l'Ouest (TCO)",
  url: "https://data.tco.re/explore/dataset/meteo-des-decheteries/",
};

const URL = "https://data.tco.re/api/explore/v2.1/catalog/datasets/meteo-des-decheteries/records?limit=100";

/** The kinds of waste, as the dataset names them, in words. */
export const WASTES: Record<string, string> = {
  encombrants: "encombrants",
  dechets_verts: "déchets verts",
  deblais_gravats: "gravats",
  placo: "placo",
  metaux: "métaux",
  mobilier: "mobilier",
  gros_electromenager: "gros électroménager",
  refrigerateurs_congelateurs: "réfrigérateurs et congélateurs",
  petits_appareils_menagers: "petits appareils ménagers",
  ecrans: "écrans",
  papiers_cartons: "papiers et cartons",
  journaux_revues: "journaux et revues",
  emballages_metalliques: "emballages métalliques",
  bouteilles_plastiques: "bouteilles plastiques",
  verres: "verre",
  textiles_chaussures: "textiles et chaussures",
  batteries: "batteries",
  piles: "piles",
  huiles: "huiles de vidange",
  neons: "néons",
  lampes: "lampes",
  compost: "compost",
};

export interface Etat {
  /** The site's page on tco.re: what ties it to the bundled list. */
  lien: string;
  /** When the staff last filled it in, ISO. */
  maj?: string;
  /** Each kind of waste: true when its skip still takes it. */
  accepte: Record<string, boolean>;
}

/** The dataset's records: « 20261024 » and « 17:00:32 » are the time at La Réunion. */
export function parse(json: { results?: Record<string, unknown>[] }): Etat[] {
  return (json.results ?? []).filter((r) => typeof r.lien === "string").map((r) => {
    const d = String(r.date_mise_jour ?? "");
    const h = String(r.heures_mise_jour ?? "");
    const maj = /^\d{8}$/.test(d) && /^\d\d:\d\d(:\d\d)?$/.test(h) ? new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${h.slice(0, 5)}:00+04:00`).toISOString() : undefined;
    const accepte: Record<string, boolean> = {};
    for (const k of Object.keys(WASTES)) if (r[k] === 0 || r[k] === 1) accepte[k] = r[k] === 1;
    return { lien: r.lien as string, maj, accepte };
  });
}

// The dataset is republished every hour.
const FRESH_SECONDS = 30 * 60;

export function meteo(cache: Cache): Promise<Cached<Etat[]>> {
  return cache.get("tco:meteo", FRESH_SECONDS, async () => parse(await getJson(SOURCE.id, URL, 15_000)));
}
