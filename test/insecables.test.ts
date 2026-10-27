import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { insecables } from "../src/typographie.js";

const rpc = (method: string, params: unknown) =>
  new Request("https://rundata.re/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
const rpcResult = async (method: string, params: unknown = {}) => (await (await handle(rpc(method, params), new Cache())).json()).result;

/** The strings of a JSON value. */
const strings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];

// What must not be left: an ordinary space before « : ; ? ! » or after « «, or between a figure and its unit.
const PLAIN = / [:;?!»]|« |\d (?:%|°C|km\/h|km|mm|MW|€)(?![\p{L}\d])/u;

describe("the no-break spaces, one rule for the pages and the assistants (typographie.ts)", () => {
  it("before « : ; ? ! » », inside the quotation marks, after « à » before a figure", () => {
    expect(insecables("Vigilance : orange ; pluie ? Oui ! « Ne montez pas »")).toBe("Vigilance : orange ; pluie ? Oui ! « Ne montez pas »");
    expect(insecables("Lu à 08:00, station à 3 km, voilà 3 fois, à pied")).toBe("Lu à 08:00, station à 3 km, voilà 3 fois, à pied");
  });

  it("between a figure and its unit, as the audit of 26/10 found them, not before a word", () => {
    expect(insecables("39 %, 16,8 mm, 429 MW, 2,00 €, 1,4 km, 24 °C, 30 km/h, 18,86 €/m², 52 m², 0 mm, 18 h 12")).toBe(
      "39 %, 16,8 mm, 429 MW, 2,00 €, 1,4 km, 24 °C, 30 km/h, 18,86 €/m², 52 m², 0 mm, 18 h 12",
    );
    expect(insecables("3 matchs, 2 mois, 5 hôtels, 12 minutes, 4 mm2")).toBe("3 matchs, 2 mois, 5 hôtels, 12 minutes, 4 mm2");
  });

  it("between the thousands of a quantity, never of a date, an hour, a phone number or a year", () => {
    expect(insecables("3 070 m, 1 000 km, 5 230 articles, 12 500,5 t, 1 000 000")).toBe("3 070 m, 1 000 km, 5 230 articles, 12 500,5 t, 1 000 000");
    for (const kept of ["le 26/10 100 fois", "08:00 100 fois", "+262 262 12 34 56", "0 800 333 974", "en 2025 100 fois", "0,5 100 fois", "A4 000"]) expect(insecables(kept)).toBe(kept);
    // Already written by hand: left as it is.
    expect(insecables("3 070 m")).toBe("3 070 m");
  });

  it("leaves a text without them as it is, and the JSON of an answer valid", () => {
    const s = "rien à changer ici";
    expect(insecables(s)).toBe(s);
    const json = JSON.stringify({ resume: "Pluie : 3 mm ; vent 30 km/h", n: 1000, liste: [1, 2], lien: "https://rundata.re/meteo?ref=mcp" }, null, 1);
    expect(JSON.parse(insecables(json))).toEqual({ resume: "Pluie : 3 mm ; vent 30 km/h", n: 1000, liste: [1, 2], lien: "https://rundata.re/meteo?ref=mcp" });
  });
});

describe("the assistants' side", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline (test)");
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("says the tools' descriptions with them", async () => {
    const tools: { name: string; description: string }[] = (await rpcResult("tools/list")).tools;
    expect(tools.length).toBeGreaterThan(20);
    expect(tools.filter((t) => PLAIN.test(t.description)).map((t) => t.name)).toEqual([]);
  });

  it("says every text of an answer with them, its fixed parts as well (serveur.si_outil_absent)", async () => {
    const r = await rpcResult("tools/call", { name: "sources_donnees", arguments: {} });
    const answer = JSON.parse(r.content[0].text);
    expect(answer.serveur.si_outil_absent).toContain("liste ?");
    expect(strings(answer).filter((x) => PLAIN.test(x))).toEqual([]);
  });
});
