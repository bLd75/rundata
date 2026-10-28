/**
 * The prefecture's press releases (reunion.gouv.fr), read once for every subject that needs them: the volcano's ORSEC
 * phase (providers/volcan.ts) and the cyclone alert's decisions. The list gives a title, a link and the day; a level
 * or a decision is only ever what a title says, never inferred: no alert is lifted, no school reopened, without the
 * release that says so.
 */
import { later } from "../budget.js";
import type { Cache, Cached } from "../cache.js";
import { localTime } from "../geo.js";
import { getText } from "../http.js";
import { UpstreamError } from "../types.js";
import { when } from "../tools/injoignable.js";
import { type Info, parsePrefecture, SOURCES } from "./actualites.js";
import * as copie from "./prefecture-copie.js";

export const SOURCE = SOURCES.prefecture;

const ORIGIN = "https://www.reunion.gouv.fr";
const HEADERS = { "User-Agent": "rundata.re (contact@rundata.re)" };
// During a cyclone the prefecture opens a section of its own (« /Actualites/Cyclone-Garance », February 2025), where
// the red alert, the violet one and the phase de sauvegarde appeared, not in the press releases; its menu links it.
const SECTION = /href="(?:https:\/\/www\.reunion\.gouv\.fr)?(\/Actualites\/Cyclone-[A-Za-z0-9-]+)"/;

/** The section of the cyclone the page's menu links to, if any: « /Actualites/Cyclone-Garance ». */
export function sectionOf(html: string): string | undefined {
  return SECTION.exec(html)?.[1];
}

export interface Communiques {
  liste: Info[];
  /** The cyclone's section, linked by the menu, did not answer: its releases are missing from `liste`. */
  rubrique_non_lue?: true;
}

// Not « prefecture:communiques »: the copies kept under that key are a bare list.
const KEY = "prefecture:communiques:rubrique";

/**
 * The latest releases read from the site, newest first: the press releases, and those of the cyclone's section when the
 * menu has one (one page more, then). `read` asks one page. Throws on a page without its list (an error page served as
 * 200); a section that fails leaves the press releases alone, and is noted (`rubrique_non_lue`): never a silent fallback.
 * The Worker never calls it (`communiques`): scripts/prefecture.ts does, on a machine of the project.
 */
export async function lireSite(read: (url: string) => Promise<string>): Promise<Communiques> {
  const html = await read(SOURCE.url);
  const list = parsePrefecture(html);
  if (!list.length) throw new UpstreamError(SOURCE.id, "liste des communiqués vide");
  const section = sectionOf(html);
  const more = section
    ? await read(`${ORIGIN}${section}`).then((h) => parsePrefecture(h)).catch((err) => (console.error(`préfecture : rubrique ${section} non lue`, err), null))
    : [];
  const seen = new Set<string>();
  const liste = [...list, ...(more ?? [])].filter((r) => !seen.has(r.lien) && seen.add(r.lien)).sort((a, b) => b.publie.localeCompare(a.publie));
  return more ? { liste } : { liste, rubrique_non_lue: true };
}

/** One page of the prefecture's site. */
export const getPage = (url: string) => getText(SOURCE.id, url, 12_000, HEADERS);

// The collector's copy (prefecture-copie.ts) in the data center's cache: asked of the store every 5 minutes at most.
const COPY_KEY = "prefecture:communiques:copie";

/**
 * The latest releases, newest first. In the Worker, the collector's copy, its time the collector's read: not renewed
 * for `SILENT_MS`, it is served as the copy of a site that did not answer since. Elsewhere, the site (`lireSite`).
 */
async function communiques(cache: Cache): Promise<Cached<Communiques>> {
  if (copie.configured()) {
    const c = await cache.get(COPY_KEY, 5 * 60, async () => {
      const v = await copie.copie();
      if (!v?.liste.length) throw new UpstreamError(SOURCE.id, "copie des communiqués absente du stockage");
      return v;
    });
    const late = Date.now() - Date.parse(c.value.lu_le) > copie.SILENT_MS;
    return { ...c, fetchedAt: new Date(c.value.lu_le), ...(late && { stale: true, source: SOURCE.id }) };
  }
  return cache.island(KEY, 5 * 60, () => lireSite(getPage));
}

/** The latest releases, newest first (`communiques`). */
export async function releases(cache: Cache): Promise<Cached<Info[]>> {
  const c = await communiques(cache);
  return { ...c, value: c.value.liste };
}

/**
 * Said beside the decision when the cyclone's section did not answer at the last read: the red and violet alerts and
 * the phase de sauvegarde were published there only (February 2025), so a decision may be missing. Undefined otherwise.
 */
export async function rubriqueNonLue(cache: Cache, now: Date): Promise<string | undefined> {
  const c = await cache.peek<Communiques & { lu_le?: string }>(copie.configured() ? COPY_KEY : KEY).catch(() => undefined);
  if (!c?.value.rubrique_non_lue) return undefined;
  const at = c.value.lu_le ? new Date(c.value.lu_le) : c.fetchedAt;
  return `La rubrique cyclone du site de la préfecture n'a pas répondu à notre dernière lecture (${when(localTime(at), now)}) : une décision publiée depuis peut manquer ici.`;
}

/** A decision of the cyclone alert, as a release's title says it. */
export interface Decision {
  /** The step on the scale of providers/vigilance.ts (2 pré-alerte … 5 violette, 6 sauvegarde), or the end of the alert. */
  niveau: number | "levee";
  titre: string;
  lien: string;
  /**
   * The day of the release, La Réunion's, « 2026-10-24 »: the list gives no hour, and none is made up. The day it was
   * published, not always the day decided: an alert is often announced the day before, « à compter de 5h ». The hour
   * is in the title.
   */
  jour: string;
}

/** The day of La Réunion of an instant, « 2026-10-24 ». */
const localDay = (iso: string) => new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 10);

const ABOUT_CYCLONE = /cyclon|pr[ée][\s-]?alerte|alerte\s+(?:jaune|orange|rouge|violette)|phase\s+de\s+sauvegarde/i;
// A title that declares a step, not one that speaks of it in passing (« La couleur jaune associée à la pré-alerte
// cyclonique disparait… », 26/11/2024): the step at its start, after a name or a colon (« Alerte rouge cyclonique : »,
// « Belal Alerte orange cyclonique », « Cyclone Garance : passage en phase de sauvegarde »), or a verb of decision.
const DECLARES = new RegExp(
  [
    "^(?:[^:«]*:\\s*|\\p{Lu}[\\p{L}-]+\\s+)?(?:pr[ée][\\s-]?alerte(?:\\s+jaune)?|alerte\\s+(?:orange|rouge|violette))\\s+cyclonique",
    "^(?:[^:«]*:\\s*)?phase\\s+de\\s+sauvegarde",
    "passage\\s+en\\s+(?:pr[ée][\\s-]?alerte|alerte|phase\\s+de\\s+sauvegarde)",
    "d[ée]clenchement|activation",
    "\\b(?:fin|lev[ée]e)\\s+(?:de\\s+l['’]\\s*|d['’]\\s*)alerte",
  ].join("|"),
  "iu",
);
const ABOUT_VOLCANO = /fournaise|volcan|enclos|[ée]ruption/i;
/**
 * A release about the volcano, by its title or its address: the volcano's plan has a phase de sauvegarde too, and its
 * titles do not always name it (« Retour en phase de vigilance », 26/10/2026, about the Enclos).
 */
const aboutVolcano = (r: Info) => ABOUT_VOLCANO.test(r.titre) || ABOUT_VOLCANO.test(slugWords(r.lien));

/** The words of a release's address: « retour en phase de vigilance ». */
export function slugWords(lien: string): string {
  const last = lien.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() ?? "";
  let words = last;
  try {
    words = decodeURIComponent(last);
  } catch {
    // A malformed escape: the address as written.
  }
  return words.replace(/[-_]+/g, " ");
}

function declared(r: Info): Decision | undefined {
  const t = r.titre;
  if (!DECLARES.test(t)) return undefined;
  // The way out of the red alert goes through the phase de sauvegarde, often in the same title as the red's end
  // (« levée de l'alerte rouge, passage en phase de sauvegarde »): the sauvegarde first, then the end of the alert.
  const niveau = /sauvegarde/i.test(t)
    ? 6
    : /\b(?:fin|lev[ée]e)\s+(?:de\s+l['’]\s*|d['’]\s*)alerte/i.test(t)
      ? "levee"
      : /violette/i.test(t)
        ? 5
        : /\brouge\b/i.test(t)
          ? 4
          : /\borange\b/i.test(t)
            ? 3
            : /pr[ée][\s-]?alerte|\bjaune\b/i.test(t)
              ? 2
              : undefined;
  if (niveau === undefined) return undefined;
  return { niveau, titre: t, lien: r.lien, jour: localDay(r.publie) };
}

/** The decision of the newest release about the cyclone alert that declares one. */
export function decisionOf(list: Info[]): Decision | undefined {
  for (const r of list.filter((x) => ABOUT_CYCLONE.test(x.titre) && !aboutVolcano(x)).sort((a, b) => b.publie.localeCompare(a.publie))) {
    const d = declared(r);
    if (d) return d;
  }
  return undefined;
}

const REOPENING = /r[ée]ouverture|reprise\s+des\s+cours|rentr[ée]e/i;
const SCHOOLS = /[ée]coles?|[ée]tablissements\s+scolaires|cr[èe]ches?|coll[èe]ges|lyc[ée]es/i;
// « Réouverture des écoles reportée », « maintien de la fermeture »: in doubt, no reopening is read.
const NOT_YET = /report|maintien|rest(?:ent|e)\s+ferm|pas\s+de\s+r[ée]ouverture|fermeture/i;

/** The newest release that says the schools reopen, published on or after the day `since` (the end of the alert's). */
export function reopeningOf(list: Info[], since: string): Info | undefined {
  return list.filter((x) => localDay(x.publie) >= since && REOPENING.test(x.titre) && SCHOOLS.test(x.titre) && !NOT_YET.test(x.titre)).sort((a, b) => b.publie.localeCompare(a.publie))[0];
}

export interface Cyclone {
  decision: Decision;
  /** The release that says the schools reopen, after an end of alert only. */
  reouverture?: { titre: string; lien: string; jour: string };
}

type Dated = { jour?: string; publie?: string };
/** A decision kept by an earlier version, its days instants (`publie`, noon of La Réunion), given their `jour`. */
function withDay(c: Cyclone): Cyclone {
  const day = <T extends Dated>(x: T): Omit<T, "publie"> & { jour: string } => {
    const { publie, ...rest } = x;
    return { ...rest, jour: x.jour ?? localDay(publie!) };
  };
  return { decision: day(c.decision as Decision & Dated) as Decision, ...(c.reouverture && { reouverture: day(c.reouverture as Cyclone["reouverture"] & Dated) as Cyclone["reouverture"] }) };
}

// The last decision read, kept in the durable store whose keys outlive a deploy: a cold cache, a prefecture slow or
// down (as on the evening of 24/10/2026), or a release gone from its list must not lose it.
const LAST = "cyclone:prefecture:derniere-decision";
const KEEP_AGAIN_MS = 24 * 3600_000;

function cycloneOf(list: Info[]): Cyclone | null {
  const decision = decisionOf(list);
  if (!decision) return null;
  const r = decision.niveau === "levee" ? reopeningOf(list, decision.jour) : undefined;
  return { decision, reouverture: r ? { titre: r.titre, lien: r.lien, jour: localDay(r.publie) } : undefined };
}

/** The newest decision the releases declare; else the last one kept, as old as it is; null when there is none. */
export async function cyclone(cache: Cache, now = Date.now()): Promise<Cached<Cyclone | null>> {
  const read = await releases(cache).then((l) => ({ ...l, value: cycloneOf(l.value) })).catch((err: unknown) => ({ err }));
  if ("value" in read && read.value) {
    const c = read.value;
    if (!read.stale) {
      later(
        (async () => {
          const k = await cache.kept<Cyclone>(LAST).catch(() => undefined);
          if (k && JSON.stringify(k.value) === JSON.stringify(c) && now - k.fetchedAt.getTime() < KEEP_AGAIN_MS) return;
          await cache.keep(LAST, c);
        })().catch((err) => console.error("cyclone : décision non gardée", err)),
      );
    }
    return read;
  }
  const kept = await keptCyclone(cache);
  if (kept) return kept;
  if ("err" in read) throw read.err;
  return read;
}

/** The last decision kept, as old as it is (it says its day), without reading the prefecture: for a page that cannot wait for it. */
export async function keptCyclone(cache: Cache): Promise<Cached<Cyclone | null> | undefined> {
  const kept = await cache.kept<Cyclone>(LAST).catch(() => undefined);
  return kept && { ...kept, value: kept.value && withDay(kept.value) };
}
