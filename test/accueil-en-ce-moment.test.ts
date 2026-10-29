import { describe, expect, it } from "vitest";
import type { Info } from "../src/providers/actualites.js";
import { infoRow } from "../src/tools/actualites.js";
import type { ActualitesAnswer } from "../src/web/data.js";
import { homePage } from "../src/web/home.js";

const NOW = new Date("2026-10-29T06:39:51Z");

// The articles of 29/10/2026 morning that the subject « route » reached, with the subjects the provider gave them:
// three by words of their text (« sans accident », « la route »), one by its headline.
const article = (titre: string, media: string, lien: string, publie: string, sujets: string[], communes: string[] = []): Info =>
  ({ titre, media, lien, publie, heure: true, communes, lieux: [], sujets });
const INFOS = [
  article("Rallye Grand Est à Sainte-Suzanne : un bénévole de sécurité dénonce une agression", "Freedom", "https://www.freedom.fr/rallye", "2026-10-29T05:25:52.000Z", ["route", "securite"], ["Sainte-Suzanne"]),
  article("Saint-Denis : un motard grièvement blessé après un accident à La Bretagne, le conducteur en fuite interpellé", "Imaz Press", "https://imazpress.com/faits-divers/saint-denis-accident-moto-bretagne", "2026-10-29T05:16:00.000Z", ["route", "securite"], ["Saint-Denis"]),
  article("Rentrer du travail en bonne santé : la prévention passe aussi par le jeu – Vidéo", "Freedom", "https://www.freedom.fr/rentrer", "2026-10-29T04:56:55.000Z", ["route", "sante"], ["Saint-Pierre"]),
  article("AVC à La Réunion : près de 1 900 hospitalisations par an, les signes qui doivent alerter et les gestes qui peuvent sauver une vie", "Freedom", "https://www.freedom.fr/avc", "2026-10-29T03:00:18.000Z", ["route"]),
];

const answer = (infos: Info[]): ActualitesAnswer => ({
  infos: infos.map((i) => infoRow(i, NOW)),
  total: infos.length,
  en_direct: [],
  prefecture: [],
  chaud: true,
  indisponible: [],
  couverture: "",
  a_savoir: "",
  sources: [],
});

/** The headlines of the block « En ce moment sur l'île », empty without it. */
function block(infos: Info[]): string {
  const html = homePage("https://rundata.re", { meteo: null, actualites: { value: answer(infos), fetchedAt: NOW, stale: false } }, NOW);
  return html.match(/<div class="card warn now-news">[\s\S]*?<\/ul>/)?.[0] ?? "";
}

describe("home page, « En ce moment sur l'île »", () => {
  it("takes an article for road news by its headline, not by the words of its text", () => {
    const html = block(INFOS);
    expect(html).toContain("un motard grièvement blessé après un accident");
    for (const t of ["Rallye Grand Est", "Rentrer du travail", "AVC à La Réunion"]) expect(html).not.toContain(t);
  });

  it("is not shown when no headline speaks of the roads", () => {
    expect(block(INFOS.filter((i) => !i.titre.includes("motard")))).toBe("");
  });
});
