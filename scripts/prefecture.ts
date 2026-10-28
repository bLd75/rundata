/**
 * The prefecture's press releases (src/providers/prefecture.ts `lireSite`) read from a machine of the project and written
 * to the Worker's KV store (src/providers/prefecture-copie.ts), where the Worker reads them: the prefecture's site cuts
 * the connection of Cloudflare's Workers (HTTP 520, 28/10/2026), while it answers that machine.
 * `npx tsx scripts/prefecture.ts [--kv]`, every 15 minutes with --kv (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in
 * the environment, scripts/kv.ts). Without --kv, prints what it read and writes nothing. Fails when the list cannot be
 * read: the copy in the store stays, said with its time by the Worker.
 */
import "../src/bin/net.js";
import { KV_KEY, KV_TTL_SECONDS, type Copie } from "../src/providers/prefecture-copie.js";
import { getPage, lireSite } from "../src/providers/prefecture.js";
import { UpstreamError } from "../src/types.js";
import { putKv } from "./kv.js";

// One page of the prefecture's site a minute at most (it bans bursts): the list, and the cyclone's section when its
// menu links one. A page whose connection fails (no HTTP answer) is asked again a minute later, TRIES times at most;
// an HTTP error is never asked again.
const PAUSE_MS = 60_000;
const TRIES = 3;

let asked = 0;
async function read(url: string): Promise<string> {
  for (let n = 1; ; n++) {
    if (asked++) await new Promise((r) => setTimeout(r, PAUSE_MS));
    try {
      return await getPage(url);
    } catch (err) {
      if (n >= TRIES || !(err instanceof UpstreamError) || err.status !== undefined) throw err;
      console.error(`${err.message} (${url}), essai ${n} sur ${TRIES} : nouvel essai dans ${PAUSE_MS / 1000} s`);
    }
  }
}

const lu_le = new Date().toISOString();
const c: Copie = { ...(await lireSite(read)), lu_le };
console.log(`${c.liste.length} communiqués lus, le plus récent du ${c.liste[0].publie.slice(0, 10)} : « ${c.liste[0].titre} »${c.rubrique_non_lue ? " ; rubrique cyclone non lue" : ""}`);
if (process.argv.includes("--kv")) {
  await putKv(KV_KEY, c, KV_TTL_SECONDS);
  console.log(`écrit dans KV : ${KV_KEY}`);
}
