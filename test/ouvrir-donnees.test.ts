import { describe, expect, it } from "vitest";
import { ouvrirDonneesPage } from "../src/web/ouvrir-donnees.js";

describe("/ouvrir-ses-donnees", () => {
  it("links OpenAgenda's free functions, read on 31/10/2026, and no longer its prices page of 2024, gone (404)", () => {
    const page = ouvrirDonneesPage("https://rundata.re");
    expect(page).toContain(`(<a href="https://openagenda.com/fr/p/fonctions">fonctionnalités gratuites d'OpenAgenda</a>, page lue le 31/10/2026)`);
    expect(page).not.toContain("tarifs-openagenda");
    // What that page does not say any more is not said either.
    expect(page).not.toContain("sans limite de durée");
    expect(page).not.toContain("illimité");
  });
});
