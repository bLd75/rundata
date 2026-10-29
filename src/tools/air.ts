import type { Cache } from "../cache.js";
import { distanceKm, localTime } from "../geo.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import * as airMesures from "../providers/air-mesures.js";
import * as atmo from "../providers/atmo.js";
import * as capteurs from "../providers/capteurs.js";
import { why } from "../types.js";
import { credits, notFound, placeBlock, text } from "./format.js";

const today = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);

/** The pollutants that set the index (the highest sub-indices), in words. */
export function drivers(x: atmo.Index): string[] {
  const top = Math.max(...Object.values(x.sous_indices));
  return Object.entries(x.sous_indices).filter(([, v]) => v === top && v >= 2).map(([k]) => atmo.POLLUTANTS[k]);
}

function sentence(x: atmo.Index, when: string): string {
  const d = drivers(x);
  return `${when} : ${atmo.level(x.niveau)} (${x.niveau}/6)${d.length ? `, surtout ${d.join(" et ")}` : ""}`;
}

/** Each pollutant's sub-index, by its name in words. */
export const subIndices = (x: atmo.Index) => Object.fromEntries(Object.entries(x.sous_indices).map(([k, v]) => [atmo.POLLUTANTS[k], v]));

/**
 * When Atmo Réunion diffused the day's forecast: « le 28/10 à 10:45 », said « la veille » when it was diffused the day
 * before, the forecast for the next day.
 */
export function diffusion(list: atmo.Index[], day: string): string | undefined {
  const at = list.filter((x) => x.jour === day && x.diffuse_le).map((x) => x.diffuse_le!).sort().pop();
  if (!at) return undefined;
  const [date, time] = localTime(new Date(at)).split(" ");
  const before = Date.parse(at) < Date.parse(`${day}T00:00:00+04:00`);
  return `Prévision diffusée par Atmo Réunion ${before ? "la veille, " : ""}le ${date} à ${time}`;
}

// A measure is said late once its hour ended this long ago.
const LATE_MS = 3 * 3600_000;

// The kit's way: « 7 h » for a round hour, « 7 h 30 » else; an hour ending at midnight ends at « 24 h ».
const hour = (iso: string, end = false) => {
  const [h, min] = [Number(iso.slice(11, 13)), iso.slice(14, 16)];
  const at = end && h === 0 && min === "00" ? 24 : h;
  return min === "00" ? `${at} h` : `${at} h ${min}`;
};

/** The hour measured: « de 7 h à 8 h », with its day when it is not today's, « le 28/10, de 23 h à 24 h ». */
export function hourMeasured(m: airMesures.Mesure, now: Date): string {
  const hours = `de ${hour(m.debut)} à ${hour(m.fin, true)}`;
  return m.debut.slice(0, 10) === today(now) ? hours : `le ${m.debut.slice(8, 10)}/${m.debut.slice(5, 7)}, ${hours}`;
}

/**
 * A measure as said, apart from the forecast: its value and unit, the hour measured, its station, the station's type
 * and commune, that it is raw and not validated, and how late it is once its hour ended more than 3 h ago.
 */
export function measured(m: airMesures.Mesure, now: Date) {
  const st = airMesures.STATIONS[m.station];
  const late = now.getTime() - Date.parse(m.fin);
  return {
    polluant: airMesures.POLLUTANTS[m.polluant],
    valeur: m.valeur,
    unite: airMesures.unit(m.unite),
    heure: hourMeasured(m, now),
    station: st?.nom ?? m.nom_fichier,
    type: m.type,
    ...(st && { commune: st.commune }),
    statut: "mesure brute, non validée",
    ...(late > LATE_MS && { retard: `mesurée il y a ${Math.floor(late / 3600_000)} h` }),
  };
}

export type Measured = ReturnType<typeof measured>;

/**
 * The measures at the stations: for a place, those of its commune's stations, else of the nearest station with its
 * distance; for the island, all. Undefined where the measures are not stored (a local server, the tests) or not read.
 */
async function stations(cache: Cache, now: Date, place?: { commune: string; lon: number; lat: number }) {
  let copy;
  try {
    copy = await airMesures.mesures(cache);
  } catch (err) {
    console.error(`source ${airMesures.SOURCE.id} indisponible:`, why(err));
    return undefined;
  }
  if (!copy) return undefined;
  let list = copy.value.mesures;
  let distance: number | undefined;
  if (place) {
    const here = list.filter((m) => airMesures.STATIONS[m.station] && normalize(airMesures.STATIONS[m.station].commune) === normalize(place.commune));
    if (here.length) list = here;
    else {
      const near = Object.entries(airMesures.STATIONS)
        .filter(([code]) => list.some((m) => m.station === code))
        .map(([code, s]) => ({ code, km: distanceKm(place.lon, place.lat, s.lon, s.lat) }))
        .sort((a, b) => a.km - b.km)[0];
      if (!near) return undefined;
      list = list.filter((m) => m.station === near.code);
      distance = Math.round(near.km);
    }
  }
  return {
    nature: "MESURES brutes, non validées, aux stations d'Atmo Réunion, publiées par le LCSQA : ce n'est pas l'indice ATMO, qui est une prévision.",
    ...(distance != null && { station_la_plus_proche_km: distance }),
    valeurs: list.map((m) => measured(m, now)),
    lu_par_rundata: localTime(copy.fetchedAt),
    source: airMesures.SOURCE.url,
  };
}

/** The index's source, then those of the measures at the stations and of the sensors, when they are said. */
const sourcesOf = (mesures: unknown, amateur: unknown) =>
  credits([atmo.SOURCE, ...(mesures ? [airMesures.SOURCE] : []), ...(amateur ? [capteurs.SOURCE] : [])]);

// Worded by marketing (29/10/2026).
export const CAPTEURS_AVERTISSEMENT = "Capteur amateur, non étalonné : à prendre avec précaution.";
export const CAPTEURS_EXPLICATION =
  "Mesures de capteurs installés par des particuliers et partagés sur Sensor.Community, ni étalonnés ni contrôlés par Atmo Réunion : " +
  "leur valeur peut s'écarter de la réalité, et leur position est arrondie à la commune. La qualité de l'air officielle est l'indice d'Atmo Réunion, juste au-dessus.";
export const CAPTEURS_AUCUN = "Aucun capteur partagé sur Sensor.Community n'a émis à La Réunion dans les 2 dernières heures.";
/** Sensor.Community not read since `since` and nothing read before it: said, never as no sensor. */
export const capteursEchec = (since: string, now: Date) => `Lecture des capteurs amateurs impossible depuis ${measuredAt(since, now).replace(/^à /, "")}.`;
/** The copy not written lately: when it was, with the values it kept, or that there is no recent reading; never none. */
export const capteursAncienne = (lu: string, now: Date, values: boolean) =>
  values ? `Dernière lecture des capteurs ${measuredAt(lu, now)}.` : `Pas de lecture récente des capteurs (dernière lecture ${measuredAt(lu, now)}).`;

/** When a sensor measured: « à 10:34 », « hier à 23:10 » (its window is 2 hours). */
export function measuredAt(iso: string, now: Date): string {
  const [date, time] = localTime(new Date(iso)).split(" ");
  const day = today(new Date(iso));
  return day === today(now) ? `à ${time}` : day === today(new Date(now.getTime() - 86_400_000)) ? `hier à ${time}` : `le ${date} à ${time}`;
}

/**
 * The sensors of private people (Sensor.Community), apart from the index and under it: by commune, their raw particles
 * and when they measured, never an identifier nor a place. Undefined where they are not stored (a local server, the
 * tests) or not read.
 */
async function amateurs(cache: Cache, now: Date) {
  let copy;
  try {
    copy = await capteurs.capteurs(now);
  } catch (err) {
    console.error(`source ${capteurs.SOURCE.id} indisponible:`, why(err));
    return undefined;
  }
  if (!copy) return undefined;
  const v = copy.value;
  if ("echec" in v) {
    return {
      avertissement: CAPTEURS_AVERTISSEMENT,
      explication: CAPTEURS_EXPLICATION,
      echec: capteursEchec(v.echec, now),
      position: "arrondie à la commune",
      carte: capteurs.CARTE,
      brancher_un_capteur: capteurs.GUIDE,
      licence: capteurs.SOURCE.licence,
    };
  }
  const list = v.capteurs;
  return {
    avertissement: CAPTEURS_AVERTISSEMENT,
    explication: CAPTEURS_EXPLICATION,
    ...(copy.stale && { lecture_ancienne: capteursAncienne(v.lu, now, list.length > 0) }),
    ...(list.length
      ? { valeurs: list.map((c) => ({ commune: c.commune, ...(c.pm2_5 !== undefined && { pm2_5: c.pm2_5 }), ...(c.pm10 !== undefined && { pm10: c.pm10 }), unite: "µg/m³", mesurees: measuredAt(c.mesure_a, now) })) }
      : copy.stale ? {} : { aucun: CAPTEURS_AUCUN }),
    position: "arrondie à la commune",
    lu_par_rundata: localTime(copy.fetchedAt),
    carte: capteurs.CARTE,
    brancher_un_capteur: capteurs.GUIDE,
    licence: capteurs.SOURCE.licence,
  };
}

export type Amateurs = NonNullable<Awaited<ReturnType<typeof amateurs>>>;

export async function qualiteAir(cache: Cache, lieu: string | undefined, now = new Date()) {
  let list: atmo.Index[];
  let readAt: Date;
  try {
    ({ value: list, fetchedAt: readAt } = await atmo.indices(cache));
  } catch (err) {
    console.error(`source ${atmo.SOURCE.id} indisponible:`, why(err));
    return { ...text({ erreur: "L'indice de qualité de l'air ne répond pas pour le moment.", consulter: atmo.SOURCE.url }), isError: true };
  }
  const day = today(now);
  const diffusee = diffusion(list, day);
  const common = {
    nature: "PRÉVISION du jour par commune, calculée par Atmo Réunion : pas une mesure.",
    ...(diffusee && { diffusion: `${diffusee}.` }),
    lu_par_rundata: localTime(readAt),
    echelle: "1 bon, 2 moyen, 3 dégradé, 4 mauvais, 5 très mauvais, 6 extrêmement mauvais\u00a0; pour un sous-indice, 0 indisponible, 7 événement",
    comment_c_est_fait: { etapes: atmo.METHODE, d_apres: "Guide de calcul de l'indice ATMO d'Atmo France (version du 14/12/2020)", lien: atmo.GUIDE },
    provenance: atmo.PROVENANCE,
    avertissements: [
      "Indice calculé à l'échelle de la commune : près d'une route chargée, d'une usine ou d'un feu, l'air peut être plus mauvais.",
      "Pendant une éruption du Piton de la Fournaise, le panache (dioxyde de soufre, « vog ») peut dégrader l'air dans le sud et l'ouest selon le vent.",
    ],
    consulter: atmo.SOURCE.url,
    sources: credits([atmo.SOURCE]),
  };

  if (!lieu?.trim()) {
    const mesures = await stations(cache, now);
    const amateur = await amateurs(cache, now);
    const todays = list.filter((x) => x.jour === day);
    const worst = Math.max(0, ...todays.map((x) => x.niveau));
    const atWorst = todays.filter((x) => x.niveau === worst).map((x) => x.commune);
    return text({
      resume: todays.length
        ? `Qualité de l'air prévue aujourd'hui à La Réunion : au pire ${atmo.level(worst)} (${worst}/6)` +
          (atWorst.length < todays.length ? `, à ${atWorst.join(", ")}` : " dans toutes les communes") + "."
        : "L'indice du jour n'est pas dans la dernière lecture de la couche d'Atmo France.",
      communes: todays.map((x) => ({ commune: x.commune, niveau: x.niveau, qualite: atmo.level(x.niveau), polluants: drivers(x), sous_indices: subIndices(x) })),
      ...common,
      ...(mesures && { mesures_aux_stations: mesures }),
      ...(amateur && { capteurs_amateurs: amateur }),
      sources: sourcesOf(mesures, amateur),
    });
  }

  const res = resolvePlace(lieu);
  if (!res) return notFound(lieu);
  const mine = list.filter((x) => x.jour >= day && normalize(x.commune) === normalize(res.lieu.commune)).sort((a, b) => a.jour.localeCompare(b.jour));
  const now_ = mine.find((x) => x.jour === day);
  const next = mine.find((x) => x.jour > day);
  const mesures = await stations(cache, now, res.lieu);
  const amateur = await amateurs(cache, now);
  const parts = [now_ && sentence(now_, `Qualité de l'air prévue aujourd'hui à ${res.lieu.commune}`), next && sentence(next, "demain")].filter(Boolean);
  return text({
    lieu: placeBlock(lieu, res),
    resume: parts.length ? `${parts.join("\u00a0; ")}.` : `Pas d'indice publié pour ${res.lieu.commune} aujourd'hui.`,
    indices: mine.map((x) => ({
      jour: x.jour,
      niveau: x.niveau,
      qualite: atmo.level(x.niveau),
      sous_indices: subIndices(x),
    })),
    ...common,
    ...(mesures && { mesures_aux_stations: mesures }),
    ...(amateur && { capteurs_amateurs: amateur }),
    sources: sourcesOf(mesures, amateur),
  });
}
