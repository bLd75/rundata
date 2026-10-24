import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { communesIn, parseCreole, parseNotice, parseSainteMarie, textOf } from "../src/providers/avis-eau.js";
import { coupuresEau } from "../src/tools/coupures.js";
import { coupuresCommunePage, waterLive } from "../src/web/coupures.js";
import { buildCoupures } from "../src/web/data.js";
import { pageOf } from "../src/web/places.js";
import { site } from "../src/web/site.js";

// The distributors' notices on 24/10/2026 in the morning: a cut announced in Saint-Denis for Monday night, the water
// of La Plaine-des-Palmistes and of Grand Ilet (Salazie) not to be drunk, Saint-Benoît back to normal since the 15th.
// La Créole's page on the 24th in the evening (the night cut of the 23rd), Sainte-Marie's last five CISE posts.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/avis-eau/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());

describe("coupures d'eau", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: string) => {
      const file = url.includes("dioneo") ? "dioneo.xml" : url.includes("runeo") ? "runeo.xml" : url.includes("possession") ? "possession.xml"
        : url.includes("lacreole") ? "lacreole.html" : url.includes("saintemarie") ? "saintemarie.json" : "cirest.json";
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

  it("reads La Créole's page: the day it gives, the start it writes, and the advice after a cut is not « ne pas boire »", () => {
    const [n, ...more] = parseCreole(fixture("lacreole.html"));
    expect(more).toHaveLength(0);
    expect(n).toMatchObject({ distributeur: "La Créole", titre: "Interruption nocturne de la distribution du 23/10/2026", communes: ["Saint-Paul"], jour: true, debut: "2026-10-23T22:00", ne_pas_boire: false, lien: "https://lacreole.re/flash-infos" });
    // « jusqu'à 6h00 demain matin »: no end is guessed.
    expect(n.fin).toBeUndefined();
    expect(n.texte).toMatch(/^La régie La Créole informe ses abonnés/);
    const li = (text: string, title = "Information générale") => `<div id="infos-flash"><ul><li>24/10/2026 - <i>x</i> <br><span class="text-uppercase">${title}</span><br><span>${text}</span></li></ul>`;
    expect(parseCreole(li("Suite à une pollution, ne pas boire l'eau du robinet à Saint-Paul.", "Qualité de l'eau"))[0]).toMatchObject({ ne_pas_boire: true, communes: ["Saint-Paul"] });
    expect(parseCreole(li("Respectez les restrictions d'usage prévues par l'arrêté préfectoral."))[0].ne_pas_boire).toBe(false);
  });

  it("puts a La Créole notice under the commune of its place, or under both when the place does not say", () => {
    // « La Plaine – Bois-de-Nèfles » is in Saint-Paul: the notice of the 23rd goes there only, with nothing to add.
    expect(parseCreole(fixture("lacreole.html"))[0]).toMatchObject({ communes: ["Saint-Paul"] });
    expect(parseCreole(fixture("lacreole.html"))[0].precision).toBeUndefined();
    const li = (text: string) => `<div id="infos-flash"><ul><li>24/10/2026 - <i>x</i> <br><span class="text-uppercase">Interruption</span><br><span>${text}</span></li></ul>`;
    // Named in the text: that commune.
    expect(parseCreole(li("Coupure aux Trois-Bassins, dans Les Trois-Bassins, secteur du Bas."))[0]).toMatchObject({ communes: ["Les Trois-Bassins"] });
    // A place known only elsewhere (Grande Ravine is found in Sainte-Suzanne), or not known at all: both, said so.
    expect(parseCreole(li("Interruption sur le secteur de Grande Ravine, ce soir."))[0]).toMatchObject({
      communes: ["Saint-Paul", "Les Trois-Bassins"], precision: "La Créole ne précise pas la commune (lieu écrit dans l'avis : Grande Ravine).",
    });
    expect(parseCreole(li("Interruption ce soir pour travaux."))[0]).toMatchObject({ communes: ["Saint-Paul", "Les Trois-Bassins"], precision: "La Créole ne précise pas la commune." });
    // Bois-de-Nèfles is also in Saint-Denis: a La Créole notice stays in its own communes.
    expect(parseCreole(li("Interruption sur le secteur de Bois-de-Nèfles, ce soir."))[0].communes).toEqual(["Saint-Paul"]);
  });

  it("keeps Sainte-Marie's CISE notices, an image or a PDF as a link only, and leaves out a post about something else", () => {
    const list = parseSainteMarie(JSON.parse(fixture("saintemarie.json")));
    expect(list.map((n) => n.titre)).toEqual(["Communiqué de la CISE du 02/10 (image)", "Communiqué CISE Réunion", "Communiqué CISE Réunion", "Communiqué CISE Réunion"]);
    // « Communiqué CISE Réunion- fermeture exceptionnelle »: the offices closed, not the water.
    expect(list.some((n) => /fermeture/i.test(n.titre + n.texte))).toBe(false);
    expect(list[0]).toMatchObject({ forme: "image", texte: "", communes: ["Sainte-Marie"], lien: "https://www.ville-saintemarie.re/communique-cise-reunion-33/" });
    const leak = list[2];
    expect(leak.secteurs).toHaveLength(12);
    expect(leak.secteurs.at(-1)).toBe("Moka");
    // « ne pas boire l'eau » at the water's return after the repair: a cut.
    expect(leak.ne_pas_boire).toBe(false);
    expect(list[3].ne_pas_boire).toBe(false);
  });

  it("says when a commune's distributor publishes nothing read here", async () => {
    const b = body(await coupuresEau(cache(), "Le Tampon", NOW));
    expect(b.resume).toBe("Pas d'avis en ligne lisible pour Le Tampon : voir la mairie ou le distributeur d'eau.");
    const sp = body(await coupuresEau(cache(), "Saint-Paul", NOW));
    expect(sp.resume).toBe("1 avis récent ou à venir à Saint-Paul : Interruption nocturne de la distribution du 23/10/2026.");
    expect(sp.avis[0]).toMatchObject({ publie_le: "23/10/2026", coupure: { de: "vendredi 23/10 à 22:00" } });
    expect(sp.avis[0].ne_pas_boire).toBeUndefined();
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
    // La Créole's page is read: its notice, dated to the day without an hour.
    const sp = page("saint-paul");
    expect(sp).toContain("Interruption nocturne de la distribution du 23/10/2026");
    expect(sp).toContain("La Créole, publié le 23/10/2026</span>");
    expect(sp).toContain("<b>À partir du vendredi 23/10 à 22:00</b>");
    expect(sp).toContain(`les avis de <a href="https://lacreole.re/flash-infos" rel="noopener">la page « flash infos » de La Créole</a> : ils s'affichent en haut de cette page.`);
    expect(sp).not.toContain("Il ne publie pas ses avis de coupure");
    // Sudeau publishes nothing read: the page says so rather than « no cut ».
    const lt = page("le-tampon");
    expect(lt).toContain("Sudeau ne publie pas ses avis de coupure dans un flux");
    expect(lt).not.toContain("Aucune coupure d&#39;eau annoncée");
    expect(page("le-port")).toContain("<h1>Coupures d'eau au Port</h1>");
    expect(waterLive(pageOf("salazie")!, { coupures })).toMatchObject({ valeur: "Eau à ne pas boire" });
    expect(waterLive(pageOf("saint-paul")!, { coupures })).toMatchObject({ valeur: "1 avis de coupure" });
    // The notice of the 23rd is in Saint-Paul: not on Les Trois-Bassins' page.
    expect(waterLive(pageOf("les-trois-bassins")!, { coupures })).toMatchObject({ valeur: "Pas de coupure annoncée" });
    expect(waterLive(pageOf("le-tampon")!, { coupures })).toMatchObject({ valeur: "Coupures non publiées" });
  });

  it("gives Sainte-Marie's image notice as a link, read from the mairie's posts", async () => {
    const at = new Date("2026-10-03T04:00:00Z");
    const c = new Cache(new MemoryStore(), () => at.getTime());
    const coupures = { value: await buildCoupures(c, at), fetchedAt: at };
    const sm = coupuresCommunePage("https://rundata.re", pageOf("sainte-marie")!, { coupures }, at);
    expect(sm).toContain(`<a href="https://www.ville-saintemarie.re/communique-cise-reunion-33/" rel="noopener">Communiqué de la CISE du 02/10 (image) →</a>`);
    expect(sm).toContain("Nous lisons, au moins toutes les 30 minutes, les communiqués de CISE Réunion publiés sur <a");
    expect(sm).toContain("Un communiqué publié en image ou en PDF n'est pas lu : nous donnons seulement son lien.");
    expect(sm).not.toContain("FERMETURE");
  });

  it("serves a page per commune, none for an unknown one", async () => {
    const res = await site(new Request("https://rundata.re/coupures-eau/saint-denis", { headers: { "user-agent": "Googlebot" } }), cache(), () => {}, NOW);
    expect(res!.status).toBe(200);
    expect((await site(new Request("https://rundata.re/coupures-eau/nulle-part"), cache(), () => {}, NOW))!.status).toBe(404);
  });
});
