import type { Cache } from "../cache.js";
import { localTime } from "../geo.js";
import { resolvePlace } from "../places/resolve.js";
import * as feux from "../providers/feux.js";
import * as mf from "../providers/vigilance.js";
import { why } from "../types.js";
import { vigilanceLine } from "./feux.js";
import { credits, notFound, placeBlock, text } from "./format.js";

const OFFICIAL =
  "Information officielle de Météo-France, reprise telle quelle. En cas d'alerte cyclonique, suivre les consignes " +
  "de la préfecture (reunion.gouv.fr) et la radio.";

// What each colour of the cyclone alert asks of people (vigilance.meteofrance.fr).
// The codes are those of providers/vigilance.ts, a higher one a worse alert, the phase de sauvegarde last. No colour
// for the pré-alerte: the prefecture dropped its yellow (release of 26/11/2024), Météo-France's documentation keeps it.
export const CYCLONE_STEPS: Record<number, string> = {
  2: "pré-alerte, « je m'informe » : menace potentielle dans les jours à venir",
  3: "orange, « je me prépare » : danger dans les 24 heures",
  4: "rouge, « je me confine » : danger imminent",
  5: "violette, « je me confine strictement » : même les secours ne circulent plus",
  6: "phase de sauvegarde : le cyclone s'éloigne, le danger demeure",
};

const day = (iso: string) => localTime(new Date(iso));
/** A zone and phenomenon where Météo-France issued nothing, not even green (marketing). */
export const NONE_ISSUED = "pas de vigilance émise";

/** The colour in force at `now`: the first period when `now` is before them all, -1 when there is none. */
export function current(periods: mf.Period[], now: Date): number {
  const t = now.toISOString();
  const p = periods.find((x) => x.debut <= t && (!x.fin || t < x.fin)) ?? periods[0];
  return p?.couleur ?? -1;
}

export function highest(periods: mf.Period[]): number {
  return Math.max(-1, ...periods.map((p) => p.couleur));
}

/** The periods above green, as « orange de 14h00 à 20h00 ». */
export function spans(periods: mf.Period[], name = mf.colour): string[] {
  return periods
    .filter((p) => p.couleur >= 2)
    .map((p) => `${name(p.couleur)} ${p.fin ? `du ${day(p.debut)} au ${day(p.fin)}` : `à partir du ${day(p.debut)}`}`);
}

/** « Alerte cyclonique orange », « Pré-alerte cyclonique », « Phase de sauvegarde cyclonique ». */
export const cycloneHead = (c: number) => (c === 2 ? "Pré-alerte cyclonique" : c === 6 ? "Phase de sauvegarde cyclonique" : `Alerte cyclonique ${mf.cycloneName(c)}`);

/**
 * The cyclone alert to show: the one in force, else the next one announced; -1 when there is none. Not the highest
 * code: the phase de sauvegarde (6) comes after a red alert, it is not worse.
 */
export function cycloneLevel(periods: mf.Period[] | undefined, now: Date): number {
  if (!periods) return -1;
  const c = current(periods, now);
  if (c >= 2) return c;
  const t = now.toISOString();
  return periods.find((p) => p.couleur >= 2 && p.debut > t)?.couleur ?? -1;
}

export function cyclone(v: mf.Vigilance, now: Date): string {
  const periods = v.zones[mf.ISLAND]?.[mf.CYCLONE];
  if (!periods || highest(periods) < 2) return "Pas d'alerte cyclonique en cours.";
  const c = current(periods, now);
  const step = CYCLONE_STEPS[c] ?? mf.colour(c);
  return c >= 2 ? `ALERTE CYCLONIQUE ${step}.` : `Alerte cyclonique prévue : ${spans(periods, mf.cycloneName).join(", ")}.`;
}

/** Every zone with a phenomenon above green in the next 24 h, worst first. */
export function raised(v: mf.Vigilance) {
  const out: { zone: string; phenomene: string; couleur_max: string; max: number; periodes: string[] }[] = [];
  for (const [zone, byPhenomenon] of Object.entries(v.zones)) {
    if (zone === mf.ISLAND) continue;
    for (const [id, periods] of Object.entries(byPhenomenon)) {
      if (Number(id) === mf.CYCLONE) continue;
      const max = highest(periods);
      if (max < 2) continue;
      out.push({ zone: mf.ZONES[zone] ?? zone, phenomene: mf.PHENOMENA[Number(id)] ?? `phénomène ${id}`, couleur_max: mf.colour(max), max, periodes: spans(periods) });
    }
  }
  return out.sort((a, b) => b.max - a.max);
}

/**
 * Sentences for the other tools' warnings: empty when nothing is above green. Never throws (the vigilance is a
 * bonus there), and only asks Météo-France when its key is configured. `officiel`: where Météo-France says it, the
 * cyclone's page while a cyclone alert is among them.
 */
export async function vigilanceWarnings(cache: Cache, now = new Date()): Promise<{ lignes: string[]; officiel?: string }> {
  if (!mf.enabled()) return { lignes: [] };
  try {
    const v = (await mf.vigilance(cache)).value;
    const out: string[] = [];
    const c = cyclone(v, now);
    const alert = !c.startsWith("Pas d'");
    if (alert) out.push(`${c} Voir vigilance_meteo et les consignes de la préfecture.`);
    const r = raised(v);
    if (r.length) {
      const list = r.slice(0, 4).map((x) => `${x.couleur_max} ${x.phenomene.toLowerCase()} (${x.zone.split(" :")[0]})`);
      out.push(`Vigilance Météo-France en cours : ${list.join(", ")}${r.length > 4 ? "…" : ""}. Détails avec vigilance_meteo.`);
    }
    return out.length ? { lignes: out, officiel: mf.officiel(alert ? mf.OFFICIEL_CYCLONE : mf.OFFICIEL_VIGILANCE) } : { lignes: [] };
  } catch (err) {
    console.error(`source ${mf.SOURCE.id} indisponible:`, why(err));
    return { lignes: [] };
  }
}

/** The land phenomena of a zone: heavy rain and thunderstorms, strong winds. */
export const LAND_PHENOMENA = [12, 1];

/**
 * What Météo-France has in force now in a land zone, phenomenon by phenomenon: those above green, and whether
 * anything at all is issued there (green included). Never one colour for two phenomena (Météo-France).
 */
export function zoneLevels(v: mf.Vigilance, zone: string | undefined, now: Date): { above: { phenomene: string; couleur: number }[]; issued: boolean } {
  const own = zone ? v.zones[zone] ?? {} : {};
  const levels = LAND_PHENOMENA.map((id) => ({ phenomene: mf.PHENOMENA[id], couleur: current(own[id] ?? [], now) }));
  return { above: levels.filter((x) => x.couleur >= 2), issued: levels.some((x) => x.couleur >= 1) };
}

/** The 5 land zones of Météo-France. */
const LAND_ZONES = [...new Set(Object.values(mf.ZONE_OF_COMMUNE))];

/**
 * Green for the whole island: every land zone has each land phenomenon issued, none above green. Else, with nothing
 * above green, « pas de vigilance émise »: never a green Météo-France did not issue.
 */
export function islandGreen(v: mf.Vigilance, now: Date): boolean {
  return raised(v).length === 0 && LAND_ZONES.every((z) => LAND_PHENOMENA.every((id) => current(v.zones[z]?.[id] ?? [], now) >= 1));
}

/** « Pas de vigilance émise », to begin a sentence. */
export const NONE_ISSUED_SAID = NONE_ISSUED.charAt(0).toUpperCase() + NONE_ISSUED.slice(1);

/** « jaune fortes pluies / orages, orange vents forts », « vert », or « pas de vigilance émise » (marketing). */
export function zoneText(v: mf.Vigilance, zone: string | undefined, now: Date): string {
  const { above, issued } = zoneLevels(v, zone, now);
  return above.length ? above.map((x) => `${mf.colour(x.couleur)} ${x.phenomene.toLowerCase()}`).join(", ") : issued ? mf.colour(1) : NONE_ISSUED;
}

/** « Sud », « Sud-Est »: a land zone by its short name. */
export const zoneShort = (zone: string | undefined) => (zone ? mf.ZONES[zone] ?? zone : "").split(" :")[0];

/**
 * The coasts above green, as Météo-France names them, never given to a commune: « Vagues-submersion : jaune, zone
 * côtière de … » for one, « Vagues-submersion : jaune sur 3 zones côtières » beyond (marketing).
 */
export function coastText(v: mf.Vigilance): string | undefined {
  const coast = raised(v).filter((x) => x.phenomene === mf.PHENOMENA[9]);
  if (!coast.length) return undefined;
  if (coast.length === 1) return `Vagues-submersion : ${coast[0].couleur_max}, ${coast[0].zone.charAt(0).toLowerCase()}${coast[0].zone.slice(1)}`;
  const byColour = new Map<string, number>();
  for (const c of coast) byColour.set(c.couleur_max, (byColour.get(c.couleur_max) ?? 0) + 1);
  return `Vagues-submersion : ${[...byColour].map(([c, n]) => `${c} sur ${n} ${n > 1 ? "zones côtières" : "zone côtière"}`).join(", ")}`;
}

function unavailable(reason: string) {
  return {
    ...text({ erreur: reason, consulter: mf.SOURCE.url, officiel: mf.officiel(mf.OFFICIEL_VIGILANCE), sources: credits([mf.SOURCE]) }),
    isError: true,
  };
}

export async function vigilanceMeteo(cache: Cache, lieu: string | undefined, now = new Date()) {
  if (!mf.enabled()) return unavailable("La vigilance Météo-France n'est pas branchée sur ce serveur (clé absente).");
  let cached;
  // The fires seen by satellite: one line, only when there is one (providers/feux.ts).
  const seen = feux.feuxNow(cache, now);
  try {
    cached = await mf.vigilance(cache);
  } catch (err) {
    console.error(`source ${mf.SOURCE.id} indisponible:`, why(err));
    return unavailable("Météo-France ne répond pas pour le moment et aucune vigilance n'est en cache.");
  }
  const v = cached.value;
  const r = raised(v);
  const fires = await seen;
  const link = mf.officiel(mf.OFFICIEL_VIGILANCE);
  const fireLine = fires ? vigilanceLine(fires, now) : undefined;
  const common = {
    emise: `${day(v.emise)} heure de La Réunion`,
    alerte_cyclonique: cyclone(v, now),
    feux_detectes: fireLine,
    suivi_meteo_france: v.suivi.length ? v.suivi : undefined,
    avertissements: [OFFICIAL, ...(cached.stale ? ["Météo-France momentanément injoignable : dernière vigilance connue."] : [])],
    consulter: mf.SOURCE.url,
    officiel: link,
    sources: credits(fireLine ? [mf.SOURCE, feux.SOURCE] : [mf.SOURCE]),
  };

  if (!lieu?.trim()) {
    const resume = r.length
      ? `${common.alerte_cyclonique} Vigilances au-dessus du vert : ` +
        r.map((x) => `${x.couleur_max} ${x.phenomene.toLowerCase()} pour ${x.zone}`).join("\u00a0; ") + "."
      : islandGreen(v, now)
        ? `${common.alerte_cyclonique} Aucune vigilance particulière à La Réunion (tout est vert) dans les 24 h du bulletin.`
        : `${common.alerte_cyclonique} ${NONE_ISSUED_SAID}.`;
    return text({ resume: `${resume} ${link}`, ...common, vigilances: r.map(({ max: _, ...x }) => x) });
  }

  const res = resolvePlace(lieu);
  if (!res) return notFound(lieu);
  // The zone of Météo-France the place is in, said as its own: never a colour given to the commune (Météo-France).
  const zone = mf.ZONE_OF_COMMUNE[res.lieu.commune];
  const own = zone ? v.zones[zone] ?? {} : {};
  const land = Object.entries(mf.PHENOMENA).filter(([id]) => Number(id) !== mf.CYCLONE && Number(id) !== 9);
  const niveaux = land.map(([id, nom]) => {
    const periods = own[Number(id)] ?? [];
    const now_ = current(periods, now);
    return {
      phenomene: nom,
      maintenant: now_ >= 1 ? mf.colour(now_) : NONE_ISSUED,
      a_venir: spans(periods).length ? spans(periods) : undefined,
    };
  });
  const coast = r.filter((x) => x.phenomene === mf.PHENOMENA[9]);
  const zoneName = zone ? mf.ZONES[zone] : "zone inconnue";
  const short = zoneName.split(" :")[0];
  const up = land.flatMap(([id, nom]) =>
    (own[Number(id)] ?? []).filter((p) => p.couleur >= 2).map((p) => `${mf.colour(p.couleur)} ${nom.toLowerCase()} ${p.fin ? `du ${day(p.debut)} au ${day(p.fin)}` : `à partir du ${day(p.debut)}`}`),
  );
  const issued = land.some(([id]) => (own[Number(id)] ?? []).some((p) => p.couleur >= 1));
  const said = up.length ? up.join(", ") : issued ? "vert" : NONE_ISSUED;
  return text({
    lieu: placeBlock(lieu, res),
    zone_vigilance: zoneName,
    resume:
      `${common.alerte_cyclonique} Vigilance Météo-France, zone ${short} (où se trouve ${res.lieu.commune}) : ${said}.` +
      (coast.length ? ` Vagues-submersion sur le littoral : ${coast.map((c) => `${c.couleur_max} (${c.zone})`).join(", ")}.` : "") +
      ` ${link}`,
    niveaux,
    vagues_submersion: coast.length ? coast.map(({ max: _, ...x }) => x) : "pas de vigilance particulière sur le littoral",
    ...common,
  });
}
