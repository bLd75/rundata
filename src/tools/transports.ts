import { distanceKm } from "../geo.js";
import { INSEE } from "../places/insee.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import * as transit from "../providers/transit.js";
import { why } from "../types.js";
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
      .map((g) => ({ g, n: words.filter((w) => matches(g, w)).length, extra: extra(g) }))
      .filter((s) => s.n >= Math.max(1, Math.ceil(words.length / 2)));
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

const hm = (s: number) => {
  const t = ((s % 86400) + 86400) % 86400;
  return `${Math.floor(t / 3600)}h${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;
};

/** Local day as YYYYMMDD and Monday-first weekday, `back` days before `now`. */
function day(now: Date, back = 0) {
  const d = new Date(now.getTime() + 4 * 3600_000 - back * 86_400_000);
  return { ymd: Number(d.toISOString().slice(0, 10).replace(/-/g, "")), weekday: (d.getUTCDay() + 6) % 7 };
}

export interface Departure {
  /** Seconds from now. */
  in: number;
  at: number;
  route: number;
  headsign: string;
  reseau: string;
  arret: string;
}

/** Departures from these stops in the next `horizon` seconds, by today's and yesterday's services (after midnight). */
export async function departures(groups: transit.StopGroup[], now: Date, horizon = 3 * 3600): Promise<Departure[]> {
  const stopGroup = new Map(groups.flatMap((g) => g.ids.map((id) => [id, g] as const)));
  const pass = await transit.passes([...stopGroup.keys()]);
  const pats = await transit.patterns([...new Set(pass.map((p) => p.pattern))]);
  const local = new Date(now.getTime() + 4 * 3600_000);
  const secs = local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds();
  const today = day(now);
  const yesterday = day(now, 1);
  const out: Departure[] = [];
  for (const p of pass) {
    const pat = pats.get(p.pattern);
    const g = stopGroup.get(p.stop);
    if (!pat || !g) continue;
    for (const [service, start] of pat.trips) {
      const t = start + p.offset;
      for (const [d, shift] of [[today, 0], [yesterday, 86400]] as const) {
        const dt = t - shift - secs;
        if (dt >= -60 && dt <= horizon && transit.serviceRuns(g.reseau, service, d.ymd, d.weekday)) {
          // A terminus named after its bay: « Gare Routière Du Tampon Quai Q » is the bus station.
          out.push({ in: dt, at: t - shift, route: pat.route, headsign: pat.headsign.replace(/\s+quai\s+\S+$/i, ""), reseau: g.reseau, arret: g.nom });
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

export async function transports(asked: string, ligne: string | undefined, now = new Date()) {
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
  const shown = spread(list);
  const stops = groups.map((g) => ({
    nom: g.nom,
    commune: g.commune,
    reseau: transit.NETWORKS[g.reseau]?.nom ?? g.reseau,
    distance_m: near.find((x) => x.g === g) ? Math.round(near.find((x) => x.g === g)!.m / 10) * 10 : undefined,
  }));
  const where = stops.map((s) => `${s.nom} (${s.commune}, ${s.reseau})`).join(", ");
  const resume = shown.length
    ? `Prochains départs à ${where}, d'après les horaires publiés : ` +
      shown.slice(0, 5).map((d) => `${lineName(d.route).ligne} vers ${d.headsign} à ${hm(d.at)} (dans ${fr(Math.max(0, Math.round(d.in / 60)))} min)`).join(" ; ") + "."
    : `Aucun départ prévu dans les prochaines heures à ${where}${ligne ? ` pour la ligne ${ligne}` : ""}, d'après les horaires publiés.`;
  return text({
    resume,
    arrets: stops,
    ...(near.length ? { note: `Arrêts les plus proches de « ${asked} » : préciser le nom de l'arrêt pour un résultat exact.` } : {}),
    departs: shown.map((d) => ({ heure: hm(d.at), dans_min: Math.max(0, Math.round(d.in / 60)), ...lineName(d.route), direction: d.headsign, arret: d.arret })),
    horaires: "théoriques, publiés par chaque réseau : retards, suppressions et déviations ne sont pas pris en compte",
    reseaux: [...new Set(groups.map((g) => g.reseau))].map((n) => ({ nom: transit.NETWORKS[n].nom, exploitant: transit.NETWORKS[n].exploitant, horaires_valables_jusqu_au: transit.NETWORKS[n].valide_jusqu_au ?? undefined })),
    sources: credits([transit.SOURCE]),
  });
}
