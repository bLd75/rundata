import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { AGENDAS, LISIBLES, PLANIFIES } from "../src/providers/agenda.js";
import { AUTORISATIONS, type Autorisation } from "../src/providers/autorisations.js";
import { agenda, COUVERTURE, MAIRIES_LUES, mentionCommune, mentionIle, mentionCourte, refreshPlanned } from "../src/tools/agenda.js";
import type { AgendaAnswer } from "../src/web/data.js";
import { agendaPage } from "../src/web/domains.js";
import { communeEvents } from "../src/web/liens.js";
import { PAGES } from "../src/web/places.js";

// Saturday 24/10/2026, 08:00 in La Réunion.
const NOW = new Date("2026-10-24T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const DIX = ["Bras-Panon", "Cilaos", "L'Étang-Salé", "La Possession", "Le Tampon", "Petite-Île", "Saint-André", "Saint-Benoît", "Saint-Joseph", "Saint-Philippe"];
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
    for (const c of DIX) AUTORISATIONS[c] = structuredClone(saved[c]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("are the ten of their legal notices, none agreed yet", () => {
    expect(Object.keys(AUTORISATIONS).sort()).toEqual(DIX);
    expect(Object.values(AUTORISATIONS).every((a) => a.etat === "a_demander" && !a.demandee_le)).toBe(true);
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
    expect(mentionCourte("Le Tampon")).toEqual({ valeur: "Agenda non repris", detail: "ses mentions légales l'interdisent sans son accord, demandé le 26/10", tete: "Agenda communal non repris", resume: "agenda du site de la commune non repris, ses mentions légales l'interdisent sans son accord, demandé le 26/10 (voir non_repris)" });
    set("Le Tampon", { etat: "refusee", refusee_le: "2026-11-03" });
    expect(mentionCommune("Le Tampon")).toBe("La commune du Tampon a refusé, le 03/11, que rundata.re reprenne le contenu de son site : les événements qu'elle y publie ne s'affichent donc pas ici.");
    expect(mentionCourte("Le Tampon")?.detail).toBe("elle a refusé le 03/11");
    expect(mentionCourte("Cilaos")).toEqual({ valeur: "Actualités non reprises", detail: "ses mentions légales l'interdisent sans son accord", tete: "Actualités communales non reprises", resume: "actualités du site de la commune non reprises, ses mentions légales l'interdisent sans son accord (voir non_repris)" });
    set("Cilaos", { etat: "demandee" });
    expect(mentionCourte("Cilaos")?.detail).toBe("ses mentions légales l'interdisent sans son accord, que nous lui avons demandé");
    set("Le Tampon", { etat: "accordee" });
    expect(mentionCommune("Le Tampon")).toBeUndefined();
    expect(mentionCourte("Le Tampon")).toBeUndefined();
  });

  it("are said in one block for the whole island, the day of the request when it is the same for all", () => {
    const block = "Les mentions légales des sites de 10 communes interdisent d'en reprendre le contenu sans leur accord : Bras-Panon, Cilaos, L'Étang-Salé, La Possession, Le Tampon, Petite-Île, Saint-André, Saint-Benoît, Saint-Joseph et Saint-Philippe. rundata.re n'affiche donc pas les événements et actualités qu'elles y publient.";
    expect(mentionIle()).toEqual([block]);
    for (const c of DIX) set(c, { etat: "demandee", demandee_le: "2026-10-26" });
    expect(mentionIle()).toEqual([`${block} Nous leur avons demandé cet accord le 26/10 et attendons leur réponse.`]);
    // Petite-Île not asked yet: the day on each commune's own line.
    set("Petite-Île", { etat: "a_demander", demandee_le: undefined });
    const lines = mentionIle();
    expect(lines[0]).toBe(block);
    expect(lines).toHaveLength(10);
    expect(lines).toContain("Les mentions légales du site de la commune du Tampon interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas les événements qu'elle y publie. Nous lui avons demandé cet accord le 26/10 et attendons sa réponse.");
  });

  it("are left out of the agendas read and of those without one, and said in the coverage and the answer", async () => {
    expect(MAIRIES_LUES).toBe("Saint-Paul, Le Port, Les Trois-Bassins, Saint-Louis");
    expect(COUVERTURE).not.toMatch(/Ville du Tampon|Ville de Saint-André|Actualités des mairies/);
    const without = /Sans agenda lu[^:]*: ([^.]*)\./.exec(COUVERTURE)![1];
    expect(DIX.filter((c) => without.includes(c))).toEqual([]);
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
    expect(html).toContain("Les mentions légales des sites de 10 communes interdisent");
    const page = (slug: string) => PAGES.find((p) => p.slug === slug)!;
    // Each keeps its page, its tile of outings and all that comes from elsewhere: only its site is not read.
    expect(DIX.filter((c) => !PAGES.some((p) => p.commune && p.nom === c))).toEqual([]);
    const copy = { value, fetchedAt: NOW, stale: false };
    expect(communeEvents(page("le-tampon"), copy)).toEqual({ valeur: "Agenda non repris", detail: "ses mentions légales l&#39;interdisent sans son accord", title: TAMPON });
    // With events from other sources (its theatre): their number, and the whole mention after the next one.
    const luc = { titre: "Spectacle", date: "2026-10-25T20:00", quand: "dimanche 25/10 à 20:00", genres: [], commune: "Le Tampon", lien: "https://example.re" } as unknown as NonNullable<AgendaAnswer["evenements"]>[number];
    expect(communeEvents(page("le-tampon"), { ...copy, value: { ...value, evenements: [luc] } })).toEqual({ valeur: "1 événement", detail: "Agenda communal non repris · le prochain : Spectacle, dimanche 25/10 à 20:00", title: TAMPON });
    expect(communeEvents(page("saint-pierre"), copy)).toMatchObject({ valeur: "Rien d'annoncé" });
  });
});
