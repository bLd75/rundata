import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parse } from "../src/providers/atmo.js";
import { qualiteAir } from "../src/tools/air.js";

// The ATMO index of the 24 communes for 22 and 23/10/2026: "moyen" everywhere, set by ozone.
const list = parse(JSON.parse(readFileSync(new URL("./fixtures/atmo_974.json", import.meta.url), "utf8")));
const NOW = new Date("2026-10-23T05:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
function cache() {
  const store = new MemoryStore();
  void store.put("atmo:974", { value: list, fetchedAt: NOW.getTime() });
  return new Cache(store, () => NOW.getTime());
}

describe("air quality", () => {
  it("reads the 24 communes for two days", () => {
    expect(list).toHaveLength(48);
    expect(new Set(list.map((x) => x.insee)).size).toBe(24);
  });

  it("names each commune as the site does, by its INSEE code: the layer's « Petite-Ile » with its accent", async () => {
    const names = [...new Set(list.map((x) => x.commune))];
    expect(names).toContain("Petite-Île");
    expect(names).toContain("L'Étang-Salé");
    expect(names).toContain("La Plaine-des-Palmistes");
    expect(names.filter((n) => /Petite-Ile|Etang|Plaine-Des/.test(n))).toEqual([]);
    expect(body(await qualiteAir(cache(), "Petite-Île", NOW)).resume).toMatch(/^Qualité de l'air aujourd'hui à Petite-Île : /);
    // A code not in the table keeps the layer's name.
    expect(parse({ features: [{ properties: { code_zone: "97499", lib_zone: "Ailleurs", date_ech: "2026-10-23", code_qual: 2, date_maj: "" } }] })[0].commune).toBe("Ailleurs");
  });

  it("answers for a place's commune, accents and articles aside", async () => {
    const r = body(await qualiteAir(cache(), "plage de l'Étang-Salé", NOW));
    expect(r.resume).toMatch(/^Qualité de l'air aujourd'hui à L'Étang-Salé : moyen \(2\/6\), surtout ozone/);
    expect(r.indices).toHaveLength(1);
  });

  it("sums up the island", async () => {
    const r = body(await qualiteAir(cache(), undefined, NOW));
    expect(r.resume).toBe("Qualité de l'air aujourd'hui à La Réunion : au pire moyen (2/6) dans toutes les communes.");
    expect(r.communes).toHaveLength(24);
  });
});
