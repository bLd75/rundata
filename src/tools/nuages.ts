/**
 * The cloud sea of the Hauts: where a place in the Hauts or a summit stands against the cloud layer of a morning, from
 * the AROME model's cloud base and top over its cell (providers/arome.ts). « Est-ce dégagé au Maïdo demain matin ? »
 * The cloud sea forms in the morning and rises: the morning is told as two windows, 6–9 h and 9–12 h, which are two
 * steps of the forecast. A forecast, never a measurement, said on every surface with its caveat. Marketing's words.
 *
 * The sky of the night too, from 18 h to 6 h, for everyone: below the Hauts by the cloud cover over the place, in the
 * Hauts against the cloud layer, as in the morning (« le ciel sera dégagé ce soir au Maïdo pour les étoiles ? »).
 */
import type { Place } from "../places/resolve.js";
import type { Forecast, ForecastHour } from "../types.js";

// La Réunion's time (UTC+4, no summer time), as in prevision.ts, which imports this module.
const REUNION_MS = 4 * 3600_000;
const localDate = (d: Date) => new Date(d.getTime() + REUNION_MS).toISOString().slice(0, 10);
const localHour = (d: Date) => new Date(d.getTime() + REUNION_MS).getUTCHours();

/** Places below this are not « in the Hauts »: their mornings are told by the forecast alone. */
export const HAUTS_MIN_M = 800;
// Under this cloud cover, the sky is open whatever the layer.
const CLEAR_PCT = 30;
// Above the top by less than this, a place is at the edge of the cloud sea.
const EDGE_M = 100;
// Clouds whose base is this high are no cloud sea: the view stays open under them. A top this high is that of deep or
// layered clouds, not of the cloud sea: it is not said.
export const HIGH_M = 4000;

/** A step whose clouds are all high (AROME's base over HIGH_M): a veil the view goes on under, said with the sky's word. */
export const eleves = (h: ForecastHour) => h.nuages_base_m != null && h.nuages_base_m > HIGH_M && (h.nuages_pct ?? 0) >= CLEAR_PCT;
const HOUR = 3600_000;

export const LABEL = "prévision du modèle AROME de Météo-France (carrés de 2,5 km)";
export const CAVEAT =
  "Prévision, pas une mesure. Le modèle voit l'île par carrés de 2,5 km : le bord de la mer de nuages peut être quelques " +
  "centaines de mètres plus haut ou plus bas, et un fond de cirque peut rester dégagé quand le carré est couvert, ou l'inverse.";
export const BEYOND = "La mer de nuages n'est prévue que pour les 2 prochains jours : le modèle AROME ne va pas plus loin.";
const CLOSING = "La vue se ferme dans la matinée, selon le modèle.";

export type Etat = "degage" | "dessus" | "bord" | "dans" | "sous";

/** « 2 190 m », thousands and unit with non-breaking spaces; altitudes to the nearest 100 m but a place's own. */
const n = (x: number) => x.toLocaleString("fr-FR").replace(/\s/g, "\u202f");
const m = (x: number) => `${n(x)}\u00a0m`;
const r100 = (n: number) => Math.round(n / 100) * 100;

/** Where a place at `altitude` stands for one step, with its words; null when the step says nothing of the layer. */
export function etat(h: ForecastHour, altitude: number): { etat: Etat; texte: string } | null {
  if (h.nuages_base_m === undefined || h.nuages_pct == null) return null; // not a step of AROME
  const base = h.nuages_base_m;
  const top = h.nuages_sommet_m != null && h.nuages_sommet_m <= HIGH_M ? h.nuages_sommet_m : null;
  if (h.nuages_pct < CLEAR_PCT) return { etat: "degage", texte: "dégagé" };
  // A veil of cirrus: the view stays open, the sunrise less so.
  if (base != null && base > HIGH_M) return { etat: "degage", texte: "dégagé sous des nuages élevés" };
  if (base == null) return null; // cloudy, yet no layer over the cell: nothing to say of it
  // A layer thinner than the rounding (base and top the same hundred) is said at one height, never « entre 1 900 et 1 900 m ».
  const span = top != null && r100(base) === r100(top) ? `vers ${m(r100(top))}` : top != null ? `entre ${n(r100(base))} et ${m(r100(top))}` : null;
  if (top != null && top <= altitude - EDGE_M) {
    return { etat: "dessus", texte: `au-dessus de la mer de nuages (nuages ${span})` };
  }
  if (top != null && top < altitude) return { etat: "bord", texte: `au bord de la mer de nuages (nuages jusqu'à ${m(r100(top))})` };
  if (base <= altitude) {
    return { etat: "dans", texte: span ? `dans les nuages (${span})` : `dans les nuages (à partir de ${m(r100(base))})` };
  }
  return { etat: "sous", texte: `sous les nuages (à partir de ${m(r100(base))})` };
}

export interface Morning {
  libelle: "ce matin" | "demain matin";
  jour: string;
  de: number[];
}

/**
 * The morning told now: this morning before noon (only what is left of it), else tomorrow's. With `jour`, the morning of
 * that day if it is today's (still to come) or tomorrow's; none for another day, the cloud sea being told of these only.
 */
export function morning(now: Date, jour?: string): Morning | null {
  const h = localHour(now);
  const today = localDate(now);
  const tomorrow = localDate(new Date(now.getTime() + 24 * HOUR));
  const day = jour ?? (h < 12 ? today : tomorrow);
  if (day === tomorrow) return { libelle: "demain matin", jour: tomorrow, de: [6, 9] };
  if (day !== today || h >= 12) return null;
  return { libelle: "ce matin", jour: today, de: h < 9 ? [6, 9] : [9] };
}

/** The forecast steps the morning needs (their UTC starts), to ask AROME for them. */
export function morningStarts(now: Date, jour?: string): Date[] {
  const mo = morning(now, jour);
  if (!mo) return [];
  const midnight = Date.parse(`${mo.jour}T00:00:00+04:00`);
  return mo.de.map((h) => new Date(midnight + h * HOUR));
}

export interface Fenetre {
  de: number;
  a: number;
  etat: Etat;
  texte: string;
}

export interface MerDeNuages {
  titre: string;
  /** « De 6 h à 9 h, … ; de 9 h à 12 h, …. », for a card under the place's name. */
  ligne: string;
  /** The same with the place and its altitude in front, for a list or an answer. */
  resume: string;
  fenetres: Fenetre[];
  prevision: string;
  mise_en_garde: string;
}

const span = (de: number, a: number) => `de ${de} h à ${a} h`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The cloud sea of `place`'s morning from its forecast, or null below the Hauts or without AROME's layer. `nom`: the name
 * said (the place's own by default); `precision`: words before the altitude, « Pas de Bellecombe (volcan, 2 334 m) »;
 * `jour`: the day asked (morning()).
 */
export function merDeNuages(f: Forecast, place: Place, now: Date, o: { nom?: string; precision?: string; jour?: string } = {}): MerDeNuages | null {
  const { nom = place.nom, precision, jour } = o;
  const altitude = place.altitude_m;
  if (altitude == null || altitude < HAUTS_MIN_M) return null;
  const mo = morning(now, jour);
  if (!mo) return null;
  const fenetres: Fenetre[] = [];
  for (const de of mo.de) {
    const h = f.hours.find((x) => localDate(x.time) === mo.jour && localHour(x.time) === de);
    const e = h && etat(h, altitude);
    if (!e) return null; // half a morning would mislead: none
    fenetres.push({ de, a: de + 3, ...e });
  }
  // The same state twice is one window: « de 6 h à 12 h, … ».
  const parts = fenetres.length === 2 && fenetres[0].texte === fenetres[1].texte
    ? [`${span(fenetres[0].de, fenetres[1].a)}, ${fenetres[0].texte}`]
    : fenetres.map((w) => `${span(w.de, w.a)}, ${w.texte}`);
  // Only into the clouds: a summit under them often keeps its view over the cloud sea and the cirques.
  const closes = fenetres.length === 2 && ["degage", "dessus", "bord"].includes(fenetres[0].etat) && fenetres[1].etat === "dans";
  const tail = `${parts.join("\u00a0; ")}.${closes ? ` ${CLOSING}` : ""}`;
  return {
    titre: `Mer de nuages ${mo.libelle}`,
    ligne: cap(tail),
    resume: `${nom} (${precision ? `${precision}, ` : ""}${m(altitude)}), ${mo.libelle} : ${tail}`,
    fenetres,
    prevision: LABEL,
    mise_en_garde: CAVEAT,
  };
}

/**
 * The window under way said less firmly when a station near the place measures the air near saturation now (a
 * reading under an hour old): the model's open sky is then not stated as a fact. Tomorrow's mornings are left as they are.
 */
export function softened(mn: MerDeNuages, now: Date, station: { nom: string; humidite: number; mesure: Date } | undefined): MerDeNuages {
  if (!station || station.humidite < 95 || now.getTime() - station.mesure.getTime() > HOUR) return mn;
  const h = localHour(now);
  const w = mn.fenetres.find((x) => h >= x.de && h < x.a);
  if (!w || !["degage", "dessus", "bord"].includes(w.etat)) return mn;
  const hm = new Date(station.mesure.getTime() + REUNION_MS).toISOString().slice(11, 16);
  const said = `la station de ${station.nom} mesure ${station.humidite} % d'humidité à ${hm}`;
  const texte = w.etat === "degage"
    ? `dégagé selon le modèle, mais ${said} : nuages ou brouillard possibles`
    : `au-dessus de la mer de nuages selon le modèle, mais ${said} : vous pourriez être dans les nuages`;
  const swap = (s: string) => s.replace(w.texte, texte);
  return { ...mn, ligne: swap(mn.ligne), resume: swap(mn.resume), fenetres: mn.fenetres.map((x) => (x === w ? { ...x, texte } : x)) };
}

// ---------------------------------------------------------------- the sky of the night

/**
 * The night told now: tonight from 18 h to 6 h (only what is left of it), or the night under way before 6 h. With
 * `jour`, the night that starts that evening if it is today's or tomorrow's; none for another day (AROME's 48 hours).
 */
export interface Night {
  libelle: "ce soir et cette nuit" | "cette nuit" | "demain soir et la nuit suivante";
  /** UTC starts of the night's steps still to come. */
  starts: Date[];
}

const NIGHT_HOURS = [18, 21, 24, 27];

export function night(now: Date, jour?: string): Night | null {
  const h = localHour(now);
  const today = localDate(now);
  const yesterday = localDate(new Date(now.getTime() - 24 * HOUR));
  const tomorrow = localDate(new Date(now.getTime() + 24 * HOUR));
  const evening = jour ?? (h < 6 ? yesterday : today);
  if (![yesterday, today, tomorrow].includes(evening) || (evening === yesterday && h >= 6)) return null;
  const libelle = evening === tomorrow ? "demain soir et la nuit suivante" : evening === yesterday || h >= 21 ? "cette nuit" : "ce soir et cette nuit";
  const midnight = Date.parse(`${evening}T00:00:00+04:00`);
  const starts = NIGHT_HOURS.map((x) => new Date(midnight + x * HOUR)).filter((t) => t.getTime() + 3 * HOUR > now.getTime());
  return starts.length ? { libelle, starts } : null;
}

/** The forecast steps the night needs (their UTC starts), to ask AROME for them. */
export const nightStarts = (now: Date, jour?: string): Date[] => night(now, jour)?.starts ?? [];

/** The sky of one night step at a place: over the Hauts where it stands against the clouds, below by the cloud cover. */
export function nightSky(h: ForecastHour, altitude: number): { etat: Etat | "pluie" | "nuageux" | "couvert"; texte: string } | null {
  if (h.nuages_base_m === undefined || h.nuages_pct == null) return null; // not a step of AROME
  if (h.pluie_mm != null && h.pluie_mm >= 0.3) return { etat: "pluie", texte: "pluie prévue" };
  const e = altitude >= HAUTS_MIN_M ? etat(h, altitude) : null;
  if (e) return e;
  if (h.nuages_pct < CLEAR_PCT) return { etat: "degage", texte: "dégagé" };
  return h.nuages_pct < 70 ? { etat: "nuageux", texte: "partiellement nuageux" } : { etat: "couvert", texte: "couvert" };
}

export interface CielDeNuit {
  titre: string;
  /** « De 18 h à minuit, … ; de minuit à 6 h, …. », for a card under the place's name. */
  ligne: string;
  /** The same with the place and its altitude in front, for a list or an answer. */
  resume: string;
  fenetres: { de: number; a: number; etat: string; texte: string }[];
  prevision: string;
  mise_en_garde: string;
}

const hourName = (x: number) => (x % 24 === 0 ? "minuit" : `${x % 24} h`);

/**
 * The sky of `place`'s night from its forecast, step by step, the same state on steps in a row said once; null without
 * AROME for each step left (half a night would mislead).
 */
export function cielDeNuit(f: Forecast, place: Place, now: Date, o: { nom?: string; jour?: string } = {}): CielDeNuit | null {
  const nt = night(now, o.jour);
  if (!nt) return null;
  const altitude = place.altitude_m ?? 0;
  const fenetres: CielDeNuit["fenetres"] = [];
  for (const t of nt.starts) {
    const h = f.hours.find((x) => x.time.getTime() === t.getTime());
    const s = h && nightSky(h, altitude);
    if (!s) return null;
    const de = localHour(t);
    const last = fenetres[fenetres.length - 1];
    if (last && last.texte === s.texte) last.a = de + 3;
    else fenetres.push({ de, a: de + 3, ...s });
  }
  const tail = `${fenetres.map((w) => `de ${hourName(w.de)} à ${hourName(w.a)}, ${w.texte}`).join(" ; ")}.`;
  return {
    titre: `Ciel ${nt.libelle}`,
    ligne: cap(tail),
    resume: `${o.nom ?? place.nom} (${m(altitude)}), ${nt.libelle} : ${tail}`,
    fenetres,
    prevision: LABEL,
    mise_en_garde: CAVEAT,
  };
}
