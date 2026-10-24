/**
 * The web side of the server: the home page, one page per category (weather, vigilance, sea, volcano, buses, air,
 * electricity, calendar), one per commune with all of them (/communes/<commune>), one per commune or place for the
 * weather (/meteo/<lieu>), and what crawlers and link previews ask for
 * (robots.txt, sitemap.xml, the og:image, the favicon). Null for any other path.
 */
import { costOf, left, measured } from "../budget.js";
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
  buildSentiers,
  buildTrafic,
  roadNewsNow,
  withRoadNews,
  buildRandonnees,
  buildSecheresse,
  buildCoupures,
  buildSport,
  buildAgenda,
  buildActualites,
  buildRoute,
  buildTrail,
  routeGpx,
  trailGpx,
  buildCyclones,
  buildHistorique,
  buildDae,
  buildVelos,
  buildVolcan,
  FRESH_SECONDS,
  snapshot,
  vigilanceNow,
  type Alerte,
  type Background,
  type PlaceData,
  type RandonneesAnswer,
} from "./data.js";
import { COMMUNES, communePage, communesPage } from "./commune.js";
import { actualitesPage, agendaPage, airPage, bornesPage, busPage, calendrierPage, coupuresPage, cyclonesPage, daePage, eauPage, electricitePage, historiquePage, randonneesPage, secheressePage, sentiersPage, sportPage, tracePage, traficPage, velosPage, volcanPage } from "./domains.js";
import { concertsPage, weekendPage } from "./evenements.js";
import { coupuresCommunePage } from "./coupures.js";
import { hikesNear } from "./liens.js";
import { FAVICON } from "./flag.js";
import { homePage } from "./home.js";
import { RELIEF_PATH, reliefImage } from "./map.js";
import font from "./font.json" with { type: "json" };
import icons from "./icons.json" with { type: "json" };
import og from "./og.json" with { type: "json" };
import { NOUVEAUTES } from "../nouveautes.js";
import { nouveautesPage } from "./nouveautes.js";
import { carburantsPage } from "./carburants.js";
import * as carburants from "../providers/carburants.js";
import { aujourdhuiPage } from "./aujourdhui.js";
import { communeRss } from "./rss.js";
import { readCopies, resume } from "../tools/resume.js";
import { FONT_PATH, legalPage, meteoPage, notFoundPage, placePage, seaPage, vigilancePage } from "./pages.js";
import { pageOf, PAGES } from "./places.js";
import { pressePage, pressFigures } from "./presse.js";
import { avisPost } from "./avis.js";
import * as dae from "../providers/dae.js";
import * as traces from "../providers/traces.js";
import { SECTEURS, secteurOf } from "../traces/secteurs.js";
import { secteurPage } from "./randonnees.js";

const HTML = {
  "content-type": "text/html; charset=utf-8",
  // Short: the live block changes every few minutes; the data behind it has its own cache.
  "cache-control": "public, max-age=60",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};
const STATIC = "public, max-age=604800";
// A trace downloads as a file; the ONF's state in it is an hour old at most.
// A feed reader comes back every few minutes at most; the copies behind it change every few minutes too.
const RSS = { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };
const GPX = { "content-type": "application/gpx+xml; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };

/**
 * The search engines skip the addresses with `?maj=` (pages/ask): copies of a page made for the assistants, which
 * would spend the few pages a day a search engine reads on a new site. The assistants' fetchers still read them.
 */
const ROBOTS = (origin: string) =>
  `User-agent: Googlebot\nUser-agent: GoogleOther\nUser-agent: Bingbot\nDisallow: /*?maj=\nAllow: /\n\nUser-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;

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
// The subrequests a tile's build is assumed to take before it has been measured in this isolate (budget.ts).
const TILE_COST_UNKNOWN = 25;

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
  "/trafic": { key: "web:trafic", build: buildTrafic, page: traficPage },
  "/velos": { key: "web:velos", build: buildVelos, page: velosPage },
  "/bornes": { key: "web:bornes", build: buildBornes, page: bornesPage },
  "/eau": { key: "web:eau", build: buildEau, page: eauPage },
  "/randonnees": { key: "web:randonnees", build: buildRandonnees, page: randonneesPage },
  "/sentiers": { key: "web:sentiers", build: buildSentiers, page: sentiersPage },
  "/secheresse": { key: "web:secheresse", build: buildSecheresse, page: secheressePage },
  "/coupures-eau": { key: "web:coupures", build: buildCoupures, page: coupuresPage },
  "/defibrillateurs": { key: "web:dae", build: buildDae, page: daePage },
  "/sport": { key: "web:sport", build: buildSport, page: sportPage },
  "/cyclones": { key: "web:cyclones", build: buildCyclones, page: cyclonesPage },
  "/historique": { key: "web:historique", build: buildHistorique, page: historiquePage },
  "/evenements": { key: "web:agenda", build: buildAgenda, page: agendaPage },
  // Parts of the events page's copy, with their own title for what people search.
  "/evenements/ce-week-end": { key: "web:agenda", build: buildAgenda, page: weekendPage },
  "/evenements/concerts": { key: "web:agenda", build: buildAgenda, page: concertsPage },
  "/actualites": { key: "web:actualites", build: buildActualites, page: actualitesPage },
};

/** How to build each category page's copy, by its cache key: what the home page and the commune pages show as tiles. */
const BUILDS: Record<string, (cache: Cache, now: Date) => Promise<unknown>> = {
  ...Object.fromEntries(Object.values(DOMAINS).map((d) => [d.key, d.build])),
  "web:mer": buildSea,
};
// The home page's tiles besides the weather and the vigilance; a commune page's besides its own.
// The news first: on a day of mobilisation its headlines go above the tiles.
const HOME_TILES = ["web:actualites", "web:volcan", "web:air", "web:electricite", "web:calendrier", "web:bus", "web:trafic", "web:velos", "web:bornes", "web:eau", "web:sentiers", "web:secheresse", "web:coupures", "web:sport", "web:cyclones", "web:historique", "web:agenda"];
// A commune's feed: the copies besides the vigilance (web/rss.ts).
const RSS_TILES = ["web:coupures", "web:randonnees", "web:volcan"];
const COMMUNE_TILES = ["web:air", "web:mer", "web:volcan", "web:electricite", "web:calendrier", "web:coupures", "web:secheresse", "web:eau", "web:randonnees", "web:agenda"];

/**
 * The last copy of each of these pages, without building them: building them all would not fit in one invocation.
 * Once the page's own data is fresh, the oldest copy (or one never built) is brought up to date afterwards. `own`
 * undefined: a page without data of its own (a feed), which never holds up a refresh.
 */
async function tileCopies(cache: Cache, keys: string[], background: Background, own: Cached<unknown> | null | undefined, now: Date): Promise<(Cached<any> | null)[]> {
  // One read each, as long as the invocation has subrequests left: a tile past them waits for the next view.
  const budget = left();
  const copies = await Promise.all(keys.map((k, i) => (i < budget ? cache.peek<any>(k) : Promise.resolve(undefined))));
  const age = (c: Cached<unknown> | null | undefined) => (c ? now.getTime() - c.fetchedAt.getTime() : Infinity);
  const due = keys.map((key, i) => ({ key, age: age(copies[i]) })).sort((a, b) => b.age - a.age)[0];
  // Only when what the tile's build took last time is left: otherwise its page or a later visit brings it up to date.
  if ((own === undefined || (own && age(own) < FRESH_SECONDS * 1000)) && due.age >= FRESH_SECONDS * 1000 && left() >= (costOf(due.key) ?? TILE_COST_UNKNOWN)) {
    background(cache.get(due.key, FRESH_SECONDS, () => measured(due.key, () => BUILDS[due.key](cache, now))).catch((err) => console.error(`page ${due.key} : rafraîchissement impossible`, why(err))));
  }
  return copies.map((c) => c ?? null);
}

// The day the list of communes, the press page and the legal pages last changed: their <lastmod>.
const STATIC_CHANGED = "2026-10-24";

const localDay = (d: string | Date) => new Date(new Date(d).getTime() + 4 * 3600_000).toISOString().slice(0, 10);

/**
 * Every page with its <lastmod>: today (Réunion time) for the live ones, the day the traces were built for the
 * hikes and trails (their ONF state aside), the day of the latest change for /nouveautes, and STATIC_CHANGED for the
 * pages without live data.
 */
function sitemap(origin: string, now: Date, fuelDay?: string): string {
  const today = localDay(now);
  const live = (u: string) => [u, today, "hourly"];
  const fixed = (u: string) => [u, STATIC_CHANGED, "monthly"];
  const trace = (u: string) => [u, traces.BUILT, "daily"];
  // The defibrillators are a list bundled with the server: their page changes when it is rebuilt.
  const urls = [...["/", ...Object.keys(DOMAINS).filter((u) => u !== "/defibrillateurs"), "/vigilance", "/mer"].map(live), ["/defibrillateurs", dae.BUILT, "monthly"], fixed("/communes"), ...COMMUNES.map((p) => live(`/communes/${p.slug}`)), ...COMMUNES.map((p) => live(`/coupures-eau/${p.slug}`)), ...COMMUNES.map((p) => live(`/aujourdhui/${p.slug}`)),
    ...PAGES.map((p) => live(`/meteo/${p.slug}`)), ...SECTEURS.map((x) => live(`/randonnees/${x.slug}`)), ...traces.RANDONNEES.map((r) => trace(`/randonnees/${r.slug}`)),
    ...Object.values(traces.SENTIERS).map((t) => trace(`/sentiers/${t.slug}`)), ...["/presse", "/confidentialite", "/conditions"].map(fixed),
    ["/nouveautes", localDay(NOUVEAUTES[0].date), "daily"], ["/carburants", fuelDay ?? today, "daily"]];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(([u, day, freq]) => `<url><loc>${origin}${u}</loc><lastmod>${day}</lastmod><changefreq>${freq}</changefreq></url>`).join("\n") +
    `\n</urlset>\n`;
}

export async function site(request: Request, cache: Cache, background: Background, now = new Date()): Promise<Response | null> {
  const url = new URL(request.url);
  const origin = url.origin;
  const path = url.pathname;

  // The feedback form at the bottom of every page (web/avis.ts).
  if (path === "/avis") return avisPost(request, now);
  if (path === "/") {
    const [meteo, vigilance] = await Promise.all([
      snapshot(cache, DOMAINS["/meteo"].key, () => buildHome(cache, now), background, now, waitFor(request), isReader(request)),
      vigilanceNow(cache, background, waitFor(request) ?? BANNER_WAIT_MS),
    ]);
    const [actualites, volcan, air, electricite, calendrier, bus, trafic, velos, bornes, eau, sentiers, secheresse, coupures, sport, cyclones, historique, agenda] = await tileCopies(cache, HOME_TILES, background, meteo, now);
    const a = vigilance ? alerteOf(vigilance.value, now) : undefined;
    return new Response(homePage(origin, { meteo, vigilance, volcan, air, electricite, calendrier, bus, trafic, velos, bornes, eau, sentiers, secheresse, coupures, sport, cyclones, historique, agenda, actualites }, now, a), { headers: htmlFor(meteo) });
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
  // The traffic page's copy lasts minutes; the media's headlines on the roads are those of the view.
  if (path === "/trafic" || path === "/trafic/") {
    const [data, a, news] = await Promise.all([
      snapshot(cache, "web:trafic", () => buildTrafic(cache, now), background, now, waitFor(request), isReader(request)),
      alerte(cache, background, now),
      roadNewsNow(cache, background, now),
    ]);
    return new Response(traficPage(origin, data && { ...data, value: withRoadNews(data.value, news, now) }, now, a), { headers: htmlFor(data) });
  }
  // A commune's water: the copy of /coupures-eau, and the last ones of /secheresse and /eau as they are.
  const water = /^\/coupures-eau\/([a-z-]+)\/?$/.exec(path);
  if (water) {
    const p = pageOf(water[1]);
    if (!p?.commune) return new Response(notFoundPage(origin, path), { status: 404, headers: HTML });
    const [coupures, a] = await Promise.all([
      snapshot(cache, "web:coupures", () => buildCoupures(cache, now), background, now, waitFor(request), isReader(request)),
      alerte(cache, background, now),
    ]);
    const [secheresse, eau] = await tileCopies(cache, ["web:secheresse", "web:eau"], background, coupures, now);
    return new Response(coupuresCommunePage(origin, p, { coupures, secheresse, eau }, now, a), { headers: htmlFor(coupures) });
  }
  // The events page was first published as /agenda.
  if (path === "/agenda" || path === "/agenda/") return Response.redirect(`${origin}/evenements`, 301);
  const domain = DOMAINS[path.replace(/(.)\/$/, "$1")];
  if (domain) {
    const [data, a] = await Promise.all([
      snapshot(cache, domain.key, () => domain.build(cache, now), background, now, waitFor(request), isReader(request)),
      alerte(cache, background, now),
    ]);
    return new Response(domain.page(origin, data, now, a), { headers: htmlFor(data) });
  }
  const sector = /^\/randonnees\/([a-z-]+)\/?$/.exec(path);
  const s = sector ? secteurOf(sector[1]) : undefined;
  if (s) {
    // The hikers' page's copy, and the weather page's as it is: a sector's page builds nothing of its own.
    const [data, a, meteo] = await Promise.all([
      snapshot(cache, DOMAINS["/randonnees"].key, () => buildRandonnees(cache), background, now, waitFor(request), isReader(request)),
      alerte(cache, background, now),
      s.meteo ? cache.peek<PlaceData>(`web:lieu:${s.meteo}`).catch(() => undefined) : undefined,
    ]);
    return new Response(secteurPage(origin, s, data, meteo ?? null, now, a), { headers: htmlFor(data) });
  }
  const trace = /^\/(sentiers|randonnees)\/([a-z0-9-]+)(\.gpx)?\/?$/.exec(path);
  if (trace) {
    const [, dir, slug, file] = trace;
    const t = dir === "sentiers" ? traces.sentier(slug) : undefined;
    const r = dir === "randonnees" ? traces.randonnee(slug) : undefined;
    if (!t && !r) return new Response(notFoundPage(origin, path), { status: 404, headers: HTML });
    if (file) {
      try {
        const body = t ? await trailGpx(cache, origin, t, now) : await routeGpx(cache, origin, r!, now);
        return new Response(body, { headers: { ...GPX, "content-disposition": `attachment; filename="${slug}.gpx"` } });
      } catch {
        return new Response("Trace indisponible pour le moment : la carte de l'ONF ne répond pas. Réessayer dans quelques minutes.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": "300" } });
      }
    }
    const [data, a] = await Promise.all([
      snapshot(cache, `web:${dir}:${slug}`, () => (t ? buildTrail(cache, t) : buildRoute(cache, r!)), background, now, waitFor(request), isReader(request)),
      alerte(cache, background, now),
    ]);
    return new Response(tracePage(origin, t ? "sentier" : "randonnee", slug, t?.nom ?? r!.nom, data, now, a), { headers: htmlFor(data) });
  }
  if (path === "/presse" || path === "/presse/") {
    // Its live counts are read from copies already here: a few minutes in browsers is enough.
    return new Response(pressePage(origin, await pressFigures(cache)), { headers: { ...HTML, "cache-control": "public, max-age=300" } });
  }
  if (path === "/carburants" || path === "/carburants/") {
    const [data, a] = await Promise.all([carburants.prix(cache, now).catch(() => null), alerte(cache, background, now)]);
    return new Response(carburantsPage(origin, data, now, a), { headers: htmlFor(data) });
  }
  if (path === "/nouveautes" || path === "/nouveautes/") {
    return new Response(nouveautesPage(origin), { headers: { ...HTML, "cache-control": "public, max-age=3600" } });
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
    // The state of the hikes around: the hikers' page's last copy, as it is, never built for this page.
    const hikes = hikesNear(p.place.lon, p.place.lat).length ? await cache.peek<RandonneesAnswer>("web:randonnees").catch(() => undefined) : undefined;
    return new Response(placePage(origin, p, data, now, a, hikes ?? null), { headers: htmlFor(data) });
  }
  if (path === "/communes" || path === "/communes/") {
    return new Response(communesPage(origin, await alerte(cache, background, now)), { headers: HTML });
  }
  if (path.startsWith("/aujourdhui/")) {
    const p = pageOf(path.slice("/aujourdhui/".length).replace(/\/$/, ""));
    if (!p?.commune) return new Response(notFoundPage(origin, path), { status: 404, headers: HTML });
    // The weather is built when it has no copy, as on the commune's page; the rest only read (tools/resume.ts).
    const vigilance = vigilanceNow(cache, background, waitFor(request) ?? BANNER_WAIT_MS);
    const place = await snapshot(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now), background, now, waitFor(request), isReader(request));
    // The weather's copy as the snapshot gave it: not read again (the read could be one subrequest too many).
    const { copies, leftOut } = await readCopies(cache, p, p, now, background, vigilance, { meteo: place });
    const a = copies.vigilance ? alerteOf(copies.vigilance.value, now) : undefined;
    return new Response(aujourdhuiPage(origin, p, resume(p, copies, now, leftOut), copies.meteo ?? place, a), { headers: htmlFor(place) });
  }
  // A commune's alerts as RSS: the copies of the pages, never a build of its own (web/rss.ts).
  const feed = /^\/communes\/([a-z-]+)\.rss$/.exec(path);
  if (feed) {
    const p = pageOf(feed[1]);
    if (!p?.commune) return new Response("Flux inconnu : voir https://rundata.re/communes", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    const [vigilance, [coupures, randonnees, volcan]] = await Promise.all([
      vigilanceNow(cache, background, BANNER_WAIT_MS),
      tileCopies(cache, RSS_TILES, background, undefined, now),
    ]);
    // Without one of its copies, the feed says less than it should: kept a minute only.
    const whole = vigilance && coupures && randonnees && volcan;
    return new Response(communeRss(origin, p, { vigilance, coupures, randonnees, volcan }, now), { headers: whole ? RSS : { ...RSS, "cache-control": "public, max-age=60" } });
  }
  if (path.startsWith("/communes/")) {
    const p = pageOf(path.slice("/communes/".length).replace(/\/$/, ""));
    if (!p?.commune) return new Response(notFoundPage(origin, path), { status: 404, headers: HTML });
    const [place, commune, vigilance] = await Promise.all([
      snapshot(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now), background, now, waitFor(request), isReader(request)),
      snapshot(cache, `web:commune:${p.slug}`, () => buildCommune(cache, p, now), background, now, waitFor(request), isReader(request)),
      vigilanceNow(cache, background, waitFor(request) ?? BANNER_WAIT_MS),
    ]);
    const [air, mer, volcan, electricite, calendrier, coupures, secheresse, eau, randonnees, agenda] = await tileCopies(cache, COMMUNE_TILES, background, place, now);
    const a = vigilance ? alerteOf(vigilance.value, now) : undefined;
    return new Response(communePage(origin, p, { place, commune, vigilance, air, mer, volcan, electricite, calendrier, coupures, secheresse, eau, randonnees, agenda }, now, a), { headers: htmlFor(place) });
  }
  if (path === `/${INDEXNOW_KEY}.txt`) {
    return new Response(INDEXNOW_KEY, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": STATIC } });
  }
  if (path === "/.well-known/mcp-registry-auth") {
    return new Response(MCP_REGISTRY_AUTH, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": STATIC } });
  }
  if (path === "/robots.txt") {
    return new Response(ROBOTS(origin), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
    });
  }
  if (path === "/sitemap.xml") {
    // The fuel page changes with the prefect's order: its date, from the stored copy when there is one.
    const fuel = await cache.peek<carburants.Prix>("carburants:prix").catch(() => undefined);
    return new Response(sitemap(origin, now, fuel?.value.depuis), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=86400" } });
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
  if (path === "/manifest.webmanifest") {
    return new Response(JSON.stringify(manifest()), { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=86400" } });
  }
  if (path === "/favicon.svg" || path === "/favicon.ico") {
    return new Response(FAVICON, { headers: { "content-type": "image/svg+xml", "cache-control": STATIC } });
  }
  return null;
}

/**
 * What a phone needs to keep the site on its home screen, like an app: its name, its icons (scripts/build-icons.py)
 * and where it opens, `?ref=pwa` so that the visits from the icon are counted apart (src/metrics.ts).
 */
export function manifest() {
  return {
    name: "rundata.re",
    short_name: "rundata.re",
    description: "La Réunion en direct : météo mesurée, vigilance, mer, routes, bus, randonnée, sorties.",
    lang: "fr",
    start_url: "/?ref=pwa",
    scope: "/",
    display: "standalone",
    background_color: "#0b1f36",
    theme_color: "#0b1f36",
    icons: [
      { src: icons["192"], sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: icons["512"], sizes: "512x512", type: "image/png", purpose: "any maskable" },
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}

/** Any other address a browser asks for: a page that leads back to the communes. */
export function notFound(request: Request): Response {
  return new Response(notFoundPage(new URL(request.url).origin, new URL(request.url).pathname), { status: 404, headers: HTML });
}
