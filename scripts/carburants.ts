/**
 * The month's maximum fuel prices (src/providers/carburants.ts) as JSON for the Worker's KV store:
 * `npx tsx scripts/carburants.ts carburants.json`. Run every day by .github/workflows/carburants.yml. Writes the
 * newest order found; fails when none can be read, or when this month's is still missing after its second day, so
 * that the workflow's failure says the order was not found (the last one stays in the store meanwhile).
 */
import { writeFileSync } from "node:fs";
import "../src/bin/net.js";
import { gather, monthOf } from "../src/providers/carburants.js";

const out = process.argv[2];
if (!out) throw new Error("usage : npx tsx scripts/carburants.ts <fichier.json>");
const now = new Date();
// One page of the prefecture's site a minute at most: the list, then the release (two pages, most days).
const p = await gather(now, 4, 60_000);
if (!p) throw new Error("aucun communiqué des prix des carburants lisible sur le site de la préfecture");
writeFileSync(out, JSON.stringify(p));
console.log(`prix de ${monthOf(p.depuis)} : ${p.produits.map((x) => `${x.produit} ${x.prix_eur} €`).join(", ")}`);
const local = new Date(now.getTime() + 4 * 3600_000).toISOString();
if (p.depuis.slice(0, 7) < local.slice(0, 7) && Number(local.slice(8, 10)) > 2) {
  console.error(`::error::Prix des carburants de ${monthOf(local.slice(0, 10))} introuvables : ceux de ${monthOf(p.depuis)} restent servis.`);
  process.exitCode = 1;
}
