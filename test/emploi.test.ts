import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { counted } from "../src/budget.js";
import { Cache, MemoryStore } from "../src/cache.js";
import * as emploiSource from "../src/providers/emploi.js";
import { REGISTRY } from "../src/registre.js";
import { emploi, lignes, NON_REPRIS } from "../src/tools/emploi.js";
import { buildEmploi, emploiPage } from "../src/web/emploi.js";

// The feed of La Réunion read on 29/10/2026 at 12:20, two offers' pages and the first search page read at 12:26-12:28,
// cut to what is read of them (and without the recruiters' names).
const fixture = (f: string) => readFileSync(new URL(`./fixtures/emploi/${f}`, import.meta.url), "utf8");
const FEED = fixture("flux.xml");
const CHU = fixture("offre-chu.html");
const DGAC = fixture("offre-dgac.html");
// 12:45 in La Réunion.
const NOW = new Date("2026-10-29T08:45:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());

afterEach(() => {
  emploiSource.configure(undefined);
  vi.unstubAllGlobals();
});

/** The site as the Worker reads it: the feed, and each offer's page (the CHU's for the two without a place, the DGAC's for the others). */
function site(fiche: (ref: string) => string | undefined = (ref) => (ref.startsWith("2026-") ? CHU : DGAC)) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const u = new URL(url);
    asked.push(u.hostname === "place-ep-recrute.talent-soft.com" ? "flux" : decodeURIComponent(u.pathname.split("/")[2]));
    if (u.hostname === "place-ep-recrute.talent-soft.com") return new Response(FEED);
    const html = fiche(decodeURIComponent(u.pathname.split("/")[2]));
    return html === undefined ? new Response("", { status: 503 }) : new Response(html);
  });
  return asked;
}

/** The feed read at `at`, then one event every 5 minutes until no page is left to read: the copy written last. */
async function rempli(at = NOW, before: emploiSource.Copie | null = null) {
  let c = before;
  const write = async (x: emploiSource.Copie) => void (c = x);
  await emploiSource.collect(c, write, at, true);
  for (let k = 1; c!.offres.some((o) => emploiSource.enAttente(o)); k++) await emploiSource.collect(c, write, new Date(at.getTime() + k * 300_000), false);
  return c!;
}

describe("the public sector's offers of Choisir le service public", () => {
  it("reads the feed's offers: reference, title, field, job, nature, place, a commune only when named exactly", () => {
    const f = emploiSource.parseFeed(FEED);
    expect(f).toHaveLength(20);
    expect(f[0]).toEqual({
      ref: "2026-2416372",
      intitule: "Assistant(e) de direction",
      lien: "https://choisirleservicepublic.gouv.fr/offre-emploi/2026-2416372/",
      domaine: "Direction et pilotage des politiques publiques",
      metier: "Assistante / Assistant de direction",
      nature: "Emploi ouvert aux titulaires et aux contractuels",
      publiee: "2026-10-29T08:20:31.000Z",
    });
    // The tracking of the feed's links taken out.
    expect(f.every((o) => !o.lien.includes("tracking"))).toBe(true);
    // A CEDEX of Saint-Denis, 97408, which is La Possession's INSEE code: the commune from the name, never the code.
    expect(f[1]).toMatchObject({ ref: "DGAC-AVE-128697-CAT-B", lieu: "97408-ST DENIS CEDEX 9", commune: "Saint-Denis" });
    expect(f.filter((o) => o.commune === "Sainte-Marie")).toHaveLength(12);
    expect(f.filter((o) => !o.lieu).map((o) => o.ref)).toEqual(["2026-2416372", "2026-2454752"]);
    expect(["97460-ST PAUL", "97434-ST GILLES LES BAINS", "CHU SITES SUD", "", undefined].map(emploiSource.communeDe)).toEqual(["Saint-Paul", "Saint-Paul", undefined, undefined, undefined]);
  });

  it("finds an address's commune from La Poste's postcode, the name after it the same, never from a CEDEX", () => {
    // Places read on the offers' pages on 29/10/2026.
    expect(["24 avenue Georges Brassens 97400 Saint-Denis", "27 rue Félix Guyon 97400 St-Denis", "Rue LA BOURDONNAIS 97400 ILE DE LA REUNION", "Rue X, 97430 Le Tampon, La Réunion"].map(emploiSource.communeDe)).toEqual(["Saint-Denis", "Saint-Denis", "Saint-Denis", "Le Tampon"]);
    // 97411: Saint-Paul's postcode, Saint-Denis's INSEE code.
    expect(emploiSource.communeDe("Rue X 97411")).toBe("Saint-Paul");
    // A name that is not the postcode's commune, a CEDEX, a code out of La Poste's: none.
    expect(["Rue X 97400 Saint-Paul", "Rue X 97400 Paris", "BP 123 97408 SAINT DENIS", "Rue X 97400 SAINT DENIS CEDEX", "Réunion (974), France"].map(emploiSource.communeDe)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    // « SAINT CLOTILDE »: Sainte-Clotilde, in Saint-Denis.
    expect(emploiSource.communeDe("SAINT CLOTILDE")).toBe("Saint-Denis");
  });

  it("reads an offer's page for its employer, closing date, place and nature", () => {
    expect(emploiSource.parseFiche(CHU)).toEqual({ employeur: "Centre Hospitalier Universitaire de la Réunion", limite: "2026-11-10", lieu: "CHU SITES SUD", nature: "Emploi ouvert aux titulaires et aux contractuels" });
    // The service under its employer, after a <br />, as the page writes them.
    expect(emploiSource.parseFiche(DGAC).employeur).toBe("Direction Générale de l'Aviation Civile (DGAC), Service navigation aérienne Océan Indien (SNA/OI)");
    expect(emploiSource.parseFiche("<html></html>")).toEqual({});
  });

  it("reads a search page's offers: reference, title, field, employer and day, with the page's own link", () => {
    const r = emploiSource.parseRecherche(fixture("recherche.html"));
    expect(r).toHaveLength(20);
    expect(r[0]).toEqual({
      ref: "2026-2454752",
      intitule: "ASSISTANT DE SERVICE SOCIAL INSTITUT MEDICAL LEGAL 50%",
      lien: "https://choisirleservicepublic.gouv.fr/offre-emploi/assistant-de-service-social-institut-medical-legal-50-reference-2026-2454752/",
      domaine: "Social, enfance et famille",
      employeur: "Centre Hospitalier Universitaire de la Réunion",
      // « En ligne depuis le 29 octobre 2026 »: midnight at La Réunion.
      publiee: "2026-10-28T20:00:00.000Z",
    });
    expect(r.filter((o) => o.ref.startsWith("O974"))).toHaveLength(16);
  });

  it("keeps an offer until its closing date, else 31 days after it was published, and while its page is not read", () => {
    const o = { ref: "x", intitule: "x", lien: "x", publiee: "2026-10-01T06:00:00Z", fiche: "lue" as const };
    // Listed by the site's search, its page not read yet: open, whatever its age; read once more at the next pass, too.
    for (const fiche of [undefined, "relire" as const]) expect(emploiSource.ouverte({ ...o, fiche }, new Date("2026-12-01T00:00:00Z"))).toBe(true);
    expect(emploiSource.ouverte({ ...o, fiche: "abandon" }, new Date("2026-11-01T06:00:01Z"))).toBe(false);
    expect(emploiSource.ouverte(o, new Date("2026-11-01T05:00:00Z"))).toBe(true);
    expect(emploiSource.ouverte(o, new Date("2026-11-01T06:00:01Z"))).toBe(false);
    // The closing day included, at La Réunion: 10/11 until 23:59 there (19:59 UTC).
    expect(emploiSource.ouverte({ ...o, limite: "2026-11-10" }, new Date("2026-11-10T19:59:00Z"))).toBe(true);
    expect(emploiSource.ouverte({ ...o, limite: "2026-11-10" }, new Date("2026-11-10T20:00:00Z"))).toBe(false);
  });

  it("reads one offer's page an event, the newest not read yet, then each in turn, and writes only what changed", async () => {
    const asked = site();
    const writes: emploiSource.Copie[] = [];
    const write = async (c: emploiSource.Copie) => void writes.push(c);
    const { value, used } = await counted(100, () => emploiSource.collect(null, write, NOW, true));
    expect(value).toBe("20 offres, 20 nouvelles, page de l'offre 2026-2416372 lue : écrites");
    // The feed and one page: never two pages at once on the site; the registry's, besides the copy read and written.
    expect(used).toBe(2);
    const run = (id: string) => REGISTRY.find((e) => e.id === id)!.run.subrequests;
    expect(run("emploi:flux") + run("emploi:offres") - 2).toBe(used);
    // Newest first.
    expect(writes[0].offres[0]).toMatchObject({ ref: "2026-2416372", fiche: "lue" });
    expect(writes[0].offres.filter((o) => o.fiche === "lue")).toHaveLength(1);

    // The next events, without the feed: one page each, the newest not read yet, until all are.
    for (let k = 1; k < 20; k++) {
      asked.length = 0;
      await emploiSource.collect(writes.at(-1)!, write, new Date(NOW.getTime() + k * 300_000), false);
      expect(asked).toHaveLength(1);
    }
    const c = writes.at(-1)!;
    expect(writes).toHaveLength(20);
    expect(c.lu).toBe(NOW.toISOString());
    expect(c.offres.every((o) => o.fiche === "lue")).toBe(true);
    expect(c.offres.find((o) => o.ref === "2026-2454752")).toMatchObject({ employeur: "Centre Hospitalier Universitaire de la Réunion", limite: "2026-11-10", lieu: "CHU SITES SUD" });
    expect(c.offres.find((o) => o.ref === "2026-2454752")).not.toHaveProperty("commune");

    // Then each open offer in turn, by the event's slot, nothing written while the page says the same.
    const turn = (k: number) => emploiSource.prochaineFiche(c.offres, new Date(NOW.getTime() + k * 300_000))!.ref;
    expect(new Set(Array.from({ length: 20 }, (_, k) => turn(20 + k))).size).toBe(20);
    asked.length = 0;
    const later = new Date(NOW.getTime() + 3600_000);
    expect(await emploiSource.collect(c, write, later, true)).toBe(`20 offres, 0 nouvelles, page de l'offre ${emploiSource.prochaineFiche(c.offres, later)!.ref} relue : inchangées, non réécrites`);
    expect(asked).toEqual(["flux", emploiSource.prochaineFiche(c.offres, later)!.ref]);
    expect(writes).toHaveLength(20);
    // A store still empty between two feeds: nothing read.
    expect(await emploiSource.collect(null, write, later, false)).toBe("aucune copie, flux lu à la prochaine heure");

    const at = (min: number) => emploiSource.refreshDue(new Date(Date.UTC(2026, 9, 29, 8, min)));
    expect([0, 24, 25, 29, 30].map(at)).toEqual([false, false, true, true, false]);
  });

  it("fills in a commune when an offer read again has a place it did not know", async () => {
    site();
    const o: emploiSource.Offre = { ref: "DGAC-AVE-128697-CAT-A", intitule: "x", lien: emploiSource.lienDe("DGAC-AVE-128697-CAT-A"), publiee: "2026-10-29T06:00:00Z", lieu: "27 rue Félix Guyon 97400 St-Denis", limite: "2026-11-20", fiche: "lue" };
    let c: emploiSource.Copie | undefined;
    await emploiSource.collect({ lu: NOW.toISOString(), offres: [o] }, async (x) => void (c = x), NOW, false);
    expect(c!.offres[0]).toMatchObject({ lieu: "27 rue Félix Guyon 97400 St-Denis", commune: "Saint-Denis" });
  });

  it("logs a feed all new, and tries a silent offer's page once more, then keeps its 31 days", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const before: emploiSource.Copie = { lu: "2026-10-29T07:25:00Z", offres: [{ ref: "2026-1", intitule: "Ancienne", lien: emploiSource.lienDe("2026-1"), publiee: "2026-10-20T06:00:00Z", fiche: "lue" }] };
    site((ref) => (ref === "2026-2454752" ? undefined : ref.startsWith("2026-") ? CHU : DGAC));
    const c = await rempli(NOW, before);
    expect(log).toHaveBeenCalledWith("offres d'emploi : 20 nouvelles références sur 20 dans le flux, des offres ont pu passer entre deux lectures");
    expect(c.offres).toHaveLength(21);
    // Silent twice, at two events in a row: given up, and not read again until its turn among the read ones.
    expect(c.offres.find((o) => o.ref === "2026-2454752")!.fiche).toBe("abandon");
    expect(c.offres.filter((o) => o.fiche === "lue")).toHaveLength(20);
    log.mockRestore();
  });

  it("keeps the copy when the feed does not answer, with when it first failed, written once", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    const before: emploiSource.Copie = { lu: "2026-10-29T07:25:00Z", offres: [] };
    const writes: emploiSource.Copie[] = [];
    const write = async (c: emploiSource.Copie) => void writes.push(c);
    await expect(emploiSource.collect(before, write, NOW, true)).rejects.toThrow("HTTP 503");
    expect(writes).toEqual([{ ...before, echec: NOW.toISOString() }]);
    await expect(emploiSource.collect(writes[0], write, NOW, true)).rejects.toThrow("HTTP 503");
    expect(writes).toHaveLength(1);
  });
});

describe("the tool emploi and the page /emploi", () => {
  async function copie(): Promise<emploiSource.Copie> {
    site();
    const c = await rempli();
    vi.unstubAllGlobals();
    return c;
  }

  it("gives the island's offers newest first, each with its link, one line for a post published under several references, and says what is not taken", async () => {
    const c = await copie();
    emploiSource.configure(async () => c);
    const r = body(await emploi(cache(), undefined, undefined, NOW));
    expect(r.resume).toBe("20 offres ouvertes à la candidature à La Réunion sur Choisir le service public, la plus récente publiée le 29/10 : Assistant(e) de direction.");
    expect(r.offres[1]).toEqual({
      intitule: "Adjoint au chef de division*K-OI/EXPL",
      employeur: "Direction Générale de l'Aviation Civile (DGAC), Service navigation aérienne Océan Indien (SNA/OI)",
      commune: "Saint-Denis",
      metier: "Responsable sectorielle / sectoriel",
      nature: "Emploi ouvert aux titulaires et aux contractuels",
      publiee_le: "29/10",
      date_limite: "20/11",
      nombre_offres: 2,
      references: [
        { reference: "DGAC-AVE-128697-CAT-A", publiee_le: "29/10", lien: "https://choisirleservicepublic.gouv.fr/offre-emploi/DGAC-AVE-128697-CAT-A/" },
        { reference: "DGAC-AVE-128697-CAT-B", publiee_le: "29/10", lien: "https://choisirleservicepublic.gouv.fr/offre-emploi/DGAC-AVE-128697-CAT-B/" },
      ],
    });
    // Every offer once: in a line of its own or among a line's references.
    const refs = r.offres.flatMap((o: { lien?: string; references?: { lien: string }[] }) => o.references?.map((x) => x.lien) ?? [o.lien]);
    expect(refs).toHaveLength(20);
    expect(r.offres.length).toBeLessThan(20);
    expect(r.non_repris).toBe(NON_REPRIS);
    expect(r.entreprises).toContain("https://www.francetravail.fr/accueil/");
    expect(JSON.stringify(r)).not.toMatch(/refuse|hellowork\.com|apec\.fr/i);
    expect(r.sources[0].licence).toBe("Licence Ouverte Etalab 2.0");
  });

  it("filters by commune and by words, and counts the offers that name no commune", async () => {
    const c = await copie();
    emploiSource.configure(async () => c);
    const marie = body(await emploi(cache(), "Sainte-Marie", undefined, NOW));
    expect(marie.nombre).toBe(12);
    expect(marie.resume).toContain("12 offres ouvertes à la candidature à Sainte-Marie");
    expect(marie.resume).toContain("2 autres offres de La Réunion ne précisent pas leur commune.");
    const words = body(await emploi(cache(), undefined, "gestionnaire finances", NOW));
    // Four offers, one line: the site's references, one per category and per post.
    expect(words.nombre).toBe(4);
    expect(words.offres).toHaveLength(1);
    expect(words.offres[0]).toMatchObject({ intitule: "Gestionnaire finances*SG/SIR/OI/FIN", nombre_offres: 4 });
    expect(words.offres[0].references.map((x: { reference: string }) => x.reference)).toEqual(["DGAC-AVE-128051-CAT-B", "DGAC-AVE-128051-CAT-C", "DGAC-AVE-128096-CAT-B", "DGAC-AVE-128096-CAT-C"]);
    expect(words.offres[0]).not.toHaveProperty("lien");
    expect(body(await emploi(cache(), "Nulle-Part-Ici", undefined, NOW)).erreur).toBeDefined();
  });

  it("says the site's silence with the time of the offers shown", async () => {
    const c = await copie();
    emploiSource.configure(async () => ({ ...c, echec: "2026-10-29T08:25:00Z" }));
    expect(body(await emploi(cache(), undefined, undefined, NOW)).injoignable).toBe("Lu aujourd'hui à 12:45 : le site de Choisir le service public n'a pas répondu depuis. Ce qui suit peut avoir changé : voir son site.");
  });

  it("shows on /emploi the first offer under the title, its employer first and its closing date, without a link to the sites not taken", async () => {
    const c = await copie();
    emploiSource.configure(async () => c);
    const d = await buildEmploi(cache(), NOW);
    // The page's copy built 4 minutes after the feed's read: the feed's time is said.
    const page = emploiPage("https://rundata.re", { value: d, fetchedAt: new Date(Date.parse(c.lu) + 4 * 60_000), stale: false }, NOW);
    expect(page).toContain("<h1>Offres d'emploi public à La Réunion</h1>");
    expect(page).toContain("20 offres ouvertes à la candidature sur Choisir le service public, dernière lecture à 12:45.");
    const first = page.indexOf('<ul class="rows eau" id="offres">');
    expect(first).toBeGreaterThan(page.indexOf("</h1>"));
    expect(page).toContain('<small>Direction Générale de l&#39;Aviation Civile (DGAC), Service navigation aérienne Océan Indien (SNA/OI) · Responsable sectorielle / sectoriel · Emploi ouvert aux titulaires et aux contractuels · Saint-Denis</small></span><span class="q-none">jusqu&#39;au 20/11</span>');
    expect(page).toContain("· Assistante / Assistant de direction · Emploi ouvert aux titulaires et aux contractuels · commune non précisée</small>");
    expect(page).toContain("<option>Sainte-Marie</option>");
    expect(page).not.toMatch(/href="https?:\/\/[^"]*(hellowork|meteojob|domtomjob|apec|indeed|linkedin|leboncoin|jooble)/i);
    expect(page).toContain('<a href="https://monemploi-lareunion.francetravail.fr/" rel="noopener">Mon emploi la Réunion</a>');
    // Empty: marketing's sentence, with the hour.
    const none = emploiPage("https://rundata.re", { value: { ...d, nombre: 0, offres: [] }, fetchedAt: NOW, stale: false }, NOW);
    expect(none).toContain("Aucune offre publiée sur Choisir le service public pour La Réunion à 12:45.");
  });

  it("shows a post published under several references as one line, a link to each, the days of each when the line has no closing date", async () => {
    const c = await copie();
    emploiSource.configure(async () => c);
    const d = await buildEmploi(cache(), NOW);
    const page = emploiPage("https://rundata.re", { value: d, fetchedAt: new Date(c.lu), stale: false }, NOW);
    // In marketing's words: the title alone, « 4 offres : », a link per line with the whole reference.
    // Across the whole line, under the date, each reference never cut.
    expect(page).toContain('<li data-c="Sainte-Marie" data-n="4"><span><b>Gestionnaire finances*SG/SIR/OI/FIN</b><small>');
    expect(page).toContain('<span class="q-none">jusqu&#39;au 20/11</span><span class="refs"><small>4 offres\u00a0:</small><a href="https://choisirleservicepublic.gouv.fr/offre-emploi/DGAC-AVE-128051-CAT-B/" rel="noopener">Réf. <span class="nw">DGAC-AVE-128051-CAT-B</span></a><a href=');
    expect(page.match(/<li /g)!.length).toBeLessThan(20);
    // The filter counts the offers, not the lines.
    expect(page).toContain("+e.dataset.n||1");
    // Without a closing date, three offers published on three days: each says its own, the line the first and the last.
    const o = (ref: string, publiee: string): emploiSource.Offre => ({ ref, intitule: "AGENT D'ENTRETIEN", lien: emploiSource.lienDe(ref), publiee, employeur: "Département", domaine: "Intervention technique et logistique" });
    const offres = [o("O974261020000001", "2026-10-20T06:00:00Z"), o("O974261008000002", "2026-10-08T06:00:00Z"), o("O974261002000003", "2026-10-02T06:00:00Z")];
    const [line] = lignes(offres);
    expect(line).not.toHaveProperty("publiee_le");
    const html = emploiPage("https://rundata.re", { value: { ...d, nombre: 3, offres: [line] }, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain('rel="noopener">Réf. <span class="nw">O974261008000002</span>, publiée\u00a0le\u00a008/10</a>');
    expect(html).toContain('<span class="q-none du">publiées du 02/10 au 20/10</span>');
    // The same day for all: said once, at the right, as for one offer.
    const same = lignes(offres.map((x) => ({ ...x, publiee: "2026-10-08T06:00:00Z" })))[0];
    const html2 = emploiPage("https://rundata.re", { value: { ...d, nombre: 3, offres: [same] }, fetchedAt: NOW, stale: false }, NOW);
    expect(html2).toContain('rel="noopener">Réf. <span class="nw">O974261008000002</span></a>');
    expect(html2).toContain('<span class="q-none">publiée le 08/10</span>');
    // A closing date apart, or another place: two lines.
    expect(lignes([offres[0], { ...offres[1], limite: "2026-11-20" }])).toHaveLength(2);
    expect(lignes([offres[0], { ...offres[1], commune: "Saint-Paul" }])).toHaveLength(2);
  });

  it("lists the tool's lines up to its maximum, and counts the offers left", async () => {
    const c = await copie();
    emploiSource.configure(async () => c);
    const r = body(await emploi(cache(), undefined, "gestionnaire finances", NOW, 1));
    expect(r.autres).toBeUndefined();
    const all = body(await emploi(cache(), undefined, undefined, NOW, 1));
    const first = all.offres[0].nombre_offres ?? 1;
    expect(all.autres).toBe(`${20 - first} autres offres, sur ${emploiSource.SOURCE.url}`);
  });

  it("asks the store again for a copy read before the last event's write, every 5 minutes", async () => {
    // Two minutes after each event of 5 minutes: 12:47, 12:52…
    expect(emploiSource.fraicheur(new Date("2026-10-29T08:48:00Z"))).toBe(60);
    expect(emploiSource.fraicheur(new Date("2026-10-29T08:46:59Z"))).toBe(299);
    expect(emploiSource.fraicheur(new Date("2026-10-29T08:47:00Z"))).toBe(1);
    const c = await copie();
    let stored = c;
    emploiSource.configure(async () => stored);
    let t = new Date("2026-10-29T08:45:30Z");
    const store = new Cache(new MemoryStore(), () => t.getTime());
    expect((await emploiSource.offres(store, t))!.value.offres).toHaveLength(c.offres.length);
    // An offer's page read at 12:50 changed the copy: shown at 12:53, not an hour later.
    stored = { ...c, offres: c.offres.slice(1) };
    t = new Date("2026-10-29T08:53:00Z");
    expect((await emploiSource.offres(store, t))!.value.offres).toHaveLength(c.offres.length - 1);
  });

  it("says when the offers are read next while the store has none, without a reading time", async () => {
    emploiSource.configure(async () => null);
    const d = await buildEmploi(cache(), NOW);
    expect(d).toMatchObject({ nombre: 0, offres: [], prochaine: "2026-10-29T09:25:00.000Z" });
    const page = emploiPage("https://rundata.re", { value: d, fetchedAt: NOW, stale: false }, NOW);
    expect(page).toContain('<p class="card">Les offres ne sont pas encore lues : prochaine lecture prévue à 13:25.</p>');
    expect(page).not.toContain("dernière lecture");
    // At 25 past, the read under way is not said: the next one is.
    expect(emploiSource.prochaineLecture(new Date("2026-10-29T09:25:00Z")).toISOString()).toBe("2026-10-29T10:25:00.000Z");
    expect(emploiSource.prochaineLecture(new Date("2026-10-29T09:24:59Z")).toISOString()).toBe("2026-10-29T09:25:00.000Z");
  });
});
