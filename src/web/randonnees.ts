/**
 * A page per sector of the hikes (/randonnees/mafate, /randonnees/cilaos…): its closed trails first, its routes with a
 * GPS trace, its ONF trails, how to get there and the weather of its nearest page. Cut from the hikers' page's copy
 * (web:randonnees) and the weather page's (web:lieu:<slug>), read as they are: nothing more is fetched.
 */
import type { Cached } from "../cache.js";
import * as traces from "../providers/traces.js";
import type { Secteur } from "../traces/secteurs.js";
import type { Alerte, PlaceData, RandonneesAnswer } from "./data.js";
import { closedLi, connectorCta, describe, hikeCard, loading, plural, sectorLinks, sectorTrail, sourcesNote, trailLi, webPage } from "./domains.js";
import { esc, hikesMap } from "./map.js";
import { ask, icon, layout, thin } from "./pages.js";
import { pageOf } from "./places.js";

const TITLE_MAX = 60;

/** The routes of a sector: those mostly in it, then those crossing it. */
export const routesIn = (d: RandonneesAnswer, s: Secteur) => {
  const of = (slug: string) => traces.randonnee(slug);
  return [...d.randonnees.filter((h) => of(h.slug)?.secteur === s.nom), ...d.randonnees.filter((h) => of(h.slug)?.secteur !== s.nom && of(h.slug)?.secteurs?.includes(s.nom))];
};

// The lines of the map open the page of the hike or trail clicked, from the lists below it.
const MAP_SCRIPT = `(()=>{const m=document.getElementById("hmap");if(m)m.addEventListener("click",(e)=>{const k=e.target.dataset?.k,a=k&&document.querySelector('li[data-k="'+k+'"] a');if(a)location.href=a.href})})();`;

/** The weather of the sector's page: the measure and the next days' forecast, from that page's last copy. */
function weather(s: Secteur, data: Cached<PlaceData> | null): string {
  const p = s.meteo ? pageOf(s.meteo) : undefined;
  if (!p) return `<div class="card">${icon("mountain")}<h3>La météo</h3><p>Voir <a href="/meteo">la météo de l'île</a>, station par station, et <a href="/vigilance">la vigilance</a>.</p></div>`;
  // A station far below or on the other side says little of the hikes: only one that stands for the place.
  const st = data?.value.meteo?.stations.find((x) => x.mesures.temperature && x.pertinence !== "faible");
  const days = data?.value.prevision?.jours?.slice(0, 2) ?? [];
  const range = (lo?: string, hi?: string) => (lo && hi ? `${thin(lo)} / ${thin(hi)}` : "");
  return `<div class="card">${icon("mountain")}<h3>Météo ${esc(p.nom)}</h3>` +
    (st ? `<p><b>${esc(thin(st.mesures.temperature!))}</b> mesurés à ${esc(st.heure_mesure.split(" ")[1] ?? st.heure_mesure)} par la station ${esc(st.station)} (${st.altitude_m.toLocaleString("fr-FR")} m${st.distance_km != null ? `, à ${String(st.distance_km).replace(".", ",")} km` : ""})${st.mesures.pluie_1h ? `, pluie sur une heure ${esc(thin(st.mesures.pluie_1h))}` : ""}.</p>` : "") +
    (days.length ? `<p>Prévision, pas une mesure : ${days.map((j) => `${esc(j.jour)} ${esc(range(j.temperature_min, j.temperature_max))}${j.ciel_en_journee ? `, ${esc(j.ciel_en_journee)}` : ""}`).join(" ; ")}.</p>` : "") +
    `<p><a href="/meteo/${esc(p.slug)}">Météo ${esc(p.nom)} en direct et prévision →</a> · <a href="/vigilance">vigilance</a></p></div>`;
}

export function secteurPage(origin: string, s: Secteur, data: Cached<RandonneesAnswer> | null, meteo: Cached<PlaceData> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const path = `/randonnees/${s.slug}`;
  const url = `${origin}${path}`;
  const trails = d?.secteurs.find((z) => z.secteur === s.nom)?.sentiers ?? [];
  const routes = d ? routesIn(d, s) : [];
  const closed = trails.filter((t) => t.etat === "fermé");
  const cut = routes.filter((h) => h.fermes.length);
  const keys = new Set([...trails.map((t) => t.k), ...routes.map((h) => h.k)]);

  const status = !d
    ? loading("La carte des randonnées")
    : `<div class="now"><span class="big">${trails.length}</span><p>sentiers de l'ONF et <b>${plural(routes.length, "itinéraire")}</b> avec trace GPS ${esc(s.dans)}. ` +
      `Aujourd'hui, <b>${plural(closed.length, "sentier fermé", "sentiers fermés")}</b>${cut.length ? `, sur ${plural(cut.length, "itinéraire")}` : ""}.</p></div>`;

  const map = d && keys.size
    ? `<figure class="card mapcard">${hikesMap(d.lignes.filter((l) => keys.has(l.k)), `Carte de La Réunion (974) : les sentiers et les itinéraires de randonnée ${s.dans}, ouverts ou fermés`)}
  <figcaption class="note legend"><span><i class="sw rte"></i>itinéraire avec trace</span><span><i class="sw ouvert"></i>sentier ouvert</span><span><i class="sw ferme"></i>fermé</span><span><i class="sw inconnu"></i>hors gestion ONF</span></figcaption></figure>`
    : "";

  const shut = !d
    ? ""
    : closed.length || cut.length
      ? `<section aria-labelledby="h-fermes"><div class="card warn alarm">${icon("alert")}<h2 id="h-fermes">${closed.length ? plural(closed.length, "sentier fermé", "sentiers fermés") : "Itinéraires coupés"} ${esc(s.dans)}</h2>
  ${closed.length ? `<ul class="plain">${closed.map((t) => closedLi({ sentier: t.nom, slug: t.slug, cause: t.cause, precision: t.precision })).join("")}</ul>` : ""}
  ${cut.length ? `<p>Itinéraires coupés : ${cut.map((h) => `<a href="/randonnees/${esc(h.slug)}">${esc(h.nom)}</a>`).join(", ")}.</p>` : ""}
  <p class="note">Un sentier fermé est interdit, même avec la trace : prendre une variante ouverte ou choisir une autre randonnée.</p></div></section>`
      : `<p class="card okay">Aucun sentier de l'ONF fermé ${esc(s.dans)} en ce moment.</p>`;

  const routeList = routes.length
    ? `<section aria-labelledby="h-itineraires"><div class="sec-h"><p class="eyebrow">GPX à télécharger</p><h2 id="h-itineraires">Les itinéraires avec trace GPS</h2>
  <p>Les randonnées complètes relevées par les contributeurs d'OpenStreetMap qui passent ${esc(s.dans)}, avec leur distance, leur dénivelé et l'état de leurs sentiers.</p></div>
  <ul class="zones hikes">${routes.map(hikeCard).join("")}</ul></section>`
    : "";

  const trailList = trails.length
    ? `<section aria-labelledby="h-sentiers"><div class="sec-h"><p class="eyebrow">Carte de l'ONF</p><h2 id="h-sentiers">Les ${trails.length} sentiers de l'ONF</h2>
  <p>Chacun a sa page, avec sa carte, son profil et sa trace GPS. Un sentier est rangé dans le secteur où passe la plus grande partie de son tracé.</p></div>
  <div class="card"><ul class="rows eau">${trails.map(trailLi).join("")}</ul></div></section>`
    : "";

  const access = `<section aria-labelledby="h-acces"><div class="sec-h"><h2 id="h-acces">Y aller</h2></div>
  <div class="two"><div class="card">${icon("pin")}<h3>Accès</h3><p>${esc(s.acces)}</p></div>
  ${weather(s, meteo)}</div>
  ${s.rappel ? `<div class="card warn">${icon("alert")}<h3>À savoir</h3><p>${esc(s.rappel)}</p></div>` : ""}
</section>`;

  const others = `<section aria-labelledby="h-autres"><div class="sec-h"><h2 id="h-autres">Les autres secteurs</h2></div>${sectorLinks(s.slug)}
  <p class="note"><a href="/randonnees">Toutes les randonnées sur la carte de l'île</a>, avec le filtre par distance et dénivelé · <a href="/sentiers">tous les sentiers fermés</a>.</p>
  ${d && data ? sourcesNote(d.sources, data) : ""}</section>`;

  const long = `Randonnée ${s.nom} : traces GPS et sentiers ouverts · 974`;
  const title = long.length <= TITLE_MAX ? long : `Randonnée ${s.nom} : traces GPS · 974`;
  const short = `Randonnée ${s.dans} (La Réunion, 974) : sentiers de l'ONF et itinéraires avec trace GPS (GPX), leur état du jour et la météo.`;
  const description = d
    ? describe(`${s.nom} (La Réunion, 974) : ${trails.length} sentiers de l'ONF et ${plural(routes.length, "itinéraire")} avec trace GPS (GPX), leur état du jour (${closed.length} fermé${closed.length > 1 ? "s" : ""} en ce moment) et la météo.`, short)
    : short;
  const { bar, jsonld } = sectorTrail(origin, s);
  const list = routes.length
    ? [{ "@context": "https://schema.org", "@type": "ItemList", name: `Itinéraires de randonnée ${s.dans}`, itemListElement: routes.map((h, i) => ({ "@type": "ListItem", position: i + 1, name: h.nom, url: `${origin}/randonnees/${h.slug}` })) }]
    : [];

  const band = `${bar}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Traces GPS · état ONF du jour</p>
    <h1>Randonnée ${esc(s.dans)}</h1>
    <p class="lead">${esc(s.quoi.replace(/^\p{L}/u, (c) => c.toUpperCase()))}.</p>
    ${status}
    ${ask(`Mi rod inn rando ${s.slug === "littoral" ? "lo long la mèr" : `koté ${s.nom}`}, lé ouvèr ? Gèt si ${url} é di amwin.`,
      `Quelles randonnées faire ${s.dans} en ce moment, et sont-elles ouvertes ? Lis ${url} et propose-m'en une avec sa trace GPS.`)}
  </div>
  ${map}
</div>`;

  const body = `${shut}
${routeList}
${trailList}
${access}
${others}
${connectorCta("sentiers_randonnee", "la randonnée")}
<script>${MAP_SCRIPT}</script>`;
  return layout(origin, { title, description, path, jsonld: [jsonld, webPage(origin, path, title, description, data), ...list], alerte }, band, body);
}
