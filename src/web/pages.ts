/**
 * The layout shared by every page (menu of the categories, footer), and the pages of the weather and its neighbours:
 * the weather of the whole island (/meteo) and of each commune or famous place, the vigilance, the sea. The home page
 * is in home.ts, the other categories in domains.ts. Rendered on the server, live values included, so that search
 * engines and link previews see them. The only scripts copy the connector address and filter the list of places; the
 * rest is HTML and CSS.
 *
 * The weather is one category among others, but the one people search for: « météo réunion 974 », « météo cilaos
 * 974 ». « 974 » sorts La Réunion from meetings, so titles and headings carry it.
 */
import { porte } from "./aller.js";
import { resolvePlace } from "../places/resolve.js";
import { enLigne } from "./associations-drapeau.js";
import { enLigne as connecteursEnLigne } from "./connecteurs-drapeau.js";
import { softened } from "../tools/nuages.js";
import type { Cached } from "../cache.js";
import { ageMinutes, ageText, localTime, versant } from "../geo.js";
import { VERSION } from "../server.js";
import { fr } from "../tools/format.js";
import * as mf from "../providers/vigilance.js";
import { carteHero, carteHtml } from "./vigilance-carte.js";
import { current, cyclone, cycloneHead, cycloneLevel, feminine, highest, islandGreen, NONE_ISSUED, NONE_ISSUED_SAID, raised, spans } from "../tools/vigilance.js";
import type { Alerte, Credit, HomeData, PlaceData, RandonneesAnswer, SeaData, StationAnswer, StationNow } from "./data.js";
import { joursDuJour, vigilanceLue } from "./data.js";
import brand from "./brand.json" with { type: "json" };
import og from "./og.json" with { type: "json" };
import * as traces from "../providers/traces.js";
import { GAUGES } from "../providers/maregraphes.js";
import { cardReason } from "../providers/ensemble.js";
import { CITATION as TIDE_CITATION, LABEL as TIDE_LABEL } from "../maree/calcul.js";
import { farFrom, NEAR_KM, nextText, shomPort, tidesAt, tidesNear } from "../tools/maree.js";
import icons from "./icons.json" with { type: "json" };
import { hikesAround } from "./liens.js";
import rubriques from "./og-rubriques.json" with { type: "json" };
import { byUse, FIRST, type Urgent, urgentKeys, WITH_PAGE } from "./categories.js";
import { FLAG_INNER } from "./flag.js";
import { logo } from "./logo.js";
import { esc, H as MAP_H, islandMap, mapCredit, type Marker, NOMS_SCRIPT, W as MAP_W } from "./map.js";
import { LEGENDE_CSS, legende } from "./carte-legende.js";
import { ELECTRICITE_CSS } from "./electricite-carte.js";
import { typo } from "./typo.js";
import { mentionLinks } from "../mentions.js";
import { bannerHtml, ENCLOS, volcanBanner } from "./volcan-alerte.js";
import { AVIS_CSS, avisForm } from "./avis.js";
import { aide, AIDE_CSS, SIGNAL_SCRIPT } from "./signaux.js";
import { FORMS_CSS } from "./formulaires-style.js";
import { fond, FOND_CSS } from "./fonds.js";
import { POINTS_CSS, POINTS_SCRIPT } from "./carte-points.js";
import { ALTITUDES_CREDIT, communeOf, METEO_SCRIPT, RADAR_CREDIT, rainPill, stationsMap, windPill } from "./meteo-carte.js";
import { stationOf, stationPath } from "./station.js";
import { hash, INSTALL, OFFLINE_PATH, OFFLINE_SCRIPT, PWA_CSS, PWA_SCRIPT } from "./pwa.js";
import { coastal, PAGES, type PlacePage, slugify } from "./places.js";
import { bathingBlock } from "./baignade.js";
import { crumbBar, crumbs } from "./domains.js";
import { PASSES } from "../historique/cyclones-passes.js";
import { enTete } from "../tools/representativeness.js";

export const SITE = "rundata.re";
// The headings' typeface (scripts/build-font.py), a file of public/. Bump the number when the font changes: browsers
// keep it a year.
export const FONT_PATH = "/font/titres-1.woff2";
// The tagline, in Réunion Creole (« l'île en direct »); also on the og:image (scripts/build-og.py).
export const SLOGAN = `<p class="slogan" lang="${brand.slogan_lang}">${esc(brand.slogan)}</p>`;
const OG_ALT = "Symbole rundata.re et relief de l'île : La Réunion 974 en direct, Lo péï an dirèk";

// Temperatures shown as white on a colour: every stop keeps a contrast of at least 5:1.
export const STOPS: [number, number[]][] = [
  [8, [0x2a, 0x6a, 0x9a]],
  [17, [0x24, 0x78, 0x6c]],
  [24, [0x8a, 0x64, 0x10]],
  [28, [0xa8, 0x52, 0x1a]],
  [33, [0xb0, 0x30, 0x1c]],
];

export function chip(t: number): string {
  let i = 0;
  while (i < STOPS.length - 2 && t > STOPS[i + 1][0]) i++;
  const [[t0, c0], [t1, c1]] = [STOPS[i], STOPS[i + 1]];
  const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return `#${c0.map((c, j) => Math.round(c + (c1[j] - c) * k).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A list of more rows than this is folded by category (<details>), each opened with a tap, a link to one of its rows or
 * a filter that keeps some (the page's script, `unfold`); a shorter one, or a category alone, stays open.
 */
export const FOLD_ROWS = 8;
/**
 * A category of such a list: its line (`head`, an <h3> with its count), folded over its rows, or `open` and folding
 * with a tap; as it was when not `fold`.
 */
export const folded = (fold: boolean, head: string, body: string, open = false) =>
  (fold ? `<details${open ? " open" : ""}><summary>${head}</summary>${body}</details>` : head + body);
export const hm = (iso: string | Date) => localTime(new Date(iso)).split(" ")[1];

/**
 * When a copy was read, said after « de » or « à »: « de 03:12 », « à 03:12 »; another day, « du 25/10 à 03:12 »,
 * « le 25/10 à 03:12 ».
 */
export function readAt(at: Date, now: Date): { de: string; a: string } {
  const [day, time] = localTime(at).split(" ");
  return day === localTime(now).split(" ")[0] ? { de: `de ${time}`, a: `à ${time}` } : { de: `du ${day} à ${time}`, a: `le ${day} à ${time}` };
}

/**
 * « il y a 5 min », kept true in a copy of the page served minutes after it was built: the script of the layout
 * counts it again from the time of the data, in the browser.
 */
export const since = (iso: string | Date, now: Date) =>
  `<span data-age="${new Date(iso).toISOString()}">${ageText(ageMinutes(new Date(iso), now))}</span>`;

export const DATAGOUV_REUSE = "https://www.data.gouv.fr/reuses/rundata-re-la-reunion-974-en-direct-pour-vous-et-votre-assistant-ia";
// Where else rundata.re lives, linked from every footer and named in the home page's structured data.
export const GITHUB = "https://github.com/rundata-re/rundata";
export const GLAMA = "https://glama.ai/mcp/servers/rundata-re/rundata";
export const LOBEHUB = "https://lobehub.com/mcp/rundata-re-rundata";

/** An account of rundata.re: its name, its address, its logo drawn in the text colour. */
export interface Social {
  nom: string;
  /** Empty while the account is not confirmed: the entry then shows nowhere. */
  url: string;
  svg: string;
}

// rundata.re's accounts, linked from the bar of every page (the menu on phones), from the home page's hero, from every
// footer, from the line above the feedback form and from /presse, and named
// in the home page's structured data (sameAs), in this order. Another network: one more entry, its logo a 24×24 SVG.
export const SOCIAL: Social[] = [
  {
    nom: "Facebook",
    url: "https://www.facebook.com/rundata.re",
    svg: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.4c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2v2.3H7.4V14h2.8v8z"/></svg>`,
  },
  {
    nom: "Instagram",
    url: "https://www.instagram.com/rundata.re/",
    svg: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>`,
  },
  // Threads' mark from Simple Icons (CC0 1.0).
  {
    nom: "Threads",
    url: "https://www.threads.com/@rundata.re",
    svg: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z"/></svg>`,
  },
  {
    nom: "WhatsApp",
    url: "https://www.whatsapp.com/channel/0029VbEDFav5Ui2agqGyG63Q",
    svg: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3.5 20.5l1.3-4.3a8.5 8.5 0 1 1 3.1 3.1Z"/><path d="M8.7 7.6c.3-.3.8-.3 1 .1l.9 1.5c.2.3.1.7-.1.9l-.5.5c.5 1.1 1.3 1.9 2.4 2.4l.5-.5c.2-.2.6-.3.9-.1l1.5.9c.4.2.4.7.1 1l-.6.6c-.6.6-1.4.7-2.1.4a8.6 8.6 0 0 1-4.5-4.5c-.3-.7-.2-1.5.4-2.1Z" fill="currentColor" stroke="none"/></svg>`,
  },
  // The code, last: GitHub's mark (Primer Octicons, mark-github-24).
  {
    nom: "GitHub",
    url: GITHUB,
    svg: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943"/></svg>`,
  },
];

/** The accounts that have an address. */
export const followed = (list = SOCIAL) => list.filter((s) => s.url);

/** Visits from the site's own links are counted apart (src/metrics.ts); not on GitHub, which brings none back to count. */
const fromSite = (url: string) => (url === GITHUB ? url : `${url}${url.includes("?") ? "&" : "?"}ref=site`);

/** Each account as a link, its logo and its name; the logo alone in the bar, where its label names it. */
const accountLinks = (list = SOCIAL, logoOnly = false) =>
  followed(list).map((s) => `<a href="${esc(fromSite(s.url))}" rel="noopener" aria-label="rundata.re sur ${esc(s.nom)}">${s.svg}${logoOnly ? "" : esc(s.nom)}</a>`);

/** The links two by two, each group kept on one line, the last one by three when they are odd: never one left alone. */
const paired = (links: string[]) => {
  const groups: string[][] = [];
  for (let k = 0; k < links.length; k += 2) groups.push(links.slice(k, k + 2));
  if (groups.length > 1 && groups.at(-1)!.length === 1) groups.at(-2)!.push(...groups.pop()!);
  return groups.map((g) => `<span class="pair">${g.join("")}</span>`).join("");
};

/**
 * « Suivre rundata.re » and each account, with its logo and its name; nothing when none has an address. The accounts
 * go together, under the words when they do not fit beside them (a phone), rather than one left alone on a line.
 */
export function follow(list = SOCIAL, cls = "social"): string {
  const links = accountLinks(list);
  return links.length ? `<p class="${cls}">Suivre rundata.re : <span>${paired(links)}</span></p>` : "";
}

// Search engines cut (and Bing flags) a meta description over 160 characters.
export const DESCRIPTION_MAX = 160;
export const fit = (base: string, tail: string) => ((base + tail).length <= DESCRIPTION_MAX ? base + tail : base);
export const deg = (t: number) => `${fr(Math.round(t * 10) / 10)} °C`;
// The unit alone, not the start of a word (« basse mer », « 15 min »).
export const thin = (s: string) => s.replace(/ (°C|km\/h|mm|m|%)(?!\p{L})/gu, "\u202f$1");
export const metres = (m: number) => thin(`${m.toLocaleString("fr-FR")} m`);

// Line icons, 24×24, drawn in the text colour.
const ICON: Record<string, string> = {
  thermo: `<path d="M14 14.8V4a2 2 0 1 0-4 0v10.8a4 4 0 1 0 4 0Z"/><path d="M12 9v8"/>`,
  cloud: `<path d="M17.5 19H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.5 12a3.5 3.5 0 0 1-3 7Z"/><path d="M9 22l1-2M13 22l1-2"/>`,
  wave: `<path d="M2 10c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M2 16c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/>`,
  book: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z"/><path d="M20 17v4H6.5A2.5 2.5 0 0 1 4 19.5"/>`,
  mountain: `<path d="m2 20 7-12 4 6 3-4 6 10Z"/>`,
  gauge: `<path d="M4 18a9 9 0 1 1 16 0"/><path d="m12 13 4-4"/>`,
  alert: `<path d="M12 3 2 21h20Z"/><path d="M12 10v5M12 18h.01"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>`,
  volcano: `<path d="m3 20 6-10h6l6 10Z"/><path d="M10 6c0-2 1-3 2-3s2 1 2 3"/>`,
  bolt: `<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>`,
  air: `<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8"/>`,
  building: `<path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/>`,
  calendar: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`,
  map: `<path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3Z"/><path d="M9 4v13M15 7v13"/>`,
  car: `<path d="M3 13l2.2-5.5A2 2 0 0 1 7.1 6h9.8a2 2 0 0 1 1.9 1.5L21 13v4H3Z"/><path d="M3 13h18"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/>`,
  bus: `<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 18v3M16 18v3"/><path d="M8 14.5h.01M16 14.5h.01"/>`,
  grid: `<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>`,
  close: `<path d="M6 6l12 12M18 6 6 18"/>`,
  spark: `<path d="M12 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7Z"/><path d="M19 15c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z"/>`,
  pin: `<path d="M12 21s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12Z"/><circle cx="12" cy="9" r="2.5"/>`,
  bike: `<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17 9 9h6l3.5 8M9 9l3 8h-6.5M15 9l-1-3h-2.5"/>`,
  plug: `<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0Z"/><path d="M12 17v4"/>`,
  moon: `<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`,
  heart: `<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/><path d="M8 12h2l1-2 2 4 1-2h2"/>`,
  history: `<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 7v5l3 2"/>`,
  drop: `<path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>`,
  cyclone: `<path d="M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0"/><path d="M14.5 12c0-4 3-7 7-7.5M9.5 12c0 4-3 7-7 7.5M12 9.5C8 9.5 5 6.5 4.5 2.5M12 14.5c4 0 7 3 7.5 7"/>`,
  trophy: `<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4"/>`,
  news: `<path d="M4 5h13v14H6a2 2 0 0 1-2-2Z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M7 9h7M7 12h7M7 15h4"/>`,
  kids: `<circle cx="12" cy="5" r="2.5"/><path d="M12 8v7M7 11h10M9 21l3-6 3 6"/>`,
  people: `<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.4a6 6 0 0 1 3 5.6"/>`,
  key: `<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>`,
  wifi: `<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><path d="M12 19.5h.01"/>`,
  antenna: `<circle cx="12" cy="9" r="1.5"/><path d="M8.5 5.5a5 5 0 0 0 0 7M15.5 5.5a5 5 0 0 1 0 7M5.5 2.5a9 9 0 0 0 0 13M18.5 2.5a9 9 0 0 1 0 13M12 10.5 8 21M12 10.5l4 10.5M9.5 17h5"/>`,
  briefcase: `<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>`,
  doc: `<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4M9 12h6M9 15h6M9 18h4"/>`,
  music: `<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>`,
};
export const icon = (name: string) =>
  `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

export const CSS = `
@font-face{font-family:"Bricolage";src:url(${FONT_PATH}) format("woff2");font-weight:600 800;font-display:swap}
:root{--bg:#f6f2ea;--surface:#fff;--surface-2:#fbf8f2;--ink:#14202b;--muted:#5a6672;--line:#e6dece;--link:#1d4ea6;
--accent:#1d4ea6;--accent-ink:#fff;--sun:#ffcf1f;--sun-ink:#1a1500;--lave:#c0321f;--night:#0b1f36;--night-2:#15406b;
--on-night:#f1f5f9;--on-night-muted:#b4c6d8;--sea:#d5e5eb;--land:#f0e8d6;--coast:#8aaab2;--gauge-calme:#8aaab2;--border:#d8cbad;--hl:#ffe08a;--zone-on:#ffe08a;
--warn-bg:#fdeee8;--vg0:#7d8a94;--vg1:#2b8a46;--vg2:#ffd400;--vg3:#f08a00;--vg4:#c8231a;--vg5:#6b2fa8;--aq0:#7d8a94;--aq1:#50f0e6;--aq2:#50ccaa;--aq3:#f0e641;--aq4:#ff5050;--aq5:#960032;--aq6:#872181;--ren:#2b8a46;--pluie:#2456b8;--chaud:#d06a28;--frais:#2a6a9a;--soleil:#b97f00;--shadow:0 1px 2px rgb(20 32 43/.05),0 10px 30px -8px rgb(20 32 43/.12);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#08121d;--surface:#0f1d2c;--surface-2:#0c1926;--ink:#e7eef5;--muted:#9fb1c3;
--line:#1f3247;--link:#8fb4ff;--accent:#7fa8ff;--accent-ink:#081428;--sun:#ffd84d;--lave:#ff8a6b;--night:#050f1a;
--night-2:#0f2c4b;--sea:#0d2236;--land:#1a2a36;--coast:#3b6170;--gauge-calme:#56707a;--border:#2d4152;--hl:#4a3f17;--zone-on:#a8913a;--warn-bg:#2a1712;--pluie:#7aa5ff;--chaud:#ff9a52;--frais:#6cb4ee;--soleil:#ffd84d;
--shadow:0 1px 2px rgb(0 0 0/.3),0 10px 30px -8px rgb(0 0 0/.5);color-scheme:dark}}
*{box-sizing:border-box}
html{scroll-padding-top:5rem;-webkit-text-size-adjust:100%}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
font-variant-numeric:tabular-nums}
a{color:var(--link);text-underline-offset:.18em;text-decoration-thickness:1px}
h1,h2,h3{font-family:Bricolage,"Avenir Next","Segoe UI Variable Display",system-ui,sans-serif;line-height:1.08;
text-wrap:balance;margin:0;font-weight:800}
h1{font-size:clamp(2.2rem,6.4vw,4rem);letter-spacing:-.03em}
h2{font-size:clamp(1.6rem,4vw,2.4rem);letter-spacing:-.02em}
h3{font-size:1.12rem;font-weight:700;letter-spacing:-.005em}
p,ul,ol,table,figure{margin:0}
.wrap{max-width:72rem;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.ic{width:1.4em;height:1.4em;flex:none}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* A section's colour is never one of the alert scale (yellow, orange, red, purple) nor a red: those say a real state
   (kit.md). The sections of risks share one neutral colour. */
.k-meteo{--k:#ff9f43}.k-vigilance,.k-crues,.k-volcan,.k-cyclones,.k-secheresse{--k:#4fd1c5}.k-actualites{--k:#a5d8ff}.k-mer{--k:#22b8cf}.k-bus{--k:#4dabf7}.k-velos{--k:#51cf66}.k-bornes{--k:#94d82d}.k-eau{--k:#3bc9db}.k-coupures{--k:#74c0fc}.k-dae{--k:#40c057}.k-sentiers{--k:#69db7c}.k-sport{--k:#ffa94d}.k-historique{--k:#e599f7}.k-agenda{--k:#da77f2}.k-enfants{--k:#f06595}.k-emploi{--k:#20c997}.k-antennes{--k:#ced4da}.k-marches{--k:#748ffc}
.k-air{--k:#38d9a9}.k-electricite{--k:#fab005}.k-calendrier{--k:#b197fc}.k-associations{--k:#f472d0}.k-communes{--k:#f783ac}.k-services{--k:#74c0fc}.k-trafic{--k:#91a7ff}.k-terrain{--k:#d8a65a}
.kb{display:grid;place-items:center;width:2.6rem;height:2.6rem;border-radius:12px;flex:none;color:var(--k);
background:linear-gradient(155deg,color-mix(in srgb,var(--k) 20%,transparent),color-mix(in srgb,var(--k) 9%,transparent));
box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--k) 32%,transparent)}
.kb .ic{width:1.35rem;height:1.35rem}
header.top{position:sticky;top:0;z-index:20;background:rgb(7 22 38/.78);-webkit-backdrop-filter:saturate(1.6) blur(14px);backdrop-filter:saturate(1.6) blur(14px);
border-bottom:1px solid rgb(255 255 255/.07);color:var(--on-night)}
.bar{display:flex;align-items:center;gap:.6rem;min-height:3.6rem;padding-block:.45rem}
.brand{display:flex;align-items:center;gap:.6rem;font:800 1.2rem/1 Bricolage,system-ui,sans-serif;color:inherit;text-decoration:none;letter-spacing:-.02em;margin-right:auto}
.brand .tld{color:var(--sun)}
.logo{width:1.55rem;height:1.55rem;flex:none}
.quick{display:none}
@media (min-width:62rem){.quick{display:flex;gap:.15rem}.quick a{display:flex;align-items:center;gap:.35rem;color:var(--on-night-muted);text-decoration:none;
padding:.45rem .55rem;border-radius:12px;font-size:.93rem;font-weight:600}.quick a .ic{width:1.1rem;height:1.1rem;color:var(--k)}
.quick a:hover{color:#fff;background:rgb(255 255 255/.08)}.quick a[aria-current]{color:#fff;background:rgb(255 255 255/.12)}}
@media (min-width:62rem){.quick:has(>:nth-child(5)) .ic{display:none}}
@media (min-width:75rem){.quick:has(>:nth-child(5)) .ic{display:block}.quick:has(>:nth-child(6)) .ic{display:none}}
.cta-ia{display:inline-flex;align-items:center;gap:.4rem;padding:.55rem .95rem;border-radius:14px;background:var(--sun);color:var(--sun-ink);
font:800 .95rem/1 system-ui,sans-serif;text-decoration:none;box-shadow:0 6px 18px -6px rgb(255 207 31/.55);white-space:nowrap}
.cta-ia .ic{width:1.05rem;height:1.05rem}
.menu{position:static}
.menu summary{list-style:none;display:grid;place-items:center;width:2.6rem;height:2.6rem;border-radius:14px;cursor:pointer;
background:rgb(255 255 255/.08);border:1px solid rgb(255 255 255/.12);color:#fff}
.menu summary::-webkit-details-marker{display:none}
.menu summary .ic{width:1.3rem;height:1.3rem;display:block}.menu summary span{display:grid;place-items:center}
.menu summary .x,.menu[open] summary .g{display:none}.menu[open] summary .x{display:block}
.menu summary:focus-visible{outline:2px solid var(--sun);outline-offset:2px}
.sheet{position:absolute;left:0;right:0;top:100%;background:#071626;
border-bottom:1px solid rgb(255 255 255/.08);box-shadow:0 30px 60px -20px rgb(0 0 0/.7);max-height:calc(100dvh - 3.6rem);overflow:auto}
@media (prefers-reduced-motion:no-preference){.menu[open] .sheet{animation:drop .22s ease-out}}
@keyframes drop{from{opacity:0;transform:translateY(-8px)}}
.sheet .wrap{padding-block:1rem 1.4rem;display:grid;gap:.9rem}
.sheet-h{font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--on-night-muted)}
.follow-top{display:none}
@media (min-width:75rem){.follow-top{display:flex;gap:.1rem}.follow-top a{display:grid;place-items:center;width:2.4rem;height:2.4rem;border-radius:12px;color:var(--on-night-muted)}
.follow-top a:hover{color:#fff;background:rgb(255 255 255/.08)}.follow-top svg{width:24px;height:24px}}
.follow-top a:focus-visible,.social a:focus-visible{outline:2px solid var(--sun);outline-offset:2px;border-radius:6px}
.sheet .social{gap:.5rem 1.4rem}.sheet .social a{color:var(--on-night);font-weight:600;text-decoration:none}.sheet .social svg{width:24px;height:24px}
@media (max-width:30rem){.sheet .social{gap:.5rem .9rem}.sheet .social a{font-size:.95rem}.sheet .social svg{width:22px;height:22px}}
/* The menu's tiles: all the same size, room for a name on two lines, icon and name centred alike. The sheet is night
   in both themes: the night's surface and shadow. */
/* Three columns at least, on the narrowest phones too. */
.grid{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(7rem,calc((100% - 1.2rem) / 3)),1fr));gap:.6rem}
.grid a{display:grid;grid-template-rows:auto calc(2 * 1.2em);justify-items:center;align-content:start;gap:.55rem;height:100%;
padding:.9rem .25rem .8rem;border-radius:16px;text-decoration:none;color:var(--on-night);font-size:.88rem;font-weight:600;line-height:1.2;
text-align:center;background:#0f1d2c;border:1px solid rgb(255 255 255/.07);transition:border-color .15s,box-shadow .15s,transform .15s}
.grid .gn{display:flex;align-items:center;max-width:100%;overflow-wrap:normal}
.grid a:hover{border-color:color-mix(in srgb,var(--k) 50%,transparent);box-shadow:0 1px 2px rgb(0 0 0/.3),0 10px 30px -8px rgb(0 0 0/.5);transform:translateY(-2px)}
.grid a:active{transform:translateY(0) scale(.98)}
.grid a:focus-visible{outline:2px solid #ffcf1f;outline-offset:2px}
.grid a[aria-current]{background:color-mix(in srgb,var(--k) 14%,#0f1d2c);border-color:color-mix(in srgb,var(--k) 45%,transparent)}
@media (max-width:30rem){.grid a{font-size:.82rem;letter-spacing:-.005em}}
@media (prefers-reduced-motion:reduce){.grid a,.grid a:hover,.grid a:active{transform:none;transition:none}}
.sheet .connect{background:rgb(255 255 255/.06);border-color:rgb(255 255 255/.1);box-shadow:none}
.sheet .connect code{color:var(--on-night)}
.sheet .sheet-app{color:var(--on-night);font-weight:600}

.band{position:relative;overflow:hidden;color:var(--on-night);
background:linear-gradient(160deg,var(--night) 0%,var(--night-2) 100%)}
.band::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.9;
background:repeating-conic-gradient(from -90deg at 78% 115%,rgb(255 207 31/.09) 0 5deg,transparent 5deg 16deg);
-webkit-mask:radial-gradient(70% 90% at 78% 110%,#000 20%,transparent 75%);mask:radial-gradient(70% 90% at 78% 110%,#000 20%,transparent 75%)}
.band>.wrap{position:relative}
.band a{color:#fff}
.intro{display:grid;gap:2.2rem;align-items:center;padding-block:clamp(2rem,6vw,4.5rem) 2rem}
@media (min-width:58rem){.intro{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)}}
.intro.solo{grid-template-columns:minmax(0,1fr)}.intro.solo h1{max-width:52rem}.intro.solo .pitch>p{max-width:40rem}
.pitch{display:grid;gap:1.1rem;justify-items:start;min-width:0}
.pill{display:inline-flex;align-items:center;gap:.45rem;font-size:.82rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
padding:.3rem .8rem;border-radius:999px;background:rgb(255 255 255/.1);border:1px solid rgb(255 255 255/.18);color:var(--on-night)}
.dot{width:.5rem;height:.5rem;border-radius:50%;background:#3ee08f;box-shadow:0 0 0 0 rgb(62 224 143/.6);flex:none}
@media (prefers-reduced-motion:no-preference){.dot{animation:pulse 2s infinite}}
@keyframes pulse{70%{box-shadow:0 0 0 .5rem rgb(62 224 143/0)}100%{box-shadow:0 0 0 0 rgb(62 224 143/0)}}
.n974{color:var(--sun)}
.slogan{font:italic 700 clamp(1.15rem,3vw,1.5rem)/1.3 Bricolage,system-ui,sans-serif;color:var(--sun)}
.lead{font-size:1.14rem;color:var(--on-night-muted);max-width:36rem}
.lead b{color:var(--on-night)}
.share{padding-bottom:1.2rem}.share .card{display:flex;flex-wrap:wrap;gap:.6rem 1.2rem;align-items:center;max-width:44rem}.share p{margin:0}
.sh{display:inline-flex;align-items:center;gap:.4rem;font-weight:700;text-decoration:none;border-radius:999px;padding:.55rem 1rem}.sh svg{width:1rem;height:1rem}
.sh.wa{background:#25d366;color:#06281a}
.hook{font-size:1.08rem;font-weight:600;color:var(--on-night);max-width:36rem;margin-top:-.4rem}
.works{font-size:.92rem;color:var(--on-night-muted)}
.works b{color:var(--on-night);font-weight:600}

.connect{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;background:var(--surface);border:1px solid var(--line);
border-radius:18px;padding:.4rem .4rem .4rem 1rem;max-width:100%;box-shadow:var(--shadow)}
.connect code{font:600 1.05rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink);overflow-wrap:break-word;flex:1 1 12rem;min-width:0}
.connect button{font:700 1rem system-ui,sans-serif;background:var(--sun);color:var(--sun-ink);border:0;border-radius:14px;
padding:.65rem 1.2rem;cursor:pointer;transition:transform .15s}
.connect button:hover{transform:translateY(-1px)}
.band .connect{border-color:transparent;font-size:1.05rem}

.chat{background:var(--surface);color:var(--ink);border-radius:24px;padding:1.2rem;display:grid;gap:.7rem;box-shadow:0 30px 60px -20px rgb(0 0 0/.5);min-width:0}
.chat .who{font-size:.78rem;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;display:flex;align-items:center;gap:.5rem}
.bubble{border-radius:18px;padding:.65rem 1rem;max-width:92%}
.bubble.me{justify-self:end;background:var(--accent);color:var(--accent-ink);border-bottom-right-radius:6px}
.bubble.ai{justify-self:start;background:var(--surface-2);border:1px solid var(--line);border-bottom-left-radius:6px}
.call{justify-self:start;font:.8rem ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);background:var(--surface-2);
border:1px dashed var(--line);border-radius:8px;padding:.2rem .55rem}
@media (prefers-reduced-motion:no-preference){.chat>*{animation:up .5s both}.chat>:nth-child(2){animation-delay:.3s}
.chat>:nth-child(3){animation-delay:1s}.chat>:nth-child(4){animation-delay:1.7s}}
@keyframes up{from{opacity:0;transform:translateY(8px)}}

.ticker{list-style:none;padding:0 0 2rem;display:flex;flex-wrap:wrap;gap:.5rem}
.ticker li{display:flex;align-items:center;gap:.45rem;font-size:.92rem;padding:.35rem .85rem;border-radius:999px;background:rgb(255 255 255/.08);
border:1px solid rgb(255 255 255/.12)}
.ticker b{font-weight:700;color:#fff}
.ticker .vg,.ticker .aq{font-size:.82rem;padding:0 .45rem}

main{display:grid;gap:clamp(3.5rem,8vw,6rem);padding-block:clamp(2.5rem,6vw,4.5rem)}
section{display:grid;gap:1.4rem;min-width:0}
.sec-h{display:grid;gap:.5rem;max-width:44rem}
.eyebrow{font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--lave)}
.sec-h p:not(.eyebrow){color:var(--muted);font-size:1.05rem}
.card{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:1.3rem;display:grid;gap:.8rem;min-width:0;box-shadow:var(--shadow)}
.note{font-size:.86rem;color:var(--muted)}
/* On the band's night, its own grey: --muted is the grey of a white page. */
.band .note{color:var(--on-night-muted)}
.sources{margin:0 0 .3rem;font-size:.75rem;line-height:1.35;color:var(--muted)}
.fin-sources{padding-block:.6rem 1.2rem}

.steps{list-style:none;padding:0;display:grid;gap:1rem}
@media (min-width:58rem){.steps{grid-template-columns:minmax(0,1fr) minmax(0,2fr) minmax(0,1fr)}}
.step{align-content:start}
.num{display:grid;place-items:center;width:2.4rem;height:2.4rem;border-radius:12px;background:var(--night);color:var(--sun);
font:800 1.2rem Bricolage,system-ui,sans-serif}
.step .connect{box-shadow:none;background:var(--surface-2)}
/* The address on one line in a step of three columns (270 px); after its « / » otherwise. */
.step .connect code{font-size:.92rem}
.tabs{display:flex;flex-wrap:wrap;gap:.35rem}
.tabs input{position:absolute;opacity:0;pointer-events:none}
.tabs label{font-size:.9rem;font-weight:600;padding:.3rem .8rem;border-radius:999px;border:1px solid var(--line);cursor:pointer;color:var(--muted)}
.tabs input:checked+label{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.tabs input:focus-visible+label{outline:2px solid var(--link);outline-offset:2px}
.tab{flex-basis:100%;display:none;padding-top:.4rem;font-size:.93rem;line-height:1.55}
#app-chatgpt:checked~.t-chatgpt,#app-claude:checked~.t-claude,#app-gemini:checked~.t-gemini,#app-meta:checked~.t-meta,#app-lechat:checked~.t-lechat,#app-local:checked~.t-local{display:grid;gap:.6rem}
.tab a{font-weight:600}
.askbox{display:grid;gap:.6rem;justify-items:start;min-width:0}
.askt{font:800 clamp(1.4rem,3.6vw,1.8rem)/1.1 Bricolage,system-ui,sans-serif;letter-spacing:-.01em}
.band .askt{color:#fff}
.ask{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.ask a,.band .ask a,.cta .ask a{display:inline-flex;align-items:center;gap:.45rem;padding:.75rem 1.3rem;border-radius:16px;font-weight:800;font-size:1.05rem;
text-decoration:none;background:var(--sun);color:var(--sun-ink);box-shadow:var(--shadow);transition:transform .15s}
.ask a:hover{transform:translateY(-1px)}
@media (max-width:480px){.ask{gap:.4rem}.ask a,.band .ask a,.cta .ask a{padding:.7rem .85rem;font-size:.98rem;gap:.3rem}}
.ask svg{width:1em;height:1em}
.askbox>[data-l]{display:grid;gap:.6rem;justify-items:start}
.askbox>[hidden]{display:none}
.askq{font-size:.85rem;font-style:italic;color:var(--muted);max-width:34rem}
.askn{font-size:.85rem;color:var(--muted);max-width:34rem}
.copie{font-size:.9rem;font-weight:700;max-width:34rem}
.band .askq,.band .askn{color:var(--on-night-muted)}
.lang{display:inline-flex;gap:.2rem;padding:.2rem;border-radius:999px;border:1px solid var(--line)}
.band .lang{border-color:rgb(255 255 255/.22)}
.lang button{display:inline-flex;align-items:center;gap:.4rem;font:600 .88rem/1 system-ui,sans-serif;padding:.4rem .8rem;border:0;border-radius:999px;
background:none;color:var(--muted);cursor:pointer}
.band .lang button{color:var(--on-night-muted)}
.lang button[aria-pressed=true]{background:var(--ink);color:var(--bg)}
.band .lang button[aria-pressed=true]{background:var(--on-night);color:var(--night)}
.lang button:focus-visible{outline:2px solid var(--link);outline-offset:2px}
.lang svg{width:1.35em;height:.9em;border-radius:2px;box-shadow:0 0 0 1px rgb(0 0 0/.15)}
.or{font-size:.92rem;color:var(--muted)}
.band .or{color:var(--on-night-muted)}
.easy{border:2px solid var(--sun)}
.tab code{font:.92em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:.1rem .4rem;overflow-wrap:anywhere}
.qs{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:.45rem}
.qs li{font-size:.93rem;padding:.4rem .85rem;border-radius:16px 16px 16px 4px;background:var(--surface-2);border:1px solid var(--line)}
.tiles{list-style:none;padding:0;display:grid;gap:.7rem;grid-template-columns:repeat(2,minmax(0,1fr))}
@media (min-width:46rem){.tiles{grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}}
@media (min-width:66rem){.tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}
.tile.wide{grid-column:span 2}
/* A commune's tiles, packed (commune.ts spans): each tile's span at 2, 3 and 4 columns, a list on a whole row. */
.tiles.fit{grid-auto-flow:row dense}
.tiles.fit>.tile{grid-column:span var(--s2,1)}
@media (min-width:46rem){.tiles.fit>.tile{grid-column:span var(--s3,1)}}
@media (min-width:66rem){.tiles.fit>.tile{grid-column:span var(--s4,1)}}
.tile .rows.cols{grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));column-gap:1.5rem}
.tile .rows.cols li:first-child{border-top:1px solid var(--line)}
.rows.velos li{grid-template-columns:minmax(0,1fr) auto;align-items:center}
.rows.velos small{display:block;font-size:.88rem;margin-top:.1rem}
@media (max-width:46rem){.tile.odd{grid-column:span 2}}
.tile{position:relative;display:flex;flex-direction:column;gap:.3rem;padding:.95rem;border-radius:22px;min-width:0;overflow:hidden;
background:linear-gradient(155deg,color-mix(in srgb,var(--k) 13%,var(--surface)) 0%,var(--surface) 58%);
border:1px solid color-mix(in srgb,var(--k) 22%,var(--line));box-shadow:var(--shadow);transition:transform .18s,border-color .18s,box-shadow .18s}
.tile::after{content:"";position:absolute;right:-2.5rem;top:-2.5rem;width:7rem;height:7rem;border-radius:50%;pointer-events:none;
background:radial-gradient(closest-side,color-mix(in srgb,var(--k) 22%,transparent),transparent)}
.tile:has(h3 a):hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--k) 60%,transparent);box-shadow:0 18px 40px -18px color-mix(in srgb,var(--k) 55%,transparent)}
.th{display:flex;align-items:center;gap:.55rem;margin-bottom:.35rem}
.th h3{font-size:.95rem;font-weight:700;flex:1;min-width:0}
.th{flex-wrap:wrap}.th h3{order:1;flex:1 0 100%}.th .go{margin-left:auto}
@media (min-width:46rem){.th{flex-wrap:nowrap}.th h3{order:0;flex:1}.th .go{margin-left:0}}
.th .kb{width:2.3rem;height:2.3rem;border-radius:12px}
.th .go{color:var(--k);font-weight:800}
.tile h3 a{color:inherit;text-decoration:none}
.tile h3 a::after{content:"";position:absolute;inset:0;border-radius:22px;z-index:1}
.tile h3 a:focus-visible{outline:none}.tile:has(h3 a:focus-visible){outline:2px solid var(--link);outline-offset:2px}
.tv{font:800 clamp(1.15rem,4.6vw,1.5rem)/1.12 Bricolage,system-ui,sans-serif;letter-spacing:-.015em;overflow-wrap:anywhere}
.tv .vg,.tv .aq{font:inherit;font-size:.95rem;padding:.15rem .6rem;vertical-align:.12em}
.td{font-size:.84rem;line-height:1.4;color:var(--muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.td.all{display:block;overflow:visible}
.tq{font-size:.92rem;font-style:italic;align-self:flex-start;padding:.4rem .85rem;border-radius:16px 16px 16px 4px;background:var(--surface-2);border:1px solid var(--line)}
.ta{display:none}
@media (min-width:66rem){.ta{display:block;font-size:.86rem;line-height:1.45;color:var(--muted);padding-top:.5rem;margin-top:auto;border-top:1px solid var(--line)}}
.tl{position:relative;z-index:2;font-weight:700;font-size:.9rem;margin-top:.2rem}

.hero{position:relative;z-index:1;overflow:hidden;color:#fff;--sky1:#050f1a;--sky2:#0f2c4b;--glow:rgb(255 207 31/.0);
background:radial-gradient(120% 70% at 80% 100%,var(--glow),transparent 60%),linear-gradient(180deg,var(--sky1) 0%,var(--sky2) 100%)}
.sky-nuit{--sky1:#030a14;--sky2:#0c2a4a;--glow:rgb(76 110 245/.25)}
.sky-aube{--sky1:#1b2452;--sky2:#d96b5a;--glow:rgb(255 190 120/.55)}
.sky-jour{--sky1:#0a5b9c;--sky2:#20a4c8;--glow:rgb(255 236 170/.35)}
.sky-soir{--sky1:#231a52;--sky2:#e0703f;--glow:rgb(255 140 80/.5)}
.sky-nuit::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.7;
background-image:radial-gradient(1.2px 1.2px at 12% 18%,#fff,transparent),radial-gradient(1px 1px at 28% 8%,#fff,transparent),radial-gradient(1.4px 1.4px at 46% 22%,#fff,transparent),
radial-gradient(1px 1px at 63% 12%,#fff,transparent),radial-gradient(1.3px 1.3px at 82% 26%,#fff,transparent),radial-gradient(1px 1px at 92% 6%,#fff,transparent),
radial-gradient(1px 1px at 6% 42%,#fff,transparent),radial-gradient(1.2px 1.2px at 38% 38%,#fff,transparent),radial-gradient(1px 1px at 74% 44%,#fff,transparent)}
@media (prefers-reduced-motion:no-preference){.sky-nuit::before{animation:twinkle 6s ease-in-out infinite alternate}}
@keyframes twinkle{to{opacity:.35}}
.band:has(.hero)::before{display:none}
.hero-in{position:relative;display:grid;gap:1.6rem;padding-block:clamp(1.8rem,5vw,4rem) clamp(1.6rem,4vw,3.4rem);align-items:center}
@media (min-width:58rem){.hero-in{grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:3rem}}
.hero-txt{display:grid;gap:1rem;justify-items:start;min-width:0}
.hero h1{font-size:clamp(2.6rem,10vw,4.6rem);line-height:.98;letter-spacing:-.04em;text-shadow:0 2px 30px rgb(0 0 0/.25)}
.hero .lead{color:rgb(255 255 255/.82);font-size:clamp(1.02rem,3.6vw,1.2rem);max-width:32rem}
.hero .lead b{color:#fff}
.live-pill{display:inline-flex;align-items:center;gap:.5rem;font-size:.85rem;padding:.35rem .85rem;border-radius:999px;
background:rgb(255 255 255/.12);border:1px solid rgb(255 255 255/.2);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.hero-cta{display:flex;flex-wrap:wrap;gap:.6rem;width:100%;max-width:30rem}.hero-cta .btn{flex:1 1 auto;justify-content:center}
.hero-follow{font-size:.9rem;color:rgb(255 255 255/.78)}.hero-follow a{color:#fff}
.btn{display:inline-flex;align-items:center;gap:.5rem;padding:.85rem 1.25rem;border-radius:16px;font:800 1rem/1 system-ui,sans-serif;text-decoration:none;transition:transform .15s,box-shadow .15s}
.btn .ic{width:1.15rem;height:1.15rem}
.btn:hover{transform:translateY(-2px)}
.btn.sun,.band .btn.sun{background:var(--sun);color:var(--sun-ink);box-shadow:0 12px 30px -10px rgb(255 207 31/.7)}
.clubs{border-left:4px solid var(--sun)}.clubs h2{font-size:clamp(1.15rem,3.2vw,1.4rem);line-height:1.2}.clubs p{margin:0}.clubs-go{display:flex;flex-wrap:wrap;align-items:center;gap:.7rem 1.2rem}.clubs-top a{color:var(--sun);font-weight:700}
.btn.glass,.band .btn.glass{color:#fff;background:rgb(255 255 255/.12);border:1px solid rgb(255 255 255/.25);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.facts-live{list-style:none;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:1fr;gap:.5rem;width:100%;max-width:34rem}
.facts-live li{display:flex}
.facts-live a{flex:1;display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto auto;align-content:center;column-gap:.55rem;align-items:center;padding:.6rem .75rem;border-radius:16px;
text-decoration:none;color:#fff;background:rgb(255 255 255/.09);border:1px solid rgb(255 255 255/.14);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.facts-live .ic{grid-row:span 2;color:var(--k);width:1.4rem;height:1.4rem}
.facts-live a>span{font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:rgb(255 255 255/.7)}
.facts-live b{font:800 .98rem/1.2 Bricolage,system-ui,sans-serif;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.facts-live b .vg,.facts-live b .aq{font-size:.8rem;padding:0 .45rem}
.facts-live small{grid-column:2;font-size:.74rem;line-height:1.25;color:rgb(255 255 255/.7)}
.facts-live li:last-child:nth-child(odd){grid-column:1/-1}
@media (max-width:599.98px){.facts-live a{padding:.45rem .6rem;column-gap:.45rem}.facts-live .ic{width:1.2rem;height:1.2rem}
.facts-live a>span{font-size:.7rem}.facts-live small{font-size:.7rem;line-height:1.2}}
.hero-map{position:relative;display:grid;gap:.6rem;min-width:0;width:100%;max-width:30rem;justify-self:center}
@media (min-width:66rem){.hero-map{max-width:36rem}}
.hero-map .map{filter:drop-shadow(0 30px 40px rgb(0 0 0/.35))}
.map.relief .halo{fill:#4fd1c5;opacity:.55}
.map.relief .coast{fill:none;stroke:#7ee8e0;stroke-width:6;stroke-linejoin:round;opacity:.9}
.map.relief .ground{fill:#5f9e6a}
.map.relief .pk path{fill:#fff;opacity:.85}
.map.relief .pk text{fill:#fff;font-size:22px;font-weight:600;opacity:.8;paint-order:stroke;stroke:rgb(0 0 0/.35);stroke-width:5px}
.map.relief .mk circle{stroke:#fff;stroke-width:5}
.map.relief .mk{filter:drop-shadow(0 6px 8px rgb(0 0 0/.35))}
.map.relief .mn{display:none}
@media (max-width:40rem){.map.relief .pk{display:block}.map.relief .pk text{display:none}}
@media (prefers-reduced-motion:no-preference){.hero .map .mk{animation:pop .5s both}.hero .map .mk:nth-of-type(3n){animation-delay:.15s}.hero .map .mk:nth-of-type(3n+1){animation-delay:.3s}}
@keyframes pop{from{opacity:0;transform:translateY(6px)}}
.hero-map figcaption{display:flex;align-items:center;justify-content:center;gap:.5rem;font-size:.82rem;color:rgb(255 255 255/.75);text-align:center;flex-wrap:wrap}
.hero-map figcaption a{color:#fff}
.duo{display:grid;gap:1rem;align-items:start}
@media (min-width:58rem){.duo{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
.duo .chat{box-shadow:var(--shadow);border:1px solid var(--line)}
@media (max-width:40rem){main{gap:2.8rem}.sec-h p:not(.eyebrow){font-size:.98rem}}
.facts{display:flex;flex-wrap:wrap;gap:.5rem}
.facts span{font-size:.92rem;padding:.35rem .85rem;border-radius:999px;background:var(--surface);border:1px solid var(--line)}
.live{display:grid;gap:1rem;align-items:start}
@media (min-width:58rem){.live{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}.live .mapcard{position:sticky;top:5rem}}
.map{width:100%;height:auto;display:block}
.map .sea{fill:var(--sea)}.map .coast{fill:none;stroke:var(--coast);stroke-width:9;stroke-linejoin:round}
.map .land{fill:var(--land)}.map .borders{fill:none;stroke:var(--border);stroke-width:1.6}
.map .hl{fill:var(--hl);stroke:var(--accent);stroke-width:3}
.map.terrain .borders{stroke:rgb(255 255 255/.28);stroke-width:1.2}
.map.terrain .hl{fill:rgb(255 224 138/.28);stroke:#ffd43b;stroke-width:5}
.map.terrain .mn,.map.terrain .pk text,.map.terrain .pin text{fill:#fff;stroke:rgb(10 30 40/.75)}
.map.terrain .pk path{fill:#fff}
.map.zoom .coast{stroke-width:3px;vector-effect:non-scaling-stroke}
.map .rd{pointer-events:none}.map .rd use{fill:none;stroke-linecap:round;stroke-linejoin:round}
.map .rd .rh{stroke:rgb(11 31 54/.45);stroke-width:3.5px}.map .rd .rt{stroke:#f6f2ea;stroke-width:2px;opacity:.9}
.map .rd .dp.rh{stroke-width:2.25px}.map .rd .dp.rt{stroke-width:1.25px}.wxmap .map .rd .rt{opacity:.7}
.map .nm{pointer-events:none}.map .nm text{fill:#f1f5f9;stroke:rgb(11 31 54/.75);paint-order:stroke;stroke-linejoin:round;font-weight:500;dominant-baseline:central;text-rendering:geometricPrecision}
.map .nm [data-r="0"]{font-weight:600}.map .nm .nx{display:none}
.map .cn text{fill:#f1f5f9;stroke:rgb(11 31 54/.8);stroke-width:8px;paint-order:stroke;stroke-linejoin:round;font-weight:600;text-anchor:middle;dominant-baseline:central;text-rendering:geometricPrecision}
.map .cn .hit{fill:transparent;stroke:none}.map .cn a:hover text,.map .cn a.on text,.map .cn a:focus-visible text{fill:var(--sun)}.map .zn.on path{fill:rgb(255 255 255/.14);stroke:var(--sun);stroke-width:4}
@media (max-width:37.49rem){.mapcard.noms{padding:.4rem}}
.map .cn .tie{pointer-events:none}.map .cn .tie path{fill:none;stroke:#f1f5f9;stroke-width:3px;stroke-linecap:round}.map .cn .tie circle{fill:#f1f5f9;stroke:rgb(11 31 54/.8);stroke-width:3px}
.map .trk{fill:none;stroke:#ff922b;stroke-width:4px;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.map .trk.ouvert{stroke:#ffd43b}.map .trk.ferme{stroke:#ff6b6b;stroke-dasharray:6 5}.map .trk.inconnu{stroke:#ced4da}
.map .trk-halo{fill:none;stroke:rgb(10 30 40/.7);stroke-width:8px;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.map .trk-start{fill:none;stroke:#0b1f36;stroke-width:12px;stroke-linecap:round;vector-effect:non-scaling-stroke}.map .trk-start.in{stroke:#fff;stroke-width:8px}
.f-jeux{--c:#f76707}.f-nature{--c:#37b24d}.f-eau{--c:#1c7ed6}.f-culture{--c:#9775fa}.f-sport{--c:#fab005}
.map[data-zoom]{touch-action:pan-y;user-select:none;-webkit-user-select:none}.map[data-zoom].zoomed{touch-action:none;cursor:grab}
.map.commune .dim{fill:rgb(10 30 40/.5);stroke:none}.map.commune .hl{fill:none;stroke:#ffd43b;stroke-width:2.5px;vector-effect:non-scaling-stroke}
.map.commune .hit{fill:transparent;stroke:none}.map.commune .rg,.map.commune .pt{fill:none;stroke-linecap:round;vector-effect:non-scaling-stroke}
.map.commune .rg{stroke:#fff;stroke-width:16px}.map.commune .pt{stroke:var(--c);stroke-width:11px}
.map.commune .sp.on .rg{stroke:#0b1f36;stroke-width:26px}.map.commune .sp.on .pt{stroke-width:18px}.map.commune .sp.off{display:none}
.map.commune .sp:focus-visible .rg{stroke:var(--accent);stroke-width:24px}
.ksw{display:inline-block;width:.8rem;height:.8rem;border-radius:50%;background:var(--c);border:2px solid #fff;box-shadow:0 0 0 1px rgb(0 0 0/.3);vertical-align:-.1rem;margin-right:.3rem;flex:none}
.kchips{display:flex;gap:.4rem;margin:0 -1rem .8rem;padding:0 1rem .2rem;overflow-x:auto;scrollbar-width:none}.kchips::-webkit-scrollbar{display:none}.kchips label{position:relative;flex:none;white-space:nowrap;display:inline-flex;align-items:center;gap:.2rem;min-height:44px;padding:.35rem .75rem;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink);font-size:.92rem;cursor:pointer}
.kchips input{position:absolute;opacity:0;pointer-events:none}.kchips label:has(input:checked){border-color:var(--accent);background:var(--hl);font-weight:700}.kchips label:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}.kchips .n{color:var(--muted);font-size:.85rem;margin-left:.2rem}
.ecarte .mapcard{position:static;padding:.5rem}.kzoom{display:flex;gap:.4rem;margin:.5rem 0 0}.kzoom button{min-width:44px;min-height:44px;font:inherit;font-size:1.05rem;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);cursor:pointer}.kzoom button[data-z="0"]{font-size:.9rem;padding:0 .8rem;margin-left:auto}.kzoom button:disabled{opacity:.45;cursor:default}
.fonds{margin:.5rem 0 0}.fonds label{padding:.3rem .5rem;white-space:nowrap}.fd-w{position:absolute;z-index:1;margin:0;padding:.15rem .55rem;border-radius:999px;background:rgb(11 31 54/.72);color:#fff;font-size:.8rem;pointer-events:none}.fd-w:empty{display:none}.map.fd-plan .rd,.map.fd-plan .nm{display:none}@media (prefers-color-scheme:dark){.map.fd-plan .fd{filter:brightness(.75)}}
.klegend{display:flex;flex-wrap:wrap;gap:.3rem 1rem;margin:.5rem 0 0}.klegend span{display:inline-flex;align-items:center}
.ksheet{position:relative;margin-top:.8rem;padding-right:3rem}.ksheet .nm{font-weight:700;font-size:1.05rem;margin:0}.ksheet .x{position:absolute;top:.4rem;right:.4rem;width:44px;height:44px;font-size:1.4rem;border:0;background:none;color:var(--ink);cursor:pointer}
.aller{display:inline-flex;align-items:center;gap:.35rem;min-height:40px;padding:0 .8rem;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);font-weight:600;font-size:.9rem;text-decoration:none;white-space:nowrap}.aller::before{content:"";width:1rem;height:1rem;background:var(--accent);clip-path:polygon(12.5% 45.8%,87.5% 12.5%,54.2% 87.5%,45.8% 54.2%)}
li .l2{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:.3rem .6rem;flex-wrap:wrap}li .l2 .age{text-align:left;max-width:none}li .l2>span{min-width:0;flex:1 1 12rem}li .l2 small{display:inline;margin:0}li .l2 .adr{color:var(--muted)}
.aller-f{border:0;padding:0;margin:auto auto 0;width:100%;max-width:min(32rem,100%);border-radius:18px 18px 0 0;background:var(--surface);color:var(--ink);box-shadow:0 -8px 30px rgba(0,0,0,.35)}.aller-f::backdrop{background:rgba(0,0,0,.45)}.aller-f>div{padding:1rem 1rem max(1.4rem,env(safe-area-inset-bottom))}.aller-f h2{font-size:1.05rem;margin:0 0 .2rem}.aller-f .note{margin:0}.aller-f ul{list-style:none;margin:.7rem 0 0;padding:0;display:grid;gap:.5rem}.aller-f li a,.aller-f li button{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:48px;padding:0 1rem;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);color:var(--ink);font:inherit;font-weight:600;text-decoration:none;cursor:pointer;text-align:left}.aller-f .ok{margin-top:.5rem;min-height:1.3em}.aller-f .x{display:block;width:100%;min-height:44px;margin-top:.2rem;border:0;background:none;color:var(--ink);font:inherit;cursor:pointer}@media (min-width:600px){.aller-f{margin:auto;border-radius:18px}}
#ecl li .end{display:flex;align-items:center;gap:.4rem}#ecl .tomap{min-width:44px;min-height:44px;border:1px solid var(--line);border-radius:12px;background:var(--surface);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}#ecl .tomap{color:var(--c)}#ecl .tomap svg{width:22px;height:22px}#ecl li.on{background:var(--hl);border-radius:.4rem}#ecs[hidden],.kzoom[hidden],#ecf[hidden],#ecl .tomap[hidden]{display:none}
.map.hikes .rte{fill:none;stroke:#ff922b;stroke-width:2px;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.map.hikes .trk{stroke-width:2px}.map.hikes .trk.ferme{stroke-width:2.6px;stroke-dasharray:4 3}
.map.hikes.zoomed .coast{stroke-width:3px;vector-effect:non-scaling-stroke}.map.hikes.zoomed .borders{vector-effect:non-scaling-stroke}.map.hikes.zoomed .trk.ferme{stroke-width:3.4px;stroke-dasharray:7 4}
.map.hikes .lines{filter:drop-shadow(0 0 1px rgb(10 30 40/.85))}.map.hikes path[data-k]{cursor:pointer}.map.hikes path[data-k]:hover{stroke-width:5px}
.legend{display:flex;flex-wrap:wrap;gap:.2rem 1rem}.legend span{white-space:nowrap}.legend .mls{flex-basis:100%;white-space:normal}.legend .sw{display:inline-block;width:1.3rem;height:.3rem;border-radius:.2rem;vertical-align:middle;margin-right:.4rem}
.sw.rte{background:#ff922b}.sw.ouvert{background:#ffd43b}.sw.ferme{background:repeating-linear-gradient(90deg,#ff6b6b 0 5px,transparent 5px 8px)}.sw.inconnu{background:#ced4da}.legend .sw.st{width:.75rem;height:.75rem;padding:0;box-sizing:border-box;border-radius:50%;background:#fff;border:2px solid #0b1f36}
.filter{display:flex;flex-wrap:wrap;gap:.7rem 1rem;align-items:end;margin-bottom:1rem}
.filter label{display:grid;gap:.25rem;font-size:.85rem;color:var(--muted);flex:1 1 9rem;min-width:0}.filter .q{flex:2 1 14rem}
.filter input[type=search],.filter select{font:inherit;font-size:1rem;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:.55rem .7rem;width:100%;min-width:0}
.filter .chk{display:flex;align-items:center;gap:.45rem;color:var(--ink);font-size:.95rem;flex:0 1 auto;padding-bottom:.6rem}.filter p{flex-basis:100%;margin:0}
form.filter[hidden],li[data-k][hidden],details.sect[hidden],.groupe[hidden],.voies li[hidden],.sans[hidden]{display:none}
.now-news{margin:0 0 1.2rem}.now-news h3{display:flex;align-items:center;gap:.4rem}.now-news li b{font-variant-numeric:tabular-nums}
.hike{gap:.5rem}.hike.closed{border:2px solid var(--lave)}.hike .okay{font-size:.88rem;color:#2b8a3e}
.hike .shut{border-left:3px solid var(--lave);padding-left:.6rem;font-size:.9rem}.hike .shut b{color:var(--lave);display:flex;gap:.35rem;align-items:center}
.hike .shut .ic{width:1rem;height:1rem}.hike .shut ul{margin:.2rem 0 0;padding-left:1rem}.hike .links{display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;font-weight:700}
details.sect{margin-bottom:.8rem}details.sect>summary{cursor:pointer}details.sect>summary h3{display:inline;margin-right:.5rem}details.sect .rows{margin-top:.6rem}
.card.alarm{border:2px solid var(--lave);margin-bottom:1rem}
.alarm-band{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.7rem;background:#c92a2a;color:#fff;border-radius:16px;padding:.9rem 1rem;width:100%;max-width:34rem}
.alarm-band .ic{width:1.5rem;height:1.5rem}.alarm-band p{color:#fff}.alarm-band a{color:#fff;font-weight:700}.alarm-band ul{margin:.4rem 0 0;padding-left:1.1rem}
.band .soft{color:var(--on-night-muted)}.band .soft a{color:var(--on-night)}
.part-of{color:var(--on-night-muted)}.part-of a{color:var(--on-night);font-weight:700}
.rows small.cuts{color:var(--lave)}
.wz-box{position:relative}.wz-box>.map{width:min(100%,calc(clamp(22rem,65vh,34rem)*${MAP_W}/${MAP_H}));margin:0 auto}.wz-cover{position:absolute;inset:0;display:grid;place-items:center;padding:1rem}.wz-cover .btn{text-align:center}
.wz-box.on iframe{display:block;width:100%;height:clamp(22rem,65vh,34rem);border:0;border-radius:18px;background:var(--surface)}
.wz-views{display:flex;flex-wrap:wrap;gap:.4rem;margin:.7rem 0}
.wz-views a{padding:.3rem .75rem;border-radius:999px;border:1px solid var(--line);color:var(--link);text-decoration:none;font-size:.85rem;background:var(--surface)}
.wz-views a[aria-current]{background:var(--sun);color:var(--sun-ink);border-color:var(--sun)}.wz-open{color:var(--link);font-weight:700}
.parts{display:flex;flex-wrap:wrap;gap:.4rem;margin:0 0 1rem}.parts a{padding:.35rem .85rem;border-radius:999px;border:1px solid var(--line);color:var(--link);text-decoration:none;font-size:.9rem;background:var(--surface)}
.parts a[aria-current]{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.link-card{display:block;text-decoration:none;color:inherit}.link-card h3{display:flex;gap:.5rem;align-items:center;color:var(--link)}.link-card:hover{border-color:var(--accent)}
.two>.card>.ic{width:1.6rem;height:1.6rem;color:var(--accent)}.two .card h4{margin-top:.5rem}
.figs{list-style:none;padding:0;margin:0;display:grid;gap:.8rem;grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))}
.figs li{display:flex;gap:.8rem;align-items:baseline}.figs .fig{white-space:nowrap;font:800 2rem/1 Bricolage,system-ui,sans-serif;letter-spacing:-.03em;color:var(--accent)}
.figs small{display:block;color:var(--muted);font-size:.82rem;margin-top:.2rem}
.release{max-width:46rem;gap:.9rem}.release ul{padding-left:1.2rem;display:grid;gap:.5rem}.release h3{margin-top:.6rem}.release a{overflow-wrap:anywhere}
/* A note on what is not taken from a site may give its address: it breaks where it must, never widening its section. */
.np{overflow-wrap:anywhere}
.vis-grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr))}.vis-grid.phones{grid-template-columns:repeat(auto-fill,minmax(10rem,1fr))}
.vis{margin:0;align-content:start}.vis img{display:block;width:100%;height:auto;border-radius:12px;border:1px solid var(--line)}.vis img.logo{width:40%;margin:auto;border:0}.vis img.lockup{padding:1.2rem}.vis img.nuit{background:#0b1f36}.vis img.sable{background:#f6f2ea}
.vis figcaption{display:grid;gap:.35rem;font-size:.92rem}.shot img{display:block;width:100%;height:auto;border-radius:14px}.vis .dl{font-weight:800}
.profile{width:100%;height:auto;display:block}.profile .fill{fill:color-mix(in srgb,var(--accent) 22%,transparent)}.profile .line{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round}
.profile .grid{stroke:var(--border);stroke-width:1}.profile .ax{fill:var(--muted);font:12px system-ui,sans-serif}
.facts{display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;margin:.6rem 0 1.2rem}.facts dt{font-size:.82rem;color:var(--on-night-muted)}.facts dd{margin:0;font:800 1.45rem/1.15 system-ui,sans-serif;color:var(--on-night)}
.map.terrain .mk{filter:drop-shadow(0 4px 6px rgb(0 0 0/.3))}.map.terrain .mk circle,.map.terrain .mk rect,.map.terrain .mk path.sh,.map.terrain .rj-st circle{stroke:#fff;stroke-width:4;stroke-linejoin:round}
.map text{font-family:system-ui,sans-serif;text-anchor:middle}
.map .mv{fill:#fff;font-weight:700;font-size:30px}
.map .mn,.map .pk text{fill:var(--ink);font-size:23px;paint-order:stroke;stroke:var(--land);stroke-width:7px;stroke-linejoin:round}
.map .pk path{fill:var(--muted)}.map .pk text{fill:var(--muted)}
.map .pin circle{fill:var(--lave)}.map .pin .halo{fill:none;stroke:var(--lave);stroke-width:5;opacity:.45}
.map .pin text{fill:var(--ink);font-weight:700;font-size:34px;paint-order:stroke;stroke:var(--land);stroke-width:9px}
@media (max-width:40rem){.map .mn,.map .pk{display:none}}
.map a:focus-visible{outline:none}.map .pk,.map .pin,.map .hl{pointer-events:none}
/* A marker hovered or tapped grows a little, with a deeper shadow; focused from the keyboard, the sun's ring. */
.map a.mk{transform-box:fill-box;transform-origin:center;transition:transform .18s ease-out,filter .18s ease-out}
.map a.mk:hover,.map a.mk.on{transform:scale(1.14)}
.map.relief a.mk:hover,.map.relief a.mk.on{filter:drop-shadow(0 10px 14px rgb(0 0 0/.45))}
.map a.mk:focus{outline:none}.map a.mk:focus-visible .sh{stroke:var(--sun);stroke-width:9}
@media (prefers-reduced-motion:reduce){.map a.mk{transition:none}.map a.mk:hover,.map a.mk.on{transform:none}.map a.mk:hover .sh,.map a.mk.on .sh{stroke-width:9}}
/* The bubble of a marker (home.ts, heroMap): night in both themes, like the band it sits on. */
.mtip{position:absolute;z-index:3;left:0;top:0;display:grid;gap:.12rem;min-width:9.5rem;max-width:15rem;padding:.6rem .8rem .65rem;
border-radius:12px;background:#0f1d2c;color:#f1f5f9;border:1px solid rgb(241 245 249/.12);box-shadow:0 1px 2px rgb(0 0 0/.3),0 10px 30px -8px rgb(0 0 0/.5);
text-decoration:none;font-size:.85rem;line-height:1.3;text-align:left;opacity:0;transform:translateY(4px);transition:opacity .15s ease-out,transform .15s ease-out}
.mtip[hidden]{display:none}.mtip.vu{opacity:1;transform:none}
.mtip .mt-p{font-weight:600}.mtip .mt-v{font:700 1.45rem/1.15 Bricolage,system-ui,sans-serif}.mtip .mt-d{color:#b4c6d8;font-size:.8rem}
.mtip .mt-go{margin-top:.3rem;color:#8fb4ff;font-weight:600;font-size:.8rem}
.mtip::after{content:"";position:absolute;left:var(--ax,50%);bottom:-7px;width:12px;height:12px;background:#0f1d2c;
border:solid rgb(241 245 249/.12);border-width:0 1px 1px 0;transform:translateX(-50%) rotate(45deg)}
.mtip.bas::after{bottom:auto;top:-7px;border-width:1px 0 0 1px}
@media (prefers-reduced-motion:reduce){.mtip{transition:none;transform:none}}
.map .zn path{fill:transparent;stroke:none}.map .zn:hover path{fill:rgb(255 255 255/.14);stroke:var(--sun);stroke-width:4}
.map .zn:focus-visible path{fill:rgb(255 255 255/.2);stroke:var(--sun);stroke-width:8}
.tgt{scroll-margin-top:5.5rem}.tgt:target{animation:tgt 2.4s ease-out}
@keyframes tgt{from,40%{box-shadow:0 0 0 3px var(--accent)}to{box-shadow:0 0 0 3px transparent}}
@media (prefers-reduced-motion:reduce){.tgt:target{animation:none;box-shadow:0 0 0 3px var(--accent)}}
.legend{display:flex;align-items:center;gap:.6rem;font-size:.84rem;color:var(--muted)}
.legend i{flex:1;max-width:12rem;height:.5rem;border-radius:1rem;background:linear-gradient(90deg,${STOPS.map(([, c]) => `rgb(${c.join(" ")})`).join(",")})}
.stations{list-style:none;padding:0;display:grid}
.st{display:grid;grid-template-columns:4.2rem minmax(0,1fr);gap:.05rem .9rem;padding:.65rem 0;border-top:1px solid var(--line)}
.st:first-child{border-top:0}
.t{grid-row:span 2;align-self:center;color:#fff;font-weight:700;font-size:1.1rem;border-radius:12px;text-align:center;padding:.5rem 0}
.t.na{background:#44555a;font-size:.85rem}
.st h4{font-size:1rem;margin:0}.st h4 small{font-weight:400;color:var(--muted)}
.st p{color:var(--muted);font-size:.9rem}

.seas{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr));gap:.6rem}
.seas li{display:grid;gap:.1rem;padding:.8rem 1rem;border-radius:16px;background:linear-gradient(160deg,#0f6f8f,#0b4a6e);color:#fff}
.seas span{font-size:.85rem;opacity:.85}.seas b{font:800 1.5rem Bricolage,system-ui,sans-serif}

.search{display:flex;align-items:center;gap:.6rem;background:var(--surface);border:1px solid var(--line);border-radius:999px;
padding:.2rem 1rem;max-width:28rem;box-shadow:var(--shadow);color:var(--muted)}
.search input{flex:1;min-width:0;font:inherit;border:0;background:transparent;color:var(--ink);padding:.5rem 0;outline:none}
.search:focus-within{outline:2px solid var(--link);outline-offset:2px}
.chips{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:.45rem}
.chips a{display:block;padding:.4rem .9rem;border-radius:999px;background:var(--surface);border:1px solid var(--line);color:var(--ink);
text-decoration:none;font-size:.95rem;transition:border-color .15s,transform .15s}
.chips a:hover{border-color:var(--accent);color:var(--link);transform:translateY(-1px)}
.places{display:grid;gap:.8rem}
.places h3{font-size:1rem;color:var(--muted)}

.three{display:grid;gap:1rem}
@media (min-width:58rem){.three{grid-template-columns:repeat(3,minmax(0,1fr))}}
.three .card{align-content:start}.three>.pile{display:grid;gap:1rem;align-content:start}
.three .ic{color:var(--accent);width:1.8rem;height:1.8rem}
.warn .ic{color:var(--lave)}
/* A link inside a sentence, its target at least 44 px tall for a finger (padding of an inline box leaves the lines where they are). */
.tap{padding-block:.8rem}
.badge{display:inline-block;font:700 .72rem system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;
border-radius:6px;padding:.2rem .5rem;background:var(--warn-bg);color:var(--lave);vertical-align:middle}
.badge.m{background:var(--surface);color:var(--accent);border:1px solid var(--line)}
.hb{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .6rem}

.crumbs{font-size:.88rem;color:var(--on-night-muted);padding-top:1.4rem}
.crumbs ol{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:.3rem}
.crumbs li+li::before{content:"› ";opacity:.6}
.band .crumbs a{color:var(--on-night-muted)}
.now{display:flex;align-items:flex-end;gap:.5rem 1.2rem;flex-wrap:wrap}
.big{font:800 clamp(3.5rem,11vw,6rem)/.9 Bricolage,system-ui,sans-serif;letter-spacing:-.04em;color:#fff}
.now p{color:var(--on-night-muted);max-width:22rem;font-size:.95rem}
.now p b{color:var(--on-night)}
.band .mapcard{background:rgb(255 255 255/.06);border-color:rgb(255 255 255/.12);box-shadow:none}
.airmap .aqtabs{margin-bottom:.5rem}.band .aqtabs label{color:var(--on-night-muted);border-color:rgb(255 255 255/.25)}.band .aqtabs input:checked+label{background:var(--on-night);color:var(--night);border-color:var(--on-night)}
/* /air's map: one pollutant's layer and legend at a time; without :has, the default one. */
.airmap .ly,.airmap .lg{display:none}.airmap .ly.on,.airmap .lg.on{display:inline}.airmap:has(.aqtabs input:checked:not(.on)) .on:is(.ly,.lg){display:none}
/* /antennes: one layer and legend at a time, as /air's map; a dot per support, filled when active, a ring when only planned. */
.antf{display:grid;gap:.4rem;margin-bottom:.6rem}.antf[hidden]{display:none}.antf .tl{font-size:.85rem;color:var(--muted);align-self:center;margin-right:.1rem}.antf .tabs{gap:.3rem}.antf label{font-size:.82rem;padding:.22rem .62rem}.antf .dis{opacity:.45}.antf .dis label{cursor:default}
.antmap .ants circle{fill:var(--c);stroke:#fff;stroke-width:calc(8px*var(--az,1));paint-order:stroke}.antmap .ants .r{fill:none;stroke:var(--c);stroke-width:calc(4px*var(--az,1));filter:drop-shadow(0 0 1.5px #0b1f36)}.antmap .map.zoomed .coast{stroke-width:3px;vector-effect:non-scaling-stroke}.antmap .map.zoomed .borders{vector-effect:non-scaling-stroke}.antmap .ants .h{display:none}
.antmap .ko{--c:#56b4e9}.antmap .ks{--c:#f0e442}.antmap .kf{--c:#b0508a}.antmap .kz{--c:#2563d8}.antmap .km{--c:#0b1f36}.antmap .k5{--c:#f0e442}.antmap .k4{--c:#56b4e9}.antmap .k2{--c:#b4c6d8}.antmap .kr{--c:#b0508a}
.antmap figcaption>span{display:block}.antmap figcaption>[hidden]{display:none}.antmap .lgc{display:flex;flex-wrap:wrap;gap:.3rem .9rem;margin-bottom:.45rem}.antmap .sw{display:inline-flex;align-items:center;gap:.35rem}.antmap .sw i{flex:none;width:.8rem;height:.8rem;border-radius:50%;background:var(--c);box-shadow:0 0 0 1.5px #fff,0 0 0 2.5px rgb(11 31 54/.3)}.antmap .tn{flex-basis:100%}.antmap .lgc-t.radio :is(.sw:not(.sw-r),.tn){display:none}
.antmap .formes{display:flex;align-items:center;gap:.3rem;margin-bottom:.5rem}.antmap .formes svg{flex:none;width:1rem;height:1rem}.antmap .formes .in{fill:#8a96a3}.antmap .formes .ring{fill:none;stroke:#8a96a3;stroke-width:2.5}
.wxmap:has(#wxl-t:checked) .lg-t,.wxmap:has(#wxl-p:checked) .lg-p,.wxmap:has(#wxl-v:checked) .lg-v{display:inline}
.wxmap .l-p,.wxmap .l-v{display:none}.wxmap:has(#wxl-p:checked) .l-p,.wxmap:has(#wxl-v:checked) .l-v{display:inline}.wxmap:has(#wxl-p:checked) .l-t,.wxmap:has(#wxl-v:checked) .l-t{display:none}
.wxmap:has(#wxl-t:checked) a.mk:not(.has-t),.wxmap:has(#wxl-p:checked) a.mk:not(.has-p),.wxmap:has(#wxl-v:checked) a.mk:not(.has-v){display:none}
/* The two canvases of a layer stacked by a grid, never positioned: in a foreignObject, Safari paints a positioned element unscaled, off the map. */
.wxmap .vt{display:grid;grid-template:100%/100%;width:100%;height:100%}.wxmap .vt canvas{grid-area:1/1;width:100%;height:100%}
.wxmap .wv rect{fill:#14202c;stroke:#fff;stroke-width:3}.wxmap .wv path{fill:none;stroke:#fff;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.wxmap .wv circle{fill:#fff}.wxmap .wv text{fill:#fff;font-weight:700;font-size:30px;text-anchor:middle}.wxmap .wt line{vector-effect:non-scaling-stroke;stroke-linecap:round}.wxmap .wt .o{stroke:#0b1f36;stroke-width:3.5px}.wxmap .wt .i{stroke:#fff;stroke-width:1.5px}.wxmap .wt circle{fill:#fff;stroke:#0b1f36;stroke-width:2px;vector-effect:non-scaling-stroke}
/* The station bubble (.mtip) is placed by the script against its parent, the figure: the figure must be its containing block. */
.wxmap{position:relative}
.wxmap .lgs{display:inline-flex;align-items:center;gap:.35rem;margin-right:.5rem;white-space:nowrap}.wxmap .lgr{display:flex;width:max-content;margin:.15rem 0 .2rem}
.wxmap .voile{display:block;width:100%;height:100%}.wxmap .aqtabs{gap:.25rem}.wxmap .aqtabs label{padding:.3rem .65rem}
html:has([data-js]:not([hidden])) #stl.plie>li:nth-child(n+13){display:none}.stmore{font:inherit;font-weight:600;padding:.45rem 1rem;border:1px solid var(--line);border-radius:99px;background:none;color:var(--link);cursor:pointer}
#stl{display:grid;grid-template-columns:repeat(auto-fill,minmax(10.5rem,1fr));gap:.6rem}
#stl .st{display:flex;flex-direction:column;gap:.15rem;padding:.75rem .85rem .7rem;border:1px solid var(--line);border-radius:1rem;background:var(--surface)}
#stl .th{display:flex;align-items:center;justify-content:space-between;gap:.4rem;margin-bottom:.4rem}
#stl .t{width:auto;padding:.3rem .55rem;border-radius:.6rem;font:700 1.2rem/1.1 Bricolage,system-ui,sans-serif}
#stl h4{font-size:1rem;line-height:1.25}#stl p{font-size:.84rem;line-height:1.35}#stl .when{font-size:.78rem;color:var(--muted)}
#stl .pls{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:auto;padding-top:.45rem}
#stl .pl{display:inline-flex;padding:.12rem .5rem;border:1px solid var(--line);border-radius:99px;background:var(--surface-2);color:var(--ink);font-size:.8rem;white-space:nowrap}
#stl .pl>span{display:inline-flex;align-items:center;gap:.22rem}#stl .pl svg{width:.85rem;height:.85rem}
#stl .ar{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}#stl .dr{fill:#2456b8}
#stl .pl.wet{background:#2456b8;border-color:#2456b8;color:#fff}#stl .pl.wet .dr{fill:#fff}
.sttri{display:grid;gap:.3rem}.sttri .tabs{gap:.3rem}
.stmore{margin-top:.8rem}
.wxmap .vgrad{display:inline-block;width:4.5rem;height:.6rem;border-radius:.3rem;background:linear-gradient(90deg,#2a6a9a,#248c78,#d6a828,#de7028,#c8301c);vertical-align:middle}
.wxmap .wgrad{background:linear-gradient(90deg,#4668b0,#2e96ac 17%,#4aaa62 33%,#deb83e 50%,#de702e 75%,#b22c48)}
/* The hatches' square, before their sentence: the map's two tones over a pale ground, like the relief's. */
.wxmap .hsw{display:inline-block;width:.9rem;height:.9rem;margin:0 .1rem;vertical-align:-.1rem;border-radius:.15rem;background:repeating-linear-gradient(135deg,rgba(11,31,54,.55) 0 1.6px,transparent 1.6px 2.1px,rgba(255,255,255,.5) 2.1px 3.7px,transparent 3.7px 4.24px),#c9d8c2}
/* The replay of the last 3 hours: its button and slider under the legend, its time on the map, the stations' dots hidden. */
.wxmap .rj{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-top:.6rem}.wxmap .rj[hidden],.wxmap .rj [hidden]{display:none}
.wxmap .rj fieldset{border:0;margin:0;padding:0;gap:.25rem;align-items:center}.wxmap .rj legend{float:left;padding:0;margin-right:.2rem;font-weight:700}.wxmap .rj label{padding:.3rem .65rem}
.band .rj label,.band .fonds label{color:var(--on-night-muted);border-color:rgb(255 255 255/.25)}.band .rj input:checked+label,.band .fonds input:checked+label{background:var(--on-night);color:var(--night);border-color:var(--on-night)}
.wxmap .rj button{min-height:44px;padding:.35rem .95rem;border-radius:999px;border:1px solid rgb(255 255 255/.35);background:rgb(255 255 255/.08);color:inherit;font:inherit;font-weight:700;cursor:pointer}.wxmap .rj button:disabled{cursor:wait;opacity:.7}
.wxmap .rj input[type=range]{flex:1 1 12rem;min-height:44px;accent-color:#fff}.wxmap .rj-q,.wxmap .rj-ko{flex-basis:100%}
@media (prefers-reduced-motion:reduce){.wxmap .rj-b{display:none}}
.wxmap .rj-lg,.wxmap .rj-t,.wxmap .rj-st{display:none}.wxmap.rejeu .rj-t{display:inline}.wxmap.rejeu:not(.rj-fin) :is(.rj-lg,.rj-st){display:inline}.wxmap.rejeu:not(.rj-fin) :is(.lg-now,.sts,.mtip){display:none}
.wxmap .rj-t text{text-anchor:start;font-weight:700;fill:var(--ink);stroke:var(--bg);stroke-width:10px;paint-order:stroke}.wxmap .rj-h{font-size:64px}.wxmap .rj-d,.wxmap .rj-s{font-size:40px}.wxmap .hsn{white-space:nowrap}
.sttools{display:flex;flex-wrap:wrap;gap:.6rem 1rem;align-items:center;margin-bottom:.8rem}.sttools[hidden]{display:none}.sttools select{font:inherit;padding:.3rem .5rem;border-radius:.5rem}
.sttools button{font:inherit;padding:.25rem .6rem;border:1px solid var(--line);border-radius:99px;background:none;color:inherit;cursor:pointer}.sttools button[aria-pressed=true]{background:var(--ink);color:var(--surface)}
.airmap:has(#aqp-pm10:checked) .ly-pm10,.airmap:has(#aqp-pm10:checked) .lg-pm10,.airmap:has(#aqp-pm25:checked) .ly-pm25,.airmap:has(#aqp-pm25:checked) .lg-pm25,.airmap:has(#aqp-o3:checked) .ly-o3,.airmap:has(#aqp-o3:checked) .lg-o3,.airmap:has(#aqp-no2:checked) .ly-no2,.airmap:has(#aqp-no2:checked) .lg-no2{display:inline}
.two{display:grid;gap:1rem}
@media (min-width:58rem){.two{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}}
.stcard .t{display:inline-block;padding:.4rem .9rem;font-size:1.3rem}
.stcard ul{padding-left:1.1rem}
.cta{background:linear-gradient(135deg,var(--night),var(--night-2));color:var(--on-night);border:0;padding:clamp(1.3rem,4vw,2.2rem);gap:1rem}
.cta p{color:var(--on-night-muted);max-width:40rem}
.cta a{color:#fff}
.days{list-style:none;padding:0 0 .4rem;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(10.5rem,1fr);gap:.8rem;
overflow-x:auto;scroll-snap-type:x mandatory}
.day{scroll-snap-align:start;gap:.35rem;align-content:start;box-shadow:none}
.day h3{font-size:1rem}
.day .range{font:800 1.4rem Bricolage,system-ui,sans-serif}
.day p{font-size:.9rem;color:var(--muted)}
.day p.range{color:var(--ink)}
.day p.why{font-size:.8rem;line-height:1.35}

.alerte.vg{display:block;border-radius:0;padding:0;font-size:.95rem;font-weight:600}
.alerte .wrap{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .8rem;padding-block:.6rem}
.alerte a{color:inherit;font-weight:800}
.alerte.volcan{display:block;background:#8c2410;color:#fff;font-size:.95rem;font-weight:600}
.volcan-une{padding-block:1rem}
.volcan-une .card{display:block;background:#8c2410;color:#fff;text-decoration:none}
.volcan-une h2{color:#fff;margin-bottom:.3rem}
.volcan-une .lead{color:#fff}
.ligne{display:none}
@media (max-width:599.98px){
[data-court]>.wrap,[data-court]>.card{display:none}
[data-court]>.ligne{display:flex;align-items:center;gap:.45rem;padding:.5rem 16px;color:inherit;font-size:.95rem;font-weight:700;line-height:1.3;text-decoration:none}
.ligne .txt{flex:1;min-width:0}.ligne .nw{white-space:nowrap}
.volcan-une[data-court]{padding:0;max-width:none}
.volcan-une>.ligne{background:#8c2410;color:#fff}}
.vg{display:inline-block;font-weight:700;font-size:.9rem;border-radius:8px;padding:.1rem .6rem;color:#fff;background:var(--vg0)}
.vg1{background:var(--vg1);color:#fff}.vg2{background:var(--vg2);color:#1a1500}.vg3{background:var(--vg3);color:#1a0d00}
.vg4{background:var(--vg4);color:#fff}.vg5{background:var(--vg5);color:#fff}
.vgpre{background:var(--surface);color:var(--ink);border:1px solid var(--border)}
.status{display:grid;gap:.6rem;justify-items:start}
.status .big{font-size:clamp(2rem,6vw,3.2rem);line-height:1}
/* /vigilance: one state under the h1, smaller than it; the vigilance in Météo-France's badges; the bulletin's time under it; the two pages as buttons. */
.vig{gap:.75rem}.vig .vh{font-size:clamp(1.75rem,4.8vw,2.5rem);line-height:1.05}.vig .vh2{font-size:clamp(1.3rem,3.6vw,1.7rem)}.vig .cyc{font-size:1rem;color:var(--on-night)}.vig .vab{padding:.25rem .7rem;border-radius:12px}
.vig .vstate{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem .6rem;color:var(--on-night);font-size:1.05rem;max-width:36rem}
.vig .vstate .vg{font-size:.95rem;padding:.25rem .75rem;border-radius:999px}.vig .vi{display:inline-flex;align-items:center;gap:.4rem}
.vig .when{font-size:.86rem;color:var(--on-night-muted);margin-top:-.3rem}.vig .off{font-size:1.02rem}
.vig .chips{margin:.1rem 0 0}.vig .chips a{background:rgb(255 255 255/.08);border-color:rgb(255 255 255/.22);color:#fff;font-size:.9rem;padding:.38rem .85rem}
/* Météo-France's map: in the hero on a wide screen, in the page on a phone; one only, never both. Scaled down whole, never cut. */
.mf-haut{display:none}
@media (min-width:58rem){.intro .mf-haut{display:block;margin:0;justify-self:end;max-width:100%;padding:.75rem}.intro .mf-haut img{display:block;width:auto;max-width:100%;height:auto;max-height:min(40rem,78vh);background:#fff}
.intro .mf-haut figcaption,.intro .mf-haut .note{font-size:.82rem;color:var(--on-night-muted);max-width:28rem;margin-top:.5rem}.mf-bas{display:none}}
/* /air: the forecast under the measure, apart and smaller. */
.status.forecast{margin-top:.2rem;padding-top:.7rem;border-top:1px solid rgb(255 255 255/.2)}.status.forecast .lead{font-size:1rem}
.zones{list-style:none;padding:0;display:grid;gap:1rem}
@media (min-width:40rem){.zones{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:66rem){.zones{grid-template-columns:repeat(3,minmax(0,1fr))}}
.zones .card{align-content:start}
.zones ul{list-style:none;padding:0;display:grid;gap:.5rem}
.zones li p{font-size:.88rem;color:var(--muted)}
.scale{list-style:none;padding:0;display:grid;gap:.6rem}
.scale li{display:grid;grid-template-columns:7.5rem minmax(0,1fr);gap:.8rem;align-items:start}
.scale .vg{text-align:center}
.suivi{display:grid;gap:1rem}
.suivi p{max-width:65ch}
.seas a{color:#fff;font-size:.85rem}
.seas li{align-content:start}
.seas .aller{justify-self:start;margin-top:.3rem}
.seas .aller,.band .aller{color:var(--ink)}
.big.span{font-size:clamp(2.6rem,7vw,4.2rem)}
.aq{display:inline-block;font-weight:700;font-size:.9rem;border-radius:8px;padding:.1rem .6rem;background:var(--aq0);color:#fff}
.aq1{background:var(--aq1);color:#06302d}.aq2{background:var(--aq2);color:#06302d}.aq3{background:var(--aq3);color:#2a2600}
.aq4{background:var(--aq4);color:#2a0606}.aq5{background:var(--aq5);color:#fff}.aq6{background:var(--aq6);color:#fff}
.plain{list-style:none;padding:0;display:grid;gap:.45rem}
.levels{display:grid;gap:1rem}
.cols{display:block;columns:3 13rem;column-gap:1.5rem}
.cols li{break-inside:avoid;margin-bottom:.45rem}
.rows{list-style:none;padding:0;display:grid}
.rows li{display:grid;grid-template-columns:3.4rem minmax(0,1fr) auto;gap:.6rem;align-items:baseline;padding:.45rem 0;border-top:1px solid var(--line)}
.rows li:first-child{border-top:0}
.rows.trajet li{grid-template-columns:auto minmax(0,1fr);scroll-margin-top:5rem}.rows.departs li{grid-template-columns:2.6rem minmax(0,1fr)}.rows.departs li>:last-child{grid-column:2}.rows.trajet .rt{display:block}.rows.trajet small{display:block;color:var(--muted);font-size:.82rem}.rows.trajet li.ici{background:color-mix(in srgb,var(--accent) 14%,transparent);border-radius:.4rem;padding-inline:.4rem}.rows.trajet li.ici small{color:inherit;font-weight:700}
.rows.bikes li{grid-template-columns:minmax(8.5rem,1fr) auto}
.rows li>span>.ya{display:block;margin-top:.3rem}
/* Above the tile's link, stretched over the whole tile (.tile h3 a::after): a tap on the button opens its sheet. */
.tile .aller{position:relative;z-index:2}
.rows.bornes li{grid-template-columns:minmax(0,1fr) auto}
.rows.bornes small{display:block;color:var(--muted);font-size:.82rem}
.rows.bornes .busy{color:var(--muted)}
.rows.eau li{grid-template-columns:minmax(0,1fr) auto}
@media (max-width:30rem){.rows.eau li>.fin{grid-column:1/-1}}
/* /volcan during an alert: the earthquakes one line each, the media's time and name above the headline. */
.rows.seismes li,.rows.medias li{display:block;font-size:.92rem}
.rows.seismes li{font-size:.86rem}.rows.seismes b{font-size:inherit}
.rows.medias a{display:block;margin-top:.15rem;font-size:1rem}
@media (max-width:37.49rem){.mapcard.nophone{display:none}}
.rows.eau small{display:block;color:var(--muted);font-size:.82rem}
.rows.eau .du{max-width:6.5rem;text-align:right}
.rows.eau li>.refs{grid-column:1/-1}
.rows.eau .refs small{color:inherit}
.rows .refs a{display:block;margin:0;padding:.5rem 0;font-weight:400}
.rows .refs .nw{white-space:nowrap}
.rows small.said{color:var(--lave);font-weight:700}
.rows .age{font-weight:700;font-size:.85rem;text-align:right;max-width:8.5rem}.rows .age.i{font-weight:400;color:var(--muted)}
.kind h4{margin:.9rem 0 .1rem;font:700 .95rem system-ui,sans-serif;color:var(--muted)}
.zones.top{align-items:start}#enf [hidden]{display:none!important}
@media (max-width:600px){#kf label{flex-basis:100%}}
@media (min-width:900px){.zones.top>li:has(details[open]){grid-column:1/-1}.zones.top details[open]>.kinds{columns:3 16rem;column-gap:2rem}.kinds .kind{break-inside:avoid}}
.card>details>summary{cursor:pointer;list-style:none;display:block;min-height:44px;padding:.5rem 0;margin:-.5rem 0;box-sizing:border-box}.card>details>summary::-webkit-details-marker{display:none}
.card>details>summary h3{display:inline}.card>details>summary h2{display:inline;font-size:1.12rem;letter-spacing:-.005em}.card>details>summary::after{content:"\\a0▸";color:var(--muted)}.card>details[open]>summary::after{content:"\\a0▾"}
.rows.eau .score{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.autour{margin:1rem 0}.autour>.note{margin-top:.6rem}.autour .rows a{display:block;margin-top:.25rem;font-weight:700}.rows.dae li>span:last-child{max-width:9.5rem;text-align:right}.map.autour-on .mk,.mapcard:has(.autour-on) figcaption{display:none}.map .nr{fill:#2b8a3e;stroke:#fff;stroke-width:2px;vector-effect:non-scaling-stroke}.map .me{fill:#339af0;stroke:#fff;stroke-width:3px;vector-effect:non-scaling-stroke}
.rows.eau .q-bonne{color:#2b8a3e;font-weight:700}.rows.eau .q-moyenne{color:#e8590c;font-weight:700}.rows.eau .q-mauvaise{color:var(--lave);font-weight:700}.rows.eau .q-none{color:var(--muted)}
.lvl{display:inline-block;padding:.1rem .55rem;border-radius:1rem;font:700 .8rem system-ui,sans-serif;background:var(--c);color:#14202b}
.table-wrap{overflow-x:auto}
table.drought{width:100%;border-collapse:collapse;font-size:.92rem}section.guide{max-width:46rem}section.guide h3{margin-top:1.6rem;scroll-margin-top:1rem}section.guide[id]{scroll-margin-top:1rem}section.guide li{margin-block:.25rem}section.guide pre{background:var(--surface-2,var(--surface));border:1px solid var(--line);border-radius:12px;padding:.9rem;overflow-x:auto;font:.8rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}section.guide code{font:.9em ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}section.guide pre code{overflow-wrap:normal}.callout{border-left:4px solid var(--accent)}table.niveaux th[scope=row]{font-weight:600}@media (max-width:640px){table.niveaux thead{display:none}table.niveaux tr{display:block;border-top:1px solid var(--line);padding:.55rem 0}table.niveaux tbody tr:first-child{border-top:0}table.drought.niveaux td:not([data-label]){display:none}table.drought.niveaux th,table.drought.niveaux td{display:block;border:0;padding:.1rem .25rem}table.niveaux td::before{content:attr(data-label) "\\00a0: ";color:var(--muted)}}.etat{display:inline-block;border-radius:999px;padding:.05rem .55rem;font-size:.8rem;font-weight:600;white-space:nowrap;text-decoration:none;border:1px solid var(--line)}.etat.lu{background:#2b8a46;color:#fff;border-color:#2b8a46}.etat.bientot{background:var(--sun);color:var(--sun-ink);border-color:var(--sun)}.etat.demande{background:var(--surface);color:var(--link)}table.passe caption{text-align:left;color:var(--muted);font-size:.85rem;padding:0 .35rem .4rem}table.passe{font-size:.82rem}table.passe th,table.passe td{padding:.4rem .25rem}table.passe td{white-space:nowrap;font-variant-numeric:tabular-nums}table.drought tr.past{color:var(--muted)}
table.histo small{display:block}table.hours td,table.hours th{white-space:nowrap}details.table-wrap>summary{cursor:pointer;font-weight:600;padding:.2rem 0 .6rem}.ratio{display:block;position:relative;height:.45rem;margin-top:.3rem;border-radius:.3rem;background:var(--line);max-width:9rem}.ratio i{position:absolute;inset:0 auto 0 0;border-radius:.3rem}.ratio s{position:absolute;left:50%;top:-.15rem;bottom:-.15rem;width:2px;background:var(--ink);opacity:.5}
table.drought th,table.drought td{text-align:left;padding:.45rem .5rem;border-top:1px solid var(--line)}
table.drought thead th{border-top:0;color:var(--muted);font-weight:600}
.rt{font-weight:700;color:var(--link)}
.rows b{font:800 1.05rem Bricolage,system-ui,sans-serif;overflow-wrap:anywhere}
.bars{list-style:none;padding:0;display:grid;gap:.7rem}
.qdays{margin:.6rem 0}
.qdays figcaption{font-size:.85rem;color:var(--muted)}
.mf-carte{margin:1rem 0;max-width:40rem}
.bassin{margin:1rem 0;max-width:40rem;padding:.6rem}.bassin figcaption{font-size:.95rem}.bassin figcaption p{margin:.6rem .3rem 0}.bassin figcaption details{margin:.4rem .3rem 0}.bassin figcaption summary{cursor:pointer;display:inline-flex;align-items:center;min-height:44px}.bassin figcaption summary::after{content:"\\a0▸"}.bassin figcaption details[open]>summary::after{content:"\\a0▾"}.bassin figcaption details p{margin:0 0 .3rem}
.map.ocean .shore{fill:none;stroke:var(--coast);stroke-width:2.5;stroke-linejoin:round}.map.ocean .grat{stroke:var(--coast);stroke-width:1.2;opacity:.4}
.map.ocean text{font-size:30px;fill:var(--muted);text-anchor:start;paint-order:stroke;stroke:var(--sea);stroke-width:6px;dominant-baseline:central}
.map.ocean .zone{fill:none;stroke:var(--accent);stroke-width:4;stroke-dasharray:4 12;stroke-linecap:round}.map.ocean .zl{fill:var(--accent);font-weight:600;font-size:33px}
.map.ocean .ln{fill:var(--ink);font-size:32px;font-weight:600;text-anchor:middle;stroke:var(--land)}.map.ocean .home text{text-anchor:middle}.map.ocean .islet circle{fill:var(--coast)}.map.ocean .islet text{fill:var(--ink);font-size:33px}
.map.ocean .trc path{fill:none;stroke:var(--muted);stroke-width:3.5;stroke-linejoin:round;stroke-linecap:round;opacity:.75}.map.ocean .trc .hit{stroke:transparent;stroke-width:26;opacity:1}
.map.ocean .trc:not(.js) a:hover path:not(.hit),.map.ocean .trc a.on path:not(.hit){stroke:#ffd43b;stroke-width:8;opacity:1;filter:drop-shadow(0 0 2px #0b1f36)}.map.ocean .trc.focus a:not(.on) path{opacity:.2}.map.ocean .trc.focus a:not(.on) .nb{opacity:.15}
.map.ocean .nb circle{fill:var(--surface);stroke:var(--muted);stroke-width:3}.map.ocean .nb text{fill:var(--ink);font-size:33px;font-weight:700;text-anchor:middle;stroke:none}.map.ocean .tns text{display:none;fill:var(--ink);font-size:33px;font-weight:700}.map.ocean .tns text.on{display:inline}.map.ocean .trc:not(.js) a:hover .nb circle,.map.ocean .trc a.on .nb circle{fill:#ffd43b;stroke:#1a1500}.map.ocean .trc:not(.js) a:hover .nb text,.map.ocean .trc a.on .nb text{fill:#1a1500}
.map.ocean .cur path{fill:none;stroke:var(--ink);stroke-width:5;stroke-linejoin:round;stroke-linecap:round}.map.ocean .cur circle{fill:var(--surface);stroke:var(--ink);stroke-width:3}.map.ocean .cur .last{fill:var(--ink);stroke:var(--surface);stroke-width:4}.map.ocean .cur text{fill:var(--ink);font-size:30px}.map.ocean .cur .cn{font-size:34px;font-weight:700}
.trcs{list-style:none;padding:0;margin:.4rem .3rem 0;display:flex;flex-wrap:wrap;gap:.3rem .9rem}.trcs a{display:inline-flex;align-items:center;gap:.35rem;min-height:44px;padding:0 .3rem;border-radius:10px}.trcs a.on{background:rgb(255 212 59/.3)}.trcs .nb{display:inline-grid;place-items:center;width:1.6em;height:1.6em;border-radius:50%;border:2px solid var(--muted);font-weight:700;font-size:.85em}.trcs a.on .nb{background:#ffd43b;border-color:#1a1500;color:#1a1500}
.map.ocean .home circle{fill:var(--lave);stroke:#fff;stroke-width:4}.map.ocean .home text{fill:var(--ink);font-weight:700;font-size:34px}.mf-carte img{display:block;width:100%;height:auto;background:#fff}.mf-carte figcaption{font-size:.92rem}.mf-carte p{margin:0}
.qdays ol{list-style:none;padding:0;margin:.3rem 0 0;display:grid;grid-template-columns:repeat(30,minmax(0,1fr));gap:2px;align-items:end;height:5rem;border-bottom:1px solid var(--line)}
.qdays li{height:100%;display:flex;align-items:flex-end}
.qdays i{display:block;width:100%;background:var(--vg0);border-radius:2px 2px 0 0}
.qdays li.now i{background:var(--accent);opacity:.6}
.qdays li.nolu{background:repeating-linear-gradient(135deg,var(--line) 0 1px,transparent 1px 4px);opacity:.7}
.qdays .axis{display:flex;justify-content:space-between;font-size:.8rem;color:var(--muted);margin:.2rem 0 0}
.bars li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.2rem .6rem;font-size:.92rem}
/* A station's page (web/station.ts): its last measure, its charts drawn on the server, its months and its records. */
.sta-now h3{color:var(--on-night)}.sta-now .bars li{grid-template-columns:auto minmax(0,1fr);gap:.2rem 1rem}.sta-now .bars li b{text-align:right}
.sta-grid{display:grid;gap:1rem;align-items:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,26rem),1fr))}.sta-grid .card{padding:1rem}
.sta-grid h3{font-size:1rem;margin-bottom:.4rem}.sta-grid h3 small{font-weight:400;color:var(--muted)}.sta-0{color:var(--muted);padding:1rem 0}
.ch{width:100%;height:auto;display:block}.ch .gr{stroke:var(--line);stroke-width:1}.ch .ax{font-size:20px;fill:var(--muted)}
.ch .ln-t{fill:none;stroke:var(--chaud);stroke-width:3.5}.ch .ln-n{fill:none;stroke:var(--frais);stroke-width:3.5}.ch .bd{fill:#d6a828;opacity:.18}.ch .br{fill:var(--pluie)}
.hg{display:grid;gap:1rem;align-items:start;grid-template-columns:repeat(auto-fill,minmax(min(100%,19rem),1fr))}.hg .card{padding:.8rem}.hg h3{font-size:1rem;margin-bottom:.3rem}.hg h3 small{font-weight:400;color:var(--muted)}
.hg .ch{touch-action:pan-y}.hg .ch .bd{fill:var(--muted);opacity:.2}.ch .ln-p{fill:none;stroke:var(--pluie);stroke-width:4}.ch .ln-no{fill:none;stroke:var(--ink);stroke-width:2.5;stroke-dasharray:7 6;opacity:.75}.hg .ch .br{fill:var(--soleil)}.hg .ch .br.g{fill:var(--muted);opacity:.6}.ch .mk{fill:var(--ink)}.ch .cur{stroke:var(--ink);stroke-width:1.5;opacity:.5;display:none}
.ch-v{min-height:2.6em;margin:.2rem 0 0;font-size:.85rem;line-height:1.3;color:var(--muted)}.hg-k{margin:0 0 .6rem}.hg-k .k-p{border-top:3px solid var(--pluie)}.hg-k .k-no{border-top:2px dashed var(--ink)}.hg-k .k-t{border-top:3px solid var(--chaud)}.hg-k .k-n{border-top:3px solid var(--frais)}.hg-k .k-bd{height:.7rem;border:0;background:var(--muted);opacity:.35}.hg-k .k-s{height:.7rem;width:.6rem;border:0;background:var(--soleil)}.hg-k .k-g{width:.5rem;height:.5rem;border:0;border-radius:50%;background:var(--ink)}.hg .nn{margin:.2rem 0 0}.hg-an{padding:.8rem;max-width:38rem}.hg-an .an-l{display:none}@media (min-width:58rem){.hg-an{max-width:none}.hg-an .an-n{display:none}.hg-an .an-l{display:block}}.hg-an .ch{touch-action:pan-y}.ch .up{fill:var(--chaud)}.ch .dn{fill:var(--frais)}.ch .gr.z{stroke:var(--ink);opacity:.6}.hg-k .k-up,.hg-k .k-dn{width:.6rem;height:.7rem;border:0;background:var(--chaud)}.hg-k .k-dn{background:var(--frais)}
.ch .ln-v{fill:none;stroke:#248c78;stroke-width:3.5}.ch .ln-r{fill:none;stroke:#248c78;stroke-width:2;stroke-dasharray:6 4}
.ch .wa{fill:none;stroke:var(--ink);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.k{display:inline-block;width:1.2rem;height:0;border-top:2.5px solid #248c78;vertical-align:middle;margin:0 .3rem 0 .6rem}.k-v{margin-left:0}.k-r{border-top:1.5px dashed #248c78}
.sta-m{width:100%;border-collapse:collapse;font-size:.86rem}.sta-m th,.sta-m td{text-align:left;padding:.35rem .45rem;border-bottom:1px solid var(--line);vertical-align:top}.sta-m th{font-size:.8rem}
.sta-m td b{display:block;font-weight:600}.sta-m td small{display:block;color:var(--muted);font-size:.78rem}
.sta-rec{display:grid;gap:.8rem;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));list-style:none;padding:0}.sta-rec li{display:flex;flex-direction:column;gap:.2rem;padding:1rem}
.sta-rec span{color:var(--muted);font-size:.85rem}.sta-rec b{font:700 1.6rem/1.1 Bricolage,system-ui,sans-serif}.sta-rec small{color:var(--muted)}
.band .bars li{color:var(--on-night)}
.bars i{grid-column:1/-1;display:block;height:.55rem;border-radius:1rem;background:var(--vg0)}
.bars i.ren{background:var(--ren)}
.posts{list-style:none;padding:0;display:grid;gap:1rem}
@media (min-width:58rem){.posts{grid-template-columns:repeat(2,minmax(0,1fr))}}
.posts p{overflow-wrap:anywhere}
/* The text read in an image of the OVPF, quoted apart from the card's own words (providers/ovpf-ocr.ts). */
.posts details>summary{cursor:pointer}.posts details>p{margin:.6rem 0 0;padding-left:.8rem;border-left:3px solid var(--line)}
.warn ul{padding:0}
.social,.social>span{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem 1rem}.social a{display:inline-flex;align-items:center;gap:.35rem}.social svg{width:1.1rem;height:1.1rem;flex:none}
.social .pair{display:inline-flex;align-items:center;gap:inherit}
.pages{list-style:none;padding:0;margin-top:1rem;display:flex;flex-wrap:wrap;gap:.4rem}.pages a{display:block;padding:.3rem .75rem;border-radius:999px;background:rgb(255 255 255/.06);border:1px solid rgb(255 255 255/.1);text-decoration:none;font-size:.86rem}
footer.foot{background:var(--night);color:var(--on-night-muted);font-size:.86rem;line-height:1.55;padding-block:2.5rem 3rem;border-top:1px solid rgb(255 255 255/.06)}
footer.foot .wrap{display:grid;gap:1.5rem}
@media (min-width:58rem){footer.foot .wrap{grid-template-columns:1fr 1.6fr}}
footer.foot a{color:var(--on-night)}
footer.foot .brand{color:var(--on-night);margin-bottom:.8rem}
footer.foot p+p{margin-top:.6rem}
footer.foot h3{color:var(--on-night);font-size:1rem;margin-bottom:.4rem}
footer.foot .slogan{font-size:1rem;padding-left:calc(1.55rem + .6rem)}
`.replace(/\n/g, "") + AVIS_CSS + AIDE_CSS + FORMS_CSS + PWA_CSS + FOND_CSS + POINTS_CSS + LEGENDE_CSS + ELECTRICITE_CSS;
/**
 * The stylesheet, a file of its own (web/site.ts) rather than copied into every page: its address changes with its
 * content, so that browsers keep it a year and fetch it again only once it changes.
 */
export const STYLE_PATH = `/style-${hash(CSS)}.css`;

interface Head {
  title: string;
  description: string;
  path: string;
  jsonld: object[];
  /** Météo-France's vigilance above green, on every page. */
  alerte?: Alerte;
  /** Kept out of the search engines: a page whose data is not served yet (/feux without its key). */
  noindex?: boolean;
  /** The page's RSS feed (a commune's alerts): announced in the head, linked in the footer. */
  rss?: { href: string; title: string; link: string; hint: string };
  /** The offline page, kept on phones until the service worker changes: no banner of the moment, nothing to send. */
  shell?: boolean;
  /** A page that is a form itself (/associations/proposer): no feedback form below, where an event could be typed by mistake. */
  sansAvis?: boolean;
  /** Nothing to share nor follow below (the secret link of a proposed event: its author would think they share it). */
  sansPartage?: boolean;
  /** The sharing below without the install block: /application, whose steps are the page itself. */
  sansInstallation?: boolean;
  /** The page's referrer policy, besides the header: « no-referrer » where the address holds a secret. */
  referrer?: string;
  /** The page shows the volcano's alert itself (the home page's card, /volcan's heading): no volcano banner above it. */
  volcan?: boolean;
  /** /vigilance, /cyclones and /crues: their own data says all is green, the only time their picture is shown (fonds.ts). */
  vert?: boolean;
  /** The page's own hook, in place of its category's: a station's page, which says since when it measures. */
  hook?: string;
}

/**
 * An alert on one line, for a phone (below 600 px), two in a rare case: the whole line leads to the page that details
 * it. Never cut with « … », which could cut whose the alert is or « Enclos interdit » (marketing). The banner's sentence
 * stays on wider screens, and on the page the line would lead to. `after`: said after it, free to break (the time of a
 * vigilance kept).
 */
export function ligne(href: string, picto: string, text: string, after?: string): string {
  // The last part (the zones, « Enclos interdit ») kept whole: on two lines, the line breaks before its « · ».
  const i = text.lastIndexOf(" · ");
  const said = i < 0 ? esc(text) : `${esc(text.slice(0, i))} <span class="nw">· ${esc(text.slice(i + 3))}</span>`;
  return `<a class="ligne" href="${href}">${picto ? `<span aria-hidden="true">${picto}</span>` : ""}<span class="txt">${said}${after ? ` · ${esc(after)}` : ""}</span><span aria-hidden="true">→</span></a>`;
}

// The words of the line, marketing's: the phenomena by a short name, two at most; the zones named while one or two,
// counted beyond, « toute l'île » or « toutes les côtes » when all are.
const SHORT: Record<string, string> = { "Fortes pluies / orages": "pluies-orages", "Vents forts": "vents forts", "Vagues - submersion": "vagues-submersion" };
const COASTS = Object.values(mf.ZONES).filter((z) => z.startsWith("Zone côtière")).length;
function zonesSaid(zones: string[]): string {
  const coast = zones.filter((z) => z.startsWith("Zone côtière"));
  const land = zones.filter((z) => !coast.includes(z)).map((z) => z.split(" :")[0]);
  const parts = [
    land.length === LAND.length ? "toute l'île" : land.length > 2 ? `${land.length} zones` : land.join(", "),
    coast.length === COASTS ? "toutes les côtes" : coast.length ? `${coast.length} ${coast.length > 1 ? "zones côtières" : "zone côtière"}` : "",
  ];
  return parts.filter(Boolean).join(", ");
}

// The cyclone alert is the prefect's, which Météo-France publishes: the line says whose it is (marketing).
function vigilanceLigne(a: Alerte): string {
  const c = a.court;
  if ("cyclone" in c) return c.prevue ? "Alerte cyclonique prévue par le préfet" : `${cycloneHead(c.cyclone)} du préfet`;
  return `Météo-France : vigilance ${feminine(c.couleur)} ${c.phenomenes.slice(0, 2).map((p) => SHORT[p] ?? p.toLowerCase()).join(", ")} · ${zonesSaid(c.zones)}`;
}

function banner(a: Alerte | undefined, path: string): string {
  if (!a) return "";
  const more = path === "/vigilance" ? "" : ` <a href="/vigilance">Voir la vigilance zone par zone →</a>`;
  const schools = a.ecoles && path !== "/ecoles-cyclone" ? ` <a href="/ecoles-cyclone">Écoles fermées →</a>` : "";
  // After « Voir la vigilance zone par zone → », where Météo-France says it: the cyclone's page for the cyclone alert.
  const official = ` ${officielHtml("cyclone" in a.court ? mf.OFFICIEL_CYCLONE : mf.OFFICIEL_VIGILANCE)}`;
  const short = path === "/vigilance" ? "" : ligne("/vigilance", "⚠", vigilanceLigne(a), a.lue) + (a.ecoles && path !== "/ecoles-cyclone" ? ligne("/ecoles-cyclone", "", "Écoles et crèches fermées") : "");
  return `<div class="alerte vg ${a.neutre ? "vgpre" : `vg${a.couleur}`}"${short ? " data-court" : ""} role="status">${short}<div class="wrap"><span>⚠ ${esc(a.texte)}${a.lue ? ` · ${esc(a.lue)}` : ""}</span>${schools}${more}${official}</div></div>`;
}

/**
 * A tab taken up again, kept in the browser's memory or hidden for hours: its clock says now, its measures « il y a
 * 3 h ». When the newest measure of the page is more than 15 min old, the page is asked again; at most once per 15 min
 * for a page, since a source that does not answer keeps the measures old.
 */
export const RELOAD_SCRIPT = `const again=()=>{const a=[...document.querySelectorAll("[data-age]")].map((e)=>Date.parse(e.dataset.age)).filter((t)=>t>0);
const n=Date.now();if(!a.length||n-Math.max(...a)<9e5)return;const k="recharge:"+location.pathname;let last=0;try{last=Number(sessionStorage.getItem(k))||0}catch{}
if(n-last<9e5)return;try{sessionStorage.setItem(k,String(n))}catch{}location.reload()};
addEventListener("pageshow",(e)=>{if(e.persisted)again()});document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")again()});`;

/**
 * On a phone (coarse pointer), a tap on a link of copies() also copies its text, and the line after its paragraph
 * says whether it was. After the `?maj=` of the links (SCRIPT), so that the question copied has it.
 */
export const COPIE_SCRIPT = `document.querySelectorAll("a[data-copie]").forEach((a)=>a.addEventListener("click",()=>{if(!matchMedia("(pointer:coarse)").matches)return;
const s=a.parentElement.nextElementSibling,say=(k)=>{s.textContent=a.dataset[k];s.hidden=false};
try{navigator.clipboard.writeText(a.dataset.copie||new URL(a.href).searchParams.get("q")).then(()=>say("ok"),()=>say("non"))}catch{say("non")}}));`;

/**
 * A folded category (`folded`) opened by a link to it or to one of its rows: the browsers that open it themselves
 * (Chrome, Safari 26 at least) are not all, nor a link to the card that holds it, a commune's on a map.
 */
export const UNFOLD_SCRIPT = `(()=>{const unfold=()=>{const t=location.hash&&document.getElementById(location.hash.slice(1));const d=t&&(t.closest("details")||t.querySelector(":scope>details"));if(d)d.open=true};unfold();addEventListener("hashchange",unfold)})();`;

const SCRIPT = `const menu=document.querySelector("details.menu");if(menu)document.addEventListener("click",(e)=>{if(menu.open&&!menu.contains(e.target))menu.open=false});
${UNFOLD_SCRIPT}
document.querySelectorAll("[data-copy]").forEach((b)=>b.addEventListener("click",async()=>{const t=document.getElementById(b.dataset.copy);
const o=b.textContent;if(b.dataset.signal&&location.pathname==="/mcp")sig("c");try{await navigator.clipboard.writeText(t.textContent);b.textContent="Copié ✓";setTimeout(()=>b.textContent=o,2500)}catch{getSelection().selectAllChildren(t)}}));
const f=document.getElementById("filtre");if(f){const n=(s)=>s.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase();
f.addEventListener("input",()=>{const q=n(f.value.trim());let any=false;document.querySelectorAll(".places li").forEach((li)=>{const ok=n(li.textContent).includes(q);li.hidden=!ok;any||=ok});
document.querySelectorAll(".places h3").forEach((h)=>{h.hidden=![...h.nextElementSibling.children].some((li)=>!li.hidden)});document.getElementById("rien").hidden=any})}
const askl=(l)=>{document.querySelectorAll("[data-askl]").forEach((b)=>b.setAttribute("aria-pressed",b.dataset.askl===l));
document.querySelectorAll(".askbox>[data-l]").forEach((d)=>{d.hidden=d.dataset.l!==l})};
try{const l=localStorage.getItem("askl");if(l)askl(l)}catch{}
document.querySelectorAll("[data-askl]").forEach((b)=>b.addEventListener("click",()=>{askl(b.dataset.askl);try{localStorage.setItem("askl",b.dataset.askl)}catch{}}));
document.querySelectorAll("a[data-maj]").forEach((a)=>{const h=a.getAttribute("href"),u=a.dataset.maj;const set=()=>{const t=new Date(Date.now()+144e5);
a.href=h.replace(encodeURIComponent(u),encodeURIComponent(u+"?maj="+t.getUTCHours()+"h"+String(t.getUTCMinutes()).padStart(2,"0")))};["click","auxclick","contextmenu"].forEach((e)=>a.addEventListener(e,set))});
${COPIE_SCRIPT}
${POINTS_SCRIPT}
${NOMS_SCRIPT}
const hhmm=(t)=>{const d=new Date(t+144e5);return String(d.getUTCHours()).padStart(2,"0")+":"+String(d.getUTCMinutes()).padStart(2,"0")};
const tick=()=>{const n=Date.now();document.querySelectorAll("[data-clock]").forEach((e)=>{e.textContent=hhmm(n)});
document.querySelectorAll("[data-age]").forEach((e)=>{const m=Math.max(0,Math.round((n-Date.parse(e.dataset.age))/6e4));
e.textContent="il y a "+(m<90?m+" min":m<2880?Math.round(m/60)+" h":Math.round(m/1440)+" jours")})};
document.querySelectorAll("[data-js]").forEach((e)=>{e.hidden=false});document.querySelectorAll("[data-nojs]").forEach((e)=>{e.hidden=true});
tick();setInterval(tick,3e4);
const mt=document.querySelector("[data-mtip]");if(mt){const box=mt.parentElement;let on=null,touch=false,t=0;
const put=(a)=>{clearTimeout(t);if(on)on.classList.remove("on");on=a;a.classList.add("on");
const L=box.querySelector("[name=wxl]:checked"),k=L?L.id.slice(4):"";mt.querySelector(".mt-p").textContent=a.dataset.tp;mt.querySelector(".mt-v").textContent=a.dataset["tv"+k]||a.dataset.tv;mt.querySelector(".mt-d").textContent=a.dataset["td"+k]||a.dataset.td;mt.href=a.getAttribute("href");
mt.hidden=false;const f=box.getBoundingClientRect(),r=([...a.querySelectorAll(".sh")].find((e)=>e.getBoundingClientRect().width)||a).getBoundingClientRect(),w=mt.offsetWidth,h=mt.offsetHeight;
const cx=r.left+r.width/2-f.left,x=Math.min(Math.max(cx-w/2,6),f.width-w-6),up=r.top-f.top-h-12>=0;
mt.classList.toggle("bas",!up);mt.style.left=x+"px";mt.style.top=(up?r.top-f.top-h-12:r.bottom-f.top+12)+"px";
mt.style.setProperty("--ax",Math.min(Math.max(cx-x,16),w-16)+"px");requestAnimationFrame(()=>mt.classList.add("vu"))};
const off=()=>{clearTimeout(t);if(on)on.classList.remove("on");on=null;mt.classList.remove("vu");mt.hidden=true};
const later=()=>{clearTimeout(t);t=setTimeout(off,160)};
box.querySelectorAll("a.mk[data-tp]").forEach((a)=>{a.addEventListener("pointerdown",(e)=>{touch=e.pointerType!=="mouse"});
a.addEventListener("pointerenter",(e)=>{if(e.pointerType==="mouse")put(a)});a.addEventListener("pointerleave",(e)=>{if(e.pointerType==="mouse")later()});
a.addEventListener("focus",()=>{if(!touch)put(a)});a.addEventListener("blur",later);
a.addEventListener("click",(e)=>{if(touch&&on!==a){e.preventDefault();put(a)}touch=false})});
box.querySelectorAll("[name=wxl]").forEach((i)=>i.addEventListener("change",off));mt.addEventListener("pointerenter",()=>clearTimeout(t));mt.addEventListener("pointerleave",(e)=>{if(e.pointerType==="mouse")later()});
document.addEventListener("click",(e)=>{if(on&&!e.target.closest("a.mk,[data-mtip]"))off()});
document.addEventListener("keydown",(e)=>{if(e.key==="Escape"&&on)off()});addEventListener("resize",()=>{if(on)put(on)})}
${RELOAD_SCRIPT}
${PWA_SCRIPT}
${SIGNAL_SCRIPT}`;

/** Whether a page belongs to a category: /meteo/cilaos is in the weather. */
const inCategory = (path: string, category: string) => path === category || path.startsWith(`${category}/`);

/**
 * One sentence under each page's title that says what it is good for before its data (« Avant de partir : les
 * sentiers fermés ce matin par l'ONF, et pourquoi. »): the page's own, else its category's, the longest match first.
 */
const HOOKS: [string, string][] = [
  ["/", "Les sorties, les randos, le temps et les routes de l'île en ce moment, pour vous et votre IA."],
  ["/meteo", "Le temps qu'il fait vraiment, mesuré par la station la plus proche, et la prévision à part."],
  ["/vigilance", "Avant de sortir : la vigilance officielle de Météo-France, zone par zone."],
  ["/crues", "Fortes pluies ? La vigilance crues et la hauteur des rivières en ce moment, station par station."],
  ["/mer", "Avant la plage : la température de l'eau au large de chaque plage."],
  ["/volcan", "Éruption ou pas, Enclos ouvert ou fermé : l'état du volcan avant de monter."],
  ["/bus", "Votre prochain bus, à l'heure annoncée par le réseau, sans appli à installer."],
  ["/trafic", "Avant de prendre la route : la carte des bouchons et ce que signalent les médias."],
  ["/actualites", "Ce qui se passe sur l'île en ce moment, commune par commune."],
  ["/air", "Sport dehors ou pas : la qualité de l'air dans votre commune aujourd'hui."],
  ["/electricite", "Quand recharger la voiture ou lancer la machine : l'électricité de l'île en ce moment."],
  ["/calendrier", "Pour prévoir la semaine : les prochaines vacances scolaires et les jours fériés."],
  ["/velos", "Un vélo à prendre ou une place pour le rendre, avant de vous déplacer."],
  ["/bornes", "Une borne libre près de vous, avant de faire le détour."],
  ["/eau", "Baignade ou robinet : la dernière analyse de l'ARS près de chez vous."],
  ["/randonnees", "Choisir une rando ouverte aujourd'hui, avec sa trace GPS et son dénivelé."],
  ["/sentiers", "Avant de partir : les sentiers fermés ce matin par l'ONF, et pourquoi."],
  ["/secheresse", "Arrosage, lavage, piscine : ce qui est interdit dans votre commune en ce moment."],
  ["/coupures-eau", "Coupure d'eau ou eau à ne pas boire : les avis en cours des distributeurs."],
  ["/defibrillateurs", "En cas d'arrêt cardiaque : le défibrillateur le plus proche, et s'il est accessible."],
  ["/sport", "Les matchs du week-end et les derniers résultats de l'île."],
  ["/evenements", "Ce week-end : concerts, fêtes et marchés, commune par commune."],
  ["/cyclones", "Un cyclone dans l'océan Indien ? Son stade selon le CMRS de Météo-France, et le lien vers son site officiel."],
  ["/historique", "Normal pour la saison ? Le temps qu'il a fait, comparé à la normale."],
  ["/communes", "Tout ce qui compte aujourd'hui dans votre commune, sur une seule page."],
];
// A trail's or a hike's own page: one trace, not the list of the day's closures.
const TRACE_HOOK = "La trace à télécharger et l'état du sentier ce matin, avant de partir.";
// A past cyclone's page: measures, not the tracking of the moment.
const PASSE_HOOK = "Ce que les stations de Météo-France ont mesuré pendant son passage.";

export function hook(path: string): string | undefined {
  const trace = /^\/(sentiers|randonnees)\/([a-z0-9-]+)$/.exec(path);
  if (trace && (trace[1] === "sentiers" ? traces.sentier(trace[2]) : traces.randonnee(trace[2]))) return TRACE_HOOK;
  if (PASSES.some((p) => path === `/cyclones/${p.slug}`)) return PASSE_HOOK;
  return HOOKS.filter(([p]) => (p === "/" ? path === "/" : inCategory(path, p))).sort((x, y) => y[0].length - x[0].length)[0]?.[1];
}

/**
 * Above the feedback form: send the page on WhatsApp, the island's first channel with Facebook (a plain link, no
 * script of theirs; `?ref=wa` counts the visits it brings, src/metrics.ts), follow rundata.re's accounts, and put the
 * site on the home screen (web/pwa.ts). The accounts say what each brings: a useful fact every morning, the weekend's
 * outings on Friday on the WhatsApp channel, named « chaîne WhatsApp » so as not to read as the share link.
 */
function share(origin: string, head: Head): string {
  const text = `${head.title.replace(/ · 974$/, "")} : ${origin}${head.path}?ref=wa`;
  const link = (s: Social, label = s.nom) => `<a href="${esc(fromSite(s.url))}" rel="noopener">${esc(label)}</a>`;
  // The info of each morning is Facebook's; no rhythm is promised for Instagram or Threads, so they are named without one (marketing).
  // The code is not an account to follow for news: GitHub stays out of this sentence.
  const accounts = followed().filter((s) => s.nom !== "WhatsApp" && s.nom !== "GitHub").map((s) => link(s) + (s.nom === "Facebook" ? " (une info utile chaque matin)" : ""));
  const channel = followed().find((s) => s.nom === "WhatsApp");
  // « Facebook (une info utile chaque matin), Instagram ou Threads ».
  const on = accounts.length > 1 ? `${accounts.slice(0, -1).join(", ")} ou ${accounts.at(-1)}` : accounts[0];
  const weekend = channel && `les sorties du week-end le vendredi sur notre ${link(channel, "chaîne WhatsApp")}`;
  const sentence = on ? `Suivez rundata.re sur ${on}${weekend ? `, et ${weekend}` : ""}.` : weekend ? `Suivez ${weekend}.` : "";
  return `<aside class="share wrap" aria-label="Partager et suivre"><div class="card">
  <a class="sh wa" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Partager sur WhatsApp ${EXTERNAL}</a>
  ${sentence ? `<p>${sentence}</p>` : ""}
</div>
${head.sansInstallation ? "" : INSTALL}
</aside>`;
}

/** The hook goes right under the page's title; not on /volcan during an alert, whose heading and lines say it (marketing). */
const withHook = (band: string, path: string, volcan?: boolean, own?: string) => {
  const h = volcan && path === "/volcan" ? undefined : own ?? hook(path);
  return h ? band.replace("</h1>", `</h1>\n    <p class="hook">${esc(h)}</p>`) : band;
};

// The menu: every category with a page, the clubs' space after the sport (once it is out), then the communes; the first
// few also sit in the bar on wide screens.
const MENU = [
  ...WITH_PAGE.flatMap((c) => [{ key: c.key, nom: c.nom, path: c.path, icon: c.icon },
    ...(c.key === "sport" ? [{ key: "associations", nom: "Associations", path: "/associations?ref=menu", icon: "people" }] : [])]),
  { key: "communes", nom: "Communes", path: "/communes", icon: "pin" },
];

/**
 * The bar on every page: the brand, the main categories on wide screens, the assistant button and the menu of
 * everything. The vigilance and the volcano lead the bar while in force and leave it when quiet; the sea and the buses
 * are in the menu only. The traffic joins the bar once it has data of its own (a measure of the jams, not the media).
 * Five or six links in the bar: their names without their icons, and the accounts in the menu below 75rem, so that the
 * bar never scrolls.
 */
function header(path: string, origin: string, u: Urgent): string {
  // Without the ?ref= a link may carry: the clubs' space is still the page shown.
  const current = (p: string) => (inCategory(path, p.split("?")[0]) ? ' aria-current="page"' : "");
  const menu = byUse(MENU.filter((m) => m.key !== "associations" || enLigne()), u);
  const quick = [...urgentKeys(u), ...FIRST, "communes"].map((k) => menu.find((m) => m.key === k)!)
    .map((m) => `<a class="k-${m.key}" href="${m.path}"${current(m.path)}>${icon(m.icon)}${esc(m.nom)}</a>`).join("");
  const grid = menu.map((m) => `<li><a class="k-${m.key}" href="${m.path}"${current(m.path)}><span class="kb">${icon(m.icon)}</span><span class="gn">${esc(m.nom)}</span></a></li>`).join("");
  // The accounts in the bar on wide screens; on a phone, in the menu, so that the bar keeps to the brand and two buttons.
  const top = accountLinks(SOCIAL, true);
  const sheet = accountLinks();
  return `<header class="top"><div class="wrap bar">
  <a class="brand" href="/">${logo()}<span>rundata<span class="tld">.re</span></span></a>
  <nav class="quick" aria-label="Principales catégories">${quick}</nav>
  ${top.length ? `<nav class="follow-top" aria-label="Suivre rundata.re">${top.join("")}</nav>` : ""}
  <a class="cta-ia" href="/#assistant">${icon("spark")}<span>Mon IA</span></a>
  <details class="menu"><summary aria-label="Toutes les catégories"><span class="g">${icon("grid")}</span><span class="x">${icon("close")}</span></summary>
    <nav class="sheet" aria-label="Catégories"><div class="wrap">
      <p class="sheet-h">Toute l'île en direct</p>
      <ul class="grid">${grid}</ul>
      ${sheet.length ? `<p class="sheet-h">Suivre rundata.re</p>\n      <p class="social sheet-follow">${paired(sheet)}</p>` : ""}
      <p class="sheet-h">Le connecteur pour votre IA</p>
      ${connector(origin, "mcp-url-menu")}
      <p class="sheet-h">Sur votre téléphone</p>
      <p><a class="sheet-app" href="/application">Mettre rundata.re sur l'écran d'accueil →</a></p>
    </div></nav>
  </details>
</div></header>`;
}

/** The picture of the page's section in link previews (scripts/build-og.py, served from public/og/), else the site's. */
function ogImage(origin: string, path: string): { src: string; alt: string } {
  const r = rubriques.find((x) => x.pages.some((p) => inCategory(path, p)));
  return r ? { src: `${origin}${r.png}`, alt: r.alt } : { src: `${origin}/og.png?v=${og.v}`, alt: OG_ALT };
}

/** What the page's banners say is in force, or its own alert block: the offline page, kept for days, says nothing. */
const urgent = (head: Head): Urgent => (head.shell ? {} : { vigilance: !!head.alerte, volcan: !!head.volcan || !!volcanBanner() });

const SOURCES = '<p class="sources">';

/**
 * The page's « Sources : » paragraphs taken out of its body, to be said last, in small, just above the footer: the
 * producers and their licences in full, as the licences ask, without taking a phone's screen before the links (the
 * user, 28/10/2026). They hold no paragraph of their own.
 */
export function sourcesLast(body: string): [string, string[]] {
  const sources: string[] = [];
  let main = "";
  let from = 0;
  for (let at = body.indexOf(SOURCES); at >= 0; at = body.indexOf(SOURCES, from)) {
    const end = body.indexOf("</p>", at) + "</p>".length;
    main += body.slice(from, at);
    sources.push(body.slice(at, end));
    from = end;
  }
  return [main + body.slice(from), sources];
}

/** The JSON-LD's « description » values, at every depth, as the metas' (a raw text: typo() only turns spaces into no-break ones). */
const frenchDescriptions = (key: string, value: unknown) => (key === "description" && typeof value === "string" ? typo(value) : value);

export function layout(origin: string, head: Head, band: string, body: string): string {
  // A page that names its own sources has, in its footer, only the link to them all; the others keep the site's.
  const [main, sources] = sourcesLast(body);
  const map = sources.length ? mapCredit(band + main) : undefined;
  if (map) sources.push(map);
  // The IGN's background a visitor picks on a zoomed map (web/map.ts, FONDS), named by its script in the footer's credit.
  const choix = !map && main.includes('class="tabs fonds"') ? '<span class="fd-c"></span>' : "";
  const url = `${origin}${head.path}`;
  // The descriptions in French typography like the page's text, with the no-break space itself, never « &nbsp; »: their
  // length is unchanged. Not the titles, nor the JSON-LD's other values (marketing, 25/10).
  const d = typo(esc(head.description));
  const image = ogImage(origin, head.path);
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(head.title)}</title>
<meta name="description" content="${d}">
${head.noindex ? `<meta name="robots" content="noindex">\n` : ""}${head.referrer ? `<meta name="referrer" content="${esc(head.referrer)}">\n` : ""}<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="${icons["192"]}" type="image/png" sizes="192x192">
<link rel="manifest" href="/manifest.webmanifest">
${head.rss ? `<link rel="alternate" type="application/rss+xml" title="${esc(head.rss.title)}" href="${esc(head.rss.href)}">\n` : ""}<link rel="apple-touch-icon" href="${icons["180"]}">
<meta name="apple-mobile-web-app-title" content="rundata.re">
<link rel="preload" href="${FONT_PATH}" as="font" type="font/woff2" crossorigin>
<meta name="theme-color" content="#0b1f36">
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="${SITE}">
<meta property="og:title" content="${esc(head.title)}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image.src)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(image.alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(head.title)}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${esc(image.src)}">
<meta name="twitter:image:alt" content="${esc(image.alt)}">
${head.jsonld.length ? `<script type="application/ld+json">${JSON.stringify(head.jsonld.length === 1 ? head.jsonld[0] : head.jsonld, frenchDescriptions).replace(/</g, "\\u003c")}</script>\n` : ""}<link rel="stylesheet" href="${STYLE_PATH}">
</head>
<body>
${header(head.path, origin, urgent(head))}
${head.shell ? "" : `${banner(head.alerte, head.path)}
${head.volcan ? "" : bannerHtml(volcanBanner(), head.path)}`}
<div class="band">${head.shell || head.noindex ? "" : fond(head.path, head.alerte, !!urgent(head).volcan, head.vert)}${withHook(band, head.path, head.volcan, head.hook)}</div>
<main class="wrap">
${mentionLinks(main)}
</main>
${head.shell ? "" : `${head.sansPartage ? "" : share(origin, head)}
${head.sansAvis ? "" : `${aide()}
${avisForm(head.path)}`}`}
${sources.length ? `<div class="wrap fin-sources">${sources.join("\n")}</div>\n` : ""}<footer class="foot"><div class="wrap">
  <div>
    <a class="brand" href="/">${logo()}<span>rundata.re</span></a>
    ${SLOGAN}
    <p>La Réunion 974 en direct, pour vous et votre assistant IA.</p>
    ${head.rss ? `<p><a href="${esc(head.rss.href)}" title="${esc(head.rss.hint)}">${esc(head.rss.link)}</a></p>` : ""}
    <p>reunion-temps-reel ${VERSION} · <a href="${GITHUB}">code libre (MIT)</a> · <a href="/valeurs">nos valeurs</a> · <a href="/application">sur votre écran d'accueil</a> · <a href="/ouvrir-ses-donnees">ouvrir ses données</a> · aucun cookie, statistiques de visite anonymes · <a href="/confidentialite">confidentialité</a> · <a href="/conditions">conditions et mentions légales</a> · <a href="/a-propos">qui fait rundata.re ?</a> · <a href="/chiffres">rundata.re en chiffres</a> · <a href="/presse">presse</a> · <a href="/nouveautes">nouveautés</a> · <a href="/publier">publier vos données</a> · contact@rundata.re</p>
    <p>Référencé sur <a href="${DATAGOUV_REUSE}">data.gouv.fr</a>, la plateforme des données publiques françaises, et sur <a href="${GLAMA}">Glama</a>, l'annuaire des serveurs MCP.</p>
    ${follow()}
    <ul class="pages" aria-label="Catégories">${WITH_PAGE.map((c) => `<li><a href="${c.path}">${esc(c.nom)}</a></li>`).join("")}<li><a href="/communes">Communes</a></li><li><a href="/meteo#communes">Météo par commune</a></li>${enLigne() ? `<li><a href="/associations">Clubs et associations</a></li>` : ""}</ul>
  </div>
  <div>
    ${sources.length ? `<p><a href="/chiffres">Toutes les sources →</a></p>` : `<h3>Sources</h3>
    <p>Mesures : stations Météo-France de La Réunion (Licence Ouverte Etalab 2.0), aéroports Roland-Garros et Pierrefonds (METAR), balises de vent de la FFVL (Licence Ouverte 2.0) et <a href="https://openwindmap.org">OpenWindMap</a>, température de la mer par satellite NOAA CoastWatch et NASA MODIS (domaine public). Prévisions : AROME outre-mer de Météo-France (Licence Ouverte), modèle IFS et ensemble ENS de l'ECMWF, <a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a> (CC BY 4.0). Vigilance et radar : Météo-France. Cyclones : CMRS de La Réunion (Météo-France), via GDACS ; côtes Natural Earth (domaine public). Historique : données climatologiques quotidiennes de Météo-France depuis 1900. Volcan : préfecture de La Réunion, OVPF-IPGP (CC BY 4.0), et en dernier recours <a href="https://pitonlive.com">pitonlive.com</a> (site non officiel). Électricité : EDF SEI. Air : Atmo Réunion (ODbL). Services publics : service-public.fr. Bus : horaires publiés par les réseaux sur transport.data.gouv.fr. Vélos : Altervélo (CIVIS, Ecovélo). Terrain et risques : IGN, DGFiP, Géoportail de l'urbanisme, DEAL Réunion, Géorisques (BRGM), DVF du Cerema. Toutes sous Licence Ouverte sauf mention. Randonnée : ONF La Réunion ; itinéraires et traces © contributeurs OpenStreetMap (ODbL). Lieux : © contributeurs OpenStreetMap (ODbL), IGN, geo.api.gouv.fr. Relief, photographies aériennes, routes et noms des cartes : IGN, RGE ALTI, couche Photographies aériennes de la Géoplateforme et BD TOPO${choix}. Police des titres : Bricolage Grotesque (SIL OFL).</p>`}
    <p>Ces données sont fournies telles quelles, sans garantie. Pour un cyclone ou de fortes pluies, seules comptent la vigilance de <a href="https://meteofrance.re/">Météo-France La Réunion</a> et les consignes de la préfecture.</p>
    <p><a href="/publier">Votre organisation publie un agenda ou des données ? Le guide pour les publier en flux ouvert →</a></p>
  </div>
</div></footer>
<script>${SCRIPT}</script>
</body>
</html>`;
}

export function credits(list: Credit[]): string {
  const seen = new Set<string>();
  return list
    .filter((c) => !seen.has(c.source) && seen.add(c.source))
    .map((c) => `${esc(c.source)} (${esc(c.licence)})`)
    .join(" ; ");
}

function age(iso: string, now: Date): string {
  return `${hm(iso)}, ${since(iso, now)}`;
}

export function windText(s: StationNow): string | undefined {
  if (s.vent == null) return undefined;
  const dir = s.direction != null ? `${compassFr(s.direction)} ` : "";
  return `vent ${dir}${s.vent} km/h${s.rafales != null ? `, rafales ${s.rafales} km/h` : ""}`;
}

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
const compassFr = (d: number) => POINTS[Math.round(d / 22.5) % 16];

function rainText(s: StationNow): string | undefined {
  if (s.pluie_6min != null && s.pluie_6min > 0) return `il pleut : ${fr(s.pluie_6min)} mm en 6 min`;
  if (s.pluie_1h != null && s.pluie_1h > 0) return `${fr(s.pluie_1h)} mm de pluie dans l'heure`;
  if (s.pluie_1h === 0) return "pas de pluie depuis 1 h";
  return undefined;
}

export const shortName = (n: string) =>
  n.replace(/ \(aéroport\)$/, "").replace(/^Saint-Denis Gillot$/, "Gillot").replace(/^Gros Piton Sainte-Rose$/, "Sainte-Rose");
// « Plage de la Saline les Bains » → « La Saline les Bains »: a name in a tile or a sentence starts with a capital.
export const seaName = (n: string) => n.replace(/^Plage (de |du )?/, "").replace(/^\p{Ll}/u, (c) => c.toUpperCase());
export const dayMonth = (ymd: string) => ymd.split("-").reverse().slice(0, 2).join("/");

/** The row of a station on /meteo, where its marker on the maps leads. */
export const stationId = (nom: string) => `st-${slugify(nom)}`;
/** The row or card of a place on a page, where the map's marker or commune leads: « c-saint-pierre ». */
export const anchorId = (prefix: string, nom: string) => `${prefix}-${slugify(nom)}`;

function stationItem(s: StationNow, now: Date): string {
  const t = s.temperature != null
    ? `<span class="t" style="background:${chip(s.temperature)}">${thin(deg(s.temperature))}</span>`
    : `<span class="t na">${s.vent != null ? thin(`${s.vent} km/h`) : "—"}</span>`;
  const details = [s.humidite != null ? `humidité ${s.humidite} %` : undefined, windText(s), rainText(s)].filter(Boolean).join(" · ");
  const old = s.stale || ageMinutes(new Date(s.time), now) > 90 ? " (mesure ancienne)" : "";
  return `<li class="st tgt" id="${stationId(s.nom)}">${t}<h4>${esc(s.nom)} <small>${metres(s.altitude_m)}</small></h4>` +
    `<p>${esc(thin(details || "température seulement"))} · <span class="when">mesuré à ${age(s.time, now)}${old}</span></p></li>`;
}

export const EXTERNAL = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>`;

// The two languages of the question, with their flags: Lo Mahavéli for Réunion Creole (no emoji shows it everywhere).
const FLAG_RCF = `<svg viewBox="0 0 60 40" aria-hidden="true">${FLAG_INNER}</svg>`;
const FLAG_FR = `<svg viewBox="0 0 3 2" aria-hidden="true"><path fill="#002654" d="M0 0h1v2H0z"/><path fill="#fff" d="M1 0h1v2H1z"/><path fill="#ce1126" d="M2 0h1v2H2z"/></svg>`;

/**
 * « Domann out IA » (Réunion Creole: « demande à ton IA »): buttons that open ChatGPT or Claude in a new tab with the
 * question already typed, asking it to read the page. The way in for people on a free plan, or who will not add a
 * connector. A switch picks Creole (the default) or French, which the assistants answer more surely; the choice
 * holds for every box and is remembered.
 * On the click, the page's address in the question gets the time (`?maj=12h47`, Réunion time; the pages ignore it):
 * the assistants keep their own copy of a page they have read, and a new address makes them read it again rather
 * than answer from a copy taken minutes or hours earlier. Added by the script, not in the HTML, so that search
 * engines do not follow the copies; without the script, the plain address.
 * The links' parameters are not documented by either service.
 * On a phone, ChatGPT's app leaves the question out (Android) or does not open (iPhone: chatgpt.com has no universal
 * link), and no documented scheme types it: the tap also copies the question, and a line says so (copies).
 */
export function ask(kreol: string, francais: string): string {
  const a = (href: string, name: string, page?: string) =>
    `<a href="${href}" target="_blank" rel="nofollow noopener"${page ? ` data-maj="${esc(page)}"` : ""}` +
    `${name === "ChatGPT" ? copies("", "Question copiée : collez-la dans ChatGPT si elle n'y est pas.", "Si la question n'est pas dans ChatGPT, recopiez-la ci-dessous.") : ""}>${name} ${EXTERNAL}</a>`;
  const block = (l: string, title: string, question: string, hidden: boolean) => {
    const q = encodeURIComponent(question);
    const page = /https?:\/\/\S+/.exec(question)?.[0];
    return `<div data-l="${l}" lang="${l}"${hidden ? " hidden" : ""}><p class="askt">${title}</p>` +
      `<p class="ask">${a(`https://chatgpt.com/?hints=search&amp;q=${q}`, "ChatGPT", page)}${a(`https://claude.ai/new?q=${q}`, "Claude", page)}</p>${COPIED}` +
      `<p class="askq">« ${esc(question)} »</p></div>`;
  };
  const b = (l: string, flag: string, name: string, on: boolean) =>
    `<button type="button" data-askl="${l}" aria-pressed="${on}">${flag}${name}</button>`;
  return `<div class="askbox"><div class="lang" role="group" aria-label="Langue de la question">` +
    `${b(brand.slogan_lang, FLAG_RCF, "Kréol", true)}${b("fr", FLAG_FR, "Français", false)}</div>` +
    block(brand.slogan_lang, "Domann out IA", kreol, false) + block("fr", "Demandez à votre IA", francais, true) +
    `<p class="askn">Rien à installer : la question est déjà écrite. ChatGPT marche même sans compte ; Claude demande de se connecter (compte gratuit).</p></div>`;
}

/**
 * A link that, tapped on a phone, also copies `text` (empty: its `q` parameter, as the script last wrote it) and says
 * so in the line that follows its paragraph (COPIED): `ok` once copied, `non` when the browser refuses. On a computer,
 * nothing more than the link.
 */
export const copies = (text: string, ok: string, non: string) =>
  ` data-copie="${esc(text)}" data-ok="${esc(ok)}" data-non="${esc(non)}"`;
// In French, as the words of the site around it, even under a question in Creole.
export const COPIED = `<p class="copie" role="status" lang="fr" hidden></p>`;

/** The connector's address with its copy button; `id` keeps several on one page apart. */
export function connector(origin: string, id: string): string {
  // Cut after its last « / » when it does not fit, never inside « mcp » (31/10/2026: « https://rundata.re/m | cp »).
  return `<div class="connect"><code id="${id}">${esc(origin)}/<wbr>mcp</code><button type="button" data-copy="${id}" data-signal aria-label="Copier l'adresse du connecteur">Copier</button></div>`;
}

export const withTemp = (data: Cached<HomeData> | null) => data?.value.stations.filter((x) => x.temperature != null && !x.stale) ?? [];
export const coldest = (l: StationNow[]) => l.reduce((a, b) => (b.temperature! < a.temperature! ? b : a));
export const warmest = (l: StationNow[]) => l.reduce((a, b) => (b.temperature! > a.temperature! ? b : a));

/** The map and every station, from the coast to the summits. */
function weatherLive(data: Cached<HomeData> | null, now: Date): string {
  if (!data) {
    return `<p class="card">Les mesures se chargent : rechargez la page dans quelques secondes. Les stations Météo-France publient toutes les 6 minutes.</p>`;
  }
  const d = data.value;
  const sorted = [...d.stations].sort((a, b) => a.altitude_m - b.altitude_m);
  const latest = d.stations.reduce((m, s) => (s.time > m ? s.time : m), "");
  const markers: Marker[] = d.stations.map((s) =>
    s.temperature != null
      ? { lon: s.lon, lat: s.lat, label: `${Math.round(s.temperature)}°`, say: `${Math.round(s.temperature)} °C`, name: shortName(s.nom), color: chip(s.temperature), round: true, href: `#${stationId(s.nom)}` }
      : { lon: s.lon, lat: s.lat - 0.022, label: `${s.vent ?? "—"} km/h`, say: s.vent != null ? `vent ${s.vent} km/h` : "pas de mesure", name: s.nom.split(" ").pop()!, color: "#44555a", href: `#${stationId(s.nom)}` },
  );
  return `<div class="live"><figure class="card mapcard">` +
    islandMap({ markers, peaks: true, label: `Carte de La Réunion (974) avec les températures mesurées à ${hm(latest || data.fetchedAt.toISOString())}` }) +
    `<figcaption class="legend">8 °C<i></i>33 °C · températures mesurées sous abri</figcaption></figure>` +
    `<div class="card"><h3>Station par station</h3><ul class="stations">${sorted.map((s) => stationItem(s, now)).join("")}</ul>` +
    `${d.indisponibles.length ? `<p class="note">Momentanément indisponible : ${esc(d.indisponibles.join(", "))}.</p>` : ""}</div></div><p class="sources">Sources : ${credits(d.sources)}.</p>`;
}

/** Every station, filtered by commune and sorted by the page's script; without it, by altitude. */
function stationsList(all: StationNow[], now: Date): string {
  const rows = [...all].sort((a, b) => a.altitude_m - b.altitude_m).map((s) => {
    const c = communeOf(s, all) ?? "";
    const t = s.temperature != null ? `<span class="t" style="background:${chip(s.temperature)}">${thin(deg(s.temperature))}</span>` : `<span class="t na">—</span>`;
    const pills = windPill(s) + rainPill(s);
    const old = s.stale || ageMinutes(new Date(s.time), now) > 90 ? " (ancienne)" : "";
    const day = localTime(new Date(s.time)).split(" ")[0] !== localTime(now).split(" ")[0] ? `${dayMonth(localTime(new Date(s.time)).split(" ")[0].split("/").reverse().join("-"))} ` : "";
    return `<li class="st tgt" id="${stationId(s.nom)}" data-c="${esc(c)}" data-z="${s.altitude_m}" data-t="${s.temperature ?? ""}" data-n="${esc(s.nom)}">` +
      `<p class="th">${t}<span class="when">${day}${hm(s.time)}${old}</span></p><h4>${s.source === "meteofrance" && s.id && stationOf(s.id) ? `<a href="${stationPath(s.id)}">${esc(s.nom)}</a>` : esc(s.nom)}</h4><p class="ou">${esc(c)} · ${metres(s.altitude_m)}</p>` +
      `${pills ? `<p class="pls">${pills}</p>` : ""}</li>`;
  }).join("");
  const communes = [...new Set(all.map((s) => communeOf(s, all)).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "fr"));
  const tools = `<div class="sttools" data-js hidden><label>Commune <select id="stc"><option value="">Toutes</option>${communes.map((c) => `<option>${esc(c)}</option>`).join("")}</select></label>` +
    `<div class="sttri"><span id="sttri">Trier par</span><span class="tabs" role="group" aria-labelledby="sttri"><button type="button" data-s="z" aria-pressed="true">Altitude</button><button type="button" data-s="t" aria-pressed="false">Température</button><button type="button" data-s="n" aria-pressed="false">Nom</button></span></div></div>`;
  const more = all.length > 12 ? `<p data-js hidden><button type="button" class="stmore" id="stm">Voir les ${all.length} stations</button></p>` : "";
  return `${tools}<ul class="stations${more ? " plie" : ""}" id="stl">${rows}</ul>${more}`;
}

/**
 * Every place page as a chip, with a filter box (the script at the end of the page). With `hubs`, the communes lead
 * to their page of every category rather than their weather.
 */
export function placeLinks(except?: string, hubs = false): string {
  const li = (p: PlacePage) => `<li><a href="/${hubs && p.commune ? "communes" : "meteo"}/${p.slug}">${esc(p.nom)}</a></li>`;
  const others = PAGES.filter((p) => p.slug !== except);
  return `<label class="search">${icon("search")}<span class="sr">Chercher une commune ou un lieu</span>` +
    `<input id="filtre" type="search" placeholder="Saint-Leu, Cilaos, le volcan…" autocomplete="off"></label>` +
    `<div class="places"><h3>${except ? "Les communes" : "Les 24 communes"}</h3><ul class="chips">${others.filter((p) => p.commune).map(li).join("")}</ul>` +
    `<h3>Cirques, volcan, plages</h3><ul class="chips">${others.filter((p) => !p.commune).map(li).join("")}</ul>` +
    `<p class="note" id="rien" hidden>Pas de page pour ce nom : votre assistant, lui, connaît plus de 2 000 lieux de l'île.</p></div>`;
}

const WEATHER_NOTES = `<section aria-labelledby="h-lire">
  <div class="sec-h"><p class="eyebrow">Bon à savoir</p><h2 id="h-lire">Comment lire ces données</h2></div>
  <div class="three">
    <div class="card">${icon("gauge")}<h3>Une mesure n'est pas une prévision</h3><p>Ce qui est affiché comme mesuré vient d'un capteur, avec son heure. Les prévisions viennent de modèles (AROME de Météo-France, puis le modèle européen) et portent toujours l'étiquette <span class="badge">Prévision</span>.</p></div>
    <div class="card">${icon("mountain")}<h3>Une île, cent microclimats</h3><p>La Réunion passe de 0 à 3 000 m en 20 km, du versant au vent (Saint-Benoît, Sainte-Rose) au versant sous le vent (Saint-Paul, Saint-Leu). Chaque réponse dit quelle station a mesuré, à quelle distance et à quelle altitude.</p></div>
    <div class="card warn">${icon("alert")}<h3>Cyclone, fortes pluies : la vigilance officielle d'abord</h3><p>Pour une alerte cyclonique ou une vigilance fortes pluies, orages ou houle, référez-vous à <a href="https://meteofrance.re/">Météo-France La Réunion</a> et à la préfecture. La vigilance en cours, zone par zone : <a href="/vigilance">page vigilance</a>.</p></div>
  </div>
</section>`;

export const ISLAND = {
  "@type": "Place",
  name: "La Réunion (974)",
  geo: { "@type": "GeoShape", box: "-21.41 55.19 -20.85 55.86" },
  containedInPlace: { "@type": "Country", name: "France" },
};

/** What a page shows about a category in a few words, for the tiles of the home page. */
export interface Live {
  /** The figure or the state, HTML. */
  valeur: string;
  /** Where, when, from whom, HTML. */
  detail: string;
  /** Whose word the value is, said under it where the value is shown without its detail (the home page's hero). */
  source?: string;
  /** The detail in full, plain text, when the tile shows it shortened (its `title`). */
  title?: string;
  /**
   * A copy read with nothing to show: its detail alone, one line saying what was read and when, in place of a figure;
   * not among the figures under the home page's title. Said in full, never cut: its hour is at its end.
   */
  vide?: boolean;
  /** The detail said in full on a phone, where the others are cut after three lines: its source and date at its end. */
  entier?: boolean;
}

/** A tile's line for a copy read with nothing to show (`vide`), in plain text. */
export const empty = (line: string): Live => ({ valeur: "", detail: esc(line), vide: true });

const range = (lo: number, hi: number) => `${fr(Math.round(lo))} à ${thin(deg(Math.round(hi)))}`;

export function meteoLive(data: Cached<HomeData> | null, now = new Date()): Live | undefined {
  const l = withTemp(data);
  if (!data) return undefined;
  if (!l.length) return empty(`Aucune température dans la lecture des stations ${readAt(data.fetchedAt, now).de}.`);
  const lo = coldest(l);
  const hi = warmest(l);
  const latest = data.value.stations.reduce((m, s) => (s.time > m ? s.time : m), "");
  return {
    valeur: range(lo.temperature!, hi.temperature!),
    detail: `${esc(shortName(lo.nom))} (${metres(lo.altitude_m)}) à ${esc(shortName(hi.nom))}, mesuré à ${hm(latest)}`,
  };
}

export function merLive(data: Cached<HomeData> | null, now = new Date()): Live | undefined {
  if (!data) return undefined;
  const mer = data.value.mer ?? [];
  if (!mer.length) return empty(`Pas de mesure satellite de la mer dans la lecture ${readAt(data.fetchedAt, now).de}.`);
  const v = mer.map((m) => m.valeur);
  return {
    valeur: Math.round(Math.min(...v)) === Math.round(Math.max(...v)) ? thin(deg(Math.round(v[0]))) : range(Math.min(...v), Math.max(...v)),
    detail: `au large des plages, par satellite le ${esc(dayMonth(mer.map((m) => m.jour).sort().pop()!))}`,
  };
}

export function vigilanceLive(data: Cached<mf.Vigilance> | null, now: Date): Live | undefined {
  const v = data?.value;
  if (!v) return undefined;
  const cyc = v.zones[mf.ISLAND]?.[mf.CYCLONE] ?? [];
  if (highest(cyc) >= 2) {
    const c = Math.max(2, cycloneLevel(cyc, now));
    return officielLive(lue({ valeur: `<span class="vg ${cycloneVg(c)}">Cyclone : ${esc(mf.cycloneName(c))}</span>`, detail: esc(cyclone(v, now)) }, data!, now), mf.OFFICIEL_CYCLONE);
  }
  const r = raised(v);
  if (!r.length) {
    // Green only when Météo-France issued it for the whole island, never in place of a bulletin without it.
    const l = islandGreen(v, now)
      ? { valeur: vg(1), detail: "Pas d'alerte cyclonique ni de vigilance particulière" }
      : { valeur: esc(NONE_ISSUED_SAID), detail: esc(cyclone(v, now).replace(/\.$/, "")) };
    return officielLive(lue(l, data!, now), mf.OFFICIEL_VIGILANCE);
  }
  return officielLive(lue({
    valeur: vg(r[0].max),
    detail: esc(r.slice(0, 2).map((x) => `${x.phenomene.toLowerCase()} (${x.zone.split(" :")[0]})`).join(", ") + (r.length > 2 ? "…" : "")),
  }, data!, now), mf.OFFICIEL_VIGILANCE);
}

/** A vigilance tile's line, then the link to Météo-France's own site, never cut. */
export function officielLive(l: Live, href: string): Live {
  return { ...l, detail: `${l.detail}. ${officielHtml(href)}`, entier: true };
}

/** A vigilance tile's line, with when it was read once more than 15 min ago (`vigilanceLue`), said in full at its end. */
export function lue(l: Live, data: Cached<unknown>, now: Date): Live {
  const when = vigilanceLue(data.fetchedAt, now);
  return when ? { ...l, detail: `${l.detail} · ${esc(when)}`, entier: true } : l;
}

/** The island's weather: every station, from the coast to the summits, the sea, and a page per commune or place. */
export function meteoPage(origin: string, data: Cached<HomeData> | null, now = new Date(), alerte?: Alerte): string {
  const l = withTemp(data);
  const all = data?.value.toutes ?? [];
  // The page's figure, not a tile's line for a copy with no temperature (`vide`).
  const live = l.length ? meteoLive(data) : undefined;
  const url = `${origin}/meteo`;
  const latest = data?.value.stations.reduce((m, s) => (s.time > m ? s.time : m), "");

  const status = live
    ? `<div class="now"><span class="big span">${live.valeur}</span><p>mesurés sous abri par les stations de l'île, de <b>${esc(shortName(coldest(l).nom))}</b> (${metres(coldest(l).altitude_m)}) à <b>${esc(shortName(warmest(l).nom))}</b>. Dernière mesure à <b>${hm(latest!)}</b>.</p></div>`
    : `<p class="lead">Les mesures se chargent : rechargez la page dans quelques secondes. Les stations Météo-France publient toutes les 6 minutes.</p>`;

  const sea = data?.value.mer.length
    ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">La mer au large</h3><ul class="bars">` +
      data.value.mer.map((m) => `<li><span>${esc(seaName(m.nom))}</span><b>${thin(deg(m.valeur))}</b></li>`).join("") +
      `</ul><p class="note">Par satellite, le ${esc(dayMonth(data.value.mer.map((m) => m.jour).sort().pop()!))}. <a href="/mer">Toutes les plages →</a></p></figure>`
    : "";

  const title = "Météo Réunion 974 en direct : stations et prévisions";
  const description = live
    ? fit(`Météo à La Réunion (974) en direct : de ${thin(deg(coldest(l).temperature!))} à ${shortName(coldest(l).nom)} à ${thin(deg(warmest(l).temperature!))} à ${shortName(warmest(l).nom)}, mesurés à ${hm(latest!)}.`,
        " Pluie, vent, mer et prévisions par commune.")
    : "Météo à La Réunion (974) en direct : température, pluie et vent mesurés par les stations de l'île, mer et prévisions par commune.";

  const jsonld = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE, item: `${origin}/` },
        { "@type": "ListItem", position: 2, name: "Météo", item: `${origin}/meteo` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "Mesures météo en direct à La Réunion (974)",
      description:
        "Température, humidité, vent et pluie mesurés par les stations de La Réunion toutes les 6 minutes, et température " +
        "de surface de la mer par satellite, réunis et datés, accessibles par un serveur MCP pour assistants IA.",
      url: `${origin}/meteo`,
      isAccessibleForFree: true,
      inLanguage: "fr-FR",
      keywords: ["météo", "La Réunion", "974", "en direct", "stations météo", "température de la mer", "pluie", "vent"],
      spatialCoverage: ISLAND,
      variableMeasured: ["température de l'air", "humidité", "vent moyen", "rafales", "pluie", "température de la mer"],
      measurementTechnique: "stations météorologiques au sol, radiomètres satellitaires",
      // The stations' licence; the satellites' data is in the public domain (page /mer).
      license: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
      creator: [
        { "@type": "Organization", name: "Météo-France", url: "https://meteofrance.re/" },
        { "@type": "Organization", name: "NOAA", url: "https://www.noaa.gov/" },
      ],
      ...(data ? { dateModified: data.fetchedAt.toISOString() } : {}),
    },
  ];

  const band = `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li aria-current="page">Météo</li></ol></nav></div>
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Mesures en direct</p>
    <h1>Météo à La Réunion <span class="n974">974</span></h1>
    ${status}
    ${ask(`I fé koman lo tan La Rényon astèr ? Gèt bann mézir an dirèk si ${url} é di amwin lèr la mézir.`,
      `Quel temps fait-il en ce moment à La Réunion ? Lis les mesures en direct sur ${url} et donne-moi l'heure des mesures.`)}
  </div>
  ${all.length ? stationsMap(all) : sea}
</div>`;

  const body = all.length ? `<section id="stations" aria-labelledby="h-stations">
  <div class="sec-h"><p class="eyebrow">En direct</p><h2 id="h-stations">Les ${all.length} stations, de la côte aux sommets</h2>
  <p>La dernière mesure de chaque station, avec son heure. Les stations de Météo-France publient toutes les 6 minutes.</p></div>
  ${stationsList(all, now)}
  <p class="sources">Sources : ${credits([...data!.value.sources, ALTITUDES_CREDIT, RADAR_CREDIT])}.</p>
</section><script>${METEO_SCRIPT}</script>
${sea ? `<section id="mer" aria-labelledby="h-mer"><div class="sec-h"><p class="eyebrow">La mer</p><h2 id="h-mer">La mer au large</h2></div>${sea}</section>` : ""}
<section id="communes" aria-labelledby="h-communes">
  <div class="sec-h"><p class="eyebrow">Prévisions</p><h2 id="h-communes">Prévision par commune et par lieu</h2>
  <p>Pour chaque commune, les cirques, le volcan et les plages : la mesure de la station qui représente le mieux le lieu (proche, à une altitude voisine, du même versant) et la prévision sur 7 jours, aujourd'hui compris (une <b>prévision</b> de modèle, pas une mesure).</p></div>
  ${placeLinks()}
</section>` : `<section id="en-ce-moment" aria-labelledby="h-live">
  <div class="sec-h"><p class="eyebrow">En direct</p><h2 id="h-live">De la côte aux sommets</h2>
  <p>Les températures, la pluie et le vent mesurés par les stations de l'île, de Saint-Denis au Maïdo, de Cilaos à Saint-Pierre. Toutes les 6 minutes, datés et sourcés.</p></div>
  ${weatherLive(data, now)}
</section>
<section id="communes" aria-labelledby="h-communes">
  <div class="sec-h"><p class="eyebrow">Partout sur l'île</p><h2 id="h-communes">Météo par commune et par lieu</h2>
  <p>La station la plus pertinente, la température de la mer sur la côte et la prévision des prochains jours, pour chaque commune, les cirques, le volcan et les plages.</p></div>
  ${placeLinks()}
</section>
<section class="card cta" aria-labelledby="h-ia">
  <h2 id="h-ia">Votre IA, branchée sur la météo de l'île</h2>
  <p>Avec le connecteur, votre assistant va chercher lui-même la mesure de la station la plus pertinente (outils <code>meteo_actuelle</code> et <code>prevision_meteo</code>), avec son heure et sa source. Gratuit, sans compte. <a href="/#assistant">Comment le brancher</a>.</p>
  ${connector(origin, "mcp-url")}
</section>
${WEATHER_NOTES}`;
  return layout(origin, { title, description, path: "/meteo", jsonld, alerte }, band, body);
}

const KIND: Record<string, string> = {
  commune: "commune",
  localite: "village",
  quartier: "quartier",
  plage: "plage",
  sommet: "sommet",
  point_de_vue: "point de vue",
  bassin: "bassin",
  port: "port",
};

const LABELS: Record<string, string> = {
  humidite: "Humidité",
  vent_moyen: "Vent moyen",
  vent_direction: "Vent venant du",
  rafales: "Rafales",
  pluie_6min: "Pluie (6 dernières min)",
  pluie_1h: "Pluie (dernière heure)",
  ciel: "Ciel",
  temps_present: "Temps",
  visibilite: "Visibilité",
};

function stationCard(s: StationAnswer): string {
  const m = s.mesures;
  const main = m.temperature ?? m.vent_moyen;
  const rows = Object.entries(m)
    .filter(([k]) => k !== "temperature" && k !== "point_de_rosee" && k !== "pression_mer")
    .map(([k, v]) => `<li>${esc(LABELS[k] ?? k.replace(/_/g, " "))} : ${esc(thin(v.replace(/ \(d'où vient le vent\)| en (6 min|1 h)$/g, "")))}</li>`)
    .join("");
  const t = parseFloat((m.temperature ?? "").replace(",", "."));
  const meta = [
    s.distance_km != null ? `à ${fr(s.distance_km)} km${s.direction ? ` (${s.direction})` : ""}` : undefined,
    `${s.altitude_m.toLocaleString("fr-FR")} m d'altitude`,
    s.pertinence ? `pertinence ${s.pertinence}` : undefined,
  ].filter(Boolean).join(" · ");
  return `<div class="card stcard"><h3>${esc(s.station)}</h3><p class="note">${esc(thin(meta))}</p>` +
    (main ? `<p><span class="t" style="background:${Number.isFinite(t) ? chip(t) : "#44555a"}">${esc(thin(main))}</span></p>` : "") +
    (rows ? `<ul>${rows}</ul>` : "") +
    `<p class="note">Mesuré à ${esc(s.heure_mesure.split(" ")[1] ?? s.heure_mesure)} heure de La Réunion.</p>` +
    (s.avertissements.length ? `<p class="note">⚠ ${esc(s.avertissements.join(" "))}</p>` : "") +
    `</div>`;
}

export function placePage(origin: string, p: PlacePage, data: Cached<PlaceData> | null, now = new Date(), alerte?: Alerte, hikes?: Cached<RandonneesAnswer> | null): string {
  const g = porte(alerte);
  const place = p.place;
  const d = data?.value;
  // The answer's first two are never at the same spot (meteo.ts, sameSpot).
  const stations = (d?.meteo?.stations ?? []).slice(0, 2);
  const first = enTete(d?.meteo?.stations);
  const kind = p.precision ?? KIND[place.type] ?? place.type;
  const where = place.nom !== p.nom ? ` Les mesures et la prévision sont données pour ${esc(place.nom)}.` : "";
  const alt = place.altitude_m != null ? `, à ${place.altitude_m.toLocaleString("fr-FR")} m d'altitude` : "";
  const commune = place.commune && place.commune !== p.nom ? ` (commune de ${esc(place.commune)})` : "";
  const v = versant(place.lon, place.lat);
  const title = `Météo ${p.nom} en direct et prévisions · 974`.length <= 60 ? `Météo ${p.nom} en direct et prévisions · 974` : `Météo ${p.nom} en direct · 974`;
  const description = fit(
    first
      ? `Météo à ${p.nom} (La Réunion, 974) en direct : ${first.mesures.temperature} mesurés à ${first.station} à ` +
        `${first.heure_mesure.split(" ")[1]}.`
      : `Météo à ${p.nom} (La Réunion, 974) en direct : température, pluie et vent mesurés par la station la plus proche.`,
    first ? ` Pluie, vent${coastal(p) ? ", mer" : ""} et prévision.` : ` ${coastal(p) ? "Mer et prévision" : "Prévision"} des prochains jours.`,
  );

  const headline = first
    ? `<div class="now"><span class="big">${esc(thin(first.mesures.temperature!))}</span>` +
      `<p>mesurés à <b>${esc(first.heure_mesure.split(" ")[1] ?? first.heure_mesure)}</b> par la station <b>${esc(first.station)}</b> ` +
      `(${metres(first.altitude_m)}${first.distance_km != null ? `, à ${fr(first.distance_km)} km` : ""}).</p></div>`
    : "";

  const measured = !data
    ? `<p class="card">Les mesures se chargent : rechargez la page dans quelques secondes.</p>`
    : stations.length
      ? `<div class="two">${stations.map(stationCard).join("")}</div>` +
        `<p class="note">Mis à jour à ${hm(data.fetchedAt)} (${since(data.fetchedAt, now)}). Sources : ${credits(d!.meteo!.sources)}.</p>`
      : `<p class="card">Aucune mesure disponible pour le moment.</p>`;

  // In the Hauts, the coming morning's cloud sea, high on the page: « dégagé au Maïdo demain matin ? ». Said less firmly
  // while the nearest station measures the air saturated now.
  const near = stations.find((s) => s.mesures.humidite);
  const wet = near && data ? { nom: near.station, humidite: parseInt(near.mesures.humidite!, 10), mesure: new Date(data.fetchedAt.getTime() - near.age_min * 60_000) } : undefined;
  const mn = d?.prevision?.mer_de_nuages && softened(d.prevision.mer_de_nuages, now, wet);
  // The volcano's page during an alert: the Enclos below the viewpoint is forbidden, whatever the sky.
  const enclos = p.slug === "piton-de-la-fournaise" && volcanBanner() ? ` ${ENCLOS}` : "";
  const cloudSea = mn
    ? `<section id="mer-de-nuages" class="card" aria-labelledby="h-nuages"><h3 id="h-nuages">${esc(mn.titre)}</h3><p>${esc(mn.ligne + enclos)}</p>` +
      `<p class="note">${esc(mn.prevision.charAt(0).toUpperCase() + mn.prevision.slice(1))}. ${esc(mn.mise_en_garde)}</p></section>`
    : "";

  // The next tides at the nearest gauge, computed at the view: no request, whatever the copy's age.
  const tides = coastal(p) ? tidesNear(p.place.lon, p.place.lat, now) : undefined;
  // Away from the gauges, no times: they are not the place's.
  const away = coastal(p) && !tides ? farFrom(p.place.lon, p.place.lat, p.place.commune) : undefined;
  const tideLine = tides
    ? `<p>Marée à ${esc(tides.nom)}, ${esc(TIDE_LABEL)}, à environ ${tides.minutes} min près : ${esc(thin(nextText(tides.next)))}.</p>`
    : away
      ? `<p>Marée : pas d'heures calculées ici, la marée y arrive à une autre heure qu'au Port et à Sainte-Marie, nos deux marégraphes. ` +
        `<a href="${esc(away.lien)}">${away.port ? `Horaires officiels du SHOM pour ${esc(away.port)}` : "Horaires officiels sur le site du SHOM"}</a></p>`
      : "";
  const sea = coastal(p) && d?.mer
    ? `<section aria-labelledby="h-mer"><h2 id="h-mer">Température de la mer à ${esc(p.nom)}</h2>` +
      `<div class="card">${d.mer.mesure ? `<ul class="seas"><li><span>Au large, le ${esc(dayMonth(d.mer.mesure.jour_mesure))}</span><b>${esc(thin(d.mer.mesure.temperature_eau))}</b></li></ul>` : ""}` +
      `<p>${esc(thin(d.mer.resume))}</p>${tideLine}<p class="note">Température : mesure satellite au large, du jour indiqué (une mesure paraît au plus tôt le lendemain), ` +
      `pas celle du lagon ni du bord.${d.mer.etat_de_la_mer ? " Vagues : prévision d'un modèle, au large, pas une mesure." : ""}${tides ? ` Marée : calculée d'après les mesures des marégraphes, hauteurs à environ 5 cm près, <a href="/mer">détail sur la page mer</a>.` : ""} Source : ${credits(d.mer.sources)}${tides ? `, ${esc(TIDE_CITATION)}` : ""}.</p></div></section>`
    : "";

  const f = d?.prevision && { ...d.prevision, jours: joursDuJour(d.prevision.jours, data!.fetchedAt, now) };
  // Why a day is not sure, in plain sight and short (a phone shows no title, a card is half its width). A sure day
  // says nothing more.
  const whyNot = (why?: string) => {
    const short = why && cardReason(why);
    return short ? `<p class="why">${esc(short)}</p>` : "";
  };
  // The tool's own words on the confidence index, said once under the days.
  const confidenceNote = f?.jours?.some((j) => j.confiance) ? f.avertissements?.find((w) => w.startsWith("Confiance :")) : undefined;
  const range = (lo?: string, hi?: string) => (lo && hi ? `${lo.replace(/ °C$/, "°")} / ${hi.replace(/ °C$/, "°")}` : "—");
  const forecast = f?.jours?.length
    ? `<section aria-labelledby="h-prev"><div class="hb"><h2 id="h-prev">Prévision météo ${esc(p.nom)}</h2><span class="badge">Prévision, pas une mesure</span></div>` +
      `<ul class="days">` +
      f.jours.map((j) => `<li class="card day"><h3>${esc(j.jour)}</h3><p class="range">${esc(range(j.temperature_min, j.temperature_max))}</p>` +
        `<p>${esc(j.ciel_en_journee ?? "—")}</p><p>Pluie : ${esc(thin(j.pluie ?? "—"))}</p><p>Rafales : ${esc(thin(j.rafales_max ?? "—"))}</p>` +
        (j.indice_uv_max ? `<p>UV : ${esc(j.indice_uv_max)}</p>` : "") +
        (j.confiance ? `<p>Confiance : <b>${esc(j.confiance)}</b></p>` + whyNot(j.confiance_pourquoi) : "") + `</li>`).join("") +
      `</ul>` +
      (confidenceNote ? `<p class="note">${esc(confidenceNote)}</p>` : "") +
      `<p class="note">${esc(f.modele ? `Modèle ${f.modele.nom}, maille de ${fr(f.modele.maille_km)} km${f.modele.run_du_modele ? `, calcul du ${f.modele.run_du_modele.replace(" ", " à ")}` : ""}. ` : "")}` +
      `Un modèle ne voit pas tous les microclimats de l'île. Cyclone, fortes pluies : seule compte la vigilance de <a href="https://meteofrance.re/">Météo-France La Réunion</a>. ` +
      `Source : ${credits(f.sources)}.</p></section>`
    : "";

  const jsonld = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE, item: `${origin}/` },
        { "@type": "ListItem", position: 2, name: "Météo", item: `${origin}/meteo` },
        { "@type": "ListItem", position: 3, name: `Météo ${p.nom}`, item: `${origin}/meteo/${p.slug}` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description,
      inLanguage: "fr-FR",
      url: `${origin}/meteo/${p.slug}`,
      ...(data ? { dateModified: data.fetchedAt.toISOString() } : {}),
      about: {
        "@type": "Place",
        name: `${p.nom} (La Réunion, 974)`,
        geo: { "@type": "GeoCoordinates", latitude: place.lat, longitude: place.lon, ...(place.altitude_m != null ? { elevation: place.altitude_m } : {}) },
        containedInPlace: ISLAND,
      },
    },
  ];

  const band = `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li><a href="/meteo">Météo</a></li><li aria-current="page">${esc(p.nom)}</li></ol></nav></div>
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Météo en direct</p>
    <h1>Météo à ${esc(p.nom)} <span class="n974">974</span></h1>
    ${SLOGAN}
    ${headline}
    ${ask(`I fé koman lo tan ${p.nom} astèr ? Gèt la mézir an dirèk si ${origin}/meteo/${p.slug} é di amwin lèr la mézir é la stasion.`,
      `Quel temps fait-il en ce moment à ${p.nom} ? Lis la mesure en direct sur ${origin}/meteo/${p.slug} et donne-moi l'heure de la mesure et la station.`)}
    <p class="lead">${esc(p.nom)}, ${esc(kind)}${commune}${alt}, ${esc(v.replace(/ \(.*\)$/, ""))} de l'île${v.includes("(") ? ` (${esc(v.replace(/^.*\(|\)$/g, ""))})` : ""}.${where}</p>
    ${p.commune ? `<p class="or"><a href="/communes/${p.slug}">${esc(p.nom)} en direct : vigilance, air, bus, mairie →</a></p>` : ""}
  </div>
  <figure class="card mapcard">${islandMap({ highlight: p.commune ? p.nom : place.commune, pin: { lon: place.lon, lat: place.lat, name: p.nom }, label: `Carte de La Réunion (974) situant ${p.nom}` })}</figure>
</div>`;

  const body = `<section aria-labelledby="h-now">
  <div class="hb"><h2 id="h-now">Mesuré en ce moment près de ${esc(p.nom)}</h2><span class="badge m">Mesure</span></div>
  ${measured}
</section>
${cloudSea}
<section class="card cta" aria-labelledby="h-ia">
  <h2 id="h-ia">Votre IA, branchée sur la météo de ${esc(p.nom)}</h2>
  <p>Branchez le connecteur une fois sur ChatGPT, Claude ou Le Chat : à chaque « il pleut à ${esc(p.nom)} ? », il ira chercher lui-même la mesure, avec son heure et sa source. Gratuit, sans compte. <a href="/#assistant">Comment le brancher</a>.</p>
  ${connector(origin, "mcp-url")}
</section>
${sea}
${coastal(p) ? bathingBlock(now, { nom: p.nom, lon: p.place.lon, lat: p.place.lat, commune: p.commune ? p.nom : undefined }, g) + g.feuille : ""}
${forecast}
${hikesAround(p, hikes)}
<section aria-labelledby="h-ailleurs">
  <h2 id="h-ailleurs">Météo ailleurs à La Réunion</h2>
  ${placeLinks(p.slug)}
</section>`;
  return layout(origin, { title, description, path: `/meteo/${p.slug}`, jsonld, alerte }, band, g.ligne + body);
}

export function notFoundPage(origin: string, path: string): string {
  return layout(origin, {
    title: `Page introuvable · ${SITE}`,
    description: "La Réunion (974) en direct\u00a0: sorties, randos, météo, routes, vigilance, volcan, air, électricité, calendrier.",
    path,
    jsonld: [],
  }, `<div class="wrap intro"><div class="pitch"><h1>Page introuvable</h1><p class="lead">Cette adresse n'existe pas sur rundata.re. Repartez de <a href="/">l'accueil</a>, des <a href="/evenements">sorties</a>, des <a href="/randonnees">randos</a> ou de <a href="/communes">votre commune</a>, ou découvrez <a href="/a-propos">qui fait rundata.re</a>.</p></div></div>`,
  `<section aria-labelledby="h-cat"><h2 id="h-cat">Les catégories</h2><ul class="chips">${WITH_PAGE.map((c) => `<li><a href="${c.path}">${esc(c.nom)}</a></li>`).join("")}</ul></section>
<section aria-labelledby="h-communes"><h2 id="h-communes">Météo par commune et par lieu</h2>${placeLinks()}</section>`);
}

/** What a phone shows for a page it never opened, without network (web/pwa.ts): the pages it kept, with their date. */
export function offlinePage(origin: string): string {
  return layout(origin, {
    title: `Hors ligne · ${SITE}`,
    description: "Pas de réseau : les pages de rundata.re gardées sur ce téléphone.",
    path: OFFLINE_PATH,
    jsonld: [],
    noindex: true,
    shell: true,
  }, `<div class="wrap intro"><div class="pitch"><h1>Pas de réseau</h1><p class="lead">Cette page n'a pas encore été ouverte sur ce téléphone, il n'en existe pas de copie. Réessayez quand le réseau revient.</p><p><button type="button" class="again" id="again">Réessayer</button></p></div></div>`,
  `<section aria-labelledby="h-gardees"><h2 id="h-gardees">Pages gardées sur ce téléphone</h2><ul class="gardees" id="gardees"></ul><p id="rien-garde" hidden>Aucune page gardée pour l'instant : celles que vous ouvrez avec du réseau le seront.</p></section>
<script>${OFFLINE_SCRIPT}</script>`);
}

/**
 * The class of a cyclone alert's badge: no colour for the pré-alerte, whose box is white in the plan's table (DSO
 * p. 9) and whose yellow the prefecture dropped (marketing).
 */
export const cycloneVg = (c: number) => (c === 2 ? "vgpre" : `vg${c >= 1 && c <= 5 ? c : 0}`);
/** The link to Météo-France's own site, in its words (providers/vigilance.ts). */
export const officielHtml = (href: string) => `<a href="${href}" rel="noopener">${esc(mf.OFFICIEL)}</a>`;
/** A colour of Météo-France, in its colour; `word` to say it otherwise (« verte »). */
export const vg = (c: number, word = mf.colour(c)) => `<span class="vg vg${c >= 1 && c <= 5 ? c : 0}">${esc(word)}</span>`;
const zoneShort = (zone: string) => (mf.ZONES[zone] ?? zone).split(" :")[0];
/** The card of a land zone on /vigilance: « z-sud-est ». */
const zoneId = (zone: string) => `z-${slugify(zoneShort(zone))}`;
const LAND = ["VIGI974-11", "VIGI974-12", "VIGI974-13", "VIGI974-14", "VIGI974-15"];
const LAND_PHENOMENA = [12, 1];
const COAST = 9;

// The colours of the vigilance and the phases of the cyclone alert, by their names only: what each one means is
// Météo-France's to say, on its own site (marketing).
const SCALE = `<ul class="scale">${[1, 2, 3, 4].map((c) => `<li>${vg(c)}</li>`).join("")}</ul><p>${officielHtml(mf.OFFICIEL_VIGILANCE)}</p>`;

/** The phases of the cyclone alert, shown on /cyclones with the prefecture's word (domains.ts). */
export const CYCLONE_SCALE = `<ul class="scale">
  <li><span class="vg vgpre">pré-alerte</span></li>
  <li><span class="vg vg3">orange</span></li>
  <li><span class="vg vg4">rouge</span></li>
  <li><span class="vg vg5">violette</span></li>
  <li><span class="vg vg0">sauvegarde</span></li>
</ul><p>${officielHtml(mf.OFFICIEL_CYCLONE)}</p>`;

export function vigilancePage(origin: string, data: Cached<mf.Vigilance> | null, now = new Date(), alerte?: Alerte): string {
  const v = data?.value;
  const emise = v ? localTime(new Date(v.emise)) : undefined;
  const cyc = v?.zones[mf.ISLAND]?.[mf.CYCLONE] ?? [];
  const cycNow = current(cyc, now);
  const r = v ? raised(v) : [];
  const url = `${origin}/vigilance`;

  let status: string;
  if (!v) {
    status = `<p class="lead">La vigilance de Météo-France n'a pas pu être lue à l'instant. Consultez <a href="${mf.SOURCE.url}">vigilance.meteofrance.fr</a> ou rechargez la page.</p><p class="lead">${officielHtml(mf.OFFICIEL_VIGILANCE)}</p>`;
  } else {
    // The page of Météo-France's phenomena (rain, storms, wind, waves): the vigilance is its one strong state, in
    // Météo-France's colour, its details in badges under it. The cyclone keeps one line, its state and /cyclones; in an
    // alert, from the pre-alert on, it comes first, in its colour, the vigilance after it, smaller, with the two pages
    // of the alert as buttons. Then the bulletin's time, and the link to Météo-France's site (its agreement).
    const alert = highest(cyc) >= 2;
    const cyclones = `<a href="/cyclones">Cyclones dans le bassin, alerte du préfet →</a>`;
    const head = alert
      ? `<p class="big vh${cycNow >= 2 ? ` vab ${cycloneVg(cycNow)}` : ""}">${cycNow >= 2 ? esc(cycloneHead(cycNow)) : "Alerte cyclonique prévue"}</p><p class="lead">${esc(cyclone(v, now))}</p><p class="cyc">${cyclones}</p>`
      : "";
    const badge = (c: number) => vg(c, `Vigilance ${feminine(mf.colour(c))}`);
    const green = islandGreen(v, now);
    const top = r.length ? Math.max(...r.map((x) => x.max)) : green ? 1 : 0;
    const state = `<p class="big vh${alert ? " vh2" : ""}${top ? ` vab vg${top}` : ""}">${top ? `Vigilance ${esc(feminine(mf.colour(top)))}` : esc(NONE_ISSUED_SAID)}</p>`;
    const rest = r.length
      ? `<p class="vstate">Vigilances au-dessus du vert : ${r.map((x) => `<span class="vi">${badge(x.max)} ${esc(x.phenomene.toLowerCase())} (${esc(x.zone.split(" :")[0])})</span>`).join("")}</p>`
      : green
        ? `<p class="vstate">Aucune vigilance particulière à La Réunion dans les 24 heures du bulletin.</p>`
        : "";
    status = `<div class="status vig">${head}${state}${rest}${alert ? "" : `<p class="cyc">Pas d'alerte cyclonique · ${cyclones}</p>`}` +
      `<p class="note when">Bulletin de Météo-France émis le ${esc(emise!.replace(" ", " à "))} (heure de La Réunion), lu à ${hm(data!.fetchedAt)}${data!.stale ? " : Météo-France ne répond pas, c'est le dernier bulletin connu" : ""}.</p>` +
      `<p class="off"><b>${officielHtml(mf.OFFICIEL_VIGILANCE)}</b></p>` +
      (alert ? `<ul class="chips"><li><a href="/ecoles-cyclone">Cyclone : les écoles sont-elles fermées ? →</a></li><li><a href="/alerte-cyclone">Alerte cyclonique : ce qui ferme, ce qui continue →</a></li></ul>` : "") + `</div>`;
  }

  const zones = v
    ? `<ul class="zones">${LAND.map((zone) => {
        const items = LAND_PHENOMENA.map((id) => {
          const periods = v.zones[zone]?.[id] ?? [];
          const c = current(periods, now);
          const later = spans(periods);
          return `<li><b>${esc(mf.PHENOMENA[id])}</b> : ${c >= 1 ? vg(c) : NONE_ISSUED}` +
            (later.length ? `<p>${esc(later.join(", "))}</p>` : "") + `</li>`;
        }).join("");
        return `<li class="card tgt" id="${zoneId(zone)}"><h3>${esc(zoneShort(zone))}</h3><p class="note">${esc((mf.ZONES[zone] ?? "").split(" : ")[1] ?? "")}</p><ul>${items}</ul></li>`;
      }).join("")}</ul>`
    : "";

  const coast = v ? r.filter((x) => x.phenomene === mf.PHENOMENA[COAST]) : [];
  const littoral = v
    ? `<div class="card"><h3>Littoral : vagues-submersion</h3>` +
      (coast.length
        ? `<ul>${coast.map((c) => `<li>${vg(c.max)} ${esc(c.zone)}${c.periodes.length ? ` : ${esc(c.periodes.join(", "))}` : ""}</li>`).join("")}</ul>`
        : `<p>Pas de vigilance vagues-submersion sur les côtes de l'île.</p>`) +
      `<p class="note">Houle et marée : la température de l'eau plage par plage est sur <a href="/mer">la page mer</a>.</p></div>`
    : "";

  const suivi = v?.suivi.length
    ? `<section aria-labelledby="h-suivi"><h2 id="h-suivi">Ce que dit Météo-France</h2><div class="card suivi">` +
      v.suivi.map((t) => `<div><h3>${esc(t.titre)}</h3><p>${esc(t.texte)}</p></div>`).join("") +
      `<p class="note">Texte de Météo-France, repris tel quel. Source : ${esc(mf.SOURCE.nom)} (${esc(mf.SOURCE.licence)}).</p></div></section>`
    : "";

  const title = "Vigilance météo Réunion 974 en direct";
  const description = v
    ? `Vigilance Météo-France à La Réunion (974) : ${cyclone(v, now)} ${r.length ? `Au-dessus du vert : ${r.map((x) => `${x.couleur_max} ${x.phenomene.toLowerCase()} (${x.zone.split(" :")[0]})`).join(", ")}.` : "Tout est vert."} Bulletin du ${emise}.`
    : "Vigilance Météo-France à La Réunion (974) en direct : fortes pluies, orages, vents forts, vagues-submersion, zone par zone.";

  const jsonld = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE, item: `${origin}/` },
        { "@type": "ListItem", position: 2, name: "Vigilance météo", item: `${origin}/vigilance` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description,
      inLanguage: "fr-FR",
      url: `${origin}/vigilance`,
      ...(data ? { dateModified: data.fetchedAt.toISOString() } : {}),
      about: ISLAND,
      isBasedOn: mf.SOURCE.url,
    },
  ];

  // Météo-France's map beside the text on a wide screen; on a phone, in the page below (vigilance-carte.ts).
  const hero = carteHero(v?.carte);
  const band = `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li aria-current="page">Vigilance</li></ol></nav></div>
<div class="wrap intro${hero ? " vhero" : " solo"}">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Vigilance Météo-France en direct</p>
    <h1>Vigilance météo <span class="n974">974</span></h1>
    ${status}
    ${ask(`Siklone i ariv ? Na lékol domin ? Gèt si ${url} é di amwin sak Météo-France é la préfektir i di.`,
      `Y a-t-il une vigilance météo en cours à La Réunion ? Lis ${url} et dis-moi ce que dit Météo-France, zone par zone.`)}
  </div>
  ${hero}
</div>`;

  const body = `<section aria-labelledby="h-zones">
  <div class="sec-h"><p class="eyebrow">Zone par zone</p><h2 id="h-zones">Vigilance dans les 5 zones de l'île</h2>
  <p>La vigilance telle que Météo-France la publie, zone par zone et phénomène par phénomène : 5 zones terrestres et 8 zones côtières. Pour chacune, la couleur en cours, puis ce qui est prévu dans les 24 heures du bulletin.</p></div>
  ${zones || `<p class="card">Pas de bulletin à afficher pour le moment : voir <a href="${mf.SOURCE.url}">vigilance.meteofrance.fr</a>.</p>`}
  ${littoral}
  ${carteHtml(v?.carte, now)}
  <p><a href="/crues">La vigilance crues, rivière par rivière →</a></p>
</section>
${suivi}
<section class="card cta" aria-labelledby="h-ia">
  <h2 id="h-ia">Votre IA, branchée sur la vigilance</h2>
  <p>Avec le connecteur, votre assistant lit lui-même la vigilance de Météo-France (outil <code>vigilance_meteo</code>), et la signale d'office quand vous lui demandez la météo d'un lieu. Gratuit, sans compte. <a href="/#assistant">Comment le brancher</a>.</p>
  ${connector(origin, "mcp-url")}
</section>
<section aria-labelledby="h-couleurs">
  <div class="sec-h"><p class="eyebrow">Bon à savoir</p><h2 id="h-couleurs">Comprendre les couleurs</h2></div>
  <div class="card"><h3>Vigilance météo (fortes pluies, orages, vent, vagues)</h3>${SCALE}</div>
  <p class="note">Cette page reprend telle quelle la vigilance publiée par Météo-France (API DPVigilance, Licence Ouverte), lue toutes les 5 minutes. En cas de doute, seuls font foi <a href="${mf.SOURCE.url}">vigilance.meteofrance.fr</a>, <a href="https://meteofrance.re/">meteofrance.re</a> et la préfecture.</p>
</section>`;
  return layout(origin, { title, description, path: "/vigilance", jsonld, alerte, vert: !!v && !alerte && islandGreen(v, now) }, band, body);
}

const CROWDED = new Set(["Plage de la Saline les Bains", "Plage de Saint-Paul"]);

export function seaPage(origin: string, data: Cached<SeaData> | null, now = new Date(), alerte?: Alerte): string {
  const g = porte(alerte);
  const d = data?.value;
  const seen = d?.plages.filter((b) => b.valeur != null) ?? [];
  const day = seen.map((b) => b.jour!).sort().pop();
  const warm = seen.length ? seen.reduce((a, b) => (b.valeur! > a.valeur! ? b : a)) : undefined;
  const cool = seen.length ? seen.reduce((a, b) => (b.valeur! < a.valeur! ? b : a)) : undefined;
  const url = `${origin}/mer`;
  // Not every beach of the west coast: their markers would sit on one another.
  const markers: Marker[] = seen.filter((b) => !CROWDED.has(b.nom)).map((b) => ({ lon: b.lon, lat: b.lat, label: `${Math.round(b.valeur!)}°`, say: `eau à ${Math.round(b.valeur!)} °C`, name: seaName(b.nom), color: chip(b.valeur!), round: true, href: `#${anchorId("p", b.nom)}` }));

  const status = warm && cool
    ? `<div class="now"><span class="big span">${esc(fr(Math.round(cool.valeur! * 10) / 10))} à ${esc(thin(deg(warm.valeur!)))}</span>` +
      `<p>Température de surface de la mer autour de l'île, mesurée par satellite le <b>${esc(dayMonth(day!))}</b>. ` +
      `Plus chaude à <b>${esc(seaName(warm.nom))}</b>, plus fraîche à <b>${esc(seaName(cool.nom))}</b>.</p></div>`
    : `<p class="lead">Les mesures satellite se chargent : rechargez la page dans quelques secondes.</p>`;

  const list = d
    ? `<ul class="seas">${d.plages.map((b) => `<li class="tgt" id="${anchorId("p", b.nom)}"><span>${esc(seaName(b.nom))}</span>` +
        (b.valeur != null
          ? `<b>${esc(thin(deg(b.valeur)))}</b><span>le ${esc(dayMonth(b.jour!))}, à ${esc(fr(b.distance_km!))} km</span>`
          : `<b>—</b><span>pas de mesure (nuages)</span>`) +
        // « Y aller » to a beach, not to the centre of a town listed for its coast (Saint-Denis, Le Port…).
        `<a href="/meteo/${slugify(b.commune)}">Météo ${esc(b.commune)} →</a>${resolvePlace(b.nom)?.lieu.type === "commune" ? "" : g.aller({ nom: seaName(b.nom), lat: b.lat, lon: b.lon }, "baignade")}</li>`).join("")}</ul>` +
      `<p class="note">Mis à jour à ${hm(data!.fetchedAt)}.</p><p class="sources">Sources : ${credits(d.sources)}.</p>`
    : `<p class="card">Les mesures satellite se chargent : rechargez la page dans quelques secondes.</p>`;

  const waves = d?.plages.filter((b) => b.houle) ?? [];
  const top = waves.length ? waves.reduce((a, b) => (b.houle!.hauteur_m > a.houle!.hauteur_m ? b : a)) : undefined;
  const swell = waves.length
    ? `<section aria-labelledby="h-houle">
  <div class="sec-h"><p class="eyebrow">Prévision, pas une mesure</p><h2 id="h-houle">La houle prévue près de chaque plage</h2>
  <p>Hauteur, direction et période des vagues au large, pour les 3 heures en cours, puis la plus haute des 4 jours, d'après le modèle de vagues du Centre européen (ECMWF, maille de 9 km). Dans le lagon et derrière le récif, les vagues sont bien plus petites. Pour la sécurité : <a href="/vigilance">la vigilance vagues-submersion</a>, les drapeaux et les maîtres-nageurs.</p></div>
  <div class="card"><ul class="seas">${waves.map((b) => `<li><span>${esc(seaName(b.nom))}</span>` +
      `<b>${esc(thin(`${fr(b.houle!.hauteur_m)} m`))}</b><span>${esc(b.houle!.maintenant.replace(/^\S+ m /, ""))}, vers ${esc(b.houle!.heure)}</span>` +
      `<span>jusqu'à ${esc(thin(b.houle!.max))} ${esc(b.houle!.max_jour)}</span></li>`).join("")}</ul></div>
</section>`
    : "";

  // The next tides: computed at the view, from the constants of the package, whatever the copy's age.
  const computed = GAUGES.map((g) => tidesAt(g, now, d?.maree ?? [], data?.fetchedAt)).filter((x) => !!x);
  const coming = computed.length
    ? `<h3>Les prochaines marées : un calcul, pas la prédiction du SHOM</h3>
  <ul class="seas">${computed.map((x) => `<li><span>${esc(x.nom)}</span>` +
      x.next.liste.map((e, i) => (i === 0 ? `<b>${esc(e.type)} ${esc(e.heure)}</b><span>${esc(thin(`${fr(e.hauteur_m)} m`))}${"note" in e ? ", marée faible : heure plus incertaine" : ""}</span>` : `<span>${esc(e.type)} ${esc(e.heure)} (${esc(thin(`${fr(e.hauteur_m)} m`))})</span>`)).join("") +
      `</li>`).join("")}</ul>
  <p class="note">${esc(TIDE_LABEL.replace(/^c/, "C"))} : analyse harmonique de plusieurs années de mesures de ces deux marégraphes ; heures à environ ${computed.map((x) => `${x.minutes} min près ${x.gauge.commune === "Le Port" ? "au Port" : `à ${x.gauge.commune}`}`).join(", ")}, hauteurs à environ 5 cm près ; pas de coefficient. La marée est faible à La Réunion (20 à 80 cm) : utile pour le lagon, la pêche à pied ou la mise à l'eau, pas pour la navigation. ${esc(TIDE_CITATION)}</p>
  <p class="note">Ces heures valent près des deux marégraphes, à ${NEAR_KM} km au plus. Plus loin sur la côte, la marée arrive à une autre heure : horaires officiels du SHOM pour ${["Saint-Leu", "Saint-Pierre"].map((c) => `<a href="${esc(shomPort(c)!)}">${c}</a>`).join(" et ")}.</p>`
    : "";
  const tide = d?.maree?.length || coming
    ? `<section aria-labelledby="h-maree">
  <div class="sec-h"><p class="eyebrow">Mesurée chaque minute, puis calculée</p><h2 id="h-maree">La marée en ce moment</h2>
  <p>Hauteur d'eau au-dessus du zéro des cartes marines, aux deux marégraphes du SHOM. Les dernières pleine et basse mer sont mesurées ; les prochaines, plus bas, sont calculées par rundata.</p></div>
  <ul class="seas">${(d?.maree ?? []).map((g) => `<li><span>${esc(g.maregraphe)}</span>` +
      ("hauteur_m" in g && g.hauteur_m != null
        ? `<b>${esc(thin(`${fr(g.hauteur_m)} m`))}</b><span>${g.tendance === "étale" ? "mer étale" : `marée ${esc(g.tendance!)}`}, mesurée à ${esc(g.heure_mesure!.split(" ")[1])}</span>` +
          g.derniers_extremes!.slice().reverse().map((e) => `<span>${esc(e.type)} vers ${esc(e.heure)} (${esc(fr(e.hauteur_m))} m)</span>`).join("") +
          ("avertissement" in g && g.avertissement ? `<span>pas de mesure depuis ${esc(g.age_texte!.replace(/^il y a /, ""))}</span>` : "")
        : `<b>—</b><span>marégraphe muet pour le moment</span>`) +
      `</li>`).join("")}</ul>
  ${coming}
</section>`
    : "";

  const title = "Mer Réunion : houle, température de l'eau et marée · 974";
  const description = warm && cool
    ? `La mer à La Réunion (974) plage par plage : l'eau de ${deg(cool.valeur!)} à ${deg(warm.valeur!)}, mesurée par satellite le ${dayMonth(day!)}${top ? `, et la houle prévue, jusqu'à ${top.houle!.max}` : ""}.`
    : "La mer à La Réunion (974), plage par plage : la température mesurée par satellite, la houle prévue. Saint-Gilles, Saint-Leu, Saint-Pierre…";

  const jsonld = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE, item: `${origin}/` },
        { "@type": "ListItem", position: 2, name: "Température de la mer", item: `${origin}/mer` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "Température de surface de la mer autour de La Réunion (974)",
      description: "Température de surface de la mer mesurée par satellite au large de chaque plage de La Réunion, moyenne du jour, publiée au plus tôt le lendemain.",
      url: `${origin}/mer`,
      isAccessibleForFree: true,
      inLanguage: "fr-FR",
      license: "https://www.usa.gov/government-works",
      creator: [
        { "@type": "Organization", name: "NOAA CoastWatch", url: "https://coastwatch.noaa.gov/" },
        { "@type": "Organization", name: "NASA", url: "https://www.nasa.gov/" },
      ],
      spatialCoverage: ISLAND,
      variableMeasured: ["température de surface de la mer"],
      measurementTechnique: "radiomètres satellitaires (ACSPO L3S, MODIS Aqua)",
      ...(data ? { dateModified: data.fetchedAt.toISOString() } : {}),
    },
  ];

  const band = `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li aria-current="page">Mer</li></ol></nav></div>
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Mesure satellite</p>
    <h1>Température de la mer et houle <span class="n974">974</span></h1>
    ${status}
    ${ask(`Dolo la mèr lé sho ? Gèt si ${url} é di amwin pou chak plaj.`,
      `Quelle est la température de l'eau à La Réunion ? Lis ${url} et donne-moi la température plage par plage, avec la date de la mesure.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, apart: true, label: "Carte de La Réunion (974) avec la température de la mer au large de chaque plage" })}
  ${day ? `<figcaption class="note" style="color:var(--on-night-muted)">${legende([{ forme: "rond", couleur: chip(26), texte: "26°", dit: "température de l'eau au large de la plage" }], esc(`Mesure par satellite (NOAA CoastWatch et NASA), moyenne du ${dayMonth(day)}.`))}</figcaption>` : ""}</figure>
</div>`;

  const body = `<section aria-labelledby="h-plages">
  <div class="sec-h"><p class="eyebrow">Plage par plage</p><h2 id="h-plages">La mer au large de chaque plage</h2>
  <p>Du nord à l'ouest en passant par l'est et le sud : la dernière mesure satellite à moins de 12 km de chaque plage.</p></div>
  <div class="card">${list}</div>
</section>
${swell}
${tide}
${bathingBlock(now, undefined, g)}${g.feuille}
<section aria-labelledby="h-lire-mer">
  <div class="sec-h"><p class="eyebrow">Bon à savoir</p><h2 id="h-lire-mer">Ce que mesure le satellite</h2></div>
  <div class="three">
    <div class="card">${icon("wave")}<h3>La surface, au large</h3><p>Le satellite mesure la toute première couche d'eau, en moyenne sur des carrés de 2 à 4 km. Le lagon et le bord de plage, peu profonds, sont souvent plus chauds en journée.</p></div>
    <div class="card">${icon("cloud")}<h3>Pas à travers les nuages</h3><p>Un ciel couvert cache la mer : la mesure retenue est alors celle d'un jour précédent, ou d'un carré un peu plus loin. La date et la distance sont toujours données.</p></div>
    <div class="card">${icon("gauge")}<h3>Au mieux, la mesure d'hier</h3><p>Une mesure par satellite paraît au plus tôt le lendemain du jour mesuré : celle d'aujourd'hui n'existe pas encore. La houle, elle, est une prévision ; pour la vigilance vagues-submersion, voyez <a href="/vigilance">la vigilance</a>.</p></div>
  </div>
</section>
<section class="card cta" aria-labelledby="h-ia">
  <h2 id="h-ia">Demandez à votre IA : « la mer est à combien à Saint-Leu ? », « la houle demain à Saint-Pierre ? »</h2>
  <p>Avec le connecteur, votre assistant va chercher lui-même la mesure la plus proche de la plage, avec sa date, et la houle prévue, étiquetée comme une prévision (outil <code>temperature_mer</code>). Gratuit, sans compte. <a href="/#assistant">Comment le brancher</a>.</p>
  ${connector(origin, "mcp-url")}
</section>`;
  return layout(origin, { title, description, path: "/mer", jsonld, alerte }, band, g.ligne + body);
}

const PROSE = `max-width:44rem;display:grid;gap:1rem`;

/** The privacy policy and the terms (with the legal notice): what is kept, what is promised. */
export function legalPage(origin: string, kind: "confidentialite" | "conditions"): string {
  const privacy = kind === "confidentialite";
  const title = privacy ? "Confidentialité" : "Conditions d'utilisation et mentions légales";
  const body = privacy
    ? `<section style="${PROSE}">
  <h2>En bref</h2>
  <p>${enLigne() ? `Pour consulter le site ou l'utiliser depuis un assistant IA, rundata.re ne demande ni compte, ni nom, ni adresse électronique. Seuls les ${connecteursEnLigne() ? "trois" : "deux"} formulaires des clubs et associations demandent une adresse électronique (voir <a href="#associations-donnees">«\u00a0Ce que les clubs et associations envoient\u00a0»</a>${connecteursEnLigne() ? ` et <a href="#plateformes-donnees">«\u00a0Les associations reliées à une plateforme\u00a0»</a>` : ""}).` : "rundata.re ne demande ni compte, ni nom, ni adresse électronique."} Le site ne pose aucun cookie et ne contient aucun traceur publicitaire. Dans votre navigateur, sans cookie, le site garde la date de votre première et de votre dernière visite, pour savoir s'il sert d'un jour à l'autre\u00a0; il n'en envoie qu'une catégorie (voir <a href="#retours">«\u00a0Les retours\u00a0»</a>).${enLigne() ? ` La vérification anti-robot des ${connecteursEnLigne() ? "trois" : "deux"} formulaires des clubs et associations y garde aussi une donnée (voir <a href="#abus">«\u00a0Contre les abus\u00a0»</a>).` : ""} Une mesure de Cloudflare, sans cookie, compte aussi les pages vues et leur vitesse d'affichage (voir <a href="#mesure-cloudflare">«\u00a0La mesure de Cloudflare\u00a0»</a>). Rien n'est vendu ni partagé à des fins commerciales.</p>
  <h2>Ce que le site compte</h2>
  <p>Pour savoir quelles pages et quels outils servent, et les améliorer, chaque page vue et chaque message reçu par le connecteur ajoutent une ligne anonyme aux statistiques : la page et sa rubrique, ou l'outil appelé avec le nom des paramètres donnés (pas leur valeur) ; le lieu demandé quand c'en est un, tel que le site l'a compris (une commune, une plage…), ou le texte demandé, coupé à 60 caractères, quand il ne l'a pas compris, pour apprendre à le comprendre ; le nom et la version de l'application de l'assistant (par exemple « claude-ai ») ; si la réponse a réussi, son temps et sa taille ; le pays déduit par Cloudflare, la langue du navigateur, si la page est ouverte depuis l'application installée sur l'écran d'accueil, le site d'où vient le visiteur et son type (une personne, un assistant, ou le nom du robot d'un assistant ou d'un moteur de recherche).</p>
  <p>Chaque lecture d'un flux RSS de commune ajoute aussi une ligne, à part : le flux, le nom de l'application qui le lit (Feedly, Inoreader…) et le nombre d'abonnés qu'elle annonce, sans rien sur les abonnés eux-mêmes.</p>
  <p>Ni adresse IP, ni identifiant, ni cookie. Des coordonnées ne sont jamais gardées, seulement leur commune.</p>
  <p>Depuis le 24 octobre 2026, un texte non compris qui ressemble à une adresse (un numéro suivi d'une rue, d'un chemin, d'une impasse, d'un lotissement…) n'est plus gardé tel qu'écrit, ni dans les statistiques ni dans le journal : seulement le mot « adresse ». Un nom de rue sans numéro peut encore être gardé, coupé à 60 caractères, comme tout lieu non compris. Une adresse postale donnée à l'outil <code>fiche_terrain</code> n'est jamais enregistrée, pas plus que les autres paramètres (un arrêt de bus, un sujet…).</p>
  <p>La page envoie aussi, sans identifiant, le temps qu'elle a mis à s'afficher sur votre appareil\u00a0; sur la page du connecteur, le fait que son adresse a été copiée\u00a0; et votre réponse au bouton «\u00a0Cette page vous a aidé\u00a0?\u00a0» (la page, et oui ou non).</p>
  <p>Ces statistiques sont gardées par Cloudflare (Workers Analytics Engine) trois mois au plus.</p>
  <p id="mesure-cloudflare">La mesure de Cloudflare. Chaque page charge aussi un petit script de Cloudflare Web Analytics, l'outil de mesure de notre hébergeur. À chaque page vue, il envoie à Cloudflare l'adresse de la page, le site d'où vous venez et des mesures de vitesse\u00a0: le temps qu'a mis la page à s'afficher, sa stabilité et sa réactivité sur votre appareil. Cloudflare y associe le pays, le navigateur, le système et le type d'appareil (ordinateur, téléphone, tablette). Ce script ne pose aucun cookie et ne garde rien dans votre navigateur. Comme pour toute page, Cloudflare reçoit votre adresse IP\u00a0; selon sa documentation, il ne s'en sert pas, ni d'aucune autre donnée, pour suivre les visiteurs dans le temps ou d'un site à l'autre. Cloudflare garde chaque mesure 7 jours, puis un échantillon d'environ un dixième, que nous pouvons consulter pendant six mois. Ces mesures nous servent à voir quelles pages sont lues et lesquelles s'affichent lentement, pour améliorer le site.</p>
  <p>Installation et lecture hors ligne : elles n'utilisent aucun cookie. Pour afficher les pages sans réseau, le site garde sur votre téléphone une copie des pages que vous ouvrez (le cache du navigateur, géré par un « service worker »). Votre choix «\u00a0Plus tard\u00a0» est gardé de la même façon, comme la langue choisie, kréol ou français, pour la question toute prête à poser à votre IA. Ces données restent sur le téléphone et ne sont envoyées à personne. Elles s'effacent depuis les réglages du navigateur (données du site rundata.re).</p>
  <p>Les visites de l'équipe. Pour que les statistiques ne comptent pas ceux qui font le site, leurs appareils portent un repère, gardé dans le navigateur de la même façon (sans cookie). Leurs pages vues sont notées « interne » et laissées hors des chiffres. Rien ne change pour les autres visiteurs.</p>
  <p id="retours">Les retours. Pour savoir si le site sert d'un jour à l'autre, votre navigateur garde deux dates\u00a0: celle de votre première visite et celle de votre dernière, le jour seulement, sans l'heure. Ce n'est pas un cookie, mais le stockage local du navigateur, sur votre appareil. À chaque visite, la page n'envoie aux statistiques qu'une catégorie, jamais les dates\u00a0: première visite, le même jour, le lendemain, dans la semaine, ou plus tard. Ce repère ne sert qu'à cette mesure\u00a0: aucun autre site ne le lit, et il n'est recoupé avec rien. Passé 13 mois après votre première visite, il est effacé dès votre visite suivante, avant tout envoi\u00a0; il n'est jamais prolongé. Sans nouvelle visite, il reste sur votre appareil, sans être lu ni envoyé. Vous pouvez l'effacer à tout moment depuis les réglages du navigateur (données du site rundata.re). Selon les règles de la CNIL, une telle mesure d'audience ne demande pas de consentement («\u00a0Cookies\u00a0: solutions pour les outils de mesure d'audience\u00a0», <a href="https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies-solutions-pour-les-outils-de-mesure-daudience">cnil.fr</a>).</p>
  <p id="fonds-ign">Si vous choisissez le fond Plan IGN ou Photo aérienne, votre navigateur charge ces images chez l'IGN (data.geopf.fr), qui reçoit alors votre adresse IP.</p>
  <h2>Journaux techniques</h2>
  <p>Comme tout hébergeur, Cloudflare garde quelques jours les journaux du service (adresse demandée, erreurs, durée). Pour chaque message du connecteur, ils reprennent les éléments des statistiques ci-dessus, sans rien de plus. Une copie sans aucune adresse IP est conservée un an au plus, pour comprendre les pannes. Votre conversation n'y figure jamais.</p>
  <h2 id="avis-donnees">Les avis que vous laissez</h2>
  <p>Le formulaire en bas de chaque page et l'outil <code>donner_avis</code> du connecteur (que votre assistant appelle quand vous signalez une donnée qui manque ou une erreur, ou avec votre accord) enregistrent : la date, le type d'avis, le message, l'outil et le lieu concernés, le besoin résumé en quelques mots (jamais le texte de la conversation), la page du formulaire, et le nom de l'assistant quand il se présente (Claude, ChatGPT…). Ils servent à corriger et à compléter les données, et à rien d'autre. Ni compte, ni adresse IP : pour refuser les envois en masse, une empreinte chiffrée de l'adresse, qui change chaque jour et ne permet pas de la retrouver, est gardée un jour puis effacée. Les numéros de téléphone et adresses électroniques écrits dans un message sont retirés avant l'enregistrement. Les avis sont conservés 12 mois, chez Cloudflare (base D1), puis effacés automatiquement. Ils ne sont ni publiés ni partagés. Pour qu'un avis soit effacé plus tôt, écrire à <b>contact@rundata.re</b> en le citant.</p>
${enLigne() ? `<h2 id="associations-donnees">Ce que les clubs et associations envoient</h2>
  <p><b>Formulaire «\u00a0Proposer un événement\u00a0».</b> Nous recueillons l'adresse e-mail de l'organisateur pour confirmer l'événement, le modérer et permettre de le modifier ou de l'annuler. Elle n'est pas publiée, sauf si l'organisateur coche «\u00a0Utiliser mon adresse e-mail comme contact public\u00a0»\u00a0: elle apparaît alors avec l'événement, sur rundata.re, dans les réponses des assistants IA et dans le flux ouvert des événements, et d'autres peuvent l'avoir copiée entre-temps. Il en va de même pour le contact public saisi dans le formulaire. L'adresse et le contact public sont effacés 30 jours après la dernière date de l'événement, avec une correction qui attendrait encore la relecture. Une proposition non confirmée est effacée sous 48 heures, et un événement l'est un an après sa dernière date.</p>
  <p><b>Formulaire «\u00a0Nous donner votre lien\u00a0».</b> Le lien, le nom de l'organisation, sa commune et le contact facultatif (jamais publié) sont effacés 12 mois après l'envoi.</p>
  <p id="abus"><b>Contre les abus</b>, pour les ${connecteursEnLigne() ? "trois" : "deux"} formulaires, une empreinte de la connexion est gardée un jour, puis effacée. L'adresse IP elle-même n'est pas gardée. La vérification anti-robot (Cloudflare Turnstile) voit l'adresse au moment de l'envoi, sans que nous la gardions. Dès qu'elle s'affiche sur la page d'un de ces formulaires, cette vérification garde aussi dans votre navigateur une donnée de Cloudflare, nommée «\u00a0cf.turnstile.u\u00a0». C'est du stockage local du navigateur, pas un cookie. Elle appartient à la vérification anti-robot, dont Cloudflare ne publie pas le rôle exact. Le site ne la lit pas. Elle n'a pas de date d'effacement\u00a0: elle s'efface depuis les réglages du navigateur (données du site rundata.re).</p>
  ` : ""}${connecteursEnLigne() ? `<h2 id="plateformes-donnees">Les associations reliées à une plateforme (HelloAsso)</h2>
  <p>Une association qui relie son compte HelloAsso colle ses deux clés HelloAsso et une adresse e-mail. Ses clés servent une seule fois, au moment de l'envoi, à obtenir un jeton d'accès\u00a0: elles ne sont jamais gardées. Nous gardons ce jeton chiffré, le nom de l'association, sa commune et l'adresse e-mail, qui n'est jamais publiée. Avec ce jeton, rundata.re lit seulement les événements publics de l'association\u00a0: le titre, les dates, le lieu, le prix, le lien et le début de la description. Il ne lit jamais ses commandes, paiements, dons, participants ni adhérents, même si le jeton le permet. Le jeton et l'adresse sont effacés dès que l'association retire l'accès (lien reçu par e-mail, ou demande à contact@rundata.re), quand HelloAsso refuse le jeton, quand la connexion expire après 30 jours sans lecture réussie, et après 48 heures si la connexion n'a jamais été confirmée. Au retrait, ses événements sont effacés aussi. Ces événements entrent dans nos données ouvertes (agenda ICS et JSON, Licence Ouverte 2.0) seulement si l'association l'a choisi en reliant son compte\u00a0; HelloAsso l'a accepté par écrit le 29\u00a0octobre 2026.</p>
  <p>HelloAsso nous a conseillé de passer par les clés API de chaque association\u00a0: c'est aujourd'hui la seule façon de lire les événements d'une association qui le souhaite. Ces clés donnent accès à tout le compte de l'association\u00a0; rundata.re n'en lit que les événements publics (titre, dates, lieu, prix, lien), jamais les commandes, les paiements ni les participants. L'association peut couper l'accès à tout moment en supprimant ses clés API dans l'onglet «\u00a0Intégrations et API\u00a0» de son espace HelloAsso.</p>
  ` : ""}  <h2>Quand votre assistant pose une question</h2>
  <p>Votre assistant (ChatGPT, Claude, Le Chat…) n'envoie au connecteur que les paramètres de l'outil, par exemple « Saint-Paul » ou une adresse, jamais votre conversation. Pour répondre, rundata.re transmet ce paramètre aux services publics qui détiennent la donnée : par exemple, une adresse est envoyée au géocodeur de l'IGN, puis le point trouvé au cadastre, au Géoportail de l'urbanisme, à Géorisques et à l'API DVF du Cerema. Ce que fait votre assistant de la conversation relève de sa propre politique de confidentialité.</p>
  <h2>Vos droits</h2>
  <p>${enLigne() ? `Pour qui consulte le site, aucune donnée ne permet de l'identifier\u00a0: il n'y a rien à consulter ni à effacer à son nom (sauf ce qu'il aurait écrit lui-même dans un avis). Si vous avez proposé un événement ou donné un lien, vous pouvez le corriger, l'annuler ou le retirer avec le lien reçu par e-mail. Pour consulter ou faire effacer ce que nous gardons, écrivez à <b>contact@rundata.re</b>\u00a0: nous répondons sous un mois.` : "Aucune donnée ne permet de vous identifier, il n'y a donc rien à consulter ni à effacer à votre nom (sauf ce que vous auriez écrit vous-même dans un avis). Pour toute question\u00a0: <b>contact@rundata.re</b>."} Vous pouvez aussi saisir la <a href="https://www.cnil.fr/fr/plaintes">CNIL</a>.</p>
  <p style="color:var(--muted)">Mise à jour\u00a0: 30 octobre 2026.</p>
</section>`
    : `<section style="${PROSE}">
  <h2>Le service</h2>
  <p>rundata.re est un service gratuit\u00a0: un site et un connecteur MCP (<code>${esc(origin)}/mcp</code>) qui réunissent les données publiques de La Réunion pour les personnes et leurs assistants IA. Il n'y a ni compte ni abonnement. Son code est libre, sous licence MIT, sur <a href="${GITHUB}">GitHub</a>.</p>
  <h2>Pas un service officiel, pas de garantie</h2>
  <p>Les données viennent d'organismes publics et de projets ouverts, cités dans chaque réponse. Elles sont données telles quelles, sans garantie d'exactitude, de fraîcheur ni de disponibilité. Pour un cyclone, de fortes pluies, une crue ou une éruption, seules comptent la vigilance de <a href="https://meteofrance.re/">Météo-France La Réunion</a> et les consignes de la préfecture. La fiche d'une adresse n'a aucune valeur juridique : le cadastre est un document fiscal, et l'état des risques obligatoire pour une vente ou une location reste à établir.</p>
  <h2>Usage raisonnable</h2>
  <p>Le service est fait pour répondre à des questions. Ne l'interrogez pas en masse de façon automatique : il peut limiter ou bloquer un usage qui gêne les autres ou les services publics qu'il interroge.</p>
  <h2 id="reutiliser">Réutiliser les données</h2>
  <p>Chaque donnée garde la licence de sa source : Licence Ouverte Etalab 2.0 pour la plupart, ODbL pour OpenStreetMap, CC BY 4.0 pour Open-Meteo et les séismes de l'IPGP. L'outil <code>sources_donnees</code> les liste avec l'attribution à citer.</p>
${enLigne() ? `<p id="evenements-proposes"><b>Événements proposés par les clubs et associations.</b> L'association qui propose un événement en est responsable\u00a0: elle garantit qu'il est ouvert au public, exact, et qu'elle a le droit de le publier. rundata.re relit chaque proposition avant de l'afficher. Il peut refuser ou retirer un événement, en donnant le motif à l'organisateur\u00a0: notamment un événement privé, une adresse de domicile, des données personnelles, de la politique électorale, une collecte d'argent sans organisme identifié ou de la publicité commerciale. Un événement faux ou qui pose problème peut être signalé à contact@rundata.re\u00a0; nous le retirons, en général dans la journée. La mention «\u00a0Proposé par l'organisateur\u00a0» signale que l'événement n'a pas été vérifié par rundata.re. Les événements publiés sont sous Licence Ouverte 2.0.</p>
  ` : ""}  <h2 id="mentions-legales">Mentions légales</h2>
  <p>rundata.re est édité à titre non professionnel par un particulier qui, comme le permet l'article 1-1, II de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique, a choisi de préserver son anonymat. Ses éléments d'identification ont été communiqués à l'hébergeur. Contact : <b>contact@rundata.re</b>. Hébergeur : Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis (cloudflare.com). Nom de domaine enregistré auprès de l'AFNIC (.re).</p>
  <p style="color:var(--muted)">Mise à jour\u00a0: 25 octobre 2026.</p>
</section>`;
  return layout(origin, {
    title: `${title} · rundata.re`,
    description: privacy
      ? "Ce que rundata.re garde, et ce qu'il ne garde pas : aucun compte, aucun cookie, des statistiques anonymes."
      : "Conditions d'utilisation de rundata.re, service gratuit de données publiques de La Réunion, et mentions légales.",
    path: `/${kind}`,
    jsonld: [crumbs(origin, title, `/${kind}`)],
  }, `${crumbBar(title)}
<div class="wrap intro"><div class="pitch"><h1>${title}</h1></div></div>`, body);
}
