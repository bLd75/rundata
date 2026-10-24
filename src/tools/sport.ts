import type { Cache, Cached } from "../cache.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import * as src from "../providers/sport.js";
import { type SourceInfo, why } from "../types.js";
import { a, credits, notFound, placeBlock, text } from "./format.js";

export type Sport = "grand_raid" | "handball" | "volley" | "voile" | "golf" | "sport_auto" | "football";
export type Quand = "aujourd_hui" | "ce_week_end" | "a_venir" | "resultats";

export const SPORTS: Sport[] = ["grand_raid", "handball", "volley", "voile", "golf", "sport_auto", "football"];
const NAMES: Record<Sport, string> = {
  grand_raid: "Grand Raid",
  handball: "handball",
  volley: "volley-ball",
  voile: "voile",
  golf: "golf",
  sport_auto: "sport automobile",
  football: "football",
};
// The news of a sport, by the newsroom's section or the title.
const NEWS: Record<Sport, RegExp> = {
  grand_raid: /grand raid|diagonale|trail/i,
  handball: /hand/i,
  volley: /volley/i,
  voile: /voile|régate|regate|nautisme/i,
  golf: /golf/i,
  sport_auto: /rallye|auto|karting|sport mécanique/i,
  football: /foot|régionale 1|\bR1\b|coupe de france/i,
};

const AHEAD_DAYS = 14;
const BACK_DAYS = 7;
// For one sport, back to its last round: the regional championships often pause for three weeks.
const BACK_DAYS_ONE = 30;
const UPCOMING_MAX = 40;
const RESULTS_MAX = 30;
const NEWS_MAX = 6;
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

const localDay = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** « 2026-10-30T20:30 » → « vendredi 30/10 à 20:30 » ; « 2026-10-31 » → « samedi 31/10 ». */
export function quand(local: string): string {
  const d = local.slice(0, 10);
  return `${DAYS[weekday(d)]} ${d.slice(8, 10)}/${d.slice(5, 7)}${local.length > 10 ? ` à ${local.slice(11, 16)}` : ""}`;
}
const span = (e: { debut: string; fin: string }) => (e.debut === e.fin ? quand(e.debut) : `du ${quand(e.debut)} au ${quand(e.fin)}`);

/** The days a question means: this weekend is Friday to Sunday, the coming one from Monday on. */
export function window(q: Quand | undefined, now: Date, back = BACK_DAYS): { du: string; au: string } {
  const today = localDay(now);
  if (q === "aujourd_hui") return { du: today, au: today };
  if (q === "ce_week_end") {
    const wd = weekday(today);
    const friday = wd === 0 ? addDays(today, -2) : wd === 6 ? addDays(today, -1) : addDays(today, 5 - wd);
    return { du: wd === 0 || wd === 6 ? today : friday, au: addDays(friday, 2) };
  }
  if (q === "resultats") return { du: addDays(today, -back), au: today };
  if (q === "a_venir") return { du: today, au: addDays(today, AHEAD_DAYS) };
  return { du: addDays(today, -back), au: addDays(today, AHEAD_DAYS) };
}

export interface Item {
  sport: string;
  competition?: string;
  quand: string;
  /** For sorting: local, « 2026-10-30T20:30 ». */
  date: string;
  fin?: string;
  epreuve: string;
  score?: string;
  detail?: string;
  lieu?: string;
  /** For a question about a commune. */
  commune?: string;
  etat?: string;
  lien?: string;
}

const matchItem = (c: src.Championnat, m: src.Match): Item => ({
  sport: NAMES[c.sport],
  competition: c.nom,
  quand: quand(m.date),
  date: m.date,
  epreuve: `${m.domicile} – ${m.exterieur}`,
  score: m.score,
  detail: m.detail,
  lieu: m.salle ? m.salle.toLowerCase().replace(/(^|\s)\p{L}/gu, (x) => x.toUpperCase()).replace(/(\d) Ème\b/g, "$1e") : undefined,
  lien: c.lien,
});

const eventItem = (e: src.Epreuve): Item => ({
  sport: e.sport,
  quand: span(e),
  date: e.debut,
  fin: e.fin,
  epreuve: e.nom,
  detail: e.detail,
  lieu: e.lieu,
  commune: e.commune,
  etat: e.etat,
  lien: e.lien,
});

/** « St Leu », « ST PIERRE » as the communes are named. */
const words = (s: string) => ` ${normalize(s).replace(/\bst\b/g, "saint").replace(/\bste\b/g, "sainte")} `;
const mentions = (item: Item, commune: string) => item.commune === commune || words(`${item.epreuve} ${item.lieu ?? ""}`).includes(words(commune));

type Got<T> = { value?: Cached<T>; source: SourceInfo };

async function attempt<T>(source: SourceInfo, load: () => Promise<Cached<T>>): Promise<Got<T>> {
  try {
    return { value: await load(), source };
  } catch (err) {
    console.error(`source ${source.id} indisponible:`, why(err));
    return { source };
  }
}

export interface SportData {
  grandRaid?: Got<src.GrandRaid>;
  championnats: Got<src.Championnat[]>[];
  epreuves: Got<src.Epreuve[]>[];
  actualite: Got<src.Article[]>;
}

/** What `sport` needs, read in parallel; a source that fails is left out and named. */
export async function gather(cache: Cache, sport: Sport | undefined, now: Date): Promise<SportData> {
  const want = (s: Sport) => !sport || sport === s;
  const [grandRaid, handball, volley, voile, golfs, auto, actualite] = await Promise.all([
    want("grand_raid") ? attempt(src.SOURCES.livetrail, () => src.grandRaid(cache, now)) : undefined,
    want("handball") ? attempt(src.SOURCES.ffhb, () => src.championnats(cache, "handball")) : undefined,
    want("volley") ? attempt(src.SOURCES.ffvb, () => src.championnats(cache, "volley")) : undefined,
    want("voile") ? attempt(src.SOURCES.ffvoile, () => src.regates(cache, now)) : undefined,
    want("golf") ? attempt(src.SOURCES.ffgolf, () => src.golf(cache, now)) : undefined,
    want("sport_auto") ? attempt(src.SOURCES.lsar, () => src.sportAuto(cache)) : undefined,
    attempt(src.SOURCES.la1ere, () => src.actualite(cache)),
  ]);
  return {
    grandRaid,
    championnats: [handball, volley].filter((x): x is Got<src.Championnat[]> => !!x),
    epreuves: [voile, golfs, auto].filter((x): x is Got<src.Epreuve[]> => !!x),
    actualite,
  };
}

/** The Grand Raid is told around its dates (a week before to a fortnight after), or when asked. */
function grandRaidNow(g: src.GrandRaid, now: Date): boolean {
  const today = localDay(now);
  return today >= addDays(g.debut, -7) && today <= addDays(g.fin, 14);
}

/** A row of an answer, as the tool gives it. */
export type SportRow = Omit<Item, "date" | "fin" | "commune">;

export function grandRaidRow(g: src.GrandRaid) {
  return {
    edition: g.edition,
    dates: g.debut === g.fin ? quand(g.debut) : `du ${quand(g.debut)} au ${quand(g.fin)}`,
    courses: g.courses.map((c) => ({
      course: `${c.nom} (${c.distance_km} km, ${c.denivele_m} m D+)`,
      depart: `${quand(c.depart)}, ${c.lieu_depart}`,
      statut: c.statut,
      partants: c.partants,
      arrives: c.arrives,
      abandons: c.abandons,
      en_course: c.en_course,
      podium: c.podium.length ? c.podium.map((r) => `${r.rang}. ${r.nom}${r.pays ? ` (${r.pays})` : ""} ${r.temps}`) : undefined,
      podium_femmes: c.podium_femmes.length ? c.podium_femmes.map((r) => `${r.rang}. ${r.nom}${r.pays ? ` (${r.pays})` : ""} ${r.temps}`) : undefined,
    })),
    lien: g.lien,
  };
}

const COMMON = {
  non_couvert:
    "Football (Régionale 1 et coupes), basket, rugby, tennis et courses à pied : pas de source ouverte lisible en direct ; " +
    "l'actualité de Réunion La 1ère en donne les comptes rendus. Les heures sont celles de La Réunion.",
};

export async function sportTool(cache: Cache, sport?: Sport, lieu?: string, q?: Quand, now = new Date()) {
  let commune: string | undefined;
  let res: ReturnType<typeof resolvePlace> = null;
  if (lieu?.trim()) {
    res = resolvePlace(lieu);
    if (!res) return notFound(lieu);
    commune = res.lieu.commune;
  }
  const data = await gather(cache, sport, now);
  const got: { value?: unknown; source: SourceInfo }[] = [data.grandRaid, ...data.championnats, ...data.epreuves, data.actualite].filter((x) => !!x);
  const failed = got.filter((g) => !g.value).map((g) => g.source.nom);
  if (got.every((g) => !g.value)) {
    return { ...text({ erreur: "Les sources du sport ne répondent pas pour le moment.", indisponible: failed }), isError: true };
  }

  const today = localDay(now);
  const { du, au } = window(q, now, sport ? BACK_DAYS_ONE : BACK_DAYS);
  const items: Item[] = [
    ...data.championnats.flatMap((g) => (g.value?.value ?? []).flatMap((c) => c.matchs.filter((m) => m.date).map((m) => matchItem(c, m)))),
    ...data.epreuves.flatMap((g) => (g.value?.value ?? []).map(eventItem)),
  ].filter((i) => !commune || mentions(i, commune));

  const inWindow = (i: Item) => i.date.slice(0, 10) <= au && (i.fin ?? i.date).slice(0, 10) >= du;
  const upcoming = q === "resultats" ? [] : items
    .filter((i) => inWindow(i) && !i.score && (i.fin ?? i.date).slice(0, 10) >= today)
    .sort((x, y) => x.date.localeCompare(y.date))
    .slice(0, UPCOMING_MAX);
  const results = q === "a_venir" ? [] : items
    .filter((i) => inWindow(i) && (i.score || (i.etat === "résultats publiés" && (i.fin ?? i.date) < today)))
    .sort((x, y) => y.date.localeCompare(x.date))
    .slice(0, RESULTS_MAX);
  const strip = ({ date: _d, fin: _f, commune: _c, ...i }: Item) => i;

  const standings = sport === "handball" || sport === "volley"
    ? data.championnats.flatMap((g) => (g.value?.value ?? []).map((c) => ({ competition: `${NAMES[c.sport]}, ${c.nom}`, classement: c.classement.map((r) => `${r.place}. ${r.equipe} ${r.points} pts (${r.joues} j)`), lien: c.lien })))
    : undefined;

  const gr = data.grandRaid?.value?.value;
  const showRaid = gr && (sport === "grand_raid" || (!sport && !commune && grandRaidNow(gr, now)));

  const news = (data.actualite.value?.value ?? [])
    .filter((n) => !sport || NEWS[sport].test(`${n.rubrique ?? ""} ${n.titre}`))
    .slice(0, NEWS_MAX)
    .map((n) => ({ titre: n.titre, publie_le: quand(new Date(new Date(n.publie).getTime() + 4 * 3600_000).toISOString().slice(0, 16)), lien: n.lien }));

  const what = sport ? NAMES[sport] : "sport";
  const where = commune ? ` ${a(commune)}` : " à La Réunion";
  const ahead = q === "aujourd_hui" ? quand(au) : q === "ce_week_end" ? `ce week-end (${du === au ? quand(au) : `du ${quand(du)} au ${quand(au)}`})` : `d'ici le ${quand(au)}`;
  const resume = sport === "football"
    ? `Les résultats officiels du football (FFF, Ligue réunionnaise) ne sont pas lisibles par ce service. ${news.length ? `Les ${news.length} derniers articles de Réunion La 1ère qui en parlent sont ci-dessous.` : "Aucun article récent de Réunion La 1ère sur le football."}`
    : sport === "grand_raid"
      ? gr ? `${gr.edition} : ${gr.courses.map((c) => `${c.nom} ${c.statut}${c.podium[0] ? `, vainqueur ${c.podium[0].nom} en ${c.podium[0].temps}` : ""}`).join(" ; ")}.` : "Le suivi du Grand Raid ne répond pas pour le moment."
      : [
          q === "resultats" ? "" : upcoming.length ? `${upcoming.length} rendez-vous de ${what}${where} ${ahead}` : `Aucun rendez-vous de ${what} trouvé${where} ${ahead}`,
          results.length ? `${results.length} résultat${results.length > 1 ? "s" : ""} depuis le ${quand(du)}` : q === "resultats" ? `Aucun résultat de ${what}${where} depuis le ${quand(du)}` : "",
        ].filter(Boolean).join(", ") + ".";

  const used = got.filter((g) => g.value).map((g) => g.source);
  return text({
    lieu: res && lieu ? placeBlock(lieu, res) : undefined,
    resume,
    periode: sport === "grand_raid" || sport === "football" ? undefined : { du: quand(du), au: quand(au) },
    a_venir: upcoming.length ? upcoming.map(strip) : undefined,
    resultats: results.length ? results.map(strip) : undefined,
    classements: standings,
    grand_raid: showRaid ? grandRaidRow(gr) : undefined,
    actualite: news.length ? news : undefined,
    indisponible: failed.length ? failed : undefined,
    a_savoir: commune ? "Rendez-vous retenus quand le nom de la commune figure dans l'épreuve, les équipes ou le lieu : un club qui ne porte pas ce nom n'y est pas." : undefined,
    ...COMMON,
    sources: credits(used),
  });
}
