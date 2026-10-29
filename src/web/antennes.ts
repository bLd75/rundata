/**
 * /antennes: the island's antenna supports on a map, from the bundled files of the ANFR (vie/antennes.ts), with no
 * request. One layer at a time, chosen by radio buttons and CSS without a script: all the mobile supports, one
 * operator's, one generation's, or the FM, TNT or DAB+ supports. A dot per support, filled when an antenna is active (en
 * service, or techniquement opérationnel for the 5G), a ring when only planned. Then the communes' counts. Never coverage
 * nor exposure.
 */
import { INSEE } from "../places/insee.js";
import { nombre } from "../tools/format.js";
import * as antennes from "../vie/antennes.js";
import { dateLongue } from "../vie/internet.js";
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { esc, islandMap, project } from "./map.js";
import { credits, layout } from "./pages.js";

export const PATH = "/antennes";

// The words of the page, marketing's.
const T = {
  title: "Antennes Réunion : 4G, 5G, TNT et radio sur la carte · 974",
  description: "Les supports d'antennes mobiles (Orange, SFR Réunion, Free, Zeop) et les émetteurs de radio et de télévision de La Réunion, d'après l'ANFR.",
  h1: "Les antennes de La Réunion",
  note:
    "Supports d'antennes déclarés à l'ANFR, avec l'état que chaque opérateur déclare pour chaque génération (en service, techniquement opérationnel, projet approuvé) : " +
    "ce n'est ni l'état du réseau en ce moment, ni la couverture. Pour la 5G, l'ANFR n'emploie pas « en service » : son état le plus avancé est « techniquement opérationnel ». Free et SFR Réunion sont déclarés sous les noms Telco OI et SRR. Émetteurs de radio et de télévision de plus de 5 W seulement, " +
    "sans ceux de l'aviation civile, de la Défense ni de l'Intérieur. L'exposition aux ondes n'est pas mesurée ici : les mesures sont sur ",
};

interface Layer {
  id: string;
  tab: string;
  /** The supports with an active antenna, and those only planned. */
  on: { lon: number; lat: number }[];
  off: { lon: number; lat: number }[];
  legend: string;
}

/**
 * The generations an operator has active on a support: « en service » for the 2G to 4G, « techniquement opérationnel »
 * for the 5G, the ANFR never writing « en service » for it (test/antennes.test.ts checks both on each new file).
 */
const actif = (g: antennes.Generations) => (g.service ?? "") + (g.operationnel ?? "");

function layers(): Layer[] {
  const S = antennes.SUPPORTS;
  const split = (has: (g: antennes.Generations) => { on: boolean; any: boolean }) => {
    const on: antennes.Support[] = [], off: antennes.Support[] = [];
    for (const s of S) {
      const r = Object.values(s.ops).map((g) => has(g!));
      if (r.some((x) => x.on)) on.push(s);
      else if (r.some((x) => x.any)) off.push(s);
    }
    return { on, off };
  };
  const all = { id: "tous", tab: "Toutes", ...split((g) => ({ on: actif(g).length > 0, any: true })), legend: "" };
  all.legend = `${nombre(S.length)} supports d'antennes mobiles, dont ${nombre(all.on.length)} avec au moins une antenne active`;
  const ops = antennes.OPERATEURS.map((o) => {
    const on = S.filter((s) => s.ops[o] && actif(s.ops[o]!)), off = S.filter((s) => s.ops[o] && !actif(s.ops[o]!));
    return { id: o.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\W+/g, "-"), tab: o, on, off, legend: `${o} : ${nombre(on.length)} supports avec au moins une antenne active, ${nombre(off.length)} en projet seulement` };
  });
  const gens = ["2", "3", "4", "5"].map((g) => {
    const { on, off } = split((x) => ({ on: actif(x).includes(g), any: Object.values(x).some((v) => v!.includes(g)) }));
    const etat = g === "5" ? "techniquement opérationnelle" : "en service";
    return { id: `g${g}`, tab: `${g}G`, on, off, legend: `${g}G : ${nombre(on.length)} supports avec la ${g}G ${etat}, ${nombre(off.length)} en projet, tous opérateurs` };
  });
  const radio = (k: "fm" | "tnt" | "dab", tab: string, name: string) => {
    const on = antennes.EMETTEURS.filter((e) => e[k]);
    return { id: k, tab, on, off: [], legend: `${tab} : ${nombre(on.length)} supports d'émetteurs ${name}, ${nombre(on.reduce((n, e) => n + e[k]!, 0))} stations` };
  };
  return [all, ...ops, ...gens, radio("tnt", "TNT", "de télévision"), radio("fm", "FM", "de radio FM"), radio("dab", "DAB+", "de radio numérique")];
}

/** The dots of a layer, as one path: a dot is a move and an empty line with round caps, a few bytes each. */
const dots = (list: { lon: number; lat: number }[]) => list.map((p) => { const [x, y] = project(p.lon, p.lat); return `M${x} ${y}h0`; }).join("");

function map(ls: Layer[]): string {
  const on = ls[0].id;
  const tabs = `<div class="tabs aqtabs" role="radiogroup" aria-label="Antennes affichées sur la carte">` +
    ls.map((l) => `<input type="radio" name="ant" id="ant-${l.id}"${l.id === on ? ' class="on" checked' : ""}><label for="ant-${l.id}">${esc(l.tab)}</label>`).join("") + `</div>`;
  const overlay = ls.map((l) => `<g class="ly ly-${l.id}${l.id === on ? " on" : ""}">` +
    (l.off.length ? `<path class="off" d="${dots(l.off)}"/><path class="off2" d="${dots(l.off)}"/>` : "") + `<path class="in" d="${dots(l.on)}"/></g>`).join("");
  const legend = ls.map((l) => `<span class="lg lg-${l.id}${l.id === on ? " on" : ""}">${esc(l.legend)}.</span>`).join("");
  return `<figure class="card mapcard antmap">${tabs}` +
    islandMap({ overlay, peaks: true, label: "Carte de La Réunion (974) : les supports d'antennes déclarés à l'ANFR, un choix à la fois" }) +
    `<figcaption class="note"><span class="key"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="5" class="in"/></svg> active : en service, ou techniquement opérationnelle pour la 5G</span> ` +
    `<span class="key"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4" class="ring"/></svg> en projet seulement (projet approuvé)</span>${legend}</figcaption></figure>`;
}

function table(): string {
  const rows = Object.keys(INSEE).sort((a, b) => a.localeCompare(b, "fr")).map((nom) => {
    const { supports, emetteurs } = antennes.ofCommune(nom);
    const g5 = supports.filter((s) => antennes.generations(s, "operationnel").has("5")).length;
    const ops = antennes.OPERATEURS.map((o) => `${o} ${nombre(supports.filter((s) => s.ops[o]).length)}`).join(", ");
    return `<tr><th scope="row">${esc(nom)}</th><td data-label="Supports mobiles">${nombre(supports.length)}</td><td data-label="Dont 5G techniquement opérationnelle">${nombre(g5)}</td><td data-label="Supports par opérateur">${esc(ops)}</td><td data-label="Supports radio et TV">${nombre(emetteurs.length)}</td></tr>`;
  }).join("");
  return `<div class="card table-wrap"><table class="drought niveaux"><thead><tr><th scope="col">Commune</th><th scope="col">Supports mobiles</th><th scope="col">Dont 5G techniquement opérationnelle</th><th scope="col">Supports par opérateur</th><th scope="col">Supports radio et TV</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** The page's band and body: the same until the next build, as the files are bundled. Built at the first view only. */
let built: { band: string; body: string } | undefined;

function build() {
  const lead = `${nombre(antennes.SUPPORTS.length)} supports d'antennes mobiles déclarés à l'ANFR au ${dateLongue(antennes.MOBILE_DU)}, et ${nombre(antennes.EMETTEURS.length)} supports d'émetteurs de radio et de télévision au ${dateLongue(antennes.RADIO_DU)}.`;
  const band = `${crumbBar("Antennes")}
<div class="wrap intro"><div class="pitch">
  <h1>${esc(T.h1)}</h1>
  <p class="lead">${esc(lead)}</p>
</div></div>`;
  const body = `<section aria-labelledby="h-carte"><h2 id="h-carte">Sur la carte</h2>${map(layers())}</section>
<section aria-labelledby="h-communes"><h2 id="h-communes">Par commune</h2>${table()}
  <p><a href="/#assistant">Les antennes près de votre adresse : demandez à votre IA →</a></p></section>
<section aria-labelledby="h-src"><h2 id="h-src">À savoir</h2>
  <p class="note">${esc(T.note)}<a href="https://www.cartoradio.fr" rel="noopener">cartoradio.fr</a>.</p>
  <p class="sources">Sources : ${credits([antennes.SOURCE_MOBILE, antennes.SOURCE_RADIO].map((x) => ({ source: x.attribution, licence: x.licence, attribution: x.attribution })))}.</p>
</section>`;
  return { band, body };
}

export function antennesPage(origin: string, alerte?: Alerte): string {
  built ??= build();
  return layout(origin, { title: T.title, description: T.description, path: PATH, jsonld: [crumbs(origin, "Antennes", PATH), webPage(origin, PATH, T.title, T.description, null)], alerte }, built.band, built.body);
}
