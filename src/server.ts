import { chiffres, type Copie, KEY as CHIFFRES, resume as resumeChiffres } from "./chiffres.js";
import { comptee } from "./producteurs.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema, type ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import * as courantMairies from "./providers/coupures-courant.js";
import * as carburantsPrix from "./providers/carburants.js";
import * as radarMf from "./providers/radar.js";
import * as tcoDecheteries from "./providers/tco.js";
import * as meteofranceStations from "./providers/meteofrance.js";
import * as santeSources from "./sante/etablissements.js";
import * as collecteTco from "./vie/collecte.js";
import * as lieuxEnfants from "./vie/enfants.js";
import * as antennesAnfr from "./vie/antennes.js";
import * as sitesHs from "./providers/sites-hs.js";
import * as internetArcep from "./vie/internet.js";
import * as loyersAnil from "./vie/loyers.js";
import * as marchesOsm from "./vie/marches.js";
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
import { withVide } from "./vide.js";
import { catalogue, INDEX, serveur } from "./nouveautes.js";
import { cite, SITE_URL } from "./tools/citer.js";
import { marquerTiers, OUTILS_TIERS } from "./tools/tiers.js";
import { FICHE_LA1ERE, FICHE_REUNION_FR, fichesNonReprises } from "./tools/non-repris.js";
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
import * as airMesures from "./providers/air-mesures.js";
import * as capteurs from "./providers/capteurs.js";
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
import * as airesOnf from "./traces/aires.js";
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
import { autorisee } from "./providers/autorisations.js";
import { SOURCE as CONNECTEURS_SOURCE } from "./providers/agenda-connecteurs.js";
import { enLigne as connecteursEnLigne } from "./web/connecteurs-drapeau.js";
import { agenda, COUVERTURE as AGENDA_COVERAGE, MAIRIES_LUES, PROGRAMMES_SALLES } from "./tools/agenda.js";
import * as traceSources from "./providers/traces.js";
import * as actuSources from "./providers/actualites.js";
import { actualites } from "./tools/actualites.js";
import * as radarsFixes from "./routes/radars.js";
import { BDTOPO } from "./providers/ign.js";
import { sitesSansReponse } from "./tools/sans-reponse.js";
import * as emploiSource from "./providers/emploi.js";
import * as marchesPublics from "./providers/marches-publics.js";
import { emploi } from "./tools/emploi.js";
import { insecables } from "./typographie.js";

export const VERSION = "1.0.64";

// Some clients keep only the start of these instructions (Claude Code cut them near 4 000 characters): they stay under
// 4 000 (a test checks). ChatGPT weighs the first 512 characters most: what rundata.re is and when to use it come first,
// then the index of the tools and the rules. What each tool does, and the words its answers
// must carry (15 ou 112, a closed trail is forbidden, the tides are computed), is in its description.
const INSTRUCTIONS = `rundata.re : La Réunion (974) en direct, d'après les données publiques : sorties, randos, météo mesurée aux stations, routes, vigilance, volcan, mer, bus, eau. Ces outils répondent aux questions sur l'île et ses lieux, même sans « La Réunion » dans la question (Cilaos, Saint-Gilles, le Maïdo…). / Réunion Island live public data; each answer carries its citation, link, sources and data time.
Service fait à La Réunion, gratuit et sans compte, code libre (MIT) : https://rundata.re/a-propos. Outils, les plus récents d'abord :
${INDEX}

Règles :
- Citer : chaque réponse porte citer (rundata.re et les producteurs), lien (la page de rundata.re qui montre la même chose), sources (les producteurs et leurs licences) et fraicheur (l'heure de la donnée, par exemple « 23:12, heure de La Réunion ») : de quoi citer et dater la réponse.
- Avis : l'utilisateur signale un manque, une erreur ou un souhait sur ces données : donner_avis\u00a0; un outil n'a rien trouvé : le lui proposer, et n'appeler qu'avec son accord. Le besoin résumé, rien de personnel.
- Liste d'outils : chaque réponse porte serveur.outils_recents\u00a0; avant de dire qu'un sujet n'est pas couvert, même à la première question, appeler sources_donnees. Outil cité là, absent de votre liste : elle est ancienne, le dire, sans dire qu'on l'a rechargée. ChatGPT : Paramètres → Plugins → rundata.re → Actualiser les outils, puis nouvelle conversation.
- Météo : maintenant → meteo_actuelle, temperature_mer (MESURES : dire l'heure, la station, sa distance)\u00a0; avant (hier, ce mois-ci, record) → historique_meteo\u00a0; plus tard → prevision_meteo, une PRÉVISION : le dire à l'utilisateur\u00a0; houle, surf → temperature_mer, une PRÉVISION aussi.
- Un champ vigilance ou avertissement se dit en premier, et les consignes de sécurité (15 ou 112, 18 pour un feu, radier, sentier fermé, eau à ne pas boire) telles quelles. Vigilance, cyclone : les zones de Météo-France, jamais une commune\u00a0; finir par le champ officiel.

Détails :
- Circulation : pas de mesure des bouchons, ne pas en inventer\u00a0; renvoyer à la carte officielle d'infotrafic.re et à https://rundata.re/trafic. Barrage ou route coupée : actualites avec le lieu.
- actualites : l'heure, le média et le lien de chaque information\u00a0; rien sur un lieu ne prouve qu'il ne s'y passe rien\u00a0; ne jamais inventer ni démentir un blocage.
- evenements : le lien de chaque événement\u00a0; ANNULÉ ou REPORTÉ en premier, avec le média si statut_d_apres\u00a0; agenda incomplet, le dire quand rien n'est trouvé\u00a0; cinéma : les sites des salles.`;

/** Adds the vigilance above green, if any, to a tool's answer (asked in parallel, so no added wait). */
async function withVigilance<R extends { content: { type: "text"; text: string }[]; isError?: boolean }>(
  cache: Cache,
  answer: Promise<R>,
): Promise<R> {
  const [r, warnings] = await Promise.all([answer, vigilanceWarnings(cache)]);
  if (!warnings.lignes.length || r.isError) return r;
  const payload = JSON.parse(r.content[0].text) as Record<string, unknown>;
  return { ...r, content: [{ type: "text", text: JSON.stringify({ vigilance: warnings.lignes, officiel: warnings.officiel, ...payload }) }] };
}

/** An answer's texts with their no-break spaces: none of JSON's own spaces is before « : » or after a figure. */
function spaced<R extends object>(r: R): R {
  if (!("content" in r) || !Array.isArray(r.content)) return r;
  return { ...r, content: r.content.map((c: { type: string; text?: string }) => (c.type === "text" && c.text ? { ...c, text: insecables(c.text) } : c)) };
}

/** What a tool's handler is told of the HTTP request (the MCP SDK's RequestHandlerExtra): its headers, on HTTP only. */
type Extra = { requestId?: string | number; requestInfo?: { headers?: Record<string, string | string[] | undefined> } };

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
  .describe("L'utilisateur dit être adhérent ou membre d'un club : montrer aussi les séances réservées aux adhérents.");
// Only Sportsregions' events are for members: the argument is offered while it is read (providers/autorisations.ts).
const ADHERENT_SI_LU: Record<string, typeof ADHERENT> = autorisee("agenda:sportsregions") ? { adherent: ADHERENT } : {};

const lieu = z
  .string()
  .optional()
  .describe("Lieu à La Réunion : commune, plage, quartier, cirque, sommet, ou coordonnées « -21.05, 55.22 ». Vide = toute l'île.");

// meteo_actuelle and prevision_meteo keep the place with its examples and their English, as on main: with the short one,
// haiku called prevision_meteo before meteo_actuelle for « Il fait quel temps au Tampon ? ».
const lieuAvecExemples = z
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
/** Every source the server reads, each once (sources_donnees' list, and the sites that do not answer: sans-reponse.ts). */
/**
 * Every source read, for sources_donnees and the sites that do not answer. `inactives`: those of a base or a key this
 * Worker lacks as well (Node, the tests), the sports sites not read until they agree (providers/autorisations.ts), and
 * the associations' platforms before their flag (web/connecteurs-drapeau.ts),
 * for the registry of producers and licences (producteurs.ts).
 */
export const toutesLesSources = (inactives = false) =>
  oncePerId([...weatherProviders().map((p) => p.source), ...(inactives ? [meteofranceStations.SOURCE] : []), ...(inactives || vigilance.enabled() ? [vigilance.SOURCE] : []), acspo.SOURCE, modis.SOURCE, houle.SOURCE, seismes.SOURCE, volcanSources.OVPF, volcanSources.PITONLIVE, edf.SOURCE, calendar.SCHOOL, calendar.HOLIDAYS, atmo.SOURCE, airMesures.SOURCE, capteurs.SOURCE, annuaire.SOURCE, ...Object.values(terrain.SOURCES), ...(inactives || transit.enabled() ? [transit.SOURCE, gtfsrt.SOURCE] : []), velos.SOURCE, maregraphes.SOURCE, vigicrues.SOURCE, irve.SOURCE, eauPotable.SOURCE, baignades.SOURCE, requin.SOURCE, onf.SOURCE, airesOnf.SOURCE, vigieau.SOURCE, avisEau.SOURCE, dae.SOURCE, ...Object.values(sportSources.SOURCES).filter((x) => inactives || (autorisee(`sport:${x.id}`) && autorisee(`agenda:${x.id}`))), gdacs.SOURCE, ...agendaSources.SOURCES_LUES.filter((s) => inactives || connecteursEnLigne() || s !== CONNECTEURS_SOURCE), ...Object.values(actuSources.SOURCES), ...Object.values(traceSources.SOURCES), ...(inactives || climat.enabled() ? [climat.SOURCE] : []), ...(inactives || climat.hourlyEnabled() ? [climat.SOURCE_HORAIRE] : []), ...(inactives || arome.enabled() ? [arome.SOURCE] : []), openmeteo.SOURCE, uv.SOURCE, ensemble.SOURCE, ...(inactives || feux.enabled() ? [feux.SOURCE] : []),
    // The vie pratique's and the power cuts' (annuaire_services_publics, electricite).
    carburantsPrix.SOURCE, radarMf.SOURCE, radarsFixes.SOURCE, BDTOPO, courantMairies.SOURCE, tcoDecheteries.SOURCE, santeSources.FINESS, santeSources.ARS_GARDE, santeSources.SANTE_FR, collecteTco.SOURCE, ...Object.values(lieuxEnfants.SOURCES), marchesOsm.OSM, ...Object.values(marchesOsm.MAIRIES), loyersAnil.SOURCE, internetArcep.SOURCE, antennesAnfr.SOURCE_MOBILE, antennesAnfr.SOURCE_RADIO, sitesHs.SOURCE,
    // The public sector's job offers (emploi), the public procurement notices (the page /marches-publics).
    emploiSource.SOURCE, marchesPublics.SOURCE]);
/** A source's name from its id, for one served from its last copy (fraicheur.ts). */
export const nomDeSource = (id: string) => toutesLesSources().find((s) => s.id === id)?.nom;

/** The symbol of rundata.re (web/logo.ts), for the clients that show a server's icon; the same in server.json. */
export const SERVER_ICONS = [
  { src: `https://rundata.re${icons["512"]}`, mimeType: "image/png", sizes: ["512x512"] },
  { src: `https://rundata.re${icons["symbole-svg"]}`, mimeType: "image/svg+xml", sizes: ["any"] },
];

/**
 * How long a tool call waits for the sources it has a copy of: past it, each such source's copy is the answer, with its
 * time and said late (cache.ts), rather than a client kept waiting 20 s for a site that does not answer.
 */
export const TOOL_WAIT_MS = 5_000;

/**
 * A tools/list answer without the "$schema" of each inputSchema (the JSON Schema draft, which clients do not read) and
 * without "execution" when it says the default, { taskSupport: "forbidden" }.
 */
export function listeAllegee(liste: ListToolsResult): ListToolsResult {
  return {
    ...liste,
    tools: liste.tools.map(({ execution, ...tool }) => {
      const inputSchema = { ...tool.inputSchema };
      delete inputSchema.$schema;
      return { ...tool, inputSchema, ...(execution && execution.taskSupport !== "forbidden" ? { execution } : {}) };
    }),
  };
}

export function createServer(cache: Cache, record: Recorder = () => {}, background?: Background): McpServer {
  const server = new McpServer(
    { name: "reunion-temps-reel", title: "rundata.re · La Réunion 974 en direct", version: VERSION, icons: SERVER_ICONS },
    { instructions: insecables(INSTRUCTIONS) },
  );
  // The descriptions and the answers as said, with their no-break spaces (typographie.ts), like the pages.
  const register = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: { description?: string }, cb: never) =>
    register(name, { ...config, description: config.description && insecables(config.description) }, cb)) as typeof server.registerTool;
  // The list of the tools without what the SDK adds to each tool for no client: about 2 500 characters of each conversation.
  type Handler = (request: unknown, extra: unknown) => unknown;
  const setHandler = server.server.setRequestHandler.bind(server.server) as (schema: unknown, handler: Handler) => void;
  server.server.setRequestHandler = ((schema: unknown, handler: Handler) =>
    setHandler(schema, schema === ListToolsRequestSchema ? async (request, extra) => listeAllegee((await handler(request, extra)) as ListToolsResult) : handler)) as typeof server.server.setRequestHandler;
  // Records the place asked (a commune, a beach…), never a street address: fiche_terrain's stays out of the metrics.
  // Ends each answer with its citation and the link to rundata.re.
  // Each answer also says how fresh it is, from the cache entries the call read, and which tools are new.
  let tools = 0;
  const track = <A extends object, R extends object>(name: string, run: (args: A, extra: Extra) => Promise<R>) => {
    tools++; // one per tool registered
    return async (args: A, extra: Extra = {}): Promise<R> => {
      const { value: { value: r, vide }, lectures } = await withLectures(() => withVide(name, () => run(args, extra)), TOOL_WAIT_MS);
      const lieu = "lieu" in args && typeof args.lieu === "string" ? args.lieu : undefined;
      // A call that found nothing (vide.ts) is told with its id, for the transport's record of it (usage.ts).
      record({ kind: "mcp", name, detail: lieu?.trim().slice(0, 60) || undefined, ok: !("isError" in r && r.isError), ...(vide && { outcome: "vide", id: extra.requestId }) });
      // Every answer says how to cite it, error or not (tools/citer.ts); the feedback tool's thanks already names rundata.re.
      const now = new Date();
      // The day's summary has a dozen dated parts: no single « donnee_du » for it, each part says its own.
      // The answers that quote third parties say so (tools/tiers.ts).
      const marked = OUTILS_TIERS.has(name) ? marquerTiers(r) : r;
      const said = name === "donner_avis" ? r : cite(name, marked, { lectures, now, serveur: serveur(VERSION, tools, now), donnee: name !== "resume_du_jour", nom: nomDeSource });
      return spaced(said);
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
      inputSchema: { lieu: lieuAvecExemples },
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
        "Partout, le ciel de la nuit, de 18 h à 6 h, dégagé ou couvert, et dans les Hauts au-dessus ou dans les nuages (bloc ciel_de_nuit), " +
        "pour « le ciel sera dégagé ce soir pour voir les étoiles au Maïdo ? ». " +
        "Chaque réponse est étiquetée « prévision » avec ses limites (le modèle ne voit pas les microclimats de l'île)\u00a0; " +
        "pour un cyclone, renvoie à la vigilance officielle de Météo-France. Pour le temps qu'il fait maintenant, utiliser meteo_actuelle. " +
        "/ Weather FORECAST (numerical model, not a measurement) for a place in Réunion Island, up to 7 days: " +
        "'will it rain tomorrow in Saint-Pierre?', 'weather this weekend in Cilaos?'. Always labelled as a forecast.",
      inputSchema: {
        lieu: lieuAvecExemples,
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
        "La mesure (avec sa date et sa distance) et la prévision des vagues (hauteur, période, direction) sont dans deux blocs séparés.",
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
          "Pour : « on est en vigilance orange ? », « la mer est dangereuse ? », « on peut randonner à Mafate demain avec la pluie ? ». " +
          "Avec un lieu : la zone de vigilance de sa commune\u00a0; sans lieu : toute l'île." +
          (feux.enabled() ? " Une ligne feux_detectes quand un feu de végétation a été détecté par satellite ces dernières 24 h : faux positifs possibles, et un jour sans détection ne prouve pas qu'il n'y a pas de feu\u00a0; toujours donner « Vous voyez un feu ? Appelez le 18 ou le 112. »." : ""),
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
        "« il y a eu un séisme ? ». Réponse courte par défaut (les 3 dernières alertes, les séismes des 7 derniers jours)\u00a0; " +
        "detail pour l'historique des alertes depuis 2016 et les séismes jour par jour sur 30 jours.",
      inputSchema: {
        detail: z.boolean().optional().describe("true : la réponse complète (historique des alertes depuis 2016, séismes jour par jour sur 30 jours)."),
      },
      annotations: { title: "Volcan et séismes à La Réunion", ...READ_ONLY },
    },
    track("volcan_seismes", (args: { detail?: boolean }) => volcanSeismes(cache, new Date(), args.detail === true)),
  );

  server.registerTool(
    "electricite",
    {
      title: "Électricité à La Réunion en ce moment",
      description:
        "Électricité à La Réunion (974) en direct, d'après EDF : production totale, part de chaque filière (solaire, " +
        "bioénergies, biomasse, bioliquide, hydraulique, éolien) et part renouvelable, mises à jour toutes les 5 min\u00a0; " +
        "« météo de l'électricité » d'EDF pour les jours qui viennent (heures de pointe, réseau contraint, recharge conseillée " +
        "d'un véhicule électrique). Pour : « d'où vient l'électricité ? », " +
        "« quand recharger ma voiture électrique ? ». " +
        `Coupures de courant (électricité, pas l'eau : coupures_eau) : les avis d'EDF que relaient les mairies dont le site ne l'interdit pas (${courantMairies.MAIRIES.map((m) => m.commune).join(", ")}), ` +
        "jours, heures et secteurs, avec le lien de l'avis\u00a0; ailleurs, l'outil le dit : aucun avis lu pour la commune, ou ses mentions légales en interdisent la reprise. " +
        "Pour : « coupure de courant à Sainte-Marie ? », « coupure EDF prévue dans ma commune ? ».",
      inputSchema: { lieu },
      annotations: { title: "Électricité à La Réunion", ...READ_ONLY },
    },
    track("electricite", (args) => electricite(cache, new Date(), args.lieu)),
  );

  server.registerTool(
    "calendrier",
    {
      title: "Vacances, jours fériés, soleil et Lune à La Réunion",
      description:
        "Calendrier de La Réunion (974) : vacances scolaires de l'académie de La Réunion (calendrier austral, différent de la " +
        "métropole), jours fériés (dont le 20 décembre, Fèt Kaf), date du jour, heures de lever et de coucher du soleil " +
        "au lieu demandé, et la Lune : phase, part éclairée, lever et coucher, prochaines phases (calculés). Pour : « c'est quand " +
        "les vacances ? », « le 20 décembre est férié ? », « la Lune se lève à quelle heure ce soir ? ».",
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
        "Qualité de l'air à La Réunion (974) par commune : indice ATMO du jour et du lendemain, une PRÉVISION calculée par " +
        "Atmo Réunion et pas une mesure (1 bon à 6 extrêmement mauvais), avec le sous-indice de chaque polluant (particules, " +
        "ozone, dioxyde d'azote, dioxyde de soufre), l'heure de diffusion et comment l'indice est calculé. " +
        "Capteurs amateurs (champ capteurs_amateurs) : donner d'abord l'indice d'Atmo Réunion, toujours dire que ces capteurs ne sont pas étalonnés, " +
        "ne jamais les comparer à un seuil ni en tirer de conclusion sur la santé. " +
        "Pour : « l'air est pollué à Saint-Louis ? », « qualité de l'air aujourd'hui à Saint-Denis ? », « je peux faire du sport dehors ? ». " +
        "Sans lieu : toute l'île.",
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
        "Pour : « horaires de la mairie de Saint-Paul ? », « prix de l'essence ce mois-ci ? », « quel jour passent les poubelles à Saint-Paul ? ».",
      inputSchema: {
        quoi: z.string().describe("Le service cherché, en quelques mots : « mairie », « CAF », « préfecture », « impôts », « France Travail », « tribunal »…, ou « carburant » pour les prix du mois, « pharmacie », « urgences », « enfants » pour les lieux où aller avec eux."),
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
        "Ce que disent les registres officiels du bien ou du lieu de La Réunion (974) sur lequel on s'interroge, pas la position de " +
        "l'utilisateur : parcelle cadastrale (section, numéro, " +
        "surface), zone du plan local d'urbanisme (U, AU, A, N : constructible ou non), altitude du sol, prix médians des maisons, " +
        "appartements et terrains vendus autour, et sur la voie demandée, depuis 5 ans (DVF), loyers d'annonce de la commune pour un logement type (carte des loyers de l'ANIL), part des logements et locaux de la commune éligibles à la fibre (Arcep), antennes mobiles (opérateurs, 2G à 5G) et émetteurs de radio et de télévision à moins de 500 m (ANFR), et risques : plan de prévention des risques (PPR inondation, " +
        "mouvements de terrain, littoral) au point, arrêtés de catastrophe naturelle de la commune, glissements et éboulements recensés " +
        "à moins de 500 m, sismicité, radon. Pour : « cette parcelle est constructible ? », " +
        "« prix au m² des maisons à l'Hermitage ? », « quels risques à cette adresse ? ».",
      inputSchema: {
        adresse: z
          .string()
          .describe(
            "Le bien ou le lieu sur lequel on s'interroge, pas la position de l'utilisateur : adresse du bien (« 7 rue de la Buse, Saint-Paul ») " +
              "ou lieu-dit (« Bois de Nèfles »).",
          ),
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
          "Pour : « prochain bus à la gare routière de Saint-Pierre ? », « le car jaune a du retard ? », « où est le S1 en ce moment ? ». " +
          "Chaque départ dit d'où vient le car et où il va\u00a0; un jour sans service (dimanche, jour férié) est dit. Bateau ou ferry pour Maurice ou Rodrigues : dit qu'il n'y a pas de liaison maritime régulière de passagers, ne pas en inventer ni d'horaires de bateau.",
        inputSchema: {
          arret: z.string().optional().describe("Nom de l'arrêt et sa commune (« Gare routière, Saint-Pierre »), ou un lieu (« plage de Boucan », « Manapany ») pour les arrêts les plus proches\u00a0; avec une ligne, dit si elle y passe, sinon son arrêt le plus proche. Une heure (« après 17 h ») donne les départs une par une. Facultatif avec une ligne."),
          ligne: z.string().optional().describe("Une ligne (« S1 », « O1X », « 2 », « S1 Car Jaune ») : seule, ses arrêts dans l'ordre pour chaque sens, ses départs du jour et ses bus en circulation qui donnent leur position\u00a0; avec un arrêt, ses prochains départs là."),
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
        "à la station IUT ? », « où prendre un vélo près du front de mer de Saint-Pierre ? », « je peux rendre mon vélo au pôle d'échanges de Saint-Louis ? ».",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Nom d'une station (« IUT », « Front de mer »), un lieu ou une commune (« Saint-Pierre », « plage de l'Étang-Salé »). Vide = tout le réseau."),
      },
      annotations: { title: "Vélos Altervélo", ...READ_ONLY },
    },
    track("velos_libre_service", (args: { lieu?: string }) => velosLibreService(cache, args.lieu)),
  );

  server.registerTool(
    "emploi",
    {
      title: "Offres d'emploi public à La Réunion",
      description:
        "Offres d'emploi de la fonction publique à La Réunion (974), d'après Choisir le service public : État, communes, Département, Région, hôpitaux, université. " +
        "Pour chaque offre ouverte : l'intitulé, l'employeur, la commune, la nature de l'emploi, la date de publication, la date limite de candidature et le lien pour postuler sur le site, la plus récente d'abord. " +
        "Un poste publié sous plusieurs références : une ligne, nombre_offres et references (référence, date, lien). " +
        "Donner le lien de chaque offre\u00a0; la page de l'offre fait foi (elle peut être pourvue avant sa date limite). Les offres des entreprises n'y sont pas : renvoyer à France Travail, sans en inventer. " +
        "Pour : « offres d'emploi à la mairie de Saint-Paul ? », « le CHU recrute des infirmiers ? », « emploi public au Tampon ? ».",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Une commune ou un lieu de l'île (« Saint-Pierre », « Saint-Gilles ») pour les offres de sa commune. Vide = toute l'île."),
        mot_cle: z
          .string()
          .optional()
          .describe("Des mots de l'intitulé, du métier ou de l'employeur : « infirmier », « agent d'entretien », « CHU », « contractuel »."),
      },
      annotations: { title: "Emploi public", ...READ_ONLY },
    },
    track("emploi", (args: { lieu?: string; mot_cle?: string }) => emploi(cache, args.lieu, args.mot_cle)),
  );

  server.registerTool(
    "maree",
    {
      title: "Marée à La Réunion",
      description:
        "Hauteur de la mer mesurée chaque minute par les marégraphes du SHOM au Port (Pointe des Galets) et à Sainte-Marie : niveau actuel, " +
        "marée montante ou descendante, dernières pleine et basse mer observées\u00a0; puis les prochaines pleines et basses mers sur deux jours, CALCULÉES par rundata " +
        "d'après les mesures (pas la prédiction officielle du SHOM), à environ 15 à 20 min et 5 cm près : le dire, avec la précision donnée, et au-delà de l'horizon renvoyer au SHOM. " +
        "Les heures calculées ne valent que près des deux marégraphes, à 15 km au plus (Le Port, La Possession, Saint-Paul, Saint-Gilles-les-Bains, Saint-Denis, Sainte-Marie, Sainte-Suzanne). " +
        "Plus loin, la marée arrive à une autre heure : l'outil donne alors la hauteur mesurée au marégraphe le plus proche, sans heures, et le lien vers les horaires officiels du SHOM. " +
        "Pour : « la marée monte ? », « c'est quand la marée basse demain ? », « niveau de la mer au Port ? ».",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Un lieu de la côte (« Le Port », « Saint-Gilles », « Sainte-Marie ») pour le marégraphe le plus proche. Vide = les deux."),
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
        "« il y a une vigilance crues ? », « niveau de la ravine Saint-Gilles ? ».",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Une rivière (« rivière des Galets », « ravine Saint-Gilles ») ou un lieu (« Salazie », « Saint-Benoît ») pour les stations proches. Vide = toute l'île."),
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
        "Pour : « borne de recharge libre près de Saint-Gilles ? », « où recharger rapidement à Saint-Pierre ? », « bornes au Tampon ? ».",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Un lieu ou une commune (« Saint-Gilles-les-Bains », « Le Tampon », « aéroport Roland-Garros »). Vide = toute l'île."),
        rapide: z
          .boolean()
          .optional()
          .describe("Seulement la recharge rapide (50 kW ou plus)."),
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
        "Pour : « l'eau du robinet est potable à Cilaos ? », « on peut se baigner à l'Hermitage ? », " +
        "« l'eau du bassin Dinan est propre ? ». Avec la baignade, la règle requin de l'arrêté préfectoral (bande des 300 m) et les zones permises : ne jamais dire qu'un endroit est sans requin ou sans risque, ni qu'une zone est ouverte aujourd'hui, renvoyer au drapeau sur place. Les avis « ne pas boire » en cours sont dans coupures_eau.",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Commune, quartier, plage ou bassin (« Hell-Bourg », « plage de l'Hermitage », « bassin Bleu »)."),
        eau: z
          .enum(["robinet", "baignade"])
          .optional()
          .describe("« robinet » (eau potable) ou « baignade »\u00a0; vide = d'après la question et le lieu."),
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
        "donnés avec l'état des sentiers de l'ONF qu'ils empruntent. Un sentier fermé est interdit, même avec la trace\u00a0; « hors gestion ONF » n'est pas dit ouvert\u00a0; donner le lien trace_gpx. Pour : « sentiers fermés à Mafate ? », " +
        "« la trace GPS du Piton des Neiges ? », « une rando de 10 km à Cilaos ? » " +
        "(longueur_min_km, longueur_max_km, denivele_max_m filtrent les itinéraires et sentiers proposés). Dès qu'un sentier de l'ONF d'un " +
        "itinéraire est fermé, la réponse porte un champ avertissement, à donner en premier. " +
        "Avec un lieu ou un sentier, aussi les aires d'accueil de l'ONF autour (champ aires_accueil), sous le nom que leur donne l'ONF." +
        (feux.enabled() ? " Avec les feux de végétation détectés par satellite (NASA FIRMS) ces dernières 24 h, dans feux_detectes : faux positifs possibles, un jour sans détection ne prouve pas qu'il n'y a pas de feu\u00a0; toujours donner « Vous voyez un feu ? Appelez le 18 ou le 112. »." : ""),
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Un sentier ou une randonnée (« sentier de la Roche Pendue », « Piton des Neiges », « GR R2 »), un lieu (« Maïdo »), un cirque (« Mafate ») ou une commune\u00a0; vide = toute l'île."),
        longueur_min_km: z.number().min(0).optional().describe("Longueur minimale en km d'une randonnée proposée (« une rando de 10 km » : 8)."),
        longueur_max_km: z.number().min(0).optional().describe("Longueur maximale en km (« une rando de 10 km » : 12\u00a0; « une petite balade » : 5)."),
        denivele_max_m: z.number().min(0).optional().describe("Dénivelé positif maximal en m (« sans trop de dénivelé » : 400)."),
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
        "Sans lieu : toute l'île.",
      inputSchema: {
        lieu,
        profil: z
          .enum(["particulier", "entreprise", "collectivite", "exploitation"])
          .optional()
          .describe("Pour qui (« exploitation » = agriculteur)\u00a0; par défaut un particulier."),
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
        "Même quand la liste est complète, dire « cette rue n'est pas dans la liste de l'avis », jamais « pas de coupure chez vous ».",
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
        "Réponse courte par défaut\u00a0; detail pour ce qu'accepte chaque déchèterie et le prix de chaque carburant.",
      inputSchema: {
        lieu: z.string().describe("Commune ou lieu de La Réunion (« Saint-Paul », « Boucan Canot », « Cilaos »), rapporté à sa commune."),
        detail: z.boolean().optional().describe("true : la réponse complète (ce qu'accepte chaque déchèterie, le prix de chaque carburant)."),
      },
      annotations: { title: "Résumé du jour", ...READ_ONLY },
    },
    track("resume_du_jour", (args: { lieu: string; detail?: boolean }) => resumeDuJour(cache, args.lieu, new Date(), background, args.detail === true)),
  );

  server.registerTool(
    "defibrillateurs",
    {
      title: "Défibrillateurs à La Réunion",
      description:
        "Défibrillateurs (DAE) les plus proches d'un lieu de La Réunion (974), d'après la base nationale Géo'DAE : adresse, distance et temps à pied, " +
        "emplacement exact, accessible à toute heure ou aux heures d'ouverture. Plus de 1 200 appareils dans les 24 communes. " +
        "Pour : « où est le défibrillateur le plus proche de la plage de l'Hermitage ? », « défibrillateur à Cilaos ? ». " +
        "Dire d'abord d'appeler le 15 ou le 112 et de commencer le massage cardiaque.",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Le lieu sur lequel on s'interroge, pas la position de l'utilisateur : commune, plage, quartier, cirque, sommet. Vide = toute l'île."),
      },
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
        "les matchs annulés ou reportés (avis de la Ligue de volley, actualité locale), classements, " +
        "beach-volley et sport auto (calendriers des ligues), Grand Raid (courses, partants, abandons, podiums), les programmes sportifs publiés par les communes " +
        "(leur lien seulement). " +
        // Said while neither federation is read (providers/autorisations.ts), so that the answer's mention is read (marketing).
        (!autorisee("sport:ffvoile") && !autorisee("sport:ffgolf") ? "Les régates et le golf ne sont pas repris : la réponse dit pourquoi. " : "") +
        "Pour : « match de hand ce week-end à Saint-Pierre ? », « prochain rallye ? », « qui a gagné le Grand Raid ? ».",
      inputSchema: {
        sport: z
          .enum(SPORTS as [Sport, ...Sport[]])
          .optional()
          .describe("Le sport\u00a0; vide = tous. « football » et « basket » renvoient l'actualité seulement (pas de résultats officiels lus)."),
        lieu: z
          .string()
          .optional()
          .describe("Une commune (« Saint-Paul »), une partie de l'île (« le sud », « l'ouest », « le nord », « l'est ») ou un club (« VBSP », « Tampon Gecko Volley ») : ce qui s'y joue et ses clubs à l'extérieur. Vide = toute l'île."),
        quand: z
          .enum(QUANDS as [Quand, ...Quand[]])
          .optional()
          .describe("« aujourd_hui », « demain », « samedi » ou « dimanche » (le prochain), « ce_week_end », « a_venir » (14 jours) ou « resultats »\u00a0; vide = les deux."),
        ...ADHERENT_SI_LU,
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
        "Systèmes tropicaux actifs autour de La Réunion (974), d'après les avis du CMRS de La Réunion (Météo-France) republiés par GDACS : " +
        "nom et stade (dépression, tempête tropicale modérée ou forte, cyclone tropical, intense), avec l'heure du dernier avis\u00a0; alerte cyclonique de la préfecture, et ce qu'elle veut dire pour les crèches, écoles, collèges, lycées et universités selon le dispositif ORSEC Cyclones (jamais une école en particulier). " +
        "Hors saison : le dit, avec le dernier système et ceux de la saison. Ni trajectoire, ni position, ni distance, ni prévision : jamais de trajectoire inventée, donner le lien du champ officiel (site officiel de Météo-France)\u00a0; renvoyer aux consignes de la préfecture. " +
        "Pour : « il y a un cyclone en ce moment ? », « combien de pluie pendant Garance ? » (nom).",
      // No `lieu` any more (no distance computed): a client that still sends one gets the same answer.
      inputSchema: {
        nom: z
          .string()
          .optional()
          .describe(`Un cyclone passé (« Garance », « Dina 2002 ») : la pluie et les rafales mesurées station par station pendant son passage, les records de station et sa page\u00a0; le champ selon_meteo_france cite Météo-France mot pour mot (records mondiaux de Gamède) : à attribuer à Météo-France, jamais à rundata.re. Disponibles : ${PASSES_LIST}.`),
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
        "Pour toute question sur le temps qu'il a fait : « il a beaucoup plu ce mois-ci à Saint-Benoît ? », « record de chaleur à Saint-Denis ? », " +
        "« à quelle heure a-t-il plu hier à Cilaos ? ». " +
        "Pour maintenant, utiliser meteo_actuelle\u00a0; pour les jours à venir, prevision_meteo.",
      inputSchema: {
        lieu,
        jours: z.number().int().min(1).max(3650).optional()
          .describe("Les N derniers jours jusqu'à hier (30 par défaut)."),
        du: z.string().optional()
          .describe("Début : « 2026-10-01 », « 01/10/2026 », « 2026-10 » (un mois), « 2006 » (une année). Seul, c'est ce jour, ce mois ou cette année."),
        au: z.string().optional().describe("Fin, même format. Pour « cette nuit » ou « ce matin », la date d'aujourd'hui."),
        detail: z.enum(["jour", "heure"]).optional()
          .describe("« heure » : heure par heure jusqu'à 7 jours (sinon automatique sur 3 jours ou moins)\u00a0; « jour » : sans le détail horaire."),
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
        `plein air, animations municipales. D'après ${PROGRAMMES_SALLES}, les agendas des mairies (` +
        `${MAIRIES_LUES}), celui de l'office de tourisme de l'Est, et ceux de la CINOR et de l'office de tourisme du Nord (OpenAgenda). Chaque événement : ` +
        "titre, date et heures (heure de La Réunion), salle, commune, genre, prix et lien de billetterie quand ils sont donnés, statut " +
        "(ANNULÉ, REPORTÉ, complet), y compris quand c'est un média de l'île qui l'annonce avant l'organisateur (statut_d_apres). " +
        "Pour : « que faire ce week-end à Saint-Paul ? », « concert ce soir ? », « c'est quand la fête de l'ail ? ».",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Une commune ou un lieu (« Saint-Paul », « Saint-Gilles ») : les événements de sa commune. Vide = toute l'île."),
        quand: z
          .string()
          .optional()
          .describe("« aujourd_hui », « ce_soir », « demain », « ce_week_end », « cette_semaine », « a_venir » (30 jours), un jour (« samedi ») ou une date (« 2026-10-31 »)\u00a0; vide = les 14 jours qui viennent."),
        quoi: z
          .string()
          .optional()
          .describe("Le genre (« concert », « spectacle », « théâtre », « danse », « humour », « soirée », « festival », « marché », « cinéma », « enfants », « sport », « exposition ») ou des mots du titre ou de la salle (« ail », « dragon boat », « Kabardock »)\u00a0; vide = tout."),
        ...ADHERENT_SI_LU,
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
        "Ce qui se passe en ce moment à La Réunion (974), d'après les médias de l'île (Clicanoo, Le Quotidien, Imaz Press et son direct, Freedom, " +
        "Parallèle Sud, Témoignages) relus toutes les 5 minutes, et les communiqués de la préfecture : pour chaque information, l'heure (ou le jour seul quand le média ne donne pas l'heure), " +
        "le média, le titre, la première phrase quand le média la donne, les communes et lieux nommés, ce qu'elle dit du lieu demandé, le lien vers l'article. Par lieu (commune, quartier) " +
        "et par sujet (manifestations et blocages, routes, météo, volcan, eau, faits divers, santé, politique, culture, sport). " +
        "Route du Littoral : champ route_du_littoral, une annonce des médias datée, pas une mesure. " +
        "Radars fixes (champ radars_fixes) : la liste publiée par le ministère de l'Intérieur, avec la vitesse limite de chacun, pour une question sur les routes ou les radars. Jamais les contrôles mobiles. " +
        "Pour : « il y a des blocages à Saint-Pierre ? », « route fermée ? », « quoi de neuf à Saint-Benoît ? ».",
      inputSchema: {
        lieu: z
          .string()
          .optional()
          .describe("Une commune ou un lieu (« Saint-Pierre », « Hell-Bourg », « Saint-Gilles ») : les informations qui le nomment. Vide = toute l'île."),
        sujet: z
          .string()
          .optional()
          .describe("« mobilisation » (manifestations, blocages, barrages), « route », « meteo », « volcan », « eau », « securite », « sante », « politique », « culture », « sport », ou des mots du titre\u00a0; vide = tout."),
        heures: z
          .number()
          .optional()
          .describe("Depuis combien d'heures (1 à 72, 24 par défaut)."),
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
        "semble fausse ou périmée (« erreur »), une idée (« suggestion »), ou un remerciement (« bravo »). L'appeler quand l'utilisateur " +
        "signale une donnée qui manque ou une information fausse, ou exprime un souhait ou une plainte sur ces données. Quand un outil n'a " +
        "pas trouvé ce qu'il cherchait ou s'est trompé, lui proposer de le signaler, et ne l'appeler qu'avec son accord. Écrire un message " +
        "court et concret (quel outil, quel lieu, ce qui manquait), sans recopier la conversation et sans aucune donnée personnelle. " +
        "Les avis sont lus par une personne, sans réponse directe.",
      inputSchema: {
        type: z.enum(avis.TYPES).describe("« manque » (donnée absente), « erreur » (valeur fausse ou périmée), « suggestion », « bravo »."),
        message: z.string().trim().min(3).max(avis.MESSAGE_MAX).describe(`L'avis, en quelques phrases (${avis.MESSAGE_MAX} caractères au plus), sans donnée personnelle.`),
        outil: z.string().max(avis.COURT_MAX).optional().describe("L'outil concerné (« meteo_actuelle », « transports »…)."),
        lieu: z.string().max(avis.COURT_MAX).optional().describe("Le lieu concerné (« Cilaos », « plage de l'Hermitage »)."),
        besoin: z
          .string()
          .max(avis.BESOIN_MAX)
          .optional()
          .describe(`Le besoin résumé en quelques mots (« la pluie à Marla ce matin »), ${avis.BESOIN_MAX} caractères au plus : jamais le texte de la conversation, rien de personnel.`),
      },
      annotations: { title: "Donner un avis", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    track("donner_avis", async (args: { type: avis.TypeAvis; message: string; outil?: string; lieu?: string; besoin?: string }, extra) => {
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
          question: avis.nettoie(args.besoin, avis.BESOIN_MAX),
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
    "sites_sans_reponse",
    {
      title: "Sites publics de La Réunion sans réponse",
      description:
        "Sites publics de La Réunion (974) qui ne répondent pas en ce moment, revérifiés chaque jour : pour chacun, depuis quand, le dernier constat en mots simples (erreur du serveur, page de maintenance, pas de réponse dans le délai…) et ce qui manque donc sur rundata.re (avis de coupure d'eau, bulletins du volcan, houle…). " +
        "Un site qui répond de nouveau sort de la liste. Ne dit jamais pourquoi un site se tait. " +
        "Pour : « le site de l'OVPF marche ? », « pourquoi pas de bulletin du volcan ? », « le site de Sudéau ne répond plus ? ».",
      inputSchema: {
        quoi: z
          .string()
          .optional()
          .describe("Un site, une commune ou un thème : « volcan », « eau », « Saint-Joseph ». Vide = toute la liste."),
      },
      annotations: { title: "Sites publics sans réponse", ...READ_ONLY },
    },
    track("sites_sans_reponse", (args) => sitesSansReponse(cache, args.quoi)),
  );

  server.registerTool(
    "sources_donnees",
    {
      title: "Sources des données",
      description:
        "À appeler avant de dire qu'un sujet n'est pas couvert, même à la première question : la liste à jour de ce que rundata.re couvre. " +
        "Sources de données utilisées par ce serveur (organisme, licence, attribution à citer), ce qui est couvert ou pas encore, " +
        "la liste à jour de tous les outils, les dernières nouveautés, et rundata.re en chiffres (sources, producteurs, licences, stations, défibrillateurs, sentiers). " +
        "Pour : « d'où viennent tes données ? », « combien de sources lit rundata.re ? », « c'est open data ? ».",
      inputSchema: {},
      annotations: { title: "Sources des données", ...READ_ONLY },
    },
    track("sources_donnees", async () => {
      // rundata.re en chiffres (chiffres.ts): what the code counts, and the last copy of what the sources do.
      const sources = toutesLesSources();
      const c = chiffres(sources, await cache.peek<Copie>(CHIFFRES).catch(() => undefined), new Date(), tools);
      return text({
        resume: resumeChiffres(c),
        // The sources counted, so that the list and its count (chiffres.sources) say the same number; apart, what
        // rundata.re is sent rather than reads (the clubs' proposals), with its licence and attribution all the same.
        sources: sources.filter(comptee),
        envoyees_a_rundata: sources.filter((s) => !comptee(s)),
        // The media and sites whose terms forbid reading them by a program, the halls and sports sites whose terms forbid
        // taking their information without their accord: not read (tools/non-repris.ts).
        non_reprises: [FICHE_LA1ERE, FICHE_REUNION_FR, ...fichesNonReprises()],
        lieux: GAZETTEER_ATTRIBUTION,
        couverture: { meteo: weatherCoverage(), mer: SEA_COVERAGE, previsions: forecastCoverage(), evenements: AGENDA_COVERAGE },
        chiffres: c,
        version: VERSION,
        // Every tool and the latest changes, for a client whose list of tools is older than the server.
        ...catalogue(),
      });
    }),
  );

  return server;
}
