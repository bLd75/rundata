import { describe, expect, it } from "vitest";
import { configurerEquipe, handle, JETON_EQUIPE } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { AGENT, checkAnswer, checkPage, MAX_BYTES, PAGES, parseTime, TOOLS } from "../src/bin/check-sources.js";
import type { Hit } from "../src/metrics.js";

// Saturday 24 October 2026, 07:11 in Réunion.
const NOW = new Date("2026-10-24T03:11:00Z");
const SECRET = "secret-de-test-0123456789abcdef";
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
    const avertissement = "La source « Vigilance météo » n'a pas répondu à notre dernière lecture : ce qui vient d'elle date de notre lecture du 23/10 à 18:00.";
    expect(motifs("vigilance", { emise: "24/10 06:25", fraicheur: { copies_de_secours: [{ source: "Vigilance météo", lue_le: "23/10 18:00" }], avertissement } }))
      .toEqual([`copie de secours : ${avertissement}`]);
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
    // A newer end of an eruption than the last eruption's dates, kept by hand: to date.
    expect(motifs("volcan", { etat: { niveau_orsec: "Vigilance", derniere_eruption_a_dater: { date: "20/10 14:00 heure de La Réunion", lien: "https://bsky.app/x" } }, fraicheur: {} }))
      .toEqual(["l'OVPF a annoncé la fin d'une éruption le 20/10 14:00 heure de La Réunion (https://bsky.app/x) : dater la dernière éruption dans volcan-historique.ts"]);
  });

  it("checks the buses' real time and the month's fuel prices", () => {
    expect(motifs("transports", { horaires: "Car Jaune : heures annoncées en direct par le réseau (flux de 07:02) quand le bus y figure", fraicheur: {} })).toEqual([]);
    expect(motifs("transports", { horaires: "Car Jaune : heures annoncées en direct par le réseau (flux de 05:40) quand le bus y figure", fraicheur: {} }))
      .toEqual(["flux temps réel d'il y a 1,5 h (seuil 30 min)"]);
    expect(motifs("transports", { horaires: "théoriques, publiés par chaque réseau", fraicheur: {} })).toEqual(["pas de temps réel dans les départs"]);
    expect(motifs("carburants", { en_vigueur_depuis: "1er octobre 2026", fraicheur: {} })).toEqual([]);
    expect(motifs("carburants", { en_vigueur_depuis: "1er octobre 2026", fraicheur: {} }, new Date("2026-11-03T03:11:00Z"))).toEqual(["prix en vigueur depuis « 1er octobre 2026 », pas novembre 2026"]);
    // The 1st and the 2nd, the new order may not be read yet.
    expect(motifs("carburants", { en_vigueur_depuis: "1er octobre 2026", fraicheur: {} }, new Date("2026-11-02T03:11:00Z"))).toEqual([]);
  });

  it("checks the size of each answer, the vigilance and the cyclones apart", () => {
    expect(Object.keys(MAX_BYTES).filter((k) => !TOOLS.some((c) => c.point === k))).toEqual([]);
    expect(TOOLS.filter((c) => !(c.point in MAX_BYTES)).map((c) => c.point)).toEqual(["vigilance_meteo", "cyclones"]);
    const big = { resume: "x".repeat(40_000) };
    expect(motifs("volcan_seismes", big)).toContain("réponse de 40\u00a0Ko, au-delà de 36\u00a0Ko");
    expect(motifs("volcan_seismes", { resume: "x".repeat(30_000) }).some((m) => m.startsWith("réponse de"))).toBe(false);
    // Counted in bytes, as it travels: an accented letter weighs two.
    expect(motifs("electricite", { resume: "é".repeat(5_500) }).some((m) => m.startsWith("réponse de"))).toBe(true);
    expect(motifs("cyclones", big)).toEqual([]);
  });

  it("checks a page: its live block, no source down, its data's day", () => {
    const fresh = '<script type="application/ld+json">{"dateModified":"2026-10-24T02:48:27.282Z"}</script><p>Rien à signaler.</p>';
    expect(checkPage(page("/vigilance"), 200, "public, max-age=60", fresh, NOW)).toEqual([]);
    expect(checkPage(page("/vigilance"), 200, "no-store", fresh, NOW)[0].motif).toBe("servie sans son bloc en direct");
    expect(checkPage(page("/vigilance"), 503, "", "", NOW)[0].motif).toBe("HTTP 503");
    expect(checkPage(page("/trafic"), 200, "", fresh.replace("Rien à signaler.", "Le flux en direct des bus ne répond pas pour le moment."), NOW).map((x) => x.motif)).toEqual(["dit « ne répond pas »"]);
    expect(checkPage(page("/vigilance"), 200, "", fresh.replace("2026-10-24T02", "2026-10-23T22"), NOW).map((x) => x.motif)).toEqual(["donnée d'il y a 4,4 h (seuil 2 h)"]);
    expect(checkPage(page("/carburants"), 200, "", "<h1>Prix des carburants à La Réunion, septembre 2026</h1>", NOW).map((x) => x.motif)).toEqual(["le titre ne dit pas octobre 2026"]);
    expect(checkPage(page("/volcan"), 200, "", `${fresh}<p>Accès à l'Enclos : à vérifier sur reunion.gouv.fr</p>`, NOW).map((x) => x.motif)).toEqual(["niveau ou accès à l'Enclos « à vérifier »"]);
  });

  it("is not counted as a visit by the Worker when it sends the team's secret", async () => {
    const hits: Hit[] = [];
    const get = (headers: Record<string, string>) => handle(new Request("https://rundata.re/nouveautes", { headers: { accept: "text/html", "user-agent": AGENT, ...headers } }), new Cache(), () => {}, (h) => hits.push(h));
    configurerEquipe(SECRET);
    try {
      await get({ [JETON_EQUIPE]: SECRET });
      expect(hits).toEqual([]);
      await get({});
      expect(hits).toHaveLength(1);
    } finally {
      configurerEquipe(undefined);
    }
  });

  it("leaves out only the calls with the team's secret: not a User-Agent that says « rundata- », nor a wrong secret, nor anyone while no secret is set", async () => {
    const hits: Hit[] = [];
    const page = (ua: string, headers: Record<string, string> = {}) => handle(new Request("https://rundata.re/nouveautes", { headers: { accept: "text/html", "user-agent": ua, ...headers } }), new Cache(), () => {}, (h) => hits.push(h));
    const call = (ua: string, headers: Record<string, string> = {}) =>
      handle(
        new Request("https://rundata.re/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", "user-agent": ua, ...headers },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
        }),
        new Cache(),
        () => {},
        (h) => hits.push(h),
      );
    configurerEquipe(SECRET);
    try {
      for (const ua of ["rundata-check/ship", "curl/8.5 rundata-audit", "Mozilla/5.0"]) {
        await page(ua, { [JETON_EQUIPE]: SECRET });
        await call(ua, { [JETON_EQUIPE]: SECRET });
      }
      expect(hits).toEqual([]);
      // Read in the Worker's logs, 24-26/10/2026: anyone may write these.
      for (const ua of ["rundata-check", "rundata-check/ship", "Mozilla/5.0 rundata-check", "curl/8.5 rundata-audit"]) await call(ua);
      await call("rundata-check/ship", { [JETON_EQUIPE]: SECRET.slice(0, -1) + "x" });
      await call("rundata-check/ship", { [JETON_EQUIPE]: SECRET.slice(1) });
      expect(hits.map((h) => h.kind)).toEqual(["rpc", "rpc", "rpc", "rpc", "rpc", "rpc"]);
    } finally {
      configurerEquipe(undefined);
    }
    await page("rundata-check/ship", { [JETON_EQUIPE]: SECRET });
    expect(hits).toHaveLength(7);
  });
});
