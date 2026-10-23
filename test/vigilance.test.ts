import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import gazetteer from "../src/places/gazetteer.json" with { type: "json" };
import { configure } from "../src/providers/mf-auth.js";
import * as mf from "../src/providers/vigilance.js";
import { vigilanceMeteo, vigilanceWarnings } from "../src/tools/vigilance.js";
import { unzip } from "../src/zip.js";

// The real flow of 22/10/2026 16:02, cut down to the Réunion files (and one other, to be skipped).
const zip = readFileSync(new URL("./fixtures/vigilance_om.zip", import.meta.url));
const NOW = new Date("2026-10-22T14:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

async function files() {
  const buf = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
  return unzip(buf, (n) => n.endsWith("_FMEE_.txt") && n !== "CDPV87_FMEE_.txt");
}

async function sample(): Promise<mf.Vigilance> {
  const f = await files();
  return mf.parse(JSON.parse(f.get("CDPV95_FMEE_.txt")!), JSON.parse(f.get("CDPV96_FMEE_.txt")!));
}

function cacheWith(v: mf.Vigilance) {
  const store = new MemoryStore();
  void store.put("vigilance", { value: v, fetchedAt: NOW.getTime() });
  return new Cache(store, () => NOW.getTime());
}

/** The sample with orange heavy rain in the East from 18:00 UTC, and the island in orange cyclone alert now. */
async function storm(): Promise<mf.Vigilance> {
  const v = structuredClone(await sample());
  v.zones["VIGI974-12"][12] = [
    { couleur: 1, debut: "2026-10-22T12:02:24Z", fin: "2026-10-22T18:00:00Z" },
    { couleur: 3, debut: "2026-10-22T18:00:00Z", fin: "2026-10-23T06:00:00Z" },
    { couleur: 2, debut: "2026-10-23T06:00:00Z" },
  ];
  v.zones[mf.ISLAND][mf.CYCLONE] = [{ couleur: 3, debut: "2026-10-22T12:02:24Z" }];
  return v;
}

beforeAll(() => configure({ token: "test" }));
afterAll(() => configure({}));

describe("vigilance Météo-France", () => {
  it("reads the Réunion files out of the zip and skips the others", async () => {
    const f = await files();
    expect([...f.keys()].sort()).toEqual(["CDPV95_FMEE_.txt", "CDPV96_FMEE_.txt"]);
    expect(JSON.parse(f.get("CDPV96_FMEE_.txt")!).domain_id).toBe("VIGI974");
  });

  it("keeps only what is issued, hours of one colour run together", async () => {
    const v = await sample();
    expect(v.emise).toBe("2026-10-22T12:02:24Z");
    // That day: green for wind and rain on land, nothing issued on the coasts, no cyclone alert.
    expect(Object.keys(v.zones).sort()).toEqual([mf.ISLAND, "VIGI974-11", "VIGI974-12", "VIGI974-13", "VIGI974-14", "VIGI974-15"]);
    expect(v.zones["VIGI974-11"][1]).toEqual([{ couleur: 1, debut: "2026-10-22T12:02:24Z", fin: undefined }]);
    expect(v.zones[mf.ISLAND][mf.CYCLONE]).toBeUndefined();
    expect(v.suivi.map((s) => s.titre)).toEqual(["Vagues-submersion", "Vents forts", "Fortes pluies/Orages"]);
  });

  it("puts every commune of the gazetteer in a land zone", () => {
    const communes = new Set((gazetteer as { places: { commune: string }[] }).places.map((p) => p.commune));
    for (const c of communes) expect(mf.ZONE_OF_COMMUNE[c], c).toBeDefined();
  });

  it("says when everything is green", async () => {
    const r = body(await vigilanceMeteo(cacheWith(await sample()), undefined, NOW));
    expect(r.resume).toContain("Pas d'alerte cyclonique");
    expect(r.resume).toContain("Aucune vigilance particulière");
    expect(r.emise).toBe("22/10 16:02 heure de La Réunion");
    expect(await vigilanceWarnings(cacheWith(await sample()), NOW)).toEqual([]);
  });

  it("gives the zone of a place, its colours to come and the cyclone alert", async () => {
    const cache = cacheWith(await storm());
    const est = body(await vigilanceMeteo(cache, "Saint-Benoît", NOW));
    expect(est.zone_vigilance).toMatch(/^Est/);
    expect(est.resume).toContain("ALERTE CYCLONIQUE orange, « je me prépare »");
    expect(est.resume).toContain("fortes pluies / orages orange du 22/10 22:00 au 23/10 10:00, jaune à partir du 23/10 10:00");
    const sud = body(await vigilanceMeteo(cache, "Cilaos", NOW));
    expect(sud.zone_vigilance).toMatch(/^Sud/);
    expect(sud.resume).toContain("Pas de vigilance particulière pour la zone Sud");
    const warnings = await vigilanceWarnings(cache, NOW);
    expect(warnings[0]).toContain("ALERTE CYCLONIQUE orange");
    expect(warnings[1]).toBe("Vigilance Météo-France en cours : orange fortes pluies / orages (Est). Détails avec vigilance_meteo.");
  });
});
