import { count, perInvocation } from "./budget.js";
import { UpstreamError } from "./types.js";

/** A link read from a source, kept only as an absolute http(s) address: `javascript:`, `data:`, a relative link or « //hote » give no link. */
export function httpUrl(raw: string | undefined): string | undefined {
  const s = raw?.trim();
  if (!s || !/^https?:\/\/[^/]/i.test(s)) return undefined;
  try {
    new URL(s);
    return s;
  } catch {
    return undefined;
  }
}

export const USER_AGENT = "reunion-temps-reel/0.2 (open source MCP server, real-time data for Reunion Island)"; // header values must be ASCII

/**
 * The fetches an invocation has in flight at once. The platform opens six connections at a time and queues the next
 * ones, those of KV and D1 included; a fetch's timeout ran from its call, so that a source behind six slow ones was cut
 * while it still waited for its turn (a dozen agendas « trop lente » at the same second, on a cold page of events).
 * Here a fetch first waits for its place, and its timeout starts once it has it, its body read included; one place is
 * left to the stores. Outside a counted invocation (Node, tests) nothing waits.
 */
export const IN_FLIGHT = 5;

class Places {
  private busy = 0;
  private waiting: (() => void)[] = [];
  take(): Promise<void> {
    if (this.busy < IN_FLIGHT) {
      this.busy++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }
  give() {
    const next = this.waiting.shift();
    if (next) next();
    else this.busy--;
  }
}

/** Told of each failed read (worker.ts: the sites that do not answer, sans-reponse.ts); the refused budget is not one. */
let onFailure: ((source: string, url: string, err: UpstreamError) => void) | undefined;
export function whenFailed(f: typeof onFailure) {
  onFailure = f;
}

/** Told of each read as it leaves (worker.ts: the morning's recheck asks a host only once this isolate has left it alone). */
let onRead: ((url: string) => void) | undefined;
export function whenRead(f: typeof onRead) {
  onRead = f;
}

async function get<T>(
  source: string,
  url: string,
  timeoutMs: number,
  read: (res: Response) => Promise<T>,
  headers: Record<string, string> = {},
  body?: URLSearchParams | string,
): Promise<T> {
  count();
  const places = perInvocation("http:places", () => new Places());
  await places.take();
  try {
    let res: Response;
    const signal = AbortSignal.timeout(timeoutMs);
    onRead?.(url);
    try {
      res = await fetch(url, {
        ...(body ? { method: "POST", body } : {}),
        headers: { "User-Agent": USER_AGENT, ...headers },
        signal,
      });
    } catch (err) {
      const failed = new UpstreamError(source, err instanceof Error ? err.message : String(err));
      onFailure?.(source, url, failed);
      throw failed;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      const failed = new UpstreamError(source, `HTTP ${res.status}`, res.status);
      onFailure?.(source, url, failed);
      throw failed;
    }
    return await read(res);
  } finally {
    places.give();
  }
}

export async function getJson<T>(source: string, url: string, timeoutMs = 15_000): Promise<T> {
  return get(source, url, timeoutMs, (res) => res.json() as Promise<T>);
}

export async function getText(
  source: string,
  url: string,
  timeoutMs = 15_000,
  headers?: Record<string, string>,
): Promise<string> {
  return get(source, url, timeoutMs, (res) => res.text(), headers);
}

export async function getBytes(
  source: string,
  url: string,
  timeoutMs = 15_000,
  headers?: Record<string, string>,
): Promise<ArrayBuffer> {
  return get(source, url, timeoutMs, (res) => res.arrayBuffer(), headers);
}

/** A form posted as a web page's own script would, for the sites whose data has no other door (Vigicrues Réunion). */
export async function postForm<T>(source: string, url: string, fields: Record<string, string>, timeoutMs = 15_000): Promise<T> {
  return get(source, url, timeoutMs, (res) => res.json() as Promise<T>, {}, new URLSearchParams(fields));
}

/** A form posted as is, for a page whose form expects its own encoding (the TÉAT's, in ISO-8859-1); its bytes. */
export async function postBytes(source: string, url: string, body: string, timeoutMs = 15_000, headers: Record<string, string> = {}): Promise<ArrayBuffer> {
  return get(source, url, timeoutMs, (res) => res.arrayBuffer(), { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body);
}

/** A JSON body posted, for a service that takes more than a URL holds (the IGN's altitudes of a whole trail). */
export async function postJson<T>(source: string, url: string, body: unknown, timeoutMs = 15_000): Promise<T> {
  return get(source, url, timeoutMs, (res) => res.json() as Promise<T>, { "Content-Type": "application/json" }, JSON.stringify(body));
}
