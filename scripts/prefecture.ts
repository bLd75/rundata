/**
 * The prefecture's press releases (src/providers/prefecture.ts `lireSite`) read from a machine of the project and written
 * to the Worker's KV store (src/providers/prefecture-copie.ts), where the Worker reads them: the prefecture's site cuts
 * the connection of Cloudflare's Workers (HTTP 520, 28/10/2026), while it answers that machine. With them, the pages of
 * the releases the volcano's phase is read from (src/providers/volcan.ts), which the Worker no longer reads either.
 * `npx tsx scripts/prefecture.ts [--kv]`, every 15 minutes with --kv (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in
 * the environment, scripts/kv.ts). Without --kv, prints what it read and writes nothing. Fails when the list cannot be
 * read: the copy in the store stays, said with its time by the Worker.
 */
import "../src/bin/net.js";
import { KV_KEY, KV_TTL_SECONDS, PAGE_AGAIN_MS, pageKey, type Copie, type PageCopie } from "../src/providers/prefecture-copie.js";
import { getPage, lireSite } from "../src/providers/prefecture.js";
import { doubtful, phaseOf, readReleasePage, volcanicPage, type Page } from "../src/providers/volcan.js";
import { UpstreamError, why } from "../src/types.js";
import { getKv, putKv } from "./kv.js";
import { asked, waitTurn } from "./reunion-gouv.js";

// One page of the prefecture's site a minute at most, with the other collectors' (scripts/reunion-gouv.ts): the list,
// and the cyclone's section when its menu links one. A page whose connection fails (no HTTP answer) is asked again a
// minute later, TRIES times at most; an HTTP error is never asked again.
const TRIES = 3;

async function read(url: string): Promise<string> {
  for (let n = 1; ; n++) {
    await waitTurn();
    try {
      return await getPage(url);
    } catch (err) {
      if (n >= TRIES || !(err instanceof UpstreamError) || err.status !== undefined) throw err;
      console.error(`${err.message} (${url}), essai ${n} sur ${TRIES} : nouvel essai dans une minute`);
    } finally {
      asked();
    }
  }
}

const kv = process.argv.includes("--kv");
const lu_le = new Date().toISOString();
const c: Copie = { ...(await lireSite(read)), lu_le };
console.log(`${c.liste.length} communiqués lus, le plus récent du ${c.liste[0].publie.slice(0, 10)} : « ${c.liste[0].titre} »${c.rubrique_non_lue ? " ; rubrique cyclone non lue" : ""}`);
if (kv) {
  await putKv(KV_KEY, c, KV_TTL_SECONDS);
  console.log(`écrit dans KV : ${KV_KEY}`);
}

// The pages of releases a run reads at most, beside the list: the others wait for the next run.
const PAGES_MAX = 3;
let pagesAsked = 0;
// The pages already had in this run: a release both doubtful and in force is asked once.
const known = new Map<string, Promise<Page | undefined>>();

/** A release's page: its copy while it is younger than a day, else read again, and copied with --kv. */
function pageOf(lien: string): Promise<Page | undefined> {
  if (!known.has(lien)) known.set(lien, readOrCopy(lien));
  return known.get(lien)!;
}

async function readOrCopy(lien: string): Promise<Page | undefined> {
  const had = kv ? await getKv<PageCopie>(pageKey(lien)) : undefined;
  if (had?.page && Date.now() - had.lu < PAGE_AGAIN_MS) return had.page;
  if (pagesAsked >= PAGES_MAX) {
    console.log(`page ${lien} : lue au passage suivant`);
    return had?.page;
  }
  pagesAsked++;
  try {
    const page = await readReleasePage(lien, read);
    if (kv) await putKv(pageKey(lien), { page, lu: Date.now() } satisfies PageCopie, KV_TTL_SECONDS);
    console.log(`page lue${kv ? " et écrite dans KV" : ""} : ${lien}, ${page.phrases.length} phrases`);
    return page;
  } catch (err) {
    // The list is written: the run fails for the page alone, its copy kept as it was.
    process.exitCode = 1;
    console.error(`page non lue : ${lien} : ${why(err)}`);
    return had?.page;
  }
}

// As the Worker reads the phase (volcan.ts readPhase): the pages of the releases whose list does not say whether they
// are about the volcano, then the page of the release in force.
const pages = new Map<string, Page>();
for (const r of doubtful(c.liste)) {
  const page = await pageOf(r.lien);
  if (page && volcanicPage(page)) pages.set(r.lien, page);
}
const phase = phaseOf(c.liste, pages);
if (phase) await pageOf(phase.lien);
