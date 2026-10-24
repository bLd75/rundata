import type { Cache } from "../cache.js";
import { distanceKm, localTime } from "../geo.js";
import { INSEE } from "../places/insee.js";
import { normalize, resolvePlace } from "../places/resolve.js";
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
  /** From the real-time feed: seconds late (early when negative) at this stop, or that the bus will not stop. */
  retard?: number;
  supprime?: boolean;
}

/** Seconds from now until the bus is expected: the real-time feed's time when there is one. */
const expected = (d: Departure) => d.in + (d.retard ?? 0);
/** The delay in whole minutes, as the difference of the two times shown (« 21h05 », « 21h07 »): never at odds with them. */
const delayMinutes = (d: Departure) => Math.floor((d.at + (d.retard ?? 0)) / 60) - Math.floor(d.at / 60);

/** Departures from these stops in the next `horizon` seconds, by yesterday's (after midnight), today's and tomorrow's services. */
export async function departures(groups: transit.StopGroup[], now: Date, horizon = 3 * 3600): Promise<Departure[]> {
  const stopGroup = new Map(groups.flatMap((g) => g.ids.map((id) => [id, g] as const)));
  const pass = await transit.passes([...stopGroup.keys()]);
  const pats = await transit.patterns([...new Set(pass.map((p) => p.pattern))]);
  const local = new Date(now.getTime() + 4 * 3600_000);
  const secs = local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds();
  const today = day(now);
  const yesterday = day(now, 1);
  const tomorrow = day(now, -1);
  const out: Departure[] = [];
  for (const p of pass) {
    const pat = pats.get(p.pattern);
    const g = stopGroup.get(p.stop);
    if (!pat || !g) continue;
    for (const [service, start, trip] of pat.trips) {
      const t = start + p.offset;
      for (const [d, shift] of [[today, 0], [yesterday, 86400], [tomorrow, -86400]] as const) {
        const dt = t - shift - secs;
        if (dt >= -60 && dt <= horizon && transit.serviceRuns(g.reseau, service, d.ymd, d.weekday)) {
          // A terminus named after its bay: « Gare Routière Du Tampon Quai Q » is the bus station.
          out.push({ in: dt, at: t - shift, route: pat.route, headsign: pat.headsign.replace(/\s+quai\s+\S+$/i, ""), reseau: g.reseau, arret: g.nom, trip, stop: p.stop });
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
        if (f && now.getTime() / 1000 - f.at < rt.MAX_AGE_SECONDS && (f.cancelled.length || f.alerts.length || Object.keys(f.trips).length)) out.set(n, f);
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
const delayText = (m: number) => (m === 0 ? "à l'heure" : m > 0 ? `${fr(m)} min de retard` : `${fr(-m)} min d'avance`);

export async function transports(asked: string, ligne: string | undefined, now = new Date(), cache?: Cache) {
  // A boat to Mauritius has no timetable to look for: the answer is that there is none.
  if (asksCrossing(asked)) return text({ resume: FERRY.outil });
  if (!transit.enabled()) {
    return { ...text({ erreur: "Les horaires de bus ne sont disponibles que sur le serveur en ligne (https://rundata.re/mcp)." }), isError: true };
  }
  const { groups, near } = findStops(asked);
  if (!groups.length) {
    return text({
      resume: `Aucun arrêt de bus trouvé pour « ${asked} ».`,
      conseil: "Donner le nom de l'arrêt et sa commune (« Gare routière, Saint-Pierre », « Mairie, Le Tampon »), ou un lieu proche.",
      sources: credits([transit.SOURCE]),
    });
  }
  let list: Departure[];
  try {
    list = await departures(groups, now);
    if (list.length < 3) list = await departures(groups, now, 20 * 3600);
  } catch (err) {
    console.error(`source ${transit.SOURCE.id} indisponible:`, why(err));
    return { ...text({ erreur: "Les horaires de bus ne répondent pas pour le moment.", conseil: "Réessayer dans un instant." }), isError: true };
  }
  if (ligne?.trim()) {
    const l = normalize(ligne).replace(/^ligne /, "");
    list = list.filter((d) => {
      const [, short, long] = transit.ROUTES[d.route];
      return normalize(short) === l || normalize(long).includes(l);
    });
  }
  const feeds = cache ? await realtimeFeeds(groups.map((g) => g.reseau), cache, now) : new Map<string, rt.Realtime>();
  list = applyRealtime(list, feeds, now);
  const shown = spread(list);
  const alertes = alertsFor(groups, shown, feeds, now);
  const stops = groups.map((g) => ({
    nom: g.nom,
    commune: g.commune,
    reseau: transit.NETWORKS[g.reseau]?.nom ?? g.reseau,
    distance_m: near.find((x) => x.g === g) ? Math.round(near.find((x) => x.g === g)!.m / 10) * 10 : undefined,
  }));
  const where = stops.map((s) => `${s.nom} (${s.commune}, ${s.reseau})`).join(", ");
  // The networks whose departures shown come from the feed: a bus not in it keeps its timetable.
  const live = [...new Set(shown.filter((d) => d.retard !== undefined || d.supprime).map((d) => transit.NETWORKS[d.reseau].nom))];
  const said = (d: Departure) =>
    `${lineName(d.route).ligne} vers ${d.headsign} ` +
    (d.supprime
      ? `${atTime(d.at)} : ne passe pas à cet arrêt (temps réel)`
      : d.retard !== undefined
        ? `${atTime(d.at + d.retard)} (${wait(minutes(d))}, ${delayText(delayMinutes(d))} en temps réel)`
        : `${atTime(d.at)} (${wait(minutes(d))})`);
  const resume = shown.length
    ? `Prochains départs à ${where}, d'après ${live.length ? "le temps réel et " : ""}les horaires publiés : ` + shown.slice(0, 5).map(said).join(" ; ") + "." +
      (alertes.length ? ` Info trafic : ${alertes.map((a) => `${a.lignes ? `ligne ${a.lignes.join(", ")}, ` : ""}${a.titre}`).join(" ; ")}.` : "")
    : `Aucun départ prévu dans les prochaines heures à ${where}${ligne ? ` pour la ligne ${ligne}` : ""}, d'après les horaires publiés.`;
  const at = [...feeds.values()].reduce((m, f) => Math.max(m, f.at), 0);
  const used = live.length > 0 || alertes.length > 0;
  return text({
    resume,
    arrets: stops,
    ...(near.length ? { note: `Arrêts les plus proches de « ${asked} » : préciser le nom de l'arrêt pour un résultat exact.` } : {}),
    departs: shown.map(departureRow),
    ...(alertes.length ? { info_trafic: alertes } : {}),
    horaires: live.length
      ? `${live.join(", ")} : heures annoncées en temps réel par le réseau (flux de ${localTime(new Date(at * 1000)).split(" ")[1]}) quand le bus y figure ; sinon horaires théoriques, sans les retards ni les déviations`
      : "théoriques, publiés par chaque réseau : retards, suppressions et déviations ne sont pas pris en compte",
    reseaux: [...new Set(groups.map((g) => g.reseau))].map((n) => ({ nom: transit.NETWORKS[n].nom, exploitant: transit.NETWORKS[n].exploitant, horaires_valables_jusqu_au: transit.NETWORKS[n].valide_jusqu_au ?? undefined })),
    sources: credits([transit.SOURCE, ...(used ? [rt.SOURCE] : [])]),
  });
}
