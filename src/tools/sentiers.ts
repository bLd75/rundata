import type { Cache } from "../cache.js";
import { distanceKm } from "../geo.js";
import { communeAt, normalize, resolvePlace } from "../places/resolve.js";
import * as onf from "../providers/sentiers.js";
import * as traces from "../providers/traces.js";
import { why } from "../types.js";
import { a, credits, notFound, placeBlock, text } from "./format.js";

const NEAR_KM = 4;
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
    return { sentier: nom, etat: s?.statut ?? ("inconnu" as onf.Statut), cause: shut?.cause, precision: shut?.info };
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

/** The hikes of OpenStreetMap that pass within `km` of a point. */
function routesNear(lon: number, lat: number, km: number): traces.Randonnee[] {
  return traces.RANDONNEES.filter((r) => r.lignes.some((l) => traces.decode(l).some(([x, y]) => distanceKm(lon, lat, x, y) <= km)));
}

function roadRow(r: onf.Route) {
  return { route: r.nom, circulation: r.circulation, cause: r.cause, precision: r.info, vitesse_max: r.vitesse_max };
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
    "Traces GPS (GPX) : sentiers de l'ONF tels que sa carte les trace, itinéraires complets d'OpenStreetMap (© les contributeurs d'OpenStreetMap, ODbL) ; altitudes, dénivelés et profils d'après l'IGN (RGE ALTI). Une trace ne remplace ni le balisage ni l'état du sentier.",
  ],
};

export async function sentiersRandonnee(cache: Cache, lieu: string | undefined, now = new Date()) {
  let carte: onf.Carte;
  try {
    carte = (await onf.carte(cache)).value;
  } catch (err) {
    console.error(`source ${onf.SOURCE.id} indisponible:`, why(err));
    return { ...text({ erreur: "La carte des sentiers de l'ONF ne répond pas pour le moment.", consulter: onf.SOURCE.url }), isError: true };
  }
  const closed = carte.sentiers.filter((s) => s.statut === "fermé");
  const roadsClosed = carte.routes.filter((r) => /interdit/i.test(r.circulation));
  const common = {
    carte_mise_a_jour: carte.mise_a_jour ? `${day(carte.mise_a_jour)} (ONF)` : undefined,
    ...COMMON,
    consulter: onf.SOURCE.url,
    sources: credits([onf.SOURCE]),
  };
  void now;

  if (!lieu?.trim()) {
    return text({
      resume: `${closed.length} sentiers fermés sur ${carte.sentiers.length} suivis par l'ONF à La Réunion` +
        (roadsClosed.length ? `, et ${roadsClosed.length} route${roadsClosed.length > 1 ? "s" : ""} forestière${roadsClosed.length > 1 ? "s" : ""} interdite${roadsClosed.length > 1 ? "s" : ""} à la circulation` : "") + ".",
      fermes_par_commune: closedByCommune(carte.sentiers),
      routes_forestieres_fermees: roadsClosed.map(roadRow),
      ...common,
    });
  }

  const q = normalize(lieu);
  const cirque = Object.entries(CIRQUES).find(([k]) => q.split(" ").includes(k))?.[1];
  const res = cirque ? null : resolvePlace(lieu);
  // A cirque or a commune is a zone; its name in a few trails' names (« Cilaos - Bras Sec ») is not what is asked.
  const wide = !!cirque || res?.lieu.type === "commune";
  const named = wide && !/\bsentier\b/.test(q) ? [] : trailsNamed(carte.sentiers, lieu).slice(0, NAMED_MAX);
  const hikes = wide && !/\b(sentier|trace|gpx|gr)\b/.test(q) ? [] : routesNamed(lieu).slice(0, NAMED_MAX);
  if (!cirque && !res && !named.length && !hikes.length) return notFound(lieu);

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
  for (const h of hikes.slice(0, 3)) {
    const row = routeRow(h, carte);
    parts.push(`${h.nom} (OpenStreetMap) : ${String(h.km).replace(".", ",")} km, ${h.dplus} m de dénivelé positif${h.boucle ? ", en boucle" : ""} ; ${row.etat} ; trace GPS ${row.trace_gpx}.`);
  }
  if (named.length) {
    const shut = named.filter((s) => s.statut === "fermé");
    parts.push(named.length === 1
      ? `${named[0].nom} : ${named[0].statut === "fermé" ? `FERMÉ${named[0].cause ? ` (${named[0].cause})` : ""}` : named[0].statut === "ouvert" ? "ouvert" : "état non connu (hors gestion ONF)"}.`
      : `${named.length} sentiers portent ce nom : ${shut.length ? `${shut.length} fermé${shut.length > 1 ? "s" : ""} (${shut.map((s) => s.nom).join(", ")})` : "aucun fermé"}.`);
  }
  let zoneOut: Record<string, unknown> | undefined;
  if (zone) {
    const zClosed = zone.sentiers.filter((s) => s.statut === "fermé");
    const zOpen = zone.sentiers.filter((s) => s.statut === "ouvert").length;
    const zOther = zone.sentiers.length - zClosed.length - zOpen;
    const zRoads = zone.routes.filter((r) => /interdit/i.test(r.circulation));
    parts.push(zone.sentiers.length
      ? `${zone.dans} : ${zClosed.length} sentier${zClosed.length > 1 ? "s" : ""} fermé${zClosed.length > 1 ? "s" : ""}, ${zOpen} ouvert${zOpen > 1 ? "s" : ""}` +
        (zOther ? `, ${zOther} hors gestion ONF (état non connu)` : "") + (zRoads.length ? ` ; ${zRoads.length} route${zRoads.length > 1 ? "s" : ""} forestière${zRoads.length > 1 ? "s" : ""} interdite${zRoads.length > 1 ? "s" : ""}` : "") + "."
      : `${zone.dans} : aucun sentier suivi par l'ONF.`);
    const center = cirque ?? (res ? { lon: res.lieu.lon, lat: res.lieu.lat, km: res.lieu.type === "commune" ? 6 : NEAR_KM } : null);
    const around = center && !hikes.length ? routesNear(center.lon, center.lat, center.km).slice(0, ROUTES_MAX) : [];
    zoneOut = {
      zone: zone.nom,
      randonnees_avec_trace: around.length
        ? around.map((r) => ({ randonnee: r.nom, longueur_km: r.km, denivele_positif_m: r.dplus, trace_gpx: `${SITE_URL}/randonnees/${r.slug}.gpx`, page: `${SITE_URL}/randonnees/${r.slug}` }))
        : undefined,
      sentiers_fermes: zClosed.map((s) => trailRow(s, zone!.from)),
      sentiers_ouverts: unique(zone.sentiers.filter((s) => s.statut === "ouvert").map((s) => s.nom)).map((nom) => {
        const t = traces.SENTIERS[nom];
        return t ? { sentier: nom, longueur_km: t.km, denivele_positif_m: t.dplus, trace_gpx: `${SITE_URL}/sentiers/${t.slug}.gpx` } : { sentier: nom };
      }),
      hors_gestion_onf: zOther ? zone.sentiers.filter((s) => s.statut !== "ouvert" && s.statut !== "fermé").map((s) => s.nom) : undefined,
      routes_forestieres: zone.routes.length ? zone.routes.map(roadRow) : undefined,
    };
  }

  return text({
    lieu: res ? placeBlock(lieu, res) : undefined,
    resume: parts.join(" "),
    randonnees: hikes.length ? hikes.map((h) => routeRow(h, carte)) : undefined,
    sentiers_nommes: named.length ? named.map((s) => trailRow(s)) : undefined,
    ...(zoneOut ? { autour: zoneOut } : {}),
    ...common,
  });
}
