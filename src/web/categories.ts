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
