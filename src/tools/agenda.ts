import { later, left, perInvocation } from "../budget.js";
import type { Cache, Cached } from "../cache.js";
import { httpUrl } from "../http.js";
import { INSEE } from "../places/insee.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import type { Fil } from "../providers/actualites.js";
import * as src from "../providers/agenda.js";
import { AUTORISATIONS, autorisee, nonAutorisees } from "../providers/autorisations.js";
import { names, THEMES, W } from "../providers/agenda-mots.js";
import { withNews } from "../providers/agenda-presse.js";
import { evenements as proposes, ID as PROPOSITIONS_ID } from "../providers/agenda-propositions.js";
import { SOURCE as SALLES_SOURCE, titleKey } from "../providers/salles.js";
import { type SourceInfo, why } from "../types.js";
import { a, credits, de, enumeration, notFound, placeBlock, text } from "./format.js";
import { quand as dayText } from "./sport.js";

const AHEAD_DAYS = 14;
const SOON_DAYS = 30;
const LISTED = 40;
const NEXT_MAX = 4;
const ELSEWHERE_MAX = 6;
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

const localDay = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
/** Days an occurrence spans: 0 for a single day. */
const spanDays = (s: { debut: string; fin?: string }) => (Date.parse(`${(s.fin ?? s.debut).slice(0, 10)}T00:00:00Z`) - Date.parse(`${s.debut.slice(0, 10)}T00:00:00Z`)) / 86400_000;
// Longer than this, an occurrence is a season (« ateliers en octobre », an exhibition), told after the dated events.
const LONG_DAYS = 7;

export interface Periode {
  du: string;
  au: string;
  /** Only what runs in the evening (« ce soir », « samedi soir »). */
  soir: boolean;
  /** « ce week-end », « demain » : how the answer says it. */
  nom: string;
  /** The question's `quand` was not understood, so the default period is given. */
  incompris?: boolean;
}

/**
 * The days a question means. This weekend is Friday to Sunday (Friday evening is the weekend's first outing), from
 * today when it has begun; a weekday is the next one, today included; a date is « 2026-10-31 », « 31/10 » or
 * « 31/10/2026 ». Without `quand`, the next two weeks.
 */
export function periode(q: string | undefined, now: Date): Periode {
  const today = localDay(now);
  const t = normalize(q ?? "").replace(/_/g, " ");
  const soir = /\bsoir|nuit|tonight|evening/.test(t);
  const span = (du: string, au: string, nom: string): Periode => ({ du, au, soir, nom });
  if (!t) return span(today, addDays(today, AHEAD_DAYS), "dans les deux semaines qui viennent");
  if (/aujourd|ce soir|cette nuit|today|tonight/.test(t)) return span(today, today, soir ? "ce soir" : "aujourd'hui");
  if (/apres demain/.test(t)) return span(addDays(today, 2), addDays(today, 2), soir ? "après-demain soir" : "après-demain");
  if (/demain|tomorrow/.test(t)) return span(addDays(today, 1), addDays(today, 1), soir ? "demain soir" : "demain");
  if (/week ?end/.test(t)) {
    const wd = weekday(today);
    const friday = wd === 0 ? addDays(today, -2) : wd === 6 ? addDays(today, -1) : addDays(today, 5 - wd);
    // « le week-end prochain » said from Friday on is the following one; earlier in the week, the coming one.
    if (/prochain|suivant|next/.test(t) && (wd === 5 || wd === 6 || wd === 0)) return span(addDays(friday, 7), addDays(friday, 9), "le week-end prochain");
    return span(wd === 0 || wd === 6 ? today : friday, addDays(friday, 2), "ce week-end");
  }
  if (/semaine prochaine|next week/.test(t)) {
    const monday = addDays(today, ((8 - weekday(today)) % 7) || 7);
    return span(monday, addDays(monday, 6), "la semaine prochaine");
  }
  if (/semaine|week/.test(t)) return span(today, addDays(today, (7 - weekday(today)) % 7), "cette semaine");
  if (/mois|month|a venir|prochainement|bientot|upcoming/.test(t)) return span(today, addDays(today, SOON_DAYS), "dans les trente jours qui viennent");
  const wd = DAYS.findIndex((d) => t.includes(d));
  if (wd >= 0) {
    const day = addDays(today, (wd - weekday(today) + 7) % 7);
    return span(day, day, `${dayText(day)}${soir ? " soir" : ""}`);
  }
  const iso = /(20\d\d)-(\d\d)-(\d\d)/.exec(q ?? "");
  const dm = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](20\d\d))?\b/.exec(q ?? "");
  if (iso || dm) {
    let day = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : `${dm![3] ?? today.slice(0, 4)}-${dm![2].padStart(2, "0")}-${dm![1].padStart(2, "0")}`;
    if (!iso && !dm![3] && day < today) day = `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`;
    if (!Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return span(day, day, `${dayText(day)}${soir ? " soir" : ""}`);
  }
  return { ...span(today, addDays(today, AHEAD_DAYS), "dans les deux semaines qui viennent"), incompris: true };
}

/** « samedi 24/10 de 14:00 à 18:00 », « du vendredi 23/10 au dimanche 25/10 », « mercredi 28/10 ». */
export function when(s: src.Seance): string {
  const time = (x: string) => x.slice(11, 16);
  const end = s.fin;
  if (!end) return s.debut.length > 10 ? `${dayText(s.debut.slice(0, 10))} à ${time(s.debut)}` : dayText(s.debut);
  if (end.slice(0, 10) === s.debut.slice(0, 10)) {
    return s.debut.length > 10 ? `${dayText(s.debut.slice(0, 10))} de ${time(s.debut)} à ${time(end)}` : dayText(s.debut);
  }
  const at = (x: string) => (x.length > 10 ? `${dayText(x.slice(0, 10))} à ${time(x)}` : dayText(x));
  return `du ${at(s.debut)} au ${at(end)}`;
}

// A workshop, a meeting or a talk is not a show, whatever it is about (« Atelier théâtre », « PROJET TRAIN : Atelier »).
const SHOWS = new Set(["concert", "théâtre", "danse", "humour", "cirque", "soirée"]);

const STOP = new Set(["des", "les", "une", "pour", "avec", "quoi", "faire", "sortir", "evenement", "evenements", "sortie", "sorties", "agenda"]);

/** How `quoi` is understood: themes, or else words that must all be in the event. */
// The venue's name is left out of the genre: a concert at the « Théâtre Luc Donat » is not a play.
const about = (e: src.Evenement) => `${e.titre} ${e.categories.join(" ")} ${e.description ?? ""}`.toLowerCase();
const body = (e: src.Evenement) => `${about(e)} ${e.lieu ?? ""}`.toLowerCase();
// What the title and the source's own category say comes first: « Concert » at Bisik is a concert even if the text
// mentions a dance contest.
const head = (e: src.Evenement) => `${e.titre} ${e.categories.join(" ")}`.toLowerCase();

const kindsOf = (text: string) => THEMES.filter((t) => names(t, text)).map((t) => t.genre);
/** The genres of its title, categories and first sentence, and those the rest of its text named (`themes`), in THEMES' order. */
const aboutKinds = (e: src.Evenement) => {
  const found = new Set([...kindsOf(about(e)), ...(e.themes ?? [])]);
  return THEMES.map((t) => t.genre).filter((g) => found.has(g));
};
/** Without the shows' genres when the title or the source's category say workshop, meeting or talk. */
const unlessWorkshop = (e: src.Evenement, list: string[]) => (kindsOf(head(e)).includes("atelier") ? list.filter((g) => !SHOWS.has(g)) : list);

/** The genres of an event, for the page's filter: from its title and categories, else its description. */
export function genres(e: src.Evenement): string[] {
  const own = kindsOf(head(e));
  return unlessWorkshop(e, own.length ? own : aboutKinds(e).slice(0, 2));
}

/** Every genre an event may answer to, its description included. */
const kinds = (e: src.Evenement) => new Set(unlessWorkshop(e, aboutKinds(e)));

export function matcher(quoi: string | undefined): { nom?: string; test: (e: src.Evenement) => boolean } | null {
  const q = normalize(quoi ?? "");
  if (!q) return null;
  // « spectacle » asks every kind of show; a precise word (« théâtre », « danse ») only its own.
  const themes = THEMES.filter((t) => t.demande.test(q) && (!/spectacle/.test(q) || t.demande.source.includes("spectacle")));
  const show = /spectacle/.test(q);
  const asked = new Set(themes.map((t) => t.genre));
  if (themes.length) {
    return {
      nom: show && themes.length > 1 ? "spectacles" : themes.map((t) => t.nom).join(", "),
      test: (e) => {
        const k = kinds(e);
        return [...k].some((g) => asked.has(g)) || (show && !k.has("atelier") && W("spectacles?").test(about(e)));
      },
    };
  }
  const words = q.split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
  if (!words.length) return null;
  return { nom: `« ${quoi!.trim()} »`, test: (e) => words.every((w) => normalize(body(e)).includes(w)) };
}

type Got = { agenda: src.Agenda; value?: Cached<src.Evenement[]> };

// An answer does not wait longer for the slowest of the agendas: one still loading is answered from its last copy, or
// left out and named, and stored once it lands, after the response.
const DEADLINE_MS = 5_000;
// The subrequests not to be spent on the agendas: what follows them (the news's copy, the bundle's write, the page's
// copy) and one more, within the invocation's budget (budget.ts); for a question, that one is the read of the scheduled
// event's copies in KV, once a minute. An agenda past them is answered from its last copy, or named, and read by a
// later question.
const KEEP_LEFT = 4;

// How often the scheduled event reads its agendas again, unless an agenda says otherwise (`relecture`).
const PLANNED_FRESH_SECONDS = 3600;

// When a planned agenda last failed (or found nothing where its copy had events), kept in the bundle beside its copy:
// it is not tried again before its next reading is due, rather than at each scheduled event, for a subrequest and up
// to TIMEOUT_MS each time (Saint-Joseph's site does not answer Cloudflare's addresses). In the bundle, not in memory:
// the scheduled events seldom run twice in the same isolate.
const echec = (agenda: src.Agenda) => `echec:${agenda.id}`;

/** An agenda this invocation has no subrequests left for, and of which no copy is kept. */
class Postponed extends Error {}

/** Every agenda, read in parallel, once per invocation; one that fails, is too slow or is left for later is named. */
export function gather(cache: Cache, now: Date, deadlineMs = DEADLINE_MS): Promise<Got[]> {
  return perInvocation("agenda:gather", () => read(cache, now, deadlineMs));
}

async function read(cache: Cache, now: Date, deadlineMs: number): Promise<Got[]> {
  const bundle = await cache.bundle(src.BUNDLE, src.BUNDLE_SYNC_SECONDS);
  const key = (a: src.Agenda) => `agenda:${a.id}`;
  const last = (k: string): Cached<src.Evenement[]> | undefined => {
    const e = bundle.peek(k);
    return e && { value: e.value as src.Evenement[], fetchedAt: new Date(e.fetchedAt), stale: true };
  };
  let allowed = left() - KEEP_LEFT;
  // Once the agendas' share is set: this read is KEEP_LEFT's one more.
  const planifiees = await src.planifiees(cache);
  // The subrequests go first to the agendas without a copy, then to the oldest. Those of the scheduled event are never
  // read here: their copy while young enough, else nothing, and nothing said (not this invocation's to read). Their
  // copies are in KV (src.PLANIFIES), written by the scheduled event only.
  const age = (a: src.Agenda) => bundle.peek(key(a))?.ageMs ?? Infinity;
  const order = src.AGENDAS.filter((a) => !a.planifie).sort((x, y) => age(y) - age(x));
  const planned = src.AGENDAS.filter((a) => a.planifie).map((agenda): Got => ({ agenda, value: src.copiePlanifiee(planifiees, agenda) }));
  const store = (a: src.Agenda): src.AgendaStore => ({
    get: <T>(k: string, freshSeconds: number, load: () => Promise<T>) => {
      const hit = bundle.peek(k);
      if (hit && hit.ageMs < freshSeconds * 1000) return bundle.get(k, freshSeconds, load);
      if ((a.requetes ?? 1) <= allowed) {
        allowed -= a.requetes ?? 1;
        return bundle.get(k, freshSeconds, load);
      }
      const old = last(k);
      return old ? Promise.resolve(old as Cached<T>) : Promise.reject(new Postponed(a.nom));
    },
  });
  const pending: Promise<unknown>[] = [];
  const got = await Promise.all(order.map(async (agenda): Promise<Got> => {
    const loading = agenda.load(store(agenda), now);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), deadlineMs)));
    try {
      const got = await Promise.race([loading, late]);
      if (got !== "late") return { agenda, value: got };
      // Still stored once it lands: the next question has it.
      pending.push(loading.catch((err) => console.error(`source ${agenda.source.id} (${agenda.id}) indisponible:`, why(err))));
      const old = last(key(agenda));
      console.error(`source ${agenda.source.id} (${agenda.id}) trop lente${old ? " : dernière copie" : ""}`);
      return { agenda, value: old };
    } catch (err) {
      if (err instanceof Postponed) console.error(`source ${agenda.source.id} (${agenda.id}) remise à plus tard : plus assez de sous-requêtes`);
      else console.error(`source ${agenda.source.id} (${agenda.id}) indisponible:`, why(err));
      return { agenda };
    } finally {
      clearTimeout(timer);
    }
  }));
  // An agenda no longer read here is not kept (nor the scheduled event's copies, once kept in this bundle).
  bundle.drop((k) => src.AGENDAS.some((a) => !a.planifie && key(a) === k));
  const save = () => bundle.save().catch((err) => console.error("agendas : copie impossible", why(err)));
  if (pending.length) later(Promise.allSettled(pending).then(save));
  else await save();
  // As their sites' terms ask (the scheduled event's copies are already, by src.copiePlanifiee).
  const served = got.map((g) => (g.value ? { ...g, value: { ...g.value, value: src.servis(g.agenda, g.value.value) } } : g));
  return src.AGENDAS.map((a) => [...served, ...planned].find((g) => g.agenda === a)!);
}

/**
 * The scheduled event's last part: the agendas read only there (`planifie`) whose copy is an hour old (or as old as
 * their `relecture`), each only if what is left pays for its reading and the bundle's write; the bundle (in KV,
 * src.PLANIFIES) written once, and only if one was read or failed. A reading that fails, or that finds nothing where the
 * copy had events, keeps the copy and its time, and is not tried again before the agenda's next reading is due, in
 * whatever isolate the next scheduled events run.
 */
export async function refreshPlanned(cache: Cache, now = new Date()): Promise<{ lus: string[]; gardes: string[]; reportes: string[]; trop_vieilles: string[] }> {
  // `trop_vieilles`: not read again this time, and their copy, older than PLANIFIE_MAX_AGE_SECONDS, no longer served.
  const out = { lus: [] as string[], gardes: [] as string[], reportes: [] as string[], trop_vieilles: [] as string[] };
  const planned = src.AGENDAS.filter((a) => a.planifie);
  // The bundle's read (unless this invocation has it already), one agenda's reading, the write.
  if (!planned.length || left() - KEEP_LEFT < 3) {
    out.reportes = planned.map((a) => a.id);
    return out;
  }
  const bundle = await src.planifiees(cache);
  const direct: src.AgendaStore = { get: async (_k, _s, load) => ({ value: await load(), fetchedAt: now, stale: false }) };
  for (const agenda of planned) {
    const old = bundle.peek(`agenda:${agenda.id}`);
    const every = (agenda.relecture ?? PLANNED_FRESH_SECONDS) * 1000;
    if (old && old.ageMs < every) continue;
    const failed = bundle.peek(echec(agenda));
    if (failed && failed.ageMs < every) continue;
    if (left() - KEEP_LEFT - 1 < (agenda.requetes ?? 1)) {
      out.reportes.push(agenda.id);
      continue;
    }
    try {
      const { value } = await agenda.load(direct, now);
      if (!value.length && (old?.value as src.Evenement[] | undefined)?.length) {
        console.error(`source ${agenda.source.id} (${agenda.id}) : aucun événement, la copie est gardée`);
        out.gardes.push(agenda.id);
        bundle.set(echec(agenda), true);
        continue;
      }
      bundle.set(`agenda:${agenda.id}`, value);
      out.lus.push(agenda.id);
      bundle.drop((k) => k !== echec(agenda));
    } catch (err) {
      console.error(`source ${agenda.source.id} (${agenda.id}) indisponible, la copie est gardée:`, why(err));
      out.gardes.push(agenda.id);
      bundle.set(echec(agenda), true);
    }
  }
  for (const agenda of planned) {
    const old = bundle.peek(`agenda:${agenda.id}`);
    if (!out.lus.includes(agenda.id) && old && old.ageMs > src.PLANIFIE_MAX_AGE_SECONDS * 1000) {
      console.error(`source ${agenda.source.id} (${agenda.id}) : copie trop vieille (${Math.round(old.ageMs / 3600_000)} h), plus servie`);
      out.trop_vieilles.push(agenda.id);
    }
  }
  if (out.lus.length || out.gardes.length) await bundle.save();
  return out;
}

/**
 * After its author called off, postponed or changed the public contact of an event they proposed: the copy of the
 * proposed events written again at once, so that the answers say it now rather than within the quarter of an hour.
 * The bundle's read, the table's, the write.
 */
export async function rafraichirPropositions(cache: Cache, now = new Date()): Promise<void> {
  const bundle = await cache.bundle(src.BUNDLE, src.BUNDLE_SYNC_SECONDS);
  bundle.set(`agenda:${PROPOSITIONS_ID}`, await proposes(now));
  await bundle.save();
}

/**
 * The same event published twice (by the CINOR and the tourist office, a mairie and reunion.fr, a hall and the town)
 * is told once: same first words of the title (« CÉDRIC "ANALYSE" & SES INVITÉS », « Cédric « Analyse » et ses
 * invités ») on the same day, in the same commune when both say it.
 */
export function unique(list: src.Evenement[]): src.Evenement[] {
  const out: src.Evenement[] = [];
  const seen = new Map<string, src.Evenement>();
  const key = (e: src.Evenement) => `${titleKey(e.titre)}|${e.seances[0]?.debut.slice(0, 10)}`;
  const timed = (e: src.Evenement) => e.seances.some((s) => s.debut.length > 10);
  const better = (x: src.Evenement, y: src.Evenement) => Number(timed(x)) - Number(timed(y)) || Number(!!x.lieu) - Number(!!y.lieu);
  for (const e of list) {
    const same = seen.get(e.id) ?? seen.get(key(e));
    if (same && same.commune && e.commune && same.commune !== e.commune && same.id !== e.id) {
      out.push(e);
      seen.set(e.id, e);
      continue;
    }
    if (same && better(e, same) <= 0) {
      // Kept: the better copy, with what the other one knows of its state.
      if (e.statut && !same.statut) out[out.indexOf(same)] = { ...same, statut: e.statut };
      continue;
    }
    if (same) out[out.indexOf(same)] = { ...e, statut: e.statut ?? same.statut };
    else out.push(e);
    for (const k of [e.id, key(e), ...(same ? [same.id, key(same)] : [])]) seen.set(k, out.find((x) => x.id === e.id) ?? e);
  }
  return out;
}

/** The occurrences of an event in the period, not over yet. */
export function inPeriod(e: src.Evenement, p: Periode, now: Date): src.Seance[] {
  const here = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 16);
  return e.seances.filter((s) => {
    const end = s.fin ?? s.debut;
    if (s.debut.slice(0, 10) > p.au || end.slice(0, 10) < p.du) return false;
    if (end.length > 10 ? end < here : end < here.slice(0, 10)) return false;
    // In the evening: what starts from 17:00 or ends after 19:00; a day without hours, or a fête of a few days, may be.
    if (p.soir && spanDays(s) > LONG_DAYS) return false;
    if (p.soir && s.debut.length > 10 && end.slice(0, 10) === s.debut.slice(0, 10)) return s.debut.slice(11) >= "17:00" || end.slice(11) >= "19:00";
    return true;
  }).sort((x, y) => x.debut.localeCompare(y.debut));
}

export function eventRow(e: src.Evenement, seances: src.Seance[]) {
  const [first, ...others] = seances;
  return {
    titre: e.titre,
    quand: when(first),
    /** Local, « 2026-10-24T14:00 » or « 2026-10-24 ». */
    date: first.debut,
    autres_dates: others.length ? others.slice(0, NEXT_MAX).map(when).concat(others.length > NEXT_MAX ? [`et ${others.length - NEXT_MAX} autres`] : []) : undefined,
    lieu: e.lieu,
    commune: e.commune,
    prix: e.prix,
    categories: e.categories.length ? e.categories : undefined,
    genres: genres(e),
    statut: e.statut === "annulé" ? "ANNULÉ" : e.statut === "reporté" ? "REPORTÉ" : e.statut === "complet" ? "complet" : undefined,
    /** « d'après Imaz Press » when the news says it and the organiser's page does not yet. */
    statut_d_apres: e.selon ? { media: e.selon.media, lien: e.selon.lien } : undefined,
    /** A club's session for its members, told only to who says they are one. */
    acces: e.reserve_adherents ? src.reserve(e) : undefined,
    site_du_club: e.reserve_adherents ? httpUrl(e.organisateur?.site) : undefined,
    reporte_au: e.reporte_au ? dayText(e.reporte_au) : undefined,
    billetterie: httpUrl(e.billetterie),
    description: e.description,
    /** The children's ages the organiser gives, in its words: « dès 10 ans ». */
    age: e.age,
    /** Absent when the source gives no http(s) link. */
    lien: httpUrl(e.lien),
    publie_par: e.publie_par,
    /** When rundata.re read the agenda this comes from; not for an event its organiser proposed, never read elsewhere. */
    lu_le: e.lu_le && !e.propose ? dayText(e.lu_le) : undefined,
    /** « site de la commune du Tampon, lu le samedi 24/10 à 08:00 », when it comes from a commune's site. */
    source: e.site_commune && e.lu_le ? `${e.site_commune}, lu le ${dayText(e.lu_le)}` : undefined,
    /** Proposed by its organiser on rundata.re: said so, with the day, never « checked ». */
    propose: e.propose ? `Proposé par l'organisateur sur rundata.re le ${e.propose.le.split("-").reverse().join("/")}` : undefined,
    /** The contact its author chose to show, only then. */
    contact: e.propose?.contact,
  };
}
export type EventRow = ReturnType<typeof eventRow>;

interface Occurrence {
  du: string;
  au: string;
  /** « 19:30 » when the source gives it. */
  debut?: string;
  fin?: string;
  /** As the agenda writes it: « samedi 24/10 de 14:00 à 18:00 ». */
  quand: string;
}

/**
 * The dates of a row as the agenda writes them (tools/agenda.ts `when`): its first one, and the others it lists.
 * « samedi 24/10 à 19:30 », « samedi 24/10 de 14:00 à 18:00 », « du vendredi 23/10 à 19:00 au dimanche 25/10 ».
 */
export function occurrences(r: Pick<EventRow, "date" | "quand" | "autres_dates">): Occurrence[] {
  const year = Number(r.date.slice(0, 4));
  const first = r.date.slice(5, 10);
  const day = (dd: string, mm: string) => `${year + (`${mm}-${dd}` < first ? 1 : 0)}-${mm}-${dd}`;
  const DAY = String.raw`\S+ (\d\d)\/(\d\d)`;
  const read = (q: string): Occurrence | undefined => {
    let m = new RegExp(`^du ${DAY}(?: à (\\d\\d:\\d\\d))? au ${DAY}(?: à (\\d\\d:\\d\\d))?$`).exec(q);
    if (m) return { du: day(m[1], m[2]), debut: m[3], au: day(m[4], m[5]), fin: m[6], quand: q };
    m = new RegExp(`^${DAY}(?: à (\\d\\d:\\d\\d)| de (\\d\\d:\\d\\d) à (\\d\\d:\\d\\d))?$`).exec(q);
    if (m) return { du: day(m[1], m[2]), au: day(m[1], m[2]), debut: m[3] ?? m[4], fin: m[5], quand: q };
    return undefined;
  };
  return [r.quand, ...(r.autres_dates ?? [])].map(read).filter((o): o is Occurrence => !!o);
}

const dayMonth = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const its = (commune: string) => `les ${AUTORISATIONS[commune].publie} qu'elle y publie`;

/**
 * Said instead of a commune's events while its site's terms forbid taking its information and it has not agreed
 * (src/providers/autorisations.ts), in marketing's words: undefined for any other commune. The day it was asked, or
 * refused, only once known; nothing said of a request before it has gone.
 */
export function mentionCommune(commune: string | undefined): string | undefined {
  if (!commune || autorisee(commune)) return undefined;
  const au = AUTORISATIONS[commune];
  if (au.etat === "refusee") return `La commune ${de(commune)} a refusé${au.refusee_le ? `, le ${dayMonth(au.refusee_le)},` : ""} que rundata.re reprenne le contenu de son site : ${its(commune)} ne s'affichent donc pas ici.`;
  const first = `Les mentions légales du site de la commune ${de(commune)} interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas ${its(commune)}.`;
  return au.etat === "demandee" ? `${first} Nous lui avons demandé cet accord${au.demandee_le ? ` le ${dayMonth(au.demandee_le)}` : ""} et attendons sa réponse.` : first;
}

/**
 * The same in a few words (marketing): for the commune page's tile of outings, `valeur` and `detail` when it has no
 * event from elsewhere, `tete` before the next one's when it has; `resume` for the tool's summary.
 */
export function mentionCourte(commune: string): { valeur: string; detail: string; tete: string; resume: string } | undefined {
  if (autorisee(commune)) return undefined;
  const au = AUTORISATIONS[commune];
  const news = au.publie === "actualités";
  const asked = au.etat !== "demandee" ? "" : au.demandee_le ? `, demandé le ${dayMonth(au.demandee_le)}` : ", que nous lui avons demandé";
  const detail = au.etat === "refusee" ? `elle a refusé${au.refusee_le ? ` le ${dayMonth(au.refusee_le)}` : ""}` : `ses mentions légales l'interdisent sans son accord${asked}`;
  return {
    valeur: news ? "Actualités non reprises" : "Agenda non repris",
    detail,
    tete: news ? "Actualités communales non reprises" : "Agenda communal non repris",
    resume: `${news ? "actualités du site de la commune non reprises" : "agenda du site de la commune non repris"}, ${detail} (voir non_repris)`,
  };
}

/**
 * The same for the whole island, in one block for the communes still waiting (with the day they were asked when it is
 * the same for all), then a line for each one asked on another day, and for each one that refused.
 */
export function mentionIle(): string[] {
  const waiting = nonAutorisees().filter((c) => AUTORISATIONS[c].etat !== "refusee");
  const refused = nonAutorisees().filter((c) => AUTORISATIONS[c].etat === "refusee");
  const lines: string[] = [];
  if (waiting.length === 1) lines.push(mentionCommune(waiting[0])!);
  else if (waiting.length) {
    const kinds = ["événements", "actualités"].filter((k) => waiting.some((c) => AUTORISATIONS[c].publie === k)).join(" et ");
    const days = new Set(waiting.map((c) => (AUTORISATIONS[c].etat === "demandee" ? AUTORISATIONS[c].demandee_le ?? "" : undefined)));
    const day = days.size === 1 ? [...days][0] : undefined;
    lines.push(`Les mentions légales des sites de ${waiting.length} communes interdisent d'en reprendre le contenu sans leur accord : ${enumeration(waiting)}. rundata.re n'affiche donc pas les ${kinds} qu'elles y publient.` +
      (day !== undefined ? ` Nous leur avons demandé cet accord${day ? ` le ${dayMonth(day)}` : ""} et attendons leur réponse.` : ""));
    if (day === undefined) lines.push(...waiting.filter((c) => AUTORISATIONS[c].etat === "demandee").map((c) => mentionCommune(c)!));
  }
  return [...lines, ...refused.map((c) => mentionCommune(c)!)];
}

// Told from the agendas read: a source taken out of AGENDAS leaves this text too.
const halls = src.AGENDAS.filter((x) => x.source === SALLES_SOURCE);
const towns = src.AGENDAS.filter((x) => x.source !== SALLES_SOURCE && x.id !== "reunion_fr" && x.id !== PROPOSITIONS_ID && !x.partiel);
const partial = src.AGENDAS.filter((x) => x.partiel);
// Not those whose site is not read until they agree: said apart (mentionIle).
const without = Object.keys(INSEE).filter((c) => !src.COVERED.includes(c) && autorisee(c));
/** The communes whose mairie's agenda is read, for the tool's description. */
export const MAIRIES_LUES = towns.filter((x) => x.commune && !x.couvre).map((x) => x.commune).join(", ");
export const COUVERTURE =
  `Agendas lus : ${towns.map((x) => (x.couvre ? `${x.nom} (${x.couvre.join(", ")})` : x.nom)).join(", ")}\u00a0; agenda de reunion.fr pour les grandes fêtes ` +
  `et festivals de toute l'île. Programmes des salles : ${halls.map((x) => x.nom).join(", ")}. ` +
  (partial.length ? `Actualités des mairies, pour les seuls événements qu'elles annoncent avec leur date (pas un agenda complet) : ${partial.map((x) => x.commune).join(", ")}. ` : "") +
  `Sans agenda lu (seuls les grands événements de reunion.fr) : ${without.join(", ")}` +
  `${Object.entries(src.SANS_AGENDA).filter(([c]) => without.includes(c)).map(([, why]) => `\u00a0; ${why}`).join("")}. ` +
  (mentionIle().length ? `${mentionIle().join(" ")} ` : "") +
  "Aussi : les événements que les clubs et associations proposent sur rundata.re (https://rundata.re/associations), relus avant publication. " +
  "Pas encore lus : les bars et les clubs, les billetteries privées. Un événement absent ici peut quand même avoir lieu (voir le site ou la " +
  "page Facebook de la salle ou de la mairie). Chaque événement dit qui le publie, renvoie à sa page et dit quand rundata.re l'a lu.";
/** The cinemas' showtimes are on their own sites, not here. */
export const CINEMAS = [
  { nom: "Ciné Cambaie (Saint-Paul), Ciné Grand Sud (Saint-Pierre), Ciné Lacaze (Saint-Denis), Le Plaza (Saint-Louis)", lien: "https://cine-reunion.com/" },
  { nom: "Cinepalmes (Sainte-Marie)", lien: "https://iccreunion.com/" },
  { nom: "Moulin à Café (Saint-Pierre, Ravine des Cabris)", lien: "https://www.saintpierre.re/culture/arts-visuels-et-cinema/cinema-moulin-cafe" },
];
const A_SAVOIR = "Heures de La Réunion. Les dates et les prix sont ceux publiés par l'organisateur : vérifier sur la page de l'événement avant de se déplacer (annulation, météo, places). Un événement annulé ou reporté reste dans la liste avec son statut\u00a0; « complet » : plus de places en vente. Une salle sans heure (TÉAT) donne l'heure sur la page du spectacle. Les matchs des clubs et les programmes sportifs des communes : l'outil sport.";

/** `listed`: how many events at most (the page lists them all). */
/** `adherent`: the user says they are a club's member: its sessions for the members are told too, said so. */
export async function agenda(cache: Cache, lieu?: string, quand?: string, quoi?: string, now = new Date(), listed = LISTED, adherent = false) {
  let res: ReturnType<typeof resolvePlace> = null;
  if (lieu?.trim()) {
    res = resolvePlace(lieu);
    if (!res) return notFound(lieu);
  }
  const commune = res?.lieu.commune;
  const got = await gather(cache, now);
  // The news already read (the page /actualites, the tool actualites), for the cancellations it reports: never fetched
  // for this, read once per invocation (the page asks twice), and after the agendas, so as not to take one's subrequest.
  const news = await perInvocation("agenda:actualites", () => cache.peek<Fil>("actualites:fil").catch(() => undefined));
  const failed = got.filter((g) => !g.value && !g.agenda.planifie).map((g) => g.agenda.nom);
  // The proposed events alone are not an agenda that answers: there may be none.
  if (got.every((g) => !g.value || (g.agenda.id === PROPOSITIONS_ID && !g.value.value.length))) {
    return { ...text({ erreur: "Les agendas ne répondent pas pour le moment.", indisponible: failed }), isError: true };
  }

  const p = periode(quand, now);
  const what = matcher(quoi);
  // The communes' sports programmes go to the sport tool (src.programmesSportifs).
  const all = withNews(unique(got.flatMap((g) => g.value ? g.value.value.filter((e) => !src.programmeSportif(e) && (adherent || !e.reserve_adherents)).map((e) => ({ ...e, lu_le: src.toLocal(g.value!.fetchedAt.toISOString()), site_commune: g.agenda.site_commune })) : [])), news?.value.infos, now)
    .map((e) => ({ e, seances: inPeriod(e, p, now) }))
    .filter((x) => x.seances.length && (!what || what.test(x.e)))
    .sort((x, y) => Number(spanDays(x.seances[0]) > LONG_DAYS) - Number(spanDays(y.seances[0]) > LONG_DAYS) ||
      x.seances[0].debut.localeCompare(y.seances[0].debut) || x.e.titre.localeCompare(y.e.titre, "fr"));
  const mine = commune ? all.filter((x) => x.e.commune === commune) : all;

  const periodText = p.du === p.au ? p.nom : `${p.nom} (du ${dayText(p.du)} au ${dayText(p.au)})`;
  const where = commune ? a(commune) : "à La Réunion";
  const kind = what?.nom ? ` (${what.nom})` : "";
  const n = mine.length;
  const covered = !commune || src.COVERED.includes(commune);
  // A commune read only through its mairie's news: said, so that a short list is not taken for its whole agenda.
  const partly = commune ? partial.find((x) => x.commune === commune && !towns.some((y) => (y.couvre ?? [y.commune]).includes(commune))) : undefined;
  const off = mine.filter((x) => x.e.statut === "annulé" || x.e.statut === "reporté");
  const nonRepris = commune ? mentionCommune(commune) : mentionIle().join(" ") || undefined;
  const resume = [
    n ? `${n} événement${n > 1 ? "s" : ""}${kind} ${where} ${periodText}` : `Aucun événement${kind} trouvé ${where} ${periodText}`,
    off.length ? `ATTENTION : ${off.map((x) => `« ${x.e.titre} » ${x.e.statut}${x.e.reporte_au ? ` au ${dayText(x.e.reporte_au)}` : ""}${x.e.selon ? ` (d'après ${x.e.selon.media})` : ""}`).slice(0, 4).join(", ")}` : "",
    commune && nonRepris ? mentionCourte(commune)!.resume : "",
    commune && !covered ? (nonRepris ? "seuls les grands événements de reunion.fr y figurent" : `${src.SANS_AGENDA[commune] ?? `ni la mairie ${de(commune)} ni une salle de la commune ne publient d'agenda lisible`} : seuls les grands événements de reunion.fr y figurent`) : "",
    partly ? `${commune} : ${partly.partiel}, avec les grands événements de reunion.fr` : "",
    commune && !n && all.length ? `${all.length} ailleurs sur l'île` : "",
    // Said in the summary, not only in `indisponible`: a partial list must not be read as the whole of it.
    failed.length ? `${failed.length} agenda${failed.length > 1 ? "s" : ""} non lu${failed.length > 1 ? "s" : ""} cette fois : ${failed.join(", ")} (liste peut-être incomplète, à redemander dans une minute)` : "",
  ].filter(Boolean).join("\u00a0; ") + ".";

  const used = [...new Set(got.filter((g) => g.value && (g.agenda.id !== PROPOSITIONS_ID || g.value.value.length)).map((g) => g.agenda.source))] as SourceInfo[];
  return text({
    lieu: res && lieu ? placeBlock(lieu, res) : undefined,
    resume,
    periode: { du: dayText(p.du), au: dayText(p.au), soir: p.soir || undefined },
    nombre: n,
    quand_non_compris: p.incompris ? `« ${quand} » n'a pas été compris : les deux semaines qui viennent sont données. Dire « aujourd_hui », « ce_soir », « demain », « ce_week_end », « cette_semaine », un jour (« samedi ») ou une date (« 2026-10-31 »).` : undefined,
    evenements: n ? mine.slice(0, listed).map((x) => eventRow(x.e, x.seances)) : undefined,
    autres: n > listed ? `${n - listed} autres événements : préciser le lieu, le jour ou le genre (quoi).` : undefined,
    ailleurs_sur_l_ile: commune && !n && all.length ? all.slice(0, ELSEWHERE_MAX).map((x) => eventRow(x.e, x.seances)) : undefined,
    cinemas: what?.nom?.includes("cinéma") || /cin[ée]|film/i.test(quoi ?? "") ? { seances: "Les séances des cinémas sont sur leurs sites :", salles: CINEMAS } : undefined,
    indisponible: failed.length ? failed : undefined,
    // Where a commune's site is not read until it agrees: to be said with the answer.
    non_repris: nonRepris,
    couverture: COUVERTURE,
    a_savoir: A_SAVOIR,
    sources: credits(used),
  });
}
