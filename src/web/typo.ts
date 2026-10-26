/**
 * French typography on the page as sent: the ordinary space before « : ; ? ! » » and after « « » becomes a no-break
 * space (U+00A0), so that a phone never starts a line with « : », and so does the one between the word « à » and a
 * number, so that « à 08:00 », « à 3 km » never end a line on « à ». Only the text between the tags: the tags themselves
 * (their attributes, URLs, the metas), the comments and the inside of <script> (the JSON-LD with it), <style>, <pre>,
 * <code> and <textarea> are left as written. The assistants' text (the MCP tools) never goes through here.
 *
 * One pass, character by character: a regular expression over the whole page took twice as long as the page's render.
 */
import { enTetes } from "./securite.js";

// The elements whose inside is not prose, skipped up to their closing tag.
const RAW = /^<(script|style|pre|code|textarea)\b/;
const LT = 60;
const SPACE = 32;
const OPEN = 171; // «
const BEFORE = new Set([58, 59, 63, 33, 187]); // : ; ? ! »
const A = new Set([224, 192]); // à À
const LETTER = /\p{L}/u;

/** The space at `i` is after the word « à » (not the end of « voilà ») and before a figure. */
const afterA = (html: string, i: number) => {
  const next = html.charCodeAt(i + 1);
  return next >= 48 && next <= 57 && A.has(html.charCodeAt(i - 1)) && !LETTER.test(html.charAt(i - 2));
};

/** Where the tag, comment or raw element that starts at `i` ends (its last « > »); esc() writes no « > » in attributes. */
function skip(html: string, i: number): number {
  const at = (j: number, len: number) => (j < 0 ? html.length : j + len);
  if (html.startsWith("<!--", i)) return at(html.indexOf("-->", i + 4), 2);
  const raw = RAW.exec(html.slice(i, i + 10));
  const close = raw ? html.indexOf(`</${raw[1]}`, i) : i;
  return close < 0 ? html.length : at(html.indexOf(">", close), 0);
}

export function typo(html: string): string {
  let out = "";
  let from = 0;
  for (let i = 0; i < html.length; i++) {
    const c = html.charCodeAt(i);
    if (c === LT) {
      i = skip(html, i);
    } else if (c === SPACE ? BEFORE.has(html.charCodeAt(i + 1)) || afterA(html, i) : c === OPEN && html.charCodeAt(i + 1) === SPACE) {
      if (c === OPEN) i++;
      out += `${html.slice(from, i)} `;
      from = i + 1;
    }
  }
  return out + html.slice(from);
}

/**
 * A response of the site: its HTML through `typo`, anything else (feeds, files, redirects) as it is. The final HTML is
 * here, so the page's security headers are set here too, its inline scripts hashed (web/securite.ts).
 */
export async function typoPage(r: Response | null): Promise<Response | null> {
  if (!r?.body || !(r.headers.get("content-type") ?? "").startsWith("text/html")) return r;
  const html = typo(await r.text());
  const headers = new Headers(r.headers);
  for (const [k, v] of Object.entries(await enTetes(html))) headers.set(k, v);
  return new Response(html, { status: r.status, statusText: r.statusText, headers });
}
