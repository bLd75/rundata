/**
 * The power cuts the mairies relay (providers/coupures-courant.ts), as the tool electricite, resume_du_jour and the
 * page /electricite say them: the facts and the link of each notice, in marketing's words; never « pas de coupure »,
 * since most communes publish nothing that can be read.
 */
import type { Cached } from "../cache.js";
import { localTime } from "../geo.js";
import * as cc from "../providers/coupures-courant.js";
import { credits, de } from "./format.js";

export interface CourantAnswer {
  avis: cc.AvisCourant[];
  /** The mairies read at the last refresh, and those that did not answer. */
  lues: string[];
  indisponibles: string[];
  sources: ReturnType<typeof credits>;
}

/** The copy shared by the tool and the pages (web/partagees.ts). */
export async function courantCopy(): Promise<CourantAnswer> {
  return { ...(await cc.coupures()), sources: credits([cc.SOURCE]) };
}

/** EDF's number for a breakdown (free), as https://reunion.edf.fr/particulier/contacter-edf-a-la-reunion gives it (24/10/2026). */
export const EDF_DEPANNAGE: string | undefined = "0800 333 974";
// A mairie whose last notice is older than this is not said to relay them « aujourd'hui ».
const LIVE_DAYS = 90;
// A cut said to be happening now is said so for this long after its notice.
const NOW_HOURS = 24;
const SLOTS_MAX = 4;
// A notice older than this, or of another year, is not shown with its details: only its date.
const RECENT_DAYS = 30;

const WEEKDAY = new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" });
const localDay = (d: Date) => new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
// The year only when it is not the current one: an old notice must not read as this year's.
const year = (day: string, now: Date) => (day.slice(0, 4) === localDay(now).slice(0, 4) ? "" : `/${day.slice(0, 4)}`);
/** « 2026-10-19 » → « lundi 19/10 », « mercredi 14/05/2025 ». */
const dayFr = (day: string, now: Date) => `${WEEKDAY.format(new Date(`${day}T12:00:00Z`))} ${day.slice(8, 10)}/${day.slice(5, 7)}${year(day, now)}`;
/** When a notice was published: « 14/10 », « 30/04/2025 ». */
const ddmm = (iso: string, now: Date) => {
  const day = localDay(new Date(iso));
  return `${day.slice(8, 10)}/${day.slice(5, 7)}${year(day, now)}`;
};
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} et ${xs[xs.length - 1]}` : xs[0] ?? "");

/** « La mairie de Sainte-Marie », « la mairie du Port ». */
export const mairie = (commune: string) => `la mairie ${de(commune)}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The communes whose mairie relayed a notice lately, for the honesty line. */
export function liveCommunes(c: CourantAnswer, now: Date): string[] {
  return c.lues.filter((commune) => c.avis.some((a) => a.commune === commune && now.getTime() - Date.parse(a.publie) < LIVE_DAYS * 86400_000));
}

/** Marketing's honesty line, its list of communes taken from the mairies read. */
export function honesty(c: CourantAnswer, now: Date): string {
  const live = liveCommunes(c, now);
  return `EDF ne publie pas ses avis de coupure dans un format que nous pouvons lire. Nous reprenons ceux que relaient les mairies${live.length ? ` : aujourd'hui ${list(live)}` : ""}.`;
}

export const none = (commune: string) => `${capital(mairie(commune))} ne publie pas les avis d'EDF dans un format lisible : nous ne savons pas si une coupure est prévue.`;
export const panne = () => (EDF_DEPANNAGE ? `Panne chez vous ? Le service dépannage d'EDF Réunion répond au ${EDF_DEPANNAGE} (numéro vert).` : undefined);

const ends = (s: cc.Creneau) => s.au ?? s.jour;
/** Whether a notice says something of today or later: a cut to come, or one happening now. */
export function ahead(a: cc.AvisCourant, now: Date): boolean {
  const today = localDay(now);
  if (a.nature === "en cours") return now.getTime() - Date.parse(a.publie) < NOW_HOURS * 3600_000;
  return a.creneaux.some((s) => ends(s) >= today);
}

/** « le lundi 19/10 de 09:00 à 15:00, secteurs Rue Médard, Rue des Jésuites ». */
function slotText(s: cc.Creneau, now: Date): string {
  const when = s.au ? `du ${dayFr(s.jour, now)} au ${dayFr(s.au, now)}` : `le ${dayFr(s.jour, now)}${s.de && s.a ? ` de ${s.de} à ${s.a}` : ""}`;
  return `${when}${s.secteurs.length ? `, secteurs ${s.secteurs.join(", ")}` : ""}`;
}

/** What one notice says, in marketing's words. `first`: the commune's latest notice, its « dernier avis ». */
export function sentence(a: cc.AvisCourant, now: Date, first = true): string {
  if (!ahead(a, now) && (now.getTime() - Date.parse(a.publie) > RECENT_DAYS * 86400_000 || localDay(new Date(a.publie)).slice(0, 4) !== localDay(now).slice(0, 4))) {
    return `Pas d'avis récent de ${mairie(a.commune)} : le dernier date du ${ddmm(a.publie, now)}. Nous ne savons pas si une coupure est prévue.`;
  }
  const by = `${mairie(a.commune)} le ${ddmm(a.publie, now)}`;
  const head = `${first ? "Dernier avis" : "Avis"} de coupure d'électricité publié par ${by}`;
  if (a.nature === "en cours") {
    const where = a.secteurs.length ? ` : secteurs ${a.secteurs.join(", ")}` : "";
    return now.getTime() - Date.parse(a.publie) < NOW_HOURS * 3600_000
      ? `Coupure en cours selon ${mairie(a.commune)} (avis du ${ddmm(a.publie, now)})${where}.`
      : `${head} : coupure en cours ce jour-là${a.secteurs.length ? `, secteurs ${a.secteurs.join(", ")}` : ""}.`;
  }
  if (!a.creneaux.length) return `${head} : « ${a.titre} ».`;
  const today = localDay(now);
  const coming = a.creneaux.filter((s) => ends(s) >= today);
  const shown = (coming.length ? coming : a.creneaux).slice(0, SLOTS_MAX);
  const more = (coming.length || a.creneaux.length) - shown.length;
  return `${head} : coupure programmée ${shown.map((x) => slotText(x, now)).join(" ; ")}${more > 0 ? ` ; et ${more} autre${more > 1 ? "s" : ""} dans l'avis` : ""}.`;
}

export interface CourantRow {
  texte: string;
  commune: string;
  nature: cc.AvisCourant["nature"];
  publie_le: string;
  titre: string;
  lien: string;
  creneaux?: cc.Creneau[];
  secteurs?: string[];
}

const row = (a: cc.AvisCourant, now: Date, first: boolean): CourantRow => ({
  texte: sentence(a, now, first),
  commune: a.commune,
  nature: a.nature,
  publie_le: localTime(new Date(a.publie)),
  titre: a.titre,
  lien: a.lien,
  creneaux: a.creneaux.length ? a.creneaux : undefined,
  secteurs: a.secteurs.length ? a.secteurs : undefined,
});

/** A commune's notices to say: those of today or later, else its latest one; none when its mairie relays none. */
export function rowsOf(c: CourantAnswer, commune: string, now: Date): CourantRow[] {
  const own = c.avis.filter((a) => a.commune === commune);
  const coming = own.filter((a) => ahead(a, now));
  return (coming.length ? coming : own.slice(0, 1)).map((a, i) => row(a, now, i === 0 && a === own[0]));
}

/** A commune's notices of today or later only: what resume_du_jour says, nothing on the other days. */
export function aheadRows(c: CourantAnswer, commune: string, now: Date): CourantRow[] {
  const own = c.avis.filter((a) => a.commune === commune);
  return own.filter((a) => ahead(a, now)).map((a) => row(a, now, a === own[0]));
}

/** « coupure d'électricité programmée le lundi 26/10 de 09:00 à 15:00 », for the summary's one line. */
export function shortOf(a: Pick<CourantRow, "nature" | "creneaux">, now: Date): string {
  if (a.nature === "en cours") return "coupure d'électricité en cours selon la mairie";
  const next = (a.creneaux ?? []).find((s) => ends(s) >= localDay(now));
  if (!next) return "coupure d'électricité annoncée par la mairie";
  const when = next.au ? `du ${dayFr(next.jour, now)} au ${dayFr(next.au, now)}` : `le ${dayFr(next.jour, now)}${next.de && next.a ? ` de ${next.de} à ${next.a}` : ""}`;
  return `coupure d'électricité programmée ${when}`;
}

/**
 * What the tool electricite adds: the commune's notices, or, when no place is given, the latest of each mairie that
 * relayed one lately (those of the honesty line): a notice of last year says nothing of the island today.
 */
export function courantBlock(copy: Cached<CourantAnswer> | undefined, commune: string | undefined, now: Date) {
  if (!copy) return { indisponible: "Les avis de coupure relayés par les mairies n'ont pas encore été lus : réessayer plus tard." };
  const c = copy.value;
  const followed = (x: string) => cc.MAIRIES.some((m) => m.commune === x);
  const avis = commune ? (followed(commune) ? rowsOf(c, commune, now) : []) : liveCommunes(c, now).flatMap((x) => rowsOf(c, x, now));
  return {
    avis,
    note: commune && !avis.length ? none(commune) : undefined,
    a_savoir: honesty(c, now),
    depannage: panne(),
    lu_a: localTime(copy.fetchedAt),
    indisponibles: c.indisponibles.length ? c.indisponibles : undefined,
  };
}
