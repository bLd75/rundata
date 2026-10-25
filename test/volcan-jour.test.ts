import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parsePrefecture } from "../src/providers/actualites.js";
import { parse } from "../src/providers/seismes.js";
import { activityPosts, phase, phaseOf, type PitonState } from "../src/providers/volcan.js";
import { official } from "../src/tools/volcan.js";
import { buildVolcan, type VolcanAnswer } from "../src/web/data.js";
import { volcanPage } from "../src/web/domains.js";
import { alerteVolcan } from "../src/web/volcan-alerte.js";

// The prefecture's release of 24/10/2026, its page as captured, and its card in the list of releases: both give the
// day only (« Mis à jour le 24/10/2026 », « Publié le 24/10/2026 »).
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const PAGE = fixture("actualites/prefecture-alerte1-enclos.html");
const LIEN = "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Piton-de-la-Fournaise-passage-en-alerte-1-fermeture-de-l-enclos5";
const TITRE = "Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos";
const CARD = `<h2 class="fr-card__title">
                    <a class="fr-card__link" href="/Actualites/Communiques-de-presse/Piton-de-la-Fournaise-passage-en-alerte-1-fermeture-de-l-enclos5">
                        ${TITRE}
                    </a>
                </h2>

                <div class="fr-card__end">
                    <p class="fr-card__detail">Publié le 24/10/2026</p>
                </div>`;
const ALERT_1 = phaseOf(parsePrefecture(CARD))!;

/** pitonlive's state at `level`, published at `at`. */
const piton = (level: string, at: string): PitonState => {
  const s = JSON.parse(fixture("pitonlive_state.json")) as PitonState;
  return { ...s, status: { ...s.status, alert_level: level.toLowerCase(), alert_level_display: level, published_at: at } };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the day of the prefecture's release, never an hour made up", () => {
  it("keeps the day alone: the list and the page give no hour", () => {
    expect(PAGE).toMatch(/Mis à jour le&nbsp;<\/span><span>24\/10\/2026<\/span>/);
    expect(ALERT_1).toMatchObject({ niveau: "Alerte 1", lien: LIEN, jour: "2026-10-24" });
    expect(ALERT_1).not.toHaveProperty("publie");
  });

  it("on the release's day, lets pitonlive win only higher; the next day, higher or at another level than the release's alert", () => {
    // 17:00 and 23:59, La Réunion's time, on the release's day: an eruption is not hidden until midnight.
    expect(official(piton("Alerte 2-1", "2026-10-24T13:00:00Z"), ALERT_1).status.alert_level_display).toBe("Alerte 2-1");
    expect(official(piton("Alerte 2-1", "2026-10-24T19:59:00Z"), ALERT_1).status.alert_level_display).toBe("Alerte 2-1");
    // The same level or lower that day: the prefecture's release keeps the level, and is the one quoted.
    const same = official(piton("Alerte 1", "2026-10-24T13:00:00Z"), ALERT_1);
    expect(same.prefecture).toBe(ALERT_1);
    expect(official(piton("Vigilance", "2026-10-24T13:00:00Z"), ALERT_1).status.alert_level_display).toBe("Alerte 1");
    // An end of alert of the day, pitonlive still higher: the higher level until pitonlive comes down or the next day.
    const end = phaseOf(parsePrefecture(CARD.replace(TITRE, "Piton de la Fournaise : fin de l'alerte 1")))!;
    expect(official(piton("Alerte 1", "2026-10-24T05:00:00Z"), end).status.alert_level_display).toBe("Alerte 1");
    expect(official(piton("Vigilance", "2026-10-24T13:00:00Z"), end).prefecture).toBe(end);
    // 00:30 the next day, pitonlive at the same alert: it says nothing more, the release stays the source (25/10/2026).
    const next = official(piton("Alerte 1", "2026-10-24T20:30:00Z"), ALERT_1, new Date("2026-10-27T06:00:00Z"));
    expect(next).toMatchObject({ prefecture: ALERT_1, status: { alert_level_display: "Alerte 1" } });
    expect(next).not.toHaveProperty("ecart");
    // Another alert of the same rank the next day (2-2 after a 2-1): pitonlive's, as before.
    const a21 = phaseOf(parsePrefecture(CARD.replace(TITRE, "Piton de la Fournaise : passage en alerte 2-1")))!;
    expect(official(piton("Alerte 2-2", "2026-10-24T20:30:00Z"), a21).prefecture).toBeUndefined();
    // Lower the next day: the alert holds, nothing said beside it before 48 hours.
    const lower = official(piton("Vigilance", "2026-10-25T04:00:00Z"), ALERT_1, new Date("2026-10-25T06:00:00Z"));
    expect(lower.status.alert_level_display).toBe("Alerte 1");
    expect(lower.ecart).toBeUndefined();
  });

  it("gives the day in the answer and on /volcan, with no hour", async () => {
    const now = new Date("2026-10-24T16:30:00Z");
    const store = new MemoryStore();
    const t = now.getTime();
    void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
    void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky.json"))), fetchedAt: t });
    // pitonlive at alert 1 at 18:00 the same day: the prefecture's release keeps its day.
    void store.put("volcan:pitonlive", { value: piton("Alerte 1", "2026-10-24T14:00:00Z"), fetchedAt: t });
    void store.put("volcan:prefecture", { value: ALERT_1, fetchedAt: t });
    vi.stubGlobal("fetch", async () => new Response(PAGE));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const v = await buildVolcan(new Cache(store, () => t, true, new MemoryStore()), now);
    expect(v.etat?.niveau_orsec).toBe("Alerte 1");
    expect(v.etat?.communique_prefecture).toEqual({ niveau: "Alerte 1", titre: TITRE, lien: LIEN, jour: "2026-10-24" });
    expect(v.resume).toContain(`Communiqué de la préfecture du 24/10 : « ${TITRE} »`);
    expect(JSON.stringify(v)).not.toMatch(/2026-10-24T0?8:00|12:00/);
    const html = volcanPage("https://rundata.re", { value: v, fetchedAt: now, stale: false }, now);
    expect(html).toContain('<p class="note">publié le 24 octobre</p>');
  });

  it("keeps the release the day after, pitonlive at the same alert under its own label: the level as the plan names it", async () => {
    // 25/10/2026 at 14:28: pitonlive's alert 1 of 08:02, the prefecture's of the 24th, read.
    const now = new Date("2026-10-25T10:28:00Z");
    const store = new MemoryStore();
    const t = now.getTime();
    void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
    void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky.json"))), fetchedAt: t });
    void store.put("volcan:pitonlive", { value: piton("Alerte 1 - eruption probable ou imminente", "2026-10-25T04:02:38.225000Z"), fetchedAt: t });
    void store.put("volcan:prefecture", { value: ALERT_1, fetchedAt: t });
    vi.stubGlobal("fetch", async () => new Response(PAGE));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const v = await buildVolcan(new Cache(store, () => t, true, new MemoryStore()), now);
    expect(v.etat?.niveau_orsec).toBe("Alerte 1");
    expect(v.etat?.communique_prefecture).toMatchObject({ niveau: "Alerte 1", lien: LIEN, jour: "2026-10-24" });
    expect(v.sources.map((x: { attribution: string }) => x.attribution)).toContain("Préfecture de La Réunion");
    expect(v.resume).toContain("Alerte 1 au Piton de la Fournaise : « éruption probable ou imminente » (dispositif ORSEC Volcan).");
    const enclos = v.puis_je_monter.lignes.find((l) => l.lieu === "Enclos")!;
    expect(enclos).toMatchObject({ source: "communiqué de la préfecture du 24/10", lien: LIEN });
    expect(enclos.texte).toMatch(/^Enclos : interdit/);
    const html = volcanPage("https://rundata.re", { value: v, fetchedAt: now, stale: false }, now);
    expect(html).toContain("<title>Piton de la Fournaise : alerte 1, éruption probable · 974</title>");
    for (const page of [JSON.stringify(v), html]) {
      expect(page).not.toContain("antérieur au niveau affiché");
      expect(page).not.toMatch(/eruption probable ou imminente/);
    }
  });

  it("reads the day of a phase kept, or of a copy of /volcan made, by an earlier version", async () => {
    const durable = new MemoryStore();
    const { jour: _, ...old } = ALERT_1;
    void durable.put("volcan:prefecture:derniere-phase", { value: { ...old, publie: "2026-10-24T08:00:00.000Z" }, fetchedAt: Date.parse("2026-10-24T09:00:00Z") });
    vi.stubGlobal("fetch", async () => {
      throw new Error("timeout");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = Date.parse("2026-10-24T16:30:00Z");
    const kept = await phase(new Cache(new MemoryStore(), () => t, true, durable), t);
    expect(kept.value).toMatchObject({ niveau: "Alerte 1", jour: "2026-10-24" });
    expect(kept.value).not.toHaveProperty("publie");

    const copy = { etat: { eruption_en_cours: false, niveau_orsec: "Alerte 1", communique_prefecture: { niveau: "Alerte 1", titre: TITRE, lien: LIEN, publie: "2026-10-24T08:00:00.000Z" } } } as unknown as VolcanAnswer;
    expect(alerteVolcan(copy)?.communique).toEqual({ titre: TITRE, lien: LIEN, jour: "2026-10-24" });
  });
});
