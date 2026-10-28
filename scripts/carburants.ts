/**
 * The month's maximum fuel prices (src/providers/carburants.ts) as JSON for the Worker's KV store:
 * `npx tsx scripts/carburants.ts carburants.json [--kv]`. Run every day on a machine of the project with --kv, which
 * also writes the JSON to the store
 * (`carburants:prix`, kept 90 days; CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment, scripts/kv.ts):
 * the prefecture's site refuses GitHub's runners now and then (« fetch failed », 25/10 to 28/10/2026). By hand from
 * GitHub: .github/workflows/carburants.yml. Writes the newest order found; fails when none can be read, or when this
 * month's is still missing after its second day, so that the failure says the order was not found (the last one stays
 * in the store meanwhile).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import "../src/bin/net.js";
import { gather, monthOf } from "../src/providers/carburants.js";
import { putKv } from "./kv.js";

const out = process.argv[2];
if (!out || out.startsWith("--")) throw new Error("usage : npx tsx scripts/carburants.ts <fichier.json> [--kv]");
const now = new Date();
// One page of the prefecture's site a minute at most: the list, then the release (two pages, most days).
const p = await gather(now, 4, 60_000);
if (!p) throw new Error("aucun communiqué des prix des carburants lisible sur le site de la préfecture");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(p));
console.log(`prix de ${monthOf(p.depuis)} : ${p.produits.map((x) => `${x.produit} ${x.prix_eur} €`).join(", ")}`);
const local = new Date(now.getTime() + 4 * 3600_000).toISOString();
if (p.depuis.slice(0, 7) < local.slice(0, 7) && Number(local.slice(8, 10)) > 2) {
  console.error(`::error::Prix des carburants de ${monthOf(local.slice(0, 10))} introuvables : ceux de ${monthOf(p.depuis)} restent servis.`);
  process.exitCode = 1;
} else if (process.argv.includes("--kv")) {
  await putKv("carburants:prix", p, 90 * 86_400);
  console.log("écrit dans KV : carburants:prix");
}
