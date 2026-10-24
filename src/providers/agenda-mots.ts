/** The words of the agendas, shared by the town halls' feeds and the halls' programmes. */

export const MONTHS: [RegExp, number][] = [
  [/^janv(?:ier)?$|^janvie$/, 1], [/^f[eé]v(?:rier)?$|^fevrie$/, 2], [/^mars$/, 3], [/^avr(?:il)?$/, 4], [/^mai$|^m[eé]$/, 5],
  [/^juin$|^zuin$/, 6], [/^juil(?:let)?$|^zuiy[eé]$/, 7], [/^ao[uû]t$|^out$/, 8], [/^sept(?:embre)?$|^sektanm$|^septanm$/, 9],
  [/^oct(?:obre)?$|^oktob$/, 10], [/^nov(?:embre)?$|^novanm$/, 11], [/^d[eé]c(?:embre)?$|^d[eé]sanm$/, 12],
];
/** The month a word names, French or Creole: « oct », « novembre », « désanm ». */
export const monthOf = (w: string) => MONTHS.find(([re]) => re.test(w))?.[1];

/** At most this of a reused agenda's text: the cap of a « sentence » that has no full stop. */
export const LEAD_MAX = 200;
/**
 * The first sentence of a text, short: all a reused agenda gives of it besides the facts (« Concert gratuit de l'école
 * de musique, ouvert à tous. »), cut at a word under LEAD_MAX when it never ends.
 */
export function lead(s: string): string {
  const first = (/^.+?[.!?…](?=\s|$|\p{Lu})/u.exec(s)?.[0] ?? s).trim();
  return first.length > LEAD_MAX ? `${first.slice(0, LEAD_MAX - 1).replace(/\s+\S*$/, "")}…` : first;
}

export type Statut = "annulé" | "reporté" | "complet";

/**
 * What a title says (« ANNULÉ – Fête du quartier », « [COMPLET] »), or a description that says so in so many words
 * (« est annulé », « reporté au 5 décembre »); a description that merely mentions a past postponement is not enough.
 */
// Accented words end where letters do: \b would not see the end of « annulé ».
const word = (w: string) => `(?<![\\p{L}])(?:${w})(?![\\p{L}])`;
const CANCELLED_TITLE = new RegExp(word("annul[ée]e?s?|cancel(?:l?ed)?"), "iu");
const CANCELLED_TEXT = new RegExp(`(?:est|sont|a été|ont été)\\s+annul[ée]`, "iu");
// Written in capitals in a text, it is the news itself.
const CANCELLED_CAPS = new RegExp(word("ANNUL[ÉE]E?S?"), "u");
const POSTPONED_TITLE = new RegExp(word("report[ée]e?s?"), "iu");
const POSTPONED_TEXT = new RegExp(`(?:est|sont|a été|ont été)\\s+report[ée]|${word("report[ée]e?s?")}\\s+(?:au|à)\\s+(?:une\\s+date|\\d|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)`, "iu");
const POSTPONED_CAPS = new RegExp(word("REPORT[ÉE]E?S?"), "u");
const FULL_TITLE = new RegExp(word("complet|sold.?out"), "iu");

export function statusOf(titre: string, description = ""): Statut | undefined {
  if (CANCELLED_TITLE.test(titre) || CANCELLED_TEXT.test(description) || CANCELLED_CAPS.test(description)) return "annulé";
  if (POSTPONED_TITLE.test(titre) || POSTPONED_TEXT.test(description) || POSTPONED_CAPS.test(description)) return "reporté";
  if (FULL_TITLE.test(titre)) return "complet";
  return undefined;
}
