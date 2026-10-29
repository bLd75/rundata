/**
 * The public sector's job offers at La Réunion, as Choisir le service public (the DGAFP's site, texts under
 * etalab-2.0) publishes them: the State, the communes and their groupings, the Département, the Région, the hospitals
 * and the university. Its feed for La Réunion, hosted by Talentsoft, its provider, gives the 20 latest offers only;
 * 12 to 19 come out a day (2026). The Worker's scheduled event reads it every hour (`collect`, worker.ts) and keeps
 * every offer in the KV store until its closing date, where pages and tools read them (`offres`), never the feed.
 *
 * The feed has no employer and no closing date: the page of each new offer is read for both, then again in turn, one
 * page in 5 minutes at most. An offer leaves the list at its closing date (« Date limite de candidature »), or, without
 * one, 31 days after it was published: the median planned publication of the 4 200 offers of La Réunion of 2026 in the
 * site's weekly file on data.gouv.fr (offres-datagouv-20261004.csv, read on 29/10/2026: p25 30, p75 32, p90 36 days).
 */
import type { Cache, Cached } from "../cache.js";
import { getText } from "../http.js";
import { communeDe } from "../places/codes-postaux.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "csp_offres",
  nom: "Offres d'emploi public à La Réunion (Choisir le service public)",
  organisme: "DGAFP, Choisir le service public",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Choisir le service public",
  url: "https://choisirleservicepublic.gouv.fr/nos-offres/filtres/localisation/274/",
};

// The feed of the district « Réunion (974) », the 20 latest offers.
export const FEED = "https://place-ep-recrute.talent-soft.com/handlers/offerRss.ashx?LCID=1036&Rss_JobDepartment=274";
const SITE = "https://choisirleservicepublic.gouv.fr";

/** Written by the scheduled event (`collect`), read by worker.ts. */
export const KV_KEY = "emploi:offres";
/** As long as an offer without a closing date is kept: the store outlives none of them. */
export const KV_TTL_SECONDS = 32 * 86_400;
/** How long an offer without a closing date stays, from its publication. */
export const GARDE_JOURS = 31;
/** The feed's length: as many new offers in one read, and some may have come and gone between two reads. */
export const FEED_SIZE = 20;

export interface Offre {
  /** The site's reference, « 2026-2416372 », « DGAC-AVE-128697-CAT-B », « O974260900123456 ». */
  ref: string;
  intitule: string;
  /** Its page on Choisir le service public, without the feed's tracking: /offre-emploi/<ref>/. */
  lien: string;
  /** « Direction et pilotage des politiques publiques ». */
  domaine?: string;
  /** « Assistante / Assistant de direction ». */
  metier?: string;
  /** « Emploi ouvert aux titulaires et aux contractuels ». */
  nature?: string;
  /** As the site writes the place: « 97408-ST DENIS CEDEX 9 », « CHU SITES SUD ». */
  lieu?: string;
  /** The commune of `lieu`, only when the resolver knows it exactly; never guessed. */
  commune?: string;
  /** From the offer's page. */
  employeur?: string;
  /** The closing date of applications, from the offer's page: « 2026-11-20 ». */
  limite?: string;
  /** When it was published (ISO, UTC); a day only for the offers read from the site's search pages (scripts/emploi-amorce.ts). */
  publiee: string;
  /**
   * The offer's page: « lue » once read (then read again in turn, `prochaineFiche`), « relire » after one failed read
   * (read once more, at the next event), « abandon » after two: the offer keeps the 31 days' rule. Absent: not read yet.
   */
  fiche?: "lue" | "relire" | "abandon";
}

export interface Copie {
  /** When the feed last answered (ISO, UTC). */
  lu: string;
  /** Newest first. */
  offres: Offre[];
  /** When the feed first failed to answer since `lu`; absent while it answers. */
  echec?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", nbsp: " ", rsquo: "’", hellip: "…", ndash: "–" };
/** Entities decoded once, never « &lt; » nor « &gt; », which would make a tag again in what is shown. */
const decodeText = (s: string) =>
  s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? (/^#\d+$/.test(e) && e !== "#60" && e !== "#62" ? String.fromCodePoint(Number(e.slice(1))) : m));

/** The text of an XML element, its entities decoded once. */
const tag = (xml: string, t: string) => decodeText(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(xml)?.[1] ?? "").replace(/\s+/g, " ").trim();
const tags = (xml: string, t: string) => [...xml.matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, "g"))].map((m) => decodeText(m[1]).replace(/\s+/g, " ").trim());

/** The offer's page, by its reference: the feed's link without its tracking (?tracking=1&idOrigine=502). */
export const lienDe = (ref: string) => `${SITE}/offre-emploi/${encodeURIComponent(ref)}/`;

/** The reference in a link of the site: /offre-emploi/<ref>/ or /offre-emploi/<titre>-reference-<ref>/. */
export function refDe(lien: string): string | undefined {
  let u: URL;
  try {
    u = new URL(lien);
  } catch {
    return undefined;
  }
  if (u.hostname !== "choisirleservicepublic.gouv.fr") return undefined;
  const m = /^\/offre-emploi\/(?:.*-reference-)?([^/]+)\/?$/.exec(u.pathname);
  return m ? decodeURIComponent(m[1]) : undefined;
}

export { communeDe } from "../places/codes-postaux.js";

/** The offers of the feed, as it lists them. */
export function parseFeed(xml: string): Offre[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const ref = refDe(tag(item, "link"));
    const publiee = new Date(tag(item, "pubDate"));
    if (!ref || Number.isNaN(publiee.getTime())) return [];
    // « 2026-2416372 - Assistant(e) de direction ».
    const titre = tag(item, "title");
    const intitule = titre.startsWith(`${ref} - `) ? titre.slice(ref.length + 3).trim() : titre;
    const cats = tags(item, "category");
    // « Domaine/Métier », whose métier may hold a « / » too: « Assistante / Assistant de direction ».
    const dm = cats.find((c) => c.includes("/"));
    const cut = dm?.indexOf("/") ?? -1;
    const lieu = cats.find((c) => /^\d{5}\s*-/.test(c));
    const nature = cats.find((c) => c !== dm && c !== lieu);
    return [{
      ref,
      intitule,
      lien: lienDe(ref),
      ...(dm ? { domaine: dm.slice(0, cut).trim(), metier: dm.slice(cut + 1).trim() } : {}),
      ...(nature ? { nature } : {}),
      ...(lieu ? { lieu, ...(communeDe(lieu) ? { commune: communeDe(lieu) } : {}) } : {}),
      publiee: publiee.toISOString(),
    }];
  });
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/**
 * The offers of one of the site's search pages (/nos-offres/filtres/localisation/274/page/<n>/, 20 a page): their
 * reference, title, field and day (« En ligne depuis le 28 octobre 2026 », midnight at La Réunion). Each card found by
 * position, without building the page (4.5 Mo on 29/10/2026).
 */
export function parseRecherche(html: string): Offre[] {
  return html.split('<li class="fr-col-12 item">').slice(1).flatMap((card) => {
    const a = /<a\s+href="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/.exec(card);
    const ref = a && refDe(a[1]);
    const d = /En ligne depuis le (\d{1,2}) (\p{L}+) (\d{4})/u.exec(card);
    const m = d ? MOIS.indexOf(d[2].toLowerCase()) : -1;
    if (!a || !ref || !d || m < 0) return [];
    const domaine = /class="fr-tag[^"]*"[^>]*>\s*([^<]+?)\s*<\/p>/.exec(card)?.[1];
    // The employer as the card writes it, as on the offer's page; the place is only « Réunion (974) ».
    const employeur = after(card, "Employeur : </span>", "</li>");
    return [{
      ref,
      intitule: decodeText(a[2]).replace(/\s+/g, " "),
      // The page's own link: the short one is checked on the feed's references only.
      lien: a[1].split(/[?#]/)[0],
      ...(domaine ? { domaine: decodeText(domaine) } : {}),
      ...(employeur ? { employeur } : {}),
      publiee: new Date(Date.UTC(Number(d[3]), m, Number(d[1])) - 4 * 3600_000).toISOString(),
    }];
  });
}

/** The text after the first label of the offer's page, to the end of its item: « <span class="sr-only">Employeur : </span> X </li> ». */
const after = (html: string, label: string, end: string) => {
  const at = html.indexOf(label);
  if (at < 0) return undefined;
  const from = at + label.length;
  const to = html.indexOf(end, from);
  // A service under its employer comes after a <br />: « Direction Générale de l'Aviation Civile (DGAC), Service navigation aérienne Océan Indien (SNA/OI) ».
  const s = to > from ? decodeText(html.slice(from, to).replace(/\s*<br\s*\/?>\s*/gi, ", ")).replace(/\s+/g, " ").trim() : "";
  return s && !s.includes("<") ? s : undefined;
};

/**
 * What an offer's page adds to the feed: the employer, the closing date, the place and the nature of the job. Its
 * labels found by position, without building the page (the scheduled event's CPU).
 */
export function parseFiche(html: string): Pick<Offre, "employeur" | "limite" | "lieu" | "nature"> {
  const date = /Date limite de candidature\s*:\s*(\d\d)\/(\d\d)\/(\d{4})/.exec(html);
  const employeur = after(html, ">Employeur : </span>", "</li>");
  const lieu = after(html, ">Localisation : </span>", "</li>");
  const nature = /<strong>Nature de l(?:’|')emploi<\/strong>\s*<\/span>\s*<span>\s*([^<]+?)\s*<\/span>/.exec(html)?.[1];
  return {
    ...(employeur ? { employeur } : {}),
    ...(date ? { limite: `${date[3]}-${date[2]}-${date[1]}` } : {}),
    ...(lieu ? { lieu } : {}),
    ...(nature ? { nature: decodeText(nature) } : {}),
  };
}

/** The offer with what its page says; the feed's place and commune first, the page's when the feed had none. */
export function withFiche(o: Offre, f: ReturnType<typeof parseFiche>): Offre {
  const lieu = o.lieu ?? f.lieu;
  const commune = o.commune ?? communeDe(lieu);
  return {
    ...o,
    ...(f.employeur ? { employeur: f.employeur } : {}),
    ...(f.limite ? { limite: f.limite } : {}),
    ...(o.nature ?? f.nature ? { nature: o.nature ?? f.nature } : {}),
    ...(lieu ? { lieu } : {}),
    ...(commune ? { commune } : {}),
    fiche: "lue",
  };
}

const localDay = (t: number) => new Date(t + 4 * 3600_000).toISOString().slice(0, 10);

/** An offer whose page is not read yet (once more at the next pass for « relire »): what the site lists is open. */
export const enAttente = (o: Offre) => !o.fiche || o.fiche === "relire";

/**
 * Whether the offer is still open at `now`: until its closing date (La Réunion's day) included; while its page is not
 * read, as the site lists it; else 31 days after it was published.
 */
export const ouverte = (o: Offre, now: Date) =>
  o.limite ? o.limite >= localDay(now.getTime()) : enAttente(o) || Date.parse(o.publiee) + GARDE_JOURS * 86_400_000 > now.getTime();

/** Newest first, then by reference: the order of the page and of the tool. */
const order = (a: Offre, b: Offre) => b.publiee.localeCompare(a.publiee) || a.ref.localeCompare(b.ref);

/**
 * Every hour, at 25 past (UTC). Of the events of the first half of the hour at the shortest cadences, the least loaded
 * by the budget's registry once the offers' pages are counted (scripts/build-budget.ts).
 */
export const REFRESH_EVERY = 60;
export const REFRESH_OFFSET = 25;
export const refreshDue = (now: Date) => (((now.getUTCMinutes() - REFRESH_OFFSET) % REFRESH_EVERY) + REFRESH_EVERY) % REFRESH_EVERY < 5;
/** The next hour at 25 past, after `now`: when the scheduled event reads the feed next. */
export function prochaineLecture(now: Date): Date {
  const t = new Date(now);
  t.setUTCMinutes(REFRESH_OFFSET, 0, 0);
  if (t.getTime() <= now.getTime()) t.setUTCHours(t.getUTCHours() + 1);
  return t;
}

/** The scheduled event's period (wrangler.jsonc): one offer's page each, so one page in 5 minutes at most on the site. */
export const EVENEMENT_MINUTES = 5;

/**
 * The offer whose page this event reads: the newest not read yet (or read once more after a failure), else the open
 * offers already read in turn, by the event's slot, without writing where the turn is (one in 5 minutes: each again
 * within 46 hours for 555 offers, 3 days for 864).
 */
export function prochaineFiche(offres: Offre[], now: Date): Offre | undefined {
  const open = offres.filter((o) => ouverte(o, now));
  const nouvelle = open.filter(enAttente).sort(order)[0];
  if (nouvelle) return nouvelle;
  const lues = open.filter((o) => o.fiche === "lue").sort((a, b) => a.ref.localeCompare(b.ref));
  return lues.length ? lues[Math.floor(now.getTime() / (EVENEMENT_MINUTES * 60_000)) % lues.length] : undefined;
}

/**
 * The scheduled event's read, every 5 minutes: the feed when `flux` (every hour at 25 past), and one offer's page
 * (`prochaineFiche`), never two at once; the offers past their closing date dropped. Writes the copy only when it
 * changed. When the feed does not answer, the copy stays, with when it first failed (written once), and the read fails.
 */
export async function collect(before: Copie | null, write: (copie: Copie) => Promise<void>, now = new Date(), flux = refreshDue(now)): Promise<string> {
  let feed: Offre[] = [];
  if (flux) {
    try {
      feed = parseFeed(await getText(SOURCE.id, FEED, 20_000));
      if (!feed.length) throw new Error("flux sans offre lisible");
    } catch (err) {
      if (before && !before.echec) await write({ ...before, echec: now.toISOString() });
      throw err;
    }
  } else if (!before) {
    return "aucune copie, flux lu à la prochaine heure";
  }
  const kept = new Map((before?.offres ?? []).map((o) => [o.ref, o]));
  const nouvelles = feed.filter((o) => !kept.has(o.ref));
  // As many new offers as the feed holds: others may have been published and pushed out between two reads.
  if (before?.offres.length && nouvelles.length >= FEED_SIZE) console.log(`offres d'emploi : ${nouvelles.length} nouvelles références sur ${feed.length} dans le flux, des offres ont pu passer entre deux lectures`);
  for (const o of nouvelles) kept.set(o.ref, o);
  const o = prochaineFiche([...kept.values()], now);
  let page = "aucune page d'offre à lire";
  if (o) {
    const again = o.fiche === "lue";
    try {
      kept.set(o.ref, withFiche(o, parseFiche(await getText(SOURCE.id, o.lien, 15_000))));
      page = `page de l'offre ${o.ref} ${again ? "relue" : "lue"}`;
    } catch {
      // Read already: kept as read. Not yet: once more at the next event, then the 31 days' rule.
      if (!again) kept.set(o.ref, { ...o, fiche: o.fiche === "relire" ? "abandon" : "relire" });
      page = `page de l'offre ${o.ref} sans réponse`;
    }
  }
  const offres = [...kept.values()].filter((x) => ouverte(x, now)).sort(order);
  const closes = kept.size - offres.length;
  const said = `${offres.length} offres, ${flux ? `${nouvelles.length} nouvelles` : "flux non lu"}, ${page}${closes ? `, ${closes} closes retirées` : ""}`;
  // The same offers: not written again, unless the feed answered again after failing.
  if (before && JSON.stringify(offres) === JSON.stringify(before.offres) && !(flux && before.echec)) return `${said} : inchangées, non réécrites`;
  await write(flux ? { lu: now.toISOString(), offres } : { ...before!, offres });
  return `${said} : écrites`;
}

let reader: (() => Promise<Copie | null>) | undefined;

/** In the Worker: read the offers from the KV store, where the scheduled event writes them, and the feed never. */
export function configure(read: (() => Promise<Copie | null>) | undefined) {
  reader = read;
}

// The feed is read once an hour: the copy is asked of the store once an hour (an offer's page read in between shows
// within the hour).
const FRESH_SECONDS = 60 * 60;

/**
 * The stored offers still open, their time the feed's last answer; null where nothing is configured (a local server,
 * the tests), as the Worker alone has them.
 */
export async function offres(cache: Cache, now = new Date()): Promise<Cached<Copie> | null> {
  if (!reader) return null;
  const read = reader;
  const c = await cache.getCopy("emploi:offres", FRESH_SECONDS, async () => {
    const v = await read();
    if (!v) throw new Error("offres d'emploi absentes du stockage");
    return v;
  }, (v) => v.lu);
  return { ...c, value: { ...c.value, offres: c.value.offres.filter((o) => ouverte(o, now)) }, fetchedAt: new Date(c.value.lu) };
}
