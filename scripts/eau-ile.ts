/**
 * The water of the whole island (src/eau/ile.ts) as JSON for the Worker's KV store: `npx tsx scripts/eau-ile.ts eau-ile.json`.
 * Run four times a day by .github/workflows/eau.yml. Fails without writing when most sources did not answer: better
 * the last good copy than a thin one.
 */
import { writeFileSync } from "node:fs";
import "../src/bin/net.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { gather } from "../src/eau/ile.js";
import { SITES } from "../src/providers/baignades.js";

const out = process.argv[2];
if (!out) throw new Error("usage : npx tsx scripts/eau-ile.ts <fichier.json>");
const ile = await gather(new Cache(new MemoryStore()));
if (ile.baignades.length < SITES.length / 2) throw new Error(`seulement ${ile.baignades.length} sites de baignade sur ${SITES.length}`);
if (ile.communes.length < 12) throw new Error(`seulement ${ile.communes.length} communes sur 24`);
writeFileSync(out, JSON.stringify(ile));
console.log(`${ile.baignades.length} sites de baignade, ${ile.communes.length} communes`);
