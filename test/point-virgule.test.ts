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

const files = (dir: string, ext: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), ext) : e.name.endsWith(ext) ? [join(dir, e.name)] : []));
const sources = (dir: string) => files(dir, ".ts");

/** The strings of a JSON value with « ; » after an ordinary space, as « path:key ». */
const plainIn = (path: string, value: unknown, key = ""): string[] =>
  typeof value === "string" ? (/ ;/.test(value) ? [`${path}:${key}`] : [])
  : Array.isArray(value) ? value.flatMap((v) => plainIn(path, v, key))
  : value && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => [...plainIn(path, k, key), ...plainIn(path, v, k)])
  : [];

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

  // The bundled data the tools quote, written by scripts/build-*.py: the sources, the attributions, the opening hours.
  it("is in every text of the data bundled with the server", () => {
    const data = files("src", ".json");
    expect(data.length).toBeGreaterThan(10);
    expect(data.flatMap((p) => plainIn(p, JSON.parse(readFileSync(p, "utf8"))))).toEqual([]);
  });

  it("would catch an ordinary one again", () => {
    expect(PLAIN.test("Pluie à Gillot ; 2 mm")).toBe(true);
    expect(PLAIN.test(`list.join(" ; ")`)).toBe(true);
    expect(PLAIN.test(`"Pluie à Gillot ;" + rest`)).toBe(true);
    expect(plainIn("x.json", { attribution: "© OpenStreetMap (ODbL) ; IGN" })).toEqual(["x.json:attribution"]);
    expect(plainIn("x.json", [{ horaires: "lundi\u00a0; mardi" }])).toEqual([]);
    expect(PLAIN.test("Pluie à Gillot ; 2 mm")).toBe(false);
    expect(PLAIN.test("const r = d.find((x) => x.ok) ;")).toBe(false);
    expect(PLAIN.test("for (let runs = 1; ; runs++) {")).toBe(false);
  });
});
