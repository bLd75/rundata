/**
 * The maximum prices of fuel at La Réunion, set each month by the prefect's order and published as a press release
 * of the prefecture (Licence Ouverte): the same in every station of the island, which may sell for less. The DOM are
 * not in the national feed of station prices. Read every day by scripts/carburants.ts, from a machine of the project,
 * into the Worker's KV store, where the Worker reads them; elsewhere, from the prefecture.
 */
import type { Cache, Cached } from "../cache.js";
import { getText, permis } from "../http.js";
import { type SourceInfo, UpstreamError } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "prefecture_carburants",
  nom: "Prix maximum des carburants (arrêté préfectoral mensuel)",
  organisme: "Préfecture de La Réunion",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Préfecture de La Réunion",
  url: "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse",
};

export interface Produit {
  /** As the order names it: « Supercarburant », « Gazole », « Gaz (bouteille de 12,5 kg) ». */
  produit: string;
  unite: string;
  prix_eur: number;
  precedent_eur?: number;
  /** What the order says beside it: « 18 € avec aides de la Région ». */
  note?: string;
}

export interface Prix {
  /** The first day the prices apply, « 2026-10-01 ». */
  depuis: string;
  /** The previous month's first day, when the table gives it. */
  precedent_depuis?: string;
  produits: Produit[];
  titre: string;
  lien: string;
  /** The day the release's page gives (« Mis à jour le 31/10/2025 »), « 2025-10-31 ». */
  publie?: string;
  /** ISO time it was read. */
  lu: string;
}

/** The prices of one month: since its first day, product by product. */
export interface Mois {
  depuis: string;
  produits: Produit[];
}

const ORIGIN = "https://www.reunion.gouv.fr";
const HOST = new URL(ORIGIN).host;
const LIST = `${ORIGIN}/Actualites/Communiques-de-presse`;
const HEADERS = { "User-Agent": "rundata.re (contact@rundata.re)" };
const MONTHS = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
const MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// « &amp; » last, so that a « &amp;#39; » of the page stays the text « &#39; ».
const plain = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&#39;|&rsquo;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const euros = (s: string) => {
  const m = /(\d+),(\d{2})\s*€/.exec(s);
  return m ? Number(`${m[1]}.${m[2]}`) : undefined;
};

/** « 01/10/2026 », « 1-oct.-26 », « 1-août-26 » → « 2026-10-01 ». */
export function headerDay(s: string): string | undefined {
  let m = /(\d{1,2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1].padStart(2, "0")}`;
  m = /(\d{1,2})-([a-zéû]+)\.?-(\d{2})/i.exec(s);
  if (!m) return undefined;
  const month = MONTHS.findIndex((x) => m![2].toLowerCase().startsWith(x));
  return month < 0 ? undefined : `20${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** The links to the monthly releases on a page of the list of press releases, newest first. */
export function releases(html: string): string[] {
  const all = [...html.matchAll(/href="([^"]*Communiques-de-presse\/Prix-des-carburants[^"]*)"/gi)].map((m) => new URL(m[1], ORIGIN).toString());
  // Only the prefecture's own pages: a link planted in its list is never read.
  return [...new Set(all)].filter((lien) => permis(SOURCE.id, lien, [HOST]));
}

/** The table of a release: the product, the previous month's price, this month's (the second and third columns). */
export function parseRelease(html: string, lien: string, now = new Date()): Prix | undefined {
  const at = html.indexOf("<table");
  if (at < 0) return undefined;
  const rows = [...html.slice(at, html.indexOf("</table>", at)).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((r) => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => plain(c[1])));
  const head = rows.find((r) => r.some((c) => headerDay(c)));
  if (!head || head.length < 3) return undefined;
  const depuis = headerDay(head[2]);
  if (!depuis) return undefined;
  const produits = rows.filter((r) => r !== head && euros(r[2] ?? "") != null).map((r): Produit => {
    const unit = /\(([^)]*)\)\s*$/.exec(r[0]);
    const note = r.slice(3).map((c) => /\(([^)]*aide[^)]*)\)/i.exec(c)?.[1]).find(Boolean);
    return {
      produit: (unit ? r[0].slice(0, unit.index) : r[0]).trim(),
      unite: (unit?.[1] ?? "").replace("12,5kg", "12,5 kg"),
      prix_eur: euros(r[2])!,
      precedent_eur: euros(r[1]),
      note: note?.replace(/(\d)€/, "$1 €"),
    };
  });
  if (!produits.some((p) => /supercarburant/i.test(p.produit)) || !produits.some((p) => /^gazole$/i.test(p.produit))) return undefined;
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  const day = /Mis à jour le(?:&nbsp;|\s)*<\/span>\s*<span>(\d{2})\/(\d{2})\/(\d{4})<\/span>/.exec(html);
  return {
    depuis, precedent_depuis: headerDay(head[1]), produits, titre: h1 ? plain(h1[1]) : "Prix des carburants", lien,
    publie: day ? `${day[3]}-${day[2]}-${day[1]}` : undefined, lu: now.toISOString(),
  };
}

/** « 2026-10-24 », the day in Réunion (UTC+4). */
export const localDay = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);

/**
 * The prices in force on `now`'s day, and those an order sets for a 1st still to come. An order is published a day
 * or two before the 1st: until then its prices are announced, and the month in force is its previous column. Nothing
 * is in force when the order gives no previous column.
 */
export function phases(p: Prix, now: Date): { vigueur?: Mois; avenir?: Mois } {
  if (p.depuis <= localDay(now)) return { vigueur: { depuis: p.depuis, produits: p.produits } };
  const before = p.precedent_depuis && p.precedent_depuis <= localDay(now)
    ? p.produits.filter((x) => x.precedent_eur != null).map(({ produit, unite, precedent_eur }) => ({ produit, unite, prix_eur: precedent_eur! }))
    : [];
  return { ...(before.length ? { vigueur: { depuis: p.precedent_depuis!, produits: before } } : {}), avenir: { depuis: p.depuis, produits: p.produits } };
}

/** The product as people say it: the order's « Supercarburant » is « sans plomb » (the sea professionals' keeps its name). */
export const label = (produit: string) => (/^supercarburant$/i.test(produit) ? "Sans plomb" : produit);

/** « octobre 2026 ». */
export const monthOf = (day: string) => `${MONTH_NAMES[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

/** How many times a page is asked when the connection fails (the site refuses some addresses now and then). */
const TRIES = 3;

/**
 * The newest release with a table of prices, from the first pages of the list. `pauseMs` is waited between two pages
 * of the prefecture's site, never a burst of them (scripts/carburants.ts: a minute); none for a local server. With a
 * pause, a page whose connection fails (no HTTP answer) is asked again after it, up to TRIES times; an HTTP error is
 * never asked again. The Worker never reads the site (`prix`).
 */
export async function gather(now = new Date(), pages = 4, pauseMs = 0): Promise<Prix | undefined> {
  let asked = 0;
  const read = async (url: string) => {
    for (let n = 1; ; n++) {
      if (asked++ && pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
      try {
        return await getText(SOURCE.id, url, 20_000, HEADERS);
      } catch (err) {
        if (!pauseMs || n >= TRIES || !(err instanceof UpstreamError) || err.status !== undefined) throw err;
        console.error(`${err.message} (${url}), essai ${n} sur ${TRIES} : nouvel essai dans ${pauseMs / 1000} s`);
      }
    }
  };
  for (let i = 0; i < pages; i++) {
    const list = await read(i ? `${LIST}/(offset)/${i * 10}` : LIST);
    for (const lien of releases(list)) {
      const p = parseRelease(await read(lien), lien, now);
      if (p) return p;
    }
  }
  return undefined;
}

let reader: (() => Promise<Prix | null>) | undefined;

/** In the Worker: read the prices from the KV store, where scripts/carburants.ts writes them, and from nowhere else. */
export function configure(read: (() => Promise<Prix | null>) | undefined) {
  reader = read;
}

// The order changes once a month; a few hours is plenty, and the stored copy is served while the store does not answer.
const FRESH_SECONDS = 6 * 3600;
// While the new order may be in the store and the copy does not have it (from the 28th, or the copy is an older
// month's): asked again every quarter of an hour, as the collector reads the prefecture more often then.
const EARLY_SECONDS = 15 * 60;

export async function prix(cache: Cache, now = new Date()): Promise<Cached<Prix>> {
  const load = async () => {
    // The Worker reads the stored copy only, never the prefecture: its site bans our address on bursts, and an isolate
    // finding the store empty would read up to 22 of its pages in a row (26/10/2026). The prices are then unavailable until
    // the collector stores them. Only a local server, with no store, reads the prefecture itself.
    const v = reader ? await reader() : await gather(now, 2);
    if (!v?.produits?.length) throw new Error(reader ? "prix des carburants absents du stockage" : "prix des carburants absents");
    return v;
  };
  const got = await cache.getCopy("carburants:prix", FRESH_SECONDS, load, (v) => v.lu);
  const today = localDay(now);
  const behind = got.value.depuis.slice(0, 7) < today.slice(0, 7) || (Number(today.slice(8, 10)) >= 28 && got.value.depuis <= today);
  return behind && now.getTime() - got.fetchedAt.getTime() > EARLY_SECONDS * 1000 ? cache.getCopy("carburants:prix", EARLY_SECONDS, load, (v) => v.lu) : got;
}
