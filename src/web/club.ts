/**
 * The clubs' own space (marketing/espace-club-verifie.md §3 and §6, words as written), on plain HTML like the other
 * forms of /associations, so it works without a script:
 * - GET /associations/club: screen 1, « Le nom de votre club ou association », and with ?q= the clubs found;
 * - GET /associations/club/demande?club=<id>: screen 2, the official address read now at its source, masked here;
 *   POST: the link e-mailed to it, then « C'est parti. »;
 * - /associations/club/acces/<secret>: screen 3, the e-mailed link. Opening it changes nothing (a mail scanner opens
 *   the links it sees): its button « Ouvrir mon espace » does, then leads to the personal link;
 * - /associations/club/<secret>: « Mon agenda », behind the personal link.
 * Against robots, the same as the other forms on the one that sends something: Turnstile, a hidden field, no form
 * posted from another site, and the daily caps of clubs/espace.ts.
 *
 * Nothing answers before CLUB_EN_LIGNE (web/club-drapeau.ts).
 */
import * as avis from "../avis.js";
import * as espace from "../clubs/espace.js";
import type { Cache } from "../cache.js";
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { esc } from "./map.js";
import { layout } from "./pages.js";
import { hp, human, PROPOSER_PATH, received, SECRET_HEADERS, TURNSTILE_SCRIPT, widget } from "./propositions.js";

export { CLUB_EN_LIGNE, enLigne, ouvrir } from "./club-drapeau.js";

export const CLUB_PATH = "/associations/club";
export const DEMANDE_PATH = "/associations/club/demande";
/** The e-mailed link, followed by its secret. */
export const ACCES_PATH = "/associations/club/acces/";
/** The personal link: CLUB_PATH, a slash, its secret. */
export const ESPACE_PATH = `${CLUB_PATH}/`;

const PARENT = { name: "Clubs et associations", path: "/associations" };
const Q_MAX = 80;

const TITLE = "Votre espace club ou association · rundata.re";
const META = "Clubs et associations de La Réunion : ouvrez votre espace avec l'adresse e-mail officielle de votre club, puis publiez vos dates.";

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

function bandeau(titre: string, lead?: string): string {
  return `${crumbBar(titre, PARENT)}
<div class="wrap intro solo"><div class="pitch">
  <p class="pill"><span class="dot"></span>Clubs et associations</p>
  <h1>${esc(titre)}</h1>
  ${lead ? `<p class="lead">${esc(lead)}</p>` : ""}
</div></div>`;
}

/** A page of the space; `secret`: its address holds a secret, never sent to another site nor indexed. */
function page(origin: string, titre: string, body: string, alerte?: Alerte, secret = false, lead?: string): string {
  return layout(
    origin,
    { title: TITLE, description: META, path: CLUB_PATH, jsonld: secret ? [] : [crumbs(origin, "Votre espace", CLUB_PATH, PARENT), webPage(origin, CLUB_PATH, TITLE, META, null)], alerte, sansAvis: true, sansPartage: secret, noindex: true, ...(secret && { referrer: "no-referrer" }) },
    bandeau(titre, lead),
    body,
  );
}

const section = (...p: string[]) => `<section class="card fo">
  ${p.join("\n  ")}
</section>`;

const proposer = `<a class="btn sun" href="${PROPOSER_PATH}?ref=club">Proposer un événement</a>`;
const PAS_TROUVE = `<p>Nous ne trouvons pas ce club dans les annuaires officiels. Vous pouvez proposer vos dates avec le formulaire habituel : elles sont relues avant de s'afficher.</p>
  <p>${proposer}</p>`;

// ---------------------------------------------------------------- screen 1

function recherche(clubs: readonly espace.ClubVu[], q: string): string {
  const found = q ? espace.chercher(clubs, q) : [];
  const typed = q.replace(/\s/g, "").length >= espace.RECHERCHE_MIN;
  const results = !typed
    ? ""
    : found.length
      ? `<ul class="clubs-trouves">
    ${found.map((c) => `<li><a href="${DEMANDE_PATH}?club=${c.id}" rel="nofollow">${esc(c.nom)}<span>${esc([c.commune, c.activite].filter(Boolean).join(" · "))}</span></a></li>`).join("\n    ")}
  </ul>`
      : PAS_TROUVE;
  return `<form class="card fo" method="get" action="${CLUB_PATH}" role="search">
  <div class="f"><label for="c-q">Le nom de votre club ou association</label>
    <input id="c-q" name="q" value="${esc(q)}" list="c-clubs" maxlength="${Q_MAX}" minlength="${espace.RECHERCHE_MIN}" autocomplete="off" required aria-describedby="c-aide">
    <p class="aide" id="c-aide">Tapez les premières lettres : nous cherchons dans les annuaires officiels des clubs et associations.</p></div>
  <datalist id="c-clubs">${clubs.map((c) => `<option value="${esc(c.nom)}">${esc([c.commune, c.activite].filter(Boolean).join(" · "))}</option>`).join("")}</datalist>
  <button type="submit">Chercher</button>
  ${results}
</form>`;
}

/** GET /associations/club: screen 1, and the clubs found for ?q=. */
export async function trouver(request: Request, alerte?: Alerte): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, Q_MAX);
  const clubs = await espace.proposes().catch(() => undefined);
  const body = clubs ? recherche(clubs, q) : section(`<p>${esc(LISTE_INDISPONIBLE)}</p>`);
  return new Response(page(url.origin, "Votre espace", body, alerte), { status: clubs ? 200 : 503, headers: HTML_HEADERS });
}

// ---------------------------------------------------------------- screen 2

/** Screen 1, when the list of the clubs cannot be read. */
const LISTE_INDISPONIBLE = "La liste des clubs ne répond pas pour l'instant. Réessayez dans quelques minutes ; si ça dure, écrivez-nous à contact@rundata.re.";
/** Screen 2 and the send, when the address cannot be read or the link not sent. */
const INDISPONIBLE = "La vérification de l'adresse ne répond pas pour l'instant. Rien n'a été envoyé. Réessayez dans quelques minutes ; si ça dure, écrivez-nous à contact@rundata.re.";
/** Past a daily cap: whose, said truly. */
const LIMITES: Record<espace.Limite, string> = {
  limite: "Trop de liens ont été demandés aujourd'hui pour ce club. Rien n'a été envoyé : utilisez le dernier e-mail reçu, ou réessayez demain.",
  "limite-connexion": "Trop de liens ont été demandés depuis cette connexion aujourd'hui. Rien n'a été envoyé : utilisez le dernier e-mail reçu, ou réessayez demain.",
  "limite-totale": "Trop de liens ont été demandés aujourd'hui. Rien n'a été envoyé : utilisez le dernier e-mail reçu, ou réessayez demain.",
};

/** « Nous envoyons un lien à l'adresse que … : », by level. */
function quelleAdresse(c: espace.Club): string {
  const federation = espace.FEDERATIONS[c.source];
  if (federation) return `Nous envoyons un lien à l'adresse que ${federation} a créée pour votre club :`;
  return `Nous envoyons un lien à l'adresse que nous avons vérifiée avec vous le ${espace.jourMois(c.adresse_le ?? 0)} :`;
}

/** « Ce n'est plus la bonne adresse ? », by level. */
function plusLaBonne(c: espace.Club): string {
  const federation = espace.FEDERATIONS[c.source];
  const texte = federation
    ? `<p>Pour votre sécurité, nous n'utilisons que l'adresse donnée par ${esc(federation)}. Faites-la corriger par ${esc(federation)}, puis revenez.</p>`
    : `<p>Écrivez-nous depuis <a href="/associations">la page Associations</a> : nous vérifions la nouvelle adresse avec vous. En attendant, vous pouvez proposer vos dates avec le formulaire habituel.</p>
    <p>${proposer}</p>`;
  return `<details class="note"><summary>Ce n'est plus la bonne adresse ?</summary>
    ${texte}
  </details>`;
}

/** The source gives no address now: said, with the way round. */
function sansAdresse(c: espace.Club): string {
  const federation = espace.FEDERATIONS[c.source];
  return section(
    federation
      ? `<p>La page de votre club chez ${esc(federation)} ne donne plus l'adresse que la fédération a créée pour lui. Rien n'a été envoyé. Faites-la corriger par ${esc(federation)}, puis revenez.</p>`
      : `<p>Nous n'avons plus d'adresse vérifiée pour ce club. Rien n'a été envoyé. Écrivez-nous depuis <a href="/associations">la page Associations</a> : nous la vérifions avec vous.</p>`,
    `<p>En attendant, vous pouvez proposer vos dates avec le formulaire habituel : elles sont relues avant de s'afficher.</p>`,
    `<p>${proposer}</p>`,
  );
}

function ecran2(c: espace.Club, masque: string): string {
  return `<section class="card fo" aria-labelledby="h-club">
  <h2 id="h-club">${esc([c.nom, c.commune].filter(Boolean).join(" · "))}</h2>
  <p>${esc(quelleAdresse(c))}</p>
  <p class="adresse"><b>${esc(masque)}</b></p>
  <form class="fo" method="post" action="${DEMANDE_PATH}">
    <input type="hidden" name="club" value="${c.id}">
    ${hp}
    ${widget("club")}
    <button type="submit">Envoyer le lien</button>
  </form>
  ${plusLaBonne(c)}
</section>${TURNSTILE_SCRIPT}`;
}

const apresEnvoi = (c: espace.Club, masque: string) =>
  section(
    `<h2>C'est parti.</h2>`,
    `<p>Ouvrez l'e-mail envoyé à ${esc(masque)} et touchez le lien. Il vaut 48 heures.</p>`,
    `<p class="note">Rien reçu après quelques minutes ? Regardez dans les indésirables, ou <a href="${DEMANDE_PATH}?club=${c.id}" rel="nofollow">renvoyez le lien</a>.</p>`,
  );

/**
 * GET /associations/club/demande?club=<id>: screen 2, the address read at its source and masked, the mask kept a few
 * minutes in `cache` (clubs/espace.ts `apercu`). POST: the link e-mailed to it, the address read again.
 */
export async function demande(request: Request, cache: Cache, now = new Date(), alerte?: Alerte): Promise<Response> {
  const url = new URL(request.url);
  const html = (titre: string, body: string, status = 200) => new Response(page(url.origin, titre, body, alerte), { status, headers: HTML_HEADERS });
  let f: URLSearchParams = url.searchParams;
  const post = request.method === "POST";
  if (post) {
    const r = await received(request, "Cette page");
    if (r instanceof Response) return r;
    f = r;
  } else if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD, POST" } });
  }
  const id = Number(f.get("club"));
  const c = await espace.club(id).catch(() => undefined);
  if (!c) return html("Votre espace", section(PAS_TROUVE), 404);
  if (post) {
    // Filled in by robots only, or not a person: nothing read, nothing sent.
    if (f.get("site_web") || !(await human(f, avis.adresseOf(request.headers), { hostname: url.hostname, action: "club" }))) return html("Votre espace", section(`<p>${esc(INDISPONIBLE)}</p>`), 503);
    const d = await espace.demander(c, `${url.origin}${ACCES_PATH}`, avis.adresseOf(request.headers), now);
    if (d.issue === "ok") return html("Votre espace", apresEnvoi(c, d.masque));
    if (d.issue === "absente") return html("Votre espace", sansAdresse(c), 422);
    if (d.issue in LIMITES) return html("Votre espace", section(`<p>${esc(LIMITES[d.issue as espace.Limite])}</p>`), 429);
    return html("Votre espace", section(`<p>${esc(INDISPONIBLE)}</p>`), 503);
  }
  const a = await espace.apercu(c, cache);
  if ("masque" in a) return html("Votre espace", ecran2(c, a.masque));
  if (a.issue === "absente") return html("Votre espace", sansAdresse(c), 422);
  return html("Votre espace", section(`<p>${esc(INDISPONIBLE)}</p>`), 503);
}

// ---------------------------------------------------------------- screen 3 and « Mon agenda »

const PLUS_VALABLE = section(`<p>Ce lien n'est plus valable.</p>`, `<p><a class="btn sun" href="${CLUB_PATH}">Recevoir un nouveau lien</a></p>`);

/**
 * GET /associations/club/acces/<secret>: the club, the agreement the first time, and « Ouvrir mon espace »; never a
 * change. POST: the space opened, then its personal link (303).
 */
export async function acces(request: Request, now = new Date(), alerte?: Alerte): Promise<Response> {
  const url = new URL(request.url);
  const secret = url.pathname.slice(ACCES_PATH.length).replace(/\/$/, "");
  const html = (titre: string, body: string, status = 200) => new Response(page(url.origin, titre, body, alerte, true), { status, headers: SECRET_HEADERS });
  if (request.method === "POST") {
    const f = await received(request, "Cette page");
    if (f instanceof Response) return f;
    const personnel = await espace.ouvrir(secret, now).catch(() => undefined);
    if (!personnel) return html("Votre espace", PLUS_VALABLE, 410);
    return new Response(null, { status: 303, headers: { location: `${ESPACE_PATH}${personnel}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD, POST" } });
  const l = await espace.lien(secret, now).catch(() => undefined);
  if (!l) return html("Votre espace", PLUS_VALABLE, 404);
  const accord = l.premiere
    ? `<p>En ouvrant votre espace, vous confirmez agir pour ce club ou cette association. Les dates que vous publiez sont ouvertes au public, et publiées sous Licence Ouverte 2.0 : tout le monde peut les réutiliser, en citant votre club.</p>`
    : "";
  return html(l.club.nom, `<section class="card fo">
  ${accord}
  <form class="fo" method="post" action="${esc(`${ACCES_PATH}${secret}`)}"><button type="submit">Ouvrir mon espace</button></form>
</section>`);
}

/** GET /associations/club/<secret>: « Mon agenda ». */
export async function monAgenda(request: Request, now = new Date(), alerte?: Alerte): Promise<Response> {
  const url = new URL(request.url);
  const secret = url.pathname.slice(ESPACE_PATH.length).replace(/\/$/, "");
  const html = (titre: string, body: string, status = 200, lead?: string) => new Response(page(url.origin, titre, body, alerte, true, lead), { status, headers: SECRET_HEADERS });
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  const e = await espace.espace(secret, now).catch(() => undefined);
  if (!e) return html("Votre espace", PLUS_VALABLE, 404);
  const garder = e.nouveau
    ? `<p class="msg ok vu" role="status">Gardez cette page : ajoutez-la à vos favoris ou à l'écran d'accueil de votre téléphone. Pour revenir sans elle, demandez un nouveau lien depuis la page Associations.</p>`
    : "";
  return html(
    e.club.nom,
    `<section class="card fo" aria-labelledby="h-dates">
  ${garder}
  <h2 id="h-dates">Vos prochaines dates</h2>
  <p class="note">Aucune date pour l'instant.</p>
</section>`,
    200,
    e.club.verifie_le ? `Vérifié le ${espace.jourMois(e.club.verifie_le)}` : undefined,
  );
}
