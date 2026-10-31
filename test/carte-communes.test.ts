import { describe, expect, it } from "vitest";
import island from "../src/places/island.json" with { type: "json" };
import { NAME_UNITS, nameBox, PLACES, SURVOL_SCRIPT } from "../src/web/carte-communes.js";
import { COMMUNES, communePage, communesPage } from "../src/web/commune.js";
import { H, islandMap, W } from "../src/web/map.js";
import { CSS } from "../src/web/pages.js";
import { pageOf } from "../src/web/places.js";

const ORIGIN = "https://rundata.re";
const map = (html: string) => html.match(/<figure class="card mapcard(?: nophone| noms)?">(.*?)<\/figure>/s)![1];

/** A commune's outline (island.json: « M » then relative moves), and whether a point is inside it. */
const ring = (nom: string) => {
  let x = 0, y = 0;
  return [...island.paths.find((p) => p.nom === nom)!.d.matchAll(/([Ml])(-?[\d.]+)[, ]?(-?[\d.]+)/g)].map(([, c, a, b]) => ([x, y] = c === "M" ? [+a, +b] : [x + +a, y + +b]) as [number, number]);
};
const inside = (x: number, y: number, r: [number, number][]) => {
  let v = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) v = !v;
  return v;
};

describe("the names on the map of /communes", () => {
  const html = map(communesPage(ORIGIN));

  it("name the 24 communes, each a link to its page", () => {
    const names = [...html.matchAll(/<a class="sp" href="([^"]+)" aria-label="([^"]+), voir sa page" data-pn="([^"]+)" data-pv="commune">/g)].map((m) => m.map((x) => x.replace("&#39;", "'")));
    expect(names).toHaveLength(24);
    expect(names.map((m) => m[3]).sort()).toEqual(COMMUNES.map((c) => c.nom).sort());
    for (const [, href, , nom] of names) expect(href).toBe(`/communes/${COMMUNES.find((c) => c.nom === nom)!.slug}`);
    // Shortened on the map, said in full.
    expect(html).toContain('aria-label="Les Trois-Bassins, voir sa page"');
    expect(html).toContain("<tspan");
  });

  it("place no name over another, nor on the edge of the map", () => {
    // 6 px from the frame on a phone's map, 343 px wide: never on its edge.
    const edge = Math.ceil((6 * W) / 343);
    const boxes = Object.keys(PLACES).map((nom) => [nom, nameBox(nom)] as const);
    for (const [nom, b] of boxes) {
      expect(b[0] >= edge && b[1] >= edge && b[2] <= W - edge && b[3] <= H - edge, nom).toBe(true);
      for (const [other, o] of boxes) if (other !== nom) expect(b[0] < o[2] && o[0] < b[2] && b[1] < o[3] && o[1] < b[3], `${nom} / ${other}`).toBe(false);
    }
  });

  it("put a name in its commune, or at sea tied to its town", () => {
    for (const [nom, p] of Object.entries(PLACES)) {
      if (p.tie) {
        expect(island.paths.some((s) => inside(p.x, p.y, ring(s.nom))), `${nom} en mer`).toBe(false);
        expect(html).toContain(`<circle cx="`);
      } else expect(inside(p.x, p.y, ring(nom)), nom).toBe(true);
    }
    expect(html.match(/<g class="tie"[^>]*>(.*?)<\/g>/s)![1].match(/<path/g)).toHaveLength(Object.values(PLACES).filter((p) => p.tie).length);
  });

  it("are big enough to read on a phone: 12 px on its map 343 px wide, its card's margin narrowed", () => {
    expect((NAME_UNITS * 343) / W).toBeGreaterThanOrEqual(12);
    expect(communesPage(ORIGIN)).toContain('<figure class="card mapcard noms">');
    expect(CSS).toContain("@media (max-width:37.49rem){.mapcard.noms{padding:.4rem}}");
  });

  it("light a commune's name while it is hovered, and the commune while its name is", () => {
    expect(communesPage(ORIGIN)).toContain(`</figure><script>${SURVOL_SCRIPT}</script>`);
    // Its legend's line (marketing's charter of the maps): a tap on a name or a commune opens its page.
    expect(communesPage(ORIGIN)).toContain(`<figcaption class="note" style="color:var(--on-night-muted)">Touchez une commune pour ouvrir sa page.</figcaption></figure>`);
    expect(CSS).toContain(".map .cn a.on text");
    expect(CSS).toContain(".map .zn.on path");
    // The names in the order of the communes' links, so that the script pairs them by rank.
    const zones = [...html.matchAll(/<a class="zn"[^>]*><title>([^<]+)<\/title>/g)].map((m) => m[1]);
    const names = [...html.matchAll(/<a class="sp"[^>]* data-pn="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(zones);
  });

  it("leave the communes' own links to the mouse, so that the keyboard meets each commune once", () => {
    expect(html.match(/<a class="zn" href="[^"]+" tabindex="-1" aria-hidden="true" data-pn="[^"]+" data-pv="commune">/g)).toHaveLength(24);
    // The placed names of the other maps are not drawn.
    expect(html).not.toContain('class="nm"');
  });

  it("change no other map", () => {
    const other = islandMap({ links: { Cilaos: { href: "/communes/cilaos" } }, label: "Carte" });
    expect(other).toContain('<a class="zn" href="/communes/cilaos" aria-label="Cilaos, voir sa page" data-pn="Cilaos" data-pv="commune">');
    expect(other).toContain('class="nm"');
    expect(other).not.toContain('class="cn"');
    expect(map(communePage(ORIGIN, pageOf("cilaos")!, { place: null }))).not.toContain('class="cn"');
  });
});
