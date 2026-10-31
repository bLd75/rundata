/**
 * The concentrations measured hour by hour at Atmo Réunion's stations, as the LCSQA publishes them on data.gouv.fr in
 * its open files of the national base Geod'air (« flux E2 »): one file a day for the whole of France, rewritten every
 * hour, up to 12.5 Mo (28/10/2026). The Worker's scheduled event reads it every hour as it comes, line by line, never
 * whole (`collect`, worker.ts), keeps Atmo Réunion's lines and writes them to the KV store, where pages and tools read
 * them (`mesures`), never the file. Measured in a Worker on 29/10/2026: 50 ms of CPU for the file of the morning
 * (2.6 Mo), 193 to 254 ms for a whole day's (12.5 Mo).
 * By the LCSQA's note on these files, they are raw data, not validated, which Atmo Réunion may correct or invalidate
 * afterwards, and their hours are local time for the overseas regions. A measure is never the ATMO index
 * (providers/atmo.ts), a forecast: the two are said apart.
 */
import { count } from "../budget.js";
import type { Cache, Cached } from "../cache.js";
import { getLines } from "../http.js";
import { UpstreamError, type SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "lcsqa_mesures",
  nom: "Mesures horaires des stations d'Atmo Réunion (LCSQA, base Geod'air, flux E2)",
  organisme: "LCSQA, laboratoire central de surveillance de la qualité de l'air, d'après les stations d'Atmo Réunion",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "LCSQA / Atmo Réunion",
  url: "https://www.data.gouv.fr/datasets/5b98b648634f415309d52a50",
};

/** Written by the scheduled event (`collect`), read by worker.ts. */
export const KV_KEY = "air:mesures:collecte";
/** Kept in the store this long after the collector's last write: the measures say their hour, however old. */
export const KV_TTL_SECONDS = 7 * 86_400;

/** The pollutants of the ATMO index, by their code in the files. */
export const POLLUTANTS: Record<string, string> = {
  O3: "ozone",
  NO2: "dioxyde d'azote",
  SO2: "dioxyde de soufre",
  PM10: "particules PM10",
  "PM2.5": "particules fines PM2,5",
};

/**
 * The stations of Atmo Réunion active in the LCSQA's station file (« dataset D » of the same page, 07/08/2026):
 * their name as said here, their commune and their place. A station missing here keeps the files' name, without a
 * commune.
 */
export const STATIONS: Record<string, { nom: string; commune: string; lat: number; lon: number }> = {
  FR38001: { nom: "Lycée Lislet Geoffroy", commune: "Saint-Denis", lat: -20.889893, lon: 55.46884 },
  FR38002: { nom: "Montgaillard", commune: "Saint-Denis", lat: -20.903294, lon: 55.468334 },
  FR38009: { nom: "École La Marine", commune: "Sainte-Suzanne", lat: -20.910585, lon: 55.618977 },
  FR38011: { nom: "Luther King", commune: "Saint-Pierre", lat: -21.334406, lon: 55.45906 },
  FR38014: { nom: "Ligne Paradis", commune: "Saint-Pierre", lat: -21.312895, lon: 55.474194 },
  FR38016: { nom: "Bourg-Murat", commune: "Le Tampon", lat: -21.204815, lon: 55.58262 },
  FR38017: { nom: "Grand Coude", commune: "Saint-Joseph", lat: -21.29433, lon: 55.62793 },
  FR38018: { nom: "Centre pénitentiaire", commune: "Le Port", lat: -20.9498, lon: 55.313828 },
  FR38020: { nom: "Plateau Caillou", commune: "Saint-Paul", lat: -21.022112, lon: 55.266773 },
  FR38021: { nom: "Grand Fond", commune: "Saint-Paul", lat: -21.032139, lon: 55.232563 },
  FR38022: { nom: "Chaussée Royale", commune: "Saint-Paul", lat: -20.998577, lon: 55.28062 },
  FR38023: { nom: "Boulevard Banks", commune: "Saint-Pierre", lat: -21.331703, lon: 55.47895 },
  FR38024: { nom: "RDT Saint-Leu", commune: "Saint-Leu", lat: -21.213211, lon: 55.302845 },
  FR38091: { nom: "Terrain de Sel", commune: "La Possession", lat: -20.928686, lon: 55.33258 },
  FR38098: { nom: "Sarda Garriga", commune: "Saint-Louis", lat: -21.277075, lon: 55.403065 },
};

/** The station's surroundings the measure stands for, by the files' « type d'influence ». */
const TYPES: Record<string, string> = { Fond: "fond", Trafic: "trafic", Industrielle: "industrielle" };

export interface Mesure {
  /** The station's national code, FR38001. */
  station: string;
  /** Its name in the files, kept for a station missing from STATIONS. */
  nom_fichier: string;
  /** « fond », « trafic » or « industrielle ». */
  type: string;
  /** The pollutant's code, a key of POLLUTANTS. */
  polluant: string;
  /** The hour measured, local time with its offset: 2026-10-29T07:00:00+04:00. */
  debut: string;
  fin: string;
  valeur: number;
  /** As the files write it: « µg-m3 ». */
  unite: string;
}

export interface Copie {
  /** When the collector read the file (ISO, UTC). */
  lu: string;
  /** The end of the latest hour among the measures kept: the collector writes again only when it changes. */
  derniere_heure: string;
  /** The latest valid measure of each station, type and pollutant. */
  mesures: Mesure[];
}

/** The fields of a line of the files, « ; » between them, each in quotes or empty. */
function fields(line: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (at <= line.length) {
    if (line[at] === '"') {
      const end = line.indexOf('"', at + 1);
      out.push(line.slice(at + 1, end < 0 ? line.length : end));
      at = (end < 0 ? line.length : end + 1) + 1;
    } else {
      const end = line.indexOf(";", at);
      out.push(line.slice(at, end < 0 ? line.length : end));
      at = (end < 0 ? line.length : end) + 1;
    }
  }
  return out;
}

// The columns of the files (header of FR_E2_2026-10-29.csv).
const COL = { debut: 0, fin: 1, organisme: 2, station: 5, nom: 6, polluant: 8, influence: 9, valeur: 15, unite: 17, validite: 22 };
const local = (s: string) => `${s.replace(/\//g, "-").replace(" ", "T")}+04:00`;

/**
 * Atmo Réunion's measure on a line of the files; undefined for another body's line, a pollutant outside the index, or
 * a value the files do not give as valid. Valid means the EIONET code 1, or 4 for ozone (« valid using CCQM.O3.2019 »):
 * never 2 or 3, a detection limit or half of it in place of the value, nor -1 or -99, not valid.
 */
export function mesure(line: string): Mesure | undefined {
  if (!line.includes('"ATMO REUNION"')) return undefined;
  const f = fields(line);
  if (f[COL.organisme] !== "ATMO REUNION" || !POLLUTANTS[f[COL.polluant]]) return undefined;
  if (!(f[COL.validite] === "1" || (f[COL.validite] === "4" && f[COL.polluant] === "O3"))) return undefined;
  const valeur = Number(f[COL.valeur]);
  if (f[COL.valeur] === "" || !Number.isFinite(valeur) || valeur < 0) return undefined;
  return {
    station: f[COL.station],
    nom_fichier: f[COL.nom],
    type: TYPES[f[COL.influence]] ?? f[COL.influence].toLowerCase(),
    polluant: f[COL.polluant],
    debut: local(f[COL.debut]),
    fin: local(f[COL.fin]),
    valeur,
    unite: f[COL.unite],
  };
}

/** The latest measure of each station, type and pollutant, among those read. */
export function latest(all: Iterable<Mesure>): Mesure[] {
  const by = new Map<string, Mesure>();
  for (const m of all) {
    const k = `${m.station} ${m.type} ${m.polluant}`;
    const had = by.get(k);
    if (!had || Date.parse(m.fin) > Date.parse(had.fin)) by.set(k, m);
  }
  return [...by.values()].sort((a, b) => a.station.localeCompare(b.station) || a.polluant.localeCompare(b.polluant));
}

// The files of each day, by the local date of La Réunion.
const FILES = "https://files.data.gouv.fr/ineris/lcsqa/concentrations-de-polluants-atmospheriques-reglementes/temps-reel";
/**
 * Every hour, at 45 past (UTC): the files are rewritten at about half past. Of the events of the second half of the hour,
 * the least loaded at the shortest cadences by the budget's registry (29/10/2026: 109 subrequests at most with this read,
 * 149 in the busiest event of the day, at 00:00).
 */
export const REFRESH_EVERY = 60;
export const REFRESH_OFFSET = 45;
export const refreshDue = (now: Date) => (((now.getUTCMinutes() - REFRESH_OFFSET) % REFRESH_EVERY) + REFRESH_EVERY) % REFRESH_EVERY < 5;

const localDay = (t: number) => new Date(t + 4 * 3600_000).toISOString().slice(0, 10);

/** Atmo Réunion's valid measures in the file of `day` (YYYY-MM-DD); undefined when there is no such file yet. */
async function read(day: string): Promise<Mesure[] | undefined> {
  // The address answers with a redirect to its storage, and each request of a redirect chain is a subrequest.
  count();
  const out: Mesure[] = [];
  try {
    await getLines(SOURCE.id, `${FILES}/${day.slice(0, 4)}/FR_E2_${day}.csv`, 60_000, (l) => {
      const m = mesure(l);
      if (m) out.push(m);
    });
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 404) return undefined;
    throw err;
  }
  return out;
}

/**
 * The scheduled event's read: the file of the day in La Réunion, and the day before's too while the day's has none of
 * Atmo Réunion's lines yet (its first hours). Fails when no
 * file gives a valid measure, and the copy in the store stays, its measures said with their hour.
 * Written at each read, the same hour or not, so that its time is the last read (24 writes a day).
 */
export async function collect(before: Copie | null, write: (copie: Copie) => Promise<void>, now = new Date()): Promise<string> {
  const today = await read(localDay(now.getTime()));
  const all = today?.length ? today : [...(today ?? []), ...((await read(localDay(now.getTime() - 86_400_000))) ?? [])];
  const kept = latest(all);
  if (!kept.length) throw new Error(`aucune mesure valide d'Atmo Réunion dans les fichiers du ${localDay(now.getTime())} ni de la veille`);
  const derniere_heure = kept.map((m) => m.fin).sort().pop()!;
  const said = `${kept.length} mesures de ${new Set(kept.map((m) => m.station)).size} stations, dernière heure finie à ${derniere_heure.slice(11, 16)} le ${derniere_heure.slice(0, 10)}`;
  await write({ lu: now.toISOString(), derniere_heure, mesures: kept });
  return `${said}${before?.derniere_heure === derniere_heure ? ", inchangée" : ""}, écrites`;
}

let reader: (() => Promise<Copie | null>) | undefined;

/** In the Worker: read the measures from the KV store, where the scheduled event writes them, and the files never. */
export function configure(read: (() => Promise<Copie | null>) | undefined) {
  reader = read;
}

// The scheduled event writes once an hour at most: the copy is asked of the store once an hour.
const FRESH_SECONDS = 60 * 60;

/**
 * The stored measures, their time the collector's read; null where nothing is configured (a local server, the
 * tests), as the Worker alone has them.
 */
export async function mesures(cache: Cache): Promise<Cached<Copie> | null> {
  if (!reader) return null;
  const read = reader;
  const c = await cache.getCopy("air:mesures", FRESH_SECONDS, async () => {
    const v = await read();
    if (!v?.mesures.length) throw new Error("mesures des stations absentes du stockage");
    return v;
  }, (v) => v.lu);
  return { ...c, fetchedAt: new Date(c.value.lu) };
}

/** « µg/m³ » for the files' « µg-m3 ». */
export const unit = (u: string) => u.replace(/-m3$/, "/m³");
