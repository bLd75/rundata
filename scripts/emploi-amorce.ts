/**
 * The offers open at La Réunion on Choisir le service public, read once from the site's search pages and each offer's
 * page, to start the KV store's copy (src/providers/emploi.ts) with what the feed's 20 latest offers lack. Off the
 * Worker, one page a minute: `npx tsx scripts/emploi-amorce.ts <dossier>`. Writes nothing to KV: <dossier>/copie.json
 * holds the copy, in the store's format, for whoever writes it. What is read goes to <dossier>/offres.jsonl as it
 * comes, so that a stopped run starts again where it was.
 */
import "../src/bin/net.js";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getText } from "../src/http.js";
import { type Copie, type Offre, ouverte, parseFiche, parseRecherche, SOURCE, withFiche } from "../src/providers/emploi.js";

const dir = process.argv[2];
if (!dir) throw new Error("usage : npx tsx scripts/emploi-amorce.ts <dossier>");
mkdirSync(dir, { recursive: true });
const SEARCH = "https://choisirleservicepublic.gouv.fr/nos-offres/filtres/localisation/274/";
// One page a minute on the site, whatever answered.
const PAUSE_MS = 62_000;
const MAX_PAGES = 60;

const at = () => new Date().toLocaleTimeString("fr-FR", { timeZone: "Indian/Reunion" });
let last = 0;
async function read(url: string): Promise<string> {
  const wait = last + PAUSE_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  return getText(SOURCE.id, url, 60_000);
}

// What a run before this one read: the list, then each offer's page.
const listFile = join(dir, "liste.json");
const doneFile = join(dir, "offres.jsonl");
let list: Offre[] = existsSync(listFile) ? JSON.parse(readFileSync(listFile, "utf8")) : [];
const done = new Map<string, Offre>(existsSync(doneFile) ? readFileSync(doneFile, "utf8").split("\n").filter(Boolean).map((l) => { const o = JSON.parse(l) as Offre; return [o.ref, o]; }) : []);

if (!list.length) {
  const seen = new Map<string, Offre>();
  for (let n = 1; n <= MAX_PAGES; n++) {
    const html = await read(n === 1 ? SEARCH : `${SEARCH}page/${n}/`);
    const page = parseRecherche(html);
    const total = /<span class="number">(\d+)<\/span>/.exec(html)?.[1];
    // The days of the page, to see how the site orders its results.
    console.log(`${at()} page ${n} : ${page.length} offres${total ? ` sur ${total}` : ""}, du ${page.at(-1)?.publiee.slice(0, 10)} au ${page[0]?.publiee.slice(0, 10)}`);
    if (!page.length) break;
    for (const o of page) if (!seen.has(o.ref)) seen.set(o.ref, o);
  }
  list = [...seen.values()];
  writeFileSync(listFile, JSON.stringify(list));
  console.log(`${at()} liste : ${list.length} offres distinctes`);
}

// Each offer's page once; one more try at the end for those that did not answer.
for (const pass of [1, 2]) {
  for (const o of list) {
    const had = done.get(o.ref);
    if (had?.fiche === "lue" || had?.fiche === "abandon" || (pass === 1 && had)) continue;
    let r: Offre;
    try {
      r = withFiche(o, parseFiche(await read(o.lien)));
    } catch (err) {
      console.log(`${at()} ${o.ref} : ${err instanceof Error ? err.message : err}`);
      r = { ...o, fiche: pass === 1 ? "relire" : "abandon" };
    }
    done.set(o.ref, r);
    appendFileSync(doneFile, `${JSON.stringify(r)}\n`);
    if (done.size % 25 === 0) console.log(`${at()} ${done.size} pages d'offre sur ${list.length}`);
  }
}

const now = new Date();
const offres = [...done.values()].filter((o) => ouverte(o, now)).sort((a, b) => b.publiee.localeCompare(a.publiee) || a.ref.localeCompare(b.ref));
const copie: Copie = { lu: now.toISOString(), offres };
writeFileSync(join(dir, "copie.json"), JSON.stringify(copie));
const n = (f: (o: Offre) => boolean) => offres.filter(f).length;
console.log(`${at()} copie.json : ${offres.length} offres ouvertes (${done.size - offres.length} closes), ${n((o) => !!o.limite)} avec date limite, ${n((o) => !!o.commune)} avec commune, ${n((o) => !!o.employeur)} avec employeur, ${n((o) => o.fiche !== "lue")} sans page lue, ${JSON.stringify(copie).length} octets`);
