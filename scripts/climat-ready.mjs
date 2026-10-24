/**
 * Fails when the climate archive is not in the D1 database yet: it is imported once by hand
 * (`python3 -I scripts/build-climat.py --dir … --out dist/climat.sql`, then `wrangler d1 execute rundata-climat --remote --file dist/climat.sql`;
 * the hourly one the same way with scripts/build-climat-h.py and rundata-climat-h), before the first deployment of a
 * version that reads it.
 *
 * Usage: wrangler d1 execute rundata-climat --remote --json --command "SELECT COUNT(*) AS n FROM postes" | node scripts/climat-ready.mjs [horaire]
 */
import { readFileSync } from "node:fs";

let n = 0;
try {
  n = JSON.parse(readFileSync(0, "utf8")).flatMap((r) => r.results ?? [])[0]?.n ?? 0;
} catch {}
// Some 250 stations in the daily archive since 1900, some 100 in the hourly one since 2000.
const hourly = process.argv[2] === "horaire";
const what = hourly ? "L'archive horaire" : "L'archive climatologique";
if (n < (hourly ? 50 : 100)) {
  console.error(`${what} est absente de D1 (${n} stations). L'importer d'abord avec scripts/build-climat${hourly ? "-h" : ""}.py.`);
  process.exit(1);
}
console.log(`${what} est dans D1 (${n} stations).`);
