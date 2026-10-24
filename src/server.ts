import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Cache } from "./cache.js";
import type { Recorder } from "./metrics.js";
import { GAZETTEER_ATTRIBUTION } from "./places/resolve.js";
import * as acspo from "./providers/acspo.js";
import * as arome from "./providers/arome.js";
import * as modis from "./providers/modis.js";
import * as openmeteo from "./providers/openmeteo.js";
import * as avis from "./avis.js";
import { cite, SITE_URL } from "./tools/citer.js";
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
import * as velos from "./providers/velos.js";
import * as maregraphes from "./providers/maregraphes.js";
import * as vigicrues from "./providers/vigicrues.js";
import { velosLibreService } from "./tools/velos.js";
import { maree } from "./tools/maree.js";
import { crues } from "./tools/crues.js";
import * as irve from "./providers/irve.js";
import { bornesRecharge } from "./tools/bornes.js";
import * as baignades from "./providers/baignades.js";
import * as eauPotable from "./providers/eaupotable.js";
import { qualiteEau } from "./tools/eau.js";
import * as onf from "./providers/sentiers.js";
import { sentiersRandonnee } from "./tools/sentiers.js";
import * as vigieau from "./providers/vigieau.js";
import { restrictionsEau } from "./tools/secheresse.js";
import * as avisEau from "./providers/avis-eau.js";
import { coupuresEau } from "./tools/coupures.js";
import * as dae from "./providers/dae.js";
import { defibrillateurs } from "./tools/dae.js";
import * as sportSources from "./providers/sport.js";
import { SPORTS, sportTool, type Quand, type Sport } from "./tools/sport.js";
import * as gdacs from "./providers/cyclones.js";
import { cyclones } from "./tools/cyclones.js";
import * as climat from "./providers/climat.js";
import { historiqueMeteo } from "./tools/historique.js";
import * as agendaSources from "./providers/agenda.js";
import { agenda, COUVERTURE as AGENDA_COVERAGE, MAIRIES_LUES } from "./tools/agenda.js";
import * as traceSources from "./providers/traces.js";
import * as actuSources from "./providers/actualites.js";
import { actualites } from "./tools/actualites.js";

export const VERSION = "0.30.0";

const INSTRUCTIONS = `Données en temps réel de l'île de La Réunion (département français 974, océan Indien) : météo (mesures, historique des mesures et prévisions, toujours séparés), pluie radar, mer, marée, crues des rivières, vigilance, cyclones, volcan et séismes, électricité, qualité de l'air, calendrier (vacances, jours fériés, soleil), services publics (adresses et horaires), horaires des bus, vélos en libre-service, bornes de recharge, qualité de l'eau (robinet et baignade), restrictions d'eau (sécheresse), coupures d'eau, défibrillateurs, randonnée (sentiers ouverts ou fermés, traces GPS, distance et dénivelé), circulation (sans mesure des bouchons : renvoi vers Waze et infotrafic.re), sport (matchs, régates, rallyes, Grand Raid), événements et sorties (fêtes, concerts, marchés, festivals), actualités locales en direct (manifestations, blocages, routes, faits divers, communiqués de la préfecture), cadastre, urbanisme, prix immobiliers et risques naturels à une adresse.
Citer la source : chaque réponse finit par un champ citer (« rundata.re, d'après Météo-France (station …) ») et un lien vers la page de rundata.re. Toujours nommer rundata.re avec ce lien, à côté des producteurs des données (que garde le champ sources, avec leur licence), et donner l'heure de la mesure ou de la publication qui vient avec la donnée.
Donner son avis : quand un outil n'a pas la donnée cherchée ou donne une valeur qui semble fausse, ou quand l'utilisateur exprime un souhait ou une plainte sur ces données, appeler donner_avis (en demandant d'abord à l'utilisateur si le contenu le concerne personnellement). Une ligne avis dans une réponse le rappelle.
Utiliser ces outils dès qu'une question porte sur le temps à un endroit de La Réunion (commune, plage, cirque, sommet), même si la question ne dit pas « La Réunion » mais nomme un lieu de l'île (Saint-Gilles, Cilaos, le Maïdo, Boucan Canot…).
- Maintenant (« il fait combien ? », « il pleut ? », « la mer est à combien ? ») : meteo_actuelle et temperature_mer renvoient des MESURES datées. Dire l'heure de la mesure, la station et sa distance, et relayer les avertissements (altitude, versant, ancienneté), car le climat change beaucoup sur quelques kilomètres.
- Avant (« hier », « cette nuit », « ce mois-ci », « depuis deux semaines », « l'an dernier », « il y a 20 ans », « record de chaleur », « normal pour octobre ? », « à quelle heure a-t-il plu ? ») : historique_meteo renvoie les MESURES jour par jour des stations Météo-France, de leur première année jusqu'à hier, comparées à la normale 1991-2020 et aux records de la station, et heure par heure depuis 2000 sur quelques jours, nuit dernière comprise.
- Plus tard (« demain », « ce soir », « ce week-end ») : prevision_meteo renvoie une PRÉVISION de modèle. Toujours dire à l'utilisateur que c'est une prévision, pas une mesure, et relayer ses avertissements ; ne jamais la présenter comme une observation.
- Marée (« la marée monte ? », « marée haute à quelle heure ? », « niveau de la mer au Port ») : maree renvoie la hauteur d'eau MESURÉE par les marégraphes du Port et de Sainte-Marie et les dernières pleine et basse mer observées ; pas de prévision d'horaires de marée, le dire si on en demande.
- Crues et rivières (« la rivière des Galets est en crue ? », « vigilance crues ? », « niveau de la ravine Saint-Gilles ? ») : crues_rivieres renvoie la vigilance crues de Vigicrues Réunion et la hauteur et le débit mesurés aux stations des rivières. Relayer les consignes (jamais traverser un radier submergé).
- Volcan et séismes (« le volcan est en éruption ? », « on peut monter au volcan ? », « il y a eu un séisme ? ») : volcan_seismes.
- Électricité (« d'où vient l'électricité ? », « quand recharger ma voiture ? ») : electricite.
- Calendrier (« c'est quand les vacances ? », « le 20 décembre est férié ? », « lever du soleil ? ») : calendrier.
- Qualité de l'air (« l'air est pollué à Saint-Louis ? ») : qualite_air.
- Services publics (« horaires de la mairie ? », « où est la CAF ? ») : annuaire_services_publics.
- Bus (« prochain bus à la gare routière de Saint-Pierre ? », « horaires de la ligne 2 à l'arrêt Mairie du Tampon ? ») : transports.
- Circulation (« ça bouchonne ? », « ça bloque à Saint-Pierre ? », « embouteillages sur la quatre-voies ? », « la route du Littoral est ouverte ? », « route fermée ? ») : aucun outil ne mesure le trafic, ne pas en inventer. Dire clairement que rundata.re n'a pas la mesure des bouchons, et renvoyer vers la carte Waze en direct et vers infotrafic.re (l'état officiel des routes nationales, publié par la Région), avec la page https://rundata.re/trafic. Donner ensuite ce qui est connu : les routes forestières fermées (sentiers_randonnee), les retards et déviations des bus (transports, des retards de bus et non une mesure des bouchons), la vigilance (vigilance_meteo). Pour un barrage, un blocage ou une route coupée en un lieu (« ça bloque à X ? »), appeler aussi actualites avec ce lieu : ce que les médias en disent, avec l'heure et le lien.
- Vélos en libre-service (« il reste des vélos à la station IUT ? », « vélo Altervélo près du front de mer de Saint-Pierre ? ») : velos_libre_service (Saint-Pierre, Saint-Louis, L'Étang-Salé).
- Voiture électrique (« borne de recharge libre près de Saint-Gilles ? », « recharge rapide à Saint-Pierre ? ») : bornes_recharge renvoie les bornes publiques et l'état en direct de chaque point (libre, occupé, hors service).
- Qualité de l'eau (« l'eau du robinet est potable à Cilaos ? », « on peut se baigner à l'Hermitage ? », « l'eau du bassin Bleu est propre ? ») : qualite_eau renvoie les analyses de l'ARS, datées.
- Sécheresse (« restrictions d'eau à Saint-Joseph ? », « j'ai le droit d'arroser ? », « je peux remplir ma piscine ? ») : restrictions_eau renvoie le niveau de l'arrêté préfectoral et ce qui est interdit.
- Coupures d'eau (« coupure d'eau à Saint-Denis ? », « l'eau est revenue ? », « on peut boire l'eau à la Plaine-des-Palmistes ? ») : coupures_eau renvoie les avis des distributeurs. Un avis « ne pas boire l'eau » se dit en premier.
- Urgence cardiaque (« où est le défibrillateur le plus proche ? ») : defibrillateurs ; dire d'abord d'appeler le 15 ou le 112 et de commencer le massage cardiaque.
- Randonnée (« le sentier de la Roche Pendue est ouvert ? », « sentiers fermés à Mafate ? », « on peut monter au Piton des Neiges ? », « une rando de 10 km à Cilaos ? ») : sentiers_randonnee renvoie l'état des sentiers d'après la carte de l'ONF, les traces GPS (GPX), la longueur et le dénivelé ; pour une longueur ou un dénivelé, passer longueur_min_km, longueur_max_km ou denivele_max_m. Si la réponse a un champ avertissement, le dire EN PREMIER : quels sentiers sont fermés, la cause, la réouverture prévue, et qu'un sentier fermé est interdit (ne pas s'y engager, même avec la trace). Pour une trace GPS (« la trace du Piton des Neiges », « GPX du GR R2 ») : donner le lien trace_gpx, la longueur et le dénivelé. Un tronçon « hors gestion ONF » n'est pas dit ouvert : son état n'est pas connu.
- Sport (« quels matchs ce week-end ? », « résultats du handball ? », « prochaine régate ? », « classement du Grand Raid ? ») : sport renvoie le calendrier et les résultats officiels (handball, volley, voile, golf, sport automobile, Grand Raid) et l'actualité sportive de Réunion La 1ère. Le football n'a pas de source ouverte : le dire, et citer les articles.
- Ce qui se passe en ce moment (« il y a des blocages à Saint-Pierre ? », « ça se passe comment la manifestation ? », « quoi de neuf à Saint-Benoît ? », « la route du littoral est fermée ? », « dernières infos sur le cyclone ») : actualites renvoie les titres des médias de l'île (Réunion La 1ère, Clicanoo, Imaz Press, Freedom…) et les entrées de leurs directs, datés, avec ce qu'ils disent du lieu demandé, et les communiqués de la préfecture. Dire l'heure et le média de chaque information et donner le lien ; si rien ne mentionne le lieu, le dire sans en conclure qu'il ne s'y passe rien. Ne jamais inventer un blocage ni le démentir.
- Sorties (« que faire ce week-end à Saint-Paul ? », « un concert ce soir ? », « un spectacle samedi ? », « marché forain demain ? », « c'est quand la fête de l'ail ? ») : evenements renvoie les événements publiés par les salles de spectacle et de concert, les mairies, l'intercommunalité du Nord et reunion.fr, avec la date, l'heure, la salle, le genre, le prix quand il est donné et le lien. Donner le lien de chaque événement cité ; dire d'abord un statut ANNULÉ ou REPORTÉ, et quand il vient d'un média (statut_d_apres) et non de l'organisateur, le dire avec le média et son lien. L'agenda n'est pas complet (le Kerveguen, les bars, beaucoup de communes ne publient rien de lisible) : le dire quand rien n'est trouvé. Pour le cinéma, renvoyer aux sites des salles donnés dans la réponse.
- Terrain à une adresse (« constructible ? », « zone du PLU ? », « prix au m² ? », « zone inondable ? », « risques à cette adresse ? ») : fiche_terrain.
- Vigilance et cyclones (« alerte cyclonique ? », « vigilance orange ? », « on peut aller en montagne avec ces pluies ? ») : vigilance_meteo renvoie la vigilance officielle de Météo-France. Quand une réponse contient un champ « vigilance », le dire en premier.
- Cyclones (« il y a un cyclone ? », « où est la tempête ? », « elle va passer près de La Réunion ? », « c'était quoi le dernier cyclone ? ») : cyclones renvoie les systèmes tropicaux actifs du sud-ouest de l'océan Indien (position, stade, distance, déplacement, prévision du CMRS de La Réunion) et l'alerte cyclonique. Ne jamais inventer de trajectoire : citer la prévision du CMRS telle quelle, et renvoyer aux consignes de la préfecture.
Réunion Island weather: real-time measurements (meteo_actuelle, temperature_mer), past measurements back to 1900 (historique_meteo) and model forecasts (prevision_meteo), never mixed. Always tell the user when a value is a forecast.`;

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

/** What a tool's handler is told of the HTTP request (the MCP SDK's RequestHandlerExtra): its headers, on HTTP only. */
type Extra = { requestInfo?: { headers?: Record<string, string | string[] | undefined> } };

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
  // Ends each answer with its citation and the link to rundata.re.
  const track =
    <A extends object, R extends object>(name: string, run: (args: A, extra: Extra) => Promise<R>) =>
    async (args: A, extra: Extra = {}): Promise<R> => {
      const r = await run(args, extra);
      const lieu = "lieu" in args && typeof args.lieu === "string" ? args.lieu : undefined;
      record({ kind: "mcp", name, detail: lieu?.trim().slice(0, 60) || undefined, ok: !("isError" in r && r.isError) });
      // Every answer says how to cite it, error or not (tools/citer.ts); the feedback tool's thanks already names rundata.re.
      return name === "donner_avis" ? r : cite(name, r);
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
    "velos_libre_service",
    {
      title: "Vélos en libre-service à La Réunion",
      description:
        "Vélos à assistance électrique en libre-service Altervélo (Saint-Pierre, Saint-Louis, L'Étang-Salé), en direct : pour chaque station, " +
        "le nombre de vélos à prendre et de places libres pour en rendre un, et les stations les plus proches d'un lieu. Pour : « il reste des vélos " +
        "à la station IUT ? », « où prendre un vélo près du front de mer de Saint-Pierre ? », « je peux rendre mon vélo au pôle d'échanges de Saint-Louis ? ». " +
        "/ Live bike-share availability (Altervélo e-bikes, south of Réunion Island): bikes and free docks per station.",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Nom d'une station (« IUT », « Front de mer »), un lieu ou une commune (« Saint-Pierre », « plage de l'Étang-Salé »). Vide = tout le réseau. / Station, place or town; empty = whole network."),
      },
      annotations: { title: "Vélos Altervélo", ...READ_ONLY },
    },
    track("velos_libre_service", (args: { lieu?: string }) => velosLibreService(cache, args.lieu)),
  );

  server.registerTool(
    "maree",
    {
      title: "Marée à La Réunion",
      description:
        "Hauteur de la mer mesurée chaque minute par les marégraphes du SHOM au Port (Pointe des Galets) et à Sainte-Marie : niveau actuel, " +
        "marée montante ou descendante, heures et hauteurs des dernières pleine et basse mer observées. Mesures seulement, pas de prévision d'horaires. " +
        "Pour : « la marée monte ? », « c'était quand la marée haute ? », « niveau de la mer au Port ? ». " +
        "/ Measured sea level and tide state at Réunion Island's two tide gauges (no tide predictions).",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Un lieu de la côte (« Le Port », « Saint-Gilles », « Sainte-Marie ») pour le marégraphe le plus proche. Vide = les deux. / A coastal place; empty = both gauges."),
      },
      annotations: { title: "Marée", ...READ_ONLY },
    },
    track("maree", (args: { lieu?: string }) => maree(cache, args.lieu)),
  );

  server.registerTool(
    "crues_rivieres",
    {
      title: "Crues et rivières à La Réunion",
      description:
        "Vigilance crues de Vigicrues Réunion (DEAL), rivière par rivière, et hauteur d'eau et débit mesurés toutes les 5 minutes aux 29 stations " +
        "des rivières et ravines de l'île, avec leur tendance et les crues historiques comme repères. Pour : « la rivière des Galets est en crue ? », " +
        "« il y a une vigilance crues ? », « niveau de la ravine Saint-Gilles ? », « la rivière monte à Salazie ? ». " +
        "/ Réunion Island river flood vigilance and live river levels and flows (Vigicrues Réunion).",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Une rivière (« rivière des Galets », « ravine Saint-Gilles ») ou un lieu (« Salazie », « Saint-Benoît ») pour les stations proches. Vide = toute l'île. / A river or a place; empty = whole island."),
      },
      annotations: { title: "Crues", ...READ_ONLY },
    },
    track("crues_rivieres", (args: { lieu?: string }) => crues(cache, args.lieu)),
  );

  server.registerTool(
    "bornes_recharge",
    {
      title: "Bornes de recharge à La Réunion",
      description:
        "Bornes de recharge publiques pour voiture électrique à La Réunion (136 stations, plus de 400 points de charge : Freshmile, EZDrive, E.Leclerc…) " +
        "et l'état en direct de chaque point d'après son opérateur : libre, occupé ou hors service, avec sa puissance, ses prises, ses horaires et son réseau. " +
        "Pour : « borne de recharge libre près de Saint-Gilles ? », « où recharger rapidement à Saint-Pierre ? », « bornes au Tampon ? ». " +
        "/ Réunion Island public EV charging stations with live availability of each charge point.",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Un lieu ou une commune (« Saint-Gilles-les-Bains », « Le Tampon », « aéroport Roland-Garros »). Vide = toute l'île. / A place or town; empty = whole island."),
        rapide: z
          .boolean()
          .optional()
          .describe("Seulement la recharge rapide (50 kW ou plus). / Fast charging only (50 kW or more)."),
      },
      annotations: { title: "Bornes de recharge", ...READ_ONLY },
    },
    track("bornes_recharge", (args: { lieu?: string; rapide?: boolean }) => bornesRecharge(cache, args.lieu, args.rapide)),
  );

  server.registerTool(
    "qualite_eau",
    {
      title: "Qualité de l'eau à La Réunion : robinet et baignade",
      description:
        "Qualité de l'eau à La Réunion (974), d'après les analyses de l'ARS : eau du robinet réseau par réseau (dernière analyse, conformité, " +
        "germes ou paramètres au-dessus des limites sur 6 mois) et eau de baignade des plages et bassins contrôlés (Hermitage, Boucan Canot, " +
        "La Saline, Saint-Pierre, Étang-Salé, Grande Anse, bassin Bleu, bassin Dinan…), prélèvement par prélèvement. " +
        "Pour : « l'eau du robinet est potable à Cilaos ? », « eau non conforme à Ravine des Cabris ? », « on peut se baigner à l'Hermitage ? », " +
        "« l'eau du bassin Dinan est propre ? ». / Tap water and bathing water quality in Réunion Island (official sanitary control).",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Commune, quartier, plage ou bassin (« Ravine des Cabris », « plage de l'Hermitage », « bassin Bleu »). / A town, district, beach or river pool."),
        eau: z
          .enum(["robinet", "baignade"])
          .optional()
          .describe("« robinet » (eau potable) ou « baignade » ; vide = d'après la question et le lieu. / Tap or bathing water; empty = guessed."),
      },
      annotations: { title: "Qualité de l'eau", ...READ_ONLY },
    },
    track("qualite_eau", (args: { lieu?: string; eau?: "robinet" | "baignade" }) => qualiteEau(cache, args.lieu, args.eau)),
  );

  server.registerTool(
    "sentiers_randonnee",
    {
      title: "Randonnée à La Réunion : sentiers ouverts ou fermés, traces GPS (GPX), distance et dénivelé",
      description:
        "Sentiers de randonnée et routes forestières de La Réunion (974) ouverts ou fermés, d'après la carte de l'ONF tenue à jour avec les arrêtés " +
        "préfectoraux : cause de la fermeture (éboulement, sentier dégradé, travaux, coulée), date de réouverture prévue. Par nom de sentier, " +
        "autour d'un lieu (Maïdo, Piton des Neiges, Bélouve, Roche Plate…), dans un cirque (Mafate, Cilaos, Salazie) ou une commune ; sans lieu, " +
        "tous les sentiers fermés de l'île. Chaque sentier et chaque randonnée a sa trace GPS (lien GPX), sa longueur et son dénivelé " +
        "(altitudes de l'IGN) ; les itinéraires complets d'OpenStreetMap (GR R1, R2, R3, Piton des Neiges, Roche Écrite, Dolomieu…) sont " +
        "donnés avec l'état des sentiers de l'ONF qu'ils empruntent. Pour : « sentiers fermés à Mafate ? », « le sentier de la Roche Pendue est ouvert ? », " +
        "« on peut randonner à Bélouve ? », « la trace GPS du Piton des Neiges ? », « dénivelé du GR R2 ? », « une rando de 10 km à Cilaos ? » " +
        "(longueur_min_km, longueur_max_km, denivele_max_m filtrent les itinéraires et sentiers proposés). Dès qu'un sentier de l'ONF d'un " +
        "itinéraire est fermé, la réponse porte un champ avertissement, à donner en premier. " +
        "/ Hiking in Réunion Island: open and closed trails (ONF), GPX traces, distance and elevation gain, hikes by length; closure warnings.",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Un sentier ou une randonnée (« sentier de la Roche Pendue », « Piton des Neiges », « GR R2 »), un lieu (« Maïdo »), un cirque (« Mafate ») ou une commune ; vide = toute l'île. / A trail or hike, place, cirque or town; empty = whole island."),
        longueur_min_km: z.number().min(0).optional().describe("Longueur minimale en km d'une randonnée proposée (« une rando de 10 km » : 8). / Minimum length, km."),
        longueur_max_km: z.number().min(0).optional().describe("Longueur maximale en km (« une rando de 10 km » : 12 ; « une petite balade » : 5). / Maximum length, km."),
        denivele_max_m: z.number().min(0).optional().describe("Dénivelé positif maximal en m (« sans trop de dénivelé » : 400). / Maximum elevation gain, m."),
      },
      annotations: { title: "Sentiers de randonnée", ...READ_ONLY },
    },
    track("sentiers_randonnee", (args: { lieu?: string; longueur_min_km?: number; longueur_max_km?: number; denivele_max_m?: number }) =>
      sentiersRandonnee(cache, args.lieu, undefined, { longueur_min_km: args.longueur_min_km, longueur_max_km: args.longueur_max_km, denivele_max_m: args.denivele_max_m })),
  );

  server.registerTool(
    "restrictions_eau",
    {
      title: "Sécheresse : restrictions d'eau à La Réunion",
      description:
        "Restrictions d'eau en cas de sécheresse à La Réunion (974), d'après l'arrêté préfectoral en vigueur (VigiEau) : niveau par commune " +
        "(vigilance, alerte, alerte renforcée, crise) pour l'eau du robinet, les rivières et sources, les nappes, et ce qui est interdit " +
        "(arrosage, lavage de voiture, piscine…) pour un particulier, une entreprise, une collectivité ou une exploitation agricole. " +
        "Pour : « restrictions d'eau à Saint-Joseph ? », « j'ai le droit d'arroser mon jardin au Port ? », « je peux remplir ma piscine ? ». " +
        "Sans lieu : toute l'île. / Drought water-use restrictions in Réunion Island, per commune.",
      inputSchema: {
        lieu,
        profil: z
          .enum(["particulier", "entreprise", "collectivite", "exploitation"])
          .optional()
          .describe("Pour qui (« exploitation » = agriculteur) ; par défaut un particulier. / Who asks; default a private person."),
      },
      annotations: { title: "Restrictions d'eau", ...READ_ONLY },
    },
    track("restrictions_eau", (args: { lieu?: string; profil?: "particulier" | "entreprise" | "collectivite" | "exploitation" }) => restrictionsEau(cache, args.lieu, args.profil)),
  );

  server.registerTool(
    "coupures_eau",
    {
      title: "Coupures d'eau et eau non potable à La Réunion",
      description:
        "Avis des distributeurs d'eau de La Réunion (974) : coupures pour travaux ou lavage de réservoir (heures, rues concernées), pannes, " +
        "et avis « ne pas boire l'eau » quand l'eau n'est plus potable. Saint-Denis (Dionéo), La Possession, les communes de l'Est " +
        "(Saint-André, Bras-Panon, Saint-Benoît, La Plaine-des-Palmistes, Sainte-Rose, Salazie) et runéo. " +
        "Pour : « coupure d'eau à Saint-Denis ? », « l'eau est potable à la Plaine-des-Palmistes ? », « quand revient l'eau ? ». " +
        "Sans lieu : tous les avis récents. / Water cuts and do-not-drink notices from Réunion Island's water distributors.",
      inputSchema: { lieu },
      annotations: { title: "Coupures d'eau", ...READ_ONLY },
    },
    track("coupures_eau", (args: { lieu?: string }) => coupuresEau(cache, args.lieu)),
  );

  server.registerTool(
    "defibrillateurs",
    {
      title: "Défibrillateurs à La Réunion",
      description:
        "Défibrillateurs (DAE) les plus proches d'un lieu de La Réunion (974), d'après la base nationale Géo'DAE : adresse, distance et temps à pied, " +
        "emplacement exact, accessible à toute heure ou aux heures d'ouverture. Plus de 1 200 appareils dans les 24 communes. " +
        "Pour : « où est le défibrillateur le plus proche de la plage de l'Hermitage ? », « défibrillateur à Cilaos ? ». " +
        "Rappelle d'appeler le 15 ou le 112. / Nearest public defibrillators (AED) in Réunion Island.",
      inputSchema: { lieu },
      annotations: { title: "Défibrillateurs", ...READ_ONLY },
    },
    track("defibrillateurs", async (args: { lieu?: string }) => defibrillateurs(args.lieu)),
  );

  server.registerTool(
    "sport",
    {
      title: "Sport à La Réunion : matchs, résultats, Grand Raid",
      description:
        "Sport à La Réunion (974) : rendez-vous à venir et derniers résultats officiels des championnats régionaux de handball (D1) et de volley (R1), " +
        "classements, régates de voile, compétitions de golf, rallyes et sport automobile (calendrier de la Ligue), Grand Raid (courses, " +
        "partants, abandons, podiums), et l'actualité sportive de Réunion La 1ère (titres et liens, dont le football). " +
        "Pour : « quels matchs ce week-end ? », « résultats du volley à Saint-Leu ? », « classement du handball ? », « prochaine régate ? », " +
        "« prochain rallye ? », « qui a gagné le Grand Raid ? ». / Sport in Réunion Island: fixtures, results, standings, Grand Raid.",
      inputSchema: {
        sport: z
          .enum(SPORTS as [Sport, ...Sport[]])
          .optional()
          .describe("Le sport ; vide = tous. « football » renvoie l'actualité seulement (pas de résultats officiels lisibles). / The sport; empty = all."),
        lieu: z
          .string()
          .optional()
          .describe("Une commune (« Saint-Paul », « Saint-Leu ») : les rendez-vous qui la nomment. Vide = toute l'île. / A town; empty = whole island."),
        quand: z
          .enum(["aujourd_hui", "ce_week_end", "a_venir", "resultats"])
          .optional()
          .describe("« aujourd_hui », « ce_week_end », « a_venir » (14 jours) ou « resultats » ; vide = les deux. / Today, this weekend, upcoming or results; empty = both."),
      },
      annotations: { title: "Sport", ...READ_ONLY },
    },
    track("sport", (args: { sport?: Sport; lieu?: string; quand?: Quand }) => sportTool(cache, args.sport, args.lieu, args.quand)),
  );

  server.registerTool(
    "cyclones",
    {
      title: "Cyclones dans le sud-ouest de l'océan Indien",
      description:
        "Systèmes tropicaux actifs autour de La Réunion (974), d'après les bulletins du CMRS de La Réunion (Météo-France) republiés par GDACS : " +
        "stade (dépression, tempête tropicale modérée ou forte, cyclone tropical, intense), vent moyen, pression, position, distance et direction " +
        "depuis La Réunion ou un lieu, déplacement, prévision officielle et passage au plus près ; alerte cyclonique de la préfecture. " +
        "Hors saison : le dit, avec le dernier système et ceux de la saison. " +
        "Pour : « il y a un cyclone en ce moment ? », « où est la tempête ? », « elle va passer près de Saint-Philippe ? », « le dernier cyclone ? ». " +
        "/ Active tropical cyclones near Réunion Island (RSMC La Réunion advisories via GDACS), distance, movement, official forecast.",
      inputSchema: { lieu },
      annotations: { title: "Cyclones", ...READ_ONLY },
    },
    track("cyclones", (args: { lieu?: string }) => cyclones(cache, args.lieu)),
  );

  server.registerTool(
    "historique_meteo",
    {
      title: "Historique météo mesuré à La Réunion",
      description:
        "Météo MESURÉE les jours passés à La Réunion (974), par les stations Météo-France, de leur première année (1900 pour les plus anciennes) jusqu'à hier : " +
        "pluie, températures minimales et maximales, ensoleillement (heures de soleil, jours gris), rafales, jour par jour sur deux mois au plus, " +
        "par mois ou par année au-delà, comparés à la normale 1991-2020 de la station, avec ses records (chaleur, froid, pluie en un jour, rafale). " +
        "Sur 3 jours ou moins (7 avec detail « heure »), depuis 2000, aussi HEURE PAR HEURE, nuit dernière comprise : à quelle heure il a plu, quand le soleil s'est caché, rafale max et à quelle heure. " +
        "Pour toute question sur le temps qu'il a fait : « il a beaucoup plu ce mois-ci à Saint-Benoît ? », « il fait gris tous les jours depuis deux semaines au Tampon ? », " +
        "« quelle température hier à Cilaos ? », « il a fait combien le 24 octobre 2006 ? », « record de chaleur à Saint-Denis ? », « c'est normal ce temps pour octobre ? », " +
        "« à quelle heure a-t-il plu hier à Cilaos ? », « rafale max cette nuit à Sainte-Marie ? », « le soleil s'est caché à quelle heure ? ». " +
        "Pour maintenant, utiliser meteo_actuelle ; pour les jours à venir, prevision_meteo. " +
        "/ Past MEASURED weather in Réunion Island (Météo-France stations, daily, back to their first year, up to yesterday): rain, min/max temperature, " +
        "sunshine, gusts, against the 1991-2020 normal and the station's records; hour by hour since 2000 for periods of a few days, last night included.",
      inputSchema: {
        lieu,
        jours: z.number().int().min(1).max(3650).optional()
          .describe("Les N derniers jours jusqu'à hier (30 par défaut). / The last N days up to yesterday (default 30)."),
        du: z.string().optional()
          .describe("Début : « 2026-10-01 », « 01/10/2026 », « 2026-10 » (un mois), « 2006 » (une année). Seul, c'est ce jour, ce mois ou cette année. / Start date, month or year."),
        au: z.string().optional().describe("Fin, même format. Pour « cette nuit » ou « ce matin », la date d'aujourd'hui. / End, same format; today's date for last night or this morning."),
        detail: z.enum(["jour", "heure"]).optional()
          .describe("« heure » : heure par heure jusqu'à 7 jours (sinon automatique sur 3 jours ou moins) ; « jour » : sans le détail horaire. / 'heure' forces hourly detail up to 7 days; 'jour' leaves it out."),
      },
      annotations: { title: "Historique météo", ...READ_ONLY },
    },
    track("historique_meteo", (args: { lieu?: string; jours?: number; du?: string; au?: string; detail?: "jour" | "heure" }) => historiqueMeteo(cache, args.lieu, { jours: args.jours, du: args.du, au: args.au, detail: args.detail })),
  );

  server.registerTool(
    "evenements",
    {
      title: "Événements à La Réunion : concerts, spectacles, fêtes, festivals, marchés",
      description:
        "Événements à venir à La Réunion (974) : concerts, théâtre, danse, humour, cirque, soirées, fêtes, festivals, marchés, cinéma en " +
        "plein air, animations municipales. D'après les programmes des salles (TÉAT Champ Fleuri et Plein Air, Cité des Arts et Palaxa, " +
        "CDNOI, Kabardock, Le Séchoir, Léspas, Bisik, Théâtre Luc Donat), les agendas des mairies (" +
        `${MAIRIES_LUES}), de la CINOR et de l'office de tourisme du Nord (OpenAgenda) et reunion.fr. Chaque événement : ` +
        "titre, date et heures (heure de La Réunion), salle, commune, genre, prix et lien de billetterie quand ils sont donnés, statut " +
        "(ANNULÉ, REPORTÉ, complet), y compris quand c'est un média de l'île qui l'annonce avant l'organisateur (statut_d_apres). " +
        "Pour : « que faire ce week-end à Saint-Paul ? », « concert ce soir ? », « spectacle à Saint-Denis samedi ? », « marché forain demain ? », « c'est quand la fête de l'ail ? ». " +
        "/ Upcoming events in Réunion Island (concerts, shows, theatre, festivals, markets) from venues, town halls, OpenAgenda and the tourist board.",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Une commune ou un lieu (« Saint-Paul », « Saint-Gilles ») : les événements de sa commune. Vide = toute l'île. / A town or place; empty = whole island."),
        quand: z
          .string()
          .optional()
          .describe("« aujourd_hui », « ce_soir », « demain », « ce_week_end », « cette_semaine », « a_venir » (30 jours), un jour (« samedi ») ou une date (« 2026-10-31 ») ; vide = les 14 jours qui viennent. / When; empty = next 14 days."),
        quoi: z
          .string()
          .optional()
          .describe("Le genre (« concert », « spectacle », « théâtre », « danse », « humour », « soirée », « festival », « marché », « cinéma », « enfants », « sport », « exposition ») ou des mots du titre ou de la salle (« ail », « dragon boat », « Kabardock ») ; vide = tout. / Kind, or words of the title or venue; empty = all."),
      },
      annotations: { title: "Événements", ...READ_ONLY },
    },
    track("evenements", (args: { lieu?: string; quand?: string; quoi?: string }) => agenda(cache, args.lieu, args.quand, args.quoi)),
  );

  server.registerTool(
    "actualites",
    {
      title: "Actualités de La Réunion en direct : manifestations, blocages, routes, faits divers",
      description:
        "Ce qui se passe en ce moment à La Réunion (974), d'après les médias de l'île (Réunion La 1ère, Clicanoo, Imaz Press et son direct, Freedom, " +
        "Parallèle Sud, Témoignages) relus toutes les 5 minutes, et les communiqués de la préfecture : pour chaque information, l'heure, le média, " +
        "le titre, la première phrase, les communes et lieux nommés, ce qu'elle dit du lieu demandé, le lien vers l'article. Par lieu (commune, quartier) " +
        "et par sujet (manifestations et blocages, routes, météo, volcan, eau, faits divers, santé, politique, culture, sport). " +
        "Pour : « il y a des blocages à Saint-Pierre ? », « la manifestation se passe comment ? », « quoi de neuf à Saint-Benoît ? », « route fermée ? », " +
        "« dernières infos sur le cyclone ». / Live local news of Réunion Island: headlines of the local media and their live blogs, prefecture releases, by place and subject.",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Une commune ou un lieu (« Saint-Pierre », « Ravine des Cabris », « Saint-Gilles ») : les informations qui le nomment. Vide = toute l'île. / A town or place; empty = whole island."),
        sujet: z
          .string()
          .optional()
          .describe("« mobilisation » (manifestations, blocages, barrages), « route », « meteo », « volcan », « eau », « securite », « sante », « politique », « culture », « sport », ou des mots du titre ; vide = tout. / Subject or words; empty = all."),
        heures: z
          .number()
          .optional()
          .describe("Depuis combien d'heures (1 à 72, 24 par défaut). / How many hours back (1-72, default 24)."),
      },
      annotations: { title: "Actualités", ...READ_ONLY },
    },
    track("actualites", (args: { lieu?: string; sujet?: string; heures?: number }) => actualites(cache, args.lieu, args.sujet, args.heures)),
  );

  server.registerTool(
    "donner_avis",
    {
      title: "Donner un avis à rundata.re",
      description:
        "Transmet à rundata.re, qui tient ce serveur, un avis sur ses données : une donnée qui manque (« manque »), une valeur qui " +
        "semble fausse ou périmée (« erreur »), une idée (« suggestion »), ou un remerciement (« bravo »). L'appeler sans attendre qu'on le " +
        "demande quand un outil n'a pas trouvé ce que l'utilisateur cherchait, a renvoyé quelque chose de faux ou d'incomplet, ou quand " +
        "l'utilisateur exprime un souhait ou une plainte sur ces données : c'est ainsi que le service s'améliore. Écrire un message court et " +
        "concret (quel outil, quel lieu, ce qui manquait). Ne mettre aucune donnée personnelle ; si le contenu touche la personne " +
        "(son adresse, sa santé…), lui demander d'abord son accord. Les avis sont lus par une personne, sans réponse directe. " +
        "/ Send feedback to rundata.re: missing data, a wrong value, a suggestion or thanks. Use it when a tool lacked data or erred, or the user voiced a wish or complaint; no personal data.",
      inputSchema: {
        type: z.enum(avis.TYPES).describe("« manque » (donnée absente), « erreur » (valeur fausse ou périmée), « suggestion », « bravo ». / missing, wrong, suggestion, praise."),
        message: z.string().trim().min(3).max(avis.MESSAGE_MAX).describe(`L'avis, en quelques phrases (${avis.MESSAGE_MAX} caractères au plus), sans donnée personnelle. / The feedback, no personal data.`),
        outil: z.string().max(avis.COURT_MAX).optional().describe("L'outil concerné (« meteo_actuelle », « transports »…). / The tool concerned."),
        lieu: z.string().max(avis.COURT_MAX).optional().describe("Le lieu concerné (« Cilaos », « plage de l'Hermitage »). / The place concerned."),
        question_utilisateur: z
          .string()
          .max(avis.QUESTION_MAX)
          .optional()
          .describe("La question de l'utilisateur, reformulée sans rien de personnel. / The user's question, paraphrased, nothing personal."),
      },
      annotations: { title: "Donner un avis", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    track("donner_avis", async (args: { type: avis.TypeAvis; message: string; outil?: string; lieu?: string; question_utilisateur?: string }, extra) => {
      const message = avis.nettoie(args.message, avis.MESSAGE_MAX);
      if (!message) return { ...text({ erreur: "Le message est vide." }), isError: true };
      if (!avis.enabled()) {
        return { ...text({ erreur: `Ce serveur ne garde pas les avis. Les donner sur ${SITE_URL} (formulaire en bas de chaque page) ou sur ${SITE_URL}/mcp.` }), isError: true };
      }
      const headers = extra.requestInfo?.headers ?? {};
      const ua = [headers["user-agent"]].flat()[0] ?? "";
      const issue = await avis.enregistrer(
        {
          canal: "mcp",
          type: args.type,
          message,
          outil: avis.nettoie(args.outil, avis.COURT_MAX),
          lieu: avis.nettoie(args.lieu, avis.COURT_MAX),
          question: avis.nettoie(args.question_utilisateur, avis.QUESTION_MAX),
          client: avis.clientOf(ua),
        },
        avis.adresseOf(headers),
      );
      if (issue === "limite") return { ...text({ erreur: "Beaucoup d'avis reçus depuis cette adresse en une heure : réessayer plus tard." }), isError: true };
      if (issue === "indisponible") return { ...text({ erreur: `L'avis n'a pas pu être enregistré pour le moment. Il peut aussi être laissé sur ${SITE_URL} (formulaire en bas de chaque page).` }), isError: true };
      return text({ merci: `Avis transmis à rundata.re, merci. Il sera lu ; les nouveautés sont annoncées sur ${SITE_URL}.` });
    }),
  );

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
        sources: [...weatherProviders().map((p) => p.source), ...(vigilance.enabled() ? [vigilance.SOURCE] : []), acspo.SOURCE, modis.SOURCE, seismes.SOURCE, volcanSources.OVPF, volcanSources.PITONLIVE, edf.SOURCE, calendar.SCHOOL, calendar.HOLIDAYS, atmo.SOURCE, annuaire.SOURCE, ...Object.values(terrain.SOURCES), ...(transit.enabled() ? [transit.SOURCE, gtfsrt.SOURCE] : []), velos.SOURCE, maregraphes.SOURCE, vigicrues.SOURCE, irve.SOURCE, eauPotable.SOURCE, baignades.SOURCE, onf.SOURCE, vigieau.SOURCE, avisEau.SOURCE, dae.SOURCE, ...Object.values(sportSources.SOURCES), gdacs.SOURCE, ...agendaSources.SOURCES_LUES, ...Object.values(actuSources.SOURCES), ...Object.values(traceSources.SOURCES), ...(climat.enabled() ? [climat.SOURCE] : []), ...(climat.hourlyEnabled() ? [climat.SOURCE_HORAIRE] : []), ...(arome.enabled() ? [arome.SOURCE] : []), openmeteo.SOURCE],
        lieux: GAZETTEER_ATTRIBUTION,
        couverture: { meteo: weatherCoverage(), mer: SEA_COVERAGE, previsions: forecastCoverage(), evenements: AGENDA_COVERAGE },
        version: VERSION,
      }),
    ),
  );

  return server;
}
