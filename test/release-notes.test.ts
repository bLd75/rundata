import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NOUVEAUTES } from "../src/nouveautes.js";
// A plain script, read by the release workflow without an install.
import { notes, textes } from "../scripts/release-notes.mjs";

const source = readFileSync(new URL("../src/nouveautes.ts", import.meta.url), "utf8");

describe("the notes of a release", () => {
  it("read the same changes as src/nouveautes.ts", () => {
    expect(textes(source)).toEqual(NOUVEAUTES.map((n) => n.texte));
  });

  it("list what the previous release did not have, in plain French", () => {
    const previous = source.replace(/^ {2}\{ date: [^\n]*\n/m, "");
    expect(notes(source, previous)).toBe(`## Nouveautés\n\n- ${NOUVEAUTES[0].texte}\n\nToutes les nouveautés : https://rundata.re/nouveautes\n`);
    expect(notes(source, source)).toMatch(/^Pas de nouveauté visible/);
  });
});
