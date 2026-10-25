import type { Cache } from "../cache.js";
import { ageMinutes, ageText, distanceKm, localTime } from "../geo.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import * as vc from "../providers/vigicrues.js";
import { why } from "../types.js";
import { credits, de, fr, notFound, placeBlock, text } from "./format.js";

// A gauge this close speaks for the place; past it, the nearest two are given anyway, with a note.
const NEAR_KM = 10;
const MAX_SHOWN = 4;
// Over half an hour, a river that moved less than this is steady: the gauges wobble by a centimetre or two.
const STEADY_M = 0.05;
const LATE_MINUTES = 30;

const hm = (t: number) => localTime(new Date(t)).split(" ")[1];
const dm = (iso: string) => localTime(new Date(iso)).slice(0, 11).replace(" ", " à ");

export interface Level {
  station: vc.Station;
  hauteur?: { t: number; v: number; tendance: "en hausse" | "en baisse" | "stable"; max3h: number };
  debit?: { t: number; v: number };
}

function last(list: [number, number][] | undefined) {
  return list?.length ? list[list.length - 1] : undefined;
}

export function level(station: vc.Station, h: vc.Readings, q: vc.Readings): Level {
  const hs = h[station.id];
  const now = last(hs);
  const out: Level = { station };
  if (now) {
    const before = [...hs].reverse().find(([t]) => t <= now[0] - 30 * 60_000);
    const d = before ? now[1] - before[1] : 0;
    out.hauteur = {
      t: now[0],
      v: now[1],
      tendance: d > STEADY_M ? "en hausse" : d < -STEADY_M ? "en baisse" : "stable",
      max3h: Math.max(...hs.map(([, v]) => v)),
    };
  }
  const qn = last(q[station.id]);
  if (qn) out.debit = { t: qn[0], v: qn[1] };
  return out;
}

/** The smallest flood the DEAL keeps as a landmark: « 1,5 m lors du cyclone Dumile (janvier 2013) ». */
function landmark(s: vc.Station): string | undefined {
  const c = [...s.crues].sort((a, b) => a.hauteur_m - b.hauteur_m)[0];
  return c ? `${fr(c.hauteur_m)} m (${c.nom})` : undefined;
}

/** « Mât - Escalier (rivière du Mât, Salazie) : 0,42 m, stable, 3,1 m³/s ». */
export function sentence(l: Level): string {
  const s = l.station;
  const parts = l.hauteur ? [`${fr(Math.round(l.hauteur.v * 100) / 100)} m, ${l.hauteur.tendance}`] : ["pas de mesure récente"];
  if (l.debit) parts.push(`${fr(Math.round(l.debit.v * 100) / 100)} m³/s`);
  return `${s.nom} (${s.riviere}, ${s.commune}) : ${parts.join(", ")}`;
}

export function levelRow(l: Level, now: Date, km?: number) {
  const s = l.station;
  const age = l.hauteur ? ageMinutes(new Date(l.hauteur.t), now) : null;
  return {
    station: s.nom,
    riviere: s.riviere,
    commune: s.commune,
    ...(km != null ? { distance_km: Math.round(km * 10) / 10 } : {}),
    ...(l.hauteur
      ? {
          hauteur_m: Math.round(l.hauteur.v * 1000) / 1000,
          tendance_30_min: l.hauteur.tendance,
          hauteur_max_3h_m: Math.round(l.hauteur.max3h * 1000) / 1000,
          heure_mesure: localTime(new Date(l.hauteur.t)),
          age_texte: ageText(age!),
        }
      : { hauteur_m: null }),
    ...(l.debit ? { debit_m3s: Math.round(l.debit.v * 1000) / 1000 } : {}),
    ...(s.crues.length ? { crues_de_reference: s.crues } : {}),
    ...(age != null && age > LATE_MINUTES ? { avertissement: `Pas de mesure depuis ${ageText(age)}.` } : {}),
  };
}

// Vigicrues Réunion's guide (§ 4): the bulletins are made only while a river is in yellow vigilance or above. Out
// of one, the last bulletin's date is the end of the last episode, not the age of the levels.
const ONLY_IN_VIGILANCE = "Vigicrues Réunion n'en publie que lorsqu'au moins une rivière est en vigilance jaune ou plus";

/** « Vigilance crues orange pour la rivière des Galets ; jaune pour… », or that none is in force. */
export function vigilanceText(v: vc.Vigilance): string {
  if (!v.active) {
    return `Pas de vigilance crues en cours : toutes les rivières suivies sont au vert.${v.date ? ` Aucun bulletin de vigilance depuis le ${dm(v.date)} : ${ONLY_IN_VIGILANCE}.` : ""}`;
  }
  const by = (c: vc.Colour) => v.rivieres.filter((r) => r.couleur === c).map((r) => r.nom);
  const raised = (["rouge", "orange", "jaune"] as const).filter((c) => by(c).length).map((c) => `${c} pour ${by(c).join(", ")}`);
  return `Vigilance crues en cours (bulletin n° ${v.bulletin} du ${dm(v.date)}) : ${raised.length ? raised.join(" ; ") : "toutes les rivières au vert"}.` +
    (v.observations ? ` Observations : ${v.observations}` : "") + (v.anticipation ? ` À venir : ${v.anticipation}` : "");
}

/** The vigilance as the answer gives it: out of an episode, the last bulletin said for what it is. */
function vigilanceBlock(v: vc.Vigilance) {
  if (v.active) return v;
  return { active: false, ...(v.date ? { aucun_bulletin_depuis: dm(v.date), pourquoi: `${ONLY_IN_VIGILANCE}.` } : {}), rivieres: v.rivieres };
}

/** « mesures de 12:40 »: the newest reading among the gauges given, said before the vigilance; nothing without one. */
function measuredAt(levels: Level[]): string | undefined {
  const t = Math.max(...levels.map((l) => l.hauteur?.t ?? -Infinity));
  return Number.isFinite(t) ? `mesures de ${hm(t)}` : undefined;
}

/** The gauges of a river the question names (« la rivière des Galets », « ravine Saint-Gilles »). */
export function riverAsked(asked: string): vc.Station[] {
  const q = ` ${normalize(asked)} `;
  if (!/ (riviere|ravine|bras|etang|cours d eau) /.test(q)) return [];
  const core = (r: string) =>
    normalize(r).replace(/^(grande |petite )?(riviere|ravine|bras|etang) (de la |des |du |de |d )?/, "");
  return vc.STATIONS.filter((s) => q.includes(` ${core(s.riviere)} `));
}

const COMMON = {
  donnees:
    "Hauteur d'eau à l'échelle de chaque station (un repère propre à la station : ce n'est pas la profondeur, et une valeur négative est normale) et débit, mesurés toutes les 5 minutes par la DEAL Réunion (Vigicrues Réunion).",
  consignes:
    "En cas de pluies fortes ou de crue : ne jamais traverser un radier submergé ni une ravine en eau, à pied ou en voiture ; suivre la vigilance de Météo-France et les consignes de la préfecture.",
  site: vc.SOURCE.url,
};

async function read(cache: Cache, ids: string[] | undefined, now: Date) {
  let v: vc.Vigilance | null = null;
  let h: vc.Readings = {};
  let q: vc.Readings = {};
  const failed: string[] = [];
  const lost = (what: string) => (err: unknown) => {
    console.error(`source ${vc.SOURCE.id} indisponible (${what}):`, why(err));
    failed.push(what);
  };
  await Promise.all([
    vc.vigilance(cache).then((r) => void (v = r.value), lost("vigilance")),
    vc.readings(cache, "hauteur", ids, now).then((r) => void (h = r.value), lost("hauteurs")),
    vc.readings(cache, "debit", ids, now).then((r) => void (q = r.value), lost("débits")),
  ]);
  return { v: v as vc.Vigilance | null, h, q, failed };
}

export async function crues(cache: Cache, lieu: string | undefined, now = new Date()) {
  const sources = credits([vc.SOURCE]);
  const down = () => ({ ...text({ erreur: "Vigicrues Réunion ne répond pas pour le moment.", consulter: vc.SOURCE.url, sources }), isError: true });
  const context = (v: vc.Vigilance | null, failed: string[]) => ({
    head: v ? vigilanceText(v) : "La vigilance crues n'a pas pu être lue.",
    common: { ...COMMON, ...(failed.length ? { indisponible: failed.join(", ") } : {}), sources },
  });

  if (!lieu?.trim()) {
    const { v, h, q, failed } = await read(cache, undefined, now);
    if (!v && !Object.keys(h).length) return down();
    const { head, common } = context(v, failed);
    const levels = vc.STATIONS.map((s) => level(s, h, q));
    const rising = levels.filter((l) => l.hauteur?.tendance === "en hausse");
    const at = measuredAt(levels);
    const moving = rising.length ? `En hausse sur la dernière demi-heure : ${rising.map(sentence).join(" ; ")}` : "Aucune rivière suivie n'est en hausse sur la dernière demi-heure";
    return text({
      resume: `${moving}${at ? ` (${at})` : ""}. ${head}`,
      ...(v ? { vigilance_crues: vigilanceBlock(v) } : {}),
      stations: levels.map((l) => levelRow(l, now)),
      ...common,
    });
  }

  const river = riverAsked(lieu);
  if (river.length) {
    const { v, h, q, failed } = await read(cache, river.map((s) => s.id), now);
    if (!v && !Object.keys(h).length) return down();
    const { head, common } = context(v, failed);
    const mine = river.map((s) => level(s, h, q));
    const ref = landmark(river[0]);
    const at = measuredAt(mine);
    return text({
      resume: `${mine.map(sentence).join(" ; ")}${at ? ` (${at})` : ""}.${ref ? ` Pour repère, la plus petite crue de référence à ${river[0].nom} : ${ref}.` : ""} ${head}`,
      ...(v ? { vigilance_crues: vigilanceBlock(v) } : {}),
      stations: mine.map((l) => levelRow(l, now)),
      ...common,
    });
  }

  const res = resolvePlace(lieu);
  if (!res) return notFound(lieu);
  const p = res.lieu;
  const by = vc.STATIONS.map((s) => ({ s, km: distanceKm(p.lon, p.lat, s.lon, s.lat) })).sort((a, b) => a.km - b.km);
  const near = by.filter((x) => x.km <= NEAR_KM).slice(0, MAX_SHOWN);
  const shown = near.length ? near : by.slice(0, 2);
  const { v, h, q, failed } = await read(cache, shown.map((x) => x.s.id), now);
  if (!v && !Object.keys(h).length) return down();
  const { head, common } = context(v, failed);
  const ref = landmark(shown[0].s);
  const levels = shown.map((x) => level(x.s, h, q));
  const at = measuredAt(levels);
  return text({
    lieu: placeBlock(lieu, res),
    resume:
      `Rivières suivies près ${de(p.nom)}${at ? `, ${at}` : ""} : ${shown.map((x, i) => `${sentence(levels[i])} (à ${fr(Math.round(x.km))} km)`).join(" ; ")}.` +
      (ref ? ` Pour repère, la plus petite crue de référence à ${shown[0].s.nom} : ${ref}.` : "") +
      ` ${head}`,
    ...(v ? { vigilance_crues: vigilanceBlock(v) } : {}),
    stations: shown.map((x, i) => levelRow(levels[i], now, x.km)),
    ...(near.length ? {} : { note: `Aucune station de mesure à moins de ${NEAR_KM} km : voici les plus proches, qui ne sont peut-être pas sur le même cours d'eau.` }),
    ...common,
  });
}
