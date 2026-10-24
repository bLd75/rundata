/**
 * The climate archive as a local SQLite file, for the Node server (CLIMAT_SQLITE=dist/climat.sqlite) and for trying the
 * tool without the Worker: `python3 -I scripts/build-climat.py --dir … --out dist/climat.sql`, then
 * `npx tsx scripts/climat-local.ts dist/climat.sql dist/climat.sqlite`.
 */
import { readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [from, to] = process.argv.slice(2);
if (!from || !to) throw new Error("usage : npx tsx scripts/climat-local.ts <climat.sql> <climat.sqlite>");
rmSync(to, { force: true });
const db = new DatabaseSync(to);
db.exec(readFileSync(from, "utf8"));
const n = db.prepare("SELECT COUNT(*) AS n FROM jours").get() as { n: number };
console.log(`${to} : ${n.n} années-stations`);
db.close();
