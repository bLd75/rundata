/**
 * The budget's registry: every read rundata.re makes, what starts it, how often, at which minute, and what one run
 * takes (subrequests, KV and D1 operations, CPU), with the totals against the limits of src/budget.ts. BUDGET.md is
 * written from it by `npx tsx scripts/build-budget.ts`; test/registre.test.ts fails when BUDGET.md no longer matches,
 * when a file that fetches (through src/http.ts) is reached by no entry, when a shared copy, a page or a tool has no
 * entry, or when a total passes its limit. Change the entry, or the declaration it is derived from, in the PR that
 * changes what a read takes.
 *
 * Derived from what the code declares already: the shared copies (web/partagees.ts: cadence, cold cost, CPU), the
 * agendas read by the scheduled event (providers/agenda.ts), the AROME grids (providers/arome.ts). Declared here: the
 * pages and the tools, as measured over MEASURED (the most subrequests of a view or a call, the refused ones included;
 * its CPU, rounded up), and the GitHub workflows that write to KV or D1.
 *
 * For Node only (it reads the sources to follow their imports): the Worker never imports it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { BUILD_BUDGET, PAGE_BUDGET, SCHEDULED_BUDGET, SERVICE_OPS_LIMIT, SUBREQUEST_LIMIT } from "./budget.js";
import { DETAILS_MAX as CONNECTEUR_DETAILS, PAGES_MAX as CONNECTEUR_PAGES } from "./connecteurs/helloasso.js";
import { IN_FLIGHT } from "./http.js";
import { AGENDAS } from "./providers/agenda.js";
import { MAX_NEW_GRIDS } from "./providers/arome.js";
import { KINDS as CANDHIS_KINDS, REFRESH_EVERY as CANDHIS_EVERY, REFRESH_OFFSET as CANDHIS_OFFSET } from "./providers/candhis.js";
import { IMAGE_OFFSET as CMRS_IMAGE_OFFSET, LISTE_OFFSET as CMRS_LISTE_OFFSET, REFRESH_EVERY as CMRS_EVERY } from "./providers/cmrs-carte.js";
import { REFRESH_EVERY as AIR_EVERY, REFRESH_OFFSET as AIR_OFFSET } from "./providers/air-mesures.js";
import { FIRST_HOUR as HS_FIRST, REFRESH_OFFSET as HS_OFFSET } from "./providers/sites-hs.js";
import { REFRESH_EVERY as CAPTEURS_EVERY, REFRESH_OFFSET as CAPTEURS_OFFSET } from "./providers/capteurs.js";
import { REFRESH_EVERY as MARCHES_EVERY, REFRESH_OFFSET as MARCHES_OFFSET, TEXTES_OFFSET as MARCHES_TEXTES_OFFSET } from "./providers/marches-publics.js";
import { EVENEMENT_MINUTES as EMPLOI_FICHE_EVERY, REFRESH_EVERY as EMPLOI_EVERY, REFRESH_OFFSET as EMPLOI_OFFSET } from "./providers/emploi.js";
import { REFRESH_EVERY as IRVE_EVERY, REFRESH_OFFSET as IRVE_OFFSET } from "./providers/irve.js";
import { SHARED, SHARED_AFTER, type Shared } from "./web/partagees.js";
import { COMMUNE_TILES, DOMAINS, HOME_TILES } from "./web/site.js";

/** Where the measured figures come from. */
export const MEASURED = "du 23/10/2026 23:07 au 25/10/2026 23:07, heure de La Réunion, dans les journaux du Worker";

/** The scheduled event's cadence (wrangler.jsonc, `*\/5 * * * *`), in minutes. */
export const EVENT_MINUTES = 5;
/** The CPU a scheduled event may take, ms: fixed for a cron that runs more often than hourly. */
export const SCHEDULED_CPU_MS = 30_000;
/** The memory of an isolate, Mo: every invocation it serves at once shares it. */
export const ISOLATE_MEMORY_MB = 128;

export type Trigger = "planifiée" | "visite" | "question" | "actions";
/** `mesuré`: over MEASURED; `code`: read in the code (a bound, a count); `estimé`: from a neighbour's measure. */
export type Basis = "mesuré" | "code" | "estimé";

/** What one run takes, from a cold cache. */
export interface Run {
  /** The invocation's subrequests: fetches, the data center's cache, KV and D1 together. */
  subrequests: number;
  kvReads?: number;
  kvWrites?: number;
  /** KV listings: counted with the writes. */
  kvLists?: number;
  d1Calls?: number;
  d1RowsRead?: number;
  d1RowsWritten?: number;
  /** ms; for a workflow, nothing (it runs on GitHub, not in the Worker). */
  cpuMs: number;
  /** Mo held at once at its peak, declared by the reads of a file of several Mo; left out by the others. */
  memoryMb?: number;
}

export interface Entry {
  id: string;
  trigger: Trigger;
  what: string;
  /** Minutes between two runs; undefined for a visit or a question (once per view) and a workflow run on each merge. */
  every?: number;
  /** The shortest `every`, when it depends on what is read (the volcano in alert). */
  shortest?: number;
  /** The minute of the day (UTC) of its first run, modulo `every`. */
  offset?: number;
  run: Run;
  /** Where its reads start: files whose imports reach every source it reads. Never a file that reaches them all. */
  from: string[];
  basis: Basis;
}

// --- The scheduled event -------------------------------------------------------------------------------------------

// The public sites that do not answer (sans-reponse.ts): 5 when the table was made (scripts/sans-reponse.sql), 20
// counted to leave room. The page and the tool read the rows and the last recheck, at most every 15 minutes.
const SANS_REPONSE_HOSTS = 20;
const SANS_REPONSE_D1 = { d1Calls: 2, d1RowsRead: SANS_REPONSE_HOSTS + 1 };

// What a shared copy's refresh takes besides its build: its write to KV.
const COPY_WRITE = 1;
// Where each shared copy's build reads from (web/data.ts builds them from these tools and sources).
const SHARED_FROM: Record<string, string[]> = {
  vigilance: ["src/providers/vigilance.ts"],
  "web:crues": ["src/tools/crues.ts"],
  "web:actualites": ["src/tools/actualites.ts"],
  "web:trafic": ["src/tools/transports.ts", "src/tools/littoral.ts", "src/providers/transit.ts"],
  "web:electricite": ["src/tools/electricite.ts"],
  "web:coupures": ["src/tools/coupures.ts"],
  "web:air": ["src/tools/air.ts"],
  "mer:satellites": ["src/providers/acspo.ts", "src/providers/modis.ts"],
  "web:mer": ["src/tools/mer.ts"],
  "web:calendrier": ["src/tools/calendrier.ts"],
  seismes: ["src/providers/seismes.ts"],
  "onf:sentiers": ["src/providers/sentiers.ts"],
  "web:volcan": ["src/tools/volcan.ts", "src/providers/ovpf-pdf.ts"],
  "web:courant": ["src/tools/courant.ts"],
  "ens:ile": ["src/providers/ensemble.ts"],
  "web:chiffres": ["src/tools/meteo.ts", "src/providers/velos.ts", "src/providers/sentiers.ts", "src/sans-reponse.ts"],
  "web:chiffres:evenements": ["src/tools/agenda.ts"],
};
// The traffic's copy reads the 8 bus stations' timetables in 2 D1 calls (the patterns, about 811 rows, and the passes,
// about 23), as the D1 analytics count them.
const SHARED_D1: Record<string, Pick<Run, "d1Calls" | "d1RowsRead">> = {
  "web:trafic": { d1Calls: 2, d1RowsRead: 840 },
  // The state of the OVPF-IPGP's site (tools/volcan.ts), in the copy of /sites-sans-reponse.
  "web:volcan": SANS_REPONSE_D1,
  // The silent sites, counted.
  "web:chiffres": SANS_REPONSE_D1,
};

// Copies the scheduled event collects and a build reads from KV (src/worker.ts `configure`): the measures at Atmo
// Réunion's stations and the sensors of private people.
const SHARED_KV: Record<string, number> = { "web:air": 2 };

// Never built alone over MEASURED: their CPU is that of the page that shows them; the vigilance's and the rivers', measured in Node; the earthquakes' and the ONF's map's, estimated from /volcan's and /sentiers's.
const SHARED_ESTIMATED = new Set(["vigilance", "seismes", "onf:sentiers", "web:crues", "mer:satellites", "web:calendrier", "web:chiffres", "web:chiffres:evenements"]);

const sharedEntry = (s: Shared, after: boolean): Entry => ({
  id: s.key,
  trigger: "planifiée",
  what: after ? "copie partagée, avec ce que les autres ont laissé" : "copie partagée (KV)",
  every: typeof s.every === "number" ? s.every : s.range?.usual,
  ...(typeof s.every !== "number" && s.range && { shortest: s.range.shortest }),
  offset: s.offset ?? 0,
  run: { subrequests: (s.cold ?? 0) + COPY_WRITE, ...(SHARED_KV[s.key] && { kvReads: SHARED_KV[s.key] }), kvWrites: COPY_WRITE, ...SHARED_D1[s.key], cpuMs: s.cpu ?? 0 },
  from: SHARED_FROM[s.key] ?? [],
  basis: SHARED_ESTIMATED.has(s.key) ? "estimé" : "mesuré",
});

// About 30 ms each, the 4 read at 22:35:43 on 25 October 2026 having taken 121 ms with the event's own 13.
const PLANNED_AGENDA_CPU_MS = 30;
const PLANNED_EVERY_SECONDS = 3600; // tools/agenda.ts, PLANNED_FRESH_SECONDS

const SCHEDULED: Entry[] = [
  {
    id: "arome:veille",
    trigger: "planifiée",
    what: "AROME : le dernier run publié, et les grilles qu'il reste à lire",
    every: EVENT_MINUTES,
    offset: 0,
    run: { subrequests: 3, kvReads: 1, cpuMs: 15 },
    from: ["src/providers/arome.ts"],
    basis: "mesuré",
  },
  {
    id: "arome:grilles",
    trigger: "planifiée",
    what: `AROME : les grilles d'un nouveau run, ${MAX_NEW_GRIDS} au plus par passage, 3 de relief`,
    every: 3 * 60,
    offset: 0,
    run: { subrequests: MAX_NEW_GRIDS + 3, kvWrites: 2, cpuMs: 60 },
    from: ["src/providers/arome.ts"],
    basis: "code",
  },
  {
    id: "partagees:liste",
    trigger: "planifiée",
    what: "copies partagées : la liste des clés KV, une pour les copies et celles d'après",
    every: EVENT_MINUTES,
    offset: 0,
    run: { subrequests: 1, kvLists: 1, cpuMs: 0 },
    from: [],
    basis: "code",
  },
  ...SHARED.map((s) => sharedEntry(s, false)),
  ...SHARED_AFTER.map((s) => sharedEntry(s, true)),
  // Météo-France's official map (providers/vigilance-carte.ts), in the vigilance's copy, outside its cost: its state read
  // at each of its builds; a new bulletin kept (its time of issue read in the PDF, 40 ms in Node, the PDF and the state
  // written); a picture by Cloudflare's browser (the call, the picture and the state written), 24 a day at most.
  {
    id: "vigilance:carte",
    trigger: "planifiée",
    what: "carte officielle de la vigilance : son état (KV), lu à chaque copie de la vigilance",
    every: EVENT_MINUTES,
    offset: 0,
    run: { subrequests: 1, kvReads: 1, cpuMs: 0 },
    from: ["src/providers/vigilance-carte.ts"],
    basis: "code",
  },
  {
    id: "vigilance:carte:bulletin",
    trigger: "planifiée",
    what: "carte officielle de la vigilance : un nouveau bulletin gardé (le PDF et l'état, KV), puis son image par le navigateur de Cloudflare (l'image et l'état), 24 images par jour au plus",
    every: 60,
    offset: 0,
    run: { subrequests: 5, kvWrites: 4, cpuMs: 40 },
    from: ["src/providers/vigilance-carte.ts"],
    basis: "code",
  },
  // The RSMC's forecast track map, while GDACS has an active system: GDACS's list through the cache (cold: the copy
  // looked for, 2 pages, the copy written, 5), the state (KV), one request to Météo-France, and the state written; for
  // the image, the image written too (KV). Outside an active system, the list of GDACS alone.
  {
    id: "cmrs:liste",
    trigger: "planifiée",
    what: "carte de prévision de trajectoire du CMRS : la liste de ses bulletins (Météo-France), pendant un système actif",
    every: CMRS_EVERY,
    offset: CMRS_LISTE_OFFSET,
    run: { subrequests: 8, kvReads: 2, kvWrites: 2, cpuMs: 10 },
    from: ["src/providers/cmrs-carte.ts"],
    basis: "code",
  },
  {
    id: "cmrs:image",
    trigger: "planifiée",
    what: "carte de prévision de trajectoire du CMRS : l'image (Météo-France), gardée dans KV sous son empreinte, pendant un système actif",
    every: CMRS_EVERY,
    offset: CMRS_IMAGE_OFFSET,
    run: { subrequests: 9, kvReads: 2, kvWrites: 3, cpuMs: 10 },
    from: ["src/providers/cmrs-carte.ts"],
    basis: "code",
  },
  {
    id: "agendas:planifies",
    trigger: "planifiée",
    what: "agendas lus par la tâche planifiée : leur copie commune (KV), lue à chaque passage, écrite après une lecture",
    every: EVENT_MINUTES,
    offset: 0,
    run: { subrequests: 1, kvReads: 1, cpuMs: 0 },
    from: [],
    basis: "code",
  },
  {
    id: "agendas:planifies:ecriture",
    trigger: "planifiée",
    what: "agendas lus par la tâche planifiée : l'écriture de leur copie commune",
    every: PLANNED_EVERY_SECONDS / 60,
    offset: 0,
    run: { subrequests: 1, kvWrites: 1, cpuMs: 0 },
    from: [],
    basis: "code",
  },
  ...AGENDAS.filter((a) => a.planifie).map((a): Entry => ({
    id: `agenda:${a.id}`,
    trigger: "planifiée",
    what: `agenda lu par la tâche planifiée : ${a.nom}`,
    every: (a.relecture ?? PLANNED_EVERY_SECONDS) / 60,
    offset: 0,
    run: { subrequests: a.requetes ?? 1, cpuMs: PLANNED_AGENDA_CPU_MS },
    from: ["src/providers/agenda.ts"],
    basis: "mesuré",
  })),
  // A failed read (http.ts) is written down after the response, wherever it happens (sans-reponse.ts): the hosts' states
  // read again at most every 10 minutes by an isolate, then a write only for a host that enters the list.
  {
    id: "sans-reponse:echecs",
    trigger: "planifiée",
    what: "sites sans réponse : l'état des sites relu quand une lecture échoue (D1), au plus toutes les 10 minutes par isolat, après la réponse aussi pour une vue ou une question\u00a0; une écriture de plus pour un site qui entre dans la liste",
    every: 10,
    offset: 0,
    run: { subrequests: 1, d1Calls: 1, d1RowsRead: SANS_REPONSE_HOSTS, cpuMs: 2 },
    from: ["src/sans-reponse.ts"],
    basis: "estimé",
  },
  // A shared copy late for its refresh (web/partagees.ts SharedFallback): its last failure read with it, and written
  // after a failed try, at most once per breaker for all the data centers; only while its source does not answer.
  {
    id: "copies:echecs",
    trigger: "planifiée",
    what: "copies partagées : l'échec d'une copie en retard, lu avec elle et écrit après un essai manqué (KV), au plus une fois toutes les 5 minutes par copie pour tous les centres de données, seulement quand sa source ne répond pas",
    every: 5,
    offset: 0,
    run: { subrequests: 2, kvReads: 1, kvWrites: 1, cpuMs: 0 },
    // KV only: its file's imports reach every source.
    from: [],
    basis: "code",
  },
  // Its own budget (BUILD_BUDGET), after the event's reads: one GET per site not come back, the writes in one batch.
  {
    id: "sans-reponse:reverification",
    trigger: "planifiée",
    what: "sites sans réponse : la revérification quotidienne, une lecture par site (D1 et sites), à 06:00 heure de La Réunion",
    every: 24 * 60,
    offset: 2 * 60,
    run: { subrequests: SANS_REPONSE_HOSTS + 2, d1Calls: 2, d1RowsRead: SANS_REPONSE_HOSTS, d1RowsWritten: SANS_REPONSE_HOSTS + 1, cpuMs: 30 },
    from: ["src/sans-reponse.ts"],
    basis: "estimé",
  },
  // The national file (about 9 Mo, 125 000 lines), read after the event's other reads. In the Worker's logs (26/10, its
  // first four runs against the sixteen runs of the same minutes before): about 160 ms of CPU more on average, 260 at
  // most, rounded up here; 9 to 17 Mo held besides its 9 Mo of text (measured in Node on the real file).
  {
    id: "irve:etat",
    trigger: "planifiée",
    what: "bornes de recharge : la part de La Réunion du fichier national (environ 9 Mo), écrite dans KV après les autres lectures",
    every: IRVE_EVERY,
    offset: IRVE_OFFSET,
    run: { subrequests: 2, kvWrites: 1, cpuMs: 300, memoryMb: 30 },
    from: ["src/providers/irve.ts"],
    basis: "estimé",
  },
  // The copy read from KV, the file of the day (its address, then its storage: 2 subrequests), and the day before's too
  // in the first hours of the day (2 more), the copy written when the latest hour changed: 4, 6 at most. Read line by
  // line, never whole: no memory declared. CPU measured in a Worker on 29/10/2026: 50 ms for the file of the morning,
  // 193 to 254 ms for a whole day's.
  {
    id: "air:mesures",
    trigger: "planifiée",
    what: "qualité de l'air : les mesures horaires des stations d'Atmo Réunion, leurs lignes du fichier national du LCSQA (jusqu'à 12,5 Mo, lu ligne à ligne), écrites dans KV quand la dernière heure change",
    every: AIR_EVERY,
    offset: AIR_OFFSET,
    run: { subrequests: 6, kvReads: 1, kvWrites: 1, cpuMs: 260 },
    from: ["src/providers/air-mesures.ts"],
    basis: "mesuré",
  },
  // The copy read from KV, the Arcep's file of the day (0.5 to 2.2 Mo, read whole and parsed), the copy written: 3.
  // Once a day: from 10:30 UTC, every hour at half past until 19:30 while the file is not out (a 404: 1 subrequest and the
  // copy's read each time), then the copy's read only. CPU measured in Node, parse and filter: 21.5 ms at most on the
  // file of 22/10/2026 (2.17 Mo), 6.3 on that of 29/10 (0.87 Mo); rounded up for a Worker. Memory estimated.
  {
    id: "antennes:hors-service",
    trigger: "planifiée",
    what: "sites mobiles hors service : les lignes de La Réunion du fichier quotidien de l'Arcep (0,5 à 2,2 Mo), écrites dans KV une fois par jour",
    every: 24 * 60,
    offset: HS_FIRST * 60 + HS_OFFSET,
    run: { subrequests: 3, kvReads: 1, kvWrites: 1, cpuMs: 40, memoryMb: 15 },
    from: ["src/providers/sites-hs.ts"],
    basis: "estimé",
  },
  // The copy read from KV, one request to Sensor.Community for the whole island, the copy written when its sensors
  // changed or an hour after: 3. Its answer is a list of a few sensors at most (none on 29/10/2026).
  {
    id: "capteurs:air",
    trigger: "planifiée",
    what: "capteurs amateurs de particules (Sensor.Community) : les 5 dernières minutes sur l'île, une requête, gardées 2 heures dans KV",
    every: CAPTEURS_EVERY,
    offset: CAPTEURS_OFFSET,
    run: { subrequests: 3, kvReads: 1, kvWrites: 1, cpuMs: 10 },
    from: ["src/providers/capteurs.ts"],
    basis: "code",
  },
  // The radar's last 6 hours (web/pluie-retro.ts), at every run: the history read from KV, the latest image (a token
  // first when the isolate holds none), the history written when the image is new or a gap grows: 4 subrequests in a
  // new isolate, 2 or 3 after (counted in test/pluie-retro.test.ts); about once a quarter of an hour, the 24 hours read
  // and written besides (2 more); 8 at most, when Météo-France refuses the token once (401) and the image is asked
  // again with a new one. CPU measured in Node on the real image of 22/10/2026 (HDF5, grid, history): 106 ms at the
  // first run, 32 ms after; rounded up for a Worker. The 3 hours weighed 9 to 51 Ko, the 6 hours twice that.
  {
    id: "radar:6h",
    trigger: "planifiée",
    what: "pluie radar des 6 dernières heures pour le rejeu de /meteo : la dernière image de Météo-France ajoutée dans KV quand elle est nouvelle, ou un trou daté, et chaque quart d'heure une image gardée 24 heures",
    every: EVENT_MINUTES,
    offset: 0,
    run: { subrequests: 8, kvReads: 2, kvWrites: 2, cpuMs: 120, memoryMb: 5 },
    from: ["src/web/pluie-retro.ts"],
    basis: "estimé",
  },
  // The stations' week (web/rejeu.ts), once an hour: the hourly package from the data center's cache, never asked of
  // Météo-France; the week read from KV and written when the package is newer.
  {
    id: "stations:7j",
    trigger: "planifiée",
    what: "les heures des stations Météo-France sur 7 jours pour la barre de lecture de /meteo : le paquet horaire déjà gardé par le centre de données, ajouté dans KV quand il est plus récent",
    every: 60,
    offset: 20,
    run: { subrequests: 3, kvReads: 1, kvWrites: 1, cpuMs: 20 },
    from: ["src/web/rejeu.ts"],
    basis: "code",
  },
  // The copy read from KV, one offer's page (about 217 Ko, searched for its labels by position, never built), the copy
  // written when it changed: never two pages at once on the site. CPU and memory estimated from the page's size, to be
  // measured in a Worker.
  {
    id: "emploi:offres",
    trigger: "planifiée",
    what: "emploi public : la page d'une offre de Choisir le service public à chaque événement, la plus récente pas encore lue, sinon chaque offre ouverte à son tour, écrites dans KV quand elles changent",
    every: EMPLOI_FICHE_EVERY,
    offset: 0,
    run: { subrequests: 3, kvReads: 1, kvWrites: 1, cpuMs: 15, memoryMb: 5 },
    from: ["src/providers/emploi.ts"],
    basis: "estimé",
  },
  // In the same event as the page above, at 25 past: the feed, one request.
  {
    id: "emploi:flux",
    trigger: "planifiée",
    what: "emploi public : le flux des 20 dernières offres de Choisir le service public pour La Réunion",
    every: EMPLOI_EVERY,
    offset: EMPLOI_OFFSET,
    run: { subrequests: 1, cpuMs: 5 },
    from: ["src/providers/emploi.ts"],
    basis: "estimé",
  },
  // The copy read from KV, the list of the open notices (one request, about 80 Ko), the copy written when it changed.
  {
    id: "marches-publics:liste",
    trigger: "planifiée",
    what: "marchés publics : la liste des avis de marché ouverts publiés au BOAMP pour La Réunion, écrite dans KV quand elle change",
    every: MARCHES_EVERY,
    offset: MARCHES_OFFSET,
    run: { subrequests: 3, kvReads: 1, kvWrites: 1, cpuMs: 10 },
    from: ["src/providers/marches-publics.ts"],
    basis: "estimé",
  },
  // Five minutes later, only with new notices: the copy read from KV, their full texts (one request, 35 Ko each, 0 to 2
  // most hours; 3,8 Mo for the 124 of 29/10/2026 at the first read), the copy written. CPU measured in Node on
  // 29/10/2026: 3 ms a notice (234 to 438 ms for 100), so 550 ms at the first read, a few ms an hour after.
  {
    id: "marches-publics:textes",
    trigger: "planifiée",
    what: "marchés publics : le texte des nouveaux avis, pour savoir s'ils sont de l'île et leur commune, écrit dans KV",
    every: MARCHES_EVERY,
    offset: MARCHES_TEXTES_OFFSET,
    run: { subrequests: 3, kvReads: 1, kvWrites: 1, cpuMs: 550, memoryMb: 25 },
    from: ["src/providers/marches-publics.ts"],
    basis: "estimé",
  },
  // Only with the Cerema's key. The state read from KV, one getCampListeTR request per type of active buoy (at most
  // the three types; one when the island's buoys are all of one type), the state written. Every 30 days, and the first
  // time, the list of the active buoys besides: one request per type, three more subrequests in that run.
  {
    id: "candhis:etat",
    trigger: "planifiée",
    what: "bouées Candhis du Cerema : la dernière mesure de chaque bouée de La Réunion, une requête par type de bouée, gardée dans KV",
    every: CANDHIS_EVERY,
    offset: CANDHIS_OFFSET,
    run: { subrequests: 2 + Object.keys(CANDHIS_KINDS).length, kvReads: 1, kvWrites: 1, cpuMs: 10 },
    from: ["src/providers/candhis.ts"],
    basis: "code",
  },
  // One association's platform per run, the one read the longest ago (each every 6 hours while there are fewer than
  // 72): the token (1), its list of events (up to CONNECTEUR_PAGES pages) and the details of the new or changed ones (up
  // to CONNECTEUR_DETAILS). Usually 2 or 3 subrequests: the details are read again only when the platform says the event
  // changed. D1, connecteurs/lecture.ts: the link due and its mark (2 calls, even when none is due), the turned secret, its
  // events kept, those gone deleted, those changed written in one statement, the reading's result: 7 calls; a first
  // reading writes all its events (up to CONNECTEUR_PAGES pages of 50).
  {
    id: "connecteurs:lecture",
    trigger: "planifiée",
    what: "plateformes des associations (HelloAsso) : les événements publics d'une association reliée, relus toutes les 6 h, une association par passage",
    every: EVENT_MINUTES,
    run: { subrequests: 1 + CONNECTEUR_PAGES + CONNECTEUR_DETAILS + 7, d1Calls: 7, d1RowsRead: 2 + CONNECTEUR_PAGES * 50, d1RowsWritten: 3 + CONNECTEUR_PAGES * 50, cpuMs: 20 },
    from: ["src/connecteurs/helloasso.ts", "src/connecteurs/lecture.ts"],
    basis: "estimé",
  },
  // The day before at each Météo-France station (providers/meteofrance.ts keepVeille): the hourly package of the 974
  // (about 900 kB), read once a day at 00:20 in La Réunion and again at 00:35 only when its last hour was not out yet
  // (then with one read of KV first). Here the pass of 00:20: the token, the package, one write to KV.
  {
    id: "meteofrance:veille",
    trigger: "planifiée",
    what: "météo de la veille\u00a0: la pluie et les températures de 0\u00a0h à 24\u00a0h de chaque station Météo-France (paquet horaire, environ 900 ko), écrites dans KV à 00:20 heure de La Réunion, relues à 00:35 si la dernière heure manquait",
    every: 24 * 60,
    offset: 20 * 60 + 20,
    run: { subrequests: 3, kvWrites: 1, cpuMs: 40 },
    from: ["src/providers/meteofrance.ts"],
    basis: "estimé",
  },
  {
    id: "propositions:purge",
    trigger: "planifiée",
    what: "propositions des clubs : la purge quotidienne (D1), à 04:00 heure de La Réunion",
    every: 24 * 60,
    offset: 0,
    run: { subrequests: 1, d1Calls: 1, d1RowsWritten: 10, cpuMs: 5 },
    from: [],
    basis: "estimé",
  },
  {
    id: "connecteurs:purge",
    trigger: "planifiée",
    what: "plateformes des associations : la purge quotidienne (D1), à 04:00 heure de La Réunion",
    every: 24 * 60,
    offset: 0,
    run: { subrequests: 3, d1Calls: 3, d1RowsWritten: 5, cpuMs: 2 },
    from: [],
    basis: "estimé",
  },
];

// --- The GitHub workflows that write to KV or D1 (.github/workflows) -----------------------------------------------

const ACTIONS: Entry[] = [
  { id: "actions:eau", trigger: "actions", what: "eau de l'île : la copie des avis (KV)", every: 6 * 60, offset: 17, run: { subrequests: 0, kvWrites: 1, cpuMs: 0 }, from: [], basis: "code" },
  { id: "actions:carburants", trigger: "actions", what: "carburants : les prix (KV), 4 fois par jour en fin de mois", every: 24 * 60, shortest: 6 * 60, offset: 3 * 60 + 41, run: { subrequests: 0, kvWrites: 1, cpuMs: 0 }, from: [], basis: "code" },
  // About 28 700 rows written on 24 October 2026, per the D1 analytics.
  { id: "actions:climat", trigger: "actions", what: "climat : les mesures de l'année en cours (D1, deux bases), une seconde fois à 09:45 UTC si besoin", every: 24 * 60, shortest: 12 * 60, offset: 7 * 60 + 45, run: { subrequests: 0, d1Calls: 2, d1RowsWritten: 28_700, cpuMs: 0 }, from: [], basis: "mesuré" },
  { id: "actions:deploiement", trigger: "actions", what: "déploiement : les bases D1 vérifiées avant la mise en ligne, à chaque fusion", run: { subrequests: 0, d1Calls: 3, d1RowsRead: 360, cpuMs: 0 }, from: [], basis: "mesuré" },
];

// --- The visits ----------------------------------------------------------------------------------------------------

/** A page (or a family of pages) as measured: the most subrequests of a view, its CPU, where its reads start. */
interface Page {
  subrequests: number;
  cpuMs: number;
  from: string[];
  what?: string;
  d1?: Pick<Run, "d1Calls" | "d1RowsRead">;
  /** "mesuré" unless said: a page too new to have been measured is counted from its code. */
  basis?: Basis;
}
const BUS_D1 = { d1Calls: 2, d1RowsRead: 840 };
const METEO = ["src/tools/meteo.ts", "src/tools/prevision.ts", "src/tools/vigilance.ts"];

/** Every page of DOMAINS (web/site.ts), by its path. */
const DOMAIN_PAGES: Record<string, Page> = {
  "/meteo": { subrequests: 41, cpuMs: 80, from: METEO },
  // Measured 39, before it read the list of the silent sites (a read of the data center's cache, 2 of D1, a write); 6
  // more for the pages of two releases whose list does not name the volcano (providers/volcan.ts, `doubtful`): each a
  // read of KV, the page and a write of KV, once a week.
  "/volcan": { subrequests: 49, cpuMs: 60, from: ["src/tools/volcan.ts"], d1: SANS_REPONSE_D1 },
  "/air": { subrequests: 14, cpuMs: 40, from: ["src/tools/air.ts"] },
  "/electricite": { subrequests: 17, cpuMs: 30, from: ["src/tools/electricite.ts"] },
  "/calendrier": { subrequests: 18, cpuMs: 40, from: ["src/tools/calendrier.ts"] },
  "/bus": { subrequests: 45, cpuMs: 190, from: ["src/tools/transports.ts"], d1: BUS_D1 },
  "/trafic": { subrequests: 51, cpuMs: 270, from: ["src/tools/transports.ts", "src/tools/littoral.ts"], d1: BUS_D1 },
  "/velos": { subrequests: 14, cpuMs: 50, from: ["src/tools/velos.ts"] },
  "/bornes": { subrequests: 12, cpuMs: 40, from: ["src/tools/bornes.ts"] },
  "/eau": { subrequests: 11, cpuMs: 30, from: ["src/tools/eau.ts"] },
  "/randonnees": { subrequests: 22, cpuMs: 210, from: ["src/tools/sentiers.ts"] },
  "/sentiers": { subrequests: 19, cpuMs: 60, from: ["src/tools/sentiers.ts"] },
  "/secheresse": { subrequests: 12, cpuMs: 70, from: ["src/tools/secheresse.ts"] },
  "/coupures-eau": { subrequests: 20, cpuMs: 100, from: ["src/tools/coupures.ts"] },
  // « Autour de moi » loads its list on the click: a file of public/, served by Cloudflare before the Worker runs.
  "/defibrillateurs": { subrequests: 6, cpuMs: 40, from: ["src/tools/dae.ts"], what: "la page /defibrillateurs\u00a0; « Autour de moi » charge au clic la liste compacte (public/dae/), servie par Cloudflare avant le Worker : 0 Worker, 0 KV, 0 D1" },
  "/sport": { subrequests: 42, cpuMs: 120, from: ["src/tools/sport.ts"] },
  "/decheteries": { subrequests: 12, cpuMs: 30, from: ["src/tools/decheteries.ts"] },
  // Measured 27 out of an active system; 1 more while one is active: the RSMC's map's state (KV).
  "/cyclones": { subrequests: 28, cpuMs: 50, from: ["src/tools/cyclones.ts"] },
  // The tool without a place (the vigilance, the levels and the flows of every gauge, three posts), and the news read
  // again after the response when it is old, as on /trafic, for the headlines on the fords.
  "/crues": { subrequests: 30, cpuMs: 120, from: ["src/tools/crues.ts", "src/tools/actualites.ts"], basis: "estimé" },
  // 15 measured, and before noon the day before kept by the scheduled event, read with the hours of Saint-Denis (KV).
  "/historique": { subrequests: 16, cpuMs: 70, from: ["src/tools/historique.ts"], basis: "estimé" },
  "/evenements": { subrequests: 54, cpuMs: 200, from: ["src/tools/agenda.ts"] },
  "/evenements/ce-week-end": { subrequests: 36, cpuMs: 230, from: ["src/tools/agenda.ts"], what: "comme /evenements, une partie de sa copie" },
  "/evenements/concerts": { subrequests: 36, cpuMs: 230, from: ["src/tools/agenda.ts"], what: "comme /evenements, une partie de sa copie" },
  "/actualites": { subrequests: 20, cpuMs: 160, from: ["src/tools/actualites.ts"] },
  "/enfants": { subrequests: 37, cpuMs: 350, from: ["src/tools/agenda.ts"] },
  // The page's copy, the store's copy of the offers (KV, written each hour by the scheduled event) and the header's
  // reads, as /eau: no read of the site on a view.
  "/emploi": { subrequests: 11, cpuMs: 80, from: ["src/tools/emploi.ts"], basis: "code" },
  // The page's copy, the store's copy of the notices (KV, written each hour by the scheduled event) and the header's
  // reads, as /emploi: no read of the BOAMP on a view.
  "/marches-publics": { subrequests: 11, cpuMs: 60, from: ["src/providers/marches-publics.ts"], basis: "code" },
};

/** The other pages that read sources. */
const OTHER_PAGES: Record<string, Page> = {
  // 75 measured, and one more read for the tile of the rivers (/crues).
  "/": { subrequests: 76, cpuMs: 110, from: METEO, what: "accueil : sa météo, ses tuiles, et la plus vieille refaite après la réponse", d1: BUS_D1 },
  "/communes/*": { subrequests: 78, cpuMs: 160, from: [...METEO, "src/tools/mer.ts"], what: "page d'une commune : sa météo, ses tuiles, et la plus vieille refaite après la réponse" },
  "/aujourdhui/*": { subrequests: 62, cpuMs: 130, from: ["src/tools/resume.ts"], what: "la journée d'une commune (resume_du_jour)" },
  "/meteo/*": { subrequests: 50, cpuMs: 130, from: [...METEO, "src/tools/mer.ts"], what: "la météo d'un lieu" },
  // The replay of the last 3 hours (web/pluie-retro.ts), asked when /meteo's rain or wind layer is first shown: the radar's
  // history read from KV, the hourly package from the data center's cache (its token and the package when it has none).
  "/meteo/retro-3h.json": { subrequests: 3, cpuMs: 10, from: ["src/providers/meteofrance.ts"], what: "le rejeu des 3 dernières heures de la carte de /meteo : l'historique radar (KV) et le vent des heures rondes", basis: "code" },
  // The replay bar's files (web/rejeu.ts), asked when the visitor plays, kept by the data center 5 min, 15 min and up
  // to the next hour: the radar's history (KV, not for the week), the stations' week (KV, written back when newer), the
  // hourly package from the cache (its token and the package when it has none), the archive in D1 for the hours the
  // week lacks, at most once in 6 hours (about 140 rows).
  "/meteo/rejeu-6h.json": { subrequests: 6, cpuMs: 20, from: ["src/web/rejeu.ts", "src/providers/meteofrance.ts"], what: "la barre de lecture de /meteo sur 6 heures : le radar toutes les 5 min (KV) et les heures rondes des stations", basis: "code", d1: { d1Calls: 1, d1RowsRead: 140 } },
  "/meteo/rejeu-24h.json": { subrequests: 6, cpuMs: 20, from: ["src/web/rejeu.ts", "src/providers/meteofrance.ts"], what: "la barre de lecture de /meteo sur 24 heures : le radar au quart d'heure (KV) et les heures rondes des stations", basis: "code", d1: { d1Calls: 1, d1RowsRead: 140 } },
  "/meteo/rejeu-7j.json": { subrequests: 5, cpuMs: 30, from: ["src/web/rejeu.ts", "src/providers/meteofrance.ts"], what: "la barre de lecture de /meteo sur 7 jours : les heures rondes des stations (KV)", basis: "code", d1: { d1Calls: 1, d1RowsRead: 140 } },
  "/mer": { subrequests: 23, cpuMs: 120, from: ["src/tools/mer.ts", "src/tools/maree.ts"] },
  "/randonnees/*": { subrequests: 23, cpuMs: 130, from: ["src/tools/sentiers.ts"], what: "une randonnée et sa trace" },
  "/sentiers/*": { subrequests: 16, cpuMs: 30, from: ["src/tools/sentiers.ts"], what: "un sentier et sa trace" },
  // Its pattern and its stops (2 reads of D1), the network's real-time feed while the bus is on the road, the header's
  // vigilance and version. Measured 4 under wrangler dev without the sources (26/10): 2 of D1, 2 of the header.
  // Its passes, the patterns of the next hours (one read more when they are few), the real-time feeds of its networks,
  // the header's vigilance and version. Measured 10 under wrangler dev on Saint-Pierre's bus station (26/10), without
  // the header's sources. The search (/bus/arret?q=) reads the bundled stops only: as "*".
  "/bus/arret/*": { subrequests: 16, cpuMs: 60, from: ["src/tools/transports.ts"], d1: { d1Calls: 3, d1RowsRead: 150 }, what: "la page d'un arrêt de bus : ses prochains départs", basis: "code" },
  "/bus/trajet/*": { subrequests: 11, cpuMs: 30, from: ["src/tools/transports.ts"], d1: { d1Calls: 2, d1RowsRead: 6 }, what: "le trajet d'un bus, arrêt par arrêt", basis: "code" },
  "/coupures-eau/*": { subrequests: 27, cpuMs: 70, from: ["src/tools/coupures.ts"], what: "les coupures d'une commune" },
  // The copy of /enfants, its agenda kept to the commune: the same reads as /enfants when it builds it.
  "/enfants/*": { subrequests: 37, cpuMs: 350, from: ["src/tools/agenda.ts"], what: "les lieux pour les enfants d'une commune, sur sa carte", basis: "code" },
  "/feux": { subrequests: 20, cpuMs: 90, from: ["src/tools/feux.ts"] },
  "/ecoles-cyclone": { subrequests: 12, cpuMs: 50, from: ["src/tools/ecoles.ts"] },
  "/carburants": { subrequests: 13, cpuMs: 30, from: ["src/tools/carburants.ts"] },
  "/associations": { subrequests: 10, cpuMs: 40, from: ["src/web/propositions.ts"], what: "l'espace des associations et leurs propositions (D1)" },
  // The header's reads as /associations, then Turnstile, HelloAsso's token and the association its keys administer
  // (connecteurs/helloasso.ts), and whether it is linked already (D1). « C'est bien nous » writes the row and sends the
  // e-mail instead of asking HelloAsso.
  "/associations/relier": { subrequests: 14, cpuMs: 40, from: ["src/web/connecteurs.ts"], d1: { d1Calls: 2, d1RowsRead: 2 }, what: "relier sa plateforme : les clés vérifiées par HelloAsso, puis la connexion écrite (D1) et l'e-mail", basis: "code" },
  // The link found by its hash, then confirmed or withdrawn: a replaced or withdrawn link takes its events with it.
  "/associations/connexion/*": { subrequests: 14, cpuMs: 30, from: ["src/web/connecteurs.ts"], d1: { d1Calls: 4, d1RowsRead: 4 }, what: "le lien reçu par e-mail : confirmer ou retirer la connexion (D1), et l'e-mail qui le dit", basis: "code" },
  // The open feeds: the data center's copy (Cache API), else the published proposals (D1, one row each) and the copy
  // written, kept 5 minutes; no header, no source.
  "/associations/evenements.*": { subrequests: 3, cpuMs: 20, from: ["src/web/flux-associations.ts"], d1: { d1Calls: 1, d1RowsRead: 100 }, what: "les flux ouverts des événements proposés (JSON, ICS) : la copie du centre de données, sinon les propositions publiées (D1), 5 minutes", basis: "estimé" },
  "/sites-sans-reponse": { subrequests: 9, cpuMs: 40, from: ["src/sans-reponse.ts"], d1: SANS_REPONSE_D1, what: "les sites publics sans réponse (D1), avec la vigilance et la version de l'en-tête", basis: "code" },
  // The header's reads as any page, and the copy of the mobile sites out of service (KV, behind the data center's cache);
  // the map and the table bundled, built at the isolate's first view.
  "/antennes": { subrequests: 8, cpuMs: 80, from: ["src/providers/sites-hs.ts"], what: "la page des antennes : la carte et le tableau (dans le paquet), et la copie des sites mobiles hors service", basis: "code" },
  // The copy of its counts (the data center's cache, else KV): never a source.
  "/chiffres": { subrequests: 9, cpuMs: 40, from: [], what: "rundata.re en chiffres : la copie de ses comptes, avec la vigilance et la version de l'en-tête", basis: "code" },
  "*": { subrequests: 7, cpuMs: 70, from: [], what: "toute autre adresse : la vigilance et la version, lues pour l'en-tête" },
};

const pageEntry = (path: string, p: Page, kvReads: number): Entry => ({
  id: path,
  trigger: "visite",
  what: p.what ?? `la page ${path}`,
  run: { subrequests: p.subrequests, ...(kvReads && { kvReads }), ...p.d1, cpuMs: p.cpuMs },
  from: p.from,
  basis: p.basis ?? "mesuré",
});

// A page reads a shared copy from KV when its data center's cache has none: at most once per shared copy it shows.
const SHARED_KEYS = new Set([...SHARED, ...SHARED_AFTER].map((s) => s.key));
const sharedIn = (keys: string[]) => new Set(keys.filter((k) => SHARED_KEYS.has(k))).size;
// The commune pages and /antennes: the copy of the mobile sites out of service besides.
const KV_READS: Record<string, number> = { "/chiffres": 1, "/antennes": 1, "/meteo/retro-3h.json": 1, "/meteo/rejeu-6h.json": 2, "/meteo/rejeu-24h.json": 2, "/meteo/rejeu-7j.json": 1, "/": sharedIn(HOME_TILES), "/communes/*": sharedIn(COMMUNE_TILES) + 1, "/aujourdhui/*": sharedIn([...COMMUNE_TILES, ...HOME_TILES]) };

const VISITS: Entry[] = [
  ...Object.entries(OTHER_PAGES).map(([path, p]) => pageEntry(path, p, KV_READS[path] ?? 0)),
  ...Object.entries(DOMAIN_PAGES).map(([path, p]) => pageEntry(path, p, SHARED_KEYS.has(DOMAINS[path]?.key) ? 1 : 0)),
];

// --- The questions -------------------------------------------------------------------------------------------------

/** Every tool (server.ts), as measured: the most subrequests of a call, its CPU, its file. */
const TOOLS: Record<string, { subrequests: number; cpuMs: number; file?: string; kvReads?: number; d1?: Pick<Run, "d1Calls" | "d1RowsRead" | "d1RowsWritten">; basis?: Basis; from?: string[] }> = {
  resume_du_jour: { subrequests: 59, cpuMs: 130, file: "resume" },
  meteo_actuelle: { subrequests: 36, cpuMs: 120, file: "meteo" },
  evenements: { subrequests: 33, cpuMs: 190, file: "agenda" },
  sport: { subrequests: 33, cpuMs: 160, file: "sport" },
  // Measured 26, before it read the list of the silent sites, as /volcan; 6 more for two releases' pages, as /volcan.
  volcan_seismes: { subrequests: 36, cpuMs: 90, file: "volcan", d1: SANS_REPONSE_D1 },
  // 24 measured, and the street's sales from the code: for a street not copied yet, one file a year of DVF géolocalisées
  // (6, each redirected once to its storage) and about 10 ms to read them; copied 7 days.
  fiche_terrain: { subrequests: 36, cpuMs: 80, file: "terrain", basis: "estimé" },
  prevision_meteo: { subrequests: 20, cpuMs: 100, file: "prevision" },
  qualite_eau: { subrequests: 15, cpuMs: 90, file: "eau" },
  temperature_mer: { subrequests: 14, cpuMs: 50, file: "mer" },
  transports: { subrequests: 13, cpuMs: 80, file: "transports", d1: BUS_D1 },
  // Measured 13; 1 more while a system is active, as /cyclones.
  cyclones: { subrequests: 14, cpuMs: 70, file: "cyclones" },
  actualites: { subrequests: 10, cpuMs: 180, file: "actualites" },
  // 10 measured, and before noon the day before kept by the scheduled event (one read of KV).
  historique_meteo: { subrequests: 11, cpuMs: 60, file: "historique", d1: { d1Calls: 3, d1RowsRead: 300 }, basis: "estimé" },
  sentiers_randonnee: { subrequests: 10, cpuMs: 60, file: "sentiers" },
  vigilance_meteo: { subrequests: 10, cpuMs: 50, file: "vigilance" },
  coupures_eau: { subrequests: 9, cpuMs: 110, file: "coupures" },
  electricite: { subrequests: 9, cpuMs: 60, file: "electricite" },
  crues_rivieres: { subrequests: 9, cpuMs: 30, file: "crues" },
  calendrier: { subrequests: 7, cpuMs: 70, file: "calendrier" },
  velos_libre_service: { subrequests: 6, cpuMs: 30, file: "velos" },
  maree: { subrequests: 6, cpuMs: 130, file: "maree" },
  annuaire_services_publics: { subrequests: 3, cpuMs: 20, file: "annuaire" },
  restrictions_eau: { subrequests: 3, cpuMs: 60, file: "secheresse" },
  bornes_recharge: { subrequests: 3, cpuMs: 50, file: "bornes" },
  // The index (3), the copy of the measures at the stations (3), the copy of the sensors (1), test/capteurs.test.ts.
  qualite_air: { subrequests: 7, cpuMs: 50, file: "air", kvReads: 2 },
  // The copy of the offers, written each hour by the scheduled event (KV): no read of the site.
  emploi: { subrequests: 3, cpuMs: 40, file: "emploi", kvReads: 1, basis: "code" },
  defibrillateurs: { subrequests: 0, cpuMs: 70, file: "dae" },
  donner_avis: { subrequests: 1, cpuMs: 60, d1: { d1Calls: 1, d1RowsRead: 5, d1RowsWritten: 3 } },
  // The copy of /chiffres for its block `chiffres` (the data center's cache, else KV).
  sources_donnees: { subrequests: 2, cpuMs: 40, basis: "code" },
  // Its file imports the page's address, whose imports reach every source: its reads start at the rows'.
  sites_sans_reponse: { subrequests: 2, cpuMs: 30, from: ["src/sans-reponse.ts"], d1: SANS_REPONSE_D1, basis: "code" },
};

const QUESTIONS: Entry[] = Object.entries(TOOLS).map(([tool, t]) => ({
  id: tool,
  trigger: "question",
  what: `l'outil ${tool}`,
  run: { subrequests: t.subrequests, ...(t.kvReads && { kvReads: t.kvReads }), ...t.d1, cpuMs: t.cpuMs },
  from: t.from ?? (t.file ? [`src/tools/${t.file}.ts`] : []),
  basis: t.basis ?? "mesuré",
}));

const ENTRIES: Entry[] = [...SCHEDULED, ...ACTIONS, ...VISITS, ...QUESTIONS];
export const TOOL_NAMES = Object.keys(TOOLS);
export const PAGE_PATHS = { domains: Object.keys(DOMAIN_PAGES), others: Object.keys(OTHER_PAGES) };

// --- The sources each entry reaches --------------------------------------------------------------------------------

const SRC = new URL("./", import.meta.url);
const read = (file: string) => readFileSync(new URL(file.replace(/^src\//, ""), SRC), "utf8");
/** Every source file, as `src/…`. */
export const SOURCE_FILES = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts")).map((f) => `src/${f}`).sort();
const join = (dir: string, rel: string) => {
  const parts = dir.split("/");
  for (const p of rel.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
};
// A type-only import runs nothing: left out, else a file importing a hub's types would reach every source.
const TYPE_ONLY = /^\s*(?:import|export)\s+type\b[^;]*;/gm;
const imports = new Map(SOURCE_FILES.map((f) => {
  const dir = f.slice(0, f.lastIndexOf("/"));
  const deps = [...read(f).replace(TYPE_ONLY, "").matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)\.js["']/g)].map((m) => join(dir, m[1]) + ".ts");
  return [f, deps.filter((d) => SOURCE_FILES.includes(d))];
}));
// What http.ts exports that reads a site; the rest (httpUrl, USER_AGENT, whenFailed, IN_FLIGHT…) reads nothing.
const HTTP_READS = /import\s*\{[^}]*\b(?:getJson|getText|getBytes|getLines|postForm|postBytes|postJson)\b[^}]*\}\s*from\s*["'](?:\.{1,2}\/)+http\.js["']/;
/** The files that fetch: those that import a read of src/http.ts (src/providers/mf-auth.ts too, which fetches its token itself). */
export const FETCHING = SOURCE_FILES.filter((f) => f !== "src/http.ts" && f !== "src/registre.ts" && (HTTP_READS.test(read(f)) || /\bawait fetch\(/.test(read(f))) && !f.startsWith("src/web/pwa"));
/** Files that reach nearly every source: an entry starting there would hide what it reads. */
export const HUBS = ["src/web/data.ts", "src/web/site.ts", "src/worker.ts", "src/server.ts", "src/app.ts"];

/** The fetching files `from` reaches through its imports. */
export function reached(from: string[]): string[] {
  const seen = new Set(from);
  const todo = [...from];
  while (todo.length) for (const d of imports.get(todo.pop()!) ?? []) if (!seen.has(d)) (seen.add(d), todo.push(d));
  return FETCHING.filter((f) => seen.has(f));
}

/**
 * The sources read for the whole island (cache.ts `island`: NASA FIRMS's fires, CAMS's UV, the OVPF's posts, Piton
 * Live, the water notices, the prefecture's list, Vigicrues Réunion's vigilance, heights and flows) that each entry reads, from the imports of its files (not their
 * helpers'). From cold, each is asked of KV as well and written there, beyond what the entry measured: a read and a
 * write more, two subrequests.
 */
export const ISLAND_READS: Record<string, number> = {
  "web:volcan": 3, "/volcan": 3, volcan_seismes: 3,
  resume_du_jour: 3, "/aujourdhui/*": 3,
  "/": 2, "/communes/*": 2, "/meteo": 2, "/meteo/*": 2,
  cyclones: 1, "/cyclones": 1, "/ecoles-cyclone": 1,
  "/feux": 1, sentiers_randonnee: 1, "/sentiers": 1, "/sentiers/*": 1, "/randonnees": 1, "/randonnees/*": 1, vigilance_meteo: 1,
  prevision_meteo: 1,
  "web:crues": 3, crues_rivieres: 3, "/crues": 3,
  "web:coupures": 1, coupures_eau: 1, "/coupures-eau": 1, "/coupures-eau/*": 1, qualite_eau: 1, "/eau": 1,
};
const withIsland = (e: Entry): Entry => {
  const n = ISLAND_READS[e.id] ?? 0;
  return n ? { ...e, run: { ...e.run, subrequests: e.run.subrequests + 2 * n, kvReads: (e.run.kvReads ?? 0) + n, kvWrites: (e.run.kvWrites ?? 0) + n } } : e;
};
export const REGISTRY: Entry[] = ENTRIES.map(withIsland);

// --- The totals ----------------------------------------------------------------------------------------------------

/** KV and D1 calls together: what the platform's SERVICE_OPS_LIMIT counts. */
export const serviceOps = (r: Run) => (r.kvReads ?? 0) + (r.kvWrites ?? 0) + (r.kvLists ?? 0) + (r.d1Calls ?? 0);

const sum = (runs: Run[]): Run => runs.reduce<Run>((a, r) => ({
  subrequests: a.subrequests + r.subrequests,
  kvReads: (a.kvReads ?? 0) + (r.kvReads ?? 0),
  kvWrites: (a.kvWrites ?? 0) + (r.kvWrites ?? 0),
  kvLists: (a.kvLists ?? 0) + (r.kvLists ?? 0),
  d1Calls: (a.d1Calls ?? 0) + (r.d1Calls ?? 0),
  d1RowsRead: (a.d1RowsRead ?? 0) + (r.d1RowsRead ?? 0),
  d1RowsWritten: (a.d1RowsWritten ?? 0) + (r.d1RowsWritten ?? 0),
  cpuMs: a.cpuMs + r.cpuMs,
  memoryMb: (a.memoryMb ?? 0) + (r.memoryMb ?? 0),
}), { subrequests: 0, cpuMs: 0 });

const scheduled = (entries = REGISTRY) => entries.filter((e) => e.trigger === "planifiée");

/** Every scheduled entry at once, from cold: after a deploy, every copy due in the same event. */
export const worstEvent = (entries = REGISTRY) => sum(scheduled(entries).map((e) => e.run));

/** Whether `e` runs in the event at minute `t` of the day (UTC); `shortest`: at its shortest cadence. */
const runsAt = (e: Entry, t: number, shortest = false) => {
  const every = (shortest && e.shortest) || e.every;
  return every != null && (every <= EVENT_MINUTES || (((t - (e.offset ?? 0)) % every) + every) % every < EVENT_MINUTES);
};

/** The busiest event of a day by the offsets, its minute (UTC) and what runs in it. */
export function busiestEvent(entries = REGISTRY, shortest = false): { minute: number; ids: string[]; run: Run } {
  let best = { minute: 0, ids: [] as string[], run: sum([]) };
  for (let t = 0; t < 24 * 60; t += EVENT_MINUTES) {
    const at = scheduled(entries).filter((e) => runsAt(e, t, shortest));
    const run = sum(at.map((e) => e.run));
    if (run.subrequests > best.run.subrequests) best = { minute: t, ids: at.map((e) => e.id), run };
  }
  return best;
}

/** A day of the scheduled event and the workflows: each entry times the runs of a day. */
export function perDay(trigger: "planifiée" | "actions", entries = REGISTRY, shortest = false): Run {
  return sum(entries.filter((e) => e.trigger === trigger && e.every != null).map((e) => {
    const n = (24 * 60) / ((shortest && e.shortest) || e.every!);
    const r = e.run;
    return { subrequests: r.subrequests * n, kvReads: (r.kvReads ?? 0) * n, kvWrites: (r.kvWrites ?? 0) * n, kvLists: (r.kvLists ?? 0) * n, d1Calls: (r.d1Calls ?? 0) * n, d1RowsRead: (r.d1RowsRead ?? 0) * n, d1RowsWritten: (r.d1RowsWritten ?? 0) * n, cpuMs: r.cpuMs * n };
  }));
}

/** The dearest view or call, against PAGE_BUDGET. */
export const dearest = (trigger: "visite" | "question", entries = REGISTRY) =>
  entries.filter((e) => e.trigger === trigger).reduce((a, e) => (e.run.subrequests > a.run.subrequests ? e : a));

/** The dearest build of a shared copy, against BUILD_BUDGET. */
export const dearestBuild = () => [...SHARED, ...SHARED_AFTER].reduce((a, s) => ((s.cold ?? 0) > (a.cold ?? 0) ? s : a));

export const LIMITS = { SUBREQUEST_LIMIT, SERVICE_OPS_LIMIT, SCHEDULED_BUDGET, PAGE_BUDGET, BUILD_BUDGET, IN_FLIGHT, SCHEDULED_CPU_MS, ISOLATE_MEMORY_MB };

/** Each total against its limit: what the test checks and BUDGET.md shows. */
export function checks(entries = REGISTRY): { what: string; value: number; limit: number }[] {
  const worst = worstEvent(entries);
  const busy = busiestEvent(entries, true);
  return [
    { what: "pire passage planifié, sous-requêtes", value: worst.subrequests, limit: SCHEDULED_BUDGET },
    { what: "pire passage planifié, appels KV et D1", value: serviceOps(worst), limit: SERVICE_OPS_LIMIT },
    { what: "pire passage planifié, CPU (ms)", value: worst.cpuMs, limit: SCHEDULED_CPU_MS },
    { what: "pire passage planifié, mémoire déclarée (Mo)", value: worst.memoryMb ?? 0, limit: ISOLATE_MEMORY_MB },
    { what: "passage le plus chargé (cadences les plus courtes), sous-requêtes", value: busy.run.subrequests, limit: SCHEDULED_BUDGET },
    { what: "vue la plus chère, sous-requêtes", value: dearest("visite", entries).run.subrequests, limit: PAGE_BUDGET },
    { what: "question la plus chère, sous-requêtes", value: dearest("question", entries).run.subrequests, limit: PAGE_BUDGET },
    { what: "construction de copie la plus chère, sous-requêtes", value: dearestBuild().cold ?? 0, limit: BUILD_BUDGET },
  ];
}

// --- BUDGET.md -----------------------------------------------------------------------------------------------------

const n = (x: number | undefined) => (x ? Math.round(x).toLocaleString("fr-FR").replace(/ /g, " ") : "");
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const cadence = (e: Entry) => (e.every == null ? (e.trigger === "actions" ? "à chaque fusion" : "à chaque vue") : `${e.every} min${e.shortest ? ` (${e.shortest} au plus court)` : ""}`);
const row = (e: Entry) => `| ${e.id} | ${e.what} | ${cadence(e)} | ${e.every != null ? hhmm(e.offset ?? 0) : ""} | ${n(e.run.subrequests) || "0"} | ${n(e.run.kvReads)} | ${n((e.run.kvWrites ?? 0) + (e.run.kvLists ?? 0))} | ${n(e.run.d1Calls)} | ${n(e.run.d1RowsRead)} | ${n(e.run.d1RowsWritten)} | ${n(e.run.cpuMs)} | ${e.basis} |`;
const HEAD = "| entrée | ce que c'est | cadence | décalage (UTC) | sous-requêtes | lectures KV | écritures KV | appels D1 | lignes D1 lues | lignes D1 écrites | CPU (ms) | d'où |\n|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|";
const totalRow = (what: string, r: Run, k = 1) => `| ${what} | ${n(r.subrequests * k) || "0"} | ${n((r.kvReads ?? 0) * k)} | ${n(((r.kvWrites ?? 0) + (r.kvLists ?? 0)) * k)} | ${n((r.d1Calls ?? 0) * k)} | ${n((r.d1RowsRead ?? 0) * k)} | ${n((r.d1RowsWritten ?? 0) * k)} | ${n(r.cpuMs * k)} |`;
const TOTAL_HEAD = "| | sous-requêtes | lectures KV | écritures KV | appels D1 | lignes D1 lues | lignes D1 écrites | CPU (ms) |\n|---|---:|---:|---:|---:|---:|---:|---:|";

/** French spacing: a no-break space before « : ; ? ! » and inside the guillemets. */
const typeset = (md: string) => md.replace(/ ([:;?!])/g, "\u00a0$1").replace(/« /g, "«\u00a0").replace(/ »/g, "\u00a0»");

export function budget(entries = REGISTRY): string {
  const by = (t: Trigger) => entries.filter((e) => e.trigger === t).map(row).join("\n");
  const worst = worstEvent(entries);
  const usual = busiestEvent(entries);
  const short = busiestEvent(entries, true);
  // The same without the shared copies' offsets: all in the event of 00:00 UTC, as before they had any.
  const together = busiestEvent(entries.map((e) => (SHARED_KEYS.has(e.id) ? { ...e, offset: 0 } : e)), true);
  const day = perDay("planifiée", entries);
  const dayShort = perDay("planifiée", entries, true);
  const actions = perDay("actions", entries);
  const view = dearest("visite", entries);
  const ask = dearest("question", entries);
  const build = dearestBuild();
  return typeset(`# Budget\n\n` +
    `Ce que coûte chaque lecture de rundata.re : ce qui la lance, sa cadence et son décalage, ce que prend une exécution à froid, et les totaux face aux limites de la plateforme et du code (src/budget.ts).\n\n` +
    `<!-- Généré à partir de src/registre.ts par \`npx tsx scripts/build-budget.ts\` : modifier les déclarations là-bas. -->\n\n` +
    `Les chiffres « mesuré » sont le plus haut relevé ${MEASURED} : sous-requêtes d'une vue ou d'un appel, refusées comprises, et CPU arrondi au-dessus. « code » : lu dans le code (une borne, un compte). « estimé » : d'après la mesure d'une lecture voisine. Une écriture KV compte aussi les listes de clés.\n\n` +
    `## Limites\n\n` +
    `- ${n(SUBREQUEST_LIMIT)} sous-requêtes par invocation, et ${n(SERVICE_OPS_LIMIT)} appels à KV, D1 et aux autres services liés, ensemble.\n` +
    `- ${IN_FLIGHT} lectures en vol à la fois par invocation (src/http.ts), sur les 6 connexions que la plateforme ouvre ensemble.\n` +
    `- Tâche planifiée : toutes les ${EVENT_MINUTES} minutes, ${n(SCHEDULED_BUDGET)} sous-requêtes, ${n(SCHEDULED_CPU_MS)} ms de CPU.\n` +
    `- Mémoire : ${n(ISOLATE_MEMORY_MB)} Mo par isolat, pour toutes les invocations qu'il sert ensemble.\n` +
    `- Une visite ou une question : ${n(PAGE_BUDGET)} sous-requêtes. Une construction de copie : ${n(BUILD_BUDGET)}.\n\n` +
    `## Totaux\n\n` +
    `| contrôle | valeur | limite |\n|---|---:|---:|\n` +
    checks(entries).map((c) => `| ${c.what} | ${n(c.value)} | ${n(c.limit)} |`).join("\n") + `\n\n` +
    `- Pire passage planifié : toutes les entrées planifiées dues ensemble, à froid (après un déploiement).\n` +
    `- Mémoire : déclarée par les lectures d'un fichier de plusieurs Mo (${scheduled(entries).filter((e) => e.run.memoryMb).map((e) => `${e.id}, ${n(e.run.memoryMb)} Mo au pic`).join(", ")}), face aux ${n(ISOLATE_MEMORY_MB)} Mo d'un isolat\u00a0; les autres ne la déclarent pas.\n` +
    `- Passage le plus chargé selon les décalages, cadences habituelles : ${hhmm(usual.minute)} UTC, ${n(usual.run.subrequests)} sous-requêtes (${usual.ids.join(", ")}).\n` +
    `- Le même, cadences les plus courtes (volcan en alerte, satellites en retard, carburants en fin de mois) : ${hhmm(short.minute)} UTC, ${n(short.run.subrequests)} sous-requêtes (${short.ids.join(", ")}).\n` +
    `- Sans les décalages des copies partagées (toutes dues à 00:00 UTC), cadences les plus courtes : ${n(together.run.subrequests)} sous-requêtes à ${hhmm(together.minute)} UTC.\n` +
    `- Vue la plus chère : ${view.id}, ${n(view.run.subrequests)}. Question la plus chère : ${ask.id}, ${n(ask.run.subrequests)}. Construction la plus chère : ${build.key}, ${n(build.cold)}.\n\n` +
    TOTAL_HEAD + "\n" +
    totalRow("pire passage planifié", worst) + "\n" +
    totalRow("tâche planifiée, par jour", day) + "\n" +
    totalRow("tâche planifiée, par jour, cadences les plus courtes", dayShort) + "\n" +
    totalRow("tâche planifiée, par mois (30 jours)", day, 30) + "\n" +
    totalRow("tâches GitHub, par jour", actions) + "\n" +
    totalRow("tâches GitHub, par mois (30 jours)", actions, 30) + "\n\n" +
    `Les visites et les questions sont comptées par vue : leur total dépend du trafic.\n\n` +
    `## Tâche planifiée\n\n${HEAD}\n${by("planifiée")}\n\n` +
    `## Tâches GitHub\n\n${HEAD}\n${by("actions")}\n\n` +
    `## Visites\n\n${HEAD}\n${by("visite")}\n\n` +
    `## Questions\n\n${HEAD}\n${by("question")}\n\n` +
    `## Sources lues\n\nLes fichiers qui lisent un site (par src/http.ts), atteints par les imports de chaque entrée.\n\n| entrée | sources |\n|---|---|\n` +
    entries.filter((e) => e.from.length).map((e) => `| ${e.id} | ${reached(e.from).map((f) => f.replace(/^src\//, "").replace(/\.ts$/, "")).join(", ")} |`).join("\n") + "\n");
}
