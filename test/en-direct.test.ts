import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// marketing's rule: « en direct », never « en temps réel », in all that is said: pages, meta, the tools' answers and
// descriptions, the sources' names, the README. Names stay as they are: the package and the MCP server
// (reunion-temps-reel, re.rundata/temps-reel), the JSON keys (temps_reel), a dataset's URL. Comments are not said, nor
// what check-sources tells the team (marketing, 25/10).
const INTERNAL = ["src/bin/check-sources.ts"];
const SAID = /temps[ -]r[ée]els?/i;
const NAMES = /reunion-temps-reel|rundata\/temps-reel|temps_reel|horaires-temps-reel|reglementes\/temps-reel/g;
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));

/** The lines of `path` that say « temps réel », as « path:line ». */
function said(path: string, code: boolean): string[] {
  return readFileSync(path, "utf8").split("\n").flatMap((line, i) => {
    if (code && COMMENT.test(line)) return [];
    // A comment at the end of a line of code: « // » after a space (an URL's « :// » is not one).
    const text = (code ? line.replace(/\s\/\/\s.*$/, "") : line).replace(NAMES, "");
    return SAID.test(text) ? [`${path}:${i + 1}`] : [];
  });
}

describe("« en direct », never « temps réel »", () => {
  it("is in no text of the code nor of the README", () => {
    expect([...sources("src").filter((p) => !INTERNAL.includes(p)).flatMap((p) => said(p, true)), ...said("README.md", false)]).toEqual([]);
  });

  it("would catch it again", () => {
    expect(SAID.test("Bus en temps réel".replace(NAMES, ""))).toBe(true);
    expect(SAID.test("Flux temps-reel".replace(NAMES, ""))).toBe(true);
    expect(SAID.test("TEMPS RÉEL".replace(NAMES, ""))).toBe(true);
    expect(SAID.test("reunion-temps-reel 0.181.3".replace(NAMES, ""))).toBe(false);
  });
});
