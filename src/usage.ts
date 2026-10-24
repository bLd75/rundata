/**
 * What each MCP request asked and how it was answered, for the metrics (metrics.ts): the JSON-RPC method, the tool, the
 * client's own name from its initialize, the names of the arguments, the place understood, the outcome, the time, the
 * subrequests and the cache. Read from the body, which the endpoint parses once here and hands to the transport, and
 * from the answers the transport sends. The values of the arguments are not kept, except the place: as the gazetteer
 * understood it, or the text asked when it did not understand it, since those are what the resolver is improved from.
 */
import type { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { stopwatch, type Hit, type Recorder } from "./metrics.js";
import { communeAt, resolvePlace } from "./places/resolve.js";

/** One JSON-RPC message of a request. */
export interface Asked {
  id?: string | number;
  method: string;
  tool?: string;
  /** The names of the arguments, sorted. */
  args?: string;
  lieu?: string;
  client?: string;
  clientVersion?: string;
  protocol?: string;
}

const short = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
const record = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The messages of a parsed request body (one message or a batch); what is not a JSON-RPC message is left out. */
export function asked(body: unknown): Asked[] {
  const out: Asked[] = [];
  for (const m of Array.isArray(body) ? body : [body]) {
    const { id, method, params } = record(m);
    if (typeof method !== "string") continue;
    const a: Asked = { method: method.slice(0, 64) };
    if (typeof id === "string" || typeof id === "number") a.id = id;
    const p = record(params);
    if (method === "tools/call") {
      a.tool = short(p.name, 64);
      const args = record(p.arguments);
      a.args = Object.keys(args).filter((k) => /^[\w-]{1,30}$/.test(k)).sort().join(",").slice(0, 120);
      if (typeof args.lieu === "string" && args.lieu.trim()) a.lieu = args.lieu;
    } else if (method === "initialize") {
      const info = record(p.clientInfo);
      a.client = short(info.name, 60);
      a.clientVersion = short(info.version, 30);
      a.protocol = short(p.protocolVersion, 20);
    }
    out.push(a);
  }
  return out;
}

// Coordinates, even outside the island, are never kept as written: they could be someone's home.
const COORDINATES = /^\s*-?\d{1,3}(?:[.,]\d+)?\s*[,; ]\s*-?\d{1,3}/;

// Nor a postal address: a number followed by a kind of street (« 12 rue des Lilas », « 4 bis chemin Bœuf Mort »,
// « 7, lot. Les Hibiscus ») is kept as « adresse ».
const ADDRESS = /(?:^|[^\p{L}\d])\d{1,4}\s*(?:bis|ter|[a-d])?\s*,?\s*(?:rue|ruelle|chemin|ch|all[ée]e|impasse|imp|avenue|av|boulevard|bd|route|rte|lot|lotissement|villa|r[ée]sidence|r[ée]s|cit[ée]|place|square|quai|sentier|voie|passage|lieu[- ]dit|hameau)(?![\p{L}])/iu;

/** The place asked, as the gazetteer understands it: its name and commune, or the text asked if it does not. */
export function understood(lieu: string): Pick<Hit, "detail" | "place" | "commune"> {
  const r = resolvePlace(lieu);
  if (r?.correspondance === "coordonnees") return { detail: "coordonnées", place: "coordonnées", commune: communeAt(r.lieu.lon, r.lieu.lat) };
  if (r) return { detail: r.lieu.nom, place: "résolu", commune: r.lieu.commune };
  if (COORDINATES.test(lieu)) return { detail: "coordonnées hors de l'île", place: "inconnu" };
  if (ADDRESS.test(lieu)) return { detail: "adresse", place: "inconnu" };
  return { detail: lieu.trim().slice(0, 60), place: "inconnu" };
}

type Measures = ReturnType<ReturnType<typeof stopwatch>>;

interface Answer extends Measures {
  outcome: string;
  message?: string;
  size?: number;
}

/** What the answer to a request says: its outcome, and the length of a tool's text. */
export function answer(message: JSONRPCMessage): Omit<Answer, keyof Measures> | undefined {
  if ("error" in message) return { outcome: `rpc ${message.error.code}`, message: message.error.message.slice(0, 160) };
  if (!("result" in message)) return undefined;
  const result = message.result as { isError?: boolean; content?: { text?: unknown }[] };
  const size = Array.isArray(result.content) ? result.content.reduce((n, c) => n + (typeof c?.text === "string" ? c.text.length : 0), 0) : undefined;
  return { outcome: result.isError ? "erreur" : "ok", size };
}

/**
 * Follows one request to the MCP endpoint: `read` its parsed body, `attach` the transport once the server is connected,
 * then `done` with the HTTP status records one hit per message (or one for the request, when it has none).
 */
export function watch(request: Request, record: Recorder) {
  const measure = stopwatch();
  const header = request.headers.get("mcp-protocol-version")?.slice(0, 20) || undefined;
  const answers = new Map<string | number, Answer>();
  let messages: Asked[] = [];
  let failure: string | undefined;
  return {
    read(body: unknown) {
      messages = asked(body);
    },
    attach(transport: WebStandardStreamableHTTPServerTransport) {
      const send = transport.send.bind(transport);
      transport.send = (message, options) => {
        const a = "id" in message ? answer(message) : undefined;
        if (a) answers.set((message as { id: string | number }).id, { ...a, ...measure() });
        return send(message, options);
      };
      // The transport says why it refuses a request (bad protocol version, not JSON…) here, before answering 4xx.
      const onerror = transport.onerror;
      transport.onerror = (err) => {
        failure = err.message.slice(0, 160);
        onerror?.(err);
      };
    },
    done(status: number, message?: string) {
      const refused = status >= 400;
      const error = refused ? (message ?? failure) : undefined;
      if (!messages.length) {
        record({ kind: "rpc", name: request.method, ok: !refused, protocol: header, outcome: refused ? `http ${status}` : "ok", message: error, ...measure() });
        return;
      }
      for (const m of messages) {
        if (m.method === "notifications/initialized") continue; // follows every initialize: nothing to learn
        const a = m.id !== undefined ? answers.get(m.id) : undefined;
        const place = m.lieu ? understood(m.lieu) : {};
        let outcome = a?.outcome ?? (refused ? `http ${status}` : "ok");
        if (outcome === "erreur" && place.place === "inconnu") outcome = "lieu inconnu";
        const { ms, subrequests, cacheHits, cacheLoads } = a ?? measure();
        record({
          kind: m.method === "tools/call" ? "mcp" : "rpc",
          name: m.tool ?? m.method,
          ...place,
          ok: outcome === "ok",
          method: m.method,
          client: m.client,
          clientVersion: m.clientVersion,
          protocol: m.protocol ?? header,
          outcome,
          message: a?.message ?? error,
          args: m.args,
          ms,
          subrequests,
          cacheHits,
          cacheLoads,
          size: a?.size,
        });
      }
    },
  };
}
