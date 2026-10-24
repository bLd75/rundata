/**
 * The hiking trails and forest roads of La Réunion managed by the ONF, and whether each is open: the layer behind
 * the ONF's public map of closed trails (onf.fr, « Randonnée à La Réunion : connaître les sentiers fermés »), kept up to
 * date by its agents from the prefect's orders and its own decisions. An ArcGIS feature service, no account: one call
 * for the trails, one for the roads, one for the date of the last edit. The lines come simplified (about 100 m), enough
 * to tell which trails pass near a place.
 *
 * Trails outside the ONF's management (« hors gestion ONF ») are listed with an unknown state: the ONF does not say.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "onf_sentiers",
  nom: "Sentiers et routes forestières ouverts ou fermés (ONF La Réunion)",
  organisme: "Office national des forêts, direction régionale de La Réunion",
  licence: "Information publique (carte des sentiers de l'ONF)",
  attribution: "ONF La Réunion",
  url: "https://www.onf.fr/vivre-la-foret/+/b90::randonnee-la-reunion-connaitre-les-sentiers-fermes.html",
};

const SERVICE = "https://services1.arcgis.com/Y4HgaQpzkE7kenlE/arcgis/rest/services/Sentiers_La_Reunion_public/FeatureServer";
const TRAILS = 5;
const ROADS = 4;
// The ONF edits the map a few times a week; an hour is plenty.
const FRESH_SECONDS = 3600;

export type Statut = "ouvert" | "fermé" | "hors gestion ONF" | "inconnu";
type Point = [number, number];

export interface Sentier {
  nom: string;
  statut: Statut;
  /** Why it is closed: « Sentier dégradé », « Danger éboulement… ». */
  cause?: string;
  /** When it reopens, or the conditions: « Réouverture 2026 », « Fermé jusqu'au 30/10/26 inclus… ». */
  info?: string;
  longueur_km: number;
  /** Simplified line, longitude and latitude. */
  points: Point[];
}

export interface Route {
  nom: string;
  circulation: string;
  cause?: string;
  info?: string;
  vitesse_max?: string;
  reglementation?: string;
  longueur_km: number;
  points: Point[];
}

export interface Carte {
  sentiers: Sentier[];
  routes: Route[];
  /** When the ONF last edited the layer, ISO. */
  mise_a_jour?: string;
}

interface Feature {
  attributes: Record<string, string | number | null>;
  geometry?: { paths?: Point[][] };
}

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "") || undefined;

function statut(v: unknown): Statut {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("hors gestion")) return "hors gestion ONF";
  if (s.includes("ferm")) return "fermé";
  if (s.includes("ouvert")) return "ouvert";
  return "inconnu";
}

const line = (f: Feature): Point[] => (f.geometry?.paths ?? []).flat();

export function parseTrails(features: Feature[]): Sentier[] {
  return features
    .filter((f) => clean(f.attributes.WS_NomIti))
    .map((f) => {
      const a = f.attributes;
      return {
        nom: clean(a.WS_NomIti)!.replace(/\s*\(hors gestion ONF\)\s*$/i, ""),
        statut: statut(a.WS_Statut),
        cause: clean(a.WS_InfCaus),
        info: clean(a.WS_InfDate),
        longueur_km: Math.round(Number(a.WS_LongM ?? 0) / 100) / 10,
        points: line(f),
      };
    });
}

export function parseRoads(features: Feature[]): Route[] {
  return features
    .filter((f) => clean(f.attributes.WR_NomRF))
    .map((f) => {
      const a = f.attributes;
      return {
        nom: clean(a.WR_NomRF)!,
        // « Circulation autorisé » on some rows.
        circulation: (clean(a.WR_Circ) ?? "inconnue").replace(/^Circulation autorisé$/, "Circulation autorisée"),
        cause: clean(a.WR_InfCaus),
        info: clean(a.WR_InfDate),
        vitesse_max: clean(a.WR_InfVMax),
        reglementation: clean(a.WR_IntRegl),
        longueur_km: Math.round(Number(a.WR_LongKm ?? 0) * 10) / 10,
        points: line(f),
      };
    });
}

const query = (layer: number, fields: string) =>
  `${SERVICE}/${layer}/query?${new URLSearchParams({
    where: "1=1",
    outFields: fields,
    returnGeometry: "true",
    outSR: "4326",
    maxAllowableOffset: "0.001",
    geometryPrecision: "4",
    f: "json",
  })}`;

export async function carte(cache: Cache): Promise<Cached<Carte>> {
  return cache.get("onf:sentiers", FRESH_SECONDS, async () => {
    const [trails, roads, meta] = await Promise.all([
      getJson<{ features: Feature[] }>(SOURCE.id, query(TRAILS, "WS_NomIti,WS_Statut,WS_InfCaus,WS_InfDate,WS_LongM"), 25_000),
      getJson<{ features: Feature[] }>(SOURCE.id, query(ROADS, "WR_NomRF,WR_Circ,WR_InfCaus,WR_InfDate,WR_InfVMax,WR_IntRegl,WR_LongKm"), 25_000),
      getJson<{ editingInfo?: { dataLastEditDate?: number } }>(SOURCE.id, `${SERVICE}/${TRAILS}?f=json`, 15_000).catch(() => null),
    ]);
    if (!trails.features?.length) throw new Error("carte des sentiers vide");
    const edited = meta?.editingInfo?.dataLastEditDate;
    return {
      sentiers: parseTrails(trails.features),
      routes: parseRoads(roads.features ?? []),
      mise_a_jour: edited ? new Date(edited).toISOString() : undefined,
    };
  });
}
