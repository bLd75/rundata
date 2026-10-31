import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PASSES } from "../src/historique/cyclones-passes.js";
import type { CyclonesAnswer } from "../src/web/data.js";
import { carteHtml } from "../src/web/cmrs-carte.js";
import traces from "../src/historique/cyclones-traces.json" with { type: "json" };
import { basinMap, label, TRACES, TRACES_SCRIPT, xy, ZONE_SOURCE } from "../src/web/cyclones-bassin.js";
import { cyclonesPage } from "../src/web/domains.js";
import ocean from "../src/web/ocean.json" with { type: "json" };

const O = "https://rundata.re";
const NOW = new Date("2026-10-31T00:00:00Z");
const at = <T>(value: T) => ({ value, fetchedAt: NOW, stale: false });
const QUIET = {
  resume: "Aucun système actif.", systemes_actifs: [], saison_en_cours: { nom: "2026-2027", systemes: [] }, a_savoir: "", phases_alerte: "", saison: "",
  officiel: "", consulter: {}, sources: [],
} as unknown as CyclonesAnswer;
// An invented system.
const SYS = { nom: "exemple", stade: "tempête tropicale modérée", dernier_avis: "31/10 à 04:00", centre: "CMRS de La Réunion", rapport: "https://www.gdacs.org/" };
const IMAGE = { image: { empreinte: "0123456789abcdef", largeur: 800, hauteur: 600, lue: NOW.toISOString() } };
const active = (carte?: typeof IMAGE) => ({ ...QUIET, resume: "Un système actif.", systemes_actifs: [SYS], carte }) as unknown as CyclonesAnswer;
// Every character a regular expression gives a meaning, backslash included.
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const figure = (html: string) => html.match(/<figure class="card bassin(?: mapcard)?">(.*?)<\/figure>/s)?.[1];

describe("the map of the basin on /cyclones", () => {
  it("says when no system is in the basin, with the tracks and pages of the past cyclones", () => {
    const f = figure(cyclonesPage(O, at(QUIET), NOW))!;
    expect(f).toContain("<b>Aucun système dans le bassin en ce moment.</b>");
    expect(f).toContain(basinMap(true));
    PASSES.forEach((p, i) => {
      const nom = `${p.nom} (${p.slug.slice(-4)})`;
      // Numbered in the list under the map, as on the map: the track and its number by its end.
      expect(f).toContain(`<li><a href="/cyclones/${p.slug}"><span class="nb">${i + 1}</span> ${nom}</a></li>`);
      expect(f).toMatch(new RegExp(`<a href="/cyclones/${p.slug}" tabindex="-1"><title>${reEscape(nom)}</title><path class="hit" d="M[^"]+"/><path d="M[^"]+"/>` +
        `<g class="nb"><circle [^>]+r="22"/><text [^>]+>${i + 1}</text></g></a>`));
    });
    // Their names, over everything else on the map, in the same order.
    expect(f.match(/<g class="tns">(.*?)<\/g>/s)![1].match(/>[^<]+</g)).toEqual(PASSES.map((p) => `>${p.nom} (${p.slug.slice(-4)})<`));
    expect(basinMap(true)).toMatch(/<g class="tns">.*<\/g><\/svg>$/s);
    expect(cyclonesPage(O, at(QUIET), NOW)).toContain(`</figure><script>${TRACES_SCRIPT}</script>`);
    // Météo-France's best track, and IBTrACS for the one before it, each named and linked.
    expect(f).toContain(`Traces\u00a0: <a href="https://www.data.gouv.fr/datasets/historique-des-cyclones-tropicaux-du-sud-ouest-de-locean-indien" rel="noopener">Météo-France (CMRS de La Réunion)</a>, Licence Ouverte 2.0, consultées le ${traces.consulte.split("-").reverse().join("/")}. ` +
      `Hyacinthe (1980) est plus ancienne que ces données, qui commencent en 1986\u00a0: sa trace vient des positions du CMRS reprises par <a href="https://www.ncei.noaa.gov/products/international-best-track-archive" rel="noopener">NOAA IBTrACS</a>. Cette carte ne montre aucun système de la saison. `);
    expect(f).not.toContain("provisoire");
  });

  it("sends to the RSMC's own map, above it, while a system is watched", () => {
    const html = cyclonesPage(O, at(active(IMAGE)), NOW);
    expect(figure(html)).toContain('Un système est suivi par le CMRS : <a href="#carte-cmrs">sa carte officielle est au-dessus</a>');
    expect(carteHtml(IMAGE, NOW)).toContain('<figure class="card mf-carte" id="carte-cmrs">');
    expect(html.indexOf('id="carte-cmrs"')).toBeLessThan(html.indexOf('class="card bassin"'));
    expect(figure(html)).not.toContain("Aucun système");
  });

  it("is the hero's map without a system, as on the other pages, and stays under the RSMC's map with one", () => {
    const hero = (html: string) => html.slice(html.indexOf('<div class="wrap intro">'), html.indexOf('<section aria-labelledby="h-actifs">'));
    for (const html of [cyclonesPage(O, at(QUIET), NOW), cyclonesPage(O, null, NOW)]) {
      expect(hero(html)).toMatch(/<\/div>\s*<figure class="card bassin mapcard">.*<\/figure>/s);
      expect(html.match(/class="card bassin/g)).toHaveLength(1);
    }
    // The script of the tracks follows them into the hero.
    expect(hero(cyclonesPage(O, at(QUIET), NOW))).toContain(`</figure><script>${TRACES_SCRIPT}</script>`);
    for (const html of [cyclonesPage(O, at(active(IMAGE)), NOW), cyclonesPage(O, at(active()), NOW)]) {
      expect(hero(html)).not.toContain("bassin");
      expect(html).toContain('<figure class="card bassin">');
    }
  });

  it("sends to Météo-France's site when the RSMC's map is not shown", () => {
    const f = figure(cyclonesPage(O, at(active()), NOW))!;
    expect(f).toContain("Un système est suivi par le CMRS :");
    expect(f).toContain('href="https://meteofrance.re/fr/cyclone"');
    expect(f).not.toContain("au-dessus");
  });

  it("says nothing of the systems before the data is read", () => {
    const f = figure(cyclonesPage(O, null, NOW))!;
    expect(f).not.toMatch(/Aucun système dans|est suivi/);
    expect(f).toContain(basinMap());
  });

  it("never draws a system of the season, and no track at all while one is watched", () => {
    for (const d of [active(IMAGE), active()]) {
      const f = figure(cyclonesPage(O, at(d), NOW))!;
      expect(f).toContain(basinMap());
      expect(f).not.toContain('class="trc"');
      expect(f).not.toContain("<script>");
      expect(f).toContain("Cette carte ne montre aucun système, ni sa position ni sa trajectoire.");
    }
    expect(basinMap()).not.toContain('class="trc"');
    expect(label(false)).toContain("Cette carte ne montre aucun système.");
    expect(label(true)).toContain("En traits numérotés, la trace des cyclones passés\u00a0: 1, Garance (2025)\u00a0; 2, Belal (2024)");
    expect(label(true)).toContain("Aucun système de la saison n'y est dessiné.");
    expect(figure(cyclonesPage(O, at(QUIET), NOW))).toContain("Cette carte ne montre aucun système de la saison.");
  });

  it("draws each past cyclone's track as the RSMC gave it, the line only", () => {
    expect(Object.keys(traces.traces).sort()).toEqual(PASSES.map((p) => p.slug).sort());
    expect(traces.consulte).toMatch(/^\d{4}-\d\d-\d\d$/);
    // Météo-France's own from its first season, 1986-1987; IBTrACS only before it.
    for (const [slug, t] of Object.entries(traces.traces)) {
      expect(t.source, slug).toBe(Number(slug.slice(-4)) >= 1987 ? "meteo-france" : "ibtracs");
      expect(Object.keys(t).filter((k) => !["source", t.source === "ibtracs" ? "ibtracs" : "idswi", "du", "au", "points"].includes(k))).toEqual([]);
      expect(t.points.length).toBeGreaterThan(10);
      for (const [lon, lat] of t.points) expect(lon > 20 && lon < 100 && lat < 0 && lat > -50).toBe(true);
    }
    // Each one passes by La Réunion: within 3° of it.
    for (const t of TRACES) expect(Math.min(...t.points.map(([lon, lat]) => Math.hypot(lon - 55.53, lat + 21.13))), t.slug).toBeLessThan(3);
    expect(basinMap(true)).not.toMatch(/km\/h|hPa|nœuds|vent|rafale/i);
  });

  it("dots the RSMC's zone along the equator, 90° E and 40° S, its limits sourced", () => {
    const zone = basinMap().match(/<path class="zone" d="([^"]+)"/)![1];
    expect(zone).toContain(`L${xy(90, 0).join(" ")}L${xy(90, -40).join(" ")}`);
    expect(zone.startsWith(`M${xy(42.1, 0).join(" ")}`)).toBe(true);
    expect(figure(cyclonesPage(O, at(QUIET), NOW))).toContain(`<a href="${ZONE_SOURCE}" rel="noopener">`);
  });

  it("names La Réunion and the lands around, inline and light", () => {
    const map = basinMap(true);
    for (const nom of ["La Réunion", "Madagascar", "Afrique", "Maurice", "Rodrigues", "Mayotte", "Comores", "Seychelles"]) expect(map).toContain(`>${nom}</text>`);
    expect(map).not.toMatch(/<image/);
    expect(gzipSync(map).length).toBeLessThan(15_000);
    expect(ocean.attribution).toBe("Natural Earth (domaine public)");
  });
});
