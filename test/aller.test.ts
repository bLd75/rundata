import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import * as enfants from "../src/vie/enfants.js";
import { aller, MOTS, SCRIPT, SHEET } from "../src/web/aller.js";
import { couleur, enfantsCommunePage, enfantsPage } from "../src/web/enfants.js";
import { daePage } from "../src/web/domains.js";
import { pageOf } from "../src/web/places.js";

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
  html: string;
  open: boolean;
  ok: string;
  prevented: boolean;
  copied: string[];
  copy: (fails?: boolean) => Promise<void>;
}

/** The script on a page of stubs, a click on a button made by aller() (its attributes read back from the HTML). */
function click(button: string, ua: string): Sheet {
  const attrs = Object.fromEntries([...button.matchAll(/ ([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2].replace(/&amp;/g, "&").replace(/&#39;/g, "'")]));
  const a = {
    href: attrs.href,
    dataset: Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5), v])),
    getAttribute: (k: string) => attrs[k] ?? null,
    closest: (s: string) => (s === "a.aller" ? a : null),
  };
  const out: Sheet = { title: "", html: "", open: false, ok: "", prevented: false, copied: [], copy: async () => undefined };
  const h2 = { set textContent(t: string) { out.title = t; } };
  const ul = { set innerHTML(h: string) { out.html = h; } };
  const ok = { set textContent(t: string) { out.ok = t; } };
  let inSheet: (ev: unknown) => void = () => undefined;
  let onPage: (ev: unknown) => void = () => undefined;
  let fail = false;
  const dialog = {
    showModal: () => (out.open = true),
    close: () => (out.open = false),
    querySelector: (s: string) => ({ h2, ul, ".ok": ok })[s],
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
