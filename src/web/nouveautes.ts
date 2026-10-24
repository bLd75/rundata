/**
 * What rundata.re can do that it could not before (/nouveautes), day by day: the same list as the repository's
 * CHANGELOG.md and sources_donnees (src/nouveautes.ts). Nothing is fetched.
 */
import { NOUVEAUTES, parJour } from "../nouveautes.js";
import { connectorCta, crumbBar, webPage } from "./domains.js";
import { esc } from "./map.js";
import { GITHUB, layout, SITE } from "./pages.js";

export const TITLE = "Nouveautés de rundata.re, La Réunion en direct · 974";
export const DESCRIPTION = "Les dernières données et pages ajoutées à rundata.re, La Réunion (974) en direct : météo, mer, sentiers, bus, sorties. Mis à jour à chaque nouveauté.";

export function nouveautesPage(origin: string): string {
  const path = "/nouveautes";
  const days = parJour();
  const trail = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [[SITE, "/"], ["Nouveautés", path]].map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: `${origin}${u}` })),
  };
  const page = { ...webPage(origin, path, TITLE, DESCRIPTION, null), ...(NOUVEAUTES.length ? { dateModified: new Date(NOUVEAUTES[0].date).toISOString() } : {}) };

  const band = `${crumbBar("Nouveautés")}
<div class="wrap intro"><div class="pitch">
  <h1>Les nouveautés de rundata.re</h1>
  <p class="lead">Ce qui arrive sur le site et dans votre IA, jour après jour. Une idée, une donnée qui manque ? Dites-le-nous en bas de page.</p>
</div></div>`;
  const body = days.map((d) => `<section aria-labelledby="h-${d.jour}">
  <div class="sec-h"><h2 id="h-${d.jour}"><time datetime="${d.jour}">${esc(d.titre)}</time></h2></div>
  <div class="card"><ul class="plain">${d.textes.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
</section>`).join("\n") + `
<p class="note">La même liste est dans le dépôt du code : <a href="${GITHUB}/blob/main/CHANGELOG.md">CHANGELOG.md</a>.</p>
${connectorCta("sources_donnees", "toutes ces données")}`;
  return layout(origin, { title: TITLE, description: DESCRIPTION, path, jsonld: [trail, page] }, band, body);
}
