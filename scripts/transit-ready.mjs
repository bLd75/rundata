/**
 * Fails when the bus timetables this version reads are not all in the D1 database yet. A network whose timetables
 * changed is imported first (`scripts/build-transit.py --d1 rundata-transports`, then the SQL it writes), then the
 * Worker is deployed: deployed before, it would find no departure for that network.
 *
 * Usage: wrangler d1 execute rundata-transports --remote --json --command "SELECT feed FROM feeds" | node scripts/transit-ready.mjs
 */
import { readFileSync } from "node:fs";

const network = JSON.parse(readFileSync(new URL("../src/transit/network.json", import.meta.url), "utf8"));
const answer = JSON.parse(readFileSync(0, "utf8"));
const present = new Set(answer.flatMap((r) => r.results ?? []).map((r) => r.feed));
const missing = Object.entries(network.networks).filter(([, n]) => !present.has(n.feed));
if (missing.length) {
  console.error(`Horaires absents de D1 pour : ${missing.map(([id, n]) => `${id} (${n.feed})`).join(", ")}. Importer d'abord avec scripts/build-transit.py --d1.`);
  process.exit(1);
}
console.log(`Les ${present.size} réseaux de cette version sont dans D1.`);
