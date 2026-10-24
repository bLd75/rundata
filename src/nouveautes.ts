/**
 * What the server can do, and what changed lately, said in the answers themselves. A client may keep its list of
 * tools and the server's instructions for hours (Claude.ai kept one two hours old, across conversations), while
 * every answer is fresh: each one carries a short `serveur` block with the newest tools (server.ts), and
 * sources_donnees the whole list and the latest changes. The model can then see that its list is old, and say so.
 *
 * Kept by hand: one line per tool, with the day it went online; one line per change people can notice. The changes
 * are also the site's page /nouveautes and the repository's CHANGELOG.md (`npm run changelog` writes it; a test
 * checks it is up to date), so they are said once, here.
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
  { nom: "resume_du_jour", ligne: "la journée d'une commune en un appel", depuis: "2026-10-24T15:45:00+04:00" },
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
  { nom: "maree", ligne: "marée mesurée, prochaines marées calculées", depuis: "2026-10-24T04:27:00+04:00" },
  { nom: "velos_libre_service", ligne: "vélos Altervélo (Sud)", depuis: "2026-10-24T00:49:00+04:00" },
  { nom: "transports", ligne: "prochains bus, retards", depuis: "2026-10-23T18:13:00+04:00" },
  { nom: "meteo_actuelle", ligne: "météo MESURÉE maintenant", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "prevision_meteo", ligne: "PRÉVISION, 7 jours, indice UV", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "temperature_mer", ligne: "température de la mer, houle prévue", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "vigilance_meteo", ligne: "vigilance, alerte cyclonique", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "volcan_seismes", ligne: "Piton de la Fournaise, séismes", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "electricite", ligne: "électricité, part renouvelable", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "calendrier", ligne: "vacances, jours fériés, soleil", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "qualite_air", ligne: "qualité de l'air", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "annuaire_services_publics", ligne: "vie pratique : mairies, carburants, pharmacies", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "fiche_terrain", ligne: "cadastre, PLU, prix, risques", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "sources_donnees", ligne: "sources, licences, outils, nouveautés", depuis: "2026-10-23T16:09:00+04:00" },
];

// Newest first; the latest few go out in sources_donnees. Plain words, for residents (worded by marketing): what
// someone can now ask or find, true outside the page too.
export const NOUVEAUTES: { date: string; texte: string }[] = [
  { date: "2026-10-24T17:12:00+04:00", texte: "Pharmacies et urgences de chaque commune ; pour la pharmacie de garde, le site 3237.fr ou le 32 37." },
  { date: "2026-10-24T16:50:00+04:00", texte: "Les alertes de votre commune en flux RSS : vigilance, coupures d'eau, sentiers fermés, volcan. Sans compte." },
  { date: "2026-10-24T16:35:00+04:00", texte: "Prochaines marées au Port et à Sainte-Marie : un calcul à 20 min près environ, pas la prévision officielle du SHOM." },
  { date: "2026-10-24T16:22:00+04:00", texte: "Prix maximum des carburants et de la bouteille de gaz, fixés chaque mois par le préfet, avec l'écart au mois dernier." },
  { date: "2026-10-24T16:00:30+04:00", texte: "Houle prévue près de chaque plage : hauteur, période et direction des vagues sur 4 jours, sur le site et dans votre IA." },
  { date: "2026-10-24T16:00:00+04:00", texte: "Indice UV prévu jour par jour, dans la prévision météo du site et de votre IA." },
  { date: "2026-10-24T15:55:00+04:00", texte: "Une page « Aujourd'hui » par commune : la météo, les routes, l'actu, les coupures et les sorties du jour." },
  { date: "2026-10-24T15:45:00+04:00", texte: "Votre IA résume la journée de votre commune : météo, routes, actu, coupures, sorties, mairie ouverte ou non." },
  { date: "2026-10-24T15:12:00+04:00", texte: "L'accueil affiche l'heure de chaque mesure." },
  { date: "2026-10-24T15:03:00+04:00", texte: "Depuis la météo d'un lieu, les randonnées et la commune du coin sont à un clic." },
  { date: "2026-10-24T14:58:30+04:00", texte: "Un bouton pour partager une page sur WhatsApp." },
  { date: "2026-10-24T14:58:00+04:00", texte: "rundata.re s'ajoute à l'écran d'accueil du téléphone, comme une application." },
  { date: "2026-10-24T14:55:00+04:00", texte: "Vacances scolaires 2026-2027 de l'académie de La Réunion et jours fériés, sur une seule page." },
  { date: "2026-10-24T14:51:00+04:00", texte: "Une page coupures d'eau par commune, et un bloc « Eau » sur chaque page commune." },
  { date: "2026-10-24T14:44:00+04:00", texte: "Randonnée par secteur : Mafate, Cilaos, Salazie et les autres, avec l'état ONF de chaque sentier." },
  { date: "2026-10-24T14:30:00+04:00", texte: "Votre IA dit maintenant de quand date chaque donnée qu'elle vous donne, et ce qui est nouveau sur rundata.re." },
  { date: "2026-10-24T14:15:00+04:00", texte: "Un avis, une donnée qui manque ? Formulaire en bas de chaque page, ou dites-le directement à votre IA." },
  { date: "2026-10-24T14:06:00+04:00", texte: "Deux nouvelles pages : que faire ce week-end, et les concerts à venir dans toute l'île." },
  { date: "2026-10-24T13:06:00+04:00", texte: "Circulation : les barrages signalés. Événements : les annulations et reports annoncés par les médias." },
  { date: "2026-10-24T12:32:00+04:00", texte: "Actualités en direct par commune : manifestations, blocages, routes, faits divers, communiqués de la préfecture." },
  { date: "2026-10-24T12:20:00+04:00", texte: "Événements : les programmes des salles de spectacle et de concert de l'île." },
  { date: "2026-10-24T12:13:00+04:00", texte: "Nouvelle page circulation : carte Waze en direct, état des routes, info trafic des bus, routes forestières fermées." },
  { date: "2026-10-24T11:34:00+04:00", texte: "Historique météo heure par heure depuis 2000 : à quelle heure a-t-il plu chez vous hier soir ?" },
  { date: "2026-10-24T11:30:00+04:00", texte: "Traces GPS (GPX) à télécharger pour les sentiers et les randonnées, avec distance et dénivelé." },
  { date: "2026-10-24T11:13:00+04:00", texte: "Événements : fêtes, concerts, marchés et festivals de toute l'île, au même endroit." },
  { date: "2026-10-24T10:58:00+04:00", texte: "Historique météo : les mesures jour par jour depuis 1900, comparées à la normale et aux records." },
  { date: "2026-10-24T10:45:00+04:00", texte: "Cyclones : les systèmes actifs dans l'océan Indien et la prévision du CMRS de La Réunion." },
  { date: "2026-10-24T10:43:00+04:00", texte: "Sport : matchs, résultats, classements, Grand Raid." },
  { date: "2026-10-24T10:22:00+04:00", texte: "Défibrillateurs : plus de 1 200 appareils, et ceux accessibles à toute heure près de chez vous." },
  { date: "2026-10-24T10:20:00+04:00", texte: "Coupures d'eau : les avis en cours des distributeurs, commune par commune." },
  { date: "2026-10-24T10:17:00+04:00", texte: "Sécheresse : les restrictions d'eau en vigueur dans votre commune." },
  { date: "2026-10-24T10:00:00+04:00", texte: "Sentiers : ouverts ou fermés aujourd'hui, d'après l'ONF." },
  { date: "2026-10-24T09:24:00+04:00", texte: "Qualité de l'eau du robinet dans votre commune, d'après les derniers contrôles sanitaires." },
  { date: "2026-10-24T06:53:00+04:00", texte: "Bornes de recharge : les points libres en direct, et où recharger rapidement." },
  { date: "2026-10-24T04:30:00+04:00", texte: "Marée mesurée au Port et à Sainte-Marie ; hauteur des rivières et vigilance crues." },
  { date: "2026-10-24T00:49:00+04:00", texte: "Vélos en libre-service : vélos et places libres, station par station, en direct." },
  { date: "2026-10-23T18:13:00+04:00", texte: "Bus : les prochains départs, d'après les horaires de Car Jaune et des réseaux de chaque territoire." },
  { date: "2026-10-23T16:09:00+04:00", texte: "Lancement de rundata.re : les données publiques de La Réunion en direct, sur une page et dans votre IA." },
];

const DAY = 24 * 3600_000;
// The `serveur` block keeps under 600 characters: at most this many tools, each of the last 7 days.
const RECENT_MAX = 6;
const RECENT_DAYS = 7;

/** « - actualites : manifestations… », one line per tool, newest first: the top of the instructions. */
export const INDEX = OUTILS.map((o) => `- ${o.nom} : ${o.ligne}`).join("\n");

/** The few tools online for less than a week, newest first. */
export function outilsRecents(now: Date): Record<string, string> | undefined {
  const age = (o: Outil) => now.getTime() - new Date(o.depuis).getTime();
  const recent = OUTILS.filter((o) => age(o) >= 0 && age(o) < RECENT_DAYS * DAY).slice(0, RECENT_MAX);
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

export const NOUVEAUTES_PAGE = "https://rundata.re/nouveautes";

/** For sources_donnees: every tool, and the latest changes, dated. */
export function catalogue(count = 10) {
  return {
    outils: Object.fromEntries(OUTILS.map((o) => [o.nom, o.ligne])),
    nouveautes: NOUVEAUTES.slice(0, count).map((n) => ({ date: localTime(new Date(n.date)), texte: n.texte })),
    toutes_les_nouveautes: NOUVEAUTES_PAGE,
  };
}

const DAY_FR = new Intl.DateTimeFormat("fr-FR", { timeZone: "Indian/Reunion", weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** The changes by day (heure de La Réunion), newest first: « Samedi 24 octobre 2026 » and its sentences. */
export function parJour(list = NOUVEAUTES): { jour: string; titre: string; textes: string[] }[] {
  const days = new Map<string, { jour: string; titre: string; textes: string[] }>();
  for (const n of list) {
    const d = new Date(n.date);
    const jour = new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
    const titre = DAY_FR.format(d).replace(/^\p{L}/u, (c) => c.toUpperCase());
    (days.get(jour) ?? days.set(jour, { jour, titre, textes: [] }).get(jour)!).textes.push(n.texte);
  }
  return [...days.values()];
}

/** CHANGELOG.md, from the same list. */
export function changelog(): string {
  return `# Nouveautés\n\nCe que rundata.re sait faire de plus, jour après jour, sur le site (${NOUVEAUTES_PAGE.replace("/nouveautes", "")}) et dans le connecteur pour votre assistant IA. Aussi sur ${NOUVEAUTES_PAGE}.\n\n` +
    `<!-- Généré à partir de src/nouveautes.ts par \`npm run changelog\` : modifier la liste là-bas. -->\n\n` +
    parJour().map((d) => `## ${d.titre}\n\n${d.textes.map((t) => `- ${t}`).join("\n")}\n`).join("\n");
}
