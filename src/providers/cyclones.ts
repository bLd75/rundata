/**
 * The tropical systems of the south-west Indian Ocean, from GDACS (Global Disaster Alert and Coordination System, the
 * European Commission and the United Nations), which republishes every 6 hours the advisories of the RSMC of
 * La Réunion (Météo-France), the centre in charge of the basin.
 *
 * - The event list gives every system with its dates and its last position (used only to keep the basin's); 100
 *   events a page, newest first, all basins together: a second page reaches back to the previous season.
 * - The timeline of an episode (one per advisory) gives each advisory's stage, in the RSMC's words; its address is in
 *   the episode's details. Only the systems still active are read that far, for the stage of their last advisory.
 *
 * Only the names, the dates and the stages are kept: no track, no position, no wind and no forecast of ours. The
 * official ones are on Météo-France's site (providers/vigilance.ts, OFFICIEL_CYCLONE). GDACS's winds are 1-minute
 * means, not the RSMC's figures.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import { why, type SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "gdacs_cyclones",
  nom: "Systèmes tropicaux du sud-ouest de l'océan Indien : noms, dates et stades du CMRS de La Réunion (via GDACS)",
  organisme: "CMRS de La Réunion (Météo-France), republié par GDACS (Commission européenne, Nations unies)",
  licence: "Réutilisation libre en citant la source (conditions d'utilisation de GDACS)",
  attribution: "Global Disaster Alert and Coordination System, GDACS\u00a0; CMRS de La Réunion (Météo-France)",
  url: "https://www.gdacs.org/Alerts/default.aspx",
};

const API = "https://www.gdacs.org/gdacsapi/api";
const LIST_FRESH_SECONDS = 30 * 60;
// An episode's timeline never changes once published; a new advisory is a new episode.
const TIMELINE_FRESH_SECONDS = 24 * 3600;
/** A system whose last advisory is older than this is over (one advisory every 6 hours while active). */
export const ACTIVE_HOURS = 18;
const MAX_DETAILED = 4;

/** The basin of the RSMC of La Réunion: equator to 40° S (a little further for the systems that leave it), African coast to 90° E. */
export function inBasin(lon: number, lat: number): boolean {
  return lon >= 25 && lon <= 90 && lat <= 0 && lat >= -50;
}

/** The stages of the RSMC, weakest first, with their names in Météo-France's bulletins. */
export const STAGES: Record<string, string> = {
  "Tropical Disturbance": "perturbation tropicale",
  Disturbance: "perturbation tropicale",
  Low: "zone perturbée",
  "Tropical Depression": "dépression tropicale",
  "Subtropical Depression": "dépression subtropicale",
  "Moderate Tropical Storm": "tempête tropicale modérée",
  "Severe Tropical Storm": "forte tempête tropicale",
  "Tropical Cyclone": "cyclone tropical",
  "Intense Tropical Cyclone": "cyclone tropical intense",
  "Very Intense Tropical Cyclone": "cyclone tropical très intense",
  "Post-tropical Depression": "dépression post-tropicale",
  "Extratropical System": "système extratropical",
  "Extratropical Depression": "dépression extratropicale",
  "Remnant Low": "dépression résiduelle",
  "Filling Up": "dépression en comblement",
  Dissipating: "en dissipation",
};

export function stage(english: string): string {
  return STAGES[english.trim()] ?? english.trim();
}

/** « FYTIA-26 » → « Fytia » ; an unnamed one, « 12-20252026-26 » → « système n° 12 (non baptisé) ». */
export function systemName(eventname: string): string {
  const unnamed = /^(\d+)-\d{8}-\d+$/.exec(eventname);
  if (unnamed) return `système n° ${Number(unnamed[1])} (non baptisé)`;
  const n = eventname.replace(/-\d+$/, "");
  return n.charAt(0) + n.slice(1).toLowerCase();
}

export interface Systeme {
  id: number;
  episode: number;
  nom: string;
  /** ISO, UTC. */
  debut: string;
  /** The last advisory, ISO, UTC. */
  fin: string;
  /** Last known position, only to keep the basin's systems: never shown. */
  lon: number;
  lat: number;
  /** Who issued the advisories: RSMC (La Réunion) or JTWC (for a system come from another basin). */
  centre: string;
  alerte_gdacs: string;
  rapport: string;
}

interface RawEvent {
  geometry: { type: string; coordinates: number[] };
  properties: {
    eventid: number;
    episodeid: number;
    eventname: string;
    fromdate: string;
    todate: string;
    alertlevel: string;
    source: string;
    url?: { report?: string };
  };
}

const utc = (s: string) => (s.endsWith("Z") ? s : `${s}Z`);

export function parseList(raw: { features?: RawEvent[] }): Systeme[] {
  return (raw.features ?? [])
    .filter((f) => f.geometry?.type === "Point" && inBasin(f.geometry.coordinates[0], f.geometry.coordinates[1]))
    .map((f) => {
      const p = f.properties;
      return {
        id: p.eventid,
        episode: p.episodeid,
        nom: systemName(p.eventname),
        debut: new Date(utc(p.fromdate)).toISOString(),
        fin: new Date(utc(p.todate)).toISOString(),
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        centre: p.source === "RSMC" ? "CMRS de La Réunion" : p.source === "JTWC" ? "JTWC (centre américain, système venu d'un autre bassin)" : p.source,
        alerte_gdacs: p.alertlevel,
        rapport: p.url?.report ?? `https://www.gdacs.org/report.aspx?eventid=${p.eventid}&episodeid=${p.episodeid}&eventtype=TC`,
      };
    });
}

/** One advisory of a system: its time and its stage, in the RSMC's words. */
export interface Avis {
  /** ISO, UTC. */
  heure: string;
  stade: string;
}

interface RawItem {
  actual: string;
  advisory_datetime?: string;
  storm_status?: string[] | string;
}

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/** « 03 Feb 2026 06:00 » (UTC) → ISO. */
export function advisoryTime(s: string): string | undefined {
  const m = /^(\d\d) (\w{3}) (\d{4}) (\d\d:\d\d)$/.exec(s.trim());
  return m && MONTHS[m[2]] ? `${m[3]}-${MONTHS[m[2]]}-${m[1]}T${m[4]}:00.000Z` : undefined;
}

/** The last advisory issued (not a forecast), with its stage; undefined when the timeline has none. */
export function parseTimeline(raw: { channel?: { item?: RawItem[] } }): Avis | undefined {
  let last: Avis | undefined;
  for (const it of raw.channel?.item ?? []) {
    const heure = it.advisory_datetime ? advisoryTime(it.advisory_datetime) : undefined;
    const status = Array.isArray(it.storm_status) ? it.storm_status[0] : it.storm_status;
    if (it.actual !== "True" || !heure || !status?.trim()) continue;
    if (!last || heure > last.heure) last = { heure, stade: stage(status) };
  }
  return last;
}

/** July to June: the 2026-2027 season starts on 1 July 2026. */
export function seasonOf(d: Date): { nom: string; debut: string } {
  const y = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return { nom: `${y}-${y + 1}`, debut: `${y}-07-01T00:00:00.000Z` };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Every system of the basin since the start of the previous season, newest first. */
export async function systemes(cache: Cache, now = new Date()): Promise<Cached<Systeme[]>> {
  const since = `${Number(seasonOf(now).debut.slice(0, 4)) - 1}-07-01T00:00:00.000Z`;
  return cache.get("cyclones:liste", LIST_FRESH_SECONDS, async () => {
    const url = (page: number) =>
      `${API}/events/geteventlist/SEARCH?eventlist=TC&alertlevel=Green;Orange;Red&fromDate=${since.slice(0, 10)}&toDate=${day(now)}${page > 1 ? `&pagenumber=${page}` : ""}`;
    const first = await getJson<{ features?: RawEvent[] }>(SOURCE.id, url(1), 20_000);
    let all = first.features ?? [];
    const oldest = all.reduce((m, f) => (f.properties.fromdate < m ? f.properties.fromdate : m), "9999");
    // A full page that does not reach back to the previous season: the rest is on the next one.
    if (all.length >= 100 && utc(oldest) > since) {
      const second = await getJson<{ features?: RawEvent[] }>(SOURCE.id, url(2), 20_000).catch(() => ({ features: [] }));
      all = [...all, ...(second.features ?? [])];
    }
    const seen = new Set<number>();
    return parseList({ features: all })
      .filter((s) => !seen.has(s.id) && seen.add(s.id))
      .sort((a, b) => b.fin.localeCompare(a.fin));
  });
}

export function isActive(s: Systeme, now: Date): boolean {
  return now.getTime() - new Date(s.fin).getTime() < ACTIVE_HOURS * 3600_000 && s.debut <= now.toISOString();
}

/** A system's last advisory, with its stage. */
export async function dernierAvis(cache: Cache, s: Systeme): Promise<Cached<Avis | undefined>> {
  return cache.get(`cyclones:avis:${s.id}:${s.episode}`, TIMELINE_FRESH_SECONDS, async () => {
    const ep = await getJson<{ properties?: { impacts?: { resource?: { timeline?: string } }[] } }>(
      SOURCE.id,
      `${API}/events/getepisodedata?eventtype=TC&eventid=${s.id}&episodeid=${s.episode}`,
      20_000,
    );
    const timeline = ep.properties?.impacts?.find((i) => i.resource?.timeline)?.resource?.timeline;
    if (!timeline?.startsWith(`${API}/export/gettimeline`)) throw new Error(`gdacs : pas d'avis pour ${s.nom}`);
    return parseTimeline(await getJson(SOURCE.id, timeline, 20_000));
  });
}

/** The active systems with their last advisory (at most a few: each costs two requests). One that fails has none. */
export async function actifs(cache: Cache, list: Systeme[], now: Date): Promise<{ systeme: Systeme; avis?: Avis }[]> {
  const active = list.filter((s) => isActive(s, now)).slice(0, MAX_DETAILED);
  return Promise.all(active.map(async (systeme) => {
    try {
      return { systeme, avis: (await dernierAvis(cache, systeme)).value };
    } catch (err) {
      console.error(`source ${SOURCE.id} : dernier avis de ${systeme.nom} indisponible:`, why(err));
      return { systeme };
    }
  }));
}
