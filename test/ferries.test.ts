import { describe, expect, it } from "vitest";
import { asksCrossing, T } from "../src/tools/ferries.js";
import { transports } from "../src/tools/transports.js";
import { busPage } from "../src/web/domains.js";

const NOW = new Date("2026-10-24T16:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

describe("the boat to Mauritius", () => {
  it("tell a crossing from a bus stop that bears the same word", () => {
    for (const q of ["ferry pour Maurice", "bateau Réunion Maurice", "aller à l'île Maurice en bateau", "traversée vers Maurice", "Rodrigues", "Mauritius Trochetia"]) expect(asksCrossing(q), q).toBe(true);
    for (const q of ["Jules Ferry, Saint-Denis", "Rue Jules Ferry", "Chemin Bateau", "Fonds Maurice", "Maurice Tomi", "Rue Maurice Chevalier", "Gare Maritime"]) expect(asksCrossing(q), q).toBe(false);
  });

  it("answer that there is no regular passenger line, dated, whatever the timetables", async () => {
    expect(body(await transports("ferry pour Maurice", undefined, NOW))).toEqual({ resume: T.outil });
    expect(T.outil).toMatch(/^Il n'y a pas de liaison maritime régulière de passagers entre La Réunion et Maurice \(vérifié le 24\/10\/2026\)\./);
  });

  it("say it at the end of /bus, with the day it was checked and no link", () => {
    const html = busPage("https://rundata.re", null, NOW);
    const s = html.slice(html.indexOf('<section aria-labelledby="h-bateau">'));
    expect(s).toMatch(/^<section aria-labelledby="h-bateau"><h3 id="h-bateau">Et le bateau pour Maurice \?<\/h3><p>Aucun bateau régulier/);
    expect(s).toContain(`<p class="note">Vérifié le 24/10/2026.</p></section>`);
    expect(s.slice(0, s.indexOf("</section>"))).not.toContain("href");
  });
});
