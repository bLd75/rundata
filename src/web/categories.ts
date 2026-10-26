/**
 * What the site covers, one entry per category: the menu, the home page's tiles, the footer, the sitemap and the
 * page for an unknown address all list them from here. A category with a page has its `path`; the others (services
 * publics, terrain) are answered by the connector only, as they need a question (a commune, an address).
 */
export interface Category {
  key: string;
  /** Its name in the menu, the tiles and the footer. */
  nom: string;
  path?: string;
  icon: string;
  /** The connector's tools for it. */
  tools: string[];
  /** What the connector gives, in one sentence. */
  about: string;
  /** A question to ask an assistant, for a category without a page. */
  exemple?: string;
}

export const CATEGORIES: Category[] = [
  {
    key: "meteo",
    nom: "Météo",
    path: "/meteo",
    icon: "thermo",
    tools: ["meteo_actuelle", "prevision_meteo"],
    about: "Température, humidité, vent et pluie de la station la plus pertinente pour une commune, une plage ou un sommet, et les prévisions heure par heure.",
  },
  {
    key: "vigilance",
    nom: "Vigilance",
    path: "/vigilance",
    icon: "alert",
    tools: ["vigilance_meteo"],
    about: "La vigilance de Météo-France zone par zone et l'alerte cyclonique, signalées d'office dès qu'elles dépassent le vert.",
  },
  {
    key: "crues",
    nom: "Crues",
    path: "/crues",
    icon: "gauge",
    tools: ["crues_rivieres"],
    about: "La vigilance crues de Vigicrues Réunion rivière par rivière, et la hauteur et le débit mesurés aux stations des rivières, avec leur tendance sur la dernière demi-heure.",
  },
  {
    key: "actualites",
    nom: "Actualités",
    path: "/actualites",
    icon: "news",
    tools: ["actualites"],
    about: "Ce qui se passe en ce moment sur l'île : les titres des médias locaux et leurs directs (manifestations, blocages, routes, faits divers) commune par commune, et les communiqués de la préfecture.",
  },
  {
    key: "historique",
    nom: "Historique météo",
    path: "/historique",
    icon: "history",
    tools: ["historique_meteo"],
    about: "Le temps qu'il a fait, mesuré par les stations Météo-France jour par jour depuis 1900 : pluie, températures, soleil, comparés à la normale 1991-2020 et aux records.",
  },
  {
    key: "cyclones",
    nom: "Cyclones",
    path: "/cyclones",
    icon: "cyclone",
    tools: ["cyclones"],
    about: "Les systèmes tropicaux actifs du sud-ouest de l'océan Indien : position, stade, distance de La Réunion, déplacement et prévision du CMRS de Météo-France.",
  },
  {
    key: "mer",
    nom: "Mer",
    path: "/mer",
    icon: "wave",
    tools: ["temperature_mer"],
    about: "La température de l'eau mesurée par satellite au large de chaque plage, avec la date de la mesure.",
  },
  {
    key: "volcan",
    nom: "Volcan",
    path: "/volcan",
    icon: "volcano",
    tools: ["volcan_seismes"],
    about: "Éruption en cours ou non, accès à l'Enclos, derniers séismes localisés par l'observatoire du Piton de la Fournaise.",
  },
  {
    key: "bus",
    nom: "Bus",
    path: "/bus",
    icon: "bus",
    tools: ["transports"],
    about: "Les prochains départs à n'importe quel arrêt, d'après les horaires de Car Jaune, Citalis, Kar'Ouest, Alternéo, CarSud, Estival et du téléphérique Papang.",
  },
  {
    key: "trafic",
    nom: "Circulation",
    path: "/trafic",
    icon: "car",
    tools: ["transports", "sentiers_randonnee"],
    about: "La carte officielle des bouchons, accidents et travaux sur infotrafic.re, et ce que rundata.re lit : retards et déviations des bus, routes forestières fermées, vigilance.",
  },
  {
    key: "velos",
    nom: "Vélos",
    path: "/velos",
    icon: "bike",
    tools: ["velos_libre_service"],
    about: "Les vélos électriques Altervélo et les places libres de chaque station, en direct, à Saint-Pierre, Saint-Louis et L'Étang-Salé.",
  },
  {
    key: "bornes",
    nom: "Recharge",
    path: "/bornes",
    icon: "plug",
    tools: ["bornes_recharge"],
    about: "Les bornes publiques pour voiture électrique et l'état de chaque point de charge, libre, occupé ou hors service, en direct.",
  },
  {
    key: "coupures",
    nom: "Coupures d'eau",
    path: "/coupures-eau",
    icon: "drop",
    tools: ["coupures_eau"],
    about: "Les avis des distributeurs d'eau : coupures pour travaux, heures et rues concernées, et avis « ne pas boire l'eau ».",
  },
  {
    key: "dae",
    nom: "Défibrillateurs",
    path: "/defibrillateurs",
    icon: "heart",
    tools: ["defibrillateurs"],
    about: "Les défibrillateurs les plus proches d'un lieu, avec leur adresse, leur emplacement et s'ils sont accessibles à toute heure.",
  },
  {
    key: "secheresse",
    nom: "Sécheresse",
    path: "/secheresse",
    icon: "sun",
    tools: ["restrictions_eau"],
    about: "Les restrictions d'eau de l'arrêté préfectoral en vigueur, commune par commune, et ce qui est interdit : arrosage, lavage, piscine.",
  },
  {
    key: "sentiers",
    nom: "Randonnée",
    path: "/randonnees",
    icon: "mountain",
    tools: ["sentiers_randonnee"],
    about: "Les randonnées de l'île avec leur trace GPS (GPX), leur distance et leur dénivelé, et les sentiers ouverts ou fermés d'après la carte de l'ONF, avec la cause de chaque fermeture.",
  },
  {
    key: "sport",
    nom: "Sport",
    path: "/sport",
    icon: "trophy",
    tools: ["sport"],
    about: "Les matchs à venir et les derniers résultats du handball et du volley régionaux, les classements, les régates, le golf, les rallyes et le Grand Raid.",
  },
  {
    key: "agenda",
    nom: "Événements",
    path: "/evenements",
    icon: "music",
    tools: ["evenements"],
    about: "Les concerts, spectacles, fêtes, festivals et marchés des prochains jours, d'après les programmes des salles et les agendas des mairies.",
  },
  {
    key: "enfants",
    nom: "Enfants",
    path: "/enfants",
    icon: "kids",
    tools: ["annuaire_services_publics", "evenements"],
    about: "Aires de jeux, parcs, piscines, médiathèques, zoos et skateparks, commune par commune, et les activités pour les enfants des deux semaines qui viennent, avec l'âge quand la source le donne.",
  },
  {
    key: "eau",
    nom: "Eau",
    path: "/eau",
    icon: "drop",
    tools: ["qualite_eau"],
    about: "La qualité de l'eau des plages et bassins contrôlés par l'ARS, prélèvement par prélèvement, et celle de l'eau du robinet, réseau par réseau.",
  },
  {
    key: "air",
    nom: "Air",
    path: "/air",
    icon: "air",
    tools: ["qualite_air"],
    about: "L'indice ATMO du jour et du lendemain dans chaque commune, avec le polluant en cause.",
  },
  {
    key: "electricite",
    nom: "Électricité",
    path: "/electricite",
    icon: "bolt",
    tools: ["electricite"],
    about: "D'où vient l'électricité de l'île en ce moment, la part renouvelable et les heures où le réseau est chargé.",
  },
  {
    key: "calendrier",
    nom: "Calendrier",
    path: "/calendrier",
    icon: "calendar",
    tools: ["calendrier"],
    about: "Vacances scolaires de l'académie, jours fériés (dont le 20 décembre), lever et coucher du soleil.",
  },
  {
    key: "services",
    nom: "Services publics",
    icon: "building",
    tools: ["annuaire_services_publics"],
    about: "Adresse, horaires, ouvert ou fermé en ce moment, téléphone : mairies, CAF, préfecture, impôts, France services…",
    exemple: "La mairie de Saint-Paul est ouverte ?",
  },
  {
    key: "terrain",
    nom: "Terrain et risques",
    icon: "map",
    tools: ["fiche_terrain"],
    about: "À une adresse : parcelle, zone du PLU, prix de vente autour, plan de prévention des risques, catastrophes naturelles, mouvements de terrain.",
    exemple: "Le 12 rue de Paris à Saint-Denis est-il en zone inondable ?",
  },
];

/** The categories with a page, in the menu's order. */
export const WITH_PAGE = CATEGORIES.filter((c): c is Category & { path: string } => c.path !== undefined);

/** What is in force now and goes first everywhere: Météo-France's vigilance above green, the volcano in alert or erupting. */
export interface Urgent {
  vigilance?: boolean;
  /** A flood vigilance yellow or above (Vigicrues Réunion). */
  crues?: boolean;
  volcan?: boolean;
}

// What serves the most people goes first: the events, the hikes, the weather; the sea and the buses after the rest.
export const FIRST = ["agenda", "sentiers", "meteo"];
// In the menu and the tiles, the children's page right after the events, but not in the bar.
const LEADING = [FIRST[0], "enfants", ...FIRST.slice(1)];
const LAST = ["mer", "bus"];
// What is first while in force; on the home page's tiles, before the sea and the buses when quiet.
const URGENT = ["vigilance", "crues", "volcan"];
// On the home page's tiles, before them: the traffic, which only sends to Waze and infotrafic.re until a real measure
// of it exists.
const TILES_LAST = ["trafic"];

/** The vigilance and the volcano while in force, in that order, as keys. */
export const urgentKeys = (u: Urgent) => [u.vigilance && "vigilance", u.crues && "crues", u.volcan && "volcan"].filter((k): k is string => !!k);

/**
 * `list` in the order of use: the vigilance and the volcano first while in force, then FIRST with the children's page
 * after the events, the others as listed
 * (the vigilance and the volcano among them when quiet), the sea and the buses last. With `quietLast` (the home page's
 * tiles), the traffic, then a quiet vigilance and a quiet volcano go to the end too, before the sea and the buses.
 */
export function byUse<T extends { key: string }>(list: T[], u: Urgent, quietLast = false): T[] {
  const top = [...urgentKeys(u), ...LEADING];
  const last = quietLast ? [...TILES_LAST, ...URGENT.filter((k) => !top.includes(k)), ...LAST] : LAST;
  const rank = (key: string) => (top.includes(key) ? top.indexOf(key) - 100 : last.includes(key) ? 100 + last.indexOf(key) : 0);
  // The sort is stable: the others keep their order.
  return [...list].sort((a, b) => rank(a.key) - rank(b.key));
}
