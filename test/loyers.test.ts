import { describe, expect, it } from "vitest";
import { INSEE } from "../src/places/insee.js";
import { rents } from "../src/tools/terrain.js";
import { communePage } from "../src/web/commune.js";
import { pageOf } from "../src/web/places.js";
import * as loyers from "../src/vie/loyers.js";

describe("the rents asked in the ads (carte des loyers)", () => {
  it("holds the 4 kinds of home for each of the 24 communes, as the ANIL's files give them", () => {
    for (const [nom, code] of Object.entries(INSEE)) {
      const c = loyers.ofInsee(code);
      expect(Object.keys(c ?? {}).sort(), nom).toEqual([...loyers.KINDS].sort());
      for (const l of Object.values(c!)) expect(l.bas < l.loyer_m2 && l.loyer_m2 < l.haut, nom).toBe(true);
    }
    // Saint-Denis, a flat: read in pred-app-mef-dhup.csv of the 2025 vintage.
    expect(loyers.ofCommune("Saint-Denis")!.appartement).toEqual({ loyer_m2: 15.09, bas: 11.47, haut: 19.86, annonces: 14748, r2: 0.84 });
    expect(loyers.MILLESIME).toBe(2025);
  });

  it("says a figure estimated with the neighbouring communes, and one the ANIL asks to take with caution", () => {
    // Cilaos, 17 flats in ads: the estimate of its mesh, 985 ads.
    expect(loyers.ofCommune("Cilaos")!.appartement).toMatchObject({ annonces: 17, zone: "maille", annonces_zone: 985 });
    const cilaos = rents(INSEE.Cilaos)!.bloc.appartement as Record<string, unknown>;
    expect(cilaos.estimation).toContain("985");
    expect(cilaos.prudence).toBeDefined();
    // Saint-Leu, flats of 1 or 2 rooms: 649 ads, but an R² of 0.40.
    expect(loyers.fragile(loyers.ofCommune("Saint-Leu")!.appartement_1_2_pieces!)).toBe(true);
    const denis = rents(INSEE["Saint-Denis"])!.bloc.appartement as Record<string, unknown>;
    expect(denis).toMatchObject({ loyer_m2_charges_comprises: "15,09 €/m²", intervalle_95: "11,47 €/m² à 19,86 €/m²", annonces_dans_la_commune: 14748 });
    expect(denis.estimation).toBeUndefined();
    expect(denis.prudence).toBeUndefined();
  });

  it("names the ANIL as it asks, and no commune outside the island", () => {
    expect(loyers.SOURCE.attribution).toBe("Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin");
    expect(rents("75056")).toBeUndefined();
    expect(rents(INSEE["Le Port"])!.bloc).toMatchObject({ commune: "Le Port", millesime: 2025 });
  });

  it("are on each commune's page, apart from the live grid: a reference flat's rent per m², a house's, the ANIL's mention", () => {
    const page = communePage("https://rundata.re", pageOf("saint-paul")!, { place: null });
    const start = page.indexOf('<section aria-labelledby="h-habiter">');
    const habiter = page.slice(start, page.indexOf("</section>", start));
    expect(habiter).toContain('<h2 id="h-habiter">Habiter à Saint-Paul</h2>');
    expect(habiter).toContain("<p>Des chiffres publiés une fois par an ou par trimestre, chacun avec sa date.</p>");
    expect(habiter).toContain("<h3>Loyers d&#39;annonce</h3><p class=\"tv\">18,86\u00a0€/m²</p><p class=\"td all\">appartement type de 52\u00a0m²");
    expect(habiter).toContain("appartement type de 52\u00a0m², non meublé, charges comprises, d'après les annonces du 3e trimestre 2025 · maison type 15,57\u00a0€/m² · Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin</p>");
    expect(habiter).toContain(`<a href="${loyers.SOURCE.url}" rel="noopener">La carte des loyers de l'ANIL</a>`);
    expect(page.indexOf('id="h-habiter"')).toBeGreaterThan(page.indexOf('id="h-now"'));
    // Cilaos: its flats estimated with its neighbours, from 17 ads.
    expect(communePage("https://rundata.re", pageOf("cilaos")!, { place: null })).toContain("leboncoin · estimé avec des communes voisines, faute d'annonces assez nombreuses · à prendre avec prudence, selon l'ANIL</p>");
    expect(communePage("https://rundata.re", pageOf("le-port")!, { place: null })).toContain(">Habiter au Port</h2>");
    // The section only: the page's stylesheet names a water quality « q-moyenne ».
    expect(habiter).not.toMatch(/médian|moyen|signé/);
  });
});
