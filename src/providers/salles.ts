/**
 * The programmes of the island's concert halls and theatres, read from their own sites: none publishes a feed, so
 * each page is read as its visitors see it, one request each (two for the TÉAT and the Cité des Arts).
 * - TÉAT Champ Fleuri (Saint-Denis) and TÉAT Plein Air (Saint-Gilles), the Département's theatres: the programme
 *   filtered by venue, with the days of each show (the hours are on its page); a show on both stages is listed by both
 *   with all its days, so its own page (or its page at the theatres' ticket office) tells which day is where;
 * - Cité des Arts (Saint-Denis: Palaxa, Fanal, Banyan, Château Morange): its programme, first two pages;
 * - Kabardock (Le Port): the « Agenda » of its home page;
 * - Bisik (Saint-Benoît, and the halls of the East where it plays): its agenda, with the hours;
 * - Théâtre Luc Donat (Le Tampon), CDNOI (Saint-Denis), Léspas (Saint-Paul): their season, with the hours.
 * The TÉAT, Luc Donat and the CDNOI pages are in ISO-8859-1.
 */
import { getBytes, getText, permis, postBytes } from "../http.js";
import { normalize } from "../places/resolve.js";
import type { SourceInfo } from "../types.js";
import type { Agenda, AgendaStore, Evenement, Seance } from "./agenda.js";
import { extrait, monthOf, statusOf } from "./agenda-mots.js";
import { communesIn } from "./avis-eau.js";

/** Its name, credit and link are those of the halls read, once their authorisations are known (providers/agenda.ts). */
export const SOURCE: SourceInfo = {
  id: "salles_spectacle",
  nom: "Programmes des salles : TÉAT Champ Fleuri et Plein Air, Cité des Arts, Kabardock, Le Séchoir, Bisik, Théâtre Luc Donat, CDNOI, Léspas",
  organisme: "Salles de spectacle et de concert de La Réunion",
  licence: "Information publique (programmes publiés par les salles)",
  attribution: "TÉAT La Réunion, Cité des Arts, Kabardock, Le Séchoir, Bisik, Théâtre Luc Donat, CDNOI, Léspas",
  url: "https://www.teat.re/programmation/",
};

const HEADERS = { "User-Agent": "rundata.re (contact@rundata.re)" };
// A season is published months ahead and changes little: a few hours is plenty.
const FRESH_SECONDS = 6 * 3600;
// A hall's site that takes longer is left out of this answer (its last copy is served when there is one): the
// question should not wait for the slowest of nineteen sites.
export const TIMEOUT_MS = 6_000;

// ---------------------------------------------------------------- reading a page

/** A text of the page, or the address of a link (`href`). */
export type Token = { t: string; href?: undefined } | { href: string; t?: undefined };

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", nbsp: " ", lt: "<", gt: ">", rsquo: "’", lsquo: "‘", hellip: "…", ndash: "–", mdash: "—", laquo: "«", raquo: "»", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ecirc: "ê", ocirc: "ô", icirc: "î", ucirc: "û", acirc: "â", Eacute: "É" };
const unescape = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m);

/**
 * The page as the sequence of its texts and links, in reading order: what a visitor sees, whatever the markup around.
 * The tags are skipped character by character, scripts and styles whole.
 */
export function tokens(html: string): Token[] {
  const out: Token[] = [];
  const text = (s: string) => {
    const t = unescape(s).replace(/\s+/g, " ").trim();
    if (t) out.push({ t });
  };
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf("<", i);
    if (open < 0) {
      text(html.slice(i));
      break;
    }
    text(html.slice(i, open));
    const end = html.indexOf(">", open);
    if (end < 0) break;
    const tag = html.slice(open + 1, end);
    const name = /^\/?([a-z0-9]+)/i.exec(tag)?.[1].toLowerCase();
    if ((name === "script" || name === "style") && tag[0] !== "/") {
      const close = new RegExp(`</${name}\\s*>`, "ig");
      close.lastIndex = end;
      i = close.exec(html) ? close.lastIndex : html.length;
      continue;
    }
    if (name === "a" && tag[0] !== "/") {
      const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
      if (href) out.push({ href: unescape(href) });
    }
    i = end + 1;
  }
  return out;
}

/** Windows-1252, the encoding behind the pages that say ISO-8859-1. */
const CP1252: Record<number, string> = { 0x80: "€", 0x82: "‚", 0x84: "„", 0x85: "…", 0x8c: "Œ", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—", 0x99: "™", 0x9c: "œ" };
let decoder: TextDecoder | null | undefined;
export function latin1(buf: ArrayBuffer): string {
  if (decoder === undefined) {
    try {
      decoder = new TextDecoder("windows-1252");
    } catch {
      decoder = null;
    }
  }
  if (decoder) return decoder.decode(buf);
  // A runtime without the legacy encodings: byte by byte.
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out.replace(/[\x80-\x9f]/g, (c) => CP1252[c.charCodeAt(0)] ?? c);
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const localDay = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
/** A day given without its year: the next one from `today`, a show of the last two months included. */
export function dayOf(day: number, month: number, today: string): string {
  const y = Number(today.slice(0, 4));
  const before = new Date(Date.parse(`${today}T00:00:00Z`) - 60 * 86400_000).toISOString().slice(0, 10);
  return iso(iso(y, month, day) < before ? y + 1 : y, month, day);
}
const hm = (h: string, m?: string) => `${h.padStart(2, "0")}:${m ?? "00"}`;
/** A link of a venue's page as an absolute http(s) address; undefined for anything else (`javascript:`, `data:`, `mailto:`). */
const abs = (base: string, href: string): string | undefined => {
  try {
    const u = new URL(href, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};
const DAYS = /^(?:lun|mar|mer|jeu|ven|sam|dim)\w*\.?$/i;

function event(e: Omit<Evenement, "categories" | "publie_par"> & Partial<Pick<Evenement, "categories">>, nom: string): Evenement {
  const statut = e.statut ?? statusOf(e.titre, e.description);
  return { categories: [], ...e, ...(statut ? { statut } : {}), publie_par: nom };
}

// ---------------------------------------------------------------- TÉAT

// A show's page: on teat.re, or at the theatres' ticket office (See Tickets, formerly Digitick), as its programme links.
export const TEAT_HOSTS = ["www.teat.re", "billetterie.seetickets.fr", "web.digitick.com"];

const TEAT_GENRES = /^(?:Musique|Théâtre|Danse|Cirque|Humour|Jeune public|Spectacle|Conte|Opéra|Comédie musicale|Magie|Lecture|Exposition)$/i;
export const TEAT_VENUES = [
  { lieu: "TÉAT Champ Fleuri", commune: "Saint-Denis", form: "lieux%5B%5D=T%C9AT+Champ+Fleuri&search_event=" },
  { lieu: "TÉAT Plein Air", commune: "Saint-Paul", form: "lieux%5B%5D=T%C9AT+Plein+Air&search_event=" },
];

/** The programme of one TÉAT: « 22 oct 23 oct Musique [link] CALOGERO », the days without their year nor hours. */
export function parseTeat(html: string, venue: (typeof TEAT_VENUES)[number], now: Date): Evenement[] {
  // From the list itself: the menus and the search form above it are a third of the page.
  const t = tokens(html.slice(Math.max(0, html.indexOf("prog-list"))));
  const today = localDay(now);
  const out: Evenement[] = [];
  let days: string[] = [];
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    const month = x.t && i > 0 && /^\d{1,2}$/.test(t[i - 1].t ?? "") ? monthOf(x.t.toLowerCase().replace(/\.$/, "")) : undefined;
    if (month) {
      days.push(dayOf(Number(t[i - 1].t), month, today));
      continue;
    }
    if (x.t && TEAT_GENRES.test(x.t) && t[i + 1]?.href && t[i + 2]?.t && days.length) {
      const lien = abs("https://www.teat.re/", t[i + 1].href!);
      if (lien) out.push(event({
        id: `teat:${lien}`,
        titre: t[i + 2].t!.trim(),
        seances: days.map((debut) => ({ debut })),
        lieu: venue.lieu,
        commune: venue.commune,
        categories: [x.t],
        lien,
      }, "TÉAT La Réunion"));
      days = [];
    }
  }
  return out;
}

/** Which stage each performance is on: day → venue and hour, as a show's page says it. */
export type TeatDates = Map<string, { venue: (typeof TEAT_VENUES)[number]; hour?: string }>;

/**
 * The performances of a show from its page: « 28 octobre 2026 | 20h00 | TÉAT Champ Fleuri » on teat.re,
 * « Représentation du 27 octobre - TEAT Champ Fleuri » at the ticket office.
 */
export function parseTeatDates(html: string, now: Date): TeatDates {
  // teat.re's page: from its « Les dates » on.
  const t = tokens(html.slice(Math.max(0, html.indexOf("Les dates")))).filter((x) => x.t).map((x) => x.t!);
  const today = localDay(now);
  const out: TeatDates = new Map();
  for (let i = 0; i < t.length; i++) {
    const v = /T[ÉE]AT\s+(Champ\s+Fleuri|Plein\s+Air)\s*$/i.exec(t[i]);
    if (!v) continue;
    const venue = TEAT_VENUES.find((x) => normalize(x.lieu).endsWith(normalize(v[1])))!;
    // The day and the hour: in the same text, or in the two before.
    const near = t.slice(Math.max(0, i - 2), i + 1).join(" | ");
    const d = [...near.matchAll(/(\d{1,2})(?:er)?\s+(\p{L}+)(?:\s+(20\d\d))?/gu)].map((m) => ({ m, month: monthOf(m[2].toLowerCase()) })).filter((x) => x.month).pop();
    if (!d) continue;
    const day = d.m[3] ? iso(Number(d.m[3]), d.month!, Number(d.m[1])) : dayOf(Number(d.m[1]), d.month!, today);
    const h = /(\d{1,2})h(\d\d)/.exec(near.slice(d.m.index));
    out.set(day, { venue, ...(h ? { hour: hm(h[1], h[2]) } : {}) });
  }
  return out;
}

/**
 * The two theatres' programmes. A show listed by both: split by stage when its page says which day is where
 * (`dates`, by link), else told once with both stages.
 */
export function mergeTeat(lists: Evenement[][], dates: Map<string, TeatDates> = new Map()): Evenement[] {
  const byLink = new Map<string, Evenement[]>();
  for (const e of lists.flat()) byLink.set(e.lien, [...(byLink.get(e.lien) ?? []), e]);
  return [...byLink.values()].flatMap((same) => {
    const [e] = same;
    if (same.every((x) => x.lieu === e.lieu)) return [e];
    const where = dates.get(e.lien);
    if (where?.size) {
      return TEAT_VENUES.flatMap((v): Evenement[] => {
        const seances = e.seances.filter((s) => where.get(s.debut)?.venue === v).map((s) => ({ debut: `${s.debut}${where.get(s.debut)?.hour ? `T${where.get(s.debut)!.hour}` : ""}` }));
        return seances.length ? [{ ...e, id: `${e.id}|${v.lieu}`, seances, lieu: v.lieu, commune: v.commune }] : [];
      });
    }
    return [{ ...e, lieu: `${TEAT_VENUES[0].lieu} (${TEAT_VENUES[0].commune}) ou ${TEAT_VENUES[1].lieu} (${TEAT_VENUES[1].commune})`, commune: undefined }];
  });
}

// The pages of the shows on both stages read at most, the soonest first: each is one more request.
const TEAT_PAGES = 4;
const TEAT_AHEAD_DAYS = 45;

/** A page in ISO-8859-1 or UTF-8, whichever it is. */
function decode(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return latin1(buf);
  }
}

const teat: Agenda = {
  id: "teat",
  nom: "TÉAT Champ Fleuri et Plein Air",
  couvre: ["Saint-Denis", "Saint-Paul"],
  source: SOURCE,
  // Both stages' programmes, then the pages of the shows on both.
  requetes: 2 + TEAT_PAGES,
  load: (cache: AgendaStore, now: Date) =>
    cache.get("agenda:teat", FRESH_SECONDS, async () => {
      const lists = await Promise.all(TEAT_VENUES.map(async (v) =>
        parseTeat(latin1(await postBytes(SOURCE.id, "https://www.teat.re/programmation/", v.form, TIMEOUT_MS, HEADERS)), v, now)));
      const soon = new Date(now.getTime() + TEAT_AHEAD_DAYS * 86400_000).toISOString().slice(0, 10);
      const both = lists[0].filter((e) => lists[1].some((x) => x.lien === e.lien) && e.seances[0].debut <= soon)
        .sort((x, y) => x.seances[0].debut.localeCompare(y.seances[0].debut)).slice(0, TEAT_PAGES);
      const dates = new Map<string, TeatDates>();
      await Promise.all(both.map(async (e) => {
        try {
          // Only those pages: a link planted in its programme is never read.
          if (!permis(SOURCE.id, e.lien, TEAT_HOSTS)) return;
          dates.set(e.lien, parseTeatDates(decode(await getBytes(SOURCE.id, e.lien, TIMEOUT_MS, HEADERS)), now));
        } catch {
          // Without its page, the show is told with both stages.
        }
      }));
      return mergeTeat(lists, dates);
    }),
};

// ---------------------------------------------------------------- Cité des Arts

const CDA_VENUES = ["Palaxa", "Fanal", "Banyan", "Boîte Noire", "Espaces de création", "Espaces extérieurs", "La boutique culturelle", "Salle polyvalente"];

/**
 * « [link] Olivier Ker Ourio | Concert de jazz // | le | 24 octobre | 2026 | Tout public | Fanal »: a line ending in
 * « // » gives the genre, the title before it; « Du … au … » a season.
 */
export function parseCiteDesArts(html: string): Evenement[] {
  const t = tokens(html);
  const out: Evenement[] = [];
  for (let i = 1; i < t.length; i++) {
    const g = t[i].t;
    if (!g?.endsWith("//")) continue;
    if (/^(Actualités|Programme)\b/.test(g)) {
      if (g.startsWith("Actualités")) break;
      continue;
    }
    const titre = t[i - 1].t;
    const link = [t[i - 2], t[i - 3]].find((x) => x?.href)?.href;
    if (!titre || !link) continue;
    // The date: « le | 24 octobre | 2026 » or « Du | 30 octobre | au | 1er novembre | 2026 ».
    const words: string[] = [];
    let j = i + 1;
    for (; j < t.length && j < i + 9 && !t[j].href; j++) words.push(t[j].t!);
    const text = words.join(" ");
    const m = /(?:le|du)\s+(\d{1,2})(?:er)?\s+(\p{L}+)(?:\s+(20\d\d))?(?:\s+au\s+(\d{1,2})(?:er)?\s+(\p{L}+))?\s+(20\d\d)/iu.exec(text);
    if (!m) continue;
    const y2 = Number(m[6]);
    const m1 = monthOf(m[2].toLowerCase());
    const m2 = m[5] ? monthOf(m[5].toLowerCase()) : undefined;
    if (!m1) continue;
    let y1 = m[3] ? Number(m[3]) : m2 && m1 > m2 ? y2 - 1 : y2;
    let fin = m2 ? iso(y2, m2, Number(m[4])) : undefined;
    // « Du 10 novembre au 24 octobre 2026 » is on the site: a span of most of a year is a typo, its end left out.
    if (fin && Date.parse(fin) - Date.parse(iso(y1, m1, Number(m[1]))) > 300 * 86400_000) {
      fin = undefined;
      y1 = y2;
    }
    const debut = iso(y1, m1, Number(m[1]));
    const venue = CDA_VENUES.find((v) => words.includes(v));
    const genre = g.replace(/\s*\/\/$/, "").trim();
    const where = /^À (.+)$/.exec(genre)?.[1];
    const lien = abs("https://www.citedesarts.re/", link);
    if (!lien) continue;
    out.push(event({
      id: `citedesarts:${link}`,
      titre,
      seances: [{ debut, ...(fin ? { fin } : {}) }],
      lieu: `Cité des Arts${venue ? `, ${venue}` : where ? `, ${where}` : ""}`.replace("Cité des Arts, Château Morange", "Château Morange"),
      commune: "Saint-Denis",
      categories: where ? [] : [genre.replace(/\s*\[COMPLET\]/i, "")],
      prix: words.includes("Gratuit") ? "Gratuit" : undefined,
      statut: /\[COMPLET\]/i.test(genre) ? "complet" : undefined,
      lien,
    }, "Cité des Arts"));
  }
  return out;
}

const citeDesArts: Agenda = {
  id: "cite_des_arts",
  nom: "Cité des Arts",
  source: SOURCE,
  commune: "Saint-Denis",
  requetes: 2,
  load: (cache) =>
    cache.get("agenda:cite_des_arts", FRESH_SECONDS, async () => {
      const pages = await Promise.all(["", "?debut_programmation=6"].map((q) => getText(SOURCE.id, `https://www.citedesarts.re/Programmation${q}`, TIMEOUT_MS, HEADERS)));
      return pages.flatMap(parseCiteDesArts);
    }),
};

// ---------------------------------------------------------------- Kabardock

/**
 * The home page's « Agenda »: each show a block linked to its page, « 23 Oct | Teddy Baptiste 4Tet | feat … | Jazz /
 * La Réunion, France ». The hours are only on the shows at the top of the page (« Vendredi 23 octobre - 20h »).
 */
export function parseKabardock(html: string, now: Date): Evenement[] {
  const today = localDay(now);
  const blocks = html.split(/data-url="/).slice(1);
  // The slider at the top: « [link] TEDDY BAPTISTE 4TET … | Jazz / La Réunion, France | Vendredi 23 octobre - 20h ».
  const hours = new Map<string, string>();
  const slider = html.indexOf("swiper-slide");
  const top = tokens(html.slice(Math.max(0, slider), html.indexOf('data-url="')));
  top.forEach((x, i) => {
    if (!x.href?.includes("/spectacle/")) return;
    const at = top.slice(i + 1, i + 5).map((y) => y.t && /\d{1,2}\s+\p{L}+\s*[-–]\s*(\d{1,2})h(\d\d)?/u.exec(y.t)).find(Boolean);
    if (at) hours.set(x.href, hm(at[1], at[2]));
  });
  const out = new Map<string, Evenement>();
  for (const block of blocks) {
    const url = block.slice(0, block.indexOf('"'));
    if (!url.includes("/spectacle/")) continue;
    const t = tokens(block.slice(block.indexOf(">") + 1)).filter((x) => x.t).map((x) => x.t!);
    const d = /^(\d{1,2})\s+(\p{L}{3,9})\.?$/u.exec(t[0] ?? "");
    const month = d && monthOf(d[2].toLowerCase());
    if (!d || !month) continue;
    const rest = t.slice(1);
    const free = rest.some((x) => /^gratuit$/i.test(x));
    const complet = rest.some((x) => /^complet$/i.test(x));
    const words = rest.filter((x) => !/^(gratuit|complet|\+ d'infos)$/i.test(x));
    const genre = words.find((x) => x.includes(" / "));
    const [titre, ...more] = words.filter((x) => x !== genre);
    if (!titre) continue;
    const debut = dayOf(Number(d[1]), month, today);
    out.set(`${url}|${debut}`, event({
      id: `kabardock:${url}|${debut}`,
      titre,
      seances: [{ debut }],
      lieu: "Kabardock",
      commune: "Le Port",
      categories: genre ? [genre.split(" / ")[0]] : [],
      description: more.length ? more.join(" · ") : undefined,
      prix: free ? "Gratuit" : undefined,
      statut: complet ? "complet" : undefined,
      lien: url,
    }, "Kabardock"));
  }
  return [...out.values()].map((e) => {
    const h = hours.get(e.lien);
    return h ? { ...e, seances: e.seances.map((s) => ({ debut: `${s.debut}T${h}` })) } : e;
  });
}

const kabardock: Agenda = {
  id: "kabardock",
  nom: "Kabardock",
  source: SOURCE,
  commune: "Le Port",
  load: (cache, now) => cache.get("agenda:kabardock", FRESH_SECONDS, async () => parseKabardock(await getText(SOURCE.id, "https://kabardock.com/", TIMEOUT_MS, HEADERS), now)),
};

// ---------------------------------------------------------------- Bisik

const BISIK_HALLS: [RegExp, string][] = [[/gramoun l[ée]l[ée]|roussin|saint-beno[iî]t/i, "Saint-Benoît"], [/guy ag[ée]nor|plaine des palmistes/i, "La Plaine-des-Palmistes"]];

/** « Oct | 31 | sam | 2026 | Title | @ Salle Gramoun Lélé | … | Oct 31 @ 19 h 00 min – 23 h 30 min | [link] ». */
export function parseBisik(html: string): Evenement[] {
  const t = tokens(html);
  const out: Evenement[] = [];
  for (let i = 0; i + 4 < t.length; i++) {
    const month = t[i].t && /^\d{1,2}$/.test(t[i + 1].t ?? "") && DAYS.test(t[i + 2].t ?? "") && /^20\d\d$/.test(t[i + 3].t ?? "") ? monthOf(t[i].t!.toLowerCase()) : undefined;
    if (!month) continue;
    const day = iso(Number(t[i + 3].t), month, Number(t[i + 1].t));
    const titre = t[i + 4].t;
    if (!titre) continue;
    let j = i + 5;
    let lieu: string | undefined;
    let debut = day;
    let fin: string | undefined;
    let lien: string | undefined;
    let billets: string | undefined;
    const text: string[] = [];
    const categories: string[] = [];
    for (; j < t.length && j < i + 200; j++) {
      const x = t[j];
      if (x.href) {
        if (!lien && /\/(?:é|%C3%A9)v(?:è|%C3%A8)nement\//i.test(x.href)) lien = x.href;
        if (/cat_ids~/.test(x.href) && t[j + 1]?.t) categories.push(t[j + 1].t!);
        if (/action~oneday/.test(x.href)) break;
        continue;
      }
      const s = x.t ?? "";
      if (!lieu && s.startsWith("@ ")) lieu = s.slice(2).trim();
      const h = /@\s*(\d{1,2})\s*h\s*(\d\d)\s*min(?:\s*[–-]\s*(\d{1,2})\s*h\s*(\d\d)\s*min)?/.exec(s);
      if (h && debut === day) {
        debut = `${day}T${hm(h[1], h[2])}`;
        if (h[3]) fin = `${day}T${hm(h[3], h[4])}`;
      }
      if (/^https?:\/\//.test(s)) billets ??= s;
      else if (!s.startsWith("@ ") && !h && s !== "Billets" && s !== "Lire la suite") text.push(s);
    }
    const desc = text.filter((x) => x.length > 2 && !/^Catégories/.test(x)).join(" ");
    const hall = (x: string) => BISIK_HALLS.find(([re]) => re.test(x))?.[1];
    out.push(event({
      id: `bisik:${lien ?? titre}|${day}`,
      titre,
      seances: [{ debut, ...(fin ? { fin } : {}) }],
      lieu,
      commune: hall(lieu ?? "") ?? hall(desc) ?? communesIn(desc)[0] ?? "Saint-Benoît",
      categories: [...new Set(categories.filter((c) => c !== "Événement"))],
      prix: /Tarif[^€]{0,60}€(?:\s*\/[^€]{0,30}€)?/.exec(desc)?.[0].trim(),
      ...extrait(desc),
      billetterie: billets,
      lien: lien ?? "https://bisik.re/agenda/",
    }, "Bisik"));
    i = j - 1;
  }
  return out;
}

const bisik: Agenda = {
  id: "bisik",
  nom: "Bisik",
  source: SOURCE,
  commune: "Saint-Benoît",
  load: (cache) => cache.get("agenda:bisik", FRESH_SECONDS, async () => parseBisik(await getText(SOURCE.id, "https://bisik.re/agenda/", TIMEOUT_MS, HEADERS))),
};

// ---------------------------------------------------------------- Théâtre Luc Donat

/**
 * « sam. 24 oct. à 20H00 | [Médiathèque Centre-ville |] Mariaz Tangaz | Plus d'informations | [link] | … Scolaire »:
 * one line per performance; the school ones are left out. Only what its agreement covers: title, day, hour, hall and the
 * link to its page (the genre is on its season's page, `parseLucDonatGenres`).
 */
export function parseLucDonat(html: string, now: Date): Evenement[] {
  const t = tokens(html);
  const today = localDay(now);
  const shows = new Map<string, Evenement>();
  for (let i = 0; i < t.length; i++) {
    const m = /^(?:lun|mar|mer|jeu|ven|sam|dim)\.\s+(\d{1,2})\s+(\p{L}+)\.?\s+à\s+(\d{1,2})H(\d\d)$/iu.exec(t[i].t ?? "");
    const month = m && monthOf(m[2].toLowerCase());
    if (!m || !month) continue;
    const words: string[] = [];
    let j = i + 1;
    for (; j < t.length && t[j].t !== "Plus d'informations" && words.length < 4; j++) if (t[j].t) words.push(t[j].t!);
    const link = t[j + 1]?.href;
    if (!link || !words.length) continue;
    // What follows the performance, up to the next one: « Scolaire » for a school one.
    let scolaire = false;
    for (let k = j + 2; k < t.length && k < j + 6 && !/^(?:lun|mar|mer|jeu|ven|sam|dim)\./i.test(t[k].t ?? ""); k++) if (t[k].t === "Scolaire") scolaire = true;
    if (scolaire) continue;
    const titre = words[words.length - 1];
    const lieu = words.length > 1 ? words[0] : "Théâtre Luc Donat";
    const lien = abs("https://www.theatrelucdonat.re/", link);
    if (!lien) continue;
    const seance: Seance = { debut: `${dayOf(Number(m[1]), month, today)}T${hm(m[3], m[4])}` };
    const same = shows.get(lien);
    if (same) same.seances.push(seance);
    else shows.set(lien, event({ id: `lucdonat:${lien}`, titre, seances: [seance], lieu, commune: "Le Tampon", lien }, "Théâtre Luc Donat"));
  }
  return [...shows.values()];
}

/** Its season's page: each show's genre (« Musique », « Théâtre & Humour »), by the link to its page. */
export function parseLucDonatGenres(html: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const block of html.split('class="spectacle').slice(1)) {
    const href = /href=\s*"([^"]+)"/.exec(block)?.[1];
    const type = /class="type">([^<]*)</.exec(block)?.[1];
    const lien = href && abs("https://www.theatrelucdonat.re/", unescape(href));
    if (lien && type) out.set(lien, unescape(type).split(/\s*[&,]\s*/).map((g) => g.trim()).filter(Boolean));
  }
  return out;
}

const lucDonat: Agenda = {
  id: "luc_donat",
  nom: "Théâtre Luc Donat",
  source: SOURCE,
  commune: "Le Tampon",
  // Its written agreement of 27/10/2026 (providers/autorisations.ts): each date with « Source : Théâtre Luc Donat ».
  credit: "Théâtre Luc Donat",
  faits: true,
  // Its agenda, then its season's page for the genres.
  requetes: 2,
  load: (cache, now) =>
    cache.get("agenda:luc_donat", FRESH_SECONDS, async () => {
      const [agenda, saison] = await Promise.allSettled([
        getBytes(SOURCE.id, "https://www.theatrelucdonat.re/tld_agenda", TIMEOUT_MS, HEADERS),
        getBytes(SOURCE.id, "https://www.theatrelucdonat.re/prog", TIMEOUT_MS, HEADERS),
      ]);
      if (agenda.status === "rejected") throw agenda.reason;
      // Without its season's page, the dates are told without their genre.
      const genres = saison.status === "fulfilled" ? parseLucDonatGenres(latin1(saison.value)) : new Map<string, string[]>();
      return parseLucDonat(latin1(agenda.value), now).map((e) => ({ ...e, categories: genres.get(e.lien) ?? e.categories }));
    }),
};

// ---------------------------------------------------------------- CDNOI

/** « [link] Na pwin pèrsone ? | Création CDNOI | | Théâtre | Représentations : | 29 Octobre 09h00, 29 Octobre 19h30 ». */
export function parseCdnoi(html: string, now: Date): Evenement[] {
  const t = tokens(html);
  const today = localDay(now);
  const out: Evenement[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i].t !== "Représentations :" || !t[i + 1]?.t) continue;
    // Back to the title: the text right after the second link to the show.
    let j = i - 1;
    while (j > 0 && !t[j].href) j--;
    const link = t[j]?.href;
    const before = t.slice(j + 1, i).filter((x) => x.t).map((x) => x.t!.replace(/\s*\|$/, ""));
    const [titre, ...rest] = before;
    if (!link || !titre) continue;
    const genre = rest.length > 1 ? rest[rest.length - 1] : rest[0];
    const seances = [...t[i + 1].t!.matchAll(/(\d{1,2})\s+(\p{L}+)\s+(\d{1,2})h(\d\d)/gu)]
      .map((m) => ({ month: monthOf(m[2].toLowerCase()), m }))
      .filter((x) => x.month)
      .map(({ month, m }) => ({ debut: `${dayOf(Number(m[1]), month!, today)}T${hm(m[3], m[4])}` }))
      // A weekday morning is a school performance (« 29 Octobre 09h00 »), not open to the public.
      .filter((x) => !(Number(x.debut.slice(11, 13)) < 11 && ![0, 6].includes(new Date(`${x.debut.slice(0, 10)}T12:00:00Z`).getUTCDay())));
    if (!seances.length) continue;
    const lien = abs("https://www.cdnoi.re/", link);
    if (!lien) continue;
    out.push(event({
      id: `cdnoi:${lien}`,
      titre,
      seances,
      lieu: "CDNOI, Théâtre du Grand Marché",
      commune: "Saint-Denis",
      categories: genre ? [genre] : [],
      description: rest.length > 1 ? rest[0] : undefined,
      lien,
    }, "CDNOI"));
  }
  return out;
}

const cdnoi: Agenda = {
  id: "cdnoi",
  nom: "CDNOI",
  source: SOURCE,
  commune: "Saint-Denis",
  load: (cache, now) => cache.get("agenda:cdnoi", FRESH_SECONDS, async () => parseCdnoi(latin1(await getBytes(SOURCE.id, "https://www.cdnoi.re/programmation/", TIMEOUT_MS, HEADERS)), now)),
};

// ---------------------------------------------------------------- Léspas

/** « [link] | Complet | Découvrir | → | Théâtre | Dovan la boutik | Vendredi 30 octobre · 20h00 | Cie Dan' Fenwar ». */
export function parseLespas(html: string, now: Date): Evenement[] {
  const t = tokens(html);
  const today = localDay(now);
  const out: Evenement[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i].t !== "Découvrir" || t[i + 1]?.t !== "→") continue;
    let j = i - 1;
    let complet = false;
    for (; j >= 0 && !t[j].href; j--) if (t[j].t === "Complet") complet = true;
    const link = t[j]?.href;
    const [genre, titre, date, by] = t.slice(i + 2, i + 6).map((x) => x.t);
    if (!link || !titre || !date) continue;
    let seances: Seance[] = [];
    const one = /(\d{1,2})(?:er)?\s+(\p{L}+)(?:\s+(20\d\d))?\s*·\s*(\d{1,2})h(\d\d)/u.exec(date);
    const span = /Du\s+(\d{1,2})(?:er)?(?:\s+(\p{L}+))?(?:\s+(20\d\d))?\s+au\s+(\d{1,2})(?:er)?\s+(\p{L}+)\s+(20\d\d)/u.exec(date);
    if (one && monthOf(one[2].toLowerCase())) {
      const month = monthOf(one[2].toLowerCase())!;
      const day = one[3] ? iso(Number(one[3]), month, Number(one[1])) : dayOf(Number(one[1]), month, today);
      seances = [{ debut: `${day}T${hm(one[4], one[5])}` }];
    } else if (span && monthOf(span[5].toLowerCase())) {
      const m2 = monthOf(span[5].toLowerCase())!;
      const m1 = span[2] ? monthOf(span[2].toLowerCase()) ?? m2 : m2;
      const y2 = Number(span[6]);
      const y1 = span[3] ? Number(span[3]) : m1 > m2 ? y2 - 1 : y2;
      seances = [{ debut: iso(y1, m1, Number(span[1])), fin: iso(y2, m2, Number(span[4])) }];
    }
    if (!seances.length) continue;
    out.push(event({
      id: `lespas:${link}`,
      titre,
      seances,
      lieu: "Léspas culturel Leconte de Lisle",
      commune: "Saint-Paul",
      categories: genre ? [genre] : [],
      description: by && !/^(Découvrir|Complet)$/.test(by) && !by.startsWith("http") ? by : undefined,
      statut: complet ? "complet" : undefined,
      lien: link,
    }, "Léspas"));
  }
  return out;
}

const lespas: Agenda = {
  id: "lespas",
  nom: "Léspas",
  source: SOURCE,
  commune: "Saint-Paul",
  load: (cache, now) => cache.get("agenda:lespas", FRESH_SECONDS, async () => parseLespas(await getText(SOURCE.id, "https://lespas.re/category/la-saison/", TIMEOUT_MS, HEADERS), now)),
};

export const SALLES: Agenda[] = [teat, citeDesArts, kabardock, bisik, lucDonat, cdnoi, lespas];

/**
 * The words of a title, to tell the same show published by two sources (« CÉDRIC "ANALYSE" & SES INVITÉS »), its year
 * left out (« Fête de l'ail 2026 » is reunion.fr's « Fête de l'ail »).
 */
export const titleKey = (s: string) => normalize(s).split(" ").filter((w) => w.length > 2 && !["les", "des", "avec", "feat", "et"].includes(w) && !/^20\d\d$/.test(w)).slice(0, 3).join(" ");
