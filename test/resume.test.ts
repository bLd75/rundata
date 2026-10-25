import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { count, counted, measured, WORKER_BUDGET } from "../src/budget.js";
import { Cache, type CacheEntry, MemoryStore, stampOf, TieredStore } from "../src/cache.js";
import { configure } from "../src/providers/mf-auth.js";
import { readCopies, resume, resumeDuJour, UPDATING } from "../src/tools/resume.js";
import { buildAir, buildPlace } from "../src/web/data.js";
import { pageOf } from "../src/web/places.js";
import { aujourdhuiPage } from "../src/web/aujourdhui.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
// Saturday 24 October 2026, 14:00 at La Réunion.
const NOW = new Date("2026-10-24T10:00:00Z");
const SAINT_PAUL = pageOf("saint-paul")!;
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const copy = <T>(value: T, min = 2) => ({ value, fetchedAt: ago(min), stale: false });
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

const info = (titre: string, communes: string[], sujets: string[], min = 30) => ({
  quand: "14:00", publie: ago(min).toISOString(), media: "Imaz Press", titre, communes, sujets, lien: `https://example.org/${encodeURIComponent(titre)}`,
});
const event = (titre: string, commune: string, date: string, quand: string) => ({ titre, commune, date, quand, lieu: "Kabardock", lien: "https://example.org/e" });
const SOURCE = (source: string) => [{ source, licence: "Licence Ouverte 2.0", attribution: source }];

/** The copies of the pages, as the site keeps them. */
const COPIES = {
  meteo: copy({
    meteo: { resume: "", sources: SOURCE("Météo-France"), stations: [
      { station: "Le Port", source: "meteofrance", altitude_m: 9, heure_mesure: "24/10 13:54", age_min: 6, distance_km: 6.1, pertinence: "faible", mesures: { temperature: "29,0 °C" }, avertissements: [] },
      { station: "Saint-Paul", source: "meteofrance", altitude_m: 30, heure_mesure: "24/10 13:54", age_min: 6, distance_km: 1.2, mesures: { temperature: "27,4 °C", pluie_1h: "0 mm" }, avertissements: [] },
    ] },
    prevision: { resume: "", sources: SOURCE("Open-Meteo"), jours: [{ jour: "Samedi 24/10", ciel_en_journee: "ensoleillé", temperature_min: "21 °C", temperature_max: "29 °C" }, { jour: "Dimanche 25/10" }] },
  }),
  mer: copy({ plages: [{ nom: "Boucan Canot", commune: "Saint-Paul", lon: 55.2, lat: -21.0, valeur: 24.6, jour: "2026-10-23" }, { nom: "Hermitage", commune: "Saint-Paul", lon: 55.2, lat: -21.1, valeur: 25.4, jour: "2026-10-23" }, { nom: "Grande Anse", commune: "Petite-Île", lon: 55.5, lat: -21.4, valeur: 23, jour: "2026-10-23" }], sources: SOURCE("NOAA") }),
  air: copy({ resume: "", nature: "", avertissements: [], sources: SOURCE("Atmo Réunion"), communes: [{ commune: "Saint-Paul", niveau: 2, qualite: "moyen", polluants: ["PM10"] }] }),
  electricite: copy({ resume: "", avertissements: [], sources: SOURCE("EDF"), production: { heure_mesure: "13:50", total_mw: 420, parts: [], renouvelable_pct: 38, statut: "" } }),
  actualites: copy({
    infos: [
      info("Barrage filtrant au rond-point de Savanna", ["Saint-Paul"], ["route", "mobilisation"]),
      info("Le marché forain déplacé", ["Saint-Paul"], ["vie locale"], 90),
      info("Hier soir à Saint-Paul", ["Saint-Paul"], ["faits divers"], 20 * 60),
      info("Route du Littoral basculée", ["La Possession"], ["route"]),
    ],
    en_direct: [], prefecture: [], chaud: true, indisponible: [], couverture: "", a_savoir: "", sources: SOURCE("Médias"),
  }),
  trafic: copy({
    bus: null, routes_forestieres: null, medias: [{ titre: "Bouchons sur la route des Tamarins", lien: "https://example.org/t", source: "Clicanoo" }], sources: SOURCE("Région"),
    carburants: { depuis: "2026-10-01", titre: "", lien: "https://example.org/prix", lu: "", produits: [{ produit: "Supercarburant", unite: "litre", prix_eur: 2, precedent_eur: 1.83 }, { produit: "Gazole", unite: "litre", prix_eur: 1.8, precedent_eur: 1.8 }] },
  }),
  dechets: copy({
    sources: SOURCE("TCO"),
    etats: [
      // Filled in at 13:00, and at 06:30: more than 6 h ago, not the state now.
      { lien: "https://www.tco.re/annuaire-tco/centre-de-proprete-de-plateau-caillou", maj: "2026-10-24T13:00:00+04:00", accepte: { dechets_verts: true, encombrants: false } },
      { lien: "https://www.tco.re/annuaire-tco/centre-de-proprete-du-guillaume-a-saint-paul", maj: "2026-10-24T11:00:00+04:00", accepte: { dechets_verts: false, encombrants: true } },
      { lien: "https://www.tco.re/annuaire-tco/centre-de-proprete-de-letang-saint-paul", maj: "2026-10-24T06:30:00+04:00", accepte: { dechets_verts: true } },
    ],
  }),
  coupures: copy({ resume: "", avis: [{ titre: "Coupure rue de la Gare", communes: ["Saint-Paul"], distributeur: "runéo", lien: "https://example.org/c", secteurs: ["Centre-ville"] }, { titre: "Coupure à Saint-Denis", communes: ["Saint-Denis"], distributeur: "Dionéo", lien: "https://example.org/d" }], couverture: "", a_savoir: "", sources: SOURCE("runéo"), communes_suivies: [] }),
  agenda: copy({
    resume: "", nombre: 3, couverture: "", a_savoir: "", sources: SOURCE("Agendas"), ce_week_end: [],
    evenements: [
      event("Concert au Kabardock", "Saint-Paul", "2026-10-24T20:00", "samedi 24/10 à 20:00"),
      event("Festival sur trois jours", "Saint-Paul", "2026-10-23T18:00", "du vendredi 23/10 à 18:00 au dimanche 25/10"),
      event("Marché de nuit", "Saint-Paul", "2026-10-30T18:00", "vendredi 30/10 à 18:00"),
      event("Fête au Tampon", "Le Tampon", "2026-10-24T10:00", "samedi 24/10 à 10:00"),
    ],
  }),
  commune: copy({
    sources: SOURCE("Annuaire de l'administration"),
    mairie: { nom: "Mairie de Saint-Paul", insee: "97415", adresse: "1 place du Général de Gaulle", lon: null, lat: null, fiche: "", telephone: "0262 45 90 00", horaires: [{ de: "lundi", a: "vendredi", plages: [["07h30", "12h00"], ["13h00", "16h00"]] }] },
    bus: { gare: true, arrets: [], departs: [], alertes: [{ reseau: "Kar'Ouest", titre: "Ligne 1 déviée" }] },
  }),
  calendrier: copy({ resume: "", sources: SOURCE("Éducation nationale"), jours_feries: { aujourd_hui: null, prochains: [], note: "" }, vacances_scolaires: { en_cours: { nom: "Vacances de la Toussaint", debut: "", reprise_des_cours: "" }, a_venir: [], note: "" } }),
} as const;

describe("the summary of a day", () => {
  it("says the commune's day from the copies, and nothing of the other communes", () => {
    const r = resume(SAINT_PAUL, COPIES as never, NOW);
    expect(r.commune).toBe("Saint-Paul");
    // The station that stands for the place, not the far one; the forecast said to be one.
    expect(r.meteo?.mesure?.station).toBe("Saint-Paul");
    expect(r.meteo?.prevision?.avertissement).toMatch(/PRÉVISION/);
    expect(r.meteo?.prevision?.demain).toBeUndefined();
    expect(r.mer).toMatchObject({ temperature_eau: "25 °C", au_large_de: ["Boucan Canot", "Hermitage"] });
    expect(r.air).toMatchObject({ indice_atmo: 2, qualite: "moyen" });
    expect(r.electricite).toMatchObject({ renouvelable_pct: 38 });
    // The roads: never a measure of the traffic jams; the news of the commune's roads, the island's apart.
    expect(r.circulation.mesure_des_bouchons).toMatch(/ne mesure pas les bouchons/);
    expect(r.circulation.waze).toMatch(/^https:\/\/www\.waze\.com\/ul\?ll=/);
    expect(r.circulation.infos_routes!.map((i) => i.titre)).toEqual(["Barrage filtrant au rond-point de Savanna"]);
    expect(r.circulation.routes_ile![0].titre).toBe("Bouchons sur la route des Tamarins");
    // The other news of the commune, of the last hours only.
    expect(r.actualites!.map((i) => i.titre)).toEqual(["Le marché forain déplacé"]);
    expect(r.coupures_eau!.avis.map((n) => n.titre)).toEqual(["Coupure rue de la Gare"]);
    // Today's events of the commune, those over several days included.
    expect(r.evenements_du_jour!.liste.map((e) => e.titre)).toEqual(["Concert au Kabardock", "Festival sur trois jours"]);
    // An event from a commune's site says so, in the tool and on the page.
    const ev = COPIES.agenda.value.evenements;
    const fromSite = resume(SAINT_PAUL, { ...COPIES, agenda: { ...COPIES.agenda, value: { ...COPIES.agenda.value, evenements: [{ ...ev[0], source: "site de la commune de Saint-Paul, lu le samedi 24/10 à 08:00" }, ...ev.slice(1)] } } } as never, NOW);
    expect(fromSite.evenements_du_jour!.liste[0].source).toBe("site de la commune de Saint-Paul, lu le samedi 24/10 à 08:00");
    expect(fromSite.evenements_du_jour!.liste[1].source).toBeUndefined();
    expect(aujourdhuiPage("https://rundata.re", SAINT_PAUL, fromSite, null)).toContain("Source\u00a0: site de la commune de Saint-Paul, lu le samedi 24/10 à 08:00");
    // Saturday: the town hall is closed all day; the buses' notices of the commune.
    expect(r.mairie).toMatchObject({ ouverte: false, horaires_aujourd_hui: "fermée aujourd'hui", telephone: "0262 45 90 00" });
    expect(r.circulation.bus).toEqual([{ reseau: "Kar'Ouest", titre: "Ligne 1 déviée" }]);
    expect(r.calendrier).toEqual({ jour_ferie: undefined, vacances_scolaires: "Vacances de la Toussaint" });
    expect(r.soleil.lever).toMatch(/^0[5-6]:\d\d$/);
    expect(r.resume).toMatch(/^Saint-Paul, samedi 24 octobre\u00a0; 27,4 °C mesurés à 13:54 \(station Saint-Paul\)\u00a0; prévision du jour 21 °C à 29 °C, ensoleillé\u00a0;/);
    expect(r.resume).toContain("2 événements aujourd'hui");
    // Saturday: the forain of Saint-Paul, from its OpenStreetMap days; the duty pharmacy never guessed.
    expect(r.marches_du_jour!.liste).toEqual([expect.objectContaining({ nom: "Marché forain de Saint-Paul", horaires_aujourd_hui: "de 8 h à 12 h" })]);
    expect(r.resume).toContain("marché aujourd'hui : Marché forain de Saint-Paul de 8 h à 12 h");
    expect(r.resume).toMatch(/pharmacie de garde : 3237\.fr\.$/);
    expect(r.pharmacie_de_garde).toMatchObject({ site: "https://www.3237.fr/", a_savoir: expect.stringMatching(/ne sait pas quelle pharmacie est de garde/) });
    // The skips: only the sites filled in less than 6 h ago say what they take.
    const sites = Object.fromEntries(r.decheteries!.sites.map((x) => [x.nom, x]));
    expect(sites["Déchèterie de Plateau Caillou"]).toMatchObject({ etat: "à jour", accepte: ["déchets verts"], benne_pleine: ["encombrants"] });
    expect(sites["Déchèterie de l'Étang"]).toEqual({ nom: "Déchèterie de l'Étang", mis_a_jour: "24/10 06:30", etat: "dernière mise à jour à 24/10 06:30, à vérifier sur place" });
    expect(sites["Déchèterie de Carrosse-Roquefeuil"].etat).toBe("pas de mise à jour");
    expect(r.decheteries!.page).toBe("https://rundata.re/decheteries#saint-paul");
    expect(r.resume).toContain("déchets verts acceptés dans 1 déchèterie sur 2");
    // The month's maximum prices, the same everywhere.
    expect(r.resume).toContain("carburants (prix maximum) : sans plomb 2,00 €/L, gazole 1,80 €/L\u00a0;");
    expect(r.carburants).toMatchObject({ depuis: "2026-10-01", prix_maximum: "sans plomb 2,00 €/L, gazole 1,80 €/L", prix_maximums: ["sans plomb 2,00 €/litre (+0,17 €)", "gazole 1,80 €/litre (stable)"] });
    // Each source once; the tap water is not a day's news (qualite_eau).
    expect(new Set(r.sources.map((s) => s.source)).size).toBe(r.sources.length);
    expect(JSON.stringify(r)).not.toMatch(/conforme/);
  });

  it("leaves out what it has no copy of, and says so", () => {
    const r = resume(SAINT_PAUL, { meteo: COPIES.meteo } as never, NOW, [{ partie: "coupures d'eau", raison: "pas de copie récente", outil: "coupures_eau", page: "https://rundata.re/coupures-eau/saint-paul" }]);
    expect(r.coupures_eau).toBeUndefined();
    expect(r.evenements_du_jour).toBeUndefined();
    expect(r.circulation.mesure_des_bouchons).toBeTruthy();
    expect(r.non_inclus).toEqual([{ partie: "coupures d'eau", raison: "pas de copie récente", outil: "coupures_eau", page: "https://rundata.re/coupures-eau/saint-paul" }]);
    // The sea from the weather page's own reading, when the sea's page has no copy: then it is not said missing.
    const withSea = { meteo: copy({ ...COPIES.meteo.value, mer: { resume: "", sources: [], mesure: { temperature_eau: "24,7 °C", jour_mesure: "2026-10-23", distance_km: 3 } } }) };
    const r2 = resume(SAINT_PAUL, withSea as never, NOW, [{ partie: "température de la mer", raison: "pas de copie récente", outil: "temperature_mer", page: "https://rundata.re/mer" }]);
    expect(r2.mer?.temperature_eau).toBe("24,7 °C");
    expect(r2.non_inclus).toBeUndefined();
  });

  it("says neither last month's fuel prices, nor a market on its day off, nor skips outside the TCO", () => {
    const old = copy({ ...COPIES.trafic.value, carburants: { ...COPIES.trafic.value.carburants, depuis: "2026-09-01" } });
    const sunday = new Date("2026-10-25T04:00:00Z");
    const r = resume(SAINT_PAUL, { trafic: old, dechets: COPIES.dechets } as never, sunday);
    expect(r.carburants).toBeUndefined();
    expect(r.marches_du_jour).toBeUndefined();
    // A day later, every site's state is of another day.
    expect(r.decheteries!.sites.every((x) => x.accepte === undefined && x.benne_pleine === undefined)).toBe(true);
    expect(r.resume).not.toMatch(/déchets verts acceptés/);
    const tampon = pageOf("le-tampon")!;
    expect(resume(tampon, COPIES as never, NOW).decheteries).toBeUndefined();
  });

  it("in the evening, gives tomorrow's forecast too", () => {
    const r = resume(SAINT_PAUL, { meteo: COPIES.meteo } as never, new Date("2026-10-24T14:30:00Z"));
    expect(r.meteo?.prevision?.demain?.jour).toBe("Dimanche 25/10");
  });
});

/** The data center's cache: each read or write is a subrequest. */
class EdgeLike extends MemoryStore {
  async get(key: string) {
    count();
    return super.get(key);
  }
  async put(key: string, entry: CacheEntry) {
    count();
    return super.put(key, entry);
  }
}

const KEYS: Record<string, string> = {
  meteo: "web:lieu:saint-paul", commune: "web:commune:saint-paul", air: "web:air", mer: "web:mer", electricite: "web:electricite", actualites: "web:actualites",
  trafic: "web:trafic", coupures: "web:coupures", agenda: "web:agenda", calendrier: "web:calendrier", dechets: "web:dechets",
};

/** An edge holding the copies, `old` of them read hours ago, `missing` never built. */
async function edgeWith(old: string[] = [], missing: string[] = []) {
  const edge = new EdgeLike();
  for (const [part, c] of Object.entries(COPIES)) {
    if (missing.includes(part)) continue;
    await edge.put(KEYS[part], { value: c.value, fetchedAt: (old.includes(part) ? ago(5 * 60) : c.fetchedAt).getTime() });
  }
  return edge;
}
const isolate = (edge: EdgeLike) => new Cache(new TieredStore(new MemoryStore(), edge), () => NOW.getTime(), false, new MemoryStore());

beforeEach(() => {
  configure({ applicationId: "test" });
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    if (u.includes("/token")) return Response.json({ access_token: "t", expires_in: 3600 });
    if (u.includes("DPPaquetObs")) return new Response(fixture("meteofrance_6min.csv"));
    if (u.includes("DPVigilance")) return new Response(fixture("vigilance_om.zip"));
    if (u.includes("aviationweather")) return new Response(fixture("metar.json"));
    if (u.endsWith("/live/all")) return new Response(fixture("pioupiou_all.json"));
    if (u.includes("/thredds/dodsC/gridLEODYNRTL3SWW00/")) return new Response(fixture("acspo.ascii"));
    if (u.includes("erdMH1sstd1day")) return new Response(fixture("modis.csv"));
    if (u.includes("open-meteo.com/data")) return new Response(fixture("openmeteo_meta.json"));
    if (u.includes("open-meteo")) return new Response(fixture("openmeteo_cilaos.json"));
    if (u.includes("GetCapabilities")) return new Response("<x></x>");
    return new Response("", { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  configure({});
});

describe("reading the copies", () => {
  it("keeps the recent ones, names the others with the tool to call, and reads nothing else", async () => {
    const { value } = await counted(WORKER_BUDGET, () => readCopies(isolate(new EdgeLike()), SAINT_PAUL, SAINT_PAUL, NOW));
    // Nothing at all: every part named, nothing refreshed without a way to finish after the answer.
    expect(value.leftOut.map((x) => x.outil)).toEqual(expect.arrayContaining(["meteo_actuelle et prevision_meteo", "coupures_eau", "evenements", "actualites"]));
    expect(value.refreshed).toBeUndefined();

    const { value: v2 } = await counted(WORKER_BUDGET, async () => readCopies(isolate(await edgeWith(["coupures"])), SAINT_PAUL, SAINT_PAUL, NOW));
    expect(v2.copies.coupures).toBeUndefined();
    expect(v2.copies.agenda).toBeTruthy();
    expect(v2.leftOut.find((x) => x.outil === "coupures_eau")).toEqual({ partie: "coupures d'eau", raison: "copie de 24/10 09:00, trop ancienne", outil: "coupures_eau", page: "https://rundata.re/coupures-eau/saint-paul" });
  });

  it("brings the oldest missing copy up to date after the answer, only within the invocation's subrequests", async () => {
    // What each build takes, learnt as the site would (budget.ts keeps the most of it per isolate): the weather page's
    // is more than what is left after the reads, the air's is not.
    await counted(WORKER_BUDGET, () => measured(KEYS.meteo, () => buildPlace(isolate(new EdgeLike()), SAINT_PAUL, NOW)));
    await counted(WORKER_BUDGET, () => measured(KEYS.air, () => buildAir(isolate(new EdgeLike()), NOW)).catch(() => undefined));
    const once = async (missing: string) => {
      const pending: Promise<unknown>[] = [];
      const edge = await edgeWith([], [missing]);
      const run = await counted(WORKER_BUDGET, async () => {
        const r = await readCopies(isolate(edge), SAINT_PAUL, SAINT_PAUL, NOW, (p) => pending.push(p));
        await Promise.all(pending);
        return r;
      });
      return { refreshed: run.value.refreshed, ...(await run.settled()) };
    };
    const air = await once("air");
    expect(air.refreshed).toBe(KEYS.air);
    expect(air.used).toBeLessThanOrEqual(WORKER_BUDGET);
    expect(air.refused).toBe(0);
    // Too costly to fit: left to the commune page, which brings it up to date on its own.
    const meteo = await once("meteo");
    expect(meteo.refreshed).toBeUndefined();
    expect(meteo.used).toBeLessThanOrEqual(WORKER_BUDGET);
  });

  it("leaves out a recent copy built before its family's revision was raised, and brings it up to date first", async () => {
    await counted(WORKER_BUDGET, () => measured(KEYS.air, () => buildAir(isolate(new EdgeLike()), NOW)).catch(() => undefined));
    const edge = new EdgeLike();
    for (const [part, c] of Object.entries(COPIES)) {
      await edge.put(KEYS[part], { value: c.value, fetchedAt: c.fetchedAt.getTime(), version: part === "air" ? "rendu-0" : stampOf(KEYS[part], "2.0.0") });
    }
    const cache = new Cache(new TieredStore(new MemoryStore(), edge), () => NOW.getTime(), false, new MemoryStore(), "2.0.0");
    const pending: Promise<unknown>[] = [];
    const run = await counted(WORKER_BUDGET, async () => {
      const r = await readCopies(cache, SAINT_PAUL, SAINT_PAUL, NOW, (p) => pending.push(p));
      await Promise.all(pending);
      return r;
    });
    expect(run.value.copies.air).toBeUndefined();
    expect(run.value.leftOut.find((x) => x.partie === "qualité de l'air")).toMatchObject({ raison: UPDATING, outil: "qualite_air" });
    expect(run.value.copies.coupures).toBeTruthy();
    expect(run.value.refreshed).toBe(KEYS.air);
  });

  it("never shows an event of an agenda no longer read from a copy built before, and says the events are updating", async () => {
    const LE_TAMPON = pageOf("le-tampon")!;
    const unread = { ...event("Fête des goyaviers", "Le Tampon", "2026-10-24T10:00", "samedi 24/10 à 10:00"), lien: "https://www.letampon.fr/agenda/fete", source: "site de la commune du Tampon, lu le samedi 24/10 à 08:00" };
    const agenda = { ...COPIES.agenda.value, evenements: [unread] };
    const summary = async (version: string) => {
      const edge = new EdgeLike();
      await edge.put(KEYS.agenda, { value: agenda, fetchedAt: ago(2).getTime(), version });
      const cache = new Cache(new TieredStore(new MemoryStore(), edge), () => NOW.getTime(), false, new MemoryStore(), "2.0.0");
      const { copies, leftOut } = await counted(WORKER_BUDGET, () => readCopies(cache, LE_TAMPON, LE_TAMPON, NOW)).then((r) => r.value);
      return resume(LE_TAMPON, copies, NOW, leftOut);
    };
    // Of this revision, the copy is served, but not the event of a site no longer read (tools/agenda.ts, repris).
    const current = await summary(stampOf(KEYS.agenda, "2.0.0")!);
    expect(current.evenements_du_jour).toBeDefined();
    expect(JSON.stringify(current)).not.toContain("Fête des goyaviers");
    expect(current.non_inclus ?? []).not.toContainEqual(expect.objectContaining({ partie: "événements du jour" }));
    const r = await summary("rendu-0");
    expect(JSON.stringify(r)).not.toContain("Fête des goyaviers");
    expect(JSON.stringify(r)).not.toContain("letampon.fr");
    expect(r.non_inclus).toContainEqual(expect.objectContaining({ partie: "événements du jour", raison: UPDATING, outil: "evenements" }));
    const page = aujourdhuiPage("https://rundata.re", LE_TAMPON, r, null);
    expect(page).toContain("Se met à jour : rechargez la page dans quelques minutes.");
    expect(page).not.toContain("Fête des goyaviers");
  });

  it("answers through the tool within the budget, naming the commune of the place asked", async () => {
    const pending: Promise<unknown>[] = [];
    const run = await counted(WORKER_BUDGET, async () => {
      const r = await resumeDuJour(isolate(await edgeWith()), "Boucan Canot", NOW, (p) => pending.push(p));
      await Promise.all(pending);
      return r;
    });
    const r = body(run.value);
    expect(r.lieu.commune).toBe("Saint-Paul");
    expect(r.commune).toBe("Saint-Paul");
    expect(r.coupures_eau.avis).toHaveLength(1);
    expect((await run.settled()).used).toBeLessThanOrEqual(WORKER_BUDGET);
  });

  it("says when the place is not found", async () => {
    const r = await resumeDuJour(new Cache(), "Xyzzyville du Nord", NOW);
    expect(body(r).erreur).toMatch(/introuvable/);
  });
});
