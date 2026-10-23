import type { Cache } from "../cache.js";
import { ageMinutes, ageText, distanceKm, localTime } from "../geo.js";
import { resolvePlace } from "../places/resolve.js";
import * as mg from "../providers/maregraphes.js";
import { why } from "../types.js";
import { credits, de, fr, notFound, placeBlock, text } from "./format.js";

// Past this, the gauge has stopped sending (Sainte-Marie does, for hours at a time): its level is given as old.
const LATE_MINUTES = 30;

const hm = (t: number) => localTime(new Date(t)).split(" ")[1];
const m = (h: number) => `${fr(h)} m`;
/** « Pointe des Galets (Le Port) », « Sainte-Marie ». */
const label = (g: mg.Gauge) => (g.nom === g.commune ? g.nom : `${g.nom} (${g.commune})`);

export interface GaugeNow {
  gauge: mg.Gauge;
  reading: mg.Reading | null;
  error?: string;
}

export async function gauges(cache: Cache, now = new Date()): Promise<GaugeNow[]> {
  return Promise.all(
    mg.GAUGES.map(async (gauge) => {
      try {
        return { gauge, reading: mg.read((await mg.series(cache, gauge, now)).value) };
      } catch (err) {
        console.error(`source ${mg.SOURCE.id} indisponible:`, why(err));
        return { gauge, reading: null, error: "le marégraphe ne répond pas pour le moment" };
      }
    }),
  );
}

/** « 0,5 m, marée descendante ; dernière pleine mer vers 00:04 (0,86 m), dernière basse mer vers 17:41 (0,39 m) ». */
export function state(r: mg.Reading): string {
  const tide = r.tendance === "étale" ? "mer étale (elle tourne)" : `marée ${r.tendance}`;
  const last = (type: mg.Extremum["type"]) => [...r.extremes].reverse().find((e) => e.type === type);
  const turns = [last("pleine_mer"), last("basse_mer")]
    .filter((e): e is mg.Extremum => !!e)
    .sort((a, b) => b.t - a.t)
    .map((e) => `dernière ${e.type === "pleine_mer" ? "pleine mer" : "basse mer"} vers ${hm(e.t)} (${m(e.h)})`);
  return [`${m(r.h)}, ${tide}`, ...turns].join(" ; ");
}

export function gaugeRow({ gauge, reading, error }: GaugeNow, now: Date, km?: number) {
  const age = reading ? ageMinutes(new Date(reading.t), now) : null;
  return {
    maregraphe: label(gauge),
    ...(km != null ? { distance_km: Math.round(km) } : {}),
    ...(reading
      ? {
          hauteur_m: reading.h,
          reference: "au-dessus du zéro hydrographique (zéro des cartes marines)",
          tendance: reading.tendance,
          heure_mesure: localTime(new Date(reading.t)),
          age_texte: ageText(age!),
          derniers_extremes: reading.extremes.slice(-2).map((e) => ({
            type: e.type === "pleine_mer" ? "pleine mer" : "basse mer",
            heure: hm(e.t),
            hauteur_m: e.h,
          })),
          ...(age! > LATE_MINUTES ? { avertissement: `Le marégraphe n'a rien envoyé depuis ${ageText(age!)} : ce n'est plus la mer de maintenant.` } : {}),
        }
      : { erreur: error ?? "pas assez de mesures récentes" }),
  };
}

const COMMON = {
  donnees:
    "Hauteur d'eau mesurée chaque minute par les marégraphes du SHOM, données brutes non validées, en mètres au-dessus du zéro des cartes marines. " +
    "Les heures de pleine et de basse mer sont celles observées, jamais une prévision : les prédictions de marée du SHOM ne sont pas en données ouvertes.",
  bon_a_savoir: "À La Réunion, l'écart entre pleine et basse mer dépasse rarement 1 m ; la houle et le vent comptent souvent plus pour la mer au bord.",
};

export async function maree(cache: Cache, lieu: string | undefined, now = new Date()) {
  const all = await gauges(cache, now);
  const sources = credits([mg.SOURCE]);
  if (all.every((g) => !g.reading)) {
    return { ...text({ erreur: "Les marégraphes du SHOM ne répondent pas pour le moment.", consulter: "https://data.shom.fr/donnees/refmar", sources }), isError: true };
  }

  if (!lieu?.trim()) {
    const ok = all.filter((g) => g.reading);
    return text({
      resume: ok.map((g) => `${label(g.gauge)} : ${state(g.reading!)}`).join(". ") + ".",
      maregraphes: all.map((g) => gaugeRow(g, now)),
      ...COMMON,
      sources,
    });
  }

  const res = resolvePlace(lieu);
  if (!res) return notFound(lieu);
  const p = res.lieu;
  const by = all
    .map((g) => ({ g, km: distanceKm(p.lon, p.lat, g.gauge.lon, g.gauge.lat) }))
    .sort((a, b) => Number(!!b.g.reading) - Number(!!a.g.reading) || a.km - b.km);
  const best = by[0];
  return text({
    lieu: placeBlock(lieu, res),
    resume:
      `Marée au marégraphe le plus proche ${de(p.nom)}, ${best.g.gauge.nom} (${best.g.gauge.commune}, à ${fr(Math.round(best.km))} km) : ` +
      `${state(best.g.reading!)}.`,
    maregraphes: by.map((x) => gaugeRow(x.g, now, x.km)),
    ...(best.km > 25 ? { note: `Il n'y a que deux marégraphes, au Port et à Sainte-Marie : celui-ci est à ${fr(Math.round(best.km))} km.` } : {}),
    ...COMMON,
    sources,
  });
}
