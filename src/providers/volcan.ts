/**
 * The state of the Piton de la Fournaise, from three sources, all without a key:
 * - the prefecture's press releases, which declare each phase of the ORSEC volcano plan (« passage en alerte 1,
 *   fermeture de l'enclos »): the level and the Enclos;
 * - the OVPF-IPGP's own posts on Bluesky (official: monthly bulletins, communiqués, eruption starts and ends), read
 *   through Bluesky's public API, the observatory's website giving no feed: the activity, and a level newer than the
 *   release;
 * - pitonlive.com, an independent site, not official, whose JSON keeps a level and whether it erupts: said only as a
 *   last resort, as its own (the user's decision of 25/10/2026: a raw label, and the deformation said the opposite of
 *   the OVPF's release). No licence is stated: quoted with its name and link.
 */
import { later } from "../budget.js";
import type { Cache, Cached } from "../cache.js";
import { getJson, getText, permis } from "../http.js";
import { noteLecture, noteSource } from "../lectures.js";
import { type SourceInfo, UpstreamError } from "../types.js";
import { decodeText, textOf } from "./avis-eau.js";
import { type Info, SOURCES as NEWS } from "./actualites.js";
import * as prefecture from "./prefecture.js";
import * as copie from "./prefecture-copie.js";

export const PREFECTURE: SourceInfo = NEWS.prefecture;
const PREFECTURE_HOST = "www.reunion.gouv.fr";

export const OVPF: SourceInfo = {
  id: "ovpf_bluesky",
  nom: "Communiqués et bulletins de l'Observatoire volcanologique du Piton de la Fournaise",
  organisme: "OVPF-IPGP",
  licence: "Publications publiques de l'OVPF, citées avec leur lien",
  attribution: "OVPF-IPGP",
  url: "https://bsky.app/profile/ovpf.bsky.social",
};

/** The OVPF's Facebook page, the one the prefecture's alert releases give (« Page Officielle » on it). */
export const OVPF_FACEBOOK = "https://www.facebook.com/ObsVolcanoPitonFournaise";

export const PITONLIVE: SourceInfo = {
  id: "pitonlive",
  nom: "État du volcan (pitonlive.com, site non officiel)",
  organisme: "pitonlive.com, site non officiel",
  licence: "Non précisée : cité avec son nom et son lien",
  attribution: "pitonlive.com",
  url: "https://pitonlive.com",
};

// Also read by the collector of the releases given in images (scripts/ovpf-ocr.ts).
export const FEED =
  "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=did:plc:qzdltnkksm37jcg5jr6rkuas&limit=30&filter=posts_no_replies";
const STATE = "https://pitonlive.com/api/v1/public/state";
const FRESH_SECONDS = 10 * 60;

// Posts about the volcano's activity, not the conferences, job offers or science outreach.
const ACTIVITY = /bulletin|communiqu|éruption|eruption|alerte|vigilance|sismicit|inflation|déflation|intrusion|crise/i;
const NOISE = /offre d.emploi|conférence|fête de la science|jours de feu/i;

export interface Post {
  date: string;
  texte: string;
  lien: string;
  /** A release given in images, without text (or a few words) nor alternative text: `texte` says so, the link leads to it. */
  image?: true;
  /** How many images it is given in, when the feed says. */
  images?: number;
  /** The word or two that come with the images, as written. */
  mots?: string;
  /** The PDF of the observatory's release that the post links to, as published (ovpf-pdf.ts); never guessed. */
  pdf?: string;
}

// A release of the OVPF on the IPGP's site, « …/2026/Communiques/OVPF_20260924_09h00_communique_….pdf »: not the
// monthly bulletins, nor Mayotte's.
const RELEASE_PDF = /^https:\/\/www\.ipgp\.fr\/volcanoweb\/reunion\/Bulletins-Communiques\/\d{4}\/Communiques\/OVPF_\d{8}_[^/]*\.pdf$/i;

/** The link of the release's PDF among the post's links, without what was added to it for tracking (?fbclid=…). */
function releasePdf(facets: Facet[] | undefined): string | undefined {
  for (const f of facets ?? []) {
    for (const x of f.features ?? []) {
      if (x.$type !== "app.bsky.richtext.facet#link" || !x.uri) continue;
      try {
        const u = new URL(x.uri);
        const bare = `${u.origin}${u.pathname}`;
        if (RELEASE_PDF.test(bare)) return bare;
      } catch {
        // not a link
      }
    }
  }
  return undefined;
}

interface Facet {
  features?: { $type?: string; uri?: string }[];
}

/**
 * What is said of a post given in images: how many, and the few words that come with them, quoted; nothing read from
 * the images, not even that it is a release (a photo, a map…). « 3 images, sans texte » (marketing). `lu`: the text of
 * its first image is quoted (ovpf-ocr.ts), the post's own words are then its caption, « sans légende » (marketing).
 */
export function imagesSaid(n: number | undefined, mots?: string, en = false, lu = false): string {
  const count = n === 1 ? "une image" : n ? `${n} images` : en ? "images" : "des images";
  return `${count}, ${mots ? `avec pour ${lu ? "seule légende" : "seul texte"} : « ${mots} »` : lu ? "sans légende" : "sans texte"}`;
}

/** The same on the post's card: « Publication en 3 images, sans texte ». */
export const enImages = (n: number | undefined, mots?: string, lu = false) => `Publication en ${imagesSaid(n, mots, true, lu)}`;

interface FeedJson {
  feed: {
    reason?: unknown;
    post: { uri: string; author: { handle: string }; record: { text: string; createdAt: string; facets?: Facet[] }; embed?: { $type?: string; images?: { alt?: string }[]; items?: unknown[]; media?: { $type?: string; images?: unknown[]; items?: unknown[] } } };
  }[];
}

// An image, a gallery of them, or a quote with images: the post's own media.
const IMAGES = /^app\.bsky\.embed\.(images|gallery)#view$/;
const imagesOf = (e: FeedJson["feed"][number]["post"]["embed"]) => !!e && (IMAGES.test(e.$type ?? "") || IMAGES.test(e.media?.$type ?? ""));
const countOf = (e: FeedJson["feed"][number]["post"]["embed"]) => (e?.images ?? e?.items ?? e?.media?.images ?? e?.media?.items)?.length || undefined;
// A text of a word or two (« 🌋 », « Communiqué OVPF »): the release is in the images.
const fewWords = (text: string) => (text.match(/\p{L}{2,}/gu) ?? []).length < 3;

/**
 * The observatory's own posts about the volcano's activity, newest first. Its releases are often images alone, with
 * no text (« Arrêt crise sismique… Alerte 1 », 24/10; the release of 25/10 08:00, three images) or a word or two: kept
 * as such, since nothing tells them from the others.
 */
export function activityPosts(feed: FeedJson): Post[] {
  return feed.feed
    .filter((f) => !f.reason)
    .flatMap(({ post }): Post[] => {
      const lien = `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split("/").pop()}`;
      const text = post.record.text.replace(/\s+/g, " ").trim();
      if (!text) {
        // An image alone: its alternative text, when there is one, is the observatory's words.
        const alt = (post.embed?.images ?? []).map((i) => i.alt?.trim()).filter(Boolean).join(" ");
        if (alt) return ACTIVITY.test(alt) && !NOISE.test(alt) ? [{ date: post.record.createdAt, texte: alt.replace(/\s+/g, " "), lien }] : [];
      }
      if (imagesOf(post.embed) && (!text || (fewWords(text) && !NOISE.test(text)))) {
        const images = countOf(post.embed);
        return [{ date: post.record.createdAt, texte: enImages(images, text || undefined), lien, image: true, ...(images && { images }), ...(text && { mots: text }) }];
      }
      if (!text) return [];
      const pdf = releasePdf(post.record.facets);
      return ACTIVITY.test(text) && !NOISE.test(text) ? [{ date: post.record.createdAt, texte: text, lien, ...(pdf && { pdf }) }] : [];
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

// What an OVPF text gives of the level: « ▶ Niveau d'alerte : 2.2 », « Alerte 2-1 », « ▶️ Alerte 2-2 en cours ».
const SAID_LEVEL = /niveau\s+d['’]\s*alerte\s*:?\s*(?:alerte\s*)?(\d(?:\s*[.-]\s*\d)?)|\balerte\s+(\d(?:\s*[.-]\s*\d)?)/i;
const END_OF_ALERT = /\b(fin|lev[ée]e)\s+(de\s+l['’]\s*|d['’]\s*)alerte/i;

/** The alert an OVPF text names, as the plan names it (« Alerte 2-2 »), or undefined; never from an end of alert. */
export function levelSaid(text: string): string | undefined {
  if (END_OF_ALERT.test(text)) return undefined;
  const m = SAID_LEVEL.exec(text);
  return m ? levelOf(`alerte ${m[1] ?? m[2]}`) : undefined;
}

// The OVPF's words for an eruption going on, and for its end, read first (« sans lien avec l'éruption qui vient de se
// terminer »). Its texts of February to April 2026: « Eruption en cours au Piton de la Fournaise », « 3e phase de
// l'éruption … toujours en cours », « L'éruption se poursuit », « l'éruption … a repris », « Arrêt de l'éruption ».
const ERUPTING = /[ée]ruption\b[^.!?]{0,60}?\b(?:en\s+cours|se\s+poursuit|continue|a\s+repris)|reprise\s+de\s+l['’]\s*[ée]ruption|d[ée]but\s+d['’]\s*[ée]ruption|arriv[ée]e\s+du\s+magma\s+en\s+surface/i;
const ENDED = /arr[êe]t\s+de\s+l['’]\s*[ée]ruption|[ée]ruption\s+arr[êe]t[ée]e|fin\s+de\s+l['’]\s*[ée]ruption|[ée]ruption\s+qui\s+vient\s+de\s+se\s+terminer/i;
const NONE = /pas\s+d['’]\s*[ée]ruption|aucune\s+[ée]ruption/i;

/** Whether an OVPF text says an eruption goes on (true), has stopped (false), or neither (undefined). */
export function eruptionSaid(text: string): boolean | undefined {
  if (ENDED.test(text)) return false;
  if (NONE.test(text)) return undefined;
  return ERUPTING.test(text) ? true : undefined;
}

export interface PitonState {
  status: { alert_level: string; alert_level_display: string; is_erupting: boolean; published_at?: string };
  eruption: { name?: string; started_at?: string; public_summary?: string } | null;
  last_eruption_ended_at?: string | null;
  days_since_last_eruption?: number | null;
  access?: {
    current?: { available: boolean; global_status: string; enclos_status: string; summary?: string; source_name?: string; source_url?: string; source_timestamp?: string };
  };
}

export async function posts(cache: Cache): Promise<Cached<Post[]>> {
  return cache.island("volcan:ovpf", FRESH_SECONDS, async () => activityPosts(await getJson<FeedJson>(OVPF.id, FEED)));
}

export async function state(cache: Cache): Promise<Cached<PitonState>> {
  const got = await cache.island("volcan:pitonlive", FRESH_SECONDS, async () => {
    const s = await getJson<PitonState>(PITONLIVE.id, STATE);
    // Keep what the tool shows; the full answer carries a daily seismic series and the air quality too.
    return { status: s.status, eruption: s.eruption, last_eruption_ended_at: s.last_eruption_ended_at, days_since_last_eruption: s.days_since_last_eruption, access: s.access };
  });
  // The level as the plan names it, never pitonlive's label (« Alerte 1 - eruption probable ou imminente », unaccented):
  // the plan's words are said beside it, from the plan. On read, so that a copy made before is named so too.
  const display = levelOf(got.value.status.alert_level_display) ?? got.value.status.alert_level_display;
  return { ...got, value: { ...got.value, status: { ...got.value.status, alert_level_display: display } } };
}

/** The level of the ORSEC volcano plan a text names, as the plan names it (« Alerte 2-1 »), or undefined. */
export function levelOf(t: string): string | undefined {
  return /alerte\s*2[\s.-]*3/i.test(t)
    ? "Alerte 2-3"
    : /alerte\s*2[\s.-]*2/i.test(t)
      ? "Alerte 2-2"
      : /alerte\s*2[\s.-]*1/i.test(t)
        ? "Alerte 2-1"
        : /alerte\s*2/i.test(t)
          ? "Alerte 2"
          : /alerte\s*1/i.test(t)
            ? "Alerte 1"
            : /sauvegarde/i.test(t)
              ? "Sauvegarde"
              : /vigilance\s+renforc/i.test(t)
                ? "Vigilance renforcée"
                : /vigilance/i.test(t)
                  ? "Vigilance"
                  : undefined;
}

/** A phase of the ORSEC volcano plan, as the prefecture's latest press release about the volcano declares it. */
export interface Phase {
  niveau: string;
  eruption: boolean;
  enclos?: "ferme" | "partiel" | "ouvert";
  titre: string;
  lien: string;
  /** The day of the release, La Réunion's, « 2026-10-24 »: the prefecture gives no hour, and none is made up. */
  jour: string;
  /** The sentences of the release's page, as written (`releaseText`), kept with the phase. */
  phrases?: string[];
  /**
   * The title of the release's page, as written, when its title in the list does not name the volcano: « Retour en
   * phase de vigilance » in the list, « Piton de la Fournaise : réouverture partielle de l'enclos » on its page (26/10/2026).
   */
  page?: string;
}

/** A release's page: its title and its sentences, as written. */
export interface Page {
  titre?: string;
  phrases: string[];
}

const ABOUT_VOLCANO = /fournaise|volcan|enclos|[ée]ruption/i;
// What a release about another plan says: the cyclone's (« Retour en phase de vigilance » after a cyclone too), the
// weather's (« Vigilance orange fortes pluies »), whose colours the volcano's plan does not use.
const OTHER_PLAN = /cyclon|pr[ée][\s-]?alerte|\b(?:jaune|orange|rouge|violette)\b|pluie|orage|\bvents?\b|houle|vague|canicule|s[ée]cheresse|m[ée]t[ée]o/i;
/** Whether a release is about the volcano by what its list gives: its title, or its address. */
const volcanicByList = (r: Info) => ABOUT_VOLCANO.test(r.titre) || ABOUT_VOLCANO.test(prefecture.slugWords(r.lien));
/**
 * Whether a release's page is about the volcano: its title names it, or its sentences do and none names another plan
 * (a cyclone's release may name the volcano's trails among others).
 */
export const volcanicPage = (p: Page) =>
  (!!p.titre && ABOUT_VOLCANO.test(p.titre)) || (p.phrases.some((x) => ABOUT_VOLCANO.test(x)) && !OTHER_PLAN.test(p.titre ?? "") && !p.phrases.some((x) => OTHER_PLAN.test(x)));

// What a release's title says of the Enclos, longest first: quoted as written, never a status mapped to words.
const ENCLOS_WORDS = /r[ée]?ouverture partielle|partiellement r[ée]?ouvert\p{L}*|partiellement ferm\p{L}*|r[ée]?ouverture|fermeture|interdiction|interdit\p{L}*|r[ée]?ouvert\p{L}*|ferm[ée]\p{L}*/iu;

/** The words of a release's title on the Enclos, as written (« réouverture partielle »), or undefined. */
export function enclosWords(titre: string): string | undefined {
  return ENCLOS_WORDS.exec(titre)?.[0];
}

/** The words of the phase's release on the Enclos: its title's in the list, else its page's. */
export const enclosWordsOf = (p: Phase): string | undefined => enclosWords(p.titre) ?? (p.page ? enclosWords(p.page) : undefined);

/**
 * The phase the newest release about the volcano declares, or undefined when it declares none. `pages`: the pages read
 * of the releases whose list says nothing of the volcano (`doubtful`), by their link.
 */
export function phaseOf(releases: Info[], pages: ReadonlyMap<string, Page> = new Map()): Phase | undefined {
  // The newest release that declares a phase: a later one about the volcano may declare none (a visit, a reminder).
  const about = (r: Info) => volcanicByList(r) || (pages.has(r.lien) && volcanicPage(pages.get(r.lien)!));
  for (const r of releases.filter(about).sort((a, b) => b.publie.localeCompare(a.publie))) {
    const p = declared(r, pages.get(r.lien));
    if (p) return p;
  }
  return undefined;
}

// The pages of releases read at most at each reading of the list, to know whether they are about the volcano.
const DOUBTFUL_MAX = 2;

/**
 * The releases, newer than the newest one the list says is about the volcano and declares a phase, whose title
 * declares a phase without naming the volcano nor another plan (« Retour en phase de vigilance », 26/10/2026): only
 * their page says what they are about. Newest first, `DOUBTFUL_MAX` at most.
 */
export function doubtful(releases: Info[]): Info[] {
  const out: Info[] = [];
  for (const r of [...releases].sort((a, b) => b.publie.localeCompare(a.publie))) {
    if (volcanicByList(r)) {
      if (declared(r)) break;
      continue;
    }
    if (declared(r) && !OTHER_PLAN.test(r.titre)) out.push(r);
    if (out.length === DOUBTFUL_MAX) break;
  }
  return out;
}

/** What words say of the Enclos: reopened in part, reopened, closed; undefined when they say none of it. */
function enclosIn(t: string): Phase["enclos"] {
  return /r[ée]?ouverture partielle|partiellement/i.test(t) ? "partiel" : /r[ée]?ouvert/i.test(t) ? "ouvert" : /fermeture|ferm[ée]/i.test(t) ? "ferme" : undefined;
}

/**
 * What the sentences of a release say of the Enclos: « L'accès à l'enclos du volcan est de nouveau autorisé […] sous
 * réserve du respect des restrictions suivantes » (26/10/2026) is a partial reopening. Undefined when none says.
 */
export function enclosInText(phrases: string[]): Phase["enclos"] {
  const said = phrases.filter((x) => /enclos/i.test(x));
  if (said.some((x) => /r[ée]?ouverture partielle|partiellement/i.test(x))) return "partiel";
  const open = said.find((x) => /autoris|r[ée]?ouvert/i.test(x) && !/interdit|ferm/i.test(x));
  if (open) return /sous r[ée]serve|uniquement|restriction/i.test(open) || said.some((x) => /interdit|ferm/i.test(x)) ? "partiel" : "ouvert";
  return said.some((x) => /interdit|ferm/i.test(x)) ? "ferme" : undefined;
}

function declared(r: Info, page?: Page): Phase | undefined {
  const t = r.titre;
  // The end of the alert names it (« fin de l'alerte 1 ») and is a return to vigilance: read first.
  const niveau = /\b(fin|lev[ée]e)\s+(de\s+l['’]\s*|d['’]\s*)alerte/i.test(t) ? "Vigilance" : levelOf(t);
  if (!niveau) return undefined;
  const eruption = /^Alerte 2/.test(niveau) || /[ée]ruption en cours|d[ée]but d.[ée]ruption/i.test(t);
  // The title's words, else its page's when it was read, title then text; in alert the Enclos is closed by order.
  // Sauvegarde too: the eruption over, the Enclos stays closed until an order reopens it (DSO 2021, p. 27).
  const enclos =
    enclosIn(t) ??
    (page && ((page.titre && enclosIn(page.titre)) || enclosInText(page.phrases))) ??
    (/^(Alerte|Sauvegarde)/.test(niveau) ? "ferme" : undefined);
  return { niveau, eruption, enclos, titre: t, lien: r.lien, jour: localDay(r.publie), ...(page?.titre && !volcanicByList(r) && { page: page.titre }) };
}

/** The day of La Réunion of an instant, « 2026-10-24 ». */
const localDay = (iso: string) => new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 10);

/** A phase kept or cached by an earlier version, its day an instant (`publie`, noon of La Réunion), given its `jour`. */
function withDay(p: Phase & { publie?: string }): Phase {
  if (p.jour || !p.publie) return p;
  const { publie, ...rest } = p;
  return { ...rest, jour: localDay(publie) };
}

/** The first instant of the release's day: what is more recent than a release is so from its day's start. */
export const dayStart = (jour: string) => Date.parse(`${jour}T00:00:00+04:00`);

// The last phase the prefecture declared, kept in the durable store (the Worker's KV), whose keys outlive a deploy: a
// cold cache, a prefecture slow or down, or a release gone from its list of the latest must never leave the level
// unknown.
const LAST_PHASE = "volcan:prefecture:derniere-phase";
// The durable store forgets its keys after a few days (kv.ts): the phase is kept again once a day.
const KEEP_AGAIN_MS = 24 * 3600_000;
// What this isolate's cache knows of the kept phase, read at most this often (a subrequest each).
const KEPT_MEMORY_MS = 5 * 60_000;
const known = new WeakMap<Cache, { phase: Cached<Phase> | undefined; at: number }>();

async function keptPhase(cache: Cache, now: number): Promise<Cached<Phase> | undefined> {
  const k = known.get(cache);
  if (k && now - k.at < KEPT_MEMORY_MS) return k.phase;
  const kept = await cache.kept<Phase>(LAST_PHASE).catch(() => undefined);
  const phase = kept && { ...kept, value: withDay(kept.value) };
  known.set(cache, { phase, at: now });
  return phase;
}

/** Keeps `p` when it is not what is kept, or what is kept is old. */
async function keepPhase(cache: Cache, p: Phase, now: number) {
  const k = await keptPhase(cache, now);
  // The release's sentences kept go on with it while it is the same release.
  const merged: Phase = { ...p, ...(!p.phrases && k?.value.lien === p.lien && k.value.phrases && { phrases: k.value.phrases }) };
  if (k && JSON.stringify(k.value) === JSON.stringify(merged) && now - k.fetchedAt.getTime() < KEEP_AGAIN_MS) return;
  await cache.keep(LAST_PHASE, merged);
  known.set(cache, { phase: { value: merged, fetchedAt: new Date(now), stale: true }, at: now });
}

// The release's page is read again at most this often: it may be updated (« Mis à jour le »), the phase staying.
const RELEASE_SECONDS = 30 * 60;

/**
 * The sentences of a release's page, its body only (the lead and the paragraphs under the title, before the side
 * menu), as written: the words split by markup (« sp</b><b>é</b><b>cifique ») joined again.
 */
export function releaseSentences(html: string): string[] {
  const start = html.search(/<h1[\s>]/i);
  if (start < 0) return [];
  const rest = html.slice(start);
  const end = rest.search(/<nav class="fr-sidemenu|<div class="fr-col-12 fr-col-md-4"|Partager la page|En compl[ée]ment/i);
  let body = end < 0 ? rest : rest.slice(0, end);
  const h1 = body.search(/<\/h1>/i);
  body = h1 < 0 ? body : body.slice(h1 + 5);
  // The tags dropped character by character and the entities decoded once, « &amp; » never read twice (avis-eau.ts);
  // a script or a style, had the page one there, dropped whole before.
  const text = decodeText(textOf(dropBlocks(body)));
  return text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !/^Mis à jour le/i.test(l) && !/^\d{2}\/\d{2}\/\d{4}$/.test(l))
    // A sentence ends at a full stop followed by a capital: « … interdit jusqu'à nouvel ordre. La RN 2 … ».
    .flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ«])/))
    .map((x) => x.trim())
    .filter(Boolean);
}

/** `html` without its <script> and <style> blocks, found by position rather than by a pattern. */
function dropBlocks(html: string): string {
  let out = html;
  for (const name of ["script", "style"]) {
    for (let at = out.toLowerCase().indexOf(`<${name}`); at >= 0; at = out.toLowerCase().indexOf(`<${name}`, at)) {
      const close = out.toLowerCase().indexOf(`</${name}`, at);
      const stop = close < 0 ? -1 : out.indexOf(">", close);
      out = out.slice(0, at) + (stop < 0 ? "" : out.slice(stop + 1));
    }
  }
  return out;
}

/** The title of a release's page, as written: « Piton de la Fournaise : réouverture partielle de l'enclos ». */
export function pageTitle(html: string): string | undefined {
  const m = /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i.exec(html);
  const t = m && decodeText(textOf(m[1])).replace(/\s+/g, " ").trim();
  return t || undefined;
}

/** What is kept of a release's page in the durable store: the page as last read, and when. */
interface PageKept {
  page?: Page;
  /** When the page was read (ms); before the last try when that try failed. */
  lu?: number;
}

// reunion.gouv.fr bans our address on bursts. The scheduled event runs in a new isolate each time, often in another
// data center, so neither the isolate's memory nor the data center's cache sees the page read five minutes before
// (26/10/2026: the release in force read 187 times in 24 h, for 48 at most). What was read is kept in the durable
// store (the Worker's KV), with the time of the last try in its entry: the page is asked again only once that try is
// older than the freshness asked, whichever isolate or data center asks, a failure as well as a read.
const PAGE_KEY = (lien: string) => `volcan:communique:page:${lien}`;
type Known = PageKept & { essai: number };
// What this isolate knows of each page, with the time of the last try: KV is asked again only once that is old. Two
// questions at once share one try.
const pagesKnown = new WeakMap<Cache, Map<string, Known | Promise<Known>>>();

/** A release's page, its title and its sentences: read again only once the last try is `freshSeconds` old. */
async function releasePage(cache: Cache, lien: string, now: number, freshSeconds = RELEASE_SECONDS): Promise<Cached<Page>> {
  if (copie.configured()) return copiedPage(cache, lien, now);
  const key = PAGE_KEY(lien);
  let mine = pagesKnown.get(cache);
  if (!mine) pagesKnown.set(cache, (mine = new Map()));
  // A failed try is tried again after the half hour, whatever the freshness asked (the subject: a week).
  const fresh = (k: Known | undefined) => !!k && now - k.essai < (k.page ? freshSeconds : Math.min(freshSeconds, RELEASE_SECONDS)) * 1000;
  let error: unknown;
  const known = mine.get(key);
  let k = known instanceof Promise ? await known : known;
  if (!fresh(k)) {
    const had = k;
    const trying = (async (): Promise<Known> => {
      const kept = await cache.kept<PageKept>(key).catch(() => undefined);
      const last = kept && (!had || kept.fetchedAt.getTime() > had.essai) ? { ...kept.value, essai: kept.fetchedAt.getTime() } : had;
      if (last && fresh(last)) return last;
      let tried: Known;
      try {
        tried = { page: await readReleasePage(lien), lu: now, essai: now };
      } catch (err) {
        error = err;
        tried = { ...last, essai: now };
      }
      // After the answer: the answer never waits for the durable store.
      later(cache.keep(key, { ...(tried.page && { page: tried.page, lu: tried.lu }) } satisfies PageKept).catch((err) => console.error("volcan : page du communiqué non gardée", err)));
      return tried;
    })();
    mine.set(key, trying);
    k = await trying;
    mine.set(key, k);
  }
  if (!k?.page) throw error ?? new UpstreamError(PREFECTURE.id, "communiqué non lu à la dernière tentative");
  // The last try failed: the page as last read, said so.
  const stale = k.lu !== k.essai;
  noteLecture({ key, fetchedAt: k.lu ?? k.essai, stale, freshSeconds, ...(stale && { source: PREFECTURE.id }), from: PREFECTURE.id });
  return { value: k.page, fetchedAt: new Date(k.lu ?? k.essai), stale, ...(stale && { source: PREFECTURE.id }), from: PREFECTURE.id };
}

// What this isolate knows of each page's copy, asked of the store again after the half hour (RELEASE_SECONDS), or
// after KEPT_MEMORY_MS when it has none yet (a new release, copied at the collector's next run).
const copiesKnown = new WeakMap<Cache, Map<string, { k: copie.PageCopie | null; at: number }>>();

/**
 * In the Worker, a release's page as the collector read it (prefecture-copie.ts), never the site, which cuts the
 * Workers' connection. Renewed once a day (PAGE_AGAIN_MS): its read is not the answer's freshness, and is old only
 * when the collector did not renew it.
 */
async function copiedPage(cache: Cache, lien: string, now: number): Promise<Cached<Page>> {
  let mine = copiesKnown.get(cache);
  if (!mine) copiesKnown.set(cache, (mine = new Map()));
  let known = mine.get(lien);
  if (!known || now - known.at >= (known.k ? RELEASE_SECONDS * 1000 : KEPT_MEMORY_MS)) {
    known = { k: await copie.page(lien).catch(() => null), at: now };
    mine.set(lien, known);
  }
  const k = known.k;
  if (!k?.page) throw new UpstreamError(PREFECTURE.id, "page du communiqué pas encore copiée");
  const stale = now - k.lu > copie.PAGE_AGAIN_MS + copie.SILENT_MS;
  const from = { ...(stale && { source: PREFECTURE.id }), from: PREFECTURE.id };
  noteLecture({ key: copie.pageKey(lien), fetchedAt: k.lu, stale, freshSeconds: copie.PAGE_AGAIN_MS / 1000, ...from });
  return { value: k.page, fetchedAt: new Date(k.lu), stale, ...from };
}

/** Reads a release's page: its title and its sentences. `get`: how a page is asked (the collector's, at its pace). */
export async function readReleasePage(lien: string, get = (url: string) => getText(PREFECTURE.id, url, 12_000, { "User-Agent": "rundata.re (contact@rundata.re)" })): Promise<Page> {
  // Only the prefecture's own pages: a link planted in its list is never read.
  if (!permis(PREFECTURE.id, lien, [PREFECTURE_HOST])) throw new UpstreamError(PREFECTURE.id, "communiqué hors du site de la préfecture");
  const html = await get(lien);
  const phrases = releaseSentences(html);
  if (!phrases.length) throw new UpstreamError(PREFECTURE.id, "communiqué sans texte");
  const titre = pageTitle(html);
  // What is read, to check it on the real pages (the extraction is built on one capture).
  console.log(`volcan : communiqué lu (${lien}) : ${phrases.length} phrases : ${phrases.map((x) => `« ${x} »`).join(" ")}, titre de la page : « ${titre ?? ""} »`);
  return { ...(titre && { titre }), phrases };
}

// Whether a release is about the volcano does not change: its page read once a week at most for that (once in the
// durable store's days, kv.ts, when it is not the release in force, whose page is read every half hour).
const SUBJECT_SECONDS = 7 * 24 * 3600;

/** The page of a release whose list says nothing of the volcano when it is about it, else null. */
async function volcanicRelease(cache: Cache, lien: string, now: number): Promise<Page | null> {
  const page = (await releasePage(cache, lien, now, SUBJECT_SECONDS)).value;
  return volcanicPage(page) ? page : null;
}

/** The sentences of the release `p`, read from its page every half hour; those kept with the phase if it does not answer. */
export async function releaseText(cache: Cache, p: Phase, now = Date.now()): Promise<string[] | undefined> {
  try {
    const c = await releasePage(cache, p.lien, now);
    const value = c.value.phrases;
    if (!c.stale) later(keepPhase(cache, { ...p, phrases: value }, now).catch((err) => console.error("volcan : communiqué non gardé", err)));
    return value;
  } catch {
    if (p.phrases) return p.phrases;
    const k = await keptPhase(cache, now);
    return k?.value.lien === p.lien ? k.value.phrases : undefined;
  }
}

// The phase read from the list, five minutes. Named anew when what is read changes (26/10/2026: a release whose page
// alone names the volcano), so that the phase a former version read is not served after the deploy.
export const PHASE_KEY = "volcan:prefecture:phase";

async function readPhase(cache: Cache, now: number): Promise<Cached<Phase | null>> {
  return cache.get(PHASE_KEY, 5 * 60, async () => {
    // Read from the prefecture's releases, through their own keys: named so that its copy says whose it is.
    noteSource(PREFECTURE.id);
    const releases = (await prefecture.releases(cache)).value;
    // A page without its list (an error page served as 200, a maintenance page) must not replace the last phase read.
    if (!releases.length) throw new UpstreamError(PREFECTURE.id, "liste des communiqués vide");
    // A release whose list says nothing of the volcano, its page read to know; unread, the phase is not read either
    // (the last one kept is said with its day), rather than an older release's taken for the latest.
    const pages = new Map<string, Page>();
    for (const r of doubtful(releases)) {
      const page = await volcanicRelease(cache, r.lien, now);
      if (page) pages.set(r.lien, page);
    }
    const p = phaseOf(releases, pages);
    if (!p) console.log(`volcan : aucune phase ORSEC dans les ${releases.length} communiqués de la préfecture`);
    return p ?? null;
  });
}

/**
 * The phase of the newest release that declares one; else the last phase kept, as old as it is (tools/volcan.ts
 * `officiel` lets a newer, higher level of the OVPF's texts win over it). Throws only when neither is there.
 */
export async function phase(cache: Cache, now = Date.now()): Promise<Cached<Phase | null>> {
  const read = await readPhase(cache, now).catch((err: unknown) => ({ err }));
  if ("value" in read && read.value) {
    const p = withDay(read.value);
    // After the answer: the answer never waits for the durable store.
    if (!read.stale) later(keepPhase(cache, p, now).catch((err) => console.error("volcan : phase non gardée", err)));
    return { ...read, value: p };
  }
  const kept = await keptPhase(cache, now);
  // The releases read, none declaring a phase: the kept one is not a copy for a silent source (tools/volcan.ts says
  // the prefecture read on it).
  if (kept) return "err" in read || read.stale ? kept : { ...kept, stale: false };
  if ("err" in read) throw read.err;
  return read;
}
