import type { Cache } from "../cache.js";
import { distanceKm } from "../geo.js";
import { communeAt, normalize, resolvePlace } from "../places/resolve.js";
import * as feux from "../providers/feux.js";
import * as onf from "../providers/sentiers.js";
import * as traces from "../providers/traces.js";
import * as aires from "../traces/aires.js";
import { why } from "../types.js";
import * as fire from "./feux.js";
import { a, credits, de, notFound, placeBlock, text } from "./format.js";

const NEAR_KM = 4;
// A fire this close to the place asked is said first.
const FIRE_KM = 10;
const NAMED_MAX = 8;
const ROUTES_MAX = 10;
/** Where the traces and the trails' pages are served. */
export const SITE_URL = "https://rundata.re";
// The cirques have no single point: a question about one takes the trails within its walls, roughly.
const CIRQUES: Record<string, { nom: string; lon: number; lat: number; km: number }> = {
  mafate: { nom: "le cirque de Mafate", lon: 55.43, lat: -21.055, km: 6 },
  cilaos: { nom: "le cirque de Cilaos", lon: 55.475, lat: -21.13, km: 6 },
  salazie: { nom: "le cirque de Salazie", lon: 55.515, lat: -21.05, km: 7 },
};
const STOP = new Set(["sentier", "sentiers", "chemin", "route", "routes", "forestiere", "de", "des", "du", "la", "le", "les", "l", "d", "a", "au", "aux", "par", "et", "ferme", "fermes", "ouvert", "ouverts", "randonnee", "randonnees", "rando", "randos", "est", "il", "ce", "trace", "traces", "gps", "gpx", "itineraire", "parcours"]);

/** What a hiker may ask for: a length, a climb. */
export interface Filtre {
  longueur_min_km?: number;
  longueur_max_km?: number;
  denivele_max_m?: number;
}
const filtering = (f?: Filtre): f is Filtre => !!f && (f.longueur_min_km != null || f.longueur_max_km != null || f.denivele_max_m != null);
export const fits = (f: Filtre | undefined, km: number, dplus?: number) =>
  !filtering(f) ||
  ((f.longueur_min_km == null || km >= f.longueur_min_km) && (f.longueur_max_km == null || km <= f.longueur_max_km) && (f.denivele_max_m == null || (dplus != null && dplus <= f.denivele_max_m)));
const PROPOSALS_MAX = 15;
// The ONF's reception areas said with a zone or a trail: the nearest, at most this many; along a trail, this close.
const AIRES_MAX = 10;
const AIRES_TRAIL_KM = 0.3;

/**
 * The hiking areas of the island, for a list of its trails: the three cirques, the volcano, then the rest by communes.
 * Mafate has no commune of its own (La Possession and Saint-Paul share it): a box inside their rims, leaving out the
 * Maïdo and Grand Bord side and Dos d'Âne. Approximate, from the middle of each trail.
 */
/**
 * The sectors of the hikes, in the order of the pages (src/traces/secteurs.ts). A trail's or a route's is computed when
 * the traces are built (scripts/build-traces.py); for a point, `secteur` tells it from its commune, as near as it can.
 */
export const SECTEURS: { nom: string; communes?: string[] }[] = [
  { nom: "Mafate" },
  { nom: "Cilaos", communes: ["Cilaos"] },
  { nom: "Salazie", communes: ["Salazie"] },
  { nom: "Volcan" },
  { nom: "Hauts de l'Ouest", communes: ["Saint-Paul", "Le Port", "Les Trois-Bassins", "Saint-Leu", "Les Avirons", "L'Étang-Salé"] },
  { nom: "Nord", communes: ["Saint-Denis", "Sainte-Marie", "Sainte-Suzanne", "La Possession"] },
  { nom: "Est", communes: ["Saint-André", "Bras-Panon", "Saint-Benoît", "La Plaine-des-Palmistes"] },
  { nom: "Sud", communes: ["Saint-Pierre", "Petite-Île", "Le Tampon", "Entre-Deux", "Saint-Louis", "Saint-Joseph"] },
  { nom: "Sud sauvage", communes: ["Sainte-Rose", "Saint-Philippe"] },
  { nom: "Littoral" },
];
const FOURNAISE = { lon: 55.7083, lat: -21.2444, km: 9 };

export function secteur(lon: number, lat: number): { secteur: string; commune: string } {
  const commune = communeAt(lon, lat);
  const mafate = (commune === "La Possession" || commune === "Saint-Paul") && lon >= 55.39 && lat >= -21.105 && lat <= -20.995 && !(lon < 55.4 && lat < -21.075);
  if (mafate) return { secteur: "Mafate", commune };
  if (commune !== "Cilaos" && commune !== "Salazie" && distanceKm(lon, lat, FOURNAISE.lon, FOURNAISE.lat) <= FOURNAISE.km) return { secteur: "Volcan", commune };
  return { secteur: SECTEURS.find((x) => x.communes?.includes(commune))?.nom ?? "Hauts de l'Ouest", commune };
}

/** An ONF trail's sector: the one computed with the traces, else the one of a point of it. */
export const trailSecteur = (nom: string, at?: [number, number]) => traces.SENTIERS[nom]?.secteur ?? (at ? secteur(...at).secteur : undefined);

const unique = (l: string[]) => [...new Set(l)];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const words = (s: string) => normalize(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t));
const day = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

const mid = (s: { points: [number, number][] }) => s.points[Math.floor(s.points.length / 2)];

/** Distance from a point to the nearest point of a trail, in km. */
function near(s: onf.Sentier | onf.Route, lon: number, lat: number): number {
  let best = Infinity;
  for (const [x, y] of s.points) best = Math.min(best, distanceKm(lon, lat, x, y));
  return best;
}

/** The trails whose name holds every word of the question that is not filler (« Roche Plate » → 4 trails). */
export function trailsNamed(sentiers: onf.Sentier[], asked: string): onf.Sentier[] {
  const q = words(asked);
  if (!q.length) return [];
  return sentiers.filter((s) => {
    const own = new Set(words(s.nom));
    return q.every((t) => own.has(t));
  });
}

/** Where an ONF trail's page and GPS trace are, with its climb, from the bundle. */
export function trailTrace(nom: string) {
  const t = traces.SENTIERS[nom];
  if (!t) return {};
  return {
    denivele_positif_m: t.dplus,
    denivele_negatif_m: t.dmoins,
    altitude_max_m: t.alt_max,
    trace_gpx: `${SITE_URL}/sentiers/${t.slug}.gpx`,
    page: `${SITE_URL}/sentiers/${t.slug}`,
  };
}

export function trailRow(s: onf.Sentier, from?: { lon: number; lat: number }) {
  return {
    sentier: s.nom,
    etat: s.statut,
    cause: s.cause,
    precision: s.info,
    longueur_km: s.longueur_km || undefined,
    distance_km: from && s.points.length ? Math.round(near(s, from.lon, from.lat) * 10) / 10 : undefined,
    ...trailTrace(s.nom),
  };
}

/** The hikes of OpenStreetMap whose name holds every word asked (« Piton des Neiges », « GR R2 »). */
export function routesNamed(asked: string): traces.Randonnee[] {
  const q = words(asked);
  if (!q.length) return [];
  return traces.RANDONNEES.filter((r) => {
    const own = new Set(words(`${r.nom} ${r.ref ?? ""}`));
    return q.every((t) => own.has(t));
  });
}

/** A hike with its trace, and the state of the ONF trails it follows, read live from the ONF's map. */
export function routeRow(r: traces.Randonnee, carte: onf.Carte) {
  const states = r.sentiers_onf.map((nom) => {
    const parts = carte.sentiers.filter((s) => s.nom === nom);
    const shut = parts.find((s) => s.statut === "fermé");
    const s = shut ?? parts.find((x) => x.statut === "ouvert") ?? parts[0];
    const t = traces.SENTIERS[nom];
    return { sentier: nom, etat: s?.statut ?? ("inconnu" as onf.Statut), cause: shut?.cause, precision: shut?.info, page: t ? `${SITE_URL}/sentiers/${t.slug}` : undefined };
  });
  const closed = states.filter((s) => s.etat === "fermé");
  return {
    randonnee: r.nom,
    longueur_km: r.km,
    denivele_positif_m: r.dplus,
    denivele_negatif_m: r.dmoins,
    altitude_min_m: r.alt_min,
    altitude_max_m: r.alt_max,
    boucle: r.boucle || undefined,
    etat: closed.length
      ? `${closed.length} tronçon${closed.length > 1 ? "s" : ""} fermé${closed.length > 1 ? "s" : ""} : ${closed.map((c) => c.sentier).join(", ")}`
      : states.some((s) => s.etat === "ouvert") ? "tronçons suivis par l'ONF ouverts" : "état non suivi par l'ONF",
    troncons_onf: states.length ? states : undefined,
    trace_gpx: `${SITE_URL}/randonnees/${r.slug}.gpx`,
    page: `${SITE_URL}/randonnees/${r.slug}`,
  };
}

type RouteRow = ReturnType<typeof routeRow>;

/**
 * The closed ONF trails on these hikes, each once with the hikes it cuts, and the sentence that says it: what an
 * answer must give first. Nothing when none is closed.
 */
export function warning(rows: RouteRow[], trails: onf.Sentier[] = []) {
  const by = new Map<string, { sentier: string; cause?: string; reouverture?: string; page?: string; randonnees: string[] }>();
  for (const s of trails.filter((x) => x.statut === "fermé")) {
    const t = traces.SENTIERS[s.nom];
    by.set(s.nom, { sentier: s.nom, cause: s.cause, reouverture: s.info, page: t ? `${SITE_URL}/sentiers/${t.slug}` : undefined, randonnees: [] });
  }
  for (const r of rows) {
    for (const t of r.troncons_onf ?? []) {
      if (t.etat !== "fermé") continue;
      const w = by.get(t.sentier) ?? { sentier: t.sentier, cause: t.cause, reouverture: t.precision, page: t.page, randonnees: [] };
      w.randonnees.push(r.randonnee);
      by.set(t.sentier, w);
    }
  }
  if (!by.size) return undefined;
  const hit = rows.filter((r) => r.troncons_onf?.some((t) => t.etat === "fermé"));
  const alone = [...by.values()].filter((w) => !w.randonnees.length);
  const message = "ATTENTION : " + [
    ...hit.map((r) => {
      const shut = r.troncons_onf!.filter((t) => t.etat === "fermé");
      return `${r.randonnee} emprunte ${shut.length} sentier${shut.length > 1 ? "s" : ""} fermé${shut.length > 1 ? "s" : ""} : ` +
        shut.map((t) => `${t.sentier}${t.cause ? ` (${t.cause})` : ""}`).join(", ");
    }),
    ...alone.map((w) => `${w.sentier} est fermé${w.cause ? ` (${w.cause})` : ""}`),
  ].join("\u00a0; ") + ". Un sentier fermé est interdit : ne pas s'y engager, prendre une variante ouverte ou renoncer.";
  // Said first in the summary when a hike is cut; a trail asked by its name already opens it with its state.
  return { message, sentiers_fermes: [...by.values()], routes: hit.length > 0 };
}

/** A hike in a list: its figures, its state, its trace. */
const routeBrief = (r: traces.Randonnee, carte: onf.Carte) => {
  const row = routeRow(r, carte);
  return { randonnee: r.nom, longueur_km: r.km, denivele_positif_m: r.dplus, boucle: row.boucle, etat: row.etat, trace_gpx: row.trace_gpx, page: row.page };
};

/** The hikes of OpenStreetMap that pass within `km` of a point. */
function routesNear(lon: number, lat: number, km: number): traces.Randonnee[] {
  return traces.RANDONNEES.filter((r) => r.lignes.some((l) => traces.decode(l).some(([x, y]) => distanceKm(lon, lat, x, y) <= km)));
}

function roadRow(r: onf.Route) {
  return { route: r.nom, circulation: r.circulation, cause: r.cause, precision: r.info, vitesse_max: r.vitesse_max };
}

// A question about forest roads: their words, or the ONF's code (« RF », « RF20 », « RF 5 »).
const ROAD = /\b(routes? forestieres?|rfs? ?\d*)\b/;
// Words that ask for nothing more than the forest roads: such a question is about all of them, on the island.
const ROADS_ONLY = new Set(["forestieres", "rf", "rfs", "onf", "fermee", "fermees", "ouverte", "ouvertes", "interdite", "interdites", "circulation", "etat", "toutes", "quelles", "sont", "sur", "en", "ile", "reunion", "acces", "liste"]);

type RoadsAsked = { toutes: true } | { routes: onf.Route[] } | { introuvable: string; code: boolean };

/**
 * The forest roads a question asks for: all of them for « route forestière » or « RF » alone, those its code or its words
 * name otherwise, or the code or name that no road of the map has. Undefined when the question is not about them.
 */
export function roadsAsked(routes: onf.Route[], lieu: string): RoadsAsked | undefined {
  const q = normalize(lieu);
  if (!ROAD.test(q)) return undefined;
  const code = q.match(/\brf ?(\d+)\b/)?.[1];
  const w = words(lieu).filter((t) => !ROADS_ONLY.has(t));
  if (!code && !w.length) return { toutes: true };
  const hit = routes.filter((r) => code ? new RegExp(`\\(RF0*${Number(code)}\\)`).test(r.nom) : w.every((t) => normalize(r.nom).split(" ").includes(t)));
  if (hit.length) return { routes: hit };
  // Said as asked, without the words that only say it is a forest road.
  const name = lieu.replace(/^\s*(?:(?:les?|la)\s+)?routes?\s+foresti[eè]res?\s+(?:de\s+la|de\s+l'|des|du|de|d')?\s*/i, "").replace(/\s*\?\s*$/, "").trim();
  return { introuvable: code ? `RF${code}` : name || lieu.trim(), code: !!code };
}

const km = (x: number) => String(x).replace(".", ",");
const state = (r: onf.Route) => `${r.circulation}${r.cause ? ` (${r.cause})` : ""}`;

/**
 * The forest roads asked, in marketing's words: the island counts roads, not the
 * pieces of the map; a road asked by its name gives each piece with its length when they are not in the same state.
 */
function roadsAnswer(asked: RoadsAsked, routes: onf.Route[], common: Record<string, unknown>, fireSentence: string) {
  // The map answered without its roads: never « aucune ».
  if (!routes.length) return { ...text({ erreur: "La carte des sentiers de l'ONF ne répond pas pour le moment.", consulter: onf.SOURCE.url }), isError: true };
  const seen = new Set<string>();
  // One row per road and state: the ONF's map cuts some roads in several pieces.
  const rows = routes.filter((r) => {
    const k = `${r.nom}|${state(r)}`;
    return !seen.has(k) && !!seen.add(k);
  });
  const shut = (r: onf.Route) => /interdit/i.test(r.circulation);
  const where = (r: onf.Route) => (r.points.length ? communeAt(...mid(r)) : undefined);
  const all = rows.map((r) => ({ ...roadRow(r), commune: where(r) }));
  const n = unique(rows.map((r) => r.nom)).length;
  if ("introuvable" in asked) {
    return text({ resume: `Pas de route forestière « ${asked.introuvable} » sur la carte de l'ONF. L'état des ${n} routes est dans routes_forestieres.`, routes_forestieres: all, ...common });
  }
  if ("toutes" in asked) {
    const names = unique(rows.filter(shut).map((r) => r.nom)).map((nom) =>
      // Closed on a piece only: said so after its code.
      rows.some((r) => r.nom === nom && !shut(r)) ? (nom.endsWith(")") ? `${nom.slice(0, -1)}, sur une partie)` : `${nom} (sur une partie)`) : nom);
    return text({
      resume: `Routes forestières sur la carte de l'ONF : ${n}, ` +
        (names.length ? `dont ${names.length} en circulation interdite : ${names.join(", ")}.` : "aucune en circulation interdite.") +
        " L'état de chacune est dans routes_forestieres." + fireSentence,
      routes_forestieres_fermees: rows.filter(shut).map(roadRow),
      routes_forestieres: all,
      ...common,
    });
  }
  const said = unique(asked.routes.map((r) => r.nom)).map((nom) => {
    const pieces = asked.routes.filter((r) => r.nom === nom);
    return unique(pieces.map(state)).length === 1
      ? `${nom} : ${state(pieces[0])}.`
      : `${nom}, en ${pieces.length} tronçons : ${pieces.map((r) => `${state(r)} sur ${km(r.longueur_km)} km`).join("\u00a0; ")}.`;
  });
  return text({
    resume: said.join(" "),
    routes_forestieres: asked.routes.map((r) => ({ ...roadRow(r), longueur_km: r.longueur_km, commune: where(r) })),
    ...common,
  });
}

/** The closed trails by commune (where their middle is), the communes with the most first. */
export function closedByCommune(sentiers: onf.Sentier[]) {
  const by = new Map<string, onf.Sentier[]>();
  for (const s of sentiers.filter((x) => x.statut === "fermé" && x.points.length)) {
    const c = communeAt(...mid(s));
    by.set(c, [...(by.get(c) ?? []), s]);
  }
  return [...by.entries()]
    .sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0], "fr"))
    .map(([commune, list]) => ({ commune, sentiers_fermes: list.sort((x, y) => x.nom.localeCompare(y.nom, "fr")).map((s) => trailRow(s)) }));
}

const COMMON = {
  a_savoir: [
    "Un sentier fermé l'est par arrêté préfectoral ou décision de l'ONF (éboulement, passage effondré, coulée, travaux) : s'y engager est interdit et dangereux.",
    "Les sentiers « hors gestion ONF » (communes, Département, privés) n'ont pas d'état connu ici : se renseigner auprès de la commune ou du Parc national.",
    "En cas de vigilance fortes pluies ou orages, la préfecture peut fermer d'autres sentiers ou interdire l'accès aux ravines : vérifier la vigilance avant de partir. Urgence en montagne : 112.",
    "Traces GPS (GPX) : sentiers de l'ONF tels que sa carte les trace, itinéraires complets d'OpenStreetMap (© les contributeurs d'OpenStreetMap, ODbL)\u00a0; altitudes, dénivelés et profils d'après l'IGN (RGE ALTI). Une trace ne remplace ni le balisage ni l'état du sentier.",
  ],
};

/**
 * The ONF's reception areas of a zone or along a trail (traces/aires.ts), the nearest first, in marketing's words: each
 * under the ONF's name, codes and all, never said to be for camping or a picnic unless its name says so. `ou`: where,
 * as the summary says it (« à moins de 4 km de Maïdo », « dans la commune de Saint-Paul »).
 */
export function airesBlock(list: (aires.Aire & { distance_km?: number })[], ou: string, rayon_km?: number) {
  return {
    ou,
    rayon_km,
    nombre: list.length,
    aires: list.slice(0, AIRES_MAX).map((x) => ({ nom: x.nom, distance_km: x.distance_km, carte: aires.carte(x) })),
    a_savoir: `Aires d'accueil de l'ONF, sous le nom que leur donne sa carte des sentiers${aires.MISE_A_JOUR ? ` (mise à jour le ${day(aires.MISE_A_JOUR)})` : ""}, codes compris : « RF » désigne une route forestière, et « pk » le point kilométrique sur cette route. La carte ne dit pas ce qu'on trouve sur chaque aire, ni ce qu'on a le droit d'y faire (camper, faire du feu) : se renseigner auprès de l'ONF.`,
  };
}

export async function sentiersRandonnee(cache: Cache, lieu: string | undefined, now = new Date(), filtre?: Filtre) {
  let carte: onf.Carte;
  // The fires seen by satellite, beside the trails: nothing without FIRMS's key (providers/feux.ts).
  const seen = feux.feuxNow(cache, now);
  try {
    carte = (await onf.carte(cache)).value;
  } catch (err) {
    console.error(`source ${onf.SOURCE.id} indisponible:`, why(err));
    return { ...text({ erreur: "La carte des sentiers de l'ONF ne répond pas pour le moment.", consulter: onf.SOURCE.url }), isError: true };
  }
  const closed = carte.sentiers.filter((s) => s.statut === "fermé");
  const roadsClosed = carte.routes.filter((r) => /interdit/i.test(r.circulation));
  const fires = await seen;
  const common = {
    feux_detectes: fires ? fire.block(fires, now) : undefined,
    carte_mise_a_jour: carte.mise_a_jour ? `${day(carte.mise_a_jour)} (ONF)` : undefined,
    ...COMMON,
    consulter: onf.SOURCE.url,
    sources: credits(fires ? [onf.SOURCE, feux.SOURCE] : [onf.SOURCE]),
  };
  // Said after the trails on the island: a list of the closures is what was asked.
  const fireSentence = fires?.detections.length ? ` ${fire.vigilanceLine(fires, now)!.replace(" Détails avec sentiers_randonnee.", "")}` : "";

  if (!lieu?.trim() && filtering(filtre)) {
    // A hike of a given length or climb anywhere: the full routes first, then the ONF trails, open ones only.
    const routes = traces.RANDONNEES.filter((r) => fits(filtre, r.km, r.dplus)).slice(0, PROPOSALS_MAX);
    const rows = routes.map((r) => routeRow(r, carte));
    const open = unique(carte.sentiers.filter((x) => x.statut === "ouvert").map((x) => x.nom))
      .map((nom) => ({ nom, t: traces.SENTIERS[nom] }))
      .filter((x) => x.t && fits(filtre, x.t.km, x.t.dplus))
      .slice(0, PROPOSALS_MAX);
    const warn = warning(rows);
    return text({
      ...(warn ? { avertissement: { message: warn.message, sentiers_fermes: warn.sentiers_fermes } } : {}),
      resume: `${warn ? `${warn.message} ` : ""}${routes.length} itinéraire${routes.length > 1 ? "s" : ""} complet${routes.length > 1 ? "s" : ""} et ${open.length} sentier${open.length > 1 ? "s" : ""} ouvert${open.length > 1 ? "s" : ""} de l'ONF correspondent (listes limitées à ${PROPOSALS_MAX}). Préciser un lieu (cirque, commune, sommet) pour choisir.`,
      randonnees_avec_trace: routes.map((r) => routeBrief(r, carte)),
      sentiers_ouverts: open.map(({ nom, t }) => ({ sentier: nom, longueur_km: t.km, denivele_positif_m: t.dplus, secteur: (() => { const s = carte.sentiers.find((x) => x.nom === nom && x.points.length); return trailSecteur(nom, s && mid(s)); })(), trace_gpx: `${SITE_URL}/sentiers/${t.slug}.gpx`, page: `${SITE_URL}/sentiers/${t.slug}` })),
      ...common,
    });
  }

  if (!lieu?.trim()) {
    return text({
      // By name, as the pages count them: the ONF's map cuts some trails in several pieces.
      resume: `${unique(closed.map((s) => s.nom)).length} sentiers fermés sur ${unique(carte.sentiers.map((s) => s.nom)).length} suivis par l'ONF à La Réunion` +
        (roadsClosed.length ? `, et ${roadsClosed.length} route${roadsClosed.length > 1 ? "s" : ""} forestière${roadsClosed.length > 1 ? "s" : ""} interdite${roadsClosed.length > 1 ? "s" : ""} à la circulation` : "") + "." + fireSentence,
      fermes_par_commune: closedByCommune(carte.sentiers),
      routes_forestieres_fermees: roadsClosed.map(roadRow),
      ...common,
    });
  }

  // The forest roads, all or named; a name that no road has may still be a place (« routes forestières à Cilaos »).
  const asked = roadsAsked(carte.routes, lieu);
  if (asked && !("introuvable" in asked && !asked.code)) return roadsAnswer(asked, carte.routes, common, fireSentence);

  const q = normalize(lieu);
  const cirque = Object.entries(CIRQUES).find(([k]) => q.split(" ").includes(k))?.[1];
  const res = cirque ? null : resolvePlace(lieu);
  // A cirque or a commune is a zone; its name in a few trails' names (« Cilaos - Bras Sec ») is not what is asked.
  const wide = !!cirque || res?.lieu.type === "commune";
  const named = wide && !/\bsentier\b/.test(q) ? [] : trailsNamed(carte.sentiers, lieu).slice(0, NAMED_MAX);
  const hikes = wide && !/\b(sentier|trace|gpx|gr)\b/.test(q) ? [] : routesNamed(lieu).slice(0, NAMED_MAX);
  if (!cirque && !res && !named.length && !hikes.length) return asked ? roadsAnswer(asked, carte.routes, common, fireSentence) : notFound(lieu);

  let zone: { nom: string; dans: string; sentiers: onf.Sentier[]; routes: onf.Route[]; from?: { lon: number; lat: number } } | null = null;
  if (cirque) {
    zone = {
      nom: cirque.nom,
      dans: `Dans ${cirque.nom}`,
      sentiers: carte.sentiers.filter((s) => near(s, cirque.lon, cirque.lat) <= cirque.km),
      routes: carte.routes.filter((r) => near(r, cirque.lon, cirque.lat) <= cirque.km),
    };
  } else if (res && res.lieu.type === "commune") {
    const inCommune = (s: { points: [number, number][] }) => s.points.length > 0 && communeAt(...mid(s)) === res.lieu.commune;
    zone = { nom: res.lieu.commune, dans: cap(a(res.lieu.commune)), sentiers: carte.sentiers.filter(inCommune), routes: carte.routes.filter(inCommune) };
  } else if (res) {
    const from = { lon: res.lieu.lon, lat: res.lieu.lat };
    zone = {
      nom: `${NEAR_KM} km autour de ${res.lieu.nom}`,
      dans: `À moins de ${NEAR_KM} km de ${res.lieu.nom}`,
      sentiers: carte.sentiers.filter((s) => near(s, from.lon, from.lat) <= NEAR_KM),
      routes: carte.routes.filter((r) => near(r, from.lon, from.lat) <= NEAR_KM),
      from,
    };
  }

  const parts: string[] = [];
  const center = zone ? cirque ?? (res ? { lon: res.lieu.lon, lat: res.lieu.lat, km: res.lieu.type === "commune" ? 6 : NEAR_KM } : null) : null;
  const around = center && !hikes.length ? routesNear(center.lon, center.lat, center.km).filter((r) => fits(filtre, r.km, r.dplus)).slice(0, ROUTES_MAX) : [];
  const warn = warning([...hikes, ...around].map((r) => routeRow(r, carte)), named);
  // A fire seen near the place goes first, before the closures.
  const nearby = center && fires ? fires.detections.filter((d) => distanceKm(center.lon, center.lat, d.lon, d.lat) <= center.km + FIRE_KM) : [];
  if (nearby.length) parts.push(`Feu de végétation détecté par satellite près de ${nearby[0].lieu}, ${fire.when(nearby[0].t, now)}${nearby.length > 1 ? ` (${nearby.length} détections dans le secteur)` : ""} : ${feux.LABEL}. ${fire.URGENCE}`);
  if (warn?.routes) parts.push(warn.message);
  for (const h of hikes.slice(0, 3)) {
    const row = routeRow(h, carte);
    parts.push(`${h.nom} (OpenStreetMap) : ${String(h.km).replace(".", ",")} km, ${h.dplus} m de dénivelé positif${h.boucle ? ", en boucle" : ""}\u00a0; ${row.etat}\u00a0; trace GPS ${row.trace_gpx}.`);
  }
  if (named.length) {
    const shut = named.filter((s) => s.statut === "fermé");
    parts.push(named.length === 1
      ? `${named[0].nom} : ${named[0].statut === "fermé" ? `FERMÉ${named[0].cause ? ` (${named[0].cause})` : ""}` : named[0].statut === "ouvert" ? "ouvert" : "état non connu (hors gestion ONF)"}.`
      : `${named.length} sentiers portent ce nom : ${shut.length ? `${shut.length} fermé${shut.length > 1 ? "s" : ""} (${shut.map((s) => s.nom).join(", ")})` : "aucun fermé"}.`);
  }
  let zoneOut: Record<string, unknown> | undefined;
  // The ONF's reception areas of the zone, else along the trail asked by its name.
  const reception = cirque
    ? airesBlock(aires.near(cirque.lon, cirque.lat, cirque.km), `dans ${cirque.nom}`, cirque.km)
    : res?.lieu.type === "commune"
      ? airesBlock(aires.inCommune(res.lieu.commune), `dans la commune ${de(res.lieu.commune)}`)
      : zone?.from
        ? airesBlock(aires.near(zone.from.lon, zone.from.lat, NEAR_KM), `à moins de ${NEAR_KM} km de ${res!.lieu.nom}`, NEAR_KM)
        : named.length
          ? airesBlock(aires.along(named.flatMap((s) => s.points), AIRES_TRAIL_KM), `à moins de ${AIRES_TRAIL_KM * 1000} m ${named.length > 1 ? "de ces sentiers" : "du sentier"}`, AIRES_TRAIL_KM)
          : undefined;
  const receptionSaid = reception?.nombre ? `${reception.nombre} aire${reception.nombre > 1 ? "s" : ""} d'accueil de l'ONF ${reception.ou} (voir aires_accueil).` : undefined;
  if (zone) {
    const zClosed = zone.sentiers.filter((s) => s.statut === "fermé");
    const zOpen = zone.sentiers.filter((s) => s.statut === "ouvert").length;
    const zOther = zone.sentiers.length - zClosed.length - zOpen;
    const zRoads = zone.routes.filter((r) => /interdit/i.test(r.circulation));
    parts.push(zone.sentiers.length
      ? `${zone.dans} : ${zClosed.length} sentier${zClosed.length > 1 ? "s" : ""} fermé${zClosed.length > 1 ? "s" : ""}, ${zOpen} ouvert${zOpen > 1 ? "s" : ""}` +
        (zOther ? `, ${zOther} hors gestion ONF (état non connu)` : "") + (zRoads.length ? `\u00a0; ${zRoads.length} route${zRoads.length > 1 ? "s" : ""} forestière${zRoads.length > 1 ? "s" : ""} interdite${zRoads.length > 1 ? "s" : ""}` : "") + "."
      : `${zone.dans} : aucun sentier suivi par l'ONF.`);
    if (receptionSaid) parts.push(receptionSaid);
    if (filtering(filtre)) {
      const n = around.length;
      parts.push(n ? `${n} itinéraire${n > 1 ? "s" : ""} complet${n > 1 ? "s" : ""} avec trace GPS correspond${n > 1 ? "ent" : ""} à la longueur ou au dénivelé demandés.` : "Aucun itinéraire complet avec trace ne correspond à la longueur ou au dénivelé demandés : voir les sentiers ouverts de la zone, à combiner.");
    }
    zoneOut = {
      zone: zone.nom,
      randonnees_avec_trace: around.length ? around.map((r) => routeBrief(r, carte)) : undefined,
      sentiers_fermes: zClosed.map((s) => trailRow(s, zone!.from)),
      sentiers_ouverts: unique(zone.sentiers.filter((s) => s.statut === "ouvert").map((s) => s.nom)).flatMap((nom) => {
        const t = traces.SENTIERS[nom];
        if (filtering(filtre) && (!t || !fits(filtre, t.km, t.dplus))) return [];
        return [t ? { sentier: nom, longueur_km: t.km, denivele_positif_m: t.dplus, trace_gpx: `${SITE_URL}/sentiers/${t.slug}.gpx` } : { sentier: nom }];
      }),
      hors_gestion_onf: zOther ? zone.sentiers.filter((s) => s.statut !== "ouvert" && s.statut !== "fermé").map((s) => s.nom) : undefined,
      routes_forestieres: zone.routes.length ? zone.routes.map(roadRow) : undefined,
    };
  }

  if (receptionSaid && !zone) parts.push(receptionSaid);
  return text({
    ...(warn ? { avertissement: { message: warn.message, sentiers_fermes: warn.sentiers_fermes } } : {}),
    lieu: res ? placeBlock(lieu, res) : undefined,
    resume: parts.join(" "),
    randonnees: hikes.length ? hikes.map((h) => routeRow(h, carte)) : undefined,
    sentiers_nommes: named.length ? named.map((s) => trailRow(s)) : undefined,
    ...(zoneOut ? { autour: zoneOut } : {}),
    aires_accueil: reception?.nombre ? reception : undefined,
    ...common,
    feux_detectes: fires ? fire.block(fires, now, center ?? undefined) : undefined,
    sources: credits([onf.SOURCE, ...(reception?.nombre ? [aires.SOURCE] : []), ...(fires ? [feux.SOURCE] : [])]),
  });
}
