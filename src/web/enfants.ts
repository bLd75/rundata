/**
 * Where to go with children (/enfants): the agenda's activities for them, this weekend first, then the places of the
 * 24 communes by kind (vie/enfants.ts), each with its ages: the source's as a fact, else an indication by kind, marked.
 * Filtered by age band and kind in the page. The words are marketing's (marketing/enfants-textes.md).
 */
import type { Cached } from "../cache.js";
import { mentionOf } from "../mentions.js";
import { ACCUEILS } from "../providers/agenda.js";
import * as enfants from "../vie/enfants.js";
import type { Alerte, EnfantsAnswer } from "./data.js";
import { agendaHours, connectorCta, crumbBar, crumbs, loading, webPage } from "./domains.js";
import { esc, islandMap } from "./map.js";
import { anchorId, ask, layout, type Live } from "./pages.js";

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

function eventLi(r: Row): string {
  const a = enfants.eventAge(r.age);
  const hours = agendaHours(r.quand);
  const small = [r.quand.replace(/ (de|à) \d\d:\d\d.*$/, "") + (hours ? ` · ${hours}` : ""), r.commune, r.lieu && r.lieu.length < 80 ? r.lieu : undefined, r.source ? `Source\u00a0: ${r.source}` : r.publie_par]
    .filter(Boolean).map((x) => esc(x!)).join(" · ");
  const status = r.statut && r.statut !== "complet" ? `<span class="badge">${esc(r.statut)}</span> ` : "";
  return `<li data-b="${a.bands.join(" ")}" data-t="agenda"><span>${status}${r.lien ? `<a href="${esc(r.lien)}" rel="noopener"${ACCUEILS.has(r.lien) ? ' target="_blank"' : ""}>${esc(r.titre)}</a>` : esc(r.titre)}<small>${small}</small></span>${badge(a)}</li>`;
}

function placeLi(l: enfants.Lieu, now: Date): string {
  const a = enfants.ageOf(l);
  const today = enfants.hoursToday(l, now);
  const link = l.site ?? l.lien;
  // A site that asks for its name with each link (mentions.ts): right after the address.
  const small = [l.detail, l.adresse, mentionOf(link), today ? `aujourd'hui ${today}` : undefined].filter(Boolean).map((x) => esc(x!)).join(" · ");
  const name = esc(enfants.nameOf(l));
  return `<li data-b="${a.bands.join(" ")}" data-t="${l.type}"><span>${link ? `<a href="${esc(link)}" rel="noopener">${name}</a>` : name}${small ? `<small>${small}</small>` : ""}</span>${badge(a)}</li>`;
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
  const d = data?.value;
  const path = "/enfants";
  const communes = [...new Set(enfants.LIEUX.map((l) => l.commune))].sort((x, y) => x.localeCompare(y, "fr"));
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
  // The count of a card, which a filter turns into « 1 lieu sur 15 ».
  const note = (n: number, one: string, many: string) => `<span class="note" data-n="${n}" data-s="${one}" data-p="${many}">${count(n, one, many)}</span>`;

  const markers = communes.map((c) => {
    const list = enfants.inCommune(c);
    return { lon: list.reduce((n, l) => n + l.lon, 0) / list.length, lat: list.reduce((n, l) => n + l.lat, 0) / list.length, label: String(list.length), name: `${c} : ${count(list.length, "lieu", "lieux")}`,
      round: true, color: "#e8590c", quiet: true, place: c, say: count(list.length, "lieu", "lieux"), href: `#${anchorId("c", c)}` };
  });

  const weekend = new Set((d?.ce_week_end ?? []).map((r) => `${r.titre}|${r.date}`));
  const later = (d?.evenements ?? []).filter((r) => !weekend.has(`${r.titre}|${r.date}`));
  const card = (title: string, rows: Row[]) =>
    rows.length ? `<li class="card" data-k><h3>${esc(title)} ${note(rows.length, "activité", "activités")}</h3><ul class="rows eau">${rows.map(eventLi).join("")}</ul></li>` : "";
  const activities = !d
    ? loading("L'agenda des enfants")
    : d.ce_week_end.length || later.length
      ? `<ul class="zones top">${card("Ce week-end", d.ce_week_end)}${card("Dans les deux semaines qui viennent", later)}</ul>`
      : `<p class="card">${EMPTY}</p>`;

  const places = `<ul class="zones top">${communes.map((c) => {
    const list = enfants.inCommune(c);
    // Folded: 24 communes, hundreds of places. The map, a link to the commune or a filter opens it.
    return `<li class="card tgt" id="${anchorId("c", c)}" data-k><details><summary><h3>${esc(c)} ${note(list.length, "lieu", "lieux")}</h3></summary><div class="kinds">` +
      enfants.TYPES.map((t) => {
        const of = list.filter((l) => l.type === t.type);
        return of.length ? `<div class="kind" data-k><h4>${esc(t.nom)}</h4><ul class="rows eau">${of.map((l) => placeLi(l, now)).join("")}</ul></div>` : "";
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
  <figcaption class="note" style="color:var(--on-night-muted)">Nombre de lieux par commune.</figcaption></figure>
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
</div><script>${FILTER_SCRIPT}</script>
${connectorCta("annuaire_services_publics", "les lieux pour les enfants")}`;

  return layout(origin, { title: TITLE, description: DESCRIPTION, path, jsonld: [crumbs(origin, "Enfants", path), webPage(origin, path, TITLE, DESCRIPTION, data)], alerte }, band, body);
}
