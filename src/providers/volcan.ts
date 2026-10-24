/**
 * The state of the Piton de la Fournaise, from two sources, both without a key:
 * - the OVPF-IPGP's own posts on Bluesky (official: monthly bulletins, communiqués, eruption starts and ends),
 *   read through Bluesky's public API; the observatory's website gives no feed;
 * - pitonlive.com, an independent site that keeps the alert level, the eruption under way and the access to the
 *   Enclos (from the prefecture's orders) as JSON. No licence is stated: quoted with its name and link, and
 *   always next to the official sources.
 * - the prefecture's press releases, which declare each phase of the ORSEC volcano plan (« passage en alerte 1,
 *   fermeture de l'enclos ») before either of the two above says so: the newest one about the volcano wins over
 *   pitonlive when it is as recent or more.
 */
import { later } from "../budget.js";
import type { Cache, Cached } from "../cache.js";
import { getJson, getText } from "../http.js";
import { type SourceInfo, UpstreamError } from "../types.js";
import { decodeText, textOf } from "./avis-eau.js";
import { type Info, SOURCES as NEWS } from "./actualites.js";
import * as prefecture from "./prefecture.js";

export const PREFECTURE: SourceInfo = NEWS.prefecture;

export const OVPF: SourceInfo = {
  id: "ovpf_bluesky",
  nom: "Communiqués et bulletins de l'Observatoire volcanologique du Piton de la Fournaise",
  organisme: "OVPF-IPGP",
  licence: "Publications publiques de l'OVPF, citées avec leur lien",
  attribution: "OVPF-IPGP",
  url: "https://bsky.app/profile/ovpf.bsky.social",
};

export const PITONLIVE: SourceInfo = {
  id: "pitonlive",
  nom: "État du volcan et accès à l'Enclos (pitonlive.com)",
  organisme: "pitonlive.com, site indépendant",
  licence: "Non précisée : cité avec son nom et son lien",
  attribution: "pitonlive.com",
  url: "https://pitonlive.com",
};

const FEED =
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
  /** A release given as an image only, without text nor alternative text: `texte` says so, the link leads to it. */
  image?: true;
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

/** What is said of a post given as an image only: neither read from the image nor copied. */
export const IMAGE_SEULE = "Communiqué en image (sans texte)";

interface FeedJson {
  feed: {
    reason?: unknown;
    post: { uri: string; author: { handle: string }; record: { text: string; createdAt: string; facets?: Facet[] }; embed?: { $type?: string; images?: { alt?: string }[]; media?: { $type?: string } } };
  }[];
}

// An image, a gallery of them, or a quote with images: the post's own media.
const IMAGES = /^app\.bsky\.embed\.(images|gallery)#view$/;
const imagesOf = (e: FeedJson["feed"][number]["post"]["embed"]) => !!e && (IMAGES.test(e.$type ?? "") || IMAGES.test(e.media?.$type ?? ""));

/**
 * The observatory's own posts about the volcano's activity, newest first. Its releases are often an image alone, with
 * no text (« Arrêt crise sismique… Alerte 1 », 24/10): kept as such, since nothing tells them from the others.
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
        return imagesOf(post.embed) ? [{ date: post.record.createdAt, texte: IMAGE_SEULE, lien, image: true }] : [];
      }
      const pdf = releasePdf(post.record.facets);
      return ACTIVITY.test(text) && !NOISE.test(text) ? [{ date: post.record.createdAt, texte: text, lien, ...(pdf && { pdf }) }] : [];
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface PitonState {
  status: { alert_level: string; alert_level_display: string; is_erupting: boolean; published_at?: string };
  eruption: { name?: string; started_at?: string; public_summary?: string } | null;
  last_eruption_ended_at?: string | null;
  days_since_last_eruption?: number | null;
  access?: {
    current?: { available: boolean; global_status: string; enclos_status: string; summary?: string; source_name?: string; source_url?: string; source_timestamp?: string };
  };
  deformation?: { available: boolean; label?: string; published_at?: string; source_name?: string };
}

export async function posts(cache: Cache): Promise<Cached<Post[]>> {
  return cache.get("volcan:ovpf", FRESH_SECONDS, async () => activityPosts(await getJson<FeedJson>(OVPF.id, FEED)));
}

export async function state(cache: Cache): Promise<Cached<PitonState>> {
  return cache.get("volcan:pitonlive", FRESH_SECONDS, async () => {
    const s = await getJson<PitonState>(PITONLIVE.id, STATE);
    // Keep what the tool shows; the full answer carries a daily seismic series and the air quality too.
    return { status: s.status, eruption: s.eruption, last_eruption_ended_at: s.last_eruption_ended_at, days_since_last_eruption: s.days_since_last_eruption, access: s.access, deformation: s.deformation };
  });
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
}

const ABOUT_VOLCANO = /fournaise|volcan|enclos|[ée]ruption/i;

// What a release's title says of the Enclos, longest first: quoted as written, never a status mapped to words.
const ENCLOS_WORDS = /r[ée]?ouverture partielle|partiellement r[ée]?ouvert\p{L}*|partiellement ferm\p{L}*|r[ée]?ouverture|fermeture|interdiction|interdit\p{L}*|r[ée]?ouvert\p{L}*|ferm[ée]\p{L}*/iu;

/** The words of a release's title on the Enclos, as written (« réouverture partielle »), or undefined. */
export function enclosWords(titre: string): string | undefined {
  return ENCLOS_WORDS.exec(titre)?.[0];
}

/** The phase the newest release about the volcano declares, or undefined when it declares none. */
export function phaseOf(releases: Info[]): Phase | undefined {
  // The newest release that declares a phase: a later one about the volcano may declare none (a visit, a reminder).
  for (const r of releases.filter((x) => ABOUT_VOLCANO.test(x.titre)).sort((a, b) => b.publie.localeCompare(a.publie))) {
    const p = declared(r);
    if (p) return p;
  }
  return undefined;
}

function declared(r: Info): Phase | undefined {
  const t = r.titre;
  // The end of the alert names it (« fin de l'alerte 1 ») and is a return to vigilance: read first.
  const niveau = /\b(fin|lev[ée]e)\s+(de\s+l['’]\s*|d['’]\s*)alerte/i.test(t)
    ? "Vigilance"
    : /alerte\s*2[\s.-]*3/i.test(t)
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
  if (!niveau) return undefined;
  const eruption = /^Alerte 2/.test(niveau) || /[ée]ruption en cours|d[ée]but d.[ée]ruption/i.test(t);
  // In alert the Enclos is closed by order; a release may say otherwise in its own words.
  const enclos = /r[ée]?ouverture partielle|partiellement/i.test(t)
    ? "partiel"
    : /r[ée]?ouvert/i.test(t)
      ? "ouvert"
      // Sauvegarde too: the eruption over, the Enclos stays closed until an order reopens it (DSO 2021, p. 27).
      : /fermeture|ferm[ée]/i.test(t) || /^(Alerte|Sauvegarde)/.test(niveau)
        ? "ferme"
        : undefined;
  return { niveau, eruption, enclos, titre: t, lien: r.lien, jour: localDay(r.publie) };
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
// cold cache, a prefecture slow or down, or a release gone from its list of the latest must never leave pitonlive's
// level alone, which follows the prefecture by hours or days.
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

/** The sentences of the release `p`, read from its page every half hour; those kept with the phase if it does not answer. */
export async function releaseText(cache: Cache, p: Phase, now = Date.now()): Promise<string[] | undefined> {
  try {
    const c = await cache.get(`volcan:communique:${p.lien}`, RELEASE_SECONDS, async () => {
      const phrases = releaseSentences(await getText(PREFECTURE.id, p.lien, 12_000, { "User-Agent": "rundata.re (contact@rundata.re)" }));
      if (!phrases.length) throw new UpstreamError(PREFECTURE.id, "communiqué sans texte");
      // What is read, to check it on the real pages (the extraction is built on one capture).
      console.log(`volcan : communiqué lu (${p.lien}) : ${phrases.length} phrases : ${phrases.map((x) => `« ${x} »`).join(" ")}`);
      return phrases;
    });
    if (!c.stale) later(keepPhase(cache, { ...p, phrases: c.value }, now).catch((err) => console.error("volcan : communiqué non gardé", err)));
    return c.value;
  } catch {
    if (p.phrases) return p.phrases;
    const k = await keptPhase(cache, now);
    return k?.value.lien === p.lien ? k.value.phrases : undefined;
  }
}

async function readPhase(cache: Cache): Promise<Cached<Phase | null>> {
  return cache.get("volcan:prefecture", 5 * 60, async () => {
    const releases = (await prefecture.releases(cache)).value;
    // A page without its list (an error page served as 200, a maintenance page) must not replace the last phase read.
    if (!releases.length) throw new UpstreamError(PREFECTURE.id, "liste des communiqués vide");
    const p = phaseOf(releases);
    if (!p) console.log(`volcan : aucune phase ORSEC dans les ${releases.length} communiqués de la préfecture`);
    return p ?? null;
  });
}

/**
 * The phase of the newest release that declares one; else the last phase kept, as old as it is (tools/volcan.ts
 * `official` lets a newer status of pitonlive win over it). Throws only when neither is there.
 */
export async function phase(cache: Cache, now = Date.now()): Promise<Cached<Phase | null>> {
  const read = await readPhase(cache).catch((err: unknown) => ({ err }));
  if ("value" in read && read.value) {
    const p = withDay(read.value);
    // After the answer: the answer never waits for the durable store.
    if (!read.stale) later(keepPhase(cache, p, now).catch((err) => console.error("volcan : phase non gardée", err)));
    return { ...read, value: p };
  }
  const kept = await keptPhase(cache, now);
  if (kept) return kept;
  if ("err" in read) throw read.err;
  return read;
}
