import { afterEach, describe, expect, it, vi } from "vitest";
import { batchRefused, handle, MAX_BATCH } from "../src/app.js";
import { bodyText } from "../src/http.js";
import { Cache } from "../src/cache.js";
import { visitor, type Hit } from "../src/metrics.js";

const mcp = (body: unknown) =>
  new Request("http://x/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });

describe("HTTP endpoint", () => {
  it("lists the tools over stateless MCP, with CORS for browser clients", async () => {
    const r = await handle(mcp({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }), new Cache());
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const names = (await r.json()).result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["meteo_actuelle", "prevision_meteo", "temperature_mer",
      "volcan_seismes",
      "electricite",
      "calendrier",
      "qualite_air",
      "annuaire_services_publics",
      "fiche_terrain", "velos_libre_service", "maree", "crues_rivieres", "bornes_recharge", "qualite_eau", "sentiers_randonnee", "restrictions_eau", "coupures_eau", "resume_du_jour", "defibrillateurs", "sport", "cyclones", "historique_meteo", "evenements", "actualites", "donner_avis", "sites_sans_reponse", "sources_donnees"]);
  });

  it("answers CORS preflight and unknown paths", async () => {
    expect((await handle(new Request("http://x/mcp", { method: "OPTIONS" }), new Cache())).status).toBe(204);
    expect((await handle(new Request("http://x/nope"), new Cache())).status).toBe(404);
  });

  it("refuses batches in the protocol that dropped them, and more than MAX_BATCH messages in the older ones", async () => {
    const ping = (id: number) => ({ jsonrpc: "2.0", id, method: "ping" });
    const batch = (n: number, version?: string) => {
      const r = mcp(Array.from({ length: n }, (_, i) => ping(i + 1)));
      if (version) r.headers.set("mcp-protocol-version", version);
      return r;
    };
    const seen: Hit[] = [];
    const recent = await handle(batch(2, "2025-06-18"), new Cache(), undefined, (h) => seen.push(h));
    expect(recent.status).toBe(400);
    expect(recent.headers.get("access-control-allow-origin")).toBe("*");
    expect((await recent.json()).error.message).toMatch(/one message per request/);
    // One refused request in the metrics, not one per message.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "rpc", ok: false, outcome: "http 400" });
    const many = await handle(batch(MAX_BATCH + 1, "2025-03-26"), new Cache());
    expect(many.status).toBe(400);
    expect((await many.json()).error.message).toBe(`At most ${MAX_BATCH} messages per batch.`);
    const small = await handle(batch(2, "2025-03-26"), new Cache());
    expect(small.status).toBe(200);
    expect((await small.json()).map((m: { id: number }) => m.id)).toEqual([1, 2]);
    expect(batchRefused(null, ping(1))).toBeUndefined();
  });

  it("stops reading a body past its limit, even sent in chunks without a length", async () => {
    // A body that never ends: read whole, it would never answer.
    const chunk = new TextEncoder().encode(" ".repeat(1024 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        sent++;
        c.enqueue(chunk);
      },
    });
    const r = new Request("http://x/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body, duplex: "half" } as RequestInit);
    expect(r.headers.get("content-length")).toBeNull();
    const res = await handle(r, new Cache());
    expect(res.status).toBe(413);
    // Four chunks and the one past the limit, then the stream is let go.
    expect(sent).toBeLessThanOrEqual(7);
    expect(await bodyText(new Request("http://x/", { method: "POST", body: "é".repeat(4) }), 8)).toBe("éééé");
    expect(await bodyText(new Request("http://x/", { method: "POST", body: "é".repeat(5) }), 8)).toBeUndefined();
  });

  it("sends a shortcut to the home page with its ref, before any page and without counting it", async () => {
    const hits: Hit[] = [];
    vi.stubGlobal("fetch", async () => {
      throw new Error("no subrequest");
    });
    for (const [short, ref] of [["ig", "insta"], ["fb", "fb"]]) {
      for (const path of [`/${short}`, `/${short}/`, `/${short.toUpperCase()}`, `/${short}?x=1`]) {
        const r = await handle(new Request(`https://rundata.re${path}`, { headers: { accept: "text/html" } }), new Cache(), () => {}, (h) => hits.push(h));
        expect(r.status).toBe(302);
        expect(r.headers.get("location")).toBe(`/?ref=${ref}`);
      }
    }
    expect(hits).toHaveLength(0);
    expect((await handle(new Request("https://rundata.re/ig/x", { headers: { accept: "text/html" } }), new Cache())).status).toBe(404);
    const sitemap = await (await handle(new Request("https://rundata.re/sitemap.xml"), new Cache())).text();
    expect(sitemap).toContain("<loc>https://rundata.re/</loc>");
    expect(sitemap).not.toMatch(/\/(ig|fb)</i);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows browsers a page with the connector address", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline"); // the page then goes without its live block
    });
    const r = await handle(new Request("https://rundata.re/", { headers: { accept: "text/html" } }), new Cache());
    expect(await r.text()).toContain("https://rundata.re/mcp");
  });

  it("counts tool calls and pages, naming the assistant but not the person", async () => {
    const hits: Hit[] = [];
    const call = mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "sources_donnees", arguments: {} } });
    await (await handle(call, new Cache(), () => {}, (h) => hits.push(h))).json();
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    await handle(new Request("https://rundata.re/meteo/cilaos?maj=12h55", { headers: { accept: "text/html" } }), new Cache(), () => {}, (h) => hits.push(h));
    await handle(new Request("https://rundata.re/favicon.svg"), new Cache(), () => {}, (h) => hits.push(h));
    expect(hits).toMatchObject([
      { kind: "mcp", name: "sources_donnees", ok: true, method: "tools/call", outcome: "ok", args: "" },
      { kind: "page", name: "/meteo/cilaos", detail: "bouton", ok: true, status: 200 },
    ]);
    expect(hits).toHaveLength(2);
    expect(visitor("openai-mcp/1.0.0")).toBe("ChatGPT (connecteur)");
    expect(visitor("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot")).toBe("ChatGPT");
    expect(visitor("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1")).toBe("navigateur");
    expect(visitor("python-httpx/0.28.1")).toBe("python-httpx");
  });
});
