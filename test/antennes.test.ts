import { describe, expect, it } from "vitest";
import { inReunion } from "../src/geo.js";
import { antennas } from "../src/tools/terrain.js";
import * as antennes from "../src/vie/antennes.js";
import { communePage } from "../src/web/commune.js";
import { pageOf } from "../src/web/places.js";

describe("the antennas of the island (ANFR)", () => {
  it("bundles every mobile support of the island with its operators, and the FM, TNT and DAB+ supports", () => {
    // Counted on the files of 22/10/2026 (mobile) and 30/09/2026 (over 5 W), as the study of 29/10 did.
    expect(antennes.MOBILE_DU).toBe("2026-10-22");
    expect(antennes.RADIO_DU).toBe("2026-09-30");
    expect(antennes.SUPPORTS).toHaveLength(1151);
    expect(Object.fromEntries(antennes.OPERATEURS.map((o) => [o, antennes.SUPPORTS.filter((s) => s.ops[o]).length]))).toEqual({ Orange: 396, "SFR Réunion": 409, Free: 297, Zeop: 279 });
    const sum = (k: "fm" | "tnt" | "dab") => antennes.EMETTEURS.reduce((n, e) => n + (e[k] ?? 0), 0);
    expect([antennes.EMETTEURS.length, sum("fm"), sum("tnt"), sum("dab")]).toEqual([173, 276, 38, 9]);
    for (const x of [...antennes.SUPPORTS, ...antennes.EMETTEURS]) {
      expect(inReunion(x.lon, x.lat), String(x.id)).toBe(true);
      expect(x.insee).toMatch(/^974\d\d$/);
      // A place and a height: never an address.
      expect(Object.keys(x).filter((k) => /adr|adresse|lieu/.test(k))).toEqual([]);
    }
    // Only TDF is named: never the Arcom, which assigns the frequencies, nor a private site.
    expect(new Set(antennes.EMETTEURS.flatMap((e) => e.exploitants ?? []))).toEqual(new Set(["TDF"]));
  });

  it("gives fiche_terrain the supports within 500 m, the closest first, with each operator's generations by state", () => {
    // The Barachois, Saint-Denis.
    const r = antennas(55.4481, -20.8789);
    expect(r.ligne).toBe("13 supports d'antennes mobiles à moins de 500 m, le plus proche à 170 m (ANFR)");
    expect(r.bloc.antennes_mobiles).toMatchObject({ fichier_du: "22/10/2026", supports: 13 });
    expect(r.bloc.antennes_mobiles.plus_proches[0]).toEqual({
      distance_m: 170,
      hauteur_m: 30,
      support: "bâtiment",
      operateurs: [{ operateur: "SFR Réunion", en_service: "2G, 3G, 4G", techniquement_operationnel: "5G" }],
    });
    expect(r.bloc.antennes_mobiles.plus_proches).toHaveLength(5);
    expect(r.bloc.radio_et_television).toEqual({ fichier_du: "30/09/2026", supports: 0, plus_proches: [] });
    expect(r.bloc.note).toContain("ce n'est ni l'état du réseau en ce moment, ni la couverture");
    expect(r.bloc.note).toContain("Free et SFR Réunion sont déclarés sous les noms Telco OI et SRR.");
    expect(r.bloc.note).toContain("https://www.cartoradio.fr");
    // In the middle of the Plaine des Cafres' forest: none declared.
    expect(antennas(55.53, -21.13).ligne).toBe("aucun support d'antennes mobiles déclaré à moins de 500 m (ANFR)");
  });

  it("names the broadcast stations near the point by kind, and their operator only when it is TDF", () => {
    const e = antennes.EMETTEURS.find((x) => x.tnt && x.fm && x.exploitants?.includes("TDF"))!;
    const r = antennas(e.lon, e.lat).bloc.radio_et_television;
    expect(r.plus_proches[0]).toMatchObject({ distance_m: 0, exploitant: "TDF" });
    expect(r.plus_proches[0].emetteurs).toMatch(/^\d+ stations? FM, \d+ TNT/);
    const prive = antennes.EMETTEURS.find((x) => x.fm && !x.exploitants)!;
    expect(antennas(prive.lon, prive.lat).bloc.radio_et_television.plus_proches[0]).not.toHaveProperty("exploitant");
  });

  it("is on each commune's page, apart from the live grid: the supports by operator, the file's day, never « couverture »", () => {
    const page = communePage("https://rundata.re", pageOf("cilaos")!, { place: null });
    const start = page.indexOf('<section aria-labelledby="h-habiter">');
    const habiter = page.slice(start, page.indexOf("</section>", start));
    expect(habiter).toContain(
      '<h3>Antennes</h3><p class="tv">7</p><p class="td all">supports d\'antennes mobiles dans la commune, déclarés à l\'ANFR au 22/10/2026, aucun avec la 5G en service · Orange sur 2, SFR Réunion sur 4, Free sur 1, Zeop sur 1 · 6 supports d\'émetteurs de radio ou de télévision de plus de 5\u00a0W (FM, TNT, DAB+) · ANFR</p>',
    );
    expect(habiter).not.toMatch(/couvert|couverture|exposition/);
    expect(page).toContain(antennes.SOURCE_MOBILE.nom);
  });
});
