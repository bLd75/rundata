/**
 * « Résumé du jour » for a place (resume_du_jour): the weather measured now and forecast for today, the vigilance, the
 * sea, the electricity, the roads and the news of the commune, its water cuts and its events of the day, its town hall
 * and its sun, its market of the day, the state of its déchèteries (TCO), the month's fuel prices and where to find the
 * duty pharmacy, in one call. Cut from the copies the site's pages keep (web/site.ts): only read, never built while the
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
import { phases } from "../providers/carburants.js";
import * as cc from "../providers/coupures-courant.js";
import * as sante from "../sante/etablissements.js";
import * as col from "../vie/collecte.js";
import * as dech from "../vie/decheteries.js";
import * as marches from "../vie/marches.js";
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
  buildCourant,
  buildDechets,
  buildElectricite,
  buildPlace,
  buildSea,
  buildTrafic,
  type CalendrierAnswer,
  type CommuneData,
  type CoupuresAnswer,
  type Credit,
  type DechetsAnswer,
  type ElectriciteAnswer,
  FRESH_SECONDS,
  type PlaceData,
  type SeaData,
  type TraficAnswer,
} from "../web/data.js";
import { anchorOf } from "../web/decheteries.js";
import { coastal, PAGES, type PlacePage } from "../web/places.js";
import { occurrences } from "./agenda.js";
import { hoursOn, openNow } from "./annuaire.js";
import { priceLine } from "./carburants.js";
import { ecoles, resumeLine } from "./ecoles.js";
import { aheadRows, type CourantAnswer, shortOf } from "./courant.js";
import { SITE_URL } from "./citer.js";
import { a, credits, notFound, placeBlock, text } from "./format.js";
import { current, cyclone, highest, raised } from "./vigilance.js";
import type { InfoRow } from "./actualites.js";
import { ENDS as LITTORAL_ENDS, forSummary, littoral, NONE as LITTORAL_NONE } from "./littoral.js";

// How old an announcement of the route du Littoral may be to be told in a summary.
const LITTORAL_SUMMARY_HOURS = 12;

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
  dechets?: Cached<DechetsAnswer> | null;
  courant?: Cached<CourantAnswer> | null;
}
type Part = Exclude<keyof ResumeCopies, "vigilance">;
/** A part left out of the summary, why, and the tool that answers it. */
export interface LeftOut {
  partie: string;
  raison: string;
  outil: string;
  /** The page of rundata.re that shows it. */
  page: string;
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
  /** Its page on the site, from the root. */
  page: string;
}

const H = 60;
const SEA = "température de la mer";

/** The copies of the commune's summary, for a place with its own weather page or not. */
function copiesOf(commune: PlacePage, place: PlacePage): Record<Part, Copy | undefined> {
  return {
    meteo: { key: `web:lieu:${place.slug}`, build: (c, now) => buildPlace(c, place, now), max: 30, nom: "météo mesurée et prévue", outil: "meteo_actuelle et prevision_meteo", page: `/meteo/${place.slug}` },
    commune: { key: `web:commune:${commune.slug}`, build: (c, now) => buildCommune(c, commune, now), max: 24 * H, nom: "mairie et info trafic des bus", outil: "annuaire_services_publics et transports", page: `/communes/${commune.slug}` },
    air: { key: "web:air", build: buildAir, max: 12 * H, sameDay: true, nom: "qualité de l'air", outil: "qualite_air", page: "/air" },
    mer: coastal(commune) ? { key: "web:mer", build: buildSea, max: 36 * H, nom: SEA, outil: "temperature_mer", page: "/mer" } : undefined,
    electricite: { key: "web:electricite", build: buildElectricite, max: H, nom: "électricité", outil: "electricite", page: "/electricite" },
    actualites: { key: "web:actualites", build: buildActualites, max: 2 * H, nom: "actualités de la commune", outil: "actualites", page: "/actualites" },
    trafic: { key: "web:trafic", build: buildTrafic, max: 2 * H, nom: "routes, circulation et prix des carburants", outil: "actualites (sujet routes) et annuaire_services_publics (carburants)", page: "/trafic" },
    coupures: { key: "web:coupures", build: buildCoupures, max: 3 * H, nom: "coupures d'eau", outil: "coupures_eau", page: `/coupures-eau/${commune.slug}` },
    agenda: { key: "web:agenda", build: buildAgenda, max: 24 * H, sameDay: true, nom: "événements du jour", outil: "evenements", page: "/evenements" },
    calendrier: { key: "web:calendrier", build: buildCalendrier, max: 24 * H, sameDay: true, nom: "jour férié et vacances", outil: "calendrier", page: "/calendrier" },
    // Only the TCO publishes the state of its skips: the other communes have no such part.
    dechets: dech.TCO_COMMUNES.includes(commune.nom)
      ? { key: "web:dechets", build: buildDechets, max: 3 * H, nom: "état des déchèteries", outil: "annuaire_services_publics", page: `/decheteries#${anchorOf(commune.nom)}` }
      : undefined,
    // Only the mairies that relay EDF's notices: elsewhere nothing is said, rather than the same « we do not know » each day.
    courant: cc.MAIRIES.some((m) => m.commune === commune.nom)
      ? { key: "web:courant", build: () => buildCourant(), max: 6 * H, nom: "coupures d'électricité relayées par la mairie", outil: "electricite", page: "/electricite#coupures" }
      : undefined,
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
// A build whose cost was measured neither in this isolate nor with its copy is taken to cost this much (web/site.ts
// does the same).
const COST_UNKNOWN = 25;

const MARKETS_NOT_ALL = "D'après OpenStreetMap : tous les marchés n'y sont pas, et les jours peuvent avoir changé.";
const NO_DUTY = "rundata.re ne sait pas quelle pharmacie est de garde : seuls 3237.fr et le 32 37 le disent.";
const FUEL_NOTE = "Prix maximum fixés chaque mois par le préfet, les mêmes dans toute l'île : une station peut vendre moins cher.";

/** « sans plomb 2,00 €/L, gazole 1,80 €/L », as marketing words the prices everywhere. */
function fuelShort(p: { produits: { produit: string; prix_eur: number }[] }): string {
  const litre = (re: RegExp, nom: string) => {
    const x = p.produits.find((y) => re.test(y.produit));
    return x ? `${nom} ${x.prix_eur.toFixed(2).replace(".", ",")} €/L` : "";
  };
  return [litre(/^supercarburant$/i, "sans plomb"), litre(/^gazole$/i, "gazole")].filter(Boolean).join(", ");
}

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
    /** The schools closed by the cyclone alert in force, in marketing's words (tools/ecoles.ts). */
    ecoles: resumeLine(ecoles(v, now)),
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
  // At either end of the route du Littoral, its announcement of the last hours: from the news already read, none older.
  const asRead = (r: InfoRow) => ({ ...r, heure: r.il_y_a != null });
  const read = l.actualites && {
    infos: [...l.actualites.value.en_direct, ...l.actualites.value.infos].map(asRead),
    prefecture: l.actualites.value.prefecture.map((r) => ({ ...r, heure: false })),
  };
  // None in the last hours: said so (marketing's words) when the copy reaches that far back, a copy cut short
  // (NEWS_LISTED, web/data.ts) could have left one out; and not when an older one was read, which is not « none ».
  const covered = !!read && read.infos.some((i) => now.getTime() - Date.parse(i.publie) >= LITTORAL_SUMMARY_HOURS * 3600_000);
  const road = LITTORAL_ENDS.includes(nom) && read
    ? forSummary(littoral(read, now, LITTORAL_SUMMARY_HOURS), now) ?? (covered && !littoral(read, now) ? LITTORAL_NONE : undefined)
    : undefined;
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
  const markets = marches.heldOn(nom, now);
  // The prices of another month are not this month's; an order read before its 1st is not in force yet.
  const fuel = l.trafic?.value.carburants;
  const inForce = fuel && phases(fuel, now).vigueur;
  const prices = inForce && inForce.depuis.slice(0, 7) === today.slice(0, 7) ? inForce : undefined;
  // A site's state older than its staff's last round says nothing of now (vie/decheteries.ts).
  const sites = l.dechets && dech.TCO_COMMUNES.includes(nom) ? dech.sitesNow(l.dechets.value.etats, now).filter((s) => s.commune === nom) : undefined;
  const fresh = sites?.filter((s) => s.a_jour) ?? [];
  const green = fresh.filter((s) => s.accepte.includes("déchets verts")).length;
  const power = l.courant && cc.MAIRIES.some((m) => m.commune === nom) ? aheadRows(l.courant.value, nom, now) : [];

  const t = meteo?.mesure?.mesures.temperature;
  const f = meteo?.prevision?.aujourd_hui;
  const bins = col.COMMUNES.includes(nom);
  const resumeText = [
    `${nom}, ${DAY_FR.format(now)}`,
    t ? `${t} mesurés à ${meteo!.mesure!.heure_mesure.split(" ")[1] ?? meteo!.mesure!.heure_mesure} (station ${meteo!.mesure!.station})` : "",
    f?.temperature_min && f.temperature_max ? `prévision du jour ${f.temperature_min} à ${f.temperature_max}${f.ciel_en_journee ? `, ${f.ciel_en_journee}` : ""}` : "",
    v ? `vigilance : ${v.maintenant}${v.alerte_cyclonique ? `, ${v.alerte_cyclonique}` : ""}` : "",
    v?.ecoles ? v.ecoles.replace(/\.$/, "") : "",
    l.coupures ? (avis.length ? `${avis.length} avis de coupure d'eau` : dist?.avis ? "pas de coupure d'eau annoncée" : "") : "",
    l.agenda ? `${events.length} événement${events.length > 1 ? "s" : ""} aujourd'hui` : "",
    roads.length ? `${roads.length} info${roads.length > 1 ? "s" : ""} sur les routes ou des blocages` : "",
    power.length ? shortOf(power[0], now) : "",
    markets.length ? `marché aujourd'hui : ${markets.map((m) => `${m.nom} ${m.horaires_aujourd_hui}`).join(", ")}` : "",
    prices && fuelShort(prices) ? `carburants (prix maximum) : ${fuelShort(prices)}` : "",
    fresh.length ? `déchets verts acceptés dans ${green} déchèterie${green > 1 ? "s" : ""} sur ${fresh.length}` : "",
    bins ? `collecte des déchets : le jour de votre rue sur rundata.re/collecte/${col.communeSlug(nom)}` : "",
    "pharmacie de garde : 3237.fr",
  ].filter(Boolean).join("\u00a0; ") + ".";

  return {
    commune: nom,
    resume: resumeText,
    meteo,
    vigilance: v,
    mer,
    air: airHere ? { indice_atmo: airHere.niveau, qualite: airHere.qualite, polluants: airHere.polluants.length ? airHere.polluants : undefined } : undefined,
    electricite: prod
      ? { heure: prod.heure_mesure, renouvelable_pct: prod.renouvelable_pct, total_mw: prod.total_mw, signal: l.electricite!.value.meteo_electricite?.maintenant?.signal }
      : undefined,
    circulation: {
      mesure_des_bouchons: NO_JAMS,
      waze: `https://www.waze.com/ul?ll=${commune.place.lat},${commune.place.lon}&zoom=13`,
      route_du_littoral: road,
      infos_routes: l.actualites ? roads.slice(0, NEWS_MAX).map(newsRow) : undefined,
      routes_ile: l.trafic?.value.medias?.length ? l.trafic.value.medias.slice(0, 3) : undefined,
      bus: l.commune?.value.bus?.alertes?.length ? l.commune.value.bus.alertes : undefined,
    },
    actualites: l.actualites ? others.slice(0, 3).map(newsRow) : undefined,
    coupures_eau: l.coupures
      ? {
          avis: avis.map((n) => ({ titre: n.titre, coupure: n.coupure, secteurs: n.secteurs, secteurs_complets: n.secteurs_complets, ne_pas_boire: n.ne_pas_boire, lien: n.lien })),
          distributeur: dist?.nom,
          note: avis.length || dist?.avis ? undefined : `Le distributeur ${a(nom)} ne publie pas ses avis dans un flux lisible : voir la mairie.`,
        }
      : undefined,
    evenements_du_jour: l.agenda
      ? {
          liste: events.slice(0, EVENTS_MAX).map((r) => ({ titre: r.titre, quand: r.quand, lieu: r.lieu, prix: r.prix, statut: r.statut, lien: r.lien, source: r.source })),
          autres: events.length > EVENTS_MAX ? events.length - EVENTS_MAX : undefined,
        }
      : undefined,
    calendrier: c ? { jour_ferie: c.jours_feries?.aujourd_hui ?? undefined, vacances_scolaires: c.vacances_scolaires?.en_cours?.nom } : undefined,
    soleil: { lever: hhmm(sun.lever), coucher: hhmm(sun.coucher) },
    mairie: mairie
      ? { ouverte: open, horaires_aujourd_hui: hoursOn(mairie, now) ?? (open === null ? undefined : "fermée aujourd'hui"), adresse: mairie.adresse, telephone: mairie.telephone }
      : undefined,
    coupures_electricite: power.length ? { avis: power } : undefined,
    marches_du_jour: markets.length
      ? { liste: markets.map((m) => ({ nom: m.nom, horaires_aujourd_hui: m.horaires_aujourd_hui, adresse: m.adresse ?? undefined, carte: m.osm })), avertissement: MARKETS_NOT_ALL }
      : undefined,
    decheteries: sites
      ? {
          sites: sites.map((s) => ({
            nom: s.nom,
            mis_a_jour: s.mis_a_jour,
            etat: s.a_jour ? "à jour" : s.mis_a_jour ? `dernière mise à jour à ${s.mis_a_jour}, à vérifier sur place` : "pas de mise à jour",
            accepte: s.a_jour ? s.accepte : undefined,
            benne_pleine: s.a_jour ? s.refuse : undefined,
          })),
          page: `${SITE_URL}/decheteries#${anchorOf(nom)}`,
        }
      : undefined,
    // The days change from a street to the next: the commune's page, never « collecte aujourd'hui » (marketing).
    collecte_dechets: bins ? { texte: `Collecte des déchets : le jour de votre rue sur rundata.re/collecte/${col.communeSlug(nom)}.`, page: `${SITE_URL}/collecte/${col.communeSlug(nom)}` } : undefined,
    carburants: prices ? { prix_maximum: fuelShort(prices) || undefined, prix_maximums: prices.produits.map(priceLine), depuis: prices.depuis, a_savoir: FUEL_NOTE, lien: fuel!.lien } : undefined,
    pharmacie_de_garde: { site: sante.GARDE.site, telephone: sante.GARDE.telephone, quand: sante.GARDE.quand, a_savoir: NO_DUTY },
    non_inclus: out.length ? out : undefined,
    sources: sourcesOf([
      l.meteo?.value.meteo?.sources, l.meteo?.value.prevision?.sources, l.vigilance ? credits([mf.SOURCE]) : undefined, l.air?.value.sources, l.mer?.value.sources,
      l.electricite?.value.sources, l.actualites?.value.sources, l.trafic?.value.sources, l.coupures?.value.sources, l.agenda?.value.sources, l.calendrier?.value.sources,
      l.commune?.value.sources, l.dechets?.value.sources, power.length ? l.courant!.value.sources : undefined, markets.length ? credits([marches.OSM]) : undefined, credits([sante.ARS_GARDE]),
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
 * those up to date after the answer when `background` is given and what its build took is left. `vigilance`: the
 * vigilance as the caller has it already (a page waits for it only a moment), else it is read here. `held`: the
 * copies the caller has already (a page builds its weather), neither read again nor refreshed here.
 */
export async function readCopies(cache: Cache, commune: PlacePage, place: PlacePage, now: Date, background?: Background, vigilance?: Promise<Cached<mf.Vigilance> | null>, held: Partial<Record<Part, Cached<any> | null>> = {}) {
  const parts = Object.entries(copiesOf(commune, place)).filter((e): e is [Part, Copy] => !!e[1]);
  // One read each, as long as the invocation has subrequests left.
  const budget = left();
  let reads = 0;
  const [peeked, vig] = await Promise.all([
    Promise.all(parts.map(([name, c]) => (name in held ? Promise.resolve(held[name] ?? undefined) : reads++ < budget ? cache.peek<any>(c.key, now.getTime() - FRESH_SECONDS * 1000).catch(() => undefined) : Promise.resolve(undefined)))),
    vigilance ?? (mf.enabled() ? mf.vigilance(cache).catch((err) => (console.error(`source ${mf.SOURCE.id} indisponible:`, why(err)), null)) : Promise.resolve(null)),
  ]);
  const copies: ResumeCopies = { vigilance: vig };
  const leftOut: LeftOut[] = [];
  const due: { c: Copy; age: number; cost?: number }[] = [];
  parts.forEach(([name, c], i) => {
    const copy = peeked[i];
    if (usable(c, copy, now)) {
      (copies as Record<string, unknown>)[name] = copy;
      // The answer says how fresh it is from what it was served (tools/fraicheur.ts): these copies.
      noteLecture({ key: c.key, fetchedAt: copy.fetchedAt.getTime(), stale: false, freshSeconds: FRESH_SECONDS });
      // Built by another version: used, and brought up to date first (cache.ts, `outdated`).
      if (copy.outdated && !(name in held)) due.push({ c, age: Infinity, cost: copy.cost });
      return;
    }
    leftOut.push({ partie: c.nom, raison: copy ? `copie de ${localTime(copy.fetchedAt)}, trop ancienne` : "pas de copie récente", outil: c.outil, page: `${SITE_URL}${c.page}` });
    if (!(name in held)) due.push({ c, age: copy ? now.getTime() - copy.fetchedAt.getTime() : Infinity, cost: copy?.cost });
  });
  if (!vig) leftOut.push({ partie: "vigilance", raison: mf.enabled() ? "Météo-France ne répond pas" : "vigilance non branchée", outil: "vigilance_meteo", page: `${SITE_URL}/vigilance` });
  const oldest = due.sort((x, y) => y.age - x.age)[0];
  const refresh = !!background && !!oldest && left() >= (costOf(oldest.c.key) ?? oldest.cost ?? COST_UNKNOWN);
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
