import { afterEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { counted } from "../src/budget.js";
import { Cache } from "../src/cache.js";
import { audience, category, feedReader, language, point, type Hit } from "../src/metrics.js";
import { answer, asked, understood } from "../src/usage.js";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://rundata.re/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function hitsOf(request: Request): Promise<{ hits: Hit[]; response: Response }> {
  const hits: Hit[] = [];
  const response = await handle(request, new Cache(), () => {}, (h) => hits.push(h));
  return { hits, response };
}

describe("MCP messages, as recorded", () => {
  it("reads the method, the tool, the argument names and the client of each message", () => {
    expect(asked({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-ai", version: "0.1.0" }, capabilities: {} } }))
      .toEqual([{ id: 1, method: "initialize", client: "claude-ai", clientVersion: "0.1.0", protocol: "2025-06-18" }]);
    expect(asked([
      { jsonrpc: "2.0", id: "a", method: "tools/call", params: { name: "prevision_meteo", arguments: { quand: "demain", lieu: "Cilaos" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
    ])).toEqual([
      { id: "a", method: "tools/call", tool: "prevision_meteo", args: "lieu,quand", lieu: "Cilaos" },
      { method: "notifications/initialized" },
      { id: 3, method: "tools/list" },
    ]);
  });

  it("keeps out what is not a JSON-RPC message, and strange argument names", () => {
    expect(asked(null)).toEqual([]);
    expect(asked({ hello: 1 })).toEqual([]);
    expect(asked([1, "x", { method: 2 }])).toEqual([]);
    expect(asked({ id: 1, method: "tools/call", params: { name: "x", arguments: { "a b": 1, ok: 2 } } })[0].args).toBe("ok");
    expect(asked({ id: 1, method: "initialize", params: { clientInfo: "?" } })[0]).toEqual({ id: 1, method: "initialize", client: undefined, clientVersion: undefined, protocol: undefined });
  });

  it("keeps the place understood, and the text only when it was not", () => {
    expect(understood("plage de l'Hermitage")).toEqual({ detail: "Plage de l'Ermitage-les-Bains", place: "résolu", commune: "Saint-Paul" });
    expect(understood("  Zzyzx Qwrt  ")).toEqual({ detail: "Zzyzx Qwrt", place: "inconnu" });
    expect(understood("x".repeat(100)).detail).toHaveLength(60);
    expect(understood("-21.05, 55.22")).toEqual({ detail: "coordonnées", place: "coordonnées", commune: "Saint-Paul" });
    expect(understood("48.8566, 2.3522")).toEqual({ detail: "coordonnées hors de l'île", place: "inconnu" });
  });

  it("keeps a postal address it does not understand as « adresse », never as written", () => {
    for (const lieu of ["12 rue des Zzyzx", "4 bis chemin Qwrt Zzyzx", "7, lot. Les Zzyzx", "Zzyzx, 15 allée des Qwrt", "103 Rés. Zzyzx", "2 impasse Qwrt", "21 av. Zzyzx", "8 lieu-dit Qwrt"]) {
      expect(understood(lieu)).toEqual({ detail: "adresse", place: "inconnu" });
    }
    // A place without a house number is not an address, and stays as asked, to learn to understand it.
    for (const lieu of ["Zzyzx Qwrt", "rue Zzyzx", "Zzyzx 2", "Qwrt 974 Zzyzx", "Zzyzx des 3 Qwrt"]) {
      expect(understood(lieu)).toEqual({ detail: lieu, place: "inconnu" });
    }
  });

  it("reads the outcome of an answer", () => {
    expect(answer({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "abc" }] } })).toEqual({ outcome: "ok", size: 3 });
    expect(answer({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: "introuvable" }] } })).toEqual({ outcome: "erreur", size: 11 });
    expect(answer({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Tool x not found" } })).toEqual({ outcome: "rpc -32602", message: "Tool x not found" });
  });
});

describe("MCP endpoint, as recorded", () => {
  it("records initialize with the client's name, and tools/list, but not notifications/initialized", async () => {
    const init = await hitsOf(post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-ai", version: "0.1.0" }, capabilities: {} } }));
    expect(init.response.status).toBe(200);
    expect((await init.response.json()).result.capabilities.tools).toEqual({ listChanged: false });
    expect(init.hits).toMatchObject([{ kind: "rpc", name: "initialize", method: "initialize", client: "claude-ai", clientVersion: "0.1.0", protocol: "2025-06-18", outcome: "ok", ok: true }]);
    const list = await hitsOf(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-protocol-version": "2025-06-18" }));
    expect(list.hits).toMatchObject([{ kind: "rpc", name: "tools/list", protocol: "2025-06-18", outcome: "ok" }]);
    const note = await hitsOf(post({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(note.response.status).toBe(202);
    expect(note.hits).toEqual([]);
  });

  it("records a tool call with its outcome, its size, and a place it did not understand", async () => {
    const { hits } = await hitsOf(post({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "temperature_mer", arguments: { lieu: "Zzyzx Qwrt" } } }));
    expect(hits).toMatchObject([{ kind: "mcp", name: "temperature_mer", method: "tools/call", detail: "Zzyzx Qwrt", place: "inconnu", outcome: "lieu inconnu", ok: false, args: "lieu" }]);
    expect(hits[0].size).toBeGreaterThan(0);
    const unknown = await hitsOf(post({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "nimporte", arguments: {} } }));
    expect(unknown.hits[0]).toMatchObject({ kind: "mcp", name: "nimporte", ok: false });
    expect(unknown.hits[0].outcome).toMatch(/^(rpc -32602|erreur)$/);
  });

  it("records why a request was refused, with its protocol header", async () => {
    const { hits, response } = await hitsOf(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-protocol-version": "2099-01-01" }));
    expect(response.status).toBe(400);
    expect(hits).toMatchObject([{ kind: "rpc", name: "tools/list", protocol: "2099-01-01", outcome: "http 400", ok: false }]);
    expect(hits[0].message).toContain("Unsupported protocol version: 2099-01-01");
    const garbage = await hitsOf(post("{not json"));
    expect(garbage.response.status).toBe(400);
    expect(garbage.hits).toMatchObject([{ kind: "rpc", name: "POST", outcome: "http 400", message: "Parse error: Invalid JSON" }]);
  });

  it("answers GET with 405 at once, and records it", async () => {
    const { hits, response } = await hitsOf(new Request("https://rundata.re/mcp", { headers: { accept: "text/event-stream" } }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
    expect(hits).toMatchObject([{ kind: "rpc", name: "GET", outcome: "http 405", message: "Method not allowed." }]);
  });

  it("counts the subrequests of a call within a counted invocation", async () => {
    const hits: Hit[] = [];
    await counted(50, () => handle(post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "sources_donnees", arguments: {} } }), new Cache(), () => {}, (h) => hits.push(h)));
    expect(hits[0]).toMatchObject({ subrequests: 0, cacheHits: 0, cacheLoads: 0 });
    expect(hits[0].ms).toBeGreaterThanOrEqual(0);
  });
});

describe("Page views and the data point", () => {
  it("tells a person from a script dressed as a browser", () => {
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
    expect(audience(new Headers({ "user-agent": chrome, "accept-language": "fr-FR,fr;q=0.9", "sec-fetch-mode": "navigate" }))).toBe("humain");
    expect(audience(new Headers({ "user-agent": chrome }))).toBe("robot probable");
    expect(audience(new Headers({ "user-agent": "Mozilla/5.0 AppleWebKit/537.36; compatible; ChatGPT-User/1.0" }))).toBe("assistant");
    expect(audience(new Headers({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" }))).toBe("robot");
    expect(language("fr-RE,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(language(null)).toBe("");
    expect(category("/")).toBe("accueil");
    expect(category("/meteo/cilaos")).toBe("meteo/*");
    expect(category("/vigilance/")).toBe("vigilance");
  });

  it("keeps the first six columns where older queries read them", () => {
    const visit = { who: "Claude", country: "RE", from: "ref:fb", audience: "", language: "" };
    const p = point({ kind: "mcp", name: "meteo_actuelle", detail: "Cilaos", ok: true, method: "tools/call", outcome: "ok", args: "lieu", place: "résolu", commune: "Cilaos", ms: 120, subrequests: 3, cacheHits: 2, cacheLoads: 1, size: 900 }, visit);
    expect(p.indexes).toEqual(["mcp"]);
    expect(p.blobs.slice(0, 6)).toEqual(["mcp", "meteo_actuelle", "Cilaos", "Claude", "RE", "ref:fb"]);
    expect(p.blobs.slice(6)).toEqual(["tools/call", "", "", "", "ok", "", "lieu", "résolu", "Cilaos"]);
    expect(p.doubles).toEqual([1, 120, 3, 2, 1, 900]);
    const page = point({ kind: "page", name: "/meteo/cilaos", ok: true, status: 200, ms: 30 }, { ...visit, audience: "humain", language: "fr" });
    expect(page.blobs.slice(6, 10)).toEqual(["meteo/*", "fr", "humain", "200"]);
  });
});

describe("Feeds, as recorded", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names the reader and reads how many subscribers it fetches for", () => {
    expect(feedReader("Feedly/1.0 (+http://www.feedly.com/fetcher.html; 12 subscribers; like FeedFetcher-Google)")).toEqual({ name: "Feedly", subscribers: 12 });
    expect(feedReader("Mozilla/5.0 (compatible; inoreader.com; 3 subscribers)")).toEqual({ name: "Inoreader", subscribers: 3 });
    expect(feedReader("NewsBlur Feed Fetcher - 1 subscriber - https://www.newsblur.com/site/123/x")).toEqual({ name: "NewsBlur", subscribers: 1 });
    expect(feedReader("Feedbin feed-id:1373711 - 5 subscribers")).toEqual({ name: "Feedbin", subscribers: 5 });
    // An app on someone's phone or computer: one reader.
    expect(feedReader("NetNewsWire (RSS Reader; https://netnewswire.com/)")).toEqual({ name: "NetNewsWire", subscribers: 1 });
    expect(feedReader("Mozilla/5.0 (compatible; Miniflux/2.2.1; +https://miniflux.app)")).toEqual({ name: "Miniflux", subscribers: 1 });
    expect(feedReader("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0").name).toBe("navigateur");
    expect(feedReader("curl/8.5.0").name).toBe("curl");
  });

  it("writes a feed apart from the page views: its reader in blob4, its subscribers in double6", () => {
    const visit = { who: "Feedly/1.0", country: "US", from: "", audience: "", language: "" };
    const p = point({ kind: "flux", name: "/communes/saint-paul.rss", ok: true, status: 200, reader: "Feedly", subscribers: 12, ms: 8, subrequests: 4 }, visit);
    expect(p.indexes).toEqual(["flux"]);
    expect(p.blobs.slice(0, 6)).toEqual(["flux", "/communes/saint-paul.rss", "", "Feedly", "US", ""]);
    expect(p.blobs.slice(6, 10)).toEqual(["communes/*", "", "", "200"]);
    expect(p.doubles).toEqual([1, 8, 4, 0, 0, 12]);
    expect(point({ kind: "flux", name: "/communes/le-port.rss", ok: true }, visit).doubles[5]).toBe(1);
  });

  it("records the RSS route as a feed, never as a page", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const ua = { "user-agent": "Mozilla/5.0 (compatible; inoreader.com; 3 subscribers)" };
    const { hits, response } = await hitsOf(new Request("https://rundata.re/communes/saint-paul.rss", { headers: ua }));
    expect(response.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "flux", name: "/communes/saint-paul.rss", ok: true, status: 200, reader: "Inoreader", subscribers: 3 });
    // The page of the commune stays a page.
    const page = await hitsOf(new Request("https://rundata.re/communes/saint-paul", { headers: { ...ua, accept: "text/html" } }));
    expect(page.hits.map((h) => h.kind)).toEqual(["page"]);
  });
});
