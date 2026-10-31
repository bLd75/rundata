/**
 * /application, « rundata.re sur votre écran d'accueil »: the steps of every browser, the visitor's first and open
 * (web/pwa.ts tells the browsers apart), linked from the install block, the menu and the footer. Marketing's words of
 * 27/10/2026 (pwa.ts, SECTIONS).
 */
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { layout } from "./pages.js";
import { KIND_OF, SECTIONS } from "./pwa.js";

export const PATH = "/application";
const TITLE = "rundata.re sur l'écran d'accueil, comme une application · 974";
const DESCRIPTION = "Ajoutez rundata.re à l'écran d'accueil\u00a0: les étapes pour Safari, Chrome, Firefox, Edge et Samsung Internet, sur téléphone ou ordinateur. Sans store ni compte.";
const NAME = "rundata.re sur votre écran d'accueil";

/**
 * The page's script: opens the visitor's browser and moves it first; a browser with Android's prompt gets its section
 * by its system, and the prompt behind that section's button. A computer's Chrome or Edge on a touch screen only (a
 * phone asking for the computer's version of the site says it is one) opens none. Opened from the icon, it says so instead of how to remove it.
 * In a block of its own: the install block's script (pwa.ts) declares the same names at the top of the page.
 */
const SCRIPT = `{${KIND_OF}
const BY_KIND=${JSON.stringify(Object.fromEntries(SECTIONS.flatMap((s) => (s.kind ? [[s.kind, s.id]] : []))))};
const BY_PROMPT=${JSON.stringify(Object.fromEntries(SECTIONS.flatMap((s) => (s.bouton ? [[s.bouton, s.id]] : []))))};
const ua=navigator.userAgent,k=kindOf(ua,navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const id=BY_KIND[k]||(/Android/.test(ua)?BY_PROMPT.android:k===null&&/Chrome|Edg/.test(ua)&&!matchMedia("(pointer: coarse)").matches?BY_PROMPT.ordinateur:undefined);
const d=id&&document.getElementById(id);if(d){d.open=true;d.parentNode.prepend(d)}
if(matchMedia("(display-mode: standalone)").matches||navigator.standalone===true){document.getElementById("deja").hidden=false;document.getElementById("fait").hidden=true}
let ask=null;addEventListener("beforeinstallprompt",(e)=>{e.preventDefault();ask=e;document.querySelectorAll(".app-go").forEach((b)=>{b.hidden=false})});
document.querySelectorAll(".app-go").forEach((b)=>b.addEventListener("click",async()=>{if(!ask)return;ask.prompt();await ask.userChoice.catch(()=>{});ask=null}))}`;

export function applicationPage(origin: string, alerte?: Alerte): string {
  const band = `${crumbBar(NAME)}
<div class="wrap intro solo"><div class="pitch">
  <h1>${NAME}</h1>
  <p class="lead">Une icône sur votre téléphone, et la météo, la vigilance ou le volcan s'ouvrent d'un geste, comme une application. Les pages déjà vues restent lisibles sans réseau, pratique en randonnée. Pas de store, pas de compte : c'est le site lui-même.</p>
</div></div>`;
  const sections = SECTIONS.map((s) => `<details class="card app-nav" id="${s.id}"><summary><h2>${s.nom}</h2></summary>
    ${s.html ?? ""}${s.bouton ? `\n    <p><button type="button" class="go app-go" hidden>Installer</button></p>` : ""}${s.plus ? `\n    ${s.plus}` : ""}
  </details>`).join("\n  ");
  const body = `<section class="app-page">
  <div class="app-navs">
  ${sections}
  </div>
  <p id="fait">Déjà fait\u00a0? L'icône rundata.re ouvre le site comme une application. Pour la retirer, faites un appui long sur l'icône, puis supprimez-la comme une autre application.</p>
  <p id="deja" hidden>rundata.re est déjà sur votre écran d'accueil.</p>
</section>
<script>${SCRIPT}</script>`;
  return layout(origin, { title: TITLE, description: DESCRIPTION, path: PATH, jsonld: [crumbs(origin, NAME, PATH), webPage(origin, PATH, TITLE, DESCRIPTION, null)], alerte, sansInstallation: true }, band, body);
}
