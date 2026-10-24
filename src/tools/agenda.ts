import { later, left, perInvocation } from "../budget.js";
import type { Cache, Cached } from "../cache.js";
import { httpUrl } from "../http.js";
import { INSEE } from "../places/insee.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import type { Fil } from "../providers/actualites.js";
import * as src from "../providers/agenda.js";
import { THEMES, W } from "../providers/agenda-mots.js";
import { withNews } from "../providers/agenda-presse.js";
import { SOURCE as SALLES_SOURCE, titleKey } from "../providers/salles.js";
import { type SourceInfo, why } from "../types.js";
import { a, credits, de, notFound, placeBlock, text } from "./format.js";
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

const kindsOf = (text: string) => THEMES.filter((t) => t.texte.test(text)).map((t) => t.genre);
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
// copy) and one more, within the invocation's budget (budget.ts). An agenda past them is answered from its last copy,
// or named, and read by a later question.
const KEEP_LEFT = 4;

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
  // The subrequests go first to the agendas without a copy, then to the oldest.
  const age = (a: src.Agenda) => bundle.peek(key(a))?.ageMs ?? Infinity;
  const order = [...src.AGENDAS].sort((x, y) => age(y) - age(x));
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
  // An agenda no longer read is not kept.
  bundle.drop((k) => src.AGENDAS.some((a) => key(a) === k));
  const save = () => bundle.save().catch((err) => console.error("agendas : copie impossible", why(err)));
  if (pending.length) later(Promise.allSettled(pending).then(save));
  else await save();
  return src.AGENDAS.map((a) => got.find((g) => g.agenda === a)!);
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
    reporte_au: e.reporte_au ? dayText(e.reporte_au) : undefined,
    billetterie: httpUrl(e.billetterie),
    description: e.description,
    /** Absent when the source gives no http(s) link. */
    lien: httpUrl(e.lien),
    publie_par: e.publie_par,
    /** When rundata.re read the agenda this comes from. */
    lu_le: e.lu_le ? dayText(e.lu_le) : undefined,
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

// Told from the agendas read: a source taken out of AGENDAS leaves this text too.
const halls = src.AGENDAS.filter((x) => x.source === SALLES_SOURCE);
const towns = src.AGENDAS.filter((x) => x.source !== SALLES_SOURCE && x.id !== "reunion_fr");
const without = Object.keys(INSEE).filter((c) => !src.COVERED.includes(c));
/** The communes whose mairie's agenda is read, for the tool's description. */
export const MAIRIES_LUES = towns.filter((x) => x.commune && !x.couvre).map((x) => x.commune).join(", ");
export const COUVERTURE =
  `Agendas lus : ${towns.map((x) => (x.couvre ? `${x.nom} (${x.couvre.join(", ")})` : x.nom)).join(", ")} ; agenda de reunion.fr pour les grandes fêtes ` +
  `et festivals de toute l'île. Programmes des salles : ${halls.map((x) => x.nom).join(", ")}. ` +
  `Sans agenda lu (seuls les grands événements de reunion.fr) : ${without.join(", ")}` +
  `${Object.entries(src.SANS_AGENDA).filter(([c]) => without.includes(c)).map(([, why]) => ` ; ${why}`).join("")}. ` +
  "Pas encore lus : les bars et les clubs, les billetteries privées. Un événement absent ici peut quand même avoir lieu (voir le site ou la " +
  "page Facebook de la salle ou de la mairie). Chaque événement dit qui le publie, renvoie à sa page et dit quand rundata.re l'a lu.";
/** The cinemas' showtimes are on their own sites, not here. */
export const CINEMAS = [
  { nom: "Ciné Cambaie (Saint-Paul), Ciné Grand Sud (Saint-Pierre), Ciné Lacaze (Saint-Denis), Le Plaza (Saint-Louis)", lien: "https://cine-reunion.com/" },
  { nom: "Cinepalmes (Sainte-Marie)", lien: "https://iccreunion.com/" },
  { nom: "Moulin à Café (Saint-Pierre, Ravine des Cabris)", lien: "https://www.saintpierre.re/culture/arts-visuels-et-cinema/cinema-moulin-cafe" },
];
const A_SAVOIR = "Heures de La Réunion. Les dates et les prix sont ceux publiés par l'organisateur : vérifier sur la page de l'événement avant de se déplacer (annulation, météo, places). Un événement annulé ou reporté reste dans la liste avec son statut ; « complet » : plus de places en vente. Une salle sans heure (TÉAT) donne l'heure sur la page du spectacle.";

/** `listed`: how many events at most (the page lists them all). */
export async function agenda(cache: Cache, lieu?: string, quand?: string, quoi?: string, now = new Date(), listed = LISTED) {
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
  const failed = got.filter((g) => !g.value).map((g) => g.agenda.nom);
  if (got.every((g) => !g.value)) {
    return { ...text({ erreur: "Les agendas ne répondent pas pour le moment.", indisponible: failed }), isError: true };
  }

  const p = periode(quand, now);
  const what = matcher(quoi);
  // The communes' sports programmes go to the sport tool (src.programmesSportifs).
  const all = withNews(unique(got.flatMap((g) => g.value ? g.value.value.filter((e) => !src.programmeSportif(e)).map((e) => ({ ...e, lu_le: src.toLocal(g.value!.fetchedAt.toISOString()) })) : [])), news?.value.infos, now)
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
  const off = mine.filter((x) => x.e.statut === "annulé" || x.e.statut === "reporté");
  const resume = [
    n ? `${n} événement${n > 1 ? "s" : ""}${kind} ${where} ${periodText}` : `Aucun événement${kind} trouvé ${where} ${periodText}`,
    off.length ? `ATTENTION : ${off.map((x) => `« ${x.e.titre} » ${x.e.statut}${x.e.reporte_au ? ` au ${dayText(x.e.reporte_au)}` : ""}${x.e.selon ? ` (d'après ${x.e.selon.media})` : ""}`).slice(0, 4).join(", ")}` : "",
    commune && !covered ? `${src.SANS_AGENDA[commune] ?? `ni la mairie ${de(commune)} ni une salle de la commune ne publient d'agenda lisible`} : seuls les grands événements de reunion.fr y figurent` : "",
    commune && !n && all.length ? `${all.length} ailleurs sur l'île` : "",
    // Said in the summary, not only in `indisponible`: a partial list must not be read as the whole of it.
    failed.length ? `${failed.length} agenda${failed.length > 1 ? "s" : ""} non lu${failed.length > 1 ? "s" : ""} cette fois : ${failed.join(", ")} (liste peut-être incomplète, à redemander dans une minute)` : "",
  ].filter(Boolean).join(" ; ") + ".";

  const used = [...new Set(got.filter((g) => g.value).map((g) => g.agenda.source))] as SourceInfo[];
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
    couverture: COUVERTURE,
    a_savoir: A_SAVOIR,
    sources: credits(used),
  });
}
