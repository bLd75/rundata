/**
 * How fresh an answer is, the same way for every tool (added by citer.ts next to the citation): when the data was
 * measured or published when the answer says it, when rundata.re read the source, the age, and whether a source
 * that did not answer was replaced by its last copy.
 */
import { ageMinutes, ageText, localTime } from "../geo.js";
import type { Lecture } from "../lectures.js";

// Entries fresh for this long or more are reference data (stations, lists of places), not what the answer measures.
const REFERENCE_SECONDS = 6 * 3600;
// The answer's own date of its data: a measurement, a model run, a bulletin, a notice.
const DATED = ["heure_mesure", "run_du_modele", "emise", "mis_a_jour", "publie_le", "derniere_analyse"];
// Lists of notices and publications beside the data (the mairies' power cuts, the OVPF's posts, the media's
// headlines): dated, but not what the answer measures. Read last, when no other block carries a date.
const NOTICES = new Set(["sources", "serveur", "avis", "coupures_annoncees", "publications_ovpf", "alertes_precedentes", "infos", "en_direct", "prefecture", "actualites", "evenements_du_jour", "actualite"]);
// Never the answer's date, even with nothing else dated: the sources, the server, and the media's headlines beside the
// results (sport's `actualite`: a headline of 15:15 is not the age of the fixtures read at 22:58).
const BESIDE = new Set(["sources", "serveur", "actualite"]);
export const FUSEAU = "heure de La Réunion (UTC+4)";

type Payload = Record<string, unknown>;
type Dated = { du: string; cle: string; age?: string };

// The age the block states beside its date: its text, or its minutes (the production of electricite has only those).
const ageOf = (o: Payload): string | undefined =>
  typeof o.age_texte === "string" ? o.age_texte : typeof o.age_min === "number" ? (o.age_min < 1 ? "à l'instant" : ageText(o.age_min)) : undefined;

const dated = (o: Payload): Dated | undefined => {
  for (const k of DATED) if (typeof o[k] === "string" && o[k]) return { du: o[k] as string, cle: k, age: ageOf(o) };
  return undefined;
};

/** The first dated field inside `x` (breadth first, four levels), with the age it states beside it, if any. */
function dateIn(x: unknown): Dated | undefined {
  let level: unknown[] = [x];
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const next: unknown[] = [];
    for (const o of level) {
      if (!o || typeof o !== "object") continue;
      if (Array.isArray(o)) {
        next.push(...o.slice(0, 3));
        continue;
      }
      const d = dated(o as Payload);
      if (d) return d;
      for (const [k, v] of Object.entries(o as Payload)) if (!NOTICES.has(k) && v && typeof v === "object") next.push(v);
    }
    level = next;
  }
  return undefined;
}

/**
 * The date the answer gives its data: at its top level first, then block by block in the answer's own order (the
 * measurement before the forecast, the production before the power cuts), the lists of notices last.
 */
export function dataDate(p: Payload): Dated | undefined {
  const top = dated(p);
  if (top) return top;
  const blocks = Object.entries(p).filter(([, v]) => v && typeof v === "object");
  for (const [k, v] of blocks) if (!NOTICES.has(k)) {
    const d = dateIn(v);
    if (d) return d;
  }
  for (const [k, v] of blocks) if (NOTICES.has(k) && !BESIDE.has(k)) {
    const d = dateIn(v);
    if (d) return d;
  }
  return undefined;
}

/**
 * The instant a date of the answer names, Réunion time: « 25/10 02:12 », « 18/08/2026 », « vendredi 23/10 à 10:00 »,
 * « 23/10/2026 à 21:49 ». Undefined when the text has no day/month. Without a year, the latest such day not well
 * after today (a December date read in January is last year's).
 */
export function instantOf(du: string, now: Date): number | undefined {
  const m = /(\d\d)\/(\d\d)(?:\/(\d{4}))?(?:\D{1,4}(\d\d)[:h](\d\d))?/.exec(du);
  if (!m) return undefined;
  const at = (year: number) => Date.UTC(year, +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0) - 4 * 3600_000;
  const year = m[3] ? +m[3] : new Date(now.getTime() + 4 * 3600_000).getUTCFullYear();
  const t = at(year);
  return !m[3] && t > now.getTime() + 2 * 86_400_000 ? at(year - 1) : t;
}

/**
 * The age of the data from its own date, when the block states none: in days for a date without a time (« 18/08/2026 »
 * says the day, not the hour). A model run is said as the age of the computation, not of the forecast it gives.
 */
function ageFrom(data: Dated, at: number, now: Date): string {
  const minutes = ageMinutes(new Date(at), now);
  const days = Math.floor((now.getTime() + 4 * 3600_000) / 86_400_000) - Math.floor((at + 4 * 3600_000) / 86_400_000);
  const age = /\d\d[:h]\d\d/.test(data.du)
    ? (minutes < 1 ? "à l'instant" : ageText(minutes))
    : days < 1 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} jours`;
  return data.cle === "run_du_modele" ? `modèle calculé ${age} : l'âge du calcul, pas de la prévision, qui porte sur les heures à venir` : age;
}

/** A source served from its last copy (`source`, its name), or a part whose read did not succeed (no name). */
export interface CopieDeSecours {
  source?: string;
  lue_le: string;
  /** The answer also has parts of this source read at their pace: only some of what comes from it is old. */
  partielle?: true;
}

/** As said in the warning, not in the answer: `tardive`, the source did not fail, it was too slow for the answer. */
type Copie = CopieDeSecours & { tardive?: true };

/**
 * The parts served from their last copy, each source once with its oldest copy, the oldest first: named when the
 * source did not answer (its error said which, cache.ts), not when our read of it failed.
 */
function copies(pool: Lecture[], nom: (id: string) => string | undefined): Copie[] {
  // The sources also read fresh for this answer (the stations' latest slots beside their hourly rain kept from before).
  const fresh = new Set(pool.filter((l) => !l.stale && l.from).map((l) => l.from));
  const oldest = new Map<string, { source?: string; at: number; partielle: boolean; tardive: boolean }>();
  for (const l of pool.filter((l) => l.stale)) {
    const source = l.source && nom(l.source);
    // A part without a name is said for each copy: one key, one read.
    const k = source ?? `#${l.key}`;
    const was = oldest.get(k);
    // Slow only when none of its copies is one of a failure: one that did not answer is said as such.
    const tardive = !!l.tardive && (!was || was.tardive);
    if (!was || l.fetchedAt < was.at) oldest.set(k, { source, at: l.fetchedAt, partielle: !!source && fresh.has(l.source), tardive });
    else was.tardive = tardive;
  }
  return [...oldest.values()]
    .sort((a, b) => a.at - b.at)
    .map((c) => ({ ...(c.source && { source: c.source }), lue_le: localTime(new Date(c.at)), ...(c.partielle && { partielle: true as const }), ...(c.tardive && { tardive: true as const }) }));
}

// « 25/10 22:22 » as said in a sentence: « 25/10 à 22:22 », the day again only when it changes (« et à 22:22 »).
const dits = (reads: string[]) => {
  const said = reads.map((r, i) => (i && r.slice(0, 5) === reads[i - 1].slice(0, 5) ? `à ${r.slice(6)}` : `du ${r.replace(" ", " à ")}`));
  return said.length > 1 ? `${said.slice(0, -1).join(", ")} et ${said.at(-1)}` : said[0];
};
const quoted = (s: string) => `« ${s} »`;

/**
 * Marketing's words: the sources that did not answer named, each with its last read; then those too slow for the
 * answer, each in a sentence of its own; then each source only part of which is old, in a sentence of its own (it did
 * answer for the rest), or too slow for the answer for a part of it; then the parts whose read did not succeed, without
 * a cause, then those too slow; « le reste » only when every other part was read at its own pace.
 */
function avertissement(list: Copie[], rest: boolean): string {
  const named = list.filter((c) => c.source && !c.partielle && !c.tardive);
  const tardy = list.filter((c) => c.source && !c.partielle && c.tardive);
  const partial = list.filter((c) => c.partielle);
  const restText = " Le reste de la réponse est à jour.";
  const out: string[] = [];
  if (named.length === 1) out.push(`La source ${quoted(named[0].source!)} n'a pas répondu à notre dernière lecture : ce qui vient d'elle date de notre lecture ${dits([named[0].lue_le])}.`);
  // Alone, « le reste » closes the sentence of the sources (marketing).
  const closed = named.length > 1 && !tardy.length && !partial.length && list.every((c) => c.source);
  if (named.length > 1) {
    const each = named.map((c) => `${quoted(c.source!)}, lue le ${c.lue_le.replace(" ", " à ")}`).join("\u00a0; ");
    out.push(`Ces sources n'ont pas répondu à notre dernière lecture : ${each}. Ce qui vient d'elles date de ces lectures${closed && rest ? "\u00a0; le reste de la réponse est à jour." : "."}`);
  }
  for (const c of tardy) out.push(`La source ${quoted(c.source!)} a tardé à répondre : ce qui vient d'elle date de notre lecture ${dits([c.lue_le])}.`);
  for (const c of partial) {
    out.push(c.tardive
      ? `La source ${quoted(c.source!)} a tardé à répondre pour une partie de ce qui vient d'elle : cette partie date de notre lecture ${dits([c.lue_le])}.`
      : `Une partie de ce qui vient de la source ${quoted(c.source!)} date de notre lecture ${dits([c.lue_le])} : la lecture suivante n'a pas abouti.`);
  }
  // The parts without a source, those whose read failed, then those too slow for the answer, a sentence each.
  for (const late of [false, true]) {
    const these = [...new Set(list.filter((c) => !c.source && !!c.tardive === late).map((c) => c.lue_le))];
    if (!these.length) continue;
    const one = these.length === 1;
    const another = out.length ? (one ? "Une autre partie date" : "D'autres parties datent") : one ? "Une partie de cette réponse date" : "Des parties de cette réponse datent";
    const next = late ? (one ? "la lecture suivante a tardé" : "les lectures suivantes ont tardé") : one ? "la lecture suivante n'a pas abouti" : "les lectures suivantes n'ont pas abouti";
    out.push(`${another} de ${one ? "notre lecture" : "nos lectures"} ${dits(these)} : ${next}.`);
  }
  return out.join(" ") + (rest && !closed ? restText : "");
}

/** The sentence of `avertissement` for one source served from its last copy, read at `at`: for a page's copy. */
export const sourceMuette = (source: string, at: Date, tardive?: boolean) =>
  avertissement([{ source, lue_le: localTime(at), ...(tardive && { tardive: true as const }) }], false);

/**
 * `donnee`: false leaves `donnee_du` out (an answer made of many dated parts, each saying its own). `nom`: a source's
 * name from its id, for the one served from its last copy.
 */
export function fraicheur(p: Payload, lectures: Lecture[], now: Date, opts: { donnee?: boolean; nom?: (id: string) => string | undefined } = {}) {
  const live = lectures.filter((l) => l.freshSeconds < REFERENCE_SECONDS);
  const pool = live.length ? live : lectures;
  // The oldest read: the answer is at least this fresh. Without any, the data is rundata.re's own copy, read now.
  let read = pool.length ? Math.min(...pool.map((l) => l.fetchedAt)) : now.getTime();
  const data = opts.donnee === false ? undefined : dataDate(p);
  const at = data ? instantOf(data.du, now) : undefined;
  // Read before it was measured: the oldest read is another entry's (a reference, the radar). The entry that carries
  // the date was read after it: the newest read, or the date itself, never later than now.
  if (at != null && at > read) read = Math.min(Math.max(...pool.map((l) => l.fetchedAt), at), now.getTime());
  const when = new Date(read);
  // Only those the answer is about: a list of stations kept from yesterday says nothing of the measurement.
  const secours = copies(pool, opts.nom ?? (() => undefined));
  // « Le reste est à jour » only when every other entry read was within its freshness, and there is one.
  const others = pool.filter((l) => !l.stale);
  const rest = others.length > 0 && others.every((l) => now.getTime() - l.fetchedAt <= l.freshSeconds * 1000 + 60_000);
  return {
    donnee_du: data?.du,
    lue_a: localTime(when),
    fuseau: FUSEAU,
    age: data?.age ?? (data && at != null ? ageFrom(data, at, now) : ageMinutes(when, now) < 1 ? "à l'instant" : ageText(ageMinutes(when, now))),
    copies_de_secours: secours.length ? secours.map(({ tardive: _, ...c }) => c) : undefined,
    avertissement: secours.length ? avertissement(secours, rest) : undefined,
  };
}
