/**
 * /a-propos, « Qui fait rundata.re ? », and /llms.txt: who makes the site, why, on what money, what it promises, how to
 * reach it (the communication audit of 25/10/2026, C2). Never a person's name: the editor is anonymous, as the law
 * allows (/conditions#mentions-legales).
 */
import { enLigne } from "./associations-drapeau.js";
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { layout } from "./pages.js";

export const PATH = "/a-propos";
const TITLE = "Qui fait rundata.re ? Un projet bénévole à La Réunion";
const DESCRIPTION = "rundata.re, un projet personnel et bénévole fait à La Réunion : pourquoi, comment il est financé, ce qu'il promet, comment le joindre.";

/** Who makes rundata.re, in one sentence: on the page, in /llms.txt and in the home page's Organization. */
export const QUI = "Un projet personnel et bénévole, fait à La Réunion par un habitant de l'île, développeur. Pas une entreprise, pas un organisme public, aucun lien avec les producteurs de données.";

export function aProposPage(origin: string, alerte?: Alerte): string {
  const band = `${crumbBar("Qui fait rundata.re ?")}
<div class="wrap intro solo"><div class="pitch">
  <h1>Qui fait rundata.re ?</h1>
  <p class="lead">${QUI}</p>
</div></div>`;
  const body = `<section style="max-width:44rem;display:grid;gap:1rem">
  <h2 id="pourquoi">Pourquoi</h2>
  <p>Les données publiques de l'île existent, mais elles sont éparpillées : la météo chez Météo-France, le volcan à l'observatoire, les bus chez chaque réseau, les coupures d'eau chez chaque distributeur. Et quand on demande à une IA « il pleut à Cilaos ? », elle répond souvent de mémoire, sans mesure ni source. rundata.re les rassemble au même endroit, avec leur heure et leur source, pour les habitants et pour leurs assistants IA.</p>
  <h2 id="financement">Comment c'est financé</h2>
  <p>Le site est hébergé chez Cloudflare. Il est gratuit, n'affiche aucune publicité et ne vend aucune donnée. Pour les associations à but non lucratif, il est gratuit à vie.</p>
  <h2 id="engagements">Ce que rundata.re promet</h2>
  <ul>
    <li><b>La mesure et la prévision ne sont jamais mélangées.</b> Chaque chiffre dit s'il a été mesuré ou s'il est prévu.</li>
    <li><b>Chaque source est citée</b>, avec sa licence et l'heure de la donnée.</li>
    <li><b>En cas d'alerte, les autorités d'abord</b> : la vigilance de Météo-France et les consignes de la préfecture.</li>
    <li><b>Une erreur signalée est vérifiée et corrigée au plus vite.</b></li>
  </ul>
  <h2 id="contact">Joindre rundata.re</h2>
  <p>Écrivez à <a href="mailto:contact@rundata.re"><b>contact@rundata.re</b></a>, ou laissez un avis avec le formulaire en bas de chaque page. Le site est né en octobre 2026. Son code est libre (licence MIT). Les sources de chaque donnée sont citées en bas de chaque page. Voir aussi\u00a0: <a href="/presse">l'espace presse</a>,${enLigne() ? ` <a href="/associations">l'espace clubs et associations</a>,` : ""} <a href="/nouveautes">les nouveautés</a>, <a href="/sites-sans-reponse">les sites publics sans réponse</a>, <a href="/conditions#mentions-legales">les mentions légales</a> et <a href="/confidentialite">la confidentialité</a>.</p>
</section>`;
  return layout(origin, { title: TITLE, description: DESCRIPTION, path: PATH, jsonld: [crumbs(origin, "Qui fait rundata.re ?", PATH), { ...webPage(origin, PATH, TITLE, DESCRIPTION, null), "@type": "AboutPage" }], alerte }, band, body);
}

/** /llms.txt (llmstxt.org): what the site is, who makes it, its key pages, the connector and how to cite it. */
export function llmsTxt(origin: string): string {
  return `# rundata.re

> Les données publiques de La Réunion (974) en direct, pour les habitants et leurs assistants IA : météo mesurée et prévue, vigilance, cyclones, volcan, routes, bus, mer, air, électricité, eau, sentiers, événements, services publics.

Qui le fait : ${QUI.charAt(0).toLowerCase()}${QUI.slice(1)} Gratuit, sans publicité, sans compte.

Citer : nommer rundata.re (${origin}) avec le producteur de la donnée et sa licence, et dire de quand date la donnée (heure de La Réunion). Une prévision se dit prévision. En cas d'alerte, seules comptent la vigilance de Météo-France et les consignes de la préfecture.

## Pages clés
- [Accueil](${origin}/) : l'île en ce moment
- [Connecteur MCP](${origin}/mcp) : l'adresse à ajouter à ChatGPT, Claude ou Le Chat
- [Communes](${origin}/communes) : une page par commune
- [Vigilance](${origin}/vigilance) : vigilance et alerte cyclonique de Météo-France
- [Qui fait rundata.re ?](${origin}/a-propos) : le projet, ses engagements, le contact
- [Conditions et mentions légales](${origin}/conditions)
`;
}
