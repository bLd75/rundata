/**
 * HelloAsso (API v5, dev.helloasso.com, read on 26/10/2026), the first platform an association can link on
 * /associations: it pastes the API keys of its HelloAsso account (Mon compte > Intégrations et API), we ask HelloAsso
 * which association they administer, and keep only the refresh token they give, encrypted (chiffre.ts). The keys
 * themselves are never kept: HelloAsso forbids asking for a new token with them at each call.
 *
 * Those keys open the whole account (role OrganizationAdmin: payments, orders, participants), and HelloAsso gives an
 * association no narrower key. Hence three calls only, in CHEMINS, refused before any fetch otherwise (`garde`): the
 * association the keys belong to, its public forms of type Event, and the public details of one. Each answer is cut
 * down at once to the fields of EvenementPublic (of the description, its first sentence); nothing else is kept or
 * logged. A « Private » form (shown only to
 * whoever has its link) is not taken: its association did not want it found.
 *
 * Tokens (S'authentifier, Limite d'appels): an access token lasts 30 minutes, a refresh token 30 days and comes back
 * new at each use (the old one stays valid until the new one is used). The authentication API takes 10 calls in 10
 * seconds, 20 in 10 minutes, 50 in an hour: the scheduled event reads one link per run (src/registre.ts).
 */
import { getText, postForm } from "../http.js";
import { lead } from "../providers/agenda-mots.js";
import { UpstreamError } from "../types.js";
import { AccesRefuse, garde, reunionnais, type Acces, type EvenementPublic, type Plateforme, type Verification } from "./plateforme.js";

export const ID = "helloasso";
const API = "https://api.helloasso.com";
const TIMEOUT_MS = 15_000;
/** Forms per page, and pages read at most: an association with more than 200 forms is read in part. */
const PAGE = 50;
export const PAGES_MAX = 4;
/** Events read again in detail per reading at most (new or changed): the others wait for the next one. */
export const DETAILS_MAX = 10;
/** How far ahead an event is taken, as for the proposals. */
const JOURS_AVANT_MAX = 365;

const SLUG = "[a-z0-9][a-z0-9-]*";
const UN_SLUG = new RegExp(`^${SLUG}$`);
/** The only calls this module makes; the group is the association's slug, which must be the link's. */
export const CHEMINS: readonly RegExp[] = [
  /^\/v5\/users\/me\/organizations$/,
  new RegExp(`^/v5/organizations/(${SLUG})/forms\\?formTypes=Event&states=Public&pageSize=${PAGE}(?:&continuationToken=[A-Za-z0-9._~%-]+)?$`),
  new RegExp(`^/v5/organizations/(${SLUG})/forms/Event/${SLUG}/public$`),
];

/** The fields read, out of HelloAsso's OrganizationLightModel, FormLightModel and FormPublicModel. */
interface Organization {
  organizationSlug?: string;
  name?: string;
  city?: string;
  zipCode?: string;
  url?: string;
}
interface Form {
  formSlug?: string;
  description?: string;
  formType?: string;
  state?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  meta?: { createdAt?: string; updatedAt?: string };
}
interface FormDetails extends Form {
  place?: { name?: string; address?: string; city?: string; zipCode?: string };
  tiers?: { price?: number; tierType?: string }[];
}
interface Page {
  data?: Form[];
  pagination?: { continuationToken?: string };
}

interface Jetons {
  access_token: string;
  refresh_token: string;
}

/** A token asked for; a refusal (400, 401, 403) is AccesRefuse, anything else HelloAsso's silence. */
async function jetons(etape: string, champs: Record<string, string>): Promise<Jetons> {
  let r: Partial<Jetons>;
  try {
    r = await postForm<Partial<Jetons>>(ID, `${API}/oauth2/token`, champs, TIMEOUT_MS);
  } catch (err) {
    if (err instanceof UpstreamError && (err.status === 400 || err.status === 401 || err.status === 403)) throw new AccesRefuse(ID, etape, err.status);
    throw err;
  }
  if (typeof r.access_token !== "string" || typeof r.refresh_token !== "string") throw new UpstreamError(ID, `${etape} : réponse sans jeton`);
  return { access_token: r.access_token, refresh_token: r.refresh_token };
}

/** One of CHEMINS, with the access token; its JSON. */
async function appel<T>(jeton: string, chemin: string, organisation?: string): Promise<T> {
  garde(ID, CHEMINS, chemin, organisation);
  let texte: string;
  try {
    texte = await getText(ID, API + chemin, TIMEOUT_MS, { Authorization: `Bearer ${jeton}`, Accept: "application/json" });
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 401) throw new AccesRefuse(ID, "lecture", 401);
    throw err;
  }
  return JSON.parse(texte) as T;
}

/**
 * A date of HelloAsso as a local time at La Réunion, « 2026-11-14T18:00 ». With an offset, converted; without one,
 * taken as written, the association's own time.
 */
export function heureLocale(date: string | undefined): string | undefined {
  if (!date) return undefined;
  if (!/(?:Z|[+-]\d\d:?\d\d)$/.test(date)) return /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(date) ? date.slice(0, 16) : undefined;
  const t = Date.parse(date);
  return Number.isNaN(t) ? undefined : new Date(t + 4 * 3600_000).toISOString().slice(0, 16);
}

const euros = (centimes: number) => {
  const e = centimes / 100;
  return `${Number.isInteger(e) ? String(e) : e.toFixed(2).replace(".", ",")} €`;
};

/** The prices of the tiers one pays to come (not the donations): « Gratuit », « 10 € », « de 5 à 15 € ». */
export function prix(tiers: FormDetails["tiers"]): string | undefined {
  const prices = (tiers ?? []).filter((t) => t.tierType !== "Donation" && typeof t.price === "number" && t.price >= 0).map((t) => t.price!);
  if (!prices.length) return undefined;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max === 0) return "Gratuit";
  return min === max ? euros(max) : `de ${euros(min).replace(" €", "")} à ${euros(max)}`;
}

const texte = (s: string | undefined) => s?.replace(/\s+/g, " ").trim() || undefined;

/** The first sentence of a description in plain text; none from one written in HTML, never cut out of its tags. */
const phrase = (s: string | undefined) => (s && !s.includes("<") ? lead(texte(s) ?? "") || undefined : undefined);

/** One form and its details as an EvenementPublic; undefined when it lacks a title, a start or a page. */
export function evenement(f: FormDetails): EvenementPublic | undefined {
  const debut = heureLocale(f.startDate);
  const titre = texte(f.title);
  if (!f.formSlug || !titre || !debut || !f.url) return undefined;
  const fin = heureLocale(f.endDate);
  return {
    id: f.formSlug,
    maj: f.meta?.updatedAt ?? f.meta?.createdAt ?? "",
    titre,
    debut,
    ...(fin && fin > debut ? { fin } : {}),
    ...(texte(f.place?.name) ? { lieu: texte(f.place?.name) } : {}),
    ...(texte(f.place?.address) ? { adresse: texte(f.place?.address) } : {}),
    ...(texte(f.place?.city) ? { commune: texte(f.place?.city) } : {}),
    ...(texte(f.place?.zipCode) ? { code_postal: texte(f.place?.zipCode) } : {}),
    ...(prix(f.tiers) ? { prix: prix(f.tiers) } : {}),
    ...(phrase(f.description) ? { description: phrase(f.description) } : {}),
    lien: f.url,
  };
}

/** Whether a form of the list is to be taken: a public event not over yet, within a year. */
function aVenir(f: Form, now: Date): boolean {
  // A slug of another shape would be refused by `garde`: left out rather than stopping the reading.
  if (f.formType !== "Event" || f.state !== "Public" || !f.formSlug || !UN_SLUG.test(f.formSlug)) return false;
  const debut = heureLocale(f.startDate);
  const fin = heureLocale(f.endDate) ?? debut;
  const today = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 16);
  const horizon = new Date(now.getTime() + 4 * 3600_000 + JOURS_AVANT_MAX * 86400_000).toISOString().slice(0, 16);
  return !!debut && !!fin && fin >= today && debut <= horizon;
}

async function verifier(cles: Record<string, string>): Promise<Verification> {
  const clientId = cles.client_id?.trim();
  const clientSecret = cles.client_secret?.trim();
  if (!clientId || !clientSecret) throw new AccesRefuse(ID, "clés");
  const t = await jetons("clés", { grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
  const orgs = await appel<Organization[]>(t.access_token, "/v5/users/me/organizations");
  const found = (Array.isArray(orgs) ? orgs : []).filter((o) => o.organizationSlug && o.name);
  // An association's key administers its association alone; none, or several, is not one we can link.
  if (found.length !== 1) throw new AccesRefuse(ID, "association");
  const o = found[0];
  return {
    organisation: {
      id: o.organizationSlug!,
      nom: o.name!.trim(),
      ...(texte(o.city) ? { commune: texte(o.city) } : {}),
      ...(texte(o.zipCode) ? { code_postal: texte(o.zipCode) } : {}),
      lien: o.url ?? `https://www.helloasso.com/associations/${o.organizationSlug}`,
    },
    secret: t.refresh_token,
  };
}

async function acceder(secret: string): Promise<Acces> {
  const t = await jetons("jeton", { grant_type: "refresh_token", refresh_token: secret });
  return { jeton: t.access_token, secret: t.refresh_token };
}

async function lire(jeton: string, organisation: string, connus: ReadonlyMap<string, EvenementPublic>, now = new Date()): Promise<EvenementPublic[]> {
  const forms: Form[] = [];
  let suite: string | undefined;
  for (let page = 0; page < PAGES_MAX; page++) {
    const chemin = `/v5/organizations/${organisation}/forms?formTypes=Event&states=Public&pageSize=${PAGE}${suite ? `&continuationToken=${encodeURIComponent(suite)}` : ""}`;
    const p = await appel<Page>(jeton, chemin, organisation);
    const data = Array.isArray(p.data) ? p.data : [];
    forms.push(...data);
    suite = p.pagination?.continuationToken;
    if (!suite || data.length < PAGE) break;
  }
  const out: EvenementPublic[] = [];
  let details = 0;
  for (const f of forms.filter((f) => aVenir(f, now))) {
    const maj = f.meta?.updatedAt ?? f.meta?.createdAt ?? "";
    const known = connus.get(f.formSlug!);
    if (known && known.maj === maj) {
      out.push(known);
      continue;
    }
    if (details >= DETAILS_MAX) {
      if (known) out.push(known);
      continue;
    }
    details++;
    const d = await appel<FormDetails>(jeton, `/v5/organizations/${organisation}/forms/Event/${f.formSlug}/public`, organisation);
    const e = evenement({ ...f, ...d, formSlug: f.formSlug, url: d.url ?? f.url, meta: f.meta });
    // A place given outside the island: not an event of La Réunion.
    if (e && (!e.code_postal || reunionnais(e.code_postal))) out.push(e);
  }
  return out;
}

export const HELLOASSO: Plateforme = {
  id: ID,
  nom: "HelloAsso",
  champs: ["client_id", "client_secret"],
  verifier,
  acceder,
  lire: (jeton, organisation, connus) => lire(jeton, organisation, connus),
};

/** For the tests: a reading at a given time. */
export const lireLe = lire;
