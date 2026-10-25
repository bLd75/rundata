import { left } from "../budget.js";
import type { Cache, Cached } from "../cache.js";
import { compass, localTime } from "../geo.js";
import { normalize, resolvePlace, type Place } from "../places/resolve.js";
import * as arome from "../providers/arome.js";
import * as ensemble from "../providers/ensemble.js";
import * as openmeteo from "../providers/openmeteo.js";
import * as uv from "../providers/uv.js";
import { type Forecast, type ForecastDay, type ForecastHour, why } from "../types.js";
import { credits, fr, notFound, placeBlock, text } from "./format.js";
import * as nuages from "./nuages.js";

const TOUR = ["Saint-Denis", "Saint-Pierre", "Saint-Gilles-les-Bains", "Saint-Benoît", "Cilaos", "Plaine des Cafres"];
const HOUR = 3600_000;

export function coverage(): string {
  const ecmwf = `modèle ${openmeteo.MODEL.nom} (maille d'environ ${openmeteo.MODEL.maille_km} km, ${openmeteo.MODEL.echeance_jours} jours, ` +
    `nouveau calcul ${openmeteo.MODEL.mise_a_jour}, via Open-Meteo)`;
  return arome.enabled()
    ? `Prévisions du modèle ${arome.MODEL.nom} (maille de 2,5 km, 48 h, ${arome.MODEL.mise_a_jour})\u00a0; au-delà, et quand ` +
        `AROME ne répond pas, ${ecmwf}. Ce sont des prévisions, jamais mélangées aux mesures.`
    : `Prévisions du ${ecmwf}. Ce sont des prévisions, jamais mélangées aux mesures.`;
}

const REUNION_OFFSET_MS = 4 * 3600 * 1000; // UTC+4 all year
const ENS_MIN_LEFT = 2;

/** "2026-10-23" in Réunion time. */
export function localDate(d: Date): string {
  return new Date(d.getTime() + REUNION_OFFSET_MS).toISOString().slice(0, 10);
}

export function localHour(d: Date): number {
  return new Date(d.getTime() + REUNION_OFFSET_MS).getUTCHours();
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const DAY_NAMES = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** "jeudi 23/10". */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

// WMO weather codes, as Open-Meteo uses them.
const WEATHER: Record<number, string> = {
  0: "ciel dégagé", 1: "plutôt dégagé", 2: "partiellement nuageux", 3: "couvert",
  45: "brouillard", 48: "brouillard givrant",
  51: "bruine faible", 53: "bruine", 55: "bruine forte", 56: "bruine verglaçante", 57: "bruine verglaçante forte",
  61: "pluie faible", 63: "pluie", 65: "pluie forte", 66: "pluie verglaçante", 67: "pluie verglaçante forte",
  71: "neige faible", 73: "neige", 75: "neige forte", 77: "grains de neige",
  80: "averses faibles", 81: "averses", 82: "averses violentes", 85: "averses de neige", 86: "fortes averses de neige",
  95: "orage", 96: "orage avec grêle", 99: "orage avec forte grêle",
};

const sky = (code: number | null) => (code == null ? undefined : (WEATHER[code] ?? `code météo ${code}`));
const deg = (t: number | null) => (t == null ? undefined : `${fr(Math.round(t * 10) / 10)} °C`);

function rain(mm: number | null): string | undefined {
  if (mm == null) return undefined;
  if (mm === 0) return "pas de pluie prévue";
  if (mm < 1) return `quelques gouttes possibles (${fr(mm)} mm)`;
  return `${fr(Math.round(mm * 10) / 10)} mm de pluie`;
}

// --- When: free text → days and hours ---------------------------------------------------------------------------

interface Slot {
  jour: string;
  de: number; // local hour, inclusive
  a: number; // local hour, exclusive
}

export interface Period {
  libelle: string;
  slots: Slot[];
  /** False when `quand` was given but not understood: the default period is used instead. */
  compris: boolean;
  defaut?: boolean;
}

// Parts of a day. The night runs over midnight into the next day.
const PARTS: { re: RegExp; nom: string; ceJour: string; slots: (jour: string) => Slot[] }[] = [
  { re: /\b(matin|morning)\b/, nom: "matin", ceJour: "ce matin", slots: (j) => [{ jour: j, de: 6, a: 12 }] },
  { re: /\b(apres midi|aprem|afternoon)\b/, nom: "après-midi", ceJour: "cet après-midi", slots: (j) => [{ jour: j, de: 12, a: 18 }] },
  { re: /\b(soir|soiree|evening|tonight)\b/, nom: "soir", ceJour: "ce soir", slots: (j) => [{ jour: j, de: 18, a: 24 }] },
  { re: /\b(nuit|night)\b/, nom: "nuit", ceJour: "cette nuit", slots: (j) => [{ jour: j, de: 21, a: 24 }, { jour: addDays(j, 1), de: 0, a: 6 }] },
];

const WEEKDAYS: [RegExp, number][] = [
  [/\b(dimanche|sunday)\b/, 0], [/\b(lundi|monday)\b/, 1], [/\b(mardi|tuesday)\b/, 2], [/\b(mercredi|wednesday)\b/, 3],
  [/\b(jeudi|thursday)\b/, 4], [/\b(vendredi|friday)\b/, 5], [/\b(samedi|saturday)\b/, 6],
];

export function parsePeriod(quand: string | undefined, now: Date): Period {
  const today = localDate(now);
  const all: Slot[] = [];
  if (!quand?.trim()) return { libelle: "les prochaines 24 h et les jours suivants", slots: all, compris: true, defaut: true };
  const q = normalize(quand);
  if (/\b(semaine|week|prochains jours|next days|coming days)\b/.test(q) && !/\bweek end\b|\bweekend\b/.test(q)) {
    return { libelle: "les prochaines 24 h et les jours suivants", slots: all, compris: true, defaut: true };
  }

  let days: string[] | null = null;
  let label = "";
  let m: RegExpMatchArray | null;
  if (/\b(apres demain|day after tomorrow)\b/.test(q)) [days, label] = [[addDays(today, 2)], "après-demain"];
  else if (/\b(demain|tomorrow)\b/.test(q)) [days, label] = [[addDays(today, 1)], "demain"];
  else if (/\b(week end|weekend)\b/.test(q)) {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    const sat = addDays(today, dow === 0 ? -1 : 6 - dow);
    days = [sat, addDays(sat, 1)].filter((d) => d >= today);
    label = "ce week-end";
  } else if ((m = q.match(/\b(?:dans|in) (\d+) (?:jours?|days?)\b/))) [days, label] = [[addDays(today, Number(m[1]))], `dans ${m[1]} jours`];
  else {
    const wd = WEEKDAYS.find(([re]) => re.test(q));
    if (wd) {
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
      const date = addDays(today, (wd[1] - dow + 7) % 7);
      [days, label] = [[date], dayLabel(date)];
    } else if (/\b(aujourd hui|today|ce|cet|cette|this)\b/.test(q)) [days, label] = [[today], "aujourd'hui"];
  }

  const part = PARTS.find((p) => p.re.test(q));
  if (!days && part) [days, label] = [[today], "aujourd'hui"];
  if (!days) return { libelle: "les prochaines 24 h et les jours suivants", slots: all, compris: false, defaut: true };
  if (!part) return { libelle: label, slots: days.map((jour) => ({ jour, de: 0, a: 24 })), compris: true };
  return {
    libelle: label === "aujourd'hui" ? part.ceJour : `${label} ${part.nom}`,
    slots: days.flatMap(part.slots),
    compris: true,
  };
}

// --- Getting the forecast -----------------------------------------------------------------------------------------

/** Starts of the 3-hour steps (local hours 0, 3, 6…) of these days, from the step under way. */
function stepStarts(days: string[], now: Date, keep: (jour: string, hour: number) => boolean = () => true): Date[] {
  const out: Date[] = [];
  for (const d of days) {
    const midnight = Date.parse(`${d}T00:00:00Z`) - REUNION_OFFSET_MS;
    for (let h = 0; h < 24; h += 3) {
      const t = midnight + h * HOUR;
      if (t + 3 * HOUR > now.getTime() && keep(d, h)) out.push(new Date(t));
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** The hours of a day, whichever model they come from. */
function dayFromHours(date: string, hours: ForecastHour[]): ForecastDay {
  const hs = hours.filter((h) => localDate(h.time) === date);
  const temps = hs.map((h) => h.temperature).filter((t): t is number => t != null);
  const rains = hs.map((h) => h.pluie_mm).filter((r): r is number => r != null);
  const gusts = hs.map((h) => h.rafales_kmh).filter((g): g is number => g != null);
  const wet = hs.map((h) => h.code).filter((c): c is number => c != null && c >= 51);
  const segments: { nom: string; de: number; a: number }[] = [];
  for (const h of hs) {
    const nom = h.modele?.nom ?? "";
    const de = localHour(h.time);
    const last = segments[segments.length - 1];
    if (last && last.nom === nom) last.a = de + h.duree_h;
    else segments.push({ nom, de, a: de + h.duree_h });
  }
  return {
    date,
    code: wet.length ? Math.max(...wet) : null,
    tmin: temps.length ? Math.min(...temps) : null,
    tmax: temps.length ? Math.max(...temps) : null,
    pluie_mm: rains.length ? Math.round(rains.reduce((a, b) => a + b, 0) * 10) / 10 : null,
    rafales_max_kmh: gusts.length ? Math.max(...gusts) : null,
    modeles: segments.length > 1 ? segments.map((x) => `${x.nom} de ${x.de}h à ${x.a}h`).join(", puis ") : undefined,
  };
}

/** AROME where it has steps; ECMWF for the hours and days it does not cover. */
export function merge(e: Forecast | null, a: Forecast | null): Forecast | null {
  if (!a?.hours.length) return e;
  const covered = (t: number) => a.hours.some((h) => t >= h.time.getTime() && t < h.time.getTime() + h.duree_h * HOUR);
  const eHours = e ? e.hours.filter((h) => !covered(h.time.getTime())).map((h) => ({ ...h, modele: e.model })) : [];
  const hours = [...a.hours, ...eHours].sort((x, y) => x.time.getTime() - y.time.getTime());
  const aromeDays = new Set(a.hours.map((h) => localDate(h.time)));
  const dates = [...new Set([...(e?.days.map((d) => d.date) ?? []), ...aromeDays])].sort();
  const last = a.hours[a.hours.length - 1];
  return {
    ...a,
    hours,
    days: dates.map((date) => (aromeDays.has(date) ? dayFromHours(date, hours) : e!.days.find((d) => d.date === date)!)),
    relais: e ? [{ model: e.model, source: e.source, runAt: e.runAt, from: new Date(last.time.getTime() + last.duree_h * HOUR) }] : undefined,
  };
}

interface Got {
  results: PromiseSettledResult<Cached<Forecast>>[];
  /** The UV index of the island, a forecast of its own (CAMS); missing when it does not answer. */
  uv: Cached<uv.UvCell[]> | null;
  /** How much the ensemble's scenarios agree, day by day; missing when it does not answer. */
  ens: ensemble.Ensemble | null;
  /** Why AROME is missing from answers it should be in. */
  aromeDown?: string;
  /** AROME is wanted and up, but none of its grids is stored yet and the invocation had no room to download them. */
  aromeLater?: boolean;
}

async function forecasts(cache: Cache, places: Place[], starts: Date[], now: Date): Promise<Got> {
  // Not even the run list is asked for when the period is beyond AROME's 48 hours.
  const wanted = starts.filter((t) => t.getTime() < now.getTime() + 48 * HOUR);
  // Set aside what the ECMWF answers may cost cold (each read, fetched and stored at the edge), plus its run time
  // and the UV index.
  const reserve = 3 * (places.length + 2);
  const aromeP = wanted.length
    ? arome.prepare(cache, wanted, reserve).catch((err) => {
        console.error(`source ${arome.SOURCE.id} indisponible:`, why(err));
        return err instanceof Error ? err : new Error(String(err));
      })
    : Promise.resolve(null);
  const uvP = uv.island(cache).catch((err) => {
    console.error(`source ${uv.SOURCE.id} indisponible:`, why(err));
    return null;
  });
  const [a, ecmwf, uvi] = await Promise.all([aromeP, Promise.allSettled(places.map((p) => openmeteo.forecast(cache, p))), uvP]);
  // The ensemble's copy last, one read, and only when the forecast leaves room for it and for the rest of a page.
  const ens = left() >= ENS_MIN_LEFT
    ? await ensemble.island(cache, now).catch((err) => {
        console.error(`source ${ensemble.SOURCE.id} indisponible:`, why(err));
        return null;
      })
    : null;
  const data = a instanceof Error ? null : a;
  const results = places.map((p, i): PromiseSettledResult<Cached<Forecast>> => {
    const e = ecmwf[i].status === "fulfilled" ? ecmwf[i].value : null;
    const f = merge(e?.value ?? null, data ? arome.atPlace(data, p) : null);
    if (!f) return ecmwf[i] as PromiseRejectedResult;
    return { status: "fulfilled", value: { value: f, fetchedAt: e?.fetchedAt ?? now, stale: e?.stale ?? false } };
  });
  return { results, uv: uvi, ens, aromeDown: a instanceof Error ? a.message : undefined, aromeLater: wanted.length > 0 && a === null && arome.enabled() };
}

/**
 * For the Worker's scheduled event: fills the latest AROME run's bundle, nearest steps first, as far as the
 * invocation allows. A few runs of it after a new run appears, questions download no grid at all.
 */
export async function prefetchForecasts(cache: Cache, now = new Date()) {
  const today = localDate(now);
  const d = await arome.prepare(cache, stepStarts([today, addDays(today, 1), addDays(today, 2)], now), 0, arome.FOR_PREFETCH);
  return d ? { run: d.run, steps: d.steps.length, later: d.later } : null;
}

// --- Shaping the forecast ----------------------------------------------------------------------------------------

/**
 * The day's sky from its daytime hours, not from the model's daily code: that one is the "worst" hour of the day,
 * and the night-time low cloud of the Hauts turns most days into "brouillard".
 */
function daySky(f: Forecast, date: string): string | undefined {
  const day = f.hours.filter((h) => localDate(h.time) === date && localHour(h.time) >= 6 && localHour(h.time) < 18);
  const wet = day.map((h) => h.code).filter((c): c is number => c != null && c >= 51);
  if (wet.length) return sky(Math.max(...wet));
  const clouds = day.map((h) => h.nuages_pct).filter((c): c is number => c != null);
  if (!clouds.length) return sky(f.days.find((d) => d.date === date)?.code ?? null);
  const mean = clouds.reduce((a, b) => a + b, 0) / clouds.length;
  return mean < 25 ? "ciel dégagé" : mean < 60 ? "partiellement nuageux" : mean < 85 ? "nuageux" : "couvert";
}

/** The day's highest UV index over a place, from its own forecast. */
type UvOf = (date: string) => number | undefined;

const uvText = (v: number) => `${v} (${uv.level(v)})`;

function uvAt(u: Cached<uv.UvCell[]> | null, place: Place): UvOf {
  const cell = u ? uv.at(u.value, place.lon, place.lat) : undefined;
  return (date) => cell?.max[date];
}

/** The confidence of a day over a place, from the ensemble. */
type ConfOf = (date: string) => ensemble.Confidence | undefined;

function confAt(e: ensemble.Ensemble | null, place: Place, now: Date): ConfOf {
  return ensemble.confidenceAt(e, place.lon, place.lat, now);
}

function dayBlock(f: Forecast, d: ForecastDay, uvOf?: UvOf, confOf?: ConfOf) {
  const u = uvOf?.(d.date);
  const c = confOf?.(d.date);
  return {
    jour: dayLabel(d.date),
    ciel_en_journee: daySky(f, d.date),
    temperature_min: deg(d.tmin),
    temperature_max: deg(d.tmax),
    pluie: rain(d.pluie_mm),
    rafales_max: d.rafales_max_kmh == null ? undefined : `${Math.round(d.rafales_max_kmh)} km/h`,
    indice_uv_max: u == null ? undefined : uvText(u),
    confiance: c?.niveau,
    confiance_pourquoi: c?.pourquoi,
    modeles: d.modeles,
  };
}

function daySentence(f: Forecast, d: ForecastDay, uvOf?: UvOf, confOf?: ConfOf): string {
  const parts = [daySky(f, d.date), d.tmin != null && d.tmax != null ? `${fr(d.tmin)} à ${fr(d.tmax)} °C` : undefined, rain(d.pluie_mm)];
  if (d.rafales_max_kmh != null) parts.push(`rafales jusqu'à ${Math.round(d.rafales_max_kmh)} km/h`);
  const u = uvOf?.(d.date);
  if (u != null) parts.push(`UV ${uvText(u)}`);
  const c = confOf?.(d.date);
  return parts.filter(Boolean).join(", ") + (c ? ` (confiance ${c.niveau})` : "");
}

/** Rain or storm if any; fog only when it lasts the three hours (models put it on many Hauts nights). */
function stepCode(codes: number[]): number | null {
  if (!codes.length) return null;
  const notFog = codes.filter((c) => c !== 45 && c !== 48);
  return notFog.length ? Math.max(...notFog) : Math.max(...codes);
}

/** Three hours: temperature at the start, rain summed, the worst weather and gust. */
function stepBlock(hours: ForecastHour[], mixed: boolean) {
  const first = hours[0];
  const end = new Date(first.time.getTime() + hours.reduce((s, h) => s + h.duree_h, 0) * HOUR);
  const sum = hours.reduce((s, h) => s + (h.pluie_mm ?? 0), 0);
  const codes = hours.map((h) => h.code).filter((c): c is number => c != null);
  const gust = Math.round(Math.max(...hours.map((h) => h.rafales_kmh ?? 0)));
  const wind = first.vent_kmh == null
    ? (hours.some((h) => h.rafales_kmh != null) ? `rafales ${gust} km/h` : undefined)
    : `${first.vent_dir == null ? "" : `${compass(first.vent_dir)} `}${Math.round(first.vent_kmh)} km/h, rafales ${gust} km/h`;
  return {
    heures: `${dayLabel(localDate(first.time))} ${localHour(first.time)}h–${localHour(end) || 24}h`,
    ciel: sky(stepCode(codes)),
    temperature: deg(first.temperature),
    pluie: rain(Math.round(sum * 10) / 10),
    vent: wind,
    modele: mixed ? first.modele?.nom : undefined,
  };
}

/** Steps of three hours starting on hours 0, 3, 6…, keeping those not over yet. */
function steps(f: Forecast, keep: (h: ForecastHour) => boolean, now: Date) {
  const out = [];
  for (const h of f.hours) {
    if (localHour(h.time) % 3 !== 0 || !keep(h)) continue;
    const start = h.time.getTime();
    if (start + 3 * HOUR <= now.getTime()) continue;
    out.push(stepBlock(f.hours.filter((x) => x.time.getTime() >= start && x.time.getTime() < start + 3 * HOUR), Boolean(f.relais)));
  }
  return out;
}

const km = (m: { maille_km: number }) => fr(m.maille_km);

/** Always given, whatever the question: the forecast must never pass for a measurement. */
function warnings(f: Forecast, place?: Place): string[] {
  const names = [f.model, ...(f.relais ?? []).map((r) => r.model)].map((m) => m.nom).join(", puis ");
  const out = [
    `Ceci est une PRÉVISION calculée par un modèle numérique (${names}), pas une mesure : elle peut se tromper, ` +
      "de plus en plus au fil des jours.",
  ];
  if (f.model === arome.MODEL) {
    const altitude = place
      ? `À cet endroit, le relief du modèle est à ${f.relief_m ?? "?"} m : les températures sont ramenées à l'altitude de ` +
        `${place.nom} (${f.altitude_m} m).`
      : "Les températures sont ramenées à l'altitude de chaque lieu.";
    out.push(
      "AROME calcule sur des carrés d'environ 2,5 km : il voit le relief de l'île bien mieux qu'un modèle mondial, mais pas " +
        `ses microclimats fins (fond des ravines et des cirques, brises, un versant plutôt que l'autre). ${altitude}`,
      "Températures données toutes les 3 heures : le maximum et le minimum de la journée peuvent être un peu plus marqués.",
    );
    for (const x of f.suite ?? []) {
      out.push(
        `Le calcul d'AROME de ${localTime(f.runAt!)} n'est pas encore entièrement publié par Météo-France : à partir de ` +
          `${localTime(x.from)}, les valeurs viennent du calcul de ${localTime(x.runAt)}.`,
      );
    }
    for (const r of f.relais ?? []) {
      out.push(
        `Là où AROME ne va pas (après ${localTime(r.from)}, ou heures pas encore chargées), les valeurs viennent du modèle ` +
          `${r.model.nom}, à maille de ${km(r.model)} km, qui ne distingue pas les microclimats de l'île : voir « modeles » par jour.`,
      );
    }
  } else {
    const altitude = place
      ? `Les températures sont ramenées à l'altitude de ${place.nom} (${f.altitude_m} m)\u00a0; la pluie, le vent et les nuages ` +
        "sont ceux de tout le carré."
      : "Les températures sont ramenées à l'altitude de chaque lieu\u00a0; la pluie, le vent et les nuages sont ceux de tout le carré.";
    out.push(
      `Le modèle calcule sur des carrés d'environ ${km(f.model)} km : il ne distingue pas les microclimats de La Réunion ` +
        `(cirques, Hauts, versant au vent ou sous le vent, brises de mer). ${altitude}`,
    );
  }
  out.push(
    "Cyclone, fortes pluies, orages : seules comptent la vigilance officielle de Météo-France (meteofrance.re) et les " +
      "alertes de la préfecture.",
  );
  return out;
}

/** `later`: AROME not loaded yet (Got.aromeLater), said in the header of the model that stands in for it. */
function header(f: Forecast, later = false): string {
  if (f.model !== arome.MODEL) return `PRÉVISION (${later ? "prévision AROME pas encore chargée, " : ""}modèle ${f.model.nom}, maille de ${km(f.model)} km, pas une mesure)`;
  const suite = (f.suite ?? []).map((x) => `, et de ${localTime(x.runAt)} pour la suite`).join("");
  const run = f.runAt ? `, calcul de ${localTime(f.runAt)}${suite}` : "";
  const relais = f.relais?.length ? `, relayé ensuite par ${f.relais.map((r) => `${r.model.nom}, maille de ${km(r.model)} km`).join(", ")}` : "";
  return `PRÉVISION (modèle ${f.model.nom}, maille de ${km(f.model)} km${run}${relais}\u00a0; pas une mesure)`;
}

function modelBlock(c: Cached<Forecast>) {
  const f = c.value;
  return {
    nom: f.model.nom,
    maille_km: f.model.maille_km,
    run_du_modele: f.runAt ? localTime(f.runAt) : undefined,
    calculs_suivants: f.suite?.map((x) => ({ run_du_modele: localTime(x.runAt), a_partir_de: localTime(x.from) })),
    mis_a_jour: localTime(c.fetchedAt),
    fuseau: "heure de La Réunion (UTC+4)",
    carre_du_modele: f.grid,
    relief_du_modele_m: f.relief_m,
    relais: f.relais?.map((r) => ({
      nom: r.model.nom,
      maille_km: r.model.maille_km,
      run_du_modele: r.runAt ? localTime(r.runAt) : undefined,
      apres: localTime(r.from),
    })),
  };
}

function sourcesOf(f?: Forecast, u?: Cached<uv.UvCell[]> | null, e?: ensemble.Ensemble | null) {
  if (!f) return credits(arome.enabled() ? [arome.SOURCE, openmeteo.SOURCE] : [openmeteo.SOURCE]);
  return credits([f.source, ...(f.relais ?? []).map((r) => r.source), ...(u ? [uv.SOURCE] : []), ...(e ? [ensemble.SOURCE] : [])]);
}

/** Said whenever the answer gives a confidence. */
function ensWarnings(e: ensemble.Ensemble | null): string[] {
  if (!e) return [];
  return [
    `Confiance : elle dit si les ${ensemble.MODEL.membres} scénarios du Centre européen de prévision (ECMWF) s'accordent, sur un carré d'environ ${ensemble.MODEL.maille_km} km ` +
      `(calcul du ${localTime(new Date(e.runAt)).replace(" ", " à ")}). Ce n'est pas la probabilité que la prévision soit juste, et ces scénarios ne viennent pas du ` +
      "modèle de la prévision affichée. Confiance faible : les scénarios divergent, revoyez la prévision plus près du jour.",
  ];
}

/** Said whenever the answer gives a UV index. */
function uvWarnings(u: Cached<uv.UvCell[]> | null): string[] {
  if (!u) return [];
  return [
    `Indice UV : PRÉVISION du service européen Copernicus (${uv.MODEL.nom}, maille d'environ ${uv.MODEL.maille_km} km), ` +
      "nuages compris, au plus fort de la journée (vers midi)\u00a0; pas une mesure. Il est plus fort en altitude, d'environ 10 % " +
      "par 1 000 m. Dès 3, se protéger\u00a0; à 8 et plus, éviter le soleil de 11h à 15h (échelle de l'OMS).",
    ...(u.stale ? ["Indice UV : service momentanément injoignable, prévision précédente."] : []),
  ];
}

function unavailable() {
  return {
    ...text({
      nature: "prevision",
      erreur: "Les services de prévision ne répondent pas pour le moment et aucune prévision n'est en cache.",
      sources: sourcesOf(),
    }),
    isError: true,
  };
}

const aromeDownWarning = "Le modèle AROME de Météo-France n'a pas répondu : prévision du modèle mondial, moins fine sur l'île.";

export async function previsionMeteo(cache: Cache, lieu: string | undefined, quand: string | undefined, now = new Date()) {
  const period = parsePeriod(quand, now);
  const today = localDate(now);

  if (!lieu?.trim()) {
    const places = TOUR.map((n) => resolvePlace(n)!.lieu);
    const wanted = period.defaut ? [today, addDays(today, 1)] : [...new Set(period.slots.map((s) => s.jour))];
    const { results, uv: u, ens, aromeDown, aromeLater } = await forecasts(cache, places, stepStarts(wanted, now), now);
    const ok = places.flatMap((p, i) => (results[i].status === "fulfilled" ? [{ p, c: (results[i] as PromiseFulfilledResult<Cached<Forecast>>).value }] : []));
    if (!ok.length) return unavailable();
    const lieux = ok.map(({ p, c }) => ({
      lieu: p.nom,
      altitude_m: p.altitude_m ?? undefined,
      jours: c.value.days.filter((d) => wanted.includes(d.date)).map((d) => dayBlock(c.value, d, uvAt(u, p), confAt(ens, p, now))),
    }));
    const shown = lieux.some((l) => l.jours.some((j) => j.indice_uv_max)) ? u : null;
    const ensShown = lieux.some((l) => l.jours.some((j) => j.confiance)) ? ens : null;
    const avertissements = [...warnings(ok[0].c.value), ...uvWarnings(shown), ...ensWarnings(ensShown)];
    if (aromeDown) avertissements.push(aromeDownWarning);
    return text({
      nature: "prevision",
      resume:
        `${header(ok[0].c.value, aromeLater)}, tour de l'île — ` +
        ok.map(({ p, c }) => `${p.nom} : ` + c.value.days.filter((d) => wanted.includes(d.date))
          .map((d) => `${d.date === today ? "aujourd'hui" : dayLabel(d.date)} ${daySentence(c.value, d, uvAt(u, p), confAt(ens, p, now))}`).join("\u00a0; ")).join(" | "),
      periode: period.defaut ? "aujourd'hui et demain" : period.libelle,
      lieux,
      modele: modelBlock(ok[0].c),
      avertissements,
      couverture: coverage(),
      sources: sourcesOf(ok[0].c.value, shown, ensShown),
    });
  }

  const r = resolvePlace(lieu);
  if (!r) return notFound(lieu);
  // The steps AROME is asked for: those the answer shows first, and in the Hauts the morning of the cloud sea.
  const hauts = (r.lieu.altitude_m ?? 0) >= nuages.HAUTS_MIN_M;
  const shown = period.defaut
    ? stepStarts([today, addDays(today, 1), addDays(today, 2)], now)
    : stepStarts([...new Set(period.slots.map((s) => s.jour))], now, (jour, h) => period.slots.some((s) => s.jour === jour && h >= s.de && h < s.a));
  // The cloud sea of the day asked (today's or tomorrow's morning), or of the coming morning by default.
  const cloudDay = period.defaut ? undefined : [...period.slots.map((s) => s.jour)].sort()[0];
  const starts = hauts
    ? [...new Map([...shown, ...nuages.morningStarts(now, cloudDay)].map((t) => [t.getTime(), t])).values()].sort((a, b) => a.getTime() - b.getTime())
    : shown;
  const { results, uv: u, ens, aromeDown, aromeLater } = await forecasts(cache, [r.lieu], starts, now);
  const uvOf = uvAt(u, r.lieu);
  const confOf = confAt(ens, r.lieu, now);
  if (results[0].status === "rejected") {
    console.error("prévision indisponible:", why(results[0].reason));
    return unavailable();
  }
  const c = results[0].value;
  const f = c.value;
  const HEADER = header(f, aromeLater);
  const last = f.days[f.days.length - 1]?.date;
  const avertissements = warnings(f, r.lieu);
  if (aromeDown) avertissements.push(aromeDownWarning);
  if (c.stale) avertissements.push("Service de prévision momentanément injoignable : prévision précédente, plus ancienne.");
  if (!period.compris) avertissements.push(`« ${quand} » n'a pas été compris : voici les prochaines 24 h et les jours suivants.`);

  let jours: ReturnType<typeof dayBlock>[];
  let pas: ReturnType<typeof stepBlock>[];
  let resume: string;
  if (period.defaut) {
    const horizon = now.getTime() + 24 * HOUR;
    pas = steps(f, (h) => h.time.getTime() < horizon, now);
    const days = f.days.filter((d) => d.date >= today);
    jours = days.map((d) => dayBlock(f, d, uvOf, confOf));
    resume = `${HEADER} pour ${r.lieu.nom} — ` +
      days.map((d) => `${d.date === today ? "aujourd'hui" : dayLabel(d.date)} : ${daySentence(f, d, uvOf, confOf)}`).join("\u00a0; ") + ".";
  } else {
    const inRange = period.slots.filter((s) => s.jour <= last);
    if (!inRange.length) {
      const furthest = f.relais?.[0]?.model ?? f.model;
      return text({
        nature: "prevision",
        lieu: placeBlock(lieu, r),
        resume: `Pas de prévision pour ${period.libelle} : le modèle ${furthest.nom} ne va que jusqu'au ${dayLabel(last)}.`,
        modele: modelBlock(c),
        avertissements: hauts ? [...avertissements, nuages.BEYOND] : avertissements,
        sources: sourcesOf(f),
      });
    }
    const days = f.days.filter((d) => inRange.some((s) => s.jour === d.date));
    jours = days.map((d) => dayBlock(f, d, uvOf, confOf));
    pas = steps(f, (h) => inRange.some((s) => s.jour === localDate(h.time) && localHour(h.time) >= s.de && localHour(h.time) < s.a), now);
    const partial = inRange.some((s) => s.de > 0 || s.a < 24);
    resume = partial && pas.length
      ? `${HEADER} pour ${r.lieu.nom}, ${period.libelle} : ` +
        pas.map((s) => `${s.heures.split(" ").pop()} ${[s.ciel, s.temperature, s.pluie].filter(Boolean).join(", ")}`).join("\u00a0; ") + "."
      : days.length === 1
        ? `${HEADER} pour ${r.lieu.nom}, ${period.libelle === dayLabel(days[0].date) ? period.libelle : `${period.libelle} (${dayLabel(days[0].date)})`} : ` +
          `${daySentence(f, days[0], uvOf, confOf)}.`
        : `${HEADER} pour ${r.lieu.nom}, ${period.libelle} — ` +
          days.map((d) => `${dayLabel(d.date)} : ${daySentence(f, d, uvOf, confOf)}`).join("\u00a0; ") + ".";
    if (inRange.length < period.slots.length) avertissements.push(`Le modèle ne va que jusqu'au ${dayLabel(last)}.`);
    if (hauts && inRange.some((s) => s.jour > addDays(today, 2))) avertissements.push(nuages.BEYOND);
  }
  const mer = hauts ? nuages.merDeNuages(f, r.lieu, now, { jour: cloudDay }) : null;

  const uvShown = jours.some((j) => j.indice_uv_max) ? u : null;
  const ensShown = jours.some((j) => j.confiance) ? ens : null;
  avertissements.push(...uvWarnings(uvShown), ...ensWarnings(ensShown));
  return text({
    nature: "prevision",
    lieu: placeBlock(lieu, r),
    periode: period.libelle,
    // The cloud sea after the days, labelled: a forecast of the model's cell.
    resume: mer ? `${resume} Mer de nuages, ${nuages.LABEL} : ${mer.resume}` : resume,
    jours,
    pas_de_3h: pas,
    ...(mer ? { mer_de_nuages: mer } : {}),
    modele: modelBlock(c),
    avertissements,
    couverture: coverage(),
    sources: sourcesOf(f, uvShown, ensShown),
  });
}
