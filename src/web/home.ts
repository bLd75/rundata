/**
 * The home page: what rundata.re is, the island right now (one tile per category, from each category page's last
 * copy), how to add the connector to an assistant, and the page of each commune.
 */
import { alerteVolcan, homeCard, volcanBanner } from "./volcan-alerte.js";
import type { Cached } from "../cache.js";
import type * as mf from "../providers/vigilance.js";
import { PATH as A_PROPOS, QUI } from "./a-propos.js";
import icons from "./icons.json" with { type: "json" };
import { byUse, CATEGORIES, type Category, FIRST, type Urgent, urgentKeys } from "./categories.js";
import type { ActualitesAnswer, AgendaAnswer, AirAnswer, Alerte, BusData, CalendrierAnswer, CruesAnswer, ElectriciteAnswer, HomeData, VelosAnswer, VolcanAnswer, BornesAnswer, CoupuresAnswer, EauAnswer, SecheresseAnswer, SentiersAnswer, SportAnswer, CyclonesAnswer, HistoriqueAnswer, TraficAnswer } from "./data.js";
import { actualitesLive, airLive, atDay, bornesLive, cruesLive, floodRaised, imageLinks, busLive, coupuresLive, daeLive, eauLive, secheresseLive, randonneesLive, traficLive, sportLive, cyclonesLive, historiqueLive, agendaLive, calendrierLive, electriciteLive, velosLive, volcanLive, saidNow, stillToCome } from "./domains.js";
import { de } from "../tools/format.js";
import { enImagesApres, enImagesLuesAilleurs, jusquALecture, NON_ANNONCEE } from "../tools/volcan.js";
import { libelle } from "../tools/volcan-acces.js";
import { enfantsLive } from "./enfants.js";
import { esc, fenetre, islandMap, type Marker } from "./map.js";
import {
  ask,
  chip,
  coldest,
  connector,
  DATAGOUV_REUSE,
  deg,
  follow,
  followed,
  GLAMA,
  hm,
  icon,
  layout,
  type Live,
  merLive,
  meteoLive,
  metres,
  since,
  placeLinks,
  shortName,
  stationId,
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
  trafic?: Cached<TraficAnswer> | null;
  velos?: Cached<VelosAnswer> | null;
  bornes?: Cached<BornesAnswer> | null;
  eau?: Cached<EauAnswer> | null;
  sentiers?: Cached<SentiersAnswer> | null;
  secheresse?: Cached<SecheresseAnswer> | null;
  coupures?: Cached<CoupuresAnswer> | null;
  sport?: Cached<SportAnswer> | null;
  cyclones?: Cached<CyclonesAnswer> | null;
  historique?: Cached<HistoriqueAnswer> | null;
  agenda?: Cached<AgendaAnswer> | null;
  actualites?: Cached<ActualitesAnswer> | null;
  crues?: Cached<CruesAnswer> | null;
}

function lives(h: HomeLive | null, now: Date): Record<string, Live | undefined> {
  return {
    meteo: meteoLive(h?.meteo ?? null, now),
    vigilance: vigilanceLive(h?.vigilance ?? null, now),
    crues: cruesLive(h?.crues ?? null, now),
    mer: merLive(h?.meteo ?? null, now),
    volcan: volcanLive(h?.volcan ?? null, now),
    bus: busLive(h?.bus ?? null, now),
    trafic: traficLive(h?.trafic ?? null),
    velos: velosLive(h?.velos ?? null, now),
    bornes: bornesLive(h?.bornes ?? null, now),
    eau: eauLive(h?.eau ?? null, now),
    sentiers: randonneesLive(h?.sentiers ?? null),
    secheresse: secheresseLive(h?.secheresse ?? null),
    coupures: coupuresLive(h?.coupures ?? null),
    sport: sportLive(h?.sport ?? null),
    cyclones: cyclonesLive(h?.cyclones ?? null),
    historique: historiqueLive(h?.historique ?? null, now),
    agenda: agendaLive(h?.agenda ?? null),
    actualites: actualitesLive(h?.actualites ?? null),
    air: airLive(h?.air ?? null, now),
    electricite: electriciteLive(h?.electricite ?? null, now),
    calendrier: calendrierLive(h?.calendrier ?? null, now),
    // The bundled places: always there, nothing to fetch. The playgrounds, parks and pools first, not the most numerous
    // (the skateparks and city stadiums).
    enfants: enfantsLive(undefined, ["aire_de_jeux", "parc", "piscine"]),
    dae: daeLive(),
  };
}

/** The buttons that send the question to an assistant, with no connector: on the home page and on /mcp. */
export function askHome(origin: string): string {
  const url = `${origin}/`;
  return ask(`Kwélafé La Rényon astèr ? Gèt si ${url} é di amwin lo tan, lo volkan, lo kouran é lo bis.`,
    `Que se passe-t-il en ce moment à La Réunion ? Lis ${url} et résume-moi la météo, la vigilance, le volcan, l'électricité, l'air et les bus, avec l'heure des données.`);
}

interface Demo {
  question: string;
  call: string;
  answer: string;
}

/** Sample exchanges, each answered with the data of the moment: what the connector changes, shown. */
export function demos(h: HomeLive | null, now: Date): Demo[] {
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
      answer: `${thin(deg(s.temperature!))}, mesurés à ${hm(s.time)} (${since(s.time, now)}) par ${by} ${esc(s.nom)}, ` +
        `à ${metres(s.altitude_m)} d'altitude.${windText(s) ? ` ${esc(thin(windText(s)!.replace(/^vent/, "Vent")))}.` : ""}`,
    });
  }
  const e = h?.volcan?.value.etat;
  if (e) {
    const q = typeof h!.volcan!.value.seismes === "object" ? h!.volcan!.value.seismes : undefined;
    const p0 = Array.isArray(h!.volcan!.value.publications_ovpf) ? h!.volcan!.value.publications_ovpf[0] : undefined;
    out.push({
      question: "Le volcan est en éruption ?",
      call: "volcan_seismes()",
      // In alert, never « pas encore » on our word: what the texts read say, then the level in the plan's words (marketing).
      answer: (!e.eruption_en_cours && /^Alerte/.test(e.niveau_orsec)
        ? `${esc(NON_ANNONCEE)}${e.image_ovpf_plus_recente && p0?.lien ? ` ${esc((p0.texte_lu_dans_l_image ? enImagesLuesAilleurs : enImagesApres)(...(p0.date.split(" ") as [string, string])))} : ${imageLinks(p0.lien)}.` : ""} Le volcan est en ${esc(e.niveau_orsec.toLowerCase())}${libelle(e.niveau_orsec) ? ` : « ${esc(libelle(e.niveau_orsec)!)} » (dispositif ORSEC Volcan)` : ""}.`
        : e.eruption_en_cours
        ? `Oui, le Piton de la Fournaise est en éruption (niveau ORSEC : ${esc(e.niveau_orsec)}).`
        // What the texts read say, with when, never « Non » on our word nor pitonlive's (marketing).
        : `Pas d'éruption annoncée par l'OVPF ni par la préfecture dans les textes que nous avons lus (${hm(h!.volcan!.fetchedAt)}).${e.niveau_inconnu ? "" : ` Niveau ORSEC : ${esc(e.niveau_orsec)}.`}`) +
        (q ? ` L'observatoire a localisé ${q.sous_le_volcan["7_jours"]} séisme${q.sous_le_volcan["7_jours"] > 1 ? "s" : ""} sous le volcan en 7 jours${q.lus_jusqu_au ? `, ${esc(jusquALecture(q.lus_jusqu_au))}` : ""}.` : ""),
    });
  }
  const bus = h?.bus;
  const next = bus?.value.gares.map((g) => ({ g, left: stillToCome(g.departs, bus.fetchedAt, now) })).find(({ left }) => left.length >= 2);
  if (next) {
    const { g } = next;
    const [a, b] = next.left.map(({ x, at }) => ({ ...x, heure: atDay(saidNow(x.heure, at, now)) }));
    out.push({
      question: `Le prochain bus à la gare ${esc(de(g.commune))} ?`,
      call: `transports(arret: "gare routière ${esc(g.commune)}")`,
      answer: `Ligne ${esc(a.ligne)} vers ${esc(a.direction)} ${esc(a.heure)}, puis ligne ${esc(b.ligne)} vers ${esc(b.direction)} ${esc(b.heure)} (${esc(a.reseau)}${b.reseau !== a.reseau ? `, ${esc(b.reseau)}` : ""}), d'après les horaires publiés.`,
    });
  }
  const p = h?.electricite?.value.production;
  if (p) {
    const top = [...p.parts].sort((x, y) => y.mw - x.mw).slice(0, 2);
    out.push({
      question: "L'électricité vient d'où en ce moment ?",
      call: "electricite()",
      answer: `${Math.round(p.renouvelable_pct)}\u202f% de sources renouvelables, sur ${Math.round(p.total_mw)} MW produits à ${esc(p.heure_mesure.split(" ")[1] ?? p.heure_mesure)}. ` +
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

/** The time of day in La Réunion (UTC+4), for the sky of the hero. */
export function sky(now: Date): "nuit" | "aube" | "jour" | "soir" {
  const h = (now.getUTCHours() + 4) % 24;
  return h < 5 || h >= 19 ? "nuit" : h < 7 ? "aube" : h < 17 ? "jour" : "soir";
}

/**
 * The figures of the moment under the title, two by two: the vigilance and the volcano while in force, then the
 * events, the hikes, the weather and the air, an even number with both alerts or none. One missing for want of its
 * data, or one alert alone: the last box is as wide as the grid, as high as the others.
 */
function facts(live: Record<string, Live | undefined>, u: Urgent): string {
  const shown = [...urgentKeys(u), ...FIRST, "air"]
    .map((k) => ({ c: CATEGORIES.find((c) => c.key === k)!, l: live[k] }))
    .filter((x) => x.l && !x.l.vide);
  if (!shown.length) return "";
  return `<ul class="facts-live" aria-label="En ce moment">${shown
    .map((x) => `<li class="k-${x.c.key}"><a href="${x.c.path}">${icon(x.c.icon)}<span>${esc(x.c.nom)}</span><b>${x.l!.valeur}</b>${x.l!.source ? `<small>${x.l!.source}</small>` : ""}</a></li>`)
    .join("")}</ul>`;
}

/** The island with the temperatures measured now, as on the weather page. */
/**
 * The hero's badge says when the stations measured, never « en direct » at a time that may be past: the page is a copy
 * up to a few minutes old. With the script, the time at La Réunion now and the age of the measures, counted again.
 */
function livePill(at: string | undefined, now: Date): string {
  if (!at) return `<p class="live-pill"><span class="dot"></span>La Réunion en direct</p>`;
  return `<p class="live-pill"><span class="dot"></span><span data-nojs>Mesures de <b>${hm(at)}</b> à La Réunion</span>` +
    `<span data-js hidden><b data-clock>${hm(now)}</b> à La Réunion · mesuré ${since(at, now)}</span></p>`;
}

function heroMap(h: HomeLive | null): string {
  const l = withTemp(h?.meteo ?? null);
  const at = h?.meteo?.value.stations.reduce((m, s) => (s.time > m ? s.time : m), "");
  // Each temperature leads to its station's row on the weather page.
  const markers: Marker[] = l.map((s) => ({ lon: s.lon, lat: s.lat, label: `${Math.round(s.temperature!)}°`, say: `${Math.round(s.temperature!)} °C`, name: shortName(s.nom), color: chip(s.temperature!), round: true, href: `/meteo#${stationId(s.nom)}` }));
  return `<figure class="hero-map">${islandMap({ markers, relief: true, label: `Carte de La Réunion (974)${at ? ` avec les températures mesurées à ${hm(at)}` : ""}` })}` +
    `<figcaption>${at ? `<span class="dot"></span>Températures mesurées à ${hm(at)} · <a href="/meteo">toutes les stations →</a>` : "Les stations publient toutes les 6 minutes."}</figcaption></figure>`;
}

function tile(c: Category, l: Live | undefined, odd = false): string {
  const name = c.path ? `<h3><a href="${c.path}">${esc(c.nom)}</a></h3>` : `<h3>${esc(c.nom)}</h3>`;
  const now = l?.vide
    ? `<p class="td all">${l.detail}</p>`
    : l
    ? `<p class="tv">${l.valeur}</p><p class="td${l.entier ? " all" : ""}">${l.detail}</p>`
    : c.exemple
      ? `<p class="tq">« ${esc(c.exemple)} »</p>`
      // No copy at all: the read is under way (a copy with nothing to show says so, `vide`).
      : `<p class="td all">Se met à jour : rechargez la page dans quelques secondes.</p>`;
  const more = c.path ? `<span class="go" aria-hidden="true">→</span>` : "";
  const foot = c.path ? "" : `<a class="tl" href="#assistant">Demandez à votre IA →</a>`;
  return `<li class="tile k-${c.key}${c.path ? "" : " wide"}${odd ? " odd" : ""}"><div class="th"><span class="kb">${icon(c.icon)}</span>${name}${more}</div>${now}` +
    `<p class="ta">${esc(c.about)}</p>${foot}</li>`;
}

// On a phone the tiles go two by two: an odd one out at the end of those with a page takes the whole row.
const PAGED = CATEGORIES.filter((c) => c.path).length;

const NOW_MAX = 4;
const NOW_HOURS = 6;

/** On a day of mobilisation, of a cyclone or an eruption: the newest headlines, above the tiles. */
function happening(h: HomeLive | null, now: Date): string {
  const d = h?.actualites?.value;
  if (!d?.chaud) return "";
  const since = new Date(now.getTime() - NOW_HOURS * 3600_000).toISOString();
  const rows = [...d.en_direct, ...d.infos.filter((r) => r.sujets?.includes("mobilisation") || r.sujets?.includes("route"))]
    .filter((r) => r.publie >= since).sort((x, y) => (x.publie < y.publie ? 1 : x.publie > y.publie ? -1 : 0)).slice(0, NOW_MAX);
  if (!rows.length) return "";
  return `<div class="card warn now-news"><h3>${icon("news")} En ce moment sur l'île</h3><ul class="plain">${rows.map((r) =>
    `<li><b>${hm(r.publie)}</b> <a href="${esc(r.lien)}" rel="noopener"${fenetre(r.lien)}>${esc(r.titre)}</a> <span class="note">${esc(r.media)}${r.communes?.length ? ` · ${esc(r.communes.join(", "))}` : ""}</span></li>`).join("")}</ul>` +
    `<p class="note"><a href="/actualites">Toute l'actualité, commune par commune →</a></p></div>`;
}

function tiles(live: Record<string, Live | undefined>, u: Urgent, news = ""): string {
  // In the order of the menu, but the traffic, a quiet vigilance and a quiet volcano at the end, before the sea and the
  // buses; those without a page after them all.
  const all = [...byUse(CATEGORIES.filter((c) => c.path), u, true), ...CATEGORIES.filter((c) => !c.path)];
  return `<section id="en-ce-moment" aria-labelledby="h-ile">
  <div class="sec-h"><p class="eyebrow">En direct</p>
    <h2 id="h-ile">L'île en ce moment</h2>
    <p>Une page par sujet, mise à jour en continu. Chaque donnée vient d'un organisme public ou d'un projet ouvert, avec son heure et sa source.</p></div>
  ${news}
  <ul class="tiles" aria-label="Catégories">${all.map((c, i) => tile(c, live[c.key], i === PAGED - 1 && PAGED % 2 === 1)).join("")}</ul>
</section>`;
}

function assistant(origin: string, h: HomeLive | null, now: Date): string {
  return `<section id="assistant" aria-labelledby="h-assistant">
  <div class="sec-h"><p class="eyebrow">Comment ça marche</p>
    <h2 id="h-assistant">Branché en 2 minutes, gratuit, sans compte</h2>
    <p>Le connecteur suit le protocole ouvert MCP (Model Context Protocol), compris par la plupart des assistants IA. Il ne reçoit que la question posée à l'outil, par exemple «\u00a0Saint-Paul\u00a0», jamais votre conversation.</p></div>
  <div class="duo"><div class="card easy">${askHome(origin)}</div>${chatDemo(h, now)}</div>
  <p class="or">Ou branchez le connecteur une fois pour toutes, pour que votre IA aille chercher les données toute seule :</p>
  ${connectSteps(origin)}
</section>`;
}

/** The three steps to plug the connector, assistant by assistant: on the home page and on /mcp. */
export function connectSteps(origin: string): string {
  return `<ol class="steps">
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
        <p>Ensuite, dans une conversation (appli comprise), nommez rundata.re dans la question, par exemple <b>« Avec rundata.re : il fait combien à Cilaos en ce moment ? »</b>, ou tapez <b>@</b> et choisissez rundata.re. Sinon, ChatGPT peut répondre avec sa propre météo, sans station ni heure de mesure. Testé avec l'offre ChatGPT Go. Si le menu Plugins n'apparaît pas sur votre compte, utilisez les boutons « Domann out IA » plus haut.</p>
        <p><b>Des outils manquent ?</b> ChatGPT garde la liste d'outils du jour où vous avez ajouté le connecteur. Sur chatgpt.com (pas dans l'appli), ouvrez <b>Paramètres → Intégrations → Plugins</b>, cliquez sur rundata.re, puis, en bas, dans <b>Gérer l'application</b>, sur <b>Actualiser les outils</b>, et commencez une nouvelle conversation. Pas de bouton ? Sur la même page, <b>Supprimer l'application</b> (ou <b>Désinstaller</b> en haut), puis ajoutez-la de nouveau. Dans un espace Business ou Enterprise, c'est l'administrateur qui actualise dans les réglages de l'espace, puis coche les nouveaux outils.</p></div>
        <p class="tab t-claude"><b>Gratuit</b> (un connecteur personnalisé inclus). Sur <a href="https://claude.ai/">claude.ai</a> dans un navigateur : <b>Personnaliser → Connecteurs → Ajouter un connecteur personnalisé</b>, nom <b>rundata.re</b>, collez l'adresse, puis <b>Ajouter</b>. Il marche ensuite aussi dans l'appli iPhone et Android.</p>
        <p class="tab t-gemini">Pour l'instant, Google réserve les connecteurs personnalisés de Gemini à certains abonnés Google AI Pro ou Ultra aux États-Unis. Si votre compte y a droit : dans Gemini sur le web, ajoutez une application personnalisée et collez l'adresse du serveur MCP.</p>
        <p class="tab t-meta">Meta AI (WhatsApp, Messenger, Instagram) ne permet pas encore d'ajouter un connecteur. En attendant, envoyez-lui le lien de la page de votre commune, par exemple <b>rundata.re/meteo/saint-denis</b>, ou ouvrez-la directement : elle se met à jour en continu, chaque donnée avec son heure et sa source.</p>
        <p class="tab t-lechat">Dans <a href="https://chat.mistral.ai/">Le Chat</a> de Mistral : <b>Connecteurs → Ajouter un connecteur → MCP personnalisé</b>, puis collez l'adresse.</p>
        <p class="tab t-local">Claude Desktop, Cursor, VS Code et autres logiciels compatibles MCP : collez l'adresse comme serveur distant (HTTP).</p>
      </div></li>
    <li class="card step"><span class="num">3</span><h3>Posez votre question</h3>
      <ul class="qs"><li>Le prochain bus à la gare de Saint-Pierre ?</li><li>Il fait quelle température à l'Hermitage ?</li>
      <li>Le volcan est en éruption ?</li><li>La mairie de Saint-Paul est ouverte ?</li></ul></li>
  </ol>`;
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
      "@type": "Organization",
      name: SITE,
      url: `${origin}/`,
      // Square, at least 112 px and readable on white, as Google asks of a logo: the symbol's tile, not the share picture.
      logo: `${origin}${icons["512"]}`,
      email: "contact@rundata.re",
      description: QUI,
      foundingDate: "2026-10",
      areaServed: { "@type": "AdministrativeArea", name: "La Réunion" },
      publishingPrinciples: `${origin}${A_PROPOS}#engagements`,
      contactPoint: { "@type": "ContactPoint", email: "contact@rundata.re", contactType: "presse", availableLanguage: "fr" },
      sameAs: [...followed().map((s) => s.url), DATAGOUV_REUSE, GLAMA],
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "rundata.re, connecteur MCP La Réunion en direct",
      description:
        "Serveur MCP (Model Context Protocol) gratuit qui donne à Claude, ChatGPT ou Le Chat les données publiques de La Réunion (974) " +
        "en direct : sorties et événements, randonnée, mesures météo, prévisions, vigilance, routes, volcan, mer, électricité, qualité de l'air, services publics, horaires de bus, terrain et risques.",
      url: `${origin}/mcp`,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      inLanguage: "fr-FR",
    },
  ];
  const at = h?.meteo?.value.stations.reduce((m, st) => (st.time > m ? st.time : m), "");
  // An alert at the volcano goes first, above the weather, in place of the banner of the other pages; the banner's own
  // read when the home page's copy of /volcan is missing.
  const fire = alerteVolcan(h?.volcan?.value) ?? volcanBanner();
  const u = { vigilance: !!alerte, crues: floodRaised(h?.crues?.value).length > 0, volcan: !!fire };
  const band = `${fire ? homeCard(fire) : ""}<div class="hero sky-${sky(now)}"><div class="wrap hero-in">
  <div class="hero-txt">
    ${livePill(at, now)}
    <h1>La Réunion <span class="n974">974</span> en direct</h1>
    ${SLOGAN}
    <p class="lead">Sorties, randos, météo, routes : la donnée publique du moment, datée et sourcée, pour vous et pour <b>votre assistant IA</b>.</p>
    <p class="hero-cta"><a class="btn sun" href="#en-ce-moment">Voir l'île</a><a class="btn glass" href="#assistant">${icon("spark")}Brancher mon IA</a></p>
    ${follow(undefined, "social hero-follow")}
    ${facts(live, u)}
  </div>
  ${heroMap(h)}
</div></div>`;
  const body = `${tiles(live, u, happening(h, now))}
${assistant(origin, h, now)}
<section id="communes" aria-labelledby="h-communes">
  <div class="sec-h"><p class="eyebrow">Partout sur l'île</p><h2 id="h-communes">Votre commune en direct</h2>
  <p>Pour chaque commune : ses prochaines sorties, ses sentiers, la météo de sa station et sa mairie ouverte ou non ; la mer, les bus et le reste sont sur sa page. Les cirques, le volcan et les plages ont leur page météo. <a href="/communes">Toutes les communes →</a></p></div>
  ${placeLinks(undefined, true)}
</section>
${PRINCIPLES}`;
  return layout(origin, {
    title: "La Réunion 974 en direct : météo, routes, rando, sorties",
    description:
      "Sorties, randos, météo mesurée, routes\u00a0: les données publiques de La Réunion 974 en direct, datées et sourcées. " +
      "Gratuit, sans compte, aussi dans votre IA.",
    path: "/",
    jsonld,
    alerte,
    volcan: !!fire,
  }, band, body);
}
