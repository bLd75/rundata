/**
 * historique_meteo: the weather that was, measured by the Météo-France stations of the island, day by day back to the
 * station's first year, against the 1991-2020 normal and the station's records. « Il a beaucoup plu ce mois-ci ? »,
 * « il fait gris tous les jours depuis deux semaines ? », « quelle température hier à Cilaos ? », « record de chaleur
 * à Gillot ? », « il y a 20 ans ce jour-là ? ».
 *
 * Each kind of measurement comes from the best station that has it over the period (the same choice as meteo_actuelle:
 * distance, altitude, side of the island), since a rain gauge is often closer than a full station and only about
 * fifteen stations measure sunshine.
 *
 * For a few days (and back to 2000), the answer also goes hour by hour, from the hourly archive: « à quelle heure a-t-il
 * plu hier ? », « le soleil s'est caché à quelle heure ? », « rafale max cette nuit ? ». The hourly file of the current
 * period is published every morning with the night that just ended, so today's first hours are there too.
 */
import type { Cache } from "../cache.js";
import { type Place, resolvePlace } from "../places/resolve.js";
import * as climat from "../providers/climat.js";
import { type Field, type HourField, type Month, type Poste, type PosteHoraire, type Year } from "../providers/climat.js";
import { SOURCE as METEOFRANCE, STATIONS_974, VEILLE, type Veille } from "../providers/meteofrance-stations.js";
import { compass } from "../geo.js";
import type { Station } from "../types.js";
import { why } from "../types.js";
import { a, credits, fr, notFound, placeBlock, text } from "./format.js";
import { fit } from "./representativeness.js";
import { rienTrouve } from "../vide.js";

/** Up to this many days, one row per day; up to 2 years one per month; beyond, one per year. */
const DAILY_MAX = 62;
const MONTHLY_MAX = 731;
/** The longest period one answer reads: every year read is a row of every station tried, to parse within the Worker's CPU time. */
const YEARS_MAX = 10;
const DEFAULT_DAYS = 30;
/** A station speaks for a period when it measured at least this share of its days. */
const COVERAGE = 0.6;
/** Below this share of the possible sunshine, a day is grey. */
const GREY_SIGMA = 30;
const SUNNY_SIGMA = 70;
const CANDIDATES = 8;
const LONG_CANDIDATES = 2;
/** Hour by hour on its own up to this many days, on demand up to HOURLY_MAX. */
const HOURLY_AUTO = 3;
const HOURLY_MAX = 7;
const HOURLY_FROM = "2000-01-01";
const HOURLY_CANDIDATES = 3;
/** A rain gauge counts by 0.2 mm: one tip is rain. */
const RAIN_HOUR_MM = 0.2;
/** An hour with at least this many minutes of sunshine is sunny. */
const SUNNY_HOUR_MIN = 30;

// The island without a place: one station per climate (north coast, west, south, east, the Hauts, the cirques).
const TOUR = [
  ["97418110", "nord (Saint-Denis)"],
  ["97415590", "ouest (côte sous le vent)"],
  ["97416463", "sud (Saint-Pierre)"],
  ["97410238", "est (au vent)"],
  ["97422440", "Hauts (Plaine des Cafres)"],
  ["97424410", "cirque de Cilaos"],
] as const;

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const DAY_MS = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const frDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const round1 = (n: number) => Math.round(n * 10) / 10;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export interface Period {
  du: string;
  au: string;
}

/** « 2026-10-01 », « 01/10/2026 », « 01/10 », « 2026-10 » (a month), « 2006 » (a year); null when not a date. */
export function parseDate(s: string, end: boolean, today: string): string | null {
  const t = s.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) return t;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if ((m = /^(\d{1,2})\/(\d{1,2})$/.exec(t))) {
    const d = `${today.slice(0, 4)}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return d > today ? `${+today.slice(0, 4) - 1}${d.slice(4)}` : d;
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(t))) return end ? `${t}-${String(daysIn(+m[1], +m[2])).padStart(2, "0")}` : `${t}-01`;
  if ((m = /^(\d{4})$/.exec(t))) return end ? `${t}-12-31` : `${t}-01-01`;
  return null;
}

/**
 * The period asked: `jours` days up to yesterday, or from `du` to `au` (either alone means one day, month or year).
 * `today`: the hours of today may be asked (the hourly archive has the night that just ended), not only up to yesterday.
 */
export function period(now: Date, jours?: number, du?: string, au?: string, today = false): Period | { erreur: string } {
  const yesterday = iso(now.getTime() + 4 * 3600_000 - DAY_MS);
  const last = today ? iso(now.getTime() + 4 * 3600_000) : yesterday;
  if (du || au) {
    const from = parseDate(du ?? au!, false, last);
    const to = parseDate(au ?? du!, true, last);
    if (!from || !to) return { erreur: "Date non comprise : écrire « 2026-10-01 », « 01/10/2026 », « 2026-10 » (un mois) ou « 2006 » (une année)." };
    const p = from <= to ? { du: from, au: to } : { du: to, au: from };
    if (p.au > last) p.au = last;
    if (p.du > p.au) return { erreur: `Pas encore de mesure pour cette date : ${LOADED}. Pour aujourd'hui, voir meteo_actuelle.` };
    if (+p.au.slice(0, 4) - +p.du.slice(0, 4) >= YEARS_MAX) return { erreur: `Période trop longue : ${YEARS_MAX} ans au plus par question.` };
    return p;
  }
  const n = Math.min(Math.max(Math.round(jours ?? DEFAULT_DAYS), 1), YEARS_MAX * 365);
  return { du: iso(Date.parse(yesterday) - (n - 1) * DAY_MS), au: yesterday };
}

function* days(p: Period): Generator<string> {
  for (let t = Date.parse(p.du); t <= Date.parse(p.au); t += DAY_MS) yield iso(t);
}

const asStation = (p: Poste): Station => ({ source: "mf_climatologie", id: p.poste, nom: p.nom, lon: p.lon, lat: p.lat, altitude_m: p.alt, variables: p.params });

/** Daylight from sunrise to sunset, in minutes: what SIGMA divides the sunshine by, for the stations without it. */
function daylight(lat: number, doy: number): number {
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (doy - 81));
  const r = Math.PI / 180;
  const x = -Math.tan(lat * r) * Math.tan(decl * r);
  return ((2 * Math.acos(Math.max(-1, Math.min(1, x)))) / r / 15) * 60;
}

interface Series {
  poste: Poste;
  ys: Map<number, Year>;
}

const value = (s: Series | undefined, f: Field, d: string) => (s ? climat.valueOn(s.ys, f, d) : null);
const share = (s: Series, f: Field, p: Period) => {
  let n = 0;
  let got = 0;
  for (const d of days(p)) {
    n++;
    if (climat.valueOn(s.ys, f, d) != null) got++;
  }
  return got / n;
};

function sigmaOn(s: Series, d: string): number | null {
  const sg = climat.valueOn(s.ys, "SIGMA", d);
  if (sg != null) return sg;
  const inst = climat.valueOn(s.ys, "INST", d);
  return inst == null ? null : Math.min(100, Math.round((100 * inst) / daylight(s.poste.lat, climat.dayOfYear(d))));
}

/** The normal of the period: rain prorated day by day from the monthly normal, temperatures and sunshine averaged. */
function normalOver(n: climat.Normales | undefined, p: Period) {
  if (!n) return {};
  let rr = 0;
  let rrOk = true;
  const tx: number[] = [];
  const tn: number[] = [];
  const inst: number[] = [];
  for (const d of days(p)) {
    const m = +d.slice(5, 7) - 1;
    const r = n.rr?.[m];
    if (r == null) rrOk = false;
    else rr += r / daysIn(+d.slice(0, 4), m + 1);
    if (n.tx?.[m] != null) tx.push(n.tx[m]!);
    if (n.tn?.[m] != null) tn.push(n.tn[m]!);
    if (n.inst?.[m] != null) inst.push(n.inst[m]!);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined);
  return { rr: rrOk && n.rr ? Math.round(rr) : undefined, tx: mean(tx), tn: mean(tn), instH: mean(inst) && mean(inst)! / 60 };
}

function stationBlock(place: Place | null, p: Poste, what: string) {
  const f = place ? fit(place, asStation(p)) : undefined;
  return {
    mesure: what,
    station: p.nom,
    altitude_m: p.alt,
    mesures_depuis: p.debut,
    ...(f ? { distance_km: f.distance_km, direction: f.direction, ecart_altitude_m: f.ecart_altitude_m, pertinence: f.pertinence, avertissements: f.avertissements.length ? f.avertissements : undefined } : {}),
  };
}

/** Each station used once, with everything taken from it. */
function stationsUsed(place: Place, uses: [Series | undefined, string][]) {
  const by = new Map<Poste, string[]>();
  for (const [s, what] of uses) if (s) by.set(s.poste, [...(by.get(s.poste) ?? []), what]);
  return [...by].map(([p, what]) => stationBlock(place, p, what.join(", ")));
}

/** Sums and means of a period at the chosen stations. */
function summary(p: Period, rain?: Series, temp?: Series, sun?: Series) {
  const out: Record<string, unknown> = {};
  const ds = [...days(p)];
  if (rain) {
    const vals = ds.map((d) => [d, value(rain, "RR", d)] as const).filter(([, v]) => v != null) as [string, number][];
    const total = round1(vals.reduce((s, [, v]) => s + v, 0));
    const wettest = vals.reduce<[string, number] | null>((b, x) => (!b || x[1] > b[1] ? x : b), null);
    const norm = normalOver(climat.normalesOf(rain.poste.poste), p);
    out.pluie = {
      total_mm: total,
      jours_de_pluie: vals.filter(([, v]) => v >= 1).length,
      jours_mesures: vals.length,
      jours_periode: ds.length,
      normale_mm: norm.rr,
      rapport_a_la_normale: norm.rr ? `${Math.round((100 * total) / Math.max(norm.rr, 0.1))} %` : undefined,
      jour_le_plus_pluvieux: wettest && wettest[1] > 0 ? { date: frDate(wettest[0]), mm: wettest[1] } : undefined,
    };
  }
  if (temp) {
    const tx = ds.map((d) => [d, value(temp, "TX", d)] as const).filter(([, v]) => v != null) as [string, number][];
    const tn = ds.map((d) => [d, value(temp, "TN", d)] as const).filter(([, v]) => v != null) as [string, number][];
    const mean = (xs: [string, number][]) => round1(xs.reduce((s, [, v]) => s + v, 0) / xs.length);
    const norm = normalOver(climat.normalesOf(temp.poste.poste), p);
    const hot = tx.reduce<[string, number] | null>((b, x) => (!b || x[1] > b[1] ? x : b), null);
    const cold = tn.reduce<[string, number] | null>((b, x) => (!b || x[1] < b[1] ? x : b), null);
    out.temperatures = {
      maximales_moyenne: tx.length ? mean(tx) : undefined,
      maximales_normale: norm.tx != null ? round1(norm.tx) : undefined,
      minimales_moyenne: tn.length ? mean(tn) : undefined,
      minimales_normale: norm.tn != null ? round1(norm.tn) : undefined,
      jour_le_plus_chaud: hot ? { date: frDate(hot[0]), tx: hot[1] } : undefined,
      nuit_la_plus_fraiche: cold ? { date: frDate(cold[0]), tn: cold[1] } : undefined,
    };
  }
  if (sun) {
    const inst = ds.map((d) => value(sun, "INST", d)).filter((v): v is number => v != null);
    const sig = ds.map((d) => sigmaOn(sun, d)).filter((v): v is number => v != null);
    const norm = normalOver(climat.normalesOf(sun.poste.poste), p);
    out.ensoleillement = {
      heures_par_jour: inst.length ? round1(inst.reduce((s, v) => s + v, 0) / inst.length / 60) : undefined,
      normale_heures_par_jour: norm.instH != null ? round1(norm.instH) : undefined,
      jours_gris: sig.filter((v) => v < GREY_SIGMA).length,
      jours_ensoleilles: sig.filter((v) => v >= SUNNY_SIGMA).length,
      jours_mesures: sig.length,
      definition: `Jour gris : moins de ${GREY_SIGMA} % du soleil possible ce jour-là\u00a0; ensoleillé : ${SUNNY_SIGMA} % ou plus.`,
    };
  }
  return out;
}

function dailyRows(p: Period, rain?: Series, temp?: Series, sun?: Series) {
  return [...days(p)].map((d) => {
    const fxi = value(temp, "FXI", d);
    const inst = value(sun, "INST", d);
    return {
      date: frDate(d),
      pluie_mm: value(rain, "RR", d) ?? undefined,
      tmin: value(temp, "TN", d) ?? undefined,
      tmax: value(temp, "TX", d) ?? undefined,
      soleil_h: inst != null ? round1(inst / 60) : undefined,
      soleil_pct: sun ? (sigmaOn(sun, d) ?? undefined) : undefined,
      rafale_max_kmh: fxi != null ? Math.round(fxi * 3.6) : undefined,
    };
  });
}

/** One row per month (or per year), each against its normal. */
function groupedRows(p: Period, by: "mois" | "annee", rain?: Series, temp?: Series, sun?: Series) {
  const groups = new Map<string, Period>();
  for (const d of days(p)) {
    const k = by === "mois" ? d.slice(0, 7) : d.slice(0, 4);
    const g = groups.get(k);
    if (g) g.au = d;
    else groups.set(k, { du: d, au: d });
  }
  return [...groups].map(([k, g]) => {
    const s = summary(g, rain, temp, sun) as { pluie?: { total_mm: number; jours_de_pluie: number; normale_mm?: number; jours_mesures: number }; temperatures?: { maximales_moyenne?: number; maximales_normale?: number; minimales_moyenne?: number }; ensoleillement?: { heures_par_jour?: number; normale_heures_par_jour?: number } };
    return {
      [by]: by === "mois" ? `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}` : k,
      pluie_mm: s.pluie?.jours_mesures ? s.pluie.total_mm : undefined,
      pluie_normale_mm: s.pluie?.normale_mm,
      jours_de_pluie: s.pluie?.jours_mesures ? s.pluie.jours_de_pluie : undefined,
      tmax_moyenne: s.temperatures?.maximales_moyenne,
      tmax_normale: s.temperatures?.maximales_normale,
      tmin_moyenne: s.temperatures?.minimales_moyenne,
      soleil_h_par_jour: s.ensoleillement?.heures_par_jour,
      soleil_normale_h: s.ensoleillement?.normale_heures_par_jour,
    };
  });
}

/** The station's records, with the years after the stored ones. */
async function recordsOf(s: Series, months: number[], now: Date) {
  const r = await climat.records(s.poste.poste);
  if (!r) return undefined;
  const thisYear = +iso(now.getTime() + 4 * 3600_000).slice(0, 4);
  const extra = r.jusqu_a < thisYear ? (await climat.years([s.poste.poste], r.jusqu_a + 1, thisYear)).get(s.poste.poste) : undefined;
  const best = (f: Field, cur: climat.Extreme | undefined | null, beats: (a: number, b: number) => boolean, month?: number) => {
    let b = cur ?? undefined;
    for (const [y, yr] of extra ?? []) {
      (yr[f] ?? []).forEach((v, i) => {
        if (v == null) return;
        const d = iso(Date.UTC(y, 0, 1) + i * DAY_MS);
        if (month != null && +d.slice(5, 7) - 1 !== month) return;
        if (!b || beats(v, b[0])) b = [v, d];
      });
    }
    return b && { valeur: b[0], date: frDate(b[1]) };
  };
  const hi = (x: number, y: number) => x > y;
  const lo = (x: number, y: number) => x < y;
  return {
    station: s.poste.nom,
    depuis: s.poste.debut,
    temperature_max: best("TX", r.tx, hi),
    temperature_min: best("TN", r.tn, lo),
    pluie_en_un_jour_mm: best("RR", r.rr, hi),
    rafale_max_kmh: (() => {
      const x = best("FXI", r.fxi, hi);
      return x && { valeur: Math.round(x.valeur * 3.6), date: x.date };
    })(),
    par_mois: months.length <= 3
      ? months.map((m) => ({
          mois: MONTHS[m],
          temperature_max: best("TX", r.mois.tx?.[m], hi, m),
          temperature_min: best("TN", r.mois.tn?.[m], lo, m),
          pluie_en_un_jour_mm: best("RR", r.mois.rr?.[m], hi, m),
        }))
      : undefined,
  };
}

/** The page of a station (web/station.ts): its last 30 days, its year month by month, its records. */
export interface StationHistory {
  /** The first year of its measurements. */
  depuis: number;
  /** The last day the archive has, YYYY-MM-DD. */
  jusqu_au: string;
  trente: { du: string; au: string; resume: ReturnType<typeof summary>; jours: ReturnType<typeof dailyRows> };
  annee: { annee: number; resume: ReturnType<typeof summary>; mois: ReturnType<typeof groupedRows> };
  records?: Awaited<ReturnType<typeof recordsOf>>;
}

/**
 * A station's history, from the days of this year and the year before (one query) and its records (one, and one more
 * for the years after them); undefined when the archive is not there or does not have the station, or has nothing of
 * its last two years.
 */
export async function stationHistory(cache: Cache, id: string, now: Date): Promise<StationHistory | undefined> {
  if (!climat.enabled()) return undefined;
  const poste = (await climat.postes(cache)).value.find((p) => p.poste === id);
  if (!poste) return undefined;
  const yesterday = iso(now.getTime() + 4 * 3600_000 - DAY_MS);
  const year = +yesterday.slice(0, 4);
  const ys = (await climat.years([id], year - 1, year)).get(id);
  const last = ys && lastDay(new Map([[id, ys]]), yesterday);
  if (!ys || !last) return undefined;
  const s: Series = { poste, ys };
  const has = (f: Field) => (poste.params.includes(f) ? s : undefined);
  const [rain, temp, sun] = [has("RR"), has("TX"), has("INST")];
  const trente = { du: iso(Date.parse(last) - 29 * DAY_MS), au: last };
  const annee = { du: `${last.slice(0, 4)}-01-01`, au: last };
  return {
    depuis: poste.debut,
    jusqu_au: last,
    trente: { ...trente, resume: summary(trente, rain, temp, sun), jours: dailyRows(trente, rain, temp, sun) },
    annee: { annee: +last.slice(0, 4), resume: summary(annee, rain, temp, sun), mois: groupedRows(annee, "mois", rain, temp, sun) },
    records: await recordsOf(s, [], now),
  };
}

/**
 * When a day's measurements reach rundata.re: Météo-France publishes them the next morning (its files seen at 09:56 for
 * the days, 10:52 for the hours, 24 and 25 October 2026), and .github/workflows/climat.yml loads them at 11:45.
 */
const LOADED = "Météo-France publie les mesures d'un jour le lendemain matin, et rundata.re les charge chaque jour vers midi (heure de La Réunion)";

/** The last day the stations read have a rain or a temperature for, up to `yesterday`: what the archive has now. */
export function lastDay(read: Map<string, Map<number, Year>>, yesterday: string): string | undefined {
  let last: string | undefined;
  for (const ys of read.values())
    for (const [year, y] of ys)
      for (const col of [y.RR, y.TX]) {
        let i = (col?.length ?? 0) - 1;
        while (i >= 0 && col![i] == null) i--;
        const d = i >= 0 ? iso(Date.UTC(year, 0, 1) + i * DAY_MS) : undefined;
        if (d && d <= yesterday && (!last || d > last)) last = d;
      }
  return last;
}

/** The days of the period after the last day loaded: « 24/10/2026 », « 23/10/2026 au 24/10/2026 »; none when all are. */
function pending(p: Period, now: Date, last: string | undefined): string | undefined {
  const yesterday = iso(now.getTime() + 4 * 3600_000 - DAY_MS);
  const au = p.au < yesterday ? p.au : yesterday;
  if (!last || last >= au) return undefined;
  const du = p.du > last ? p.du : iso(Date.parse(last) + DAY_MS);
  return `${frDate(du)}${du !== au ? ` au ${frDate(au)}` : ""}`;
}

/** Said after the figures when the period's last days are not loaded yet. */
export function notYet(p: Period, now: Date, last: string | undefined): string {
  const days = pending(p, now, last);
  return days ? ` Les mesures du ${days} ne sont pas encore disponibles : ${LOADED}. Dernier jour disponible : ${frDate(last!)}.` : "";
}

// Nothing measured over the period asked. Its days not loaded yet are said as such, with the last day loaded; never as
// « no station », which is false for a town with a station and would send the model to donner_avis for nothing.
const RECENT_DAYS = 3;
export function nothing(where: string, p: Period, now: Date, last?: string): string {
  const days = pending(p, now, last);
  if (days) return `Les mesures du ${days} ne sont pas encore disponibles : ${LOADED}. Dernier jour disponible : ${frDate(last!)}. Pour maintenant, meteo_actuelle.`;
  // Nothing read at all: the archive cannot say its last day.
  const yesterday = iso(now.getTime() + 4 * 3600_000 - DAY_MS);
  const recent = !last && p.au >= yesterday && Math.round((Date.parse(p.au) - Date.parse(p.du)) / DAY_MS) < RECENT_DAYS;
  return recent
    ? `Les mesures du ${frDate(p.du)}${p.du !== p.au ? ` au ${frDate(p.au)}` : ""} ne sont peut-être pas encore disponibles : ${LOADED}. Réessayer plus tard\u00a0; pour maintenant, meteo_actuelle.`
    : `Aucune station ne mesurait ${a(where)} ou près de là sur cette période.`;
}

const COMMON = {
  nature: "mesure",
  a_savoir: [
    "Mesures quotidiennes des stations Météo-France, chargées chaque jour vers midi (heure de La Réunion) avec la veille : le dernier jour disponible est hier après le chargement, avant-hier avant. Pour aujourd'hui, voir meteo_actuelle\u00a0; pour les jours à venir, prevision_meteo.",
    "La pluie d'un jour est celle tombée de 10 h ce jour-là à 10 h le lendemain (heure de La Réunion), comme Météo-France la compte.",
    `Normales : moyennes 1991-2020 de la station, calculées sur les mesures de Météo-France (au moins 10 années).`,
    `Heure par heure (depuis 2000) : donné pour ${HOURLY_AUTO} jours ou moins, et jusqu'à ${HOURLY_MAX} jours avec detail « heure »\u00a0; chargé chaque jour vers midi (heure de La Réunion) avec la nuit qui vient de finir, si bien qu'après midi les premières heures d'aujourd'hui y sont.`,
  ],
};

function sentence(where: string, p: Period, s: Record<string, unknown>, names: { rain?: string; temp?: string; sun?: string }): string {
  if (p.du === p.au) return oneDay(where, p.du, s, names);
  const parts: string[] = [];
  const pl = s.pluie as { total_mm: number; jours_de_pluie: number; normale_mm?: number; jours_mesures: number } | undefined;
  if (pl?.jours_mesures) parts.push(`${fr(pl.total_mm)} mm de pluie à ${names.rain} (${pl.jours_de_pluie} jour${pl.jours_de_pluie > 1 ? "s" : ""} de pluie${pl.normale_mm != null ? `, normale ≈ ${pl.normale_mm} mm` : ""})`);
  const t = s.temperatures as { maximales_moyenne?: number; maximales_normale?: number; minimales_moyenne?: number } | undefined;
  if (t?.maximales_moyenne != null) parts.push(`maximales ${fr(t.maximales_moyenne)} °C en moyenne${t.maximales_normale != null ? ` (normale ${fr(t.maximales_normale)} °C)` : ""}, minimales ${fr(t.minimales_moyenne ?? NaN)} °C à ${names.temp}`);
  const e = s.ensoleillement as { heures_par_jour?: number; normale_heures_par_jour?: number; jours_gris: number; jours_mesures: number } | undefined;
  if (e?.jours_mesures) parts.push(`soleil ${e.heures_par_jour != null ? `${fr(e.heures_par_jour)} h par jour` : ""}${e.normale_heures_par_jour != null ? ` (normale ${fr(e.normale_heures_par_jour)} h)` : ""}, ${e.jours_gris} jour${e.jours_gris > 1 ? "s" : ""} gris sur ${e.jours_mesures} à ${names.sun}`);
  const span = p.du === p.au ? `le ${frDate(p.du)}` : `du ${frDate(p.du)} au ${frDate(p.au)}`;
  return `${where}, ${span} : ${parts.join("\u00a0; ") || "aucune mesure publiée"}.`;
}

function oneDay(where: string, d: string, s: Record<string, unknown>, names: { rain?: string; temp?: string; sun?: string }): string {
  const parts: string[] = [];
  const pl = s.pluie as { total_mm: number; jours_mesures: number; normale_mm?: number } | undefined;
  if (pl?.jours_mesures) parts.push(`${fr(pl.total_mm)} mm de pluie à ${names.rain}`);
  const t = s.temperatures as { maximales_moyenne?: number; minimales_moyenne?: number; maximales_normale?: number } | undefined;
  if (t?.maximales_moyenne != null || t?.minimales_moyenne != null) {
    parts.push(`minimale ${t.minimales_moyenne != null ? `${fr(t.minimales_moyenne)} °C` : "non mesurée"}, maximale ${t.maximales_moyenne != null ? `${fr(t.maximales_moyenne)} °C` : "non mesurée"}${t.maximales_normale != null ? ` (normale du mois ${fr(t.maximales_normale)} °C)` : ""} à ${names.temp}`);
  }
  const e = s.ensoleillement as { heures_par_jour?: number; jours_mesures: number } | undefined;
  if (e?.jours_mesures && e.heures_par_jour != null) parts.push(`${fr(e.heures_par_jour)} h de soleil à ${names.sun}`);
  return `${where}, le ${frDate(d)} : ${parts.join("\u00a0; ") || "aucune mesure publiée"}.`;
}

interface HourSeries {
  poste: PosteHoraire;
  ms: Map<number, Month>;
}

const asHourStation = (p: PosteHoraire): Station => ({ source: "mf_climatologie_horaire", id: p.poste, nom: p.nom, lon: p.lon, lat: p.lat, altitude_m: p.alt, variables: p.params });
const asPoste = (p: PosteHoraire): Poste => ({ ...p, debut: Math.floor(p.debut / 100), fin: Math.floor(p.fin / 100), params: [] });
const ym = (d: string) => +d.slice(0, 4) * 100 + +d.slice(5, 7);
const at = (s: HourSeries | undefined, f: HourField, h: Hour) => (s ? climat.valueAt(s.ms, f, h.day, h.hour) : null);

interface Hour {
  day: string;
  hour: number;
}

/** Every hour of the period, up to the current one when it ends today. */
function hours(p: Period, now: Date): Hour[] {
  const local = new Date(now.getTime() + 4 * 3600_000).toISOString();
  const out: Hour[] = [];
  for (const day of days(p)) {
    for (let hour = 0; hour < 24; hour++) {
      if (day > local.slice(0, 10) || (day === local.slice(0, 10) && hour > +local.slice(11, 13))) break;
      out.push({ day, hour });
    }
  }
  return out;
}

/** « 13 h », « entre 13 h et 17 h »: each value is the one of the hour ending at its time. */
function spans(hs: number[]): string[] {
  const out: string[] = [];
  let start = -1;
  hs.forEach((h, i) => {
    if (start < 0) start = h;
    if (hs[i + 1] !== h + 1) {
      out.push(`entre ${start === 0 ? "23 h (la veille)" : `${start - 1} h`} et ${h} h`);
      start = -1;
    }
  });
  return out;
}

/** What one day was like hour by hour, in a sentence and as figures. */
function dayFacts(day: string, hs: Hour[], rain?: HourSeries, temp?: HourSeries, sun?: HourSeries, wind?: HourSeries) {
  const mine = hs.filter((h) => h.day === day);
  const rr = mine.map((h) => [h.hour, at(rain, "RR1", h)] as const).filter(([, v]) => v != null) as [number, number][];
  const wet = rr.filter(([, v]) => v >= RAIN_HOUR_MM);
  const t = mine.map((h) => [h.hour, at(temp, "T", h)] as const).filter(([, v]) => v != null) as [number, number][];
  const ins = mine.map((h) => [h.hour, at(sun, "INS", h)] as const).filter(([, v]) => v != null) as [number, number][];
  const sunny = ins.filter(([, v]) => v >= SUNNY_HOUR_MIN).map(([h]) => h);
  const gusts = mine.map((h) => [h.hour, at(wind, "FXI", h)] as const).filter(([, v]) => v != null) as [number, number][];
  const max = <T extends [number, number]>(xs: T[], lower = false) => xs.reduce<T | null>((b, x) => (!b || (lower ? x[1] < b[1] : x[1] > b[1]) ? x : b), null);
  const wettest = max(wet);
  const hot = max(t);
  const cold = max(t, true);
  const gust = max(gusts);
  const total = round1(rr.reduce((s, [, v]) => s + v, 0));
  const parts: string[] = [];
  const most = wettest && wet.length > 1 ? `, dont ${fr(wettest[1])} mm en une heure, entre ${wettest[0] === 0 ? "23 h (la veille)" : `${wettest[0] - 1} h`} et ${wettest[0]} h` : "";
  if (rr.length) parts.push(wet.length ? `pluie ${spans(wet.map(([h]) => h)).join(", ")} (${fr(total)} mm${most})` : "pas de pluie");
  if (ins.length) {
    const daylight = ins.filter(([h]) => h >= 7 && h <= 18);
    parts.push(sunny.length ? `soleil ${spans(sunny).join(", ")}` : daylight.length ? "pas une heure de vrai soleil" : "");
  }
  if (hot && cold) parts.push(`${fr(cold[1])} °C à ${cold[0]} h, ${fr(hot[1])} °C à ${hot[0]} h`);
  if (gust) parts.push(`rafale max ${Math.round(gust[1] * 3.6)} km/h vers ${gust[0]} h`);
  return {
    texte: `${frDate(day).slice(0, 5)} : ${parts.filter(Boolean).join("\u00a0; ") || "aucune mesure"}`,
    chiffres: {
      date: frDate(day),
      pluie_mm: rr.length ? total : undefined,
      heures_de_pluie: rr.length ? wet.map(([h, v]) => `${h} h : ${fr(v)} mm`) : undefined,
      heures_ensoleillees: ins.length ? sunny.length : undefined,
      tmin: cold ? { valeur: cold[1], heure: `${cold[0]} h` } : undefined,
      tmax: hot ? { valeur: hot[1], heure: `${hot[0]} h` } : undefined,
      rafale_max_kmh: gust ? { valeur: Math.round(gust[1] * 3.6), heure: `${gust[0]} h` } : undefined,
    },
  };
}

/** The period hour by hour at the best stations of the hourly archive near the place. */
async function hourly(cache: Cache, place: Place, p: Period, now: Date) {
  const m0 = ym(p.du);
  const m1 = ym(p.au);
  const all = (await climat.postesHoraires(cache)).value.filter((x) => x.debut <= m1 && x.fin >= m0);
  const ranked = all.map((x) => ({ x, f: fit(place, asHourStation(x)) })).sort((u, v) => u.f.score - v.f.score);
  const pick = (f: HourField) => ranked.filter((r) => r.x.params.includes(f)).slice(0, HOURLY_CANDIDATES).map((r) => r.x);
  const wanted = [...new Set([...pick("RR1"), ...pick("T"), ...pick("INS").slice(0, 2), ...pick("FXI").slice(0, 2)])];
  const read = await climat.months(wanted.map((x) => x.poste), m0, m1);
  const hs = hours(p, now);
  const series = (x: PosteHoraire): HourSeries => ({ poste: x, ms: read.get(x.poste) ?? new Map() });
  const covered = (s: HourSeries, f: HourField) => hs.filter((h) => at(s, f, h) != null).length / Math.max(hs.length, 1);
  const best = (f: HourField) => pick(f).map(series).find((s) => covered(s, f) >= COVERAGE);
  const temp = best("T");
  const rain = best("RR1");
  const sun = best("INS");
  // The gusts of the temperature station when it has them, so that both read the same place.
  const wind = temp && covered(temp, "FXI") >= COVERAGE ? temp : best("FXI");
  if (!rain && !temp && !sun) return undefined;
  const lignes = hs.map((h) => {
    const ff = at(wind, "FF", h);
    const dd = at(wind, "DD", h);
    const fxi = at(wind, "FXI", h);
    const row = {
      heure: `${frDate(h.day).slice(0, 5)} ${h.hour} h`,
      pluie_mm: at(rain, "RR1", h) ?? undefined,
      temperature: at(temp, "T", h) ?? undefined,
      humidite_pct: at(temp, "U", h) ?? undefined,
      vent_kmh: ff != null ? Math.round(ff * 3.6) : undefined,
      vent_de: dd != null && ff ? compass(dd) : undefined,
      rafale_kmh: fxi != null ? Math.round(fxi * 3.6) : undefined,
      soleil_min: at(sun, "INS", h) ?? undefined,
    };
    return Object.values(row).filter((v) => v !== undefined).length > 1 ? row : null;
  }).filter((r) => r !== null);
  const facts = [...days(p)].map((d) => dayFacts(d, hs, rain, temp, sun, wind));
  const used = new Map<PosteHoraire, string[]>();
  for (const [s, what] of [[rain, "pluie"], [temp, "température, humidité"], [wind, "vent et rafales"], [sun, "ensoleillement"]] as [HourSeries | undefined, string][]) {
    if (s) used.set(s.poste, [...(used.get(s.poste) ?? []), what]);
  }
  // Today's hours stop at the last one published (the file comes out in the morning).
  const lastHour = [...hs].reverse().find((h) => [rain, temp, sun].some((x) => x && (at(x, "RR1", h) ?? at(x, "T", h) ?? at(x, "INS", h)) != null));
  const today = iso(now.getTime() + 4 * 3600_000);
  // The hours may come from another station than the days (the place's own has gaps): name it, with how far it is.
  const where = [...used.keys()].map((x) => {
    const b = stationBlock(place, asPoste(x), "") as { distance_km?: number; ecart_altitude_m?: number };
    const km = b.distance_km ?? 0;
    const dz = b.ecart_altitude_m ?? 0;
    if (km < 2 && Math.abs(dz) < 100) return x.nom;
    return `${x.nom}, à ${fr(km)} km${Math.abs(dz) >= 100 ? ` et ${Math.abs(dz)} m plus ${dz > 0 ? "haut" : "bas"}` : ""}`;
  }).join("\u00a0; ");
  return {
    ou: where,
    texte: facts.map((f) => f.texte).join(". ") + (p.au === today && lastHour ? ` (aujourd'hui, publié jusqu'à ${lastHour.hour} h)` : ""),
    bloc: {
      definition: "Heure de La Réunion. Chaque valeur est celle de l'heure qui se termine à l'heure indiquée : la pluie de « 15 h » est tombée entre 14 h et 15 h, le soleil de « 15 h » est en minutes sur cette heure-là, la rafale est la plus forte de l'heure. La température est celle relevée à l'heure pile : le maximum et le minimum de la journée, mesurés en continu, peuvent la dépasser un peu.",
      jusqu_a: hs.length ? `${frDate(hs[hs.length - 1].day)} ${hs[hs.length - 1].hour} h` : undefined,
      stations: [...used].map(([x, what]) => stationBlock(place, asPoste(x), `heure par heure : ${what.join(", ")}`)),
      par_jour: facts.map((f) => f.chiffres),
      heures: lignes,
    },
  };
}

/**
 * Yesterday 0 h to 24 h at the best Météo-France station near the place that measured its rain every hour, as kept at
 * 00:20 by the scheduled event (providers/meteofrance.ts keepVeille): said until the daily file is loaded at noon.
 */
async function provisoire(cache: Cache, place: Place, jour: string) {
  let kept;
  try {
    kept = (await cache.kept<Veille>(VEILLE))?.value;
  } catch (err) {
    console.error("veille indisponible", why(err));
    return undefined;
  }
  if (kept?.jour !== jour) return undefined;
  const best = STATIONS_974.filter(([id]) => kept.stations[id]?.rr != null)
    .map(([id, nom, lat, lon, altitude_m]): Station => ({ source: "meteofrance", id, nom, lat, lon, altitude_m, variables: [] }))
    .map((s) => ({ s, f: fit(place, s) })).sort((u, v) => u.f.score - v.f.score)[0];
  if (!best) return undefined;
  const v = kept.stations[best.s.id];
  const temps = v.tn != null && v.tx != null ? `, températures de ${fr(v.tn)} °C à ${fr(v.tx)} °C` : "";
  return {
    etiquette: `Provisoire, ${frDate(jour)} 0 h–24 h (heure de La Réunion), relevés horaires Météo-France : pluie ${fr(v.rr!)} mm${temps}.`,
    bloc: {
      jour: frDate(jour),
      periode: "0 h–24 h, heure de La Réunion",
      nature: "mesure provisoire",
      pluie_mm: v.rr,
      temperature_min: v.tn,
      temperature_max: v.tx,
      station: best.s.nom,
      distance_km: best.f.distance_km,
      altitude_m: best.s.altitude_m,
      avertissements: best.f.avertissements.length ? best.f.avertissements : undefined,
    },
  };
}

export async function historiqueMeteo(
  cache: Cache,
  lieu: string | undefined,
  opts: { jours?: number; du?: string; au?: string; detail?: "jour" | "heure" } = {},
  now = new Date(),
) {
  if (!climat.enabled()) {
    return { ...text({ erreur: "L'historique météo n'est disponible que sur le serveur en ligne (https://rundata.re/mcp).", consulter: climat.SOURCE.url }), isError: true };
  }
  const canHour = climat.hourlyEnabled() && opts.detail !== "jour";
  const p = period(now, opts.jours, opts.du, opts.au, canHour && !!(opts.du || opts.au));
  if ("erreur" in p) return { ...text(p), isError: true };
  const y0 = +p.du.slice(0, 4);
  const y1 = +p.au.slice(0, 4);
  const n = Math.round((Date.parse(p.au) - Date.parse(p.du)) / DAY_MS) + 1;
  const months = [...new Set([...days(p)].map((d) => +d.slice(5, 7) - 1))];
  const shape = (rain?: Series, temp?: Series, sun?: Series) =>
    n <= DAILY_MAX ? { jours: dailyRows(p, rain, temp, sun) } : n <= MONTHLY_MAX ? { mois: groupedRows(p, "mois", rain, temp, sun) } : { annees: groupedRows(p, "annee", rain, temp, sun) };

  let all: Poste[];
  try {
    all = (await climat.postes(cache)).value;
  } catch (err) {
    console.error(`source ${climat.SOURCE.id} indisponible:`, why(err));
    return { ...text({ erreur: "L'archive des mesures ne répond pas pour le moment.", consulter: climat.SOURCE.url }), isError: true };
  }
  const covers = (x: Poste) => x.debut <= y1 && x.fin >= y0;
  const common = { ...COMMON, periode: { du: frDate(p.du), au: frDate(p.au), jours: n }, sources: credits([climat.SOURCE]) };

  if (!lieu?.trim()) {
    const tour = TOUR.map(([id, zone]) => ({ zone, poste: all.find((x) => x.poste === id) })).filter((t) => t.poste && covers(t.poste)) as { zone: string; poste: Poste }[];
    const read = await climat.years(tour.map((t) => t.poste.poste), y0, y1);
    const rows = tour.map((t) => {
      const s = { poste: t.poste, ys: read.get(t.poste.poste) ?? new Map() };
      const has = (f: Field) => share(s, f, p) >= COVERAGE;
      return { zone: t.zone, station: t.poste.nom, altitude_m: t.poste.alt, lon: t.poste.lon, lat: t.poste.lat, ...summary(p, has("RR") ? s : undefined, has("TX") ? s : undefined, has("INST") ? s : undefined) };
    });
    const resume = rows.map((r) => {
      const pl = (r as { pluie?: { total_mm: number; normale_mm?: number } }).pluie;
      const t = (r as { temperatures?: { maximales_moyenne?: number } }).temperatures;
      return `${r.station} : ${pl ? `${fr(pl.total_mm)} mm${pl.normale_mm != null ? ` (normale ${pl.normale_mm})` : ""}` : "pluie non mesurée"}${t?.maximales_moyenne != null ? `, max ${fr(t.maximales_moyenne)} °C` : ""}`;
    }).join("\u00a0; ");
    const last = lastDay(read, iso(now.getTime() + 4 * 3600_000 - DAY_MS));
    return text({ resume: `La Réunion du ${frDate(p.du)} au ${frDate(p.au)} — ${resume}.${notYet(p, now, last)}`, stations: rows, ...common });
  }

  const res = resolvePlace(lieu);
  if (!res) return notFound(lieu);
  const place = res.lieu;
  const ranked = all.filter(covers).map((x) => ({ x, f: fit(place, asStation(x)) })).sort((u, v) => u.f.score - v.f.score);
  const take = y1 - y0 >= 2 ? LONG_CANDIDATES : CANDIDATES;
  const pick = (f: Field) => ranked.filter((r) => r.x.params.includes(f)).slice(0, take).map((r) => r.x);
  const wanted = [...new Set([...pick("RR"), ...pick("TX"), ...pick("INST").slice(0, take === LONG_CANDIDATES ? 1 : 2)])];
  let read: Map<string, Map<number, Year>>;
  try {
    read = await climat.years(wanted.map((x) => x.poste), y0, y1);
  } catch (err) {
    console.error(`source ${climat.SOURCE.id} indisponible:`, why(err));
    return { ...text({ erreur: "L'archive des mesures ne répond pas pour le moment.", consulter: climat.SOURCE.url }), isError: true };
  }
  const series = (x: Poste): Series => ({ poste: x, ys: read.get(x.poste) ?? new Map() });
  const best = (f: Field) => pick(f).map(series).find((s) => share(s, f, p) >= COVERAGE);
  const rain = best("RR");
  const temp = best("TX");
  const sun = best("INST");

  const s = summary(p, rain, temp, sun);
  const names = { rain: rain?.poste.nom, temp: temp?.poste.nom, sun: sun?.poste.nom };
  let recs;
  try {
    recs = temp ? await recordsOf(temp, months, now) : undefined;
  } catch (err) {
    console.error("records indisponibles", why(err));
  }
  const warn = [rain, temp, sun].filter((x): x is Series => !!x).map((x) => ({ x, f: fit(place, asStation(x.poste)) }))
    .filter(({ f }) => f.pertinence === "faible").map(({ x, f }) => `${x.poste.nom} : ${f.avertissements[0] ?? "station éloignée"}`);
  let hh: Awaited<ReturnType<typeof hourly>>;
  if (canHour && p.du >= HOURLY_FROM && n <= (opts.detail === "heure" ? HOURLY_MAX : HOURLY_AUTO)) {
    try {
      hh = await hourly(cache, place, p, now);
    } catch (err) {
      console.error(`source ${climat.SOURCE_HORAIRE.id} indisponible:`, why(err));
    }
  }
  const daily = rain || temp ? sentence(`${place.nom}`, p, s, names) : "";
  const yesterday = iso(now.getTime() + 4 * 3600_000 - DAY_MS);
  const last = lastDay(read, yesterday);
  // Yesterday asked and not loaded yet: the day as the scheduled event kept it from the hourly package.
  const veille = p.au >= yesterday && (!last || last < yesterday) ? await provisoire(cache, place, yesterday) : undefined;
  // No measure of the period, at no station near: its days not loaded yet, or none measuring there.
  if (!rain && !temp && !sun && !hh && !veille) rienTrouve("historique_meteo");
  return text({
    lieu: placeBlock(lieu, res),
    resume: [daily, hh ? `Heure par heure (station ${hh.ou}) — ${hh.texte}.` : ""].filter(Boolean).join(" ") +
      (warn.length ? ` Attention : ${[...new Set(warn)].join(" ")}` : "") +
      (!rain && !temp && !hh ? ` ${nothing(place.nom, p, now, last)}` : rain || temp ? notYet(p, now, last) : "") +
      (veille ? ` ${veille.etiquette}` : ""),
    stations: stationsUsed(place, [[rain, "pluie"], [temp, "températures et rafales"], [sun, "ensoleillement"]]),
    ...s,
    ...shape(rain, temp, sun),
    hier_provisoire: veille?.bloc,
    heure_par_heure: hh?.bloc,
    records: recs,
    ...common,
    ...(hh || veille ? { sources: credits([climat.SOURCE, ...(hh ? [climat.SOURCE_HORAIRE] : []), ...(veille ? [METEOFRANCE] : [])]) } : {}),
  });
}
