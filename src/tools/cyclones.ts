import type { Cache } from "../cache.js";
import { bearingDeg, compass, distanceKm, localTime } from "../geo.js";
import { resolvePlace } from "../places/resolve.js";
import * as gdacs from "../providers/cyclones.js";
import * as mf from "../providers/vigilance.js";
import { why } from "../types.js";
import { credits, notFound, placeBlock, text } from "./format.js";
import * as prefecture from "../providers/prefecture.js";
import { ecolesBlock } from "./ecoles.js";
import { cyclone as cycloneAlert } from "./vigilance.js";

const ISLAND = { nom: "La Réunion", lon: 55.536, lat: -21.115 };

const POINT_NAMES: Record<string, string> = {
  N: "nord", NNE: "nord-nord-est", NE: "nord-est", ENE: "est-nord-est", E: "est", ESE: "est-sud-est", SE: "sud-est", SSE: "sud-sud-est",
  S: "sud", SSO: "sud-sud-ouest", SO: "sud-ouest", OSO: "ouest-sud-ouest", O: "ouest", ONO: "ouest-nord-ouest", NO: "nord-ouest", NNO: "nord-nord-ouest",
};
/** « au sud-ouest », « à l'est-sud-est ». */
export function side(deg: number): string {
  const w = POINT_NAMES[compass(deg)];
  return w.startsWith("est") || w.startsWith("ouest") ? `à l'${w}` : `au ${w}`;
}
const toward = (deg: number) => `vers le ${POINT_NAMES[compass(deg)]}`;
/** « 03/02 à 10:00 », heure de La Réunion. */
const at = (iso: string) => localTime(new Date(iso)).replace(" ", " à ");
/** « 03/02/2026 ». */
const date = (iso: string) => {
  const l = localTime(new Date(iso)).split(" ")[0];
  return `${l}/${new Date(new Date(iso).getTime() + 4 * 3600_000).getUTCFullYear()}`;
};
const round10 = (km: number) => Math.round(km / 10) * 10;

export const OFFICIAL = {
  meteo_france: "https://meteofrance.re/fr/cyclone",
  vigilance: mf.SOURCE.url,
  prefecture: "https://www.reunion.gouv.fr",
};

const COMMON = {
  a_savoir:
    "Positions et prévisions du CMRS de La Réunion (Météo-France), le centre chargé des cyclones du sud-ouest de l'océan Indien, republiées par GDACS toutes les 6 heures : " +
    "elles peuvent avoir quelques heures de retard. Vents moyens sur 10 minutes, comme dans les bulletins de Météo-France ; les rafales sont plus fortes. " +
    "Pour savoir quoi faire, seules comptent l'alerte cyclonique de la préfecture et les bulletins de Météo-France.",
  phases_alerte:
    "À La Réunion, la préfecture déclenche : la vigilance cyclonique jaune (menace dans les jours à venir, s'informer), l'alerte orange (danger dans les 24 heures, se préparer), " +
    "l'alerte rouge (danger imminent, se confiner), l'alerte violette (confinement strict, même les secours ne circulent plus), puis la phase de sauvegarde (après le passage, rester prudent).",
  saison: "La saison cyclonique va de novembre à avril ; des systèmes se forment parfois hors saison.",
};

/** Movement between the last two observed positions. */
export function movement(points: gdacs.Point[]): { cap_deg: number; vitesse_kmh: number } | undefined {
  const [a, b] = points.slice(-2);
  if (!a || !b) return undefined;
  const hours = (new Date(b.heure).getTime() - new Date(a.heure).getTime()) / 3600_000;
  if (hours <= 0) return undefined;
  return { cap_deg: Math.round(bearingDeg(a.lon, a.lat, b.lon, b.lat)), vitesse_kmh: Math.round(distanceKm(a.lon, a.lat, b.lon, b.lat) / hours) };
}

export function activeRow(s: gdacs.Systeme, t: gdacs.Trajectoire | undefined, from: { nom: string; lon: number; lat: number }) {
  const last = t?.observee.at(-1);
  const pos = last ?? { heure: s.fin, lon: s.lon, lat: s.lat, stade: gdacs.stageOfWind(s.vent_max_kmh), vent_kmh: undefined, rafales_kmh: undefined, pression_hpa: undefined };
  const km = distanceKm(from.lon, from.lat, pos.lon, pos.lat);
  const move = t ? movement(t.observee) : undefined;
  const forecast = (t?.prevue ?? []).map((p) => ({ ...p, km: distanceKm(from.lon, from.lat, p.lon, p.lat) }));
  const closest = forecast.reduce<(typeof forecast)[number] | undefined>((m, p) => (!m || p.km < m.km ? p : m), undefined);
  return {
    nom: s.nom,
    stade: pos.stade,
    vent_moyen_kmh: pos.vent_kmh,
    rafales_kmh: pos.rafales_kmh,
    pression_hpa: pos.pression_hpa,
    position: { lat: pos.lat, lon: pos.lon, heure: `${at(pos.heure)} (heure de La Réunion)` },
    distance_km: round10(km),
    situation: `à ${round10(km)} km ${side(bearingDeg(from.lon, from.lat, pos.lon, pos.lat))} ${from.nom === ISLAND.nom ? "de La Réunion" : `de ${from.nom}`}`,
    deplacement: move ? `${toward(move.cap_deg)} à ${move.vitesse_kmh} km/h` : undefined,
    vent_max_atteint_kmh: s.vent_max_kmh || undefined,
    prevision_cmrs: forecast.length
      ? forecast.map((p) => ({ heure: at(p.heure), stade: p.stade, vent_moyen_kmh: p.vent_kmh, distance_km: round10(p.km), situation: side(bearingDeg(from.lon, from.lat, p.lon, p.lat)) }))
      : undefined,
    au_plus_pres_selon_la_prevision:
      closest && closest.km < km ? { distance_km: round10(closest.km), heure: at(closest.heure), stade: closest.stade } : undefined,
    s_eloigne: forecast.length > 0 && closest !== undefined && closest.km >= km,
    centre: s.centre,
    rapport: s.rapport,
    trajectoire: t ? { observee: t.observee.map((p) => [p.lon, p.lat]), prevue: t.prevue.map((p) => [p.lon, p.lat]) } : undefined,
  };
}

export function seasonRow(s: gdacs.Systeme) {
  return {
    nom: s.nom,
    du: date(s.debut),
    au: date(s.fin),
    stade_max: s.vent_max_kmh ? gdacs.stageOfWind(s.vent_max_kmh) : undefined,
    vent_max_kmh: s.vent_max_kmh || undefined,
    centre: s.centre,
    rapport: s.rapport,
    derniere_position: { lat: s.lat, lon: s.lon },
  };
}

// reunion.gouv.fr can hang for seconds (24/10/2026): the answer does not wait for it longer than this.
const PREFECTURE_WAIT_MS = 3000;

/** The cyclone alert of the prefecture through Météo-France's vigilance, and what it means for the schools; undefined when it cannot be read. */
async function alert(cache: Cache, now: Date) {
  if (!mf.enabled()) return undefined;
  try {
    // The prefecture's last decision beside the bulletin: never more than the bulletin's wait, and none when it fails.
    const decision = prefecture.cyclone(cache).then((x) => x.value).catch(() => null);
    const [v, c] = await Promise.all([mf.vigilance(cache).then((x) => x.value), Promise.race([decision, new Promise<null>((r) => setTimeout(() => r(null), PREFECTURE_WAIT_MS))])]);
    return { texte: cycloneAlert(v, now), ecoles: ecolesBlock(v, now, c) };
  } catch (err) {
    console.error(`source ${mf.SOURCE.id} indisponible:`, why(err));
    return undefined;
  }
}

export async function cyclones(cache: Cache, lieu: string | undefined, now = new Date()) {
  let from = ISLAND;
  let place;
  if (lieu?.trim()) {
    const res = resolvePlace(lieu);
    if (!res) return notFound(lieu);
    from = { nom: res.lieu.nom, lon: res.lieu.lon, lat: res.lieu.lat };
    place = placeBlock(lieu, res);
  }

  let list: gdacs.Systeme[];
  try {
    list = (await gdacs.systemes(cache, now)).value.filter((s) => s.debut <= now.toISOString());
  } catch (err) {
    console.error(`source ${gdacs.SOURCE.id} indisponible:`, why(err));
    const a = await alert(cache, now);
    return {
      ...text({ erreur: "Le suivi des systèmes tropicaux (GDACS) ne répond pas pour le moment.", alerte_cyclonique: a?.texte, ecoles: a?.ecoles, consulter: OFFICIAL, sources: credits([gdacs.SOURCE]) }),
      isError: true,
    };
  }

  const [active, a] = await Promise.all([gdacs.actifs(cache, list, now), alert(cache, now)]);
  const alerte = a?.texte;
  const rows = active.map((a) => activeRow(a.systeme, a.trajectoire, from)).sort((x, y) => x.distance_km - y.distance_km);
  const season = gdacs.seasonOf(now);
  const previous = `${Number(season.nom.slice(0, 4)) - 1}-${season.nom.slice(0, 4)}`;
  const thisSeason = list.filter((s) => s.debut >= season.debut);
  const lastSeason = list.filter((s) => s.debut < season.debut);
  const lastOne = list[0];

  const parts: string[] = [];
  if (alerte) parts.push(alerte);
  if (rows.length) {
    parts.push(`${rows.length} système${rows.length > 1 ? "s" : ""} tropical${rows.length > 1 ? "aux" : ""} actif${rows.length > 1 ? "s" : ""} dans le sud-ouest de l'océan Indien.`);
    for (const r of rows) {
      parts.push(
        `${r.nom.charAt(0).toUpperCase() + r.nom.slice(1)} : ${r.stade}${r.vent_moyen_kmh ? ` (vent moyen ${r.vent_moyen_kmh} km/h)` : ""}, ${r.situation} le ${r.position.heure.replace(" (heure de La Réunion)", "")}` +
          `${r.deplacement ? `, se déplace ${r.deplacement}` : ""}.` +
          (r.au_plus_pres_selon_la_prevision
            ? ` Au plus près selon la prévision du CMRS : ${r.au_plus_pres_selon_la_prevision.distance_km} km le ${r.au_plus_pres_selon_la_prevision.heure} (${r.au_plus_pres_selon_la_prevision.stade}).`
            : r.s_eloigne ? ` La prévision du CMRS l'éloigne ${from.nom === ISLAND.nom ? "de La Réunion" : `de ${from.nom}`}.` : ""),
      );
    }
  } else {
    parts.push("Aucun système tropical actif dans le sud-ouest de l'océan Indien.");
    parts.push(
      thisSeason.length
        ? `Saison ${season.nom} : ${thisSeason.length} système${thisSeason.length > 1 ? "s" : ""} jusqu'ici.`
        : `Saison ${season.nom} : aucun système pour le moment.`,
    );
    if (lastOne) {
      parts.push(`Dernier système : ${lastOne.nom}, du ${date(lastOne.debut)} au ${date(lastOne.fin)}${lastOne.vent_max_kmh ? ` (au plus fort : ${gdacs.stageOfWind(lastOne.vent_max_kmh)}, vent moyen ${lastOne.vent_max_kmh} km/h)` : ""}.`);
    }
  }

  return text({
    lieu: place,
    resume: parts.join(" "),
    alerte_cyclonique: alerte,
    ecoles: a?.ecoles,
    systemes_actifs: rows.length ? rows.map(({ trajectoire: _, ...r }) => r) : undefined,
    saison_en_cours: { nom: season.nom, systemes: thisSeason.map(seasonRow) },
    saison_precedente: rows.length ? undefined : { nom: previous, systemes: lastSeason.map(seasonRow) },
    ...COMMON,
    consulter: OFFICIAL,
    sources: credits([gdacs.SOURCE, ...(alerte ? [mf.SOURCE] : [])]),
  });
}
