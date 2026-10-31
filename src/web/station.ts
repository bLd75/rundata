/**
 * The page of a station of Météo-France's 6-minute package (its own and the CIRAD's), /meteo/station/<id>: what it measured last (the 6-minute package), its last 24
 * hours (the hourly package, already kept for /meteo's rain), and from the climatological archive (D1) its last 30 days,
 * its year month by month and its records. Every chart is drawn here, in SVG: no script. The words are marketing's
 * (29/10/2026).
 */
import type { Cache, Cached } from "../cache.js";
import { sun } from "../providers/calendrier.js";
import * as climat from "../providers/climat.js";
import * as meteofrance from "../providers/meteofrance.js";
import { stationHistory, type StationHistory } from "../tools/historique.js";
import { why } from "../types.js";
import type { Alerte, StationNow } from "./data.js";
import { crumbBar, crumbs, describe, webPage } from "./domains.js";
import { chart, known } from "./graphe.js";
import { esc } from "./map.js";
import { inseeCommune, ventText } from "./meteo-carte.js";
import { credits, dayMonth, deg, hm, layout, metres, shortName, thin } from "./pages.js";
import { fr } from "../tools/format.js";

export const STATION_PATH = "/meteo/station";
export const stationPath = (id: string) => `${STATION_PATH}/${id}`;

/** Every station of the 6-minute package's list has a page, as it has a row on /meteo. */
export const STATIONS = meteofrance.stations();
export const stationOf = (id: string) => STATIONS.find((s) => s.id === id);

/** What a station's page shows; its copy is `web:station:<id>`. */
export interface StationData {
  id: string;
  nom: string;
  altitude_m: number;
  /** Its last measure: the time and each reading by its variable (providers/meteofrance.ts, `observation`). */
  derniere?: { time: string; mesures: Record<string, number> };
  /** Its kept hours, newest first. */
  heures: meteofrance.StationHour[];
  historique?: StationHistory;
}

export async function buildStation(cache: Cache, id: string, now = new Date()): Promise<StationData> {
  const s = stationOf(id);
  if (!s) throw new Error(`station inconnue : ${id}`);
  // The hours after the 6 minutes: their package is read from the same bundle, without a download of its own.
  const measured = meteofrance.observations(cache, now).then(async (o) => [o, await meteofrance.recentRain(cache, now)] as const);
  const [m, historique] = await Promise.all([
    measured.catch((e) => {
      console.error("page station : mesures indisponibles", why(e));
      return undefined;
    }),
    stationHistory(cache, id, now).catch((e) => {
      console.error("page station : historique indisponible", why(e));
      return undefined;
    }),
  ]);
  const o = m?.[0].value.find((x) => x.station.id === id);
  return {
    id,
    nom: s.nom,
    altitude_m: s.altitude_m,
    derniere: o && { time: o.time.toISOString(), mesures: Object.fromEntries(o.readings.flatMap((r) => (typeof r.valeur === "number" ? [[r.variable, r.valeur]] : []))) },
    heures: m?.[1] ? meteofrance.stationHours(m[1].hourly, id) : [],
    historique,
  };
}

/** A station of the CIRAD's, which Météo-France's package carries: « La Mare - CIRAD ». */
const cirad = (nom: string) => / - CIRAD$/.test(nom);
/** Its name without what the title adds: « Gillot », « La Mare ». */
const bare = (nom: string) => shortName(nom).replace(/ - CIRAD$/, "");
/** What follows the name in the title. */
const tag = (nom: string) => (/ \(aéroport\)$/.test(nom) ? "aéroport" : cirad(nom) ? "CIRAD" : "");
/** The title of a station: its short name, never another commune's (« Gillot aéroport », not « Saint-Denis Gillot »; « La Mare CIRAD »). */
export const stationTitle = (nom: string) => `${bare(nom)}${tag(nom) ? ` ${tag(nom)}` : ""}`;

const T = " ";
const num = (n: number) => fr(Math.round(n * 10) / 10);
const local = (iso: string) => new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 10);
const HOUR_MS = 3600_000;


/**
 * No measure in the last 6-minute slots: since when, from its last hour kept or the archive's last day; never said
 * broken or stopped, which is not known: what rundata.re has, not what the station does (marketing).
 */
function silence(d: StationData, now: Date): string {
  const last = d.heures.find((h) => h.t != null || h.rr != null || h.ff != null || h.u != null);
  if (last) return `rundata.re n'a pas de mesure de cette station depuis le ${dated(local(last.fin), now)} à ${hm(last.fin)}.`;
  if (d.historique) return `rundata.re n'a pas de mesure de cette station depuis le ${dated(d.historique.jusqu_au, now)}.`;
  return "rundata.re n'a reçu aucune mesure de cette station.";
}

/** Whether some of the hour ending at `fin` is between sunrise and sunset at the station. */
function daylight(d: StationData, fin: string): boolean {
  const s = stationOf(d.id);
  if (!s) return true;
  const { lever, coucher } = sun(local(fin), s.lon, s.lat, d.altitude_m);
  return Date.parse(fin) > lever.getTime() && Date.parse(fin) - HOUR_MS < coucher.getTime();
}

/** A day, with its year when it is not this year's: « 28/10 », « 30/06/2025 ». */
const dated = (ymd: string, now: Date) => (ymd.slice(0, 4) === local(now.toISOString()).slice(0, 4) ? dayMonth(ymd) : ymd.split("-").reverse().join("/"));
/** Whether the station sent something in the last 24 hours: else its page is its history (a station that has stopped sending). */
const live = (d: StationData) => !!d.derniere || d.heures.length > 0;
/** Whether the archive's last days are old: the last 30 days of measure, not the last 30 days. */
const ARCHIVE_LATE_DAYS = 40;

/** What a station measures, for its description: from its last measure, else its hours. */
function measures(d: StationData): string {
  const m = d.derniere?.mesures ?? {};
  const has = (k: string, f: (h: meteofrance.StationHour) => number | null) => Object.keys(m).some((x) => x.startsWith(k)) || d.heures.some((h) => f(h) != null);
  return [has("temperature", (h) => h.t) && "température", has("pluie", (h) => h.rr) && "pluie", has("vent", (h) => h.ff) && "vent"].filter(Boolean).join(", ");
}

/** The band: crumbs, title, the last temperature and where it was measured, and the box of the last measure. */
function band(d: StationData, now: Date): string {
  const name = stationTitle(d.nom);
  const airport = / \(aéroport\)$/.test(d.nom);
  const commune = inseeCommune(d.id);
  const m = d.derniere?.mesures ?? {};
  const at = d.derniere ? hm(d.derniere.time) : "";
  const where = `par la station ${cirad(d.nom) ? "du CIRAD" : "Météo-France"}${airport ? " de l'aéroport" : ""}${commune ? `, à ${esc(commune)}` : ""}, ${metres(d.altitude_m)} d'altitude`;
  const said = !d.derniere
    ? ""
    : m.temperature != null
      ? `<div class="now"><span class="big span">${thin(deg(m.temperature))}</span><p>mesurés ${cirad(d.nom) ? "" : "sous abri "}à <b>${at}</b> ${where}.</p></div>`
      // A rain gauge says what it measures; another station without a thermometer, its measures (marketing).
      : `<div class="now"><p>${Object.keys(m).every((k) => k.startsWith("pluie")) ? "Pluie mesurée à" : "Mesures de"} <b>${at}</b> ${where}.</p></div>`;
  // The last round hour, in the box only when it ends before the last measure, and not long before.
  const h = d.heures[0] && d.derniere && Date.parse(d.heures[0].fin) <= Date.parse(d.derniere.time) && Date.parse(d.derniere.time) - Date.parse(d.heures[0].fin) <= 2 * HOUR_MS ? d.heures[0] : undefined;
  const span = h && `de ${hm(new Date(Date.parse(h.fin) - HOUR_MS))} à ${hm(h.fin)}`;
  const rows: [string, string][] = [];
  if (m.vent_moyen != null) rows.push(["Vent moyen", ventText({ vent: m.vent_moyen, direction: m.vent_direction, rafales: m.rafales } as StationNow)!.replace(/^vent /, "")]);
  if (m.humidite != null) rows.push(["Humidité", thin(`${m.humidite} %`)]);
  if (m.point_de_rosee != null) rows.push(["Point de rosée", thin(deg(m.point_de_rosee))]);
  const rain = [m.pluie_6min != null ? thin(`${num(m.pluie_6min)} mm en 6${T}min`) : "", h?.rr != null ? thin(`${num(h.rr)} mm ${span}`) : ""].filter(Boolean);
  if (rain.length) rows.push(["Pluie", rain.join(", ")]);
  if (m.pression_mer != null) rows.push(["Pression (niveau de la mer)", `${num(m.pression_mer)}${T}hPa`]);
  // Not the sunshine of an hour wholly at night.
  if (h?.ins != null && (h.ins > 0 || daylight(d, h.fin))) rows.push(["Soleil", `${h.ins}${T}min ${span}`]);
  const box = d.derniere
    ? `<figure class="card mapcard sta-now"><h3>La dernière mesure, à ${at}</h3>
    <ul class="bars">${rows.map(([k, v]) => `<li><span>${k}</span><b>${esc(v)}</b></li>`).join("")}</ul>
    <p class="note">${cirad(d.nom) ? "Mesures du CIRAD, diffusées par Météo-France" : "Mesures de Météo-France"}, toutes les 6${T}minutes. <a href="/meteo#stations">Les autres stations →</a></p>
  </figure>`
    : `<figure class="card mapcard sta-now"><p>${esc(silence(d, now))} <a href="/meteo#stations">Les autres stations →</a></p></figure>`;
  const title = tag(d.nom) ? `${esc(bare(d.nom))} <span class="n974">${tag(d.nom)}</span>` : esc(name);
  return `${crumbBar(name, { name: "Météo", path: "/meteo" })}
<div class="wrap intro">
  <div class="pitch">
    ${live(d) ? `<p class="pill"><span class="dot"></span>Mesure en direct</p>` : ""}
    <h1>${title}</h1>
    ${said}
  </div>
  ${box}
</div>`;
}

/** The last 24 hours, oldest first: temperature, rain of each hour, wind and gusts. */
function lastDay(d: StationData): string {
  const hs = [...d.heures].reverse();
  if (!hs.some((h) => h.t != null || h.rr != null || h.ff != null)) return "";
  const labels = hs.map((h) => hm(h.fin));
  const t = hs.map((h) => h.t), rr = hs.map((h) => h.rr), ff = hs.map((h) => h.ff), raf = hs.map((h) => h.raf);
  const parts: string[] = [];
  const ts = known(t);
  if (ts.length) parts.push(thin(`de ${deg(Math.min(...ts))} à ${deg(Math.max(...ts))}`));
  const rain = known(rr);
  const total = Math.round(rain.reduce((a, b) => a + b, 0) * 10) / 10;
  if (rain.length) parts.push(thin(`${num(total)} mm de pluie`));
  const gusts = known(raf);
  if (gusts.length) {
    const top = Math.max(...gusts), end = hs[raf.indexOf(top)].fin;
    parts.push(thin(`rafale la plus forte ${top} km/h entre ${hm(new Date(Date.parse(end) - HOUR_MS))} et ${hm(end)}`));
  }
  const first = hs[0].fin, last = hs[hs.length - 1].fin;
  const intro = `Heure par heure, de ${hm(first)} le ${dayMonth(local(first))} à ${hm(last)} le ${dayMonth(local(last))}${parts.length ? ` : ${parts.join(", ")}` : ""}.`;
  const cards: string[] = [];
  if (ts.length) cards.push(`<figure class="card"><h3>Température <small>(°C)</small></h3>${chart({ label: `Température heure par heure, ${parts[0]}`, labels, every: 4, lines: [{ pts: t, cls: "ln-t" }] })}</figure>`);
  if (rain.length) {
    cards.push(`<figure class="card"><h3>Pluie de chaque heure <small>(mm)</small></h3>${total > 0
      ? chart({ label: `Pluie de chaque heure, ${num(total)} mm en tout`, labels, every: 4, bars: rr, min: 0, max: Math.max(1, Math.ceil(Math.max(...rain))) })
      : `<p class="sta-0">Pas de pluie mesurée ces 24 heures.</p>`}</figure>`);
  }
  if (known(ff).length) {
    cards.push(`<figure class="card"><h3>Vent moyen et rafales <small>(km/h)</small></h3>${chart({ label: "Vent moyen et rafales heure par heure", labels, every: 4, lines: [{ pts: raf, cls: "ln-r" }, { pts: ff, cls: "ln-v" }], arrows: hs.map((h) => (h.ff ? h.dd : null)), min: 0 })}` +
      `<p class="note"><i class="k k-v"></i>vent moyen <i class="k k-r"></i>rafales ; les flèches montrent où va le vent (un vent d'est vient de l'est).</p></figure>`);
  }
  return `<section aria-labelledby="h-24"><div class="sec-h"><p class="eyebrow">Mesuré</p><h2 id="h-24">Les dernières 24 heures</h2>
  <p>${esc(intro)}</p></div>
  <div class="sta-grid">${cards.join("")}</div></section>`;
}

// What the history's summaries hold (tools/historique.ts, `summary` and `groupedRows`).
interface Resume {
  pluie?: { total_mm: number; jours_de_pluie: number; jours_mesures: number; normale_mm?: number; rapport_a_la_normale?: string };
  temperatures?: { maximales_moyenne?: number; maximales_normale?: number };
  ensoleillement?: { heures_par_jour?: number };
}
const ddmm = (frDate: string) => frDate.slice(0, 5);

function archive(h: StationHistory, now: Date): string {
  const r = h.trente.resume as Resume;
  const parts: string[] = [];
  if (r.pluie?.jours_mesures) parts.push(thin(`${num(r.pluie.total_mm)} mm de pluie en ${r.pluie.jours_de_pluie} ${r.pluie.jours_de_pluie > 1 ? "jours" : "jour"}${r.pluie.normale_mm != null ? ` (normale d'environ ${r.pluie.normale_mm} mm)` : ""}`));
  if (r.temperatures?.maximales_moyenne != null) parts.push(thin(`maximales de ${deg(r.temperatures.maximales_moyenne)} en moyenne${r.temperatures.maximales_normale != null ? ` (normale ${deg(r.temperatures.maximales_normale)})` : ""}`));
  if (r.ensoleillement?.heures_par_jour != null) parts.push(`${num(r.ensoleillement.heures_par_jour)}${T}h de soleil par jour`);
  const days = h.trente.jours;
  const labels = days.map((j) => ddmm(j.date));
  const tmin = days.map((j) => j.tmin ?? null), tmax = days.map((j) => j.tmax ?? null), rr = days.map((j) => j.pluie_mm ?? null);
  const cards: string[] = [];
  if (known(tmax).length) cards.push(`<figure class="card"><h3>Minimales et maximales <small>(°C)</small></h3>${chart({ label: "Températures minimales et maximales de chaque jour", labels, every: 7, band: [tmin, tmax], lines: [{ pts: tmax, cls: "ln-t" }, { pts: tmin, cls: "ln-n" }] })}</figure>`);
  if (known(rr).length) cards.push(`<figure class="card"><h3>Pluie de chaque jour <small>(mm)</small></h3>${chart({ label: "Pluie de chaque jour", labels, every: 7, bars: rr, min: 0, max: Math.max(1, Math.ceil(Math.max(...known(rr)))) })}</figure>`);
  const trente = `<section aria-labelledby="h-30"><div class="sec-h"><p class="eyebrow">Historique</p><h2 id="h-30">Les 30 derniers jours${now.getTime() - Date.parse(h.trente.au) > ARCHIVE_LATE_DAYS * 86_400_000 ? " de mesure" : ""}</h2>
  <p>${esc(`Du ${dated(h.trente.du, now)} au ${dated(h.trente.au, now)}${parts.length ? ` : ${parts.join(" ; ")}` : ""}.`)}</p></div>
  <div class="sta-grid two">${cards.join("")}</div></section>`;

  const y = h.annee.resume as Resume;
  const since = y.pluie?.jours_mesures ? thin(` Depuis janvier : ${fr(Math.round(y.pluie.total_mm))} mm de pluie${y.pluie.rapport_a_la_normale ? `, ${y.pluie.rapport_a_la_normale} de la normale` : ""}.`) : "";
  const cell = (v: number | undefined, unit: string, normal?: number, round = num) => (v == null ? "<td>—</td>" : `<td><b>${thin(`${round(v)} ${unit}`)}</b>${normal != null ? `<small>normale ${round(normal)}</small>` : ""}</td>`);
  const whole = (n: number) => fr(Math.round(n));
  const rows = h.annee.mois.map((m) => {
    const name = String(m.mois).replace(/ \d{4}$/, "");
    return `<tr><td>${name.charAt(0).toUpperCase()}${name.slice(1)}</td>${cell(m.pluie_mm, "mm", m.pluie_normale_mm, whole)}${cell(m.tmax_moyenne, "°C", m.tmax_normale)}${cell(m.soleil_h_par_jour, "h")}</tr>`;
  }).join("");
  // The month of the last day, when it is not over.
  const au = h.annee.mois.length ? h.jusqu_au : "";
  const next = au && new Date(Date.parse(au) + 86_400_000).toISOString().slice(5, 7) === au.slice(5, 7);
  const lastMonth = next ? String(h.annee.mois[h.annee.mois.length - 1].mois).replace(/ \d{4}$/, "") : "";
  const annee = `<section aria-labelledby="h-an"><div class="sec-h"><p class="eyebrow">Historique</p><h2 id="h-an">Mois par mois en ${h.annee.annee}</h2>
  <p>Comparés à la normale 1991-2020 de la station.${since}</p></div>
  <div class="card"><table class="sta-m"><thead><tr><th>Mois</th><th>Pluie</th><th>Maximales</th><th>Soleil par jour</th></tr></thead><tbody>${rows}</tbody></table>
  ${lastMonth ? `<p class="note">${lastMonth.charAt(0).toUpperCase()}${lastMonth.slice(1)} jusqu'au ${dated(au, now)}.</p>` : ""}</div></section>`;

  const rec = h.records;
  const card = (label: string, x: { valeur: number; date: string } | undefined, v: (n: number) => string) =>
    x ? `<li class="card"><span>${label}</span><b>${thin(v(x.valeur))}</b><small>le ${x.date}</small></li>` : "";
  const items = rec
    ? card("Température la plus haute", rec.temperature_max, deg) + card("Température la plus basse", rec.temperature_min, deg) +
      card("Pluie en un jour", rec.pluie_en_un_jour_mm, (n) => `${fr(Math.round(n))} mm`) + card("Rafale la plus forte", rec.rafale_max_kmh, (n) => `${n} km/h`)
    : "";
  const records = items ? `<section aria-labelledby="h-rec"><div class="sec-h"><p class="eyebrow">Historique</p><h2 id="h-rec">Les records de la station</h2></div>
  <ul class="sta-rec">${items}</ul></section>` : "";
  return `${trente}\n${annee}\n${records}`;
}

const SOURCES = [meteofrance.SOURCE, climat.SOURCE].map((s) => ({ source: s.nom, licence: s.licence, attribution: s.attribution }));

export function stationPage(origin: string, data: Cached<StationData> | null, id: string, now = new Date(), alerte?: Alerte): string {
  const s = stationOf(id)!;
  const d: StationData = data?.value ?? { id, nom: s.nom, altitude_m: s.altitude_m, heures: [] };
  const name = stationTitle(d.nom);
  const commune = inseeCommune(id);
  const path = stationPath(id);
  const h = d.historique;
  const on = live(d);
  const title = on || !h ? `${name} : station météo en direct et historique` : `${name} : historique de la station météo`;
  const what = measures(d);
  const who = cirad(d.nom) ? `${bare(d.nom)} du CIRAD` : `Météo-France ${name}`;
  const told = (where: string) =>
    on || !h
      ? `Ce que mesure la station ${who}${where} en ce moment${what ? ` : ${what}` : ""}${h ? `, et son historique depuis ${h.depuis}` : ""}.`
      : `L'historique de la station ${who}${where}, de ${h.depuis} au ${dated(h.jusqu_au, now)}.`;
  // Its commune and altitude when it fits in what search engines show.
  const description = describe(told(commune ? ` (${commune}, ${metres(d.altitude_m)} d'altitude)` : ""), told(""));
  const none = !h ? `<p class="note">${d.derniere && !d.heures.length ? "Dernière mesure seulement : rundata.re n'a pas l'historique de cette station." : "rundata.re n'a pas l'historique de cette station."}</p>` : "";
  const body = `${lastDay(d)}
${h ? archive(h, now) : none}
<p class="sources">Sources : ${credits(SOURCES)}.</p>`;
  return layout(origin, {
    title, description, path, alerte,
    hook: on ? `Ce que mesure cette station en ce moment${h ? `, et son historique depuis ${h.depuis}` : ""}.` : h ? `L'historique de cette station, de ${h.depuis} au ${dated(h.jusqu_au, now)}.` : "",
    jsonld: [crumbs(origin, name, path, { name: "Météo", path: "/meteo" }), webPage(origin, path, title, description, data)],
  }, band(d, now), body);
}
