import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache, MemoryStore } from "../src/cache.js";
import type { Hit } from "../src/metrics.js";
import { point } from "../src/metrics.js";
import { legalPage, offlinePage, placePage } from "../src/web/pages.js";
import { pageOf } from "../src/web/places.js";
import { KEPT_PAGES, serviceWorker } from "../src/web/pwa.js";
import { manifest, site } from "../src/web/site.js";
import { withVolcan } from "../src/web/volcan-alerte.js";

const O = "https://rundata.re";
// 24/10/2026 18:42, Réunion time.
const NOW = new Date("2026-10-24T14:42:00Z");

/** A browser's Cache Storage, kept in memory: a put moves its entry to the end, as the spec says. */
class FakeCaches {
  stores = new Map<string, Map<string, Response>>();
  async open(name: string) {
    const m = this.stores.get(name) ?? new Map<string, Response>();
    this.stores.set(name, m);
    const url = (k: string | Request) => new URL(typeof k === "string" ? k : k.url, O).href;
    return {
      match: async (k: string | Request) => m.get(url(k))?.clone(),
      put: async (k: string | Request, r: Response) => {
        m.delete(url(k));
        m.set(url(k), r);
      },
      addAll: async (list: string[]) => {
        for (const p of list) m.set(url(p), new Response(`shell ${p}`, { headers: { "content-type": p.endsWith("hors-ligne") ? "text/html" : "x/y" } }));
      },
      keys: async () => [...m.keys()].map((k) => new Request(k)),
      delete: async (k: string | Request) => m.delete(url(k)),
    };
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async match(k: string, o?: { cacheName?: string }) {
    for (const [name, m] of this.stores) if (!o?.cacheName || o.cacheName === name) {
      const hit = m.get(new URL(k, O).href);
      if (hit) return hit.clone();
    }
    return undefined;
  }
}

type Listener = (e: any) => void;

/** The service worker run against a fake browser: its network, its caches, its windows, its timer. */
function worker(opts: { net?: (r: Request) => Promise<Response>; slow?: boolean } = {}) {
  const on = new Map<string, Listener>();
  const caches = new FakeCaches();
  const asked: Request[] = [];
  const windows: { id: string; focused: boolean }[] = [];
  const calls = { skipWaiting: 0, claim: 0 };
  const self = {
    location: new URL(O),
    addEventListener: (t: string, f: Listener) => on.set(t, f),
    skipWaiting: async () => void calls.skipWaiting++,
    clients: { claim: async () => void calls.claim++, matchAll: async () => windows },
  };
  const net = opts.net ?? (async () => basic(new Response("<html><head><title>Météo Cilaos</title></head><body><p>en direct</p></body></html>", { headers: { "content-type": "text/html; charset=utf-8" } })));
  const fetch = (r: Request) => {
    asked.push(r);
    return net(r);
  };
  // The page's wait for a slow network: at once when the test asks for it, never otherwise.
  const timer = (f: () => void) => (opts.slow ? queueMicrotask(f) : undefined);
  new Function("self", "caches", "fetch", "setTimeout", serviceWorker(["/font.woff2", "/favicon.svg"]))(self, caches, fetch, timer);

  const extend = async (type: string, extra: object = {}) => {
    const waits: Promise<unknown>[] = [];
    let answer: Promise<Response> | undefined;
    on.get(type)!({ ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => (answer = p) });
    const res = answer ? await answer : undefined;
    // What the worker keeps doing after its answer (the copy), as long as the browser lets it.
    await Promise.race([(async () => { for (let i = 0; i < waits.length; i++) await waits[i]; })(), new Promise((ok) => setTimeout(ok, 200))]);
    return res;
  };
  const navigate = (path: string, init: RequestInit = {}) => {
    const r = new Request(`${O}${path}`, init);
    Object.defineProperty(r, "mode", { value: "navigate" });
    return extend("fetch", { request: r });
  };
  return { caches, asked, windows, calls, extend, navigate, message: (data: unknown, id: string) => extend("message", { data, source: { id } }) };
}

/** A same-origin response, as a browser gives it to a service worker. */
const basic = (r: Response) => Object.defineProperty(r, "type", { value: "basic" });
const offline = async () => {
  throw new TypeError("Failed to fetch");
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("the service worker", () => {
  it("keeps the shell, the offline page first, and takes over at once from an old version", async () => {
    const w = worker();
    await (await w.caches.open("coquille-ancienne")).put("/x", new Response("vieux"));
    await w.extend("install");
    const shell = [...w.caches.stores.keys()].find((k) => k.startsWith("coquille-") && k !== "coquille-ancienne")!;
    expect([...w.caches.stores.get(shell)!.keys()]).toEqual([`${O}/hors-ligne`, `${O}/font.woff2`, `${O}/favicon.svg`]);
    expect(w.calls.skipWaiting).toBe(1);
    await w.extend("activate");
    expect(await w.caches.keys()).not.toContain("coquille-ancienne");
    expect(w.calls.claim).toBe(1);
  });

  it("changes its text only with the files it keeps", () => {
    expect(serviceWorker(["/a"])).toBe(serviceWorker(["/a"]));
    expect(serviceWorker(["/a"]).match(/coquille-\w+/)![0]).not.toBe(serviceWorker(["/b"]).match(/coquille-\w+/)![0]);
  });

  it("asks the network first, and keeps a copy of a page served whole, under its address without query", async () => {
    const w = worker();
    const res = await w.navigate("/meteo/cilaos/?ref=wa");
    expect(await res!.text()).toContain("en direct");
    const kept = await (await w.caches.open("pages")).match(`${O}/meteo/cilaos`);
    expect(kept!.headers.get("x-copie")).toBe(String(NOW.getTime()));
    expect(decodeURIComponent(kept!.headers.get("x-titre")!)).toBe("Météo Cilaos");
  });

  it("dates a copy by the page's own Date: one the browser kept a minute is as old as it is", async () => {
    const made = new Date(NOW.getTime() - 50_000);
    const w = worker({ net: async () => basic(new Response("<body>m</body>", { headers: { "content-type": "text/html", date: made.toUTCString() } })) });
    await w.navigate("/mer");
    expect((await (await w.caches.open("pages")).match(`${O}/mer`))!.headers.get("x-copie")).toBe(String(made.getTime()));
  });

  it("keeps no page without its live block (no-store), no error, and never the assistants' copies, the MCP server or the feeds", async () => {
    const w = worker({ net: async (r) => basic(new Response("<body>x</body>", { status: r.url.includes("erreur") ? 500 : 200, headers: { "content-type": "text/html", "cache-control": "no-store" } })) });
    await w.navigate("/vigilance");
    await w.navigate("/erreur");
    expect(w.caches.stores.get("pages")?.size ?? 0).toBe(0);
    for (const path of ["/meteo?maj=12h47", "/mcp", "/communes/saint-paul.rss", "/sentiers/x.gpx", "/sw.js"]) expect(await w.navigate(path)).toBeUndefined();
    expect(await w.extend("fetch", { request: new Request(`${O}/avis`, { method: "POST", body: "x" }) })).toBeUndefined();
  });

  it("keeps the last pages only", async () => {
    const w = worker();
    for (let i = 0; i <= KEPT_PAGES; i++) await w.navigate(`/meteo/p${i}`);
    const keys = await (await w.caches.open("pages")).keys();
    expect(keys).toHaveLength(KEPT_PAGES);
    expect(keys[0].url).toBe(`${O}/meteo/p1`);
  });

  it("without network, shows the copy under a banner with its date, above everything, alerts included", async () => {
    let up = true;
    const page = `<!doctype html><html><head><title>Volcan</title></head><body>\n<header>menu</header>\n<div class="alerte volcan">Alerte 1</div><main>état</main></body></html>`;
    const w = worker({ net: async () => (up ? basic(new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } })) : offline()) });
    await w.navigate("/volcan");
    await w.navigate("/meteo/cilaos");
    up = false;
    vi.setSystemTime(new Date(NOW.getTime() + 3 * 3600_000));
    const html = await (await w.navigate("/volcan/"))!.text();
    expect(html).toContain(`<body>\n<div class="horsligne" role="status">Hors ligne : copie du 24/10 à 18:42. L'état du volcan a pu changer depuis.</div>\n<header>`);
    expect(html.indexOf("horsligne")).toBeLessThan(html.indexOf("alerte volcan"));
    expect(await (await w.navigate("/meteo/cilaos"))!.text()).toContain("Hors ligne : copie du 24/10 à 18:42. Les informations ont pu changer depuis.");
  });

  it("says the vigilance may have changed, and gives the year of a copy from another year", async () => {
    let up = true;
    const w = worker({ net: async () => (up ? basic(new Response("<body>v</body>", { headers: { "content-type": "text/html" } })) : offline()) });
    vi.setSystemTime(new Date("2025-12-31T15:05:00Z"));
    await w.navigate("/vigilance");
    up = false;
    vi.setSystemTime(NOW);
    expect(await (await w.navigate("/vigilance"))!.text()).toContain("Hors ligne : copie du 31/12/2025 à 19:05. La vigilance a pu changer depuis.");
  });

  it("without network and without a copy, shows the offline page", async () => {
    const w = worker({ net: offline });
    await w.extend("install");
    expect(await (await w.navigate("/meteo/salazie"))!.text()).toBe("shell /hors-ligne");
  });

  it("shows the copy when the network is too slow to bring the page", async () => {
    let up = true;
    const w = worker({ net: async () => (up ? basic(new Response("<body>p</body>", { headers: { "content-type": "text/html" } })) : new Promise<Response>(() => {})), slow: true });
    await w.navigate("/randonnees");
    up = false;
    expect(await (await w.navigate("/randonnees"))!.text()).toContain("Hors ligne : copie du 24/10 à 18:42.");
  });

  it("marks the pages the installed app asks for with rundata-mode: app, and no others", async () => {
    const w = worker();
    w.windows.push({ id: "onglet", focused: true }, { id: "appli", focused: false });
    await w.message("app", "appli");
    await w.navigate("/meteo");
    expect(w.asked.at(-1)!.headers.get("rundata-mode")).toBeNull();
    w.windows[0].focused = false;
    w.windows[1].focused = true;
    await w.navigate("/meteo");
    expect(w.asked.at(-1)!.headers.get("rundata-mode")).toBe("app");
    // The first page from the icon, before the app's window has said anything.
    const fresh = worker();
    await fresh.navigate("/?ref=pwa");
    expect(fresh.asked.at(-1)!.headers.get("rundata-mode")).toBe("app");
    expect([...fresh.asked.at(-1)!.headers.keys()].filter((k) => k.startsWith("rundata"))).toEqual(["rundata-mode"]);
  });
});

describe("the site's part", () => {
  const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());

  it("serves the service worker, checked again at each visit, and the offline page", async () => {
    const sw = await site(new Request(`${O}/sw.js`), cache(), () => {}, NOW);
    expect(sw!.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(sw!.headers.get("cache-control")).toBe("no-cache");
    expect(await sw!.text()).toMatch(/const SHELL=\["\/hors-ligne","\/font\/titres-1\.woff2","\/relief-\w+\.webp","\/favicon\.svg","\/icons\/flag-192\.[0-9a-f]{10}\.png"\]/);
    const off = await site(new Request(`${O}/hors-ligne`), cache(), () => {}, NOW);
    const html = await off!.text();
    expect(html).toContain("<title>Hors ligne · rundata.re</title>");
    expect(html).toContain(`<meta name="robots" content="noindex">`);
    expect(html).toContain("<h1>Pas de réseau</h1>");
    expect(html).toContain("Pages gardées sur ce téléphone");
    expect(html).toContain("Aucune page gardée pour l'instant : celles que vous ouvrez avec du réseau le seront.");
  });

  it("does not count the offline page the service worker fetches for its shell, only one opened as a page", async () => {
    const hits: Hit[] = [];
    const ask = (dest?: string) => handle(new Request(`${O}/hors-ligne`, { headers: dest ? { "sec-fetch-dest": dest } : {} }), cache(), () => {}, (h) => hits.push(h));
    await ask("empty");
    expect(hits).toEqual([]);
    await ask("document");
    await ask();
    expect(hits.map((h) => [h.kind, h.name])).toEqual([["page", "/hors-ligne"], ["page", "/hors-ligne"]]);
    // Any other page fetched by a script is counted as before.
    await handle(new Request(`${O}/communes`, { headers: { "sec-fetch-dest": "empty" } }), cache(), () => {}, (h) => hits.push(h));
    expect(hits).toHaveLength(3);
  });

  it("keeps no banner of the moment and nothing to send in the offline page, which stays on phones", () => {
    const alert = { niveau: "Alerte 1", eruption: false };
    const html = withVolcan(alert, () => offlinePage(O));
    expect(withVolcan(alert, () => placePage(O, pageOf("cilaos")!, null, NOW))).toContain(`class="alerte volcan"`);
    expect(html).not.toContain(`class="alerte volcan"`);
    expect(html).not.toContain('id="avis"');
    expect(html).not.toContain('id="inst"');
  });

  it("offers the install on every page, hidden until the script knows the phone, and registers the worker", () => {
    const html = placePage(O, pageOf("cilaos")!, null, NOW);
    expect(html).toContain(`<div class="card inst" id="inst" hidden>`);
    expect(html).toContain("rundata.re sur votre écran d'accueil");
    expect(html).toContain(`<span data-inst="android">Pas de store, pas de compte.</span><span data-inst="ios safari">Pas d'App Store, pas de compte.</span>`);
    expect(html).toContain('<li>Touchez Partager <svg class="partage" viewBox="0 0 24 24" aria-hidden="true">');
    expect(html).not.toContain("⎋");
    expect(html).toContain("</svg> (sur les iPhone récents, il est dans le menu « ⋯ »).</li>");
    expect(html).toContain(`navigator.serviceWorker.register("/sw.js")`);
    expect(html).toContain(`localStorage.setItem("inst-plus-tard"`);
    expect(html.indexOf('id="inst"')).toBeLessThan(html.indexOf('id="avis"'));
  });

  it("opens the pages most used away from network on a long press of the icon", () => {
    expect(manifest().shortcuts.map((s) => [s.name, s.url])).toEqual([["Météo", "/meteo?ref=pwa"], ["Vigilance", "/vigilance?ref=pwa"], ["Randonnées", "/randonnees?ref=pwa"]]);
    expect(manifest().name).toBe("rundata.re · La Réunion en direct");
  });

  it("says on the privacy page that the copies and the « Plus tard » stay on the phone", () => {
    const html = legalPage(O, "confidentialite");
    expect(html).toContain("Installation et lecture hors ligne : elles n'utilisent aucun cookie.");
    expect(html).toContain("si la page est ouverte depuis l'application installée sur l'écran d'accueil");
  });

  it("counts a page view in the app in blob11, « app » or nothing", () => {
    const v = { who: "navigateur", country: "RE", from: "", audience: "humain", language: "fr" };
    expect(point({ kind: "page", name: "/meteo", ok: true }, { ...v, mode: "app" }).blobs[10]).toBe("app");
    expect(point({ kind: "page", name: "/meteo", ok: true }, v).blobs[10]).toBe("");
  });
});
