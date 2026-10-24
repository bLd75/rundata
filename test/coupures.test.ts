import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { communesIn, parseNotice } from "../src/providers/avis-eau.js";
import { coupuresEau } from "../src/tools/coupures.js";

// The distributors' notices on 24/10/2026 in the morning: a cut announced in Saint-Denis for Monday night, the water
// of La Plaine-des-Palmistes and of Grand Ilet (Salazie) not to be drunk, Saint-Benoît back to normal since the 15th.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/avis-eau/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());

describe("coupures d'eau", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: string) => {
      const file = url.includes("dioneo") ? "dioneo.xml" : url.includes("runeo") ? "runeo.xml" : url.includes("possession") ? "possession.xml" : "cirest.json";
      return new Response(fixture(file));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the hours and streets of a cut", () => {
    const n = parseNotice("Dionéo informe ses clients de SAINT DENIS, qu'en raison de travaux sur le réseau, l'alimentation en eau sera interrompue à partir de 21:00 le 26/10/2026 pour les secteurs suivants :\nROUTE DE BOIS DE NEFLES\nDes perturbations dans la distribution de l'eau sont à prévoir.\nLa remise en eau est prévue à partir de 05:00 le 27/10/2026, sauf incident.");
    expect(n).toEqual({ debut: "2026-10-26T21:00", fin: "2026-10-27T05:00", secteurs: ["ROUTE DE BOIS DE NEFLES"] });
    expect(communesIn("clients de SAINT DENIS")).toEqual(["Saint-Denis"]);
    expect(communesIn("abonnés de La Plaine-des-Palmistes")).toEqual(["La Plaine-des-Palmistes"]);
  });

  it("says first where the water is not to be drunk, and not where it is again", async () => {
    const b = body(await coupuresEau(cache(), undefined, NOW));
    expect(b.ne_pas_boire).toEqual(["La Plaine-des-Palmistes", "Salazie"]);
    expect(b.avis.filter((n: { ne_pas_boire?: boolean }) => n.ne_pas_boire)).toHaveLength(2);
    expect(b.avis.every((n: { texte: string }) => !/\p{Extended_Pictographic}/u.test(n.texte))).toBe(true);
  });

  it("gives a cut to come with its hours", async () => {
    const b = body(await coupuresEau(cache(), "Saint-Denis", NOW));
    expect(b.resume).toBe("1 avis récent ou à venir à Saint-Denis : Travaux sur le réseau / RD49.");
    expect(b.avis[0].coupure).toEqual({ de: "lundi 26/10 à 21:00", a: "mardi 27/10 à 05:00", etat: "à venir" });
  });

  it("warns for a commune whose water is not to be drunk", async () => {
    const b = body(await coupuresEau(cache(), "Plaine des Palmistes", NOW));
    expect(b.resume).toMatch(/^EAU À NE PAS BOIRE à La Plaine-des-Palmistes \(secteurs dans l'avis\), d'après l'avis du 23\/10\/2026 à 21:49/);
    expect(b.ne_pas_boire.titre).toMatch(/RESTRICTION D’USAGE DE L’EAU/);
  });

  it("says when a commune's distributor publishes nothing read here", async () => {
    const b = body(await coupuresEau(cache(), "Saint-Pierre", NOW));
    expect(b.resume).toBe("Pas d'avis en ligne lisible pour Saint-Pierre : voir la mairie ou le distributeur d'eau.");
  });
});
