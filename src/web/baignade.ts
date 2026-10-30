/**
 * /baignade and the « Baignade et requins » block of /mer and of the coastal places' pages: the prefect's shark
 * rule and the zones of the GIP Centre Sécurité Requin, from the package (src/eau/requin.ts), with no request.
 */
import { ARRETE, CSR, CSR_URL, noneLine, ruleText, saysBsan, SOURCE, STORIES, T, ZONES, zoneLine, zonesNear, inForce } from "../eau/requin.js";
import type { Alerte } from "./data.js";
import { porte, type Porte } from "./aller.js";
import { esc } from "./map.js";
import { layout, SITE } from "./pages.js";

export const PATH = "/baignade";
export const LINK = `<a href="${PATH}">${esc(T.lien)} →</a>`;
/** The line of the pages that only point here (the coastal communes, /eau). */
export const LINE = `${esc(T.h2)} : <a href="${PATH}">${esc(T.lien.charAt(0).toLowerCase() + T.lien.slice(1))} →</a>`;

/** The words that must not be cut at the end of a line: « n° 180 », « 300 m », « art. 2 ». */
const keep = (s: string) => s.replace(/(n°|art\.) (\d)/g, "$1\u00a0$2").replace(/(\d) m(?!\p{L})/gu, "$1\u00a0m");
const say = (s: string) => esc(keep(s));

/** Where the GIP Centre Sécurité Requin announces the day's zones, with the links on « Instagram » and « Facebook ». */
const STORIES_HTML = esc(T.stories)
  .replace("Instagram", `<a href="${STORIES.instagram}">Instagram</a>`)
  .replace("Facebook", `<a href="${STORIES.facebook}">Facebook</a>`);

/** « Source : » and the GIP's name, linked to its map, as its agreement asks. */
const SOURCE_HTML = esc(T.source).replace(esc(CSR), `<a href="${CSR_URL}">${esc(CSR)}</a>`);

const bsan = (zones: typeof ZONES, now: Date) => (saysBsan(zones, now) ? `<p>${esc(T.bsan)}</p>` : "");

/** A zone's line, with « Y aller » (aller.ts; the page adds the sheet). */
const zoneLi = (z: (typeof ZONES)[number], now: Date, g: Porte) => {
  const go = g.aller({ nom: z.nom, lat: z.lat, lon: z.lon }, "baignade");
  return `<li>${say(zoneLine(z, now))}${go ? ` ${go}` : ""}</li>`;
};

function zonesHtml(zones: typeof ZONES, now: Date, g: Porte): string {
  return `<p>${say(T.intro)}</p><ul>${zones.map((z) => zoneLi(z, now, g)).join("")}</ul>${bsan(zones, now)}<p>${say(T.ouverture)}</p><p>${STORIES_HTML}</p>`;
}

/** The block of a page: near a place (its zones, or none), or for the whole island (every zone). */
export function bathingBlock(now: Date, near?: { nom: string; lon: number; lat: number; commune?: string }, g: Porte = porte()): string {
  const zones = near ? zonesNear(near.lon, near.lat, near.commune) : ZONES;
  return `<section aria-labelledby="h-requin"><h2 id="h-requin">${esc(T.h2)}</h2><div class="card">` +
    `<p>${say(ruleText(now))}</p>` +
    (zones.length ? zonesHtml(zones, now, g) : `<p>${say(noneLine(near!.nom, now))}</p>`) +
    `<p>${say(T.drapeaux)}</p>` +
    `<p class="note">${SOURCE_HTML}. ${LINK}</p></div></section>`;
}

const fr = (iso: string) => iso.split("-").reverse().join("/");

export function bathingPage(origin: string, now = new Date(), alerte?: Alerte): string {
  const g = porte(alerte);
  // Along the coast, from the west to the south, as the zones lie.
  const communes = ["Saint-Paul", "Les Trois-Bassins", "Saint-Leu", "L'Étang-Salé", "Saint-Pierre", "Petite-Île", "Saint-Joseph", "Saint-Philippe"];
  const title = "Baignade et requins à La Réunion : où se baigner · 974";
  const description =
    "Requins : baignade et surf interdits à moins de 300 m du rivage, sauf lagons, bassins, filets et ZONEX surveillés. Zones, drapeaux et arrêté en vigueur.";
  const band = `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li aria-current="page">Baignade</li></ol></nav></div>
<div class="wrap intro"><div class="pitch">
  <h1>Où se baigner à La Réunion ?</h1>
  <p class="lead">La règle de la préfecture face au risque requin, les zones où la baignade est permise et ce que disent les drapeaux. Ces zones réduisent le risque, elles ne le suppriment pas.</p>
</div></div>`;
  const body = `<section aria-labelledby="h-regle"><h2 id="h-regle">La règle</h2><div class="card"><p>${say(ruleText(now))}</p></div></section>
<section aria-labelledby="h-zones"><h2 id="h-zones">Les zones</h2><div class="card">
  <p>${esc(T.intro)}</p>
  ${communes.map((c) => `<h3>${esc(c)}</h3><ul>${ZONES.filter((z) => z.commune === c).map((z) => zoneLi(z, now, g)).join("")}</ul>`).join("\n  ")}
  ${bsan(ZONES, now)}
  <p>${esc(T.autres)}</p>
  <p>${esc(T.ouverture)}</p>
  <p>${STORIES_HTML}</p>
</div></section>
<section aria-labelledby="h-drapeaux"><h2 id="h-drapeaux">Les drapeaux</h2><div class="card"><p>${say(T.drapeaux)}</p></div></section>
<section aria-labelledby="h-qualite"><h2 id="h-qualite">Qualité de l'eau de baignade</h2>
  <p><a href="/eau">Qualité de l'eau : les contrôles de l'ARS, plage par plage et bassin par bassin →</a></p>
</section>
<section aria-labelledby="h-src"><h2 id="h-src">Sources</h2>
  <p class="note">${inForce(now)
    ? `<a href="${esc(ARRETE.url)}">Arrêté préfectoral n°\u00a0${ARRETE.numero} du ${fr(ARRETE.signe)}</a> (${say(ARRETE.recueil)}), applicable du ${fr(ARRETE.du)} au ${fr(ARRETE.au)}.`
    : `<a href="https://www.reunion.gouv.fr">reunion.gouv.fr</a>.`} ${SOURCE_HTML}. ${esc(SOURCE.licence)}.</p>
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
  return layout(origin, { title, description, path: PATH, jsonld, alerte }, band, g.ligne + body + g.feuille);
}
