import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { WORKER_FREE_LIMIT, count, counted, left } from "../src/budget.js";
import { Cache, MemoryStore, TieredStore, type CacheEntry } from "../src/cache.js";
import { configure } from "../src/providers/mf-auth.js";
import * as mf from "../src/providers/vigilance.js";
import { alerteOf, snapshot } from "../src/web/data.js";
import { homePage } from "../src/web/home.js";
import { DESCRIPTION_MAX, meteoPage, placePage, seaPage, vigilancePage } from "../src/web/pages.js";
import { PAGES, pageOf } from "../src/web/places.js";
import { isReader, site } from "../src/web/site.js";
import { unzip } from "../src/zip.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const NOW = new Date("2026-10-22T06:00:00Z");
const RUN = "2026-10-21T18.00.00Z";
const html = (path: string) => new Request(`https://rundata.re${path}`, { headers: { accept: "text/html" } });

function overLimit() {
  if (left() < 0) throw new Error("Too many subrequests by single Worker invocation");
}

/** The data center's cache, shared by the isolates there; each read or write is a subrequest. */
class EdgeLike extends MemoryStore {
  async get(key: string) {
    count();
    overLimit();
    return super.get(key);
  }
  async put(key: string, entry: CacheEntry) {
    count();
    overLimit();
    return super.put(key, entry);
  }
}

const isolate = (edge = new EdgeLike(), kv = new MemoryStore()) =>
  new Cache(new TieredStore(new MemoryStore(), edge), () => NOW.getTime(), false, kv);

function upstream(url: string): Response {
  if (url.includes("/token")) return Response.json({ access_token: "t", expires_in: 3600 });
  if (url.includes("DPPaquetObs")) return new Response(fixture("meteofrance_6min.csv"));
  if (url.includes("DPVigilance")) return new Response(fixture("vigilance_om.zip"));
  if (url.includes("aviationweather")) return new Response(fixture("metar.json"));
  if (url.endsWith("/live/all")) return new Response(fixture("pioupiou_all.json"));
  if (url.includes("pioupiou")) return Response.json({ data: JSON.parse(String(fixture("pioupiou_all.json"))).data[0] });
  if (url.includes("noaacwLEOACSPO")) return new Response(fixture("acspo.csv"));
  if (url.includes("erdMH1sstd1day")) return new Response(fixture("modis.csv"));
  if (url.includes("open-meteo.com/data")) return new Response(fixture("openmeteo_meta.json"));
  if (url.includes("open-meteo")) return new Response(fixture("openmeteo_cilaos.json"));
  if (url.includes("api-lannuaire")) {
    // The fixture holds the town halls of the whole island; the API answers for the commune asked.
    const insee = decodeURIComponent(url).match(/code_insee_commune="(\d+)"/)?.[1];
    const all = JSON.parse(String(fixture("annuaire_mairie.json")));
    return Response.json({ ...all, results: all.results.filter((r: { code_insee_commune: string }) => !insee || r.code_insee_commune === insee) });
  }
  if (url.includes("GetCapabilities")) return new Response(`<x>TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___${RUN}</x>`);
  if (url.includes("GetCoverage")) {
    const tif = url.includes("PRESSURE__GROUND") ? "ps" : url.includes("MEAN_SEA_LEVEL") ? "pmsl" : "t2m";
    return new Response(fixture(`arome/${tif}.tif`));
  }
  throw new Error(`unexpected ${url}`);
}

beforeEach(() => {
  configure({ applicationId: "test" });
  vi.stubGlobal("fetch", async (url: string) => {
    overLimit();
    return upstream(String(url));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  configure({});
});

/** A page as a Worker serves it: counted, background work awaited within the same invocation. */
async function serve(cache: Cache, path: string) {
  const pending: Promise<unknown>[] = [];
  const { value, used } = await counted(WORKER_FREE_LIMIT, async () => {
    const r = (await site(html(path), cache, (p) => pending.push(p), NOW))!;
    await Promise.all(pending);
    return r;
  });
  return { r: value, text: await value.text(), used };
}

describe("home page", () => {
  it("renders the live block from the stations, within the Worker's subrequests, and then from cache", async () => {
    const edge = new EdgeLike();
    const cold = await serve(isolate(edge), "/");
    expect(cold.r.headers.get("cache-control")).toBe("public, max-age=60");
    expect(cold.text).toContain("La Réunion <span class=\"n974\">974</span> en direct, dans votre assistant IA");
    expect(cold.text).toMatch(/meteo_actuelle\(lieu: "[^"]+"\)<\/p>\s*<p class="bubble ai">\d+(,\d)?\u202f°C, mesurés à \d\d:\d\d/);
    expect(cold.text).toContain("Piton Maïdo");
    expect(cold.text).toMatch(/mesuré à \d\d:\d\d/);
    expect(cold.used).toBeLessThanOrEqual(WORKER_FREE_LIMIT);
    // Another isolate of the same data center: the weather from the edge, and the oldest of the other tiles brought up
    // to date afterwards, still within the limit.
    const warm = await serve(isolate(edge), "/");
    expect(warm.text).toContain("Piton Maïdo");
    expect(warm.used).toBeLessThanOrEqual(WORKER_FREE_LIMIT);
  });

  it("still explains everything when no data is there yet", () => {
    const page = homePage("https://rundata.re", null, NOW);
    expect(page).toContain("Se met à jour");
    expect(page).toContain("https://rundata.re/mcp");
    expect(page).toContain('<link rel="canonical" href="https://rundata.re/">');
    const ld = page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1];
    expect(JSON.parse(ld).map((x: { "@type": string }) => x["@type"])).toEqual(["WebSite", "Organization", "SoftwareApplication"]);
    // Every category: a tile, and a link in the menu.
    for (const name of ["Météo", "Vigilance", "Mer", "Volcan", "Bus", "Air", "Électricité", "Calendrier", "Services publics", "Terrain et risques"]) {
      expect(page).toContain(`${name}</`);
    }
    expect(page).toContain('<li><a href="/electricite">Électricité</a></li>');
    expect(meteoPage("https://rundata.re", null, NOW)).toContain('<a href="/meteo" aria-current="page">Météo</a>');
    expect(placePage("https://rundata.re", pageOf("cilaos")!, null, NOW)).toContain('<a href="/meteo" aria-current="page">Météo</a>');
  });

  it("carries the tags that link previews read", () => {
    const page = homePage("https://rundata.re", null, NOW);
    for (const tag of ['property="og:image" content="https://rundata.re/og.png?v=', 'property="og:image:width" content="1200"',
      'name="twitter:card" content="summary_large_image"', 'property="og:locale" content="fr_FR"']) expect(page).toContain(tag);
    expect(page.match(/<title>(.*?)<\/title>/)![1].length).toBeLessThanOrEqual(65);
    expect(page).toMatch(/name="description" content="🇷🇪 [^"]*974/);
    for (const link of ["https://www.facebook.com/1432704299917309", "https://glama.ai/mcp/servers/bLd75/rundata", "https://www.data.gouv.fr/reuses/"]) expect(page).toContain(`href="${link}`);
  });

  it("keep every description within what search engines show", () => {
    const desc = (html: string) => html.match(/name="description" content="([^"]*)"/)![1].replace(/&#39;|&amp;|&quot;/g, "'");
    const pages = [homePage("https://rundata.re", null, NOW), seaPage("https://rundata.re", null, NOW), meteoPage("https://rundata.re", null, NOW),
      ...PAGES.map((p) => placePage("https://rundata.re", p, null, NOW))];
    for (const page of pages) expect(desc(page).length, desc(page)).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
});

describe("place pages", () => {
  it("one per commune and per famous place, all resolved", () => {
    expect(PAGES.filter((p) => p.commune)).toHaveLength(24);
    expect(pageOf("cilaos")?.place.nom).toBe("Cilaos");
    expect(pageOf("piton-de-la-fournaise")?.place.altitude_m).toBeGreaterThan(2000);
    expect(new Set(PAGES.map((p) => p.slug)).size).toBe(PAGES.length);
  });

  it("show the measurement and a labelled forecast, cold within the limit, warm from one read", async () => {
    const edge = new EdgeLike();
    const cold = await serve(isolate(edge), "/meteo/cilaos");
    expect(cold.text).toContain("<h1>Météo à Cilaos <span class=\"n974\">974</span></h1>");
    expect(cold.text).toContain("Mesuré en ce moment près de Cilaos");
    expect(cold.text).toContain("Prévision, pas une mesure");
    expect(cold.text).not.toContain("Température de la mer à Cilaos");
    expect(cold.used).toBeLessThanOrEqual(WORKER_FREE_LIMIT);
    const warm = await serve(isolate(edge), "/meteo/cilaos");
    expect(warm.used).toBeLessThanOrEqual(2);
  });

  it("give the sea temperature on the coast", async () => {
    const { text, used } = await serve(isolate(), "/meteo/saint-leu");
    expect(text).toContain("Température de la mer à Saint-Leu");
    expect(used).toBeLessThanOrEqual(WORKER_FREE_LIMIT);
  });

  it("answer an unknown place with a 404 that links to the others", async () => {
    const r = (await site(html("/meteo/paris"), isolate(), () => {}, NOW))!;
    expect(r.status).toBe(404);
    const text = await r.text();
    expect(text).toContain('href="/meteo/saint-denis"');
    expect(text).toContain('<ul class="chips"><li><a href="/meteo">Météo</a></li>');
  });
});

describe("commune pages", () => {
  it("give every category for the commune, cold within the limit, warm from a few reads", async () => {
    const edge = new EdgeLike();
    const cold = await serve(isolate(edge), "/communes/saint-leu");
    expect(cold.r.status).toBe(200);
    expect(cold.text).toContain(`<h1>Saint-Leu <span class="n974">974</span> en direct</h1>`);
    expect(cold.text).toMatch(/<h3><a href="\/meteo\/saint-leu">Météo<\/a><\/h3><p class="tv">\d+(,\d)?\u202f°C<\/p>/);
    expect(cold.text).toContain("pour la zone Ouest");
    expect(cold.text).toMatch(/<h3>Mairie<\/h3><p class="tv">(Ouverte|Fermée)<\/p>/);
    expect(cold.text).toContain("Mer"); // on the coast
    expect(cold.used).toBeLessThanOrEqual(WORKER_FREE_LIMIT);
    const warm = await serve(isolate(edge), "/communes/saint-leu");
    expect(warm.text).toMatch(/<h3>Mairie<\/h3><p class="tv">(Ouverte|Fermée)<\/p>/);
    expect(warm.used).toBeLessThanOrEqual(15);
  });

  it("leave the sea out in the Hauts, and only exist for the 24 communes", async () => {
    const { text } = await serve(isolate(), "/communes/cilaos");
    expect(text).not.toContain(`<h3><a href="/mer">Mer</a></h3>`);
    for (const path of ["/communes/maido", "/communes/paris"]) {
      expect((await site(html(path), isolate(), () => {}, NOW))!.status).toBe(404);
    }
  });

  it("are listed by zone, and linked from the menu, the home page and the weather pages", async () => {
    const list = (await serve(isolate(), "/communes")).text;
    expect(list.match(/href="\/communes\/[a-z-]+"/g)).toHaveLength(24);
    expect(list).toContain(`<a href="/communes" aria-current="page">Communes</a>`);
    expect(homePage("https://rundata.re", null, NOW)).toContain(`href="/communes/saint-paul"`);
    expect((await serve(isolate(), "/meteo/saint-paul")).text).toContain(`href="/communes/saint-paul"`);
  });
});

describe("what crawlers and previews fetch", () => {
  it("robots.txt points to the sitemap, which lists every page", async () => {
    const robots = await (await handle(new Request("https://rundata.re/robots.txt"), isolate())).text();
    expect(robots).toContain("Sitemap: https://rundata.re/sitemap.xml");
    const map = await (await handle(new Request("https://rundata.re/sitemap.xml"), isolate())).text();
    expect(map.match(/<loc>/g)).toHaveLength(PAGES.length + 13 + 24);
    expect(map).toContain("<loc>https://rundata.re/communes</loc>");
    expect(map).toContain("<loc>https://rundata.re/communes/saint-paul</loc>");
    expect(map).toContain("<loc>https://rundata.re/meteo</loc>");
    expect(map).toContain("<loc>https://rundata.re/volcan</loc>");
    expect(map).toContain("<loc>https://rundata.re/confidentialite</loc>");
    expect(map).toContain("<loc>https://rundata.re/vigilance</loc>");
    expect(map).toContain("<loc>https://rundata.re/meteo/cilaos</loc>");
  });

  it("serves the privacy policy and the terms, linked from every page's footer", async () => {
    for (const path of ["/confidentialite", "/conditions"]) {
      const r = await handle(new Request(`https://rundata.re${path}`), isolate());
      expect(r.status).toBe(200);
      const html = await r.text();
      expect(html).toContain(`<link rel="canonical" href="https://rundata.re${path}">`);
      expect(html).toContain('href="/confidentialite"');
      expect(html).toContain("contact@rundata.re");
    }
  });

  it("serves a 1200×630 PNG for link previews, and the flag as favicon", async () => {
    const r = await handle(new Request("https://rundata.re/og.png"), isolate());
    const png = new Uint8Array(await r.arrayBuffer());
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(png.length).toBeLessThan(300_000);
    const view = new DataView(png.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
    const icon = await handle(new Request("https://rundata.re/favicon.svg"), isolate());
    expect(await icon.text()).toContain("#e3262d");
  });

  it("gives command-line clients one line and crawlers the page", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const curl = await handle(new Request("https://rundata.re/", { headers: { "user-agent": "curl/8.5", accept: "*/*" } }), new Cache());
    expect(await curl.text()).toContain("Point d'accès MCP : https://rundata.re/mcp");
    const bot = await handle(new Request("https://rundata.re/", { headers: { "user-agent": "Googlebot/2.1", accept: "*/*" } }), new Cache());
    expect(bot.headers.get("content-type")).toContain("text/html");
  });
});

describe("page data", () => {
  it("is sent without its live block when it takes too long, and finished in the background", async () => {
    const c = new Cache(new MemoryStore(), () => NOW.getTime());
    const later: Promise<unknown>[] = [];
    const slow = () => new Promise<number>((r) => setTimeout(() => r(42), 30));
    expect(await snapshot(c, "k", slow, (p) => later.push(p), NOW, 5)).toBeNull();
    await Promise.all(later);
    expect((await snapshot(c, "k", slow, () => {}, NOW, 5))?.value).toBe(42);
  });

  it("is waited for by the fetchers of AI assistants and search engines, not by people", () => {
    const ua = (a: string) => new Request("https://rundata.re/", { headers: { "user-agent": a } });
    expect(isReader(ua("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot"))).toBe(true);
    expect(isReader(ua("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)"))).toBe(true);
    expect(isReader(ua("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"))).toBe(false);
  });

  it("is refreshed before the answer for an AI assistant, after it for a person", async () => {
    let t = NOW.getTime();
    const c = new Cache(new MemoryStore(), () => t);
    let n = 0;
    const build = async () => ++n;
    await snapshot(c, "k", build, () => {}, new Date(t));
    t += 10 * 60_000;
    expect((await snapshot(c, "k", build, () => {}, new Date(t), 1000, true))?.value).toBe(2);
  });

  it("is served old and refreshed after the response", async () => {
    let t = NOW.getTime();
    const c = new Cache(new MemoryStore(), () => t);
    let n = 0;
    const build = async () => ++n;
    await snapshot(c, "k", build, () => {}, new Date(t));
    t += 10 * 60_000;
    const later: Promise<unknown>[] = [];
    expect((await snapshot(c, "k", build, (p) => later.push(p), new Date(t)))?.value).toBe(1);
    await Promise.all(later);
    expect((await snapshot(c, "k", build, () => {}, new Date(t)))?.value).toBe(2);
  });
});

describe("vigilance and sea pages", () => {
  async function vigilanceSample() {
    const zip = fixture("vigilance_om.zip");
    const files = await unzip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, (n) => n.endsWith("_FMEE_.txt"));
    return mf.parse(JSON.parse(files.get("CDPV95_FMEE_.txt")!), JSON.parse(files.get("CDPV96_FMEE_.txt")!));
  }

  it("shows the vigilance zone by zone, without a banner when all is green", async () => {
    const { r, text, used } = await serve(isolate(), "/vigilance");
    expect(r.headers.get("cache-control")).toBe("public, max-age=60");
    expect(text).toContain("Pas d'alerte cyclonique");
    expect(text).toContain("Vigilance dans les 5 zones de l'île");
    expect(text).toContain("Sud-Est");
    expect(text).toContain("Ce que dit Météo-France");
    expect(text).not.toContain('class="alerte');
    expect(used).toBeLessThanOrEqual(WORKER_FREE_LIMIT);
  });

  it("puts a banner on every page while something is above green", async () => {
    const v = structuredClone(await vigilanceSample());
    v.zones[mf.ISLAND][mf.CYCLONE] = [{ couleur: 3, debut: "2026-10-22T00:00:00Z" }];
    const a = alerteOf(v, NOW)!;
    expect(a).toEqual({ couleur: 3, texte: expect.stringContaining("ALERTE CYCLONIQUE orange") });
    expect(homePage("https://rundata.re", null, NOW, a)).toContain('<div class="alerte vg vg3" role="status">');
    const page = vigilancePage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW, a);
    expect(page).toContain("Alerte cyclonique orange");
    expect(page).not.toContain("Voir la vigilance zone par zone");
    v.zones[mf.ISLAND][mf.CYCLONE] = [];
    v.zones["VIGI974-12"][12] = [{ couleur: 2, debut: "2026-10-22T00:00:00Z" }];
    expect(alerteOf(v, NOW)?.texte).toBe("Vigilance Météo-France : jaune fortes pluies / orages (Est).");
  });

  it("gives the sea temperature beach by beach", async () => {
    const { text, used } = await serve(isolate(), "/mer");
    expect(text).toContain("Température de la mer <span class=\"n974\">974</span>");
    expect(text).toContain("Boucan-Canot");
    expect(text).toContain('href="/meteo/saint-paul"');
    expect(text).toMatch(/\d+,\d °C/);
    expect(used).toBeLessThanOrEqual(WORKER_FREE_LIMIT);
  });
});
