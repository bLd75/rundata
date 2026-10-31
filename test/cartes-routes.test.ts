import { describe, expect, it } from "vitest";
import island from "../src/places/island.json" with { type: "json" };
import { AROUND, communeMap, islandMap, mapCredit, NOMS_SCRIPT, project, traceMap } from "../src/web/map.js";
import { homePage } from "../src/web/home.js";
import routes from "../src/web/routes.json" with { type: "json" };

const NOMS = routes.noms as [string, number, number, number][];
/** A commune's outline (island.json: « M » then relative moves), and whether a point is inside one. */
const ring = (d: string) => {
  let [px, py] = [0, 0];
  return [...d.matchAll(/([Ml])(-?[\d.]+)[, ]?(-?[\d.]+)/g)].map(([, c, a, b]) => ([px, py] = c === "M" ? [+a, +b] : [px + +a, py + +b]));
};
const inside = (px: number, py: number, r: number[][]) => {
  let k = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > py !== r[j][1] > py && px < ((r[j][0] - r[i][0]) * (py - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) k = !k;
  return k;
};
const RINGS = island.paths.map((p) => ({ nom: p.nom, r: ring(p.d) }));
/** Whether a commune's name is on its commune (marketing): of 9 points across by 3 up and down of its box, its middle and 14 or more on it or at sea. */
const onItsOwn = (n: { x: number; y: number; fs: number; nom: string }) => {
  const half = (n.nom.length * 0.56 * n.fs) / 2;
  let ok = 0, mid = false;
  for (let a = 0; a <= 8; a++)
    for (let j = 0; j <= 2; j++) {
      const [px, py] = [n.x - half + (2 * half * a) / 8, n.y - 0.6 * n.fs + 1.2 * n.fs * (0.2 + 0.3 * j)];
      const on = RINGS.filter((q) => inside(px, py, q.r)).map((q) => q.nom);
      const v = on.length === 0 || on.includes(n.nom);
      if (v) ok++;
      if (a === 4 && j === 1) mid = v;
    }
  return mid && ok >= 14;
};
/** Whether a commune's name faces its town (marketing): from its middle towards the town, the first land met is its commune. */
const facing = (n: { x: number; y: number; fs: number; nom: string }, [tx, ty]: [number, number]) => {
  const steps = Math.ceil(Math.hypot(tx - n.x, ty - n.y) / (n.fs / 4));
  for (let i = 0; i <= steps; i++) {
    const on = RINGS.filter((q) => inside(n.x + ((tx - n.x) * i) / steps, n.y + ((ty - n.y) * i) / steps, q.r)).map((q) => q.nom);
    if (on.length) return on.includes(n.nom);
  }
  return false;
};
const at = (nom: string) => NOMS.find((n) => n[0] === nom)!;
// The names a map shows without its script, and where.
const shown = (svg: string) =>
  [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" data-x="[\d.]+" data-y="[\d.]+" font-size="([\d.]+)" data-r="(\d)"( data-w="")?(?: data-k="\d+")?(?: data-c="")?>([^<]*)<\/text>/g)]
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

  it("on the island's map, name a commune's town: up to 6 times its size from it, beyond 3 facing it, at sea only off its own coast, else not at all", () => {
    const lonLat = (x: number, y: number) => [island.bbox[0] + (x / island.w) * (island.bbox[2] - island.bbox[0]), island.bbox[3] - (y / island.h) * (island.bbox[3] - island.bbox[1])];
    const [, , x, y] = at("Saint-Benoît");
    // Stations around Saint-Benoît, 3.5 km apart, over 10 km: no room for its name; over 3.5 km: room beyond 3 times its size.
    const field = (n: number) => Array.from({ length: n * n }, (_, k) => lonLat(x - 25 * (n - 1) + (k % n) * 50, y - 25 * (n - 1) + Math.floor(k / n) * 50)).map(([lon, lat]) => ({ lon, lat, label: "24°", name: "Station", round: true }));
    const svg = islandMap({ markers: field(7), label: "x" });
    expect(svg).toContain('<g class="nm" aria-hidden="true" data-i=""');
    expect(shown(svg).map((n) => n.nom)).not.toContain("Saint-Benoît");
    const near = islandMap({ markers: field(3), label: "x" });
    const sb = shown(near).find((n) => n.nom === "Saint-Benoît")!;
    expect(Math.hypot(sb.x - x, sb.y - y)).toBeGreaterThan(3 * sb.fs);
    for (const n of [...shown(svg), ...shown(near)].filter((n) => island.paths.some((p) => p.nom === n.nom))) {
      const [, , tx, ty] = at(n.nom);
      const d = Math.hypot(n.x - tx, n.y - ty);
      expect(d, n.nom).toBeLessThanOrEqual(6 * n.fs + 0.01);
      if (d > 3 * n.fs + 0.01) expect(facing(n, [tx, ty]), n.nom).toBe(true);
      expect(onItsOwn(n), n.nom).toBe(true);
    }
    // The page's script has the same rule, and the commune's maps keep theirs.
    expect(NOMS_SCRIPT).toContain("town(t,fs)");
    expect(NOMS_SCRIPT).toContain(",NEAR=36,");
    // The places around the town, computed by the page as by the server, in the same order.
    const a = NOMS_SCRIPT.match(/,A=(\[\.\.\.Array\(625\)\][^\n]*?\)\)),NEAR=/)![1];
    expect(new Function(`return ${a}`)()).toEqual(AROUND);
    expect(AROUND).toHaveLength(441);
    expect(NOMS_SCRIPT).toContain("if(free(b)&&home(b,t)&&(i*i+j*j<=NEAR||face(b,t))){");
    expect(communeMap({ commune: "Le Tampon", spots: [], label: "x" })).not.toContain('data-i=""');
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

  it("on a commune's map, name a place of importance 3 only if far from roads and other names: the îlets, not the town's", () => {
    const sp = communeMap({ commune: "Saint-Paul", spots: [], label: "x" });
    const third = (svg: string) => [...svg.matchAll(/data-r="3"[^>]*>([^<]+)<\/text>/g)].map((m) => m[1].replaceAll("&#39;", "'"));
    // The îlets of Mafate, 5 to 8 km from a road.
    expect(third(sp)).toEqual(expect.arrayContaining(["Roche Plate", "Îlet des Orangers", "Îlet des Lataniers"]));
    // Close to a road or to a quarter: left out.
    expect(sp).not.toContain(">Bel-Air</text>");
    expect(sp).not.toContain(">Saint-Cœur</text>");
    expect(third(communeMap({ commune: "Le Tampon", spots: [], label: "x" }))).toContain("Grand Bassin");
    expect(third(communeMap({ commune: "La Possession", spots: [], label: "x" }))).toEqual(expect.arrayContaining(["Cayenne", "Îlet à Bourse"]));
    expect(third(communeMap({ commune: "Saint-Denis", spots: [], label: "x" }))).toEqual([]);
    // A trail's map keeps them all.
    expect(traceMap({ lines: [{ points: [[55.27, -21.0], [55.28, -21.01]], etat: "ouvert" }], label: "x" })).toContain('data-r="3"');
  });

  it("never put a letter on a point: a big quarter goes up to 3 times its size from its place, else is left out", () => {
    // Points all around Saint-Gilles les Bains (importance 1), then around Le Guillaume (2), in Saint-Paul.
    const lonLat = (x: number, y: number) => [island.bbox[0] + (x / island.w) * (island.bbox[2] - island.bbox[0]), island.bbox[3] - (y / island.h) * (island.bbox[3] - island.bbox[1])];
    const around = (nom: string) => {
      const [, , x, y] = at(nom);
      return Array.from({ length: 27 * 5 }, (_, k) => lonLat(x - 104 + (k % 27) * 8, y - 16 + Math.floor(k / 27) * 8));
    };
    const spotsAround = (nom: string) => around(nom).map(([lon, lat], i) => ({ lon, lat, i, t: "aire", f: "jeux", name: "Aire" }));
    const spots = spotsAround("Saint-Gilles les Bains");
    const svg = communeMap({ commune: "Saint-Paul", spots, label: "x" });
    const unit = +svg.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+)/)![1] / 390;
    const dots = spots.map((s) => project(s.lon, s.lat)).map(([x, y]) => [x - 10 * unit, y - 10 * unit, x + 10 * unit, y + 10 * unit]);
    const named = shown(svg);
    for (const n of named) {
      const half = (n.nom.length * 0.56 * n.fs) / 2;
      expect(dots.some((d) => d[0] < n.x + half && n.x - half < d[2] && d[1] < n.y + n.fs * 0.6 && n.y - n.fs * 0.6 < d[3])).toBe(false);
    }
    const sg = named.find((n) => n.nom === "Saint-Gilles les Bains")!;
    const [, , x, y] = at("Saint-Gilles les Bains");
    expect(Math.abs(sg.y - y)).toBeLessThanOrEqual(sg.fs * 4.1 + 0.01);
    expect(Math.abs(sg.x - x)).toBeLessThanOrEqual((sg.nom.length * 0.56 * sg.fs) / 2 + 2 * unit + sg.fs * 3 + 0.01);
    expect(communeMap({ commune: "Saint-Paul", spots: spotsAround("Le Guillaume"), label: "x" })).toMatch(/data-r="2" class="nx">Le Guillaume<\/text>/);
    // Its page's script does the same at the map's real size.
    expect(NOMS_SCRIPT).toContain("+t.dataset.r<2?[...P,...F]:P");
  });

  it("always name the commune of the map: at the free place inside it nearest its centre when its place is taken", () => {
    const [, , x, y] = at("Saint-Denis");
    const lonLat = (x: number, y: number) => [island.bbox[0] + (x / island.w) * (island.bbox[2] - island.bbox[0]), island.bbox[3] - (y / island.h) * (island.bbox[3] - island.bbox[1])];
    // Points over 9 km around its place, every 560 m.
    const spots = Array.from({ length: 17 * 17 }, (_, k) => lonLat(x - 64 + (k % 17) * 8, y - 64 + Math.floor(k / 17) * 8)).map(([lon, lat], i) => ({ lon, lat, i, t: "aire", f: "jeux", name: "Aire" }));
    const svg = communeMap({ commune: "Saint-Denis", spots, label: "x" });
    const own = svg.match(/<text x="([\d.]+)" y="([\d.]+)" data-x="[\d.]+" data-y="[\d.]+" font-size="[\d.]+" data-r="0" data-k="10" data-c="">Saint-Denis<\/text>/);
    expect(own).not.toBeNull();
    // Out of the points, so further than 64 units from its place on one side.
    expect(Math.max(Math.abs(+own![1] - x), Math.abs(+own![2] - y))).toBeGreaterThan(64);
    expect(NOMS_SCRIPT).toContain('t.hasAttribute("data-c")');
  });

  it("put the name of a commune by the sea at sea, off its own coast, when no place inside it is free", () => {
    const [, , x, y] = at("Saint-Pierre");
    const lonLat = (x: number, y: number) => [island.bbox[0] + (x / island.w) * (island.bbox[2] - island.bbox[0]), island.bbox[3] - (y / island.h) * (island.bbox[3] - island.bbox[1])];
    const commune = ring(island.paths.find((p) => p.nom === "Saint-Pierre")!.d);
    // Points on every part of the commune's land, 560 m apart.
    const spots = Array.from({ length: 61 * 41 }, (_, k) => [x - 240 + (k % 61) * 8, y - 160 + Math.floor(k / 61) * 8])
      .filter(([px, py]) => inside(px, py, commune))
      .map(([px, py], i) => { const [lon, lat] = lonLat(px, py); return { lon, lat, i, t: "aire", f: "jeux", name: "Aire" }; });
    const svg = communeMap({ commune: "Saint-Pierre", spots, label: "x" });
    const own = svg.match(/<text x="([\d.]+)" y="([\d.]+)" data-x="[\d.]+" data-y="[\d.]+" font-size="[\d.]+" data-r="0" data-k="15" data-c="">Saint-Pierre<\/text>/);
    expect(own).not.toBeNull();
    const [mx, my] = [+own![1], +own![2]];
    expect(island.paths.some((p) => inside(mx, my, ring(p.d)))).toBe(false);
    // South of the town, its coast between it and its place.
    expect(my).toBeGreaterThan(y);
    // Its neighbours' names, never on another commune: their middle and most of them on their own, or at sea.
    const others = shown(svg).filter((n) => n.nom !== "Saint-Pierre" && island.paths.some((p) => p.nom === n.nom));
    expect(others.map((n) => n.nom)).toContain("Le Tampon");
    for (const n of others) expect(onItsOwn(n), n.nom).toBe(true);
    // The page's script has the same rule, the commune's outline found by its number.
    expect(NOMS_SCRIPT).toContain("home(b,t)");
    expect(NOMS_SCRIPT).toContain("t.dataset.k");
  });

  it("number each commune's name by its outline on every map, the island's too", () => {
    for (const svg of [islandMap({ label: "x" }), communeMap({ commune: "Le Tampon", spots: [], label: "x" })]) {
      const named = [...svg.matchAll(/data-r="0"(?: data-w="")? data-k="(\d+)"[^>]*>([^<]*)</g)].map((m) => [island.paths[+m[1]].nom, m[2].replaceAll("&#39;", "'")]);
      expect(named.length).toBeGreaterThan(0);
      for (const [path, nom] of named) expect(path).toBe(nom);
    }
    expect(islandMap({ label: "x" })).toContain('<g id="isl">');
  });
  it("show a name once in a frame: the most important place of that name, then the nearest the commune's centre", () => {
    const svg = communeMap({ commune: "Saint-Paul", spots: [], label: "x" });
    // Places of the IGN called Bois de Nèfles, two of them in Saint-Paul's frame.
    const same = NOMS.filter((n) => n[0] === "Bois de Nèfles");
    expect(same.length).toBeGreaterThanOrEqual(2);
    const shown = [...svg.matchAll(/data-x="([\d.]+)" data-y="([\d.]+)"[^>]*>Bois de Nèfles<\/text>/g)].map((m) => [+m[1], +m[2]]);
    expect(shown).toHaveLength(1);
    const [, , cx, cy] = at("Saint-Paul");
    const top = Math.min(...same.map((n) => n[1]));
    const near = same.filter((n) => n[1] === top).sort((a, b) => (a[2] - cx) ** 2 + (a[3] - cy) ** 2 - ((b[2] - cx) ** 2 + (b[3] - cy) ** 2))[0];
    expect(shown[0]).toEqual([near[2], near[3]]);
    const names = [...svg.matchAll(/>([^<]+)<\/text>/g)].map((m) => m[1]);
    expect(names.length).toBe(new Set(names).size);
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

  it("have the charter's sizes on screen at any width: a commune 14 px (12 px on a phone), a place 11 px, a summit 12 px under a mark 13 px wide", () => {
    // 1000 units drawn for a phone 340 px wide: 12 px is 35.29 units, as the server places them.
    const svg = islandMap({ label: "x" });
    expect(svg).toMatch(/font-size="35\.29" data-r="0"[^>]*>Saint-Denis</);
    expect(NOMS_SCRIPT).toContain('const fs=(t.dataset.r==="0"?(cw>=400?14:12):11)*u;');
    expect(NOMS_SCRIPT).toContain("z=13*u/T.width");
    expect(NOMS_SCRIPT).toContain('pf=12*u;');
    expect(NOMS_SCRIPT).toContain('t.style.fontSize=pf+"px"');
  });

  it("come from a file of a known size: the 24 communes first, then the places, capitalised", () => {
    expect(NOMS.slice(0, 24).map((n) => n[0]).sort()).toEqual(island.paths.map((p) => p.nom).sort());
    expect(NOMS.slice(24).every((n) => n[1] >= 1 && n[1] <= 3 && n[0][0] === n[0][0].toUpperCase())).toBe(true);
    expect(at("Cilaos")[1]).toBe(0);
    expect(JSON.stringify(routes).length).toBeLessThan(140_000);
  });
});
