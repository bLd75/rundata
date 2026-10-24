import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import type { Info } from "../src/providers/actualites.js";
import { parse } from "../src/providers/seismes.js";
import { activityPosts, phaseOf } from "../src/providers/volcan.js";
import { type ActualitesAnswer, buildVolcan, type VolcanAnswer } from "../src/web/data.js";
import { volcanLive, volcanPage } from "../src/web/domains.js";
import { SHARED } from "../src/web/partagees.js";
import { site } from "../src/web/site.js";
import { demos } from "../src/web/home.js";
import { alerteVolcan, bannerText, homeCard, mediaHeadlines } from "../src/web/volcan-alerte.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
// The prefecture's release of the 24th, after pitonlive's last status (still « Vigilance », Enclos partly open).
const NOW = new Date("2026-10-24T14:00:00Z");

const release = (titre: string, day: string): Info =>
  ({ titre, lien: `https://www.reunion.gouv.fr/x/${day}`, publie: new Date(`${day}T12:00:00+04:00`).toISOString(), media: "Préfecture de La Réunion", heure: false, communes: [], lieux: [], sujets: [] }) as Info;

function sources(titre?: string) {
  const store = new MemoryStore();
  const t = NOW.getTime();
  void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
  void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky.json"))), fetchedAt: t });
  void store.put("volcan:pitonlive", { value: JSON.parse(fixture("pitonlive_state.json")), fetchedAt: t });
  void store.put("volcan:prefecture", { value: titre ? phaseOf([release(titre, "2026-10-24")]) : null, fetchedAt: t });
  return new Cache(store, () => t);
}

async function answer(titre?: string): Promise<VolcanAnswer> {
  return buildVolcan(sources(titre), NOW);
}

const ALERT_1 = "Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos";
const ALERT_2 = "Piton de la Fournaise : passage en alerte 2-1, éruption en cours dans l'enclos";

describe("the volcano put forward during an alert", () => {
  it("says nothing while the volcano is quiet", async () => {
    expect(alerteVolcan(await answer())).toBeUndefined();
  });

  it("reads alert 1 from the prefecture's release, with its day and never an hour", async () => {
    const a = alerteVolcan(await answer(ALERT_1))!;
    expect(a).toMatchObject({ niveau: "Alerte 1", eruption: false, communique: { titre: ALERT_1 } });
    expect(bannerText(a)).toBe(
      "🌋 Piton de la Fournaise : alerte 1 du préfet depuis le 24 octobre, « éruption probable ou imminente » (dispositif ORSEC Volcan). Accès à l'Enclos interdit.",
    );
  });

  it("takes alert 2 for the eruption under way, with the sub-level as written", async () => {
    const a = alerteVolcan(await answer(ALERT_2))!;
    expect(a.eruption).toBe(true);
    expect(bannerText(a)).toBe("🌋 Éruption en cours au Piton de la Fournaise (alerte 2-1 du préfet depuis le 24 octobre). Accès à l'Enclos interdit.");
  });

  it("tells the AI the same: the prefecture's words, and the eruption dated by its release only", async () => {
    expect((await answer(ALERT_1)).resume).toContain("Alerte 1 au Piton de la Fournaise : « éruption probable ou imminente » (dispositif ORSEC Volcan). L'OVPF et la préfecture n'ont pas annoncé d'éruption dans les textes que nous avons lus.");
    // Never that it has not begun, on our word: the OVPF's newest post may be an image we do not read.
    expect((await answer(ALERT_1)).resume).not.toMatch(/pas (encore )?commencé/);
    expect((await answer(ALERT_2)).resume).toMatch(/^ÉRUPTION EN COURS au Piton de la Fournaise, annoncée par la préfecture le \S+\./);
  });

  it("dresses /volcan for the alert: title, heading, the Enclos forbidden, never « partiellement »", async () => {
    const v = await answer(ALERT_1);
    const page = volcanPage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW);
    expect(page).toContain("<title>Piton de la Fournaise : alerte 1, éruption probable · 974</title>");
    expect(page).toContain("<h1>Piton de la Fournaise : alerte 1, éruption probable ou imminente</h1>");
    expect(page).toContain(`<meta name="description" content="Alerte 1 depuis le 24 octobre (préfecture) : « éruption probable ou imminente », selon le dispositif ORSEC Volcan. Accès à l&#39;Enclos interdit. Communiqués de l&#39;OVPF en direct · 974">`);
    // The plan's words only, never a release's of the day nor ours.
    expect(page).not.toContain("très brève");
    expect(page).toContain("<b>L&#39;OVPF et la préfecture n&#39;ont pas annoncé d&#39;éruption dans les textes que nous avons lus. Seuls l&#39;OVPF et la préfecture l&#39;annonceront : leurs communiqués s&#39;affichent ici dès leur publication.</b>");
    expect(page).not.toMatch(/pas (encore )?commencé/);
    expect(page).toContain("Accès à l&#39;Enclos interdit. Seules comptent les consignes de la préfecture et de l&#39;OVPF.");
    expect(page).toContain("Le communiqué de la préfecture");
    expect(page).toContain('href="https://x.com/obsfournaise"');
    expect(page).toContain("Pas encore d'article des médias de l'île sur cette alerte.");
    expect(page).not.toContain("partiellement");
    expect(volcanLive({ value: v, fetchedAt: NOW, stale: false })).toEqual({ valeur: "Alerte 1", detail: "éruption probable ou imminente · Enclos interdit" });
  });

  it("says the level in the plan's words on the home page too, never « pas encore »", async () => {
    const v = await answer(ALERT_1);
    expect(homeCard(alerteVolcan(v)!)).toContain("<h2>🌋 Piton de la Fournaise : alerte 1</h2><p class=\"lead\">Alerte 1 : « éruption probable ou imminente », selon le dispositif ORSEC Volcan. Accès à l&#39;Enclos interdit.</p>");
    const demo = demos({ volcan: { value: v, fetchedAt: NOW, stale: false } } as unknown as Parameters<typeof demos>[0], NOW).find((d) => d.call === "volcan_seismes()")!;
    expect(demo.answer).toMatch(/^L&#39;OVPF et la préfecture n&#39;ont pas annoncé d&#39;éruption dans les textes que nous avons lus\. Le volcan est en alerte 1 : « éruption probable ou imminente » \(dispositif ORSEC Volcan\)\./);
    expect(demo.answer).not.toContain("Pas encore");
  });

  it("names vigilance and its words when the prefecture's phase says it, and nothing of an eruption", async () => {
    const may = phaseOf([{ titre: "Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos", lien: "https://www.reunion.gouv.fr/x", publie: "2026-10-20T08:00:00.000Z" } as unknown as Info])!;
    const store = new MemoryStore();
    const t = NOW.getTime();
    void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
    void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky.json"))), fetchedAt: t });
    void store.put("volcan:pitonlive", { value: JSON.parse(fixture("pitonlive_state.json")), fetchedAt: t });
    void store.put("volcan:prefecture", { value: may, fetchedAt: t });
    const v = await buildVolcan(new Cache(store, () => t), NOW);
    const page = volcanPage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW);
    expect(page).toContain("<title>Piton de la Fournaise : Vigilance volcanique · 974</title>");
    expect(page).toContain("<h1>Piton de la Fournaise : vigilance, activité persistante et continue sous le massif</h1>");
    // Only in the folded list of the plan's levels.
    expect(page.replace(/<details>[\s\S]*?<\/details>/, "")).not.toMatch(/éruption probable/);
  });

  it("asks in Creole whether the volcano erupted, and during the eruption whether the lava still flows", async () => {
    const page = async (title?: string) => volcanPage("https://rundata.re", { value: await answer(title), fetchedAt: NOW, stale: false }, NOW);
    const after = " Gèt si https://rundata.re/volcan é di amwin si lanklo lé ouvèr.";
    expect(await page()).toContain(`Volkan la pété ?${after}`);
    expect(await page(ALERT_1)).toContain(`Volkan la pété ?${after}`);
    expect(await page(ALERT_2)).toContain(`La lav i koul ankor ?${after}`);
    expect(await page(ALERT_2)).not.toContain("Volkan la pété");
  });

  it("keeps the normal page once the alert is over", async () => {
    const page = volcanPage("https://rundata.re", { value: await answer(), fetchedAt: NOW, stale: false }, NOW);
    expect(page).toContain("<title>Piton de la Fournaise en direct : éruption, Enclos, séismes · 974</title>");
    expect(page).not.toContain("Le communiqué de la préfecture");
  });

  it("lists the media's headlines about the volcano, the prefecture's apart", () => {
    const row = (media: string, titre: string, publie: string) => ({ media, titre, publie, quand: "18:10", lien: "https://example.org/a" });
    const news = {
      infos: [row("Imaz Press", "Piton de la Fournaise : l'alerte 1 déclenchée", "2026-10-24T13:10:00Z"), row("La 1ère", "Grève au port", "2026-10-24T13:20:00Z"),
        row("Préfecture de La Réunion", "Piton de la Fournaise : passage en alerte 1", "2026-10-24T08:00:00Z")],
      en_direct: [row("La 1ère", "Éruption imminente : l'Enclos fermé", "2026-10-24T13:30:00Z")],
    } as unknown as ActualitesAnswer;
    expect(mediaHeadlines(news).map((i) => i.media)).toEqual(["La 1ère", "Imaz Press"]);
  });

  it("puts the banner on every page, from the copy of /volcan", async () => {
    const cache = sources(ALERT_1);
    const quiet = await (await site(new Request("https://rundata.re/communes"), cache, () => {}, NOW))!.text();
    expect(quiet).not.toContain('class="alerte volcan"');
    await cache.get("web:volcan", 300, () => buildVolcan(cache, NOW));
    // A minute later: the banner is read again.
    const later = new Date(NOW.getTime() + 61_000);
    const html = await (await site(new Request("https://rundata.re/communes"), cache, () => {}, later))!.text();
    expect(html).toContain("🌋 Piton de la Fournaise\u00a0: alerte 1 du préfet");
    expect(html).toContain('<a href="/volcan">Suivre en direct →</a>');
  });

  it("refreshes the shared copy every 5 minutes during an alert, every 30 otherwise", async () => {
    const every = SHARED.find((s) => s.key === "web:volcan")!.every as (last: unknown) => number;
    expect(every(await answer(ALERT_1))).toBe(5);
    expect(every(await answer())).toBe(30);
    expect(every(undefined)).toBe(30);
  });
});
