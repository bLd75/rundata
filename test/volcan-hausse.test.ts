import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parsePrefecture } from "../src/providers/actualites.js";
import { parse } from "../src/providers/seismes.js";
import { activityPosts, phaseOf, type PitonState } from "../src/providers/volcan.js";
import { lineText } from "../src/tools/volcan-acces.js";
import { official } from "../src/tools/volcan.js";
import { buildVolcan } from "../src/web/data.js";
import { volcanLive, volcanPage } from "../src/web/domains.js";
import { homePage, type HomeLive } from "../src/web/home.js";
import { DESCRIPTION_MAX, meteoPage } from "../src/web/pages.js";
import { typo } from "../src/web/typo.js";
import { alerteVolcan, bannerText, homeCard, volcanH1, volcanMeta, volcanTitle, withVolcan } from "../src/web/volcan-alerte.js";

// The prefecture's release of 24/10/2026, alert 1 (its page as captured, and its card in the list), and pitonlive at
// « Alerte 2-1 » the same day: the release is kept beside pitonlive's level, in marketing's words.
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

/** What is ours in a text: the quotations taken out. */
const ours = (s: string) => s.replace(/«[^«»]*»/g, "«»");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NIVEAU = "« Alerte 2-1 » selon pitonlive.com (24/10). Le dernier communiqué de la préfecture que nous avons lu (24/10) indique « alerte 1 » : vérifiez le niveau en vigueur sur reunion.gouv.fr.";
const AVANT = "Les lignes ci-dessous citent le communiqué de la préfecture du 24/10, au niveau « alerte 1 ». pitonlive.com indique un niveau plus haut, « Alerte 2-1 » : vérifiez les accès sur reunion.gouv.fr avant de partir.";

describe("pitonlive higher than the prefecture's release: both said, the release kept", () => {
  it("puts both levels in the home page's card alone, with the way to /volcan, and the banner on the other pages", async () => {
    const v = await answer(piton("Alerte 2-1", "2026-10-24T13:00:00Z"));
    const a = alerteVolcan(v)!;
    const copy = { value: v, fetchedAt: NOW, stale: false };
    const home = withVolcan(a, () => homePage("https://rundata.re", { volcan: copy } as unknown as HomeLive, NOW));
    expect(home).not.toContain('class="alerte volcan"');
    // The hero's Volcan box: pitonlive's level with its source under it.
    expect(home).toContain("<b>« Alerte 2-1 »</b><small>selon pitonlive.com</small>");
    expect(home).toContain("« Alerte 2-1 » selon pitonlive.com, « alerte 1 » selon le communiqué de la préfecture du 24/10. Accès à l&#39;Enclos interdit selon ce communiqué : vérifiez sur reunion.gouv.fr. <b>Suivre en direct\u00a0→</b>");
    expect(withVolcan(a, () => volcanPage("https://rundata.re", copy, NOW))).not.toContain('class="alerte volcan"');
    expect(withVolcan(a, () => meteoPage("https://rundata.re", null, NOW))).toContain("« Alerte 2-1 » selon pitonlive.com, « alerte 1 » selon le communiqué");
  });

  it("keeps the release beside a higher level only when it is an alert", () => {
    const s = official(piton("Alerte 2-1", "2026-10-24T13:00:00Z"), ALERT_1);
    expect(s).toMatchObject({ prefecture: ALERT_1, hausse: true, status: { alert_level_display: "Alerte 2-1", is_erupting: false } });
    // A release in vigilance says nothing that stands in an alert: pitonlive alone, as before.
    const may = phaseOf(parsePrefecture(card("Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos")))!;
    expect(official(piton("Alerte 1", "2026-10-25T04:00:00Z"), may)).not.toHaveProperty("prefecture");
    // The same level the next day: pitonlive's, nothing said beside it.
    expect(official(piton("Alerte 1", "2026-10-25T04:00:00Z"), ALERT_1)).not.toHaveProperty("hausse");
  });

  it("says both levels with their days, the release cited and its lines kept, in the answer", async () => {
    const v = await answer(piton("Alerte 2-1", "2026-10-24T13:00:00Z"));
    expect(v.etat).toMatchObject({
      niveau_orsec: "Alerte 2-1",
      // Unknown: the release does not say it, and pitonlive's level is never read as one on our word (marketing).
      eruption_en_cours: null,
      ecart_prefecture: { pitonlive: "Alerte 2-1", jour_pitonlive: "2026-10-24", prefecture: "alerte 1", jour_prefecture: "2026-10-24", enclos_interdit: true },
      communique_prefecture: { niveau: "Alerte 1", titre: TITRE, lien: LIEN, jour: "2026-10-24" },
    });
    expect(v.etat?.niveau_definition).toBeUndefined();
    expect(v.resume.startsWith(`${NIVEAU} Communiqué de la préfecture du 24/10 : « ${TITRE} » (${LIEN}). Puis-je monter au volcan ? ${AVANT} Enclos : interdit. « L'accès du public`)).toBe(true);
    expect(v.puis_je_monter?.avant).toBe(AVANT);
    expect(v.puis_je_monter?.lignes[0]).toMatchObject({ lieu: "Enclos", source: "communiqué de la préfecture du 24/10", lien: LIEN });
    expect(v.puis_je_monter?.lignes[1].texte).toBe("RN 2 (Grand Brûlé) : « La RN 2 reste ouverte à la circulation »");
    // The lines of the release's level: none of an eruption's.
    expect(v.puis_je_monter?.lignes.some((l) => l.lieu === "Interdiction" || /éruption/i.test(ours(l.texte)))).toBe(false);
    expect(v.sources.map((s) => s.source)).toContain("Communiqués de presse de la préfecture de La Réunion");
    // The Enclos as the release says it, never pitonlive's older word (its access still cites the decree of 7 May).
    expect(v.etat?.acces_enclos).toMatchObject({ statut: "ferme", source: "Préfecture de La Réunion", lien: LIEN, communique: { mots: "fermeture", jour: "2026-10-24", lien: LIEN } });
    expect(v.resume).toContain("Accès à l'Enclos : « fermeture » selon le communiqué de la préfecture du 24/10.");
    expect(v.resume).not.toContain("interdit selon le communiqué");
    expect(v.resume).not.toMatch(/partiellement ouvert|2026-627/);

    // Of ours, in the level, the release's line and the accesses: no « éruption », no « depuis » of a time, no hour.
    const said = [NIVEAU, `Communiqué de la préfecture du 24/10 : « ${TITRE} »`, v.puis_je_monter!.avant!, ...v.puis_je_monter!.lignes.map(lineText)].join(" ");
    expect(v.resume).toContain(said.slice(0, 200));
    // « depuis » of a time; « la route forestière depuis Bourg-Murat » is a place.
    expect(ours(said)).not.toMatch(/éruption|depuis (?:le|l'|\d)|plus tard|plus récent|\d{1,2}[:h]\d{2}/i);
  });

  it("says both on /volcan, in the banner and above the accesses, with no eruption of ours", async () => {
    const v = await answer(piton("Alerte 2-1", "2026-10-24T13:00:00Z"));
    const a = alerteVolcan(v)!;
    expect(a).toMatchObject({ niveau: "Alerte 2-1", eruption: false });
    expect(bannerText(a)).toBe("🌋 « Alerte 2-1 » selon pitonlive.com, « alerte 1 » selon le communiqué de la préfecture du 24/10. Accès à l'Enclos interdit selon ce communiqué : vérifiez sur reunion.gouv.fr.");
    // What is seen first says the higher level, quoted with its source; the release's right after it.
    expect(volcanH1(a)).toBe("Piton de la Fournaise : « Alerte 2-1 » selon pitonlive.com");
    expect(volcanTitle(a)).toBe("Piton de la Fournaise : « Alerte 2-1 » selon pitonlive.com · 974");
    expect(volcanLive({ value: v, fetchedAt: NOW, stale: false })).toEqual({ valeur: "« Alerte 2-1 »", detail: "selon pitonlive.com · préfecture : alerte 1", source: "selon pitonlive.com" });
    expect(homeCard(a)).toContain("<h2>🌋 Piton de la Fournaise : « Alerte 2-1 » selon pitonlive.com</h2><p class=\"lead\">« Alerte 2-1 » selon pitonlive.com, « alerte 1 » selon le communiqué");
    expect(volcanMeta(a)).toBe("« Alerte 2-1 » selon pitonlive.com, « alerte 1 » selon la préfecture (24/10). Enclos interdit selon son communiqué : vérifiez sur reunion.gouv.fr · 974");
    // Longer levels: the Enclos goes, the description stays within its length.
    const long = alerteVolcan({ ...v, etat: { ...v.etat!, ecart_prefecture: { ...v.etat!.ecart_prefecture!, pitonlive: "Alerte 2-2 éruption hors enclos", prefecture: "vigilance volcanique renforcée" } } })!;
    expect(volcanMeta(long)).toBe("« Alerte 2-2 éruption hors enclos » selon pitonlive.com, « vigilance volcanique renforcée » selon la préfecture (24/10) : vérifiez sur reunion.gouv.fr · 974");
    expect(volcanMeta(long).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    const html = volcanPage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW);
    // Never « no eruption » where the page is described, the eruption being unknown.
    const metas = [...html.matchAll(/<(?:title>[^<]*|meta [^>]*(?:description|title)[^>]*>)/g)].map((m) => m[0]).join(" ");
    expect(metas).toContain("« Alerte 2-1 » selon pitonlive.com");
    expect(metas).not.toMatch(/pas d(?:'|&#39;)éruption|alerte 1, éruption/i);
    expect(html).not.toMatch(/Pas d(?:'|&#39;)éruption en cours/);
    const top = html.slice(html.indexOf('<div class="status">'), html.indexOf('id="h-volcan"'));
    expect(top).toContain("<b>« Alerte 2-1 » selon pitonlive.com (24/10). Le dernier communiqué de la préfecture que nous avons lu (24/10) indique « alerte 1 » : vérifiez le niveau en vigueur sur reunion.gouv.fr.</b>");
    expect(top).toContain("<p><b>Les lignes ci-dessous citent le communiqué de la préfecture du 24/10, au niveau « alerte 1 ». pitonlive.com indique un niveau plus haut, « Alerte 2-1 » : vérifiez les accès sur reunion.gouv.fr avant de partir.</b></p><ul");
    expect(top).not.toMatch(/Éruption en cours|n'ont pas annoncé d'éruption/);
    // The no-break spaces come with the page as sent, as on every page.
    expect(typo(top)).toContain("<b>«\u00a0Alerte 2-1\u00a0» selon pitonlive.com (24/10). Le dernier communiqué de la préfecture que nous avons lu (24/10) indique «\u00a0alerte 1\u00a0»\u00a0: vérifiez")
  });

  it("stops the banner after the release's day when the release does not say the Enclos", async () => {
    const v = await answer(piton("Alerte 2-1", "2026-10-24T13:00:00Z"));
    const a = alerteVolcan({ ...v, etat: { ...v.etat!, ecart_prefecture: { ...v.etat!.ecart_prefecture!, enclos_interdit: false } } })!;
    expect(bannerText(a)).toBe("🌋 « Alerte 2-1 » selon pitonlive.com, « alerte 1 » selon le communiqué de la préfecture du 24/10 : vérifiez sur reunion.gouv.fr.");
  });
});
