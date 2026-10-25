import type { Cache, Cached } from "../cache.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import type { Fil } from "../providers/actualites.js";
import { httpUrl } from "../http.js";
import { type Evenement, type programmesSportifs, reserve, sportDesAgendas } from "../providers/agenda.js";
import * as src from "../providers/sport.js";
import * as avis from "../providers/sport-avis.js";
import { type Club, clubOf, clubsNamed, type ClubSport, zoneOf } from "../sport/clubs.js";
import { type SourceInfo, why } from "../types.js";
import { a, credits, de, notFound, placeBlock, text } from "./format.js";

export type Sport = "grand_raid" | "handball" | "volley" | "basket" | "voile" | "golf" | "sport_auto" | "football";
export type Quand = "aujourd_hui" | "demain" | "samedi" | "dimanche" | "ce_week_end" | "a_venir" | "resultats";

export const SPORTS: Sport[] = ["grand_raid", "handball", "volley", "basket", "voile", "golf", "sport_auto", "football"];
export const QUANDS: Quand[] = ["aujourd_hui", "demain", "samedi", "dimanche", "ce_week_end", "a_venir", "resultats"];
const NAMES: Record<Sport, string> = {
  grand_raid: "Grand Raid",
  handball: "handball",
  volley: "volley-ball",
  basket: "basket-ball",
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
  basket: /basket/i,
  voile: /voile|régate|regate|nautisme/i,
  golf: /golf/i,
  sport_auto: /rallye|auto|karting|sport mécanique/i,
  football: /foot|régionale 1|\bR1\b|coupe de france/i,
};
// Sports with no official source read: the news only.
const NEWS_ONLY: Partial<Record<Sport, string>> = {
  football: "Les résultats officiels du football (FFF, Ligue réunionnaise) ne sont pas lisibles par ce service.",
  basket: "Le calendrier et les résultats officiels du basket (FFBB) ne sont pas encore lus par ce service.",
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
const localClock = (d: Date) => new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 16);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** « 2026-10-30T20:30 » → « vendredi 30/10 à 20:30 » ; « 2026-10-31 » → « samedi 31/10 ». */
export function quand(local: string): string {
  const d = local.slice(0, 10);
  return `${DAYS[weekday(d)]} ${d.slice(8, 10)}/${d.slice(5, 7)}${local.length > 10 ? ` à ${local.slice(11, 16)}` : ""}`;
}
const span = (e: { debut: string; fin: string }) => (e.debut === e.fin ? quand(e.debut) : `du ${quand(e.debut)} au ${quand(e.fin)}`);

/** The days a question means: this weekend is Friday to Sunday, the coming one from Monday on; « samedi » is the next one, today included. */
export function window(q: Quand | undefined, now: Date, back = BACK_DAYS): { du: string; au: string } {
  const today = localDay(now);
  const wd = weekday(today);
  if (q === "aujourd_hui") return { du: today, au: today };
  if (q === "demain") return { du: addDays(today, 1), au: addDays(today, 1) };
  if (q === "samedi" || q === "dimanche") {
    const day = addDays(today, ((q === "samedi" ? 6 : 0) - wd + 7) % 7);
    return { du: day, au: day };
  }
  if (q === "ce_week_end") {
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
  /** The clubs in full, when the federation gives acronyms: « Volley-Ball de Saint-Pierre – Tampon Gecko Volley (2A) ». */
  equipes?: string;
  score?: string;
  detail?: string;
  lieu?: string;
  /** Where it is played: the commune of the club at home, or of the event. */
  commune?: string;
  /** A club of the place asked that plays away: « club du Tampon en déplacement ». */
  deplacement?: string;
  /** « annulée », « reportée » (a match), as its league or the news says; « annulée », « résultats publiés » (an event). */
  etat?: string;
  /** Who says it is called off, and its words. */
  selon?: string;
  lien_avis?: string;
  lien?: string;
  /** « réservé aux adhérents de <club> »: a club's session, told only to who says they are a member. */
  acces?: string;
  site_du_club?: string;
}

/** For filtering, never shown: the communes and clubs of both teams. */
interface Row extends Item {
  communes: (string | undefined)[];
  clubs: (Club | undefined)[];
}

const CLUB_SPORTS: Partial<Record<src.Championnat["sport"], ClubSport>> = { volley: "volley", handball: "handball" };
const title = (s: string) =>
  s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (x) => x.toUpperCase()).replace(/(\d) Ème\b/g, "$1e").replace(/ (De|Du|Des|D')(?=[\s\p{L}])/gu, (x) => x.toLowerCase());

/** « VBSP 2 » → « Volley-Ball de Saint-Pierre (2) ». */
function full(team: string, club: Club | undefined): string {
  if (!club?.sigle) return team;
  const rest = normalize(team).slice(normalize(club.sigle).length).trim().toUpperCase();
  return rest ? `${club.nom} (${rest})` : club.nom;
}

function matchRow(c: src.Championnat, m: src.Match, calledOff: avis.Avis[]): Row {
  const cs = CLUB_SPORTS[c.sport]!;
  const home = clubOf(cs, m.domicile);
  const away = clubOf(cs, m.exterieur);
  const salle = m.salle ? title(m.salle) : undefined;
  const off = avis.avisOf(calledOff, cs, m);
  return {
    sport: NAMES[c.sport],
    competition: c.nom,
    quand: quand(m.date),
    date: m.date,
    epreuve: `${m.domicile} – ${m.exterieur}`,
    equipes: home?.sigle || away?.sigle ? `${full(m.domicile, home)} – ${full(m.exterieur, away)}` : undefined,
    score: m.score,
    detail: m.detail,
    lieu: salle && home ? `${salle}, ${home.commune}` : salle,
    commune: home?.commune,
    etat: off ? (off.statut === "annulé" ? "annulée" : "reportée") : undefined,
    selon: off ? `${off.source}${off.reporte_au ? `, reporté au ${quand(off.reporte_au)}` : off.a_rejouer ? ", à rejouer à une date à fixer" : ""}` : undefined,
    lien_avis: off?.lien,
    lien: c.lien,
    communes: [home?.commune, away?.commune],
    clubs: [home, away],
  };
}

const eventRow = (e: src.Epreuve): Row => ({
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
  communes: [e.commune],
  clubs: [],
});

/** The sports of the tool a club's event on Sportsregions may be of (its JSON-LD `sport`). */
const SPORT_DU_CLUB: [RegExp, Sport][] = [[/^golf/i, "golf"], [/^volley/i, "volley"], [/^hand/i, "handball"], [/^voile/i, "voile"], [/^(?:sport )?auto/i, "sport_auto"]];
const sportDuClub = (s: string | undefined) => (s ? SPORT_DU_CLUB.find(([re]) => re.test(s))?.[1] : undefined);
// Sportsregions gives the event's place only when the club gave one; else the club's address, not said as its place.
const LIEU_CLUB = "non précisé (voir la page de l'événement)";

/**
 * An event a club publishes on Sportsregions: who organises it, and its place when the club gave one. Else in a commune
 * only when its title names it (the club's address is not where it is played).
 */
const clubRow = (e: Evenement): Row[] =>
  e.seances.slice(0, 1).map((s) => ({
    sport: e.organisateur?.sport?.toLowerCase() ?? "sport",
    quand: span({ debut: s.debut, fin: s.fin ?? s.debut }),
    date: s.debut,
    fin: s.fin,
    epreuve: e.titre,
    detail: e.description,
    lieu: e.lieu ?? LIEU_CLUB,
    commune: e.commune,
    etat: e.statut === "annulé" ? "annulée" : e.statut === "reporté" ? "reportée" : undefined,
    lien: e.lien,
    acces: e.reserve_adherents ? reserve(e) : undefined,
    site_du_club: e.reserve_adherents ? httpUrl(e.organisateur?.site) : undefined,
    communes: [e.commune],
    clubs: [],
  }));

const ZONE_DE: Record<string, string> = { Nord: "du Nord", Sud: "du Sud", Est: "de l'Est", Ouest: "de l'Ouest" };

/** « St Leu », « ST PIERRE » as the communes are named. */
const words = (s: string) => ` ${normalize(s).replace(/\bst\b/g, "saint").replace(/\bste\b/g, "sainte")} `;
const mentions = (item: Item, commune: string) => words(`${item.epreuve} ${item.lieu ?? ""}`).includes(words(commune));

/** What `lieu` asks: a part of the island, a club, or a place (its commune). */
type Where =
  | { kind: "communes"; label: string; communes: string[]; zone?: string; res?: ReturnType<typeof resolvePlace> }
  | { kind: "clubs"; label: string; clubs: Club[]; sport?: ClubSport };

function where(lieu: string, sport: Sport | undefined): Where | null {
  const zone = zoneOf(lieu);
  if (zone) return { kind: "communes", label: ` dans le ${zone.nom}`, communes: zone.communes, zone: zone.nom };
  const sports = sport === "volley" || sport === "handball" ? [sport] : (["volley", "handball"] as ClubSport[]);
  const named = clubsNamed(lieu, sports);
  const clubs = named.map((c) => c.club);
  if (clubs.length) {
    const one = named.every((c) => c.sport === named[0].sport) ? named[0].sport : undefined;
    return { kind: "clubs", label: ` ${clubs.map((c) => (c.sigle ? `du ${c.sigle} (${c.nom})` : `de ${c.nom}`)).join(" et ")}`, clubs, sport: one };
  }
  const res = resolvePlace(lieu);
  if (!res?.lieu.commune) return null;
  return { kind: "communes", label: ` ${a(res.lieu.commune)}`, communes: [res.lieu.commune], res };
}

/** Keeps what is played in the place asked, and the matches of its clubs elsewhere (marked). */
function keep(w: Where, r: Row): Row | undefined {
  if (w.kind === "clubs") return r.clubs.some((c) => c && w.clubs.includes(c)) ? r : undefined;
  if (r.commune && w.communes.includes(r.commune)) return r;
  const ours = r.communes.find((c) => c && w.communes.includes(c));
  if (ours) return { ...r, deplacement: `club ${de(ours)} en déplacement${r.commune ? ` ${a(r.commune)}` : ""}` };
  if (!r.commune && w.communes.some((c) => mentions(r, c))) return r;
  return undefined;
}

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
  /** The clubs' events (Sportsregions), as the scheduled event last read them, of the sport asked. */
  clubs?: Got<Evenement[]>;
  actualite: Got<src.Article[]>;
  /** The league's notices (volley). */
  avis?: Got<avis.Avis[]>;
  /** The news as last read for `actualites`, not read again for this. */
  presse?: Cached<Fil>;
  /** The communes' sports programmes, in the agendas as last read for `evenements`. */
  programmes?: Awaited<ReturnType<typeof programmesSportifs>>;
}

/** What `sport` needs, read in parallel; a source that fails is left out and named. */
export async function gather(cache: Cache, sport: Sport | undefined, now: Date, adherent = false): Promise<SportData> {
  const want = (s: Sport) => !sport || sport === s;
  const [grandRaid, handball, volley, voile, golfs, auto, actualite, notices, presse, agendas] = await Promise.all([
    want("grand_raid") ? attempt(src.SOURCES.livetrail, () => src.grandRaid(cache, now)) : undefined,
    want("handball") ? attempt(src.SOURCES.ffhb, () => src.championnats(cache, "handball")) : undefined,
    want("volley") ? attempt(src.SOURCES.ffvb, () => src.championnats(cache, "volley")) : undefined,
    want("voile") ? attempt(src.SOURCES.ffvoile, () => src.regates(cache, now)) : undefined,
    want("golf") ? attempt(src.SOURCES.ffgolf, () => src.golf(cache, now)) : undefined,
    want("sport_auto") ? attempt(src.SOURCES.lsar, () => src.sportAuto(cache)) : undefined,
    attempt(src.SOURCES.la1ere, () => src.actualite(cache)),
    want("volley") ? attempt(avis.SOURCE, () => avis.avisLigue(cache, now)) : undefined,
    want("volley") || want("handball") ? cache.peek<Fil>("actualites:fil").catch(() => undefined) : undefined,
    // The communes' programmes, of every sport, only when none is asked; the volley league's tournaments; the clubs'
    // events.
    !sport || want("volley") || SPORT_DU_CLUB.some(([, s]) => s === sport)
      ? sportDesAgendas(cache, !sport).catch((err) => (console.error("programmes sportifs : copie des agendas illisible", why(err)), undefined))
      : undefined,
  ]);
  const ligue = want("volley") ? agendas?.tournois : undefined;
  const ofSport = agendas?.clubs?.value.filter((e) => (!sport || sportDuClub(e.organisateur?.sport) === sport) && (adherent || !e.reserve_adherents));
  return {
    grandRaid,
    championnats: [handball, volley].filter((x): x is Got<src.Championnat[]> => !!x),
    epreuves: [
      voile,
      golfs,
      auto,
      ligue ? { source: src.SOURCES.lrvb_tournois, value: { ...ligue, value: ligue.value.flatMap(tournoi) } } : undefined,
    ].filter((x): x is Got<src.Epreuve[]> => !!x),
    clubs: ofSport?.length ? { source: src.SOURCES.sportsregions, value: { ...agendas!.clubs!, value: ofSport } } : undefined,
    actualite,
    avis: notices,
    presse,
    programmes: agendas?.programmes,
  };
}

/** A tournament of the volley league, as `evenements` read it: its place as the league gives it, or « à venir ». */
function tournoi(e: Evenement): src.Epreuve[] {
  return e.seances.slice(0, 1).map((s) => ({
    sport: "volley-ball" as const,
    nom: e.titre,
    debut: s.debut.slice(0, 10),
    fin: (s.fin ?? s.debut).slice(0, 10),
    lieu: e.lieu,
    commune: e.commune,
    detail: "Ligue réunionnaise de volley-ball",
    etat: e.statut === "annulé" ? ("annulée" as const) : e.statut === "reporté" ? ("reportée" as const) : undefined,
    lien: e.lien,
  }));
}

/** The Grand Raid is told around its dates (a week before to a fortnight after), or when asked. */
function grandRaidNow(g: src.GrandRaid, now: Date): boolean {
  const today = localDay(now);
  return today >= addDays(g.debut, -7) && today <= addDays(g.fin, 14);
}

/** A row of an answer, as the tool gives it. */
export type SportRow = Omit<Item, "date" | "fin">;

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

const PROGRAMMES =
  "Programme sportif de la commune : le document publié par la mairie avec les compétitions de ses clubs. rundata.re ne lit pas ce document, il en donne seulement le lien : " +
  "les matchs, les heures et les lieux sont dans le document.";

const COMMON = {
  non_couvert:
    "Football (Régionale 1 et coupes), basket, rugby, tennis et courses à pied : pas de source ouverte lisible en direct\u00a0; " +
    "l'actualité de Réunion La 1ère en donne les comptes rendus. Les heures sont celles de La Réunion.",
};
const CALLED_OFF =
  "Annulations et reports : les pages de résultats des fédérations ne les montrent pas\u00a0; ils viennent des avis de la Ligue réunionnaise de volley-ball (lrvb.re) " +
  "et de l'actualité locale, cités avec leur lien. Un jour de grève, de blocage ou d'alerte météo, vérifier auprès du club.";

/** When each source was read, and the last result it holds. */
function freshness(got: { value?: Cached<unknown>; source: SourceInfo }[]) {
  return got.flatMap((g) => {
    if (!g.value) return [];
    const champs = Array.isArray(g.value.value) && (g.value.value as { matchs?: src.Match[] }[]).every((c) => Array.isArray(c?.matchs))
      ? (g.value.value as src.Championnat[])
      : undefined;
    const last = champs?.flatMap((c) => c.matchs.filter((m) => m.score && m.date).map((m) => m.date)).sort().at(-1);
    return [{
      source: g.source.nom,
      lu: quand(localClock(g.value.fetchedAt)) + (g.value.stale ? " (dernière copie : la source ne répond pas)" : ""),
      dernier_resultat: last ? quand(last) : undefined,
    }];
  });
}

/** `adherent`: the user says they are a club's member: its sessions for the members are told too, said so. */
export async function sportTool(cache: Cache, sport?: Sport, lieu?: string, q?: Quand, now = new Date(), adherent = false) {
  let w: Where | null = null;
  if (lieu?.trim()) {
    w = where(lieu, sport);
    if (!w) return notFound(lieu);
    // A club is of one sport: only its sources are read.
    if (w.kind === "clubs" && w.sport) sport ??= w.sport;
  }
  const data = await gather(cache, sport, now, adherent);
  const got = ([data.grandRaid, ...data.championnats, ...data.epreuves, data.clubs, data.avis, data.actualite] as (Got<unknown> | undefined)[]).filter((x): x is Got<unknown> => !!x);
  const failed = got.filter((g) => !g.value).map((g) => g.source.nom);
  if (got.every((g) => !g.value)) {
    return { ...text({ erreur: "Les sources du sport ne répondent pas pour le moment.", indisponible: failed }), isError: true };
  }

  const today = localDay(now);
  const { du, au } = window(q, now, sport ? BACK_DAYS_ONE : BACK_DAYS);
  const press = avis.avisPresse(data.presse?.value.infos, now);
  const calledOff = [...(data.avis?.value?.value ?? []), ...press.avis];
  const rows: Row[] = [
    ...data.championnats.flatMap((g) => (g.value?.value ?? []).flatMap((c) => c.matchs.filter((m) => m.date).map((m) => matchRow(c, m, calledOff)))),
    ...data.epreuves.flatMap((g) => (g.value?.value ?? []).map(eventRow)),
    ...(data.clubs?.value?.value ?? []).flatMap(clubRow),
  ].flatMap((r) => {
    const k = w ? keep(w, r) : r;
    return k ? [k] : [];
  });

  const inWindow = (i: Item) => i.date.slice(0, 10) <= au && (i.fin ?? i.date).slice(0, 10) >= du;
  const aheadAll = q === "resultats" ? [] : rows
    .filter((i) => inWindow(i) && !i.score && (i.fin ?? i.date).slice(0, 10) >= today)
    .sort((x, y) => x.date.localeCompare(y.date));
  const upcoming = aheadAll.slice(0, UPCOMING_MAX);
  const results = q === "a_venir" ? [] : rows
    .filter((i) => inWindow(i) && (i.score || (i.etat === "résultats publiés" && (i.fin ?? i.date) < today)))
    .sort((x, y) => y.date.localeCompare(x.date))
    .slice(0, RESULTS_MAX);
  const strip = ({ date: _d, fin: _f, communes: _c, clubs: _k, ...i }: Row): SportRow => i;

  // The news that says competitions are called off on a day shown, without saying which: check with the club.
  const matchDays = new Set(upcoming.filter((i) => i.competition && !i.etat).map((i) => i.date.slice(0, 10)));
  const seen = new Set<string>();
  const check = press.alertes
    .filter((x) => matchDays.has(x.jour) && !seen.has(x.lien + x.jour) && seen.add(x.lien + x.jour))
    .map((x) => ({
      jour: quand(x.jour),
      titre: x.titre,
      selon: `${x.media}, ${quand(localClock(new Date(x.publie)))}`,
      lien: x.lien,
      conseil: "Des compétitions de ce jour sont annoncées reportées ou annulées, sans dire lesquelles : vérifier auprès du club.",
    }));

  const standings = sport === "handball" || sport === "volley"
    ? data.championnats.flatMap((g) => (g.value?.value ?? []).map((c) => ({ competition: `${NAMES[c.sport]}, ${c.nom}`, classement: c.classement.map((r) => `${r.place}. ${r.equipe} ${r.points} pts (${r.joues} j)`), lien: c.lien })))
    : undefined;

  // The programmes of the communes asked, or of the whole island; never those of a club, nor past ones.
  const programmes = q === "resultats" || (w && w.kind !== "communes") ? [] : (data.programmes ?? [])
    .flatMap(({ e, agenda, fetchedAt }) => {
      const s = e.seances.find((x) => x.debut.slice(0, 10) <= au && (x.fin ?? x.debut).slice(0, 10) >= (du > today ? du : today));
      const commune = e.commune ?? agenda.commune;
      if (!s || (w?.kind === "communes" && !w.communes.includes(commune ?? ""))) return [];
      return [{
        type: "programme sportif de la commune",
        commune,
        titre: e.titre,
        dates: s.fin && s.fin !== s.debut ? `du ${quand(s.debut)} au ${quand(s.fin)}` : quand(s.debut),
        lien: e.lien,
        source: e.publie_par,
        lu_le: quand(localClock(fetchedAt)),
        date: s.debut,
        agenda,
      }];
    })
    .sort((x, y) => x.date.localeCompare(y.date) || (x.commune ?? "").localeCompare(y.commune ?? "", "fr"));

  const gr = data.grandRaid?.value?.value;
  const showRaid = gr && (sport === "grand_raid" || (!sport && !w && grandRaidNow(gr, now)));

  const news = (data.actualite.value?.value ?? [])
    .filter((n) => !sport || NEWS[sport].test(`${n.rubrique ?? ""} ${n.titre}`))
    .slice(0, NEWS_MAX)
    .map((n) => ({ titre: n.titre, publie_le: quand(new Date(new Date(n.publie).getTime() + 4 * 3600_000).toISOString().slice(0, 16)), lien: n.lien }));

  const what = sport ? NAMES[sport] : "sport";
  const place = w ? w.label : " à La Réunion";
  const ahead = q === "aujourd_hui" || q === "demain" || q === "samedi" || q === "dimanche"
    ? quand(au)
    : q === "ce_week_end" ? `ce week-end (${du === au ? quand(au) : `du ${quand(du)} au ${quand(au)}`})` : `d'ici le ${quand(au)}`;
  const away = upcoming.filter((i) => i.deplacement).length;
  const here = upcoming.length - away;
  const off = upcoming.filter((i) => i.competition && (i.etat === "annulée" || i.etat === "reportée"));
  const offBy = [...new Set(off.map((i) => i.selon!.split(",")[0]))].join(", ");
  const upcomingText = [
    (here ? `${here} rendez-vous de ${what}${place} ${ahead}` : `Aucun rendez-vous de ${what} trouvé${place} ${ahead}`) +
      (aheadAll.length > upcoming.length ? ` (${aheadAll.length} en tout, les ${upcoming.length} premiers ci-dessous)` : ""),
    away ? `${away} match${away > 1 ? "s" : ""} de club${away > 1 ? "s" : ""}${w?.kind === "communes" ? ` ${w.zone ? ZONE_DE[w.zone] : de(w.communes[0])}` : ""} à l'extérieur` : "",
    !off.length ? "" : off.length === upcoming.length && off.length > 1
      ? `tous annulés ou reportés d'après ${offBy}`
      : `${off.length} annulé${off.length > 1 ? "s" : ""} ou reporté${off.length > 1 ? "s" : ""} d'après ${offBy}`,
    check.length ? "des reports sont annoncés dans l'actualité : vérifier auprès du club" : "",
  ].filter(Boolean).join("\u00a0; ");
  const resume = sport && NEWS_ONLY[sport]
    ? `${NEWS_ONLY[sport]} ${news.length ? `Les ${news.length} derniers articles de Réunion La 1ère qui en parlent sont ci-dessous.` : `Aucun article récent de Réunion La 1ère sur le ${NAMES[sport]}.`}`
    : sport === "grand_raid"
      ? gr ? `${gr.edition} : ${gr.courses.map((c) => `${c.nom} ${c.statut}${c.podium[0] ? `, vainqueur ${c.podium[0].nom} en ${c.podium[0].temps}` : ""}`).join("\u00a0; ")}.` : "Le suivi du Grand Raid ne répond pas pour le moment."
      : [
          q === "resultats" ? "" : upcomingText,
          results.length ? `${results.length} résultat${results.length > 1 ? "s" : ""} depuis le ${quand(du)}` : q === "resultats" ? `Aucun résultat de ${what}${place} depuis le ${quand(du)}` : "",
          programmes.length ? `${programmes.length} programme${programmes.length > 1 ? "s" : ""} sportif${programmes.length > 1 ? "s" : ""} de commune (${programmes.map((p) => p.commune).join(", ")}), en lien seulement` : "",
        ].filter(Boolean).join(". ") + ".";

  // The notices behind the matches called off, once each.
  const cited = calledOff
    .filter((n) => upcoming.some((i) => i.lien_avis === n.lien && n.jours.includes(i.date.slice(0, 10))))
    .filter((n, k, l) => l.findIndex((o) => o.lien === n.lien && o.extrait === n.extrait) === k)
    .map((n) => ({
      selon: n.source,
      jours: n.jours.map((d) => quand(d)),
      extrait: n.extrait,
      a_rejouer: n.reporte_au ? quand(n.reporte_au) : n.a_rejouer ? "à une date à fixer" : undefined,
      lien: n.lien,
    }));

  const used = [...new Set([...got.filter((g) => g.value).map((g) => g.source), ...programmes.map((p) => p.agenda.source)])];
  const matches = !sport || sport === "volley" || sport === "handball";
  return text({
    lieu: w?.kind === "communes" && w.res && lieu ? placeBlock(lieu, w.res) : w && lieu ? { demande: lieu, trouve: w.label.trim(), communes: w.kind === "communes" ? w.communes : undefined } : undefined,
    resume,
    periode: sport === "grand_raid" || (sport && NEWS_ONLY[sport]) ? undefined : { du: quand(du), au: quand(au) },
    a_venir: upcoming.length ? upcoming.map(strip) : undefined,
    resultats: results.length ? results.map(strip) : undefined,
    avis: cited.length ? cited : undefined,
    a_verifier: check.length ? check : undefined,
    programmes_communes: programmes.length ? programmes.map(({ date: _d, agenda: _a, ...p }) => p) : undefined,
    programmes_a_savoir: programmes.length ? PROGRAMMES : undefined,
    classements: standings,
    grand_raid: showRaid ? grandRaidRow(gr) : undefined,
    actualite: news.length ? news : undefined,
    mise_a_jour: freshness(got),
    indisponible: failed.length ? failed : undefined,
    a_savoir: w
      ? "Matchs retenus : ceux qui se jouent dans le lieu demandé (commune du club qui reçoit) et ceux de ses clubs à l'extérieur (champ « deplacement »). Les clubs sont reconnus par leur sigle (VBSP = Volley-Ball de Saint-Pierre, TGV = Tampon Gecko Volley)."
      : undefined,
    annulations: matches ? CALLED_OFF : undefined,
    ...COMMON,
    sources: credits(used),
  });
}
