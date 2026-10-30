/**
 * « Relier votre plateforme » (marketing/relier-plateforme-helloasso.md, words as written), on plain HTML like the
 * other forms of the space (web/propositions.ts), so it works without a script:
 * - GET /associations/relier: the form; POST: the keys asked to the platform, then « C'est bien votre association ? »,
 *   or the form again with what went wrong (the client secret never given back);
 * - POST /associations/relier/confirmer: « C'est bien nous » writes the link and e-mails it; « Ce n'est pas nous »
 *   keeps nothing. Between the two, what the platform said travels in the page, sealed (connecteurs/connexions.ts);
 * - /associations/connexion/<secret>: the e-mailed link. Opening it changes nothing (a mail scanner opens the links it
 *   sees): its button confirms; /associations/connexion/<secret>/retirer, its button withdraws.
 * Against robots, the same as the other forms: Turnstile, a hidden field, a length cap, no form posted from another site,
 * and the daily caps of the storage.
 *
 * Nothing answers before CONNECTEURS_EN_LIGNE (web/connecteurs-drapeau.ts).
 */
import * as avis from "../avis.js";
import * as connexions from "../connecteurs/connexions.js";
import { emailOf } from "../propositions.js";
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { esc } from "./map.js";
import { layout } from "./pages.js";
import { hp, human, received, SECRET_HEADERS, TURNSTILE_SCRIPT, widget } from "./propositions.js";

export { CONNECTEURS_EN_LIGNE, enLigne, ouvrir } from "./connecteurs-drapeau.js";

export const RELIER_PATH = "/associations/relier";
export const CONFIRMER_PATH = "/associations/relier/confirmer";
/** The e-mailed link, followed by its secret (and connexions.RETRAIT for the withdrawal). */
export const CONNEXION_PATH = "/associations/connexion/";

const PARENT = { name: "Clubs et associations", path: "/associations" };
const DEPOT = "https://github.com/rundata-re/rundata";
const CLE_MAX = 200;

const TITLE = "Relier votre compte HelloAsso à rundata.re\u00a0: clubs et associations · 974";
const META = "Associations de La Réunion\u00a0: reliez une fois votre compte HelloAsso, et vos événements publics s'affichent sur rundata.re et dans les assistants IA, sans rien saisir deux fois.";
const CONNEXION_TITLE = "Votre connexion à rundata.re";
const CONNEXION_META = "Confirmer ou retirer la connexion de votre association à rundata.re.";

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

// ---------------------------------------------------------------- the card on /associations

export function carte(): string {
  return `<section class="card proposer" aria-labelledby="h-relier">
  <h2 id="h-relier">Relier votre plateforme</h2>
  <p>Vos événements sont déjà sur HelloAsso\u00a0? Reliez votre compte une fois\u00a0: ils s'affichent sur rundata.re et dans les assistants IA, sans rien saisir deux fois.</p>
  <p><a class="btn sun" href="${RELIER_PATH}">Relier HelloAsso</a></p>
</section>`;
}

// ---------------------------------------------------------------- the form

const ERREURS = {
  refuse: "HelloAsso n'a pas reconnu ces clés. Vérifiez que vous avez copié l'identifiant client et le secret client en entier, sans espace avant ou après.",
  association: "Ces clés ne sont rattachées à aucune association sur HelloAsso. Utilisez les clés d'un compte administrateur de l'association.",
  hors_ile: "Cette association n'a pas son adresse à La Réunion (code postal en 974) sur HelloAsso. rundata.re reprend seulement les associations de l'île.",
  indisponible: "La vérification n'a pas pu se faire pour l'instant. Rien n'a été gardé. Réessayez dans quelques minutes\u00a0; si ça dure, écrivez-nous\u00a0: contact@rundata.re",
  expire: "La vérification a expiré. Rien n'a été gardé\u00a0: collez à nouveau vos clés et vérifiez-les. Par sécurité, une vérification ne vaut que 30 minutes.",
  limite: "Plus aucune vérification n'est possible aujourd'hui. Rien n'a été gardé\u00a0: réessayez demain, ou écrivez à contact@rundata.re.",
} as const;
type Erreur = keyof typeof ERREURS;

/** What to say under a field typed wrong (the other forms' words). */
const FAUX: Record<string, string> = {
  client_id: "Collez l'identifiant client.",
  client_secret: "Collez le secret client.",
  email: "Indiquez une adresse e-mail valide\u00a0: vous y recevrez le lien de confirmation.",
};

// The open data, only when the association ticks it (HelloAsso agreed in writing, 29/10/2026): never ticked beforehand.
const OUVERT = "Mettre aussi nos événements dans les données ouvertes de rundata.re (facultatif)";
const OUVERT_AIDE = "Ils seront alors dans nos agendas ouverts (fichiers ICS et JSON), sous Licence Ouverte 2.0\u00a0: chacun pourra les reprendre, y compris pour un usage commercial, en citant votre association. Sans cette case, ils s'affichent sur rundata.re et dans les assistants IA, mais pas dans ces fichiers. Si vous retirez l'accès, ils en sortent aussi\u00a0; une copie déjà faite par quelqu'un d'autre reste sous la licence.";

type Formulaire = { f?: URLSearchParams; erreur?: Erreur; faux?: string[] };

function formulaire(e: Formulaire): string {
  const f = e.f ?? new URLSearchParams();
  const wrong = new Set(e.faux ?? []);
  // Never the client secret given back in the page.
  const v = (k: string) => (k === "client_secret" ? "" : esc(f.get(k) ?? ""));
  const bad = (k: string) => (wrong.has(k) ? ` aria-invalid="true" aria-describedby="faux-${k}"` : "");
  const note = (k: string) => (wrong.has(k) ? `<p class="faux" id="faux-${k}">${esc(FAUX[k])}</p>` : "");
  const top = e.erreur ? `<p class="msg vu" role="alert">${esc(ERREURS[e.erreur])}</p>` : wrong.size ? `<p class="msg vu" role="alert">Quelques champs sont à corriger, signalés ci-dessous.</p>` : "";
  return `<form class="card fo" method="post" action="${RELIER_PATH}" novalidate>
  ${top}
  <div class="f"><label for="r-plateforme">Votre plateforme</label><select id="r-plateforme" name="plateforme" required><option value="helloasso" selected>HelloAsso</option></select>
    <p class="aide">D'autres plateformes viendront. Votre association en utilise une autre\u00a0? Dites-le-nous\u00a0: contact@rundata.re</p></div>
  <section aria-labelledby="h-ou">
    <h3 id="h-ou">Où trouver vos clés\u00a0?</h3>
    <ol>
      <li>Connectez-vous à HelloAsso avec un compte administrateur de l'association.</li>
      <li>Ouvrez «\u00a0Mon compte\u00a0», puis l'onglet «\u00a0Intégrations et API\u00a0».</li>
      <li>Copiez l'identifiant client et le secret client, et collez-les ci-dessous.</li>
    </ol>
    <p>Seul un administrateur de l'association sur HelloAsso peut voir ces clés\u00a0: c'est ce qui prouve que c'est bien vous.</p>
  </section>
  <div class="f"><label for="r-id">Identifiant client (client id)</label><input id="r-id" name="client_id" value="${v("client_id")}" required maxlength="${CLE_MAX}" autocomplete="off" spellcheck="false"${bad("client_id")}>${note("client_id")}</div>
  <div class="f"><label for="r-secret">Secret client (client secret)</label><input id="r-secret" name="client_secret" type="password" required maxlength="${CLE_MAX}" autocomplete="off" spellcheck="false"${bad("client_secret")}>${note("client_secret")}</div>
  <div class="f"><label for="r-email">Adresse e-mail <span class="aide bloc">Le lien de confirmation y est envoyé, puis le lien pour retirer l'accès. Elle n'est jamais publiée.</span></label><input id="r-email" name="email" type="email" value="${v("email")}" required maxlength="254" autocomplete="email"${bad("email")}>${note("email")}</div>
  <div class="card lu">
    <p>Nous lisons seulement vos événements publics\u00a0: le titre, les dates, le lieu, le prix, le lien et le début de la description. Nous ne lisons jamais vos commandes, paiements, dons, participants ni adhérents, même si vos clés le permettent. Vos clés ne sont pas gardées\u00a0: elles servent une seule fois, à obtenir un jeton d'accès, que nous gardons chiffré et effaçons dès que vous retirez l'accès.</p>
  </div>
  <div class="f"><label class="case"><input type="checkbox" name="ouvert" value="oui"${f.get("ouvert") === "oui" ? " checked" : ""}> ${OUVERT}</label>
    <p class="aide">${OUVERT_AIDE}</p></div>
  <p class="note">Un événement laissé «\u00a0privé\u00a0» sur HelloAsso n'est pas repris. <a href="${DEPOT}">Le code de rundata.re est libre</a>\u00a0: chacun peut vérifier ce qu'il lit.</p>
  ${hp}
  ${widget("relier")}
  <button type="submit">Vérifier mes clés</button>
</form>`;
}

function bandeau(titre: string, lead?: string): string {
  return `${crumbBar(titre, PARENT)}
<div class="wrap intro solo"><div class="pitch">
  <p class="pill"><span class="dot"></span>Clubs et associations</p>
  <h1>${esc(titre)}</h1>
  ${lead ? `<p class="lead">${esc(lead)}</p>` : ""}
</div></div>`;
}

const INTRO = "Vos événements publics s'afficheront sur rundata.re et dans les assistants IA, avec le nom de votre association, et seront relus toutes les 6 heures. Réservé aux associations à but non lucratif de La Réunion.";

function relierPage(origin: string, body: string, alerte?: Alerte): string {
  return layout(origin, { title: TITLE, description: META, path: RELIER_PATH, jsonld: [crumbs(origin, "Relier votre plateforme", RELIER_PATH, PARENT), webPage(origin, RELIER_PATH, TITLE, META, null)], alerte, sansAvis: true }, bandeau("Relier votre plateforme à rundata.re", INTRO), body);
}

// ---------------------------------------------------------------- « C'est bien votre association ? »

function cestBienNous(a: connexions.Attente, scelle: string, dejaReliee: boolean): string {
  const o = a.organisation;
  return `<section class="card fo" aria-labelledby="h-nous">
  <h2 id="h-nous">C'est bien votre association\u00a0?</h2>
  <p>HelloAsso nous dit que ces clés administrent cette association\u00a0:</p>
  <ul>
    <li><b>${esc(o.nom)}</b></li>
    ${o.commune ? `<li>${esc(o.commune)}</li>` : ""}
    <li><a href="${esc(o.lien)}" rel="noopener">Votre page HelloAsso</a></li>
  </ul>
  <p>Dans nos données ouvertes\u00a0: ${a.ouvert ? "oui" : "non"}</p>
  <p>En confirmant, vous recevrez un e-mail à ${esc(a.email)}. Rien ne s'affiche avant que vous ayez confirmé avec le lien qu'il contient.</p>
  ${dejaReliee ? `<p class="msg vu" role="status">Cette association est déjà reliée à rundata.re. Si vous confirmez, la nouvelle connexion remplacera l'ancienne, et l'adresse e-mail donnée la première fois en sera prévenue.</p>` : ""}
  <form class="fo" method="post" action="${CONFIRMER_PATH}">
    <input type="hidden" name="attente" value="${esc(scelle)}">
    <button type="submit" name="choix" value="oui">C'est bien nous</button>
    <button type="submit" name="choix" value="non" class="sec">Ce n'est pas nous</button>
  </form>
</section>`;
}

const section = (...p: string[]) => `<section class="card fo">
  ${p.join("\n  ")}
</section>`;

/** GET /associations/relier: the empty form. POST: the keys asked to the platform. */
export async function relier(request: Request, now = new Date(), alerte?: Alerte): Promise<Response> {
  const origin = new URL(request.url).origin;
  const html = (body: string, status = 200) => new Response(relierPage(origin, body, alerte), { status, headers: HTML_HEADERS });
  const form = (e: Formulaire, status = 200) => html(`${formulaire(e)}${TURNSTILE_SCRIPT}`, status);
  if (request.method === "GET" || request.method === "HEAD") return form({});
  const f = await received(request, "Le formulaire «\u00a0Relier votre plateforme\u00a0»");
  if (f instanceof Response) return f;
  // Filled in by robots only: nothing asked to anyone.
  if (f.get("site_web")) return form({ erreur: "indisponible" }, 503);
  const faux: string[] = [];
  const cles = { client_id: (f.get("client_id") ?? "").trim(), client_secret: (f.get("client_secret") ?? "").trim() };
  if (!cles.client_id || cles.client_id.length > CLE_MAX) faux.push("client_id");
  if (!cles.client_secret || cles.client_secret.length > CLE_MAX) faux.push("client_secret");
  const email = emailOf(f.get("email"));
  if (!email) faux.push("email");
  if (faux.length) return form({ f, faux }, 422);
  if (!(await human(f, avis.adresseOf(request.headers), { hostname: new URL(request.url).hostname, action: "relier" }))) return form({ f, erreur: "indisponible" }, 503);
  const plateforme = f.get("plateforme") === "helloasso" ? "helloasso" : "";
  const v = await connexions.verifier(plateforme, cles, email!, now);
  if (v.issue !== "ok") return form({ f, erreur: v.issue }, v.issue === "indisponible" ? 503 : 422);
  const attente = { ...v.attente, ouvert: f.get("ouvert") === "oui" };
  return html(cestBienNous(attente, await connexions.sceller(attente), v.dejaReliee));
}

/** POST /associations/relier/confirmer: « C'est bien nous » writes the link and e-mails it; « Ce n'est pas nous », nothing. */
export async function confirmerRelier(request: Request, now = new Date(), alerte?: Alerte): Promise<Response> {
  const url = new URL(request.url);
  const html = (body: string, status = 200) => new Response(relierPage(url.origin, body, alerte), { status, headers: HTML_HEADERS });
  const f = await received(request, "Cette page");
  if (f instanceof Response) return f;
  if (f.get("choix") === "non") return html(section("<p>Rien n'a été gardé. Si ces clés ne sont pas celles de votre association, vérifiez le compte HelloAsso avec lequel vous les avez copiées.</p>", `<p><a href="${RELIER_PATH}">Relier votre plateforme</a> · <a href="/associations">Retour à l'espace clubs et associations</a></p>`));
  const a = await connexions.ouvrir(f.get("attente") ?? "", now);
  if (!a) return html(`${formulaire({ erreur: "expire" })}${TURNSTILE_SCRIPT}`, 410);
  const issue = await connexions.enregistrer(a, avis.adresseOf(request.headers), `${url.origin}${CONNEXION_PATH}`, now);
  if (issue === "limite") return html(`${formulaire({ erreur: "limite" })}${TURNSTILE_SCRIPT}`, 429);
  if (issue !== "ok") return html(`${formulaire({ erreur: "indisponible" })}${TURNSTILE_SCRIPT}`, 503);
  return html(section(`<p>Un e-mail est parti à ${esc(a.email)}. Ouvrez le lien qu'il contient pour confirmer, dans les 48 heures. Sans confirmation, tout est effacé.</p>`, `<p class="note">Rien reçu\u00a0? Regardez dans les indésirables, ou écrivez à contact@rundata.re.</p>`));
}

// ---------------------------------------------------------------- the e-mailed link

const jourDe = (t: number) => new Date(t * 1000 + 4 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join("/");

function connexionPage(origin: string, titre: string, body: string, alerte?: Alerte): string {
  // The secret is never in the canonical address, nor sent to another site, nor indexed.
  return layout(origin, { title: CONNEXION_TITLE, description: CONNEXION_META, path: RELIER_PATH, jsonld: [], alerte, sansAvis: true, sansPartage: true, noindex: true, referrer: "no-referrer" }, bandeau(titre), body);
}

const PLUS_VALABLE = `<section class="card fo"><p>Ce lien n'est plus valable\u00a0: la connexion a déjà été confirmée, ou elle a été effacée faute de confirmation dans les 48 heures. Pour relier votre association, recommencez depuis <a href="/associations">la page Associations</a>.</p></section>`;
const EFFACEE = `<section class="card fo"><p>Cette connexion n'existe plus\u00a0: l'accès est déjà retiré, ou il a expiré. Rien n'est gardé.</p></section>`;
const nomVille = (c: connexions.Connexion) => (c.commune ? `${c.nom} (${c.commune})` : c.nom);

/**
 * GET /associations/connexion/<secret>: what confirming does, and its button; with /retirer, what withdrawing does,
 * and its button. Never a change on GET. POST: the change, and what it did. `apres`: what to do once a link is
 * withdrawn (the agendas' copy written again, without its events).
 */
export async function connexion(request: Request, now = new Date(), alerte?: Alerte, apres?: () => Promise<void>): Promise<Response> {
  const url = new URL(request.url);
  const rest = url.pathname.slice(CONNEXION_PATH.length).replace(/\/$/, "");
  const retrait = rest.endsWith(connexions.RETRAIT);
  const secret = retrait ? rest.slice(0, -connexions.RETRAIT.length) : rest;
  const action = `${CONNEXION_PATH}${secret}${retrait ? connexions.RETRAIT : ""}`;
  const page = (titre: string, body: string, status = 200) => new Response(connexionPage(url.origin, titre, body, alerte), { status, headers: SECRET_HEADERS });
  const post = request.method === "POST";
  if (post) {
    const f = await received(request, "Cette page");
    if (f instanceof Response) return f;
  } else if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD, POST" } });
  }
  const c = await connexions.trouver(secret).catch(() => undefined);

  if (retrait) {
    if (!c) return page("Retirer l'accès de rundata.re", EFFACEE, 404);
    if (!post) {
      const depuis = c.confirme_le ? ` depuis le ${jourDe(c.confirme_le)}` : "";
      return page("Retirer l'accès de rundata.re", `<section class="card fo"><p>L'association ${esc(c.nom)} est reliée à rundata.re${depuis}. Si vous retirez l'accès, le jeton d'accès et votre adresse sont effacés tout de suite, et vos événements ne s'affichent plus sur rundata.re${c.ouvert ? " ni dans nos données ouvertes" : ""}.</p>
  <form class="fo" method="post" action="${esc(action)}"><button type="submit">Retirer l'accès</button></form></section>`);
    }
    const fait = await connexions.retirer(secret);
    if (!fait) return page("Retirer l'accès de rundata.re", EFFACEE, 404);
    await apres?.().catch(() => {});
    return page("Retirer l'accès de rundata.re", `<section class="card fo"><p>C'est fait. Le jeton d'accès et votre adresse sont effacés, et les événements de ${esc(fait.nom)} ne s'affichent plus sur rundata.re${fait.ouvert ? " ni dans nos données ouvertes" : ""}. Un e-mail vous le confirme. Pour relier à nouveau votre association\u00a0: <a href="/associations">la page Clubs et associations</a>.</p></section>`);
  }

  if (!c || c.etat !== "a_confirmer") {
    // Confirmed a moment ago, then the button sent again: said as done, not as a dead link.
    if (post && c && c.confirme_le && now.getTime() / 1000 - c.confirme_le < 600) return page("C'est confirmé", confirme(c));
    return page("Confirmer la connexion", PLUS_VALABLE, c ? 200 : 404);
  }
  if (!post) {
    return page("Confirmer la connexion", `<section class="card fo"><p>L'association ${esc(nomVille(c))} sera reliée à rundata.re avec l'adresse ${esc(c.email ?? "")}. Ses événements publics HelloAsso s'afficheront alors sur rundata.re, avec son nom.</p>
  <form class="fo" method="post" action="${esc(action)}"><button type="submit">Confirmer la connexion</button></form>
  <p class="note">Ce n'est pas vous\u00a0? Fermez cette page\u00a0: sans confirmation, tout est effacé sous 48 heures.</p></section>`);
  }
  const ok = await connexions.confirmer(secret, now).catch(() => undefined);
  return ok ? page("C'est confirmé", confirme(ok)) : page("Confirmer la connexion", `<section class="card fo"><p>${esc(ERREURS.indisponible)}</p></section>`, 503);
}

const confirme = (c: connexions.Connexion) => `<section class="card fo"><p>Merci. Nous vérifions une fois que ${esc(c.nom)} est bien une association de l'île, en général sous 24 heures. Ensuite, ses événements publics HelloAsso s'affichent sur rundata.re, relus toutes les 6 heures, sans autre démarche de votre part.</p>
  <p class="note">Pour retirer l'accès plus tard, gardez l'e-mail\u00a0: il contient le lien.</p></section>`;
