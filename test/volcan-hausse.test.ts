import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parsePrefecture } from "../src/providers/actualites.js";
import { parse } from "../src/providers/seismes.js";
import { activityPosts, phaseOf, type PitonState } from "../src/providers/volcan.js";
import { buildVolcan } from "../src/web/data.js";
import { volcanLive, volcanPage } from "../src/web/domains.js";
import { homePage, type HomeLive } from "../src/web/home.js";
import { meteoPage } from "../src/web/pages.js";
import { alerteVolcan, bannerText, homeCard, volcanH1, volcanMeta, volcanTitle, withVolcan } from "../src/web/volcan-alerte.js";

// The prefecture's release of 24/10/2026, alert 1 (its page as captured, and its card in the list), and pitonlive at
// « Alerte 2-1 » the same day: the release's level everywhere, pitonlive's in a line of its own in the body, never in a
// title (the user, 25/10/2026; marketing's words).
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const PAGE = fixture("actualites/prefecture-alerte1-enclos.html");
const LIEN = "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Piton-de-la-Fournaise-passage-en-alerte-1-fermeture-de-l-enclos5";
const TITRE = "Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos";
const card = (titre: string) =>
  `<h2 class="fr-card__title"><a class="fr-card__link" href="/Actualites/Communiques-de-presse/Piton-de-la-Fournaise-passage-en-alerte-1-fermeture-de-l-enclos5">${titre}</a></h2><div class="fr-card__end"><p class="fr-card__detail">Publié le 24/10/2026</p></div>`;
const ALERT_1 = phaseOf(parsePrefecture(card(TITRE)))!;
const NOW = new Date("2026-10-24T16:30:00Z");

const piton = (level: string, at: string, erupting = /^Alerte 2/.test(level)): PitonState => {
  const s = JSON.parse(fixture("pitonlive_state.json")) as PitonState;
  return { ...s, status: { ...s.status, alert_level: level.toLowerCase(), alert_level_display: level, is_erupting: erupting, published_at: at } };
};

async function answer(state: PitonState) {
  const store = new MemoryStore();
  const t = NOW.getTime();
  void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
  void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky.json"))), fetchedAt: t });
  void store.put("volcan:pitonlive", { value: state, fetchedAt: t });
  void store.put("volcan:prefecture", { value: ALERT_1, fetchedAt: t });
  vi.stubGlobal("fetch", async () => new Response(PAGE));
  vi.spyOn(console, "log").mockImplementation(() => {});
  return buildVolcan(new Cache(store, () => t, true, new MemoryStore()), NOW);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const LIGNE = "Selon pitonlive.com, site non officiel, lu le 24/10 à 20:30 : « Alerte 2-1 ». Ce niveau n'apparaît pas dans les communiqués de la préfecture que nous avons lus : vérifiez sur reunion.gouv.fr avant de monter au volcan.";

describe("pitonlive higher than the prefecture's release: the release's level, pitonlive's a line apart", () => {
  it("keeps the release's level and eruption in the answer, pitonlive's line after the level", async () => {
    const v = await answer(piton("Alerte 2-1", "2026-10-24T13:00:00Z"));
    expect(v.etat).toMatchObject({
      niveau_orsec: "Alerte 1",
      eruption_en_cours: false,
      pitonlive_non_officiel: { niveau: "Alerte 2-1", lu: "24/10 à 20:30" },
      communique_prefecture: { niveau: "Alerte 1", titre: TITRE, lien: LIEN, jour: "2026-10-24" },
    });
    expect(v.resume).toContain(`Niveau du dispositif ORSEC volcan : Alerte 1. ${LIGNE} Selon pitonlive.com, site non officiel, lu le 24/10 à 20:30, une éruption est en cours.`);
    expect(v.resume.startsWith("Alerte 1 au Piton de la Fournaise")).toBe(true);
    // The accesses the release's, at its level, nothing said before them.
    expect(v.puis_je_monter?.avant).toBeUndefined();
    expect(v.puis_je_monter?.lignes[0]).toMatchObject({ lieu: "Enclos", source: "communiqué de la préfecture du 24/10", lien: LIEN });
    expect(v.resume).toContain("Accès à l'Enclos : « fermeture » selon le communiqué de la préfecture du 24/10.");
    // Credited last, as non official.
    expect(v.sources.map((x) => x.source).at(-1)).toBe("État du volcan (pitonlive.com, site non officiel)");
  });

  it("puts the release's level in the banner, the titles, the home page and the tile; pitonlive's only on /volcan's body", async () => {
    const v = await answer(piton("Alerte 2-1", "2026-10-24T13:00:00Z"));
    const a = alerteVolcan(v)!;
    expect(a).toMatchObject({ niveau: "Alerte 1", eruption: false });
    const copy = { value: v, fetchedAt: NOW, stale: false };
    const home = withVolcan(a, () => homePage("https://rundata.re", { volcan: copy } as unknown as HomeLive, NOW));
    const html = volcanPage("https://rundata.re", copy, NOW);
    const meteo = withVolcan(a, () => meteoPage("https://rundata.re", null, NOW));
    for (const t of [bannerText(a), volcanH1(a), volcanTitle(a), volcanMeta(a), homeCard(a), JSON.stringify(volcanLive(copy)), home.replace(/<footer[\s\S]*<\/footer>/, ""), meteo.replace(/<footer[\s\S]*<\/footer>/, ""), html.slice(0, html.indexOf("</h1>"))]) {
      expect(t).not.toMatch(/pitonlive|alerte\W2-1/i);
    }
    expect(volcanTitle(a)).toBe("Piton de la Fournaise : alerte 1, éruption probable · 974");
    // On /volcan, under the level, its line whole.
    const top = html.slice(html.indexOf('<div class="status">'), html.indexOf('id="h-volcan"'));
    expect(top).toContain(`<p class="lead">${LIGNE.replace(/'/g, "&#39;")}</p>`);
  });

  it("says nothing of pitonlive at the release's own level, nor below it", async () => {
    for (const level of ["Alerte 1", "Vigilance"]) {
      const v = await answer(piton(level, "2026-10-24T13:00:00Z"));
      expect(v.etat).not.toHaveProperty("pitonlive_non_officiel");
      expect(v.resume.replace(/Dernière éruption terminée le [^.]*\./, "")).not.toContain("pitonlive");
    }
  });
});
