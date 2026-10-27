import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { type Info, SOURCES } from "../src/providers/actualites.js";
import { decisionOf } from "../src/providers/prefecture.js";
import { parse } from "../src/providers/seismes.js";
import { activityPosts, doubtful, enclosInText, enclosWordsOf, pageTitle, phase, phaseOf, releaseSentences, volcanicPage, type Page } from "../src/providers/volcan.js";
import { buildVolcan } from "../src/web/data.js";

// 26/10/2026: the prefecture back in vigilance, the Enclos reopened in part at 13:00. Its list says « Retour en phase de
// vigilance », without the volcano; only its page does (« Piton de la Fournaise : réouverture partielle de l'enclos »).
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const HTML = fixture("prefecture_retour_vigilance.html");
const PAGE: Page = { titre: pageTitle(HTML), phrases: releaseSentences(HTML) };
const ORIGIN = "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/";
const VIGILANCE_LIEN = `${ORIGIN}Retour-en-phase-de-vigilance`;
const ALERTE_LIEN = `${ORIGIN}Piton-de-la-Fournaise-passage-en-alerte-1-fermeture-de-l-enclos5`;

const release = (titre: string, day: string, lien: string): Info =>
  ({ titre, lien, publie: new Date(`${day}T12:00:00+04:00`).toISOString(), media: "Préfecture de La Réunion", heure: false, communes: [], lieux: [], sujets: [] }) as Info;
const VIGILANCE = release("Retour en phase de vigilance", "2026-10-26", VIGILANCE_LIEN);
const ALERTE = release("Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", "2026-10-24", ALERTE_LIEN);
const LIST = [VIGILANCE, ALERTE];

describe("a release about the volcano whose list's title does not name it (26/10/2026)", () => {
  it("reads the page's title and sentences as written", () => {
    expect(PAGE.titre).toBe("Piton de la Fournaise : réouverture partielle de l’enclos");
    expect(PAGE.phrases).toContain("le sentier Kapor, dont une partie est recouverte par la coulée de lave de 2026, reste interdit au public.");
    expect(volcanicPage(PAGE)).toBe(true);
  });

  it("asks its page, and only its page: the newer releases of another plan are not read", () => {
    expect(doubtful(LIST)).toEqual([VIGILANCE]);
    const meteo = release("Vigilance orange fortes pluies et orages", "2026-10-27", `${ORIGIN}Vigilance-orange-fortes-pluies`);
    expect(doubtful([meteo, ...LIST])).toEqual([VIGILANCE]);
    // Older than the newest release the list says is about the volcano and declares a phase: not read.
    expect(doubtful([ALERTE, release("Retour en phase de vigilance", "2026-10-20", `${ORIGIN}x`)])).toEqual([]);
  });

  it("gives vigilance and the Enclos reopened in part, in the words of its page's title", () => {
    const p = phaseOf(LIST, new Map([[VIGILANCE_LIEN, PAGE]]))!;
    expect(p).toMatchObject({ niveau: "Vigilance", eruption: false, enclos: "partiel", titre: "Retour en phase de vigilance", lien: VIGILANCE_LIEN, jour: "2026-10-26", page: PAGE.titre });
    expect(enclosWordsOf(p)).toBe("réouverture partielle");
    // Its page unread, the list alone: the release of the 24th, as before.
    expect(phaseOf(LIST)).toMatchObject({ niveau: "Alerte 1", enclos: "ferme" });
  });

  it("reads the Enclos in its sentences when its titles say nothing of it", () => {
    expect(enclosInText(PAGE.phrases)).toBe("partiel");
    const p = phaseOf(LIST, new Map([[VIGILANCE_LIEN, { phrases: PAGE.phrases }]]))!;
    expect(p).toMatchObject({ niveau: "Vigilance", enclos: "partiel" });
    expect(p.page).toBeUndefined();
    expect(enclosInText(["L’accès à l’enclos du volcan est de nouveau autorisé."])).toBe("ouvert");
    expect(enclosInText(["L’accès à l’enclos reste interdit jusqu’à nouvel ordre."])).toBe("ferme");
    expect(enclosInText(["La RN 2 reste ouverte."])).toBeUndefined();
  });

  it("never takes a cyclone's return to vigilance for the volcano's", () => {
    const cyclone: Page = { titre: "Retour en phase de vigilance", phrases: ["Le cyclone s’éloigne de La Réunion.", "Les sentiers du volcan restent fermés jusqu’à nouvel ordre."] };
    expect(volcanicPage(cyclone)).toBe(false);
    expect(phaseOf(LIST, new Map([[VIGILANCE_LIEN, cyclone]]))).toMatchObject({ niveau: "Alerte 1", lien: ALERTE_LIEN });
    expect(volcanicPage({ titre: "Retour en phase de vigilance", phrases: ["Les écoles rouvrent demain."] })).toBe(false);
  });

  it("is not read as a cyclone's decision when its address names the volcano", () => {
    const r = release("Passage en phase de sauvegarde", "2026-10-26", `${ORIGIN}Piton-de-la-Fournaise-passage-en-phase-de-sauvegarde`);
    expect(decisionOf([r])).toBeUndefined();
    expect(decisionOf([{ ...r, lien: `${ORIGIN}Passage-en-phase-de-sauvegarde` }])).toMatchObject({ niveau: 6 });
  });
});

describe("the phase served after the deploy", () => {
  afterEach(() => vi.unstubAllGlobals());
  const NOW = new Date("2026-10-26T15:40:00Z");
  const card = (r: Info, d: string) => `<li><a class="fr-card__link" href="${new URL(r.lien).pathname}">${r.titre}</a><p>Publié le ${d}</p></li>`;
  const LIST_HTML = `<ul>${card(VIGILANCE, "26/10/2026")}${card(ALERTE, "24/10/2026")}</ul>`;

  it("replaces the alert 1 a former version read and kept, reading the release's page once", async () => {
    const reads: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      reads.push(String(url));
      if (String(url) === SOURCES.prefecture.url) return new Response(LIST_HTML);
      if (String(url) === VIGILANCE_LIEN) return new Response(HTML);
      throw new Error(`unexpected ${url}`);
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const t = NOW.getTime();
    const store = new MemoryStore();
    const durable = new MemoryStore();
    // What a former version read and kept: the alert 1 of the 24th.
    const alerte = phaseOf(LIST)!;
    void store.put("volcan:prefecture", { value: alerte, fetchedAt: t });
    void durable.put("volcan:prefecture:derniere-phase", { value: alerte, fetchedAt: t });
    void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
    void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky.json"))), fetchedAt: t });
    void store.put("volcan:pitonlive", { value: JSON.parse(fixture("pitonlive_state.json")), fetchedAt: t });
    const cache = new Cache(store, () => t, true, durable);

    expect((await phase(cache, t)).value).toMatchObject({ niveau: "Vigilance", enclos: "partiel", lien: VIGILANCE_LIEN });
    const v = await buildVolcan(cache, NOW);
    expect(v.etat?.niveau_orsec).toBe("Vigilance");
    expect(v.etat?.acces_enclos).toMatchObject({ communique: { mots: "réouverture partielle", jour: "2026-10-26", lien: VIGILANCE_LIEN } });
    expect(JSON.stringify(v)).not.toMatch(/Alerte 1/);
    // The list once, the release's page once: its subject and its sentences from the same reading.
    expect(reads.filter((u) => u === VIGILANCE_LIEN)).toHaveLength(1);
    expect(reads.filter((u) => u === SOURCES.prefecture.url)).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect((await durable.get("volcan:prefecture:derniere-phase"))?.value).toMatchObject({ niveau: "Vigilance", enclos: "partiel" });
  });

  it("keeps the phase kept, rather than the older alert, while the page that would say does not answer", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url) === SOURCES.prefecture.url) return new Response(LIST_HTML);
      return new Response("", { status: 500 });
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = NOW.getTime();
    const durable = new MemoryStore();
    const kept = phaseOf(LIST, new Map([[VIGILANCE_LIEN, PAGE]]))!;
    void durable.put("volcan:prefecture:derniere-phase", { value: kept, fetchedAt: t - 3600_000 });
    const cache = new Cache(new MemoryStore(), () => t, true, durable);
    const got = await phase(cache, t);
    expect(got.value).toMatchObject({ niveau: "Vigilance", enclos: "partiel" });
    expect(got.stale).toBe(true);
  });
});
