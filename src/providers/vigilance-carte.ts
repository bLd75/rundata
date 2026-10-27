/**
 * Météo-France's official map of the vigilance, shown as Météo-France publishes it: page 1 of the bulletin
 * QGFR31_FMEE_ (« Bulletin de suivi vigilance à La Réunion »), which the vigilance's zip carries (vigilance.ts), shown
 * with the written agreement of Météo-France La Réunion of 27/10/2026: its logos kept, its time of issue and the link
 * « Consulter le site officiel de Météo-France » beside it. The whole page, reduced at most: nothing cut out of it, nothing
 * laid over it.
 *
 * - The scheduled event keeps the PDF in KV when it changes, under its fingerprint, with its time of issue read in the
 *   PDF itself (« Émis le jeudi 22 octobre 2026 à 16h02 »). Without that time, there is no map: a condition of the
 *   agreement.
 * - At a later event, once KV has reached every data center, Cloudflare's browser (the binding BROWSER, its Quick Action
 *   « screenshot ») photographs the page that draws page 1 with pdf.js (`RENDU_PATH`, opened with the bulletin's own
 *   token, for that browser only), and the picture is kept beside the PDF. A headless Chrome shows nothing of a PDF
 *   opened directly (tried on 27/10/2026): pdf.js draws it, in that browser only, never in a visitor's.
 * - At most 2 tries per bulletin and 24 pictures a day: Workers Paid includes 10 browser hours a month, then each hour
 *   is billed. A try that fails is not made again before the next event.
 */
import { count, left } from "../budget.js";
import { pdfLines, type Line } from "../pdf.js";
import { why } from "../types.js";

/** The part of the Worker's KV used here. */
export interface Store {
  json(key: string): Promise<unknown>;
  bytes(key: string): Promise<ArrayBuffer | null>;
  put(key: string, value: string | ArrayBuffer, ttlSeconds?: number): Promise<void>;
}

/** The part of the binding of Cloudflare's Browser Rendering used here. */
export interface Browser {
  quickAction(action: "screenshot", options: Record<string, unknown>): Promise<Response>;
}

let store: Store | undefined;
let browser: Browser | undefined;

/** The Worker's KV and browser (worker.ts). Without KV, nothing is kept and no map is shown; without the browser, none is made. */
export function configure(kv?: Store, b?: Browser): void {
  store = kv;
  browser = kv && b;
}

export const configured = () => store != null;

/** The page that draws page 1 for the browser: not for the public (robots.txt, noindex, its token). */
export const RENDU_PATH = "/vigilance/bulletin-rendu";
/** The newest bulletin, as Météo-France issued it. */
export const PDF_PATH = "/vigilance/bulletin.pdf";
export const pdfPath = (empreinte: string) => `/vigilance/bulletin/${empreinte}.pdf`;
export const imagePath = (empreinte: string) => `/vigilance/carte/${empreinte}.png`;
export const FICHIER = /^\/vigilance\/(bulletin|carte)\/([0-9a-f]{16})\.(pdf|png)$/;

const SITE = "https://rundata.re";
const KEY = "vigilance:carte";
const pdfKey = (empreinte: string) => `${KEY}:pdf:${empreinte}`;
const pngKey = (empreinte: string) => `${KEY}:png:${empreinte}`;
// A bulletin and its picture are kept 30 days: the last one stays while Météo-France changes nothing.
const TTL_SECONDS = 30 * 86_400;
// KV reaches every data center within a minute: the browser, which may ask another one, waits for it.
const PROPAGATION_MS = 60_000;
const MAX_TRIES = 2;
const MAX_PER_DAY = 24;
// The browser, the picture and the state.
const RENDER_COST = 3;
/** Page 1 at twice its size in points (A4, 595 × 842): 1190 px wide, about 190 KB. */
export const SCALE = 2;
const MAX_PNG = 5_000_000;
const TITLE = "Bulletin de suivi vigilance à La Réunion";

/** What the scheduled event keeps in KV. Times in ms. */
export interface Etat {
  /** The newest bulletin kept, its PDF under its fingerprint; `jeton` opens its RENDU_PATH. */
  bulletin?: { emis: string; empreinte: string; taille: number; garde: number; jeton: string };
  /** The newest bulletin photographed. */
  image?: { emis: string; empreinte: string; le: number };
  essais?: { empreinte: string; n: number };
  jour?: { date: string; n: number };
  /** The last bulletin that gave no map: its time of issue unreadable, or its picture failed after its tries. */
  echec?: { le: number; empreinte: string; raison: string };
}

/**
 * What the vigilance's copy carries (vigilance.ts). The map is shown only when it is the newest bulletin's: an older
 * one could show another colour than the page's text, read from the newest (marketing, 27/10).
 */
export interface Carte {
  /** The newest bulletin kept, issued at `emis` (ISO, La Réunion's offset), its PDF at `pdfPath(empreinte)`. */
  bulletin?: { emis: string; empreinte: string };
  /** The newest bulletin photographed, its picture at `imagePath(empreinte)`. */
  image?: { emis: string; empreinte: string };
  /** When a bulletin newer than `bulletin` was read without a time of issue, ISO: no map for it. */
  illisible?: string;
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ISSUED = new RegExp(`^Émis le \\S+ (\\d{1,2})(?:er)? (${MONTHS.join("|")}) (\\d{4}) à (\\d{1,2})h(\\d{2}) \\(heure locale\\)`, "i");
const pad = (n: number | string) => String(n).padStart(2, "0");

/**
 * The time of issue of a bulletin, ISO with La Réunion's offset, from the lines of its page 1: only on Météo-France's
 * page titled TITLE, and only a time from a week before `now` to a day after it. Undefined otherwise.
 */
export function issued(lines: Line[], now: number): string | undefined {
  const first = lines.filter((l) => l.page === 1);
  if (!first.some((l) => l.text === TITLE)) return undefined;
  for (const l of first) {
    const m = ISSUED.exec(l.text);
    if (!m) continue;
    const [, d, month, y, h, min] = m;
    const iso = `${y}-${pad(MONTHS.indexOf(month.toLowerCase()) + 1)}-${pad(d)}T${pad(h)}:${min}:00+04:00`;
    const t = Date.parse(iso);
    return t > now - 7 * 86_400_000 && t < now + 86_400_000 ? iso : undefined;
  }
  return undefined;
}

/** The first 16 hexadecimal digits of the SHA-256 of `bytes`: the bulletin's name in KV and in the addresses. */
export async function fingerprint(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash.slice(0, 8)].map((b) => pad(b.toString(16))).join("");
}

const UNREADABLE = "heure d'émission illisible";
const token = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => pad(b.toString(16))).join("");
const dayOf = (ms: number) => new Date(ms + 4 * 3_600_000).toISOString().slice(0, 10);

/** The copy's view of the state. */
export function vue(etat: Etat): Carte | undefined {
  const { bulletin: b, image: i, echec } = etat;
  const out: Carte = {
    ...(b && { bulletin: { emis: b.emis, empreinte: b.empreinte } }),
    ...(i && { image: { emis: i.emis, empreinte: i.empreinte } }),
    ...(echec?.raison === UNREADABLE && echec.le > (b?.garde ?? -Infinity) && { illisible: new Date(echec.le).toISOString() }),
  };
  return out.bulletin || out.illisible ? out : undefined;
}

export async function etat(): Promise<Etat | undefined> {
  if (!store) return undefined;
  count(1, "read");
  return ((await store.json(KEY)) as Etat | null) ?? undefined;
}

/** The state of the map for a copy read outside the scheduled event. Never throws. */
export async function kept(): Promise<Carte | undefined> {
  try {
    const e = await etat();
    return e && vue(e);
  } catch (err) {
    console.error("carte de vigilance : état illisible", why(err));
    return undefined;
  }
}

/** A kept file, as bytes: the PDF or the picture of a bulletin by its fingerprint. */
export async function fichier(kind: "pdf" | "png", empreinte: string): Promise<ArrayBuffer | null> {
  if (!store) return null;
  count(1, "read");
  return store.bytes(kind === "pdf" ? pdfKey(empreinte) : pngKey(empreinte));
}

/** The browser photographs page 1 of `b`: its PNG, or an error. */
async function photograph(b: NonNullable<Etat["bulletin"]>): Promise<ArrayBuffer> {
  count(1, true);
  const r = await browser!.quickAction("screenshot", {
    url: `${SITE}${RENDU_PATH}?j=${b.jeton}`,
    viewport: { width: 595 * SCALE, height: 842 * SCALE },
    selector: "#page1",
    waitForSelector: { selector: "#page1[data-pret]", timeout: 20_000 },
    gotoOptions: { waitUntil: "load", timeout: 20_000 },
    userAgent: "rundata-rendu",
  });
  if (!r.ok) throw new Error(`capture : HTTP ${r.status}`);
  const png = await r.arrayBuffer();
  const head = new Uint8Array(png.slice(0, 8));
  if (head[0] !== 0x89 || head[1] !== 0x50 || head[2] !== 0x4e || head[3] !== 0x47) throw new Error("capture : pas une image PNG");
  if (png.byteLength > MAX_PNG) throw new Error(`capture : ${png.byteLength} octets`);
  return png;
}

/**
 * The scheduled event's turn, with the bulletin of its zip if it has one: photographs the bulletin kept at an earlier
 * event if it has no picture yet, within the limits, then keeps this one if it is new. The copy's view of the state
 * after it. Never throws.
 */
export async function passage(pdf: Uint8Array<ArrayBuffer> | undefined, now = Date.now()): Promise<Carte | undefined> {
  if (!store) return undefined;
  try {
    const e = (await etat()) ?? {};
    let changed = false;
    const b = e.bulletin;
    if (browser && b && b.empreinte !== e.image?.empreinte && now - b.garde >= PROPAGATION_MS) {
      const tries = e.essais?.empreinte === b.empreinte ? e.essais.n : 0;
      const today = e.jour?.date === dayOf(now) ? e.jour.n : 0;
      if (tries < MAX_TRIES && today < MAX_PER_DAY && left() >= RENDER_COST) {
        e.essais = { empreinte: b.empreinte, n: tries + 1 };
        e.jour = { date: dayOf(now), n: today + 1 };
        changed = true;
        try {
          const png = await photograph(b);
          count(1, true);
          await store.put(pngKey(b.empreinte), png, TTL_SECONDS);
          e.image = { emis: b.emis, empreinte: b.empreinte, le: now };
          if (e.echec?.empreinte === b.empreinte) delete e.echec;
          console.log(`carte de vigilance : bulletin émis le ${b.emis} photographié (${png.byteLength} octets)`);
        } catch (err) {
          console.error(`carte de vigilance : essai ${tries + 1} sur ${MAX_TRIES} sans image (bulletin émis le ${b.emis})`, why(err));
          if (tries + 1 >= MAX_TRIES) e.echec = { le: now, empreinte: b.empreinte, raison: "capture impossible" };
        }
      } else if (tries < MAX_TRIES && today >= MAX_PER_DAY && e.echec?.empreinte !== b.empreinte) {
        console.error(`carte de vigilance : ${MAX_PER_DAY} images aujourd'hui, bulletin émis le ${b.emis} laissé sans image`);
        e.echec = { le: now, empreinte: b.empreinte, raison: "plafond du jour" };
        changed = true;
      }
    }
    if (pdf) {
      const empreinte = await fingerprint(pdf);
      if (empreinte !== e.bulletin?.empreinte && empreinte !== e.echec?.empreinte) {
        const emis = issued(await pdfLines(pdf.buffer).catch(() => []), now);
        if (!emis) {
          console.error(`carte de vigilance : heure d'émission illisible dans le bulletin ${empreinte}`);
          e.echec = { le: now, empreinte, raison: UNREADABLE };
        } else {
          count(1, true);
          await store.put(pdfKey(empreinte), pdf.buffer, TTL_SECONDS);
          e.bulletin = { emis, empreinte, taille: pdf.byteLength, garde: now, jeton: token() };
        }
        changed = true;
      }
    }
    if (changed) {
      count(1, true);
      await store.put(KEY, JSON.stringify(e));
    }
    return vue(e);
  } catch (err) {
    console.error("carte de vigilance : passage impossible", why(err));
    return kept();
  }
}
