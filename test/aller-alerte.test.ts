import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import * as mf from "../src/providers/vigilance.js";
import * as onf from "../src/providers/sentiers.js";
import * as traces from "../src/providers/traces.js";
import type * as transit from "../src/providers/transit.js";
import { resume } from "../src/tools/resume.js";
import * as dech from "../src/vie/decheteries.js";
import { ZONES } from "../src/eau/requin.js";
import { ORSEC } from "../src/tools/ecoles.js";
import { COMMON } from "../src/tools/eau.js";
import { unzip } from "../src/zip.js";
import { permis, retire } from "../src/web/aller.js";
import { stopPage } from "../src/web/arret.js";
import { aujourdhuiPage } from "../src/web/aujourdhui.js";
import { bathingPage } from "../src/web/baignade.js";
import { communePage } from "../src/web/commune.js";
import { alerteOf, buildDae, buildRoute, type Alerte, type AgendaAnswer, type BorneStation, type EauAnswer, type SeaData } from "../src/web/data.js";
import { decheteriesPage } from "../src/web/decheteries.js";
import { agendaPage, bornesPage, daePage, eauPage, tracePage, velosPage } from "../src/web/domains.js";
import { enfantsCommunePage, enfantsPage } from "../src/web/enfants.js";
import { concertsPage, weekendPage } from "../src/web/evenements.js";
import { placePage, seaPage } from "../src/web/pages.js";
import { pageOf } from "../src/web/places.js";

const O = "https://rundata.re";
// Friday 30/10/2026, 08:00 at La Réunion.
const NOW = new Date("2026-10-30T04:00:00Z");
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const cached = <T>(value: T) => ({ value, fetchedAt: NOW, stale: false });
const buttons = (html: string) => [...html.matchAll(/class="aller"[^>]*aria-label="Y aller : ([^"]+)"/g)].map((m) => m[1]);
const sheets = (html: string) => html.match(/<dialog id="aller"/g)?.length ?? 0;

/** The banner's alert as alerteOf reads it from Météo-France's vigilance: in force since midnight, or only announced for tonight. */
let sample: mf.Vigilance;
function level(c: number, prevue = false): Alerte {
  const v = structuredClone(sample);
  v.zones[mf.ISLAND][mf.CYCLONE] = prevue
    ? [{ couleur: 1, debut: "2026-10-29T20:00:00Z", fin: "2026-10-30T16:00:00Z" }, { couleur: c, debut: "2026-10-30T16:00:00Z" }]
    : [{ couleur: c, debut: "2026-10-29T20:00:00Z" }];
  return alerteOf(v, NOW)!;
}

// The pages: an event with its place (a concert on Saturday: the week-end's and the concerts' pages too), a station, the beaches and bathing zones, a recycling centre, children's places,
// a bus stop, the town hall and the day's markets, a hike's start, the defibrillators.
const ev = { titre: "Atelier d'échecs", date: "2026-10-31T19:00", quand: "samedi 31/10 à 19:00", genres: ["concert"], commune: "Saint-Denis", lien: "https://example.org", publie_par: "CINOR", lieu: "Bibliothèque Alain Lorraine", position: { lat: -20.8927, lon: 55.4513 } };
const agenda = cached({ resume: "", nombre: 1, evenements: [ev], ce_week_end: [], couverture: "", a_savoir: "", sources: [] } as unknown as AgendaAnswer);
const velos = cached({ stations: [{ nom: "IUT", commune: "Saint-Pierre", velos_electriques: 3, maj: "07:55", lat: -21.34, lon: 55.49 }], communes: [], service: "Altervélo", donnees: "", sources: [] } as never);
const sea = cached({ plages: [{ nom: "Plage de Boucan-Canot", commune: "Saint-Paul", lon: 55.22, lat: -21.03, valeur: 25, jour: "2026-10-29", distance_km: 3 }], sources: [] } as unknown as SeaData);
const stop = { slug: "saint-paul/mairie", nom: "Mairie", commune: "Saint-Paul", indexe: true, groups: [{ reseau: "carjaune", nom: "Mairie", commune: "Saint-Paul", ids: [1], lat: -21.0096, lon: 55.27, words: new Set<string>() }] } as unknown as transit.StopPage;
// The same stop with two networks' stops 200 m apart: one button each, named by its network.
const g2 = (reseau: string, lat: number) => ({ reseau, nom: "Mairie", commune: "Saint-Paul", ids: [1], lat, lon: 55.27, words: new Set<string>() });
const stops = { ...stop, groups: [g2("carjaune", -21.0096), g2("karouest", -21.0114)] } as unknown as transit.StopPage;
const p = pageOf("saint-paul")!;
// Saturday 24/10/2026: the Saint-Paul market is held.
const SAT = new Date("2026-10-24T07:10:00Z");
const mairie = { nom: "Mairie de Saint-Paul", insee: "97415", adresse: "Place de l'Exemple, 97460 Saint-Paul", lon: 55.27, lat: -21.01, horaires: [], fiche: "https://example.org" };
const today = resume(p, { commune: { value: { mairie, sources: [] }, fetchedAt: SAT, stale: false } } as never, SAT);
const hike = traces.RANDONNEES.find((r) => r.sentiers_onf.length)!;
const borne = { station: "Exemple", commune: "Saint-Paul", puissance_max_kw: 22, prises: ["Type 2"], lon: 55.27, lat: -21.01, adresse: "Rue de l'Exemple, Saint-Paul", libres: 1, total: 2 } as unknown as BorneStation;
const bornes = cached({ stations: [borne], communes: [{ commune: "Saint-Paul", points: 2, stations: 1 }], recharge: "", donnees: "", sources: [] } as never);
const eau = cached({ baignades: [{ site: "Plage de l'Hermitage", commune: "Saint-Paul", lon: 55.22, lat: -21.08, qualite_dernier_prelevement: "bonne", dernier_prelevement: "20/10/2026", derniers_prelevements: [], mauvais_sur_12_mois: 0 }], communes: [], lu: NOW.toISOString(), a_savoir: COMMON, sources: [] } as unknown as EauAnswer);
// A commune's page: its town hall and its Altervélo stations (the Vélos tile).
const commune = { place: null, commune: cached({ mairie, velos: [{ nom: "IUT", commune: "Saint-Paul", velos_electriques: 3, maj: "07:55", lat: -21.34, lon: 55.49 }], sources: [] }) } as never;

let route: Awaited<ReturnType<typeof buildRoute>>;
let dae: Awaited<ReturnType<typeof buildDae>>;

/** Every page with « Y aller », under the alert given. */
function pages(a?: Alerte) {
  return {
    evenements: agendaPage(O, agenda, NOW, a),
    weekend: weekendPage(O, agenda, NOW, a),
    concerts: concertsPage(O, agenda, NOW, a),
    bornes: bornesPage(O, bornes, NOW, a),
    eau: eauPage(O, eau, NOW, a),
    commune: communePage(O, p, commune, NOW, a),
    meteo: placePage(O, p, null, NOW, a),
    enfantsCommune: enfantsCommunePage(O, pageOf("saint-denis")!, null, NOW, a),
    velos: velosPage(O, velos, NOW, a),
    mer: seaPage(O, sea, NOW, a),
    baignade: bathingPage(O, NOW, a),
    decheteries: decheteriesPage(O, cached({ etats: [], sources: [] }) as never, NOW, a),
    enfants: enfantsPage(O, null, NOW, a),
    arret: stopPage(O, stop, { departs: [], alertes: [], lignes: [], direct: [], sources: [] } as never, NOW, a),
    arrets: stopPage(O, stops, { departs: [], alertes: [], lignes: [], direct: [], sources: [] } as never, NOW, a),
    aujourdhui: aujourdhuiPage(O, p, today, null, a, mairie),
    randonnee: tracePage(O, "randonnee", hike.slug, hike.nom, cached(route), NOW, a),
    defibrillateurs: daePage(O, cached(dae), NOW, a),
  };
}
type Page = keyof ReturnType<typeof pages>;
/** What a button taken away could leave behind: empty paragraphs, a space before the end of a line or paragraph. */
const leftovers = (html: string) => [...html.matchAll(/<p(?: class="ya")?><\/p>|\s<\/(?:li|p)>|\u00a0: <\/p>/g)].map((m) => m[0]);
let free: ReturnType<typeof pages>;

beforeAll(async () => {
  const zip = fixture("vigilance_om.zip");
  const files = await unzip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, (n) => n.endsWith("_FMEE_.txt"));
  sample = mf.parse(JSON.parse(files.get("CDPV95_FMEE_.txt")!), JSON.parse(files.get("CDPV96_FMEE_.txt")!));
  // Nothing read: the ONF's map is the one put in the cache, its trails open.
  vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
  const store = new MemoryStore();
  await store.put(onf.KEY, { value: { sentiers: [{ nom: hike.sentiers_onf[0], statut: "ouvert", longueur_km: 1, points: [] }], routes: [] }, fetchedAt: NOW.getTime() });
  route = await buildRoute(new Cache(store, () => NOW.getTime()), hike);
  dae = await buildDae();
  free = pages();
});
afterAll(() => vi.unstubAllGlobals());

/**
 * The pages whose buttons are all gone, the line said once and the sheet left out; those checked apart (`partial`) left
 * aside; the others exactly as without an alert.
 */
function expectGone(a: Alerte, gone: Page[], partial: Page[] = []) {
  const line = retire(a);
  for (const [name, html] of Object.entries(pages(a)) as [Page, string][]) {
    if (partial.includes(name)) continue;
    if (gone.includes(name)) {
      expect(line).not.toBe("");
      expect(buttons(free[name]).length, name).toBeGreaterThan(0);
      expect(buttons(html), name).toEqual([]);
      expect(sheets(html), name).toBe(0);
      expect(html.split(line).length - 1, name).toBe(1);
      // Nothing left around a button taken away: no empty paragraph, no label, no space before a closing tag.
      expect(leftovers(html), name).toEqual(leftovers(free[name]));
    } else {
      expect(buttons(html), name).toEqual(buttons(free[name]));
      expect(sheets(html), name).toBe(sheets(free[name]));
      expect(html, name).not.toContain("pas d'itinéraire");
    }
  }
}

describe("« Y aller » under a cyclone alert", () => {
  it("reads the level the banner reads (alerteOf), only once it is in force", () => {
    expect([2, 3, 4, 5, 6].map((c) => level(c).court)).toEqual([2, 3, 4, 5, 6].map((c) => ({ cyclone: c, prevue: false })));
    expect(level(4, true).court).toEqual({ cyclone: 4, prevue: true });
    expect(retire(undefined)).toBe("");
    expect(retire(level(4, true))).toBe("");
    // The line, in marketing's words: the level as the site names it, the step of /alerte-cyclone, the prefecture's page.
    const tail = ` <a href="${ORSEC.lien}" rel="noopener">la\u00a0préfecture\u00a0↗</a></p>`;
    expect(retire(level(4))).toBe(`<p class="note">Alerte rouge cyclonique en cours\u00a0: pas d'itinéraire proposé tant qu'elle dure. <a href="/alerte-cyclone#rouge">Les consignes</a> ·${tail}`);
    expect(retire(level(3))).toContain("Alerte orange cyclonique en cours\u00a0: pas d'itinéraire proposé tant qu'elle dure. <a href=\"/alerte-cyclone#orange\">");
    expect(retire(level(5))).toContain("Alerte violette cyclonique en cours\u00a0: pas d'itinéraire proposé tant qu'elle dure. <a href=\"/alerte-cyclone#violette\">");
    expect(retire(level(6))).toContain("Phase de sauvegarde en cours\u00a0: pas d'itinéraire proposé tant qu'elle dure. <a href=\"/alerte-cyclone#sauvegarde\">");
    // Where a button stays: only what the page has.
    expect(retire(level(4), ["mairie"])).toContain("Alerte rouge cyclonique en cours\u00a0: itinéraire proposé seulement vers la mairie, tant qu'elle dure. <a");
    expect(retire(level(5), ["mairie", "defibrillateur"])).toContain("seulement vers la mairie et les défibrillateurs, tant qu'elle dure.");
    expect(retire(level(2))).toBe("");
  });

  it("changes nothing in pré-alerte, nor while red is only announced", () => {
    for (const a of [level(2), level(4, true), level(5, true)]) {
      for (const g of ["mairie", "defibrillateur", "randonnee", "baignade", "lieu"] as const) expect(permis(a, g)).toBe(true);
      expectGone(a, []);
    }
  });

  it("takes hikes away in orange, the trails being closed", () => {
    expect([permis(level(3), "randonnee"), permis(level(3), "baignade"), permis(level(3), "lieu")]).toEqual([false, true, true]);
    expectGone(level(3), ["randonnee"]);
  });

  it("keeps only the defibrillators and the town hall in red and purple", () => {
    for (const c of [4, 5]) {
      expect([permis(level(c), "mairie"), permis(level(c), "defibrillateur"), permis(level(c), "randonnee"), permis(level(c), "baignade"), permis(level(c), "lieu")]).toEqual([true, true, false, false, false]);
      expectGone(level(c), ["evenements", "weekend", "concerts", "bornes", "eau", "meteo", "velos", "mer", "baignade", "decheteries", "enfants", "enfantsCommune", "arret", "arrets", "randonnee"], ["aujourdhui", "commune"]);
      // /aujourdhui: the town hall kept, the markets gone, the line once, naming the town hall, and the sheet for it.
      const html = pages(level(c)).aujourdhui;
      expect(buttons(html)).toEqual(["Mairie de Saint-Paul"]);
      expect(buttons(free.aujourdhui).length).toBeGreaterThan(1);
      expect(html.split(retire(level(c), ["mairie"])).length - 1).toBe(1);
      expect(html).not.toContain("pas d'itinéraire");
      expect(sheets(html)).toBe(1);
      // A stop of two networks: neither button nor its network's label.
      const two = pages(level(c)).arrets;
      expect(buttons(free.arrets)).toHaveLength(2);
      expect(free.arrets).toContain('<p class="ya">Car Jaune\u00a0: <a class="aller"');
      expect(two).not.toContain('<p class="ya">');
      expect(two).not.toContain("Car Jaune\u00a0:");
      // A recycling centre's card: no empty paragraph where its button was; the day's markets: no space left.
      expect(pages(level(c)).decheteries).not.toContain("<p></p>");
      // A commune's page: the same, its stations gone.
      const town = pages(level(c)).commune;
      expect(buttons(town)).toEqual(["Mairie de Saint-Paul"]);
      expect(buttons(free.commune)).toEqual(["IUT", "Mairie de Saint-Paul"]);
      expect(town.split(retire(level(c), ["mairie"])).length - 1).toBe(1);
      expect(sheets(town)).toBe(1);
    }
  });

  it("says it on a hike in the button's place, under the download, before a closed forest road, even without a start", async () => {
    const line = retire(level(3));
    const html = pages(level(3)).randonnee;
    expect(html).toContain(`Télécharger le GPX</a></p>${line}`);
    // A forest road closed by the start: no start kept, the alert's line first, then the ONF's.
    const store = new MemoryStore();
    const s = traces.routePieces(hike)[0][0];
    const closed = { nom: "Route Forestière de l'Exemple (RF99)", circulation: "Circulation interdite", cause: "Travaux", longueur_km: 2, points: [[s.lon - 0.002, s.lat + 0.002], [s.lon + 0.002, s.lat + 0.002]] as [number, number][] };
    await store.put(onf.KEY, { value: { sentiers: [{ nom: hike.sentiers_onf[0], statut: "ouvert", longueur_km: 1, points: [] }], routes: [closed] }, fetchedAt: NOW.getTime() });
    const near = await buildRoute(new Cache(store, () => NOW.getTime()), hike);
    expect(near.depart).toBeUndefined();
    const both = tracePage(O, "randonnee", hike.slug, hike.nom, cached(near), NOW, level(3));
    expect(both).toContain(`${line}<p class="note">Route forestière interdite`);
    // An ONF trail's own page never had a button: no line.
    expect(tracePage(O, "sentier", "x", "X", null, NOW, level(3))).not.toContain("pas d'itinéraire");
  });

  it("takes hikes and bathing away in the phase de sauvegarde, every other button back", () => {
    expect([permis(level(6), "randonnee"), permis(level(6), "baignade"), permis(level(6), "lieu")]).toEqual([false, false, true]);
    expectGone(level(6), ["mer", "baignade", "eau", "meteo", "randonnee"]);
    expect(buttons(free.baignade)).toHaveLength(ZONES.length);
    expect(buttons(free.decheteries)).toHaveLength(dech.SITES.length);
  });
});
