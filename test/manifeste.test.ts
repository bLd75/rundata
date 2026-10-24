import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { Cache, MemoryStore } from "../src/cache.js";
import { follow, hook, placePage, SOCIAL, type Social } from "../src/web/pages.js";
import { homePage } from "../src/web/home.js";
import { pressePage } from "../src/web/presse.js";
import { pageOf } from "../src/web/places.js";
import { manifest, site } from "../src/web/site.js";
import { sentiersPage } from "../src/web/domains.js";

const NOW = new Date("2026-10-24T04:00:00Z");
const O = "https://rundata.re";

describe("on a phone's home screen", () => {
  it("has a manifest that opens the home page counted apart, with the flag's icons", async () => {
    const m = manifest();
    expect(m).toMatchObject({ name: "rundata.re", start_url: "/?ref=pwa", display: "standalone", lang: "fr" });
    for (const i of m.icons.filter((x) => x.type === "image/png")) expect(existsSync(new URL(`../public${i.src}`, import.meta.url))).toBe(true);
    const r = await site(new Request(`${O}/manifest.webmanifest`), new Cache(new MemoryStore(), () => NOW.getTime()), () => {}, NOW);
    expect(r!.headers.get("content-type")).toBe("application/manifest+json; charset=utf-8");
    expect(JSON.parse(await r!.text()).start_url).toBe("/?ref=pwa");
  });

  it("is linked from every page, with the icon iOS asks for", () => {
    const html = placePage(O, pageOf("cilaos")!, null, NOW);
    expect(html).toContain(`<link rel="manifest" href="/manifest.webmanifest">`);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/icons\/flag-180\.[0-9a-f]{10}\.png">/);
  });
});

describe("each page's hook", () => {
  it("says what the page is good for, right under its title", () => {
    expect(hook("/sentiers")).toBe("Avant de partir : les sentiers fermés ce matin par l'ONF, et pourquoi.");
    expect(hook("/coupures-eau")).toBe("Coupure d'eau ou eau à ne pas boire : les avis en cours des distributeurs.");
    expect(hook("/evenements/concerts")).toBe(hook("/evenements"));
    expect(hook("/meteo/cilaos")).toBe(hook("/meteo"));
    // A trail's page is about its trace, not the day's list.
    expect(hook("/sentiers/le-bloc-piton-des-neiges")).toBe("La trace à télécharger et l'état du sentier ce matin, avant de partir.");
    expect(hook("/randonnees/gr-r2")).toBe(hook("/sentiers/le-bloc-piton-des-neiges"));
    expect(hook("/presse")).toBeUndefined();
    expect(sentiersPage(O, null, NOW)).toMatch(/<\/h1>\s*<p class="hook">Avant de partir : les sentiers fermés ce matin par l&#39;ONF, et pourquoi\.<\/p>/);
  });
});

describe("sharing and following", () => {
  it("puts a WhatsApp link with the page's title and ?ref=wa, and the Facebook Page, above the feedback form", () => {
    const html = placePage(O, pageOf("cilaos")!, null, NOW);
    const text = "Météo Cilaos en direct et prévisions : https://rundata.re/meteo/cilaos?ref=wa";
    expect(html).toContain(`<a class="sh wa" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Partager sur WhatsApp`);
    expect(html).toContain(`suivez rundata.re sur <a href="https://www.facebook.com/1432704299917309?ref=site" rel="noopener">Facebook</a> ou <a href="https://www.instagram.com/rundata.re/?ref=site" rel="noopener">Instagram</a>.`);
    expect(html.indexOf('class="share wrap"')).toBeLessThan(html.indexOf('id="avis"'));
  });
});

describe("rundata.re's accounts", () => {
  const facebook = SOCIAL.find((s) => s.nom === "Facebook")!;

  it("are in every footer, with their logo, their name and ?ref=site", () => {
    const html = placePage(O, pageOf("cilaos")!, null, NOW);
    const foot = html.slice(html.indexOf('<footer class="foot">'));
    expect(foot).toContain(`<p class="social">Suivre rundata.re : <a href="https://www.facebook.com/1432704299917309?ref=site" rel="noopener" aria-label="rundata.re sur Facebook"><svg`);
    expect(foot).toContain(`<a href="https://www.instagram.com/rundata.re/?ref=site" rel="noopener" aria-label="rundata.re sur Instagram"><svg`);
    expect(foot).toMatch(/<\/svg>Facebook<\/a><a [^>]+><svg[^]*?<\/svg>Instagram<\/a><\/p>/);
  });

  it("show nothing for an account without an address", () => {
    const later: Social = { nom: "Instagram", url: "", svg: "<svg></svg>" };
    expect(follow([later])).toBe("");
    expect(follow([facebook, later])).not.toContain("Instagram");
    expect(follow([facebook, { ...later, url: "https://www.instagram.com/essai" }])).toContain(`<a href="https://www.instagram.com/essai?ref=site" rel="noopener" aria-label="rundata.re sur Instagram"><svg></svg>Instagram</a>`);
  });

  it("are the home page's sameAs, and listed on /presse", () => {
    const page = homePage(O, null, NOW);
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
    const org = ld.find((x: { "@type": string }) => x["@type"] === "Organization");
    expect(org.sameAs.slice(0, 2)).toEqual(["https://www.facebook.com/1432704299917309", "https://www.instagram.com/rundata.re/"]);
    expect(org.sameAs).toHaveLength(SOCIAL.filter((s) => s.url).length + 3);
    const presse = pressePage(O, []);
    expect(presse.slice(0, presse.indexOf("<main")).match(/<p class="social">/g)).toHaveLength(1);
  });
});
