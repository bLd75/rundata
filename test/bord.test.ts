import { afterEach, describe, expect, it, vi } from "vitest";
import { garder, gardeDe, lire, TRAJET_SECONDES } from "../src/web/bord.js";

/** The Cache API as the Worker has it, in memory: what was put, by key. */
function edge() {
  const kept = new Map<string, Response>();
  const store = {
    match: async (key: string) => kept.get(key)?.clone(),
    put: async (key: string, r: Response) => void kept.set(key, r),
  };
  vi.stubGlobal("caches", { open: async () => store });
  return kept;
}

describe("the answers kept at the edge", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keep the trips under their address, reduced to what the page reads; the feeds keep their own copy", () => {
    expect(gardeDe(new URL("https://rundata.re/bus/trajet/citalis/12/T-9_1?jour=20261026&arret=55&z=9"))).toEqual({ secondes: TRAJET_SECONDES, cle: "https://rundata.re/bus/trajet/citalis/12/T-9_1?jour=20261026&arret=55" });
    expect(gardeDe(new URL("https://rundata.re/bus/trajet/citalis/12/T-9_1?jour=demain&arret=x"))?.cle).toBe("https://rundata.re/bus/trajet/citalis/12/T-9_1");
    for (const p of ["/associations/evenements.ics", "/associations/evenements.json", "/associations", "/bus", "/bus/trajet/citalis", "/volcan", "/mcp"]) expect(gardeDe(new URL(`https://rundata.re${p}`))).toBeUndefined();
  });

  it("serve the copy with the page's own Cache-Control, and keep only a GET's 200", async () => {
    const kept = edge();
    const trip = "https://rundata.re/bus/trajet/citalis/12/T-9_1";
    expect(await lire(new Request(trip))).toBeUndefined();
    await garder(new Request(trip), new Response("<p>trajet</p>", { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=30" } }));
    expect(kept.get(trip)?.headers.get("cache-control")).toBe(`public, max-age=${TRAJET_SECONDES}`);
    const r = await lire(new Request(`${trip}?nocache=${Math.random()}`));
    expect(await r?.text()).toBe("<p>trajet</p>");
    expect(r?.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(r?.headers.get("cache-control")).toBe("public, max-age=30");
    expect(r?.headers.get("x-rundata-cache-control")).toBeNull();
    const other = `${trip}?jour=20261026`;
    await garder(new Request(other), new Response("<p>autre jour</p>", { headers: { "content-type": "text/html; charset=utf-8" } }));
    expect((await lire(new Request(other)))?.headers.get("cache-control")).toBeNull();
    await garder(new Request(`${trip}x`), new Response("absent", { status: 404 }));
    await garder(new Request(`${trip}?jour=20261027`, { method: "HEAD" }), new Response("x"));
    await garder(new Request("https://rundata.re/associations/evenements.json"), new Response("{}"));
    expect([...kept.keys()]).toEqual([trip, other]);
    expect(await lire(new Request(trip, { method: "HEAD" }))).toBeUndefined();
  });

  it("build each answer when the Cache API is missing or fails", async () => {
    const url = "https://rundata.re/bus/trajet/citalis/12/T-9_1";
    expect(await lire(new Request(url))).toBeUndefined();
    await garder(new Request(url), new Response("x"));
    vi.stubGlobal("caches", { open: async () => Promise.reject(new Error("indisponible")) });
    expect(await lire(new Request(url))).toBeUndefined();
    await expect(garder(new Request(url), new Response("x"))).resolves.toBeUndefined();
  });
});
