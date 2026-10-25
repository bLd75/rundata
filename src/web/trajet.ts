/**
 * A bus's trip, from a departure of /bus or of a commune's page: all its stops in order, each with its time, the
 * stop clicked on marked, and what the network's real-time feed says of it while it is on the road. Built at each
 * view from the timetables (two reads of D1), never kept: there are thousands of trips a day.
 */
import { localTime } from "../geo.js";
import * as rt from "../providers/gtfsrt.js";
import * as transit from "../providers/transit.js";
import { fr } from "../tools/format.js";
import { dayName, type TripRun, type TripStop } from "../tools/transports.js";
import { crumbBar, crumbs, saidNow } from "./domains.js";
import { esc } from "./map.js";
import { type Alerte, credit } from "./data.js";
import { credits, DESCRIPTION_MAX, layout, SITE } from "./pages.js";

const TITLE_MAX = 60;
const NBSP = " ";

/** « 7h05 », the time of La Réunion. */
const clock = (ms: number) => {
  const [h, m] = localTime(new Date(ms)).split(" ")[1].split(":");
  return `${Number(h)}h${m}`;
};
/** « 07:29 », as the other pages give a feed's time. */
const feedTime = (s: number) => localTime(new Date(s * 1000)).split(" ")[1];
const ymdOf = (ms: number) => Number(new Date(ms + 4 * 3600_000).toISOString().slice(0, 10).replace(/-/g, ""));
const weekdayOf = (ms: number) => (new Date(ms + 4 * 3600_000).getUTCDay() + 6) % 7;

/** « aujourd'hui », « demain », else the day and its date (« samedi 31 octobre »), of a moment as seen at `now`. */
function dayOf(ms: number, now: Date): string {
  const d = ymdOf(ms);
  const today = ymdOf(now.getTime());
  if (d === today) return "aujourd'hui";
  if (d === ymdOf(now.getTime() + 86_400_000)) return "demain";
  return dayName({ ymd: d, weekday: weekdayOf(ms) });
}

/** A stop's time as seen now: « demain 0h10 » after midnight, said only within a day and a half of it. */
const timeOf = (ms: number, now: Date) => (Math.abs(ms - now.getTime()) < 36 * 3600_000 ? saidNow(clock(ms), ms, now) : clock(ms));

/** What the feed says at a stop, HTML: « annoncé 7h12 (+5 min) », « à l'heure », « ne passe pas à cet arrêt ». */
function liveAt(s: TripStop, now: Date): string {
  if (s.saute) return ` <b class="rt">ne passe pas à cet arrêt</b>`;
  if (s.annonce === undefined) return "";
  const m = Math.floor(s.annonce / 60_000) - Math.floor(s.at / 60_000);
  const said = m === 0 ? "à l'heure" : `annoncé ${esc(timeOf(s.annonce, now))} (${m > 0 ? `+${fr(m)} min` : `${fr(-m)} min d'avance`})`;
  return ` <b class="rt" title="Heure annoncée en direct par le réseau">${said}</b>`;
}

/** The note under the stops: what is scheduled and what is announced, by the network's feed or without one. */
function liveNote(t: TripRun): string {
  const n = t.nom_reseau;
  if (!t.direct) return `Horaires publiés par ${n}, sans les retards ni les déviations.`;
  if (t.direct.etat === "muet") return `Le flux en direct de ${n} ne répond pas pour le moment${NBSP}: horaires publiés seulement.`;
  const at = feedTime(t.direct.flux);
  return t.direct.etat === "suivi"
    ? `Prévu${NBSP}: horaires publiés par ${n}. Annoncé${NBSP}: heure donnée en direct par ${n}, flux de ${at}. Un bus en retard l'est souvent depuis sa course précédente.`
    : `Ce bus ne figure pas dans le flux en direct de ${n} (flux de ${at})${NBSP}: horaires publiés seulement, sans les retards ni les déviations.`;
}

/** The page of a trip; `chosen`, the stop clicked on (island-wide index), marked when the trip stops there. */
export function tripPage(origin: string, path: string, t: TripRun, chosen: number | undefined, now = new Date(), alerte?: Alerte): string {
  const start = clock(t.depart);
  const full = `Ligne ${t.ligne} vers ${t.direction}, départ ${start} : tous les arrêts · 974`;
  const title = full.length <= TITLE_MAX ? full : `Ligne ${t.ligne} vers ${t.direction}, départ ${start} · 974`;
  const n = t.arrets?.length;
  const tail = n ? ` : les ${n} arrêts du parcours dans l'ordre, avec l'heure de passage à chacun.` : ".";
  const lean = n ? ` : les ${n} arrêts du parcours, avec l'heure de passage à chacun.` : ".";
  const description = [
    `Ligne ${t.ligne} (${t.nom_reseau}), départ de ${t.origine} à ${start} vers ${t.direction}${tail}`,
    `Ligne ${t.ligne}, départ de ${t.origine} à ${start} vers ${t.direction}${tail}`,
    `Ligne ${t.ligne}, départ de ${t.origine} à ${start} vers ${t.direction}${lean}`,
  ].find((d) => d.length <= DESCRIPTION_MAX) ?? `Ligne ${t.ligne}, départ de ${t.origine} à ${start} vers ${t.direction}${lean}`;

  const band = `${crumbBar(`Ligne ${t.ligne}`, { name: "Bus", path: "/bus" })}
<div class="wrap intro">
  <div class="pitch">
    <h1>Ligne ${esc(t.ligne)} vers ${esc(t.direction)}</h1>
    <p class="lead">${esc(t.nom_reseau)} · départ de ${esc(t.origine)} à ${esc(start)}, ${esc(dayOf(t.depart, now))}</p>
  </div>
</div>`;

  const cut = t.supprime && t.direct && t.direct.etat !== "muet"
    ? `<p class="card"><b class="rt">Départ supprimé, annoncé en direct par ${esc(t.nom_reseau)} (flux de ${esc(feedTime(t.direct.flux))}).</b></p>`
    : "";
  const stops = t.arrets
    ? `<ol class="rows trajet">${t.arrets.map((s) => {
        const here = s.id === chosen;
        const at = esc(timeOf(s.at, now));
        return `<li id="arret-${s.id - transit.NETWORKS[t.reseau].first_stop}"${here ? ` class="ici" aria-current="location"` : ""}>` +
          `<span class="note">${t.supprime ? `<s>${at}</s>` : at}</span>` +
          // What the feed says goes under the name: beside it, it leaves the name a few letters a line on a phone.
          `<span>${esc(s.nom)}<small>${esc(s.commune)}${here ? " · arrêt choisi" : ""}</small>${t.supprime ? "" : liveAt(s, now)}</span></li>`;
      }).join("")}</ol>`
    : `<p class="card">Liste des arrêts indisponible pour le moment.</p>`;
  const sources = [credit(transit.SOURCE), ...(t.direct && t.direct.etat !== "muet" ? [credit(rt.SOURCE)] : [])];

  const body = `<section aria-label="Arrêts du parcours">
  ${cut}
  ${stops}
  <p class="note">${liveNote(t)}</p>
  <p class="note">Sources : ${credits(sources)}.</p>
</section>`;

  return layout(origin, { title, description, path, noindex: true, jsonld: [crumbs(origin, `Ligne ${t.ligne}`, path, { name: "Bus", path: "/bus" })], alerte }, band, body);
}

/** A trip that the timetables no longer have, or that they could not say: said, with the way to the next departures. 404, so that engines forget the link. */
export function tripGonePage(origin: string, path: string, net: string | undefined, alerte?: Alerte, down = false): string {
  const n = net ? transit.NETWORKS[net]?.nom : undefined;
  // The timetables that do not answer (the tool's words): the trip may well be there.
  const said = down
    ? "Les horaires de bus ne répondent pas pour le moment. Réessayer dans un instant."
    : n ? `Ce départ ne figure plus dans les horaires publiés par ${n}.` : "Ce départ ne figure plus dans les horaires publiés des réseaux.";
  return layout(origin, { title: `Page introuvable · ${SITE}`, description: said, path, noindex: true, jsonld: [], alerte },
    `${crumbBar("Page introuvable", { name: "Bus", path: "/bus" })}<div class="wrap intro"><div class="pitch"><h1>Page introuvable</h1><p class="lead">${esc(said)}</p><p><a href="/bus">Prochains départs dans les gares →</a></p></div></div>`, "");
}
