/**
 * What the server can do, and what changed lately, said in the answers themselves. A client may keep its list of
 * tools and the server's instructions for hours (Claude.ai kept one two hours old, across conversations), while
 * every answer is fresh: each one carries a short `serveur` block with the newest tools (server.ts), and
 * sources_donnees the whole list and the latest changes. The model can then see that its list is old, and say so.
 *
 * Kept by hand: one line per tool, with the day it went online; one line per change people can notice.
 */
import { localTime } from "./geo.js";

export interface Outil {
  nom: string;
  /** What it answers, in a few words. */
  ligne: string;
  /** When it went online (heure de La Réunion). */
  depuis: string;
}

// Newest first: the index of the instructions and the `serveur` block read them in this order.
export const OUTILS: Outil[] = [
  { nom: "donner_avis", ligne: "donnée manquante ou fausse, souhait", depuis: "2026-10-24T14:15:00+04:00" },
  { nom: "actualites", ligne: "blocages, routes, faits divers, en direct", depuis: "2026-10-24T12:32:00+04:00" },
  { nom: "evenements", ligne: "concerts, spectacles, fêtes, marchés", depuis: "2026-10-24T11:13:00+04:00" },
  { nom: "historique_meteo", ligne: "météo mesurée passée, records", depuis: "2026-10-24T10:58:00+04:00" },
  { nom: "cyclones", ligne: "cyclones actifs, prévision du CMRS", depuis: "2026-10-24T10:45:00+04:00" },
  { nom: "sport", ligne: "matchs, résultats, Grand Raid", depuis: "2026-10-24T10:43:00+04:00" },
  { nom: "defibrillateurs", ligne: "défibrillateur le plus proche", depuis: "2026-10-24T10:22:00+04:00" },
  { nom: "coupures_eau", ligne: "coupures d'eau, eau non potable", depuis: "2026-10-24T10:20:00+04:00" },
  { nom: "restrictions_eau", ligne: "sécheresse, arrosage, piscine", depuis: "2026-10-24T10:17:00+04:00" },
  { nom: "sentiers_randonnee", ligne: "sentiers ouverts ou fermés, GPX", depuis: "2026-10-24T10:00:00+04:00" },
  { nom: "qualite_eau", ligne: "eau du robinet, baignade", depuis: "2026-10-24T09:24:00+04:00" },
  { nom: "bornes_recharge", ligne: "bornes de recharge en direct", depuis: "2026-10-24T06:53:00+04:00" },
  { nom: "crues_rivieres", ligne: "crues, niveau des rivières", depuis: "2026-10-24T04:32:00+04:00" },
  { nom: "maree", ligne: "marée mesurée", depuis: "2026-10-24T04:27:00+04:00" },
  { nom: "velos_libre_service", ligne: "vélos Altervélo (Sud)", depuis: "2026-10-24T00:49:00+04:00" },
  { nom: "transports", ligne: "prochains bus, retards", depuis: "2026-10-23T18:13:00+04:00" },
  { nom: "meteo_actuelle", ligne: "météo MESURÉE maintenant", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "prevision_meteo", ligne: "PRÉVISION, 7 jours", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "temperature_mer", ligne: "température de la mer", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "vigilance_meteo", ligne: "vigilance, alerte cyclonique", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "volcan_seismes", ligne: "Piton de la Fournaise, séismes", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "electricite", ligne: "électricité, part renouvelable", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "calendrier", ligne: "vacances, jours fériés, soleil", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "qualite_air", ligne: "qualité de l'air", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "annuaire_services_publics", ligne: "mairies, CAF, impôts : horaires", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "fiche_terrain", ligne: "cadastre, PLU, prix, risques", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "sources_donnees", ligne: "sources, licences, outils, nouveautés", depuis: "2026-10-23T16:09:00+04:00" },
];

// Newest first; the latest few go out in sources_donnees. Plain words: what someone can now ask.
export const NOUVEAUTES: { date: string; texte: string }[] = [
  { date: "2026-10-24T14:30:00+04:00", texte: "Chaque réponse dit de quand date la donnée, et liste les outils récents." },
  { date: "2026-10-24T14:15:00+04:00", texte: "Chaque réponse dit comment citer rundata.re ; outil donner_avis et formulaire d'avis sur le site." },
  { date: "2026-10-24T14:06:00+04:00", texte: "Sur le site, les pages « Ce week-end » et « Concerts »." },
  { date: "2026-10-24T13:57:00+04:00", texte: "Pages du site mieux référencées, une image d'aperçu par rubrique." },
  { date: "2026-10-24T13:06:00+04:00", texte: "Barrages sur la page circulation ; annulations et reports annoncés par les médias dans les événements." },
  { date: "2026-10-24T12:32:00+04:00", texte: "Actualités en direct : manifestations, blocages, routes, faits divers, communiqués de la préfecture." },
  { date: "2026-10-24T12:20:00+04:00", texte: "Programmes des salles de spectacle et de concert dans les événements." },
  { date: "2026-10-24T12:13:00+04:00", texte: "Page circulation : carte Waze, état des routes, bus et routes forestières." },
  { date: "2026-10-24T11:34:00+04:00", texte: "Historique météo heure par heure depuis 2000 (à quelle heure il a plu)." },
  { date: "2026-10-24T11:30:00+04:00", texte: "Traces GPS (GPX) des sentiers et des randonnées." },
  { date: "2026-10-24T11:13:00+04:00", texte: "Événements : fêtes, concerts, marchés, festivals." },
  { date: "2026-10-24T10:58:00+04:00", texte: "Historique météo : les mesures jour par jour depuis 1900." },
  { date: "2026-10-24T10:45:00+04:00", texte: "Cyclones : systèmes actifs et prévision du CMRS de La Réunion." },
  { date: "2026-10-24T10:43:00+04:00", texte: "Sport : matchs, résultats, classements, Grand Raid." },
];

const DAY = 24 * 3600_000;
// The `serveur` block keeps under 600 characters: at most this many tools, each of the last 7 days.
const RECENT_MAX = 6;
const RECENT_DAYS = 7;

/** « - actualites : manifestations… », one line per tool, newest first: the top of the instructions. */
export const INDEX = OUTILS.map((o) => `- ${o.nom} : ${o.ligne}`).join("\n");

/** The few tools online for less than a week, newest first. */
export function outilsRecents(now: Date): Record<string, string> | undefined {
  const recent = OUTILS.filter((o) => now.getTime() - new Date(o.depuis).getTime() < RECENT_DAYS * DAY).slice(0, RECENT_MAX);
  return recent.length ? Object.fromEntries(recent.map((o) => [o.nom, o.ligne])) : undefined;
}

/** What every answer says of the server: enough for a model to see that its list of tools is old. */
export function serveur(version: string, count: number, now: Date) {
  return {
    version,
    nombre_outils: count,
    outils_recents: outilsRecents(now),
    si_outil_absent: "Un de ces outils manque à votre liste ? Elle est ancienne : le dire à l'utilisateur.",
  };
}

/** For sources_donnees: every tool, and the latest changes, dated. */
export function catalogue(count = 10) {
  return {
    outils: Object.fromEntries(OUTILS.map((o) => [o.nom, o.ligne])),
    nouveautes: NOUVEAUTES.slice(0, count).map((n) => ({ date: localTime(new Date(n.date)), texte: n.texte })),
  };
}
