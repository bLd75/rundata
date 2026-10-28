/**
 * One page of reunion.gouv.fr a minute at most from a machine of the project, whatever the collector asks it
 * (scripts/prefecture.ts, scripts/carburants.ts): the site bans our address on bursts (24/10/2026). Their units run them
 * one at a time under one lock (flock on reunion-gouv.lock, beside the file below); the time of the last page asked,
 * by either, is kept in that file, and a page waits GAP_MS after it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const FILE = join(homedir(), ".local/state/rundata-collecte/reunion-gouv.derniere");
export const GAP_MS = 62_000;

/** Waits until GAP_MS have passed since the last page asked by any collector. */
export async function waitTurn(): Promise<void> {
  let last = 0;
  try {
    last = Number(readFileSync(FILE, "utf8").trim()) || 0;
  } catch {
    // No page asked yet on this machine.
  }
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, GAP_MS)));
}

/** Notes that a page was just asked (answered or not). */
export function asked(): void {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, String(Date.now()));
}
