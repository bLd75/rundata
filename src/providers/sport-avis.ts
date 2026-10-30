/**
 * Matches called off. The federations' results pages keep a cancelled match « à venir » until it is played again:
 * cancellations and postponements go through the leagues' own notices and the news. Two readings, strict on purpose
 * (a false « annulé » keeps people at home for nothing):
 *
 * - The notices of the Ligue réunionnaise de volley-ball, as its site lrvb.re shows them (the league's latest posts,
 *   on its home page; its calendar is not updated for this). A sentence that says « annulé » or « reporté » with an
 *   explicit date (« ce samedi 24 octobre 2026 ») concerns the matches of that day: all of them when it says « toutes
 *   les rencontres » or names no team, else the teams or pools it names. Beach volley or youth alone: not the
 *   championships read here. What a sentence says is « maintenu » is left out.
 * - The news already gathered for `actualites` (never fetched for this): a sentence that says a match is called off,
 *   names the sport and a day. A sentence that only says « the leagues postpone the competitions on Saturday » marks
 *   nothing, but is passed on: check with the club.
 */
import type { Cache, Cached } from "../cache.js";
import { getText } from "../http.js";
import { clubOf, clubsNamed, type ClubSport } from "../sport/clubs.js";
import type { Info } from "./actualites.js";
import { monthOf } from "./agenda-mots.js";
import { textOf } from "./avis-eau.js";
import { SOURCES } from "./sport.js";

export const SOURCE = SOURCES.lrvb;

export interface Avis {
  statut: "annulé" | "reporté";
  /** Local days, « 2026-10-24 ». */
  jours: string[];
  /** Every match of those days; else only those of `equipes` or `poules`. */
  tous: boolean;
  /** Club acronyms or names, as the table of clubs writes them. */
  equipes: string[];
  /** FFVB pool codes (« R1M », « 2MA »). */
  poules: string[];
  /** The sport, for the news (a league's notice is about its own sport). */
  sport?: ClubSport;
  /** On the sand (« beach », « sable », « outdoor »): of the beach volley's events, never of a hall's matches. */
  beach?: true;
  /** « Ces rencontres seront reportées à une date ultérieure ». */
  a_rejouer?: boolean;
  /** The new day, when the notice gives it. */
  reporte_au?: string;
  source: string;
  lien: string;
  /** The sentence, short. */
  extrait: string;
  /** ISO, when known. */
  publie?: string;
}

/** A news item that says competitions are called off on a day without saying which: check with the club. */
export interface Alerte {
  jour: string;
  titre: string;
  media: string;
  lien: string;
  publie: string;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
export const localDay = (iso: string | Date) => new Date(new Date(iso).getTime() + 4 * 3600_000).toISOString().slice(0, 10);

const CANCELLED = /(?<![a-z])annul(?:e|ee|es|ees|er|ation|ations)(?![a-z])/;
const POSTPONED = /(?<![a-z])report(?:e|ee|es|ees|er|s)?(?![a-z])/;
const KEPT = /(?<![a-z])(?:maintenu|maintenue|maintenus|maintenues|maintien)(?![a-z])/;
const LATER = /(?:seront|sont|seras?)\s+report\w*\s+a\s+une\s+date\s+ulterieure|nouvelles dates/;
const ALL = /(?<![a-z])(?:tou(?:te)?s\s+(?:les|nos)|l ensemble des|les|des)\s+(?:rencontres|matchs?|competitions|championnats|journees?)(?![a-z])/;
const BEACH = /beach|sable|outdoor/;
const INDOOR = /indoor|salle|gymnase|championnats?\s+senior|seniors?|regionale|r1|r2/;
const YOUTH = /jeunes|(?<![a-z0-9])[mu]\s?1[13578](?![0-9])|minimes|cadets?|benjamins?|poussins?/;
const POOL = /\b(R1M|R1F|R2F|R2M|2MA|2MB)\b/g;
const SPORTS: [ClubSport, RegExp][] = [["volley", /volley/], ["handball", /(?<![a-z])hand(?:ball| ball)?(?![a-z])/]];

// « samedi 24 octobre 2026 », « 24/10/26 », « dimanche 25 », « les 24 et 25 octobre ». Not « 15:00 » nor « 20h ».
const DATE = /(?<![\d/a-z])(?:(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+)?(\d{1,2})(?:er)?(?![\d:a-z])(?:\s+([a-z]+)(?:\s+(20\d\d))?|\/(\d{1,2})(?:\/(\d{2}|\d{4}))?)?/g;
const WEEKDAY_ALONE = /(?<![a-z])(?:ce|cette|de|du|le|ce prochain)\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?!\s+\d)(?!\s+(?:dernier|passe))/g;
const RELATIVE: [RegExp, number][] = [[/(?<![a-z])aujourd ?hui|ce soir(?![a-z])/, 0], [/(?<![a-z])demain(?![a-z])/, 1]];

/** A day in a year near `ref` (the same year, or the next one for a date long gone). */
function dayOf(y: number | undefined, m: number, d: number, ref: string): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  let year = y ?? Number(ref.slice(0, 4));
  if (year < 100) year += 2000;
  let iso = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (!y && iso < addDays(ref, -180)) iso = `${year + 1}${iso.slice(4)}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).getUTCDate() !== d ? undefined : iso;
}

/**
 * The days a sentence names. Explicit dates always; with `ref` (the local day it was published), also « ce samedi »,
 * « demain » (from that day on).
 */
export function daysIn(sentence: string, ref: string, relative: boolean): string[] {
  const t = fold(sentence);
  const found: { d: number; m?: number; y?: number; wd?: number }[] = [];
  for (const m of t.matchAll(DATE)) {
    const month = m[3] ? monthOf(m[3]) : m[5] ? Number(m[5]) : undefined;
    if (m[3] && !month && !m[1]) continue; // « 2 semaines »
    found.push({ d: Number(m[2]), m: month, y: m[4] ? Number(m[4]) : m[6] ? Number(m[6]) : undefined, wd: m[1] ? WEEKDAYS.indexOf(m[1]) : undefined });
  }
  // A day without its month takes the next one named (« les 24 et 25 octobre »).
  for (let i = found.length - 1, next: { m?: number; y?: number } = {}; i >= 0; i--) {
    if (found[i].m) next = found[i];
    else if (next.m) Object.assign(found[i], { m: next.m, y: found[i].y ?? next.y });
  }
  const out = new Set<string>();
  for (const f of found) {
    if (f.m) {
      const day = dayOf(f.y, f.m, f.d, ref);
      if (day) out.add(day);
    } else if (f.wd != null) {
      // « dimanche 25 » alone: the day of that number and weekday near the reference.
      for (let k = -7; k <= 28; k++) {
        const day = addDays(ref, k);
        if (Number(day.slice(8)) === f.d && weekday(day) === f.wd) {
          out.add(day);
          break;
        }
      }
    }
  }
  if (relative) {
    for (const m of t.matchAll(WEEKDAY_ALONE)) {
      const wd = WEEKDAYS.indexOf(m[1]);
      out.add(addDays(ref, (wd - weekday(ref) + 7) % 7));
    }
    if (/(?<![a-z])ce week ?-?end(?![a-z])/.test(t)) {
      const sat = addDays(ref, (6 - weekday(ref) + 7) % 7);
      if (weekday(ref) === 0) out.add(ref);
      else out.add(sat).add(addDays(sat, 1));
    }
    for (const [re, n] of RELATIVE) if (re.test(t)) out.add(addDays(ref, n));
  }
  return [...out].sort();
}

// Sentences: the league's posts lose their line breaks (« …2026En raison… », « …annulées.Ces rencontres… »).
const SENTENCES = /(?<=[.!?…])\s*|\n+|\s*\|\s*|[✅📢🙏❌⚠️🔴]+/u;
const sentences = (text: string) =>
  text.replace(/(\d)(?=\p{Lu}\p{Ll})/gu, "$1. ").split(SENTENCES).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 3);
const short = (s: string) => (s.length > 220 ? `${s.slice(0, 219).replace(/\s+\S*$/, "")}…` : s);

/** What one text says is called off: one entry per sentence that says it of a day. */
export function avisIn(
  text: string,
  meta: { source: string; lien: string; publie?: string; ref: string; relative: boolean; sport?: ClubSport },
): Avis[] {
  const all = sentences(text);
  const later = LATER.test(fold(text));
  const out: Avis[] = [];
  for (const raw of all) {
    // What is « maintenu » is not called off: only the part before it.
    const f0 = fold(raw);
    const kept = KEPT.exec(f0);
    const s = kept ? raw.slice(0, kept.index) : raw;
    const f = fold(s);
    const statut = CANCELLED.test(f) ? "annulé" : POSTPONED.test(f) ? "reporté" : undefined;
    if (!statut) continue;
    // « reporté au dimanche 1er novembre »: the new day is not a day called off.
    const to = /report\w*\s+(?:au|a|le)\s+(?=\D{0,12}\d)/.exec(f);
    const jours = daysIn(to ? s.slice(0, to.index) : s, meta.ref, meta.relative);
    if (!jours.length) continue;
    const reporte_au = to ? daysIn(s.slice(to.index), meta.ref, meta.relative)[0] : undefined;
    const beach = BEACH.test(f) && !INDOOR.test(f);
    if (YOUTH.test(f) && !/senior/.test(f) && !beach) continue;
    const sport = meta.sport ?? SPORTS.find(([, re]) => re.test(f))?.[0];
    const equipes = sport ? [...new Set(clubsIn(s, sport))] : [];
    const poules = [...new Set([...s.matchAll(POOL)].map((m) => m[1]))];
    out.push({
      statut,
      jours,
      tous: !equipes.length && !poules.length && ALL.test(f),
      equipes,
      poules,
      sport,
      ...(beach && { beach: true as const }),
      a_rejouer: statut === "annulé" && later ? true : undefined,
      reporte_au,
      source: meta.source,
      lien: meta.lien,
      extrait: short(s.replace(/^[^\p{L}\d«"]+/u, "")),
      publie: meta.publie,
    });
  }
  return out;
}

/** The clubs a sentence names: acronyms in capitals as the federation writes them (« TGV », « VBSP »). */
function clubsIn(sentence: string, sport: ClubSport): string[] {
  const out: string[] = [];
  for (const m of sentence.matchAll(/\b[A-Z][A-Z0-9]{1,5}(?:\s[A-Z0-9]{2,4})*\b/g)) {
    // « TGV RCO » written without a dash: each word.
    const whole = clubsNamed(m[0], [sport]);
    const found = whole.length ? whole : m[0].split(" ").flatMap((w) => clubsNamed(w, [sport]));
    for (const c of found) out.push(c.club.sigle ?? c.club.nom);
  }
  return out;
}

// ---------------------------------------------------------------- the league's notices

const AGE: [RegExp, number][] = [[/minute/, 60_000], [/heure/, 3600_000], [/jour/, 86_400_000], [/semaine/, 7 * 86_400_000], [/mois/, 30 * 86_400_000]];

/** « 19 heures ago » → milliseconds, roughly. */
function ageOf(s: string): number | undefined {
  const m = /(\d+)\s*([a-z]+)/.exec(fold(s));
  const unit = m && AGE.find(([re]) => re.test(m[2]));
  return unit ? Number(m[1]) * unit[1] : undefined;
}

/**
 * The posts of the league that lrvb.re shows on its home page (its Facebook page, relayed by the site): text, link,
 * age. Only the part of the page that holds them is read.
 */
export function parseLrvb(html: string, now: Date): Avis[] {
  const start = html.indexOf('class="wpsr-fb-feed-item ');
  if (start < 0) return [];
  const end = html.indexOf("wpsr-fb-feed-footer", start);
  const part = html.slice(start, end > 0 ? end : start + 400_000);
  const out: Avis[] = [];
  for (const item of part.split('class="wpsr-fb-feed-item ').slice(1, 31)) {
    const body = /<p class="wpsr-fb-feed-content[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(item)?.[1];
    if (!body) continue;
    const text = textOf(body.replace(/<br\s*\/?>/gi, "\n"));
    if (!CANCELLED.test(fold(text)) && !POSTPONED.test(fold(text))) continue;
    const link = /href="(https:\/\/www\.facebook\.com\/[^"]+\/(?:posts|videos)\/[^"]+)"/.exec(item)?.[1];
    const age = ageOf(/wpsr-fb-feed-time">([^<]*)</.exec(item)?.[1] ?? "");
    const publie = age != null ? new Date(now.getTime() - age).toISOString() : undefined;
    // The page's « 19 heures » are as of when the site last built it: an explicit date only.
    out.push(...avisIn(text, { source: "la Ligue réunionnaise de volley-ball (LRVB)", lien: link ?? SOURCE.url, publie, ref: localDay(publie ?? now), relative: false, sport: "volley" }));
  }
  return out;
}

export async function avisLigue(cache: Cache, now = new Date()): Promise<Cached<Avis[]>> {
  return cache.get("sport:volley:avis", 30 * 60, async () => parseLrvb(await getText(SOURCE.id, SOURCE.url, 12_000), now));
}

// ---------------------------------------------------------------- the news

const NEWS_HOURS = 72;
const SPORTISH = /(?<![a-z])(?:sport\w*|match\w*|rencontres?|competitions?|championnats?|ligues?|journee)(?![a-z])/;

/** What the news of the last three days says is called off, and what it says vaguely (to check with the club). */
export function avisPresse(infos: Info[] | undefined, now: Date): { avis: Avis[]; alertes: Alerte[] } {
  const avis: Avis[] = [];
  const alertes: Alerte[] = [];
  if (!infos?.length) return { avis, alertes };
  const since = new Date(now.getTime() - NEWS_HOURS * 3600_000).toISOString();
  for (const i of infos) {
    if (i.publie < since) continue;
    const texts = [...new Set([i.titre, i.resume ?? "", ...(i.extraits ?? []).map((e) => e.texte)])].filter(Boolean);
    const all = fold(texts.join(" "));
    if (!(CANCELLED.test(all) || POSTPONED.test(all)) || !(i.sujets.includes("sport") || SPORTISH.test(all))) continue;
    const ref = localDay(i.publie);
    const found = texts.flatMap((t) => avisIn(t, { source: i.media, lien: i.lien, publie: i.publie, ref, relative: true }));
    for (const a of found) {
      // A sentence that names the sport, a day and the verb says it; a vaguer one is a warning.
      if (a.sport && (a.equipes.length || a.tous)) avis.push(a);
      else if (SPORTISH.test(fold(a.extrait)) || i.sujets.includes("sport")) {
        for (const jour of a.jours) alertes.push({ jour, titre: i.titre, media: i.media, lien: i.lien, publie: i.publie });
      }
    }
  }
  return { avis, alertes };
}

/** The notice that calls off this match, if one does. */
export function avisOf(list: Avis[], sport: ClubSport, m: { date: string; domicile: string; exterieur: string; poule?: string; score?: string }): Avis | undefined {
  if (m.score) return undefined;
  const day = m.date.slice(0, 10);
  const teams = [m.domicile, m.exterieur].map((t) => clubOf(sport, t)).map((c) => c && (c.sigle ?? c.nom));
  return list.find((a) => {
    if (a.beach || (a.sport ?? sport) !== sport || !a.jours.includes(day)) return false;
    if (a.tous) return true;
    if (a.poules.length && (!m.poule || !a.poules.includes(m.poule))) return false;
    // One club named: its matches; several: the matches between two of them.
    if (a.equipes.length === 1) return teams.includes(a.equipes[0]);
    if (a.equipes.length) return teams.every((t) => !!t && a.equipes.includes(t));
    return a.poules.length > 0;
  });
}

/** The notice of the league that calls off a beach volley event of that day, when one does. */
export function avisBeach(list: Avis[], e: { debut: string; fin: string }): Avis | undefined {
  return list.find((a) => a.beach && (a.sport ?? "volley") === "volley" && a.jours.some((d) => e.debut <= d && d <= e.fin));
}
