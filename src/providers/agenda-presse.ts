/**
 * What the news says of the agenda: an event the media report cancelled or postponed (« À Saint-Pierre, le Festival
 * Mizik O Marmay est annulé, tandis qu'au Port, le concert de Cédric "Analyse" est reporté au 5 décembre ») before its
 * organiser updates its page. Read from the news already gathered (src/providers/actualites.ts), never fetched for this.
 * A false « annulé » keeps people at home for nothing, so the match is strict: a clause that says « est annulé » or
 * « est reporté » in so many words and names one commune, an event of that commune whose title's own words are in
 * that clause (not « concert » or « festival »), and a date of the event close to the news, or the new date it gives.
 */
import { normalize } from "../places/resolve.js";
import type { Info } from "./actualites.js";
import { placesIn } from "./actualites.js";
import type { Evenement } from "./agenda.js";
import { monthOf } from "./agenda-mots.js";

/** The news read: the last three days. */
const NEWS_HOURS = 72;
/** An event cancelled by the news is one that was to take place soon: from the day before the news to three weeks after. */
const BEFORE_DAYS = 1;
const AFTER_DAYS = 21;
/** Of the distinctive words of an event's title, how many the clause must name: two at least, and most of them. */
const WORDS_MIN = 2;
const SHARE_MIN = 0.6;

export interface Annonce {
  statut: "annulé" | "reporté";
  commune: string;
  /** The words of the clause, normalized. */
  mots: Set<string>;
  /** The new day, « 2026-12-05 », when the news gives it. */
  reporte_au?: string;
  media: string;
  lien: string;
  publie: string;
}

// The verb says it: « est annulé », « sont reportés », « a été annulée ». A headline that lists « annulations » does not.
const VERB = "(?:est|sont|a été|ont été|sera|seront)\\s+(?:finalement\\s+|purement et simplement\\s+)?";
const CANCELLED = new RegExp(`${VERB}annul[ée]e?s?(?![\\p{L}])`, "iu");
const POSTPONED = new RegExp(`${VERB}report[ée]e?s?(?![\\p{L}])`, "iu");
const NEW_DATE = /report[ée]e?s?\s+(?:au|à|le)\s+(?:(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+)?(\d{1,2})(?:er)?\s+(\p{L}+)(?:\s+(20\d\d))?/iu;

const MAYBE = /annul|report/i;
// Two events in one sentence are two clauses: « …est annulé, tandis qu'au Port, le concert… est reporté ».
const CLAUSES = /[.;!?…]\s+|,\s+(?=(?:tandis|alors|mais|et|quant)\b)/u;

/** Words of a title that say nothing of which event it is. */
const GENERIC = new Set([
  "concert", "concerts", "festival", "festivals", "spectacle", "spectacles", "fete", "fetes", "soiree", "soirees", "edition", "invites", "invite",
  "invitees", "ses", "son", "sa", "leurs", "avec", "les", "des", "une", "pour", "dans", "sur", "aux", "par", "live", "show", "tour", "tournee",
  "saison", "cie", "compagnie", "presente", "grand", "grande", "nouveau", "nouvelle", "annuel", "annuelle", "ville", "commune", "mairie",
  "marche", "marches", "salon", "journee", "journees", "nuit", "semaine", "week", "end", "theatre", "danse", "musique", "atelier", "ateliers",
  "exposition", "expo", "conference", "rencontre", "rencontres", "animation", "animations", "programme", "gratuit", "reunion", "ile",
  "annule", "annulee", "reporte", "reportee", "complet", "evenement", "evenements", "fest", "music", "night", "party", "club", "kabar",
]);

const words = (s: string) => normalize(s).split(" ").filter(Boolean);
/** The words that tell an event from another: not the generic ones, not the short ones, not numbers. */
export const distinctive = (titre: string) => [...new Set(words(titre).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !GENERIC.has(w)))];

const day = (iso: string) => new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The day a postponement gives, in the year of the news or the next one. */
function newDay(clause: string, publie: string): string | undefined {
  const m = NEW_DATE.exec(clause);
  const month = m && monthOf(normalize(m[2]));
  if (!m || !month) return undefined;
  const from = day(publie);
  let d = `${m[3] ?? from.slice(0, 4)}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (!m[3] && d < from) d = `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
  return Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? undefined : d;
}

/** The cancellations and postponements the news of the last three days announce, clause by clause. */
export function annonces(infos: Info[], now: Date): Annonce[] {
  const since = new Date(now.getTime() - NEWS_HOURS * 3600_000).toISOString();
  const out: Annonce[] = [];
  for (const i of infos) {
    if (i.publie < since) continue;
    const texts = [...new Set([i.titre, i.resume ?? "", ...(i.extraits ?? []).map((e) => e.texte)])];
    // Most news says neither: not cut into clauses.
    if (!texts.some((t) => MAYBE.test(t))) continue;
    const seen = new Set<string>();
    for (const clause of texts.flatMap((t) => t.split(CLAUSES))) {
      const statut = CANCELLED.test(clause) ? "annulé" : POSTPONED.test(clause) ? "reporté" : undefined;
      if (!statut || seen.has(clause)) continue;
      seen.add(clause);
      const { communes } = placesIn(clause);
      if (communes.length !== 1) continue;
      out.push({
        statut,
        commune: communes[0],
        mots: new Set(words(clause)),
        reporte_au: statut === "reporté" ? newDay(clause, i.publie) : undefined,
        media: i.media,
        lien: i.lien,
        publie: i.publie,
      });
    }
  }
  return out;
}

/** The announcement that speaks of this event, if one does beyond doubt. */
export function annonceOf(e: Evenement, list: Annonce[]): Annonce | undefined {
  if (!e.commune) return undefined;
  const own = distinctive(e.titre);
  if (own.length < WORDS_MIN) return undefined;
  return list.find((a) => {
    if (a.commune !== e.commune) return false;
    const named = own.filter((w) => a.mots.has(w)).length;
    if (named < WORDS_MIN || named / own.length < SHARE_MIN) return false;
    const from = addDays(day(a.publie), -BEFORE_DAYS);
    const to = addDays(day(a.publie), AFTER_DAYS);
    return e.seances.some((s) => {
      const d = s.debut.slice(0, 10);
      return (d >= from && d <= to) || (!!a.reporte_au && d === a.reporte_au);
    });
  });
}

/** The events, with the state the news gives those whose own page does not say it yet. */
// The announcements of the last copy of the news read: the events page asks twice per build (the fortnight, the weekend).
let memo: { key: string; list: Annonce[] } | undefined;

export function withNews(events: Evenement[], infos: Info[] | undefined, now: Date): Evenement[] {
  if (!infos?.length) return events;
  const key = `${infos.length}|${infos[0].publie}|${infos[0].lien}|${now.toISOString().slice(0, 13)}`;
  const list = memo?.key === key ? memo.list : (memo = { key, list: annonces(infos, now) }).list;
  if (!list.length) return events;
  return events.map((e) => {
    if (e.statut === "annulé" || e.statut === "reporté") return e;
    const a = annonceOf(e, list);
    return a ? { ...e, statut: a.statut, selon: { media: a.media, lien: a.lien, publie: a.publie }, ...(a.reporte_au ? { reporte_au: a.reporte_au } : {}) } : e;
  });
}
