import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import * as enfants from "../src/vie/enfants.js";
import { ZONES } from "../src/eau/requin.js";
import { COMMON } from "../src/tools/eau.js";
import { aller, MOTS, SCRIPT, SCRIPT_PATH, SHEET } from "../src/web/aller.js";
import { SAME_STOP_M, toStop } from "../src/web/arret.js";
import { bathingPage } from "../src/web/baignade.js";
import type { BorneStation, EauAnswer, SeaData } from "../src/web/data.js";
import { decheteriesPage } from "../src/web/decheteries.js";
import { borneRow, eauPage } from "../src/web/domains.js";
import { CSS, seaPage } from "../src/web/pages.js";
import { site } from "../src/web/site.js";
import { Cache, MemoryStore } from "../src/cache.js";
import * as dech from "../src/vie/decheteries.js";
import type * as transit from "../src/providers/transit.js";
import { couleur, enfantsCommunePage, enfantsPage } from "../src/web/enfants.js";
import { daePage } from "../src/web/domains.js";
import { pageOf } from "../src/web/places.js";
import { DAES } from "../src/providers/dae.js";
import { daeRow } from "../src/tools/dae.js";
import { resume } from "../src/tools/resume.js";
import { MARCHES } from "../src/vie/marches.js";
import { aujourdhuiPage } from "../src/web/aujourdhui.js";
import { buildDae } from "../src/web/data.js";
import { agendaPage, bikeRow, eventGo } from "../src/web/domains.js";
import type { AgendaAnswer, EnfantsAnswer } from "../src/web/data.js";

const O = "https://rundata.re";
const NOW = new Date("2026-10-29T08:00:00Z");
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
  ordinateur: "Mozilla/5.0 (X11; Linux x86_64)",
};
const NBSP = " ";

interface Sheet {
  title: string;
  sub: string;
  html: string;
  open: boolean;
  ok: string;
  prevented: boolean;
  copied: string[];
  copy: (fails?: boolean) => Promise<void>;
}

/** The script on a page of stubs, a click on a button made by aller() (its attributes read back from the HTML). */
function click(button: string, ua: string): Sheet {
  const attrs = Object.fromEntries([...button.matchAll(/ ([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2].replace(/&(amp|#39);/g, (_, x) => (x === "amp" ? "&" : "'"))]));
  const a = {
    href: attrs.href,
    dataset: Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5), v])),
    getAttribute: (k: string) => attrs[k] ?? null,
    closest: (s: string) => (s === "a.aller" ? a : null),
  };
  const out: Sheet = { title: "", sub: "", html: "", open: false, ok: "", prevented: false, copied: [], copy: async () => undefined };
  const h2 = { set textContent(t: string) { out.title = t; } };
  const sub = { set textContent(t: string) { out.sub = t; } };
  const ul = { set innerHTML(h: string) { out.html = h; } };
  const ok = { set textContent(t: string) { out.ok = t; } };
  let inSheet: (ev: unknown) => void = () => undefined;
  let onPage: (ev: unknown) => void = () => undefined;
  let fail = false;
  const dialog = {
    showModal: () => (out.open = true),
    close: () => (out.open = false),
    querySelector: (s: string) => ({ h2, "h2+.note": sub, ul, ".ok": ok })[s],
    addEventListener: (_: string, f: (ev: unknown) => void) => (inSheet = f),
  };
  runInNewContext(SCRIPT, {
    document: { getElementById: (id: string) => (id === "aller" ? dialog : null), addEventListener: (_: string, f: (ev: unknown) => void) => (onPage = f) },
    navigator: {
      userAgent: ua, platform: ua.includes("iPhone") ? "iPhone" : "Linux", maxTouchPoints: ua.includes("X11") ? 0 : 5,
      clipboard: { writeText: (t: string) => (fail ? Promise.reject(new Error("refus")) : (out.copied.push(t), Promise.resolve())) },
      // Never asked: the sheet does not need the visitor's position.
      get geolocation() { throw new Error("geolocation"); },
    },
    URL, encodeURIComponent, setTimeout, Promise,
  });
  onPage({ target: a, preventDefault: () => (out.prevented = true) });
  out.copy = async (fails = false) => {
    fail = fails;
    inSheet({ target: { closest: (s: string) => (s === ".cp" ? {} : null) } });
    await new Promise((r) => setTimeout(r, 0));
  };
  return out;
}
const links = (s: Sheet) => [...s.html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)</g)].map((m) => [m[2], m[1].replace(/&amp;/g, "&")]);

describe("« Y aller »: a place opened in the phone's navigation app", () => {
  const place = { nom: "Aire de jeux du Front de Mer", lat: -21.0123, lon: 55.2701, adresse: "Rue de l'Exemple, Saint-Paul" };

  it("is a link to the route in Google Maps, labelled with the place's name, and nothing without a position", () => {
    expect(aller(place)).toBe(
      `<a class="aller" href="https://www.google.com/maps/dir/?api=1&amp;destination=-21.0123,55.2701" rel="noopener" data-a="Rue de l&#39;Exemple, Saint-Paul" aria-label="Y aller${NBSP}: Aire de jeux du Front de Mer">Y aller</a>`,
    );
    expect(aller({ ...place, adresse: undefined }, true)).toBe(
      `<a class="aller" href="https://www.google.com/maps/dir/?api=1&amp;destination=-21.0123,55.2701&amp;travelmode=walking" rel="noopener" data-m="pied" aria-label="Y aller${NBSP}: Aire de jeux du Front de Mer">Y aller</a>`,
    );
    expect(aller({ ...place, lat: NaN })).toBe("");
    expect(MOTS.label("x")).toBe(MOTS.titre + "x");
  });

  it("offers the apps of the device: Plans first on an iPhone, the system's choice first on Android, the sites on a computer", () => {
    const iphone = click(aller(place), UA.iphone);
    expect(iphone.prevented && iphone.open).toBe(true);
    expect(iphone.title).toBe(`Y aller${NBSP}: Aire de jeux du Front de Mer`);
    expect(links(iphone)).toEqual([
      ["Plans", "https://maps.apple.com/?daddr=-21.0123,55.2701&q=Aire%20de%20jeux%20du%20Front%20de%20Mer"],
      ["Google Maps", "https://www.google.com/maps/dir/?api=1&destination=-21.0123,55.2701"],
      ["Waze", "https://waze.com/ul?ll=-21.0123,55.2701&navigate=yes"],
    ]);
    expect(links(click(aller(place), UA.android))).toEqual([
      ["Choisir une appli du téléphone", "geo:0,0?q=-21.0123,55.2701(Aire%20de%20jeux%20du%20Front%20de%20Mer)"],
      ["Google Maps", "https://www.google.com/maps/dir/?api=1&destination=-21.0123,55.2701"],
      ["Waze", "https://waze.com/ul?ll=-21.0123,55.2701&navigate=yes"],
    ]);
    const pc = click(aller(place), UA.ordinateur);
    expect(links(pc)).toEqual([
      ["Google Maps", "https://www.google.com/maps/dir/?api=1&destination=-21.0123,55.2701"],
      ["OpenStreetMap", "https://www.openstreetmap.org/?mlat=-21.0123&mlon=55.2701#map=18/-21.0123/55.2701"],
    ]);
    // A computer opens them in a new tab, a phone in its app.
    expect(pc.html).toContain('target="_blank"');
    expect(iphone.html).not.toContain('target="_blank"');
  });

  it("goes on foot without Waze, and reads the position of a button whose link is not Google Maps'", () => {
    const foot = aller(place, true);
    expect(links(click(foot, UA.iphone)).map(([t, u]) => [t, u.split("&q=")[0].replace(/&travelmode=walking$/, "")])).toEqual([
      ["Plans", "https://maps.apple.com/?daddr=-21.0123,55.2701"],
      ["Google Maps", "https://www.google.com/maps/dir/?api=1&destination=-21.0123,55.2701"],
    ]);
    expect(links(click(foot, UA.android)).map(([t]) => t)).toEqual(["Choisir une appli du téléphone", "Google Maps"]);
    // The sheet says so, and says it no more for the next button, by car.
    const s = click(foot, UA.iphone);
    expect(s.sub).toBe(`À pied, ouvrir dans${NBSP}:`);
    expect(click(aller(place), UA.iphone).sub).toBe(`Ouvrir dans${NBSP}:`);
    expect(SHEET).toContain(`<h2 id="aller-t"></h2><p class="note">Ouvrir dans${NBSP}:</p>`);
    // « Autour de moi » on an iPhone: its link is Plans', its position in data-go.
    const plans = `<a class="aller" href="https://maps.apple.com/?daddr=-21.1,55.5&amp;dirflg=w" rel="noopener" data-go="-21.1,55.5" data-m="pied" aria-label="Y aller${NBSP}: DAE">Y aller</a>`;
    expect(links(click(plans, UA.iphone))[0][1]).toBe("https://maps.apple.com/?daddr=-21.1,55.5&q=DAE&dirflg=w");
  });

  it("copies the address, else the coordinates, and says so; the text itself when the phone refuses", async () => {
    const s = click(aller(place), UA.iphone);
    expect(s.html).toContain(">Copier l&#39;adresse</button>");
    await s.copy();
    expect([s.copied, s.ok]).toEqual([["Rue de l'Exemple, Saint-Paul"], "Adresse copiée"]);
    const c = click(aller({ ...place, adresse: undefined }), UA.android);
    expect(c.html).toContain(">Copier les coordonnées</button>");
    await c.copy();
    expect([c.copied, c.ok]).toEqual([["-21.0123, 55.2701"], "Coordonnées copiées"]);
    await c.copy(true);
    expect(c.ok).toBe("-21.0123, 55.2701");
    // Said aloud by a screen reader.
    expect(SHEET).toContain('<p class="ok note" aria-live="polite"></p>');
  });

  it("is on every place of /enfants with a position, its address on the second line, and the sheet once per page", () => {
    const island = enfantsPage(O, null, NOW);
    expect(island.match(/class="aller"/g)).toHaveLength(enfants.LIEUX.length);
    expect(island.match(/<dialog id="aller"/g)).toHaveLength(1);
    const withAddress = enfants.LIEUX.filter((l) => l.adresse);
    expect(island.match(/<small class="adr">/g)).toHaveLength(withAddress.length);
    const page = enfantsCommunePage(O, pageOf("saint-denis")!, null, NOW);
    expect(page.match(/class="aller"/g)).toHaveLength(enfants.inCommune("Saint-Denis").length);
    expect(page.match(/<dialog id="aller"/g)).toHaveLength(1);
    // A row: the name and its pin, then the address, the age and « Y aller ».
    const l = enfants.inCommune("Saint-Denis").find((x) => x.adresse)!;
    const li = page.slice(page.indexOf(`aria-label="Y aller${NBSP}: `) - 2000, page.length);
    expect(li).toMatch(/<span class="end"><button type="button" class="tomap[^>]*>.*?<\/button><\/span><span class="l2"><span>/);
    expect(page).toContain(`<small class="adr">${l.adresse!.replace(/'/g, "&#39;")}</small> <span class="age`);
    // The map's sheet: « Y aller » too.
    expect(page).toContain('<p class="note tp"></p><p class="ya"></p>');
    // « Autour de moi » has the sheet for its buttons.
    expect(daePage(O, null, NOW).match(/<dialog id="aller"/g)).toHaveLength(1);
  });

  it("names a colour of the map with the filters of its kinds in the commune, never a name of its own", () => {
    const of = (c: string) => enfants.inCommune(c);
    expect(couleur(["parc", "animaux"], of("Saint-Pierre"))).toBe("Parcs et jardins");
    expect(couleur(["parc", "animaux"], of("Saint-Paul"))).toBe("Parcs et jardins, zoos et aquariums");
    expect(couleur(["mediatheque", "musee"], of("Saint-Denis"))).toBe("Médiathèques et musées");
    expect(couleur(["aire_de_jeux", "salle_jeux", "ludotheque", "loisirs"], of("Saint-Denis"))).toBe("Aires de jeux, parcs de loisirs et salles de jeux");
    const pierre = enfantsCommunePage(O, pageOf("saint-pierre")!, null, NOW);
    expect(pierre).toContain('<i class="ksw f-nature"></i>Parcs et jardins</span>');
    expect(pierre).not.toContain("Parcs et animaux");
  });
});

describe("« Y aller » beyond /enfants: stations, bathing, beaches, recycling centres, stops", () => {
  const cached = <T>(value: T) => ({ value, fetchedAt: NOW, stale: false });
  const sheets = (html: string) => html.match(/<dialog id="aller"/g)?.length ?? 0;
  const labels = (html: string) => [...html.matchAll(/class="aller"[^>]*aria-label="Y aller\u00a0: ([^"]+)"/g)].map((m) => m[1]);

  it("reads its script once, kept a year at its address like the stylesheet, never written into each page", async () => {
    expect(SHEET).toContain(`<script src="${SCRIPT_PATH}" defer></script>`);
    expect(SHEET).not.toContain(SCRIPT.slice(0, 40));
    const r = await site(new Request(`${O}${SCRIPT_PATH}`), new Cache(new MemoryStore(), () => NOW.getTime()), () => {}, NOW);
    expect(r!.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(r!.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await r!.text()).toBe(SCRIPT);
    // An earlier version's address, from a page kept offline: today's script, for a few minutes.
    const old = await site(new Request(`${O}/aller-ancien.js`), new Cache(new MemoryStore(), () => NOW.getTime()), () => {}, NOW);
    expect(old!.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("is on each charging station, its address to copy", () => {
    const s = { station: "Exemple, Rue de l'Exemple, Saint-Paul", commune: "Saint-Paul", puissance_max_kw: 22, prises: ["Type 2"], lon: 55.27, lat: -21.01, adresse: "Rue de l'Exemple, Saint-Paul", libres: 1, total: 2 } as unknown as BorneStation;
    expect(borneRow(s)).toContain(`<a class="aller" href="https://www.google.com/maps/dir/?api=1&amp;destination=-21.01,55.27" rel="noopener" data-a="Rue de l&#39;Exemple, Saint-Paul" aria-label="Y aller${NBSP}: Exemple, Rue de l&#39;Exemple, Saint-Paul">`);
  });

  it("is on each bathing site of /eau and each zone of /baignade, the sheet once", () => {
    const site = (s: string, lon: number, lat: number) => ({ site: s, commune: "Saint-Paul", lon, lat, qualite_dernier_prelevement: "bonne", dernier_prelevement: "20/10/2026", derniers_prelevements: [], mauvais_sur_12_mois: 0 });
    const eau = eauPage(O, cached({ baignades: [site("Plage de l'Hermitage", 55.22, -21.08), site("Bassin Manapany", 55.6, -21.37)], communes: [], lu: NOW.toISOString(), a_savoir: COMMON, sources: [] } as unknown as EauAnswer), NOW);
    expect(labels(eau)).toEqual(["Plage de l&#39;Hermitage", "Bassin Manapany"]);
    expect(sheets(eau)).toBe(1);
    const zones = bathingPage(O, NOW);
    expect(labels(zones)).toHaveLength(ZONES.length);
    expect(sheets(zones)).toBe(1);
  });

  it("leads to a beach of /mer, never to the centre of a town listed for its coast", () => {
    const beach = (nom: string, lon: number, lat: number) => ({ nom, commune: "Saint-Paul", lon, lat, valeur: 25, jour: "2026-10-28", distance_km: 3 });
    const page = seaPage(O, cached({ plages: [beach("Saint-Denis", 55.45, -20.88), beach("Plage de Boucan-Canot", 55.22, -21.03), beach("Plage de la Saline les Bains", 55.24, -21.1), beach("Plage de l'Ermitage-les-Bains", 55.23, -21.07)], sources: [] } as unknown as SeaData), NOW);
    const seas = page.slice(page.indexOf('<ul class="seas">'), page.indexOf("</ul>", page.indexOf('<ul class="seas">')));
    // A name at the head of a tile starts with a capital.
    expect(labels(seas)).toEqual(["Boucan-Canot", "La Saline les Bains", "L&#39;Ermitage-les-Bains"]);
    expect(seas).toContain("<span>L&#39;Ermitage-les-Bains</span>");
    // The zones of the bathing block below have theirs; one sheet for the page.
    expect(labels(page)).toHaveLength(3 + ZONES.length);
    expect(sheets(page)).toBe(1);
  });

  it("is on each recycling centre, its address and commune to copy", () => {
    const page = decheteriesPage(O, { value: { etats: [], sources: [] }, fetchedAt: NOW, stale: false } as never, NOW);
    expect(labels(page)).toHaveLength(dech.SITES.length);
    const s = dech.SITES.find((x) => x.adresse)!;
    expect(page).toContain(`data-a="${`${s.adresse}, ${s.commune}`.replace(/'/g, "&#39;")}"`);
    expect(sheets(page)).toBe(1);
  });

  it("goes on foot to a stop: one button for stops together, one per network's stop apart", () => {
    const g = (reseau: string, lat: number, lon: number) => ({ reseau, nom: "Mairie", commune: "Saint-Paul", ids: [1], lat, lon, words: new Set<string>() });
    const p = (groups: transit.StopGroup[]) => ({ slug: "saint-paul/mairie", nom: "Mairie", commune: "Saint-Paul", groups, indexe: true }) as transit.StopPage;
    // 30 m apart: one place.
    const one = toStop(p([g("carjaune", -21.0096, 55.2700), g("karouest", -21.0099, 55.2700)]));
    expect(one.match(/class="aller"/g)).toHaveLength(1);
    expect(one).toContain('data-m="pied"');
    expect(one).toContain("&amp;travelmode=walking");
    // 200 m apart: each named by its network.
    const two = toStop(p([g("carjaune", -21.0096, 55.2700), g("karouest", -21.0114, 55.2700)]));
    expect(two.match(/class="aller"/g)).toHaveLength(2);
    expect(two).toMatch(/^<p class="ya">Car Jaune\u00a0: <a class="aller"/);
    expect(SAME_STOP_M).toBe(50);
  });
});

describe("« Y aller » on the places whose position the pages' copies now keep", () => {
  const cached = <T>(value: T) => ({ value, fetchedAt: NOW, stale: false });
  const labels = (html: string) => [...html.matchAll(/class="aller"[^>]*aria-label="Y aller\u00a0: ([^"]+)"/g)].map((m) => m[1]);

  it("is on each defibrillator of the communes' lists, by the normal route, the tool's rows left without a position", async () => {
    const d = await buildDae();
    const page = daePage(O, cached(d), NOW);
    const lists = page.slice(page.indexOf('<ul class="zones">'), page.indexOf("</ul></details></li></ul>") + 25);
    const rows = d.communes.reduce((n, c) => n + c.liste.length, 0);
    expect(labels(lists)).toHaveLength(rows);
    // A device of the commune may be kilometres away: not on foot, as « Autour de moi »'s.
    expect(lists).not.toContain('data-m="pied"');
    const first = d.communes[0].liste[0];
    expect(lists).toContain(`destination=${first.lat},${first.lon}" rel="noopener" data-a="${first.adresse.replace(/'/g, "&#39;")}"`);
    expect(page.match(/<dialog id="aller"/g)).toHaveLength(1);
    expect(Object.keys(daeRow(DAES[0]))).not.toContain("lat");
  });

  it("is under the name of an Altervélo station whose copy has its position, and nowhere without one", () => {
    const station = { nom: "IUT", commune: "Saint-Pierre", velos_electriques: 3, maj: "20:35" };
    expect(bikeRow(station)).not.toContain("aller");
    expect(bikeRow({ ...station, lat: -21.34, lon: 55.49 })).toContain(`<span>IUT<span class="ya"><a class="aller" href="https://www.google.com/maps/dir/?api=1&amp;destination=-21.34,55.49" rel="noopener" aria-label="Y aller\u00a0: IUT">`);
    // On a commune's page the Vélos tile is a link over its whole surface: the buttons sit above it, else a tap opens /velos.
    expect(CSS).toContain(".tile h3 a::after{content:\"\";position:absolute;inset:0;border-radius:22px;z-index:1}");
    expect(CSS).toContain(".tile .aller{position:relative;z-index:2}");
  });

  it("is under an event whose source gives its position, the place's name in the sheet, and not under the others", () => {
    // Friday 30/10/2026 at La Réunion.
    const now = new Date("2026-10-30T04:00:00Z");
    const ev = (titre: string, x: object = {}) => ({ titre, date: "2026-10-30T19:00", quand: "vendredi 30/10 à 19:00", genres: [], commune: "Saint-Denis", lien: "https://example.org", publie_par: "CINOR", ...x });
    const placed = ev("Atelier d'échecs", { lieu: "Bibliothèque Alain Lorraine, 2 rue de l'Exemple", position: { lat: -20.8927, lon: 55.4513 } });
    const answer = { resume: "", nombre: 2, evenements: [placed, ev("Concert")], ce_week_end: [], couverture: "", a_savoir: "", sources: [] } as unknown as AgendaAnswer;
    const page = agendaPage(O, cached(answer), now);
    expect(labels(page)).toEqual(["Bibliothèque Alain Lorraine"]);
    expect(page).toContain(`<span class="ya"><a class="aller" href="https://www.google.com/maps/dir/?api=1&amp;destination=-20.8927,55.4513" rel="noopener" data-a="Bibliothèque Alain Lorraine, 2 rue de l&#39;Exemple, Saint-Denis"`);
    expect(page.match(/<dialog id="aller"/g)).toHaveLength(1);
    // No place: the title in the sheet, the coordinates to copy; the commune not written twice.
    expect(eventGo({ titre: "Réparali", commune: "Saint-Denis", position: { lat: -20.89, lon: 55.45 } })).toContain('aria-label="Y aller\u00a0: Réparali"');
    expect(eventGo({ titre: "Réparali", commune: "Saint-Denis", position: { lat: -20.89, lon: 55.45 } })).not.toContain("data-a");
    expect(eventGo({ titre: "X", lieu: "Nordev, Saint-Denis", commune: "Saint-Denis", position: { lat: -20.89, lon: 55.49 } })).toContain('data-a="Nordev, Saint-Denis"');
    // Without any: neither button nor sheet.
    const none = agendaPage(O, cached({ ...answer, nombre: 1, evenements: [ev("Concert")] }), now);
    expect(none).not.toContain('class="aller"');
    expect(none).not.toContain('<dialog id="aller"');
    // Under its line, like a station's.
    expect(CSS).toContain(".rows li>span>.ya{display:block;margin-top:.3rem}");
  });

  it("is under a children's activity whose source gives its position, on the island's page and a commune's", () => {
    const now = new Date("2026-10-30T04:00:00Z");
    const row = { titre: "Escape game", date: "2026-10-31T14:00", quand: "samedi 31/10 à 14:00", genres: [], commune: "Saint-Denis", lieu: "Bibliothèque Alain Lorraine", lien: "https://example.org", publie_par: "CINOR", position: { lat: -20.8927, lon: 55.4513 } };
    const d = { evenements: [row, { ...row, titre: "Conte", position: undefined }], ce_week_end: [] } as unknown as EnfantsAnswer;
    for (const html of [enfantsPage(O, cached(d), now), enfantsCommunePage(O, pageOf("saint-denis")!, cached(d), now)]) {
      expect(html).toContain(`Saint-Denis · Bibliothèque Alain Lorraine · CINOR</small><span class="ya"><a class="aller" href="https://www.google.com/maps/dir/?api=1&amp;destination=-20.8927,55.4513"`);
      expect(html).not.toMatch(/Conte<\/a><small>[^<]*<\/small><span class="ya">/);
    }
  });

  it("leads to the town hall and to the day's markets on /aujourdhui, the summary itself without a position", () => {
    const p = pageOf("saint-paul")!;
    // Saturday 24/10/2026: the Saint-Paul market is held.
    const now = new Date("2026-10-24T07:10:00Z");
    const mairie = { nom: "Mairie de Saint-Paul", insee: "97415", adresse: "Place de l'Exemple, 97460 Saint-Paul", lon: 55.27, lat: -21.01, horaires: [], fiche: "https://example.org" };
    const r = resume(p, { commune: { value: { mairie, sources: [] }, fetchedAt: now, stale: false } } as never, now);
    expect(r.mairie).toBeDefined();
    expect(JSON.stringify(r)).not.toMatch(/"lat"/);
    const html = aujourdhuiPage(O, p, r, null, undefined, mairie);
    const market = MARCHES().find((m) => m.osm === r.marches_du_jour!.liste[0].carte)!;
    expect(labels(html)).toEqual(["Mairie de Saint-Paul", ...r.marches_du_jour!.liste.map((x) => x.nom)]);
    expect(html).toContain(`destination=${market.lat},${market.lon}`);
    expect(html).toContain('data-a="Place de l&#39;Exemple, 97460 Saint-Paul"');
    expect(html.match(/<dialog id="aller"/g)).toHaveLength(1);
    // Without the commune's copy, no town hall: the markets, from the bundled list, keep theirs.
    const bare = aujourdhuiPage(O, p, resume(p, {}, now), null);
    expect(labels(bare)).toEqual(r.marches_du_jour!.liste.map((x) => x.nom));
  });
});
