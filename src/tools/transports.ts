import type { Cache } from "../cache.js";
import { distanceKm, localTime } from "../geo.js";
import { INSEE } from "../places/insee.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import { holidays } from "../providers/calendrier.js";
import * as rt from "../providers/gtfsrt.js";
import * as transit from "../providers/transit.js";
import { why } from "../types.js";
import { asksCrossing, T as FERRY } from "./ferries.js";
import { credits, fr, text } from "./format.js";

// Words of a question that say nothing about which stop: « prochain bus à l'arrêt X pour Y ». « Routière » too:
// each network names the same bus station « Gare de St-Pierre », « Gare De Saint Pierre » or « Gare Routière… ».
const FILLER = new Set(
  "arret arrets bus car cars de du des la le les l d a au aux en et prochain prochains prochaine horaire horaires pour vers direction ligne station quand passe y routiere".split(" "),
);

const NETWORK_WORDS: [RegExp, string][] = [
  [/ car jaunes? /, "carjaune"],
  [/ citalis /, "citalis"],
  [/ kar ?ouest /, "karouest"],
  [/ alterneo /, "alterneo"],
  [/ car ?sud /, "carsud"],
  [/ estival /, "estival"],
  [/ (papang|telepherique) /, "papang"],
];
// Longest first, so that « Saint-Pierre » is not taken for « Pierrefonds » and « Sainte-Marie » not for « Saint… ».
const COMMUNES = Object.keys(INSEE).map((c) => ({ c, n: transit.expand(c) })).sort((a, b) => b.n.length - a.n.length);

/** What a question says: a network, a commune, and the words left for the stop's name. */
export function parseQuery(asked: string): { reseau?: string; commune?: string; words: string[] } {
  let q = ` ${transit.expand(asked)} `;
  let reseau: string | undefined;
  for (const [re, id] of NETWORK_WORDS) {
    if (re.test(q)) {
      reseau = id;
      q = q.replace(re, " ");
    }
  }
  const c = COMMUNES.find(({ n }) => q.includes(` ${n} `));
  if (c) q = q.replace(` ${c.n} `, " ");
  return { reseau, commune: c?.c, words: q.split(" ").filter((w) => w && !FILLER.has(w)) };
}

const matches = (g: transit.StopGroup, w: string) => g.words.has(w) || (w.length >= 4 && [...g.words].some((x) => x.startsWith(w)));

/**
 * The stops a question is about. Its words are matched against stop names (a word of 4 letters or more also
 * matches the start of a word), within the network and the commune it names; at least half must match. The best
 * stop comes with the other networks' stops of the same name a few steps away. A question naming no stop (« car
 * jaune à Saint-Leu », « plage de Boucan ») gets the stops nearest the place.
 */
export function findStops(asked: string): { groups: transit.StopGroup[]; near: { g: transit.StopGroup; m: number }[] } {
  const { reseau, commune, words } = parseQuery(asked);
  const pool = transit.GROUPS.filter((g) => (!reseau || g.reseau === reseau) && (!commune || g.commune === commune));
  if (words.length) {
    // Words of the name left unmatched, not counting its commune (« Gare de St-Pierre » at Saint-Pierre).
    const extra = (g: transit.StopGroup) => {
      const town = new Set(transit.expand(g.commune).split(" "));
      return [...g.words].filter((x) => !FILLER.has(x) && !town.has(x) && !words.some((w) => x === w || (w.length >= 4 && x.startsWith(w)))).length;
    };
    const scored = pool
      .map((g) => ({ g, n: words.filter((w) => matches(g, w)).length }))
      .filter((s) => s.n >= Math.max(1, Math.ceil(words.length / 2)))
      .map((s) => ({ ...s, extra: extra(s.g) }));
    if (scored.length) {
      const best = Math.max(...scored.map((s) => s.n));
      const top = scored.filter((s) => s.n === best).sort((a, b) => a.extra - b.extra);
      const first = top[0].g;
      return { groups: top.filter((s) => distanceKm(first.lon, first.lat, s.g.lon, s.g.lat) < 0.4).slice(0, 4).map((s) => s.g), near: [] };
    }
  }
  // A small network named alone (« le téléphérique »): all its stops.
  if (reseau && !commune && !words.length && pool.length <= 6) return { groups: pool, near: [] };
  const place = resolvePlace(asked) ?? (commune ? resolvePlace(commune) : null);
  if (!place) return { groups: [], near: [] };
  const near = nearStops(place.lieu.lon, place.lieu.lat, reseau);
  return { groups: near.map((x) => x.g), near };
}

/** The stop groups nearest a place: within 600 m, else the 3 nearest within 2 km. */
export function nearStops(lon: number, lat: number, reseau?: string): { g: transit.StopGroup; m: number }[] {
  const all = transit.GROUPS.filter((g) => !reseau || g.reseau === reseau)
    .map((g) => ({ g, m: distanceKm(lon, lat, g.lon, g.lat) * 1000 }))
    .filter((x) => x.m <= 2000)
    .sort((a, b) => a.m - b.m);
  const close = all.filter((x) => x.m <= 600);
  return (close.length ? close : all).slice(0, 3);
}

const clock = (s: number) => {
  const t = ((s % 86400) + 86400) % 86400;
  return `${Math.floor(t / 3600)}h${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;
};
/** « 7h05 », or « demain 5h51 » for a departure after midnight. */
const hm = (s: number) => `${s >= 86400 ? "demain " : ""}${clock(s)}`;
/** « à 7h05 », « demain à 5h51 ». */
const atTime = (s: number) => `${s >= 86400 ? "demain " : ""}à ${clock(s)}`;
const minutes = (d: Departure) => Math.max(0, Math.round(expected(d) / 60));
/** « dans 4 min », « dans 11 h 15 ». */
const wait = (min: number) => (min < 90 ? `dans ${fr(min)} min` : `dans ${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}` : ""}`);

/** Local day as YYYYMMDD and Monday-first weekday, `back` days before `now`. */
function day(now: Date, back = 0) {
  const d = new Date(now.getTime() + 4 * 3600_000 - back * 86_400_000);
  return { ymd: Number(d.toISOString().slice(0, 10).replace(/-/g, "")), weekday: (d.getUTCDay() + 6) % 7 };
}

export interface Departure {
  /** Seconds from now, as scheduled. */
  in: number;
  /** Seconds after today's local midnight, as scheduled. */
  at: number;
  route: number;
  headsign: string;
  reseau: string;
  arret: string;
  /** The GTFS trip and the stop (island-wide index), which the real-time feed knows them by. */
  trip: string;
  stop: number;
  /** Its pattern (island-wide index): where the trip comes from and goes. */
  pattern: number;
  /** The day of its service (YYYYMMDD): yesterday's for a bus after midnight. */
  jour?: number;
  /** From the real-time feed: seconds late (early when negative) at this stop, or that the bus will not stop. */
  retard?: number;
  supprime?: boolean;
  /** Where its bus is, when it sends its position. */
  bus?: BusPosition;
}

/** Seconds from now until the bus is expected: the real-time feed's time when there is one. */
const expected = (d: Departure) => d.in + (d.retard ?? 0);
/** The delay in whole minutes, as the difference of the two times shown (« 21h05 », « 21h07 »): never at odds with them. */
const delayMinutes = (d: Departure) => Math.floor((d.at + (d.retard ?? 0)) / 60) - Math.floor(d.at / 60);

type Moment = { secs: number; days: readonly (readonly [{ ymd: number; weekday: number }, number])[] };
type Pass = { stop: number; pattern: number; offset: number };

/** Seconds since local midnight, and yesterday's, today's and tomorrow's services with their shift. */
function moment(now: Date): Moment {
  const local = new Date(now.getTime() + 4 * 3600_000);
  const secs = local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds();
  return { secs, days: [[day(now), 0], [day(now, 1), 86400], [day(now, -1), -86400]] };
}

const byStop = (groups: transit.StopGroup[]) => new Map(groups.flatMap((g) => g.ids.map((id) => [id, g] as const)));

/** Only the patterns that may stop here in these hours are read: a bus station has hundreds, a few run now. */
const passing = (pass: Pass[], stopGroup: Map<number, transit.StopGroup>, horizon: number, { secs, days }: Moment) =>
  pass.filter((p) => {
    const g = stopGroup.get(p.stop);
    return g !== undefined && days.some(([d, shift]) => transit.mayRun(p.pattern, p.offset, g.reseau, d.ymd, d.weekday, secs - 60 + shift, secs + horizon + shift));
  });

function listed(pass: Pass[], pats: Map<number, transit.Pattern>, stopGroup: Map<number, transit.StopGroup>, horizon: number, { secs, days }: Moment): Departure[] {
  const out: Departure[] = [];
  for (const p of pass) {
    const pat = pats.get(p.pattern);
    const g = stopGroup.get(p.stop);
    if (!pat || !g) continue;
    for (const [service, start, trip] of pat.trips) {
      const t = start + p.offset;
      for (const [d, shift] of days) {
        const dt = t - shift - secs;
        if (dt >= -60 && dt <= horizon && transit.serviceRuns(g.reseau, service, d.ymd, d.weekday)) {
          // A terminus named after its bay: « Gare Routière Du Tampon Quai Q » is the bus station.
          out.push({ in: dt, at: t - shift, route: pat.route, headsign: pat.headsign.replace(/\s+quai\s+\S+$/i, ""), reseau: g.reseau, arret: g.nom, trip, stop: p.stop, pattern: p.pattern, jour: d.ymd });
        }
      }
    }
  }
  // Both poles of a stop, or two copies of a trip, give the same departure once.
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.in - b.in)
    .filter((d) => {
      const k = `${d.route}|${d.headsign}|${d.at}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Departures from these stops in the next `horizon` seconds, by yesterday's (after midnight), today's and tomorrow's services. */
export async function departures(groups: transit.StopGroup[], now: Date, horizon = 3 * 3600): Promise<Departure[]> {
  const stopGroup = byStop(groups);
  const c = moment(now);
  const pass = passing(await transit.passes([...stopGroup.keys()]), stopGroup, horizon, c);
  const pats = pass.length ? await transit.patterns([...new Set(pass.map((p) => p.pattern))]) : new Map<number, transit.Pattern>();
  return listed(pass, pats, stopGroup, horizon, c);
}

/**
 * At each of these stations, its departures in the next 3 hours, or in the next 20 when there are fewer than 3 (at
 * night), as `departures` gives them, read for all the stations at once: one read of the passes, one of the
 * patterns, and one more for the stations that look further. The bus stations of /bus and /trafic: 2 or 3
 * subrequests instead of 2 or 4 each.
 */
export async function stationDepartures(stations: transit.StopGroup[][], now: Date): Promise<Departure[][]> {
  const c = moment(now);
  const stops = stations.map(byStop);
  const all = await transit.passes([...new Set(stops.flatMap((m) => [...m.keys()]))]);
  const pats = new Map<number, transit.Pattern>();
  const read = async (pass: Pass[]) => {
    const ids = [...new Set(pass.map((p) => p.pattern))].filter((id) => !pats.has(id));
    if (ids.length) for (const [id, pat] of await transit.patterns(ids)) pats.set(id, pat);
  };
  const near = stops.map((m) => passing(all, m, 3 * 3600, c));
  await read(near.flat());
  const lists = stops.map((m, i) => listed(near[i], pats, m, 3 * 3600, c));
  const far = new Map(lists.flatMap((l, i) => (l.length < 3 ? [[i, passing(all, stops[i], 20 * 3600, c)] as const] : [])));
  await read([...far.values()].flat());
  for (const [i, pass] of far) lists[i] = listed(pass, pats, stops[i], 20 * 3600, c);
  return lists;
}

/** The real-time feeds of these networks that are recent and say something; a feed that fails, stopped or is empty is left out. */
export async function realtimeFeeds(nets: string[], cache: Cache, now: Date): Promise<Map<string, rt.Realtime>> {
  const out = new Map<string, rt.Realtime>();
  await Promise.all(
    [...new Set(nets)].filter((n) => transit.NETWORKS[n]?.temps_reel).map(async (n) => {
      try {
        const c = await rt.realtime(cache, n);
        const f = c?.value;
        if (f && now.getTime() / 1000 - f.at < rt.MAX_AGE_SECONDS && (f.cancelled.length || f.alerts.length || f.vehicles?.length || Object.keys(f.trips).length)) out.set(n, f);
      } catch (err) {
        console.error(`source ${rt.SOURCE.id} (${n}) indisponible:`, why(err));
      }
    }),
  );
  return out;
}

/** The GTFS id of a stop or a line of a network with a real-time feed. */
const gtfsStop = (n: transit.Network, stop: number) => n.temps_reel!.arrets[stop - n.first_stop];
const gtfsRoute = (n: transit.Network, route: number) => n.temps_reel!.lignes[route - n.first_route];

/** The departures with what the real-time feeds say about them, in the order the buses are now expected. */
export function applyRealtime(list: Departure[], feeds: Map<string, rt.Realtime>, now: Date): Departure[] {
  if (!feeds.size) return list;
  const t0 = now.getTime() / 1000;
  const cancelled = new Map([...feeds].map(([n, f]) => [n, new Set(f.cancelled)]));
  return list
    .map((d) => {
      const f = feeds.get(d.reseau);
      if (!f) return d;
      if (cancelled.get(d.reseau)!.has(d.trip)) return { ...d, supprime: true };
      const v = f.trips[d.trip]?.[gtfsStop(transit.NETWORKS[d.reseau], d.stop)];
      if (v === undefined) return d;
      return v === rt.SKIPPED ? { ...d, supprime: true } : { ...d, retard: Math.round(v - (t0 + d.in)) };
    })
    .filter((d) => d.supprime || expected(d) >= -60)
    .sort((a, b) => expected(a) - expected(b));
}

/** Beyond this age, a bus's position is not given: it says where the bus was, not where it is. */
export const POSITION_MAX_AGE = 10 * 60;
/** Within this distance of a stop, a bus that names none is said to be near it. */
const NEAR_STOP_M = 500;

export interface BusPosition {
  /** « à l'arrêt Mairie (Le Tampon) », « arrive à … », « en route vers … », « près de … »; none far from any stop. */
  ou?: string;
  /** Always given: a position is only true at its time. */
  heure_de_la_position: string;
  lat: number;
  lon: number;
}

/** A network's stops by their GTFS id, which the feed's positions name them by; built once per network. */
const stopIndexes = new Map<string, Map<string, number>>();
function stopIndex(net: string, id: string): number | undefined {
  let m = stopIndexes.get(net);
  if (!m) {
    const n = transit.NETWORKS[net];
    m = new Map(n.temps_reel!.arrets.map((x, i) => [x, n.first_stop + i]));
    stopIndexes.set(net, m);
  }
  return m.get(id);
}

/** Where a bus is, in words: its stop and what it does there, else its network's stop nearest it. */
function whereIs(net: string, v: rt.Vehicle): string | undefined {
  const id = v.stop !== undefined ? stopIndex(net, v.stop) : undefined;
  if (id !== undefined) {
    const s = transit.stop(id);
    const at = `${s.nom} (${s.commune})`;
    return v.status === 1 ? `à l'arrêt ${at}` : v.status === 0 ? `arrive à ${at}` : `en route vers ${at}`;
  }
  const near = nearStops(v.lon, v.lat, net)[0];
  return near && near.m <= NEAR_STOP_M ? `près de ${near.g.nom} (${near.g.commune})` : undefined;
}

/** A bus's position as the tool gives it, with its time; undefined when it is more than 10 minutes old. */
function position(net: string, v: rt.Vehicle, now: Date): BusPosition | undefined {
  if (now.getTime() / 1000 - v.at > POSITION_MAX_AGE) return undefined;
  const ou = whereIs(net, v);
  return { ...(ou ? { ou } : {}), heure_de_la_position: clock(v.at + 4 * 3600), lat: Math.round(v.lat * 1e4) / 1e4, lon: Math.round(v.lon * 1e4) / 1e4 };
}

/** The departures whose bus sends its position, with it: the bus is on its way to the stop, or at it. */
export function withPositions(list: Departure[], feeds: Map<string, rt.Realtime>, now: Date): Departure[] {
  const byTrip = new Map([...feeds].flatMap(([net, f]) => (f.vehicles ?? []).map((v) => [`${net}|${v.trip}`, v] as const)));
  if (!byTrip.size) return list;
  return list.map((d) => {
    const v = d.supprime ? undefined : byTrip.get(`${d.reseau}|${d.trip}`);
    const bus = v && position(d.reseau, v, now);
    return bus ? { ...d, bus } : d;
  });
}

/** The traffic alerts in force about these stops or the lines of these departures. */
export function alertsFor(groups: transit.StopGroup[], list: Departure[], feeds: Map<string, rt.Realtime>, now: Date) {
  const out: { reseau: string; lignes?: string[]; titre: string; detail?: string }[] = [];
  for (const [net, f] of feeds) {
    const n = transit.NETWORKS[net];
    const stops = new Set(groups.filter((g) => g.reseau === net).flatMap((g) => g.ids.map((id) => gtfsStop(n, id))));
    // The lines of these departures, by their GTFS id, with the name people know them by.
    const lines = new Map(list.filter((d) => d.reseau === net).map((d) => [gtfsRoute(n, d.route), lineName(d.route).ligne]));
    for (const a of f.alerts) {
      if (!rt.active(a, now.getTime() / 1000) || out.some((x) => x.titre === a.titre)) continue;
      const named = [...new Set(a.lignes.filter((x) => lines.has(x)).map((x) => lines.get(x)!))];
      if (named.length || a.arrets.some((x) => stops.has(x))) out.push({ reseau: n.nom, ...(named.length ? { lignes: named } : {}), titre: a.titre, detail: a.texte });
    }
  }
  return out;
}

/** Up to `max` departures, no more than 3 per line and direction, so that every line shows. */
export function spread(list: Departure[], max = 12): Departure[] {
  const seen = new Map<string, number>();
  return list.filter((d) => {
    const k = `${d.route}|${d.headsign}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n <= 3;
  }).slice(0, max);
}

const lineName = (r: number) => {
  const [net, short, long] = transit.ROUTES[r];
  return { ligne: short || long, nom_ligne: short && long ? long : undefined, reseau: transit.NETWORKS[net]?.nom ?? net };
};

export interface DepartureRow {
  heure: string;
  dans_min: number;
  ligne: string;
  nom_ligne?: string;
  reseau: string;
  direction: string;
  arret: string;
  heure_annoncee?: string;
  retard_min?: number;
  temps_reel?: string;
}

/** A departure as the tool and the pages give it: the time of the timetable, and the one announced in real time. */
export const departureRow = (d: Departure): DepartureRow => ({
  heure: hm(d.at),
  dans_min: minutes(d),
  ...lineName(d.route),
  direction: d.headsign,
  arret: d.arret,
  ...(d.supprime ? { temps_reel: "ne passe pas à cet arrêt" } : d.retard !== undefined ? { heure_annoncee: hm(d.at + d.retard), retard_min: delayMinutes(d) } : {}),
});

export const TRIP_PATH = "/bus/trajet";
/** The page of a departure's trip (web/trajet.ts): its pattern and its stop numbered within its network, and the day of its service. */
export function tripPath(d: Departure): string | undefined {
  const n = transit.NETWORKS[d.reseau];
  if (!n || d.jour === undefined) return undefined;
  return `${TRIP_PATH}/${d.reseau}/${d.pattern - n.first_pattern}/${encodeURIComponent(d.trip)}?jour=${d.jour}&arret=${d.stop - n.first_stop}#arret-${d.stop - n.first_stop}`;
}

/** A departure as the pages keep it: the tool's row, and the page of its trip. */
export type PageRow = DepartureRow & { trajet?: string };
export const pageRow = (d: Departure): PageRow => {
  const trajet = tripPath(d);
  return { ...departureRow(d), ...(trajet ? { trajet } : {}) };
};

/** « à l'heure », « 5 min de retard », « 2 min d'avance ». */
// marketing's words, the participle agreeing with the noun before it.
const delayText = (m: number) => (m === 0 ? "à l'heure, annoncé en direct" : m > 0 ? `retard de ${fr(m)} min annoncé en direct` : `avance de ${fr(-m)} min annoncée en direct`);

/** The departure as the tool gives it, with where its trip comes from and goes, and where its bus is. */
const toolRow = (d: Departure) => ({ ...departureRow(d), ...endsOf(d), ...(d.bus ? { position_du_bus: d.bus } : {}) });

/** Where a departure's trip comes from and goes: the first and last stops of its pattern. */
export function endsOf(d: Departure): { origine: string; terminus: string } | undefined {
  const e = transit.ENDS[d.pattern];
  return e ? { origine: transit.stop(e[1]).nom, terminus: transit.stop(e[2]).nom } : undefined;
}

const said = (d: Departure) =>
  `${lineName(d.route).ligne} vers ${d.headsign} ` +
  (d.supprime
    ? `${atTime(d.at)} : ne passe pas à cet arrêt (annoncé en direct par le réseau)`
    : d.retard !== undefined
      ? `${atTime(d.at + d.retard)} (${wait(minutes(d))}, ${delayText(delayMinutes(d))})`
      : `${atTime(d.at)} (${wait(minutes(d))})`) +
  (d.bus?.ou ? `, position du bus à ${d.bus.heure_de_la_position} : ${d.bus.ou}` : "");

const STOP_HELP = "Donner le nom de l'arrêt et sa commune (« Gare routière, Saint-Pierre », « Mairie, Le Tampon »), ou un lieu proche.";

/** The departures at these stops, of these lines only when given, with the real-time feeds: what a stop's answer shows. */
async function stopDepartures(groups: transit.StopGroup[], now: Date, cache: Cache | undefined, keep?: (d: Departure) => boolean) {
  let list = await departures(groups, now);
  if (keep) list = list.filter(keep);
  if (list.length < 3) {
    list = await departures(groups, now, 20 * 3600);
    if (keep) list = list.filter(keep);
  }
  const feeds = cache ? await realtimeFeeds(groups.map((g) => g.reseau), cache, now) : new Map<string, rt.Realtime>();
  list = applyRealtime(list, feeds, now);
  const shown = withPositions(spread(list), feeds, now);
  return { shown, feeds, alertes: alertsFor(groups, shown, feeds, now), live: [...new Set(shown.filter((d) => d.retard !== undefined || d.supprime || d.bus).map((d) => transit.NETWORKS[d.reseau].nom))] };
}

const timetables = (live: string[], feeds: Map<string, rt.Realtime>) => {
  const at = [...feeds.values()].reduce((m, f) => Math.max(m, f.at), 0);
  return live.length
    ? `${live.join(", ")} : heures annoncées en direct par le réseau (flux de ${localTime(new Date(at * 1000)).split(" ")[1]}) quand le bus y figure\u00a0; sinon horaires théoriques, sans les retards ni les déviations`
    : "théoriques, publiés par chaque réseau : retards, suppressions et déviations ne sont pas pris en compte";
};

const networksOf = (nets: string[]) =>
  [...new Set(nets)].map((n) => ({ nom: transit.NETWORKS[n].nom, exploitant: transit.NETWORKS[n].exploitant, horaires_valables_jusqu_au: transit.NETWORKS[n].valide_jusqu_au ?? undefined }));

export async function transports(asked: string | undefined, ligne: string | undefined, now = new Date(), cache?: Cache) {
  const q = asked?.trim() ?? "";
  // A boat to Mauritius has no timetable to look for: the answer is that there is none.
  if (asksCrossing(q)) return text({ resume: FERRY.outil });
  if (!transit.enabled()) {
    return { ...text({ erreur: "Les horaires de bus ne sont disponibles que sur le serveur en ligne (https://rundata.re/mcp)." }), isError: true };
  }
  if (!q && !ligne?.trim()) return { ...text({ erreur: "Donner un arrêt, un lieu ou une ligne.", conseil: STOP_HELP }), isError: true };
  try {
    if (ligne?.trim()) {
      const answer = await lineAnswer(ligne.trim(), q, now, cache);
      if (answer) return answer;
      if (!q) return text({ resume: `Aucune ligne « ${ligne} » dans les horaires publiés des réseaux de La Réunion.`, conseil: "Donner le nom de la ligne comme le réseau l'écrit (« S1 », « O1X », « 2 ») et son réseau (« Car Jaune »).", sources: credits([transit.SOURCE]) });
    }
    return await stopAnswer(q, ligne?.trim() || undefined, now, cache);
  } catch (err) {
    console.error(`source ${transit.SOURCE.id} indisponible:`, why(err));
    return { ...text({ erreur: "Les horaires de bus ne répondent pas pour le moment.", conseil: "Réessayer dans un instant." }), isError: true };
  }
}

/** The next departures at the stops a question names, or near the place it names. */
async function stopAnswer(asked: string, ligne: string | undefined, now: Date, cache?: Cache) {
  const { groups, near } = findStops(asked);
  if (!groups.length) {
    return text({ resume: `Aucun arrêt de bus trouvé pour « ${asked} ».`, conseil: STOP_HELP, sources: credits([transit.SOURCE]) });
  }
  const { shown, feeds, alertes, live } = await stopDepartures(groups, now, cache);
  const stops = groups.map((g) => ({
    nom: g.nom,
    commune: g.commune,
    reseau: transit.NETWORKS[g.reseau]?.nom ?? g.reseau,
    distance_m: near.find((x) => x.g === g) ? Math.round(near.find((x) => x.g === g)!.m / 10) * 10 : undefined,
  }));
  const where = stops.map((s) => `${s.nom} (${s.commune}, ${s.reseau})`).join(", ");
  // Nothing left today: whether anything of the stop runs today at all, which reads its passes again.
  const off = shown.every((d) => d.at >= 86400) ? await quiet(groups, where, feeds, now, cache) : undefined;
  const told = new Set(off?.alertes?.map((a) => a.titre));
  const others = alertes.filter((a) => !told.has(a.titre));
  // After the stop's opening, which says where and by what, the departures alone.
  const next = shown.length
    ? (off ? `Prochains départs${NBSP}: ` : `Prochains départs à ${where}, d'après ${live.length ? "les annonces en direct des réseaux et " : ""}les horaires publiés${NBSP}: `) + shown.slice(0, 5).map(said).join("\u00a0; ") + "." +
      (others.length ? ` Info trafic : ${others.map((a) => `${a.lignes ? `ligne ${a.lignes.join(", ")}, ` : ""}${a.titre}`).join("\u00a0; ")}.` : "")
    : off ? "" : `Aucun départ prévu dans les prochaines heures à ${where}, d'après les horaires publiés.`;
  const resume = [off?.text, next].filter(Boolean).join(" ");
  const used = live.length > 0 || alertes.length > 0 || !!off?.alertes;
  return text({
    resume,
    arrets: stops,
    ...(near.length ? { note: `Arrêts les plus proches de « ${asked} » : préciser le nom de l'arrêt pour un résultat exact.` } : {}),
    ...(ligne ? { ligne_introuvable: `Aucune ligne « ${ligne} » dans les horaires publiés : tous les départs sont donnés.` } : {}),
    departs: shown.map(toolRow),
    ...(alertes.length || off?.alertes ? { info_trafic: [...(off?.alertes ?? []), ...others] } : {}),
    horaires: timetables(live, feeds),
    reseaux: networksOf(groups.map((g) => g.reseau)),
    sources: credits([transit.SOURCE, ...(used ? [rt.SOURCE] : [])]),
  });
}

const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
type Day = ReturnType<typeof day>;
/** « dimanche 25 octobre », « dimanche 1er novembre ». */
export const dayName = (d: Day) => `${WEEKDAYS[d.weekday]} ${d.ymd % 100 === 1 ? "1er" : d.ymd % 100} ${MONTHS[(Math.floor(d.ymd / 100) % 100) - 1]}`;
const iso = (d: Day) => `${Math.floor(d.ymd / 10000)}-${String(Math.floor(d.ymd / 100) % 100).padStart(2, "0")}-${String(d.ymd % 100).padStart(2, "0")}`;

const netOf = (pattern: number) => transit.ROUTES[transit.ENDS[pattern][0]][0];
/** Whether a trip of this pattern runs on that day, by the services in the bundle. */
const runsOn = (pattern: number, d: Day) => transit.servicesOf(pattern).some((sv) => transit.serviceRuns(netOf(pattern), sv, d.ymd, d.weekday));

/** A holiday named by its date only (« 11 novembre ») would say the date twice. */
const DATE_ONLY = /^\d{1,2}(?:er)? \p{L}+$/u;
const NBSP = "\u00a0";

/**
 * What the timetables say beside a day with no departure, never as its cause: a public holiday (the State's calendar),
 * with its name unless it is only a date; a weekday they run on no week of the published timetables; else nothing.
 */
async function offDay(patterns: number[], d: Day, cache?: Cache): Promise<{ ferie: string } | { weekday: true } | undefined> {
  if (cache) {
    try {
      const name = (await holidays(cache, Math.floor(d.ymd / 10000))).value[iso(d)];
      if (name) return { ferie: DATE_ONLY.test(name) ? "jour férié" : `jour férié (${name})` };
    } catch (err) {
      console.error("jours fériés indisponibles :", why(err));
    }
  }
  // The same weekday on the other weeks, a year on each side: the services' own dates bound the published timetables.
  const others = Array.from({ length: 104 }, (_, i) => ({ ymd: addDays(d.ymd, 7 * (i < 52 ? i - 52 : i - 51)), weekday: d.weekday }));
  return others.some((w) => patterns.some((p) => runsOn(p, w))) ? undefined : { weekday: true };
}

/** The live alerts in force about these lines, by network, the network's words quoted: « Info trafic de Car Jaune (flux de 07:29) : « … ». ». */
function linesAlerts(routes: number[], feeds: Map<string, rt.Realtime>, now: Date) {
  const alertes: { reseau: string; lignes: string[]; titre: string; detail?: string }[] = [];
  const said: string[] = [];
  for (const [net, f] of feeds) {
    const n = transit.NETWORKS[net];
    const mine = routes.filter((r) => transit.ROUTES[r][0] === net);
    const names = new Map(mine.map((r) => [gtfsRoute(n, r), lineName(r).ligne]));
    const found = f.alerts.filter((a) => rt.active(a, now.getTime() / 1000) && a.lignes.some((x) => names.has(x)))
      .filter((a, i, all) => all.findIndex((b) => b.titre === a.titre) === i);
    if (!found.length) continue;
    for (const a of found) alertes.push({ reseau: n.nom, lignes: [...new Set(a.lignes.filter((x) => names.has(x)).map((x) => names.get(x)!))], titre: a.titre, ...(a.texte ? { detail: a.texte } : {}) });
    said.push(`Info trafic de ${n.nom} (flux de ${localTime(new Date(f.at * 1000)).split(" ")[1]})${NBSP}: ${found.map((a) => `«${NBSP}${a.titre.trim().replace(/\.$/, "")}${NBSP}»`).join(`${NBSP}; `)}.`);
  }
  return { alertes, text: said.join(" ") };
}

/**
 * The opening of a line's answer on a day it does not run: the fact, then what the timetables say beside it, else, for a
 * date its network's calendar leaves out, the network's live alert about the line when its feed has one.
 */
async function notToday(line: string, net: string, routes: number[], patterns: number[], d: Day, now: Date, cache?: Cache) {
  const head = `Ligne ${line}${NBSP}: aucun départ aujourd'hui, ${dayName(d)}`;
  const off = await offDay(patterns, d, cache);
  if (off && "ferie" in off) return { text: `${head}, ${off.ferie}, d'après les horaires publiés.` };
  const weekday = WEEKDAYS[d.weekday];
  if (off) return { text: `${head}. D'après les horaires publiés, elle ne circule pas le ${weekday}.` };
  const feeds = cache && transit.NETWORKS[net].temps_reel ? await realtimeFeeds([net], cache, now) : new Map<string, rt.Realtime>();
  const { alertes, text: told } = linesAlerts(routes, feeds, now);
  return {
    text: `${head}, d'après les horaires publiés, alors qu'elle circule le ${weekday} les autres semaines. ${told || `Les horaires ne disent pas pourquoi${NBSP}: voir l'info trafic du réseau.`}`,
    ...(alertes.length ? { alertes } : {}),
  };
}

/** YYYYMMDD plus `n` days. */
function addDays(ymd: number, n: number): number {
  const t = Date.UTC(Math.floor(ymd / 10000), (Math.floor(ymd / 100) % 100) - 1, ymd % 100) + n * 86_400_000;
  return Number(new Date(t).toISOString().slice(0, 10).replace(/-/g, ""));
}

/**
 * For a stop with nothing of it running today: the fact, then what the timetables say beside it for all its lines, else
 * the live alerts about them. Undefined when some of it runs today.
 */
async function quiet(groups: transit.StopGroup[], where: string | undefined, feeds: Map<string, rt.Realtime>, now: Date, cache?: Cache, read?: Pass[]) {
  const ids = groups.flatMap((g) => g.ids);
  const pats = [...new Set((read ?? (await transit.passes(ids))).map((p) => p.pattern))];
  const today = day(now);
  if (!pats.length || pats.some((p) => runsOn(p, today))) return undefined;
  // A stop's page names the stop in its title: its sentence starts with the fact.
  const head = where ? `Arrêt${groups.length > 1 ? "s" : ""} ${where}${NBSP}: aucun départ aujourd'hui, ${dayName(today)}` : `Aucun départ aujourd'hui, ${dayName(today)}`;
  const off = await offDay(pats, today, cache);
  if (off && "ferie" in off) return { text: `${head}, ${off.ferie}, d'après les horaires publiés.` };
  if (off) return { text: `${head}. D'après les horaires publiés, aucune des lignes qui le desservent ne circule le ${WEEKDAYS[today.weekday]}.` };
  const { alertes, text: told } = linesAlerts([...new Set(pats.map((p) => transit.ENDS[p][0]))], feeds, now);
  return { text: `${head}, d'après les horaires publiés.${told ? ` ${told}` : ""}`, ...(alertes.length ? { alertes } : {}) };
}

const TRANCHES: [number, number, string][] = [
  [0, 9 * 3600, "avant 9 h"],
  [9 * 3600, 12 * 3600, "9 h à 12 h"],
  [12 * 3600, 16 * 3600, "12 h à 16 h"],
  [16 * 3600, 19 * 3600, "16 h à 19 h"],
  [19 * 3600, 48 * 3600, "après 19 h"],
];

/** A day's departures in a few figures: how many, the first, the last, and by part of the day how often. */
function daySummary(starts: number[]) {
  const t = [...new Set(starts)].sort((a, b) => a - b);
  if (!t.length) return { nombre: 0 };
  return {
    nombre: t.length,
    premier: clock(t[0]),
    dernier: clock(t[t.length - 1]),
    par_tranche: TRANCHES.flatMap(([from, to, tranche]) => {
      const x = t.filter((s) => s >= from && s < to);
      if (!x.length) return [];
      // How often, from three departures on: between two, the gap says nothing of a rhythm.
      const every = x.length > 2 ? Math.max(5, Math.round((x[x.length - 1] - x[0]) / (x.length - 1) / 300) * 5) : undefined;
      return [{ tranche, departs: x.length, ...(every ? { environ_toutes_les_min: every } : {}) }];
    }),
  };
}

/** The hour a question asks about (« après 17 h », « vers 7h30 »), in seconds after midnight. */
function hourAsked(asked: string): number | undefined {
  const m = /(?:^|\D)([01]?\d|2[0-3]) ?h ?([0-5]\d)?(?!\d)/i.exec(asked);
  return m ? Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60 : undefined;
}

/** The network a question or a line's name names (« S1 car jaune »). */
function networkIn(s: string): string | undefined {
  const q = ` ${transit.expand(s)} `;
  return NETWORK_WORDS.find(([re]) => re.test(q))?.[1];
}

/** The lines `ligne` names (« S1 », « ligne O1X », « S1 Car Jaune »), within `reseau` when given. */
export function linesNamed(ligne: string, reseau?: string): number[] {
  let l = ` ${transit.expand(ligne)} `;
  for (const [re] of NETWORK_WORDS) l = l.replace(re, " ");
  l = l.replace(/^\s*ligne\s+/, "").trim();
  if (!l) return [];
  const all = transit.ROUTES.map((r, i) => [r, i] as const).filter(([[net]]) => !reseau || net === reseau);
  const exact = all.filter(([[, short]]) => transit.expand(short) === l);
  return (exact.length ? exact : all.filter(([[, , long]]) => l.length >= 4 && transit.expand(long).includes(l))).map(([, i]) => i);
}

/** Up to how many of a line's patterns have their stops read: one per first stop, last stop and headsign, the busiest. */
const STOPS_READ = 12;
/** Within this distance, a stop of the line serves the place asked about. */
const SERVES_M = 600;

/**
 * A line: its stops in order, direction by direction; its departures of the day, summed up; at a place asked about,
 * whether it stops there, else its nearest stop, and the next departures there. Undefined when no line has that name.
 */
async function lineAnswer(ligne: string, asked: string, now: Date, cache?: Cache) {
  let routes = linesNamed(ligne, networkIn(`${asked} ${ligne}`));
  let nets = [...new Set(routes.map((r) => transit.ROUTES[r][0]))];
  if (nets.length > 1 && asked) {
    // Several networks have a line of that name: the one with a stop at the place asked about.
    const there = findStops(asked).groups.map((g) => g.reseau).find((n) => nets.includes(n));
    if (there) routes = routes.filter((r) => transit.ROUTES[r][0] === there);
    nets = [...new Set(routes.map((r) => transit.ROUTES[r][0]))];
  }
  if (!routes.length) return undefined;
  if (nets.length > 1) {
    return text({
      resume: `Plusieurs réseaux ont une ligne « ${ligne} » : ${routes.map((r) => `${lineName(r).ligne}${lineName(r).nom_ligne ? ` (${lineName(r).nom_ligne})` : ""}, ${lineName(r).reseau}`).join("\u00a0; ")}.`,
      conseil: `Préciser le réseau (« ${ligne} Car Jaune ») ou un arrêt de la ligne.`,
      sources: credits([transit.SOURCE]),
    });
  }
  const net = nets[0];
  const name = lineName(routes[0]);
  const said_line = `${name.ligne}${name.nom_ligne ? ` (${name.nom_ligne})` : ""}, ${name.reseau}`;
  const pats = routes.flatMap(transit.patternsOf);
  // The day shown: today, else the next day the line runs.
  const today = day(now);
  let ahead = 0;
  let d = today;
  while (ahead < 14 && !pats.some((p) => runsOn(p, d))) d = { ymd: addDays(today.ymd, ++ahead), weekday: (today.weekday + ahead) % 7 };
  if (ahead === 14) {
    return text({ resume: `La ligne ${said_line} n'a aucun départ dans les deux semaines qui viennent, d'après les horaires publiés.`, reseaux: networksOf([net]), sources: credits([transit.SOURCE]) });
  }
  const running = pats.filter((p) => runsOn(p, d));
  const rows = await transit.patterns(running);
  const tripsOn = (p: number) => (rows.get(p)?.trips ?? []).filter(([sv]) => transit.serviceRuns(net, sv, d.ymd, d.weekday));
  // One pattern per first stop, last stop and headsign, the one with the most trips that day: its stops stand for the others'.
  const combo = (p: number) => `${transit.ENDS[p][1]}|${transit.ENDS[p][2]}|${rows.get(p)?.headsign ?? ""}`;
  const best = new Map<string, number>();
  for (const p of running) {
    const b = best.get(combo(p));
    if (b === undefined || tripsOn(p).length > tripsOn(b).length) best.set(combo(p), p);
  }
  const reps = [...best.values()].sort((a, b) => tripsOn(b).length - tripsOn(a).length).slice(0, STOPS_READ);
  const stopsOf = await transit.patternStops(reps);
  // Directions: the network's when it gives them, else one per terminus.
  const dir = (p: number) => {
    const sens = stopsOf?.get(p)?.sens;
    return sens != null ? `s${sens}` : transit.stop(transit.ENDS[p][2]).nom;
  };
  const repOf = new Map([...best].map(([k, p]) => [k, p]));
  const dirs = [...new Set(reps.map(dir))];
  const hour = hourAsked(asked);
  const sens = dirs.slice(0, 4).map((key) => {
    const mine = reps.filter((p) => dir(p) === key);
    const main = [...mine].sort((a, b) => (stopsOf?.get(b)?.stops.length ?? 0) - (stopsOf?.get(a)?.stops.length ?? 0) || tripsOn(b).length - tripsOn(a).length)[0];
    const members = running.filter((p) => { const r = repOf.get(combo(p)); return r !== undefined && dir(r) === key; });
    const starts = members.flatMap((p) => tripsOn(p).map(([, start]) => start));
    const ends = (p: number) => `${transit.stop(transit.ENDS[p][1]).nom} → ${transit.stop(transit.ENDS[p][2]).nom}`;
    const variants = mine.filter((p) => ends(p) !== ends(main)).map((p) => `${ends(p)} (${tripsOn(p).length} départ${tripsOn(p).length > 1 ? "s" : ""})`);
    const list = stopsOf?.get(main)?.stops.map(([id]) => transit.stop(id));
    return {
      main,
      names: list?.map((x) => x.nom),
      out: {
        direction: ends(main),
        ...(list ? { nombre_arrets: list.length, arrets: byCommune(list) } : {}),
        ...(variants.length ? { autres_parcours: variants } : {}),
        departs_du_jour: daySummary(starts),
        ...(hour !== undefined ? { departs_apres_l_heure_demandee: [...new Set(starts)].sort((a, b) => a - b).filter((t) => t >= hour).slice(0, 8).map(clock) } : {}),
      } as Record<string, unknown>,
    };
  });
  // The way back by the same stops is said, not listed again.
  if (sens.length === 2 && sens[0].names && sens[1].names && reversed(sens[0].names, sens[1].names)) {
    sens[1].out.arrets = "les mêmes arrêts, dans l'ordre inverse";
  }
  const off = ahead ? await notToday(`${name.ligne} (${[name.nom_ligne, name.reseau].filter(Boolean).join(", ")})`, net, routes, pats, today, now, cache) : undefined;
  let resume = off
    ? `${off.text} Prochaine journée de service, ${dayName(d)}\u00a0: `
    : `Ligne ${said_line}, d'après les horaires publiés : `;
  resume += sens.map(({ out }) => {
    const s = out.departs_du_jour as ReturnType<typeof daySummary>;
    const range = s.nombre ? `${off ? "" : ","} de ${s.premier} à ${s.dernier}` : "";
    return `${out.direction}${out.nombre_arrets ? `, ${out.nombre_arrets} arrêts` : ""}, ${s.nombre} départ${s.nombre > 1 ? "s" : ""}${off ? "" : " aujourd'hui"}${range}`;
  }).join("\u00a0; ") + ".";
  if (!stopsOf) resume += " La liste de ses arrêts n'est pas disponible pour le moment.";

  // Its buses on the road now, when the network's feed gives their positions: by their trip, which says the direction,
  // else by their line. A network that sends none says nothing.
  let buses: (BusPosition & { vers?: string })[] | undefined;
  if (!ahead && cache && transit.NETWORKS[net].temps_reel) {
    const f = (await realtimeFeeds([net], cache, now)).get(net);
    if (f?.vehicles?.length) {
      const patternOf = new Map(running.flatMap((p) => (rows.get(p)?.trips ?? []).map(([, , trip]) => [trip, p] as const)));
      const ids = new Set(routes.map((r) => gtfsRoute(transit.NETWORKS[net], r)));
      buses = f.vehicles
        .filter((v) => patternOf.has(v.trip) || (v.route !== undefined && ids.has(v.route)))
        .flatMap((v) => {
          const pos = position(net, v, now);
          const p = patternOf.get(v.trip);
          return pos ? [{ ...(p !== undefined ? { vers: transit.stop(transit.ENDS[p][2]).nom } : {}), ...pos }] : [];
        })
        .sort((a, b) => (a.vers ?? "").localeCompare(b.vers ?? "", "fr"))
        .slice(0, 20);
      resume += buses.length
        ? ` En ce moment, ${buses.length} bus de la ligne ${buses.length > 1 ? "donnent leur" : "donne sa"} position : ` +
          buses.slice(0, 4).map((b) => `${b.vers ? `vers ${b.vers}, ` : ""}${b.ou ?? "loin de tout arrêt"} à ${b.heure_de_la_position}`).join("\u00a0; ") + "."
        : " Aucun bus de la ligne ne donne sa position en ce moment, ce qui ne veut pas dire qu'aucun ne circule.";
    }
  }

  // A place asked about: the line's stop there, else its nearest one, and the next departures there.
  let place: Record<string, unknown> | undefined;
  let shownAt: Awaited<ReturnType<typeof stopDepartures>> | undefined;
  // The place, without the hour asked about (« Manapany après 17 h »).
  const where = asked.replace(/(?:après|apres|avant|vers|à partir de|a partir de|dès|des)?\s*(?:^|\b)([01]?\d|2[0-3]) ?h ?([0-5]\d)?(?!\d)/gi, " ").trim();
  if (where && !ahead) {
    const lineStops = stopsOf ? [...new Set([...stopsOf.values()].flatMap((x) => x.stops.map(([id]) => id)))] : [];
    const found = findStops(where);
    let groups: transit.StopGroup[] = [];
    if (lineStops.length) {
      const named = found.groups.find((g) => g.ids.some((id) => lineStops.includes(id)));
      const at = named ?? found.groups[0] ?? (() => { const r = resolvePlace(where); return r ? { lon: r.lieu.lon, lat: r.lieu.lat } : undefined; })();
      if (at) {
        const nearest = lineStops.map((id) => ({ s: transit.stop(id), m: named?.ids.includes(id) ? 0 : distanceKm(at.lon, at.lat, transit.stop(id).lon, transit.stop(id).lat) * 1000 })).sort((a, b) => a.m - b.m)[0];
        const serves = nearest.m <= SERVES_M;
        const g = transit.GROUPS.find((x) => x.ids.includes(nearest.s.id));
        if (g) groups = [g];
        const dist = nearest.m < 1000 ? `${Math.round(nearest.m / 10) * 10} m` : `${fr(Math.round(nearest.m / 100) / 10)} km`;
        place = { arret: nearest.s.nom, commune: nearest.s.commune, dessert_le_lieu_demande: serves, ...(nearest.m ? { distance_du_lieu_demande: dist } : {}) };
        resume += serves
          ? ` Elle s'arrête à ${nearest.s.nom} (${nearest.s.commune})${nearest.m ? `, à ${dist} de « ${where} »` : ""}.`
          : ` Elle ne passe pas à « ${where} » : son arrêt le plus proche est ${nearest.s.nom} (${nearest.s.commune}), à ${dist}.`;
      }
    } else {
      groups = found.groups.filter((g) => g.reseau === net);
    }
    if (groups.length) {
      shownAt = await stopDepartures(groups, now, cache, (x) => routes.includes(x.route));
      if (shownAt.shown.length) resume += ` Prochains départs à ${groups[0].nom}${NBSP}: ${shownAt.shown.slice(0, 4).map(said).join("\u00a0; ")}.`;
    }
  }
  const used = !!buses?.length || !!off?.alertes || (!!shownAt && (shownAt.live.length > 0 || shownAt.alertes.length > 0));
  return text({
    resume,
    ligne: name,
    jour: dayName(d),
    sens: sens.map((x) => x.out),
    ...(buses?.length ? { bus_en_circulation: buses } : {}),
    ...(stopsOf ? {} : { note: "Liste des arrêts indisponible pour le moment : seuls les terminus et les horaires sont donnés." }),
    ...(place ? { arret: place } : {}),
    ...(shownAt?.shown.length ? { departs: shownAt.shown.map(toolRow) } : {}),
    ...(shownAt?.alertes.length ? { info_trafic: shownAt.alertes } : off?.alertes ? { info_trafic: off.alertes } : {}),
    ...(hour === undefined ? { detail: "Les heures de départ une par une : redemander avec l'heure voulue (« après 17 h »)." } : {}),
    horaires: shownAt ? timetables(shownAt.live, shownAt.feeds) : timetables([], new Map()),
    reseaux: networksOf([net]),
    sources: credits([transit.SOURCE, ...(used ? [rt.SOURCE] : [])]),
  });
}

/** A line's stops by commune, in their order: « Saint-Joseph : Église Vincendo, Gare de St-Joseph ». */
function byCommune(list: transit.Stop[]): string[] {
  const out: { commune: string; noms: string[] }[] = [];
  for (const x of list) {
    const last = out[out.length - 1];
    if (last?.commune === x.commune) {
      if (last.noms[last.noms.length - 1] !== x.nom) last.noms.push(x.nom);
    } else out.push({ commune: x.commune, noms: [x.nom] });
  }
  return out.map((c) => `${c.commune} : ${c.noms.join(", ")}`);
}

/** Whether a direction's stops are the other's backwards, nine in ten at least. */
function reversed(a: string[], b: string[]): boolean {
  if (Math.abs(a.length - b.length) > Math.max(1, a.length / 10)) return false;
  const back = new Set(b);
  return a.filter((x) => back.has(x)).length >= 0.9 * a.length && a[0] === b[b.length - 1] && a[a.length - 1] === b[0];
}

export interface TripStop {
  id: number;
  nom: string;
  commune: string;
  /** As scheduled, in ms since 1970. */
  at: number;
  /** As the real-time feed expects it, in ms since 1970. */
  annonce?: number;
  /** The real-time feed says the bus will not stop there. */
  saute?: boolean;
}

export interface TripRun {
  reseau: string;
  ligne: string;
  nom_ligne?: string;
  nom_reseau: string;
  /** Its first stop, and the way it shows (its headsign). */
  origine: string;
  direction: string;
  /** The day of its service (YYYYMMDD). */
  jour: number;
  /** Its stops in order; undefined when the database does not have them (`transit.patternStops`). */
  arrets?: TripStop[];
  /** First and last time of the trip, in ms since 1970, as scheduled: what the page says without its stops. */
  depart: number;
  arrivee?: number;
  /** Where its network has a real-time feed: whether the feed speaks of this run (only while it is on the road), and the feed's time. */
  direct?: { etat: "suivi" | "absent"; flux: number } | { etat: "muet" };
  /** The real-time feed says the trip will not run. */
  supprime?: boolean;
}

/** Local midnight of a day YYYYMMDD, in ms since 1970. */
const midnight = (ymd: number) => Date.UTC(Math.floor(ymd / 10000), (Math.floor(ymd / 100) % 100) - 1, ymd % 100) - 4 * 3600_000;
const weekdayOf = (ymd: number) => (new Date(midnight(ymd) + 4 * 3600_000).getUTCDay() + 6) % 7;
/** Within this much of its times, a trip is the one the real-time feed speaks of. */
const LIVE_AROUND_MS = 3600_000;

/**
 * A trip of a pattern (numbered within its network) on the day of its service, else its run still to come: yesterday's
 * while it is on the road after midnight, today's, or the next day it runs within two weeks. Its stops with their times,
 * and what the real-time feed says of it while it is on the road. Undefined when the network, the pattern or the trip is
 * not in the timetables, or the trip does not run that day: a link from before they were published again.
 */
export async function tripRun(net: string, local: number, trip: string, jour: number | undefined, now: Date, cache?: Cache): Promise<TripRun | undefined> {
  const n = transit.NETWORKS[net];
  if (!n || !Number.isInteger(local) || local < 0) return undefined;
  const pattern = n.first_pattern + local;
  const ends = transit.ENDS[pattern];
  if (!ends || transit.ROUTES[ends[0]][0] !== net) return undefined;
  const [pats, stopsOf] = await Promise.all([transit.patterns([pattern]), transit.patternStops([pattern])]);
  const pat = pats.get(pattern);
  const found = pat?.trips.find(([, , id]) => id === trip);
  if (!pat || !found) return undefined;
  const [service, start] = found;
  const stops = stopsOf?.get(pattern)?.stops;
  const last = stops?.length ? stops[stops.length - 1][1] : 0;
  const runs = (ymd: number) => transit.serviceRuns(net, service, ymd, weekdayOf(ymd));
  let ymd = jour;
  if (ymd === undefined) {
    // Yesterday's run still on the road, today's, or the next one.
    for (let back = 1; back >= -14 && ymd === undefined; back--) {
      const d = day(now, back).ymd;
      if (runs(d) && (back < 0 || midnight(d) + (start + last) * 1000 >= now.getTime() - 60_000)) ymd = d;
    }
    if (ymd === undefined) return undefined;
  } else if (!runs(ymd)) return undefined;
  const base = midnight(ymd) + start * 1000;
  const arrets = stops?.map(([id, offset]) => {
    const s = transit.stop(id);
    return { id, nom: s.nom, commune: s.commune, at: base + offset * 1000 } as TripStop;
  });
  const line = lineName(ends[0]);
  const out: TripRun = {
    reseau: net,
    ligne: line.ligne,
    ...(line.nom_ligne ? { nom_ligne: line.nom_ligne } : {}),
    nom_reseau: line.reseau,
    origine: transit.stop(ends[1]).nom,
    direction: pat.headsign.replace(/\s+quai\s+\S+$/i, ""),
    jour: ymd,
    ...(arrets ? { arrets } : {}),
    depart: base,
    ...(stops?.length ? { arrivee: base + last * 1000 } : {}),
  };
  // The feed speaks of a trip id's run on the road now, not of its runs of other days: read for any run of a network
  // that has one, so that the page says the bus is not in it, but its times applied only around this run's.
  const t = now.getTime();
  const onRoad = t >= base - LIVE_AROUND_MS && t <= base + last * 1000 + LIVE_AROUND_MS;
  if (cache && n.temps_reel) {
    let f: rt.Realtime | undefined;
    try {
      f = (await rt.realtime(cache, net))?.value;
    } catch (err) {
      console.error(`source ${rt.SOURCE.id} (${net}) indisponible:`, why(err));
    }
    // A feed too old says nothing of now: as one that does not answer.
    if (!f || t / 1000 - f.at >= rt.MAX_AGE_SECONDS) out.direct = { etat: "muet" };
    else if (!onRoad) out.direct = { etat: "absent", flux: f.at };
    else {
      const told = f.trips[trip];
      out.supprime = f.cancelled.includes(trip) || undefined;
      if (told && arrets) {
        for (const a of arrets) {
          const v = told[gtfsStop(n, a.id)];
          if (v === rt.SKIPPED) a.saute = true;
          else if (v !== undefined) a.annonce = v * 1000;
        }
      }
      out.direct = { etat: told || out.supprime ? "suivi" : "absent", flux: f.at };
      if (!out.supprime) delete out.supprime;
    }
  }
  return out;
}

/**
 * A stop's page (web/arret.ts): its next departures, of all its networks, with the real-time feeds; the day's sentence
 * when nothing of it runs today; the lines that stop there. One read of its passes serves the three, one or two of the
 * patterns: what the tool reads for a stop.
 */
export async function stopPageDepartures(groups: transit.StopGroup[], now: Date, cache?: Cache) {
  const c = moment(now);
  const m = byStop(groups);
  const all = await transit.passes([...m.keys()]);
  const pats = new Map<number, transit.Pattern>();
  const read = async (pass: Pass[]) => {
    const ids = [...new Set(pass.map((p) => p.pattern))].filter((id) => !pats.has(id));
    if (ids.length) for (const [id, pat] of await transit.patterns(ids)) pats.set(id, pat);
  };
  let pass = passing(all, m, 3 * 3600, c);
  await read(pass);
  let list = listed(pass, pats, m, 3 * 3600, c);
  if (list.length < 3) {
    pass = passing(all, m, 20 * 3600, c);
    await read(pass);
    list = listed(pass, pats, m, 20 * 3600, c);
  }
  const feeds = cache ? await realtimeFeeds(groups.map((g) => g.reseau), cache, now) : new Map<string, rt.Realtime>();
  const shown = spread(applyRealtime(list, feeds, now));
  const off = shown.every((d) => d.at >= 86400) ? await quiet(groups, undefined, feeds, now, cache, all) : undefined;
  // The lines that stop there (not their terminus), whatever the day: they change seldom, the times every minute.
  const lines = [...new Set(all.map((p) => transit.ENDS[p.pattern]?.[0]).filter((r): r is number => r !== undefined))].map((r) => lineName(r).ligne);
  const live = [...new Set(shown.filter((d) => d.retard !== undefined || d.supprime).map((d) => d.reseau))];
  const at = [...feeds].filter(([n]) => live.includes(n)).reduce((t, [, f]) => Math.max(t, f.at), 0);
  return {
    departs: shown.map(pageRow),
    ...(off ? { aucun: off.text } : {}),
    alertes: [...(off?.alertes ?? []), ...alertsFor(groups, shown, feeds, now)].filter((a, i, l) => l.findIndex((b) => b.titre === a.titre) === i),
    lignes: [...new Set(lines)].sort((a, b) => a.localeCompare(b, "fr", { numeric: true })),
    /** The networks whose departures shown come from their feed, and the feed's time (seconds since 1970). */
    direct: live.map((n) => transit.NETWORKS[n].nom),
    flux: at || undefined,
    sources: [transit.SOURCE, ...(live.length ? [rt.SOURCE] : [])],
  };
}

/**
 * The stop pages a search names (/bus/arret?q=), the best first: the words of a stop's name, as the tool matches them
 * (`findStops`), within the network and the commune it names; never the stops near a place.
 */
export function searchStops(asked: string): transit.StopPage[] {
  const { reseau, commune, words } = parseQuery(asked);
  if (!words.length) return [];
  const pool = transit.GROUPS.filter((g) => (!reseau || g.reseau === reseau) && (!commune || g.commune === commune));
  const scored = pool.map((g) => ({ g, n: words.filter((w) => matches(g, w)).length })).filter((x) => x.n >= Math.max(1, Math.ceil(words.length / 2)));
  if (!scored.length) return [];
  const best = Math.max(...scored.map((x) => x.n));
  const out = new Map<string, transit.StopPage>();
  for (const { g } of scored.filter((x) => x.n === best).sort((a, b) => a.g.words.size - b.g.words.size || a.g.commune.localeCompare(b.g.commune, "fr"))) {
    const p = transit.pageOfStop(g.ids[0]);
    if (p && !out.has(p.slug)) out.set(p.slug, p);
  }
  return [...out.values()];
}
