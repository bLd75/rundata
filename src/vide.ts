/**
 * A tool call that found nothing to answer with: no event, no article naming the place, no match, no stop or line of
 * that name, no public service for the word, no station measuring there. Written « vide » instead of « ok » in the
 * metrics (metrics.ts, blob11), to see the questions left without an answer. Said by the tool where it knows it, in
 * the context of the call, like the cache's reads (lectures.ts); never for an absence the source states (no water cut
 * in the notices, no cyclone, no restriction, no bus in the timetable): that is an answer.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const current = new AsyncLocalStorage<Set<string>>();

/** Runs `fn`, the call of `tool`, and returns with its value whether that tool found nothing. */
export async function withVide<T>(tool: string, fn: () => Promise<T>): Promise<{ value: T; vide: boolean }> {
  const said = new Set<string>();
  const value = await current.run(said, fn);
  return { value, vide: said.has(tool) };
}

/**
 * Said by `tool` when its answer holds nothing found. It counts only in a call of that tool: the same code run for a
 * page, or for resume_du_jour, which gathers several tools, marks nothing.
 */
export function rienTrouve(tool: string) {
  current.getStore()?.add(tool);
}
