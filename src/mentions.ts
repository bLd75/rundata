/**
 * The sites whose legal notice allows a direct link to their pages on condition that each link names the source: by
 * host, the words said with every link to it, on the pages and in the tools' answers. Worded by the user (26/10/2026).
 * - L'Étang-Salé (letangsale.fr/mes-acces-rapides/mes-liens-utiles/mentions-legales): links allowed, the source named.
 *
 * A page: « · site de la ville de L'Étang-Salé » at the end of the line's <small> (web/enfants.ts puts it right after
 * the address), or a <small> of its own right after the link when the line has none. A tool's answer: a field
 * « <champ>_mention » beside each field whose value is such a link (« site » → « site_mention »). Neither when the link's
 * words or its line already name the site (« Le site de la mairie de L'Étang-Salé »).
 */
import { esc } from "./web/map.js";

interface Mention {
  /** The words, in the user's wording. */
  mots: string;
  /** Words of a label or a line that already name the source: the mention is then not repeated. */
  nomme: RegExp;
}

const APOSTROPHE = "(?:'|’|&#39;)";
// Between two words, spaces or tags: nobreak() keeps « Étang-Salé » on one line in a <span> of its own.
const GAP = "(?:\\s|<[^>]*>)+";
const TAGS = "(?:<[^>]*>)*";
const MENTIONS: Readonly<Record<string, Mention>> = {
  "letangsale.fr": { mots: "site de la ville de L'Étang-Salé", nomme: new RegExp(["site", "de", "la", "(?:ville|mairie|commune)", "de", `L${APOSTROPHE}${TAGS}Étang-Salé`].join(GAP), "i") },
};

// Any of the hosts in a text, as a quick test before a closer look: most answers and pages have none.
const ANY = new RegExp(Object.keys(MENTIONS).map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
const HOST = /^https?:\/\/([^/?#:]+)/i;

function find(url: string): Mention | undefined {
  const host = HOST.exec(url)?.[1].toLowerCase();
  if (!host) return undefined;
  for (const [h, m] of Object.entries(MENTIONS)) if (host === h || host.endsWith(`.${h}`)) return m;
  return undefined;
}

/** The words to say with a link to this address, or undefined when its site asks for none. */
export function mentionOf(url: string | undefined, label = ""): string | undefined {
  const m = url ? find(url) : undefined;
  return m && !m.nomme.test(label) ? m.mots : undefined;
}

/** A tool's answer as JSON, each link that asks for it with its « <champ>_mention » beside it. */
export function withMentions(payload: unknown): string {
  const json = JSON.stringify(payload, null, 1);
  return json && ANY.test(json) ? JSON.stringify(mark(payload), null, 1) : json;
}

function mark(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(mark);
  if (!v || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  const strings = Object.values(o).flatMap((x) => (typeof x === "string" ? [x] : Array.isArray(x) ? x.filter((y): y is string => typeof y === "string") : []));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    out[k] = mark(x);
    const urls = typeof x === "string" ? [x] : Array.isArray(x) ? x.filter((y): y is string => typeof y === "string") : [];
    const m = urls.map(find).find(Boolean);
    if (m && !(`${k}_mention` in o) && !strings.some((s) => m.nomme.test(s))) out[`${k}_mention`] = m.mots;
  }
  return out;
}

const LINK = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

/** A page's body, each link that asks for it with its mention in its line's <small>, or in one of its own after it. */
export function mentionLinks(html: string): string {
  if (!ANY.test(html)) return html;
  // Insertions by position, made from the end so that the positions found stay right.
  const at: [number, string][] = [];
  const done = new Set<number>();
  for (const a of html.matchAll(LINK)) {
    const m = find(a[1].replace(/&amp;/g, "&"));
    if (!m) continue;
    const start = a.index!;
    const end = start + a[0].length;
    // Its line: the <li> around it, else the link alone.
    const li = html.lastIndexOf("<li", start);
    const inLine = li > html.lastIndexOf("</li>", start);
    const close = inLine ? html.indexOf("</li>", end) : -1;
    const line = inLine && close > 0 ? html.slice(li, close) : a[0];
    if (m.nomme.test(line) || (inLine && done.has(li))) continue;
    if (inLine) done.add(li);
    const small = close > 0 ? html.slice(end, close).indexOf("</small>") : -1;
    if (small >= 0) at.push([end + small, ` · ${esc(m.mots)}`]);
    else at.push([end, ` <small>${esc(m.mots)}</small>`]);
  }
  let out = html;
  for (const [i, s] of at.sort((x, y) => y[0] - x[0])) out = out.slice(0, i) + s + out.slice(i);
  return out;
}
