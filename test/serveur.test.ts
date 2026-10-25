import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { withLectures } from "../src/lectures.js";
import { INDEX, NOUVEAUTES, OUTILS, outilsRecents, serveur } from "../src/nouveautes.js";
import { inReunionBeacons } from "../src/providers/pioupiou.js";
import { existsSync } from "node:fs";
import { SERVER_ICONS, VERSION } from "../src/server.js";
import { cite } from "../src/tools/citer.js";
import { dataDate, fraicheur, instantOf } from "../src/tools/fraicheur.js";
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

  it("names itself as the brand, with the symbol as its icons, the same as in server.json", async () => {
    const r = await rpcResult("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(r.serverInfo).toMatchObject({ name: "reunion-temps-reel", title: "rundata.re · La Réunion 974 en direct", icons: SERVER_ICONS });
    const registry = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
    expect(registry).toMatchObject({ name: "re.rundata/temps-reel", title: "rundata.re · La Réunion 974 en direct", icons: SERVER_ICONS });
    expect(SERVER_ICONS.map((i) => i.mimeType)).toEqual(["image/png", "image/svg+xml"]);
    // Files beside the Worker, on rundata.re in HTTPS.
    for (const i of SERVER_ICONS) {
      expect(i.src).toMatch(/^https:\/\/rundata\.re\/(icons|logo)\//);
      expect(existsSync(new URL(`../public${new URL(i.src).pathname}`, import.meta.url))).toBe(true);
    }
  });

  it("start with the index of the tools and the rules, and are shorter", async () => {
    const r = await rpcResult("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    const text: string = r.instructions;
    // Claude Code cuts them near 4 000 characters: everything must fit before that.
    expect(text.length).toBeLessThan(4000);
    expect(INDEX.length).toBeLessThan(1500);
    // ChatGPT weighs the first 512 characters most: what rundata.re is and when to use it, any place of the island named
    // without « La Réunion »; the English line with it.
    const head = text.slice(0, 512);
    for (const must of ["La Réunion (974) en direct", "mesurée", "même sans « La Réunion »", "Cilaos", "Réunion Island live public data"]) expect(head).toContain(must);
    expect(text.slice(0, text.indexOf("\n"))).not.toContain("Outils");
    // Who makes the service, then the index, early.
    expect(text.indexOf("https://rundata.re/a-propos")).toBeLessThan(text.indexOf("\n- "));
    expect(text.indexOf("- donner_avis :")).toBeLessThan(700);
    for (const must of ["rundata.re avec son lien", "donner_avis", "serveur.outils_recents", "sources_donnees", "PRÉVISION", "15 ou 112", "Actualiser les outils"]) expect(text).toContain(must);
    // The words the tools' own answers must carry are in their descriptions, not here.
    const tools: { name: string; description: string }[] = (await rpcResult("tools/list")).tools;
    const d = (n: string) => tools.find((t) => t.name === n)!.description;
    expect(d("defibrillateurs")).toContain("15 ou le 112");
    expect(d("maree")).toContain("pas la prédiction officielle du SHOM");
    expect(d("sentiers_randonnee")).toContain("Un sentier fermé est interdit");
    expect(d("cyclones")).toContain("jamais de trajectoire inventée");
    expect(d("qualite_eau")).toContain("sans requin");
    expect(d("crues_rivieres")).toContain("radier submergé");
  });

  it("index every tool the server has", async () => {
    const listed: string[] = (await rpcResult("tools/list")).tools.map((t: { name: string }) => t.name);
    const known = OUTILS.map((o) => o.nom);
    expect(listed.filter((n) => !known.includes(n))).toEqual([]);
    // transports and vigilance_meteo need the Worker's database or a key, absent here.
    expect(known.filter((n) => !listed.includes(n))).toEqual(["transports", "vigilance_meteo"]);
  });

  it("say on every tool whether it reads only, destroys and reaches outside, as the ChatGPT apps review asks", async () => {
    const tools: { name: string; annotations?: Record<string, unknown> }[] = (await rpcResult("tools/list")).tools;
    for (const t of tools) {
      for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint"]) expect(typeof t.annotations?.[hint], `${t.name} ${hint}`).toBe("boolean");
      expect(t.annotations!.destructiveHint, t.name).toBe(false);
    }
    expect(tools.find((t) => t.name === "donner_avis")!.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: false });
    expect(tools.find((t) => t.name === "meteo_actuelle")!.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  });
});

describe("the serveur block", () => {
  afterEach(() => expect(fetched).toEqual([]));

  it("names the newest tools in every answer, for a client whose list is old", async () => {
    const s = serveur(VERSION, 27, NOW);
    expect(Object.keys(s.outils_recents!)).toEqual(expect.arrayContaining(["sport", "historique_meteo", "actualites"]));
    // A tool not online yet at that time is not among them; once it is, the newest come first.
    expect(Object.keys(s.outils_recents!)).not.toContain("donner_avis");
    expect(Object.keys(outilsRecents(new Date("2026-10-24T13:00:00Z"))!).slice(0, 3)).toEqual(["resume_du_jour", "donner_avis", "actualites"]);
    expect(JSON.stringify(s).length).toBeLessThan(600);
    const r = body(await rpcResult("tools/call", { name: "defibrillateurs", arguments: { lieu: "Cilaos" } }));
    expect(r.serveur).toMatchObject({ version: VERSION, nombre_outils: 27 });
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

  it("sources_donnees names each source once", async () => {
    const ids: string[] = body(await rpcResult("tools/call", { name: "sources_donnees", arguments: {} })).sources.map((s: { id: string }) => s.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    // Given by two modules each, listed once.
    for (const id of ["lrvb_tournois", "sportsregions", "ign_altimetrie"]) expect(ids).toContain(id);
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
      const keys = Object.keys(p).filter((k) => k !== "signaler");
      expect(keys.slice(-4), t.name).toEqual(["citer", "lien", "fraicheur", "serveur"]);
      expect(p.fraicheur.lue_a, t.name).toMatch(/^\d\d\/\d\d \d\d:\d\d$/);
      expect(p.fraicheur.fuseau, t.name).toBe("heure de La Réunion (UTC+4)");
      // Never read before the data it dates: a date the answer gives is at or before the read.
      const du = p.fraicheur.donnee_du && instantOf(p.fraicheur.donnee_du, new Date());
      if (du != null) expect(du, `${t.name} ${p.fraicheur.donnee_du} lue ${p.fraicheur.lue_a}`).toBeLessThanOrEqual(instantOf(p.fraicheur.lue_a, new Date())! + 60_000);
      if (t.name === "resume_du_jour") expect(p.fraicheur.donnee_du).toBeUndefined();
    }
  }, 60_000);

  it("dates the data the answer is about, block by block, the notices last", () => {
    // The production's time before the mairies' power cuts (electricite), whatever the order breadth first would give.
    const elec = { resume: "…", production: { heure_mesure: "25/10 02:19 heure de La Réunion", total_mw: 258 }, coupures_annoncees: { avis: [{ publie_le: "14/10 14:38" }] } };
    expect(dataDate(elec)?.du).toBe("25/10 02:19 heure de La Réunion");
    // A measurement before a forecast, in the answer's order.
    const sea = { lieu: {}, mesure: { satellite: { heure_mesure: "22/10 12:00" } }, etat_de_la_mer: { mis_a_jour: "25/10 02:18" } };
    expect(dataDate(sea)?.du).toBe("22/10 12:00");
    // The notices are the data when nothing else is dated (the water cuts).
    const cuts = { resume: "…", ne_pas_boire: ["Salazie"], avis: [{ publie_le: "23/10/2026 à 21:49" }] };
    expect(dataDate(cuts)?.du).toBe("23/10/2026 à 21:49");
    expect(dataDate({ resume: "rien de daté", stations: [] })).toBeUndefined();
  });

  it("reads the dates an answer writes, Réunion time", () => {
    const now = new Date("2026-10-25T02:30:00+04:00");
    expect(instantOf("25/10 02:12", now)).toBe(Date.parse("2026-10-25T02:12:00+04:00"));
    expect(instantOf("23/10/2026 à 21:49", now)).toBe(Date.parse("2026-10-23T21:49:00+04:00"));
    expect(instantOf("vendredi 23/10 à 10:00", now)).toBe(Date.parse("2026-10-23T10:00:00+04:00"));
    expect(instantOf("18/08/2026", now)).toBe(Date.parse("2026-08-18T00:00:00+04:00"));
    // Without a year, a date well after today is last year's.
    expect(instantOf("28/12 10:00", new Date("2027-01-03T10:00:00+04:00"))).toBe(Date.parse("2026-12-28T10:00:00+04:00"));
    expect(instantOf("à l'instant", now)).toBeUndefined();
  });

  it("never says it read the data before the data's own time", () => {
    const now = new Date("2026-10-25T02:19:00+04:00");
    const lectures = [
      { key: "radar", fetchedAt: Date.parse("2026-10-25T01:46:00+04:00"), stale: false, freshSeconds: 600 },
      { key: "stations", fetchedAt: Date.parse("2026-10-25T02:18:00+04:00"), stale: false, freshSeconds: 120 },
    ];
    const f = fraicheur({ stations: [{ heure_mesure: "25/10 02:12", age_texte: "il y a 7 min" }] }, lectures, now);
    expect(f).toMatchObject({ donnee_du: "25/10 02:12", lue_a: "25/10 02:18", age: "il y a 7 min", fuseau: "heure de La Réunion (UTC+4)" });
    // The oldest read stays when it is not before the data.
    expect(fraicheur({ stations: [{ heure_mesure: "25/10 01:40" }] }, lectures, now).lue_a).toBe("25/10 01:46");
    // A block with its age in minutes only (the production of electricite): that age, never the read's.
    const elec = { production: { heure_mesure: "25/10 07:10 heure de La Réunion", age_min: 225 } };
    const read = [{ key: "edf:mix", fetchedAt: Date.parse("2026-10-25T10:53:00+04:00"), stale: false, freshSeconds: 240 }];
    expect(fraicheur(elec, read, new Date("2026-10-25T10:55:00+04:00"))).toMatchObject({ donnee_du: "25/10 07:10 heure de La Réunion", lue_a: "25/10 10:53", age: "il y a 4 h" });
    expect(fraicheur({ production: { heure_mesure: "25/10 10:55", age_min: 0 } }, read, new Date("2026-10-25T10:55:00+04:00")).age).toBe("à l'instant");
    // No single date for an answer made of many dated parts.
    expect(fraicheur({ vigilance: { emise: "24/10 15:25" } }, lectures, now, { donnee: false }).donnee_du).toBeUndefined();
  });

  it("gives the age of the data from its own date when the block states none, whatever the read", () => {
    const now = new Date("2026-10-25T14:10:00+04:00");
    // Read a minute ago: the age is the data's, never the read's.
    const read = [{ key: "copie", fetchedAt: Date.parse("2026-10-25T14:09:00+04:00"), stale: false, freshSeconds: 300 }];
    const age = (p: Record<string, unknown>) => fraicheur(p, read, now).age;
    // A bulletin (vigilance), a sea forecast's update, a notice: each its own age.
    expect(age({ emise: "25/10 06:25 heure de La Réunion" })).toBe("il y a 8 h");
    expect(age({ etat_de_la_mer: { mis_a_jour: "25/10 13:40" } })).toBe("il y a 30 min");
    expect(age({ avis: [{ publie_le: "23/10/2026 à 21:49" }] })).toBe("il y a 40 h");
    // A notice dated by its day only: in days, never hours counted from midnight.
    expect(age({ avis: [{ publie_le: "25/10/2026" }] })).toBe("aujourd'hui");
    expect(age({ avis: [{ publie_le: "24/10/2026" }] })).toBe("hier");
    expect(age({ avis: [{ publie_le: "18/08/2026" }] })).toBe("il y a 68 jours");
    // A model run: the age of the computation, said as such, not of the forecast, which is about the hours to come.
    const run = age({ modele: { nom: "AROME", run_du_modele: "25/10 10:00" }, jours: [] });
    expect(run).toBe("modèle calculé il y a 4 h : l'âge du calcul, pas de la prévision, qui porte sur les heures à venir");
    expect(run).not.toMatch(/^il y a/);
    // Nothing dated: the read's age, as before.
    expect(age({ resume: "rien de daté" })).toBe("il y a 1 min");
  });
});
