/**
 * One page per category of the connector besides the weather: the volcano, the air, the electricity, the calendar and
 * the buses. Each shows what the tool of the same name answers right now, so that people, search engines and the
 * assistants reading a page see it, and points to the connector for the rest. Each also says it in a few words for
 * its tile on the home page.
 */
import { PREFECTURE } from "../providers/volcan.js";
import { ENCLOS_SAID, IMAGE_APRES, LOCALISES } from "../tools/volcan.js";
import { type Ligne, libelle, NIVEAUX, TITRE, VERSION } from "../tools/volcan-acces.js";
import { alertSections, alerteVolcan, CONSIGNES, ENCLOS, tileLive, volcanBanner, volcanH1, volcanLead, volcanMeta, volcanTitle } from "./volcan-alerte.js";
import { CINEMAS } from "../tools/agenda.js";
import type { Cached } from "../cache.js";
import * as historique from "../tools/volcan-historique.js";
import { normalize } from "../places/resolve.js";
import * as traces from "../providers/traces.js";
import { SUJETS } from "../providers/actualites.js";
import * as littoral from "../tools/littoral.js";
import { longDate, UNPUBLISHED } from "../tools/calendrier.js";
import type { CourantRow } from "../tools/courant.js";
import { de, fr } from "../tools/format.js";
import * as fire from "../tools/feux.js";
import * as feux from "../providers/feux.js";
import { COMMUNES as BIKE_COMMUNES } from "../tools/velos.js";
import { LATE_MIN, type ActualitesAnswer, type AgendaAnswer, type AirAnswer, type Alerte, type BorneStation, type BornesAnswer, type BusData, type CalendrierAnswer, type CoupuresAnswer, type CyclonesAnswer, type DaeAnswer, type EauAnswer, type ElectriciteAnswer, type HikeCard, type HistoriqueAnswer, type HourlyAnswer, type RandonneesAnswer, type SecheresseAnswer, type SentiersAnswer, type SportAnswer, type TraceAnswer, type TraficAnswer, type TrailItem, type VeloStation, type VelosAnswer, type VolcanAnswer } from "./data.js";
import { FAST_KW } from "../tools/bornes.js";
import { fuelSay, keep } from "../tools/carburants.js";
import { SECTEURS as SECTEURS_RANDO, secteurNamed, type Secteur } from "../traces/secteurs.js";
import island from "../places/island.json" with { type: "json" };
import rubriques from "./og-rubriques.json" with { type: "json" };
import { esc, hikesMap, islandMap, oceanMap, profile, traceMap } from "./map.js";
import { cloudSeaLink, forecastLinks, type Summit, weatherForTrace } from "./liens.js";
import { LINE as BAIGNADE_LINE } from "./baignade.js";
import { T as FERRY } from "../tools/ferries.js";
import { ask, credits, DESCRIPTION_MAX, hm, icon, ISLAND, layout, type Live, SITE } from "./pages.js";
import { PASSES } from "../historique/cyclones-passes.js";
import { cycloneWater } from "./eau-cyclone.js";

const FOURNAISE = { lon: 55.7083, lat: -21.2444, name: "Piton de la Fournaise" };
// What a search engine shows of a title.
const TITLE_MAX = 60;

/** `full` when it fits in what search engines show, else `short`. */
const describe = (full: string, short: string) => (full.length <= DESCRIPTION_MAX ? full : short);

function crumbs(origin: string, name: string, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE, item: `${origin}/` },
      { "@type": "ListItem", position: 2, name, item: `${origin}${path}` },
    ],
  };
}

function webPage(origin: string, path: string, title: string, description: string, data: Cached<unknown> | null) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    inLanguage: "fr-FR",
    url: `${origin}${path}`,
    ...(data ? { dateModified: data.fetchedAt.toISOString() } : {}),
    about: ISLAND,
  };
}

const crumbBar = (label: string) =>
  `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li aria-current="page">${esc(label)}</li></ol></nav></div>`;

/** What to say while the data of a page is not there yet. */
const loading = (what: string) => `<p class="lead">${esc(what)} se charge : rechargez la page dans quelques secondes.</p>`;

const sourcesNote = (list: { source: string; licence: string; attribution: string }[], data: Cached<unknown>) =>
  `<p class="note">Sources : ${credits(list)}. Mis à jour à ${hm(data.fetchedAt)}.</p>`;

const warnings = (list: string[]) =>
  list.length ? `<div class="card warn">${icon("alert")}<h3>À savoir</h3><ul class="plain">${list.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : "";

/** The connector, at the end of every domain page. */
const connectorCta = (tool: string, what: string) => `<section aria-labelledby="h-ia">
  <div class="card cta"><h2 id="h-ia">Votre IA, branchée sur ${esc(what)}</h2>
  <p>Avec le connecteur, votre assistant lit lui-même ces données (outil <code>${esc(tool)}</code>), et toutes les autres de l'île : météo, mer, volcan, air, électricité, bus, services publics, terrain. Gratuit, sans compte. <a href="/#assistant">Comment le brancher</a>.</p></div>
</section>`;

// ---------------------------------------------------------------- volcan

const ACCESS: Record<string, string> = { ouvert: "ouvert", partiel: "partiellement ouvert", ferme: "fermé", fermé: "fermé" };
const md = (m: number | null) => (m == null ? "—" : fr(Math.round(m * 10) / 10));
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Indian/Reunion" });

// Where the prefecture publishes each phase of the ORSEC volcano plan.
const GOUV = `<a href="${PREFECTURE.url}">reunion.gouv.fr</a>`;

/** `news`: the news copy, read during an alert only, for what the media say of it. */
export function volcanPage(origin: string, data: Cached<VolcanAnswer> | null, now = new Date(), alerte?: Alerte, news?: ActualitesAnswer): string {
  const d = data?.value;
  const a = alerteVolcan(d);
  const e = d?.etat;
  const q = d?.seismes;
  const url = `${origin}/volcan`;

  const status = !d
    ? loading("L'état du volcan")
    : `<div class="status">` +
      (e
        ? (a
          ? `<p class="lead"><b>${esc(volcanLead(a))}</b></p>`
          : e.niveau_inconnu && !e.eruption_en_cours ? "" : `<p class="big">${e.eruption_en_cours ? "Éruption en cours" : "Pas d'éruption en cours"}</p>`) +
          (e.niveau_inconnu
            // The prefecture's phase not read, none kept: the level is not given (tools/volcan.ts), and why (marketing).
            ? `<p class="lead">Pas d'éruption en cours au Piton de la Fournaise selon pitonlive.com. Nous n'avons pas pu lire le niveau d'alerte de la préfecture : vérifiez-le sur ${GOUV} avant de monter au volcan.`
            : `<p class="lead">Niveau du dispositif ORSEC volcan : <b>${esc(e.niveau_orsec)}</b>${e.ecart_pitonlive && e.communique_prefecture
              ? ` selon le dernier communiqué de la préfecture que nous avons lu (${esc(dayOf(e.communique_prefecture.publie))}). pitonlive.com indique « ${esc(e.ecart_pitonlive.niveau)} » depuis le ${esc(dayOf(e.ecart_pitonlive.depuis))} : vérifiez le niveau en vigueur sur ${GOUV}`
              : ""}.`) +
          (e.niveau_definition ? ` <span class="note">${esc(e.niveau_definition)}</span>` : "") +
          (!e.eruption_en_cours && e.derniere_eruption_fin ? ` Dernière éruption terminée le <b>${esc(dayOf(e.derniere_eruption_fin))}</b>.` : "") +
          (e.deformation ? ` Déformation du volcan : ${esc(e.deformation)}.` : "") + `</p>` +
          (e.ecart_pitonlive && e.communique_prefecture && e.acces_enclos
            // pitonlive lower for long: the Enclos as the prefecture's release said it, and where it comes from (marketing).
            ? `<p class="lead">Accès à l'Enclos <b>${esc(ENCLOS_SAID[e.acces_enclos.statut] ?? e.acces_enclos.statut)}</b> selon le communiqué du ${esc(dayOf(e.communique_prefecture.publie))} : vérifiez sur ${GOUV} avant de partir.</p>`
            : a ? `<p class="lead"><b>${esc(ENCLOS)}</b></p>` : e.niveau_inconnu ? `<p class="lead">Accès à l'Enclos : à vérifier sur ${GOUV}, avant de partir.</p>` : e.acces_enclos ? `<p class="lead">Accès à l'Enclos : <b>${esc(ACCESS[e.acces_enclos.statut] ?? e.acces_enclos.statut)}</b>.</p>` : "") +
          (e.image_ovpf_plus_recente ? `<p class="lead">${esc(IMAGE_APRES)}</p>` : "")
        : `<p class="lead">${esc(d.resume)}</p>`) +
      (q ? `<p class="lead">Séismes localisés par l'OVPF sous le volcan : <b>${q.sous_le_volcan["7_jours"]}</b> en 7 jours, <b>${q.sous_le_volcan["30_jours"]}</b> en 30 jours.</p>` : "") +
      `</div>`;

  // During an alert the Enclos is closed by order, whatever another source says (marketing's rule: never « partiel »).
  const enclos = a
    ? `<div class="card">${icon("mountain")}<h3>${esc(ENCLOS)}</h3><p>${esc(CONSIGNES)}</p></div>`
    : e?.acces_enclos
    ? `<div class="card">${icon("mountain")}<h3>Accès à l'Enclos : ${esc(ACCESS[e.acces_enclos.statut] ?? e.acces_enclos.statut)}</h3>` +
      (e.acces_enclos.detail ? `<p>${esc(e.acces_enclos.detail)}</p>` : "") +
      (e.acces_enclos.source ? `<p class="note">${e.acces_enclos.lien ? `<a href="${esc(e.acces_enclos.lien)}">${esc(e.acces_enclos.source)}</a>` : esc(e.acces_enclos.source)}</p>` : "") +
      `</div>`
    : "";

  const quakes = q
    ? `<div class="card">${icon("gauge")}<h3>Séismes localisés par l'OVPF</h3>` +
      quakeDays(q.par_jour_sous_le_volcan, !!e?.image_ovpf_plus_recente) +
      `<p class="facts"><span>Sous le volcan : <b>${q.sous_le_volcan["30_jours"]}</b> en 30 jours, magnitude max ${md(q.sous_le_volcan.magnitude_max_30j)}</span>` +
      `<span>Ailleurs sur l'île : <b>${q.ailleurs_sur_l_ile["30_jours"]}</b>, magnitude max ${md(q.ailleurs_sur_l_ile.magnitude_max_30j)}</span></p>` +
      (q.derniers.length
        ? `<ul class="rows">${q.derniers.map((s) => `<li><b>${esc(md(s.magnitude))}</b><span>${esc(s.lieu)}, ${esc(fr(Math.max(0, s.profondeur_km)))} km de profondeur</span><span class="note">${esc(s.heure.replace(" heure de La Réunion", ""))}</span></li>`).join("")}</ul>`
        : "") +
      `<p class="note">${esc(q.note)}</p></div>`
    : "";

  // The alerts before this one, from the releases (tools/volcan-historique.ts): the same list whatever the copy says.
  const moment = (m: historique.Moment) =>
    // Non-breaking spaces inside the quotes and before the colon: a lone « at the end of a line at 390 px (marketing).
    `<li><b>${esc(historique.date(m.jour))}</b>, ${esc(m.quoi)}\u00a0: «\u00a0${esc(m.dit)}\u00a0» <a href="${esc(m.communique.copie)}">${esc(historique.label(m.communique))} →</a></li>`;
  const before = `<section id="alertes-precedentes" aria-labelledby="h-alertes"><div class="sec-h"><h2 id="h-alertes">${esc(historique.TITRE)}</h2><p>${esc(historique.CHAPEAU)}</p></div>
  <ul class="posts">${historique.EPISODES.map((x) => `<li class="card"><p class="note">Début</p><ul class="plain">${x.debut.map(moment).join("")}</ul><p class="note">Fin</p><ul class="plain">${moment(x.fin)}</ul></li>`).join("")}</ul>
  <p class="note">${esc(historique.NOTE)}</p></section>
`;

  const posts = d?.publications_ovpf?.length
    ? `<section aria-labelledby="h-ovpf"><div class="sec-h"><p class="eyebrow">L'observatoire</p><h2 id="h-ovpf">Ce que publie l'OVPF</h2>
  <p>Les derniers messages de l'Observatoire volcanologique du Piton de la Fournaise (IPGP), repris tels quels.</p></div>
  <ul class="posts">${d.publications_ovpf.slice(0, 4).map((p) => `<li class="card"><p class="note">${esc(p.date)}</p><p>${esc(p.texte)}</p>${p.lien ? `<p><a href="${esc(p.lien)}">Lire le message →</a></p>` : ""}</li>`).join("")}</ul></section>`
    : "";

  // In vigilance as the prefecture or pitonlive gives it (never an unread level), the level and the plan's words; the
  // level in lower case within a sentence, « Vigilance volcanique » opening the title after its colon (marketing).
  const vigilance = !a && e && !e.niveau_inconnu && e.niveau_orsec === "Vigilance" ? libelle("Vigilance") : undefined;
  const title = a ? volcanTitle(a) : vigilance ? "Piton de la Fournaise : Vigilance volcanique · 974" : "Piton de la Fournaise en direct : éruption, Enclos, séismes · 974";
  const description = a
    ? volcanMeta(a)
    : d && e
    ? describe(
        `🇷🇪 Piton de la Fournaise (La Réunion, 974) : ${e.eruption_en_cours ? "éruption en cours" : "pas d'éruption en cours"}, niveau ORSEC ${e.niveau_orsec}` +
          `${e.acces_enclos ? `, Enclos ${ACCESS[e.acces_enclos.statut] ?? e.acces_enclos.statut}` : ""}` +
          `${q ? `, ${q.sous_le_volcan["7_jours"]} séismes localisés par l'OVPF sous le volcan en 7 jours` : ""}.`,
        "🇷🇪 Piton de la Fournaise (La Réunion, 974) en direct : éruption ou non, accès à l'Enclos, séismes localisés par l'OVPF.",
      )
    : "🇷🇪 Piton de la Fournaise (La Réunion, 974) en direct : éruption ou non, accès à l'Enclos, séismes localisés par l'OVPF.";

  const band = `${crumbBar("Volcan")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Volcan en direct</p>
    <h1>${a ? esc(volcanH1(a)) : vigilance ? esc(`Piton de la Fournaise : vigilance, ${vigilance}`) : `Piton de la Fournaise <span class="n974">974</span>`}</h1>
    ${status}
    ${ask(`Lo volkan lé an érupsion astèr ? Rogard si ${url} é di amwin si lanklo lé ouvèr.`,
      `Le Piton de la Fournaise est-il en éruption ? Lis ${url} et dis-moi aussi si l'Enclos est ouvert.`)}
  </div>
  <figure class="card mapcard">${islandMap({ pin: FOURNAISE, label: "Carte de La Réunion (974) avec le Piton de la Fournaise" })}</figure>
</div>`;

  // « Puis-je monter au volcan ? », first: the official texts place by place, and the levels of the plan (marketing).
  const m = d?.puis_je_monter;
  const line = (l: Ligne) =>
    `<li>${esc(l.texte)}${l.source ? ` (${l.lien ? `<a href="${esc(l.lien)}">${esc(l.source)} →</a>` : esc(l.source)}).` : l.lien ? ` <a href="${esc(l.lien)}">→</a>` : ""}</li>`;
  const monter = m
    ? `<section id="monter" aria-labelledby="h-monter"><div class="sec-h"><h2 id="h-monter">${esc(m.titre)}</h2><p>${esc(m.chapeau)}</p></div>
  <div class="card"><ul class="plain">${m.lignes.map(line).join("")}</ul><p class="note">${esc(m.pied)}</p>
  <details><summary>Les niveaux du dispositif</summary><ul class="plain">${NIVEAUX.map((n) => `<li><b>${esc(n.niveau)}</b> : « ${esc(n.libelle)} »</li>`).join("")}</ul><p class="note"><small>${esc(VERSION)}</small></p></details></div></section>
`
    : "";

  const body = `${monter}${a ? alertSections(a, news) : ""}<section aria-labelledby="h-volcan">
  <div class="sec-h"><p class="eyebrow">En ce moment</p><h2 id="h-volcan">L'Enclos et les séismes</h2></div>
  ${d ? `<div class="two">${enclos}${quakes}</div>${warnings(d.avertissements)}${data ? sourcesNote(d.sources, data) : ""}` : `<p class="card">Les données du volcan se chargent : rechargez la page dans quelques secondes.</p>`}
</section>
${before}${posts}
${connectorCta("volcan_seismes", "le volcan")}`;

  return layout(origin, { title, description, path: "/volcan", jsonld: [crumbs(origin, "Volcan", "/volcan"), webPage(origin, "/volcan", title, description, data)], alerte }, band, body);
}

// Below this many a day, the bars keep their scale: one event must not fill the chart (data-run: no scale that
// magnifies a small number, the axis at 0).
const DAYS_SCALE_MIN = 10;

/**
 * The events located under the summit per day, as bars from 0, today marked « en cours » (data-run, marketing); each
 * bar says its day and count to screen readers, and the line under it today's, yesterday's and the highest.
 */
function quakeDays(days: NonNullable<VolcanAnswer["seismes"]>["par_jour_sous_le_volcan"], imageAfter: boolean): string {
  if (!days?.length) return "";
  const dd = (jour: string) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}`;
  const scale = Math.max(DAYS_SCALE_MIN, ...days.map((j) => j.nombre));
  const bars = days.map((j) =>
    `<li${j.en_cours ? ` class="now"` : ""} aria-label="${dd(j.jour)}${j.en_cours ? " (en cours)" : ""} : ${j.nombre}"><i style="height:${Math.round((j.nombre / scale) * 100)}%"></i></li>`).join("");
  const today = days.at(-1)!;
  const yesterday = days.at(-2);
  const top = days.reduce((a, j) => (j.nombre > a.nombre ? j : a), days[0]);
  // « Le plus en un jour »: not to be read as a total over the 30 days (marketing).
  const facts = `Aujourd'hui (en cours) : <b>${today.nombre}</b>${yesterday ? `, hier : <b>${yesterday.nombre}</b>` : ""}.` +
    (top.nombre ? ` Le plus en un jour sur 30 jours : <b>${top.nombre}</b>, le ${dd(top.jour)}.` : "");
  return `<figure class="qdays"><figcaption>Sous le volcan, par jour (heure de La Réunion)</figcaption>` +
    `<ol>${bars}</ol><p class="axis"><span>${dd(days[0].jour)}</span><span>${dd(today.jour)} (en cours)</span></p></figure>` +
    `<p>${facts}</p><p class="note">${esc(LOCALISES)}</p>` +
    (imageAfter ? `<p class="note">${esc(IMAGE_APRES)}</p>` : "");
}

export function volcanLive(data: Cached<VolcanAnswer> | null): Live | undefined {
  const e = data?.value.etat;
  if (!e) return undefined;
  const a = alerteVolcan(data!.value);
  if (a) return tileLive(a);
  const q = data!.value.seismes;
  return {
    valeur: e.eruption_en_cours ? "Éruption en cours" : "Pas d'éruption",
    detail: [
      e.acces_enclos ? `Enclos ${esc(ACCESS[e.acces_enclos.statut] ?? e.acces_enclos.statut)}` : `ORSEC ${esc(e.niveau_orsec)}`,
      q ? `${q.sous_le_volcan["7_jours"]} séisme${q.sous_le_volcan["7_jours"] > 1 ? "s" : ""} localisé${q.sous_le_volcan["7_jours"] > 1 ? "s" : ""} par l'OVPF sous le volcan en 7 jours` : undefined,
    ].filter(Boolean).join(" · "),
  };
}

// ---------------------------------------------------------------- air

const AQ_NAMES = ["", "bon", "moyen", "dégradé", "mauvais", "très mauvais", "extrêmement mauvais"];
export const aq = (n: number) => `<span class="aq aq${n >= 1 && n <= 6 ? n : 0}">${esc(AQ_NAMES[n] ?? "inconnu")}</span>`;
// The map's commune names (« L'Étang-Salé ») by their spelling in the ATMO index (« L'Etang-Salé »).
const MAP_NAME = new Map(island.paths.map((p: { nom: string }) => [normalize(p.nom), p.nom]));

export function airPage(origin: string, data: Cached<AirAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const list = [...(d?.communes ?? [])].sort((a, b) => b.niveau - a.niveau || a.commune.localeCompare(b.commune, "fr"));
  const worst = list[0]?.niveau;
  const best = list.length ? list[list.length - 1].niveau : undefined;
  const url = `${origin}/air`;

  const fills: Record<string, string> = {};
  for (const c of list) {
    const name = MAP_NAME.get(normalize(c.commune));
    if (name && c.niveau >= 1 && c.niveau <= 6) fills[name] = `var(--aq${c.niveau})`;
  }

  const status = !d
    ? loading("L'indice de la qualité de l'air")
    : worst != null
      ? `<div class="status"><p class="big">${esc(AQ_NAMES[worst] ?? "")}${best != null && best !== worst ? ` à ${esc(AQ_NAMES[best] ?? "")}` : ""}</p>` +
        `<p class="lead">${esc(d.resume)}</p><p class="note" style="color:var(--on-night-muted)">${esc(d.nature)}.</p></div>`
      : `<p class="lead">${esc(d.resume)}</p>`;

  const byLevel = [6, 5, 4, 3, 2, 1]
    .map((n) => ({ n, l: list.filter((c) => c.niveau === n) }))
    .filter((x) => x.l.length)
    .map((x) => `<div class="card"><h3>${aq(x.n)} ${x.l.length} commune${x.l.length > 1 ? "s" : ""}</h3><ul class="plain cols">` +
      x.l.map((c) => `<li>${esc(c.commune)}${c.polluants.length ? ` <span class="note">(${esc(c.polluants.join(", "))})</span>` : ""}</li>`).join("") + `</ul></div>`)
    .join("");

  const scale = `<ul class="scale">${[1, 2, 3, 4, 5, 6].map((n) => `<li>${aq(n)}<p>Indice ${n} sur 6.</p></li>`).join("")}</ul>`;

  const title = "Qualité de l'air Réunion aujourd'hui, par commune · 974";
  const description = d && worst != null
    ? describe(`🇷🇪 Qualité de l'air à La Réunion (974) aujourd'hui, indice ATMO d'Atmo Réunion : ${d.resume.replace(/^Qualité de l'air aujourd'hui à La Réunion : /, "")}`,
        "🇷🇪 Qualité de l'air à La Réunion (974) aujourd'hui : l'indice ATMO d'Atmo Réunion dans chaque commune, avec le polluant en cause.")
    : "🇷🇪 Qualité de l'air à La Réunion (974) aujourd'hui : l'indice ATMO d'Atmo Réunion dans chaque commune, avec le polluant en cause.";

  const band = `${crumbBar("Qualité de l'air")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Indice du jour</p>
    <h1>Qualité de l'air <span class="n974">974</span></h1>
    ${status}
    ${ask(`Lèr lé bon La Rényon zordi ? Rogard si ${url} é di amwin pou mon komine.`,
      `L'air est-il bon aujourd'hui à La Réunion ? Lis ${url} et dis-moi la qualité de l'air dans ma commune.`)}
  </div>
  <figure class="card mapcard">${islandMap({ fills, label: "Carte de La Réunion (974) colorée par l'indice de qualité de l'air de chaque commune" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Couleur de l'indice ATMO du jour dans chaque commune.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-communes-air">
  <div class="sec-h"><p class="eyebrow">Commune par commune</p><h2 id="h-communes-air">L'indice dans les 24 communes</h2>
  <p>L'indice ATMO va de 1 (bon) à 6 (extrêmement mauvais). Il est donné par le pire des polluants mesurés et prévus (ozone, dioxyde d'azote, dioxyde de soufre, particules).</p></div>
  ${d ? `<div class="levels">${byLevel}</div>${warnings(d.avertissements)}${data ? sourcesNote(d.sources, data) : ""}` : `<p class="card">L'indice se charge : rechargez la page dans quelques secondes.</p>`}
</section>
<section aria-labelledby="h-echelle-air">
  <div class="sec-h"><p class="eyebrow">Bon à savoir</p><h2 id="h-echelle-air">L'échelle de l'indice</h2></div>
  <div class="card">${scale}<p class="note">Pendant une éruption, le panache peut dégrader l'air dans le sud et l'ouest de l'île : suivez les consignes de l'ARS et de la préfecture.</p></div>
</section>
${connectorCta("qualite_air", "l'air de l'île")}`;

  return layout(origin, { title, description, path: "/air", jsonld: [crumbs(origin, "Qualité de l'air", "/air"), webPage(origin, "/air", title, description, data)], alerte }, band, body);
}

export function airLive(data: Cached<AirAnswer> | null): Live | undefined {
  const list = data?.value.communes ?? [];
  if (!list.length) return undefined;
  const worst = Math.max(...list.map((c) => c.niveau));
  const best = Math.min(...list.map((c) => c.niveau));
  const polluants = [...new Set(list.filter((c) => c.niveau === worst).flatMap((c) => c.polluants))];
  return {
    valeur: best === worst ? aq(worst) : `${aq(best)} à ${aq(worst)}`,
    detail: `indice ATMO du jour dans les 24 communes${polluants.length ? ` (${esc(polluants.join(", "))})` : ""}`,
  };
}

// ---------------------------------------------------------------- électricité

/**
 * One notice of power cut, its link after it. A PDF letter's sentence ends on its link (marketing's words): « l'avis
 * publié par la mairie (PDF) → », « dans l'avis (PDF) → », a target tall enough for a finger.
 */
export function courantItem(x: Pick<CourantRow, "texte" | "lien" | "nature" | "pdf">): string {
  const li = x.nature === "en cours" ? '<li class="warn">' : "<li>";
  const end = x.pdf ? /(l'avis publié par la mairie|dans l'avis)$/.exec(x.texte) : null;
  if (!end) return `${li}${esc(x.texte)} <a href="${esc(x.lien)}" rel="noopener">l'avis →</a></li>`;
  return `${li}${esc(x.texte.slice(0, end.index))}<a class="tap" href="${esc(x.lien)}" rel="noopener">${esc(end[1])} (PDF) →</a></li>`;
}

export function electricitePage(origin: string, data: Cached<ElectriciteAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const p = d?.production;
  const m = d?.meteo_electricite;
  const url = `${origin}/electricite`;

  const status = !d
    ? loading("La production d'électricité")
    : p
      ? `<div class="now"><span class="big">${fr(Math.round(p.renouvelable_pct))} %</span><p>de l'électricité de l'île vient en ce moment de sources <b>renouvelables</b>, sur <b>${esc(fr(Math.round(p.total_mw)))} MW</b> produits (${esc(p.heure.replace(" heure de La Réunion", ""))}).</p></div>` +
        (m?.maintenant ? `<p class="lead">Signal d'EDF en ce moment : <b>${esc(m.maintenant.signal.toLowerCase())}</b>.</p>` : "")
      : `<p class="lead">${esc(d.resume)}</p>`;

  const bars = p
    ? `<ul class="bars">${p.parts.map((x) => `<li><span>${esc(x.filiere)}</span><b>${esc(fr(x.part_pct))} %</b><i class="${x.renouvelable ? "ren" : ""}" style="width:${Math.max(1, x.part_pct)}%"></i></li>`).join("")}</ul>` +
      `<p class="note">En vert, les filières renouvelables. ${esc(p.statut[0].toUpperCase() + p.statut.slice(1))}.</p>`
    : "";

  const tension = m
    ? `<div class="card">${icon("bolt")}<h3>Quand éviter les gros usages</h3>` +
      (m.periodes_de_tension.length
        ? `<ul class="plain">${m.periodes_de_tension.map((t) => `<li><b>${esc(t.quand)}</b> : ${esc(t.signal)}${t.recharge_conseillee_pct != null ? ` (recharge d'un véhicule à ${t.recharge_conseillee_pct} %)` : ""}</li>`).join("")}</ul>`
        : `<p>Pas de période de tension prévue${m.jusqu_au ? ` d'ici le ${esc(m.jusqu_au)}` : ""}.</p>`) +
      `<p class="note">${esc(m.explication)}</p></div>`
    : "";

  // The cuts the mairies relay, in marketing's words (tools/courant.ts); never « pas de coupure ».
  const c = d?.coupures_annoncees;
  const cuts = c
    ? `<section id="coupures" aria-labelledby="h-coupures">
  <div class="sec-h"><h2 id="h-coupures">Coupures d'électricité annoncées par les mairies</h2>
  ${c.a_savoir ? `<p>${esc(c.a_savoir)}</p>` : ""}${c.depannage ? `<p><b>${esc(c.depannage)}</b></p>` : ""}</div>
  ${c.avis?.length
    ? `<div class="card"><ul class="plain">${c.avis.map(courantItem).join("")}</ul></div>`
    : `<p class="card">${esc(c.indisponible ?? "Aucun avis relayé par les mairies suivies.")}</p>`}
</section>`
    : "";

  const title = "Électricité Réunion en direct : part renouvelable · 974";
  const description = p
    ? describe(`🇷🇪 Électricité à La Réunion (974) à ${p.heure.split(" ")[1]} : ${fr(Math.round(p.total_mw))} MW produits, dont ${fr(Math.round(p.renouvelable_pct))} % renouvelable. Filière par filière, et les heures où le réseau est chargé.`,
        `🇷🇪 Électricité à La Réunion (974) : ${fr(Math.round(p.renouvelable_pct))} % renouvelable en ce moment. Filière par filière, et les heures où le réseau est chargé.`)
    : "🇷🇪 Électricité à La Réunion (974) en direct : d'où vient le courant, la part renouvelable et les heures où le réseau est chargé.";

  const band = `${crumbBar("Électricité")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Production en direct</p>
    <h1>Électricité <span class="n974">974</span></h1>
    ${status}
    ${ask(`Lo kouran La Rényon i sort koté astèr ? Rogard si ${url} é di amwin la par renouvlab.`,
      `D'où vient l'électricité de La Réunion en ce moment ? Lis ${url} et dis-moi la part renouvelable.`)}
  </div>
  ${p ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">Filière par filière</h3>${bars}</figure>` : ""}
</div>`;

  const body = `<section aria-labelledby="h-reseau">
  <div class="sec-h"><p class="eyebrow">Le réseau</p><h2 id="h-reseau">Une île qui produit toute son électricité</h2>
  <p>La Réunion n'est reliée à aucun autre réseau : chaque kilowatt consommé est produit sur l'île, au moment même. Le soir, quand tout le monde rentre, le réseau est le plus chargé.</p></div>
  ${d ? `<div class="two">${tension}${warnings(d.avertissements)}</div>${data ? sourcesNote(d.sources, data) : ""}` : `<p class="card">Les données d'EDF se chargent : rechargez la page dans quelques secondes.</p>`}
</section>
${cuts}
${connectorCta("electricite", "l'électricité de l'île")}`;

  return layout(origin, { title, description, path: "/electricite", jsonld: [crumbs(origin, "Électricité", "/electricite"), webPage(origin, "/electricite", title, description, data)], alerte }, band, body);
}

export function electriciteLive(data: Cached<ElectriciteAnswer> | null): Live | undefined {
  const p = data?.value.production;
  if (!p) return undefined;
  const signal = data!.value.meteo_electricite?.maintenant?.signal;
  return {
    valeur: `${fr(Math.round(p.renouvelable_pct))}\u202f% renouvelable`,
    detail: `${esc(fr(Math.round(p.total_mw)))} MW produits à ${esc(p.heure.split(" ")[1] ?? p.heure)}${signal ? ` · réseau ${esc(signal.toLowerCase())}` : ""}`,
  };
}

// ---------------------------------------------------------------- calendrier

export function calendrierPage(origin: string, data: Cached<CalendrierAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const v = d?.vacances_scolaires;
  const f = d?.jours_feries;
  const next = f?.prochains[0];
  const url = `${origin}/calendrier`;
  const today = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Indian/Reunion" });

  const status = !d
    ? loading("Le calendrier")
    : `<div class="status"><p class="big">${esc(today)}</p>` +
      (f?.aujourd_hui ? `<p class="lead">Aujourd'hui est férié : <b>${esc(f.aujourd_hui)}</b>.</p>` : "") +
      (v?.en_cours ? `<p class="lead">Vacances scolaires en cours, reprise des cours le <b>${esc(v.en_cours.reprise_des_cours)}</b>.</p>` : "") +
      (next ? `<p class="lead">Prochain jour férié : <b>${esc(next.nom)}</b>, ${esc(next.date)} (dans ${next.dans_jours} jour${next.dans_jours > 1 ? "s" : ""}).</p>` : "") +
      (d.soleil ? `<p class="lead">À ${esc(d.soleil.lieu)}, lever du soleil à <b>${esc(d.soleil.lever.replace(":", "h"))}</b>, coucher à <b>${esc(d.soleil.coucher.replace(":", "h"))}</b>.</p>` : "") +
      `</div>`;

  const holidays = f
    ? `<div class="card">${icon("calendar")}<h3>Jours fériés</h3><ul class="plain">${f.prochains.map((h) => `<li><b>${esc(h.nom)}</b> : ${esc(h.date)} <span class="note">(dans ${h.dans_jours} j)</span></li>`).join("")}</ul><p class="note">${esc(f.note)}</p></div>`
    : "";
  const school = v
    ? `<div class="card">${icon("book")}<h3>Vacances scolaires</h3><ul class="plain">` +
      [...(v.en_cours ? [{ ...v.en_cours, now: true }] : []), ...v.a_venir.map((x) => ({ ...x, now: false }))]
        .map((x) => `<li><b>${esc(x.nom)}</b>${x.now ? " (en cours)" : ""} : du ${esc(x.debut)}, ${x.reprise_des_cours === UNPUBLISHED ? "date de reprise pas encore publiée" : `reprise le ${esc(x.reprise_des_cours)}`}</li>`).join("") +
      `</ul><p class="note">${esc(v.note)}</p></div>`
    : "";
  const sun = d?.soleil
    ? `<div class="card">${icon("mountain")}<h3>Soleil à ${esc(d.soleil.lieu)}</h3><p>Lever ${esc(d.soleil.lever.replace(":", "h"))}, coucher ${esc(d.soleil.coucher.replace(":", "h"))} : ${esc(d.soleil.duree_du_jour)} de jour.</p><p class="note">${esc(d.soleil.note)}</p></div>`
    : "";

  // The school year people look up: from July, the one that starts in August.
  const [y, m] = new Date(now.getTime() + 4 * 3600_000).toISOString().split("-").map(Number);
  const year = m >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
  const title = `Vacances scolaires Réunion ${year}, jours fériés · 974`;
  // The next break: its first day and its last (the day before classes resume).
  const day = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
  const coming = d?.annees_scolaires?.flatMap((a) => a.vacances).find((b) => b.reprise && b.reprise > day);
  const short = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }).replace(/^1 /, "1er ");
  const lastDay = (ymd: string) => new Date(Date.parse(`${ymd}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const span = coming ? `${coming.debut <= day ? "vacances en cours" : "prochaines vacances"} du ${short(coming.debut)} au ${short(lastDay(coming.reprise!))}` : "";
  const description = coming
    ? describe(`🇷🇪 Vacances scolaires ${year} à La Réunion (974), calendrier austral : ${span}. Jours fériés dont le 20 décembre.`,
        `🇷🇪 Vacances scolaires ${year} à La Réunion (974) : ${span}. Jours fériés dont le 20 décembre.`)
    : next
      ? describe(`🇷🇪 Vacances scolaires ${year} à La Réunion (974), calendrier austral ; prochain jour férié ${next.nom} (${next.date}). Le 20 décembre, lever et coucher du soleil.`,
          `🇷🇪 Vacances scolaires ${year} à La Réunion (974), jours fériés dont le 20 décembre, lever et coucher du soleil.`)
      : `🇷🇪 Vacances scolaires ${year} à La Réunion (974), calendrier austral : jours fériés dont le 20 décembre, lever et coucher du soleil.`;

  // Every break of the school year, and of the next once the rectorat has published it.
  const years = (d?.annees_scolaires ?? []).map((a, i) => `<section aria-labelledby="h-vac-${i}">
  <div class="sec-h">${i ? "" : `<p class="eyebrow">Calendrier austral</p>`}<h2 id="h-vac-${i}">Vacances scolaires ${esc(a.annee)} (académie de La Réunion)</h2></div>
  <div class="card table-wrap"><table class="drought"><thead><tr><th>Vacances</th><th>Début</th><th>Reprise des cours</th></tr></thead><tbody>${a.vacances.map((b) => {
    const now_ = b.debut <= day && !!b.reprise && day < b.reprise;
    const past = !!b.reprise && b.reprise <= day;
    return `<tr${past ? ` class="past"` : ""}><th scope="row">${esc(b.nom.replace(/^\p{L}/u, (c) => c.toUpperCase()))}${now_ ? ` <span class="badge m">en cours</span>` : ""}</th><td>${esc(longDate(b.debut))}</td><td>${b.reprise ? esc(longDate(b.reprise)) : "pas encore publiée"}</td></tr>`;
  }).join("")}</tbody></table></div>
  ${i ? "" : `<p class="note">Dates de l'académie de La Réunion, publiées par le ministère de l'Éducation nationale.</p>`}
</section>`).join("\n");

  const band = `${crumbBar("Calendrier")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Aujourd'hui à La Réunion</p>
    <h1>Vacances scolaires et jours fériés à La Réunion</h1>
    ${status}
    ${ask(`Kansa lé lo prochin vakans lékol é lo prochin zour férié La Rényon ? Rogard si ${url} é di amwin.`,
      `Quand sont les prochaines vacances scolaires et le prochain jour férié à La Réunion ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${sun ? `<figure class="card mapcard">${islandMap({ peaks: true, label: "Carte de La Réunion (974)" })}</figure>` : ""}
</div>`;

  const body = `${years}
<section aria-labelledby="h-cal">
  <div class="sec-h"><p class="eyebrow">L'année à La Réunion</p><h2 id="h-cal">Vacances, jours fériés, soleil</h2>
  <p>L'académie de La Réunion suit un calendrier austral : les grandes vacances tombent en décembre et janvier, pendant l'été de l'hémisphère sud.</p></div>
  ${d ? `<div class="three">${school}${holidays}${sun}</div>${data ? sourcesNote(d.sources, data) : ""}` : `<p class="card">Le calendrier se charge : rechargez la page dans quelques secondes.</p>`}
</section>
${connectorCta("calendrier", "le calendrier de l'île")}`;

  return layout(origin, { title, description, path: "/calendrier", jsonld: [crumbs(origin, "Calendrier", "/calendrier"), webPage(origin, "/calendrier", title, description, data)], alerte }, band, body);
}

export function calendrierLive(data: Cached<CalendrierAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const v = d.vacances_scolaires?.en_cours;
  const f = d.jours_feries;
  const next = f?.prochains[0];
  const valeur = f?.aujourd_hui ? `Férié : ${esc(f.aujourd_hui)}` : v ? "Vacances scolaires" : next ? `${esc(next.nom)} dans ${next.dans_jours} j` : undefined;
  if (!valeur) return undefined;
  return {
    valeur,
    detail: [
      v ? `reprise le ${esc(v.reprise_des_cours)}` : undefined,
      (f?.aujourd_hui || v) && next ? `${esc(next.nom)} dans ${next.dans_jours} j` : undefined,
      d.soleil ? `soleil ${esc(d.soleil.lever.replace(":", "h"))} – ${esc(d.soleil.coucher.replace(":", "h"))}` : undefined,
    ].filter(Boolean).join(" · "),
  };
}

// ---------------------------------------------------------------- bus

const waitText = (min: number, heure: string) =>
  heure.startsWith("demain") ? heure : min < 1 ? "maintenant" : min < 90 ? `dans ${fr(min)} min` : `à ${heure}`;

type Row = BusData["gares"][number]["departs"][number];

/** What the real-time feed says of a departure, HTML: « +5 min », « à l'heure », « 1 min d'avance », « ne passe pas à cet arrêt ». */
export function liveText(x: Row): string {
  if (x.temps_reel) return ` <b class="rt">${esc(x.temps_reel)}</b>`;
  if (x.retard_min === undefined) return "";
  const m = x.retard_min;
  return ` <b class="rt" title="Heure annoncée en temps réel par le réseau">${m === 0 ? "à l'heure" : m > 0 ? `+${fr(m)} min` : `${fr(-m)} min d'avance`}</b>`;
}

/** One departure as a row: line, direction, wait (from the real-time feed when there is one). */
export const departureLi = (x: Row, wait: string) =>
  `<li><b>${esc(x.ligne)}</b><span>vers ${esc(x.direction)} <span class="note">(${esc(x.reseau)})</span></span><span class="note">${esc(wait)}${liveText(x)}</span></li>`;

/** The traffic alerts of the networks with a real-time feed. */
export const alertList = (list: { reseau: string; lignes?: string[]; titre: string; detail?: string }[]) =>
  `<ul class="plain">${list.map((a) => `<li><b>${esc(a.reseau)}${a.lignes ? `, ligne ${esc(a.lignes.join(", "))}` : ""}</b> : ${esc(a.titre)}${a.detail && a.detail !== a.titre ? `<p class="note">${esc(a.detail)}</p>` : ""}</li>`).join("")}</ul>`;

export function busPage(origin: string, data: Cached<BusData> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/bus`;
  const lines = d?.reseaux.reduce((n, r) => n + r.lignes, 0) ?? 0;

  const status = !d
    ? loading("Les horaires")
    : `<div class="now"><span class="big">${d.reseaux.length}</span><p>réseaux de bus et le téléphérique de Saint-Denis : <b>${esc(fr(lines))} lignes</b>, de Car Jaune qui fait le tour de l'île aux bus de chaque commune.</p></div>`;

  const networks = d
    ? `<ul class="plain">${d.reseaux.map((r) => `<li><b>${esc(r.nom)}</b> : ${esc(fr(r.lignes))} ligne${r.lignes > 1 ? "s" : ""} <span class="note">(${esc(r.exploitant)})</span></li>`).join("")}</ul>`
    : "";

  const gares = d?.gares.length
    ? `<ul class="zones">${d.gares.map((g) => `<li class="card"><h3>Gare ${esc(de(g.commune))}</h3>` +
        `<p class="note">${g.arrets.map((a) => `${esc(a.reseau)} : ${esc(a.nom)}`).join(" · ")}</p>` +
        (g.departs.length
          ? `<ul class="rows">${g.departs.map((x) => departureLi(x, waitText(x.dans_min, x.heure_annoncee ?? x.heure))).join("")}</ul>`
          : `<p>Pas de départ prévu dans les prochaines heures.</p>`) +
        `</li>`).join("")}</ul>` +
      `<p class="note">${d!.temps_reel?.length ? `${esc(d!.temps_reel.map((t) => t.reseau).join(", "))} : heures annoncées en temps réel par le réseau quand le bus y figure (flux de ${esc(d!.temps_reel[0].heure)}). ` : ""}` +
      `Sinon, horaires théoriques publiés par chaque réseau, sans les retards ni les déviations. Mis à jour à ${hm(data!.fetchedAt)}.</p>`
    : `<p class="card">Les prochains départs à n'importe quel arrêt de l'île sont donnés par le connecteur : demandez à votre assistant « le prochain bus à la gare de Saint-Pierre ? ».</p>`;

  const title = "Horaires bus Réunion : prochains départs en gare · 974";
  const description = "🇷🇪 Bus à La Réunion (974) : prochains départs dans les gares routières, d'après les horaires de Car Jaune, Citalis, Kar'Ouest, Alternéo, CarSud et Estival.";

  const band = `${crumbBar("Bus")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Horaires du jour</p>
    <h1>Bus et cars <span class="n974">974</span></h1>
    ${status}
    ${ask(`Kansa i pas lo prochin bis la gar Sin-Pièr ? Rogard si ${url} é di amwin.`,
      `Quand passe le prochain bus à la gare routière de Saint-Pierre ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${d ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">Les réseaux</h3>${networks}</figure>` : ""}
</div>`;

  const body = `<section aria-labelledby="h-gares">
  <div class="sec-h"><p class="eyebrow">En ce moment</p><h2 id="h-gares">Prochains départs dans les gares routières</h2>
  <p>Toutes les lignes qui partent de chaque gare, tous réseaux confondus, au plus trois départs par ligne et par direction.</p></div>
  ${gares}
  ${d ? `<p class="note">Sources : ${credits(d.sources)}.</p>` : ""}
</section>
${d?.alertes?.length ? `<section aria-labelledby="h-trafic"><h2 id="h-trafic">Info trafic</h2><div class="card">${alertList(d.alertes)}<p class="note">Publié par les réseaux dans leur flux temps réel, repris tel quel.</p></div></section>` : ""}
${connectorCta("transports", "les bus de l'île")}
<section aria-labelledby="h-bateau"><h3 id="h-bateau">${esc(FERRY.h3)}</h3><p>${esc(FERRY.page)}</p><p class="note">${esc(FERRY.verifie)}</p></section>`;

  return layout(origin, { title, description, path: "/bus", jsonld: [crumbs(origin, "Bus", "/bus"), webPage(origin, "/bus", title, description, data)], alerte }, band, body);
}

export function busLive(data: Cached<BusData> | null): Live | undefined {
  const d = data?.value;
  const g = d?.gares.find((x) => x.departs.length);
  if (!d || !g) return undefined;
  const x = g.departs[0];
  return {
    // A time rather than « dans 3 min »: the page may be a few minutes old.
    valeur: esc(x.heure_annoncee ?? x.heure),
    detail: `prochain départ de la gare ${esc(de(g.commune))} : ligne ${esc(x.ligne)} vers ${esc(x.direction)} (${esc(x.reseau)})`,
  };
}

// ---------------------------------------------------------------- vélos

/** « 4 vélos · 6 places », « fermée ». */
export function bikeStock(s: VeloStation): string {
  if (s.etat === "fermée" || s.etat === "location impossible en ce moment") return esc(s.etat);
  const parts = [`<b>${s.velos_electriques}</b> vélo${s.velos_electriques > 1 ? "s" : ""}`];
  if (s.trottinettes) parts.push(`<b>${s.trottinettes}</b> trottinette${s.trottinettes > 1 ? "s" : ""}`);
  if (s.places_libres != null && !s.etat) parts.push(`${s.places_libres} place${s.places_libres > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

export const bikeRow = (s: VeloStation) => `<li><span>${esc(s.nom)}</span><span>${bikeStock(s)}</span></li>`;

export function velosPage(origin: string, data: Cached<VelosAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/velos`;
  const total = d?.communes?.reduce((n, c) => n + c.velos_disponibles, 0) ?? 0;

  const status = !d
    ? loading("L'état des stations")
    : `<div class="now"><span class="big">${total}</span><p>vélo${total > 1 ? "s" : ""} à assistance électrique disponible${total > 1 ? "s" : ""} en ce moment dans les <b>${d.stations.length} stations</b> Altervélo de ${esc(BIKE_COMMUNES.join(", ").replace(/, ([^,]+)$/, " et $1"))}.</p></div>`;

  const fills = Object.fromEntries(BIKE_COMMUNES.map((c) => [c, "var(--hl)"]));
  const byCommune = d
    ? `<ul class="zones">${BIKE_COMMUNES.map((c) => {
        const mine = d.stations.filter((s) => s.commune === c).sort((a, b) => b.velos_electriques + (b.trottinettes ?? 0) - (a.velos_electriques + (a.trottinettes ?? 0)) || a.nom.localeCompare(b.nom, "fr"));
        const n = d.communes?.find((x) => x.commune === c)?.velos_disponibles ?? 0;
        return `<li class="card"><h3>${esc(c)} <span class="note">${n} vélo${n > 1 ? "s" : ""}, ${mine.length} station${mine.length > 1 ? "s" : ""}</span></h3>` +
          `<ul class="rows bikes">${mine.map(bikeRow).join("")}</ul></li>`;
      }).join("")}</ul>` +
      `<p class="note">${esc(d.donnees)}</p>`
    : `<p class="card">L'état des stations se charge : rechargez la page dans quelques secondes.</p>`;

  const title = "Vélos Altervélo en direct : stations libres · 974";
  const description = d
    ? describe(`🇷🇪 Vélos électriques Altervélo en libre-service (974) en ce moment : ${total} vélos disponibles, et les places libres de chaque station à Saint-Pierre, Saint-Louis et L'Étang-Salé.`,
        "🇷🇪 Vélos électriques Altervélo en libre-service (974) : vélos et places libres de chaque station, en direct.")
    : "🇷🇪 Vélos électriques Altervélo en libre-service (974) : vélos et places libres de chaque station, en direct.";

  const band = `${crumbBar("Vélos")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>En direct</p>
    <h1>Vélos en libre-service <span class="n974">974</span></h1>
    ${status}
    ${ask(`Néna in vélo Altervélo i rès dan la stasion IUT ? Rogard si ${url} é di amwin.`,
      `Reste-t-il des vélos Altervélo à la station IUT de Saint-Pierre ? Lis ${url} et dis-le-moi.`)}
  </div>
  <figure class="card mapcard">${islandMap({ fills, label: "Carte de La Réunion (974) : les communes où circulent les vélos Altervélo" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Les communes desservies par Altervélo.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-stations">
  <div class="sec-h"><p class="eyebrow">Station par station</p><h2 id="h-stations">Vélos et places libres</h2>
  <p>${d ? esc(d.service) : "Altervélo : vélos à assistance électrique en libre-service de la CIVIS."}</p></div>
  ${byCommune}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("velos_libre_service", "les vélos du Sud")}`;

  return layout(origin, { title, description, path: "/velos", jsonld: [crumbs(origin, "Vélos", "/velos"), webPage(origin, "/velos", title, description, data)], alerte }, band, body);
}

export function velosLive(data: Cached<VelosAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d?.communes) return undefined;
  const total = d.communes.reduce((n, c) => n + c.velos_disponibles, 0);
  const best = [...d.stations].sort((a, b) => b.velos_electriques - a.velos_electriques)[0];
  return {
    valeur: `${total} vélo${total > 1 ? "s" : ""}`,
    detail: `disponibles dans ${d.stations.length} stations Altervélo${best?.velos_electriques ? `, dont ${best.velos_electriques} à ${esc(best.nom)} (${esc(best.commune)})` : ""}`,
  };
}

// ---------------------------------------------------------------- bornes de recharge

/** A station in a list: where it is, its power and plugs, how many points are free. */
export function borneRow(s: BorneStation): string {
  const free = s.libres ? `<b>${s.libres}</b> libre${s.libres > 1 ? "s" : ""} sur ${s.total}` : `aucun libre sur ${s.total}`;
  return `<li><span>${esc(s.station)}<small>${fr(s.puissance_max_kw)} kW · ${esc(s.prises.join(", "))}${s.horaires && s.horaires !== "24 h/24, 7 j/7" ? ` · ${esc(s.horaires)}` : ""}</small></span>` +
    `<span class="${s.libres ? "free" : "busy"}">${free}</span></li>`;
}

export function bornesPage(origin: string, data: Cached<BornesAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/bornes`;
  const libres = d?.stations.reduce((n, s) => n + s.libres, 0) ?? 0;
  const total = d?.stations.reduce((n, s) => n + s.total, 0) ?? 0;

  const status = !d
    ? loading("L'état des bornes")
    : `<div class="now"><span class="big">${libres}</span><p>point${libres > 1 ? "s" : ""} de charge libre${libres > 1 ? "s" : ""} en ce moment, sur <b>${total}</b> dans les ${d.stations.length} stations publiques de l'île.</p></div>`;

  // One marker per commune, where its stations are: how many points are free there.
  const markers = (d?.communes ?? []).map((c) => {
    const mine = d!.stations.filter((s) => s.commune === c.commune);
    const lon = mine.reduce((n, s) => n + s.lon, 0) / mine.length;
    const lat = mine.reduce((n, s) => n + s.lat, 0) / mine.length;
    const free = mine.reduce((n, s) => n + s.libres, 0);
    return { lon, lat, label: String(free), name: `${c.commune} : ${free} libre${free > 1 ? "s" : ""} sur ${c.points}`, round: true, color: free ? "#2b8a3e" : "#868e96" };
  });

  const fast = d ? d.stations.filter((s) => s.puissance_max_kw >= FAST_KW).sort((a, b) => b.libres - a.libres || b.puissance_max_kw - a.puissance_max_kw) : [];
  const byCommune = d
    ? `<ul class="zones">${d.communes.map((c) => {
        const mine = d.stations.filter((s) => s.commune === c.commune).sort((a, b) => b.libres - a.libres || b.puissance_max_kw - a.puissance_max_kw);
        const free = mine.reduce((n, s) => n + s.libres, 0);
        return `<li class="card"><h3>${esc(c.commune)} <span class="note">${free} libre${free > 1 ? "s" : ""} sur ${c.points}, ${c.stations} station${c.stations > 1 ? "s" : ""}</span></h3>` +
          `<ul class="rows bornes">${mine.map(borneRow).join("")}</ul></li>`;
      }).join("")}</ul>` +
      `<p class="note">${esc(d.donnees)}${d.avertissement ? ` ${esc(d.avertissement)}` : ""}</p>`
    : `<p class="card">L'état des bornes se charge : rechargez la page dans quelques secondes.</p>`;

  const title = "Bornes de recharge Réunion : points libres en direct · 974";
  const short = "🇷🇪 Bornes de recharge pour voiture électrique à La Réunion (974) : points libres, occupés ou hors service, en direct, station par station.";
  const description = d
    ? describe(`🇷🇪 Bornes de recharge à La Réunion (974) en ce moment : ${libres} points libres sur ${total}, la recharge rapide et chaque station, commune par commune.`, short)
    : short;

  const band = `${crumbBar("Recharge")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>En direct</p>
    <h1>Bornes de recharge <span class="n974">974</span></h1>
    ${status}
    ${ask(`Ousa mi pé roshar mon loto élèktrik vitman koté Sin-Pyèr ? Rogard si ${url} é di amwin.`,
      `Où recharger rapidement ma voiture électrique à Saint-Pierre ? Lis ${url} et dis-le-moi.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : les points de charge libres, commune par commune" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Points de charge libres en ce moment, par commune.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-rapide">
  <div class="sec-h"><p class="eyebrow">${fr(FAST_KW)} kW et plus</p><h2 id="h-rapide">Recharge rapide</h2>
  <p>Les stations où l'on recharge en une demi-heure à une heure, avec une prise Combo CCS ou CHAdeMO.</p></div>
  ${d ? `<div class="card"><ul class="rows bornes">${fast.map((s) => borneRow({ ...s, station: `${s.station}${s.station.endsWith(s.commune) ? "" : ` (${s.commune})`}` })).join("")}</ul></div>` : ""}
</section>
<section aria-labelledby="h-stations">
  <div class="sec-h"><p class="eyebrow">Station par station</p><h2 id="h-stations">Commune par commune</h2>
  <p>${d ? esc(d.recharge) : "Les bornes publiques de l'île et l'état de chacun de leurs points."}</p></div>
  ${byCommune}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("bornes_recharge", "les bornes de recharge")}`;

  return layout(origin, { title, description, path: "/bornes", jsonld: [crumbs(origin, "Recharge", "/bornes"), webPage(origin, "/bornes", title, description, data)], alerte }, band, body);
}

export function bornesLive(data: Cached<BornesAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d?.stations.length) return undefined;
  const libres = d.stations.reduce((n, s) => n + s.libres, 0);
  const fast = d.stations.filter((s) => s.puissance_max_kw >= FAST_KW && s.libres > 0).length;
  return {
    valeur: `${libres} point${libres > 1 ? "s" : ""} libre${libres > 1 ? "s" : ""}`,
    detail: `sur ${d.stations.reduce((n, s) => n + s.total, 0)}, dans ${d.stations.length} stations ; recharge rapide libre dans ${fast} station${fast > 1 ? "s" : ""}`,
  };
}

// ---------------------------------------------------------------- qualité de l'eau

const WATER_COLOR: Record<string, string> = { bonne: "#2b8a3e", moyenne: "#e8590c", mauvaise: "#c92a2a" };
const WATER_MARK: Record<string, string> = { bonne: "✓", moyenne: "~", mauvaise: "!" };
const dayFr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

function siteLine(s: EauAnswer["baignades"][number]): string {
  const last = s.derniers_prelevements[0];
  const q = s.qualite_dernier_prelevement;
  return `<li><span>${esc(s.site)}<small>dernier prélèvement le ${esc(s.dernier_prelevement)}` +
    (last ? ` · ${esc(last.enterocoques_100ml)} entérocoques et ${esc(last.e_coli_100ml)} E. coli pour 100 mL` : "") +
    (s.mauvais_sur_12_mois ? ` · ${s.mauvais_sur_12_mois} mauvais résultat${s.mauvais_sur_12_mois > 1 ? "s" : ""} sur 12 mois` : "") + `</small></span>` +
    `<span class="q-${q ?? "none"}">${q ? esc(q) : "pas de résultat"}</span></li>`;
}

function tapCard(c: EauAnswer["communes"][number]): string {
  const head = `<h3>${esc(c.commune)} <span class="note">${c.reseaux} réseau${c.reseaux > 1 ? "x" : ""}, ${c.analyses_6_mois} analyse${c.analyses_6_mois > 1 ? "s" : ""} en 6 mois</span></h3>`;
  if (!c.a_surveiller.length) {
    return `<li class="card">${head}<p>${c.analyses_6_mois ? "Toutes les analyses conformes" : "Pas d'analyse publiée"}${c.derniere_analyse ? ` (dernière le ${esc(dayFr(c.derniere_analyse))})` : ""}.</p></li>`;
  }
  return `<li class="card">${head}<ul class="rows eau">${c.a_surveiller.map((r) =>
    `<li><span>Réseau ${esc(r.reseau)}<small>${r.quartiers ? `${esc(r.quartiers)} · ` : ""}${(r.non_conformites ?? []).map((n) => `${esc(n.date)}${n.depassements ? ` : ${esc(n.depassements.join(", "))}` : ""}`).join(" ; ")}</small></span>` +
    `<span class="q-mauvaise">${r.non_conformes_6_mois} non conforme${r.non_conformes_6_mois > 1 ? "s" : ""}</span></li>`).join("")}</ul></li>`;
}

export function eauPage(origin: string, data: Cached<EauAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/eau`;
  const good = d?.baignades.filter((s) => s.qualite_dernier_prelevement === "bonne").length ?? 0;
  const notGood = d?.baignades.filter((s) => s.qualite_dernier_prelevement && s.qualite_dernier_prelevement !== "bonne") ?? [];
  const lastSample = d?.baignades.map((s) => s.dernier_prelevement.split("/").reverse().join("-")).sort().pop();
  const tapBad = d?.communes.filter((c) => c.non_conformes_6_mois) ?? [];

  const status = !d
    ? loading("La qualité de l'eau")
    : `<div class="now"><span class="big">${good}</span><p>plage${good > 1 ? "s" : ""} et bassin${good > 1 ? "s" : ""} sur <b>${d.baignades.length}</b> contrôlés par l'ARS en bonne qualité au dernier prélèvement` +
      `${lastSample ? ` (${esc(dayFr(lastSample))})` : ""}${notGood.length ? ` ; à surveiller : ${esc(notGood.map((s) => s.site).join(", "))}` : ""}.</p></div>`;

  const rank = (q?: string) => ["bonne", "moyenne", "mauvaise"].indexOf(q ?? "");
  // The worse last, drawn over the good ones next to them.
  const markers = [...(d?.baignades ?? [])].sort((a, b) => rank(a.qualite_dernier_prelevement) - rank(b.qualite_dernier_prelevement)).map((s) => {
    const q = s.qualite_dernier_prelevement ?? "";
    // Only the sites to watch carry their name: 26 names along the coast would cover each other.
    return { lon: s.lon, lat: s.lat, label: WATER_MARK[q] ?? "?", name: q === "bonne" ? `${s.site} : bonne` : s.site, round: true, color: WATER_COLOR[q] ?? "#868e96", quiet: q === "bonne" };
  });

  const sites = d
    ? `<ul class="zones">${[...new Set(d.baignades.map((s) => s.commune))].sort((a, b) => a.localeCompare(b, "fr")).map((c) => {
        const mine = d.baignades.filter((s) => s.commune === c);
        return `<li class="card"><h3>${esc(c)}</h3><ul class="rows eau">${mine.map(siteLine).join("")}</ul></li>`;
      }).join("")}</ul>`
    : `<p class="card">La qualité de l'eau se charge : rechargez la page dans quelques secondes.</p>`;

  const title = "Qualité de l'eau Réunion : baignade et robinet · 974";
  const short = "🇷🇪 Qualité de l'eau à La Réunion (974) : les plages et bassins contrôlés par l'ARS et l'eau du robinet de chaque commune, réseau par réseau.";
  const description = d
    ? describe(`🇷🇪 Qualité de l'eau à La Réunion (974) : ${good} plages et bassins sur ${d.baignades.length} en bonne qualité au dernier prélèvement de l'ARS, et l'eau du robinet des 24 communes, réseau par réseau.`, short)
    : short;

  const band = `${crumbBar("Qualité de l'eau")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Analyses de l'ARS</p>
    <h1>Qualité de l'eau <span class="n974">974</span></h1>
    ${status}
    ${ask(`Dlo lé bon pou bengn La Rényon ? Rogard si ${url} é di amwin pou la plaj l'Ermitaz é pou dlo robinè Sin-Pyèr.`,
      `L'eau est-elle bonne pour se baigner à La Réunion ? Lis ${url} et dis-moi pour la plage de l'Hermitage et l'eau du robinet à Saint-Pierre.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : la qualité de l'eau au dernier prélèvement de chaque plage et bassin contrôlé" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Qualité au dernier prélèvement : ✓ bonne, ~ moyenne, ! mauvaise.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-baignade">
  <div class="sec-h"><p class="eyebrow">Plages et bassins</p><h2 id="h-baignade">L'eau de baignade</h2>
  <p>${esc(EAU_TEXT.baignade)}</p></div>
  ${sites}
  ${d ? `<p class="note">${esc(d.a_savoir.eau_de_baignade)}</p>` : ""}
  <p class="note">${BAIGNADE_LINE}</p>
</section>
<section aria-labelledby="h-robinet">
  <div class="sec-h"><p class="eyebrow">Commune par commune</p><h2 id="h-robinet">L'eau du robinet</h2>
  <p>${d ? `${tapBad.length ? `Des analyses non conformes en 6 mois dans ${tapBad.length} commune${tapBad.length > 1 ? "s" : ""} sur ${d.communes.length}, sur un ou deux réseaux chacune.` : "Toutes les analyses des 6 derniers mois sont conformes."} ` : ""}${esc(EAU_TEXT.robinet)}</p></div>
  ${d ? `<ul class="zones">${d.communes.map(tapCard).join("")}</ul><p class="note">${esc(d.a_savoir.eau_du_robinet)}</p>${data ? `<p class="note">Sources : ${esc(d.sources.map((x) => x.attribution).join(" ; "))}. Analyses rassemblées le ${esc(dayFr(d.lu))} à ${esc(hm(new Date(d.lu)))}.</p>` : ""}` : ""}
</section>
${connectorCta("qualite_eau", "la qualité de l'eau")}`;

  return layout(origin, { title, description, path: "/eau", jsonld: [crumbs(origin, "Qualité de l'eau", "/eau"), webPage(origin, "/eau", title, description, data)], alerte }, band, body);
}

const EAU_TEXT = {
  baignade: "Les 26 plages et bassins où l'ARS contrôle l'eau, avec le résultat de leur dernier prélèvement : bonne, moyenne ou mauvaise selon les germes trouvés (entérocoques intestinaux et E. coli).",
  robinet: "Chaque commune a plusieurs réseaux d'eau, du centre-ville aux écarts des Hauts : la qualité dépend du réseau qui dessert le quartier. Les réseaux ci-dessous ont eu au moins une analyse non conforme.",
};

export function eauLive(data: Cached<EauAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d?.baignades.length) return undefined;
  const good = d.baignades.filter((s) => s.qualite_dernier_prelevement === "bonne").length;
  return {
    valeur: `${good} site${good > 1 ? "s" : ""} sur ${d.baignades.length}`,
    detail: "plages et bassins en bonne qualité au dernier prélèvement de l'ARS ; l'eau du robinet commune par commune",
  };
}

// ---------------------------------------------------------------- sentiers de randonnée

const kmFr = (n: number) => String(n).replace(".", ",");
const meters = (n: number) => n.toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " ");

/** The fires seen by satellite, on the island's map: orange, apart from the closed trails. */
export const fireMarkers = (f: feux.Feux | undefined, now: Date) =>
  (f?.detections ?? []).map((d) => ({ lon: d.lon, lat: d.lat, label: "!", name: `${fire.listLine(d, now)} (${feux.LABEL})`, round: true, color: "#e8590c" }));

/** The section of the fires seen by satellite (worded by marketing): the emergency numbers always, a quiet day said as such. */
export function firesSection(f: feux.Feux | undefined, now: Date): string {
  if (!f) return "";
  const list = f.detections.length
    ? `<ul class="rows eau">${f.detections.map((d) => `<li><span>${esc(fire.listLine(d, now))}<small>${esc(d.commune)} · satellite ${esc(d.satellite)}</small></span><span class="q-mauvaise">feu</span></li>`).join("")}</ul>`
    : `<p>${esc(fire.QUIET)}</p>`;
  return `<section aria-labelledby="h-feux">
  <div class="sec-h"><p class="eyebrow">NASA FIRMS</p><h2 id="h-feux">Feux de végétation vus par satellite</h2>
  <p>${esc(fire.INTRO)}</p>
  <p><b>${esc(fire.URGENCE)}</b></p></div>
  <div class="card">${list}</div>
  <p class="note"><a href="/feux">La carte des feux des dernières 24 h →</a></p>
</section>`;
}

export function sentiersPage(origin: string, data: Cached<SentiersAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/sentiers`;
  const closed = d?.points.length ?? 0;

  const status = !d
    ? loading("L'état des sentiers")
    : `<div class="now"><span class="big">${closed}</span><p>sentier${closed > 1 ? "s" : ""} fermé${closed > 1 ? "s" : ""} sur <b>${d.suivis}</b> suivis par l'ONF` +
      `${d.carte_mise_a_jour ? `, d'après sa carte mise à jour le ${esc(d.carte_mise_a_jour.replace(" (ONF)", ""))}` : ""}.</p></div>`;

  const markers = [...(d?.points ?? []).map((p) => ({ lon: p.lon, lat: p.lat, label: "×", name: `${p.nom} : fermé`, round: true, color: "#c92a2a", quiet: true })), ...fireMarkers(d?.feux, now)];
  const fires = firesSection(d?.feux, now);
  const burning = !!d?.feux?.detections.length;

  const byCommune = d
    ? `<ul class="zones">${d.fermes_par_commune.map((c) =>
        `<li class="card"><h3>${esc(c.commune)} <span class="note">${c.sentiers_fermes.length} fermé${c.sentiers_fermes.length > 1 ? "s" : ""}</span></h3><ul class="rows eau">` +
        c.sentiers_fermes.map((t) => `<li><span>${t.page ? `<a href="${esc(t.page.replace(/^https:\/\/rundata\.re/, ""))}">${esc(t.sentier)}</a>` : esc(t.sentier)}<small>${[t.cause, t.precision].filter(Boolean).map((x) => esc(x!)).join(" · ") || "fermé"}</small>` +
          (t.randonnees?.length ? `<small class="cuts">Coupe : ${t.randonnees.map((r) => `<a href="/randonnees/${esc(r.slug)}">${esc(r.nom)}</a>`).join(", ")}</small>` : "") + `</span>` +
          `<span class="q-mauvaise">fermé</span></li>`).join("") + `</ul></li>`).join("")}</ul>`
    : `<p class="card">L'état des sentiers se charge : rechargez la page dans quelques secondes.</p>`;

  const roads = d?.routes_forestieres_fermees.length
    ? `<div class="card"><h3>Routes forestières interdites à la circulation</h3><ul class="rows eau">${d.routes_forestieres_fermees.map((r) =>
        `<li><span>${esc(r.route)}<small>${[r.cause, r.precision].filter(Boolean).map((x) => esc(x!)).join(" · ")}</small></span><span class="q-mauvaise">interdite</span></li>`).join("")}</ul></div>`
    : "";

  const hikes = `<section aria-labelledby="h-traces">
  <div class="card cta"><h2 id="h-traces">Choisir une randonnée</h2>
  <p>Les ${d?.randonnees.length ?? ""} itinéraires complets (GR R1, R2, R3, sommets, boucles) et les sentiers de l'ONF, avec leur trace GPS, leur distance, leur dénivelé et l'état du jour, sur une carte de l'île et filtrables : <a href="/randonnees">la page randonnée</a>.</p></div>
</section>`;

  const title = "Sentiers fermés Réunion aujourd'hui : liste ONF · 974";
  const short = "🇷🇪 Sentiers de randonnée fermés à La Réunion (974) : la liste de l'ONF commune par commune, avec la cause de chaque fermeture.";
  const base = d
    ? describe(`🇷🇪 Sentiers fermés à La Réunion (974) : ${closed} sentiers fermés sur ${d.suivis} d'après la carte de l'ONF, commune par commune, avec la cause (éboulement, sentier dégradé, travaux).`, short)
    : short;
  // The fires, when there is room for them (marketing): else the description stays as it was.
  const withFires = `${base.replace(/\.$/, "")}, et les feux de végétation détectés par satellite.`;
  const description = d?.feux && withFires.length <= DESCRIPTION_MAX ? withFires : base;

  const band = `${hikeCrumbBar("Sentiers fermés")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Carte de l'ONF</p>
    <h1>Sentiers fermés <span class="n974">974</span></h1>
    ${status}
    <p class="hero-cta"><a class="btn sun" href="/randonnees">${icon("mountain")}Randonnées et traces GPS</a></p>
    ${ask(`Lo santyé Roche Plate lé ouvèr ? Rogard si ${url} é di amwin si mi pé désann Mafate.`,
      `Le sentier de Roche Plate est-il ouvert ? Lis ${url} et dis-moi si je peux descendre dans Mafate.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : les sentiers de randonnée fermés" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Chaque croix est un sentier fermé${burning ? ", chaque point orange un feu détecté par satellite (faux positifs possibles)" : ""}.</figcaption></figure>
</div>`;

  const body = `${burning ? fires : ""}<section aria-labelledby="h-fermes">
  <div class="sec-h"><p class="eyebrow">Commune par commune</p><h2 id="h-fermes">Les sentiers fermés</h2>
  <p>Les sentiers gérés par l'ONF fermés par arrêté préfectoral ou par décision de l'ONF, avec la cause et, quand elle est connue, la date de réouverture. Les autres sentiers suivis par l'ONF sont ouverts.</p>
  <p>Par secteur, avec les itinéraires, les accès et la météo :</p>${sectorLinks()}</div>
  ${byCommune}
  ${roads}
  ${d ? warnings(d.a_savoir) : ""}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${burning ? "" : fires}
${hikes}
${connectorCta("sentiers_randonnee", "les sentiers de randonnée")}`;

  return layout(origin, { title, description, path: "/sentiers", jsonld: [hikeCrumbs(origin, "Sentiers fermés", "/sentiers"), webPage(origin, "/sentiers", title, description, data)], alerte }, band, body);
}

// ---------------------------------------------------------------- circulation

const WAZE_EMBED = "https://embed.waze.com/fr/iframe";
/** The views of the live map: the island, then the axes where the traffic jams are. */
const WAZE_VIEWS = [
  { nom: "Toute l'île", lat: -21.115, lon: 55.536, zoom: 10 },
  { nom: "Nord · Saint-Denis", lat: -20.895, lon: 55.475, zoom: 13 },
  { nom: "Ouest · route du Littoral", lat: -20.915, lon: 55.39, zoom: 13 },
  { nom: "Sud · Saint-Pierre", lat: -21.325, lon: 55.475, zoom: 13 },
  { nom: "Est · Saint-André, Saint-Benoît", lat: -20.985, lon: 55.66, zoom: 12 },
];
const wazeLink = (v: (typeof WAZE_VIEWS)[number]) => `https://www.waze.com/ul?ll=${v.lat},${v.lon}&zoom=${v.zoom}`;
const INFOTRAFIC = "https://www.infotrafic.re/";

// The live map is Waze's page: loaded on a click only, as it brings Google's cookies and the site promises none.
const WAZE_SCRIPT = `(()=>{const box=document.getElementById("wz-box"),go=document.getElementById("wz-go"),open=document.getElementById("wz-open");if(!box||!go)return;
let cur=document.querySelector(".wz-views a[aria-current]");const src=(a)=>"${WAZE_EMBED}?zoom="+a.dataset.z+"&lat="+a.dataset.lat+"&lon="+a.dataset.lon;
const frame=()=>box.querySelector("iframe");
go.addEventListener("click",()=>{const f=document.createElement("iframe");f.title="Carte Waze en direct : "+cur.textContent;f.src=src(cur);f.allowFullscreen=true;f.referrerPolicy="strict-origin-when-cross-origin";box.replaceChildren(f);box.classList.add("on")});
document.querySelectorAll(".wz-views a").forEach((a)=>a.addEventListener("click",(e)=>{e.preventDefault();cur.removeAttribute("aria-current");a.setAttribute("aria-current","true");cur=a;open.href=a.href;if(frame())frame().src=src(a)}));})();`;

export function traficPage(origin: string, data: Cached<TraficAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/trafic`;
  const first = WAZE_VIEWS[0];

  const views = `<nav class="wz-views" aria-label="Vues de la carte Waze">${WAZE_VIEWS.map((v, i) =>
    `<a href="${esc(wazeLink(v))}" data-lat="${v.lat}" data-lon="${v.lon}" data-z="${v.zoom}"${i ? "" : ' aria-current="true"'}>${esc(v.nom)}</a>`).join("")}</nav>`;
  const waze = `<figure class="card mapcard wz">
  <div id="wz-box" class="wz-box">${islandMap({ label: "Carte de La Réunion : la carte Waze en direct s'affiche ici à la demande", peaks: true })}
  <div class="wz-cover"><button type="button" id="wz-go" class="btn sun">${icon("map")}Afficher la carte Waze en direct</button></div></div>
  <figcaption class="note">La carte de Waze, chargée seulement si vous le demandez : Google et Waze y déposent des cookies, rundata.re aucun. ${views}
  <a id="wz-open" class="wz-open" href="${esc(wazeLink(first))}">Ouvrir dans Waze ↗</a></figcaption></figure>`;

  const band = `${crumbBar("Circulation")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Bouchons : Waze · état des routes : la Région</p>
    <h1>Bouchons et circulation à La Réunion <span class="n974">974</span></h1>
    <p class="lead">Les bouchons en direct sont sur la carte de Waze, l'état officiel des routes nationales sur <a href="${INFOTRAFIC}">infotrafic.re</a>, le site de la Région. rundata.re n'a pas la mesure des bouchons : la Région ne la rend pas réutilisable pour l'instant.</p>
    <p class="lead">La route du Littoral est basculée ou fermée ? L'état officiel est sur <a href="${INFOTRAFIC}">infotrafic.re</a>.</p>
    <p class="hero-cta"><a class="btn sun" href="${INFOTRAFIC}">${icon("car")}État des routes (Région)</a><a class="btn glass" href="${esc(wazeLink(first))}">${icon("map")}Ouvrir Waze</a></p>
    ${ask(`Lé bouché si la kat-voi astèr ? Rogard si ${url} é di amwin sak ou koné, é ousa mi pé rogard lo trafik.`,
      `Ça bouchonne sur la quatre-voies en ce moment ? Lis ${url} : dis-moi ce que tu sais (bus, routes forestières, vigilance) et où regarder le trafic en direct.`)}
  </div>
  ${waze}
</div>`;

  // The route du Littoral as the media announce it, never as a measure: the card stays when none did, for those who look for it.
  const lit = d?.littoral;
  const linked = (s: string) => esc(s).replace("infotrafic.re", `<a href="${INFOTRAFIC}">infotrafic.re</a>`);
  const said = (a: littoral.Annonce) =>
    `<b>${esc(littoral.etatText(a))}</b>, selon ${esc(a.media)}, <a href="${esc(a.lien)}" rel="noopener">${littoral.linkWord(a)}</a> publié ${esc(littoral.publieText(a, now))}.`;
  const littoralBody = lit
    ? lit.annonces.length > 1
      ? `<p>${linked(littoral.DISAGREE)}</p><ul class="plain">${lit.annonces.map((a) => `<li>${said(a)}</li>`).join("")}</ul>`
      : `<p>${esc(littoral.agePrefix(lit))}${said(lit.annonces[0])}</p>`
    : lit === null
      ? `<p>${linked(littoral.NONE)}</p>`
      : "";
  const littoralCard = `<section aria-labelledby="route-du-littoral">
  <div class="sec-h"><h2 id="route-du-littoral">Route du Littoral : ce qu'en disent les médias</h2></div>
  <div class="card">${icon("car")}${littoralBody}${lit === null ? "" : `<p class="note">${linked(lit ? littoral.A_SAVOIR : "L'état officiel, en direct, est sur infotrafic.re.")}</p>`}</div>
</section>`;

  const official = `<section aria-labelledby="h-officiel">
  <div class="sec-h"><p class="eyebrow">Source officielle</p><h2 id="h-officiel">L'état des routes, par la Région</h2></div>
  <a class="card link-card" href="${INFOTRAFIC}"><h3>${icon("car")}infotrafic.re ↗</h3>
  <p>Le Centre régional de gestion du trafic (CRGT) de la Région Réunion y publie l'état des routes nationales : vitesses entre les panneaux à messages variables, accidents, travaux, routes fermées, radiers, basculement de la route du Littoral, et ses caméras. C'est la référence ; rundata.re n'en reprend rien.</p></a>
</section>`;

  const vigilance = `<div class="card">${icon("alert")}<h3>Vigilance météo</h3>
  ${alerte ? `<p><span class="vg ${alerte.neutre ? "vgpre" : `vg${alerte.couleur}`}">${esc(alerte.texte)}</span></p><p>Par fortes pluies, des routes et des radiers ferment : la préfecture et la Région l'annoncent.</p>` : "<p>Pas de vigilance au-dessus du vert signalée en ce moment.</p>"}
  <p><a href="/vigilance">La vigilance zone par zone</a> · <a href="/meteo">la météo</a></p></div>`;

  const b = d?.bus;
  const busCard = !d
    ? `<div class="card">${loading("Les retards des bus")}</div>`
    : !b
      ? `<div class="card">${icon("bus")}<h3>Retards des bus</h3><p class="note">Le temps réel des bus ne répond pas pour le moment.</p></div>`
      : `<div class="card">${icon("bus")}<h3>Retards des bus au départ des gares</h3>
  <p class="note">Retards des bus, pas une mesure des bouchons : un car en retard l'est souvent depuis sa course précédente.</p>
  ${b.retards.length
    ? `<ul class="rows eau">${b.retards.slice(0, 12).map((r) => `<li><span>${esc(r.reseau)} ${esc(r.ligne)} vers ${esc(r.direction)}<small>gare ${esc(de(r.gare))}, départ prévu à ${esc(r.heure)}</small></span><span class="score">${r.retard_min} min</span></li>`).join("")}</ul>`
    : `<p>${b.suivis ? `Aucun des ${b.suivis} départs suivis en temps réel n'a plus de ${LATE_MIN} min de retard.` : "Pas de départ suivi en temps réel en ce moment."}</p>`}
  ${b.alertes.length ? `<h4>Déviations et avis des réseaux</h4>${alertList(b.alertes)}` : ""}
  ${b.temps_reel.length ? `<p class="note">Flux temps réel : ${b.temps_reel.map((t) => `${esc(t.reseau)} à ${esc(t.heure)}`).join(", ")}. <a href="/bus">Les prochains départs</a>.</p>` : `<p class="note"><a href="/bus">Les prochains départs</a>.</p>`}</div>`;

  const rf = d?.routes_forestieres;
  const roadsCard = !d
    ? ""
    : !rf
      ? `<div class="card">${icon("mountain")}<h3>Routes forestières</h3><p class="note">La carte de l'ONF ne répond pas pour le moment.</p></div>`
      : `<div class="card">${icon("mountain")}<h3>Routes forestières (ONF)</h3>
  <ul class="rows eau">${[...rf.principales, ...rf.interdites.filter((x) => !rf.principales.some((p) => p.route === x.route)).map((x) => ({ ...x, circulation: "Circulation interdite" }))].map((r) => {
    const shut = /interdit/i.test(r.circulation);
    const hours = /de \d+ ?h à \d+ ?h/i.exec(r.circulation)?.[0];
    const small = [r.cause, r.precision].filter(Boolean).map((x) => esc(x!)).join(" · ") || (hours ? `circulation ${esc(hours)}${r.circulation.includes(";") ? " sur une partie" : ""}` : "");
    return `<li><span>${esc(r.route)}${small ? `<small>${small}</small>` : ""}</span><span class="${shut ? "q-mauvaise" : "q-bonne"}">${shut ? "interdite" : "ouverte"}</span></li>`;
  }).join("")}</ul>
  <p class="note">Les routes du volcan, du Maïdo et de Bébour-Bélouve, et toutes celles que l'ONF interdit à la circulation${rf.mise_a_jour ? `, d'après sa carte mise à jour le ${esc(dayOf(rf.mise_a_jour))}` : ""}. <a href="/sentiers">Sentiers fermés</a>.</p></div>`;

  const enclos = d?.enclos
    ? `<div class="card">${icon("volcano")}<h3>Volcan : accès à l'Enclos</h3><p><b>${esc(ACCESS[d.enclos.statut] ?? d.enclos.statut)}</b>${d.enclos.detail ? ` : ${esc(d.enclos.detail)}` : ""}</p><p class="note"><a href="/volcan">Le volcan en direct</a>.</p></div>`
    : "";

  // What the media report on the roads and the blockades in the last hours, their headlines linked: first, as on a day of blockades it matters most.
  const medias = d?.medias?.length
    ? `<div class="card">${icon("book")}<h3>Signalé par les médias</h3><ul class="plain">${d.medias.map((m) => `<li><a href="${esc(m.lien)}" rel="noopener">${esc(m.titre)}</a> <span class="note">${esc(m.source)}${m.heure ? `, ${esc(m.heure)}` : ""}</span></li>`).join("")}</ul>
  <p class="note">Routes, barrages et manifestations dans les titres des six dernières heures, et les communiqués du jour de la préfecture : lire l'article pour le détail. <a href="/actualites">Toutes les actualités</a>.</p></div>`
    : "";

  // Before the 1st, the new order announced and the month in force below, as on /carburants.
  const s = d?.carburants && fuelSay(d.carburants, now);
  const fuel = s && (s.annonce || s.lignes)
    ? `<div class="card">${icon("car")}<h3>Prix des carburants</h3>` +
      (s.annonce ? `<p>${esc(keep(s.annonce))}.</p>${s.jusquau ? `<p>${esc(keep(s.jusquau))}.</p>` : ""}` : `<p>${esc(keep(`${s.depuis}, fixés par le préfet : ${s.lignes}`))}.</p>`) +
      `<p class="note">Les mêmes dans toute l'île : une station peut vendre moins cher. <a href="/carburants">Tous les prix du mois →</a></p></div>`
    : "";
  const ours = `<section aria-labelledby="h-nous">
  <div class="sec-h"><p class="eyebrow">Données ouvertes, en direct</p><h2 id="h-nous">Ce que rundata.re lit</h2>
  <p>Pas les bouchons : autour d'eux. La vigilance, les retards et déviations des bus, les routes forestières, le volcan, et ce que les médias signalent sur les routes.</p></div>
  <div class="two">${medias}${vigilance}${busCard}${roadsCard}${enclos}${fuel}</div>
  ${d && data && d.sources.length ? sourcesNote(d.sources, data) : ""}
</section>`;

  const why = `<section aria-labelledby="h-pourquoi"><div class="card warn">${icon("alert")}<h3 id="h-pourquoi">Pourquoi pas les bouchons ici</h3>
  <p>rundata.re n'a pas la mesure des bouchons : la Région ne la rend pas réutilisable pour l'instant, et aucune autre source ouverte ne mesure le trafic à La Réunion. Waze et Google ne permettent pas de reprendre leurs données. D'où la carte de Waze, chargée à votre demande, et le lien vers infotrafic.re.</p></div></section>`;

  const title = "Bouchons Réunion : carte Waze et état des routes · 974";
  const short = "🇷🇪 Circulation à La Réunion (974) : carte Waze des bouchons en direct, état officiel des routes sur infotrafic.re, retards des bus et routes forestières fermées.";
  // An announcement of the last hours leads the description; otherwise, what the page has.
  const fresh = lit && lit.annonces.length === 1 && lit.age_h < littoral.RECENT_HOURS ? lit.annonces[0] : undefined;
  const announced = fresh &&
    `🇷🇪 Route du Littoral : ${littoral.etatShort(fresh)} selon ${fresh.media} (${littoral.publieText(fresh, now).replace(/^aujourd'hui à /, "")}). Bouchons à La Réunion (974) : carte Waze, état officiel sur infotrafic.re.`;
  const description = announced
    ? describe(announced, describe(announced.replace(" (974)", ""), short))
    : "🇷🇪 Circulation à La Réunion (974) : carte Waze des bouchons, route du Littoral selon les médias, état officiel sur infotrafic.re, retards des bus.";
  const body = `${littoralCard}
${official}
${ours}
${why}
${connectorCta("transports", "les bus en temps réel")}
<script>${WAZE_SCRIPT}</script>`;
  return layout(origin, { title, description, path: "/trafic", jsonld: [crumbs(origin, "Circulation", "/trafic"), webPage(origin, "/trafic", title, description, data)], alerte }, band, body);
}

export function traficLive(data: Cached<TraficAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const n = d.routes_forestieres?.interdites.length ?? 0;
  return { valeur: "Waze en direct", detail: `et l'état des routes sur infotrafic.re ; ${n} route${n > 1 ? "s" : ""} forestière${n > 1 ? "s" : ""} fermée${n > 1 ? "s" : ""}` };
}

// ---------------------------------------------------------------- randonnée: the hikers' page

/** Breadcrumbs under the hikers' page: rundata.re › Randonnée › `name`. */
function hikeCrumbs(origin: string, name: string, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE, item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: "Randonnée", item: `${origin}/randonnees` },
      { "@type": "ListItem", position: 3, name, item: `${origin}${path}` },
    ],
  };
}
const hikeCrumbBar = (label: string) =>
  `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li><a href="/randonnees">Randonnée</a></li><li aria-current="page">${esc(label)}</li></ol></nav></div>`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const why_ = (x: { cause?: string; precision?: string }) => [x.cause, x.precision].filter(Boolean).map((v) => esc(v!)).join(" · ");

/** A closed ONF trail, linked to its page, with why and until when. */
const closedLi = (x: { sentier: string; slug?: string; page?: string; cause?: string; precision?: string }) => {
  const href = x.page ?? (x.slug ? `/sentiers/${x.slug}` : undefined);
  return `<li>${href ? `<a href="${esc(href)}">${esc(x.sentier)}</a>` : esc(x.sentier)}${why_(x) ? ` : ${why_(x)}` : ""}</li>`;
};

/** What the filter reads on a hike or a trail. */
const dataOf = (x: { k: string; km: number; dplus?: number; boucle: boolean }, etat: "o" | "f" | "i") =>
  `data-k="${x.k}" data-km="${x.km}" data-dp="${x.dplus ?? ""}" data-e="${etat}" data-b="${x.boucle ? 1 : 0}"`;

function hikeCard(h: HikeCard): string {
  const etat = h.fermes.length ? "f" : h.onf > h.inconnus.length ? "o" : "i";
  const state = h.fermes.length
    ? `<div class="shut"><p><b>${icon("alert")}${plural(h.fermes.length, "tronçon fermé", "tronçons fermés")}</b></p><ul>${h.fermes.map(closedLi).join("")}</ul></div>`
    : etat === "o"
      ? `<p class="okay">Tronçons suivis par l'ONF ouverts</p>`
      : `<p class="note">État non suivi par l'ONF : se renseigner avant de partir.</p>`;
  // Never counted as open: said apart.
  const unknown = etat !== "i" && h.inconnus.length ? `<p class="note">${plural(h.inconnus.length, "tronçon hors gestion ONF", "tronçons hors gestion ONF")} : état non connu.</p>` : "";
  const facts = [`${kmFr(h.km)} km`, `+${meters(h.dplus)} m`, h.alt_max != null ? `jusqu'à ${meters(h.alt_max)} m` : "", h.boucle ? "boucle" : "", h.secteur].filter(Boolean).join(" · ");
  return `<li class="card hike${h.fermes.length ? " closed" : ""}" ${dataOf(h, etat)}>
<h3><a href="/randonnees/${esc(h.slug)}">${esc(h.nom)}</a></h3><p class="note">${esc(facts)}</p>${state}${unknown}
<p class="links"><a href="/randonnees/${esc(h.slug)}">Carte et profil</a><a href="/randonnees/${esc(h.slug)}.gpx" download>GPX</a></p></li>`;
}

function trailLi(t: TrailItem): string {
  const e = t.etat === "fermé" ? "f" : t.etat === "ouvert" ? "o" : "i";
  const cls = e === "f" ? "q-mauvaise" : e === "o" ? "q-bonne" : "q-none";
  const label = e === "f" ? (t.partiel ? "fermé en partie" : "fermé") : e === "o" ? "ouvert" : "état inconnu";
  const small = [`${t.commune ? `${esc(t.commune)} · ` : ""}${kmFr(t.km)} km${t.dplus != null ? ` · +${meters(t.dplus)} m` : ""}${t.boucle ? " · boucle" : ""}`, why_(t)].filter(Boolean).join(" · ");
  const on = t.randonnees.length ? `<small>Sur : ${t.randonnees.map((r) => `<a href="/randonnees/${esc(r.slug)}">${esc(r.nom)}</a>`).join(", ")}</small>` : "";
  return `<li ${dataOf(t, e)}><span>${t.slug ? `<a href="/sentiers/${esc(t.slug)}">${esc(t.nom)}</a>` : esc(t.nom)}<small>${small}</small>${on}</span><span class="${cls}">${label}</span></li>`;
}

// The filter: shown once the script runs; without it, everything is listed.
const FILTER = `<form id="rf" class="card filter" hidden role="search" aria-label="Filtrer les randonnées et les sentiers">
<label class="q">Chercher <input name="q" type="search" placeholder="Mafate, Piton des Neiges, GR R2…" autocomplete="off"></label>
<label>Distance <select name="km"><option value="0-1e9">toutes</option><option value="0-5">moins de 5 km</option><option value="5-10">5 à 10 km</option><option value="10-20">10 à 20 km</option><option value="20-1e9">plus de 20 km</option></select></label>
<label>Dénivelé positif <select name="dp"><option value="0-1e9">tous</option><option value="0-300">moins de 300 m</option><option value="300-800">300 à 800 m</option><option value="800-1500">800 à 1 500 m</option><option value="1500-1e9">plus de 1 500 m</option></select></label>
<label>Parcours <select name="bo"><option value="">tous</option><option value="1">en boucle</option><option value="0">aller simple</option></select></label>
<label class="chk"><input name="ouv" type="checkbox"> Ouverts seulement</label>
<p class="note" id="rf-n" aria-live="polite"></p></form>`;

const FILTER_SCRIPT = `(()=>{const f=document.getElementById("rf");if(!f)return;f.hidden=false;
const items=[...document.querySelectorAll("li[data-k]")],lines={},row={};
const norm=(s)=>s.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
for(const e of items){row[e.dataset.k]=e;e.dataset.q=norm(e.textContent)+" "+norm(e.closest("details")?.querySelector("summary")?.textContent||"")}
document.querySelectorAll("#hmap [data-k]").forEach((p)=>(lines[p.dataset.k]??=[]).push(p));
document.getElementById("hmap").addEventListener("click",(ev)=>{const k=ev.target.dataset?.k,a=k&&row[k]?.querySelector("a");if(a)location.href=a.href});
const range=(v)=>v.split("-").map(Number);
const run=()=>{const q=norm(f.q.value).split(" ").filter(Boolean),[a,b]=range(f.km.value),[c,d]=range(f.dp.value),dpAll=f.dp.value==="0-1e9",open=f.ouv.checked,bo=f.bo.value;
const active=q.length||f.km.value!=="0-1e9"||!dpAll||open||bo!=="";let nr=0,ns=0;
for(const e of items){const x=e.dataset,km=+x.km,dp=x.dp===""?NaN:+x.dp;
const ok=q.every((t)=>x.q.includes(t))&&km>=a&&km<b&&(dpAll||(dp>=c&&dp<d))&&(!open||x.e==="o")&&(bo===""||x.b===bo);
e.hidden=!ok;for(const p of lines[x.k]||[])p.style.display=ok?"":"none";if(ok)x.k[0]==="r"?nr++:ns++}
document.querySelectorAll("details.sect").forEach((s)=>{const n=s.querySelectorAll("li[data-k]:not([hidden])").length;s.hidden=!n;s.querySelector(".cnt").textContent=n;if(active)s.open=n>0&&n<=40});
document.getElementById("rf-n").textContent=active?nr+" itinéraire"+(nr>1?"s":"")+" et "+ns+" sentier"+(ns>1?"s":"")+" correspondent.":"";};
f.addEventListener("input",run);f.addEventListener("submit",(e)=>e.preventDefault());})();`;

export function randonneesPage(origin: string, data: Cached<RandonneesAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/randonnees`;
  const nRoutes = d?.randonnees.length ?? 0;
  const cut = d?.randonnees.filter((h) => h.fermes.length) ?? [];

  const status = !d
    ? loading("La carte des randonnées")
    : `<div class="now"><span class="big">${nRoutes}</span><p>itinéraires et <b>${d.suivis}</b> sentiers de l'ONF avec leur trace GPS, leur distance et leur dénivelé. ` +
      `Aujourd'hui, <b>${plural(d.fermes, "sentier fermé", "sentiers fermés")}</b>${cut.length ? `, sur ${plural(cut.length, "itinéraire")}` : ""}.</p></div>`;

  const map = d
    ? `<figure class="card mapcard">${hikesMap(d.lignes, "Carte de La Réunion (974) : les itinéraires de randonnée et les sentiers de l'ONF, ouverts ou fermés")}
  <figcaption class="note legend"><span><i class="sw rte"></i>itinéraire avec trace</span><span><i class="sw ouvert"></i>sentier ouvert</span><span><i class="sw ferme"></i>fermé</span><span><i class="sw inconnu"></i>hors gestion ONF</span></figcaption></figure>`
    : "";

  const band = `${crumbBar("Randonnée")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Traces GPS · état ONF du jour</p>
    <h1>Randonnée à La Réunion <span class="n974">974</span></h1>
    ${status}
    <p class="hero-cta"><a class="btn sun" href="#itineraires">${icon("mountain")}Choisir une rando</a><a class="btn glass" href="/sentiers">${icon("alert")}Sentiers fermés${d ? ` (${d.fermes})` : ""}</a></p>
    ${ask(`Mi rod inn rando 10 km dan Silaos, lé ouvèr ? Rogard si ${url} é di amwin.`,
      `Je cherche une randonnée d'environ 10 km à Cilaos, ouverte en ce moment : lis ${url} et propose-m'en une avec sa trace GPS.`)}
  </div>
  ${map}
</div>`;

  const closures = cut.length
    ? `<div class="card warn alarm">${icon("alert")}<h3>${plural(cut.length, "itinéraire coupé", "itinéraires coupés")} par une fermeture</h3>
  <ul class="plain">${cut.map((h) => `<li><a href="/randonnees/${esc(h.slug)}">${esc(h.nom)}</a> : ${h.fermes.map((f) => (f.slug ? `<a href="/sentiers/${esc(f.slug)}">${esc(f.sentier)}</a>` : esc(f.sentier)) + (f.cause ? ` (${esc(f.cause)})` : "")).join(", ")}</li>`).join("")}</ul>
  <p class="note">Un sentier fermé est interdit, même avec la trace : prendre une variante ouverte ou choisir une autre randonnée. <a href="/sentiers">Tous les sentiers fermés</a>.</p></div>`
    : "";

  const routes = d
    ? `<section aria-labelledby="h-itineraires" id="itineraires">
  <div class="sec-h"><p class="eyebrow">GPX à télécharger</p><h2 id="h-itineraires">Les itinéraires avec trace GPS</h2>
  <p>Les randonnées complètes relevées par les contributeurs d'OpenStreetMap : GR R1, R2, R3, sommets, boucles. Distance et dénivelé d'après les altitudes de l'IGN ; l'état vient de la carte de l'ONF, sentier par sentier.</p></div>
  <p class="note">Par secteur :</p>
  ${sectorLinks()}
  ${FILTER}
  ${closures}
  <ul class="zones hikes">${d.randonnees.map(hikeCard).join("")}</ul>
</section>`
    : `<p class="card">Les randonnées se chargent : rechargez la page dans quelques secondes.</p>`;

  const trails = d
    ? `<section aria-labelledby="h-secteurs">
  <div class="sec-h"><p class="eyebrow">Secteur par secteur</p><h2 id="h-secteurs">Les ${d.suivis} sentiers de l'ONF</h2>
  <p>Chaque sentier a sa page avec sa carte, son profil et sa trace GPS. Un sentier est rangé dans le secteur où passe la plus grande partie de son tracé.</p></div>
  ${d.secteurs.map((z) => {
    const shut = z.sentiers.filter((t) => t.etat === "fermé").length;
    return `<details class="card sect"><summary><h3>${esc(z.secteur)}</h3><span class="note"><span class="cnt">${z.sentiers.length}</span> sentiers${shut ? ` · <b class="q-mauvaise">${shut} fermé${shut > 1 ? "s" : ""}</b>` : ""} · ${esc(z.communes.join(", "))}</span></summary>
  <ul class="rows eau">${z.sentiers.map(trailLi).join("")}</ul>${secteurNamed(z.secteur) ? `<p class="note"><a href="/randonnees/${secteurNamed(z.secteur)!.slug}">Randonnée ${esc(secteurNamed(z.secteur)!.dans)} : itinéraires, accès et météo →</a></p>` : ""}</details>`;
  }).join("\n  ")}
</section>`
    : "";

  const safety = `<section aria-labelledby="h-partir">
  <div class="sec-h"><h2 id="h-partir">Avant de partir</h2></div>
  <div class="card warn">${icon("alert")}<ul class="plain">
    <li><b>Un sentier fermé est interdit.</b> Il l'est par arrêté préfectoral ou par l'ONF (éboulement, passage effondré, travaux) : s'y engager est dangereux et verbalisable, même avec une trace GPS. <a href="/sentiers">La liste du jour</a>.</li>
    <li><b>La météo d'abord.</b> Regarder la <a href="/vigilance">vigilance de Météo-France</a> et la <a href="/meteo">prévision</a> la veille et le matin. Par fortes pluies ou orages, ne pas partir : les ravines montent en quelques minutes et la préfecture ferme d'autres sentiers.</li>
    <li><b>Partir tôt.</b> Les nuages montent dans les Hauts en fin de matinée et il pleut souvent l'après-midi ; la nuit tombe entre 17 h 45 et 19 h selon la saison (<a href="/calendrier">lever et coucher du soleil</a>).</li>
    <li><b>De l'eau, assez.</b> Au moins deux litres par personne, davantage en été et sur les longues montées. Ne pas boire l'eau des ravines sans la traiter.</li>
    <li><b>Hors gestion ONF</b> veut dire état non connu, pas ouvert : se renseigner auprès de la commune ou du Parc national.</li>
    <li>Dire à quelqu'un où l'on va et quand on rentre : le téléphone ne passe pas partout dans les cirques. Au volcan, voir aussi <a href="/volcan">l'état du Piton de la Fournaise</a>. Urgence : 112.</li>
  </ul></div>
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>`;

  const title = "Randonnée Réunion : traces GPS et sentiers ouverts · 974";
  const short = "🇷🇪 Randonnée à La Réunion (974) : itinéraires et sentiers de l'ONF avec trace GPS (GPX), distance, dénivelé et état du jour.";
  const description = d
    ? describe(`🇷🇪 Randonnée à La Réunion (974) : ${nRoutes} itinéraires (GR R1, R2, R3, Piton des Neiges…) et ${d.suivis} sentiers de l'ONF avec trace GPS (GPX), distance, dénivelé et état du jour : ${d.fermes} fermés.`, short)
    : short;
  const list = d
    ? [{
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "Itinéraires de randonnée avec trace GPS à La Réunion",
        itemListElement: d.randonnees.map((h, i) => ({ "@type": "ListItem", position: i + 1, name: h.nom, url: `${origin}/randonnees/${h.slug}` })),
      }]
    : [];

  const body = `${hautsBlock(d?.hauts)}${routes}
${trails}
${safety}
${connectorCta("sentiers_randonnee", "la randonnée")}
<script>${FILTER_SCRIPT}</script>`;
  return layout(origin, { title, description, path: "/randonnees", jsonld: [crumbs(origin, "Randonnée", "/randonnees"), webPage(origin, "/randonnees", title, description, data), ...list], alerte }, band, body);
}

/** Where the cloud sea will be in the coming morning, for each summit and village of the Hauts (tools/nuages.ts). */
function hautsBlock(hauts: RandonneesAnswer["hauts"]): string {
  if (!hauts?.length) return "";
  const when = hauts[0].titre.replace(/^Mer de nuages /, "");
  const line = (h: NonNullable<RandonneesAnswer["hauts"]>[number]) => {
    const name = h.slug ? `<a href="/meteo/${h.slug}#mer-de-nuages">${esc(h.nom)}</a>` : esc(h.nom);
    // During a volcano alert, the viewpoint over the Enclos says it is forbidden: « dégagé » must not call anyone down.
    // And always where the texts say what is open there: /volcan#monter.
    const enclos = h.enclos ? `${volcanBanner() ? ` ${esc(ENCLOS)}` : ""} <a href="/volcan#monter">${esc(TITRE)} →</a>` : "";
    return `<li>${name}${esc(h.resume.slice(h.nom.length))}${enclos}</li>`;
  };
  return `<section id="mer-de-nuages" aria-labelledby="h-hauts"><div class="sec-h"><h2 id="h-hauts">Les Hauts ${esc(when)} : au-dessus ou dans les nuages ?</h2>
  <p>Où sera la mer de nuages entre 6\u00a0h et midi, pour chaque sommet et village des Hauts. Prévision du modèle AROME de Météo-France, pas une mesure : regardez aussi le ciel et la station la plus proche avant de partir.</p></div>
  <div class="card"><ul class="plain">${hauts.map(line).join("")}</ul><p class="note">${esc(cap(hauts[0].prevision))}. ${esc(hauts[0].mise_en_garde)}</p></div></section>
`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function randonneesLive(data: Cached<SentiersAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const n = d.points.length;
  return { valeur: `${n} sentier${n > 1 ? "s" : ""} fermé${n > 1 ? "s" : ""}`, detail: `sur ${d.suivis} suivis par l'ONF ; traces GPS, distance et dénivelé de ${d.randonnees.length} randonnées et de chaque sentier` };
}

/** The sectors of the hikes as links, the page's own marked: on /randonnees, /sentiers and each sector's page. */
export function sectorLinks(current?: string): string {
  return `<nav class="parts" aria-label="Randonnée par secteur">${SECTEURS_RANDO.map((s) =>
    `<a href="/randonnees/${s.slug}"${s.slug === current ? ` aria-current="page"` : ""}>${esc(s.nom)}</a>`).join("")}</nav>`;
}

/** The trail of a page under a sector: rundata.re › Randonnée › Sector (› name), as links and for search engines. */
export function sectorTrail(origin: string, s: Secteur, leaf?: { name: string; path: string }) {
  const items: [string, string][] = [[SITE, "/"], ["Randonnée", "/randonnees"], [s.nom, `/randonnees/${s.slug}`], ...(leaf ? [[leaf.name, leaf.path] as [string, string]] : [])];
  const bar = `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol>${items.map(([n, p], i) =>
    i < items.length - 1 ? `<li><a href="${p}">${esc(n)}</a></li>` : `<li aria-current="page">${esc(n)}</li>`).join("")}</ol></nav></div>`;
  const jsonld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([n, p], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: `${origin}${p}` })),
  };
  return { bar, jsonld };
}

// What the sectors' pages (randonnees.ts) share with the hikers' page.
export { closedLi, hikeCard, plural, trailLi };

// ---------------------------------------------------------------- a trail's or a hike's page, with its GPS trace

/** `summit`: the summit the trace reaches, when the page its link leads to tells the morning's cloud sea (site.ts). */
export function tracePage(origin: string, kind: "sentier" | "randonnee", slug: string, nom: string, data: Cached<TraceAnswer> | null, now = new Date(), alerte?: Alerte, summit?: Summit): string {
  const d = data?.value;
  const path = `/${kind === "sentier" ? "sentiers" : "randonnees"}/${slug}`;
  const gpx = `${path}.gpx`;
  const what = kind === "sentier" ? "sentier de l'ONF" : "itinéraire OpenStreetMap";

  const facts = d
    ? `<dl class="facts"><div><dt>${d.boucle ? "En boucle" : "Longueur"}</dt><dd>${kmFr(d.km)} km</dd></div>` +
      (d.dplus != null ? `<div><dt>Dénivelé positif</dt><dd>${meters(d.dplus)} m</dd></div><div><dt>Dénivelé négatif</dt><dd>${meters(d.dmoins ?? 0)} m</dd></div>` : "") +
      (d.alt_max != null ? `<div><dt>Altitudes</dt><dd>${meters(d.alt_min ?? 0)} – ${meters(d.alt_max)} m</dd></div>` : "") + `</dl>`
    : loading("La trace");

  const state = d ? `<p class="lead">${d.ferme ? "<b>" : ""}${esc(d.etat)}${d.ferme ? "</b>" : ""}</p>` : "";
  // A hike crossing a closed trail says so before anything else: above the map and the download.
  const alarm = d?.fermes.length
    ? `<div class="alarm-band" role="alert">${icon("alert")}<div><p><b>Attention : ${plural(d.fermes.length, "tronçon fermé", "tronçons fermés")} sur cet itinéraire.</b> S'y engager est interdit, même avec la trace : prendre une variante ouverte ou renoncer.</p>
  <ul>${d.fermes.map((f) => closedLi(f)).join("")}</ul></div></div>`
    : "";
  const unknown = d?.inconnus.length
    ? `<p class="note soft">${plural(d.inconnus.length, "tronçon", "tronçons")} hors gestion ONF, état non connu (ni ouvert ni fermé ici) : ${d.inconnus.map((x) => (x.page ? `<a href="${esc(x.page)}">${esc(x.sentier)}</a>` : esc(x.sentier))).join(", ")}. Se renseigner auprès de la commune ou du Parc national.</p>`
    : "";
  const partOf = d?.randonnees.length
    ? `<p class="part-of">Fait partie de : ${d.randonnees.map((r) => `<a href="/randonnees/${esc(r.slug)}">${esc(r.nom)}</a>`).join(", ")}</p>`
    : "";
  const download = `<p class="hero-cta"><a class="btn sun" href="${esc(gpx)}" download>${icon("pin")}Télécharger le GPX</a></p>`;

  const map = d?.lignes.length
    ? `<figure class="card mapcard">${traceMap({ lines: d.lignes, label: `Carte : la trace de ${nom}` })}
  <figcaption class="note" style="color:var(--on-night-muted)">${kind === "sentier" ? "En jaune ouvert, en rouge pointillé fermé, en gris hors gestion ONF. " : d.fermes.length ? "En rouge pointillé, les tronçons fermés. " : ""}Le rond blanc marque le départ de la trace.</figcaption></figure>`
    : "";

  const profileBlock = d?.profil.length
    ? `<section aria-labelledby="h-profil"><div class="sec-h"><p class="eyebrow">Altitudes IGN</p><h2 id="h-profil">Profil</h2></div>
  <figure class="card">${profile(d.profil, `Profil en altitude de ${nom}`)}</figure></section>`
    : "";

  const rows = d?.troncons.length
    ? `<ul class="rows eau">${d.troncons.map((t) => {
        const cls = t.etat === "fermé" ? "q-mauvaise" : t.etat === "ouvert" ? "q-bonne" : "q-none";
        const name = t.sentier ? (t.page ? `<a href="${esc(t.page)}">${esc(t.sentier)}</a>` : esc(t.sentier)) : esc(nom);
        return `<li><span>${name}<small>${[t.cause, t.precision].filter(Boolean).map((x) => esc(x!)).join(" · ")}</small></span><span class="${cls}">${esc(t.etat)}</span></li>`;
      }).join("")}</ul>`
    : "";
  const stateBlock = rows
    ? `<section aria-labelledby="h-etat"><div class="sec-h"><p class="eyebrow">Carte de l'ONF</p><h2 id="h-etat">${kind === "sentier" ? "État du sentier" : "Les sentiers de l'ONF sur le parcours"}</h2>
  <p>${kind === "sentier" ? "L'état publié par l'ONF, tronçon par tronçon." : "Les sentiers gérés par l'ONF que suit cet itinéraire, avec leur état du moment : un tronçon fermé l'est par arrêté préfectoral ou décision de l'ONF."}</p></div>
  <div class="card">${rows}</div></section>`
    : "";

  const others = d?.randonnees.length
    ? `<p class="note">${d.ferme ? "Ce sentier fermé coupe" : "Ce sentier fait partie de"} : ${d.randonnees.map((r) => `<a href="/randonnees/${esc(r.slug)}">${esc(r.nom)}</a>`).join(", ")}.</p>`
    : "";

  // The sector the most of it lies in (computed with the traces); a route across several names them.
  const route = kind === "randonnee" ? traces.randonnee(slug) : undefined;
  const sector = secteurNamed(kind === "sentier" ? traces.sentier(slug)?.secteur : route?.secteur);
  const named = sector && !normalize(nom).includes(normalize(sector.nom)) ? ` (${sector.nom})` : "";
  // Within the 60 characters a search engine shows: the sector, then « état ONF », give way to a long name.
  const title = [`${nom}${named} : trace GPX, état ONF · 974`, `${nom}${named} : trace GPX · 974`, `${nom} : trace GPX, état ONF · 974`, `${nom} : trace GPX · 974`]
    .find((t) => t.length <= TITLE_MAX) ?? `${nom} : trace GPX · 974`;
  const short = `🇷🇪 ${nom} (La Réunion, 974) : trace GPS à télécharger (GPX), longueur, dénivelé, profil et état du sentier d'après l'ONF.`;
  const where = sector ? `${sector.nom}, La Réunion` : "La Réunion";
  const description = d
    ? describe(`🇷🇪 ${nom} (${where}) : ${kmFr(d.km)} km${d.dplus != null ? `, ${d.dplus} m de dénivelé positif` : ""}. ${d.etat}. Trace GPS à télécharger (GPX) et profil.`,
        describe(`🇷🇪 ${nom} (La Réunion) : ${kmFr(d.km)} km${d.dplus != null ? `, ${d.dplus} m de dénivelé positif` : ""}. ${d.etat}. Trace GPS à télécharger (GPX) et profil.`, short))
    : short;
  const trail = sector ? sectorTrail(origin, sector, { name: nom, path }) : { bar: hikeCrumbBar(nom), jsonld: hikeCrumbs(origin, nom, path) };
  const jsonld = [trail.jsonld, webPage(origin, path, title, description, data)];

  // Where it is, in one sentence: « Sentier de l'ONF à Mafate, sur le GR R2 et le GR R3. », the routes linked.
  const on = (d?.randonnees ?? []).map((r) => `${/^[GP]R\b/.test(r.nom) ? "le " : ""}<a href="/randonnees/${esc(r.slug)}">${esc(r.nom)}</a>`);
  const crossed = (route?.secteurs ?? []).map((n) => secteurNamed(n)).filter((x): x is NonNullable<typeof x> => !!x);
  const lead = kind === "sentier"
    ? sector ? `Sentier de l'ONF ${esc(sector.dans)}${on.length ? `, sur ${on.length > 1 ? `${on.slice(0, -1).join(", ")} et ${on.at(-1)}` : on[0]}` : ""}.` : ""
    : sector ? `Itinéraire de randonnée ${esc(sector.dans)}.` : crossed.length > 1 ? `Itinéraire de randonnée qui passe ${crossed.slice(0, -1).map((x) => esc(x.dans)).join(", ")} et ${esc(crossed.at(-1)!.dans)}.` : "";
  const leadHtml = lead ? `<p class="lead part-of">${lead}${sector ? ` <a href="/randonnees/${sector.slug}">Randonnée ${esc(sector.dans)} →</a>` : ""}</p>` : "";
  // A trail of the volcano: what the official texts say of going up, place by place (/volcan).
  const monter = sector?.slug === "volcan" ? `<p class="note"><a href="/volcan#monter">Puis-je monter au volcan ? Ce que disent les textes officiels, lieu par lieu →</a></p>` : "";

  const band = `${trail.bar}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Trace GPS · ${esc(what)}</p>
    <h1>${esc(nom)}</h1>
    ${leadHtml}${monter}
    ${alarm || state}
    ${kind === "sentier" && sector ? "" : partOf}
    ${facts}
    ${download}
    ${unknown}
  </div>
  ${map}
</div>`;

  const body = `${profileBlock}
${stateBlock}
<section aria-labelledby="h-savoir">
  <div class="sec-h"><h2 id="h-savoir">Avant de partir</h2>
  <p>La trace GPX s'ouvre dans les applications de randonnée et les montres GPS. ${kind === "sentier" ? "C'est le sentier tel que l'ONF le trace sur sa carte, à pleine résolution." : "C'est l'itinéraire complet tel que les contributeurs d'OpenStreetMap l'ont relevé ; il peut emprunter des sentiers fermés : voir leur état ci-dessus."} Altitudes, dénivelés et profil : modèle de terrain de l'IGN (RGE ALTI).</p>
  ${others}
  ${weatherForTrace((d?.lignes ?? []).flatMap((l) => l.points))}
  ${cloudSeaLink(summit)}</div>
  ${warnings([
    "Un sentier fermé l'est par arrêté préfectoral ou décision de l'ONF : s'y engager est interdit et dangereux, même avec une trace.",
    "Vérifier la vigilance météo avant de partir : par fortes pluies, les ravines montent vite et la préfecture ferme d'autres sentiers.",
    "Une trace ne remplace ni le balisage ni une carte. Urgence en montagne : 112.",
  ])}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("sentiers_randonnee", "les sentiers de randonnée")}`;

  return layout(origin, { title, description, path, jsonld, alerte }, band, body);
}

// ---------------------------------------------------------------- sécheresse

const DROUGHT_COLOR: Record<string, string> = { vigilance: "#ffd43b", alerte: "#ff922b", "alerte renforcée": "#f03e3e", crise: "#862e9c" };
const DROUGHT_ORDER = ["crise", "alerte renforcée", "alerte", "vigilance"];
const droughtBadge = (n?: string) => (n ? `<span class="lvl" style="--c:${DROUGHT_COLOR[n] ?? "#868e96"}">${esc(n)}</span>` : `<span class="note">aucune</span>`);

export function secheressePage(origin: string, data: Cached<SecheresseAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/secheresse`;
  const hit = d?.communes.filter((c) => c.eau_du_robinet && c.eau_du_robinet !== "vigilance") ?? [];

  const fills: Record<string, string> = {};
  for (const c of d?.communes ?? []) {
    const nm = MAP_NAME.get(normalize(c.commune));
    if (nm && c.eau_du_robinet) fills[nm] = DROUGHT_COLOR[c.eau_du_robinet] ?? "";
  }

  const status = !d
    ? loading("Les restrictions d'eau")
    : d.communes.length
      ? `<div class="now"><span class="big">${hit.length}</span><p>commune${hit.length > 1 ? "s" : ""} sur 24 en alerte ou plus pour l'eau du robinet${d.arrete_du ? `, d'après l'arrêté préfectoral en vigueur depuis le ${esc(d.arrete_du)}` : ""}.</p></div>`
      : `<p class="lead">${esc(d.resume)}</p>`;

  const table = d?.communes.length
    ? `<div class="card table-wrap"><table class="drought"><thead><tr><th>Commune</th><th>Eau du robinet</th><th>Rivières et sources</th><th>Nappes</th></tr></thead><tbody>${d.communes.map((c) =>
        `<tr><th scope="row">${esc(c.commune)}</th><td>${droughtBadge(c.eau_du_robinet)}</td><td>${droughtBadge(c.rivieres_et_sources)}</td><td>${droughtBadge(c.nappes)}</td></tr>`).join("")}</tbody></table></div>`
    : "";

  const rules = (d?.interdits ?? []).sort((x, y) => DROUGHT_ORDER.indexOf(x.niveau) - DROUGHT_ORDER.indexOf(y.niveau)).map((x) =>
    `<li class="card"><h3>${droughtBadge(x.niveau)} <span class="note">${esc(x.communes.join(", "))}</span></h3><ul class="rows eau">` +
    (x.restrictions.length ? x.restrictions.map((r) => `<li><span>${esc(r.usage)}<small>${esc(r.restriction)}</small></span><span></span></li>`).join("") : `<li><span>Économiser l'eau : pas d'interdiction pour un particulier.</span><span></span></li>`) +
    `</ul></li>`).join("");

  const title = "Restrictions d'eau Réunion : sécheresse par commune · 974";
  const short = "🇷🇪 Restrictions d'eau à La Réunion (974) : le niveau de sécheresse de chaque commune et ce qui est interdit (arrosage, lavage, piscine), d'après l'arrêté préfectoral.";
  const description = d ? describe(`🇷🇪 ${d.resume}`, short) : short;

  const band = `${crumbBar("Sécheresse")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Arrêté en vigueur</p>
    <h1>Sécheresse <span class="n974">974</span></h1>
    ${status}
    ${ask(`Mi gingn arouz mon zardin Sin-Zozèf ? Rogard si ${url} é di amwin sak lé défandi.`,
      `Ai-je le droit d'arroser mon jardin à Saint-Joseph ? Lis ${url} et dis-moi ce qui est interdit.`)}
  </div>
  <figure class="card mapcard">${islandMap({ fills, label: "Carte de La Réunion (974) colorée par le niveau de restriction de l'eau du robinet de chaque commune" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Eau du robinet : <span style="color:#ffd43b">vigilance</span>, <span style="color:#ff922b">alerte</span>, <span style="color:#f03e3e">alerte renforcée</span>, <span style="color:#d0a4e0">crise</span>.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-communes-eau">
  <div class="sec-h"><p class="eyebrow">Commune par commune</p><h2 id="h-communes-eau">Les niveaux de restriction</h2>
  <p>${d ? esc(d.resume) : ""} ${d ? esc(d.echelle) : ""}</p></div>
  ${table || (d ? "" : `<p class="card">Les restrictions se chargent : rechargez la page dans quelques secondes.</p>`)}
</section>
${rules ? `<section aria-labelledby="h-interdits">
  <div class="sec-h"><p class="eyebrow">Pour un particulier</p><h2 id="h-interdits">Ce qui est interdit</h2>
  <p>Les usages de l'eau du robinet limités à chaque niveau. Les agriculteurs, entreprises et collectivités ont leurs propres règles : demandez à votre IA avec le connecteur.</p></div>
  <ul class="zones">${rules}</ul>
  ${d ? `<p class="note">${esc(d.a_savoir)}</p>` : ""}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>` : ""}
${connectorCta("restrictions_eau", "les restrictions d'eau")}`;

  return layout(origin, { title, description, path: "/secheresse", jsonld: [crumbs(origin, "Sécheresse", "/secheresse"), webPage(origin, "/secheresse", title, description, data)], alerte }, band, body);
}

export function secheresseLive(data: Cached<SecheresseAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  if (!d.communes.length) return { valeur: "aucune restriction", detail: "d'après VigiEau" };
  const worst = DROUGHT_ORDER.find((n) => d.communes.some((c) => c.eau_du_robinet === n));
  const hit = d.communes.filter((c) => c.eau_du_robinet && c.eau_du_robinet !== "vigilance").length;
  return { valeur: worst ? `jusqu'à ${worst}` : "vigilance", detail: `${hit} commune${hit > 1 ? "s" : ""} sur 24 en alerte ou plus pour l'eau du robinet` };
}

// ---------------------------------------------------------------- coupures d'eau

function noticeCard(n: CoupuresAnswer["avis"][number]): string {
  const cut = n.coupure ? `<p><b>${esc(n.coupure.de ?? "")}${n.coupure.a ? ` → ${esc(n.coupure.a)}` : ""}</b>${n.coupure.etat ? ` <span class="note">(${esc(n.coupure.etat)})</span>` : ""}</p>` : "";
  return `<li class="card${n.ne_pas_boire ? " warn" : ""}"><h3>${n.ne_pas_boire ? "Ne pas boire l'eau · " : ""}${esc(n.communes.join(", "))} <span class="note">${esc(n.distributeur)}, publié le ${esc(n.publie_le)}</span></h3>` +
    `<p>${esc(n.titre)}</p>${cut}${n.secteurs ? `<p class="note">Secteurs : ${esc(n.secteurs.join(", "))}</p>` : ""}` +
    `<p class="note">${esc(n.texte.length > 320 ? `${n.texte.slice(0, 320)}…` : n.texte)}${n.lien ? ` <a href="${esc(n.lien)}" rel="noopener">L'avis complet</a>` : ""}</p></li>`;
}

export function coupuresPage(origin: string, data: Cached<CoupuresAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/coupures-eau`;
  const dry = d?.ne_pas_boire ?? [];

  const fills: Record<string, string> = {};
  for (const c of d?.communes_suivies ?? []) {
    const nm = MAP_NAME.get(normalize(c));
    if (!nm) continue;
    fills[nm] = dry.includes(c) ? "#f03e3e" : d!.avis.some((n) => n.communes.includes(c)) ? "#4dabf7" : "#a5d8ff";
  }

  const status = !d
    ? loading("Les avis des distributeurs")
    : `<div class="now"><span class="big">${d.avis.length}</span><p>avis de coupure ou de travaux récents ou à venir` +
      `${dry.length ? ` ; <b>eau à ne pas boire</b> : ${esc(dry.join(", "))}` : ""}.</p></div>`;

  const list = d
    ? d.avis.length
      ? `<ul class="zones">${[...d.avis].sort((x, y) => Number(!!y.ne_pas_boire) - Number(!!x.ne_pas_boire)).map(noticeCard).join("")}</ul>`
      : `<p class="card">Aucun avis de coupure récent ou à venir dans les communes suivies.</p>`
    : `<p class="card">Les avis se chargent : rechargez la page dans quelques secondes.</p>`;

  // Up the page in the cyclone season, at its foot the rest of the year.
  const cyclone = cycloneWater(now);
  const title = "Coupure d'eau Réunion aujourd'hui : avis en cours · 974";
  const short = "🇷🇪 Coupures d'eau à La Réunion (974) : les avis de Dionéo, des Eaux de La Possession et de la CIREST, heures, rues concernées et avis « ne pas boire l'eau ».";
  const description = d ? describe(`🇷🇪 ${d.resume} Coupures d'eau à La Réunion (974) : heures, rues concernées et avis « ne pas boire l'eau ».`, short) : short;

  const band = `${crumbBar("Coupures d'eau")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Avis des distributeurs</p>
    <h1>Coupures d'eau <span class="n974">974</span></h1>
    ${status}
    ${ask(`Néna koupir dolo Sin-Dni ? Rogard si ${url} é di amwin kansa dolo i rovien.`,
      `Y a-t-il une coupure d'eau à Saint-Denis ? Lis ${url} et dis-moi quand l'eau revient.`)}
  </div>
  <figure class="card mapcard">${islandMap({ fills, label: "Carte de La Réunion (974) : les communes dont les avis de coupure d'eau sont suivis" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Communes suivies : <span style="color:#f03e3e">eau à ne pas boire</span>, <span style="color:#4dabf7">avis en cours</span>, <span style="color:#a5d8ff">aucun avis</span>.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-avis">
  <div class="sec-h"><p class="eyebrow">Récents ou à venir</p><h2 id="h-avis">Les avis</h2>
  <p>${d ? esc(d.couverture) : ""}</p></div>
  ${list}
  ${d ? `<p class="note">${esc(d.a_savoir)}</p>` : ""}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${cyclone.lead ? cyclone.html : ""}
${connectorCta("coupures_eau", "les coupures d'eau")}
${cyclone.lead ? "" : cyclone.html}`;

  return layout(origin, { title, description, path: "/coupures-eau", jsonld: [crumbs(origin, "Coupures d'eau", "/coupures-eau"), webPage(origin, "/coupures-eau", title, description, data)], alerte }, band, body);
}

// What the communes' water pages (coupures.ts) share with the island's.
export { droughtBadge, noticeCard, tapCard };

export function coupuresLive(data: Cached<CoupuresAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const dry = d.ne_pas_boire ?? [];
  return {
    valeur: dry.length ? `ne pas boire : ${esc(dry.join(", "))}` : `${d.avis.length} avis`,
    detail: dry.length ? `${d.avis.length} avis de coupure ou de travaux récents ou à venir` : "de coupure ou de travaux récents ou à venir",
  };
}

// ---------------------------------------------------------------- défibrillateurs

const shortAccess = (a: string) =>
  a.includes("extérieur") ? "dehors, 24 h/24" : a.includes("24 h") ? "24 h/24" : a.includes("accès libre") ? "horaires du lieu" : "accès réservé";

export function daePage(origin: string, data: Cached<DaeAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/defibrillateurs`;
  const markers = (d?.communes ?? []).map((c) => ({ lon: c.lon, lat: c.lat, label: String(c.nombre), name: `${c.commune} : ${c.nombre} défibrillateurs`, round: true, color: "#2b8a3e", quiet: true }));

  const status = !d
    ? loading("La liste des défibrillateurs")
    : `<div class="now"><span class="big">${d.total}</span><p>défibrillateurs déclarés en service dans les 24 communes de l'île.</p></div>`;

  const list = d
    ? `<ul class="zones">${d.communes.map((c) =>
        `<li class="card"><h3>${esc(c.commune)} <span class="note">${c.nombre} défibrillateur${c.nombre > 1 ? "s" : ""}${c.toute_heure ? `, dont ${c.toute_heure} accessible${c.toute_heure > 1 ? "s" : ""} à toute heure` : ""}</span></h3><ul class="rows eau">` +
        c.liste.map((x) => `<li><span>${esc(x.lieu)}<small>${[x.adresse, x.emplacement, x.etage ? `étage ${x.etage}` : ""].filter(Boolean).map((v) => esc(v!)).join(" · ")}</small></span>` +
          `<span class="${x.acces.includes("toute heure") || x.acces.includes("24 h") ? "q-bonne" : "q-none"}">${esc(shortAccess(x.acces))}</span></li>`).join("") +
        (c.nombre > c.liste.length ? `<li><span class="note">et ${c.nombre - c.liste.length} autres : demandez le plus proche à votre IA.</span><span></span></li>` : "") +
        `</ul></li>`).join("")}</ul>`
    : "";

  const title = "Défibrillateurs Réunion : où trouver un DAE · 974";
  const description = "🇷🇪 Défibrillateurs (DAE) à La Réunion (974) : plus de 1 200 appareils dans les 24 communes, d'après la base nationale Géo'DAE, et le plus proche d'un lieu avec votre IA.";

  const band = `${crumbBar("Défibrillateurs")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Base nationale Géo'DAE</p>
    <h1>Défibrillateurs <span class="n974">974</span></h1>
    ${status}
    ${d ? `<p class="lead"><b>${esc(d.urgence)}</b></p>` : ""}
    ${ask(`Ousa néna in défibrilatèr pli prés la plaj l'Ermitaz ? Rogard si ${url} é di amwin.`,
      `Où est le défibrillateur le plus proche de la plage de l'Hermitage ? Lis ${url} et dis-le-moi.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : le nombre de défibrillateurs par commune" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Nombre de défibrillateurs par commune.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-dae">
  <div class="sec-h"><p class="eyebrow">Commune par commune</p><h2 id="h-dae">Où sont les défibrillateurs</h2>
  <p>Ceux qu'on peut atteindre à toute heure d'abord (à l'extérieur ou ouverts 24 h/24), puis ceux en accès libre aux heures d'ouverture du lieu. La liste est déclarée par les exploitants : un appareil peut avoir été déplacé.</p></div>
  ${list}
  <p class="note">Source : Géo'DAE, base nationale des défibrillateurs (ministère chargé de la santé), Licence Ouverte 2.0.</p>
</section>
${connectorCta("defibrillateurs", "les défibrillateurs")}`;

  return layout(origin, { title, description, path: "/defibrillateurs", jsonld: [crumbs(origin, "Défibrillateurs", "/defibrillateurs"), webPage(origin, "/defibrillateurs", title, description, data)], alerte }, band, body);
}

// ---------------------------------------------------------------- sport

const SPORT_LISTED = 8;
const SPORT_ORDER = ["handball", "volley-ball", "voile", "golf", "sport auto"];
const sportName = (s: string) => (s === "sport auto" ? "Sport automobile" : s.charAt(0).toUpperCase() + s.slice(1));

/** « vendredi 30/10 à 20:30 » → « ven. 30/10, 20:30 » ; « du samedi 24/10 au dimanche 25/10 » → « 24/10 → 25/10 ». */
const shortWhen = (q: string) =>
  q.startsWith("du ") ? q.replace(/^du \S+ (\S+) au \S+ (\S+)$/, "$1 → $2") : q.replace(/^(\S{3})\S* /, "$1. ").replace(" à ", ", ");

function sportRow(r: SportAnswer["resultats"] extends (infer T)[] | undefined ? T : never, withScore: boolean): string {
  const small = [r.competition, withScore ? shortWhen(r.quand) : "", r.lieu, r.detail && !withScore ? r.detail : ""].filter(Boolean).map((x) => esc(x!)).join(" · ");
  const right = withScore
    ? `<span class="score">${esc(r.score ?? "")}</span>`
    : r.etat === "annulée" || r.etat === "reportée" ? `<span class="q-mauvaise">${esc(r.etat)}</span>` : `<span class="q-none">${esc(shortWhen(r.quand))}</span>`;
  // A match links nowhere of its own: its championship's page is linked once, under the standings.
  const name = r.lien && !r.competition ? `<a href="${esc(r.lien)}" rel="noopener">${esc(r.epreuve)}</a>` : esc(r.epreuve);
  return `<li><span>${name}<small>${small}${withScore && r.detail ? ` · ${esc(r.detail)}` : ""}</small></span>${right}</li>`;
}

function bySport(rows: NonNullable<SportAnswer["a_venir"]>, withScore: boolean): string {
  const groups = SPORT_ORDER.map((sp) => ({ sp, list: rows.filter((r) => r.sport === sp) })).filter((g) => g.list.length);
  return `<ul class="zones">${groups.map((g) =>
    `<li class="card"><h3>${esc(sportName(g.sp))} <span class="note">${g.list.length} ${withScore ? "résultat" : "rendez-vous"}${withScore && g.list.length > 1 ? "s" : ""}</span></h3>` +
    `<ul class="rows eau">${g.list.slice(0, SPORT_LISTED).map((r) => sportRow(r, withScore)).join("")}` +
    (g.list.length > SPORT_LISTED ? `<li><span class="note">et ${g.list.length - SPORT_LISTED} autres : demandez-les à votre IA.</span><span></span></li>` : "") +
    `</ul></li>`).join("")}</ul>`;
}

export function sportPage(origin: string, data: Cached<SportAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/sport`;
  const upcoming = (d?.a_venir ?? []).filter((r) => r.etat !== "annulée");
  const soon = upcoming.slice(0, 7);

  const status = !d
    ? loading("Le calendrier du sport")
    : `<div class="now"><span class="big">${upcoming.length}</span><p>rendez-vous officiels dans les quinze prochains jours : handball, volley, voile, golf et sport automobile.</p></div>`;

  const next = soon.length
    ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">Les prochains rendez-vous</h3><ul class="plain">${soon.map((r) =>
        `<li><b>${esc(r.quand)}</b> : ${esc(r.epreuve)} <span class="note" style="color:var(--on-night-muted)">(${esc(r.competition ? `${r.sport}, ${r.competition}` : r.sport)})</span></li>`).join("")}</ul></figure>`
    : "";

  const standings = d?.classements.length
    ? `<ul class="zones">${d.classements.map((c) =>
        `<li class="card"><h3><a href="${esc(c.lien)}" rel="noopener">${esc(c.competition)}</a></h3><ul class="rows eau">${c.lignes.map((l) =>
          `<li><span>${l.place}. ${esc(l.equipe)}<small>${l.joues} match${l.joues > 1 ? "s" : ""} joué${l.joues > 1 ? "s" : ""}</small></span><span class="score">${l.points} pts</span></li>`).join("")}</ul></li>`).join("")}</ul>`
    : "";

  const raid = d?.grand_raid
    ? `<section aria-labelledby="h-raid">
  <div class="sec-h"><p class="eyebrow">${esc(d.grand_raid.dates)}</p><h2 id="h-raid">${esc(d.grand_raid.edition)}</h2>
  <p>Les cinq courses, leurs partants, arrivants et abandons, et les podiums publiés par l'organisateur. Pendant la course, le connecteur donne qui est en tête et combien sont encore en course.</p></div>
  <ul class="zones">${d.grand_raid.courses.map((c) =>
    `<li class="card"><h3>${esc(c.course)} <span class="note">${esc(c.statut)}</span></h3><p class="note">Départ ${esc(c.depart)}${c.partants ? ` · ${c.partants} partants` : ""}${c.arrives ? `, ${c.arrives} arrivés` : ""}${c.abandons ? `, ${c.abandons} abandons` : ""}${c.en_course ? `, ${c.en_course} en course` : ""}</p>` +
    (c.podium ? `<ul class="plain">${c.podium.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "") +
    (c.podium_femmes ? `<p class="note">Femmes : ${c.podium_femmes.map((p) => esc(p)).join(" ; ")}</p>` : "") + `</li>`).join("")}</ul>
  <p class="note"><a href="${esc(d.grand_raid.lien)}" rel="noopener">Tous les classements sur Livetrail</a></p>
</section>`
    : "";

  const news = d?.actualite?.length
    ? `<section aria-labelledby="h-actu">
  <div class="sec-h"><p class="eyebrow">Réunion La 1ère</p><h2 id="h-actu">L'actualité du sport</h2>
  <p>Les derniers articles de la rédaction sport de Réunion La 1ère, dont les comptes rendus du football régional.</p></div>
  <ul class="card plain">${d.actualite.map((n) => `<li><a href="${esc(n.lien)}" rel="noopener">${esc(n.titre)}</a> <span class="note">${esc(n.publie_le)}</span></li>`).join("")}</ul>
</section>`
    : "";

  const title = "Sport Réunion : matchs, résultats, Grand Raid · 974";
  const description = "🇷🇪 Sport à La Réunion (974) : matchs à venir et résultats du handball et du volley régionaux, classements, régates, golf, rallyes et podiums du Grand Raid.";

  const band = `${crumbBar("Sport")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Calendriers et résultats officiels</p>
    <h1>Sport <span class="n974">974</span></h1>
    ${status}
    ${ask(`Kosa néna konm match sé wikenn la ? Rogard si ${url} é di amwin.`,
      `Quels matchs et quelles compétitions ce week-end à La Réunion ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${next}
</div>`;

  const body = `<section aria-labelledby="h-venir">
  <div class="sec-h"><p class="eyebrow">Quinze prochains jours</p><h2 id="h-venir">À venir</h2>
  <p>Les matchs des championnats régionaux de handball (D1) et de volley (R1), les régates de la Ligue de voile, les compétitions des trois golfs et le calendrier de la Ligue du sport automobile. Heures de La Réunion.</p></div>
  ${d ? (d.a_venir?.length ? bySport(d.a_venir, false) : `<p class="card">Aucun rendez-vous trouvé dans les quinze prochains jours.</p>`) : `<p class="card">Le calendrier se charge : rechargez la page dans quelques secondes.</p>`}
</section>
${d?.resultats?.length ? `<section aria-labelledby="h-res">
  <div class="sec-h"><p class="eyebrow">Sept derniers jours</p><h2 id="h-res">Derniers résultats</h2></div>
  ${bySport(d.resultats, true)}
</section>` : ""}
${standings ? `<section aria-labelledby="h-class">
  <div class="sec-h"><p class="eyebrow">Championnats régionaux</p><h2 id="h-class">Classements</h2></div>
  ${standings}
</section>` : ""}
${raid}
${news}
<section aria-labelledby="h-src">
  <div class="sec-h"><h2 id="h-src">Ce qui n'est pas couvert</h2><p>${d ? esc(d.non_couvert) : ""}</p></div>
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("sport", "le sport")}`;

  return layout(origin, { title, description, path: "/sport", jsonld: [crumbs(origin, "Sport", "/sport"), webPage(origin, "/sport", title, description, data)], alerte }, band, body);
}

export function sportLive(data: Cached<SportAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const upcoming = (d.a_venir ?? []).filter((r) => r.etat !== "annulée");
  const first = upcoming[0];
  return { valeur: `${upcoming.length} rendez-vous`, detail: first ? `d'ici quinze jours ; prochain : ${esc(first.epreuve)}, ${esc(first.quand)}` : "d'ici quinze jours" };
}

// ---------------------------------------------------------------- cyclones

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function activeCard(r: NonNullable<CyclonesAnswer["systemes_actifs"]>[number]): string {
  const facts = [
    ["Position", `${r.situation}, ${r.position.heure}`],
    ["Vent moyen", r.vent_moyen_kmh ? `${r.vent_moyen_kmh} km/h${r.rafales_kmh ? `, rafales ${r.rafales_kmh} km/h` : ""}` : undefined],
    ["Pression", r.pression_hpa ? `${r.pression_hpa} hPa` : undefined],
    ["Déplacement", r.deplacement],
    ["Au plus près", r.au_plus_pres_selon_la_prevision ? `${r.au_plus_pres_selon_la_prevision.distance_km} km, ${r.au_plus_pres_selon_la_prevision.heure} (${r.au_plus_pres_selon_la_prevision.stade}), selon la prévision du CMRS` : r.s_eloigne ? "maintenant : la prévision du CMRS l'éloigne de l'île" : undefined],
  ].filter((f): f is [string, string] => !!f[1]);
  const forecast = r.prevision_cmrs?.length
    ? `<div class="table-wrap"><table class="drought"><thead><tr><th>Prévision du CMRS</th><th>Stade</th><th>Vent moyen</th><th>Distance de l'île</th></tr></thead><tbody>${r.prevision_cmrs.map((p) =>
        `<tr><th scope="row">${esc(p.heure)}</th><td>${esc(p.stade)}</td><td>${p.vent_moyen_kmh} km/h</td><td>${p.distance_km} km ${esc(p.situation)}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  return `<article class="card"><h3>${esc(capital(r.nom))} <span class="note">${esc(r.stade)}</span></h3>` +
    `<div class="table-wrap"><table class="drought"><tbody>${facts.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div>${forecast}` +
    `<p class="note">Vent le plus fort atteint : ${r.vent_max_atteint_kmh ?? "—"} km/h. Bulletins : ${esc(r.centre)}, <a href="${esc(r.rapport)}" rel="noopener">fiche GDACS</a>.</p></article>`;
}

function seasonTable(s: CyclonesAnswer["saison_en_cours"]): string {
  return s.systemes.length
    ? `<div class="card table-wrap"><table class="drought"><thead><tr><th>Système</th><th>Dates</th><th>Au plus fort</th><th>Vent moyen max.</th></tr></thead><tbody>${s.systemes.map((x) =>
        `<tr><th scope="row"><a href="${esc(x.rapport)}" rel="noopener">${esc(capital(x.nom))}</a></th><td>${esc(x.du)} – ${esc(x.au)}</td><td>${esc(x.stade_max ?? "—")}</td><td>${x.vent_max_kmh ? `${x.vent_max_kmh} km/h` : "—"}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="card">Aucun système pour le moment.</p>`;
}

export function cyclonesPage(origin: string, data: Cached<CyclonesAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/cyclones`;
  const active = d?.systemes_actifs ?? [];

  const status = !d
    ? loading("Le suivi des cyclones")
    : `<div class="now"><span class="big">${active.length}</span><p>système${active.length > 1 ? "s" : ""} tropica${active.length > 1 ? "ux" : "l"} actif${active.length > 1 ? "s" : ""} dans le sud-ouest de l'océan Indien${active.length ? `, le plus proche ${esc(active[0].situation)}` : ""}.</p></div>`;

  const tracks = (d?.traces ?? []).map((t) => ({ name: capital(t.nom), past: t.observee, forecast: t.prevue, label: t.etiquette, active: t.actif }));
  const map = d
    ? `<figure class="card mapcard">${oceanMap({ tracks, home: { lon: 55.536, lat: -21.115 }, label: active.length ? "Carte du sud-ouest de l'océan Indien : trajectoire et prévision des systèmes tropicaux actifs autour de La Réunion" : "Carte du sud-ouest de l'océan Indien : la trajectoire du dernier système tropical" })}
  <figcaption class="note" style="color:var(--on-night-muted)">${active.length ? "Trajectoire observée (trait plein) et prévue par le CMRS de La Réunion (pointillés)." : tracks.length ? `Aucun système actif. Trajectoire du dernier système, ${esc(tracks[0].name)}.` : "Aucun système actif."} Cercles à 500 et 1 000 km de l'île.</figcaption></figure>`
    : "";

  const title = "Cyclone Réunion en ce moment : trajectoire, alerte · 974";
  const short = "🇷🇪 Cyclones autour de La Réunion (974) : systèmes tropicaux actifs, trajectoire et prévision du CMRS de Météo-France, distance de l'île, alerte cyclonique et saisons passées.";
  const description = d ? describe(`🇷🇪 ${d.resume}`, short) : short;

  const band = `${crumbBar("Cyclones")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Bulletins du CMRS de La Réunion</p>
    <h1>Cyclones <span class="n974">974</span></h1>
    ${status}
    ${d?.alerte_cyclonique ? `<p class="lead"><b>${esc(d.alerte_cyclonique)}</b></p>` : ""}
    ${d && (d.ecoles?.niveau ?? -1) <= 2 ? `<p class="lead"><a href="/kit-cyclone">Se préparer : le kit d'urgence du plan →</a></p>` : ""}
    ${ask(`Néna in siklone pa loin La Rényon ? Rogard si ${url} é di amwin ousa li lé.`,
      `Y a-t-il un cyclone près de La Réunion ? Lis ${url} et dis-moi où il est et où il va.`)}
  </div>
  ${map}
</div>`;

  const body = `<section aria-labelledby="h-actifs">
  <div class="sec-h"><p class="eyebrow">En ce moment</p><h2 id="h-actifs">Systèmes actifs</h2>
  <p>${d ? esc(d.resume) : ""}</p></div>
  ${d ? active.map(activeCard).join("") : `<p class="card">Le suivi se charge : rechargez la page dans quelques secondes.</p>`}
</section>
<section aria-labelledby="h-alerte">
  <div class="sec-h"><p class="eyebrow">Préfecture de La Réunion</p><h2 id="h-alerte">Les phases de l'alerte cyclonique</h2>
  <p>${d ? esc(d.phases_alerte) : ""}</p></div>
  <div class="card"><ul class="plain">
    <li><a href="https://meteofrance.re/fr/cyclone" rel="noopener">Activité cyclonique et bulletins de Météo-France La Réunion</a></li>
    <li><a href="https://vigilance.meteofrance.fr/fr/la-reunion" rel="noopener">Vigilance et alerte cyclonique en cours (Météo-France)</a></li>
    <li><a href="https://www.reunion.gouv.fr" rel="noopener">Consignes de la préfecture de La Réunion</a></li>
    <li><a href="${esc(origin)}/vigilance">La vigilance du moment sur rundata.re</a></li>
    <li><a href="/ecoles-cyclone">Cyclone : les écoles sont-elles fermées ?</a></li>
    <li><a href="/alerte-cyclone">Alerte cyclonique : ce qui ferme, ce qui continue</a></li>
  </ul></div>
</section>
${d ? `<section aria-labelledby="h-saison">
  <div class="sec-h"><p class="eyebrow">Juillet à juin</p><h2 id="h-saison">Saison ${esc(d.saison_en_cours.nom)}</h2><p>${esc(d.saison)}</p></div>
  ${seasonTable(d.saison_en_cours)}
</section>` : ""}
${d?.saison_precedente ? `<section aria-labelledby="h-saison-prec">
  <div class="sec-h"><p class="eyebrow">Saison passée</p><h2 id="h-saison-prec">Saison ${esc(d.saison_precedente.nom)}</h2>
  <p>Les systèmes du bassin et le stade atteint au plus fort, d'après le vent moyen sur 10 minutes.</p></div>
  ${seasonTable(d.saison_precedente)}
</section>` : ""}
<section aria-labelledby="h-passes">
  <div class="sec-h"><p class="eyebrow">Mesures Météo-France</p><h2 id="h-passes">Cyclones passés</h2>
  <p>La pluie et les rafales mesurées station par station pendant leur passage, et les records de station.</p></div>
  <div class="card"><ul class="plain">${PASSES.map((p) => `<li><a href="/cyclones/${p.slug}">Cyclone ${esc(p.nom)}, ${esc(p.date)}</a></li>`).join("")}</ul></div>
</section>
${d ? `<section aria-labelledby="h-src"><div class="sec-h"><h2 id="h-src">D'où viennent ces données</h2><p>${esc(d.a_savoir)}</p></div>${data ? sourcesNote(d.sources, data) : ""}</section>` : ""}
${connectorCta("cyclones", "les cyclones")}`;

  return layout(origin, { title, description, path: "/cyclones", jsonld: [crumbs(origin, "Cyclones", "/cyclones"), webPage(origin, "/cyclones", title, description, data)], alerte }, band, body);
}

export function cyclonesLive(data: Cached<CyclonesAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const active = d.systemes_actifs ?? [];
  // In an alert, what the plan says of daily life is a click away (marketing).
  const plan = d.vie_quotidienne ? ` · <a href="/alerte-cyclone">Ce qui ferme, ce qui continue →</a>` : "";
  if (active.length) {
    const r = active[0];
    return { valeur: `${active.length} système${active.length > 1 ? "s" : ""} actif${active.length > 1 ? "s" : ""}`, detail: `${esc(capital(r.nom))}, ${esc(r.stade)}, ${esc(r.situation)}${plan}` };
  }
  const last = d.saison_en_cours.systemes[0] ?? d.saison_precedente?.systemes[0];
  return { valeur: "aucun système actif", detail: `saison ${esc(d.saison_en_cours.nom)}${last ? ` ; dernier : ${esc(capital(last.nom))} (${esc(last.du)} – ${esc(last.au)})` : ""}` };
}

// ---------------------------------------------------------------- historique météo

const pct = (x?: string) => (x ? Number.parseInt(x, 10) : undefined);
/** A bar of the rain against the normal: 100 % is the normal. */
function rainBar(total: number, normal?: number): string {
  if (normal == null || normal <= 0) return `<b>${fr(total)} mm</b>`;
  const ratio = total / normal;
  const w = Math.min(ratio, 2) * 50;
  const c = ratio < 0.5 ? "#ff922b" : ratio > 1.5 ? "#4dabf7" : "#69db7c";
  return `<b>${fr(total)} mm</b><small class="note">normale ${normal} mm</small><span class="ratio" role="img" aria-label="${Math.round(ratio * 100)} % de la normale"><i style="width:${w}%;background:${c}"></i><s></s></span>`;
}
const vsNormal = (v?: number, n?: number, unit = " °C") =>
  v == null ? "—" : `<b>${fr(v)}${unit}</b>${n != null ? `<small class="note">normale ${fr(n)}${unit}</small>` : ""}`;

export function historiquePage(origin: string, data: Cached<HistoriqueAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/historique`;
  const rows = d?.stations ?? [];
  const below = rows.filter((r) => (pct(r.pluie?.rapport_a_la_normale) ?? 100) < 80).length;
  const withNormal = rows.filter((r) => r.pluie?.rapport_a_la_normale).length;

  const markers = rows.flatMap((r) => {
    const x = pct(r.pluie?.rapport_a_la_normale);
    return x == null ? [] : [{ lon: r.lon, lat: r.lat, label: `${x} %`, name: r.station, color: x < 50 ? "#ff922b" : x > 150 ? "#4dabf7" : "#69db7c" }];
  });

  const status = !d
    ? loading("L'historique des mesures")
    : `<div class="now"><span class="big">${below}<small>/${withNormal}</small></span><p>stations de référence ont reçu nettement moins de pluie que la normale du ${esc(d.periode.du)} au ${esc(d.periode.au)} (moins de 80 % de leur moyenne 1991-2020).</p></div>`;

  const table = rows.length
    ? `<div class="card table-wrap"><table class="drought histo"><thead><tr><th>Station</th><th>Pluie, 30 jours</th><th>Maximales</th><th>Minimales</th><th>Soleil</th></tr></thead><tbody>${rows.map((r) => {
        const e = r.ensoleillement;
        return `<tr><th scope="row">${esc(r.station)}<small class="note">${esc(r.zone)}, ${r.altitude_m} m</small></th>` +
          `<td>${r.pluie ? rainBar(r.pluie.total_mm, r.pluie.normale_mm) : "—"}</td>` +
          `<td>${vsNormal(r.temperatures?.maximales_moyenne, r.temperatures?.maximales_normale)}</td>` +
          `<td>${vsNormal(r.temperatures?.minimales_moyenne, r.temperatures?.minimales_normale)}</td>` +
          `<td>${e?.jours_mesures ? `${vsNormal(e.heures_par_jour, e.normale_heures_par_jour, " h/j")}<small class="note">${e.jours_gris} jour${e.jours_gris > 1 ? "s" : ""} gris</small>` : "—"}</td></tr>`;
      }).join("")}</tbody></table></div>`
    : "";

  const title = "Historique météo Réunion : relevés depuis 1900 · 974";
  const short = "🇷🇪 Le temps qu'il a fait à La Réunion (974) : pluie, températures et soleil mesurés par Météo-France jour par jour depuis 1900, comparés à la normale.";
  const description = d ? describe(`🇷🇪 ${d.resume}`, short) : short;

  const band = `${crumbBar("Historique météo")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Mesures jusqu'à hier</p>
    <h1>Historique météo <span class="n974">974</span></h1>
    ${status}
    ${ask(`Lapli la tonm konbien sé dernié zour Sin-Bénoi, é lé normal ? Rogard si ${url} é di amwin.`,
      `Il a plu combien ces derniers jours à Saint-Benoît, et c'est normal ? Lis ${url} et dis-le-moi.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : la pluie des 30 derniers jours à six stations, en pourcentage de la normale" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Pluie des 30 derniers jours, en % de la normale 1991-2020 : <span style="color:#ff922b">moins de 50 %</span>, <span style="color:#69db7c">proche</span>, <span style="color:#4dabf7">plus de 150 %</span>.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-trente">
  <div class="sec-h"><p class="eyebrow">Six climats, six stations</p><h2 id="h-trente">Les 30 derniers jours</h2>
  <p>${d ? esc(d.resume) : ""}</p></div>
  ${table}
</section>
${d?.heures ? hourlySection(d.heures) : ""}
<section aria-labelledby="h-archive">
  <div class="sec-h"><p class="eyebrow">Toute l'archive</p><h2 id="h-archive">N'importe quel jour depuis 1900</h2>
  <p>Avec le connecteur, votre IA lit les mesures quotidiennes de chacune des 249 stations Météo-France que l'île a connues, de la première année de chacune jusqu'à hier : « il a plu combien en janvier 2018 à Cilaos ? », « il faisait combien le jour de mes 20 ans au Tampon ? », « record de chaleur à Saint-Denis ? », « il fait plus chaud qu'avant ? ». Les normales sont les moyennes 1991-2020 de chaque station.</p></div>
  ${d ? `<ul class="plain note">${d.a_savoir.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("historique_meteo", "l'historique météo")}`;

  return layout(origin, { title, description, path: "/historique", jsonld: [crumbs(origin, "Historique météo", "/historique"), webPage(origin, "/historique", title, description, data)], alerte }, band, body);
}

/** Yesterday and last night at Saint-Denis, hour by hour: one row per hour, newest first. */
function hourlySection(h: HourlyAnswer): string {
  const rows = [...h.heure_par_heure.heures].reverse();
  const used = h.heure_par_heure.stations.map((x) => `${x.station} (${x.mesure.replace(/^heure par heure : /, "")})`).join(" ; ");
  const cell = (v: number | undefined, unit = "") => (v == null ? "—" : `${fr(v)}${unit}`);
  return `<section aria-labelledby="h-heures">
  <div class="sec-h"><p class="eyebrow">Heure par heure</p><h2 id="h-heures">Hier et cette nuit à Saint-Denis</h2>
  <p>${esc(h.resume.replace(/^.*?Heure par heure \([^)]*\) — /, ""))}</p></div>
  <details class="card table-wrap"><summary>Les ${rows.length} dernières heures publiées</summary>
  <table class="drought histo hours"><thead><tr><th>Heure</th><th>Pluie</th><th>Température</th><th>Vent</th><th>Rafale</th><th>Soleil</th></tr></thead><tbody>${rows.map((r) =>
    `<tr><th scope="row">${esc(r.heure)}</th><td>${cell(r.pluie_mm, " mm")}</td><td>${cell(r.temperature, " °C")}</td><td>${r.vent_kmh == null ? "—" : `${r.vent_kmh} km/h${r.vent_de ? ` ${esc(r.vent_de)}` : ""}`}</td><td>${cell(r.rafale_kmh, " km/h")}</td><td>${r.soleil_min == null ? "—" : `${r.soleil_min} min`}</td></tr>`).join("")}</tbody></table></details>
  <p class="note">Stations Météo-France : ${esc(used)}. Avec le connecteur, votre IA lit ces heures pour n'importe quelle station depuis 2000 : « à quelle heure a-t-il plu hier à Cilaos ? », « rafale max cette nuit à Saint-Pierre ? ».</p>
</section>`;
}

export function historiqueLive(data: Cached<HistoriqueAnswer> | null): Live | undefined {
  const d = data?.value;
  const r = d?.stations.find((x) => x.pluie?.rapport_a_la_normale) ;
  if (!d || !r?.pluie) return undefined;
  return { valeur: `${r.pluie.rapport_a_la_normale} de la normale`, detail: `pluie des 30 derniers jours à ${esc(r.station)} (${fr(r.pluie.total_mm)} mm)` };
}

// ---------------------------------------------------------------- agenda

const AGENDA_WEEKEND = 7;
type AgendaRow = AgendaAnswer["ce_week_end"][number];
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** The hours of a row within its day: « 14:00 – 18:00 », « 19:30 », « jusqu'au dimanche 25/10 ». */
export function agendaHours(q: string): string {
  const span = /de (\d\d:\d\d) à (\d\d:\d\d)$/.exec(q);
  if (span) return `${span[1]} – ${span[2]}`;
  const at = /^\S+ \S+ à (\d\d:\d\d)$/.exec(q);
  if (at) return at[1];
  const until = /^du .* au (\S+ \S+)(?: à \S+)?$/.exec(q);
  return until ? `jusqu'au ${until[1]}` : "";
}

function agendaRow(r: AgendaRow): string {
  const lieu = r.lieu && r.lieu.length > 80 ? `${r.lieu.slice(0, 79)}…` : r.lieu;
  const small = [r.commune, lieu, r.prix && r.prix.length < 80 ? r.prix : undefined, r.autres_dates ? `aussi ${r.autres_dates.join(", ")}` : undefined, r.publie_par && r.lu_le ? `${r.publie_par}, lu ${r.lu_le}` : r.publie_par]
    .filter(Boolean).map((x) => esc(x!)).join(" · ");
  // Cancelled or postponed stays listed, said first: people look for it.
  const badge = r.statut ? `<span class="badge${r.statut === "complet" ? " m" : ""}">${esc(r.statut)}</span> ` : "";
  const book = r.billetterie && r.billetterie !== r.lien ? ` · <a href="${esc(r.billetterie)}" rel="noopener">billets</a>` : "";
  // Said by the news before the organiser's page: who said it, to check.
  const news = r.statut_d_apres
    ? `<small class="said">${esc(r.statut!.toLowerCase())}${r.reporte_au ? ` au ${esc(r.reporte_au)}` : ""} d'après <a href="${esc(r.statut_d_apres.lien)}" rel="noopener">${esc(r.statut_d_apres.media)}</a></small>`
    : "";
  return `<li data-g="${esc(r.genres.join(" "))}"><span>${badge}${r.lien ? `<a href="${esc(r.lien)}" rel="noopener">${esc(r.titre)}</a>` : esc(r.titre)}${news}<small>${small}${book}</small></span><span class="q-none">${esc(agendaHours(r.quand))}</span></li>`;
}

/** A row's end, local, from its hours: « samedi 24/10 de 09:00 à 16:00 », « du vendredi 23/10 au dimanche 01/11 ». */
function agendaEnd(r: AgendaRow): string | undefined {
  const span = /de \d\d:\d\d à (\d\d:\d\d)$/.exec(r.quand);
  if (span && r.date.length > 10) return `${r.date.slice(0, 10)}T${span[1]}`;
  const until = /^du .* au \S+ (\d\d)\/(\d\d)(?: à (\d\d:\d\d))?$/.exec(r.quand);
  if (!until) return undefined;
  const [, dd, mm, time] = until;
  const y = Number(r.date.slice(0, 4)) + (`${mm}-${dd}` < r.date.slice(5, 10) ? 1 : 0);
  return `${y}-${mm}-${dd}${time && r.date.length > 10 ? `T${time}` : ""}`;
}

const STATUS: Record<string, string> = { "ANNULÉ": "EventCancelled", "REPORTÉ": "EventPostponed" };

// What an event is, said in its schema.org description when its source gives no summary.
const KIND: Record<string, string> = {
  concert: "Concert", théâtre: "Théâtre", danse: "Spectacle de danse", humour: "Spectacle d'humour", cirque: "Cirque, conte ou magie",
  soirée: "Soirée", festival: "Fête ou festival", marché: "Marché", cinéma: "Cinéma", enfants: "Sortie pour les enfants",
  exposition: "Exposition ou visite", sport: "Rendez-vous sportif", atelier: "Atelier ou rencontre",
};
const SUMMARY_MAX = 300;
// The events' picture: the one of the events pages' link previews.
const EVENTS_IMAGE = rubriques.find((r) => r.pages.includes("/evenements"))?.png;

/** The source's summary, cut at a word within SUMMARY_MAX; else what, where: « Concert à Saint-Paul, TÉAT Plein Air. » */
export function eventSummary(r: AgendaRow): string {
  const text = r.description?.replace(/\s+/g, " ").trim();
  if (text && text.length > 20) return text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX).replace(/\s+\S*$/, "")}…`;
  const kind = r.genres.map((g) => KIND[g]).find(Boolean) ?? "Événement";
  return `${kind} à ${r.commune}${r.lieu && r.lieu !== r.commune ? `, ${r.lieu}` : ""}.`;
}

/**
 * The events as schema.org `Event`s, which search engines show in their own box. Only those with a commune and a
 * date: a place and a start are what they require. Nothing the source does not give (no price); the picture is the
 * events pages' own.
 */
export function agendaEvents(rows: AgendaRow[], origin: string): object[] {
  const iso = (local: string) => (local.length > 10 ? `${local}:00+04:00` : local);
  return rows.filter((r) => r.commune && /^\d{4}-\d\d-\d\d(T\d\d:\d\d)?$/.test(r.date)).map((r) => {
    const end = agendaEnd(r);
    return {
      "@type": "Event",
      name: r.titre,
      startDate: iso(r.date),
      ...(end && end > r.date ? { endDate: iso(end) } : {}),
      eventStatus: `https://schema.org/${STATUS[r.statut ?? ""] ?? "EventScheduled"}`,
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: {
        "@type": "Place",
        name: r.lieu ?? r.commune,
        address: { "@type": "PostalAddress", addressLocality: r.commune, addressRegion: "La Réunion", addressCountry: "RE" },
      },
      ...(r.lien ? { url: r.lien } : {}),
      description: eventSummary(r),
      ...(EVENTS_IMAGE ? { image: `${origin}${EVENTS_IMAGE}` } : {}),
    };
  });
}

// The kinds a visitor can keep, in the order of the select; only those in the list are offered.
const GENRES: [string, string][] = [["concert", "Concerts"], ["théâtre", "Théâtre"], ["danse", "Danse"], ["humour", "Humour"], ["cirque", "Cirque, contes, magie"], ["soirée", "Soirées et clubbing"], ["festival", "Fêtes et festivals"], ["marché", "Marchés"], ["cinéma", "Cinéma"], ["enfants", "Pour les enfants"], ["exposition", "Expositions et visites"], ["sport", "Sport"], ["atelier", "Ateliers et rencontres"]];
const GENRE_SCRIPT = `(()=>{const f=document.getElementById("ef");if(!f)return;f.hidden=false;
const run=()=>{const g=f.g.value;let n=0;document.querySelectorAll("#jours li[data-g]").forEach((li)=>{const ok=!g||li.dataset.g.split(" ").includes(g);li.hidden=!ok;if(ok)n++});
document.querySelectorAll("#jours>ul>li.card").forEach((c)=>{c.hidden=!c.querySelector("li[data-g]:not([hidden])")});
document.getElementById("ef-n").textContent=g?n+" événement"+(n>1?"s":""):"";};
f.addEventListener("input",run);f.addEventListener("submit",(e)=>e.preventDefault());})();`;

export function agendaPage(origin: string, data: Cached<AgendaAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/evenements`;
  const today = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);

  const days = new Map<string, AgendaRow[]>();
  for (const r of d?.evenements ?? []) {
    const day = r.date.slice(0, 10) < today ? today : r.date.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), r]);
  }

  const status = !d
    ? loading("L'agenda")
    : `<div class="now"><span class="big">${d.nombre}</span><p>événement${d.nombre > 1 ? "s" : ""} dans les deux semaines qui viennent : concerts, spectacles, fêtes, festivals, marchés et animations des mairies.</p></div>`;

  const weekend = d?.ce_week_end.length
    ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">Ce week-end</h3><ul class="plain">${d.ce_week_end.slice(0, AGENDA_WEEKEND).map((r) =>
        `<li><b>${esc(r.quand)}</b> : ${r.statut && r.statut !== "complet" ? `<b>${esc(r.statut)}</b> ` : ""}${esc(r.titre)}${r.commune ? ` <span class="note" style="color:var(--on-night-muted)">(${esc(r.commune)})</span>` : ""}</li>`).join("")}</ul>` +
      `<p class="note"><a href="/evenements/ce-week-end" style="color:var(--on-night)">${d.ce_week_end.length > AGENDA_WEEKEND ? `Et ${d.ce_week_end.length - AGENDA_WEEKEND} autres : tout` : "Tout"} le week-end →</a></p></figure>`
    : "";

  const present = new Set((d?.evenements ?? []).flatMap((r) => r.genres));
  const filter = present.size > 1
    ? `<form id="ef" class="card filter" hidden role="search" aria-label="Filtrer les événements par genre"><label>Genre <select name="g"><option value="">tous</option>${GENRES.filter(([g]) => present.has(g)).map(([g, nom]) => `<option value="${esc(g)}">${esc(nom)}</option>`).join("")}</select></label><p class="note" id="ef-n" aria-live="polite"></p></form>`
    : "";
  const list = !d
    ? `<p class="card">L'agenda se charge : rechargez la page dans quelques secondes.</p>`
    : days.size
      ? `${filter}<div id="jours"><ul class="zones">${[...days].sort(([x], [y]) => x.localeCompare(y)).map(([day, rows]) =>
          `<li class="card"><h3>${esc(longDay(day).replace(/^\p{L}/u, (c) => c.toUpperCase()))} <span class="note">${rows.length} événement${rows.length > 1 ? "s" : ""}</span></h3>` +
          `<ul class="rows eau">${rows.map(agendaRow).join("")}</ul></li>`).join("")}</ul></div>${d.autres ? `<p class="note">${esc(d.autres)} Demandez-les à votre IA.</p>` : ""}<script>${GENRE_SCRIPT}</script>`
      : `<p class="card">Aucun événement trouvé dans les agendas lus pour les deux semaines qui viennent.</p>`;

  const title = "Que faire à La Réunion ? Concerts, fêtes, sorties · 974";
  const short = "🇷🇪 Que faire à La Réunion (974) : concerts, théâtre, danse, festivals, fêtes et marchés des deux semaines, programmes des salles et des mairies.";
  const description = d ? describe(`🇷🇪 ${d.resume} Concerts, spectacles, fêtes, festivals et marchés, avec les heures, le lieu et le lien.`, short) : short;

  const band = `${crumbBar("Événements")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Salles de spectacle, mairies et tourisme</p>
    <h1>Événements <span class="n974">974</span></h1>
    ${status}
    ${ask(`Kosa néna pou fé sé wikenn la ? Rogard si ${url} é di amwin.`,
      `Que faire ce week-end à La Réunion ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${weekend}
</div>`;

  const body = `<section aria-labelledby="h-jours">
  <div class="sec-h"><p class="eyebrow">Deux semaines</p><h2 id="h-jours">Jour par jour</h2>
  <p>Chaque événement renvoie à la page de celui qui le publie. Heures de La Réunion ; un événement de plusieurs jours est rangé au jour où il commence, ou à aujourd'hui s'il a déjà commencé. Un événement annulé ou reporté reste affiché, avec son statut.</p></div>
  ${agendaTabs("/evenements")}
  ${list}
  ${d?.indisponible?.length ? warnings([`Agendas non lus cette fois (en panne, trop lents, ou laissés à la visite suivante) : ${d.indisponible.join(", ")}. La liste peut être incomplète.`]) : ""}
</section>
<section aria-labelledby="h-couv">
  <div class="sec-h"><h2 id="h-couv">Ce qui est couvert</h2><p>${d ? esc(d.couverture) : ""}</p><p>${d ? esc(d.a_savoir) : ""}</p>
  <p>Les séances de cinéma sont sur les sites des salles : ${CINEMAS.map((c) => `<a href="${esc(c.lien)}" rel="noopener">${esc(c.nom)}</a>`).join(", ")}.</p></div>
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("evenements", "les événements de l'île")}`;

  const events = agendaEvents(d?.evenements ?? [], origin);
  const jsonld = [crumbs(origin, "Événements", "/evenements"), webPage(origin, "/evenements", title, description, data), ...(events.length ? [{ "@context": "https://schema.org", "@graph": events }] : [])];
  return layout(origin, { title, description, path: "/evenements", jsonld, alerte }, band, body);
}

export function agendaLive(data: Cached<AgendaAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const first = d.ce_week_end[0];
  return {
    valeur: `${d.nombre} événement${d.nombre > 1 ? "s" : ""}`,
    detail: first ? `d'ici quinze jours ; ce week-end : ${esc(first.titre)}${first.commune ? ` (${esc(first.commune)})` : ""}` : "d'ici quinze jours",
  };
}

/** The links between the events page and its parts, above their lists. */
export function agendaTabs(path: string): string {
  const tabs: [string, string][] = [["/evenements", "Tout l'agenda"], ["/evenements/ce-week-end", "Ce week-end"], ["/evenements/concerts", "Concerts"]];
  return `<nav class="parts" aria-label="Parties de l'agenda">${tabs.map(([p, n]) =>
    `<a href="${p}"${p === path ? ` aria-current="page"` : ""}>${esc(n)}</a>`).join("")}</nav>`;
}

// What the pages built from a part of a domain's data (evenements.ts) share with the domain's own page.
export { agendaRow, connectorCta, crumbBar, crumbs, describe, GENRE_SCRIPT, GENRES, loading, longDay, sourcesNote, warnings, webPage };

// ---------------------------------------------------------------- actualités

type NewsRow = ActualitesAnswer["infos"][number];
/** « 11:33 » today, « hier à 18:20 », « jeudi 22/10 à 09:11 ». */
const newsTime = (r: NewsRow) => r.quand.replace(/^aujourd'hui à /, "");

function newsRow(r: NewsRow): string {
  const small = [r.media + (r.aussi?.length ? ` (aussi ${r.aussi.map((x) => x.media).join(", ")})` : ""), r.communes?.join(", ")].filter(Boolean).map((x) => esc(x!)).join(" · ");
  return `<li data-k="${esc(r.lien)}" data-c="${esc((r.communes ?? []).join("|"))}" data-s="${esc((r.sujets ?? []).join("|"))}"><span><a href="${esc(r.lien)}" rel="noopener">${esc(r.titre)}</a>` +
    `${r.resume ? `<small>${esc(r.resume)}</small>` : ""}<small>${small}</small></span><span class="q-none">${esc(newsTime(r))}</span></li>`;
}

const NEWS_FILTER = `<form id="nf" class="card filter" hidden role="search" aria-label="Filtrer les informations">
<label class="q">Chercher <input name="q" type="search" placeholder="barrage, Saint-Pierre, route du littoral…" autocomplete="off"></label>
<label>Commune <select name="c"><option value="">toutes</option>COMMUNES</select></label>
<label>Sujet <select name="s"><option value="">tous</option>${SUJETS.map((x) => `<option value="${x.id}">${esc(x.nom)}</option>`).join("")}</select></label>
<p class="note" id="nf-n" aria-live="polite"></p></form>`;

const NEWS_SCRIPT = `(()=>{const f=document.getElementById("nf");if(!f)return;f.hidden=false;
const items=[...document.querySelectorAll("#news li[data-k]")];
const norm=(s)=>s.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
for(const e of items)e.dataset.q=norm(e.textContent);
const run=()=>{const q=norm(f.q.value).split(" ").filter(Boolean),c=f.c.value,s=f.s.value;let n=0;
for(const e of items){const x=e.dataset,ok=q.every((t)=>x.q.includes(t))&&(!c||x.c.split("|").includes(c))&&(!s||x.s.split("|").includes(s));e.hidden=!ok;if(ok)n++}
document.getElementById("nf-n").textContent=q.length||c||s?n+" information"+(n>1?"s":"")+" sur "+items.length+".":"";};
f.addEventListener("input",run);f.addEventListener("submit",(e)=>e.preventDefault());})();`;

export function actualitesPage(origin: string, data: Cached<ActualitesAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/actualites`;
  const communes = [...new Set((d?.infos ?? []).flatMap((r) => r.communes ?? []))].sort((x, y) => x.localeCompare(y, "fr"));

  const status = !d
    ? loading("L'actualité")
    : `<div class="now"><span class="big">${d.infos.length}</span><p>informations des médias de l'île depuis 24 h` +
      `${d.en_direct.length ? ` ; <b>${esc(d.en_direct[0].media)} suit la journée en direct</b> (dernière entrée à ${esc(newsTime(d.en_direct[0]))})` : ""}.</p></div>`;

  const top = d ? (d.en_direct.length ? d.en_direct : d.infos).slice(0, 6) : [];
  const side = d
    ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">${d.en_direct.length ? "En direct" : "À la une"}</h3><ul class="plain">${top.map((r) =>
        `<li><b style="color:var(--on-night)">${esc(newsTime(r))}</b> <a href="${esc(r.lien)}" rel="noopener" style="color:var(--on-night)">${esc(r.titre)}</a>` +
        `<span class="note" style="color:var(--on-night-muted)"> · ${esc(r.media)}${r.communes?.length ? ` · ${esc(r.communes.join(", "))}` : ""}</span></li>`).join("")}</ul></figure>`
    : "";

  const list = d
    ? d.infos.length
      ? `${NEWS_FILTER.replace("COMMUNES", communes.map((c) => `<option>${esc(c)}</option>`).join(""))}<ul class="rows eau" id="news">${d.infos.map(newsRow).join("")}</ul>`
      : `<p class="card">Aucune information des médias lus depuis 24 h.</p>`
    : `<p class="card">L'actualité se charge : rechargez la page dans quelques secondes.</p>`;

  const live = d?.en_direct.length
    ? `<section aria-labelledby="h-direct">
  <div class="sec-h"><p class="eyebrow">Heure par heure</p><h2 id="h-direct">Le direct ${/^[aeiouyéèêiî]/i.test(d.en_direct[0].media) ? "d'" : "de "}${esc(d.en_direct[0].media)}</h2>
  <p>Les entrées du direct, la plus récente en haut, avec leur première phrase et ce qu'elles disent des communes. Le texte complet est sur le site du média.</p></div>
  <ul class="rows eau">${d.en_direct.map((r) => `<li><span><a href="${esc(r.lien)}" rel="noopener">${esc(r.titre)}</a>${r.resume ? `<small>${esc(r.resume)}</small>` : ""}` +
    `${r.communes?.length ? `<small>${esc(r.communes.join(", "))}</small>` : ""}</span><span class="q-none">${esc(newsTime(r))}</span></li>`).join("")}</ul>
</section>`
    : "";

  const pref = d?.prefecture.length
    ? `<section aria-labelledby="h-pref">
  <div class="sec-h"><p class="eyebrow">Officiel</p><h2 id="h-pref">Communiqués de la préfecture</h2><p>Mesures de sécurité, interdictions, routes, eau : les consignes officielles priment.</p></div>
  <ul class="rows eau">${d.prefecture.map((r) => `<li><span><a href="${esc(r.lien)}" rel="noopener">${esc(r.titre)}</a></span><span class="q-none">${esc(newsTime(r))}</span></li>`).join("")}</ul>
</section>`
    : "";

  const title = "Actualités Réunion en direct, commune par commune · 974";
  const short = "🇷🇪 Ce qui se passe en ce moment à La Réunion (974) : les titres des médias de l'île, leurs directs et les communiqués de la préfecture, commune par commune, mis à jour toutes les 5 minutes.";
  const description = d && d.infos[0] ? describe(`🇷🇪 À La Réunion, ${newsTime(d.infos[0])} : ${d.infos[0].titre}. Les titres des médias de l'île et leurs directs, commune par commune.`, short) : short;

  const band = `${crumbBar("Actualités")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Les médias de l'île, relus toutes les 5 minutes</p>
    <h1>Actualités <span class="n974">974</span></h1>
    ${status}
    ${ask(`Kosa i spas Sin-Pyèr astèr ? Néna baraz ? Rogard si ${url} é di amwin.`,
      `Que se passe-t-il à Saint-Pierre en ce moment, y a-t-il des blocages ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${side}
</div>`;

  const body = `${live}
<section aria-labelledby="h-news">
  <div class="sec-h"><p class="eyebrow">Les dernières 24 heures</p><h2 id="h-news">Toutes les informations</h2>
  <p>Le titre et la première phrase de chaque article, son média, les communes qu'il nomme et son heure (heure de La Réunion). Une même information publiée par plusieurs médias n'est listée qu'une fois.</p></div>
  ${list}
  ${d?.indisponible.length ? warnings([`Ne répondent pas en ce moment : ${d.indisponible.join(", ")}.`]) : ""}
</section>
${pref}
<section aria-labelledby="h-couv">
  <div class="sec-h"><h2 id="h-couv">Ce qui est couvert</h2><p>${d ? esc(d.couverture) : ""}</p><p>${d ? esc(d.a_savoir) : ""}</p></div>
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("actualites", "l'actualité de l'île")}
<script>${NEWS_SCRIPT}</script>`;

  return layout(origin, { title, description, path: "/actualites", jsonld: [crumbs(origin, "Actualités", "/actualites"), webPage(origin, "/actualites", title, description, data)], alerte }, band, body);
}

export function actualitesLive(data: Cached<ActualitesAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const first = d.en_direct[0] ?? d.infos[0];
  return {
    valeur: d.chaud ? "mobilisation en cours" : `${d.infos.length} informations`,
    detail: first ? `${esc(newsTime(first))}, ${esc(first.media)} : ${esc(first.titre)}` : "depuis 24 h",
  };
}
