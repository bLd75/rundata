/** The bus timetables from the rows scripts/build-transit.py writes (dist/transit-rows.json), for the Node server. */
import { readFileSync } from "node:fs";
import type { TransitDb } from "../providers/transit.js";

export function localTransit(path: string): TransitDb {
  const rows = JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, { id: number }[]>>;
  const by = new Map<string, Map<number, object>>();
  for (const [feed, tables] of Object.entries(rows)) for (const [table, list] of Object.entries(tables)) by.set(`${feed}|${table}`, new Map(list.map((r) => [r.id, r])));
  return {
    // The queries of providers/transit.ts: a table, and [feed, id] pairs as their only parameter.
    all: async <T>(sql: string, keys: unknown) => {
      const table = /FROM passes/.test(sql) ? "passes" : /FROM pattern_stops/.test(sql) ? "pattern_stops" : "patterns";
      return (JSON.parse(String(keys)) as [string, number][]).flatMap(([feed, id]) => {
        const r = by.get(`${feed}|${table}`)?.get(id);
        return r ? [{ feed, ...r }] : [];
      }) as T[];
    },
  };
}
