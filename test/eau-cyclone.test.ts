import { describe, expect, it } from "vitest";
import data from "../src/eau/distributeurs.json" with { type: "json" };
import { distributeur, plusieurs } from "../src/eau/distributeurs.js";
import { coupuresCommunePage } from "../src/web/coupures.js";
import { coupuresPage } from "../src/web/domains.js";
import { pageOf } from "../src/web/places.js";
import { CONSIGNE, CONSIGNE_PAGE, coverageLine, cycloneWater, inSeason } from "../src/web/eau-cyclone.js";
import { onPages } from "./dso.js";

// Saturday 24 October 2026, out of the season; 15 January 2027, in it.
const OCTOBER = new Date("2026-10-24T10:00:00Z");
const JANUARY = new Date("2027-01-15T10:00:00Z");

describe("after a cyclone, the tap water", () => {
  it("quotes the plan word for word, on its page", () => {
    expect(onPages(CONSIGNE, [CONSIGNE_PAGE])).toBe(true);
    expect(cycloneWater(OCTOBER).html).toContain('rel="noopener">p. 18</a>');
  });

  it("names a commune's distributor only when the ARS's samples name one, and says whose notices are read", () => {
    // L'Étang-Salé: two distributors in the samples, none chosen.
    expect((data.communes as Record<string, string | null>)["L'Étang-Salé"]).toBeNull();
    expect(distributeur("L'Étang-Salé")).toBeUndefined();
    expect(plusieurs("L'Étang-Salé")).toEqual(["la mairie de L'Étang-Salé", "runéo"]);
    expect(coverageLine("L'Étang-Salé")).toBe("Distributeur non identifié à L'Étang-Salé : le contrôle sanitaire de l'ARS en cite plusieurs (la mairie de L'Étang-Salé et runéo). Renseignez-vous auprès de la mairie.");
    expect(coverageLine("Le Tampon")).toBe("Nous ne lisons pas les avis de Sudéau, qui distribue l'eau au Tampon : renseignez-vous auprès de Sudéau ou de la mairie.");
    expect(coverageLine("Saint-Paul")).toBe("Nous lisons les avis publiés par La Créole pour Saint-Paul, au moins toutes les 30 minutes : ils s'affichent en haut de cette page.");
    // Sainte-Marie: CISE Réunion's notices, as the ville posts them; Les Avirons, also CISE Réunion, is not read.
    expect(coverageLine("Sainte-Marie")).toBe("Nous lisons les communiqués de CISE Réunion publiés par la ville de Sainte-Marie, au moins toutes les 30 minutes\u00a0: ils s'affichent en haut de cette page. Un communiqué publié en image ou en PDF n'est pas lu\u00a0: nous donnons seulement son lien.");
    expect(coverageLine("Les Avirons")).toBe("Nous ne lisons pas les avis de CISE Réunion, qui distribue l'eau aux Avirons : renseignez-vous auprès de CISE Réunion ou de la mairie.");
    expect(coverageLine("Saint-Denis")).toBe("Nous lisons les avis publiés par Dionéo pour Saint-Denis, au moins toutes les 30 minutes : ils s'affichent en haut de cette page.");
    expect(coverageLine("Salazie")).toBe("Nous lisons les avis publiés par la CIREST pour Salazie, au moins toutes les 30 minutes : ils s'affichent en haut de cette page.");
    // No word in quotation marks that no source writes, and no capitals as the ARS's table writes them.
    for (const c of ["Saint-Denis", "Salazie", "Saint-Paul", "L'Étang-Salé"]) expect(coverageLine(c)).not.toMatch(/«|MAIRIE|ÉTANG/);
  });

  it("never says the water is safe, back, or free of notices", () => {
    for (const html of [cycloneWater(OCTOBER).html, ...["Saint-Paul", "Saint-Denis", "L'Étang-Salé", "Cilaos"].map((c) => cycloneWater(OCTOBER, c).html)])
      expect(html).not.toMatch(/eau potable|rétabli|aucun avis/i);
    const island = cycloneWater(OCTOBER).html;
    expect(island).toContain("<b>Distributeur non identifié</b>");
    expect(island).toMatch(/Sudéau \(<a href="\/coupures-eau\/[a-z-]+">[^<]+<\/a>, <a href="\/coupures-eau\/[a-z-]+">[^<]+<\/a>/);
    expect(island).toContain(`CISE Réunion (<a href="/coupures-eau/les-avirons">Les Avirons</a>)`);
    const read = /<b>Avis lus<\/b> : (.*?)<\/li>/.exec(island)![1];
    for (const c of ["Saint-Paul", "Les Trois-Bassins", "Sainte-Marie"]) expect(read).toContain(`>${c}</a>`);
    expect(island.match(/Sudéau \(/g)).toHaveLength(1);
    expect(island).toContain('<a href="https://www.eaudurobinet.re/" rel="noopener">');
  });

  it("leads the page in the cyclone season, closes it the rest of the year", () => {
    expect(inSeason(OCTOBER)).toBe(false);
    expect(inSeason(JANUARY)).toBe(true);
    expect(inSeason(new Date("2026-10-31T20:30:00Z"))).toBe(true); // 1 November, 00:30 at La Réunion
    expect(cycloneWater(JANUARY, "Saint-Paul").lead).toBe(true);
    expect(cycloneWater(OCTOBER, "Saint-Paul").lead).toBe(false);
  });

  it("sits after the notices in the season, at the foot of the page otherwise, on the island's page and a commune's", () => {
    const pos = (html: string, mark: string) => html.indexOf(mark);
    const island = (now: Date) => coupuresPage("https://rundata.re", null, now);
    const commune = (now: Date) => coupuresCommunePage("https://rundata.re", pageOf("saint-paul")!, { coupures: null }, now);
    // The season: right after the notices, before the rest.
    expect(pos(island(JANUARY), 'id="h-cyclone-eau"')).toBeGreaterThan(pos(island(JANUARY), 'id="h-avis"'));
    expect(pos(commune(JANUARY), 'id="h-cyclone-eau"')).toBeLessThan(pos(commune(JANUARY), 'id="h-qui"'));
    // The rest of the year: after the page's own sections (the other communes, the AI's invitation).
    expect(pos(commune(OCTOBER), 'id="h-cyclone-eau"')).toBeGreaterThan(pos(commune(OCTOBER), 'id="h-autres"'));
    expect(pos(island(OCTOBER), 'id="h-cyclone-eau"')).toBeGreaterThan(pos(island(JANUARY), 'id="h-cyclone-eau"'));
  });
});
