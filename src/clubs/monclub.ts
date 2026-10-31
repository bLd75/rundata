/**
 * The Fédération française de handball's MonClub (monclub.ffhandball.fr), the first source of official addresses of
 * the clubs' space (level 1): the federation makes for each club an address « <its 7-digit number>@reunion.ffhandball.net »,
 * and gives it on the club's public page. robots.txt lets everything be read; ffhandball.fr's legal notice has no clause
 * against reuse.
 *
 * - `annuaire`: the island's clubs, from the map of the home page (a GeoJSON, HTML-escaped in an attribute): their name,
 *   town, postcode and page. Read once a week (clubs/espace.ts), never on a view. The page is about 2.2 Mo.
 * - `adresse`: a club's address, read on its page at the moment it is needed (screen 2, and each e-mail), never kept.
 *   Only an address of the federation's form counts: another one on the page, typed by the club, is not official.
 */
import { getText } from "../http.js";
import { communeAdresse } from "../places/codes-postaux.js";

export const SOURCE = "monclub";
export const ACCUEIL = "https://monclub.ffhandball.fr/";
const FICHES = "https://monclub.ffhandball.fr/clubs/";
const TIMEOUT_MS = 20_000;
/** The address the federation makes for a club of La Réunion's league. */
export const ADRESSE_FEDERATION = /^\d{7}@reunion\.ffhandball\.net$/;
/** Who makes it, as the screens say it. */
export const FEDERATION = "la Fédération française de handball";

/** A club of the map. */
export interface ClubMonClub {
  /** Its page's id on MonClub. */
  ref: string;
  nom: string;
  commune?: string;
  /** Its page, https://monclub.ffhandball.fr/clubs/<slug>/. */
  fiche: string;
}

// The entities of an attribute's value; « < » and « > » too, the value being read as JSON, never as HTML. A number
// past Unicode's last code point is left as written.
const ENTITES: Record<string, string> = { quot: '"', amp: "&", apos: "'", lt: "<", gt: ">" };
const point = (n: number) => (n <= 0x10ffff ? String.fromCodePoint(n) : undefined);
const attribut = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) =>
    (e[0] === "#" ? point(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITES[e]) ?? m);

/** The JSON object that starts at the first « { » from `at`, braces counted outside its strings; undefined if cut or not JSON. */
function objet(s: string, at: number): unknown {
  const start = s.indexOf("{", at);
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(s.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

interface Feature {
  properties?: { id?: unknown; title?: unknown; zipcode?: unknown; city?: unknown; url?: unknown; type?: unknown };
}

/**
 * The island's clubs on the map of MonClub's home page: postcode in 974 or a CEDEX of the island, and a club's page
 * (not the league's nor its committee's). Throws when the map is not found: the page changed, and nothing is to be
 * read as « no club ».
 */
export function clubsDeLAccueil(html: string): ClubMonClub[] {
  const at = html.indexOf("&quot;geojson&quot;:");
  const end = at < 0 ? -1 : html.indexOf('"', at);
  const geo = at < 0 || end < 0 ? undefined : (objet(attribut(html.slice(at, end)), 0) as { features?: Feature[] } | undefined);
  if (!Array.isArray(geo?.features)) throw new Error("monclub : carte des clubs introuvable");
  const out: ClubMonClub[] = [];
  for (const f of geo.features) {
    const p = f.properties ?? {};
    const cp = String(p.zipcode ?? "").trim();
    const url = String(p.url ?? "");
    if (!/^97[478]\d\d$/.test(cp) || p.type !== "smartfire-clubs" || !url.startsWith(FICHES) || !/^\d+$/.test(String(p.id))) continue;
    const nom = String(p.title ?? "").replace(/\s+/g, " ").trim();
    if (!nom) continue;
    out.push({ ref: String(p.id), nom, commune: communeAdresse(cp, String(p.city ?? "")), fiche: url });
  }
  return out;
}

/** The island's clubs, read now on MonClub's home page. */
export async function annuaire(): Promise<ClubMonClub[]> {
  return clubsDeLAccueil(await getText(SOURCE, ACCUEIL, TIMEOUT_MS));
}

interface Post {
  ID?: unknown;
  acf?: { email_club?: unknown };
}

// Braces tried outwards from an « "ID": », before giving up on it.
const ESSAIS = 8;

/** The object around `at` whose own ID is `id`: tried from the nearest « { » before `at`, outwards. */
function post(s: string, at: number, id: number): Post | undefined {
  for (let open = s.lastIndexOf("{", at), n = 0; open >= 0 && n < ESSAIS; open = s.lastIndexOf("{", open - 1), n++) {
    const o = objet(s, open) as Post | undefined;
    if (o && typeof o === "object" && o.ID === id) return o;
  }
  return undefined;
}

/**
 * The address the page of club `ref` gives, when it is the federation's: in its page's data, the object of the club
 * (`"ID":<ref>`) and its own `acf.email_club`, never a neighbour's. undefined when the page gives none, gives another
 * one, or two different ones.
 */
export function adresseDeLaFiche(html: string, ref: string): string | undefined {
  const s = attribut(html);
  const id = Number(ref);
  const found = new Set<string>();
  for (let at = s.indexOf(`"ID":${ref},`); at >= 0; at = s.indexOf(`"ID":${ref},`, at + 1)) {
    const e = post(s, at, id)?.acf?.email_club;
    if (typeof e === "string") found.add(e.trim().toLowerCase());
  }
  const [only] = found;
  return found.size === 1 && ADRESSE_FEDERATION.test(only) ? only : undefined;
}

/** The address of a club, read now on its page; only a page of MonClub's clubs is ever read. */
export async function adresse(fiche: string, ref: string): Promise<string | undefined> {
  if (!fiche.startsWith(FICHES) || !/^\d+$/.test(ref)) return undefined;
  return adresseDeLaFiche(await getText(SOURCE, fiche, TIMEOUT_MS), ref);
}
