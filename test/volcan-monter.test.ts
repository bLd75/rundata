import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import type { Info } from "../src/providers/actualites.js";
import { parse } from "../src/providers/seismes.js";
import type { Carte } from "../src/providers/sentiers.js";
import { activityPosts, phaseOf, releaseSentences } from "../src/providers/volcan.js";
import { acces, definition, lineText } from "../src/tools/volcan-acces.js";
import { buildVolcan } from "../src/web/data.js";
import { tracePage, volcanPage } from "../src/web/domains.js";

// The prefecture's release of 24/10/2026, its page as captured: alert 1, the Enclos closed, the RN 2 open.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const PAGE = fixture("actualites/prefecture-alerte1-enclos.html");
const LIEN = "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Piton-de-la-Fournaise-passage-en-alerte-1-fermeture-de-l-enclos5";
const NOW = new Date("2026-10-24T16:30:00Z");
const ALERT_1 = phaseOf([
  { titre: "Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", lien: LIEN, publie: new Date("2026-10-24T12:00:00+04:00").toISOString() } as unknown as Info,
])!;
const ENCLOS = "« L'accès du public à l’ensemble de l'enclos du piton de la Fournaise (partie haute, partie basse, grandes pentes), que ce soit depuis le sentier du Pas de Bellecombe ou depuis tout autre sentier, est interdit jusqu’à nouvel ordre »";

/** The ONF's map as read at 20:10, La Réunion's time: the forest road allowed, one trail of the sector closed. */
const carte = (closed = ["Sentier du Cratère Commerson"], road = "Circulation autorisé") => ({
  value: {
    sentiers: [
      ...closed.map((nom) => ({ nom, statut: "fermé" as const, longueur_km: 1, points: [] })),
      { nom: "Sentier du Cratère Dolomieu", statut: "fermé" as const, longueur_km: 1, points: [] },
      { nom: "Chalet des Pâtres - Plaine des Sables", statut: "ouvert" as const, longueur_km: 1, points: [] },
    ],
    routes: [{ nom: "Route Forestière du Volcan (RF05) de Piton Sec au Pas des Sables", circulation: road, longueur_km: 1, points: [] }],
    mise_a_jour: "2026-10-24T13:00:00.000Z",
  } satisfies Carte,
  fetchedAt: new Date("2026-10-24T16:10:00Z"),
  stale: false,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("« Puis-je monter au volcan ? »", () => {
  it("reads the release's sentences as written, the words split by markup joined again", () => {
    const s = releaseSentences(PAGE);
    expect(s).toContain("La RN 2 reste ouverte à la circulation.");
    expect(s).toContain("En conséquence, l'accès du public à l’ensemble de l'enclos du piton de la Fournaise (partie haute, partie basse, grandes pentes), que ce soit depuis le sentier du Pas de Bellecombe ou depuis tout autre sentier, est interdit jusqu’à nouvel ordre.");
    expect(s.join(" ")).toContain("« éruption probable ou imminente » du dispositif spécifique ORSEC Volcan");
    expect(s.some((x) => /Mis à jour|Partager|Plan du site/.test(x))).toBe(false);
  });

  it("never makes a tag again: the tags dropped one character at a time, the entities decoded once, scripts left out", () => {
    const page = `<h1>Titre</h1><p>Accès &amp;lt;script&amp;gt; à l&#039;enclos &lt;b&gt; interdit.</p><script>var a = "<p>x</p>";</script><p>La <scr<i>ipt>RN 2 reste ouverte.<br>Fin</p><style>p{}</style><p>Suite</p><script>sans fin <p>Perdu</p>`;
    expect(releaseSentences(page)).toEqual(["Accès &lt;script&gt; à l'enclos &lt;b&gt; interdit.", "La iptRN 2 reste ouverte.", "Fin", "Suite"]);
  });

  it("says each place as the texts do in alert 1, never « ouverte » by deduction", () => {
    const m = acces("Alerte 1", ALERT_1, releaseSentences(PAGE), carte());
    expect(m.lignes.map(lineText)).toEqual([
      `Enclos : interdit. ${ENCLOS} (communiqué de la préfecture du 24/10 : ${LIEN}).`,
      `RN 2 (Grand Brûlé) : « La RN 2 reste ouverte à la circulation » (même communiqué : ${LIEN}).`,
      "Route du volcan (route forestière depuis Bourg-Murat) : le communiqué n'en dit rien, et l'ONF ne la signale pas fermée (carte lue à 20:10).",
      "Pas de Bellecombe et points de vue : le communiqué ne les nomme que comme départ du sentier de l'Enclos, qui est interdit.",
      // Dolomieu is the Enclos' own: told by its line, not here.
      "Sentiers hors Enclos (Plaine des Sables, Piton Chisny, Nez Coupé de Sainte-Rose…) : Sentier du Cratère Commerson fermé selon l'ONF (24/10). https://rundata.re/sentiers",
    ]);
    expect(m.pied).toBe("Les interdictions peuvent changer à tout moment : seuls font foi les communiqués de la préfecture.");
    const all = m.lignes.map(lineText).join(" ");
    expect(all).not.toMatch(/\bouverte?\b(?! à la circulation)/);
  });

  it("says the road closed when the ONF does, the trails when none is closed, and what to check without the map", () => {
    const closed = acces("Alerte 1", ALERT_1, releaseSentences(PAGE), carte([], "Circulation interdite"));
    expect(closed.lignes.map(lineText)).toContain("Route du volcan (route forestière depuis Bourg-Murat) : le communiqué n'en dit rien. Fermée selon l'ONF (carte lue à 20:10).");
    expect(closed.lignes.map(lineText).at(-1)).toBe("Sentiers hors Enclos (Plaine des Sables, Piton Chisny, Nez Coupé de Sainte-Rose…) : l'ONF ne signale pas de fermeture dans le secteur du volcan (24/10). https://rundata.re/sentiers");
    const blind = acces("Alerte 1", ALERT_1, undefined, undefined);
    expect(blind.lignes.map(lineText)).toEqual([
      `Enclos : interdit (communiqué de la préfecture du 24/10 : ${LIEN}).`,
      "Le dernier communiqué ne dit rien de la RN 2 : vérifiez sur reunion.gouv.fr.",
      "Route du volcan (route forestière depuis Bourg-Murat) : le communiqué n'en dit rien. Vérifiez sur reunion.gouv.fr.",
      "Pas de Bellecombe et points de vue : le communiqué n'en dit rien. Vérifiez sur reunion.gouv.fr.",
    ]);
  });

  it("follows the level: the plan's words in vigilance and sauvegarde, nothing but « check » when the level is not read", () => {
    const vigilance = acces("Vigilance", undefined, undefined, carte());
    expect(lineText(vigilance.lignes[0])).toBe("Partie haute de l'Enclos : « l'accès du public non-accompagné est restreint aux seuls sentiers balisés et ouverts » (dispositif ORSEC Volcan, p. 23).");
    const over = phaseOf([{ titre: "Piton de la Fournaise : fin de l'éruption, passage en phase de sauvegarde", lien: LIEN, publie: "2026-11-02T08:00:00.000Z" } as unknown as Info])!;
    expect(lineText(acces("Sauvegarde", over, undefined, undefined).lignes[0])).toBe(
      `Enclos : en phase de sauvegarde, « une réouverture partielle de l'enclos est possible » (dispositif ORSEC Volcan, p. 22). Ce qui est ouvert est dans le communiqué de la préfecture du 02/11. ${LIEN}`,
    );
    // An eruption: what the plan provides for the road, after the road's line; never before alert 2.
    const eruption = acces("Alerte 2-1", ALERT_1, releaseSentences(PAGE), carte()).lignes.map(lineText);
    expect(eruption[3]).toBe("Pendant une éruption, en cas d'affluence, le plan de la préfecture prévoit que la route du volcan puisse être fermée depuis Bourg-Murat, ou son accès filtré (dispositif ORSEC Volcan, p. 34).");
    expect(eruption[2]).toMatch(/^Route du volcan \(route forestière/);
    expect(acces("Alerte 1", ALERT_1, releaseSentences(PAGE), carte()).lignes.map(lineText).join(" ")).not.toContain("p. 34");
    expect(lineText(acces(undefined, undefined, undefined, undefined).lignes[0])).toBe("Nous n'avons pas pu lire le dernier communiqué de la préfecture : vérifiez sur reunion.gouv.fr avant de monter au volcan.");
  });

  it("quotes in an eruption the bans the release shown writes, exactly, as the same release, and nothing of ours", () => {
    // The prefecture's reminder of 25/07/2023, during the eruption of July (alert 2-1).
    const page = fixture("actualites/prefecture-eruption-rappel-2023-07-25.html");
    const lien = "https://www.reunion.gouv.fr/Actualites/Urgences/Eruption-le-prefet-rappelle-qu-il-est-interdit-et-dangereux-de-tenter-d-acceder-aux-coulees-de-lave";
    const juillet = phaseOf([{ titre: "Piton de la Fournaise : passage en alerte 2-1", lien, publie: "2023-07-25T08:00:00+04:00" } as unknown as Info])!;
    const said = releaseSentences(page);
    const lines = acces("Alerte 2-1", juillet, said, undefined).lignes;
    expect(lines.map(lineText).slice(0, 4)).toEqual([
      `Enclos : interdit. « L'accès du public à l’ensemble de l'enclos du piton de la Fournaise (partie haute, partie basse, grandes pentes), que ce soit depuis le sentier du Pas de Bellecombe, depuis les anciennes coulées de lave aux abords de la RN2 ou depuis tout autre sentier, reste interdit jusqu’à nouvel ordre » (communiqué de la préfecture du 25/07 : ${lien}).`,
      // The sentence that says whether the road is open, its list's arrow left out.
      `RN 2 (Grand Brûlé) : « A ce stade, la RN 2 reste ouverte à la circulation, mais il est interdit de s’écarter de la route et d’accéder aux coulées de la lave depuis la route » (même communiqué : ${lien}).`,
      `« S’aventurer depuis la RN2 sur les pentes du volcan exposerait à un danger mortel. » (même communiqué : ${lien}).`,
      `« Il est également demandé d’éviter les arrêts intempestifs sur la RN2 et ses abords risquant de produire des accidents ou des problématiques de circulation. » (même communiqué : ${lien}).`,
    ]);
    // Each ban as the release writes it, its spelling kept (« RN2 »).
    for (const l of lines.filter((x) => x.lieu === "Interdiction")) expect(said).toContain(l.texte.slice(2, -2));
    expect(lines.map(lineText).join(" ")).not.toMatch(/prudent|restez|soyez/i);
    // Not in alert 1, nor when the release shown writes none of them (24/10/2026: the Enclos only, already quoted).
    expect(acces("Alerte 1", juillet, said, undefined).lignes.some((x) => x.lieu === "Interdiction")).toBe(false);
    expect(acces("Alerte 2-1", ALERT_1, releaseSentences(PAGE), undefined).lignes.some((x) => x.lieu === "Interdiction")).toBe(false);
  });

  it("defines the level with the plan's words and page", () => {
    expect(definition("Alerte 1")).toBe("Alerte 1 : « éruption probable ou imminente » (dispositif ORSEC Volcan, arrêté n° 2242 du 08/11/2021, p. 22).");
    expect(definition("Vigilance renforcée")).toBeUndefined();
  });
});

describe("« Puis-je monter au volcan ? » in the answer and on /volcan", () => {
  function isolate(durable: MemoryStore) {
    const store = new MemoryStore();
    const t = NOW.getTime();
    void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
    void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky.json"))), fetchedAt: t });
    void store.put("volcan:pitonlive", { value: JSON.parse(fixture("pitonlive_state.json")), fetchedAt: t });
    void store.put("volcan:prefecture", { value: ALERT_1, fetchedAt: t });
    void store.put("onf:sentiers", { value: carte().value, fetchedAt: carte().fetchedAt.getTime() });
    return new Cache(store, () => t, true, durable);
  }

  it("reads the release's page once, logs what it read, keeps it, and says it on the page", async () => {
    const pages: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      pages.push(String(url));
      return new Response(PAGE);
    });
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const durable = new MemoryStore();
    const v = await buildVolcan(isolate(durable), NOW);
    expect(pages).toEqual([LIEN]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining(`volcan : communiqué lu (${LIEN}) : 12 phrases : « Éruption probable à brève échéance »`));
    expect(v.resume).toContain("Niveau du dispositif ORSEC volcan : Alerte 1. Définition : Alerte 1 : « éruption probable ou imminente » (dispositif ORSEC Volcan, arrêté n° 2242 du 08/11/2021, p. 22). Puis-je monter au volcan ? Enclos : interdit.");
    expect(v.etat?.niveau_definition).toBe("Alerte 1 : « éruption probable ou imminente » (dispositif ORSEC Volcan, arrêté n° 2242 du 08/11/2021, p. 22).");
    expect(v.puis_je_monter?.lignes[1]).toEqual({ lieu: "RN 2", texte: "RN 2 (Grand Brûlé) : « La RN 2 reste ouverte à la circulation »", source: "même communiqué", lien: LIEN });
    await new Promise((r) => setTimeout(r, 0));
    expect((await durable.get("volcan:prefecture:derniere-phase"))?.value).toMatchObject({ lien: LIEN, phrases: expect.arrayContaining(["La RN 2 reste ouverte à la circulation."]) });

    const html = volcanPage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain(`<h2 id="h-monter">Puis-je monter au volcan ?</h2><p>Ce que disent les textes officiels, lieu par lieu.</p>`);
    // A non-breaking space before our colon, none put inside the quote.
    expect(html).toContain(`<li>RN 2 (Grand Brûlé)\u00a0: « La RN 2 reste ouverte à la circulation » (<a href="${LIEN}">même communiqué →</a>).</li>`);
    expect(html).toContain("<summary>Les niveaux du dispositif</summary>");
    expect(html).toContain("<small>Version de 2021, la dernière que nous ayons lue.</small>");
    expect(html.indexOf('id="h-monter"')).toBeLessThan(html.indexOf('id="h-volcan"'));

    // Another isolate, the prefecture's page down: the sentences kept with the phase.
    vi.stubGlobal("fetch", async () => {
      throw new Error("timeout");
    });
    const again = await buildVolcan(isolate(durable), NOW);
    expect(again.puis_je_monter?.lignes[0].texte).toContain(ENCLOS);
  });

  it("links the volcano's trails to it, and no other", () => {
    const page = (slug: string, nom: string) => tracePage("https://rundata.re", "sentier", slug, nom, null, NOW);
    expect(page("sentier-du-cratere-commerson", "Sentier du Cratère Commerson")).toContain(`<a href="/volcan#monter">Puis-je monter au volcan ? Ce que disent les textes officiels, lieu par lieu →</a>`);
    expect(page("le-bloc-piton-des-neiges", "Le Bloc - Piton des Neiges")).not.toContain("/volcan#monter");
  });
});
