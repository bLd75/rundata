/**
 * /alerte-cyclone: what the prefecture's plan (dispositif spécifique ORSEC Cyclones, arrêté 2026-182) says of daily
 * life at each step of the cyclone alert, quoted page by page, under the alert in force (as /ecoles-cyclone reads it).
 * Only the plan's words: where it says nothing (the buses, the shops), nothing is filled in. Worded by marketing.
 */
import type { Cached } from "../cache.js";
import type { Cyclone } from "../providers/prefecture.js";
import * as mf from "../providers/vigilance.js";
import { ecoles, ORSEC, withPrefecture } from "../tools/ecoles.js";
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { citesHtml } from "./ecoles.js";
import { esc } from "./map.js";
import { layout, officielHtml } from "./pages.js";

export const TITLE = "Alerte cyclone orange, rouge : ce qui change · Réunion 974";
const H1 = "Alerte cyclonique : ce qui ferme, ce qui continue";
const META = "Alerte orange, rouge ou violette à La Réunion : travail, écoles, marchés, circulation, ce que prévoit le plan ORSEC Cyclones de la préfecture.";
const LEAD = "Ce que prévoit le dispositif ORSEC Cyclones de la préfecture (arrêté 2026-182) à chaque niveau d'alerte, cité page par page. Seuls les communiqués de la préfecture disent le niveau en cours et les décisions du moment.";
/** The plan itself, its pages addressed by `#page=`. */
export const PDF = "https://www.reunion.gouv.fr/contenu/telechargement/51165/386323/file/2026%2002%2010%20DSO%20Cyclones%20VD.pdf";
const NONE = "Pas d'alerte cyclonique en cours à La Réunion.";

/** A quotation of the plan, or a line about it, and the page(s) it is on. */
export type Line = { sujet: string; texte: string; pages: number[]; cite?: boolean; lien?: { href: string; label: string } };
interface Step {
  id: string;
  titre: string;
  devise?: string;
  code?: number;
  lignes: Line[];
}

// In the pré-alerte, the step's line and the state point to /kit-cyclone (marketing).
const KIT = "Le kit d'urgence du plan →";
export const q = (sujet: string, texte: string, ...pages: number[]): Line => ({ sujet, texte, pages, cite: true });

/** The plan, step by step, as marketing laid it out; each quotation as the PDF writes it. */
export const STEPS: Step[] = [
  {
    id: "pre-alerte",
    titre: "Pré-alerte",
    devise: "Je m'informe et j'anticipe",
    code: 2,
    lignes: [
      { ...q("Ce que fait la population", "Suivez les prévisions météorologiques et les bulletins d'information.", 17), lien: { href: "/kit-cyclone", label: KIT } },
      q("Entreprises et services", "La plupart des mesures à appliquer en pré-alerte cyclonique relève de la même logique que celles qui s'appliquent à la population", 18),
      { sujet: "Écoles et crèches", texte: "c'est en alerte orange que « Tous les établissements scolaires et les crèches ferment »", pages: [17] },
    ],
  },
  {
    id: "orange",
    titre: "Alerte orange",
    devise: "Je m'organise pour être bien protégé",
    code: 3,
    lignes: [
      q("Travail et entreprises", "l'activité économique continue", 17),
      q("Travail et entreprises", "Ces activités et la vie professionnelle ne sont pas interrompues. Néanmoins, les employeurs sont invités à limiter autant que possible les déplacements de leurs collaborateurs et salariés.", 20),
      q("Chantiers", "le secteur du « bâtiment et des travaux publics » devra veiller à sécuriser les chantiers et les matériels (grues et échafaudages notamment)", 20),
      { ...q("Écoles et crèches", "Tous les établissements scolaires et les crèches ferment", 17), lien: { href: "/ecoles-cyclone", label: "Le détail : école fermée ? →" } },
      q("Petite enfance", "Les établissements cessent leurs activités.", 20),
      q("Marchés, manifestations, événements sportifs", "Elles ne peuvent pas se tenir (sauf cas particulier si l'organisation est compatible avec le calendrier de l'alerte cyclonique).", 20),
      q("Centres d'hébergement", "Installés durant l'alerte orange, ils doivent être en service dès le préavis (3 h) de l'alerte rouge.", 24),
      { sujet: "FR-Alert", texte: "Des messages FR-Alert peuvent être envoyés sur les téléphones, à la demande du préfet", pages: [22] },
    ],
  },
  {
    id: "rouge",
    titre: "Alerte rouge",
    devise: "Je me confine pour ne courir aucun risque",
    code: 4,
    lignes: [
      q(
        "Travail et entreprises",
        "Les activités cessent. Tous les établissements recevant du public ferment. Les personnels disposent du préavis de 3 h avant l'alerte rouge pour regagner leur domicile. Exceptions : les activités nécessaires à la continuité des fonctions essentielles (gestion de crise, établissement de santé, énergie, communication, etc.) ainsi que les lieux d'hébergement touristiques (hôtels, centres de vacances, etc.).",
        20,
        21,
      ),
      { ...q("Écoles et crèches", "Les établissements restent fermés.", 19), lien: { href: "/ecoles-cyclone", label: "Le détail : école fermée ? →" } },
      q("Enseignement supérieur", "Ils ferment dès l'annonce de l'Alerte Rouge cyclonique (préavis de 3h).", 19),
      q("Petite enfance", "Ils restent fermés.", 20),
      q("Marchés, manifestations, événements sportifs", "Interdites", 20),
      q("Circulation", "Le passage en alerte rouge cyclonique est annoncé avec un préavis de 3 heures", 17),
      q("Circulation", "Profitez de ce préavis pour rejoindre votre domicile ou vous mettre à l'abri", 17),
      q("Circulation", "Passé ce délai, la circulation est strictement interdite", 17),
      q("Centres d'hébergement", "Ils restent ouverts.", 24),
    ],
  },
  {
    id: "violette",
    titre: "Alerte violette",
    devise: "Je reste confiné",
    code: 5,
    lignes: [
      q("Circulation", "Le passage en alerte violette cyclonique est annoncé avec un préavis de 3 heures", 17),
      q("Circulation", "RESTEZ CONFINE", 17),
      q("Circulation", "NE SORTEZ EN AUCUN CAS", 17),
      q("Ensuite", "L'alerte violette sera suivie d'une phase d'alerte rouge", 17),
      { ...q("Écoles et crèches", "Les établissements restent fermés.", 19), lien: { href: "/ecoles-cyclone", label: "Le détail : école fermée ? →" } },
    ],
  },
  {
    id: "sauvegarde",
    titre: "Phase de sauvegarde",
    devise: "Je me tiens informé des consignes",
    code: 6,
    lignes: [
      q("Ce que c'est", "Phase à part entière du plan ORSEC, la « phase de sauvegarde » est la phase qui suit immédiatement la fin de l'alerte rouge.", 32),
      q("Travail et entreprises", "Les activités professionnelles peuvent reprendre progressivement.", 20),
      { ...q("Écoles et crèches", "Lors du passage en phase de sauvegarde, ils restent fermés. Cette phase doit permettre de les contrôler et si besoin de les remettre en état. La réouverture est décidée quand les conditions d'accueil sont satisfaisantes.", 19, 20), lien: { href: "/ecoles-cyclone", label: "Le détail : école fermée ? →" } },
      q("Marchés, manifestations, événements sportifs", "Reprise ou organisation à valider en fonction des possibilités matérielles et humaines.", 20),
      q("Circulation", "Les modalités de circulation pourront être différentes suivant les zones de l'île et la réalité des conditions météorologiques enregistrées.", 17),
      q("Circulation", "Une interdiction partielle (voire totale) de circuler en véhicules peut être décidée en cas de besoin.", 17),
      q("Centres d'hébergement", "Ils continuent à fonctionner tant que les personnes accueillis n'ont pas la capacité de rejoindre leur domicile et que des dispositifs alternatifs n'ont pas pu leur être proposés. La fermeture est décidée par le maire.", 24),
      q("Consignes de la préfecture", "La population est invitée à limiter ses déplacements en véhicules au strict nécessaire.", 18),
      q("Consignes de la préfecture", "Ne pas s'aventurer sur les radiers submergés, ni dans les ravines et les lits des rivières en crue.", 18),
      q("Consignes de la préfecture", "Vérifier la qualité de l'eau du robinet avant de la consommer ainsi que les aliments du réfrigérateur. Ne pas oublier que l'eau du robinet peut rester impropre à la consommation plusieurs jours après l'arrêt des pluies. En conséquence, il est impératif de la faire bouillir pendant 3 minutes avant de la boire.", 18),
      q("Consignes de la préfecture", "Si elles ne sont pas coupées, ne pas encombrer les lignes téléphoniques sauf urgence.", 18),
    ],
  },
  {
    id: "fin",
    titre: "Fin de l'alerte",
    lignes: [q("Qui décide", "La fin d'alerte est décidée par le préfet et fait l'objet d'un communiqué diffusé à tous les médias.", 18)],
  },
];

export const FAQ: { q: string; a: Line[] }[] = [
  { q: "Doit-on aller travailler en alerte orange ?", a: [STEPS[1].lignes[0], STEPS[1].lignes[1]] },
  {
    q: "Les bus roulent-ils pendant une alerte cyclonique ?",
    a: [
      { sujet: "", texte: "Le plan ORSEC ne parle pas des bus. En alerte rouge, « la circulation est strictement interdite »", pages: [17] },
      { sujet: "", texte: "Pour votre ligne, suivez les annonces de votre réseau de bus.", pages: [] },
    ],
  },
  { q: "Les magasins sont-ils ouverts en alerte rouge ?", a: [{ sujet: "", texte: "Le plan ne parle pas des commerces en particulier. En alerte rouge, « tous les établissements recevant du public ferment »", pages: [20] }] },
  {
    q: "Quelle différence entre alerte rouge et violette ?",
    a: [
      { sujet: "", texte: "Alerte rouge : « Je me confine pour ne courir aucun risque » ; alerte violette : « Je reste confiné ».", pages: [17] },
      q("", "L'alerte violette sera suivie d'une phase d'alerte rouge", 17),
    ],
  },
];

const pagesHtml = (pages: number[]) =>
  pages.length ? ` <span class="note">(<a href="${PDF}#page=${pages[0]}" rel="noopener">p. ${pages.join("-")}</a>)</span>` : "";
export function lineHtml(l: Line): string {
  const text = l.cite ? `« ${esc(l.texte)} »` : esc(l.texte);
  return `<li>${l.sujet ? `<b>${esc(l.sujet)}</b> : ` : ""}${text}${pagesHtml(l.pages)}${l.lien ? ` <a href="${l.lien.href}">${esc(l.lien.label)}</a>` : ""}</li>`;
}

type State = { texte: string; ancre?: string; label?: string; cites?: { titre: string; lien: string }[] };
const THIS_STEP = "Ce que prévoit ce niveau ↓";

/**
 * The step in force, or announced, as /ecoles-cyclone reads it; the sentence and its anchor. The end of the alert in
 * #133's sentences when a release of the prefecture says it; the phase de sauvegarde, not the end, while the bulletin
 * gives it (marketing).
 */
function stateOf(v: mf.Vigilance | undefined, now: Date, decision?: Cyclone | null): State | undefined {
  if (!v) return undefined;
  const e = withPrefecture(ecoles(v, now), decision, v, now);
  if (e.etat === "levee") return { texte: e.cites ? e.texte : "Alerte levée (bulletin de Météo-France).", ancre: "fin", label: "Ce que prévoit la fin d'alerte ↓", cites: e.cites };
  if (e.niveau < 2) return { texte: NONE };
  const step = STEPS.find((s) => s.code === e.niveau);
  return { texte: e.depuis ?? `${step?.titre ?? mf.cycloneName(e.niveau)} en vigueur à La Réunion (bulletin de Météo-France).`, ancre: step?.id, label: THIS_STEP };
}

/** `rubrique`: the cyclone's section of the prefecture not read (providers/prefecture.ts, rubriqueNonLue). */
export function alertePage(origin: string, data: Cached<mf.Vigilance> | null, now = new Date(), alerte?: Alerte, decision?: Cyclone | null, rubrique?: string): string {
  const path = "/alerte-cyclone";
  const s = stateOf(data?.value, now, decision);
  const state = s
    ? `<div class="status"><p class="lead"><b>${citesHtml(esc(s.texte), s.cites)}</b>${s.ancre ? ` <a href="#${s.ancre}">${esc(s.label!)}</a>` : ""}${s.ancre === "pre-alerte" ? ` · <a href="/kit-cyclone">${esc(KIT)}</a>` : ""}</p>${rubrique ? `<p class="lead">${esc(rubrique)}</p>` : ""}</div>`
    : `<div class="status"><p class="lead">L'alerte en vigueur n'a pas pu être lue à l'instant : voir la préfecture (reunion.gouv.fr) et Météo-France.</p></div>`;
  const band = `${crumbBar("Alerte cyclonique")}
<div class="wrap intro"><div class="pitch">
  <p class="pill"><span class="dot"></span>Plan ORSEC Cyclones</p>
  <h1>${esc(H1)}</h1>
  <p class="lead">${esc(LEAD)}</p>
  ${state}
  <p class="lead">${officielHtml(mf.OFFICIEL_CYCLONE)}</p>
</div></div>`;
  const steps = STEPS.map((st) => `<section id="${st.id}" aria-labelledby="h-${st.id}">
  <div class="sec-h"><h2 id="h-${st.id}">${esc(st.titre)}</h2>${st.devise ? `<p>« ${esc(st.devise)} »</p>` : ""}</div>
  <div class="card"><ul class="plain">${st.lignes.map(lineHtml).join("")}</ul></div>
</section>`).join("\n");
  const vital = `<section aria-labelledby="h-vital"><div class="card"><h2 id="h-vital">Personnes à haut risque vital</h2>
  <p>Dialyse, respirateur : le plan prévoit des mesures à chaque niveau <span class="note">(p. 24-25)</span> <a href="${PDF}#page=24" rel="noopener">→ PDF</a></p></div></section>`;
  const faq = `<section aria-labelledby="h-faq"><div class="sec-h"><h2 id="h-faq">Questions fréquentes</h2></div>
${FAQ.map((f) => `<div class="card"><h3>${esc(f.q)}</h3><ul class="plain">${f.a.map(lineHtml).join("")}</ul></div>`).join("\n")}
</section>`;
  const foot = `<section><p class="note">Résumé du <a href="${ORSEC.lien}" rel="noopener">dispositif ORSEC Cyclones</a> (arrêté préfectoral 2026-182, document mis à jour le ${esc(ORSEC.mis_a_jour)}), avec le lien vers reunion.gouv.fr. rundata.re n'ajoute aucune consigne.</p>
<p><a href="/ecoles-cyclone">Cyclone : les écoles sont-elles fermées ? →</a> · <a href="/cyclones">Les cyclones du bassin →</a> · <a href="/vigilance">La vigilance zone par zone →</a> · <a href="/crues">Les rivières, station par station →</a></p></section>`;
  const body = `${steps}\n${vital}\n${faq}\n${foot}`;
  return layout(origin, { title: TITLE, description: META, path, jsonld: [crumbs(origin, "Alerte cyclonique", path), webPage(origin, path, TITLE, META, data)], alerte }, band, body);
}
