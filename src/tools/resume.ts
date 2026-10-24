/**
 * « Résumé du jour » for a place (resume_du_jour): the weather measured now and forecast for today, the vigilance, the
 * sea, the electricity, the roads and the news of the commune, its water cuts and its events of the day, its town hall
 * and its sun, in one call. Cut from the copies the site's pages keep (web/site.ts): only read, never built while the
 * call waits, so a call costs a dozen reads at most. A part without a recent copy is left out and named in
 * `non_inclus`, with the tool that answers it; the oldest of them is brought up to date after the answer when what
 * its build took last time is left of the invocation's subrequests.
 */
import { costOf, left, measured } from "../budget.js";
import type { Cache, Cached } from "../cache.js";
import { distributeur } from "../eau/distributeurs.js";
import { localTime } from "../geo.js";
import { noteLecture } from "../lectures.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import * as cal from "../providers/calendrier.js";
import * as mf from "../providers/vigilance.js";
import { why } from "../types.js";
import {
  type ActualitesAnswer,
  type AgendaAnswer,
  type AirAnswer,
  type Background,
  buildActualites,
  buildAgenda,
  buildAir,
  buildCalendrier,
  buildCommune,
  buildCoupures,
  buildElectricite,
  buildPlace,
  buildSea,
  buildTrafic,
  type CalendrierAnswer,
  type CommuneData,
  type CoupuresAnswer,
  type Credit,
  type ElectriciteAnswer,
  FRESH_SECONDS,
  type PlaceData,
  type SeaData,
  type TraficAnswer,
} from "../web/data.js";
import { coastal, PAGES, type PlacePage } from "../web/places.js";
import { occurrences } from "./agenda.js";
import { hoursOn, openNow } from "./annuaire.js";
import { a, credits, notFound, placeBlock, text } from "./format.js";
import { current, cyclone, highest, raised } from "./vigilance.js";

/** The copies a summary is cut from, each null or missing when there is none recent enough. */
export interface ResumeCopies {
  meteo?: Cached<PlaceData> | null;
  commune?: Cached<CommuneData> | null;
  vigilance?: Cached<mf.Vigilance> | null;
  air?: Cached<AirAnswer> | null;
  mer?: Cached<SeaData> | null;
  electricite?: Cached<ElectriciteAnswer> | null;
  actualites?: Cached<ActualitesAnswer> | null;
  trafic?: Cached<TraficAnswer> | null;
  coupures?: Cached<CoupuresAnswer> | null;
  agenda?: Cached<AgendaAnswer> | null;
  calendrier?: Cached<CalendrierAnswer> | null;
}
type Part = Exclude<keyof ResumeCopies, "vigilance">;
/** A part left out of the summary, why, and the tool that answers it. */
export interface LeftOut {
  partie: string;
  raison: string;
  outil: string;
}

interface Copy {
  key: string;
  build: (cache: Cache, now: Date) => Promise<unknown>;
  /** How old a copy may be and still say something of today, in minutes. */
  max: number;
  /** A copy of another day says nothing of today: an air index, the events, the holidays. */
  sameDay?: boolean;
  /** What the part is, for `non_inclus`, and the tool that answers it. */
  nom: string;
  outil: string;
}

const H = 60;
const SEA = "température de la mer";

/** The copies of the commune's summary, for a place with its own weather page or not. */
function copiesOf(commune: PlacePage, place: PlacePage): Record<Part, Copy | undefined> {
  return {
    meteo: { key: `web:lieu:${place.slug}`, build: (c, now) => buildPlace(c, place, now), max: 30, nom: "météo mesurée et prévue", outil: "meteo_actuelle et prevision_meteo" },
    commune: { key: `web:commune:${commune.slug}`, build: (c, now) => buildCommune(c, commune, now), max: 24 * H, nom: "mairie et info trafic des bus", outil: "annuaire_services_publics et transports" },
    air: { key: "web:air", build: buildAir, max: 12 * H, sameDay: true, nom: "qualité de l'air", outil: "qualite_air" },
    mer: coastal(commune) ? { key: "web:mer", build: buildSea, max: 36 * H, nom: SEA, outil: "temperature_mer" } : undefined,
    electricite: { key: "web:electricite", build: buildElectricite, max: H, nom: "électricité", outil: "electricite" },
    actualites: { key: "web:actualites", build: buildActualites, max: 2 * H, nom: "actualités de la commune", outil: "actualites" },
    trafic: { key: "web:trafic", build: buildTrafic, max: 2 * H, nom: "routes et circulation", outil: "actualites (sujet routes)" },
    coupures: { key: "web:coupures", build: buildCoupures, max: 3 * H, nom: "coupures d'eau", outil: "coupures_eau" },
    agenda: { key: "web:agenda", build: buildAgenda, max: 24 * H, sameDay: true, nom: "événements du jour", outil: "evenements" },
    calendrier: { key: "web:calendrier", build: buildCalendrier, max: 24 * H, sameDay: true, nom: "jour férié et vacances", outil: "calendrier" },
  };
}

const COMMUNES = PAGES.filter((p) => p.commune);
const localDay = (d: Date) => new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
const hhmm = (d: Date) => localTime(d).split(" ")[1];
const DAY_FR = new Intl.DateTimeFormat("fr-FR", { timeZone: "Indian/Reunion", weekday: "long", day: "numeric", month: "long" });
// The news of the roads: their subjects (actualites), and how far back a headline still says something of today.
const ROADS = ["route", "mobilisation"];
const NEWS_HOURS = 12;
const NEWS_MAX = 4;
const EVENTS_MAX = 10;
const WAVES = 9;
// A build whose cost is not known yet in this isolate is taken to cost this much (web/site.ts does the same).
const COST_UNKNOWN = 25;

const NO_JAMS = "rundata.re ne mesure pas les bouchons : voir la carte Waze en direct, l'état des routes nationales sur infotrafic.re (Région Réunion) et https://rundata.re/trafic.";

/** Whether a copy is recent enough for the summary of today. */
function usable(c: Copy, copy: Cached<unknown> | null | undefined, now: Date): copy is Cached<unknown> {
  if (!copy) return false;
  if (now.getTime() - copy.fetchedAt.getTime() > c.max * 60_000) return false;
  return !c.sameDay || localDay(copy.fetchedAt) === localDay(now);
}

function weather(d: PlaceData, now: Date) {
  const stations = d.meteo?.stations.filter((s) => s.mesures.temperature) ?? [];
  // A station far below or on the other side says little of the place: one that stands for it, when there is one.
  const s = stations.find((x) => x.pertinence !== "faible") ?? stations[0];
  const jours = d.prevision?.jours ?? [];
  // In the evening, tomorrow too: what is left of today is short.
  const evening = new Date(now.getTime() + 4 * 3600_000).getUTCHours() >= 17;
  if (!s && !jours.length) return undefined;
  return {
    mesure: s
      ? { station: s.station, altitude_m: s.altitude_m, distance_km: s.distance_km, heure_mesure: s.heure_mesure, mesures: s.mesures, avertissements: s.avertissements.length ? s.avertissements : undefined }
      : undefined,
    prevision: jours.length
      ? { avertissement: "PRÉVISION de modèle, pas une mesure.", aujourd_hui: jours[0], demain: evening ? jours[1] : undefined, modele: d.prevision?.modele?.nom }
      : undefined,
  };
}

function vigilance(p: PlacePage, v: mf.Vigilance, now: Date) {
  const zone = mf.ZONE_OF_COMMUNE[p.nom];
  const own = zone ? v.zones[zone] ?? {} : {};
  const up = Object.entries(mf.PHENOMENA)
    .filter(([id]) => Number(id) !== mf.CYCLONE && Number(id) !== WAVES)
    .map(([id, nom]) => ({ phenomene: nom, c: current(own[Number(id)] ?? [], now) }))
    .filter((x) => x.c >= 2);
  const waves = coastal(p) ? raised(v).find((x) => x.phenomene === mf.PHENOMENA[WAVES]) : undefined;
  const cyc = v.zones[mf.ISLAND]?.[mf.CYCLONE] ?? [];
  return {
    zone: (mf.ZONES[zone] ?? "").split(" :")[0] || undefined,
    maintenant: up.length ? up.map((x) => `${mf.colour(x.c)} ${x.phenomene.toLowerCase()}`).join(", ") : "pas de vigilance particulière",
    vagues_submersion: waves ? `${waves.couleur_max} sur le littoral` : undefined,
    alerte_cyclonique: highest(cyc) >= 2 ? cyclone(v, now) : undefined,
    emise: localTime(new Date(v.emise)),
  };
}

function sea(p: PlacePage, mer: SeaData | undefined, place: PlaceData | undefined) {
  const beaches = mer?.plages.filter((b) => b.commune === p.nom && b.valeur != null) ?? [];
  if (beaches.length) {
    const v = beaches.map((b) => b.valeur!);
    const [lo, hi] = [Math.round(Math.min(...v)), Math.round(Math.max(...v))];
    return { temperature_eau: lo === hi ? `${lo} °C` : `${lo} à ${hi} °C`, au_large_de: beaches.map((b) => b.nom), jour_mesure: beaches.map((b) => b.jour!).sort().pop(), mesure: "satellite" };
  }
  const m = place?.mer?.mesure;
  return m ? { temperature_eau: m.temperature_eau, jour_mesure: m.jour_mesure, mesure: "satellite, au large" } : undefined;
}

const newsRow = (i: ActualitesAnswer["infos"][number]) => ({ quand: i.quand, media: i.media, titre: i.titre, ce_qui_est_dit_du_lieu: i.ce_qui_est_dit_du_lieu, lien: i.lien });

/** Every source the parts used, once each. */
function sourcesOf(lists: (Credit[] | undefined)[]): Credit[] {
  const seen = new Set<string>();
  return lists.flat().filter((c): c is Credit => !!c && !seen.has(c.source) && !!seen.add(c.source));
}

export type Resume = ReturnType<typeof resume>;

/**
 * The summary of one commune, from the copies given (each recent enough, or missing): what the tool answers and the
 * page shows. The weather is that of the place asked when it has its own page (Maïdo, Hell-Bourg), else the commune's.
 */
export function resume(commune: PlacePage, l: ResumeCopies, now: Date, leftOut: LeftOut[] = []) {
  const today = localDay(now);
  const nom = commune.nom;
  const meteo = l.meteo ? weather(l.meteo.value, now) : undefined;
  const news = [...(l.actualites?.value.en_direct ?? []), ...(l.actualites?.value.infos ?? [])]
    .filter((i) => i.communes?.includes(nom) && now.getTime() - Date.parse(i.publie) < NEWS_HOURS * 3600_000);
  const roads = news.filter((i) => i.sujets?.some((s) => ROADS.includes(s)));
  const others = news.filter((i) => !roads.includes(i));
  const avis = l.coupures?.value.avis.filter((n) => n.communes.includes(nom)) ?? [];
  const dist = distributeur(nom);
  const events = (l.agenda?.value.evenements ?? []).filter((r) => r.commune === nom && occurrences(r).some((o) => o.du <= today && today <= o.au));
  const mairie = l.commune?.value.mairie;
  const open = mairie ? openNow(mairie, now) : null;
  const sun = cal.sun(today, commune.place.lon, commune.place.lat, commune.place.altitude_m ?? 0);
  const prod = l.electricite?.value.production;
  const airHere = l.air?.value.communes?.find((x) => normalize(x.commune) === normalize(nom));
  const c = l.calendrier?.value;
  const v = l.vigilance ? vigilance(commune, l.vigilance.value, now) : undefined;
  // Without the sea's page, the weather page's own reading of the sea, when it has one: then the sea is not left out.
  const mer = coastal(commune) ? sea(commune, l.mer?.value, l.meteo?.value) : undefined;
  const out = mer ? leftOut.filter((x) => x.partie !== SEA) : leftOut;

  const t = meteo?.mesure?.mesures.temperature;
  const f = meteo?.prevision?.aujourd_hui;
  const resumeText = [
    `${nom}, ${DAY_FR.format(now)}`,
    t ? `${t} mesurés à ${meteo!.mesure!.heure_mesure.split(" ")[1] ?? meteo!.mesure!.heure_mesure} (station ${meteo!.mesure!.station})` : "",
    f?.temperature_min && f.temperature_max ? `prévision du jour ${f.temperature_min} à ${f.temperature_max}${f.ciel_en_journee ? `, ${f.ciel_en_journee}` : ""}` : "",
    v ? `vigilance : ${v.maintenant}${v.alerte_cyclonique ? `, ${v.alerte_cyclonique}` : ""}` : "",
    l.coupures ? (avis.length ? `${avis.length} avis de coupure d'eau` : dist?.avis ? "pas de coupure d'eau annoncée" : "") : "",
    l.agenda ? `${events.length} événement${events.length > 1 ? "s" : ""} aujourd'hui` : "",
    roads.length ? `${roads.length} info${roads.length > 1 ? "s" : ""} sur les routes ou des blocages` : "",
  ].filter(Boolean).join(" ; ") + ".";

  return {
    commune: nom,
    resume: resumeText,
    meteo,
    vigilance: v,
    mer,
    air: airHere ? { indice_atmo: airHere.niveau, qualite: airHere.qualite, polluants: airHere.polluants.length ? airHere.polluants : undefined } : undefined,
    electricite: prod
      ? { heure: prod.heure, renouvelable_pct: prod.renouvelable_pct, total_mw: prod.total_mw, signal: l.electricite!.value.meteo_electricite?.maintenant?.signal }
      : undefined,
    circulation: {
      mesure_des_bouchons: NO_JAMS,
      waze: `https://www.waze.com/ul?ll=${commune.place.lat},${commune.place.lon}&zoom=13`,
      infos_routes: l.actualites ? roads.slice(0, NEWS_MAX).map(newsRow) : undefined,
      routes_ile: l.trafic?.value.medias?.length ? l.trafic.value.medias.slice(0, 3) : undefined,
      bus: l.commune?.value.bus?.alertes?.length ? l.commune.value.bus.alertes : undefined,
    },
    actualites: l.actualites ? others.slice(0, 3).map(newsRow) : undefined,
    coupures_eau: l.coupures
      ? {
          avis: avis.map((n) => ({ titre: n.titre, coupure: n.coupure, secteurs: n.secteurs, ne_pas_boire: n.ne_pas_boire, lien: n.lien })),
          distributeur: dist?.nom,
          note: avis.length || dist?.avis ? undefined : `Le distributeur ${a(nom)} ne publie pas ses avis dans un flux lisible : voir la mairie.`,
        }
      : undefined,
    evenements_du_jour: l.agenda
      ? {
          liste: events.slice(0, EVENTS_MAX).map((r) => ({ titre: r.titre, quand: r.quand, lieu: r.lieu, prix: r.prix, statut: r.statut, lien: r.lien })),
          autres: events.length > EVENTS_MAX ? events.length - EVENTS_MAX : undefined,
        }
      : undefined,
    calendrier: c ? { jour_ferie: c.jours_feries?.aujourd_hui ?? undefined, vacances_scolaires: c.vacances_scolaires?.en_cours?.nom } : undefined,
    soleil: { lever: hhmm(sun.lever), coucher: hhmm(sun.coucher) },
    mairie: mairie
      ? { ouverte: open, horaires_aujourd_hui: hoursOn(mairie, now) ?? (open === null ? undefined : "fermée aujourd'hui"), adresse: mairie.adresse, telephone: mairie.telephone }
      : undefined,
    non_inclus: out.length ? out : undefined,
    sources: sourcesOf([
      l.meteo?.value.meteo?.sources, l.meteo?.value.prevision?.sources, l.vigilance ? credits([mf.SOURCE]) : undefined, l.air?.value.sources, l.mer?.value.sources,
      l.electricite?.value.sources, l.actualites?.value.sources, l.trafic?.value.sources, l.coupures?.value.sources, l.agenda?.value.sources, l.calendrier?.value.sources,
      l.commune?.value.sources,
    ]),
  };
}

/** The commune of a place, and its own weather page when it has one. */
export function placeOf(lieu: string): { commune: PlacePage; place: PlacePage; res: NonNullable<ReturnType<typeof resolvePlace>> } | undefined {
  const res = resolvePlace(lieu);
  const commune = res && COMMUNES.find((p) => p.nom === res.lieu.commune);
  if (!res || !commune) return undefined;
  const own = PAGES.find((p) => p.place.nom === res.lieu.nom && p.place.commune === res.lieu.commune);
  return { commune, place: own ?? commune, res };
}

/**
 * Reads the copies of the commune's summary, keeps those recent enough, names the others, and brings the oldest of
 * those up to date after the answer when `background` is given and what its build took is left.
 */
export async function readCopies(cache: Cache, commune: PlacePage, place: PlacePage, now: Date, background?: Background) {
  const parts = Object.entries(copiesOf(commune, place)).filter((e): e is [Part, Copy] => !!e[1]);
  // One read each, as long as the invocation has subrequests left.
  const budget = left();
  const [peeked, vig] = await Promise.all([
    Promise.all(parts.map(([, c], i) => (i < budget ? cache.peek<any>(c.key).catch(() => undefined) : Promise.resolve(undefined)))),
    mf.enabled() ? mf.vigilance(cache).catch((err) => (console.error(`source ${mf.SOURCE.id} indisponible:`, why(err)), null)) : Promise.resolve(null),
  ]);
  const copies: ResumeCopies = { vigilance: vig };
  const leftOut: LeftOut[] = [];
  const due: { c: Copy; age: number }[] = [];
  parts.forEach(([name, c], i) => {
    const copy = peeked[i];
    if (usable(c, copy, now)) {
      (copies as Record<string, unknown>)[name] = copy;
      // The answer says how fresh it is from what it was served (tools/fraicheur.ts): these copies.
      noteLecture({ key: c.key, fetchedAt: copy.fetchedAt.getTime(), stale: false, freshSeconds: FRESH_SECONDS });
      return;
    }
    leftOut.push({ partie: c.nom, raison: copy ? `copie de ${localTime(copy.fetchedAt)}, trop ancienne` : "pas de copie récente", outil: c.outil });
    due.push({ c, age: copy ? now.getTime() - copy.fetchedAt.getTime() : Infinity });
  });
  if (!vig) leftOut.push({ partie: "vigilance", raison: mf.enabled() ? "Météo-France ne répond pas" : "vigilance non branchée", outil: "vigilance_meteo" });
  const oldest = due.sort((x, y) => y.age - x.age)[0];
  const refresh = !!background && !!oldest && left() >= (costOf(oldest.c.key) ?? COST_UNKNOWN);
  if (refresh) {
    background(cache.get(oldest.c.key, FRESH_SECONDS, () => measured(oldest.c.key, () => oldest.c.build(cache, now))).catch((err) => console.error(`page ${oldest.c.key} : rafraîchissement impossible`, why(err))));
  }
  return { copies, leftOut, refreshed: refresh ? oldest.c.key : undefined };
}

export async function resumeDuJour(cache: Cache, lieu: string, now = new Date(), background?: Background) {
  const found = placeOf(lieu);
  if (!found) return notFound(lieu);
  const { commune, place, res } = found;
  const { copies, leftOut } = await readCopies(cache, commune, place, now, background);
  return text({ lieu: placeBlock(lieu, res), ...resume(commune, copies, now, leftOut) });
}
