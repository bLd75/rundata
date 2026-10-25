/**
 * The press page (/presse): the press release, the key figures counted from what the server holds right now, and the
 * visuals to download. The visuals are static assets served beside the Worker (public/presse/, built by
 * scripts/build-presse.py), not bundled with it.
 */
import type { Cache } from "../cache.js";
import { DAES } from "../providers/dae.js";
import { IDS as CHARGE_POINTS, STATIONS as CHARGE_STATIONS } from "../providers/irve.js";
import { SITES as BATHING_SITES } from "../providers/baignades.js";
import { STATIONS_EN_SERVICE } from "../providers/meteofrance-stations.js";
import { RANDONNEES, SENTIERS } from "../providers/traces.js";
import { GROUPS as STOP_GROUPS, NETWORKS } from "../providers/transit.js";
import { createServer } from "../server.js";
import { COMMUNES } from "./commune.js";
import type { AgendaAnswer, RandonneesAnswer } from "./data.js";
import { esc } from "./map.js";
import icons from "./icons.json" with { type: "json" };
import og from "./og.json" with { type: "json" };
import { follow, icon, layout, SITE } from "./pages.js";
import visuals from "./presse.json" with { type: "json" };

const CONTACT = "contact@rundata.re";

/** The visuals, in the order of the page: the desktop ones first, the best one leading. */
const CAPTIONS: Record<keyof typeof visuals, string> = {
  "randonnees-ordi": "La page Randonnée : les itinéraires et les sentiers de l'ONF sur la carte de l'île, colorés selon leur état du jour.",
  "accueil-ordi": "L'accueil : les températures mesurées en ce moment autour de l'île, la vigilance, le volcan, la mer.",
  "piton-des-neiges-ordi": "Le sentier du Piton des Neiges : sa trace GPS, sa longueur, son dénivelé et son profil.",
  accueil: "L'accueil sur un téléphone.",
  cilaos: "La météo mesurée à Cilaos, avec l'heure de la mesure et la station.",
  randonnees: "La page Randonnée sur un téléphone.",
  evenements: "Les fêtes, concerts et marchés des deux semaines qui viennent.",
  historique: "L'historique météo, comparé à la normale.",
};

// Counted once per isolate: the tools this server registers, as the connector lists them.
let tools: number | undefined;
const toolCount = (cache: Cache) => (tools ??= Object.keys((createServer(cache) as unknown as { _registeredTools: object })._registeredTools).length);

export interface Figure {
  valeur: number;
  label: string;
  detail?: string;
}

const n = (x: number) => x.toLocaleString("fr-FR").replace(/ /g, " ");

/**
 * The key figures: what the server holds (its bundles, its tools) and, when this data center already has them, two
 * counts of the day. Nothing is fetched for them.
 */
export async function pressFigures(cache: Cache): Promise<Figure[]> {
  const [hikes, agenda] = await Promise.all([cache.peek<RandonneesAnswer>("web:randonnees").catch(() => undefined), cache.peek<AgendaAnswer>("web:agenda").catch(() => undefined)]);
  const figures: Figure[] = [
    { valeur: toolCount(cache), label: "outils dans le connecteur pour les assistants IA", detail: "météo, volcan, bus, eau, sentiers, terrain…" },
    { valeur: COMMUNES.length, label: "communes, chacune avec sa page" },
    { valeur: STATIONS_EN_SERVICE, label: "stations Météo-France en direct", detail: "une mesure toutes les 6 minutes, du littoral aux sommets" },
    { valeur: STOP_GROUPS.length, label: "arrêts de bus et de car", detail: `${Object.keys(NETWORKS).length} réseaux, prochains départs, et les retards quand le réseau les publie` },
    { valeur: CHARGE_POINTS.size, label: "points de recharge pour voiture électrique", detail: `dans ${CHARGE_STATIONS.length} stations, libres ou occupés en direct` },
    { valeur: DAES.length, label: "défibrillateurs", detail: "avec leur accès et leurs horaires" },
    { valeur: RANDONNEES.length, label: "itinéraires de randonnée avec leur trace GPS" },
    { valeur: Object.keys(SENTIERS).length, label: "sentiers suivis par l'ONF", detail: hikes ? `dont ${n(hikes.value.fermes)} fermés aujourd'hui` : undefined },
    { valeur: BATHING_SITES.length, label: "plages et bassins contrôlés par l'ARS" },
  ];
  if (agenda) figures.push({ valeur: agenda.value.nombre, label: "événements dans les deux semaines qui viennent", detail: "fêtes, concerts, marchés, festivals" });
  return figures;
}

const link = (url: string) => `<a href="${url}">${url.replace(/^https:\/\//, "")}</a>`;

// The press release dated 24 October 2026, word for word as the communication kit sends it (communique.md); the key figures above it are live.
const RELEASE = `<p class="eyebrow">Communiqué de presse · La Réunion, le 24 octobre 2026</p>
<h2 id="h-communique">Toute La Réunion en direct, sur une seule page… et dans votre assistant IA</h2>
<p><b>rundata.re, un site gratuit, sans compte et sans publicité, rassemble en un seul endroit les données publiques de l'île au moment où on les consulte : la météo mesurée aux stations, la vigilance, le volcan, les bus, les sentiers ouverts ou fermés, la qualité de l'eau, les coupures, les événements du week-end, les informations des médias de l'île. Et il les met dans ChatGPT, Claude ou Le Chat, qui répondent alors avec de vraies mesures, datées et sourcées.</b></p>
<p>Il pleut à Cilaos en ce moment ? Le sentier du Piton des Neiges est-il ouvert ? Que faire ce week-end ? Le prochain car jaune passe à quelle heure ? Jusqu'ici, chaque réponse se cherchait sur un site différent : Météo-France, l'ONF, l'ARS, les réseaux de bus, les mairies, l'observatoire du volcan… rundata.re les réunit sur une même page, commune par commune, mise à jour en continu, chaque donnée avec son heure.</p>
<h3>Des mesures, pas des modèles</h3>
<p>À La Réunion, on passe du niveau de la mer à 3 000 m en vingt kilomètres : une application météo nationale qui donne « 28 °C » pour tout un secteur ne dit rien de Cilaos ou du Maïdo. rundata.re affiche ce que mesure la station Météo-France la plus proche et la plus représentative, avec l'heure de la mesure, la distance et l'altitude de la station. La pluie vue par le radar est donnée au lieu même. Les prévisions existent aussi, mais toujours séparées et étiquetées comme telles. Et pour un cyclone, le site renvoie toujours à la vigilance officielle de Météo-France et aux consignes de la préfecture.</p>
<h3>Ce qu'on y trouve</h3>
<ul>
<li><b>Météo</b> : les stations Météo-France de la côte aux sommets, relevées toutes les 6 minutes ; radar de pluie ; vigilance et alerte cyclonique ; cyclones actifs de l'océan Indien.</li>
<li><b>Historique</b> : le temps qu'il a fait, jour par jour depuis 1900 et heure par heure depuis 2000, comparé à la normale et aux records. Exemple : le 28 février 2025, pendant le cyclone Garance, la station de Chaudron a mesuré 278,9 mm de pluie dans la journée, dont 92,8 mm entre midi et 13 h, et l'aéroport de Gillot une rafale de 213 km/h.</li>
<li><b>Actualités</b> : les informations des médias de l'île (Réunion La 1ère, Clicanoo, Imaz Press, Freedom, Parallèle Sud, Témoignages) et les communiqués de la préfecture, relus toutes les 5 minutes et rangés par commune et par sujet : le titre, la première phrase et le lien vers l'article, sur ${link("https://rundata.re/actualites")}. On peut aussi demander à son assistant IA « que se passe-t-il à Saint-Pierre ? ».</li>
<li><b>Volcan</b> : éruption ou non, accès à l'Enclos, séismes localisés par l'observatoire.</li>
<li><b>Mer</b> : température de l'eau au large des plages, hauteur de la marée mesurée au Port et à Sainte-Marie.</li>
<li><b>Se déplacer</b> : prochains départs à n'importe quel arrêt de Car Jaune, Citalis, Kar'Ouest, Alternéo, CarSud, Estival et du téléphérique Papang ; vélos Altervélo disponibles ; état en direct des 411 points de recharge pour voiture électrique.</li>
<li><b>Randonnée</b> : une page pour les randonneurs, ${link("https://rundata.re/randonnees")} : 41 itinéraires et 351 sentiers de l'ONF sur une carte, colorés selon leur état du jour, à filtrer par distance, dénivelé ou boucle. Chaque sentier a sa trace GPS (GPX) ; quand un itinéraire traverse un tronçon fermé, la page l'annonce en rouge et le fichier GPX porte un repère « FERMÉ » qui s'affiche dans l'application GPS du randonneur.</li>
<li><b>Eau</b> : qualité de l'eau du robinet réseau par réseau et des 26 plages et bassins contrôlés par l'ARS, coupures et avis « ne pas boire », restrictions sécheresse commune par commune.</li>
<li><b>Vie pratique</b> : fêtes, concerts, spectacles, marchés et festivals des prochains jours d'après les agendas des mairies, de l'office de tourisme et la programmation des salles ; vacances scolaires et jours fériés (dont le 20 décembre) ; horaires des mairies et services publics ; plus de 1 200 défibrillateurs ; qualité de l'air ; d'où vient l'électricité de l'île en ce moment.</li>
<li><b>À une adresse</b> : parcelle, zone du PLU, prix de vente médians autour, risques naturels.</li>
</ul>
<h3>Dans votre IA, en deux minutes</h3>
<p>C'est la nouveauté : rundata.re est aussi un « connecteur » pour les assistants d'intelligence artificielle. On colle une adresse, ${link("https://rundata.re/mcp")}, dans ChatGPT, Claude ou Le Chat, et l'assistant va chercher lui-même la donnée du moment au lieu d'inventer une réponse. On lui demande « il fait beau au Maïdo ? » ou « quelle plage est bonne pour se baigner dans l'Ouest ? », il répond avec la mesure, son heure et sa source. Rien à installer, pas de compte, aucune donnée personnelle collectée. Le site propose aussi des questions toutes prêtes, en français et en kréol, à ouvrir d'un clic dans ChatGPT ou Claude.</p>
<p>Ce connecteur suit un protocole ouvert, le MCP (Model Context Protocol), que comprennent désormais la plupart des assistants IA : c'est une façon concrète de mettre les données publiques d'un territoire entier à la portée de ces outils.</p>
<h3>Gratuit, ouvert, fait pour l'île</h3>
<p>Le site n'a ni publicité ni cookie (les statistiques de visite sont anonymes). Toutes les données viennent d'organismes publics (Météo-France, ONF, ARS, OVPF-IPGP, EDF, Atmo Réunion, réseaux de bus, mairies…) ou de projets ouverts comme OpenStreetMap, et chaque chiffre est cité avec sa source. Le code est libre (licence MIT). rundata.re est un projet indépendant : il n'est rattaché à aucun de ces organismes et ne remplace pas leurs canaux officiels.</p>
<p>« Nous voulions qu'on puisse répondre en un coup d'œil aux questions de tous les jours, avec la source officielle à côté de chaque chiffre », explique l'équipe de rundata.re.</p>
<h3>Liens</h3>
<ul>
<li>Le site : ${link("https://rundata.re")}</li>
<li>L'adresse du connecteur pour les assistants IA : ${link("https://rundata.re/mcp")}</li>
<li>Exemples : ${["meteo/cilaos", "randonnees", "evenements", "historique"].map((p) => link(`https://rundata.re/${p}`)).join(" · ")}</li>
<li>Visuels : <a href="#visuels">plus bas sur cette page</a>, utilisation libre avec la mention rundata.re.</li>
</ul>
<p><b>Contact presse : Benjamin, pour l'équipe rundata.re — <a href="mailto:${CONTACT}">${CONTACT}</a></b></p>
<p>L'équipe rundata.re</p>`;

const kb = (octets: number) => `${n(Math.round(octets / 1024))} Ko`;

function visual(id: keyof typeof visuals): string {
  const v = visuals[id];
  const phone = v.hauteur > v.largeur;
  return `<figure class="card vis${phone ? " phone" : ""}">
  <a href="${v.hd}"><img src="${v.vignette}" width="${v.vignette_largeur}" height="${v.vignette_hauteur}" loading="lazy" decoding="async" alt="${esc(CAPTIONS[id])}"></a>
  <figcaption>${esc(CAPTIONS[id])}<a class="dl" href="${v.hd}" download="rundata-${id}.jpg">Télécharger (HD)</a><span class="note">JPEG ${n(v.largeur)} × ${n(v.hauteur)}, ${kb(v.octets)}</span></figcaption>
</figure>`;
}

export function pressePage(origin: string, figures: Figure[]): string {
  const ids = Object.keys(visuals) as (keyof typeof visuals)[];
  const wide = ids.filter((id) => visuals[id].largeur >= visuals[id].hauteur);
  const phones = ids.filter((id) => visuals[id].largeur < visuals[id].hauteur);
  const lead = visuals["randonnees-ordi"];

  const band = `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li aria-current="page">Presse</li></ol></nav></div>
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Espace presse</p>
    <h1>rundata.re, pour la presse</h1>
    <p class="lead">Le communiqué, les chiffres clés comptés en direct et des visuels à télécharger, libres d'utilisation avec la mention rundata.re. Une question, une interview : <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
    <p class="hero-cta"><a class="btn sun" href="#visuels">${icon("map")}Les visuels</a><a class="btn glass" href="mailto:${CONTACT}">Contact presse</a></p>
    ${follow()}
  </div>
  <figure class="card mapcard shot"><a href="${lead.hd}"><img src="${lead.vignette}" width="${lead.vignette_largeur}" height="${lead.vignette_hauteur}" alt="${esc(CAPTIONS["randonnees-ordi"])}"></a></figure>
</div>`;

  const keyFigures = `<section aria-labelledby="h-chiffres">
  <div class="sec-h"><p class="eyebrow">En direct</p><h2 id="h-chiffres">Chiffres clés</h2>
  <p>Comptés au moment où cette page s'affiche, dans les données que le site sert.</p></div>
  <ul class="figs">${figures.map((f) => `<li class="card"><span class="fig">${n(f.valeur)}</span><span>${esc(f.label)}${f.detail ? `<small>${esc(f.detail)}</small>` : ""}</span></li>`).join("")}</ul>
</section>`;

  const release = `<section aria-labelledby="h-communique"><article class="card release">${RELEASE}</article></section>`;

  const gallery = `<section id="visuels" aria-labelledby="h-visuels">
  <div class="sec-h"><p class="eyebrow">Captures du 25 octobre 2026, pendant l'alerte 1 du Piton de la Fournaise.</p><h2 id="h-visuels">Visuels</h2>
  <p><b>Utilisation libre des visuels avec la mention rundata.re.</b> Cliquez sur une image pour l'ouvrir en grand.</p></div>
  <div class="vis-grid">${wide.map(visual).join("")}</div>
  <div class="vis-grid phones">${phones.map(visual).join("")}</div>
  <div class="vis-grid">
    <figure class="card vis"><a href="${icons["symbole-svg"]}"><img class="logo" src="${icons["symbole-svg"]}" width="160" height="160" loading="lazy" decoding="async" alt="Le symbole de rundata.re, le Point chaud"></a>
    <figcaption>Le symbole de rundata.re, le Point chaud.<a class="dl" href="${icons["symbole-svg"]}" download="rundata-symbole.svg">Télécharger (SVG)</a><a class="dl" href="${icons["symbole-1024"]}" download="rundata-symbole-1024.png">Télécharger (PNG)</a><span class="note">SVG, à toute taille · PNG 1 024 × 1 024</span></figcaption></figure>
    <figure class="card vis"><a href="${icons["lockup-nuit"]}"><img class="lockup nuit" src="${icons["lockup-nuit"]}" width="1421" height="230" loading="lazy" decoding="async" alt="Le logo de rundata.re sur fond sombre"></a>
    <figcaption>Le logo, sur fond sombre.<a class="dl" href="${icons["lockup-nuit"]}" download="rundata-logo-fond-sombre.svg">Télécharger (SVG)</a><span class="note">SVG, à toute taille</span></figcaption></figure>
    <figure class="card vis"><a href="${icons["lockup-sable"]}"><img class="lockup sable" src="${icons["lockup-sable"]}" width="1421" height="230" loading="lazy" decoding="async" alt="Le logo de rundata.re sur fond clair"></a>
    <figcaption>Le logo, sur fond clair.<a class="dl" href="${icons["lockup-sable"]}" download="rundata-logo-fond-clair.svg">Télécharger (SVG)</a><span class="note">SVG, à toute taille</span></figcaption></figure>
    <figure class="card vis"><a href="/og.png?v=${og.v}"><img src="/og.png?v=${og.v}" width="1200" height="630" loading="lazy" decoding="async" alt="L'image de partage de rundata.re : le logo, La Réunion 974 en direct et le relief de l'île"></a>
    <figcaption>L'image de partage des liens.<a class="dl" href="/og.png?v=${og.v}" download="rundata-partage.png">Télécharger (PNG)</a><span class="note">PNG 1 200 × 630</span></figcaption></figure>
  </div>
</section>`;

  const title = "Presse : communiqué, chiffres clés et visuels · rundata.re";
  const description = "Espace presse de rundata.re : le communiqué, les chiffres clés en direct et des visuels libres d'utilisation avec la mention rundata.re. Contact : contact@rundata.re.";
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE, item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: "Presse", item: `${origin}/presse` },
    ],
  };
  return layout(origin, { title, description, path: "/presse", jsonld: [crumbs] }, band, `${keyFigures}\n${release}\n${gallery}`);
}
