/**
 * The route du Littoral as the media and the prefecture announce it: four lanes, switched to one lane each way on the
 * mountain side, closed, closed at night, reopening. Read from the headlines and first sentences the tool actualites
 * already gathers (0 subrequest), each with who said it and when the article was published, never as a measured state:
 * the official state is the Region's, on infotrafic.re, which rundata.re may not reuse. A headline on the new road's
 * building site (NRL) that says nothing of the traffic is left out. The texts are marketing's.
 */
import { normalize } from "../places/resolve.js";
import type { Info } from "../providers/actualites.js";
import { quand } from "./actualites.js";

export const INFOTRAFIC = "https://www.infotrafic.re/";
// The communes at either end of the road: asked about them, its announcement comes too.
export const ENDS = ["Saint-Denis", "La Possession"];
// How far back an announcement is looked for; past RECENT_HOURS it is told as the last one found, not as now.
export const MAX_HOURS = 36;
export const RECENT_HOURS = 6;
// Two announcements by different sources this close that disagree are both given.
const CONTRADICTION_HOURS = 2;

export const A_SAVOIR = "Ce que publient les médias, pas une mesure : l'état officiel, en direct, est sur infotrafic.re.";
// No figure: how far back each feed goes is its own; « titres »: annonceOf reads the headline and its first lines.
export const NONE = "Pas d'annonce récente sur la route du Littoral dans les titres des médias et de la préfecture que nous avons lus. L'état officiel, en direct, est sur infotrafic.re.";
export const DISAGREE = "Les annonces ne disent pas la même chose (la plus récente en premier). Vérifiez sur infotrafic.re.";

export type Etat = "4 voies" | "basculée" | "fermée" | "fermée la nuit" | "réouverture";

export interface Annonce {
  etat: Etat;
  /** « dans les deux sens », when the article says so. */
  deux_sens?: true;
  /** The night closure's hours (« 21:00 », « 05:00 ») and days (« 24/10 »), when the article gives them. */
  horaire?: { de: string; a: string };
  dates?: { du: string; au: string };
  /** The reopening's hour, and on how many lanes, when the article gives them. */
  a?: string;
  voies?: "2×1" | "4";
  media: string;
  prefecture: boolean;
  /** When the article was published (ISO, UTC); `heure`: false when the source gives the day only. */
  publie: string;
  heure: boolean;
  lien: string;
}

/** What a headline needs: its words, who published it, when, and its link. */
export type Item = Pick<Info, "titre" | "resume" | "media" | "lien" | "publie" | "heure">;

export const NAMED = /\b(?:route (?:du )?littoral|nrl|rn ?1 (?:entre )?(?:saint denis|la possession))\b/;
// Asked as a place, « RN1 » alone is the road too; in a headline it is not, the RN1 going on to Saint-Pierre.
const RN1 = /^(?:la )?(?:rn ?1|route nationale 1)$/;

/** Whether the place asked for is the route du Littoral. */
export const asked = (lieu: string) => NAMED.test(normalize(lieu)) || RN1.test(normalize(lieu).trim());
const REOPEN = /\b(?:reouv|rouv|reouvr)\w*/;
const BACK_TO_FOUR = /\bfin (?:du|de) basculement\b|\b(?:retour|repasse|revient|remise?) (?:a|en|sur) (?:4|quatre) voies\b/;
const SWITCHED = /\bbascul\w*|\b2 ?x ?1\b|\b2 fois 1\b|\bdeux fois une voie\b/;
const FOUR = /\b(?:4|quatre) voies\b|\b2 ?x ?2\b/;
const CLOSED = /\bferm(?:e|ee|ees|es|eture|etures)\b|\bcoupees?\b|\binterdite? a la circulation\b/;
const NIGHT = /\b(?:de nuit|la nuit|cette nuit|chaque nuit|nocturnes?|nuits)\b/;
const HOUR = "(\\d{1,2}) ?h ?(\\d{2})?";
const HOURS = new RegExp(`\\b(?:de|entre) ${HOUR} (?:a|et|jusqu a) ${HOUR}`);
const AT = new RegExp(`\\b(?:a|des|vers) ${HOUR}`);
const MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
const DAY = "(?:(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) )?(\\d{1,2})(?:er)?";
const DAYS = new RegExp(`\\bdu ${DAY}(?: (${MONTHS.join("|")}))? au ${DAY} (${MONTHS.join("|")})\\b`);

const hm = (h: string, m?: string) => (Number(h) < 24 && Number(m ?? 0) < 60 ? `${h.padStart(2, "0")}:${m ?? "00"}` : undefined);
const dm = (d: string, month: string) => `${d.padStart(2, "0")}/${String(MONTHS.indexOf(month) + 1).padStart(2, "0")}`;

/** The state a headline announces for the route du Littoral, or undefined when it names it without one. */
export function annonceOf(i: Item, prefecture = false): Annonce | undefined {
  const t = normalize(`${i.titre} ${i.resume ?? ""}`);
  if (!NAMED.test(t)) return undefined;
  const base = { media: prefecture ? "la préfecture" : i.media, prefecture, publie: i.publie, heure: i.heure, lien: i.lien };
  if (REOPEN.test(t)) {
    const at = AT.exec(t.slice(t.search(REOPEN)));
    const a = at ? hm(at[1], at[2]) : undefined;
    const voies = SWITCHED.test(t) ? ("2×1" as const) : FOUR.test(t) ? ("4" as const) : undefined;
    return { etat: "réouverture", ...(a ? { a } : {}), ...(voies ? { voies } : {}), ...base };
  }
  if (BACK_TO_FOUR.test(t)) return { etat: "4 voies", ...base };
  if (CLOSED.test(t) && NIGHT.test(t)) {
    const h = HOURS.exec(t);
    const de = h && hm(h[1], h[2]);
    const a = h && hm(h[3], h[4]);
    const d = DAYS.exec(t);
    return {
      etat: "fermée la nuit",
      ...(de && a ? { horaire: { de, a } } : {}),
      ...(d ? { dates: { du: dm(d[1], d[2] ?? d[4]), au: dm(d[3], d[4]) } } : {}),
      ...base,
    };
  }
  if (SWITCHED.test(t)) return { etat: "basculée", ...base };
  if (CLOSED.test(t)) return { etat: "fermée", ...(/\bdans les deux sens\b/.test(t) ? { deux_sens: true as const } : {}), ...base };
  if (FOUR.test(t)) return { etat: "4 voies", ...base };
  return undefined;
}

// La Réunion's time, UTC+4 all year.
const LOCAL_MS = 4 * 3600_000;
// A reopening announced for an hour is no longer told this long after it.
const REOPENED_HOURS = 6;
// A night closure ends on the morning of its last day: at its hour when given, else at noon.
const NOON = "12:00";

/** The UTC time of « dd/mm » at « hh:mm » in La Réunion, in the year of `from` or the next one when that is earlier. */
function at(day: string, time: string, from: number): number {
  const year = new Date(from + LOCAL_MS).getUTCFullYear();
  const t = (y: number) => Date.parse(`${y}-${day.slice(3, 5)}-${day.slice(0, 2)}T${time}:00Z`) - LOCAL_MS;
  return t(year) < from - 30 * 86_400_000 ? t(year + 1) : t(year);
}

/**
 * Whether what was announced is over: a night closure past the morning of its last day, a reopening at an hour past
 * by six hours (the hour following the article). Then it is not told, however recent the article.
 */
function over(a: Annonce, now: Date): boolean {
  const published = Date.parse(a.publie);
  if (a.etat === "fermée la nuit" && a.dates) return now.getTime() > at(a.dates.au, a.horaire?.a ?? NOON, published);
  if (a.etat === "réouverture" && a.a) {
    const local = new Date(published + LOCAL_MS).toISOString();
    let t = Date.parse(`${local.slice(0, 10)}T${a.a}:00Z`) - LOCAL_MS;
    // « à 5h30 » in an article of 22:00 is the next morning; an hour just before the article's, today's.
    if (t < published - 3600_000) t += 86_400_000;
    return now.getTime() > t + REOPENED_HOURS * 3600_000;
  }
  return false;
}

export interface Littoral {
  /** The newest announcement; and, when another source said otherwise within two hours of it, that one too. */
  annonces: Annonce[];
  /** Hours since the newest was published. */
  age_h: number;
}

/**
 * The latest announcement of the last MAX_HOURS (`maxHours`), each source's newest article only, and a disagreeing one
 * close to it. Undefined when none names the road with a state.
 */
export function littoral(news: { infos: Item[]; prefecture: Item[] }, now: Date, maxHours = MAX_HOURS): Littoral | undefined {
  const since = new Date(now.getTime() - maxHours * 3600_000).toISOString();
  const found = [
    ...news.infos.filter((i) => i.publie >= since).map((i) => annonceOf(i)),
    ...news.prefecture.filter((i) => i.publie >= since).map((i) => annonceOf(i, true)),
  ].filter((a): a is Annonce => !!a).sort((a, b) => b.publie.localeCompare(a.publie));
  // A source that publishes twice: its last article only; and not when what it announced is over.
  const latest = found.filter((a, k) => found.findIndex((b) => b.media === a.media) === k).filter((a) => !over(a, now));
  const [first] = latest;
  if (!first) return undefined;
  const close = (a: Annonce) => Date.parse(first.publie) - Date.parse(a.publie) <= CONTRADICTION_HOURS * 3600_000;
  const other = latest.slice(1).find((a) => close(a) && a.etat !== first.etat);
  return { annonces: other ? [first, other] : [first], age_h: Math.floor((now.getTime() - Date.parse(first.publie)) / 3600_000) };
}

/** « Basculée sur 2×1 voies, côté montagne »: the state, as marketing words it. */
export function etatText(a: Annonce): string {
  switch (a.etat) {
    case "4 voies":
      return "Circulation sur 4 voies (2×2)";
    case "basculée":
      return "Basculée sur 2×1 voies, côté montagne";
    case "fermée":
      return `Fermée${a.deux_sens ? " dans les deux sens" : ""}`;
    case "fermée la nuit":
      return a.horaire ? `Fermée la nuit, de ${a.horaire.de} à ${a.horaire.a}${a.dates ? `, du ${a.dates.du} au ${a.dates.au}` : ""}` : "Fermeture de nuit annoncée";
    case "réouverture":
      return `Réouverture annoncée${a.a ? ` à ${a.a}` : ""}${a.voies === "2×1" ? " sur 2×1 voies" : a.voies === "4" ? " sur 4 voies" : ""}`;
  }
}

/** The state in a few words, for a page's description: « basculée sur 2×1 voies ». */
export function etatShort(a: Annonce): string {
  return { "4 voies": "circulation sur 4 voies", basculée: "basculée sur 2×1 voies", fermée: "fermée", "fermée la nuit": "fermée la nuit", réouverture: "réouverture annoncée" }[a.etat];
}

/** « aujourd'hui à 14:20 »: when the article was published, never when the state changes. */
export const publieText = (a: Annonce, now: Date) => quand(a, now);

/** « article » or « communiqué »: the word the link goes on. */
export const linkWord = (a: Annonce) => (a.prefecture ? "communiqué" : "article");

/** « Dernière annonce, il y a 8 h : », past RECENT_HOURS. */
export const agePrefix = (l: Littoral) => (l.age_h >= RECENT_HOURS ? `Dernière annonce, il y a ${l.age_h} h : ` : "");

/** A line in plain text, the link spelled out: for the tools. */
export function lineText(a: Annonce, now: Date): string {
  return `${etatText(a)}, selon ${a.media}, ${linkWord(a)} publié ${publieText(a, now)} (${a.lien}).`;
}

/**
 * What the tool actualites gives of it, when the place or the subject is the road. With no announcement it says so,
 * in marketing's words: left out, the AI said nothing of the road (researcher, 25/10). Never « ouverte » by deduction.
 */
export function forTool(l: Littoral | undefined, now: Date) {
  if (!l) return { annonce: NONE, aucune_annonce: true as const, etat_officiel: INFOTRAFIC };
  return {
    annonce: `${l.annonces.length > 1 ? `${DISAGREE} ` : agePrefix(l)}${l.annonces.map((a) => lineText(a, now)).join(" ")}`,
    annonces: l.annonces.map((a) => ({ etat: etatText(a), selon: a.media, publie: publieText(a, now), lien: a.lien })),
    a_savoir: A_SAVOIR,
    etat_officiel: INFOTRAFIC,
  };
}

/** The sentence of resume_du_jour for La Possession and Saint-Denis. */
export function forSummary(l: Littoral | undefined, now: Date): string | undefined {
  if (!l) return undefined;
  const one = (a: Annonce) => `${etatText(a).replace(/^\p{Lu}/u, (c) => c.toLowerCase())}, selon ${a.media} (${publieText(a, now)})`;
  const head = l.annonces.length > 1 ? "Route du Littoral, les annonces ne disent pas la même chose : " : l.age_h >= RECENT_HOURS ? `Route du Littoral, dernière annonce il y a ${l.age_h} h : ` : "Route du Littoral : ";
  return `${head}${l.annonces.map(one).join("\u00a0; ")}\u00a0; état officiel sur infotrafic.re.`;
}
