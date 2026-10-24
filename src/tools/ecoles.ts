/**
 * What the cyclone alert in force means for the crèches, the schools and the universities, as the prefecture's
 * plan says it (dispositif spécifique ORSEC Cyclones, arrêté 2026-182: table §1.2 p. 9, établissements §4.3 p. 19),
 * in marketing's words. Only the alert Météo-France publishes is read: never « ouvertes », never one school.
 */
import { localTime } from "../geo.js";
import * as mf from "../providers/vigilance.js";
import { current } from "./vigilance.js";

export const ORSEC = {
  nom: "dispositif ORSEC Cyclones (arrêté 2026-182)",
  lien: "https://www.reunion.gouv.fr/Actions-de-l-Etat/Securite-protection-des-personnes-et-des-biens/Protection-civile/Les-plans-de-secours/La-planification-ORSEC/Le-risque-cyclonique/DSO-Cyclones",
  mis_a_jour: "10/03/2026",
};
export const RECTORAT = "https://www.ac-reunion.fr";

/** The plan's rule, said under the state on the page and in the tool. */
export const REGLE = [
  "Alerte orange (danger dans les 24 h) : crèches, écoles, collèges et lycées fermés dans tout le département. Annoncée avant l'ouverture : pas de ramassage scolaire, les établissements n'ouvrent pas. Pendant les cours : les élèves rentrent chez eux selon le plan d'évacuation.",
  "Alerte rouge ou violette : tout reste fermé. Universités et enseignement supérieur : fermés dès l'annonce de l'alerte rouge (préavis de 3 h).",
  "Phase de sauvegarde : fermés pendant le passage du cyclone ; la réouverture est décidée quand les conditions d'accueil sont réunies.",
  "Accueils de loisirs pour mineurs : pendant les périodes scolaires, ils suivent les écoles.",
];
export const SOURCE_PHRASE = `D'après le dispositif ORSEC Cyclones de la préfecture (arrêté 2026-182, page mise à jour le ${ORSEC.mis_a_jour}). Les annonces du jour viennent de la préfecture et du rectorat (ac-reunion.fr).`;
export const LIMITE = "Cette page ne parle que des cyclones. Une fermeture pour fortes pluies, une grève ou une décision du maire est annoncée par le rectorat ou votre commune.";

export type Etat = "aucune" | "pre_alerte" | "orange_avant_ouverture" | "orange_en_journee" | "rouge" | "violette" | "sauvegarde" | "levee";

const STATES: Record<Exclude<Etat, "aucune" | "levee">, string> = {
  pre_alerte: "Pré-alerte cyclonique : le dispositif ne prévoit pas de fermeture à ce stade. C'est l'alerte orange qui ferme les crèches et les établissements scolaires de toute l'île",
  orange_avant_ouverture: "Alerte orange annoncée avant l'ouverture des écoles : pas de ramassage scolaire, et les crèches, écoles, collèges et lycées n'ouvrent pas",
  orange_en_journee: "Alerte orange : crèches, écoles, collèges et lycées fermés dans toute l'île ; les élèves déjà en classe, internes compris, rentrent chez eux selon le plan d'évacuation de leur établissement",
  rouge: "Alerte rouge : crèches, écoles, collèges, lycées et universités fermés",
  violette: "Alerte violette : crèches, écoles, collèges, lycées et universités fermés",
  sauvegarde: "Phase de sauvegarde : les établissements restent fermés pendant le passage du cyclone ; la réouverture sera décidée quand les conditions d'accueil le permettront",
};
const NONE = "Pas d'alerte cyclonique en cours à La Réunion.";
const LIFTED = "Alerte levée. La réouverture des écoles est annoncée par la préfecture et le rectorat (ac-reunion.fr) : elle n'est pas encore lue ici.";
// Where the alert is read, said after its date (marketing): « (communiqué de la préfecture) » the day it is read there.
const BULLETIN = "bulletin de Météo-France";
// The step's name in « … décidée par la préfecture … ».
const NAMES: Record<number, string> = { 2: "Pré-alerte cyclonique", 3: "Alerte orange", 4: "Alerte rouge", 5: "Alerte violette", 6: "Phase de sauvegarde" };
const BY_CODE: Record<number, Etat> = { 2: "pre_alerte", 4: "rouge", 5: "violette", 6: "sauvegarde" };

const WEEKDAY = new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" });
const localDay = (d: Date) => new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
const localHour = (d: Date) => new Date(d.getTime() + 4 * 3600_000).getUTCHours();
/** « samedi 24/10 à 19:00 ». */
const when = (iso: string) => {
  const d = new Date(iso);
  return `${WEEKDAY.format(new Date(d.getTime() + 4 * 3600_000))} ${localTime(d).replace(" ", " à ")}`;
};
// The hours of a school day, local time: an orange alert starting within them sends the pupils home.
const OPENS = 7;
const CLOSES = 17;

export interface EcolesAnswer {
  etat: Etat;
  /** Marketing's sentence for the state, its source in `selon` (all but « levée »). */
  texte: string;
  selon?: { nom: string; lien: string };
  /**
   * « Alerte orange décidée par la préfecture, en vigueur depuis le samedi 24/10 à 19:00 (bulletin de Météo-France). »,
   * when the bulletin shows the change: the prefect decides, Météo-France publishes, and we read the bulletin.
   */
  depuis?: string;
  /** The bulletin `depuis` names, for its link. */
  bulletin?: string;
  /** Crèches and schools closed by the plan right now (orange or beyond, in force). */
  fermees: boolean;
  /** The step, by its code (providers/vigilance.ts), -1 without any. */
  niveau: number;
}

/**
 * The state of the alert for the schools. The day and hour only when the bulletin shows the change (a period starting
 * after the first one of its 24 h): before that, Météo-France gives no start, only « in force ».
 */
export function ecoles(v: mf.Vigilance, now: Date): EcolesAnswer {
  const periods = v.zones[mf.ISLAND]?.[mf.CYCLONE] ?? [];
  const t = now.toISOString();
  const cur = current(periods, now);
  const held = cur >= 2 ? periods.find((p) => p.couleur === cur && p.debut <= t && (!p.fin || t < p.fin)) : undefined;
  // An orange alert (or worse) announced for later says more to the schools than the pré-alerte in force.
  const announced = periods.find((p) => p.debut > t && (held ? held.couleur === 2 && p.couleur >= 3 && p.couleur <= 5 : p.couleur >= 2));
  const inForce = Boolean(held) && !announced;
  const period = announced ?? held;
  if (!period) {
    const lifted = periods.some((p) => p.couleur >= 2 && p.fin && p.fin <= t);
    return lifted ? { etat: "levee", texte: LIFTED, fermees: false, niveau: -1 } : { etat: "aucune", texte: NONE, fermees: false, niveau: -1 };
  }
  const c = period.couleur;
  let etat = BY_CODE[c];
  if (c === 3) {
    // Started (or to start) within a school day's hours, and still that day: the pupils in class go home.
    const start = new Date(period.debut);
    const h = localHour(start);
    etat = h >= OPENS && h < CLOSES && localDay(start) === localDay(now) && localHour(now) < CLOSES + 1 ? "orange_en_journee" : "orange_avant_ouverture";
  }
  if (!etat) return { etat: "aucune", texte: NONE, fermees: false, niveau: -1 };
  const shown = period !== periods[0] || !inForce;
  const name = NAMES[c];
  return {
    etat,
    texte: `${STATES[etat as keyof typeof STATES]}, selon le ${ORSEC.nom}.`,
    selon: ORSEC,
    depuis: shown ? (inForce ? `${name} décidée par la préfecture, en vigueur depuis le ${when(period.debut)} (${BULLETIN}).` : `${name} décidée par la préfecture pour le ${when(period.debut)} (${BULLETIN}).`) : undefined,
    bulletin: shown ? mf.SOURCE.url : undefined,
    fermees: inForce && c >= 3,
    niveau: c,
  };
}

/** resume_du_jour's line, only while the schools are closed by the plan. */
export function resumeLine(e: EcolesAnswer): string | undefined {
  if (!e.fermees) return undefined;
  const step = e.niveau === 6 ? "phase de sauvegarde cyclonique" : `alerte ${mf.cycloneName(e.niveau)} cyclonique`;
  return `Crèches, écoles, collèges et lycées fermés (${step}), selon le ${ORSEC.nom}.`;
}

/** What the tools add: the state, the rule and where the day's announcements come from. */
export function ecolesBlock(v: mf.Vigilance, now: Date) {
  const e = ecoles(v, now);
  return { ...e, regle: REGLE, source: SOURCE_PHRASE, limite: LIMITE, page: "https://rundata.re/ecoles-cyclone", rectorat: RECTORAT };
}
