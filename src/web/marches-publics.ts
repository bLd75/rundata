/**
 * /marches-publics: the public procurement notices open at La Réunion, from the BOAMP, newest first, to filter by
 * commune or by words, each with its link to the notice on boamp.fr. In marketing's words (29/10/2026). No invitation
 * to the connector yet: no tool answers it (the next one).
 */
import type { Cache, Cached } from "../cache.js";
import { localTime } from "../geo.js";
import { avis, type Avis, prochaineLecture, SOURCE } from "../providers/marches-publics.js";
import { credits } from "../tools/format.js";
import { injoignable } from "../tools/injoignable.js";
import { crumbBar, crumbs, sourcesNote, warnings, webPage } from "./domains.js";
import type { Alerte } from "./data.js";
import { esc } from "./map.js";
import { hm, layout, readAt } from "./pages.js";

export const PATH = "/marches-publics";
export const NOM = "Marchés publics";

/** What is covered, in marketing's words. */
export const COUVERTURE = "Les avis de marché publiés au Bulletin officiel des annonces des marchés publics (BOAMP) pour La Réunion, lus chaque heure. Un avis reste ici jusqu'à sa date limite de réponse ; un rectificatif remplace l'avis qu'il corrige. La liste n'est pas complète : sous 90 000 € HT, l'acheteur choisit où il publie, et jusqu'aux seuils européens, il peut publier dans un journal d'annonces légales plutôt qu'au BOAMP. Le dossier de consultation se télécharge sur le profil d'acheteur, dont l'avis donne le lien : l'avis fait foi.";

export interface MarchesAnswer {
  nombre: number;
  avis: Avis[];
  injoignable?: string;
  sources: { source: string; licence: string; attribution: string }[];
  /** No copy of the notices yet: when the scheduled event reads them next (ISO). */
  prochaine?: string;
}

/**
 * The page's copy: every notice open, from the store. Without a copy in the store, when they are read next: reloading
 * would not bring them sooner.
 */
export async function buildMarches(cache: Cache, now = new Date()): Promise<MarchesAnswer> {
  let c;
  try {
    c = await avis(cache, now);
  } catch {
    c = null;
  }
  if (!c) return { nombre: 0, avis: [], sources: [], prochaine: prochaineLecture(now).toISOString() };
  const at = localTime(c.fetchedAt);
  return {
    nombre: c.value.avis.length,
    avis: c.value.avis,
    ...(c.value.echec ? { injoignable: injoignable("le BOAMP", at, localTime(new Date(c.value.echec)), now).texte } : {}),
    sources: credits([SOURCE]),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** « 2026-11-14 » → « 14/11 », with its year when it is not this one: « 08/01/2027 ». */
function jour(d: string, now: Date): string {
  const year = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 4);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}${d.slice(0, 4) === year ? "" : `/${d.slice(0, 4)}`}`;
}

function row(a: Avis, now: Date): string {
  const place = a.commune ? `à ${a.commune}` : a.communeAcheteur ? `acheteur à ${a.communeAcheteur}` : undefined;
  const small = [a.acheteur, a.types.join(", "), place].filter(Boolean).map((x) => esc(x!)).join(" · ");
  return `<li data-c="${esc(a.commune ?? a.communeAcheteur ?? "")}"><span><a href="${esc(a.lien)}" rel="noopener">${esc(a.objet)}</a><small>${small}</small></span>` +
    `<span class="q-none">${esc(`jusqu'au ${jour(a.limite, now)}`)}</span></li>`;
}

const FILTER = `<form id="of" class="card filter" hidden role="search" aria-label="Filtrer les avis">
<label class="q">Chercher <input name="q" type="search" placeholder="voirie, restauration scolaire, nettoyage…" autocomplete="off"></label>
<label>Commune <select name="c"><option value="">toutes</option>COMMUNES</select></label>
<p class="note" id="of-n" aria-live="polite"></p></form>`;

const SCRIPT = `(()=>{const f=document.getElementById("of");if(!f)return;f.hidden=false;
const items=[...document.querySelectorAll("#avis li")];
const norm=(s)=>s.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
for(const e of items)e.dataset.q=norm(e.textContent);
const run=()=>{const q=norm(f.q.value).split(" ").filter(Boolean),c=f.c.value;let n=0;
for(const e of items){const ok=q.every((t)=>e.dataset.q.includes(t))&&(!c||e.dataset.c===c);e.hidden=!ok;if(ok)n++}
document.getElementById("of-n").textContent=q.length||c?n+" avis sur "+items.length+".":"";};
f.addEventListener("input",run);f.addEventListener("submit",(e)=>e.preventDefault());})();`;

export function marchesPage(origin: string, data: Cached<MarchesAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const communes = [...new Set((d?.avis ?? []).flatMap((a) => { const c = a.commune ?? a.communeAcheteur; return c ? [c] : []; }))].sort((x, y) => x.localeCompare(y, "fr"));

  const status = d && data && !d.prochaine
    ? `<p>${plural(d.nombre, "avis de marché ouvert", "avis de marché ouverts")} aux réponses sur le BOAMP, dernière lecture ${readAt(data.fetchedAt, now).a}.</p>`
    : "";
  const list = !d || !data
    ? `<p class="card">Les avis se chargent : rechargez la page dans quelques secondes.</p>`
    : d.prochaine
      ? `<p class="card">Les avis ne sont pas encore lus : prochaine lecture prévue à ${hm(d.prochaine)}.</p>`
      : d.avis.length
      ? `${FILTER.replace("COMMUNES", communes.map((c) => `<option>${esc(c)}</option>`).join(""))}<ul class="rows eau" id="avis">${d.avis.map((a) => row(a, now)).join("")}</ul>`
      : `<p class="card">Aucun avis de marché ouvert pour La Réunion sur le BOAMP à ${hm(data.fetchedAt)}.</p>`;

  const title = "Marchés publics Réunion : avis de marché et appels d'offres en cours · 974";
  const description = "Les avis de marché publiés au BOAMP pour La Réunion (974) : travaux, services et fournitures des collectivités, de l'État et des hôpitaux, avec la date limite et le lien vers l'avis.";

  const band = `${crumbBar(NOM)}
<div class="wrap intro solo"><div class="pitch">
  <h1>Marchés publics à La Réunion</h1>
  <p class="lead">Les avis de marché des collectivités, de l'État et des établissements publics de l'île, publiés au BOAMP, avec la date limite de réponse et le lien vers l'avis.</p>
  ${status}
</div></div>`;

  const body = `<section aria-labelledby="h-avis">
  <h2 id="h-avis" class="sr">Les avis</h2>
  ${d?.injoignable ? warnings([d.injoignable]) : ""}
  ${list}
</section>
<section aria-labelledby="h-couv">
  <div class="sec-h"><h2 id="h-couv">Ce qui est couvert</h2><p>${esc(COUVERTURE)}</p></div>
  ${d && data && !d.prochaine ? sourcesNote(d.sources, data) : ""}
</section>
<script>${SCRIPT}</script>`;

  return layout(origin, { title, description, path: PATH, jsonld: [crumbs(origin, NOM, PATH), webPage(origin, PATH, title, description, data)], alerte }, band, body);
}
