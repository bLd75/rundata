import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { nombre } from "../src/tools/format.js";
import type { HikeCard } from "../src/web/data.js";
import { coupuresPage, hikeCard } from "../src/web/domains.js";
import { homePage } from "../src/web/home.js";
import { esc } from "../src/web/map.js";
import { layout } from "../src/web/pages.js";
import { site } from "../src/web/site.js";
import { typo } from "../src/web/typo.js";

const NOW = new Date("2026-10-24T04:00:00Z");
const ORIGIN = "https://rundata.re";

// The rule as marketing wrote it, the slow way: what is kept as written, then the prose between.
const KEPT = /<(script|style|pre|code|textarea)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const reference = (html: string) =>
  html.replace(new RegExp(`${KEPT.source}|( )(?=[:;?!»])|(« )`, "g"), (m, _raw, sp, open) => (sp ? " " : open ? "« " : m));
const kept = (html: string) => html.match(KEPT) ?? [];
const prose = (html: string) => html.replace(KEPT, "<>");
const jsonld = (html: string) => /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1];

describe("French typography on the pages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts a no-break space before : ; ? ! » and after «, in the text only", () => {
    expect(typo("<h1>Après un cyclone : l'eau du robinet</h1>")).toBe("<h1>Après un cyclone : l'eau du robinet</h1>");
    expect(typo("<p>Il pleut ? Oui ! Ici ; là.</p>")).toBe("<p>Il pleut ? Oui ! Ici ; là.</p>");
    // A quotation keeps its words: only the spaces inside the marks change.
    expect(typo("<p>Le préfet dit « ne montez pas ! » ce soir.</p>")).toBe("<p>Le préfet dit « ne montez pas ! » ce soir.</p>");
    // Hours, URLs and the spaces already written by hand stay as they are.
    expect(typo("<p>Ouvert à 6:00, voir https://rundata.re/mer?ref=wa, 25 km, Titre : déjà.</p>")).toBe("<p>Ouvert à 6:00, voir https://rundata.re/mer?ref=wa, 25 km, Titre : déjà.</p>");
  });

  it("leaves the tags, their attributes, the comments, the scripts and the code as written", () => {
    const html = [
      `<meta name="description" content="Coupures : où ? quand !">`,
      `<a href="https://wa.me/?text=Mer : houle" title="Mer : houle">Mer : houle</a>`,
      `<script type="application/ld+json">{"name":"Mer : houle ?"}</script>`,
      `<script>const a = b ? c : d;</script>`,
      `<style>a :hover { color: red ; }</style>`,
      `<pre>x : y</pre><code>a ? b : c</code><textarea>Avis : rien</textarea>`,
      `<!-- note : interne -->`,
      `<img alt="Le volcan : en éruption">`,
    ].join("\n");
    const out = typo(html);
    expect(kept(out)).toEqual(kept(html));
    expect(out).toContain(">Mer : houle</a>");
    expect(out.match(/ /g)).toHaveLength(1);
  });

  it("does on real pages what the rule says, changing nothing but spaces", () => {
    for (const html of [homePage(ORIGIN, null, NOW), coupuresPage(ORIGIN, null, NOW)]) {
      const out = typo(html);
      expect(out).toBe(reference(html));
      expect(kept(out)).toEqual(kept(html));
      expect(jsonld(out)).toBe(jsonld(html));
      expect(out.replace(/ /g, " ")).toBe(html.replace(/ /g, " "));
      expect(prose(out)).not.toMatch(/ [:;?!»]|« /);
    }
  });

  it("puts the descriptions of the metas and of the JSON-LD in French typography, the no-break space itself, never the titles", () => {
    // As describe() gives it for /coupures-eau/la-plaine-des-palmistes (rundata.re, 25/10 18:17), under 160 characters.
    const title = "Coupure d'eau La Plaine-des-Palmistes : avis en cours · 974";
    const description = "La Plaine-des-Palmistes (974) : eau à ne pas boire ; 5 avis de CIREST / CISE Réunion en cours ou à venir, avec les rues, les heures et les consignes.";
    const jsonld = [{ "@type": "WebPage", name: title, description, url: "https://rundata.re/x?a=1&b=2", about: { "@type": "Place", description: "Est : la côte au vent" } }];
    const html = layout(ORIGIN, { title, description, path: "/coupures-eau/la-plaine-des-palmistes", jsonld }, "", "");
    const said = "La Plaine-des-Palmistes (974)\u00a0: eau à ne pas boire\u00a0; 5 avis de CIREST / CISE Réunion en cours ou à venir, avec les rues, les heures et les consignes.";
    for (const meta of ["name=\"description\"", "property=\"og:description\"", "name=\"twitter:description\""]) {
      const content = new RegExp(`<meta ${meta} content="([^"]*)">`).exec(html)![1];
      expect(content, meta).toBe(said);
      expect(content.length, meta).toBe(esc(description).length);
    }
    expect(html).not.toContain("&nbsp;");
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1];
    expect(ld).not.toContain("&nbsp;");
    const page = JSON.parse(ld);
    expect(page.description).toBe(said);
    expect(page.about.description).toBe("Est\u00a0: la côte au vent");
    // The titles keep their ordinary space, the same in the JSON-LD as in <title>; the other values are as written.
    expect(page.name).toBe(title);
    expect(page.url).toBe("https://rundata.re/x?a=1&b=2");
    expect(html).toContain(`<title>${esc(title)}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${esc(title)}">`);
  });

  it("serves /coupures-eau without an ordinary space before « : », the titles of its JSON-LD and metas as written", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("hors ligne");
    });
    const res = await site(new Request(`${ORIGIN}/coupures-eau`), new Cache(new MemoryStore(), () => NOW.getTime()), () => {}, NOW);
    const html = await res!.text();
    expect(prose(html)).not.toMatch(/ :/);
    expect(prose(html)).toMatch(/ :/);
    // The title's words as written in the JSON-LD and in the metas, with their ordinary space.
    expect(jsonld(html)).toMatch(/ : /);
    expect(html).toMatch(/<meta property="og:title" content="[^"]* : [^"]*">/);
    expect(html).not.toMatch(/<meta name="description" content="[^"]* [:;?!][^"]*">/);
  });

  it("takes a fraction of a millisecond on a page of the site", () => {
    const html = homePage(ORIGIN, null, NOW);
    for (let i = 0; i < 20; i++) typo(html);
    const t = performance.now();
    for (let i = 0; i < 100; i++) typo(html);
    // About 0.3 ms on a 120 kB page (a regular expression took twice as long): a tenfold margin for slower machines.
    expect((performance.now() - t) / 100).toBeLessThan(3);
  });
});

describe("numbers", () => {
  it("separates the thousands from 4 digits with a narrow no-break space, as toLocaleString fr-FR", () => {
    expect([999, 1000, 3210, 12_500.5, 410_000].map(nombre)).toEqual(["999", "1\u202f000", "3\u202f210", "12\u202f500,5", "410\u202f000"]);
  });

  it("holds a trail's climb and its top to their unit", () => {
    const card = { k: "pdn", nom: "Piton des Neiges", slug: "piton-des-neiges", km: 15.2, dplus: 1720, dmoins: 1720, alt_max: 3070, boucle: false, secteur: "Cilaos", fermes: [], inconnus: [], onf: 3 } as unknown as HikeCard;
    const html = hikeCard(card);
    expect(html).toContain("+1\u202f720\u00a0m");
    expect(html).toContain("jusqu&#39;à 3\u202f070\u00a0m");
    expect(html).not.toMatch(/\d \d{3}/);
  });
});
