import type { Cache, Cached } from "../cache.js";
import { localTime } from "../geo.js";
import { resolvePlace, type Place } from "../places/resolve.js";
import * as acspo from "../providers/acspo.js";
import * as modis from "../providers/modis.js";
import { left } from "../budget.js";
import { type SourceInfo, why } from "../types.js";
import { credits, fr, notFound, placeBlock, text } from "./format.js";

// Answer for the whole island when no place is given: one spot per stretch of coast people swim on.
const TOUR = ["Plage de Boucan-Canot", "Plage de l'Ermitage-les-Bains", "Saint-Leu", "Plage de Saint-Pierre",
  "Saint-Denis", "Saint-Benoît"];

// The page /mer: every stretch of coast with a beach or a bathing spot, clockwise from Saint-Denis.
export const BEACHES = ["Saint-Denis", "Sainte-Marie", "Saint-Benoît", "Anse des Cascades", "Plage du Tremblet",
  "Grande Anse", "Plage de Saint-Pierre", "Plage de L'Étang-Salé", "Saint-Leu", "Plage de la Saline les Bains",
  "Plage de l'Ermitage-les-Bains", "Plage de Boucan-Canot", "Plage de Saint-Paul", "Le Port"];

// Best first: ACSPO merges several satellites at 2 km; MODIS (one satellite, 4 km) stands in when ACSPO is
// down or clouded out near the place.
const PRODUCTS: { source: SourceInfo; grid: (c: Cache) => Promise<Cached<acspo.SstDay[]>> }[] = [
  { source: acspo.SOURCE, grid: acspo.grid },
  { source: modis.SOURCE, grid: modis.grid },
];

export const COVERAGE =
  "Version 0.1 : température de surface mesurée par satellite (NOAA ACSPO, ou NASA MODIS en secours), " +
  "environ 2 jours de retard. Les bouées côtières Candhis, qui mesurent l'eau toutes les 30 min, ne sont pas encore branchées.";

const CAVEATS = [
  "Mesure satellite de la toute première couche d'eau, moyenne de la journée sur des carrés de 2 à 4 km : " +
    "c'est la température au large du lieu, pas au bord de la plage ni dans le lagon, qui peuvent différer.",
];

const PRODUCT_SUBREQUESTS = 3;

interface Grid {
  source: SourceInfo;
  cached: Cached<acspo.SstDay[]>;
}

/** The products that answer, in order of preference. A product that fails is skipped. */
async function grids(cache: Cache): Promise<Grid[]> {
  const out: Grid[] = [];
  for (const p of PRODUCTS) {
    // A product not in memory costs a cache read, the download and the cache write: without them, the page keeps
    // what it has rather than fail on the limit.
    if (left() < PRODUCT_SUBREQUESTS) break;
    try {
      out.push({ source: p.source, cached: await p.grid(cache) });
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
  let gs = await grids(cache);
  if (!gs.length) return null;
  // The fallback is only fetched if some point of the tour needs it.
  let readings = names.map((n) => resolvePlace(n)!.lieu).map((p) => ({ p, r: reading(p, gs, now) }));
  if (readings.some((x) => !x.r) && gs.length < PRODUCTS.length) {
    gs = await withFallback(cache, gs);
    readings = readings.map((x) => ({ p: x.p, r: reading(x.p, gs, now) }));
  }
  const used = [...new Set(readings.flatMap((x) => (x.r ? [x.r.grid] : [])))];
  return { readings, used };
}

function unavailable() {
  return {
    ...text({
      erreur: "Les sources satellite (NOAA) ne répondent pas pour le moment et aucune mesure n'est en cache.",
      couverture: COVERAGE,
      sources: credits(PRODUCTS.map((p) => p.source)),
    }),
    isError: true,
  };
}

export async function temperatureMer(cache: Cache, lieu: string | undefined, now = new Date()) {
  if (!lieu?.trim()) {
    const t = await seaTour(cache, now);
    if (!t) return unavailable();
    const points = t.readings.map((x) => ({ lieu: x.p.nom, ...x.r?.mesure }));
    return text({
      resume: points
        .filter((p) => "temperature_eau" in p)
        .map((p) => `${p.lieu} : ${p.temperature_eau} (le ${p.jour_mesure})`)
        .join(" ; "),
      points,
      avertissements: [...CAVEATS, ...t.used.flatMap(staleWarning)],
      couverture: COVERAGE,
      sources: credits(t.used.map((g) => g.source)),
      mis_a_jour: t.used.length ? localTime(t.used[0].cached.fetchedAt) : undefined,
    });
  }

  let gs = await grids(cache);
  if (!gs.length) return unavailable();
  const r = resolvePlace(lieu);
  if (!r) return notFound(lieu);
  let m = reading(r.lieu, gs, now);
  if (!m && gs.length < PRODUCTS.length) {
    gs = await withFallback(cache, gs);
    m = reading(r.lieu, gs, now);
  }
  if (!m) {
    return text({
      lieu: placeBlock(lieu, r),
      resume:
        `Pas de mesure satellite exploitable à moins de 12 km de ${r.lieu.nom} sur les derniers jours ` +
        "(nuages, ou lieu trop loin de la mer).",
      couverture: COVERAGE,
      sources: credits(gs.map((g) => g.source)),
    });
  }
  return text({
    lieu: placeBlock(lieu, r),
    resume:
      `Eau de mer près de ${r.lieu.nom} : ${m.mesure.temperature_eau}, mesurée par satellite le ${m.mesure.jour_mesure} ` +
      `(moyenne du jour, à ${fr(m.mesure.distance_km)} km).`,
    mesure: m.mesure,
    avertissements: [
      ...CAVEATS,
      `Le satellite a environ 2 jours de retard : c'est la température du ${m.mesure.jour_mesure}, pas celle d'aujourd'hui.`,
      ...staleWarning(m.grid),
    ],
    couverture: COVERAGE,
    sources: credits([m.grid.source]),
  });
}

/** Adds the products not loaded yet (the fallback), for a place the loaded ones cannot answer. */
async function withFallback(cache: Cache, gs: Grid[]): Promise<Grid[]> {
  const out = [...gs];
  for (const p of PRODUCTS) {
    if (out.some((g) => g.source === p.source)) continue;
    try {
      out.push({ source: p.source, cached: await p.grid(cache) });
    } catch (err) {
      console.error(`source ${p.source.id} indisponible:`, why(err));
    }
  }
  return out;
}
