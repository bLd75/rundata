/**
 * The days the bins are collected in the Territoire de l'Ouest, street by street (src/vie/collecte.json, built by
 * scripts/build-collecte.py from the TCO's calendars). Each street has a calendar; each calendar the days of each
 * collection. The rhythm said is read from the coming days themselves, so a holiday or a day made up for it, as the
 * calendar gives them, comes before the rule: nothing is assumed that the calendar does not show.
 */
import { normalize } from "../places/resolve.js";
import type { SourceInfo } from "../types.js";
import data from "./collecte.json" with { type: "json" };

const DAY_MS = 86400_000;

export const SOURCE: SourceInfo = {
  id: "tco_collecte",
  nom: "Calendriers de collectes du Territoire de l'Ouest",
  organisme: "Territoire de l'Ouest (TCO)",
  licence: "Licence Ouverte (Etalab)",
  attribution: "Territoire de l'Ouest (TCO)",
  url: "https://data.tco.re/explore/dataset/calendriers-de-collectes-du-territoire-de-louest-gru/",
};

export type Kind = "OM" | "CS" | "DV" | "EN";
interface Calendar {
  code: string;
  pdf: string;
  OM?: number[];
  CS?: number[];
  DV?: number[];
  EN?: number[];
  /** The holidays the calendar marks, days without collection unless made up on another day. */
  F?: number[];
}

export const CALENDARS = data.calendriers as Calendar[];
export const YEAR = data.annee;
export const UPDATED = data.mis_a_jour;
export const SOURCE_URL = data.source;
export interface Street {
  nom: string;
  commune: string;
  /** Its calendar in CALENDARS; -1 for a street the TCO lists without one (code « NC »). */
  calendrier: number;
}
export const STREETS: Street[] = (data.voies as [string, string, number][]).map(([nom, commune, calendrier]) => ({ nom, commune, calendrier }));
export const COMMUNES = ["Saint-Paul", "La Possession", "Saint-Leu", "Le Port", "Les Trois-Bassins"].filter((c) => STREETS.some((s) => s.commune === c));
/** « saint-paul », « trois-bassins »: the page of a commune. */
export const communeSlug = (c: string) => normalize(c.replace(/^Les /, "")).replace(/ /g, "-");

// Marketing's words, said by the tool and the pages.
export const NOT_FOUND = "Rue non trouvée dans les calendriers du TCO. Vérifiez l'orthographe, ou essayez le nom du quartier.";
// A street the TCO lists without a calendar: nothing is inferred, its contact page is the link of the arrow.
export const NO_CALENDAR = "le TCO ne publie pas de calendrier de collecte pour cette voie, et nous ne savons pas si elle est collectée au porte-à-porte. Renseignez-vous auprès du TCO →";
// The same above the list of such streets on a page (marketing).
export const NO_CALENDAR_LIST = "Le TCO ne publie pas de calendrier de collecte pour ces voies, et nous ne savons pas si elles sont collectées au porte-à-porte. Renseignez-vous auprès du TCO →";
export const TCO_CONTACT = "https://www.tco.re/contact";
/** Past the calendars' year, nothing of it is applied to the next. */
export const notYet = () => `Les calendriers ${YEAR + 1} du TCO ne sont pas encore publiés : nous ne pouvons pas encore donner les jours de collecte.`;
const YEAR_DAYS = (Date.UTC(YEAR + 1, 0, 1) - Date.UTC(YEAR, 0, 1)) / DAY_MS;
/** Whether `today` is past the calendars' year. */
export const pastYear = (today: number) => today > YEAR_DAYS;
/** Whether the coming eight weeks, read for the rhythm, reach past the calendars' year. */
export const nearYearEnd = (today: number) => today + 56 > YEAR_DAYS;
export const honesty = () =>
  `Seulement les 5 communes de l'Ouest (TCO) pour l'instant. Calendriers ${YEAR} publiés par le TCO (data.tco.re), mis à jour le ${UPDATED.split("-").reverse().join("/")}. En cas d'alerte cyclonique, la collecte peut être suspendue : suivez les annonces du TCO.`;

// In the order marketing says them.
const KINDS: [Kind, string][] = [["OM", "ordures ménagères"], ["CS", "tri"], ["DV", "déchets verts"], ["EN", "encombrants"]];
const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const NTH = ["1er", "2e", "3e", "4e", "5e"];

/** Day numbers of the calendar's year, 1 for 1 January, as the JSON keeps them. */
const dateOf = (n: number) => new Date(Date.UTC(YEAR, 0, n));
const dayOf = (d: Date) => Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(YEAR, 0, 1)) / DAY_MS) + 1;
/** Today at La Réunion, as a day number of the calendar's year. */
export const todayOf = (now: Date) => dayOf(new Date(now.getTime() + 4 * 3600_000));
const wd = (n: number) => dateOf(n).getUTCDay();
/** « 4/11 ». */
const dm = (n: number) => `${dateOf(n).getUTCDate()}/${dateOf(n).getUTCMonth() + 1}`;
/** « jeudi 12/11 ». */
const dayFr = (n: number) => `${WEEKDAYS[wd(n)]} ${dm(n)}`;
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} et ${xs[xs.length - 1]}` : xs[0] ?? "");

/** The weekdays a collection keeps week after week in the coming eight weeks (a holiday's shift aside). */
function weekly(days: number[], today: number): number[] | undefined {
  const soon = days.filter((n) => n >= today && n < today + 56);
  if (soon.length < 7) return undefined;
  const weeks = (w: number) => new Set(soon.filter((n) => wd(n) === w).map((n) => Math.floor((n - today) / 7))).size;
  const kept = [0, 1, 2, 3, 4, 5, 6].filter((w) => weeks(w) >= 6);
  return kept.length && soon.length <= kept.length * 8 + 1 ? kept.sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)) : undefined;
}

/**
 * The weekday a collection keeps every other week in the coming eight weeks: the days 12 to 16 apart, all but one on
 * that weekday (a holiday moves one by a day or two).
 */
function fortnightly(days: number[], today: number): number | undefined {
  const soon = days.filter((n) => n >= today && n < today + 56);
  if (soon.length < 3 || !soon.slice(1).every((n, i) => Math.abs(n - soon[i] - 14) <= 2)) return undefined;
  const w = wd(soon.find((n, i) => wd(n) === wd(soon[(i + 1) % soon.length])) ?? soon[0]);
  return soon.filter((n) => wd(n) !== w).length <= 1 ? w : undefined;
}

/** What a collection's coming days say: its rhythm when it keeps one, else its next days. Undefined without any. */
export function rhythm(days: number[] | undefined, today: number): string | undefined {
  const next = (days ?? []).filter((n) => n >= today);
  if (!next.length) return undefined;
  const w = weekly(next, today);
  if (w) return list(w.map((x) => `le ${WEEKDAYS[x]}`));
  // Every other week, the same weekday: said with the next one, for the week it falls in.
  const f = fortnightly(next, today);
  const first = next[0] === today ? "aujourd'hui" : undefined;
  if (f !== undefined) return `le ${WEEKDAYS[f]}, une semaine sur deux (prochain : ${first ?? (wd(next[0]) === f ? dm(next[0]) : dayFr(next[0]))})`;
  // The same weekday of the month, four months on.
  const months = next.filter((n) => n < today + 122);
  const nth = (n: number) => Math.floor((dateOf(n).getUTCDate() - 1) / 7);
  if (months.length >= 3 && months.every((n) => wd(n) === wd(months[0]) && nth(n) === nth(months[0])) && new Set(months.map((n) => dateOf(n).getUTCMonth())).size === months.length) {
    return `le ${NTH[nth(months[0])]} ${WEEKDAYS[wd(months[0])]} du mois (prochain : ${first ?? dm(months[0])})`;
  }
  const shown = next.slice(0, 3);
  return shown.every((n) => wd(n) === wd(shown[0]))
    ? `les ${WEEKDAYS[wd(shown[0])]}s ${shown.map(dm).join(", ")}${next.length > 3 ? "…" : ""}`
    : `${list(shown.map((n) => `le ${dayFr(n)}`))}${next.length > 3 ? "…" : ""}`;
}

/**
 * « ordures ménagères le lundi et le jeudi ; tri le mercredi, une semaine sur deux (prochain : 4/11) ; … ». Past the
 * calendars' year, undefined: nothing of a year is said of the next (notYet()).
 */
export function rhythmOf(c: Calendar, today: number): string | undefined {
  if (pastYear(today)) return undefined;
  return KINDS.flatMap(([k, name]) => {
    const r = rhythm(c[k], today);
    return r ? [`${name} ${r}`] : [];
  }).join(" ; ");
}

/**
 * The holidays of the next two weeks that fall on a usual day of collection, and the day the calendar makes it up
 * when it does (a day of the same collection within the week, outside its usual weekdays).
 */
export function holidays(c: Calendar, today: number): { jour: number; reportee?: number }[] {
  return (c.F ?? [])
    .filter((h) => h >= today && h < today + 14)
    .flatMap((h) => {
      let hit = false;
      let made: number | undefined;
      for (const [k] of KINDS) {
        const days = c[k] ?? [];
        if (days.includes(h)) continue;
        // Its usual weekdays around the holiday: every week, or every other week when the holiday falls in its week.
        const w = weekly(days, h - 28);
        const f = w ? undefined : fortnightly(days, h - 28);
        const usual = w ?? (f !== undefined && (days.includes(h - 14) || days.includes(h + 14)) ? [f] : []);
        if (!usual.includes(wd(h))) continue;
        hit = true;
        made ??= days.find((n) => n > h && n <= h + 6 && !usual.includes(wd(n)));
      }
      return hit ? [{ jour: h, reportee: made }] : [];
    });
}

/** Marketing's holiday sentence, or its fallback when the calendar shows no day made up. */
export function holidayLine(x: { jour: number; reportee?: number }): string {
  return x.reportee
    ? `Jour férié le ${dm(x.jour)} : collecte reportée au ${dayFr(x.reportee)}, selon le calendrier du TCO.`
    : "Jour férié : vérifiez le calendrier du TCO (PDF) →";
}

/** « Rue Labourdonnais, Saint-Paul : ordures ménagères le lundi et le jeudi ; … ». */
export function streetLine(s: Street, today: number): string {
  const cal = CALENDARS[s.calendrier];
  const head = `${streetName(s)}, ${s.commune} : `;
  if (!cal) return head + NO_CALENDAR;
  const r = rhythmOf(cal, today);
  if (r === undefined) return notYet();
  return `${head}${r}.${nearYearEnd(today) ? ` ${notYet()}` : ""}`;
}

/** Its name without the commune the TCO adds in brackets. */
export const streetName = (s: Street) => s.nom.replace(/\s*\([^)]*\)$/, "");

// « r. » for « rue », and the other short forms people type.
const SHORT: [RegExp, string][] = [[/\br\b\.?/g, "rue"], [/\bch\b\.?/g, "chemin"], [/\bav\b\.?/g, "avenue"], [/\bbd\b\.?/g, "boulevard"], [/\bimp\b\.?/g, "impasse"], [/\bst\b/g, "saint"], [/\bste\b/g, "sainte"]];
const key = (s: string) => SHORT.reduce((t, [re, w]) => t.replace(re, w), normalize(s.replace(/\([^)]*\)/g, " ")));

/** The streets whose name holds every word asked, in a commune when one is given; the exact name first. */
export function findStreets(asked: string, commune?: string): Street[] {
  const q = key(asked);
  if (q.length < 3) return [];
  const words = q.split(" ").filter(Boolean);
  const pool = commune ? STREETS.filter((s) => s.commune === commune) : STREETS;
  const hits = pool.filter((s) => {
    const k = key(s.nom);
    return words.every((w) => k.split(" ").includes(w) || (w.length > 3 && k.includes(w)));
  });
  return hits.sort((x, y) => Number(key(y.nom) === q) - Number(key(x.nom) === q) || x.nom.length - y.nom.length);
}
