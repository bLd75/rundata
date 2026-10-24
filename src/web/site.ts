/**
 * The web side of the server: the home page, one page per category (weather, vigilance, sea, volcano, buses, air,
 * electricity, calendar), one per commune with all of them (/communes/<commune>), one per commune or place for the
 * weather (/meteo/<lieu>), and what crawlers and link previews ask for
 * (robots.txt, sitemap.xml, the og:image, the favicon). Null for any other path.
 */
import { left } from "../budget.js";
import type { Cache, Cached } from "../cache.js";
import { why } from "../types.js";
import {
  alerte,
  alerteOf,
  BANNER_WAIT_MS,
  buildAir,
  buildBus,
  buildCalendrier,
  buildCommune,
  buildElectricite,
  buildHome,
  buildPlace,
  buildSea,
  buildBornes,
  buildEau,
  buildVelos,
  buildVolcan,
  FRESH_SECONDS,
  snapshot,
  vigilanceNow,
  type Alerte,
  type Background,
} from "./data.js";
import { COMMUNES, communePage, communesPage } from "./commune.js";
import { airPage, bornesPage, busPage, calendrierPage, eauPage, electricitePage, velosPage, volcanPage } from "./domains.js";
import { FAVICON } from "./flag.js";
import { homePage } from "./home.js";
import { RELIEF_PATH, reliefImage } from "./map.js";
import font from "./font.json" with { type: "json" };
import og from "./og.json" with { type: "json" };
import { FONT_PATH, legalPage, meteoPage, notFoundPage, placePage, seaPage, vigilancePage } from "./pages.js";
import { pageOf, PAGES } from "./places.js";

const HTML = {
  "content-type": "text/html; charset=utf-8",
  // Short: the live block changes every few minutes; the data behind it has its own cache.
  "cache-control": "public, max-age=60",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};
const STATIC = "public, max-age=604800";

/** IndexNow (Bing, Yandex, Seznam, Naver): the key that proves rundata.re's submissions are ours. Public by design. */
export const INDEXNOW_KEY = "9cb4a2d427093776313488cb4d39b24a";
// Proves to the official MCP registry that rundata.re publishes re.rundata/*: the public half of the key that signs its publications.
const MCP_REGISTRY_AUTH = "v=MCPv1; k=ed25519; p=FTzDdb5aS1w9JIe6rHUyRBhGknTv/RhlS1oKdNz1+nE=";

/**
 * The fetchers of AI assistants and search engines. A person gets a page without its live block rather than wait
 * more than a few seconds; these read the page once and answer from it, so they wait for the measurements.
 */
const READERS = /ChatGPT-User|OAI-SearchBot|GPTBot|Claude-User|Claude-SearchBot|ClaudeBot|Perplexity|MistralAI|meta-external|facebookexternalhit|Googlebot|Google-Extended|bingbot|Applebot|DuckAssistBot/i;
const READER_WAIT_MS = 25_000;
// The vigilance page waits longer than a banner for Météo-France: it is the page's whole content.
const VIGILANCE_WAIT_MS = 8000;
// The subrequests a visit must have left to bring one of its tiles' copies up to date.
const TILE_MIN_LEFT = 25;

export const isReader = (request: Request) => READERS.test(request.headers.get("user-agent") ?? "");

/** How long to wait for a page's data that this data center has never built, or has an old copy of (web/data.ts). */
const waitFor = (request: Request) => (isReader(request) ? READER_WAIT_MS : undefined);

/** A page without its live block is not kept: the next load should have it. */
const htmlFor = (data: unknown) => (data ? HTML : { ...HTML, "cache-control": "no-store" });

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
let ogBytes: Uint8Array<ArrayBuffer> | undefined;
let fontBytes: Uint8Array<ArrayBuffer> | undefined;
let reliefBytes: Uint8Array<ArrayBuffer> | undefined;

/** The domain pages: built from a tool's answer, kept like the other pages (web/data.ts). */
const DOMAINS: Record<string, { key: string; build: (cache: Cache, now: Date) => Promise<any>; page: (origin: string, data: Cached<any> | null, now: Date, alerte?: Alerte) => string }> = {
  "/meteo": { key: "web:meteo", build: buildHome, page: meteoPage },
  "/volcan": { key: "web:volcan", build: buildVolcan, page: volcanPage },
  "/air": { key: "web:air", build: buildAir, page: airPage },
  "/electricite": { key: "web:electricite", build: buildElectricite, page: electricitePage },
  "/calendrier": { key: "web:calendrier", build: buildCalendrier, page: calendrierPage },
  "/bus": { key: "web:bus", build: (cache, now) => buildBus(now, cache), page: busPage },
  "/velos": { key: "web:velos", build: buildVelos, page: velosPage },
  "/bornes": { key: "web:bornes", build: buildBornes, page: bornesPage },
  "/eau": { key: "web:eau", build: buildEau, page: eauPage },
};

/** How to build each category page's copy, by its cache key: what the home page and the commune pages show as tiles. */
const BUILDS: Record<string, (cache: Cache, now: Date) => Promise<unknown>> = {
  ...Object.fromEntries(Object.values(DOMAINS).map((d) => [d.key, d.build])),
  "web:mer": buildSea,
};
// The home page's tiles besides the weather and the vigilance; a commune page's besides its own.
const HOME_TILES = ["web:volcan", "web:air", "web:electricite", "web:calendrier", "web:bus", "web:velos", "web:bornes", "web:eau"];
const COMMUNE_TILES = ["web:air", "web:mer", "web:volcan", "web:electricite", "web:calendrier"];

/**
 * The last copy of each of these pages, without building them: building them all would not fit in one invocation.
 * Once the page's own data is fresh, the oldest copy (or one never built) is brought up to date afterwards.
 */
async function tileCopies(cache: Cache, keys: string[], background: Background, own: Cached<unknown> | null, now: Date): Promise<(Cached<any> | null)[]> {
  const copies = await Promise.all(keys.map((k) => cache.peek<any>(k)));
  const age = (c: Cached<unknown> | null | undefined) => (c ? now.getTime() - c.fetchedAt.getTime() : Infinity);
  const due = keys.map((key, i) => ({ key, age: age(copies[i]) })).sort((a, b) => b.age - a.age)[0];
  if (own && age(own) < FRESH_SECONDS * 1000 && due.age >= FRESH_SECONDS * 1000 && left() >= TILE_MIN_LEFT) {
    background(cache.get(due.key, FRESH_SECONDS, () => BUILDS[due.key](cache, now)).catch((err) => console.error(`page ${due.key} : rafraîchissement impossible`, why(err))));
  }
  return copies.map((c) => c ?? null);
}

function sitemap(origin: string): string {
  const urls = ["/", ...Object.keys(DOMAINS), "/vigilance", "/mer", "/communes", ...COMMUNES.map((p) => `/communes/${p.slug}`), ...PAGES.map((p) => `/meteo/${p.slug}`), "/confidentialite", "/conditions"];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `<url><loc>${origin}${u}</loc><changefreq>hourly</changefreq></url>`).join("\n") +
    `\n</urlset>\n`;
}

export async function site(request: Request, cache: Cache, background: Background, now = new Date()): Promise<Response | null> {
  const url = new URL(request.url);
  const origin = url.origin;
  const path = url.pathname;

  if (path === "/") {
    const [meteo, vigilance] = await Promise.all([
      snapshot(cache, DOMAINS["/meteo"].key, () => buildHome(cache, now), background, now, waitFor(request), isReader(request)),
      vigilanceNow(cache, background, waitFor(request) ?? BANNER_WAIT_MS),
    ]);
    const [volcan, air, electricite, calendrier, bus, velos, bornes, eau] = await tileCopies(cache, HOME_TILES, background, meteo, now);
    const a = vigilance ? alerteOf(vigilance.value, now) : undefined;
    return new Response(homePage(origin, { meteo, vigilance, volcan, air, electricite, calendrier, bus, velos, bornes, eau }, now, a), { headers: htmlFor(meteo) });
  }
  if (path === "/vigilance" || path === "/vigilance/") {
    const data = await vigilanceNow(cache, background, waitFor(request) ?? VIGILANCE_WAIT_MS);
    const a = data ? alerteOf(data.value, now) : undefined;
    return new Response(vigilancePage(origin, data, now, a), { headers: htmlFor(data) });
  }
  if (path === "/mer" || path === "/mer/") {
    const [data, a] = await Promise.all([
      snapshot(cache, "web:mer", () => buildSea(cache, now), background, now, waitFor(request), isReader(request)),
      alerte(cache, background, now),
    ]);
    return new Response(seaPage(origin, data, now, a), { headers: htmlFor(data) });
  }
  const domain = DOMAINS[path.replace(/(.)\/$/, "$1")];
  if (domain) {
    const [data, a] = await Promise.all([
      snapshot(cache, domain.key, () => domain.build(cache, now), background, now, waitFor(request), isReader(request)),
      alerte(cache, background, now),
    ]);
    return new Response(domain.page(origin, data, now, a), { headers: htmlFor(data) });
  }
  if (path === "/confidentialite" || path === "/conditions") {
    return new Response(legalPage(origin, path.slice(1) as "confidentialite" | "conditions"), { headers: { ...HTML, "cache-control": "public, max-age=3600" } });
  }
  if (path.startsWith("/meteo/")) {
    const slug = path.slice("/meteo/".length).replace(/\/$/, "");
    const p = pageOf(slug);
    if (!p) return new Response(notFoundPage(origin, path), { status: 404, headers: HTML });
    const [data, a] = await Promise.all([
      snapshot(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now), background, now, waitFor(request), isReader(request)),
      alerte(cache, background, now),
    ]);
    return new Response(placePage(origin, p, data, now, a), { headers: htmlFor(data) });
  }
  if (path === "/communes" || path === "/communes/") {
    return new Response(communesPage(origin, await alerte(cache, background, now)), { headers: HTML });
  }
  if (path.startsWith("/communes/")) {
    const p = pageOf(path.slice("/communes/".length).replace(/\/$/, ""));
    if (!p?.commune) return new Response(notFoundPage(origin, path), { status: 404, headers: HTML });
    const [place, commune, vigilance] = await Promise.all([
      snapshot(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now), background, now, waitFor(request), isReader(request)),
      snapshot(cache, `web:commune:${p.slug}`, () => buildCommune(cache, p, now), background, now, waitFor(request), isReader(request)),
      vigilanceNow(cache, background, waitFor(request) ?? BANNER_WAIT_MS),
    ]);
    const [air, mer, volcan, electricite, calendrier] = await tileCopies(cache, COMMUNE_TILES, background, place, now);
    const a = vigilance ? alerteOf(vigilance.value, now) : undefined;
    return new Response(communePage(origin, p, { place, commune, vigilance, air, mer, volcan, electricite, calendrier }, now, a), { headers: htmlFor(place) });
  }
  if (path === `/${INDEXNOW_KEY}.txt`) {
    return new Response(INDEXNOW_KEY, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": STATIC } });
  }
  if (path === "/.well-known/mcp-registry-auth") {
    return new Response(MCP_REGISTRY_AUTH, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": STATIC } });
  }
  if (path === "/robots.txt") {
    return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
    });
  }
  if (path === "/sitemap.xml") {
    return new Response(sitemap(origin), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=86400" } });
  }
  if (path === "/og.png") {
    return new Response((ogBytes ??= bytes(og.png)), { headers: { "content-type": "image/png", "cache-control": STATIC } });
  }
  if (path === RELIEF_PATH) {
    return new Response((reliefBytes ??= bytes(reliefImage())), {
      headers: { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" },
    });
  }
  if (path === FONT_PATH) {
    // Its address changes with its content (see pages.ts), so browsers may keep it for good.
    return new Response((fontBytes ??= bytes(font.woff2)), {
      headers: { "content-type": "font/woff2", "cache-control": "public, max-age=31536000, immutable" },
    });
  }
  if (path === "/favicon.svg" || path === "/favicon.ico") {
    return new Response(FAVICON, { headers: { "content-type": "image/svg+xml", "cache-control": STATIC } });
  }
  return null;
}

/** Any other address a browser asks for: a page that leads back to the communes. */
export function notFound(request: Request): Response {
  return new Response(notFoundPage(new URL(request.url).origin, new URL(request.url).pathname), { status: 404, headers: HTML });
}
