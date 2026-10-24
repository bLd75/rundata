import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { coupuresPage } from "../src/web/domains.js";
import { homePage } from "../src/web/home.js";
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

  it("serves /coupures-eau without an ordinary space before « : », its JSON-LD and metas untouched", async () => {
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
