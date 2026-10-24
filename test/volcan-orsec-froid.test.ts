import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import type { Info } from "../src/providers/actualites.js";
import { parse } from "../src/providers/seismes.js";
import { activityPosts, phase, phaseOf } from "../src/providers/volcan.js";
import { buildVolcan } from "../src/web/data.js";
import { volcanPage } from "../src/web/domains.js";
import { site } from "../src/web/site.js";

// 24/10/2026: the prefecture in alert 1 since the morning, pitonlive still at « Vigilance » (its status of the 19th).
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T15:35:00Z");
const ALERT_1 = phaseOf([
  { titre: "Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", lien: "https://www.reunion.gouv.fr/x", publie: new Date("2026-10-24T12:00:00+04:00").toISOString(), media: "Préfecture de La Réunion", heure: false, communes: [], lieux: [], sujets: [] } as unknown as Info,
])!;

/** An isolate after a deploy: its memory and the data center's cache empty of the prefecture, the other sources there. */
function cold(durable: MemoryStore) {
  const store = new MemoryStore();
  const t = NOW.getTime();
  void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
  void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky.json"))), fetchedAt: t });
  void store.put("volcan:pitonlive", { value: JSON.parse(fixture("pitonlive_state.json")), fetchedAt: t });
  return { store, cache: new Cache(store, () => t, true, durable) };
}

// The prefecture's site down, or too slow: its request ends in an error.
const prefectureDown = () =>
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).includes("reunion.gouv.fr")) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    throw new Error(`unexpected ${url}`);
  });

const page = async (cache: Cache) => (await site(new Request("https://rundata.re/volcan"), cache, () => {}, NOW))!.text();

afterEach(() => vi.unstubAllGlobals());

describe("the ORSEC level of a cold copy, the prefecture not read in time", () => {
  it("keeps the phase read, and says it after a deploy while the prefecture does not answer", async () => {
    const durable = new MemoryStore();
    // An isolate reads the prefecture's alert 1: the phase is kept, after the answer.
    const warm = cold(durable);
    void warm.store.put("volcan:prefecture", { value: ALERT_1, fetchedAt: NOW.getTime() });
    expect((await phase(warm.cache, NOW.getTime())).value).toMatchObject({ niveau: "Alerte 1" });
    await new Promise((r) => setTimeout(r, 0));
    expect((await durable.get("volcan:prefecture:derniere-phase"))?.value).toMatchObject({ niveau: "Alerte 1" });

    // A deploy: a new isolate, a cold cache, the prefecture down.
    prefectureDown();
    const { cache } = cold(durable);
    const v = await buildVolcan(cache, NOW);
    expect(v.etat?.niveau_orsec).toBe("Alerte 1");
    expect(v.resume).not.toContain("Vigilance");
    const html = await page(cold(durable).cache);
    expect(html).toContain("Niveau du dispositif ORSEC volcan\u00a0: <b>Alerte 1</b>");
    expect(html).not.toMatch(/ORSEC[^<]*<b>Vigilance/);
  });

  it("keeps it too when the release has left the prefecture's list of the latest", async () => {
    const durable = new MemoryStore();
    void durable.put("volcan:prefecture:derniere-phase", { value: ALERT_1, fetchedAt: NOW.getTime() - 3600_000 });
    const { store, cache } = cold(durable);
    void store.put("volcan:prefecture", { value: null, fetchedAt: NOW.getTime() });
    expect((await buildVolcan(cache, NOW)).etat?.niveau_orsec).toBe("Alerte 1");
  });

  it("does not come down when nothing is known: no « Vigilance », the Enclos and the level to check on reunion.gouv.fr", async () => {
    prefectureDown();
    const { cache } = cold(new MemoryStore());
    const v = await buildVolcan(cache, NOW);
    expect(v.etat).toMatchObject({ niveau_orsec: "à vérifier sur reunion.gouv.fr", niveau_inconnu: true });
    expect(v.etat?.acces_enclos).toBeUndefined();
    expect(v.resume).toContain("Pas d'éruption en cours au Piton de la Fournaise selon pitonlive.com. Niveau du dispositif ORSEC volcan : non lu par rundata.re, à vérifier sur reunion.gouv.fr.");
    expect(v.resume).toContain("Accès à l'Enclos : à vérifier sur reunion.gouv.fr, avant de partir.");
    expect(v.resume).not.toContain("Vigilance");
    const html = await page(cold(new MemoryStore()).cache);
    expect(html).toContain(`Pas d'éruption en cours au Piton de la Fournaise selon pitonlive.com. Nous n'avons pas pu lire le niveau d'alerte de la préfecture\u00a0: vérifiez-le sur <a href="https://www.reunion.gouv.fr/Actualites/Communiques-de-presse">reunion.gouv.fr</a> avant de monter au volcan.`);
    expect(html).toContain(`Accès à l'Enclos\u00a0: à vérifier sur <a href="https://www.reunion.gouv.fr/Actualites/Communiques-de-presse">reunion.gouv.fr</a>, avant de partir.`);
    expect(html).not.toMatch(/ORSEC[^<]*<b>Vigilance/);
    expect(html).not.toContain("partiellement ouvert");
  });

  it("says pitonlive's lower level beside the prefecture's alert after 48 hours, on the page and to the AI", async () => {
    const durable = new MemoryStore();
    const { store, cache } = cold(durable);
    // The prefecture's alert 1 of the 17th; pitonlive at « Vigilance » since the 19th; now the 24th.
    const alert = phaseOf([{ titre: "Piton de la Fournaise : passage en alerte 1", lien: "https://www.reunion.gouv.fr/x", publie: new Date("2026-10-17T12:00:00+04:00").toISOString() } as unknown as Info])!;
    void store.put("volcan:prefecture", { value: alert, fetchedAt: NOW.getTime() });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const v = await buildVolcan(cache, NOW);
    expect(v.etat?.niveau_orsec).toBe("Alerte 1");
    expect(v.resume).toContain("Niveau du dispositif ORSEC volcan : Alerte 1 selon le dernier communiqué de la préfecture que nous avons lu (17/10). pitonlive.com indique « Vigilance » depuis le 19/10 : vérifiez le niveau en vigueur sur reunion.gouv.fr.");
    // The Enclos as the release said it (closed in alert), and where it comes from: never pitonlive's « partiellement ».
    // The release's title says nothing of the Enclos: closed by its level, never « interdit » put in its mouth (marketing).
    expect(v.resume).toContain("Alerte 1 selon le communiqué de la préfecture du 17/10 : accès à l'Enclos interdit à ce niveau (dispositif ORSEC Volcan). Vérifiez sur reunion.gouv.fr avant de monter.");
    expect(v.resume).not.toContain("interdit selon le communiqué");
    expect(v.resume).not.toContain("partiellement");
    const html = volcanPage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW);
    const gouv = `<a href="https://www.reunion.gouv.fr/Actualites/Communiques-de-presse">reunion.gouv.fr</a>`;
    expect(html).toContain(`Niveau du dispositif ORSEC volcan : <b>Alerte 1</b> selon le dernier communiqué de la préfecture que nous avons lu (17 octobre 2026). pitonlive.com indique « Vigilance » depuis le 19 octobre 2026 : vérifiez le niveau en vigueur sur ${gouv}.`);
    expect(html).toContain(`Alerte 1 selon le communiqué de la préfecture du 17/10 : accès à l'Enclos <b>interdit</b> à ce niveau (dispositif ORSEC Volcan). Vérifiez sur ${gouv} avant de monter.`);
    expect(html.replace(/<\/?b>/g, "")).not.toContain("interdit selon le communiqué");
    vi.restoreAllMocks();
  });
});
