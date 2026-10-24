import type { Cache, Cached } from "../cache.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import * as src from "../providers/agenda.js";
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

/** What `quoi` can ask, and the words of an event that answer it. Accents matter on the event side: « marche » is a walk. */
const THEMES: { nom: string; demande: RegExp; texte: RegExp }[] = [
  { nom: "concerts et musique", demande: /concert|musique|music|maloya|sega|kabar|\bdj\b|chant|live|soiree/, texte: /concert|musique|musical|maloya|s[ée]ga|kabar|\bdj\b|orchestre|chant|chorale|\bbal\b|live|plato zartis|artiste/ },
  { nom: "marchés", demande: /marche|forain|brocante|vide grenier|braderie|foire|producteur/, texte: /marché|march[eé]s? (?:de nuit|forain|artisanal|paysan|nocturne|cr[ée]ole|de no[ëe]l)|forain|brocante|vide.grenier|braderie|foire|producteurs/ },
  { nom: "fêtes et festivals", demande: /fete|fet\b|festival|kermesse|carnaval|feu d artifice|kabar/, texte: /f[êe]te|f[èe]t\b|festival|kermesse|carnaval|feu d.artifice|som[èe]n|semaine cr[ée]ole|zourn[ée]|kabar/ },
  { nom: "spectacles", demande: /spectacle|theatre|danse|cirque|conte|humour|cinema|film/, texte: /spectacle|th[ée][âa]tre|danse|cirque|conte|humour|cin[ée]ma|projection|film/ },
  { nom: "sport", demande: /sport|course|trail|randonnee|tournoi|match|velo|dragon/, texte: /sport|course|trail|randonn[ée]e|tournoi|match|v[ée]lo|koupe|dragon boat|nage|surf/ },
  { nom: "pour les enfants", demande: /enfant|marmaille|famille|kids|jeune public|ado/, texte: /enfant|marmaille|famil|jeune public|escape game|ludique|jeux|frissons|kids/ },
  { nom: "expositions et visites", demande: /expo|musee|patrimoine|visite|galerie/, texte: /expo|mus[ée]e|patrimoine|visite|galerie/ },
  { nom: "ateliers et rencontres", demande: /atelier|conference|forum|salon|formation|permanence|rencontre/, texte: /atelier|conf[ée]rence|forum|salon|formation|permanence|rencontre|congr[èe]s/ },
];
const STOP = new Set(["des", "les", "une", "pour", "avec", "quoi", "faire", "sortir", "evenement", "evenements", "sortie", "sorties", "agenda"]);

/** How `quoi` is understood: themes, or else words that must all be in the event. */
export function matcher(quoi: string | undefined): { nom?: string; test: (e: src.Evenement) => boolean } | null {
  const q = normalize(quoi ?? "");
  if (!q) return null;
  const themes = THEMES.filter((t) => t.demande.test(q));
  const body = (e: src.Evenement) => `${e.titre} ${e.categories.join(" ")} ${e.description ?? ""} ${e.lieu ?? ""}`.toLowerCase();
  if (themes.length) return { nom: themes.map((t) => t.nom).join(", "), test: (e) => themes.some((t) => t.texte.test(body(e))) };
  const words = q.split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
  if (!words.length) return null;
  return { nom: `« ${quoi!.trim()} »`, test: (e) => words.every((w) => normalize(body(e)).includes(w)) };
}

type Got = { agenda: src.Agenda; value?: Cached<src.Evenement[]> };

/** Every agenda, read in parallel; one that fails is left out and named. */
export async function gather(cache: Cache, now: Date): Promise<Got[]> {
  return Promise.all(src.AGENDAS.map(async (agenda) => {
    try {
      return { agenda, value: await agenda.load(cache, now) };
    } catch (err) {
      console.error(`source ${agenda.source.id} (${agenda.id}) indisponible:`, why(err));
      return { agenda };
    }
  }));
}

/** The same event published twice (by the CINOR and the tourist office, or by a mairie and reunion.fr) is told once. */
export function unique(list: src.Evenement[]): src.Evenement[] {
  const out: src.Evenement[] = [];
  const seen = new Map<string, src.Evenement>();
  const key = (e: src.Evenement) => `${normalize(e.titre).slice(0, 40)}|${e.seances[0]?.debut.slice(0, 10)}`;
  const timed = (e: src.Evenement) => e.seances.some((s) => s.debut.length > 10);
  for (const e of list) {
    const same = seen.get(e.id) ?? seen.get(key(e));
    if (same && (timed(same) || !timed(e))) continue;
    // The copy with hours is the better one.
    if (same) out[out.indexOf(same)] = e;
    else out.push(e);
    for (const k of [e.id, key(e), ...(same ? [same.id, key(same)] : [])]) seen.set(k, e);
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
    description: e.description,
    lien: e.lien,
    publie_par: e.publie_par,
  };
}
export type EventRow = ReturnType<typeof eventRow>;

export const COUVERTURE =
  "Agendas lus : mairies de Saint-Paul, du Port, des Trois-Bassins, du Tampon et de Saint-Louis ; CINOR et office de tourisme du Nord " +
  "(Saint-Denis, Sainte-Marie, Sainte-Suzanne) ; agenda de reunion.fr pour les grandes fêtes et festivals de toute l'île. Les autres communes " +
  "ne publient pas d'agenda lisible : un événement absent ici peut quand même avoir lieu (voir le site ou la page Facebook de la mairie).";
const A_SAVOIR = "Heures de La Réunion. Les dates et les prix sont ceux publiés par l'organisateur : vérifier sur la page de l'événement avant de se déplacer (annulation, météo, places).";

export async function agenda(cache: Cache, lieu?: string, quand?: string, quoi?: string, now = new Date()) {
  let res: ReturnType<typeof resolvePlace> = null;
  if (lieu?.trim()) {
    res = resolvePlace(lieu);
    if (!res) return notFound(lieu);
  }
  const commune = res?.lieu.commune;
  const got = await gather(cache, now);
  const failed = got.filter((g) => !g.value).map((g) => g.agenda.nom);
  if (got.every((g) => !g.value)) {
    return { ...text({ erreur: "Les agendas ne répondent pas pour le moment.", indisponible: failed }), isError: true };
  }

  const p = periode(quand, now);
  const what = matcher(quoi);
  const all = unique(got.flatMap((g) => g.value?.value ?? []))
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
  const resume = [
    n ? `${n} événement${n > 1 ? "s" : ""}${kind} ${where} ${periodText}` : `Aucun événement${kind} trouvé ${where} ${periodText}`,
    commune && !covered ? `la mairie ${de(commune)} ne publie pas d'agenda lisible : seuls les grands événements de reunion.fr y figurent` : "",
    commune && !n && all.length ? `${all.length} ailleurs sur l'île` : "",
  ].filter(Boolean).join(" ; ") + ".";

  const used = [...new Set(got.filter((g) => g.value).map((g) => g.agenda.source))] as SourceInfo[];
  return text({
    lieu: res && lieu ? placeBlock(lieu, res) : undefined,
    resume,
    periode: { du: dayText(p.du), au: dayText(p.au), soir: p.soir || undefined },
    nombre: n,
    quand_non_compris: p.incompris ? `« ${quand} » n'a pas été compris : les deux semaines qui viennent sont données. Dire « aujourd_hui », « ce_soir », « demain », « ce_week_end », « cette_semaine », un jour (« samedi ») ou une date (« 2026-10-31 »).` : undefined,
    evenements: n ? mine.slice(0, LISTED).map((x) => eventRow(x.e, x.seances)) : undefined,
    autres: n > LISTED ? `${n - LISTED} autres événements : préciser le lieu, le jour ou le genre (quoi).` : undefined,
    ailleurs_sur_l_ile: commune && !n && all.length ? all.slice(0, ELSEWHERE_MAX).map((x) => eventRow(x.e, x.seances)) : undefined,
    indisponible: failed.length ? failed : undefined,
    couverture: COUVERTURE,
    a_savoir: A_SAVOIR,
    sources: credits(used),
  });
}
