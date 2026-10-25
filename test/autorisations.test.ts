import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { AGENDAS, LISIBLES, PLANIFIES, SOURCES } from "../src/providers/agenda.js";
import { AUTORISATIONS, type Autorisation } from "../src/providers/autorisations.js";
import { agenda, COUVERTURE, MAIRIES_LUES, mentionCommune, mentionIle, mentionCourte, refreshPlanned, repris, sourcesServies } from "../src/tools/agenda.js";
import { resume } from "../src/tools/resume.js";
import { mentionProgrammes, sportTool } from "../src/tools/sport.js";
import { aujourdhuiPage } from "../src/web/aujourdhui.js";
import type { AgendaAnswer } from "../src/web/data.js";
import { agendaPage, sportPage } from "../src/web/domains.js";
import { communeEvents } from "../src/web/liens.js";
import { PAGES } from "../src/web/places.js";

// Saturday 24/10/2026, 08:00 in La Réunion.
const NOW = new Date("2026-10-24T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const DIX = ["Bras-Panon", "Cilaos", "L'Étang-Salé", "La Possession", "Le Tampon", "Petite-Île", "Saint-André", "Saint-Benoît", "Saint-Joseph", "Saint-Philippe"];
// The same rule for every commune: three more, whose site is not read at all.
const TREIZE = ["Bras-Panon", "Cilaos", "L'Étang-Salé", "La Possession", "Le Tampon", "Petite-Île", "Saint-André", "Saint-Benoît", "Saint-Denis", "Saint-Joseph", "Saint-Philippe", "Saint-Pierre", "Sainte-Rose"];
const SITES = ["braspanon.re", "ville-cilaos.fr", "letangsale.fr", "lapossession.re", "letampon.fr", "petite-ile.re", "saint-andre.re", "saint-benoit.re", "saintjoseph.re", "saintphilippe.re"];
const TAMPON = "Les mentions légales du site de la commune du Tampon interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas les événements qu'elle y publie.";

const event = (titre: string, commune: string) => ({ id: titre, titre, seances: [{ debut: "2026-10-25" }], commune, categories: [], lien: `https://example.re/${titre}`, publie_par: commune });
const kept = (v: unknown) => ({ value: v, fetchedAt: NOW.getTime() - 60_000 });
/** A cache where Saint-Paul's agenda has a fresh copy (the others do not answer), and `more` in the questions' bundle. */
async function cacheWith(more: Record<string, unknown> = {}, planned: Record<string, unknown> = {}) {
  const store = new MemoryStore();
  await store.put("agendas", kept({ "agenda:saint_paul": kept([event("Kabar à Saint-Paul", "Saint-Paul")]), ...more }));
  await store.put(PLANIFIES, kept(planned));
  return new Cache(store, () => NOW.getTime());
}

describe("the communes whose site's terms ask for their authorisation, until they give it", () => {
  let urls: string[];
  const saved = structuredClone(AUTORISATIONS);
  const set = (commune: string, a: Partial<Autorisation>) => Object.assign(AUTORISATIONS[commune], a);
  beforeEach(() => {
    urls = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (url: string) => (urls.push(url), new Response("", { status: 503 })));
  });
  afterEach(() => {
    for (const c of TREIZE) AUTORISATIONS[c] = structuredClone(saved[c]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("are the ten of their legal notices, none agreed yet", () => {
    expect(Object.keys(AUTORISATIONS).filter((c) => AUTORISATIONS[c].etat !== "permise")).toEqual(TREIZE);
    expect(TREIZE.every((c) => AUTORISATIONS[c].etat === "a_demander" && !AUTORISATIONS[c].demandee_le)).toBe(true);
  });

  it("are not those whose terms allow it on conditions: read, and nothing said instead", () => {
    const PERMISES = ["La Plaine-des-Palmistes", "Saint-Leu", "Saint-Louis"];
    expect(Object.keys(AUTORISATIONS).filter((c) => AUTORISATIONS[c].etat === "permise").sort()).toEqual(PERMISES);
    for (const c of PERMISES) {
      expect(AGENDAS.some((a) => a.commune === c && a.site_commune)).toBe(true);
      expect(mentionCommune(c)).toBeUndefined();
      expect(mentionCourte(c)).toBeUndefined();
    }
    expect(mentionIle().join(" ")).not.toMatch(/Saint-Leu|Saint-Louis|Plaine-des-Palmistes/);
  });

  it("are not read: no agenda nor news of their site, no fetch to it", async () => {
    const theirs = LISIBLES.filter((a) => a.site_commune && DIX.includes(a.commune!));
    expect(theirs.map((a) => a.id).sort()).toEqual(["bras_panon", "cilaos", "etang_sale", "la_possession", "le_tampon", "petite_ile", "saint_andre", "saint_benoit", "saint_joseph", "saint_philippe"]);
    expect(AGENDAS.filter((a) => theirs.includes(a))).toEqual([]);
    const c = new Cache(new MemoryStore(), () => NOW.getTime());
    await refreshPlanned(c, NOW);
    await agenda(c, undefined, undefined, undefined, NOW);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((u) => SITES.some((s) => new URL(u).hostname.endsWith(s)))).toEqual([]);
  });

  it("are no longer served from the copies kept before", async () => {
    const c = await cacheWith({ "agenda:le_tampon": kept([event("Fête du Tampon", "Le Tampon")]) }, { "agenda:cilaos": kept([event("Journée de Cilaos", "Cilaos")]) });
    const b = body(await agenda(c, undefined, undefined, undefined, NOW));
    expect(b.evenements.map((e: { titre: string }) => e.titre)).toContain("Kabar à Saint-Paul");
    expect(JSON.stringify(b)).not.toContain("Fête du Tampon");
    expect(JSON.stringify(b)).not.toContain("Journée de Cilaos");
  });

  it("are said instead, in marketing's words: before the request, once asked, once refused", () => {
    expect(mentionCommune("Le Tampon")).toBe(TAMPON);
    expect(mentionCommune("Saint-Joseph")).toBe("Les mentions légales du site de la commune de Saint-Joseph interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas les actualités qu'elle y publie.");
    expect(mentionCommune("Saint-Paul")).toBeUndefined();
    set("Le Tampon", { etat: "demandee" });
    expect(mentionCommune("Le Tampon")).toBe(`${TAMPON} Nous lui avons demandé cet accord et attendons sa réponse.`);
    set("Le Tampon", { demandee_le: "2026-10-26" });
    expect(mentionCommune("Le Tampon")).toBe(`${TAMPON} Nous lui avons demandé cet accord le 26/10 et attendons sa réponse.`);
    expect(mentionCourte("Le Tampon")).toEqual({ valeur: "Agenda non repris", detail: "ses mentions légales l'interdisent sans son accord, demandé le 26/10", tete: "Agenda communal non repris", resume: "agenda du site de la commune non repris, ses mentions légales l'interdisent sans son accord, demandé le 26/10 (voir non_repris)", ligne: "Agenda du site de la commune non repris : ses mentions légales l'interdisent sans son accord, demandé le 26/10." });
    set("Le Tampon", { etat: "refusee", refusee_le: "2026-11-03" });
    expect(mentionCommune("Le Tampon")).toBe("La commune du Tampon a refusé, le 03/11, que rundata.re reprenne le contenu de son site : les événements qu'elle y publie ne s'affichent donc pas ici.");
    expect(mentionCourte("Le Tampon")?.detail).toBe("elle a refusé le 03/11");
    expect(mentionCourte("Cilaos")).toEqual({ valeur: "Actualités non reprises", detail: "ses mentions légales l'interdisent sans son accord", tete: "Actualités communales non reprises", resume: "actualités du site de la commune non reprises, ses mentions légales l'interdisent sans son accord (voir non_repris)", ligne: "Actualités du site de la commune non reprises : ses mentions légales l'interdisent sans son accord." });
    set("Cilaos", { etat: "demandee" });
    expect(mentionCourte("Cilaos")?.detail).toBe("ses mentions légales l'interdisent sans son accord, que nous lui avons demandé");
    set("Le Tampon", { etat: "accordee" });
    expect(mentionCommune("Le Tampon")).toBeUndefined();
    expect(mentionCourte("Le Tampon")).toBeUndefined();
  });

  it("are said in one block for the whole island, the day of the request when it is the same for all", () => {
    const block = "Les mentions légales des sites de 13 communes interdisent d'en reprendre le contenu sans leur accord : Bras-Panon, Cilaos, L'Étang-Salé, La Possession, Le Tampon, Petite-Île, Saint-André, Saint-Benoît, Saint-Denis, Saint-Joseph, Saint-Philippe, Saint-Pierre et Sainte-Rose. rundata.re n'affiche donc pas les événements et actualités qu'elles y publient.";
    expect(mentionIle()).toEqual([block]);
    for (const c of TREIZE) set(c, { etat: "demandee", demandee_le: "2026-10-26" });
    expect(mentionIle()).toEqual([`${block} Nous leur avons demandé cet accord le 26/10 et attendons leur réponse.`]);
    // Petite-Île not asked yet: the day on each commune's own line.
    set("Petite-Île", { etat: "a_demander", demandee_le: undefined });
    const lines = mentionIle();
    expect(lines[0]).toBe(block);
    expect(lines).toHaveLength(13);
    expect(lines).toContain("Les mentions légales du site de la commune du Tampon interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas les événements qu'elle y publie. Nous lui avons demandé cet accord le 26/10 et attendons sa réponse.");
  });

  it("are left out of the agendas read and of those without one, and said in the coverage and the answer", async () => {
    expect(MAIRIES_LUES).toBe("Saint-Paul, Le Port, Les Trois-Bassins, Saint-Louis");
    expect(COUVERTURE).not.toMatch(/Ville du Tampon|Ville de Saint-André/);
    // The mairies' news read are only those of the communes whose terms allow it.
    expect(COUVERTURE).toContain("(pas un agenda complet) : Saint-Louis, Saint-Leu, La Plaine-des-Palmistes.");
    const without = /Sans agenda lu[^:]*: ([^.]*)\./.exec(COUVERTURE)![1];
    expect(TREIZE.filter((c) => without.includes(c))).toEqual([]);
    expect(COUVERTURE).toContain(mentionIle()[0]);
    const c = await cacheWith();
    const tampon = body(await agenda(c, "Le Tampon", undefined, undefined, NOW));
    expect(tampon.non_repris).toBe(TAMPON);
    expect(tampon.resume).toContain("; agenda du site de la commune non repris, ses mentions légales l'interdisent sans son accord (voir non_repris)");
    const ile = body(await agenda(c, undefined, undefined, undefined, NOW));
    expect(ile.non_repris).toBe(mentionIle().join(" "));
    // Petite-Île: no other source there.
    expect(body(await agenda(c, "Petite-Île", undefined, undefined, NOW)).resume).toContain("seuls les grands événements de reunion.fr y figurent");
  });

  it("are said on the page of the events and in the outings of the commune's page, never « rien d'annoncé »", () => {
    const value = { resume: "", nombre: 0, evenements: [], non_repris: mentionIle().join(" "), couverture: COUVERTURE, a_savoir: "", sources: [], ce_week_end: [] } as AgendaAnswer;
    const html = agendaPage("https://rundata.re", { value, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain("Les mentions légales des sites de 13 communes interdisent");
    const page = (slug: string) => PAGES.find((p) => p.slug === slug)!;
    // Each keeps its page, its tile of outings and all that comes from elsewhere: only its site is not read.
    expect(TREIZE.filter((c) => !PAGES.some((p) => p.commune && p.nom === c))).toEqual([]);
    const copy = { value, fetchedAt: NOW, stale: false };
    expect(communeEvents(page("le-tampon"), copy)).toEqual({ valeur: "Agenda non repris", detail: "ses mentions légales l&#39;interdisent sans son accord", title: TAMPON });
    // With events from other sources (its theatre): their number, and the whole mention after the next one.
    const luc = { titre: "Spectacle", date: "2026-10-25T20:00", quand: "dimanche 25/10 à 20:00", genres: [], commune: "Le Tampon", lien: "https://example.re" } as unknown as NonNullable<AgendaAnswer["evenements"]>[number];
    expect(communeEvents(page("le-tampon"), { ...copy, value: { ...value, evenements: [luc] } })).toEqual({ valeur: "1 événement", detail: "Agenda communal non repris · le prochain : Spectacle, dimanche 25/10 à 20:00", title: TAMPON });
    expect(communeEvents(page("saint-leu"), copy)).toMatchObject({ valeur: "Rien d'annoncé" });
  });

  it("are not served from a copy built before, whatever its age: the day's summary, the outings tile, the credits", () => {
    // A copy of the events page built by the revision before, as some data centers still hold it.
    const tampon = { titre: "Ateliers des Conseillers numériques", commune: "Le Tampon", date: "2026-10-24T09:00", quand: "samedi 24/10 à 09:00", lien: "https://letampon.fr/agenda/ateliers-des-conseillers-numeriques-1026/", publie_par: "Ville du Tampon", source: "site de la commune du Tampon, lu le samedi 24/10 à 08:00" };
    const luc = { titre: "Spectacle", commune: "Le Tampon", date: "2026-10-24T20:00", quand: "samedi 24/10 à 20:00", lien: "https://example.re", publie_par: "Théâtre Luc Donat" };
    const old = { resume: "", nombre: 2, couverture: "", a_savoir: "", ce_week_end: [], evenements: [tampon, luc], sources: [{ source: "Agendas des mairies de Saint-Paul, du Port, des Trois-Bassins, du Tampon, de Saint-Louis et de Saint-André", licence: "Information publique (agendas municipaux)", attribution: "Villes de Saint-Paul, Le Port, Les Trois-Bassins, Le Tampon, Saint-Louis et Saint-André" }] };
    expect([repris(tampon), repris(luc), repris({ publie_par: "Mairie de Saint-Philippe" }), repris({ source: "site de la commune de Saint-Paul, lu le samedi 24/10 à 08:00" })]).toEqual([false, true, false, true]);
    const page = PAGES.find((p) => p.slug === "le-tampon")!;
    const r = resume(page, { agenda: { value: old, fetchedAt: NOW, stale: false } } as never, NOW);
    expect(r.evenements_du_jour!.liste.map((e) => e.titre)).toEqual(["Spectacle"]);
    expect(JSON.stringify(r)).not.toMatch(/letampon\.fr|du Tampon, de Saint-Louis/);
    expect(communeEvents(page, { value: old as unknown as AgendaAnswer, fetchedAt: NOW, stale: false })).toMatchObject({ valeur: "1 événement" });
    // Named after the mairies read: not Saint-Louis, credited apart with its terms' clause.
    expect([SOURCES.mairies.nom, SOURCES.mairies.attribution]).toEqual(["Agendas des mairies de Saint-Paul, du Port et des Trois-Bassins", "Villes de Saint-Paul, Le Port et Les Trois-Bassins"]);
    expect(sourcesServies(old.sources)!.map((c) => c.source)).toEqual([SOURCES.mairies.nom]);
  });

  it("are said under the outings of the day's page", () => {
    const page = PAGES.find((p) => p.slug === "le-tampon")!;
    const empty = { resume: "", nombre: 0, couverture: "", a_savoir: "", ce_week_end: [], evenements: [], sources: [] };
    const html = aujourdhuiPage("https://rundata.re", page, resume(page, { agenda: { value: empty, fetchedAt: NOW, stale: false } } as never, NOW), null);
    expect(html).toContain("Rien d'annoncé aujourd'hui au Tampon dans les agendas lus.</p><p class=\"note\">Agenda du site de la commune non repris : ses mentions légales l&#39;interdisent sans son accord.</p>");
    const paul = PAGES.find((p) => p.slug === "saint-paul")!;
    expect(aujourdhuiPage("https://rundata.re", paul, resume(paul, { agenda: { value: empty, fetchedAt: NOW, stale: false } } as never, NOW), null)).not.toContain("non repris");
  });

  it("are said instead of the sports programmes of the communes that published some, on /sport and in the tool", async () => {
    const three = "Les programmes sportifs de L'Étang-Salé, de La Possession et de Saint-Benoît ne sont pas repris : les mentions légales des sites de ces communes l'interdisent sans leur accord.";
    expect(LISIBLES.filter((a) => a.programmes).map((a) => a.commune)).toEqual(["L'Étang-Salé", "La Possession", "Saint-Benoît"]);
    expect(mentionProgrammes()).toBe(three);
    expect(mentionProgrammes(["Saint-Benoît", "Saint-André"])).toBe("Les mentions légales du site de la commune de Saint-Benoît interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas le programme sportif qu'elle y publie.");
    expect(mentionProgrammes(["Saint-Paul"])).toBeUndefined();
    for (const c of ["La Possession", "L'Étang-Salé", "Saint-Benoît"]) set(c, { etat: "demandee", demandee_le: "2026-10-26" });
    expect(mentionProgrammes()).toBe(`${three} Nous leur avons demandé cet accord le 26/10 et attendons leur réponse.`);
    set("Saint-Benoît", { etat: "refusee", refusee_le: "2026-11-03" });
    expect(mentionProgrammes(["Saint-Benoît"])).toBe("La commune de Saint-Benoît a refusé, le 03/11, que rundata.re reprenne le contenu de son site : le programme sportif qu'elle y publie ne s'affiche donc pas ici.");
    for (const c of ["La Possession", "L'Étang-Salé", "Saint-Benoît"]) AUTORISATIONS[c] = structuredClone(saved[c]);
    // The golf league answers; La Possession's programme still in the copy kept before: not served.
    vi.stubGlobal("fetch", async (url: string) => (url.includes("ffgolf") ? new Response(readFileSync(new URL("./fixtures/sport/ffgolf.json", import.meta.url))) : new Response("", { status: 503 })));
    const c = await cacheWith({ "agenda:la_possession": kept([{ ...event("Agenda sportif du 22 au 24 octobre", "La Possession"), seances: [{ debut: "2026-10-22", fin: "2026-10-26" }] }]) });
    const b = body(await sportTool(c, undefined, undefined, "a_venir", NOW));
    expect([b.non_repris, b.programmes_communes]).toEqual([three, undefined]);
    expect(body(await sportTool(c, "golf", undefined, "a_venir", NOW)).non_repris).toBeUndefined();
    const html = sportPage("https://rundata.re", { value: { ...b, classements: [] }, fetchedAt: NOW, stale: false }, NOW);
    const section = html.slice(html.indexOf('id="h-prog"'));
    expect(section).toContain("Programmes sportifs des communes</h2>");
    expect(section).toContain("Les programmes sportifs de L&#39;Étang-Salé, de La Possession et de Saint-Benoît ne sont pas repris");
  });

  it("are said for the three communes whose site is not read at all, in marketing's words, their events from elsewhere kept", () => {
    expect(mentionCommune("Saint-Pierre")).toBe("Les mentions légales du site de la commune de Saint-Pierre interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas les événements et actualités qu'elle y publie.");
    expect(mentionCommune("Saint-Denis")).toBe("Les mentions légales du site de la commune de Saint-Denis interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas les actualités qu'elle y publie.");
    expect(mentionCommune("Sainte-Rose")).toBe("Les mentions légales du site de la commune de Sainte-Rose interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas les événements et actualités qu'elle y publie.");
    // Nothing of theirs was read: no agenda left out, the intercommunalities' and the halls' kept.
    expect(LISIBLES.filter((a) => a.site_commune && ["Saint-Denis", "Saint-Pierre", "Sainte-Rose"].includes(a.commune!))).toEqual([]);
    const value = { resume: "", nombre: 1, evenements: [{ titre: "Concert", date: "2026-10-25T20:00", quand: "dimanche 25/10 à 20:00", genres: [], commune: "Saint-Denis", lien: "https://example.re", publie_par: "CINOR" }], non_repris: "", couverture: "", a_savoir: "", sources: [], ce_week_end: [] } as unknown as AgendaAnswer;
    const page = (slug: string) => PAGES.find((p) => p.slug === slug)!;
    expect(communeEvents(page("saint-denis"), { value, fetchedAt: NOW, stale: false })).toMatchObject({ valeur: "1 événement", detail: "Actualités communales non reprises · le prochain : Concert, dimanche 25/10 à 20:00" });
    // An agenda and news: their own words (marketing).
    expect(communeEvents(page("saint-pierre"), { value, fetchedAt: NOW, stale: false })).toMatchObject({ valeur: "Agenda et actualités non repris" });
    expect(communeEvents(page("sainte-rose"), { value: { ...value, evenements: [{ ...value.evenements![0], commune: "Sainte-Rose" }] }, fetchedAt: NOW, stale: false })).toMatchObject({ detail: "Site communal non repris · le prochain : Concert, dimanche 25/10 à 20:00" });
    expect(mentionCourte("Saint-Pierre")).toMatchObject({ resume: "agenda et actualités du site de la commune non repris, ses mentions légales l'interdisent sans son accord (voir non_repris)", ligne: "Agenda et actualités du site de la commune non repris : ses mentions légales l'interdisent sans son accord." });
    // Saint-Pierre: the reason of its absence is now the mention, not its empty agenda page.
    expect(COUVERTURE).not.toContain("la page agenda de la mairie de Saint-Pierre est vide");
  });
});
