import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Cache } from "./cache.js";
import type { Recorder } from "./metrics.js";
import { GAZETTEER_ATTRIBUTION } from "./places/resolve.js";
import * as acspo from "./providers/acspo.js";
import * as arome from "./providers/arome.js";
import * as modis from "./providers/modis.js";
import * as openmeteo from "./providers/openmeteo.js";
import { text } from "./tools/format.js";
import { temperatureMer, COVERAGE as SEA_COVERAGE } from "./tools/mer.js";
import { previsionMeteo, coverage as forecastCoverage } from "./tools/prevision.js";
import { coverage as weatherCoverage, meteoActuelle, providers as weatherProviders } from "./tools/meteo.js";
import * as vigilance from "./providers/vigilance.js";
import { vigilanceMeteo, vigilanceWarnings } from "./tools/vigilance.js";
import * as seismes from "./providers/seismes.js";
import * as volcanSources from "./providers/volcan.js";
import { volcanSeismes } from "./tools/volcan.js";
import * as edf from "./providers/edf.js";
import { electricite } from "./tools/electricite.js";
import * as calendar from "./providers/calendrier.js";
import { calendrier } from "./tools/calendrier.js";
import * as atmo from "./providers/atmo.js";
import { qualiteAir } from "./tools/air.js";
import * as annuaire from "./providers/annuaire.js";
import { annuaireTool } from "./tools/annuaire.js";
import * as terrain from "./providers/terrain.js";
import { ficheLieu } from "./tools/terrain.js";
import * as gtfsrt from "./providers/gtfsrt.js";
import * as transit from "./providers/transit.js";
import { transports } from "./tools/transports.js";

export const VERSION = "0.3.0";

const INSTRUCTIONS = `Données en temps réel de l'île de La Réunion (département français 974, océan Indien) : météo (mesures et prévisions, toujours séparées), pluie radar, mer, vigilance, volcan et séismes, électricité, qualité de l'air, calendrier (vacances, jours fériés, soleil), services publics (adresses et horaires), horaires des bus, cadastre, urbanisme, prix immobiliers et risques naturels à une adresse.
Utiliser ces outils dès qu'une question porte sur le temps à un endroit de La Réunion (commune, plage, cirque, sommet), même si la question ne dit pas « La Réunion » mais nomme un lieu de l'île (Saint-Gilles, Cilaos, le Maïdo, Boucan Canot…).
- Maintenant (« il fait combien ? », « il pleut ? », « la mer est à combien ? ») : meteo_actuelle et temperature_mer renvoient des MESURES datées. Dire l'heure de la mesure, la station et sa distance, et relayer les avertissements (altitude, versant, ancienneté), car le climat change beaucoup sur quelques kilomètres.
- Plus tard (« demain », « ce soir », « ce week-end ») : prevision_meteo renvoie une PRÉVISION de modèle. Toujours dire à l'utilisateur que c'est une prévision, pas une mesure, et relayer ses avertissements ; ne jamais la présenter comme une observation.
- Volcan et séismes (« le volcan est en éruption ? », « on peut monter au volcan ? », « il y a eu un séisme ? ») : volcan_seismes.
- Électricité (« d'où vient l'électricité ? », « quand recharger ma voiture ? ») : electricite.
- Calendrier (« c'est quand les vacances ? », « le 20 décembre est férié ? », « lever du soleil ? ») : calendrier.
- Qualité de l'air (« l'air est pollué à Saint-Louis ? ») : qualite_air.
- Services publics (« horaires de la mairie ? », « où est la CAF ? ») : annuaire_services_publics.
- Bus (« prochain bus à la gare routière de Saint-Pierre ? », « horaires de la ligne 2 à l'arrêt Mairie du Tampon ? ») : transports.
- Terrain à une adresse (« constructible ? », « zone du PLU ? », « prix au m² ? », « zone inondable ? », « risques à cette adresse ? ») : fiche_terrain.
- Vigilance et cyclones (« alerte cyclonique ? », « vigilance orange ? », « on peut aller en montagne avec ces pluies ? ») : vigilance_meteo renvoie la vigilance officielle de Météo-France. Quand une réponse contient un champ « vigilance », le dire en premier.
Réunion Island weather: real-time measurements (meteo_actuelle, temperature_mer) and model forecasts (prevision_meteo), never mixed. Always tell the user when a value is a forecast.`;

/** Adds the vigilance above green, if any, to a tool's answer (asked in parallel, so no added wait). */
async function withVigilance<R extends { content: { type: "text"; text: string }[]; isError?: boolean }>(
  cache: Cache,
  answer: Promise<R>,
): Promise<R> {
  const [r, warnings] = await Promise.all([answer, vigilanceWarnings(cache)]);
  if (!warnings.length || r.isError) return r;
  const payload = JSON.parse(r.content[0].text) as Record<string, unknown>;
  return { ...r, content: [{ type: "text", text: JSON.stringify({ vigilance: warnings, ...payload }, null, 1) }] };
}

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;

const lieu = z
  .string()
  .optional()
  .describe(
    "Lieu à La Réunion, en texte libre : commune (« Saint-Paul »), plage (« plage de l'Hermitage », « Boucan Canot »), " +
      "quartier, cirque (« Cilaos », « Mafate »), sommet (« Maïdo », « volcan »), ou coordonnées « -21.05, 55.22 ». " +
      "Vide = tour de l'île. / Place in Réunion, free text or 'lat, lon'; empty = whole island.",
  );

/** `record`: told of each tool call (metrics.ts). */
export function createServer(cache: Cache, record: Recorder = () => {}): McpServer {
  const server = new McpServer(
    { name: "reunion-temps-reel", title: "La Réunion en temps réel", version: VERSION },
    { instructions: INSTRUCTIONS },
  );
  // Records the place asked (a commune, a beach…), never a street address: fiche_terrain's stays out of the metrics.
  const track =
    <A extends object, R extends object>(name: string, run: (args: A) => Promise<R>) =>
    async (args: A): Promise<R> => {
      const r = await run(args);
      const lieu = "lieu" in args && typeof args.lieu === "string" ? args.lieu : undefined;
      record({ kind: "mcp", name, detail: lieu?.trim().slice(0, 60) || undefined, ok: !("isError" in r && r.isError) });
      return r;
    };

  server.registerTool(
    "meteo_actuelle",
    {
      title: "Météo mesurée en ce moment à La Réunion",
      description:
        "Météo MESURÉE maintenant à La Réunion (974) : température de l'air, pluie (6 dernières minutes et dernière heure), " +
        "humidité, vent et rafales, pression, temps présent, à la station la plus représentative du lieu demandé, " +
        "et la pluie vue par le radar de Météo-France au lieu même (utile là où il n'y a pas de pluviomètre : Mafate, cirques, Hauts). " +
        "Pour toute question sur le temps qu'il fait en ce moment : « quel temps fait-il à Saint-Denis ? », " +
        "« il fait chaud à la plage de l'Hermitage ? », « il pleut à Cilaos ? », « y a-t-il du vent à Saint-Pierre ? », « il fait froid au Maïdo ? ». " +
        "Renvoie des mesures datées avec la station, sa distance, son altitude, et un avertissement " +
        "quand le lieu a un autre microclimat (altitude, versant au vent ou sous le vent). " +
        "Pour plus tard (demain, ce soir, ce week-end), utiliser prevision_meteo. " +
        "/ Current MEASURED weather in Réunion Island (air temperature, rain, humidity, wind, pressure, present weather) " +
        "at the most representative station for a place. Use for 'what is the weather like now in <place in Réunion>'; " +
        "for later today or the coming days, use prevision_meteo.",
      inputSchema: { lieu },
      annotations: { title: "Météo mesurée à La Réunion", ...READ_ONLY },
    },
    track("meteo_actuelle", (args) => withVigilance(cache, meteoActuelle(cache, args.lieu))),
  );

  server.registerTool(
    "prevision_meteo",
    {
      title: "Prévision météo à La Réunion",
      description:
        "PRÉVISION météo (modèle numérique, pas une mesure) pour un lieu de La Réunion (974), de ce soir à 7 jours : " +
        "ciel, températures min et max ramenées à l'altitude du lieu, pluie, vent et rafales, par jour et par tranches de 3 h. " +
        "Pour toute question sur le temps à venir : « il va pleuvoir demain à Saint-Denis ? », « quel temps ce week-end à Cilaos ? », " +
        "« il fera beau cet après-midi à l'Hermitage ? », « prévisions pour la Plaine des Cafres samedi ». " +
        "Chaque réponse est étiquetée « prévision » avec ses limites (le modèle ne voit pas les microclimats de l'île) ; " +
        "pour un cyclone, renvoie à la vigilance officielle de Météo-France. Pour le temps qu'il fait maintenant, utiliser meteo_actuelle. " +
        "/ Weather FORECAST (numerical model, not a measurement) for a place in Réunion Island, up to 7 days: " +
        "'will it rain tomorrow in Saint-Pierre?', 'weather this weekend in Cilaos?'. Always labelled as a forecast.",
      inputSchema: {
        lieu,
        quand: z
          .string()
          .optional()
          .describe(
            "Quand, en texte libre : « aujourd'hui », « cet après-midi », « ce soir », « cette nuit », « demain », « demain matin », " +
              "« après-demain », un jour (« samedi »), « ce week-end », « dans 3 jours ». Vide = prochaines 24 h et jours suivants. " +
              "/ When, free text (today, tonight, tomorrow, a weekday, weekend); empty = next 24 h and following days.",
          ),
      },
      annotations: { title: "Prévision météo à La Réunion", ...READ_ONLY },
    },
    track("prevision_meteo", (args) => withVigilance(cache, previsionMeteo(cache, args.lieu, args.quand))),
  );

  server.registerTool(
    "temperature_mer",
    {
      title: "Température de la mer à La Réunion",
      description:
        "Température de l'eau de mer MESURÉE à La Réunion (974), près d'une plage ou d'un lieu côtier : " +
        "« la mer est à combien à Saint-Leu ? », « température de l'eau à l'Hermitage », « l'eau est bonne à Boucan ? ». " +
        "Renvoie la dernière mesure disponible en disant d'où elle vient (bouée ou satellite), sa date et sa distance. " +
        "/ Measured sea water temperature near a beach or coastal place in Réunion Island, with source, date and distance.",
      inputSchema: { lieu },
      annotations: { title: "Température de la mer à La Réunion", ...READ_ONLY },
    },
    track("temperature_mer", (args) => temperatureMer(cache, args.lieu)),
  );

  if (vigilance.enabled()) {
    server.registerTool(
      "vigilance_meteo",
      {
        title: "Vigilance météo et alerte cyclonique à La Réunion",
        description:
          "Vigilance météo OFFICIELLE de Météo-France à La Réunion (974) et alerte cyclonique en cours : " +
          "couleur (vert, jaune, orange, rouge) par zone de l'île pour les fortes pluies / orages, les vents forts " +
          "et les vagues-submersion, sur les 24 h du bulletin, avec les textes de suivi. " +
          "Pour : « y a-t-il une alerte cyclonique ? », « on est en vigilance orange ? », « vigilance fortes pluies à Saint-Benoît ? », " +
          "« la mer est dangereuse ? », « on peut randonner à Mafate demain avec la pluie ? ». " +
          "Avec un lieu : la zone de vigilance de sa commune ; sans lieu : toute l'île. " +
          "/ Official Météo-France weather warnings and cyclone alert for Réunion Island, by zone, for the next 24 h.",
        inputSchema: { lieu },
        annotations: { title: "Vigilance météo à La Réunion", ...READ_ONLY },
      },
      track("vigilance_meteo", (args) => vigilanceMeteo(cache, args.lieu)),
    );
  }

  server.registerTool(
    "volcan_seismes",
    {
      title: "Piton de la Fournaise et séismes à La Réunion",
      description:
        "État du volcan du Piton de la Fournaise et séismes à La Réunion (974) : éruption en cours ou non, niveau du " +
        "dispositif ORSEC (vigilance, alerte 1, alerte 2…), date de la dernière éruption, accès à l'Enclos Fouqué, " +
        "dernières publications de l'Observatoire volcanologique (OVPF-IPGP) et séismes localisés ces 30 derniers jours, " +
        "sous le volcan et ailleurs sur l'île. Pour : « le volcan est en éruption ? », « on peut monter au volcan ? », " +
        "« l'Enclos est ouvert ? », « il y a eu un séisme ? », « le Piton de la Fournaise se réveille ? ». " +
        "/ Piton de la Fournaise volcano status (eruption, alert level, access) and recent earthquakes in Réunion Island.",
      inputSchema: {},
      annotations: { title: "Volcan et séismes à La Réunion", ...READ_ONLY },
    },
    track("volcan_seismes", () => volcanSeismes(cache)),
  );

  server.registerTool(
    "electricite",
    {
      title: "Électricité à La Réunion en ce moment",
      description:
        "Électricité à La Réunion (974) en temps réel, d'après EDF : production totale, part de chaque filière (solaire, " +
        "bagasse et biomasse, hydraulique, éolien, charbon, diesel) et part renouvelable, mises à jour toutes les 5 min ; " +
        "« météo de l'électricité » d'EDF pour les jours qui viennent (heures de pointe, réseau contraint, recharge conseillée " +
        "d'un véhicule électrique). Pour : « d'où vient l'électricité ? », « quelle part de renouvelable ? », " +
        "« quand recharger ma voiture électrique ? », « risque de délestage ? ». " +
        "/ Réunion Island electricity right now: production mix, renewable share, and EDF's grid signal for the coming days.",
      inputSchema: {},
      annotations: { title: "Électricité à La Réunion", ...READ_ONLY },
    },
    track("electricite", () => electricite(cache)),
  );

  server.registerTool(
    "calendrier",
    {
      title: "Vacances, jours fériés et soleil à La Réunion",
      description:
        "Calendrier de La Réunion (974) : vacances scolaires de l'académie de La Réunion (calendrier austral, différent de la " +
        "métropole), jours fériés (dont le 20 décembre, Fèt Kaf), date du jour, et heures de lever et de coucher du soleil " +
        "au lieu demandé. Pour : « c'est quand les vacances ? », « la rentrée c'est quand ? », « le 20 décembre est férié ? », " +
        "« prochain jour férié ? », « à quelle heure se lève le soleil au Maïdo ? ». " +
        "/ Réunion Island school holidays (austral calendar), public holidays (incl. 20 December) and sunrise/sunset times.",
      inputSchema: { lieu },
      annotations: { title: "Calendrier de La Réunion", ...READ_ONLY },
    },
    track("calendrier", (args) => calendrier(cache, args.lieu)),
  );

  server.registerTool(
    "qualite_air",
    {
      title: "Qualité de l'air à La Réunion",
      description:
        "Qualité de l'air à La Réunion (974) par commune : indice ATMO du jour et du lendemain calculé par Atmo Réunion " +
        "(1 bon à 6 extrêmement mauvais) et polluant en cause (particules, ozone, dioxyde d'azote, dioxyde de soufre). " +
        "Pour : « l'air est pollué à Saint-Louis ? », « qualité de l'air aujourd'hui à Saint-Denis ? », « je peux faire du sport dehors ? ». " +
        "Sans lieu : toute l'île. / Air quality index per commune in Réunion Island, today and tomorrow.",
      inputSchema: { lieu },
      annotations: { title: "Qualité de l'air à La Réunion", ...READ_ONLY },
    },
    track("qualite_air", (args) => qualiteAir(cache, args.lieu)),
  );

  server.registerTool(
    "annuaire_services_publics",
    {
      title: "Services publics à La Réunion : adresses et horaires",
      description:
        "Adresse, horaires d'ouverture (et si c'est ouvert en ce moment), téléphone et site des services publics de La Réunion (974) : " +
        "mairies et mairies annexes, préfecture et sous-préfectures, CAF, CPAM, France Travail, impôts, tribunaux, France services… " +
        "d'après l'annuaire officiel de service-public.fr. Pour : « horaires de la mairie de Saint-Paul ? », « où est la CAF la plus proche " +
        "du Tampon ? », « numéro de la sous-préfecture de Saint-Pierre ? », « le centre des impôts est ouvert ? ». " +
        "/ Addresses, opening hours and phone numbers of public offices in Réunion Island.",
      inputSchema: {
        quoi: z.string().describe("Le service cherché, en quelques mots : « mairie », « CAF », « préfecture », « impôts », « France Travail », « tribunal »… / The office sought."),
        lieu,
      },
      annotations: { title: "Services publics à La Réunion", ...READ_ONLY },
    },
    track("annuaire_services_publics", (args: { quoi: string; lieu?: string }) => annuaireTool(cache, args.quoi, args.lieu)),
  );

  server.registerTool(
    "fiche_terrain",
    {
      title: "Cadastre, urbanisme, prix immobiliers et risques à une adresse de La Réunion",
      description:
        "Ce que disent les registres officiels d'une adresse ou d'un lieu de La Réunion (974) : parcelle cadastrale (section, numéro, " +
        "surface), zone du plan local d'urbanisme (U, AU, A, N : constructible ou non), altitude du sol, prix médians des maisons, " +
        "appartements et terrains vendus autour depuis 5 ans (DVF), et risques : plan de prévention des risques (PPR inondation, " +
        "mouvements de terrain, littoral) au point, arrêtés de catastrophe naturelle de la commune, glissements et éboulements recensés " +
        "à moins de 500 m, sismicité, radon. Pour : « cette parcelle est constructible ? », « dans quelle zone du PLU est le 12 rue X " +
        "à Saint-Paul ? », « prix au m² des maisons à l'Hermitage ? », « cette maison est en zone inondable ? », « quels risques à cette adresse ? ». " +
        "/ Cadastral parcel, zoning (PLU), altitude, median property prices and natural hazards (risk plans, disasters, landslides) at an address in Réunion Island.",
      inputSchema: {
        adresse: z.string().describe("Adresse (« 7 rue de la Buse, Saint-Paul »), lieu-dit (« Bois de Nèfles ») ou coordonnées « -21.0, 55.27 ». / Address, place or 'lat, lon'."),
      },
      annotations: { title: "Fiche terrain à La Réunion", ...READ_ONLY },
    },
    track("fiche_terrain", (args: { adresse: string }) => ficheLieu(cache, args.adresse)),
  );

  // The timetables live in the Worker's D1 database: no such tool on a Node server.
  if (transit.enabled()) {
    server.registerTool(
      "transports",
      {
        title: "Prochains bus à un arrêt de La Réunion",
        description:
          "Prochains départs de bus à un arrêt de La Réunion (974), d'après les horaires publiés par les réseaux : Car Jaune (toute l'île), " +
          "Citalis (Saint-Denis, Sainte-Marie, Sainte-Suzanne), Kar'Ouest (Le Port à Saint-Leu), Alternéo (Saint-Pierre, Saint-Louis…), " +
          "CarSud (Le Tampon, Saint-Joseph…), Estival (Saint-André, Saint-Benoît, Salazie…), téléphérique Papang. Ligne, direction, heure, " +
          "minutes d'attente ; pour Car Jaune (et Alternéo, CarSud quand leur flux fonctionne), l'heure annoncée en temps réel, le retard, " +
          "les arrêts non desservis et l'info trafic. Pour : « prochain bus à la gare routière de Saint-Pierre ? », « à quelle heure passe le car jaune à Saint-Leu ? », " +
          "« horaires de la ligne 2 à l'arrêt Mairie au Tampon ? », « le car jaune a du retard ? ». / Next bus departures at a stop in Réunion Island, from the published timetables and, where available, real-time feeds.",
        inputSchema: {
          arret: z.string().describe("Nom de l'arrêt et sa commune (« Gare routière, Saint-Pierre »), ou un lieu (« plage de Boucan ») pour les arrêts les plus proches. / Stop name and town, or a place."),
          ligne: z.string().optional().describe("Ligne à garder seulement (« 2 », « S1 », « Z1 »). / Only this line."),
        },
        annotations: { title: "Bus à La Réunion", ...READ_ONLY },
      },
      track("transports", (args: { arret: string; ligne?: string }) => transports(args.arret, args.ligne, new Date(), cache)),
    );
  }

  server.registerTool(
    "sources_donnees",
    {
      title: "Sources des données",
      description:
        "Sources de données utilisées par ce serveur (organisme, licence, attribution à citer) et ce qui est couvert " +
        "ou pas encore. / Data sources used by this server, their licences and current coverage.",
      inputSchema: {},
      annotations: { title: "Sources des données", ...READ_ONLY },
    },
    track("sources_donnees", async () =>
      text({
        sources: [...weatherProviders().map((p) => p.source), ...(vigilance.enabled() ? [vigilance.SOURCE] : []), acspo.SOURCE, modis.SOURCE, seismes.SOURCE, volcanSources.OVPF, volcanSources.PITONLIVE, edf.SOURCE, calendar.SCHOOL, calendar.HOLIDAYS, atmo.SOURCE, annuaire.SOURCE, ...Object.values(terrain.SOURCES), ...(transit.enabled() ? [transit.SOURCE, gtfsrt.SOURCE] : []), ...(arome.enabled() ? [arome.SOURCE] : []), openmeteo.SOURCE],
        lieux: GAZETTEER_ATTRIBUTION,
        couverture: { meteo: weatherCoverage(), mer: SEA_COVERAGE, previsions: forecastCoverage() },
        version: VERSION,
      }),
    ),
  );

  return server;
}
