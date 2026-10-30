import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pdfLines } from "../src/pdf.js";
import * as carte from "../src/providers/vigilance-carte.js";
import * as mf from "../src/providers/vigilance.js";
import { carteHero, carteHtml, carteRoute, renduPage } from "../src/web/vigilance-carte.js";
import { CSS, CYCLONE_SCALE, vigilancePage } from "../src/web/pages.js";
import { site } from "../src/web/site.js";
import { Cache } from "../src/cache.js";
import { unzip, unzipBytes } from "../src/zip.js";
import { counted, SCHEDULED_BUDGET, scheduled } from "../src/budget.js";
import { configure as configureMf } from "../src/providers/mf-auth.js";
import { vigilanceMeteo } from "../src/tools/vigilance.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const ZIP = () => {
  const zip = fixture("vigilance_om.zip");
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
};
// The bulletin of 22/10/2026, issued at 16:02, as the vigilance's zip carried it.
let bulletin: Uint8Array<ArrayBuffer>;
beforeAll(async () => {
  bulletin = (await unzipBytes(ZIP(), (n) => n === mf.BULLETIN)).get(mf.BULLETIN)!;
});
const PDF = () => bulletin.slice();
const ISSUED = "2026-10-22T16:02:00+04:00";
const T0 = Date.parse("2026-10-22T12:10:00Z");
const MIN = 60_000;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).buffer;

/** KV in memory, with what was written. */
class FakeKv implements carte.Store {
  data = new Map<string, string | ArrayBuffer>();
  ttl = new Map<string, number | undefined>();
  async json(key: string) {
    const v = this.data.get(key);
    return typeof v === "string" ? JSON.parse(v) : null;
  }
  async bytes(key: string) {
    const v = this.data.get(key);
    return v instanceof ArrayBuffer ? v : null;
  }
  async put(key: string, value: string | ArrayBuffer, ttl?: number) {
    this.data.set(key, value);
    this.ttl.set(key, ttl);
  }
}

/** Cloudflare's browser: the options of each call, and what it answers. */
function fakeBrowser(answer: () => Response) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    quickAction: async (_action: "screenshot", options: Record<string, unknown>) => {
      calls.push(options);
      return answer();
    },
  };
}

afterEach(() => carte.configure());

describe("the bulletin's time of issue", () => {
  it("is read on page 1 of Météo-France's bulletin, at La Réunion's offset", async () => {
    const lines = await pdfLines(PDF().buffer);
    expect(carte.issued(lines, T0)).toBe(ISSUED);
  });

  it("is nothing on another page, or a week away from now", async () => {
    const lines = await pdfLines(PDF().buffer);
    expect(carte.issued(lines.filter((l) => !l.text.startsWith("Bulletin de suivi")), T0)).toBeUndefined();
    expect(carte.issued(lines, T0 + 8 * 86_400_000)).toBeUndefined();
    expect(carte.issued(lines, T0 - 2 * 86_400_000)).toBeUndefined();
  });
});

describe("the zip as bytes", () => {
  it("gives the same files as the text reader", async () => {
    const buf = ZIP();
    const wanted = (n: string) => n.endsWith("_FMEE_.txt");
    const text = await unzip(buf, wanted);
    const raw = await unzipBytes(buf, wanted);
    expect([...raw.keys()]).toEqual([...text.keys()]);
    for (const [name, body] of raw) expect(new TextDecoder().decode(body)).toBe(text.get(name));
  });
});

describe("the scheduled event's turn", () => {
  it("keeps a new bulletin, then has it photographed at the next event, once", async () => {
    const kv = new FakeKv();
    const browser = fakeBrowser(() => new Response(PNG, { headers: { "content-type": "image/png" } }));
    carte.configure(kv, browser);
    const empreinte = await carte.fingerprint(PDF());

    const first = await carte.passage(PDF(), T0);
    expect(first).toEqual({ bulletin: { emis: ISSUED, empreinte } });
    expect(kv.data.get(`vigilance:carte:pdf:${empreinte}`)).toBeInstanceOf(ArrayBuffer);
    expect(kv.ttl.get(`vigilance:carte:pdf:${empreinte}`)).toBe(30 * 86_400);
    // Not in the same event: KV may not have reached the browser's data center yet.
    expect(browser.calls).toHaveLength(0);

    const second = await carte.passage(PDF(), T0 + 5 * MIN);
    expect(second).toEqual({ bulletin: { emis: ISSUED, empreinte }, image: { emis: ISSUED, empreinte } });
    expect(browser.calls).toHaveLength(1);
    const etat = (await kv.json("vigilance:carte")) as carte.Etat;
    expect(browser.calls[0]).toMatchObject({ url: `https://rundata.re/vigilance/bulletin-rendu?j=${etat.bulletin!.jeton}`, selector: "#page1", viewport: { width: 1190, height: 1684 } });
    expect(etat.bulletin!.jeton).toMatch(/^[0-9a-f]{32}$/);
    expect(new Uint8Array(kv.data.get(`vigilance:carte:png:${empreinte}`) as ArrayBuffer)).toEqual(new Uint8Array(PNG));

    // The same bulletin again: nothing more is written, nothing photographed.
    const writes = kv.data.size;
    await carte.passage(PDF(), T0 + 10 * MIN);
    expect(browser.calls).toHaveLength(1);
    expect(kv.data.size).toBe(writes);
  });

  it("tries twice per bulletin, one try per event, then says it failed", async () => {
    const kv = new FakeKv();
    const browser = fakeBrowser(() => new Response("non", { status: 500 }));
    carte.configure(kv, browser);
    await carte.passage(PDF(), T0);
    expect((await carte.passage(undefined, T0 + 5 * MIN))?.image).toBeUndefined();
    expect(browser.calls).toHaveLength(1);
    await carte.passage(undefined, T0 + 10 * MIN);
    await carte.passage(undefined, T0 + 15 * MIN);
    expect(browser.calls).toHaveLength(2);
    const etat = (await kv.json("vigilance:carte")) as carte.Etat;
    expect(etat.echec).toMatchObject({ raison: "capture impossible" });
  });

  it("refuses an answer that is not a PNG", async () => {
    const kv = new FakeKv();
    carte.configure(kv, fakeBrowser(() => new Response("<html>", { headers: { "content-type": "text/html" } })));
    await carte.passage(PDF(), T0);
    expect((await carte.passage(undefined, T0 + 5 * MIN))?.image).toBeUndefined();
  });

  it("makes no more than 24 pictures a day", async () => {
    const kv = new FakeKv();
    const browser = fakeBrowser(() => new Response(PNG));
    carte.configure(kv, browser);
    await carte.passage(PDF(), T0);
    const etat = (await kv.json("vigilance:carte")) as carte.Etat;
    etat.jour = { date: "2026-10-22", n: 24 };
    await kv.put("vigilance:carte", JSON.stringify(etat));
    const seen = await carte.passage(undefined, T0 + 5 * MIN);
    expect(browser.calls).toHaveLength(0);
    expect(seen?.image).toBeUndefined();
    expect(((await kv.json("vigilance:carte")) as carte.Etat).echec).toMatchObject({ raison: "plafond du jour" });
  });

  it("keeps no map of a bulletin whose time of issue it cannot read, and says when it tried", async () => {
    const kv = new FakeKv();
    carte.configure(kv, fakeBrowser(() => new Response(PNG)));
    const seen = await carte.passage(new Uint8Array([37, 80, 68, 70, 45, 49]), T0);
    expect(seen).toEqual({ illisible: new Date(T0).toISOString() });
    expect([...kv.data.keys()]).toEqual(["vigilance:carte"]);
  });

  it("does nothing without KV, and no picture without the browser", async () => {
    expect(await carte.passage(PDF(), T0)).toBeUndefined();
    const kv = new FakeKv();
    carte.configure(kv);
    await carte.passage(PDF(), T0);
    expect((await carte.passage(undefined, T0 + 5 * MIN))?.image).toBeUndefined();
  });
});

describe("the map on /vigilance", () => {
  const b = { emis: ISSUED, empreinte: "0123456789abcdef" };
  const now = new Date("2026-10-22T13:30:00Z");

  it("is page 1 whole, with Météo-France's caption, the official link and the PDF", () => {
    const html = carteHtml({ bulletin: b, image: b }, now);
    expect(html).toContain(`<img src="/vigilance/carte/0123456789abcdef.png" width="595" height="842"`);
    expect(html).toContain(`alt="Première page du bulletin de suivi de la vigilance à La Réunion, publié par Météo-France le 22/10 à 16:02 (heure de La Réunion) : carte de l&#39;île colorée par zone, frise des 24 heures par phénomène, puis synthèse. Le niveau de chaque zone est écrit en texte sur cette page."`);
    expect(html).toContain(`<figcaption>Source : Météo-France. Bulletin de suivi vigilance à La Réunion, émis le 22/10 à 16:02 (heure de La Réunion). <a href="${mf.OFFICIEL_VIGILANCE}" rel="noopener">Consulter le site officiel de Météo-France</a></figcaption>`);
    // The picture opens Météo-France's site, never a page of ours.
    expect(html).toMatch(new RegExp(`<a href="${mf.OFFICIEL_VIGILANCE}" rel="noopener"><img `));
    expect(html).toContain(`<a href="/vigilance/bulletin/0123456789abcdef.pdf" type="application/pdf">Le bulletin complet de Météo-France en PDF, émis le 22/10 à 16:02</a>`);
  });

  it("is never an older bulletin's: the newest one's line and its PDF instead", () => {
    const html = carteHtml({ bulletin: b, image: { emis: "2026-10-22T10:00:00+04:00", empreinte: "fedcba9876543210" } }, now);
    expect(html).not.toContain("<img");
    expect(html).toContain(`La carte du dernier bulletin de Météo-France, émis le 22/10 à 16:02 (heure de La Réunion), n'a pas pu être affichée ici. <a href="${mf.OFFICIEL_VIGILANCE}" rel="noopener">Consulter le site officiel de Météo-France</a>`);
    expect(html).toContain(">Le bulletin complet de Météo-France en PDF, émis le 22/10 à 16:02</a>");
  });

  it("says when a bulletin could not be read, the time of the try, the day too when it is not today", () => {
    expect(carteHtml({ illisible: "2026-10-22T13:30:00.000Z" }, now)).toContain(`La carte officielle de Météo-France n'a pas pu être lue à 17:30. <a href="${mf.OFFICIEL_VIGILANCE}"`);
    const html = carteHtml({ bulletin: b, illisible: "2026-10-21T18:10:00.000Z" }, now);
    expect(html).toContain("n'a pas pu être lue le 21/10 à 22:10.");
    // The bulletin kept before the unreadable one has been replaced: no link to it.
    expect(html).not.toContain(".pdf");
    expect(carteHtml(undefined, now)).toBe("");
  });

  it("is beside the text on a wide screen, the same picture, caption, link and PDF; in the page on a phone; never both", () => {
    const hero = carteHero({ bulletin: b, image: b });
    expect(hero).toMatch(/^<figure class="card mapcard mf-carte mf-haut"><a href="[^"]+" rel="noopener"><img src="\/vigilance\/carte\/0123456789abcdef.png" width="595" height="842" loading="lazy"/);
    expect(hero.replace("card mapcard mf-carte mf-haut", "card mf-carte mf-bas")).toBe(carteHtml({ bulletin: b, image: b }, now));
    // Scaled down, never cut: a height at most, the width following; out of sight on a phone, the page's one on a wide screen.
    expect(CSS).toContain(".mf-haut{display:none}");
    expect(CSS).toContain(".intro .mf-haut img{display:block;width:auto;max-width:100%;height:auto;max-height:min(40rem,78vh);background:#fff}");
    expect(CSS).not.toMatch(/mf-haut[^{]*\{[^}]*object-fit/);
    expect(CSS).toMatch(/@media \(min-width:58rem\)\{\.intro \.mf-haut\{display:block[^@]*\.mf-bas\{display:none\}\}/);
    // No picture of the newest bulletin: nothing in the hero; the line saying why stays in the page.
    expect(carteHero({ bulletin: b, image: { emis: "2026-10-22T10:00:00+04:00", empreinte: "fedcba9876543210" } })).toBe("");
    expect(carteHero({ bulletin: b, illisible: "2026-10-21T18:10:00.000Z", image: b })).toBe("");
    expect(carteHero(undefined)).toBe("");
  });

  it("puts the hero's text in order: the vigilance in its badge, the line to /cyclones, the bulletin's time, the official link", () => {
    const v = (zones: mf.Vigilance["zones"], c?: carte.Carte): mf.Vigilance => ({ emise: "2026-10-22T12:02:00Z", zones, suivi: [], carte: c });
    const green = Object.fromEntries(["VIGI974-11", "VIGI974-12", "VIGI974-13", "VIGI974-14", "VIGI974-15"].map((z) => [z, { 12: [{ couleur: 1, debut: "2026-10-22T00:00:00Z" }], 1: [{ couleur: 1, debut: "2026-10-22T00:00:00Z" }] }]));
    const calm = vigilancePage("https://rundata.re", { value: v(green, { bulletin: b, image: b }), fetchedAt: now, stale: false }, now);
    const band = calm.slice(calm.indexOf('<div class="wrap intro'), calm.indexOf('id="h-zones"'));
    expect(band).toContain('<div class="wrap intro vhero">');
    const order = ['<p class="big vh vab vg1">Vigilance verte</p>', '<p class="vstate">Aucune vigilance particulière à La Réunion dans les 24 heures du bulletin.</p>',
      `<p class="cyc">Pas d'alerte cyclonique · <a href="/cyclones">Cyclones dans le bassin, alerte du préfet →</a></p>`,
      '<p class="note when">Bulletin de Météo-France émis le 22/10 16:02', `<p class="off"><b><a href="${mf.OFFICIEL_VIGILANCE}" rel="noopener">Consulter le site officiel de Météo-France</a></b></p>`, 'mf-haut'];
    const at = order.map((x) => band.indexOf(x));
    expect(at.every((i) => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(calm).toContain('class="card mf-carte mf-bas"');
    // Without an alert, the cyclones are one line to /cyclones: neither the scale of the alert nor the schools.
    expect(band).not.toContain("/ecoles-cyclone");
    expect(calm).not.toContain(CYCLONE_SCALE);
    // A cyclone alert in force: first, in its colour; then the vigilance above green, each in its badge.
    const storm = vigilancePage("https://rundata.re", { value: v({ ...green, VIGI974: { 10: [{ couleur: 4, debut: "2026-10-22T00:00:00Z" }] }, "VIGI974-12": { 12: [{ couleur: 3, debut: "2026-10-22T00:00:00Z" }], 1: [{ couleur: 1, debut: "2026-10-22T00:00:00Z" }] } }), fetchedAt: now, stale: false }, now);
    expect(storm).toContain('<p class="big vh vab vg4">Alerte cyclonique rouge</p>');
    expect(storm).toContain('<p class="vstate">Vigilances au-dessus du vert : <span class="vi"><span class="vg vg3">Vigilance orange</span> fortes pluies / orages (Est)</span></p>');
    expect(storm.indexOf("Alerte cyclonique rouge")).toBeLessThan(storm.indexOf("Vigilance orange"));
    expect(storm).toContain('<p class="cyc"><a href="/cyclones">Cyclones dans le bassin, alerte du préfet →</a></p>');
    expect(storm).toContain('<ul class="chips"><li><a href="/ecoles-cyclone">');
    expect(storm).not.toContain("Pas d'alerte cyclonique");
    expect(storm).not.toContain(CYCLONE_SCALE);
    // No map read: the text alone, as before.
    expect(storm).toContain('<div class="wrap intro solo">');
    expect(storm).not.toContain("mf-haut");
  });
});

describe("the map's addresses", () => {
  it("serves the picture and the PDF as kept, the newest PDF by its own address", async () => {
    const kv = new FakeKv();
    carte.configure(kv, fakeBrowser(() => new Response(PNG)));
    await carte.passage(PDF(), T0);
    await carte.passage(undefined, T0 + 5 * MIN);
    const e = await carte.fingerprint(PDF());
    const png = await carteRoute(`/vigilance/carte/${e}.png`, new URL("https://rundata.re"));
    expect(png?.headers.get("content-type")).toBe("image/png");
    expect(png?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const pdf = await carteRoute(`/vigilance/bulletin/${e}.pdf`, new URL("https://rundata.re"));
    expect(pdf?.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await pdf!.arrayBuffer())).toEqual(PDF());
    expect((await carteRoute("/vigilance/bulletin.pdf", new URL("https://rundata.re")))?.headers.get("location")).toBe(`/vigilance/bulletin/${e}.pdf`);
    expect((await carteRoute("/vigilance/carte/0000000000000000.png", new URL("https://rundata.re")))?.status).toBe(404);
    expect(await carteRoute(`/vigilance/carte/${e}.pdf`, new URL("https://rundata.re"))).toBeNull();
    // A newer bulletin whose time of issue could not be read: the newest PDF is Météo-France's site.
    await carte.passage(new Uint8Array([37, 80, 68, 70, 45, 49]), T0 + 10 * MIN);
    expect((await carteRoute("/vigilance/bulletin.pdf", new URL("https://rundata.re")))?.headers.get("location")).toBe(mf.OFFICIEL_VIGILANCE);
  });

  it("opens the browser's page with the bulletin's token only, never indexed", async () => {
    const kv = new FakeKv();
    carte.configure(kv);
    await carte.passage(PDF(), T0);
    const { jeton, empreinte } = ((await kv.json("vigilance:carte")) as carte.Etat).bulletin!;
    const page = await carteRoute(carte.RENDU_PATH, new URL(`https://rundata.re${carte.RENDU_PATH}?j=${jeton}`));
    expect(page?.status).toBe(200);
    expect(page?.headers.get("x-robots-tag")).toBe("noindex");
    const html = await page!.text();
    expect(html).toContain(`url: "/vigilance/bulletin/${empreinte}.pdf"`);
    expect(html).toContain('import { getDocument, GlobalWorkerOptions } from "/pdfjs/4.10.38/pdf.min.mjs"');
    for (const j of ["", "?j=0", `?j=${jeton.slice(1)}`]) {
      expect((await carteRoute(carte.RENDU_PATH, new URL(`https://rundata.re${carte.RENDU_PATH}${j}`)))?.status).toBe(404);
    }
    expect(renduPage(empreinte)).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it("keeps robots away from the browser's page, and it is in no sitemap", async () => {
    const cache = new Cache();
    const background = { waitUntil: () => {} } as never;
    const robots = await (await site(new Request("https://rundata.re/robots.txt"), cache, background))!.text();
    expect(robots.match(/Disallow: \/vigilance\/bulletin-rendu\n/g)).toHaveLength(2);
    const sitemap = await (await site(new Request("https://rundata.re/sitemap.xml"), cache, background))!.text();
    expect(sitemap).not.toContain("bulletin");
  });

  it("ships pdf.js 4.10.38 whole, with its licence, kept a year by browsers and never indexed", () => {
    for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs", "LICENSE"]) expect(readFileSync(new URL(`../public/pdfjs/4.10.38/${f}`, import.meta.url)).length).toBeGreaterThan(10_000);
    expect(readFileSync(new URL("../public/_headers", import.meta.url), "utf8")).toContain("/pdfjs/*\n  Cache-Control: public, max-age=31536000, immutable\n  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex\n");
  });
});

describe("the vigilance's copy, built by the scheduled event", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    configureMf({});
  });

  it("carries the map, which /vigilance and vigilance_meteo show", async () => {
    configureMf({ applicationId: "test" });
    vi.stubGlobal("fetch", async (url: string) => (String(url).includes("/token") ? Response.json({ access_token: "t", expires_in: 3600 }) : new Response(ZIP())));
    const kv = new FakeKv();
    carte.configure(kv, fakeBrowser(() => new Response(PNG)));
    const e = await carte.fingerprint(PDF());
    // Two events, 5 minutes apart: the bulletin kept, then photographed. Read outside an event, the copy has the state.
    const event = () => counted(SCHEDULED_BUDGET, async () => (scheduled(), mf.read()));
    vi.useFakeTimers({ now: T0, toFake: ["Date"] });
    try {
      expect((await event()).value.carte).toEqual({ bulletin: { emis: ISSUED, empreinte: e } });
      vi.setSystemTime(T0 + 5 * MIN);
      expect((await event()).value.carte).toEqual({ bulletin: { emis: ISSUED, empreinte: e }, image: { emis: ISSUED, empreinte: e } });
      expect((await mf.read()).carte).toEqual({ bulletin: { emis: ISSUED, empreinte: e }, image: { emis: ISSUED, empreinte: e } });
      const cache = new Cache();
      const answer = JSON.parse((await vigilanceMeteo(cache, undefined, new Date(T0 + 5 * MIN))).content[0].text);
      expect(answer.carte_officielle).toEqual({
        emise: answer.carte_officielle.emise,
        image: `https://rundata.re/vigilance/carte/${e}.png`,
        pdf: `https://rundata.re/vigilance/bulletin/${e}.pdf`,
        source: "Météo-France",
        officiel: "Consulter le site officiel de Météo-France : https://vigilance.meteofrance.fr/fr/la-reunion",
      });
      expect(answer.carte_officielle.emise).toMatch(/16:02 heure de La Réunion$/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the licence", () => {
  it("says the agreement, in marketing's words", () => {
    expect(mf.SOURCE.licence).toBe("Licence Ouverte Etalab 2.0 ; Météo-France La Réunion : bulletin de suivi vigilance affiché tel quel, avec son accord écrit du 27/10/2026");
  });
});
