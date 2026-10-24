import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { withLectures } from "../src/lectures.js";
import { INDEX, NOUVEAUTES, OUTILS, outilsRecents, serveur } from "../src/nouveautes.js";
import { inReunionBeacons } from "../src/providers/pioupiou.js";
import { VERSION } from "../src/server.js";
import { cite } from "../src/tools/citer.js";
import { meteoActuelle } from "../src/tools/meteo.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T09:20:00Z");
// The weather fixtures' own time (tools.test.ts).
const FIX = new Date("2026-10-18T19:20:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

const rpc = (method: string, params: unknown) =>
  new Request("https://rundata.re/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
const rpcResult = async (method: string, params: unknown = {}) => (await (await handle(rpc(method, params), new Cache())).json()).result;

/** The weather stations' recorded answers, read at `at`; `now` may be later, to make them old. */
async function weatherCache(at: number, now = at) {
  const store = new MemoryStore();
  const beacons = inReunionBeacons(JSON.parse(fixture("pioupiou_all.json")).data);
  const date = new Date(at - 4 * 60_000).toISOString();
  await store.put("metar", { value: JSON.parse(fixture("metar.json")), fetchedAt: at });
  await store.put("pioupiou:all", { value: beacons, fetchedAt: at });
  await store.put("pioupiou:live", { value: beacons.map((b) => ({ ...b, measurements: { ...b.measurements, date } })), fetchedAt: at });
  return new Cache(store, () => now);
}

// No test here goes on the network: every call to fetch fails at once and is noted, and the tests that expect none check it.
let fetched: string[] = [];
beforeEach(() => {
  fetched = [];
  vi.stubGlobal("fetch", async (url: unknown) => {
    fetched.push(String(url));
    throw new Error("offline (test)");
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the server's instructions", () => {
  afterEach(() => expect(fetched).toEqual([]));

  it("start with the index of the tools and the rules, and are shorter", async () => {
    const r = await rpcResult("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    const text: string = r.instructions;
    expect(text.length).toBeLessThan(6000);
    expect(INDEX.length).toBeLessThan(1500);
    expect(text.indexOf("- donner_avis :")).toBeLessThan(200);
    // What a client cutting them near 4 000 characters still reads.
    const head = text.slice(0, 3800);
    for (const must of ["rundata.re avec son lien", "donner_avis", "serveur.outils_recents", "sources_donnees", "PRÉVISION"]) expect(head).toContain(must);
  });

  it("index every tool the server has", async () => {
    const listed: string[] = (await rpcResult("tools/list")).tools.map((t: { name: string }) => t.name);
    const known = OUTILS.map((o) => o.nom);
    expect(listed.filter((n) => !known.includes(n))).toEqual([]);
    // transports and vigilance_meteo need the Worker's database or a key, absent here.
    expect(known.filter((n) => !listed.includes(n))).toEqual(["transports", "vigilance_meteo"]);
  });
});

describe("the serveur block", () => {
  afterEach(() => expect(fetched).toEqual([]));

  it("names the newest tools in every answer, for a client whose list is old", async () => {
    const s = serveur(VERSION, 27, NOW);
    expect(Object.keys(s.outils_recents!)).toEqual(expect.arrayContaining(["sport", "historique_meteo", "actualites", "donner_avis"]));
    expect(JSON.stringify(s).length).toBeLessThan(600);
    const r = body(await rpcResult("tools/call", { name: "defibrillateurs", arguments: { lieu: "Cilaos" } }));
    expect(r.serveur).toMatchObject({ version: VERSION, nombre_outils: 25 });
    expect(r.serveur.si_outil_absent).toMatch(/ancienne/);
  });

  it("drops tools older than a week", () => {
    expect(outilsRecents(new Date("2026-11-05T00:00:00Z"))).toBeUndefined();
  });

  it("sources_donnees lists every tool and the latest changes, dated", async () => {
    const r = body(await rpcResult("tools/call", { name: "sources_donnees", arguments: {} }));
    expect(Object.keys(r.outils)).toEqual(OUTILS.map((o) => o.nom));
    expect(r.nouveautes).toHaveLength(10);
    expect(r.nouveautes[0].texte).toBe(NOUVEAUTES[0].texte);
    expect(r.nouveautes[0].date).toMatch(/^\d\d\/\d\d \d\d:\d\d$/);
    expect(r.toutes_les_nouveautes).toBe("https://rundata.re/nouveautes");
  });
});

describe("fraicheur", () => {
  it("says when the station measured, when rundata.re read it, and how old it is", async () => {
    // Read a minute ago: fresh for every source meteo_actuelle asks (the beacons' live copy lasts two minutes).
    const at = FIX.getTime() - 60_000;
    const cache = await weatherCache(at, FIX.getTime());
    const { value, lectures } = await withLectures(() => meteoActuelle(cache, "Saint-Pierre", FIX));
    const p = body(cite("meteo_actuelle", value, { lectures, now: FIX }));
    const f = p.fraicheur;
    expect(f.donnee_du).toBe(p.stations[0].heure_mesure);
    expect(f.age).toBe(p.stations[0].age_texte);
    expect(f.lue_a).toBe("18/10 23:19");
    expect(f.copie_de_secours).toBeUndefined();
    expect(fetched).toEqual([]);
  });

  it("says when a source did not answer and its last copy was served", async () => {
    const at = FIX.getTime() - 3 * 3600_000;
    const cache = await weatherCache(at, FIX.getTime());
    const { value, lectures } = await withLectures(() => meteoActuelle(cache, "Saint-Pierre", FIX));
    const f = body(cite("meteo_actuelle", value, { lectures, now: FIX })).fraicheur;
    expect(f.copie_de_secours).toBe(true);
    expect(f.avertissement).toBe("Source injoignable : dernière valeur connue, lue le 18/10 20:20.");
  });

  it("is in the answer of every tool, next to the citation, errors included", async () => {
    const tools: { name: string; inputSchema: { required?: string[] } }[] = (await rpcResult("tools/list")).tools;
    const args: Record<string, Record<string, unknown>> = {
      annuaire_services_publics: { quoi: "mairie", lieu: "Saint-Paul" },
      fiche_terrain: { adresse: "Tombouctou" },
      donner_avis: { type: "bravo", message: "merci" },
    };
    for (const t of tools.filter((t) => t.name !== "donner_avis")) {
      const r = await rpcResult("tools/call", { name: t.name, arguments: args[t.name] ?? { lieu: "Saint-Paul" } });
      const p = JSON.parse(r.content[0].text);
      const keys = Object.keys(p).filter((k) => k !== "avis");
      expect(keys.slice(-4), t.name).toEqual(["citer", "lien", "fraicheur", "serveur"]);
      expect(p.fraicheur.lue_a, t.name).toMatch(/^\d\d\/\d\d \d\d:\d\d$/);
    }
  }, 60_000);
});
