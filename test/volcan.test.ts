import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parse, where } from "../src/providers/seismes.js";
import type { Info } from "../src/providers/actualites.js";
import { activityPosts, phaseOf } from "../src/providers/volcan.js";
import { quakeSummary, volcanSeismes } from "../src/tools/volcan.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
// Samples of 23/10/2026 around 03:00 heure de La Réunion: no eruption, Enclos partly open, inflation since September.
const NOW = new Date("2026-10-22T23:20:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

function cacheWith() {
  const store = new MemoryStore();
  const t = NOW.getTime();
  void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
  void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky.json"))), fetchedAt: t });
  void store.put("volcan:pitonlive", { value: JSON.parse(fixture("pitonlive_state.json")), fetchedAt: t });
  void store.put("volcan:prefecture", { value: null, fetchedAt: t });
  // The last phase the prefecture declared, kept: back to vigilance in May, before pitonlive's status of October.
  const may = { titre: "Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos", lien: "https://www.reunion.gouv.fr/x", publie: "2026-05-07T08:00:00.000Z" } as Info;
  void store.put("volcan:prefecture:derniere-phase", { value: phaseOf([may]), fetchedAt: t });
  return new Cache(store, () => t);
}

describe("earthquakes", () => {
  it("reads the FDSN text, newest first, times in UTC", () => {
    const list = parse(fixture("ipgp_seismes.txt"));
    expect(list).toHaveLength(18);
    expect(list[0]).toMatchObject({ time: "2026-10-21T17:45:52.561Z", type_magnitude: "Md" });
  });

  it("says where in words", () => {
    expect(where(55.7131, -21.2391)).toBe("sous le sommet du Piton de la Fournaise");
    expect(where(55.488, -21.0)).toBe("à 6 km au nord-ouest de Salazie");
    expect(where(55.55, -21.2)).toMatch(/du Tampon$/);
  });

  it("counts under the volcano and elsewhere", () => {
    const q = quakeSummary(parse(fixture("ipgp_seismes.txt")), NOW);
    expect(q.sous_le_volcan["30_jours"]).toBe(11);
    expect(q.ailleurs_sur_l_ile["30_jours"]).toBe(7);
    expect(q.derniers[0].heure).toBe("21/10 21:45 heure de La Réunion");
  });
});

describe("volcano", () => {
  it("keeps the observatory's activity posts, not its conferences or job offers", () => {
    const posts = activityPosts(JSON.parse(fixture("ovpf_bluesky.json")));
    expect(posts[0].texte).toMatch(/^Bulletin mensuel OVPF-IPGP – Septembre 2026/);
    expect(posts.some((p) => /Offre d.emploi|Conférence/.test(p.texte))).toBe(false);
    expect(posts[0].lien).toMatch(/^https:\/\/bsky\.app\/profile\/ovpf\.bsky\.social\/post\//);
  });

  it("sums it all up", async () => {
    const r = body(await volcanSeismes(cacheWith(), NOW));
    expect(r.resume).toContain("Pas d'éruption en cours au Piton de la Fournaise. Niveau du dispositif ORSEC volcan : Vigilance.");
    expect(r.resume).toContain("Dernière éruption terminée le 12/04 (il y a 193 jours).");
    expect(r.resume).toContain("Accès à l'Enclos : partiellement ouvert (Préfecture de La Réunion — arrêté n°2026-627 du 7 mai 2026).");
    expect(r.resume).toContain("11 sous le volcan (magnitude max 1)");
    expect(r.sources.map((s: { source: string }) => s.source)).toHaveLength(3);
  });
});
