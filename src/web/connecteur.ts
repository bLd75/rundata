/**
 * /mcp opened in a browser: what the connector is and how to add it to ChatGPT, Claude or Le Chat, with the address to
 * copy. The MCP clients get the endpoint at the same address (app.ts): only a request for HTML that opens no stream
 * gets this page.
 */
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { askHome, connectSteps } from "./home.js";
import { connector, layout } from "./pages.js";

export const PATH = "/mcp";
const TITLE = "Ajouter rundata.re à votre assistant IA · connecteur MCP gratuit";
// The connector's one name on every link to it (marketing's review of 29/10, R4).
const CRUMB = "Brancher mon IA";
const DESCRIPTION = "Comment ajouter le connecteur rundata.re à ChatGPT, Claude ou Le Chat : votre IA lit les données de La Réunion en direct. Gratuit, sans compte.";

// The plans and the menus, read in each assistant's help on that day (marketing's D9): to read again each month.
const VERIFIE = "2026-10-25";
const VERIFIE_TEXTE = "25 octobre 2026";

/** A browser, or a link preview: asks for HTML, and does not open the stream an MCP client opens with GET. */
export function wantsPage(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return (request.method === "GET" || request.method === "HEAD") && accept.includes("text/html") && !accept.includes("text/event-stream");
}

export function connecteurPage(origin: string, alerte?: Alerte): string {
  const band = `${crumbBar(CRUMB)}
<div class="wrap intro solo"><div class="pitch">
  <h1>Brancher rundata.re à votre IA</h1>
  <p class="lead">Ajoutez cette adresse à ChatGPT, Claude ou Le Chat : votre IA lira les données de La Réunion en direct.</p>
  ${connector(origin, "mcp-adresse")}
  <p>Votre assistant va chercher lui-même les données publiques de La Réunion, au moment de la question, avec leur heure et leur source. Sorties, randos, météo mesurée et prévue, routes, bus, vigilance, volcan, mer, air, électricité, services publics.</p>
</div></div>`;
  const body = `<section aria-labelledby="h-offres">
  <div class="sec-h"><p class="eyebrow">Avant de commencer</p><h2 id="h-offres">Quelle offre, quel réglage</h2>
  <p>D'après l'aide de chaque assistant, vérifiée le <time datetime="${VERIFIE}">${VERIFIE_TEXTE}</time>. Ces conditions changent souvent : si un menu a bougé, dites-le-nous avec le formulaire en bas de page.</p></div>
  <div class="three">
    <div class="card"><h3>Claude</h3><p><b>Offre :</b> toutes, y compris la gratuite (limitée à un connecteur personnalisé).</p><p><b>Où :</b> sur claude.ai, <b>Personnaliser → Connecteurs → + → Ajouter un connecteur personnalisé</b>.</p></div>
    <div class="card"><h3>ChatGPT</h3><p><b>Offre :</b> Business, Enterprise et Edu d'après l'aide d'OpenAI ; testé aussi avec ChatGPT Go. Sur les autres offres, le menu peut manquer.</p><p><b>Où :</b> sur chatgpt.com, depuis un ordinateur, <b>Plugins → Ajouter → Ajouter un serveur MCP personnalisé</b>.</p><p><b>Ensuite :</b> nommez rundata.re dans la question (« Avec rundata.re : … ») ou tapez <b>@</b> et choisissez-le.</p></div>
    <div class="card"><h3>Le Chat</h3><p><b>Offre :</b> toutes ; sur Free, Pro et Student, le titulaire du compte peut ajouter un connecteur. Sur Team et Enterprise, l'administrateur.</p><p><b>Où :</b> <b>Connecteurs → + Ajouter un connecteur → MCP personnalisé</b>. Nom sans point ni espace, par exemple <b>rundata</b>.</p></div>
  </div>
</section>
<section aria-labelledby="h-sans">
  <div class="sec-h"><h2 id="h-sans">Pas de connecteur sur votre offre ?</h2>
  <p>Envoyez simplement la question à votre assistant, avec l'adresse du site : s'il sait lire le web, il lira la page.</p></div>
  <div class="card easy">${askHome(origin)}</div>
</section>
<section aria-labelledby="h-brancher">
  <div class="sec-h"><p class="eyebrow">Pas à pas</p><h2 id="h-brancher">Brancher le connecteur, en 2 minutes</h2>
  <p>Il suit le protocole ouvert MCP (Model Context Protocol), compris par la plupart des assistants IA.</p></div>
  ${connectSteps(origin)}
</section>
<section style="max-width:44rem;display:grid;gap:1rem" aria-labelledby="h-savoir">
  <h2 id="h-savoir">Bon à savoir</h2>
  <p>Votre assistant n'envoie au connecteur que les paramètres de sa question, par exemple « Saint-Paul », jamais votre conversation. Aucun compte, aucun cookie : voir <a href="/confidentialite">la confidentialité</a> et <a href="/conditions">les conditions d'utilisation</a>. Sans connecteur, les mêmes données sont sur <a href="/">le site</a>, et <a href="/a-propos">qui fait rundata.re</a> est expliqué ici.</p>
  <p>Pour les développeurs : point d'accès MCP en HTTP (<i>Streamable HTTP</i>, sans état, réponses JSON), sans authentification, à l'adresse <code>${origin}/mcp</code>, en POST.</p>
</section>`;
  return layout(origin, { title: TITLE, description: DESCRIPTION, path: PATH, jsonld: [crumbs(origin, CRUMB, PATH), webPage(origin, PATH, TITLE, DESCRIPTION, null)], alerte }, band, body);
}
