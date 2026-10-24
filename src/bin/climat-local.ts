/** The climate archive from a local SQLite file (scripts/climat-local.ts), for the Node server. */
import { DatabaseSync } from "node:sqlite";
import type { ClimatDb } from "../providers/climat.js";

export function localClimat(path: string): ClimatDb {
  const db = new DatabaseSync(path, { readOnly: true });
  return { all: async <T>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as (string | number)[])) as T[] };
}
