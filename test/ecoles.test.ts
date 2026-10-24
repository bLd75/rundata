import { describe, expect, it } from "vitest";
import * as mf from "../src/providers/vigilance.js";
import type { Cyclone } from "../src/providers/prefecture.js";
import { ecoles, ecolesBlock, REGLE, resumeLine, withPrefecture } from "../src/tools/ecoles.js";
import { cyclone, cycloneLevel } from "../src/tools/vigilance.js";
import { ecolesPage } from "../src/web/ecoles.js";
import { alertePage } from "../src/web/alerte-cyclone.js";
import { alerteOf } from "../src/web/data.js";
import { cited, onPages } from "./dso.js";

// Saturday 24 October 2026, 14:00 at La Réunion.
const NOW = new Date("2026-10-24T10:00:00Z");
const at = (local: string) => new Date(`${local}+04:00`).toISOString().replace(".000", "");

/** Météo-France's map as the API gives it, the cyclone alert with its own codes (7 to 10, 6). */
function map(cyclone: [number, string, string?][], rain: [number, string, string?][] = []) {
  const items = (xs: [number, string, string?][]) => xs.map(([color_id, begin_time, end_time]) => ({ color_id, begin_time: at(begin_time), end_time: end_time && at(end_time) }));
  return mf.parse({
    update_time: at("2026-10-24T06:00:00"),
    timelaps: {
      domain_ids: [
        { domain_id: mf.ISLAND, phenomenon_items: [{ phenomenon_id: mf.CYCLONE, timelaps_items: items(cyclone) }] },
        { domain_id: "VIGI974-12", phenomenon_items: [{ phenomenon_id: 12, timelaps_items: items(rain) }] },
      ],
    },
  });
}

describe("the cyclone alert's codes", () => {
  it("brings the cyclone alert's codes to the scale of the other phenomena, and only theirs", () => {
    const v = map([[7, "2026-10-24T06:00:00", "2026-10-24T19:00:00"], [8, "2026-10-24T19:00:00", "2026-10-25T06:00:00"]], [[2, "2026-10-24T06:00:00"]]);
    expect(v.zones[mf.ISLAND][mf.CYCLONE].map((p) => p.couleur)).toEqual([2, 3]);
    expect(v.zones["VIGI974-12"][12][0].couleur).toBe(2);
    expect(cyclone(v, NOW)).toBe("ALERTE CYCLONIQUE pré-alerte, « je m'informe » : menace potentielle dans les jours à venir.");
    expect(cyclone(map([[10, "2026-10-24T06:00:00"]]), NOW)).toContain("ALERTE CYCLONIQUE violette");
    expect(cyclone(map([[6, "2026-10-24T06:00:00"]]), NOW)).toContain("ALERTE CYCLONIQUE phase de sauvegarde");
  });

  it("shows the alert in force, not the highest code: the phase de sauvegarde comes after the red", () => {
    const v = map([[9, "2026-10-24T06:00:00", "2026-10-24T20:00:00"], [6, "2026-10-24T20:00:00"]]);
    expect(cycloneLevel(v.zones[mf.ISLAND][mf.CYCLONE], NOW)).toBe(4);
    expect(alerteOf(v, NOW)).toMatchObject({ couleur: 4, ecoles: true });
    expect(alerteOf(map([[7, "2026-10-24T06:00:00"]]), NOW)?.ecoles).toBeUndefined();
  });
});

describe("the schools and the cyclone alert", () => {
  const SELON = ", selon le dispositif ORSEC Cyclones (arrêté 2026-182).";

  it("says each state in marketing's words, with the plan as its source", () => {
    expect(ecoles(map([]), NOW)).toMatchObject({ etat: "aucune", texte: "Pas d'alerte cyclonique en cours à La Réunion.", fermees: false });
    const pre = ecoles(map([[7, "2026-10-24T06:00:00"]]), NOW);
    expect(pre).toMatchObject({ etat: "pre_alerte", fermees: false });
    expect(pre.texte).toBe(`Pré-alerte cyclonique : « Je m'informe et j'anticipe » (p. 17). C'est en alerte orange que « Tous les établissements scolaires et les crèches ferment » (p. 17)${SELON}`);
    // The first period of the bulletin: Météo-France does not say when it began.
    expect(pre.depuis).toBeUndefined();
    expect(ecoles(map([[9, "2026-10-24T06:00:00"]]), NOW).texte).toBe(`Alerte rouge : crèches, écoles, collèges, lycées et universités fermés${SELON}`);
    expect(ecoles(map([[10, "2026-10-24T06:00:00"]]), NOW).texte).toBe(`Alerte violette : crèches, écoles, collèges, lycées et universités fermés${SELON}`);
    expect(ecoles(map([[6, "2026-10-24T06:00:00"]]), NOW)).toMatchObject({
      etat: "sauvegarde",
      fermees: true,
      texte: `Phase de sauvegarde : les crèches, les écoles, les collèges, les lycées et les universités « restent fermés », et leur « réouverture est décidée quand les conditions d'accueil sont satisfaisantes » (p. 19-20)${SELON}`,
      reouverture: "La réouverture est annoncée par la préfecture et le rectorat (ac-reunion.fr).",
    });
  });

  it("tells an orange alert announced before the schools open from one that starts during the day", () => {
    // Announced for 19:00: the schools will not open tomorrow; not closed yet.
    const evening = ecoles(map([[7, "2026-10-24T06:00:00", "2026-10-24T19:00:00"], [8, "2026-10-24T19:00:00"]]), NOW);
    expect(evening).toMatchObject({ etat: "orange_avant_ouverture", fermees: false, depuis: "Alerte orange décidée par la préfecture pour le samedi 24/10 à 19:00 (bulletin de Météo-France)." });
    expect(evening.texte).toBe(`Alerte orange annoncée avant l'ouverture des écoles : pas de ramassage scolaire, et les crèches, écoles, collèges et lycées n'ouvrent pas${SELON}`);
    // Started at 13:00, during the day: the pupils go home.
    const day = ecoles(map([[7, "2026-10-24T06:00:00", "2026-10-24T13:00:00"], [8, "2026-10-24T13:00:00"]]), NOW);
    expect(day).toMatchObject({ etat: "orange_en_journee", fermees: true, depuis: "Alerte orange décidée par la préfecture, en vigueur depuis le samedi 24/10 à 13:00 (bulletin de Météo-France)." });
    expect(day.texte).toContain("les élèves déjà en classe, internes compris, rentrent chez eux selon le plan d'évacuation de leur établissement");
    // The next morning, the same alert: the schools did not open.
    expect(ecoles(map([[7, "2026-10-24T06:00:00", "2026-10-24T13:00:00"], [8, "2026-10-24T13:00:00"]]), new Date("2026-10-25T04:00:00Z")).etat).toBe("orange_avant_ouverture");
  });

  it("says the alert is lifted, and that the reopening is not read here", () => {
    const e = ecoles(map([[6, "2026-10-24T06:00:00", "2026-10-24T12:00:00"], [-1, "2026-10-24T12:00:00"]]), NOW);
    expect(e).toEqual({ etat: "levee", texte: "Alerte levée. La réouverture des écoles est annoncée par la préfecture et le rectorat (ac-reunion.fr) : elle n'est pas encore lue ici.", fermees: false, niveau: -1 });
  });

  it("never says the schools are open, nor names one", () => {
    const states = [[], [[7, "2026-10-24T06:00:00"]], [[8, "2026-10-24T06:00:00"]], [[9, "2026-10-24T06:00:00"]], [[10, "2026-10-24T06:00:00"]], [[6, "2026-10-24T06:00:00"]]] as [number, string][][];
    for (const s of states) expect(JSON.stringify(ecolesBlock(map(s), NOW))).not.toMatch(/ouvertes|est ouverte/);
  });

  it("puts one line in the day's summary while the schools are closed, none otherwise", () => {
    expect(resumeLine(ecoles(map([[8, "2026-10-24T06:00:00"]]), NOW))).toBe("Crèches, écoles, collèges et lycées fermés (alerte orange cyclonique), selon le dispositif ORSEC Cyclones (arrêté 2026-182).");
    expect(resumeLine(ecoles(map([[7, "2026-10-24T06:00:00"]]), NOW))).toBeUndefined();
  });

  it("is a page of its own, the rule under the state, the plan linked", () => {
    const page = (v: mf.Vigilance) => ecolesPage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW, alerteOf(v, NOW));
    const calm = page(map([]));
    expect(calm).toContain("<title>École fermée ? Cyclone et alerte orange Réunion · 974</title>");
    expect(calm).toContain("<h1>Cyclone : les écoles sont-elles fermées ?</h1>");
    expect(calm).toContain("Pas d&#39;alerte cyclonique en cours à La Réunion.");
    expect(calm).toContain("Ce que prévoit le plan ORSEC Cyclones</h2>");
    expect(calm).toContain("Alerte orange cyclonique : crèches, écoles, collèges et lycées fermés pour l&#39;ensemble du département. La règle du plan ORSEC");
    const orange = page(map([[8, "2026-10-24T06:00:00"]]));
    expect(orange).toContain('selon le <a href="https://www.reunion.gouv.fr/Actions-de-l-Etat/');
    expect(orange).toContain("🌀 Alerte orange à La Réunion (974) : crèches, écoles, collèges et lycées fermés, selon le plan ORSEC Cyclones de la préfecture.");
    const since = page(map([[7, "2026-10-24T06:00:00", "2026-10-24T13:00:00"], [8, "2026-10-24T13:00:00"]]));
    expect(since).toContain('en vigueur depuis le samedi 24/10 à 13:00 (<a href="https://vigilance.meteofrance.fr/fr/la-reunion" rel="noopener">bulletin de Météo-France</a>).');
    // On its own page, the banner does not link to it.
    expect(orange).not.toContain('<a href="/ecoles-cyclone">Écoles fermées →</a>');
  });
});

describe("the schools' sentences quote the plan, page by page", () => {
  const STATES = [[], [[7, "2026-10-24T06:00:00"]], [[8, "2026-10-24T06:00:00"]], [[7, "2026-10-24T06:00:00", "2026-10-24T13:00:00"], [8, "2026-10-24T13:00:00"]], [[9, "2026-10-24T06:00:00"]], [[10, "2026-10-24T06:00:00"]], [[6, "2026-10-24T06:00:00"]], [[6, "2026-10-24T06:00:00", "2026-10-24T12:00:00"], [-1, "2026-10-24T12:00:00"]]] as [number, string, string?][][];

  it("finds every quotation of the rule and of the states on the pages they give", () => {
    const sentences = [...REGLE, ...STATES.flatMap((s) => [ecoles(map(s), NOW).texte, ecoles(map(s), NOW).reouverture ?? ""])];
    for (const line of sentences) for (const { quote, pages } of cited(line)) expect(onPages(quote, pages), `p. ${pages.join("-")} : « ${quote} »`).toBe(true);
    // The three sentences marketing rewrote quote the plan; the others say it in short, without quotation marks.
    for (const line of [REGLE[2], ecoles(map(STATES[1]), NOW).texte, ecoles(map(STATES[6]), NOW).texte]) expect(cited(line).length, line).toBeGreaterThan(0);
  });

  it("says nothing the plan does not, on /ecoles-cyclone and /alerte-cyclone, in every state", () => {
    const at24 = (v: mf.Vigilance) => ({ value: v, fetchedAt: NOW, stale: false });
    for (const s of STATES) {
      const v = map(s);
      for (const out of [ecolesPage("https://rundata.re", at24(v), NOW), alertePage("https://rundata.re", at24(v), NOW), JSON.stringify(ecolesBlock(v, NOW))])
        expect(out).not.toMatch(/pendant le passage du cyclone|pas de fermeture/);
    }
  });

  it("in the phase de sauvegarde, gives the prefecture's release on the reopening instead of who announces it", () => {
    const v = map([[6, "2026-10-24T06:00:00"]]);
    const reopen = { titre: "Réouverture des établissements scolaires lundi", lien: "https://www.reunion.gouv.fr/Actualites/Cyclone-Test/Reouverture", jour: "2026-10-24" };
    const c: Cyclone = { decision: { niveau: "levee", titre: "Levée de l'alerte cyclonique", lien: "https://www.reunion.gouv.fr/Actualites/Cyclone-Test/Levee", jour: "2026-10-24" }, reouverture: reopen };
    const e = withPrefecture(ecoles(v, NOW), c, v, NOW);
    expect(e.reouverture).toBe(`Réouverture des écoles annoncée par la préfecture le samedi 24/10 : « ${reopen.titre} » → Le détail, avec les éventuelles exceptions par commune, est dans le communiqué.`);
    // The bulletin still gives the phase de sauvegarde: the end of the alert is said beside it, not instead.
    expect(e).toMatchObject({ etat: "sauvegarde", fermees: true });
    expect(e.cites?.map((x) => x.lien)).toEqual([reopen.lien, c.decision.lien]);
    const html = ecolesPage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW, undefined, c);
    expect(html).toContain(`<p class="lead">Réouverture des écoles annoncée par la préfecture le samedi 24/10 : <a href="${reopen.lien}" rel="noopener">« ${reopen.titre} » →</a>`);
    expect(html).not.toContain("La réouverture est annoncée par la préfecture et le rectorat");
  });
});
