import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parseVigilance, STATIONS, type Vigilance } from "../src/providers/vigicrues.js";
import { crues, riverAsked, vigilanceText } from "../src/tools/crues.js";

// Vigicrues Réunion on 23/10/2026 at 23:45 UTC (03:45 in La Réunion): no flood vigilance, the ravine des Cabris
// rising a few centimetres from dry.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-23T23:52:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());

describe("Vigicrues Réunion", () => {
  const asked: string[] = [];
  beforeEach(() => {
    asked.length = 0;
    // The site is a form posted: answer from the recordings, by page and measure.
    vi.stubGlobal("fetch", async (url: string, init?: { body?: URLSearchParams }) => {
      const form = init?.body ?? new URLSearchParams();
      asked.push(`${url.split("/").pop()} ${form.get("mesure") ?? ""} ${Object.keys(JSON.parse(form.get("liste") ?? "{}")).length}`);
      const file = url.endsWith("vigilance.php") ? "vigicrues_vigilance.json" : `vigicrues_${form.get("mesure")}.json`;
      return new Response(fixture(file), { headers: { "content-type": "application/json" } });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the vigilance, its times in La Réunion's clock", () => {
    const v = parseVigilance(JSON.parse(fixture("vigicrues_vigilance.json")));
    expect(v.active).toBe(false);
    expect(v.date).toBe("2026-08-07T02:22:04.000Z");
    expect(v.rivieres).toHaveLength(21);
    expect(v.rivieres.every((r) => r.couleur === "vert")).toBe(true);
  });

  it("keeps only the text of a bulletin, even with broken tags", () => {
    const v = parseVigilance([[true, 1, "2026-10-24 06:00:00", "Pluies<br>faibles <b>partout</b>", "<scr<script>ipt>x</script> rien > à <signaler"], ["Rivière des Galets", 0, 0, "ce-1"]]);
    expect(v.observations).toBe("Pluies faibles partout");
    expect(v.anticipation).not.toMatch(/[<>]/);
  });

  it("knows a river by its name, and a town is not a river", () => {
    expect(riverAsked("la rivière des Galets est en crue ?").map((s) => s.id).sort()).toEqual(["L05", "L06"]);
    expect(riverAsked("rivière Saint-Denis").map((s) => s.id)).toEqual(["L24"]);
    expect(riverAsked("Saint-Denis")).toEqual([]);
  });

  it("sums up the island: the levels measured and their time first, then the vigilance and why no bulletin is out", async () => {
    const r = body(await crues(cache(), undefined, NOW));
    expect(r.resume).toMatch(/^En hausse sur la dernière demi-heure : Cabris - RN3 \(ravine des Cabris, Saint-Pierre\) : 0,06 m, en hausse.* \(mesures de 03:45\)\. Pas de vigilance crues en cours/);
    // The last bulletin is the end of the last episode, never the levels' date: Vigicrues Réunion publishes in vigilance only.
    expect(r.resume).toMatch(/Pas de vigilance crues en cours : toutes les rivières suivies sont au vert\. Aucun bulletin de vigilance depuis le 07\/08 à 06:22 : Vigicrues Réunion n'en publie que lorsqu'au moins une rivière est en vigilance jaune ou plus\.$/);
    expect(r.resume).not.toMatch(/dernier bulletin/);
    expect(r.vigilance_crues).toEqual({ active: false, aucun_bulletin_depuis: "07/08 à 06:22", pourquoi: expect.stringMatching(/^Vigicrues Réunion n'en publie que/), rivieres: expect.any(Array) });
    expect(r.vigilance_crues).not.toHaveProperty("date");
    expect(r.stations).toHaveLength(STATIONS.length);
  });

  it("asks only for the gauges near the place", async () => {
    const r = body(await crues(cache(), "Saint-Gilles", NOW));
    expect(r.stations[0]).toMatchObject({ station: "Saint-Gilles - RN1a", riviere: "ravine Saint-Gilles", hauteur_m: 0.177, tendance_30_min: "stable" });
    expect(r.stations[0].distance_km).toBeLessThan(2);
    expect(r.resume).toMatch(/^Rivières suivies près de Saint-Gilles-les-Bains, mesures de 03:45 : Saint-Gilles - RN1a/);
    expect(r.resume).toMatch(/Pour repère, la plus petite crue de référence à Saint-Gilles - RN1a : 0,7 m/);
    expect(asked.filter((a) => a.startsWith("valeurs.php")).every((a) => Number(a.split(" ")[2]) <= 4)).toBe(true);
    expect(r.consignes).toMatch(/radier/);
  });

  it("gives a river's levels with their time, before the vigilance", async () => {
    const r = body(await crues(cache(), "la rivière des Galets", NOW));
    expect(r.resume).toMatch(/^[^.]*rivière des Galets[^.]* \(mesures de \d\d:\d\d\)\. .*Pas de vigilance crues en cours : toutes les rivières suivies sont au vert\. Aucun bulletin de vigilance depuis le 07\/08 à 06:22/);
  });

  it("says a vigilance in force first, before the levels, for the island, a river and a place", async () => {
    // The recorded answer with an orange vigilance on the rivière des Galets.
    const orange = JSON.parse(fixture("vigicrues_vigilance.json"));
    orange[0] = [true, 3, "2026-10-24 03:30:00", "Fortes pluies sur l'ouest.", "", "", "", 0];
    orange.find((r: unknown[]) => r[0] === "rivière des Galets")[1] = 3;
    vi.stubGlobal("fetch", async (url: string, init?: { body?: URLSearchParams }) =>
      new Response(url.endsWith("vigilance.php") ? JSON.stringify(orange) : fixture(`vigicrues_${init?.body?.get("mesure")}.json`), { headers: { "content-type": "application/json" } }));
    for (const lieu of [undefined, "la rivière des Galets", "Saint-Gilles"]) {
      const r = body(await crues(cache(), lieu, NOW));
      expect(r.resume, String(lieu)).toMatch(/^Vigilance crues en cours \(bulletin n° 3 du 24\/10 à 03:30\) : orange pour rivière des Galets\. Observations : Fortes pluies sur l'ouest\. \S/);
      expect(r.resume, String(lieu)).toMatch(/mesures de \d\d:\d\d/);
    }
  });

  it("says first that the vigilance could not be read", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: { body?: URLSearchParams }) => {
      if (url.endsWith("vigilance.php")) throw new TypeError("fetch failed");
      return new Response(fixture(`vigicrues_${init?.body?.get("mesure")}.json`), { headers: { "content-type": "application/json" } });
    });
    const r = body(await crues(cache(), undefined, NOW));
    expect(r.resume).toMatch(/^La vigilance crues n'a pas pu être lue\. En hausse sur la dernière demi-heure/);
    expect(r.indisponible).toBe("vigilance");
  });

  it("names the rivers under vigilance, the worst first", () => {
    const v: Vigilance = {
      active: true, bulletin: 12, date: "2026-02-03T08:00:00.000Z", observations: "Fortes pluies sur l'est.", anticipation: "",
      rivieres: [
        { nom: "rivière du Mât", couleur: "jaune", precedente: "vert" },
        { nom: "rivière des Roches", couleur: "orange", precedente: "jaune" },
        { nom: "rivière des Galets", couleur: "vert", precedente: "vert" },
      ],
    };
    expect(vigilanceText(v)).toBe("Vigilance crues en cours (bulletin n° 12 du 03/02 à 12:00) : orange pour rivière des Roches\u00a0; jaune pour rivière du Mât. Observations : Fortes pluies sur l'est.");
  });
});
