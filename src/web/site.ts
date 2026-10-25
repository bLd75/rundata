/**
 * The web side of the server: the home page, one page per category (weather, vigilance, sea, volcano, buses, air,
 * electricity, calendar), one per commune with all of them (/communes/<commune>), one per commune or place for the
 * weather (/meteo/<lieu>), and what crawlers and link previews ask for
 * (robots.txt, sitemap.xml, the og:image, the favicon). Null for any other path.
 */
import { alerteVolcan, volcanNow, withVolcan } from "./volcan-alerte.js";
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
  buildDechets,
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
  cycloneDecisionNow,
  withoutForecast,
  type ActualitesAnswer,
  type Alerte,
  type Background,
  type PlaceData,
  type RandonneesAnswer,
  type VolcanAnswer,
} from "./data.js";
import { COMMUNES, communePage, communesPage } from "./commune.js";
import { actualitesPage, agendaPage, airPage, bornesPage, busPage, calendrierPage, coupuresPage, cyclonesPage, daePage, eauPage, electricitePage, historiquePage, randonneesPage, secheressePage, sentiersPage, sportPage, tracePage, traficPage, velosPage, volcanPage } from "./domains.js";
import { concertsPage, weekendPage } from "./evenements.js";
import { coupuresCommunePage } from "./coupures.js";
import { cloudSeaTold, hikesNear, summitOf } from "./liens.js";
import { LOGO_PETIT_SVG } from "./logo.js";
import { homePage } from "./home.js";
import { RELIEF_PATH, reliefImage } from "./map.js";
import font from "./font.json" with { type: "json" };
import icons from "./icons.json" with { type: "json" };
import og from "./og.json" with { type: "json" };
import { NOUVEAUTES } from "../nouveautes.js";
import { nouveautesPage } from "./nouveautes.js";
import { bathingPage, PATH as BAIGNADE } from "./baignade.js";
import { carburantsPage } from "./carburants.js";
import { collectePage, communeOf } from "./collecte.js";
import { decheteriesPage } from "./decheteries.js";
import { alertePage } from "./alerte-cyclone.js";
import { kitPage } from "./kit-cyclone.js";
import { MODELE_CSV, publierPage } from "./publier.js";
import { passePage } from "./cyclones-passes.js";
import { PASSES } from "../historique/cyclones-passes.js";
import { ecolesPage } from "./ecoles.js";
import { COMMUNES as COLLECTE_COMMUNES, communeSlug } from "../vie/collecte.js";
import { TCO_COMMUNES } from "../vie/decheteries.js";
import * as carburants from "../providers/carburants.js";
import { aujourdhuiPage } from "./aujourdhui.js";
import { communeRss } from "./rss.js";
import { FEUX_PATH, feuxPage } from "./feux.js";
import * as feux from "../providers/feux.js";
import { readCopies, resume } from "../tools/resume.js";
import { FONT_PATH, legalPage, meteoPage, notFoundPage, offlinePage, placePage, seaPage, vigilancePage } from "./pages.js";
import { OFFLINE_PATH, serviceWorker, SW_PATH } from "./pwa.js";
import { pageOf, PAGES } from "./places.js";
import { pressePage, pressFigures } from "./presse.js";
import { avisPost } from "./avis.js";
import * as dae from "../providers/dae.js";
import * as traces from "../providers/traces.js";
import { SECTEURS, secteurOf } from "../traces/secteurs.js";
import { secteurPage } from "./randonnees.js";
import { typo, typoPage } from "./typo.js";

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
// rundata-check: the daily check of the sources (bin/check-sources.ts), which must see the data, not the cache.
const READERS = /rundata-check\/|ChatGPT-User|OAI-SearchBot|GPTBot|Claude-User|Claude-SearchBot|ClaudeBot|Perplexity|MistralAI|meta-external|facebookexternalhit|Googlebot|Google-Extended|bingbot|Applebot|DuckAssistBot/i;
const READER_WAIT_MS = 25_000;
// The vigilance page waits longer than a banner for Météo-France: it is the page's whole content.
const VIGILANCE_WAIT_MS = 8000;
// The subrequests a tile's build is assumed to take when it was measured neither in this isolate nor with its copy.
const TILE_COST_UNKNOWN = 25;

export const isReader = (request: Request) => READERS.test(request.headers.get("user-agent") ?? "");

/** How long to wait for a page's data that this data center has never built, or has an old copy of (web/data.ts). */
const waitFor = (request: Request) => (isReader(request) ? READER_WAIT_MS : undefined);

/** A page without its live block is not kept: the next load should have it. */
const htmlFor = (data: unknown) => (data ? HTML : { ...HTML, "cache-control": "no-store" });

/**
 * A page from its copies, `render(true)`. A copy the code can no longer read (CACHE_FORMAT not raised, cache.ts) makes
 * the render throw: the page is then rendered without its live block, `render(false)`, never kept, and its own copies
 * are built again after the response (`again`), so that the next view has them.
 */
function page(path: string, render: (live: boolean) => string, data: unknown, background: Background, again: (() => Promise<unknown>)[] = []): Response {
  try {
    return new Response(render(true), { headers: htmlFor(data) });
  } catch (err) {
    console.error(`page ${path} : rendu impossible avec ses copies, rendue sans elles`, why(err));
    for (const build of again) background(build().catch((e) => console.error(`page ${path} : reconstruction impossible`, why(e))));
    return new Response(render(false), { headers: htmlFor(null) });
  }
}

/** Whether the volcano's copy says it is in alert; a copy that cannot be read is left to `page` to rebuild. */
const inAlert = (v: VolcanAnswer) => {
  try {
    return alerteVolcan(v);
  } catch {
    return false;
  }
};

/** The copy under `key` built again, whatever its age: the one there broke a page. */
const rebuild = (cache: Cache, key: string, build: () => Promise<unknown>) => () => cache.get(key, 0, () => measured(key, build));

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
let ogBytes: Uint8Array<ArrayBuffer> | undefined;
let icoBytes: Uint8Array<ArrayBuffer> | undefined;
let fontBytes: Uint8Array<ArrayBuffer> | undefined;
let swText: string | undefined;
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
  "/decheteries": { key: "web:dechets", build: (cache) => buildDechets(cache), page: decheteriesPage },
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
  const copies = await Promise.all(keys.map((k, i) => (i < budget ? cache.peek<any>(k, now.getTime() - FRESH_SECONDS * 1000) : Promise.resolve(undefined))));
  const age = (c: Cached<unknown> | null | undefined) => (c ? now.getTime() - c.fetchedAt.getTime() : Infinity);
  const due = keys.map((key, i) => ({ key, age: age(copies[i]), cost: copies[i]?.cost })).sort((a, b) => b.age - a.age)[0];
  // Only when what the tile's build took last time (here, or where its copy was built) is left: otherwise its page or
  // a later visit brings it up to date.
  if ((own === undefined || (own && age(own) < FRESH_SECONDS * 1000)) && due.age >= FRESH_SECONDS * 1000 && left() >= (costOf(due.key) ?? due.cost ?? TILE_COST_UNKNOWN)) {
    background(cache.get(due.key, FRESH_SECONDS, () => measured(due.key, () => BUILDS[due.key](cache, now))).catch((err) => console.error(`page ${due.key} : rafraîchissement impossible`, why(err))));
  }
  return copies.map((c) => c ?? null);
}

/** A page of the sitemap: its path, the day its content last changed when known, how often it changes. */
type Url = [string, string | undefined, string];

const localDay = (d: string | Date) => new Date(new Date(d).getTime() + 4 * 3600_000).toISOString().slice(0, 10);

/**
 * Every page, with a <lastmod> only where the day its content last changed is known: the latest entry of /nouveautes,
 * the day the defibrillators' list was rebuilt, the day of the fuel prices. Search engines use it only when it is
 * always exact; « today » on a live page, or the day the traces were built for a trail whose state changed since,
 * would not be.
 */
function sitemap(origin: string, now: Date, fuelDay?: string): string {
  const today = localDay(now);
  const live = (u: string): Url => [u, undefined, "hourly"];
  const fixed = (u: string): Url => [u, undefined, "monthly"];
  const trace = (u: string): Url => [u, undefined, "daily"];
  // The defibrillators are a list bundled with the server: their page changes when it is rebuilt.
  const urls: Url[] = [...["/", ...Object.keys(DOMAINS).filter((u) => u !== "/defibrillateurs"), "/vigilance", "/ecoles-cyclone", "/alerte-cyclone", "/mer", "/collecte", ...COLLECTE_COMMUNES.map((c) => `/collecte/${communeSlug(c)}`)].map(live), ["/defibrillateurs", dae.BUILT, "monthly"], fixed("/communes"), fixed("/kit-cyclone"), fixed("/publier"), ...COMMUNES.map((p) => live(`/communes/${p.slug}`)), ...COMMUNES.map((p) => live(`/coupures-eau/${p.slug}`)), ...COMMUNES.map((p) => live(`/aujourdhui/${p.slug}`)),
    ...PAGES.map((p) => live(`/meteo/${p.slug}`)), ...SECTEURS.map((x) => live(`/randonnees/${x.slug}`)), ...traces.RANDONNEES.map((r) => trace(`/randonnees/${r.slug}`)),
    ...Object.values(traces.SENTIERS).map((t) => trace(`/sentiers/${t.slug}`)), ...["/presse", "/confidentialite", "/conditions", BAIGNADE, ...PASSES.map((c) => `/cyclones/${c.slug}`)].map(fixed),
    ["/nouveautes", localDay(NOUVEAUTES[0].date), "daily"], ["/carburants", fuelDay ? (fuelDay < today ? fuelDay : today) : undefined, "daily"],
    // The fires' page only once FIRMS's key is there: before, it says the detection is not active.
    ...(feux.enabled() ? [live(FEUX_PATH)] : [])];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(([u, day, freq]) => `<url><loc>${origin}${u}</loc>${day ? `<lastmod>${day}</lastmod>` : ""}<changefreq>${freq}</changefreq></url>`).join("\n") +
    `\n</urlset>\n`;
}

/** The site's pages, each with the volcano's banner while the volcano is in alert (web/volcan-alerte.ts), in French typography (web/typo.ts). */
export async function site(request: Request, cache: Cache, background: Background, now = new Date()): Promise<Response | null> {
  const volcan = await volcanNow(cache, now);
  return typoPage(await withVolcan(volcan, () => pages(request, cache, background, now)));
}

async function pages(request: Request, cache: Cache, background: Background, now: Date): Promise<Response | null> {
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
    return page(path, (live) => (live
      ? homePage(origin, { meteo, vigilance, volcan, air, electricite, calendrier, bus, trafic, velos, bornes, eau, sentiers, secheresse, coupures, sport, cyclones, historique, agenda, actualites }, now, vigilance ? alerteOf(vigilance.value, now) : undefined)
      : homePage(origin, null, now)), meteo, background, [rebuild(cache, DOMAINS["/meteo"].key, () => buildHome(cache, now))]);
  }
  // The bins' days: the bundled calendars and the day, nothing read but the vigilance's banner.
  const collecte = /^\/collecte(?:\/([a-z-]+))?\/?$/.exec(path);
  if (collecte) {
    const commune = collecte[1] ? communeOf(collecte[1]) : undefined;
    if (collecte[1] && !commune) return new Response(notFoundPage(origin, path), { status: 404, headers: HTML });
    const a = await alerte(cache, background, now);
    return new Response(collectePage(origin, now, commune, a), { headers: HTML });
  }
  // A past cyclone: the bundled measures, nothing read but the vigilance's banner.
  const passe = /^\/cyclones\/([a-z0-9-]+)\/?$/.exec(path);
  if (passe) {
    const c = PASSES.find((x) => x.slug === passe[1]);
    if (!c) return new Response(notFoundPage(origin, path), { status: 404, headers: HTML });
    const a = await alerte(cache, background, now);
    return new Response(passePage(origin, c, a), { headers: HTML });
  }
  if (path === "/vigilance" || path === "/vigilance/") {
    const data = await vigilanceNow(cache, background, waitFor(request) ?? VIGILANCE_WAIT_MS);
    return page(path, (live) => (live ? vigilancePage(origin, data, now, data ? alerteOf(data.value, now) : undefined) : vigilancePage(origin, null, now)), data, background);
  }
  // The guide for those who publish, written once: nothing read but the vigilance's banner.
  if (path === "/publier" || path === "/publier/") {
    const a = await alerte(cache, background, now);
    return new Response(publierPage(origin, a), { headers: HTML });
  }
  if (path === "/publier/modele-agenda.csv") {
    return new Response(MODELE_CSV, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="modele-agenda.csv"', "cache-control": STATIC, "access-control-allow-origin": "*", "x-content-type-options": "nosniff" } });
  }
  // The plan's list, nothing read but the vigilance's banner.
  if (path === "/kit-cyclone" || path === "/kit-cyclone/") {
    const a = await alerte(cache, background, now);
    return new Response(kitPage(origin, a), { headers: HTML });
  }
  if (path === "/alerte-cyclone" || path === "/alerte-cyclone/") {
    const [data, decision] = await Promise.all([
      vigilanceNow(cache, background, waitFor(request) ?? VIGILANCE_WAIT_MS),
      cycloneDecisionNow(cache, background, waitFor(request) ?? VIGILANCE_WAIT_MS),
    ]);
    return page(path, (live) => (live ? alertePage(origin, data, now, data ? alerteOf(data.value, now) : undefined, decision) : alertePage(origin, null, now)), data, background);
  }
  if (path === "/ecoles-cyclone" || path === "/ecoles-cyclone/") {
    const [data, decision] = await Promise.all([
      vigilanceNow(cache, background, waitFor(request) ?? VIGILANCE_WAIT_MS),
      cycloneDecisionNow(cache, background, waitFor(request) ?? VIGILANCE_WAIT_MS),
    ]);
    return page(path, (live) => (live ? ecolesPage(origin, data, now, data ? alerteOf(data.value, now) : undefined, decision) : ecolesPage(origin, null, now)), data, background);
  }
  if (path === "/mer" || path === "/mer/") {
    const [data, a] = await Promise.all([
      snapshot(cache, "web:mer", () => buildSea(cache, now), background, now, waitFor(request), isReader(request)),
      alerte(cache, background, now),
    ]);
    return page(path, (live) => seaPage(origin, live ? data : null, now, a), data, background, [rebuild(cache, "web:mer", () => buildSea(cache, now))]);
  }
  // The traffic page's copy lasts minutes; the media's headlines on the roads are those of the view.
  if (path === "/trafic" || path === "/trafic/") {
    const [data, a, news] = await Promise.all([
      snapshot(cache, "web:trafic", () => buildTrafic(cache, now), background, now, waitFor(request), isReader(request)),
      alerte(cache, background, now),
      roadNewsNow(cache, background, now),
    ]);
    return page(path, (live) => traficPage(origin, live && data ? { ...data, value: withRoadNews(data.value, news, now) } : null, now, a), data, background, [rebuild(cache, "web:trafic", () => buildTrafic(cache, now))]);
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
    return page(path, (live) => coupuresCommunePage(origin, p, live ? { coupures, secheresse, eau } : { coupures: null, secheresse: null, eau: null }, now, a), coupures, background, [rebuild(cache, "web:coupures", () => buildCoupures(cache, now))]);
  }
  // The fires seen by satellite, with the last copy of /sentiers and the vigilance; never a build of the trails' page.
  if (path === FEUX_PATH || path === `${FEUX_PATH}/`) {
    const [fires, vigilance, [sentiers]] = await Promise.all([
      feux.feuxNow(cache, now),
      vigilanceNow(cache, background, waitFor(request) ?? BANNER_WAIT_MS),
      tileCopies(cache, ["web:sentiers"], background, undefined, now),
    ]);
    const a = vigilance ? alerteOf(vigilance.value, now) : undefined;
    // Without what the satellites saw, the page is not kept: the next view should have it.
    return new Response(feuxPage(origin, { fires, sentiers, vigilance }, now, a), { headers: htmlFor(fires ?? (feux.enabled() ? null : true)) });
  }
  // The events page was first published as /agenda.
  if (path === "/agenda" || path === "/agenda/") return Response.redirect(`${origin}/evenements`, 301);
  if (path === "/volcan" || path === "/volcan/") {
    const [data, a] = await Promise.all([
      snapshot(cache, "web:volcan", () => buildVolcan(cache, now), background, now, waitFor(request), isReader(request)),
      alerte(cache, background, now),
    ]);
    // During an alert, what the media say of it: their copy as it is, never built for this page.
    const news = data && inAlert(data.value) ? await cache.peek<ActualitesAnswer>("web:actualites").catch(() => undefined) : undefined;
    return page(path, (live) => (live ? volcanPage(origin, data, now, a, news?.value) : volcanPage(origin, null, now, a)), data, background, [rebuild(cache, "web:volcan", () => buildVolcan(cache, now))]);
  }
  const domain = DOMAINS[path.replace(/(.)\/$/, "$1")];
  if (domain) {
    const [data, a] = await Promise.all([
      snapshot(cache, domain.key, () => domain.build(cache, now), background, now, waitFor(request), isReader(request)),
      alerte(cache, background, now),
    ]);
    return page(path, (live) => domain.page(origin, live ? data : null, now, a), data, background, [rebuild(cache, domain.key, () => domain.build(cache, now))]);
  }
  const sector = /^\/randonnees\/([a-z-]+)\/?$/.exec(path);
  const s = sector ? secteurOf(sector[1]) : undefined;
  if (s) {
    // The hikers' page's copy, and the weather page's as it is: a sector's page builds nothing of its own.
    const [data, a, meteo] = await Promise.all([
      snapshot(cache, DOMAINS["/randonnees"].key, () => buildRandonnees(cache, now), background, now, waitFor(request), isReader(request)),
      alerte(cache, background, now),
      s.meteo ? cache.peek<PlaceData>(`web:lieu:${s.meteo}`, now.getTime() - FRESH_SECONDS * 1000).catch(() => undefined) : undefined,
    ]);
    return page(path, (live) => secteurPage(origin, s, live ? data : null, live ? meteo ?? null : null, now, a), data, background, [rebuild(cache, DOMAINS["/randonnees"].key, () => buildRandonnees(cache, now))]);
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
    // A summit's trail links to the morning's cloud sea there, only while the page it leads to tells it: its last copy,
    // as it is, never built for this page.
    const summit = summitOf((data?.value.lignes ?? []).flatMap((l) => l.points));
    const told = summit && cloudSeaTold(summit, await cache.peek<PlaceData & RandonneesAnswer>(summit.copy, now.getTime() - FRESH_SECONDS * 1000).catch(() => undefined));
    return page(path, (live) => tracePage(origin, t ? "sentier" : "randonnee", slug, t?.nom ?? r!.nom, live ? data : null, now, a, told ? summit : undefined), data, background, [rebuild(cache, `web:${dir}:${slug}`, () => (t ? buildTrail(cache, t) : buildRoute(cache, r!)))]);
  }
  if (path === "/presse" || path === "/presse/") {
    // Its live counts are read from copies already here: a few minutes in browsers is enough.
    return new Response(pressePage(origin, await pressFigures(cache)), { headers: { ...HTML, "cache-control": "public, max-age=300" } });
  }
  if (path === "/carburants" || path === "/carburants/") {
    const [data, a] = await Promise.all([carburants.prix(cache, now).catch(() => null), alerte(cache, background, now)]);
    return page(path, (live) => carburantsPage(origin, live ? data : null, now, a), data, background);
  }
  if (path === "/nouveautes" || path === "/nouveautes/") {
    return new Response(nouveautesPage(origin), { headers: { ...HTML, "cache-control": "public, max-age=3600" } });
  }
  if (path === BAIGNADE || path === `${BAIGNADE}/`) {
    return new Response(bathingPage(origin, now), { headers: { ...HTML, "cache-control": "public, max-age=3600" } });
  }
  if (path === "/confidentialite" || path === "/conditions") {
    return new Response(legalPage(origin, path.slice(1) as "confidentialite" | "conditions"), { headers: { ...HTML, "cache-control": "public, max-age=3600" } });
  }
  if (path.startsWith("/meteo/")) {
    const slug = path.slice("/meteo/".length).replace(/\/$/, "");
    const p = pageOf(slug);
    if (!p) return new Response(notFoundPage(origin, path), { status: 404, headers: HTML });
    const [data, a] = await Promise.all([
      snapshot(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now), background, now, waitFor(request), isReader(request), withoutForecast),
      alerte(cache, background, now),
    ]);
    // The state of the hikes around: the hikers' page's last copy, as it is, never built for this page.
    const hikes = hikesNear(p.place.lon, p.place.lat).length ? await cache.peek<RandonneesAnswer>("web:randonnees", now.getTime() - FRESH_SECONDS * 1000).catch(() => undefined) : undefined;
    return page(path, (live) => (live ? placePage(origin, p, data, now, a, hikes ?? null) : placePage(origin, p, null, now, a)), data, background, [rebuild(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now))]);
  }
  if (path === "/communes" || path === "/communes/") {
    return new Response(communesPage(origin, await alerte(cache, background, now)), { headers: HTML });
  }
  if (path.startsWith("/aujourdhui/")) {
    const p = pageOf(path.slice("/aujourdhui/".length).replace(/\/$/, ""));
    if (!p?.commune) return new Response(notFoundPage(origin, path), { status: 404, headers: HTML });
    // The weather is built when it has no copy, as on the commune's page; the rest only read (tools/resume.ts).
    const vigilance = vigilanceNow(cache, background, waitFor(request) ?? BANNER_WAIT_MS);
    const place = await snapshot(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now), background, now, waitFor(request), isReader(request), withoutForecast);
    // The weather's copy as the snapshot gave it: not read again (the read could be one subrequest too many).
    const { copies, leftOut } = await readCopies(cache, p, p, now, background, vigilance, { meteo: place });
    return page(path, (live) => (live
      ? aujourdhuiPage(origin, p, resume(p, copies, now, leftOut), copies.meteo ?? place, copies.vigilance ? alerteOf(copies.vigilance.value, now) : undefined)
      : aujourdhuiPage(origin, p, resume(p, {}, now, leftOut), null)), place, background, [rebuild(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now))]);
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
      snapshot(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now), background, now, waitFor(request), isReader(request), withoutForecast),
      snapshot(cache, `web:commune:${p.slug}`, () => buildCommune(cache, p, now), background, now, waitFor(request), isReader(request)),
      vigilanceNow(cache, background, waitFor(request) ?? BANNER_WAIT_MS),
    ]);
    // The West's communes have their déchèteries' tile too (the TCO publishes them).
    const tiles = TCO_COMMUNES.includes(p.nom) ? [...COMMUNE_TILES, "web:dechets"] : COMMUNE_TILES;
    const [air, mer, volcan, electricite, calendrier, coupures, secheresse, eau, randonnees, agenda, dechets] = await tileCopies(cache, tiles, background, place, now);
    return page(path, (live) => (live
      ? communePage(origin, p, { place, commune, vigilance, air, mer, volcan, electricite, calendrier, coupures, secheresse, eau, randonnees, agenda, dechets }, now, vigilance ? alerteOf(vigilance.value, now) : undefined)
      : communePage(origin, p, { place: null, commune: null, vigilance: null, air: null, mer: null, volcan: null, electricite: null, calendrier: null, coupures: null, secheresse: null, eau: null, randonnees: null, agenda: null, dechets: null }, now)),
    place, background, [rebuild(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now)), rebuild(cache, `web:commune:${p.slug}`, () => buildCommune(cache, p, now))]);
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
    // The fuel page changes with the prefect's order: its date, from the stored copy when there is one. An order read
    // before its 1st changes the page the day it is read, not on its 1st: never a day ahead of today.
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
  if (path === SW_PATH) {
    // Checked again at each visit: a new version reaches the phones at once (web/pwa.ts).
    return new Response((swText ??= serviceWorker([FONT_PATH, RELIEF_PATH, "/favicon.svg", icons["192"]])), {
      headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff" },
    });
  }
  if (path === OFFLINE_PATH) {
    return new Response(offlinePage(origin), { headers: { ...HTML, "cache-control": "public, max-age=3600" } });
  }
  if (path === "/manifest.webmanifest") {
    return new Response(JSON.stringify(manifest()), { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=86400" } });
  }
  if (path === "/favicon.svg") {
    // The small symbol: a tab shows it at 16 px.
    return new Response(LOGO_PETIT_SVG, { headers: { "content-type": "image/svg+xml", "cache-control": STATIC } });
  }
  if (path === "/favicon.ico") {
    // A PNG, 48 px: the favicon services (Google's, which claude.ai asks for a connector's icon) read it better than SVG.
    return new Response((icoBytes ??= bytes(icons.ico)), { headers: { "content-type": "image/png", "cache-control": STATIC } });
  }
  return null;
}

/**
 * What a phone needs to keep the site on its home screen, like an app: its name, its icons (scripts/build-icons.py)
 * and where it opens, `?ref=pwa` so that the visits from the icon are counted apart (src/metrics.ts); a long press
 * on the icon opens the pages most used away from network.
 */
export function manifest() {
  return {
    name: "rundata.re · La Réunion 974 en direct",
    short_name: "rundata.re",
    description: "Météo mesurée, vigilance, volcan, routes, sentiers : La Réunion en direct, gratuit et sans compte.",
    lang: "fr",
    start_url: "/?ref=pwa",
    scope: "/",
    display: "standalone",
    background_color: "#0b1f36",
    theme_color: "#0b1f36",
    icons: [
      { src: icons["192"], sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icons["512"], sizes: "512x512", type: "image/png", purpose: "any" },
      // Full square, the symbol inside the safe zone: the phone cuts its own corners or circle.
      { src: icons["512-maskable"], sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: icons["symbole-svg"], sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Météo", url: "/meteo?ref=pwa" },
      { name: "Vigilance", url: "/vigilance?ref=pwa" },
      { name: "Randonnées", url: "/randonnees?ref=pwa" },
    ].map((s) => ({ ...s, icons: [{ src: icons["192"], sizes: "192x192", type: "image/png" }] })),
  };
}

/** Any other address a browser asks for: a page that leads back to the communes. */
export function notFound(request: Request): Response {
  return new Response(typo(notFoundPage(new URL(request.url).origin, new URL(request.url).pathname)), { status: 404, headers: HTML });
}
