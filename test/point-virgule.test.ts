import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// marketing's rule: a no-break space before « ; », as before « : ? ! », in all that is said. The site's pages get it as
// they are sent (web/typo.ts), so src/web is left out, but for what is not a page: the feeds and the data files. Comments
// are not said, nor the scheduled run's log (worker.ts). The NOUVEAUTES already published keep their text: the release
// notes find the new ones by their text (scripts/release-notes.mjs).
const NOT_PAGES = ["src/web/rss.ts", "src/web/data.ts"];
const INTERNAL = ["src/worker.ts"];
const PUBLISHED = "2026-10-26";
// Before a space or the end of a string; not the empty clause of a loop, « for (let i = 1; ; i++) ».
const PLAIN = /[^;] ;(?=[ "'`])/;
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));

/** The lines of `path` with « ; » after an ordinary space, as « path:line ». */
function plain(path: string): string[] {
  return readFileSync(path, "utf8").split("\n").flatMap((line, i) => {
    if (COMMENT.test(line)) return [];
    if (path === "src/nouveautes.ts" && (/date: "([\d-]{10})/.exec(line)?.[1] ?? PUBLISHED) < PUBLISHED) return [];
    // A comment at the end of a line of code: « // » after a space (an URL's « :// » is not one).
    return PLAIN.test(line.replace(/\s\/\/\s.*$/, "")) ? [`${path}:${i + 1}`] : [];
  });
}

describe("a no-break space before « ; »", () => {
  it("is in every text of the tools, the feeds and the data files", () => {
    const said = sources("src").filter((p) => (!p.startsWith("src/web/") || NOT_PAGES.includes(p)) && !INTERNAL.includes(p));
    expect(said.length).toBeGreaterThan(100);
    expect(said.flatMap(plain)).toEqual([]);
  });

  it("would catch an ordinary one again", () => {
    expect(PLAIN.test("Pluie à Gillot ; 2 mm")).toBe(true);
    expect(PLAIN.test(`list.join(" ; ")`)).toBe(true);
    expect(PLAIN.test(`"Pluie à Gillot ;" + rest`)).toBe(true);
    expect(PLAIN.test("Pluie à Gillot ; 2 mm")).toBe(false);
    expect(PLAIN.test("const r = d.find((x) => x.ok) ;")).toBe(false);
    expect(PLAIN.test("for (let runs = 1; ; runs++) {")).toBe(false);
  });
});
