/**
 * /valeurs, « Nos valeurs »: what an information closed in a social network costs, three habits and what to do instead
 * (the guide, /ouvrir-ses-donnees), then what rundata.re stands for (open data, open code, no account), each sentence
 * backed by what the site already does: /confidentialite, the footer, /a-propos, the code on GitHub,
 * /conditions#reutiliser, /mcp, and the notice shown in place of a site that forbids reuse. Written 26/10/2026.
 */
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { PATH as GUIDE } from "./ouvrir-donnees.js";
import { GITHUB, layout } from "./pages.js";

export const PATH = "/valeurs";
const TITLE = "Nos valeurs · rundata.re";
const DESCRIPTION = "rundata.re rassemble les données publiques de La Réunion, sans compte ni publicité, avec un code ouvert. Ce qui est fermé, on ne le contourne pas\u00a0: on le dit.";

export function valeursPage(origin: string, alerte?: Alerte): string {
  const band = `${crumbBar("Nos valeurs")}
<div class="wrap intro solo"><div class="pitch">
  <h1>Nos valeurs</h1>
  <p class="lead">Une information publique doit pouvoir se lire librement, par tout le monde. rundata.re est fait pour ça.</p>
</div></div>`;
  const body = `<section style="max-width:44rem;display:grid;gap:1rem">
  <h2 id="enfermee">Ce que coûte une information enfermée</h2>
  <p>À La Réunion, beaucoup d'informations du quotidien passent par Facebook et Instagram\u00a0: la route coupée signalée dans un groupe, la fête du week-end annoncée sur une page, l'avis de sécurité publié en story. Ceux qui les publient le font pour bien faire, puisque c'est là que sont leurs habitants. Mais une information publiée seulement là coûte cher à ceux qui la cherchent.</p>
  <ul>
    <li><b>Il faut un compte.</b> Sans compte Facebook, la plupart des groupes ne s'ouvrent pas. Avec un compte, il faut encore y être accepté.</li>
    <li><b>On ne retrouve rien.</b> Un moteur de recherche ne voit pas l'intérieur d'un groupe privé, et un post descend vite dans le fil\u00a0: deux jours plus tard, il est souvent introuvable.</li>
    <li><b>Rien ne se rassemble.</b> La même information est éparpillée entre une page, plusieurs groupes et le partage d'un voisin, chacun avec sa version et son heure. Personne ne voit tout, et personne ne sait laquelle est la bonne.</li>
    <li><b>On ne peut rien en faire.</b> Une information enfermée dans un post ou dans une image ne devient ni une alerte sur votre téléphone, ni une carte, ni une réponse de votre assistant IA, ni un service qu'une association pourrait construire.</li>
    <li><b>C'est la plateforme qui décide.</b> Son fil choisit ce qui vous est montré. Dans les groupes, des filtres automatiques peuvent refuser un post avant qu'un administrateur l'ait lu (<a href="https://about.fb.com/news/2022/03/new-tools-for-facebook-group-admins/">Meta, 09/03/2022</a>). Au premier trimestre 2026, 98,7\u00a0% des vues de posts sur Facebook aux États-Unis ne comportaient aucun lien vers un autre site, d'après le rapport de Meta, et depuis septembre 2026 certaines Pages sont limitées à deux publications avec lien par mois, sauf abonnement payant (<a href="https://www.socialmediatoday.com/news/facebook-pages-get-charged-for-link-posts/830743/">Social Media Today, 17/09/2026</a>). Depuis le 22 avril 2024, aucune application extérieure ne peut plus publier dans un groupe (<a href="https://developers.facebook.com/docs/graph-api/changelog/version19.0/">journal des changements de Meta</a>). Remonter à la source, ou en sortir, devient de plus en plus difficile.</li>
  </ul>
  <p>Pour toute l'île, le coût est là\u00a0: une information publique, utile à tous, devient captive d'une entreprise privée. Elle est éparpillée, elle s'efface, et elle reste réservée à ceux qui ont un compte.</p>
  <h2 id="habitudes">Trois habitudes, et ce qu'on peut faire à la place</h2>
  <ul>
    <li><b>Un avis publié seulement en story.</b> Une story s'efface au bout de 24 heures. À la place\u00a0: publier l'avis en texte sur son site, avec sa date, et faire pointer la story vers lui.</li>
    <li><b>Un état des routes, un programme ou des horaires publiés en image.</b> Une personne peut les lire, mais pas un moteur de recherche ni une application, et souvent pas un lecteur d'écran. À la place\u00a0: le même contenu en texte, sous l'image ou à sa place.</li>
    <li><b>Un agenda tenu seulement sur une page ou dans un groupe.</b> À la place\u00a0: l'agenda sur son site, avec un flux que d'autres peuvent reprendre, et un post Facebook qui renvoie vers lui.</li>
  </ul>
  <p>Mairie, association, salle, club ou service public\u00a0: chacun peut le faire, souvent sans frais et sans équipe technique. Notre guide explique comment\u00a0: <a href="${GUIDE}">rendre ses données accessibles</a>.</p>
  <p>rundata.re fait déjà ainsi.</p>
  <h2 id="sans-compte">Sans compte</h2>
  <p>Toutes les pages se lisent sans compte, sans nom et sans adresse électronique. Le site n'affiche aucune publicité, ne dépose aucun cookie et ne vend aucune donnée. Il est gratuit, et il l'est à vie pour les associations à but non lucratif.</p>
  <h2 id="code">Un code ouvert</h2>
  <p>Le code de rundata.re est public, sous licence MIT\u00a0: chacun peut le lire, vérifier ce qu'il fait et le reprendre. <a href="${GITHUB}">Le code sur GitHub</a></p>
  <h2 id="donnees">Des données ouvertes, et sourcées</h2>
  <p>Chaque donnée affiche sa source, sa licence et son heure. Vous pouvez la reprendre à votre tour, aux conditions de sa licence\u00a0: <a href="/conditions#reutiliser">réutiliser les données</a>. Le même contenu se lit aussi depuis un assistant IA (ChatGPT, Claude, Le Chat), sans compte\u00a0: <a href="/mcp">le connecteur rundata.re</a>.</p>
  <h2 id="ferme">Ce qui est fermé, nous ne le contournons pas</h2>
  <p>Quand un site interdit par écrit de reprendre son contenu, rundata.re ne le reprend pas, même par un détour. À la place, la page le dit\u00a0: qui l'interdit et, quand nous lui avons demandé son accord, à quelle date. Un site public qui ne répond plus est signalé lui aussi\u00a0: <a href="/sites-sans-reponse">les sites publics sans réponse</a>.</p>
  <p>Une information publique qui reste fermée n'arrive pas à tout le monde. Vous tenez à l'agenda de votre mairie, au programme de votre salle, aux résultats de votre club\u00a0? Demandez-leur d'en permettre la reprise\u00a0: c'est vous qu'ils écoutent. Et pour leur montrer comment, envoyez-leur <a href="${GUIDE}">notre guide</a>.</p>
  <h2 id="reseaux-sociaux">Pourquoi nous sommes aussi sur Facebook et Instagram</h2>
  <p>Parce que beaucoup d'entre vous y sont. Nos posts renvoient au site, où tout se lit sans compte et où c'est vous qui choisissez ce que vous lisez.</p>
</section>`;
  return layout(origin, { title: TITLE, description: DESCRIPTION, path: PATH, jsonld: [crumbs(origin, "Nos valeurs", PATH), webPage(origin, PATH, TITLE, DESCRIPTION, null)], alerte }, band, body);
}
