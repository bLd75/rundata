/**
 * A site that did not answer at the last read, in marketing's words (marketing/sites-muets-3ter.md): it is neither gone
 * nor empty. With what was read before kept, the hour of that read; without, that the read failed. Never « fermé »,
 * « vide », « ne publie pas », and never why it is silent: we do not know.
 *
 * The subject is always the site, as the source shows its name (« le site de la mairie de Sainte-Marie », « le site de
 * la CIREST »), never the institution alone, which would read as ignoring a request.
 */
import { localTime } from "../geo.js";

/** « 24/10 10:00 » → « aujourd'hui à 10:00 » the same day at La Réunion, else « le 24/10 à 10:00 » (as lu_le). */
export function when(at: string, now: Date): string {
  const [day, hour] = at.split(" ");
  return day === localTime(now).split(" ")[0] ? `aujourd'hui à ${hour}` : `le ${day} à ${hour}`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface Injoignable {
  /** The whole of it, for a field (`injoignable`) or under a list on a page. */
  texte: string;
  /** In a few words, for a summary or a tile's detail. */
  court: string;
}

/**
 * `site`: « le site de la CIREST ». `keptAt`: when what is still shown was read (« 24/10 10:00 »), undefined when
 * nothing is kept. `readAt`: the read that failed. `mayChange`: what is shown may have changed since (notices, an
 * agenda): the reader is sent to the site.
 */
export function injoignable(site: string, keptAt: string | undefined, readAt: string, now: Date, mayChange = true): Injoignable {
  if (keptAt) {
    const at = when(keptAt, now);
    return { texte: `Lu ${at} : ${site} n'a pas répondu depuis.${mayChange ? " Ce qui suit peut avoir changé : voir son site." : ""}`, court: `lu ${at}, sans réponse depuis` };
  }
  const hour = when(readAt, now);
  return {
    texte: `${capital(site)} n'a pas répondu à notre dernière lecture (${hour}) : nous ne savons pas ce qu'il annonce en ce moment.`,
    court: `site sans réponse à notre dernière lecture (${hour.startsWith("aujourd'hui") ? readAt.split(" ")[1] : readAt})`,
  };
}

/** Media not read this time, in one sentence (the page of the news, the tool's summary). `readAt`: the read that failed. */
export const mediasNonLus = (names: string[], readAt: string, now: Date) =>
  `Non lus cette fois : ${names.join(", ")}. Leur site n'a pas répondu à notre dernière lecture (${when(readAt, now)}) : nous ne savons pas ce qu'ils annoncent en ce moment.`;

/**
 * Agendas not read this time (`all`), those left to the next question for want of subrequests apart (`remises`): the
 * others did not answer at the read of `readAt`.
 */
export function agendasNonLus(all: string[], remises: string[] | undefined, readAt: string, now: Date): string {
  const silent = all.filter((n) => !remises?.includes(n));
  const left = all.filter((n) => remises?.includes(n));
  return [
    silent.length ? `Sans réponse à notre dernière lecture (${when(readAt, now)}) : ${silent.join(", ")}.` : "",
    left.length ? `Lecture remise à la suivante : ${left.join(", ")}.` : "",
    `${all.length > 1 ? "Leurs" : "Ses"} événements peuvent manquer ici.`,
  ].filter(Boolean).join(" ");
}
