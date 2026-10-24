import { afterEach, describe, expect, it, vi } from "vitest";
import type { Info } from "../src/providers/actualites.js";
import * as pref from "../src/providers/prefecture.js";
import * as mf from "../src/providers/vigilance.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { ecoles, withPrefecture } from "../src/tools/ecoles.js";
import { ecolesPage } from "../src/web/ecoles.js";

// Saturday 24 October 2026, 14:00 at La Réunion.
const NOW = new Date("2026-10-24T10:00:00Z");
// Titles written for the tests in the shapes the prefecture gives them; the list gives the day only.
const release = (titre: string, day: string): Info =>
  ({ titre, lien: `https://www.reunion.gouv.fr/x/${encodeURIComponent(titre).slice(0, 20)}`, publie: new Date(`${day}T12:00:00+04:00`).toISOString(), media: "Préfecture de La Réunion", heure: false, communes: [], lieux: [], sujets: [] }) as Info;
const at = (local: string) => new Date(`${local}+04:00`).toISOString().replace(".000", "");
function bulletin(cyclone: [number, string, string?][]) {
  return mf.parse({
    update_time: at("2026-10-24T06:00:00"),
    timelaps: { domain_ids: [{ domain_id: mf.ISLAND, phenomenon_items: [{ phenomenon_id: mf.CYCLONE, timelaps_items: cyclone.map(([color_id, b, e]) => ({ color_id, begin_time: at(b), end_time: e && at(e) })) }] }] },
  });
}

describe("the prefecture's releases on the cyclone alert", () => {
  it("reads the step a title declares, the sauvegarde before the end of the alert", () => {
    expect(pref.decisionOf([release("Cyclone Test : déclenchement de l'alerte rouge « Je me confine » à 19h00", "2026-10-24")])).toMatchObject({ niveau: 4 });
    expect(pref.decisionOf([release("Test Alerte orange cyclonique : « Je me prépare » à partir de 19 h ce soir", "2026-10-24")])).toMatchObject({ niveau: 3 });
    // The way out of the red goes through the sauvegarde: not « Alerte levée ».
    expect(pref.decisionOf([release("Levée de l'alerte rouge, passage en phase de sauvegarde", "2026-10-24")])).toMatchObject({ niveau: 6 });
    expect(pref.decisionOf([release("Pré-alerte jaune cyclonique Test : « Je m'informe et j'anticipe »", "2026-10-24")])).toMatchObject({ niveau: 2 });
    expect(pref.decisionOf([release("Passage en alerte violette cyclonique", "2026-10-24")])).toMatchObject({ niveau: 5 });
    expect(pref.decisionOf([release("Cyclone Test : passage en phase de sauvegarde", "2026-10-24")])).toMatchObject({ niveau: 6 });
    expect(pref.decisionOf([release("Levée de l'alerte cyclonique : « Nou té bien paré »", "2026-10-24")])).toMatchObject({ niveau: "levee" });
  });

  it("declares nothing from the volcano's alerts, a rain vigilance or a release without a step", () => {
    expect(pref.decisionOf([release("Piton de la Fournaise : passage en alerte 1", "2026-10-24")])).toBeUndefined();
    expect(pref.decisionOf([release("Vigilance orange fortes pluies et orages", "2026-10-24")])).toBeUndefined();
    expect(pref.decisionOf([release("Saison cyclonique : préparez votre kit d'urgence", "2026-10-24")])).toBeUndefined();
    // A newer release without a step does not hide the older one that declares it.
    expect(pref.decisionOf([release("Cyclone Test : point de situation", "2026-10-25"), release("Alerte orange cyclonique", "2026-10-24")])).toMatchObject({ niveau: 3 });
  });

  it("knows the schools reopen only from a release that says so, after the end of the alert", () => {
    const list = [release("Réouverture des établissements scolaires lundi", "2026-10-25"), release("Levée de l'alerte cyclonique", "2026-10-24")];
    expect(pref.reopeningOf(list, list[1].publie)?.titre).toBe("Réouverture des établissements scolaires lundi");
    expect(pref.reopeningOf([list[1]], list[1].publie)).toBeUndefined();
    expect(pref.reopeningOf([release("Réouverture des écoles", "2026-10-20")], list[1].publie)).toBeUndefined();
    // « Reportée », « maintien », « restent fermés »: in doubt, no reopening read.
    for (const t of ["Réouverture des écoles reportée", "Maintien de la fermeture des écoles, pas de réouverture lundi", "Les établissements scolaires restent fermés, réouverture mardi"]) {
      expect(pref.reopeningOf([release(t, "2026-10-25")], list[1].publie), t).toBeUndefined();
    }
  });
});

describe("reading the prefecture, which can fail", () => {
  afterEach(() => vi.unstubAllGlobals());
  const page = (titles: [string, string][]) =>
    `<ul>${titles.map(([t, d]) => `<li><a class="fr-card__link" href="/Actualites/x">${t}</a><p>Publié le ${d}</p></li>`).join("")}</ul>`;

  it("keeps the last decision, and falls back on it while the prefecture fails", async () => {
    const durable = new MemoryStore();
    vi.stubGlobal("fetch", async () => new Response(page([["Alerte orange cyclonique : « Je me prépare »", "24/10/2026"]])));
    const first = await pref.cyclone(new Cache(new MemoryStore(), () => NOW.getTime(), true, durable), NOW.getTime());
    expect(first.value?.decision).toMatchObject({ niveau: 3 });
    await new Promise((r) => setTimeout(r, 10));
    // A new isolate, the prefecture down: the kept decision, said as old.
    vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed"); });
    const down = await pref.cyclone(new Cache(new MemoryStore(), () => NOW.getTime(), true, durable), NOW.getTime());
    expect(down).toMatchObject({ stale: true, value: { decision: { niveau: 3 } } });
  });

  it("takes an empty list for a failure, not for the end of the alert", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>maintenance</html>"));
    await expect(pref.releases(new Cache(new MemoryStore(), () => NOW.getTime()))).rejects.toThrow(/liste des communiqués vide/);
  });
});

describe("the schools' state with the prefecture's releases", () => {
  const cyc = (titre: string, day = "2026-10-24", reopen?: Info) => {
    const d = pref.decisionOf([release(titre, day)])!;
    return { decision: d, reouverture: reopen && { titre: reopen.titre, lien: reopen.lien, publie: reopen.publie } };
  };

  it("cites the release that confirms the bulletin's step, by its day of publication, never as the day decided", () => {
    const v = bulletin([[8, "2026-10-24T06:00:00"]]);
    const e = withPrefecture(ecoles(v, NOW), cyc("Alerte orange cyclonique à compter de 5h"), v, NOW);
    expect(e.communique).toBe("Alerte orange, confirmée par le communiqué de la préfecture du samedi 24/10 : « Alerte orange cyclonique à compter de 5h » →");
    expect(e.ecart).toBeUndefined();
    expect(JSON.stringify(e)).not.toMatch(/décidée le/);
    // A recent release that does not confirm it: cited as the latest.
    const pre = bulletin([]);
    expect(withPrefecture(ecoles(pre, NOW), cyc("Pré-alerte jaune cyclonique Test"), pre, NOW).communique).toBe("Dernier communiqué de la préfecture, du samedi 24/10 : « Pré-alerte jaune cyclonique Test » →");
  });

  it("says the end of the alert from the release, and the reopening only when a release says it", () => {
    const v = bulletin([]);
    const lifted = withPrefecture(ecoles(v, NOW), cyc("Levée de l'alerte cyclonique"), v, NOW);
    expect(lifted).toMatchObject({ etat: "levee", texte: "Alerte levée, d'après le communiqué de la préfecture du samedi 24/10 : « Levée de l'alerte cyclonique » → La réouverture des écoles est annoncée par la préfecture et le rectorat (ac-reunion.fr) : elle n'est pas encore lue ici." });
    const reopen = release("Réouverture des établissements scolaires lundi 26 octobre", "2026-10-24");
    const open = withPrefecture(ecoles(v, NOW), cyc("Levée de l'alerte cyclonique", "2026-10-24", reopen), v, NOW);
    expect(open.texte).toBe("Alerte levée. Réouverture des écoles annoncée par la préfecture le samedi 24/10 : « Réouverture des établissements scolaires lundi 26 octobre » → Le détail, avec les éventuelles exceptions par commune, est dans le communiqué.");
    expect(open.cites).toEqual([{ titre: reopen.titre, lien: reopen.lien, publie: reopen.publie }]);
  });

  it("says both when the release and the bulletin disagree, and chooses neither", () => {
    const v = bulletin([[8, "2026-10-24T06:00:00"]]);
    const e = withPrefecture(ecoles(v, NOW), cyc("Levée de l'alerte cyclonique"), v, NOW);
    expect(e.etat).toBe("orange_avant_ouverture");
    expect(e.fermees).toBe(true);
    expect(e.ecart).toBe("Le communiqué de la préfecture du samedi 24/10 annonce la fin de l'alerte : « Levée de l'alerte cyclonique » → Le bulletin de Météo-France émis le samedi 24/10 à 06:00 indique l'alerte orange. Nous montrons les deux : vérifiez sur reunion.gouv.fr.");
  });

  it("links each cited title on /ecoles-cyclone", () => {
    const v = bulletin([[8, "2026-10-24T06:00:00"]]);
    const c = cyc("Alerte orange cyclonique à compter de 5h");
    const html = ecolesPage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW, undefined, c);
    expect(html).toContain(`Alerte orange, confirmée par le communiqué de la préfecture du samedi 24/10 : <a href="${c.decision.lien}" rel="noopener">« Alerte orange cyclonique à compter de 5h » →</a>`);
  });

  it("leaves last season's releases out", () => {
    const v = bulletin([]);
    expect(withPrefecture(ecoles(v, NOW), cyc("Levée de l'alerte cyclonique", "2026-03-01"), v, NOW)).toEqual(ecoles(v, NOW));
  });
});
