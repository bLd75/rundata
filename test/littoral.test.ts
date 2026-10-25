import { describe, expect, it } from "vitest";
import { counted } from "../src/budget.js";
import { Cache, MemoryStore } from "../src/cache.js";
import type { Fil, Info } from "../src/providers/actualites.js";
import { actualites, infoRow } from "../src/tools/actualites.js";
import { annonceOf, etatText, forSummary, littoral, NONE } from "../src/tools/littoral.js";
import { resume } from "../src/tools/resume.js";
import { type ActualitesAnswer, type TraficAnswer, withRoadNews } from "../src/web/data.js";
import { traficPage } from "../src/web/domains.js";
import { pageOf } from "../src/web/places.js";

// Saturday 24/10/2026, 19:00 in La Réunion.
const NOW = new Date("2026-10-24T15:00:00Z");
const O = "https://rundata.re";
const H = 3600_000;
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

const item = (titre: string, hoursAgo: number, media = "Freedom", resume?: string): Info => ({
  titre,
  resume,
  media,
  lien: `https://exemple.re/${encodeURIComponent(titre).slice(0, 40)}`,
  publie: new Date(NOW.getTime() - hoursAgo * H).toISOString(),
  heure: true,
  communes: [],
  lieux: [],
  sujets: ["route"],
});
const fil = (infos: Info[], prefecture: Info[] = []): Fil => ({ infos, prefecture, indisponible: [] });
const one = (titre: string, resume?: string) => annonceOf(item(titre, 1, "Freedom", resume));

describe("the route du Littoral as the media announce it", () => {
  it("reads the state a headline announces, and only that", () => {
    expect(one("Route du Littoral : basculement en 2x1 voies côté montagne à partir de 20h")).toMatchObject({ etat: "basculée" });
    expect(one("Houle : la route du Littoral fermée dans les deux sens")).toMatchObject({ etat: "fermée", deux_sens: true });
    expect(one("La route du Littoral sera fermée ce soir")).not.toHaveProperty("deux_sens");
    expect(one("Route du Littoral : fermeture de nuit de 21h à 5h du lundi 26 au mercredi 28 octobre")).toMatchObject({
      etat: "fermée la nuit", horaire: { de: "21:00", a: "05:00" }, dates: { du: "26/10", au: "28/10" },
    });
    expect(one("Travaux : la route du Littoral fermée la nuit prochaine")).toMatchObject({ etat: "fermée la nuit" });
    expect(one("Route du Littoral : réouverture prévue à 5h30 sur 2x1 voies")).toMatchObject({ etat: "réouverture", a: "05:30", voies: "2×1" });
    expect(one("Fin du basculement sur la route du Littoral", "La circulation revient à quatre voies.")).toMatchObject({ etat: "4 voies" });
    expect(one("RN1 entre Saint-Denis et La Possession : retour à 4 voies")).toMatchObject({ etat: "4 voies" });
  });

  it("leaves out what names the road without a state, and the other roads", () => {
    // Read on 24/10/2026: the protest near the new road, the Barachois on the RN1 in Saint-Denis.
    expect(one("- Saint-Denis : tensions sur le Barachois", "Montée de tension sur le Barachois lorsque les manifestants ont décidé de monter vers la caserne Lambert et le rond-point donnant accès à la Nouvelle route du littoral.")).toBeUndefined();
    expect(one("- Le Barachois rouvert à la circulation -", "Peu avant 16 heures 30, le CRGT informe, dans un communiqué, que sur les RN1 et RN2 à Saint Denis, le Barachois est rouvert à la circulation dans les deux sens.")).toBeUndefined();
    expect(one("NRL : le chantier de la digue de La Possession avance")).toBeUndefined();
    expect(one("Saint-Benoît : circulation interdite entre l'échangeur de Beaulieu et le giratoire des Plaines")).toBeUndefined();
  });

  it("gives each source's latest announcement of the last 36 hours, and two that disagree", () => {
    const l = littoral(fil([
      item("Route du Littoral : basculement en 2x1 voies", 1, "Freedom"),
      item("La route du Littoral fermée", 3, "Freedom"),
      item("Route du Littoral : retour à 4 voies", 2, "Clicanoo"),
    ]), NOW)!;
    // Freedom's first article is not set against its later one; Clicanoo's, an hour before, is.
    expect(l.annonces.map((a) => [a.etat, a.media])).toEqual([["basculée", "Freedom"], ["4 voies", "Clicanoo"]]);
    expect(littoral(fil([item("Route du Littoral : basculement en 2x1 voies", 1), item("Route du Littoral : retour à 4 voies", 4, "Clicanoo")]), NOW)!.annonces).toHaveLength(1);
    expect(littoral(fil([item("La route du Littoral fermée", 37)]), NOW)).toBeUndefined();
    const prefecture = littoral(fil([], [{ ...item("Route du Littoral : fermeture de nuit", 2), heure: false }]), NOW)!;
    expect(prefecture.annonces[0]).toMatchObject({ media: "la préfecture", prefecture: true });
  });

  it("does not tell a night closure past its last morning, nor a reopening hours past its hour", () => {
    // Published Saturday 24/10 at 18:00: the nights of Monday 26 to Wednesday 28, from 21:00 to 05:00.
    const nights = (now: Date) => littoral(fil([{ ...item("Route du Littoral : fermeture de nuit de 21h à 5h du lundi 26 au mercredi 28 octobre", 1), publie: "2026-10-24T14:00:00.000Z" }]), now, 120);
    expect(nights(new Date("2026-10-28T00:30:00Z"))).toBeDefined(); // 28/10 at 04:30
    expect(nights(new Date("2026-10-28T01:30:00Z"))).toBeUndefined(); // 28/10 at 05:30
    // Published at 22:00 for 05:30: the next morning, told until 11:30.
    const reopening = (now: Date) => littoral(fil([{ ...item("Route du Littoral : réouverture prévue à 5h30", 1), publie: "2026-10-24T18:00:00.000Z" }]), now);
    expect(reopening(new Date("2026-10-25T07:00:00Z"))).toBeDefined(); // 25/10 at 11:00
    expect(reopening(new Date("2026-10-25T08:00:00Z"))).toBeUndefined(); // 25/10 at 12:00
    // A night closure without dates, a reopening without an hour: kept the 36 hours.
    expect(littoral(fil([item("Route du Littoral fermée cette nuit", 30)]), NOW)).toBeDefined();
  });

  it("words the state as marketing does", () => {
    expect(etatText(one("Route du Littoral : basculement en 2x1")!)).toBe("Basculée sur 2×1 voies, côté montagne");
    expect(etatText(one("Fin du basculement sur la route du Littoral")!)).toBe("Circulation sur 4 voies (2×2)");
    expect(etatText(one("La route du Littoral fermée dans les deux sens")!)).toBe("Fermée dans les deux sens");
    expect(etatText(one("Route du Littoral : fermeture de nuit de 21h à 5h du 26 au 28 octobre")!)).toBe("Fermée la nuit, de 21:00 à 05:00, du 26/10 au 28/10");
    expect(etatText(one("Route du Littoral fermée cette nuit")!)).toBe("Fermeture de nuit annoncée");
    expect(etatText(one("Route du Littoral : réouverture à 5h sur 4 voies")!)).toBe("Réouverture annoncée à 05:00 sur 4 voies");
    expect(etatText(one("Route du Littoral : réouverture annoncée")!)).toBe("Réouverture annoncée");
  });

  it("is a card of /trafic, with the article's time, never a measure, and kept when no medium announced anything", () => {
    const d = { bus: null, routes_forestieres: null, sources: [] } as TraficAnswer;
    const page = (news: Fil | undefined) => traficPage(O, { value: withRoadNews(d, news, NOW), fetchedAt: NOW, stale: false }, NOW);
    const html = page(fil([item("Route du Littoral : basculement en 2x1 voies", 1, "Clicanoo")]));
    expect(html).toContain(`<h2 id="route-du-littoral">Route du Littoral : ce qu'en disent les médias</h2>`);
    expect(html).toMatch(/<b>Basculée sur 2×1 voies, côté montagne<\/b>, selon Clicanoo, <a href="https:\/\/exemple\.re\/[^"]+" rel="noopener">article<\/a> publié aujourd&#39;hui à 18:00\./);
    expect(html).toContain(`Ce que publient les médias, pas une mesure : l&#39;état officiel, en direct, est sur <a href="https://www.infotrafic.re/">infotrafic.re</a>.`);
    const description = /<meta name="description" content="([^"]*)"/.exec(html)![1];
    expect(description).toBe("Route du Littoral : basculée sur 2×1 voies selon Clicanoo (18:00). Bouchons à La Réunion (974) : carte Waze, état officiel sur infotrafic.re.");
    expect(description.length).toBeLessThanOrEqual(160);
    // Older than 6 hours: the last one found, not the state of now.
    expect(page(fil([item("La route du Littoral fermée", 8)]))).toContain("Dernière annonce, il y a 8 h : <b>Fermée</b>, selon Freedom");
    // Two that disagree: both, the newest first.
    const two = page(fil([item("Route du Littoral : basculement en 2x1 voies", 1), item("Route du Littoral : retour à 4 voies", 2, "Clicanoo")]));
    expect(two).toContain("Les annonces ne disent pas la même chose (la plus récente en premier). Vérifiez sur <a href=\"https://www.infotrafic.re/\">infotrafic.re</a>.");
    expect(two.indexOf("Basculée")).toBeLessThan(two.indexOf("Circulation sur 4 voies"));
    // None: the card stays, and says nothing it could only guess.
    const none = page(fil([item("Saint-Denis : le rond-point du Chaudron bloqué", 1)]));
    expect(none).toContain(NONE.replace("infotrafic.re.", `<a href="https://www.infotrafic.re/">infotrafic.re</a>.`).replace(/'/g, "&#39;"));
    expect(/<meta name="description" content="([^"]*)"/.exec(none)![1]).toBe("Circulation à La Réunion (974) : carte Waze des bouchons, route du Littoral selon les médias, état officiel sur infotrafic.re, retards des bus.");
    for (const h of [html, none]) {
      const card = h.slice(h.indexOf('id="route-du-littoral"'), h.indexOf('id="h-officiel"'));
      expect(card).not.toMatch(/circulation normale|\bouverte\b|en temps réel|mesuré/i);
    }
  });

  it("comes with the news of La Possession or Saint-Denis, or of the roads, in the tool actualites", async () => {
    const store = new MemoryStore();
    await store.put("actualites:fil", { value: fil([item("Route du Littoral : basculement en 2x1 voies", 1, "Clicanoo"), item("Saint-Pierre : un concert", 1)]), fetchedAt: NOW.getTime() });
    const cache = new Cache(store, () => NOW.getTime());
    const { value, used } = await counted(40, () => actualites(cache, "La Possession", undefined, undefined, NOW));
    expect(used).toBe(0);
    expect(body(value).route_du_littoral).toMatchObject({
      annonce: expect.stringMatching(/^Basculée sur 2×1 voies, côté montagne, selon Clicanoo, article publié aujourd'hui à 18:00 \(https:\/\/exemple\.re\//),
      a_savoir: "Ce que publient les médias, pas une mesure : l'état officiel, en direct, est sur infotrafic.re.",
    });
    expect(body(await actualites(cache, "route du Littoral", undefined, undefined, NOW)).route_du_littoral).toBeDefined();
    expect(body(await actualites(cache, undefined, "route", undefined, NOW)).route_du_littoral).toBeDefined();
    expect(body(await actualites(cache, "Saint-Pierre", undefined, undefined, NOW)).route_du_littoral).toBeUndefined();
  });

  it("says when no article of the last 36 hours names the road, never that it is open", async () => {
    const store = new MemoryStore();
    // A fait divers at La Possession, an announcement older than 36 hours: neither is an announcement on the road.
    await store.put("actualites:fil", { value: fil([item("La Possession : un enfant percuté par un 4x4", 1, "Imaz Press"), item("Route du Littoral : basculement en 2x1 voies", 37, "Clicanoo")]), fetchedAt: NOW.getTime() });
    const cache = new Cache(store, () => NOW.getTime());
    const asked = [["route du Littoral"], ["route littoral"], ["RN1"], ["la RN 1"], ["La Possession"], ["Saint-Denis"], [undefined, "circulation"]];
    for (const [lieu, sujet] of asked) {
      const road = body(await actualites(cache, lieu, sujet, undefined, NOW)).route_du_littoral;
      expect(road, `${lieu ?? sujet}`).toEqual({
        annonce: "Pas d'annonce récente sur la route du Littoral dans les titres des médias et de la préfecture que nous avons lus. L'état officiel, en direct, est sur infotrafic.re.",
        aucune_annonce: true,
        etat_officiel: "https://www.infotrafic.re/",
      });
      expect(JSON.stringify(road)).not.toMatch(/ouverte|normale|rétabli/i);
    }
    expect(body(await actualites(cache, "Saint-Pierre", undefined, undefined, NOW)).route_du_littoral).toBeUndefined();
  });

  it("is in the summary of La Possession and Saint-Denis only, under 12 hours old", () => {
    const answer = (infos: Info[]) => ({ value: { infos: infos.map((i) => infoRow(i, NOW)), en_direct: [], prefecture: [] } as unknown as ActualitesAnswer, fetchedAt: NOW, stale: false });
    const said = (slug: string, infos: Info[]) => resume(pageOf(slug)!, { actualites: answer(infos) }, NOW).circulation.route_du_littoral;
    expect(said("la-possession", [item("Route du Littoral : basculement en 2x1 voies", 1, "Clicanoo")])).toBe(
      "Route du Littoral : basculée sur 2×1 voies, côté montagne, selon Clicanoo (aujourd'hui à 18:00) ; état officiel sur infotrafic.re.",
    );
    expect(said("saint-denis", [item("La route du Littoral fermée", 8)])).toBe("Route du Littoral, dernière annonce il y a 8 h : fermée, selon Freedom (aujourd'hui à 11:00) ; état officiel sur infotrafic.re.");
    expect(said("saint-denis", [item("La route du Littoral fermée", 13)])).toBeUndefined();
    expect(said("saint-paul", [item("Route du Littoral : basculement en 2x1 voies", 1)])).toBeUndefined();
    expect(forSummary(undefined, NOW)).toBeUndefined();
  });

  it("says in the summary of La Possession and Saint-Denis when no recent headline names it, only once the news read reach that far back", () => {
    const answer = (infos: Info[]) => ({ value: { infos: infos.map((i) => infoRow(i, NOW)), en_direct: [], prefecture: [] } as unknown as ActualitesAnswer, fetchedAt: NOW, stale: false });
    const said = (slug: string, infos: Info[]) => resume(pageOf(slug)!, { actualites: answer(infos) }, NOW).circulation.route_du_littoral;
    const quiet = [item("La Possession : un enfant percuté par un 4x4", 1, "Imaz Press"), item("Saint-Denis : un concert", 14)];
    for (const slug of ["la-possession", "saint-denis"]) expect(said(slug, quiet)).toBe(NONE);
    expect(NONE).not.toMatch(/ouverte|normale|\d+ ?h\b/i);
    // The news read go back 2 hours only: one could have been left out of the copy.
    expect(said("la-possession", [item("Saint-Denis : un concert", 2)])).toBeUndefined();
    // An announcement older than the summary's hours was read: not « none ».
    expect(said("saint-denis", [...quiet, item("La route du Littoral fermée", 13)])).toBeUndefined();
    expect(said("saint-paul", quiet)).toBeUndefined();
  });

  it("knows the road asked as « RN1 » or « route littoral », not the RN1 elsewhere", async () => {
    expect(annonceOf(item("Route littoral : basculement en 2x1 voies", 1))?.etat).toBe("basculée");
    expect(annonceOf(item("RN1 : la route fermée à Saint-Leu après un accident", 1))).toBeUndefined();
    expect(annonceOf(item("Saint-Benoît : la route littorale fermée", 1))).toBeUndefined();
    const store = new MemoryStore();
    await store.put("actualites:fil", { value: fil([item("Saint-Pierre : un concert", 1)]), fetchedAt: NOW.getTime() });
    const cache = new Cache(store, () => NOW.getTime());
    for (const lieu of ["RN1 Saint-Leu", "Saint-Leu", "RN2"]) expect(body(await actualites(cache, lieu, undefined, undefined, NOW)).route_du_littoral, lieu).toBeUndefined();
  });
});

