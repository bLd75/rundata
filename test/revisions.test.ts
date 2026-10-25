import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { familyOf, RENDU_REVISION } from "../src/web/revisions.js";

// Every source file, for the copies' keys it names: `"web:volcan"`, `` `web:lieu:${slug}` ``, `` `web:${dir}:${slug}` ``.
const SRC = new URL("../src/", import.meta.url);
const files = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts"));
const named = new Set<string>();
for (const f of files) {
  const text = readFileSync(new URL(f, SRC), "utf8");
  for (const m of text.matchAll(/["`]web:([a-z0-9-]+)/g)) named.add(m[1]);
}

describe("the revisions of the pages' copies (cam-change 286)", () => {
  it("list every family of copy the code names, so that none is built again at every deploy unnoticed", () => {
    expect(named.size).toBeGreaterThan(20);
    expect([...named].filter((f) => !(f in RENDU_REVISION)).sort()).toEqual([]);
  });

  it("list no family the code no longer names", () => {
    expect(Object.keys(RENDU_REVISION).filter((f) => !named.has(f)).sort()).toEqual([]);
  });

  it("are whole numbers from 1", () => {
    for (const [family, n] of Object.entries(RENDU_REVISION)) expect(Number.isInteger(n) && n >= 1, family).toBe(true);
  });

  it("cover the copies of the trails and walks, named by their directory", () => {
    // site.ts builds `web:${dir}:${slug}` with dir "sentiers" or "randonnees".
    expect(familyOf("web:sentiers:piton-des-neiges")).toBe("sentiers");
    expect(RENDU_REVISION.sentiers && RENDU_REVISION.randonnees).toBeTruthy();
  });
});
