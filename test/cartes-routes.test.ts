import { describe, expect, it } from "vitest";
import island from "../src/places/island.json" with { type: "json" };
import { communeMap, islandMap, mapCredit, NOMS_SCRIPT, project, traceMap } from "../src/web/map.js";
import { homePage } from "../src/web/home.js";
import routes from "../src/web/routes.json" with { type: "json" };

const NOMS = routes.noms as [string, number, number, number][];
const at = (nom: string) => NOMS.find((n) => n[0] === nom)!;
// The names a map shows without its script, and where.
const shown = (svg: string) =>
  [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" data-x="[\d.]+" data-y="[\d.]+" font-size="([\d.]+)" data-r="(\d)"( data-w="")?>([^<]*)<\/text>/g)]
    .map((m) => ({ x: +m[1], y: +m[2], fs: +m[3], nom: m[6].replaceAll("&#39;", "'").replaceAll("&amp;", "&") }));

describe("the roads and the names of places on the pages' maps", () => {
  it("draw the roads over the relief, under the data, and the communes' names under the markers", () => {
    const svg = islandMap({ markers: [{ lon: 55.45, lat: -20.88, label: "24°", name: "Saint-Denis", round: true }], highlight: "Saint-Paul", label: "x" });
    const order = ['<g class="rd"', '<path class="hl"', '<g class="nm"', '<g class="mk"'].map((s) => svg.indexOf(s));
    expect(order.every((i, k) => i > 0 && (!k || i > order[k - 1]))).toBe(true);
    // On a phone, six names; the 18 others for a wider map, by the page's script.
    expect(svg.match(/<text [^>]*data-w=""/g)).toHaveLength(18);
    expect(svg).toContain('<path id="rd-a" vector-effect="non-scaling-stroke" d="M');
  });

  it("never put a name on a marker: Saint-Denis's goes beside, above or below the one on its place, or is not shown", () => {
    const [, , x, y] = at("Saint-Denis");
    const [lon, lat] = [island.bbox[0] + (x / island.w) * (island.bbox[2] - island.bbox[0]), island.bbox[3] - (y / island.h) * (island.bbox[3] - island.bbox[1])];
    const svg = islandMap({ markers: [{ lon, lat, label: "24°", name: "Saint-Denis", round: true }], label: "x" });
    const [mx, my] = project(lon, lat);
    const sd = shown(svg).find((n) => n.nom === "Saint-Denis");
    expect(sd).toBeDefined();
    const half = (sd!.nom.length * 0.56 * sd!.fs) / 2;
    expect(Math.abs(sd!.x - mx) > 36 + half || Math.abs(sd!.y - my) > 36 + sd!.fs * 0.6).toBe(true);
    expect(Math.abs(mx - x)).toBeLessThan(1);
  });

  it("show no two names that touch", () => {
    const spots = [{ lon: 55.27, lat: -21.0, i: 1, t: "aire", f: "jeux", name: "Aire" }];
    const svg = communeMap({ commune: "Saint-Paul", spots, label: "x" });
    const boxes = shown(svg).map((n) => [n.x - (n.nom.length * 0.56 * n.fs) / 2, n.y - n.fs * 0.6, n.x + (n.nom.length * 0.56 * n.fs) / 2, n.y + n.fs * 0.6]);
    expect(boxes.length).toBeGreaterThan(5);
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]).toBe(false)));
  });

  it("on a commune's map, name the lesser places inside the commune only, and no « Lotissement »", () => {
    const svg = communeMap({ commune: "Entre-Deux", spots: [], label: "x" });
    // Le Bras Long is in Entre-Deux; Le Palmiste Rouge, in Cilaos, and Grand Bassin, in Le Tampon, are in its frame.
    expect(svg).toContain(">Le Bras Long</text>");
    expect(svg).not.toContain(">Le Palmiste Rouge</text>");
    expect(svg).not.toContain(">Grand Bassin</text>");
    expect(svg).toContain(">Cilaos</text>");
    expect(NOMS.filter((n) => n[0].startsWith("Lotissement"))).toEqual([]);
  });

  it("close up, take the departmental roads too, only those of the frame, and the places' names", () => {
    const svg = communeMap({ commune: "Cilaos", spots: [], label: "x" });
    expect(svg).toContain('<path id="rd-d"');
    expect(svg.length).toBeLessThan(islandMap({ label: "x" }).length + 40_000);
    expect(svg.indexOf('<g class="rd"')).toBeLessThan(svg.indexOf('<path class="hl"'));
    expect(svg.indexOf('<path class="hl"')).toBeLessThan(svg.indexOf('<g class="nm"'));
    expect(svg.indexOf('<g class="nm"')).toBeLessThan(svg.indexOf('<g class="spots"'));
    expect(svg).toMatch(/data-r="[123]"/);
    const trail = traceMap({ lines: [{ points: [[55.47, -21.13], [55.48, -21.12]], etat: "ouvert" }], label: "x" });
    expect(trail.indexOf('<g class="rd"')).toBeLessThan(trail.indexOf('class="trk-halo"'));
  });

  it("keep the colours of the data: under the weather's, the main roads alone on the maps in colours, nothing on the home page's", () => {
    const wx = islandMap({ under: "<foreignObject/>", top: "<g/>", label: "x" });
    expect(wx.indexOf("<foreignObject/>")).toBeLessThan(wx.indexOf('<g class="rd"'));
    // Its stations are drawn by the page: no name until the script sees them.
    expect(shown(wx)).toEqual([]);
    const fills = islandMap({ fills: { "Saint-Paul": "#f00" }, label: "x" });
    expect(fills).toContain('<g class="rd"');
    expect(fills).not.toContain('<g class="nm"');
    const hero = islandMap({ relief: true, label: "x" });
    expect(hero).not.toContain('class="rd"');
    expect(hero).not.toContain('class="nm"');
  });

  it("name the IGN's BD TOPO in the map's credit, and run their script on every page", () => {
    expect(mapCredit(islandMap({ label: "x" }))).toBe(`<p class="sources">Carte : contours des communes de geo.api.gouv.fr, relief, routes et noms de lieux de l'IGN (RGE ALTI, BD TOPO), sous Licence Ouverte Etalab 2.0.</p>`);
    expect(mapCredit(islandMap({ fills: { "Saint-Paul": "#f00" }, label: "x" }))).toBe(`<p class="sources">Carte : contours des communes de geo.api.gouv.fr, routes de l'IGN (BD TOPO), sous Licence Ouverte Etalab 2.0.</p>`);
    expect(homePage("https://rundata.re", null, new Date("2026-10-29T18:00:00Z"))).toContain(NOMS_SCRIPT);
  });

  it("come from a file of a known size: the 24 communes first, then the places, capitalised", () => {
    expect(NOMS.slice(0, 24).map((n) => n[0]).sort()).toEqual(island.paths.map((p) => p.nom).sort());
    expect(NOMS.slice(24).every((n) => n[1] >= 1 && n[1] <= 3 && n[0][0] === n[0][0].toUpperCase())).toBe(true);
    expect(at("Cilaos")[1]).toBe(0);
    expect(JSON.stringify(routes).length).toBeLessThan(140_000);
  });
});
