import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import type { Info } from "../src/providers/actualites.js";
import { parse } from "../src/providers/seismes.js";
import { activityPosts, enclosWords, phaseOf } from "../src/providers/volcan.js";
import { buildVolcan, type TraficAnswer, type VolcanAnswer } from "../src/web/data.js";
import { traficPage, volcanLive, volcanPage } from "../src/web/domains.js";
import { demos, homePage, type HomeLive } from "../src/web/home.js";

// Out of an alert: pitonlive at « Vigilance », the Enclos « partiel » as the prefecture's decree of 7 May says it, and
// the prefecture's phase of May kept, older than pitonlive's status, or its release of 20/10 back in vigilance.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-23T14:00:00Z");
const O = "https://rundata.re";
const MAY = phaseOf([{ titre: "Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos", lien: "https://www.reunion.gouv.fr/x", publie: "2026-05-07T08:00:00.000Z" } as unknown as Info]);
const release = (titre: string, publie: string) => phaseOf([{ titre, lien: "https://www.reunion.gouv.fr/x", publie } as unknown as Info])!;
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

/** What a reader sees of some HTML: its style and script blocks cut out, every tag out, the entities read. */
function seen(html: string): string {
  const low = html.toLowerCase();
  let text = "";
  for (let at = 0; at < html.length; ) {
    const next = (["style", "script"] as const)
      .map((name) => ({ name, start: low.indexOf(`<${name}`, at) }))
      .filter((b) => b.start >= 0)
      .sort((a, b) => a.start - b.start)[0];
    text += html.slice(at, next?.start ?? html.length);
    if (!next) break;
    const end = low.indexOf(`</${next.name}`, next.start);
    at = end < 0 ? html.length : low.indexOf(">", end) + 1 || html.length;
  }
  // Until nothing changes: a tag left by taking out another is taken out too.
  for (let before = ""; before !== text; ) {
    before = text;
    text = text.replace(/<[^>]*>/g, "");
  }
  return text.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/ /g, " ");
}

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
    expect(page).toContain(`<meta name="description" content="Piton de la Fournaise (974) : pas d&#39;éruption en cours selon pitonlive.com. Niveau ORSEC, accès à l&#39;Enclos et séismes localisés par l&#39;OVPF, en direct.">`);
    expect(page).toContain(`<p class="big">Pas d'éruption en cours selon pitonlive.com</p>`);
  });

  it("quotes pitonlive's word for the Enclos, never read as « ouvert », with the source it names", async () => {
    const v = await answer();
    const page = volcanPage(O, { value: v, fetchedAt: NOW, stale: false }, NOW);
    const source = `(source : <a href="https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Piton-de-la-Fournaise-reouverture-partielle-de-l-enclos">Préfecture de La Réunion, arrêté n° 2026-627 du 7 mai 2026</a>)`;
    expect(page).toContain(`Enclos : <b>« partiel »</b> selon pitonlive.com ${source}.`);
    expect(page).toContain("<h3>Enclos : « partiel » selon pitonlive.com</h3>");
    // Under it, pitonlive's summary whole, in quotes: its words. /trafic gives pitonlive's word alone and sends to this card.
    const trafic = traficPage(O, { value: { enclos: v.etat!.acces_enclos, bus: null, routes_forestieres: null, sources: [] } as unknown as TraficAnswer, fetchedAt: NOW }, NOW);
    expect(trafic).toContain(`<h3>Volcan : accès à l'Enclos</h3><p><b>« partiel »</b> selon pitonlive.com. Les sentiers autorisés et interdits, avec l'arrêté de la préfecture, sont sur <a href="/volcan#enclos">la page Volcan</a>.</p></div>`);
    expect(trafic).not.toContain("Réouverture PARTIELLE");
    expect(page).toContain(`<div class="card" id="enclos">`);
    expect(page).toContain("<p>Résumé de pitonlive.com : « Réouverture PARTIELLE de l&#39;enclos (retour en phase de vigilance ORSEC depuis le 7 mai 2026).");
    expect(page).not.toContain("partiellement ouvert");
    expect(volcanLive({ value: v, fetchedAt: NOW, stale: false })).toEqual({
      valeur: "Pas d'éruption",
      detail: expect.stringMatching(/^selon pitonlive\.com · Enclos « partiel » · \d+ séismes? localisés? par l'OVPF sous le volcan en 7 jours$/),
      source: "selon pitonlive.com",
    });
    // On the home page, out of an alert the volcano is a tile, not in the hero: its source opens the line under it.
    const home = homePage(O, { volcan: { value: v, fetchedAt: NOW, stale: false } } as unknown as HomeLive, NOW);
    expect(home).toContain(`<p class="tv">Pas d'éruption</p><p class="td">selon pitonlive.com · Enclos « partiel » · `);
    expect(home).not.toContain("<b>Pas d'éruption</b>");
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

describe("the Enclos, as its source says it", () => {
  const copyOf = (v: VolcanAnswer) => ({ value: v, fetchedAt: NOW, stale: false });
  const trafic = (v: VolcanAnswer) => traficPage(O, { value: { enclos: v.etat!.acces_enclos, bus: null, routes_forestieres: null, sources: [] } as unknown as TraficAnswer, fetchedAt: NOW }, NOW);
  // Each text that says the Enclos: /volcan's line and card title, the tile, /trafic's card, the AI's answer and its box
  // (out of an alert, the plan's words on the upper Enclos).
  const said = (v: VolcanAnswer) => {
    const page = volcanPage(O, copyOf(v), NOW);
    return [
      page.match(/<p class="lead">(?:Accès à l'Enclos|Enclos)[^\n]*?<\/p>/)![0],
      page.match(/<h3>Enclos[^<]*<\/h3>/)![0],
      volcanLive(copyOf(v))!.detail,
      trafic(v).match(/<h3>Volcan : accès à l'Enclos<\/h3><p>.*?<\/p>/)![0],
      v.resume.match(/Accès à l'Enclos[^.]*\./)![0],
      v.puis_je_monter!.lignes.find((l) => l.lieu === "Enclos")!.texte,
    ];
  };

  it("takes the words of the release's title as written, or none", () => {
    expect(enclosWords("Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos")).toBe("réouverture partielle");
    expect(enclosWords("Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos")).toBe("fermeture");
    expect(enclosWords("Piton de la Fournaise : retour en vigilance")).toBeUndefined();
  });

  it("says an alert's release in its own word, never « interdit » it does not say, to the AI and on /trafic", async () => {
    const v = await answer(release("Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", "2026-10-23T08:00:00.000Z"));
    const link = `<a href="https://www.reunion.gouv.fr/x">communiqué de la préfecture du 23/10</a>`;
    expect(v.resume).toContain("Accès à l'Enclos : « fermeture » selon le communiqué de la préfecture du 23/10.");
    expect(trafic(v)).toContain(`<p>Accès à l'Enclos : <b>« fermeture »</b> selon le ${link}</p>`);
    for (const t of [v.resume, trafic(v)]) expect(t.replace(/<\/?b>/g, "")).not.toContain("interdit selon le communiqué");
    // What the alert's level says, with its own attribution: unchanged.
    expect(volcanPage(O, copyOf(v), NOW)).toContain("<h3>Accès à l&#39;Enclos interdit.</h3>");
    expect(v.puis_je_monter!.lignes.find((l) => l.lieu === "Enclos")!.texte).toMatch(/^Enclos : interdit\b/);
  });

  it("says « interdit » of the release when its title says it", async () => {
    const v = await answer(release("Piton de la Fournaise : passage en alerte 1, accès à l'enclos interdit", "2026-10-23T08:00:00.000Z"));
    expect(v.resume).toContain("Accès à l'Enclos : « interdit » selon le communiqué de la préfecture du 23/10.");
  });

  it("says an alert whose title says nothing of the Enclos as the level's ban, not the release's words", async () => {
    const v = await answer(release("Piton de la Fournaise : passage en alerte 2-1", "2026-10-23T08:00:00.000Z"));
    const link = `<a href="https://www.reunion.gouv.fr/x">communiqué de la préfecture du 23/10</a>`;
    expect(v.resume).toContain("Niveau : alerte 2-1 selon le communiqué de la préfecture du 23/10. Accès à l'Enclos interdit à ce niveau du dispositif ORSEC Volcan.");
    expect(trafic(v)).toContain(`<p>Alerte 2-1 selon le ${link} : accès à l'Enclos <b>interdit</b> à ce niveau (dispositif ORSEC Volcan)</p>`);
    for (const t of [v.resume, trafic(v)]) expect(t.replace(/<\/?b>/g, "")).not.toMatch(/interdit selon le communiqué/);
    expect(v.resume).not.toMatch(/pitonlive\.com \(source/);
  });

  it("credits the release of 20/10 with its own words everywhere, and never pitonlive", async () => {
    const v = await answer(VIGILANCE);
    const link = `<a href="https://www.reunion.gouv.fr/x">communiqué de la préfecture du 20/10</a>`;
    const page = volcanPage(O, copyOf(v), NOW);
    expect(page).toContain(`<p class="lead">Enclos : <b>« réouverture partielle »</b> selon le ${link}.</p>`);
    expect(page).toContain("<h3>Enclos : « réouverture partielle » selon le communiqué du 20/10</h3>");
    expect(volcanLive(copyOf(v))!.detail).toMatch(/^selon pitonlive\.com · Enclos « réouverture partielle » selon la préfecture · \d+ séismes? /);
    expect(trafic(v)).toContain(`<p>Accès à l'Enclos : <b>« réouverture partielle »</b> selon le ${link}</p>`);
    expect(v.resume).toContain("Accès à l'Enclos : « réouverture partielle » selon le communiqué de la préfecture du 20/10.");
    for (const t of said(v)) {
      // The tile says the eruption on pitonlive's word first, then the Enclos on the release's.
      expect(t.replace(/^selon pitonlive\.com · /, "")).not.toMatch(/pitonlive|« partiel »|partiellement ouvert/);
    }
  });

  it("says the release of 10/10 above pitonlive for long in its words, to check before going up", async () => {
    const v = await answer(release("Piton de la Fournaise : vigilance renforcée, réouverture partielle de l'enclos", "2026-10-10T08:00:00.000Z"));
    expect(v.resume).toContain("Accès à l'Enclos : « réouverture partielle » selon le communiqué du 10/10 : vérifiez sur reunion.gouv.fr avant de monter.");
    expect(volcanPage(O, copyOf(v), NOW)).toMatch(/<p class="lead">Accès à l'Enclos : <b>« réouverture partielle »<\/b> selon le communiqué du 10\/10 : vérifiez sur <a [^>]*>reunion\.gouv\.fr<\/a> avant de monter\.<\/p>/);
  });

  it("keeps pitonlive's word, as pitonlive's, when the release's title says nothing of the Enclos", async () => {
    const v = await answer(release("Piton de la Fournaise : retour en vigilance", "2026-10-20T08:00:00.000Z"));
    expect(v.etat!.acces_enclos!.communique).toBeUndefined();
    const page = volcanPage(O, copyOf(v), NOW);
    expect(page).toContain("Enclos : <b>« partiel »</b> selon pitonlive.com (source : ");
    expect(page).toContain("<h3>Enclos : « partiel » selon pitonlive.com</h3>");
    expect(v.resume).toContain("Accès à l'Enclos : « partiel » selon pitonlive.com (source : Préfecture de La Réunion, arrêté n°\u00a02026-627 du 7 mai 2026).");
    for (const t of said(v)) expect(t).not.toContain("partiellement ouvert");
  });
});
