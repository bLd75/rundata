/**
 * The OVPF's releases in PDF, read for their title and their « Niveau d'alerte : … » line, quoted as written. Only the
 * PDF a post of the observatory links to (volcan.ts, `Post.pdf`), never an address guessed; only in the scheduled
 * refresh of the /volcan copy (web/partagees.ts), never for a question; read once, kept in KV under its address, since
 * a release does not change.
 *
 * The title is the last part of the release's dated line, « 24/10/2026 – 18h30 heure locale – Arrêt crise sismique »,
 * after « heure locale – », and only when that whole part is in red, the colour of the release's title: the section
 * titles below (« Trémor », « Sismicité ») are red too, and a release may have no title at all (« 21 avril 2026 – 8h30
 * heure locale – 4h30 heure UTC »). The dated line must give the day of the post or of the address, give or take one.
 * Anything else read is nothing, and logged.
 */
import { left } from "../budget.js";
import type { Cache } from "../cache.js";
import { getBytes } from "../http.js";
import { type Line, pdfLines } from "../pdf.js";
import * as volcan from "./volcan.js";

/**
 * What is read is shown only once a real release with a title has been read right (its copy as a fixture): until
 * then it is logged and kept, and nothing more is said than before.
 */
export const SHOW = false;

/** What a release's PDF gives, as written. `jour`: the day of its dated line, « 2026-10-24 ». */
export interface Lu {
  jour: string;
  titre?: string;
  niveau_alerte?: string;
}

/** A PDF read (`lu`), one read but not recognised (`ecart`, never read again), or one not fetched (`echec`, tried again later). */
export type Lecture = { lu: Lu } | { ecart: string } | { echec: string };

export const SOURCE_ID = "ovpf_pdf";
const KEY = (url: string) => `volcan:pdf:${url}`;
// The IPGP's site has been down for days at a time: asked again at most every six hours.
const RETRY_MS = 6 * 3600_000;
// One read of KV, the PDF, one write.
const COST = 3;
const TITLE_MAX = 80;

const MONTHS: Record<string, number> = {
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12,
};
// « 21 avril 2026 – 8h30 heure locale – … » or « 24/10/2026 – 18h30 heure locale – … », the long dash or the short one.
const DATED = new RegExp(
  `(?:(\\d{1,2})(?:er)?\\s+(${Object.keys(MONTHS).join("|")})\\s+(\\d{4})|(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4}))` +
    `\\s*[–-]\\s*\\d{1,2}\\s*h\\s*\\d{0,2}\\s+heure locale\\s*(?:[–-]\\s*(?<rest>.*?))?\\s*$`,
  "id",
);
const ALERT_LINE = /^Niveau d['’]alerte\s*:\s*\S/i;

const isRed = ([r, g, b]: [number, number, number]) => r >= 0.8 && g <= 0.25 && b <= 0.25;
const pad = (n: number) => String(n).padStart(2, "0");
const DAY_MS = 86_400_000;

/**
 * The title and the alert line of a release, from its lines, `expected` the days it may be dated (the post's, the
 * address'): an `ecart` with the reason when the PDF is not the release expected or not one this code knows.
 */
export function readRelease(lines: Line[], expected: string[]): Lecture {
  const first = lines.filter((l) => l.page === 1);
  for (const line of first) {
    const raw = line.runs.map((r) => r.text).join("");
    const m = DATED.exec(raw);
    if (!m) continue;
    const [, d1, month, y1, d2, m2, y2] = m;
    const jour = d1 ? `${y1}-${pad(MONTHS[month.toLowerCase()])}-${pad(Number(d1))}` : `${y2}-${pad(Number(m2))}-${pad(Number(d2))}`;
    if (!expected.some((e) => Math.abs(Date.parse(e) - Date.parse(jour)) <= DAY_MS)) {
      return { ecart: `ligne datée du ${jour}, attendu ${expected.join(" ou ")}` };
    }
    const lu: Lu = { jour };
    // The colour of each character of the line, to tell the title from the rest.
    const colours = line.runs.flatMap((r) => [...r.text].map(() => r.rgb));
    const at = m.indices?.groups?.rest;
    const rest = m.groups?.rest?.replace(/\s+/g, " ").trim();
    if (at && rest && !/heure UTC/i.test(rest) && rest.length <= TITLE_MAX) {
      // Every letter of it red, not only the first: a title, not a grey line after a red word.
      const chars = [...raw.slice(0, at[1])].length;
      const from = [...raw.slice(0, at[0])].length;
      const red = [...raw].slice(from, chars).every((c, i) => /\s/.test(c) || isRed(colours[from + i]));
      if (red) lu.titre = rest;
    }
    const alert = first.find((l) => ALERT_LINE.test(l.text) && l.text.length <= TITLE_MAX + 40);
    if (alert) lu.niveau_alerte = alert.text;
    return { lu };
  }
  return { ecart: "ligne datée introuvable en page 1" };
}

/** The days a release linked from a post may be dated: the post's at La Réunion, and the one in its address. */
export function expectedDays(post: volcan.Post): string[] {
  const days = [new Date(Date.parse(post.date) + 4 * 3600_000).toISOString().slice(0, 10)];
  const m = /OVPF_(\d{4})(\d{2})(\d{2})_/.exec(post.pdf ?? "");
  if (m) days.push(`${m[1]}-${m[2]}-${m[3]}`);
  return [...new Set(days)];
}

// The addresses this isolate knows the state of, with when to ask again: never for one read or found unreadable,
// RETRY_MS after a failure. KV is not asked for them until then.
const settled = new Map<string, number>();

/**
 * Reads the PDF of the newest post that links to one, unless it is read already: for the scheduled refresh of /volcan
 * only. Never throws; what it read or why it read nothing is logged.
 */
export async function readNewest(cache: Cache, now = Date.now()): Promise<void> {
  try {
    const post = (await volcan.posts(cache)).value.find((p) => p.pdf);
    if (!post || (settled.get(post.pdf!) ?? 0) > now) return;
    if (left() < COST) return;
    const url = post.pdf!;
    const had = await cache.kept<Lecture>(KEY(url));
    const again = had && ("echec" in had.value ? had.fetchedAt.getTime() + RETRY_MS : Infinity);
    if (again && again > now) {
      settled.set(url, again);
      return;
    }
    let lecture: Lecture;
    try {
      const bytes = await getBytes(SOURCE_ID, url, 20_000, { "User-Agent": "rundata.re (contact@rundata.re)" });
      try {
        lecture = readRelease(await pdfLines(bytes), expectedDays(post));
      } catch (e) {
        lecture = { ecart: e instanceof Error ? e.message : String(e) };
      }
    } catch (e) {
      lecture = { echec: e instanceof Error ? e.message : String(e) };
    }
    if ("lu" in lecture) {
      const { jour, titre, niveau_alerte } = lecture.lu;
      console.log(`volcan : PDF de l'OVPF lu (${url}) : ligne datée du ${jour}, titre ${titre ? `« ${titre} »` : "aucun"}, ${niveau_alerte ? `« ${niveau_alerte} »` : "pas de niveau d'alerte"}${SHOW ? "" : " (non affiché)"}`);
    } else if ("ecart" in lecture) console.error(`volcan : PDF de l'OVPF non reconnu (${url}) : ${lecture.ecart}`);
    else console.error(`volcan : PDF de l'OVPF non lu (${url}) : ${lecture.echec}`);
    await cache.keep(KEY(url), lecture);
    settled.set(url, "echec" in lecture ? now + RETRY_MS : Infinity);
  } catch (e) {
    console.error(`volcan : lecture du PDF de l'OVPF abandonnée : ${e instanceof Error ? e.message : String(e)}`);
  }
}
