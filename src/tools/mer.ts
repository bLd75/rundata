import type { Cache, Cached } from "../cache.js";
import { distanceKm, localTime } from "../geo.js";
import { resolvePlace, type Place } from "../places/resolve.js";
import * as acspo from "../providers/acspo.js";
import * as houle from "../providers/houle.js";
import * as modis from "../providers/modis.js";
import { left } from "../budget.js";
import { type SourceInfo, why } from "../types.js";
import { credits, fr, notFound, placeBlock, text } from "./format.js";
import { dayLabel, localDate, localHour } from "./prevision.js";

// Answer for the whole island when no place is given: one spot per stretch of coast people swim on.
const TOUR = ["Plage de Boucan-Canot", "Plage de l'Ermitage-les-Bains", "Saint-Leu", "Plage de Saint-Pierre",
  "Saint-Denis", "Saint-Benoît"];

// The page /mer: every stretch of coast with a beach or a bathing spot, clockwise from Saint-Denis.
export const BEACHES = ["Saint-Denis", "Sainte-Marie", "Saint-Benoît", "Anse des Cascades", "Plage du Tremblet",
  "Grande Anse", "Plage de Saint-Pierre", "Plage de L'Étang-Salé", "Saint-Leu", "Plage de la Saline les Bains",
  "Plage de l'Ermitage-les-Bains", "Plage de Boucan-Canot", "Plage de Saint-Paul", "Le Port"];

// Best first: ACSPO merges several satellites at 2 km; MODIS (one satellite, 4 km) stands in when ACSPO is
// down or clouded out near the place.
// `cost`: the subrequests of a product not in memory (budget.ts).
const PRODUCTS: { source: SourceInfo; cost: number; grid: (c: Cache, now: Date) => Promise<Cached<acspo.SstDay[]>> }[] = [
  { source: acspo.SOURCE, cost: acspo.COST, grid: acspo.grid },
  { source: modis.SOURCE, cost: modis.COST, grid: modis.grid },
];

export const COVERAGE =
  "Température de surface MESURÉE par satellite (NOAA ACSPO, ou NASA MODIS en secours), environ 2 jours de retard. " +
  `Vagues : PRÉVISION du modèle ${houle.MODEL.nom} (maille de ${houle.MODEL.maille_km} km, ${houle.MODEL.echeance_jours} jours), ` +
  "jamais mélangée aux mesures. Les bouées côtières Candhis, qui mesurent la houle et l'eau toutes les 30 min, ne sont pas encore branchées.";

const CAVEATS = [
  "Mesure satellite de la toute première couche d'eau, moyenne de la journée sur des carrés de 2 à 4 km : " +
    "c'est la température au large du lieu, pas au bord de la plage ni dans le lagon, qui peuvent différer.",
];

// The waves of the whole coast: a cache read, one request for every beach, the cache write.
const WAVE_SUBREQUESTS = 3;
// Further from the model's nearest sea cell, a place is not on the stretch of coast the cell stands for.
const WAVE_MAX_KM = 15;
const HOUR = 3600_000;

interface Grid {
  source: SourceInfo;
  cached: Cached<acspo.SstDay[]>;
}

/** The products that answer, in order of preference. A product that fails is skipped. */
async function grids(cache: Cache, now: Date): Promise<Grid[]> {
  const out: Grid[] = [];
  for (const p of PRODUCTS) {
    // Without the subrequests of a product not in memory, the page keeps what it has rather than fail on the limit.
    if (left() < p.cost) break;
    try {
      out.push({ source: p.source, cached: await p.grid(cache, now) });
    } catch (err) {
      console.error(`source ${p.source.id} indisponible:`, why(err));
    }
    if (out.length && out[0].source === acspo.SOURCE && !out[0].cached.stale) break; // no need for the fallback
  }
  return out;
}

function reading(place: Place, gs: Grid[], now: Date) {
  for (const g of gs) {
    const m = acspo.nearest(g.cached.value, place.lon, place.lat);
    if (!m) continue;
    const ageDays = Math.round((now.getTime() - Date.parse(`${m.date}T12:00:00Z`)) / 86_400_000);
    return {
      grid: g,
      valeur: m.valeur,
      mesure: {
        temperature_eau: `${fr(m.valeur)} °C`,
        nature: "mesure_satellite",
        jour_mesure: m.date,
        age_jours: ageDays,
        distance_km: m.distance_km,
        position: { lat: m.lat, lon: m.lon },
        source: g.source.nom,
      },
    };
  }
  return null;
}

function staleWarning(g: Grid | undefined) {
  return g?.cached.stale ? ["Source momentanément injoignable : dernière valeur connue."] : [];
}

/** The tour of the coast, without a place: one reading per stretch of `names`, null where no product has one. */
export async function seaTour(cache: Cache, now = new Date(), names = TOUR) {
  let gs = await grids(cache, now);
  if (!gs.length) return null;
  // The fallback is only fetched if some point of the tour needs it.
  let readings = names.map((n) => resolvePlace(n)!.lieu).map((p) => ({ p, r: reading(p, gs, now) }));
  if (readings.some((x) => !x.r) && gs.length < PRODUCTS.length) {
    gs = await withFallback(cache, gs, now);
    readings = readings.map((x) => ({ p: x.p, r: reading(x.p, gs, now) }));
  }
  const used = [...new Set(readings.flatMap((x) => (x.r ? [x.r.grid] : [])))];
  return { readings, used };
}

// --- Waves: a forecast, kept apart from the measurement ---------------------------------------------------------

/** The points the waves are asked for, all in one request: the beaches of the page /mer. */
const coast = () => BEACHES.map((n) => resolvePlace(n)!.lieu);

/**
 * The forecast of the waves along the coast, or null: an answer or a page goes without it rather than fail. Only with
 * twice its cost left: a page built alongside other parts must keep the writes of their copies (budget.ts).
 */
export async function wavesNow(cache: Cache): Promise<Cached<houle.Waves> | null> {
  if (left() < 2 * WAVE_SUBREQUESTS) return null;
  try {
    return await houle.coast(cache, "plages", coast());
  } catch (err) {
    console.error(`source ${houle.SOURCE.id} indisponible:`, why(err));
    return null;
  }
}

const SIDES = ["du nord", "du nord-est", "de l'est", "du sud-est", "du sud", "du sud-ouest", "de l'ouest", "du nord-ouest"];
const from = (deg: number | null) => (deg == null ? undefined : SIDES[Math.round(deg / 45) % 8]);
const metres = (h: number) => `${fr(Math.round(h * 10) / 10)} m`;

interface WaveStep {
  time: Date;
  hauteur: number;
  periode: number | null;
  direction: number | null;
}

function stepOf(w: houle.Waves, p: houle.WavePoint, i: number): WaveStep | null {
  const h = p.hauteur[i];
  return h == null ? null : { time: houle.stepTime(w, i), hauteur: h, periode: p.periode[i], direction: p.direction[i] };
}

function stepText(s: WaveStep) {
  return {
    heures: `${dayLabel(localDate(s.time))} ${localHour(s.time)}h`,
    hauteur: metres(s.hauteur),
    periode: s.periode == null ? undefined : `${Math.round(s.periode)} s`,
    venant: from(s.direction),
  };
}

/** « 0,8 m du sud-ouest, période 10 s ». */
const waveWords = (s: WaveStep) =>
  [metres(s.hauteur), from(s.direction), s.periode == null ? undefined : `période ${Math.round(s.periode)} s`].filter(Boolean).join(" ").replace(/ (période)/, ", $1");

/** The model's sea cell nearest a place, with its steps still to come; null away from the coast. */
export function wavesAt(w: houle.Waves, lon: number, lat: number, now: Date) {
  let best: { p: houle.WavePoint; km: number } | undefined;
  for (const p of w.points) {
    const km = distanceKm(lon, lat, p.lon, p.lat);
    if (!best || km < best.km) best = { p, km };
  }
  if (!best || best.km > WAVE_MAX_KM) return null;
  const steps: WaveStep[] = [];
  best.p.hauteur.forEach((_, i) => {
    const s = stepOf(w, best!.p, i);
    if (s && s.time.getTime() + houle.STEP_H * HOUR > now.getTime()) steps.push(s);
  });
  if (!steps.length) return null;
  // The day's highest waves, today included.
  const days = [...new Set(steps.map((s) => localDate(s.time)))].map((date) =>
    steps.filter((s) => localDate(s.time) === date).reduce((a, b) => (b.hauteur > a.hauteur ? b : a)));
  return { point: best.p, km: Math.round(best.km * 10) / 10, now: steps[0], steps, days };
}

const WAVE_WARNINGS = [
  "PRÉVISION d'un modèle numérique de vagues, pas une mesure. Elle vaut au large, avant le récif : dans le lagon, " +
    "derrière une digue ou sur un spot abrité, les vagues sont bien plus petites ; sur une pointe exposée, plus fortes.",
  "Hauteur significative : celle du tiers des plus hautes vagues. Des vagues isolées peuvent approcher le double.",
  "Pour la sécurité : la vigilance vagues-submersion de Météo-France (vigilance_meteo), les drapeaux de baignade et les maîtres-nageurs.",
];

/** The waves of the step under way and the highest to come near a point, in words: for the answers and the pages. */
export function waveLine(w: houle.Waves, lon: number, lat: number, now: Date) {
  const at = wavesAt(w, lon, lat, now);
  if (!at) return null;
  const top = at.days.reduce((a, b) => (b.hauteur > a.hauteur ? b : a));
  return {
    at,
    hauteur_m: at.now.hauteur,
    maintenant: waveWords(at.now),
    heure: `${localHour(at.now.time)}h`,
    max: metres(top.hauteur),
    max_jour: localDate(top.time) === localDate(now) ? "aujourd'hui" : dayLabel(localDate(top.time)),
  };
}

/** The block an answer carries: always labelled a forecast, never merged into the measurement. */
function waveBlock(w: Cached<houle.Waves>, place: Place, now: Date) {
  const l = waveLine(w.value, place.lon, place.lat, now);
  if (!l) return null;
  const at = l.at;
  return {
    resume:
      `Vagues PRÉVUES près de ${place.nom} (modèle ${houle.MODEL.nom}, pas une mesure) : ${l.maintenant} ` +
      `vers ${l.heure} ; jusqu'à ${l.max} ${l.max_jour}.`,
    bloc: {
      nature: "prevision",
      modele: { nom: houle.MODEL.nom, maille_km: houle.MODEL.maille_km, mise_a_jour: houle.MODEL.mise_a_jour },
      point_du_modele: { lat: at.point.lat, lon: at.point.lon, distance_km: at.km },
      maintenant: stepText(at.now),
      jours: at.days.map((d) => ({
        jour: dayLabel(localDate(d.time)),
        hauteur_max: metres(d.hauteur),
        periode: d.periode == null ? undefined : `${Math.round(d.periode)} s`,
        venant: from(d.direction),
      })),
      pas_de_3h: at.steps.slice(0, 8).map(stepText),
      mis_a_jour: localTime(w.fetchedAt),
      avertissements: [...WAVE_WARNINGS, ...(w.stale ? ["Service de prévision momentanément injoignable : prévision précédente, plus ancienne."] : [])],
    },
  };
}

function unavailable() {
  return {
    ...text({
      erreur: "Les sources satellite (NOAA) et la prévision des vagues ne répondent pas pour le moment, et rien n'est en cache.",
      couverture: COVERAGE,
      sources: credits(PRODUCTS.map((p) => p.source)),
    }),
    isError: true,
  };
}

export async function temperatureMer(cache: Cache, lieu: string | undefined, now = new Date()) {
  if (!lieu?.trim()) {
    const [t, w] = await Promise.all([seaTour(cache, now), wavesNow(cache)]);
    if (!t && !w) return unavailable();
    const points = TOUR.map((n) => resolvePlace(n)!.lieu).map((p, i) => {
      const v = w ? wavesAt(w.value, p.lon, p.lat, now) : null;
      return { lieu: p.nom, ...t?.readings[i].r?.mesure, ...(v ? { vagues_prevision: waveWords(v.now) } : {}) };
    });
    const measured = points.filter((p) => "temperature_eau" in p).map((p) => `${p.lieu} : ${p.temperature_eau} (le ${p.jour_mesure})`);
    const waves = points.filter((p) => p.vagues_prevision).map((p) => `${p.lieu} ${p.vagues_prevision}`);
    return text({
      resume: [
        measured.length ? `Eau de mer, MESURÉE par satellite : ${measured.join(" ; ")}.` : "Pas de mesure satellite de l'eau pour le moment.",
        ...(waves.length ? [`Vagues PRÉVUES maintenant (modèle ${houle.MODEL.nom}, pas une mesure) : ${waves.join(" ; ")}.`] : []),
      ].join(" "),
      points,
      avertissements: [...(t ? CAVEATS : []), ...(t?.used.flatMap(staleWarning) ?? []), ...(w ? WAVE_WARNINGS : [])],
      couverture: COVERAGE,
      sources: credits([...(t?.used.map((g) => g.source) ?? []), ...(w ? [houle.SOURCE] : [])]),
      mis_a_jour: t?.used.length ? localTime(t.used[0].cached.fetchedAt) : undefined,
    });
  }

  const r = resolvePlace(lieu);
  if (!r) return notFound(lieu);
  let [gs, w] = await Promise.all([grids(cache, now), wavesNow(cache)]);
  if (!gs.length && !w) return unavailable();
  let m = gs.length ? reading(r.lieu, gs, now) : null;
  if (gs.length && !m && gs.length < PRODUCTS.length) {
    gs = await withFallback(cache, gs, now);
    m = reading(r.lieu, gs, now);
  }
  const v = w ? waveBlock(w, r.lieu, now) : null;
  const temperature = m
    ? `Eau de mer près de ${r.lieu.nom} : ${m.mesure.temperature_eau}, mesurée par satellite le ${m.mesure.jour_mesure} ` +
      `(moyenne du jour, à ${fr(m.mesure.distance_km)} km).`
    : gs.length
      ? `Pas de mesure satellite exploitable à moins de 12 km de ${r.lieu.nom} sur les derniers jours ` +
        "(nuages, ou lieu trop loin de la mer)."
      : "Température de l'eau : les sources satellite ne répondent pas pour le moment.";
  const waves = v
    ? v.resume
    : w
      ? `Pas de prévision de vagues à moins de ${WAVE_MAX_KM} km de ${r.lieu.nom} (lieu loin de la côte).`
      : "Prévision des vagues momentanément indisponible.";
  return text({
    lieu: placeBlock(lieu, r),
    resume: `${temperature} ${waves}`,
    ...(m ? { mesure: m.mesure } : {}),
    ...(v ? { etat_de_la_mer: v.bloc } : {}),
    ...(m
      ? {
          avertissements: [
            ...CAVEATS,
            `Le satellite a environ 2 jours de retard : c'est la température du ${m.mesure.jour_mesure}, pas celle d'aujourd'hui.`,
            ...staleWarning(m.grid),
          ],
        }
      : {}),
    couverture: COVERAGE,
    sources: credits([...(m ? [m.grid.source] : gs.map((g) => g.source)), ...(v ? [houle.SOURCE] : [])]),
  });
}

/** Adds the products not loaded yet (the fallback), for a place the loaded ones cannot answer. */
async function withFallback(cache: Cache, gs: Grid[], now: Date): Promise<Grid[]> {
  const out = [...gs];
  for (const p of PRODUCTS) {
    if (out.some((g) => g.source === p.source)) continue;
    try {
      out.push({ source: p.source, cached: await p.grid(cache, now) });
    } catch (err) {
      console.error(`source ${p.source.id} indisponible:`, why(err));
    }
  }
  return out;
}
