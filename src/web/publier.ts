/**
 * /publier: the guide « Publier son agenda et ses données » for the mairies, associations and organisers, written by
 * marketing (web/publier-texte.ts). Each format says whether rundata.re reads it, from the code: a label turns to
 * « Déjà lu » only once its reader is merged. Nothing is read to build it.
 */
import type { Alerte } from "./data.js";
import { crumbBar, crumbs, webPage } from "./domains.js";
import { esc } from "./map.js";
import { layout } from "./pages.js";
import brand from "./brand.json" with { type: "json" };
import { GUIDE, INTRO, KREOL } from "./publier-texte.js";

export const PATH = "/publier";
export const TITLE = "Publier son agenda et ses données en open data · guide gratuit · La Réunion 974";
export const META = "Mairies, associations, organisateurs\u00a0: publiez votre agenda en flux ouvert, gratuitement, avec nos tutos pas à pas. Google, assistants IA, rundata.re.";
const H1 = "Publiez votre agenda et vos données\u00a0: le guide";
export const MAILTO = "mailto:contact@rundata.re?subject=Flux%20%C3%A0%20r%C3%A9f%C3%A9rencer";

/** The CSV template the guide's tutorial 6 links to, served at /publier/modele-agenda.csv. */
export const MODELE_CSV = `titre,date_debut,heure_debut,date_fin,heure_fin,lieu,adresse,commune,description,prix,lien,organisateur,contact_public
EXEMPLE à supprimer : Marché nocturne,2026-11-14,18:00,2026-11-14,23:00,Front de mer,Boulevard Hubert-Delisle,Saint-Pierre,"Producteurs locaux, artisans et musique.",gratuit,https://example.org/marche-nocturne,Association Exemple,contact@example.org
`;

/** What rundata.re does with each kind of feed: `ics` is the iCalendar reader (providers/agenda.ts, ics()). */
export const ETATS: Record<string, "lu" | "bientot" | "demande"> = { lu: "lu", ics: "bientot", demande: "demande" };
const LABEL = {
  lu: ["Déjà lu", "Déjà lu par rundata.re"],
  bientot: ["Bientôt lu", "Bientôt lu par rundata.re"],
  demande: ["Sur demande", "Sur demande : écrivez-nous"],
} as const;

function etat(kind: string, short: boolean): string {
  const e = ETATS[kind];
  if (!e) throw new Error(`état inconnu : ${kind}`);
  const text = LABEL[e][short ? 0 : 1];
  return e === "demande" && !short ? `<a class="etat demande" href="${MAILTO}">${text}</a>` : `<span class="etat ${e}">${text}</span>`;
}

/** The tutorials of the table, by their number: their anchors. */
const TUTOS: Record<string, string> = {};

/** **gras**, *italique*, `code`, [lien](adresse), and the labels, on text already escaped. */
function inline(md: string): string {
  return esc(md)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s.,;:)]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t: string, href: string) => `<a href="${href}">${t}</a>`)
    .replace(/\{\{(etat|court):([a-z]+)\}\}/g, (_, how: string, kind: string) => etat(kind, how === "court"));
}

const heading = (line: string) => /^(#{2,3}) (.+?)(?: \[#([a-z0-9-]+)\])?$/.exec(line);

/** The guide's Markdown, as the page shows it: sections and tutorials with their anchors, lists, the table, the code. */
export function render(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  // A tutorial's number (« 4 · WordPress… ») gives its anchor to the table above.
  for (const l of lines) {
    const h = heading(l);
    const n = h && /^(\d) · /.exec(h[2]);
    if (h?.[3] && n) TUTOS[n[1]] = h[3];
  }
  let open = false;
  const close = () => {
    if (open) out.push("</section>");
    open = false;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = heading(line);
    if (h) {
      if (h[1] === "##") {
        close();
        out.push(`<section${h[3] ? ` id="${h[3]}"` : ""} class="guide">`, `<h2>${inline(h[2])}</h2>`);
        open = true;
      } else out.push(`<h3${h[3] ? ` id="${h[3]}"` : ""}>${inline(h[2])}</h3>`);
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].startsWith("|"); i++) {
        if (/^\|[-| ]+\|$/.test(lines[i])) continue;
        rows.push(lines[i].slice(1, -1).split("|").map((c) => c.trim()));
      }
      const [head, ...body] = rows;
      const cell = (c: string, k: number) => {
        const n = k === 0 && /^(\d) · /.exec(c);
        return n && TUTOS[n[1]] ? `<a href="#${TUTOS[n[1]]}">${inline(c)}</a>` : inline(c);
      };
      out.push(`<div class="table-wrap"><table class="drought niveaux"><thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
        // Each cell names its column: on a phone, a row reads as a card (« Coût : gratuit »).
        .map((r) => `<tr>${r.map((c, k) => (k === 0 ? `<th scope="row">${cell(c, k)}</th>` : `<td data-label="${esc(head[k])}">${cell(c, k)}</td>`)).join("")}</tr>`)
        .join("")}</tbody></table></div>`);
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      for (; i < lines.length && lines[i].startsWith(">"); i++) quote.push(lines[i].replace(/^> ?/, ""));
      out.push(`<div class="card callout">${render(quote.join("\n")).replace(/<\/?section[^>]*>/g, "")}</div>`);
      continue;
    }
    const item = /^(\s*)(-|\d+\.) (.*)$/.exec(line);
    if (item) {
      out.push(list(lines, i, (next) => (i = next)));
      continue;
    }
    const para: string[] = [];
    for (; i < lines.length && lines[i].trim() && !heading(lines[i]) && !/^(\s*)(-|\d+\.) |^[|>`]/.test(lines[i]); i++) {
      para.push(lines[i].trim());
      // A line all in bold is a paragraph of its own (« **Votre flux est en ligne ? Dites-le-nous.** »).
      if (/^\*\*[^*]+\*\*$/.test(lines[i].trim())) { i++; break; }
    }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  close();
  return out.join("\n");
}

/** A list from line `start`, its items at the first one's indent, a deeper item opening a list inside. */
function list(lines: string[], start: number, done: (next: number) => void): string {
  const first = /^(\s*)(-|\d+\.) /.exec(lines[start])!;
  const indent = first[1].length;
  const ordered = first[2] !== "-";
  const from = ordered ? Number.parseInt(first[2], 10) : 1;
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const m = /^(\s*)(-|\d+\.) (.*)$/.exec(lines[i]);
    if (!m || m[1].length < indent) break;
    if (m[1].length > indent) {
      const inner = list(lines, i, (next) => (i = next));
      items[items.length - 1] += inner;
      continue;
    }
    if ((m[2] === "-") === ordered) break;
    items.push(inline(m[3]));
    i++;
  }
  done(i);
  const tag = ordered ? "ol" : "ul";
  return `<${tag}${ordered && from !== 1 ? ` start="${from}"` : ""}>${items.map((x) => `<li>${x}</li>`).join("")}</${tag}>`;
}

export function publierPage(origin: string, alerte?: Alerte): string {
  const band = `${crumbBar("Publier ses données")}
<div class="wrap intro solo"><div class="pitch">
  <p class="pill"><span class="dot"></span>Guide gratuit</p>
  <h1>${esc(H1)}</h1>
  <p class="slogan" lang="${brand.slogan_lang}">${esc(KREOL)}</p>
  <p class="lead">${inline(INTRO[0])}</p>
  <p>${inline(INTRO[1])}</p>
</div></div>`;
  // The address to write to opens the mail, with its subject.
  const body = render(GUIDE).replaceAll("<strong>contact@rundata.re</strong>", `<a href="${MAILTO}"><strong>contact@rundata.re</strong></a>`);
  return layout(origin, { title: TITLE, description: META, path: PATH, jsonld: [crumbs(origin, "Publier ses données", PATH), webPage(origin, PATH, TITLE, META, null)], alerte }, band, body);
}
