import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { AGENDAS, copiePlanifiee, LISIBLES, PLANIFIES, SPORTSREGIONS } from "../src/providers/agenda.js";
import { autorisee, NON_REPRISES, type SourceNonReprise } from "../src/providers/autorisations.js";
import { SOURCE as SALLES } from "../src/providers/salles.js";
import { toutesLesSources } from "../src/server.js";
import { agenda, COUVERTURE, PROGRAMMES_SALLES, repris, sourcesServies } from "../src/tools/agenda.js";
import { fichesNonReprises, mentionSalles, mentionSports } from "../src/tools/non-repris.js";
import { sportTool } from "../src/tools/sport.js";
import { sportPage } from "../src/web/domains.js";

const NOW = new Date("2026-10-24T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const kept = (v: unknown) => ({ value: v, fetchedAt: NOW.getTime() - 60_000 });
const event = (titre: string, commune: string, publie_par: string, lien = `https://example.re/${titre}`) => ({ id: titre, titre, seances: [{ debut: "2026-10-25" }], commune, categories: [], lien, publie_par });
// Marketing's words, 26/10.
const SEPT = "Les mentions légales des sites de 7 salles interdisent d'en reprendre le contenu sans accord : le TÉAT (Champ Fleuri et Plein Air), la Cité des Arts, le Kabardock, Bisik, le Théâtre Luc Donat, le CDNOI et Léspas. rundata.re n'affiche donc pas leurs programmes.";
const GOLF = "Les conditions d'utilisation du site de la ffgolf interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas les compétitions des golfs de La Réunion.";
const VOILE = "Les mentions légales du site de la FFVoile interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas les régates de la Ligue de voile de La Réunion.";
const CLUBS = "Les conditions d'utilisation de Sportsregions interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas les événements que les clubs y publient.";
const TROIS = "Les conditions d'utilisation ou les mentions légales de 3 sites interdisent d'en reprendre le contenu sans leur accord : la ffgolf (les compétitions des golfs de La Réunion), la FFVoile (les régates de la Ligue de voile de La Réunion) et Sportsregions (les événements que les clubs y publient). rundata.re n'affiche donc pas ces rendez-vous.";

const saved = structuredClone(NON_REPRISES);
const set = (source: string, x: Partial<SourceNonReprise>) => Object.assign(NON_REPRISES[source], x);
/** Every one as before any request went, for the tests of the words of each step. */
const unasked = () => {
  for (const x of Object.values(NON_REPRISES)) Object.assign(x, { etat: "a_demander", demandee_le: undefined });
};

/** A cache with copies kept before: a hall's in the questions' bundle, the clubs' calendar in the scheduled event's. */
async function cacheWith() {
  const store = new MemoryStore();
  await store.put("agendas", kept({
    "agenda:saint_paul": kept([event("Kabar à Saint-Paul", "Saint-Paul", "Mairie de Saint-Paul")]),
    "agenda:kabardock": kept([event("Concert au Kabardock", "Le Port", "Kabardock")]),
  }));
  await store.put(PLANIFIES, kept({ "agenda:sportsregions": kept([event("Tournoi de badminton", "Saint-Pierre", "Badminton Club", "https://bcsp.sportsregions.fr/evenements/1")]) }));
  return new Cache(store, () => NOW.getTime());
}

describe("the halls and the sports sites whose terms forbid taking their information without their accord", () => {
  afterEach(() => {
    for (const k of Object.keys(saved)) NON_REPRISES[k] = structuredClone(saved[k]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("are seven halls, the clubs' calendar and two federations, five halls and the federations asked on 26/10, the Théâtre Luc Donat read again since its yes of 27/10; Le Séchoir, whose site writes nothing, still read", () => {
    expect(Object.keys(NON_REPRISES)).toEqual([
      "agenda:teat", "agenda:cite_des_arts", "agenda:kabardock", "agenda:bisik", "agenda:luc_donat", "agenda:cdnoi", "agenda:lespas",
      "sport:ffgolf", "sport:ffvoile", "agenda:sportsregions",
    ]);
    // Bisik's, Léspas' and Sportsregions' are forms the user sends: not yet.
    const NON = ["agenda:bisik", "agenda:lespas", "agenda:sportsregions"];
    const OUI = ["agenda:luc_donat"];
    for (const [k, x] of Object.entries(NON_REPRISES)) {
      expect([k, x.etat, x.demandee_le]).toEqual(NON.includes(k) ? [k, "a_demander", undefined] : [k, OUI.includes(k) ? "accordee" : "demandee", "2026-10-26"]);
      expect(x.accordee_le).toBe(OUI.includes(k) ? "2026-10-27" : undefined);
    }
    // Each one an agenda that would be read, or a federation of the sport tool.
    for (const k of Object.keys(NON_REPRISES).filter((k) => k.startsWith("agenda:"))) expect(LISIBLES.some((a) => `agenda:${a.id}` === k)).toBe(true);
    expect(AGENDAS.filter((a) => a.source === SALLES).map((a) => a.nom)).toEqual(["Le Séchoir", "Théâtre Luc Donat"]);
    expect(AGENDAS).not.toContain(SPORTSREGIONS);
    // The halls' source named after those read, and its link theirs.
    expect([SALLES.nom, SALLES.attribution, SALLES.url]).toEqual(["Programmes des salles : Le Séchoir, Théâtre Luc Donat", "Le Séchoir, Théâtre Luc Donat", "https://www.lesechoir.com"]);
    // Its written agreement said in the halls' licence, with its day (marketing, 27/10).
    expect(SALLES.licence).toBe("Information publique (programmes publiés par les salles)\u00a0; Théâtre Luc Donat : repris avec son accord écrit du 27/10/2026");
    expect(PROGRAMMES_SALLES).toBe("les programmes du Séchoir et du Théâtre Luc Donat");
    expect(COUVERTURE).toContain("Programmes des salles : Le Séchoir, Théâtre Luc Donat.");
  });

  it("are said in the same words as the communes, the halls in one block, the day of the request once it has gone", () => {
    unasked();
    expect(mentionSalles()).toEqual([SEPT]);
    expect(mentionSalles("Saint-Denis")).toEqual(["Les mentions légales des sites de 3 salles interdisent d'en reprendre le contenu sans accord : le TÉAT (Champ Fleuri et Plein Air), la Cité des Arts et le CDNOI. rundata.re n'affiche donc pas leurs programmes."]);
    expect(mentionSalles("Le Port")).toEqual(["Les mentions légales du site du Kabardock interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas son programme."]);
    expect(mentionSalles("Saint-Leu")).toEqual([]);
    // Bisik's terms speak of its authors' accord: said so (marketing).
    expect(mentionSalles("Saint-Benoît")).toEqual(["Les mentions légales du site de Bisik interdisent d'en reproduire les textes sans l'accord de leurs auteurs : rundata.re n'affiche donc pas son programme."]);
    for (const k of ["agenda:teat", "agenda:cite_des_arts", "agenda:cdnoi"]) set(k, { etat: "demandee", demandee_le: "2026-10-27" });
    expect(mentionSalles("Saint-Denis")[0]).toMatch(/leurs programmes\. Nous leur avons demandé cet accord le 27\/10 et attendons leur réponse\.$/);
    set("agenda:kabardock", { etat: "refusee", refusee_le: "2026-11-03" });
    expect(mentionSalles("Le Port")).toEqual(["Le Kabardock a refusé, le 03/11, que rundata.re reprenne le contenu de son site : son programme ne s'affiche donc pas ici."]);
    set("agenda:kabardock", { etat: "accordee" });
    expect(autorisee("agenda:kabardock")).toBe(true);
    expect(mentionSalles("Le Port")).toEqual([]);
    // Two sites or more in one block, a sport asked its own line.
    expect(mentionSports(undefined, true)).toEqual([TROIS]);
    expect(mentionSports(["voile"], false)).toEqual([VOILE]);
    for (const k of ["sport:ffgolf", "sport:ffvoile", "agenda:sportsregions"]) set(k, { etat: "demandee", demandee_le: "2026-10-27" });
    expect(mentionSports(undefined, true)).toEqual([`${TROIS} Nous leur avons demandé cet accord le 27/10 et attendons leur réponse.`]);
    set("sport:ffgolf", { etat: "refusee", refusee_le: "2026-11-03" });
    expect(mentionSports(["golf"], false)).toEqual(["La ffgolf a refusé, le 03/11, que rundata.re reprenne le contenu de son site : les compétitions des golfs de La Réunion ne s'affichent donc pas ici."]);
    set("sport:ffgolf", { etat: "a_demander", refusee_le: undefined });
    expect(mentionSports(["golf"], false)).toEqual([GOLF]);
    // Sportsregions alone, asked on 27/10: its own line, with the day.
    expect(mentionSports([], true)).toEqual([`${CLUBS} Nous lui avons demandé cet accord le 27/10 et attendons sa réponse.`]);
  });

  it("are said once each when only some were asked: those asked in one sentence after the block (marketing, 26/10)", () => {
    // The Théâtre Luc Donat, which agreed on 27/10, is no longer among them.
    expect(mentionSalles()).toEqual(["Les mentions légales des sites de 6 salles interdisent d'en reprendre le contenu sans accord : le TÉAT (Champ Fleuri et Plein Air), la Cité des Arts, le Kabardock, Bisik, le CDNOI et Léspas. rundata.re n'affiche donc pas leurs programmes. Nous avons demandé cet accord le 26/10 au TÉAT, à la Cité des Arts, au Kabardock et au CDNOI, et attendons leur réponse."]);
    expect(mentionSalles("Saint-Paul")).toEqual(["Les mentions légales des sites de 2 salles interdisent d'en reprendre le contenu sans accord : le TÉAT (Champ Fleuri et Plein Air) et Léspas. rundata.re n'affiche donc pas leurs programmes. Nous avons demandé cet accord le 26/10 au TÉAT et attendons sa réponse."]);
    expect(mentionSports(undefined, true)).toEqual([`${TROIS} Nous avons demandé cet accord le 26/10 à la ffgolf et à la FFVoile, et attendons leur réponse.`]);
    expect(mentionSports(["golf"], false)).toEqual([`${GOLF} Nous lui avons demandé cet accord le 26/10 et attendons sa réponse.`]);
    // On two days: each after its sites, from the oldest; one refused, its own line.
    set("agenda:cdnoi", { demandee_le: "2026-10-22" });
    set("agenda:kabardock", { etat: "refusee", refusee_le: "2026-11-03" });
    expect(mentionSalles()).toEqual([
      "Les mentions légales des sites de 5 salles interdisent d'en reprendre le contenu sans accord : le TÉAT (Champ Fleuri et Plein Air), la Cité des Arts, Bisik, le CDNOI et Léspas. rundata.re n'affiche donc pas leurs programmes. Nous avons demandé cet accord au CDNOI le 22/10 et au TÉAT et à la Cité des Arts le 26/10, et attendons leur réponse.",
      "Le Kabardock a refusé, le 03/11, que rundata.re reprenne le contenu de son site : son programme ne s'affiche donc pas ici.",
    ]);
  });

  it("are not read, and what was kept of them is not served: the events, the day's copies, the credits", async () => {
    unasked();
    const urls: string[] = [];
    // Only the motor sport league answers.
    vi.stubGlobal("fetch", async (url: string) => (urls.push(String(url)), url.includes("lsar") ? new Response(readFileSync(new URL("./fixtures/sport/lsar.json", import.meta.url))) : new Response("", { status: 503 })));
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
    const c = await cacheWith();
    const ile = body(await agenda(c, undefined, undefined, undefined, NOW));
    expect(ile.evenements.map((e: { titre: string }) => e.titre)).toEqual(["Kabar à Saint-Paul"]);
    expect(ile.non_repris).toContain(SEPT);
    expect(body(await agenda(c, "Le Port", undefined, undefined, NOW)).non_repris).toContain("Les mentions légales du site du Kabardock");
    expect(copiePlanifiee(await c.bundle(PLANIFIES, 60, true), SPORTSREGIONS)).toBeUndefined();
    // In a copy of a page built before: a hall's event, a club's event, by its link.
    expect([repris({ publie_par: "Léspas" }), repris({ publie_par: "Badminton Club", lien: "https://bcsp.sportsregions.fr/evenements/1" }), repris({ publie_par: "Le Séchoir", lien: "https://www.lesechoir.com/x" })]).toEqual([false, false, true]);
    const old = "Programmes des salles : TÉAT Champ Fleuri et Plein Air, Cité des Arts, Kabardock, Le Séchoir, Bisik, Théâtre Luc Donat, CDNOI, Léspas";
    expect(sourcesServies([{ source: old }, { source: "Sportsregions (calendrier des clubs), publié par chaque club" }])!.map((x) => x.source)).toEqual([SALLES.nom]);
    // The sport: golf answers its mention, nothing of the clubs, none of them read.
    const golf = body(await sportTool(c, "golf", undefined, "a_venir", NOW));
    expect([golf.resume, golf.non_repris, golf.a_venir, golf.non_lus]).toEqual([GOLF, CLUBS, undefined, undefined]);
    const all = body(await sportTool(c, undefined, undefined, "a_venir", NOW));
    expect(all.non_repris).toContain(TROIS);
    expect(sportPage("https://rundata.re", { value: { ...all, classements: [] }, fetchedAt: NOW, stale: false }, NOW)).toContain(`<p class="note np">${TROIS.replace(/'/g, "&#39;")} <a href="/ouvrir-ses-donnees#licence">Comment permettre la reprise</a></p>`);
    // The Théâtre Luc Donat, which agreed on 27/10, is read: the agendas read are set when the module loads.
    expect(urls.filter((u) => /teat|citedesarts|kabardock|bisik|cdnoi|lespas|sportsregions|ffgolf|ffvoile/.test(u))).toEqual([]);
  });

  it("are listed apart in sources_donnees, each with its terms, and not with the sources read", () => {
    unasked();
    const ids = toutesLesSources().map((s) => s.id);
    for (const id of ["ffgolf", "ffvoile", "sportsregions"]) expect(ids).not.toContain(id);
    expect(ids).toContain("salles_spectacle");
    const fiches = fichesNonReprises();
    expect(fiches.map((f) => f.nom)).toEqual(["TÉAT Champ Fleuri et Plein Air", "Cité des Arts", "Kabardock", "Bisik", "Théâtre Luc Donat", "CDNOI", "Léspas", "ffgolf", "FFVoile", "Sportsregions"]);
    expect(fiches.find((f) => f.nom === "ffgolf")).toEqual({ nom: "ffgolf", statut: "non repris", texte: GOLF, conditions: "https://www.ffgolf.org/conditions-generales-d-utilisation" });
    for (const f of fiches) expect(f.conditions).toMatch(/^https:\/\//);
  });
});
