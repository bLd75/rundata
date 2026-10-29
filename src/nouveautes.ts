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

// Newest first: the index of the instructions and the `serveur` block read them in this order. Except sites_sans_reponse,
// after donner_avis, which stays within the instructions' first 700 characters (test/serveur.test.ts).
export const OUTILS: Outil[] = [
  { nom: "emploi", ligne: "emploi public", depuis: "2026-10-29T13:05:00+04:00" },
  { nom: "annuaire_services_publics", ligne: "mairies, santé, carburants, déchets, enfants", depuis: "2026-10-25T14:00:00+04:00" },
  { nom: "resume_du_jour", ligne: "la journée d'une commune en un appel", depuis: "2026-10-24T15:45:00+04:00" },
  { nom: "donner_avis", ligne: "donnée manquante ou fausse, souhait", depuis: "2026-10-24T14:15:00+04:00" },
  { nom: "sites_sans_reponse", ligne: "sites publics sans réponse", depuis: "2026-10-25T22:47:00+04:00" },
  { nom: "actualites", ligne: "blocages, routes, faits divers", depuis: "2026-10-24T12:32:00+04:00" },
  { nom: "evenements", ligne: "concerts, spectacles, fêtes, marchés", depuis: "2026-10-24T11:13:00+04:00" },
  { nom: "historique_meteo", ligne: "météo mesurée passée, records", depuis: "2026-10-24T10:58:00+04:00" },
  { nom: "cyclones", ligne: "cyclones actifs, stade du CMRS", depuis: "2026-10-24T10:45:00+04:00" },
  { nom: "sport", ligne: "matchs, résultats, agendas, Grand Raid", depuis: "2026-10-24T10:43:00+04:00" },
  { nom: "defibrillateurs", ligne: "défibrillateur le plus proche", depuis: "2026-10-24T10:22:00+04:00" },
  { nom: "coupures_eau", ligne: "coupures d'eau, eau non potable", depuis: "2026-10-24T10:20:00+04:00" },
  { nom: "restrictions_eau", ligne: "sécheresse, arrosage, piscine", depuis: "2026-10-24T10:17:00+04:00" },
  { nom: "sentiers_randonnee", ligne: "ouverts ou fermés, GPX", depuis: "2026-10-24T10:00:00+04:00" },
  { nom: "qualite_eau", ligne: "eau du robinet, baignade", depuis: "2026-10-24T09:24:00+04:00" },
  { nom: "bornes_recharge", ligne: "bornes de recharge en direct", depuis: "2026-10-24T06:53:00+04:00" },
  { nom: "crues_rivieres", ligne: "crues, niveau des rivières", depuis: "2026-10-24T04:32:00+04:00" },
  { nom: "maree", ligne: "marée mesurée, prochaines marées calculées", depuis: "2026-10-24T04:27:00+04:00" },
  { nom: "velos_libre_service", ligne: "vélos Altervélo (Sud)", depuis: "2026-10-24T00:49:00+04:00" },
  { nom: "transports", ligne: "prochains bus, retards", depuis: "2026-10-23T18:13:00+04:00" },
  { nom: "meteo_actuelle", ligne: "météo MESURÉE maintenant", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "prevision_meteo", ligne: "PRÉVISION, 7 jours, indice UV", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "temperature_mer", ligne: "mesurée, houle prévue", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "vigilance_meteo", ligne: "vigilance, alerte cyclonique", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "volcan_seismes", ligne: "Piton de la Fournaise, séismes", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "electricite", ligne: "renouvelable, coupures de courant", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "calendrier", ligne: "vacances, jours fériés, soleil", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "qualite_air", ligne: "qualité de l'air", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "fiche_terrain", ligne: "cadastre, PLU, prix, loyers, fibre, risques", depuis: "2026-10-23T16:09:00+04:00" },
  { nom: "sources_donnees", ligne: "sources, licences, outils, nouveautés", depuis: "2026-10-23T16:09:00+04:00" },
];

// Newest first; the latest few go out in sources_donnees. Plain words, for residents (worded by marketing): what
// someone can now ask or find, true outside the page too.
export const NOUVEAUTES: { date: string; texte: string }[] = [
  { date: "2026-10-30T03:45:00+04:00", texte: "Le bouton «\u00a0Y aller\u00a0» arrive sur les événements dont l'agenda donne la position du lieu." },
  { date: "2026-10-30T02:48:00+04:00", texte: "Le bouton «\u00a0Y aller\u00a0» arrive sur les défibrillateurs, les stations de vélos et le marché du jour." },
  { date: "2026-10-29T23:10:00+04:00", texte: "Le bouton «\u00a0Y aller\u00a0» arrive sur les plages, les sites de baignade, les bornes de recharge, les déchèteries, la mairie et les arrêts de bus." },
  { date: "2026-10-29T22:29:00+04:00", texte: "Emploi\u00a0: un même poste publié sous plusieurs références n'apparaît plus qu'une fois, avec un lien vers chaque offre." },
  { date: "2026-10-29T22:12:00+04:00", texte: "Enfants\u00a0: un bouton «\u00a0Y aller\u00a0» ouvre chaque lieu dans votre appli de navigation (Plans, Google Maps, Waze…)." },
  { date: "2026-10-29T16:48:00+04:00", texte: "Météo\u00a0: sur la carte, la température, la pluie et le vent mesurés aux stations\u00a0; entre elles, des couleurs et un mouvement estimés." },
  { date: "2026-10-29T15:41:00+04:00", texte: "Antennes\u00a0: les sites mobiles de Free hors service à La Réunion (panne ou maintenance), d'après le fichier quotidien de l'Arcep." },
  { date: "2026-10-29T15:25:00+04:00", texte: "Antennes\u00a0: la carte des antennes mobiles (Orange, SFR Réunion, Free, Zeop, 2G à\u00a05G) et des émetteurs radio et TV de l'île, d'après l'ANFR." },
  { date: "2026-10-29T15:11:00+04:00", texte: "Marchés publics\u00a0: les avis de marché ouverts à La Réunion, lus chaque heure au BOAMP, avec la date limite et le lien vers l'avis." },
  { date: "2026-10-29T13:05:00+04:00", texte: "Emploi public\u00a0: les offres de l'État, des collectivités et des hôpitaux à La Réunion, publiées sur Choisir le service public." },
  { date: "2026-10-28T16:20:00+04:00", texte: "Actualités\u00a0: quand le site de la préfecture ne répond pas, ses derniers communiqués lus restent affichés, avec l'heure de leur lecture." },
  { date: "2026-10-28T14:53:00+04:00", texte: "Actualités\u00a0: Cambaie (Saint-Paul) reconnu comme lieu\u00a0; un lieu absent de notre répertoire donne les articles qui le nomment." },
  { date: "2026-10-28T10:01:00+04:00", texte: "Événements\u00a0: l'agenda de Bras-Panon de retour, avec l'accord écrit de la mairie." },
  { date: "2026-10-28T05:30:00+04:00", texte: "Pages Météo, Randonnée, Circulation, Événements et Mer\u00a0: une illustration du lieu, générée par IA, en fond derrière le titre." },
  { date: "2026-10-28T01:39:00+04:00", texte: "Page /application\u00a0: les étapes pour mettre rundata.re sur l'écran d'accueil avec Safari, Chrome, Firefox, Edge ou Samsung Internet." },
  { date: "2026-10-28T01:31:00+04:00", texte: "Vigilance\u00a0: la carte officielle de Météo-France, sans retouche, avec l'accord écrit de Météo-France La Réunion." },
  { date: "2026-10-28T01:20:00+04:00", texte: "Baignade\u00a0: les zones du GIP Centre Sécurité Requin, avec son accord et ses corrections, dont les ZONEX de Boucan-Canot à L'Étang-Salé." },
  { date: "2026-10-28T01:12:00+04:00", texte: "Routes forestières\u00a0: leur état de circulation selon l'ONF, pour toute l'île ou une route («\u00a0RF20\u00a0»), dans les réponses des IA." },
  { date: "2026-10-27T10:23:00+04:00", texte: "Sorties\u00a0: le programme du Théâtre Luc Donat, au Tampon, est de retour, avec l'accord écrit du théâtre et un lien vers chaque date." },
  { date: "2026-10-27T00:02:00+04:00", texte: "Bouton «\u00a0Cette page vous a aidé\u00a0?\u00a0» en bas des pages, pour nous dire en un clic si une page a servi. Sans compte ni cookie." },
  { date: "2026-10-26T23:57:00+04:00", texte: "Nouvelle page Nos valeurs\u00a0: un site sans compte, un code ouvert, des données sourcées, et ce que coûte une information enfermée." },
  { date: "2026-10-26T18:44:00+04:00", texte: "Loyers d'annonce (ANIL) et part des logements éligibles à la fibre (Arcep), sur chaque page commune et dans les réponses des IA." },
  { date: "2026-10-26T18:40:00+04:00", texte: "Prévision météo\u00a0: le ciel de la nuit, de 18\u00a0h à 6\u00a0h, dégagé ou couvert, et, dans les Hauts, au-dessus des nuages ou dedans." },
  { date: "2026-10-26T18:37:00+04:00", texte: "La Lune dans le calendrier, calculée au lieu demandé\u00a0: phase, part éclairée, lever, coucher et prochaines phases." },
  { date: "2026-10-26T18:29:00+04:00", texte: "Randonnée\u00a0: les aires d'accueil de l'ONF autour d'un lieu ou le long d'un sentier, dans les réponses des IA." },
  { date: "2026-10-26T18:27:00+04:00", texte: "Radars fixes\u00a0: les 24 de la liste du ministère de l'Intérieur, avec leur vitesse, sur /trafic et dans les réponses des IA." },
  { date: "2026-10-26T15:54:00+04:00", texte: "Avec les enfants\u00a0: une carte par commune, avec les aires de jeux, parcs, piscines et médiathèques, et l'agenda de leurs activités." },
  { date: "2026-10-26T03:52:00+04:00", texte: "Bus\u00a0: chaque départ s'ouvre sur tous ses arrêts, avec l'heure de passage à chacun, et chaque arrêt a sa page, à chercher sur rundata.re/bus." },
  { date: "2026-10-26T02:17:00+04:00", texte: "rundata.re en chiffres\u00a0: une page compte les sources publiques lues, leurs producteurs, leurs licences, et ce qui manque encore." },
  { date: "2026-10-25T23:19:00+04:00", texte: "Quand le site d'une source ne répond pas, la page le dit, avec l'heure de la dernière lecture, au lieu de rien." },
  { date: "2026-10-25T22:47:00+04:00", texte: "Sites sans réponse\u00a0: une page liste les sites publics de l'île qui ne répondent pas, depuis quand, et ce qui manque donc ici." },
  { date: "2026-10-25T22:29:00+04:00", texte: "Coupures d'électricité\u00a0: avis de Cilaos, Saint-André, Saint-Philippe et Sainte-Suzanne retirés, leurs mentions légales l'interdisent." },
  { date: "2026-10-25T22:17:00+04:00", texte: "Événements\u00a0: nous lisons tout l'agenda de Saint-Louis, et les événements que Saint-Leu et La Plaine-des-Palmistes annoncent avec leur date." },
  { date: "2026-10-25T22:09:00+04:00", texte: "Événements\u00a0: même règle pour 3 communes de plus, Saint-Denis, Saint-Pierre et Sainte-Rose, dont les mentions légales interdisent la reprise." },
  { date: "2026-10-25T21:43:00+04:00", texte: "Événements\u00a0: ceux que publient 10 communes dont les mentions légales interdisent la reprise ne sont plus repris\u00a0; la page dit lesquelles." },
  { date: "2026-10-25T20:05:00+04:00", texte: "Marée\u00a0: à Saint-Leu, Saint-Pierre, dans le Sud et l'Est, le lien vers les horaires officiels du SHOM remplace nos heures calculées." },
  { date: "2026-10-25T16:25:00+04:00", texte: "Nouvel espace clubs et associations\u00a0: proposez vos événements en 2 minutes, gratuitement et sans compte, sur rundata.re/associations." },
  { date: "2026-10-25T16:13:00+04:00", texte: "Volcan\u00a0: le niveau d'alerte et l'accès à l'Enclos sont tirés des textes de la préfecture et de l'OVPF, cités avec leur date." },
  { date: "2026-10-25T16:11:00+04:00", texte: "Actualités\u00a0: les titres du Quotidien de La Réunion s'ajoutent aux autres médias de l'île, sur rundata.re/actualites et dans votre IA." },
  { date: "2026-10-25T16:02:00+04:00", texte: "Clubs de sport\u00a0: les rendez-vous publiés sur Sportsregions (tir à l'arc, triathlon, golf, badminton…), avec le club et le lien." },
  { date: "2026-10-25T15:46:00+04:00", texte: "Suivez rundata.re sur sa chaîne WhatsApp\u00a0: les sorties du week-end, chaque vendredi matin. Le lien est dans le menu et en bas des pages." },
  { date: "2026-10-25T15:35:00+04:00", texte: "Bus\u00a0: votre IA dit où est le Car Jaune ou le bus CarSud en ce moment, près de quel arrêt, avec l'heure de sa position." },
  { date: "2026-10-25T15:27:00+04:00", texte: "Saint-Philippe, Cilaos, Saint-Joseph\u00a0: les événements annoncés dans les actualités de la mairie s'affichent, avec le lien de l'article." },
  { date: "2026-10-25T15:15:00+04:00", texte: "Nouvelle page Enfants : aires de jeux, parcs, piscines, médiathèques et activités du week-end, de 0 à 17 ans, commune par commune." },
  { date: "2026-10-25T14:50:00+04:00", texte: "ChatGPT\u00a0: des outils de rundata.re manquent\u00a0? Le tutoriel dit comment actualiser la liste dans les paramètres." },
  { date: "2026-10-25T14:45:00+04:00", texte: "Bus\u00a0: votre IA donne les arrêts d'une ligne commune par commune, ses premiers et derniers départs, et si elle s'arrête près de chez vous." },
  { date: "2026-10-25T14:20:00+04:00", texte: "Volley-ball\u00a0: les tournois en plein air de la Ligue réunionnaise, avec leur date et le lien de la Ligue." },
  { date: "2026-10-25T13:12:00+04:00", texte: "Il a plu quand à Saint-Joseph\u00a0? Dans votre IA, la pluie heure par heure et depuis minuit au pluviomètre Météo-France le plus proche." },
  { date: "2026-10-25T03:00:00+04:00", texte: "Marée : les pleines et basses mers calculées pour les deux prochains jours, avec le lien du SHOM au-delà." },
  { date: "2026-10-25T02:40:00+04:00", texte: "Mairies, associations, organisateurs\u00a0: un guide gratuit pour publier votre agenda en flux ouvert, 8 tutos, du plus simple au plus avancé." },
  { date: "2026-10-25T02:08:00+04:00", texte: "Cyclones passés : Gamède (2007), Colina (1993) et Clotilda (1987), dont les records mondiaux de pluie de Gamède cités par Météo-France." },
  { date: "2026-10-25T01:34:00+04:00", texte: "Sport : les programmes sportifs publiés par les communes s'affichent, avec leur lien, et ne figurent plus dans les événements." },
  { date: "2026-10-25T00:00:00+04:00", texte: "Coupures d'eau : la liste des rues s'affiche quand l'avis la donne en entier, avec l'heure de remise en eau quand il l'annonce." },
  { date: "2026-10-24T23:30:00+04:00", texte: "Coupures d'eau à Saint-Leu : les avis publiés par la commune s'affichent. Petite-Île, Cilaos, L'Étang-Salé : un lien vers la mairie." },
  { date: "2026-10-24T22:56:00+04:00", texte: "Questions en créole pour votre IA, plus proches de la façon dont on parle ici : « Volkan la pété\u00a0? », « Kwélafé La Rényon astèr\u00a0? »…" },
  { date: "2026-10-24T22:24:00+04:00", texte: "Coupures d'eau : les avis de La Créole à Saint-Paul et aux Trois-Bassins, et de CISE Réunion à Sainte-Marie." },
  { date: "2026-10-24T22:17:00+04:00", texte: "Volcan : les alertes précédentes remontent à 2016, avec 12 épisodes de plus cités dans les communiqués de la préfecture." },
  { date: "2026-10-24T22:08:00+04:00", texte: "Cyclones passés : Belal (2024), Firinga (1989) et Hyacinthe (1980), la pluie mesurée station par station, avec les récits de Météo-France." },
  { date: "2026-10-24T22:03:00+04:00", texte: "Coupures d'eau : la consigne du plan cyclone sur l'eau du robinet, et pour chaque commune, si nous lisons les avis de son distributeur." },
  { date: "2026-10-24T21:58:00+04:00", texte: "Volcan : les alertes précédentes depuis novembre 2021, début et fin cités dans les communiqués de la préfecture (liste partielle)." },
  { date: "2026-10-24T21:47:00+04:00", texte: "Cyclones passés : la pluie et les rafales mesurées station par station pendant Garance, Batsirai et Dina." },
  { date: "2026-10-24T21:31:00+04:00", texte: "Kit cyclone : ce que le plan de la préfecture demande de préparer avant la saison, page par page." },
  { date: "2026-10-24T21:30:00+04:00", texte: "Volcan : les séismes localisés par l'OVPF sous le Piton de la Fournaise, jour par jour sur 30 jours." },
  { date: "2026-10-24T21:10:00+04:00", texte: "Écoles et alerte cyclonique : chaque phrase cite le plan cyclone de la préfecture, avec sa page." },
  { date: "2026-10-24T20:51:00+04:00", texte: "Puis-je monter au volcan ? Enclos, RN 2, route du volcan, sentiers : ce que disent les textes officiels, lieu par lieu." },
  { date: "2026-10-24T20:45:00+04:00", texte: "Alerte orange, rouge, violette : ce qui ferme et ce qui continue à chaque niveau, d'après le plan cyclone de la préfecture." },
  { date: "2026-10-24T20:36:00+04:00", texte: "Cyclone : les communiqués de la préfecture s'ajoutent au bulletin de Météo-France, avec la levée de l'alerte et la réouverture des écoles." },
  { date: "2026-10-24T20:22:00+04:00", texte: "Où se baigner ? La règle requin des 300 m et les zones permises (lagons, bassins, filets, ZONEX), sur rundata.re/baignade et dans votre IA." },
  { date: "2026-10-24T20:16:00+04:00", texte: "Quel jour passent les poubelles ? Le jour de collecte de votre rue à Saint-Paul, La Possession, Saint-Leu, Le Port et Trois-Bassins." },
  { date: "2026-10-24T19:43:00+04:00", texte: "Cyclone : les écoles sont-elles fermées ? La règle de la préfecture et l'alerte en cours, sur le site et dans votre IA." },
  { date: "2026-10-24T19:35:00+04:00", texte: "rundata.re s'installe sur votre téléphone : une icône, et les pages déjà ouvertes restent lisibles sans réseau." },
  { date: "2026-10-24T19:30:00+04:00", texte: "Au-dessus ou dans les nuages ? La mer de nuages prévue demain matin au Maïdo, au Piton des Neiges, au volcan et dans les Hauts." },
  { date: "2026-10-24T19:26:00+04:00", texte: "Route du Littoral basculée ou fermée ? Ce qu'annoncent les médias, avec l'heure de l'article, sur /trafic et dans votre IA." },
  { date: "2026-10-24T19:23:00+04:00", texte: "Coupures d'électricité : les avis d'EDF publiés par la mairie de Saint-André s'ajoutent à ceux de Sainte-Marie, Saint-Philippe et Cilaos." },
  { date: "2026-10-24T19:05:00+04:00", texte: "Prévision météo : chaque jour dit sa confiance (forte, moyenne ou faible), selon l'accord des 51 scénarios du Centre européen." },
  { date: "2026-10-24T19:00:00+04:00", texte: "Coupures d'électricité annoncées par les mairies de Sainte-Marie, Saint-Philippe et Cilaos, sur le site et dans votre IA." },
  { date: "2026-10-24T18:11:00+04:00", texte: "En cas d'alerte au Piton de la Fournaise, un bandeau sur tout le site et les annonces officielles en direct." },
  { date: "2026-10-24T18:10:00+04:00", texte: "Le résumé du jour ajoute le marché, l'essence, la pharmacie de garde et, dans l'Ouest, la déchèterie." },
  { date: "2026-10-24T17:48:00+04:00", texte: "Déchèteries de l'Ouest (TCO) : quelles bennes acceptent encore encombrants, déchets verts ou gravats, en direct." },
  { date: "2026-10-24T17:16:00+04:00", texte: "Votre IA connaît une partie des marchés de l'île (OpenStreetMap, liste incomplète). Il manque le vôtre ? Dites-le-nous." },
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
