/**
 * The notices of the water distributors: cuts for works, tank cleaning, breakdowns, and « ne pas boire l'eau » when the
 * water is no longer safe. Not in the sanitary control data (src/providers/eaupotable.ts), which comes months later.
 *
 * - Dionéo (Saint-Denis), runéo (the south and west) and Eaux de La Possession share a platform with an RSS feed of
 *   « flash infos », each notice in the same words: the commune, the hours of the cut, the streets.
 * - The CIREST publishes the notices of the six communes of the east as WordPress posts, one category per commune. Each
 *   notice is put under the distributor it names (« CISE Réunion informe… », « runéo informe… »), else under the CIREST
 *   alone: the ARS names O2LEST for four of these communes, runéo and CISE Réunion for the others
 *   (src/eau/distributeurs.json), while their notices are signed CISE Réunion, so none is deduced.
 * - La Créole (Saint-Paul, Les Trois-Bassins) shows its notices on one HTML page, dated to the day, with no feed.
 * - The mairie of Sainte-Marie posts CISE Réunion's notices among its news: in text, or as an image or a PDF, of which
 *   only the link is kept.
 * - The commune of Saint-Leu posts Derichebourg Aqua OI's notices among its news: a short extract is kept, with the
 *   facts (hours, streets) and the link; a post that is only an image gives its link.
 * Other distributors (Sudéau, CISE in Les Avirons, Petite-Île, Cilaos) are not read here: some mairies get a link only
 * (src/eau/distributeurs.ts).
 */
import type { Cache, Cached } from "../cache.js";
import { getJson, getText, httpUrl } from "../http.js";
import { INSEE } from "../places/insee.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import { localTime } from "../geo.js";
import { type SourceInfo, why } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "avis_eau",
  nom: "Avis des distributeurs d'eau : coupures, travaux, eau non potable (Dionéo, runéo, Eaux de La Possession, La Créole, CIREST, ville de Sainte-Marie, commune de Saint-Leu)",
  organisme: "Distributeurs d'eau et intercommunalités de La Réunion",
  licence: "Information publique (avis aux abonnés)",
  attribution: "Dionéo, runéo, Eaux de La Possession, La Créole, CIREST, ville de Sainte-Marie / CISE Réunion, commune de Saint-Leu / Derichebourg Aqua OI",
  url: "https://www.cirest.fr/categorie/communique/communique-eau/",
};

const FEEDS = [
  { nom: "Dionéo", url: "https://dioneo.re/rss/flash-infos", communes: ["Saint-Denis"] },
  { nom: "runéo", url: "https://www.runeo.re/rss/flash-infos", communes: [] as string[] },
  { nom: "Eaux de La Possession", url: "https://www.eauxdelapossession.re/rss/flash-infos", communes: ["La Possession"] },
];
const CIREST = "https://www.cirest.fr/wp-json/wp/v2/posts?categories=42,43,44,45,46,47&per_page=20&_fields=date,title,link,categories,content";
const CIREST_COMMUNES: Record<number, string> = {
  42: "Bras-Panon", 43: "Saint-André", 44: "La Plaine-des-Palmistes", 45: "Saint-Benoît", 46: "Sainte-Rose", 47: "Salazie",
};
export const CREOLE = { url: "https://lacreole.re/flash-infos", communes: ["Saint-Paul", "Les Trois-Bassins"] };
const SAINTE_MARIE = "https://www.ville-saintemarie.re/wp-json/wp/v2/posts?search=CISE&per_page=20&_fields=date,title,link,content";
// The commune's legal notice (saintleu.re/mentions-legales) allows reuse « à des fins d'information, non commerciales »:
// rundata.re is free, informative, without advertising, so a short extract is quoted with its source and link. To be
// reviewed if the site changes in nature.
const SAINT_LEU = "https://www.saintleu.re/wp-json/wp/v2/posts?search=eau&per_page=20&_fields=date,title,link,content";
const EXTRACT_MAX = 250;
const FRESH_SECONDS = 15 * 60;
const TEXT_MAX = 320;

export interface Avis {
  distributeur: string;
  titre: string;
  communes: string[];
  /** ISO, when the notice was published. */
  publie: string;
  /** The source gives the day only (La Créole): `publie` is its midnight, and no time is told. */
  jour?: boolean;
  /** Said with the notice when its commune is not certain: « Commune non précisée par La Créole … ». */
  precision?: string;
  /** A notice posted as an image or a PDF: nothing is read from it, only its link is given. */
  forme?: "image" | "PDF";
  /** The text is cut short (`cut`, or Saint-Leu's `extract`): what follows, the streets often, is only in the notice. */
  extrait_coupe?: boolean;
  /** Local times « 2026-10-26T21:00 », when the notice gives them. */
  debut?: string;
  fin?: string;
  /** The streets of the notice, only when its list was read whole (`sectorList`), else empty. */
  secteurs: string[];
  /** Whether `secteurs` is the notice's whole list; false also when no list was found. */
  secteurs_complets: boolean;
  /** The water should not be drunk (« ne pas boire », « eau embouteillée ou bouillie »). */
  ne_pas_boire: boolean;
  texte: string;
  /** Absent when the feed gives no http(s) link. */
  lien?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', "#039": "'", "#39": "'", nbsp: " ", lt: "<", gt: ">", rsquo: "’", hellip: "…", ndash: "–" };
const entity = (keep: Record<string, string>) => (s: string) =>
  s.replace(/&(#?\w+);/g, (m, e: string) => keep[e] ?? (/^#\d+$/.test(e) && e !== "#60" && e !== "#62" ? String.fromCodePoint(Number(e.slice(1))) : m));
/** The XML layer of a feed: its HTML comes out with its tags. */
const decode = entity(ENTITIES);
/** Once the tags are out: the entities of the text, but never a « < » or « > » that would make a tag again. */
const { lt: _lt, gt: _gt, ...TEXT_ENTITIES } = ENTITIES;
export const decodeText = entity(TEXT_ENTITIES);

/** The text of some HTML, the tags dropped character by character (a pattern would leave « <scr<script>ipt> » halves). */
export function textOf(html: string): string {
  let out = "";
  let tag: string | undefined;
  for (const ch of html) {
    if (ch === "<") tag = "";
    else if (ch === ">" && tag !== undefined) {
      if (/^\/?(br|p|div|li)\b/i.test(tag)) out += "\n";
      tag = undefined;
    } else if (tag !== undefined) tag += ch;
    else if (ch !== ">") out += ch;
  }
  return out;
}

// Without the tags, nor the emoji the posts start their lines with (« ⚠️ CONSIGNES »), which most fonts lack.
export const strip = (html: string) => decodeText(textOf(decode(html))).replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F\u25AA\u25AB]\s?/gu, "");

const NAMES = Object.keys(INSEE).sort((a, b) => b.length - a.length);
/** The communes a text names: « SAINT DENIS », « La Plaine-des-Palmistes ». */
export function communesIn(text: string): string[] {
  const t = ` ${normalize(text)} `;
  return NAMES.filter((n) => t.includes(` ${normalize(n)} `));
}

const local = (d: string, hm: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}T${hm}`;
const DRINK = /ne pas boire|impropre (?:à|a) la consommation|eau embouteill|bouillie|faire bouillir|restriction d.usage/i;
/** The notice that lifts a « ne pas boire » (« les résultats sont conformes », « de nouveau potable »), not the one that awaits it. */
export const BACK = /(?<!information de )retour (?:à|a) la (?:normale|conformit)|lev[ée]e de la restriction|de nouveau (?:potable|garantie|consommable)|à nouveau (?:potable|consommable)|(?:sont|est) conformes?\b|redevenue? potable/i;

/** One notice of the shared platform's feed, in its usual words. */
export function parseNotice(text: string): Pick<Avis, "debut" | "fin"> {
  // The start is said before the return of the water: « perturbée le 28/10/2026 à partir de 08:00 … La remise en eau est prévue à partir de 20:00 le 28/10/2026 ».
  const head = text.split(/remise en eau/i)[0];
  const start = /(\d\d:\d\d) le (\d\d\/\d\d\/\d{4})/.exec(head) ?? /le (\d\d\/\d\d\/\d{4}) à partir de (\d\d:\d\d)/.exec(head);
  const end = /remise en eau est prévue (?:à partir de |vers )?(\d\d:\d\d) le (\d\d\/\d\d\/\d{4})/.exec(text) ?? /remise en eau est prévue le (\d\d\/\d\d\/\d{4}) (?:à|vers) (\d\d:\d\d)/.exec(text);
  const when = (m: RegExpExecArray | null) => (m ? (m[1].includes(":") ? local(m[2], m[1]) : local(m[1], m[2])) : undefined);
  return { debut: when(start), fin: when(end) };
}

const LIST_START = /secteurs? suivants?\s*:[ \t]*\n/i;
// The lines that close a list of streets: none of them is a street.
const CLOSING = /^(?:et toutes les voies|la remise en|le rétablissement|des perturbations|CISE|recommandations)/i;
// Longer, a line is a sentence or a street with its limits (« RD13, Quartier Bras Mouton et rues adjacentes jusque … »).
const STREET_MAX = 60;

/**
 * The streets after « secteurs suivants : », one per line, and whether the list was read whole. Worded with marketing:
 * whole only when the list ends at a known closing line (« Et toutes les voies adjacentes », « La remise en eau … »),
 * or at a blank line in a feed (`blankEnds`; WordPress posts put a blank line between the streets), and no line of it
 * was left out. A list that runs to the end of the text (the source cut short) or to a long line, or that another list
 * follows (« également sur le secteur suivant : »), is not whole: nothing of it is said, the notice is.
 */
export function sectorList(text: string, blankEnds: boolean): Pick<Avis, "secteurs" | "secteurs_complets"> {
  const m = LIST_START.exec(text);
  if (!m) return { secteurs: [], secteurs_complets: false };
  const none = { secteurs: [], secteurs_complets: false };
  const rest = text.slice(m.index + m[0].length).split("\n");
  const out: string[] = [];
  for (const [i, raw] of rest.entries()) {
    const l = raw.trim().replace(/^[•·–-]\s*/, "");
    if ((!l && blankEnds && out.length) || (l && CLOSING.test(l))) {
      return out.length && !LIST_START.test(rest.slice(i).join("\n")) ? { secteurs: out, secteurs_complets: true } : none;
    }
    if (l.length > STREET_MAX) return none;
    if (l) out.push(l);
  }
  return none;
}

// The private character that marks, before the text is put on one line, the colon that opens a list.
const MARK = "\uE000";
// The sentence that says when the water comes back, the first one, beginning a line or after a full stop; the posts
// put non-breaking spaces in it (« La remise en\u00a0service »).
const RETURN = /(?:^|(?<=[.!?:]\s))(?:La\s+remise\s+en\s+(?:eau|service)|Le\s+rétablissement)\b.*?(?:[.!?](?=\s|$)|$)/m;
/** That sentence, whole and word for word, on one line; none when the notice says nothing of it. */
export const returnSentence = (text: string) => RETURN.exec(text)?.[0].replace(/\s+/g, " ").trim();

/**
 * The text said with a notice, cut once, here, so that the page and the tool say the same. Worded with marketing: it
 * stops right after the colon that opens a list (« pour les secteurs suivants : […] »), never in the middle of the
 * list, else at the end of a word; a cut text ends with « […] ». The colon that opens a list ends its line, and the
 * line is a sentence: not a label such as « Objet : » or « Diffusion : », which would leave nothing of the notice.
 * The sentence of the return of the water is never lost: when the cut leaves it out, it follows the « […] », whole and
 * word for word (« … : […] La remise en service se fera progressivement à partir de 18h00. »).
 */
export function cut(text: string, max = TEXT_MAX): { texte: string; extrait_coupe?: true } {
  const flat = text.replace(/^(.{20,}?:)[ \t]*\n/m, `$1${MARK}\n`).replace(/\s+/g, " ").trim();
  const at = flat.indexOf(MARK);
  const whole = flat.replace(MARK, "");
  let kept: string;
  if (at >= 0 && at < max && flat.slice(at + 1).trim()) kept = flat.slice(0, at);
  else if (whole.length <= max) return { texte: whole };
  else kept = whole.slice(0, max).replace(/\s+\S*$/, "");
  const back = returnSentence(text);
  if (!back || kept.includes(back)) return { texte: `${kept} […]`, extrait_coupe: true };
  // Begun in what is kept: kept up to its end.
  const from = whole.indexOf(back);
  if (from >= 0 && from < kept.length) return { texte: `${whole.slice(0, from + back.length)} […]`, extrait_coupe: true };
  return { texte: `${kept} […] ${back}`, extrait_coupe: true };
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const DAY = new RegExp(`\\b(\\d{1,2})(?:er)? (${MONTHS.join("|")}) (\\d{4})|\\b(\\d\\d)\\/(\\d\\d)\\/(\\d{4})`, "i");
const HOUR = /\b([01]?\d|2[0-3])(?:h(\d\d)?\b|:(\d\d)\b| heures?\b)/i;
const pad = (n: number | string) => String(n).padStart(2, "0");
/** « jeudi 15 octobre 2026 », « 15/10/2026 » → « 2026-10-15 ». */
function dayOf(text: string): string | undefined {
  const m = DAY.exec(text);
  if (!m) return undefined;
  return m[1] ? `${m[3]}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(m[1])}` : `${m[6]}-${m[5]}-${m[4]}`;
}
const hourOf = (m: RegExpExecArray) => `${pad(m[1])}:${m[2] ?? m[3] ?? "00"}`;

/**
 * The hours of a CISE Réunion notice, in its own words: the start « le jeudi 15 octobre 2026 à partir de 5h00 », the
 * end in the sentence of the return of the water (`returnSentence`, « … à partir de 18h00 », « 15:30 », « 18 heures »),
 * on its own day or else the day of the cut. Nothing when the notice writes no hour (« en fin d'après-midi »).
 */
export function ciseTimes(text: string): Pick<Avis, "debut" | "fin"> {
  const back = returnSentence(text);
  const flat = text.replace(/\s+/g, " ");
  const head = back ? flat.slice(0, flat.indexOf(back)) : flat;
  const day = dayOf(head);
  const start = /à partir de ([01]?\d|2[0-3])(?:h(\d\d)?\b|:(\d\d)\b| heures?\b)/i.exec(head);
  const end = back ? HOUR.exec(back) : null;
  const endDay = (back && dayOf(back)) ?? day;
  return { debut: day && start ? `${day}T${hourOf(start)}` : undefined, fin: endDay && end ? `${endDay}T${hourOf(end)}` : undefined };
}
/** The shared platform's words first (a runéo notice posted by the CIREST), else CISE Réunion's. */
function times(text: string): Pick<Avis, "debut" | "fin"> {
  const p = parseNotice(text.replace(/\s+/g, " "));
  const c = ciseTimes(text);
  return { debut: p.debut ?? c.debut, fin: p.fin ?? c.fin };
}

export function parseRss(xml: string, feed: (typeof FEEDS)[number]): Avis[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const tag = (t: string) => decode(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(item)?.[1] ?? "").trim();
    const texte = strip(tag("description")).replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
    const found = communesIn(texte.split("\n").find((l) => /informe ses clients/i.test(l)) ?? texte);
    return {
      distributeur: feed.nom,
      titre: tag("title"),
      communes: found.length ? found : feed.communes,
      publie: new Date(tag("pubDate")).toISOString(),
      ...parseNotice(texte),
      ...sectorList(texte, true),
      ne_pas_boire: DRINK.test(texte) && !BACK.test(texte) && !/peut être impropre à la consommation durant quelques heures/i.test(texte),
      ...cut(texte.replace(/^Communiqué N°[^\n]*\n/, "").replace(/^Diffusion :\n(?:(?:dans la presse|à la radio)[^\n]*\n)*/, "")),
      lien: httpUrl(tag("link")),
    };
  });
}

interface Post { date: string; title: { rendered: string }; link: string; categories: number[]; content: { rendered: string } }

// The distributors a CIREST notice may name, as they write themselves.
const OPERATORS: [RegExp, string][] = [[/CISE\s+R[ée]union/i, "CISE Réunion"], [/\brun[ée]o\b/i, "runéo"], [/\bO2\s?L.?EST\b/i, "O2LEST"]];
const first = (text: string, signed: boolean) =>
  OPERATORS.map(([re, nom]) => ({ nom, at: text.search(signed ? new RegExp(`${re.source}\\s+(?:vous\\s+)?informe`, "i") : re) }))
    .filter((x) => x.at >= 0).sort((x, y) => x.at - y.at)[0]?.nom;
/**
 * The distributor a notice names in its own words, if any: the one that signs it (« CISE Réunion informe… ») in any of
 * `texts`, else the first one it names (« …signalé par CISE Réunion »). « Suite à une casse sur le réseau de runéo,
 * CISE Réunion informe… » is CISE Réunion's.
 */
export function operatorOf(...texts: string[]): string | undefined {
  for (const signed of [true, false]) for (const t of texts) {
    const nom = first(t, signed);
    if (nom) return nom;
  }
  return undefined;
}

export function parseCirest(posts: Post[]): Avis[] {
  return posts.map((p) => {
    const body = lines(p.content.rendered);
    const texte = body.replace(/\s+/g, " ");
    const titre = strip(p.title.rendered).trim();
    const communes = p.categories.map((c) => CIREST_COMMUNES[c]).filter(Boolean);
    const operator = operatorOf(texte, titre);
    return {
      distributeur: operator ? `CIREST / ${operator}` : "CIREST",
      titre,
      communes: communes.length ? communes : communesIn(titre),
      // WordPress gives the local time without its offset.
      publie: new Date(`${p.date}+04:00`).toISOString(),
      ...times(body),
      ...sectorList(body, false),
      ne_pas_boire: DRINK.test(texte) && !BACK.test(texte),
      ...cut(body),
      lien: httpUrl(p.link),
    };
  });
}

// Only what a notice says in so many words: « faire bouillir », « ne pas boire », not a « restriction d'usage » of drought.
const DRINK_WORDS = /ne pas boire|ne pas consommer l.eau|impropre (?:à|a) la consommation|faire bouillir|eau bouillie/i;
// The advice given with every cut, for the hours after the water comes back: a cut, not water to keep from drinking.
const AFTER_CUT = /remise en eau|(?:rétablissement|reprise) de la distribution|après le rétablissement/i;
const CUT = /interruption|coupure|travaux|fermer la distribution/i;
const drinkSaid = (titre: string, texte: string) =>
  DRINK_WORDS.test(texte) && !BACK.test(texte) && !(CUT.test(`${titre} ${texte}`) && AFTER_CUT.test(texte));
const lines = (html: string) => strip(html).replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const ddmmyyyy = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;

// The place a notice names (« Le secteur de La Plaine – Bois-de-Nèfles, correspondant à … »), as written.
const LIEU = /\bsecteurs? (?:de |du |des |d['’])?([^,:;(\n]+?)(?=\s*(?:,|:|;|\(| correspondant|$))/i;

/** La Créole serves two communes: the one the notice names, else the one its place is in (src/places), else both, saying so. Never another commune, even for a place found elsewhere too (Bois-de-Nèfles is also in Saint-Denis). */
function creoleCommunes(titre: string, texte: string): Pick<Avis, "communes" | "precision"> {
  const named = communesIn(`${titre} ${texte}`).filter((c) => CREOLE.communes.includes(c));
  if (named.length) return { communes: named };
  const lieu = LIEU.exec(texte)?.[1]?.trim();
  const r = lieu ? resolvePlace(lieu) : null;
  const found = r && r.correspondance !== "approchee" ? [...new Set([r.lieu, ...r.autres].map((p) => p.commune))].filter((c) => CREOLE.communes.includes(c)) : [];
  if (found.length === 1) return { communes: found };
  return { communes: CREOLE.communes, precision: `La Créole ne précise pas la commune${lieu ? ` (lieu écrit dans l'avis : ${lieu})` : ""}.` };
}

/**
 * La Créole's page: each `<li>` is « 23/10/2026 - category », the title, then the text. The start is read when written
 * with its own date and hour (« 23/10/2026 à partir de 22h00 »); the end when « jusqu'à 6h00 demain », the day after
 * the start (else after the notice's date). No other end is guessed (« en fin de matinée »).
 */
export function parseCreole(html: string): Avis[] {
  const box = /<div id="infos-flash">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";
  return [...box.matchAll(/<li>([\s\S]*?)<\/li>/g)].flatMap(([, li]) => {
    const date = /(\d\d\/\d\d\/\d{4})\s*-/.exec(li)?.[1];
    if (!date) return [];
    const titre = strip(/<span class="text-uppercase">([\s\S]*?)<\/span>/.exec(li)?.[1] ?? "").trim();
    const body = lines(/<span>\s*([\s\S]*)<\/span>/.exec(li)?.[1] ?? "");
    const texte = body.replace(/\n+/g, " ");
    const start = /(\d\d\/\d\d\/\d{4}) à partir de (\d{1,2})h(\d\d)?/.exec(texte);
    const tomorrow = /jusqu['’]à (\d{1,2})h(\d\d)? demain\b/.exec(texte);
    const next = new Date(Date.parse(`${ddmmyyyy(start?.[1] ?? date)}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    return [{
      distributeur: "La Créole",
      titre,
      ...creoleCommunes(titre, texte),
      publie: new Date(`${ddmmyyyy(date)}T00:00:00+04:00`).toISOString(),
      jour: true,
      debut: start ? `${ddmmyyyy(start[1])}T${start[2].padStart(2, "0")}:${start[3] ?? "00"}` : undefined,
      fin: tomorrow ? `${next}T${tomorrow[1].padStart(2, "0")}:${tomorrow[2] ?? "00"}` : undefined,
      // Its places are zones with their limits (« sa limite haute : le chemin de La Giroday … »), not a list of streets.
      secteurs: [],
      secteurs_complets: false,
      ne_pas_boire: drinkSaid(titre, texte),
      ...cut(body),
      lien: CREOLE.url,
    }];
  });
}

// What a post's title is about, after « Communiqué CISE Réunion » (« - fermeture exceptionnelle »): empty when nothing.
const subject = (titre: string) => titre.replace(/^communiqu[ée] CISE( Réunion)?/i, "").replace(/^[\s\-–:]+/, "").trim();
const WATER = /coupure|interruption|\beau\b|d.eau|distribution|bouillir|potab|travaux|réseau|qualit/i;

/** The mairie of Sainte-Marie's posts « Communiqué CISE Réunion », but not one whose title is about something else than water (the offices closed). */
export function parseSainteMarie(posts: Omit<Post, "categories">[]): Avis[] {
  return posts.flatMap((p): Avis[] => {
    const titre = strip(p.title.rendered).trim();
    if (!/^communiqu[ée] CISE/i.test(titre)) return [];
    const about = subject(titre);
    if (about && !WATER.test(about)) return [];
    const html = p.content.rendered;
    const texte = lines(html);
    const publie = new Date(`${p.date}+04:00`).toISOString();
    const lien = httpUrl(p.link);
    // A post that is a picture or a PDF, with at most its file's name for text.
    if (texte.replace(/\s+/g, " ").length < 120 && /<img|\.pdf/i.test(html)) {
      const forme: Avis["forme"] = /\.pdf/i.test(html) ? "PDF" : "image";
      return [{ distributeur: "CISE Réunion, par la ville de Sainte-Marie", titre: `Communiqué de la CISE du ${p.date.slice(8, 10)}/${p.date.slice(5, 7)} (${forme})`, communes: ["Sainte-Marie"], publie, forme, secteurs: [], secteurs_complets: false, ne_pas_boire: false, texte: "", lien }];
    }
    return [{
      distributeur: "CISE Réunion, par la ville de Sainte-Marie",
      titre,
      communes: ["Sainte-Marie"],
      publie,
      ...times(texte),
      ...sectorList(texte, false),
      ne_pas_boire: drinkSaid(titre, texte),
      ...cut(texte),
      lien,
    }];
  });
}

// A Saint-Leu post about the water network, not one that only names water (« Fête des Artichauts … »).
const SAINT_LEU_WATER = /coupure d.eau|distribution d.eau|réseau d.eau|perturbations? d.eau|manques? d.eau|eau potable/i;
const CUT_WORDS = /interruption|coupure|perturbation|manques? d.eau/i;

/**
 * The sentence that says the cut (when, where), quoted, never the whole notice. Worded with marketing: it stops right
 * after a colon (« sur les secteurs suivants : […] »), never in the middle of a list of streets, else at the end of a
 * word; a cut extract ends with « […] ».
 */
export function extract(texte: string): { texte: string; coupe: boolean } {
  const flat = texte.replace(/\s+/g, " ").trim();
  const sentences = flat.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/);
  const one = sentences.find((x) => CUT_WORDS.test(x)) ?? sentences[0] ?? "";
  const colon = one.indexOf(":");
  if (colon >= 0 && colon < one.length - 1 && colon < EXTRACT_MAX) return { texte: `${one.slice(0, colon + 1)} […]`, coupe: true };
  if (one.length <= EXTRACT_MAX) return { texte: one, coupe: false };
  return { texte: `${one.slice(0, EXTRACT_MAX).replace(/\s+\S*$/, "")} […]`, coupe: true };
}

/** The commune of Saint-Leu's posts about the water network: a short extract with its facts, or the link of an image. */
export function parseSaintLeu(posts: Omit<Post, "categories">[]): Avis[] {
  return posts.flatMap((p): Avis[] => {
    const titre = strip(p.title.rendered).replace(/^[^\p{L}\d]+/u, "").trim();
    if (!SAINT_LEU_WATER.test(titre)) return [];
    const html = p.content.rendered;
    const texte = lines(html);
    const base = { distributeur: "Derichebourg Aqua OI, par la commune de Saint-Leu", titre, communes: ["Saint-Leu"], publie: new Date(`${p.date}+04:00`).toISOString(), lien: httpUrl(p.link) };
    // A post that is a picture: its title and link only.
    if (texte.replace(/\s+/g, " ").length < 120) return [{ ...base, forme: "image", secteurs: [], secteurs_complets: false, ne_pas_boire: false, texte: "" }];
    // No list of streets: the posts mix streets and long lines (« RD13, Quartier Bras Mouton et rues adjacentes jusque … »), and a list cut short would mislead.
    const quoted = extract(texte);
    return [{ ...base, ...parseNotice(texte), secteurs: [], secteurs_complets: false, ne_pas_boire: drinkSaid(titre, texte), texte: quoted.texte, ...(quoted.coupe ? { extrait_coupe: true } : {}) }];
  });
}

/**
 * One feed's read. A feed that did not answer keeps the notices of the read before, with the hour of that read
 * (`lu_a`), and is said silent (`muet`): a failed read is never « no notice » (tools/injoignable.ts).
 */
export interface Flux {
  /** Its name as the pages say it, after « le site »: « de la CIREST », « des Eaux de La Possession ». */
  de: string;
  /** The page its notices are on, for « voir son site ». */
  site: string;
  avis: Avis[];
  muet?: true;
  /** When the notices kept were read (« 24/10 10:00 »), when it is silent. */
  lu_a?: string;
}

const PARTS: { de: string; site: string; load: () => Promise<Avis[]> }[] = [
  ...FEEDS.map((f) => ({ de: f.nom === "Eaux de La Possession" ? "des Eaux de La Possession" : `de ${f.nom}`, site: new URL(f.url).origin + "/", load: async () => parseRss(await getText(SOURCE.id, f.url, 12_000), f) })),
  { de: "de la CIREST", site: "https://www.cirest.fr/categorie/communique/communique-eau/", load: async () => parseCirest(await getJson<Post[]>(SOURCE.id, CIREST, 12_000)) },
  { de: "de La Créole", site: CREOLE.url, load: async () => parseCreole(await getText(SOURCE.id, CREOLE.url, 12_000)) },
  { de: "de la ville de Sainte-Marie", site: "https://www.ville-saintemarie.re/?s=CISE", load: async () => parseSainteMarie(await getJson<Post[]>(SOURCE.id, SAINTE_MARIE, 12_000)) },
  { de: "de la commune de Saint-Leu", site: "https://www.saintleu.re/?s=eau", load: async () => parseSaintLeu(await getJson<Post[]>(SOURCE.id, SAINT_LEU, 12_000)) },
];

const FLUX = "avis-eau:flux";

/** Every feed's read, the notices of one that did not answer kept from the read before; throws only when all fail with nothing kept. */
export async function lecture(cache: Cache): Promise<Cached<Flux[]>> {
  return cache.island(FLUX, FRESH_SECONDS, async () => {
    const before = await cache.peek<Flux[]>(FLUX).catch(() => undefined);
    const parts = await Promise.allSettled(PARTS.map((p) => p.load()));
    const flux = PARTS.map((p, i): Flux => {
      const r = parts[i];
      if (r.status === "fulfilled") return { de: p.de, site: p.site, avis: r.value };
      console.error(`source ${SOURCE.id} indisponible (${p.site}):`, why(r.reason));
      const was = before?.value.find((f) => f.site === p.site);
      const kept = was?.avis.length ? was.avis : [];
      return { de: p.de, site: p.site, avis: kept, muet: true, ...(kept.length ? { lu_a: was!.muet ? was!.lu_a : localTime(before!.fetchedAt) } : {}) };
    });
    if (parts.every((p) => p.status === "rejected") && !flux.some((f) => f.avis.length)) throw (parts[0] as PromiseRejectedResult).reason;
    return flux;
  });
}

/** Every notice of the feeds, those of a feed that did not answer kept from the read before (`lecture`). */
export async function avis(cache: Cache): Promise<Cached<Avis[]>> {
  const c = await lecture(cache);
  return { ...c, value: c.value.flatMap((f) => f.avis).sort((a, b) => b.publie.localeCompare(a.publie)) };
}
