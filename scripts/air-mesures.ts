/**
 * What the scheduled event would keep of the LCSQA's files for the measures at Atmo Réunion's stations
 * (src/providers/air-mesures.ts `collect`), read here as it reads them, line by line: `npx tsx scripts/air-mesures.ts`.
 * Writes nothing; prints what it read.
 */
import "../src/bin/net.js";
import { collect, POLLUTANTS, type Copie } from "../src/providers/air-mesures.js";

let copie: Copie | undefined;
console.log(`${await collect(null, async (c) => void (copie = c))} (essai à blanc : rien dans KV)`);
if (copie) console.log(Object.keys(POLLUTANTS).map((p) => `${p} ${copie!.mesures.filter((m) => m.polluant === p).length}`).join(", "));
