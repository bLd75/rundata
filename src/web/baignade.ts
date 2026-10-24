/**
 * /baignade and the « Baignade et requins » block of /mer and of the coastal places' pages: the prefect's shark
 * rule and the zones of the Centre Sécurité Requin, from the package (src/eau/requin.ts), with no request.
 */
import { ARRETE, CSR_URL, noneLine, ruleText, SOURCE, T, ZONES, zoneLine, zonesNear, inForce } from "../eau/requin.js";
import { esc } from "./map.js";
import { layout, SITE } from "./pages.js";

export const PATH = "/baignade";
export const LINK = `<a href="${PATH}">${esc(T.lien)} →</a>`;

function zonesHtml(zones: typeof ZONES, now: Date): string {
  return `<p>${esc(T.intro)}</p><ul>${zones.map((z) => `<li>${esc(zoneLine(z, now))}</li>`).join("")}</ul><p>${esc(T.ouverture)}</p>`;
}

/** The block of a page: near a place (its zones, or none), or for the whole island (every zone). */
export function bathingBlock(now: Date, near?: { nom: string; lon: number; lat: number; commune?: string }): string {
  const zones = near ? zonesNear(near.lon, near.lat, near.commune) : ZONES;
  return `<section aria-labelledby="h-requin"><h2 id="h-requin">${esc(T.h2)}</h2><div class="card">` +
    `<p>${esc(ruleText(now))}</p>` +
    (zones.length ? zonesHtml(zones, now) : `<p>${esc(noneLine(near!.nom, now))}</p>`) +
    `<p>${esc(T.drapeaux)}</p>` +
    `<p class="note">${esc(T.source)} ${LINK}</p></div></section>`;
}

const fr = (iso: string) => iso.split("-").reverse().join("/");

export function bathingPage(origin: string, now = new Date()): string {
  // Along the coast, from the west to the south, as the zones lie.
  const communes = ["Saint-Paul", "Saint-Leu", "L'Étang-Salé", "Saint-Pierre", "Petite-Île", "Saint-Joseph", "Saint-Philippe"];
  const title = "Baignade et requins à La Réunion : où se baigner · 974";
  const description =
    "Requins : baignade et surf interdits à moins de 300 m du rivage, sauf lagons, bassins, filets et ZONEX surveillés. Zones, drapeaux et arrêté en vigueur.";
  const band = `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li aria-current="page">Baignade</li></ol></nav></div>
<div class="wrap intro"><div class="pitch">
  <h1>Où se baigner à La Réunion ?</h1>
  <p class="lead">La règle de la préfecture face au risque requin, les zones où la baignade est permise et ce que disent les drapeaux. Ces zones réduisent le risque, elles ne le suppriment pas.</p>
</div></div>`;
  const body = `<section aria-labelledby="h-regle"><h2 id="h-regle">La règle</h2><div class="card"><p>${esc(ruleText(now))}</p></div></section>
<section aria-labelledby="h-zones"><h2 id="h-zones">Les zones</h2><div class="card">
  <p>${esc(T.intro)}</p>
  ${communes.map((c) => `<h3>${esc(c)}</h3><ul>${ZONES.filter((z) => z.commune === c).map((z) => `<li>${esc(zoneLine(z, now))}</li>`).join("")}</ul>`).join("\n  ")}
  <p>${esc(T.ouverture)}</p>
</div></section>
<section aria-labelledby="h-drapeaux"><h2 id="h-drapeaux">Les drapeaux</h2><div class="card"><p>${esc(T.drapeaux)}</p></div></section>
<section aria-labelledby="h-qualite"><h2 id="h-qualite">Qualité de l'eau de baignade</h2>
  <p>La qualité de l'eau des plages et bassins contrôlés par l'ARS, prélèvement par prélèvement : <a href="/eau">la page de l'eau →</a></p>
</section>
<section aria-labelledby="h-src"><h2 id="h-src">Sources</h2>
  <p class="note">${inForce(now)
    ? `<a href="${esc(ARRETE.url)}">Arrêté préfectoral n° ${ARRETE.numero} du ${fr(ARRETE.signe)}</a> (${esc(ARRETE.recueil)}), applicable du ${fr(ARRETE.du)} au ${fr(ARRETE.au)}.`
    : `<a href="https://www.reunion.gouv.fr">reunion.gouv.fr</a>.`} ${esc(T.source)} <a href="${CSR_URL}">securite-requin.re</a>. ${esc(SOURCE.licence)}.</p>
</section>`;
  const jsonld = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE, item: `${origin}/` },
        { "@type": "ListItem", position: 2, name: "Baignade", item: `${origin}${PATH}` },
      ],
    },
  ];
  return layout(origin, { title, description, path: PATH, jsonld }, band, body);
}
