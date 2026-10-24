import { describe, expect, it } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { kmh, mesures, PASSES, passeOf, RAIN_NOTE, records } from "../src/historique/cyclones-passes.js";
import { cyclones } from "../src/tools/cyclones.js";
import { metaOf, passePage, titleOf } from "../src/web/cyclones-passes.js";
import { cyclonesPage } from "../src/web/domains.js";

const NOW = new Date("2026-10-24T10:00:00Z");
const passe = (slug: string) => PASSES.find((p) => p.slug === slug)!;
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

describe("past cyclones", () => {
  it("keeps Météo-France's gusts in m/s and says them in km/h", () => {
    expect(kmh(77)).toBe(277);
    expect(kmh(61)).toBe(220);
    const dina = mesures(passe("dina-2002"));
    expect(dina.jours).toEqual(["2002-01-21", "2002-01-22", "2002-01-23"]);
    expect(dina.stations[0]).toMatchObject({ station: "Plaine des Chicots", rr: [50.6, 1385, 600.4], record_rr: { jour: "2002-01-22", depuis: 1982 } });
  });

  it("lists the station records the passage beat, and none when it beat none", () => {
    expect(records(passe("garance-2025")).map((r) => [r.station, r.quoi, r.depuis])).toEqual([
      ["Dos d'Âne", "pluie", 2023],
      ["Colorado", "pluie", 2003],
      ["Saint-Benoît", "rafale", 1987],
      ["Bellevue Bras-Panon", "rafale", 1990],
      ["Le Baril", "rafale", 1989],
    ]);
    expect(records(passe("batsirai-2022"))).toEqual([]);
    expect(metaOf(passe("garance-2025"))).toBe("🇷🇪 Cyclone Garance (février 2025) à La Réunion (974) : pluie et rafales mesurées station par station par Météo-France, et les records battus.");
    expect(metaOf(passe("batsirai-2022"))).not.toContain("records");
  });

  it("finds the cyclone a question names", () => {
    expect(passeOf("cyclone Dina")?.slug).toBe("dina-2002");
    expect(passeOf("Garance 2025")?.slug).toBe("garance-2025");
    expect(passeOf("batsirai-2022")?.slug).toBe("batsirai-2022");
    expect(passeOf("Firinga")).toBeUndefined();
    expect(passeOf("Dinamo")).toBeUndefined();
  });

  it("has a page with its source, the measures, the rain note and the links", () => {
    const html = passePage("https://rundata.re", passe("garance-2025"));
    expect(html).toContain(`<title>${titleOf(passe("garance-2025"))}</title>`);
    expect(html).toContain("<title>Cyclone Garance 2025 : pluie et vent mesurés · Réunion 974</title>");
    expect(html).toContain("<h1>Cyclone Garance, 28 février 2025</h1>");
    expect(html).toContain('href="https://www.reunion.developpement-durable.gouv.fr/IMG/pdf/1a_meteo_france_bilan_saison_cyclonique.pdf"');
    expect(html).toContain("Pluie du jour : cumul mesuré de 10 h ce jour-là à 10 h le lendemain (heure de La Réunion), comme le compte Météo-France.");
    expect(html).toContain("<summary>Les 54 autres stations</summary>");
    expect(html).toContain("<b>Gros Piton Sainte-Rose</b> : 234 km/h (64,9 m/s) le 28/02/2025");
    expect(html).toContain('<a href="/cyclones">');
    expect(html).toContain('<a href="/alerte-cyclone">');
    expect(html).not.toMatch(/victime|mort|dégât|sinistr|foyers/i);
    // The alert only where an official document that was read says it.
    expect(html).not.toContain('id="h-alerte"');
    expect(passePage("https://rundata.re", passe("batsirai-2022"))).toContain("« 38h d&#39;alerte rouge à La Réunion »");
  });

  it("is served, in the sitemap and listed on /cyclones", async () => {
    const cache = new Cache();
    const r = await handle(new Request("https://rundata.re/cyclones/dina-2002", { headers: { accept: "text/html" } }), cache);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("<h1>Cyclone Dina, 22 et 23 janvier 2002</h1>");
    expect((await handle(new Request("https://rundata.re/cyclones/hyacinthe-1980", { headers: { accept: "text/html" } }), cache)).status).toBe(404);
    const map = await (await handle(new Request("https://rundata.re/sitemap.xml"), cache)).text();
    for (const p of PASSES) expect(map).toContain(`<loc>https://rundata.re/cyclones/${p.slug}</loc>`);
    expect(cyclonesPage("https://rundata.re", null, NOW)).toContain('<li><a href="/cyclones/garance-2025">Cyclone Garance, 28 février 2025</a></li>');
  });

  it("is answered by the cyclones tool with the measures, in m/s too, and the page", async () => {
    const b = body(await cyclones(new Cache(), undefined, NOW, "le cyclone Dina"));
    expect(b.cyclone).toBe("Dina (2002)");
    expect(b.pluie_du_jour).toBe(RAIN_NOTE);
    expect(b.stations_les_plus_arrosees[0]).toEqual({ station: "Plaine des Chicots", altitude_m: 1834, pluie_mm: { "21/01/2002": 50.6, "22/01/2002": 1385, "23/01/2002": 600.4 }, total_mm: 2036 });
    expect(b.records_battus).toContainEqual({ station: "Plaine des Cafres", jour: "22/01/2002", rafale_kmh: 220, rafale_ms: 61, record_de_la_station: "mesures depuis 1965" });
    expect(b.page).toBe("https://rundata.re/cyclones/dina-2002");
    expect(b.passage_d_apres.lien).toBe("https://www.vie-publique.fr/files/rapport/pdf/034000505.pdf");
  });
});
