/**
 * The notices of the water distributors: cuts for works, tank cleaning, breakdowns, and « ne pas boire l'eau » when the
 * water is no longer safe. Not in the sanitary control data (src/providers/eaupotable.ts), which comes months later.
 *
 * - Dionéo (Saint-Denis), runéo (the south and west) and Eaux de La Possession share a platform with an RSS feed of
 *   « flash infos », each notice in the same words: the commune, the hours of the cut, the streets.
 * - The CIREST publishes the notices of the six communes of the east (CISE Réunion) as WordPress posts, one category
 *   per commune.
 * Other distributors (La Créole, CISE in the south, Saint-Leu) have no feed today.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson, getText } from "../http.js";
import { INSEE } from "../places/insee.js";
import { normalize } from "../places/resolve.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "avis_eau",
  nom: "Avis des distributeurs d'eau : coupures, travaux, eau non potable (Dionéo, runéo, Eaux de La Possession, CIREST)",
  organisme: "Distributeurs d'eau et intercommunalités de La Réunion",
  licence: "Information publique (avis aux abonnés)",
  attribution: "Dionéo, runéo, Eaux de La Possession, CIREST / CISE Réunion",
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
const FRESH_SECONDS = 15 * 60;
const TEXT_MAX = 700;

export interface Avis {
  distributeur: string;
  titre: string;
  communes: string[];
  /** ISO, when the notice was published. */
  publie: string;
  /** Local times « 2026-10-26T21:00 », when the notice gives them. */
  debut?: string;
  fin?: string;
  secteurs: string[];
  /** The water should not be drunk (« ne pas boire », « eau embouteillée ou bouillie »). */
  ne_pas_boire: boolean;
  texte: string;
  lien: string;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', "#039": "'", "#39": "'", nbsp: " ", lt: "<", gt: ">", rsquo: "’", hellip: "…", ndash: "–" };
const entity = (keep: Record<string, string>) => (s: string) =>
  s.replace(/&(#?\w+);/g, (m, e: string) => keep[e] ?? (/^#\d+$/.test(e) && e !== "#60" && e !== "#62" ? String.fromCodePoint(Number(e.slice(1))) : m));
/** The XML layer of a feed: its HTML comes out with its tags. */
const decode = entity(ENTITIES);
/** Once the tags are out: the entities of the text, but never a « < » or « > » that would make a tag again. */
const { lt: _lt, gt: _gt, ...TEXT_ENTITIES } = ENTITIES;
const decodeText = entity(TEXT_ENTITIES);

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
      lien: tag("link"),
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
      lien: p.link,
    };
  });
}

/** Every notice of the feeds; a feed that fails is left out, unless all do. */
export async function avis(cache: Cache): Promise<Cached<Avis[]>> {
  return cache.get("avis-eau", FRESH_SECONDS, async () => {
    const parts = await Promise.allSettled([
      ...FEEDS.map(async (f) => parseRss(await getText(SOURCE.id, f.url, 12_000), f)),
      getJson<Post[]>(SOURCE.id, CIREST, 12_000).then(parseCirest),
    ]);
    if (parts.every((p) => p.status === "rejected")) throw (parts[0] as PromiseRejectedResult).reason;
    return parts.flatMap((p) => (p.status === "fulfilled" ? p.value : [])).sort((a, b) => b.publie.localeCompare(a.publie));
  });
}
