/**
 * What a page's browser tells the statistics, without an identifier (/confidentialite says it), one point each in
 * Analytics Engine (metrics.ts, kind « signal »), sent by navigator.sendBeacon to POST /signal:
 *
 * - « affichage »: how long the page took to show on the visitor's device, from the browser's own timings (TTFB, the
 *   first byte; LCP, the largest paint, 0 where the browser does not give it), once per page view.
 * - « adresse copiée »: the connector's address copied, on /mcp only.
 * - « aide »: the answer to « Cette page vous a aidé ? », oui or non. Nothing kept: the buttons go away after the
 *   click, for this page view only.
 * - « retour »: whether the visitor came before, in one class. The browser's local storage keeps two days, without the
 *   hour: the first visit's and the last one's. Only the class is sent, never the days, once per visit, with the page
 *   the visit came in by (one not opened from another page of the site). The mark is never extended: 13 months after
 *   the first visit, it is wiped and the visit counts as the first (the CNIL's condition for an audience measure
 *   without consent: « ne doit pas être prolongée automatiquement lors des nouvelles visites »).
 *
 * The rest of the page keeps nothing in the browser for these measures. A device of the team, which the page knows by
 * its own mark (`team`, web/pwa.ts: `?interne=1`), says so with each signal, written « interne » like its pages.
 */
import { bodyText } from "../http.js";
import type { Recorder } from "../metrics.js";

export const SIGNAL_PATH = "/signal";

const BODY_MAX = 300;

/** The event names sent by the page, short, and as written in blob3. */
const EVENTS: Record<string, string> = { a: "affichage", c: "adresse copiée", o: "aide", r: "retour" };
const AIDE: Record<string, string> = { oui: "oui", non: "non" };
/** The classes of a visit, as written in blob10. */
export const RETOURS: Record<string, string> = { p: "première", j: "même jour", l: "lendemain", s: "dans la semaine", t: "plus tard" };

/** The mark's key in the browser's local storage. */
const MARK = "venu";

/**
 * The class of a visit and the mark to keep, from the mark kept (`m`, or anything read in its place) and today's day
 * in La Réunion (`j`, « 2026-10-27 »). A mark from more than 13 months ago, from a day after today, or unreadable:
 * wiped, and the visit is the first.
 */
export const VENU = `const venu=(m,j)=>{const d=/^\\d{4}-\\d\\d-\\d\\d$/;let fin=null;
if(m&&d.test(m.p)&&d.test(m.d)){fin=new Date(m.p+"T00:00:00Z");fin.setUTCMonth(fin.getUTCMonth()+13)}
if(!fin||fin.toISOString().slice(0,10)<=j||m.d>j)return["p",{p:j,d:j}];
const n=Math.round((Date.parse(j)-Date.parse(m.d))/864e5);return[n===0?"j":n===1?"l":n<=7?"s":"t",{p:m.p,d:j}]};`;

/**
 * The page's part of the shared script (pages.ts): `sig` for the copy button too. The class leaves only once the mark
 * is written, so that a browser that keeps nothing does not count each of its visits as a first one.
 */
export const SIGNAL_SCRIPT = `const sig=(e,v,x)=>{try{navigator.sendBeacon("${SIGNAL_PATH}",new URLSearchParams({e,v:v||"",p:location.pathname,...(typeof team!=="undefined"&&team?{i:"1"}:{}),...(x||{})}))}catch{}};
let lcp=0;try{new PerformanceObserver((l)=>{for(const e of l.getEntries())lcp=e.startTime}).observe({type:"largest-contentful-paint",buffered:true})}catch{}
let vu=false;const affiche=()=>{if(vu)return;vu=true;try{const n=performance.getEntriesByType("navigation")[0];if(n)sig("a","",{t:Math.round(n.responseStart),l:Math.round(lcp)})}catch{}};
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")affiche()});addEventListener("pagehide",affiche);
document.querySelectorAll("[data-aide]").forEach((b)=>b.addEventListener("click",()=>{const a=b.closest(".aide");a.querySelectorAll("button").forEach((x)=>{x.disabled=true});
a.querySelector(".q").hidden=true;a.querySelector("[data-apres="+b.dataset.aide+"]").hidden=false;sig("o",b.dataset.aide)}));
${VENU}
try{let r="";try{r=new URL(document.referrer).host}catch{}if(r!==location.host){let m=null;try{m=JSON.parse(localStorage.getItem("${MARK}"))}catch{}
const[c,n]=venu(m,new Date(Date.now()+144e5).toISOString().slice(0,10));localStorage.setItem("${MARK}",JSON.stringify(n));sig("r",c)}}catch{}`;

// `.aide p` sets a display, which beats the browser's own rule for [hidden]: the question and both answers then showed
// at once. Hidden stays hidden (0,2,0 beats 0,1,1).
export const AIDE_CSS = `.aide{padding-bottom:1rem}
.aide p{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem;font-weight:600;margin:0}
.aide [hidden]{display:none}
.aide button{font:700 .95rem system-ui,sans-serif;background:var(--surface-2);color:var(--ink);border:1px solid var(--border);border-radius:10px;padding:.45rem 1.1rem;cursor:pointer}`.replace(/\n/g, "");

/** The question, just above the feedback form (whose #avis the « non » leads to); shown only with a script. */
export function aide(): string {
  return `<aside class="aide wrap" aria-label="Cette page vous a aidé ?" data-js hidden>
<p class="q">Cette page vous a aidé ? <button type="button" data-aide="oui">Oui</button> <button type="button" data-aide="non">Non</button></p>
<p data-apres="oui" role="status" hidden>Merci !</p>
<p data-apres="non" role="status" hidden>Merci. Dites-nous ce qui vous a manqué : <a href="#avis">laisser un avis</a></p>
</aside>`;
}

/** A signal as read from the page: the event, the page, its value, for « affichage » its two times in ms, and a team's device. */
export interface Signal {
  event: string;
  path: string;
  value: string;
  ttfb?: number;
  lcp?: number;
  team?: true;
}

const PATH = /^\/(?!\/)[\w\-./%]{0,200}$/;
// A time in ms from the browser: a whole number under ten minutes, else none.
const ms = (s: string | null) => (s && /^\d{1,6}$/.test(s) && Number(s) <= 600_000 ? Number(s) : undefined);

/** The body sent by the page, read strictly: anything else is no signal. */
export function lire(body: string): Signal | undefined {
  const f = new URLSearchParams(body);
  const event = EVENTS[f.get("e") ?? ""];
  const path = f.get("p") ?? "";
  const v = f.get("v") ?? "";
  if (!event || !PATH.test(path)) return undefined;
  const s = read(f, event, path, v);
  return s && f.get("i") === "1" ? { ...s, team: true } : s;
}

function read(f: URLSearchParams, event: string, path: string, v: string): Signal | undefined {
  switch (f.get("e")) {
    case "a":
      return v ? undefined : { event, path, value: "", ttfb: ms(f.get("t")), lcp: ms(f.get("l")) };
    case "c":
      return path === "/mcp" && !v ? { event, path, value: "" } : undefined;
    case "o":
      return AIDE[v] ? { event, path, value: AIDE[v] } : undefined;
    default:
      return RETOURS[v] ? { event, path, value: RETOURS[v] } : undefined;
  }
}

/** POST /signal: one point for a signal of this site's pages; always 204, whatever was sent. */
export async function signal(request: Request, record: Recorder): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
  const done = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  // Sent by a page of this site, not by another site's.
  const site = request.headers.get("sec-fetch-site");
  const from = request.headers.get("origin");
  if ((site && site !== "same-origin") || (from && from !== new URL(request.url).origin)) return done;
  const body = await bodyText(request, BODY_MAX);
  const s = body === undefined ? undefined : lire(body);
  if (s) record({ kind: "signal", name: s.path, detail: s.event, value: s.value, ok: true, ms: s.ttfb, lcp: s.lcp, ...(s.team && { team: true }) });
  return done;
}
