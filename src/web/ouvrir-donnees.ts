/**
 * /ouvrir-ses-donnees, « Rendre ses données accessibles »: a guide for a mairie, an association, a hall, a club or a
 * public service without a technical team, on publishing its information so that anyone can read and reuse it. Linked
 * from /valeurs, the footer, /a-propos, /sites-sans-reponse, and on the pages from the notices of a site whose terms
 * forbid reuse (`reprise`). Written 26/10/2026.
 */
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { layout } from "./pages.js";

export const PATH = "/ouvrir-ses-donnees";
const TITLE = "Rendre ses données accessibles · rundata.re";
const CRUMB = "Rendre ses données accessibles";
const DESCRIPTION = "Mairie, association, salle, club\u00a0: comment publier vos informations pour que chacun puisse les lire et les reprendre, souvent sans frais et en sécurité.";

/** Its part on the licence, where the notices of a site that forbids reuse send. */
export const LICENCE = `${PATH}#licence`;

/**
 * The link after a notice that a site's terms forbid reuse (tools/non-repris.ts), on the pages only: the tools' answers
 * stay as they are. Added at each view, so the pages' copies do not change. « interdisent » or « l'interdisent »;
 * none after a refusal alone. After a notice that ends with its source's link, a « · » between the two.
 */
export const reprise = (notice: string) =>
  /\binterdisent\b/.test(notice) ? `${/<\/a>$/.test(notice) ? "\u00a0·\u00a0" : " "}<a href="${LICENCE}">Comment permettre la reprise</a>` : "";

export function ouvrirDonneesPage(origin: string, alerte?: Alerte): string {
  const band = `${crumbBar(CRUMB)}
<div class="wrap intro solo"><div class="pitch">
  <h1>Rendre ses données accessibles, à moindre coût et en toute sécurité</h1>
  <p class="lead">Mairie, association, salle, club, service public\u00a0: vous publiez des informations utiles, comme un agenda, une coupure, des horaires ou des résultats. Ce guide explique comment les rendre lisibles par tous, faciles à retrouver et à reprendre, en commençant par ce qui ne coûte rien. Pas besoin d'équipe technique.</p>
</div></div>`;
  const body = `<section style="max-width:44rem;display:grid;gap:1rem">
  <p>En bref\u00a0: du texte plutôt qu'une image, un flux, un fichier simple, une licence claire, votre site d'abord, et rien de personnel.</p>
  <h2 id="pourquoi">Pourquoi</h2>
  <p>Une information publiée sur votre site, en texte et avec sa date, se lit sans compte et se retrouve par une recherche. D'autres peuvent la reprendre\u00a0: un site comme rundata.re, une application, un assistant IA, une autre association. Et c'est votre page qui fait foi.</p>
  <h2 id="texte">1. Du texte, pas seulement une image</h2>
  <p>Une affiche ou un communiqué en image se lit à l'œil, mais pas toujours par un moteur de recherche, une application ou un lecteur d'écran. Mettez le même contenu en texte sous l'image\u00a0: la date, le lieu, l'heure, ce qui change. Ça ne coûte rien.</p>
  <h2 id="flux">2. Un flux\u00a0: il est souvent déjà là</h2>
  <p>Un flux permet à d'autres sites et applications de suivre vos nouvelles publications sans les recopier à la main.</p>
  <ul>
    <li><b>Votre site tourne sous WordPress\u00a0?</b> Il publie déjà des flux RSS, sans rien installer (<a href="https://developer.wordpress.org/advanced-administration/wordpress/feeds/">documentation WordPress</a>). Sur un site WordPress, le flux des articles se trouve en général à l'adresse du site suivie de /feed/, comme <a href="https://wordpress.org/news/feed/">wordpress.org/news/feed/</a>. Son API est active elle aussi, et ce qui est public sur le site l'est aussi par elle (<a href="https://developer.wordpress.org/rest-api/">documentation</a>). Rien à faire, sauf ne pas la couper\u00a0: WordPress le déconseille (<a href="https://developer.wordpress.org/rest-api/frequently-asked-questions/">questions fréquentes</a>).</li>
    <li><b>Un site Wix avec son module Blog\u00a0?</b> Il propose un flux RSS (<a href="https://support.wix.com/en/article/wix-blog-adding-an-rss-button-to-your-site">aide Wix</a>).</li>
    <li><b>Votre agenda est dans Google Agenda\u00a0?</b> Rendez-le public, puis donnez son «\u00a0Adresse publique au format iCal\u00a0»\u00a0: d'autres pourront le lire (<a href="https://support.google.com/calendar/answer/37083?hl=fr">aide Google</a>). L'«\u00a0Adresse secrète au format iCal\u00a0», elle, ne se donne jamais (<a href="https://support.google.com/calendar/answer/37648?hl=fr">aide Google</a>).</li>
    <li><b>Pas encore d'agenda en ligne\u00a0?</b> OpenAgenda a une version gratuite, sans limite de durée. Elle permet un nombre d'événements illimité, des exports ics et json, et une interface de programmation (<a href="https://doc.openagenda.com/fr/article/tarifs-openagenda-2lhr2f/">tarifs OpenAgenda</a>, page du 10/12/2024). Les annonces d'un agenda public y sont diffusées sous Licence Ouverte 2.0 (<a href="https://doc.openagenda.com/fr/article/conditions-generales-dutilisation-xq325m/">conditions d'utilisation</a>). Les fonctions payantes servent surtout à rassembler beaucoup d'agendas\u00a0: pour publier le sien, la version gratuite suffit en général.</li>
  </ul>
  <h2 id="fichier">3. Un fichier simple, pour une liste</h2>
  <p>Des horaires, une liste d'équipements, des résultats\u00a0: un tableur enregistré au format CSV suffit. Vous pouvez le publier sur data.gouv.fr, la plateforme publique des données ouvertes. L'inscription y est gratuite, et les données publiées doivent être gratuites et d'intérêt public (<a href="https://www.data.gouv.fr/pages/legal/cgu">modalités d'utilisation</a>). On peut y publier au nom de sa structure, association comprise (<a href="https://guides.data.gouv.fr/organisations/creer-une-organisation">créer une organisation</a>), en déposant le fichier ou en donnant le lien d'un fichier qui reste sur votre site (<a href="https://guides.data.gouv.fr/jeux-de-donnees/publier-un-jeu-de-donnees">publier un jeu de données</a>).</p>
  <p>À La Réunion, le portail de la Région, <a href="https://data.regionreunion.com">data.regionreunion.com</a>, présente déjà des données de communes et d'intercommunalités de l'île.</p>
  <h2 id="licence">4. Une licence claire</h2>
  <p>Dites ce que les autres ont le droit de faire. Le plus simple est la Licence Ouverte 2.0, celle des données publiques de l'État (<a href="https://www.data.gouv.fr/pages/legal/licences/etalab-2.0">texte de la licence</a>). Avec elle, chacun peut réutiliser vos informations, même pour un usage commercial, à condition de citer la source et la date de mise à jour, sans faire croire à un soutien officiel.</p>
  <p>Dans vos mentions légales, une phrase suffit. Par exemple, et c'est une proposition de rundata.re, pas un modèle officiel\u00a0: «\u00a0Sauf mention contraire, les informations publiées sur ce site peuvent être réutilisées selon la Licence Ouverte 2.0, en citant [votre structure] et la date de mise à jour. Les photos et logos n'en font pas partie.\u00a0»</p>
  <h2 id="site-d-abord">5. Votre site d'abord, les réseaux ensuite</h2>
  <p>Les réseaux sociaux restent utiles pour prévenir vite. Publiez d'abord sur votre site, puis un post ou une story qui renvoie vers la page. L'information garde ainsi sa date, sa version qui fait foi, et une adresse qu'on retrouve encore des mois plus tard.</p>
  <h2 id="securite">6. En toute sécurité</h2>
  <ul>
    <li><b>Ne publiez que ce qui est public.</b> Pas de nom, de téléphone ni d'adresse d'un particulier sans son accord. Une administration doit rendre impossible l'identification des personnes avant de publier des documents qui les concernent (article L312-1-2 du code des relations entre le public et l'administration\u00a0; <a href="https://www.cnil.fr/fr/lanonymisation-des-donnees-un-traitement-cle-pour-lopen-data">CNIL</a>). Et pour tous, le RGPD s'applique.</li>
    <li><b>Gardez secret ce qui doit l'être.</b> Par exemple, l'adresse secrète d'un agenda Google (partie 2).</li>
    <li><b>Une lecture par un robot ne doit presque rien vous coûter.</b> Une page servie depuis un cache évite au serveur tout le traitement (<a href="https://developer.mozilla.org/fr/docs/Web/HTTP/Guides/Caching">MDN</a>). Sous WordPress, une extension de cache gratuite comme <a href="https://wordpress.org/plugins/wp-super-cache/">WP Super Cache</a> sert des fichiers déjà prêts au lieu de refaire la page à chaque visite. Un flux, un fichier CSV ou un agenda .ics servis ainsi ne coûtent presque rien, comparés à une page qui interroge la base de données.</li>
  </ul>
  <h2 id="loi">7. Pour les communes et les administrations, c'est aussi la loi</h2>
  <p>La loi pour une République numérique du 7 octobre 2016 vise les administrations de 50 agents ou plus (en équivalents temps plein) et, pour une collectivité, d'au moins 3 500 habitants. Elles publient en ligne, entre autres, leurs bases de données mises à jour régulièrement, et les données dont la publication présente un intérêt économique, social, sanitaire ou environnemental (articles L312-1-1 et D312-1-1-1 du code des relations entre le public et l'administration). Les 24 communes de La Réunion comptent toutes plus de 3 500 habitants. Ce guide aide aussi à remplir cette obligation, simplement.</p>
  <h2 id="rundata">8. Et rundata.re\u00a0?</h2>
  <p>Si vos informations sont publiées ainsi, rundata.re peut les reprendre en citant votre nom, votre page et l'heure de la lecture. Une question, ou envie que nous lisions votre flux\u00a0? Écrivez à <a href="mailto:contact@rundata.re">contact@rundata.re</a>.</p>
</section>`;
  return layout(origin, { title: TITLE, description: DESCRIPTION, path: PATH, jsonld: [crumbs(origin, CRUMB, PATH), webPage(origin, PATH, TITLE, DESCRIPTION, null)], alerte }, band, body);
}
