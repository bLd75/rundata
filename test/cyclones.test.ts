import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { advisoryTime, parseList, parseTimeline, seasonOf, systemName } from "../src/providers/cyclones.js";
import { cyclones } from "../src/tools/cyclones.js";
import { alertePage } from "../src/web/alerte-cyclone.js";
import type { CyclonesAnswer } from "../src/web/data.js";
import { cyclonesPage } from "../src/web/domains.js";
import { CYCLONE_SCALE, vigilancePage } from "../src/web/pages.js";
import { ecolesPage } from "../src/web/ecoles.js";

// GDACS on 24/10/2026: no system in the basin since the end of the 2025-2026 season (Indusa, April). The timeline is
// FYTIA's as of the RSMC's advisory 20 (3 February 2026, 06:00 UTC): a moderate tropical storm.
// Only the names, the dates and the stages are kept: no track, position, distance, wind or forecast of ours, which
// Météo-France's official site gives.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/cyclones/${f}`, import.meta.url));
const OCTOBER = new Date("2026-10-24T06:00:00Z");
const FYTIA = new Date("2026-02-03T08:00:00Z");
const OFFICIEL = "Consulter le site officiel de Météo-France : https://meteofrance.re/fr/cyclone";
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = (now: Date) => new Cache(new MemoryStore(), () => now.getTime());

function file(url: string): string | undefined {
  if (url.includes("geteventlist")) return url.includes("pagenumber=2") ? "liste_page2.json" : "liste_page1.json";
  if (url.includes("getepisodedata") && url.includes("eventid=1001254")) return "episode_fytia.json";
  if (url.includes("gettimeline?id=732239")) return "timeline_fytia.json";
}

describe("cyclones", () => {
  let calls: string[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal("fetch", async (url: string | Request) => {
      const u = typeof url === "string" ? url : url.url;
      calls.push(u);
      const f = file(u);
      return f ? new Response(fixture(f)) : new Response("", { status: 503 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads GDACS's names and times as the RSMC gives them", () => {
    expect(systemName("FYTIA-26")).toBe("Fytia");
    expect(systemName("12-20252026-26")).toBe("système n° 12 (non baptisé)");
    expect(advisoryTime("03 Feb 2026 06:00")).toBe("2026-02-03T06:00:00.000Z");
    expect(seasonOf(OCTOBER)).toEqual({ nom: "2026-2027", debut: "2026-07-01T00:00:00.000Z" });
    expect(seasonOf(FYTIA).nom).toBe("2025-2026");
  });

  it("keeps the systems of the south-west Indian Ocean only, with no wind", () => {
    const list = parseList(JSON.parse(fixture("liste_page1.json").toString()));
    expect(list.map((s) => s.nom)).toEqual(expect.arrayContaining(["Fytia", "Gezani", "Indusa", "Horacio", "Dudzai"]));
    expect(list.find((s) => s.nom === "Champi")).toBeUndefined();
    const fytia = list.find((s) => s.nom === "Fytia")!;
    expect(fytia).toMatchObject({ centre: "CMRS de La Réunion", fin: "2026-02-04T06:00:00.000Z" });
    expect(fytia).not.toHaveProperty("vent_max_kmh");
  });

  it("keeps of a timeline only the last advisory issued and its stage, never the forecast", () => {
    expect(parseTimeline(JSON.parse(fixture("timeline_fytia.json").toString()))).toEqual({ heure: "2026-02-03T06:00:00.000Z", stade: "tempête tropicale modérée" });
    expect(parseTimeline({ channel: { item: [] } })).toBeUndefined();
  });

  it("names an active system and its stage as the RSMC's last advisory gives them, and nothing computed", async () => {
    const r = body(await cyclones(cache(FYTIA), undefined, FYTIA));
    expect(r.systemes_actifs).toEqual([{
      nom: "Fytia",
      stade: "tempête tropicale modérée",
      dernier_avis: "03/02 à 10:00 (heure de La Réunion)",
      centre: "CMRS de La Réunion",
      rapport: expect.stringContaining("gdacs.org"),
    }]);
    expect(r.resume).toContain("1 système tropical actif dans le sud-ouest de l'océan Indien. Fytia : tempête tropicale modérée, d'après l'avis du CMRS du 03/02 à 10:00.");
    // Météo-France's words last, with its address and no full stop after it.
    expect(r.resume.endsWith(OFFICIEL)).toBe(true);
    expect(r.officiel).toBe(OFFICIEL);
    const text = JSON.stringify(r);
    for (const gone of ["km/h", "distance", "situation", "deplacement", "prevision", "au_plus_pres", "s_eloigne", "pression", "trajectoire", "lat", "lon"]) expect(text, gone).not.toContain(`"${gone}`);
    expect(r.resume).not.toMatch(/\bkm\b|éloigne|plus près/);
    expect(r.a_savoir).toBe("Nom, stade et heure du dernier avis de chaque système, d'après le CMRS de La Réunion (Météo-France), le centre chargé des cyclones du sud-ouest de l'océan Indien, repris par GDACS toutes les 6 heures : ils peuvent avoir quelques heures de retard. Trajectoire et bulletins officiels : consulter le site officiel de Météo-France. Pour savoir quoi faire, seules comptent l'alerte cyclonique de la préfecture et les bulletins de Météo-France.");
    expect(r.saison_precedente).toBeUndefined();
    // The list (two pages towards July 2024), then the episode and its timeline: 4 requests.
    expect(calls.filter((u) => u.includes("geteventlist"))).toHaveLength(2);
    expect(calls).toHaveLength(4);
  });

  it("gives the same answer with a place, still accepted from the clients that send one", async () => {
    const without = body(await cyclones(cache(FYTIA), undefined, FYTIA));
    const withPlace = body(await cyclones(cache(FYTIA), "Saint-Philippe", FYTIA));
    expect(withPlace).toEqual(without);
    expect(body(await cyclones(cache(FYTIA), "nulle part ailleurs", FYTIA)).systemes_actifs).toHaveLength(1);
  });

  it("answers over MCP a call that still sends `lieu`, which the tool no longer lists", async () => {
    const rpc = (body: unknown) => handle(new Request("https://rundata.re/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) }), new Cache());
    const tools = (await (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })).json()).result.tools;
    const tool = tools.find((t: { name: string }) => t.name === "cyclones");
    expect(Object.keys(tool.inputSchema.properties)).toEqual(["nom"]);
    expect(tool.description).toContain("Ni trajectoire, ni position, ni distance, ni prévision");
    const r = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cyclones", arguments: { lieu: "Saint-Philippe" } } })).json();
    expect(r.error).toBeUndefined();
    expect(r.result.content[0].text).toContain("meteofrance.re/fr/cyclone");
  });

  it("says plainly that nothing is active out of season, with the last system and the season before, by name and dates only", async () => {
    const r = body(await cyclones(cache(OCTOBER), undefined, OCTOBER));
    expect(r.systemes_actifs).toBeUndefined();
    expect(r.resume).toMatch(/^Aucun système tropical actif dans le sud-ouest de l'océan Indien\. Saison 2026-2027 : aucun système pour le moment\. Dernier système : Indusa, du 01\/04\/2026 au 05\/04\/2026\. Consulter le site officiel de Météo-France : https:\/\/meteofrance\.re\/fr\/cyclone$/);
    expect(r.saison_precedente.nom).toBe("2025-2026");
    expect(r.saison_precedente.systemes.map((s: { nom: string }) => s.nom)).toEqual(expect.arrayContaining(["Fytia", "Gezani", "Chenge", "Blossom", "Awo"]));
    expect(Object.keys(r.saison_precedente.systemes.find((s: { nom: string }) => s.nom === "Gezani"))).toEqual(["nom", "du", "au", "centre", "rapport"]);
    expect(r.consulter.meteo_france).toBe("https://meteofrance.re/fr/cyclone");
    expect(r.phases_alerte).toContain("alerte violette");
    // No colour for the pré-alerte: the prefecture dropped its yellow (release of 26/11/2024).
    expect(r.phases_alerte).toContain("la pré-alerte cyclonique (menace dans les jours à venir, s'informer)");
    expect(r.phases_alerte).not.toMatch(/jaune/);
    // A full first page that stops in October 2025: the second one reaches July 2025.
    expect(calls.filter((u) => u.includes("pagenumber=2"))).toHaveLength(1);
    expect(calls.some((u) => u.includes("getepisodedata"))).toBe(false);
  });

  it("says so when GDACS does not answer, with Météo-France's link", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    const r = await cyclones(cache(OCTOBER), undefined, OCTOBER);
    expect(r).toMatchObject({ isError: true });
    expect(body(r).consulter.meteo_france).toBe("https://meteofrance.re/fr/cyclone");
    expect(body(r).officiel).toBe(OFFICIEL);
  });

  it("shows on /cyclones no map and no figure of ours, and leads to Météo-France's site for the track", async () => {
    const value = body(await cyclones(cache(FYTIA), undefined, FYTIA)) as CyclonesAnswer;
    const page = cyclonesPage("https://rundata.re", { value, fetchedAt: FYTIA, stale: false }, FYTIA).replace(/&#39;/g, "'");
    expect(page).toContain('<p class="lead">Trajectoire et bulletins officiels : <a href="https://meteofrance.re/fr/cyclone" rel="noopener">consulter le site officiel de Météo-France</a>.</p>');
    expect(page).not.toContain("<svg class=\"map ocean\"");
    // The top of the page and the active systems; the past cyclones below keep the gusts their stations measured.
    const live = page.slice(0, page.indexOf('id="h-alerte"'));
    expect(live).not.toMatch(/Au plus près|Déplacement|Vent moyen|Cercles à 500|km au |rafales|hPa|Pression/);
    expect(page).toContain("<h3>Fytia <span class=\"note\">tempête tropicale modérée</span></h3><p>Dernier avis du CMRS : 03/02 à 10:00 (heure de La Réunion).</p>");
    expect(page).toContain("<title>Cyclone Réunion en ce moment : systèmes actifs, alerte · 974</title>");
    expect(page).toContain("Néna in siklone pa loin La Rényon ? Gèt si https://rundata.re/cyclones é di amwin sak Météo-France é la préfektir i di.");
    expect(page).toContain("Y a-t-il un cyclone près de La Réunion ? Lis https://rundata.re/cyclones et dis-moi ce qu'en disent Météo-France et la préfecture.");
    const out = body(await cyclones(cache(OCTOBER), undefined, OCTOBER)) as CyclonesAnswer;
    const quiet = cyclonesPage("https://rundata.re", { value: out, fetchedAt: OCTOBER, stale: false }, OCTOBER);
    expect(quiet).toContain("<thead><tr><th>Système</th><th>Dates</th></tr></thead>");
    expect(quiet).not.toMatch(/Au plus fort|Vent moyen max|vent moyen sur 10 minutes/);
    // The phases of the prefect's alert and the radio are said here, and no more on /vigilance.
    expect(quiet).toContain(`<h3>Alerte cyclonique</h3>${CYCLONE_SCALE}`);
    expect(quiet).toContain("Écoutez la radio en cas de cyclone");
    const vigilance = vigilancePage("https://rundata.re", null, OCTOBER);
    expect(vigilance).not.toContain("Écoutez la radio");
    // /vigilance is the weather's: its name no longer says the cyclone alert, which is /cyclones's.
    expect(vigilance).toContain("<title>Vigilance météo Réunion 974 en direct</title>");
    expect(vigilance).toContain('<h1>Vigilance météo <span class="n974">974</span></h1>');
    expect(vigilance).toContain('"position":2,"name":"Vigilance météo"');
    // The fixed description, while the copy is not there yet.
    expect(cyclonesPage("https://rundata.re", null, OCTOBER)).toContain('<meta name="description" content="Cyclones autour de La Réunion (974)\u00a0: systèmes actifs et leur stade selon le CMRS de Météo-France, alerte cyclonique, saisons passées, lien officiel.">');
  });

  it("puts Météo-France's link on /alerte-cyclone and /ecoles-cyclone, even when the alert cannot be read", () => {
    const link = '<p class="lead"><a href="https://meteofrance.re/fr/cyclone" rel="noopener">Consulter le site officiel de Météo-France</a></p>';
    expect(alertePage("https://rundata.re", null)).toContain(link);
    expect(ecolesPage("https://rundata.re", null)).toContain(link);
  });
});
