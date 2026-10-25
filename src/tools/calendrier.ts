import type { Cache } from "../cache.js";
import { localTime } from "../geo.js";
import { resolvePlace } from "../places/resolve.js";
import * as cal from "../providers/calendrier.js";
import { why } from "../types.js";
import { credits, notFound, text } from "./format.js";

const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « samedi 10 octobre 2026 » for a local date YYYY-MM-DD. */
export function longDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate() === 1 ? "1er" : d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Shown instead of a date when the rectorat has not published the end of a holiday yet. */
export const UNPUBLISHED = "pas encore publiée";

const today = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

async function settle<T>(source: string, p: Promise<{ value: T }>): Promise<T | null> {
  try {
    return (await p).value;
  } catch (err) {
    console.error(`source ${source} indisponible:`, why(err));
    return null;
  }
}

export async function calendrier(cache: Cache, lieu: string | undefined, now = new Date()) {
  const res = lieu?.trim() ? resolvePlace(lieu) : resolvePlace("Saint-Denis");
  if (!res) return notFound(lieu!);
  const day = today(now);
  const [schools, feries] = await Promise.all([
    settle(cal.SCHOOL.id, cal.schoolBreaks(cache)),
    settle(cal.HOLIDAYS.id, cal.holidays(cache, Number(day.slice(0, 4)))),
  ]);

  const parts = [`Nous sommes le ${longDate(day)} à La Réunion.`];
  let ferie;
  if (feries) {
    const next = Object.entries(feries).filter(([d]) => d >= day).sort().slice(0, 4);
    if (feries[day]) parts.push(`Aujourd'hui est férié : ${feries[day]}.`);
    else if (next[0]) parts.push(`Prochain jour férié : ${next[0][1]}, ${longDate(next[0][0])} (dans ${daysBetween(day, next[0][0])} jours).`);
    ferie = {
      aujourd_hui: feries[day] ?? null,
      prochains: next.map(([d, nom]) => ({ date: longDate(d), nom, dans_jours: daysBetween(day, d) })),
      note: "Le 20 décembre (abolition de l'esclavage, Fèt Kaf) est férié à La Réunion seulement.",
    };
  }
  let scolaire;
  if (schools) {
    const current = schools.find((b) => b.debut <= day && b.reprise && day < b.reprise);
    const upcoming = schools.filter((b) => b.debut > day).slice(0, 4);
    if (current) parts.push(`Vacances scolaires en cours (${current.nom}) : reprise des cours le ${longDate(current.reprise!)}.`);
    else if (upcoming[0]) parts.push(`Prochaines vacances scolaires : ${upcoming[0].nom}, à partir du ${longDate(upcoming[0].debut)}.`);
    const fmt = (b: cal.SchoolBreak) => ({
      nom: b.nom,
      debut: longDate(b.debut),
      reprise_des_cours: b.reprise ? longDate(b.reprise) : UNPUBLISHED,
      annee_scolaire: b.annee_scolaire,
    });
    scolaire = {
      en_cours: current ? fmt(current) : null,
      a_venir: upcoming.map(fmt),
      note: "Académie de La Réunion : le calendrier est austral (grandes vacances de décembre à janvier), différent de la métropole.",
    };
  }
  const p = res.lieu;
  const s = cal.sun(day, p.lon, p.lat, p.altitude_m ?? 0);
  const hm = (d: Date) => localTime(d).split(" ")[1];
  const length = Math.round((s.coucher.getTime() - s.lever.getTime()) / 60_000);
  parts.push(`À ${p.nom}, lever du soleil à ${hm(s.lever)}, coucher à ${hm(s.coucher)}.`);

  return text({
    resume: parts.join(" "),
    jours_feries: ferie ?? "indisponible",
    vacances_scolaires: scolaire ?? "indisponible",
    soleil: {
      lieu: p.nom,
      lever: hm(s.lever),
      coucher: hm(s.coucher),
      duree_du_jour: `${Math.floor(length / 60)} h ${String(length % 60).padStart(2, "0")}`,
      note: "Calculé pour l'horizon dégagé\u00a0; dans les cirques et les ravines, le relief cache le soleil plus tôt.",
    },
    sources: credits([...(feries ? [cal.HOLIDAYS] : []), ...(schools ? [cal.SCHOOL] : [])]),
  });
}
