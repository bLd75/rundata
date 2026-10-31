/**
 * Level 3 of the clubs' space (src/clubs/espace.ts): a club whose address no public source gives, checked by hand by
 * the team on its declaration receipt. Writes the club, or withdraws it, in the D1 table `clubs` (scripts/clubs.sql).
 *
 *   npx tsx scripts/club-verifie.ts --nom "Club de pétanque du Tampon" --commune "Le Tampon" --activite "Pétanque" [--le 2026-11-02] [--local] < adresse.txt
 *   npx tsx scripts/club-verifie.ts --retirer --nom "Club de pétanque du Tampon" --commune "Le Tampon" [--local]
 *
 * The address checked is read on the standard input, never on the command line (it would stay in the shell's history
 * and the list of processes); `--le`: the day of the check, today by default. The statement goes through a file of a
 * private temporary folder, deleted at once, to `wrangler d1 execute rundata-transports --remote` (or `--local`). The
 * address is never printed. Running it again for the same club changes its address and its day, and starts its
 * 12 months again; a new address cuts the links sent to the old one. `--retirer`, which holds no address, goes on
 * the command line with `--json`, and fails when its first statement returns no club: none is written by that name.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { INSEE } from "../src/places/insee.js";
import { normalize } from "../src/places/resolve.js";
import { emailOf } from "../src/propositions.js";

export interface Manuel {
  nom: string;
  commune: string;
  activite: string;
  /** The day of the check, « 2026-11-02 ». */
  le: string;
}

const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** The club's identifier among the hand-checked ones: its name and town, as words. */
export const refDe = (m: Pick<Manuel, "nom" | "commune">) => normalize(`${m.nom} ${m.commune}`).replace(/ /g, "-");

/** What is wrong with the club given, if anything. */
export function erreur(m: Manuel): string | undefined {
  if (m.nom.trim().length < 3 || m.nom.length > 120) return "--nom : de 3 à 120 caractères";
  if (!(m.commune in INSEE)) return `--commune : une des 24 communes, écrite comme « Le Tampon » (reçu « ${m.commune} »)`;
  if (m.activite.trim().length < 3 || m.activite.length > 60) return "--activite : de 3 à 60 caractères";
  if (!/^\d{4}-\d\d-\d\d$/.test(m.le) || Number.isNaN(Date.parse(`${m.le}T00:00:00Z`))) return "--le : un jour « 2026-11-02 »";
  return undefined;
}

/**
 * The statements that write the club checked by hand with its address, or give it a new one: then the links sent to
 * the old one are cut first, and its last use forgotten, so that its 12 months start again from the check.
 */
export function ecrire(m: Manuel, email: string, now = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  const ref = sql(refDe(m));
  // Midnight at La Réunion of the day of the check.
  const le = Math.floor(Date.parse(`${m.le}T00:00:00+04:00`) / 1000);
  return `DELETE FROM acces WHERE club IN (SELECT id FROM clubs WHERE source = 'manuel' AND ref = ${ref} AND (email IS NULL OR email <> ${sql(email)}));
INSERT INTO clubs (source, ref, niveau, nom, commune, activite, vu_le, email, adresse_le)
VALUES ('manuel', ${ref}, 3, ${sql(m.nom.trim())}, ${sql(m.commune)}, ${sql(m.activite.trim())}, ${t}, ${sql(email)}, ${le})
ON CONFLICT (source, ref) DO UPDATE SET nom = excluded.nom, activite = excluded.activite, vu_le = excluded.vu_le, email = excluded.email, adresse_le = excluded.adresse_le, retire_le = NULL, utilise_le = NULL;`;
}

/** The statements that withdraw it: no longer proposed, its address wiped, its links cut. The first one returns the club withdrawn. */
export function retirer(m: Pick<Manuel, "nom" | "commune">, now = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  const ref = sql(refDe(m));
  return `UPDATE clubs SET retire_le = ${t}, email = NULL WHERE source = 'manuel' AND ref = ${ref} RETURNING id;
DELETE FROM acces WHERE club IN (SELECT id FROM clubs WHERE source = 'manuel' AND ref = ${ref});`;
}

/**
 * The rows the first statement returned, from `wrangler d1 execute --json` (an array of results, one per statement);
 * undefined when the output cannot be read. Its `meta.changes` is not used: wrangler does not give it locally.
 */
export function changements(stdout: string): number | undefined {
  try {
    // The array starts a line: a « [WARNING] » before it does not.
    const at = stdout.search(/^\[/m);
    const r = JSON.parse(at < 0 ? "" : stdout.slice(at)) as { results?: unknown }[];
    const rows = r[0]?.results;
    return Array.isArray(rows) ? rows.length : undefined;
  } catch {
    return undefined;
  }
}

function main() {
  const { values } = parseArgs({
    options: { nom: { type: "string" }, commune: { type: "string" }, activite: { type: "string" }, le: { type: "string" }, retirer: { type: "boolean" }, local: { type: "boolean" } },
  });
  const today = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
  const m: Manuel = { nom: values.nom ?? "", commune: values.commune ?? "", activite: values.activite ?? (values.retirer ? "retrait" : ""), le: values.le ?? today };
  const faux = erreur(m);
  if (faux) throw new Error(faux);
  let statement: string;
  if (values.retirer) statement = retirer(m);
  else {
    const email = emailOf(readFileSync(0, "utf8").split("\n")[0]);
    if (!email) throw new Error("adresse e-mail attendue sur l'entrée standard, seule sur sa première ligne");
    statement = ecrire(m, email);
  }
  const dir = mkdtempSync(join(tmpdir(), "club-verifie-"));
  try {
    const file = join(dir, "club.sql");
    writeFileSync(file, statement, { mode: 0o600 });
    // A withdrawal holds no address: on the command line, its output read.
    const what = values.retirer ? ["--command", statement, "--json"] : ["--file", file];
    const r = spawnSync("npx", ["wrangler", "d1", "execute", "rundata-transports", values.local ? "--local" : "--remote", ...what], {
      stdio: ["ignore", values.retirer ? "pipe" : "ignore", "inherit"],
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`wrangler a échoué (code ${r.status})`);
    if (values.retirer) {
      const n = changements(r.stdout);
      if (n === undefined) throw new Error("wrangler : résultat illisible, le retrait est à vérifier à la main");
      if (n === 0) throw new Error(`aucun club du niveau 3 « ${m.nom} » à ${m.commune} : rien n'a été retiré`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(values.retirer ? `retiré : ${m.nom} (${m.commune})` : `enregistré au niveau 3 : ${m.nom} (${m.commune}), vérifié le ${m.le}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
