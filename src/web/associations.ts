/**
 * /associations: the clubs' and associations' space (marketing's spec, espace-associations.md §1 to §8). First the
 * form to propose an event, for the 8 associations out of 10 without any tool; then the proof, counted from the
 * agendas' last copy, never written by hand; the tools a club may already use, one card each, saying whether
 * rundata.re reads it; the guide for those who want to do it properly; the rules; the text to pass on.
 * /clubs and /asso lead here.
 */
import type { Cache } from "../cache.js";
import { AGENDAS, BUNDLE, BUNDLE_SYNC_SECONDS, copiePlanifiee, type Evenement, planifiees } from "../providers/agenda.js";
import { evenements as proposes, ID as PROPOSITIONS_ID } from "../providers/agenda-propositions.js";
import { lisible } from "../propositions.js";
import { inPeriod, periode, when } from "../tools/agenda.js";
import type { Alerte } from "./data.js";
import * as connecteurs from "./connecteurs.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { ICS_PATH, JSON_PATH } from "./flux-associations.js";
import { esc } from "./map.js";
import { layout } from "./pages.js";
import { lienForm, PROPOSER_PATH, TURNSTILE_SCRIPT } from "./propositions.js";
import brand from "./brand.json" with { type: "json" };
import { KREOL } from "./publier-texte.js";

export const PATH = "/associations";
/** The short addresses people type, sent here. */
export const ALIASES = ["/clubs", "/asso"];
const TITLE = "Clubs et associations\u00a0: faites connaître vos événements, gratuitement · 974";
const META = "Matchs, kermesses, sorties, concerts\u00a0: vos dates sur rundata.re et dans les assistants IA, avec le nom de votre club. Gratuit, sans compte, en quelques clics.";
const H1 = "Espace clubs et associations";
const ESPRIT = "Vos matchs, vos kermesses, vos sorties et vos concerts s'affichent gratuitement sur rundata.re et dans les assistants IA qui l'utilisent (ChatGPT, Claude, Le Chat), avec le nom et le lien de votre club. Vous continuez à publier là où vous le faites déjà\u00a0: sans compte, sans publicité, et vos événements deviennent des données ouvertes, que tout le monde peut réutiliser en citant votre club.";
/** Under it, no figure: only the events. */
const CLUBS_MIN = 10;
const PROCHAINS = 3;
const RELAIS = "Votre club ou votre association organise des matchs, des fêtes, des sorties\u00a0? rundata.re les affiche gratuitement, sur son site et dans les assistants IA comme ChatGPT, avec le nom de votre club. Quelques clics suffisent, sans compte\u00a0: https://rundata.re/associations?ref=asso-relais";

/** What the proof shows: the clubs read, their events in the coming two weeks, the first few. */
export interface Preuve {
  clubs: number;
  evenements: number;
  prochains: { e: Evenement; quand: string }[];
}

/**
 * The proof, from the agendas' last copies (the questions' bundle, and the scheduled event's for the agendas it alone
 * reads, as the agenda tool does), the proposed events read from the table when no copy has them yet. A club is a name
 * that publishes: each organiser of a proposed event, each club of an agenda; an agenda of clubs read without any event
 * yet counts once.
 */
export async function preuve(cache: Pick<Cache, "bundle">, now: Date): Promise<Preuve> {
  const [bundle, planned] = await Promise.all([cache.bundle(BUNDLE, BUNDLE_SYNC_SECONDS), planifiees(cache)]);
  const names = new Set<string>();
  const all: Evenement[] = [];
  let empty = 0;
  for (const agenda of AGENDAS.filter((a) => a.club)) {
    const hit = agenda.planifie ? copiePlanifiee(planned, agenda)?.value : (bundle.peek(`agenda:${agenda.id}`)?.value as Evenement[] | undefined);
    const list = hit ?? (agenda.id === PROPOSITIONS_ID && lisible() ? await proposes(now) : undefined);
    if (!list) continue;
    if (!list.length && agenda.id !== PROPOSITIONS_ID) empty++;
    // The members' sessions (Sportsregions' « Jeu libre », trainings) are not shown to the public: not counted either.
    const open = list.filter((e) => !e.reserve_adherents);
    for (const e of open) names.add(e.publie_par.trim().toLowerCase());
    all.push(...open);
  }
  const p = periode(undefined, now);
  const coming = all
    .map((e) => ({ e, seances: inPeriod(e, p, now) }))
    .filter((x) => x.seances.length)
    .sort((x, y) => x.seances[0].debut.localeCompare(y.seances[0].debut));
  return { clubs: names.size + empty, evenements: coming.length, prochains: coming.slice(0, PROCHAINS).map((x) => ({ e: x.e, quand: when(x.seances[0]) })) };
}

/** « Déjà lu » or « Pas lu », as on /publier. */
const etat = (lu: boolean) => (lu ? `<span class="etat lu">Déjà lu</span>` : `<span class="etat non">Pas lu</span>`);

/** The tools a club may already use (§3); « Déjà lu » only for what an agenda here reads. */
const OUTILS: { nom: string; faire: string; temps: string; lu: boolean }[] = [
  {
    nom: "Google Agenda",
    faire: `<ol><li>Créez un agenda à part pour vos événements publics.</li><li>Rendez-le public, avec tous les détails.</li><li>Copiez l'«\u00a0Adresse publique au format iCal\u00a0» et <a href="#lien">donnez-la-nous</a>.</li></ol><p><a href="/publier#google-agenda">Le pas à pas, avec les erreurs à éviter</a></p>`,
    temps: "10 min, une fois",
    lu: true,
  },
  {
    nom: "Outlook, iPhone, Nextcloud",
    faire: `<p>Publiez un calendrier à part et <a href="#lien">donnez-nous son lien ICS</a>. <a href="/publier#outlook-nextcloud">Le pas à pas</a></p>`,
    temps: "10 min, une fois",
    lu: true,
  },
  {
    nom: "OpenAgenda",
    faire: `<p>Proposez vos événements à l'agenda de votre commune ou de votre office de tourisme, s'il accepte les contributions. Vos dates apparaissent là où le public les cherche déjà, et chez nous. <a href="/publier#openagenda">Le pas à pas</a></p>`,
    temps: "5 min par événement",
    lu: true,
  },
  {
    nom: "Sportsregions (le site du club)",
    faire: `<p>Remplissez la rubrique <b>Événements</b> de votre site Sportsregions\u00a0: la date, l'heure et le champ «\u00a0Lieu de l'événement\u00a0». Laissez l'événement public. C'est tout\u00a0: rundata.re lit le calendrier Sportsregions Réunion plusieurs fois par jour. Les entraînements et créneaux réservés aux adhérents ne s'affichent pas pour le public. Votre événement n'apparaît pas sous 48\u00a0h\u00a0? Donnez-nous le lien de sa page avec le formulaire <a href="#lien">«\u00a0Nous donner votre lien\u00a0»</a>\u00a0: nous regardons pourquoi.</p>`,
    temps: "2 min par événement",
    lu: true,
  },
  {
    nom: "Facebook ou Instagram",
    faire: `<p>Nous ne pouvons pas lire Facebook ni Instagram. Gardez-les pour votre public, et <a href="${PROPOSER_PATH}">proposez chaque événement avec le formulaire</a>, en collant le lien de votre événement Facebook\u00a0: 2 minutes.</p>`,
    temps: "2 min par événement",
    lu: false,
  },
  {
    nom: "HelloAsso",
    faire: `<p><a href="${PROPOSER_PATH}">Proposez l'événement avec le formulaire</a> et collez le lien de votre billetterie HelloAsso\u00a0: on renvoie vers elle pour s'inscrire ou payer.</p>`,
    temps: "2 min par événement",
    lu: false,
  },
  {
    nom: "AssoConnect, Wix, e-monsite, Google Sites",
    faire: `<p><a href="${PROPOSER_PATH}">Proposez l'événement avec le formulaire</a> et collez le lien de votre page.</p>`,
    temps: "2 min par événement",
    lu: false,
  },
];

const REGLES = [
  "C'est gratuit à vie pour les associations à but non lucratif. Pas de compte à créer.",
  "Vos événements restent des données ouvertes (Licence Ouverte 2.0)\u00a0: tout le monde peut les réutiliser, en citant votre association.",
  "Nous ne reprenons que les faits (titre, date, lieu, prix) et une phrase, avec votre nom et votre lien.",
  "Jamais de téléphone personnel, de nom d'enfant ni d'adresse de domicile\u00a0: seulement ce qui irait sur votre affiche.",
  "Un événement est annulé ou faux\u00a0? Écrivez-nous, nous le retirons dans la journée.",
];

/** The three steps of the form, for search engines (HowTo). */
function howTo(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Proposer un événement sur rundata.re",
    totalTime: "PT2M",
    estimatedCost: { "@type": "MonetaryAmount", currency: "EUR", value: "0" },
    step: [
      { "@type": "HowToStep", position: 1, name: "Remplir le formulaire", text: "Titre, date, heure, lieu, commune, organisateur, une phrase et le prix, sans compte.", url: `${origin}${PROPOSER_PATH}` },
      { "@type": "HowToStep", position: 2, name: "Confirmer par e-mail", text: "Cliquer sur le lien reçu par e-mail pour confirmer l'événement." },
      { "@type": "HowToStep", position: 3, name: "Relecture et publication", text: "L'événement est relu, en général sous 24 heures, puis il s'affiche sur rundata.re et dans les assistants IA, avec le nom de l'association." },
    ],
  };
}

function preuveSection(p: Preuve): string {
  const count = p.clubs >= CLUBS_MIN
    ? `<p>${p.clubs} clubs et associations lus par rundata.re\u00a0; ${p.evenements} de leurs événements dans les deux prochaines semaines.</p>`
    : "";
  const list = p.prochains.length
    ? `<ul class="rows eau">${p.prochains.map(({ e, quand }) => `<li><span>${e.lien ? `<a href="${esc(e.lien)}" rel="noopener">${esc(e.titre)}</a>` : esc(e.titre)}<small>${[e.commune, e.publie_par].filter(Boolean).map((x) => esc(x!)).join(" · ")}</small></span><span>${esc(quand)}</span></li>`).join("")}</ul>`
    : `<p>Les premiers événements de clubs et d'associations arrivent\u00a0: <a href="${PROPOSER_PATH}">proposez le vôtre</a>.</p>`;
  return `<section aria-labelledby="h-preuve">
  <div class="sec-h"><p class="eyebrow">En direct</p><h2 id="h-preuve">Les prochains événements de clubs et d'associations</h2></div>
  ${count}
  <div class="card">${list}<p><a href="/evenements">Voir tous les événements</a></p></div>
  <p class="note">Sur chaque événement\u00a0: le nom de votre club ou de votre association, un lien vers votre page, et la date à laquelle nous l'avons lu ou à laquelle vous l'avez proposé.</p>
</section>`;
}

export function associationsPage(origin: string, p: Preuve, alerte?: Alerte): string {
  const band = `${crumbBar("Clubs et associations")}
<div class="wrap intro solo"><div class="pitch">
  <p class="pill"><span class="dot"></span>Gratuit, sans compte</p>
  <h1>${esc(H1)}</h1>
  <p class="lead">${esc(ESPRIT)}</p>
  <p class="slogan" lang="${brand.slogan_lang}">${esc(KREOL)}</p>
</div></div>`;
  const cards = OUTILS.map((o) => `<li class="card outil"><h3>${esc(o.nom)}</h3>
    <p class="aide">Ce qu'il faut faire</p>${o.faire}
    <p class="aide">Temps\u00a0: ${esc(o.temps)} · rundata.re\u00a0: ${etat(o.lu)}</p></li>`).join("\n  ");
  const body = `<section class="card proposer" aria-labelledby="h-proposer">
  <h2 id="h-proposer">Proposer un événement, en 2\u00a0minutes</h2>
  <p>Un match, une kermesse, une sortie, un concert\u00a0? Remplissez le formulaire, avec ou sans page Facebook, sans compte. Nous le relisons, puis il s'affiche sur rundata.re et dans les assistants IA, avec le nom de votre association.</p>
  <p><a class="btn sun" href="${PROPOSER_PATH}">Proposer un événement</a></p>
</section>
${connecteurs.enLigne() ? connecteurs.carte() : ""}
${preuveSection(p)}
<section aria-labelledby="h-outils">
  <div class="sec-h"><h2 id="h-outils">Votre club utilise déjà un agenda\u00a0?</h2><p>Pour ne plus rien saisir deux fois\u00a0: ce qu'il faut faire, selon l'outil.</p></div>
  <ul class="outils">
  ${cards}
  </ul>
</section>
${lienForm(PATH)}
<section aria-labelledby="h-propre">
  <div class="sec-h"><h2 id="h-propre">Vous voulez faire propre\u00a0?</h2>
  <p>Le guide complet montre comment publier vos événements en flux ouvert, lisible par rundata.re et par tous\u00a0: Google Agenda, OpenAgenda, WordPress, tableur, data.gouv.fr. <a href="/publier">Lire le guide</a></p></div>
</section>
<section aria-labelledby="h-regles">
  <div class="sec-h"><h2 id="h-regles">Les règles</h2></div>
  <ul class="card">${REGLES.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
  <p class="note">Les événements proposés, en données ouvertes\u00a0: <a href="${ICS_PATH}">agenda ICS</a> · <a href="${JSON_PATH}">JSON</a> (Licence Ouverte 2.0).</p>
</section>
<section aria-labelledby="h-relais">
  <div class="sec-h"><h2 id="h-relais">Faites passer</h2><p>Le texte à transmettre aux autres clubs et associations\u00a0:</p></div>
  <div class="card fo"><p id="relais">${esc(RELAIS)}</p>
  <p><button type="button" data-copy="relais">Copier le texte</button> <a class="sh wa" href="https://wa.me/?text=${encodeURIComponent(RELAIS)}" target="_blank" rel="noopener">Partager sur WhatsApp</a></p></div>
</section>
<p>Une question\u00a0? <a href="mailto:contact@rundata.re">contact@rundata.re</a></p>
${TURNSTILE_SCRIPT}`;
  return layout(origin, { title: TITLE, description: META, path: PATH, jsonld: [crumbs(origin, "Clubs et associations", PATH), webPage(origin, PATH, TITLE, META, null), howTo(origin)], alerte, sansPartage: true }, band, body);
}
