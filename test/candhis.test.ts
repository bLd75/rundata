import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import * as candhis from "../src/providers/candhis.js";

// The answers below take the shape of the examples of the API's documentation (Cerema, octobre 2024, § 4.1 and 4.7),
// headers broken over lines as printed there, with the island's campaigns in place of the documentation's.
const NOW = new Date("2026-10-27T10:40:30Z");
const KEY = "00000000-1111-2222-3333-444444444444";
const days = (n: number) => n * 86_400_000;

const liste = (kind: number, rows: string[][]) => ({
  apiVer: "1.00",
  success: "True",
  message: `Liste des campagnes TR ${candhis.KINDS[kind as candhis.Kind]}`,
  nbLig: rows.length,
  entete: ["Code\ncampagne", "Nom", "Actif", "Type données TR"],
  results: rows,
});
const H13 = {
  apiVer: "1.00",
  success: true,
  message: "Données TR directionnel H13 (+97405+,-97406-,+97408+)\\ 2026-10-27 10:00 ",
  nbLig: 2,
  entete: ["Campagne", "Date", "H1/3\n(m)", "Hmax\n(m)", "TH1/3\n(s)", "Dir. au pic (°)", "Etal. au pic (°)", "Temp. mer (°C)"],
  results: [
    ["97405", "2026-10-27 10:00", "2.0000", "3.2000", "6.3000", "187.0000", "20.0000", "24.4000"],
    ["97408", "2026-10-27 10:00", "1.1000", "1.9000", "11.6000", "260.0000", "19.0000", "999.9999"],
  ],
};
const HM0 = {
  apiVer: "1.00",
  success: true,
  message: "Données TR directionnel Hm0 (+97401+)\\ 2026-10-27 09:30 ",
  nbLig: 1,
  entete: ["Campagne", "Date", "Hm0 (m)", "Hmax (m)", "T02 (s)", "Dir. au pic (°)", "Temp. mer (°C)"],
  results: [["97401", "2026-10-27 09:30", "0.8000", "999.9999", "3.2000", "46.0000", "999.9999"]],
};
const NON_DIRECTIONNEL = {
  apiVer: "1.00",
  success: true,
  message: "Données TR non directionnel H13 (+97407+)\\ 2026-10-27 10:00 ",
  nbLig: 1,
  entete: ["Campagne", "Date", "H1/3 (m)", "Hmax (m)", "TH1/3 (s)", "T. au pic (s)", "Temp. mer (°C)"],
  results: [["97407", "2026-10-27 10:00", "2.2000", "3.5000", "11.0000", "16.7000", "999.9999"]],
};

let asked: { url: string; auth: string | null }[] = [];
let answer: (url: string) => Response;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The API as the documentation describes it: 97405 and 97408 directional H13, 97401 directional Hm0, the rest inactive. */
function api(url: string): Response {
  const u = new URL(url);
  const type = u.searchParams.get("type");
  if (u.pathname.endsWith("/getCampListe.php")) {
    if (type === "2") return json(liste(2, [["02911", "Les Pierres\nNoires", "1", "TR directionnel H13"], ["97405", "Saint-Pierre", "1", "TR directionnel H13"], ["97408", "Port Réunion Est", "1", "TR directionnel H13"], ["97406", "Sainte-Rose", "0", "TR directionnel H13"]]));
    if (type === "1") return json(liste(1, [["97401", "Baie de la Possession", "1", "TR directionnel Hm0"]]));
    return json({ apiVer: "1.00", success: false, message: "Aucune donnée", nbLig: 0, entete: null, results: null });
  }
  if (u.pathname.endsWith("/getCampListeTR.php")) return json(type === "2" ? H13 : HM0);
  throw new Error(`unexpected ${url}`);
}

beforeEach(() => {
  asked = [];
  answer = api;
  vi.stubGlobal("fetch", async (url: string, init?: { headers?: Record<string, string> }) => {
    asked.push({ url: String(url), auth: init?.headers?.Authorization ?? null });
    return answer(String(url));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  candhis.configure(undefined);
});

/** What the scheduled event does with KV: the state before, and every state written. */
function store(before: candhis.Etat | null = null) {
  const written: candhis.Etat[] = [];
  return { before, written, write: async (e: candhis.Etat) => void written.push(structuredClone(e)) };
}

describe("the Candhis buoys", () => {
  it("are asked every 30 minutes, at 10 and 40 past the hour", () => {
    const due = Array.from({ length: 12 }, (_, i) => i * 5).filter((m) => candhis.refreshDue(new Date(Date.UTC(2026, 9, 27, 8, m, 2))));
    expect(due).toEqual([10, 40]);
  });

  it("are not asked at all without the key: no request, nothing written", async () => {
    const s = store();
    expect(await candhis.refresh(s.before, s.write, NOW)).toBe("sans clé");
    expect(asked).toEqual([]);
    expect(s.written).toEqual([]);
    expect(candhis.configured()).toBe(false);
  });

  it("read the documentation's columns by their header, whatever the type of buoy, 999.9999 being no measurement", () => {
    expect(candhis.parseTR(H13)).toEqual([
      { code: "97405", t: Date.parse("2026-10-27T10:00:00Z"), hauteur: 2, hauteur_selon: "H1/3", hmax: 3.2, periode: 6.3, periode_selon: "TH1/3", periode_pic: null, direction: 187, etalement: 20, temperature: 24.4 },
      { code: "97408", t: Date.parse("2026-10-27T10:00:00Z"), hauteur: 1.1, hauteur_selon: "H1/3", hmax: 1.9, periode: 11.6, periode_selon: "TH1/3", periode_pic: null, direction: 260, etalement: 19, temperature: null },
    ]);
    expect(candhis.parseTR(HM0)[0]).toMatchObject({ code: "97401", hauteur: 0.8, hauteur_selon: "Hm0", hmax: null, periode: 3.2, periode_selon: "T02", direction: 46, etalement: null, temperature: null });
    expect(candhis.parseTR(NON_DIRECTIONNEL)[0]).toMatchObject({ code: "97407", hauteur: 2.2, periode: 11, periode_pic: 16.7, direction: null });
    // Not the island's, or no answer: nothing.
    expect(candhis.parseTR({ ...H13, results: [["02911", "2026-10-27 10:00", "1", "1", "1", "1", "1", "1"]] })).toEqual([]);
    expect(candhis.parseTR({ success: false, message: "Aucune donnée", entete: null, results: null })).toEqual([]);
  });

  it("say which campaigns asked sent data, from the answer's message", () => {
    expect(candhis.availability(H13.message)).toEqual({ avec: ["97405", "97408"], sans: ["97406"] });
    // As the documentation prints it, broken over two lines.
    expect(candhis.availability("Données TR directionnel H13 (+01704+,-02906-,-\n02911-,+05602+)\\ 2024-03-04 10:30 ")).toEqual({ avec: ["01704", "05602"], sans: ["02906", "02911"] });
  });

  it("the first time, list the island's active buoys by type, then ask each type once; the key only in the header", async () => {
    candhis.configure(KEY);
    const s = store();
    expect(await candhis.refresh(s.before, s.write, NOW)).toBe("3 bouées actives, 3 mesures nouvelles, 5 requêtes");
    expect(asked.map((a) => a.url)).toEqual([
      "https://candhis.cerema.fr/API/v1/getCampListe.php?type=0",
      "https://candhis.cerema.fr/API/v1/getCampListe.php?type=1",
      "https://candhis.cerema.fr/API/v1/getCampListe.php?type=2",
      "https://candhis.cerema.fr/API/v1/getCampListeTR.php?type=1&camp=97401",
      "https://candhis.cerema.fr/API/v1/getCampListeTR.php?type=2&camp=97405,97408",
    ]);
    expect(asked.every((a) => a.auth === KEY && !a.url.includes(KEY))).toBe(true);
    expect(s.written).toHaveLength(1);
    const e = s.written[0];
    expect(e.types).toEqual({ lu: NOW.getTime(), actives: { "97401": 1, "97405": 2, "97408": 2 } });
    expect(Object.keys(e.mesures).sort()).toEqual(["97401", "97405", "97408"]);
    expect(e).toMatchObject({ essai: NOW.getTime(), lu: NOW.getTime() });
    expect(e.echec).toBeUndefined();
  });

  it("then, one request per type each time; a buoy silent this half hour keeps its last measurement and its time", async () => {
    candhis.configure(KEY);
    const old: candhis.Mesure = { ...candhis.parseTR(H13)[1], t: Date.parse("2026-10-27T08:00:00Z") };
    const s = store({ essai: NOW.getTime() - 1800_000, lu: NOW.getTime() - 1800_000, types: { lu: NOW.getTime() - days(29), actives: { "97405": 2, "97408": 2 } }, mesures: { "97408": old } });
    answer = () => json({ ...H13, message: "Données TR directionnel H13 (+97405+,-97408-)\\ 2026-10-27 10:00 ", results: [H13.results[0]] });
    expect(await candhis.refresh(s.before, s.write, NOW)).toBe("2 bouées actives, 1 mesures nouvelles, 1 requêtes");
    expect(asked.map((a) => a.url)).toEqual(["https://candhis.cerema.fr/API/v1/getCampListeTR.php?type=2&camp=97405,97408"]);
    expect(s.written[0].mesures["97408"]).toEqual(old);
    expect(s.written[0].mesures["97405"].t).toBe(Date.parse("2026-10-27T10:00:00Z"));
  });

  it("list the active buoys again after 30 days", async () => {
    candhis.configure(KEY);
    const s = store({ essai: 0, types: { lu: NOW.getTime() - days(30), actives: { "97405": 2 } }, mesures: {} });
    await candhis.refresh(s.before, s.write, NOW);
    expect(asked.filter((a) => a.url.includes("getCampListe.php"))).toHaveLength(3);
  });

  it("stop for a while after a refusal (quota reached), writing why, and ask nothing until then", async () => {
    candhis.configure(KEY);
    answer = () => json({ apiVer: "1.00", success: false, message: "Quota requêtes quotidiennes atteint", nbLig: 0, entete: null, results: null }, 429);
    const s = store({ essai: 0, types: { lu: NOW.getTime(), actives: { "97405": 2 } }, mesures: {} });
    await expect(candhis.refresh(s.before, s.write, NOW)).rejects.toThrow("HTTP 429");
    expect(s.written[0]).toMatchObject({ echec: { at: NOW.getTime(), status: 429 }, pause_jusqu_a: NOW.getTime() + 3 * 3600_000 });
    asked = [];
    const later = store(s.written[0]);
    expect(await candhis.refresh(later.before, later.write, new Date(NOW.getTime() + 1800_000))).toMatch(/^en pause jusqu'à /);
    expect(asked).toEqual([]);
    expect(later.written).toEqual([]);
  });

  it("keep their last measurements when the site is down for maintenance, and try again at the next half hour", async () => {
    candhis.configure(KEY);
    answer = () => new Response("<html><title>DTecITM- Maintenance</title></html>", { status: 404 });
    const m = candhis.parseTR(H13)[0];
    const s = store({ essai: 0, lu: 1, types: { lu: NOW.getTime(), actives: { "97405": 2 } }, mesures: { "97405": m } });
    await expect(candhis.refresh(s.before, s.write, NOW)).rejects.toThrow("HTTP 404");
    expect(s.written[0]).toMatchObject({ essai: NOW.getTime(), lu: 1, mesures: { "97405": m }, echec: { status: 404 } });
    expect(s.written[0].pause_jusqu_a).toBeUndefined();
  });

  it("are read from what the scheduled event keeps, and from nothing else", async () => {
    const c = new Cache(new MemoryStore(), () => NOW.getTime());
    await expect(candhis.etat(c)).rejects.toThrow("état des bouées absent");
    const kept: candhis.Etat = { essai: 1, lu: 1, mesures: { "97405": candhis.parseTR(H13)[0] } };
    candhis.configure(KEY, async () => kept);
    expect((await candhis.etat(new Cache(new MemoryStore(), () => NOW.getTime()))).value).toEqual(kept);
    expect(asked).toEqual([]);
  });
});
