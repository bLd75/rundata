/**
 * The prefecture's releases as a machine of the project reads them (scripts/prefecture.ts, every 15 minutes), stored in
 * the Worker's KV: the prefecture's site cuts the connection of Cloudflare's Workers (HTTP 520 to nearly every read from
 * 13:14 to 16:06 on 28/10/2026), while it answers that machine. In the Worker, the news (providers/actualites.ts) and the
 * subjects of the releases (providers/prefecture.ts) read this copy, never the site. Elsewhere (a local server, the
 * tests), nothing is configured and they read the site.
 */
import type { Info } from "./actualites.js";

/** Written by scripts/prefecture.ts, read by worker.ts. */
export const KV_KEY = "prefecture:communiques:collecte";
/** Kept in the store this long after the collector's last write: the readers say how old it is, and stop at 48 h (actualites). */
export const KV_TTL_SECONDS = 7 * 86_400;

export interface Copie {
  /** The latest releases, newest first. */
  liste: Info[];
  /** The cyclone's section, linked by the menu, did not answer: its releases are missing from `liste`. */
  rubrique_non_lue?: true;
  /** When the collector read the site (ISO, UTC). */
  lu_le: string;
}

/**
 * The collector writes every 15 minutes: a copy older than two of its runs and a margin was not renewed, and is said
 * with its time as the copy of a site that did not answer since.
 */
export const SILENT_MS = 40 * 60_000;

let reader: (() => Promise<Copie | null>) | undefined;

/** In the Worker: read the copy from the KV store, where scripts/prefecture.ts writes it, and the site never. */
export function configure(read: (() => Promise<Copie | null>) | undefined) {
  reader = read;
}

/** Whether the copy is what is read (the Worker), rather than the site. */
export const configured = () => reader !== undefined;

/** The stored copy; null when the store has none or nothing is configured. */
export async function copie(): Promise<Copie | null> {
  return reader ? reader() : null;
}
