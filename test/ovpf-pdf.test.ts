import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { costOf, counted, measured, unmeasured } from "../src/budget.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { type Line, pdfLines } from "../src/pdf.js";
import { expectedDays, type Lecture, readNewest, readRelease, SHOW } from "../src/providers/ovpf-pdf.js";
import { parse } from "../src/providers/seismes.js";
import { activityPosts, type Post } from "../src/providers/volcan.js";
import { volcanSeismes } from "../src/tools/volcan.js";

// The OVPF's release of 21/04/2026, 08h30, as the Wayback Machine keeps it: printed to PDF on a Mac (Quartz), two
// pages, TrueType subsets read through their ToUnicode maps. It has no title: its dated line ends with the hour in UTC.
const PDF_URL = "https://www.ipgp.fr/volcanoweb/reunion/Bulletins-Communiques/2026/Communiques/OVPF_20260421_08h30_communique.pdf";
const bytes = () => {
  const b = readFileSync(new URL("./fixtures/ovpf/OVPF_20260421_08h30_communique.pdf", import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const GREY: [number, number, number] = [0.25, 0.24, 0.25];
const RED: [number, number, number] = [1, 0.05, 0];
const line = (y: number, ...runs: [string, [number, number, number]][]): Line => ({
  page: 1,
  y,
  runs: runs.map(([text, rgb], i) => ({ text, rgb, x: i })),
  text: runs.map(([t]) => t).join("").replace(/\s+/g, " ").trim(),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the text of a release's PDF", () => {
  it("reads its lines in order, with their colour", async () => {
    const lines = await pdfLines(bytes());
    const first = lines.filter((l) => l.page === 1).map((l) => l.text);
    expect(first.slice(0, 5)).toEqual([
      "Communiqué",
      "Institut de physique du globe de Paris",
      "Observatoire volcanologique du Piton de la Fournaise",
      "21 avril 2026 – 8h30 heure locale – 4h30 heure UTC",
      "Trémor",
    ]);
    expect(first).toContain("Un trémor* est toujours enregistré depuis environ 6h20 (heure locale, 2h20 UTC) le 19 avril (Figure 1). L’intensité de ce");
    const colour = (t: string) => lines.find((l) => l.text === t)!.runs[0].rgb.map((c) => Math.round(c * 100) / 100);
    // The section titles in red, the text in grey.
    expect(colour("Trémor")).toEqual([1, 0.05, 0]);
    expect(colour("Sismicité")).toEqual([1, 0.05, 0]);
    expect(colour("21 avril 2026 – 8h30 heure locale – 4h30 heure UTC")).toEqual([0.25, 0.24, 0.25]);
    // The header of the second page, red as well, dated the same.
    expect(lines.find((l) => l.page === 2)!.text).toBe("Communiqué – 21 avril 2026 – 8h30 heure locale – 4h30 heure UTC");
  });

  it("refuses what is not a PDF it can read", async () => {
    await expect(pdfLines(new TextEncoder().encode("<html>Service indisponible</html>").buffer as ArrayBuffer)).rejects.toThrow(/pas un PDF/);
    const cut = bytes().slice(0, 200_000);
    await expect(pdfLines(cut)).rejects.toThrow(/^pdf : /);
  });
});

describe("the title and the alert line of a release", () => {
  it("gives no title to a release without one, a red section title never taken for it", async () => {
    const r = readRelease(await pdfLines(bytes()), ["2026-04-21"]);
    expect(r).toEqual({ lu: { jour: "2026-04-21" } });
  });

  it("reads nothing from a release dated other than the post or its address, give or take a day", async () => {
    const lines = await pdfLines(bytes());
    expect(readRelease(lines, ["2026-04-22"])).toEqual({ lu: { jour: "2026-04-21" } });
    expect(readRelease(lines, ["2026-04-23", "2026-04-24"])).toEqual({ ecart: "ligne datée du 2026-04-21, attendu 2026-04-23 ou 2026-04-24" });
    expect(readRelease(lines.filter((l) => l.page === 2), ["2026-04-21"])).toEqual({ ecart: "ligne datée introuvable en page 1" });
  });

  // Built for the test, as the release of 24/10/2026, 18h30 was shown in the post's image; no copy of it can be read yet.
  it("takes the title after « heure locale – » only when all of it is red, and the alert line as written", () => {
    const lines = [
      line(650, ["Communiqué", GREY]),
      line(586, ["24/10/2026 – 18h30 heure locale – ", GREY], ["Arrêt crise sismique", RED]),
      line(547, ["Sismicité", RED]),
      line(400, ["Niveau d’alerte : Alerte 1", GREY]),
    ];
    expect(readRelease(lines, ["2026-10-24"])).toEqual({ lu: { jour: "2026-10-24", titre: "Arrêt crise sismique", niveau_alerte: "Niveau d’alerte : Alerte 1" } });
    // The short dash too.
    lines[1] = line(586, ["24/10/2026 - 18h30 heure locale - ", GREY], ["Arrêt crise sismique", RED]);
    expect(readRelease(lines, ["2026-10-24"])).toMatchObject({ lu: { titre: "Arrêt crise sismique" } });
    // Red only at its start: no title.
    lines[1] = line(586, ["24/10/2026 – 18h30 heure locale – ", GREY], ["Arrêt", RED], [" crise sismique", GREY]);
    expect(readRelease(lines, ["2026-10-24"])).toEqual({ lu: { jour: "2026-10-24", niveau_alerte: "Niveau d’alerte : Alerte 1" } });
    // Nothing after « heure locale », or the hour in UTC there, or longer than a title: no title.
    for (const rest of ["", "4h30 heure UTC", "A".repeat(81)]) {
      lines[1] = line(586, ["24/10/2026 – 18h30 heure locale", GREY], [rest ? ` – ${rest}` : "", RED]);
      expect(readRelease(lines, ["2026-10-24"])).not.toHaveProperty("lu.titre");
    }
  });
});

describe("the release's PDF of the newest post, read in the scheduled refresh only", () => {
  const post = (pdf?: string): Post => ({ date: "2026-04-21T04:40:00.000Z", texte: "🌋 Communiqué OVPF-IPGP – 21/04/2026", lien: "https://bsky.app/profile/ovpf.bsky.social/post/x", ...(pdf && { pdf }) });

  it("keeps the link of a release's PDF as published, never a bulletin's, without its tracking", () => {
    const posts = activityPosts(JSON.parse(fixture("ovpf_bluesky.json")));
    expect(posts.find((p) => p.date.startsWith("2026-09-24"))?.pdf).toBe(
      "https://www.ipgp.fr/volcanoweb/reunion/Bulletins-Communiques/2026/Communiques/OVPF_20260924_09h00_communique_AugmentationSismicite.pdf",
    );
    // The monthly bulletins link PDFs too: not releases.
    expect(posts.find((p) => p.date.startsWith("2026-10-05"))).not.toHaveProperty("pdf");
    const record = { text: "Communiqué OVPF-IPGP – 24/09/2026", createdAt: "2026-09-24T05:40:00Z", facets: [{ features: [{ $type: "app.bsky.richtext.facet#link", uri: `${PDF_URL}?fbclid=IwY2xjawUhmZJ` }] }] };
    const [p] = activityPosts({ feed: [{ post: { uri: "at://x/app.bsky.feed.post/y", author: { handle: "ovpf.bsky.social" }, record } }] });
    expect(p.pdf).toBe(PDF_URL);
    expect(expectedDays({ ...p, date: "2026-04-20T21:00:00Z" })).toEqual(["2026-04-21"]);
    expect(expectedDays({ ...p, date: "2026-04-21T21:00:00Z" })).toEqual(["2026-04-22", "2026-04-21"]);
  });

  it("reads it once, keeps it under its address, logs it, and says nothing more until it is shown", async () => {
    expect(SHOW).toBe(false);
    const t = Date.parse("2026-04-21T06:00:00Z");
    const store = new MemoryStore();
    const durable = new MemoryStore();
    void store.put("volcan:ovpf", { value: [post(PDF_URL)], fetchedAt: t });
    const fetch = vi.fn(async () => new Response(bytes()));
    vi.stubGlobal("fetch", fetch);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const cache = new Cache(store, () => t, true, durable);
    await readNewest(cache, t);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(PDF_URL);
    expect((await durable.get(`volcan:pdf:${PDF_URL}`))?.value).toEqual({ lu: { jour: "2026-04-21" } } satisfies Lecture);
    expect(log).toHaveBeenCalledWith(`volcan : PDF de l'OVPF lu (${PDF_URL}) : ligne datée du 2026-04-21, titre aucun, pas de niveau d'alerte (non affiché)`);
    await readNewest(cache, t);
    await readNewest(new Cache(store, () => t, true, durable), t);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("asks a site that does not answer again after six hours, and keeps a PDF it cannot read without asking again", async () => {
    const t = Date.parse("2026-04-21T06:00:00Z");
    const store = new MemoryStore();
    const durable = new MemoryStore();
    const url = PDF_URL.replace("08h30", "09h30");
    // Each run with the posts as just read, in a new Cache; the isolate's memory of the failure stays.
    const run = async (at: number) => {
      await store.put("volcan:ovpf", { value: [post(url)], fetchedAt: at });
      await readNewest(new Cache(store, () => at, true, durable), at);
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 522 })));
    await run(t);
    expect((await durable.get(`volcan:pdf:${url}`))?.value).toEqual({ echec: "ovpf_pdf: HTTP 522" });
    expect(err).toHaveBeenCalledWith(`volcan : PDF de l'OVPF non lu (${url}) : ovpf_pdf: HTTP 522`);

    const html = vi.fn(async () => new Response("<html>maintenance</html>"));
    vi.stubGlobal("fetch", html);
    await run(t + 3600_000);
    expect(html).not.toHaveBeenCalled();
    await run(t + 6 * 3600_000 + 1);
    expect(html).toHaveBeenCalledTimes(1);
    expect((await durable.get(`volcan:pdf:${url}`))?.value).toEqual({ ecart: "pdf : pas un PDF" });
    expect(err).toHaveBeenCalledWith(`volcan : PDF de l'OVPF non reconnu (${url}) : pdf : pas un PDF`);
    await run(t + 14 * 3600_000);
    expect(html).toHaveBeenCalledTimes(1);
  });

  it("asks KV nothing more for a PDF that failed, in the isolate that knows it, until the next try", async () => {
    const t = Date.parse("2026-04-21T06:00:00Z");
    const store = new MemoryStore();
    const durable = new MemoryStore();
    const reads = (url: string) => get.mock.calls.filter(([k]) => k === `volcan:pdf:${url}`).length;
    const get = vi.spyOn(durable, "get");
    const run = async (url: string, at: number) => {
      await store.put("volcan:ovpf", { value: [post(url)], fetchedAt: at });
      await readNewest(new Cache(store, () => at, true, durable), at);
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(async () => new Response("", { status: 522 }));
    vi.stubGlobal("fetch", fetch);
    // Failed here: the second build of /volcan, five minutes later, reads nothing.
    const failed = PDF_URL.replace("08h30", "10h30");
    await run(failed, t);
    expect(reads(failed)).toBe(1);
    await run(failed, t + 5 * 60_000);
    expect(reads(failed)).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    // Failed in another isolate, as KV keeps it: read once, then not again.
    const elsewhere = PDF_URL.replace("08h30", "11h30");
    await durable.put(`volcan:pdf:${elsewhere}`, { value: { echec: "ovpf_pdf: HTTP 522" }, fetchedAt: t });
    await run(elsewhere, t + 60_000);
    await run(elsewhere, t + 6 * 60_000);
    expect(reads(elsewhere)).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("is not part of the cost of the build that reads it", async () => {
    const t = Date.parse("2026-04-21T06:00:00Z");
    const url = PDF_URL.replace("08h30", "12h30");
    const store = new MemoryStore();
    void store.put("volcan:ovpf", { value: [post(url)], fetchedAt: t });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes())));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const cache = new Cache(store, () => t, true, new MemoryStore());
    const { used } = await counted(40, () => measured("test:pdf", () => unmeasured(() => readNewest(cache, t))));
    expect(used).toBeGreaterThanOrEqual(1);
    expect(costOf("test:pdf")).toBe(0);
  });

  it("is never asked by a question, and leaves the answer as it was", async () => {
    const t = Date.parse("2026-09-24T06:00:00Z");
    const store = new MemoryStore();
    void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
    void store.put("volcan:pitonlive", { value: JSON.parse(fixture("pitonlive_state.json")), fetchedAt: t });
    void store.put("volcan:prefecture", { value: null, fetchedAt: t });
    void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky.json"))), fetchedAt: t });
    const fetch = vi.fn(async () => new Response(bytes()));
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await volcanSeismes(new Cache(store, () => t, true, new MemoryStore()), new Date(t));
    const text = r.content[0].text;
    expect(fetch.mock.calls.map((c) => String((c as unknown[])[0])).filter((u) => u.endsWith(".pdf"))).toEqual([]);
    expect(text).not.toContain(".pdf");
  });
});
