/**
 * A stop's page (/bus/arret/<commune>/<name>): the next buses there, of all lines and networks, each leading to its
 * trip; and the search for a stop (/bus/arret?q=), which goes straight to the page when one stop answers. Built at each
 * view from the timetables, as the tool answers for a stop, never kept: some 4 900 pages, a few hundred indexed.
 */
import * as transit from "../providers/transit.js";
import { localTime } from "../geo.js";
import type { stopPageDepartures } from "../tools/transports.js";
import { alertList, crumbBar, crumbs, departureLi, STOP_PATH, stopSearch, waitText } from "./domains.js";
import { esc } from "./map.js";
import { type Alerte, credit } from "./data.js";
import { credits, DESCRIPTION_MAX, layout } from "./pages.js";

type Departures = Awaited<ReturnType<typeof stopPageDepartures>>;

/** At most this many stops in a search's list. */
export const SEARCH_MAX = 20;

const networksOf = (p: transit.StopPage) => [...new Set(p.groups.map((g) => transit.NETWORKS[g.reseau]?.nom ?? g.reseau))];
const list = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}` : names[0] ?? "");

/** « Arrêt Gare de St-Pierre, Saint-Pierre », without the commune when the name already says it (« Mairie Du Tampon »). */
function titled(p: transit.StopPage): string {
  const town = transit.expand(p.commune).replace(/^(?:le|la|les|l) /, "");
  return transit.expand(p.nom).includes(town) ? `Arrêt ${p.nom}` : `Arrêt ${p.nom}, ${p.commune}`;
}

/**
 * The description: the lines that stop there, as many as its 160 signs allow, then « et {n} autres ». A long name leaves
 * them no room: then the commune goes when the name says it (as in the title), then « directions et heures de passage »,
 * then the networks' names, before the last lines do.
 */
function described(p: transit.StopPage, lignes: string[]): string {
  const live = p.groups.some((g) => transit.NETWORKS[g.reseau]?.temps_reel);
  const nets = ` ${live ? "de" : "par"} ${list(networksOf(p))}`;
  const say = (cut: number, shown: string[], more: number) =>
    `Prochains bus à l'arrêt ${p.nom}${cut >= 1 && titled(p) === `Arrêt ${p.nom}` ? "" : ` (${p.commune})`}, tous réseaux : ` +
    (shown.length ? `ligne${shown.length + more > 1 ? "s" : ""} ${shown.join(", ")}${more ? ` et ${more} autres` : ""}, ` : "") +
    `${cut >= 2 ? "" : "directions et heures de passage, "}d'après les horaires ${live ? "et les annonces en direct" : "publiés"}${cut >= 3 ? "" : nets}.`;
  for (let cut = 0; cut <= 3; cut++) {
    for (let n = lignes.length; n > 0; n--) {
      const d = say(cut, lignes.slice(0, n), lignes.length - n);
      if (d.length <= DESCRIPTION_MAX) return d;
    }
  }
  return [0, 1, 2, 3].map((cut) => say(cut, [], 0)).find((d) => d.length <= DESCRIPTION_MAX) ?? say(3, [], 0);
}

export function stopPage(origin: string, p: transit.StopPage, d: Departures, now = new Date(), alerte?: Alerte): string {
  const path = `${STOP_PATH}/${p.slug}`;
  const title = `${titled(p)} : prochains bus · 974`;
  const description = described(p, d.lignes);
  const names = p.groups.map((g) => `${esc(transit.NETWORKS[g.reseau]?.nom ?? g.reseau)} : ${esc(g.nom)}`).join(" · ");

  const band = `${crumbBar(p.nom, { name: "Bus", path: "/bus" })}
<div class="wrap intro">
  <div class="pitch">
    <h1>Arrêt ${esc(p.nom)}</h1>
    <p class="lead">${esc(p.commune)} · ${names}</p>
    <p>Les prochains bus qui passent à cet arrêt, toutes lignes et tous réseaux confondus. Chaque départ mène à son parcours, arrêt par arrêt.</p>
  </div>
</div>`;

  const rows = d.departs.length
    // The wait under the direction: beside it, a delay announced leaves the direction no room on a phone.
    ? `<ul class="rows arret">${d.departs.map((x) => departureLi(x, waitText(x.dans_min, x.heure_annoncee ?? x.heure))).join("")}</ul>`
    : `<p>Pas de départ prévu dans les prochaines heures.</p>`;
  const flux = d.flux ? localTime(new Date(d.flux * 1000)).split(" ")[1] : undefined;
  const note = `<p class="note">${d.direct.length && flux ? `${esc(d.direct.join(", "))} : heures annoncées en direct par le réseau quand le bus y figure (flux de ${esc(flux)}). ` : ""}` +
    `Sinon, horaires théoriques publiés par chaque réseau, sans les retards ni les déviations. Mis à jour à ${esc(localTime(now).split(" ")[1])}.</p>`;

  const body = `<section>
  <div class="card">${d.aucun ? `<p>${esc(d.aucun)}</p>` : ""}${rows}</div>
  ${note}
  <p class="note">Sources : ${credits(d.sources.map(credit))}.</p>
</section>
${d.alertes.length ? `<section aria-labelledby="h-trafic"><h2 id="h-trafic">Info trafic</h2><div class="card">${alertList(d.alertes)}<p class="note">Publié par les réseaux dans leur flux en direct, repris tel quel.</p></div></section>` : ""}`;

  return layout(origin, { title, description, path, ...(p.indexe ? {} : { noindex: true }), jsonld: [crumbs(origin, p.nom, path, { name: "Bus", path: "/bus" })], alerte }, band, body);
}

/** A search with several stops, or none: the list to choose from, or what to type. Never indexed. */
export function searchPage(origin: string, q: string, found: transit.StopPage[], alerte?: Alerte): string {
  const shown = found.slice(0, SEARCH_MAX);
  const result = found.length
    ? `<h2>${found.length} arrêts pour « ${esc(q)} » : choisissez le vôtre</h2>
<ul class="rows bikes">${shown.map((p) => `<li><span><a href="${STOP_PATH}/${esc(p.slug)}">${esc(p.nom)}</a> · ${esc(p.commune)} · ${esc(networksOf(p).join(", "))}</span></li>`).join("")}</ul>
${found.length > SEARCH_MAX ? `<p class="note">Les ${SEARCH_MAX} premiers sont affichés : ajoutez la commune pour affiner.</p>` : ""}`
    : `<p>Aucun arrêt de bus trouvé pour « ${esc(q)} ». Donnez le nom de l'arrêt et sa commune (« Gare routière, Saint-Pierre »).</p>`;
  const band = `${crumbBar("Arrêt de bus", { name: "Bus", path: "/bus" })}
<div class="wrap intro"><div class="pitch"><h1>Arrêt de bus</h1>${stopSearch(q)}</div></div>`;
  return layout(origin, { title: "Arrêt de bus · 974", description: "Prochains bus à un arrêt de La Réunion (974), tous réseaux.", path: STOP_PATH, noindex: true, jsonld: [], alerte }, band, `<section class="card">${result}</section>`);
}
