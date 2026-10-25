/**
 * The events the clubs and associations proposed on rundata.re (src/propositions.ts, /associations/proposer), once read
 * by the moderation: an agenda like the others, read from the D1 table rather than from a site. Each event says it was
 * proposed by its organiser on rundata.re and when, never that it was checked; its author's address is never part of
 * it, its public contact only when the author asked for one. Published under Licence Ouverte 2.0, the licence the
 * author accepted.
 */
import type { Cached } from "../cache.js";
import { addMonths, lisible, visibles, type Ligne } from "../propositions.js";
import type { SourceInfo } from "../types.js";
import type { Agenda, AgendaStore, Evenement, Seance } from "./agenda.js";

export const SOURCE = {
  id: "propositions_associations",
  nom: "Événements proposés par les clubs et associations sur rundata.re",
  organisme: "Clubs et associations de La Réunion",
  licence: "Licence Ouverte 2.0 (Etalab)",
  attribution: "l'association organisatrice de chaque événement, via rundata.re",
  url: "https://rundata.re/associations",
} satisfies SourceInfo;

export const ID = "propositions";
// Read again every quarter of an hour: a proposal the moderation publishes shows within it; a change by its author
// (called off, postponed, contact removed) is written into the copy at once (tools/agenda.ts, `rafraichirPropositions`).
const FRESH_SECONDS = 900;
/** A repeated event's occurrences told at most: three months of weeks. */
const OCCURRENCES_MAX = 14;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const localDay = (t: number) => new Date(t * 1000 + 4 * 3600_000).toISOString().slice(0, 10);

/** Its days: the one given (or the new one of a postponed event), else each week or month until its last. */
export function jours(l: Pick<Ligne, "date" | "repete" | "jusqu_au" | "reporte_au">): string[] {
  const first = l.reporte_au ?? l.date;
  if (!l.repete || !l.jusqu_au || l.reporte_au) return [first];
  const out: string[] = [];
  for (let i = 0; out.length < OCCURRENCES_MAX; i++) {
    const day = l.repete === "semaine" ? addDays(first, 7 * i) : addMonths(first, i);
    if (day > l.jusqu_au) break;
    out.push(day);
  }
  return out;
}

/** One proposal as an agenda's event. An end before its start is the next day's (a soirée until 02:00). */
export function evenement(l: Ligne): Evenement {
  const seances: Seance[] = jours(l).map((day) => ({
    debut: `${day}T${l.debut}`,
    ...(l.fin ? { fin: `${l.fin < l.debut ? addDays(day, 1) : day}T${l.fin}` } : {}),
  }));
  return {
    id: `proposition-${l.id}`,
    titre: l.titre,
    seances,
    lieu: l.lieu,
    commune: l.commune,
    prix: l.prix,
    categories: [],
    description: l.description,
    lien: l.lien ?? "",
    publie_par: l.organisateur,
    ...(l.etat === "annule" ? { statut: "annulé" as const } : l.etat === "reporte" ? { statut: "reporté" as const } : {}),
    ...(l.reporte_au ? { reporte_au: l.reporte_au } : {}),
    propose: { le: localDay(l.t), ...(l.contact_public ? { contact: l.contact_public } : {}) },
  };
}

/** The proposals the public sees, as events; none without the database. */
export async function evenements(now: Date): Promise<Evenement[]> {
  return (await visibles(now)).map(evenement);
}

export const PROPOSITIONS: Agenda = {
  id: ID,
  nom: "Clubs et associations (proposés sur rundata.re)",
  source: SOURCE,
  // Whole island: no commune is « covered » by it.
  couvre: [],
  club: true,
  // Without the database (Node, the tests), nothing, and no subrequest taken from the others.
  load: (cache: AgendaStore, now: Date): Promise<Cached<Evenement[]>> =>
    lisible() ? cache.get(`agenda:${ID}`, FRESH_SECONDS, () => evenements(now)) : Promise.resolve({ value: [], fetchedAt: now, stale: false }),
};
