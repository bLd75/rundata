/**
 * The forecast track map of the RSMC of La Réunion (Météo-France), shown on /cyclones while a system is active, with the
 * written agreement of Météo-France La Réunion of 27/10/2026: the image as Météo-France publishes it, its logo kept,
 * nothing cut out of it nor laid over it, and the link « Consulter le site officiel de Météo-France » beside it.
 *
 * - The image has one fixed address, in http only (`IMAGE_URL`), replaced at each new map. Its time of issue is printed
 *   on it: it is never copied nor deduced (no OCR, not the bulletins' time). The caption says it is there, and gives the
 *   time of our last read, named as such.
 * - The list of the RSMC's bulletins (`LISTE_URL`, CMRSF_YYYYMMDDHHMM.pdf, in UTC) only guards the image (`suit`): it is
 *   shown only if it changed, and its file was written (Last-Modified), after the bulletin before the newest, and less
 *   than `GUARD_HOURS` after the newest. The map of a cycle is written before its bulletin (12:44 and 12:49 UTC on the
 *   two copies of web.archive.org, for bulletins of the list named 20 to 30 minutes past that hour): after the newest
 *   bulletin, it would be hidden most of the time. A map of an older cycle, or a list that no longer moves, is not shown.
 * - Read by the scheduled event only, and only while GDACS (cyclones.ts) has an active system: one request to
 *   Météo-France per event, the list at 15 and 45 past the hour, the image at 20 and 50, each every 30 minutes. The
 *   image is kept in KV under its fingerprint and served from rundata.re (web/cmrs-carte.ts), never linked at its http
 *   address.
 */
import type { Cache } from "../cache.js";
import { count, perInvocation } from "../budget.js";
import { getFile, getText } from "../http.js";
import { why } from "../types.js";
import * as gdacs from "./cyclones.js";
import { fingerprint, type Store } from "./vigilance-carte.js";

const SOURCE_ID = "meteofrance_cmrs";
const SITE = "http://www.meteo.fr/temps/domtom/La_Reunion/webcmrs9.0/francais";
export const IMAGE_URL = `${SITE}/tpsreel/trajectoire.png`;
export const LISTE_URL = `${SITE}/activiteope/bulletins/cmrs/liste.html`;

/** The scheduled event reads every 30 minutes (UTC): the list at 15 and 45 past the hour, the image 5 minutes later. */
export const REFRESH_EVERY = 30;
export const LISTE_OFFSET = 15;
export const IMAGE_OFFSET = 20;
/** The image is shown only if its file was written less than this after the newest bulletin. */
export const GUARD_HOURS = 6;

export const imagePath = (empreinte: string) => `/cyclones/carte/${empreinte}.png`;
export const FICHIER = /^\/cyclones\/carte\/([0-9a-f]{16})\.png$/;

const KEY = "cmrs:carte";
const pngKey = (empreinte: string) => `${KEY}:png:${empreinte}`;
// The state and the image are kept 30 days: past that without a read, nothing is shown.
const TTL_SECONDS = 30 * 86_400;
const TIMEOUT_MS = 20_000;
const MAX_PNG = 5_000_000;
const HOUR = 3_600_000;

let store: Store | undefined;

/** The Worker's KV (worker.ts). Without it, nothing is read, kept or shown. */
export function configure(kv?: Store): void {
  store = kv;
}

/** What the scheduled event keeps in KV. Times in ISO 8601. */
export interface Etat {
  /** The two newest bulletins of the list: their time, in UTC, as their file's name gives it. */
  avis?: { dernier: string; precedent?: string };
  /** The image last read: its fingerprint and size, its Last-Modified, when that fingerprint was first read, and when it was last read. */
  image?: { empreinte: string; largeur: number; hauteur: number; modifiee?: string; depuis: string; lue: string };
  /** The last read of the image that failed, if no read succeeded since: Météo-France did not answer, or not with a PNG. */
  echec?: { le: string; raison: "sans réponse" | "illisible" };
}

/** What /cyclones shows. */
export interface Carte {
  /** The image, when it follows the newest bulletin; `lue`: our last read of it that succeeded. */
  image?: { empreinte: string; largeur: number; hauteur: number; lue: string };
  /** Météo-France has not answered since `image.lue`: the image is the last one read. */
  sans_reponse?: true;
  /** An image was read, but nothing says it follows the newest bulletin: it is not shown. */
  ecartee?: true;
  /** No image could be read: the time of the try. */
  illisible?: string;
}

/** Which read the scheduled event at `now` (every 5 minutes) makes, if one. */
export function due(now: Date): "liste" | "image" | undefined {
  const at = (offset: number) => (((now.getUTCMinutes() - offset) % REFRESH_EVERY) + REFRESH_EVERY) % REFRESH_EVERY < 5;
  return at(LISTE_OFFSET) ? "liste" : at(IMAGE_OFFSET) ? "image" : undefined;
}

/** The two newest bulletins of the list, « CMRSF_202610231306.pdf » → 2026-10-23T13:06:00.000Z; nothing without one. */
export function newest(html: string): Etat["avis"] {
  const all = new Set<string>();
  for (const m of html.matchAll(/CMRSF_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\.pdf/g)) {
    const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    if (Number.isNaN(t.getTime()) || t.getUTCDate() !== +m[3] || t.getUTCHours() !== +m[4]) continue;
    all.add(t.toISOString());
  }
  const [dernier, precedent] = [...all].sort().reverse();
  return dernier ? { dernier, ...(precedent && { precedent }) } : undefined;
}

/** A PNG's width and height, from its header; nothing if `bytes` is not a PNG. */
export function pngSize(bytes: Uint8Array): { largeur: number; hauteur: number } | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return undefined;
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return undefined;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const largeur = v.getUint32(16);
  const hauteur = v.getUint32(20);
  return largeur && hauteur ? { largeur, hauteur } : undefined;
}

/**
 * Whether the image follows the newest bulletin: first read, and written, after the bulletin before it (after the
 * newest when the list has only one), and written less than GUARD_HOURS after the newest. Without the list or the
 * image's Last-Modified, nothing says it does.
 */
export function suit(e: Etat): boolean {
  const i = e.image;
  if (!e.avis || !i?.modifiee) return false;
  const dernier = Date.parse(e.avis.dernier);
  const depuis = Date.parse(e.avis.precedent ?? e.avis.dernier);
  const ecrite = Date.parse(i.modifiee);
  return Date.parse(i.depuis) > depuis && ecrite > depuis && ecrite <= dernier + GUARD_HOURS * HOUR;
}

/** What the page shows of a state. */
export function vue(e: Etat): Carte | undefined {
  const i = e.image;
  const echec = e.echec && (!i || e.echec.le > i.lue) ? e.echec : undefined;
  if (echec && (!i || echec.raison === "illisible")) return { illisible: echec.le };
  if (!i) return undefined;
  if (!suit(e)) return { ecartee: true };
  const image = { empreinte: i.empreinte, largeur: i.largeur, hauteur: i.hauteur, lue: i.lue };
  return echec ? { image, sans_reponse: true } : { image };
}

async function etat(): Promise<Etat | undefined> {
  if (!store) return undefined;
  count(1, "read");
  return ((await store.json(KEY)) as Etat | null) ?? undefined;
}

/** The map for a page or an answer: one read of KV per invocation. Never throws. */
export function kept(): Promise<Carte | undefined> {
  return perInvocation("cmrs:carte", async () => {
    try {
      const e = await etat();
      return e && vue(e);
    } catch (err) {
      console.error("carte du CMRS : état illisible", why(err));
      return undefined;
    }
  });
}

/** A kept image, by its fingerprint. */
export async function fichier(empreinte: string): Promise<ArrayBuffer | null> {
  if (!store) return null;
  count(1, "read");
  return store.bytes(pngKey(empreinte));
}

async function lireListe(e: Etat): Promise<{ etat: Etat; dit: string }> {
  try {
    const avis = newest(await getText(SOURCE_ID, LISTE_URL, TIMEOUT_MS));
    if (!avis) return { etat: e, dit: "liste sans bulletin" };
    // Never back to an older list (a cache of Météo-France's site).
    return { etat: !e.avis || avis.dernier >= e.avis.dernier ? { ...e, avis } : e, dit: `dernier bulletin ${avis.dernier}` };
  } catch (err) {
    console.error("carte du CMRS : liste des bulletins indisponible", why(err));
    return { etat: e, dit: "liste indisponible" };
  }
}

async function lireImage(e: Etat, now: Date): Promise<{ etat: Etat; dit: string }> {
  const le = now.toISOString();
  let file: { bytes: ArrayBuffer; modifie?: string };
  try {
    file = await getFile(SOURCE_ID, IMAGE_URL, TIMEOUT_MS);
  } catch (err) {
    console.error("carte du CMRS : image indisponible", why(err));
    return { etat: { ...e, echec: { le, raison: "sans réponse" } }, dit: "image sans réponse" };
  }
  const bytes = new Uint8Array(file.bytes);
  const size = bytes.length <= MAX_PNG ? pngSize(bytes) : undefined;
  if (!size) {
    console.error(`carte du CMRS : pas une image PNG (${bytes.length} octets)`);
    return { etat: { ...e, echec: { le, raison: "illisible" } }, dit: "image illisible" };
  }
  const empreinte = await fingerprint(bytes);
  const modifie = file.modifie ? new Date(file.modifie) : undefined;
  const modifiee = modifie && !Number.isNaN(modifie.getTime()) ? modifie.toISOString() : undefined;
  const same = e.image?.empreinte === empreinte;
  if (!same) {
    count(1, true);
    await store!.put(pngKey(empreinte), file.bytes, TTL_SECONDS);
  }
  const { echec: _, ...rest } = e;
  const image = { empreinte, ...size, ...(modifiee && { modifiee }), depuis: same ? e.image!.depuis : le, lue: le };
  return { etat: { ...rest, image }, dit: `image ${empreinte}${same ? "" : " (nouvelle)"}` };
}

/**
 * The scheduled event's turn: nothing outside the minutes of `due` or without an active system; else one read, the
 * list or the image, and the state written if it changed. Returns what it did, for the log.
 */
export async function passage(cache: Cache, now = new Date()): Promise<string> {
  const quoi = due(now);
  if (!store || !quoi) return "rien à lire";
  const list = (await gdacs.systemes(cache, now)).value;
  if (!list.some((s) => gdacs.isActive(s, now))) return "aucun système actif";
  const before = (await etat()) ?? {};
  const { etat: after, dit } = quoi === "liste" ? await lireListe(before) : await lireImage(before, now);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    count(1, true);
    await store.put(KEY, JSON.stringify(after), TTL_SECONDS);
  }
  return dit;
}
