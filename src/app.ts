/**
 * The HTTP face of the server, shared by the Node entry point and the Cloudflare Worker: POST /mcp is the MCP
 * endpoint (streamable HTTP, stateless, JSON responses); everything else is the web site (web/site.ts), except that
 * a command-line client asking for / gets one line saying what this is.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Cache } from "./cache.js";
import { feedReader, stopwatch, type Recorder } from "./metrics.js";
import { bodyText } from "./http.js";
import { metaWebhook, PATH as META_WEBHOOK } from "./meta-webhook.js";
import { createServer, VERSION } from "./server.js";
import { why } from "./types.js";
import { watch } from "./usage.js";
import type { Background } from "./web/data.js";
import { notFound, site } from "./web/site.js";
import { wantsPage } from "./web/connecteur.js";
import { OFFLINE_PATH } from "./web/pwa.js";
import { CADRE, CSP_RAPPORT, rapport } from "./web/securite.js";
import { signal, SIGNAL_PATH } from "./web/signaux.js";

// Browser-based clients (MCP Inspector, web chat apps) call the endpoint cross-origin.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

export function withCors(r: Response): Response {
  const headers = new Headers(r.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
}

// The team's scripts: the daily check (bin/check-sources.ts, « rundata-check/1 »), and the team's own reads, asked to send
// « rundata-check/<name> » but often written « rundata-check », « rundata-verif » or « Mozilla/5.0 rundata-check ».
// « rundata-interne » is a team visit, counted apart as such (metrics.ts), not one of these.
const CHECKER = /(?:^|[\s(;])rundata-(?!interne)/i;

/**
 * Short addresses for the links shared on a channel (Instagram's bio sends no referer): each sends the visitor to the
 * home page with its « ?ref= », which the page view records (worker.ts). Not pages: in no sitemap.
 */
const SHORTCUTS: Record<string, string> = { "/ig": "insta", "/fb": "fb" };

// Crawlers often send « Accept: */* » too: only these get the plain line instead of the page.
const CLI = /^(curl|wget|httpie|python-requests|python-urllib|go-http-client|node-fetch|undici)/i;

// The transport's own limit, which it does not check on a body it is handed already parsed: here it is checked on the
// bytes read, whatever `content-length` says (a body sent in chunks has none).
const MAX_BODY = 4 * 1024 * 1024;

// A batch runs every message it holds, for one request: at most this many, and none from the version that dropped them.
export const MAX_BATCH = 10;
const NO_BATCH_FROM = "2025-06-18";

/**
 * The body of a POST, parsed once for both the metrics and the transport. A body that is not JSON goes to the
 * transport as it came, for its own answer; one too large is refused here, without being read further.
 */
async function readBody(request: Request): Promise<{ request: Request; body?: unknown } | { tooLarge: true }> {
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return { request };
  const text = await bodyText(request, MAX_BODY);
  if (text === undefined) return { tooLarge: true };
  try {
    return { request, body: JSON.parse(text) };
  } catch {}
  return { request: new Request(request.url, { method: "POST", headers: request.headers, body: text }) };
}

/** Why a batch is refused, if it is: the protocol it claims has none, or it holds more than MAX_BATCH messages. */
export function batchRefused(version: string | null, body: unknown): string | undefined {
  if (!Array.isArray(body)) return undefined;
  if (version && version >= NO_BATCH_FROM) return `Batches are not part of protocol ${version.slice(0, 20)}: send one message per request.`;
  if (body.length > MAX_BATCH) return `At most ${MAX_BATCH} messages per batch.`;
  return undefined;
}

/** A refusal before the transport, in its own shape. */
function rpcError(status: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", error: { code: status === 413 ? -32000 : -32600, message }, id: null }, { status });
}

/** No stream to offer (see below): what the transport answers to a method it does not know, with the right Allow. */
function notAllowed(): Response {
  return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, { status: 405, headers: { allow: "POST, OPTIONS" } });
}

/**
 * What a request that threw gets, rather than Cloudflare's error page: a short page, never kept, and a line in the
 * Worker's log with the path and the version.
 */
export function failed(path: string, err: unknown): Response {
  console.error(`erreur : ${path} (version ${VERSION})`, why(err));
  const body = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Page indisponible · rundata.re</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;line-height:1.5"><h1>Page indisponible pour un instant</h1><p>Une erreur est survenue en la préparant. Réessayer dans une minute, ou repartir de <a href="/">l'accueil de rundata.re</a>.</p></body></html>`;
  return new Response(body, { status: 500, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...CADRE } });
}

/**
 * `background`: work to finish after the response (the Worker's waitUntil); in Node it just runs.
 * `record`: told of each MCP message and each page served (metrics.ts, usage.ts).
 */
export async function handle(request: Request, cache: Cache, background: Background = () => {}, record: Recorder = () => {}): Promise<Response> {
  const url = new URL(request.url);
  // « /ig », « /ig/ » and « /IG » alike: typed by hand as often as clicked.
  const shortcut = SHORTCUTS[url.pathname.replace(/(.)\/$/, "$1").toLowerCase()];
  if (shortcut) return new Response(null, { status: 302, headers: { location: `/?ref=${shortcut}` } });
  // The team's scripts are not visitors: not counted.
  if (CHECKER.test(request.headers.get("user-agent") ?? "")) record = () => {};
  // What a page's browser tells the statistics (web/signaux.ts): a point each, never a page view.
  if (url.pathname === SIGNAL_PATH) return signal(request, record);
  // A browser opening the connector's address gets the page that explains it (web/connecteur.ts); the clients, the endpoint.
  // « /mcp/ » alike, answered in place: a client may not follow a redirect on a POST.
  if ((url.pathname === "/mcp" || url.pathname === "/mcp/") && !wantsPage(request)) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const watching = watch(request, record);
    // Stateless and answering in JSON, the endpoint has no stream to send anything on: GET (the stream a client
    // opens for the server's own messages) gets a 405, as the specification allows, rather than a stream that stays
    // open with nothing on it; DELETE (the end of a session) has no session to end.
    if (request.method !== "POST") {
      watching.done(405, "Method not allowed.");
      return withCors(notAllowed());
    }
    // Tool calls are recorded by `watching`, with more than the server knows; the server says which found nothing.
    const server = createServer(cache, (hit) => {
      if (hit.kind !== "mcp") record(hit);
      else if (hit.outcome === "vide" && hit.id !== undefined) watching.vide(hit.id);
    }, background);
    // The tools never change while the server runs, and a stateless server could not send the notification anyway.
    server.server.registerCapabilities({ tools: { listChanged: false } });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    watching.attach(transport);
    const read = await readBody(request);
    if ("tooLarge" in read) {
      const message = `Request body larger than ${MAX_BODY} bytes.`;
      watching.done(413, message);
      return withCors(rpcError(413, message));
    }
    const refused = "body" in read ? batchRefused(request.headers.get("mcp-protocol-version"), read.body) : undefined;
    if (refused) {
      // Recorded as one refused request, not as the messages it held.
      watching.done(400, refused);
      return withCors(rpcError(400, refused));
    }
    if ("body" in read) watching.read(read.body);
    const response = await transport.handleRequest(read.request, "body" in read ? { parsedBody: read.body } : undefined);
    watching.done(response.status);
    return withCors(response);
  }
  // What the browsers would block under the policy in observation (web/securite.ts): one log line, not a view.
  if (url.pathname === CSP_RAPPORT) return rapport(request);
  // What Meta tells of the Page and the Instagram account: nothing without its secrets, then the site's 404.
  if (url.pathname === META_WEBHOOK) {
    const r = await metaWebhook(request);
    if (r) return r;
  }
  const accept = request.headers.get("accept") ?? "";
  if (url.pathname === "/" && !accept.includes("text/html") && CLI.test(request.headers.get("user-agent") ?? "")) {
    return new Response(
      `reunion-temps-reel ${VERSION} — serveur MCP de La Réunion 974 en direct.\nPoint d'accès MCP : ${url.origin}/mcp\n`,
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  const measure = stopwatch();
  const page = await site(request, cache, background);
  if (page) {
    const type = page.headers.get("content-type") ?? "";
    // The offline page fetched by the service worker for its shell (web/pwa.ts), in every new browser: not a view.
    const shell = url.pathname === OFFLINE_PATH && (request.headers.get("sec-fetch-dest") ?? "document") !== "document";
    if (type.startsWith("text/html") && !shell) {
      record({ kind: "page", name: url.pathname, detail: url.searchParams.has("maj") ? "bouton" : undefined, ok: page.ok, status: page.status, ...measure() });
    } else if (type.startsWith("application/rss+xml")) {
      // A reader polls all day: counted apart from the page views, with how many it reads for.
      const r = feedReader(request.headers.get("user-agent") ?? "");
      record({ kind: "flux", name: url.pathname, ok: page.ok, status: page.status, reader: r.name, subscribers: r.subscribers, ...measure() });
    }
    return page;
  }
  // The page that leads back to the site, for a browser and for whatever takes anything (the fetchers of the assistants
  // often send « */* » or nothing); the plain line for a client that asks for something else.
  if (!accept || accept.includes("text/html") || accept.includes("*/*")) return notFound(request);
  return new Response("Not found", { status: 404 });
}
