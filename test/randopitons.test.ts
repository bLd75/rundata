import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as traces from "../src/providers/traces.js";
import { SECTEURS } from "../src/traces/secteurs.js";
import type { SentiersAnswer } from "../src/web/data.js";
import { RANDOPITONS, sentiersPage, tracePage } from "../src/web/domains.js";
import { secteurPage } from "../src/web/randonnees.js";

const O = "https://rundata.re";
const NOW = new Date("2026-10-30T04:00:00Z");
const LINE = `<p class="note">Fiches détaillées, photos et avis de randonneurs : <a href="https://randopitons.re/" target="_blank" rel="noopener">Randopitons<span aria-hidden="true"> ↗</span></a></p>`;
const answer = { resume: "", fermes_par_commune: [], routes_forestieres_fermees: [], a_savoir: [], sources: [], suivis: 351, randonnees: [], points: [] } as unknown as SentiersAnswer;

/** Every link to Randopitons of a page: its home page only, opened in a new tab. */
const links = (html: string) => [...html.matchAll(/<a [^>]*href="https?:\/\/(?:www\.)?randopitons[^"]*"[^>]*>/g)].map((m) => m[0]);

describe("the link to Randopitons", () => {
  it("is on /sentiers, under the hikes, with or without the ONF's map", () => {
    for (const data of [{ value: answer, fetchedAt: NOW, stale: false }, null]) {
      const html = sentiersPage(O, data, NOW);
      expect(html).toContain(LINE);
      expect(links(html)).toEqual([`<a href="${RANDOPITONS}" target="_blank" rel="noopener">`]);
    }
  });

  it("is on each sector's page and each hike's page, once", () => {
    for (const s of SECTEURS) expect(links(secteurPage(O, s, null, null, NOW))).toHaveLength(1);
    for (const r of traces.RANDONNEES) {
      const html = tracePage(O, "randonnee", r.slug, r.nom, null, NOW);
      expect(html).toContain(LINE);
      expect(links(html)).toHaveLength(1);
    }
  });

  it("is not on an ONF trail's page (/sentiers/<slug>)", () => {
    const [nom, t] = Object.entries(traces.SENTIERS)[0];
    expect(links(tracePage(O, "sentier", t.slug, nom, null, NOW))).toEqual([]);
  });

  it("is never read, nor named a source: only the pages' helper knows its address", () => {
    const named = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? named(join(dir, e.name)) : /\.ts$/.test(e.name) && /randopitons\.re/i.test(readFileSync(join(dir, e.name), "utf8")) ? [join(dir, e.name)] : []);
    expect(named("src")).toEqual([join("src", "web", "domains.ts")]);
  });
});
