/**
 * One page per category of the connector besides the weather: the volcano, the air, the electricity, the calendar and
 * the buses. Each shows what the tool of the same name answers right now, so that people, search engines and the
 * assistants reading a page see it, and points to the connector for the rest. Each also says it in a few words for
 * its tile on the home page.
 */
import { enLigne } from "./associations-drapeau.js";
import { OVPF, OVPF_FACEBOOK, PREFECTURE } from "../providers/volcan.js";
import { enImages, enImagesApres, IMAGE_APRES, IMAGE_LUE_APRES, givenAt, JOURS_SUIVANTS, type Jour, jusquALecture, LOCALISES, LU_DANS_L_IMAGE, NIVEAU_ILLISIBLE, NON_ANNONCEE, NON_LU, ORSEC_BAN, ovpfNiveau, pitonLines, VIGILANCE_ENCLOS } from "../tools/volcan.js";
import { type Ligne, NIVEAUX, TITRE, VERSION } from "../tools/volcan-acces.js";
import { PATH as SANS_REPONSE } from "./sans-reponse.js";
import { SOMMET } from "../providers/seismes.js";
import * as onf from "../providers/sentiers.js";
import * as vigicrues from "../providers/vigicrues.js";
import { ANNONCERONT, alerteVolcan, BLUESKY_SEUL, ENCLOS, followOvpf, levelSaid, mediaSection, releaseCard, tileLive, type VolcanAlerte, volcanBanner, volcanH1, volcanLead, volcanMeta, volcanTitle } from "./volcan-alerte.js";
import { CINEMAS } from "../tools/agenda.js";
import { ACCUEILS, AGENDAS } from "../providers/agenda.js";
import { SOURCE as SALLES_SOURCE } from "../providers/salles.js";
import type { Cached } from "../cache.js";
import * as historique from "../tools/volcan-historique.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import * as airMesures from "../providers/air-mesures.js";
import * as traces from "../providers/traces.js";
import { SUJETS } from "../providers/actualites.js";
import * as littoral from "../tools/littoral.js";
import { longDate, UNPUBLISHED } from "../tools/calendrier.js";
import type { CourantRow } from "../tools/courant.js";
import { a, de, enumeration, fr, heure, nombre, tranche } from "../tools/format.js";
import { CAPTEURS_AVERTISSEMENT, CAPTEURS_EXPLICATION, type Measured } from "../tools/air.js";
import * as capteurs from "../providers/capteurs.js";
import * as radars from "../routes/radars.js";
import * as fire from "../tools/feux.js";
import * as feux from "../providers/feux.js";
import { COMMUNES as BIKE_COMMUNES } from "../tools/velos.js";
import { LATE_MIN, ROAD_NEAR_M, type ActualitesAnswer, type AgendaAnswer, type AirAnswer, type Alerte, type BorneStation, type BornesAnswer, type BusData, type GareNow, type CalendrierAnswer, type CoupuresAnswer, type CruesAnswer, type CruesStation, type CyclonesAnswer, type DaeAnswer, type EauAnswer, type ElectriciteAnswer, type Enclos, type HikeCard, type HistoriqueAnswer, type HourlyAnswer, type RandonneesAnswer, type SecheresseAnswer, type SentiersAnswer, type SportAnswer, type TraceAnswer, type TraficAnswer, type TrailItem, type VeloStation, type VelosAnswer, type VolcanAnswer } from "./data.js";
import { daysApart, localTime } from "../geo.js";
import { agendasNonLus, mediasNonLus } from "../tools/injoignable.js";
import { FAST_KW } from "../tools/bornes.js";
import { fuelSay, keep } from "../tools/carburants.js";
import { SECTEURS as SECTEURS_RANDO, secteurNamed, type Secteur } from "../traces/secteurs.js";
import island from "../places/island.json" with { type: "json" };
import * as mf from "../providers/vigilance.js";
import { carteHtml } from "./cmrs-carte.js";
import { GRAPHES_SCRIPT, graphes } from "./historique-graphes.js";
import { basinMap, TRACES, TRACES_SCRIPT, TRACES_SOURCES, ZONE_SOURCE } from "./cyclones-bassin.js";
import { esc, fenetre, hikesMap, islandMap, type Marker, profile, traceMap, type ZoneLink } from "./map.js";
import { type Cle, COUNT_COLOR, legende } from "./carte-legende.js";
import { eventsMap } from "./evenements-carte.js";
import { reprise } from "./ouvrir-donnees.js";
import { cloudSeaLink, type Summit, weatherForTrace } from "./liens.js";
import { LINE as BAIGNADE_LINE } from "./baignade.js";
import { T as FERRY } from "../tools/ferries.js";
import { BUILT as DAE_BUILT, DAES } from "../providers/dae.js";
import DAE_LIST from "../dae/liste.json" with { type: "json" };
import * as atmo from "../providers/atmo.js";
import { anchorId, ask, credits, CYCLONE_SCALE, dayMonth, DESCRIPTION_MAX, empty, FOLD_ROWS, folded, hm, icon, ISLAND, layout, type Live, lue, officielHtml, readAt, SITE, vg } from "./pages.js";
import { pageOf, slugify } from "./places.js";
import { PASSES } from "../historique/cyclones-passes.js";
import { cycloneWater } from "./eau-cyclone.js";
import { tapNote } from "../tools/eau.js";
import { aller, MOTS as ALLER_MOTS, permis, porte, type Porte, retire, SHEET as ALLER } from "./aller.js";
import { mentionSports, noteLa1ere, noteReunionFr } from "../tools/non-repris.js";

const FOURNAISE = { lon: 55.7083, lat: -21.2444, name: "Piton de la Fournaise" };
// What a search engine shows of a title.
const TITLE_MAX = 60;

/** `full` when it fits in what search engines show, else `short`. */
const describe = (full: string, short: string) => (full.length <= DESCRIPTION_MAX ? full : short);

/** `parent`: the page between the home page and this one (« Clubs et associations » above its form). */
function crumbs(origin: string, name: string, path: string, parent?: { name: string; path: string }) {
  const trail = [{ name: SITE, path: "/" }, ...(parent ? [parent] : []), { name, path }];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: `${origin}${t.path}` })),
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

const crumbBar = (label: string, parent?: { name: string; path: string }) =>
  `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li>${parent ? `<li><a href="${esc(parent.path)}">${esc(parent.name)}</a></li>` : ""}<li aria-current="page">${esc(label)}</li></ol></nav></div>`;

/** What to say while the data of a page is not there yet. */
const loading = (what: string) => `<p class="lead">${esc(what)} se charge : rechargez la page dans quelques secondes.</p>`;

const sourcesNote = (list: { source: string; licence: string; attribution: string }[], data: Cached<unknown>) =>
  `<p class="note">Mis à jour à ${hm(data.fetchedAt)}.</p><p class="sources">Sources : ${credits(list)}.</p>`;

/**
 * The agendas of the scheduled event not read lately (tools/agenda.ts, `non_lus`: « Ville de Saint-Leu : dernière
 * lecture le … »), as one line of the card « À savoir ».
 */
export const sansLecture = (nonLus: string[] | undefined): string[] =>
  nonLus?.length ? [`Agendas sans lecture récente : ${nonLus.map((x) => x.replace(/ : (?!.* : )/, ", ")).join("\u00a0; ")}. Leurs événements peuvent manquer ici.`] : [];

/**
 * What a list of events may lack, one formula for /evenements, its weekend and its concerts (marketing): the agendas
 * not read this time, silent or left to the next visit, then those of the scheduled event not read lately.
 */
export const agendaNotes = (data: Cached<AgendaAnswer> | null | undefined, now: Date): string[] => [
  ...(data?.value.indisponible?.length ? [agendasNonLus(data.value.indisponible, data.value.remises, localTime(data.fetchedAt), now)] : []),
  ...sansLecture(data?.value.non_lus),
];

const warnings = (list: string[]) =>
  list.length ? `<div class="card warn">${icon("alert")}<h3>À savoir</h3><ul class="plain">${list.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : "";

/** The connector, at the end of every domain page. */
const connectorCta = (tool: string, what: string) => `<section aria-labelledby="h-ia">
  <div class="card cta"><h2 id="h-ia">Votre IA, branchée sur ${esc(what)}</h2>
  <p>Avec le connecteur, votre assistant lit lui-même ces données (outil <code>${esc(tool)}</code>), et toutes les autres de l'île : sorties, randos, météo, routes, volcan, air, électricité, bus, services publics, terrain. Gratuit, sans compte. <a href="/#assistant">Comment le brancher</a>.</p></div>
</section>`;

// ---------------------------------------------------------------- volcan

const md = (m: number | null) => (m == null ? "—" : fr(Math.round(m * 10) / 10));
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Indian/Reunion" });

// The Enclos as the official texts say it (marketing): the prefecture's release in its title's own words, « 20/10 » its
// day, or closed by the level of an alert whose title says nothing of it; in vigilance from a release, the plan's rule.
// Never pitonlive's (data-run, 25/10/2026).
const dd = (jour: string) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}`;
const releaseLink = (c: NonNullable<Enclos["communique"]>) => `<a href="${esc(c.lien)}">communiqué de la préfecture du ${dd(c.jour)}</a>`;
// The release's words in bold and its day linked, « Accès à l'Enclos : <b>« fermeture »</b> selon le <a>communiqué de la
// préfecture du 23/10</a> »; or its level, the ban the plan's: « Alerte 2-1 selon le <a>…</a> : accès à l'Enclos
// <b>interdit</b> à ce niveau (dispositif ORSEC Volcan) ».
const releaseSaid = (c: NonNullable<Enclos["communique"]>, du = releaseLink(c)) =>
  c.mots
    ? `Accès à l'Enclos : <b>${esc(`« ${c.mots} »`)}</b> selon le ${du}`
    : `${esc(c.niveau!)} selon le ${du} : ${ORSEC_BAN.replace("interdit", "<b>interdit</b>")}`;
const enclosSaid = (x: Enclos) =>
  x.communique?.mots
    ? `Enclos : <b>${esc(`« ${x.communique.mots} »`)}</b> selon le ${releaseLink(x.communique)}.`
    : x.communique
      ? `${releaseSaid(x.communique)}.`
      : x.ovpf
        ? `${esc(x.ovpf.niveau)} selon l'OVPF : ${ORSEC_BAN.replace("interdit", "<b>interdit</b>")}.`
        : x.vigilance
          ? esc(VIGILANCE_ENCLOS)
          : `Accès à l'Enclos : à vérifier sur ${GOUV}, avant de partir.`;
// The card's title (marketing).
const ENCLOS_TITRE = "Accès à l'Enclos";
/**
 * The short form, on the home page's tile and the card of /trafic, never « ouvert » (marketing): forbidden by the
 * release, its words, the plan's rule in vigilance, or to check.
 */
const enclosShort = (x: Enclos | undefined): { valeur: string; source: string } =>
  x?.communique?.mots && !/ferm|interdi/i.test(x.communique.mots)
    ? { valeur: `« ${x.communique.mots} »`, source: `préfecture, ${dd(x.communique.jour)}` }
    : x?.communique
      ? { valeur: "Interdit", source: `préfecture, ${dd(x.communique.jour)}` }
      : x?.ovpf
        ? { valeur: "Interdit", source: `plan ORSEC en ${x.ovpf.niveau.toLowerCase()}, niveau publié par l'OVPF` }
        : x?.vigilance
          ? { valeur: "Sentiers balisés seulement", source: "plan ORSEC, en vigilance" }
          : { valeur: "À vérifier", source: "reunion.gouv.fr" };
const OVPF_LINK = `<a href="${OVPF.url}">${OVPF.url.replace("https://", "")}</a>`;
// A text of ours with the OVPF's link, or a post's, in it: escaped, then the link put back as a link.
const linked = (t: string, url: string, a: string) => esc(t).replace(esc(url), a);

// The OVPF's Facebook page, which rundata.re does not read: a link only, no embed (marketing).
const FACEBOOK_LINE = `<p class="lead">L'OVPF publie aussi sur Facebook, que nous ne lisons pas : <a href="${OVPF_FACEBOOK}">suivre sa page officielle ↗</a></p>`;
/** After « …est en images, que nous ne lisons pas : »: the post on Bluesky, and the OVPF's Facebook page, where the same post may not be (marketing). */
export const imageLinks = (lien: string) => `<a href="${esc(lien)}">la voir sur Bluesky ↗</a>, ou suivre <a href="${OVPF_FACEBOOK}">l'OVPF sur Facebook ↗</a>`;

// Where the prefecture publishes each phase of the ORSEC volcano plan.
const GOUV = `<a href="${PREFECTURE.url}">reunion.gouv.fr</a>`;

/** `news`: the news copy, read during an alert only, for what the media say of it. */
export function volcanPage(origin: string, data: Cached<VolcanAnswer> | null, now = new Date(), alerte?: Alerte, news?: ActualitesAnswer): string {
  const d = data?.value;
  const a = alerteVolcan(d);
  const e = d?.etat;
  // « indisponible » when the OVPF's catalogue did not answer (tools/volcan.ts).
  const q = typeof d?.seismes === "object" ? d.seismes : undefined;
  // The catalogue silent: the counts are of its last copy, said with the time of that read.
  const jusqua = q?.lus_jusqu_au ? `, ${jusquALecture(q.lus_jusqu_au)}` : "";
  const url = `${origin}/volcan`;
  // Under an alert, the OVPF's newest post in images, newer than the release: said once, with its time, at the top;
  // IMAGE_APRES is then not said (marketing).
  const p0 = Array.isArray(d?.publications_ovpf) ? d.publications_ovpf[0] : undefined;
  const folded = !!a && !a.eruption && !a.arret && !!e && !!e.image_ovpf_plus_recente && !!p0?.lien;
  // Its text read in the first image: said so, the text open on its card (providers/ovpf-ocr.ts).
  const lu = !!p0?.texte_lu_dans_l_image;
  const apres = lu ? IMAGE_LUE_APRES : IMAGE_APRES;
  // pitonlive.com, after the official source, as its own (marketing); the OVPF's level, newer than the release.
  const piton = e?.pitonlive_non_officiel
    ? pitonLines(e.pitonlive_non_officiel, !!e.niveau_inconnu, OVPF.url).map((x) => `<p class="lead">${linked(x, OVPF.url, OVPF_LINK)}</p>`).join("")
    : "";
  const ovpf = e?.niveau_ovpf
    ? `<p class="lead">${linked(ovpfNiveau(e.niveau_orsec, givenAt(e.niveau_ovpf.date), e.niveau_ovpf.lien), e.niveau_ovpf.lien, `<a href="${esc(e.niveau_ovpf.lien)}">lien</a>`)}</p>`
    : "";
  // The IPGP's site silent (marketing), with the list of the silent sites: at the top out of an alert, with the
  // official texts during one, where it says what may be missing.
  const silent = d?.injoignable ? `<p class="note">${esc(d.injoignable)} <a href="${SANS_REPONSE}">Voir les sites sans réponse</a>.</p>` : "";
  const m = d?.puis_je_monter;

  // During an alert, five lines at most under the heading, each fact once: no eruption announced (whose words), the
  // Enclos with the way to the detail, whose the level is, the OVPF's newest post in images, the OVPF's accounts
  // (marketing, 26/10/2026). The level's words are in the heading, the decree in « Les niveaux du dispositif ».
  const [jour, heure] = (p0?.date.split(" ") ?? []) as [string, string];
  const top = (a: VolcanAlerte) =>
    `<p class="lead"><b>${esc(!a.eruption && !a.arret ? NON_ANNONCEE : volcanLead(a))}</b></p>` +
    `<p class="lead"><b>${esc(ENCLOS)}</b>${m ? ` <a href="#monter">Routes et sentiers, lieu par lieu ↓</a>` : ""}</p>` +
    (a.niveau ? `<p class="note">${esc(levelSaid(a))}</p>` : "") +
    ovpf + piton +
    (folded
      ? `<p class="note">${lu
        ? `${esc(enImages(jour, heure))} : <a href="#ovpf">son texte, lu automatiquement, plus bas ↓</a>`
        : `${esc(enImagesApres(jour, heure))} : <a href="${esc(p0!.lien!)}">la voir sur Bluesky ↗</a>`}</p>`
      : e?.image_ovpf_plus_recente ? `<p class="lead">${esc(apres)}</p>` : "") +
    `<p class="note">${followOvpf()}</p>`;

  const status = !d
    ? loading("L'état du volcan")
    : `<div class="status">` +
      (e && a
        ? top(a)
        : e
        ? (e.niveau_inconnu
            // No official level read nor kept: why, then pitonlive as a last resort (marketing).
            ? `<p class="lead">${esc(NON_ANNONCEE)} ${esc(NIVEAU_ILLISIBLE).replace("reunion.gouv.fr", GOUV)}</p>`
            : `<p class="lead">${esc(NON_ANNONCEE)} Niveau du dispositif ORSEC volcan : <b>${esc(e.niveau_orsec)}</b>.` +
              (e.niveau_definition ? ` <span class="note">${esc(e.niveau_definition)}</span>` : "") +
              (!e.eruption_en_cours && e.derniere_eruption ? ` Dernière éruption : <b>${esc(historique.derniereEruptionDates(e.derniere_eruption))}</b>, selon l'<a href="${esc(e.derniere_eruption.lien)}" rel="noopener">OVPF</a>.` : "") +
              `</p>`) +
          // Under the level: the OVPF's Facebook page, high on the page too.
          FACEBOOK_LINE +
          silent +
          ovpf + piton +
          `<p class="lead">${enclosSaid(e.acces_enclos ?? {})}</p>` +
          (e.image_ovpf_plus_recente ? `<p class="lead">${esc(apres)}</p>` : "")
        : `<p class="lead">${esc(d.resume)}</p>`) +
      (q && !a ? `<p class="lead">Séismes localisés par l'OVPF sous le volcan${esc(jusqua)} : <b>${q.sous_le_volcan["7_jours"]}</b> en 7 jours, <b>${q.sous_le_volcan["30_jours"]}</b> en 30 jours.</p>` : "") +
      `</div>`;

  // Out of an alert, the Enclos as the texts say it, on its card; during one, in « Puis-je monter au volcan ? », whose
  // card takes id="enclos" (/trafic sends its readers there for the trails).
  const enclos = !a && e
    ? `<div class="card" id="enclos">${icon("mountain")}<h3>${esc(ENCLOS_TITRE)}</h3><p>${enclosSaid(e.acces_enclos ?? {})}</p>` +
      // The trails the ONF says open, place by place, are in « Puis-je monter au volcan ? ».
      (e.acces_enclos?.vigilance ? `<p class="note"><a href="#monter">${esc(TITRE)} →</a></p>` : "") +
      `</div>`
    : "";

  // During an alert, five at most, one line each at 390 px: « 24/10 16:55 · magnitude 1,2 · sommet, 0 km », the
  // section saying « sous le volcan » already (marketing).
  // « sommet, 0,1 km » kept whole, the line breaking before it, never inside (marketing); a longer place breaks as words.
  const where = (s: NonNullable<typeof q>["derniers"][number]) => {
    const at = `${s.lieu === SOMMET ? "sommet" : s.lieu}, ${fr(Math.max(0, s.profondeur_km))}\u00a0km`;
    return at.length <= PLACE_WHOLE ? at.replace(/ /g, "\u00a0") : at;
  };
  const quakeRow = (s: NonNullable<typeof q>["derniers"][number]) =>
    a
      ? `<li>${esc(s.heure.replace(" heure de La Réunion", ""))} · magnitude\u00a0<b>${esc(md(s.magnitude))}</b> · ${esc(where(s))}</li>`
      : `<li><b>${esc(md(s.magnitude))}</b><span>${esc(s.lieu)}, ${esc(fr(Math.max(0, s.profondeur_km)))} km de profondeur</span><span class="note">${esc(s.heure.replace(" heure de La Réunion", ""))}</span></li>`;
  const quakes = q
    ? `<div class="card">${icon("gauge")}<h3>Séismes localisés par l'OVPF</h3>` +
      quakeDays(q.par_jour_sous_le_volcan, e?.image_ovpf_plus_recente && !folded && !a ? apres : undefined) +
      (a
        ? `<p class="facts"><span>Sous le volcan${esc(jusqua)} : <b>${q.sous_le_volcan["7_jours"]}</b> en 7 jours, <b>${q.sous_le_volcan["30_jours"]}</b> en 30 jours, magnitude max ${md(q.sous_le_volcan.magnitude_max_30j)}</span>` +
          `<span>Ailleurs sur l'île : <b>${q.ailleurs_sur_l_ile["30_jours"]}</b> en 30 jours, magnitude max ${md(q.ailleurs_sur_l_ile.magnitude_max_30j)}</span></p>`
        : `<p class="facts"><span>Sous le volcan${esc(jusqua)} : <b>${q.sous_le_volcan["30_jours"]}</b> en 30 jours, magnitude max ${md(q.sous_le_volcan.magnitude_max_30j)}</span>` +
          `<span>Ailleurs sur l'île : <b>${q.ailleurs_sur_l_ile["30_jours"]}</b>, magnitude max ${md(q.ailleurs_sur_l_ile.magnitude_max_30j)}</span></p>`) +
      (q.derniers.length ? `<ul class="rows${a ? " seismes" : ""}">${q.derniers.slice(0, a ? 5 : undefined).map(quakeRow).join("")}</ul>` : "") +
      // LOCALISES once, under the day counts (marketing).
      `<p class="note">${q.copie ? `${esc(q.copie)} ` : ""}${esc(q.note.replace(` ${LOCALISES}`, ""))}</p></div>`
    : "";

  // The alerts before this one, from the releases (tools/volcan-historique.ts): the same list whatever the copy says.
  const moment = (m: historique.Moment) =>
    // Non-breaking spaces inside the quotes and before the colon: a lone « at the end of a line at 390 px (marketing).
    `<li><b>${esc(historique.date(m.jour))}</b>, ${esc(m.quoi)} : « ${esc(m.dit)} » <a href="${esc(m.communique.copie)}">${esc(historique.label(m.communique))} →</a></li>`;
  const episodes = (list: historique.Episode[]) =>
    `<ul class="posts">${list.map((x) => `<li class="card"><p class="note">Début</p><ul class="plain">${x.debut.map(moment).join("")}</ul><p class="note">Fin</p><ul class="plain">${moment(x.fin)}</ul>${x.puis ? then(x.puis) : ""}</li>`).join("")}</ul>`;
  // « Le même jour, nouvelle alerte 2-2 : « … » (communiqué du 19/02/2019 →). Sa fin n'est pas… » (marketing).
  const then = (m: historique.Moment) =>
    `<p>${esc(historique.PUIS)} ${esc(m.quoi)} : « ${esc(m.dit)} » (<a href="${esc(m.communique.copie)}">${esc(historique.label(m.communique))} →</a>). ${esc(historique.SANS_FIN)}</p>`;
  // Before the plan of 2021, folded: as many cards again at 390 px, under the levels of the plan then.
  const before = `<section id="alertes-precedentes" aria-labelledby="h-alertes"><div class="sec-h"><h2 id="h-alertes">${esc(historique.TITRE)}</h2><p>${esc(historique.CHAPEAU)}</p></div>
  ${episodes(historique.EPISODES.filter((e) => !historique.avant2021(e)))}
  <details><summary>${esc(historique.avantTitre(historique.EPISODES.filter(historique.avant2021).length))}</summary><p class="note">${esc(historique.AVANT_2021)}</p>${episodes(historique.EPISODES.filter(historique.avant2021))}</details>
  <p class="note">${esc(historique.NOTE)}</p></section>
`;

  // The text read in a post's first image, folded under what it is (draft, marketing); open on the first card during an
  // alert, which the top of the page leads to.
  const readText = (t: string, open: boolean) => `<details${open ? " open" : ""}><summary>${esc(LU_DANS_L_IMAGE)}</summary>${t.split("\n\n").map((x) => `<p>${esc(x)}</p>`).join("")}</details>`;
  const list = Array.isArray(d?.publications_ovpf) ? d.publications_ovpf.slice(0, a ? 3 : 4) : [];
  const cards = list.length
    ? `<ul class="posts" id="ovpf">${list.map((p, i) => `<li class="card"><p class="note">${esc(p.date)}</p><p>${esc(p.texte)}</p>${p.texte_lu_dans_l_image ? readText(p.texte_lu_dans_l_image, !!a && i === 0) : ""}${p.lien ? `<p><a href="${esc(p.lien)}">${p.image ? "Voir les images sur Bluesky" : "Lire le message"} →</a></p>` : ""}</li>`).join("")}</ul>`
    : "";
  // During an alert, the official texts in one section: the prefecture's release, then the OVPF's posts (marketing).
  const official = a
    ? `<section id="annonces" aria-labelledby="h-officiel"><div class="sec-h"><h2 id="h-officiel">Les annonces officielles</h2><p>${esc(!a.eruption && !a.arret ? `${ANNONCERONT} ${BLUESKY_SEUL}` : BLUESKY_SEUL)}</p></div>` +
      silent + releaseCard(a) + cards + `</section>`
    : cards
    ? `<section aria-labelledby="h-ovpf"><div class="sec-h"><p class="eyebrow">L'observatoire</p><h2 id="h-ovpf">Ce que publie l'OVPF</h2>
  <p>Les derniers messages de l'Observatoire volcanologique du Piton de la Fournaise (IPGP), repris tels quels.</p></div>
  ${cards}</section>`
    : "";

  // In vigilance from the prefecture's release, said with « pas d'éruption annoncée »; no official level, the state of
  // the volcano, the reason right under it (marketing).
  const vigilance = !a && !!e && !e.niveau_inconnu && e.niveau_orsec === "Vigilance";
  const heading = a ? volcanH1(a) : vigilance ? "Piton de la Fournaise : vigilance, pas d'éruption annoncée" : e?.niveau_inconnu ? "Piton de la Fournaise : état du volcan" : undefined;
  const title = a ? volcanTitle(a) : heading ? `${heading} · 974` : "Piton de la Fournaise en direct : éruption, Enclos, séismes · 974";
  // Out of an alert, timeless: search engines keep it for days, a state in it would go stale (marketing).
  const description = a
    ? volcanMeta(a)
    : "Piton de la Fournaise en direct : niveau d'alerte d'après la préfecture, publications de l'OVPF, accès à l'Enclos, séismes localisés sous le volcan. · 974";

  const question = ask(`Volkan la pété ? Gèt si ${url} é di amwin si lanklo lé ouvèr.`,
    `Le Piton de la Fournaise est-il en éruption ? Lis ${url} et dis-moi aussi si l'Enclos est ouvert.`);
  // During an alert, the question to an assistant goes to the foot of the page, and the island's map leaves phones: it
  // shows where the volcano is, which everyone knows (marketing).
  const band = `${crumbBar("Volcan")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Volcan en direct</p>
    <h1>${heading ? esc(heading) : `Piton de la Fournaise <span class="n974">974</span>`}</h1>
    ${status}
    ${a ? "" : question}
  </div>
  <figure class="card mapcard nophone">${islandMap({ pin: FOURNAISE, label: "Carte de La Réunion (974) avec le Piton de la Fournaise" })}</figure>
</div>`;

  // « Puis-je monter au volcan ? », first: the official texts place by place, and the levels of the plan (marketing).
  // A non-breaking space before our colons, never inside a quote: no « : » alone at the start of a line (marketing).
  const colons = (s: string) => s.split(/(«[^»]*»)/).map((x, i) => (i % 2 ? x : x.replace(/ :/g, " :"))).join("");
  const line = (l: Ligne) =>
    `<li>${colons(esc(l.texte))}${l.source ? ` (${l.lien ? `<a href="${esc(l.lien)}">${esc(l.source)} →</a>` : esc(l.source)}).` : l.lien ? ` <a href="${esc(l.lien)}">→</a>` : ""}</li>`;
  const monter = m
    ? `<section id="monter" aria-labelledby="h-monter"><div class="sec-h"><h2 id="h-monter">${esc(m.titre)}</h2><p>${esc(m.chapeau)}</p></div>
  <div class="card"${a ? ` id="enclos"` : ""}>${m.avant ? `<p><b>${esc(m.avant)}</b></p>` : ""}<ul class="plain">${m.lignes.map(line).join("")}</ul><p class="note">${esc(m.pied)}</p>
  <details><summary>Les niveaux du dispositif</summary><ul class="plain">${NIVEAUX.map((n) => `<li><b>${esc(n.niveau)}</b> : « ${esc(n.libelle)} »</li>`).join("")}</ul><p class="note"><small>${esc(VERSION)}</small></p></details></div></section>
`
    : "";

  // One question a block, in the order they come: may I go up, what the official texts say, what is measured, what the
  // media say, what came before (marketing, 26/10/2026). « À savoir » stays in the tool: during an alert, the foot of
  // « Puis-je monter au volcan ? » says it.
  const measured = `<section id="seismes" aria-labelledby="h-volcan">
  <div class="sec-h"><p class="eyebrow">En ce moment</p><h2 id="h-volcan">${a ? "Séismes sous le volcan" : "L'Enclos et les séismes"}</h2></div>
  ${d ? `${a ? quakes : `<div class="two">${enclos}${quakes}</div>`}${a ? "" : warnings(d.avertissements)}${data ? sourcesNote(d.sources, data) : ""}` : `<p class="card">Les données du volcan se chargent : rechargez la page dans quelques secondes.</p>`}
</section>
`;
  const body = `${monter}${official}${measured}${a ? mediaSection(news) : ""}${before}${a ? `<section aria-label="Demandez à votre IA"><div class="card">${question}</div></section>` : ""}
${connectorCta("volcan_seismes", "le volcan")}`;

  // Its heading and the official blocks say all the banner would: no banner here.
  return layout(origin, { title, description, path: "/volcan", jsonld: [crumbs(origin, "Volcan", "/volcan"), webPage(origin, "/volcan", title, description, data)], alerte, volcan: !!a }, band, body);
}

// A place of an earthquake row this long or shorter never breaks inside: about a third of a line at 390 px.
const PLACE_WHOLE = 20;
// Below this many a day, the bars keep their scale: one event must not fill the chart (data-run: no scale that
// magnifies a small number, the axis at 0).
const DAYS_SCALE_MIN = 10;

/**
 * The events located under the summit per day, as bars from 0, today marked « en cours » (data-run, marketing); each
 * bar says its day and count to screen readers, and the line under it today's, yesterday's and the highest. The
 * catalogue silent: the day of its last read « jusqu'à » that time, the days after it hatched, « non lu », no bar.
 */
function quakeDays(days: Jour[] | undefined, imageAfter: string | undefined): string {
  if (!days?.length) return "";
  const dd = (jour: string) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}`;
  const read = days.filter((j) => !("non_lu" in j)) as Exclude<Jour, { non_lu: true }>[];
  const scale = Math.max(DAYS_SCALE_MIN, ...read.map((j) => j.nombre));
  const bars = days.map((j) => "non_lu" in j
    ? `<li class="nolu" aria-label="${dd(j.jour)} : ${NON_LU}"></li>`
    : `<li${j.en_cours ? ` class="now"` : ""} aria-label="${dd(j.jour)}${j.en_cours ? " (en cours)" : j.jusqu_a ? ` (jusqu'à ${j.jusqu_a})` : ""} : ${j.nombre}"><i style="height:${Math.round((j.nombre / scale) * 100)}%"></i></li>`).join("");
  const today = days.at(-1)!;
  const last = read.at(-1);
  const top = read.reduce<typeof last>((a, j) => (!a || j.nombre > a.nombre ? j : a), undefined);
  // The day before today, counted whole: only when today is.
  const yesterday = "en_cours" in today ? read.at(-2) : undefined;
  // « Le plus en un jour »: not to be read as a total over the 30 days (marketing).
  const facts = ("en_cours" in today
    ? `Aujourd'hui (en cours) : <b>${today.nombre}</b>${yesterday ? `, hier : <b>${yesterday.nombre}</b>` : ""}.`
    : `${last?.jusqu_a ? `Le ${dd(last.jour)} jusqu'à ${last.jusqu_a} : <b>${last.nombre}</b>. ` : ""}${JOURS_SUIVANTS}`) +
    (top?.nombre ? ` Le plus en un jour sur ${"en_cours" in today ? "" : "ces "}30 jours : <b>${top.nombre}</b>, le ${dd(top.jour)}.` : "");
  const end = `${dd(today.jour)}${"en_cours" in today ? " (en cours)" : "non_lu" in today ? ` (${NON_LU})` : ""}`;
  return `<figure class="qdays"><figcaption>Sous le volcan, par jour (heure de La Réunion)</figcaption>` +
    `<ol>${bars}</ol><p class="axis"><span>${dd(days[0].jour)}</span><span>${end}</span></p></figure>` +
    `<p>${facts}</p><p class="note">${esc(LOCALISES)}</p>` +
    (imageAfter ? `<p class="note">${esc(imageAfter)}</p>` : "");
}

export function volcanLive(data: Cached<VolcanAnswer> | null, now = new Date()): Live | undefined {
  if (!data) return undefined;
  const e = data.value.etat;
  // Nothing on an eruption either way: the page says what the texts read say.
  if (!e) return empty(`Textes de l'OVPF et de la préfecture lus ${readAt(data.fetchedAt, now).a} : état du volcan à lire sur la page.`);
  const a = alerteVolcan(data!.value);
  if (a) return tileLive(a);
  const q = typeof data!.value.seismes === "object" ? data!.value.seismes : undefined;
  const enclos = enclosShort(e.acces_enclos);
  // What the texts read say, never « no eruption » on our word, nor pitonlive's (marketing).
  const lus = `OVPF et préfecture, textes lus à ${hm(data!.fetchedAt)}`;
  return {
    valeur: "Pas d'éruption annoncée",
    detail: [
      esc(lus),
      esc(`Enclos : ${enclos.valeur} (${enclos.source})`),
      q ? `${q.sous_le_volcan["7_jours"]} séisme${q.sous_le_volcan["7_jours"] > 1 ? "s" : ""} localisé${q.sous_le_volcan["7_jours"] > 1 ? "s" : ""} par l'OVPF sous le volcan en 7 jours${q.lus_jusqu_au ? `, ${jusquALecture(q.lus_jusqu_au)}` : ""}` : undefined,
    ].filter(Boolean).join(" · "),
    // In the hero, where the detail is not shown; on a line of its own, never cut with the value.
    source: esc(lus),
  };
}

// ---------------------------------------------------------------- air

const AQ_NAMES = ["", "bon", "moyen", "dégradé", "mauvais", "très mauvais", "extrêmement mauvais"];
export const aq = (n: number) => `<span class="aq aq${n >= 1 && n <= 6 ? n : 0}">${esc(AQ_NAMES[n] ?? "inconnu")}</span>`;
// A sub-index: its level, or, by the guide, « indisponible » (0) or « événement » (7) in words.
const subIndex = (n: number) => (n >= 1 && n <= 6 ? aq(n) : esc(atmo.level(n)));
// The map's commune names (« L'Étang-Salé ») by their spelling in the ATMO index (« L'Etang-Salé »).
const MAP_NAME = new Map(island.paths.map((p: { nom: string }) => [normalize(p.nom), p.nom]));

// The map's pollutants, one at a time, worded by marketing (29/10/2026), by their name in the measures (tools/air.ts, `measured`). PM10 first, shown
// by default: measured at 10 of the 15 stations across the island on 29/10/2026, the nitrogen dioxide (12) mostly
// by the roads.
const MAP_POLLUTANTS = [
  { id: "pm10", tab: "PM10", polluant: airMesures.POLLUTANTS.PM10 },
  { id: "pm25", tab: "PM2,5", polluant: airMesures.POLLUTANTS["PM2.5"] },
  { id: "o3", tab: "Ozone", polluant: airMesures.POLLUTANTS.O3 },
  { id: "no2", tab: "NO₂", polluant: airMesures.POLLUTANTS.NO2 },
];
const STATION_BY_NAME = new Map(Object.values(airMesures.STATIONS).map((s) => [s.nom, s]));
// The pills of the measures: neutral, never the index's colours, whose thresholds are for averages and a forecast.
const MEASURE_PILL = "#44555a";

/** The hour most of the values were measured: the legend's; a station measured at another says its own. */
const usualHour = (list: Measured[]) => {
  const n = new Map<string, number>();
  for (const v of list) n.set(v.heure, (n.get(v.heure) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** The measures of each pollutant of the map at Atmo Réunion's stations, as markers, with the hour most were measured at. */
function airLayers(d: AirAnswer | undefined) {
  const valeurs = d?.mesures_aux_stations?.valeurs ?? [];
  return MAP_POLLUTANTS.map((p) => {
    const list = valeurs.filter((v) => v.polluant === p.polluant && STATION_BY_NAME.has(v.station));
    const heure = usualHour(list);
    const markers: Marker[] = list.map((v) => {
      const st = STATION_BY_NAME.get(v.station)!;
      const value = `${nombre(v.valeur)} ${v.unite}${v.heure !== heure ? `, ${v.heure}` : ""}`;
      return { lon: st.lon, lat: st.lat, label: String(Math.round(v.valeur)), say: value, place: v.station, name: `${v.station} (${st.commune}) : ${value}`, color: MEASURE_PILL, quiet: true, href: `#${anchorId("st", v.station)}` };
    });
    return { ...p, heure, list, others: list.filter((v) => v.heure !== heure).length, markers };
  }).filter((l) => l.markers.length);
}
type AirLayer = ReturnType<typeof airLayers>[number];

/**
 * The top of /air when stations measured, before the forecast (a measure comes before a model): the first pollutant
 * of the map over the island, from its lowest to its highest station at the hour most measured, the highest named.
 */
function airMeasured(l: AirLayer, lu: string, now: Date): string {
  const at = l.list.filter((v) => v.heure === l.heure).sort((a, b) => a.valeur - b.valeur);
  const lo = at[0], hi = at[at.length - 1];
  const where = (v: Measured) => `${v.station}${v.commune ? ` (${v.commune})` : ""}`;
  const big = at.length > 1 && Math.round(lo.valeur) !== Math.round(hi.valeur)
    ? `${l.tab} : ${Math.round(lo.valeur)} à ${Math.round(hi.valeur)} µg/m³`
    : `${l.tab} : ${Math.round(hi.valeur)} µg/m³`;
  // Worded by marketing (29/10/2026): the verb says it is a measure; the legend's name of the pollutant.
  const name = `${l.polluant[0].toUpperCase()}${l.polluant.slice(1)} ${l.polluant.startsWith("particules") ? "mesurées" : "mesuré"} ${l.heure}`;
  const lead = at.length > 1 ? `${name} à ${at.length} stations d'Atmo Réunion : le plus haut à ${where(hi)}.` : `${name} à la station ${where(hi)}.`;
  // The day only when the reading is not today's, as the forecast's note under it.
  const [le, a] = lu.split(" ");
  const when = le === localTime(now).split(" ")[0] ? `à ${a}` : `le ${le} à ${a}`;
  return `<div class="status"><p class="big">${esc(big)}</p><p class="lead">${esc(lead)}</p>` +
    `<p class="note">Mesure brute, non validée, publiée par le LCSQA. Lue par rundata.re ${esc(when)}.</p></div>`;
}

/**
 * The island's map of /air: the measures at Atmo Réunion's stations, at their place, one pollutant at a time (radio
 * buttons and CSS, without a script), each value in a neutral pill; without a measure, the index forecast in each
 * commune, as a dot at its centre. Never a commune filled.
 */
function airMap(d: AirAnswer | undefined, layers: AirLayer[]): string {
  if (layers.length) {
    const on = layers[0].id;
    const tabs = `<div class="tabs aqtabs" role="radiogroup" aria-label="Polluant affiché sur la carte">` +
      layers.map((l) => `<input type="radio" name="aqp" id="aqp-${l.id}"${l.id === on ? ' class="on" checked' : ""}><label for="aqp-${l.id}">${esc(l.tab)}</label>`).join("") + `</div>`;
    const legend = layers.map((l) => `<span class="lg lg-${l.id}${l.id === on ? " on" : ""}">${esc(`${l.polluant[0].toUpperCase()}${l.polluant.slice(1)}, en µg/m³ : mesure brute, non validée, ${l.heure}`)}` +
      `${l.others ? esc(`, ${l.others} station${l.others > 1 ? "s" : ""} à une autre heure (voir la liste)`) : ""}.</span>`).join("");
    return `<figure class="card mapcard airmap">${tabs}` +
      islandMap({ layers: layers.map((l) => ({ id: l.id, markers: l.markers, on: l.id === on })), peaks: true, apart: true, label: "Carte de La Réunion (974) : les mesures aux stations d'Atmo Réunion, un polluant à la fois" }) +
      `<figcaption class="note">${legend}</figcaption></figure>`;
  }
  // No measure stored: the forecast, a dot at each commune's centre.
  const markers: Marker[] = (d?.communes ?? []).flatMap((c) => {
    const place = resolvePlace(c.commune)?.lieu;
    const name = MAP_NAME.get(normalize(c.commune)) ?? c.commune;
    return place && c.niveau >= 1 && c.niveau <= 6
      ? [{ lon: place.lon, lat: place.lat, label: String(c.niveau), say: `indice ${c.niveau} sur 6, ${AQ_NAMES[c.niveau]}`, place: name, name: `${name} : indice ${c.niveau} sur 6, ${AQ_NAMES[c.niveau]}`, color: `var(--aq${c.niveau})`, round: true, quiet: true, href: `#${anchorId("c", name)}` }]
      : [];
  });
  return `<figure class="card mapcard">${islandMap({ markers, peaks: true, label: "Carte de La Réunion (974) : l'indice ATMO prévu dans chaque commune" })}` +
    `<figcaption class="note">Indice ATMO prévu pour aujourd'hui dans chaque commune, de 1 (bon) à 6 (extrêmement mauvais) : une prévision, pas une mesure.</figcaption></figure>`;
}

export function airPage(origin: string, data: Cached<AirAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const list = [...(d?.communes ?? [])].sort((a, b) => b.niveau - a.niveau || a.commune.localeCompare(b.commune, "fr"));
  const worst = list[0]?.niveau;
  const best = list.length ? list[list.length - 1].niveau : undefined;
  const url = `${origin}/air`;

  // Measured at the stations: the measure first, the forecast under it, smaller and said a forecast.
  const layers = airLayers(d);
  const top = layers[0] && d?.mesures_aux_stations ? airMeasured(layers[0], d.mesures_aux_stations.lu_par_rundata, now) : "";
  const levels = worst != null ? `${AQ_NAMES[worst] ?? ""}${best != null && best !== worst ? ` à ${AQ_NAMES[best] ?? ""}` : ""}` : "";
  const forecastNote = d ? `${d.diffusion ? ` ${esc(d.diffusion)}` : ""} Lue par rundata.re ${readAt(data!.fetchedAt, now).a}.` : "";
  const status = !d
    ? loading("L'indice de la qualité de l'air")
    : top && worst != null
      ? `${top}<div class="status forecast"><p class="lead"><b>${esc(`Prévision d'Atmo Réunion pour la journée : ${levels}.`)}</b> ${esc(d.resume)}</p>` +
        `<p class="note">Une prévision, pas une mesure.${forecastNote}</p></div>`
      : worst != null
        ? `<div class="status"><p class="big">${esc(levels)}</p>` +
          `<p class="lead">${esc(d.resume)}</p><p class="note" style="color:var(--on-night-muted)">Une prévision d'Atmo Réunion pour la journée, pas une mesure.${forecastNote}</p></div>`
        : `${top}<p class="lead">${esc(d.resume)}</p>`;

  const byLevel = [6, 5, 4, 3, 2, 1]
    .map((n) => ({ n, l: list.filter((c) => c.niveau === n) }))
    .filter((x) => x.l.length)
    .map((x) => `<div class="card"><h3>${aq(x.n)} prévu dans ${x.l.length} commune${x.l.length > 1 ? "s" : ""}</h3><ul class="plain cols">` +
      x.l.map((c) => `<li class="tgt" id="${anchorId("c", MAP_NAME.get(normalize(c.commune)) ?? c.commune)}">${esc(c.commune)}${c.polluants.length ? ` <span class="note">(${esc(c.polluants.join(", "))})</span>` : ""}</li>`).join("") + `</ul></div>`)
    .join("");

  // Each pollutant's sub-index, commune by commune, folded: the list above already gives the one in cause.
  const pollutants = Object.values(atmo.POLLUTANTS);
  const subs = list.some((c) => c.sous_indices)
    ? `<details class="card"><summary>Sous-indice de chaque polluant, commune par commune</summary><div class="table-wrap"><table class="drought niveaux">` +
      `<thead><tr><th scope="col">Commune</th>${pollutants.map((p) => `<th scope="col">${esc(p)}</th>`).join("")}</tr></thead><tbody>` +
      [...list].sort((a, b) => a.commune.localeCompare(b.commune, "fr")).map((c) => `<tr><th scope="row">${esc(c.commune)}</th>` +
        pollutants.map((p) => `<td data-label="${esc(p)}">${c.sous_indices?.[p] != null ? subIndex(c.sous_indices[p]) : "—"}</td>`).join("") + `</tr>`).join("") +
      `</tbody></table></div></details>`
    : "";

  // The measures at the stations, said apart from the forecast and never in a sentence with it: each value with its
  // hour, its station, the station's type and commune, and that it is raw and not validated.
  const m = d?.mesures_aux_stations;
  const byStation = new Map<string, Measured[]>();
  for (const v of m?.valeurs ?? []) {
    const k = `${v.station}${v.commune ? ` · ${v.commune}` : ""}`;
    byStation.set(k, [...(byStation.get(k) ?? []), v]);
  }
  const [luLe, luA] = m?.lu_par_rundata.split(" ") ?? [];
  const measures = m && byStation.size
    ? `<section aria-labelledby="h-mesures-air">
  <div class="sec-h"><p class="eyebrow">Mesures</p><h2 id="h-mesures-air">Mesuré aux stations d'Atmo Réunion</h2>
  <p>Les concentrations mesurées heure par heure aux stations, publiées par le LCSQA. Ce sont des mesures brutes, non validées, qu'Atmo Réunion peut corriger ensuite. Elles ne sont pas l'indice ATMO, qui est une prévision.</p></div>
  <div class="levels">${[...byStation].map(([station, list]) => `<div class="card tgt" id="${anchorId("st", list[0].station)}"><h3>${esc(station)}</h3><ul class="plain">` +
    list.map((v) => `<li><b>${esc(v.polluant)}</b> : ${esc(nombre(v.valeur))} ${esc(v.unite)} <span class="note">${esc(v.heure)}, station de type ${esc(v.type)}, mesure brute, non validée${v.retard ? `, ${esc(v.retard)}` : ""}</span></li>`).join("") +
    `</ul></div>`).join("")}</div>
  <p class="note">Lues par rundata.re le ${esc(luLe)} à ${esc(luA)}, dans les <a href="${esc(m.source)}" rel="noopener">fichiers du LCSQA sur data.gouv.fr</a> (Licence Ouverte Etalab 2.0).</p>
</section>`
    : "";

  // The sensors of private people, under the index and apart from it, worded by marketing (29/10/2026): raw values by
  // commune, the hour they measured, never a colour, a threshold, an identifier nor a place.
  const am = d?.capteurs_amateurs;
  const [amLe, amA] = am && "lu_par_rundata" in am ? am.lu_par_rundata.split(" ") : [];
  const pm = (name: string, v: number | undefined) => (v === undefined ? "" : ` · ${name} : ${esc(nombre(v))} µg/m³`);
  const amateurs = am
    ? `<section aria-labelledby="h-capteurs-air">
  <div class="sec-h"><p class="eyebrow">Capteurs de particuliers</p><h2 id="h-capteurs-air">Capteurs amateurs</h2>
  <p><b>${esc(CAPTEURS_AVERTISSEMENT)}</b> ${esc(CAPTEURS_EXPLICATION)}</p></div>
  <div class="card">${"lecture_ancienne" in am && am.lecture_ancienne ? `<p>${esc(am.lecture_ancienne)}</p>` : ""}${"valeurs" in am && am.valeurs
    ? `<ul class="plain">${am.valeurs.map((v) => `<li>${esc(v.commune)}${pm("PM2,5", v.pm2_5)}${pm("PM10", v.pm10)} · mesurées ${esc(v.mesurees)} <span class="note">non étalonné</span></li>`).join("")}</ul>`
    : "aucun" in am && am.aucun
      ? `<p>${esc(am.aucun)} <a href="#brancher">Brancher un capteur</a></p>`
      : am.echec ? `<p>${esc(am.echec)}</p>` : ""}
  <p class="note">${amLe ? `Lu par rundata.re le ${esc(amLe)} à ${esc(amA)}, sur` : "Capteurs partagés sur"} <a href="${esc(am.carte)}" rel="noopener">Sensor.Community</a> (<a href="${esc(capteurs.DBCL)}" rel="noopener">DbCL 1.0</a>).</p></div>
  <details class="card" id="brancher"><summary>Brancher son capteur</summary>
  <p>Un capteur de particules branché dehors et partagé sur Sensor.Community apparaît dans le bloc ci-dessus, arrondi à sa commune.</p>
  <h3>airRohr (Sensor.Community)</h3>
  <ul class="plain"><li>Une carte NodeMCU ESP8266</li><li>Un capteur de particules SDS011</li><li>Un capteur BME280 (température, humidité, pression)</li><li>Un abri en tube PVC</li></ul>
  <p><a href="${esc(capteurs.GUIDE)}" rel="noopener">Le guide officiel de l'airRohr</a></p>
  <p>Au moment d'inscrire le capteur, arrondissez vous-même sa position : rundata.re n'affiche que la commune, mais Sensor.Community peut publier la position que vous saisissez.</p>
  <p class="note">Lu le 29/10/2026 à 10:53.</p></details>
</section>`
    : "";

  const scale = `<ul class="scale">${[1, 2, 3, 4, 5, 6].map((n) => `<li>${aq(n)}<p>Indice ${n} sur 6.</p></li>`).join("")}</ul>`;

  const title = "Qualité de l'air Réunion aujourd'hui, par commune · 974";
  const description = d && worst != null
    ? describe(`Qualité de l'air à La Réunion (974) aujourd'hui, indice ATMO prévu par Atmo Réunion : ${d.resume.replace(/^Qualité de l'air prévue aujourd'hui à La Réunion : /, "")}`,
        "Qualité de l'air à La Réunion (974) aujourd'hui : l'indice ATMO d'Atmo Réunion dans chaque commune, avec le polluant en cause.")
    : "Qualité de l'air à La Réunion (974) aujourd'hui : l'indice ATMO d'Atmo Réunion dans chaque commune, avec le polluant en cause.";

  const band = `${crumbBar("Qualité de l'air")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>${top ? "Mesuré aux stations" : "Prévision du jour"}</p>
    <h1>Qualité de l'air <span class="n974">974</span></h1>
    ${status}
    ${ask(`Lèr lé bon La Rényon zordi ? Gèt si ${url} é di amwin pou mon komine.`,
      `L'air est-il bon aujourd'hui à La Réunion ? Lis ${url} et dis-moi la qualité de l'air dans ma commune.`)}
  </div>
  ${airMap(d, layers)}
</div>`;

  const body = `${measures}
<section aria-labelledby="h-communes-air">
  <div class="sec-h"><p class="eyebrow">Commune par commune</p><h2 id="h-communes-air">L'indice dans les 24 communes</h2>
  <p>L'indice ATMO prévu va de 1 (bon) à 6 (extrêmement mauvais). C'est le plus mauvais des sous-indices de cinq polluants : particules PM2,5 et PM10, ozone, dioxyde d'azote, dioxyde de soufre. Entre parenthèses, le polluant en cause.</p></div>
  ${d ? `<div class="levels">${byLevel}</div>${subs}${warnings(d.avertissements)}` : `<p class="card">L'indice se charge : rechargez la page dans quelques secondes.</p>`}
</section>
${amateurs}
<section aria-labelledby="h-source-air">
  <div class="sec-h"><p class="eyebrow">Provenance</p><h2 id="h-source-air">D'où vient l'indice</h2></div>
  <div class="card"><dl class="facts">
    <div><dt>Calculé par</dt><dd><a href="${esc(atmo.PROVENANCE.site)}" rel="noopener">Atmo Réunion</a>, observatoire agréé de la qualité de l'air</dd></div>
    <div><dt>Diffusé par</dt><dd>Atmo France, couche ouverte ind_atmo_2021 (<a href="${esc(atmo.PROVENANCE.fiche)}" rel="noopener">sa fiche sur data.gouv.fr</a>)</dd></div>
    <div><dt>Licence</dt><dd><a href="${esc(atmo.PROVENANCE.licence_lien)}" rel="noopener">${esc(atmo.PROVENANCE.licence)}</a></dd></div>
  </dl>${d && data ? `<p class="note">${d.diffusion ? `${esc(d.diffusion)} ` : ""}Lue par rundata.re ${readAt(data.fetchedAt, now).a}.</p>` : ""}</div>
  <div class="card"><h3>Comment l'indice est calculé</h3><ul class="plain">${atmo.METHODE.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
  <p class="note">D'après le <a href="${esc(atmo.GUIDE)}" rel="noopener">guide de calcul de l'indice ATMO</a> d'Atmo France (version du 14/12/2020), en application de l'arrêté du 10 juillet 2020.</p></div>
  ${d ? `<p class="sources">Sources : ${credits(d.sources)}.</p>` : ""}
</section>
<section aria-labelledby="h-echelle-air">
  <div class="sec-h"><p class="eyebrow">Bon à savoir</p><h2 id="h-echelle-air">L'échelle de l'indice</h2></div>
  <div class="card">${scale}<p class="note">Pendant une éruption, le panache peut dégrader l'air dans le sud et l'ouest de l'île : suivez les consignes de l'ARS et de la préfecture.</p></div>
</section>
${connectorCta("qualite_air", "l'air de l'île")}`;

  return layout(origin, { title, description, path: "/air", jsonld: [crumbs(origin, "Qualité de l'air", "/air"), webPage(origin, "/air", title, description, data)], alerte }, band, body);
}

export function airLive(data: Cached<AirAnswer> | null, now = new Date()): Live | undefined {
  if (!data) return undefined;
  const list = data.value.communes ?? [];
  if (!list.length) return empty(`Indice ATMO du jour pas encore dans la lecture ${readAt(data.fetchedAt, now).de}.`);
  const worst = Math.max(...list.map((c) => c.niveau));
  const best = Math.min(...list.map((c) => c.niveau));
  const polluants = [...new Set(list.filter((c) => c.niveau === worst).flatMap((c) => c.polluants))];
  return {
    valeur: best === worst ? aq(worst) : `${aq(best)} à ${aq(worst)}`,
    detail: `indice ATMO prévu pour aujourd'hui dans les 24 communes${polluants.length ? ` (${esc(polluants.join(", "))})` : ""}`,
  };
}

// ---------------------------------------------------------------- électricité

/** A site that did not answer (tools/injoignable.ts), « son site » linked to it. */
export const silentText = (s: { texte: string; site: string }) => esc(s.texte).replace(/voir son site\.$/, `voir <a href="${esc(s.site)}" rel="noopener">son site</a>.`);
export const silentItem = (s: { texte: string; site: string }) => `<li><span class="note">${silentText(s)}</span></li>`;

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
      ? `<div class="now"><span class="big">${fr(Math.round(p.renouvelable_pct))} %</span><p>de l'électricité de l'île vient en ce moment de sources <b>renouvelables</b>, sur <b>${esc(fr(Math.round(p.total_mw)))} MW</b> produits (${esc(p.heure_mesure.replace(" heure de La Réunion", ""))}).</p></div>` +
        (m?.maintenant ? `<p class="lead">Signal d'EDF pour cette heure : <b>${esc(m.maintenant.signal.toLowerCase())}</b>${m.mis_a_jour ? ` (annoncé par EDF le ${esc(m.mis_a_jour.replace(" ", " à "))})` : ""}.</p>` : "")
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
  ${c.a_savoir ? `<p>${esc(c.a_savoir)}</p>` : ""}${c.non_repris ? `<p class="np">${esc(c.non_repris)}${reprise(c.non_repris)}</p>` : ""}${c.depannage ? `<p><b>${esc(c.depannage)}</b></p>` : ""}</div>
  ${(c.injoignable ?? []).map((s) => `<p class="note">${silentText(s)}</p>`).join("")}
  ${c.avis?.length
    ? `<div class="card"><ul class="plain">${c.avis.map(courantItem).join("")}</ul></div>`
    : c.injoignable?.length ? "" : `<p class="card">${esc(c.indisponible ?? "Aucun avis relayé par les mairies suivies.")}</p>`}
</section>`
    : "";

  const title = "Électricité Réunion en direct : part renouvelable · 974";
  const description = p
    ? describe(`Électricité à La Réunion (974) à ${p.heure_mesure.split(" ")[1]} : ${fr(Math.round(p.total_mw))} MW produits, dont ${fr(Math.round(p.renouvelable_pct))} % renouvelable. Filière par filière, et les heures où le réseau est chargé.`,
        `Électricité à La Réunion (974) : ${fr(Math.round(p.renouvelable_pct))} % renouvelable en ce moment. Filière par filière, et les heures où le réseau est chargé.`)
    : "Électricité à La Réunion (974) en direct : d'où vient le courant, la part renouvelable et les heures où le réseau est chargé.";

  const band = `${crumbBar("Électricité")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Production en direct</p>
    <h1>Électricité <span class="n974">974</span></h1>
    ${status}
    ${ask(`Kouran la koupé dann mon kartié ? Gèt si ${url} é di amwin, é d'ousa i sort lo kouran astèr.`,
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

export function electriciteLive(data: Cached<ElectriciteAnswer> | null, now = new Date()): Live | undefined {
  if (!data) return undefined;
  const p = data.value.production;
  if (!p) return empty(`Production d'EDF absente de la lecture ${readAt(data.fetchedAt, now).de}.`);
  const signal = data!.value.meteo_electricite?.maintenant?.signal;
  // EDF's terms: its name and the dataset's update beside the signal, an announcement for this hour.
  const jeu = data!.value.meteo_electricite?.mis_a_jour;
  return {
    valeur: `${fr(Math.round(p.renouvelable_pct))}\u202f% renouvelable`,
    detail: `${esc(fr(Math.round(p.total_mw)))} MW produits à ${esc(p.heure_mesure.split(" ")[1] ?? p.heure_mesure)}${signal ? ` · signal EDF ${esc(signal.toLowerCase())}${jeu ? ` (annoncé le ${esc(jeu.replace(" ", " à "))})` : ""}` : ""}`,
    // Never cut before the date EDF's terms ask for (three lines at 390 px are not enough for it).
    ...(signal && jeu && { entier: true }),
  };
}

// ---------------------------------------------------------------- calendrier

/**
 * The public holidays of a copy counted again from today: the copy, made every six hours, may be from the day before
 * (« Toussaint dans 6 j » the day after). A day reached is today's holiday; one past is left out.
 */
export function feriesDuJour(data: Cached<CalendrierAnswer> | null, now: Date): CalendrierAnswer["jours_feries"] {
  const f = data?.value.jours_feries;
  const late = f ? daysApart(data!.fetchedAt, now) : 0;
  if (!f || late <= 0) return f;
  const counted = f.prochains.map((x) => ({ ...x, dans_jours: x.dans_jours - late })).filter((x) => x.dans_jours >= 0);
  return { ...f, aujourd_hui: counted.find((x) => x.dans_jours === 0)?.nom ?? null, prochains: counted.filter((x) => x.dans_jours > 0) };
}

export function calendrierPage(origin: string, data: Cached<CalendrierAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const v = d?.vacances_scolaires;
  const f = feriesDuJour(data, now);
  const next = f?.prochains[0];
  const url = `${origin}/calendrier`;
  const today = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Indian/Reunion" });

  const status = !d
    ? loading("Le calendrier")
    : `<div class="status"><p class="big">${esc(today)}</p>` +
      (f?.aujourd_hui ? `<p class="lead">Aujourd'hui est férié : <b>${esc(f.aujourd_hui)}</b>.</p>` : "") +
      (v?.en_cours ? `<p class="lead">Vacances scolaires en cours, reprise des cours le <b>${esc(v.en_cours.reprise_des_cours)}</b>.</p>` : "") +
      (next ? `<p class="lead">Prochain jour férié : <b>${esc(next.nom)}</b>, ${esc(next.date)} (dans ${next.dans_jours} jour${next.dans_jours > 1 ? "s" : ""}).</p>` : "") +
      (d.soleil ? `<p class="lead">À ${esc(d.soleil.lieu)}, lever du soleil à <b>${esc(d.soleil.lever)}</b>, coucher à <b>${esc(d.soleil.coucher)}</b>.</p>` : "") +
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
    ? `<div class="card">${icon("mountain")}<h3>Soleil à ${esc(d.soleil.lieu)}</h3><p>Lever ${esc(d.soleil.lever)}, coucher ${esc(d.soleil.coucher)} : ${esc(d.soleil.duree_du_jour)} de jour.</p><p class="note">${esc(d.soleil.note)}</p></div>`
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
    ? describe(`Vacances scolaires ${year} à La Réunion (974), calendrier austral : ${span}. Jours fériés dont le 20 décembre.`,
        `Vacances scolaires ${year} à La Réunion (974) : ${span}. Jours fériés dont le 20 décembre.`)
    : next
      ? describe(`Vacances scolaires ${year} à La Réunion (974), calendrier austral ; prochain jour férié ${next.nom} (${next.date}). Le 20 décembre, lever et coucher du soleil.`,
          `Vacances scolaires ${year} à La Réunion (974), jours fériés dont le 20 décembre, lever et coucher du soleil.`)
      : `Vacances scolaires ${year} à La Réunion (974), calendrier austral : jours fériés dont le 20 décembre, lever et coucher du soleil.`;

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
<div class="wrap intro solo">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Aujourd'hui à La Réunion</p>
    <h1>Vacances scolaires et jours fériés à La Réunion</h1>
    ${status}
    ${ask(`Kansa lé lo prochin vakans lékol é lo prochin zour férié La Rényon ? Gèt si ${url} é di amwin.`,
      `Quand sont les prochaines vacances scolaires et le prochain jour férié à La Réunion ? Lis ${url} et dis-le-moi.`)}
  </div>
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

export function calendrierLive(data: Cached<CalendrierAnswer> | null, now = new Date()): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const v = d.vacances_scolaires?.en_cours;
  const f = feriesDuJour(data, now);
  const next = f?.prochains[0];
  const valeur = f?.aujourd_hui ? `Férié : ${esc(f.aujourd_hui)}` : v ? "Vacances scolaires" : next ? `${esc(next.nom)} dans ${next.dans_jours} j` : undefined;
  // The date is enough here: the year's list runs out at its end, before the next one is loaded.
  if (!valeur) return empty(`Ni vacances en cours ni jour férié à venir dans le calendrier lu le ${localTime(data!.fetchedAt).split(" ")[0]}.`);
  return {
    valeur,
    detail: [
      v ? `reprise le ${esc(v.reprise_des_cours)}` : undefined,
      (f?.aujourd_hui || v) && next ? `${esc(next.nom)} dans ${next.dans_jours} j` : undefined,
      d.soleil ? `soleil ${esc(d.soleil.lever)}–${esc(d.soleil.coucher)}` : undefined,
    ].filter(Boolean).join(" · "),
  };
}

// ---------------------------------------------------------------- bus

export const waitText = (min: number, heure: string) =>
  heure.startsWith("demain") ? heure : min < 1 ? "maintenant" : min < 90 ? `dans ${fr(min)} min` : `à ${heure}`;

type Row = BusData["gares"][number]["departs"][number];

const LOCAL_MS = 4 * 3600_000;
const DAY_MS = 86_400_000;

/**
 * A copy's time (« 04:30 », « 5\u00a0h », or « demain 04:30 » when the copy was built before midnight) as said at the
 * view, in the brand's form: « demain » only when it falls on the day after this one at La Réunion. The clock is taken
 * on the day that puts it closest to `near`, the moment of the departure or of the copy. A copy written before the
 * brand's form (« 4h30 ») reads the same.
 */
export function saidNow(said: string, near: number, now: Date): string {
  const t = /^(?:demain )?(\d{1,2})(?::(\d\d)|[\u00a0 ]?h ?(\d\d)?)$/.exec(said);
  if (!t) return said;
  const [h, m] = [Number(t[1]), Number(t[2] ?? t[3] ?? 0)];
  const clock = heure(h * 60 + m);
  const local = near + LOCAL_MS;
  let at = local - (((local % DAY_MS) + DAY_MS) % DAY_MS) + (h * 60 + m) * 60_000;
  if (at - local > DAY_MS / 2) at -= DAY_MS;
  else if (local - at > DAY_MS / 2) at += DAY_MS;
  return Math.floor(at / DAY_MS) > Math.floor((now.getTime() + LOCAL_MS) / DAY_MS) ? `demain ${clock}` : clock;
}

/** « à 04:30 », « demain à 04:30 ». */
export const atDay = (heure: string) => (heure.startsWith("demain ") ? `demain à ${heure.slice("demain ".length)}` : `à ${heure}`);

/** The departures of a copy still to come: their wait counted again from now, their time (the announced one first) said as of now. */
export function stillToCome(list: Row[], fetchedAt: Date, now: Date): { x: Row; at: number; min: number; heure: string }[] {
  return list
    .map((x) => {
      const at = fetchedAt.getTime() + x.dans_min * 60_000;
      return { x, at, min: Math.round((at - now.getTime()) / 60_000), heure: saidNow(x.heure_annoncee ?? x.heure, at, now) };
    })
    .filter(({ min }) => min >= 0);
}

/**
 * Whether a copy of /bus, `ageMs` old, has outrun what it knows of a station (`complet_min`): a list emptied by time is
 * then not « no bus ». A copy of 19:45 seen at 01:37 (31/10/2026) said « Pas de départ prévu » at four stations, their
 * 3 hours long gone, while two that had looked 20 hours ahead gave the morning's. Such a copy is refreshed before it
 * is shown (web/site.ts); one served all the same says it is loading, as does a commune's bus tile (web/commune.ts).
 * A copy without the field (built before it) is taken as knowing.
 */
export const busOutran = (g: Pick<GareNow, "complet_min">, ageMs: number) => g.complet_min != null && ageMs >= g.complet_min * 60_000;

/** What the real-time feed says of a departure, HTML: « +5 min », « à l'heure », « 1 min d'avance », « ne passe pas à cet arrêt ». */
export function liveText(x: Row): string {
  if (x.temps_reel) return ` <b class="rt">${esc(x.temps_reel)}</b>`;
  if (x.retard_min === undefined) return "";
  const m = x.retard_min;
  return ` <b class="rt" title="Heure annoncée en direct par le réseau">${m === 0 ? "à l'heure" : m > 0 ? `+${fr(m)} min` : `${fr(-m)} min d'avance`}</b>`;
}

/** One departure as a row: line, direction, wait (from the real-time feed when there is one). */
export const departureLi = (x: Row, wait: string) =>
  `<li><b>${esc(x.ligne)}</b><span>${x.trajet ? `<a href="${esc(x.trajet)}">vers ${esc(x.direction)}</a>` : `vers ${esc(x.direction)}`} <span class="note">(${esc(x.reseau)})</span></span><span class="note">${esc(wait)}${liveText(x)}</span></li>`;

export const STOP_PATH = "/bus/arret";

/** The search for a stop (/bus/arret?q=): a form, which needs no script. */
export const stopSearch = (q = "") =>
  `<form class="card filter" role="search" action="${STOP_PATH}" method="get"><label class="q">Arrêt de bus <input name="q" type="search" placeholder="Mairie, Le Tampon" autocomplete="off" required value="${esc(q)}"></label><button class="btn sun" type="submit">Chercher</button></form>`;

/** The traffic alerts of the networks with a real-time feed. */
export const alertList = (list: { reseau: string; lignes?: string[]; titre: string; detail?: string }[]) =>
  `<ul class="plain">${list.map((a) => `<li><b>${esc(a.reseau)}${a.lignes ? `, ligne ${esc(a.lignes.join(", "))}` : ""}</b> : ${esc(a.titre)}${a.detail && a.detail !== a.titre ? `<p class="note">${esc(a.detail)}</p>` : ""}</li>`).join("")}</ul>`;

export const HORAIRES_CHARGENT = "Les horaires se chargent\u00a0: rechargez la page dans quelques secondes.";

export function busPage(origin: string, data: Cached<BusData> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/bus`;
  const lines = d?.reseaux.reduce((n, r) => n + r.lignes, 0) ?? 0;

  const status = !d
    ? `<p class="lead">${HORAIRES_CHARGENT}</p>`
    : `<div class="now"><span class="big">${d.reseaux.length}</span><p>réseaux de bus et le téléphérique de Saint-Denis : <b>${esc(fr(lines))} lignes</b>, de Car Jaune qui fait le tour de l'île aux bus de chaque commune.</p></div>`;

  const networks = d
    ? `<ul class="plain">${d.reseaux.map((r) => `<li><b>${esc(r.nom)}</b> : ${esc(fr(r.lignes))} ligne${r.lignes > 1 ? "s" : ""} <span class="note">(${esc(r.exploitant)})</span></li>`).join("")}</ul>`
    : "";

  const gares = d?.gares.length
    ? `<ul class="zones">${d.gares.map((g) => {
        const left = stillToCome(g.departs, data!.fetchedAt, now);
        return `<li class="card"><h3>Gare ${esc(de(g.commune))}</h3>` +
        `<p class="note">${g.arrets.map((a) => `${esc(a.reseau)} : ${a.page ? `<a href="${STOP_PATH}/${esc(a.page)}">${esc(a.nom)}</a>` : esc(a.nom)}`).join(" · ")}</p>` +
        (left.length
          ? `<ul class="rows departs">${left.map(({ x, min, heure }) => departureLi(x, waitText(min, heure))).join("")}</ul>`
          : busOutran(g, now.getTime() - data!.fetchedAt.getTime())
            ? `<p>${HORAIRES_CHARGENT}</p>`
            : `<p>Pas de départ prévu dans les prochaines heures.</p>`) +
        `</li>`;
      }).join("")}</ul>` +
      `<p class="note">${d!.temps_reel?.length ? `${esc(d!.temps_reel.map((t) => t.reseau).join(", "))} : heures annoncées en direct par le réseau quand le bus y figure (flux de ${esc(d!.temps_reel[0].heure)}). ` : ""}` +
      `Sinon, horaires théoriques publiés par chaque réseau, sans les retards ni les déviations. Mis à jour à ${hm(data!.fetchedAt)}.</p>`
    : `<p class="card">Les prochains départs à n'importe quel arrêt de l'île sont donnés par le connecteur : demandez à votre assistant « le prochain bus à la gare de Saint-Pierre ? ».</p>`;

  const title = "Horaires bus Réunion : prochains départs en gare · 974";
  const description = "Bus à La Réunion (974) : prochains départs dans les gares routières, d'après les horaires de Car Jaune, Citalis, Kar'Ouest, Alternéo, CarSud et Estival.";

  const band = `${crumbBar("Bus")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Horaires du jour</p>
    <h1>Bus et cars <span class="n974">974</span></h1>
    ${status}
    ${stopSearch()}
    ${ask(`Kansa i pas lo prochin bis la gar Sin-Pyèr ? Gèt si ${url} é di amwin.`,
      `Quand passe le prochain bus à la gare routière de Saint-Pierre ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${d ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">Les réseaux</h3>${networks}</figure>` : ""}
</div>`;

  const body = `<section aria-labelledby="h-gares">
  <div class="sec-h"><p class="eyebrow">En ce moment</p><h2 id="h-gares">Prochains départs dans les gares routières</h2>
  <p>Toutes les lignes qui partent de chaque gare, tous réseaux confondus, au plus trois départs par ligne et par direction.</p></div>
  ${gares}
  ${d ? `<p class="sources">Sources : ${credits(d.sources)}.</p>` : ""}
</section>
${d?.alertes?.length ? `<section aria-labelledby="h-trafic"><h2 id="h-trafic">Info trafic</h2><div class="card">${alertList(d.alertes)}<p class="note">Publié par les réseaux dans leur flux en direct, repris tel quel.</p></div></section>` : ""}
${connectorCta("transports", "les bus de l'île")}
<section aria-labelledby="h-bateau"><h3 id="h-bateau">${esc(FERRY.h3)}</h3><p>${esc(FERRY.page)}</p><p class="note">${esc(FERRY.verifie)}</p></section>`;

  return layout(origin, { title, description, path: "/bus", jsonld: [crumbs(origin, "Bus", "/bus"), webPage(origin, "/bus", title, description, data)], alerte }, band, body);
}

export function busLive(data: Cached<BusData> | null, now = new Date()): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const g = d.gares.find((x) => stillToCome(x.departs, data!.fetchedAt, now).length);
  // A copy past what it knows of a station says nothing rather than « no bus ».
  if (!g && d.gares.some((x) => busOutran(x, now.getTime() - data!.fetchedAt.getTime()))) return undefined;
  // The words of the commune pages' bus tile in the same case.
  if (!g) return { valeur: "Pas de départ", detail: "aux gares dans les prochaines heures, d'après les horaires publiés" };
  const { x, heure } = stillToCome(g.departs, data!.fetchedAt, now)[0];
  return {
    // A time rather than « dans 3 min »: the page may be a few minutes old.
    valeur: esc(heure),
    detail: `prochain départ de la gare ${esc(de(g.commune))} : ligne ${esc(x.ligne)} vers ${esc(x.direction)} (${esc(x.reseau)})`,
  };
}

// ---------------------------------------------------------------- vélos

/** « 4 vélos · 6 places », « fermée ». */
export function bikeStock(s: VeloStation): string {
  if (s.etat === "fermée" || s.etat === "location impossible en ce moment") return esc(s.etat);
  const parts = [`<b>${s.velos_electriques}</b>\u00a0vélo${s.velos_electriques > 1 ? "s" : ""}`];
  if (s.trottinettes) parts.push(`<b>${s.trottinettes}</b>\u00a0trottinette${s.trottinettes > 1 ? "s" : ""}`);
  if (s.places_libres != null && !s.etat) parts.push(`${s.places_libres}\u00a0place${s.places_libres > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

/** A station, and « Y aller » below its name when its copy kept its position (no address: the sheet copies the coordinates). */
export const bikeRow = (s: VeloStation, g: Porte = porte()) => {
  const go = g.aller({ nom: s.nom, lat: s.lat ?? NaN, lon: s.lon ?? NaN });
  return `<li><span>${esc(s.nom)}${go ? `<span class="ya">${go}</span>` : ""}</span><span>${bikeStock(s)}</span></li>`;
};

export function velosPage(origin: string, data: Cached<VelosAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const g = porte(alerte);
  const d = data?.value;
  const url = `${origin}/velos`;
  const total = d?.communes?.reduce((n, c) => n + c.velos_disponibles, 0) ?? 0;

  const status = !d
    ? loading("L'état des stations")
    : `<div class="now"><span class="big">${total}</span><p>vélo${total > 1 ? "s" : ""} à assistance électrique disponible${total > 1 ? "s" : ""} en ce moment dans les <b>${d.stations.length}\u00a0stations</b> Altervélo de ${esc(BIKE_COMMUNES.join(", ").replace(/, ([^,]+)$/, " et $1"))}.</p></div>`;

  const fills = Object.fromEntries(BIKE_COMMUNES.map((c) => [c, "var(--hl)"]));
  // Each commune served leads to its stations below.
  const links: Record<string, ZoneLink> = d
    ? Object.fromEntries(BIKE_COMMUNES.map((c) => {
        const n = d.communes?.find((x) => x.commune === c)?.velos_disponibles ?? 0;
        return [c, { href: `#${anchorId("c", c)}`, say: `${n} vélo${n > 1 ? "s" : ""} disponible${n > 1 ? "s" : ""}` }];
      }))
    : {};
  const byCommune = d
    ? `<ul class="zones">${BIKE_COMMUNES.map((c) => {
        const mine = d.stations.filter((s) => s.commune === c).sort((a, b) => b.velos_electriques + (b.trottinettes ?? 0) - (a.velos_electriques + (a.trottinettes ?? 0)) || a.nom.localeCompare(b.nom, "fr"));
        const n = d.communes?.find((x) => x.commune === c)?.velos_disponibles ?? 0;
        return `<li class="card tgt" id="${anchorId("c", c)}"><h3>${esc(c)} <span class="note">${n}\u00a0vélo${n > 1 ? "s" : ""}, ${mine.length}\u00a0station${mine.length > 1 ? "s" : ""}</span></h3>` +
          `<ul class="rows bikes">${mine.map((s) => bikeRow(s, g)).join("")}</ul></li>`;
      }).join("")}</ul>` +
      `<p class="note">${esc(d.donnees)}</p>`
    : `<p class="card">L'état des stations se charge : rechargez la page dans quelques secondes.</p>`;

  const title = "Vélos Altervélo en direct : stations libres · 974";
  const description = d
    ? describe(`Vélos électriques Altervélo en libre-service (974) en ce moment : ${total} vélos disponibles, et les places libres de chaque station à Saint-Pierre, Saint-Louis et L'Étang-Salé.`,
        "Vélos électriques Altervélo en libre-service (974) : vélos et places libres de chaque station, en direct.")
    : "Vélos électriques Altervélo en libre-service (974) : vélos et places libres de chaque station, en direct.";

  const band = `${crumbBar("Vélos")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>En direct</p>
    <h1>Vélos en libre-service <span class="n974">974</span></h1>
    ${status}
    ${ask(`Néna in vélo Altervélo i rès dan la stasion IUT ? Gèt si ${url} é di amwin.`,
      `Reste-t-il des vélos Altervélo à la station IUT de Saint-Pierre ? Lis ${url} et dis-le-moi.`)}
  </div>
  <figure class="card mapcard">${islandMap({ fills, links, label: "Carte de La Réunion (974) : les communes où circulent les vélos Altervélo" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Les communes desservies par Altervélo.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-stations">
  <div class="sec-h"><p class="eyebrow">Station par station</p><h2 id="h-stations">Vélos et places libres</h2>
  <p>${d ? esc(d.service) : "Altervélo : vélos à assistance électrique en libre-service de la CIVIS."}</p></div>
  ${byCommune}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("velos_libre_service", "les vélos du Sud")}${d ? g.feuille : ""}`;

  return layout(origin, { title, description, path: "/velos", jsonld: [crumbs(origin, "Vélos", "/velos"), webPage(origin, "/velos", title, description, data)], alerte }, band, g.ligne + body);
}

export function velosLive(data: Cached<VelosAnswer> | null, now = new Date()): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  if (!d.communes) return empty(`Disponibilités Altervélo absentes de la lecture ${readAt(data!.fetchedAt, now).de}.`);
  const total = d.communes.reduce((n, c) => n + c.velos_disponibles, 0);
  const best = [...d.stations].sort((a, b) => b.velos_electriques - a.velos_electriques)[0];
  return {
    valeur: `${total} vélo${total > 1 ? "s" : ""}`,
    detail: `disponibles dans ${d.stations.length} stations Altervélo${best?.velos_electriques ? `, dont ${best.velos_electriques} à ${esc(best.nom)} (${esc(best.commune)})` : ""}`,
  };
}

// ---------------------------------------------------------------- crues

// Vigicrues Réunion's colours, the worst first; « indisponible » last.
const FLOOD_ORDER = ["rouge", "orange", "jaune", "vert", "indisponible"];
const FLOOD_COLOR: Record<string, string> = { rouge: "#f03e3e", orange: "#ff922b", jaune: "#ffd43b", vert: "#69db7c" };
// The map's markers: what the gauge measured, never the vigilance's colours (orange would read as one); the shape says
// it as much as the colour. A rise in the night's colour, bigger and edged in white, with its arrow: its shape makes it the mark to see first, as
// red would read as Vigicrues' own red vigilance. Stable or falling: a value with no judgement, muted in the dark theme
// (--gauge-calme) so that the rise stands out. No recent measure: a grey ring, the map showing through.
const GAUGE_COLOR = { hausse: "#14202b", calme: "var(--gauge-calme)", muette: "#868e96" };
const GAUGE_RANK = { muette: 0, calme: 1, hausse: 2 };
const floodBadge = (c: string) => `<span class="lvl" style="--c:${FLOOD_COLOR[c] ?? "#868e96"}">${esc(c)}</span>`;
const metres = (v: number) => `${fr(Math.round(v * 100) / 100)} m`;
const flow = (v: number) => `${fr(Math.round(v * 100) / 100)} m³/s`;
const measuredHm = (s: CruesStation) => s.heure_mesure?.split(" ")[1] ?? "";
/** Measured within the last half hour: only these are said rising or not. */
const upToDate = (s: CruesStation) => s.hauteur_m != null && !s.avertissement;
const dayAt = (d: Date) => localTime(d).replace(" ", " à ");
/** A river's name to match the vigilance's to the gauges': « rivière des Galets » → « galets ». */
const riverCore = (r: string) => normalize(r).replace(/^(grande |petite )?(riviere|ravine|bras|etang) (de la |des |du |de |d )?/, "");

/** A marker of the map as the legend shows it: filled, with its sign, or a ring. */
/** « , la plus récente à 02:45 » (« le 30/10 à 02:45 » another day), from the stations' times (« 31/10 02:45 »). */
function latestGauge(d: CruesAnswer | undefined): string {
  const key = (t: string) => t.replace(/^(\d\d)\/(\d\d)/, "$2$1");
  const last = (d?.stations ?? []).filter(upToDate).map((s) => s.heure_mesure).filter((t): t is string => !!t).sort((a, b) => key(a).localeCompare(key(b))).pop();
  if (!last) return "";
  const [day, time] = last.split(" ");
  return ` : mesure la plus récente le ${day} à ${time}`;
}


/** The vigilance in the page's status, from Vigicrues Réunion; `readAt`: our read, when it could not be read. */
function floodVigilance(v: CruesAnswer["vigilance_crues"], read: string): string {
  if (!v) return `<p class="lead">Vigilance crues absente de notre lecture ${esc(read)} : voir <a href="${vigicrues.SOURCE.url}">vigicrues-reunion.re ↗</a>.</p>`;
  if (!v.active) {
    return `<p class="lead">Pas de vigilance crues en cours d'après Vigicrues Réunion : toutes les rivières suivies sont au vert.</p>` +
      (v.aucun_bulletin_depuis ? `<p class="note">Dernier bulletin le ${esc(v.aucun_bulletin_depuis)} : Vigicrues Réunion n'en publie qu'en vigilance jaune ou plus.</p>` : "");
  }
  const raised = ["rouge", "orange", "jaune"].map((c) => ({ c, rivers: v.rivieres.filter((r) => r.couleur === c).map((r) => r.nom) })).filter((x) => x.rivers.length);
  const said = raised.map((x) => `${x.c} pour ${x.rivers.join(", ")}`);
  const head = said.length ? `<b>Vigilance crues ${esc(said[0])}</b>${said.slice(1).map((x) => `, ${esc(x)}`).join("")}` : "<b>Vigilance crues</b>";
  return `<p class="lead">${head}, d'après Vigicrues Réunion (bulletin n° ${v.bulletin ?? ""} du ${v.date ? esc(dayAt(new Date(v.date))) : ""}).</p>` +
    (v.observations ? `<p class="note">Ce que dit le bulletin : « ${esc(v.observations)} »</p>` : "") +
    (v.anticipation ? `<p class="note">À venir : « ${esc(v.anticipation)} »</p>` : "");
}

/** The gauges in the page's status: only those measured lately are said rising or not; the others counted apart. */
function floodLevels(stations: CruesStation[], read: string): string {
  const fresh = stations.filter(upToDate);
  if (!fresh.length) return `<p class="lead">Aucune des ${stations.length} stations n'a de mesure de moins de 30 minutes dans notre lecture ${esc(read)} : nous ne savons pas pour l'instant si les rivières montent.</p>`;
  const others = stations.filter((s) => !upToDate(s));
  const end = others.length > 1 ? ` Les ${others.length} autres n'ont pas de mesure récente.` : others.length ? ` Une station n'a pas de mesure récente : ${esc(others[0].station)}.` : "";
  const at = fresh.map(measuredHm).sort().at(-1);
  const rising = fresh.filter((s) => s.tendance_30_min === "en hausse");
  if (rising.length) return `<p class="lead">En hausse sur la dernière demi-heure (mesures de ${at}) : ${rising.map((s) => `${esc(s.station)} (${esc(s.riviere)}, ${esc(s.commune)}), ${metres(s.hauteur_m!)}`).join(" ; ")}.${end}</p>`;
  if (fresh.length === 1) return `<p class="lead">Mesure de ${at} : la seule station à jour n'est pas en hausse sur la dernière demi-heure.${end}</p>`;
  return `<p class="lead">Mesures de ${at} : aucune des ${fresh.length} stations à jour n'est en hausse sur la dernière demi-heure.${end}</p>`;
}

/** What a gauge measured, as its line says it (text, not HTML); without a level, null. */
const gaugeValue = (s: CruesStation): string | null =>
  s.hauteur_m == null
    ? null
    : s.avertissement
      ? `${metres(s.hauteur_m)} à ${measuredHm(s)} · pas de mesure plus récente`
      : [`${metres(s.hauteur_m)}, ${s.tendance_30_min ?? ""}`, ...(s.debit_m3s != null ? [flow(s.debit_m3s)] : []), `mesurée à ${measuredHm(s)}`].join(" · ");

/** A gauge's line in its river's group: up to date, late, or without a level in our read. */
function gaugeRow(s: CruesStation, read: string): string {
  const said = gaugeValue(s);
  const value = said == null ? `Pas de mesure dans notre lecture ${esc(read)}.` : esc(said);
  const floods = [...(s.crues_de_reference ?? [])].sort((a, b) => b.hauteur_m - a.hauteur_m);
  const marks = floods.length
    ? `<details><summary>Crues de référence</summary><ul class="plain">${floods.map((c) => `<li>${[metres(c.hauteur_m), ...(c.debit_m3s != null ? [flow(c.debit_m3s)] : []), esc(c.nom)].join(" · ")}</li>`).join("")}</ul></details>`
    : "";
  return `<li class="tgt" id="${anchorId("s", s.station)}"><span>${esc(s.station)} · ${esc(s.commune)}<small>${value}</small>${marks}</span><span></span></li>`;
}

// The fords (marketing): the préfecture's instruction in heavy rain, word for word with its communiqué, then the
// announcements that name a ford, each with its source and its time; their state is on infotrafic.re, of which only the
// link is given.
const FORD_RULE = "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Vigilance-orange-fortes-pluies-orages-a-partir-de-12h";

/** The headlines on the fords as the page shows them, and when the news was read; absent when it was not. */
export interface Fords {
  annonces: { titre: string; lien: string; source: string; heure: string }[];
  lue: Date;
}

function fordsSection(f: Fords | undefined, now: Date): string {
  const rule = `<p>Consigne de la préfecture en vigilance fortes pluies : «\u00a0Je ne tente jamais de franchir, à pied ou en voiture, les ravines et les rivières en crue, ou qui peuvent l'être soudainement, ainsi que les radiers submergés\u00a0». <a href="${FORD_RULE}" rel="noopener">Communiqué du 02/04/2026 ↗</a></p>`;
  const said = !f
    ? ""
    : f.annonces.length
      ? `<ul class="plain">${f.annonces.map((a) => `<li>${esc(a.heure)} · ${esc(a.source)} : <a href="${esc(a.lien)}" rel="noopener"${fenetre(a.lien)}>${esc(a.titre)} ↗</a></li>`).join("")}</ul>`
      : `<p>Aucune annonce de la préfecture ni des médias sur un radier dans notre lecture ${readAt(f.lue, now).de}. Cela ne dit pas qu'ils sont ouverts : l'état officiel est sur infotrafic.re.</p>`;
  return `<section aria-labelledby="h-radiers">
  <div class="sec-h"><p class="eyebrow">Par fortes pluies</p><h2 id="h-radiers">Les radiers</h2>
  <p>L'état officiel des routes et des radiers est sur la carte d'infotrafic.re, le site de la Région, qui ne s'affiche que chez elle. Ici, les annonces de la préfecture et des médias qui parlent d'un radier, avec leur heure.</p></div>
  <div class="card">${icon("car")}${rule}${said}<p class="hero-cta"><a class="btn sun" href="${INFOTRAFIC}">${icon("car")}Carte officielle (infotrafic.re) ↗</a></p></div>
</section>`;
}

export function cruesPage(origin: string, data: Cached<CruesAnswer> | null, now = new Date(), alerte?: Alerte, fords?: Fords): string {
  const d = data?.value;
  const url = `${origin}/crues`;
  const read = data ? readAt(data.fetchedAt, now).de : "";
  const v = d?.vigilance_crues;

  const status = !d ? loading("La vigilance crues") : floodVigilance(v, read) + floodLevels(d.stations, read);
  const advice = `<p class="note">Pluies fortes ou crue : ne jamais traverser un radier submergé ni une ravine en eau, à pied ou en voiture. Vigilance pluies de Météo-France : <a href="/vigilance">la vigilance zone par zone</a>.</p>`;

  // The rivers under vigilance, the worst first; Vigicrues Réunion's order within a colour.
  const rivers = [...(v?.rivieres ?? [])].sort((a, b) => FLOOD_ORDER.indexOf(a.couleur) - FLOOD_ORDER.indexOf(b.couleur));
  const riverLi = (r: { nom: string; couleur: string; precedente: string }) =>
    `<li><span>${esc(r.nom)}${r.couleur !== r.precedente ? `<small>(${esc(r.precedente)} au bulletin précédent)</small>` : ""}</span><span>${floodBadge(r.couleur)}</span></li>`;
  const allGreen = rivers.length > 0 && rivers.every((r) => r.couleur === "vert");
  const riverList = !rivers.length
    ? ""
    : allGreen
      ? `<details class="card"><summary>Les ${rivers.length} rivières suivies, toutes au vert d'après Vigicrues Réunion</summary><ul class="rows eau">${rivers.map(riverLi).join("")}</ul></details>`
      : `<div class="card"><ul class="rows eau">${rivers.map(riverLi).join("")}</ul></div>`;

  // A group's colour, only when every river of the vigilance with that name agrees (the grande and the petite rivière
  // Saint-Jean have one gauge between them) and it is not green.
  const colourOf = (riviere: string) => {
    const same = [...new Set(rivers.filter((r) => riverCore(r.nom) === riverCore(riviere)).map((r) => r.couleur))];
    return same.length === 1 && same[0] !== "vert" ? same[0] : undefined;
  };
  // By river, in the order of the gauges (round the island).
  const groups = d ? [...new Set(d.stations.map((s) => s.riviere))].map((riviere) => ({ riviere, stations: d.stations.filter((s) => s.riviere === riviere) })) : [];
  const gauges = d
    ? `<ul class="zones">${groups.map((g) => {
        const c = colourOf(g.riviere);
        return `<li class="card"><h3>${esc(g.riviere)}${c ? ` ${floodBadge(c)}` : ""}</h3><ul class="rows eau">${g.stations.map((s) => gaugeRow(s, read)).join("")}</ul></li>`;
      }).join("")}</ul>`
    : "";

  const place = new Map(vigicrues.STATIONS.map((s) => [s.nom, s]));
  // The rising ones drawn last, over their neighbours.
  const markers: Marker[] = (d?.stations ?? []).map((s) => ({ s, kind: !upToDate(s) ? "muette" as const : s.tendance_30_min === "en hausse" ? "hausse" as const : "calme" as const }))
    .sort((a, b) => GAUGE_RANK[a.kind] - GAUGE_RANK[b.kind]).flatMap(({ s, kind }) => {
    const at = place.get(s.station);
    if (!at) return [];
    const line = gaugeValue(s) ?? `pas de mesure dans notre lecture ${read}`;
    const where = `${s.station} · ${s.commune}`;
    return [{ lon: at.lon, lat: at.lat, label: kind === "hausse" ? "↑" : "", name: `${where} : ${line}`, round: true, hollow: kind === "muette", big: kind === "hausse", color: GAUGE_COLOR[kind], quiet: true,
      place: where, say: line, href: `#${anchorId("s", s.station)}` }];
  });

  const title = "Crues Réunion en direct : rivières et vigilance · 974";
  const short = "Crues à La Réunion (974) : vigilance de Vigicrues Réunion rivière par rivière, hauteur et débit mesurés aux stations de la DEAL toutes les 5 minutes.";
  const vigilanceSaid = !v ? undefined : !v.active ? "Pas de vigilance crues en cours d'après Vigicrues Réunion : toutes les rivières suivies sont au vert." : undefined;
  const description = vigilanceSaid ? describe(`${vigilanceSaid} ${short}`, short) : short;

  const band = `${crumbBar("Crues")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Vigicrues Réunion</p>
    <h1>Crues des rivières <span class="n974">974</span></h1>
    ${status}
    ${advice}
    ${ask(`Larivyèr i mont Sin-Bénoi ? Gèt si ${url} é di amwin.`,
      `La rivière monte-t-elle à Saint-Benoît ? Lis ${url} et dis-moi si l'eau monte.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : les stations de mesure des rivières de la DEAL" })}
  <figcaption class="note" style="color:var(--on-night-muted)">${legende([
    { forme: "rond", couleur: GAUGE_COLOR.hausse, texte: "↑", dit: "en hausse", grand: true },
    { forme: "rond", couleur: GAUGE_COLOR.calme, dit: "stable ou en baisse" },
    { forme: "anneau", couleur: GAUGE_COLOR.muette, dit: "sans mesure récente" },
  ], esc(`© VIGICRUES, stations de la DEAL${latestGauge(d)}.`))}</figcaption></figure>
</div>`;

  const sources = d && data
    ? `<p class="note">Lu le ${esc(dayAt(data.fetchedAt))}. Le site officiel : <a href="${vigicrues.SOURCE.url}">vigicrues-reunion.re ↗</a>.</p><p class="sources">Sources : ${esc(vigicrues.SOURCE.nom)}, ${esc(vigicrues.SOURCE.attribution)} (${esc(vigicrues.SOURCE.licence)}).</p>`
    : "";

  const body = `<section aria-labelledby="h-vigilance-crues">
  <div class="sec-h"><p class="eyebrow">Rivière par rivière</p><h2 id="h-vigilance-crues">La vigilance crues</h2>
  <p>Vigicrues Réunion, service de la DEAL, donne une couleur à chaque rivière suivie : vert, jaune, orange ou rouge. Il ne publie de bulletin qu'en vigilance jaune ou plus.</p></div>
  ${riverList}
</section>
<section aria-labelledby="h-stations-crues">
  <div class="sec-h"><p class="eyebrow">Station par station</p><h2 id="h-stations-crues">Hauteur et débit mesurés</h2>
  <p>La hauteur est lue à l'échelle de chaque station. C'est un repère propre à la station, pas la profondeur, et une valeur négative est normale. Le débit dit combien d'eau passe, en m³/s. Mesures de la DEAL Réunion, toutes les 5 minutes.</p></div>
  ${gauges}
  ${sources}
</section>
${fordsSection(fords, now)}
${connectorCta("crues_rivieres", "les rivières de l'île")}`;

  return layout(origin, { title, description, path: "/crues", jsonld: [crumbs(origin, "Crues", "/crues"), webPage(origin, "/crues", title, description, data)], alerte, vert: !!v && !v.active }, band, body);
}

/** The rivers under a flood vigilance yellow or above, the worst first. */
export const floodRaised = (d: CruesAnswer | undefined) =>
  d?.vigilance_crues?.active ? [...d.vigilance_crues.rivieres].filter((r) => FLOOD_VG[r.couleur] >= 2).sort((a, b) => FLOOD_VG[b.couleur] - FLOOD_VG[a.couleur]) : [];
// Vigicrues Réunion's colours on Météo-France's scale, for the tile's colour chip (pages.ts, `vg`).
const FLOOD_VG: Record<string, number> = { vert: 1, jaune: 2, orange: 3, rouge: 4 };

/** The home page's tile: the vigilance's colour, then what it covers or what the gauges measured lately. */
export function cruesLive(data: Cached<CruesAnswer> | null, now: Date): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const raised = floodRaised(d);
  if (raised.length) return lue({ valeur: vg(FLOOD_VG[raised[0].couleur]), detail: esc(`${raised.slice(0, 2).map((r) => r.nom).join(", ")}${raised.length > 2 ? "…" : ""}`) }, data!, now);
  const fresh = d.stations.filter(upToDate);
  const rising = fresh.filter((s) => s.tendance_30_min === "en hausse");
  const levels = !fresh.length
    ? "Aucune station n'a de mesure récente"
    : rising.length
      ? `En hausse : ${rising.slice(0, 2).map((s) => s.station).join(", ")}${rising.length > 2 ? "…" : ""}`
      : `Aucune des ${fresh.length} stations à jour en hausse`;
  return lue({ valeur: d.vigilance_crues ? vg(1) : "Vigilance non lue", detail: esc(levels) }, data!, now);
}

// ---------------------------------------------------------------- bornes de recharge

/** A station in a list: where it is, its power and plugs, « Y aller », how many points are free. */
export function borneRow(s: BorneStation, g: Porte = porte()): string {
  const free = s.libres ? `<b>${s.libres}</b> libre${s.libres > 1 ? "s" : ""} sur ${s.total}` : `aucun libre sur ${s.total}`;
  return `<li><span>${esc(s.station)}<small>${fr(s.puissance_max_kw)} kW · ${esc(s.prises.join(", "))}${s.horaires && s.horaires !== "24 h/24, 7 j/7" ? ` · ${esc(s.horaires)}` : ""}</small>` +
    `${g.aller({ nom: s.station, lat: s.lat, lon: s.lon, adresse: s.adresse })}</span>` +
    `<span class="${s.libres ? "free" : "busy"}">${free}</span></li>`;
}

export function bornesPage(origin: string, data: Cached<BornesAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const g = porte(alerte);
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
    return { lon, lat, label: String(free), name: `${c.commune} : ${free} libre${free > 1 ? "s" : ""} sur ${c.points}`, round: true, color: free ? "#2b8a3e" : "#868e96", quiet: true,
      place: c.commune, say: `${free} point${free > 1 ? "s" : ""} de charge libre${free > 1 ? "s" : ""} sur ${c.points}`, href: `#${anchorId("c", c.commune)}` };
  });

  const fast = d ? d.stations.filter((s) => s.puissance_max_kw >= FAST_KW).sort((a, b) => b.libres - a.libres || b.puissance_max_kw - a.puissance_max_kw) : [];
  const foldBornes = !!d && d.stations.length > FOLD_ROWS && d.communes.length > 1;
  const byCommune = d
    ? `<ul class="zones">${d.communes.map((c) => {
        const mine = d.stations.filter((s) => s.commune === c.commune).sort((a, b) => b.libres - a.libres || b.puissance_max_kw - a.puissance_max_kw);
        const free = mine.reduce((n, s) => n + s.libres, 0);
        return `<li class="card tgt" id="${anchorId("c", c.commune)}">${folded(foldBornes,
          `<h3>${esc(c.commune)}${foldBornes ? "\u00a0" : " "}<span class="note">${foldBornes ? "·\u00a0" : ""}${free}\u00a0libre${free > 1 ? "s" : ""} sur\u00a0${c.points}, ${c.stations}\u00a0station${c.stations > 1 ? "s" : ""}</span></h3>`,
          `<ul class="rows bornes">${mine.map((s) => borneRow(s, g)).join("")}</ul>`)}</li>`;
      }).join("")}</ul>` +
      `<p class="note">${esc(d.donnees)}${d.avertissement ? ` ${esc(d.avertissement)}` : ""}</p>`
    : `<p class="card">L'état des bornes se charge : rechargez la page dans quelques secondes.</p>`;

  const title = "Bornes de recharge Réunion : points libres en direct · 974";
  const short = "Bornes de recharge pour voiture électrique à La Réunion (974) : points libres, occupés ou hors service, en direct, station par station.";
  const description = d
    ? describe(`Bornes de recharge à La Réunion (974) en ce moment : ${libres} points libres sur ${total}, la recharge rapide et chaque station, commune par commune.`, short)
    : short;

  const band = `${crumbBar("Recharge")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>En direct</p>
    <h1>Bornes de recharge <span class="n974">974</span></h1>
    ${status}
    ${ask(`Ousa mi pé roshar mon loto élèktrik vitman koté Sin-Pyèr ? Gèt si ${url} é di amwin.`,
      `Où recharger rapidement ma voiture électrique à Saint-Pierre ? Lis ${url} et dis-le-moi.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : les points de charge libres, commune par commune" })}
  <figcaption class="note" style="color:var(--on-night-muted)">${legende([
    { forme: "rond", couleur: "#2b8a3e", texte: "3", dit: "points de charge libres dans la commune" },
    { forme: "rond", couleur: "#868e96", texte: "0", dit: "aucun libre" },
  ], data ? esc(`En ce moment, d'après les opérateurs de recharge (transport.data.gouv.fr), lu à ${hm(data.fetchedAt)}.`) : undefined)}</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-rapide">
  <div class="sec-h"><p class="eyebrow">${fr(FAST_KW)} kW et plus</p><h2 id="h-rapide">Recharge rapide</h2>
  <p>Les stations où l'on recharge en une demi-heure à une heure, avec une prise Combo CCS ou CHAdeMO.</p></div>
  ${d ? `<div class="card"><ul class="rows bornes">${fast.map((s) => borneRow({ ...s, station: `${s.station}${s.station.endsWith(s.commune) ? "" : ` (${s.commune})`}` }, g)).join("")}</ul></div>` : ""}
</section>
<section aria-labelledby="h-stations">
  <div class="sec-h"><p class="eyebrow">Station par station</p><h2 id="h-stations">Commune par commune</h2>
  <p>${d ? esc(d.recharge) : "Les bornes publiques de l'île et l'état de chacun de leurs points."}</p></div>
  ${byCommune}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("bornes_recharge", "les bornes de recharge")}${d ? g.feuille : ""}`;

  return layout(origin, { title, description, path: "/bornes", jsonld: [crumbs(origin, "Recharge", "/bornes"), webPage(origin, "/bornes", title, description, data)], alerte }, band, g.ligne + body);
}

export function bornesLive(data: Cached<BornesAnswer> | null, now = new Date()): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  if (!d.stations.length) return empty(`État des bornes absent de la lecture ${readAt(data!.fetchedAt, now).de}.`);
  const libres = d.stations.reduce((n, s) => n + s.libres, 0);
  const fast = d.stations.filter((s) => s.puissance_max_kw >= FAST_KW && s.libres > 0).length;
  return {
    valeur: `${libres} point${libres > 1 ? "s" : ""} libre${libres > 1 ? "s" : ""}`,
    detail: `sur ${d.stations.reduce((n, s) => n + s.total, 0)}, dans ${d.stations.length} stations ; recharge rapide libre dans ${fast} station${fast > 1 ? "s" : ""}`,
  };
}

// ---------------------------------------------------------------- qualité de l'eau

const WATER_COLOR: Record<string, string> = { bonne: "#2b8a3e", moyenne: "#e8590c", mauvaise: "#e3262d" };
const WATER_MARK: Record<string, string> = { bonne: "✓", moyenne: "~", mauvaise: "!" };
const dayFr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

function siteLine(s: EauAnswer["baignades"][number], g: Porte): string {
  const last = s.derniers_prelevements[0];
  const q = s.qualite_dernier_prelevement;
  return `<li class="tgt" id="${anchorId("b", s.site)}"><span>${esc(s.site)}<small>dernier prélèvement le ${esc(s.dernier_prelevement)}` +
    (last ? ` · ${esc(last.enterocoques_100ml)} entérocoques et ${esc(last.e_coli_100ml)} E. coli pour 100 mL` : "") +
    (s.mauvais_sur_12_mois ? ` · ${s.mauvais_sur_12_mois} mauvais résultat${s.mauvais_sur_12_mois > 1 ? "s" : ""} sur 12 mois` : "") + `</small>${g.aller({ nom: s.site, lat: s.lat, lon: s.lon }, "baignade")}</span>` +
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
  const g = porte(alerte);
  const d = data?.value;
  const url = `${origin}/eau`;
  const good = d?.baignades.filter((s) => s.qualite_dernier_prelevement === "bonne").length ?? 0;
  const notGood = d?.baignades.filter((s) => s.qualite_dernier_prelevement && s.qualite_dernier_prelevement !== "bonne") ?? [];
  const samples = (d?.baignades ?? []).map((s) => s.dernier_prelevement.split("/").reverse().join("-")).sort();
  const firstSample = samples[0];
  const lastSample = samples.at(-1);
  const tapBad = d?.communes.filter((c) => c.non_conformes_6_mois) ?? [];

  const status = !d
    ? loading("La qualité de l'eau")
    : `<div class="now"><span class="big">${good}</span><p>plage${good > 1 ? "s" : ""} et bassin${good > 1 ? "s" : ""} sur <b>${d.baignades.length}</b> contrôlés par l'ARS en bonne qualité au dernier prélèvement` +
      `${lastSample ? ` (${esc(dayFr(lastSample))})` : ""}${notGood.length ? ` ; à surveiller : ${esc(notGood.map((s) => s.site).join(", "))}` : ""}.</p></div>`;

  const rank = (q?: string) => ["bonne", "moyenne", "mauvaise"].indexOf(q ?? "");
  // The worse last, drawn over the good ones next to them.
  const markers = [...(d?.baignades ?? [])].sort((a, b) => rank(a.qualite_dernier_prelevement) - rank(b.qualite_dernier_prelevement)).map((s) => {
    const q = s.qualite_dernier_prelevement ?? "";
    // Every name in the bubble only: written on the map, the sites to watch were cut by its frame.
    return { lon: s.lon, lat: s.lat, label: WATER_MARK[q] ?? "?", name: q ? `${s.site} : ${q}` : s.site, round: true, color: WATER_COLOR[q] ?? "#868e96", quiet: true,
      place: s.site, say: q ? `qualité ${q} au dernier prélèvement` : "pas de résultat", href: `#${anchorId("b", s.site)}` };
  });

  const sites = d
    ? `<ul class="zones">${[...new Set(d.baignades.map((s) => s.commune))].sort((a, b) => a.localeCompare(b, "fr")).map((c) => {
        const mine = d.baignades.filter((s) => s.commune === c);
        return `<li class="card"><h3>${esc(c)}</h3><ul class="rows eau">${mine.map((s) => siteLine(s, g)).join("")}</ul></li>`;
      }).join("")}</ul>`
    : `<p class="card">La qualité de l'eau se charge : rechargez la page dans quelques secondes.</p>`;

  const title = "Qualité de l'eau Réunion : baignade et robinet · 974";
  const short = "Qualité de l'eau à La Réunion (974) : les plages et bassins contrôlés par l'ARS et l'eau du robinet de chaque commune, réseau par réseau.";
  const description = d
    ? describe(`Qualité de l'eau à La Réunion (974) : ${good} plages et bassins sur ${d.baignades.length} en bonne qualité au dernier prélèvement de l'ARS, et l'eau du robinet des 24 communes, réseau par réseau.`, short)
    : short;

  const band = `${crumbBar("Qualité de l'eau")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Analyses de l'ARS</p>
    <h1>Qualité de l'eau <span class="n974">974</span></h1>
    ${status}
    ${ask(`Dlo lé bon pou bengn La Rényon ? Gèt si ${url} é di amwin pou la plaj l'Ermitaz é pou dlo robinè Sin-Pyèr.`,
      `L'eau est-elle bonne pour se baigner à La Réunion ? Lis ${url} et dis-moi pour la plage de l'Hermitage et l'eau du robinet à Saint-Pierre.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : la qualité de l'eau au dernier prélèvement de chaque plage et bassin contrôlé" })}
  <figcaption class="note" style="color:var(--on-night-muted)">${legende(["bonne", "moyenne", "mauvaise"].map((q): Cle => ({ forme: "rond", couleur: WATER_COLOR[q], texte: WATER_MARK[q], dit: q })),
    firstSample && lastSample ? esc(`Qualité au dernier prélèvement de l'ARS, ${firstSample === lastSample ? `le ${dayFr(lastSample)}` : `du ${dayFr(firstSample).slice(0, 5)} au ${dayFr(lastSample)}`}.`) : undefined)}</figcaption></figure>
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
  ${d ? `<ul class="zones">${d.communes.map(tapCard).join("")}</ul><p class="note">${esc(tapNote("page"))}<br><a href="/coupures-eau">Les avis en cours →</a></p>${data ? `<p class="note">Analyses rassemblées le ${esc(dayFr(d.lu))} à ${esc(hm(new Date(d.lu)))}.</p><p class="sources">Sources : ${esc(d.sources.map((x) => x.attribution).join(" ; "))}.</p>` : ""}` : ""}
</section>
${connectorCta("qualite_eau", "la qualité de l'eau")}${d?.baignades.length ? g.feuille : ""}`;

  return layout(origin, { title, description, path: "/eau", jsonld: [crumbs(origin, "Qualité de l'eau", "/eau"), webPage(origin, "/eau", title, description, data)], alerte }, band, g.ligne + body);
}

const EAU_TEXT = {
  baignade: "Les 26 plages et bassins où l'ARS contrôle l'eau, avec le résultat de leur dernier prélèvement : bonne, moyenne ou mauvaise selon les germes trouvés (entérocoques intestinaux et E. coli).",
  robinet: "Chaque commune a plusieurs réseaux d'eau, du centre-ville aux écarts des Hauts : la qualité dépend du réseau qui dessert le quartier. Les réseaux ci-dessous ont eu au moins une analyse non conforme.",
};

export function eauLive(data: Cached<EauAnswer> | null, now = new Date()): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  if (!d.baignades.length) return empty(`Résultats de l'ARS absents de la lecture ${readAt(data!.fetchedAt, now).de}.`);
  const good = d.baignades.filter((s) => s.qualite_dernier_prelevement === "bonne").length;
  return {
    valeur: `${good} site${good > 1 ? "s" : ""} sur ${d.baignades.length}`,
    detail: "plages et bassins en bonne qualité au dernier prélèvement de l'ARS ; l'eau du robinet commune par commune",
  };
}

// ---------------------------------------------------------------- sentiers de randonnée

const kmFr = (n: number) => String(n).replace(".", ",");
// With its unit: « 2\u202f450\u00a0m ».
const meters = (n: number) => `${nombre(n)}\u00a0m`;

/**
 * The hot spots seen by satellite, on the island's map: a brown-red triangle (charter of the maps), its shape saying
 * what it is, neither the orange of the cyclone alert nor the red of « fermé ».
 */
export const fireMarkers = (f: feux.Feux | undefined, now: Date): Marker[] =>
  (f?.detections ?? []).map((d, i) => ({ lon: d.lon, lat: d.lat, label: "", name: `${fire.listLine(d, now)} (${feux.LABEL})`, round: true, triangle: true, color: FIRE_COLOR, quiet: true,
    place: "Feu vu par satellite", say: fire.listLine(d, now), href: `#${fireId(i)}` }));

const FIRE_COLOR = "#7c2d12";
const CLOSED_COLOR = "#e3262d";
/** The two marks of the maps of fires and trails, in their legend (marketing's words). */
export const CLE_FEU: Cle = { forme: "triangle", couleur: FIRE_COLOR, dit: "Point chaud détecté par satellite, pas forcément un feu." };
export const CLE_FERME: Cle = { forme: "rond", couleur: CLOSED_COLOR, texte: "×", dit: "Sentier fermé" };
/** « Carte de l'ONF du 20/10 », from the copy's « 20/10/2026 (ONF) ». */
export const onfMap = (d?: SentiersAnswer) => `Carte de l'ONF${d?.carte_mise_a_jour ? ` du ${d.carte_mise_a_jour.slice(0, 5)}` : ""}`;

/**
 * The source under a map of trails (charte § 3 F), on its own line after the legend: the ONF's map and its date, from
 * the ISO time the hikes' and the traces' answers keep (data.ts), then OpenStreetMap when the map draws its hikes.
 */
export function traceSource(miseAJour: string | undefined, osm: boolean): string {
  const t = Date.parse(miseAJour ?? "");
  const day = Number.isFinite(t) ? new Date(t + 4 * 3600_000).toISOString().slice(5, 10).split("-").reverse().join("/") : "";
  return `<span class="mls">Carte de l'ONF${day ? ` du ${day}` : ""}${osm ? "\u00a0; itinéraires d'OpenStreetMap" : ""}.</span>`;
}

/** A fire's line in the list of the page, where its marker leads: the list and the markers follow the same order. */
export const fireId = (i: number) => `f-${i + 1}`;

/** The closed trails on the map, each to its line among the closed trails (`page`: of /sentiers, from another page). */
export const closedMarkers = (s: SentiersAnswer | undefined, page = ""): Marker[] => {
  const listed = new Set((s?.fermes_par_commune ?? []).flatMap((c) => c.sentiers_fermes.map((t) => t.sentier)));
  return (s?.points ?? []).map((p) => ({ lon: p.lon, lat: p.lat, label: "×", name: `${p.nom} : fermé`, round: true, color: CLOSED_COLOR, quiet: true,
    ...(listed.has(p.nom) ? { place: p.nom, say: "sentier fermé", href: `${page}#${anchorId("t", p.nom)}` } : {}) }));
};

/** The section of the fires seen by satellite (worded by marketing): the emergency numbers always, a quiet day said as such. */
export function firesSection(f: feux.Feux | undefined, now: Date): string {
  if (!f) return "";
  const list = f.detections.length
    ? `<ul class="rows eau">${f.detections.map((d, i) => `<li class="tgt" id="${fireId(i)}"><span>${esc(fire.listLine(d, now))}<small>${esc(d.commune)} · satellite ${esc(d.satellite)}</small></span><span class="q-mauvaise">feu</span></li>`).join("")}</ul>`
    : `<p>${esc(fire.QUIET)}</p>`;
  return `<section aria-labelledby="h-feux">
  <div class="sec-h"><p class="eyebrow">NASA FIRMS</p><h2 id="h-feux">Feux de végétation vus par satellite</h2>
  <p>${esc(fire.INTRO)}</p>
  <p><b>${esc(fire.URGENCE)}</b></p></div>
  <div class="card">${list}</div>
  <p class="note"><a href="/feux">La carte des feux des dernières 24 h →</a></p>
</section>`;
}

/**
 * The trails closed, by name, as sentiers_randonnee counts them: the ONF's map cuts some in several pieces, each a point
 * on the map (26/10/2026: 62 points, 56 trails).
 */
export const closedTrails = (d: SentiersAnswer) => new Set(d.points.map((p) => p.nom)).size;

export function sentiersPage(origin: string, data: Cached<SentiersAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/sentiers`;
  const closed = d ? closedTrails(d) : 0;

  const status = !d
    ? loading("L'état des sentiers")
    : `<div class="now"><span class="big">${closed}</span><p>sentier${closed > 1 ? "s" : ""} fermé${closed > 1 ? "s" : ""} sur <b>${d.suivis}</b> suivis par l'ONF` +
      `${d.carte_mise_a_jour ? `, d'après sa carte mise à jour le ${esc(d.carte_mise_a_jour.replace(" (ONF)", ""))}` : ""}.</p></div>`;

  const markers = [...closedMarkers(d), ...fireMarkers(d?.feux, now)];
  // A trail across two communes is listed under each: the map leads to the first.
  const named = new Set<string>();
  const rowId = (sentier: string) => (named.has(sentier) ? "" : (named.add(sentier), ` class="tgt" id="${anchorId("t", sentier)}"`));
  const fires = firesSection(d?.feux, now);
  const burning = !!d?.feux?.detections.length;

  // Each commune folded when the list is long (FOLD_ROWS): a cross on the map still leads to its trail (UNFOLD_SCRIPT).
  const foldTrails = !!d && d.fermes_par_commune.length > 1 && d.fermes_par_commune.reduce((n, c) => n + c.sentiers_fermes.length, 0) > FOLD_ROWS;
  const byCommune = d
    ? `<ul class="zones">${d.fermes_par_commune.map((c) =>
        `<li class="card">${folded(foldTrails,
          `<h3>${esc(c.commune)}${foldTrails ? "\u00a0" : " "}<span class="note">${foldTrails ? "·\u00a0" : ""}${c.sentiers_fermes.length}\u00a0fermé${c.sentiers_fermes.length > 1 ? "s" : ""}</span></h3>`,
          `<ul class="rows eau">` +
        c.sentiers_fermes.map((t) => `<li${rowId(t.sentier)}><span>${t.page ? `<a href="${esc(t.page.replace(/^https:\/\/rundata\.re/, ""))}">${esc(t.sentier)}</a>` : esc(t.sentier)}<small>${onf.motifs(t).map(esc).join(" · ") || "fermé"}</small>` +
          (t.randonnees?.length ? `<small class="cuts">Coupe : ${t.randonnees.map((r) => `<a href="/randonnees/${esc(r.slug)}">${esc(r.nom)}</a>`).join(", ")}</small>` : "") + `</span>` +
          `<span class="q-mauvaise">fermé</span></li>`).join("") + `</ul>`)}</li>`).join("")}</ul>`
    : `<p class="card">L'état des sentiers se charge : rechargez la page dans quelques secondes.</p>`;

  const roads = d?.routes_forestieres_fermees.length
    ? `<div class="card"><h3>Routes forestières interdites à la circulation</h3><ul class="rows eau">${d.routes_forestieres_fermees.map((r) =>
        `<li><span>${esc(r.route)}<small>${[r.cause, r.precision].filter(Boolean).map((x) => esc(x!)).join(" · ")}</small></span><span class="q-mauvaise">interdite</span></li>`).join("")}</ul></div>`
    : "";

  const hikes = `<section aria-labelledby="h-traces">
  <div class="card cta"><h2 id="h-traces">Choisir une randonnée</h2>
  <p>Les ${d?.randonnees.length ?? ""} itinéraires complets (GR R1, R2, R3, sommets, boucles) et les sentiers de l'ONF, avec leur trace GPS, leur distance, leur dénivelé et l'état du jour, sur une carte de l'île et filtrables : <a href="/randonnees">la page randonnée</a>.</p>
  ${randopitonsNote()}</div>
</section>`;

  const title = "Sentiers fermés Réunion aujourd'hui : liste ONF · 974";
  const short = "Sentiers de randonnée fermés à La Réunion (974) : la liste de l'ONF commune par commune, avec la cause de chaque fermeture.";
  const base = d
    ? describe(`Sentiers fermés à La Réunion (974) : ${closed} sentiers fermés sur ${d.suivis} d'après la carte de l'ONF, commune par commune, avec la cause (éboulement, sentier dégradé, travaux).`, short)
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
    ${ask(`Lo santyé Roche Plate lé ouvèr ? Gèt si ${url} é di amwin si mi pé désann Mafate.`,
      `Le sentier de Roche Plate est-il ouvert ? Lis ${url} et dis-moi si je peux descendre dans Mafate.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : les sentiers de randonnée fermés" })}
  <figcaption class="note" style="color:var(--on-night-muted)">${legende([CLE_FERME, ...(burning ? [CLE_FEU] : [])], esc(`${onfMap(d)}.${burning ? ` Points chauds : satellites de la NASA (FIRMS)${d?.feux?.lu ? `, lus à ${hm(d.feux.lu)}` : ""}.` : ""}`))}</figcaption></figure>
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
<div class="wrap intro solo">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Bouchons, accidents, travaux : infotrafic.re</p>
    <h1>Bouchons et circulation à La Réunion <span class="n974">974</span></h1>
    <p class="lead">Les bouchons, accidents et travaux en direct sont sur la carte officielle d'<a href="${INFOTRAFIC}">infotrafic.re</a>, le site de la Région, qui ne s'affiche que chez elle. Plus bas, la carte de Waze les montre aussi. rundata.re n'a pas la mesure des bouchons : la Région ne la rend pas réutilisable pour l'instant.</p>
    <p class="lead">La route du Littoral est basculée ou fermée ? L'état officiel est sur <a href="${INFOTRAFIC}">infotrafic.re</a>.</p>
    <p class="hero-cta"><a class="btn sun" href="${INFOTRAFIC}">${icon("car")}Carte officielle (infotrafic.re) ↗</a></p>
    ${ask(`Lé bouché si la kat-voi astèr ? Gèt si ${url} é di amwin sak ou koné, é ousa mi pé gèt lo trafik.`,
      `Ça bouchonne sur la quatre-voies en ce moment ? Lis ${url} : dis-moi ce que tu sais (bus, routes forestières, vigilance) et où regarder le trafic en direct.`)}
  </div>
</div>`;

  // The route du Littoral as the media announce it, never as a measure: the card stays when none did, for those who look for it.
  const lit = d?.littoral;
  const linked = (s: string) => esc(s).replace("infotrafic.re", `<a href="${INFOTRAFIC}">infotrafic.re</a>`);
  const said = (a: littoral.Annonce) =>
    `<b>${esc(littoral.etatText(a))}</b>, selon ${esc(a.media)}, <a href="${esc(a.lien)}" rel="noopener"${fenetre(a.lien)}>${littoral.linkWord(a)}</a> publié ${esc(littoral.publieText(a, now))}.`;
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
  <p><a href="/vigilance">La vigilance zone par zone</a> · <a href="/meteo">la météo</a> · <a href="/crues">les rivières</a></p></div>`;

  const b = d?.bus;
  const busCard = !d
    ? `<div class="card">${loading("Les retards des bus")}</div>`
    : !b
      ? `<div class="card">${icon("bus")}<h3>Retards des bus</h3><p class="note">Le flux en direct des bus ne répond pas pour le moment.</p></div>`
      : `<div class="card">${icon("bus")}<h3>Retards des bus au départ des gares</h3>
  <p class="note">Retards des bus, pas une mesure des bouchons : un car en retard l'est souvent depuis sa course précédente.</p>
  ${b.retards.length
    ? `<ul class="rows eau">${b.retards.slice(0, 12).map((r) => `<li><span>${esc(r.reseau)} ${esc(r.ligne)} vers ${esc(r.direction)}<small>gare ${esc(de(r.gare))}, départ prévu ${esc(atDay(saidNow(r.heure, data!.fetchedAt.getTime(), now)))}</small></span><span class="score">${r.retard_min} min</span></li>`).join("")}</ul>`
    : `<p>${b.suivis ? `Aucun des ${b.suivis} départs suivis en direct n'a plus de ${LATE_MIN} min de retard.` : "Pas de départ suivi en direct en ce moment."}</p>`}
  ${b.alertes.length ? `<h4>Déviations et avis des réseaux</h4>${alertList(b.alertes)}` : ""}
  ${b.temps_reel.length ? `<p class="note">Flux en direct : ${b.temps_reel.map((t) => `${esc(t.reseau)} à ${esc(t.heure)}`).join(", ")}. <a href="/bus">Les prochains départs</a>.</p>` : `<p class="note"><a href="/bus">Les prochains départs</a>.</p>`}</div>`;

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

  // The Enclos in its short form, never « ouvert » (marketing); the trails, place by place, on /volcan.
  const enclosNow = d?.enclos && enclosShort(d.enclos);
  const enclos = enclosNow
    ? `<div class="card">${icon("volcano")}<h3>Volcan : accès à l'Enclos</h3><p><b>${esc(enclosNow.valeur)}</b> (${esc(enclosNow.source)}). <a href="/volcan#monter">${esc(TITRE)} →</a></p></div>`
    : "";

  // What the media report on the roads and the blockades in the last hours, their headlines linked: first, as on a day of blockades it matters most.
  const medias = d?.medias?.length
    ? `<div class="card">${icon("book")}<h3>Signalé par les médias</h3><ul class="plain">${d.medias.map((m) => `<li><a href="${esc(m.lien)}" rel="noopener"${fenetre(m.lien)}>${esc(m.titre)}</a> <span class="note">${esc(m.source)}${m.heure ? `, ${esc(m.heure)}` : ""}</span></li>`).join("")}</ul>
  <p class="note">Routes, barrages et manifestations dans les titres des six dernières heures, et les communiqués du jour de la préfecture : lire l'article pour le détail. <a href="/actualites">Toutes les actualités</a>.</p></div>`
    : "";

  // Before the 1st, the new order announced and the month in force below, as on /carburants.
  const s = d?.carburants && fuelSay(d.carburants, now);
  const fuel = s && (s.annonce || s.lignes)
    ? `<div class="card">${icon("car")}<h3>Prix des carburants</h3>` +
      (s.annonce ? `<p>${esc(keep(s.annonce))}.</p>${s.jusquau ? `<p>${esc(keep(s.jusquau))}.</p>` : ""}` : `<p>${esc(keep(`${s.depuis}, fixés par le préfet : ${s.lignes}`))}.</p>`) +
      `<p class="note">Les mêmes dans toute l'île : une station peut vendre moins cher. <a href="/carburants">Tous les prix du mois →</a></p></div>`
    : "";
  // The fixed speed cameras, from the ministry's yearly list bundled with the site: where they stand, never the mobile checks.
  const cameras = radars.byCommune();
  const radarsLead = `${radars.RADARS.length} radars fixes à La Réunion, d'après la liste publiée par le ministère de l'Intérieur (fichier du ${radars.fichierDu()}).`;
  // Each camera at its place, its speed limit inside, its commune in the tooltip: the map says no more than the list.
  // A limit is neither good nor bad: the night's colour, which the dark theme's ink would turn into white on white.
  const radarMarkers: Marker[] = radars.radars().map((r) => ({ lon: r.lon, lat: r.lat, label: r.vma_kmh != null ? String(r.vma_kmh) : "",
    name: r.vma_kmh != null ? `${r.commune}, ${r.vma_kmh}\u00a0km/h` : r.commune, color: COUNT_COLOR, quiet: true }));
  const radarsCard = `<div class="card" id="radars">${icon("car")}<h3>Radars fixes</h3>
  <p>${radarsLead}</p>
  <figure class="mapcard">${islandMap({ markers: radarMarkers, label: radarsLead, apart: true })}
  <figcaption class="note">${legende([{ forme: "pastille", couleur: COUNT_COLOR, texte: "90", dit: "Radar fixe : vitesse limitée en km/h" }])}</figcaption></figure>
  <ul class="rows eau">${cameras.map((c) => `<li><span>${esc(c.commune)}<small>${esc(radars.vitesses(c.radars).join(", "))}</small></span><span class="score">${c.radars.length}</span></li>`).join("")}</ul>
  <details><summary>Où ils sont</summary><ul class="plain">${cameras.flatMap((c) => c.radars.map((r) => `<li>${esc(c.commune)}${r.vma_kmh != null ? `, ${r.vma_kmh}\u00a0km/h` : ""} : <a href="${esc(radars.carte(r))}" rel="noopener">la carte ↗</a></li>`)).join("")}</ul></details>
  <p class="note">${esc(radars.RESERVE())}</p></div>`;
  const ours = `<section aria-labelledby="h-nous">
  <div class="sec-h"><p class="eyebrow">Données ouvertes, en direct</p><h2 id="h-nous">Ce que rundata.re lit</h2>
  <p>Pas les bouchons : autour d'eux. La vigilance, les retards et déviations des bus, les routes forestières, le volcan, et ce que les médias signalent sur les routes.</p></div>
  <div class="two">${medias}${vigilance}${busCard}${roadsCard}${enclos}${fuel}${radarsCard}</div>
  ${d && data && d.sources.length ? sourcesNote(d.sources, data) : ""}
</section>`;

  const why = `<section aria-labelledby="h-pourquoi"><div class="card warn">${icon("alert")}<h3 id="h-pourquoi">Pourquoi pas les bouchons ici</h3>
  <p>rundata.re n'a pas la mesure des bouchons : la Région ne la rend pas réutilisable pour l'instant, et aucune autre source ouverte ne mesure le trafic à La Réunion. Waze et Google ne permettent pas de reprendre leurs données. D'où la carte de Waze, chargée à votre demande, et le lien vers infotrafic.re.</p></div></section>`;

  const title = "Info trafic Réunion : bouchons, routes, bus en direct · 974";
  const short = "Circulation à La Réunion (974) : carte officielle des bouchons, accidents et travaux sur infotrafic.re, retards des bus et routes forestières fermées.";
  // An announcement of the last hours leads the description; otherwise, what the page has.
  const fresh = lit && lit.annonces.length === 1 && lit.age_h < littoral.RECENT_HOURS ? lit.annonces[0] : undefined;
  const announced = fresh &&
    `Route du Littoral : ${littoral.etatShort(fresh)} selon ${fresh.media} (${littoral.publieText(fresh, now).replace(/^aujourd'hui à /, "")}). Bouchons à La Réunion (974) : carte officielle sur infotrafic.re.`;
  const description = announced
    ? describe(announced, describe(announced.replace(" (974)", ""), short))
    : "Circulation à La Réunion (974) : carte officielle des bouchons sur infotrafic.re, route du Littoral selon les médias, retards des bus.";
  const body = `${littoralCard}
${official}
${waze}
${ours}
${why}
${connectorCta("transports", "les bus en direct")}
<script>${WAZE_SCRIPT}</script>`;
  return layout(origin, { title, description, path: "/trafic", jsonld: [crumbs(origin, "Circulation", "/trafic"), webPage(origin, "/trafic", title, description, data)], alerte }, band, body);
}

export function traficLive(data: Cached<TraficAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const n = d.routes_forestieres?.interdites.length ?? 0;
  // Said in full on a phone: the number of forest roads closed is at its end.
  return { valeur: "Carte officielle", detail: `bouchons, accidents et travaux : infotrafic.re ; ${n} route${n > 1 ? "s" : ""} forestière${n > 1 ? "s" : ""} fermée${n > 1 ? "s" : ""}`, entier: true };
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
const why_ = (x: { cause?: string; precision?: string }) => onf.motifs(x).map(esc).join(" · ");

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
  const facts = [`${kmFr(h.km)} km`, `+${meters(h.dplus)}`, h.alt_max != null ? `jusqu'à ${meters(h.alt_max)}` : "", h.boucle ? "boucle" : "", h.secteur].filter(Boolean).join(" · ");
  return `<li class="card hike${h.fermes.length ? " closed" : ""}" ${dataOf(h, etat)}>
<h3><a href="/randonnees/${esc(h.slug)}">${esc(h.nom)}</a></h3><p class="note">${esc(facts)}</p>${state}${unknown}
<p class="links"><a href="/randonnees/${esc(h.slug)}">Carte et profil</a><a href="/randonnees/${esc(h.slug)}.gpx" download>GPX</a></p></li>`;
}

function trailLi(t: TrailItem): string {
  const e = t.etat === "fermé" ? "f" : t.etat === "ouvert" ? "o" : "i";
  const cls = e === "f" ? "q-mauvaise" : e === "o" ? "q-bonne" : "q-none";
  const label = e === "f" ? (t.partiel ? "fermé en partie" : "fermé") : e === "o" ? "ouvert" : "état inconnu";
  const small = [`${t.commune ? `${esc(t.commune)} · ` : ""}${kmFr(t.km)} km${t.dplus != null ? ` · +${meters(t.dplus)}` : ""}${t.boucle ? " · boucle" : ""}`, why_(t)].filter(Boolean).join(" · ");
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
  <figcaption class="note legend"><span><i class="sw rte"></i>itinéraire avec trace</span><span><i class="sw ouvert"></i>sentier ouvert</span><span><i class="sw ferme"></i>fermé</span><span><i class="sw inconnu"></i>hors gestion ONF</span>${traceSource(d.carte_mise_a_jour, true)}</figcaption></figure>`
    : "";

  const band = `${crumbBar("Randonnée")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Traces GPS · état ONF du jour</p>
    <h1>Randonnée à La Réunion <span class="n974">974</span></h1>
    ${status}
    <p class="hero-cta"><a class="btn sun" href="#itineraires">${icon("mountain")}Choisir une rando</a><a class="btn glass" href="/sentiers">${icon("alert")}Sentiers fermés${d ? ` (${d.fermes})` : ""}</a></p>
    ${ask(`Mi rod inn rando 10 km dan Silaos, lé ouvèr ? Gèt si ${url} é di amwin.`,
      `Je cherche une randonnée d'environ 10 km à Cilaos, ouverte en ce moment : lis ${url} et propose-m'en une avec sa trace GPS.`)}
  </div>
  ${map}
</div>`;

  const closures = cut.length
    ? `<div class="card warn alarm">${icon("alert")}<h3>${plural(cut.length, "itinéraire coupé", "itinéraires coupés")} par une fermeture</h3>
  <ul class="plain">${cut.map((h) => `<li><a href="/randonnees/${esc(h.slug)}">${esc(h.nom)}</a> : ${h.fermes.map((f) => (f.slug ? `<a href="/sentiers/${esc(f.slug)}">${esc(f.sentier)}</a>` : esc(f.sentier)) + ((onf.nuance(f) ?? f.cause) ? ` (${esc((onf.nuance(f) ?? f.cause)!)})` : "")).join(", ")}</li>`).join("")}</ul>
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
    <li><b>Partir tôt.</b> Les nuages montent dans les Hauts en fin de matinée et il pleut souvent l'après-midi ; la nuit tombe entre 17:45 et 19:00 selon la saison (<a href="/calendrier">lever et coucher du soleil</a>).</li>
    <li><b>De l'eau, assez.</b> Au moins deux litres par personne, davantage en été et sur les longues montées. Ne pas boire l'eau des ravines sans la traiter.</li>
    <li><b>Hors gestion ONF</b> veut dire état non connu, pas ouvert : se renseigner auprès de la commune ou du Parc national.</li>
    <li>Dire à quelqu'un où l'on va et quand on rentre : le téléphone ne passe pas partout dans les cirques. Au volcan, voir aussi <a href="/volcan">l'état du Piton de la Fournaise</a>. Urgence : 112.</li>
  </ul></div>
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>`;

  const title = "Randonnée Réunion : traces GPS et sentiers ouverts · 974";
  const short = "Randonnée à La Réunion (974) : itinéraires et sentiers de l'ONF avec trace GPS (GPX), distance, dénivelé et état du jour.";
  const description = d
    ? describe(`Randonnée à La Réunion (974) : ${nRoutes} itinéraires (GR R1, R2, R3, Piton des Neiges…) et ${d.suivis} sentiers de l'ONF avec trace GPS (GPX), distance, dénivelé et état du jour : ${d.fermes} fermés.`, short)
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
  const n = closedTrails(d);
  return { valeur: `${n} sentier${n > 1 ? "s" : ""} fermé${n > 1 ? "s" : ""}`, detail: `sur ${d.suivis} suivis par l'ONF ; traces GPS, distance et dénivelé de ${d.randonnees.length} randonnées et de chaque sentier` };
}

/**
 * Randopitons, the island's best-known hiking site, linked from /sentiers and each /randonnees/<slug>: its home page
 * only, never one of its sheets (not without its agreement), and never named a source, the trails' state being the
 * ONF's. Nothing reads it: its robots.txt shuts Claude out.
 */
export const RANDOPITONS = "https://randopitons.re/";
export const randopitonsNote = () =>
  `<p class="note">Fiches détaillées, photos et avis de randonneurs : <a href="${RANDOPITONS}" target="_blank" rel="noopener">Randopitons<span aria-hidden="true">\u00a0↗</span></a></p>`;

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

/**
 * The legend under a trace, drawn as on the hikes' map and in its words: the states the trace shows, a hike in its own
 * colour, then its start.
 */
function traceLegend(kind: "sentier" | "randonnee", etats: string[]): string {
  const marks: [string, string][] = kind === "sentier"
    ? ([["ouvert", "sentier ouvert"], ["ferme", "fermé"], ["inconnu", "hors gestion ONF"]] as [string, string][]).filter(([e]) => etats.includes(e))
    : [["rte", "itinéraire avec trace"], ...(etats.includes("ferme") ? [["ferme", "fermé"] as [string, string]] : [])];
  return [...marks, ["st", "départ"]].map(([c, t]) => `<span><i class="sw ${c}"></i>${t}</span>`).join("");
}

/** `summit`: the summit the trace reaches, when the page its link leads to tells the morning's cloud sea (site.ts). */
export function tracePage(origin: string, kind: "sentier" | "randonnee", slug: string, nom: string, data: Cached<TraceAnswer> | null, now = new Date(), alerte?: Alerte, summit?: Summit): string {
  const d = data?.value;
  const path = `/${kind === "sentier" ? "sentiers" : "randonnees"}/${slug}`;
  const gpx = `${path}.gpx`;
  const what = kind === "sentier" ? "sentier de l'ONF" : "itinéraire OpenStreetMap";

  const facts = d
    ? `<dl class="facts"><div><dt>${d.boucle ? "En boucle" : "Longueur"}</dt><dd>${kmFr(d.km)} km</dd></div>` +
      (d.dplus != null ? `<div><dt>Dénivelé positif</dt><dd>${meters(d.dplus)}</dd></div><div><dt>Dénivelé négatif</dt><dd>${meters(d.dmoins ?? 0)}</dd></div>` : "") +
      (d.alt_max != null ? `<div><dt>Altitudes</dt><dd>${nombre(d.alt_min ?? 0)} – ${meters(d.alt_max)}</dd></div>` : "") + `</dl>`
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
  // « Y aller » to a hike's start, beside the download, only when its copy kept the start (data.ts buildRoute). A forest
  // road closed by the start is said as the ONF's fact, dated, in grey: the trail itself is not closed (marketing's words).
  // A cyclone alert that closes the trails (aller.ts permis) says so in the button's place, before the road.
  const alerted = kind === "randonnee" && !permis(alerte, "randonnee");
  const go = d?.depart && !alerted ? aller({ nom: `départ du ${nom}`, lat: d.depart.lat, lon: d.depart.lon }) : "";
  const download = `<p class="hero-cta"><a class="btn sun" href="${esc(gpx)}" download>${icon("pin")}Télécharger le GPX</a>${go}</p>`;
  const shut = d?.routes_fermees;
  const road = shut
    ? `<p class="note">${shut.routes.length > 1 ? "Routes forestières interdites" : "Route forestière interdite"} à la circulation à ${ROAD_NEAR_M}\u00a0m ou moins du départ\u00a0: ` +
      `${shut.routes.map((x) => esc(x.route) + (x.cause ? ` (${esc(x.cause)})` : "")).join("\u00a0; ")}, selon l'ONF, lu le ${esc(shut.lu)}.</p>`
    : "";

  const map = d?.lignes.length
    ? `<figure class="card mapcard">${traceMap({ lines: d.lignes, label: `Carte : la trace de ${nom}` })}
  <figcaption class="note legend" style="color:var(--on-night-muted)">${traceLegend(kind, d.lignes.map((l) => l.etat))}${traceSource(d.carte_mise_a_jour, kind === "randonnee")}</figcaption></figure>`
    : "";

  const profileBlock = d?.profil.length
    ? `<section aria-labelledby="h-profil"><div class="sec-h"><p class="eyebrow">Altitudes IGN</p><h2 id="h-profil">Profil</h2></div>
  <figure class="card">${profile(d.profil, `Profil en altitude de ${nom}`)}</figure></section>`
    : "";

  const rows = d?.troncons.length
    ? `<ul class="rows eau">${d.troncons.map((t) => {
        const cls = t.etat === "fermé" ? "q-mauvaise" : t.etat === "ouvert" ? "q-bonne" : "q-none";
        const name = t.sentier ? (t.page ? `<a href="${esc(t.page)}">${esc(t.sentier)}</a>` : esc(t.sentier)) : esc(nom);
        return `<li><span>${name}<small>${(t.etat === "fermé" ? onf.motifs(t) : [t.cause, t.precision].filter((x): x is string => !!x)).map(esc).join(" · ")}</small></span><span class="${cls}">${esc(t.etat)}</span></li>`;
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
  const short = `${nom} (La Réunion, 974) : trace GPS à télécharger (GPX), longueur, dénivelé, profil et état du sentier d'après l'ONF.`;
  const where = sector ? `${sector.nom}, La Réunion` : "La Réunion";
  const description = d
    ? describe(`${nom} (${where}) : ${kmFr(d.km)} km${d.dplus != null ? `, ${d.dplus} m de dénivelé positif` : ""}. ${d.etat}. Trace GPS à télécharger (GPX) et profil.`,
        describe(`${nom} (La Réunion) : ${kmFr(d.km)} km${d.dplus != null ? `, ${d.dplus} m de dénivelé positif` : ""}. ${d.etat}. Trace GPS à télécharger (GPX) et profil.`, short))
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
    ${download}${alerted ? retire(alerte) : ""}${road}
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
  ${cloudSeaLink(summit)}
  ${kind === "randonnee" ? randopitonsNote() : ""}</div>
  ${warnings([
    "Un sentier fermé l'est par arrêté préfectoral ou décision de l'ONF : s'y engager est interdit et dangereux, même avec une trace.",
    "Vérifier la vigilance météo avant de partir : par fortes pluies, les ravines montent vite et la préfecture ferme d'autres sentiers.",
    "Une trace ne remplace ni le balisage ni une carte. Urgence en montagne : 112.",
  ])}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("sentiers_randonnee", "les sentiers de randonnée")}`;

  return layout(origin, { title, description, path, jsonld, alerte }, band, go ? body + ALLER : body);
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
  // Each commune leads to its row of the table.
  const links: Record<string, ZoneLink> = {};
  for (const c of d?.communes ?? []) {
    const nm = MAP_NAME.get(normalize(c.commune));
    if (nm && c.eau_du_robinet) fills[nm] = DROUGHT_COLOR[c.eau_du_robinet] ?? "";
    if (nm) links[nm] = { href: `#${anchorId("c", nm)}`, say: `eau du robinet : ${c.eau_du_robinet ?? "aucune restriction"}` };
  }

  const status = !d
    ? loading("Les restrictions d'eau")
    : d.communes.length
      ? `<div class="now"><span class="big">${hit.length}</span><p>commune${hit.length > 1 ? "s" : ""} sur 24 en alerte ou plus pour l'eau du robinet${d.arrete_du ? `, d'après l'arrêté préfectoral en vigueur depuis le ${esc(d.arrete_du)}` : ""}.</p></div>`
      : `<p class="lead">${esc(d.resume)}</p>`;

  const table = d?.communes.length
    ? `<div class="card table-wrap"><table class="drought"><thead><tr><th>Commune</th><th>Eau du robinet</th><th>Rivières et sources</th><th>Nappes</th></tr></thead><tbody>${d.communes.map((c) =>
        `<tr><th scope="row" class="tgt" id="${anchorId("c", MAP_NAME.get(normalize(c.commune)) ?? c.commune)}">${esc(c.commune)}</th><td>${droughtBadge(c.eau_du_robinet)}</td><td>${droughtBadge(c.rivieres_et_sources)}</td><td>${droughtBadge(c.nappes)}</td></tr>`).join("")}</tbody></table></div>`
    : "";

  const rules = (d?.interdits ?? []).sort((x, y) => DROUGHT_ORDER.indexOf(x.niveau) - DROUGHT_ORDER.indexOf(y.niveau)).map((x) =>
    `<li class="card"><h3>${droughtBadge(x.niveau)} <span class="note">${esc(x.communes.join(", "))}</span></h3><ul class="rows eau">` +
    (x.restrictions.length ? x.restrictions.map((r) => `<li><span>${esc(r.usage)}<small>${esc(r.restriction)}</small></span><span></span></li>`).join("") : `<li><span>Économiser l'eau : pas d'interdiction pour un particulier.</span><span></span></li>`) +
    `</ul></li>`).join("");

  const title = "Restrictions d'eau Réunion : sécheresse par commune · 974";
  const short = "Restrictions d'eau à La Réunion (974) : le niveau de sécheresse de chaque commune et ce qui est interdit (arrosage, lavage, piscine), d'après l'arrêté préfectoral.";
  const description = d ? describe(`${d.resume}`, short) : short;

  const band = `${crumbBar("Sécheresse")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Arrêté en vigueur</p>
    <h1>Sécheresse <span class="n974">974</span></h1>
    ${status}
    ${ask(`Mi gingn arouz mon zardin Sin-Zozèf ? Gèt si ${url} é di amwin sak lé défandi.`,
      `Ai-je le droit d'arroser mon jardin à Saint-Joseph ? Lis ${url} et dis-moi ce qui est interdit.`)}
  </div>
  <figure class="card mapcard">${islandMap({ fills, links, label: "Carte de La Réunion (974) colorée par le niveau de restriction de l'eau du robinet de chaque commune" })}
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
  // Above vigilance, the worst level and where, as /secheresse says it: « crise à Saint-Joseph », « alerte renforcée dans
  // 5 communes » (worded by the user, 26/10). The tile's value is HTML: « Saint-Joseph » kept on one line.
  const at = d.communes.filter((c) => c.eau_du_robinet === worst).map((c) => c.commune);
  const valeur = !worst ? "vigilance" : worst === "vigilance" ? `jusqu'à ${worst}` : at.length === 1 ? `${worst} ${nobreak(a(at[0]))}` : `${worst} dans ${at.length} communes`;
  return { valeur, detail: `${hit} commune${hit > 1 ? "s" : ""} sur 24 en alerte ou plus pour l'eau du robinet` };
}

// ---------------------------------------------------------------- coupures d'eau

/** Escaped text whose hyphenated names (« Saint-Leu », « L'Étang-Salé ») do not break at the hyphen. */
export function nobreak(text: string): string {
  return esc(text).replace(/[\p{Lu}][\p{L}'’]*(?:-[\p{L}'’]+)+/gu, (w) => `<span style="white-space:nowrap">${w}</span>`);
}

function noticeCard(n: CoupuresAnswer["avis"][number]): string {
  // An image or a PDF: nothing is read from it, the link only.
  if (n.forme) return `<li class="card"><h3>${nobreak(n.communes.join(", "))} <span class="note">${nobreak(n.distributeur)}, publié le ${esc(n.publie_le)}</span></h3>` +
    `<p>${n.lien ? `<a href="${esc(n.lien)}" rel="noopener">${esc(n.titre)} →</a>` : esc(n.titre)}</p></li>`;
  // Only the start written (La Créole): said as a start, not as the hour of the cut.
  const cut = n.coupure?.de ? `<p><b>${n.coupure.a ? `${esc(n.coupure.de ?? "")} → ${esc(n.coupure.a)}` : `À partir du ${esc(n.coupure.de ?? "")}`}</b>${n.coupure.etat ? ` <span class="note">(${esc(n.coupure.etat)})</span>` : ""}</p>` : "";
  return `<li class="card${n.ne_pas_boire ? " warn" : ""}"><h3>${n.ne_pas_boire ? "Ne pas boire l'eau · " : ""}${nobreak(n.communes.join(", "))} <span class="note">${nobreak(n.distributeur)}, publié le ${esc(n.publie_le)}</span></h3>` +
    `<p>${esc(n.titre)}</p>${n.precision ? `<p class="note">${esc(n.precision)}</p>` : ""}${cut}${n.secteurs_complets ? `<p class="note">Secteurs : ${esc(n.secteurs.join(", "))}</p>` : ""}` +
    `<p class="note">${nobreak(n.texte)}${n.lien ? ` <a href="${esc(n.lien)}" rel="noopener">${n.extrait_coupe && !n.secteurs_complets ? "Les secteurs concernés dans l'avis complet" : "L'avis complet"} →</a>` : ""}</p></li>`;
}

export function coupuresPage(origin: string, data: Cached<CoupuresAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/coupures-eau`;
  const dry = d?.ne_pas_boire ?? [];

  const fills: Record<string, string> = {};
  const links: Record<string, ZoneLink> = {};
  for (const c of d?.communes_suivies ?? []) {
    const nm = MAP_NAME.get(normalize(c));
    if (!nm) continue;
    fills[nm] = dry.includes(c) ? "#f03e3e" : d!.avis.some((n) => n.communes.includes(c)) ? "#4dabf7" : "#a5d8ff";
    // Each followed commune leads to its own page of notices.
    const p = pageOf(slugify(nm));
    if (p) links[nm] = { href: `/coupures-eau/${p.slug}`, say: dry.includes(c) ? "eau à ne pas boire" : d!.avis.some((n) => n.communes.includes(c)) ? "avis en cours" : "pas d'avis lu en ce moment" };
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
  const short = "Coupures d'eau à La Réunion (974) : les avis de Dionéo, runéo, La Créole, la CIREST, CISE Réunion et des Eaux de La Possession, heures et rues concernées.";
  const description = d ? describe(`${d.resume} Coupures d'eau à La Réunion (974) : heures, rues concernées et avis « ne pas boire l'eau ».`, short) : short;

  const band = `${crumbBar("Coupures d'eau")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Avis des distributeurs</p>
    <h1>Coupures d'eau <span class="n974">974</span></h1>
    ${status}
    ${ask(`Dolo la koupé Sin-Dni ? Kansa i rovien ? Gèt si ${url} é di amwin.`,
      `Y a-t-il une coupure d'eau à Saint-Denis ? Lis ${url} et dis-moi quand l'eau revient.`)}
  </div>
  <figure class="card mapcard">${islandMap({ fills, links, label: "Carte de La Réunion (974) : les communes dont les avis de coupure d'eau sont suivis" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Communes dont nous lisons les avis : <span style="color:#f03e3e">eau à ne pas boire</span>, <span style="color:#4dabf7">avis en cours</span>, <span style="color:#a5d8ff">pas d'avis lu en ce moment</span>. Les autres communes : avis non lus, voir la mairie ou le distributeur.</figcaption></figure>
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

/**
 * The home page's tile: the bundled list, nothing to fetch. Not how many are reachable at any hour: alone on a tile, the
 * figure would read as an island poorly equipped; the page says it commune by commune (marketing).
 */
export function daeLive(): Live {
  const communes = new Set(DAES.map((d) => d.commune)).size;
  // A hyphen where the word may break: too long for a tile two by two on a phone.
  return { valeur: `${nombre(DAES.length)} défibril&shy;lateurs`, detail: `dans les ${communes} communes, avec leur accès · Géo'DAE du ${esc(dayMonth(DAE_BUILT))}`, entier: true };
}

/**
 * The four accesses in short, by reach (tools/dae.ts): the same words in the list by commune and in « Autour de moi ».
 * Reserved, with whom to ask: in an emergency, the staff can bring it (marketing).
 */
const ACCES = ["dehors, 24 h/24", "24 h/24", "horaires du lieu", "accès réservé · demander à l'accueil"];
const shortAccess = (a: string) => ACCES[a.includes("extérieur") ? 0 : a.includes("24 h") ? 1 : a.includes("accès libre") ? 2 : 3];

/**
 * « Autour de moi »: the position asked of the phone, and the nearest devices worked out there, from the compact list
 * (public/dae/, scripts/build-dae.py) loaded on the click. The position never leaves the phone: the only request is
 * the list's, the same for everyone; the island's map is drawn on the page; the walking route link carries the device
 * alone, never a starting point, and the maps app takes the position itself. Plans on an iPhone (always there, opened
 * by its own address), Google Maps elsewhere (its address for every device opens the app on Android). The link is the
 * site's « Y aller » button on foot (aller.ts): its sheet offers the other apps, Waze left out.
 */
export const AUTOUR_SCRIPT = `{const box=document.getElementById("autour"),btn=document.getElementById("autour-btn"),msg=document.getElementById("autour-msg"),res=document.getElementById("autour-res"),ul=document.getElementById("autour-list");
if(box&&btn&&msg&&res&&ul){box.hidden=false;
const LIST=${JSON.stringify(DAE_LIST.path)},ACCES=${JSON.stringify(ACCES)},BOX=${JSON.stringify(island.bbox)},W=${island.w},H=${island.h},N=10;
const T={nogeo:"Votre navigateur ne donne pas la position. Cherchez votre commune plus bas.",refus:"Position non autorisée. Cherchez votre commune plus bas.",perdue:"Position introuvable. Réessayez, ou cherchez votre commune plus bas.",liste:"La liste n'a pas pu se charger. Réessayez, ou cherchez votre commune plus bas.",route:${JSON.stringify(ALLER_MOTS.bouton)},label:${JSON.stringify(ALLER_MOTS.titre)}};
const e=(s)=>String(s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const say=(t)=>{msg.textContent=t;msg.hidden=!t};
const ios=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const route=(la,lo)=>ios?"https://maps.apple.com/?daddr="+la+","+lo+"&dirflg=w":"https://www.google.com/maps/dir/?api=1&destination="+la+","+lo+"&travelmode=walking";
const km=(a,b,c,d)=>{const r=Math.PI/180,x=Math.sin((c-a)*r/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin((d-b)*r/2)**2;return 12742*Math.asin(Math.sqrt(x))};
const far=(k)=>k<1?Math.max(10,Math.round(k*100)*10)+" m":(Math.round(k*10)/10).toFixed(1).replace(".",",")+" km";
const xy=(la,lo)=>[(lo-BOX[0])/(BOX[2]-BOX[0])*W,(BOX[3]-la)/(BOX[3]-BOX[1])*H];
let list=null;
const show=(la,lo)=>{const near=list.d.map((d)=>({d,k:km(la,lo,d[0],d[1])})).sort((a,b)=>a.k-b.k).slice(0,N);
ul.innerHTML=near.map(({d,k},i)=>"<li><span><b>"+(i+1)+".</b> "+e(d[2])+"<small>"+[far(k),[d[4],list.communes[d[5]]].filter(Boolean).join(", "),d[6],d[8]?"étage "+d[8]:"",d[7]].filter(Boolean).map(e).join(" · ")+"</small><a class=\\"aller\\" href=\\""+e(route(d[0],d[1]))+"\\" rel=\\"noopener\\" data-go=\\""+d[0]+","+d[1]+"\\""+(d[4]?" data-a=\\""+e([d[4],list.communes[d[5]]].filter(Boolean).join(", "))+"\\"":"")+" data-m=\\"pied\\" aria-label=\\""+e(T.label+d[2])+"\\">"+e(T.route)+"</a></span><span class=\\""+(d[3]<2?"q-bonne":"q-none")+"\\">"+e(ACCES[d[3]])+"</span></li>").join("");
res.hidden=false;const svg=document.querySelector(".mapcard svg");if(!svg)return;
const old=svg.querySelector("#autour-g");if(old)old.remove();
const pts=near.map(({d})=>xy(d[0],d[1])),me=xy(la,lo),all=[...pts,me],xs=all.map((p)=>p[0]),ys=all.map((p)=>p[1]);
let w=Math.max(W/12,(Math.max(...xs)-Math.min(...xs))*1.4),h=Math.max(H/12,(Math.max(...ys)-Math.min(...ys))*1.4);if(w/h>W/H)h=w*H/W;else w=h*W/H;
const cx=(Math.max(...xs)+Math.min(...xs))/2,cy=(Math.max(...ys)+Math.min(...ys))/2,r=w/90;
svg.setAttribute("viewBox",(cx-w/2)+" "+(cy-h/2)+" "+w+" "+h);svg.classList.add("autour-on");
svg.insertAdjacentHTML("beforeend","<g id=\\"autour-g\\">"+pts.map((p)=>"<circle class=\\"nr\\" cx=\\""+p[0]+"\\" cy=\\""+p[1]+"\\" r=\\""+r+"\\"/>").join("")+"<circle class=\\"me\\" cx=\\""+me[0]+"\\" cy=\\""+me[1]+"\\" r=\\""+r*1.4+"\\"/></g>")};
btn.addEventListener("click",()=>{say("");if(!navigator.geolocation){say(T.nogeo);return}btn.disabled=true;
navigator.geolocation.getCurrentPosition((p)=>(list?Promise.resolve(list):fetch(LIST).then((r)=>{if(!r.ok)throw new Error(String(r.status));return r.json()})).then((l)=>{list=l;show(p.coords.latitude,p.coords.longitude)}).catch(()=>say(T.liste)).finally(()=>{btn.disabled=false}),
(err)=>{say(err.code===1?T.refus:T.perdue);btn.disabled=false},{enableHighAccuracy:true,timeout:15000,maximumAge:60000})})}}`;

export function daePage(origin: string, data: Cached<DaeAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/defibrillateurs`;
  const markers = (d?.communes ?? []).map((c) => ({ lon: c.lon, lat: c.lat, label: String(c.nombre), name: `${c.commune} : ${c.nombre} défibrillateurs`, round: true, color: COUNT_COLOR, quiet: true,
    place: c.commune, say: `${c.nombre} défibrillateur${c.nombre > 1 ? "s" : ""}`, href: `#${anchorId("c", c.commune)}` }));

  const status = !d
    ? loading("La liste des défibrillateurs")
    : `<div class="now"><span class="big">${d.total}</span><p>défibrillateurs déclarés en service dans les 24 communes de l'île.</p></div>`;

  const foldDae = !!d && d.communes.reduce((n, c) => n + c.liste.length, 0) > FOLD_ROWS && d.communes.length > 1;
  const list = d
    ? `<ul class="zones">${d.communes.map((c) =>
        `<li class="card tgt" id="${anchorId("c", c.commune)}">${folded(foldDae,
          `<h3>${esc(c.commune)}${foldDae ? "\u00a0" : " "}<span class="note">${foldDae ? "·\u00a0" : ""}${c.nombre}\u00a0défibrillateur${c.nombre > 1 ? "s" : ""}${c.toute_heure ? `, dont ${c.toute_heure}\u00a0accessible${c.toute_heure > 1 ? "s" : ""} à toute heure` : ""}</span></h3>`,
          `<ul class="rows eau dae">` +
        c.liste.map((x) => `<li><span>${esc(x.lieu)}<small>${[x.adresse, x.emplacement, x.etage ? `étage ${x.etage}` : ""].filter(Boolean).map((v) => esc(v!)).join(" · ")}</small>` +
          // The normal route, not on foot as « Autour de moi »: a device of the commune may be kilometres away.
          `${aller({ nom: x.lieu, lat: x.lat ?? NaN, lon: x.lon ?? NaN, adresse: x.adresse })}</span>` +
          `<span class="${x.acces.includes("toute heure") || x.acces.includes("24 h") ? "q-bonne" : "q-none"}">${esc(shortAccess(x.acces))}</span></li>`).join("") +
        (c.nombre > c.liste.length ? `<li><span class="note">et ${c.nombre - c.liste.length} autres : demandez le plus proche à votre IA.</span><span></span></li>` : "") +
        `</ul>`)}</li>`).join("")}</ul>`
    : "";

  const title = "Défibrillateurs Réunion : où trouver un DAE · 974";
  const description = "Défibrillateurs (DAE) à La Réunion (974) : plus de 1 200 appareils dans les 24 communes, d'après la base nationale Géo'DAE, et le plus proche d'un lieu avec votre IA.";

  const band = `${crumbBar("Défibrillateurs")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Base nationale Géo'DAE</p>
    <h1>Défibrillateurs <span class="n974">974</span></h1>
    ${status}
    ${d ? `<p class="lead"><b>${esc(d.urgence)}</b></p>` : ""}
    <div class="autour" id="autour" hidden><button type="button" class="btn sun" id="autour-btn">Autour de moi</button>
    <p class="note">Votre position ne quitte pas votre appareil.</p><p class="note" id="autour-msg" role="status" hidden></p>
    <div id="autour-res" hidden><h3>Les 10 plus proches, à vol d'oiseau</h3><ul class="rows eau dae" id="autour-list"></ul></div></div>
    ${ask(`Ousa néna in défibrilatèr pli prés la plaj l'Ermitaz ? Gèt si ${url} é di amwin.`,
      `Où est le défibrillateur le plus proche de la plage de l'Hermitage ? Lis ${url} et dis-le-moi.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : le nombre de défibrillateurs par commune" })}
  <figcaption class="note" style="color:var(--on-night-muted)">${legende([{ forme: "rond", couleur: COUNT_COLOR, texte: "52", dit: "défibrillateurs de la commune" }], esc(`Liste nationale Géo'DAE, lue le ${dayMonth(DAE_BUILT)}.`))}</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-dae">
  <div class="sec-h"><p class="eyebrow">Commune par commune</p><h2 id="h-dae">Où sont les défibrillateurs</h2>
  <p>Ceux qu'on peut atteindre à toute heure d'abord (à l'extérieur ou ouverts 24 h/24), puis ceux en accès libre aux heures d'ouverture du lieu. La liste est déclarée par les exploitants : un appareil peut avoir été déplacé.</p></div>
  ${list}
  <p class="note">Source : Géo'DAE, base nationale des défibrillateurs (ministère chargé de la santé), Licence Ouverte 2.0.</p>
</section>
${connectorCta("defibrillateurs", "les défibrillateurs")}
<script>${AUTOUR_SCRIPT}</script>${ALLER}`;

  return layout(origin, { title, description, path: "/defibrillateurs", jsonld: [crumbs(origin, "Défibrillateurs", "/defibrillateurs"), webPage(origin, "/defibrillateurs", title, description, data)], alerte }, band, body);
}

// ---------------------------------------------------------------- sport

const SPORT_LISTED = 8;
const SPORT_ORDER = ["handball", "volley-ball", "beach-volley", "voile", "golf", "sport auto", "triathlon"];
// The sports in the sentence of the count, as the page always named them.
const SPORT_SAID: Record<string, string> = { "volley-ball": "volley", "sport auto": "sport automobile" };
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

/** The link to a championship's page, inside it when it is folded (words from marketing). */
const FEDERATION = "Le classement sur le site de la fédération ↗";

/** The rows by sport, each sport folded when `fold` and the list is long (FOLD_ROWS): the results, not what is to come. */
function bySport(rows: NonNullable<SportAnswer["a_venir"]>, withScore: boolean, fold = false): string {
  const groups = SPORT_ORDER.map((sp) => ({ sp, list: rows.filter((r) => r.sport === sp) })).filter((g) => g.list.length);
  const folds = fold && groups.length > 1 && rows.length > FOLD_ROWS;
  return `<ul class="zones">${groups.map((g) =>
    `<li class="card">${folded(folds,
      `<h3>${esc(sportName(g.sp))}${folds ? "\u00a0" : " "}<span class="note">${folds ? "·\u00a0" : ""}${g.list.length}\u00a0${withScore ? "résultat" : "rendez-vous"}${withScore && g.list.length > 1 ? "s" : ""}</span></h3>`,
      `<ul class="rows eau">${g.list.slice(0, SPORT_LISTED).map((r) => sportRow(r, withScore)).join("")}` +
      (g.list.length > SPORT_LISTED ? `<li><span class="note">et ${g.list.length - SPORT_LISTED} autres : demandez-les à votre IA.</span><span></span></li>` : "") +
      `</ul>`)}</li>`).join("")}</ul>`;
}

export function sportPage(origin: string, data: Cached<SportAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/sport`;
  const upcoming = (d?.a_venir ?? []).filter((r) => r.etat !== "annulée");
  const soon = upcoming.slice(0, 7);
  const listedRows = d?.a_venir?.length ?? 0;
  const total = d?.a_venir_en_tout ?? listedRows;
  const there = new Set(d?.sports_a_venir ?? (d?.a_venir ?? []).map((r) => r.sport));
  const said = [...SPORT_ORDER.filter((s) => there.has(s)), ...[...there].filter((s) => !SPORT_ORDER.includes(s))].map((s) => SPORT_SAID[s] ?? s);

  const status = !d
    ? loading("Le calendrier du sport")
    // As sport counts them: all of them, cancelled ones included, with the sports there are (26/10/2026: 39 here for 77,
    // the triathlon left out and the motor sport said without any).
    : `<div class="now"><span class="big">${total}</span><p>rendez-vous officiels dans les quinze prochains jours${said.length ? `\u00a0: ${enumeration(said)}` : ""}` +
      `${listedRows < total ? `\u00a0; les ${listedRows} premiers ci-dessous` : ""}.</p></div>`;

  const next = soon.length
    ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">Les prochains rendez-vous</h3><ul class="plain">${soon.map((r) =>
        `<li><b>${esc(r.quand)}</b> : ${esc(r.epreuve)} <span class="note" style="color:var(--on-night-muted)">(${esc(r.competition ? `${r.sport}, ${r.competition}` : r.sport)})</span></li>`).join("")}</ul></figure>`
    : "";

  // Each championship folded when they are long (FOLD_ROWS). Its name then leaves the line, which opens it: the
  // federation's page is the first line inside.
  const foldTables = !!d && d.classements.length > 1 && d.classements.reduce((n, c) => n + c.lignes.length, 0) > FOLD_ROWS;
  const standings = d?.classements.length
    ? `<ul class="zones">${d.classements.map((c) => {
        const site = `<a href="${esc(c.lien)}" rel="noopener">${foldTables ? FEDERATION : esc(c.competition)}</a>`;
        const head = foldTables
          ? `<h3>${esc(c.competition)}${c.lignes.length ? `\u00a0<span class="note">·\u00a0${c.lignes.length}\u00a0équipe${c.lignes.length > 1 ? "s" : ""}</span>` : ""}</h3>`
          : `<h3>${site}</h3>`;
        return `<li class="card">${folded(foldTables, head, (foldTables ? `<p class="note">${site}</p>` : "") +
          `${c.muet ? `<p class="note">${silentText(c.muet)}</p>` : ""}${c.lignes.length ? `<ul class="rows eau">${c.lignes.map((l) =>
          `<li><span>${l.place}. ${esc(l.equipe)}<small>${l.joues} match${l.joues > 1 ? "s" : ""} joué${l.joues > 1 ? "s" : ""}</small></span><span class="score">${l.points} pts</span></li>`).join("")}</ul>` : ""}`)}</li>`;
      }).join("")}</ul>`
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


  const title = "Sport Réunion : matchs, résultats, Grand Raid · 974";
  const description = "Sport à La Réunion (974) : matchs à venir et résultats du handball et du volley régionaux, classements, rallyes et podiums du Grand Raid.";

  const band = `${crumbBar("Sport")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Calendriers et résultats officiels</p>
    <h1>Sport <span class="n974">974</span></h1>
    ${status}
    ${ask(`Kosa néna konm match sé wikenn la ? Gèt si ${url} é di amwin.`,
      `Quels matchs et quelles compétitions ce week-end à La Réunion ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${next}
</div>`;

  const body = `<section aria-labelledby="h-venir">
  <div class="sec-h"><p class="eyebrow">Quinze prochains jours</p><h2 id="h-venir">À venir</h2>
  <p>Les matchs des championnats régionaux de handball (D1) et de volley (R1) et le calendrier de la Ligue du sport automobile. Heures de La Réunion.</p></div>
  ${d ? (d.a_venir?.length ? bySport(d.a_venir, false) : `<p class="card">Aucun rendez-vous trouvé dans les quinze prochains jours.</p>`) : `<p class="card">Le calendrier se charge : rechargez la page dans quelques secondes.</p>`}
  ${clubsLink()}
</section>
${d?.programmes_communes?.length || d?.non_repris ? `<section aria-labelledby="h-prog">
  <div class="sec-h"><p class="eyebrow">Publiés par les mairies</p><h2 id="h-prog">Programmes sportifs des communes</h2>
  ${d.programmes_communes?.length ? `<p>${esc(d.programmes_a_savoir ?? "")}</p>` : ""}</div>
  ${d.programmes_communes?.length ? `<ul class="zones"><li class="card"><ul class="rows eau">${d.programmes_communes.map((p) =>
    `<li><span><a href="${esc(p.lien)}" rel="noopener"${ACCUEILS.has(p.lien) ? ' target="_blank"' : ""}>${esc(p.titre)}</a><small>${esc([p.commune, `Source\u00a0: ${p.source}`].filter(Boolean).join(" · "))}</small></span><span class="q-none">${esc(shortWhen(p.dates))}</span></li>`).join("")}</ul></li></ul>` : ""}
  ${d.non_repris ? `<p class="card np">${esc(d.non_repris)}${reprise(d.non_repris)}</p>` : ""}
</section>` : ""}
${d?.resultats?.length ? `<section aria-labelledby="h-res">
  <div class="sec-h"><p class="eyebrow">Sept derniers jours</p><h2 id="h-res">Derniers résultats</h2></div>
  ${bySport(d.resultats, true, true)}
</section>` : ""}
${standings ? `<section aria-labelledby="h-class">
  <div class="sec-h"><p class="eyebrow">Championnats régionaux</p><h2 id="h-class">Classements</h2></div>
  ${standings}
</section>` : ""}
${raid}
<section aria-labelledby="h-src">
  <div class="sec-h"><h2 id="h-src">Ce qui n'est pas couvert</h2><p>${d ? esc(d.non_couvert) : ""}</p></div>
  ${d && data ? sourcesNote(d.sources, data) : ""}
  <p class="note">${noteLa1ere("sport")}</p>
  ${mentionSports(undefined, true).map((x) => `<p class="note np">${esc(x)}${reprise(x)}</p>`).join("")}
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

/** A system as the RSMC's last advisory names it: its stage and the advisory's time, nothing computed. */
function activeCard(r: NonNullable<CyclonesAnswer["systemes_actifs"]>[number]): string {
  return `<article class="card"><h3>${esc(capital(r.nom))}${r.stade ? ` <span class="note">${esc(r.stade)}</span>` : ""}</h3>` +
    `<p>Dernier avis du CMRS : ${esc(r.dernier_avis)}.</p>` +
    `<p class="note">Bulletins : ${esc(r.centre)}, <a href="${esc(r.rapport)}" rel="noopener">fiche GDACS</a>.</p></article>`;
}

function seasonTable(s: CyclonesAnswer["saison_en_cours"]): string {
  return s.systemes.length
    ? `<div class="card table-wrap"><table class="drought"><thead><tr><th>Système</th><th>Dates</th></tr></thead><tbody>${s.systemes.map((x) =>
        `<tr><th scope="row"><a href="${esc(x.rapport)}" rel="noopener">${esc(capital(x.nom))}</a></th><td>${esc(x.du)} – ${esc(x.au)}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="card">Aucun système pour le moment.</p>`;
}

/**
 * The basin's map, without any system of the season (cyclones-bassin.ts), and the line that says where the systems
 * are: none, with the past cyclones' tracks; or the RSMC's map above it, or Météo-France's site when that map is not
 * shown here, and then no track at all.
 */
function basinFigure(d: CyclonesAnswer | undefined, active: number): string {
  const s = active > 1;
  const traces = !!d && !active;
  const past = TRACES.map((t, i) => `<li><a href="/cyclones/${t.slug}"><span class="nb">${i + 1}</span> ${esc(t.nom_annee)}</a></li>`).join("");
  const now = !d ? ""
    : !active ? `<p><b>Aucun système dans le bassin en ce moment.</b> En traits numérotés, les cyclones passés dont les stations de Météo-France ont mesuré le passage\u00a0:</p><ol class="trcs">${past}</ol>`
    : d.carte?.image ? `<p><b>${s ? "Des systèmes sont suivis" : "Un système est suivi"} par le CMRS\u00a0: <a href="#carte-cmrs">sa carte officielle est au-dessus</a>.</b></p>`
    : `<p><b>${s ? "Des systèmes sont suivis" : "Un système est suivi"} par le CMRS\u00a0:</b> ${officielHtml(mf.OFFICIEL_CYCLONE)}</p>`;
  const { "meteo-france": mfTraces, ibtracs, consulte } = TRACES_SOURCES;
  const older = TRACES.filter((t) => t.source === "ibtracs").map((t) => t.nom_annee);
  const sources = traces
    ? `Traces : <a href="${mfTraces.lien}" rel="noopener">${mfTraces.nom}</a>, ${mfTraces.licence}, consultées le ${consulte.split("-").reverse().join("/")}.` +
      (older.length
        ? ` ${older.join(" et ")} ${older.length > 1 ? "sont plus anciennes" : "est plus ancienne"} que ces données, qui commencent en ${mfTraces.depuis} : ` +
          `${older.length > 1 ? "leurs traces viennent" : "sa trace vient"} des positions du CMRS reprises par <a href="${ibtracs.lien}" rel="noopener">${ibtracs.nom}</a>.`
        : "") +
      " Cette carte ne montre aucun système de la saison. "
    : "Cette carte ne montre aucun système, ni sa position ni sa trajectoire. ";
  return `<figure class="card bassin">${basinMap(traces)}<figcaption>${now}<p class="note">En pointillé, la zone suivie par le CMRS de La Réunion (Météo-France), de l'équateur à 40°\u00a0S et des côtes de l'Afrique à 90°\u00a0E (<a href="${ZONE_SOURCE}" rel="noopener">CMRS, présentation à l'OMM, 2017</a>). ` +
    `${sources}Côtes\u00a0: Natural Earth (domaine public).</p></figcaption></figure>${traces ? `<script>${TRACES_SCRIPT}</script>` : ""}`;
}

export function cyclonesPage(origin: string, data: Cached<CyclonesAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/cyclones`;
  const active = d?.systemes_actifs ?? [];

  const status = !d
    ? loading("Le suivi des cyclones")
    : `<div class="now"><span class="big">${active.length}</span><p>système${active.length > 1 ? "s" : ""} tropica${active.length > 1 ? "ux" : "l"} actif${active.length > 1 ? "s" : ""} dans le sud-ouest de l'océan Indien.</p></div>`;
  // No track of ours: the official map is on Météo-France's site, and above the basin's map while a system is active.
  const official = `<p class="lead">Trajectoire et bulletins officiels : <a href="${mf.OFFICIEL_CYCLONE}" rel="noopener">consulter le site officiel de Météo-France</a>.</p>`;

  const title = "Cyclone Réunion en ce moment : systèmes actifs, alerte · 974";
  const short = "Cyclones autour de La Réunion (974) : systèmes actifs et leur stade selon le CMRS de Météo-France, alerte cyclonique, saisons passées, lien officiel.";
  const description = d ? describe(`${d.resume}`, short) : short;

  const band = `${crumbBar("Cyclones")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Bulletins du CMRS de La Réunion</p>
    <h1>Cyclones <span class="n974">974</span></h1>
    ${status}
    ${official}
    ${d?.alerte_cyclonique ? `<p class="lead"><b>${esc(d.alerte_cyclonique)}</b></p>` : ""}
    ${d && (d.ecoles?.niveau ?? -1) <= 2 ? `<p class="lead"><a href="/kit-cyclone">Se préparer : le kit d'urgence du plan →</a></p>` : ""}
    ${ask(`Néna in siklone pa loin La Rényon ? Gèt si ${url} é di amwin sak Météo-France é la préfektir i di.`,
      `Y a-t-il un cyclone près de La Réunion ? Lis ${url} et dis-moi ce qu'en disent Météo-France et la préfecture.`)}
  </div>
</div>`;

  const body = `<section aria-labelledby="h-actifs">
  <div class="sec-h"><p class="eyebrow">En ce moment</p><h2 id="h-actifs">Systèmes actifs</h2>
  <p>${d ? esc(d.resume) : ""}</p></div>
  ${d ? active.map(activeCard).join("") : `<p class="card">Le suivi se charge : rechargez la page dans quelques secondes.</p>`}
  ${active.length ? carteHtml(d?.carte, now) : ""}
  ${basinFigure(d, active.length)}
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
  <div class="card"><h3>Alerte cyclonique</h3>${CYCLONE_SCALE}
  <p class="note">Les consignes officielles et les arrêtés sont ceux de la <a href="https://www.reunion.gouv.fr/">préfecture de La Réunion</a>. Écoutez la radio en cas de cyclone : le réseau mobile peut tomber.</p></div>
</section>
${d ? `<section aria-labelledby="h-saison">
  <div class="sec-h"><p class="eyebrow">Juillet à juin</p><h2 id="h-saison">Saison ${esc(d.saison_en_cours.nom)}</h2><p>${esc(d.saison)}</p></div>
  ${seasonTable(d.saison_en_cours)}
</section>` : ""}
${d?.saison_precedente ? `<section aria-labelledby="h-saison-prec">
  <div class="sec-h"><p class="eyebrow">Saison passée</p><h2 id="h-saison-prec">Saison ${esc(d.saison_precedente.nom)}</h2></div>
  ${seasonTable(d.saison_precedente)}
</section>` : ""}
<section aria-labelledby="h-passes">
  <div class="sec-h"><p class="eyebrow">Mesures Météo-France</p><h2 id="h-passes">Cyclones passés</h2>
  <p>La pluie et les rafales mesurées station par station pendant leur passage, et les records de station.</p></div>
  <div class="card"><ul class="plain">${PASSES.map((p) => `<li><a href="/cyclones/${p.slug}">Cyclone ${esc(p.nom)}, ${esc(p.date)}</a></li>`).join("")}</ul></div>
</section>
${d ? `<section aria-labelledby="h-src"><div class="sec-h"><h2 id="h-src">D'où viennent ces données</h2><p>${esc(d.a_savoir)}</p></div>${data ? sourcesNote(d.sources, data) : ""}</section>` : ""}
${connectorCta("cyclones", "les cyclones")}`;

  return layout(origin, { title, description, path: "/cyclones", jsonld: [crumbs(origin, "Cyclones", "/cyclones"), webPage(origin, "/cyclones", title, description, data)], alerte, vert: !!d && !alerte && !active.length }, band, body);
}

export function cyclonesLive(data: Cached<CyclonesAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const active = d.systemes_actifs ?? [];
  // In an alert, what the plan says of daily life is a click away (marketing).
  const plan = d.vie_quotidienne ? ` · <a href="/alerte-cyclone">Ce qui ferme, ce qui continue →</a>` : "";
  if (active.length) {
    const r = active[0];
    return { valeur: `${active.length} système${active.length > 1 ? "s" : ""} actif${active.length > 1 ? "s" : ""}`, detail: `${esc(capital(r.nom))}${r.stade ? `, ${esc(r.stade)}` : ""}${plan}` };
  }
  const last = d.saison_en_cours.systemes[0] ?? d.saison_precedente?.systemes[0];
  return { valeur: "aucun système actif", detail: `saison ${esc(d.saison_en_cours.nom)}${last ? ` ; dernier : ${esc(capital(last.nom))} (${esc(last.du)} – ${esc(last.au)})` : ""}` };
}

// ---------------------------------------------------------------- historique météo

const pct = (x?: string) => (x ? Number.parseInt(x, 10) : undefined);
/**
 * The classes of the rain against its normal, one set for the header's count, the map and the table's bars: under
 * 80 % is « nettement moins », as the header counts, and over 125 % (80 %'s inverse) « nettement plus ».
 */
const RAIN_LOW = 80;
const RAIN_HIGH = 125;
const RAIN_CLASSES = [
  { couleur: "#ff922b", texte: "40 %", dit: `moins de ${RAIN_LOW}\u00a0%\u00a0: nettement moins que la normale` },
  { couleur: "#69db7c", texte: "100 %", dit: `de ${RAIN_LOW} à ${RAIN_HIGH}\u00a0%\u00a0: proche de la normale` },
  { couleur: "#4dabf7", texte: "160 %", dit: `plus de ${RAIN_HIGH}\u00a0%\u00a0: nettement plus que la normale` },
];
const rainClass = (x: number) => RAIN_CLASSES[x < RAIN_LOW ? 0 : x > RAIN_HIGH ? 2 : 1];
/** A bar of the rain against the normal: 100 % is the normal; its colour is the class of the station's ratio. */
function rainBar(total: number, normal?: number, ratio?: number): string {
  if (normal == null || normal <= 0) return `<b>${fr(total)}\u00a0mm</b>`;
  const x = ratio ?? Math.round((100 * total) / normal);
  const w = Math.min(x / 100, 2) * 50;
  return `<b>${fr(total)}\u00a0mm</b><small class="note">normale ${normal}\u00a0mm</small><span class="ratio" role="img" aria-label="${x} % de la normale"><i style="width:${w}%;background:${rainClass(x).couleur}"></i><s></s></span>`;
}
const vsNormal = (v?: number, n?: number, unit = "\u00a0°C") =>
  v == null ? "—" : `<b>${fr(v)}${unit}</b>${n != null ? `<small class="note">normale ${fr(n)}${unit}</small>` : ""}`;

export function historiquePage(origin: string, data: Cached<HistoriqueAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = `${origin}/historique`;
  const rows = d?.stations ?? [];
  const below = rows.filter((r) => (pct(r.pluie?.rapport_a_la_normale) ?? 100) < RAIN_LOW).length;
  const withNormal = rows.filter((r) => r.pluie?.rapport_a_la_normale).length;

  const markers = rows.flatMap((r) => {
    const x = pct(r.pluie?.rapport_a_la_normale);
    return x == null ? [] : [{ lon: r.lon, lat: r.lat, label: `${x} %`, name: r.station, color: rainClass(x).couleur, ink: COUNT_COLOR,
      say: `${x} % de la pluie normale en 30 jours`, href: `#${anchorId("s", r.station)}` }];
  });

  const status = !d
    ? loading("L'historique des mesures")
    : `<div class="now"><span class="big">${below}<small>/${withNormal}</small></span><p>stations de référence ont reçu nettement moins de pluie que la normale du ${esc(d.periode.du)} au ${esc(d.periode.au)} (moins de ${RAIN_LOW} % de leur moyenne 1991-2020).</p></div>`;

  const table = rows.length
    ? `<div class="card table-wrap"><table class="drought histo"><thead><tr><th>Station</th><th>Pluie, 30 jours</th><th>Maximales</th><th>Minimales</th><th>Soleil</th></tr></thead><tbody>${rows.map((r) => {
        const e = r.ensoleillement;
        return `<tr><th scope="row" class="tgt" id="${anchorId("s", r.station)}">${esc(r.station)}<small class="note">${esc(r.zone)}, ${nombre(r.altitude_m)}\u00a0m</small></th>` +
          `<td>${r.pluie ? rainBar(r.pluie.total_mm, r.pluie.normale_mm, pct(r.pluie.rapport_a_la_normale)) : "—"}</td>` +
          `<td>${vsNormal(r.temperatures?.maximales_moyenne, r.temperatures?.maximales_normale)}</td>` +
          `<td>${vsNormal(r.temperatures?.minimales_moyenne, r.temperatures?.minimales_normale)}</td>` +
          `<td>${e?.jours_mesures ? `${vsNormal(e.heures_par_jour, e.normale_heures_par_jour, "\u00a0h/j")}<small class="note">${e.jours_gris} jour${e.jours_gris > 1 ? "s" : ""} gris</small>` : "—"}</td></tr>`;
      }).join("")}</tbody></table></div>`
    : "";

  const charts = d ? graphes(d) : "";
  const title = "Historique météo Réunion : relevés depuis 1900 · 974";
  const short = "Le temps qu'il a fait à La Réunion (974) : pluie, températures et soleil mesurés par Météo-France jour par jour depuis 1900, comparés à la normale.";
  const description = d ? describe(`${d.resume}`, short) : short;

  const band = `${crumbBar("Historique météo")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Mesures jusqu'${d ? `au ${esc(d.periode.au.slice(0, 5))}` : "à hier"}</p>
    <h1>Historique météo <span class="n974">974</span></h1>
    ${status}
    ${ask(`La pli i tonb Sin-Bénoi ? Lé normal ? Gèt si ${url} é di amwin konbien la tonbé sé dernié zour.`,
      `Il a plu combien ces derniers jours à Saint-Benoît, et c'est normal ? Lis ${url} et dis-le-moi.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : la pluie des 30 derniers jours à six stations, en pourcentage de la normale" })}
  <figcaption class="note" style="color:var(--on-night-muted)">${legende(RAIN_CLASSES.map((c) => ({ forme: "pastille", encre: COUNT_COLOR, ...c })), esc(`Pluie mesurée par Météo-France${d ? ` du ${d.periode.du.slice(0, 5)} au ${d.periode.au.slice(0, 5)}` : " ces 30 derniers jours"}, en % de la normale 1991-2020.`))}</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-trente">
  <div class="sec-h"><p class="eyebrow">Six climats, six stations</p><h2 id="h-trente">Les 30 derniers jours</h2>
  <p>${d ? esc(d.resume) : ""}</p></div>
  ${table}
</section>
${charts ? `${charts}<script>${GRAPHES_SCRIPT}</script>` : ""}
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

export function historiqueLive(data: Cached<HistoriqueAnswer> | null, now = new Date()): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const r = d.stations.find((x) => x.pluie?.rapport_a_la_normale);
  if (!r?.pluie) return empty(`Rapport à la normale pas encore calculé pour les 30 derniers jours (lecture ${readAt(data!.fetchedAt, now).de}).`);
  return { valeur: `${r.pluie.rapport_a_la_normale} de la normale`, detail: `pluie des 30 derniers jours à ${esc(r.station)} (${fr(r.pluie.total_mm)} mm)` };
}

// ---------------------------------------------------------------- agenda

const AGENDA_WEEKEND = 7;
type AgendaRow = AgendaAnswer["ce_week_end"][number];
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** The hours of a row within its day, as kit.md writes them: « 14 h–18 h », « 19:30 », « 20 h », « jusqu'au dimanche 25/10 ». */
export function agendaHours(q: string): string {
  const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const span = /de (\d\d:\d\d) à (\d\d:\d\d)$/.exec(q);
  if (span) return tranche(min(span[1]), min(span[2]));
  const at = /^\S+ \S+ à (\d\d:\d\d)$/.exec(q);
  if (at) return heure(min(at[1]));
  const until = /^du .* au (\S+ \S+)(?: à \S+)?$/.exec(q);
  return until ? `jusqu'au ${until[1]}` : "";
}

/**
 * The logos of the platforms an association links (connecteurs/), shown beside each event read there, by the
 * platform's name: the official file, as each platform gives it.
 */
export const LOGOS: Record<string, string> = {};

/**
 * « Y aller » under an event whose source gives its position (the agendas of OpenAgenda, a venue's on a WordPress
 * agenda): the place's name in the sheet, the place and its commune to copy. Nothing for the others: no geocoding.
 */
export function eventGo(r: Pick<AgendaRow, "titre" | "lieu" | "commune" | "position">, g: Porte = porte()): string {
  if (!r.position) return "";
  const adresse = r.lieu && r.commune && !normalize(r.lieu).includes(normalize(r.commune)) ? `${r.lieu}, ${r.commune}` : r.lieu;
  const go = g.aller({ nom: r.lieu?.split(", ")[0] || r.titre, lat: r.position.lat, lon: r.position.lon, adresse });
  return go ? `<span class="ya">${go}</span>` : "";
}

function agendaRow(r: AgendaRow, g: Porte = porte()): string {
  const lieu = r.lieu && r.lieu.length > 80 ? `${r.lieu.slice(0, 79)}…` : r.lieu;
  const small = [r.commune, lieu, r.prix && r.prix.length < 80 ? r.prix : undefined, r.autres_dates ? `aussi ${r.autres_dates.join(", ")}` : undefined, r.propose ? `${r.publie_par} · ${r.propose}` : r.via ? `${r.publie_par} · via ${r.via.plateforme}, ${r.via.lu}` : r.source ? `Source\u00a0: ${r.source}` : r.publie_par && r.lu_le ? `${r.publie_par}, lu le ${r.lu_le}` : r.publie_par, r.contact ? `contact\u00a0: ${r.contact}` : undefined]
    .filter(Boolean).map((x) => esc(x!)).join(" · ");
  // Cancelled or postponed stays listed, said first: people look for it.
  const badge = r.statut ? `<span class="badge${r.statut === "complet" ? " m" : ""}">${esc(r.statut)}</span> ` : "";
  const book = r.billetterie && r.billetterie !== r.lien ? ` · <a href="${esc(r.billetterie)}" rel="noopener">billets</a>` : "";
  // Its platform's logo, linking to the event's page there, as the platform's terms ask.
  const logo = r.via && LOGOS[r.via.plateforme] && r.lien ? ` <a href="${esc(r.lien)}" rel="noopener" class="via"><img src="${LOGOS[r.via.plateforme]}" alt="${esc(r.via.plateforme)}" height="14"></a>` : "";
  // Said by the news before the organiser's page: who said it, to check.
  const news = r.statut_d_apres
    ? `<small class="said">${esc(r.statut!.toLowerCase())}${r.reporte_au ? ` au ${esc(r.reporte_au)}` : ""} d'après <a href="${esc(r.statut_d_apres.lien)}" rel="noopener"${fenetre(r.statut_d_apres.lien)}>${esc(r.statut_d_apres.media)}</a></small>`
    : "";
  const blank = r.lien && ACCUEILS.has(r.lien) ? ' target="_blank"' : "";
  // « jusqu'au vendredi 11/12 » goes under the title on a phone (.fin): beside it, it left the title a word a line.
  const hours = agendaHours(r.quand);
  return `<li data-g="${esc(r.genres.join(" "))}"><span>${badge}${r.lien ? `<a href="${esc(r.lien)}" rel="noopener"${blank}>${esc(r.titre)}</a>` : esc(r.titre)}${news}<small>${small}${logo}${book}</small>${eventGo(r, g)}</span><span class="q-none${hours.startsWith("jusqu'au") ? " fin" : ""}">${esc(hours)}</span></li>`;
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

/** Under the lists of events and of matches, once the clubs' space is out (web/associations.ts). */
const clubsLink = () =>
  enLigne() ? `<p><a href="/associations?ref=site">Votre club ou votre association n'y est pas\u00a0? Faites connaître vos événements</a></p>` : "";

// What an event is, said in its schema.org description when its source gives no summary.
const KIND: Record<string, string> = {
  concert: "Concert", théâtre: "Théâtre", danse: "Spectacle de danse", humour: "Spectacle d'humour", cirque: "Cirque, conte ou magie",
  soirée: "Soirée", festival: "Fête ou festival", marché: "Marché", cinéma: "Cinéma", enfants: "Sortie pour les enfants",
  exposition: "Exposition ou visite", sport: "Rendez-vous sportif", atelier: "Atelier ou rencontre",
};
const SUMMARY_MAX = 300;
// The halls whose own programme is read: an event from it is theirs to organise. A town hall's agenda also lists what
// associations put on, so the town hall is never said to organise.
const HALLS = new Set(AGENDAS.filter((a) => a.source === SALLES_SOURCE).map((a) => a.nom));

/** The source's summary, cut at a word within SUMMARY_MAX; else what, where: « Concert à Saint-Paul, TÉAT Plein Air. » */
export function eventSummary(r: AgendaRow): string {
  const text = r.description?.replace(/\s+/g, " ").trim();
  if (text && text.length > 20) return text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX).replace(/\s+\S*$/, "")}…`;
  const kind = r.genres.map((g) => KIND[g]).find(Boolean) ?? "Événement";
  return `${kind} à ${r.commune}${r.lieu && r.lieu !== r.commune ? `, ${r.lieu}` : ""}.`;
}

/**
 * The events as schema.org `Event`s, which search engines show in their own box. Only those with a commune and a
 * date: a place and a start are what they require. Nothing the source does not give, and no end guessed: the price as
 * the source writes it; the picture only OpenAgenda's, under the Licence Ouverte (never a town hall's or a hall's); the organiser as the site's agenda names it, else the hall whose own programme it is, never the town
 * hall that publishes it.
 */
export function agendaEvents(rows: AgendaRow[]): object[] {
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
      ...organizer(r),
      ...offer(r.prix, r.lien),
      // The credit OpenAgenda gives, as its creator and its credit line; no copyright notice nor licence page it does not give.
      ...(r.image ? { image: { "@type": "ImageObject", url: r.image.url, author: { "@type": "Organization", name: r.image.auteur }, creator: { "@type": "Organization", name: r.image.auteur }, creditText: r.image.auteur, license: LICENCE_OUVERTE } } : {}),
    };
  });
}

// The licence of OpenAgenda's pictures (rights.license of each event, providers/agenda.ts).
const LICENCE_OUVERTE = "https://www.data.gouv.fr/pages/legal/licences/etalab-2.0/";

/**
 * Who organises it: those the site's agenda names; else the hall whose programme it is, or the association that
 * proposed it here. Never the town hall that publishes an agenda listing what associations put on.
 */
function organizer(r: AgendaRow): { organizer?: object | object[] } {
  const named = r.organise_par?.map((name) => ({ "@type": "Organization", name }));
  if (named?.length) return { organizer: named.length === 1 ? named[0] : named };
  return HALLS.has(r.publie_par) || r.propose ? { organizer: { "@type": "Organization", name: r.publie_par } } : {};
}

/**
 * An Offer only for one amount read in the source: « gratuit » is 0 €, « 5 € » is 5 €. A range, several prices or a
 * condition of entry (« Sur inscription ») make none, as an Offer without its price is what search engines warn of.
 * No availability nor sale date: no source gives them.
 */
function offer(prix: string | undefined, url?: string): { offers?: object } {
  if (!prix) return {};
  const amount = /^gratuit/i.test(prix) ? 0 : /^\s*(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?)\s*$/i.exec(prix)?.[1]?.replace(",", ".");
  return amount === undefined ? {} : { offers: { "@type": "Offer", price: Number(amount), priceCurrency: "EUR", ...(url ? { url } : {}) } };
}

// The kinds a visitor can keep, in the order of the select; only those in the list are offered.
const GENRES: [string, string][] = [["concert", "Concerts"], ["théâtre", "Théâtre"], ["danse", "Danse"], ["humour", "Humour"], ["cirque", "Cirque, contes, magie"], ["soirée", "Soirées et clubbing"], ["festival", "Fêtes et festivals"], ["marché", "Marchés"], ["cinéma", "Cinéma"], ["enfants", "Pour les enfants"], ["exposition", "Expositions et visites"], ["sport", "Sport"], ["atelier", "Ateliers et rencontres"]];
const GENRE_SCRIPT = `(()=>{const f=document.getElementById("ef");if(!f)return;f.hidden=false;
const run=()=>{const g=f.g.value;let n=0;document.querySelectorAll("#jours li[data-g]").forEach((li)=>{const ok=!g||li.dataset.g.split(" ").includes(g);li.hidden=!ok;if(ok)n++});
document.querySelectorAll("#jours>ul>li.card").forEach((c)=>{c.hidden=!c.querySelector("li[data-g]:not([hidden])")});
if(g)document.querySelectorAll("#jours details").forEach((d)=>{if(d.querySelector("li[data-g]:not([hidden])"))d.open=true});
document.getElementById("ef-n").textContent=g?n+" événement"+(n>1?"s":""):"";};
f.addEventListener("input",run);f.addEventListener("submit",(e)=>e.preventDefault());})();`;

export function agendaPage(origin: string, data: Cached<AgendaAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const g = porte(alerte);
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
        `<li><b>${esc(r.quand)}</b> : ${r.statut && r.statut !== "complet" ? `<b>${esc(r.statut)}</b> ` : ""}${esc(r.titre)}${r.commune || r.source ? ` <span class="note" style="color:var(--on-night-muted)">${esc([r.commune && `(${r.commune})`, r.source && `Source\u00a0: ${r.source}`].filter(Boolean).join(" · "))}</span>` : ""}</li>`).join("")}</ul>` +
      `<p class="note"><a href="/evenements/ce-week-end" style="color:var(--on-night)">${d.ce_week_end.length > AGENDA_WEEKEND ? `Et ${d.ce_week_end.length - AGENDA_WEEKEND} autres : tout` : "Tout"} le week-end →</a></p></figure>`
    : "";
  // The map of tonight, tomorrow and the weekend (evenements-carte.ts): it filters, so it is in the content, under the band.
  const carte = d && data
    ? eventsMap(d.evenements ?? [], d.ce_week_end, GENRES, now, esc(`Annonces des salles, des mairies et des offices de tourisme, d'après les agendas lus ${readAt(data.fetchedAt, now).a}.`))
    : "";

  // The days after tomorrow folded when the list is long (FOLD_ROWS); today and tomorrow open, and folding with a tap.
  const tomorrow = new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10);
  const foldDays = days.size > 2 && (d?.evenements?.length ?? 0) > FOLD_ROWS;
  const present = new Set((d?.evenements ?? []).flatMap((r) => r.genres));
  const filter = present.size > 1
    ? `<form id="ef" class="card filter" hidden role="search" aria-label="Filtrer les événements par genre"><label>Genre <select name="g"><option value="">tous</option>${GENRES.filter(([g]) => present.has(g)).map(([g, nom]) => `<option value="${esc(g)}">${esc(nom)}</option>`).join("")}</select></label><p class="note" id="ef-n" aria-live="polite"></p></form>`
    : "";
  const list = !d
    ? `<p class="card">L'agenda se charge : rechargez la page dans quelques secondes.</p>`
    : days.size
      ? `${filter}<div id="jours"><ul class="zones">${[...days].sort(([x], [y]) => x.localeCompare(y)).map(([day, rows]) =>
          `<li class="card">${folded(foldDays,
            `<h3>${esc(longDay(day).replace(/^\p{L}/u, (c) => c.toUpperCase()).replace(/(\d) /, "$1\u00a0"))}${foldDays ? "\u00a0" : " "}<span class="note">${foldDays ? "·\u00a0" : ""}${rows.length}\u00a0événement${rows.length > 1 ? "s" : ""}</span></h3>`,
            `<ul class="rows eau">${rows.map((r) => agendaRow(r, g)).join("")}</ul>`, day <= tomorrow)}</li>`).join("")}</ul></div>${d.autres ? `<p class="note">${esc(d.autres)} Demandez-les à votre IA.</p>` : ""}<script>${GENRE_SCRIPT}</script>`
      : `<p class="card">Aucun événement trouvé dans les agendas lus pour les deux semaines qui viennent.</p>`;

  const title = "Que faire à La Réunion ? Concerts, fêtes, sorties · 974";
  const short = "Que faire à La Réunion (974) : concerts, théâtre, danse, festivals, fêtes et marchés des deux semaines, programmes des salles et des mairies.";
  const description = d ? describe(`${d.resume} Concerts, spectacles, fêtes, festivals et marchés, avec les heures, le lieu et le lien.`, short) : short;

  const band = `${crumbBar("Événements")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Salles de spectacle, mairies et tourisme</p>
    <h1>Événements <span class="n974">974</span></h1>
    ${status}
    ${ask(`Kosa néna pou fé sé wikenn la ? Gèt si ${url} é di amwin.`,
      `Que faire ce week-end à La Réunion ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${weekend}
</div>`;

  const body = `${carte ? `<section aria-labelledby="h-carte"><h2 id="h-carte">Sur la carte</h2>${carte}</section>
` : ""}<section aria-labelledby="h-jours">
  <div class="sec-h"><p class="eyebrow">Deux semaines</p><h2 id="h-jours">Jour par jour</h2>
  <p>Chaque événement renvoie à la page de celui qui le publie. Heures de La Réunion ; un événement de plusieurs jours est rangé au jour où il commence, ou à aujourd'hui s'il a déjà commencé. Un événement annulé ou reporté reste affiché, avec son statut.</p></div>
  ${agendaTabs("/evenements")}
  ${list}
  ${d?.non_repris ? `<p class="np">${esc(d.non_repris)}${reprise(d.non_repris)}</p>` : ""}
  ${clubsLink()}
  ${warnings(agendaNotes(data, now))}
</section>
<section aria-labelledby="h-couv">
  <div class="sec-h"><h2 id="h-couv">Ce qui est couvert</h2><p>${d ? esc(d.couverture) : ""}</p><p>${d ? esc(d.a_savoir) : ""}</p>
  <p>Les séances de cinéma sont sur les sites des salles : ${CINEMAS.map((c) => `<a href="${esc(c.lien)}" rel="noopener">${esc(c.nom)}</a>`).join(", ")}.</p></div>
  ${d && data ? sourcesNote(d.sources, data) : ""}
  <p class="note np">${noteReunionFr()}${reprise(noteReunionFr())}</p>
</section>
${connectorCta("evenements", "les événements de l'île")}`;

  const events = agendaEvents(d?.evenements ?? []);
  const jsonld = [crumbs(origin, "Événements", "/evenements"), webPage(origin, "/evenements", title, description, data), ...(events.length ? [{ "@context": "https://schema.org", "@graph": events }] : [])];
  return layout(origin, { title, description, path: "/evenements", jsonld, alerte }, band, g.ligne + (body.includes('class="aller"') ? body + ALLER : body));
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
  return `<li data-k="${esc(r.lien)}" data-c="${esc((r.communes ?? []).join("|"))}" data-s="${esc((r.sujets ?? []).join("|"))}"><span><a href="${esc(r.lien)}" rel="noopener"${fenetre(r.lien)}>${esc(r.titre)}</a>` +
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
    // All of them, as actualites counts them; the list keeps the newest (26/10/2026: 40 here, 103 in the tool).
    : `<div class="now"><span class="big">${d.total ?? d.infos.length}</span><p>informations des médias de l'île depuis 24 h` +
      `${(d.total ?? 0) > d.infos.length ? `\u00a0; les ${d.infos.length} plus récentes ci-dessous` : ""}` +
      `${d.en_direct.length ? ` ; <b>${esc(d.en_direct[0].media)} suit la journée en direct</b> (dernière entrée à ${esc(newsTime(d.en_direct[0]))})` : ""}.</p></div>`;

  const top = d ? (d.en_direct.length ? d.en_direct : d.infos).slice(0, 6) : [];
  const side = d
    ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">${d.en_direct.length ? "En direct" : "À la une"}</h3><ul class="plain">${top.map((r) =>
        `<li><b style="color:var(--on-night)">${esc(newsTime(r))}</b> <a href="${esc(r.lien)}" rel="noopener"${fenetre(r.lien)} style="color:var(--on-night)">${esc(r.titre)}</a>` +
        `<span class="note" style="color:var(--on-night-muted)"> · ${esc(r.media)}${r.communes?.length ? ` · ${esc(r.communes.join(", "))}` : ""}</span></li>`).join("")}</ul></figure>`
    : "";

  const list = d
    ? d.infos.length
      ? `${NEWS_FILTER.replace("COMMUNES", communes.map((c) => `<option>${esc(c)}</option>`).join(""))}<ul class="rows eau" id="news">${d.infos.map(newsRow).join("")}</ul>`
      : d.indisponible.length ? "" : `<p class="card">Aucune information des médias lus depuis 24 h.</p>`
    : `<p class="card">L'actualité se charge : rechargez la page dans quelques secondes.</p>`;

  const live = d?.en_direct.length
    ? `<section aria-labelledby="h-direct">
  <div class="sec-h"><p class="eyebrow">Heure par heure</p><h2 id="h-direct">Le direct ${/^[aeiouyéèêiî]/i.test(d.en_direct[0].media) ? "d'" : "de "}${esc(d.en_direct[0].media)}</h2>
  <p>Les entrées du direct, la plus récente en haut, avec leur première phrase et ce qu'elles disent des communes. Le texte complet est sur le site du média.</p></div>
  <ul class="rows eau">${d.en_direct.map((r) => `<li><span><a href="${esc(r.lien)}" rel="noopener"${fenetre(r.lien)}>${esc(r.titre)}</a>${r.resume ? `<small>${esc(r.resume)}</small>` : ""}` +
    `${r.communes?.length ? `<small>${esc(r.communes.join(", "))}</small>` : ""}</span><span class="q-none">${esc(newsTime(r))}</span></li>`).join("")}</ul>
</section>`
    : "";

  const pref = d?.prefecture.length
    ? `<section aria-labelledby="h-pref">
  <div class="sec-h"><p class="eyebrow">Officiel</p><h2 id="h-pref">Communiqués de la préfecture</h2><p>Mesures de sécurité, interdictions, routes, eau : les consignes officielles priment.</p></div>
  ${d.prefecture_injoignable ? `<p class="note">${silentText(d.prefecture_injoignable)}</p>` : ""}
  <ul class="rows eau">${d.prefecture.map((r) => `<li><span><a href="${esc(r.lien)}" rel="noopener">${esc(r.titre)}</a></span><span class="q-none">${esc(newsTime(r))}</span></li>`).join("")}</ul>
</section>`
    : "";

  const title = "Actualités Réunion en direct, commune par commune · 974";
  const short = "Ce qui se passe en ce moment à La Réunion (974) : les titres des médias de l'île, leurs directs et les communiqués de la préfecture, commune par commune, mis à jour toutes les 5 minutes.";
  const description = d && d.infos[0] ? describe(`À La Réunion, ${newsTime(d.infos[0])} : ${d.infos[0].titre}. Les titres des médias de l'île et leurs directs, commune par commune.`, short) : short;

  const band = `${crumbBar("Actualités")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Les médias de l'île, relus toutes les 5 minutes</p>
    <h1>Actualités <span class="n974">974</span></h1>
    ${status}
    ${ask(`Kosa i spas Sin-Pyèr astèr ? Néna baraz ? Gèt si ${url} é di amwin.`,
      `Que se passe-t-il à Saint-Pierre en ce moment, y a-t-il des blocages ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${side}
</div>`;

  const body = `${live}
<section aria-labelledby="h-news">
  <div class="sec-h"><p class="eyebrow">Les dernières 24 heures</p><h2 id="h-news">Toutes les informations</h2>
  <p>Le titre de chaque article, sa première phrase quand le média la donne, son média, les communes qu'il nomme et son heure (heure de La Réunion), ou son jour seulement quand le média ne donne pas l'heure. Une même information publiée par plusieurs médias n'est listée qu'une fois.</p></div>
  ${list}
  ${d?.indisponible.length ? warnings([mediasNonLus(d.indisponible, localTime(data!.fetchedAt), now)]) : ""}
</section>
${pref}
<section aria-labelledby="h-couv">
  <div class="sec-h"><h2 id="h-couv">Ce qui est couvert</h2><p>${d ? esc(d.couverture) : ""}</p><p>${d ? esc(d.a_savoir) : ""}</p></div>
  ${d && data ? sourcesNote(d.sources, data) : ""}
  <p class="note">${noteLa1ere("actualites")}</p>
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
