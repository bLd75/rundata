/**
 * The notes of a release, in plain French: the changes of src/nouveautes.ts (also the page /nouveautes and
 * CHANGELOG.md) that the previous release did not have. Read as text, so that the workflow needs no install.
 * Usage: node scripts/release-notes.mjs src/nouveautes.ts [previous-nouveautes.ts] > notes.md
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The texts of the NOUVEAUTES list in the source of src/nouveautes.ts, newest first. */
export function textes(source) {
  const list = source.slice(source.indexOf("export const NOUVEAUTES"));
  return [...list.slice(0, list.indexOf("\n];")).matchAll(/texte: "((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
}

/** The notes: what is new since `previous` (all of it without one), and where to read the rest. */
export function notes(current, previous) {
  const before = new Set(previous ? textes(previous) : []);
  const fresh = textes(current).filter((t) => !before.has(t));
  return (fresh.length ? `## Nouveautés\n\n${fresh.map((t) => `- ${t}`).join("\n")}\n` : "Pas de nouveauté visible : corrections et améliorations, détaillées dans les pull requests ci-dessous.\n") +
    "\nToutes les nouveautés : https://rundata.re/nouveautes\n";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [current, previous] = process.argv.slice(2);
  process.stdout.write(notes(readFileSync(current, "utf8"), previous ? readFileSync(previous, "utf8") : undefined));
}
