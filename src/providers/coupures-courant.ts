/**
 * The power cuts EDF announces, as the mairies relay them on their WordPress sites: EDF Réunion publishes none in a
 * form that can be read (its page of planned works refuses robots, its open data has no cut). Only the facts are kept
 * (the days, the hours, the streets, whether the cut is happening now), with the title and the link of the mairie's
 * post: never the notice's text, worded by EDF. Read by the scheduled event into a shared copy (web/partagees.ts).
 */
import { getJson } from "../http.js";
import { type SourceInfo, why } from "../types.js";
import { strip } from "./avis-eau.js";
import { autorisee } from "./autorisations.js";

/**
 * The mairies that relay EDF's notices through an open API, checked on 24/10/2026. `pdf`: the mairie puts EDF's
 * letters online as PDF files, listed by its media API; none is read, only the day their name gives.
 */
export const LISIBLES: { commune: string; site: string; pdf?: true }[] = [
  { commune: "Sainte-Marie", site: "https://www.ville-saintemarie.re" },
  { commune: "Saint-Philippe", site: "https://saintphilippe.re" },
  { commune: "Cilaos", site: "https://ville-cilaos.fr" },
  { commune: "Saint-André", site: "https://www.saint-andre.re", pdf: true },
  { commune: "Sainte-Suzanne", site: "https://ville-saintesuzanne.re" },
];

/**
 * The mairies read: not those whose site's terms ask their authorisation, until it is given
 * (src/providers/autorisations.ts, `courant:<commune>`). One left out is not read, and its notices, already kept, are
 * not said (tools/courant.ts).
 */
export const MAIRIES = LISIBLES.filter((m) => autorisee(`courant:${m.commune}`));

const names = MAIRIES.map((m) => m.commune);
const listed = names.length > 1 ? `${names.slice(0, -1).join(", ")} et ${names.at(-1)}` : names.join("");

export const SOURCE: SourceInfo = {
  id: "mairies_edf",
  nom: `Avis de coupure d'électricité d'EDF Réunion relayés par les mairies (${names.join(", ")})`,
  organisme: `EDF Réunion, avis relayés par ${names.length > 1 ? "les mairies" : "la mairie"} de ${listed}`,
  licence: "Information publique : seuls les faits (jours, heures, secteurs) sont repris, avec le lien de l'avis",
  attribution: `${names.length > 1 ? "Mairies" : "Mairie"} de ${listed}`,
  url: `${MAIRIES[0]?.site ?? LISIBLES[0].site}/`,
};

// The facts of each notice beside its title and link. False: the title, the date and the link only.
const WITH_FACTS = true;
const PER_COMMUNE = 5;
const SECTORS_MAX = 12;

/** One cut a notice announces: a day (or several, `au`), its hours when given, and the streets it names. */
export interface Creneau {
  /** « 2026-10-19 ». */
  jour: string;
  /** The last day, for works over several days. */
  au?: string;
  /** « 09:00 ». */
  de?: string;
  a?: string;
  secteurs: string[];
}

export interface AvisCourant {
  commune: string;
  titre: string;
  /** ISO, when the mairie published it. */
  publie: string;
  lien: string;
  /** « en cours » when the notice says the cut affects the streets now; « programmée » when it gives the days. */
  nature: "programmée" | "en cours" | "information";
  creneaux: Creneau[];
  /** The streets of a cut happening now, which has no day of its own. */
  secteurs: string[];
  /** EDF's letter as a PDF the mairie put online: its day, when its name gives one, and nothing else. */
  pdf?: true;
}

interface Post { date: string; title: { rendered: string }; link: string; content: { rendered: string } }
interface Media { date: string; source_url: string; mime_type: string }

// What a relayed notice of EDF's says in its title, and that it is about a cut, not a drone survey or a fallen pole.
const ABOUT = /coupure|courant|[ée]lectri|\bEDF\b/i;
const CUT = /coupure|coup[ée]e?s?\b|interruption|perturbation|r[ée]tabli/i;
const NOW = /affecte actuellement|depuis (?:hier|ce matin|cette nuit)|incident technique|coupure (?:est )?en cours/i;

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MONTH = "(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)";
const WEEKDAY = "(?:(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\\s+)?";
const RANGE = new RegExp(`\\bdu\\s+(\\d{1,2})(?:er)?(?:\\s+${MONTH})?\\s+au\\s+(\\d{1,2})(?:er)?\\s+${MONTH}(?:\\s+(\\d{4}))?`, "giu");
const DAY = new RegExp(`\\b${WEEKDAY}(\\d{1,2})(?:er)?\\s+${MONTH}(?:\\s+(\\d{4}))?`, "giu");
const HOURS = /(?:\bde|\bentre)\s+(\d{1,2})\s*h\s*(\d{2})?\s*(?:à|a|et|&)\s*(\d{1,2})\s*h\s*(\d{2})?/iu;
// A street, a lane, a district: what the notices list, one per line or between dashes.
const STREET = /^(?:rue|ruelle|chemin|impasse|route|allée|avenue|av\.|boulevard|bd|lotissement|lot\.|sentier|quai|place|cité|résidence|secteur|lieu-dit|îlet|ilet|ravine|rond-point|RN ?\d|route nationale)\b/iu;
const SMALL = new Set(["de", "des", "du", "la", "le", "les", "l", "d", "et", "à", "au", "aux", "en"]);

const monthOf = (m: string) => MONTHS.findIndex((x) => x.normalize("NFD").replace(/\p{M}/gu, "") === m.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")) + 1;
const two = (n: number | string) => String(n).padStart(2, "0");
const hhmm = (h: string, m?: string) => `${two(h)}:${m ?? "00"}`;

/** A day without its year is the publication's year, or the next one for a notice of December about January. */
function dayOf(d: string, month: string, year: string | undefined, published: Date): string {
  const mo = monthOf(month);
  let y = year ? Number(year) : published.getUTCFullYear();
  if (!year && Date.UTC(y, mo - 1, Number(d)) < published.getTime() - 60 * 86400_000) y += 1;
  return `${y}-${two(mo)}-${two(d)}`;
}

/** « rue DES GLYCINES » → « Rue des Glycines »: each word in capitals written as a name; the others left as they are. */
function tidy(s: string): string {
  const t = s.replace(/\(\s*en partie\s*\)/i, "").replace(/^[\s>–—-]+|[\s.,;:–—-]+$/g, "").replace(/\s+/g, " ");
  const words = t.split(" ").map((w, i) => {
    if (!/^[\p{Lu}\d'’-]{2,}$/u.test(w) || !/\p{Lu}/u.test(w)) return w;
    return i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase());
  });
  const out = words.join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** The streets a piece of a notice lists: its lines, or the pieces between its dashes, that name a street. */
function streets(text: string): string[] {
  const listed = text.split(/\n|\s[–—-]\s|;|,(?=\s*(?:rue|chemin|impasse|route|allée)\b)/iu).map((x) => x.replace(/^[\s>–—-]+/, "").trim());
  const named = listed.filter((x) => STREET.test(x) && x.length < 80).map(tidy);
  // « dans les secteurs de l'Îlet à Cordes et de Mare Sèche »
  const said = /secteurs? (?:de |du |des )([^.,\n]{3,60})/iu.exec(text)?.[1];
  const places = said && !named.length ? said.split(/\s+et\s+(?:de\s+|du\s+)?|,\s*/u).map((x) => tidy(x.replace(/^(?:de |du |des |l['’])/i, (m) => (m.toLowerCase().startsWith("l") ? m : "")))) : [];
  return [...new Set([...named, ...places])].filter((x) => x.length > 2);
}

/** The cuts a notice's text announces, in their order: each day (or days) with the hours and the streets after it. */
export function slotsOf(text: string, published: Date): Creneau[] {
  const marks: { at: number; end: number; jour: string; au?: string }[] = [];
  for (const m of text.matchAll(RANGE)) {
    marks.push({ at: m.index!, end: m.index! + m[0].length, jour: dayOf(m[1], m[2] ?? m[4], m[5], published), au: dayOf(m[3], m[4], m[5], published) });
  }
  for (const m of text.matchAll(DAY)) {
    if (marks.some((r) => m.index! >= r.at && m.index! < r.end)) continue;
    // Not a day of cut: the day a letter was registered, or a street (« rue Payet, du 24 septembre »).
    if (/(?:\bdu|enregistr[ée]e? le|publi[ée]e? le)\s+$/iu.test(text.slice(Math.max(0, m.index! - 20), m.index!))) continue;
    marks.push({ at: m.index!, end: m.index! + m[0].length, jour: dayOf(m[1], m[2], m[3], published) });
  }
  marks.sort((x, y) => x.at - y.at);
  const slots: Creneau[] = [];
  marks.forEach((mark, i) => {
    const piece = text.slice(mark.end, marks[i + 1]?.at ?? text.length);
    const h = HOURS.exec(piece);
    const [de, a] = h ? [hhmm(h[1], h[2]), hhmm(h[3], h[4])] : [];
    // The same cut said again (a day repeated without hours, or with the same hours) only adds its streets.
    const same = slots.find((s) => s.jour === mark.jour && s.au === mark.au && (!h || (s.de === de && s.a === a)));
    const secteurs = streets(piece);
    if (same) {
      same.secteurs = [...new Set([...same.secteurs, ...secteurs])].slice(0, SECTORS_MAX);
      return;
    }
    slots.push({ jour: mark.jour, au: mark.au, de, a, secteurs: secteurs.slice(0, SECTORS_MAX) });
  });
  // Sectors listed before the first day (« affecte les secteurs suivants », then the day) belong to it when it has none.
  if (slots.length && !slots[0].secteurs.length && marks.length) slots[0].secteurs = streets(text.slice(0, marks[0].at)).slice(0, SECTORS_MAX);
  return slots;
}

// The day in a PDF's name: « …-le-20-Juillet-2026.pdf », « edf21avril.pdf », « edf_16avril.pdf », « …-LE-20-08-2024-… », « …-24062024.pdf ».
const NAMED_DAY = new RegExp(`(?<!\\d)(\\d{1,2})(?:er)?[-_ ]?${MONTH}(?![a-z])(?:[-_ ]?(\\d{4}))?`, "iu");
const NUMBERED_DAY = /(?<!\d)(\d{2})[-_.]?(\d{2})[-_.]?(20\d{2})(?!\d)/;

/**
 * The day of cut a PDF's name gives, checked by hand on Saint-André's five named letters (24/10/2026): it is the
 * cut's, not the letter's. Without a year, the year of the upload folder (/uploads/2026/07/), or the next one when the
 * month named comes before the upload's.
 */
export function namedDay(url: string, uploaded: Date): string | undefined {
  const file = url.split("/").pop() ?? "";
  let name = file;
  try {
    name = decodeURIComponent(file);
  } catch {
    // A name badly encoded is read as it is.
  }
  name = name.replace(/\.pdf$/i, "");
  const folder = /\/uploads\/(\d{4})\/(\d{2})\//.exec(url);
  const [upYear, upMonth] = folder ? [Number(folder[1]), Number(folder[2])] : [uploaded.getUTCFullYear(), uploaded.getUTCMonth() + 1];
  const n = NUMBERED_DAY.exec(name);
  if (n && Number(n[1]) >= 1 && Number(n[1]) <= 31 && Number(n[2]) >= 1 && Number(n[2]) <= 12) return `${n[3]}-${n[2]}-${n[1]}`;
  const m = NAMED_DAY.exec(name);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 31) return undefined;
  const mo = monthOf(m[2]);
  const y = m[3] ? Number(m[3]) : mo < upMonth ? upYear + 1 : upYear;
  return `${y}-${two(mo)}-${two(m[1])}`;
}

/** A mairie's PDF letters of EDF, newest first: the day of cut when the name gives it, else the upload only. */
export function parseMedia(media: Media[], commune: string): AvisCourant[] {
  return media
    .filter((m) => m.mime_type === "application/pdf")
    .map((m) => {
      // WordPress gives the local time without its offset.
      const publie = new Date(`${m.date}+04:00`);
      const jour = WITH_FACTS ? namedDay(m.source_url, publie) : undefined;
      return {
        commune,
        titre: "Avis de coupure d'EDF (PDF)",
        publie: publie.toISOString(),
        lien: m.source_url,
        nature: jour ? "programmée" : "information",
        creneaux: jour ? [{ jour, secteurs: [] }] : [],
        secteurs: [],
        pdf: true,
      } satisfies AvisCourant;
    });
}

/** The notices of power cuts among a mairie's posts, newest first, with their facts. */
export function parsePosts(posts: Post[], commune: string): AvisCourant[] {
  return posts
    .map((p) => ({ p, titre: strip(p.title.rendered).trim(), texte: strip(p.content.rendered.replace(/\[\/?et_pb_[^\]]*\]/g, "")).replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n") }))
    .filter(({ titre, texte }) => ABOUT.test(titre) && /[ée]lectri|courant|\bEDF\b/i.test(`${titre} ${texte}`) && CUT.test(`${titre} ${texte}`))
    .map(({ p, titre, texte }) => {
      // WordPress gives the local time without its offset.
      const publie = new Date(`${p.date}+04:00`);
      const creneaux = WITH_FACTS ? slotsOf(texte, publie) : [];
      const now = NOW.test(texte);
      return {
        commune,
        titre,
        publie: publie.toISOString(),
        lien: p.link,
        nature: now && !creneaux.some((c) => c.de) ? "en cours" : creneaux.length ? "programmée" : "information",
        creneaux,
        secteurs: WITH_FACTS && now && !creneaux.length ? streets(texte).slice(0, SECTORS_MAX) : [],
      } satisfies AvisCourant;
    })
    .sort((x, y) => y.publie.localeCompare(x.publie))
    .slice(0, PER_COMMUNE);
}

/**
 * Every mairie's notices, each mairie once; one that does not answer is named in `indisponibles`, even when all fail:
 * the copy that holds them (web:courant, tools/courant.ts) then keeps its notices read before, or says its read failed.
 */
export async function coupures(): Promise<{ avis: AvisCourant[]; lues: string[]; indisponibles: string[] }> {
  const parts = await Promise.allSettled(
    MAIRIES.map(async (m) => {
      // A mairie of PDF letters is read in full or not at all: half of it would hide a cut.
      const [posts, media] = await Promise.all([
        getJson<Post[]>(SOURCE.id, `${m.site}/wp-json/wp/v2/posts?search=%C3%A9lectri&per_page=10&_fields=date,title,link,content`, 12_000),
        m.pdf ? getJson<Media[]>(SOURCE.id, `${m.site}/wp-json/wp/v2/media?search=edf&mime_type=application/pdf&per_page=10&_fields=date,source_url,mime_type`, 12_000) : [],
      ]);
      return [...parsePosts(posts, m.commune), ...parseMedia(media, m.commune)].sort((x, y) => y.publie.localeCompare(x.publie)).slice(0, PER_COMMUNE);
    }),
  );
  parts.forEach((p, i) => p.status === "rejected" && console.error(`source ${SOURCE.id} indisponible (${MAIRIES[i].commune}):`, why(p.reason)));
  return {
    avis: parts.flatMap((p) => (p.status === "fulfilled" ? p.value : [])),
    lues: MAIRIES.filter((_, i) => parts[i].status === "fulfilled").map((m) => m.commune),
    indisponibles: MAIRIES.filter((_, i) => parts[i].status === "rejected").map((m) => m.commune),
  };
}
