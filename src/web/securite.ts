/**
 * The security headers of the site's pages, and where browsers report what they block.
 *
 * - No page of rundata.re is ever shown in another site's frame (`frame-ancestors 'none'`, and X-Frame-Options for
 *   the older browsers): applied at once. None of our own pages is framed by another of ours; the only frames are
 *   Cloudflare's check on the forms and Waze's map on /trafic, which are theirs.
 * - A Content-Security-Policy, blocking since a day of reports (26-27/10) named none of the site's own scripts: the
 *   browsers block what it does not allow and report it to POST /csp-rapport. Its scripts are this site's, Cloudflare's
 *   Turnstile, Cloudflare's Web Analytics beacon, and the inline ones of the page, each allowed by its SHA-256 (computed
 *   from the page itself, so that a new script is never forgotten). The beacon is inserted by Cloudflare into the pages
 *   and is part of the site's figures, beside its own (Analytics Engine); it sends them to /cdn-cgi/rum, on this site
 *   (`connect-src 'self'`). Styles stay inline (the pages have `style` attributes); the frames are Turnstile's and
 *   Waze's. Not allowed, so blocked: what extensions or in-app browsers add to the page.
 * - A Permissions-Policy, applied at once: no page and no frame may use the camera, the microphone, payment or USB
 *   devices, which the site never asks for. The position stays allowed for the site's own pages (the button « Autour
 *   de moi » of /defibrillateurs), and for no frame. The other features keep the browser's default: the clipboard of
 *   the copy buttons, the fullscreen of Waze's map.
 */
import { bodyText } from "../http.js";

export const CSP_RAPPORT = "/csp-rapport";

/**
 * Whom to tell of a security flaw (RFC 9116), served at SECURITY_TXT. Its Expires is written here, less than a year
 * ahead as the RFC recommends: a test fails 30 days before it, so that it is moved forward before it passes.
 */
export const SECURITY_TXT = "/.well-known/security.txt";
export const SECURITY_EXPIRES = "2027-09-01T00:00:00.000Z";
export const SECURITY_TEXT = [
  "Contact: mailto:contact@rundata.re",
  `Expires: ${SECURITY_EXPIRES}`,
  "Preferred-Languages: fr, en",
  `Canonical: https://rundata.re${SECURITY_TXT}`,
  "",
].join("\n");

/** What no page and no frame may use, and the position, for the site's own pages only. */
export const PERMISSIONS = "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)";

/** Applied at once on every page; on a page whose HTML is known, `enTetes` gives the whole policy instead. */
export const CADRE: Record<string, string> = { "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY", "permissions-policy": PERMISSIONS };

const TURNSTILE = "https://challenges.cloudflare.com";
const WAZE = "https://embed.waze.com";
/** Cloudflare's Web Analytics beacon, which Cloudflare inserts into the pages. */
const WEB_ANALYTICS = "https://static.cloudflareinsights.com";

/** The policy, with the hashes of the page's inline scripts. */
export function politique(hashes: readonly string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${TURNSTILE} ${WEB_ANALYTICS}${hashes.map((h) => ` 'sha256-${h}'`).join("")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    `frame-src ${TURNSTILE} ${WAZE}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${CSP_RAPPORT}`,
  ].join("; ");
}

/**
 * The text of each inline script that runs: not one with `src`, nor a data block (JSON-LD). Read by position, not by
 * a pattern: the text hashed must be exactly the browser's, between `<script…>` and `</script`.
 */
export function scriptsEnLigne(html: string): string[] {
  const out: string[] = [];
  const lower = html.toLowerCase();
  for (let at = lower.indexOf("<script"); at >= 0; at = lower.indexOf("<script", at + 1)) {
    const open = lower.indexOf(">", at);
    if (open < 0) break;
    const close = lower.indexOf("</script", open);
    if (close < 0) break;
    const tag = lower.slice(at, open);
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/.exec(tag)?.[1];
    const runs = !type || type === "module" || /^(?:text|application)\/(?:java|ecma)script$/.test(type);
    if (runs && !/\bsrc\s*=/.test(tag)) out.push(html.slice(open + 1, close));
    at = close;
  }
  return out;
}

// The inline scripts are the code's constants: each hashed once per isolate. Bounded, in case one ever carries data.
const known = new Map<string, string>();
const KNOWN_MAX = 200;

async function sha256(text: string): Promise<string> {
  let h = known.get(text);
  if (h) return h;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  h = btoa(String.fromCharCode(...d));
  if (known.size >= KNOWN_MAX) known.clear();
  known.set(text, h);
  return h;
}

/** The headers of a page, from its final HTML. */
export async function enTetes(html: string): Promise<Record<string, string>> {
  const hashes = [...new Set(await Promise.all(scriptsEnLigne(html).map(sha256)))];
  return { ...CADRE, "content-security-policy": politique(hashes) };
}

// ---------------------------------------------------------------- The reports

const RAPPORT_MAX = 8192;
// One line per directive and blocked host, per isolate and per hour: a flood of reports never fills the logs.
const UNE_HEURE = 3600_000;
const vus = new Map<string, number>();
const VUS_MAX = 500;

// The links e-mailed to the clubs carry their secret in the path: never written down.
const SECRET = /^(\/associations\/(?:proposition|connexion)\/).+$/;

const court = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, n) : "");

/** « inline », « eval », « data », or the host of what was blocked. */
function bloque(v: string): string {
  if (!v || /^(?:inline|eval|wasm-eval|trusted-types-[\w-]+)$/.test(v)) return v || "?";
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : u.protocol.replace(/:$/, "");
  } catch {
    return court(v, 40);
  }
}

function page(v: string): string {
  try {
    return new URL(v).pathname.replace(SECRET, "$1…").slice(0, 120);
  } catch {
    return "?";
  }
}

/** POST /csp-rapport: one report of a browser, said in one short line of the Worker's log; nothing kept. */
export async function rapport(request: Request, now = Date.now()): Promise<Response> {
  if (request.method !== "POST") return new Response("Reçoit seulement les rapports CSP des navigateurs.", { status: 405, headers: { allow: "POST", "content-type": "text/plain; charset=utf-8" } });
  const text = await bodyText(request, RAPPORT_MAX);
  let r: Record<string, unknown> = {};
  try {
    const body = text === undefined ? undefined : JSON.parse(text);
    const inner = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>)["csp-report"] : undefined;
    if (inner && typeof inner === "object") r = inner as Record<string, unknown>;
  } catch {}
  const directive = court(r["effective-directive"] || r["violated-directive"], 40).split(" ")[0];
  if (!directive) return new Response(null, { status: 204 });
  const what = bloque(court(r["blocked-uri"], 300));
  const key = `${directive} ${what}`;
  const last = vus.get(key);
  if (last === undefined || now - last >= UNE_HEURE) {
    if (vus.size >= VUS_MAX) vus.clear();
    vus.set(key, now);
    const where = court(r["source-file"], 200) ? ` (${bloque(court(r["source-file"], 200))}${typeof r["line-number"] === "number" ? `, ligne ${r["line-number"]}` : ""})` : "";
    const sample = court(r["script-sample"], 40);
    // « report » comes only from a page still under the report-only policy (a copy kept by a browser or a cache).
    const said = r["disposition"] === "report" ? `csp (observation) : ${directive} bloquerait` : `csp : ${directive} a bloqué`;
    console.warn(`${said} ${what} sur ${page(court(r["document-uri"], 300))}${where}${sample ? ` « ${sample} »` : ""}`);
  }
  return new Response(null, { status: 204 });
}
