/**
 * The concentrations measured at Atmo Réunion's stations (src/providers/air-mesures.ts), read from the LCSQA's open
 * files on data.gouv.fr and written to the Worker's KV store, where the Worker reads them: one file a day for the whole
 * of France, up to 12.6 MB (28/10/2026), read here as a stream, of which Atmo Réunion's lines alone are kept.
 * `npx tsx scripts/air-mesures.ts [--kv]`, every hour with --kv (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the
 * environment, scripts/kv.ts). Writes only when the latest hour measured changed. Without --kv, prints what it read
 * and writes nothing. Fails when no file can be read: the copy in the store stays, its measures said with their hour.
 */
import "../src/bin/net.js";
import { KV_KEY, KV_TTL_SECONDS, latest, mesure, POLLUTANTS, type Copie, type Mesure } from "../src/providers/air-mesures.js";
import { getKv, putKv } from "./kv.js";

const FILES = "https://files.data.gouv.fr/ineris/lcsqa/concentrations-de-polluants-atmospheriques-reglementes/temps-reel";
const kv = process.argv.includes("--kv");

/** Atmo Réunion's valid measures in the file of `day` (YYYY-MM-DD); undefined when there is no such file yet. */
async function read(day: string): Promise<Mesure[] | undefined> {
  const url = `${FILES}/${day.slice(0, 4)}/FR_E2_${day}.csv`;
  const res = await fetch(url, { headers: { "User-Agent": "rundata.re (contact@rundata.re)" }, signal: AbortSignal.timeout(180_000) });
  if (res.status === 404) return undefined;
  if (!res.ok || !res.body) throw new Error(`${url} : HTTP ${res.status}`);
  const out: Mesure[] = [];
  let rest = "";
  for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      const m = mesure(line.replace(/\r$/, ""));
      if (m) out.push(m);
    }
  }
  const m = mesure(rest);
  if (m) out.push(m);
  return out;
}

// The file of the day in La Réunion; in its first hours it may not hold any of Atmo Réunion's lines yet, then the
// day before's is read too.
const now = Date.now();
const day = (t: number) => new Date(t + 4 * 3600_000).toISOString().slice(0, 10);
const today = await read(day(now));
const all = today?.length ? today : [...(today ?? []), ...((await read(day(now - 86_400_000))) ?? [])];
const mesures = latest(all);
if (!mesures.length) throw new Error(`aucune mesure valide d'Atmo Réunion dans les fichiers du ${day(now)} ni de la veille`);

const derniere_heure = mesures.map((m) => m.fin).sort().pop()!;
const copie: Copie = { lu: new Date(now).toISOString(), derniere_heure, mesures };
const stations = new Set(mesures.map((m) => m.station)).size;
console.log(`${mesures.length} mesures de ${stations} stations, dernière heure finie à ${derniere_heure.slice(11, 16)} le ${derniere_heure.slice(0, 10)} : ` +
  Object.keys(POLLUTANTS).map((p) => `${p} ${mesures.filter((m) => m.polluant === p).length}`).join(", "));
if (kv) {
  const had = await getKv<Copie>(KV_KEY);
  if (had?.derniere_heure === derniere_heure) console.log(`dernière heure inchangée : ${KV_KEY} non réécrit`);
  else {
    await putKv(KV_KEY, copie, KV_TTL_SECONDS);
    console.log(`écrit dans KV : ${KV_KEY}`);
  }
}
