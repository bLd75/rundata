import type { Cache, Cached } from "../cache.js";
import { distanceKm, versant } from "../geo.js";
import { resolvePlace, type Resolution } from "../places/resolve.js";
import * as meteofrance from "../providers/meteofrance.js";
import { STATIONS_EN_SERVICE } from "../providers/meteofrance-stations.js";
import * as metar from "../providers/metar.js";
import * as pioupiou from "../providers/pioupiou.js";
import * as radar from "../providers/radar.js";
import { radarAt } from "./radar.js";
import { type Observation, type SourceInfo, why } from "../types.js";
import { fit } from "./representativeness.js";
import { credits, fr, notFound, placeBlock, show, text, when } from "./format.js";

interface Provider {
  source: SourceInfo;
  observations: (c: Cache, now: Date) => Promise<Cached<Observation[]>>;
  /** False when the source needs a key this server was not given: it is then left out, not reported down. */
  enabled?: () => boolean;
}

const ALL_PROVIDERS: Provider[] = [
  { source: meteofrance.SOURCE, observations: meteofrance.observations, enabled: meteofrance.enabled },
  { source: metar.SOURCE, observations: (c) => metar.observations(c) },
  { source: pioupiou.SOURCE, observations: pioupiou.observations },
];

export function providers(): Provider[] {
  return ALL_PROVIDERS.filter((p) => p.enabled?.() ?? true);
}

export function coverage(): string {
  return meteofrance.enabled()
    ? `Les quelque ${STATIONS_EN_SERVICE} stations Météo-France de l'île, de la côte aux sommets et dans les cirques (mesures toutes les ` +
        "6 min, publiées 5 à 10 min après : température, pluie, et pour une partie d'entre elles humidité et vent), " +
        "les observations des 2 aéroports (METAR, état du ciel) et 1 balise de vent (Cambaie, Saint-Paul)."
    : "Version 0.1 : seules les sources ouvertes sans clé sont branchées, soit les 2 stations des aéroports " +
        "(Saint-Denis Gillot et Saint-Pierre Pierrefonds, toutes les 30 min) et 1 balise de vent (Cambaie, Saint-Paul). " +
        "Pas encore de pluviomètre en temps réel, ni de station dans les Hauts ou les cirques.";
}

// Without a place, the tour of the island: coast on every side, the Hauts and a cirque, not all of them.
const TOUR_METEOFRANCE = [
  "97418110", // Saint-Denis Gillot
  "97407520", // Le Port
  "97415590", // Pointe des Trois-Bassins
  "97416463", // Saint-Pierre Pierrefonds
  "97417360", // Le Baril
  "97410238", // Saint-Benoît
  "97419350", // Gros Piton Sainte-Rose (côte est, au vent)
  "97422440", // Plaine des Cafres
  "97424410", // Cilaos
  "97415566", // Piton Maïdo
];

const OLD_MINUTES = 90;

async function collect(cache: Cache, now: Date, list: Provider[]) {
  const results = await Promise.allSettled(list.map((p) => p.observations(cache, now)));
  const obs: { o: Observation; stale: boolean }[] = [];
  const down: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") r.value.value.forEach((o) => obs.push({ o, stale: r.value.stale }));
    else {
      down.push(list[i].source.nom);
      console.error(`source ${list[i].source.id} indisponible:`, why(r.reason)); // shows in the Worker logs
    }
  });
  return { obs, down };
}

function stationBlock(o: Observation, stale: boolean, now: Date) {
  const mesures: Record<string, string> = {};
  for (const r of o.readings) mesures[r.variable] = show(r);
  const t = when(o.time, now);
  const avertissements: string[] = [];
  if (t.age_min > OLD_MINUTES) avertissements.push(`Mesure ancienne (${t.age_texte}).`);
  if (stale) avertissements.push("Source momentanément injoignable : dernière valeur connue.");
  return {
    station: o.station.nom,
    source: o.station.source,
    altitude_m: o.station.altitude_m,
    ...t,
    mesures,
    avertissements,
    brut: o.brut,
  };
}

function rainText(o: Observation): string | undefined {
  const mm = (variable: string) => o.readings.find((r) => r.variable === variable)?.valeur as number | undefined;
  const now6 = mm("pluie_6min");
  const hour = mm("pluie_1h");
  if (now6 != null && now6 > 0) return `il pleut (${fr(now6)} mm en 6 min${hour != null ? `, ${fr(hour)} mm en 1 h` : ""})`;
  if (hour != null && hour > 0) return `${fr(hour)} mm de pluie dans l'heure, plus rien ces 6 dernières minutes`;
  if (hour === 0) return "pas de pluie depuis 1 h";
  if (now6 === 0) return "pas de pluie ces 6 dernières minutes";
  return undefined;
}

// What people ask about the weather; a station bringing only the sky or the pressure is no reason to look further.
const ASKED = new Set(["temperature", "humidite", "vent_moyen", "rafales", "pluie_6min", "pluie_1h"]);

/** True for a second station at the same spot (an airport is both a Météo-France station and a METAR). */
function sameSpot(a: Observation, b: Observation): boolean {
  return a !== b && distanceKm(a.station.lon, a.station.lat, b.station.lon, b.station.lat) < 1;
}

function sentence(name: string, o: Observation, now: Date): string {
  const v = Object.fromEntries(o.readings.map((r) => [r.variable, show(r)]));
  const parts: string[] = [];
  if (v.temperature) parts.push(v.temperature);
  if (v.humidite) parts.push(`humidité ${v.humidite.replace(" (calculée)", "")}`);
  if (v.vent_moyen) {
    const dir = v.vent_direction ? `${v.vent_direction.split(" ")[0]} ` : "";
    parts.push(`vent ${dir}${v.vent_moyen}${v.rafales ? `, rafales ${v.rafales}` : ""}`);
  }
  const rain = rainText(o);
  if (rain) parts.push(rain);
  if (v.temps_present) parts.push(v.temps_present);
  else if (v.ciel) parts.push(v.ciel);
  const t = when(o.time, now);
  return `${name} : ${parts.join(", ")} (mesuré à ${t.heure_mesure.split(" ")[1]} heure de La Réunion, ${t.age_texte})`;
}

/** The tour of the island, without a place: the stations of TOUR_METEOFRANCE, then the other sources' own. */
export async function islandTour(cache: Cache, now = new Date()) {
  const list = providers();
  const { obs, down } = await collect(cache, now, list);
  const mf = obs.filter(({ o }) => o.station.source === "meteofrance");
  const rank = (o: Observation) => (o.station.source === "meteofrance" ? TOUR_METEOFRANCE.indexOf(o.station.id) : 99);
  const tour = obs
    .filter(({ o }) =>
      o.station.source === "meteofrance"
        ? rank(o) >= 0
        : !(o.station.source === "metar" && mf.some((m) => sameSpot(o, m.o))),
    )
    .sort((a, b) => rank(a.o) - rank(b.o));
  return { tour, down, sources: list.map((p) => p.source) };
}

export async function meteoActuelle(cache: Cache, lieu: string | undefined, now = new Date()) {
  if (!lieu?.trim()) {
    const { tour, down, sources } = await islandTour(cache, now);
    return text({
      resume: tour.map(({ o }) => sentence(o.station.nom, o, now)).join(" ; ") || "Aucune mesure disponible.",
      stations: tour.map(({ o, stale }) => ({ ...stationBlock(o, stale, now), versant: versant(o.station.lon, o.station.lat) })),
      sources_indisponibles: down.length ? down : undefined,
      couverture: coverage(),
      sources: credits(sources),
    });
  }

  const r: Resolution | null = resolvePlace(lieu);
  if (!r) return notFound(lieu);

  const list = providers();
  const [{ obs, down }, rain] = await Promise.all([collect(cache, now, list), radarAt(cache, r.lieu, now)]);
  const sources = credits([...list.map((p) => p.source), ...(rain ? [radar.SOURCE] : [])]);
  const indisponibles = down.length ? down : undefined;

  const ranked = obs
    .map(({ o, stale }) => ({ o, stale, f: fit(r.lieu, o.station) }))
    .sort((a, b) => a.f.score - b.f.score);

  // Best station first. Second, the best one that brings what people ask about and the first lacks (a temperature
  // next to a wind-only beacon), else simply the next best: on a summit, another summit station, not an airport
  // that only adds the sky. Last, one more for any variable still missing, however far: its warnings say how much
  // to trust it, and it is listed but not summed up.
  const chosen: typeof ranked = [];
  const covered = new Set<string>();
  const take = (x: (typeof ranked)[number] | undefined) => {
    if (!x) return;
    chosen.push(x);
    x.o.readings.forEach((rd) => covered.add(rd.variable));
  };
  const elsewhere = (x: (typeof ranked)[number]) => !chosen.includes(x) && !chosen.some((y) => sameSpot(x.o, y.o));
  take(ranked[0]);
  take(ranked.find((x) => elsewhere(x) && x.o.readings.some((rd) => ASKED.has(rd.variable) && !covered.has(rd.variable))) ?? ranked.find(elsewhere));
  take(ranked.find((x) => !chosen.includes(x) && x.o.readings.some((rd) => !covered.has(rd.variable))));

  const shown = chosen.slice(0, 2);
  // Named, since the warning often concerns the second station only.
  const warnings = [...new Set(shown.filter((x) => x.f.pertinence !== "bonne" && x.f.avertissements[0])
    .map((x) => `${x.o.station.nom} : ${x.f.avertissements[0].replace(/^La station est/, "station")}`))];
  const resume = shown.length
    ? `Mesures les plus proches de ${r.lieu.nom} — ` +
      shown
        .map((x) => sentence(`${x.o.station.nom} (${fr(x.f.distance_km)} km, direction ${x.f.direction}, pertinence ${x.f.pertinence})`, x.o, now))
        .join(" ; ") +
      (warnings.length ? `. Attention : ${warnings.join(" ")}` : "")
    : "Aucune mesure disponible pour le moment.";
  const resumeAll = rain ? `${resume} ${rain.resume}` : resume;

  return text({
    lieu: placeBlock(lieu, r),
    resume: resumeAll,
    stations: chosen.map(({ o, stale, f }) => {
      const { avertissements, score: _score, ...rest } = f;
      const block = stationBlock(o, stale, now);
      return { ...block, ...rest, avertissements: [...avertissements, ...block.avertissements] };
    }),
    radar: rain?.bloc,
    sources_indisponibles: indisponibles,
    couverture: coverage(),
    sources,
  });
}
