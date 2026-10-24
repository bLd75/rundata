/**
 * /cyclones/<nom>-<année>: what Météo-France's stations measured while a past cyclone went by, station by station,
 * under the one sentence of its passage a named document gives (historique/cyclones-passes.ts). Nothing else: no
 * casualty, damage or outage, no comparison. Worded by marketing.
 */
import { jourFr, kmh, mesures, RAIN_NOTE, records, rafale, total, type Mesure, type Passe } from "../historique/cyclones-passes.js";
import { SOURCE } from "../providers/climat.js";
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { esc } from "./map.js";
import { layout } from "./pages.js";

/** How many stations show before the « autres stations » fold. */
const SHOWN = 15;
/** Below this many stations with a gust, the page says how few measured the wind then. */
const FEW_GUSTS = 10;
/** How many of the strongest gusts are listed apart. */
const GUSTS_SHOWN = 5;
/** Below this many stations with a gust, the title and the meta say only the rain (Hyacinthe, 1980: 3). */
const RAIN_ONLY = 5;
/** Beyond this many days, the table gives each station's wettest day instead of a column per day. */
const LONG = 4;

/** How many stations measured a gust during the passage. */
const gustCount = (p: Passe) => {
  const { jours, stations } = mesures(p);
  return stations.filter((s) => rafale(s, jours)).length;
};

export const titleOf = (p: Passe) => `Cyclone ${p.nom} ${p.annee} : ${gustCount(p) < RAIN_ONLY ? "pluie mesurée" : "pluie et vent mesurés"} · Réunion 974`;
export const metaOf = (p: Passe) =>
  `🇷🇪 Cyclone ${p.nom} (${p.mois}) à La Réunion (974) : ${gustCount(p) < RAIN_ONLY ? "pluie mesurée" : "pluie et rafales mesurées"} station par station par Météo-France${records(p).length ? ", et les records de station" : ""}.`;

/** 1385 → « 1 385 », 52.3 → « 52,3 ». */
const num = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const dm = (iso: string) => jourFr(iso).slice(0, 5);
/** A non-breaking space between a number and its unit: « 187 km/h » is never cut at the end of a line (marketing). */
const nb = (text: string) => text.replace(/(\d) (?=(?:km\/h|m\/s|mm|km|m)(?![\p{L}\/]))/gu, "$1\u00a0");

/** A station's wettest day of the passage. */
function wettest(s: Mesure, jours: string[]): { mm: number; jour: string } | undefined {
  let best: { mm: number; jour: string } | undefined;
  (s.rr ?? []).forEach((v, i) => {
    if (v !== null && (!best || v > best.mm)) best = { mm: v, jour: jours[i] };
  });
  return best;
}

function row(s: Mesure, jours: string[]): string {
  const g = rafale(s, jours);
  const gust = `<td>${g ? `${kmh(g.ms)}<small>${dm(g.jour)}</small>` : "—"}</td>`;
  const name = `<th scope="row">${esc(s.station)}<small>${num(s.alt)}\u00a0m</small></th>`;
  if (jours.length > LONG) {
    const w = wettest(s, jours);
    return `<tr>${name}<td><b>${num(total(s.rr))}</b></td><td>${w ? `${num(w.mm)}<small>${dm(w.jour)}</small>` : "—"}</td>${gust}</tr>`;
  }
  const rain = jours.map((_, i) => {
    const v = s.rr?.[i];
    return `<td>${v === null || v === undefined ? "—" : num(v)}</td>`;
  });
  return `<tr>${name}${rain.join("")}<td><b>${num(total(s.rr))}</b></td>${gust}</tr>`;
}

function table(stations: Mesure[], jours: string[]): string {
  const long = jours.length > LONG;
  const head = long
    ? `<thead><tr><th scope="col">Station</th><th scope="col">Total</th><th scope="col">Jour le plus pluvieux</th><th scope="col">Rafale</th></tr></thead>`
    : `<thead><tr><th scope="col">Station</th>${jours.map((d) => `<th scope="col">${dm(d)}</th>`).join("")}<th scope="col">Total</th><th scope="col">Rafale</th></tr></thead>`;
  const caption = long
    ? `Total des ${jours.length} jours et pluie du jour le plus pluvieux en mm, rafale la plus forte en km/h`
    : "Pluie du jour et total en mm, rafale la plus forte en km/h";
  return `<table class="drought histo passe"><caption>${caption}</caption>${head}<tbody>${stations.map((s) => row(s, jours)).join("")}</tbody></table>`;
}

export function passePage(origin: string, p: Passe, alerte?: Alerte): string {
  const path = `/cyclones/${p.slug}`;
  const title = titleOf(p);
  const meta = metaOf(p);
  const { jours, stations } = mesures(p);
  const gusts = stations.filter((s) => rafale(s, jours)).length;
  const link = `<a href="${esc(p.document.url)}" rel="noopener">${esc(p.document.titre)}</a>`;
  const doc = `${link}, ${esc(p.document.auteur)}`;
  const band = `${crumbBar(`Cyclone ${p.nom}`)}
<div class="wrap intro"><div class="pitch">
  <p class="pill"><span class="dot"></span>Cyclones passés</p>
  <h1>${esc(`Cyclone ${p.nom}, ${p.date}`)}</h1>
  <p class="lead">${nb(esc(p.passage))}</p>
  <p class="note">Source : ${doc}.</p>
</div></div>`;
  const rest = stations.slice(SHOWN);
  const measured = `<section aria-labelledby="h-mesures">
  <div class="sec-h"><p class="eyebrow">Stations Météo-France</p><h2 id="h-mesures">Pluie et rafales mesurées</h2>
  <p>${stations.length} stations, de la plus arrosée à la moins arrosée${jours.length > LONG ? `, du ${jourFr(jours[0])} au ${jourFr(jours.at(-1)!)}` : ""}.${gusts < FEW_GUSTS ? ` Rafales : seulement ${gusts} stations les mesuraient en ${p.annee}.` : ""}</p></div>
  <div class="card table-wrap">${table(stations.slice(0, SHOWN), jours)}</div>
  ${rest.length ? `<details class="card table-wrap"><summary>Les ${rest.length} autres stations</summary>${table(rest, jours)}</details>` : ""}
  <p class="note">${esc(RAIN_NOTE)} Rafale : la plus forte des jours du tableau, en km/h arrondis (Météo-France la donne en m/s). « — » : pas de mesure ce jour-là.</p>
</section>`;
  // The table goes by rain: the strongest gusts, often at a station that got little, said apart.
  const strongest = stations
    .map((s) => ({ s, g: rafale(s, jours) }))
    .filter((x) => x.g)
    .sort((a, b) => b.g!.ms - a.g!.ms)
    .slice(0, GUSTS_SHOWN);
  const gustList = strongest.length
    ? `<section aria-labelledby="h-rafales">
  <div class="sec-h"><h2 id="h-rafales">Les rafales les plus fortes</h2></div>
  <div class="card"><ul class="plain">${strongest.map(({ s, g }) => `<li><b>${esc(s.station)}</b> : ${kmh(g!.ms)}\u00a0km/h (${num(g!.ms)}\u00a0m/s) le ${jourFr(g!.jour)}</li>`).join("")}</ul>
  ${p.rafales ? `<p class="note">${nb(esc(p.rafales))} (${doc})</p>` : ""}</div>
</section>`
    : "";
  const rec = records(p);
  const recs = rec.length
    ? `<section aria-labelledby="h-records">
  <div class="sec-h"><h2 id="h-records">Records de station</h2><p>La plus forte valeur de toute la série de la station.</p></div>
  <div class="card"><ul class="plain">${rec
    .map((r) =>
      r.quoi === "pluie"
        ? `<li><b>${esc(r.station)}</b> : ${num(r.mm!)}\u00a0mm de pluie le ${jourFr(r.jour)}, record de la station (mesures depuis ${r.depuis})</li>`
        : `<li><b>${esc(r.station)}</b> : rafale de ${kmh(r.ms!)}\u00a0km/h (${num(r.ms!)}\u00a0m/s) le ${jourFr(r.jour)}, record de la station (mesures depuis ${r.depuis})${
            p.limite && r.ms === p.limite.ms ? `. ${kmh(r.ms)}\u00a0km/h était « ${esc(p.limite.citation)} » (${link}).` : ""
          }</li>`,
    )
    .join("")}</ul></div>
</section>`
    : "";
  const alert = p.alerte
    ? `<section aria-labelledby="h-alerte"><div class="card"><h2 id="h-alerte">Alerte cyclonique</h2><p>${nb(esc(p.alerte))} <span class="note">(${doc})</span></p></div></section>`
    : "";
  const foot = `<section><p class="note">Mesures : <a href="${esc(SOURCE.url)}" rel="noopener">données climatologiques de base quotidiennes</a> de Météo-France (${esc(SOURCE.licence)}). Passage : ${doc}.</p>
<p><a href="/cyclones">Les cyclones du bassin en ce moment →</a> · <a href="/alerte-cyclone">Alerte cyclonique : ce qui ferme, ce qui continue →</a></p></section>`;
  const body = `${measured}\n${gustList}\n${recs}\n${alert}\n${foot}`;
  return layout(origin, { title, description: meta, path, jsonld: [crumbs(origin, `Cyclone ${p.nom}`, path), webPage(origin, path, title, meta, null)], alerte }, band, body);
}
