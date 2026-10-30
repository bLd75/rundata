import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import * as onf from "../src/providers/sentiers.js";
import * as traces from "../src/providers/traces.js";
import { buildRoute, buildTrail, ROAD_NEAR_M, toLineM } from "../src/web/data.js";
import { tracePage } from "../src/web/domains.js";

const O = "https://rundata.re";
const NOW = new Date("2026-10-30T04:00:00Z");

// A hike that follows ONF trails, and its start: the first point of its trace, the white dot of the map.
const hike = traces.RANDONNEES.find((r) => r.sentiers_onf.length)!;
const start = traces.routePieces(hike)[0][0];
const trail = (statut: onf.Statut): onf.Sentier => ({ nom: hike.sentiers_onf[0], statut, cause: statut === "fermé" ? "Éboulement" : undefined, longueur_km: 1, points: [] });
// A forest road `north` degrees of latitude north of the start, closed to traffic or not.
const road = (north: number, circulation = "Circulation interdite"): onf.Route =>
  ({ nom: "Route Forestière de l'Exemple (RF99)", circulation, cause: "Travaux", longueur_km: 2, points: [[start.lon - 0.002, start.lat + north], [start.lon + 0.002, start.lat + north]] });

/** The hike's copy, the ONF's map as given (none: it did not answer). */
async function built(carte: onf.Carte | null) {
  const store = new MemoryStore();
  if (carte) await store.put(onf.KEY, { value: carte, fetchedAt: NOW.getTime() });
  return buildRoute(new Cache(store, () => NOW.getTime()), hike);
}
const page = async (carte: onf.Carte | null) => tracePage(O, "randonnee", hike.slug, hike.nom, { value: await built(carte), fetchedAt: NOW, stale: false }, NOW);

describe("« Y aller » to a hike's start", () => {
  // Nothing read: the ONF's map is the one put in the cache, or none when it does not answer.
  beforeAll(() => vi.stubGlobal("fetch", async () => new Response("", { status: 503 })));
  afterAll(() => vi.unstubAllGlobals());

  it("leads to the first point of its trace, by the normal route, the sheet once", async () => {
    const html = await page({ sentiers: [trail("ouvert")], routes: [] });
    expect(html).toContain(`Télécharger le GPX</a><a class="aller" href="https://www.google.com/maps/dir/?api=1&amp;destination=${start.lat},${start.lon}" rel="noopener" aria-label="Y aller : départ du ${hike.nom.replace(/'/g, "&#39;")}">`);
    expect(html).not.toContain('data-m="pied"');
    expect(html.match(/<dialog id="aller"/g)).toHaveLength(1);
  });

  it("is there too when the state of its trails is not known, said just above", async () => {
    expect(await page({ sentiers: [trail("hors gestion ONF")], routes: [] })).toContain('class="aller"');
  });

  it("is never there past a closed trail, nor without the ONF's map", async () => {
    for (const html of [await page({ sentiers: [trail("fermé")], routes: [road(0.001)] }), await page(null)]) {
      expect(html).not.toContain('class="aller"');
      expect(html).not.toContain('<dialog id="aller"');
      expect(html).not.toContain("Route forestière interdite");
    }
  });

  it("gives way to the ONF's fact, dated, when a forest road closed to traffic runs by the start; nothing for one open or farther", async () => {
    // About 220 m north: within ROAD_NEAR_M.
    const near = await built({ sentiers: [trail("ouvert")], routes: [road(0.002)] });
    expect(near.depart).toBeUndefined();
    // Read at 08:00 at La Réunion (NOW).
    expect(near.routes_fermees).toEqual({ routes: [{ route: "Route Forestière de l'Exemple (RF99)", cause: "Travaux" }], lu: "vendredi 30/10 à 08:00" });
    const html = tracePage(O, "randonnee", hike.slug, hike.nom, { value: near, fetchedAt: NOW, stale: false }, NOW);
    expect(html).not.toContain('class="aller"');
    expect(html).toContain("<p class=\"note\">Route forestière interdite à la circulation à 300\u00a0m ou moins du départ\u00a0: Route Forestière de l&#39;Exemple (RF99) (Travaux), selon l'ONF, lu le vendredi 30/10 à 08:00.</p>");
    // Two, one without a cause: « ; » between them, no empty brackets.
    const two = await built({ sentiers: [trail("ouvert")], routes: [road(0.002), { ...road(-0.001), nom: "Route Forestière B (RF98)", cause: undefined }] });
    expect(tracePage(O, "randonnee", hike.slug, hike.nom, { value: two, fetchedAt: NOW, stale: false }, NOW))
      .toContain("Routes forestières interdites à la circulation à 300\u00a0m ou moins du départ\u00a0: Route Forestière de l&#39;Exemple (RF99) (Travaux)\u00a0; Route Forestière B (RF98), selon l'ONF");
    // Open to traffic, or about 440 m away: the button, and no line (never « the way is open »).
    expect((await built({ sentiers: [trail("ouvert")], routes: [road(0.002, "Circulation autorisée")] })).depart).toBeDefined();
    const far = await built({ sentiers: [trail("ouvert")], routes: [road(0.004)] });
    expect(far.depart).toBeDefined();
    expect(far.routes_fermees).toBeUndefined();
  });

  it("measures a start's distance to a road along its segments, not only to its points", () => {
    expect(ROAD_NEAR_M).toBe(300);
    // A segment of 800 m whose middle passes 100 m from the point: its ends are over 400 m away.
    const d = toLineM(55.5, -21.1, [[55.5 - 0.0038, -21.1 + 0.0009], [55.5 + 0.0038, -21.1 + 0.0009]]);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
    expect(toLineM(55.5, -21.1, [[55.5, -21.1]])).toBe(0);
  });

  it("is never on an ONF trail's own page: the order of its pieces gives no real start", async () => {
    const t = { nom: hike.sentiers_onf[0], ...traces.SENTIERS[hike.sentiers_onf[0]] };
    expect(Object.keys(traces.SENTIERS)).toContain(t.nom);
    const store = new MemoryStore();
    const copy = await buildTrail(new Cache(store, () => NOW.getTime()), t).catch(() => null);
    if (copy) expect(copy.depart).toBeUndefined();
    expect(tracePage(O, "sentier", t.slug, t.nom, copy ? { value: copy, fetchedAt: NOW, stale: false } : null, NOW)).not.toContain('class="aller"');
  });
});
