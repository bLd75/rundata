/**
 * The collector of the OVPF's releases posted as images (src/providers/ovpf-ocr.ts): reads the observatory's Bluesky
 * feed once, and the first image of each post given in images that it has not read yet, with Tesseract (French); then
 * stores what it read, or why it kept nothing (« non_lu »), in the Worker's KV store under `ovpf:ocr:<post>`, kept
 * 90 days. Each post is read once: those already stored are listed in a local state file, and KV is written only for
 * a new result.
 *
 * With ANTHROPIC_API_KEY in the environment, each text read is checked first against its image by a Claude model
 * (src/providers/ovpf-relecture.ts): on its key facts (day, alert level, eruption, place) the text must say what the
 * image says, or it is not stored, but « non lu » with the difference. The model's words never replace Tesseract's.
 * Without the key, or when the check cannot be made, the text is stored as before. Each call adds a line to a file of
 * costs (OVPF_OCR_COUTS, by default $XDG_STATE_HOME/rundata-ia/couts.tsv), tab-separated: its time in La Réunion with
 * the offset, the task, the model, its tokens (input outside the cache, written to the cache, read from it, output),
 * and an empty cost, which the reader of the file computes from its own price table. Optional, two programs run with a message as their last argument: OVPF_OCR_AVIS, for each release
 * stored after the check and each one held back, and OVPF_OCR_PANNE, once, when the check cannot be made, and for
 * each one held back (« notify send », for example: the words are split at spaces).
 *
 * Run every five minutes on a machine of the project, outside GitHub (its scheduled jobs start late or not at all):
 * `npx tsx scripts/ovpf-ocr.ts`. When that machine is off, nothing is read, and the site says the posts as images
 * not read, as before: the text only adds to it.
 *
 * Needs `tesseract` with the French data (Debian, Ubuntu: tesseract-ocr-fra), and in the environment
 * CLOUDFLARE_API_TOKEN (a token that may write to Workers KV, nothing else) and CLOUDFLARE_ACCOUNT_ID. Optional:
 * TESSERACT (the program, « tesseract » by default), and the state file's folder as OVPF_OCR_STATE (by default
 * $XDG_STATE_HOME/rundata-ovpf-ocr, else ~/.local/state/rundata-ovpf-ocr).
 * `--essai`: reads and prints, writes nothing (neither KV nor the state file) and says nothing, but the line of costs.
 */
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import "../src/bin/net.js";
import { getBytes, getJson } from "../src/http.js";
import { KEY, readPage, type Stocke, toRead, type FeedJson } from "../src/providers/ovpf-ocr.js";
import { decide, MODELE, relire, type Usage } from "../src/providers/ovpf-relecture.js";
import { activityPosts, FEED } from "../src/providers/volcan.js";
import { UpstreamError } from "../src/types.js";

const run = promisify(execFile);
const essai = process.argv.includes("--essai");
const TESSERACT = process.env.TESSERACT ?? "tesseract";
const dir = process.env.OVPF_OCR_STATE ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "rundata-ovpf-ocr");
const STATE = join(dir, "lus.json");
const COUTS = process.env.OVPF_OCR_COUTS ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "rundata-ia/couts.tsv");
const KEY_IA = process.env.ANTHROPIC_API_KEY;
// Kept 90 days, as the fuel prices: longer than a post stays in the feed's last 30.
const TTL_SECONDS = 90 * 86_400;
// A post whose image cannot be fetched or read: tried again at the next runs, then stored as « non_lu ».
const ESSAIS = 3;
// At most this many images a run (the first run, or after days off): the newest first, the others at the next runs.
const PAR_PASSAGE = 5;

/**
 * The posts already stored (their id, when), those that failed (their id, how many times), and whether the check's
 * failure was said (said once, until a check is made again).
 */
interface Etat {
  lus: Record<string, string>;
  echecs: Record<string, number>;
  panne?: boolean;
}

function etat(): Etat {
  try {
    const e = JSON.parse(readFileSync(STATE, "utf8")) as Partial<Etat>;
    return { lus: e.lus ?? {}, echecs: e.echecs ?? {}, panne: e.panne };
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

async function ocr(bytes: Uint8Array): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), "ovpf-ocr-"));
  try {
    const file = join(tmp, "page");
    writeFileSync(file, bytes);
    return (await run(TESSERACT, [file, "stdout", "-l", "fra", "tsv"], { timeout: 120_000, maxBuffer: 8 << 20 })).stdout;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Runs the program of `env` with `message`; a failure is logged, never thrown. */
async function say(env: string | undefined, message: string) {
  const [cmd, ...args] = env?.split(" ").filter(Boolean) ?? [];
  if (!cmd || essai) return;
  await run(cmd, [...args, message], { timeout: 30_000 }).catch((err) => console.error(`ovpf-ocr : message non envoyé : ${err instanceof Error ? err.message : String(err)}`));
}

function cost(u: Usage) {
  // La Réunion is UTC+4 all year round.
  const quand = `${new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 19)}+04:00`;
  const cols = [quand, "ovpf-relecture", MODELE, u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens, u.output_tokens, ""];
  mkdirSync(dirname(COUTS), { recursive: true });
  appendFileSync(COUTS, `${cols.join("\t")}\n`);
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
  // What to say once the result is stored: to the user, and to the team.
  const avis: string[] = [];
  const pannes: string[] = [];
  try {
    const bytes = new Uint8Array(await getBytes("ovpf_bluesky", image, 30_000));
    value = { ...readPage(await ocr(bytes), post.date), lu_a: new Date().toISOString(), outil };
    if (value.statut === "lu" && KEY_IA) {
      const lu = value;
      try {
        const { relecture, usage } = await relire(KEY_IA, bytes, lu);
        cost(usage);
        if (essai) console.log(JSON.stringify(relecture, null, 1));
        e.panne = false;
        const d = decide(lu, relecture);
        value = d.value;
        avis.push(d.avis);
        if (value.statut === "non_lu") {
          pannes.push(`Collecte rundata : communiqué OVPF ${post.lien} : texte lu non affiché, la relecture voit un écart avec l'image (${value.raison}). Regarde l'image (${image}) : si la relecture se trompe, c'est un faux positif de la relecture à corriger ; le site donne le lien vers l'image en attendant.`);
        }
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        const u = (err as { usage?: Usage }).usage;
        if (u) cost(u);
        console.error(`ovpf-ocr : ${id} : relecture impossible, texte rangé sans elle : ${why}`);
        if (!e.panne) await say(process.env.OVPF_OCR_PANNE, `Collecte rundata : la relecture des communiqués OVPF par ${MODELE} a échoué (${why}). Le texte lu par Tesseract est rangé sans relecture, comme avant elle. Un seul message jusqu'à la prochaine relecture réussie.`);
        if (!essai) e.panne = true;
      }
    }
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
    for (const m of avis) await say(process.env.OVPF_OCR_AVIS, m);
    for (const m of pannes) await say(process.env.OVPF_OCR_PANNE, m);
  } catch (err) {
    console.error(`ovpf-ocr : ${id} : ${err instanceof Error ? err.message : String(err)}`);
    failed = true;
  }
}
if (!essai) save(e);
if (failed) process.exitCode = 1;
