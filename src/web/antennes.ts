/**
 * /antennes: the island's antenna supports on a map, from the bundled files of the ANFR (vie/antennes.ts), with no
 * request. Two rows of filters that combine, an operator and a type (a generation, or the FM, TNT or DAB+ supports), set
 * by the page's address too (« #orange-5g »), and the dots coloured by operator or by generation; without the script,
 * every mobile support coloured by operator. A dot per support, filled when an antenna is active (en service, or
 * techniquement opérationnel for the 5G), a ring when only planned. The map zooms as the hikes' does, with the IGN's
 * backgrounds, closer with one of them (a town's streets). Then the communes' counts. Never coverage nor exposure.
 */
import type { Cached } from "../cache.js";
import { INSEE } from "../places/insee.js";
import * as sitesHs from "../providers/sites-hs.js";
import { nombre } from "../tools/format.js";
import * as antennes from "../vie/antennes.js";
import { dateLongue } from "../vie/internet.js";
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { MAX_ZOOM } from "./carte-zoom.js";
import { esc, FOND_ZOOM, islandMap, project, zoomIsland } from "./map.js";
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
 * How a support shows for the operators chosen (`o`, their letters, none for all) and the generations chosen (`g`,
 * none for all), its colour by operator (`m` "o") or by generation ("t"): hidden (null), else whether it is a ring
 * (only planned) and its colour's key. Shown when one of the operators chosen has one of the generations chosen,
 * active or planned. By operator, the operators that have one of those generations: one, its colour; several,
 * « plusieurs », even when one operator is chosen. By generation, the most recent active, else the most recent
 * planned, of the operators chosen or of all. The page's script runs the same, from LOOK: the test runs both on every
 * support.
 */
export function look(d: Code, o: string[], g: string[], m: string): [boolean, string] | null {
  const has = (x: string) => (g.length ? g.some((y) => x.includes(y)) : x.length > 0);
  const r = d.filter(([x]) => !o.length || o.includes(x));
  const on = r.some(([, a]) => has(a));
  if (!on && !r.some(([, a, p]) => has(a + p))) return null;
  if (m === "o") {
    const w = d.filter(([, a, p]) => has(a + p));
    return [!on, w.length > 1 ? "m" : w[0][0]];
  }
  const a = r.map((x) => x[1]).join(""), x = Math.max(...[...(a || r.map((y) => y[2]).join(""))].map(Number));
  return [!on, x === 5 ? "5" : x === 4 ? "4" : "2"];
}

/** look(), for the page's script. */
export const LOOK = `const look=(d,o,g,m)=>{const has=(x)=>g.length?g.some((y)=>x.includes(y)):x.length>0;const r=d.filter(([x])=>!o.length||o.includes(x));const on=r.some(([,a])=>has(a));
if(!on&&!r.some(([,a,p])=>has(a+p)))return null;if(m==="o"){const w=d.filter(([,a,p])=>has(a+p));return[!on,w.length>1?"m":w[0][0]]}
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

/** « 4G ou 5G »: the generations chosen, in the count's words. */
const ou = (g: string[]) => g.map((x) => `${x}G`).join(", ").replace(/, ([^,]+)$/, " ou $1");

/**
 * The count under the map, for what it shows: `on` mobile supports with one of the generations chosen active (in
 * service, or technically operational for the 5G, as the legend says; the 5G alone, « techniquement opérationnelle »,
 * the ANFR's word), `off` only planned, `e` supports of the radio and TV chosen (`r`), named after them (marketing).
 * The page's script runs the same, from PHRASE: the test runs both.
 */
export function phrase(on: number, off: number, e: number, g: string[], r: string[] = []): string {
  const n = on + off;
  const tv = r.includes("tnt"), radio = r.some((x) => x !== "tnt");
  const parts = [
    n ? `${nombre(n)} ${n > 1 ? "supports" : "support"} d'antennes mobiles ${n > 1 ? "affichés" : "affiché"}, dont ${nombre(on)} avec au moins une antenne${g.length ? ` ${ou(g)}` : ""} ${g.join("") === "5" ? "techniquement opérationnelle" : "active"}` +
      (off ? ` et ${nombre(off)} en projet seulement` : "") : "",
    e ? `${nombre(e)} ${e > 1 ? "supports" : "support"} d'émetteurs de ${radio && tv ? "radio et de télévision" : tv ? "télévision" : "radio"} ${e > 1 ? "affichés" : "affiché"}` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join("\u00a0; ")}.` : "Aucun support pour ce choix.";
}

/** phrase(), for the page's script; nombre() as the server writes it (a narrow space between thousands). */
export const PHRASE = `const nombre=(n)=>String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g,"\\u202f"),ou=(g)=>g.map((x)=>x+"G").join(", ").replace(/, ([^,]+)$/," ou $1");
const phrase=(on,off,e,g,r=[])=>{const n=on+off,tv=r.includes("tnt"),radio=r.some((x)=>x!=="tnt");const parts=[n?nombre(n)+" "+(n>1?"supports":"support")+" d'antennes mobiles "+(n>1?"affichés":"affiché")+", dont "+nombre(on)+" avec au moins une antenne"+(g.length?" "+ou(g):"")+" "+(g.join("")==="5"?"techniquement opérationnelle":"active")+
(off?" et "+nombre(off)+" en projet seulement":""):"",e?nombre(e)+" "+(e>1?"supports":"support")+" d'émetteurs de "+(radio&&tv?"radio et de télévision":tv?"télévision":"radio")+" "+(e>1?"affichés":"affiché"):""].filter(Boolean);return parts.length?parts.join("\\u00a0; ")+".":"Aucun support pour ce choix."};`;

/**
 * The filters' script: the choices from the boxes or the address (« #orange+free-4g+5g », and « #orange-5g » as
 * before), each support's look, the legends and the count. Several operators and several types at once; « Tous » is
 * checked when nothing else is, and unchecks the rest. The radio and the TV have no operator here: chosen alone, the
 * row of the operators is off; with a generation, the operators filter the mobile supports only. With them, the
 * colours are by type, the radio's own then never one of an operator's.
 */
const FILTRES_SCRIPT = `(()=>{const f=document.querySelector(".antf");if(!f)return;const fig=f.closest("figure"),S=[...fig.querySelectorAll("circle.s")],E=[...fig.querySelectorAll("circle.e")];
${LOOK}
${PHRASE}
const D=S.map((s)=>[...s.dataset.g.matchAll(/([a-z])(\\d*)(?:\\+(\\d+))?/g)].map((m)=>[m[1],m[2],m[3]||""]));
const ins=(n)=>[...f.querySelectorAll("[name="+n+"]")],vals=(n)=>ins(n).filter((i)=>i.checked&&i.value),set=(n,v)=>ins(n).forEach((i)=>{i.checked=i.value?v.includes(i.value):!v.length}),
one=(n)=>(ins(n).find((i)=>i.checked)||{}).value||"",pick=(n,v)=>ins(n).forEach((i)=>{i.checked=i.value===v});
let mode=one("ac");const RADIOS=${JSON.stringify(RADIOS.map((r) => r.id))};
const draw=(keep)=>{const T=vals("at").map((i)=>i.value),R=T.filter((t)=>RADIOS.includes(t)),G=T.filter((t)=>!RADIOS.includes(t)).map((t)=>t.slice(0,1)),radio=R.length>0,mobile=!radio||G.length>0;
if(!mobile)set("ao",[]);pick("ac",radio?"t":mode);ins("ao").forEach((i)=>{i.disabled=!mobile});ins("ac").forEach((i)=>{i.disabled=radio});
f.querySelector(".r-ao").classList.toggle("dis",!mobile);f.querySelector(".r-ac").classList.toggle("dis",radio);
const O=vals("ao").map((i)=>i.dataset.k),m=radio?"t":mode;let on=0,off=0,e=0;
S.forEach((s,i)=>{const l=mobile?look(D[i],O,G,m):null;if(l){if(l[0])off++;else on++}s.setAttribute("class",l?"s k"+l[1]+(l[0]?" r":""):"s h")});
E.forEach((x)=>{const k=x.dataset.k.split(" ").some((t)=>R.includes(t));if(k)e++;x.setAttribute("class",k?"e kr":"e h")});
fig.querySelector(".lg").textContent=phrase(on,off,e,G,R);
fig.querySelector(".lgc-o").hidden=m!=="o";const lt=fig.querySelector(".lgc-t");lt.hidden=m!=="t";lt.classList.toggle("radio",!mobile);fig.querySelector(".formes").hidden=!mobile;
const key=[vals("ao").map((i)=>i.value).join("+"),T.join("+")].filter(Boolean).join("-");if(!keep)history.replaceState(null,"",key?"#"+key:location.pathname+location.search)};
const read=()=>{const h=decodeURIComponent(location.hash.slice(1));if(!h)return false;const V=[...ins("ao"),...ins("at")].filter((i)=>i.value).sort((a,b)=>b.value.length-a.value.length),got=[];
for(let p=0;p<h.length;){const i=V.find((x)=>h.startsWith(x.value,p)&&(p+x.value.length===h.length||"+-".includes(h[p+x.value.length])));if(!i)return false;got.push(i);p+=i.value.length+1}
["ao","at"].forEach((n)=>set(n,got.filter((i)=>i.name===n).map((i)=>i.value)));return true};
f.addEventListener("change",(ev)=>{const i=ev.target;if(i.name==="ac")mode=i.value;else{const l=ins(i.name),all=l.find((x)=>!x.value);if(i===all)set(i.name,[]);else all.checked=!l.some((x)=>x.value&&x.checked)}draw()});
addEventListener("hashchange",()=>{if(read())draw(true)});f.hidden=false;read();draw(true)})();`;

/**
 * The dots keep about their size on screen as the map zooms (carte-zoom.ts moves its viewBox): a little bigger, up to
 * half again, so that a close look tells them apart, never the size of a block. Their white ring follows (`--az`, CSS).
 */
const TAILLE_SCRIPT = `(()=>{const svg=document.getElementById("amap");if(!svg)return;const C=[...svg.querySelectorAll(".ants circle")],R=C.map((c)=>+c.getAttribute("r")),
vw=()=>+svg.getAttribute("viewBox").split(" ")[2],w0=vw();let f=1,q=0;
const fit=()=>{q=0;const k=w0/vw(),n=Math.min(1.5,k**.15)/k;if(Math.abs(n-f)<1e-4)return;f=n;svg.style.setProperty("--az",f);C.forEach((c,i)=>c.setAttribute("r",Math.round(R[i]*f*100)/100))};
new MutationObserver(()=>{if(!q)q=requestAnimationFrame(fit)}).observe(svg,{attributes:true,attributeFilter:["viewBox"]})})();`;

/** A row of buttons: its name, then « Tous » and the rest; several at once (boxes) or one (`one`). */
const row = (name: string, label: string, list: { v: string; tab: string; k?: string }[], on: string, one = false) =>
  `<div class="tabs aqtabs r-${name}" role="${one ? "radiogroup" : "group"}" aria-label="${esc(label.replace(/ :$/, ""))}"><span class="tl" aria-hidden="true">${esc(label)}</span>` +
  list.map((x) => `<input type="${one ? "radio" : "checkbox"}" name="${name}" id="${name}-${x.v || "tous"}" value="${x.v}"${x.k ? ` data-k="${x.k}"` : ""}${x.v === on ? " checked" : ""}><label for="${name}-${x.v || "tous"}">${esc(x.tab)}</label>`).join("") + `</div>`;

const swatch = (k: string, label: string) => `<span class="sw sw-${k}"><i style="--c:${COULEURS[k]}"></i>${esc(label)}</span>`;

function map(): string {
  const codes = antennes.SUPPORTS.map(code);
  const parsed = codes.map(parse);
  const filtres = `<div class="antf" hidden>` +
    row("ao", MOTS.operateur, [{ v: "", tab: MOTS.tous }, ...OPS.map((x) => ({ v: x.id, tab: x.o, k: x.k }))], "") +
    row("at", MOTS.type, [{ v: "", tab: MOTS.tous }, ...GENS.map((g) => ({ v: `${g}g`, tab: `${g}G` })), ...RADIOS.map((r) => ({ v: r.id, tab: r.tab }))], "") +
    row("ac", MOTS.couleur, [{ v: "o", tab: MOTS.parOperateur }, { v: "t", tab: MOTS.parType }], "o", true) + `</div>`;
  // Without the script: every mobile support, coloured by operator, as the filters' first choice.
  const supports = antennes.SUPPORTS.map((s, i) => {
    const [x, y] = project(s.lon, s.lat), l = look(parsed[i], [], [], "o")!;
    return `<circle class="s k${l[1]}${l[0] ? " r" : ""}" cx="${x}" cy="${y}" r="6" data-g="${codes[i]}"/>`;
  }).join("");
  const emetteurs = antennes.EMETTEURS.map((e) => {
    const [x, y] = project(e.lon, e.lat);
    return `<circle class="e h" cx="${x}" cy="${y}" r="9" data-k="${RADIOS.filter((r) => e[r.id]).map((r) => r.id).join(" ")}"/>`;
  }).join("");
  const formes = `<span class="formes"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="5" class="in"/></svg><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4" class="ring"/></svg>${esc(MOTS.formes)}</span>`;
  const legende = `<span class="lgc lgc-o">${OPS.map((x) => swatch(x.k, x.o)).join("")}${swatch("m", MOTS.plusieurs)}</span>` +
    `<span class="lgc lgc-t" hidden>${["5", "4", "2", "r"].map((k) => swatch(k, MOTS.types[k])).join("")}<span class="tn">${esc(MOTS.typeNote)}</span></span>`;
  // Without the script, every mobile support: the script counts again what each choice shows.
  const all = parsed.map((d) => look(d, [], [], "o")!);
  const compte = `<span class="lg">${esc(phrase(all.filter((l) => !l[0]).length, all.filter((l) => l[0]).length, 0, []))}</span>`;
  return `<figure class="card mapcard antmap">${filtres}` +
    zoomIsland(islandMap({ overlay: `<g class="ants">${supports}${emetteurs}</g>`, peaks: true, fond: "a", label: "Carte de La Réunion (974) : les supports d'antennes déclarés à l'ANFR, filtrés par opérateur et par type" }), "a", { id: "amap", mostFd: MAX_ZOOM * FOND_ZOOM / 2 }) +
    `<script>${TAILLE_SCRIPT}</script><figcaption class="note">${legende}${formes}${compte}</figcaption></figure><script>${FILTRES_SCRIPT}</script>`;
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
