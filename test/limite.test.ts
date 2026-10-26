import { afterEach, describe, expect, it, vi } from "vitest";
import { type Limiteur, MESSAGE_FORMULAIRE, PAR_MINUTE, refuse, sorteDe } from "../src/limite.js";

/** A binding that lets `n` calls through per key, then refuses; it records the keys. */
function compteur(n: number): Limiteur & { keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { success: (counts.get(key) ?? 0) <= n };
    },
  };
}

const req = (path: string, method = "POST", ip = "203.0.113.7") =>
  new Request(`https://rundata.re${path}`, { method, headers: ip ? { "cf-connecting-ip": ip } : {}, body: method === "POST" ? "{}" : undefined });

describe("the rate limit, per address", () => {
  afterEach(() => vi.restoreAllMocks());

  it("counts the calls to /mcp and the forms' sends, nothing else", () => {
    for (const p of ["/mcp", "/mcp/"]) expect(sorteDe(req(p))).toBe("mcp");
    for (const p of ["/avis", "/associations/lien", "/associations/proposer", "/associations/relier/confirmer", "/associations/proposition/AbC"]) expect(sorteDe(req(p))).toBe("formulaire");
    for (const r of [req("/mcp", "GET"), req("/mcp/", "GET"), req("/avis", "GET"), req("/associations"), req("/csp-rapport"), req("/volcan", "GET")]) expect(sorteDe(r)).toBeUndefined();
  });

  it("answers 429 with Retry-After past the threshold: JSON-RPC with CORS on /mcp, a sentence on a form", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mcp = compteur(2);
    const formulaire = compteur(1);
    const t = Date.parse("2026-10-26T17:00:00Z");
    expect(await refuse(req("/mcp"), { mcp, formulaire }, t)).toBeUndefined();
    expect(await refuse(req("/mcp"), { mcp, formulaire }, t)).toBeUndefined();
    const r = await refuse(req("/mcp"), { mcp, formulaire }, t);
    expect(r?.status).toBe(429);
    expect(r?.headers.get("retry-after")).toBe("60");
    expect(r?.headers.get("access-control-allow-origin")).toBe("*");
    expect(await r?.json()).toEqual({ jsonrpc: "2.0", error: { code: -32000, message: "Too many requests from this address. Retry in 60 seconds." }, id: null });
    expect(mcp.keys).toEqual(["mcp:203.0.113.7", "mcp:203.0.113.7", "mcp:203.0.113.7"]);
    // Another address is counted apart; the forms have their own count.
    expect(await refuse(req("/mcp", "POST", "198.51.100.2"), { mcp, formulaire }, t)).toBeUndefined();
    expect(await refuse(req("/avis"), { mcp, formulaire }, t)).toBeUndefined();
    const f = await refuse(req("/associations/lien"), { mcp, formulaire }, t);
    expect(f?.status).toBe(429);
    expect(f?.headers.get("retry-after")).toBe("60");
    expect(f?.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await f?.text()).toBe(MESSAGE_FORMULAIRE);
    expect(MESSAGE_FORMULAIRE).not.toMatch(/\d/);
    expect(formulaire.keys).toEqual(["formulaire:203.0.113.7", "formulaire:203.0.113.7"]);
  });

  it("says it once a minute per kind, whatever the refusals", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mcp = compteur(0);
    const t = Date.parse("2026-10-26T18:00:00Z");
    for (let i = 0; i < 5; i++) expect((await refuse(req("/mcp"), { mcp }, t + i * 1000))?.status).toBe(429);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toBe(`limite de débit : mcp, une adresse au-delà de ${PAR_MINUTE.mcp} par minute`);
    expect(String(warn.mock.calls[0][0])).not.toContain("203.0.113.7");
    await refuse(req("/mcp"), { mcp }, t + 60_000);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("refuses nothing without the binding, without an address, or when the binding fails", async () => {
    const mcp = compteur(0);
    expect(await refuse(req("/mcp"), {})).toBeUndefined();
    expect(await refuse(req("/mcp", "POST", ""), { mcp })).toBeUndefined();
    expect(mcp.keys).toEqual([]);
    const broken: Limiteur = { limit: () => Promise.reject(new Error("indisponible")) };
    expect(await refuse(req("/mcp"), { mcp: broken })).toBeUndefined();
  });
});
