import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { RANDONNEES } from "../src/providers/traces.js";
import type { AgendaAnswer } from "../src/web/data.js";
import { agendaEvents, eventSummary, agendaPage, busPage, calendrierPage, coupuresPage, cyclonesPage, daePage, historiquePage, sportPage, tracePage, traficPage } from "../src/web/domains.js";
import { feuxPage } from "../src/web/feux.js";
import { homePage } from "../src/web/home.js";
import og from "../src/web/og.json" with { type: "json" };
import rubriques from "../src/web/og-rubriques.json" with { type: "json" };
import { meteoPage, placePage } from "../src/web/pages.js";
import { pageOf, PAGES } from "../src/web/places.js";
import { site } from "../src/web/site.js";
import { BUILT as DAE_BUILT } from "../src/providers/dae.js";

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
    // Nor the searches for a stop: a page per query typed, each stop has its own.
    // Nor a trip: an address per stop and per day, not indexed.
    expect(groups[0]).toBe("User-agent: Googlebot\nUser-agent: GoogleOther\nUser-agent: Bingbot\nDisallow: /*?maj=\nDisallow: /bus/arret?q=\nDisallow: /bus/trajet/\nDisallow: /vigilance/bulletin-rendu\nAllow: /");
    expect(groups[1]).toBe("User-agent: *\nDisallow: /bus/arret?q=\nDisallow: /bus/trajet/\nDisallow: /vigilance/bulletin-rendu\nAllow: /");
    expect(robots).toContain(`Sitemap: ${O}/sitemap.xml`);
  });

  it("follow a stop's page, and not the trips it links", async () => {
    const robots = await get("/robots.txt");
    // A rule's path matches from the start of the address, `*` matching anything (RFC 9309).
    const rules = (group: string) => group.split("\n").filter((l) => l.startsWith("Disallow: ")).map((l) => new RegExp(`^${l.slice(10).replace(/[\\^$.|?+()[\]{}]/g, "\\$&").replace(/\*/g, ".*")}`));
    const blocked = (group: string, path: string) => rules(group).some((r) => r.test(path));
    for (const group of robots.split("\n\n").slice(0, 2)) {
      expect(blocked(group, "/bus/arret/gare-routiere-de-saint-denis")).toBe(false);
      expect(blocked(group, "/bus/arret")).toBe(false);
      expect(blocked(group, "/bus/trajet/carjaune/767/5-33685532?jour=20261026&arret=12")).toBe(true);
      expect(blocked(group, "/bus/arret?q=gare")).toBe(true);
      // The page Cloudflare's browser draws Météo-France's bulletin on (web/vigilance-carte.ts), not /vigilance.
      expect(blocked(group, "/vigilance/bulletin-rendu?j=0123")).toBe(true);
      expect(blocked(group, "/vigilance")).toBe(false);
    }
  });

  it("find no ?maj= address in the pages: the time is added on the click, to a link they do not follow", () => {
    for (const html of [homePage(O, null, NOW), meteoPage(O, null, NOW), placePage(O, pageOf("cilaos")!, null, NOW), agendaPage(O, null, NOW)]) {
      expect(html).not.toContain("maj%3D");
      expect(html).not.toMatch(/\?maj=\d/);
      const links = html.match(/<a href="https:\/\/(chatgpt\.com\/\?|claude\.ai\/new\?)[^>]*>/g)!;
      expect(links.length).toBeGreaterThanOrEqual(4);
      // ChatGPT's also copy the question on a phone (chatgpt-copie.test.ts).
      for (const a of links) expect(a).toMatch(/ rel="nofollow noopener" data-maj="https:\/\/rundata\.re\/[^"]*"( data-copie="" data-ok="[^"]*" data-non="[^"]*")?>$/);
    }
    expect(placePage(O, pageOf("cilaos")!, null, NOW)).toContain(`data-maj="${O}/meteo/cilaos"`);
  });

  it("date a page of the sitemap only with the day its content really changed", async () => {
    const map = await get("/sitemap.xml");
    // A live page changes all day, a trail when the ONF changes its state: no day would be exact.
    expect(map).toContain(`<loc>${O}/evenements</loc><changefreq>hourly</changefreq>`);
    expect(map).toContain(`<loc>${O}/meteo/cilaos</loc><changefreq>hourly</changefreq>`);
    expect(map).toContain(`<loc>${O}/randonnees/${RANDONNEES[0].slug}</loc><changefreq>daily</changefreq>`);
    expect(map).toContain(`<loc>${O}/conditions</loc><changefreq>monthly</changefreq>`);
    // A list bundled with the server: the day it was rebuilt; the latest change for /nouveautes.
    expect(map).toContain(`<loc>${O}/defibrillateurs</loc><lastmod>${DAE_BUILT}</lastmod><changefreq>monthly</changefreq>`);
    expect(map).toMatch(new RegExp(`<loc>${O}/nouveautes</loc><lastmod>\\d{4}-\\d\\d-\\d\\d</lastmod>`));
    expect(map.match(/<lastmod>/g)).toHaveLength(2);
  });

  it("see the query first in titles that fit in 60 characters", () => {
    expect(title(agendaPage(O, null, NOW))).toBe("Que faire à La Réunion ? Concerts, fêtes, sorties · 974");
    expect(title(busPage(O, null, NOW))).toBe("Horaires bus Réunion : prochains départs en gare · 974");
    expect(title(daePage(O, null, NOW))).toBe("Défibrillateurs Réunion : où trouver un DAE · 974");
    expect(title(traficPage(O, null, NOW))).toBe("Info trafic Réunion : bouchons, routes, bus en direct · 974");
    expect(title(placePage(O, pageOf("cilaos")!, null, NOW))).toBe("Météo Cilaos en direct et prévisions · 974");
    // The sector first (§8), then « état ONF » when the name leaves room.
    expect(title(tracePage(O, "randonnee", "sentier-du-piton-des-neiges", "Sentier du Piton des Neiges", null, NOW))).toBe("Sentier du Piton des Neiges (Cilaos) : trace GPX · 974");
    expect(title(tracePage(O, "randonnee", "pr25", "PR25", null, NOW))).toBe("PR25 (Mafate) : trace GPX, état ONF · 974");
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
      // No summary from the source: what and where.
      description: "Concert à Saint-Denis, Cité des Arts, Fanal.",
    });
    expect(ail).toMatchObject({ startDate: "2026-10-23", endDate: "2026-10-25", location: { name: "Petite-Île" } });
    expect(off.eventStatus).toBe("https://schema.org/EventCancelled");
    expect(moved.eventStatus).toBe("https://schema.org/EventPostponed");
    // The source's summary when it gives one, cut at a word; the genre when it does not.
    expect(eventSummary(row({ commune: "Saint-Paul", genres: ["concert"], lieu: "Kabardock" }))).toBe("Concert à Saint-Paul, Kabardock.");
    const long = eventSummary(row({ commune: "Saint-Paul", description: `Un concert   de maloya ${"très ".repeat(80)}long.` }));
    expect(long.startsWith("Un concert de maloya très")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(301);
    expect(long.endsWith("très…")).toBe(true);
    // Across the new year; and no end before the start.
    expect(agendaEvents([row({ quand: "du jeudi 31/12 au vendredi 01/01", date: "2026-12-31", commune: "Saint-Paul" })])[0]).toMatchObject({ endDate: "2027-01-01" });
  });

  it("name the organizer only when the event comes from the venue's own programme, never the town hall relaying it", () => {
    const [hall, mairie] = agendaEvents([
      row({ commune: "Saint-Leu", lieu: "Le Séchoir", publie_par: "Le Séchoir" }),
      row({ commune: "Saint-Leu", lieu: "Le Séchoir", publie_par: "Agenda de la mairie de Saint-Leu" }),
    ]) as any[];
    expect(hall.organizer).toEqual({ "@type": "Organization", name: "Le Séchoir" });
    expect(mairie).not.toHaveProperty("organizer");
    // No picture of rundata.re's own in place of the event's.
    expect(hall).not.toHaveProperty("image");
  });

  it("give the price, OpenAgenda's picture and the organisers as their source gives them, nothing guessed", () => {
    const [paid, pictured, named, many, bare] = agendaEvents([
      row({ commune: "Saint-Leu", prix: "10€ à 14€", lien: "https://www.lesechoir.com/evenement/x/" }),
      row({ commune: "Saint-Denis", publie_par: "Office de tourisme du Nord", image: { url: "https://img.openagenda.com/main/abc.base.image.jpg", auteur: "OTI NORD" } }),
      row({ commune: "Saint-Paul", publie_par: "Mairie de Saint-Paul", organise_par: ["Association Lèv la tèt"] }),
      row({ commune: "Saint-Leu", publie_par: "Le Séchoir", organise_par: ["Le Séchoir", "Cie Bivouac"] }),
      row({ commune: "Saint-Paul", publie_par: "Mairie de Saint-Paul" }),
    ]) as any[];
    // A range is not one amount: no Offer, rather than one without its price.
    expect(paid).not.toHaveProperty("offers");
    expect(pictured.image).toEqual({
      "@type": "ImageObject",
      url: "https://img.openagenda.com/main/abc.base.image.jpg",
      author: { "@type": "Organization", name: "OTI NORD" },
      creator: { "@type": "Organization", name: "OTI NORD" },
      creditText: "OTI NORD",
      license: "https://www.data.gouv.fr/pages/legal/licences/etalab-2.0/",
    });
    // The organiser the site names, even on a town hall's agenda; never the town hall in its place.
    expect(named.organizer).toEqual({ "@type": "Organization", name: "Association Lèv la tèt" });
    expect(many.organizer).toEqual([{ "@type": "Organization", name: "Le Séchoir" }, { "@type": "Organization", name: "Cie Bivouac" }]);
    for (const k of ["organizer", "offers", "image", "performer", "endDate"]) expect(bare, k).not.toHaveProperty(k);
    // A condition of entry is not a price: no Offer. One amount, or « gratuit », is one, with its currency; several, none.
    const offers = (prix: string) => (agendaEvents([row({ commune: "Saint-Denis", prix })])[0] as any).offers;
    expect(offers("Sur inscription")).toBeUndefined();
    expect(offers("Gratuit")).toMatchObject({ "@type": "Offer", price: 0, priceCurrency: "EUR" });
    expect(offers("12,50 €")).toMatchObject({ "@type": "Offer", price: 12.5, priceCurrency: "EUR" });
    expect(offers("Gratuit")).not.toHaveProperty("description");
    expect(offers("Tarif plein : 5€ | Tarif réduit : 3€")).toBeUndefined();
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
    expect(img(daePage(O, null, NOW))).toMatch(/\/og\/defibrillateurs\./);
    expect(img(calendrierPage(O, null, NOW))).toMatch(/\/og\/calendrier\./);
    expect(img(cyclonesPage(O, null, NOW))).toMatch(/\/og\/cyclones\./);
    expect(img(sportPage(O, null, NOW))).toMatch(/\/og\/sport\./);
    // The island alone, no fire on it: Facebook and WhatsApp keep the picture for days, fire or not.
    expect(img(feuxPage(O, { fires: null }, NOW))).toMatch(/\/og\/feux\./);
    expect(img(homePage(O, null, NOW))).toMatch(/\/og\.png\?v=/);
    expect(agendaPage(O, null, NOW)).toMatch(/<meta name="twitter:image" content="https:\/\/rundata\.re\/og\/evenements\.[0-9a-f]{10}\.png">/);
  });

  it("have every picture they name in public/og/, /enfants's ready for its page", () => {
    for (const r of rubriques) expect(existsSync(new URL(`../public${r.png}`, import.meta.url)), r.png).toBe(true);
    expect(rubriques.find((r) => r.pages.includes("/enfants"))).toMatchObject({ png: expect.stringMatching(/^\/og\/enfants\.[0-9a-f]{10}\.png$/), alt: expect.stringContaining("Enfants 974") });
  });

  it("have a 4:5 picture for the posts on Instagram, beside each, that no page links", () => {
    // The home page's, from its share picture.
    for (const r of [...rubriques, { png: "/og/accueil.png", png_4x5: og.png_4x5 }]) {
      const key = r.png.slice("/og/".length).split(".")[0];
      expect(r.png_4x5).toMatch(new RegExp(`^/og/${key}-4x5\\.[0-9a-f]{10}\\.png$`));
      // Width and height, in the PNG's header.
      const png = readFileSync(new URL(`../public${r.png_4x5}`, import.meta.url));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], r.png_4x5).toEqual([1080, 1350]);
    }
    for (const html of [agendaPage(O, null, NOW), cyclonesPage(O, null, NOW), daePage(O, null, NOW), homePage(O, null, NOW)]) expect(html).not.toContain("-4x5");
  });
});

describe("headings", () => {
  it("keep the Mesure and Prévision badges out of the place pages' H2", () => {
    const html = placePage(O, pageOf("cilaos")!, null, NOW);
    for (const h2 of html.match(/<h2[^>]*>.*?<\/h2>/g)!) expect(h2).not.toContain("badge");
    expect(html).toContain('<div class="hb"><h2 id="h-now">Mesuré en ce moment près de Cilaos</h2><span class="badge m">Mesure</span></div>');
  });
});
