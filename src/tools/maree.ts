import type { Cache } from "../cache.js";
import { ageMinutes, ageText, distanceKm, localTime } from "../geo.js";
import * as calc from "../maree/calcul.js";
import { resolvePlace } from "../places/resolve.js";
import * as mg from "../providers/maregraphes.js";
import { why } from "../types.js";
import { credits, de, fr, notFound, placeBlock, text } from "./format.js";
import { dayLabel, localDate } from "./prevision.js";

// Past this, the gauge has stopped sending (Sainte-Marie does, for hours at a time): its level is given as old.
const LATE_MINUTES = 30;

const hm = (t: number) => localTime(new Date(t)).split(" ")[1];
const m = (h: number) => `${fr(h)} m`;
/** « Pointe des Galets (Le Port) », « Sainte-Marie ». */
const label = (g: mg.Gauge) => (g.nom === g.commune ? g.nom : `${g.nom} (${g.commune})`);

// The next tides: two days of them (eight, sometimes seven), so that « la marée basse demain » has its answer and the
// model has nothing to extrapolate; the heights corrected by the gap between the gauge and the computation over the
// last hours, as scripts/build-maree.py checked them.
const NEXT_HOURS = 48;
const SHOM = "https://maree.shom.fr";
const OFFSET_HOURS = 6;

export interface GaugeNow {
  gauge: mg.Gauge;
  reading: mg.Reading | null;
  /** Measured minus computed over the last hours, in metres: the sea the weather raises or lowers. */
  offset?: number;
  error?: string;
}

/** The mean gap between the measurement and the computation over the series' last hours, one point every 10 min. */
export function offsetOf(points: mg.Point[], c: calc.Constants): number | undefined {
  const last = points[points.length - 1];
  if (!last) return undefined;
  const recent = points.filter((p) => p.t > last.t - OFFSET_HOURS * 3600_000 && Math.round(p.t / 60_000) % 10 === 0);
  // Half the hours at least, or the gap is that of a passing wave.
  if (recent.length < OFFSET_HOURS * 3) return undefined;
  return Math.round((recent.reduce((s, p) => s + p.h - calc.height(c, p.t / 1000), 0) / recent.length) * 1000) / 1000;
}

export async function gauges(cache: Cache, now = new Date()): Promise<GaugeNow[]> {
  return Promise.all(
    mg.GAUGES.map(async (gauge) => {
      try {
        const points = (await mg.series(cache, gauge, now)).value;
        const c = calc.constantsOf(gauge.id);
        const reading = mg.read(points);
        const fresh = reading && ageMinutes(new Date(reading.t), now) <= LATE_MINUTES;
        return { gauge, reading, ...(c && fresh ? { offset: offsetOf(points, c) } : {}) };
      } catch (err) {
        console.error(`source ${mg.SOURCE.id} indisponible:`, why(err));
        return { gauge, reading: null, error: "le marégraphe ne répond pas pour le moment" };
      }
    }),
  );
}

/** « dimanche 25/10 vers 14:35 »: to five minutes, never to the minute, which the computation does not know. */
function when(t: number, now: Date): string {
  const d = new Date(Math.round(t / 300_000) * 300_000);
  const [hh, mm] = localTime(d).split(" ")[1].split(":");
  const day = localDate(d) === localDate(now) ? "" : `${localDate(d) === localDate(new Date(now.getTime() + 86_400_000)) ? "demain" : dayLabel(localDate(d))} `;
  return `${day}vers ${hh}:${mm}`;
}

/** The time's precision at a gauge: the median gap of the check, to 5 minutes (15 min at Le Port, 20 at Sainte-Marie). */
export function minutes(c: calc.Constants): number {
  return c.controle ? Math.max(10, Math.round(c.controle.ecart_heure_min.mediane / 5) * 5) : 20;
}

/** « à environ 15 min près, hauteurs à environ 5 cm près ». */
export function precision(c: calc.Constants): string {
  return `heures à environ ${minutes(c)} min près, hauteurs à environ 5 cm près`;
}

/** « vérifié sur 3 mois de mesures : écart médian 14 min, 2 cm ». */
function checked(c: calc.Constants): string | undefined {
  const k = c.controle;
  if (!k) return undefined;
  const h = k.ecart_hauteur_recalee_cm ?? k.ecart_hauteur_cm;
  return `vérifié sur 3 mois de mesures hors calcul : écart médian ${fr(Math.round(k.ecart_heure_min.mediane))} min, ${fr(Math.round(h.mediane))} cm`;
}

// Below this range from the turn before or after, the tide is weak (neaps): its turning time is flat and less sure.
const WEAK_RANGE_M = 0.4;

/** The next high and low waters at a gauge, computed: never measured, never the SHOM's. */
export function nextTides(g: GaugeNow, now: Date) {
  const c = calc.constantsOf(g.gauge.id);
  if (!c) return undefined;
  const from = now.getTime() / 1000;
  // From seven hours back, for the turn before the first one, which gives its range.
  const all = calc.nextTurns(c, from - 7 * 3600, NEXT_HOURS + 7);
  const turns = all.filter((e) => e.t >= from).slice(0, 8);
  const offset = g.offset ?? 0;
  return {
    nature: "calcul",
    avertissement: `${calc.LABEL} ; ${precision(c)}.`,
    horizon: `calculé jusqu'au ${localTime(new Date((from + NEXT_HOURS * 3600) * 1000))} heure de La Réunion ; au-delà, les prédictions officielles du SHOM : ${SHOM}`,
    ...(checked(c) ? { controle: checked(c) } : {}),
    ...(g.offset != null
      ? { recalage: `hauteurs recalées de ${offset >= 0 ? "+" : ""}${fr(Math.round(offset * 100))} cm sur le niveau mesuré des ${OFFSET_HOURS} dernières heures` }
      : {}),
    liste: turns.map((e) => {
      const i = all.indexOf(e);
      const range = Math.max(...[all[i - 1], all[i + 1]].filter(Boolean).map((x) => Math.abs(x.h - e.h)));
      return {
        type: e.type === "pleine_mer" ? "pleine mer" : "basse mer",
        heure: when(e.t * 1000, now),
        hauteur_m: Math.round((e.h + offset) * 100) / 100,
        ...(range < WEAK_RANGE_M ? { note: "l'heure est plus incertaine (marée faible)" } : {}),
      };
    }),
  };
}

/**
 * For the pages: the next tides at the gauge nearest a point, computed when the page is viewed (its copy may be hours
 * old). `rows`: the gauges as the copy has them, for the correction measured when it was made, if recent.
 */
export function tidesNear(lon: number, lat: number, now: Date, rows: { maregraphe: string; recalage_m?: number }[] = [], asOf?: Date) {
  const gauge = [...mg.GAUGES].sort((a, b) => distanceKm(lon, lat, a.lon, a.lat) - distanceKm(lon, lat, b.lon, b.lat))[0];
  return tidesAt(gauge, now, rows, asOf);
}

/** The same at one gauge. */
export function tidesAt(gauge: mg.Gauge, now: Date, rows: { maregraphe: string; recalage_m?: number }[] = [], asOf?: Date) {
  const c = calc.constantsOf(gauge.id);
  if (!c) return undefined;
  // The sea the weather raised or lowered changes over days: a correction of more than 12 hours is left out.
  const recent = asOf && now.getTime() - asOf.getTime() < 12 * 3600_000;
  const offset = recent ? rows.find((r) => r.maregraphe === label(gauge))?.recalage_m : undefined;
  const next = nextTides({ gauge, reading: null, offset }, now);
  return next && { gauge, nom: label(gauge), minutes: minutes(c), next };
}

/** « pleine mer vers 14:35 (0,85 m), basse mer vers 20:50 (0,3 m) ». */
export function nextText(n: NonNullable<ReturnType<typeof nextTides>>): string {
  return n.liste.slice(0, 2).map((e) => `${e.type} ${e.heure} (${m(e.hauteur_m)}${"note" in e ? ", heure plus incertaine, marée faible" : ""})`).join(", ");
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

export function gaugeRow({ gauge, reading, offset, error }: GaugeNow, now: Date, km?: number) {
  const age = reading ? ageMinutes(new Date(reading.t), now) : null;
  return {
    maregraphe: label(gauge),
    ...(km != null ? { distance_km: Math.round(km) } : {}),
    // Kept with a page's copy, so that its view corrects the tides it computes as the answer did.
    ...(offset != null ? { recalage_m: offset } : {}),
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
    "Les dernières pleine et basse mer sont celles observées. Les prochaines (prochaines_marees) sont un calcul de rundata d'après plusieurs années de " +
    "ces mesures (analyse harmonique), pas la prédiction officielle du SHOM, qui n'est pas en données ouvertes ; pas de coefficient.",
  bon_a_savoir:
    "La marée est faible à La Réunion (20 à 80 cm) : utile pour le lagon, la pêche à pied ou la mise à l'eau, pas pour la navigation ; " +
    "la houle et le vent comptent souvent plus pour la mer au bord.",
};

/** What a gauge says: measured if it answers, then the computed tides to come. */
function sentence(g: GaugeNow, now: Date): string {
  const next = nextTides(g, now);
  const measured = g.reading ? state(g.reading) : "marégraphe muet pour le moment";
  const c = calc.constantsOf(g.gauge.id)!;
  return next?.liste.length
    ? `${measured} ; prochaines marées, ${calc.LABEL}, à environ ${minutes(c)} min près : ${nextText(next)}`
    : measured;
}

function row(g: GaugeNow, now: Date, km?: number) {
  const next = nextTides(g, now);
  return { ...gaugeRow(g, now, km), ...(next ? { prochaines_marees: next } : {}) };
}

export async function maree(cache: Cache, lieu: string | undefined, now = new Date()) {
  const all = await gauges(cache, now);
  const sources = credits([mg.SOURCE]);
  // The computed tides need no gauge: without any, the answer still has them, said so.
  if (all.every((g) => !g.reading) && all.every((g) => !calc.constantsOf(g.gauge.id))) {
    return { ...text({ erreur: "Les marégraphes du SHOM ne répondent pas pour le moment.", consulter: "https://data.shom.fr/donnees/refmar", sources }), isError: true };
  }

  if (!lieu?.trim()) {
    return text({
      resume: all.map((g) => `${label(g.gauge)} : ${sentence(g, now)}`).join(". ") + ".",
      maregraphes: all.map((g) => row(g, now)),
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
      `${sentence(best.g, now)}.`,
    maregraphes: by.map((x) => row(x.g, now, x.km)),
    ...(best.km > 25 ? { note: `Il n'y a que deux marégraphes, au Port et à Sainte-Marie : celui-ci est à ${fr(Math.round(best.km))} km.` } : {}),
    ...COMMON,
    sources,
  });
}
