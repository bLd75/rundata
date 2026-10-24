/**
 * The prefecture's press releases (reunion.gouv.fr), read once for every subject that needs them: the volcano's ORSEC
 * phase (providers/volcan.ts) and the cyclone alert's decisions. The list gives a title, a link and the day; a level
 * or a decision is only ever what a title says, never inferred: no alert is lifted, no school reopened, without the
 * release that says so.
 */
import { later } from "../budget.js";
import type { Cache, Cached } from "../cache.js";
import { getText } from "../http.js";
import { UpstreamError } from "../types.js";
import { type Info, parsePrefecture, SOURCES } from "./actualites.js";

export const SOURCE = SOURCES.prefecture;

/** The list of the latest releases, newest first; throws on a page without its list (an error page served as 200). */
export async function releases(cache: Cache): Promise<Cached<Info[]>> {
  return cache.get("prefecture:communiques", 5 * 60, async () => {
    const list = parsePrefecture(await getText(SOURCE.id, SOURCE.url, 12_000, { "User-Agent": "rundata.re (contact@rundata.re)" }));
    if (!list.length) throw new UpstreamError(SOURCE.id, "liste des communiqués vide");
    return list.sort((a, b) => b.publie.localeCompare(a.publie));
  });
}

/** A decision of the cyclone alert, as a release's title says it. */
export interface Decision {
  /** The step on the scale of providers/vigilance.ts (2 pré-alerte … 5 violette, 6 sauvegarde), or the end of the alert. */
  niveau: number | "levee";
  titre: string;
  lien: string;
  /**
   * The day of the release, ISO (noon, La Réunion's time: the list gives no hour). The day it was published, not
   * always the day decided: an alert is often announced the day before, « à compter de 5h ». The hour is in the title.
   */
  publie: string;
}

const ABOUT_CYCLONE = /cyclon|pr[ée][\s-]?alerte|alerte\s+(?:jaune|orange|rouge|violette)|phase\s+de\s+sauvegarde/i;
const ABOUT_VOLCANO = /fournaise|volcan|enclos|[ée]ruption/i;

function declared(r: Info): Decision | undefined {
  const t = r.titre;
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
  return { niveau, titre: t, lien: r.lien, publie: r.publie };
}

/** The decision of the newest release about the cyclone alert that declares one. */
export function decisionOf(list: Info[]): Decision | undefined {
  for (const r of list.filter((x) => ABOUT_CYCLONE.test(x.titre) && !ABOUT_VOLCANO.test(x.titre)).sort((a, b) => b.publie.localeCompare(a.publie))) {
    const d = declared(r);
    if (d) return d;
  }
  return undefined;
}

const REOPENING = /r[ée]ouverture|reprise\s+des\s+cours|rentr[ée]e/i;
const SCHOOLS = /[ée]coles?|[ée]tablissements\s+scolaires|cr[èe]ches?|coll[èe]ges|lyc[ée]es/i;
// « Réouverture des écoles reportée », « maintien de la fermeture »: in doubt, no reopening is read.
const NOT_YET = /report|maintien|rest(?:ent|e)\s+ferm|pas\s+de\s+r[ée]ouverture|fermeture/i;

/** The newest release that says the schools reopen, published on or after `since` (the end of the alert). */
export function reopeningOf(list: Info[], since: string): Info | undefined {
  return list.filter((x) => x.publie >= since && REOPENING.test(x.titre) && SCHOOLS.test(x.titre) && !NOT_YET.test(x.titre)).sort((a, b) => b.publie.localeCompare(a.publie))[0];
}

export interface Cyclone {
  decision: Decision;
  /** The release that says the schools reopen, after an end of alert only. */
  reouverture?: { titre: string; lien: string; publie: string };
}

// The last decision read, kept in the durable store whose keys outlive a deploy: a cold cache, a prefecture slow or
// down (as on the evening of 24/10/2026), or a release gone from its list must not lose it.
const LAST = "cyclone:prefecture:derniere-decision";
const KEEP_AGAIN_MS = 24 * 3600_000;

function cycloneOf(list: Info[]): Cyclone | null {
  const decision = decisionOf(list);
  if (!decision) return null;
  const r = decision.niveau === "levee" ? reopeningOf(list, decision.publie) : undefined;
  return { decision, reouverture: r ? { titre: r.titre, lien: r.lien, publie: r.publie } : undefined };
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
  const kept = await cache.kept<Cyclone>(LAST).catch(() => undefined);
  if (kept) return kept;
  if ("err" in read) throw read.err;
  return read;
}
