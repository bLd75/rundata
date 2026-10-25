import type { Cache } from "../cache.js";
import { distanceKm, localTime } from "../geo.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import * as velos from "../providers/velos.js";
import { why } from "../types.js";
import { credits, de, fr, notFound, placeBlock, text } from "./format.js";

export const COMMUNES = ["Saint-Pierre", "Saint-Louis", "L'Étang-Salé"];
// Stations this close to the place asked are worth the walk; past this, the nearest few are given anyway.
const NEAR_M = 1200;
const FAR_M = 5000;

const plural = (n: number, one: string, many: string) => `${fr(n)} ${n > 1 ? many : one}`;

/** « 4 vélos électriques et 6 places libres », « fermée ». */
export function stock(s: velos.StationNow): string {
  if (!s.location) return s.retour ? "pas de location en ce moment (dépôt possible)" : "fermée";
  const parts = [s.velos ? plural(s.velos, "vélo électrique", "vélos électriques") : "aucun vélo"];
  if (s.trottinettes) parts.push(plural(s.trottinettes, "trottinette", "trottinettes"));
  const out = parts.join(", ");
  return s.places != null && s.retour ? `${out} et ${plural(s.places, "place libre", "places libres")}` : out;
}

export function stationRow(s: velos.StationNow, m?: number) {
  return {
    nom: s.nom,
    commune: s.commune,
    ...(m != null ? { distance_m: Math.round(m / 10) * 10 } : {}),
    velos_electriques: s.velos,
    ...(s.trottinettes ? { trottinettes: s.trottinettes } : {}),
    ...(s.places != null ? { places_libres: s.places } : {}),
    ...(s.location && s.retour ? {} : { etat: s.location ? "dépôt impossible en ce moment" : s.retour ? "location impossible en ce moment" : "fermée" }),
    maj: localTime(new Date(s.maj)).split(" ")[1],
  };
}

/** The stations the question names: every word of the station's name is in it (« station IUT », « Pôle d'échanges de Saint-Louis »). */
export function named(list: velos.StationNow[], asked: string): velos.StationNow[] {
  const q = ` ${normalize(asked)} `;
  return list.filter((s) => q.includes(` ${normalize(s.nom)} `)).sort((a, b) => b.nom.length - a.nom.length).slice(0, 1);
}

const COMMON = {
  service: "Altervélo, vélos à assistance électrique en libre-service de la CIVIS : on loue à la station avec l'application Altervélo ou sur https://altervelo.ecovelo.mobi, et on rend le vélo dans n'importe quelle station qui a une place libre.",
  couverture: `Stations à ${COMMUNES.join(", ")} seulement.`,
};

export async function velosLibreService(cache: Cache, lieu: string | undefined, now = new Date()) {
  let list: velos.StationNow[];
  let fetchedAt: Date;
  try {
    ({ value: list, fetchedAt } = await velos.stations(cache));
  } catch (err) {
    console.error(`source ${velos.SOURCE.id} indisponible:`, why(err));
    return { ...text({ erreur: "Les stations Altervélo ne répondent pas pour le moment.", consulter: "https://altervelo.ecovelo.mobi" }), isError: true };
  }
  const common = {
    ...COMMON,
    donnees: `En direct, d'après les stations (relevé de ${localTime(fetchedAt).split(" ")[1]}, heure de La Réunion)\u00a0; un vélo peut être pris entre-temps.`,
    sources: credits([velos.SOURCE]),
  };
  const open = list.filter((s) => s.location);
  const total = open.reduce((n, s) => n + s.velos + s.trottinettes, 0);

  if (!lieu?.trim()) {
    const byCommune = COMMUNES.map((c) => {
      const mine = list.filter((s) => s.commune === c);
      return { commune: c, stations: mine.length, velos_disponibles: mine.filter((s) => s.location).reduce((n, s) => n + s.velos + s.trottinettes, 0) };
    });
    return text({
      resume: `Altervélo en ce moment : ${plural(total, "vélo disponible", "vélos disponibles")} dans ${plural(open.length, "station ouverte", "stations ouvertes")} (${byCommune.map((c) => `${c.commune} ${fr(c.velos_disponibles)}`).join(", ")}).`,
      communes: byCommune,
      stations: [...list].sort((a, b) => b.velos - a.velos).map((s) => stationRow(s)),
      ...common,
    });
  }

  const direct = named(list, lieu);
  if (direct.length) {
    const s = direct[0];
    return text({ resume: `Station Altervélo ${s.nom} (${s.commune}) : ${stock(s)}.`, stations: [stationRow(s)], ...common });
  }

  const res = resolvePlace(lieu);
  if (!res) return notFound(lieu);
  const p = res.lieu;
  const by = list.map((s) => ({ s, m: distanceKm(p.lon, p.lat, s.lon, s.lat) * 1000 })).sort((a, b) => a.m - b.m);
  const wholeCommune = p.type === "commune" && COMMUNES.includes(p.commune);
  const near = wholeCommune
    ? by.filter((x) => x.s.commune === p.commune).sort((a, b) => b.s.velos + b.s.trottinettes - (a.s.velos + a.s.trottinettes))
    : by.filter((x) => x.m <= NEAR_M).slice(0, 5);
  const shown = near.length ? near : by.filter((x) => x.m <= FAR_M).slice(0, 3);
  if (!shown.length) {
    const first = by[0];
    return text({
      lieu: placeBlock(lieu, res),
      resume: `Pas de vélo en libre-service Altervélo à ${p.commune || p.nom} : le service ne couvre que ${COMMUNES.join(", ")}. Station la plus proche : ${first.s.nom} (${first.s.commune}), à ${fr(Math.round(first.m / 1000))} km.`,
      ...COMMON,
      sources: credits([velos.SOURCE]),
    });
  }
  const best = shown.find((x) => x.s.location && x.s.velos + x.s.trottinettes > 0);
  const where = wholeCommune ? `à ${p.nom}` : `près de ${p.nom}`;
  const resume = wholeCommune
    ? `Altervélo ${where} : ${plural(shown.filter((x) => x.s.location).reduce((n, x) => n + x.s.velos + x.s.trottinettes, 0), "vélo disponible", "vélos disponibles")} dans ${plural(shown.length, "station", "stations")}` +
      (best ? `, dont ${best.s.nom} (${stock(best.s)}).` : ".")
    : `Station Altervélo la plus proche ${de(p.nom)} : ${shown[0].s.nom}, à ${fr(Math.round(shown[0].m / 10) * 10)} m : ${stock(shown[0].s)}.` +
      (best && best !== shown[0] ? ` Avec des vélos : ${best.s.nom}, à ${fr(Math.round(best.m / 10) * 10)} m (${stock(best.s)}).` : "");
  return text({
    lieu: placeBlock(lieu, res),
    resume,
    stations: shown.map((x) => stationRow(x.s, wholeCommune ? undefined : x.m)),
    ...(near.length ? {} : { note: `Aucune station à moins de ${fr(NEAR_M / 1000)} km : voici les plus proches.` }),
    ...common,
  });
}
