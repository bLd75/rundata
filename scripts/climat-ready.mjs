/**
 * Fails when the climate archive is not in the D1 database yet: it is imported once by hand
 * (`python3 -I scripts/build-climat.py --dir … --out dist/climat.sql`, then `wrangler d1 execute rundata-climat --remote --file dist/climat.sql`),
 * before the first deployment of a version that reads it.
 *
 * Usage: wrangler d1 execute rundata-climat --remote --json --command "SELECT COUNT(*) AS n FROM postes" | node scripts/climat-ready.mjs
 */
import { readFileSync } from "node:fs";

let n = 0;
try {
  n = JSON.parse(readFileSync(0, "utf8")).flatMap((r) => r.results ?? [])[0]?.n ?? 0;
} catch {}
if (n < 100) {
  console.error(`Archive climatologique absente de D1 (${n} stations). L'importer d'abord avec scripts/build-climat.py.`);
  process.exit(1);
}
console.log(`L'archive climatologique est dans D1 (${n} stations).`);
