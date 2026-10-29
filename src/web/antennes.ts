/**
 * /antennes: the island's antenna supports on a map, from the bundled files of the ANFR (vie/antennes.ts), with no
 * request. One layer at a time, chosen by radio buttons and CSS without a script: all the mobile supports, one
 * operator's, one generation's, or the FM, TNT or DAB+ supports. A dot per support, filled when an antenna is active (en
 * service, or techniquement opérationnel for the 5G), a ring when only planned. Then the communes' counts. Never coverage
 * nor exposure.
 */
import type { Cached } from "../cache.js";
import { INSEE } from "../places/insee.js";
import * as sitesHs from "../providers/sites-hs.js";
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

// The words of the mobile sites out of service, marketing's.
/** The island's four mobile networks, as said here, by the names the file may give them. */
const RESEAUX: [string, string[]][] = [["Free", ["Free"]], ["SFR Réunion", ["SFR", "SRR"]], ["Zeop", ["Zeop", "ZEOP"]], ["Orange", ["Orange"]]];
const de = (n: string) => (/^[AEIOUaeiou]/.test(n) ? `d'${n}` : `de ${n}`);
const et = (list: string[], mot: string) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} ${mot} ${list[list.length - 1]}` : list[0]);

/**
 * What the file leaves out, from the file read, never written: the networks with no site in it at La Réunion, so that
 * « aucun site » never reads as « aucune panne ». None when the four are there; with no site at all, who declares is
 * not known from the file: said in general.
 */
export function absents(sites: sitesHs.Site[]): string | undefined {
  const present = RESEAUX.filter(([, noms]) => sites.some((s) => noms.includes(s.operateur))).map(([n]) => n);
  if (!present.length) return "Seuls les sites que les opérateurs déclarent à l'Arcep figurent dans ce fichier : une panne non déclarée n'apparaît pas ici.";
  const absent = RESEAUX.map(([n]) => n).filter((n) => !present.includes(n));
  if (!absent.length) return undefined;
  return `Ce fichier de l'Arcep ne liste à La Réunion que des sites déclarés par ${et(present, "et")} : aucun site ${et(absent.map(de), "ni")} à La Réunion n'y figure. Une panne de ${absent.length > 1 ? "leurs réseaux" : "son réseau"} peut donc ne pas apparaître ici.`;
}

const jm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const gens = (g: string) => [...g].map((x) => `${x}G`).join(" et ");

/** What is cut on a site: in full when the file says so, else the generations it names, else « en partie ». */
export function coupe(s: sitesHs.Site): string {
  if (s.voix && s.data) return "voix, SMS et internet mobile coupés";
  if (s.voix) return "voix et SMS coupés";
  if (s.data) return "internet mobile coupé";
  const parts = [s.voix_g && `voix et SMS coupés en ${gens(s.voix_g)} seulement`, s.data_g && `internet mobile coupé en ${gens(s.data_g)} seulement`].filter(Boolean);
  return parts.length ? parts.join(", ") : "service coupé en partie";
}

/** « Saint-Philippe : Free, voix, SMS et internet mobile coupés (panne), depuis le 28/10, fin prévue par Free le 04/11. » */
export const ligneSite = (s: sitesHs.Site) =>
  `${s.commune} : ${s.operateur}, ${coupe(s)}${s.raison ? ` (${s.raison})` : ""}${s.debut ? `, depuis le ${jm(s.debut)}` : ""}${s.fin ? `, fin prévue par ${s.operateur} le ${jm(s.fin)}` : ", fin non précisée"}.`;

const sitesMot = (n: number) => (n > 1 ? `${nombre(n)} sites mobiles` : `${nombre(n)} site mobile`);

/** The section of the sites out of service: the file's day, its sites by commune, and what the file leaves out. */
export function horsService(c: Cached<sitesHs.Copie> | null, now: Date): string {
  let head: string;
  let list = "";
  let note: string | undefined;
  if (!c) head = "Le fichier de l'Arcep n'a pas encore été lu.";
  else {
    const { fichier_du, sites } = c.value;
    // Before the day's file is read (each morning), or when its read failed: the file before, said as the last one.
    const du = `Fichier de l'Arcep du ${dateLongue(fichier_du)}${fichier_du === now.toISOString().slice(0, 10) ? "" : ", le dernier lu"}`;
    head = sites.length ? `${du} : ${sitesMot(sites.length)} hors service à La Réunion.` : `${du} : aucun site mobile déclaré hors service à La Réunion.`;
    if (sites.length) list = `<ul class="hs">${sites.map((s) => `<li>${esc(ligneSite(s))}</li>`).join("")}</ul>`;
    note = absents(sites);
  }
  return `<section aria-labelledby="h-hs"><h2 id="h-hs">Sites mobiles hors service</h2>
  <div class="card"><p>${esc(head)}</p>${list}${note ? `<p class="note">${esc(note)}</p>` : ""}</div></section>`;
}

/**
 * The line of a commune's tile, only when the file has sites there: « 1 site Free hors service (panne), d'après le
 * fichier de l'Arcep du 29 octobre 2026 ».
 */
export function ligneTuile(c: Cached<sitesHs.Copie> | null, insee: string): string | undefined {
  const sites = c?.value.sites.filter((s) => s.insee === insee) ?? [];
  if (!sites.length) return undefined;
  const ops = [...new Set(sites.map((s) => s.operateur))].join(" et ");
  const by = (r: string) => sites.filter((s) => s.raison === r).length;
  const raisons = sites.length === 1
    ? sites[0].raison ?? ""
    : [["panne", "pannes"], ["maintenance", "maintenances"]].flatMap(([r, rs]) => (by(r) ? [`${nombre(by(r))} ${by(r) > 1 ? rs : r}`] : [])).join(", ");
  return `${nombre(sites.length)} ${sites.length > 1 ? "sites" : "site"} ${ops} hors service${raisons ? ` (${raisons})` : ""}, d'après le fichier de l'Arcep du ${dateLongue(c!.value.fichier_du)}`;
}

/** The page's band and its parts that do not change until the next build, as the files are bundled. Built at the first view only. */
let built: { band: string; carte: string; reste: string } | undefined;

function build() {
  const lead = `${nombre(antennes.SUPPORTS.length)} supports d'antennes mobiles déclarés à l'ANFR au ${dateLongue(antennes.MOBILE_DU)}, et ${nombre(antennes.EMETTEURS.length)} supports d'émetteurs de radio et de télévision au ${dateLongue(antennes.RADIO_DU)}.`;
  const band = `${crumbBar("Antennes")}
<div class="wrap intro"><div class="pitch">
  <h1>${esc(T.h1)}</h1>
  <p class="lead">${esc(lead)}</p>
</div></div>`;
  const carte = `<section aria-labelledby="h-carte"><h2 id="h-carte">Sur la carte</h2>${map(layers())}</section>`;
  const reste = `<section aria-labelledby="h-communes"><h2 id="h-communes">Par commune</h2>${table()}
  <p><a href="/#assistant">Les antennes près de votre adresse : demandez à votre IA →</a></p></section>
<section aria-labelledby="h-src"><h2 id="h-src">À savoir</h2>
  <p class="note">${esc(T.note)}<a href="https://www.cartoradio.fr" rel="noopener">cartoradio.fr</a>.</p>`;
  return { band, carte, reste };
}

const SOURCES = [antennes.SOURCE_MOBILE, antennes.SOURCE_RADIO, sitesHs.SOURCE].map((x) => ({ source: x.attribution, licence: x.licence, attribution: x.attribution }));

/** `hs`: the copy of the sites out of service (providers/sites-hs.ts), its one read; null before the first. */
export function antennesPage(origin: string, hs: Cached<sitesHs.Copie> | null, now = new Date(), alerte?: Alerte): string {
  built ??= build();
  const body = `${built.carte}\n${horsService(hs, now)}\n${built.reste}
  <p class="sources">Sources : ${credits(SOURCES)}.</p>
</section>`;
  return layout(origin, { title: T.title, description: T.description, path: PATH, jsonld: [crumbs(origin, "Antennes", PATH), webPage(origin, PATH, T.title, T.description, hs)], alerte }, built.band, body);
}
