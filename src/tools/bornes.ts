import type { Cache } from "../cache.js";
import { ageMinutes, ageText, distanceKm, localTime } from "../geo.js";
import { resolvePlace } from "../places/resolve.js";
import * as irve from "../providers/irve.js";
import { why } from "../types.js";
import { a, credits, de, fr, notFound, placeBlock, text } from "./format.js";

// Stations this close are worth the drive across town; past this, the nearest few are given anyway.
const NEAR_KM = 3;
const FAR_KM = 15;
/** Fast charging: a point of 50 kW or more (direct current, Combo CCS or CHAdeMO). */
export const FAST_KW = 50;
// Past this, the live file the answer rests on is said to be old.
const OLD_LIVE_MIN = 60;

const plural = (n: number, one: string, many: string) => `${fr(n)} ${n > 1 ? many : one}`;

export type PointState = "libre" | "occupé" | "réservé" | "hors service" | "en service" | "état inconnu";

export function pointState(live: irve.Live | undefined, id: string): { etat: PointState; depuis?: string } {
  const x = live?.points[id];
  if (!x) return { etat: "état inconnu" };
  const [etat, occupation, at] = x;
  const s: PointState =
    etat === "hors_service" ? "hors service"
    : etat === "inconnu" ? "état inconnu"
    : occupation === "libre" ? "libre"
    : occupation === "occupe" ? "occupé"
    : occupation === "reserve" ? "réservé"
    : "en service";
  return { etat: s, ...(at ? { depuis: at } : {}) };
}

export interface Count {
  libres: number;
  occupes: number;
  hors_service: number;
  /** In service with no occupancy given, or with no state at all. */
  autres: number;
  total: number;
}

export function count(stations: irve.Station[], live: irve.Live | undefined): Count {
  const c: Count = { libres: 0, occupes: 0, hors_service: 0, autres: 0, total: 0 };
  for (const s of stations) {
    for (const p of s.points) {
      const e = pointState(live, p.id).etat;
      c.total++;
      if (e === "libre") c.libres++;
      else if (e === "occupé" || e === "réservé") c.occupes++;
      else if (e === "hors service") c.hors_service++;
      else c.autres++;
    }
  }
  return c;
}

/** « 2 libres sur 4 (1 occupé, 1 hors service) ». */
export function countText(c: Count): string {
  const rest = [
    c.occupes ? plural(c.occupes, "occupé", "occupés") : "",
    c.hors_service ? `${fr(c.hors_service)} hors service` : "",
    c.autres ? `${fr(c.autres)} sans information` : "",
  ].filter(Boolean);
  return `${plural(c.libres, "libre", "libres")} sur ${fr(c.total)}${rest.length ? ` (${rest.join(", ")})` : ""}`;
}

export const kwMax = (s: irve.Station) => Math.max(...s.points.map((p) => p.kw));
export const plugs = (s: irve.Station) => [...new Set(s.points.flatMap((p) => p.prises))];
/** The station as a driver would look for it: the place when known, else the network and the address. */
export const label = (s: irve.Station) => (s.nom ? `${s.nom}, ${s.adresse}` : `${s.reseau}, ${s.adresse}`);

/** « 04:12 » today, « 23/10 18:40 » this year, « 2024 » before. */
function since(iso: string, now: Date): string {
  const d = new Date(iso);
  if (d.getUTCFullYear() !== now.getUTCFullYear()) return String(d.getUTCFullYear());
  const [day, time] = localTime(d).split(" ");
  return day === localTime(now).split(" ")[0] ? time : `${day} ${time}`;
}

export function stationRow(s: irve.Station, live: irve.Live | undefined, now: Date, km?: number, detail = true) {
  return {
    station: label(s),
    commune: s.commune,
    ...(km != null ? { distance_km: Math.round(km * 10) / 10 } : {}),
    reseau: s.reseau,
    ...(live ? { etat: countText(count([s], live)) } : {}),
    puissance_max_kw: kwMax(s),
    prises: plugs(s),
    horaires: s.horaires,
    ...(s.acces_reserve ? { acces: "réservé" } : {}),
    ...(s.gratuit ? { tarif: "gratuit" } : s.tarif ? { tarif: s.tarif } : {}),
    ...(detail
      ? {
          points: s.points.map((p) => {
            const st = pointState(live, p.id);
            return { puissance_kw: p.kw, prises: p.prises, ...(live ? { etat: st.etat, ...(st.depuis ? { depuis: since(st.depuis, now) } : {}) } : {}) };
          }),
        }
      : {}),
    carte: `https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=17/${s.lat}/${s.lon}`,
  };
}

/** Free points first, then the most powerful. */
const better = (live: irve.Live | undefined) => (a: irve.Station, b: irve.Station) =>
  count([b], live).libres - count([a], live).libres || kwMax(b) - kwMax(a);

const COMMON = {
  recharge:
    "Pour charger : l'application ou le badge du réseau indiqué (Freshmile, EZDrive…), ou le badge d'un autre opérateur accepté en itinérance. Recharge rapide = 50 kW ou plus (prise Combo CCS ou CHAdeMO)\u00a0; Type 2 = recharge normale, de 7 à 22 kW.",
};

export async function bornesRecharge(cache: Cache, lieu: string | undefined, rapide = false, now = new Date()) {
  let live: irve.Live | undefined;
  let lu: Date | undefined;
  try {
    const r = await irve.live(cache);
    live = r.value;
    lu = new Date(r.value.lu);
  } catch (err) {
    console.error(`source ${irve.SOURCE.id} indisponible:`, why(err));
  }
  const old = lu && ageMinutes(lu, now) > OLD_LIVE_MIN;
  const common = {
    ...COMMON,
    donnees: live
      ? `État de chaque point d'après son opérateur, relevé à ${localTime(lu!).split(" ")[1]} (heure de La Réunion)\u00a0; « depuis » est l'heure de son dernier changement d'état. Un point peut être pris entre-temps.`
      : "L'état en direct des bornes est indisponible pour le moment : seule la liste des stations est donnée.",
    ...(old ? { avertissement: `État relevé ${ageText(ageMinutes(lu!, now))} : il a pu changer depuis.` } : {}),
    sources: credits([irve.SOURCE]),
  };
  const pool = rapide ? irve.STATIONS.filter((s) => kwMax(s) >= FAST_KW) : irve.STATIONS;
  const kind = rapide ? "borne de recharge rapide" : "borne de recharge";

  if (!lieu?.trim()) {
    const c = count(pool, live);
    const communes = [...new Set(pool.map((s) => s.commune))]
      .map((commune) => {
        const mine = pool.filter((s) => s.commune === commune);
        const k = count(mine, live);
        return { commune, stations: mine.length, points: k.total, ...(live ? { libres: k.libres } : {}) };
      })
      .sort((a, b) => b.points - a.points);
    const fast = irve.STATIONS.filter((s) => kwMax(s) >= FAST_KW).sort(better(live));
    return text({
      resume:
        `${rapide ? "Recharge rapide" : "Bornes de recharge publiques"} à La Réunion : ${plural(pool.length, "station", "stations")}, ${plural(c.total, "point de charge", "points de charge")}` +
        (live ? `\u00a0; en ce moment ${countText(c)}.` : "."),
      communes,
      recharge_rapide: fast.map((s) => stationRow(s, live, now, undefined, false)),
      ...common,
    });
  }

  const res = resolvePlace(lieu);
  if (!res) return notFound(lieu);
  const p = res.lieu;
  const by = pool.map((s) => ({ s, km: distanceKm(p.lon, p.lat, s.lon, s.lat) })).sort((a, b) => a.km - b.km);
  if (!by.length) return text({ lieu: placeBlock(lieu, res), resume: `Aucune ${kind} publique connue à La Réunion.`, ...common });
  const wholeCommune = p.type === "commune";
  const inCommune = wholeCommune ? by.filter((x) => x.s.commune === p.commune) : [];
  const near = wholeCommune && inCommune.length
    ? inCommune.sort((a, b) => better(live)(a.s, b.s)).slice(0, 10)
    : by.filter((x) => x.km <= NEAR_KM).slice(0, 5);
  const shown = near.length ? near : by.filter((x) => x.km <= FAR_KM).slice(0, 3);
  const list = shown.length ? shown : by.slice(0, 1);
  const free = list.find((x) => count([x.s], live).libres > 0);
  const first = list[0];
  const where = wholeCommune && inCommune.length ? a(p.nom) : `près ${de(p.nom)}`;
  let resume: string;
  if (wholeCommune && inCommune.length) {
    const k = count(inCommune.map((x) => x.s), live);
    resume = `${plural(inCommune.length, rapide ? "station de recharge rapide" : "station de recharge", rapide ? "stations de recharge rapide" : "stations de recharge")} ${where}` +
      (live ? ` : ${countText(k)}.` : ".") +
      (free ? ` Par exemple : ${label(free.s)}, ${countText(count([free.s], live))}.` : "");
  } else {
    resume = `${kind[0].toUpperCase()}${kind.slice(1)} la plus proche ${de(p.nom)} : ${label(first.s)}${first.s.adresse.endsWith(first.s.commune) ? "" : ` (${first.s.commune})`}, à ${fr(Math.round(first.km * 10) / 10)} km` +
      (live ? `, ${countText(count([first.s], live))}.` : ".") +
      (free && free !== first ? ` Avec un point libre : ${label(free.s)}, à ${fr(Math.round(free.km * 10) / 10)} km.` : "");
  }
  return text({
    lieu: placeBlock(lieu, res),
    resume,
    stations: list.map((x) => stationRow(x.s, live, now, wholeCommune && inCommune.length ? undefined : x.km)),
    ...(near.length ? {} : { note: `Aucune ${kind} à moins de ${fr(NEAR_KM)} km ${de(p.nom)} : voici les plus proches.` }),
    ...common,
  });
}
