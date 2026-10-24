/**
 * The feedback people and their assistants leave: through the `donner_avis` tool (canal « mcp ») and the form at the
 * bottom of every page (canal « site », POST /avis). One row each in the D1 table `avis` (scripts/avis.sql), read with
 * a script by whoever runs the service.
 *
 * Kept: the time, the kind, the tool and the place concerned, the message, the client's name when its User-Agent
 * says it (« Claude », « ChatGPT (connecteur) »…), the page of the form. No address: to refuse a flood, each row
 * carries a fingerprint of the sender (a hash of its address and the day, salted with a secret or, without one, a
 * value drawn by each instance), wiped after a day; the table forgets every row after 12 months (both by trigger).
 * Phone numbers and e-mail addresses in a message are blanked before it is written.
 *
 * In the Worker the rows go to D1; in Node, without a database, nothing is kept and the tool says where to write.
 */
import { visitor } from "./metrics.js";

export const TYPES = ["manque", "erreur", "suggestion", "bravo"] as const;
export type TypeAvis = (typeof TYPES)[number];
export type Canal = "mcp" | "site";

export const MESSAGE_MAX = 1000;
export const QUESTION_MAX = 300;
export const COURT_MAX = 100;
// Rows a sender may write in an hour, and all senders together: enough for a conversation, not for a script.
export const PAR_SOURCE_HEURE = 10;
export const EN_TOUT_HEURE = 120;

export interface Avis {
  canal: Canal;
  type?: TypeAvis;
  outil?: string;
  lieu?: string;
  message: string;
  question?: string;
  client?: string;
  page?: string;
}

/** Runs one statement, returns the number of rows it changed. */
export type Run = (sql: string, ...params: unknown[]) => Promise<number>;

let run: Run | undefined;
let sel: string | undefined;

/** `db`: the D1 table's door (worker.ts); `secret`: the salt of the fingerprints, if the Worker has one. */
export function configure(db: Run | undefined, secret?: string) {
  run = db;
  sel = secret || undefined;
}

export const enabled = () => !!run;

// Without a secret, a salt drawn once per instance: the fingerprints can never be traced back to an address.
const ownSalt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/** A short hash of the sender's address and the day: the same within a day, meaningless without the salt. */
export async function empreinte(adresse: string, now: Date): Promise<string> {
  const data = new TextEncoder().encode(`${sel ?? ownSalt}|${now.toISOString().slice(0, 10)}|${adresse}`);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(h.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The sender's address as Cloudflare gives it (or a proxy in front of Node); « » when unknown. */
export function adresseOf(headers: Headers | Record<string, string | string[] | undefined>): string {
  const get = (k: string) => (headers instanceof Headers ? headers.get(k) : [headers[k]].flat()[0]) ?? "";
  return get("cf-connecting-ip") || get("x-forwarded-for").split(",")[0].trim();
}

/** The client, from its User-Agent (metrics.ts); undefined for a browser or an unknown one. */
export function clientOf(userAgent: string): string | undefined {
  const v = visitor(userAgent);
  return v === "navigateur" || v === "inconnu" ? undefined : v;
}

/** Control characters out, spaces folded, phone numbers and e-mail addresses blanked, cut to `max`. */
export function nettoie(s: string | undefined, max: number): string | undefined {
  if (s == null) return undefined;
  const t = s
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[courriel retiré]")
    .replace(/(?:\+|00)?(?:\d[\s.-]?){9,14}\d/g, "[numéro retiré]")
    .trim()
    .slice(0, max);
  return t || undefined;
}

export type Issue = "ok" | "limite" | "indisponible";

const INSERT = `INSERT INTO avis (t, canal, type, outil, lieu, message, question, client, page, source)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
WHERE (SELECT COUNT(*) FROM avis WHERE source = ? AND t > ?) < ? AND (SELECT COUNT(*) FROM avis WHERE t > ?) < ?`;

/**
 * Writes one feedback, in one statement that also refuses it when its sender, or everyone together, has sent too
 * many in the last hour. The message must already be checked (nettoie).
 */
export async function enregistrer(avis: Avis, adresse: string, now = new Date()): Promise<Issue> {
  if (!run) return "indisponible";
  const t = Math.floor(now.getTime() / 1000);
  const source = await empreinte(adresse, now);
  try {
    const changed = await run(
      INSERT,
      t, avis.canal, avis.type ?? null, avis.outil ?? null, avis.lieu ?? null, avis.message, avis.question ?? null, avis.client ?? null, avis.page ?? null, source,
      source, t - 3600, PAR_SOURCE_HEURE, t - 3600, EN_TOUT_HEURE,
    );
    return changed > 0 ? "ok" : "limite";
  } catch (err) {
    console.error("avis : écriture impossible", err instanceof Error ? err.message : String(err));
    return "indisponible";
  }
}
