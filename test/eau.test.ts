import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parsePage, quality, season } from "../src/providers/baignades.js";
import { networkName } from "../src/providers/eaupotable.js";
import { qualiteEau, siteNamed, sujetOf } from "../src/tools/eau.js";

// Hub'Eau for Saint-Pierre and the ministry's page of the plage de l'Hermitage centre, read on 24/10/2026: the latest
// analyses date from late August (tap) and mid-September (bathing).
const fixture = (f: string, enc: BufferEncoding = "utf8") => readFileSync(new URL(`./fixtures/eau/${f}`, import.meta.url), enc);
const NOW = new Date("2026-10-24T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());

describe("qualité de l'eau", () => {
  const asked: string[] = [];
  beforeEach(() => {
    asked.length = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      const u = new URL(url);
      const p = u.searchParams;
      if (u.hostname === "baignades.sante.gouv.fr") {
        if (p.get("site") !== "974000709") return new Response("", { status: 404 });
        return new Response(fixture(`baignade_974000709_${p.get("annee")}.html`, "latin1"), { headers: { "content-type": "text/html; charset=ISO-8859-1" } });
      }
      if (p.get("code_commune") !== "97416") return new Response(JSON.stringify({ count: 0, data: [] }));
      const file = u.pathname.endsWith("communes_udi") ? "udi_97416.json"
        : p.get("code_parametre") === "1449" ? "ecoli_97416.json"
        : p.has("conformite_limites_bact_prelevement") ? "nc_bact_97416.json" : "nc_pc_97416.json";
      return new Response(fixture(file), { headers: { "content-type": "application/json" } });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads a season of bathing samples, five to a table", () => {
    const p = parsePage(fixture("baignade_974000709_2026.html", "latin1"));
    expect(p.classement).toEqual({ saison: 2026, texte: "site non classé" });
    expect(p.samples).toHaveLength(34);
    expect(p.samples.find((s) => s.date === "2026-01-20")).toEqual({ date: "2026-01-20", enterocoques: "4000", e_coli: "2500", qualite: "mauvaise" });
    expect(p.samples.at(-1)).toMatchObject({ date: "2026-09-15", enterocoques: "15", e_coli: "<15", qualite: "bonne" });
  });

  it("grades a sample by the ministry's thresholds, and names the season by the year it ends", () => {
    expect(quality("<15", "30")).toBe("bonne");
    expect(quality("290", "130")).toBe("moyenne");
    expect(quality("15", "1200")).toBe("mauvaise");
    expect(season(NOW)).toBe(2027);
    expect(season(new Date("2026-09-30T12:00:00Z"))).toBe(2026);
  });

  it("answers for a beach with its latest samples, both seasons read", async () => {
    const b = body(await qualiteEau(cache(), "plage de l'Hermitage", undefined, NOW));
    expect(b.eau_du_robinet).toBeUndefined();
    expect(b.baignade.sites[0]).toMatchObject({ site: "Plage de l'Hermitage centre", dernier_prelevement: "15/09/2026", qualite_dernier_prelevement: "bonne" });
    expect(b.baignade.sites[0].derniers_prelevements[1]).toEqual({ date: "08/09/2026", qualite: "moyenne", enterocoques_100ml: "290", e_coli_100ml: "130" });
    expect(b.a_savoir.baignade_en_mer).toMatch(/lagon/);
    expect(asked.filter((u) => u.includes("baignades")).map((u) => new URL(u).searchParams.get("annee"))).toEqual(["2027", "2026"]);
  });

  it("finds the network of the quartier asked, and what went off the limits", async () => {
    const b = body(await qualiteEau(cache(), "Ravine des Cabris", undefined, NOW));
    expect(b.resume).toBe("Eau du robinet, réseau Usine Dassy Conde à La Ravine des Cabris : dernière analyse le 24/08/2026 : NON CONFORME ; 6 analyses non conformes sur 16 en 6 mois.");
    expect(b.eau_du_robinet.reseau.non_conformites[0]).toEqual({
      date: "24/08/2026",
      prelevements: 3,
      depassements: ["Entérocoques : 4 pour 100 mL (limite ≤ 0 pour 100 mL)", "Entérocoques : 9 pour 100 mL (limite ≤ 0 pour 100 mL)", "Entérocoques : 2 pour 100 mL (limite ≤ 0 pour 100 mL)"],
    });
    // Asked about neither, and no bathing site within 5 km: no bathing part.
    expect(b.baignade).toBeUndefined();
  });

  it("lists a commune's networks, those with a problem first", async () => {
    const b = body(await qualiteEau(cache(), "eau du robinet à Saint-Pierre", undefined, NOW));
    expect(b.eau_du_robinet.reseaux).toHaveLength(13);
    expect(b.eau_du_robinet.reseaux[0]).toMatchObject({ reseau: "Usine Dassy Conde", non_conformes_6_mois: 6 });
    expect(b.resume).toMatch(/^Eau du robinet à Saint-Pierre : 13 réseaux, 75 analyses en 6 mois ; non-conformités sur Usine Dassy Conde \(6\)\./);
  });

  it("tells which water a question is about", () => {
    expect(sujetOf("l'eau est potable à Cilaos ?", null)).toEqual(["robinet"]);
    expect(sujetOf("on peut se baigner à Boucan ?", null)).toEqual(["baignade"]);
    expect(sujetOf("Saint-Leu", null)).toEqual(["robinet", "baignade"]);
    expect(siteNamed("bassin Bleu")?.commune).toBe("Saint-Benoît");
    expect(networkName("RESEAU ILET A CORDES")).toBe("Ilet à Cordes");
    expect(networkName("RESEAU MARE A POULE D'EAU")).toBe("Mare à Poule D'Eau");
  });
});
