/**
 * How fresh an answer is, the same way for every tool (added by citer.ts next to the citation): when the data was
 * measured or published when the answer says it, when rundata.re read the source, the age, and whether a source
 * that did not answer was replaced by its last copy.
 */
import { ageMinutes, ageText, localTime } from "../geo.js";
import type { Lecture } from "../lectures.js";

// Entries fresh for this long or more are reference data (stations, lists of places), not what the answer measures.
const REFERENCE_SECONDS = 6 * 3600;
// The answer's own date of its data, first found (breadth first): a measurement, a model run, a bulletin, a notice.
const DATED = ["heure_mesure", "run_du_modele", "emise", "mis_a_jour", "publie_le", "derniere_analyse"];

type Payload = Record<string, unknown>;

/** The first dated field of the answer, with the age it states beside it, if any. */
function dataDate(p: Payload): { du: string; age?: string } | undefined {
  let level: unknown[] = [p];
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const next: unknown[] = [];
    for (const x of level) {
      if (!x || typeof x !== "object") continue;
      if (Array.isArray(x)) {
        next.push(...x.slice(0, 3));
        continue;
      }
      const o = x as Payload;
      for (const k of DATED) if (typeof o[k] === "string" && o[k]) return { du: o[k] as string, age: typeof o.age_texte === "string" ? o.age_texte : undefined };
      for (const [k, v] of Object.entries(o)) if (k !== "sources" && v && typeof v === "object") next.push(v);
    }
    level = next;
  }
  return undefined;
}

export function fraicheur(p: Payload, lectures: Lecture[], now: Date) {
  const live = lectures.filter((l) => l.freshSeconds < REFERENCE_SECONDS);
  const pool = live.length ? live : lectures;
  // The oldest read: the answer is at least this fresh. Without any, the data is rundata.re's own copy, read now.
  const read = pool.length ? new Date(Math.min(...pool.map((l) => l.fetchedAt))) : now;
  const data = dataDate(p);
  const stale = lectures.filter((l) => l.stale).sort((a, b) => a.fetchedAt - b.fetchedAt)[0];
  return {
    donnee_du: data?.du,
    lue_a: localTime(read),
    age: data?.age ?? (ageMinutes(read, now) < 1 ? "à l'instant" : ageText(ageMinutes(read, now))),
    copie_de_secours: stale ? true : undefined,
    avertissement: stale ? `Source injoignable : dernière valeur connue, lue le ${localTime(new Date(stale.fetchedAt))}.` : undefined,
  };
}
