import { describe, expect, it } from "vitest";
import { httpUrl } from "../src/http.js";
import { parseRss as newsRss } from "../src/providers/actualites.js";
import { parseRss as agendaRss } from "../src/providers/agenda.js";
import { parseRss as waterRss } from "../src/providers/avis-eau.js";
import { eventRow } from "../src/tools/agenda.js";
import type { AgendaAnswer } from "../src/web/data.js";
import { agendaPage } from "../src/web/domains.js";

// A feed that is compromised or badly made: its links are not all http(s) addresses.
const BAD = ["javascript:alert(document.domain)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "/agenda/fete-de-l-ail", "//hote.example/agenda", "https:///sans-hote", "pas un lien"];
const GOOD = "https://www.petite-ile.re/agenda/fete-de-l-ail";
const NOW = new Date("2026-10-24T04:00:00Z");
const O = "https://rundata.re";

const item = (titre: string, lien: string, extra = "") =>
  `<item><title>${titre}</title><link>${lien.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</link><pubDate>Sat, 24 Oct 2026 06:00:00 +0400</pubDate>${extra}</item>`;
const feed = (items: string[]) => `<?xml version="1.0"?><rss><channel>${items.join("")}</channel></rss>`;

describe("liens venus des flux", () => {
  it("keeps an absolute http(s) address only", () => {
    expect(httpUrl(GOOD)).toBe(GOOD);
    expect(httpUrl(" http://www.saintlouis.re/agenda ")).toBe("http://www.saintlouis.re/agenda");
    for (const bad of [...BAD, "", undefined]) expect(httpUrl(bad)).toBeUndefined();
  });

  it("leaves out a news item whose link is not an http(s) address", () => {
    const xml = feed([GOOD, ...BAD].map((l, i) => item(`Info ${i} à Saint-Paul`, l, `<description>Une info à Saint-Paul.</description>`)));
    const infos = newsRss(xml, "Média");
    expect(infos.map((i) => i.lien)).toEqual([GOOD]);
  });

  it("gives an event of an agenda feed no link when its link is relative, « //hote » or not http(s), and the page shows it without one", () => {
    const xml = feed([GOOD, ...BAD].map((l, i) => item(`Concert ${i} samedi 31 octobre 2026`, l)));
    const events = agendaRss(xml, "Ville de Petite-Île", "Petite-Île", true);
    expect(events).toHaveLength(BAD.length + 1);
    const rows = events.map((e) => eventRow({ ...e, billetterie: e.lien === GOOD ? "javascript:alert(1)" : undefined }, e.seances));
    expect(rows.map((r) => r.lien)).toEqual([GOOD, ...BAD.map(() => undefined)]);
    expect(rows.map((r) => r.billetterie)).toEqual(rows.map(() => undefined));
    const d = { resume: "", nombre: rows.length, evenements: rows, couverture: "", a_savoir: "", sources: [], ce_week_end: rows } as unknown as AgendaAnswer;
    const html = agendaPage(O, { value: d, fetchedAt: NOW, stale: false }, NOW);
    expect(html).not.toMatch(/javascript:|data:text|hote\.example|href="\/agenda\/fete|sans-hote/i);
    expect(html).toContain(`<a href="${GOOD}" rel="noopener">Concert 0`);
    expect(html).toContain("Concert 1");
    // In the page's structured data too: an event without a link has no url.
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
    const urls = ld[2]["@graph"].map((e: { url?: string }) => e.url);
    expect(urls.filter(Boolean)).toEqual([GOOD]);
  });

  it("keeps a water notice whose link is not http(s), without the link", () => {
    const xml = feed([item("Coupure d'eau à Saint-Denis", "javascript:alert(1)", "<description>Dionéo informe ses clients d'une coupure d'eau.</description>")]);
    const [n] = waterRss(xml, { nom: "Dionéo", url: "https://dioneo.re/rss/flash-infos", communes: ["Saint-Denis"] });
    expect(n.titre).toBe("Coupure d'eau à Saint-Denis");
    expect(n.lien).toBeUndefined();
  });
});
