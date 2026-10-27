import { describe, expect, it } from "vitest";
import { handle } from "../src/app.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { CSR_URL, inForce, requinBlock, SOURCE, STORIES, T, ZONES, zonesNear } from "../src/eau/requin.js";
import { bathingPage, LINE } from "../src/web/baignade.js";
import { placePage, seaPage } from "../src/web/pages.js";
import { coastal, PAGES, pageOf } from "../src/web/places.js";

const O = "https://rundata.re";
const NOW = new Date("2026-10-24T16:00:00Z");
const AFTER = new Date("2027-02-16T00:00:00+04:00");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ");
// What an answer must never say: that a place is free of sharks or of risk, or that a zone is open today.
const NEVER = /pas de requin|sans requin|baignade s[uû]re|sans risque|s[ée]curis|prot[ée]g|(?<!si une zone )est ouverte aujourd'hui|ouvert aujourd'hui/i;

describe("the shark rule and the zones where bathing is allowed", () => {
  it("apply the decree n° 180 up to the end of 15/02/2027, Réunion time", () => {
    expect(inForce(new Date("2026-02-16T00:00:00+04:00"))).toBe(true);
    expect(inForce(new Date("2027-02-15T23:59:00+04:00"))).toBe(true);
    expect(inForce(AFTER)).toBe(false);
  });

  it("give a lagoon beach its lagoon, and a beach far from any zone where the list comes from", () => {
    const b = requinBlock(NOW, { nom: "L'Hermitage", lon: 55.2265, lat: -21.0743 });
    expect(b.regle).toBe(`${T.regle} ${T.reduit}`);
    expect(b.zones).toEqual([T.intro, "Lagon de l'Hermitage : lagon, baignade permise dans les conditions fixées par la commune (arrêté préfectoral n° 180, art. 2).",
      "ZONEX de l'Hermitage : ZONEX, zone où la baignade et les activités de vague sont permises seulement quand elle est ouverte et surveillée.",
      "ZONEX des Brisants : ZONEX, zone où la baignade et les activités de vague sont permises seulement quand elle est ouverte et surveillée (BSAN et RESSAC).",
      "Roches Noires : zone de baignade fermée par un filet, permise seulement quand elle est ouverte et surveillée.",
      "ZONEX des Roches Noires : ZONEX, zone où la baignade et les activités de vague sont permises seulement quand elle est ouverte et surveillée (BSAN et RESSAC).",
      "BSAN : Brigade de sécurité des activités nautiques.", T.ouverture]);
    expect(b.deploiements_du_jour).toEqual({
      texte: "Les filets et les ZONEX déployés dans la journée sont annoncés dans les stories Instagram et Facebook du GIP Centre Sécurité Requin.",
      instagram: "https://www.instagram.com/centresecuriterequin_reunion/",
      facebook: "https://www.facebook.com/centresecuriterequin/",
    });
    expect(b.source_des_zones).toEqual({ texte: "Source : GIP Centre Sécurité Requin", lien: CSR_URL });
    expect(b.drapeaux).toBe(T.drapeaux);
    const none = requinBlock(NOW, { nom: "Sainte-Clotilde", lon: 55.4853, lat: -20.8848 });
    expect(none.zones).toBe("Aucune zone du GIP Centre Sécurité Requin près de Sainte-Clotilde. Hors lagon et espace aménagé et surveillé, la baignade et le surf y sont interdits dans la bande des 300 m (arrêté préfectoral n° 180).");
    // A commune gets every zone of its own, even a few kilometres off.
    expect(zonesNear(55.2882, -21.1678, "Saint-Leu").map((z) => z.nom)).toEqual(["Lagon de Saint-Leu", "ZONEX de Saint-Leu (spots « la passe / le port » et « la Gauche »)"]);
    expect(zonesNear(55.27, -21.01, "Saint-Paul").map((z) => z.type).sort()).toEqual(["bassin", "filet", "filet", "filet_ete", "lagon", "zonex", "zonex", "zonex", "zonex", "zonex"]);
    // No BSAN line where none of its zones is said.
    expect(requinBlock(NOW, { nom: "Manapany", lon: 55.5882, lat: -21.3733 }).zones).not.toContain(T.bsan);
  });

  it("once the decree has ended, say nothing permitted or forbidden on its strength, but keep the commune's ban and the flags", () => {
    const b = requinBlock(AFTER);
    expect(b.regle).toBe(T.echu);
    const lines = (b.zones as string[]).slice(1, -1);
    expect(lines).toHaveLength(ZONES.length);
    for (const l of lines.filter((x) => !x.startsWith("Bassin naturel de Grand-Anse"))) expect(l).not.toMatch(/permis|interdit|arrêté|ouvert/);
    // What the GIP says of Grand-Anse comes from it, not from the decree.
    expect(lines).toContain("Bassin naturel de Grand-Anse : de nouveau ouvert au public, d'après le GIP Centre Sécurité Requin (27/10/2026).");
    expect(lines).not.toContain(T.bsan);
    expect(lines).toContain("Filet de la baie de Saint-Paul : filet de baignade ponctuel, déployé en été.");
    expect(lines).toContain("ZONEX des Brisants : ZONEX.");
    expect(b.drapeaux).toBe(T.drapeaux);
    expect(requinBlock(AFTER, { nom: "Sainte-Clotilde", lon: 55.4853, lat: -20.8848 }).zones).toBe("Aucune zone du GIP Centre Sécurité Requin près de Sainte-Clotilde.");
    expect(text(bathingPage(O, AFTER))).not.toMatch(/n°\s180 du 13\/02\/2026, en vigueur/);
  });

  it("put the block on /mer and on every coastal place's page, never on the Hauts", () => {
    const sea = seaPage(O, null, NOW);
    expect(sea).toContain(`<h2 id="h-requin">Baignade et requins</h2>`);
    expect(sea).toContain(`<a href="/baignade">Toutes les zones et la règle →</a>`);
    expect(text(placePage(O, pageOf("l-hermitage")!, null, NOW))).toContain("Lagon de l'Hermitage : lagon, baignade permise");
    expect(placePage(O, pageOf("cilaos")!, null, NOW)).not.toContain("h-requin");
    expect(LINE).toBe(`Baignade et requins : <a href="/baignade">toutes les zones et la règle →</a>`);
    for (const p of PAGES) expect(placePage(O, p, null, NOW).includes(`id="h-requin"`), p.slug).toBe(coastal(p));
  });

  it("never say a place is free of sharks or of risk, nor a zone open today", () => {
    const pages = [bathingPage(O, NOW), bathingPage(O, AFTER), seaPage(O, null, NOW), ...PAGES.filter(coastal).flatMap((p) => [placePage(O, p, null, NOW), placePage(O, p, null, AFTER)])];
    for (const html of pages) expect(text(html)).not.toMatch(NEVER);
    for (const now of [NOW, AFTER]) for (const p of PAGES) expect(JSON.stringify(requinBlock(now, { nom: p.nom, ...p.place }))).not.toMatch(NEVER);
  });

  it("serve /baignade with marketing's title, description and the zones by commune", async () => {
    const r = await handle(new Request(`${O}/baignade`), new Cache(new MemoryStore(), () => NOW.getTime()));
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("<title>Baignade et requins à La Réunion\u00a0: où se baigner · 974</title>");
    expect(html).toContain(`<meta name="description" content="Requins\u00a0: baignade et surf interdits à moins de 300\u00a0m du rivage, sauf lagons, bassins, filets et ZONEX surveillés. Zones, drapeaux et arrêté en vigueur.">`);
    expect(html).toContain("<h1>Où se baigner à La Réunion\u00a0?</h1>");
    expect(html).toContain("<p>Le GIP Centre Sécurité Requin ne cite pas de zone dans les autres communes.</p>");
    expect(html).toContain(`<a href="/eau">Qualité de l'eau\u00a0: les contrôles de l'ARS, plage par plage et bassin par bassin →</a>`);
    // Not cut at the end of a line.
    expect(html).toContain("Arrêté préfectoral n°\u00a0180 du 13/02/2026");
    expect(html).toContain("bande des 300\u00a0m de tout le littoral");
    expect(html).toContain("art.\u00a02)");
    expect(html.slice(html.indexOf("<body"))).not.toMatch(/n° 180|300 m |art\. 2/);
    const heads = [...html.slice(html.indexOf('id="h-zones"'), html.indexOf('id="h-drapeaux"')).matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1].replace("&#39;", "'"));
    expect(heads.slice(0, 4)).toEqual(["Saint-Paul", "Les Trois-Bassins", "Saint-Leu", "L'Étang-Salé"]);
    // Every zone under a commune of the page.
    expect(new Set(heads)).toEqual(new Set(ZONES.map((z) => z.commune)));
    expect(html).toContain('href="https://www.reunion.gouv.fr/Publications/Publications-administratives-et-legales/Recueil-des-actes-administratifs-RAA/Recueil-des-actes-administratifs-2026/Special-n-35-du-13-fevrier-2026"');
  });

  it("give the zones as the GIP Centre Sécurité Requin corrected them on 27/10/2026, with its name, its link and its stories", async () => {
    const byCommune = (c: string) => ZONES.filter((z) => z.commune === c).map((z) => `${z.nom} (${z.type})`);
    expect(byCommune("Saint-Paul")).toEqual([
      "Filet de la baie de Saint-Paul (filet_ete)", "Piscine naturelle de Boucan-Canot (bassin)", "Boucan-Canot (filet)", "ZONEX de Boucan-Canot (zonex)",
      "ZONEX des Aigrettes (zonex)", "Roches Noires (filet)", "ZONEX des Roches Noires (zonex)", "ZONEX des Brisants (zonex)",
      "Lagon de l'Hermitage (lagon)", "ZONEX de l'Hermitage (zonex)",
    ]);
    expect(byCommune("Les Trois-Bassins")).toEqual(["ZONEX de Trois-Bassins (zonex)"]);
    expect(byCommune("Saint-Leu")).toEqual(["Lagon de Saint-Leu (lagon)", "ZONEX de Saint-Leu (spots « la passe / le port » et « la Gauche ») (zonex)"]);
    expect(byCommune("L'Étang-Salé")).toEqual(["L'Étang-Salé (filet)", "ZONEX de L'Étang-Salé (spot « le bord ») (zonex)"]);
    expect(byCommune("Petite-Île")).toEqual(["Bassin naturel de Grand-Anse (bassin_naturel)"]);
    expect(byCommune("Saint-Philippe")).toEqual(["Piscine du Baril les Bains (bassin)"]);
    expect(ZONES).toHaveLength(19);
    expect(ZONES.filter((z) => z.par).map((z) => z.nom)).toEqual(["ZONEX des Roches Noires", "ZONEX des Brisants", "ZONEX de Saint-Leu (spots « la passe / le port » et « la Gauche »)"]);
    // Trois-Bassins' own ZONEX, even from the commune's centre, up in the Hauts.
    expect(zonesNear(55.29807, -21.10444, "Les Trois-Bassins").map((z) => z.nom)).toContain("ZONEX de Trois-Bassins");
    const all = JSON.stringify(requinBlock(NOW));
    expect(all).toContain("Bassin naturel de Grand-Anse : de nouveau ouvert au public, d'après le GIP Centre Sécurité Requin (27/10/2026).");
    expect(all).toContain("Filet de la baie de Saint-Paul : filet de baignade ponctuel, déployé en été\u00a0; baignade permise seulement quand il est ouvert et surveillé.");
    expect(all).not.toMatch(/Water Patrol|depuis 2014|bassin aménagé/);
    expect(all).toContain("Piscine naturelle de Boucan-Canot : bassin, baignade permise seulement quand il est ouvert et surveillé.");
    expect(requinBlock(AFTER).zones).toContain("Piscine du Baril les Bains : bassin.");
    expect(SOURCE.organisme).toBe("Préfecture de La Réunion\u00a0; GIP Centre Sécurité Requin");
    expect(SOURCE.licence).toBe("Information publique (arrêté préfectoral, reunion.gouv.fr)\u00a0; GIP Centre Sécurité Requin : zones reprises avec son accord écrit du 27/10/2026");

    const html = await (await handle(new Request(`${O}/baignade`), new Cache(new MemoryStore(), () => NOW.getTime()))).text();
    expect(html).toContain(`Source\u00a0: <a href="${CSR_URL}">GIP Centre Sécurité Requin</a>.`);
    expect(html).toContain(`<a href="${STORIES.instagram}">Instagram</a> et <a href="${STORIES.facebook}">Facebook</a> du GIP Centre Sécurité Requin.`);
    expect(html).toContain("<p>BSAN\u00a0: Brigade de sécurité des activités nautiques.</p>");
    // The block of a coastal place's page links them too.
    const place = placePage(O, pageOf("saint-leu")!, null, NOW);
    expect(place).toContain(`<a href="${CSR_URL}">GIP Centre Sécurité Requin</a>`);
    expect(place).toContain(`<a href="${STORIES.instagram}">Instagram</a>`);
  });
});
