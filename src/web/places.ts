/**
 * The places that get a page of their own at /meteo/<slug>: the 24 communes, plus the few places people search
 * the weather of by their own name. Each is resolved through the gazetteer, like a question to the tools.
 */
import gazetteer from "../places/gazetteer.json" with { type: "json" };
import { resolvePlace } from "../places/resolve.js";
import type { Place } from "../places/resolve.js";

export interface PlacePage {
  slug: string;
  /** The name shown and searched for (« Piton de la Fournaise », not the viewpoint the gazetteer answers with). */
  nom: string;
  /** What `meteo_actuelle` and the other tools are asked about. */
  lieu: string;
  /** Short words after the name in titles: « cirque », « volcan »… */
  precision?: string;
  place: Place;
  commune: boolean;
}

const EXTRAS: { nom: string; lieu?: string; precision: string }[] = [
  { nom: "Piton de la Fournaise", precision: "volcan" },
  { nom: "Maïdo", precision: "belvédère" },
  { nom: "Plaine des Cafres", precision: "Hauts du Tampon" },
  { nom: "Hell-Bourg", precision: "cirque de Salazie" },
  { nom: "L'Hermitage", precision: "plage et lagon" },
  { nom: "Saint-Gilles-les-Bains", precision: "station balnéaire" },
];

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function page(nom: string, lieu: string, commune: boolean, precision?: string): PlacePage {
  const r = resolvePlace(lieu);
  if (!r) throw new Error(`lieu inconnu du gazetteer : ${lieu}`);
  return { slug: slugify(nom), nom, lieu, precision, place: r.lieu, commune };
}

const COMMUNES = (gazetteer as { places: { nom: string; type: string }[] }).places
  .filter((p) => p.type === "commune")
  .map((p) => p.nom)
  .sort((a, b) => a.localeCompare(b, "fr"));

export const PAGES: PlacePage[] = [
  ...COMMUNES.map((n) => page(n, n, true)),
  ...EXTRAS.map((e) => page(e.nom, e.lieu ?? e.nom, false, e.precision)),
];

const BY_SLUG = new Map(PAGES.map((p) => [p.slug, p]));

export function pageOf(slug: string): PlacePage | undefined {
  return BY_SLUG.get(slug);
}

/** Beaches and the coast get the sea temperature; the Hauts and the cirques do not. */
export function coastal(p: PlacePage): boolean {
  return p.place.type === "plage" || (p.place.altitude_m ?? 999) < 80;
}
