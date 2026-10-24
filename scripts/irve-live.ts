/**
 * La Réunion's part of the national live file of charging points, as JSON for the Worker's KV store:
 * `npx tsx scripts/irve-live.ts irve-etat.json`. Run every 15 minutes by .github/workflows/irve.yml.
 * Fails without writing when the file lists too few of the island's points: better the last good copy than none.
 */
import { writeFileSync } from "node:fs";
import "../src/bin/net.js";
import { IDS, LIVE_URL, parseLive } from "../src/providers/irve.js";

const out = process.argv[2];
if (!out) throw new Error("usage : npx tsx scripts/irve-live.ts <fichier.json>");
const r = await fetch(LIVE_URL, { headers: { "user-agent": "reunion-temps-reel (https://rundata.re)" } });
if (!r.ok) throw new Error(`fichier national : HTTP ${r.status}`);
const live = parseLive(await r.text(), IDS);
const n = Object.keys(live.points).length;
if (n < IDS.size / 2) throw new Error(`seulement ${n} points de La Réunion sur ${IDS.size} dans le fichier national`);
writeFileSync(out, JSON.stringify(live));
console.log(`${n} points de La Réunion sur ${IDS.size}`);
