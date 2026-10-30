/**
 * Where to go with children (/enfants): the agenda's activities for them, this weekend first, then the places of the
 * 24 communes by kind (vie/enfants.ts), each with its ages: the source's as a fact, else an indication by kind, marked.
 * Filtered by age band and kind in the page. The words are marketing's (marketing/enfants-textes.md).
 */
import type { Cached } from "../cache.js";
import { mentionOf } from "../mentions.js";
import { ACCUEILS } from "../providers/agenda.js";
import * as enfants from "../vie/enfants.js";
import { porte, type Porte } from "./aller.js";
import { DOUBLE_SCRIPT, WHEEL_SCRIPT } from "./carte-zoom.js";
import { PAGES, type PlacePage } from "./places.js";
import { aCommune, deCommune } from "./aujourdhui.js";
import type { Alerte, EnfantsAnswer } from "./data.js";
import { agendaHours, connectorCta, crumbBar, crumbs, eventGo, loading, webPage } from "./domains.js";
import { communeMap, esc, islandMap, type Spot } from "./map.js";
import { COUNT_COLOR, legende } from "./carte-legende.js";
import { anchorId, ask, dayMonth, FOLD_ROWS, folded, icon, layout, type Live } from "./pages.js";

type Row = EnfantsAnswer["evenements"][number];
const { typo } = enfants;

export const TITLE = "Avec les enfants à La Réunion : lieux et activités · 974";
export const H1 = "Avec les enfants à La Réunion";
export const LEAD = typo("Aires de jeux, parcs, piscines, médiathèques, zoos, skateparks : les lieux où aller avec les enfants, commune par commune, et les activités pour eux ce week-end et dans les deux semaines qui viennent. De 0 à 17 ans, avec l'âge quand l'organisateur ou la carte le donne.");
export const DESCRIPTION = "Où emmener les enfants à La Réunion : aires de jeux, parcs, piscines, médiathèques, zoos, skateparks, commune par commune, et les activités du week-end.";
const MISSING = typo("<b>Ce que vous ne trouverez pas ici.</b> Les accueils de loisirs (centres aérés), les crèches et les relais petite enfance sont publiés par la CAF sur monenfant.fr, dont nous ne pouvons pas reprendre les données. Pour trouver un mode de garde ou un accueil de loisirs : <a href=\"https://monenfant.fr\" rel=\"noopener\">monenfant.fr</a>. Les activités privées qui ne figurent sur aucune carte ouverte manquent aussi. Un lieu oublié ? <a href=\"#avis\">Dites-le-nous</a>, ou ajoutez-le sur <a href=\"https://www.openstreetmap.org/\" rel=\"noopener\">OpenStreetMap</a> : il apparaîtra ici.");
const CREDITS = typo("Lieux : © les contributeurs d'OpenStreetMap (ODbL) ; recensement des équipements sportifs (Data ES, ministère des Sports) et Basilic (ministère de la Culture), sous Licence Ouverte. Activités : les agendas des communes et des salles, chacun cité sur sa ligne.");
export const ASK_KREOL = typo("Kosa néna pou fé ek marmay sé wikenn la ? Gèt si https://rundata.re/enfants é di amwin.");
export const ASK_FRANCAIS = typo("Où aller avec les enfants ce week-end à La Réunion ? Lis https://rundata.re/enfants et propose-moi des lieux et des activités pour leur âge, près de chez moi.");
// The link is to the events page: the site has no /sorties.
const EMPTY = typo("Les agendas que nous lisons n'annoncent pas d'activité pour les enfants dans les deux semaines qui viennent. Ils ne disent pas tout : voyez aussi les <a href=\"/evenements\">sorties</a>.");
/** The agenda's kind, first in the filter and on the page. */
const ACTIVITIES = "Activités et spectacles";

/** The badge of an age: bold when the source gives it, « · indicatif » when it is rundata.re's (its note on hover, set by the script). */
const badge = (a: enfants.Age) => `<span class="age${a.fait ? "" : a.texte === enfants.NO_AGE ? " i" : " i n"}">${esc(a.texte)}</span>`;

/**
 * The tile of a list of places (the island's on the home page, a commune's on its page): how many, then three kinds,
 * the number first: « 4 aires de jeux · 2 parcs et jardins · 1 piscine · … ». Those it has most of, or the kinds of
 * `order` in that order (the island's, so that its skateparks do not come first); a kind it has none of is left out.
 */
export function enfantsLive(list = enfants.LIEUX, order?: enfants.Kind[]): Live {
  const all = enfants.TYPES.map((t) => [t.type, list.filter((l) => l.type === t.type).length] as const).filter(([, n]) => n);
  const kinds = order ? order.map((k) => all.find(([t]) => t === k)).filter((x) => x !== undefined) : all.sort((a, b) => b[1] - a[1]);
  return { valeur: `${list.length} lieu${list.length > 1 ? "x" : ""}`, detail: kinds.slice(0, 3).map(([k, n]) => enfants.counted(k, n)).join(" · ") + (all.length > 3 ? " · …" : "") };
}

function eventLi(r: Row, g: Porte): string {
  const a = enfants.eventAge(r.age);
  const hours = agendaHours(r.quand);
  const small = [r.quand.replace(/ (de|à) \d\d:\d\d.*$/, "") + (hours ? ` · ${hours}` : ""), r.commune, r.lieu && r.lieu.length < 80 ? r.lieu : undefined, r.source ? `Source\u00a0: ${r.source}` : r.publie_par]
    .filter(Boolean).map((x) => esc(x!)).join(" · ");
  const status = r.statut && r.statut !== "complet" ? `<span class="badge">${esc(r.statut)}</span> ` : "";
  return `<li data-b="${a.bands.join(" ")}" data-t="agenda"><span>${status}${r.lien ? `<a href="${esc(r.lien)}" rel="noopener"${ACCUEILS.has(r.lien) ? ' target="_blank"' : ""}>${esc(r.titre)}</a>` : esc(r.titre)}<small>${small}</small>${eventGo(r, g)}</span>${badge(a)}</li>`;
}

/**
 * A place's second line: its address, its age and today's hours on the left, « Y aller » on the right, so that the name
 * has the width of the first line (data-run, 29/10: under the name alone, the button nearly doubled the list's height).
 */
const second = (l: enfants.Lieu, nom: string, a: enfants.Age, today: string | undefined, g: Porte) =>
  `<span class="l2"><span>${l.adresse ? `<small class="adr">${esc(l.adresse)}</small> ` : ""}${badge(a)}${today ? ` <small>${esc(`aujourd'hui ${today}`)}</small>` : ""}</span>` +
  `${g.aller({ nom, lat: l.lat, lon: l.lon, adresse: l.adresse })}</span>`;

function placeLi(l: enfants.Lieu, now: Date, g: Porte): string {
  const a = enfants.ageOf(l);
  const today = enfants.hoursToday(l, now);
  const link = l.site ?? l.lien;
  // A site that asks for its name with each link (mentions.ts): right after the address.
  const small = [l.detail, mentionOf(link)].filter(Boolean).map((x) => esc(x!)).join(" · ");
  const name = esc(enfants.nameOf(l));
  return `<li data-b="${a.bands.join(" ")}" data-t="${l.type}"><span>${link ? `<a href="${esc(link)}" rel="noopener">${name}</a>` : name}${small ? `<small>${small}</small>` : ""}</span>` +
    `${second(l, enfants.nameOf(l), a, today, g)}</li>`;
}

// The note of an indicated age on hover: once in the page (#enf's data-note), not on each of its hundreds of rows. The
// commune a link or the map points to is opened; a filter opens the communes that have what it keeps.
const FILTER_SCRIPT = `(()=>{const note=document.getElementById("enf").dataset.note;document.querySelectorAll("#enf .age.n").forEach((e)=>{e.title=note});
const open=()=>{const c=location.hash&&document.getElementById(location.hash.slice(1));const d=c&&c.querySelector("details");if(d)d.open=true};
open();addEventListener("hashchange",open);
const f=document.getElementById("kf");if(!f)return;f.hidden=false;
const run=()=>{const b=f.b.value,t=f.t.value;let n=0;document.querySelectorAll("#enf li[data-b]").forEach((li)=>{const ok=(!b||li.dataset.b.split(" ").includes(b))&&(!t||li.dataset.t===t);li.hidden=!ok;if(ok)n++});
document.querySelectorAll("#enf [data-k]").forEach((g)=>{g.hidden=!g.querySelector("li[data-b]:not([hidden])")});
document.querySelectorAll("#enf details").forEach((d)=>{d.open=!!(b||t)});
document.querySelectorAll("#enf .note[data-n]").forEach((e)=>{const all=+e.dataset.n,k=e.closest("[data-k]").querySelectorAll("li[data-b]:not([hidden])").length,w=(x)=>x+" "+(x>1?e.dataset.p:e.dataset.s);e.textContent=b||t?w(k)+" sur "+all:w(all)});
document.getElementById("kf-n").textContent=b||t?n+" résultat"+(n>1?"s":""):"";};
f.addEventListener("input",run);f.addEventListener("submit",(e)=>e.preventDefault());})();`;

export function enfantsPage(origin: string, data: Cached<EnfantsAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const g = porte(alerte);
  const d = data?.value;
  const path = "/enfants";
  const communes = [...new Set(enfants.LIEUX.map((l) => l.commune))].sort((x, y) => x.localeCompare(y, "fr"));
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
  // The count of a card, which a filter turns into « 1 lieu sur 15 ».
  const note = (n: number, one: string, many: string) => `<span class="note" data-n="${n}" data-s="${one}" data-p="${many}">${count(n, one, many)}</span>`;

  const markers = communes.map((c) => {
    const list = enfants.inCommune(c);
    return { lon: list.reduce((n, l) => n + l.lon, 0) / list.length, lat: list.reduce((n, l) => n + l.lat, 0) / list.length, label: String(list.length), name: `${c} : ${count(list.length, "lieu", "lieux")}`,
      round: true, color: COUNT_COLOR, quiet: true, place: c, say: count(list.length, "lieu", "lieux"), href: pathOf(c) ?? `#${anchorId("c", c)}` };
  });

  const weekend = new Set((d?.ce_week_end ?? []).map((r) => `${r.titre}|${r.date}`));
  const later = (d?.evenements ?? []).filter((r) => !weekend.has(`${r.titre}|${r.date}`));
  const card = (title: string, rows: Row[]) =>
    rows.length ? `<li class="card" data-k><h3>${esc(title)} ${note(rows.length, "activité", "activités")}</h3><ul class="rows eau">${rows.map((r) => eventLi(r, g)).join("")}</ul></li>` : "";
  const activities = !d
    ? loading("L'agenda des enfants")
    : d.ce_week_end.length || later.length
      ? `<ul class="zones top">${card("Ce week-end", d.ce_week_end)}${card("Dans les deux semaines qui viennent", later)}</ul>`
      : `<p class="card">${EMPTY}</p>`;

  const places = `<ul class="zones top">${communes.map((c) => {
    const list = enfants.inCommune(c);
    // Folded: 24 communes, hundreds of places. The map, a link to the commune or a filter opens it.
    return `<li class="card tgt" id="${anchorId("c", c)}" data-k><details><summary><h3>${esc(c)} ${note(list.length, "lieu", "lieux")}</h3></summary><div class="kinds">` +
      (pathOf(c) ? `<p><a href="${pathOf(c)}">${esc(MOTS.versPage(c))} →</a></p>` : "") +
      enfants.TYPES.map((t) => {
        const of = list.filter((l) => l.type === t.type);
        return of.length ? `<div class="kind" data-k><h4>${esc(t.nom)}</h4><ul class="rows eau">${of.map((l) => placeLi(l, now, g)).join("")}</ul></div>` : "";
      }).join("") + `</div></details></li>`;
  }).join("")}</ul>`;

  const filter = `<form id="kf" class="card filter" hidden role="search" aria-label="Filtrer par âge et par type">` +
    `<label>Âge <select name="b"><option value="">Tous</option>${enfants.BANDS.map((b) => `<option value="${b.key}">${esc(b.nom)}</option>`).join("")}</select></label>` +
    `<label>Type <select name="t"><option value="">Tous</option><option value="agenda">${ACTIVITIES}</option>${enfants.TYPES.map((t) => `<option value="${t.type}">${esc(t.nom)}</option>`).join("")}</select></label>` +
    `<p class="note">${esc(enfants.AGES_NOTE)}</p><p class="note" id="kf-n" aria-live="polite"></p></form>`;

  const band = `${crumbBar("Enfants")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>De 0 à 17 ans</p>
    <h1>${esc(H1)} <span class="n974">974</span></h1>
    <p class="lead">${esc(LEAD)}</p>
    ${ask(ASK_KREOL, ASK_FRANCAIS)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : le nombre de lieux pour les enfants par commune" })}
  <figcaption class="note" style="color:var(--on-night-muted)">${legende([{ forme: "rond", couleur: COUNT_COLOR, texte: "12", dit: "lieux pour les enfants dans la commune" }], esc(`Donnée fixe : OpenStreetMap, Data ES et Basilic, lue le ${dayMonth(enfants.BUILT)}.`))}</figcaption></figure>
</div>`;

  const body = `<div id="enf" data-note="${esc(enfants.INDICATIF_NOTE)}">
${filter}
<section aria-labelledby="h-act" data-k>
  <div class="sec-h"><p class="eyebrow">Ce week-end d'abord</p><h2 id="h-act">${ACTIVITIES}</h2></div>
  ${activities}
</section>
<section aria-labelledby="h-lieux">
  <div class="sec-h"><p class="eyebrow">Commune par commune</p><h2 id="h-lieux">Où aller avec les enfants</h2></div>
  ${places}
  <div class="card"><p>${MISSING}</p></div>
  <p class="note">${esc(enfants.HOURS_NOTE)}</p>
  <p class="note">${esc(enfants.INDICATIF_NOTE)}</p>
  <p class="note">${esc(CREDITS)}</p>
</section>
</div><script>${FILTER_SCRIPT}</script>${g.feuille}
${connectorCta("annuaire_services_publics", "les lieux pour les enfants")}`;

  return layout(origin, { title: TITLE, description: DESCRIPTION, path, jsonld: [crumbs(origin, "Enfants", path), webPage(origin, path, TITLE, DESCRIPTION, data)], alerte }, band, g.ligne + body);
}

// ---------------------------------------------------------------- a commune's page: its places on a map

/** The page of a commune's places. */
export const communePath = (p: PlacePage) => `/enfants/${p.slug}`;
const pathOf = (commune: string) => {
  const p = PAGES.find((x) => x.commune && x.nom === commune);
  return p && communePath(p);
};

/**
 * The words of a commune's page, marketing's. A commune takes its own « à » and « de » (« au Port », « des Avirons »),
 * and a commune with a single place is said in the singular.
 */
const MOTS = {
  title: (c: string) => typo(`Avec les enfants ${aCommune(c)} : aires de jeux, parcs, piscines · 974`),
  description: (c: string, n: number) =>
    typo(`Aires de jeux, parcs, piscines, médiathèques : ${n === 1 ? "le lieu" : `les ${n} lieux`} où aller avec les enfants ${aCommune(c)}, sur une carte, et les activités du week-end.`),
  h1: (c: string) => `Avec les enfants ${aCommune(c)}`,
  lead: (c: string, n: number) =>
    typo(n === 1
      ? `Le lieu pour les enfants ${deCommune(c)}, sur la carte : choisissez son point pour voir sa fiche.`
      : `Les ${n} lieux pour les enfants ${deCommune(c)}, sur la carte : choisissez un type, ou un point pour voir sa fiche.`),
  carte: (c: string) => `Carte des lieux pour les enfants ${aCommune(c)}, La Réunion`,
  tous: "Tous",
  filtre: "Choisir un type de lieu",
  zoomIn: "Rapprocher",
  zoomOut: "Éloigner",
  recadrer: "Recentrer",
  recadrerAria: "Recentrer sur toute la commune",
  surCarte: (nom: string) => typo(`Voir sur la carte : ${nom}`),
  dansListe: "Voir dans la liste",
  fermer: "Fermer la fiche",
  activites: (c: string) => `Activités et spectacles ${aCommune(c)}`,
  aucune: (c: string) => typo(`Les agendas que nous lisons n'annoncent pas d'activité pour les enfants ${esc(aCommune(c))} dans les deux semaines qui viennent. Ils ne disent pas tout : voyez aussi <a href="/enfants">les activités dans toute l'île</a>.`),
  lieux: "Les lieux, type par type",
  ile: "Les 24 communes",
  versPage: (c: string) => `La carte des lieux ${deCommune(c)}`,
};

/** A filter's words, a kind's plural: marketing's. */
const FILTRES: Record<enfants.Kind, string> = {
  aire_de_jeux: "Aires de jeux",
  parc: "Parcs et jardins",
  piscine: "Piscines",
  mediatheque: "Médiathèques",
  musee: "Musées",
  animaux: "Zoos et aquariums",
  loisirs: "Parcs de loisirs",
  salle_jeux: "Salles de jeux",
  ludotheque: "Ludothèques",
  sport: "Skateparks et city-stades",
  escalade: "Escalade",
};

/**
 * The families of kinds, a colour each on the map: what the eye sorts first. A colour has no name of its own: the legend
 * names it with the filters of the kinds it has in the commune (`couleur`), so that a point is never read under two names.
 */
const FAMILLES: { f: string; types: enfants.Kind[] }[] = [
  { f: "jeux", types: ["aire_de_jeux", "salle_jeux", "ludotheque", "loisirs"] },
  { f: "nature", types: ["parc", "animaux"] },
  { f: "eau", types: ["piscine"] },
  { f: "culture", types: ["mediatheque", "musee"] },
  { f: "sport", types: ["sport", "escalade"] },
];
/**
 * A colour's name in the legend (marketing, 29/10): the filter of its one kind in the list, word for word; else its
 * kinds' filters in the buttons' order, the next ones in lower case, « et » before the last, or commas alone when a
 * filter has its own « et » (« Parcs et jardins, zoos et aquariums »).
 */
export function couleur(types: enfants.Kind[], list: enfants.Lieu[]): string {
  const noms = enfants.TYPES.map((t) => t.type).filter((k) => types.includes(k) && list.some((l) => l.type === k))
    .map((k, i) => (i ? FILTRES[k].charAt(0).toLowerCase() + FILTRES[k].slice(1) : FILTRES[k]));
  if (noms.length < 2 || noms.some((n) => n.includes(" et "))) return noms.join(", ");
  return `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}`;
}
const familleOf = (k: enfants.Kind) => FAMILLES.find((x) => x.types.includes(k))!;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The map and the list, kept together: a chip hides the kinds it leaves out on both; a dot opens its sheet under the
// map and marks its row; a row's button marks its dot, brought into the frame. Pinch, drag, the wheel, a double click (web/carte-zoom.ts) and the buttons move the
// map's viewBox, within the commune's frame, and so does a tap on too many dots at once (`pzoom`, carte-points.ts).
// Without the script, each dot is a link to its row.
const MAP_SCRIPT = `(()=>{const svg=document.getElementById("ecm"),f=document.getElementById("ecf"),sheet=document.getElementById("ecs");if(!svg||!f)return;
f.hidden=false;document.querySelectorAll("#ecl .tomap,#ecz").forEach((e)=>{e.hidden=false});
const B=svg.dataset.box.split(" ").map(Number);let v=B.slice();const put=()=>{svg.setAttribute("viewBox",v.map((x)=>Math.round(x*100)/100).join(" "));svg.classList.toggle("zoomed",v[2]<B[2]-.01)};
const clamp=()=>{v[2]=Math.min(B[2],Math.max(B[2]/12,v[2]));v[3]=v[2]*B[3]/B[2];v[0]=Math.min(B[0]+B[2]-v[2],Math.max(B[0],v[0]));v[1]=Math.min(B[1]+B[3]-v[3],Math.max(B[1],v[1]));put()};
const zoom=(k,cx,cy)=>{if(cx===undefined){cx=v[0]+v[2]/2;cy=v[1]+v[3]/2}const w=v[2]/k;v=[cx-(cx-v[0])/k,cy-(cy-v[1])/k,w,w*B[3]/B[2]];clamp()};
const pt=(x,y)=>{const m=svg.getScreenCTM().inverse(),p=new DOMPoint(x,y).matrixTransform(m);return[p.x,p.y]};
svg.addEventListener("pzoom",(e)=>{const w=v[2],c=pt(e.detail.x,e.detail.y);zoom(2.5,c[0],c[1]);if(v[2]<w)e.preventDefault()});
const ps=new Map();let moved=0,last=null;
svg.addEventListener("pointerdown",(e)=>{ps.set(e.pointerId,[e.clientX,e.clientY]);moved=0;last=null});
svg.addEventListener("pointermove",(e)=>{if(!ps.has(e.pointerId))return;const o=ps.get(e.pointerId);ps.set(e.pointerId,[e.clientX,e.clientY]);
if(ps.size===2){const[a,b]=[...ps.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]),c=pt((a[0]+b[0])/2,(a[1]+b[1])/2);if(last)zoom(d/last,c[0],c[1]);last=d;moved=9;e.preventDefault();return}
if(!svg.classList.contains("zoomed"))return;const p0=pt(o[0],o[1]),p1=pt(e.clientX,e.clientY);moved+=Math.hypot(e.clientX-o[0],e.clientY-o[1]);v[0]-=p1[0]-p0[0];v[1]-=p1[1]-p0[1];clamp();e.preventDefault()});
const up=(e)=>{ps.delete(e.pointerId);if(ps.size<2)last=null};["pointerup","pointercancel","pointerleave"].forEach((t)=>svg.addEventListener(t,up));
${WHEEL_SCRIPT}${DOUBLE_SCRIPT}svg.addEventListener("click",held,true);
document.getElementById("ecz").addEventListener("click",(e)=>{const z=e.target.closest("button")?.dataset.z;if(z==="+")zoom(1.6);else if(z==="-")zoom(1/1.6);else if(z==="0"){v=B.slice();put()}});
const pick=(i,show)=>{svg.querySelectorAll(".sp.on").forEach((a)=>a.classList.remove("on"));document.querySelectorAll("#ecl li.on").forEach((l)=>l.classList.remove("on"));
const a=svg.querySelector('.sp[data-i="'+i+'"]'),li=document.getElementById("lieu-"+i);if(!a||!li)return;a.classList.add("on");a.parentNode.appendChild(a);li.classList.add("on");
sheet.querySelector(".nm").innerHTML=li.querySelector(".nm").innerHTML;const tp=sheet.querySelector(".tp"),ad=li.querySelector(".adr"),k=[li.dataset.n,li.dataset.q,ad&&ad.textContent].filter(Boolean).join(" · ");tp.textContent=k;tp.hidden=!k;sheet.querySelector(".go").href="#lieu-"+i;const ya=li.querySelector(".aller");sheet.querySelector(".ya").replaceChildren(...(ya?[ya.cloneNode(true)]:[]));sheet.hidden=false;
if(show){const c=a.querySelector(".hit"),x=+c.getAttribute("cx"),y=+c.getAttribute("cy");if(x<v[0]||x>v[0]+v[2]||y<v[1]||y>v[1]+v[3]){v[0]=x-v[2]/2;v[1]=y-v[3]/2;clamp()}svg.scrollIntoView({block:"center",behavior:"smooth"})}};
svg.addEventListener("click",(e)=>{const a=e.target.closest(".sp");if(!a)return;e.preventDefault();if(moved>8)return;pick(a.dataset.i,false)});
document.getElementById("ecl").addEventListener("click",(e)=>{const b=e.target.closest(".tomap");if(b)pick(b.closest("li").dataset.i,true)});
sheet.querySelector(".x").addEventListener("click",()=>{sheet.hidden=true;svg.querySelectorAll(".sp.on").forEach((a)=>a.classList.remove("on"));document.querySelectorAll("#ecl li.on").forEach((l)=>l.classList.remove("on"))});
const run=()=>{const t=f.t.value;svg.querySelectorAll(".sp").forEach((a)=>a.classList.toggle("off",!!t&&a.dataset.t!==t));document.querySelectorAll("#ecl li[data-i]").forEach((l)=>{l.hidden=!!t&&l.dataset.t!==t});
document.querySelectorAll("#ecl [data-k]").forEach((g)=>{g.hidden=!g.querySelector("li[data-i]:not([hidden])")});if(t)document.querySelectorAll("#ecl details").forEach((d)=>{d.open=!!d.querySelector("li[data-i]:not([hidden])")})};f.addEventListener("input",run);f.addEventListener("submit",(e)=>e.preventDefault())})();`;

/** A place's name on its commune's page: an unnamed one by its kind and its district, else its commune. */
const nomOf = (l: enfants.Lieu) => enfants.nameOf(l, l.quartier || l.commune);

function communeLi(l: enfants.Lieu, i: number, now: Date, g: Porte): string {
  const a = enfants.ageOf(l);
  const today = enfants.hoursToday(l, now);
  const link = l.site ?? l.lien;
  // An unnamed place has its kind and its district in its name already: its sheet says nothing more.
  const named = enfants.named(l);
  const small = [named ? l.quartier : undefined, l.detail, mentionOf(link)].filter(Boolean).map((x) => esc(x!)).join(" · ");
  const name = esc(nomOf(l));
  return `<li id="lieu-${i}" class="tgt" data-i="${i}" data-t="${l.type}"${named ? ` data-n="${esc(capital(enfants.typeOf(l.type).un))}"` : ""}${named && l.quartier ? ` data-q="${esc(l.quartier)}"` : ""}>` +
    `<span><span class="nm">${link ? `<a href="${esc(link)}" rel="noopener">${name}</a>` : name}</span>${small ? `<small>${small}</small>` : ""}</span>` +
    `<span class="end"><button type="button" class="tomap f-${familleOf(l.type).f}" hidden aria-label="${esc(MOTS.surCarte(nomOf(l)))}">${icon("pin")}</button></span>` +
    `${second(l, nomOf(l), a, today, g)}</li>`;
}

/** The children's places of a commune on its map, the list beside it, and the agenda's activities in the commune. */
export function enfantsCommunePage(origin: string, p: PlacePage, data: Cached<EnfantsAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const g = porte(alerte);
  const path = communePath(p);
  const c = p.nom;
  // In the order of the kinds, the order of the list: a place's number is its row's.
  const list = enfants.TYPES.flatMap((t) => enfants.inCommune(c).filter((l) => l.type === t.type));
  const title = MOTS.title(c);
  const description = MOTS.description(c, list.length);
  const spots: Spot[] = list.map((l, i) => ({
    lon: l.lon, lat: l.lat, i, t: l.type, f: familleOf(l.type).f, name: enfants.named(l) ? `${l.nom} (${enfants.typeOf(l.type).un})` : nomOf(l),
    // An unnamed place has its kind in its name already.
    tip: { name: nomOf(l), kind: enfants.named(l) ? capital(enfants.typeOf(l.type).un) : undefined, address: l.adresse },
  }));
  const kinds = enfants.TYPES.filter((t) => list.some((l) => l.type === t.type));
  const families = FAMILLES.filter((x) => list.some((l) => x.types.includes(l.type)));

  const chips = `<form id="ecf" class="kchips" hidden role="search" aria-label="${esc(MOTS.filtre)}">` +
    `<label class="chip"><input type="radio" name="t" value="" checked> ${esc(MOTS.tous)} <span class="n">${list.length}</span></label>` +
    kinds.map((t) => `<label class="chip"><input type="radio" name="t" value="${t.type}"> <i class="ksw f-${familleOf(t.type).f}"></i>${esc(FILTRES[t.type])} <span class="n">${list.filter((l) => l.type === t.type).length}</span></label>`).join("") +
    `</form>`;
  const zoom = `<div id="ecz" class="kzoom" hidden><button type="button" data-z="+" aria-label="${esc(MOTS.zoomIn)}">+</button><button type="button" data-z="-" aria-label="${esc(MOTS.zoomOut)}">−</button><button type="button" data-z="0" aria-label="${esc(MOTS.recadrerAria)}">${esc(MOTS.recadrer)}</button></div>`;
  const legend = `<p class="klegend note">${families.map((x) => `<span><i class="ksw f-${x.f}"></i>${esc(couleur(x.types, list))}</span>`).join("")}</p>`;
  const sheet = `<div id="ecs" class="card ksheet" hidden aria-live="polite"><button type="button" class="x" aria-label="${esc(MOTS.fermer)}">×</button><p class="nm"></p><p class="note tp"></p><p class="ya"></p><p><a class="go" href="#">${esc(MOTS.dansListe)}</a></p></div>`;

  // Each kind folded, its count in its line (marketing's words), but in a short list or a commune of one kind.
  const fold = list.length > FOLD_ROWS && kinds.length > 1;
  const places = `<div id="ecl">${kinds.map((t) => {
    const of = list.map((l, i) => [l, i] as const).filter(([l]) => l.type === t.type);
    // Its last word, the dot, the count and the arrow (the style sheet's) kept on one line.
    const head = `<h3>${esc(t.nom)}${fold ? "\u00a0" : " "}<span class="note">${fold ? "·\u00a0" : ""}${of.length}</span></h3>`;
    const rows = `<ul class="rows eau">${of.map(([l, i]) => communeLi(l, i, now, g)).join("")}</ul>`;
    return `<div class="card kind" data-k>${folded(fold, head, rows)}</div>`;
  }).join("")}</div>`;

  const d = data?.value;
  const here = (rows: Row[]) => rows.filter((r) => r.commune === c);
  const weekend = new Set((d?.ce_week_end ?? []).map((r) => `${r.titre}|${r.date}`));
  const soon = here(d?.ce_week_end ?? []);
  const later = here((d?.evenements ?? []).filter((r) => !weekend.has(`${r.titre}|${r.date}`)));
  const activities = !d
    ? loading("L'agenda des enfants")
    : soon.length || later.length
      ? `<ul class="rows eau card">${[...soon, ...later].map((r) => eventLi(r, g)).join("")}</ul>`
      : `<p class="card">${MOTS.aucune(c)}</p>`;

  const band = `${crumbBar(c, { name: "Enfants", path: "/enfants" })}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>De 0 à 17 ans</p>
    <h1>${esc(MOTS.h1(c))} <span class="n974">974</span></h1>
    <p class="lead">${esc(MOTS.lead(c, list.length))}</p>
  </div>
</div>`;

  const body = `<div id="enfc">
<section aria-label="${esc(MOTS.carte(c))}" class="ecarte">
  ${chips}
  <figure class="card mapcard">${communeMap({ commune: c, spots, label: MOTS.carte(c), id: "ecm" })}${zoom}${legend}</figure>
  ${sheet}
</section>
<section aria-labelledby="h-lieux">
  <div class="sec-h"><h2 id="h-lieux">${esc(MOTS.lieux)}</h2></div>
  ${places}
</section>
<section aria-labelledby="h-act">
  <div class="sec-h"><h2 id="h-act">${esc(MOTS.activites(c))}</h2></div>
  ${activities}
</section>
<p><a href="/enfants">${esc(MOTS.ile)} →</a></p>
<p class="note">${esc(enfants.HOURS_NOTE)}</p>
<p class="note">${esc(enfants.INDICATIF_NOTE)}</p>
<p class="note">${esc(CREDITS)}</p>
</div><script>${MAP_SCRIPT}</script>${g.feuille}`;

  return layout(origin, { title, description, path, jsonld: [crumbs(origin, c, path, { name: "Enfants", path: "/enfants" }), webPage(origin, path, title, description, data)], alerte }, band, g.ligne + body);
}
