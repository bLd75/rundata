/**
 * The volcano put forward while the ORSEC plan is at Alerte 1 or higher, or an eruption is under way: a banner on every
 * page, the first place on the home page, /volcan in its alert dress. Read from the /volcan page's copy, where the
 * prefecture's phase already wins over pitonlive's (tools/volcan.ts), so that the banner never says other than the page.
 * The times are the official texts' own: the prefecture's releases give their day only, so no hour is ever written.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Cache } from "../cache.js";
import type { ActualitesAnswer, VolcanAnswer } from "./data.js";
import { esc } from "./map.js";
import { DESCRIPTION_MAX } from "./pages.js";
import { type Hausse, NON_ANNONCEE } from "../tools/volcan.js";
import { libelle } from "../tools/volcan-acces.js";

export interface VolcanAlerte {
  /** « Alerte 1 », « Alerte 2-1 »… as the plan names it; undefined when only the eruption is known. */
  niveau?: string;
  eruption: boolean;
  /** The prefecture's release that declared the level. `jour`: its day, « 2026-10-24 ». */
  communique?: { titre: string; lien: string; jour: string };
  /** pitonlive higher than that release: `niveau` is then pitonlive's, `eruption` the release's, and both levels are said. */
  hausse?: Hausse;
}

/** The day of the prefecture's release in a copy of /volcan, « 2026-10-24 », that copy made by this version or an earlier one. */
export const releaseDay = (c: { jour?: string; publie?: string }) => c.jour ?? new Date(Date.parse(c.publie ?? "") + 4 * 3600_000).toISOString().slice(0, 10);

/** The alert or the eruption the copy of /volcan tells of, or undefined when the volcano is quiet. */
export function alerteVolcan(v: VolcanAnswer | undefined): VolcanAlerte | undefined {
  const e = v?.etat;
  if (!e || typeof e !== "object") return undefined;
  const c = e.communique_prefecture;
  // pitonlive higher than the release: the higher level first, quoted with its source, the release's right after; the
  // word « éruption » only the prefecture's (marketing), so the eruption only as the release says it.
  const h = c && e.ecart_prefecture;
  const niveau = /^Alerte/i.test(e.niveau_orsec ?? "") ? e.niveau_orsec : undefined;
  if (!niveau && !e.eruption_en_cours) return undefined;
  return {
    niveau,
    // Alerte 2 is the eruption under way, in the plan's own terms.
    eruption: h ? e.eruption_en_cours === true : !!e.eruption_en_cours || /^Alerte 2/i.test(niveau ?? ""),
    communique: c && { titre: c.titre, lien: c.lien, jour: releaseDay(c) },
    ...(h && { hausse: h }),
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
const released = (a: VolcanAlerte) => (a.communique ? ` (${dated(a)})` : "");
// « Alerte 1 », the level never apart from its word, and the arrow never alone on its line (marketing).
const nb = (s: string) => s.replace(/^(alerte) /i, "$1\u00a0");
const FOLLOW = "Suivre en direct\u00a0→";
// The level from pitonlive alone, no release of the prefecture read: never « du préfet », nothing said of the Enclos,
// the official level sent to reunion.gouv.fr (marketing).
const pitonOnly = (a: VolcanAlerte) => !a.communique && !a.hausse && !!a.niveau;
const pitonSaid = (a: VolcanAlerte) => `« ${nb(a.niveau!)} » selon pitonlive.com`;
const level = (a: VolcanAlerte) => a.niveau!.toLowerCase();
// The level's words in the plan, true for any alert 1, never a release's of the day nor ours (marketing): « éruption
// probable ou imminente ». Only what the level names: back in vigilance, no « éruption probable ».
const plan = (a: VolcanAlerte) => libelle(a.niveau) ?? "";
const planSaid = (a: VolcanAlerte) => (plan(a) ? ` : « ${plan(a)} », selon le dispositif ORSEC Volcan` : "");

export const ENCLOS = "Accès à l'Enclos interdit.";
export const CONSIGNES = "Accès à l'Enclos interdit. Seules comptent les consignes de la préfecture et de l'OVPF.";
// No release of the prefecture read: the official level and the Enclos sent to its releases (marketing).
const PITON_ONLY = "Le niveau officiel et l'accès à l'Enclos sont dans les communiqués de la préfecture : vérifiez sur reunion.gouv.fr avant de monter.";

/** « 24/10 », of a day « 2026-10-24 ». */
const shortDay = (jour: string) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}`;
// Worded by marketing: pitonlive higher than the release, the banner short; the Enclos only if the release says it.
const hausseBanner = (h: Hausse) =>
  `« ${h.pitonlive} » selon pitonlive.com, « ${h.prefecture} » selon le communiqué de la préfecture du ${shortDay(h.jour_prefecture)}` +
  (h.enclos_interdit ? ". Accès à l'Enclos interdit selon ce communiqué : vérifiez sur reunion.gouv.fr." : " : vérifiez sur reunion.gouv.fr.");

export function bannerText(a: VolcanAlerte): string {
  if (a.hausse) return `🌋 ${hausseBanner(a.hausse)}`;
  if (pitonOnly(a)) return `🌋 Volcan : ${pitonSaid(a)}, niveau officiel à vérifier sur reunion.gouv.fr.`;
  return a.eruption
    ? `🌋 Éruption en cours au Piton de la Fournaise${a.niveau ? ` (${level(a)} du préfet${a.communique ? `, ${dated(a)}` : ""})` : ""}. ${ENCLOS}`
    : `🌋 Piton de la Fournaise : ${level(a)} du préfet${released(a)}${plan(a) ? `, « ${plan(a)} » (dispositif ORSEC Volcan)` : ""}. ${ENCLOS}`;
}

export function bannerHtml(a: VolcanAlerte | undefined, path: string): string {
  if (!a) return "";
  const more = path === "/volcan" ? "" : ` <a href="/volcan">${FOLLOW}</a>`;
  return `<div class="alerte volcan" role="status"><div class="wrap"><span>${esc(bannerText(a))}</span>${more}</div></div>`;
}

// The description of /volcan in that case: the Enclos dropped when it does not fit (marketing).
const hausseMeta = (h: Hausse) => {
  const both = `« ${h.pitonlive} » selon pitonlive.com, « ${h.prefecture} » selon la préfecture (${shortDay(h.jour_prefecture)})`;
  const short = `${both} : vérifiez sur reunion.gouv.fr · 974`;
  return [h.enclos_interdit ? `${both}. Enclos interdit selon son communiqué : vérifiez sur reunion.gouv.fr · 974` : short, short].find((x) => x.length <= DESCRIPTION_MAX) ?? short;
};

// pitonlive higher than the release: its level in its words, with its source (marketing).
const haussePitonlive = (h: Hausse) => `Piton de la Fournaise : « ${h.pitonlive} » selon pitonlive.com`;

export const volcanTitle = (a: VolcanAlerte) =>
  a.hausse ? `${haussePitonlive(a.hausse)} · 974` : a.eruption ? "Éruption du Piton de la Fournaise en direct · 974" : `Piton de la Fournaise : ${level(a)}, éruption probable · 974`;

export const volcanH1 = (a: VolcanAlerte) =>
  a.hausse ? haussePitonlive(a.hausse) : a.eruption ? "Éruption en cours au Piton de la Fournaise" : `Piton de la Fournaise : ${level(a)}${plan(a) ? `, ${plan(a)}` : ""}`;

export const volcanMeta = (a: VolcanAlerte) =>
  a.hausse ? hausseMeta(a.hausse) : pitonOnly(a)
    ? `Piton de la Fournaise : ${pitonSaid(a)}. Niveau officiel : préfecture, reunion.gouv.fr. Communiqués de l'OVPF en direct · 974`
    : a.eruption
    ? `Éruption en cours (OVPF, préfecture)${a.niveau ? `, ${level(a)}` : ""}. ${ENCLOS} Communiqués, séismes et consignes en direct · 974`
    : alertMeta(a);

// Worded by marketing, as the home page's card: the plan's words whole or not at all, within DESCRIPTION_MAX.
function alertMeta(a: VolcanAlerte): string {
  const tail = `. ${ENCLOS} Communiqués de l'OVPF en direct · 974`;
  const short = `${nb(a.niveau!)} du préfet${released(a)}${tail}`;
  return [plan(a) ? `${nb(a.niveau!)} du préfet${released(a)} : « ${plan(a)} »${tail}` : short, short].find((x) => x.length <= DESCRIPTION_MAX) ?? short;
}

export const volcanLead = (a: VolcanAlerte) =>
  a.eruption
    ? "Où, quelle intensité, quelles routes : ce que publient l'OVPF et la préfecture, dans l'ordre, avec l'heure. Respectez les consignes et les fermetures de routes."
    // Never « n'a pas commencé » on our word: the OVPF's newest post may be an image we do not read (marketing).
    : `${NON_ANNONCEE} Seuls l'OVPF et la préfecture l'annonceront : leurs communiqués s'affichent ici dès leur publication.`;

/**
 * The home page's first card, above the weather, the only volcano block there: what the banner of the other pages says
 * besides, the release's day and the way to /volcan, is in it.
 */
export function homeCard(a: VolcanAlerte): string {
  const [h, lead] = a.hausse ? [haussePitonlive(a.hausse), hausseBanner(a.hausse)] : pitonOnly(a)
    ? [`Piton de la Fournaise : ${pitonSaid(a)}`, "Le niveau officiel est celui des communiqués de la préfecture : vérifiez sur reunion.gouv.fr avant de monter."]
    : a.eruption
    ? ["Éruption en cours au Piton de la Fournaise", `${a.niveau ? `${nb(a.niveau)} du préfet${released(a)}. ` : ""}${ENCLOS}`]
    : [`Piton de la Fournaise : ${nb(level(a))}`, `${nb(a.niveau!)} du préfet${released(a)}${planSaid(a)}. ${ENCLOS}`];
  return `<div class="wrap volcan-une"><a class="card" href="/volcan"><h2>🌋 ${esc(h)}</h2><p class="lead">${esc(lead)} <b>${FOLLOW}</b></p></a></div>`;
}

/** The home tile's figure and line during an alert. */
export function tileLive(a: VolcanAlerte): { valeur: string; detail: string } {
  if (a.hausse) return { valeur: esc(`« ${a.hausse.pitonlive} »`), detail: esc(`selon pitonlive.com · préfecture : ${a.hausse.prefecture}`) };
  if (pitonOnly(a)) return { valeur: esc(`« ${nb(a.niveau!)} »`), detail: "selon pitonlive.com" };
  return a.eruption
    ? { valeur: "Éruption en cours", detail: [a.niveau ? esc(level(a)) : "", "Enclos interdit"].filter(Boolean).join(" · ") }
    // No quotes, for room (marketing).
    : { valeur: esc(a.niveau!), detail: [esc(plan(a)), "Enclos interdit"].filter(Boolean).join(" · ") };
}

// --- /volcan during an alert -----------------------------------------------------------------------------------------

export const OVPF_LINKS = [
  { nom: "Le site de l'OVPF (IPGP)", url: "https://www.ipgp.fr/fr/ovpf/actualites-ovpf" },
  { nom: "X : @obsfournaise", url: "https://x.com/obsfournaise" },
  { nom: "Facebook : ObsVolcanoPitonFournaise", url: "https://www.facebook.com/ObsVolcanoPitonFournaise" },
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
      ? `<ul class="rows">${heads.map((i) => `<li><span class="note">${esc(i.quand)}</span><span>${esc(i.media)}</span><a href="${esc(i.lien)}">${esc(i.titre)}</a></li>`).join("")}</ul>`
      : `<p class="card">Pas encore d'article des médias de l'île sur cette alerte. Les annonces officielles sont ci-dessus.</p>`) +
    `</section>`;
  return `<section aria-labelledby="h-officiel"><div class="sec-h"><p class="eyebrow">Alerte en cours</p><h2 id="h-officiel">Les annonces officielles</h2></div>` +
    `<p class="card warn"><b>${esc(pitonOnly(a) ? `Niveau ${pitonSaid(a)}. ${PITON_ONLY}` : CONSIGNES)}</b></p><div class="two">${release}${ovpf}</div></section>${media}`;
}
