import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { BUILT, RANDONNEES } from "../src/providers/traces.js";
import type { AgendaAnswer } from "../src/web/data.js";
import { agendaEvents, agendaPage, busPage, calendrierPage, coupuresPage, daePage, historiquePage, tracePage, traficPage } from "../src/web/domains.js";
import { homePage } from "../src/web/home.js";
import { meteoPage, placePage } from "../src/web/pages.js";
import { pageOf, PAGES } from "../src/web/places.js";
import { site } from "../src/web/site.js";

const NOW = new Date("2026-10-24T04:00:00Z");
const O = "https://rundata.re";
const get = async (path: string) => (await site(new Request(`${O}${path}`), new Cache(new MemoryStore(), () => NOW.getTime()), () => {}, NOW))!.text();
const title = (html: string) => html.match(/<title>(.*?)<\/title>/)![1].replace(/&#39;/g, "'");
type Row = AgendaAnswer["ce_week_end"][number];
const row = (r: Partial<Row>): Row => ({ titre: "Concert", quand: "samedi 24/10 à 19:30", date: "2026-10-24T19:30", genres: ["concert"], lien: "https://example.re/concert", publie_par: "Mairie", ...r }) as Row;

describe("search engines", () => {
  it("skip the copies made for the assistants, which still read them", async () => {
    const robots = await get("/robots.txt");
    const groups = robots.split("\n\n");
    expect(groups[0]).toBe("User-agent: Googlebot\nUser-agent: GoogleOther\nUser-agent: Bingbot\nDisallow: /*?maj=\nAllow: /");
    expect(groups[1]).toBe("User-agent: *\nAllow: /");
    expect(robots).toContain(`Sitemap: ${O}/sitemap.xml`);
  });

  it("find no ?maj= address in the pages: the time is added on the click, to a link they do not follow", () => {
    for (const html of [homePage(O, null, NOW), meteoPage(O, null, NOW), placePage(O, pageOf("cilaos")!, null, NOW), agendaPage(O, null, NOW)]) {
      expect(html).not.toContain("maj%3D");
      expect(html).not.toMatch(/\?maj=\d/);
      const links = html.match(/<a href="https:\/\/(chatgpt\.com\/\?|claude\.ai\/new\?)[^>]*>/g)!;
      expect(links.length).toBeGreaterThanOrEqual(4);
      for (const a of links) expect(a).toMatch(/ rel="nofollow noopener" data-maj="https:\/\/rundata\.re\/[^"]*">$/);
    }
    expect(placePage(O, pageOf("cilaos")!, null, NOW)).toContain(`data-maj="${O}/meteo/cilaos"`);
  });

  it("date every page of the sitemap: today for the live ones", async () => {
    const map = await get("/sitemap.xml");
    const urls = map.match(/<url>.*?<\/url>/g)!;
    expect(urls.every((u) => /<lastmod>\d{4}-\d\d-\d\d<\/lastmod>/.test(u))).toBe(true);
    expect(map).toContain(`<loc>${O}/evenements</loc><lastmod>2026-10-24</lastmod><changefreq>hourly</changefreq>`);
    expect(map).toContain(`<loc>${O}/meteo/cilaos</loc><lastmod>2026-10-24</lastmod>`);
    expect(map).toContain(`<loc>${O}/randonnees/${RANDONNEES[0].slug}</loc><lastmod>${BUILT}</lastmod>`);
    expect(map).toMatch(new RegExp(`<loc>${O}/conditions</loc><lastmod>\\d{4}-\\d\\d-\\d\\d</lastmod><changefreq>monthly</changefreq>`));
    // Réunion time: 22:00 UTC is already the next day there.
    const late = await (await site(new Request(`${O}/sitemap.xml`), new Cache(new MemoryStore()), () => {}, new Date("2026-10-24T22:00:00Z")))!.text();
    expect(late).toContain(`<loc>${O}/</loc><lastmod>2026-10-25</lastmod>`);
  });

  it("see the query first in titles that fit in 60 characters", () => {
    expect(title(agendaPage(O, null, NOW))).toBe("Que faire à La Réunion ? Concerts, fêtes, sorties · 974");
    expect(title(traficPage(O, null, NOW))).toBe("Bouchons Réunion : carte Waze et état des routes · 974");
    expect(title(placePage(O, pageOf("cilaos")!, null, NOW))).toBe("Météo Cilaos en direct et prévisions · 974");
    expect(title(tracePage(O, "randonnee", "sentier-du-piton-des-neiges", "Sentier du Piton des Neiges", null, NOW))).toBe("Sentier du Piton des Neiges : trace GPX, état ONF · 974");
    expect(title(tracePage(O, "sentier", "x", "Sentier panoramique de Bois Rouge (ancien sentier Bassin Bleu)", null, NOW))).toBe("Sentier panoramique de Bois Rouge (ancien sentier Bassin Bleu) : trace GPX · 974");
    // The school year: from July, the one that starts in August.
    expect(title(calendrierPage(O, null, new Date("2027-03-01T04:00:00Z")))).toContain("2026-2027");
    expect(title(calendrierPage(O, null, new Date("2027-07-10T04:00:00Z")))).toContain("2027-2028");
    for (const html of [meteoPage(O, null, NOW), busPage(O, null, NOW), coupuresPage(O, null, NOW), daePage(O, null, NOW), historiquePage(O, null, NOW),
      ...PAGES.map((p) => placePage(O, p, null, NOW))]) {
      expect(title(html).length, title(html)).toBeLessThanOrEqual(60);
      expect(title(html)).toContain("974");
    }
  });
});

describe("events as schema.org Events", () => {
  it("give the date with Réunion's offset, the place, the commune and the status", () => {
    const [concert, ail, off, moved] = agendaEvents([
      row({ titre: "Olivier Ker Ourio", quand: "samedi 24/10 de 19:30 à 22:00", lieu: "Cité des Arts, Fanal", commune: "Saint-Denis" }),
      row({ titre: "Fête de l'ail", quand: "du vendredi 23/10 au dimanche 25/10", date: "2026-10-23", commune: "Petite-Île" }),
      row({ titre: "Kabar", commune: "Saint-Paul", statut: "ANNULÉ" }),
      row({ titre: "Bal", commune: "Le Port", statut: "REPORTÉ" }),
    ]) as any[];
    expect(concert).toEqual({
      "@type": "Event",
      name: "Olivier Ker Ourio",
      startDate: "2026-10-24T19:30:00+04:00",
      endDate: "2026-10-24T22:00:00+04:00",
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: { "@type": "Place", name: "Cité des Arts, Fanal", address: { "@type": "PostalAddress", addressLocality: "Saint-Denis", addressRegion: "La Réunion", addressCountry: "RE" } },
      url: "https://example.re/concert",
    });
    expect(ail).toMatchObject({ startDate: "2026-10-23", endDate: "2026-10-25", location: { name: "Petite-Île" } });
    expect(off.eventStatus).toBe("https://schema.org/EventCancelled");
    expect(moved.eventStatus).toBe("https://schema.org/EventPostponed");
    // Across the new year; and no end before the start.
    expect(agendaEvents([row({ quand: "du jeudi 31/12 au vendredi 01/01", date: "2026-12-31", commune: "Saint-Paul" })])[0]).toMatchObject({ endDate: "2027-01-01" });
  });

  it("leave out an event without a commune or a date, and are on the page", () => {
    expect(agendaEvents([row({}), row({ commune: "Saint-Paul", date: "bientôt" })])).toEqual([]);
    const d = { resume: "", nombre: 1, evenements: [row({ commune: "Saint-Paul" })], couverture: "", a_savoir: "", sources: [], ce_week_end: [] } as AgendaAnswer;
    const html = agendaPage(O, { value: d, fetchedAt: NOW } as any, NOW);
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
    expect(ld.map((x: { "@type"?: string }) => x["@type"])).toEqual(["BreadcrumbList", "WebPage", undefined]);
    expect(ld[2]).toMatchObject({ "@context": "https://schema.org", "@graph": [{ "@type": "Event", name: "Concert" }] });
    expect(agendaPage(O, null, NOW)).not.toContain("@graph");
  });
});

describe("link previews", () => {
  it("show each section's own picture, served from public/og/", () => {
    const img = (html: string) => html.match(/<meta property="og:image" content="([^"]+)">/)![1];
    const hikes = img(tracePage(O, "randonnee", "x", "Sentier", null, NOW));
    expect(hikes).toMatch(/^https:\/\/rundata\.re\/og\/randonnee\.[0-9a-f]{10}\.png$/);
    expect(existsSync(new URL(`../public${new URL(hikes).pathname}`, import.meta.url))).toBe(true);
    expect(img(placePage(O, pageOf("cilaos")!, null, NOW))).toMatch(/\/og\/meteo\./);
    expect(img(agendaPage(O, null, NOW))).toMatch(/\/og\/evenements\./);
    expect(img(homePage(O, null, NOW))).toMatch(/\/og\.png\?v=/);
    expect(agendaPage(O, null, NOW)).toMatch(/<meta name="twitter:image" content="https:\/\/rundata\.re\/og\/evenements\.[0-9a-f]{10}\.png">/);
  });
});

describe("headings", () => {
  it("keep the Mesure and Prévision badges out of the place pages' H2", () => {
    const html = placePage(O, pageOf("cilaos")!, null, NOW);
    for (const h2 of html.match(/<h2[^>]*>.*?<\/h2>/g)!) expect(h2).not.toContain("badge");
    expect(html).toContain('<div class="hb"><h2 id="h-now">Mesuré en ce moment près de Cilaos</h2><span class="badge m">Mesure</span></div>');
  });
});
