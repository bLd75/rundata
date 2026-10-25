import { describe, expect, it } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { kmh, mesures, PASSES, passeOf, RAIN_NOTE, records, total } from "../src/historique/cyclones-passes.js";
import { cyclones } from "../src/tools/cyclones.js";
import { metaOf, passePage, titleOf } from "../src/web/cyclones-passes.js";
import { DESCRIPTION_MAX } from "../src/web/pages.js";
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
    expect(metaOf(passe("garance-2025"))).toBe("Cyclone Garance (février 2025) à La Réunion (974) : pluie et rafales mesurées station par station par Météo-France, et les records de station.");
    expect(metaOf(passe("batsirai-2022"))).not.toContain("records");
  });

  it("finds the cyclone a question names", () => {
    expect(passeOf("cyclone Dina")?.slug).toBe("dina-2002");
    expect(passeOf("Garance 2025")?.slug).toBe("garance-2025");
    expect(passeOf("batsirai-2022")?.slug).toBe("batsirai-2022");
    expect(passeOf("Firinga")?.slug).toBe("firinga-1989");
    expect(passeOf("Gamède")?.slug).toBe("gamede-2007");
    expect(passeOf("gamede")?.slug).toBe("gamede-2007");
    expect(passeOf("Bejisa")).toBeUndefined();
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
    expect(html).toContain("<b>Gros Piton Sainte-Rose</b> : 234\u00a0km/h (64,9\u00a0m/s) le 28/02/2025");
    expect(html).toContain('<a href="/cyclones">');
    expect(html).toContain('<a href="/alerte-cyclone">');
    expect(html).not.toMatch(/victime|mort|dégât|sinistr|foyers/i);
    // The alert only where an official document that was read says it.
    expect(html).not.toContain('id="h-alerte"');
    expect(passePage("https://rundata.re", passe("batsirai-2022"))).toContain("« 38h d&#39;alerte rouge à La Réunion »");
  });

  it("gives a long episode each station's wettest day, and says how few measured the wind", () => {
    const h = passe("hyacinthe-1980");
    expect(titleOf(h)).toBe("Cyclone Hyacinthe 1980 : pluie mesurée · Réunion 974");
    expect(metaOf(h)).toBe("Cyclone Hyacinthe (janvier 1980) à La Réunion (974) : pluie mesurée station par station par Météo-France, et les records de station.");
    expect(mesures(h).jours).toHaveLength(12);
    const html = passePage("https://rundata.re", h);
    expect(html).toContain("<h1>Cyclone Hyacinthe, du 15 au 28 janvier 1980</h1>");
    expect(html).toContain("135 stations, de la plus arrosée à la moins arrosée, du 16/01/1980 au 27/01/1980. Rafales : seulement 3 stations les mesuraient en 1980.");
    expect(html).toContain('<th scope="col">Jour le plus pluvieux</th>');
    expect(html).toContain("<tr><th scope=\"row\">Commerson<small>2\u202f310\u00a0m</small></th><td><b>6\u202f051</b></td><td>1\u202f029<small>25/01</small></td><td>—</td></tr>");
    // Firinga: the gusts at the instruments' limit, as Météo-France says it.
    const firinga = passePage("https://rundata.re", passe("firinga-1989"));
    expect(firinga).toContain("des rafales de 216\u00a0km/h qui sont la limite mesurable avec les instruments de l&#39;époque. » (<a href=\"https://web.archive.org/web/20240115035551/http://pluiesextremes.meteo.fr/lareunion/1989-Firinga.html\" rel=\"noopener\">1989 Firinga</a>, Météo-France, site « Pluies extrêmes à La Réunion », copie archivée : le site est suspendu depuis juillet 2024)</p>");
    // And beside the record that is only that limit.
    expect(firinga).toContain("<b>Saint-Pierre</b> : rafale de 216\u00a0km/h (60\u00a0m/s) le 29/01/1989, record de la station (mesures depuis 1952). 216\u00a0km/h était « la limite mesurable avec les instruments de l&#39;époque » (<a href=");
    expect(firinga).not.toContain("2024))");
    // Belal: 60.2 m/s at the Maïdo, the 217 km/h of Météo-France's account.
    expect(passePage("https://rundata.re", passe("belal-2024"))).toContain("<b>Piton Maïdo</b> : 217\u00a0km/h (60,2\u00a0m/s) le 15/01/2024");
    expect(titleOf(passe("firinga-1989"))).toBe("Cyclone Firinga 1989 : pluie et vent mesurés · Réunion 974");
    // Belal: the misspelt place of the source is cut, the number and its unit never.
    const belal = passePage("https://rundata.re", passe("belal-2024"));
    expect(belal).not.toContain("Saint-Anne");
    expect(belal).toContain("au niveau de la commune de Saint-Benoît […] à la mi-journée.");
    expect(passePage("https://rundata.re", passe("batsirai-2022"))).toContain("un peu plus de 190\u00a0km au NNO");
  });

  it("quotes Gamède's world records from Météo-France's page, and says what the daily files cannot show", () => {
    const g = passe("gamede-2007");
    const html = passePage("https://rundata.re", g);
    expect(html).toContain("<h1>Cyclone Gamède, du 24 au 27 février 2007</h1>");
    expect(html).toContain("<h2 id=\"h-extraits\">Records mondiaux, selon Météo-France</h2>");
    expect(html).toContain("<p>Cumuls de pluie de Gamède, selon la page de Météo-France :</p>");
    expect(html).toContain("rel=\"noopener\">2007 Gamede</a>, Météo-France, site « Pluies extrêmes à La Réunion », copie archivée du 18/05/2024 : le site est suspendu depuis juillet 2024)</p>");
    expect(metaOf(g)).toBe("Cyclone Gamède (février 2007) à La Réunion (974) : pluie et vent mesurés, records de station, records mondiaux de pluie en 72 et 96 h selon Météo-France.");
    for (const p of PASSES) expect(metaOf(p).length, p.slug).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(html).toContain("« en 72 heures : 3930\u00a0mm au Cratère Commerson et 3271\u00a0mm à Hell-Bourg, dépassant ainsi le précédent record mondial de 3240\u00a0mm");
    // « record mondial » only inside Météo-France's words.
    expect(html.replace(/« [^»]*»/g, "")).not.toMatch(/record mondial/);
    // The note's daily sums are the ones the files give.
    const { stations } = mesures(g);
    const sum = (name: string) => total(stations.find((s) => s.station === name)!.rr);
    expect(sum("Commerson")).toBe(4869.1);
    expect(sum("Hell-Bourg")).toBe(3633.3);
    expect(g.extraits!.note).toContain("4 869,1 mm à Commerson et 3 633,3 mm à Hell-Bourg");
  });

  it("finds in the daily files what Météo-France's pages say of Clotilda and Colina", () => {
    // Clotilda: the three-day totals of the 11th to the 13th the page gives (Plaine-des-Palmistes 2 507 mm, Bébour 2 465 mm).
    const c = mesures(passe("clotilda-1987"));
    const three = (name: string) => c.stations.find((s) => s.station === name)!.rr!.slice(2, 5).reduce((a, x) => a! + x!, 0);
    expect(three("Plaine des Palmistes")).toBe(2507);
    expect(three("Bebour")).toBe(2465);
    expect(titleOf(passe("clotilda-1987"))).toBe("Cyclone Clotilda 1987 : pluie mesurée · Réunion 974");
    // Colina: 205 km/h at the Plaine-des-Palmistes.
    expect(passePage("https://rundata.re", passe("colina-1993"))).toContain("<b>Plaine des Palmistes</b> : 205\u00a0km/h (57\u00a0m/s) le 19/01/1993");
  });

  it("is served, in the sitemap and listed on /cyclones", async () => {
    const cache = new Cache();
    const r = await handle(new Request("https://rundata.re/cyclones/dina-2002", { headers: { accept: "text/html" } }), cache);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("<h1>Cyclone Dina, 22 et 23 janvier 2002</h1>");
    expect((await handle(new Request("https://rundata.re/cyclones/bejisa-2014", { headers: { accept: "text/html" } }), cache)).status).toBe(404);
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
    // Gamède: Météo-France's words under fixed keys, the quotes as they are.
    const g = body(await cyclones(new Cache(), undefined, NOW, "Gamède")).selon_meteo_france;
    expect(Object.keys(g)).toEqual(["attribution", "intro", "citations", "a_savoir"]);
    expect(g.intro).toBe(passe("gamede-2007").extraits!.intro);
    expect(g.citations).toEqual(passe("gamede-2007").extraits!.citations);
    expect(g.attribution).toContain("jamais à rundata.re");
  });
});
