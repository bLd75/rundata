import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { fil, parseRss } from "../src/providers/actualites.js";
import { actualites } from "../src/tools/actualites.js";
import { buildActualites } from "../src/web/data.js";
import { actualitesPage } from "../src/web/domains.js";
import { fenetre } from "../src/web/map.js";

// Saturday 24/10/2026 at 12:05 in La Réunion. Freedom's terms allow a link to its home page only, « dans une nouvelle
// fenêtre »: its items link there, and a page opens it in a new window.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/actualites/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T08:05:00Z");
const HOME = "https://www.freedom.fr/";
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());

// Freedom and Clicanoo answer; the other sites do not.
function serve() {
  vi.stubGlobal("fetch", async (url: string) => {
    const f = url.includes("freedom") ? "freedom.xml" : url.includes("clicanoo") ? "clicanoo.xml" : undefined;
    return f ? new Response(fixture(f)) : new Response("", { status: 503 });
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("Freedom, linked to its home page", () => {
  it("links each of its items to its home page, and the other media to their articles", () => {
    const freedom = parseRss(fixture("freedom.xml"), "Freedom", /jeux|podcast|actus radio/i);
    expect(freedom.length).toBeGreaterThan(5);
    expect(freedom.every((i) => i.lien === HOME)).toBe(true);
    const clicanoo = parseRss(fixture("clicanoo.xml"), "Clicanoo");
    expect(clicanoo.every((i) => i.lien.startsWith("https://www.clicanoo.re/") && i.lien !== "https://www.clicanoo.re/")).toBe(true);
  });

  it("keeps every item of Freedom, though they share one link", async () => {
    serve();
    const titles = new Set(parseRss(fixture("freedom.xml"), "Freedom", /jeux|podcast|actus radio/i).map((i) => i.titre));
    const kept = (await fil(cache(), NOW)).value.infos.filter((i) => i.media === "Freedom" || i.aussi?.some((a) => a.media === "Freedom"));
    expect(kept.length).toBeGreaterThan(5);
    expect(new Set(kept.filter((i) => i.media === "Freedom").map((i) => i.titre)).size).toBe(kept.filter((i) => i.media === "Freedom").length);
    expect(kept.filter((i) => i.media === "Freedom").every((i) => titles.has(i.titre))).toBe(true);
  });

  it("says beside each of its items in the tool's answer that the link is its home page, and nothing beside the others", async () => {
    serve();
    const rows: { media: string; lien: string; lien_accueil?: string }[] = JSON.parse((await actualites(cache(), undefined, undefined, undefined, NOW)).content[0].text).infos;
    const freedom = rows.filter((r) => r.media === "Freedom");
    expect(freedom.length).toBeGreaterThan(0);
    expect(freedom.every((r) => r.lien === HOME && r.lien_accueil === "Freedom n'autorise qu'un lien vers son accueil\u00a0; l'article y est sous ce titre")).toBe(true);
    expect(rows.filter((r) => r.media !== "Freedom").every((r) => r.lien_accueil === undefined)).toBe(true);
  });

  it("opens its home page in a new window, and the other links in the same", async () => {
    expect(fenetre(HOME)).toBe(' target="_blank"');
    expect(fenetre("https://www.clicanoo.re/article/x")).toBe("");
    expect(fenetre(undefined)).toBe("");
    serve();
    const data = await buildActualites(cache(), NOW);
    const html = actualitesPage("https://rundata.re", { value: data, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain(`<a href="${HOME}" rel="noopener" target="_blank">`);
    expect(html).not.toMatch(/href="https:\/\/(?:www\.)?freedom\.fr\/[^"]/);
    expect(html).toMatch(/<a href="https:\/\/www\.clicanoo\.re\/[^"]+" rel="noopener">/);
  });
});
