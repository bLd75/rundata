import { describe, expect, it } from "vitest";
import { INSEE } from "../src/places/insee.js";
import { connexion } from "../src/tools/terrain.js";
import * as internet from "../src/vie/internet.js";
import { communePage } from "../src/web/commune.js";
import { pageOf } from "../src/web/places.js";

describe("the internet of each commune (Ma connexion internet)", () => {
  it("counts every premise of the 24 communes at most once, by its best technology", () => {
    for (const [nom, code] of Object.entries(INSEE)) {
      const c = internet.ofInsee(code)!;
      expect(c, nom).toBeDefined();
      // A few premises have no technology declared at all (42 of Saint-Paul's 65 308).
      expect(internet.TECHNOS.reduce((n, t) => n + (c[t] ?? 0), 0), nom).toBeLessThanOrEqual(c.locaux);
    }
    // Saint-Denis at the end of the second quarter of 2026: read in commune_meilleure_techno_thd.csv.
    expect(internet.ofCommune("Saint-Denis")).toEqual({ locaux: 96059, fibre: 93292, "4g_fixe": 2767 });
    expect(internet.AU).toBe("2026-06-30");
    expect(internet.pct(internet.part(internet.ofCommune("Saint-Denis")!, "fibre"))).toBe("97,1 %");
  });

  it("gives the fibre's share and each best technology's, with the quarter, for fiche_terrain", () => {
    const r = connexion(INSEE["Saint-Paul"])!;
    expect(r.bloc).toMatchObject({ commune: "Saint-Paul", au: "30/06/2026", locaux: 65308, eligibles_a_la_fibre: "95,1 %" });
    expect(Object.values(r.bloc.meilleure_technologie)).toEqual(["95,1 %", "0,8 %", "4 %"]);
    expect(connexion("75056")).toBeUndefined();
  });

  it("is on each commune's page, apart from the live grid: the fibre's share, the quarter, « not connected »", () => {
    const page = communePage("https://rundata.re", pageOf("saint-leu")!, { place: null });
    const start = page.indexOf('<section aria-labelledby="h-habiter">');
    const habiter = page.slice(start, page.indexOf("</section>", start));
    expect(habiter).toContain('<h2 id="h-habiter">Habiter à Saint-Leu</h2>');
    expect(habiter).toContain('<h3>Fibre</h3><p class="tv">86,9\u00a0%</p><p class="td all">des logements et locaux professionnels');
    expect(habiter).toContain("des logements et locaux professionnels sont éligibles à la fibre au 30 juin 2026, ce qui ne veut pas dire raccordés · 4G fixe au mieux pour 13,1\u00a0% · Arcep, Ma connexion internet</p>");
    expect(habiter).toContain('<a href="https://maconnexioninternet.arcep.fr/" rel="noopener">Votre adresse sur Ma connexion internet</a>');
    // The section only: the weather elsewhere on the page may say « couvert ».
    expect(habiter).not.toMatch(/fibré|couvert/);
  });
});
