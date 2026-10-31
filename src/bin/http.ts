/**
 * Remote MCP endpoint on Node (see app.ts). The Cloudflare Worker (worker.ts) serves the same thing; this one is
 * for running it at home or in a container. PORT defaults to 8787; HOST to 127.0.0.1, so it is not reachable from
 * the network unless asked (HOST=0.0.0.0 in a container).
 */
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import "./net.js";
import { handle } from "../app.js";
import { Cache } from "../cache.js";
import * as climat from "../providers/climat.js";
import * as meteofrance from "../providers/meteofrance.js";
import { localClimat } from "./climat-local.js";
import * as transit from "../providers/transit.js";
import { localTransit } from "./transit-local.js";
import { VERSION } from "../server.js";

const cache = new Cache(); // shared by all requests: that is the point
meteofrance.configure({
  applicationId: process.env.METEOFRANCE_APPLICATION_ID,
  apiKey: process.env.METEOFRANCE_API_KEY,
  token: process.env.METEOFRANCE_TOKEN,
});

// The past weather (historique_meteo) from a local copy of the archives: scripts/climat-local.ts.
if (process.env.CLIMAT_SQLITE) {
  climat.configure(localClimat(process.env.CLIMAT_SQLITE), process.env.CLIMAT_H_SQLITE ? localClimat(process.env.CLIMAT_H_SQLITE) : undefined);
}

// The bus timetables from the rows of a build (scripts/build-transit.py writes dist/transit-rows.json).
if (process.env.TRANSIT_ROWS) transit.configure(localTransit(process.env.TRANSIT_ROWS));

// An MCP request is a few kilobytes of JSON.
const MAX_BODY = 1024 * 1024;

class TooLarge extends Error {}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new TooLarge();
    chunks.push(c as Buffer);
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const body = chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
  return new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, { method: req.method, headers, body });
}

async function send(res: ServerResponse, r: Response) {
  res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
  if (r.body) for await (const chunk of r.body) res.write(chunk);
  res.end();
}

// The static files Cloudflare serves beside the Worker (wrangler.jsonc, "assets"): the press page's visuals, the
// pictures of the link previews and of the pages' bands, the home-screen icons and the symbol of the brand, the
// island's relief, the headings' font; each with its cache as in public/_headers.
const PUBLIC = new URL("../../public/", import.meta.url);
const TYPES: Record<string, string> = { jpg: "image/jpeg", webp: "image/webp", png: "image/png", svg: "image/svg+xml", woff2: "font/woff2" };
const KEPT = "public, max-age=31536000, immutable";
const ASSETS: [RegExp, string][] = [
  [/^\/((?:presse|og|icons|logo|fonds)\/[\w-]+\.[0-9a-f]+\.(jpg|webp|png|svg))$/, KEPT],
  [/^\/(relief-(?:fin-)?[0-9a-f]{8}(?:-\d-\d)?\.(webp))$/, KEPT],
  [/^\/(font\/titres-\d+\.(woff2))$/, KEPT],
  // Linked with ?v= (its fingerprint), kept a week.
  [/^\/(og\.(png))$/, "public, max-age=604800"],
];

async function asset(req: IncomingMessage): Promise<Response | null> {
  const path = (req.url ?? "").split("?")[0];
  const found = ASSETS.map(([re, cache]) => [re.exec(path), cache] as const).find(([m]) => m);
  if (!found || (req.method !== "GET" && req.method !== "HEAD")) return null;
  const [m, cache] = found;
  try {
    const body = await readFile(new URL(m![1], PUBLIC));
    return new Response(req.method === "HEAD" ? null : body, { headers: { "content-type": TYPES[m![2]], "cache-control": cache } });
  } catch {
    return null;
  }
}

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST || "127.0.0.1";
createHttpServer(async (req, res) => {
  try {
    await send(res, (await asset(req)) ?? (await handle(await toRequest(req), cache)));
  } catch (err) {
    if (err instanceof TooLarge) {
      res.writeHead(413, { connection: "close" });
      return res.end();
    }
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(port, host, () => console.error(`reunion-temps-reel ${VERSION} on http://${host}:${port}/mcp`));
