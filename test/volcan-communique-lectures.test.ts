import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { type Info, SOURCES } from "../src/providers/actualites.js";
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
