/**
 * One page per commune, every category at once: its weather, the vigilance of its zone, its air, its sea, its next
 * buses, whether its town hall is open, its sunrise and sunset; then what holds for the whole island. The weather is
 * the copy of /meteo/<commune>, the town hall and the buses the commune's own copy, the rest the last copy of each
 * category page (web/site.ts), so a page costs a few reads.
 */
import type { Cached } from "../cache.js";
import { localTime } from "../geo.js";
import { normalize } from "../places/resolve.js";
import * as cal from "../providers/calendrier.js";
import * as mf from "../providers/vigilance.js";
import { hoursOn, openNow } from "../tools/annuaire.js";
import { de, fr } from "../tools/format.js";
import { current, cyclone, highest, raised } from "../tools/vigilance.js";
import type { AirAnswer, Alerte, CalendrierAnswer, CommuneData, ElectriciteAnswer, PlaceData, SeaData, VolcanAnswer } from "./data.js";
import { alertList, aq, bikeRow, calendrierLive, departureLi, electriciteLive, volcanLive } from "./domains.js";
import { esc, islandMap } from "./map.js";
import { ask, connector, credits, dayMonth, deg, fit, hm, icon, ISLAND, layout, type Live, metres, seaName, SITE, SLOGAN, thin, vg, zoneNow } from "./pages.js";
import { coastal, PAGES, type PlacePage } from "./places.js";

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
}

function tile(t: Tile): string {
  const head = t.href ? `<h3><a href="${t.href}">${esc(t.nom)}</a></h3>` : `<h3>${esc(t.nom)}</h3>`;
  const body = t.live
    ? `<p class="tv">${t.live.valeur}</p><p class="td">${t.live.detail}</p>`
    : t.question
      ? `<p class="tq">« ${esc(t.question)} »</p>`
      : `<p class="td">Se met à jour : rechargez la page dans quelques secondes.</p>`;
  const foot = t.foot ?? (t.href ? `<span class="go" aria-hidden="true">Voir →</span>` : "");
  return `<li class="tile${t.wide ? " wide" : ""}">${icon(t.icon)}${head}${body}${t.more ?? ""}${foot ? `<p class="tf"><span></span>${foot}</p>` : ""}</li>`;
}

function weather(data: Cached<PlaceData> | null, now: Date): Live | undefined {
  const s = data?.value.meteo?.stations.find((x) => x.mesures.temperature);
  if (!s) return undefined;
  // In the evening, tomorrow's forecast rather than what is left of today.
  const evening = new Date(now.getTime() + 4 * 3600_000).getUTCHours() >= 17;
  const jours = data!.value.prevision?.jours ?? [];
  const f = (evening && jours[1]) || jours[0];
  return {
    valeur: esc(thin(s.mesures.temperature!)),
    detail: `station ${esc(s.station)} (${metres(s.altitude_m)}${s.distance_km != null ? `, à ${fr(s.distance_km)} km` : ""}), mesuré à ${esc(s.heure_mesure.split(" ")[1] ?? s.heure_mesure)}` +
      (f?.temperature_min && f.temperature_max ? ` · prévision ${esc(f.jour.toLowerCase())} : ${esc(thin(f.temperature_min))} à ${esc(thin(f.temperature_max))}` : ""),
  };
}

const WAVES = 9;

function vigilance(p: PlacePage, data: Cached<mf.Vigilance> | null | undefined, now: Date): Live | undefined {
  const v = data?.value;
  if (!v) return undefined;
  const cyc = v.zones[mf.ISLAND]?.[mf.CYCLONE] ?? [];
  if (highest(cyc) >= 2) {
    const c = Math.max(2, current(cyc, now));
    return { valeur: `<span class="vg vg${Math.min(c, 5)}">Cyclone : ${esc(mf.colour(c))}</span>`, detail: esc(cyclone(v, now)) };
  }
  const zone = mf.ZONE_OF_COMMUNE[p.nom];
  const name = (mf.ZONES[zone] ?? "").split(" :")[0];
  const c = zone ? zoneNow(v, zone, now) : -1;
  const up = zone ? [12, 1].filter((id) => current(v.zones[zone]?.[id] ?? [], now) >= 2).map((id) => mf.PHENOMENA[id].toLowerCase()) : [];
  const waves = coastal(p) ? raised(v).filter((x) => x.phenomene === mf.PHENOMENA[WAVES]) : [];
  return {
    valeur: vg(c >= 1 ? c : 1),
    detail: esc(up.length ? `${up.join(", ")} pour la zone ${name}` : `pas de vigilance particulière pour la zone ${name}`) +
      (waves.length ? ` · vagues-submersion sur le littoral : ${vg(waves[0].max)}` : ""),
  };
}

const airOf = (p: PlacePage, data: Cached<AirAnswer> | null | undefined) => data?.value.communes?.find((x) => normalize(x.commune) === normalize(p.nom));

function air(p: PlacePage, data: Cached<AirAnswer> | null | undefined): Live | undefined {
  const c = airOf(p, data);
  if (!c) return undefined;
  return { valeur: aq(c.niveau), detail: `indice ATMO du jour${c.polluants.length ? ` (${esc(c.polluants.join(", "))})` : ""}, d'Atmo Réunion` };
}

function sea(p: PlacePage, mer: Cached<SeaData> | null | undefined, place: Cached<PlaceData> | null): Live | undefined {
  const beaches = mer?.value.plages.filter((b) => b.commune === p.nom && b.valeur != null) ?? [];
  if (beaches.length) {
    const v = beaches.map((b) => b.valeur!);
    const lo = Math.round(Math.min(...v));
    const hi = Math.round(Math.max(...v));
    return {
      valeur: lo === hi ? thin(deg(lo)) : `${lo} à ${thin(deg(hi))}`,
      detail: `au large ${beaches.length > 1 ? "des plages" : "de la plage"} ${esc(beaches.map((b) => seaName(b.nom)).join(", "))}, par satellite le ${esc(dayMonth(beaches.map((b) => b.jour!).sort().pop()!))}`,
    };
  }
  const m = place?.value.mer?.mesure;
  return m ? { valeur: esc(thin(m.temperature_eau)), detail: `au large, par satellite le ${esc(dayMonth(m.jour_mesure))}` } : undefined;
}

/** The departures still to come: the copy is up to a few minutes old, its waits are counted again from now. */
function buses(p: PlacePage, data: Cached<CommuneData> | null | undefined, now: Date): { live?: Live; more?: string } {
  const b = data?.value.bus;
  if (!b) return {};
  const left = b.departs
    .map((x) => ({ x, min: Math.round((data!.fetchedAt.getTime() + x.dans_min * 60_000 - now.getTime()) / 60_000) }))
    .filter(({ min }) => min >= 0)
    .slice(0, 4);
  const where = b.gare ? `à la gare ${esc(de(p.nom))}` : `près du centre, arrêt ${esc(b.arrets[0].nom)}`;
  if (!left.length) return { live: { valeur: "Pas de départ", detail: `${where} dans les prochaines heures, d'après les horaires publiés` } };
  const wait = (min: number, heure: string) => (heure.startsWith("demain") ? heure : min < 1 ? "maintenant" : min < 90 ? `dans ${fr(min)} min` : `à ${heure}`);
  const first = left.find(({ x }) => !x.temps_reel) ?? left[0];
  return {
    live: { valeur: esc(first.x.heure_annoncee ?? first.x.heure), detail: `prochain départ ${where} : ligne ${esc(first.x.ligne)} vers ${esc(first.x.direction)} (${esc(first.x.reseau)})` },
    more: `<ul class="rows">${left.map(({ x, min }) => departureLi(x, wait(min, x.heure_annoncee ?? x.heure))).join("")}</ul>` +
      (b.alertes?.length ? `<div class="note">Info trafic : ${alertList(b.alertes)}</div>` : ""),
  };
}

/** The commune's Altervélo stations: how many bikes in all, and those with the most. */
function bikes(data: Cached<CommuneData> | null | undefined): { live?: Live; more?: string } | undefined {
  const list = data?.value.velos;
  if (!list?.length) return undefined;
  const total = list.filter((s) => !s.etat || s.etat === "dépôt impossible en ce moment").reduce((n, s) => n + s.velos_electriques + (s.trottinettes ?? 0), 0);
  return {
    live: { valeur: `${total} vélo${total > 1 ? "s" : ""}`, detail: `électriques en libre-service dans ${list.length} station${list.length > 1 ? "s" : ""} Altervélo, relevé à ${hm(data!.fetchedAt)}` },
    more: `<ul class="rows bikes">${list.slice(0, 5).map(bikeRow).join("")}</ul>`,
  };
}

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
  const t = (d: Date) => localTime(d).split(" ")[1].replace(":", "h");
  // The island's calendar, without its sunrise and sunset (those of Saint-Denis).
  const c = calendrierLive(calendrier ?? null);
  const rest = c ? [c.valeur, ...c.detail.split(" · ").filter((x) => !x.startsWith("soleil"))].join(" · ") : "";
  return { valeur: `${t(s.lever)} – ${t(s.coucher)}`, detail: `lever et coucher du soleil aujourd'hui${rest ? ` · ${rest}` : ""}` };
}

export function communePage(origin: string, p: PlacePage, l: CommuneLive, now = new Date(), alerte?: Alerte): string {
  const place = p.place;
  const url = `${origin}${hub(p)}`;
  const w = weather(l.place, now);
  const bus = buses(p, l.commune, now);
  const velos = bikes(l.commune);
  const mairie = townHall(l.commune, now);
  const fiche = l.commune?.value.mairie?.fiche;

  const tiles: Tile[] = [
    { icon: "thermo", nom: "Météo", href: `/meteo/${p.slug}`, live: w },
    { icon: "alert", nom: "Vigilance", href: "/vigilance", live: vigilance(p, l.vigilance, now) },
    { icon: "air", nom: "Air", href: "/air", live: air(p, l.air) },
    ...(coastal(p) ? [{ icon: "wave", nom: "Mer", href: "/mer", live: sea(p, l.mer, l.place) }] : []),
    { icon: "bus", nom: "Bus", href: "/bus", ...bus, wide: true },
    ...(velos ? [{ icon: "bike", nom: "Vélos", href: "/velos", ...velos, wide: true }] : []),
    {
      icon: "building",
      nom: "Mairie",
      live: mairie,
      question: `La mairie ${de(p.nom)} est ouverte ?`,
      foot: fiche ? `<a href="${esc(fiche)}" rel="noopener">Fiche service-public.fr</a>` : `<a href="/#assistant">Demandez à votre IA →</a>`,
    },
    { icon: "calendar", nom: "Soleil et calendrier", href: "/calendrier", live: sunTimes(p, l.calendrier, now) },
    { icon: "map", nom: "Terrain et risques", question: `Mon adresse à ${p.nom} est-elle en zone inondable ?`, foot: `<a href="/#assistant">Demandez à votre IA →</a>`, wide: true },
  ];
  const island: Tile[] = [
    { icon: "volcano", nom: "Volcan", href: "/volcan", live: volcanLive(l.volcan ?? null) },
    { icon: "bolt", nom: "Électricité", href: "/electricite", live: electriciteLive(l.electricite ?? null) },
  ];

  const s = l.place?.value.meteo?.stations.find((x) => x.mesures.temperature);
  const headline = s
    ? `<div class="now"><span class="big">${esc(thin(s.mesures.temperature!))}</span>` +
      `<p>mesurés à <b>${esc(s.heure_mesure.split(" ")[1] ?? s.heure_mesure)}</b> par la station <b>${esc(s.station)}</b>${mairie ? `. Mairie <b>${mairie.valeur.toLowerCase()}</b>` : ""}${bus.live && bus.live.valeur !== "Pas de départ" ? `, prochain bus à <b>${bus.live.valeur}</b>` : ""}.</p></div>`
    : "";

  const title = `${p.nom} 974 en direct : météo, bus, air, mairie`;
  const facts = [
    s && `${thin(s.mesures.temperature!)} à ${s.heure_mesure.split(" ")[1]}`,
    airOf(p, l.air) && `air ${airOf(p, l.air)!.qualite}`,
    mairie && mairie.valeur !== "Horaires non publiés" && `mairie ${mairie.valeur.toLowerCase()}`,
  ].filter(Boolean);
  const description = fit(
    `🇷🇪 ${p.nom} (La Réunion, 974) en direct${facts.length ? ` : ${facts.join(", ")}` : ""}.`,
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
    ${ask(`Kosa i spas ${p.nom} astèr ? Rogard si ${url} é di amwin.`,
      `Que se passe-t-il en ce moment à ${p.nom} ? Lis ${url} et résume-moi la météo, la vigilance, l'air, les prochains bus et si la mairie est ouverte, avec l'heure des données.`)}
  </div>
  <figure class="card mapcard">${islandMap({ highlight: p.nom, label: `Carte de La Réunion (974) situant ${p.nom}` })}</figure>
</div>`;

  const sources = [...(l.commune?.value.sources ?? []), ...(l.place?.value.meteo?.sources ?? []), ...(l.air?.value.sources ?? [])];
  const body = `<section id="en-ce-moment" aria-labelledby="h-now">
  <div class="sec-h"><p class="eyebrow">En direct</p><h2 id="h-now">${esc(p.nom)} en ce moment</h2>
  <p>Chaque catégorie a sa page pour toute l'île ; ici, ce qui concerne ${esc(p.nom)}. Données mises à jour toutes les 5 minutes, avec leur heure et leur source.</p></div>
  <ul class="tiles" aria-label="Catégories">${tiles.map(tile).join("")}</ul>
  ${sources.length ? `<p class="note">Sources : ${credits(sources)}. Bus : horaires théoriques publiés par les réseaux, sans les retards. Mairie : horaires publiés sur service-public.fr, sans les fermetures exceptionnelles.</p>` : ""}
</section>
<section aria-labelledby="h-ile">
  <h2 id="h-ile">Et pour toute l'île</h2>
  <ul class="tiles" aria-label="Toute l'île">${island.map(tile).join("")}</ul>
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
  return layout(origin, { title, description, path: hub(p), jsonld, alerte }, band, body);
}

/** The 24 communes, by vigilance zone: the island's own way of splitting itself (Nord, Est, Sud, Ouest). */
export function communesPage(origin: string, alerte?: Alerte): string {
  const zones = ["VIGI974-11", "VIGI974-12", "VIGI974-13", "VIGI974-14", "VIGI974-15"];
  const title = "Les 24 communes de La Réunion 974 en direct";
  const description = "🇷🇪 Les 24 communes de La Réunion (974) en direct : météo, vigilance, air, mer, prochains bus, mairie ouverte ou non, soleil.";
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
  <figure class="card mapcard">${islandMap({ label: "Carte des 24 communes de La Réunion (974)" })}</figure>
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
