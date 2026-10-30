/**
 * The déchèteries of the West (/decheteries): for each one of the TCO, the skips that still take waste and those that
 * are full, as the staff last said, a block per commune with its anchor. Cut from the copy web:dechets, read
 * against the time: an update of more than 6 hours is said to be checked on the spot.
 */
import { porte, type Porte } from "./aller.js";
import type { Cached } from "../cache.js";
import { slugify } from "./places.js";
import * as dech from "../vie/decheteries.js";
import type { Alerte, DechetsAnswer } from "./data.js";
import { connectorCta, crumbBar, crumbs, loading, sourcesNote, webPage } from "./domains.js";
import { esc } from "./map.js";
import { DESCRIPTION_MAX, icon, layout } from "./pages.js";

// The texts of the page, worded by marketing.
export const TITLE = "Déchèteries Ouest Réunion : bennes pleines en direct · 974";
const H1 = "Déchèteries de l'Ouest : les bennes en direct";
const LEAD = "Pour chaque déchèterie du TCO, les bennes qui acceptent encore vos déchets et celles qui sont pleines, d'après les agents sur place (mise à jour toutes les 2 heures environ). Ouvertes 7 jours sur 7.";
const CHECK = "Mise à jour il y a plus de 6 h : à vérifier sur place.";
const COMMUNES = "Le Port, La Possession, Saint-Paul, Trois-Bassins, Saint-Leu";

export const anchorOf = (commune: string) => slugify(commune);

/** « Déchèteries de l'Ouest (974) à 17:00 : … », the time of the latest update while it is recent. */
export function descriptionOf(sites: dech.SiteNow[]): string {
  const fresh = sites.filter((s) => s.a_jour && s.mis_a_jour).map((s) => s.mis_a_jour!.split(" ")[1]).sort();
  const at = fresh.length ? ` à ${fresh[fresh.length - 1]}` : "";
  const text = `Déchèteries de l'Ouest (974)${at} : où déposer déchets verts, encombrants, gravats. ${COMMUNES}.`;
  return text.length <= DESCRIPTION_MAX ? text : `Déchèteries de l'Ouest (974) : où déposer déchets verts, encombrants, gravats. ${COMMUNES}.`;
}

function siteCard(s: dech.SiteNow, g: Porte): string {
  const state = s.a_jour
    ? `<p class="note">Mis à jour à ${esc(s.mis_a_jour!.split(" ")[1])} par les agents.</p>` +
      (s.refuse.length ? `<p><b>Benne pleine :</b> ${esc(s.refuse.join(", "))}.</p>` : `<p><b>Toutes les bennes acceptent.</b></p>`) +
      (s.accepte.length ? `<p><b>Accepté :</b> ${esc(s.accepte.join(", "))}.</p>` : "")
    : `<p class="note">${esc(CHECK)}${s.mis_a_jour ? ` Dernière mise à jour : ${esc(s.mis_a_jour)}.` : ""}</p>`;
  const go = g.aller({ nom: s.nom, lat: s.lat, lon: s.lon, adresse: s.adresse ? `${s.adresse}, ${s.commune}` : undefined });
  return `<div class="card">${icon("pin")}<h3><a href="${esc(s.lien)}" rel="noopener">${esc(s.nom)}</a></h3>${s.adresse ? `<p>${esc(s.adresse)}</p>` : ""}${go ? `<p>${go}</p>` : ""}${state}</div>`;
}

export function decheteriesPage(origin: string, data: Cached<DechetsAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const g = porte(alerte);
  const path = "/decheteries";
  const sites = dech.sitesNow(data?.value.etats, now);
  const description = descriptionOf(data ? sites : []);
  const band = `${crumbBar("Déchèteries de l'Ouest")}
<div class="wrap intro"><div class="pitch">
  <p class="pill"><span class="dot"></span>Météo des déchèteries du TCO</p>
  <h1>${esc(H1)}</h1>
  <p class="lead">${esc(LEAD)}</p>
  ${data ? "" : loading("L'état des bennes")}
</div></div>`;
  const blocks = dech.TCO_COMMUNES.map((c) => `<section id="${anchorOf(c)}" aria-labelledby="h-${anchorOf(c)}">
  <div class="sec-h"><h2 id="h-${anchorOf(c)}">${esc(c)}</h2></div>
  <div class="two">${sites.filter((s) => s.commune === c).map((s) => siteCard(s, g)).join("")}</div>
</section>`).join("\n");
  const others = `<section><p><a href="/collecte">Les jours de collecte de votre rue →</a></p><p class="note">Seul le TCO (Ouest) publie ces données. Pour les autres communes, voir ${dech.OTHERS.map((o) => `<a href="${o.site}" rel="noopener">${esc(o.nom)}</a>`).join(", ").replace(/, ([^,]*)$/, " ou $1")}.</p>
  ${data ? sourcesNote(data.value.sources, data) : ""}</section>`;
  const body = `${blocks}
${others}
${connectorCta("annuaire_services_publics", "les déchèteries")}${g.feuille}`;
  return layout(origin, { title: TITLE, description, path, jsonld: [crumbs(origin, "Déchèteries de l'Ouest", path), webPage(origin, path, TITLE, description, data)], alerte }, band, g.ligne + body);
}
