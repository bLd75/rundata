import { readFileSync, statSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import * as feux from "../src/providers/feux.js";
import * as mf from "../src/providers/vigilance.js";
import { alertePage } from "../src/web/alerte-cyclone.js";
import { applicationPage } from "../src/web/application.js";
import { associationsPage } from "../src/web/associations.js";
import { bathingPage } from "../src/web/baignade.js";
import { carburantsPage } from "../src/web/carburants.js";
import { WITH_PAGE } from "../src/web/categories.js";
import { collectePage } from "../src/web/collecte.js";
import { communesPage } from "../src/web/commune.js";
import { connecteurPage } from "../src/web/connecteur.js";
import type { Alerte, CruesAnswer, CyclonesAnswer } from "../src/web/data.js";
import {
  agendaPage, airPage, bornesPage, busPage, calendrierPage, coupuresPage, cruesPage, cyclonesPage, daePage, eauPage, electricitePage, historiquePage,
  randonneesPage, secheressePage, sentiersPage, sportPage, traficPage, velosPage, volcanPage,
} from "../src/web/domains.js";
import { decheteriesPage } from "../src/web/decheteries.js";
import { emploiPage } from "../src/web/emploi.js";
import { ecolesPage } from "../src/web/ecoles.js";
import { enfantsPage } from "../src/web/enfants.js";
import { concertsPage, weekendPage } from "../src/web/evenements.js";
import { feuxPage } from "../src/web/feux.js";
import { fond, FONDS, MENTION, SANS_FOND, withSaveData } from "../src/web/fonds.js";
import files from "../src/web/fonds.json" with { type: "json" };
import { homePage } from "../src/web/home.js";
import { kitPage } from "../src/web/kit-cyclone.js";
import { CSS, meteoPage, seaPage, vigilancePage } from "../src/web/pages.js";
import { proposerPage } from "../src/web/propositions.js";
import { withVolcan } from "../src/web/volcan-alerte.js";
import { unzip } from "../src/zip.js";

const NOW = new Date("2026-10-28T06:00:00Z");
const O = "https://rundata.re";
const at = <T>(value: T) => ({ value, fetchedAt: NOW, stale: false });
// /vigilance, /cyclones and /crues all green: their picture is shown only then.
const QUIET_CYCLONES: CyclonesAnswer = {
  resume: "Aucun système actif.", systemes_actifs: [], saison_en_cours: { nom: "2026-2027", systemes: [] }, a_savoir: "", phases_alerte: "", saison: "",
  officiel: "", consulter: {}, sources: [],
} as unknown as CyclonesAnswer;
const GREEN_RIVERS = { resume: "", vigilance_crues: { active: false, rivieres: [] }, stations: [], sources: [] } as unknown as CruesAnswer;
// The fixture of web.test.ts, green over the whole island on 22/10.
const GREEN_DAY = new Date("2026-10-22T06:00:00Z");
async function greenVigilance() {
  const zip = readFileSync(new URL("./fixtures/vigilance_om.zip", import.meta.url));
  const f = await unzip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, (n) => n.endsWith("_FMEE_.txt"));
  return mf.parse(JSON.parse(f.get("CDPV95_FMEE_.txt")!), JSON.parse(f.get("CDPV96_FMEE_.txt")!));
}
const PAGES: Record<string, (alerte?: Alerte) => string> = {
  "/meteo": (a) => meteoPage(O, null, NOW, a),
  "/randonnees": (a) => randonneesPage(O, null, NOW, a),
  "/trafic": (a) => traficPage(O, null, NOW, a),
  "/evenements": (a) => agendaPage(O, null, NOW, a),
  "/mer": (a) => seaPage(O, null, NOW, a),
  "/emploi": (a) => emploiPage(O, null, NOW, a),
  "/historique": (a) => historiquePage(O, null, NOW, a),
  "/volcan": (a) => volcanPage(O, null, NOW, a),
  "/cyclones": (a) => cyclonesPage(O, at(QUIET_CYCLONES), NOW, a),
  "/crues": (a) => cruesPage(O, at(GREEN_RIVERS), NOW, a),
  "/velos": (a) => velosPage(O, null, NOW, a),
  "/bornes": (a) => bornesPage(O, null, NOW, a),
  "/coupures-eau": (a) => coupuresPage(O, null, NOW, a),
  "/defibrillateurs": (a) => daePage(O, null, NOW, a),
  "/secheresse": (a) => secheressePage(O, null, NOW, a),
  "/sport": (a) => sportPage(O, null, NOW, a),
  "/enfants": (a) => enfantsPage(O, null, NOW, a),
  "/eau": (a) => eauPage(O, null, NOW, a),
  "/air": (a) => airPage(O, null, NOW, a),
  "/electricite": (a) => electricitePage(O, null, NOW, a),
  "/calendrier": (a) => calendrierPage(O, null, NOW, a),
  "/bus": (a) => busPage(O, null, NOW, a),
  "/communes": (a) => communesPage(O, a),
  "/carburants": (a) => carburantsPage(O, null, NOW, a),
  "/collecte": (a) => collectePage(O, NOW, undefined, a),
  "/feux": (a) => feuxPage(O, { fires: null }, NOW, a),
  "/sentiers": (a) => sentiersPage(O, null, NOW, a),
  "/decheteries": (a) => decheteriesPage(O, null, NOW, a),
  "/baignade": (a) => bathingPage(O, NOW, a),
  "/kit-cyclone": (a) => kitPage(O, a),
  "/alerte-cyclone": (a) => alertePage(O, null, NOW, a),
  "/ecoles-cyclone": (a) => ecolesPage(O, null, NOW, a),
  "/evenements/ce-week-end": (a) => weekendPage(O, null, NOW, a),
  "/evenements/concerts": (a) => concertsPage(O, null, NOW, a),
  "/associations": (a) => associationsPage(O, { clubs: 0, evenements: 0, prochains: [] }, a),
  "/associations/proposer": (a) => proposerPage(O, undefined, NOW, a),
  "/mcp": (a) => connecteurPage(O, a),
  "/application": (a) => applicationPage(O, a),
};
const vigilance = (couleur: number, nom: string): Alerte => ({ couleur, texte: `Vigilance Météo-France : ${nom} fortes pluies (Est).`, court: { couleur: nom, phenomenes: ["Fortes pluies"], zones: ["Est"] } });
const picture = (html: string) => html.match(/<img class="fond"[^>]*>/)?.[0];

describe("the illustrations behind the band", () => {
  // /feux without its key is kept out of the search engines, and so without its picture.
  beforeEach(() => feux.configure("clé"));
  afterEach(() => feux.configure());

  it("show each page's own picture, decorative and in low priority, with the mention beside it", () => {
    expect(Object.keys(FONDS).filter((p) => p !== "/vigilance").sort()).toEqual(Object.keys(PAGES).sort());
    for (const [path, render] of Object.entries(PAGES)) {
      const html = render();
      const img = picture(html);
      expect(img, path).toBeDefined();
      const f = files[FONDS[path].nom];
      expect(img).toContain(`src="/fonds/${f["480"]}"`);
      expect(img).toContain(`/fonds/${f["1024"]} 1024w`);
      expect(img).toContain('alt=""');
      expect(img).toContain('fetchpriority="low"');
      expect(html).toContain(`<p class="fond-ia">${MENTION}</p>`);
      // Behind the band's text, not in the page's flow.
      expect(html.indexOf(img!)).toBeGreaterThan(html.indexOf('<div class="band">'));
      expect(html.indexOf(img!)).toBeLessThan(html.indexOf("<h1"));
    }
  });

  it("are not on the home page", () => {
    expect(picture(homePage(O, null, NOW))).toBeUndefined();
  });

  it("show on /vigilance, /cyclones and /crues only while their own data says all is green", async () => {
    const v = await greenVigilance();
    expect(picture(vigilancePage(O, { value: v, fetchedAt: GREEN_DAY, stale: false }, GREEN_DAY))).toBeDefined();
    // Not read, or a yellow vigilance, which leaves the other pages theirs.
    expect(picture(vigilancePage(O, null, GREEN_DAY))).toBeUndefined();
    expect(picture(vigilancePage(O, { value: v, fetchedAt: GREEN_DAY, stale: false }, GREEN_DAY, vigilance(2, "jaune")))).toBeUndefined();
    expect(picture(cyclonesPage(O, at(QUIET_CYCLONES), NOW, vigilance(2, "jaune")))).toBeUndefined();
    expect(picture(cyclonesPage(O, null, NOW))).toBeUndefined();
    expect(picture(cyclonesPage(O, at({ ...QUIET_CYCLONES, systemes_actifs: [{ nom: "Fytia", stade: "tempête tropicale modérée", dernier_avis: "03/02 à 10:00", centre: "CMRS", rapport: "https://www.gdacs.org/" }] } as unknown as CyclonesAnswer), NOW))).toBeUndefined();
    expect(picture(cruesPage(O, null, NOW))).toBeUndefined();
    expect(picture(cruesPage(O, at({ ...GREEN_RIVERS, vigilance_crues: { active: true, rivieres: [] } }), NOW))).toBeUndefined();
    expect(fond("/crues", undefined, false)).toBe("");
    expect(fond("/crues", undefined, false, true)).toContain('<img class="fond"');
  });

  it("are on every section and theme page of the site, or left out for a reason written down", async () => {
    const map = await (await handle(new Request(`${O}/sitemap.xml`), new Cache())).text();
    const paths = new Set([...WITH_PAGE.map((c) => c.path), ...[...map.matchAll(/<loc>https:\/\/rundata\.re([^<]*)<\/loc>/g)].map((m) => m[1] || "/")]);
    expect(paths.size).toBeGreaterThan(50);
    // The address itself, or `/*` below one of its parents.
    const sans = (p: string) => SANS_FOND[p] ?? p.split("/").slice(1, -1).map((_, i, a) => SANS_FOND[`/${a.slice(0, i + 1).join("/")}/*`]).find(Boolean);
    // A new section without its picture fails here: give it one (FONDS), or say why not (SANS_FOND).
    expect([...paths].filter((p) => !FONDS[p] && !sans(p))).toEqual([]);
    for (const p of Object.keys(SANS_FOND)) {
      expect(FONDS[p], p).toBeUndefined();
      expect(SANS_FOND[p].length, p).toBeGreaterThan(8);
    }
  });

  it("stay under a yellow vigilance, and leave every page under an orange or red one or a cyclone alert", () => {
    for (const [path, render] of Object.entries(PAGES)) {
      // /cyclones: only while all is green.
      if (path !== "/cyclones") expect(picture(render(vigilance(2, "jaune"))), path).toBeDefined();
      expect(picture(render(vigilance(3, "orange")))).toBeUndefined();
      expect(picture(render(vigilance(4, "rouge")))).toBeUndefined();
      // The pré-alerte too: no calm picture while a cyclone is announced.
      expect(picture(render({ couleur: 2, neutre: true, texte: "Météo-France : pré-alerte cyclonique.", court: { cyclone: 2, prevue: false } }))).toBeUndefined();
      expect(render(vigilance(3, "orange"))).not.toContain(MENTION);
    }
  });

  it("leave every page while the volcano is in alert or erupting", () => {
    for (const render of Object.values(PAGES)) {
      expect(picture(withVolcan({ niveau: "Alerte 1", eruption: false }, () => render()))).toBeUndefined();
      expect(picture(withVolcan({ eruption: true }, () => render()))).toBeUndefined();
    }
  });

  it("are not written when the browser asks to save data", () => {
    const ask = (h: Record<string, string>) => new Request(`${O}/mer`, { headers: h });
    expect(picture(withSaveData(ask({ "save-data": "on" }), () => seaPage(O, null, NOW)))).toBeUndefined();
    expect(picture(withSaveData(ask({}), () => seaPage(O, null, NOW)))).toBeDefined();
  });

  it("fade out, stay out of print, and never add height to the band", () => {
    expect(CSS).toContain(".band>.fond{position:absolute;");
    expect(CSS).toContain("mask-image:linear-gradient(to bottom,");
    expect(CSS).toContain("@media print{.band>.fond,.fond-ia{display:none}}");
  });

  it("are light files, named after their content and kept a year", () => {
    for (const f of Object.values(files)) {
      // The phone's copy shares the bandwidth of the page's stylesheet and font: within 12 KB, it delays them little.
      for (const [width, max] of [["480", 12], ["1024", 120]] as const) {
        expect(f[width]).toMatch(/^[a-z-]+-\d+\.[0-9a-f]{10}\.webp$/);
        expect(statSync(new URL(`../public/fonds/${f[width]}`, import.meta.url)).size, f[width]).toBeLessThanOrEqual(max * 1024);
      }
    }
    expect(readFileSync(new URL("../public/_headers", import.meta.url), "utf8")).toMatch(/^\/fonds\/\*\n {2}Cache-Control: public, max-age=31536000, immutable$/m);
  });
});
