import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { buildChiffres, buildEvenements, cadenceEnMots, chiffres, cle, clubs, type Copie, DOMAINES, EVENEMENTS_KEY, evenementsEvery, KEY, resume, SANS_MAX, sansAgendas } from "../src/chiffres.js";
import { compte, FICHES, producteursDe } from "../src/producteurs.js";
import { AGENDAS } from "../src/providers/agenda.js";
import { CONNECTEURS } from "../src/providers/agenda-connecteurs.js";
import { PROPOSITIONS } from "../src/providers/agenda-propositions.js";
import { STATIONS as BORNES } from "../src/providers/irve.js";
import { createServer, toutesLesSources } from "../src/server.js";
import { CATEGORIES } from "../src/web/categories.js";
import { chiffresPage } from "../src/web/chiffres.js";
import { COMMUNES } from "../src/web/commune.js";
import { typo } from "../src/web/typo.js";

// 26/10/2026 08:00 in La Réunion.
const NOW = new Date("2026-10-26T04:00:00Z");
const all = toutesLesSources(true);
const sources = toutesLesSources();
const at = (iso: string) => ({ le: iso });
// The tools this server registers, as the connector lists them (fewer than OUTILS without the bases of the Worker).
const OUTILS_ICI = Object.keys((createServer(new Cache(new MemoryStore())) as unknown as { _registeredTools: object })._registeredTools).length;

const COPIE: Copie = {
  stations_meteo: { nombre: 59, ...at("2026-10-26T04:00:00Z") },
  velos: { nombre: 21, ...at("2026-10-26T04:00:00Z") },
  // Kept from the copy before: its source did not answer at 08:00.
  sentiers: { nombre: 351, fermes: 12, ...at("2026-10-26T02:00:00Z") },
  coupures_eau: { nombre: 3, ...at("2026-10-26T03:55:00Z") },
  coupures_electricite: { nombre: 0, ...at("2026-10-26T03:20:00Z") },
  sans_reponse: { nombre: 3, passage: Math.floor(Date.parse("2026-10-26T02:00:00Z") / 1000), ...at("2026-10-26T04:00:00Z") },
  evenements: { nombre: 214, ...at("2026-10-26T00:50:00Z") },
  clubs: { nombre: 9, ...at("2026-10-26T04:00:00Z") },
};
const copie = { value: COPIE, fetchedAt: NOW, stale: false };

describe("the domains of /chiffres (chiffres.ts)", () => {
  it("put every source counted in a category of the menu, and name only sources read", () => {
    const counted = all.filter((s) => !FICHES[s.id].horsCompte).map((s) => s.id);
    const placed = new Set(DOMAINES.flatMap((d) => d.sources()));
    expect(counted.filter((id) => !placed.has(id))).toEqual([]);
    expect([...placed].filter((id) => !FICHES[id])).toEqual([]);
    for (const d of DOMAINES) {
      expect(CATEGORIES.some((c) => c.key === d.categorie), d.categorie).toBe(true);
      if (d.cadence) expect(d.sources(), d.categorie).toContain(d.cadence.de);
    }
  });

  it("say each rate in words", () => {
    expect([1, 5, 60, 360, 1440].map(cadenceEnMots)).toEqual(["chaque minute", "toutes les 5 min", "chaque heure", "toutes les 6 h", "chaque jour"]);
  });
});

describe("the producers counted live", () => {
  it("are the charge point operators of the bundled base, each once", () => {
    const irve = producteursDe(all.find((s) => s.id === "irve")!);
    expect(irve.length).toBe(new Set(BORNES.map((s) => s.reseau.toLowerCase())).size);
    expect(irve).toContain("Freshmile");
    expect(irve.join()).not.toMatch(/transport\.data\.gouv/);
  });

  it("key a name whatever its spelling: case, accents, punctuation, « St », a commune's « Ville » or « Mairie »", () => {
    expect(cle("Ville du Port")).toBe(cle("Commune du Port"));
    expect(cle("Mairie de Saint-Leu")).toBe(cle("Commune de Saint-Leu"));
    expect(cle("ST LEU Natation")).toBe(cle("Saint-Leu natation"));
    expect(cle("Club  Nautique  de l'Étang-Salé")).toBe(cle("club nautique de l etang sale"));
    expect(cle("Ste Marie Basket")).toBe(cle("Sainte-Marie basket"));
  });

  it("count each club of Sportsregions once, never « un club », nor a body named already", () => {
    const e = (nom: string) => ({ organisateur: { nom } });
    expect(clubs([e("Badminton Club de Saint-Pierre"), e("BADMINTON CLUB DE ST PIERRE"), e("un club"), e("Ligue réunionnaise de volley-ball"), e("Ville de Sainte-Marie"), e("Club de plongée Bleu Marine")])).toBe(2);
    expect(clubs([])).toBe(0);
  });
});

describe("the counts (chiffres.ts)", () => {
  it("count from the code alone before any copy: no count of the sources, never a 0 for them", () => {
    const c = chiffres(sources, undefined, NOW, OUTILS_ICI);
    const k = compte(sources);
    expect(c.sources).toBe(k.sources);
    expect(c.producteurs).toBe(k.producteurs.length);
    expect(Object.values(c.licences).reduce((a, b) => a + b, 0)).toBe(c.sources);
    expect(c.communes).toBe(COMMUNES.length);
    expect(c.communes).toBe(24);
    expect(c.outils).toBe(OUTILS_ICI);
    expect(c.terrain.stations_meteo).toBeUndefined();
    expect(c.en_ce_moment.evenements_deux_semaines).toBeUndefined();
    expect(c.manque.sites_sans_reponse).toBeUndefined();
    expect(c.compte_le).toBe("26/10 à 08:00");
    expect(c.par_domaine.every((d) => d.sources > 0)).toBe(true);
    expect(c.par_domaine.find((d) => d.domaine === "Terrain et risques")?.cadence).toBe("à chaque question");
    // pitonlive.com counted among the producers, never named.
    expect(c.par_domaine.flatMap((d) => d.producteurs).join()).not.toMatch(/pitonlive/i);
    expect(k.producteurs.join()).toMatch(/pitonlive/i);
  });

  it("say how often each domain is read: in words, « à chaque version du site » for a bundled list, nothing when not known here", () => {
    const c = chiffres(sources, undefined, NOW, OUTILS_ICI);
    const lecture = (domaine: string) => c.par_domaine.find((d) => d.domaine === domaine)!.cadence;
    expect(lecture("Défibrillateurs")).toBe("à chaque version du site");
    expect(lecture("Volcan")).toBe("toutes les 10 min");
    // A rate whose source is not read here (no key): left out, never « — ».
    const sansCle = DOMAINES.filter((d) => d.cadence && !sources.some((s) => s.id === d.cadence!.de));
    for (const d of sansCle) expect(c.par_domaine.find((x) => x.domaine === CATEGORIES.find((k) => k.key === d.categorie)!.nom)?.cadence, d.categorie).toBeUndefined();
    expect(c.par_domaine.map((d) => d.cadence).join()).not.toContain("—");
  });

  it("add the clubs to the producers, and keep each count's hour", () => {
    const c = chiffres(sources, copie, NOW, OUTILS_ICI);
    expect(c.producteurs).toBe(compte(sources).producteurs.length + 9);
    expect(c.terrain.sentiers_onf).toEqual({ nombre: 351, compte_le: "26/10 à 06:00", fermes: 12 });
    expect(c.manque.sites_sans_reponse).toEqual({ nombre: 3, compte_le: "26/10 à 08:00", derniere_reverification: "26/10 à 06:00" });
  });

  it("sum it up in marketing's words", () => {
    const c = chiffres(sources, copie, NOW, OUTILS_ICI);
    expect(resume(c)).toBe(`rundata.re lit ${c.sources} sources publiques, dont ${c.sous_licence_ouverte} sous licence ouverte, de ${c.producteurs} producteurs\u00a0; ` +
      `${c.outils} outils, une page du jour pour chacune des 24 communes\u00a0; 3 sites publics sans réponse en ce moment (voir sites_sans_reponse). Compté le 26/10 à 08:00 : https://rundata.re/chiffres`);
    const none = chiffres(sources, { ...copie, value: { ...COPIE, sans_reponse: { ...COPIE.sans_reponse!, nombre: 0 } } }, NOW, OUTILS_ICI);
    expect(resume(none)).toContain("\u00a0; aucun site public sans réponse à la revérification du 26/10 (voir sites_sans_reponse).");
  });

  it("keep the copy before's counts when their sources do not answer, and add none of their own", async () => {
    const store = new MemoryStore();
    await store.put(KEY, { value: COPIE, fetchedAt: NOW.getTime() - 3600_000 });
    // No network in the tests: every source fails.
    const got = await buildChiffres(new Cache(store, () => NOW.getTime()), NOW);
    expect(got.sentiers).toEqual(COPIE.sentiers);
    expect(got.velos).toEqual(COPIE.velos);
    expect(got.stations_meteo).toEqual(COPIE.stations_meteo);
    expect(got.evenements).toEqual(COPIE.evenements);
    const first = await buildChiffres(new Cache(new MemoryStore(), () => NOW.getTime()), NOW);
    expect(first.sentiers).toBeUndefined();
    expect(Object.values(first).some((v) => typeof v === "object" && "nombre" in v && v.nombre === 0 && v !== first.sans_reponse)).toBe(false);
    expect(got.construite_le).toBe(NOW.toISOString());
  });

  it("count the events without one or two agendas, else keep the last whole count, and read the list again an hour later, not at every event", async () => {
    // No network in the tests: the agendas do not answer, the list is in part.
    const partial = await buildEvenements(new Cache(new MemoryStore(), () => NOW.getTime()), NOW);
    expect(partial.sans?.length).toBeGreaterThan(0);
    expect(evenementsEvery(partial)).toBe(60);
    expect(evenementsEvery({ nombre: 120 })).toBe(6 * 60);
    expect(evenementsEvery(undefined)).toBe(6 * 60);
    const withEvents = async (value: object) => {
      const store = new MemoryStore();
      await store.put(KEY, { value: COPIE, fetchedAt: NOW.getTime() - 3600_000 });
      await store.put(EVENEMENTS_KEY, { value, fetchedAt: NOW.getTime() - 60_000 });
      const got = await buildChiffres(new Cache(store, () => NOW.getTime()), NOW);
      return [got.evenements, got.evenements_complet];
    };
    const le = new Date(NOW.getTime() - 60_000).toISOString();
    expect(await withEvents({ nombre: 120 })).toEqual([{ nombre: 120, le }, { nombre: 120, le }]);
    // The copy before's count was whole: the last whole count, until a list is whole again.
    expect(await withEvents({ nombre: 99, sans: ["Le Séchoir"] })).toEqual([{ nombre: 99, le, sans: ["Le Séchoir"] }, COPIE.evenements]);
    // An agenda read twice (its agenda and its news) is one agenda missing.
    expect(await withEvents({ nombre: 98, sans: ["Ville de Saint-Louis", "Ville de Saint-Louis", "Léspas"] })).toEqual([{ nombre: 98, le, sans: ["Ville de Saint-Louis", "Léspas"] }, COPIE.evenements]);
    expect(SANS_MAX).toBe(2);
    expect(await withEvents({ nombre: 90, sans: ["Le Séchoir", "Léspas", "Kabardock"] })).toEqual([undefined, COPIE.evenements]);
    expect(await withEvents({ nombre: 90, sans: ["Le Séchoir", "Léspas", PROPOSITIONS.nom] })).toEqual([undefined, COPIE.evenements]);
    // No agenda answered: no list, no count of it.
    expect(await withEvents({ sans: ["agenda"] })).toEqual([undefined, COPIE.evenements]);
  });

  it("date the copy by its build, not its write: a build that ends the minute after marks only the counts kept", () => {
    const late = { value: { ...COPIE, construite_le: NOW.toISOString() }, fetchedAt: new Date(NOW.getTime() + 70_000), stale: false };
    const c = chiffres(sources, late, NOW, OUTILS_ICI);
    expect(c.compte_le).toBe("26/10 à 08:00");
    const html = typo(chiffresPage("https://rundata.re", c));
    expect(html).not.toContain("(compté le 26/10 à\u00a008:00)");
    expect(html).toContain("(compté le 26/10 à\u00a006:00)");
    // A copy written before the build's hour was kept: its write's hour, as before.
    expect(chiffres(sources, copie, NOW, OUTILS_ICI).compte_le).toBe("26/10 à 08:00");
  });
});

describe("the page /chiffres", () => {
  const html = typo(chiffresPage("https://rundata.re", chiffres(sources, copie, NOW, OUTILS_ICI)));

  it("says marketing's words, and each figure leads to its page", () => {
    expect(html).toContain("<h1>rundata.re en chiffres</h1>");
    expect(html).toContain("<title>rundata.re en chiffres\u00a0: sources, producteurs, licences · rundata.re</title>");
    for (const h of ["L'essentiel", "Par domaine", "Sur le terrain", "En ce moment", "Les licences", "Ce qui manque", "Depuis le début"]) expect(html).toContain(`>${h}</h2>`);
    expect(html).toContain("communes, une page du jour pour chacune");
    expect(html).toContain('href="/sentiers">351</a>');
    expect(html).toMatch(/sources sont publiées sous une licence ouverte \(Licence Ouverte, ODbL, CC BY, domaine public\)\. Pour les autres, des informations publiques, rundata\.re ne reprend que les faits, avec le lien de la source\./);
    expect(html).toContain('3 sites publics ne répondent pas en ce moment\u00a0: <a href="/sites-sans-reponse">voir les sites sans réponse</a>.');
    expect(html).toContain("Compté le 26/10 à\u00a008:00, à partir des sources que lit rundata.re. Une source manque\u00a0? Dites-le avec le formulaire en bas de page.");
  });

  it("names the one or two agendas the events were counted without, or says the last whole count, in marketing's words", () => {
    const page = (value: Copie) => typo(chiffresPage("https://rundata.re", chiffres(sources, { ...copie, value }, NOW, OUTILS_ICI)));
    const sans = (noms: string[]) => page({ ...COPIE, evenements: { ...COPIE.evenements!, sans: noms } });
    const fig = 'href="/evenements">214</a><span>événements dans les deux semaines qui viennent, ';
    expect(sans(["Mairie de Saint-Paul"])).toContain(`${fig}sans l&#39;agenda de la mairie de Saint-Paul, dont le site n&#39;a pas répondu à notre dernière lecture. <small>(compté le 26/10 à`);
    expect(sans(["Mairie de Saint-Paul", "Le Séchoir"])).toContain(`${fig}sans les agendas de la mairie de Saint-Paul et du Séchoir, dont les sites n&#39;ont pas répondu à notre dernière lecture. <small>`);
    // rundata.re's own base: « dont le site n'a pas répondu » would be false for it.
    expect(sans([PROPOSITIONS.nom])).toContain(`${fig}sans les événements proposés sur rundata.re pour le moment. <small>`);
    expect(sans(["Mairie de Saint-Paul", PROPOSITIONS.nom])).toContain(`${fig}sans l&#39;agenda de la mairie de Saint-Paul, dont le site n&#39;a pas répondu à notre dernière lecture, ni les événements proposés sur rundata.re pour le moment. <small>`);
    expect(html).toContain("événements dans les deux semaines qui viennent <small>");
    // Past two missing: the last whole count, its hour said once.
    const complet = page({ ...COPIE, evenements: undefined, evenements_complet: COPIE.evenements });
    expect(complet).toMatch(/href="\/evenements">214<\/a><span>événements dans les deux semaines qui viennent, d&#39;après notre dernier compte complet, le 26\/10 à\s04:50\.<\/span>/);
    const c = (value: Copie) => chiffres(sources, { ...copie, value }, NOW, OUTILS_ICI).en_ce_moment.evenements_deux_semaines;
    expect(c({ ...COPIE, evenements: { ...COPIE.evenements!, sans: ["CINOR"] } })).toEqual({ nombre: 214, compte_le: "26/10 à 04:50", incomplet: "sans l'agenda de la CINOR, dont le site n'a pas répondu à notre dernière lecture" });
    expect(c({ ...COPIE, evenements: undefined, evenements_complet: COPIE.evenements })).toEqual({ nombre: 214, compte_le: "26/10 à 04:50", incomplet: "d'après notre dernier compte complet, le 26/10 à 04:50" });
    expect(c(COPIE)).not.toHaveProperty("incomplet");
  });

  it("gives every agenda read its article after « l'agenda », never « de Le » nor « de Les »", () => {
    // The linked associations' agenda is never named: no site of theirs was asked.
    expect(sansAgendas([CONNECTEURS.nom])).toBe("");
    expect(sansAgendas([CONNECTEURS.nom, "Ville du Port"])).toBe("sans l'agenda de la Ville du Port, dont le site n'a pas répondu à notre dernière lecture");
    for (const a of AGENDAS.filter((x) => x !== PROPOSITIONS && x !== CONNECTEURS)) expect(sansAgendas([a.nom]), a.id).toMatch(/^sans l'agenda (de la (?!Mairie )|de l'|du |des |de (?!Le |La |Les |Clubs |Ville |Mairie ))\S/);
    const de = (nom: string) => sansAgendas([nom]).replace(/^sans l'agenda /, "").replace(/, dont .*$/, "");
    expect(de("Le Port")).toBe("du Port");
    expect(de("Les Avirons")).toBe("des Avirons");
    expect(de("Mairie des Trois-Bassins")).toBe("de la mairie des Trois-Bassins");
    expect(de("Ville du Port")).toBe("de la Ville du Port");
    expect(de("Office de tourisme de l'Est")).toBe("de l'Office de tourisme de l'Est");
    expect(sansAgendas(["Clubs sportifs (Sportsregions)", "Ville du Port"])).toBe("sans les agendas des clubs sportifs (Sportsregions) et de la Ville du Port, dont les sites n'ont pas répondu à notre dernière lecture");
  });

  it("says the hour of a count kept from an earlier copy, and never shows a count not made", () => {
    expect(html).toContain("(compté le 26/10 à\u00a006:00)");
    const bare = typo(chiffresPage("https://rundata.re", chiffres(sources, undefined, NOW, OUTILS_ICI)));
    expect(bare).not.toContain("stations météo lues");
    expect(bare).not.toContain("En ce moment");
    expect(bare).not.toContain("Ce qui manque");
  });

  it("names the prefecture beside the OVPF on the volcano's row, never pitonlive.com, and OpenStreetMap's contributors", () => {
    const volcan = html.match(/<tr><th scope="row"><a href="\/volcan">Volcan<\/a><\/th>.*?<\/tr>/)![0];
    expect(volcan).toContain("OVPF-IPGP");
    expect(volcan).toContain("Préfecture de La Réunion");
    expect(volcan).not.toMatch(/pitonlive/i);
    expect(html).toMatch(/contributeurs d(?:'|&#39;|&#x27;)OpenStreetMap/);
    expect(html).not.toMatch(/<td data-label="Lecture">—/);
  });

  it("never names the data missing for want of an authorisation before its page is online", () => {
    expect(html).not.toContain("donnees-manquantes");
  });
});
