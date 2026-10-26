import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { fil } from "../src/providers/actualites.js";
import { actualites } from "../src/tools/actualites.js";
import { FICHE_LA1ERE, mentionLa1ere, mentionSports, noteLa1ere } from "../src/tools/non-repris.js";
import { sportTool } from "../src/tools/sport.js";
import { buildActualites } from "../src/web/data.js";
import { actualitesPage, sportPage } from "../src/web/domains.js";

// Sunday 26/10/2026 at 08:00 in La Réunion. France Télévisions' terms (franceinfo.fr/cgu.html, art. 13.2 and 13.3),
// read on 26/10: no automated access to extract or reuse the content of its sites, metadata and titles included.
const NOW = new Date("2026-10-26T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

// Every site answers an empty feed; the hosts asked are kept.
let asked: string[];
function serve() {
  asked = [];
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(new URL(url).hostname);
    return new Response("<rss><channel></channel></rss>");
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("Réunion La 1ère, not read", () => {
  it("is never asked, for the news or for the sport", async () => {
    serve();
    await fil(new Cache(new MemoryStore(), () => NOW.getTime()), NOW);
    await sportTool(new Cache(new MemoryStore(), () => NOW.getTime()), undefined, undefined, undefined, NOW);
    await sportTool(new Cache(new MemoryStore(), () => NOW.getTime()), "football", undefined, undefined, NOW);
    expect(asked.length).toBeGreaterThan(5);
    expect(asked.filter((h) => h.endsWith("franceinfo.fr"))).toEqual([]);
  });

  it("is said in marketing's words: the tools, the pages, sources_donnees", () => {
    expect(mentionLa1ere("actualites")).toBe(
      "Les conditions d'utilisation des sites de France Télévisions, lues le 26/10, interdisent d'en reprendre le contenu par un programme sans son accord écrit, titres compris : rundata.re n'affiche donc pas les informations de Réunion La 1ère. Elles restent sur son site, https://la1ere.franceinfo.fr/reunion/.",
    );
    expect(mentionLa1ere("sport")).toBe(
      "Les conditions d'utilisation des sites de France Télévisions, lues le 26/10, interdisent d'en reprendre le contenu par un programme sans son accord écrit, titres compris : rundata.re n'affiche donc pas l'actualité sportive de Réunion La 1ère, dont le football. Elle reste sur son site, https://la1ere.franceinfo.fr/reunion/sport/.",
    );
    expect(noteLa1ere("actualites")).toBe(
      "Réunion La 1ère n'est pas reprise ici : les conditions d'utilisation des sites de France Télévisions, lues le 26/10, interdisent d'en reprendre le contenu par un programme sans son accord écrit, titres compris. Ses informations sont sur <a href=\"https://la1ere.franceinfo.fr/reunion/\" rel=\"noopener\">la1ere.franceinfo.fr</a>.",
    );
    expect(noteLa1ere("sport")).toBe(
      "L'actualité sportive de Réunion La 1ère n'est pas reprise ici : les conditions d'utilisation des sites de France Télévisions, lues le 26/10, interdisent d'en reprendre le contenu par un programme sans son accord écrit, titres compris. Elle est sur <a href=\"https://la1ere.franceinfo.fr/reunion/sport/\" rel=\"noopener\">la1ere.franceinfo.fr</a>.",
    );
    expect(FICHE_LA1ERE).toEqual({
      nom: "Réunion La 1ère (France Télévisions)",
      statut: "non reprise",
      texte: "Non reprise depuis le 26/10 : les conditions d'utilisation des sites de France Télévisions (art. 13.2) interdisent tout accès automatisé pour en extraire ou en réutiliser le contenu, métadonnées et titres compris, sans son accord écrit. Ses informations, dont le sport, sont sur https://la1ere.franceinfo.fr/reunion/.",
      conditions: "https://www.franceinfo.fr/cgu.html",
    });
  });

  it("is said in an answer for the whole island, or on what it covered, not in every answer on a commune", async () => {
    serve();
    const c = () => new Cache(new MemoryStore(), () => NOW.getTime());
    expect(body(await actualites(c(), undefined, undefined, undefined, NOW)).non_repris).toBe(mentionLa1ere("actualites"));
    expect(body(await actualites(c(), "Saint-Pierre", undefined, undefined, NOW)).non_repris).toBeUndefined();
    expect(body(await sportTool(c(), "football", undefined, undefined, NOW)).non_repris).toBe(mentionLa1ere("sport"));
    expect(body(await sportTool(c(), "basket", "Saint-Pierre", undefined, NOW)).non_repris).toBe(mentionLa1ere("sport"));
    // Volley: only the clubs' calendar not read (test/non-reprises.test.ts), not La 1ère.
    expect(body(await sportTool(c(), "volley", undefined, undefined, NOW)).non_repris).toBe(mentionSports([], true).join(" "));
    const island = body(await sportTool(c(), undefined, undefined, undefined, NOW));
    expect(island.non_repris.startsWith(mentionLa1ere("sport"))).toBe(true);
    expect(island).not.toHaveProperty("actualite");
    expect(island.non_couvert).not.toMatch(/1ère/);
  });

  it("is a note under the sources of /actualites and /sport", async () => {
    serve();
    const data = await buildActualites(new Cache(new MemoryStore(), () => NOW.getTime()), NOW);
    expect(actualitesPage("https://rundata.re", { value: data, fetchedAt: NOW, stale: false }, NOW)).toContain(`<p class="note">${noteLa1ere("actualites")}</p>`);
    const sport = body(await sportTool(new Cache(new MemoryStore(), () => NOW.getTime()), undefined, undefined, undefined, NOW));
    const html = sportPage("https://rundata.re", { value: { ...sport, classements: [] }, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain(`<p class="note">${noteLa1ere("sport")}</p>`);
    expect(html).not.toContain("L'actualité du sport");
  });
});
