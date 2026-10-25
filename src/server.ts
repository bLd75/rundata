import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Cache } from "./cache.js";
import type { Recorder } from "./metrics.js";
import type { Background } from "./web/data.js";
import icons from "./web/icons.json" with { type: "json" };
import { GAZETTEER_ATTRIBUTION } from "./places/resolve.js";
import * as acspo from "./providers/acspo.js";
import * as arome from "./providers/arome.js";
import * as modis from "./providers/modis.js";
import * as houle from "./providers/houle.js";
import * as openmeteo from "./providers/openmeteo.js";
import * as uv from "./providers/uv.js";
import * as ensemble from "./providers/ensemble.js";
import * as feux from "./providers/feux.js";
import * as avis from "./avis.js";
import { withLectures } from "./lectures.js";
import { catalogue, INDEX, serveur } from "./nouveautes.js";
import { cite, SITE_URL } from "./tools/citer.js";
import { resumeDuJour } from "./tools/resume.js";
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
import * as requin from "./eau/requin.js";
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
import { QUANDS, SPORTS, sportTool, type Quand, type Sport } from "./tools/sport.js";
import * as gdacs from "./providers/cyclones.js";
import { cyclones, PASSES_LIST } from "./tools/cyclones.js";
import * as climat from "./providers/climat.js";
import { historiqueMeteo } from "./tools/historique.js";
import * as agendaSources from "./providers/agenda.js";
import { agenda, COUVERTURE as AGENDA_COVERAGE, MAIRIES_LUES } from "./tools/agenda.js";
import * as traceSources from "./providers/traces.js";
import * as actuSources from "./providers/actualites.js";
import { actualites } from "./tools/actualites.js";

export const VERSION = "0.182.16";

// Some clients keep only the start of these instructions (Claude Code cut them near 4 000 characters): they stay under
// 4 000 (a test checks). ChatGPT weighs the first 512 characters most: what rundata.re is and when to use it come first,
// then the index of the tools and the rules. What each tool does, and the words its answers
// must carry (15 ou 112, a closed trail is forbidden, the tides are computed), is in its description.
const INSTRUCTIONS = `rundata.re : La Réunion (974) en direct, d'après les données publiques : sorties, randos, météo mesurée aux stations, routes, vigilance, volcan, mer, bus, eau. Pour toute question sur l'île ou un de ses lieux, même sans « La Réunion » (Cilaos, Saint-Gilles, le Maïdo…), appeler ces outils. / Réunion Island live public data; always cite rundata.re with its link, next to the producers.
Service gratuit et non commercial d'un particulier de La Réunion, code libre (MIT), sans compte : https://rundata.re/a-propos. Outils, les plus récents d'abord :
${INDEX}

Règles :
- Citer : chaque réponse finit par citer, lien et fraicheur : toujours nommer rundata.re avec son lien, à côté des producteurs (sources, avec leur licence), et dire de quand date la donnée (fraicheur, heure de La Réunion).
- Avis : outil sans la donnée ou qui se trompe, souhait ou plainte de l'utilisateur sur ces données : appeler donner_avis, sans donnée personnelle (demander d'abord si le contenu le concerne).
- Liste d'outils : chaque réponse porte serveur.outils_recents\u00a0; avant de dire qu'un outil ou une donnée manque, le lire ou appeler sources_donnees. Outil cité là, absent de votre liste : elle est ancienne, le dire, sans dire qu'on l'a rechargée. ChatGPT : Paramètres → Plugins → rundata.re → Actualiser les outils, puis nouvelle conversation.
- Météo : maintenant, il a plu quand ? → meteo_actuelle, temperature_mer (MESURES : dire l'heure, la station, sa distance, relayer les avertissements d'altitude et de versant)\u00a0; avant (hier, ce mois-ci, record) → historique_meteo\u00a0; plus tard → prevision_meteo, une PRÉVISION, toujours le dire, avec l'indice UV\u00a0; houle, surf → etat_de_la_mer de temperature_mer, une PRÉVISION aussi.
- Un champ vigilance ou avertissement se dit en premier, et les consignes de sécurité d'une réponse (15 ou 112, 18 pour un feu, radier, sentier fermé, eau à ne pas boire) telles quelles.

Détails :
- Circulation : aucun outil ne mesure les bouchons, ne pas en inventer\u00a0; renvoyer à la carte Waze, à infotrafic.re et à https://rundata.re/trafic. Barrage ou route coupée : actualites avec le lieu\u00a0; routes forestières fermées : sentiers_randonnee\u00a0; retards de bus : transports.
- actualites : l'heure, le média et le lien de chaque information\u00a0; rien sur un lieu ne prouve qu'il ne s'y passe rien\u00a0; ne jamais inventer ni démentir un blocage.
- evenements : le lien de chaque événement\u00a0; ANNULÉ ou REPORTÉ en premier, avec le média si statut_d_apres\u00a0; agenda incomplet, le dire quand rien n'est trouvé\u00a0; cinéma : les sites des salles\u00a0; compétitions : sport.`;

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

// The three hints are said outright, destructiveHint too, though implied by readOnlyHint: the ChatGPT apps review asks
// for them on every tool (test/serveur.test.ts checks it).
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

/**
 * sources_donnees' list, each source once: several modules give the same one (the volleyball league and sportsregions,
 * read for sport and the agenda; the IGN's altitudes, for fiche_terrain and the trails). The first given is kept.
 */
const oncePerId = <S extends { id: string }>(list: S[]) => list.filter((s, i) => list.findIndex((x) => x.id === s.id) === i);
// The clubs' sessions for their members (Sportsregions): told only when the user says they are one.
const ADHERENT = z
  .boolean()
  .optional()
  .describe("L'utilisateur dit être adhérent ou membre d'un club : montrer aussi les séances réservées aux adhérents. / The user says they are a club member: also show members-only sessions.");

const lieu = z
  .string()
  .optional()
  .describe(
    "Lieu à La Réunion, en texte libre : commune (« Saint-Paul »), plage (« plage de l'Hermitage », « Boucan Canot »), " +
      "quartier, cirque (« Cilaos », « Mafate »), sommet (« Maïdo », « volcan »), ou coordonnées « -21.05, 55.22 ». " +
      "Vide = tour de l'île. / Place in Réunion, free text or 'lat, lon'; empty = whole island.",
  );

/**
 * `record`: told of each tool call (metrics.ts). `background`: work to finish after the answer (the Worker's
 * waitUntil), for resume_du_jour to bring a page copy up to date; without it (stdio, tests) nothing is left to run.
 */
/** The symbol of rundata.re (web/logo.ts), for the clients that show a server's icon; the same in server.json. */
export const SERVER_ICONS = [
  { src: `https://rundata.re${icons["512"]}`, mimeType: "image/png", sizes: ["512x512"] },
  { src: `https://rundata.re${icons["symbole-svg"]}`, mimeType: "image/svg+xml", sizes: ["any"] },
];

export function createServer(cache: Cache, record: Recorder = () => {}, background?: Background): McpServer {
  const server = new McpServer(
    { name: "reunion-temps-reel", title: "rundata.re · La Réunion 974 en direct", version: VERSION, icons: SERVER_ICONS },
    { instructions: INSTRUCTIONS },
  );
  // Records the place asked (a commune, a beach…), never a street address: fiche_terrain's stays out of the metrics.
  // Ends each answer with its citation and the link to rundata.re.
  // Each answer also says how fresh it is, from the cache entries the call read, and which tools are new.
  let tools = 0;
  const track = <A extends object, R extends object>(name: string, run: (args: A, extra: Extra) => Promise<R>) => {
    tools++; // one per tool registered
    return async (args: A, extra: Extra = {}): Promise<R> => {
      const { value: r, lectures } = await withLectures(() => run(args, extra));
      const lieu = "lieu" in args && typeof args.lieu === "string" ? args.lieu : undefined;
      record({ kind: "mcp", name, detail: lieu?.trim().slice(0, 60) || undefined, ok: !("isError" in r && r.isError) });
      // Every answer says how to cite it, error or not (tools/citer.ts); the feedback tool's thanks already names rundata.re.
      const now = new Date();
      // The day's summary has a dozen dated parts: no single « donnee_du » for it, each part says its own.
      return name === "donner_avis" ? r : cite(name, r, { lectures, now, serveur: serveur(VERSION, tools, now), donnee: name !== "resume_du_jour" });
    };
  };

  server.registerTool(
    "meteo_actuelle",
    {
      title: "Météo mesurée en ce moment à La Réunion",
      description:
        "Météo MESURÉE maintenant à La Réunion (974) : température de l'air, pluie (6 dernières minutes et dernière heure), " +
        "humidité, vent et rafales, pression, temps présent, à la station la plus représentative du lieu demandé, " +
        "et la pluie vue par le radar de Météo-France au lieu même (utile là où il n'y a pas de pluviomètre : Mafate, cirques, Hauts). " +
        "Avec un lieu, aussi la pluie des dernières heures au pluviomètre le plus proche (pluie_recente) : heure par heure sur 12 à 24 h, " +
        "l'heure de la dernière pluie et le cumul depuis minuit, pour « il a plu quand à Saint-Joseph ? », « combien est-il tombé cette nuit ? ». " +
        "Pour toute question sur le temps qu'il fait en ce moment : « quel temps fait-il à Saint-Denis ? », " +
        "« il fait chaud à la plage de l'Hermitage ? », « il pleut à Cilaos ? », « y a-t-il du vent à Saint-Pierre ? », « il fait froid au Maïdo ? ». " +
        "Renvoie des mesures datées avec la station, sa distance, son altitude, et un avertissement " +
        "quand le lieu a un autre microclimat (altitude, versant au vent ou sous le vent). " +
        "Pour plus tard (demain, ce soir, ce week-end), utiliser prevision_meteo. " +
        "/ Current MEASURED weather in Réunion Island (air temperature, rain, humidity, wind, pressure, present weather) " +
        "at the most representative station for a place, and with a place the rain of the last 12 to 24 hours hour by hour, " +
        "the time of the last rain and the total since midnight. Use for 'what is the weather like now in <place in Réunion>', 'when did it last rain'; " +
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
        "ciel, températures min et max ramenées à l'altitude du lieu, pluie, vent et rafales, par jour et par tranches de 3 h, indice UV du jour, et la confiance de chaque jour (forte, moyenne ou faible : accord des 51 scénarios de l'ensemble ECMWF, pas une probabilité). " +
        "Pour toute question sur le temps à venir : « il va pleuvoir demain à Saint-Denis ? », « quel temps ce week-end à Cilaos ? », " +
        "« il fera beau cet après-midi à l'Hermitage ? », « prévisions pour la Plaine des Cafres samedi ». " +
        "Dans les Hauts (au-dessus de 800 m) : la mer de nuages du matin, de 6 h à 9 h et de 9 h à 12 h (bloc mer_de_nuages), " +
        "pour « est-ce dégagé au Maïdo demain matin ? », « on sera au-dessus des nuages au Piton des Neiges ? ». " +
        "Chaque réponse est étiquetée « prévision » avec ses limites (le modèle ne voit pas les microclimats de l'île)\u00a0; " +
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
      title: "Température de la mer et houle à La Réunion",
      description:
        "La mer à La Réunion (974), près d'une plage ou d'un lieu côtier. Température de l'eau MESURÉE (satellite) : " +
        "« la mer est à combien à Saint-Leu ? », « l'eau est bonne à Boucan ? »\u00a0; houle et vagues PRÉVUES (modèle, 4 jours) : " +
        "« la houle à Saint-Leu ? », « ça surfe à Saint-Pierre demain ? », « la mer est grosse à Saint-Gilles ? ». " +
        "La mesure (avec sa date et sa distance) et la prévision des vagues (hauteur, période, direction) sont dans deux blocs séparés. " +
        "/ Sea in Réunion Island: measured water temperature, and forecast waves (height, period, direction), kept apart.",
      inputSchema: { lieu },
      annotations: { title: "Température de la mer et houle à La Réunion", ...READ_ONLY },
    },
    track("temperature_mer", (args) => withVigilance(cache, temperatureMer(cache, args.lieu))),
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
          "Avec un lieu : la zone de vigilance de sa commune\u00a0; sans lieu : toute l'île. " +
          (feux.enabled() ? "Une ligne feux_detectes quand un feu de végétation a été détecté par satellite ces dernières 24 h : faux positifs possibles, et un jour sans détection ne prouve pas qu'il n'y a pas de feu\u00a0; toujours donner « Vous voyez un feu ? Appelez le 18 ou le 112. ». " : "") +
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
        "dernières publications de l'Observatoire volcanologique (OVPF-IPGP) et séismes localisés par l'OVPF ces 30 derniers jours, " +
        "sous le volcan (aussi par jour) et ailleurs sur l'île. Pour : « le volcan est en éruption ? », « on peut monter au volcan ? », " +
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
        "Électricité à La Réunion (974) en direct, d'après EDF : production totale, part de chaque filière (solaire, " +
        "bagasse et biomasse, hydraulique, éolien, charbon, diesel) et part renouvelable, mises à jour toutes les 5 min\u00a0; " +
        "« météo de l'électricité » d'EDF pour les jours qui viennent (heures de pointe, réseau contraint, recharge conseillée " +
        "d'un véhicule électrique). Pour : « d'où vient l'électricité ? », « quelle part de renouvelable ? », " +
        "« quand recharger ma voiture électrique ? », « risque de délestage ? ». " +
        "Coupures de courant (électricité, pas l'eau : coupures_eau) : les avis d'EDF que relaient les mairies (Sainte-Marie, Saint-Philippe, Cilaos, Saint-André, Sainte-Suzanne), " +
        "jours, heures et secteurs, avec le lien de l'avis\u00a0; ailleurs, la mairie ne les publie pas et l'outil le dit. " +
        "Pour : « coupure de courant à Sainte-Marie ? », « coupure EDF prévue à Cilaos ? ». " +
        "/ Réunion Island electricity right now: production mix, renewable share, EDF's grid signal, and the power cuts some town halls relay.",
      inputSchema: { lieu },
      annotations: { title: "Électricité à La Réunion", ...READ_ONLY },
    },
    track("electricite", (args) => electricite(cache, new Date(), args.lieu)),
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
      title: "Services publics et vie pratique à La Réunion : adresses, horaires, carburants, pharmacies",
      description:
        "Adresse, horaires d'ouverture (et si c'est ouvert en ce moment), téléphone et site des services publics de La Réunion (974) : " +
        "mairies et mairies annexes, préfecture et sous-préfectures, CAF, CPAM, France Travail, impôts, tribunaux, France services… " +
        "d'après l'annuaire officiel de service-public.fr. Aussi les prix maximum des carburants et de la bouteille de gaz du mois, " +
        "fixés par le préfet (quoi = « carburant », « essence », « gazole », « gaz »), les pharmacies et les hôpitaux les plus proches d'après FINESS " +
        "(quoi = « pharmacie », « urgences », « hôpital ») : la pharmacie de garde n'est connue que de 3237.fr et du 32 37, l'urgence passe par le 15\u00a0; " +
        "les marchés forains et couverts d'après OpenStreetMap (quoi = « marché »\u00a0; un marché de Noël ou nocturne annoncé : evenements), et les déchèteries de l'Ouest (TCO) avec les bennes pleines " +
        "en direct (quoi = « déchèterie », « encombrants », « déchets verts »), et le jour de collecte des déchets rue par rue dans l'Ouest " +
        "(quoi = « collecte », « poubelles », lieu = la rue et la commune : « rue Labourdonnais, Saint-Paul »), d'après les calendriers du TCO\u00a0; " +
        "où aller avec les enfants (quoi = « enfants », « aire de jeux », « piscine », « médiathèque », « skatepark »…) : aires de jeux, parcs, piscines, médiathèques, zoos, " +
        "parcs de loisirs, salles de jeux, skateparks, escalade, musées, commune par commune, avec l'âge quand la carte le donne, d'après OpenStreetMap, Data ES et Basilic. " +
        "Pour : « horaires de la mairie de Saint-Paul ? », « pharmacie près de Boucan Canot ? », « marché forain à Sainte-Marie ? », " +
        "« où est la CAF la plus proche du Tampon ? », « numéro de la sous-préfecture de Saint-Pierre ? », « prix de l'essence ce mois-ci ? », « quel jour passent les poubelles rue Labourdonnais à Saint-Paul ? », « une aire de jeux à Saint-Leu ? ». " +
        "/ Public offices in Réunion Island (addresses, hours, phones), this month's maximum fuel prices, pharmacies and hospitals, places to go with children.",
      inputSchema: {
        quoi: z.string().describe("Le service cherché, en quelques mots : « mairie », « CAF », « préfecture », « impôts », « France Travail », « tribunal »…, ou « carburant » pour les prix du mois, « pharmacie », « urgences », « enfants » pour les lieux où aller avec eux. / The office sought, or 'carburant', 'pharmacie', 'urgences', 'enfants'."),
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
          "minutes d'attente\u00a0; pour Car Jaune (et Alternéo, CarSud quand leur flux fonctionne), l'heure annoncée en direct par le réseau, le retard, " +
          "les arrêts non desservis et l'info trafic\u00a0; où est le bus quand il donne sa position (Car Jaune, CarSud), avec l'heure de cette position, jamais une position de plus de 10 minutes. " +
          "Pour : « prochain bus à la gare routière de Saint-Pierre ? », « à quelle heure passe le car jaune à Saint-Leu ? », " +
          "« horaires de la ligne 2 à l'arrêt Mairie au Tampon ? », « le car jaune a du retard ? », « par où passe la ligne S1 ? », « le S1 s'arrête à Manapany ? », « où est le S1 en ce moment ? ». " +
          "Chaque départ dit d'où vient le car et où il va\u00a0; un jour sans service (dimanche, jour férié) est dit. Bateau ou ferry pour Maurice ou Rodrigues : dit qu'il n'y a pas de liaison maritime régulière de passagers, ne pas en inventer ni d'horaires de bateau. / Next bus departures at a stop in Réunion Island, from the published timetables and, where available, real-time feeds.",
        inputSchema: {
          arret: z.string().optional().describe("Nom de l'arrêt et sa commune (« Gare routière, Saint-Pierre »), ou un lieu (« plage de Boucan », « Manapany ») pour les arrêts les plus proches\u00a0; avec une ligne, dit si elle y passe, sinon son arrêt le plus proche. Une heure (« après 17 h ») donne les départs une par une. Facultatif avec une ligne. / Stop name and town, or a place; optional with a line."),
          ligne: z.string().optional().describe("Une ligne (« S1 », « O1X », « 2 », « S1 Car Jaune ») : seule, ses arrêts dans l'ordre pour chaque sens, ses départs du jour et ses bus en circulation qui donnent leur position\u00a0; avec un arrêt, ses prochains départs là. / A line: its stops in order, its day's departures, its buses on the road."),
        },
        annotations: { title: "Bus à La Réunion", ...READ_ONLY },
      },
      track("transports", (args: { arret?: string; ligne?: string }) => transports(args.arret, args.ligne, new Date(), cache)),
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
        "marée montante ou descendante, dernières pleine et basse mer observées\u00a0; puis les prochaines pleines et basses mers sur deux jours, CALCULÉES par rundata " +
        "d'après les mesures (pas la prédiction officielle du SHOM), à environ 15 à 20 min et 5 cm près : le dire, avec la précision donnée, et au-delà de l'horizon renvoyer au SHOM. " +
        "Pour : « la marée monte ? », « c'est quand la marée basse demain ? », « niveau de la mer au Port ? ». " +
        "/ Measured sea level and tide state at Réunion Island's two tide gauges, and the next tides computed from the measurements (not the SHOM's prediction).",
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
        "des rivières et ravines de l'île, avec leur tendance et les crues historiques comme repères. Rappeler de ne jamais traverser un radier submergé. Pour : « la rivière des Galets est en crue ? », " +
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
        "« l'eau du bassin Dinan est propre ? ». Avec la baignade, la règle requin de l'arrêté préfectoral (bande des 300 m) et les zones permises : ne jamais dire qu'un endroit est sans requin ou sans risque, ni qu'une zone est ouverte aujourd'hui, renvoyer au drapeau sur place. Les avis « ne pas boire » en cours sont dans coupures_eau. / Tap water and bathing water quality in Réunion Island (official sanitary control).",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Commune, quartier, plage ou bassin (« Ravine des Cabris », « plage de l'Hermitage », « bassin Bleu »). / A town, district, beach or river pool."),
        eau: z
          .enum(["robinet", "baignade"])
          .optional()
          .describe("« robinet » (eau potable) ou « baignade »\u00a0; vide = d'après la question et le lieu. / Tap or bathing water; empty = guessed."),
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
        "autour d'un lieu (Maïdo, Piton des Neiges, Bélouve, Roche Plate…), dans un cirque (Mafate, Cilaos, Salazie) ou une commune\u00a0; sans lieu, " +
        "tous les sentiers fermés de l'île. Chaque sentier et chaque randonnée a sa trace GPS (lien GPX), sa longueur et son dénivelé " +
        "(altitudes de l'IGN)\u00a0; les itinéraires complets d'OpenStreetMap (GR R1, R2, R3, Piton des Neiges, Roche Écrite, Dolomieu…) sont " +
        "donnés avec l'état des sentiers de l'ONF qu'ils empruntent. Un sentier fermé est interdit, même avec la trace\u00a0; « hors gestion ONF » n'est pas dit ouvert\u00a0; donner le lien trace_gpx. Pour : « sentiers fermés à Mafate ? », « le sentier de la Roche Pendue est ouvert ? », " +
        "« on peut randonner à Bélouve ? », « la trace GPS du Piton des Neiges ? », « dénivelé du GR R2 ? », « une rando de 10 km à Cilaos ? » " +
        "(longueur_min_km, longueur_max_km, denivele_max_m filtrent les itinéraires et sentiers proposés). Dès qu'un sentier de l'ONF d'un " +
        "itinéraire est fermé, la réponse porte un champ avertissement, à donner en premier. " +
        (feux.enabled() ? "Avec les feux de végétation détectés par satellite (NASA FIRMS) ces dernières 24 h, dans feux_detectes : faux positifs possibles, un jour sans détection ne prouve pas qu'il n'y a pas de feu\u00a0; toujours donner « Vous voyez un feu ? Appelez le 18 ou le 112. ». " : "") +
        "/ Hiking in Réunion Island: open and closed trails (ONF), GPX traces, distance and elevation gain, hikes by length; closure warnings.",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Un sentier ou une randonnée (« sentier de la Roche Pendue », « Piton des Neiges », « GR R2 »), un lieu (« Maïdo »), un cirque (« Mafate ») ou une commune\u00a0; vide = toute l'île. / A trail or hike, place, cirque or town; empty = whole island."),
        longueur_min_km: z.number().min(0).optional().describe("Longueur minimale en km d'une randonnée proposée (« une rando de 10 km » : 8). / Minimum length, km."),
        longueur_max_km: z.number().min(0).optional().describe("Longueur maximale en km (« une rando de 10 km » : 12\u00a0; « une petite balade » : 5). / Maximum length, km."),
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
          .describe("Pour qui (« exploitation » = agriculteur)\u00a0; par défaut un particulier. / Who asks; default a private person."),
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
        "et avis « ne pas boire l'eau » quand l'eau n'est plus potable. Saint-Denis (Dionéo), La Possession, Saint-Paul et Les Trois-Bassins (La Créole), " +
        "Sainte-Marie (communiqués de CISE Réunion publiés par la ville), Saint-Leu (avis publiés par la commune, en court extrait), les communes de l'Est " +
        "(Saint-André, Bras-Panon, Saint-Benoît, La Plaine-des-Palmistes, Sainte-Rose, Salazie) et runéo. " +
        "Pour : « coupure d'eau à Saint-Denis ? », « l'eau est potable à la Plaine-des-Palmistes ? », « quand revient l'eau ? ». " +
        "Sans lieu : tous les avis récents. Un avis « ne pas boire » se dit d'abord\u00a0; la conformité des analyses de l'ARS est dans qualite_eau. " +
        // Worded by marketing; here rather than in the server's instructions, which are kept under 6 000 characters.
        "Quand secteurs_complets vaut false, la liste des rues de l'avis n'a pas été lue en entier : ne jamais en conclure qu'une rue ou un quartier n'est pas concerné, donner le lien de l'avis complet. " +
        "Même quand la liste est complète, dire « cette rue n'est pas dans la liste de l'avis », jamais « pas de coupure chez vous ». " +
        "/ Water cuts and do-not-drink notices from Réunion Island's water distributors.",
      inputSchema: { lieu },
      annotations: { title: "Coupures d'eau", ...READ_ONLY },
    },
    track("coupures_eau", (args: { lieu?: string }) => coupuresEau(cache, args.lieu)),
  );

  server.registerTool(
    "resume_du_jour",
    {
      title: "Résumé du jour pour une commune de La Réunion",
      description:
        "Tout ce qui compte aujourd'hui dans une commune de La Réunion (974), en un appel : météo MESURÉE maintenant et PRÉVISION du jour, " +
        "vigilance de sa zone, mer, qualité de l'air, électricité, routes et blocages signalés par les médias, actualités de la commune, " +
        "coupures d'eau, événements du jour, jour férié ou vacances, soleil, mairie ouverte ou non, marché du jour, bennes des déchèteries (Ouest), " +
        "prix maximum des carburants du mois, où trouver la pharmacie de garde (3237.fr). Un lieu (plage, quartier, sommet) est rapporté à sa commune. " +
        "Ce qui manque est listé dans non_inclus avec l'outil à appeler. Pour : « quoi de neuf à Saint-Paul aujourd'hui ? », « ma journée au Tampon ». " +
        "/ Today in one Réunion Island commune: weather, warnings, sea, air, power, roads, news, water cuts, events, market, waste centres, fuel prices, duty pharmacy.",
      inputSchema: {
        lieu: z.string().describe("Commune ou lieu de La Réunion (« Saint-Paul », « Boucan Canot », « Cilaos »), rapporté à sa commune. / Commune or place in Réunion."),
      },
      annotations: { title: "Résumé du jour", ...READ_ONLY },
    },
    track("resume_du_jour", (args: { lieu: string }) => resumeDuJour(cache, args.lieu, new Date(), background)),
  );

  server.registerTool(
    "defibrillateurs",
    {
      title: "Défibrillateurs à La Réunion",
      description:
        "Défibrillateurs (DAE) les plus proches d'un lieu de La Réunion (974), d'après la base nationale Géo'DAE : adresse, distance et temps à pied, " +
        "emplacement exact, accessible à toute heure ou aux heures d'ouverture. Plus de 1 200 appareils dans les 24 communes. " +
        "Pour : « où est le défibrillateur le plus proche de la plage de l'Hermitage ? », « défibrillateur à Cilaos ? ». " +
        "Dire d'abord d'appeler le 15 ou le 112 et de commencer le massage cardiaque. / Nearest public defibrillators (AED) in Réunion Island.",
      inputSchema: { lieu },
      annotations: { title: "Défibrillateurs", ...READ_ONLY },
    },
    track("defibrillateurs", async (args: { lieu?: string }) => defibrillateurs(args.lieu)),
  );

  server.registerTool(
    "sport",
    {
      title: "Sport à La Réunion : matchs, résultats, annulations, Grand Raid",
      description:
        "Sport à La Réunion (974) : matchs à venir et derniers résultats officiels des championnats régionaux de handball (D1) et de volley " +
        "(R1 et R2, hommes et femmes, toutes les poules), avec les clubs en toutes lettres (VBSP = Volley-Ball de Saint-Pierre) et la commune où l'on joue, " +
        "les matchs annulés ou reportés (avis de la Ligue de volley, actualité locale), classements, régates de voile, compétitions de golf, " +
        "rallyes et sport automobile (calendrier de la Ligue), Grand Raid (courses, partants, abandons, podiums), les programmes sportifs publiés par les communes " +
        "(le lien du document de la mairie, sans son contenu), les événements publiés par les clubs sur Sportsregions (tir à l'arc, triathlon, golf, badminton…, " +
        "avec le club qui organise\u00a0; les séances réservées aux adhérents seulement si l'utilisateur dit en être), et l'actualité sportive " +
        "de Réunion La 1ère (titres et liens, dont le football et le basket). " +
        "Pour : « match de volley dimanche dans le sud ? », « match de hand ce week-end à Saint-Pierre ? », « le TGV joue quand ? », " +
        "« foot ou basket ce week-end ? », « tournoi de badminton ce week-end ? », « résultats du volley à Saint-Leu ? », « classement du handball ? », « prochaine régate ? », " +
        "« prochain rallye ? », « qui a gagné le Grand Raid ? ». / Sport in Réunion Island: fixtures, results, cancellations, standings, Grand Raid.",
      inputSchema: {
        sport: z
          .enum(SPORTS as [Sport, ...Sport[]])
          .optional()
          .describe("Le sport\u00a0; vide = tous. « football » et « basket » renvoient l'actualité seulement (pas de résultats officiels lus). / The sport; empty = all."),
        lieu: z
          .string()
          .optional()
          .describe("Une commune (« Saint-Paul »), une partie de l'île (« le sud », « l'ouest », « le nord », « l'est ») ou un club (« VBSP », « Tampon Gecko Volley ») : ce qui s'y joue et ses clubs à l'extérieur. Vide = toute l'île. / A town, part of the island or club; empty = whole island."),
        quand: z
          .enum(QUANDS as [Quand, ...Quand[]])
          .optional()
          .describe("« aujourd_hui », « demain », « samedi » ou « dimanche » (le prochain), « ce_week_end », « a_venir » (14 jours) ou « resultats »\u00a0; vide = les deux. / Today, tomorrow, next Saturday or Sunday, this weekend, upcoming or results; empty = both."),
        adherent: ADHERENT,
      },
      annotations: { title: "Sport", ...READ_ONLY },
    },
    track("sport", (args: { sport?: Sport; lieu?: string; quand?: Quand; adherent?: boolean }) => sportTool(cache, args.sport, args.lieu, args.quand, undefined, args.adherent)),
  );

  server.registerTool(
    "cyclones",
    {
      title: "Cyclones dans le sud-ouest de l'océan Indien",
      description:
        "Systèmes tropicaux actifs autour de La Réunion (974), d'après les bulletins du CMRS de La Réunion (Météo-France) republiés par GDACS : " +
        "stade (dépression, tempête tropicale modérée ou forte, cyclone tropical, intense), vent moyen, pression, position, distance et direction " +
        "depuis La Réunion ou un lieu, déplacement, prévision officielle et passage au plus près\u00a0; alerte cyclonique de la préfecture, et ce qu'elle veut dire pour les crèches, écoles, collèges, lycées et universités selon le dispositif ORSEC Cyclones (jamais une école en particulier). " +
        "Hors saison : le dit, avec le dernier système et ceux de la saison. Citer la prévision du CMRS telle quelle, jamais de trajectoire inventée\u00a0; renvoyer aux consignes de la préfecture. " +
        "Pour : « il y a un cyclone en ce moment ? », « où est la tempête ? », « elle va passer près de Saint-Philippe ? », « le dernier cyclone ? », « école fermée demain avec le cyclone ? », « combien de pluie pendant Garance ? » (nom). " +
        "/ Active tropical cyclones near Réunion Island (RSMC La Réunion advisories via GDACS), distance, movement, official forecast.",
      inputSchema: {
        lieu,
        nom: z
          .string()
          .optional()
          .describe(`Un cyclone passé (« Garance », « Dina 2002 ») : la pluie et les rafales mesurées station par station pendant son passage, les records de station et sa page\u00a0; le champ selon_meteo_france cite Météo-France mot pour mot (records mondiaux de Gamède) : à attribuer à Météo-France, jamais à rundata.re. Disponibles : ${PASSES_LIST}. / A past cyclone: rain and gusts measured.`),
      },
      annotations: { title: "Cyclones", ...READ_ONLY },
    },
    track("cyclones", (args: { lieu?: string; nom?: string }) => cyclones(cache, args.lieu, undefined, args.nom)),
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
        "Pour maintenant, utiliser meteo_actuelle\u00a0; pour les jours à venir, prevision_meteo. " +
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
          .describe("« heure » : heure par heure jusqu'à 7 jours (sinon automatique sur 3 jours ou moins)\u00a0; « jour » : sans le détail horaire. / 'heure' forces hourly detail up to 7 days; 'jour' leaves it out."),
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
        `${MAIRIES_LUES}), de la CINOR et de l'office de tourisme du Nord (OpenAgenda), reunion.fr et les clubs sportifs (Sportsregions). Chaque événement : ` +
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
          .describe("« aujourd_hui », « ce_soir », « demain », « ce_week_end », « cette_semaine », « a_venir » (30 jours), un jour (« samedi ») ou une date (« 2026-10-31 »)\u00a0; vide = les 14 jours qui viennent. / When; empty = next 14 days."),
        quoi: z
          .string()
          .optional()
          .describe("Le genre (« concert », « spectacle », « théâtre », « danse », « humour », « soirée », « festival », « marché », « cinéma », « enfants », « sport », « exposition ») ou des mots du titre ou de la salle (« ail », « dragon boat », « Kabardock »)\u00a0; vide = tout. / Kind, or words of the title or venue; empty = all."),
        adherent: ADHERENT,
      },
      annotations: { title: "Événements", ...READ_ONLY },
    },
    track("evenements", (args: { lieu?: string; quand?: string; quoi?: string; adherent?: boolean }) => agenda(cache, args.lieu, args.quand, args.quoi, undefined, undefined, args.adherent)),
  );

  server.registerTool(
    "actualites",
    {
      title: "Actualités de La Réunion en direct : manifestations, blocages, routes, faits divers",
      description:
        "Ce qui se passe en ce moment à La Réunion (974), d'après les médias de l'île (Réunion La 1ère, Clicanoo, Le Quotidien, Imaz Press et son direct, Freedom, " +
        "Parallèle Sud, Témoignages) relus toutes les 5 minutes, et les communiqués de la préfecture : pour chaque information, l'heure (ou le jour seul quand le média ne donne pas l'heure), " +
        "le média, le titre, la première phrase quand le média la donne, les communes et lieux nommés, ce qu'elle dit du lieu demandé, le lien vers l'article. Par lieu (commune, quartier) " +
        "et par sujet (manifestations et blocages, routes, météo, volcan, eau, faits divers, santé, politique, culture, sport). " +
        "Route du Littoral : champ route_du_littoral, une annonce des médias datée, pas une mesure. " +
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
          .describe("« mobilisation » (manifestations, blocages, barrages), « route », « meteo », « volcan », « eau », « securite », « sante », « politique », « culture », « sport », ou des mots du titre\u00a0; vide = tout. / Subject or words; empty = all."),
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
        "l'utilisateur exprime un souhait ou une plainte sur ces données, ou dit après coup qu'une information de rundata.re était fausse : c'est ainsi que le service s'améliore. Écrire un message court et " +
        "concret (quel outil, quel lieu, ce qui manquait). Ne mettre aucune donnée personnelle\u00a0; si le contenu touche la personne " +
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
        return { ...text({ erreur: `Ce serveur ne garde pas les avis. Les donner sur ${SITE_URL} (formulaire en bas de chaque page).` }), isError: true };
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
      return text({ merci: `Avis transmis à rundata.re, merci. Il sera lu\u00a0; les nouveautés sont annoncées sur ${SITE_URL}.` });
    }),
  );

  server.registerTool(
    "sources_donnees",
    {
      title: "Sources des données",
      description:
        "Sources de données utilisées par ce serveur (organisme, licence, attribution à citer), ce qui est couvert ou pas encore, " +
        "la liste à jour de tous les outils et les dernières nouveautés. À appeler avant de conclure qu'un outil ou une donnée n'existe pas. " +
        "/ Data sources, licences and coverage; the up-to-date list of tools and the latest changes.",
      inputSchema: {},
      annotations: { title: "Sources des données", ...READ_ONLY },
    },
    track("sources_donnees", async () =>
      text({
        sources: oncePerId([...weatherProviders().map((p) => p.source), ...(vigilance.enabled() ? [vigilance.SOURCE] : []), acspo.SOURCE, modis.SOURCE, houle.SOURCE, seismes.SOURCE, volcanSources.OVPF, volcanSources.PITONLIVE, edf.SOURCE, calendar.SCHOOL, calendar.HOLIDAYS, atmo.SOURCE, annuaire.SOURCE, ...Object.values(terrain.SOURCES), ...(transit.enabled() ? [transit.SOURCE, gtfsrt.SOURCE] : []), velos.SOURCE, maregraphes.SOURCE, vigicrues.SOURCE, irve.SOURCE, eauPotable.SOURCE, baignades.SOURCE, requin.SOURCE, onf.SOURCE, vigieau.SOURCE, avisEau.SOURCE, dae.SOURCE, ...Object.values(sportSources.SOURCES), gdacs.SOURCE, ...agendaSources.SOURCES_LUES, ...Object.values(actuSources.SOURCES), ...Object.values(traceSources.SOURCES), ...(climat.enabled() ? [climat.SOURCE] : []), ...(climat.hourlyEnabled() ? [climat.SOURCE_HORAIRE] : []), ...(arome.enabled() ? [arome.SOURCE] : []), openmeteo.SOURCE, uv.SOURCE, ensemble.SOURCE, ...(feux.enabled() ? [feux.SOURCE] : [])]),
        lieux: GAZETTEER_ATTRIBUTION,
        couverture: { meteo: weatherCoverage(), mer: SEA_COVERAGE, previsions: forecastCoverage(), evenements: AGENDA_COVERAGE },
        version: VERSION,
        // Every tool and the latest changes, for a client whose list of tools is older than the server.
        ...catalogue(),
      }),
    ),
  );

  return server;
}
