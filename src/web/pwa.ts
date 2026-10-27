/**
 * The site as an app on the phone: its service worker, the block that offers to install it, and the page for an
 * address never opened without network. No account, no cookie: the copies of the pages and the « Plus tard » stay on
 * the phone (Cache Storage, localStorage) and are sent to no one.
 *
 * The service worker asks the network first for every page, and keeps a copy of each page served whole (a page
 * without its live block is `no-store`, web/site.ts); without network it shows the copy, under a banner that gives its
 * date above everything, alerts included, so that no one takes an old alert for the state of the moment. It never
 * keeps the assistants' copies (`?maj=`), the MCP server, the feeds, the traces or the feedback form.
 *
 * It takes over at once (skipWaiting, clients.claim): an old version never stays on a phone. Its text changes only
 * with the files it keeps (their addresses change with their content), so a deploy does not make every phone fetch
 * them again.
 *
 * In the installed app it marks each page it asks for with `rundata-mode: app`, and nothing else: the page view is
 * then counted as one in the app (metrics.ts, blob11). The page tells it which windows are the app's
 * (`display-mode: standalone`); the first page opened from the icon has `?ref=pwa`.
 *
 * On a phone of the team, it also marks each page with `rundata-equipe: 1`, so that the team's visits stay out of the
 * figures (metrics.ts, teamVisit). The phone is marked by opening `/?interne=1` (unmarked by `/?interne=0`): the page
 * keeps the mark in localStorage and tells the worker, which keeps it in Cache Storage. No cookie, nothing sent but
 * this header.
 */

export const SW_PATH = "/sw.js";
export const OFFLINE_PATH = "/hors-ligne";
/** How many pages a phone keeps, the oldest dropped first. */
export const KEPT_PAGES = 40;
// Past this, a page that has a copy shows it: the network may be there but too weak to bring the page (a cirque).
const SLOW_MS = 12_000;
// Raised when the service worker's code changes in a way its files would not show, and when offlinePage (web/pages.ts)
// changes visibly: the phones keep the offline page they fetched until this text changes.
// 2: the symbol of the brand (/favicon.svg, the offline page's header).
const REVISION = 2;

/** A short mark of a text, for a name that changes with it (the shell's cache, the stylesheet's address). */
export const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/** The banner over a page's copy, by its path: the vigilance and the volcano say what may have changed. */
export const OFFLINE_AFTER: Record<string, string> = {
  "/vigilance": "La vigilance a pu changer depuis.",
  "/volcan": "L'état du volcan a pu changer depuis.",
};
const OFFLINE_DEFAULT = "Les informations ont pu changer depuis.";

// « 24/10 à 18:42 », in Réunion time, the year only when it is not this one: shared by the worker and the page.
const WHEN = `const when=(t,now)=>{const d=new Date(t+144e5),n=new Date(now+144e5),p=(x)=>String(x).padStart(2,"0");
return p(d.getUTCDate())+"/"+p(d.getUTCMonth()+1)+(d.getUTCFullYear()===n.getUTCFullYear()?"":"/"+d.getUTCFullYear())+" à "+p(d.getUTCHours())+":"+p(d.getUTCMinutes())};`;

/** The service worker, with the files of the page's shell it keeps (`shell`: addresses, the offline page first). */
export function serviceWorker(shell: string[]): string {
  const files = [OFFLINE_PATH, ...shell.filter((f) => f !== OFFLINE_PATH)];
  return `// rundata.re : la lecture hors ligne (src/web/pwa.ts).
const SHELL=${JSON.stringify(files)};
const STYLE=SHELL.find((f)=>/^\\/style-\\w+\\.css$/.test(f));
const SHELL_CACHE="coquille-${hash(JSON.stringify(files) + REVISION)}";
const PAGES="pages",STATE="etat",KEEP=${KEPT_PAGES},SLOW_MS=${SLOW_MS},OFFLINE=${JSON.stringify(OFFLINE_PATH)};
const AFTER=${JSON.stringify(OFFLINE_AFTER)},AFTER_DEFAULT=${JSON.stringify(OFFLINE_DEFAULT)};
const SKIP=/^\\/(?:mcp|sw\\.js|avis|\\.well-known)(?:\\/|$)|\\.(?:rss|gpx|xml|txt|webmanifest|json)$/;
${WHEN}
self.addEventListener("install",(e)=>{e.waitUntil(caches.open(SHELL_CACHE).then((c)=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",(e)=>{e.waitUntil(caches.keys().then((ks)=>Promise.all(ks.filter((k)=>k.startsWith("coquille-")&&k!==SHELL_CACHE).map((k)=>caches.delete(k)))).then(()=>self.clients.claim()))});
// The windows of the installed app, by client id: kept in Cache Storage, since the worker is stopped between pages.
let app=null;
const appIds=async()=>{if(!app){const r=await (await caches.open(STATE)).match("/etat/app");app=new Set(r?await r.json():[])}return app};
// A phone of the team (its page says so at each visit): kept the same way.
let team=null;
const inTeam=async()=>{if(team===null)team=!!(await (await caches.open(STATE)).match("/etat/interne"));return team};
const setTeam=async(on)=>{team=on;const c=await caches.open(STATE);if(on)await c.put("/etat/interne",new Response("1"));else await c.delete("/etat/interne")};
self.addEventListener("message",(e)=>{if(e.data==="interne"||e.data==="externe")return e.waitUntil(setTeam(e.data==="interne"));
if(e.data!=="app"||!e.source)return;e.waitUntil((async()=>{const ids=await appIds();if(ids.has(e.source.id))return;
const open=new Set((await self.clients.matchAll({type:"window",includeUncontrolled:true})).map((c)=>c.id));for(const id of ids)if(!open.has(id))ids.delete(id);
ids.add(e.source.id);await (await caches.open(STATE)).put("/etat/app",new Response(JSON.stringify([...ids])))})())});
const inApp=async(u)=>{if(u.searchParams.get("ref")==="pwa")return true;const ids=await appIds();if(!ids.size)return false;
const ws=await self.clients.matchAll({type:"window"});const w=ws.find((c)=>c.focused)||(ws.length===1?ws[0]:undefined);return !!w&&ids.has(w.id)};
const keyOf=(u)=>u.origin+(u.pathname.length>1?u.pathname.replace(/\\/$/,""):u.pathname);
const keepable=(r)=>r.status===200&&r.type==="basic"&&(r.headers.get("content-type")||"").startsWith("text/html")&&!/no-store/.test(r.headers.get("cache-control")||"");
// The copy's date is the page's own (its Date header): one the browser kept a minute is as old as it is.
async function keep(key,res){const html=await res.text();const t=/<title>([^<]*)<\\/title>/.exec(html);
const h=new Headers({"content-type":"text/html; charset=utf-8","x-copie":String(Date.parse(res.headers.get("date")||"")||Date.now()),"x-titre":encodeURIComponent(t?t[1]:key)});
const c=await caches.open(PAGES);await c.put(key,new Response(html,{headers:h}));const ks=await c.keys();
for(const k of ks.slice(0,Math.max(0,ks.length-KEEP)))await c.delete(k)}
async function fromCopy(copy,u){const at=Number(copy.headers.get("x-copie"));const html=await copy.text();
const path=u.pathname.length>1?u.pathname.replace(/\\/$/,""):u.pathname;
const band='<div class="horsligne" role="status">Hors ligne : copie du '+when(at,Date.now())+". "+(AFTER[path]||AFTER_DEFAULT)+"</div>";
return new Response(html.replace(/<body[^>]*>/,(b)=>b+"\\n"+band),{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}})}
async function offline(){const r=await caches.match(OFFLINE,{cacheName:SHELL_CACHE});
return r||new Response("Pas de réseau. Réessayez quand le réseau revient.",{status:503,headers:{"content-type":"text/plain; charset=utf-8"}})}
async function page(e,u){const key=keyOf(u);let req=e.request;
const mode=await inApp(u).catch(()=>false),mine=await inTeam().catch(()=>false);
if(mode||mine){const h=new Headers(req.headers);if(mode)h.set("rundata-mode","app");if(mine)h.set("rundata-equipe","1");req=new Request(req,{headers:h})}
let kept;const got=fetch(req).then((res)=>{if(keepable(res)&&u.pathname!==OFFLINE)kept=keep(key,res.clone());return res});
e.waitUntil(got.then(()=>kept).catch(()=>{}));
const copy=()=>caches.open(PAGES).then((c)=>c.match(key));
const slow=new Promise((ok)=>setTimeout(()=>copy().then((c)=>{if(c)ok(fromCopy(c,u))}),SLOW_MS));
try{return await Promise.race([got,slow])}catch{const c=await copy();return c?fromCopy(c,u):offline()}}
self.addEventListener("fetch",(e)=>{const r=e.request;if(r.method!=="GET")return;const u=new URL(r.url);
if(u.origin!==self.location.origin||SKIP.test(u.pathname)||u.searchParams.has("maj"))return;
if(r.mode==="navigate")return e.respondWith(page(e,u));
// A page kept from an earlier version asks for its stylesheet by its old address: it gets the shell's.
const p=STYLE&&/^\\/style-\\w+\\.css$/.test(u.pathname)?STYLE:u.pathname;
if(SHELL.includes(p))e.respondWith(caches.match(p,{cacheName:SHELL_CACHE}).then((hit)=>hit||fetch(r)))});
`;
}

/**
 * The browsers told apart, each with its own steps: Safari on an iPhone, on an iPad (which may say « Macintosh » but
 * has a touch screen), Chrome and Firefox on either, the other browsers of an iPhone, an application's own browser
 * (iPhone or Android), Firefox and the other browsers of Android without the prompt, Safari on a Mac.
 */
export const KINDS = ["ios", "ipad", "ios-chrome", "ios-firefox", "ios-autre", "app", "android-firefox", "android-autre", "mac-safari"] as const;
export type Kind = (typeof KINDS)[number];

/**
 * `kindOf(userAgent, touchMac)`: the browser's kind; « telephone » for a phone whose browser offers Android's prompt
 * (Chrome, Edge, Samsung Internet, Opera) or another phone; null for another computer, left to that prompt alone.
 */
export const KIND_OF = String.raw`const kindOf=(ua,touch)=>{const ipad=/iPad/.test(ua)||touch;
if(/iPhone|iPod/.test(ua)||ipad)return /GSA\/|FBAN|FBAV|Instagram|LinkedInApp|Snapchat|Line\//.test(ua)?"app":/CriOS\//.test(ua)?"ios-chrome":/FxiOS\//.test(ua)?"ios-firefox":/EdgiOS\/|OPiOS|DuckDuckGo|Ddg\//.test(ua)?"ios-autre":ipad?"ipad":"ios";
if(/Android/.test(ua))return /; wv\)|FBAN|FBAV|Instagram/.test(ua)?"app":/Firefox\//.test(ua)?"android-firefox":!/Chrome\//.test(ua)?"android-autre":"telephone";
if(/Mobi/.test(ua))return "telephone";
const v=/Version\/(\d+)[.\d]* Safari\//.exec(ua);
return /Macintosh/.test(ua)&&v&&Number(v[1])>=17&&!/Chrome|Chromium|Edg|OPR/.test(ua)?"mac-safari":null};`;

/** One browser's steps (marketing's words, the menus' names as checked on each browser), in the block and on /application. */
export interface Section {
  /** Its anchor on /application. */
  id: string;
  /** Its heading on /application. */
  nom: string;
  /** The kind whose block shows these steps; none for a browser with Android's prompt, whose block shows the button. */
  kind?: Kind;
  /** A browser with Android's prompt, on a phone or a computer: /application shows the « Installer » button. */
  bouton?: "android" | "ordinateur";
  /** Steps on /application only: a browser the block cannot be sure of (Safari on a Mac before Sonoma has no « Ajouter au Dock »). */
  pageOnly?: boolean;
  html?: string;
  /** What /application adds under them. */
  plus?: string;
}

/** The browsers in marketing's order (27/10); a menu is named only where the browser's own help names it, else the steps stay general. */
export const SECTIONS: Section[] = [
  {
    id: "iphone-safari",
    nom: "iPhone\u00a0: Safari",
    kind: "ios",
    html: `<ol><li>Touchez Partager <svg class="partage" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4M8 10H6v11h12V10h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>. S'il n'est pas dans la barre, ouvrez d'abord le menu de la page (bouton «\u00a0⋯\u00a0»), puis touchez «\u00a0Partager\u00a0».</li><li>Faites défiler les options, puis touchez «\u00a0Sur l'écran d'accueil\u00a0».</li><li>Touchez «\u00a0Ajouter\u00a0».</li></ol>`,
    plus: `<p>«\u00a0Sur l'écran d'accueil\u00a0» n'apparaît pas\u00a0? Tout en bas de la liste, touchez «\u00a0Modifier les actions\u00a0», puis «\u00a0Sur l'écran d'accueil\u00a0».</p>`,
  },
  {
    id: "ipad-safari",
    nom: "iPad\u00a0: Safari",
    kind: "ipad",
    html: `<ol><li>Touchez Partager <svg class="partage" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4M8 10H6v11h12V10h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>.</li><li>Touchez «\u00a0En voir plus\u00a0» (ou le bouton Plus, selon la version).</li><li>Touchez «\u00a0Sur l'écran d'accueil\u00a0», puis «\u00a0Ajouter\u00a0».</li></ol>`,
  },
  {
    id: "iphone-chrome",
    nom: "iPhone et iPad\u00a0: Chrome",
    kind: "ios-chrome",
    html: `<ol><li>Touchez Partager <svg class="partage" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4M8 10H6v11h12V10h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>, à droite de la barre d'adresse.</li><li>Touchez «\u00a0Sur l'écran d'accueil\u00a0».</li><li>Touchez «\u00a0Ajouter\u00a0».</li></ol>`,
  },
  {
    id: "iphone-firefox",
    nom: "iPhone et iPad\u00a0: Firefox",
    kind: "ios-firefox",
    html: `<ol><li>Ouvrez le menu de Firefox.</li><li>Touchez «\u00a0Enregistrer\u00a0», puis «\u00a0Ajouter à l'écran d'accueil\u00a0».</li><li>Confirmez.</li></ol>`,
  },
  {
    id: "iphone-autre",
    nom: "iPhone et iPad\u00a0: Edge ou un autre navigateur",
    kind: "ios-autre",
    html: `<p>Touchez Partager dans votre navigateur, puis cherchez «\u00a0Sur l'écran d'accueil\u00a0». Si l'option n'y est pas, ouvrez cette page dans Safari et suivez ses étapes.</p>`,
  },
  {
    id: "application",
    nom: "Dans Facebook, Instagram ou une autre application",
    kind: "app",
    html: `<p>Vous lisez cette page dans une application, comme Facebook ou Instagram. Ouvrez-la d'abord dans votre navigateur, depuis le menu de l'application, puis suivez les étapes de votre navigateur.</p>`,
  },
  {
    id: "android",
    nom: "Android\u00a0: Chrome, Edge ou Samsung Internet",
    bouton: "android",
    plus: `<p>Pas de bouton\u00a0? Dans Chrome, touchez ⋮, à droite de la barre d'adresse, puis «\u00a0Installer et créer un raccourci\u00a0», puis «\u00a0Installer\u00a0». Dans Samsung Internet, touchez l'icône + de la barre d'adresse.</p>`,
  },
  {
    id: "android-firefox",
    nom: "Android\u00a0: Firefox",
    kind: "android-firefox",
    html: `<ol><li>Touchez ⋮, puis «\u00a0Plus\u00a0».</li><li>Touchez «\u00a0Ajouter l'application à l'écran d'accueil\u00a0» (ou «\u00a0Ajouter à l'écran d'accueil\u00a0»).</li><li>Touchez «\u00a0Ajouter\u00a0».</li></ol>`,
    plus: `<p>Selon la version de Firefox, l'option peut être ailleurs dans le menu.</p>`,
  },
  {
    id: "android-autre",
    nom: "Android\u00a0: un autre navigateur",
    kind: "android-autre",
    html: `<p>Ouvrez le menu de votre navigateur, puis choisissez l'option qui installe la page ou l'ajoute à l'écran d'accueil.</p>`,
  },
  {
    id: "ordinateur",
    nom: "Ordinateur\u00a0: Chrome ou Edge",
    bouton: "ordinateur",
    plus: `<p>Pas de bouton\u00a0? Dans Chrome, en haut à droite\u00a0: ⋮, puis «\u00a0Caster, enregistrer et partager\u00a0», puis «\u00a0Installer la page en tant qu'appli\u00a0». Dans Edge\u00a0: «\u00a0Paramètres et plus encore\u00a0», puis «\u00a0Autres outils\u00a0», «\u00a0Apps\u00a0» et «\u00a0Installez ce site en tant qu'application\u00a0».</p>`,
  },
  {
    id: "mac-safari",
    nom: "Mac\u00a0: Safari, macOS Sonoma 14 et après",
    kind: "mac-safari",
    pageOnly: true,
    html: `<p>Cliquez sur Partager dans la barre d'outils, puis sur «\u00a0Ajouter au Dock\u00a0», puis sur «\u00a0Ajouter\u00a0».</p>`,
  },
];

/** The kinds that have their steps in the block. */
export const SHOWN = SECTIONS.flatMap((s) => (s.kind && s.html && !s.pageOnly ? [s.kind] : []));

/**
 * The page's part: registers the worker, tells it the app's windows and a phone of the team (`?interne=1` marks it,
 * `?interne=0` unmarks it, with a line to say so), and offers to install the site.
 */
export const PWA_SCRIPT = `${KIND_OF}
const SHOWN=${JSON.stringify(SHOWN)};
const app=matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
const mark=new URLSearchParams(location.search).get("interne");let team=false;
try{if(mark==="1")localStorage.setItem("rundata-interne","1");else if(mark==="0")localStorage.removeItem("rundata-interne");team=localStorage.getItem("rundata-interne")==="1"}catch{}
if(mark==="1"||mark==="0"){const p=document.createElement("div");p.className="horsligne";p.setAttribute("role","status");
p.textContent=team?"Cet appareil est marqué comme celui de l'équipe\u00a0: ses visites ne sont plus comptées.":"Cet appareil est de nouveau compté dans les visites.";document.body.prepend(p)}
if("serviceWorker"in navigator){navigator.serviceWorker.register(${JSON.stringify(SW_PATH)}).catch(()=>{});
if(app||team||mark==="0")navigator.serviceWorker.ready.then((r)=>{const w=navigator.serviceWorker.controller||r.active;if(app)w?.postMessage("app");if(team||mark==="0")w?.postMessage(team?"interne":"externe")}).catch(()=>{})}
const inst=document.getElementById("inst");
if(inst&&!app){let later=0;try{later=Number(localStorage.getItem("inst-plus-tard"))||0}catch{}
if(Date.now()-later>30*864e5){let ask=null;
const show=(k)=>{inst.querySelectorAll("[data-inst]").forEach((e)=>{e.hidden=!e.dataset.inst.split(" ").includes(k)});inst.hidden=false};
const k=kindOf(navigator.userAgent,navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
if(SHOWN.includes(k))show(k);else if(k==="telephone")show("telephone");
addEventListener("beforeinstallprompt",(e)=>{e.preventDefault();ask=e;if(!SHOWN.includes(k))show("bouton")});
addEventListener("appinstalled",()=>{inst.hidden=true});
document.getElementById("inst-go").addEventListener("click",async()=>{if(!ask)return;ask.prompt();await ask.userChoice.catch(()=>{});ask=null;inst.hidden=true});
document.getElementById("inst-later").addEventListener("click",()=>{try{localStorage.setItem("inst-plus-tard",String(Date.now()))}catch{}inst.hidden=true})}}`;

/**
 * The install block, hidden until the page's script knows the browser: its steps, Android's « Installer » button, or
 * on another phone the link alone.
 */
export const INSTALL = `<div class="card inst" id="inst" hidden>
  <h3>rundata.re sur votre écran d'accueil</h3>
  <p>Un geste pour la météo, la vigilance ou le volcan. Les pages déjà vues restent lisibles sans réseau, pratique en randonnée. Pas de store, pas de compte.</p>
  ${SECTIONS.filter((s) => s.kind && SHOWN.includes(s.kind)).map((s) => s.html!.replace(/^<(\w+)/, `<$1 data-inst="${s.kind}"`)).join("\n  ")}
  <p><a href="/application">Autre téléphone ou autre navigateur\u00a0: les étapes pour chacun →</a></p>
  <p class="instb"><button type="button" class="go" id="inst-go" data-inst="bouton">Installer</button><button type="button" class="later" id="inst-later">Plus tard</button></p>
</div>`;

export const PWA_CSS = `.inst{display:grid;gap:.6rem;max-width:44rem;margin-top:.8rem}.inst h3{font-size:1.05rem}.inst ol{padding-left:1.4rem;display:grid;gap:.2rem}
.inst .partage{width:1.1em;height:1.1em;vertical-align:-.15em}
.instb{display:flex;flex-wrap:wrap;gap:.4rem 1rem;align-items:center}.inst[hidden],.inst [hidden]{display:none}
.inst .go,.app-go,.again{font:700 1rem system-ui,sans-serif;background:var(--accent);color:var(--accent-ink);border:0;border-radius:999px;padding:.6rem 1.2rem;cursor:pointer}
.inst .later{font:inherit;background:none;border:0;color:var(--muted);text-decoration:underline;padding:.6rem .2rem;cursor:pointer}
.horsligne{background:var(--hl);color:var(--ink);font-weight:700;padding:.65rem max(16px,env(safe-area-inset-left,0px));text-align:center}
.gardees{display:grid;gap:.4rem;padding-left:1.2rem}
.app-page{max-width:44rem;display:grid;gap:1rem}.app-navs{display:grid;gap:.8rem}.app-nav{display:grid;gap:.6rem}.app-nav summary{cursor:pointer}
.app-nav summary h2{display:inline;font-size:1.1rem}.app-nav ol{padding-left:1.4rem;display:grid;gap:.2rem}.app-nav .partage{width:1.1em;height:1.1em;vertical-align:-.15em}
.app-go[hidden],.app-page [hidden]{display:none}`.replace(/\n/g, "");

/** The offline page's list: the pages kept on this phone, the newest first, read from Cache Storage. */
export const OFFLINE_SCRIPT = `${WHEN}
(async()=>{const ul=document.getElementById("gardees"),none=document.getElementById("rien-garde");
document.getElementById("again").addEventListener("click",()=>location.reload());
try{const c=await caches.open("pages");const rows=[];for(const k of await c.keys()){const r=await c.match(k);if(!r)continue;
rows.push({href:new URL(k.url).pathname,at:Number(r.headers.get("x-copie")),title:new DOMParser().parseFromString(decodeURIComponent(r.headers.get("x-titre")||""),"text/html").documentElement.textContent.replace(/ · (?:974|rundata\.re)$/,"")})}
rows.sort((a,b)=>b.at-a.at);for(const x of rows){const li=document.createElement("li"),a=document.createElement("a");a.href=x.href;a.textContent=x.title;
li.append(a,", copie du "+when(x.at,Date.now()));ul.append(li)}none.hidden=rows.length>0}catch{none.hidden=false}})();`;
