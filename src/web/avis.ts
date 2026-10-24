/**
 * The feedback form at the bottom of every page (layout in pages.ts) and its answer, POST /avis: a plain form, so it
 * works without a script. The row goes where the tool donner_avis writes (src/avis.ts), with canal « site ». The
 * browser is sent back to its page, where #avis-merci (or #avis-limite, #avis-erreur) shows the outcome by CSS alone.
 * Against robots: a field people do not see (filled = thanked and dropped), a length cap, the same hourly cap as the
 * tool, and no form posted from another site.
 */
import * as avis from "../avis.js";
import { esc } from "./map.js";

const BODY_MAX = 8192;
const OPTIONS: [avis.TypeAvis, string][] = [["manque", "Une donnée qui manque"], ["erreur", "Une erreur"], ["suggestion", "Une idée"], ["bravo", "Bravo"]];

export const AVIS_CSS = `.avis{padding-bottom:clamp(2.5rem,6vw,4rem)}
.avis form{max-width:44rem}
.avis h2{font-size:1.25rem}
.avis label{font-weight:600;font-size:.92rem}
.avis textarea,.avis select{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:.6rem .75rem;width:100%}
.avis textarea{min-height:5.5rem;resize:vertical}
.avis .row{display:flex;flex-wrap:wrap;gap:.8rem;align-items:end}
.avis .row label{display:grid;gap:.3rem;flex:1 1 12rem}
.avis button{font:700 1rem system-ui,sans-serif;background:var(--accent);color:var(--accent-ink);border:0;border-radius:12px;padding:.7rem 1.3rem;cursor:pointer}
.avis .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.avis .msg{display:none;font-weight:700;border-radius:10px;padding:.6rem .8rem;background:var(--warn-bg);color:var(--lave)}
.avis .msg.ok{background:var(--surface-2);color:var(--ink);border-left:4px solid var(--ren)}
.avis .msg:target{display:block}`.replace(/\n/g, "");

/** The form, with the page it is on. */
export function avisForm(path: string): string {
  return `<aside class="avis wrap" id="avis" aria-labelledby="h-avis">
<form class="card" method="post" action="/avis">
  <h2 id="h-avis">Un avis, une donnée qui manque ?</h2>
  <p class="msg ok" id="avis-merci" role="status">Merci ! Votre avis est bien arrivé à rundata.re : il sera lu.</p>
  <p class="msg" id="avis-limite" role="status">Beaucoup d'avis sont partis d'ici dans l'heure : réessayez un peu plus tard.</p>
  <p class="msg" id="avis-erreur" role="status">L'avis n'a pas pu être enregistré (vide ou trop long ?). Réessayez, ou écrivez à contact@rundata.re.</p>
  <label for="avis-m">Une donnée fausse ou absente, un lieu oublié, une idée : dites-le.</label>
  <textarea id="avis-m" name="message" rows="3" minlength="3" maxlength="${avis.MESSAGE_MAX}" required></textarea>
  <div class="row">
    <label>C'est plutôt <select name="type"><option value="">au choix</option>${OPTIONS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("")}</select></label>
    <button type="submit">Envoyer</button>
  </div>
  <input type="hidden" name="page" value="${esc(path)}">
  <div class="hp" aria-hidden="true"><label>Ne pas remplir <input name="site_web" tabindex="-1" autocomplete="off"></label></div>
  <p class="note">Sans compte, sans adresse IP gardée ; n'y mettez rien de personnel. <a href="/confidentialite#avis-donnees">Ce qui est gardé</a>.</p>
</form>
</aside>`;
}

/** A path of this site to send the browser back to; the home page otherwise. */
function pageOf(s: string | null): string {
  return s && s.length <= 200 && /^\/(?!\/)[\w\-./%]*$/.test(s) ? s : "/";
}

/** POST /avis: writes the form's feedback and sends the browser back to its page. */
export async function avisPost(request: Request, now = new Date()): Promise<Response> {
  const url = new URL(request.url);
  const back = (page: string, outcome: "merci" | "limite" | "erreur") =>
    new Response(null, { status: 303, headers: { location: `${url.origin}${page}#avis-${outcome}`, "cache-control": "no-store" } });
  // A link or a robot opening /avis: not a failed feedback, a method this address does not take.
  if (request.method !== "POST") {
    return new Response("Le formulaire d'avis est en bas de chaque page de https://rundata.re/ ; cette adresse ne reçoit que ses envois.", {
      status: 405,
      headers: { allow: "POST", "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const from = request.headers.get("origin");
  if (from && from !== url.origin) return new Response("Formulaire d'un autre site refusé.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return back("/", "erreur");
  const raw = await request.text();
  if (raw.length > BODY_MAX) return back("/", "erreur");
  const f = new URLSearchParams(raw);
  const page = pageOf(f.get("page"));
  // Filled in by robots only: thanked, not kept.
  if (f.get("site_web")) return back(page, "merci");
  const given = (f.get("message") ?? "").replace(/\r\n/g, "\n");
  const message = given.length <= avis.MESSAGE_MAX ? avis.nettoie(given, avis.MESSAGE_MAX) : undefined;
  if (!message || message.length < 3) return back(page, "erreur");
  const type = (avis.TYPES as readonly string[]).includes(f.get("type") ?? "") ? (f.get("type") as avis.TypeAvis) : undefined;
  const issue = await avis.enregistrer(
    { canal: "site", type, message, page, client: avis.clientOf(request.headers.get("user-agent") ?? "") },
    avis.adresseOf(request.headers),
    now,
  );
  return back(page, issue === "ok" ? "merci" : issue === "limite" ? "limite" : "erreur");
}
