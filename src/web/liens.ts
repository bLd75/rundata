/**
 * The links between the weather, the hikes and the communes (audit §13): the hikes around a place on its weather page,
 * the weather nearest a trail on its page, the weather of the communes where something happens this weekend. Worked out
 * from the bundled traces and places, and from the copies of the pages already there: nothing is fetched.
 */
import type { Cached } from "../cache.js";
import { distanceKm } from "../geo.js";
import * as traces from "../providers/traces.js";
import * as fire from "../tools/feux.js";
import { mentionCommune, mentionCourte } from "../tools/agenda.js";
import { secteur } from "../tools/sentiers.js";
import { secteurNamed } from "../traces/secteurs.js";
import type { AgendaAnswer, RandonneesAnswer } from "./data.js";
import { esc } from "./map.js";
import type { Live } from "./pages.js";
import { PAGES, type PlacePage } from "./places.js";

// Hikes farther than this from a place are not « around » it.
const AROUND_KM = 12;
const AROUND_MAX = 5;

let routePoints: { r: traces.Randonnee; points: [number, number][] }[] | undefined;
/** Every hike's points, once per isolate: a few thousand, decoded from the bundle. */
const routes = () => (routePoints ??= traces.RANDONNEES.map((r) => ({ r, points: r.lignes.flatMap((l) => traces.decode(l)) })));

/** The hikes passing nearest a point, the nearest first, within AROUND_KM. */
export function hikesNear(lon: number, lat: number, max = AROUND_MAX): { r: traces.Randonnee; km: number }[] {
  return routes()
    .map(({ r, points }) => ({ r, km: points.reduce((m, [x, y]) => Math.min(m, distanceKm(lon, lat, x, y)), Infinity) }))
    .filter((x) => x.km <= AROUND_KM)
    .sort((x, y) => x.km - y.km)
    .slice(0, max);
}

/** The weather page nearest a point: a commune or one of the places with a page (Maïdo, Piton de la Fournaise…). */
export function weatherNear(lon: number, lat: number): PlacePage {
  return PAGES.reduce((best, p) => (distanceKm(lon, lat, p.place.lon, p.place.lat) < distanceKm(lon, lat, best.place.lon, best.place.lat) ? p : best));
}

const kmFr = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** « Randonner autour de Cilaos » on a place's weather page: its nearest hikes with their state, and its sector. */
export function hikesAround(p: PlacePage, hikes: Cached<RandonneesAnswer> | null | undefined): string {
  const near = hikesNear(p.place.lon, p.place.lat);
  const sector = secteurNamed(secteur(p.place.lon, p.place.lat).secteur);
  if (!near.length && !sector) return "";
  const cards = new Map((hikes?.value.randonnees ?? []).map((h) => [h.slug, h]));
  const state = (slug: string) => {
    const h = cards.get(slug);
    if (!h) return "";
    return h.fermes.length ? `<span class="q-mauvaise">${h.fermes.length} tronçon${h.fermes.length > 1 ? "s" : ""} fermé${h.fermes.length > 1 ? "s" : ""}</span>` : h.onf > h.inconnus.length ? `<span class="q-bonne">ouvert</span>` : `<span class="q-none">état non suivi</span>`;
  };
  const list = near.length
    ? `<ul class="rows eau">${near.map(({ r, km }) => `<li><span><a href="/randonnees/${esc(r.slug)}">${esc(r.nom)}</a><small>${kmFr(r.km)} km · +${r.dplus.toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " ")} m · passe à ${kmFr(km)} km</small></span>${state(r.slug)}</li>`).join("")}</ul>`
    : "";
  return `<section aria-labelledby="h-rando">
  <h2 id="h-rando">Randonner autour de ${esc(p.nom)}</h2>
  ${list ? `<div class="card">${list}</div>` : ""}
  ${sector ? `<p class="note"><a href="/randonnees/${sector.slug}">Randonnée ${esc(sector.dans)} : tous les sentiers, ceux qui sont fermés, les accès →</a></p>` : ""}
</section>`;
}

/** « Météo Cilaos » on a trail's or a hike's page, from the middle of its line, and the vigilance. */
export function weatherForTrace(points: [number, number][]): string {
  if (!points.length) return "";
  const [lon, lat] = points[Math.floor(points.length / 2)];
  const p = weatherNear(lon, lat);
  return `<p class="note">Avant de partir : <a href="/meteo/${p.slug}">météo ${esc(p.nom)}</a>, mesurée et prévue, et <a href="/vigilance">la vigilance de Météo-France</a>.</p>`;
}

// The summits whose cloud sea of the morning is told (tools/nuages.ts): on a place's page, or on /randonnees for the
// Piton des Neiges, which has none. Most climbs to the Grand Bénare start at the Maïdo: its line is the Maïdo's, with
// the height between the two (2 898 m, the Maïdo's 2 197 m). Worded by marketing.
export interface Summit {
  lon: number;
  lat: number;
  lieu: string;
  href: string;
  /** The copy the link leads to, which tells it: a place's page or the hikers' page. */
  copy: string;
  /** The line of /randonnees that tells it, when that is where the link leads. */
  haut?: string;
  apres?: string;
}
const SUMMITS: Summit[] = [
  { lon: 55.38757, lat: -21.06885, lieu: "au Maïdo", href: "/meteo/maido#mer-de-nuages", copy: "web:lieu:maido" },
  {
    lon: 55.42217, lat: -21.11613, lieu: "au Maïdo", href: "/meteo/maido#mer-de-nuages", copy: "web:lieu:maido",
    apres: "Le sommet du Grand Bénare est environ 700\u00a0m plus haut que le Maïdo.",
  },
  { lon: 55.48003, lat: -21.09945, lieu: "au Piton des Neiges", href: "/randonnees#mer-de-nuages", copy: "web:randonnees", haut: "Piton des Neiges" },
  { lon: 55.68916, lat: -21.22227, lieu: "au Pas de Bellecombe", href: "/meteo/piton-de-la-fournaise#mer-de-nuages", copy: "web:lieu:piton-de-la-fournaise" },
];
// A trail within this of a summit reaches it: the summit at one end, or on the way.
const SUMMIT_KM = 0.5;

/** The summit a trail or a hike reaches, if any. */
export function summitOf(points: [number, number][]): Summit | undefined {
  return SUMMITS.find((x) => points.some(([lon, lat]) => distanceKm(lon, lat, x.lon, x.lat) <= SUMMIT_KM));
}

/** Whether the copy of the page the link leads to tells the morning's cloud sea: else the link would lead nowhere. */
export function cloudSeaTold(s: Summit, copy: Cached<{ prevision?: { mer_de_nuages?: unknown }; hauts?: { nom: string }[] }> | null | undefined): boolean {
  const v = copy?.value;
  return s.haut ? !!v?.hauts?.some((h) => h.nom === s.haut) : !!v?.prevision?.mer_de_nuages;
}

/** On a summit's trail's or hike's page, the link to the morning's cloud sea there. */
export function cloudSeaLink(s: Summit | undefined): string {
  return s ? `<p class="note">Au-dessus ou dans les nuages ? <a href="${s.href}">Mer de nuages ${esc(s.lieu)} : la prévision</a> du modèle AROME de Météo-France, pas une mesure.${s.apres ? ` ${esc(s.apres)}` : ""}</p>` : "";
}

/** The weather pages of the communes where something happens on a day: « Prévision : Saint-Paul, Le Port ». */
export function forecastLinks(communes: (string | undefined)[]): string {
  const pages = [...new Set(communes.filter((c): c is string => !!c))].map((c) => PAGES.find((p) => p.commune && p.nom === c)).filter((p): p is PlacePage => !!p);
  return pages.length ? `<p class="note">Prévision météo : ${pages.map((p) => `<a href="/meteo/${p.slug}">${esc(p.nom)}</a>`).join(", ")}.</p>` : "";
}

/**
 * The commune's page's hiking tile: its ONF trails, those closed, and its sector's page; first, the fires seen by
 * satellite in the commune, with the emergency numbers (worded by marketing).
 */
export function communeHikes(p: PlacePage, hikes: Cached<RandonneesAnswer> | null | undefined, now = new Date()): { live?: Live; href: string; foot?: string } | undefined {
  const sector = secteurNamed(secteur(p.place.lon, p.place.lat).secteur);
  const href = sector ? `/randonnees/${sector.slug}` : "/randonnees";
  if (!hikes) return { href };
  const trails = hikes.value.secteurs.flatMap((z) => z.sentiers).filter((t) => t.commune === p.nom);
  const fires = hikes.value.feux?.detections.filter((d) => d.commune === p.nom) ?? [];
  const burning = fires.length ? `${esc(fire.tileLine(fires, now))} · <b>${esc(fire.URGENCE)}</b>` : "";
  const foot = burning ? `<a href="/feux">Voir la carte des feux →</a>` : undefined;
  if (!trails.length) return burning ? { href: "/feux", live: { valeur: "Feu détecté", detail: burning }, foot } : undefined;
  const shut = trails.filter((t) => t.etat === "fermé").length;
  return {
    href,
    foot,
    live: {
      valeur: shut ? `${shut} sentier${shut > 1 ? "s" : ""} fermé${shut > 1 ? "s" : ""}` : "Sentiers ouverts",
      detail: `${burning ? `${burning} · ` : ""}sur ${trails.length} sentiers de l'ONF dans la commune${sector ? ` · randonnée ${esc(sector.dans)}` : ""}`,
    },
  };
}

/** The commune's page's tile of outings: what its agendas announce in the two weeks. */
export function communeEvents(p: PlacePage, agenda: Cached<AgendaAnswer> | null | undefined): Live | undefined {
  if (!agenda) return undefined;
  const rows = (agenda.value.evenements ?? []).filter((r) => r.commune === p.nom);
  // Its site not read until it agrees: said first, in short, the whole of it in the title; and never « rien d'annoncé »,
  // which would be wrong (marketing).
  const mention = mentionCourte(p.nom);
  const title = mentionCommune(p.nom);
  if (!rows.length) return mention ? { valeur: mention.valeur, detail: esc(mention.detail), title } : { valeur: "Rien d'annoncé", detail: "d'ici quinze jours dans les agendas lus" };
  const next = `le prochain : ${esc(rows[0].titre)}, ${esc(rows[0].quand)}${rows[0].source ? ` (Source\u00a0: ${esc(rows[0].source)})` : ""}`;
  return { valeur: `${rows.length} événement${rows.length > 1 ? "s" : ""}`, detail: mention ? `${mention.tete} · ${next}` : `d'ici quinze jours ; ${next}`, title };
}
