/**
 * The collector of the OVPF's releases posted as images (src/providers/ovpf-ocr.ts): reads the observatory's Bluesky
 * feed once, and the first image of each post given in images that it has not read yet, with Tesseract (French); then
 * stores what it read, or why it kept nothing (« non_lu »), in the Worker's KV store under `ovpf:ocr:<post>`, kept
 * 90 days. Each post is read once: those already stored are listed in a local state file, and KV is written only for
 * a new result.
 *
 * Run every five minutes on a machine of the project, outside GitHub (its scheduled jobs start late or not at all):
 * `npx tsx scripts/ovpf-ocr.ts`. When that machine is off, nothing is read, and the site says the posts as images
 * not read, as before: the text only adds to it.
 *
 * Needs `tesseract` with the French data (Debian, Ubuntu: tesseract-ocr-fra), and in the environment
 * CLOUDFLARE_API_TOKEN (a token that may write to Workers KV, nothing else) and CLOUDFLARE_ACCOUNT_ID. Optional:
 * TESSERACT (the program, « tesseract » by default), and the state file's folder as OVPF_OCR_STATE (by default
 * $XDG_STATE_HOME/rundata-ovpf-ocr, else ~/.local/state/rundata-ovpf-ocr).
 * `--essai`: reads and prints, writes nothing (neither KV nor the state file).
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import "../src/bin/net.js";
import { getBytes, getJson } from "../src/http.js";
import { KEY, readPage, type Stocke, toRead, type FeedJson } from "../src/providers/ovpf-ocr.js";
import { activityPosts, FEED } from "../src/providers/volcan.js";
import { UpstreamError } from "../src/types.js";

const run = promisify(execFile);
const essai = process.argv.includes("--essai");
const TESSERACT = process.env.TESSERACT ?? "tesseract";
const dir = process.env.OVPF_OCR_STATE ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "rundata-ovpf-ocr");
const STATE = join(dir, "lus.json");
// Kept 90 days, as the fuel prices: longer than a post stays in the feed's last 30.
const TTL_SECONDS = 90 * 86_400;
// A post whose image cannot be fetched or read: tried again at the next runs, then stored as « non_lu ».
const ESSAIS = 3;
// At most this many images a run (the first run, or after days off): the newest first, the others at the next runs.
const PAR_PASSAGE = 5;

/** The posts already stored (their id, when), and those that failed (their id, how many times). */
interface Etat {
  lus: Record<string, string>;
  echecs: Record<string, number>;
}

function etat(): Etat {
  try {
    const e = JSON.parse(readFileSync(STATE, "utf8")) as Partial<Etat>;
    return { lus: e.lus ?? {}, echecs: e.echecs ?? {} };
  } catch {
    return { lus: {}, echecs: {} };
  }
}

function save(e: Etat) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${STATE}.tmp`, JSON.stringify(e, null, 1));
  renameSync(`${STATE}.tmp`, STATE);
}

// The namespace of the binding STORE, as wrangler.jsonc gives it.
function namespace(): string {
  const m = /"binding":\s*"STORE",\s*"id":\s*"([0-9a-f]{32})"/.exec(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  if (!m) throw new Error("namespace KV STORE introuvable dans wrangler.jsonc");
  return m[1];
}

async function store(key: string, value: Stocke) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error("CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN sont nécessaires");
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespace()}/values/${encodeURIComponent(key)}?expiration_ttl=${TTL_SECONDS}`;
  const res = await fetch(url, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(value), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`écriture KV de ${key} refusée : HTTP ${res.status}`);
}

async function ocr(image: string): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), "ovpf-ocr-"));
  try {
    const file = join(tmp, "page");
    writeFileSync(file, Buffer.from(await getBytes("ovpf_bluesky", image, 30_000)));
    return (await run(TESSERACT, [file, "stdout", "-l", "fra", "tsv"], { timeout: 120_000, maxBuffer: 8 << 20 })).stdout;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const e = etat();
// The feed read on api.bsky.app: public.api.bsky.app, which the Worker reads, refuses this machine's address
// (HTTP 403, since 28/10/2026). The Worker's host again, should the other one refuse it in turn.
type Feed = FeedJson & Parameters<typeof activityPosts>[0];
const feed = await getJson<Feed>("ovpf_bluesky", FEED.replace("//public.api.bsky.app/", "//api.bsky.app/")).catch((err) => {
  if (err instanceof UpstreamError && err.status === 403) return getJson<Feed>("ovpf_bluesky", FEED);
  throw err;
});
const todo = toRead(feed, activityPosts(feed)).filter((x) => !e.lus[x.id]).slice(0, PAR_PASSAGE);
const outil = todo.length ? `${(await run(TESSERACT, ["--version"])).stdout.split("\n")[0].trim()}, fra` : "";
let failed = false;
for (const { post, id, image } of todo) {
  let value: Stocke;
  try {
    value = { ...readPage(await ocr(image), post.date), lu_a: new Date().toISOString(), outil };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    const n = (e.echecs[id] ?? 0) + 1;
    console.error(`ovpf-ocr : ${id} (${post.date}) : image non lue (${n}/${ESSAIS}) : ${why}`);
    if (!essai) e.echecs[id] = n;
    if (n < ESSAIS) continue;
    value = { statut: "non_lu", raison: `image non lue après ${ESSAIS} essais : ${why}`, lu_a: new Date().toISOString(), outil };
  }
  console.log(`ovpf-ocr : ${id} (${post.date}) : ${value.statut === "lu" ? `lu, ${value.mots} mots, confiance ${value.confiance}, « ${value.niveau_lu} »` : `non lu : ${value.raison}`}`);
  if (essai) {
    console.log(JSON.stringify(value, null, 1));
    continue;
  }
  try {
    await store(KEY(id), value);
    e.lus[id] = value.lu_a;
    delete e.echecs[id];
  } catch (err) {
    console.error(`ovpf-ocr : ${id} : ${err instanceof Error ? err.message : String(err)}`);
    failed = true;
  }
}
if (!essai) save(e);
if (failed) process.exitCode = 1;
