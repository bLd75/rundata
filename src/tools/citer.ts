/**
 * What every tool's answer ends with, added in one place (server.ts) so that no tool is missed:
 * - `citer`: how to name where the answer comes from, « rundata.re, d'après Météo-France (station Le Port) », made from
 *   the sources the answer credits. rundata.re is added to the producers, never put in their place: their licences
 *   ask that they be named, and `sources` keeps their full attribution;
 * - `lien`: the rundata.re page that shows the same thing (the place's weather, the category, the commune);
 * - `fraicheur`: when the data dates from, when rundata.re read it, its age, and a last copy served in place of a
 *   source that did not answer (fraicheur.ts);
 * - `avis`, only when the answer found nothing or did not understand: a pointer to the tool donner_avis;
 * - `serveur`: the version and the newest tools, for a client whose list of tools is old (nouveautes.ts).
 * The fields are spliced into the JSON text as it is, a few dozen tokens in all.
 */
import type { Lecture } from "../lectures.js";
import type { SourceInfo } from "../types.js";
import { pageOf, slugify } from "../web/places.js";
import { credited } from "./format.js";
import { fraicheur } from "./fraicheur.js";

export const SITE_URL = "https://rundata.re";
export const AVIS_HINT = "Une donnée manque ou semble fausse, ou l'utilisateur a un souhait ? Le dire à rundata.re avec l'outil donner_avis.";

// The category page showing what each tool answers; the others link to the commune's page, or to the home page.
const PAGES: Record<string, string> = {
  meteo_actuelle: "/meteo",
  prevision_meteo: "/meteo",
  temperature_mer: "/mer",
  maree: "/mer",
  vigilance_meteo: "/vigilance",
  volcan_seismes: "/volcan",
  electricite: "/electricite",
  calendrier: "/calendrier",
  qualite_air: "/air",
  transports: "/bus",
  velos_libre_service: "/velos",
  bornes_recharge: "/bornes",
  qualite_eau: "/eau",
  sentiers_randonnee: "/sentiers",
  restrictions_eau: "/secheresse",
  coupures_eau: "/coupures-eau",
  defibrillateurs: "/defibrillateurs",
  sport: "/sport",
  cyclones: "/cyclones",
  historique_meteo: "/historique",
  evenements: "/evenements",
  actualites: "/actualites",
};
const WEATHER = new Set(["meteo_actuelle", "prevision_meteo"]);

type Payload = Record<string, unknown>;

// Producers whose attribution is long or in English, by source id: the name a sentence can carry.
const SHORT: Record<string, string> = {
  metar: "Météo-France",
  pioupiou: "OpenWindMap",
  openmeteo: "Open-Meteo (modèle IFS de l'ECMWF)",
  openmeteo_houle: "Open-Meteo (modèle de vagues WAM de l'ECMWF)",
  cams_uv: "Copernicus (CAMS), via Open-Meteo",
  refmar: "SHOM (REFMAR)",
  gdacs_cyclones: "CMRS de La Réunion (Météo-France), via GDACS",
  acspo: "NOAA CoastWatch",
  modis: "NASA MODIS",
};

/** The producer's name for a sentence; else its attribution without web address (« © VIGICRUES, DEAL Réunion »). */
const shortName = (s: SourceInfo) => SHORT[s.id] ?? s.attribution.replace(/\s*<?https?:\/\/\S+>?/g, "").replace(/[\s.;,]+$/, "");

function stationsOf(p: Payload): { station?: unknown; source?: unknown }[] {
  return Array.isArray(p.stations) ? (p.stations as { station?: unknown; source?: unknown }[]).filter((s) => s && typeof s === "object") : [];
}

/** « rundata.re, d'après Météo-France (station Le Port), OpenWindMap » from the sources an answer credits. */
export function citation(p: Payload): string {
  // Each credit as credits() writes it (format.ts), or a source given whole (sources_donnees).
  const listed = (Array.isArray(p.sources) ? p.sources : [])
    .map((c: { source?: unknown; nom?: unknown; attribution?: unknown }) =>
      typeof c?.source === "string" ? credited(c.source) : typeof c?.attribution === "string" && typeof c.nom === "string" ? (c as SourceInfo) : undefined)
    .filter((s): s is SourceInfo => !!s);
  const stations = stationsOf(p);
  // The weather lists every network it asked; only those of the stations shown count, and the radar if it spoke.
  const ids = new Set(stations.map((s) => s.source).filter((x): x is string => typeof x === "string"));
  const used = ids.size ? listed.filter((s) => ids.has(s.id) || (s.id === "mf_radar" && p.radar)) : listed;
  // The station, when the answer is about one place: « station Le Port », « Balise Maïdo ».
  const first = p.lieu && typeof p.lieu === "object" ? stations[0] : undefined;
  // Without what its name says in brackets: « Saint-Pierre Pierrefonds (aéroport) » is cited « station Saint-Pierre Pierrefonds ».
  const named = typeof first?.station === "string" ? first.station.replace(/\s*\([^)]*\)/g, "").trim() : "";
  const station = named ? (/^(balise|station)\b/i.test(named) ? named.replace(/^\p{Lu}/u, (c) => c.toLowerCase()) : `station ${named}`) : undefined;
  const firstId = typeof first?.source === "string" ? first.source : used[0]?.id;
  const names: string[] = [];
  for (const s of station ? [...used.filter((s) => s.id === firstId), ...used.filter((s) => s.id !== firstId)] : used) {
    const n = shortName(s);
    if (!names.some((x) => x.startsWith(n))) names.push(names.length === 0 && station ? `${n} (${station})` : n);
  }
  if (!names.length) return "rundata.re";
  return `rundata.re, d'après ${names.slice(0, 3).join(", ")}${names.length > 3 ? " et d'autres" : ""}`;
}

/** The rundata.re page to give with the answer, tagged so that the site knows the visit came from an assistant. */
export function lien(tool: string, p: Payload): string {
  const lieu = p.lieu && typeof p.lieu === "object" ? (p.lieu as { trouve?: unknown; commune?: unknown }) : {};
  const page = (n: unknown) => (typeof n === "string" && n ? pageOf(slugify(n)) : undefined);
  const commune = page(lieu.commune) ?? (page(lieu.trouve)?.commune ? page(lieu.trouve) : undefined);
  const place = page(lieu.trouve) ?? commune;
  let path = PAGES[tool];
  if (WEATHER.has(tool) && place) path = `/meteo/${place.slug}`;
  else if (!path) path = commune ? `/communes/${commune.slug}` : "/";
  return `${SITE_URL}${path}?ref=mcp`;
}

/** An answer that found nothing for what was asked, or did not understand it: worth telling rundata.re. */
function wanting(p: Payload, isError: boolean): boolean {
  if (isError) return typeof p.erreur === "string" && /introuvable/i.test(p.erreur);
  if (typeof p.resume === "string" && /\bAucun\w*\b[^.;]*\btrouv[ée]/.test(p.resume)) return true;
  return Object.keys(p).some((k) => k.endsWith("_non_compris") && p[k]);
}

/** What the server adds besides the citation (server.ts): the entries the call read, and the `serveur` block. */
export interface Around {
  lectures?: Lecture[];
  now?: Date;
  serveur?: object;
}

/**
 * The answer with `citer`, `lien`, `fraicheur`, `avis` when it found nothing, and `serveur` at the end. Left as is if
 * it is not JSON.
 */
export function cite<R extends object>(tool: string, r: R, around: Around = {}): R {
  const content = (r as { content?: { type: string; text: string }[] }).content;
  const t = content?.[0]?.type === "text" ? content[0].text : undefined;
  if (!t || !t.endsWith("}")) return r;
  let p: Payload;
  try {
    p = JSON.parse(t) as Payload;
  } catch {
    return r;
  }
  if (!p || typeof p !== "object" || Array.isArray(p)) return r;
  const isError = "isError" in r && !!r.isError;
  const extra: Payload = { citer: citation(p), lien: lien(tool, p), fraicheur: fraicheur(p, around.lectures ?? [], around.now ?? new Date()) };
  if (wanting(p, isError)) extra.avis = AVIS_HINT;
  if (around.serveur) extra.serveur = around.serveur;
  const fields = Object.entries(extra).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n");
  const text = /\n}$/.test(t) ? `${t.slice(0, -2)},\n${fields}\n}` : JSON.stringify({ ...p, ...extra }, null, 1);
  return { ...r, content: [{ ...content![0], text }, ...content!.slice(1)] };
}
