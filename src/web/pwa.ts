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

const hash = (s: string) => {
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
if(SHELL.includes(u.pathname))e.respondWith(caches.match(u.pathname,{cacheName:SHELL_CACHE}).then((hit)=>hit||fetch(r)))});
`;
}

/**
 * The page's part: registers the worker, tells it the app's windows and a phone of the team (`?interne=1` marks it,
 * `?interne=0` unmarks it, with a line to say so), and offers to install the site.
 */
export const PWA_SCRIPT = `const app=matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
const mark=new URLSearchParams(location.search).get("interne");let team=false;
try{if(mark==="1")localStorage.setItem("rundata-interne","1");else if(mark==="0")localStorage.removeItem("rundata-interne");team=localStorage.getItem("rundata-interne")==="1"}catch{}
if(mark==="1"||mark==="0"){const p=document.createElement("div");p.className="horsligne";p.setAttribute("role","status");
p.textContent=team?"Cet appareil est marqué comme celui de l'équipe\u00a0: ses visites ne sont plus comptées.":"Cet appareil est de nouveau compté dans les visites.";document.body.prepend(p)}
if("serviceWorker"in navigator){navigator.serviceWorker.register(${JSON.stringify(SW_PATH)}).catch(()=>{});
if(app||team||mark==="0")navigator.serviceWorker.ready.then((r)=>{const w=navigator.serviceWorker.controller||r.active;if(app)w?.postMessage("app");if(team||mark==="0")w?.postMessage(team?"interne":"externe")}).catch(()=>{})}
const inst=document.getElementById("inst");
if(inst&&!app){let later=0;try{later=Number(localStorage.getItem("inst-plus-tard"))||0}catch{}
if(Date.now()-later>30*864e5){let ask=null;const ua=navigator.userAgent;
const show=(k)=>{inst.querySelectorAll("[data-inst]").forEach((e)=>{e.hidden=!e.dataset.inst.split(" ").includes(k)});inst.hidden=false};
if(/iPhone|iPad|iPod/.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1))show(/CriOS|FxiOS|EdgiOS|OPiOS|GSA\\/|FBAN|FBAV|Instagram/.test(ua)?"safari":"ios");
else addEventListener("beforeinstallprompt",(e)=>{e.preventDefault();ask=e;show("android")});
addEventListener("appinstalled",()=>{inst.hidden=true});
document.getElementById("inst-go").addEventListener("click",async()=>{if(!ask)return;ask.prompt();await ask.userChoice.catch(()=>{});ask=null;inst.hidden=true});
document.getElementById("inst-later").addEventListener("click",()=>{try{localStorage.setItem("inst-plus-tard",String(Date.now()))}catch{}inst.hidden=true})}}`;

/** The install block, hidden until the page's script knows the phone (Android's prompt, or an iPhone). */
export const INSTALL = `<div class="card inst" id="inst" hidden>
  <h3>rundata.re sur votre écran d'accueil</h3>
  <p>Un geste pour la météo, la vigilance ou le volcan. Les pages déjà vues restent lisibles sans réseau, pratique en randonnée. <span data-inst="android">Pas de store, pas de compte.</span><span data-inst="ios safari">Pas d'App Store, pas de compte.</span></p>
  <ol data-inst="ios"><li>Touchez Partager <svg class="partage" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4M8 10H6v11h12V10h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> (sur les iPhone récents, il est dans le menu « ⋯ »).</li><li>Choisissez « Sur l'écran d'accueil » (faites défiler si besoin).</li><li>Touchez « Ajouter ».</li></ol>
  <p data-inst="safari">Pour l'ajouter à l'écran d'accueil, ouvrez cette page dans Safari.</p>
  <p class="instb"><button type="button" class="go" id="inst-go" data-inst="android">Installer</button><button type="button" class="later" id="inst-later">Plus tard</button></p>
</div>`;

export const PWA_CSS = `.inst{display:grid;gap:.6rem;max-width:44rem;margin-top:.8rem}.inst h3{font-size:1.05rem}.inst ol{padding-left:1.4rem;display:grid;gap:.2rem}
.inst .partage{width:1.1em;height:1.1em;vertical-align:-.15em}
.instb{display:flex;flex-wrap:wrap;gap:.4rem 1rem;align-items:center}.inst[hidden],.inst [hidden]{display:none}
.inst .go,.again{font:700 1rem system-ui,sans-serif;background:var(--accent);color:var(--accent-ink);border:0;border-radius:999px;padding:.6rem 1.2rem;cursor:pointer}
.inst .later{font:inherit;background:none;border:0;color:var(--muted);text-decoration:underline;padding:.6rem .2rem;cursor:pointer}
.horsligne{background:var(--hl);color:var(--ink);font-weight:700;padding:.65rem max(16px,env(safe-area-inset-left,0px));text-align:center}
.gardees{display:grid;gap:.4rem;padding-left:1.2rem}`.replace(/\n/g, "");

/** The offline page's list: the pages kept on this phone, the newest first, read from Cache Storage. */
export const OFFLINE_SCRIPT = `${WHEN}
(async()=>{const ul=document.getElementById("gardees"),none=document.getElementById("rien-garde");
document.getElementById("again").addEventListener("click",()=>location.reload());
try{const c=await caches.open("pages");const rows=[];for(const k of await c.keys()){const r=await c.match(k);if(!r)continue;
rows.push({href:new URL(k.url).pathname,at:Number(r.headers.get("x-copie")),title:new DOMParser().parseFromString(decodeURIComponent(r.headers.get("x-titre")||""),"text/html").documentElement.textContent.replace(/ · (?:974|rundata\.re)$/,"")})}
rows.sort((a,b)=>b.at-a.at);for(const x of rows){const li=document.createElement("li"),a=document.createElement("a");a.href=x.href;a.textContent=x.title;
li.append(a,", copie du "+when(x.at,Date.now()));ul.append(li)}none.hidden=rows.length>0}catch{none.hidden=false}})();`;
