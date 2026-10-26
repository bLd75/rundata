/**
 * /sites-sans-reponse: the public sites of La Réunion that do not answer at the moment, since when, what was seen and
 * what is missing here because of it (sans-reponse.ts). Worded by marketing (25/10): a silent site is never said
 * down, closed or empty, nor why it is silent, and one that answers but not to our reads is never said to refuse.
 */
import { constatEnMots, jour, jourHeure, publiques, statutEnMots, type Ligne, type Public } from "../sans-reponse.js";
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { esc } from "./map.js";
import { PATH as GUIDE } from "./ouvrir-donnees.js";
import { layout } from "./pages.js";

export const PATH = "/sites-sans-reponse";
const H1 = "Sites publics sans réponse";
const TITLE = "Sites publics de La Réunion sans réponse · rundata.re";
const CHAPEAU = "Certains sites publics de La Réunion ne répondent pas en ce moment. Ce qu'ils publient manque alors sur rundata.re. Cette page dit lesquels, depuis quand, et ce qui manque ici. Chaque site est revérifié chaque jour et quitte la liste dès qu'il répond.";
const BLOQUES = "Ces sites s'affichent dans un navigateur, mais ne répondent pas aux lectures de rundata.re. Cela peut venir d'un réglage de leur hébergeur.";
const OPEN_DATA = "Une donnée publique déposée en fichier ouvert sur data.gouv.fr reste lisible même quand le site de son éditeur ne répond pas.";

/** The site's own address, for anyone to check: its home, not the file or the API read. */
const accueil = (l: Ligne) => {
  try {
    return `${new URL(l.url).origin}/`;
  } catch {
    return `https://${l.hote}/`;
  }
};

function item(l: Public): string {
  const constat = l.statut === "injoignable" ? constatEnMots(l.constat) : undefined;
  const essai = l.statut === "revenu" ? undefined : l.dernier_essai ? `dernier essai le ${jourHeure(l.dernier_essai)}${constat ? ` : ${constat}` : ""}` : constat;
  const manque = l.statut === "revenu" || !l.manque ? undefined : `ce qui manque ici : ${l.page ? `<a href="${esc(l.page)}">${esc(l.manque)}</a>` : esc(l.manque)}`;
  return `<li><a href="${esc(accueil(l))}" rel="nofollow noopener">le site de ${esc(l.nom)}</a> : ${statutEnMots(l)}${essai ? `<br>${esc(essai)}` : ""}${manque ? `<br>${manque}` : ""}</li>`;
}

/** The rows of one part, grouped by theme, the oldest first (publiques() sorts them). */
function parTheme(rows: Public[]): string {
  const themes = [...new Set(rows.map((l) => l.theme))];
  return themes.map((t) => `<h3>${esc(t)}</h3><ul>${rows.filter((l) => l.theme === t).map(item).join("")}</ul>`).join("");
}

export function sansReponsePage(origin: string, rows: Ligne[], passage: number | undefined, alerte?: Alerte): string {
  const shown = publiques(rows);
  const muets = shown.filter((l) => l.statut === "injoignable");
  const bloques = shown.filter((l) => l.statut === "bloque");
  const revenus = shown.filter((l) => l.statut === "revenu");
  const band = `${crumbBar(H1)}
<div class="wrap intro solo"><div class="pitch">
  <h1>${H1}</h1>
  <p class="lead">${CHAPEAU}</p>
</div></div>`;
  const parts = [
    muets.length ? `<h2 id="sans-reponse">Sans réponse</h2>${parTheme(muets)}` : "",
    bloques.length ? `<h2 id="pas-a-nos-lectures">Répondent, mais pas à nos lectures</h2><p>${BLOQUES}</p>${parTheme(bloques)}` : "",
    revenus.length ? `<h2 id="repondent-de-nouveau">Répondent de nouveau</h2>${parTheme(revenus)}` : "",
  ].filter(Boolean);
  const body = `<section style="max-width:44rem;display:grid;gap:1rem">
  ${parts.length ? parts.join("\n  ") : `<p>${passage ? `Aucun site public sans réponse à la revérification du ${jour(passage)}.` : "Aucun site public sans réponse pour l'instant."}</p>`}
  <aside class="card"><p>${OPEN_DATA}</p></aside>
  <p>Revérifié chaque jour${passage ? `, dernier passage le ${jourHeure(passage)}` : ""}. Un site de cette liste répond pour vous ? Écrivez-nous : <a href="mailto:contact@rundata.re">contact@rundata.re</a>. Et pour rendre ses informations faciles à reprendre\u00a0: <a href="${GUIDE}">notre guide</a>.</p>
  <p>Voir aussi : <a href="/chiffres">rundata.re en chiffres</a>.</p>
</section>`;
  return layout(origin, { title: TITLE, description: CHAPEAU, path: PATH, jsonld: [crumbs(origin, H1, PATH), webPage(origin, PATH, TITLE, CHAPEAU, null)], alerte }, band, body);
}
