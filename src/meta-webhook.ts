/**
 * /meta/webhook: where Meta tells rundata.re of what happens on its Facebook Page and Instagram account (a comment, a
 * mention, a message). GET answers Meta's check when the subscription is made: its challenge, given back only with our
 * verify token. POST is an event, kept only when its X-Hub-Signature-256 is the HMAC-SHA256 of its body with the app's
 * secret, compared in constant time.
 *
 * An event is kept as one line of the Worker's log (« meta webhook : … »), read like the others: what changed, on which
 * Page or account, and when; never the text of a comment or a message, nor the name of whoever wrote it, which the
 * Graph API gives to whoever needs them. No KV and no D1: nothing to read back here.
 *
 * Without its two secrets (META_VERIFY_TOKEN, META_APP_SECRET), the address does not exist: a 404, as any other.
 */
import { bodyText } from "./http.js";

export const PATH = "/meta/webhook";
/** Meta's events are small: past this, refused before the signature is computed. */
const MAX_BODY = 256 * 1024;
/** A challenge is a number Meta draws; anything else is not given back. */
const CHALLENGE = /^[\w.-]{1,128}$/;

let verifyToken: string | undefined;
let appSecret: string | undefined;
let key: Promise<CryptoKey> | undefined;

export function configure(verify?: string, secret?: string) {
  verifyToken = verify || undefined;
  appSecret = secret || undefined;
  key = undefined;
}

/** Equal strings, in a time that does not tell how much of them matched. */
export function memes(a: string, b: string): boolean {
  const [x, y] = [new TextEncoder().encode(a), new TextEncoder().encode(b)];
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function signature(body: string): Promise<string> {
  key ??= crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await key, new TextEncoder().encode(body)));
  return `sha256=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

interface Entree {
  id?: unknown;
  time?: unknown;
  changes?: { field?: unknown; value?: { item?: unknown; verb?: unknown } }[];
  messaging?: unknown[];
}

/** What an event says, without its words: the object, then per entry its id, its time and the fields that changed. */
export function resume(event: unknown): { objet: string; entrees: { id: string; time?: number; champs: string[]; messages?: number }[] } | undefined {
  if (!event || typeof event !== "object") return undefined;
  const e = event as { object?: unknown; entry?: unknown };
  if (typeof e.object !== "string" || !Array.isArray(e.entry)) return undefined;
  const court = (x: unknown) => String(x).slice(0, 40);
  return {
    objet: court(e.object),
    entrees: (e.entry as Entree[]).slice(0, 20).map((x) => ({
      id: court(x.id ?? ""),
      ...(typeof x.time === "number" ? { time: x.time } : {}),
      champs: (x.changes ?? []).slice(0, 20).map((c) => [c.field, c.value?.item, c.value?.verb].filter((v) => typeof v === "string").map(court).join(" ")),
      ...(Array.isArray(x.messaging) ? { messages: x.messaging.length } : {}),
    })),
  };
}

const TEXTE = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

/** The answer for /meta/webhook, or undefined while its secrets are not set (the site's 404 then). */
export async function metaWebhook(request: Request): Promise<Response | undefined> {
  if (!verifyToken || !appSecret) return undefined;
  if (request.method === "GET") {
    const q = new URL(request.url).searchParams;
    const challenge = q.get("hub.challenge") ?? "";
    if (q.get("hub.mode") !== "subscribe" || !memes(q.get("hub.verify_token") ?? "", verifyToken) || !CHALLENGE.test(challenge)) {
      return new Response("Forbidden", { status: 403, headers: TEXTE });
    }
    return new Response(challenge, { headers: TEXTE });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { ...TEXTE, allow: "GET, POST" } });
  const body = await bodyText(request, MAX_BODY);
  if (body === undefined) return new Response("Payload too large", { status: 413, headers: TEXTE });
  if (!memes(request.headers.get("x-hub-signature-256") ?? "", await signature(body))) {
    console.warn("meta webhook : signature refusée");
    return new Response("Forbidden", { status: 403, headers: TEXTE });
  }
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {}
  const r = resume(event);
  // Signed but not read: still a 200, or Meta sends it again and again.
  console.log(`meta webhook : ${r ? JSON.stringify(r) : "événement illisible"}`);
  return new Response("EVENT_RECEIVED", { headers: TEXTE });
}
