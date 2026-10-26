import { AsyncLocalStorage } from "node:async_hooks";
import { count, countRead, perInvocation } from "./budget.js";
import { noteSource } from "./lectures.js";
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

/**
 * Whether a link found in a third party's page may be followed: in https, to one of `hosts`. A page of that site gone
 * bad (a hacked site, a link planted in it) must never send the Worker to read elsewhere. A link refused is said in the
 * log, by its host only.
 */
export function permis(source: string, lien: string, hosts: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(lien);
  } catch {
    return false;
  }
  if (u.protocol === "https:" && hosts.includes(u.host)) return true;
  console.warn(`${source} : lien hors de ${hosts.join(", ")} ignoré (${u.protocol === "https:" ? u.host : u.protocol})`);
  return false;
}

/**
 * A request's body as text, read up to `max` bytes; undefined past them, the rest left unread. `content-length` is
 * only a first check: a body sent in chunks has none, and is counted as it comes.
 */
export async function bodyText(request: Request, max: number): Promise<string | undefined> {
  if (Number(request.headers.get("content-length") ?? 0) > max) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
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
  /** The places taken and the fetches waiting for one, now. */
  now() {
    return { taken: this.busy, waiting: this.waiting.length };
  }
}

// Told when a fetch of the work it runs gets its place (`whenPlaced`).
const placed = new AsyncLocalStorage<() => void>();

/**
 * Runs `work`, calling `held` each time one of its fetches gets its place: tools/agenda.ts counts an agenda's delay
 * from then, in the scheduled event, rather than from its call.
 */
export function whenPlaced<T>(work: () => T, held: () => void): T {
  return placed.run(held, work);
}

// The least delay of the fetches of the work it runs (`patiently`).
const patience = new AsyncLocalStorage<number>();

/**
 * Runs `work`, each of its fetches given at least `ms` (from its place) whatever its own delay: tools/agenda.ts gives
 * the scheduled event's agendas, which nobody waits for, as long as a slow site takes.
 */
export function patiently<T>(ms: number, work: () => T): T {
  return patience.run(ms, work);
}

/** This invocation's fetches holding a place and waiting for one, now (web/mesure.ts). */
export const places = () => perInvocation("http:places", () => new Places()).now();

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
  countRead(source);
  noteSource(source);
  const places = perInvocation("http:places", () => new Places());
  await places.take();
  placed.getStore()?.();
  try {
    let res: Response;
    const signal = AbortSignal.timeout(Math.max(timeoutMs, patience.getStore() ?? 0));
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
