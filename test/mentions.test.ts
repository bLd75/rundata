import { describe, expect, it } from "vitest";
import { mentionLinks, mentionOf, withMentions } from "../src/mentions.js";
import { enfantsAnswer } from "../src/tools/enfants.js";
import { text } from "../src/tools/format.js";
import { coupuresCommunePage } from "../src/web/coupures.js";
import { enfantsPage } from "../src/web/enfants.js";
import { pageOf } from "../src/web/places.js";

const SITE = "https://www.letangsale.fr/index.php/bibliotheque-municipale.html";
const MOTS = "site de la ville de L'Étang-Salé";
const HTML_MOTS = "site de la ville de L&#39;Étang-Salé";
const NOW = new Date("2026-10-24T06:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const count = (s: string, x: string) => s.split(x).length - 1;

describe("the sites that ask for their name with each link", () => {
  it("are told by their host, www and subdomains included, and not when the words already name the site", () => {
    expect(mentionOf(SITE)).toBe(MOTS);
    expect(mentionOf("https://letangsale.fr/")).toBe(MOTS);
    expect(mentionOf("https://agenda.letangsale.fr/x")).toBe(MOTS);
    expect(mentionOf("https://www.notletangsale.fr/")).toBeUndefined();
    expect(mentionOf("https://www.saint-leu.re/letangsale.fr")).toBeUndefined();
    expect(mentionOf(undefined)).toBeUndefined();
    expect(mentionOf(SITE, "Le site de la mairie de L'Étang-Salé")).toBeUndefined();
  });

  it("put the mention beside each such link in a tool's answer, at any depth", () => {
    const b = body(text({ lieux: [{ nom: "Bibliothèque", lien: SITE }, { nom: "Parc", lien: "https://www.openstreetmap.org/node/1" }], liens: { sources: [SITE] } }));
    expect(b.lieux[0]).toEqual({ nom: "Bibliothèque", lien: SITE, lien_mention: MOTS });
    expect(b.lieux[1]).not.toHaveProperty("lien_mention");
    expect(b.liens.sources_mention).toBe(MOTS);
    // A label that names the site already: no mention.
    expect(body(text({ site: "https://www.letangsale.fr/", libelle: "Le site de la mairie de L'Étang-Salé" }))).not.toHaveProperty("site_mention");
    // An answer without such a link is written as before.
    const plain = { a: 1, b: ["x"], c: { lien: "https://example.re/" } };
    expect(withMentions(plain)).toBe(JSON.stringify(plain));
  });

  it("put it in the line's <small> on a page, or in a <small> of its own after the link", () => {
    expect(mentionLinks(`<ul><li><span><a href="${SITE}">Bibliothèque</a><small>Rue X</small></span></li></ul>`)).toBe(
      `<ul><li><span><a href="${SITE}">Bibliothèque</a><small>Rue X · ${HTML_MOTS}</small></span></li></ul>`,
    );
    expect(mentionLinks(`<li><a href="${SITE}">Bibliothèque</a></li>`)).toBe(`<li><a href="${SITE}">Bibliothèque</a> <small>${HTML_MOTS}</small></li>`);
    expect(mentionLinks(`<p>Voir <a href="${SITE}">la page</a>.</p>`)).toBe(`<p>Voir <a href="${SITE}">la page</a> <small>${HTML_MOTS}</small>.</p>`);
    // Two links in one line: said once.
    expect(count(mentionLinks(`<li><a href="${SITE}">A</a> <a href="${SITE}#b">B</a><small>x</small></li>`), HTML_MOTS)).toBe(1);
    // Named by its label or by its line already, or another site: unchanged.
    for (const html of [
      `<p><a href="https://www.letangsale.fr/">Le site de la mairie de L&#39;Étang-Salé →</a></p>`,
      `<li><a href="${SITE}">Agenda</a><small>site de la commune de L&#39;Étang-Salé</small></li>`,
      `<li><a href="https://example.re/">A</a><small>x</small></li>`,
      // The name kept on one line by a tag of its own (nobreak).
      `<p><a href="https://www.letangsale.fr/">Le site de la mairie de L&#39;<span style="white-space:nowrap">Étang-Salé</span> →</a></p>`,
    ])
      expect(mentionLinks(html)).toBe(html);
  });

  it("are named on /enfants right after the link, once, and in the children's tool", () => {
    const html = enfantsPage("https://rundata.re", null, NOW);
    const li = html.slice(html.lastIndexOf("<li", html.indexOf(SITE)), html.indexOf("</li>", html.indexOf(SITE)));
    // The address is on the line's second line, with « Y aller »: the mention stays with the link.
    expect(li).toContain(`</a><small>${HTML_MOTS}</small>`);
    expect(count(li, HTML_MOTS)).toBe(1);
    const b = body(enfantsAnswer("médiathèque", "L'Étang-Salé", NOW));
    const lieu = b.lieux.flatMap((l: { lieux?: unknown[] }) => l.lieux ?? [l]).find((l: { lien?: string }) => l.lien === SITE);
    expect(lieu).toMatchObject({ lien: SITE, lien_mention: MOTS });
  });

  it("are not repeated after « Le site de la mairie de L'Étang-Salé » on its water cuts page", () => {
    const html = coupuresCommunePage("https://rundata.re", pageOf("l-etang-sale")!, {}, NOW);
    expect(html).toContain(`<a href="https://www.letangsale.fr/" rel="noopener">Le site de la mairie de L&#39;`);
    expect(html).not.toContain(HTML_MOTS);
  });
});
