/**
 * Météo-France's weather vigilance for La Réunion, cyclone alert included, from the API DPVigilance
 * (`vigilanceom/flux/dernier`, same key as the stations). The flow is one zip for all the overseas territories,
 * refreshed every minute; La Réunion is in two files: CDPV95_FMEE_ (colour per zone, phenomenon and hour, for 24 h)
 * and CDPV96_FMEE_ (the follow-up texts). Codes not in the API's own documentation come from the public page
 * vigilance.meteofrance.fr/fr/la-reunion (zone names, phenomena), checked on 2026-10-22.
 */
import type { Cache, Cached } from "../cache.js";
import { getBytes } from "../http.js";
import type { SourceInfo } from "../types.js";
import { unzip } from "../zip.js";
import { download, session } from "./mf-auth.js";

export { enabled } from "./mf-auth.js";

export const SOURCE: SourceInfo = {
  id: "mf_vigilance",
  nom: "Vigilance météo et alerte cyclonique de La Réunion (Météo-France)",
  organisme: "Météo-France, direction interrégionale de l'océan Indien",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Météo-France",
  url: "https://vigilance.meteofrance.fr/fr/la-reunion",
};

const URL = "https://public-api.meteofrance.fr/public/DPVigilance/v1/vigilanceom/flux/dernier";
// The zip changes every minute but the vigilance a few times a day, more often during an event.
const FRESH_SECONDS = 5 * 60;
const MAP = "CDPV95_FMEE_.txt";
const TEXTS = "CDPV96_FMEE_.txt";

export const CYCLONE = 10;
export const PHENOMENA: Record<number, string> = {
  [CYCLONE]: "Alerte cyclonique",
  12: "Fortes pluies / orages",
  1: "Vents forts",
  9: "Vagues - submersion",
};

export const ISLAND = "VIGI974";
export const ZONES: Record<string, string> = {
  [ISLAND]: "La Réunion",
  "VIGI974-11": "Nord : Saint-Denis, Sainte-Marie",
  "VIGI974-12": "Est : Sainte-Suzanne, Saint-André, Salazie, Bras-Panon, Saint-Benoît, La Plaine-des-Palmistes, Sainte-Rose",
  "VIGI974-13": "Sud-Est : Saint-Joseph, Saint-Philippe",
  "VIGI974-14": "Sud : Saint-Pierre, Le Tampon, L'Entre-Deux, Saint-Louis, Cilaos, L'Étang-Salé, Les Avirons, Petite-Île",
  "VIGI974-15": "Ouest : Saint-Leu, Les Trois-Bassins, Saint-Paul, Le Port, La Possession",
  "VIGI974-51": "Zone côtière de Champ Borne au Cap Bernard",
  "VIGI974-52": "Zone côtière de la Pointe des Cascades à Champ Borne",
  "VIGI974-53": "Zone côtière de la Pointe de la Table à la Pointe des Cascades",
  "VIGI974-54": "Zone côtière du Cap Chevron (Saint-Joseph) à la Pointe de la Table",
  "VIGI974-55": "Zone côtière de la Pointe au Sel au Cap Chevron (Saint-Joseph)",
  "VIGI974-56": "Zone côtière de la Pointe des Aigrettes à la Pointe au Sel",
  "VIGI974-57": "Zone côtière de la Pointe des Galets à la Pointe des Aigrettes",
  "VIGI974-58": "Zone côtière du Cap Bernard à la Pointe des Galets",
};

/** The land zone of each commune (spelled as in the gazetteer). */
export const ZONE_OF_COMMUNE: Record<string, string> = Object.fromEntries(
  (
    [
      ["VIGI974-11", ["Saint-Denis", "Sainte-Marie"]],
      ["VIGI974-12", ["Sainte-Suzanne", "Saint-André", "Salazie", "Bras-Panon", "Saint-Benoît", "La Plaine-des-Palmistes", "Sainte-Rose"]],
      ["VIGI974-13", ["Saint-Joseph", "Saint-Philippe"]],
      ["VIGI974-14", ["Saint-Pierre", "Le Tampon", "Entre-Deux", "Saint-Louis", "Cilaos", "L'Étang-Salé", "Les Avirons", "Petite-Île"]],
      ["VIGI974-15", ["Saint-Leu", "Les Trois-Bassins", "Saint-Paul", "Le Port", "La Possession"]],
    ] as const
  ).flatMap(([zone, communes]) => communes.map((c) => [c, zone])),
);

// -1: no vigilance issued for this zone and phenomenon (outside a cyclone alert, or a coast without a warning).
export const COLOURS: Record<number, string> = { 1: "vert", 2: "jaune", 3: "orange", 4: "rouge" };

export function colour(id: number): string {
  return COLOURS[id] ?? `code ${id} (non reconnu : voir le site de Météo-France)`;
}

/** Hours of one colour, run together. `fin` is missing on the last one (valid until the next bulletin). */
export interface Period {
  couleur: number;
  debut: string;
  fin?: string;
}

export interface Vigilance {
  /** When Météo-France issued the map, ISO. */
  emise: string;
  /** zone → phenomenon id → periods; only the zones and phenomena with something issued (colour ≥ 1). */
  zones: Record<string, Record<number, Period[]>>;
  /** The follow-up texts, by phenomenon title. */
  suivi: { titre: string; texte: string }[];
}

interface MapJson {
  update_time: string;
  timelaps: {
    domain_ids: {
      domain_id: string;
      phenomenon_items: {
        phenomenon_id: number;
        timelaps_items: { color_id: number; begin_time: string; end_time?: string }[];
      }[];
    }[];
  };
}

interface TextsJson {
  text_bloc_items?: { text_items?: { title: string; text: string[] }[] }[];
}

export function parse(map: MapJson, texts?: TextsJson): Vigilance {
  const zones: Vigilance["zones"] = {};
  for (const d of map.timelaps.domain_ids) {
    for (const p of d.phenomenon_items) {
      const periods: Period[] = [];
      for (const t of p.timelaps_items) {
        const last = periods[periods.length - 1];
        if (last && last.couleur === t.color_id && last.fin === t.begin_time) last.fin = t.end_time;
        else periods.push({ couleur: t.color_id, debut: t.begin_time, fin: t.end_time });
      }
      if (periods.every((x) => x.couleur < 1)) continue;
      (zones[d.domain_id] ??= {})[p.phenomenon_id] = periods;
    }
  }
  const suivi = (texts?.text_bloc_items ?? []).flatMap((b) =>
    (b.text_items ?? []).map((t) => ({ titre: t.title, texte: t.text.join(" ").trim() })),
  );
  return { emise: map.update_time, zones, suivi };
}

export async function vigilance(cache: Cache): Promise<Cached<Vigilance>> {
  return cache.get("vigilance", FRESH_SECONDS, async () => {
    const zip = await download(URL, session(SOURCE.id), getBytes, 20_000);
    const files = await unzip(zip, (name) => name === MAP || name === TEXTS);
    const map = files.get(MAP);
    if (!map) throw new Error(`vigilance : ${MAP} absent de l'archive`);
    const texts = files.get(TEXTS);
    return parse(JSON.parse(map) as MapJson, texts ? (JSON.parse(texts) as TextsJson) : undefined);
  });
}
