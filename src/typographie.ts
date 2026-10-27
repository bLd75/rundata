/**
 * French typography, one rule for all that is said, the pages (web/typo.ts) and the assistants' answers, instructions
 * and tool descriptions (server.ts): the ordinary space that a phone must not break becomes a no-break one (marketing's
 * kit). U+00A0 before « : ; ? ! » », after « « », after the word « à » before a figure (« à 08:00 », « à 3 km ») and
 * between a figure and its unit (« 39 % », « 16,8 mm », « 2,00 € »); U+202F between the thousands of a quantity
 * (« 3 070 m », « 1 000 km »), as toLocaleString("fr-FR") writes them (tools/format.ts, `nombre`).
 *
 * By the character, never by a regular expression over the whole text: a page goes through it as it is sent.
 */

export const NBSP = " ";
export const NNBSP = " ";

const SPACE = 32;
const OPEN = 171; // «
const BEFORE = new Set([58, 59, 63, 33, 187]); // : ; ? ! »
const A = new Set([224, 192]); // à À
const LETTER = /\p{L}/u;
// The units said after a figure; not followed by a letter or a figure, so not « 3 matchs », « 2 mois », « 5 hôtels ».
const UNIT = /(?:%|‰|°C|°|km\/h|km²|km|m²|m³|mm|cm|m|GWh|MWh|MW|kWh|kW|hPa|€|h|min|nœuds|ha|µg\/m³)(?![\p{L}\d])/uy;
// Before the first group of a quantity, what makes it something else: a decimal, a date or an hour (« 26/10 100 »,
// « 08:00 100 »), a phone number (« +262 262 »).
const NOT_QUANTITY = new Set([44, 46, 47, 58, 43]); // , . / : +

const digit = (c: number) => c >= 48 && c <= 57;

/** The thousands of a quantity at the space `i`: 1 to 3 figures before it, not starting with 0, and 3 after it. */
function thousands(s: string, i: number): boolean {
  if (!(digit(s.charCodeAt(i + 1)) && digit(s.charCodeAt(i + 2)) && digit(s.charCodeAt(i + 3)) && !digit(s.charCodeAt(i + 4)))) return false;
  let j = i - 1;
  while (j >= 0 && digit(s.charCodeAt(j))) j--;
  const run = i - 1 - j;
  // A group after another (« 1 000 000 »): one only if the one before is (not « 0 800 333 », « 2025 100 »).
  if ((s.charCodeAt(j) === 0x202f || s.charCodeAt(j) === SPACE) && digit(s.charCodeAt(j - 1))) return run === 3 && (s.charCodeAt(j) === 0x202f || thousands(s, j));
  return run >= 1 && run <= 3 && s.charCodeAt(j + 1) !== 48 && !NOT_QUANTITY.has(s.charCodeAt(j)) && !LETTER.test(s.charAt(j));
}

/** What the ordinary space at `i` of `s` becomes: a no-break space (U+00A0 or U+202F), or itself. */
export function spaceAt(s: string, i: number): string {
  const next = s.charCodeAt(i + 1);
  const prev = s.charCodeAt(i - 1);
  if (BEFORE.has(next) || prev === OPEN) return NBSP;
  if (digit(next) && A.has(prev) && !LETTER.test(s.charAt(i - 2))) return NBSP;
  if (!digit(prev)) return " ";
  if (thousands(s, i)) return NNBSP;
  UNIT.lastIndex = i + 1;
  return UNIT.test(s) ? NBSP : " ";
}

/** A text as said: each ordinary space that must not break made a no-break one. */
export function insecables(s: string): string {
  let out = "";
  let from = 0;
  for (let i = s.indexOf(" "); i >= 0; i = s.indexOf(" ", i + 1)) {
    const c = spaceAt(s, i);
    if (c === " ") continue;
    out += s.slice(from, i) + c;
    from = i + 1;
  }
  return from ? out + s.slice(from) : s;
}
