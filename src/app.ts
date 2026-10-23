/**
 * The HTTP face of the server, shared by the Node entry point and the Cloudflare Worker: POST /mcp is the MCP
 * endpoint (streamable HTTP, stateless, JSON responses); everything else is the web site (web/site.ts), except that
 * a command-line client asking for / gets one line saying what this is.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Cache } from "./cache.js";
import type { Recorder } from "./metrics.js";
import { createServer, VERSION } from "./server.js";
import type { Background } from "./web/data.js";
import { notFound, site } from "./web/site.js";

// Browser-based clients (MCP Inspector, web chat apps) call the endpoint cross-origin.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

function withCors(r: Response): Response {
  const headers = new Headers(r.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
}

// Crawlers often send « Accept: */* » too: only these get the plain line instead of the page.
const CLI = /^(curl|wget|httpie|python-requests|python-urllib|go-http-client|node-fetch|undici)/i;

/**
 * `background`: work to finish after the response (the Worker's waitUntil); in Node it just runs.
 * `record`: told of each tool call and each page served (metrics.ts).
 */
export async function handle(request: Request, cache: Cache, background: Background = () => {}, record: Recorder = () => {}): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/mcp") {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await createServer(cache, record).connect(transport);
    return withCors(await transport.handleRequest(request));
  }
  const accept = request.headers.get("accept") ?? "";
  if (url.pathname === "/" && !accept.includes("text/html") && CLI.test(request.headers.get("user-agent") ?? "")) {
    return new Response(
      `reunion-temps-reel ${VERSION} — serveur MCP de mesures en temps réel à La Réunion.\nPoint d'accès MCP : ${url.origin}/mcp\n`,
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  const page = await site(request, cache, background);
  if (page) {
    if (page.headers.get("content-type")?.startsWith("text/html")) {
      record({ kind: "page", name: url.pathname, detail: url.searchParams.has("maj") ? "bouton" : undefined, ok: page.ok });
    }
    return page;
  }
  if (accept.includes("text/html")) return notFound(request);
  return new Response("Not found", { status: 404 });
}
