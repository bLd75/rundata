import { describe, expect, it } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { AGENT, checkAnswer, checkPage, PAGES, parseTime, TOOLS } from "../src/bin/check-sources.js";
import type { Hit } from "../src/metrics.js";

// Saturday 24 October 2026, 07:11 in Réunion.
const NOW = new Date("2026-10-24T03:11:00Z");
const tool = (name: string) => TOOLS.find((c) => c.point.startsWith(name))!;
const page = (path: string) => PAGES.find((c) => c.path === path)!;
const answer = (p: unknown) => ({ content: [{ type: "text", text: JSON.stringify(p) }] });
const motifs = (name: string, p: unknown, now = NOW) => checkAnswer(tool(name), answer(p), now).map((x) => x.motif);

describe("the daily check of the sources", () => {
  it("reads the times as the answers write them, in Réunion time", () => {
    expect(parseTime("24/10 15:25 heure de La Réunion", NOW)?.toISOString()).toBe("2026-10-24T11:25:00.000Z");
    expect(parseTime("24/10 06:36", NOW)?.toISOString()).toBe("2026-10-24T02:36:00.000Z");
    expect(parseTime("23/10/2026 à 21:49", NOW)?.toISOString()).toBe("2026-10-23T17:49:00.000Z");
    expect(parseTime("2026-10-22", NOW)?.toISOString()).toBe("2026-10-21T20:00:00.000Z");
    expect(parseTime("2026-10-24T08:00:00.000Z", NOW)?.toISOString()).toBe("2026-10-24T08:00:00.000Z");
    // On the 1st of January, « 31/12 » is the day before, not the end of the year.
    expect(parseTime("31/12 22:00", new Date("2027-01-01T03:00:00Z"))?.toISOString()).toBe("2026-12-31T18:00:00.000Z");
    expect(parseTime("demain 5h00", NOW)).toBeUndefined();
  });

  it("fails on an error, a last copy, an old bulletin", () => {
    expect(checkAnswer(tool("vigilance"), { isError: true, content: [{ type: "text", text: "MCP error -32602" }] }, NOW)[0].motif).toMatch(/^erreur de l'outil : MCP error/);
    expect(motifs("vigilance", { emise: "24/10 06:25 heure de La Réunion", fraicheur: {} })).toEqual([]);
    expect(motifs("vigilance", { emise: "23/10 10:25 heure de La Réunion", fraicheur: {} })).toEqual(["bulletin d'il y a 20,8 h (seuil 18 h)"]);
    expect(motifs("vigilance", { emise: "24/10 06:25", fraicheur: { copie_de_secours: true, avertissement: "Source injoignable : dernière valeur connue, lue le 23/10 18:00." } }))
      .toEqual(["copie de secours : Source injoignable : dernière valeur connue, lue le 23/10 18:00."]);
    expect(motifs("meteo_actuelle", { stations: [{ heure_mesure: "24/10 02:30" }, { heure_mesure: "24/10 06:30" }], fraicheur: {} })).toEqual([]);
    expect(motifs("meteo_actuelle", { stations: [], fraicheur: {} })).toEqual(["mesure absente ou illisible"]);
    // The production's time is heure_mesure (electricite): fresh, three hours old and more, missing.
    expect(motifs("electricite", { production: { heure_mesure: "24/10 06:50 heure de La Réunion", age_min: 21 }, fraicheur: {} })).toEqual([]);
    expect(motifs("electricite", { production: { heure_mesure: "24/10 03:20 heure de La Réunion", age_min: 231 }, fraicheur: {} })).toEqual(["production d'il y a 3,9 h (seuil 3 h)"]);
    expect(motifs("electricite", { production: { heure: "24/10 06:50 heure de La Réunion" }, fraicheur: {} })).toEqual(["production absente ou illisible"]);
  });

  it("fails on the volcano's level unknown, and on an OVPF image left unread for a day", () => {
    const etat = { niveau_orsec: "Alerte 1", communique_prefecture: { niveau: "Alerte 1" }, image_ovpf_plus_recente: true };
    expect(motifs("volcan", { etat, publications_ovpf: [{ date: "23/10 19:46 heure de La Réunion", image: true }], fraicheur: {} })).toEqual([]);
    expect(motifs("volcan", { etat, publications_ovpf: [{ date: "23/10 06:46 heure de La Réunion", image: true }], fraicheur: {} }))
      .toEqual(["la publication la plus récente de l'OVPF est une image non lue depuis 24,4 h"]);
    expect(motifs("volcan", { etat: { niveau_orsec: "non lu par rundata.re, à vérifier sur reunion.gouv.fr" }, fraicheur: {} }))
      .toEqual(["niveau ORSEC inconnu (« non lu par rundata.re, à vérifier sur reunion.gouv.fr »)"]);
    expect(motifs("volcan", { etat: { niveau_orsec: "Alerte 1" }, fraicheur: {} })).toEqual(["niveau Alerte 1 sans communiqué de la préfecture lu"]);
    expect(motifs("volcan", { etat: { niveau_orsec: "Vigilance" }, fraicheur: {} })).toEqual([]);
    // An alert 2 with no eruption read is flagged, unless the OVPF said the eruption stopped (the level stays until the next release).
    const alerte2 = { niveau_orsec: "Alerte 2-2", eruption_en_cours: false, communique_prefecture: { niveau: "Alerte 2-2" } };
    expect(motifs("volcan", { etat: alerte2, fraicheur: {} })).toEqual(["Alerte 2 sans éruption en cours dans l'état lu"]);
    expect(motifs("volcan", { etat: { ...alerte2, eruption_ovpf: { en_cours: false, date: "2026-04-12T19:10:00Z", lien: "https://bsky.app/x" } }, fraicheur: {} })).toEqual([]);
  });

  it("checks the buses' real time and the month's fuel prices", () => {
    expect(motifs("transports", { horaires: "Car Jaune : heures annoncées en temps réel par le réseau (flux de 07:02) quand le bus y figure", fraicheur: {} })).toEqual([]);
    expect(motifs("transports", { horaires: "Car Jaune : heures annoncées en temps réel par le réseau (flux de 05:40) quand le bus y figure", fraicheur: {} }))
      .toEqual(["flux temps réel d'il y a 1,5 h (seuil 30 min)"]);
    expect(motifs("transports", { horaires: "théoriques, publiés par chaque réseau", fraicheur: {} })).toEqual(["pas de temps réel dans les départs"]);
    expect(motifs("carburants", { en_vigueur_depuis: "1er octobre 2026", fraicheur: {} })).toEqual([]);
    expect(motifs("carburants", { en_vigueur_depuis: "1er octobre 2026", fraicheur: {} }, new Date("2026-11-03T03:11:00Z"))).toEqual(["prix en vigueur depuis « 1er octobre 2026 », pas novembre 2026"]);
    // The 1st and the 2nd, the new order may not be read yet.
    expect(motifs("carburants", { en_vigueur_depuis: "1er octobre 2026", fraicheur: {} }, new Date("2026-11-02T03:11:00Z"))).toEqual([]);
  });

  it("checks a page: its live block, no source down, its data's day", () => {
    const fresh = '<script type="application/ld+json">{"dateModified":"2026-10-24T02:48:27.282Z"}</script><p>Rien à signaler.</p>';
    expect(checkPage(page("/vigilance"), 200, "public, max-age=60", fresh, NOW)).toEqual([]);
    expect(checkPage(page("/vigilance"), 200, "no-store", fresh, NOW)[0].motif).toBe("servie sans son bloc en direct");
    expect(checkPage(page("/vigilance"), 503, "", "", NOW)[0].motif).toBe("HTTP 503");
    expect(checkPage(page("/trafic"), 200, "", fresh.replace("Rien à signaler.", "Le temps réel des bus ne répond pas pour le moment."), NOW).map((x) => x.motif)).toEqual(["dit « ne répond pas »"]);
    expect(checkPage(page("/vigilance"), 200, "", fresh.replace("2026-10-24T02", "2026-10-23T22"), NOW).map((x) => x.motif)).toEqual(["donnée d'il y a 4,4 h (seuil 2 h)"]);
    expect(checkPage(page("/carburants"), 200, "", "<h1>Prix des carburants à La Réunion, septembre 2026</h1>", NOW).map((x) => x.motif)).toEqual(["le titre ne dit pas octobre 2026"]);
    expect(checkPage(page("/volcan"), 200, "", `${fresh}<p>Accès à l'Enclos : à vérifier sur reunion.gouv.fr</p>`, NOW).map((x) => x.motif)).toEqual(["niveau ou accès à l'Enclos « à vérifier »"]);
  });

  it("is not counted as a visit by the Worker", async () => {
    const hits: Hit[] = [];
    const get = (ua: string) => handle(new Request("https://rundata.re/nouveautes", { headers: { accept: "text/html", "user-agent": ua } }), new Cache(), () => {}, (h) => hits.push(h));
    await get(AGENT);
    expect(hits).toEqual([]);
    await get("Mozilla/5.0");
    expect(hits).toHaveLength(1);
  });
});
