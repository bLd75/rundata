import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The team's own tracker is not public: neither its name nor its numbers anywhere in the repo, code, comments, test
// names or docs. A comment says what it fixes, or points to the PR (#272). The word is built here, never written,
// for this file to pass its own test.
const INTERNAL = new RegExp(["cam", "change"].join("[- ]?"), "i");
const SKIPPED = new Set([".git", "node_modules"]);

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    SKIPPED.has(e.name) ? [] : e.isDirectory() ? files(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []);

/** The lines of a text file that name the tracker, as « path:line »; a binary file (a NUL byte) is not read. */
function named(path: string): string[] {
  const text = readFileSync(path, "utf8");
  if (text.includes("\0")) return [];
  return text.split("\n").flatMap((line, i) => (INTERNAL.test(line) ? [`${path}:${i + 1}`] : []));
}

describe("no internal reference in the repo", () => {
  it("is in no file: code, comments, test names, docs", () => {
    const all = files(".");
    expect(all.filter((p) => p.startsWith("src")).length).toBeGreaterThan(100);
    expect(all.flatMap(named)).toEqual([]);
  });

  it("would catch it again", () => {
    for (const s of ["(cam" + "-change 273)", "cam" + " change 286", "Cam" + "Change", "describe(\"after a deploy (cam" + "-change 285)\""]) expect(INTERNAL.test(s)).toBe(true);
    expect(INTERNAL.test("camera change")).toBe(false);
    expect(INTERNAL.test("(#272)")).toBe(false);
  });
});
