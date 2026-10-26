/**
 * Earthquakes located by the Observatoire volcanologique du Piton de la Fournaise (OVPF-IPGP), from the IPGP's FDSN
 * event service. No key; events appear once an analyst has located them (minutes to hours). Most are tiny
 * (magnitude under 1) and sit under the volcano's summit: their count, not their size, says the volcano is stirring.
 */
import type { Cache, Cached } from "../cache.js";
import gazetteer from "../places/gazetteer.json" with { type: "json" };
import { bearingDeg, distanceKm } from "../geo.js";
import { getText } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "ipgp_ovpf_seismes",
  nom: "Séismes localisés par l'Observatoire volcanologique du Piton de la Fournaise",
  organisme: "OVPF-IPGP (Institut de physique du globe de Paris)",
  licence: "CC BY 4.0",
  attribution: "OVPF-IPGP",
  url: "https://www.ipgp.fr/observation/observatoires/ovpf/",
};

const URL = "https://ws.ipgp.fr/fdsnws/event/1/query";
// The box of the island and its near offshore, where the OVPF network locates events.
const BOX = "minlat=-22&maxlat=-20.4&minlon=54.9&maxlon=56.2";
const DAYS = 30;
const FRESH_SECONDS = 10 * 60;

/** Dolomieu, the summit crater. */
export const SUMMIT = { lon: 55.7137, lat: -21.2443 };

export interface Seisme {
  id: string;
  /** ISO, UTC. */
  time: string;
  lon: number;
  lat: number;
  /** Below sea level; negative under the summit, which stands 2.6 km above it. */
  profondeur_km: number;
  magnitude: number;
  type_magnitude: string;
}

/** The FDSN text format: a header line starting with #, then one event per line, fields separated by |. */
export function parse(body: string): Seisme[] {
  const out: Seisme[] = [];
  for (const line of body.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const f = line.split("|");
    const mag = Number(f[10]);
    const lat = Number(f[2]);
    const lon = Number(f[3]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(mag)) continue;
    // The service writes times without a zone; they are UTC.
    const t = f[1].endsWith("Z") ? f[1] : `${f[1]}Z`;
    out.push({ id: f[0], time: new Date(t).toISOString(), lon, lat, profondeur_km: Number(f[4]), magnitude: mag, type_magnitude: f[9] });
  }
  return out.sort((a, b) => b.time.localeCompare(a.time));
}

const COMMUNES = (gazetteer as { places: { nom: string; type: string; lon: number; lat: number }[] }).places.filter(
  (p) => p.type === "commune",
);

const DIRECTIONS = ["au nord", "au nord-est", "à l'est", "au sud-est", "au sud", "au sud-ouest", "à l'ouest", "au nord-ouest"];

/** Where an event under the summit is said to be; /volcan says « sommet » in its section « sous le volcan ». */
export const SOMMET = "sous le sommet du Piton de la Fournaise";
/** Where an event is, in words: the summit, the Enclos, or a distance and direction from the nearest commune. */
export function where(lon: number, lat: number): string {
  const summit = distanceKm(SUMMIT.lon, SUMMIT.lat, lon, lat);
  if (summit <= 3) return SOMMET;
  if (summit <= 8) return `sous le massif du Piton de la Fournaise, à ${Math.round(summit)} km du sommet`;
  let best = COMMUNES[0];
  let d = Infinity;
  for (const c of COMMUNES) {
    const k = distanceKm(c.lon, c.lat, lon, lat);
    if (k < d) [best, d] = [c, k];
  }
  const dir = DIRECTIONS[Math.round(bearingDeg(best.lon, best.lat, lon, lat) / 45) % 8];
  const of = best.nom.replace(/^Le /, "du ").replace(/^Les /, "des ").replace(/^(?!du |des )/, "de ");
  return d < 3 ? `sous ${best.nom}` : `à ${Math.round(d)} km ${dir} ${of}`;
}

export function underSummit(s: Seisme): boolean {
  return distanceKm(SUMMIT.lon, SUMMIT.lat, s.lon, s.lat) <= 8;
}

/** Shared through KV (web/partagees.ts): a data center's own copy could be a day old where no one had asked. */
export const KEY = "seismes";

/** The last 30 days of the catalogue, read now. */
export async function read(now = new Date()): Promise<Seisme[]> {
  const start = new Date(now.getTime() - DAYS * 86_400_000).toISOString().slice(0, 19);
  // A few seconds: past them the observatory is down, not slow (26/10, nothing in 40 s), and its copy serves (cache.ts).
  return parse(await getText(SOURCE.id, `${URL}?${BOX}&format=text&orderby=time&starttime=${start}`, 8_000));
}

export async function seismes(cache: Cache, now = new Date()): Promise<Cached<Seisme[]>> {
  return cache.get(KEY, FRESH_SECONDS, () => read(now));
}
