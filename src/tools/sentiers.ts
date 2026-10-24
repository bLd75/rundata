import type { Cache } from "../cache.js";
import { distanceKm } from "../geo.js";
import { communeAt, normalize, resolvePlace } from "../places/resolve.js";
import * as onf from "../providers/sentiers.js";
import { why } from "../types.js";
import { a, credits, notFound, placeBlock, text } from "./format.js";

const NEAR_KM = 4;
const NAMED_MAX = 8;
// The cirques have no single point: a question about one takes the trails within its walls, roughly.
const CIRQUES: Record<string, { nom: string; lon: number; lat: number; km: number }> = {
  mafate: { nom: "le cirque de Mafate", lon: 55.43, lat: -21.055, km: 6 },
  cilaos: { nom: "le cirque de Cilaos", lon: 55.475, lat: -21.13, km: 6 },
  salazie: { nom: "le cirque de Salazie", lon: 55.515, lat: -21.05, km: 7 },
};
const STOP = new Set(["sentier", "sentiers", "chemin", "route", "routes", "forestiere", "de", "des", "du", "la", "le", "les", "l", "d", "a", "au", "aux", "par", "et", "ferme", "fermes", "ouvert", "ouverts", "randonnee", "rando", "est", "il", "ce"]);

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

export function trailRow(s: onf.Sentier, from?: { lon: number; lat: number }) {
  return {
    sentier: s.nom,
    etat: s.statut,
    cause: s.cause,
    precision: s.info,
    longueur_km: s.longueur_km || undefined,
    distance_km: from && s.points.length ? Math.round(near(s, from.lon, from.lat) * 10) / 10 : undefined,
  };
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
  if (!cirque && !res && !named.length) return notFound(lieu);

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
    zoneOut = {
      zone: zone.nom,
      sentiers_fermes: zClosed.map((s) => trailRow(s, zone!.from)),
      sentiers_ouverts: zone.sentiers.filter((s) => s.statut === "ouvert").map((s) => s.nom),
      hors_gestion_onf: zOther ? zone.sentiers.filter((s) => s.statut !== "ouvert" && s.statut !== "fermé").map((s) => s.nom) : undefined,
      routes_forestieres: zone.routes.length ? zone.routes.map(roadRow) : undefined,
    };
  }

  return text({
    lieu: res ? placeBlock(lieu, res) : undefined,
    resume: parts.join(" "),
    sentiers_nommes: named.length ? named.map((s) => trailRow(s)) : undefined,
    ...(zoneOut ? { autour: zoneOut } : {}),
    ...common,
  });
}
