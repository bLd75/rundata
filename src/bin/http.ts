/**
 * Remote MCP endpoint on Node (see app.ts). The Cloudflare Worker (worker.ts) serves the same thing; this one is
 * for running it at home or in a container. PORT defaults to 8787; HOST to 127.0.0.1, so it is not reachable from
 * the network unless asked (HOST=0.0.0.0 in a container).
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import "./net.js";
import { handle } from "../app.js";
import { Cache } from "../cache.js";
import * as climat from "../providers/climat.js";
import * as meteofrance from "../providers/meteofrance.js";
import { localClimat } from "./climat-local.js";
import { VERSION } from "../server.js";

const cache = new Cache(); // shared by all requests: that is the point
meteofrance.configure({
  applicationId: process.env.METEOFRANCE_APPLICATION_ID,
  apiKey: process.env.METEOFRANCE_API_KEY,
  token: process.env.METEOFRANCE_TOKEN,
});

// The past weather (historique_meteo) from a local copy of the archive: scripts/climat-local.ts.
if (process.env.CLIMAT_SQLITE) climat.configure(localClimat(process.env.CLIMAT_SQLITE));

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

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST || "127.0.0.1";
createHttpServer(async (req, res) => {
  try {
    await send(res, await handle(await toRequest(req), cache));
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
