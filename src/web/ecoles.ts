/**
 * /ecoles-cyclone: what the cyclone alert in force means for the crèches and the schools, under the rule of the
 * prefecture's plan (tools/ecoles.ts). Online all year, Météo-France's vigilance read as /vigilance reads it.
 */
import type { Cached } from "../cache.js";
import * as mf from "../providers/vigilance.js";
import { ecoles, LIMITE, ORSEC, RECTORAT, REGLE } from "../tools/ecoles.js";
import type { Alerte } from "./data.js";
import { connectorCta, crumbBar, crumbs, webPage } from "./domains.js";
import { esc } from "./map.js";
import { layout } from "./pages.js";

// The texts of the page, worded by marketing.
export const TITLE = "École fermée ? Cyclone et alerte orange Réunion · 974";
const H1 = "Cyclone : les écoles sont-elles fermées ?";
const LEAD = "Ce que prévoit le plan ORSEC Cyclones de la préfecture pour les crèches, les écoles, les collèges, les lycées et les universités, et l'alerte en vigueur à La Réunion en ce moment.";
const META = "Alerte orange cyclonique : crèches, écoles, collèges et lycées fermés dans toute l'île. La règle du plan ORSEC de la préfecture et l'alerte en cours à La Réunion (974).";
const metaClosed = (step: string) => `🌀 ${step} à La Réunion (974) : crèches, écoles, collèges et lycées fermés, selon le plan ORSEC Cyclones de la préfecture.`;
const UNREAD = "L'alerte en vigueur n'a pas pu être lue à l'instant : voir la préfecture (reunion.gouv.fr) et Météo-France.";

/** The state's sentence with its link to the plan: « …, selon le <a>dispositif ORSEC Cyclones (arrêté 2026-182)</a>. » */
function stateHtml(texte: string, linked: boolean): string {
  if (!linked) return esc(texte);
  const at = texte.lastIndexOf(ORSEC.nom);
  return `${esc(texte.slice(0, at))}<a href="${ORSEC.lien}" rel="noopener">${esc(ORSEC.nom)}</a>${esc(texte.slice(at + ORSEC.nom.length))}`;
}

export function ecolesPage(origin: string, data: Cached<mf.Vigilance> | null, now = new Date(), alerte?: Alerte): string {
  const path = "/ecoles-cyclone";
  const e = data ? ecoles(data.value, now) : undefined;
  const step = e?.fermees ? (e.niveau === 6 ? "Phase de sauvegarde" : `Alerte ${mf.cycloneName(e.niveau)}`) : undefined;
  const description = step ? metaClosed(step) : META;
  const state = e
    ? `<div class="status"><p class="lead"><b>${stateHtml(e.texte, Boolean(e.selon))}</b></p>${e.depuis ? `<p class="lead">${esc(e.depuis)}</p>` : ""}</div>`
    : `<div class="status"><p class="lead">${esc(UNREAD)}</p></div>`;
  const band = `${crumbBar("Écoles et cyclone")}
<div class="wrap intro"><div class="pitch">
  <p class="pill"><span class="dot"></span>Alerte cyclonique en direct</p>
  <h1>${esc(H1)}</h1>
  <p class="lead">${esc(LEAD)}</p>
  ${state}
</div></div>`;
  const body = `<section aria-labelledby="h-regle">
  <div class="sec-h"><h2 id="h-regle">Ce que prévoit le plan ORSEC Cyclones</h2></div>
  <div class="card"><ul class="plain">${REGLE.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
  <p class="note">D'après le <a href="${ORSEC.lien}" rel="noopener">dispositif ORSEC Cyclones de la préfecture</a> (arrêté 2026-182, page mise à jour le ${esc(ORSEC.mis_a_jour)}). Les annonces du jour viennent de la préfecture et du rectorat (<a href="${RECTORAT}" rel="noopener">ac-reunion.fr</a>).</p>
  <p class="note">${esc(LIMITE)}</p></div>
</section>
<section><p><a href="/cyclones">Les cyclones du bassin →</a> · <a href="/vigilance">La vigilance zone par zone →</a></p></section>
${connectorCta("cyclones", "l'alerte cyclonique")}`;
  return layout(origin, { title: TITLE, description, path, jsonld: [crumbs(origin, "Écoles et cyclone", path), webPage(origin, path, TITLE, description, data)], alerte }, band, body);
}
