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
 * Nothing answers before ASSOCIATIONS_EN_LIGNE (web/associations-drapeau.ts): the page goes out with its forms.
 */
import * as avis from "../avis.js";
import { INSEE } from "../places/insee.js";
import * as propositions from "../propositions.js";
import { bodyText, postForm } from "../http.js";
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { esc } from "./map.js";
import { layout } from "./pages.js";

export { ASSOCIATIONS_EN_LIGNE, enLigne, ouvrir } from "./associations-drapeau.js";

export const LIEN_PATH = "/associations/lien";
export const PROPOSER_PATH = "/associations/proposer";
/** Where the confirmation link leads, followed by the secret (its page comes with the moderation). */
export const PROPOSITION_PATH = "/associations/proposition/";

const BODY_MAX = 8192;
/** The space the forms belong to, in their breadcrumb. */
const PARENT = { name: "Clubs et associations", path: "/associations" };
export const COMMUNES = Object.keys(INSEE).sort((a, b) => a.localeCompare(b, "fr"));

// ---------------------------------------------------------------- Turnstile

/** The public key of the Turnstile widget « rundata.re formulaires » (Managed, hostname rundata.re): in the page. */
export const TURNSTILE_SITEKEY = "0x4AAAAAAFlHv_IRLDHVZqlo";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The form a widget is on, given to Cloudflare as its action (`data-action`) and checked back with the token. */
export type FormAction = "lien" | "proposer" | "relier";
/** What the token must have been made for: this site's host, and the form it is posted with. */
export interface Attendu {
  hostname: string;
  action: FormAction;
}

/** Whether Cloudflare says the token comes from a person on this site, on this form; one subrequest. */
export type Verif = (token: string, adresse: string, attendu: Attendu) => Promise<boolean>;
let verif: Verif | undefined;

/** `secret`: the widget's secret key (Worker secret TURNSTILE_SECRET); `check` replaces Cloudflare's, for the tests. */
export function configure(secret: string | undefined, check?: Verif) {
  verif = check ?? (secret ? siteverify(secret) : undefined);
}

const siteverify = (secret: string): Verif => async (token, adresse, attendu) => {
  if (!token || token.length > 2048) return false;
  try {
    const r = await postForm<{ success?: boolean; hostname?: string; action?: string }>("turnstile", SITEVERIFY, { secret, response: token, ...(adresse ? { remoteip: adresse } : {}) }, 8000);
    if (r.success !== true) return false;
    // A token solved on another site that uses the same key, or on another of these forms, does not count.
    if (r.hostname !== attendu.hostname || r.action !== attendu.action) {
      console.warn(`turnstile : jeton refusé, fait pour ${String(r.action).slice(0, 20)} sur ${String(r.hostname).slice(0, 60)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("turnstile : vérification impossible", err instanceof Error ? err.message : String(err));
    return false;
  }
};

/** The widget, and under it what it keeps in the browser (cf.turnstile.u, in local storage: /confidentialite#abus). */
export const widget = (action: FormAction) =>
  TURNSTILE_SITEKEY
    ? `<div class="cf-turnstile" data-sitekey="${esc(TURNSTILE_SITEKEY)}" data-action="${action}" data-language="fr" data-size="flexible"></div>
  <p class="note">La vérification anti-robot de Cloudflare garde une donnée dans votre navigateur (pas un cookie)\u00a0: <a href="/confidentialite#abus">ce que c'est</a>.</p>`
    : "";
/** Cloudflare's script, once on a page with a form. */
export const TURNSTILE_SCRIPT = TURNSTILE_SITEKEY ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : "";

// ---------------------------------------------------------------- the forms' parts

const options = (values: readonly string[], chosen: string, first: string) =>
  `<option value="">${esc(first)}</option>${values.map((v) => `<option${v === chosen ? " selected" : ""}>${esc(v)}</option>`).join("")}`;
export const hp = `<div class="hp" aria-hidden="true"><label>Ne pas remplir <input name="site_web" tabindex="-1" autocomplete="off"></label></div>`;

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
  ${widget("lien")}
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
export async function received(request: Request, what: string): Promise<URLSearchParams | Response> {
  if (request.method !== "POST") return plain(405, `${what} est sur https://rundata.re/associations\u00a0; cette adresse ne reçoit que ses envois.`, { allow: "POST" });
  const url = new URL(request.url);
  const from = request.headers.get("origin");
  if (from && from !== url.origin) return plain(403, "Formulaire d'un autre site refusé.");
  const raw = await bodyText(request, BODY_MAX);
  if (raw === undefined) return plain(413, "Envoi trop long.");
  return new URLSearchParams(raw);
}

/** Whether Turnstile lets the form through: never without its key. */
export const human = async (f: URLSearchParams, adresse: string, attendu: Attendu) => !!verif && (await verif(f.get("cf-turnstile-response") ?? "", adresse, attendu));

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
  if (!(await human(f, adresse, { hostname: new URL(request.url).hostname, action: "lien" }))) return back("erreur");
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

/**
 * The form; with `correction`, the one of the secret link: what was proposed, to correct, sent to its page; without who
 * they are, their address, the consent nor the robots' checks, given once already.
 */
function proposerForm(e: Etat, now: Date, correction?: { action: string; f: URLSearchParams; affiche: boolean }): string {
  const f = e.kind === "faux" || e.kind === "limite" || e.kind === "indisponible" ? e.f : correction ? correction.f : new URLSearchParams();
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
  return `<form class="card fo" method="post" action="${correction ? esc(correction.action) : PROPOSER_PATH}" aria-labelledby="h-proposer" novalidate>
  <h2 id="h-proposer">${correction ? "Corriger l'événement" : "Votre événement"}</h2>
  ${correction ? `<input type="hidden" name="action" value="corriger"><p class="note">${correction.affiche ? "Une fois corrigé, l'événement est relu à nouveau, en général sous 24 heures. En attendant, la version actuelle reste affichée." : "Une fois corrigé, l'événement est relu à nouveau avant de s'afficher, en général sous 24 heures."}</p>` : ""}
  ${top}
  ${correction ? "" : `<fieldset${bad("vous_etes")}><legend>Vous êtes</legend>
    ${VOUS_ETES.map(([value, text]) => `<label class="case"><input type="radio" name="vous_etes" value="${value}"${f.get("vous_etes") === value ? " checked" : ""} required> ${esc(text)}</label>`).join("\n    ")}
  </fieldset>${note("vous_etes")}`}
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
  ${correction ? "" : `<div class="f"><label for="p-email">Votre e-mail <span class="aide bloc">Non publié, sauf si vous le choisissez plus bas. Vous y recevez le lien de confirmation, puis de quoi corriger, annuler ou reporter l'événement.</span></label><input id="p-email" name="email" type="email" value="${v("email")}" required maxlength="${propositions.EMAIL_MAX}" autocomplete="email"${bad("email")}>${note("email")}</div>`}
  <div class="f"><label for="p-contact">Contact public (facultatif) <span class="aide bloc">L'e-mail ou le téléphone de votre association, que le public pourra voir. Évitez un numéro personnel.</span></label><input id="p-contact" name="contact_public" value="${v("contact_public")}" maxlength="${propositions.CONTACT_MAX}"${bad("contact_public")}>${note("contact_public")}</div>
  <label class="case"><input type="checkbox" name="email_public" value="oui"${f.get("email_public") === "oui" ? " checked" : ""}> Utiliser mon adresse e-mail comme contact public</label>
  ${correction ? `<button type="submit">Envoyer la correction</button>
</form>` : `<label class="case"><input type="checkbox" name="accord" value="oui" required${f.get("accord") === "oui" ? " checked" : ""}${bad("accord")}> J'agis pour cette association, cet événement est ouvert au public, et je le publie sous Licence Ouverte 2.0\u00a0: tout le monde pourra le réutiliser librement, en citant l'association.</label>${note("accord")}
  ${hp}
  ${widget("proposer")}
  <button type="submit">Proposer l'événement</button>
  <p class="note">Votre e-mail sert seulement à confirmer, relire et modifier l'événement. Il n'est publié que si vous le demandez, et il est effacé 30 jours après la dernière date de l'événement, comme le contact public. <a href="/confidentialite#associations-donnees">Ce qui est gardé</a>.</p>
</form>`}`;
}

// « Jusqu'au » only for a repeated event, once the script runs; without it, the field stays.
const REPETE_SCRIPT = `<script>{const r=document.getElementById("p-repete"),j=document.getElementById("p-jusqu");if(r&&j){const f=j.closest(".f"),s=()=>{f.hidden=!r.value};r.addEventListener("change",s);s()}}</script>`;

/** The page of the form, or of what happens once it is sent. */
export function proposerPage(origin: string, e: Etat = { kind: "vide" }, now = new Date(), alerte?: Alerte): string {
  const band = `${crumbBar("Proposer un événement", PARENT)}
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
  return layout(origin, { title: TITLE, description: META, path: PROPOSER_PATH, jsonld: [crumbs(origin, "Proposer un événement", PROPOSER_PATH, PARENT), webPage(origin, PROPOSER_PATH, TITLE, META, null)], alerte, sansAvis: true }, band, body);
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
  if (!(await human(f, adresse, { hostname: new URL(request.url).hostname, action: "proposer" }))) return html({ kind: "indisponible", f }, 503);
  const issue = await propositions.enregistrerProposition(read.proposition, adresse, `${origin}${PROPOSITION_PATH}`, now);
  return issue === "ok" ? html({ kind: "envoye" }) : issue === "limite" ? html({ kind: "limite", f }, 429) : html({ kind: "indisponible", f }, 503);
}

// ---------------------------------------------------------------- the secret link

const GERER_TITLE = "Votre événement proposé · rundata.re";
const GERER_META = "Confirmer, corriger, annuler ou reporter l'événement que vous avez proposé sur rundata.re.";

/** What was just done, said once on the page the browser is sent back to. */
const FAIT: Record<string, string> = {
  confirmer: "Merci, l'événement est confirmé. Nous le relisons, en général sous 24 heures\u00a0; il s'affiche ensuite sur rundata.re.",
  annuler: "C'est fait\u00a0: l'événement est annoncé «\u00a0annulé\u00a0» sur rundata.re et dans les réponses des assistants IA.",
  retirer: "C'est fait\u00a0: la proposition est retirée, elle ne sera pas publiée.",
  reporter: "C'est fait\u00a0: l'événement est annoncé «\u00a0reporté\u00a0», à sa nouvelle date.",
  prolonger: "C'est fait\u00a0: les nouvelles dates s'affichent.",
  retirer_contact: "C'est fait\u00a0: le contact public n'est plus affiché.",
  corriger: "Merci, la correction est enregistrée. Nous la relisons, en général sous 24 heures, avant qu'elle s'affiche.",
};

const ETAT: Record<propositions.EtatProposition, string> = {
  a_confirmer: "À confirmer",
  a_moderer: "En cours de relecture",
  publie: "Publié",
  refuse: "Non publié",
  annule: "Annulé",
  reporte: "Reporté",
  retire: "Retiré",
};

/** Green once shown, amber while waiting, red when not or no longer shown. */
const TEINTE: Record<propositions.EtatProposition, string> = {
  a_confirmer: " ambre",
  a_moderer: " ambre",
  publie: " vert",
  refuse: "",
  annule: "",
  reporte: " ambre",
  retire: "",
};

const jourFr = (day: string) => day.split("-").reverse().join("/");

/** The proposal's facts, as the form gave them (its correction waiting, if any), to put back in it for a correction. */
function champs(l: propositions.Ligne): URLSearchParams {
  const f = new URLSearchParams();
  let c: Partial<propositions.Correction> = {};
  try {
    c = l.correction ? JSON.parse(l.correction) : {};
  } catch {
    // An unreadable correction: the published version.
  }
  const source = { ...l, ...c } as propositions.Ligne;
  for (const k of ["titre", "date", "debut", "fin", "repete", "jusqu_au", "commune", "lieu", "organisateur", "description", "lien", "contact_public"] as const) {
    if (source[k]) f.set(k, source[k]!);
  }
  l = source;
  if (l.prix === "gratuit") f.set("gratuit", "oui");
  else f.set("prix", l.prix);
  return f;
}

/**
 * When and where, in one line, date, hours, repetition, place: « le 07/11/2026, de 14:00 à 18:00, chaque semaine
 * jusqu'au 26/12/2026, Boulodrome (Saint-Pierre) », « le 07/11/2026 à 14:00, … ».
 */
function quandOu(l: propositions.Ligne): string {
  const day = l.reporte_au ?? l.date;
  const hours = l.fin ? `, de ${l.debut} à ${l.fin}` : ` à ${l.debut}`;
  const repeat = l.repete && l.jusqu_au ? `, chaque ${l.repete} jusqu'au ${jourFr(l.jusqu_au)}` : "";
  return `le ${jourFr(day)}${hours}${repeat}, ${l.lieu} (${l.commune})`;
}

/** One action: a form of its own, so that a link opened by a mail scanner changes nothing. */
const actionForm = (action: string, kind: string, inner: string) =>
  `<form class="fo" method="post" action="${esc(action)}"><input type="hidden" name="action" value="${kind}">${inner}</form>`;

type Gerer = { kind: "page"; fait?: string; refuse?: boolean; faux?: { f: URLSearchParams; erreurs: string[] } } | { kind: "inconnu" };

function gererBody(l: propositions.Ligne, action: string, g: Extract<Gerer, { kind: "page" }>, now: Date): string {
  const today = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
  const open = propositions.modifiable(l, now);
  const shown = propositions.VISIBLES.includes(l.etat) && open;
  const head = `<section class="card fo" aria-labelledby="h-gerer">
  <h2 id="h-gerer">${esc(l.titre)}</h2>
  ${g.fait && FAIT[g.fait] ? `<p class="msg vu ok" role="status">${FAIT[g.fait]}</p>` : ""}
  ${g.refuse ? `<p class="msg vu" role="alert">Ce changement n'est plus possible pour cet événement. Pour toute question, écrivez à contact@rundata.re.</p>` : ""}
  <p><span class="badge${TEINTE[l.etat]}">${esc(ETAT[l.etat])}</span> ${esc(quandOu(l))}.</p>
  <p class="note">Organisé par ${esc(l.organisateur)}.${l.contact_public ? ` Contact public\u00a0: ${esc(l.contact_public)}.` : ""}${l.etat === "refuse" ? `${l.motif ? ` Motif\u00a0: ${esc(l.motif)}.` : ""} Pour toute question, écrivez à contact@rundata.re.` : ""}</p>
  ${l.correction && open ? `<p class="note">Votre correction attend la relecture, en général sous 24 heures\u00a0; en attendant, la version ci-dessus reste affichée.</p>` : ""}
  ${!l.correction && l.motif && l.etat !== "refuse" && open ? `<p class="note">Votre dernière correction n'a pas été retenue. Motif\u00a0: ${esc(l.motif)}. Pour toute question, écrivez à contact@rundata.re.</p>` : ""}
  ${!open && !["refuse", "annule", "retire"].includes(l.etat) ? `<p class="note">La date de l'événement est passée\u00a0: il ne peut plus être changé.</p>` : ""}
  ${l.etat === "a_confirmer" && open ? actionForm(action, "confirmer", `<button type="submit">Confirmer l'événement</button>`) : ""}
  ${shown ? `<p><a href="/evenements">Voir les événements sur rundata.re</a></p>` : ""}
</section>`;
  if (!open || l.etat === "a_confirmer") return head;
  const parts: string[] = [];
  if (l.etat !== "a_moderer") {
    parts.push(`<section class="card fo" aria-labelledby="h-annuler"><h2 id="h-annuler">Annuler</h2>
  <p>L'événement reste affiché, marqué «\u00a0annulé\u00a0», pour que personne ne se déplace pour rien.</p>
  ${actionForm(action, "annuler", `<label class="case"><input type="checkbox" name="sur" value="oui" required> Oui, l'événement est annulé</label><button type="submit">Annoncer l'annulation</button>`)}</section>`);
    parts.push(`<section class="card fo" aria-labelledby="h-reporter"><h2 id="h-reporter">Reporter</h2>
  <p>L'événement est marqué «\u00a0reporté\u00a0», à sa nouvelle date, à la même heure.${l.repete ? " Un événement qui se répète devient alors un événement unique." : ""}</p>
  ${actionForm(action, "reporter", `<div class="f"><label for="g-date">Nouvelle date</label><input id="g-date" name="date" type="date" min="${today}" required></div><button type="submit">Annoncer le report</button>`)}</section>`);
  } else {
    parts.push(`<section class="card fo" aria-labelledby="h-annuler"><h2 id="h-annuler">Retirer la proposition</h2>
  <p>L'événement n'est pas encore publié\u00a0: retiré, il ne le sera pas.</p>
  ${actionForm(action, "annuler", `<label class="case"><input type="checkbox" name="sur" value="oui" required> Oui, retirer cet événement</label><button type="submit">Retirer</button>`)}</section>`);
  }
  if (l.repete && l.jusqu_au) {
    const max = propositions.addMonths(today, propositions.REPETITION_MOIS_MAX);
    parts.push(`<section class="card fo" aria-labelledby="h-prolonger"><h2 id="h-prolonger">Prolonger</h2>
  <p>Ajoutez des dates à l'événement qui se répète, jusqu'à 3 mois à partir d'aujourd'hui.</p>
  ${actionForm(action, "prolonger", `<div class="f"><label for="g-jusqu">Jusqu'au</label><input id="g-jusqu" name="jusqu_au" type="date" min="${l.jusqu_au}" max="${max}" required></div><button type="submit">Prolonger</button>`)}</section>`);
  }
  if (l.contact_public) {
    parts.push(`<section class="card fo" aria-labelledby="h-contact"><h2 id="h-contact">Retirer le contact public</h2>
  <p>«\u00a0${esc(l.contact_public)}\u00a0» ne sera plus affiché avec l'événement, dès que vous cliquez. Ceux qui l'ont déjà copié le gardent.</p>
  ${actionForm(action, "retirer_contact", `<button type="submit">Retirer le contact</button>`)}</section>`);
  }
  const fix = proposerForm(g.faux ? { kind: "faux", f: g.faux.f, erreurs: g.faux.erreurs } : { kind: "vide" }, now, { action, f: champs(l), affiche: shown });
  return `${head}\n${parts.join("\n")}\n${fix}${REPETE_SCRIPT}`;
}

/** The page of the secret link; `action`: its own address, where its forms post. */
export function gererPage(origin: string, l: propositions.Ligne | undefined, action: string, g: Gerer, now = new Date(), alerte?: Alerte): string {
  const band = `${crumbBar("Votre événement", PARENT)}
<div class="wrap intro solo"><div class="pitch">
  <p class="pill"><span class="dot"></span>Clubs et associations</p>
  <h1>Votre événement</h1>
  <p class="lead">Gardez ce lien\u00a0: il est le seul moyen de changer l'événement. Ne le partagez pas. Lien perdu\u00a0? Écrivez à contact@rundata.re.</p>
</div></div>`;
  const body = l && g.kind === "page"
    ? gererBody(l, action, g, now)
    : `<section class="card fo" aria-labelledby="h-inconnu"><h2 id="h-inconnu">Ce lien ne mène à aucun événement</h2>
  <p>Une proposition non confirmée sous 48 heures est effacée, et un événement l'est un an après sa dernière date. Vous pouvez <a href="${PROPOSER_PATH}">proposer l'événement à nouveau</a>, ou écrire à contact@rundata.re.</p></section>`;
  // The secret is never in the canonical address, nor sent to another site, nor indexed; nothing to share here, where a
  // volunteer would think they share their link.
  return layout(origin, { title: GERER_TITLE, description: GERER_META, path: PROPOSER_PATH, jsonld: [], alerte, sansAvis: true, sansPartage: true, noindex: true, referrer: "no-referrer" }, band, body);
}

export const SECRET_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-robots-tag": "noindex" };

/**
 * GET /associations/proposition/<secret>: the proposal and what its author can do, never a change (a mail scanner
 * opens the links it sees). POST: one change, then back to the page (303), which says it. `apres`: what to do once a
 * change the public sees is made (the agendas' copy written again).
 */
export async function proposition(request: Request, now = new Date(), alerte?: Alerte, apres?: () => Promise<void>): Promise<Response> {
  const url = new URL(request.url);
  const jeton = url.pathname.slice(PROPOSITION_PATH.length).replace(/\/$/, "");
  const action = `${PROPOSITION_PATH}${jeton}`;
  const page = (l: propositions.Ligne | undefined, g: Gerer, status = 200) =>
    new Response(gererPage(url.origin, l, action, g, now, alerte), { status, headers: SECRET_HEADERS });
  if (request.method === "GET" || request.method === "HEAD") {
    const l = await propositions.parJeton(jeton);
    const fait = url.searchParams.get("fait") ?? undefined;
    return l ? page(l, { kind: "page", fait }) : page(undefined, { kind: "inconnu" }, 404);
  }
  const f = await received(request, "Cette page");
  if (f instanceof Response) return f;
  const l = await propositions.parJeton(jeton);
  if (!l) return page(undefined, { kind: "inconnu" }, 404);
  const kind = f.get("action");
  let a: propositions.Action | undefined;
  if (kind === "confirmer" || kind === "retirer_contact") a = { kind };
  else if (kind === "annuler" && f.get("sur") === "oui") a = { kind };
  else if (kind === "reporter") a = { kind, date: f.get("date") ?? "" };
  else if (kind === "prolonger") a = { kind, jusqu_au: f.get("jusqu_au") ?? "" };
  else if (kind === "corriger") {
    if (!l.email) return page(l, { kind: "page", refuse: true }, 409);
    const read = propositions.lireProposition(f, COMMUNES, now, { email: l.email });
    if ("erreurs" in read) return page(l, { kind: "page", faux: { f, erreurs: read.erreurs } }, 422);
    a = { kind, p: read.proposition };
  }
  if (!a || !(await propositions.agir(jeton, a, now))) return page(l, { kind: "page", refuse: true }, 409);
  if (propositions.visibleAussitot(a) && apres) await apres().catch((err) => console.error("propositions : copie de l'agenda impossible", err instanceof Error ? err.message : String(err)));
  const fait = a.kind === "annuler" && l.etat === "a_moderer" ? "retirer" : a.kind;
  return new Response(null, { status: 303, headers: { location: `${url.origin}${action}?fait=${fait}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
