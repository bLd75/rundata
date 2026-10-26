import { type Autorisation, MEDIAS, nonAutorisee, nonAutorisees, nonReprises, type SourceNonReprise } from "../providers/autorisations.js";
import { a as aLieu, de, enumeration } from "./format.js";

/**
 * What is said instead of a source not read until it agrees (src/providers/autorisations.ts), in marketing's words
 * (projects/rundata/marketing/communes-mention-288.md): one commune's, then the whole island's in one block. The day it
 * was asked, or refused, only once known; nothing said of a request before it has gone.
 */

const dayMonth = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
// The notices of power cuts are still on the commune's site, where its people look: said, with no link.
const still = (au: Autorisation, many = false) => (au.publie === "avis de coupure d'électricité" ? ` ${many ? "Ils restent consultables sur leurs sites." : "Ils restent consultables sur son site."}` : "");

/** One commune's source of that kind (`agenda`, `courant`): undefined once it agreed, or for a source never asked. */
export function mention(famille: string, commune: string | undefined): string | undefined {
  const au = nonAutorisee(famille, commune);
  return au && phrase(au);
}

function phrase(au: Autorisation): string {
  const its = `les ${au.publie} qu'elle y publie`;
  if (au.etat === "refusee") return `La commune ${de(au.commune)} a refusé${au.refusee_le ? `, le ${dayMonth(au.refusee_le)},` : ""} que rundata.re reprenne le contenu de son site : ${its} ne s'affichent donc pas ici.${still(au)}`;
  const first = `Les mentions légales du site de la commune ${de(au.commune)} interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas ${its}.${still(au)}`;
  return au.etat === "demandee" ? `${first} Nous lui avons demandé cet accord${au.demandee_le ? ` le ${dayMonth(au.demandee_le)}` : ""} et attendons sa réponse.` : first;
}

/**
 * The accord asked of those of a block, in one sentence after it (marketing, 26/10): the day once when all were asked
 * that day; otherwise the ones asked, in the block's order, after their day, or before each day from the oldest.
 */
function demandees<T extends { etat: string; demandee_le?: string }>(waiting: T[], to: (x: T) => string): string {
  const asked = waiting.filter((x) => x.etat === "demandee");
  const days = [...new Set(asked.map((x) => x.demandee_le ?? ""))].sort();
  const on = (day: string) => (day ? ` le ${dayMonth(day)}` : "");
  if (!asked.length) return "";
  if (asked.length === waiting.length && days.length === 1) return ` Nous leur avons demandé cet accord${on(days[0])} et attendons leur réponse.`;
  const whom = days.length === 1
    ? `${on(days[0])} ${enumeration(asked.map(to))}`
    : ` ${enumeration(days.map((d) => `${enumeration(asked.filter((x) => (x.demandee_le ?? "") === d).map(to))}${on(d)}`))}`;
  return ` Nous avons demandé cet accord${whom}${asked.length > 1 ? "," : ""} et attendons ${asked.length > 1 ? "leur" : "sa"} réponse.`;
}

/** The same for the whole island: one block for the communes still waiting, with those asked, then a line for each one that refused. */
export function mentionIle(famille: string): string[] {
  const waiting = nonAutorisees(famille).filter((a) => a.etat !== "refusee");
  const refused = nonAutorisees(famille).filter((a) => a.etat === "refusee");
  const lines: string[] = [];
  if (waiting.length === 1) lines.push(phrase(waiting[0]));
  else if (waiting.length) {
    const kinds = (["événements", "actualités", "avis de coupure d'électricité"] as const).filter((k) => waiting.some((a) => a.publie.includes(k))).join(" et ");
    lines.push(`Les mentions légales des sites de ${waiting.length} communes interdisent d'en reprendre le contenu sans leur accord : ${enumeration(waiting.map((a) => a.commune))}. rundata.re n'affiche donc pas les ${kinds} qu'elles y publient.${still(waiting[0], true)}` +
      demandees(waiting, (a) => aLieu(a.commune)));
  }
  return [...lines, ...refused.map(phrase)];
}

// ---------------------------------------------------------------- a medium not read

// Réunion La 1ère (src/providers/autorisations.ts, MEDIAS), in marketing's words (projects/rundata/marketing/
// la1ere-non-reprise.md): France Télévisions named, never a journalist; a plain space before « : » in the tools, a
// non-breaking one on the pages. Nothing said of a request before one has gone.
const LA1ERE = MEDIAS["media:la1ere"];
const TERMS = `les conditions d'utilisation des sites de France Télévisions, lues le ${dayMonth(LA1ERE.lues_le)}, interdisent d'en reprendre le contenu par un programme sans son accord écrit, titres compris`;
const asked = () => (LA1ERE.etat === "demandee" && LA1ERE.demandee_le ? ` Nous lui avons demandé cet accord le ${dayMonth(LA1ERE.demandee_le)} et attendons sa réponse.` : "");

/** The tools' line (`non_repris`): for the news, or for the sport news. */
export function mentionLa1ere(famille: "actualites" | "sport"): string {
  const what = famille === "actualites"
    ? `les informations de Réunion La 1ère. Elles restent sur son site, ${LA1ERE.site}.`
    : `l'actualité sportive de Réunion La 1ère, dont le football. Elle reste sur son site, ${LA1ERE.site_sport}.`;
  return `L${TERMS.slice(1)} : rundata.re n'affiche donc pas ${what}${asked()}`;
}

/** The pages' note under the sources (/actualites, /sport), in HTML. */
export function noteLa1ere(famille: "actualites" | "sport"): string {
  const site = (href: string) => `<a href="${href}" rel="noopener">la1ere.franceinfo.fr</a>`;
  return famille === "actualites"
    ? `Réunion La 1ère n'est pas reprise ici\u00a0: ${TERMS}. Ses informations sont sur ${site(LA1ERE.site)}.${asked()}`
    : `L'actualité sportive de Réunion La 1ère n'est pas reprise ici\u00a0: ${TERMS}. Elle est sur ${site(LA1ERE.site_sport!)}.${asked()}`;
}

/** Its entry in sources_donnees: since the day its reading stopped. */
export const FICHE_LA1ERE = {
  nom: "Réunion La 1ère (France Télévisions)",
  statut: "non reprise",
  texte: `Non reprise depuis le ${dayMonth(LA1ERE.non_lue_depuis)} : les conditions d'utilisation des sites de France Télévisions (art. 13.2) interdisent tout accès automatisé pour en extraire ou en réutiliser le contenu, métadonnées et titres compris, sans son accord écrit. Ses informations, dont le sport, sont sur ${LA1ERE.site}.`,
  conditions: LA1ERE.conditions,
};

export { dayMonth };

// ---------------------------------------------------------------- reunion.fr's agenda, not read

// The tourist board's site (src/providers/autorisations.ts, MEDIAS), in marketing's words (projects/rundata/marketing/
// reunion-fr-et-nuages.md): Île de La Réunion Tourisme, whose site it is, and the Comité Réunionnais du Tourisme, whom
// its terms name. Nothing said of its agenda's state there, only the link; nothing of a request before one has gone.
const REUNION_FR = MEDIAS["site:reunion_fr"];
const TERMS_IRT = `es mentions légales de reunion.fr, le site d'Île de La Réunion Tourisme, lues le ${dayMonth(REUNION_FR.lues_le)}, interdisent d'en reprendre le contenu sans l'accord écrit du Comité Réunionnais du Tourisme`;
const askedIrt = () => (REUNION_FR.etat !== "demandee" ? "" : ` Nous lui avons demandé cet accord${REUNION_FR.demandee_le ? ` le ${dayMonth(REUNION_FR.demandee_le)}` : ""} et attendons sa réponse.`);

/** The tools' line (`non_repris` of evenements): for the whole island, or the big fêtes and festivals. */
export const mentionReunionFr = () => `L${TERMS_IRT} : rundata.re n'affiche donc pas l'agenda touristique du site.${askedIrt()} Son adresse : ${REUNION_FR.site}.`;

/** The page's note under the sources (/evenements), in HTML. */
export const noteReunionFr = () =>
  `L${TERMS_IRT} : rundata.re n'affiche donc pas l'agenda touristique du site.${askedIrt()} <a href="${REUNION_FR.site}" rel="noopener">Son agenda sur reunion.fr ↗</a>`;

/** In the tool's summary, between « ; ». */
export const RESUME_REUNION_FR = "agenda touristique de reunion.fr non repris, ses mentions légales l'interdisent sans accord écrit (voir non_repris)";

/** Its entry in sources_donnees: since the day its reading stopped. */
export const FICHE_REUNION_FR = {
  nom: "Agenda de reunion.fr (Île de La Réunion Tourisme)",
  statut: "non repris",
  texte: `Non repris depuis le ${dayMonth(REUNION_FR.non_lue_depuis)} : les mentions légales de reunion.fr, lues le ${dayMonth(REUNION_FR.lues_le)}, interdisent toute reprise du site ou de ses éléments sans l'autorisation écrite et préalable du Comité Réunionnais du Tourisme.`,
  conditions: REUNION_FR.conditions,
};

// ---------------------------------------------------------------- the halls and the sports sites, not read

// The communes' words (above), for a hall or a sports site (src/providers/autorisations.ts, NON_REPRISES), in marketing's
// words (projects/rundata/marketing, 26/10): one site alone, or several in one block, each with its article.
const upper = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

function phraseNonReprise(x: SourceNonReprise): string {
  if (x.etat === "refusee") {
    return `${upper(x.cite)} a refusé${x.refusee_le ? `, le ${dayMonth(x.refusee_le)},` : ""} que rundata.re reprenne le contenu de son site : ${x.publie} ${x.publie.startsWith("les ") ? "ne s'affichent" : "ne s'affiche"} donc pas ici.`;
  }
  const first = `Les ${x.textes} ${x.du_site} interdisent ${x.interdit ?? "d'en reprendre le contenu sans son accord"} : rundata.re n'affiche donc pas ${x.publie}.`;
  return x.etat === "demandee" ? `${first} Nous lui avons demandé cet accord${x.demandee_le ? ` le ${dayMonth(x.demandee_le)}` : ""} et attendons sa réponse.` : first;
}

// « au TÉAT », « à la Cité des Arts », « à Bisik »: its short name when its citation has more.
const aSite = (x: SourceNonReprise) => (x.court ?? x.cite).replace(/^le /, "au ").replace(/^les /, "aux ").replace(/^(?!au |aux )/, "à ");

/** Several sites in one block for those still waiting, with those asked, then a line for each one that refused; one site alone, its own line. */
function bloc(sites: SourceNonReprise[], groupe: (waiting: SourceNonReprise[]) => string): string[] {
  const waiting = sites.filter((x) => x.etat !== "refusee");
  const lines: string[] = [];
  if (waiting.length === 1) lines.push(phraseNonReprise(waiting[0]));
  else if (waiting.length) lines.push(groupe(waiting) + demandees(waiting, aSite));
  return [...lines, ...sites.filter((x) => x.etat === "refusee").map(phraseNonReprise)];
}

/** The halls not read, for the whole island or a commune's. */
export function mentionSalles(commune?: string): string[] {
  return bloc(nonReprises("salle").filter((x) => !commune || x.communes?.includes(commune)), (w) =>
    `Les mentions légales des sites de ${w.length} salles interdisent d'en reprendre le contenu sans accord : ${enumeration(w.map((x) => x.cite))}. rundata.re n'affiche donc pas leurs programmes.`);
}

/** The sports sites not read: the federations of the sports asked (all of them when undefined), the clubs' calendar when `clubs`. */
export function mentionSports(sports: string[] | undefined, clubs: boolean): string[] {
  return bloc(nonReprises("sport").filter((x) => (x.sport ? !sports || sports.includes(x.sport) : clubs)), (w) => {
    const textes = new Set(w.map((x) => x.textes));
    return `${textes.size > 1 ? "Les conditions d'utilisation ou les mentions légales" : `Les ${[...textes][0]}`} de ${w.length} sites interdisent d'en reprendre le contenu sans leur accord : ` +
      `${enumeration(w.map((x) => `${x.cite} (${x.publie})`))}. rundata.re n'affiche donc pas ces rendez-vous.`;
  });
}

/** Their entries in sources_donnees, beside the media not read: each one's own line. */
export const fichesNonReprises = () =>
  [...nonReprises("salle"), ...nonReprises("sport")].map((x) => ({ nom: x.nom, statut: "non repris", texte: phraseNonReprise(x), conditions: x.conditions }));
