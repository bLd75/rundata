import { describe, expect, it } from "vitest";
import type { Cached } from "../src/cache.js";
import { BIKES_STALE_MS, COLUMNS, COMMUNES, communePage, spans } from "../src/web/commune.js";
import type { CommuneData } from "../src/web/data.js";
import { pageOf } from "../src/web/places.js";

const ORIGIN = "https://rundata.re";
// Saturday 31/10/2026, 01:13 at La Réunion.
const NOW = new Date("2026-10-30T21:13:00Z");
const p = pageOf("saint-pierre")!;

// Invented stations, from 5 bikes down to none, at an invented place.
const velos = ["Station A", "Station B", "Station C", "Station D", "Station E", "Station F"].map((nom, i) => ({
  nom,
  commune: "Saint-Pierre",
  velos_electriques: Math.max(0, 5 - 2 * i),
  places_libres: 6,
  maj: "15:35",
  lat: -21.3 - i / 1000,
  lon: 55.5,
}));
const departs: NonNullable<CommuneData["bus"]>["departs"] = [
  { heure: "04:10", dans_min: 177, ligne: "A1", direction: "Ville A", reseau: "Réseau A", arret: "Gare A" },
  { heure: "04:30", dans_min: 197, ligne: "A2", direction: "Ville B", reseau: "Réseau A", arret: "Gare A" },
];
const commune = (fetchedAt: Date, data: Partial<CommuneData> = { bus: { gare: true, arrets: [], departs }, velos }) =>
  ({ place: null, commune: { value: { sources: [], ...data }, fetchedAt, stale: false } as Cached<CommuneData> });
const ago = (ms: number) => new Date(NOW.getTime() - ms);

/** The tiles of « en ce moment », in order: their name and their span at each of COLUMNS (absent: one column). */
function grid(page: string) {
  const ul = page.match(/<ul class="tiles fit" aria-label="Catégories">(.*?)<\/ul>\s*<p class="note">/s)![1];
  return [...ul.matchAll(/<li class="tile[^"]*"(?: style="([^"]*)")?>.*?<h3>(?:<a[^>]*>)?([^<]*)/gs)].map((m) => ({
    nom: m[2],
    span: COLUMNS.map((c) => Number(new RegExp(`--s${c}:(\\d)`).exec(m[1] ?? "")?.[1] ?? 1)),
  }));
}

/** The rows of a grid of `c` columns packed as CSS packs it densely: each tile in the first place it fits. */
function pack(span: number[], c: number): number[][] {
  const rows: number[][] = [];
  span.forEach((s, i) => {
    for (let r = 0; ; r++) {
      const row = (rows[r] ??= Array(c).fill(-1));
      const at = row.findIndex((_, x) => x + s <= c && row.slice(x, x + s).every((v) => v < 0));
      if (at >= 0) return void row.fill(i, at, at + s);
    }
  });
  return rows;
}

const tile = (page: string, nom: string) => page.match(new RegExp(`<li class="tile[^>]*>(?:(?!<li class="tile).)*?>${nom}</a></h3>.*?(?=<li class="tile)`, "s"))![0];

describe("a commune's tiles", () => {
  it("leave no hole in the grid, on a phone, a tablet or a computer, in every commune", () => {
    for (const c of COMMUNES)
      for (const data of [commune(ago(60_000)), commune(ago(60_000), {}), commune(ago(BIKES_STALE_MS + 60_000))]) {
        const g = grid(communePage(ORIGIN, c, data, NOW));
        COLUMNS.forEach((n, k) => {
          for (const row of pack(g.map((t) => t.span[k]), n)) expect(row.filter((x) => x < 0), `${c.nom}, ${n} colonnes`).toEqual([]);
        });
      }
  });

  it("give the buses and the bikes a whole row, beside no other tile", () => {
    const g = grid(communePage(ORIGIN, p, commune(ago(60_000)), NOW));
    for (const nom of ["Bus", "Vélos"]) expect(g.find((t) => t.nom === nom)!.span).toEqual([...COLUMNS]);
    // The small tiles go up to fill the row before them rather than leave it to the lists: one column each, but the last
    // ones, widened to end their row.
    expect(g.slice(0, 9).every((t) => ["Bus", "Vélos"].includes(t.nom) || t.span.every((s) => s === 1))).toBe(true);
  });

  it("widen the tile left of a gap that no later tile fills", () => {
    // Three tiles, then a list: on a phone the third is alone on its row, on a computer it ends one with a column left.
    expect(spans([{}, {}, {}, { full: true }])).toEqual([[1, 1, 1], [1, 1, 1], [2, 1, 2], [2, 3, 4]]);
    // On a phone the third tile goes up beside the first, the wide one under them; on a tablet it is alone under them.
    expect(spans([{}, { wide: true }, {}])).toEqual([[1, 1, 1], [2, 2, 2], [1, 3, 1]]);
  });
});

describe("the Vélos tile", () => {
  it("lists four stations on a line each, « Y aller » beside them", () => {
    const t = tile(communePage(ORIGIN, p, commune(ago(60_000)), NOW), "Vélos");
    expect(t).toContain('<p class="tv">9 vélos</p>');
    expect(t).toContain("électriques en libre-service dans 6 stations Altervélo, relevé à 01:12");
    expect(t.match(/<li>/g)).toHaveLength(4);
    expect(t).toContain('<li><span>Station A<small><b>5</b> vélos · 6 places</small></span><span class="ya"><a class="aller"');
    expect(t).not.toContain("Station E");
  });

  it("says « hier » for a count of the day before", () => {
    // Read at 23:50, seen at 00:05.
    const t = tile(communePage(ORIGIN, p, commune(new Date("2026-10-30T19:50:00Z")), new Date("2026-10-30T20:05:00Z")), "Vélos");
    expect(t).toContain("relevé hier à 23:50");
  });

  it("no longer gives the bikes counted as those of the moment once the count is old", () => {
    const t = tile(communePage(ORIGIN, p, commune(new Date("2026-10-30T11:35:00Z")), NOW), "Vélos");
    expect(t).toContain('<p class="tv">6 stations</p>');
    // The instruction first, never cut.
    expect(t).toContain('<p class="td all">Rechargez la page dans quelques secondes\u00a0: vélos libres comptés hier à 15:35.</p>');
    expect(tile(communePage(ORIGIN, p, commune(new Date("2026-10-29T11:35:00Z")), NOW), "Vélos")).toContain("vélos libres comptés le 29/10 à 15:35.");
    expect(t).not.toMatch(/\d vélos?<|<li>/);
    // Just under the limit, the count is still given.
    expect(tile(communePage(ORIGIN, p, commune(ago(BIKES_STALE_MS - 60_000)), NOW), "Vélos")).toContain('<p class="tv">9 vélos</p>');
  });
});

describe("the town hall's tile", () => {
  // An invented town hall whose entry of the directory gives no hours.
  const hall = { nom: "Mairie - Ville A", insee: "97416", adresse: "Rue A", lon: null, lat: null, horaires: [], fiche: "https://lannuaire.service-public.fr/x" };

  it("says the hours are absent from the directory, and leaves them out of the description", () => {
    const page = communePage(ORIGIN, p, commune(ago(60_000), { mairie: hall }), NOW);
    expect(page).toContain(`<p class="tv">Horaires absents de l'annuaire</p>`);
    expect(page.match(/<meta name="description" content="([^"]*)"/)![1]).not.toMatch(/mairie/i);
  });
});
