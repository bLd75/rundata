/**
 * Access to the Météo-France APIs (portail-api.meteofrance.fr), shared by the observations and the AROME model:
 * one application, one OAuth token. The portal voids a token as soon as a new one is issued, so each provider taking
 * its own would void the other's, and so would each Worker isolate: in the Worker the token is kept in KV (`share`),
 * written only when it is renewed, and every isolate keeps it in memory, reading KV only at its first need, once it
 * expires, or after a 401.
 */
import { count, perInvocation } from "../budget.js";
import { USER_AGENT } from "../http.js";
import { UpstreamError, why } from "../types.js";

const TOKEN_URL = "https://portail-api.meteofrance.fr/token";

export interface Credentials {
  /** The application's permanent "Application ID" (base64 of key:secret), traded for one-hour OAuth tokens. */
  applicationId?: string;
  /** The portal's long-lived "API Key", sent as the `apikey` header. */
  apiKey?: string;
  /** A one-hour OAuth token, for trying things out. */
  token?: string;
}

let credentials: Credentials = {};

export function configure(c: Credentials) {
  const next = {
    applicationId: c.applicationId?.trim() || undefined,
    apiKey: c.apiKey?.trim() || undefined,
    token: c.token?.trim() || undefined,
  };
  if (next.applicationId !== credentials.applicationId) oauth = undefined;
  credentials = next;
}

export function enabled(): boolean {
  return Boolean(credentials.applicationId || credentials.apiKey || credentials.token);
}

/** A token and the time (ms) it is reused until: 5 minutes before it expires. */
export interface Token {
  value: string;
  until: number;
}

/** Where the token is shared by every isolate (worker.ts: the Worker's KV). */
export interface TokenStore {
  get(): Promise<Token | null>;
  put(t: Token, ttlSeconds: number): Promise<void>;
}

/** The token's key in KV. */
export const KV_KEY = "meteofrance:jeton";

let oauth: Token | undefined;
let store: TokenStore | undefined;
let issued = 0;
/** Tokens this isolate asked the portal for so far: each one voids the others' (said by the scheduled event's log). */
export const tokensIssued = () => issued;

/** Shares the token through `s` (worker.ts); without it, each isolate keeps its own. */
export function share(s?: TokenStore) {
  store = s;
}

/** The shared token, or null: KV not set, not answering, or holding none. One subrequest. */
async function stored(): Promise<Token | null> {
  if (!store) return null;
  count(1, "read");
  try {
    const t = await store.get();
    return t && typeof t.value === "string" && typeof t.until === "number" ? t : null;
  } catch (err) {
    console.error("jeton Météo-France : KV illisible", why(err));
    return null;
  }
}

/** A token from the portal, written to KV for the other isolates; `reason` is said in the log, to count them. */
async function newToken(source: string, reason: string): Promise<string> {
  let res: Response;
  count();
  issued++;
  console.log(`jeton Météo-France pris (${reason}, ${source})`);
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials.applicationId}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new UpstreamError(source, `jeton : ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new UpstreamError(source, `jeton : HTTP ${res.status}`, res.status);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  const keep = (j.expires_in ?? 3600) - 300;
  oauth = { value: j.access_token, until: Date.now() + keep * 1000 };
  if (store) {
    try {
      count(1, true);
      await store.put(oauth, Math.max(60, keep));
    } catch (err) {
      console.error("jeton Météo-France : écriture KV impossible", why(err));
    }
  }
  return j.access_token;
}

/** The token held in memory, else KV's when it is still good, else a new one. */
async function first(source: string): Promise<string> {
  if (oauth && Date.now() < oauth.until) return oauth.value;
  const kept = await stored();
  if (kept && Date.now() < kept.until) {
    oauth = kept;
    return kept.value;
  }
  return newToken(source, !store ? "sans KV" : kept ? "jeton de KV échu" : "aucun jeton dans KV");
}

/** After a 401 with `failed`: KV's token when another isolate wrote a newer one, else a new one. */
async function after401(source: string, failed: string, fresh: () => Promise<string>): Promise<string> {
  const kept = await stored();
  if (kept && kept.value !== failed && Date.now() < kept.until) {
    oauth = kept;
    console.log(`jeton Météo-France relu dans KV après un 401 (${source})`);
    return kept.value;
  }
  return fresh();
}

/**
 * Authentication for the requests of one question. The token is looked for at most once per question, and a new one
 * taken after a 401 at most once: another isolate taking its own token makes ours answer 401. After a 401, KV is read
 * again first: a token another isolate wrote there is tried before a new one is taken. The promises are shared by
 * every Météo-France source of the question (stations, vigilance and radar asked together would otherwise each take a
 * token and void each other's), but never with another request: a Worker must not await another request's I/O.
 */
export function session(source: string) {
  const shared = perInvocation("mf-auth", () => {
    let current: Promise<string> | undefined;
    let fresh: Promise<string> | undefined;
    const renewals = new Map<string, Promise<string>>();
    const renewed = () => (fresh ??= newToken(source, "après un 401"));
    return {
      token: () => (current ??= first(source)),
      /** The token to try after `failed` was refused: `failed` itself when there is none left to try. */
      renew: (failed: string) => {
        if (!renewals.has(failed)) renewals.set(failed, fresh ? fresh : after401(source, failed, renewed));
        return renewals.get(failed)!;
      },
    };
  });
  return { source, ...shared };
}

export type Session = ReturnType<typeof session>;

type Getter<T> = (source: string, url: string, timeoutMs: number, headers: Record<string, string>) => Promise<T>;

/** One authenticated GET, tried again on a 401 with KV's token if it is newer, then with a new one. */
export async function download<T>(url: string, s: Session, get: Getter<T>, timeoutMs = 20_000): Promise<T> {
  if (!credentials.applicationId) {
    const headers: Record<string, string> = credentials.apiKey
      ? { apikey: credentials.apiKey }
      : { Authorization: `Bearer ${credentials.token}` };
    return get(s.source, url, timeoutMs, headers);
  }
  let token = await s.token();
  for (;;) {
    try {
      return await get(s.source, url, timeoutMs, { Authorization: `Bearer ${token}` });
    } catch (err) {
      if (!(err instanceof UpstreamError && err.status === 401)) throw err;
      const next = await s.renew(token);
      if (next === token) throw err;
      token = next;
    }
  }
}
