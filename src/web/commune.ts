/**
 * One page per commune, every category at once: its weather, the vigilance of its zone, its air, its sea, its next
 * buses, whether its town hall is open, its sunrise and sunset; then what holds for the whole island. The weather is
 * the copy of /meteo/<commune>, the town hall and the buses the commune's own copy, the rest the last copy of each
 * category page (web/site.ts), so a page costs a few reads.
 */
import { porte, type Porte, SHEET as ALLER } from "./aller.js";
import type { Cached } from "../cache.js";
import { daysApart, localTime } from "../geo.js";
import { normalize } from "../places/resolve.js";
import * as cal from "../providers/calendrier.js";
import * as mf from "../providers/vigilance.js";
import * as sante from "../sante/etablissements.js";
import * as enfants from "../vie/enfants.js";
import * as dech from "../vie/decheteries.js";
import * as antennes from "../vie/antennes.js";
import * as internet from "../vie/internet.js";
import * as loyers from "../vie/loyers.js";
import { anchorOf } from "./decheteries.js";
import { hoursOn, openNow } from "../tools/annuaire.js";
import { de, fr, nombre } from "../tools/format.js";
import { tidesNear } from "../tools/maree.js";
import { coastText, cyclone, cycloneLevel, feminine, forZone, highest, NONE_ISSUED, zoneLevels, zoneShort } from "../tools/vigilance.js";
import type { AgendaAnswer, AirAnswer, Alerte, CalendrierAnswer, CommuneData, DechetsAnswer, CoupuresAnswer, EauAnswer, ElectriciteAnswer, PlaceData, RandonneesAnswer, SeaData, SecheresseAnswer, VolcanAnswer } from "./data.js";
import { credit, joursDuJour } from "./data.js";
import { aCommune, LINK } from "./aujourdhui.js";
import { waterLive } from "./coupures.js";
import { communeEvents, communeHikes } from "./liens.js";
import { alertList, aq, bikeStock, calendrierLive, departureLi, electriciteLive, stillToCome, volcanLive, waitText } from "./domains.js";
import { communePath as enfantsPath, enfantsLive } from "./enfants.js";
import { esc, islandMap } from "./map.js";
import { ask, connector, credits, cycloneVg, dayMonth, deg, empty, fit, hm, icon, ISLAND, layout, type Live, lue, metres, officielLive, readAt, seaName, SITE, SLOGAN, thin, vg } from "./pages.js";
import { coastal, PAGES, type PlacePage } from "./places.js";
import { LINE as BAIGNADE_LINE } from "./baignade.js";
import { RSS_HINT, rssLink, rssPath, rssTitle } from "./rss.js";
import { INSEE } from "../places/insee.js";
import { ligneTuile } from "./antennes.js";
import * as sitesHs from "../providers/sites-hs.js";

/** What a commune's page is made of, each part null or missing when there is no copy yet. */
export interface CommuneLive {
  place: Cached<PlaceData> | null;
  commune?: Cached<CommuneData> | null;
  vigilance?: Cached<mf.Vigilance> | null;
  air?: Cached<AirAnswer> | null;
  mer?: Cached<SeaData> | null;
  volcan?: Cached<VolcanAnswer> | null;
  electricite?: Cached<ElectriciteAnswer> | null;
  calendrier?: Cached<CalendrierAnswer> | null;
  coupures?: Cached<CoupuresAnswer> | null;
  secheresse?: Cached<SecheresseAnswer> | null;
  eau?: Cached<EauAnswer> | null;
  randonnees?: Cached<RandonneesAnswer> | null;
  agenda?: Cached<AgendaAnswer> | null;
  /** The West's communes only (the TCO publishes its déchèteries). */
  dechets?: Cached<DechetsAnswer> | null;
  /** The mobile sites out of service, the Arcep's file of the day (providers/sites-hs.ts). */
  hs?: Cached<sitesHs.Copie> | null;
}

export const COMMUNES = PAGES.filter((p) => p.commune);

const hub = (p: PlacePage) => `/communes/${p.slug}`;

interface Tile {
  icon: string;
  nom: string;
  /** The category page, or none (the town hall, the land). */
  href?: string;
  live?: Live;
  /** HTML after the figure: a list of departures. */
  more?: string;
  question?: string;
  foot?: string;
  wide?: boolean;
  /** A tile with a list (the buses, the bikes): a whole row of the grid, its rows side by side where there is room. */
  full?: boolean;
}

/** The columns of the grid of tiles: 2 on a phone, 3 from 46rem, 4 from 66rem (pages.ts `.tiles`). */
export const COLUMNS = [2, 3, 4] as const;

/**
 * Each tile's span at each of COLUMNS, the grid packed densely (`.tiles.fit`, `grid-auto-flow: dense`): a tile with a
 * list takes a whole row, a wide one two columns, the others one, each in the first place it fits. A gap that no later
 * tile fills is given to the tile on its left in its row: the grid has no hole, and no tile beside a list stretched to
 * its height with nothing in it.
 */
export function spans(tiles: Pick<Tile, "wide" | "full">[]): number[][] {
  const out = tiles.map(() => [] as number[]);
  for (const c of COLUMNS) {
    const span = tiles.map((t) => (t.full ? c : t.wide ? 2 : 1));
    const rows: (number | undefined)[][] = [];
    span.forEach((s, i) => {
      for (let r = 0; ; r++) {
        const row = (rows[r] ??= Array<number | undefined>(c).fill(undefined));
        const at = row.findIndex((_, x) => x + s <= c && row.slice(x, x + s).every((v) => v === undefined));
        if (at >= 0) {
          row.fill(i, at, at + s);
          break;
        }
      }
    });
    for (const row of rows)
      for (let x = 1; x < c; x++)
        if (row[x] === undefined && row[x - 1] !== undefined) {
          span[row[x - 1]!]++;
          row[x] = row[x - 1];
        }
    span.forEach((s, i) => out[i].push(s));
  }
  return out;
}

/** The tile's spans at each width (`spans`), those of more than one column only. */
const spanStyle = (s: number[]) => {
  const v = s.map((n, k) => (n > 1 ? `--s${COLUMNS[k]}:${n}` : "")).filter(Boolean);
  return v.length ? ` style="${v.join(";")}"` : "";
};

function tile(t: Tile, span: number[] = []): string {
  const head = t.href ? `<h3><a href="${t.href}">${esc(t.nom)}</a></h3>` : `<h3>${esc(t.nom)}</h3>`;
  const body = t.live?.vide
    ? `<p class="td all">${t.live.detail}</p>`
    : t.live
    ? `<p class="tv">${t.live.valeur}</p><p class="td${t.live.entier ? " all" : ""}"${t.live.title ? ` title="${esc(t.live.title)}"` : ""}>${t.live.detail}</p>`
    : t.question
      ? `<p class="tq">« ${esc(t.question)} »</p>`
      // No copy at all: the read is under way (a copy with nothing to show says so, `vide`).
      : `<p class="td all">Se met à jour : rechargez la page dans quelques secondes.</p>`;
  const foot = t.foot ?? (t.href ? `<span class="go" aria-hidden="true">Voir →</span>` : "");
  return `<li class="tile${t.wide ? " wide" : ""}"${spanStyle(span)}>${icon(t.icon)}${head}${body}${t.more ?? ""}${foot ? `<p class="tf"><span></span>${foot}</p>` : ""}</li>`;
}

function weather(p: PlacePage, data: Cached<PlaceData> | null, now: Date): Live | undefined {
  if (!data) return undefined;
  const s = data.value.meteo?.stations.find((x) => x.mesures.temperature);
  if (!s) return empty(`Aucune température près de ${p.nom} dans la lecture ${readAt(data.fetchedAt, now).de}.`);
  // In the evening, tomorrow's forecast rather than what is left of today; from today's, whenever the copy was made.
  const evening = new Date(now.getTime() + 4 * 3600_000).getUTCHours() >= 17;
  const jours = joursDuJour(data!.value.prevision?.jours, data.fetchedAt, now);
  const f = (evening && jours[1]) || jours[0];
  return {
    valeur: esc(thin(s.mesures.temperature!)),
    detail: `station ${esc(s.station)} (${metres(s.altitude_m)}${s.distance_km != null ? `, à ${fr(s.distance_km)} km` : ""}), mesuré à ${esc(s.heure_mesure.split(" ")[1] ?? s.heure_mesure)}` +
      (f?.temperature_min && f.temperature_max ? ` · prévision ${esc(f.jour.toLowerCase())} : ${esc(thin(f.temperature_min))} à ${esc(thin(f.temperature_max))}` : ""),
  };
}

function vigilance(p: PlacePage, data: Cached<mf.Vigilance> | null | undefined, now: Date): Live | undefined {
  const v = data?.value;
  if (!v) return undefined;
  const cyc = v.zones[mf.ISLAND]?.[mf.CYCLONE] ?? [];
  if (highest(cyc) >= 2) {
    const c = Math.max(2, cycloneLevel(cyc, now));
    return officielLive(lue({ valeur: `<span class="vg ${cycloneVg(c)}">Cyclone : ${esc(mf.cycloneName(c))}</span>`, detail: esc(cyclone(v, now)) }, data!, now), mf.OFFICIEL_CYCLONE);
  }
  // The zone of Météo-France, as its own, the commune only said to be in it: never a colour given to a commune.
  const zone = mf.ZONE_OF_COMMUNE[p.nom];
  const name = zoneShort(zone);
  const { above, issued } = zoneLevels(v, zone, now);
  const colour = (c: number) => vg(c, feminine(mf.colour(c)));
  const said = above.length ? above.map((x) => `${colour(x.couleur)} ${esc(x.phenomene.toLowerCase())}`).join(", ") : issued ? colour(1) : esc(NONE_ISSUED);
  const coast = coastal(p) ? coastText(v) : undefined;
  return officielLive(lue({
    // As /aujourdhui says it (tools/resume.ts): « Vigilance météo : verte » / « pour l'Ouest (Météo-France), la zone de Saint-Paul ».
    valeur: `Vigilance météo : ${said}`,
    detail: esc(`${forZone(name)} (Météo-France), la zone de ${p.nom}`) + (coast ? ` · ${esc(coast)}` : ""),
  }, data!, now), mf.OFFICIEL_VIGILANCE);
}

const airOf = (p: PlacePage, data: Cached<AirAnswer> | null | undefined) => data?.value.communes?.find((x) => normalize(x.commune) === normalize(p.nom));

function air(p: PlacePage, data: Cached<AirAnswer> | null | undefined, now: Date): Live | undefined {
  if (!data) return undefined;
  const c = airOf(p, data);
  if (!c) return empty(`${p.nom} n'est pas dans l'indice ATMO lu ${readAt(data.fetchedAt, now).a}.`);
  return { valeur: aq(c.niveau), detail: `indice ATMO prévu pour aujourd'hui${c.polluants.length ? ` (${esc(c.polluants.join(", "))})` : ""}, d'Atmo Réunion` };
}

function sea(p: PlacePage, mer: Cached<SeaData> | null | undefined, place: Cached<PlaceData> | null, now: Date): Live | undefined {
  const mine = mer?.value.plages.filter((b) => b.commune === p.nom) ?? [];
  // The next tide, computed at the view (no request): a computation of rundata, never the SHOM's prediction.
  const t = tidesNear(p.place.lon, p.place.lat, now, mer?.value.maree ?? [], mer?.fetchedAt)?.next.liste[0];
  const tide = t ? ` · ${esc(t.type)} ${esc(t.heure)} (marée calculée, pas le SHOM)` : "";
  const beaches = mine.filter((b) => b.valeur != null);
  // The waves are a forecast: said after the measurement, and called so.
  const waves = mine.map((b) => b.houle?.hauteur_m).filter((h): h is number => h != null);
  const placeWaves = place?.value.mer?.etat_de_la_mer?.maintenant.hauteur;
  const swell = waves.length ? `${fr(Math.max(...waves))} m` : placeWaves;
  const prevue = swell ? ` · houle prévue : ${esc(thin(swell))}` : "";
  if (beaches.length) {
    const v = beaches.map((b) => b.valeur!);
    const lo = Math.round(Math.min(...v));
    const hi = Math.round(Math.max(...v));
    return {
      valeur: lo === hi ? thin(deg(lo)) : `${lo} à ${thin(deg(hi))}`,
      detail: `au large ${beaches.length > 1 ? "des plages" : "de la plage"} ${esc(beaches.map((b) => seaName(b.nom)).join(", "))}, par satellite le ${esc(dayMonth(beaches.map((b) => b.jour!).sort().pop()!))}${prevue}${tide}`,
    };
  }
  const m = place?.value.mer?.mesure;
  if (m) return { valeur: esc(thin(m.temperature_eau)), detail: `au large, par satellite le ${esc(dayMonth(m.jour_mesure))}${prevue}${tide}` };
  if (swell) return { valeur: esc(thin(swell)), detail: `houle prévue au large (prévision d'un modèle, pas une mesure)${tide}` };
  const read = mer ?? place;
  return read ? empty(`Pas de mesure satellite au large ${de(p.nom)} dans la lecture ${readAt(read.fetchedAt, now).de}.`) : undefined;
}

/** The departures still to come: the copy is up to a few minutes old, its waits are counted again from now. */
function buses(p: PlacePage, data: Cached<CommuneData> | null | undefined, now: Date): { live?: Live; more?: string } {
  if (!data) return {};
  const b = data.value.bus;
  // Its departures not read (the source failed, or no stop was found): never « pas de départ », which would be wrong.
  if (!b) return { live: empty(`Horaires des bus absents de la lecture ${readAt(data.fetchedAt, now).de}.`) };
  const left = stillToCome(b.departs, data.fetchedAt, now).slice(0, 4);
  const where = b.gare ? `à la gare ${esc(de(p.nom))}` : `près du centre, arrêt ${esc(b.arrets[0].nom)}`;
  if (!left.length) return { live: { valeur: "Pas de départ", detail: `${where} dans les prochaines heures, d'après les horaires publiés` } };
  const first = left.find(({ x }) => !x.temps_reel) ?? left[0];
  return {
    live: { valeur: esc(first.heure), detail: `prochain départ ${where} : ligne ${esc(first.x.ligne)} vers ${esc(first.x.direction)} (${esc(first.x.reseau)})` },
    more: `<ul class="rows departs cols">${left.map(({ x, min, heure }) => departureLi(x, waitText(min, heure))).join("")}</ul>` +
      (b.alertes?.length ? `<div class="note">Info trafic : ${alertList(b.alertes)}</div>` : ""),
  };
}

/**
 * Past this, the bikes counted in the commune's copy are not said as those of the moment. The copy is built again only
 * when the page is viewed: the first view after a quiet night finds the evening's, and the next one, seconds later, the
 * new copy (web/data.ts `snapshot`).
 */
export const BIKES_STALE_MS = 30 * 60_000;
/** The stations listed in the tile, those with bikes first; the others on /velos. */
const BIKES_SHOWN = 4;

/** « à 15:35 » the same day, « hier à 15:35 » the day before, « le 29/10 à 15:35 » before. */
const readOn = (at: Date, now: Date) => (daysApart(at, now) === 1 ? `hier à ${hm(at)}` : readAt(at, now).a);

/** A station on one line: its name and its bikes, « Y aller » beside them when its copy kept its position. */
function bikeLine(s: NonNullable<CommuneData["velos"]>[number], g: Porte): string {
  const go = g.aller({ nom: s.nom, lat: s.lat ?? NaN, lon: s.lon ?? NaN });
  return `<li><span>${esc(s.nom)}<small>${bikeStock(s)}</small></span>${go ? `<span class="ya">${go}</span>` : ""}</li>`;
}

/** The commune's Altervélo stations: how many bikes in all, and those with the most; only their number once the count is old. */
function bikes(data: Cached<CommuneData> | null | undefined, g: Porte, now: Date): { live?: Live; more?: string } | undefined {
  const list = data?.value.velos;
  if (!list?.length) return undefined;
  const stations = `${list.length} station${list.length > 1 ? "s" : ""}`;
  const at = readOn(data!.fetchedAt, now);
  if (now.getTime() - data!.fetchedAt.getTime() > BIKES_STALE_MS)
    // The instruction first, and never cut: a description may be, not what to do (marketing, 31/10).
    return { live: { valeur: stations, detail: `Rechargez la page dans quelques secondes\u00a0: vélos libres comptés ${at}.`, entier: true } };
  const total = list.filter((s) => !s.etat || s.etat === "dépôt impossible en ce moment").reduce((n, s) => n + s.velos_electriques + (s.trottinettes ?? 0), 0);
  return {
    live: { valeur: `${total} vélo${total > 1 ? "s" : ""}`, detail: `électriques en libre-service dans ${stations} Altervélo, relevé ${at}` },
    more: `<ul class="rows velos cols">${list.slice(0, BIKES_SHOWN).map((s) => bikeLine(s, g)).join("")}</ul>`,
  };
}

/** The commune's déchèteries: how many take the green waste and the bulky items now, else that they are to be checked. */
function wasteLive(p: PlacePage, data: Cached<DechetsAnswer> | null | undefined, now: Date): Live | undefined {
  if (!data) return undefined;
  const here = dech.sitesNow(data.value.etats, now).filter((s) => s.commune === p.nom);
  const fresh = here.filter((s) => s.a_jour);
  const taking = (kind: string) => fresh.filter((s) => s.accepte.includes(kind)).length;
  return {
    valeur: `${here.length} déchèterie${here.length > 1 ? "s" : ""}`,
    detail: fresh.length
      ? `d'après les agents : déchets verts acceptés dans ${taking("déchets verts")} sur ${fresh.length}, encombrants dans ${taking("encombrants")} sur ${fresh.length}`
      : "état des bennes à vérifier sur place",
  };
}

/** The commune's pharmacies, from FINESS; the duty one only from 3237.fr or the 32 37. */
function pharmacies(p: PlacePage): Live {
  const n = sante.inCommune(p.nom, ["pharmacie"]).length;
  return {
    valeur: n ? `${n} pharmacie${n > 1 ? "s" : ""}` : "Pas de pharmacie",
    detail: `${n ? "dans la commune" : "recensée dans la commune"} ; de garde la nuit, le dimanche et les jours fériés : 3237.fr ou le 32 37 (payant)`,
  };
}

/** The places to go with children (vie/enfants.ts): how many, and of which kinds. */
function children(p: PlacePage): Live | undefined {
  const list = enfants.inCommune(p.nom);
  return list.length ? enfantsLive(list) : undefined;
}

/** The rents asked in the ads (vie/loyers.ts): a reference flat's per m², and a house's; one vintage a year. */
function rents(p: PlacePage): Live | undefined {
  const c = loyers.ofCommune(p.nom);
  const f = c?.appartement;
  if (!f) return undefined;
  // Marketing's words (26/10), the ANIL's mention word for word.
  return {
    valeur: esc(loyers.m2(f.loyer_m2)),
    detail: `appartement type de ${loyers.SURFACE.appartement}\u00a0m², non meublé, charges comprises, d'après les annonces du 3e trimestre ${loyers.MILLESIME}` +
      `${c.maison ? ` · maison type ${esc(loyers.m2(c.maison.loyer_m2))}` : ""} · ${esc(loyers.SOURCE.attribution)}` +
      `${f.zone ? " · estimé avec des communes voisines, faute d'annonces assez nombreuses" : ""}${loyers.fragile(f) ? " · à prendre avec prudence, selon l'ANIL" : ""}`,
    // Never cut to three lines: the ANIL's mention must be read wherever a rent is.
    entier: true,
  };
}

/** How the premises can be connected (vie/internet.ts): the fibre's share; one release a quarter, never live. */
function connexion(p: PlacePage): Live | undefined {
  const c = internet.ofCommune(p.nom);
  if (!c) return undefined;
  const next = internet.TECHNOS.filter((t) => t !== "fibre" && c[t]).sort((x, y) => c[y]! - c[x]!)[0];
  // Marketing's words (26/10): « éligible » with « ce qui ne veut pas dire raccordés », never « fibré » nor « couvert ».
  return {
    valeur: esc(internet.pct(internet.part(c, "fibre"))),
    detail: `des logements et locaux professionnels sont éligibles à la fibre au ${internet.dateLongue()}, ce qui ne veut pas dire raccordés` +
      `${next === "4g_fixe" ? ` · 4G fixe au mieux pour ${esc(internet.pct(internet.part(c, next)))}` : ""} · Arcep, Ma connexion internet`,
    // Never cut to three lines: « ce qui ne veut pas dire raccordés » must be read.
    entier: true,
  };
}

/**
 * The commune's antenna supports (vie/antennes.ts): by operator, with the 5G techniquement opérationnelle, and the radio
 * and TV ones; then, only when the Arcep's file of the day has some there, its mobile sites out of service.
 */
function antennas(p: PlacePage, hs?: Cached<sitesHs.Copie> | null): Live | undefined {
  const { supports, emetteurs } = antennes.ofCommune(p.nom);
  if (!supports.length) return undefined;
  // The ANFR never writes « en service » for the 5G: its most advanced state there is « techniquement opérationnel ».
  const g5 = supports.filter((s) => antennes.generations(s, "operationnel").has("5")).length;
  const ops = antennes.OPERATEURS.map((o) => [o, supports.filter((s) => s.ops[o]).length] as const).filter(([, n]) => n);
  // Marketing's words (29/10): the ANFR's « supports », declared, never « couverture ».
  return {
    valeur: `${nombre(supports.length)}`,
    // One support may carry several operators: « Orange sur 2 », never a sum.
    detail: `supports d'antennes mobiles dans la commune, déclarés à l'ANFR au ${internet.dateLongue(antennes.MOBILE_DU)}, ${g5 ? `dont ${nombre(g5)} avec la 5G techniquement opérationnelle` : "aucun avec la 5G techniquement opérationnelle"}` +
      ` · ${ops.map(([o, n]) => `${o} sur ${nombre(n)}`).join(", ")}` +
      `${emetteurs.length ? ` · ${nombre(emetteurs.length)} ${emetteurs.length > 1 ? "supports" : "support"} d'émetteurs de radio ou de télévision de plus de 5\u00a0W (FM, TNT, DAB+)` : ""} · ANFR` +
      `${horsService(hs, p) ? ` · ${esc(horsService(hs, p)!)}` : ""}`,
    entier: true,
  };
}

/** The commune's mobile sites out of service, by its INSEE code. */
const horsService = (hs: Cached<sitesHs.Copie> | null | undefined, p: PlacePage) => ligneTuile(hs ?? null, INSEE[p.nom]);

function townHall(data: Cached<CommuneData> | null | undefined, now: Date): Live | undefined {
  const o = data?.value.mairie;
  if (!o) return undefined;
  const open = openNow(o, now);
  const today = hoursOn(o, now);
  return {
    valeur: open === null ? "Horaires non publiés" : open ? "Ouverte" : "Fermée",
    detail: `${open === null ? "" : today ? `aujourd'hui ${esc(today)} · ` : "fermée aujourd'hui · "}${esc(o.adresse)}${o.telephone ? ` · ${esc(o.telephone)}` : ""}`,
  };
}

function sunTimes(p: PlacePage, calendrier: Cached<CalendrierAnswer> | null | undefined, now: Date): Live {
  const day = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
  const s = cal.sun(day, p.place.lon, p.place.lat, p.place.altitude_m ?? 0);
  const t = (d: Date) => localTime(d).split(" ")[1];
  // The island's calendar, without its sunrise and sunset (those of Saint-Denis).
  const c = calendrierLive(calendrier ?? null, now);
  const rest = c && !c.vide ? [c.valeur, ...c.detail.split(" · ").filter((x) => !x.startsWith("soleil"))].join(" · ") : "";
  return { valeur: `${t(s.lever)}–${t(s.coucher)}`, detail: `lever et coucher du soleil aujourd'hui${rest ? ` · ${rest}` : ""}` };
}

export function communePage(origin: string, p: PlacePage, l: CommuneLive, now = new Date(), alerte?: Alerte): string {
  const g = porte(alerte);
  const place = p.place;
  const url = `${origin}${hub(p)}`;
  const w = weather(p, l.place, now);
  const bus = buses(p, l.commune, now);
  const velos = bikes(l.commune, g, now);
  const mairie = townHall(l.commune, now);
  const fiche = l.commune?.value.mairie?.fiche;
  // « Y aller » under the town hall's address, where the directory gives its position.
  const o = l.commune?.value.mairie;
  const toHall = o && mairie ? g.aller({ nom: o.nom, lat: o.lat ?? NaN, lon: o.lon ?? NaN, adresse: o.adresse }, "mairie") : "";
  const hikes = communeHikes(p, l.randonnees, now);

  const tiles: Tile[] = [
    { icon: "thermo", nom: "Météo", href: `/meteo/${p.slug}`, live: w },
    { icon: "alert", nom: "Vigilance", href: "/vigilance", live: vigilance(p, l.vigilance, now) },
    { icon: "air", nom: "Air", href: "/air", live: air(p, l.air, now) },
    ...(coastal(p) ? [{ icon: "wave", nom: "Mer", href: "/mer", live: sea(p, l.mer, l.place, now) }] : []),
    { icon: "drop", nom: "Eau", href: `/coupures-eau/${p.slug}`, live: waterLive(p, { coupures: l.coupures ?? null, secheresse: l.secheresse, eau: l.eau }) },
    { icon: "bus", nom: "Bus", href: "/bus", ...bus, full: !!bus.more },
    ...(velos ? [{ icon: "bike", nom: "Vélos", href: "/velos", ...velos, full: !!velos.more }] : []),
    {
      icon: "building",
      nom: "Mairie",
      live: mairie,
      ...(toHall ? { more: `<p class="ya">${toHall}</p>` } : {}),
      question: `La mairie ${de(p.nom)} est ouverte ?`,
      foot: fiche ? `<a href="${esc(fiche)}" rel="noopener">Fiche service-public.fr</a>` : `<a href="/#assistant">Demandez à votre IA →</a>`,
    },
    ...(dech.TCO_COMMUNES.includes(p.nom) ? [{ icon: "pin", nom: "Déchèteries", href: `/decheteries#${anchorOf(p.nom)}`, live: wasteLive(p, l.dechets, now) }] : []),
    { icon: "heart", nom: "Pharmacies", live: pharmacies(p), foot: `<a href="${sante.GARDE.site}" rel="noopener">Pharmacie de garde : 3237.fr</a>` },
    ...(hikes ? [{ icon: "mountain", nom: "Randonnée", href: hikes.href, live: hikes.live, foot: hikes.foot }] : []),
    { icon: "music", nom: "Sorties", href: "/evenements", live: communeEvents(p, l.agenda) },
    ...(children(p) ? [{ icon: "kids", nom: "Enfants", href: enfantsPath(p), live: children(p) }] : []),
    { icon: "calendar", nom: "Soleil et calendrier", href: "/calendrier", live: sunTimes(p, l.calendrier, now) },
    { icon: "map", nom: "Terrain et risques", question: `Mon adresse à ${p.nom} est-elle en zone inondable ?`, foot: `<a href="/#assistant">Demandez à votre IA →</a>`, wide: true },
  ];
  // Figures of a year or a quarter, out of the grid that says « en ce moment » (marketing, 26/10).
  const habiter: Tile[] = [
    ...(rents(p) ? [{ icon: "key", nom: "Loyers d'annonce", live: rents(p), foot: `<a href="${loyers.SOURCE.url}" rel="noopener">La carte des loyers de l'ANIL</a>` }] : []),
    ...(connexion(p) ? [{ icon: "wifi", nom: "Fibre", live: connexion(p), foot: `<a href="https://maconnexioninternet.arcep.fr/" rel="noopener">Votre adresse sur Ma connexion internet</a>` }] : []),
    ...(antennas(p) ? [{ icon: "antenna", nom: "Antennes", href: "/antennes", live: antennas(p, l.hs), foot: `<a href="/#assistant">Votre adresse : demandez à votre IA →</a>` }] : []),
  ];
  const island: Tile[] = [
    { icon: "volcano", nom: "Volcan", href: "/volcan", live: volcanLive(l.volcan ?? null, now) },
    { icon: "bolt", nom: "Électricité", href: "/electricite", live: electriciteLive(l.electricite ?? null, now) },
  ];

  const grid = spans(tiles);

  const s = l.place?.value.meteo?.stations.find((x) => x.mesures.temperature);
  const headline = s
    ? `<div class="now"><span class="big">${esc(thin(s.mesures.temperature!))}</span>` +
      `<p>mesurés à <b>${esc(s.heure_mesure.split(" ")[1] ?? s.heure_mesure)}</b> par la station <b>${esc(s.station)}</b>${mairie ? `. Mairie <b>${mairie.valeur.toLowerCase()}</b>` : ""}${bus.live && !bus.live.vide && bus.live.valeur !== "Pas de départ" ? `, prochain bus à <b>${bus.live.valeur}</b>` : ""}.</p></div>`
    : "";

  const title = `${p.nom} 974 en direct : météo, bus, air, mairie`;
  const facts = [
    s && `${thin(s.mesures.temperature!)} à ${s.heure_mesure.split(" ")[1]}`,
    airOf(p, l.air) && `air ${airOf(p, l.air)!.qualite}`,
    mairie && mairie.valeur !== "Horaires non publiés" && `mairie ${mairie.valeur.toLowerCase()}`,
  ].filter(Boolean);
  const description = fit(
    `${p.nom} (La Réunion, 974) en direct${facts.length ? ` : ${facts.join(", ")}` : ""}.`,
    " Vigilance, prochains bus, soleil, chaque donnée datée et sourcée.",
  );

  const jsonld = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE, item: `${origin}/` },
        { "@type": "ListItem", position: 2, name: "Communes", item: `${origin}/communes` },
        { "@type": "ListItem", position: 3, name: p.nom, item: `${origin}${hub(p)}` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description,
      inLanguage: "fr-FR",
      url: `${origin}${hub(p)}`,
      ...(l.place ? { dateModified: l.place.fetchedAt.toISOString() } : {}),
      about: {
        "@type": "City",
        name: `${p.nom} (La Réunion, 974)`,
        geo: { "@type": "GeoCoordinates", latitude: place.lat, longitude: place.lon },
        containedInPlace: ISLAND,
      },
    },
  ];

  const band = `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li><a href="/communes">Communes</a></li><li aria-current="page">${esc(p.nom)}</li></ol></nav></div>
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>En direct</p>
    <h1>${esc(p.nom)} <span class="n974">974</span> en direct</h1>
    ${SLOGAN}
    ${headline}
    <p class="hero-cta"><a class="btn glass" href="/aujourdhui/${p.slug}">${esc(LINK(p))}</a></p>
    ${ask(`Kosa i spas ${p.nom} astèr ? Gèt si ${url} é di amwin.`,
      `Que se passe-t-il en ce moment à ${p.nom} ? Lis ${url} et résume-moi la météo, la vigilance, l'air, les prochains bus et si la mairie est ouverte, avec l'heure des données.`)}
  </div>
  <figure class="card mapcard">${islandMap({ highlight: p.nom, label: `Carte de La Réunion (974) situant ${p.nom}` })}</figure>
</div>`;

  // Every tile's producers, as their licences ask: a page with its own sources has none in its footer (layout).
  const sources = [
    ...(l.commune?.value.sources ?? []),
    ...(l.place?.value.meteo?.sources ?? []),
    ...(l.vigilance ? [credit(mf.SOURCE)] : []),
    ...(l.air?.value.sources ?? []),
    ...(coastal(p) ? [...(l.mer?.value.sources ?? []), ...(l.place?.value.mer?.sources ?? [])] : []),
    ...(l.coupures?.value.sources ?? []),
    ...(l.secheresse?.value.sources ?? []),
    ...(l.eau?.value.sources ?? []),
    ...(hikes?.live ? (l.randonnees?.value.sources ?? []) : []),
    ...(children(p) ? enfants.sourcesOf(enfants.inCommune(p.nom)).map(credit) : []),
    ...(rents(p) ? [credit(loyers.SOURCE)] : []),
    ...(connexion(p) ? [credit(internet.SOURCE)] : []),
    ...(antennas(p) ? [antennes.SOURCE_MOBILE, ...(antennes.ofCommune(p.nom).emetteurs.length ? [antennes.SOURCE_RADIO] : []), ...(horsService(l.hs, p) ? [sitesHs.SOURCE] : [])].map(credit) : []),
    ...(l.volcan?.value.sources ?? []),
    ...(l.electricite?.value.sources ?? []),
  ];
  const body = `<section id="en-ce-moment" aria-labelledby="h-now">
  <div class="sec-h"><p class="eyebrow">En direct</p><h2 id="h-now">${esc(p.nom)} en ce moment</h2>
  <p>Chaque catégorie a sa page pour toute l'île ; ici, ce qui concerne ${esc(p.nom)}. Mise à jour en continu, chaque donnée avec son heure et sa source.</p></div>
  <ul class="tiles fit" aria-label="Catégories">${tiles.map((t, i) => tile(t, grid[i])).join("")}</ul>
  ${sources.length ? `<p class="note">Bus : horaires théoriques publiés par les réseaux, sans les retards. Mairie : horaires publiés sur service-public.fr, sans les fermetures exceptionnelles.</p><p class="sources">Sources : ${credits(sources)}.</p>` : ""}
  ${coastal(p) ? `<p class="or">${BAIGNADE_LINE}</p>` : ""}
</section>
${habiter.length ? `<section aria-labelledby="h-habiter">
  <div class="sec-h"><h2 id="h-habiter">Habiter ${esc(aCommune(p.nom))}</h2>
  <p>Des chiffres publiés une fois par an, par trimestre, par mois ou par semaine, chacun avec sa date.</p></div>
  <ul class="tiles" aria-label="Habiter ${esc(aCommune(p.nom))}">${habiter.map((t) => tile(t)).join("")}</ul>
</section>
` : ""}<section aria-labelledby="h-ile">
  <h2 id="h-ile">Et pour toute l'île</h2>
  <ul class="tiles" aria-label="Toute l'île">${island.map((t) => tile(t)).join("")}</ul>
</section>
<section class="card cta" aria-labelledby="h-ia">
  <h2 id="h-ia">Votre IA, branchée sur ${esc(p.nom)}</h2>
  <p>Branchez le connecteur une fois sur ChatGPT, Claude ou Le Chat : à chaque « le prochain bus ${esc(de(p.nom))} ? » ou « il pleut à ${esc(p.nom)} ? », il ira chercher lui-même la donnée, avec son heure et sa source. Gratuit, sans compte. <a href="/#assistant">Comment le brancher</a>.</p>
  ${connector(origin, "mcp-url")}
</section>
<section aria-labelledby="h-autres">
  <h2 id="h-autres">Les autres communes</h2>
  <ul class="chips">${COMMUNES.filter((x) => x.slug !== p.slug).map((x) => `<li><a href="${hub(x)}">${esc(x.nom)}</a></li>`).join("")}</ul>
</section>`;
  const rss = { href: rssPath(p), title: rssTitle(p), link: rssLink(p), hint: RSS_HINT };
  return layout(origin, { title, description, path: hub(p), jsonld, alerte, rss }, band, g.ligne + (body.includes('class="aller"') ? body + ALLER : body));
}

/** The 24 communes, by vigilance zone: the island's own way of splitting itself (Nord, Est, Sud, Ouest). */
export function communesPage(origin: string, alerte?: Alerte): string {
  const zones = ["VIGI974-11", "VIGI974-12", "VIGI974-13", "VIGI974-14", "VIGI974-15"];
  const title = "Les 24 communes de La Réunion 974 en direct";
  const description = "Les 24 communes de La Réunion (974) en direct : météo, vigilance, air, mer, prochains bus, mairie ouverte ou non, soleil.";
  const jsonld = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE, item: `${origin}/` },
        { "@type": "ListItem", position: 2, name: "Communes", item: `${origin}/communes` },
      ],
    },
    { "@context": "https://schema.org", "@type": "WebPage", name: title, description, inLanguage: "fr-FR", url: `${origin}/communes`, about: ISLAND },
  ];
  const band = `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li aria-current="page">Communes</li></ol></nav></div>
<div class="wrap intro">
  <div class="pitch">
    <h1>Les 24 communes <span class="n974">974</span></h1>
    ${SLOGAN}
    <p class="lead">Une page par commune, avec tout ce qui la concerne en ce moment : la météo de sa station, la vigilance de sa zone, la qualité de son air, la mer sur la côte, les prochains bus, sa mairie ouverte ou non, le lever et le coucher du soleil.</p>
  </div>
  <figure class="card mapcard">${islandMap({ links: Object.fromEntries(COMMUNES.map((c) => [c.nom, { href: hub(c) }])), label: "Carte des 24 communes de La Réunion (974)" })}</figure>
</div>`;
  const body = `<section aria-labelledby="h-communes"><h2 id="h-communes">Choisissez votre commune</h2>
  <ul class="zones">${zones.map((z) => {
    const [name] = mf.ZONES[z].split(" :");
    const list = COMMUNES.filter((c) => mf.ZONE_OF_COMMUNE[c.nom] === z);
    return `<li class="card"><h3>${esc(name)}</h3><ul class="chips">${list.map((c) => `<li><a href="${hub(c)}">${esc(c.nom)}</a></li>`).join("")}</ul></li>`;
  }).join("")}</ul>
  <p class="note">Regroupées par zone de vigilance de Météo-France. Pour un lieu précis (un cirque, une plage, le volcan), la météo a aussi <a href="/meteo#communes">sa page par lieu</a>.</p>
</section>`;
  return layout(origin, { title, description, path: "/communes", jsonld, alerte }, band, body);
}
