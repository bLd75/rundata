import { count } from "./budget.js";
import { UpstreamError } from "./types.js";

export const USER_AGENT = "reunion-temps-reel/0.2 (open source MCP server, real-time data for Reunion Island)"; // header values must be ASCII

async function get(source: string, url: string, timeoutMs: number, headers: Record<string, string> = {}, body?: URLSearchParams | string): Promise<Response> {
  let res: Response;
  count();
  try {
    res = await fetch(url, {
      ...(body ? { method: "POST", body } : {}),
      headers: { "User-Agent": USER_AGENT, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new UpstreamError(source, err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) throw new UpstreamError(source, `HTTP ${res.status}`, res.status);
  return res;
}

export async function getJson<T>(source: string, url: string, timeoutMs = 15_000): Promise<T> {
  return (await get(source, url, timeoutMs)).json() as Promise<T>;
}

export async function getText(
  source: string,
  url: string,
  timeoutMs = 15_000,
  headers?: Record<string, string>,
): Promise<string> {
  return (await get(source, url, timeoutMs, headers)).text();
}

export async function getBytes(
  source: string,
  url: string,
  timeoutMs = 15_000,
  headers?: Record<string, string>,
): Promise<ArrayBuffer> {
  return (await get(source, url, timeoutMs, headers)).arrayBuffer();
}

/** A form posted as a web page's own script would, for the sites whose data has no other door (Vigicrues Réunion). */
export async function postForm<T>(source: string, url: string, fields: Record<string, string>, timeoutMs = 15_000): Promise<T> {
  return (await get(source, url, timeoutMs, {}, new URLSearchParams(fields))).json() as Promise<T>;
}

/** A form posted as is, for a page whose form expects its own encoding (the TÉAT's, in ISO-8859-1); its bytes. */
export async function postBytes(source: string, url: string, body: string, timeoutMs = 15_000, headers: Record<string, string> = {}): Promise<ArrayBuffer> {
  return (await get(source, url, timeoutMs, { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body)).arrayBuffer();
}

/** A JSON body posted, for a service that takes more than a URL holds (the IGN's altitudes of a whole trail). */
export async function postJson<T>(source: string, url: string, body: unknown, timeoutMs = 15_000): Promise<T> {
  return (await get(source, url, timeoutMs, { "Content-Type": "application/json" }, JSON.stringify(body))).json() as Promise<T>;
}
