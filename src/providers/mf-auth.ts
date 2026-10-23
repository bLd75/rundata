/**
 * Access to the Météo-France APIs (portail-api.meteofrance.fr), shared by the observations and the AROME model:
 * one application, one OAuth token per process (or Worker isolate). The portal voids a token as soon as a new one
 * is issued, so each provider taking its own would void the other's.
 */
import { count, perInvocation } from "../budget.js";
import { USER_AGENT } from "../http.js";
import { UpstreamError } from "../types.js";

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

// Reused until 5 minutes before it expires.
let oauth: { value: string; until: number } | undefined;

async function newToken(source: string): Promise<string> {
  let res: Response;
  count();
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
  oauth = { value: j.access_token, until: Date.now() + ((j.expires_in ?? 3600) - 300) * 1000 };
  return j.access_token;
}

/**
 * Authentication for the requests of one question. The token is fetched at most once per question, and renewed
 * at most once: another isolate taking its own token makes ours answer 401. The promises are shared by every
 * Météo-France source of the question (stations, vigilance and radar asked together would otherwise each take a
 * token and void each other's), but never with another request: a Worker must not await another request's I/O.
 */
export function session(source: string) {
  const shared = perInvocation("mf-auth", () => {
    let current: Promise<string> | undefined;
    let renewed: Promise<string> | undefined;
    return {
      token: () => (current ??= oauth && Date.now() < oauth.until ? Promise.resolve(oauth.value) : newToken(source)),
      renew: () => (renewed ??= newToken(source)),
    };
  });
  return { source, ...shared };
}

export type Session = ReturnType<typeof session>;

type Getter<T> = (source: string, url: string, timeoutMs: number, headers: Record<string, string>) => Promise<T>;

/** One authenticated GET, retried once with a new token on a 401. */
export async function download<T>(url: string, s: Session, get: Getter<T>, timeoutMs = 20_000): Promise<T> {
  if (!credentials.applicationId) {
    const headers: Record<string, string> = credentials.apiKey
      ? { apikey: credentials.apiKey }
      : { Authorization: `Bearer ${credentials.token}` };
    return get(s.source, url, timeoutMs, headers);
  }
  try {
    return await get(s.source, url, timeoutMs, { Authorization: `Bearer ${await s.token()}` });
  } catch (err) {
    if (!(err instanceof UpstreamError && err.status === 401)) throw err;
    return get(s.source, url, timeoutMs, { Authorization: `Bearer ${await s.renew()}` });
  }
}
