/**
 * The notices of the water distributors: cuts for works, tank cleaning, breakdowns, and « ne pas boire l'eau » when the
 * water is no longer safe. Not in the sanitary control data (src/providers/eaupotable.ts), which comes months later.
 *
 * - Dionéo (Saint-Denis), runéo (the south and west) and Eaux de La Possession share a platform with an RSS feed of
 *   « flash infos », each notice in the same words: the commune, the hours of the cut, the streets.
 * - The CIREST publishes the notices of the six communes of the east (CISE Réunion) as WordPress posts, one category
 *   per commune.
 * - La Créole (Saint-Paul, Les Trois-Bassins) shows its notices on one HTML page, dated to the day, with no feed.
 * - The mairie of Sainte-Marie posts CISE Réunion's notices among its news: in text, or as an image or a PDF, of which
 *   only the link is kept.
 * - The commune of Saint-Leu posts Derichebourg Aqua OI's notices among its news: a short extract is kept, with the
 *   facts (hours, streets) and the link; a post that is only an image gives its link.
 * Other distributors (Sudeau, CISE in Les Avirons, Petite-Île, Cilaos) are not read here: some mairies get a link only
 * (src/eau/distributeurs.ts).
 */
import type { Cache, Cached } from "../cache.js";
import { getJson, getText, httpUrl } from "../http.js";
import { INSEE } from "../places/insee.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "avis_eau",
  nom: "Avis des distributeurs d'eau : coupures, travaux, eau non potable (Dionéo, runéo, Eaux de La Possession, La Créole, CIREST, ville de Sainte-Marie, commune de Saint-Leu)",
  organisme: "Distributeurs d'eau et intercommunalités de La Réunion",
  licence: "Information publique (avis aux abonnés)",
  attribution: "Dionéo, runéo, Eaux de La Possession, La Créole, CIREST / CISE Réunion, ville de Sainte-Marie / CISE Réunion, commune de Saint-Leu / Derichebourg Aqua OI",
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
const TEXT_MAX = 700;

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
  /** The text is a quoted extract cut short (Saint-Leu): what follows, the streets often, is only in the notice. */
  extrait_coupe?: boolean;
  /** Local times « 2026-10-26T21:00 », when the notice gives them. */
  debut?: string;
  fin?: string;
  secteurs: string[];
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
export function parseNotice(text: string): Pick<Avis, "debut" | "fin" | "secteurs"> {
  const start = /(\d\d:\d\d) le (\d\d\/\d\d\/\d{4})/.exec(text) ?? /le (\d\d\/\d\d\/\d{4}) à partir de (\d\d:\d\d)/.exec(text);
  const end = /remise en eau est prévue (?:à partir de |vers )?(\d\d:\d\d) le (\d\d\/\d\d\/\d{4})/.exec(text) ?? /remise en eau est prévue le (\d\d\/\d\d\/\d{4}) (?:à|vers) (\d\d:\d\d)/.exec(text);
  const when = (m: RegExpExecArray | null) => (m ? (m[1].includes(":") ? local(m[2], m[1]) : local(m[1], m[2])) : undefined);
  const block = /secteurs? suivants?\s*:\s*\n([\s\S]*?)(?:\n\s*\n|Des perturbations|La remise en eau)/.exec(text)?.[1] ?? "";
  const secteurs = block.split("\n").map((l) => l.trim()).filter((l) => l && l.length < 80);
  return { debut: when(start), fin: when(end && end !== start ? end : null), secteurs };
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
      ne_pas_boire: DRINK.test(texte) && !BACK.test(texte) && !/peut être impropre à la consommation durant quelques heures/i.test(texte),
      texte: texte.replace(/^Communiqué N°[^\n]*\n/, "").replace(/^Diffusion :\n(?:(?:dans la presse|à la radio)[^\n]*\n)*/, "").replace(/\n+/g, " ").slice(0, TEXT_MAX),
      lien: httpUrl(tag("link")),
    };
  });
}

interface Post { date: string; title: { rendered: string }; link: string; categories: number[]; content: { rendered: string } }

export function parseCirest(posts: Post[]): Avis[] {
  return posts.map((p) => {
    const texte = strip(p.content.rendered).replace(/\s+/g, " ").trim();
    const titre = strip(p.title.rendered).trim();
    const communes = p.categories.map((c) => CIREST_COMMUNES[c]).filter(Boolean);
    return {
      distributeur: "CIREST / CISE Réunion",
      titre,
      communes: communes.length ? communes : communesIn(titre),
      // WordPress gives the local time without its offset.
      publie: new Date(`${p.date}+04:00`).toISOString(),
      ...parseNotice(texte),
      ne_pas_boire: DRINK.test(texte) && !BACK.test(texte),
      texte: texte.slice(0, TEXT_MAX),
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

/** La Créole's page: each `<li>` is « 23/10/2026 - category », the title, then the text. Only the start written with its own date and hour (« 23/10/2026 à partir de 22h00 ») is read: « demain matin » would be a guess. */
export function parseCreole(html: string): Avis[] {
  const box = /<div id="infos-flash">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";
  return [...box.matchAll(/<li>([\s\S]*?)<\/li>/g)].flatMap(([, li]) => {
    const date = /(\d\d\/\d\d\/\d{4})\s*-/.exec(li)?.[1];
    if (!date) return [];
    const titre = strip(/<span class="text-uppercase">([\s\S]*?)<\/span>/.exec(li)?.[1] ?? "").trim();
    const texte = lines(/<span>\s*([\s\S]*)<\/span>/.exec(li)?.[1] ?? "").replace(/\n+/g, " ");
    const start = /(\d\d\/\d\d\/\d{4}) à partir de (\d{1,2})h(\d\d)?/.exec(texte);
    return [{
      distributeur: "La Créole",
      titre,
      ...creoleCommunes(titre, texte),
      publie: new Date(`${ddmmyyyy(date)}T00:00:00+04:00`).toISOString(),
      jour: true,
      debut: start ? `${ddmmyyyy(start[1])}T${start[2].padStart(2, "0")}:${start[3] ?? "00"}` : undefined,
      secteurs: [],
      ne_pas_boire: drinkSaid(titre, texte),
      texte: texte.slice(0, TEXT_MAX),
      lien: CREOLE.url,
    }];
  });
}

// What a post's title is about, after « Communiqué CISE Réunion » (« - fermeture exceptionnelle »): empty when nothing.
const subject = (titre: string) => titre.replace(/^communiqu[ée] CISE( Réunion)?/i, "").replace(/^[\s\-–:]+/, "").trim();
/** The streets after « secteurs suivants : », one per line, up to the first line that is a sentence again. */
function streets(texte: string): string[] {
  const after = /secteurs? suivants?\s*:\s*\n([\s\S]*)/.exec(texte)?.[1] ?? "";
  const out: string[] = [];
  for (const l of after.split("\n").map((x) => x.trim()).filter(Boolean)) {
    if (l.length > 60 || /^(?:et toutes|la remise|des perturbations|CISE|recommandations)/i.test(l)) break;
    out.push(l);
  }
  return out;
}
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
      return [{ distributeur: "CISE Réunion, par la ville de Sainte-Marie", titre: `Communiqué de la CISE du ${p.date.slice(8, 10)}/${p.date.slice(5, 7)} (${forme})`, communes: ["Sainte-Marie"], publie, forme, secteurs: [], ne_pas_boire: false, texte: "", lien }];
    }
    return [{
      distributeur: "CISE Réunion, par la ville de Sainte-Marie",
      titre,
      communes: ["Sainte-Marie"],
      publie,
      ...parseNotice(texte),
      secteurs: streets(texte),
      ne_pas_boire: drinkSaid(titre, texte),
      texte: texte.replace(/\n+/g, " ").slice(0, TEXT_MAX),
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
    if (texte.replace(/\s+/g, " ").length < 120) return [{ ...base, forme: "image", secteurs: [], ne_pas_boire: false, texte: "" }];
    // No list of streets: the posts mix streets and long lines (« RD13, Quartier Bras Mouton et rues adjacentes jusque … »), and a list cut short would mislead.
    const quoted = extract(texte);
    return [{ ...base, ...parseNotice(texte), secteurs: [], ne_pas_boire: drinkSaid(titre, texte), texte: quoted.texte, ...(quoted.coupe ? { extrait_coupe: true } : {}) }];
  });
}

/** Every notice of the feeds; a feed that fails is left out, unless all do. */
export async function avis(cache: Cache): Promise<Cached<Avis[]>> {
  return cache.get("avis-eau", FRESH_SECONDS, async () => {
    const parts = await Promise.allSettled([
      ...FEEDS.map(async (f) => parseRss(await getText(SOURCE.id, f.url, 12_000), f)),
      getJson<Post[]>(SOURCE.id, CIREST, 12_000).then(parseCirest),
      getText(SOURCE.id, CREOLE.url, 12_000).then(parseCreole),
      getJson<Post[]>(SOURCE.id, SAINTE_MARIE, 12_000).then(parseSainteMarie),
      getJson<Post[]>(SOURCE.id, SAINT_LEU, 12_000).then(parseSaintLeu),
    ]);
    if (parts.every((p) => p.status === "rejected")) throw (parts[0] as PromiseRejectedResult).reason;
    return parts.flatMap((p) => (p.status === "fulfilled" ? p.value : [])).sort((a, b) => b.publie.localeCompare(a.publie));
  });
}
