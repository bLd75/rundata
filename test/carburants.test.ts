import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import * as carburants from "../src/providers/carburants.js";
import { annuaireTool } from "../src/tools/annuaire.js";
import { FUEL } from "../src/tools/carburants.js";
import { handle } from "../src/app.js";
import { carburantsPage, descriptionOf, TITLE } from "../src/web/carburants.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const LIEN = "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Prix-des-carburants-en-octobre";
const NOW = new Date("2026-10-24T08:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
// The page keeps amounts and dates on one line (« 1,54\u00a0€ »): read here with plain spaces.
const flat = (s: string) => s.replaceAll("\u00a0", " ");
const render = (...a: Parameters<typeof carburantsPage>) => flat(carburantsPage(...a));

afterEach(() => {
  carburants.configure(undefined);
  vi.useRealTimers();
});

describe("the prefect's fuel prices", () => {
  it("are read from the release's table, whatever the way its columns are dated", () => {
    const oct = carburants.parseRelease(fixture("carburants_octobre.html"), LIEN, NOW)!;
    expect(oct.depuis).toBe("2026-10-01");
    expect(oct.precedent_depuis).toBe("2026-09-01");
    expect(oct.produits.slice(0, 2)).toEqual([
      { produit: "Supercarburant", unite: "€/litre", prix_eur: 2, precedent_eur: 1.83, note: undefined },
      { produit: "Gazole", unite: "€/litre", prix_eur: 1.8, precedent_eur: 1.68, note: undefined },
    ]);
    expect(oct.produits.find((p) => p.produit === "Gaz")).toMatchObject({ unite: "€/bouteille de 12,5 kg", prix_eur: 20.81, note: "18 € avec aides locales" });
    expect(oct.titre).toMatch(/^Évolution des prix des carburants en octobre/);
    // August's release dates its columns « 1-juil.-26 » and « 1-août-26 ».
    const aout = carburants.parseRelease(fixture("carburants_aout.html"), LIEN, NOW)!;
    expect(aout.depuis).toBe("2026-08-01");
    expect(aout.produits[0]).toMatchObject({ produit: "Supercarburant", prix_eur: 1.78, precedent_eur: 1.82 });
    expect(aout.produits.find((p) => p.produit === "Gaz")?.note).toBe("18 € avec aides de la Région");
    // A page without the table is not taken for one.
    expect(carburants.parseRelease("<h1>Prix des carburants</h1><p>Voir le tableau.</p>", LIEN)).toBeUndefined();
  });

  it("are found in the list of press releases, newest first", () => {
    const list = `<a class="fr-card__link" href="/Actualites/Communiques-de-presse/Prix-des-carburants-en-octobre">x</a>
      <a href="/Actualites/Communiques-de-presse/Secheresse">y</a><a href="/Actualites/Communiques-de-presse/Prix-des-carburants-au-1er-septembre-2026">z</a>`;
    expect(carburants.releases(list)).toEqual([LIEN, "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Prix-des-carburants-au-1er-septembre-2026"]);
    expect(carburants.headerDay("01/10/2026")).toBe("2026-10-01");
    expect(carburants.headerDay("1-déc.-26")).toBe("2026-12-01");
  });

  it("are read from the prefecture's site one page at a time, with the pause asked between two pages", async () => {
    const list = `<a href="/Actualites/Communiques-de-presse/Prix-des-carburants-sans-tableau">x</a><a href="/Actualites/Communiques-de-presse/Prix-des-carburants-en-octobre">y</a>`;
    const asked: [string, number][] = [];
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push([url, Date.now()]);
      return new Response(url.endsWith("sans-tableau") ? "<h1>Prix des carburants</h1>" : url.endsWith("en-octobre") ? fixture("carburants_octobre.html") : list);
    });
    try {
      const got = carburants.gather(NOW, 1, 60_000);
      await vi.advanceTimersByTimeAsync(130_000);
      expect((await got)?.lien).toBe(LIEN);
      const t0 = asked[0][1];
      expect(asked.map(([u, t]) => [u.replace("https://www.reunion.gouv.fr/Actualites/Communiques-de-presse", ""), t - t0])).toEqual([
        ["", 0],
        ["/Prix-des-carburants-sans-tableau", 60_000],
        ["/Prix-des-carburants-en-octobre", 120_000],
      ]);
      // Without a pause asked (the Worker), no timer at all.
      asked.length = 0;
      await carburants.gather(NOW, 1);
      expect(asked.map(([, t]) => t - asked[0][1])).toEqual([0, 0, 0]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("are never read from the prefecture by the Worker: an empty store leaves them unavailable", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => (asked.push(String(url)), new Response("", { status: 500 })));
    try {
      carburants.configure(async () => null);
      await expect(carburants.prix(new Cache(), NOW)).rejects.toThrow(/absents du stockage/);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await annuaireTool(new Cache(), "prix de l'essence", undefined, NOW);
      expect(body(r).erreur).toBe("Les prix des carburants ne sont pas disponibles pour le moment.");
      expect(asked.filter((u) => u.includes("reunion.gouv.fr"))).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("are what the public services tool answers about fuel, from the stored copy", async () => {
    const prix = carburants.parseRelease(fixture("carburants_octobre.html"), LIEN, NOW)!;
    carburants.configure(async () => prix);
    const r = body(await annuaireTool(new Cache(), "prix de l'essence", undefined, NOW));
    expect(r.resume).toBe("Prix maximum à La Réunion depuis le 1er octobre 2026 (arrêté du préfet) : sans plomb (« supercarburant » dans l'arrêté) 2,00 €/litre (+0,17 €)\u00a0; gazole 1,80 €/litre (+0,12 €)\u00a0; gaz 20,81 € la bouteille de 12,5 kg (+0,21 €), 18 € avec aides locales. Les mêmes plafonds dans toute l'île : une station peut vendre moins cher, pas plus.");
    expect(r.prix_maximums).toHaveLength(7);
    expect(r.communique.lien).toBe(LIEN);
    expect(r.avertissements).toEqual([]);
    expect(r.sources[0].licence).toMatch(/Licence Ouverte/);
    // In November, before the new order is read: said to be October's.
    const later = body(await annuaireTool(new Cache(), "gazole", undefined, new Date("2026-11-03T08:00:00Z")));
    expect(later.avertissements[0]).toBe("Les prix maximum de novembre 2026 ne sont pas encore lus : ce sont ceux d'octobre 2026, qui ont pu changer le 1er du mois.");
  });

  it("are asked in plain words, and only then", () => {
    for (const q of ["carburant", "prix de l'essence", "gazole", "sans plomb", "SP95", "bouteille de gaz", "prix à la pompe", "station-service"]) expect(FUEL.test(q), q).toBe(true);
    for (const q of ["mairie", "CAF", "préfecture", "impôts", "France Travail", "tribunal", "CPAM", "sous-préfecture de Saint-Pierre"]) expect(FUEL.test(q), q).toBe(false);
  });

  it("have their page, titled with the month, its description with the figures it has", async () => {
    const prix = carburants.parseRelease(fixture("carburants_octobre.html"), LIEN, NOW)!;
    const at = { value: prix, fetchedAt: NOW, stale: false };
    const page = render("https://rundata.re", at, NOW);
    expect(TITLE.length).toBeLessThanOrEqual(60);
    expect(page).toContain(`<title>${TITLE}</title>`);
    expect(page).toContain("<h1>Prix des carburants à La Réunion, octobre 2026</h1>");
    // Marketing's sentence, its end dropped when it would not fit in what search engines show.
    expect(descriptionOf(prix)).toBe("Prix maximum en octobre 2026 à La Réunion (974) : sans plomb 2,00 €/L (+0,17 €), gazole 1,80 €/L (+0,12 €), bouteille de gaz 20,81 €. Fixés par le préfet.");
    for (const depuis of ["2026-09-01", "2026-02-01", "2026-12-01"]) expect(descriptionOf({ ...prix, depuis }).length).toBeLessThanOrEqual(160);
    // A figure the order does not give is left out, not printed empty.
    expect(descriptionOf({ ...prix, produits: prix.produits.filter((x) => x.produit !== "Gazole") })).toBe("Prix maximum en octobre 2026 à La Réunion (974) : sans plomb 2,00 €/L (+0,17 €), bouteille de gaz 20,81 €. Fixés par le préfet, partout sur l'île.");
    expect(page).toContain("<td><b>1,26 €</b></td>");
    expect(page).toContain('content="https://rundata.re/og/carburants.');
    expect(page).not.toContain("pas encore publiés");
    // On the 2nd of November, before the new order: October's, said to be in force since the 1st of October.
    const early = render("https://rundata.re", at, new Date("2026-11-02T06:00:00Z"));
    expect(early).toContain("<h1>Prix des carburants à La Réunion, octobre 2026</h1>");
    expect(early).toContain("Les prix maximum de novembre 2026 ne sont pas encore publiés ou pas encore lus : voici ceux en vigueur depuis le 1er octobre 2026.");
  });

  it("are served at /carburants and dated in the sitemap by the prefect's order", async () => {
    const prix = carburants.parseRelease(fixture("carburants_octobre.html"), LIEN, NOW)!;
    carburants.configure(async () => prix);
    const cache = new Cache();
    const r = await handle(new Request("https://rundata.re/carburants", { headers: { accept: "text/html" } }), cache);
    expect(r.status).toBe(200);
    expect(flat(await r.text())).toContain("sans plomb 2,00 €/litre (+0,17 €)");
    const map = await (await handle(new Request("https://rundata.re/sitemap.xml"), cache)).text();
    expect(map).toContain("<loc>https://rundata.re/carburants</loc><lastmod>2026-10-01</lastmod>");
  });
});

// November 2025's release, as the Wayback Machine kept it the morning it came out (trimmed): published on the 31st
// of October, for the 1st of November.
describe("a new order read before its 1st", () => {
  const NOV = "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Prix-des-carburants-en-novembre-2025";
  const READ = new Date("2025-10-31T09:00:00Z");
  const nov = () => carburants.parseRelease(fixture("carburants_novembre_2025.html"), NOV, READ)!;
  const at = (p: carburants.Prix) => ({ value: p, fetchedAt: READ, stale: false });
  const ANNONCE = "Prix maximum au 1er novembre, fixés par la préfecture (communiqué du 31 octobre) : sans plomb 1,54 €/litre (−0,02 €)\u00a0; gazole 1,23 €/litre (−0,01 €)\u00a0; gaz 18,59 € la bouteille de 12,5 kg (−0,50 €), 18 € avec aides locales";
  // Every way the prices of November could be said in force.
  const IN_FORCE = /depuis le 1er novembre|en vigueur depuis le 1er novembre|à La Réunion, novembre 2025<\/h1>/;

  it("gives its release's day", () => {
    const p = nov();
    expect(p).toMatchObject({ depuis: "2025-11-01", precedent_depuis: "2025-10-01", publie: "2025-10-31" });
    expect(carburants.parseRelease(fixture("carburants_octobre.html"), LIEN, NOW)!.publie).toBeUndefined();
  });

  it("is announced on the page above the month in force, never said in force before the 1st at 0 h", () => {
    for (const t of ["2025-10-31T05:00:00Z", "2025-10-31T09:00:00Z", "2025-10-31T19:59:59Z"]) {
      const page = render("https://rundata.re", at(nov()), new Date(t));
      expect(page, t).toContain("<h1>Prix des carburants à La Réunion, octobre 2025</h1>");
      // The page is put in French typography as it is sent (web/typo.ts), not here.
      expect(page, t).toContain(`<p class="lead">${ANNONCE.replaceAll("\u00a0;", " ;")}.</p><p class="lead">En vigueur jusqu&#39;au 31 octobre : sans plomb 1,56 €/litre ; gazole 1,24 €/litre ; gaz 19,09 € la bouteille de 12,5 kg.</p>`);
      expect(page, t).toContain('<th scope="col">Au 1er novembre 2025</th><th scope="col">Jusqu&#39;au 31 octobre 2025</th>');
      expect(page, t).not.toMatch(IN_FORCE);
      expect(page, t).not.toContain("pas encore publiés");
    }
    // Without the release's day: the sentence without it.
    const undated = render("https://rundata.re", at({ ...nov(), publie: undefined }), READ);
    expect(undated).toContain("Prix maximum au 1er novembre, fixés par la préfecture : sans plomb 1,54 €/litre");
  });

  it("is in force from the 1st at 0 h, Réunion time, with no new reading", () => {
    const page = render("https://rundata.re", at(nov()), new Date("2025-10-31T20:00:00Z"));
    expect(page).toContain("<h1>Prix des carburants à La Réunion, novembre 2025</h1>");
    expect(page).toContain('<p class="lead">Prix maximum depuis le 1er novembre 2025 : sans plomb 1,54 €/litre (−0,02 €) ; gazole 1,23 €/litre (−0,01 €)');
    expect(page).not.toContain("au 1er novembre,");
    expect(carburantsPage("https://rundata.re", at(nov()), new Date("2025-10-31T20:00:00Z"))).toContain("depuis le 1er\u00a0novembre 2025 : sans plomb 1,54\u00a0€/litre (−0,02\u00a0€)");
    expect(page).not.toContain("En vigueur jusqu");
  });

  it("is told by the tool in two sentences, today's prices first", async () => {
    carburants.configure(async () => nov());
    const r = body(await annuaireTool(new Cache(), "prix de l'essence", undefined, READ));
    expect(r.resume).toBe(
      "Prix maximum en vigueur aujourd'hui à La Réunion, jusqu'au 31 octobre (arrêté du préfet) : sans plomb (« supercarburant » dans l'arrêté) 1,56 €/litre\u00a0; gazole 1,24 €/litre\u00a0; gaz 19,09 € la bouteille de 12,5 kg. " +
      `${ANNONCE}. Les mêmes plafonds dans toute l'île : une station peut vendre moins cher, pas plus.`,
    );
    expect(r.en_vigueur_depuis).toBe("1er octobre 2025");
    expect(r.prix_maximums[0]).toMatchObject({ produit: "Sans plomb", prix: "1,56 €/litre" });
    expect(r.a_venir).toMatchObject({ applicables_le: "1er novembre 2025" });
    expect(r.a_venir.prix_maximums[4].produit).toBe("Supercarburant destiné aux professionnels de la mer");
    expect(r.a_venir.prix_maximums[0]).toMatchObject({ produit: "Sans plomb", prix: "1,54 €/litre", mois_precedent: "1,56 €", evolution: "−0,02 €" });
    expect(r.avertissements).toEqual([]);
    // At 0 h on the 1st: November's, in force.
    const first = body(await annuaireTool(new Cache(), "prix de l'essence", undefined, new Date("2025-10-31T20:01:00Z")));
    expect(first.resume).toMatch(/^Prix maximum à La Réunion depuis le 1er novembre 2025 \(arrêté du préfet\) : sans plomb \(« supercarburant » dans l'arrêté\) 1,54 €\/litre/);
    expect(first.en_vigueur_depuis).toBe("1er novembre 2025");
    expect(first.a_venir).toBeUndefined();
  });

  it("on the 1st, an order not read yet is still said to be the past month's", () => {
    const oct = carburants.parseRelease(fixture("carburants_octobre.html"), LIEN, NOW)!;
    const page = render("https://rundata.re", at(oct), new Date("2026-10-31T20:01:00Z"));
    expect(page).toContain("Les prix maximum de novembre 2026 ne sont pas encore publiés ou pas encore lus : voici ceux en vigueur depuis le 1er octobre 2026.");
  });

  it("is asked for again every quarter of an hour while the copy is a past month's", async () => {
    const oct = carburants.parseRelease(fixture("carburants_octobre.html"), LIEN, NOW)!;
    let copy = oct;
    carburants.configure(async () => copy);
    let clock = Date.parse("2026-11-01T02:00:00Z");
    const cache = new Cache(new MemoryStore(), () => clock);
    expect((await carburants.prix(cache, new Date(clock))).value.depuis).toBe("2026-10-01");
    copy = { ...oct, depuis: "2026-11-01", precedent_depuis: "2026-10-01" };
    clock += 10 * 60_000;
    expect((await carburants.prix(cache, new Date(clock))).value.depuis).toBe("2026-10-01");
    clock += 6 * 60_000;
    expect((await carburants.prix(cache, new Date(clock))).value.depuis).toBe("2026-11-01");
    // A copy of the month is kept its six hours.
    copy = { ...copy, titre: "relu" };
    clock += 60 * 60_000;
    expect((await carburants.prix(cache, new Date(clock))).value.titre).not.toBe("relu");
  });

  it("is asked for again every quarter of an hour from the 28th, until the new order is in the copy", async () => {
    const oct = carburants.parseRelease(fixture("carburants_octobre.html"), LIEN, NOW)!;
    let copy = oct;
    carburants.configure(async () => copy);
    let clock = Date.parse("2026-10-27T10:00:00Z");
    const cache = new Cache(new MemoryStore(), () => clock);
    await carburants.prix(cache, new Date(clock));
    copy = { ...oct, titre: "relu" };
    // The 27th: its six hours.
    clock += 20 * 60_000;
    expect((await carburants.prix(cache, new Date(clock))).value.titre).not.toBe("relu");
    // The 31st: a quarter of an hour, the new order once there kept its six hours.
    clock = Date.parse("2026-10-31T15:00:00Z");
    expect((await carburants.prix(cache, new Date(clock))).value.titre).toBe("relu");
    copy = { ...oct, depuis: "2026-11-01", precedent_depuis: "2026-10-01" };
    clock += 16 * 60_000;
    expect((await carburants.prix(cache, new Date(clock))).value.depuis).toBe("2026-11-01");
    copy = { ...copy, titre: "relu encore" };
    clock += 16 * 60_000;
    expect((await carburants.prix(cache, new Date(clock))).value.titre).not.toBe("relu encore");
  });

  it("dates the page in the sitemap the day it is read, never ahead", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(READ);
    carburants.configure(async () => nov());
    const cache = new Cache();
    // Before any copy is stored, no day is known: no date.
    const before = await (await handle(new Request("https://rundata.re/sitemap.xml"), cache)).text();
    expect(before).toContain("<loc>https://rundata.re/carburants</loc><changefreq>daily</changefreq>");
    await handle(new Request("https://rundata.re/carburants", { headers: { accept: "text/html" } }), cache);
    const map = await (await handle(new Request("https://rundata.re/sitemap.xml"), cache)).text();
    expect(map).toContain("<loc>https://rundata.re/carburants</loc><lastmod>2025-10-31</lastmod>");
  });
});
