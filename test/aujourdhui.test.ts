import { describe, expect, it } from "vitest";
import { mention } from "../src/tools/non-repris.js";
import { resume } from "../src/tools/resume.js";
import { aCommune, aujourdhuiPage, descriptionOf, H1, HOOK, LINK, titleOf } from "../src/web/aujourdhui.js";
import { esc } from "../src/web/map.js";
import { pageOf, PAGES } from "../src/web/places.js";

const NOW = new Date("2026-10-24T11:10:00Z");
const COMMUNES = PAGES.filter((p) => p.commune);
const copy = <T>(value: T) => ({ value, fetchedAt: new Date(NOW.getTime() - 60_000), stale: false });
const full = (nom: string) => ({
  meteo: copy({ meteo: { resume: "", sources: [], stations: [{ station: nom, source: "meteofrance", altitude_m: 10, heure_mesure: "24/10 15:10", age_min: 0, mesures: { temperature: "24,5 °C" }, avertissements: [] }] } }),
  agenda: copy({ resume: "", nombre: 12, couverture: "", a_savoir: "", sources: [], ce_week_end: [], evenements: Array.from({ length: 12 }, (_, i) => ({ titre: `Fête ${i}`, commune: nom, date: "2026-10-24T20:00", quand: "samedi 24/10 à 20:00", lien: "https://example.org" })) }),
  coupures: copy({ resume: "", couverture: "", a_savoir: "", sources: [], communes_suivies: [], avis: [{ titre: "Coupure", communes: [nom], distributeur: "runéo", lien: "https://example.org" }] }),
});

describe("the page of a commune's day", () => {
  it("names the commune with the right preposition, in titles that fit", () => {
    expect(COMMUNES.map((p) => aCommune(p.nom))).toEqual(expect.arrayContaining(["au Port", "au Tampon", "aux Avirons", "aux Trois-Bassins", "à l'Entre-Deux", "à L'Étang-Salé", "à La Possession", "à Saint-Paul"]));
    for (const p of COMMUNES) {
      expect(titleOf(p).length, titleOf(p)).toBeLessThanOrEqual(60);
      expect(H1(p)).not.toMatch(/à Les? /);
      expect(HOOK(p).length, HOOK(p)).toBeLessThanOrEqual(144);
    }
    expect(titleOf(pageOf("saint-paul")!)).toBe("Saint-Paul aujourd'hui : météo, routes, sorties · 974");
    expect(titleOf(pageOf("la-plaine-des-palmistes")!)).toBe("La Plaine-des-Palmistes aujourd'hui : météo, sorties · 974");
    expect(LINK(pageOf("le-port")!)).toBe("Aujourd'hui au Port : le résumé de la journée →");
  });

  it("says the day's figures in its description, each only when there is one", () => {
    const p = pageOf("saint-paul")!;
    // The site's narrow space before the unit.
    expect(descriptionOf(p, resume(p, full(p.nom) as never, NOW)).replace(/\u202f/g, " ")).toBe("Aujourd'hui à Saint-Paul (974) : 24,5 °C mesurés à 15:10, 12 sorties, 1 coupure d'eau. Routes, actu, vigilance, mairie : le résumé du jour.");
    expect(descriptionOf(p, resume(p, {}, NOW))).toBe("Aujourd'hui à Saint-Paul (974) : Routes, actu, vigilance, mairie : le résumé du jour.");
    for (const c of COMMUNES) expect(descriptionOf(c, resume(c, full(c.nom) as never, NOW)).length).toBeLessThanOrEqual(152);
  });

  it("shows what it has, links what it has not, and never the tap water's analyses", () => {
    const p = pageOf("entre-deux")!;
    const html = aujourdhuiPage("https://rundata.re", p, resume(p, full(p.nom) as never, NOW, [{ partie: "électricité", raison: "pas de copie récente", outil: "electricite", page: "https://rundata.re/electricite" }]), null);
    expect(html).toContain("<h1>Aujourd&#39;hui à l&#39;Entre-Deux</h1>");
    expect(html).toContain('<p class="hook">Ce qui compte aujourd&#39;hui à l&#39;Entre-Deux, sur une page');
    expect(html).toContain("Fête 0");
    expect(html).toContain('<a href="/electricite">électricité</a>');
    expect(html).not.toMatch(/conforme/);
    expect(html).toContain(`<a href="https://www.infotrafic.re/" rel="noopener">la carte officielle sur infotrafic.re ↗</a>`);
    expect(html).not.toMatch(/waze/i);
  });

  it("gives the practical side of the day: the market, the skips of the TCO, the fuel, the duty pharmacy", () => {
    const p = pageOf("saint-paul")!;
    const dechets = copy({ sources: [], etats: [{ lien: "https://www.tco.re/annuaire-tco/centre-de-proprete-de-plateau-caillou", maj: "2026-10-24T14:30:00+04:00", accepte: { dechets_verts: true } }] });
    const html = aujourdhuiPage("https://rundata.re", p, resume(p, { ...full(p.nom), dechets } as never, NOW), null);
    expect(html).toContain('<h2 id="h-pratique">Vie pratique</h2>');
    expect(html).toMatch(/Marché aujourd'hui : <a href="https:\/\/www\.openstreetmap\.org\/[^"]+" rel="noopener"><b>Marché forain de Saint-Paul<\/b><\/a> <span class="note">de 8\u00a0h à 12\u00a0h/);
    expect(html).toContain("<b>déchets verts acceptés dans 1 sur 1</b>");
    expect(html).toContain('<a href="/decheteries#saint-paul">les bennes →</a>');
    expect(html).toContain('Pharmacie de garde (nuits, dimanches, jours fériés) : <a href="https://www.3237.fr/" rel="noopener"><b>3237.fr</b></a>, ou le 32 37 (payant)');
    // Without the prices of the month, no fuel line; elsewhere than the TCO, no skips.
    expect(html).not.toContain("Carburants :");
    const tampon = pageOf("le-tampon")!;
    expect(aujourdhuiPage("https://rundata.re", tampon, resume(tampon, full(tampon.nom) as never, NOW), null)).not.toContain("Déchèteries :");
  });

  it("says under the practical side that a mairie's notices of power cuts are not read until it agrees, in the words of /electricite", () => {
    const p = pageOf("sainte-suzanne")!;
    const said = mention("courant", p.nom)!;
    expect(said).toMatch(/^Les mentions légales du site de la commune de Sainte-Suzanne .* avis de coupure d'électricité/);
    const html = aujourdhuiPage("https://rundata.re", p, resume(p, full(p.nom) as never, NOW), null);
    expect(html).toContain(`(payant)</li></ul><p class="note">${esc(said)} <a href="/ouvrir-ses-donnees#licence">Comment permettre la reprise</a></p></div>`);
    const paul = pageOf("saint-paul")!;
    expect(mention("courant", paul.nom)).toBeUndefined();
    expect(aujourdhuiPage("https://rundata.re", paul, resume(paul, full(paul.nom) as never, NOW), null)).not.toContain("avis de coupure d&#39;électricité");
  });
});
