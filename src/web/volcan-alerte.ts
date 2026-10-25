/**
 * The volcano put forward while the ORSEC plan is at Alerte 1 or higher, or an eruption is under way: a banner on every
 * page, the first place on the home page, /volcan in its alert dress. Read from the /volcan page's copy, whose level is
 * the official texts' alone (tools/volcan.ts `officiel`), so that the banner never says other than the page. The times
 * are the official texts' own: the prefecture's releases give their day only, so no hour is written for them; the
 * OVPF's posts have theirs. pitonlive.com is never here (the user, 25/10/2026).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Cache } from "../cache.js";
import type { ActualitesAnswer, VolcanAnswer } from "./data.js";
import { esc, fenetre } from "./map.js";
import { DESCRIPTION_MAX, ligne } from "./pages.js";
import { givenAt as postAt, NON_ANNONCEE } from "../tools/volcan.js";
import { libelle } from "../tools/volcan-acces.js";
import { OVPF, OVPF_FACEBOOK } from "../providers/volcan.js";

export interface VolcanAlerte {
  /** « Alerte 1 », « Alerte 2-1 »… as the plan names it; undefined when only the eruption is known. */
  niveau?: string;
  eruption: boolean;
  /** The prefecture's release that declared the level. `jour`: its day, « 2026-10-24 ». */
  communique?: { titre: string; lien: string; jour: string };
  /** The level is the OVPF's, from this post (`date` « 25/10 08:00 heure de La Réunion »), newer and higher than the release. */
  ovpf?: { date: string; lien: string };
  /** The OVPF said the eruption stopped, the level still an alert 2 until the prefecture's next release. */
  arret?: { date: string; lien: string };
}

/** The day of the prefecture's release in a copy of /volcan, « 2026-10-24 », that copy made by this version or an earlier one. */
export const releaseDay = (c: { jour?: string; publie?: string }) => c.jour ?? new Date(Date.parse(c.publie ?? "") + 4 * 3600_000).toISOString().slice(0, 10);

/** The alert or the eruption the copy of /volcan tells of, or undefined when the volcano is quiet. */
export function alerteVolcan(v: VolcanAnswer | undefined): VolcanAlerte | undefined {
  const e = v?.etat;
  if (!e || typeof e !== "object") return undefined;
  const c = e.communique_prefecture;
  const niveau = /^Alerte/i.test(e.niveau_orsec ?? "") ? e.niveau_orsec : undefined;
  if (!niveau && !e.eruption_en_cours) return undefined;
  return {
    niveau,
    // Alerte 2 is the eruption under way, in the plan's own terms, unless the OVPF said it stopped (tools/volcan.ts).
    eruption: typeof e.eruption_en_cours === "boolean" ? e.eruption_en_cours || (/^Alerte 2/i.test(niveau ?? "") && e.eruption_ovpf?.en_cours !== false) : /^Alerte 2/i.test(niveau ?? ""),
    communique: c && { titre: c.titre, lien: c.lien, jour: releaseDay(c) },
    ...(e.niveau_ovpf && { ovpf: e.niveau_ovpf }),
    ...(e.eruption_ovpf?.en_cours === false && { arret: e.eruption_ovpf }),
  };
}

// --- The banner of every page: read once per request, before the page is built ---------------------------------------

const scope = new AsyncLocalStorage<VolcanAlerte | undefined>();
// The banner is read again from the copies at most this often in an isolate (one read of the data center's cache).
const MEMORY_MS = 60_000;
// The read must never hold a page: past this, the page goes without the banner.
const READ_MS = 500;

/** Runs `fn` with `a` as the volcano banner of the pages it builds. */
export const withVolcan = <T>(a: VolcanAlerte | undefined, fn: () => T): T => scope.run(a, fn);
export const volcanBanner = (): VolcanAlerte | undefined => scope.getStore();

// What the last read found, per cache: the pages of the next minute go without a read of their own.
const lastRead = new WeakMap<Cache, { at: number; alerte: VolcanAlerte | undefined }>();

/** The alert, from the copy of /volcan however old it is (the scheduled event keeps it within minutes during an alert). */
export async function volcanNow(cache: Cache, now = new Date()): Promise<VolcanAlerte | undefined> {
  const last = lastRead.get(cache);
  if (last && Math.abs(now.getTime() - last.at) < MEMORY_MS) return last.alerte;
  const alerte = await read(cache, now);
  lastRead.set(cache, { at: now.getTime(), alerte });
  return alerte;
}

async function read(cache: Cache, now: Date): Promise<VolcanAlerte | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), READ_MS)));
  try {
    const got = await Promise.race([cache.peek<VolcanAnswer>("web:volcan", now.getTime() - MEMORY_MS), late]);
    return alerteVolcan(got?.value);
  } catch {
    return undefined; // a store problem must never cost a page
  } finally {
    clearTimeout(timer);
  }
}

// --- The words, marketing's ---------------------------------------------------------------------------------------

// « 24 octobre », of a day « 2026-10-24 ».
const day = (jour: string) => new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
// The release dated, never « depuis le … »: we know what the last release read says, not that the alert still holds;
// the day and its month never apart (marketing).
const dated = (a: VolcanAlerte) => (a.communique ? `communiqué du ${day(a.communique.jour).replace(" ", "\u00a0")}` : "");
// « 24/10 », of a day « 2026-10-24 ».
const dm = (jour: string) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}`;
const released = (a: VolcanAlerte) => (a.communique ? ` (${dated(a)})` : "");
// « Alerte 1 », the level never apart from its word, and the arrow never alone on its line (marketing).
const nb = (s: string) => s.replace(/^(alerte) /i, "$1\u00a0");
const FOLLOW = "Suivre en direct\u00a0→";
// Whose the level is: the prefect's, with the release's day, or the OVPF's, with its post's time (marketing, item 7).
const by = (a: VolcanAlerte) => (a.ovpf ? ` selon l'OVPF (publication du ${postAt(a.ovpf.date)})` : ` du préfet${released(a)}`);
// Draft, to marketing: the eruption stopped according to the OVPF, the level still an alert 2.
const arretSaid = (a: VolcanAlerte) => `L'OVPF a annoncé l'arrêt de l'éruption (publication du ${postAt(a.arret!.date)})`;
const level = (a: VolcanAlerte) => a.niveau!.toLowerCase();
// The level's words in the plan, true for any alert 1, never a release's of the day nor ours (marketing): « éruption
// probable ou imminente ». Only what the level names: back in vigilance, no « éruption probable ».
const plan = (a: VolcanAlerte) => libelle(a.niveau) ?? "";
const planSaid = (a: VolcanAlerte) => (plan(a) ? ` : « ${plan(a)} », selon le dispositif ORSEC Volcan` : "");

export const ENCLOS = "Accès à l'Enclos interdit.";
export const SEULES = "Seules comptent les consignes de la préfecture et de l'OVPF.";
export const CONSIGNES = `${ENCLOS} ${SEULES}`;

export function bannerText(a: VolcanAlerte): string {
  return a.eruption
    ? `🌋 Éruption en cours au Piton de la Fournaise${a.niveau ? ` (${level(a)}${a.ovpf ? ` selon l'OVPF, publication du ${postAt(a.ovpf.date)}` : ` du préfet${a.communique ? `, ${dated(a)}` : ""}`})` : ""}. ${ENCLOS}`
    : `🌋 Piton de la Fournaise : ${level(a)}${by(a)}${a.arret ? `. ${arretSaid(a)}` : plan(a) ? `, « ${plan(a)} » (dispositif ORSEC Volcan)` : ""}. ${ENCLOS}`;
}

// The banner's line on a phone and the home page's card there (pages.ts `ligne`), marketing's: the eruption or the
// level always with whose it is, « Enclos interdit » always, no date (the release is on /volcan, one touch away).
export function volcanLigne(a: VolcanAlerte): string {
  const said = a.eruption
    ? `Éruption selon ${a.niveau && !a.ovpf ? "le préfet" : "l'OVPF"}`
    : a.arret
    ? "Éruption arrêtée selon l'OVPF"
    : `Volcan\u00a0: ${nb(level(a))} ${a.ovpf ? "selon l'OVPF" : "du préfet"}`;
  return `${said} · Enclos interdit`;
}

export function bannerHtml(a: VolcanAlerte | undefined, path: string): string {
  if (!a) return "";
  const more = path === "/volcan" ? "" : ` <a href="/volcan">${FOLLOW}</a>`;
  const short = path === "/volcan" ? "" : ligne("/volcan", "🌋", volcanLigne(a));
  return `<div class="alerte volcan"${short ? " data-court" : ""} role="status">${short}<div class="wrap"><span>${esc(bannerText(a))}</span>${more}</div></div>`;
}

export const volcanTitle = (a: VolcanAlerte) =>
  a.eruption ? "Éruption du Piton de la Fournaise en direct · 974" : a.arret ? `Piton de la Fournaise : ${level(a)} · 974` : `Piton de la Fournaise : ${level(a)}, éruption probable · 974`;

export const volcanH1 = (a: VolcanAlerte) =>
  a.eruption ? "Éruption en cours au Piton de la Fournaise" : `Piton de la Fournaise : ${level(a)}${!a.arret && plan(a) ? `, ${plan(a)}` : ""}`;

export const volcanMeta = (a: VolcanAlerte) =>
  a.eruption
    ? `Éruption en cours (OVPF, préfecture)${a.niveau ? `, ${level(a)}` : ""}. ${ENCLOS} Communiqués, séismes et consignes en direct · 974`
    : alertMeta(a);

// Worded by marketing, as the home page's card: the plan's words whole or not at all, within DESCRIPTION_MAX.
function alertMeta(a: VolcanAlerte): string {
  const tail = `. ${ENCLOS} Communiqués de l'OVPF en direct · 974`;
  const short = `${nb(a.niveau!)}${by(a)}${tail}`;
  return [plan(a) && !a.arret ? `${nb(a.niveau!)}${by(a)} : « ${plan(a)} »${tail}` : short, short].find((x) => x.length <= DESCRIPTION_MAX) ?? short;
}

export const volcanLead = (a: VolcanAlerte) =>
  a.arret
    ? `${arretSaid(a)}. Seuls l'OVPF et la préfecture disent la suite : leurs communiqués s'affichent ici dès que nous les avons lus.`
    : a.eruption
    ? "Où, quelle intensité, quelles routes : ce que publient l'OVPF et la préfecture, dans l'ordre, avec l'heure. Respectez les consignes et les fermetures de routes."
    // Never « n'a pas commencé » on our word: the OVPF's newest post may be an image we do not read (marketing).
    : `${NON_ANNONCEE} Seuls l'OVPF et la préfecture l'annonceront : leurs communiqués s'affichent ici dès que nous les avons lus.`;

/**
 * The home page's first card, above the weather, the only volcano block there: what the banner of the other pages says
 * besides, the release's day and the way to /volcan, is in it.
 */
export function homeCard(a: VolcanAlerte): string {
  const [h, lead] = a.eruption
    ? ["Éruption en cours au Piton de la Fournaise", `${a.niveau ? `${nb(a.niveau)}${by(a)}. ` : ""}${ENCLOS}`]
    : [`Piton de la Fournaise : ${nb(level(a))}`, `${nb(a.niveau!)}${by(a)}${a.arret ? `. ${arretSaid(a)}` : planSaid(a)}. ${ENCLOS}`];
  return `<div class="wrap volcan-une" data-court>${ligne("/volcan", "🌋", volcanLigne(a))}<a class="card" href="/volcan"><h2>🌋 ${esc(h)}</h2><p class="lead">${esc(lead)} <b>${FOLLOW}</b></p></a></div>`;
}

/** The home tile's figure and line during an alert. */
export function tileLive(a: VolcanAlerte): { valeur: string; detail: string; source?: string } {
  // Whose the level is, on the tile's line of its own (marketing).
  const source = a.ovpf ? `OVPF, publication du ${a.ovpf.date.slice(0, 5)}` : a.communique ? `Préfecture, communiqué du ${dm(a.communique.jour)}` : undefined;
  return a.eruption
    ? { valeur: "Éruption en cours", detail: [a.niveau ? esc(level(a)) : "", "Enclos interdit"].filter(Boolean).join(" · "), source }
    // No quotes, for room (marketing).
    : { valeur: esc(a.niveau!), detail: [esc(plan(a)), "Enclos interdit"].filter(Boolean).join(" · "), source };
}

// --- /volcan during an alert -----------------------------------------------------------------------------------------

// The IPGP took its site offline after two security flaws (the OVPF's director, 25/10/2026): no link to it until it is back.
export const OVPF_LINKS = [
  { nom: "Bluesky : ovpf.bsky.social", url: OVPF.url },
  { nom: "Facebook : ObsVolcanoPitonFournaise", url: OVPF_FACEBOOK },
  { nom: "X : @obsfournaise", url: "https://x.com/obsfournaise" },
];

const ABOUT_VOLCANO = /fournaise|volcan|enclos|[ée]ruption/i;

/** The media's headlines about the volcano in the news copy, newest first; the prefecture's own are shown apart. */
export function mediaHeadlines(news: ActualitesAnswer | undefined, max = 8) {
  if (!news) return [];
  return [...news.en_direct, ...news.infos]
    .filter((i) => i.media !== "Préfecture de La Réunion" && ABOUT_VOLCANO.test(`${i.titre} ${i.resume ?? ""}`))
    .sort((a, b) => (a.publie < b.publie ? 1 : a.publie > b.publie ? -1 : 0))
    .slice(0, max);
}

/** The blocks at the top of /volcan: the prefecture's release, the safety line, the OVPF, the media. */
export function alertSections(a: VolcanAlerte, news: ActualitesAnswer | undefined): string {
  const release = a.communique
    ? `<div class="card"><h3>Le communiqué de la préfecture</h3><p class="note">publié le ${esc(day(a.communique.jour))}</p>` +
      `<p><a href="${esc(a.communique.lien)}">${esc(a.communique.titre)}</a></p></div>`
    : "";
  const ovpf = `<div class="card"><h3>Les annonces de l'Observatoire volcanologique (OVPF)</h3><ul class="plain">` +
    OVPF_LINKS.map((l) => `<li><a href="${esc(l.url)}">${esc(l.nom)}</a></li>`).join("") + `</ul></div>`;
  const heads = mediaHeadlines(news);
  const media = `<section aria-labelledby="h-medias"><div class="sec-h"><h2 id="h-medias">Ce que disent les médias de l'île</h2>` +
    `<p>Titres repris tels quels, avec leur heure : selon les médias, pas une source officielle.</p></div>` +
    (heads.length
      ? `<ul class="rows">${heads.map((i) => `<li><span class="note">${esc(i.quand)}</span><span>${esc(i.media)}</span><a href="${esc(i.lien)}"${fenetre(i.lien)}>${esc(i.titre)}</a></li>`).join("")}</ul>`
      : `<p class="card">Pas encore d'article des médias de l'île sur cette alerte. Les annonces officielles sont ci-dessus.</p>`) +
    `</section>`;
  return `<section aria-labelledby="h-officiel"><div class="sec-h"><p class="eyebrow">Alerte en cours</p><h2 id="h-officiel">Les annonces officielles</h2></div>` +
    `<p class="card warn"><b>${esc(CONSIGNES)}</b></p><div class="two">${release}${ovpf}</div></section>${media}`;
}
