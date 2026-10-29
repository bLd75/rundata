/**
 * The web side of the server: the home page, one page per category (weather, vigilance, sea, volcano, buses, air,
 * electricity, calendar), one per commune with all of them (/communes/<commune>), one per commune or place for the
 * weather (/meteo/<lieu>), and what crawlers and link previews ask for
 * (robots.txt, sitemap.xml, the favicon). Null for any other path: the og:image, the relief and the font are files of
 * public/, served before the Worker.
 */
import { alerteVolcan, volcanNow, withVolcan } from "./volcan-alerte.js";
import { withSaveData } from "./fonds.js";
import { left, measured } from "../budget.js";
import type { Cache, Cached } from "../cache.js";
import { why } from "../types.js";
import {
  alerte,
  alerteLue,
  type ReaderWaits,
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
  fordNews,
  roadNewsNow,
  roadNewsRead,
  withRoadNews,
  buildRandonnees,
  buildSecheresse,
  buildCoupures,
  buildSport,
  buildAgenda,
  buildEnfants,
  buildActualites,
  buildRoute,
  buildTrail,
  routeGpx,
  trailGpx,
  buildCrues,
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
import { buildEmploi, emploiPage } from "./emploi.js";
import { buildMarches, marchesPage } from "./marches-publics.js";
import { actualitesPage, agendaPage, airPage, bornesPage, busPage, calendrierPage, coupuresPage, cruesPage, cyclonesPage, daePage, eauPage, electricitePage, historiquePage, randonneesPage, secheressePage, sentiersPage, sportPage, tracePage, traficPage, velosPage, volcanPage } from "./domains.js";
import { concertsPage, weekendPage } from "./evenements.js";
import { communePath as enfantsPath, enfantsCommunePage, enfantsPage } from "./enfants.js";
import { coupuresCommunePage } from "./coupures.js";
import { cloudSeaTold, hikesNear, summitOf } from "./liens.js";
import { LOGO_PETIT_SVG } from "./logo.js";
import { homePage } from "./home.js";
import { RELIEF_PATH } from "./map.js";
import { ligne, mesure } from "./mesure.js";
import icons from "./icons.json" with { type: "json" };
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
import * as prefecture from "../providers/prefecture.js";
import { rafraichirConnecteurs, rafraichirPropositions } from "../tools/agenda.js";
import * as bord from "./bord.js";
import { flux, ICS_PATH, JSON_PATH } from "./flux-associations.js";
import { margin, scheduledEvery } from "./partagees.js";
import { ALIASES as ASSOCIATIONS_ALIASES, associationsPage, PATH as ASSOCIATIONS_PATH, preuve } from "./associations.js";
import { readCopies, refresh, resume } from "../tools/resume.js";
import { CSS, FONT_PATH, legalPage, meteoPage, notFoundPage, offlinePage, placePage, seaPage, STYLE_PATH, vigilancePage } from "./pages.js";
import { OFFLINE_PATH, serviceWorker, SW_PATH } from "./pwa.js";
import { pageOf, PAGES } from "./places.js";
import { pressePage, pressFigures, toolCount } from "./presse.js";
import { avisPost } from "./avis.js";
import * as connecteurs from "./connecteurs.js";
import * as formulaires from "./propositions.js";
import * as dae from "../providers/dae.js";
import * as traces from "../providers/traces.js";
import { SECTEURS, secteurOf } from "../traces/secteurs.js";
import { secteurPage } from "./randonnees.js";
import { aProposPage, llmsTxt } from "./a-propos.js";
import { PATH as VALEURS, valeursPage } from "./valeurs.js";
import { antennesPage, PATH as ANTENNES } from "./antennes.js";
import * as sitesHs from "../providers/sites-hs.js";
import { applicationPage, PATH as APPLICATION } from "./application.js";
import { ouvrirDonneesPage, PATH as GUIDE } from "./ouvrir-donnees.js";
import { PATH as SANS_REPONSE, sansReponsePage } from "./sans-reponse.js";
import { chiffres, type Copie, KEY as CHIFFRES_KEY, PATH as CHIFFRES } from "../chiffres.js";
import { chiffresPage } from "./chiffres.js";
import { toutesLesSources } from "../server.js";
import { etat as sansReponse } from "../sans-reponse.js";
import { connecteurPage } from "./connecteur.js";
import { enTetes, SECURITY_TEXT, SECURITY_TXT } from "./securite.js";
import { typo, typoPage } from "./typo.js";
import { tripGonePage, tripPage } from "./trajet.js";
import { searchStops, stopPageDepartures, TRIP_PATH, tripRun } from "../tools/transports.js";
import { searchPage, stopPage } from "./arret.js";
import { STOP_PATH } from "./domains.js";
import * as transit from "../providers/transit.js";
import { carteRoute } from "./vigilance-carte.js";
import { carteRoute as cmrsRoute } from "./cmrs-carte.js";
import { RENDU_PATH } from "../providers/vigilance-carte.js";
import { PATH as PLUIE_RADAR, rainGrid } from "./pluie-radar.js";
import { PATH as PLUIE_RETRO, retro } from "./pluie-retro.js";

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
 * No robot follows a trip (web/trajet.ts): its page is not indexed, and it has an address per stop and per day, which
 * a stop's page links for each of its buses and which links back to each stop: a crawler went round them, 1 300 an hour.
 * The page that draws Météo-France's bulletin for Cloudflare's browser (web/vigilance-carte.ts) is not for anyone else.
 */
const ROBOTS = (origin: string) =>
  `User-agent: Googlebot\nUser-agent: GoogleOther\nUser-agent: Bingbot\nDisallow: /*?maj=\nDisallow: ${STOP_PATH}?q=\nDisallow: ${TRIP_PATH}/\nDisallow: ${RENDU_PATH}\nAllow: /\n\nUser-agent: *\nDisallow: ${STOP_PATH}?q=\nDisallow: ${TRIP_PATH}/\nDisallow: ${RENDU_PATH}\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;

/** IndexNow (Bing, Yandex, Seznam, Naver): the key that proves rundata.re's submissions are ours. Public by design. */
export const INDEXNOW_KEY = "9cb4a2d427093776313488cb4d39b24a";
// Proves to the official MCP registry that rundata.re publishes re.rundata/*: the public half of the key that signs its publications.
const MCP_REGISTRY_AUTH = "v=MCPv1; k=ed25519; p=FTzDdb5aS1w9JIe6rHUyRBhGknTv/RhlS1oKdNz1+nE=";
// Proves to OpenAI's plugin portal that the MCP server is ours: the token the portal shows when the server is connected,
// served as it is (the Worker's secret OPENAI_APPS_CHALLENGE). Without it, the path is not found like any other.
const OPENAI_CHALLENGE = "/.well-known/openai-apps-challenge";
let defiOpenai: string | undefined;
export function configurerDefiOpenai(jeton: string | undefined) {
  defiOpenai = jeton?.trim() || undefined;
}

/**
 * The fetchers of AI assistants and search engines. A person gets a page without its live block rather than wait
 * more than a few seconds; these read the page once and answer from it, so they wait for the measurements. Not the
 * crawlers that gather pages to train a model (ClaudeBot, GPTBot, meta-externalagent): what they read is kept as it
 * was, and the copy does for them.
 */
// rundata-check: the daily check of the sources (bin/check-sources.ts), which must see the data, not the cache.
const READERS = /rundata-check\/|ChatGPT-User|OAI-SearchBot|Claude-User|Claude-SearchBot|Perplexity|MistralAI|meta-externalfetcher|facebookexternalhit|Googlebot|bingbot|Applebot|DuckAssistBot/i;
const READER_WAIT_MS = 25_000;
// The vigilance page waits longer than a banner for Météo-France: it is the page's whole content.
const VIGILANCE_WAIT_MS = 8000;
// The subrequests a tile's build is assumed to take when it was measured neither in this isolate nor with its copy.
const TILE_COST_UNKNOWN = 25;

export const isReader = (request: Request) => READERS.test(request.headers.get("user-agent") ?? "");

/** How long to wait for a page's data that this data center has never built, or has an old copy of (web/data.ts). */
const waitFor = (request: Request) => (isReader(request) ? READER_WAIT_MS : undefined);

// The scheduled event refreshes the shared copies at their rate (web/partagees.ts): a reader gets such a copy at once
// while it is within that rate and its margin (a copy written just before its slot waits for the next), and two events
// more (one a few minutes late, one left for the budget), its refresh going on behind. Waiting for it held Googlebot or
// ChatGPT-User up to 25 s on /crues, kept every 15 min (26/10/2026). Past that, the scheduled event has fallen behind:
// the reader waits for the refresh, as before. The daily check of the sources waits always: it must see the data, not a
// copy.
const SCHEDULED_SLACK_MS = 10 * 60_000;
const CHECK = /rundata-check\//i;
const readerWaits: ReaderWaits = (key, value, ageMs) => {
  const every = scheduledEvery(key, value);
  return every == null || ageMs > every * 60_000 + margin(every) + SCHEDULED_SLACK_MS;
};
/** Whether `request`'s reader waits for a page's old copy to be refreshed (web/data.ts `snapshot`). */
export const readerOf = (request: Request): boolean | ReaderWaits =>
  isReader(request) && (CHECK.test(request.headers.get("user-agent") ?? "") || readerWaits);

/** A page without its live block is not kept, nor one from a copy of another revision (web/data.ts `snapshot`): the next load should have it. */
export const htmlFor = (data: unknown) => (data && !(data as { outdated?: boolean }).outdated ? HTML : { ...HTML, "cache-control": "no-store" });

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
let icoBytes: Uint8Array<ArrayBuffer> | undefined;
let swText: string | undefined;

/** The domain pages: built from a tool's answer, kept like the other pages (web/data.ts). */
export const DOMAINS: Record<string, { key: string; build: (cache: Cache, now: Date) => Promise<any>; page: (origin: string, data: Cached<any> | null, now: Date, alerte?: Alerte) => string }> = {
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
  "/crues": { key: "web:crues", build: buildCrues, page: cruesPage },
  "/historique": { key: "web:historique", build: buildHistorique, page: historiquePage },
  "/evenements": { key: "web:agenda", build: buildAgenda, page: agendaPage },
  // Parts of the events page's copy, with their own title for what people search.
  "/evenements/ce-week-end": { key: "web:agenda", build: buildAgenda, page: weekendPage },
  "/evenements/concerts": { key: "web:agenda", build: buildAgenda, page: concertsPage },
  "/actualites": { key: "web:actualites", build: buildActualites, page: actualitesPage },
  "/enfants": { key: "web:enfants", build: buildEnfants, page: enfantsPage },
  "/emploi": { key: "web:emploi", build: buildEmploi, page: emploiPage },
  "/marches-publics": { key: "web:marches-publics", build: buildMarches, page: marchesPage },
};

/** How to build each category page's copy, by its cache key: what the home page and the commune pages show as tiles. */
const BUILDS: Record<string, (cache: Cache, now: Date) => Promise<unknown>> = {
  ...Object.fromEntries(Object.values(DOMAINS).map((d) => [d.key, d.build])),
  "web:mer": buildSea,
};
// The home page's tiles besides the weather and the vigilance; a commune page's besides its own.
// The news first: on a day of mobilisation its headlines go above the tiles.
export const HOME_TILES = ["web:actualites", "web:volcan", "web:air", "web:electricite", "web:calendrier", "web:bus", "web:trafic", "web:velos", "web:bornes", "web:eau", "web:sentiers", "web:secheresse", "web:coupures", "web:sport", "web:cyclones", "web:historique", "web:agenda", "web:crues"];
// A commune's feed: the copies besides the vigilance (web/rss.ts).
const RSS_TILES = ["web:coupures", "web:randonnees", "web:volcan"];
export const COMMUNE_TILES = ["web:air", "web:mer", "web:volcan", "web:electricite", "web:calendrier", "web:coupures", "web:secheresse", "web:eau", "web:randonnees", "web:agenda"];

/**
 * The last copy of each of these pages, without building them: building them all would not fit in one invocation.
 * Once the page's own data is fresh, those of another revision and the oldest of the others (or one never built) are
 * brought up to date afterwards, as far as the invocation's subrequests go (tools/resume.ts, `refresh`). `own`
 * undefined: a page without data of its own (a feed), which never holds up a refresh.
 */
async function tileCopies(cache: Cache, keys: string[], background: Background, own: Cached<unknown> | null | undefined, now: Date): Promise<(Cached<any> | null)[]> {
  // One read each, as long as the invocation has subrequests left: a tile past them waits for the next view.
  const budget = left();
  const copies = await Promise.all(keys.map((k, i) => (i < budget ? cache.peek<any>(k, now.getTime() - FRESH_SECONDS * 1000) : Promise.resolve(undefined))));
  // A copy of another revision is shown until its turn, which comes first (cache.ts, `outdated`).
  const age = (c: Cached<unknown> | null | undefined) => (c && !c.outdated ? now.getTime() - c.fetchedAt.getTime() : Infinity);
  // Only what the tiles' builds took last time (here, or where their copies were built) and is left: otherwise their
  // pages or a later visit bring them up to date.
  if (own === undefined || (own && age(own) < FRESH_SECONDS * 1000)) {
    const due = keys.flatMap((key, i) => (age(copies[i]) >= FRESH_SECONDS * 1000 ? [{ key, build: () => BUILDS[key](cache, now), age: age(copies[i]), outdated: copies[i]?.outdated, cost: copies[i]?.cost }] : []));
    refresh(cache, due, background, TILE_COST_UNKNOWN);
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
  const urls: Url[] = [...["/", ...Object.keys(DOMAINS).filter((u) => u !== "/defibrillateurs"), "/vigilance", "/ecoles-cyclone", "/alerte-cyclone", "/mer", "/collecte", ...COLLECTE_COMMUNES.map((c) => `/collecte/${communeSlug(c)}`)].map(live), ["/defibrillateurs", dae.BUILT, "monthly"], fixed("/communes"), fixed("/kit-cyclone"), fixed("/publier"), ...COMMUNES.map((p) => live(`/communes/${p.slug}`)), ...COMMUNES.map((p) => live(`/coupures-eau/${p.slug}`)), ...COMMUNES.map((p) => live(`/aujourdhui/${p.slug}`)), ...COMMUNES.map((p) => live(enfantsPath(p))),
    // The busiest stops only (scripts/build-transit.py): the others' pages are not indexed.
    ...[...transit.stopPages().values()].filter((p) => p.indexe).map((p) => live(`${STOP_PATH}/${p.slug}`)),
    ...PAGES.map((p) => live(`/meteo/${p.slug}`)), ...SECTEURS.map((x) => live(`/randonnees/${x.slug}`)), ...traces.RANDONNEES.map((r) => trace(`/randonnees/${r.slug}`)),
    ...Object.values(traces.SENTIERS).map((t) => trace(`/sentiers/${t.slug}`)), ...["/presse", "/a-propos", VALEURS, APPLICATION, GUIDE, "/mcp", "/confidentialite", "/conditions", BAIGNADE, ...PASSES.map((c) => `/cyclones/${c.slug}`)].map(fixed),
    ...(formulaires.enLigne() ? [live(ASSOCIATIONS_PATH), fixed(formulaires.PROPOSER_PATH)] : []),
    ["/nouveautes", localDay(NOUVEAUTES[0].date), "daily"], [ANTENNES, undefined, "weekly"], [SANS_REPONSE, undefined, "daily"], live(CHIFFRES), ["/carburants", fuelDay ? (fuelDay < today ? fuelDay : today) : undefined, "daily"],
    // The fires' page only once FIRMS's key is there: before, it says the detection is not active.
    ...(feux.enabled() ? [live(FEUX_PATH)] : [])];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(([u, day, freq]) => `<url><loc>${origin}${u}</loc>${day ? `<lastmod>${day}</lastmod>` : ""}<changefreq>${freq}</changefreq></url>`).join("\n") +
    `\n</urlset>\n`;
}

/** The site's pages, each with the volcano's banner while the volcano is in alert (web/volcan-alerte.ts), in French typography (web/typo.ts). */
export async function site(request: Request, cache: Cache, background: Background, now = new Date()): Promise<Response | null> {
  // Nothing of the moment in it: answered before the volcano's state is read.
  const style = stylesheet(new URL(request.url).pathname);
  if (style) return style;
  // The bus trips, kept a minute at the edge (web/bord.ts): the copy as it was served.
  const copie = await bord.lire(request);
  if (copie) return copie;
  const volcan = await volcanNow(cache, now);
  const r = await typoPage(await withVolcan(volcan, () => withSaveData(request, () => pages(request, cache, background, now))));
  if (r?.status === 200 && request.method === "GET" && bord.gardeDe(new URL(request.url))) background(bord.garder(request, r.clone()));
  return r;
}

const STYLE_FILE = /^\/style-\w+\.css$/;

/**
 * The pages' stylesheet (web/pages.ts), kept a year at its address. Another address, asked by a page of an earlier
 * version (a copy kept offline, a version still rolling out), gets today's for a few minutes only.
 */
function stylesheet(path: string): Response | null {
  if (!STYLE_FILE.test(path)) return null;
  return new Response(CSS, {
    headers: { "content-type": "text/css; charset=utf-8", "cache-control": path === STYLE_PATH ? "public, max-age=31536000, immutable" : "public, max-age=300", "x-content-type-options": "nosniff" },
  });
}

async function pages(request: Request, cache: Cache, background: Background, now: Date): Promise<Response | null> {
  const url = new URL(request.url);
  const origin = url.origin;
  const path = url.pathname;

  // The feedback form at the bottom of every page (web/avis.ts).
  if (path === "/avis") return avisPost(request, now);
  // The clubs' and associations' forms (web/propositions.ts), once their page goes out.
  if (formulaires.enLigne()) {
    // The space's page: the agendas' last copy for its proof, and the vigilance's banner.
    if (path === ASSOCIATIONS_PATH || path === `${ASSOCIATIONS_PATH}/`) {
      const [a, p] = await Promise.all([alerte(cache, background, now), preuve(cache, now)]);
      return new Response(associationsPage(origin, p, a), { headers: HTML });
    }
    if (ASSOCIATIONS_ALIASES.includes(path.replace(/\/$/, ""))) return Response.redirect(`${origin}${ASSOCIATIONS_PATH}${new URL(request.url).search}`, 301);
    if (path === formulaires.LIEN_PATH) return formulaires.lienPost(request, now);
    if (path === formulaires.PROPOSER_PATH || path === `${formulaires.PROPOSER_PATH}/`) return formulaires.proposer(request, now, await alerte(cache, background, now));
    if (path === ICS_PATH || path === JSON_PATH) return flux(request, path, now);
    if (path.startsWith(formulaires.PROPOSITION_PATH)) return formulaires.proposition(request, now, await alerte(cache, background, now), () => rafraichirPropositions(cache, now));
    // « Relier votre plateforme » (web/connecteurs.ts), once the associations' platforms are read.
    if (connecteurs.enLigne()) {
      if (path === connecteurs.RELIER_PATH || path === `${connecteurs.RELIER_PATH}/`) return connecteurs.relier(request, now, await alerte(cache, background, now));
      if (path === connecteurs.CONFIRMER_PATH) return connecteurs.confirmerRelier(request, now, await alerte(cache, background, now));
      if (path.startsWith(connecteurs.CONNEXION_PATH)) return connecteurs.connexion(request, now, await alerte(cache, background, now), () => rafraichirConnecteurs(cache, now));
    }
  }
  if (path === "/") {
    const [meteo, vigilance] = await Promise.all([
      snapshot(cache, DOMAINS["/meteo"].key, () => buildHome(cache, now), background, now, waitFor(request), readerOf(request)),
      vigilanceNow(cache, background, waitFor(request) ?? BANNER_WAIT_MS, now),
    ]);
    const [actualites, volcan, air, electricite, calendrier, bus, trafic, velos, bornes, eau, sentiers, secheresse, coupures, sport, cyclones, historique, agenda, crues] = await tileCopies(cache, HOME_TILES, background, meteo, now);
    return page(path, (live) => (live
      ? homePage(origin, { meteo, vigilance, volcan, air, electricite, calendrier, bus, trafic, velos, bornes, eau, sentiers, secheresse, coupures, sport, cyclones, historique, agenda, actualites, crues }, now, alerteLue(vigilance, now))
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
    const data = await vigilanceNow(cache, background, waitFor(request) ?? VIGILANCE_WAIT_MS, now);
    return page(path, (live) => (live ? vigilancePage(origin, data, now, alerteLue(data, now)) : vigilancePage(origin, null, now)), data, background);
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
      vigilanceNow(cache, background, waitFor(request) ?? VIGILANCE_WAIT_MS, now),
      cycloneDecisionNow(cache, background, waitFor(request) ?? VIGILANCE_WAIT_MS),
    ]);
    const rubrique = await prefecture.rubriqueNonLue(cache, now).catch(() => undefined);
    return page(path, (live) => (live ? alertePage(origin, data, now, alerteLue(data, now), decision, rubrique) : alertePage(origin, null, now)), data, background);
  }
  if (path === "/ecoles-cyclone" || path === "/ecoles-cyclone/") {
    const [data, decision] = await Promise.all([
      vigilanceNow(cache, background, waitFor(request) ?? VIGILANCE_WAIT_MS, now),
      cycloneDecisionNow(cache, background, waitFor(request) ?? VIGILANCE_WAIT_MS),
    ]);
    const rubrique = await prefecture.rubriqueNonLue(cache, now).catch(() => undefined);
    return page(path, (live) => (live ? ecolesPage(origin, data, now, alerteLue(data, now), decision, rubrique) : ecolesPage(origin, null, now)), data, background);
  }
  if (path === "/mer" || path === "/mer/") {
    const [data, a] = await Promise.all([
      snapshot(cache, "web:mer", () => buildSea(cache, now), background, now, waitFor(request), readerOf(request)),
      alerte(cache, background, now),
    ]);
    return page(path, (live) => seaPage(origin, live ? data : null, now, a), data, background, [rebuild(cache, "web:mer", () => buildSea(cache, now))]);
  }
  // The traffic page's copy lasts minutes; the media's headlines on the roads are those of the view.
  if (path === "/trafic" || path === "/trafic/") {
    const [data, a, news] = await Promise.all([
      snapshot(cache, "web:trafic", () => buildTrafic(cache, now), background, now, waitFor(request), readerOf(request)),
      alerte(cache, background, now),
      roadNewsNow(cache, background, now),
    ]);
    return page(path, (live) => traficPage(origin, live && data ? { ...data, value: withRoadNews(data.value, news, now) } : null, now, a), data, background, [rebuild(cache, "web:trafic", () => buildTrafic(cache, now))]);
  }
  // The rivers' copy lasts minutes; the headlines on the fords are those of the view, as on /trafic.
  if (path === "/crues" || path === "/crues/") {
    const [data, a, news] = await Promise.all([
      snapshot(cache, "web:crues", () => buildCrues(cache, now), background, now, waitFor(request), readerOf(request)),
      alerte(cache, background, now),
      roadNewsRead(cache, background, now),
    ]);
    const fords = news && { annonces: fordNews(news.value, now), lue: news.fetchedAt };
    return page(path, (live) => cruesPage(origin, live ? data : null, now, a, fords), data, background, [rebuild(cache, "web:crues", () => buildCrues(cache, now))]);
  }
  // A commune's places for children on its map: the copy of /enfants, its agenda kept to the commune.
  const kids = /^\/enfants\/([a-z-]+)\/?$/.exec(path);
  if (kids) {
    const p = pageOf(kids[1]);
    if (!p?.commune) return new Response(notFoundPage(origin, path), { status: 404, headers: HTML });
    const [data, a] = await Promise.all([
      snapshot(cache, DOMAINS["/enfants"].key, () => buildEnfants(cache, now), background, now, waitFor(request), readerOf(request)),
      alerte(cache, background, now),
    ]);
    return page(path, (live) => enfantsCommunePage(origin, p, live ? data : null, now, a), data, background, [rebuild(cache, DOMAINS["/enfants"].key, () => buildEnfants(cache, now))]);
  }
  // A commune's water: the copy of /coupures-eau, and the last ones of /secheresse and /eau as they are.
  const water = /^\/coupures-eau\/([a-z-]+)\/?$/.exec(path);
  if (water) {
    const p = pageOf(water[1]);
    if (!p?.commune) return new Response(notFoundPage(origin, path), { status: 404, headers: HTML });
    const [coupures, a] = await Promise.all([
      snapshot(cache, "web:coupures", () => buildCoupures(cache, now), background, now, waitFor(request), readerOf(request)),
      alerte(cache, background, now),
    ]);
    const [secheresse, eau] = await tileCopies(cache, ["web:secheresse", "web:eau"], background, coupures, now);
    return page(path, (live) => coupuresCommunePage(origin, p, live ? { coupures, secheresse, eau } : { coupures: null, secheresse: null, eau: null }, now, a), coupures, background, [rebuild(cache, "web:coupures", () => buildCoupures(cache, now))]);
  }
  // The fires seen by satellite, with the last copy of /sentiers and the vigilance; never a build of the trails' page.
  if (path === FEUX_PATH || path === `${FEUX_PATH}/`) {
    const [fires, vigilance, [sentiers]] = await Promise.all([
      feux.feuxNow(cache, now),
      vigilanceNow(cache, background, waitFor(request) ?? BANNER_WAIT_MS, now),
      tileCopies(cache, ["web:sentiers"], background, undefined, now),
    ]);
    const a = alerteLue(vigilance, now);
    // Without what the satellites saw, the page is not kept: the next view should have it.
    return new Response(feuxPage(origin, { fires, sentiers, vigilance }, now, a), { headers: htmlFor(fires ?? (feux.enabled() ? null : true)) });
  }
  // The events page was first published as /agenda.
  if (path === "/agenda" || path === "/agenda/") return Response.redirect(`${origin}/evenements`, 301);
  if (path === "/volcan" || path === "/volcan/") {
    const [data, a] = await Promise.all([
      snapshot(cache, "web:volcan", () => buildVolcan(cache, now), background, now, waitFor(request), readerOf(request)),
      alerte(cache, background, now),
    ]);
    // During an alert, what the media say of it: their copy as it is, never built for this page.
    const news = data && inAlert(data.value) ? await cache.peek<ActualitesAnswer>("web:actualites").catch(() => undefined) : undefined;
    return page(path, (live) => (live ? volcanPage(origin, data, now, a, news?.value) : volcanPage(origin, null, now, a)), data, background, [rebuild(cache, "web:volcan", () => buildVolcan(cache, now))]);
  }
  const domain = DOMAINS[path.replace(/(.)\/$/, "$1")];
  if (domain) {
    const [data, a] = await Promise.all([
      snapshot(cache, domain.key, () => domain.build(cache, now), background, now, waitFor(request), readerOf(request)),
      alerte(cache, background, now),
    ]);
    const t = Date.now();
    const res = page(path, (live) => domain.page(origin, live ? data : null, now, a), data, background, [rebuild(cache, domain.key, () => domain.build(cache, now))]);
    // The agendas' cold views, step by step (web/mesure.ts).
    const said = ligne(domain.key, mesure(), Date.now() - t);
    if (said) console.log(said);
    return res;
  }
  const sector = /^\/randonnees\/([a-z-]+)\/?$/.exec(path);
  const s = sector ? secteurOf(sector[1]) : undefined;
  if (s) {
    // The hikers' page's copy, and the weather page's as it is: a sector's page builds nothing of its own.
    const [data, a, meteo] = await Promise.all([
      snapshot(cache, DOMAINS["/randonnees"].key, () => buildRandonnees(cache, now), background, now, waitFor(request), readerOf(request)),
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
      snapshot(cache, `web:${dir}:${slug}`, () => (t ? buildTrail(cache, t) : buildRoute(cache, r!)), background, now, waitFor(request), readerOf(request)),
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
  // With the vigilance's banner, and so as short-lived as the others: a calm lagoon must not stay above an alert.
  if (path === BAIGNADE || path === `${BAIGNADE}/`) {
    const a = await alerte(cache, background, now);
    return new Response(bathingPage(origin, now, a), { headers: HTML });
  }
  if (path === "/mentions-legales" || path === "/mentions-legales/") {
    return new Response(null, { status: 301, headers: { location: "/conditions#mentions-legales", "cache-control": STATIC } });
  }
  // The English address, typed or guessed by those who look for who makes a site.
  if (path === "/about" || path === "/about/") {
    return new Response(null, { status: 301, headers: { location: "/a-propos", "cache-control": STATIC } });
  }
  // Who makes the site, and the connector's page for a browser (app.ts sends only those here): nothing read but the vigilance's banner.
  if (path === "/a-propos" || path === "/a-propos/") {
    return new Response(aProposPage(origin, await alerte(cache, background, now)), { headers: { ...HTML, "cache-control": "public, max-age=3600" } });
  }
  // The antennas, bundled (vie/antennes.ts), and the copy of the mobile sites out of service (one read, kept an hour in
  // the data center's cache), with the vigilance's banner.
  if (path === ANTENNES || path === `${ANTENNES}/`) {
    const [hs, a] = await Promise.all([sitesHs.sites(cache), alerte(cache, background, now)]);
    return new Response(antennesPage(origin, hs, now, a), { headers: { ...HTML, "cache-control": "public, max-age=900" } });
  }
  // What rundata.re stands for: nothing read but the vigilance's banner, as /a-propos.
  if (path === VALEURS || path === `${VALEURS}/`) {
    return new Response(valeursPage(origin, await alerte(cache, background, now)), { headers: { ...HTML, "cache-control": "public, max-age=3600" } });
  }
  // How to put the site on the home screen, browser by browser: the same.
  if (path === APPLICATION || path === `${APPLICATION}/`) {
    return new Response(applicationPage(origin, await alerte(cache, background, now)), { headers: { ...HTML, "cache-control": "public, max-age=3600" } });
  }
  // The guide to publishing one's information openly: the same.
  if (path === GUIDE || path === `${GUIDE}/`) {
    return new Response(ouvrirDonneesPage(origin, await alerte(cache, background, now)), { headers: { ...HTML, "cache-control": "public, max-age=3600" } });
  }
  // rundata.re en chiffres: what the code counts, and the last copy of what the sources do (chiffres.ts); never a source.
  if (path === CHIFFRES || path === `${CHIFFRES}/`) {
    const [copie, a] = await Promise.all([cache.peek<Copie>(CHIFFRES_KEY).catch(() => undefined), alerte(cache, background, now)]);
    return new Response(chiffresPage(origin, chiffres(toutesLesSources(), copie, now, toolCount(cache)), a), { headers: { ...HTML, "cache-control": "public, max-age=900" } });
  }
  // The sites that do not answer: their rows read at most every 15 minutes (sans-reponse.ts), whatever the visits.
  if (path === SANS_REPONSE || path === `${SANS_REPONSE}/`) {
    const [e, a] = await Promise.all([sansReponse(cache).catch(() => undefined), alerte(cache, background, now)]);
    return new Response(sansReponsePage(origin, e?.lignes ?? [], e?.passage, a), { headers: { ...HTML, "cache-control": "public, max-age=900" } });
  }
  if (path === "/mcp" || path === "/mcp/") {
    return new Response(connecteurPage(origin, await alerte(cache, background, now)), { headers: { ...HTML, "cache-control": "public, max-age=3600", vary: "accept" } });
  }
  if (path === "/llms.txt") {
    return new Response(llmsTxt(origin), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
  }
  if (path === "/confidentialite" || path === "/conditions") {
    return new Response(legalPage(origin, path.slice(1) as "confidentialite" | "conditions"), { headers: { ...HTML, "cache-control": "public, max-age=3600" } });
  }
  // The radar's rain for /meteo's map, asked by its script: data, not a page.
  if (path === PLUIE_RADAR) return rainGrid(cache);
  // Its last 3 hours and the wind of the last round hours, asked by the same script on a click: data, not a page.
  if (path === PLUIE_RETRO) return retro(cache, now);
  if (path.startsWith("/meteo/")) {
    const slug = path.slice("/meteo/".length).replace(/\/$/, "");
    const p = pageOf(slug);
    if (!p) return new Response(notFoundPage(origin, path), { status: 404, headers: HTML });
    const [data, a] = await Promise.all([
      snapshot(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now), background, now, waitFor(request), readerOf(request), withoutForecast),
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
    const vigilance = vigilanceNow(cache, background, waitFor(request) ?? BANNER_WAIT_MS, now);
    const place = await snapshot(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now), background, now, waitFor(request), readerOf(request), withoutForecast);
    // The weather's copy as the snapshot gave it: not read again (the read could be one subrequest too many).
    const { copies, leftOut } = await readCopies(cache, p, p, now, background, vigilance, { meteo: place });
    return page(path, (live) => (live
      ? aujourdhuiPage(origin, p, resume(p, copies, now, leftOut), copies.meteo ?? place, alerteLue(copies.vigilance, now))
      : aujourdhuiPage(origin, p, resume(p, {}, now, leftOut), null)), place, background, [rebuild(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now))]);
  }
  // A commune's alerts as RSS: the copies of the pages, never a build of its own (web/rss.ts).
  const feed = /^\/communes\/([a-z-]+)\.rss$/.exec(path);
  if (feed) {
    const p = pageOf(feed[1]);
    if (!p?.commune) return new Response("Flux inconnu : voir https://rundata.re/communes", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    const [vigilance, [coupures, randonnees, volcan]] = await Promise.all([
      vigilanceNow(cache, background, BANNER_WAIT_MS, now),
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
      snapshot(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now), background, now, waitFor(request), readerOf(request), withoutForecast),
      snapshot(cache, `web:commune:${p.slug}`, () => buildCommune(cache, p, now), background, now, waitFor(request), readerOf(request)),
      vigilanceNow(cache, background, waitFor(request) ?? BANNER_WAIT_MS, now),
    ]);
    // The West's communes have their déchèteries' tile too (the TCO publishes them).
    const tiles = TCO_COMMUNES.includes(p.nom) ? [...COMMUNE_TILES, "web:dechets"] : COMMUNE_TILES;
    const [[air, mer, volcan, electricite, calendrier, coupures, secheresse, eau, randonnees, agenda, dechets], hs] = await Promise.all([tileCopies(cache, tiles, background, place, now), sitesHs.sites(cache)]);
    return page(path, (live) => (live
      ? communePage(origin, p, { place, commune, vigilance, air, mer, volcan, electricite, calendrier, coupures, secheresse, eau, randonnees, agenda, dechets, hs }, now, alerteLue(vigilance, now))
      : communePage(origin, p, { place: null, commune: null, vigilance: null, air: null, mer: null, volcan: null, electricite: null, calendrier: null, coupures: null, secheresse: null, eau: null, randonnees: null, agenda: null, dechets: null }, now)),
    place, background, [rebuild(cache, `web:lieu:${p.slug}`, () => buildPlace(cache, p, now)), rebuild(cache, `web:commune:${p.slug}`, () => buildCommune(cache, p, now))]);
  }
  // A stop's page, and the search for one: read from the timetables at each view, never kept (web/arret.ts).
  if (path === STOP_PATH || path === `${STOP_PATH}/`) {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    if (!q) return new Response(null, { status: 302, headers: { location: "/bus", "cache-control": "no-store" } });
    // The stops are bundled: the search reads nothing.
    const found = searchStops(q);
    // One stop: its page at once.
    if (found.length === 1) return new Response(null, { status: 302, headers: { location: `${STOP_PATH}/${found[0].slug}`, "cache-control": "public, max-age=300" } });
    return new Response(searchPage(origin, q, found, await alerte(cache, background, now)), { headers: { ...HTML, "cache-control": "public, max-age=300" } });
  }
  if (path.startsWith(`${STOP_PATH}/`)) {
    const p = transit.stopPages().get(path.slice(STOP_PATH.length + 1).replace(/\/$/, ""));
    if (!p) return new Response(notFoundPage(origin, path), { status: 404, headers: HTML });
    let d: Awaited<ReturnType<typeof stopPageDepartures>>;
    try {
      if (!transit.enabled()) throw new Error("horaires indisponibles ici");
      d = await stopPageDepartures(p.groups, now, cache);
    } catch (err) {
      console.error(`page ${path} : horaires indisponibles`, why(err));
      return new Response(tripGonePage(origin, path, undefined, await alerte(cache, background, now), true), { status: 503, headers: { ...HTML, "cache-control": "no-store", "retry-after": "60" } });
    }
    return new Response(stopPage(origin, p, d, now, await alerte(cache, background, now)), { headers: HTML });
  }
  // A bus's trip, from a departure: read from the timetables, its page kept a minute at the edge (web/trajet.ts, web/bord.ts).
  const trajet = path.startsWith(`${TRIP_PATH}/`) ? /^\/bus\/trajet\/([a-z]+)\/(\d+)\/([^/]+)\/?$/.exec(path) : null;
  if (trajet || path.startsWith(`${TRIP_PATH}/`)) {
    const net = trajet && transit.NETWORKS[trajet[1]] ? trajet[1] : undefined;
    const jour = /^\d{8}$/.test(url.searchParams.get("jour") ?? "") ? Number(url.searchParams.get("jour")) : undefined;
    const arret = /^\d+$/.test(url.searchParams.get("arret") ?? "") && net ? transit.NETWORKS[net].first_stop + Number(url.searchParams.get("arret")) : undefined;
    // The address without the stop clicked on: one canonical page per trip and day.
    const canonical = `${path}${jour !== undefined ? `?jour=${jour}` : ""}`;
    const id = (() => {
      try {
        return trajet ? decodeURIComponent(trajet[3]) : undefined;
      } catch {
        return undefined;
      }
    })();
    let trip: Awaited<ReturnType<typeof tripRun>>;
    try {
      trip = net && id && transit.enabled() ? await tripRun(net, Number(trajet![2]), id, jour, now, cache) : undefined;
    } catch (err) {
      console.error(`page ${path} : horaires indisponibles`, why(err));
      return new Response(tripGonePage(origin, canonical, net, await alerte(cache, background, now), true), { status: 503, headers: { ...HTML, "cache-control": "no-store", "retry-after": "60" } });
    }
    const a = await alerte(cache, background, now);
    // An old link names its stop by its number then: its page, if that number is still a stop of the trip's network.
    const named = arret !== undefined ? transit.pageOfStop(arret) : undefined;
    if (!trip) return new Response(tripGonePage(origin, canonical, net, a, false, named?.groups.some((g) => g.reseau === net && g.ids.includes(arret!)) ? named : undefined), { status: 404, headers: HTML });
    return new Response(tripPage(origin, canonical, trip, arret, now, a), { headers: HTML });
  }
  if (path === `/${INDEXNOW_KEY}.txt`) {
    return new Response(INDEXNOW_KEY, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": STATIC } });
  }
  if (path === OPENAI_CHALLENGE && defiOpenai) {
    return new Response(defiOpenai, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  if (path === "/.well-known/mcp-registry-auth") {
    return new Response(MCP_REGISTRY_AUTH, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": STATIC } });
  }
  // Whom to tell of a security flaw (web/securite.ts); the older address at the root leads to it (RFC 9116, §3).
  if (path === SECURITY_TXT) {
    return new Response(SECURITY_TEXT, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
  }
  if (path === "/security.txt") {
    return new Response(null, { status: 301, headers: { location: SECURITY_TXT, "cache-control": "public, max-age=3600" } });
  }
  // Météo-France's official map of the vigilance: its picture, its bulletin, the page of the browser (web/vigilance-carte.ts).
  if (path.startsWith("/vigilance/")) {
    const r = await carteRoute(path, url);
    if (r) return r;
  }
  // The RSMC's forecast track map, by its fingerprint (web/cmrs-carte.ts).
  if (path.startsWith("/cyclones/carte/")) {
    const r = await cmrsRoute(path);
    if (r) return r;
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
  if (path === SW_PATH) {
    // Checked again at each visit: a new version reaches the phones at once (web/pwa.ts).
    return new Response((swText ??= serviceWorker([STYLE_PATH, FONT_PATH, RELIEF_PATH, "/favicon.svg", icons["192"]])), {
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
export async function notFound(request: Request): Promise<Response> {
  const html = typo(notFoundPage(new URL(request.url).origin, new URL(request.url).pathname));
  return new Response(html, { status: 404, headers: { ...HTML, ...(await enTetes(html)) } });
}
