/**
 * The two forms of the clubs' and associations' space (marketing's spec, espace-associations.md §3 and §4), on plain
 * HTML, so they work without a script:
 * - « Nous donner votre lien », POST /associations/lien: the browser is sent back to its page, where #lien-merci (or
 *   #lien-limite, #lien-erreur) shows the outcome by CSS alone, like the feedback form (web/avis.ts);
 * - « Proposer un événement », GET and POST /associations/proposer: its own page, given back with what was typed and
 *   the fields to correct, or with what happens next.
 * Rows go to src/propositions.ts. Against robots: Turnstile (Cloudflare's check, its script on these forms only), a
 * field people do not see, a length cap, no form posted from another site, and the daily caps of the storage.
 *
 * Nothing answers before ASSOCIATIONS_EN_LIGNE: the page goes out with its forms, not before (data-run, 25/10).
 */
import * as avis from "../avis.js";
import { INSEE } from "../places/insee.js";
import * as propositions from "../propositions.js";
import { postForm } from "../http.js";
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { esc } from "./map.js";
import { layout } from "./pages.js";

/** Whether /associations and its forms answer. */
export const ASSOCIATIONS_EN_LIGNE = false;
let ouvert = ASSOCIATIONS_EN_LIGNE;
export const enLigne = () => ouvert;
/** For the tests: the forms answer before the page goes out. */
export function ouvrir(v: boolean) {
  ouvert = v;
}

export const LIEN_PATH = "/associations/lien";
export const PROPOSER_PATH = "/associations/proposer";
/** Where the confirmation link leads, followed by the secret (its page comes with the moderation). */
export const PROPOSITION_PATH = "/associations/proposition/";

const BODY_MAX = 8192;
export const COMMUNES = Object.keys(INSEE).sort((a, b) => a.localeCompare(b, "fr"));

// ---------------------------------------------------------------- Turnstile

/** The public key of the Turnstile widget « rundata.re formulaires » (Managed, hostname rundata.re): in the page. */
export const TURNSTILE_SITEKEY = "0x4AAAAAAFlHv_IRLDHVZqlo";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Whether Cloudflare says the token comes from a person on this site; one subrequest. */
export type Verif = (token: string, adresse: string) => Promise<boolean>;
let verif: Verif | undefined;

/** `secret`: the widget's secret key (Worker secret TURNSTILE_SECRET); `check` replaces Cloudflare's, for the tests. */
export function configure(secret: string | undefined, check?: Verif) {
  verif = check ?? (secret ? siteverify(secret) : undefined);
}

const siteverify = (secret: string): Verif => async (token, adresse) => {
  if (!token || token.length > 2048) return false;
  try {
    const r = await postForm<{ success?: boolean }>("turnstile", SITEVERIFY, { secret, response: token, ...(adresse ? { remoteip: adresse } : {}) }, 8000);
    return r.success === true;
  } catch (err) {
    console.error("turnstile : vérification impossible", err instanceof Error ? err.message : String(err));
    return false;
  }
};

const widget = () =>
  TURNSTILE_SITEKEY ? `<div class="cf-turnstile" data-sitekey="${esc(TURNSTILE_SITEKEY)}" data-language="fr" data-size="flexible"></div>` : "";
/** Cloudflare's script, once on a page with a form. */
export const TURNSTILE_SCRIPT = TURNSTILE_SITEKEY ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : "";

// ---------------------------------------------------------------- the forms' parts

const options = (values: readonly string[], chosen: string, first: string) =>
  `<option value="">${esc(first)}</option>${values.map((v) => `<option${v === chosen ? " selected" : ""}>${esc(v)}</option>`).join("")}`;
const hp = `<div class="hp" aria-hidden="true"><label>Ne pas remplir <input name="site_web" tabindex="-1" autocomplete="off"></label></div>`;

// ---------------------------------------------------------------- « Nous donner votre lien »

/** The form, with the page it is on. */
export function lienForm(path: string): string {
  return `<form class="card fo" id="lien" method="post" action="${LIEN_PATH}" aria-labelledby="h-lien">
  <h2 id="h-lien">Nous donner votre lien</h2>
  <p class="msg ok" id="lien-merci" role="status">Merci. Nous vérifions que votre lien se lit bien\u00a0; vos événements apparaissent ensuite sur rundata.re, en général sous 48 h.</p>
  <p class="msg" id="lien-limite" role="status">Plusieurs liens ont déjà été envoyés aujourd'hui depuis cette connexion\u00a0: réessayez demain, ou écrivez à contact@rundata.re.</p>
  <p class="msg" id="lien-erreur" role="status">Le lien n'a pas pu être enregistré\u00a0: vérifiez les champs (un lien commence par https://), ou écrivez à contact@rundata.re.</p>
  <div class="f"><label for="lien-nom">Nom de l'organisation</label><input id="lien-nom" name="nom" required minlength="2" maxlength="${propositions.NOM_MAX}" autocomplete="organization"></div>
  <div class="f"><label for="lien-commune">Commune</label><select id="lien-commune" name="commune" required>${options(COMMUNES, "", "Choisir")}</select></div>
  <div class="f"><label for="lien-lien">Lien de votre agenda, de votre flux ou de votre site Sportsregions</label><input id="lien-lien" name="lien" type="url" required maxlength="${propositions.LIEN_MAX}" placeholder="https://" inputmode="url"></div>
  <div class="f"><label for="lien-contact">E-mail ou téléphone de l'organisation <span class="aide">(facultatif, jamais publié\u00a0: pour vous prévenir si le lien ne répond plus)</span></label><input id="lien-contact" name="contact" maxlength="${propositions.CONTACT_MAX}"></div>
  <label class="case"><input type="checkbox" name="agit" value="oui" required> J'agis pour cette organisation, et j'accepte que ce lien et les événements qu'on y lit soient publiés sous Licence Ouverte 2.0.</label>
  <input type="hidden" name="page" value="${esc(path)}">
  ${hp}
  ${widget()}
  <button type="submit">Envoyer le lien</button>
</form>`;
}

/** A path of this site to send the browser back to; /associations otherwise. */
function pageOf(s: string | null): string {
  return s && s.length <= 200 && /^\/(?!\/)[\w\-./%]*$/.test(s) ? s : "/associations";
}

const plain = (status: number, text: string, headers: Record<string, string> = {}) =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers } });

/** The checks both forms share; the form's fields, or the answer that refuses it. */
async function received(request: Request, what: string): Promise<URLSearchParams | Response> {
  if (request.method !== "POST") return plain(405, `${what} est sur https://rundata.re/associations\u00a0; cette adresse ne reçoit que ses envois.`, { allow: "POST" });
  const url = new URL(request.url);
  const from = request.headers.get("origin");
  if (from && from !== url.origin) return plain(403, "Formulaire d'un autre site refusé.");
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return plain(413, "Envoi trop long.");
  const raw = await request.text();
  if (raw.length > BODY_MAX) return plain(413, "Envoi trop long.");
  return new URLSearchParams(raw);
}

/** Whether Turnstile lets the form through: never without its key. */
const human = async (f: URLSearchParams, adresse: string) => !!verif && (await verif(f.get("cf-turnstile-response") ?? "", adresse));

/** POST /associations/lien: writes the link and sends the browser back to its page. */
export async function lienPost(request: Request, now = new Date()): Promise<Response> {
  const f = await received(request, "Le formulaire «\u00a0Nous donner votre lien\u00a0»");
  if (f instanceof Response) return f;
  const origin = new URL(request.url).origin;
  const page = pageOf(f.get("page"));
  const back = (outcome: "merci" | "limite" | "erreur") => new Response(null, { status: 303, headers: { location: `${origin}${page}#lien-${outcome}`, "cache-control": "no-store" } });
  // Filled in by robots only: thanked, not kept.
  if (f.get("site_web")) return back("merci");
  const read = propositions.lireLien(f, COMMUNES, page);
  if ("erreurs" in read) return back("erreur");
  const adresse = avis.adresseOf(request.headers);
  if (!(await human(f, adresse))) return back("erreur");
  const issue = await propositions.enregistrerLien(read.lien, adresse, now);
  return back(issue === "ok" ? "merci" : issue === "limite" ? "limite" : "erreur");
}

// ---------------------------------------------------------------- « Proposer un événement »

const TITLE = "Proposer un événement gratuitement\u00a0: clubs et associations · 974";
const META = "Club ou association\u00a0? Proposez votre événement en 2 minutes, gratuitement et sans compte\u00a0: après relecture, il s'affiche sur rundata.re et dans les assistants IA.";

const VOUS_ETES = [["association", "Une association à but non lucratif (dont les clubs)"], ["public", "Une mairie ou un organisme public"], ["commerce", "Un commerce ou une entreprise"]] as const;

/** What to say under a field typed wrong, by its name. */
const FAUX: Record<string, string> = {
  vous_etes: "Dites qui vous êtes\u00a0: une association, un organisme public ou une entreprise.",
  titre: "Donnez un titre (3 caractères au moins).",
  date: "Choisissez une date, d'aujourd'hui à un an au plus.",
  debut: "Indiquez l'heure de début.",
  fin: "Indiquez l'heure de fin comme 18:30, ou laissez vide.",
  repete: "Choisissez une des répétitions proposées.",
  jusqu_au: "Un événement qui se répète a une date de fin, après sa première date et à 3 mois au plus d'aujourd'hui.",
  commune: "Choisissez la commune dans la liste.",
  lieu: "Indiquez le lieu, par exemple «\u00a0Gymnase de la Rivière\u00a0».",
  organisateur: "Indiquez le nom de l'organisateur.",
  description: "Décrivez l'événement en une phrase.",
  prix: "Indiquez le prix, ou cochez «\u00a0Gratuit\u00a0».",
  lien: "Un lien commence par https://.",
  email: "Indiquez une adresse e-mail valide\u00a0: vous y recevrez le lien de confirmation.",
  contact_public: "Le contact public est une adresse e-mail ou un numéro de téléphone.",
  accord: "Cochez la case pour que nous puissions publier l'événement.",
};

type Etat = { kind: "vide" } | { kind: "hors_perimetre" } | { kind: "faux"; f: URLSearchParams; erreurs: string[] } | { kind: "limite"; f: URLSearchParams } | { kind: "indisponible"; f: URLSearchParams } | { kind: "envoye" };

function proposerForm(e: Etat, now: Date): string {
  const f = e.kind === "faux" || e.kind === "limite" || e.kind === "indisponible" ? e.f : new URLSearchParams();
  const wrong = new Set(e.kind === "faux" ? e.erreurs : []);
  const v = (k: string) => esc(f.get(k) ?? "");
  const bad = (k: string) => (wrong.has(k) ? ` aria-invalid="true" aria-describedby="faux-${k}"` : "");
  const note = (k: string) => (wrong.has(k) ? `<p class="faux" id="faux-${k}">${esc(FAUX[k])}</p>` : "");
  const today = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
  const repete = f.get("repete") ?? "";
  const top =
    e.kind === "faux"
      ? `<p class="msg vu" role="alert">Quelques champs sont à corriger, signalés ci-dessous.</p>`
      : e.kind === "limite"
        ? `<p class="msg vu" role="alert">Cinq événements ont déjà été proposés aujourd'hui depuis cette connexion\u00a0: réessayez demain, ou écrivez à contact@rundata.re.</p>`
        : e.kind === "indisponible"
          ? `<p class="msg vu" role="alert">La proposition n'a pas pu être enregistrée. Réessayez dans quelques minutes, ou écrivez à contact@rundata.re.</p>`
          : "";
  return `<form class="card fo" method="post" action="${PROPOSER_PATH}" aria-labelledby="h-proposer" novalidate>
  <h2 id="h-proposer">Votre événement</h2>
  ${top}
  <fieldset${bad("vous_etes")}><legend>Vous êtes</legend>
    ${VOUS_ETES.map(([value, text]) => `<label class="case"><input type="radio" name="vous_etes" value="${value}"${f.get("vous_etes") === value ? " checked" : ""} required> ${esc(text)}</label>`).join("\n    ")}
  </fieldset>${note("vous_etes")}
  <div class="f"><label for="p-titre">Titre</label><input id="p-titre" name="titre" value="${v("titre")}" required maxlength="${propositions.NOM_MAX}"${bad("titre")}>${note("titre")}</div>
  <div class="f"><label for="p-date">Date</label><input id="p-date" name="date" type="date" min="${today}" value="${v("date")}" required${bad("date")}>${note("date")}</div>
  <div class="row court">
    <div class="f"><label for="p-debut">Heure de début</label><input id="p-debut" name="debut" type="time" value="${v("debut")}" required${bad("debut")}>${note("debut")}</div>
    <div class="f"><label for="p-fin">Heure de fin <span class="aide">(facultatif)</span></label><input id="p-fin" name="fin" type="time" value="${v("fin")}"${bad("fin")}>${note("fin")}</div>
  </div>
  <div class="row">
    <div class="f"><label for="p-repete">Se répète</label><select id="p-repete" name="repete"${bad("repete")}><option value=""${repete ? "" : " selected"}>Non, une seule fois</option><option value="semaine"${repete === "semaine" ? " selected" : ""}>Chaque semaine</option><option value="mois"${repete === "mois" ? " selected" : ""}>Chaque mois</option></select>${note("repete")}</div>
    <div class="f"><label for="p-jusqu">Jusqu'au (3 mois au plus) <span class="aide">(s'il se répète)</span></label><input id="p-jusqu" name="jusqu_au" type="date" min="${today}" value="${v("jusqu_au")}"${bad("jusqu_au")}>${note("jusqu_au")}</div>
  </div>
  <div class="row">
    <div class="f"><label for="p-commune">Commune</label><select id="p-commune" name="commune" required${bad("commune")}>${options(COMMUNES, f.get("commune") ?? "", "Choisir")}</select>${note("commune")}</div>
    <div class="f"><label for="p-lieu">Lieu</label><input id="p-lieu" name="lieu" value="${v("lieu")}" required maxlength="${propositions.NOM_MAX}" placeholder="Gymnase de la Rivière"${bad("lieu")}>${note("lieu")}</div>
  </div>
  <div class="f"><label for="p-org">Organisateur</label><input id="p-org" name="organisateur" value="${v("organisateur")}" required maxlength="${propositions.NOM_MAX}" autocomplete="organization"${bad("organisateur")}>${note("organisateur")}</div>
  <div class="f"><label for="p-desc">Une phrase pour le décrire</label><textarea id="p-desc" name="description" rows="2" required maxlength="${propositions.DESCRIPTION_MAX}"${bad("description")}>${v("description")}</textarea>${note("description")}</div>
  <div class="f"><label for="p-prix">Prix</label><input id="p-prix" name="prix" value="${v("prix")}" maxlength="${propositions.PRIX_MAX}" placeholder="5 €, gratuit pour les enfants"${bad("prix")}>${note("prix")}
    <label class="case"><input type="checkbox" name="gratuit" value="oui"${f.get("gratuit") === "oui" ? " checked" : ""}> Gratuit</label></div>
  <div class="f"><label for="p-lien">Lien <span class="aide">(facultatif\u00a0: page Facebook, billetterie ou inscription)</span></label><input id="p-lien" name="lien" type="url" value="${v("lien")}" maxlength="${propositions.LIEN_MAX}" placeholder="https://" inputmode="url"${bad("lien")}>${note("lien")}</div>
  <div class="f"><label for="p-email">Votre e-mail <span class="aide bloc">Non publié, sauf si vous le choisissez plus bas. Vous y recevez le lien de confirmation, puis de quoi corriger, annuler ou reporter l'événement.</span></label><input id="p-email" name="email" type="email" value="${v("email")}" required maxlength="${propositions.EMAIL_MAX}" autocomplete="email"${bad("email")}>${note("email")}</div>
  <div class="f"><label for="p-contact">Contact public (facultatif) <span class="aide bloc">L'e-mail ou le téléphone de votre association, que le public pourra voir. Évitez un numéro personnel.</span></label><input id="p-contact" name="contact_public" value="${v("contact_public")}" maxlength="${propositions.CONTACT_MAX}"${bad("contact_public")}>${note("contact_public")}</div>
  <label class="case"><input type="checkbox" name="email_public" value="oui"${f.get("email_public") === "oui" ? " checked" : ""}> Utiliser mon adresse e-mail comme contact public</label>
  <label class="case"><input type="checkbox" name="accord" value="oui" required${f.get("accord") === "oui" ? " checked" : ""}${bad("accord")}> J'agis pour cette association, cet événement est ouvert au public, et je le publie sous Licence Ouverte 2.0\u00a0: tout le monde pourra le réutiliser librement, en citant l'association.</label>${note("accord")}
  ${hp}
  ${widget()}
  <button type="submit">Proposer l'événement</button>
  <p class="note">Votre e-mail sert seulement à confirmer, relire et modifier l'événement. Il n'est publié que si vous le demandez, et il est effacé 30 jours après la dernière date de l'événement, comme le contact public. <a href="/confidentialite">Ce qui est gardé</a>.</p>
</form>`;
}

// « Jusqu'au » only for a repeated event, once the script runs; without it, the field stays.
const REPETE_SCRIPT = `<script>{const r=document.getElementById("p-repete"),j=document.getElementById("p-jusqu");if(r&&j){const f=j.closest(".f"),s=()=>{f.hidden=!r.value};r.addEventListener("change",s);s()}}</script>`;

/** The page of the form, or of what happens once it is sent. */
export function proposerPage(origin: string, e: Etat = { kind: "vide" }, now = new Date(), alerte?: Alerte): string {
  const band = `${crumbBar("Proposer un événement")}
<div class="wrap intro solo"><div class="pitch">
  <p class="pill"><span class="dot"></span>Clubs et associations</p>
  <h1>Proposer un événement</h1>
  <p class="lead">Un match, une kermesse, une sortie, un concert\u00a0? Remplissez ce formulaire\u00a0: 2 minutes, sans compte. Après votre confirmation par e-mail, nous le relisons, en général sous 24 heures, puis il s'affiche sur rundata.re et dans les assistants IA qui l'utilisent, avec le nom de votre association.</p>
</div></div>`;
  const body =
    e.kind === "hors_perimetre"
      ? `<section class="card fo" aria-labelledby="h-hors"><h2 id="h-hors">Publier vos événements vous-même</h2>
  <p>Pour l'instant, ce formulaire est réservé aux associations à but non lucratif. Pour publier vos événements vous-même, en flux ouvert, suivez le guide\u00a0: <a href="/publier">rundata.re/publier</a>.</p>
  <p><a href="/associations">Retour à l'espace clubs et associations</a></p></section>`
      : e.kind === "envoye"
      ? `<section class="card fo" aria-labelledby="h-envoye"><h2 id="h-envoye">Vérifiez votre boîte e-mail</h2>
  <p>Nous vous avons envoyé un lien pour confirmer l'événement. Sans confirmation sous 48 heures, la proposition est effacée.</p>
  <p class="note">Rien reçu\u00a0? Regardez dans les indésirables, ou écrivez à contact@rundata.re.</p>
  <p><a href="${PROPOSER_PATH}">Proposer un autre événement</a> · <a href="/associations">Retour à l'espace clubs et associations</a></p></section>`
      : `${proposerForm(e, now)}${REPETE_SCRIPT}${TURNSTILE_SCRIPT}`;
  return layout(origin, { title: TITLE, description: META, path: PROPOSER_PATH, jsonld: [crumbs(origin, "Proposer un événement", PROPOSER_PATH), webPage(origin, PROPOSER_PATH, TITLE, META, null)], alerte, sansAvis: true }, band, body);
}

/** GET /associations/proposer: the empty form. POST: the proposal written and its link e-mailed, or the form again. */
export async function proposer(request: Request, now = new Date(), alerte?: Alerte): Promise<Response> {
  const origin = new URL(request.url).origin;
  const html = (e: Etat, status = 200) => new Response(proposerPage(origin, e, now, alerte), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  if (request.method === "GET" || request.method === "HEAD") return html({ kind: "vide" });
  const f = await received(request, "Le formulaire «\u00a0Proposer un événement\u00a0»");
  if (f instanceof Response) return f;
  // Filled in by robots only: thanked, not kept.
  if (f.get("site_web")) return html({ kind: "envoye" });
  const read = propositions.lireProposition(f, COMMUNES, now);
  if ("erreurs" in read) return read.erreurs[0] === "hors_perimetre" ? html({ kind: "hors_perimetre" }) : html({ kind: "faux", f, erreurs: read.erreurs }, 422);
  const adresse = avis.adresseOf(request.headers);
  if (!(await human(f, adresse))) return html({ kind: "indisponible", f }, 503);
  const issue = await propositions.enregistrerProposition(read.proposition, adresse, `${origin}${PROPOSITION_PATH}`, now);
  return issue === "ok" ? html({ kind: "envoye" }) : issue === "limite" ? html({ kind: "limite", f }, 429) : html({ kind: "indisponible", f }, 503);
}
