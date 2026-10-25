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
import { demos, homePage, type HomeLive } from "../src/web/home.js";
import { esc } from "../src/web/map.js";
import { NIVEAUX } from "../src/tools/volcan-acces.js";
import { DESCRIPTION_MAX, meteoPage } from "../src/web/pages.js";
import { alertSections, alerteVolcan, bannerText, homeCard, mediaHeadlines, tileLive, type VolcanAlerte, volcanMeta, withVolcan } from "../src/web/volcan-alerte.js";

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
      "🌋 Piton de la Fournaise : alerte 1 du préfet (communiqué du 24\u00a0octobre), « éruption probable ou imminente » (dispositif ORSEC Volcan). Accès à l'Enclos interdit.",
    );
  });

  it("takes alert 2 for the eruption under way, with the sub-level as written", async () => {
    const a = alerteVolcan(await answer(ALERT_2))!;
    expect(a.eruption).toBe(true);
    expect(bannerText(a)).toBe("🌋 Éruption en cours au Piton de la Fournaise (alerte 2-1 du préfet, communiqué du 24\u00a0octobre). Accès à l'Enclos interdit.");
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
    expect(page).toContain(`<meta name="description" content="Alerte\u00a01 du préfet (communiqué du 24\u00a0octobre)\u00a0: «\u00a0éruption probable ou imminente\u00a0». Accès à l&#39;Enclos interdit. Communiqués de l&#39;OVPF en direct · 974">`);
    // The plan's words only, never a release's of the day nor ours.
    expect(page).not.toContain("très brève");
    expect(page).toContain("<b>L&#39;OVPF et la préfecture n&#39;ont pas annoncé d&#39;éruption dans les textes que nous avons lus. Seuls l&#39;OVPF et la préfecture l&#39;annonceront : leurs communiqués s&#39;affichent ici dès que nous les avons lus.</b>");
    expect(page).not.toMatch(/pas (encore )?commencé/);
    expect(page).toContain("<b>Accès à l&#39;Enclos interdit. Seules comptent les consignes de la préfecture et de l&#39;OVPF.</b>");
    // The Enclos card: its title, then the sentence without the title's words again (marketing).
    expect(page).toContain("<h3>Accès à l&#39;Enclos interdit.</h3><p>Seules comptent les consignes de la préfecture et de l&#39;OVPF.</p>");
    expect(page).toContain("Le communiqué de la préfecture");
    expect(page).toContain('href="https://x.com/obsfournaise"');
    // The OVPF's Bluesky and Facebook, and no link to ipgp.fr; whether its site answers is said by /sites-sans-reponse's
    // state only (tools/volcan.ts `ipgpMuet`), never by a sentence written in advance.
    for (const u of ["https://bsky.app/profile/ovpf.bsky.social", "https://www.facebook.com/ObsVolcanoPitonFournaise"]) expect(page).toContain(`href="${u}"`);
    expect(page).not.toContain("momentanément indisponible");
    expect(page).not.toContain("ipgp.fr/fr/ovpf");
    expect((v as unknown as { consulter: string[] }).consulter).toEqual(["https://www.reunion.gouv.fr", "https://bsky.app/profile/ovpf.bsky.social", "https://www.facebook.com/ObsVolcanoPitonFournaise"]);
    expect(page).toContain("Pas encore d'article des médias de l'île sur cette alerte.");
    expect(page).not.toContain("partiellement");
    expect(volcanLive({ value: v, fetchedAt: NOW, stale: false })).toEqual({ valeur: "Alerte 1", detail: "éruption probable ou imminente · Enclos interdit", source: "Préfecture, communiqué du 24/10" });
  });

  it("says the level in the plan's words on the home page too, never « pas encore »", async () => {
    const v = await answer(ALERT_1);
    expect(homeCard(alerteVolcan(v)!)).toContain("<h2>🌋 Piton de la Fournaise : alerte\u00a01</h2><p class=\"lead\">Alerte\u00a01 du préfet (communiqué du 24\u00a0octobre) : « éruption probable ou imminente », selon le dispositif ORSEC Volcan. Accès à l&#39;Enclos interdit. <b>Suivre en direct\u00a0→</b></p>");
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
    expect(page).toContain("<title>Piton de la Fournaise : vigilance, pas d&#39;éruption annoncée · 974</title>");
    expect(page).toContain("<h1>Piton de la Fournaise : vigilance, pas d&#39;éruption annoncée</h1>");
    // Only in the folded list of the plan's levels.
    expect(page.replace(/<details>[\s\S]*?<\/details>/, "")).not.toMatch(/éruption probable/);
  });

  it("asks in Creole whether the volcano erupted, the same question whatever the level", async () => {
    const page = async (title?: string) => volcanPage("https://rundata.re", { value: await answer(title), fetchedAt: NOW, stale: false }, NOW);
    for (const t of [undefined, ALERT_1, ALERT_2]) expect(await page(t)).toContain("Volkan la pété ? Gèt si https://rundata.re/volcan é di amwin si lanklo lé ouvèr.");
  });

  it("keeps the normal page once the alert is over, the state of the volcano when no level is read", async () => {
    const page = volcanPage("https://rundata.re", { value: await answer(), fetchedAt: NOW, stale: false }, NOW);
    expect(page).toContain("<title>Piton de la Fournaise : état du volcan · 974</title>");
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
    expect(html).toContain('<a href="/volcan">Suivre en direct\u00a0→</a>');
  });

  it("shows one volcano block per page: the card alone on the home page, the heading alone on /volcan, the banner elsewhere", async () => {
    const O = "https://rundata.re";
    for (const [titre, card] of [
      [ALERT_1, "Alerte\u00a01 du préfet (communiqué du 24\u00a0octobre) : « éruption probable ou imminente », selon le dispositif ORSEC Volcan. Accès à l&#39;Enclos interdit. <b>Suivre en direct\u00a0→</b>"],
      [ALERT_2, "Alerte\u00a02-1 du préfet (communiqué du 24\u00a0octobre). Accès à l&#39;Enclos interdit. <b>Suivre en direct\u00a0→</b>"],
    ]) {
      const v = await answer(titre);
      const a = alerteVolcan(v)!;
      const copy = { value: v, fetchedAt: NOW, stale: false };
      const home = withVolcan(a, () => homePage(O, { volcan: copy } as unknown as HomeLive, NOW));
      expect(home).not.toContain('class="alerte volcan"');
      expect(home).toContain(`<div class="wrap volcan-une" data-court><a class="ligne" href="/volcan">`);
      expect(home).toContain(`</a><a class="card" href="/volcan">`);
      expect(home).toContain(card);
      // The home page's copy missing: the card from the banner's read, still alone.
      const bare = withVolcan(a, () => homePage(O, null, NOW));
      expect(bare).not.toContain('class="alerte volcan"');
      expect(bare).toContain(card);
      expect(withVolcan(a, () => volcanPage(O, copy, NOW))).not.toContain('class="alerte volcan"');
      const other = withVolcan(a, () => meteoPage(O, null, NOW));
      expect(other).toContain('class="alerte volcan"');
      expect(other).toContain('<a href="/volcan">Suivre en direct\u00a0→</a>');
      expect(other).not.toContain('class="wrap volcan-une"');
      // On a phone, the card and the banner are one line to /volcan; none on /volcan itself.
      const line = `<a class="ligne" href="/volcan"><span aria-hidden="true">🌋</span><span class="txt">${titre === ALERT_1 ? "Volcan\u00a0: alerte\u00a01 du préfet" : "Éruption selon le préfet"} <span class="nw">· Enclos interdit</span></span>`;
      expect(home).toContain(line);
      expect(other).toContain(`<div class="alerte volcan" data-court role="status">${line}`);
      expect(withVolcan(a, () => volcanPage(O, copy, NOW))).not.toContain('class="ligne"');
    }
  });

  it("says on a phone's line whose the level or the eruption is, and « Enclos interdit », without a date (marketing)", () => {
    const said = (a: VolcanAlerte) => /<a class="ligne" href="\/volcan"><span aria-hidden="true">🌋<\/span><span class="txt">(.*?)<\/span><span aria-hidden="true">→/.exec(withVolcan(a, () => meteoPage("https://rundata.re", null, NOW)))![1];
    // Compared as HTML, never with the tags taken out: the last part in its own span, the apostrophe escaped.
    const line = (head: string) => `${esc(head)} <span class="nw">· Enclos interdit</span>`;
    const ovpf = { date: "25/10 08:00 heure de La Réunion", lien: "https://www.ipgp.fr/" };
    expect(said({ niveau: "Alerte 1", eruption: false })).toBe(line("Volcan\u00a0: alerte\u00a01 du préfet"));
    expect(said({ niveau: "Alerte 2-1", eruption: false })).toBe(line("Volcan\u00a0: alerte\u00a02-1 du préfet"));
    expect(said({ niveau: "Alerte 1", eruption: false, ovpf })).toBe(line("Volcan\u00a0: alerte\u00a01 selon l'OVPF"));
    expect(said({ niveau: "Alerte 2-1", eruption: true })).toBe(line("Éruption selon le préfet"));
    expect(said({ niveau: "Alerte 2-1", eruption: true, ovpf })).toBe(line("Éruption selon l'OVPF"));
    expect(said({ eruption: true })).toBe(line("Éruption selon l'OVPF"));
    expect(said({ niveau: "Alerte 2-1", eruption: false, arret: ovpf })).toBe(line("Éruption arrêtée selon l'OVPF"));
  });

  it("describes /volcan within DESCRIPTION_MAX at every level and every month, the plan's words whole or not at all", () => {
    const communique = (jour: string) => ({ titre: ALERT_1, lien: "https://www.reunion.gouv.fr/x", jour });
    const hausse = { pitonlive: "Alerte 2-3", prefecture: "alerte 1", jour_pitonlive: "2026-09-24", jour_prefecture: "2026-09-24", enclos_interdit: true };
    for (const { niveau, libelle } of NIVEAUX.filter((n) => n.niveau.startsWith("Alerte"))) {
      for (let m = 1; m <= 12; m++) {
        const jour = `2026-${String(m).padStart(2, "0")}-24`;
        for (const a of [
          { niveau, eruption: false, communique: communique(jour) },
          { niveau, eruption: true, communique: communique(jour) },
          { niveau, eruption: false },
          { niveau, eruption: false, communique: communique(jour), hausse: { ...hausse, jour_prefecture: jour } },
        ] as VolcanAlerte[]) {
          const meta = volcanMeta(a);
          expect(meta.length, meta).toBeLessThanOrEqual(DESCRIPTION_MAX);
          if (!a.eruption && !a.hausse && a.communique) expect(meta.includes(`« ${libelle} »`) || !meta.includes("« "), meta).toBe(true);
        }
      }
    }
    // The longest month: the plan's words kept for alert 1; too long for alert 2-1, then left out whole.
    const sept = communique("2026-09-24");
    expect(volcanMeta({ niveau: "Alerte 1", eruption: false, communique: sept })).toBe("Alerte\u00a01 du préfet (communiqué du 24\u00a0septembre) : « éruption probable ou imminente ». Accès à l'Enclos interdit. Communiqués de l'OVPF en direct · 974");
    expect(volcanMeta({ niveau: "Alerte 2-1", eruption: false, communique: sept })).toBe("Alerte\u00a02-1 du préfet (communiqué du 24\u00a0septembre). Accès à l'Enclos interdit. Communiqués de l'OVPF en direct · 974");
  });

  it("says the OVPF's level as the OVPF's, with its post's time, never « du préfet »", () => {
    const ovpf = { date: "13/02 10:45 heure de La Réunion", lien: "https://bsky.app/profile/ovpf.bsky.social/post/3mepvumvjyc2s" };
    const a: VolcanAlerte = { niveau: "Alerte 2-1", eruption: true, ovpf, communique: { titre: ALERT_1, lien: "https://www.reunion.gouv.fr/x", jour: "2026-02-13" } };
    expect(bannerText(a)).toBe("🌋 Éruption en cours au Piton de la Fournaise (alerte 2-1 selon l'OVPF, publication du 13/02 à 10:45). Accès à l'Enclos interdit.");
    expect(homeCard(a)).toContain("Alerte\u00a02-1 selon l&#39;OVPF (publication du 13/02 à 10:45). Accès à l&#39;Enclos interdit.");
    const quiet: VolcanAlerte = { niveau: "Alerte 1", eruption: false, ovpf };
    expect(bannerText(quiet)).toBe("🌋 Piton de la Fournaise : alerte 1 selon l'OVPF (publication du 13/02 à 10:45), « éruption probable ou imminente » (dispositif ORSEC Volcan). Accès à l'Enclos interdit.");
    expect(volcanMeta(quiet)).toMatch(/^Alerte\u00a01 selon l'OVPF \(publication du 13\/02 à 10:45\)/);
    for (const text of [bannerText(a), bannerText(quiet), volcanMeta(quiet), homeCard(quiet)]) expect(text).not.toMatch(/préfet\b/);
    // The tile's line: whose the level is.
    expect(tileLive(a).source).toBe("OVPF, publication du 13/02");
    expect(tileLive({ niveau: "Alerte 1", eruption: false }).source).toBeUndefined();
  });

  it("says the OVPF's end of the eruption, the level still the release's alert 2", () => {
    const arret = { date: "13/04 06:10 heure de La Réunion", lien: "https://bsky.app/profile/ovpf.bsky.social/post/3mjdrynd4ns2g" };
    const copy = { etat: { eruption_en_cours: false, niveau_orsec: "Alerte 2-2", eruption_ovpf: { en_cours: false, ...arret }, communique_prefecture: { niveau: "Alerte 2-2", titre: "Piton de la Fournaise : passage en alerte 2-2", lien: "https://www.reunion.gouv.fr/x", jour: "2026-03-12" } } } as unknown as VolcanAnswer;
    const a = alerteVolcan(copy)!;
    expect(a).toMatchObject({ niveau: "Alerte 2-2", eruption: false, arret });
    expect(bannerText(a)).toBe("🌋 Piton de la Fournaise : alerte 2-2 du préfet (communiqué du 12\u00a0mars). L'OVPF a annoncé l'arrêt de l'éruption (publication du 13/04 à 06:10). Accès à l'Enclos interdit.");
  });

  it("never puts pitonlive's level in the banner, the title, the home page or the tile", async () => {
    // pitonlive at alert 2-1 and erupting, nothing official read: no alert put forward, its line in the body only.
    const store = new MemoryStore();
    const t = NOW.getTime();
    const s = JSON.parse(fixture("pitonlive_state.json"));
    void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky.json"))), fetchedAt: t });
    void store.put("volcan:pitonlive", { value: { ...s, status: { ...s.status, alert_level_display: "Alerte 2-1", is_erupting: true, published_at: "2026-10-24T12:00:00Z" } }, fetchedAt: t });
    void store.put("volcan:prefecture", { value: null, fetchedAt: t });
    const v = await buildVolcan(new Cache(store, () => t), NOW);
    expect(v.etat).toMatchObject({ eruption_en_cours: false, niveau_inconnu: true, pitonlive_non_officiel: { niveau: "Alerte 2-1", eruption: true, lu: "24/10 à 18:00" } });
    expect(alerteVolcan(v)).toBeUndefined();
    expect(v.resume).toContain("Nous n'avons pas pu lire le niveau d'alerte de la préfecture : vérifiez-le sur reunion.gouv.fr avant de monter au volcan. Selon pitonlive.com, site non officiel, lu le 24/10 à 18:00 : « Alerte 2-1 ». Selon pitonlive.com, site non officiel, lu le 24/10 à 18:00, une éruption est en cours. L'OVPF et la préfecture ne l'ont pas annoncée dans les textes que nous avons lus : suivez l'OVPF (https://bsky.app/profile/ovpf.bsky.social) et reunion.gouv.fr.");
    expect(v.resume).not.toMatch(/ÉRUPTION EN COURS/);
    const copy = { value: v, fetchedAt: NOW, stale: false };
    const page = volcanPage("https://rundata.re", copy, NOW);
    expect(page).toContain("<title>Piton de la Fournaise : état du volcan · 974</title>");
    expect(page).toContain(`<p class="lead">Selon pitonlive.com, site non officiel, lu le 24/10 à 18:00 : « Alerte 2-1 ».</p><p class="lead">Selon pitonlive.com, site non officiel, lu le 24/10 à 18:00, une éruption est en cours. L&#39;OVPF et la préfecture ne l&#39;ont pas annoncée dans les textes que nous avons lus : suivez l&#39;OVPF (<a href="https://bsky.app/profile/ovpf.bsky.social">bsky.app/profile/ovpf.bsky.social</a>) et reunion.gouv.fr.</p>`);
    const head = page.slice(0, page.indexOf("</h1>"));
    const home = homePage("https://rundata.re", { volcan: copy } as unknown as HomeLive, NOW);
    // The footer credits every source of the site, pitonlive « en dernier recours ».
    for (const text of [head, home.replace(/<footer[\s\S]*<\/footer>/, ""), JSON.stringify(volcanLive(copy))]) expect(text).not.toMatch(/pitonlive|Éruption en cours(?! ou non)/);
  });

  it("refreshes the shared copy every 5 minutes during an alert, every 30 otherwise", async () => {
    const every = SHARED.find((s) => s.key === "web:volcan")!.every as (last: unknown) => number;
    expect(every(await answer(ALERT_1))).toBe(5);
    expect(every(await answer())).toBe(30);
    expect(every(undefined)).toBe(30);
  });
});
