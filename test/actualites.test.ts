import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { firstSentence, merge, parseImazLive, parseNewsSitemap, parsePrefecture, parseQuotidien, parseRss, placesIn, type Info } from "../src/providers/actualites.js";
import { actualites, quand } from "../src/tools/actualites.js";
import { actualitesPage } from "../src/web/domains.js";
import { buildActualites } from "../src/web/data.js";

// Saturday 24/10/2026 at 12:05 in La Réunion, the morning of a day of mobilisation (gilets jaunes, « vie chère »): Imaz
// Press runs a live blog, the prefecture has published its report of the night.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/actualites/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T08:05:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());

function file(url: string): string | undefined {
  if (new URL(url).hostname === "www.lequotidien.re") return "quotidien.html";
  if (url.includes("clicanoo")) return "clicanoo.xml";
  if (url.includes("imazpress.com/sitemap-news")) return "imaz_news.xml";
  if (url.includes("imazpress.com/selection-de-la-redaction")) return "imaz_live.html";
  if (url.includes("freedom")) return "freedom.xml";
  if (url.includes("parallelesud")) return "parallelesud.xml";
  if (url.includes("temoignages")) return "temoignages.xml";
  if (url.includes("reunion.gouv.fr")) return "prefecture.html";
}

describe("actualités", () => {
  let down: RegExp | undefined;
  let asked: string[];
  beforeEach(() => {
    down = undefined;
    asked = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      asked.push(`${new Headers(init?.headers).get("User-Agent")} ${url}`);
      const f = file(url);
      return f && !down?.test(url) ? new Response(fixture(f)) : new Response("", { status: 503 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("finds the communes a text names, by their places too, and not the common words that look like them", () => {
    expect(placesIn("Barrage filtrant à St-Pierre, au rond-point de Canabady et à la Ravine des Cabris")).toEqual({
      communes: ["Saint-Pierre"],
      lieux: ["Cité Canabady", "La Ravine des Cabris"],
    });
    expect(placesIn("Le Port reste calme ; à Gillot, les vols sont maintenus").communes).toEqual(["Le Port", "Sainte-Marie"]);
    expect(placesIn("Tollé à La Rivière : une micro-crèche incendiée").communes).toEqual(["Saint-Louis"]);
    // Not Le Port, not La Rivière des Galets as La Rivière, not Saint-Pierre-et-Miquelon, not La Source.
    expect(placesIn("le port de commerce, la rivière des Galets en crue, Saint-Pierre-et-Miquelon, à la source").communes).toEqual([]);
    expect(placesIn("SAINT-PAUL : la mairie communique").communes).toEqual(["Saint-Paul"]);
  });

  it("reads the feeds: titles, times with their offset, first sentences, and leaves out a radio's games", () => {
    const freedom = parseRss(fixture("freedom.xml"), "Freedom", /jeux|podcast|actus radio/i);
    expect(freedom.some((i) => /Freedo Quotidien/.test(i.titre))).toBe(false);
    const police = freedom.find((i) => i.titre.startsWith("Manifestations à la Réunion : la police nationale"))!;
    expect(police.publie).toBe("2026-10-24T06:24:56.000Z");
    expect(police.sujets).toContain("mobilisation");
    expect(police.resume!.length).toBeLessThanOrEqual(220);

    const imaz = parseNewsSitemap(fixture("imaz_news.xml"), "Imaz Press", /\/france-monde\//);
    // Imaz Press encodes its titles twice; its France-monde section is left out.
    expect(imaz.find((i) => i.lien.endsWith("plaine-des-palmistes-cise-eau-qualite"))!.titre).toBe("Plaine des Palmistes : la Cise alerte sur la qualité de l'eau, plusieurs citernes installées");
    expect(imaz.some((i) => i.lien.includes("/france-monde/"))).toBe(false);

    const pref = parsePrefecture(fixture("prefecture.html"));
    expect(pref[0]).toMatchObject({ titre: "Violences urbaines : bilan de la nuit", heure: false, lien: "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Violences-urbaines-bilan-de-la-nuit" });
    expect(quand(pref[0], NOW)).toBe("aujourd'hui");
    expect(firstSentence("Dès 6 heures, une convergence des mouvements appelle à la mobilisation. Puis la suite.")).toBe("Dès 6 heures, une convergence des mouvements appelle à la mobilisation.");
  });

  it("reads Le Quotidien's home page: the titles, the day of each, the time only when given to the minute", () => {
    // Its home page on Sunday 25/10/2026 at 15:46 in La Réunion.
    const at = new Date("2026-10-25T11:46:16Z");
    const list = parseQuotidien(fixture("quotidien.html"), at);
    const find = (t: string) => list.find((i) => i.titre.startsWith(t))!;
    // « il y a 41 minutes »: the time.
    expect(find("Saint-André : au Velli, Marie Grondin")).toMatchObject({ media: "Le Quotidien", publie: "2026-10-25T11:05:16.000Z", heure: true, communes: ["Saint-André"] });
    expect(quand(find("Saint-André : au Velli"), at)).toBe("aujourd'hui à 15:05");
    expect(find("Saint-André : au Velli").lien).toBe("https://www.lequotidien.re/article/culture/2026/10/25/saint-andre-au-velli-marie-grondin-fait-vivre-la-cuisine-creole-entre-tradition-et-modernite");
    // « il y a 1 heure », « il y a 22 heures »: the order, the day only.
    expect(find("Facturation électronique à La Réunion")).toMatchObject({ publie: "2026-10-25T10:46:16.000Z", heure: false });
    expect(quand(find("La Rivière des Galets : un enfant de 5 ans"), at)).toBe("hier");
    // No time on the page: the day of its address, at noon.
    expect(find("Braconnage dans la réserve naturelle")).toMatchObject({ publie: "2026-10-23T08:00:00.000Z", heure: false });
    // The whole title, not the one the page cuts, nor its « Article : » label; no France-monde, no readers' letters.
    expect(find("Grand Raid : «Judicaël").titre).toBe("Grand Raid : «Judicaël peut faire encore mieux!»");
    expect(list.some((i) => /^Article\b|\.\.\.$/.test(i.titre))).toBe(false);
    expect(list.some((i) => /national-et-international|courrier-des-lecteurs/.test(i.lien))).toBe(false);
    expect(new Set(list.map((i) => i.lien)).size).toBe(list.length);
  });

  it("reads a live blog, its Paris times turned into La Réunion's, and what each entry says of each commune", () => {
    const live = parseImazLive(fixture("imaz_live.html"), "https://imazpress.com/live", NOW);
    // Stamped 09:33 in Paris: 11:33 in La Réunion, « À 11 heures, une vingtaine de personnes rassemblées ».
    expect(live[0]).toMatchObject({ publie: "2026-10-24T07:33:00.000Z", direct: true, communes: ["Saint-Denis"] });
    expect(quand(live[0], NOW)).toBe("aujourd'hui à 11:33");
    expect(live.some((i) => /^Bonjour/.test(i.titre))).toBe(false);
    const gathering = live.find((i) => i.titre.startsWith("Plusieurs rassemblements annoncés"))!;
    expect(gathering.communes).toEqual(expect.arrayContaining(["Saint-Pierre", "Sainte-Marie", "Le Port", "Sainte-Suzanne"]));
    expect(gathering.extraits!.find((e) => e.communes.includes("Saint-Pierre"))!.texte).toMatch(/Canabady à Saint-Pierre/);
    // After the change of time in Paris (25/10, UTC+1), the same stamp is an hour later in UTC.
    const winter = parseImazLive(fixture("imaz_live.html"), "https://imazpress.com/live", new Date("2026-10-26T09:05:00Z"));
    expect(winter[0].publie).toBe("2026-10-26T08:33:00.000Z");
  });

  it("tells one story once, with the other media that told it", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 24, h)).toISOString();
    const base = { heure: true, communes: [], lieux: [], sujets: [] };
    const list: Info[] = [
      { ...base, titre: "Violences urbaines : 400 policiers et gendarmes mobilisés la nuit dernière", media: "Imaz Press", lien: "a", publie: at(5) },
      { ...base, titre: "Violences urbaines : plus de 400 policiers et gendarmes mobilisés cette nuit", media: "Freedom", lien: "b", publie: at(4) },
      { ...base, titre: "Octobre rose au CHU Nord", media: "Freedom", lien: "c", publie: at(6) },
    ];
    const out = merge(list);
    expect(out.map((i) => i.lien)).toEqual(["c", "b"]);
    expect(out[1].aussi).toEqual([{ media: "Imaz Press", lien: "a" }]);
  });

  it("answers for a commune with what the media say of it, and the live blog of the island", async () => {
    const b = body(await actualites(cache(), "Saint-Pierre", undefined, undefined, NOW));
    expect(b.resume).toMatch(/^\d+ informations des dernières 24 h mentionnent Saint-Pierre\./);
    expect(b.resume).toMatch(/À Saint-Pierre, le Festival Mizik O Marmay est annulé/);
    expect(b.resume).toMatch(/En direct sur l'île, aujourd'hui à 11:33 \(Imaz Press, en direct\)/);
    const canabady = b.en_direct.find((r: { titre: string }) => r.titre.startsWith("Plusieurs rassemblements annoncés"));
    expect(canabady.mentionne_le_lieu).toBe(true);
    expect(canabady.ce_qui_est_dit_du_lieu[0]).toMatch(/zone Canabady à Saint-Pierre/);
    expect(b.prefecture[0].titre).toBe("Violences urbaines : bilan de la nuit");
    // Every medium is read with the site's name; one request each, and the live blog.
    expect(asked.every((a) => a.startsWith("rundata.re (contact@rundata.re) "))).toBe(true);
    expect(asked.length).toBeLessThanOrEqual(12);
    // Le Quotidien: its home page, once.
    expect(asked.filter((a) => a.endsWith(" https://www.lequotidien.re/"))).toHaveLength(1);
  });

  it("says when nothing names a place, without saying nothing happens there", async () => {
    const b = body(await actualites(cache(), "Cilaos", undefined, undefined, NOW));
    expect(b.resume).toMatch(/^Aucune information des médias lus ne mentionne Cilaos depuis hier à 12:05\./);
    expect(b.infos).toEqual([]);
    expect(b.a_savoir).toMatch(/ne prouve pas qu'il ne s'y passe rien/);
  });

  it("gives the fixed speed cameras of the ministry's list with the roads, never the mobile checks", async () => {
    const sp = body(await actualites(cache(), "Saint-Pierre", "route", undefined, NOW));
    expect(sp.radars_fixes.resume).toBe("4 radars fixes à Saint-Pierre dans la liste du ministère de l'Intérieur (90 km/h, 110 km/h).");
    expect(sp.radars_fixes.radars).toHaveLength(4);
    expect(sp.radars_fixes.radars[0]).toMatchObject({ commune: "Saint-Pierre", vitesse_max_kmh: 90, carte: expect.stringMatching(/^https:\/\/www\.openstreetmap\.org\/\?mlat=-21\.\d+&mlon=55\.\d+/) });
    expect(sp.radars_fixes.a_savoir).toBe("Liste des radars fixes publiée par le ministère de l'Intérieur, fichier du 30/12/2025, mise à jour une fois par an : un radar installé depuis, ou absent du fichier, n'y figure pas. Les contrôles mobiles n'y sont pas.");
    expect(sp.sources.map((x: { source: string }) => x.source).join()).toContain("Ministère de l'Intérieur");
    // A commune without one, said as the list says it; the island by commune; nothing on a question that is not about the roads.
    expect(body(await actualites(cache(), "Cilaos", "radar", undefined, NOW)).radars_fixes).toMatchObject({ resume: "Aucun radar fixe à Cilaos dans la liste du ministère de l'Intérieur.", radars: undefined });
    const ile = body(await actualites(cache(), undefined, "circulation", undefined, NOW)).radars_fixes;
    expect([ile.resume, ile.par_commune[0]]).toEqual(["24 radars fixes à La Réunion dans la liste du ministère de l'Intérieur.", { commune: "Saint-Denis", nombre: 6, vitesses_max: ["70 km/h", "90 km/h"] }]);
    expect(body(await actualites(cache(), "Saint-Pierre", undefined, undefined, NOW)).radars_fixes).toBeUndefined();
  });

  it("filters by subject, and answers without the media that fail", async () => {
    down = /clicanoo|freedom/;
    const b = body(await actualites(cache(), undefined, "blocages", undefined, NOW));
    expect(b.resume).toMatch(/^\d+ informations \(manifestations et blocages\) des médias de La Réunion depuis 24 h/);
    expect(b.infos.every((r: { sujets?: string[] }) => r.sujets?.includes("mobilisation"))).toBe(true);
    expect(b.indisponible).toEqual(["Clicanoo", "Freedom"]);
    down = /./;
    expect((await actualites(cache(), undefined, undefined, undefined, NOW)).isError).toBe(true);
  });

  it("says the media that did not answer, and never « aucune information » when none of them answered", async () => {
    down = /^(?!.*reunion\.gouv\.fr)/;
    const b = body(await actualites(cache(), "Saint-Pierre", undefined, undefined, NOW));
    expect(b.resume).not.toMatch(/Aucune information/);
    expect(b.resume).toMatch(/Non lus cette fois : .*Clicanoo.*Freedom.*\. Leur site n'a pas répondu à notre dernière lecture \(aujourd'hui à 12:05\) : nous ne savons pas ce qu'ils annoncent en ce moment\./);
    const html = actualitesPage("https://rundata.re", { value: await buildActualites(cache(), NOW), fetchedAt: NOW, stale: false }, NOW);
    expect(html).not.toContain("Aucune information des médias lus");
    expect(html).toMatch(/Non lus cette fois(\u00a0|&nbsp;| ): [^<]*Clicanoo/);
    expect(html).not.toContain("Ne répondent pas en ce moment");
  });

  it("makes a page of it, with the live blog first", async () => {
    const data = await buildActualites(cache(), NOW);
    expect(data.chaud).toBe(true);
    const html = actualitesPage("https://rundata.re", { value: data, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain("<h1>Actualités <span class=\"n974\">974</span></h1>");
    expect(html).toContain("Le direct d'Imaz Press");
    expect(html).toContain('id="nf"');
    expect(html).toContain("Communiqués de la préfecture");
    // Le Quotidien gives neither a first sentence nor always an hour: the page does not promise them.
    expect(html).toContain("Le titre de chaque article, sa première phrase quand le média la donne, son média, les communes qu'il nomme et son heure (heure de La Réunion), ou son jour seulement quand le média ne donne pas l'heure.");
    expect(html).toContain("Titres des articles, avec leur première phrase quand le média la donne, et leur lien");
  });
});
