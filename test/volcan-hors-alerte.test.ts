import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import type { Info } from "../src/providers/actualites.js";
import { parse } from "../src/providers/seismes.js";
import { activityPosts, phaseOf } from "../src/providers/volcan.js";
import { buildVolcan, type VolcanAnswer } from "../src/web/data.js";
import { volcanLive, volcanPage } from "../src/web/domains.js";
import { demos, homePage, type HomeLive } from "../src/web/home.js";

// Out of an alert: pitonlive at « Vigilance », the Enclos « partiel » as the prefecture's decree of 7 May says it, and
// the prefecture's phase of May kept, older than pitonlive's status, or its release of 20/10 back in vigilance.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-23T14:00:00Z");
const O = "https://rundata.re";
const MAY = phaseOf([{ titre: "Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos", lien: "https://www.reunion.gouv.fr/x", publie: "2026-05-07T08:00:00.000Z" } as unknown as Info]);
const VIGILANCE = phaseOf([{ titre: "Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos", lien: "https://www.reunion.gouv.fr/x", publie: "2026-10-20T08:00:00.000Z" } as unknown as Info])!;

async function answer(phase: unknown = null): Promise<VolcanAnswer> {
  const store = new MemoryStore();
  const t = NOW.getTime();
  void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
  void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky.json"))), fetchedAt: t });
  void store.put("volcan:pitonlive", { value: JSON.parse(fixture("pitonlive_state.json")), fetchedAt: t });
  void store.put("volcan:prefecture", { value: phase, fetchedAt: t });
  // The last phase the prefecture declared, kept: back to vigilance in May, before pitonlive's status of October.
  void store.put("volcan:prefecture:derniere-phase", { value: MAY, fetchedAt: t });
  return buildVolcan(new Cache(store, () => t), NOW);
}

/** What a reader sees of some HTML: the tags out, the entities read. */
const seen = (html: string) =>
  html.replace(/<style>[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/ /g, " ");

/** Each « pas d'éruption » in `text`, with what follows it up to the end of its sentence or its tile. */
const claims = (text: string) => [...text.matchAll(/pas d['’]éruption(?:[^.]|\.(?=\S))*/gi)].map((m) => m[0]);

describe("out of an alert, whether it erupts only with its source", () => {
  it("never says « pas d'éruption » without « selon pitonlive.com », in the page, its description, the home page and the AI's answer", async () => {
    for (const phase of [null, VIGILANCE]) {
      const v = await answer(phase);
      const copy = { value: v, fetchedAt: NOW, stale: false };
      const page = volcanPage(O, copy, NOW);
      const tile = volcanLive(copy)!;
      const texts = [
        seen(page),
        page.match(/name="description" content="([^"]*)"/)![1].replace(/&#39;/g, "'"),
        seen(homePage(O, { volcan: copy } as unknown as HomeLive, NOW)),
        demos({ volcan: copy } as unknown as HomeLive, NOW).find((d) => d.call === "volcan_seismes()")!.answer.replace(/&#39;/g, "'"),
        // The tile's value and its line together, as in its link.
        `${tile.valeur} ${tile.detail}`,
        v.resume,
      ];
      const all = texts.flatMap(claims);
      expect(all.length).toBeGreaterThan(5);
      for (const c of all) expect(c).toContain("selon pitonlive.com");
    }
  });

  it("describes /volcan and heads it in marketing's words", async () => {
    const page = volcanPage(O, { value: await answer(), fetchedAt: NOW, stale: false }, NOW);
    expect(page).toContain(`<meta name="description" content="🇷🇪 Piton de la Fournaise (974) : pas d&#39;éruption en cours selon pitonlive.com. Niveau ORSEC, accès à l&#39;Enclos et séismes localisés par l&#39;OVPF, en direct.">`);
    expect(page).toContain(`<p class="big">Pas d'éruption en cours selon pitonlive.com</p>`);
  });

  it("quotes pitonlive's word for the Enclos, never read as « ouvert », with the source it names", async () => {
    const v = await answer();
    const page = volcanPage(O, { value: v, fetchedAt: NOW, stale: false }, NOW);
    const source = `(source : <a href="https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Piton-de-la-Fournaise-reouverture-partielle-de-l-enclos">Préfecture de La Réunion, arrêté n° 2026-627 du 7 mai 2026</a>)`;
    expect(page).toContain(`Enclos : <b>« partiel »</b> selon pitonlive.com ${source}.`);
    expect(page).toContain("<h3>Enclos : « partiel » selon pitonlive.com</h3>");
    expect(page).not.toContain("partiellement ouvert");
    expect(volcanLive({ value: v, fetchedAt: NOW, stale: false })).toEqual({
      valeur: "Pas d'éruption",
      detail: expect.stringMatching(/^selon pitonlive\.com · Enclos « partiel » · \d+ séismes? localisés? par l'OVPF sous le volcan en 7 jours$/),
      source: "selon pitonlive.com",
    });
    // In the hero of the home page, its source on a line of its own under it, never cut with it.
    expect(homePage(O, { volcan: { value: v, fetchedAt: NOW, stale: false } } as unknown as HomeLive, NOW)).toContain("<b>Pas d'éruption</b><small>selon pitonlive.com</small>");
    // No source named: pitonlive alone.
    const bare = { ...v, etat: { ...v.etat!, acces_enclos: { ...v.etat!.acces_enclos!, source: undefined, lien: undefined, statut: "ferme" } } };
    expect(volcanPage(O, { value: bare, fetchedAt: NOW, stale: false }, NOW)).toContain("Enclos : <b>« fermé »</b> selon pitonlive.com.</p>");
  });

  it("quotes pitonlive's level with its source and without the plan's words; the prefecture's, as before", async () => {
    const piton = volcanPage(O, { value: await answer(), fetchedAt: NOW, stale: false }, NOW);
    expect(piton).toContain("<title>Piton de la Fournaise : « Vigilance » selon pitonlive.com · 974</title>");
    expect(piton).toContain("<h1>Piton de la Fournaise : « Vigilance » selon pitonlive.com</h1>");
    expect(piton).toContain("Niveau du dispositif ORSEC volcan : « Vigilance » selon pitonlive.com.");
    // The plan's words for « Vigilance » stay in the list of its levels, not on pitonlive's level.
    expect(piton).toContain(`Niveau du dispositif ORSEC volcan : « Vigilance » selon pitonlive.com. Dernière éruption`);
    const prefecture = volcanPage(O, { value: await answer(VIGILANCE), fetchedAt: NOW, stale: false }, NOW);
    expect(prefecture).toContain("<title>Piton de la Fournaise : Vigilance volcanique · 974</title>");
    expect(prefecture).toContain("<h1>Piton de la Fournaise : vigilance, activité persistante et continue sous le massif</h1>");
    expect(prefecture).toContain("Niveau du dispositif ORSEC volcan : <b>Vigilance</b>");
  });
});
