/**
 * The OVPF's releases posted on Bluesky as images alone, without text (volcan.ts, `Post.image`): the text of their
 * first image, read by Tesseract (French) in a collector outside the Worker (scripts/ovpf-ocr.ts), once per post,
 * never for a question. The Worker only reads what the collector stored in KV, under `ovpf:ocr:<post>`.
 *
 * The images are the release's pages rendered from its PDF (A4, 2480 × 3508). Only the first is read: the release's
 * text, from its dated line to its signature; the following ones are its figures. The text is kept only when the
 * whole page reads well (each word's confidence, given by Tesseract), when it is a release (« Communiqué » and the
 * signature of the observatory's direction), when its dated line gives the day of the post, give or take one, and
 * when it has the line of the alert level. Anything else is « non lu », with the reason, and the post stays said as
 * images not read.
 *
 * Nothing is drawn from the text: no level, no figure, no time. It is quoted as read, said as read by a machine and
 * possibly wrong, with the post's link, and only when the alert level it gives is the one known from the prefecture
 * (tools/volcan.ts).
 */
import type { Cache } from "../cache.js";
import type { Post } from "./volcan.js";

/** A word Tesseract read: where it is (block, paragraph), its confidence (0 to 100), its text. */
interface Mot {
  bloc: number;
  par: number;
  conf: number;
  texte: string;
}

/** What the first image of a post gave: its text, or why none is kept. */
export type Resultat =
  | { statut: "lu"; jour: string; paragraphes: string[]; niveau_lu: string; confiance: number; mots: number }
  | { statut: "non_lu"; raison: string; confiance?: number; mots?: number };

/** As stored in KV by the collector: with when it was read and by what. */
export type Stocke = Resultat & { lu_a: string; outil: string };

export const KEY = (post: string) => `ovpf:ocr:${post}`;
/** The post's own id, the last part of its link: « 3myod6frais2s ». */
export const postId = (lien: string) => lien.split("/").pop()!;

// Measured on the releases of 24/10 and 25/10/2026: 93.4 and 92.4 on average, 2 to 3 % of the words under 60; their
// figures 82, 15 to 16 % under 60.
export const CONFIANCE_MIN = 88;
export const MOTS_MIN = 80;
const FAIBLE = 60;
export const FAIBLES_MAX = 0.05;

// « 24/10/2026 — 18h30 heure locale — 14h30 heure UTC », any dash.
const DATED = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[—–-]\s*\d{1,2}\s*h\s*\d{0,2}\s+heure locale\b/i;
const HEADER = /^Communiqu[ée]$/i;
const SIGNATURE = /^La direction de l['’]OVPF/i;
// « Niveau d'alerte : Alerte 1 », « Niveau d'alerte en cours : Alerte 1 ».
export const NIVEAU = /^Niveau d['’]alerte\b[^:]{0,20}:\s*(\S.*)$/i;
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** The words of Tesseract's TSV output (`tesseract image stdout -l fra tsv`), in reading order. */
export function words(tsv: string): Mot[] {
  return tsv
    .split("\n")
    .slice(1)
    .map((l) => l.split("\t"))
    .filter((c) => c[0] === "5" && c.length >= 12 && c[11].trim() && Number(c[10]) >= 0)
    .map((c) => ({ bloc: +c[2], par: +c[3], conf: Number(c[10]), texte: c[11].trim() }));
}

/** The page's paragraphs as Tesseract found them, each one's lines joined by a space. */
function paragraphs(mots: Mot[]): string[] {
  const out: string[] = [];
  let at = "";
  for (const m of mots) {
    const key = `${m.bloc}.${m.par}`;
    if (key !== at) out.push(m.texte);
    else out[out.length - 1] += ` ${m.texte}`;
    at = key;
  }
  return out;
}

/**
 * The release's text in the TSV of its first image, `posted` the time of the post (ISO): its paragraphs from its
 * dated line (excluded) to its signature (excluded), or « non lu » with the first reason found.
 */
export function readPage(tsv: string, posted: string): Resultat {
  const mots = words(tsv);
  const confiance = mots.length ? Math.round((mots.reduce((s, m) => s + m.conf, 0) / mots.length) * 10) / 10 : 0;
  const faibles = mots.filter((m) => m.conf < FAIBLE).length / (mots.length || 1);
  const stats = { confiance, mots: mots.length };
  const no = (raison: string): Resultat => ({ statut: "non_lu", raison, ...stats });
  if (mots.length < MOTS_MIN) return no(`${mots.length} mots lus, moins de ${MOTS_MIN}`);
  if (confiance < CONFIANCE_MIN) return no(`confiance moyenne de ${String(confiance).replace(".", ",")}, sous ${CONFIANCE_MIN}`);
  if (faibles >= FAIBLES_MAX) return no(`${Math.round(faibles * 100)} % des mots lus avec une confiance sous ${FAIBLE}`);
  const paras = paragraphs(mots);
  if (!paras.some((p) => HEADER.test(p))) return no("en-tête « Communiqué » non lu");
  const d = paras.findIndex((p) => DATED.test(p));
  if (d < 0) return no("ligne datée non lue");
  const [, dd, mm, yyyy] = DATED.exec(paras[d])!;
  const jour = `${yyyy}-${pad(+mm)}-${pad(+dd)}`;
  const postDay = new Date(Date.parse(posted) + 4 * 3600_000).toISOString().slice(0, 10);
  if (Math.abs(Date.parse(jour) - Date.parse(postDay)) > DAY_MS) return no(`ligne datée du ${jour}, publication du ${postDay}`);
  const end = paras.findIndex((p, i) => i > d && SIGNATURE.test(p));
  if (end < 0) return no("signature de la direction de l'OVPF non lue");
  const body = paras.slice(d + 1, end);
  const niveau = body.find((p) => NIVEAU.test(p));
  if (!niveau) return no("ligne du niveau d'alerte non lue");
  return { statut: "lu", jour, paragraphes: body, niveau_lu: niveau, ...stats };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/[\s–—-]+/g, " ").trim().toLowerCase();

/** Whether the level a release's line gives (« Niveau d'alerte : Alerte 1 ») is `known` (« Alerte 1 »). */
export function sameLevel(line: string, known: string | undefined): boolean {
  const m = NIVEAU.exec(line);
  return !!m && !!known && fold(m[1]) === fold(known);
}

/** The posts of the feed given in images, with the address of their first image: what the collector reads. */
export function toRead(feed: FeedJson, posts: Post[]): { post: Post; id: string; image: string }[] {
  const firsts = new Map(
    feed.feed.map(({ post }) => {
      const e = post.embed;
      const image = (e?.images ?? e?.media?.images ?? [])[0]?.fullsize;
      return [post.uri.split("/").pop()!, image] as const;
    }),
  );
  return posts.flatMap((post) => {
    const id = postId(post.lien);
    const image = post.image ? firsts.get(id) : undefined;
    return image ? [{ post, id, image }] : [];
  });
}

export interface FeedJson {
  feed: { post: { uri: string; embed?: { images?: { fullsize?: string }[]; media?: { images?: { fullsize?: string }[] } } } }[];
}

let reader: ((key: string) => Promise<Stocke | null>) | undefined;

/** In the Worker: read what the collector stored, from the KV store. */
export function configure(read: ((key: string) => Promise<Stocke | null>) | undefined) {
  reader = read;
}

// Not read yet: asked again every five minutes, the collector's pace. A result does not change once stored.
const WAIT_SECONDS = 5 * 60;
const KEPT_SECONDS = 30 * 86_400;

/** What the collector read in a post's first image, if it has read it. Never throws. */
export async function resultat(cache: Cache, post: Post): Promise<Stocke | undefined> {
  if (!reader || !post.image) return undefined;
  const id = postId(post.lien);
  const key = `volcan:ocr:${id}`;
  try {
    const have = await cache.peek<Stocke | { statut: "attente" }>(key);
    const done = have && have.value.statut !== "attente";
    const got = await cache.getFrom(key, have, done ? KEPT_SECONDS : WAIT_SECONDS, async () => (await reader!(KEY(id))) ?? { statut: "attente" as const });
    return got.value.statut === "attente" ? undefined : got.value;
  } catch (e) {
    console.error(`volcan : texte lu dans l'image de l'OVPF illisible en KV (${id}) : ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}
