import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Info, parseImazLive } from "../src/providers/actualites.js";
import { infoRow } from "../src/tools/actualites.js";
import type { ActualitesAnswer } from "../src/web/data.js";
import { homePage } from "../src/web/home.js";

const NOW = new Date("2026-10-29T05:30:00Z");

// Articles of the morning of 29/10/2026, as the provider read them (subjects, communes).
const article = (titre: string, media: string, lien: string, publie: string, sujets: string[], communes: string[] = [], heure = true): Info =>
  ({ titre, media, lien, publie, heure, communes, lieux: [], sujets });
const INFOS = [
  article("Rallye Grand Est à Sainte-Suzanne : un bénévole de sécurité dénonce une agression", "Freedom", "https://www.freedom.fr/rallye", "2026-10-29T05:25:52.000Z", ["route", "securite"], ["Sainte-Suzanne"]),
  article("Saint-Denis : un motard grièvement blessé après un accident à La Bretagne, le conducteur en fuite interpellé", "Imaz Press", "https://imazpress.com/faits-divers/saint-denis-accident-moto-bretagne", "2026-10-29T05:16:00.000Z", ["route", "securite"], ["Saint-Denis"]),
  article("Psychiatrie : des experts se réunissent pour faire progresser les soins en santé mentale à La Réunion", "Imaz Press", "https://imazpress.com/toute-l-actu/congres-innovation-en-psychiatrie", "2026-10-29T05:15:00.000Z", ["sante"]),
  article("Le Tampon : un budget consolidé de 319,7 millions d'euros pour la commune", "Imaz Press", "https://imazpress.com/zoom/le-tampon-conseil-municipal-budget", "2026-10-29T05:13:00.000Z", [], ["Le Tampon"]),
  article("[Vidéo] Saint-Benoît : des enfants atteints de déficiences sensorielles ont participé au cross du collège La Salle", "Imaz Press", "https://imazpress.com/toute-l-actu/saint-benoit-enfants-deficiences-sensorielles-au-cross-du-college-la-salle", "2026-10-29T04:57:00.000Z", [], ["Saint-Benoît"]),
  article("Rentrer du travail en bonne santé : la prévention passe aussi par le jeu – Vidéo", "Freedom", "https://www.freedom.fr/rentrer", "2026-10-29T04:56:55.000Z", ["route", "sante"], ["Saint-Pierre"]),
  // « il y a 4 heures » on Le Quotidien's page: no minute, put at the time of the read less four hours.
  article("Salon de l'emploi et de la formation dès demain : 2 500 opportunités pour passer à l'action", "Le Quotidien", "https://www.lequotidien.re/article/societe/2026/10/29/reunion-salon-emploi-formation-2500-opportunites-nordev-vendredi-le-quotidien", "2026-10-29T05:29:00.000Z", [], [], false),
  article("Etang-Salé : la pièce “Un animal sauvage peut croiser votre route” au Théâtre des Sables", "Imaz Press", "https://imazpress.com/toute-l-actu/theatre-sable-etang-sale", "2026-10-28T13:35:00.000Z", ["route"], ["L'Étang-Salé"]),
];

const answer = (infos: Info[], directs: Info[], now: Date, chaud: boolean): ActualitesAnswer => ({
  infos: infos.map((i) => infoRow(i, now)),
  total: infos.length,
  en_direct: directs.map((i) => infoRow(i, now)),
  prefecture: [],
  chaud,
  indisponible: [],
  couverture: "",
  a_savoir: "",
  sources: [],
});

/** The block « En ce moment sur l'île »: its class and its headlines, in order; empty without it. */
function block(infos: Info[], { directs = [] as Info[], now = NOW, chaud = false } = {}) {
  const html = homePage("https://rundata.re", { meteo: null, actualites: { value: answer(infos, directs, now, chaud), fetchedAt: now, stale: false } }, now);
  const div = /<div class="(card[^"]*) now-news">[\s\S]*?<\/ul>/.exec(html);
  return { cls: div?.[1], titres: [...(div?.[0] ?? "").matchAll(/<a href="[^"]*" rel="noopener"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]) };
}

describe("home page, « En ce moment sur l'île »", () => {
  it("shows the island's newest headlines on a quiet morning too, whatever their subject, in a card that is no alert", () => {
    const { cls, titres } = block(INFOS);
    expect(cls).toBe("card");
    expect(titres.map((t) => t.slice(0, 20))).toEqual(["Rallye Grand Est à S", "Saint-Denis : un mot", "Psychiatrie : des ex", "Le Tampon : un budge", "[Vidéo] Saint-Benoît"]);
  });

  it("leaves out a headline known by its hour or its day only, and those older than six hours", () => {
    const { titres } = block(INFOS.filter((i) => !/Rallye|motard|Psychiatrie|Tampon/.test(i.titre)));
    expect(titres.map((t) => t.slice(0, 20))).toEqual(["[Vidéo] Saint-Benoît", "Rentrer du travail e"]);
  });

  it("puts the live blogs first, then the headlines, in the colours of an alert", () => {
    const now = new Date("2026-10-29T09:00:00Z");
    const live = parseImazLive(readFileSync(new URL("./fixtures/actualites/imaz_live.html", import.meta.url), "utf8"), "https://imazpress.com/live", now).slice(0, 2);
    const { cls, titres } = block(INFOS, { directs: live, now, chaud: true });
    expect(cls).toBe("card warn");
    expect(titres.length).toBe(5);
    expect(titres[0].startsWith("À 11 heures, une vingtaine de personnes")).toBe(true);
    expect(titres[1]).toBe("Rentrez vos poubelles !");
    expect(titres[2].startsWith("Rallye Grand Est")).toBe(true);
  });

  it("gives a busy live blog three lines at most, the last one leading to the live blog, and the rest to the headlines", () => {
    const now = new Date("2026-10-29T09:00:00Z");
    const live = parseImazLive(readFileSync(new URL("./fixtures/actualites/imaz_live.html", import.meta.url), "utf8"), "https://imazpress.com/live", now);
    expect(live.filter((i) => i.publie >= "2026-10-29T03:00:00Z").length).toBeGreaterThan(3);
    const { titres } = block(INFOS, { directs: live, now, chaud: true });
    expect(titres.length).toBe(5);
    expect(titres[0].startsWith("À 11 heures, une vingtaine de personnes")).toBe(true);
    expect(titres[1]).toBe("Rentrez vos poubelles !");
    expect(titres[2]).toBe("Toutes les entrées du direct");
    expect(titres.slice(3).map((t) => t.slice(0, 20))).toEqual(["Rallye Grand Est à S", "Saint-Denis : un mot"]);
    const html = homePage("https://rundata.re", { meteo: null, actualites: { value: answer(INFOS, live, now, true), fetchedAt: now, stale: false } }, now);
    expect(html).toMatch(/<a href="https:\/\/imazpress\.com\/live"[^>]*>Toutes les entrées du direct<\/a>/);
  });

  it("is not shown without a headline of the last six hours", () => {
    expect(block(INFOS, { now: new Date("2026-10-29T12:00:00Z") }).cls).toBeUndefined();
  });
});
