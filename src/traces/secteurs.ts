/**
 * The sectors of the hikes, each with its page (/randonnees/<slug>). Which sector a trail or a route is in is computed
 * once, when the traces are built (scripts/build-traces.py: where the most of its length lies); these are what the
 * pages say about each.
 */
export interface Secteur {
  slug: string;
  /** As the bundle names it. */
  nom: string;
  /** « à Mafate », « dans les Hauts de l'Ouest ». */
  dans: string;
  /** What it covers, in a few words. */
  quoi: string;
  /** How to get there and where the hikes start. */
  acces: string;
  /** What to know before going, when there is something particular. */
  rappel?: string;
  /** The weather page (/meteo/<slug>) closest to its hikes. */
  meteo?: string;
}

export const SECTEURS: Secteur[] = [
  {
    slug: "mafate", nom: "Mafate", dans: "à Mafate", quoi: "le cirque sans route, ses îlets et ses sentiers",
    acces: "On n'entre à Mafate qu'à pied : par le col des Bœufs (depuis Salazie et Grand Îlet), par Dos d'Âne (La Possession), par la Rivière des Galets (Le Port) ou par le Maïdo (Saint-Paul). Le col du Taïbit le relie à Cilaos.",
    rappel: "Pas de route ni de magasin : les îlets sont ravitaillés par hélicoptère. Réserver son gîte avant de partir, emporter assez d'eau et de vivres.",
    meteo: "maido",
  },
  {
    slug: "cilaos", nom: "Cilaos", dans: "à Cilaos", quoi: "le cirque du Piton des Neiges, de ses îlets et de ses sources",
    acces: "Par la route de Cilaos (RN5) depuis Saint-Louis. Le Piton des Neiges part du Bloc, le col du Taïbit mène à Mafate.",
    rappel: "La route de Cilaos peut fermer après de fortes pluies : voir la circulation avant de partir.",
    meteo: "cilaos",
  },
  {
    slug: "salazie", nom: "Salazie", dans: "à Salazie", quoi: "le cirque vert, ses cascades, Hell-Bourg et Grand Îlet",
    acces: "Par la route de Salazie depuis Saint-André. Hell-Bourg est le départ vers la caverne Dufour et le Piton des Neiges, et vers Bélouve ; Grand Îlet celui du col des Bœufs, vers Mafate.",
    meteo: "hell-bourg",
  },
  {
    slug: "volcan", nom: "Volcan", dans: "au Volcan", quoi: "le massif du Piton de la Fournaise : Plaine des Cafres, Plaine des Sables, Pas de Bellecombe et l'Enclos",
    acces: "Par la route du Volcan depuis la Plaine des Cafres, jusqu'au Pas de Bellecombe.",
    rappel: "L'accès à l'Enclos dépend de l'activité du volcan (arrêté préfectoral) : voir l'état du Piton de la Fournaise. Le brouillard monte souvent en fin de matinée : partir tôt.",
    meteo: "piton-de-la-fournaise",
  },
  {
    slug: "hauts-de-l-ouest", nom: "Hauts de l'Ouest", dans: "dans les Hauts de l'Ouest", quoi: "le Maïdo, le Grand Bénare, le Tévelave et les forêts des Hauts de Saint-Paul à L'Étang-Salé",
    acces: "Par la route du Maïdo depuis Saint-Paul, par les Hauts des Trois-Bassins et de Saint-Leu, et par le Tévelave (Les Avirons).",
    meteo: "maido",
  },
  {
    slug: "nord", nom: "Nord", dans: "dans le Nord", quoi: "la Roche Écrite, la Plaine d'Affouches et les Hauts de Saint-Denis à Sainte-Suzanne",
    acces: "Depuis les Hauts de Saint-Denis (Le Brûlé) pour la Roche Écrite, et depuis La Possession.",
    meteo: "saint-denis",
  },
  {
    slug: "est", nom: "Est", dans: "dans l'Est", quoi: "Bélouve, Bébour, Takamaka et les Hauts de Saint-André à Saint-Benoît",
    acces: "Par la route de la Plaine des Palmistes (RN3) et la route forestière de Bébour ; Takamaka depuis Saint-Benoît.",
    meteo: "la-plaine-des-palmistes",
  },
  {
    slug: "sud", nom: "Sud", dans: "dans le Sud", quoi: "le Dimitile, l'Entre-Deux et les Hauts du Tampon, de Saint-Pierre et de Saint-Joseph",
    acces: "Le Dimitile depuis l'Entre-Deux, les autres depuis les Hauts du Tampon, de Saint-Louis et de Saint-Joseph.",
    meteo: "entre-deux",
  },
  {
    slug: "sud-sauvage", nom: "Sud sauvage", dans: "dans le Sud sauvage", quoi: "Saint-Philippe, Sainte-Rose, Grand Coude et les coulées du volcan jusqu'à la mer",
    acces: "Par la route du littoral (RN2) de Saint-Joseph à Sainte-Rose, et par Grand Coude depuis Saint-Joseph.",
    meteo: "saint-philippe",
  },
  {
    slug: "littoral", nom: "Littoral", dans: "sur le Littoral", quoi: "les sentiers au bord de l'océan, autour de l'île",
    acces: "Les sentiers littoraux longent la côte, souvent près d'une route et d'un arrêt de bus.",
    rappel: "En plein soleil et sans ombre : partir tôt, emporter de l'eau et un chapeau. Ne pas s'approcher du bord par forte houle.",
  },
];

const BY_NAME = new Map(SECTEURS.map((s) => [s.nom, s]));
const BY_SLUG = new Map(SECTEURS.map((s) => [s.slug, s]));
export const secteurNamed = (nom?: string) => (nom ? BY_NAME.get(nom) : undefined);
export const secteurOf = (slug: string) => BY_SLUG.get(slug);
