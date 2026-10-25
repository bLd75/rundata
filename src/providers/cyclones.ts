/**
 * The tropical systems of the south-west Indian Ocean, from GDACS (Global Disaster Alert and Coordination System, the
 * European Commission and the United Nations), which republishes every 6 hours the advisories of the RSMC of
 * La Réunion (Météo-France), the centre in charge of the basin: position, wind, pressure, stage, and its forecast.
 *
 * - The event list gives every system with its last position and its strongest wind; 100 events a page, newest
 *   first, all basins together: a second page reaches back to the previous season.
 * - The timeline of an episode (one per advisory) gives the track so far and the RSMC's forecast; its address is in
 *   the episode's details. Only the systems still active are read that far.
 *
 * GDACS gives winds as 1-minute means: the RSMC's own figures are 10-minute means, smaller by a factor of 1.14
 * (FYTIA, 31 January 2026: 179 km/h at GDACS, 85 kt at the RSMC). They are divided back here, so that the stages
 * and the figures match Météo-France's bulletins.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import { why, type SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "gdacs_cyclones",
  nom: "Systèmes tropicaux du sud-ouest de l'océan Indien : trajectoires et prévisions du CMRS de La Réunion (via GDACS)",
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
/** GDACS's 1-minute winds back to the RSMC's 10-minute ones. */
const ONE_TO_TEN_MINUTES = 1.14;

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

/** The stage the RSMC gives to a 10-minute wind (km/h), for the systems whose track is not read. */
export function stageOfWind(kmh: number): string {
  // The RSMC gives its winds in steps of 5 knots.
  const kt = Math.round(kmh / 1.852 / 5) * 5;
  if (kt < 28) return "perturbation tropicale";
  if (kt < 34) return "dépression tropicale";
  if (kt < 48) return "tempête tropicale modérée";
  if (kt < 64) return "forte tempête tropicale";
  if (kt < 90) return "cyclone tropical";
  if (kt <= 115) return "cyclone tropical intense";
  return "cyclone tropical très intense";
}

export const tenMinutes = (oneMinuteKmh: number) => Math.round(oneMinuteKmh / ONE_TO_TEN_MINUTES);

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
  /** Last known position. */
  lon: number;
  lat: number;
  /** Strongest 10-minute wind of its life, km/h. */
  vent_max_kmh: number;
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
    severitydata?: { severity?: number };
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
        vent_max_kmh: tenMinutes(p.severitydata?.severity ?? 0),
        centre: p.source === "RSMC" ? "CMRS de La Réunion" : p.source === "JTWC" ? "JTWC (centre américain, système venu d'un autre bassin)" : p.source,
        alerte_gdacs: p.alertlevel,
        rapport: p.url?.report ?? `https://www.gdacs.org/report.aspx?eventid=${p.eventid}&episodeid=${p.episodeid}&eventtype=TC`,
      };
    });
}

/** One position of a track, observed or forecast. */
export interface Point {
  /** ISO, UTC. */
  heure: string;
  lon: number;
  lat: number;
  stade: string;
  /** 10-minute mean, km/h. */
  vent_kmh: number;
  rafales_kmh?: number;
  pression_hpa?: number;
}

export interface Trajectoire {
  observee: Point[];
  /** The RSMC's forecast from the last advisory. */
  prevue: Point[];
}

interface RawItem {
  actual: string;
  advisory_datetime?: string;
  latitude: string;
  longitude: string;
  wind_speed: string;
  wind_gusts?: string;
  pressure?: string;
  storm_status?: string[] | string;
}

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/** « 03 Feb 2026 06:00 » (UTC) → ISO. */
export function advisoryTime(s: string): string | undefined {
  const m = /^(\d\d) (\w{3}) (\d{4}) (\d\d:\d\d)$/.exec(s.trim());
  return m && MONTHS[m[2]] ? `${m[3]}-${MONTHS[m[2]]}-${m[1]}T${m[4]}:00.000Z` : undefined;
}

export function parseTimeline(raw: { channel?: { item?: RawItem[] } }): Trajectoire {
  const observee: Point[] = [];
  const prevue: Point[] = [];
  for (const it of raw.channel?.item ?? []) {
    const heure = it.advisory_datetime ? advisoryTime(it.advisory_datetime) : undefined;
    const lon = Number(it.longitude), lat = Number(it.latitude);
    if (!heure || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const status = Array.isArray(it.storm_status) ? it.storm_status[0] : it.storm_status;
    const gusts = Number(it.wind_gusts), hpa = Number(it.pressure);
    const p: Point = {
      heure,
      lon,
      lat,
      stade: stage(status ?? ""),
      vent_kmh: tenMinutes(Number(it.wind_speed) * 3.6),
      rafales_kmh: gusts > 0 ? Math.round(gusts * 3.6) : undefined,
      pression_hpa: hpa > 0 ? hpa : undefined,
    };
    (it.actual === "True" ? observee : prevue).push(p);
  }
  observee.sort((a, b) => a.heure.localeCompare(b.heure));
  prevue.sort((a, b) => a.heure.localeCompare(b.heure));
  return { observee, prevue: prevue.filter((p) => !observee.length || p.heure > observee[observee.length - 1].heure) };
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

/** The track and the forecast of a system, as of its last advisory. */
export async function trajectoire(cache: Cache, s: Systeme): Promise<Cached<Trajectoire>> {
  return cache.get(`cyclones:trajectoire:${s.id}:${s.episode}`, TIMELINE_FRESH_SECONDS, async () => {
    const ep = await getJson<{ properties?: { impacts?: { resource?: { timeline?: string } }[] } }>(
      SOURCE.id,
      `${API}/events/getepisodedata?eventtype=TC&eventid=${s.id}&episodeid=${s.episode}`,
      20_000,
    );
    const timeline = ep.properties?.impacts?.find((i) => i.resource?.timeline)?.resource?.timeline;
    if (!timeline?.startsWith(`${API}/export/gettimeline`)) throw new Error(`gdacs : pas de trajectoire pour ${s.nom}`);
    return parseTimeline(await getJson(SOURCE.id, timeline, 20_000));
  });
}

/** The active systems with their tracks (at most a few: each costs two requests). A track that fails is left out. */
export async function actifs(cache: Cache, list: Systeme[], now: Date): Promise<{ systeme: Systeme; trajectoire?: Trajectoire }[]> {
  const active = list.filter((s) => isActive(s, now)).slice(0, MAX_DETAILED);
  return Promise.all(active.map(async (systeme) => {
    try {
      return { systeme, trajectoire: (await trajectoire(cache, systeme)).value };
    } catch (err) {
      console.error(`source ${SOURCE.id} : trajectoire de ${systeme.nom} indisponible:`, why(err));
      return { systeme };
    }
  }));
}
