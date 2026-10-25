/**
 * /chiffres, « rundata.re en chiffres »: what rundata.re reads, counted (chiffres.ts), in marketing's words validated by
 * the user on 25/10/2026. Each figure leads to its page; a count not made yet is left out, never shown as 0, and one
 * kept from an earlier copy says its hour.
 */
import type { Chiffres } from "../chiffres.js";
import { PATH } from "../chiffres.js";
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { esc } from "./map.js";
import { layout } from "./pages.js";
import { PATH as SANS_REPONSE } from "./sans-reponse.js";

export { PATH };
const H1 = "rundata.re en chiffres";
const TITLE = "rundata.re en chiffres\u00a0: sources, producteurs, licences · rundata.re";
const CHAPEAU = "Ce que rundata.re lit pour vous, compté en direct\u00a0: les sources publiques, leurs producteurs et leurs licences, ce qui est couvert sur l'île et ce qui manque encore. Chaque chiffre mène à sa page.";

const n = (x: number) => x.toLocaleString("fr-FR").replace(/\s/g, "\u00a0");

/** A count made from the copy, with its hour when it is older than the copy's own (kept when its source did not answer). */
type Dated = { nombre: number; compte_le: string } | undefined;
const kept = (c: Chiffres, d: Dated) => (d && d.compte_le !== c.compte_le ? ` <small>(compté le ${esc(d.compte_le)})</small>` : "");

/** One figure of a list: its number, its words, its page. */
const item = (valeur: number, mots: string, page: string, after = "") =>
  `<li class="card"><a class="fig" href="${esc(page)}">${n(valeur)}</a><span>${mots}${after}</span></li>`;

/** « (Licence Ouverte, ODbL, CC BY, domaine public) », from the open families present. */
const parenthese = (familles: string[]) => familles.join(", ");

export function chiffresPage(origin: string, c: Chiffres, alerte?: Alerte): string {
  const band = `${crumbBar(H1)}
<div class="wrap intro solo"><div class="pitch">
  <h1>${H1}</h1>
  <p class="lead">${CHAPEAU}</p>
</div></div>`;

  const essentiel = `<h2 id="essentiel">L'essentiel</h2>
  <ul class="figs">${[
    item(c.sources, "sources publiques lues", "#par-domaine"),
    item(c.producteurs, "producteurs", "#par-domaine"),
    item(c.communes, "communes, une page du jour pour chacune", "/communes"),
    item(c.outils, "outils pour votre assistant IA", "/mcp"),
  ].join("")}</ul>`;

  const domaines = `<h2 id="par-domaine">Par domaine</h2>
  <div class="card table-wrap"><table class="drought niveaux"><thead><tr><th scope="col">Domaine</th><th scope="col">Sources</th><th scope="col">Producteurs</th><th scope="col">Lecture</th></tr></thead><tbody>${c.par_domaine.map((d) =>
    `<tr><th scope="row">${d.page ? `<a href="${esc(d.page)}">${esc(d.domaine)}</a>` : esc(d.domaine)}</th><td data-label="Sources">${n(d.sources)}</td><td data-label="Producteurs">${d.producteurs.length ? esc(d.producteurs.join(", ")) : "—"}</td>${d.cadence ? `<td data-label="Lecture">${esc(d.cadence)}</td>` : "<td></td>"}</tr>`).join("")}</tbody></table></div>`;

  const t = c.terrain;
  const terrain = [
    t.stations_meteo && item(t.stations_meteo.nombre, "stations météo lues", "/meteo", kept(c, t.stations_meteo)),
    item(t.maregraphes, "marégraphes", "/mer"),
    item(t.defibrillateurs, "défibrillateurs", "/defibrillateurs"),
    item(t.points_de_recharge, "points de recharge pour voiture électrique", "/bornes", `<small>dans ${n(t.stations_de_recharge)} stations</small>`),
    t.stations_de_velos && item(t.stations_de_velos.nombre, "stations de vélos", "/velos", kept(c, t.stations_de_velos)),
    "lignes_de_bus" in t && t.lignes_de_bus !== undefined && item(t.lignes_de_bus, "lignes de bus", "/bus", `<small>${n(t.reseaux_de_bus!)} réseaux</small>`),
    t.sentiers_onf && item(t.sentiers_onf.nombre, "sentiers suivis par l'ONF", "/sentiers", `<small>dont ${n(t.sentiers_onf.fermes)} fermés aujourd'hui selon l'ONF</small>${kept(c, t.sentiers_onf)}`),
    item(t.randonnees_gps, "itinéraires de randonnée avec leur trace GPS", "/randonnees"),
  ].filter(Boolean);

  const m = c.en_ce_moment;
  const moment = [
    m.evenements_deux_semaines && item(m.evenements_deux_semaines.nombre, "événements dans les deux semaines qui viennent", "/evenements", kept(c, m.evenements_deux_semaines)),
    m.avis_coupure_eau && item(m.avis_coupure_eau.nombre, "avis de coupure d'eau en cours ou à venir", "/coupures-eau", kept(c, m.avis_coupure_eau)),
    m.avis_coupure_electricite && item(m.avis_coupure_electricite.nombre, "avis de coupure d'électricité en cours ou à venir", "/electricite#coupures", kept(c, m.avis_coupure_electricite)),
  ].filter(Boolean);

  const licences = `<h2 id="licences">Les licences</h2>
  <p>${n(c.sous_licence_ouverte)} des ${n(c.sources)} sources sont publiées sous une licence ouverte (${esc(parenthese(c.licences_ouvertes))}). Pour les autres, des informations publiques, rundata.re ne reprend que les faits, avec le lien de la source.</p>
  <ul>${Object.entries(c.licences).map(([nom, nombre]) => `<li>${esc(nom.charAt(0).toUpperCase() + nom.slice(1))}\u00a0: ${n(nombre)}</li>`).join("")}</ul>`;

  const s = c.manque.sites_sans_reponse;
  const silence = !s ? "" : s.nombre
    ? `<p>${n(s.nombre)} ${s.nombre > 1 ? "sites publics ne répondent pas" : "site public ne répond pas"} en ce moment\u00a0: <a href="${SANS_REPONSE}">voir les sites sans réponse</a>.${kept(c, s)}</p>`
    : s.derniere_reverification ? `<p><a href="${SANS_REPONSE}">Aucun site public sans réponse</a> à la revérification du ${esc(s.derniere_reverification.slice(0, 5))}.</p>` : "";

  const body = `<section style="max-width:52rem;display:grid;gap:1rem">
  ${essentiel}
  ${domaines}
  ${terrain.length ? `<h2 id="terrain">Sur le terrain</h2>\n  <ul class="figs">${terrain.join("")}</ul>` : ""}
  ${moment.length ? `<h2 id="en-ce-moment">En ce moment</h2>\n  <ul class="figs">${moment.join("")}</ul>` : ""}
  ${licences}
  ${silence ? `<h2 id="manque">Ce qui manque</h2>\n  ${silence}` : ""}
  <h2 id="depuis">Depuis le début</h2>
  <p>Né en octobre 2026\u00a0: <a href="/nouveautes">${n(c.nouveautes)} nouveautés publiées</a>.</p>
  <p>Compté le ${esc(c.compte_le)}, à partir des sources que lit rundata.re. Une source manque\u00a0? Dites-le avec le formulaire en bas de page.</p>
</section>`;
  return layout(origin, { title: TITLE, description: CHAPEAU, path: PATH, jsonld: [crumbs(origin, H1, PATH), webPage(origin, PATH, TITLE, CHAPEAU, null)], alerte }, band, body);
}
