import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import type { Info } from "../src/providers/actualites.js";
import { parse } from "../src/providers/seismes.js";
import { activityPosts, enclosWords, phaseOf } from "../src/providers/volcan.js";
import { buildVolcan, type TraficAnswer, type VolcanAnswer } from "../src/web/data.js";
import { traficPage, volcanLive, volcanPage } from "../src/web/domains.js";
import { demos, homePage, type HomeLive } from "../src/web/home.js";

// Out of an alert: the prefecture's phase of May kept, or its release of 20/10 back in vigilance; pitonlive at
// « Vigilance », its Enclos « partiel », never said (the user, 25/10/2026).
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

describe("out of an alert, whether it erupts only with the official texts", () => {
  it("says « pas d'éruption » only as not announced in the texts read, never on pitonlive's word, everywhere", async () => {
    for (const phase of [null, VIGILANCE]) {
      const v = await answer(phase);
      const copy = { value: v, fetchedAt: NOW, stale: false };
      const page = volcanPage(O, copy, NOW);
      const tile = volcanLive(copy)!;
      const texts = [
        seen(page),
        seen(homePage(O, { volcan: copy } as unknown as HomeLive, NOW)),
        demos({ volcan: copy } as unknown as HomeLive, NOW).find((d) => d.call === "volcan_seismes()")!.answer.replace(/&#39;/g, "'"),
        // The tile's value and its line together, as in its link.
        `${tile.valeur} ${tile.detail}`,
        v.resume,
      ];
      const all = texts.flatMap(claims);
      expect(all.length).toBeGreaterThan(3);
      for (const c of all) expect(c).toMatch(/^pas d'éruption annoncée/i);
      expect(v.resume.startsWith("L'OVPF et la préfecture n'ont pas annoncé d'éruption dans les textes que nous avons lus.")).toBe(true);
      // The footer's credit left out: pitonlive.com is said nowhere else, not even for the last eruption (the OVPF's).
      const rest = texts.join(" ").replace(/en dernier recours pitonlive\.com \(site non officiel\)/g, "");
      expect(rest).not.toMatch(/pitonlive|« partiel »|2026-627/);
    }
  });

  it("describes /volcan and heads it in marketing's words", async () => {
    const page = volcanPage(O, { value: await answer(), fetchedAt: NOW, stale: false }, NOW);
    // Timeless: a search engine keeps it for days.
    expect(page).toContain(`<meta name="description" content="Piton de la Fournaise en direct : niveau d&#39;alerte d&#39;après la préfecture, publications de l&#39;OVPF, accès à l&#39;Enclos, séismes localisés sous le volcan. · 974">`);
    expect(page).toContain("<title>Piton de la Fournaise : vigilance, pas d&#39;éruption annoncée · 974</title>");
    expect(page).toContain("<h1>Piton de la Fournaise : vigilance, pas d&#39;éruption annoncée</h1>");
    expect(page).toContain("Niveau du dispositif ORSEC volcan : <b>Vigilance</b>.");
    expect(page).not.toContain('<p class="big">');
  });

  it("gives the tile and the home page's answer as what the texts read say, with when", async () => {
    const v = await answer(VIGILANCE);
    const copy = { value: v, fetchedAt: NOW, stale: false };
    expect(volcanLive(copy)).toEqual({
      valeur: "Pas d'éruption annoncée",
      detail: expect.stringMatching(/^OVPF et préfecture, textes lus à 18:00 · Enclos : « réouverture partielle » \(préfecture, 20\/10\) · \d+ séismes? localisés? par l'OVPF sous le volcan en 7 jours$/),
      source: "OVPF et préfecture, textes lus à 18:00",
    });
    const home = homePage(O, { volcan: copy } as unknown as HomeLive, NOW);
    expect(home).toContain(`<p class="tv">Pas d'éruption annoncée</p><p class="td">OVPF et préfecture, textes lus à 18:00 · `);
    const demo = demos({ volcan: copy } as unknown as HomeLive, NOW).find((d) => d.call === "volcan_seismes()")!.answer.replace(/&#39;/g, "'");
    expect(demo.startsWith("Pas d'éruption annoncée par l'OVPF ni par la préfecture dans les textes que nous avons lus (18:00). Niveau ORSEC : Vigilance.")).toBe(true);
  });
});

describe("the Enclos, as the official texts say it", () => {
  const copyOf = (v: VolcanAnswer) => ({ value: v, fetchedAt: NOW, stale: false });
  const trafic = (v: VolcanAnswer) => traficPage(O, { value: { enclos: v.etat!.acces_enclos, bus: null, routes_forestieres: null, sources: [] } as unknown as TraficAnswer, fetchedAt: NOW }, NOW);

  it("takes the words of the release's title as written, or none", () => {
    expect(enclosWords("Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos")).toBe("réouverture partielle");
    expect(enclosWords("Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos")).toBe("fermeture");
    expect(enclosWords("Piton de la Fournaise : retour en vigilance")).toBeUndefined();
  });

  it("says an alert's release in its own word, never « interdit » it does not say, to the AI; /trafic in short", async () => {
    const v = await answer(release("Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", "2026-10-23T08:00:00.000Z"));
    expect(v.resume).toContain("Accès à l'Enclos : « fermeture » selon le communiqué de la préfecture du 23/10.");
    expect(v.resume).not.toContain("interdit selon le communiqué");
    // The short form: forbidden, the release's day (marketing).
    expect(trafic(v)).toContain(`<h3>Volcan : accès à l'Enclos</h3><p><b>Interdit</b> (préfecture, 23/10). <a href="/volcan#monter">Puis-je monter au volcan ? →</a></p></div>`);
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
    expect(v.resume).toContain("Niveau : alerte 2-1 selon le communiqué de la préfecture du 23/10. Accès à l'Enclos interdit à ce niveau du dispositif ORSEC Volcan.");
    expect(trafic(v)).toContain("<p><b>Interdit</b> (préfecture, 23/10).");
    expect(v.resume).not.toMatch(/interdit selon le communiqué|pitonlive\.com \(source/);
  });

  it("credits the release of 20/10 with its own words everywhere, and never pitonlive", async () => {
    const v = await answer(VIGILANCE);
    const link = `<a href="https://www.reunion.gouv.fr/x">communiqué de la préfecture du 20/10</a>`;
    const page = volcanPage(O, copyOf(v), NOW);
    expect(page).toContain(`<p class="lead">Enclos : <b>« réouverture partielle »</b> selon le ${link}.</p>`);
    expect(page).toContain(`<h3>Accès à l&#39;Enclos</h3><p>Enclos : <b>« réouverture partielle »</b> selon le ${link}.</p></div>`);
    expect(trafic(v)).toContain("<p><b>« réouverture partielle »</b> (préfecture, 20/10).");
    // The last eruption, the OVPF's dates (cam-change 251).
    expect(page).toContain(`Dernière éruption : <b>du 13 février au 12 avril 2026</b>, selon l'<a href="https://bsky.app/profile/ovpf.bsky.social/post/3mjdrynd4ns2g" rel="noopener">OVPF</a>.`);
    expect(v.resume).toContain("Accès à l'Enclos : « réouverture partielle » selon le communiqué de la préfecture du 20/10.");
    for (const t of [page, trafic(v), v.resume, volcanLive(copyOf(v))!.detail]) expect(t.replace(/<footer[\s\S]*<\/footer>|<p class="note">Sources : [\s\S]*?<\/p>/g, "")).not.toMatch(/pitonlive|« partiel »|partiellement ouvert/);
  });

  it("says the plan's rule in vigilance when the release's title says nothing of the Enclos, never pitonlive's word", async () => {
    const v = await answer(release("Piton de la Fournaise : retour en vigilance", "2026-10-20T08:00:00.000Z"));
    expect(v.etat!.acces_enclos).toEqual({ vigilance: true });
    const rule = "En vigilance, « l'accès du public non-accompagné est restreint aux seuls sentiers balisés et ouverts » (dispositif ORSEC Volcan, p. 23).";
    expect(v.resume).toContain(rule);
    const page = volcanPage(O, copyOf(v), NOW);
    expect(page).toContain(`<h3>Accès à l&#39;Enclos</h3><p>${rule.replace(/'/g, "&#39;")}</p><p class="note"><a href="#monter">Puis-je monter au volcan ? →</a></p>`);
    expect(trafic(v)).toContain("<p><b>Sentiers balisés seulement</b> (plan ORSEC, en vigilance).");
    expect(volcanLive(copyOf(v))!.detail).toContain("Enclos : Sentiers balisés seulement (plan ORSEC, en vigilance)");
    for (const t of [page, v.resume]) expect(t).not.toMatch(/« partiel »|2026-627|Résumé de pitonlive/);
  });

  it("says on /trafic that the OVPF publishes the level, the prefect setting it (marketing)", async () => {
    const v = await answer(VIGILANCE);
    v.etat!.acces_enclos = { ovpf: { niveau: "Alerte 1", date: "25/10 08:00 heure de La Réunion", lien: "https://bsky.app/x" } };
    expect(trafic(v).replace(/&#39;/g, "'")).toContain("<p><b>Interdit</b> (plan ORSEC en alerte 1, niveau publié par l'OVPF).");
  });

  it("says the Enclos is to check when no official text says it", async () => {
    const v = await answer(release("Piton de la Fournaise : vigilance renforcée", "2026-10-20T08:00:00.000Z"));
    expect(v.etat!.acces_enclos).toBeUndefined();
    expect(volcanPage(O, copyOf(v), NOW)).toContain(`<h3>Accès à l&#39;Enclos</h3><p>Accès à l'Enclos : à vérifier sur <a href="https://www.reunion.gouv.fr/Actualites/Communiques-de-presse">reunion.gouv.fr</a>, avant de partir.</p>`);
    expect(trafic({ ...v, etat: { ...v.etat!, acces_enclos: {} } })).toContain("<p><b>À vérifier</b> (reunion.gouv.fr).");
  });
});
