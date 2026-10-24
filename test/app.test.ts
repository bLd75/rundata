import { afterEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
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
      "fiche_terrain", "velos_libre_service", "maree", "crues_rivieres", "bornes_recharge", "qualite_eau", "sentiers_randonnee", "restrictions_eau", "coupures_eau", "defibrillateurs", "sport", "cyclones", "historique_meteo", "agenda", "sources_donnees"]);
  });

  it("answers CORS preflight and unknown paths", async () => {
    expect((await handle(new Request("http://x/mcp", { method: "OPTIONS" }), new Cache())).status).toBe(204);
    expect((await handle(new Request("http://x/nope"), new Cache())).status).toBe(404);
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
    expect(hits).toEqual([
      { kind: "mcp", name: "sources_donnees", detail: undefined, ok: true },
      { kind: "page", name: "/meteo/cilaos", detail: "bouton", ok: true },
    ]);
    expect(visitor("openai-mcp/1.0.0")).toBe("ChatGPT (connecteur)");
    expect(visitor("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot")).toBe("ChatGPT");
    expect(visitor("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1")).toBe("navigateur");
    expect(visitor("python-httpx/0.28.1")).toBe("python-httpx");
  });
});
