import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import * as cmrs from "../src/providers/cmrs-carte.js";
import { SOURCE as GDACS } from "../src/providers/cyclones.js";
import type { Store } from "../src/providers/vigilance-carte.js";
import { carteOfficielle, cyclones } from "../src/tools/cyclones.js";
import { carteHtml, carteRoute } from "../src/web/cmrs-carte.js";
import { buildCyclones } from "../src/web/data.js";
import { cyclonesPage } from "../src/web/domains.js";

// Météo-France's list of the RSMC's bulletins as read on 27/10/2026 (AGUEDA's, the newest of 23/10/2026 at 13:06 UTC),
// and its forecast track map as web.archive.org kept it on 02/01/2026 (GRANT, written at 12:44:09 UTC): to test the
// reading and the page, never to publish. GDACS as in test/cyclones.test.ts: FYTIA active on 03/02/2026.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const LISTE = () => fixture("cmrs/liste.html");
const IMAGE = () => {
  const b = fixture("cmrs/trajectoire_2026-01-02.png");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const GDACS_FILE = (url: string) => {
  if (url.includes("geteventlist")) return url.includes("pagenumber=2") ? "cyclones/liste_page2.json" : "cyclones/liste_page1.json";
  if (url.includes("getepisodedata") && url.includes("eventid=1001254")) return "cyclones/episode_fytia.json";
  if (url.includes("gettimeline?id=732239")) return "cyclones/timeline_fytia.json";
};
// FYTIA's day, at the minutes the scheduled event reads the list (15) and the image (20).
const LIST_AT = new Date("2026-02-03T08:15:00Z");
const IMAGE_AT = new Date("2026-02-03T08:20:00Z");
const OCTOBER = new Date("2026-10-24T06:15:00Z");
const liste = (...names: string[]) => names.map((n) => `<a onclick="window.open('./CMRSF_${n}.pdf','CMRS')">x</a>`).join("\n");

class FakeKv implements Store {
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

/** Météo-France and GDACS: what each address answers, and the addresses asked. */
function stubFetch(meteo: { liste?: () => Response; image?: () => Response }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string | Request) => {
    const u = typeof url === "string" ? url : url.url;
    calls.push(u);
    if (u === cmrs.LISTE_URL) return meteo.liste?.() ?? new Response("", { status: 503 });
    if (u === cmrs.IMAGE_URL) return meteo.image?.() ?? new Response("", { status: 503 });
    const f = GDACS_FILE(u);
    return f ? new Response(fixture(f)) : new Response("", { status: 503 });
  });
  return calls;
}
const png = (lastModified?: string) => () => new Response(IMAGE(), { headers: lastModified ? { "last-modified": lastModified } : {} });
const html = (s: string | Buffer) => () => new Response(s);
const cache = (now: Date) => new Cache(new MemoryStore(), () => now.getTime());

let kv: FakeKv;
beforeEach(() => {
  kv = new FakeKv();
  cmrs.configure(kv);
});
afterEach(() => {
  cmrs.configure();
  vi.unstubAllGlobals();
});

describe("the RSMC's list and image, read", () => {
  it("gives the two newest bulletins of Météo-France's list, in UTC", () => {
    expect(cmrs.newest(LISTE().toString("latin1"))).toEqual({ dernier: "2026-10-23T13:06:00.000Z", precedent: "2026-10-23T07:25:00.000Z" });
    expect(cmrs.newest(liste("202602030722"))).toEqual({ dernier: "2026-02-03T07:22:00.000Z" });
    expect(cmrs.newest("<p>rien</p>")).toBeUndefined();
    // Not a date: left out.
    expect(cmrs.newest(liste("202602300722", "202602031399"))).toBeUndefined();
  });

  it("reads a PNG's size from its header, and nothing of another file", () => {
    expect(cmrs.pngSize(new Uint8Array(IMAGE()))).toEqual({ largeur: 760, hauteur: 1122 });
    expect(cmrs.pngSize(new TextEncoder().encode("<html>introuvable</html>"))).toBeUndefined();
  });

  it("reads the list at 15 and 45 past the hour, the image at 20 and 50, nothing else", () => {
    const at = (m: number) => cmrs.due(new Date(Date.UTC(2026, 1, 3, 8, m)));
    expect([0, 15, 20, 45, 50, 55, 17].map(at)).toEqual([undefined, "liste", "image", "liste", "image", undefined, "liste"]);
  });
});

describe("the guard: the image follows the newest bulletin", () => {
  const image = (modifiee: string | undefined, depuis: string) => ({ empreinte: "a".repeat(16), largeur: 760, hauteur: 1122, ...(modifiee && { modifiee }), depuis, lue: depuis });
  const avis = { dernier: "2026-01-02T13:06:00.000Z", precedent: "2026-01-02T07:25:00.000Z" };

  it("passes a map written after the bulletin before the newest, as the RSMC writes it before its own bulletin", () => {
    // GRANT's map, written at 12:44:09 UTC, before the bulletin of its cycle.
    expect(cmrs.suit({ avis, image: image("2026-01-02T12:44:09.000Z", "2026-01-02T12:50:00.000Z") })).toBe(true);
    // A map written after the newest bulletin, less than 6 hours after it.
    expect(cmrs.suit({ avis, image: image("2026-01-02T18:40:00.000Z", "2026-01-02T18:50:00.000Z") })).toBe(true);
  });

  it("holds back an older map, one more than 6 hours after the newest bulletin, and one without its time", () => {
    expect(cmrs.suit({ avis, image: image("2026-01-02T06:44:00.000Z", "2026-01-02T12:50:00.000Z") })).toBe(false);
    expect(cmrs.suit({ avis, image: image("2026-01-02T19:07:00.000Z", "2026-01-02T19:20:00.000Z") })).toBe(false);
    expect(cmrs.suit({ avis, image: image(undefined, "2026-01-02T12:50:00.000Z") })).toBe(false);
    expect(cmrs.suit({ image: image("2026-01-02T12:44:09.000Z", "2026-01-02T12:50:00.000Z") })).toBe(false);
  });

  it("holds back a map read the same before the bulletin before the newest, whatever its server says of it", () => {
    // A server that says « written now » for an image that has not changed.
    expect(cmrs.suit({ avis, image: image("2026-01-02T12:44:09.000Z", "2026-01-02T06:50:00.000Z") })).toBe(false);
  });

  it("with one bulletin only, takes it for both", () => {
    const one = { dernier: "2026-01-02T13:06:00.000Z" };
    expect(cmrs.suit({ avis: one, image: image("2026-01-02T12:44:09.000Z", "2026-01-02T12:50:00.000Z") })).toBe(false);
    expect(cmrs.suit({ avis: one, image: image("2026-01-02T13:10:00.000Z", "2026-01-02T13:20:00.000Z") })).toBe(true);
  });
});

describe("the scheduled event's turn", () => {
  it("reads nothing of Météo-France without an active system", async () => {
    const calls = stubFetch({ liste: html(LISTE()) });
    expect(await cmrs.passage(cache(OCTOBER), OCTOBER)).toBe("aucun système actif");
    expect(calls.some((u) => u.includes("meteo.fr"))).toBe(false);
    expect(kv.data.size).toBe(0);
  });

  it("reads nothing outside its minutes, nor without KV", async () => {
    const calls = stubFetch({ liste: html(LISTE()) });
    expect(await cmrs.passage(cache(LIST_AT), new Date("2026-02-03T08:10:00Z"))).toBe("rien à lire");
    cmrs.configure();
    expect(await cmrs.passage(cache(LIST_AT), LIST_AT)).toBe("rien à lire");
    expect(calls).toEqual([]);
  });

  it("reads the list, then the image, one request to Météo-France each, and keeps the image under its fingerprint", async () => {
    const c = cache(LIST_AT);
    const calls = stubFetch({ liste: html(liste("202602030722", "202602030020")), image: png("Tue, 03 Feb 2026 06:58:00 GMT") });
    expect(await cmrs.passage(c, LIST_AT)).toBe("dernier bulletin 2026-02-03T07:22:00.000Z");
    expect(await cmrs.passage(c, IMAGE_AT)).toMatch(/^image [0-9a-f]{16} \(nouvelle\)$/);
    expect(calls.filter((u) => u.includes("meteo.fr"))).toEqual([cmrs.LISTE_URL, cmrs.IMAGE_URL]);
    const etat = JSON.parse(kv.data.get("cmrs:carte") as string) as cmrs.Etat;
    expect(etat).toMatchObject({
      avis: { dernier: "2026-02-03T07:22:00.000Z", precedent: "2026-02-03T00:20:00.000Z" },
      image: { largeur: 760, hauteur: 1122, modifiee: "2026-02-03T06:58:00.000Z", depuis: IMAGE_AT.toISOString(), lue: IMAGE_AT.toISOString() },
    });
    const kept = kv.data.get(`cmrs:carte:png:${etat.image!.empreinte}`) as ArrayBuffer;
    expect(Buffer.from(kept).equals(Buffer.from(IMAGE()))).toBe(true);
    expect(kv.ttl.get(`cmrs:carte:png:${etat.image!.empreinte}`)).toBe(30 * 86_400);
    expect(await cmrs.kept()).toEqual({ image: { empreinte: etat.image!.empreinte, largeur: 760, hauteur: 1122, lue: IMAGE_AT.toISOString() } });

    // The same image 30 minutes later: read again, not written again; first read kept.
    const later = new Date("2026-02-03T08:50:00Z");
    expect(await cmrs.passage(c, later)).toBe(`image ${etat.image!.empreinte}`);
    const again = JSON.parse(kv.data.get("cmrs:carte") as string) as cmrs.Etat;
    expect(again.image).toMatchObject({ depuis: IMAGE_AT.toISOString(), lue: later.toISOString() });
    expect([...kv.data.keys()].filter((k) => k.includes(":png:"))).toHaveLength(1);
  });

  it("keeps the last image when Météo-France does not answer, and says since when", async () => {
    const c = cache(LIST_AT);
    stubFetch({ liste: html(liste("202602030722", "202602030020")), image: png("Tue, 03 Feb 2026 06:58:00 GMT") });
    await cmrs.passage(c, LIST_AT);
    await cmrs.passage(c, IMAGE_AT);
    stubFetch({});
    expect(await cmrs.passage(c, new Date("2026-02-03T08:50:00Z"))).toBe("image sans réponse");
    expect(await cmrs.kept()).toMatchObject({ image: { lue: IMAGE_AT.toISOString() }, sans_reponse: true });
  });

  it("shows no image when the answer is not a PNG, nor when nothing was ever read", async () => {
    stubFetch({ liste: html(liste("202602030722")), image: html("<html>introuvable</html>") });
    expect(await cmrs.passage(cache(IMAGE_AT), IMAGE_AT)).toBe("image illisible");
    expect(await cmrs.kept()).toEqual({ illisible: IMAGE_AT.toISOString() });
    expect([...kv.data.keys()]).toEqual(["cmrs:carte"]);
  });

  it("does not go back to an older list, and leaves the state when the list fails", async () => {
    const c = cache(LIST_AT);
    stubFetch({ liste: html(liste("202602030722", "202602030020")) });
    await cmrs.passage(c, LIST_AT);
    stubFetch({ liste: html(liste("202602030020")) });
    await cmrs.passage(c, new Date("2026-02-03T08:45:00Z"));
    stubFetch({});
    expect(await cmrs.passage(c, new Date("2026-02-03T09:15:00Z"))).toBe("liste indisponible");
    expect((JSON.parse(kv.data.get("cmrs:carte") as string) as cmrs.Etat).avis?.dernier).toBe("2026-02-03T07:22:00.000Z");
  });

  it("holds back an image older than the bulletin before the newest", async () => {
    const c = cache(LIST_AT);
    stubFetch({ liste: html(liste("202602030722", "202602030020")), image: png("Mon, 02 Feb 2026 18:44:00 GMT") });
    await cmrs.passage(c, LIST_AT);
    await cmrs.passage(c, IMAGE_AT);
    expect(await cmrs.kept()).toEqual({ ecartee: true });
  });
});

describe("the map on /cyclones (marketing's words, 27/10)", () => {
  const NOW = new Date("2026-02-03T14:40:00Z");
  const i = { empreinte: "0123456789abcdef", largeur: 760, hauteur: 1122, lue: "2026-02-03T14:30:00.000Z" };

  it("shows the image whole, opening Météo-France's site, with its caption and our time of reading, named as such", () => {
    const h = carteHtml({ image: i }, NOW);
    expect(h).toContain(`<a href="https://meteofrance.re/fr/cyclone" rel="noopener"><img src="/cyclones/carte/0123456789abcdef.png" width="760" height="1122"`);
    expect(h).toContain("Source : Météo-France. Carte de prévision de trajectoire du CMRS de La Réunion ; son heure d'émission est écrite sur la carte. Lue sur le site de Météo-France à 18:30 (heure de La Réunion). ");
    expect(h).toContain(`<a href="https://meteofrance.re/fr/cyclone" rel="noopener">Consulter le site officiel de Météo-France</a>`);
    expect(h).toContain(`alt="Carte de prévision de trajectoire publiée par le CMRS de La Réunion (Météo-France), lue sur son site à 18:30 (heure de La Réunion). Son heure d&#39;émission est écrite sur l&#39;image et n&#39;est pas reprise ici. Le nom des systèmes suivis et l&#39;heure du dernier avis sont écrits en texte sur cette page."`);
    expect(h).not.toContain("émise le");
    expect(carteHtml({ image: i }, new Date("2026-02-04T08:00:00Z"))).toContain("Lue sur le site de Météo-France le 03/02 à 18:30 (heure de La Réunion).");
  });

  it("keeps the last image when Météo-France does not answer, with the line that says so", () => {
    expect(carteHtml({ image: i, sans_reponse: true }, NOW)).toContain("Météo-France n'a pas répondu depuis 18:30 : c'est la dernière carte que nous avons lue.");
    expect(carteHtml({ image: i, sans_reponse: true }, new Date("2026-02-04T08:00:00Z"))).toContain("Météo-France n'a pas répondu depuis le 03/02 à 18:30 : c'est la dernière carte que nous avons lue.");
  });

  it("says why there is no map, with the official link, and never shows one held back", () => {
    const held = carteHtml({ ecartee: true }, NOW);
    expect(held).toContain("La carte de prévision de trajectoire du CMRS n'est pas affichée ici : nous n'avons pas pu vérifier qu'elle suit le dernier avis. ");
    expect(held).not.toContain("<img");
    const failed = carteHtml({ illisible: "2026-02-03T13:30:00.000Z" }, NOW);
    expect(failed).toContain("La carte de prévision de trajectoire du CMRS n'a pas pu être lue à 17:30. ");
    expect(failed).toContain("Consulter le site officiel de Météo-France</a>");
    expect(carteHtml(undefined, NOW)).toBe("");
  });

  it("is on /cyclones under the active systems only, and never in the og:image", async () => {
    stubFetch({});
    kv.data.set("cmrs:carte", JSON.stringify({
      avis: { dernier: "2026-02-03T07:22:00.000Z", precedent: "2026-02-03T00:20:00.000Z" },
      image: { ...i, modifiee: "2026-02-03T06:58:00.000Z", depuis: "2026-02-03T07:20:00.000Z", lue: "2026-02-03T07:50:00.000Z" },
    }));
    const now = new Date("2026-02-03T08:00:00Z");
    const a = await buildCyclones(cache(now), now);
    expect(a.carte?.image?.empreinte).toBe(i.empreinte);
    const page = cyclonesPage("https://rundata.re", { value: a, fetchedAt: now, stale: false }, now);
    expect(page).toContain(`<img src="/cyclones/carte/${i.empreinte}.png"`);
    expect(page).not.toMatch(/og:image[^>]*cyclones\/carte/);
    // No active system: no map, no line, and the state is not read.
    kv.data.clear();
    const october = await buildCyclones(cache(OCTOBER), OCTOBER);
    expect(october.carte).toBeUndefined();
    expect(cyclonesPage("https://rundata.re", { value: october, fetchedAt: OCTOBER, stale: false }, OCTOBER)).not.toContain("mf-carte");
  });

  it("gives the answer the image's address and its caption, only when it is shown", async () => {
    expect(carteOfficielle({ image: i })).toEqual({
      image: "https://rundata.re/cyclones/carte/0123456789abcdef.png",
      legende: "Source : Météo-France. Carte de prévision de trajectoire du CMRS de La Réunion ; son heure d'émission est écrite sur la carte. Lue sur le site de Météo-France le 03/02 à 18:30 (heure de La Réunion).",
      source: "Météo-France",
      officiel: "Consulter le site officiel de Météo-France : https://meteofrance.re/fr/cyclone",
    });
    expect(carteOfficielle({ ecartee: true })).toBeUndefined();
    stubFetch({});
    const now = new Date("2026-02-03T08:00:00Z");
    const r = await cyclones(cache(now), undefined, now);
    expect(JSON.parse(r.content[0].text).carte_officielle).toBeUndefined();
  });

  it("serves a kept image by its fingerprint, for a year, and nothing else", async () => {
    kv.data.set(`cmrs:carte:png:${i.empreinte}`, IMAGE());
    const r = (await carteRoute(`/cyclones/carte/${i.empreinte}.png`))!;
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await r.arrayBuffer()).byteLength).toBe(242_548);
    expect((await carteRoute("/cyclones/carte/ffffffffffffffff.png"))!.status).toBe(404);
    expect(await carteRoute("/cyclones/carte/x.png")).toBeNull();
    expect(await carteRoute("/cyclones/fytia")).toBeNull();
  });

  it("says the agreement in the cyclones' licence, without « Licence Ouverte »", () => {
    expect(GDACS.licence).toContain("Météo-France La Réunion : cartes de prévision de trajectoire du CMRS affichées telles quelles, avec son accord écrit du 27/10/2026");
    expect(GDACS.licence).not.toContain("Licence Ouverte");
  });
});
