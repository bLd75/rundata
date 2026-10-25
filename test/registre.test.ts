import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENDAS } from "../src/providers/agenda.js";
import { budget, checks, FETCHING, HUBS, PAGE_PATHS, reached, REGISTRY, TOOL_NAMES, type Entry } from "../src/registre.js";
import { SHARED, SHARED_AFTER } from "../src/web/partagees.js";
import { DOMAINS } from "../src/web/site.js";

const ids = new Set(REGISTRY.map((e) => e.id));

describe("the budget's registry (src/registre.ts)", () => {
  it("BUDGET.md is what it writes: run `npx tsx scripts/build-budget.ts` after changing a declaration", () => {
    expect(readFileSync(new URL("../BUDGET.md", import.meta.url), "utf8")).toBe(budget());
  });

  it("has an entry for every shared copy, with its CPU, and its cadences when they depend on the copy", () => {
    for (const s of [...SHARED, ...SHARED_AFTER]) {
      expect(ids.has(s.key), s.key).toBe(true);
      expect(s.cpu, s.key).toBeGreaterThan(0);
      if (typeof s.every !== "number") expect(s.range, s.key).toBeDefined();
    }
  });

  it("has an entry for every page of DOMAINS and every tool of the server, and for every agenda the scheduled event reads", () => {
    expect(Object.keys(DOMAINS).filter((p) => !PAGE_PATHS.domains.includes(p))).toEqual([]);
    expect(PAGE_PATHS.domains.filter((p) => !(p in DOMAINS))).toEqual([]);
    const server = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
    const tools = [...server.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(tools.length).toBeGreaterThan(20);
    expect([...TOOL_NAMES].sort()).toEqual(tools);
    for (const a of AGENDAS.filter((a) => a.planifie)) expect(ids.has(`agenda:${a.id}`), a.id).toBe(true);
  });

  it("reaches every file that reads a site, from files that exist and are not hubs", () => {
    expect(FETCHING.length).toBeGreaterThan(30);
    const all = new Set(REGISTRY.flatMap((e) => reached(e.from)));
    expect(FETCHING.filter((f) => !all.has(f))).toEqual([]);
    for (const e of REGISTRY) for (const f of e.from) {
      expect(existsSync(new URL(`../${f}`, import.meta.url)), `${e.id} : ${f}`).toBe(true);
      expect(HUBS, `${e.id} : ${f}`).not.toContain(f);
    }
  });

  it("keeps every total under its limit", () => {
    for (const c of checks()) expect(c.value, c.what).toBeLessThanOrEqual(c.limit);
  });

  it("would fail a read that passes its limit", () => {
    const runaway: Entry = { id: "essai", trigger: "planifiée", what: "", every: 5, run: { subrequests: 400, cpuMs: 0 }, from: [], basis: "code" };
    expect(checks([...REGISTRY, runaway]).filter((c) => c.value > c.limit).map((c) => c.what)).toContain("pire passage planifié, sous-requêtes");
  });

  it("has unique ids, and a cadence for every scheduled read", () => {
    expect(ids.size).toBe(REGISTRY.length);
    for (const e of REGISTRY.filter((e) => e.trigger === "planifiée")) expect(e.every, e.id).toBeGreaterThan(0);
  });
});
