/**
 * The public sites that do not answer (/sites-sans-reponse, tool sites_sans_reponse): a site that does not answer is
 * neither gone nor empty, it is rechecked every day and leaves the list as soon as it answers again. One row per host,
 * in the table `sans_reponse` of scripts/sans-reponse.sql (D1 database bound as AVIS).
 *
 * A failed read (http.ts) is written only when it changes the host's state: an unknown host, or one that had come
 * back, enters « a_verifier », never shown. The Worker's own failures (its connections queued, a slow invocation) look
 * like a site's: only the recheck makes a row public, and a failure seen in the day (a 403 or a 429 after a run of our own
 * reads among them) leaves it « a_verifier » at most. Once a day, at 06:00 in La Réunion, after the scheduled event's
 * reads and a minute after this isolate last read the host, each row not « revenu » is asked once, four at a time, with
 * 20 s each:
 * - an answer (2xx, no maintenance page, and a recent enough datum when the row says what to check): « revenu », kept
 *   7 days, then deleted; a row still « a_verifier » is deleted at once, it was never shown;
 * - a 403 or 429 twice in a row (a site may refuse reads at night only): « bloque », the site answers but not to our
 *   reads; never said to refuse anything, nobody knows whether it is meant;
 * - another failure: « injoignable », the day's failure and the morning's making two; a « bloque » one stays so on a
 *   timeout or a refused connection (a site that turns away Cloudflare's addresses shows nothing else), and becomes
 *   « injoignable » on a server error, a maintenance page or an unknown address.
 *
 * A site whose commune has not agreed to its reuse (autorisations.ts) is never shown: nothing is missing here because
 * of its silence, it is not read anyway. The table may not exist yet: every call then does nothing.
 */
import { count } from "./budget.js";
import { ACTUS_MAIRIES, LISIBLES } from "./providers/agenda.js";
import { AUTORISATIONS } from "./providers/autorisations.js";
import type { Cache } from "./cache.js";
import type { SourceInfo } from "./types.js";

export type Statut = "a_verifier" | "injoignable" | "bloque" | "revenu";

export interface Ligne {
  hote: string;
  url: string;
  /** The site's editor as said elsewhere on rundata.re (« Sudéau », « l'OVPF »), the page writing « le site de … ». */
  nom: string | null;
  /** The part of the page it is listed in (« Eau », « Volcan », « Mer »…). */
  theme: string | null;
  /** What is missing on rundata.re while it is silent, and the page that would show it. */
  manque: string | null;
  page: string | null;
  /** The ids of the sources read on this host. */
  sources: string[];
  statut: Statut;
  /** Unix seconds, as everywhere in this database. */
  premier_echec: number;
  dernier_essai: number | null;
  /** What was seen: http_503, maintenance, delai, connexion, dns, http_404, http_403, flux_vide. */
  constat: string;
  revenu_le: number | null;
  /** Rechecks in a row answered 403 or 429. */
  n403: number;
  /** For a site that answers with an empty feed: where to read its latest datum, and how old it may be. */
  verifier: { url?: string; date: string; age_max_h?: number } | null;
}

type Run = (sql: string, ...params: unknown[]) => Promise<number>;
type All = <T>(sql: string, ...params: unknown[]) => Promise<T[]>;
type Batch = (statements: { sql: string; params: unknown[] }[]) => Promise<void>;

let run: Run | undefined;
let all: All | undefined;
let batch: Batch | undefined;
const registre = new Map<string, SourceInfo>();

/** The database's calls (worker.ts), or none: nothing is written nor read. */
export function configure(r?: Run, a?: All, b?: Batch) {
  run = r;
  all = a;
  batch = b;
}

/** The sources the server knows (sources_donnees' list): a row's editor and what it is missing, when the row does not say. */
export function inscrire(sources: SourceInfo[]) {
  for (const s of sources) if (!registre.has(s.id)) registre.set(s.id, s);
}

export const GARDE_REVENUS_JOURS = 7;
const DELAI_MS = 20_000;
const A_LA_FOIS = 4;
// A host is asked by the recheck only this long after this isolate's last read of it: its answer is to that one GET,
// never to a run of ours (reunion.gouv.fr turns away bursts). Past CALME_ESSAIS waits, it is left for the next morning.
const CALME_MS = 60_000;
const CALME_ESSAIS = 3;
// The rows' states, read once in a while by each isolate at its first failure, so that a failure already known writes nothing.
const RELIRE_MS = 10 * 60_000;
// Sites that answer a robot with no name by an error page: the same words as the agendas'.
const UA = "rundata.re (contact@rundata.re)";
const MAINTENANCE = /<title>[^<]*maintenance|site (?:est )?en maintenance|maintenance en cours/i;

export const hoteDe = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

/**
 * What a failed read leaves of its address: the site's root only. The rest may hold what a person asked (an address
 * given to fiche_terrain, in the geocoder's query; coordinates in a path) or a key (FIRMS's is in its path), and is
 * never written.
 */
export const origineDe = (url: string) => {
  try {
    return `${new URL(url).origin}/`;
  } catch {
    return undefined;
  }
};

/** When this isolate last read each host (http.ts, worker.ts). */
const lectures = new Map<string, number>();
export function lu(url: string, t = Date.now()) {
  const hote = hoteDe(url);
  if (hote) lectures.set(hote, t);
}

const absente = (err: unknown) => /no such table/i.test(err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------- The failures of the reads

/** What a failed read says, as the table writes it; undefined for what is not the site's silence (a 404, a 400…). */
export function constatDe(err: { status?: number; message?: string }): string | undefined {
  if (err.status !== undefined) return err.status >= 500 ? `http_${err.status}` : err.status === 403 || err.status === 429 ? `http_${err.status}` : undefined;
  const m = err.message ?? "";
  if (/timed? ?out|timeout|aborted/i.test(m)) return "delai";
  if (/ENOTFOUND|getaddrinfo|DNS|name not resolved/i.test(m)) return "dns";
  if (/connect|connection|ECONNREFUSED|ECONNRESET|Network/i.test(m)) return "connexion";
  return undefined;
}

let etats: Map<string, Statut> | undefined;
let lusLe = 0;
let lecture: Promise<void> | undefined;

async function lireEtats(now: number) {
  if (etats && now - lusLe < RELIRE_MS) return;
  lecture ??= (async () => {
    try {
      count(1, "read");
      const rows = await all!<{ hote: string; statut: Statut }>("SELECT hote, statut FROM sans_reponse");
      etats = new Map(rows.map((r) => [r.hote, r.statut]));
    } catch (err) {
      // No table yet, or no budget left: the failures are left alone until the next reading.
      etats = absente(err) ? new Map() : etats;
      if (!absente(err)) throw err;
    } finally {
      lusLe = now;
      lecture = undefined;
    }
  })();
  await lecture;
}

const ENTRER = `INSERT INTO sans_reponse (hote, url, sources, statut, premier_echec, constat) VALUES (?, ?, ?, 'a_verifier', ?, ?)
ON CONFLICT (hote) DO UPDATE SET statut = 'a_verifier', url = excluded.url, premier_echec = excluded.premier_echec,
  constat = excluded.constat, revenu_le = NULL, n403 = 0
WHERE sans_reponse.statut = 'revenu'`;

/**
 * A read of `url` (source `source`) failed: the host enters « a_verifier » if it was unknown or had come back, with its
 * root as address (origineDe), never the read's own. Written once per change of state: a host already listed writes
 * nothing. Never throws.
 */
export async function noter(source: string, url: string, constat: string, now = new Date()): Promise<void> {
  const hote = hoteDe(url);
  if (!run || !all || !hote) return;
  try {
    await lireEtats(now.getTime());
    const etat = etats?.get(hote);
    if (!etats || (etat && etat !== "revenu")) return;
    etats.set(hote, "a_verifier");
    count(1, true);
    await run(ENTRER, hote, origineDe(url), JSON.stringify([source]), Math.floor(now.getTime() / 1000), constat);
  } catch (err) {
    if (!absente(err)) console.error(`sites sans réponse : ${hote} non noté`, err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------- The daily recheck

type Verdict = { issue: "repond" } | { issue: "bloque"; constat: string } | { issue: "echec"; constat: string };

/** One GET of the row's address, as the morning's recheck asks it. */
export async function essayer(l: Pick<Ligne, "url" | "verifier">, now: Date, fetcher: typeof fetch = fetch): Promise<Verdict> {
  let res: Response;
  count();
  try {
    res = await fetcher(l.verifier?.url ?? l.url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(DELAI_MS) });
  } catch (err) {
    return { issue: "echec", constat: constatDe({ message: err instanceof Error ? `${err.name} ${err.message}` : String(err) }) ?? "connexion" };
  }
  if (res.status === 403 || res.status === 429) return { issue: "bloque", constat: `http_${res.status}` };
  // A site's root, where a failed read leaves its host (origineDe), may have no page: an API's often answers 404. There
  // the site answers; only the network, the delay and a 5xx count, as for the reads (constatDe).
  const racine = !l.verifier && new URL(l.url).pathname === "/";
  if (!res.ok && !(racine && res.status < 500)) return { issue: "echec", constat: `http_${res.status}` };
  const body = await res.text().catch(() => "");
  if (MAINTENANCE.test(body.slice(0, 65_536))) return { issue: "echec", constat: "maintenance" };
  if (l.verifier) {
    const dates = [...body.matchAll(new RegExp(l.verifier.date, "g"))].map((m) => Date.parse(m[1] ?? "")).filter((t) => !Number.isNaN(t));
    const latest = dates.length ? Math.max(...dates) : undefined;
    if (latest === undefined || now.getTime() - latest > (l.verifier.age_max_h ?? 48) * 3600_000) return { issue: "echec", constat: "flux_vide" };
  }
  return { issue: "repond" };
}

/** What a recheck makes of a row: its new state, or null to delete it. */
export function suite(l: Ligne, v: Verdict, t: number): Partial<Ligne> | null {
  if (v.issue === "repond") return l.statut === "a_verifier" ? null : { statut: "revenu", revenu_le: t, n403: 0, dernier_essai: t };
  if (v.issue === "bloque") {
    const n403 = l.n403 + 1;
    return n403 >= 2 ? { statut: "bloque", constat: v.constat, n403, dernier_essai: t } : { n403, dernier_essai: t };
  }
  const muet = v.constat === "delai" || v.constat === "connexion";
  const statut: Statut = l.statut === "bloque" && muet ? "bloque" : "injoignable";
  return { statut, n403: 0, dernier_essai: t, ...(statut === "bloque" ? {} : { constat: v.constat }) };
}

interface Row extends Omit<Ligne, "sources" | "verifier"> {
  sources: string;
  verifier: string | null;
}

const ligne = (r: Row): Ligne => {
  const parse = <T>(s: string | null, fallback: T): T => {
    try {
      return s ? (JSON.parse(s) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  return { ...r, sources: parse<string[]>(r.sources, []), verifier: parse<Ligne["verifier"]>(r.verifier, null) };
};

/** Every row; none when there is no table or no database. */
export async function lignes(): Promise<Ligne[]> {
  try {
    return await toutes();
  } catch (err) {
    if (!absente(err)) throw err;
    return [];
  }
}

/** Every row; a missing table throws. */
async function toutes(): Promise<Ligne[]> {
  if (!all) return [];
  count(1, "read");
  return (await all<Row>("SELECT * FROM sans_reponse")).map(ligne);
}

/** When the last recheck ran (Unix seconds), or undefined. */
export async function dernierPassage(): Promise<number | undefined> {
  if (!all) return undefined;
  try {
    count(1, "read");
    return (await all<{ t: number }>("SELECT t FROM sans_reponse_passage WHERE id = 1"))[0]?.t;
  } catch (err) {
    if (!absente(err)) throw err;
    return undefined;
  }
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Asks the row once this isolate has left its host alone for CALME_MS; null when it never did, the row then waits. */
async function seul(l: Ligne, now: Date, fetcher: typeof fetch, attendre: (ms: number) => Promise<void>): Promise<Verdict | null> {
  for (let i = 0; i < CALME_ESSAIS; i++) {
    const reste = CALME_MS - (Date.now() - (lectures.get(l.hote) ?? -Infinity));
    if (reste <= 0) return essayer(l, now, fetcher);
    await attendre(reste);
  }
  return null;
}

/**
 * The morning's recheck (worker.ts, the scheduled event at 02:00 UTC, after its reads): each row not « revenu » asked
 * once, alone, the rows come back more than 7 days ago deleted, every write in one batch. Returns what it did, for the
 * Worker's log.
 */
export async function reverifier(now = new Date(), fetcher: typeof fetch = fetch, attendre = pause): Promise<{ essayes: number; changes: string[] } | null> {
  if (!all || !batch) return null;
  const rows = await lignes();
  const t = Math.floor(now.getTime() / 1000);
  const statements: { sql: string; params: unknown[] }[] = [];
  const changes: string[] = [];
  const aEssayer = rows.filter((l) => l.statut !== "revenu");
  for (const l of rows) {
    if (l.statut === "revenu" && l.revenu_le !== null && t - l.revenu_le > GARDE_REVENUS_JOURS * 86_400) {
      statements.push({ sql: "DELETE FROM sans_reponse WHERE hote = ?", params: [l.hote] });
      changes.push(`${l.hote} retiré`);
    }
  }
  for (let i = 0; i < aEssayer.length; i += A_LA_FOIS) {
    const lot = aEssayer.slice(i, i + A_LA_FOIS);
    // A row past the budget, or whose host this isolate never left alone, is left for the next morning.
    const verdicts = await Promise.all(lot.map((l) => seul(l, now, fetcher, attendre).catch(() => null)));
    lot.forEach((l, j) => {
      const v = verdicts[j];
      if (!v) return;
      const s = suite(l, v, t);
      if (s === null) {
        statements.push({ sql: "DELETE FROM sans_reponse WHERE hote = ?", params: [l.hote] });
        changes.push(`${l.hote} répond (jamais affiché)`);
        return;
      }
      const cols = Object.keys(s) as (keyof Ligne)[];
      statements.push({ sql: `UPDATE sans_reponse SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE hote = ?`, params: [...cols.map((c) => s[c]), l.hote] });
      if (s.statut && s.statut !== l.statut) changes.push(`${l.hote} : ${l.statut} → ${s.statut}`);
    });
  }
  statements.push({ sql: "INSERT INTO sans_reponse_passage (id, t) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET t = excluded.t", params: [t] });
  try {
    count(1, true);
    await batch(statements);
  } catch (err) {
    if (absente(err)) return null;
    throw err;
  }
  // This isolate's states are read again at its next failure.
  etats = undefined;
  return { essayes: aEssayer.length, changes };
}

/** The scheduled event's run that does the recheck: the one between 02:00 and 02:05 UTC, 06:00 in La Réunion. */
export const heureDuPassage = (now: Date) => now.getUTCHours() === 2 && now.getUTCMinutes() < 5;

// ---------------------------------------------------------------- What is shown

/** The commune whose own site a source reads (agenda.ts), if any. */
function communeDe(source: string): string | undefined {
  const a = [...LISIBLES, ...ACTUS_MAIRIES].find((x) => x.source.id === source && x.site_commune);
  return a?.commune;
}

/** A commune that has not agreed to the reuse of one of its sources, whichever (autorisations.ts). */
const enAttente = (commune: string | undefined) =>
  !!commune && Object.values(AUTORISATIONS).some((a) => a.commune === commune && a.etat !== "accordee" && a.etat !== "permise");

export interface Public extends Ligne {
  nom: string;
  theme: string;
  manque: string | null;
}

/**
 * The rows shown: confirmed by a recheck, and none whose commune has not agreed to its reuse. A row that does not
 * name its editor or what it is missing takes them from its sources.
 */
export function publiques(rows: Ligne[]): Public[] {
  return rows
    .filter((l) => l.statut !== "a_verifier")
    .filter((l) => !l.sources.some((s) => enAttente(communeDe(s))))
    .map((l) => {
      const connues = l.sources.map((s) => registre.get(s)).filter((s): s is SourceInfo => !!s);
      return {
        ...l,
        nom: l.nom ?? connues[0]?.organisme ?? l.hote,
        theme: l.theme ?? "Autres sites",
        manque: l.manque ?? (connues.length ? connues.map((s) => s.nom).join("\u00a0; ") : null),
      };
    })
    .sort((a, b) => a.premier_echec - b.premier_echec);
}

const PAROLES: Record<string, string> = {
  maintenance: "page de maintenance affichée",
  delai: "pas de réponse dans le délai",
  connexion: "connexion impossible",
  dns: "adresse du site introuvable",
  http_404: "pages introuvables (404)",
};

/** What was seen, in plain words (never the code alone); none for a « bloque » row, its state says it. */
export function constatEnMots(constat: string): string | undefined {
  const http = /^http_(5\d\d)$/.exec(constat);
  if (http) return `erreur du serveur (${http[1]})`;
  return PAROLES[constat];
}

const LOCAL_MS = 4 * 3600_000;
const iso = (t: number) => new Date(t * 1000 + LOCAL_MS).toISOString();
/** « 24/10 », La Réunion's day of a Unix time. */
export const jour = (t: number) => `${iso(t).slice(8, 10)}/${iso(t).slice(5, 7)}`;
/** « 25/10 à 21:46 ». */
export const jourHeure = (t: number) => `${jour(t)} à ${iso(t).slice(11, 16)}`;

/** The words of a row's state: « sans réponse depuis le 24/10 »… */
export function statutEnMots(l: Public): string {
  if (l.statut === "revenu") return `répond de nouveau depuis le ${jour(l.revenu_le ?? l.dernier_essai ?? l.premier_echec)}`;
  if (l.statut === "bloque") return `répond, mais pas à nos lectures, depuis le ${jour(l.premier_echec)}`;
  return `sans réponse depuis le ${jour(l.premier_echec)}`;
}

// ---------------------------------------------------------------- Read by the page and the tool

const FRAIS_S = 900;

/**
 * The rows and the last recheck, read at most every 15 minutes by each data center (the page and the tool alike). A
 * missing table is not kept as an empty list: the cache asks again a minute later (its failure backoff, cache.ts), so
 * that the rows show within a minute of the table's creation, not 15.
 */
export async function etat(cache: Pick<Cache, "get">): Promise<{ lignes: Ligne[]; passage?: number; lu: Date }> {
  try {
    const c = await cache.get("sans-reponse", FRAIS_S, async () => ({ lignes: await toutes(), passage: await dernierPassage() }));
    return { ...c.value, lu: c.fetchedAt };
  } catch (err) {
    if (!absente(err)) throw err;
    return { lignes: [], lu: new Date() };
  }
}

/**
 * One host's state as the page shows it (« ipgp.fr », « www.ipgp.fr » alike), for another answer to say its source is
 * silent (the volcano's, ipgp.fr): undefined when the host is not listed, still « a_verifier » or never shown. Read from
 * the same copy as the page, no call of its own.
 */
export async function etatHote(cache: Pick<Cache, "get">, hote: string): Promise<Public | undefined> {
  const h = hoteDe(`https://${hote}/`);
  return publiques((await etat(cache)).lignes).find((l) => l.hote === h);
}
