/**
 * /feux: the vegetation fires seen by satellite in the last 24 hours (providers/feux.ts) on the island's map and in a
 * list, with the closed trails (the last copy of /sentiers) and the vigilance: what someone looks for when a fire breaks
 * out above Saint-Paul. Worded by marketing. Without FIRMS's key the page says the detection is not active yet, is kept
 * out of the search engines and the sitemap, and nothing links to it.
 */
import type { Cached } from "../cache.js";
import * as feux from "../providers/feux.js";
import * as mf from "../providers/vigilance.js";
import { listLine, QUIET, URGENCE, when } from "../tools/feux.js";
import { credits as creditOf } from "../tools/format.js";
import { cyclone, islandGreen, NONE_ISSUED_SAID, raised } from "../tools/vigilance.js";
import type { Alerte, SentiersAnswer } from "./data.js";
import { closedMarkers, closedTrails, connectorCta, crumbBar, crumbs, fireId, fireMarkers, sourcesNote, webPage } from "./domains.js";
import { esc, islandMap } from "./map.js";
import { ask, credits, DESCRIPTION_MAX, hm, layout, officielHtml } from "./pages.js";

export const FEUX_PATH = "/feux";

/** What the page is made of: `fires` null when FIRMS has no key or does not answer. */
export interface FeuxLive {
  fires: (feux.Feux & { fetchedAt: Date }) | null;
  sentiers?: Cached<SentiersAnswer> | null;
  vigilance?: Cached<mf.Vigilance> | null;
}

const TITLE = "Feux de forêt Réunion : détections satellite 24 h · 974";
const H1 = "Feux de végétation à La Réunion, vus par satellite";
const LEAD = "Les points chauds repérés par les satellites VIIRS de la NASA ces dernières 24 h, sur une carte et en liste, avec les sentiers fermés et la vigilance du jour. Détection satellite, faux positifs possibles : toit chaud, site industriel, brûlage autorisé.";
const QUIET_META = "Aucun feu détecté par satellite ces dernières 24 h à La Réunion (974). Les nuages peuvent en masquer. Sentiers fermés et vigilance du jour. Un feu ? 18 ou 112.";
// When the satellites could not be read: nothing said of the fires, never « 0 ».
const BLIND_META = "Feux de végétation à La Réunion (974) vus par satellite : la carte des dernières 24 h, les sentiers fermés et la vigilance du jour. Un feu ? 18 ou 112.";
const OFF = "La détection des feux par satellite n'est pas encore active sur rundata.re.";
const DOWN = "Le service de la NASA ne répond pas pour le moment : rechargez la page dans quelques minutes.";

/** The description: the count and the newest, without its place when that makes it too long. */
export function feuxDescription(fires: feux.Feux | null, now: Date): string {
  if (!fires) return BLIND_META;
  const n = fires.detections.length;
  if (!n) return QUIET_META;
  const last = fires.detections[0];
  const at = when(last.t, now);
  const make = (where: string) =>
    n === 1
      ? `1 feu vu par satellite en 24 h à La Réunion (974), ${at}${where}. Faux positifs possibles. Un feu ? 18 ou 112.`
      : `${n} feux vus par satellite en 24 h à La Réunion (974), le dernier ${at}${where}. Faux positifs possibles. Un feu ? 18 ou 112.`;
  const full = make(` près de ${last.lieu}`);
  return full.length <= DESCRIPTION_MAX ? full : make("");
}

function firesList(fires: feux.Feux | null, now: Date): string {
  if (!feux.enabled()) return `<p>${esc(OFF)}</p>`;
  if (!fires) return `<p>${esc(DOWN)}</p>`;
  if (!fires.detections.length) return `<p>${esc(QUIET)}</p>`;
  return `<ul class="rows eau">${fires.detections.map((d, i) => `<li class="tgt" id="${fireId(i)}"><span>${esc(listLine(d, now))}<small>${esc(d.commune)} · satellite ${esc(d.satellite)}</small></span><span class="q-mauvaise">feu</span></li>`).join("")}</ul>`;
}

function trails(s: Cached<SentiersAnswer> | null | undefined): string {
  const d = s?.value;
  if (!d) return `<p>L'état des sentiers se charge : <a href="/sentiers">voir les sentiers fermés</a>.</p>`;
  const closed = closedTrails(d);
  return `<p><b>${closed}</b> sentier${closed > 1 ? "s" : ""} fermé${closed > 1 ? "s" : ""} sur ${d.suivis} suivis par l'ONF${d.carte_mise_a_jour ? `, d'après sa carte mise à jour le ${esc(d.carte_mise_a_jour.replace(" (ONF)", ""))}` : ""}.</p>` +
    (d.fermes_par_commune.length ? `<ul class="chips">${d.fermes_par_commune.map((c) => `<li>${esc(c.commune)} (${c.sentiers_fermes.length})</li>`).join("")}</ul>` : "") +
    `<p class="note"><a href="/sentiers">Tous les sentiers fermés, commune par commune →</a></p>`;
}

function vigilance(v: Cached<mf.Vigilance> | null | undefined, now: Date): string {
  if (!v) return `<p><a href="/vigilance">La vigilance de Météo-France</a> se charge.</p>`;
  const r = raised(v.value);
  const c = cyclone(v.value, now);
  const up = r.length ? `<ul class="plain">${r.map((x) => `<li>${esc(`${x.couleur_max} ${x.phenomene.toLowerCase()} : ${x.zone.split(" :")[0]}`)}</li>`).join("")}</ul>` : islandGreen(v.value, now) ? `<p>Pas de vigilance particulière à La Réunion (tout est vert).</p>` : `<p>${NONE_ISSUED_SAID}.</p>`;
  return `${c.startsWith("Pas d'") ? "" : `<p><b>${esc(c)}</b></p>`}${up}<p>${officielHtml(mf.OFFICIEL_VIGILANCE)}</p><p class="note"><a href="/vigilance">La vigilance zone par zone →</a></p>`;
}

export function feuxPage(origin: string, l: FeuxLive, now = new Date(), alerte?: Alerte): string {
  const on = feux.enabled();
  const description = on ? feuxDescription(l.fires, now) : BLIND_META;
  const markers = [
    ...closedMarkers(l.sentiers?.value, "/sentiers"),
    ...fireMarkers(l.fires ?? undefined, now),
  ];

  const band = `${crumbBar("Feux")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>NASA FIRMS · 24 h</p>
    <h1>${esc(H1)}</h1>
    <p class="lead">${esc(LEAD)}</p>
    <p class="lead"><b>${esc(URGENCE)}</b></p>
    ${ask("Na difé dann bwa ? Maïdo i brul ? Gèt si https://rundata.re/feux é di amwin ousa lé, é si néna santyé fèrmé.",
      "Y a-t-il un feu de forêt à La Réunion en ce moment ? Lis https://rundata.re/feux et dis-moi où le satellite en a vu, à quelle heure, et quels sentiers sont fermés.")}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : les feux détectés par satellite et les sentiers fermés" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Chaque point orange est un feu détecté par satellite (faux positifs possibles), chaque croix un sentier fermé.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-feux">
  <h2 id="h-feux">Les feux des dernières 24 h</h2>
  <div class="card">${firesList(l.fires, now)}</div>
  ${l.fires ? `<p class="note">Satellites lus : ${esc(l.fires.satellites.join(", "))}, à ${hm(l.fires.fetchedAt)}.</p><p class="sources">Sources : ${credits(creditOf([feux.SOURCE]))}.</p>` : ""}
</section>
<section aria-labelledby="h-sentiers">
  <h2 id="h-sentiers">Les sentiers fermés par l'ONF</h2>
  <div class="card">${trails(l.sentiers)}</div>
  ${l.sentiers ? sourcesNote(l.sentiers.value.sources, l.sentiers) : ""}
</section>
<section aria-labelledby="h-vigilance">
  <h2 id="h-vigilance">La vigilance Météo-France</h2>
  <div class="card">${vigilance(l.vigilance, now)}</div>
</section>
${connectorCta("sentiers_randonnee", "les feux")}`;

  return layout(origin, { title: TITLE, description, path: FEUX_PATH, jsonld: [crumbs(origin, "Feux", FEUX_PATH), webPage(origin, FEUX_PATH, TITLE, description, l.sentiers ?? null)], alerte, noindex: !on }, band, body);
}
