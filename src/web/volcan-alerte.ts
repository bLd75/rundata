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

export interface VolcanAlerte {
  /** « Alerte 1 », « Alerte 2-1 »… as the plan names it; undefined when only the eruption is known. */
  niveau?: string;
  eruption: boolean;
  /** The prefecture's release that declared the level. `publie`: its day, ISO. */
  communique?: { titre: string; lien: string; publie: string };
}

/** The alert or the eruption the copy of /volcan tells of, or undefined when the volcano is quiet. */
export function alerteVolcan(v: VolcanAnswer | undefined): VolcanAlerte | undefined {
  const e = v?.etat;
  if (!e || typeof e !== "object") return undefined;
  const niveau = /^Alerte/i.test(e.niveau_orsec ?? "") ? e.niveau_orsec : undefined;
  if (!niveau && !e.eruption_en_cours) return undefined;
  const c = e.communique_prefecture;
  return {
    niveau,
    // Alerte 2 is the eruption under way, in the plan's own terms.
    eruption: e.eruption_en_cours || /^Alerte 2/i.test(niveau ?? ""),
    communique: c && { titre: c.titre, lien: c.lien, publie: c.publie },
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

const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Indian/Reunion" });
const since = (a: VolcanAlerte) => (a.communique ? ` depuis le ${day(a.communique.publie)}` : "");
const level = (a: VolcanAlerte) => a.niveau!.toLowerCase();

export const ENCLOS = "Accès à l'Enclos interdit.";
export const CONSIGNES = "Accès à l'Enclos interdit. Seules comptent les consignes de la préfecture et de l'OVPF.";

export function bannerText(a: VolcanAlerte): string {
  return a.eruption
    ? `🌋 Éruption en cours au Piton de la Fournaise${a.niveau ? ` (${level(a)} du préfet${since(a)})` : ""}. ${ENCLOS}`
    : `🌋 Piton de la Fournaise : ${level(a)} du préfet${since(a)}, éruption probable à très brève échéance. ${ENCLOS}`;
}

export function bannerHtml(a: VolcanAlerte | undefined, path: string): string {
  if (!a) return "";
  const more = path === "/volcan" ? "" : ` <a href="/volcan">Suivre en direct →</a>`;
  return `<div class="alerte volcan" role="status"><div class="wrap"><span>${esc(bannerText(a))}</span>${more}</div></div>`;
}

export const volcanTitle = (a: VolcanAlerte) =>
  a.eruption ? "Éruption du Piton de la Fournaise en direct · 974" : `Piton de la Fournaise : ${level(a)}, éruption probable · 974`;

export const volcanH1 = (a: VolcanAlerte) =>
  a.eruption ? "Éruption en cours au Piton de la Fournaise" : `Piton de la Fournaise : ${level(a)}, éruption probable à très brève échéance`;

export const volcanMeta = (a: VolcanAlerte) =>
  a.eruption
    ? `Éruption en cours (OVPF, préfecture)${a.niveau ? `, ${level(a)}` : ""}. ${ENCLOS} Communiqués, séismes et consignes en direct · 974`
    : `${a.niveau}${since(a)} (préfecture) : éruption probable à très brève échéance. ${ENCLOS} Communiqués de l'OVPF en direct · 974`;

export const volcanLead = (a: VolcanAlerte) =>
  a.eruption
    ? "Où, quelle intensité, quelles routes : ce que publient l'OVPF et la préfecture, dans l'ordre, avec l'heure. Respectez les consignes et les fermetures de routes."
    : "L'éruption n'a pas commencé. Seuls l'OVPF et la préfecture l'annonceront : leurs communiqués s'affichent ici dès leur publication.";

/** The home page's first card, above the weather. */
export function homeCard(a: VolcanAlerte): string {
  const [h, lead] = a.eruption
    ? ["Éruption en cours au Piton de la Fournaise", `${ENCLOS} Les communiqués officiels en direct →`]
    : [`Piton de la Fournaise : ${level(a)}`, `Éruption probable à très brève échéance, selon la préfecture. ${ENCLOS}`];
  return `<div class="wrap volcan-une"><a class="card" href="/volcan"><h2>🌋 ${esc(h)}</h2><p class="lead">${esc(lead)}</p></a></div>`;
}

/** The home tile's figure and line during an alert. */
export function tileLive(a: VolcanAlerte): { valeur: string; detail: string } {
  return a.eruption
    ? { valeur: "Éruption en cours", detail: [a.niveau ? esc(level(a)) : "", "Enclos interdit"].filter(Boolean).join(" · ") }
    : { valeur: esc(a.niveau!), detail: "éruption probable à très brève échéance · Enclos interdit" };
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
    ? `<div class="card"><h3>Le communiqué de la préfecture</h3><p class="note">publié le ${esc(day(a.communique.publie))}</p>` +
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
    `<p class="card warn"><b>${esc(CONSIGNES)}</b></p><div class="two">${release}${ovpf}</div></section>${media}`;
}
