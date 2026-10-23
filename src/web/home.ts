/**
 * The home page: what rundata.re is, the island right now (one tile per category, from each category page's last
 * copy), how to add the connector to an assistant, and the page of each commune.
 */
import type { Cached } from "../cache.js";
import { ageMinutes, ageText } from "../geo.js";
import type * as mf from "../providers/vigilance.js";
import brand from "./brand.json" with { type: "json" };
import { CATEGORIES, type Category } from "./categories.js";
import type { AirAnswer, Alerte, BusData, CalendrierAnswer, ElectriciteAnswer, HomeData, VolcanAnswer } from "./data.js";
import { airLive, busLive, calendrierLive, electriciteLive, volcanLive } from "./domains.js";
import { de } from "../tools/format.js";
import { esc } from "./map.js";
import {
  ask,
  coldest,
  connector,
  deg,
  fresh,
  hm,
  icon,
  layout,
  type Live,
  merLive,
  meteoLive,
  metres,
  placeLinks,
  shortName,
  SITE,
  SLOGAN,
  thin,
  vigilanceLive,
  windText,
  withTemp,
} from "./pages.js";

/** The last copy of each category page, as the home page found it; null or missing when there is none yet. */
export interface HomeLive {
  meteo: Cached<HomeData> | null;
  vigilance?: Cached<mf.Vigilance> | null;
  volcan?: Cached<VolcanAnswer> | null;
  air?: Cached<AirAnswer> | null;
  electricite?: Cached<ElectriciteAnswer> | null;
  calendrier?: Cached<CalendrierAnswer> | null;
  bus?: Cached<BusData> | null;
}

function lives(h: HomeLive | null, now: Date): Record<string, Live | undefined> {
  return {
    meteo: meteoLive(h?.meteo ?? null),
    vigilance: vigilanceLive(h?.vigilance ?? null, now),
    mer: merLive(h?.meteo ?? null),
    volcan: volcanLive(h?.volcan ?? null),
    bus: busLive(h?.bus ?? null),
    air: airLive(h?.air ?? null),
    electricite: electriciteLive(h?.electricite ?? null),
    calendrier: calendrierLive(h?.calendrier ?? null),
  };
}

function askHome(origin: string, now: Date): string {
  const url = fresh(`${origin}/`, now);
  return ask(`Kosa i spas La Rényon astèr ? Rogard si ${url} é di amwin lo tan, lo volkan, lo kouran é lo bis.`,
    `Que se passe-t-il en ce moment à La Réunion ? Lis ${url} et résume-moi la météo, la vigilance, le volcan, l'électricité, l'air et les bus, avec l'heure des données.`);
}

interface Demo {
  question: string;
  call: string;
  answer: string;
}

/** Sample exchanges, each answered with the data of the moment: what the connector changes, shown. */
function demos(h: HomeLive | null, now: Date): Demo[] {
  const out: Demo[] = [];
  const l = withTemp(h?.meteo ?? null);
  if (l.length) {
    // The coldest station, in the Hauts: the answer a model could not give from memory.
    const s = coldest(l);
    const where = shortName(s.nom);
    const by = s.source === "meteofrance" ? "la station Météo-France" : s.source === "metar" ? "la station de l'aéroport" : "la station";
    out.push({
      question: `Il fait combien à ${esc(where)} en ce moment ?`,
      call: `meteo_actuelle(lieu: "${esc(where)}")`,
      answer: `${thin(deg(s.temperature!))}, mesurés à ${hm(s.time)} (${ageText(ageMinutes(new Date(s.time), now))}) par ${by} ${esc(s.nom)}, ` +
        `à ${metres(s.altitude_m)} d'altitude.${windText(s) ? ` ${esc(thin(windText(s)!.replace(/^vent/, "Vent")))}.` : ""}`,
    });
  }
  const e = h?.volcan?.value.etat;
  if (e) {
    const q = h!.volcan!.value.seismes;
    out.push({
      question: "Le volcan est en éruption ?",
      call: "volcan_seismes()",
      answer: `${e.eruption_en_cours ? "Oui, le Piton de la Fournaise est en éruption" : "Non, pas d'éruption en cours au Piton de la Fournaise"} (niveau ORSEC : ${esc(e.niveau_orsec)}).` +
        (q ? ` L'observatoire a localisé ${q.sous_le_volcan["7_jours"]} séisme${q.sous_le_volcan["7_jours"] > 1 ? "s" : ""} sous le volcan en 7 jours.` : ""),
    });
  }
  const g = h?.bus?.value.gares.find((x) => x.departs.length >= 2);
  if (g) {
    const [a, b] = g.departs;
    out.push({
      question: `Le prochain bus à la gare ${esc(de(g.commune))} ?`,
      call: `transports(arret: "gare routière ${esc(g.commune)}")`,
      answer: `Ligne ${esc(a.ligne)} vers ${esc(a.direction)} à ${esc(a.heure)}, puis ligne ${esc(b.ligne)} vers ${esc(b.direction)} à ${esc(b.heure)} (${esc(a.reseau)}${b.reseau !== a.reseau ? `, ${esc(b.reseau)}` : ""}), d'après les horaires publiés.`,
    });
  }
  const p = h?.electricite?.value.production;
  if (p) {
    const top = [...p.parts].sort((x, y) => y.mw - x.mw).slice(0, 2);
    out.push({
      question: "L'électricité vient d'où en ce moment ?",
      call: "electricite()",
      answer: `${Math.round(p.renouvelable_pct)}\u202f% de sources renouvelables, sur ${Math.round(p.total_mw)} MW produits à ${esc(p.heure.split(" ")[1] ?? p.heure)}. ` +
        `En tête : ${top.map((x) => `${esc(x.filiere.split(" (")[0])} (${Math.round(x.part_pct)}\u202f%)`).join(" et ")}, d'après EDF.`,
    });
  }
  return out;
}

/** One exchange, a different one every five minutes. */
function chatDemo(h: HomeLive | null, now: Date): string {
  const all = demos(h, now);
  const d = all.length
    ? all[Math.floor(now.getTime() / 300_000) % all.length]
    : { question: "Le prochain bus à la gare de Saint-Pierre ?", call: `transports(arret: "gare routière Saint-Pierre")`, answer: "Il va chercher la donnée publique du moment, avec son heure et sa source, au lieu de répondre de mémoire." };
  return `<figure class="chat" aria-label="Exemple de conversation avec le connecteur">
    <p class="who"><span class="dot"></span>Exemple, avec les données de maintenant</p>
    <p class="bubble me">${d.question}</p>
    <p class="call">↳ ${d.call}</p>
    <p class="bubble ai">${d.answer}</p>
  </figure>`;
}

function ticker(live: Record<string, Live | undefined>, h: HomeLive | null): string {
  const shown = ["meteo", "vigilance", "volcan", "electricite", "air"]
    .map((k) => ({ c: CATEGORIES.find((c) => c.key === k)!, l: live[k] }))
    .filter((x) => x.l);
  if (!shown.length) return "";
  const at = h?.meteo?.value.stations.reduce((m, s) => (s.time > m ? s.time : m), "");
  return `<div class="wrap"><ul class="ticker" aria-label="En direct">
    <li><span class="dot"></span>En direct${at ? ` · <b>${hm(at)}</b>` : ""}</li>
    ${shown.map((x) => `<li>${esc(x.c.nom)} <b>${x.l!.valeur}</b></li>`).join("\n    ")}
    <li><a href="#en-ce-moment">Toute l'île →</a></li>
  </ul></div>`;
}

function tile(c: Category, l: Live | undefined): string {
  const head = c.path
    ? `<h3><a href="${c.path}">${esc(c.nom)}</a></h3>`
    : `<h3>${esc(c.nom)}</h3>`;
  const now = l
    ? `<p class="tv">${l.valeur}</p><p class="td">${l.detail}</p>`
    : c.exemple
      ? `<p class="tq">« ${esc(c.exemple)} »</p>`
      : `<p class="td">Se met à jour : rechargez la page dans quelques secondes.</p>`;
  const more = c.path ? `<span class="go" aria-hidden="true">Voir →</span>` : `<a href="#assistant">Demandez à votre IA →</a>`;
  return `<li class="tile${c.path ? "" : " wide"}">${icon(c.icon)}${head}${now}<p class="ta">${esc(c.about)}</p>` +
    `<p class="tf"><span>${c.tools.map((t) => `<code>${t}</code>`).join(" ")}</span>${more}</p></li>`;
}

function tiles(live: Record<string, Live | undefined>): string {
  return `<section id="en-ce-moment" aria-labelledby="h-ile">
  <div class="sec-h"><p class="eyebrow">En direct</p>
    <h2 id="h-ile">L'île en ce moment</h2>
    <p>Une page par catégorie, mise à jour toutes les 5 minutes, et un connecteur qui donne tout cela à votre IA. Chaque donnée vient d'un organisme public ou d'un projet ouvert, avec son heure et sa source.</p></div>
  <ul class="tiles" aria-label="Catégories">${CATEGORIES.map((c) => tile(c, live[c.key])).join("")}</ul>
</section>`;
}

function assistant(origin: string, now: Date): string {
  return `<section id="assistant" aria-labelledby="h-assistant">
  <div class="sec-h"><p class="eyebrow">Comment ça marche</p>
    <h2 id="h-assistant">Branché en 2 minutes, gratuit, sans compte</h2>
    <p>Le connecteur suit le protocole ouvert MCP (Model Context Protocol), compris par la plupart des assistants IA. Aucune donnée personnelle n'est collectée.</p></div>
  <div class="card easy">${askHome(origin, now)}</div>
  <p class="or">Ou branchez le connecteur une fois pour toutes, pour que votre IA aille chercher les données toute seule :</p>
  <ol class="steps">
    <li class="card step"><span class="num">1</span><h3>Copiez l'adresse</h3>${connector(origin, "mcp-url")}</li>
    <li class="card step"><span class="num">2</span><h3>Ajoutez-la à votre assistant</h3>
      <div class="tabs">
        <input type="radio" name="app" id="app-chatgpt" checked><label for="app-chatgpt">ChatGPT</label>
        <input type="radio" name="app" id="app-claude"><label for="app-claude">Claude</label>
        <input type="radio" name="app" id="app-gemini"><label for="app-gemini">Gemini</label>
        <input type="radio" name="app" id="app-meta"><label for="app-meta">Meta AI</label>
        <input type="radio" name="app" id="app-lechat"><label for="app-lechat">Le Chat</label>
        <input type="radio" name="app" id="app-local"><label for="app-local">Autres</label>
        <div class="tab t-chatgpt"><p><b>Sur un ordinateur</b>, sur chatgpt.com (le menu n'est pas dans l'appli) : ouvrez <b>Plugins</b> dans le menu de gauche (ou <a href="https://chatgpt.com/plugins">chatgpt.com/plugins</a>), cliquez sur <b>Ajouter</b> en haut à droite, puis <b>Ajouter un serveur MCP personnalisé</b>.</p>
        <p>Nom : <b>rundata.re</b>. Connexion : <b>URL du serveur</b>, collez l'adresse. Authentification : remplacez <b>OAuth</b>, proposé par défaut, par <b>aucune authentification</b>. Cochez <b>Je comprends et souhaite continuer</b>, créez le plugin, puis installez-le. Un message rouge sur OAuth peut rester affiché : il n'empêche pas de continuer.</p>
        <p>Ensuite, dans une conversation (appli comprise), tapez <b>@</b> et choisissez rundata.re. Testé avec l'offre ChatGPT Go. Si le menu Plugins n'apparaît pas sur votre compte, utilisez les boutons « Domann out IA » plus haut.</p></div>
        <p class="tab t-claude"><b>Gratuit</b> (un connecteur personnalisé inclus). Sur <a href="https://claude.ai/">claude.ai</a> dans un navigateur : <b>Personnaliser → Connecteurs → Ajouter un connecteur personnalisé</b>, nom <b>rundata.re</b>, collez l'adresse, puis <b>Ajouter</b>. Il marche ensuite aussi dans l'appli iPhone et Android.</p>
        <p class="tab t-gemini">Pour l'instant, Google réserve les connecteurs personnalisés de Gemini à certains abonnés Google AI Pro ou Ultra aux États-Unis. Si votre compte y a droit : dans Gemini sur le web, ajoutez une application personnalisée et collez l'adresse du serveur MCP.</p>
        <p class="tab t-meta">Meta AI (WhatsApp, Messenger, Instagram) ne permet pas encore d'ajouter un connecteur. En attendant, envoyez-lui le lien de la page de votre commune, par exemple <b>rundata.re/meteo/saint-denis</b>, ou ouvrez-la directement : elle se met à jour toutes les 5 minutes.</p>
        <p class="tab t-lechat">Dans <a href="https://chat.mistral.ai/">Le Chat</a> de Mistral : <b>Connecteurs → Ajouter un connecteur → MCP personnalisé</b>, puis collez l'adresse.</p>
        <p class="tab t-local">Claude Desktop, Cursor, VS Code et autres logiciels compatibles MCP : collez l'adresse comme serveur distant (HTTP).</p>
      </div></li>
    <li class="card step"><span class="num">3</span><h3>Posez votre question</h3>
      <ul class="qs"><li>Le prochain bus à la gare de Saint-Pierre ?</li><li>Il fait quelle température à l'Hermitage ?</li>
      <li>Le volcan est en éruption ?</li><li>La mairie de Saint-Paul est ouverte ?</li></ul></li>
  </ol>
</section>`;
}

const PRINCIPLES = `<section aria-labelledby="h-lire">
  <div class="sec-h"><p class="eyebrow">Bon à savoir</p><h2 id="h-lire">D'où viennent ces données</h2></div>
  <div class="three">
    <div class="card">${icon("gauge")}<h3>Datées et sourcées</h3><p>Chaque valeur vient avec son heure et sa source. Une mesure vient d'un capteur, un horaire est celui que publie le réseau, une prévision vient d'un modèle et porte toujours l'étiquette <span class="badge">Prévision</span>.</p></div>
    <div class="card">${icon("book")}<h3>Des données publiques</h3><p>Météo-France, l'observatoire du Piton de la Fournaise, EDF, Atmo Réunion, les réseaux de bus, l'IGN, service-public.fr : rundata.re ne fait que réunir ce qu'ils publient, sous licence ouverte. L'outil <code>sources_donnees</code> les cite toutes.</p></div>
    <div class="card warn">${icon("alert")}<h3>En cas d'alerte, les autorités d'abord</h3><p>Cyclone, fortes pluies, éruption : seules comptent la vigilance de <a href="https://meteofrance.re/">Météo-France La Réunion</a> et les consignes de la préfecture. La vigilance en cours, zone par zone : <a href="/vigilance">page vigilance</a>.</p></div>
  </div>
</section>`;

export function homePage(origin: string, h: HomeLive | null, now = new Date(), alerte?: Alerte): string {
  const live = lives(h, now);
  const jsonld = [
    { "@context": "https://schema.org", "@type": "WebSite", name: SITE, url: `${origin}/`, inLanguage: "fr-FR" },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "rundata.re, connecteur MCP La Réunion en temps réel",
      description:
        "Serveur MCP (Model Context Protocol) gratuit qui donne à Claude, ChatGPT ou Le Chat les données publiques de La Réunion (974) " +
        "en temps réel : mesures météo, prévisions, vigilance, mer, volcan, électricité, qualité de l'air, services publics, horaires de bus, terrain et risques.",
      url: `${origin}/mcp`,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      inLanguage: "fr-FR",
    },
  ];
  const band = `<div class="wrap intro">
  <div class="pitch">
    <p class="pill">Gratuit · ChatGPT · Claude · Le Chat</p>
    <h1>La Réunion <span class="n974">974</span> en direct, dans votre assistant IA</h1>
    ${SLOGAN}
    <p class="lead">Météo, vigilance, mer, volcan, bus, air, électricité, services publics, terrain : quand vous demandez « le volcan est en éruption ? » ou « le prochain bus à Saint-Pierre ? », votre IA va chercher <b>la donnée publique du moment</b>, datée et sourcée, au lieu de répondre de mémoire.</p>
    ${askHome(origin, now)}
    <p class="or">Ou branchez le connecteur une fois pour toutes (<a href="#assistant">comment faire</a>) :</p>
    ${connector(origin, "mcp-url-top")}
  </div>
  ${chatDemo(h, now)}
</div>
${ticker(live, h)}`;
  const body = `${tiles(live)}
${assistant(origin, now)}
<section id="communes" aria-labelledby="h-communes">
  <div class="sec-h"><p class="eyebrow">Partout sur l'île</p><h2 id="h-communes">Votre commune en direct</h2>
  <p>Pour chaque commune : la météo de sa station, la vigilance de sa zone, son air, sa mer, les prochains bus, sa mairie ouverte ou non. Les cirques, le volcan et les plages ont leur page météo. <a href="/communes">Toutes les communes →</a></p></div>
  ${placeLinks(undefined, true)}
</section>
${PRINCIPLES}`;
  return layout(origin, {
    title: "La Réunion 974 en direct dans votre IA : météo, bus, volcan, air",
    description:
      `🇷🇪 ${brand.slogan} : météo, bus, volcan, vigilance, air, services publics de La Réunion 974, en direct dans ` +
      "ChatGPT, Claude ou Le Chat. Gratuit, sans compte.",
    path: "/",
    jsonld,
    alerte,
  }, band, body);
}
