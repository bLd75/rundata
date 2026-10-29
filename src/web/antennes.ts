/**
 * /antennes: the island's antenna supports on a map, from the bundled files of the ANFR (vie/antennes.ts), with no
 * request. Two rows of filters that combine, an operator and a type (a generation, or the FM, TNT or DAB+ supports), set
 * by the page's address too (« #orange-5g »), and the dots coloured by operator or by generation; without the script,
 * every mobile support coloured by operator. A dot per support, filled when an antenna is active (en service, or
 * techniquement opérationnel for the 5G), a ring when only planned. Then the communes' counts. Never coverage nor
 * exposure.
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

/**
 * The generations an operator has active on a support: « en service » for the 2G to 4G, « techniquement opérationnel »
 * for the 5G, the ANFR never writing « en service » for it (test/antennes.test.ts checks both on each new file).
 */
const actif = (g: antennes.Generations) => (g.service ?? "") + (g.operationnel ?? "");

/** The operators in the page's address and filters, and their letter in a support's code. */
const OPS: { id: string; o: antennes.Operateur; k: string }[] = antennes.OPERATEURS.map((o) => ({
  id: o.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\W+/g, "-"), o, k: o[0].toLowerCase(),
}));
const GENS = ["2", "3", "4", "5"] as const;
const RADIOS = [{ id: "tnt", tab: "TNT", name: "de télévision" }, { id: "fm", tab: "FM", name: "de radio FM" }, { id: "dab", tab: "DAB+", name: "de radio numérique" }] as const;

/** A support's operators: each one's letter, its generations active, and those only planned. */
type Code = [string, string, string][];

/** « o2345 s234+5 »: Orange active in 2G to 5G, SFR Réunion active in 2G to 4G with the 5G planned. */
export const code = (s: antennes.Support): string =>
  OPS.filter(({ o }) => s.ops[o]).map(({ o, k }) => {
    const g = s.ops[o]!, a = actif(g), p = [...(g.projet ?? "")].filter((x) => !a.includes(x)).join("");
    return `${k}${[...a].sort().join("")}${p ? `+${p}` : ""}`;
  }).join(" ");

const parse = (c: string): Code => [...c.matchAll(/([a-z])(\d*)(?:\+(\d+))?/g)].map((m) => [m[1], m[2], m[3] ?? ""]);

/**
 * How a support shows for an operator (`o`, its letter, "" for all) and a generation (`g`, "" for all), its colour by
 * operator (`m` "o") or by generation ("t"): hidden (null), else whether it is a ring (only planned) and its colour's
 * key. By operator, the operators that have that generation: one, its colour; several, « plusieurs », even when one
 * operator is chosen. By generation, the most recent active, else the most recent planned, of the operator chosen or
 * of all. The page's script runs the same, from LOOK: the test runs both on every support.
 */
export function look(d: Code, o: string, g: string, m: string): [boolean, string] | null {
  const r = d.filter(([x]) => !o || x === o);
  const on = r.some(([, a]) => (g ? a.includes(g) : a.length > 0));
  if (!on && !r.some(([, a, p]) => !g || (a + p).includes(g))) return null;
  if (m === "o") {
    const w = d.filter(([, a, p]) => !g || (a + p).includes(g));
    return [!on, w.length > 1 ? "m" : w[0][0]];
  }
  const a = r.map((x) => x[1]).join(""), x = Math.max(...[...(a || r.map((y) => y[2]).join(""))].map(Number));
  return [!on, x === 5 ? "5" : x === 4 ? "4" : "2"];
}

/** look(), for the page's script. */
export const LOOK = `const look=(d,o,g,m)=>{const r=d.filter(([x])=>!o||x===o);const on=r.some(([,a])=>g?a.includes(g):a.length>0);if(!on&&!r.some(([,a,p])=>!g||(a+p).includes(g)))return null;
if(m==="o"){const w=d.filter(([,a,p])=>!g||(a+p).includes(g));return[!on,w.length>1?"m":w[0][0]]}
const a=r.map((x)=>x[1]).join(""),x=Math.max(...[...(a||r.map((y)=>y[2]).join(""))].map(Number));return[!on,x===5?"5":x===4?"4":"2"]};`;

/** The colours, marketing's (Okabe-Ito, never an operator's brand colour): by operator, then by generation. */
export const COULEURS: Record<string, string> = { o: "#56b4e9", s: "#f0e442", f: "#b0508a", z: "#2563d8", m: "#0b1f36", 5: "#f0e442", 4: "#56b4e9", 2: "#b4c6d8", r: "#b0508a" };

// The words of the filters and of the legends, marketing's.
const MOTS = {
  operateur: "Opérateur :",
  type: "Type :",
  couleur: "Couleur :",
  tous: "Tous",
  parOperateur: "par opérateur",
  parType: "par type",
  plusieurs: "Plusieurs opérateurs",
  types: { 5: "5G", 4: "4G", 2: "3G ou 2G seulement", r: "Radio et TV (TNT, FM, DAB+)" } as Record<string, string>,
  typeNote: "Couleur de la génération mobile la plus récente active sur le support.",
  formes: "Point plein : au moins une antenne active (en service, ou techniquement opérationnelle pour la 5G). Anneau : en projet seulement (projet approuvé).",
};

/** The count under the map for each choice, keyed as the page's address: « orange-5g », « tnt », « tous ». */
function counts(codes: Code[]): [string, string][] {
  const S = antennes.SUPPORTS;
  const count = (o: string, g: string) => {
    const l = codes.map((d) => look(d, o, g, "o")).filter((x) => x !== null);
    return { on: l.filter((x) => !x[0]).length, off: l.filter((x) => x[0]).length };
  };
  const out: [string, string][] = [];
  for (const op of [undefined, ...OPS]) {
    for (const g of ["", ...GENS]) {
      const { on, off } = count(op?.k ?? "", g);
      const etat = g === "5" ? "techniquement opérationnelle" : "en service";
      const key = [op?.id, g && `${g}g`].filter(Boolean).join("-") || "tous";
      out.push([key, !op && !g ? `${nombre(S.length)} supports d'antennes mobiles, dont ${nombre(on)} avec au moins une antenne active`
        : !g ? `${op!.o} : ${nombre(on)} supports avec au moins une antenne active, ${nombre(off)} en projet seulement`
        : !op ? `${g}G : ${nombre(on)} supports avec la ${g}G ${etat}, ${nombre(off)} en projet, tous opérateurs`
        : `${op.o}, ${g}G : ${nombre(on)} supports avec la ${g}G ${etat}, ${nombre(off)} en projet`]);
    }
  }
  for (const r of RADIOS) {
    const on = antennes.EMETTEURS.filter((e) => e[r.id]);
    out.push([r.id, `${r.tab} : ${nombre(on.length)} supports d'émetteurs ${r.name}, ${nombre(on.reduce((n, e) => n + e[r.id]!, 0))} stations`]);
  }
  return out;
}

/** The filters' script: the choice from the buttons or the address (« #orange-5g »), each support's look, the legends. */
const FILTRES_SCRIPT = `(()=>{const f=document.querySelector(".antf");if(!f)return;const fig=f.closest("figure"),S=[...fig.querySelectorAll("circle.s")],E=[...fig.querySelectorAll("circle.e")];
${LOOK}
const D=S.map((s)=>[...s.dataset.g.matchAll(/([a-z])(\\d*)(?:\\+(\\d+))?/g)].map((m)=>[m[1],m[2],m[3]||""]));
const ins=(n)=>[...f.querySelectorAll("[name="+n+"]")],val=(n)=>(ins(n).find((i)=>i.checked)||{}).value||"",set=(n,v)=>ins(n).forEach((i)=>{i.checked=i.value===v});
let mode=val("ac");const RADIOS=${JSON.stringify(RADIOS.map((r) => r.id))};
const draw=(keep)=>{const t=val("at"),radio=RADIOS.includes(t);if(radio){set("ao","");set("ac","t")}else set("ac",mode);ins("ao").concat(ins("ac")).forEach((i)=>{i.disabled=radio});
f.querySelectorAll(".r-ao,.r-ac").forEach((r)=>r.classList.toggle("dis",radio));
const op=f.querySelector("[name=ao]:checked"),o=op&&op.value?op.dataset.k:"",g=radio?"":t.slice(0,1),m=radio?"t":mode;
S.forEach((s,i)=>{const l=radio?null:look(D[i],o,g,m);s.setAttribute("class",l?"s k"+l[1]+(l[0]?" r":""):"s h")});
E.forEach((e)=>e.setAttribute("class",radio&&e.dataset.k.split(" ").includes(t)?"e kr":"e h"));
const key=[val("ao"),t].filter(Boolean).join("-")||"tous";fig.querySelectorAll(".lg").forEach((x)=>{x.hidden=x.dataset.k!==key});
fig.querySelector(".lgc-o").hidden=m!=="o";fig.querySelector(".lgc-t").hidden=m!=="t";fig.querySelector(".lgc-t").classList.toggle("radio",radio);fig.querySelector(".formes").hidden=radio;
if(!keep)history.replaceState(null,"",key==="tous"?location.pathname+location.search:"#"+key)};
const read=()=>{const h=decodeURIComponent(location.hash.slice(1)),op=ins("ao").find((i)=>i.value&&(h===i.value||h.startsWith(i.value+"-"))),t=op?h.slice(op.value.length+1):h;
if(!op&&!ins("at").some((i)=>i.value&&i.value===t))return false;set("ao",op?op.value:"");set("at",ins("at").some((i)=>i.value===t)?t:"");return true};
f.addEventListener("change",(e)=>{if(e.target.name==="ac")mode=e.target.value;draw()});addEventListener("hashchange",()=>{if(read())draw(true)});
f.hidden=false;read();draw(true)})();`;

/** A row of buttons, one choice: its name, then « Tous » and the rest. */
const row = (name: string, label: string, list: { v: string; tab: string; k?: string }[], on: string) =>
  `<div class="tabs aqtabs r-${name}" role="radiogroup" aria-label="${esc(label.replace(/ :$/, ""))}"><span class="tl" aria-hidden="true">${esc(label)}</span>` +
  list.map((x) => `<input type="radio" name="${name}" id="${name}-${x.v || "tous"}" value="${x.v}"${x.k ? ` data-k="${x.k}"` : ""}${x.v === on ? " checked" : ""}><label for="${name}-${x.v || "tous"}">${esc(x.tab)}</label>`).join("") + `</div>`;

const swatch = (k: string, label: string) => `<span class="sw sw-${k}"><i style="--c:${COULEURS[k]}"></i>${esc(label)}</span>`;

function map(): string {
  const codes = antennes.SUPPORTS.map(code);
  const parsed = codes.map(parse);
  const filtres = `<div class="antf" hidden>` +
    row("ao", MOTS.operateur, [{ v: "", tab: MOTS.tous }, ...OPS.map((x) => ({ v: x.id, tab: x.o, k: x.k }))], "") +
    row("at", MOTS.type, [{ v: "", tab: MOTS.tous }, ...GENS.map((g) => ({ v: `${g}g`, tab: `${g}G` })), ...RADIOS.map((r) => ({ v: r.id, tab: r.tab }))], "") +
    row("ac", MOTS.couleur, [{ v: "o", tab: MOTS.parOperateur }, { v: "t", tab: MOTS.parType }], "o") + `</div>`;
  // Without the script: every mobile support, coloured by operator, as the filters' first choice.
  const supports = antennes.SUPPORTS.map((s, i) => {
    const [x, y] = project(s.lon, s.lat), l = look(parsed[i], "", "", "o")!;
    return `<circle class="s k${l[1]}${l[0] ? " r" : ""}" cx="${x}" cy="${y}" r="6" data-g="${codes[i]}"/>`;
  }).join("");
  const emetteurs = antennes.EMETTEURS.map((e) => {
    const [x, y] = project(e.lon, e.lat);
    return `<circle class="e h" cx="${x}" cy="${y}" r="9" data-k="${RADIOS.filter((r) => e[r.id]).map((r) => r.id).join(" ")}"/>`;
  }).join("");
  const formes = `<span class="formes"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="5" class="in"/></svg><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4" class="ring"/></svg>${esc(MOTS.formes)}</span>`;
  const legende = `<span class="lgc lgc-o">${OPS.map((x) => swatch(x.k, x.o)).join("")}${swatch("m", MOTS.plusieurs)}</span>` +
    `<span class="lgc lgc-t" hidden>${["5", "4", "2", "r"].map((k) => swatch(k, MOTS.types[k])).join("")}<span class="tn">${esc(MOTS.typeNote)}</span></span>`;
  const phrases = counts(parsed).map(([k, t]) => `<span class="lg" data-k="${k}"${k === "tous" ? "" : " hidden"}>${esc(t)}.</span>`).join("");
  return `<figure class="card mapcard antmap">${filtres}` +
    islandMap({ overlay: `<g class="ants">${supports}${emetteurs}</g>`, peaks: true, label: "Carte de La Réunion (974) : les supports d'antennes déclarés à l'ANFR, filtrés par opérateur et par type" }) +
    `<figcaption class="note">${legende}${formes}${phrases}</figcaption></figure><script>${FILTRES_SCRIPT}</script>`;
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
  const carte = `<section aria-labelledby="h-carte"><h2 id="h-carte">Sur la carte</h2>${map()}</section>`;
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
