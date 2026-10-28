/**
 * What is happening on the island now, from its newsrooms: the headlines of the local media, the live blogs they run
 * on a day of mobilisation, a cyclone or an eruption, and the press releases of the prefecture. Headlines, the first
 * sentence and the link only, as a news aggregator does: the articles stay on the media's sites.
 * - Clicanoo (Le Journal de l'île), Freedom, Parallèle Sud: their RSS; Freedom's terms allow a link to its home page
 *   only, so its items link there (src/providers/accueils-medias.ts);
 * - Imaz Press and Témoignages: their Google News sitemap (Imaz Press keeps its RSS from robots); Imaz Press's live
 *   blogs (« l'actu en continu »), read from the article page, each entry with its time;
 * - Le Quotidien de La Réunion: its home page (no feed, and a sitemap without titles), the time to the minute only when
 *   it says « il y a N minutes »;
 * - the prefecture: the list of its press releases.
 * Linfo.re and Zinfos974 refuse automated readers: they are not read. Réunion La 1ère neither: France Télévisions'
 * terms forbid reading its sites by a program, its titles included (src/providers/autorisations.ts, MEDIAS).
 * Everything is read in one go every few minutes and kept as one entry, so a question costs at most a dozen requests.
 */
import type { Cache, Cached } from "../cache.js";
import { getText, httpUrl } from "../http.js";
import gazetteer from "../places/gazetteer.json" with { type: "json" };
import { normalize } from "../places/resolve.js";
import type { SourceInfo } from "../types.js";
import { ACCUEIL, ACCUEILS } from "./accueils-medias.js";
import { strip } from "./avis-eau.js";

export const SOURCES = {
  medias: {
    id: "medias_locaux",
    nom: "Titres des médias de La Réunion : Clicanoo, Le Quotidien, Imaz Press, Freedom, Parallèle Sud, Témoignages",
    organisme: "Rédactions de La Réunion",
    licence: "Titres, première phrase quand le média la donne, et lien seulement\u00a0; les articles sont sur le site de chaque média",
    attribution: "Clicanoo (Le Journal de l'île), Le Quotidien de La Réunion, Imaz Press Réunion, Freedom, Parallèle Sud, Témoignages",
    url: "https://www.clicanoo.re/",
  },
  prefecture: {
    id: "prefecture_communiques",
    nom: "Communiqués de presse de la préfecture de La Réunion",
    organisme: "Préfecture de La Réunion",
    licence: "Licence Ouverte Etalab 2.0",
    attribution: "Préfecture de La Réunion",
    url: "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse",
  },
} satisfies Record<string, SourceInfo>;

const HEADERS = { "User-Agent": "rundata.re (contact@rundata.re)" };
export const FRESH_SECONDS = 5 * 60;
/** What is kept: the last three days. */
const KEEP_HOURS = 72;
const SUMMARY_MAX = 220;
/** What is read of a text: the start of an article tells where; the rest only costs time. */
const BODY_MAX = 700;
const EXTRACTS_MAX = 4;
/** Live blogs looked for among the newest articles of a medium that runs them. */
const LIVE_PAGES = 2;
const LIVE_HOURS = 18;

export interface Info {
  titre: string;
  /** The first sentence of the article, or of the live entry. */
  resume?: string;
  media: string;
  lien: string;
  /** ISO, UTC. */
  publie: string;
  /** False when the source gives the day only (the prefecture). */
  heure: boolean;
  /** An entry of a live blog. */
  direct?: boolean;
  communes: string[];
  /** The places named, besides the communes: « Ravine des Cabris », « Canabady ». */
  lieux: string[];
  sujets: string[];
  /** The sentences of the text that name a place (« À Saint-Pierre, rendez-vous au centre commercial Canabady »), quoted short. */
  extraits?: { communes: string[]; texte: string }[];
  /** The same story told by other media. */
  aussi?: { media: string; lien: string }[];
}

export interface Fil {
  infos: Info[];
  prefecture: Info[];
  /** The media that did not answer. */
  indisponible: string[];
}

// ---------------------------------------------------------------- text

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Entities, twice over: Imaz Press encodes its titles twice (« &amp;eacute; »). */
function unescape(s: string): string {
  const once = (t: string) => t.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n !== 60 && n !== 62 ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? NAMED[e] ?? m;
  });
  return once(once(s));
}
// The named entities of French text, which the XML layer leaves for the HTML one.
const NAMED: Record<string, string> = {
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", agrave: "à", acirc: "â", auml: "ä", ccedil: "ç", icirc: "î", iuml: "ï",
  ocirc: "ô", ouml: "ö", ugrave: "ù", ucirc: "û", uuml: "ü", oelig: "œ", aelig: "æ", Eacute: "É", Egrave: "È", Ecirc: "Ê",
  Agrave: "À", Acirc: "Â", Ccedil: "Ç", Icirc: "Î", Ocirc: "Ô", Ucirc: "Û", OElig: "Œ", rsquo: "’", lsquo: "‘", ldquo: "“",
  rdquo: "”", laquo: "«", raquo: "»", hellip: "…", ndash: "–", mdash: "—", deg: "°", euro: "€", times: "×", bull: "•", middot: "·",
};

const cdata = (s: string) => s.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "");
/** Plain text, one line. */
export const plain = (s: string) => strip(unescape(cdata(s))).replace(/\s+/g, " ").trim();
const tag = (block: string, t: string) => new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`).exec(block)?.[1] ?? "";

/** The first sentence, cut at a word when long. */
export function firstSentence(text: string): string | undefined {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  const m = /^(.{40,}?[.!?…])(?:\s|$)/u.exec(t);
  const s = m ? m[1] : t;
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1).replace(/\s+\S*$/, "")}…` : s;
}

// ---------------------------------------------------------------- places and subjects

interface Name {
  words: string[];
  /** The words that must be capitalised in the text (proper nouns), so that « la source » is not La Source. */
  caps: boolean[];
  nom: string;
  communes: string[];
  commune: boolean;
  /** The word before it must be this (« Le Port », « La Rivière »). */
  before?: RegExp;
  /** The word after it must not be this (« Saint-Pierre-et-Miquelon », « La Rivière des Galets »). */
  notAfter?: RegExp;
}

// Names the news uses that the gazetteer has otherwise or not at all.
const ALIASES: { nom: string; commune: string; before?: RegExp; notAfter?: RegExp }[] = [
  { nom: "Saint-Gilles", commune: "Saint-Paul" },
  { nom: "Hermitage", commune: "Saint-Paul" },
  { nom: "Cambaie", commune: "Saint-Paul" },
  { nom: "Gillot", commune: "Sainte-Marie" },
  { nom: "Rivière Saint-Louis", commune: "Saint-Louis" },
  { nom: "La Rivière", commune: "Saint-Louis", before: /^la$/i, notAfter: /^(?:des|du|de|d|saint)$/i },
];

// Places of the gazetteer whose name is also a common word or a name found elsewhere.
const VAGUE = new Set([
  "abondance", "bagatelle", "bellevue", "bloc", "bretagne", "cafes", "canots", "cape", "carosse", "chapelle", "confiance", "convenance",
  "corniche", "cratere", "croisee", "croix", "decouverte", "delices", "eperon", "foret", "glaciere", "guillaume", "hangar", "jacques",
  "jardins", "lambert", "liberte", "marine", "mare", "mimosas", "monaco", "montagne", "nouvelle", "orangers", "orchidees", "partage",
  "patelin", "pause", "plaine", "plateforme", "portail", "prima", "providence", "quais", "quatorzieme", "refuge", "rennaissance",
  "reserve", "ressource", "riviere", "savanna", "serre", "source", "stella", "tapage", "trinite", "verger", "bel air", "centre ville",
  "mon repos", "petit paris", "village", "quartier", "ravine",
]);
const SMALL = new Set(["de", "des", "du", "d", "la", "le", "les", "l", "et", "a", "aux", "en", "sur", "sous"]);
const deaccent = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");
const wordsOf = (s: string) => deaccent(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

let INDEX: Map<string, Name[]> | undefined;
function index(): Map<string, Name[]> {
  if (INDEX) return INDEX;
  const by = new Map<string, Name>();
  for (const p of gazetteer.places as { nom: string; type: string; commune: string }[]) {
    if (!["commune", "quartier", "localite", "lieu_dit", "plage", "port"].includes(p.type)) continue;
    add(p.nom, p.commune, p.type === "commune");
  }
  for (const a of ALIASES) add(a.nom, a.commune, false, a);
  function add(nom: string, commune: string, isCommune: boolean, extra: { before?: RegExp; notAfter?: RegExp } = {}) {
    let words = wordsOf(nom);
    // Without the article, and without « Cité » (« Cité Canabady » is Canabady in the news).
    while (words.length > 1 && /^(le|la|les|l|cite)$/i.test(words[0])) words = words.slice(1);
    const key = words.join(" ").toLowerCase();
    if (!key || (!isCommune && !extra.before && (VAGUE.has(key) || (words.length === 1 && key.length < 6)))) return;
    const old = by.get(key);
    if (old) {
      if (!old.communes.includes(commune)) old.communes.push(commune);
      old.commune ||= isCommune;
      return;
    }
    by.set(key, {
      words: words.map((w) => w.toLowerCase()),
      caps: words.map((w) => !SMALL.has(w.toLowerCase())),
      nom,
      communes: [commune],
      commune: isCommune,
      before: key === "port" ? /^(?:le|au|du)$/i : extra.before,
      notAfter: key === "saint pierre" ? /^et$/i : extra.notAfter,
    });
  }
  INDEX = new Map();
  for (const n of by.values()) {
    const list = INDEX.get(n.words[0]) ?? [];
    list.push(n);
    INDEX.set(n.words[0], list);
  }
  return INDEX;
}

const isCap = (w: string) => /^\p{Lu}/u.test(w);

/** The names a text gives of the island's places, each with its commune(s). */
function hits(text: string): Map<string, { communes: string[]; commune: boolean }> {
  const words = wordsOf(text.replace(/\bSte?\b\.?(?=[\s-]\p{Lu})/gu, (m) => (m.startsWith("Ste") ? "Sainte" : "Saint")));
  const lower = words.map((w) => w.toLowerCase());
  const out = new Map<string, { communes: string[]; commune: boolean }>();
  const idx = index();
  for (let i = 0; i < words.length; i++) {
    const cands = idx.get(lower[i]);
    if (!cands) continue;
    for (const n of cands) {
      if (i + n.words.length > words.length) continue;
      let ok = true;
      for (let k = 0; k < n.words.length && ok; k++) {
        const w = words[i + k];
        ok = lower[i + k] === n.words[k] && (!n.caps[k] || isCap(w));
      }
      if (ok && n.before && !(i > 0 && n.before.test(words[i - 1]))) ok = false;
      if (ok && n.notAfter && i + n.words.length < words.length && n.notAfter.test(words[i + n.words.length])) ok = false;
      if (!ok) continue;
      out.set(n.nom, { communes: n.communes, commune: n.commune });
    }
  }
  return out;
}

/** The communes and places a text names, by their gazetteer names (« St-Pierre » too); a commune is named for its places. */
export function placesIn(text: string): { communes: string[]; lieux: string[] } {
  return places(hits(text));
}

function places(found: ReturnType<typeof hits>): { communes: string[]; lieux: string[] } {
  const communes = new Set<string>();
  const lieux = new Set<string>();
  for (const [nom, h] of found) {
    for (const c of h.communes) communes.add(c);
    if (!h.commune) lieux.add(nom);
  }
  // « Saint-Gilles-les-Bains » says « Saint-Gilles » once.
  const named = [...lieux];
  return { communes: [...communes], lieux: named.filter((l) => !named.some((o) => o !== l && normalize(o).startsWith(normalize(l)))) };
}

// The weather's own words; « vigilance » apart, as the volcano has its phase of vigilance too (ORSEC Volcan).
const WEATHER = String.raw`meteo\w*|pluies?|orages?|cyclon\w*|tempete|depression tropicale|houle|vents? forts?|inondation\w*|crues?`;
const WEATHER_WORD = new RegExp(`\\b(?:${WEATHER})\\b`);

/** The subjects, for the questions people ask on a day like this. */
export const SUJETS: { id: string; nom: string; re: RegExp }[] = [
  { id: "mobilisation", nom: "manifestations et blocages", re: /\b(?:barrages?|blocages?|bloqu\w*|manifest\w*|mobilis\w*|gilets? jaunes?|rassemblement\w*|greve\w*|cortege|violences urbaines|couvre feu|emeute\w*|affrontement\w*)\b/ },
  { id: "route", nom: "routes et circulation", re: /\b(?:routes?|circulation|trafic|bouchons?|embouteillage\w*|accidents?|rn ?\d+|quatre voies|littoral|basculement|radiers?|deviation|chaussee|inforoutes?)\b/ },
  { id: "meteo", nom: "météo et cyclones", re: new RegExp(`\\b(?:${WEATHER}|vigilance)\\b`) },
  { id: "volcan", nom: "volcan et séismes", re: /\b(?:volcan\w*|eruption\w*|fournaise|dolomieu|seisme\w*|sismi\w*|enclos)\b/ },
  { id: "eau", nom: "eau et électricité", re: /\b(?:eau potable|coupures?|robinet|citernes?|secheresse|ne buvez pas|ne pas boire|edf|electricite|delestage\w*|panne\w*)\b/ },
  { id: "securite", nom: "faits divers et sécurité", re: /\b(?:incendi\w*|feux|police\w*|gendarm\w*|interpell\w*|tribunal|proces|agression\w*|vols?|meurtre\w*|enquete|secours|pompiers|braconnage)\b/ },
  { id: "sante", nom: "santé", re: /\b(?:sante|chu|hopita\w*|ars|epidemie|dengue|chikungunya|leptospirose|vaccin\w*|cancer)\b/ },
  { id: "politique", nom: "politique et collectivités", re: /\b(?:prefet\w*|prefecture|maires?|municipal\w*|elus?|region|departement\w*|gouvernement|ministre\w*|deputes?|senat\w*|conseil)\b/ },
  { id: "culture", nom: "sorties et culture", re: /\b(?:concerts?|festival\w*|spectacles?|exposition\w*|fete|annul\w*|report\w*)\b/ },
  { id: "sport", nom: "sport", re: /\b(?:sport\w*|match\w*|football|handball|volley|basket|rugby|surf|trail|grand raid|championn\w*|competition\w*)\b/ },
];

export function sujetsOf(text: string): string[] {
  const t = normalize(text);
  const ids = SUJETS.filter((s) => s.re.test(t)).map((s) => s.id);
  // « Retour en phase de vigilance » of the volcano: not the weather, unless a word of the weather says it too.
  return ids.includes("volcan") && ids.includes("meteo") && !WEATHER_WORD.test(t) ? ids.filter((id) => id !== "meteo") : ids;
}

const cut = (s: string) => (s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1).replace(/\s+\S*$/, "")}…` : s);

const FOLD = new Map<string, string>();
/** The text in lower case, without accents or punctuation, character for character: a position in one is a position in the other. */
function folded(s: string): string {
  let out = "";
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    let c = FOLD.get(ch);
    if (c === undefined) {
      const d = ch.normalize("NFD")[0].toLowerCase();
      c = /[\p{L}\p{N}]/u.test(d) ? d : " ";
      FOLD.set(ch, c);
    }
    out += c;
  }
  return out;
}
const PATTERNS = new Map<string, RegExp>();
const patternOf = (nom: string) => {
  let re = PATTERNS.get(nom);
  if (!re) PATTERNS.set(nom, (re = new RegExp(`\\b${squeezed(nom).replace(/^(le|la|les|l|cite) /, "").replace(/ /g, " +")}\\b`)));
  return re;
};
const squeezed = (s: string) => folded(s).split(" ").filter(Boolean).join(" ");

/**
 * For each commune a text names, the clause where it first names it or one of its places (« au centre commercial
 * Canabady à Saint-Pierre »): what a question about that commune needs, when the first sentence does not say it.
 */
function extracts(body: string, found: ReturnType<typeof hits>): Info["extraits"] {
  const text = body.replace(/\s+/g, " ").trim();
  if (!text || !found.size) return undefined;
  const flat = folded(text);
  const at = new Map<string, number>();
  for (const [nom, h] of found) {
    const i = flat.search(patternOf(nom));
    if (i < 0) continue;
    for (const c of h.communes) if (!at.has(c) || at.get(c)! > i) at.set(c, i);
  }
  const kept = (firstSentence(text) ?? "").replace(/…$/, "").length;
  const out: NonNullable<Info["extraits"]> = [];
  for (const [c, i] of [...at].sort((x, y) => x[1] - y[1])) {
    if (i + 20 < kept) continue; // in the summary already
    let from = Math.max(0, ...[". ", "; ", "• ", ": "].map((e) => {
      const k = text.lastIndexOf(e, i);
      return k < 0 ? 0 : k + e.length;
    }));
    if (i - from > 140) from = Math.max(text.lastIndexOf(", ", i) + 2, text.lastIndexOf(" ", i - 120) + 1);
    const ends = [". ", "; ", " •"].map((e) => text.indexOf(e, i)).filter((e) => e > 0);
    const to = Math.min(ends.length ? Math.min(...ends) + 1 : text.length, from + SUMMARY_MAX);
    const clause = text.slice(from, to).trim();
    out.push({ communes: [c], texte: `${from > 0 && !/[.;•:!?]\s$/.test(text.slice(from - 2, from)) ? "…" : ""}${cut(clause)}${to < text.length && !/[.!?…]$/.test(clause) ? "…" : ""}` });
    if (out.length >= EXTRACTS_MAX) break;
  }
  return out.length ? out : undefined;
}

/** An item; `body` is the text the source gives with it, read for its places and subjects, of which only the first sentence and the sentences naming a place are kept. */
function info(media: string, titre: string, raw: string, publie: Date, whole = "", opts: { heure?: boolean; direct?: boolean } = {}): Info | null {
  // An item is its link: one that is not an http(s) address is not kept.
  const lien = httpUrl(raw);
  if (!titre || !lien || Number.isNaN(publie.getTime())) return null;
  const body = whole.length > BODY_MAX ? whole.slice(0, whole.lastIndexOf(" ", BODY_MAX)) : whole;
  const found = hits(`${titre} ${body}`);
  const resume = firstSentence(body);
  return {
    titre,
    resume: resume !== titre ? resume : undefined,
    media,
    lien: ACCUEIL[media] ?? lien,
    publie: publie.toISOString(),
    heure: opts.heure ?? true,
    direct: opts.direct || undefined,
    ...places(found),
    // The subject is in the headline and the lead.
    sujets: sujetsOf(`${titre} ${body.slice(0, 300)}`),
    extraits: extracts(body, found),
  };
}

// ---------------------------------------------------------------- feeds

/** The newest entries of a feed, which lists them newest first: the older ones are past what is kept, and cost time. */
const ITEMS_MAX = 35;
function newest(xml: string, t: string, n = ITEMS_MAX): string {
  let at = 0;
  for (let k = 0; k < n; k++) {
    const e = xml.indexOf(`</${t}>`, at);
    if (e < 0) return xml;
    at = e + t.length + 3;
  }
  return xml.slice(0, at);
}

/** An RSS feed: the title, the link, the date and the first sentence of the description. `skip`: categories left out (a radio's games). */
export function parseRss(xml: string, media: string, skip?: RegExp): Info[] {
  return [...newest(xml, "item").matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    // The full text some feeds carry is not needed, and is the bulk of the feed.
    const head = it.replace(/<content:encoded>[\s\S]*?<\/content:encoded>/, "");
    if (skip && [...head.matchAll(/<category>([\s\S]*?)<\/category>/g)].some(([, c]) => skip.test(plain(c)))) return null;
    return info(media, plain(tag(head, "title")), plain(tag(head, "link")), new Date(plain(tag(head, "pubDate"))), plain(tag(head, "description").slice(0, BODY_MAX + 400)));
  }).filter((x): x is Info => x !== null);
}

/** A Google News sitemap: titles and dates, no text. `skip` leaves out sections (Imaz Press's France-monde). */
export function parseNewsSitemap(xml: string, media: string, skip?: RegExp): Info[] {
  return [...newest(xml, "url", 2 * ITEMS_MAX).matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, u]) => {
    const lien = plain(tag(u, "loc"));
    if (skip?.test(lien)) return null;
    return info(media, plain(tag(u, "news:title")), lien, new Date(plain(tag(u, "news:publication_date"))));
  }).filter((x): x is Info => x !== null);
}

/** Le Quotidien's sections that are not the island's news: the agency's France and world, the readers' letters, the opinions. */
const QUOTIDIEN_SKIP = /^(?:national-et-international|courrier-des-lecteurs|libres-opinions|opinions|programmes)$/;
const AGO = /flaticon-history"><\/i>\s*il y a (\d+) (minute|heure|jour)s?\b/;

/**
 * Le Quotidien de La Réunion's home page: it has no feed (its RSS answers 410) and the sitemap of the month gives
 * neither titles nor hours, a day late. The title of each article, its day (in its address), and the time when the page
 * gives it to the minute (« il y a 41 minutes »); « il y a 4 heures » orders it but is no hour to show.
 */
export function parseQuotidien(html: string, now: Date, origin = "https://www.lequotidien.re"): Info[] {
  const by = new Map<string, { titre: string; day: string; ago?: [number, string] }>();
  for (const m of html.matchAll(/<a href="(\/article\/([a-z0-9-]+)\/(\d{4})\/(\d\d)\/(\d\d)\/[^"]+)"([^>]*)>([\s\S]*?)<\/a>/g)) {
    const [whole, path, section, y, mo, d, attrs, text] = m;
    if (QUOTIDIEN_SKIP.test(section)) continue;
    const a = by.get(path) ?? by.set(path, { titre: "", day: `${y}-${mo}-${d}` }).get(path)!;
    const t = plain(/title="([^"]*)"/.exec(attrs)?.[1] ?? "").replace(/^(?:Lien vers l.article|Article)\s*:\s*/, "") || plain(text);
    // A title the page cuts (« Grand Raid : «Judicaël peut faire enc... ») only when it gives no other.
    if (t && (!a.titre || (a.titre.endsWith("...") && !t.endsWith("...")))) a.titre = t;
    // The time under the title, before the next article.
    const after = html.slice(m.index! + whole.length, m.index! + whole.length + 800);
    const next = after.indexOf('href="/article/');
    const ago = AGO.exec(next < 0 ? after : after.slice(0, next));
    if (ago && !a.ago) a.ago = [+ago[1], ago[2]];
  }
  return [...by].map(([path, a]) => {
    const titre = a.titre.replace(/\.\.\.$/, "…");
    // The day at noon, La Réunion's time, not after now, when the page gives no time that day.
    const noon = new Date(Math.min(Date.parse(`${a.day}T12:00:00+04:00`), now.getTime()));
    if (!a.ago || a.ago[1] === "jour") return info("Le Quotidien", titre, origin + path, noon, undefined, { heure: false });
    const at = new Date(now.getTime() - a.ago[0] * (a.ago[1] === "minute" ? 60_000 : 3600_000));
    // A time of another day than the address's: the page counts from an update; the day is the address's.
    if (new Date(at.getTime() + 4 * 3600_000).toISOString().slice(0, 10) !== a.day) return info("Le Quotidien", titre, origin + path, noon, undefined, { heure: false });
    return info("Le Quotidien", titre, origin + path, at, undefined, { heure: a.ago[1] === "minute" });
  }).filter((x): x is Info => x !== null);
}

/** The prefecture's press releases: a title and the day. */
export function parsePrefecture(html: string, origin = "https://www.reunion.gouv.fr"): Info[] {
  return [...html.matchAll(/<a class="fr-card__link" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?Publié le (\d\d)\/(\d\d)\/(\d{4})/g)].map(([, href, t, d, m, y]) =>
    // The day at noon, La Réunion's time: the hour is not given.
    info("Préfecture de La Réunion", plain(t), new URL(href, origin).toString(), new Date(`${y}-${m}-${d}T12:00:00+04:00`), undefined, { heure: false }),
  ).filter((x): x is Info => x !== null);
}

/** The offset from UTC of a time zone at an instant, in minutes. */
function offsetMinutes(zone: string, at: Date): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(at).map((p) => [p.type, p.value]));
  return (Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000;
}

/**
 * The entries of an Imaz Press live blog (« Easy Liveblogs »): a time, a title, a text. The times are those of Paris,
 * where the site's server is set (an entry stamped 09:33 tells what happens at 11 h in La Réunion): each one is the
 * latest such time not after `now`.
 */
export function parseImazLive(html: string, lien: string, now: Date): Info[] {
  const at = html.indexOf('class="elb-liveblog-list"');
  if (at < 0) return [];
  const offset = offsetMinutes("Europe/Paris", now);
  const paris = new Date(now.getTime() + offset * 60_000);
  return [...html.slice(at).matchAll(/<li class="elb-liveblog-post">([\s\S]*?)<\/li>/g)].map(([, post]) => {
    const hm = /<time>(\d\d):(\d\d)<\/time>/.exec(post);
    if (!hm) return null;
    let t = Date.UTC(paris.getUTCFullYear(), paris.getUTCMonth(), paris.getUTCDate(), +hm[1], +hm[2]) - offset * 60_000;
    if (t > now.getTime() + 5 * 60_000) t -= 86_400_000;
    const titre = plain(tag(post, "h2"));
    const text = plain(post.replace(/<p class="elb-liveblog-post-time">[\s\S]*?<\/p>/, "").replace(/<h2[\s\S]*?<\/h2>/, ""));
    return info("Imaz Press", titre || firstSentence(text) || "", lien, new Date(t), titre ? text : "", { direct: true });
  }).filter((x): x is Info => x !== null && !/^bonjour/i.test(x.titre));
}

// ---------------------------------------------------------------- the same story twice

/** ISO times compare as strings; localeCompare would cost far more. */
const byTime = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const STOP = new Set(["les", "des", "une", "pour", "dans", "avec", "sur", "par", "aux", "qui", "que", "est", "son", "ses", "ce", "cette", "reunion", "plus", "apres", "ont", "pas"]);
const keyWords = (t: string) => new Set(normalize(t).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));

/** One story told by several media is told once, by whoever told it first, with the others in `aussi`. */
export function merge(list: Info[]): Info[] {
  const out: { i: Info; w: Set<string>; t: number }[] = [];
  // Which stories kept so far use a word: a story is compared only with those that share words with it.
  const byWord = new Map<string, number[]>();
  for (const i of [...list].sort((a, b) => byTime(a.publie, b.publie))) {
    const w = keyWords(i.titre);
    const t = Date.parse(i.publie);
    let same: (typeof out)[number] | undefined;
    if (!i.direct) {
      const common = new Map<number, number>();
      for (const x of w) for (const k of byWord.get(x) ?? []) common.set(k, (common.get(k) ?? 0) + 1);
      for (const [k, n] of common) {
        const o = out[k];
        if (n >= 3 && n / Math.min(w.size, o.w.size) >= 0.6 && o.i.media !== i.media && Math.abs(o.t - t) <= 24 * 3600_000) {
          same = o;
          break;
        }
      }
    }
    if (same) {
      (same.i.aussi ??= []).push({ media: i.media, lien: i.lien });
      for (const c of i.communes) if (!same.i.communes.includes(c)) same.i.communes.push(c);
      for (const s of i.sujets) if (!same.i.sujets.includes(s)) same.i.sujets.push(s);
      same.i.resume ??= i.resume;
      continue;
    }
    out.push({ i: { ...i }, w, t });
    if (!i.direct) for (const x of w) (byWord.get(x) ?? byWord.set(x, []).get(x)!).push(out.length - 1);
  }
  return out.map((o) => o.i).sort((a, b) => byTime(b.publie, a.publie));
}

// ---------------------------------------------------------------- reading it all

interface Feed {
  media: string;
  url: string;
  parse: (body: string, now: Date) => Info[];
}

const FEEDS: Feed[] = [
  { media: "Clicanoo", url: "https://www.clicanoo.re/rss", parse: (b) => parseRss(b, "Clicanoo") },
  { media: "Imaz Press", url: "https://imazpress.com/sitemap-news.xml", parse: (b) => parseNewsSitemap(b, "Imaz Press", /\/france-monde\//) },
  { media: "Freedom", url: "https://freedom.fr/feed/", parse: (b) => parseRss(b, "Freedom", /jeux|podcast|actus radio/i) },
  { media: "Parallèle Sud", url: "https://parallelesud.com/feed/", parse: (b) => parseRss(b, "Parallèle Sud") },
  { media: "Témoignages", url: "https://www.temoignages.re/spip.php?page=sitemap-news-fr.xml", parse: (b) => parseNewsSitemap(b, "Témoignages") },
  { media: "Le Quotidien", url: "https://www.lequotidien.re/", parse: (b, now) => parseQuotidien(b, now) },
];

/** Imaz Press articles that may be live blogs: the newest of its editors' selection, or with a live word in the title. */
export function liveCandidates(items: Info[], now: Date): string[] {
  const since = new Date(now.getTime() - LIVE_HOURS * 3600_000).toISOString();
  return items
    .filter((i) => i.media === "Imaz Press" && i.publie >= since && (/\/selection-de-la-redaction\//.test(i.lien) || /en direct|en continu|\blive\b/i.test(i.titre)))
    .sort((a, b) => byTime(b.publie, a.publie))
    .slice(0, LIVE_PAGES)
    .map((i) => i.lien);
}

/** Two copies of the same article from one medium: the one with a summary. A link to a home page is shared by all of its medium's items: told apart by their title. */
function oncePerLink(list: Info[]): Info[] {
  const by = new Map<string, Info>();
  for (const i of list) {
    const k = i.direct ? `${i.lien}#${i.publie}` : ACCUEILS.has(i.lien) ? `${i.lien}#${i.titre}` : i.lien;
    const old = by.get(k);
    if (!old || (!old.resume && i.resume)) by.set(k, old && !i.resume ? { ...i, resume: old.resume } : i);
  }
  return [...by.values()];
}

/**
 * Shared through KV (web/partagees.ts), read by the scheduled event every 5 minutes: read at a question only, a data
 * center's own copy was an hour and a half old where no one had asked since (28/10/2026 at 14:45, the fire at
 * Cambaie, the copy of 13:15 served while the event had read the media at 14:41 in another data center).
 */
export const KEY = "actualites:fil";

export async function fil(cache: Cache, now = new Date()): Promise<Cached<Fil>> {
  return cache.get(KEY, FRESH_SECONDS, () => lire(now));
}

/** Every medium and the prefecture, read now. */
export async function lire(now = new Date()): Promise<Fil> {
  const read = (url: string) => getText(SOURCES.medias.id, url, 12_000, HEADERS);
  const [feeds, pref] = await Promise.all([
    Promise.allSettled(FEEDS.map(async (f) => f.parse(await read(f.url), now))),
    read(SOURCES.prefecture.url).then((h) => parsePrefecture(h)).catch((err) => {
      console.error("source prefecture_communiques indisponible:", err);
      return null;
    }),
  ]);
  const items = feeds.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const lives = await Promise.allSettled(liveCandidates(items, now).map(async (u) => parseImazLive(await read(u), u, now)));
  const all = [...items, ...lives.flatMap((r) => (r.status === "fulfilled" ? r.value : []))];
  const down = [...new Set(FEEDS.filter((_, k) => feeds[k].status === "rejected").map((f) => f.media))];
  if (!all.length && !pref) throw new Error("aucun média ne répond");
  const since = new Date(now.getTime() - KEEP_HOURS * 3600_000).toISOString();
  return {
    infos: merge(oncePerLink(all).filter((i) => i.publie >= since && i.publie <= new Date(now.getTime() + 10 * 60_000).toISOString())),
    prefecture: (pref ?? []).slice(0, 6),
    indisponible: [...down, ...(pref ? [] : ["Préfecture"])].filter((m) => !all.some((i) => i.media === m)),
  };
}
