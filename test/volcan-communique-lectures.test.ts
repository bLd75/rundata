import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { type Info, SOURCES } from "../src/providers/actualites.js";
import { withLectures } from "../src/lectures.js";
import * as copie from "../src/providers/prefecture-copie.js";
import type { PageCopie } from "../src/providers/prefecture-copie.js";
import { type Phase, phase, releaseSentences, releaseText } from "../src/providers/volcan.js";

// 26/10/2026: the release in force read 187 times in 24 h by the scheduled event, for 48 at most at its half hour. Each
// run is a new isolate, often in another data center: neither memory nor the data center's cache saw the last read.
// Here each run is a Cache of its own, sharing only the durable store (the Worker's KV).
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const HTML = fixture("prefecture_retour_vigilance.html");
const PHRASES = releaseSentences(HTML);
const ORIGIN = "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/";
const VIGILANCE_LIEN = `${ORIGIN}Retour-en-phase-de-vigilance`;
const ALERTE_LIEN = `${ORIGIN}Piton-de-la-Fournaise-passage-en-alerte-1-fermeture-de-l-enclos5`;
const ALERTE: Phase = { niveau: "Alerte 1", eruption: false, enclos: "ferme", titre: "Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", lien: ALERTE_LIEN, jour: "2026-10-24" };
const T0 = new Date("2026-10-26T15:40:00Z").getTime();
const MIN = 60_000;

describe("the page of a release, read at most every half hour whichever isolate asks (providers/volcan.ts)", () => {
  let reads: string[];
  let answer: (url: string) => Response;
  let durable: MemoryStore;
  // A run of the scheduled event: a new isolate, a cold data center, the same KV.
  const run = (t: number) => new Cache(new MemoryStore(), () => t, true, durable);

  beforeEach(() => {
    reads = [];
    durable = new MemoryStore();
    answer = () => new Response(HTML);
    vi.stubGlobal("fetch", async (url: string) => {
      reads.push(String(url));
      return answer(String(url));
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("reads it once in a half hour across the runs, then again", async () => {
    for (const m of [0, 5, 10, 25]) {
      expect(await releaseText(run(T0 + m * MIN), ALERTE, T0 + m * MIN)).toContain("le sentier Kapor, dont une partie est recouverte par la coulée de lave de 2026, reste interdit au public.");
      await settle();
    }
    expect(reads).toEqual([ALERTE_LIEN]);
    await releaseText(run(T0 + 30 * MIN), ALERTE, T0 + 30 * MIN);
    expect(reads).toEqual([ALERTE_LIEN, ALERTE_LIEN]);
    // The same isolate asks KV again only once what it knows is old.
    const one = run(T0 + 31 * MIN);
    await releaseText(one, ALERTE, T0 + 31 * MIN);
    expect((await durable.get(`volcan:communique:page:${ALERTE_LIEN}`))?.fetchedAt).toBe(T0 + 30 * MIN);
  });

  it("never reads a release outside the prefecture's site, nor in http", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const lien of ["https://pirate.example/Piton-de-la-Fournaise", "http://www.reunion.gouv.fr/Actualites/x", "https://www.reunion.gouv.fr.pirate.example/x"]) {
      await releaseText(run(T0), { ...ALERTE, lien }, T0).catch(() => undefined);
    }
    expect(reads).toEqual([]);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      "prefecture_communiques : lien hors de www.reunion.gouv.fr ignoré (pirate.example)",
      "prefecture_communiques : lien hors de www.reunion.gouv.fr ignoré (http:)",
      "prefecture_communiques : lien hors de www.reunion.gouv.fr ignoré (www.reunion.gouv.fr.pirate.example)",
    ]);
  });

  it("reads it once for two questions at once in one isolate", async () => {
    const c = run(T0);
    const [a, b] = await Promise.all([releaseText(c, ALERTE, T0), releaseText(c, ALERTE, T0)]);
    expect(a).toEqual(PHRASES);
    expect(b).toEqual(PHRASES);
    expect(reads).toEqual([ALERTE_LIEN]);
  });

  it("asks no sooner after a failure, and says the page served the last one read", async () => {
    await releaseText(run(T0), ALERTE, T0);
    await settle();
    answer = () => new Response("", { status: 500 });
    // 30 min later the page fails: the copy of T0 is served, said stale.
    const c = run(T0 + 30 * MIN);
    expect(await releaseText(c, ALERTE, T0 + 30 * MIN)).toEqual(PHRASES);
    await settle();
    expect(reads).toHaveLength(2);
    // The runs of the next half hour do not ask again.
    for (const m of [35, 40, 55]) {
      await releaseText(run(T0 + m * MIN), ALERTE, T0 + m * MIN);
      await settle();
    }
    expect(reads).toHaveLength(2);
    await releaseText(run(T0 + 60 * MIN), ALERTE, T0 + 60 * MIN);
    expect(reads).toHaveLength(3);
  });

  it("never asked, a page that fails is not asked again for half an hour either", async () => {
    answer = () => new Response("", { status: 500 });
    const kept = { ...ALERTE, phrases: ["Le texte gardé avec la phase."] };
    expect(await releaseText(run(T0), kept, T0)).toEqual(["Le texte gardé avec la phase."]);
    await settle();
    expect(await releaseText(run(T0 + 5 * MIN), ALERTE, T0 + 5 * MIN)).toBeUndefined();
    await settle();
    expect(reads).toHaveLength(1);
    await releaseText(run(T0 + 30 * MIN), ALERTE, T0 + 30 * MIN);
    expect(reads).toHaveLength(2);
  });

  it("reads the page of a release whose list does not name the volcano once, for its subject and its text", async () => {
    const release = (titre: string, day: string, lien: string): Info =>
      ({ titre, lien, publie: new Date(`${day}T12:00:00+04:00`).toISOString(), media: "Préfecture de La Réunion", heure: false, communes: [], lieux: [], sujets: [] }) as Info;
    const card = (r: Info, d: string) => `<li><a class="fr-card__link" href="${new URL(r.lien).pathname}">${r.titre}</a><p>Publié le ${d}</p></li>`;
    const LIST = `<ul>${card(release("Retour en phase de vigilance", "2026-10-26", VIGILANCE_LIEN), "26/10/2026")}${card(release(ALERTE.titre, "2026-10-24", ALERTE_LIEN), "24/10/2026")}</ul>`;
    answer = (url) => new Response(url === SOURCES.prefecture.url ? LIST : HTML);
    for (const m of [0, 5, 10, 15, 20, 25]) {
      const c = run(T0 + m * MIN);
      const p = (await phase(c, T0 + m * MIN)).value!;
      expect(p).toMatchObject({ niveau: "Vigilance", enclos: "partiel", lien: VIGILANCE_LIEN });
      expect(await releaseText(c, p, T0 + m * MIN)).toEqual(PHRASES);
      await settle();
    }
    // The list every five minutes, as before; the page once.
    expect(reads.filter((u) => u === SOURCES.prefecture.url)).toHaveLength(6);
    expect(reads.filter((u) => u === VIGILANCE_LIEN)).toHaveLength(1);
  });
});

describe("in the Worker, the pages of the releases from the collector's copies, never the site (providers/volcan.ts)", () => {
  const release = (titre: string, day: string, lien: string): Info =>
    ({ titre, lien, publie: new Date(`${day}T12:00:00+04:00`).toISOString(), media: "Préfecture de La Réunion", heure: false, communes: [], lieux: [], sujets: [] }) as Info;
  const LISTE = [release("Retour en phase de vigilance", "2026-10-26", VIGILANCE_LIEN), release(ALERTE.titre, "2026-10-24", ALERTE_LIEN)];
  let reads: string[];
  let pages: Map<string, PageCopie>;

  beforeEach(() => {
    reads = [];
    pages = new Map();
    vi.stubGlobal("fetch", async (url: string) => {
      reads.push(String(url));
      return new Response(HTML);
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    copie.configure(
      async () => ({ liste: LISTE, lu_le: new Date(T0 - 5 * MIN).toISOString() }),
      async (lien) => pages.get(lien) ?? null,
    );
  });
  afterEach(() => {
    copie.configure(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const cache = (t: number) => new Cache(new MemoryStore(), () => t, true, new MemoryStore());

  it("reads the phase and the release's text from the copies", async () => {
    pages.set(VIGILANCE_LIEN, { page: { titre: "Piton de la Fournaise : réouverture partielle de l'enclos", phrases: PHRASES }, lu: T0 - 3 * 3600_000 });
    const c = cache(T0);
    const p = (await phase(c, T0)).value!;
    expect(p).toMatchObject({ niveau: "Vigilance", enclos: "partiel", lien: VIGILANCE_LIEN });
    expect(await releaseText(c, p, T0)).toEqual(PHRASES);
    expect(reads).toEqual([]);
  });

  it("a page not copied yet: no phase taken from an older release, no read of the site", async () => {
    const c = cache(T0);
    // Without the page of the release whose list does not name the volcano, the phase is not read (none kept here).
    await expect(phase(c, T0)).rejects.toThrow("page du communiqué pas encore copiée");
    expect(await releaseText(c, ALERTE, T0)).toBeUndefined();
    expect(reads).toEqual([]);
  });

  it("a copy the collector did not renew for a day is served, said as old", async () => {
    const lu = T0 - (24 * 60 + 41) * MIN;
    pages.set(ALERTE_LIEN, { page: { phrases: ["Le texte copié hier."] }, lu });
    const { value, lectures } = await withLectures(() => releaseText(cache(T0), ALERTE, T0));
    expect(value).toEqual(["Le texte copié hier."]);
    expect(lectures).toEqual([expect.objectContaining({ key: copie.pageKey(ALERTE_LIEN), fetchedAt: lu, stale: true, source: "prefecture_communiques" })]);
    expect(reads).toEqual([]);
  });

  it("a copy of the day is not the answer's freshness: read at the collector's pace, a day", async () => {
    pages.set(ALERTE_LIEN, { page: { phrases: ["Le texte copié ce matin."] }, lu: T0 - 8 * 3600_000 });
    const { lectures } = await withLectures(() => releaseText(cache(T0), ALERTE, T0));
    expect(lectures).toEqual([expect.objectContaining({ stale: false, freshSeconds: 86_400 })]);
  });
});
