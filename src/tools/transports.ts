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
const wait = (min: number) => (min < 90 ? `dans ${fr(min)} min` : `dans ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`);

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

/** Departures from these stops in the next `horizon` seconds, by yesterday's (after midnight), today's and tomorrow's services. */
export async function departures(groups: transit.StopGroup[], now: Date, horizon = 3 * 3600): Promise<Departure[]> {
  const stopGroup = new Map(groups.flatMap((g) => g.ids.map((id) => [id, g] as const)));
  const local = new Date(now.getTime() + 4 * 3600_000);
  const secs = local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds();
  const days = [[day(now), 0], [day(now, 1), 86400], [day(now, -1), -86400]] as const;
  // Only the patterns that may stop here in these hours are read: a bus station has hundreds, a few run now.
  const pass = (await transit.passes([...stopGroup.keys()])).filter((p) =>
    days.some(([d, shift]) => transit.mayRun(p.pattern, p.offset, stopGroup.get(p.stop)!.reseau, d.ymd, d.weekday, secs - 60 + shift, secs + horizon + shift)),
  );
  const pats = pass.length ? await transit.patterns([...new Set(pass.map((p) => p.pattern))]) : new Map<number, transit.Pattern>();
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
          out.push({ in: dt, at: t - shift, route: pat.route, headsign: pat.headsign.replace(/\s+quai\s+\S+$/i, ""), reseau: g.reseau, arret: g.nom, trip, stop: p.stop, pattern: p.pattern });
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
    ? `${live.join(", ")} : heures annoncées en direct par le réseau (flux de ${localTime(new Date(at * 1000)).split(" ")[1]}) quand le bus y figure ; sinon horaires théoriques, sans les retards ni les déviations`
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
  const resume = shown.length
    ? `Prochains départs à ${where}, d'après ${live.length ? "les annonces en direct des réseaux et " : ""}les horaires publiés : ` + shown.slice(0, 5).map(said).join(" ; ") + "." +
      (alertes.length ? ` Info trafic : ${alertes.map((a) => `${a.lignes ? `ligne ${a.lignes.join(", ")}, ` : ""}${a.titre}`).join(" ; ")}.` : "")
    : `Aucun départ prévu dans les prochaines heures à ${where}, d'après les horaires publiés.` + (await quiet(groups, now, cache));
  const used = live.length > 0 || alertes.length > 0;
  return text({
    resume,
    arrets: stops,
    ...(near.length ? { note: `Arrêts les plus proches de « ${asked} » : préciser le nom de l'arrêt pour un résultat exact.` } : {}),
    ...(ligne ? { ligne_introuvable: `Aucune ligne « ${ligne} » dans les horaires publiés : tous les départs sont donnés.` } : {}),
    departs: shown.map(toolRow),
    ...(alertes.length ? { info_trafic: alertes } : {}),
    horaires: timetables(live, feeds),
    reseaux: networksOf(groups.map((g) => g.reseau)),
    sources: credits([transit.SOURCE, ...(used ? [rt.SOURCE] : [])]),
  });
}

const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
type Day = ReturnType<typeof day>;
/** « dimanche 25 octobre », « dimanche 1er novembre ». */
const dayName = (d: Day) => `${WEEKDAYS[d.weekday]} ${d.ymd % 100 === 1 ? "1er" : d.ymd % 100} ${MONTHS[(Math.floor(d.ymd / 100) % 100) - 1]}`;
const iso = (d: Day) => `${Math.floor(d.ymd / 10000)}-${String(Math.floor(d.ymd / 100) % 100).padStart(2, "0")}-${String(d.ymd % 100).padStart(2, "0")}`;

const netOf = (pattern: number) => transit.ROUTES[transit.ENDS[pattern][0]][0];
/** Whether a trip of this pattern runs on that day, by the services in the bundle. */
const runsOn = (pattern: number, d: Day) => transit.servicesOf(pattern).some((sv) => transit.serviceRuns(netOf(pattern), sv, d.ymd, d.weekday));

/**
 * Why nothing runs on that day: a public holiday (the State's calendar), a weekday the lines never run on, or a date the
 * networks' calendars leave out. « », when there is nothing to say.
 */
async function whyNot(patterns: number[], d: Day, cache?: Cache): Promise<string> {
  if (cache) {
    try {
      const name = (await holidays(cache, Math.floor(d.ymd / 10000))).value[iso(d)];
      if (name) return `, jour férié (${name})`;
    } catch (err) {
      console.error("jours fériés indisponibles :", why(err));
    }
  }
  // The same weekday in the next three weeks: a line that never runs on it, or only this date left out.
  const weeks = [1, 2, 3].map((w) => ({ ymd: addDays(d.ymd, 7 * w), weekday: d.weekday }));
  return weeks.some((w) => patterns.some((p) => runsOn(p, w))) ? ", un jour sans service au calendrier du réseau" : `, elle ne circule pas le ${WEEKDAYS[d.weekday]}`;
}

/** YYYYMMDD plus `n` days. */
function addDays(ymd: number, n: number): number {
  const t = Date.UTC(Math.floor(ymd / 10000), (Math.floor(ymd / 100) % 100) - 1, ymd % 100) + n * 86_400_000;
  return Number(new Date(t).toISOString().slice(0, 10).replace(/-/g, ""));
}

/** For a stop with no departure in the next hours: that nothing of it runs today, and why. « » otherwise. */
async function quiet(groups: transit.StopGroup[], now: Date, cache?: Cache): Promise<string> {
  const ids = groups.flatMap((g) => g.ids);
  const pats = [...new Set((await transit.passes(ids)).map((p) => p.pattern))];
  const today = day(now);
  if (!pats.length || pats.some((p) => runsOn(p, today))) return "";
  return ` Aucune ligne ne s'y arrête aujourd'hui, ${dayName(today)}${await whyNot(pats, today, cache)}.`;
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
      resume: `Plusieurs réseaux ont une ligne « ${ligne} » : ${routes.map((r) => `${lineName(r).ligne}${lineName(r).nom_ligne ? ` (${lineName(r).nom_ligne})` : ""}, ${lineName(r).reseau}`).join(" ; ")}.`,
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
  const when = ahead ? `le ${dayName(d)}` : "aujourd'hui";
  let resume = ahead
    ? `La ligne ${said_line} ne circule pas aujourd'hui, ${dayName(today)}${await whyNot(pats, today, cache)}, d'après les horaires publiés. Sa prochaine journée, ${dayName(d)} : `
    : `Ligne ${said_line}, d'après les horaires publiés : `;
  resume += sens.map(({ out }) => {
    const s = out.departs_du_jour as ReturnType<typeof daySummary>;
    return `${out.direction}${out.nombre_arrets ? `, ${out.nombre_arrets} arrêts` : ""}, ${s.nombre} départ${s.nombre > 1 ? "s" : ""} ${when}${s.nombre ? `, de ${s.premier} à ${s.dernier}` : ""}`;
  }).join(" ; ") + ".";
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
          buses.slice(0, 4).map((b) => `${b.vers ? `vers ${b.vers}, ` : ""}${b.ou ?? "loin de tout arrêt"} à ${b.heure_de_la_position}`).join(" ; ") + "."
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
      if (shownAt.shown.length) resume += ` Prochains départs à ${groups[0].nom} : ${shownAt.shown.slice(0, 4).map(said).join(" ; ")}.`;
    }
  }
  const used = !!buses?.length || (!!shownAt && (shownAt.live.length > 0 || shownAt.alertes.length > 0));
  return text({
    resume,
    ligne: name,
    jour: dayName(d),
    sens: sens.map((x) => x.out),
    ...(buses?.length ? { bus_en_circulation: buses } : {}),
    ...(stopsOf ? {} : { note: "Liste des arrêts indisponible pour le moment : seuls les terminus et les horaires sont donnés." }),
    ...(place ? { arret: place } : {}),
    ...(shownAt?.shown.length ? { departs: shownAt.shown.map(toolRow) } : {}),
    ...(shownAt?.alertes.length ? { info_trafic: shownAt.alertes } : {}),
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
