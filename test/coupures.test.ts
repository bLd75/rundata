import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { communesIn, parseNotice, textOf } from "../src/providers/avis-eau.js";
import { coupuresEau } from "../src/tools/coupures.js";
import { coupuresCommunePage, waterLive } from "../src/web/coupures.js";
import { buildCoupures } from "../src/web/data.js";
import { pageOf } from "../src/web/places.js";
import { site } from "../src/web/site.js";

// The distributors' notices on 24/10/2026 in the morning: a cut announced in Saint-Denis for Monday night, the water
// of La Plaine-des-Palmistes and of Grand Ilet (Salazie) not to be drunk, Saint-Benoît back to normal since the 15th.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/avis-eau/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());

describe("coupures d'eau", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: string) => {
      const file = url.includes("dioneo") ? "dioneo.xml" : url.includes("runeo") ? "runeo.xml" : url.includes("possession") ? "possession.xml" : "cirest.json";
      return new Response(fixture(file));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the hours and streets of a cut", () => {
    const n = parseNotice("Dionéo informe ses clients de SAINT DENIS, qu'en raison de travaux sur le réseau, l'alimentation en eau sera interrompue à partir de 21:00 le 26/10/2026 pour les secteurs suivants :\nROUTE DE BOIS DE NEFLES\nDes perturbations dans la distribution de l'eau sont à prévoir.\nLa remise en eau est prévue à partir de 05:00 le 27/10/2026, sauf incident.");
    expect(n).toEqual({ debut: "2026-10-26T21:00", fin: "2026-10-27T05:00", secteurs: ["ROUTE DE BOIS DE NEFLES"] });
    expect(communesIn("clients de SAINT DENIS")).toEqual(["Saint-Denis"]);
    expect(communesIn("abonnés de La Plaine-des-Palmistes")).toEqual(["La Plaine-des-Palmistes"]);
  });

  it("keeps only the text of a notice, even with broken tags", () => {
    expect(textOf("Coupure<br>rue <b>Jean</b>")).toBe("Coupure\nrue Jean");
    expect(textOf("<scr<script>ipt>x</script> rien > à <signaler")).not.toMatch(/[<>]/);
  });

  it("says first where the water is not to be drunk, and not where it is again", async () => {
    const b = body(await coupuresEau(cache(), undefined, NOW));
    expect(b.ne_pas_boire).toEqual(["La Plaine-des-Palmistes", "Salazie"]);
    expect(b.avis.filter((n: { ne_pas_boire?: boolean }) => n.ne_pas_boire)).toHaveLength(2);
    expect(b.avis.every((n: { texte: string }) => !/\p{Extended_Pictographic}/u.test(n.texte))).toBe(true);
  });

  it("gives a cut to come with its hours", async () => {
    const b = body(await coupuresEau(cache(), "Saint-Denis", NOW));
    expect(b.resume).toBe("1 avis récent ou à venir à Saint-Denis : Travaux sur le réseau / RD49.");
    expect(b.avis[0].coupure).toEqual({ de: "lundi 26/10 à 21:00", a: "mardi 27/10 à 05:00", etat: "à venir" });
  });

  it("warns for a commune whose water is not to be drunk", async () => {
    const b = body(await coupuresEau(cache(), "Plaine des Palmistes", NOW));
    expect(b.resume).toMatch(/^EAU À NE PAS BOIRE à La Plaine-des-Palmistes \(secteurs dans l'avis\), d'après l'avis du 23\/10\/2026 à 21:49/);
    expect(b.ne_pas_boire.titre).toMatch(/RESTRICTION D’USAGE DE L’EAU/);
  });

  it("says when a commune's distributor publishes nothing read here", async () => {
    const b = body(await coupuresEau(cache(), "Saint-Paul", NOW));
    expect(b.resume).toBe("Pas d'avis en ligne lisible pour Saint-Paul : voir la mairie ou le distributeur d'eau.");
    // runéo's feed is read: no notice for Saint-Pierre is no cut announced.
    expect(body(await coupuresEau(cache(), "Saint-Pierre", NOW)).resume).toBe("Aucun avis de coupure récent ou à venir à Saint-Pierre.");
  });

  it("gives each commune its page: its notices, or none at the time of the copy, and who distributes its water", async () => {
    const coupures = { value: await buildCoupures(cache(), NOW), fetchedAt: NOW };
    const page = (slug: string) => coupuresCommunePage("https://rundata.re", pageOf(slug)!, { coupures }, NOW);
    const sd = page("saint-denis");
    expect(sd).toContain("<title>Coupure d&#39;eau Saint-Denis aujourd&#39;hui : avis en cours · 974</title>");
    expect(sd).toContain("<h1>Coupures d'eau à Saint-Denis</h1>");
    expect(sd).toContain("ROUTE DE BOIS DE NEFLES");
    expect(sd).toContain("<b>Dionéo</b> distribue l'eau à Saint-Denis");
    expect(sd).toContain(`<li><a href="/coupures-eau">Coupures d'eau</a></li><li aria-current="page">Saint-Denis</li>`);
    const pdp = page("la-plaine-des-palmistes");
    expect(pdp).toContain("<b>eau à ne pas boire</b>");
    expect(pdp).toMatch(/<meta name="description" content="🇷🇪 La Plaine-des-Palmistes \(974\) : eau à ne pas boire ; \d+ avis de /);
    expect(pdp).toContain("les avis de la CIREST");
    // runéo's feed is read, and has nothing for Saint-Pierre: said with the time of the copy.
    expect(page("saint-pierre")).toContain("Aucun avis de coupure publié par runéo à Saint-Pierre à 08:00.");
    expect(page("saint-pierre")).toContain(`content="🇷🇪 Aucune coupure d&#39;eau annoncée par runéo à Saint-Pierre (974) à 08:00.`);
    // La Créole publishes no feed: the page says so rather than « no cut ».
    const sp = page("saint-paul");
    expect(sp).toContain("La Créole ne publie pas ses avis de coupure dans un flux");
    expect(sp).not.toContain("Aucune coupure d&#39;eau annoncée");
    expect(page("le-port")).toContain("<h1>Coupures d'eau au Port</h1>");
    expect(waterLive(pageOf("salazie")!, { coupures })).toMatchObject({ valeur: "Eau à ne pas boire" });
    expect(waterLive(pageOf("saint-paul")!, { coupures })).toMatchObject({ valeur: "Coupures non publiées" });
  });

  it("serves a page per commune, none for an unknown one", async () => {
    const res = await site(new Request("https://rundata.re/coupures-eau/saint-denis", { headers: { "user-agent": "Googlebot" } }), cache(), () => {}, NOW);
    expect(res!.status).toBe(200);
    expect((await site(new Request("https://rundata.re/coupures-eau/nulle-part"), cache(), () => {}, NOW))!.status).toBe(404);
  });
});
