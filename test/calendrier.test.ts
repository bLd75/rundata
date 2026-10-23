import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { breaks, parisDate, sun } from "../src/providers/calendrier.js";
import { calendrier, longDate } from "../src/tools/calendrier.js";

const fixture = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

function cacheAt(now: Date) {
  const store = new MemoryStore();
  void store.put("calendrier:scolaire", { value: breaks(fixture("calendrier_scolaire.json").results), fetchedAt: now.getTime() });
  void store.put(`calendrier:feries:${now.getUTCFullYear()}`, { value: fixture("jours_feries.json"), fetchedAt: now.getTime() });
  return new Cache(store, () => now.getTime());
}

describe("calendar", () => {
  it("reads the ministry's dates as Paris midnights", () => {
    expect(parisDate("2026-10-09T22:00:00+00:00")).toBe("2026-10-10");
    expect(parisDate("2026-10-25T23:00:00+00:00")).toBe("2026-10-26");
    expect(longDate("2026-12-20")).toBe("dimanche 20 décembre 2026");
  });

  it("computes sunrise and sunset within a few minutes of the almanac", () => {
    const s = sun("2026-10-23", 55.45, -20.88);
    expect(s.lever.toISOString().slice(11, 16)).toBe("01:41");
    expect(s.coucher.toISOString().slice(11, 16)).toBe("14:23");
  });

  it("says holidays under way, the next public holiday and the sun", async () => {
    const now = new Date("2026-10-22T23:30:00Z");
    const r = body(await calendrier(cacheAt(now), "Maïdo", now));
    expect(r.resume).toContain("Nous sommes le vendredi 23 octobre 2026 à La Réunion.");
    expect(r.resume).toContain("Prochain jour férié : Toussaint, dimanche 1er novembre 2026 (dans 9 jours).");
    expect(r.resume).toContain("Vacances scolaires en cours (Vacances après 1ère période) : reprise des cours le lundi 26 octobre 2026.");
    expect(r.soleil.lieu).toMatch(/Maïdo/);
    expect(r.jours_feries.prochains.map((x: { nom: string }) => x.nom)).toContain("Abolition de l'esclavage");
  });
});
