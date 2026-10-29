/**
 * /collecte and /collecte/<commune>: the day each street's bins are collected in the West (vie/collecte.ts), in
 * marketing's words. The streets are grouped by calendar, the rhythm said once per group; a search box shows the
 * line of the streets typed. Built from the bundled calendars and the day: no source is read.
 */
import * as col from "../vie/collecte.js";
import { a, de } from "../tools/format.js";
import type { Alerte } from "./data.js";
import { connectorCta, crumbBar, crumbs, webPage } from "./domains.js";
import { esc } from "./map.js";
import { folded, layout } from "./pages.js";

// The texts of the pages, worded by marketing.
export const TITLE = "Collecte des déchets Ouest Réunion : jours par rue · 974";
const H1 = "Quel jour passent les poubelles ?";
const META = `Ordures ménagères, tri, déchets verts : le jour de collecte rue par rue à Saint-Paul, La Possession, Saint-Leu, Le Port et Trois-Bassins (974), calendriers ${col.YEAR} du TCO.`;
const titleOf = (c: string) => `Collecte des déchets ${a(c)} : jours par rue · 974`;
const h1Of = (c: string) => `Quel jour passent les poubelles ${a(c)} ?`;
const metaOf = (c: string) => `Ordures ménagères, tri et déchets verts ${a(c)} (974) : le jour de collecte de votre rue, d'après le calendrier ${col.YEAR} du TCO. Cherchez votre rue.`;
const LEAD = `Tapez le nom de votre rue : le jour de passage pour les ordures ménagères, le tri et les déchets verts, d'après les calendriers ${col.YEAR} publiés par le TCO.`;
const { honesty, communeSlug } = col;
// With the list just below (marketing).
const NOT_FOUND_HERE = "Rue non trouvée dans les calendriers du TCO. Vérifiez l'orthographe, essayez le nom du quartier, ou cherchez dans la liste ci-dessous.";
export const communeOf = (slug: string) => col.COMMUNES.find((c) => communeSlug(c) === slug);

// Shows the full line of the streets typed (3 letters at least, 20 at most), hides the groups without a match. In a
// block: the page's own script has names of its own.
const SCRIPT = `{const q=document.getElementById("rue");if(q){const n=(s)=>s.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase();const out=document.getElementById("trouve");
q.addEventListener("input",()=>{const t=n(q.value.trim());const hits=[];document.querySelectorAll(".voies li").forEach((li)=>{const ok=t.length<3||n(li.textContent).includes(t);li.hidden=!ok;if(ok&&t.length>=3)hits.push(li)});
document.querySelectorAll(".groupe").forEach((g)=>{g.hidden=![...g.querySelectorAll("li")].some((li)=>!li.hidden)});
if(t.length>=3)document.querySelectorAll(".groupe>details").forEach((d)=>{if(!d.parentNode.hidden)d.open=true});
document.querySelectorAll(".sans").forEach((s)=>{s.hidden=![...s.querySelectorAll(".groupe")].some((g)=>!g.hidden)});
out.className=hits.length?"card":"";out.replaceChildren(...hits.slice(0,20).map((li)=>{const p=document.createElement("p");const g=li.closest(".groupe");p.textContent=li.textContent+", "+g.dataset.c+" : "+g.dataset.r;return p}));
document.getElementById("rien").hidden=t.length<3||hits.length>0})}}`;

function groups(today: number, commune?: string): string {
  const streets = commune ? col.STREETS.filter((s) => s.commune === commune) : col.STREETS;
  const byCal = new Map<string, { c: number; commune: string; noms: string[] }>();
  for (const s of streets) {
    const k = `${s.calendrier}|${s.commune}`;
    const g = byCal.get(k) ?? { c: s.calendrier, commune: s.commune, noms: [] };
    g.noms.push(s.nom.replace(/\s*\([^)]*\)$/, ""));
    byCal.set(k, g);
  }
  const list = (g: { noms: string[] }) => `<ul class="voies plain">${[...new Set(g.noms)].sort((x, y) => x.localeCompare(y, "fr")).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;
  // Each group folded under its rhythm's first part and its number of streets (marketing): two groups may share that
  // line, their whole rhythms told apart inside. A search opens the groups it finds (SCRIPT).
  const count = (g: { noms: string[] }) => { const n = new Set(g.noms).size; return `${n}\u00a0rue${n > 1 ? "s" : ""}`; };
  const all = [...byCal.values()];
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const rhythms = all.filter((g) => col.CALENDARS[g.c]).map((g) => ({ g, parts: (col.rhythmOf(col.CALENDARS[g.c], today) ?? "").split("\u00a0; ") }));
  const dated = rhythms
    .map((x) => {
      const { g } = x;
      const cal = col.CALENDARS[g.c];
      const r = x.parts.join("\u00a0; ");
      const feries = col.holidays(cal, today).map((h) => (h.reportee ? esc(col.holidayLine(h)) : `Jour férié : vérifiez <a href="${esc(cal.pdf)}" rel="noopener">le calendrier du TCO (PDF) →</a>`));
      return `<div class="card groupe" data-c="${esc(g.commune)}" data-r="${esc(`${r}.`)}">${folded(true,
        `<h3>${esc(cap(x.parts[0]))}\u00a0<span class="note">·\u00a0${commune ? "" : `${esc(g.commune).replace(/^(Le|La|Les) /, "$1\u00a0")}, `}${count(g)}</span></h3>`,
        `<p>${esc(cap(r))}.</p>${feries.map((f) => `<p>${f}</p>`).join("")}
${list(g)}
<p class="note">${commune ? "" : `${esc(g.commune)} · `}<a href="${esc(cal.pdf)}" rel="noopener">calendrier ${esc(cal.code)} du TCO (PDF)</a></p>`)}</div>`;
    });
  // The streets without a calendar, after the others: the plural above their list, the singular in a street's line.
  const without = all.filter((g) => !col.CALENDARS[g.c]);
  const said = esc(col.NO_CALENDAR_LIST.slice(0, col.NO_CALENDAR_LIST.lastIndexOf("Renseignez")));
  const nc = without.length
    ? `<div class="sans"><h3>Voies sans calendrier du TCO</h3><p>${said}<a href="${col.TCO_CONTACT}" rel="noopener">Renseignez-vous auprès du TCO →</a></p>
${without.map((g) => `<div class="card groupe" data-c="${esc(g.commune)}" data-r="${esc(col.NO_CALENDAR)}">${commune ? list(g) : folded(true, `<h3>${esc(g.commune)}\u00a0<span class="note">·\u00a0${count(g)}</span></h3>`, list(g))}</div>`).join("\n")}</div>`
    : "";
  return [...dated, nc].join("\n");
}

export function collectePage(origin: string, now: Date, commune?: string, alerte?: Alerte): string {
  const path = commune ? `/collecte/${communeSlug(commune)}` : "/collecte";
  const title = commune ? titleOf(commune) : TITLE;
  const description = commune ? metaOf(commune) : META;
  const today = col.todayOf(now);
  const others = col.COMMUNES.filter((c) => c !== commune).map((c) => `<a href="/collecte/${communeSlug(c)}">${esc(c)}</a>`).join(" · ");
  const band = `${crumbBar(commune ? `Collecte ${a(commune)}` : "Collecte des déchets")}
<div class="wrap intro"><div class="pitch">
  <p class="pill"><span class="dot"></span>Calendriers du TCO</p>
  <h1>${esc(commune ? h1Of(commune) : H1)}</h1>
  <p class="lead">${esc(LEAD)}</p>
  <label class="search">Votre rue <input id="rue" type="search" placeholder="Rue, chemin, impasse…" autocomplete="off"></label>
</div></div>`;
  const body = `<section aria-label="Votre rue"><div id="trouve" aria-live="polite"></div><p id="rien" hidden>${esc(NOT_FOUND_HERE)}</p></section>
<section aria-labelledby="h-voies">
  <div class="sec-h"><h2 id="h-voies">${commune ? `Les rues ${esc(de(commune))}` : "Toutes les rues de l'Ouest"}</h2>
  <p class="note">${esc(honesty())}</p></div>
  ${col.pastYear(today) ? `<p class="card">${esc(col.notYet())}</p>` : `${col.nearYearEnd(today) ? `<p class="card">${esc(col.notYet())}</p>` : ""}${groups(today, commune)}`}
</section>
<section><p>${commune ? `Les autres communes : ${others}` : `Par commune : ${others}`}</p>
<p><a href="/decheteries">Les déchèteries de l'Ouest et leurs bennes en direct →</a></p></section>
${connectorCta("annuaire_services_publics", "les jours de collecte")}
<script>${SCRIPT}</script>`;
  return layout(origin, { title, description, path, jsonld: [crumbs(origin, commune ? `Collecte ${a(commune)}` : "Collecte des déchets", path), webPage(origin, path, title, description, null)], alerte }, band, body);
}
