import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIENS } from "../src/eau/distributeurs.js";
import { LISIBLES, servis } from "../src/providers/agenda.js";

// Le Tampon, Petite-Île and Saint-Benoît: their sites' terms forbid a deep link, or submit any link to their agreement.
// Until they answer our letters, rundata.re links to their home page only, never to a page of their site.
const ACCUEIL_SEUL: Record<string, string> = { "letampon.fr": "Le Tampon", "petite-ile.re": "Petite-Île", "saint-benoit.re": "Saint-Benoît" };
// The addresses read on their sites (agendas), never shown as a link: each event links to the home page (`accueil`).
const LUES = new Set([
  "https://letampon.fr/agenda/feed/",
  "https://www.petite-ile.re/actualites/agenda/",
  "https://www.saint-benoit.re/evenements/general",
]);

const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []));

describe("links to the sites of Le Tampon, Petite-Île and Saint-Benoît", () => {
  it("go to their home page only, anywhere in src/ and public/", () => {
    const all = [...files("src"), ...files("public")];
    expect(all.length).toBeGreaterThan(100);
    const deep = all.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      if (text.includes("\0")) return [];
      return [...text.matchAll(/https?:\/\/[^\s"'`<>)\]]+/g)].flatMap(([url]) => {
        let u: URL;
        try { u = new URL(url); } catch { return []; }
        if (!(hostOf(url) in ACCUEIL_SEUL)) return [];
        return u.pathname === "/" && !u.search && !u.hash ? [] : LUES.has(url) ? [] : [`${path}: ${url}`];
      });
    });
    expect(deep).toEqual([]);
  });

  it("from the water page of the commune", () => {
    for (const [commune, l] of Object.entries(LIENS)) {
      if (hostOf(l.site) in ACCUEIL_SEUL) expect(`${commune}: ${new URL(l.site).pathname}`).toBe(`${commune}: /`);
    }
    expect(LIENS["Petite-Île"].site).toBe("https://www.petite-ile.re/");
  });

  it("from each event of their agendas, whatever the link read", () => {
    // Their own agendas, read on their sites (not a hall of the commune, which has its own site).
    const theirs = LISIBLES.filter((a) => a.site_commune && Object.values(ACCUEIL_SEUL).includes(a.commune ?? ""));
    expect(theirs.map((a) => a.commune).sort()).toEqual(["Le Tampon", "Petite-Île", "Saint-Benoît"]);
    for (const a of theirs) {
      expect(a.accueil && new URL(a.accueil).pathname).toBe("/");
      const [e] = servis(a, [{ id: "x", titre: "Fête", seances: [{ debut: "2026-10-30" }], commune: a.commune!, categories: [], lien: `${a.accueil}actualites/agenda/fete`, publie_par: a.nom }]);
      expect(e.lien).toBe(a.accueil);
    }
  });

  it("would catch a deep link again", () => {
    const deep = (url: string) => hostOf(url) in ACCUEIL_SEUL && new URL(url).pathname !== "/" && !LUES.has(url);
    expect(deep("https://www.petite-ile.re/actualites/news")).toBe(true);
    expect(deep("https://www.saint-benoit.re/evenements/general/fete")).toBe(true);
    expect(deep("https://www.petite-ile.re/")).toBe(false);
    expect(deep("https://www.ville-saintemarie.re/agenda/")).toBe(false);
  });
});
