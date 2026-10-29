/**
 * /emploi: the public sector's offers open at La Réunion, from Choisir le service public, newest first, to filter by
 * commune or by words, each with its link to apply on the site. In marketing's words (29/10/2026); the companies'
 * offers are not taken: a sentence with two links, and the user's line on the sites that do not allow it.
 */
import type { Cache, Cached } from "../cache.js";
import { prochaineLecture } from "../providers/emploi.js";
import { COUVERTURE, emploi, ENTREPRISES, NON_REPRIS, type OffreRow } from "../tools/emploi.js";
import { connectorCta, crumbBar, crumbs, sourcesNote, warnings, webPage } from "./domains.js";
import type { Alerte } from "./data.js";
import { esc } from "./map.js";
import { hm, layout, readAt } from "./pages.js";

export const PATH = "/emploi";
export const NOM = "Emploi public";

export interface EmploiAnswer {
  resume: string;
  nombre: number;
  offres: OffreRow[];
  injoignable?: string;
  couverture: string;
  sources: { source: string; licence: string; attribution: string }[];
  /** No copy of the offers yet: when the scheduled event reads them next (ISO). */
  prochaine?: string;
}

/**
 * The page's copy: every offer open, from the tool's answer. Without a copy of the offers in the store, when they are
 * read next: reloading would not bring them sooner (a page copy lasts 5 minutes, then is built again).
 */
export async function buildEmploi(cache: Cache, now = new Date()): Promise<EmploiAnswer> {
  const r = await emploi(cache, undefined, undefined, now, Infinity);
  if ("isError" in r && r.isError) return { resume: "", nombre: 0, offres: [], couverture: COUVERTURE, sources: [], prochaine: prochaineLecture(now).toISOString() };
  const { resume, nombre, offres, injoignable, couverture, sources } = JSON.parse(r.content[0].text) as EmploiAnswer;
  return { resume, nombre, offres, ...(injoignable ? { injoignable } : {}), couverture, sources };
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function row(o: OffreRow): string {
  const place = "commune" in o && o.commune ? o.commune : "commune non précisée";
  const small = [o.employeur, "metier" in o ? o.metier : "domaine" in o ? o.domaine : undefined, o.nature, place].filter(Boolean).map((x) => esc(x!)).join(" · ");
  return `<li data-c="${esc("commune" in o && o.commune ? o.commune : "")}"><span><a href="${esc(o.lien)}" rel="noopener">${esc(o.intitule)}</a><small>${small}</small></span>` +
    `<span class="q-none">${esc(o.date_limite ? `jusqu'au ${o.date_limite}` : `publiée le ${o.publiee_le}`)}</span></li>`;
}

const FILTER = `<form id="of" class="card filter" hidden role="search" aria-label="Filtrer les offres">
<label class="q">Chercher <input name="q" type="search" placeholder="infirmier, agent d'entretien, contractuel…" autocomplete="off"></label>
<label>Commune <select name="c"><option value="">toutes</option>COMMUNES</select></label>
<p class="note" id="of-n" aria-live="polite"></p></form>`;

const SCRIPT = `(()=>{const f=document.getElementById("of");if(!f)return;f.hidden=false;
const items=[...document.querySelectorAll("#offres li")];
const norm=(s)=>s.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
for(const e of items)e.dataset.q=norm(e.textContent);
const run=()=>{const q=norm(f.q.value).split(" ").filter(Boolean),c=f.c.value;let n=0;
for(const e of items){const ok=q.every((t)=>e.dataset.q.includes(t))&&(!c||e.dataset.c===c);e.hidden=!ok;if(ok)n++}
document.getElementById("of-n").textContent=q.length||c?n+" offre"+(n>1?"s":"")+" sur "+items.length+".":"";};
f.addEventListener("input",run);f.addEventListener("submit",(e)=>e.preventDefault());})();`;

export function emploiPage(origin: string, data: Cached<EmploiAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const communes = [...new Set((d?.offres ?? []).flatMap((o) => ("commune" in o && o.commune ? [o.commune] : [])))].sort((x, y) => x.localeCompare(y, "fr"));

  const status = d && data && !d.prochaine
    ? `<p>${plural(d.nombre, "offre ouverte", "offres ouvertes")} à la candidature sur Choisir le service public, dernière lecture ${readAt(data.fetchedAt, now).a}.</p>`
    : "";
  const list = !d || !data
    ? `<p class="card">Les offres se chargent : rechargez la page dans quelques secondes.</p>`
    : d.prochaine
      ? `<p class="card">Les offres ne sont pas encore lues : prochaine lecture prévue à ${hm(d.prochaine)}.</p>`
      : d.offres.length
      ? `${FILTER.replace("COMMUNES", communes.map((c) => `<option>${esc(c)}</option>`).join(""))}<ul class="rows eau" id="offres">${d.offres.map(row).join("")}</ul>`
      : `<p class="card">Aucune offre publiée sur Choisir le service public pour La Réunion à ${hm(data.fetchedAt)}.</p>`;

  const title = "Emploi public Réunion : offres de l'État, des communes et des hôpitaux · 974";
  const description = "Les offres d'emploi de la fonction publique à La Réunion (974) : État, collectivités, hôpitaux, avec la commune et le lien pour postuler.";

  const band = `${crumbBar(NOM)}
<div class="wrap intro solo"><div class="pitch">
  <h1>Offres d'emploi public à La Réunion</h1>
  <p class="lead">Les offres de l'État, des collectivités et des hôpitaux publiées sur Choisir le service public, avec le lien pour postuler.</p>
  ${status}
</div></div>`;

  const body = `<section aria-labelledby="h-offres">
  <h2 id="h-offres" class="sr">Les offres</h2>
  ${d?.injoignable ? warnings([d.injoignable]) : ""}
  ${list}
  <p>Les offres des entreprises ne sont pas reprises ici : vous les trouvez sur ${ENTREPRISES.map((e) => `<a href="${esc(e.lien)}" rel="noopener">${esc(e.nom)}</a>`).join(" et sur ")}, le portail emploi et formation de La Réunion.</p>
  <p>${esc(NON_REPRIS)}</p>
</section>
<section aria-labelledby="h-couv">
  <div class="sec-h"><h2 id="h-couv">Ce qui est couvert</h2><p>${d ? esc(d.couverture) : ""}</p></div>
  ${d && data && !d.prochaine ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("emploi", "les offres d'emploi public")}
<script>${SCRIPT}</script>`;

  return layout(origin, { title, description, path: PATH, jsonld: [crumbs(origin, NOM, PATH), webPage(origin, PATH, title, description, data)], alerte }, band, body);
}
