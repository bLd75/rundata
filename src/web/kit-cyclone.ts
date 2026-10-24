/**
 * /kit-cyclone: what to have at home and what to do before a cyclone, as the prefecture's plan says it (dispositif
 * spécifique ORSEC Cyclones, arrêté 2026-182, p. 16-17), quoted page by page. The plan gives no fuller list of the kit
 * and no telephone numbers: nothing is added. Built from the plan alone, no source is read. Worded by marketing.
 */
import type { Alerte } from "./data.js";
import { lineHtml, PDF, q, type Line } from "./alerte-cyclone.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { esc } from "./map.js";
import { layout } from "./pages.js";
import { ORSEC } from "../tools/ecoles.js";

export const TITLE = "Kit cyclone Réunion : la liste du plan ORSEC · 974";
const H1 = "Que faut-il avoir chez soi pour un cyclone ?";
const META = "Kit d'urgence, réserves, plein du véhicule, centre d'hébergement : ce que le plan ORSEC Cyclones de la préfecture demande de préparer à La Réunion (974).";
const LEAD = "Ce que le dispositif ORSEC Cyclones de la préfecture (arrêté 2026-182) demande de préparer avant un cyclone, cité page par page.";

// Who acts for the patients at high vital risk, in the plan's words (marketing).
export const VITAL = "Dialyse, respirateur, oxygène à domicile : en pré-alerte, le plan demande aux prestataires de soins à domicile et aux centres de dialyse de prendre « contact individuellement avec les patients dont ils ont la charge » (p. 24)";

/** The plan's words, by moment: the start of the season, the pré-alerte, the orange alert. */
export const SECTIONS: { id: string; titre: string; devise?: string; lignes: Line[] }[] = [
  {
    id: "saison",
    titre: "En début de saison cyclonique",
    devise: "Je me prépare",
    lignes: [
      q("", "Chaque habitant est invité à se préparer.", 16),
      q("", "Cette préparation concerne l'ensemble des actions qui ne pourront pas être faites dans les 72h (pré-alerte cyclonique) qui précéderont le passage du cyclone ou qui seront compliqués à réaliser (contraintes d'emploi du temps, rupture de stocks dans les commerces, etc.).", 16),
      q("", "Il convient notamment de préparer son kit d'urgence.", 16),
    ],
  },
  {
    id: "kit",
    titre: "Le kit d'urgence et les réserves",
    lignes: [
      q("Réserves", "Vérifiez vos réserves (conserves, eau, piles pour radio et lampes, médicaments,…) au sein de votre kit d'urgence", 17),
      q("Véhicule", "Faire le plein de son véhicule", 17),
      q("Centre d'hébergement", "Assurez-vous de connaître l'adresse et le téléphone du centre d'hébergement le plus proche de votre domicile", 17),
    ],
  },
  {
    id: "pre-alerte",
    titre: "En pré-alerte",
    devise: "Je m'informe et j'anticipe",
    lignes: [
      q("", "Suivez les prévisions météorologiques et les bulletins d'information.", 17),
      q("", "N'entreprenez pas de longues randonnées en montagne, ni de sorties en mer de plus de 24h", 17),
    ],
  },
  {
    id: "orange",
    titre: "En alerte orange",
    devise: "Je m'organise pour être bien protégé",
    lignes: [
      q("", "Rentrez les objets que le vent peut emporter", 17),
      q("", "Rentrez vos animaux", 17),
      q("", "Protégez vos portes et fenêtres (volets, planches…)", 17),
      q("", "Ne vous approchez pas du rivage en cas de forte houle", 17),
      q("", "Préparez une évacuation éventuelle", 17),
    ],
  },
];

export function kitPage(origin: string, alerte?: Alerte): string {
  const path = "/kit-cyclone";
  const band = `${crumbBar("Kit cyclone")}
<div class="wrap intro"><div class="pitch">
  <p class="pill"><span class="dot"></span>Plan ORSEC Cyclones</p>
  <h1>${esc(H1)}</h1>
  <p class="lead">${esc(LEAD)}</p>
</div></div>`;
  const sections = SECTIONS.map((s) => `<section id="${s.id}" aria-labelledby="h-${s.id}">
  <div class="sec-h"><h2 id="h-${s.id}">${esc(s.titre)}</h2>${s.devise ? `<p>« ${esc(s.devise)} »</p>` : ""}</div>
  <div class="card"><ul class="plain">${s.lignes.map(lineHtml).join("")}</ul></div>
</section>`).join("\n");
  const vital = `<section aria-labelledby="h-vital"><div class="card"><h2 id="h-vital">Personnes à haut risque vital</h2>
  <p>${esc(VITAL)} <a href="${PDF}#page=24" rel="noopener">→ PDF</a></p></div></section>`;
  const foot = `<section><p class="note">Extraits du <a href="${ORSEC.lien}" rel="noopener">dispositif ORSEC Cyclones</a> (arrêté préfectoral 2026-182, document mis à jour le ${esc(ORSEC.mis_a_jour)}). Le plan ne donne pas de liste plus complète du kit : rundata.re n'ajoute rien.</p>
<p><a href="/alerte-cyclone">Alerte cyclonique : ce qui ferme, ce qui continue →</a> · <a href="/ecoles-cyclone">Cyclone : les écoles sont-elles fermées ? →</a> · <a href="/vigilance">La vigilance zone par zone →</a></p></section>`;
  return layout(origin, { title: TITLE, description: META, path, jsonld: [crumbs(origin, "Kit cyclone", path), webPage(origin, path, TITLE, META, null)], alerte }, band, `${sections}\n${vital}\n${foot}`);
}
