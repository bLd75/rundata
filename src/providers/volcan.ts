/**
 * The state of the Piton de la Fournaise, from two sources, both without a key:
 * - the OVPF-IPGP's own posts on Bluesky (official: monthly bulletins, communiqués, eruption starts and ends),
 *   read through Bluesky's public API; the observatory's website gives no feed;
 * - pitonlive.com, an independent site that keeps the alert level, the eruption under way and the access to the
 *   Enclos (from the prefecture's orders) as JSON. No licence is stated: quoted with its name and link, and
 *   always next to the official sources.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";

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
}

interface FeedJson {
  feed: { reason?: unknown; post: { uri: string; author: { handle: string }; record: { text: string; createdAt: string } } }[];
}

/** The observatory's own posts about the volcano's activity, newest first. */
export function activityPosts(feed: FeedJson): Post[] {
  return feed.feed
    .filter((f) => !f.reason && ACTIVITY.test(f.post.record.text) && !NOISE.test(f.post.record.text))
    .map(({ post }) => ({
      date: post.record.createdAt,
      texte: post.record.text.replace(/\s+/g, " ").trim(),
      lien: `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split("/").pop()}`,
    }))
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
  deformation?: { available: boolean; label?: string; published_at?: string };
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
