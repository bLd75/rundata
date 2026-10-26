import { perInvocation } from "../budget.js";

/**
 * Where a cold view of the agendas' pages waits: one line per view in the Worker's logs (web/site.ts), each step timed.
 * The agendas answer from their copies after GRACE_MS (tools/agenda.ts), yet these views still take 5 to 8 s: the
 * fetches still in flight when the agendas are given up on, and those waiting for a place (http.ts), say whether the
 * steps after them wait for a connection.
 */
export const MESURES = new Set(["web:agenda", "web:enfants"]);

export interface Mesure {
  /** The stores read before the agendas start (their bundle, the scheduled event's copies), ms. */
  avant?: number;
  /** The agendas, until each answered or was given up on, ms. */
  agendas?: number;
  /** The agendas still loading when given up on, and the invocation's fetches then holding a place or waiting for one. */
  enCours?: number;
  places?: { taken: number; waiting: number };
  /** The news's copy, read for the cancellations, ms. */
  actualites?: number;
  /** The page's data built, ms, and when it ended (to time its copy's write after it). */
  construction?: number;
  finConstruction?: number;
  /** The copy written, ms after the build ended. */
  ecriture?: number;
}

/** This invocation's measure (an empty one outside a counted invocation: tests, Node). */
export const mesure = () => perInvocation("mesure:vue", (): Mesure => ({}));

/** The line, once the page is rendered: only for a view that built its page's data, and said in French like the others. */
export function ligne(key: string, m: Mesure, rendu: number): string | undefined {
  if (!MESURES.has(key) || m.construction == null) return undefined;
  const ms = (n: number | undefined) => (n == null ? "?" : `${n} ms`);
  return `vue ${key} : avant les agendas ${ms(m.avant)}, agendas ${ms(m.agendas)} (${m.enCours ?? "?"} encore en cours, places http ${m.places?.taken ?? "?"} prises et ${m.places?.waiting ?? "?"} en attente), actualités ${ms(m.actualites)}, construction ${ms(m.construction)}, écriture ${ms(m.ecriture)}, rendu ${ms(rendu)}`;
}
