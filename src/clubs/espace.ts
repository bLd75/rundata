/**
 * The clubs' and associations' own space (marketing/espace-club-verifie.md): a club proves once that it is the club,
 * through the address a public source gives for it, then comes back through a personal link. In the D1 tables of
 * scripts/clubs.sql, next to the proposals; the pages are web/club.ts.
 *
 * - The directory (`relireAnnuaire`): level 1, the clubs of MonClub (clubs/monclub.ts), read again once a week by the
 *   daily scheduled event; level 3, the clubs the team checked by hand (scripts/club-verifie.ts).
 * - The official address (`adresseOfficielle`): for level 1, read again at the source each time it is needed, then
 *   forgotten, never written anywhere, nor logged; for level 3, the one checked by hand. The page shows it masked
 *   (`masquer`), made here: the whole address never reaches the browser.
 * - The link (`demander`): e-mailed to that address only, valid 48 hours. At most LIENS_PAR_CLUB_JOUR a day for a
 *   club, LIENS_PAR_CONNEXION_JOUR from one connection, and LIENS_EN_TOUT_JOUR for everyone together, counted before
 *   the address is read: the trace (`envois`) keeps the club, the kind, the time, and for a day the connection's
 *   fingerprint (a salted hash of its address, or of its /64 in IPv6, and the day: avis.ts), never the address.
 * - Its click (`ouvrir`): the link used once, and the personal link drawn, which replaces the club's previous one and
 *   cuts its other e-mailed links. The first click is also the agreement to the licence and the rules (`accord_le`).
 *   A club withdrawn (gone from its source, or by the team) opens nothing any more.
 * - The personal link (`espace`): « Mon agenda », valid 12 months after its last use.
 *
 * Each link carries a secret drawn here, of which the table keeps only the hash. Without the database nothing answers
 * but « indisponible ».
 */
import { empreinte, type Run } from "../avis.js";
import type { Cache } from "../cache.js";
import { normalize } from "../places/resolve.js";
import { empreinteJeton, jetonNeuf, type All, type Envoi } from "../propositions.js";
import { enLigne } from "../web/club-drapeau.js";
import * as monclub from "./monclub.js";

/** Links e-mailed to one club in a day, and to all of them together. */
export const LIENS_PAR_CLUB_JOUR = 5;
export const LIENS_EN_TOUT_JOUR = 50;
/** Links asked from one connection in a day, whatever the clubs: one connection alone never uses up a club's day. */
export const LIENS_PAR_CONNEXION_JOUR = 3;
/** How long screen 2 shows the same masked address, or the same issue, before reading the source again, seconds. */
export const APERCU_SECONDES = 600;
/** How long an e-mailed link is valid, and a personal link after its last use, seconds. */
export const LIEN_SECONDES = 48 * 3600;
export const ESPACE_SECONDES = 365 * 86400;
/** The trace of the e-mails sent, and a level 3 address after the space's last use, seconds. */
export const TRACE_SECONDES = 365 * 86400;
/** The directory is read again once a week; the daily event that finds it older than this reads it. */
export const ANNUAIRE_SECONDES = 6 * 86400 + 12 * 3600;
/** Fewer clubs than this on MonClub's map: the page changed, and nobody is withdrawn on its word. */
export const ANNUAIRE_MIN = 10;
/** Letters typed before the list proposes anything. */
export const RECHERCHE_MIN = 3;

let run: Run | undefined;
let all: All | undefined;
let envoi: Envoi | undefined;

/** The table's doors, to write and to read (worker.ts, the feedback's database), and how the e-mails go. */
export function configure(db: Run | undefined, select?: All, send?: Envoi) {
  run = db;
  all = select;
  envoi = send;
}

export const enabled = () => !!run && !!all;
const seconds = (now: Date) => Math.floor(now.getTime() / 1000);

// ---------------------------------------------------------------- the directory

export type Source = "monclub" | "manuel";

/** A club as kept, without its address. */
export interface Club {
  id: number;
  source: Source;
  ref: string;
  niveau: 1 | 2 | 3;
  nom: string;
  commune: string | null;
  activite: string;
  fiche: string | null;
  adresse_le: number | null;
  verifie_le: number | null;
  accord_le: number | null;
}

const COLONNES = "id, source, ref, niveau, nom, commune, activite, fiche, adresse_le, verifie_le, accord_le";
// Proposed on screen 1: still at its source, and with an official address to write to.
const PROPOSES = "retire_le IS NULL AND (niveau = 1 OR email IS NOT NULL)";

const UPSERT = `INSERT INTO clubs (source, ref, niveau, nom, commune, activite, fiche, vu_le)
SELECT 'monclub', json_extract(value, '$.ref'), 1, json_extract(value, '$.nom'), json_extract(value, '$.commune'), 'Handball', json_extract(value, '$.fiche'), ?
FROM json_each(?) WHERE true
ON CONFLICT (source, ref) DO UPDATE SET nom = excluded.nom, commune = excluded.commune, fiche = excluded.fiche, vu_le = excluded.vu_le, retire_le = NULL`;

/**
 * Once a week (the daily scheduled event, which calls it every day): MonClub's clubs written again, those gone from
 * its map no longer proposed. undefined when not due, or before the flag (maybe no table yet). Throws when the map
 * cannot be read or looks cut: nothing is changed then.
 */
export async function relireAnnuaire(now = new Date(), lire = monclub.annuaire): Promise<{ lus: number; retires: number } | undefined> {
  if (!run || !all || !enLigne()) return undefined;
  const t = seconds(now);
  const last = (await all<{ v: number | null }>("SELECT MAX(vu_le) AS v FROM clubs WHERE source = 'monclub'"))[0]?.v;
  if (last && t - last < ANNUAIRE_SECONDES) return undefined;
  const clubs = await lire();
  if (clubs.length < ANNUAIRE_MIN) throw new Error(`monclub : ${clubs.length} clubs seulement sur la carte`);
  await run(UPSERT, t, JSON.stringify(clubs.map((c) => ({ ref: c.ref, nom: c.nom, commune: c.commune ?? null, fiche: c.fiche }))));
  const retires = await run("UPDATE clubs SET retire_le = ? WHERE source = 'monclub' AND vu_le < ? AND retire_le IS NULL", t, t);
  return { lus: clubs.length, retires };
}

/** A club proposed on screen 1. */
export type ClubVu = Pick<Club, "id" | "nom" | "commune" | "activite">;

/** Every club proposed on screen 1, by name. */
export async function proposes(): Promise<ClubVu[]> {
  if (!all) return [];
  return all<ClubVu>(`SELECT id, nom, commune, activite FROM clubs WHERE ${PROPOSES} ORDER BY nom`);
}

// « ST PIERRE », « STE MARIE » as people type them.
const ABREGES: Record<string, string> = { st: "saint", ste: "sainte" };
const mots = (s: string) => normalize(s).split(" ").filter(Boolean).map((w) => ABREGES[w] ?? w);

/**
 * The clubs whose name, town or activity hold each word typed, as the start of one of theirs; nothing under
 * RECHERCHE_MIN letters.
 */
export function chercher(clubs: readonly ClubVu[], q: string): ClubVu[] {
  const typed = mots(q);
  if (typed.join("").length < RECHERCHE_MIN) return [];
  return clubs.filter((c) => {
    const theirs = mots(`${c.nom} ${c.commune ?? ""} ${c.activite}`);
    return typed.every((w) => theirs.some((x) => x.startsWith(w)));
  });
}

/** A club proposed on screen 1, by its id; undefined otherwise. */
export async function club(id: number): Promise<Club | undefined> {
  if (!all || !Number.isSafeInteger(id) || id <= 0) return undefined;
  return (await all<Club>(`SELECT ${COLONNES} FROM clubs WHERE id = ? AND ${PROPOSES}`, id))[0];
}

// ---------------------------------------------------------------- the official address

export type Adresse = { adresse: string } | { issue: "absente" | "indisponible" };

/** Who gives the address, as screen 2 and the e-mail say it. */
export const FEDERATIONS: Record<Source, string | undefined> = { monclub: monclub.FEDERATION, manuel: undefined };

/**
 * The club's official address, read now: on its MonClub page (level 1), or the one checked by hand (level 3).
 * « absente »: the source gives none, or one that is not the federation's; « indisponible »: the source did not answer.
 */
export async function adresseOfficielle(c: Club): Promise<Adresse> {
  if (c.source === "monclub") {
    try {
      const a = await monclub.adresse(c.fiche ?? "", c.ref);
      return a ? { adresse: a } : { issue: "absente" };
    } catch {
      return { issue: "indisponible" };
    }
  }
  if (!all) return { issue: "indisponible" };
  const email = (await all<{ email: string | null }>("SELECT email FROM clubs WHERE id = ? AND niveau = 3", c.id))[0]?.email;
  return email ? { adresse: email } : { issue: "absente" };
}

/**
 * « 5•••••@reunion.ffhandball.net »: its first character, five dots whatever its length, its domain. `domaine` false
 * (level 3, an address the club chose): the domain masked too, « c•••@g•••.com », since a domain of its own can name
 * the person.
 */
export function masquer(adresse: string, domaine = true): string {
  const at = adresse.lastIndexOf("@");
  if (domaine) return `${adresse.slice(0, 1)}•••••${at > 0 ? adresse.slice(at) : ""}`;
  const host = at > 0 ? adresse.slice(at + 1) : "";
  const dot = host.lastIndexOf(".");
  return `${adresse.slice(0, 1)}•••@${host.slice(0, 1)}•••${dot > 0 ? host.slice(dot) : ""}`;
}

/** The club's address as its screens show it: masked, its domain too unless a federation gives it. */
export const masque = (c: Pick<Club, "source">, adresse: string) => masquer(adresse, !!FEDERATIONS[c.source]);

export type Apercu = { masque: string } | { issue: "absente" | "indisponible" };

/**
 * Screen 2: the club's address masked, or why there is none, kept APERCU_SECONDES in `cache` (only the mask, never the
 * address): a page reloaded, or opened by a robot, reads the source once in that time.
 */
export async function apercu(c: Club, cache: Cache): Promise<Apercu> {
  try {
    const r = await cache.get<Apercu>(`club:apercu:${c.id}`, APERCU_SECONDES, async () => {
      const a = await adresseOfficielle(c);
      // A silent source is not kept: asked again after the cache's pause for a failure.
      if ("issue" in a && a.issue === "indisponible") throw new Error("source muette");
      return "adresse" in a ? { masque: masque(c, a.adresse) } : a;
    });
    return r.stale ? { issue: "indisponible" } : r.value;
  } catch {
    return { issue: "indisponible" };
  }
}


// ---------------------------------------------------------------- the link

const ENVOI = `INSERT INTO envois (club, type, t, source) SELECT ?, 'lien', ?, ?
WHERE (SELECT COUNT(*) FROM envois WHERE club = ? AND type = 'lien' AND t > ?) < ?
AND (SELECT COUNT(*) FROM envois WHERE source = ? AND type = 'lien' AND t > ?) < ?
AND (SELECT COUNT(*) FROM envois WHERE type = 'lien' AND t > ?) < ?`;

/** The part of a connection's address that names it: the address in IPv4, its /64 in IPv6 (a home's whole network). */
export function reseau(ip: string): string {
  const v4 = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (v4) return v4[1];
  if (!ip.includes(":")) return ip;
  const [head, tail] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const all8 = [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${all8.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** Which cap refused a link: the club's, the connection's, or everyone's together. */
export type Limite = "limite" | "limite-connexion" | "limite-totale";
export type Demande = { issue: "ok"; masque: string } | { issue: Limite | "absente" | "indisponible" };

/**
 * E-mails a link to the club's official address, read again now: `base` followed by the link's secret. The caps are
 * counted first: past one (the club's, the connection `ip`'s, everyone's), nothing is read nor sent. Then refused when
 * the source gives no address. Each link asked counts, sent or not. The address is used for this e-mail only.
 */
export async function demander(c: Club, base: string, ip: string, now = new Date()): Promise<Demande> {
  if (!run || !all || !envoi) return { issue: "indisponible" };
  const t = seconds(now);
  const jour = t - 86400;
  // Without an address (never in the Worker), no connection to count.
  const source = ip ? await empreinte(reseau(ip), now) : null;
  try {
    if ((await run(ENVOI, c.id, t, source, c.id, jour, LIENS_PAR_CLUB_JOUR, source, jour, LIENS_PAR_CONNEXION_JOUR, jour, LIENS_EN_TOUT_JOUR)) === 0) return { issue: await quelleLimite(c, source, jour) };
  } catch (err) {
    console.error("espace club : écriture impossible", err instanceof Error ? err.message : String(err));
    return { issue: "indisponible" };
  }
  const a = await adresseOfficielle(c);
  if (!("adresse" in a)) return a;
  const secret = jetonNeuf();
  try {
    await run("INSERT INTO acces (jeton, club, type, t) VALUES (?, ?, 'lien', ?)", await empreinteJeton(secret), c.id, t);
  } catch (err) {
    console.error("espace club : écriture impossible", err instanceof Error ? err.message : String(err));
    return { issue: "indisponible" };
  }
  let sent = false;
  try {
    sent = await envoi({ to: a.adresse, ...messageLien(c, `${base}${secret}`) });
  } catch {
    // Never the error's text: it may hold the address.
    console.error("espace club : e-mail impossible");
  }
  return sent ? { issue: "ok", masque: masque(c, a.adresse) } : { issue: "indisponible" };
}

/** The cap a refused link went past, the club's first. */
async function quelleLimite(c: Club, source: string | null, jour: number): Promise<Limite> {
  const n = (await all!<{ club: number; connexion: number }>(
    "SELECT (SELECT COUNT(*) FROM envois WHERE club = ? AND type = 'lien' AND t > ?) AS club, (SELECT COUNT(*) FROM envois WHERE source = ? AND type = 'lien' AND t > ?) AS connexion",
    c.id, jour, source, jour,
  ).catch(() => []))[0];
  if (!n || n.club >= LIENS_PAR_CLUB_JOUR) return "limite";
  return n.connexion >= LIENS_PAR_CONNEXION_JOUR ? "limite-connexion" : "limite-totale";
}

const valide = (s: string) => /^[\w-]{16,64}$/.test(s);

/** The club an e-mailed link opens, and whether it is its first opening; undefined when used, expired or unknown. Changes nothing. */
export async function lien(secret: string, now = new Date()): Promise<{ club: Club; premiere: boolean } | undefined> {
  if (!all || !valide(secret)) return undefined;
  const c = (await all<Club>(`SELECT ${COLONNES.split(", ").map((k) => `c.${k}`).join(", ")} FROM acces a JOIN clubs c ON c.id = a.club WHERE a.jeton = ? AND a.type = 'lien' AND a.t > ? AND c.retire_le IS NULL`, await empreinteJeton(secret), seconds(now) - LIEN_SECONDES))[0];
  return c && { club: c, premiere: !c.accord_le };
}

/**
 * « Ouvrir mon espace »: the e-mailed link used, once; the club's personal link drawn, its previous one and its other
 * e-mailed links gone; the verification dated, and, the first time, the agreement. The new personal link's secret, or
 * undefined when the e-mailed link is no longer valid (used a moment ago included). The new link is written before the
 * others go: a step that fails halfway leaves the club a link that opens, never none.
 */
export async function ouvrir(secret: string, now = new Date()): Promise<string | undefined> {
  const l = await lien(secret, now);
  if (!l || !run) return undefined;
  const t = seconds(now);
  // Used once: of two clicks at the same moment, one only gets through.
  if ((await run("DELETE FROM acces WHERE jeton = ? AND type = 'lien'", await empreinteJeton(secret))) === 0) return undefined;
  const personnel = jetonNeuf();
  const jeton = await empreinteJeton(personnel);
  await run("INSERT INTO acces (jeton, club, type, t) VALUES (?, ?, 'espace', ?)", jeton, l.club.id, t);
  await run("DELETE FROM acces WHERE club = ? AND jeton <> ?", l.club.id, jeton);
  await run("UPDATE clubs SET verifie_le = ?, accord_le = COALESCE(accord_le, ?), utilise_le = ? WHERE id = ?", t, t, t, l.club.id);
  return personnel;
}

/**
 * The club a personal link opens, and whether this is the link's first view; undefined when it was replaced, unused
 * for 12 months, or never was. Its use is dated once a day at most.
 */
export async function espace(secret: string, now = new Date()): Promise<{ club: Club; nouveau: boolean } | undefined> {
  if (!all || !run || !valide(secret)) return undefined;
  const t = seconds(now);
  const jeton = await empreinteJeton(secret);
  const row = (await all<Club & { vu: number | null }>(`SELECT ${COLONNES.split(", ").map((k) => `c.${k}`).join(", ")}, a.utilise_le AS vu FROM acces a JOIN clubs c ON c.id = a.club WHERE a.jeton = ? AND a.type = 'espace' AND COALESCE(a.utilise_le, a.t) > ? AND c.retire_le IS NULL`, jeton, t - ESPACE_SECONDES))[0];
  if (!row) return undefined;
  const { vu, ...club } = row;
  if (vu === null || t - vu >= 86400) {
    await run("UPDATE acces SET utilise_le = ? WHERE jeton = ?", t, jeton);
    await run("UPDATE clubs SET utilise_le = ? WHERE id = ?", t, club.id);
  }
  return { club, nouveau: vu === null };
}

/**
 * Once a day (worker.ts): the personal links unused for 12 months, the trace of the e-mails after 12 months and its
 * connections' fingerprints after a day, the address of a level 3 club 12 months after its space's last use (or its
 * check). The e-mailed links older than 48 hours go with each new one (scripts/clubs.sql), and here too. The rows changed.
 */
export async function purger(now = new Date()): Promise<number> {
  // Before the flag, maybe no table yet.
  if (!run || !enLigne()) return 0;
  const t = seconds(now);
  let n = 0;
  n += await run("DELETE FROM acces WHERE (type = 'lien' AND t < ?) OR (type = 'espace' AND COALESCE(utilise_le, t) < ?)", t - LIEN_SECONDES, t - ESPACE_SECONDES);
  n += await run("DELETE FROM envois WHERE t < ?", t - TRACE_SECONDES);
  n += await run("UPDATE envois SET source = NULL WHERE source IS NOT NULL AND t < ?", t - 86400);
  n += await run("UPDATE clubs SET email = NULL WHERE niveau = 3 AND email IS NOT NULL AND COALESCE(utilise_le, adresse_le, vu_le) < ?", t - TRACE_SECONDES);
  return n;
}

// ---------------------------------------------------------------- the e-mail (marketing's words, §6)

/** The day « 12/11 » of a time, at La Réunion. */
export const jourMois = (t: number) => new Date(t * 1000 + 4 * 3600_000).toISOString().slice(5, 10).split("-").reverse().join("/");

/** Whose address it is, as the e-mail says it. */
function quelleAdresse(c: Club): string {
  const federation = FEDERATIONS[c.source];
  if (federation) return `l'adresse que ${federation} a créée pour votre club`;
  return `l'adresse vérifiée avec vous le ${jourMois(c.adresse_le ?? 0)}`;
}

export function messageLien(c: Club, lienOuvrir: string): { subject: string; text: string } {
  return {
    subject: "Votre espace sur rundata.re",
    text: [
      "Bonjour,",
      "",
      `Quelqu'un a demandé à ouvrir l'espace de ${c.nom} sur rundata.re. Nous écrivons à ${quelleAdresse(c)}.`,
      "",
      "Pour l'ouvrir, touchez ce lien (valable 48 heures) :",
      lienOuvrir,
      "",
      "Ce n'est pas vous ? Ne faites rien : sans clic, rien ne se passe.",
      "",
      "L'équipe rundata.re",
    ].join("\n"),
  };
}
