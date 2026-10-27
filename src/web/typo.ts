/**
 * French typography on the page as sent (typographie.ts, the same rule as the assistants' answers): only the text
 * between the tags. The tags themselves (their attributes, URLs, the metas), the comments and the inside of <script>
 * (the JSON-LD with it), <style>, <pre>, <code> and <textarea> are left as written.
 *
 * One pass, character by character: a regular expression over the whole page took twice as long as the page's render.
 */
import { spaceAt } from "../typographie.js";
import { enTetes } from "./securite.js";

// The elements whose inside is not prose, skipped up to their closing tag.
const RAW = /^<(script|style|pre|code|textarea)\b/;
const LT = 60;
const SPACE = 32;

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
    } else if (c === SPACE) {
      const kept = spaceAt(html, i);
      if (kept === " ") continue;
      out += html.slice(from, i) + kept;
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
