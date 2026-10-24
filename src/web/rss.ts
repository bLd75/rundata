/**
 * One RSS feed per commune (/communes/<commune>.rss): an item only when something happens there, the vigilance of its
 * zone above green, a water cut announced in it, one of its ONF trails closed, the volcano above « Vigilance ». No
 * account, nothing about the reader. Cut from the copies the pages keep (web/site.ts), never built for the feed.
 *
 * Each item's guid stays the same while the event lasts, so that a reader shows it once: the phenomenon, its worst
 * colour and the day it starts for a vigilance (a rise from yellow to orange is a new item), the notice for a water
 * cut, the trail and its cause for a closure, the level and the eruption for the volcano.
 */
import type { Cached } from "../cache.js";
import { localTime } from "../geo.js";
import * as mf from "../providers/vigilance.js";
import { cyclone, cycloneHead, cycloneLevel, highest, raised, spans } from "../tools/vigilance.js";
import { deCommune } from "./aujourdhui.js";
import type { CoupuresAnswer, RandonneesAnswer, VolcanAnswer } from "./data.js";
import { esc } from "./map.js";
import { coastal, type PlacePage } from "./places.js";

export interface RssCopies {
  vigilance?: Cached<mf.Vigilance> | null;
  coupures?: Cached<CoupuresAnswer> | null;
  randonnees?: Cached<RandonneesAnswer> | null;
  volcan?: Cached<VolcanAnswer> | null;
}

interface Item {
  title: string;
  description: string;
  /** From the site's root. */
  path: string;
  guid: string;
  /** Only when the event has a date of its own: otherwise the reader's first sight of it is the right one. */
  date?: Date;
}

/** The feed's address for a commune, from the site's root. */
export const rssPath = (p: PlacePage) => `/communes/${p.slug}.rss`;
/** The footer's link to it, and what it is for someone who has never heard of RSS. */
export const rssLink = (p: PlacePage) => `🔔 Les alertes ${deCommune(p.nom)} par RSS`;
export const rssTitle = (p: PlacePage) => `${p.nom} : alertes · rundata.re`;
export const RSS_HINT = "À ajouter dans une application de lecture de flux (Feedly, NetNewsWire…)";

// The day the feeds opened: the date of the item that says what a feed is for, shown once.
const OPENED = new Date("2026-10-24T12:00:00Z");
const WAVES = 9;
const localDay = (iso: string) => new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 10);

/** Its periods above green: the worst colour, and the first of them. */
function episode(periods: mf.Period[]) {
  const up = periods.filter((x) => x.couleur >= 2).sort((x, y) => x.debut.localeCompare(y.debut));
  return up.length ? { max: highest(up), debut: up[0].debut } : undefined;
}

/** When it was first known: its start, or the bulletin's when it starts later. */
const since = (v: mf.Vigilance, debut: string) => new Date(Math.min(Date.parse(debut), Date.parse(v.emise)));

function vigilanceItems(p: PlacePage, v: mf.Vigilance, now: Date): Item[] {
  const items: Item[] = [];
  const issued = `Bulletin de Météo-France du ${localTime(new Date(v.emise))}.`;
  const cyc = episode(v.zones[mf.ISLAND]?.[mf.CYCLONE] ?? []);
  if (cyc) {
    const c = cycloneLevel(v.zones[mf.ISLAND]?.[mf.CYCLONE], now);
    items.push({
      title: `${cycloneHead(c)} à La Réunion`,
      description: `${cyclone(v, now)} ${issued}`,
      path: "/vigilance",
      guid: `cyclone/${c}/${localDay(cyc.debut)}`,
      date: since(v, cyc.debut),
    });
  }
  const zone = mf.ZONE_OF_COMMUNE[p.nom];
  const name = (mf.ZONES[zone] ?? "").split(" :")[0];
  for (const id of [12, 1]) {
    const periods = zone ? v.zones[zone]?.[id] ?? [] : [];
    const e = episode(periods);
    if (!e) continue;
    items.push({
      title: `Vigilance ${mf.colour(e.max)} ${mf.PHENOMENA[id].toLowerCase()} : zone ${name}`,
      description: `${p.nom} est dans la zone ${name} : ${spans(periods).join(", ")}. ${issued}`,
      path: "/vigilance",
      guid: `vigilance/${zone}/${id}/${e.max}/${localDay(e.debut)}`,
      date: since(v, e.debut),
    });
  }
  if (coastal(p)) {
    const coast = Object.values(v.zones).flatMap((z) => z[WAVES] ?? []);
    const e = episode(coast);
    if (e) {
      const where = raised(v).filter((x) => x.phenomene === mf.PHENOMENA[WAVES]).map((x) => `${x.zone} : ${x.periodes.join(", ")}`);
      items.push({
        title: `Vigilance ${mf.colour(e.max)} vagues-submersion sur le littoral`,
        description: `${where.join(" ; ")}. ${issued}`,
        path: "/vigilance",
        guid: `vigilance/littoral/${WAVES}/${e.max}/${localDay(e.debut)}`,
        date: since(v, e.debut),
      });
    }
  }
  return items;
}

/** « 26/10/2026 à 08:00 », local: the date the notice says it was published. */
function published(s: string): Date | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) à (\d{2}):(\d{2})$/.exec(s);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00+04:00`) : undefined;
}

function waterItems(p: PlacePage, c: CoupuresAnswer): Item[] {
  return c.avis
    .filter((n) => n.communes.includes(p.nom) && n.coupure?.etat !== "terminée")
    .map((n) => ({
      title: `Eau : ${n.titre}`,
      description: [
        n.ne_pas_boire ? "Ne pas boire l'eau du robinet." : "",
        n.coupure?.de ? `Coupure ${n.coupure.a ? `du ${n.coupure.de} au ${n.coupure.a}` : `à partir du ${n.coupure.de}`}.` : "",
        n.secteurs_complets ? `Secteurs : ${n.secteurs.join(", ")}.` : "",
        n.lien ? `Avis de ${n.distributeur} : ${n.lien}` : `Avis de ${n.distributeur}.`,
      ].filter(Boolean).join(" "),
      path: `/coupures-eau/${p.slug}`,
      guid: `eau/${n.lien ?? n.publie_le}/${n.titre}`,
      date: published(n.publie_le),
    }));
}

/** The ONF's words, with one full stop. */
const sentence = (s: string) => `${s.trim().replace(/[.\s]+$/, "")}.`;

function trailItems(p: PlacePage, r: RandonneesAnswer): Item[] {
  return r.secteurs
    .flatMap((z) => z.sentiers)
    .filter((t) => t.commune === p.nom && t.etat === "fermé")
    .map((t) => ({
      title: `Sentier ${t.partiel ? "fermé en partie" : "fermé"} : ${t.nom}`,
      description: [t.cause ? `Cause : ${sentence(t.cause)}` : "", t.precision ? `Précision de l'ONF : ${sentence(t.precision)}` : "", "D'après la carte des sentiers de l'ONF La Réunion."].filter(Boolean).join(" "),
      path: t.slug ? `/sentiers/${t.slug}` : "/sentiers",
      guid: `sentier/${t.nom}/${t.cause ?? ""}`,
    }));
}

function volcanoItems(v: VolcanAnswer): Item[] {
  const e = v.etat;
  if (!e || (!e.eruption_en_cours && (e.niveau_orsec === "Vigilance" || e.niveau_inconnu))) return [];
  const start = e.eruption_en_cours ? e.eruption?.started_at : undefined;
  return [{
    title: e.eruption_en_cours ? `Éruption en cours au Piton de la Fournaise (${e.niveau_orsec})` : `Piton de la Fournaise : ${e.niveau_orsec}`,
    description: [v.resume, e.acces_enclos?.detail ?? ""].filter(Boolean).join(" "),
    path: "/volcan",
    // The last eruption's end tells one alert from the next.
    guid: `volcan/${e.niveau_orsec}/${e.eruption_en_cours ? `eruption/${start ?? ""}` : (e.derniere_eruption_fin ?? "")}`,
    date: start ? new Date(start) : undefined,
  }];
}

/** The items of a commune's feed, from what its copies say now. */
export function rssItems(p: PlacePage, l: RssCopies, now: Date): Item[] {
  return [
    ...(l.vigilance ? vigilanceItems(p, l.vigilance.value, now) : []),
    ...(l.coupures ? waterItems(p, l.coupures.value) : []),
    ...(l.randonnees ? trailItems(p, l.randonnees.value) : []),
    ...(l.volcan ? volcanoItems(l.volcan.value) : []),
  ];
}

export function communeRss(origin: string, p: PlacePage, l: RssCopies, now = new Date()): string {
  const page = `${origin}/communes/${p.slug}`;
  const de = deCommune(p.nom);
  const welcome: Item = {
    title: `Ce flux publie les alertes ${de}`,
    description: "Un article apparaît ici quand Météo-France place la zone en vigilance, quand un distributeur annonce une coupure d'eau dans la commune, quand l'ONF ferme un sentier ou quand le volcan passe en alerte. Rien les jours calmes.",
    path: `/communes/${p.slug}`,
    guid: "flux",
    date: OPENED,
  };
  const items = [...rssItems(p, l, now), welcome];
  // The newest copy read: the feed changes only when one of them does.
  const read = Object.values(l).filter((c): c is Cached<unknown> => !!c).map((c) => c.fetchedAt.getTime());
  const built = read.length ? Math.max(...read) : OPENED.getTime();
  const item = (i: Item) =>
    `<item><title>${esc(i.title)}</title><link>${esc(origin + i.path)}</link><description>${esc(i.description)}</description>` +
    `<guid isPermaLink="false">${esc(`${origin.replace(/^https?:\/\//, "")}/${p.slug}/${i.guid}`)}</guid>${i.date ? `<pubDate>${i.date.toUTCString()}</pubDate>` : ""}</item>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(rssTitle(p))}</title>
<link>${esc(page)}</link>
<atom:link href="${esc(origin + rssPath(p))}" rel="self" type="application/rss+xml"/>
<description>${esc(`Vigilance Météo-France, coupures d'eau, sentiers fermés et volcan ${de} (974) : un article seulement quand il se passe quelque chose.`)}</description>
<language>fr-FR</language>
<lastBuildDate>${new Date(built).toUTCString()}</lastBuildDate>
<ttl>15</ttl>
${items.map(item).join("\n")}
</channel>
</rss>
`;
}
