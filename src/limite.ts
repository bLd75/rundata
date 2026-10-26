/**
 * How fast one connection may call: the MCP endpoint and the forms' sends, counted by Cloudflare's Rate Limiting
 * binding (wrangler.jsonc `ratelimits`), per address and per Cloudflare location, over a minute. Past it, a 429 with
 * Retry-After, before anything is read or built.
 *
 * The thresholds are far above any real client's (Loki, 7 days to 26/10: at most 164 calls to /mcp in a minute from
 * one User-Agent, Claude Code, which may be several addresses; 66 for Claude-User; 1 send of a form): an assistant's
 * servers send the calls of all their users from a few addresses, and must never be slowed. They stop a script
 * that loops. The counts are approximate (each location counts apart, eventually consistent), which is enough here.
 * Without the binding (Node, the tests, a Worker not given it) or when it fails, nothing is refused.
 */
import { adresseOf } from "./avis.js";
import { withCors } from "./app.js";

/** The part of a Rate Limiting binding used here. */
export interface Limiteur {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}

/** Per address and per minute (the binding's period, wrangler.jsonc). */
export const PAR_MINUTE = { mcp: 600, formulaire: 20 } as const;
export type Sorte = keyof typeof PAR_MINUTE;
export const RETRY_AFTER_S = 60;

const FORMULAIRES = /^\/(?:avis|associations\/.+)$/;

/** What a request counts against, if anything: a POST to /mcp, or a form sent. */
export function sorteDe(request: Request): Sorte | undefined {
  if (request.method !== "POST") return undefined;
  const path = new URL(request.url).pathname;
  if (path === "/mcp") return "mcp";
  return FORMULAIRES.test(path) ? "formulaire" : undefined;
}

// One log line per kind and per minute in an isolate, whatever the refusals: a flood never fills the logs.
const dit = new Map<Sorte, number>();

/** The 429 for `request` when its address went past its kind's threshold; undefined to let it through. */
export async function refuse(request: Request, limiteurs: Partial<Record<Sorte, Limiteur>>, now = Date.now()): Promise<Response | undefined> {
  const sorte = sorteDe(request);
  const limiteur = sorte && limiteurs[sorte];
  const adresse = adresseOf(request.headers);
  if (!sorte || !limiteur || !adresse) return undefined;
  try {
    if ((await limiteur.limit({ key: `${sorte}:${adresse}` })).success) return undefined;
  } catch {
    return undefined; // a limiter that fails must never cost an answer
  }
  if (now - (dit.get(sorte) ?? 0) >= 60_000) {
    dit.set(sorte, now);
    console.warn(`limite de débit : ${sorte}, une adresse au-delà de ${PAR_MINUTE[sorte]} par minute`);
  }
  const headers = { "retry-after": String(RETRY_AFTER_S), "cache-control": "no-store" };
  if (sorte === "mcp") {
    const message = `Too many requests from this address. Retry in ${RETRY_AFTER_S} seconds.`;
    return withCors(Response.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, { status: 429, headers }));
  }
  return new Response(MESSAGE_FORMULAIRE, { status: 429, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
}

/** What a person sees after too many sends from their connection: true, since nothing was read nor kept yet. No threshold is said. */
export const MESSAGE_FORMULAIRE = "Trop d'envois depuis cette connexion en une minute\u00a0: celui-ci n'a pas été gardé. Réessayez dans une minute, ou écrivez à contact@rundata.re.";
