import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { communesIn, cut, extract, operatorOf, parseCirest, parseCreole, parseNotice, parseRss, parseSaintLeu, parseSainteMarie, sectorList, textOf } from "../src/providers/avis-eau.js";
import { coupuresEau, noticeRow } from "../src/tools/coupures.js";
import { coupuresCommunePage, waterLive } from "../src/web/coupures.js";
import { buildCoupures } from "../src/web/data.js";
import { coupuresPage } from "../src/web/domains.js";
import island from "../src/places/island.json" with { type: "json" };
import { pageOf } from "../src/web/places.js";
import { resume } from "../src/tools/resume.js";
import { site } from "../src/web/site.js";
import { mapLinks } from "./cartes.js";

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
        : url.includes("lacreole") ? "lacreole.html" : url.includes("saintemarie") ? "saintemarie.json" : url.includes("saintleu") ? "saintleu.json" : "cirest.json";
      return new Response(fixture(file));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the hours and streets of a cut", () => {
    const text = "Dionéo informe ses clients de SAINT DENIS, qu'en raison de travaux sur le réseau, l'alimentation en eau sera interrompue à partir de 21:00 le 26/10/2026 pour les secteurs suivants :\nROUTE DE BOIS DE NEFLES\nDes perturbations dans la distribution de l'eau sont à prévoir.\nLa remise en eau est prévue à partir de 05:00 le 27/10/2026, sauf incident.";
    expect(parseNotice(text)).toEqual({ debut: "2026-10-26T21:00", fin: "2026-10-27T05:00" });
    expect(sectorList(text, true)).toEqual({ secteurs: ["ROUTE DE BOIS DE NEFLES"], secteurs_complets: true });
    // The date first (Eaux de La Possession): the start is not the hour of the return of the water.
    expect(parseNotice("perturbée le 28/10/2026 à partir de 08:00 pour les secteurs suivants :\nCHEMIN LEGROS\n\nLa remise en eau est prévue à partir de 20:00 le 28/10/2026, sauf incident.")).toEqual({ debut: "2026-10-28T08:00", fin: "2026-10-28T20:00" });
    expect(communesIn("clients de SAINT DENIS")).toEqual(["Saint-Denis"]);
    expect(communesIn("abonnés de La Plaine-des-Palmistes")).toEqual(["La Plaine-des-Palmistes"]);
  });

  it("cuts each notice's text once, right after the colon that opens a list, else at the end of a word", () => {
    const dioneo = parseRss(fixture("dioneo.xml"), { nom: "Dionéo", url: "", communes: ["Saint-Denis"] })[0];
    // The tool's text was the whole notice (436 characters, under 700): the start of the cut stays, and the return of the water follows the « […] ».
    expect(dioneo.texte).toBe("Dionéo informe ses clients de SAINT DENIS, qu'en raison de travaux sur le réseau, l'alimentation en eau sera interrompue à partir de 21:00 le 26/10/2026 pour les secteurs suivants : […] La remise en eau est prévue à partir de 05:00 le 27/10/2026, sauf incident.");
    expect(dioneo).toMatchObject({ extrait_coupe: true, debut: "2026-10-26T21:00", fin: "2026-10-27T05:00", secteurs: ["ROUTE DE BOIS DE NEFLES"], secteurs_complets: true });
    const possession = parseRss(fixture("possession.xml"), { nom: "Eaux de La Possession", url: "", communes: ["La Possession"] })[0];
    expect(possession.texte).toMatch(/^Eaux de La Possession informe .* le 28\/10\/2026 à partir de 08:00 pour les secteurs suivants : \[…\] La remise en eau est prévue à partir de 20:00 le 28\/10\/2026, sauf incident\.$/);
    expect(possession).toMatchObject({ debut: "2026-10-28T08:00", fin: "2026-10-28T20:00", secteurs_complets: true });
    expect(possession.secteurs).toEqual(["RESERVOIR STE THERESE", "CHEMIN LEGROS", "CHEMIN LEOPOLD CAVANE", "LOTISSEMENT LA COLLINE", "RUE JEAN JACQUES ROUSSEAU"]);
    // « Réf : », « Objet : » open no list: the text goes on, cut at the end of a word.
    const cirest = parseCirest(JSON.parse(fixture("cirest.json")));
    const ref = cirest.find((n) => n.texte.startsWith("CISE Réunion vous informe Réf"))!;
    expect(ref.texte).toMatch(/^CISE Réunion vous informe Réf : 2026-10-450 Objet : Dégradation .* la distribution \[…\]$/);
    // La Créole: its list comes after 320 characters, the text stops at a word, with the hours of the night cut.
    const creole = parseCreole(fixture("lacreole.html"))[0];
    expect(creole.texte).toMatch(/à partir de 22h00 et jusqu’à 6h00 demain matin\. .* \[…\] La remise en eau s’effectuera progressivement à compter de 6h00\.$/);
    // No sentence of the return of the water: nothing is added, nothing guessed.
    expect(cirest.find((n) => /^Sainte-Rose : incident/.test(n.titre))!.texte).toMatch(/\[…\]$/);
    expect(cut("Objet :\nTravaux\nLa distribution sera interrompue le 26/10 à partir de 8h dans les rues suivantes :\nRue A\nRue B")).toEqual({ texte: "Objet : Travaux La distribution sera interrompue le 26/10 à partir de 8h dans les rues suivantes : […]", extrait_coupe: true });
    expect(cut("Coupure ce soir, rue A.")).toEqual({ texte: "Coupure ce soir, rue A." });
    expect(cut(`Coupure ${"très ".repeat(80)}longue.`).texte).toMatch(/très \[…\]$/);
    // The first sentence of the return, whole and word for word, also begun in the part kept.
    expect(cut("Coupure le 26/10 dans les rues suivantes :\nRue A\nLe rétablissement est prévu vers 17h. La remise en eau sera progressive.").texte).toBe("Coupure le 26/10 dans les rues suivantes : […] Le rétablissement est prévu vers 17h.");
    expect(cut(`${"Mot ".repeat(77)}fin. La remise en eau est prévue vers 17h. ${"Fin ".repeat(20)}`).texte).toMatch(/Mot fin\. La remise en eau est prévue vers 17h\. \[…\]$/);
    // The page and the tool say the same text: never longer than 320 characters, its « […] » that says it is cut, and the sentence of the return.
    const all = [dioneo, possession, ...cirest, creole, ...parseSainteMarie(JSON.parse(fixture("saintemarie.json")))];
    for (const n of all) {
      const [kept, back] = n.texte.split(" […]");
      expect(kept.length).toBeLessThanOrEqual(320);
      expect(n.texte.includes(" […]")).toBe(!!n.extrait_coupe);
      if (back) expect(back).toMatch(/^ (La remise en (eau|service)|Le rétablissement) /);
    }
  });

  it("puts each CIREST notice under the distributor it names, else under the CIREST alone, never one deduced", () => {
    const cirest = parseCirest(JSON.parse(fixture("cirest.json")));
    const of = (titre: RegExp) => cirest.find((n) => titre.test(n.titre))!.distributeur;
    // The ARS names runéo for Bras-Panon, O2LEST for Salazie; the notices say who writes them.
    expect(of(/^Bras-Panon : coupure/)).toBe("CIREST / runéo");
    expect(of(/^Salazie : Incident/)).toBe("CIREST / CISE Réunion");
    expect(of(/^Saint-André : Lavage/)).toBe("CIREST / CISE Réunion");
    // « Des travaux de réparation d'une fuite… »: no distributor named.
    expect(of(/^Salazie : coupure d.eau ce 22/)).toBe("CIREST");
    expect(cirest.map((n) => n.distributeur)).not.toContain("CIREST / O2LEST");
    expect(operatorOf("La CIREST informe les habitants qu'un incident signalé par CISE REUNION…")).toBe("CISE Réunion");
    expect(operatorOf("Runéo informe ses clients de BRAS-PANON")).toBe("runéo");
    expect(operatorOf("O2LEST informe ses abonnés")).toBe("O2LEST");
    expect(operatorOf("La CIREST informe les habitants")).toBeUndefined();
    // The one that signs it first, then the first named.
    expect(operatorOf("Suite à une casse sur le réseau de runéo, CISE Réunion informe ses abonnés de Bras-Panon…")).toBe("CISE Réunion");
    expect(operatorOf("Après une intervention de CISE Réunion, runéo vous informe que…")).toBe("runéo");
    expect(operatorOf("Saint-Benoît : casse sur le réseau de runéo", "CISE Réunion informe ses abonnés…")).toBe("CISE Réunion");
    expect(operatorOf("Les équipes de CISE Réunion vont réaliser des travaux", "Saint-Benoît")).toBe("CISE Réunion");
  });

  it("reads the hours of CISE Réunion's notices, the end in the sentence of the return of the water", () => {
    const cirest = parseCirest(JSON.parse(fixture("cirest.json")));
    const of = (titre: RegExp) => cirest.find((n) => titre.test(n.titre))!;
    expect(of(/^Saint-André : Lavage/)).toMatchObject({ debut: "2026-10-15T05:00", fin: "2026-10-15T18:00" });
    expect(of(/^Saint-Benoit : travaux de maintenance/)).toMatchObject({ debut: "2026-10-14T07:30", fin: "2026-10-14T15:00" });
    // A runéo notice posted by the CIREST: « à partir de 09:00 ce mercredi 21 octobre 2026 ».
    expect(of(/^Bras-Panon/)).toMatchObject({ debut: "2026-10-21T09:00", fin: "2026-10-21T15:30" });
    // « en fin d'après-midi », « dès achèvement des travaux »: no hour, none guessed.
    expect(of(/^Salazie : coupure d’eau ce 22/).fin).toBeUndefined();
    expect(of(/fuite, vendredi 16 octobre/)).toMatchObject({ debut: "2026-10-16T08:30", fin: undefined });
    // Sainte-Marie, « dès maintenant … à partir de 18 heures »: the end only, said in the tool, not as a start on the page.
    const leak = parseSainteMarie(JSON.parse(fixture("saintemarie.json")))[2];
    expect(leak).toMatchObject({ debut: undefined, fin: "2026-07-29T18:00" });
    expect(noticeRow(leak, NOW).coupure).toEqual({ de: undefined, a: "mercredi 29/07 à 18:00", etat: undefined });
  });

  it("gives a list of streets only when it was read whole", () => {
    const cirest = parseCirest(JSON.parse(fixture("cirest.json")));
    const of = (titre: RegExp) => cirest.find((n) => titre.test(n.titre))!;
    // Ended by « Et toutes les voies adjacentes », which is no street.
    expect(of(/^Saint-André : Lavage/)).toMatchObject({ secteurs: ["Chemin Lefaguyès", "Secteur Grand Canal", "Secteur Champs Borne", "Secteur Bel Ombre", "Chemin Quatre-Vingt", "Chemin des Limites"], secteurs_complets: true });
    // Bullets dropped.
    expect(of(/fuite, vendredi 16 octobre/).secteurs).toEqual(["Rue des songes", "Impasse des songes", "Rue Dureaux", "Impasse des Verveines", "Impasse des Papyrus", "Rue Marcelly Robert"]);
    // « Les secteurs concernés sont : » is not read; a second list follows (Salazie); a long line follows (Grand Ilet): nothing.
    for (const t of [/^Sainte-Rose : incident/, /^Salazie : Incident sur le réseau/, /^Salazie, Grand-Ilet/]) expect(of(t)).toMatchObject({ secteurs: [], secteurs_complets: false });
    expect(of(/^Sainte-Rose : incident/)).toMatchObject({ extrait_coupe: true, texte: expect.stringMatching(/Les secteurs concernés sont les suivants : \[…\]$/) });
    // Running to the end of the text, the source maybe cut short; a line too long to be a street; no list at all.
    expect(sectorList("secteurs suivants :\nRue A\nRue B", true)).toEqual({ secteurs: [], secteurs_complets: false });
    expect(sectorList("secteurs suivants :\nRue A\nRD13, Quartier Bras Mouton et rues adjacentes jusqu'au carrefour\nRue B\n\nLa remise en eau", true).secteurs_complets).toBe(false);
    expect(sectorList("Coupure rue A.", true)).toEqual({ secteurs: [], secteurs_complets: false });
    // In a WordPress post a blank line parts the streets; in a feed it ends the list.
    expect(sectorList("secteurs suivants :\n\nRue A\n\nRue B\n\nLa remise en service", false).secteurs).toEqual(["Rue A", "Rue B"]);
    expect(sectorList("secteurs suivants :\nRue A\n\nUne phrase.", true).secteurs).toEqual(["Rue A"]);
  });

  it("shows a list read whole, else sends to the notice for the streets, on the page and in the tool", async () => {
    const coupures = { value: await buildCoupures(cache(), NOW), fetchedAt: NOW };
    const page = (slug: string) => coupuresCommunePage("https://rundata.re", pageOf(slug)!, { coupures }, NOW);
    const sd = page("saint-denis");
    expect(sd).toContain(`<p class="note">Secteurs : ROUTE DE BOIS DE NEFLES</p>`);
    expect(sd).toContain("pour les secteurs suivants : […] La remise en eau est prévue à partir de 05:00 le 27/10/2026, sauf incident. <a href=\"https://dioneo.re/flash-info/travaux-sur-le-reseau-rd49\" rel=\"noopener\">L'avis complet →</a>");
    const sr = page("sainte-rose");
    expect(sr).not.toContain("Secteurs :");
    expect(sr).toContain("Les secteurs concernés sont les suivants : […] <a href=");
    expect(sr).toContain("Les secteurs concernés dans l'avis complet →</a>");
    const tool = body(await coupuresEau(cache(), "Sainte-Rose", NOW));
    expect(tool.avis.every((n: { secteurs: string[]; secteurs_complets: boolean }) => n.secteurs.length === 0 && !n.secteurs_complets)).toBe(true);
    expect(body(await coupuresEau(cache(), "Saint-Denis", NOW)).avis[0]).toMatchObject({ secteurs: ["ROUTE DE BOIS DE NEFLES"], secteurs_complets: true, extrait_coupe: true });
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

  it("says when a commune's distributor publishes nothing read here, and names it as the page does", async () => {
    const b = body(await coupuresEau(cache(), "Le Tampon", NOW));
    expect(b.resume).toBe("Pas d'avis en ligne lisible pour Le Tampon : Sudéau, qui y distribue l'eau, ne publie pas ses avis de coupure dans un flux que rundata.re peut lire. Voir Sudéau ou la mairie.");
    expect(b.distributeur).toEqual({ nom: "Sudéau", d_apres: "ARS La Réunion, contrôle sanitaire des eaux distribuées (Hub'Eau), Licence Ouverte 2.0" });
    expect(b.contact).toBe("Le numéro d'urgence du distributeur (fuite, coupure non annoncée) est sur la facture d'eau\u00a0; la mairie : https://rundata.re/communes/le-tampon");
    // The distributor named is the ARS's: its sanitary control is credited beside the notices.
    expect(b.sources.map((s: { source: string }) => s.source)).toEqual(["Avis des distributeurs d'eau : coupures, travaux, eau non potable (Dionéo, runéo, Eaux de La Possession, La Créole, CIREST, ville de Sainte-Marie, commune de Saint-Leu)", "Contrôle sanitaire de l'eau du robinet (ARS La Réunion, via Hub'Eau)"]);
    // No distributor named by the ARS (L'Étang-Salé): the plain sentence, the contact still.
    const es = body(await coupuresEau(cache(), "L'Étang-Salé", NOW));
    expect(es.resume).toBe("Pas d'avis en ligne lisible pour L'Étang-Salé : voir la mairie ou le distributeur d'eau.");
    expect(es.distributeur).toBeUndefined();
    expect(es.contact).toMatch(/la mairie : https:\/\/rundata\.re\/communes\/l-etang-sale$/);
    const sp = body(await coupuresEau(cache(), "Saint-Paul", NOW));
    expect(sp.resume).toBe("1 avis récent ou à venir à Saint-Paul : Interruption nocturne de la distribution du 23/10/2026.");
    expect(sp.avis[0]).toMatchObject({ publie_le: "23/10/2026", coupure: { de: "vendredi 23/10 à 22:00" } });
    expect(sp.avis[0].ne_pas_boire).toBeUndefined();
    // Its notices are read: neither the distributor nor the contact, and only the notices credited.
    expect(sp.distributeur).toBeUndefined();
    expect(sp.contact).toBeUndefined();
    expect(sp.sources).toHaveLength(1);
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
    expect(pdp).toMatch(/<meta name="description" content="La Plaine-des-Palmistes \(974\)\u00a0: eau à ne pas boire\u00a0; \d+ avis de /);
    expect(pdp).toContain("les avis de la CIREST");
    // runéo's feed is read, and has nothing for Saint-Pierre: said with the time of the copy.
    expect(page("saint-pierre")).toContain("Aucun avis de coupure publié par runéo à Saint-Pierre à 08:00.");
    expect(page("saint-pierre")).toContain(`content="Aucune coupure d&#39;eau annoncée par runéo à Saint-Pierre (974) à 08:00.`);
    // La Créole's page is read: its notice, dated to the day without an hour.
    const sp = page("saint-paul");
    expect(sp).toContain("Interruption nocturne de la distribution du 23/10/2026");
    expect(sp).toContain("La Créole, publié le 23/10/2026</span>");
    expect(sp).toContain("<b>À partir du vendredi 23/10 à 22:00</b>");
    expect(sp).toContain(`les avis de <a href="https://lacreole.re/flash-infos" rel="noopener">la page « flash infos » de La Créole</a> : ils s'affichent en haut de cette page.`);
    expect(sp).not.toContain("Il ne publie pas ses avis de coupure");
    // Sudéau publishes nothing read: the page says so rather than « no cut ».
    const lt = page("le-tampon");
    expect(lt).toContain("Sudéau ne publie pas ses avis de coupure dans un flux");
    expect(lt).not.toContain("Aucune coupure d&#39;eau annoncée");
    expect(page("le-port")).toContain("<h1>Coupures d'eau au Port</h1>");
    expect(waterLive(pageOf("salazie")!, { coupures })).toMatchObject({ valeur: "Eau à ne pas boire" });
    expect(waterLive(pageOf("saint-paul")!, { coupures })).toMatchObject({ valeur: "1 avis de coupure" });
    // The notice of the 23rd is in Saint-Paul: not on Les Trois-Bassins' page.
    expect(waterLive(pageOf("les-trois-bassins")!, { coupures })).toMatchObject({ valeur: "Pas de coupure annoncée" });
    expect(waterLive(pageOf("le-tampon")!, { coupures })).toMatchObject({ valeur: "Coupures non publiées" });
  });

  it("says a feed that does not answer: its notices kept with the hour they were read, else its read failed, never « no cut »", async () => {
    const store = new MemoryStore();
    let t = NOW.getTime();
    const at = () => new Cache(store, () => t);
    await coupuresEau(at(), undefined, new Date(t));
    // Two hours on, Dionéo's site does not answer, nor runéo's: Dionéo's notice kept, runéo's read said failed.
    t += 2 * 3600_000;
    const now = new Date(t);
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("dioneo") || url.includes("runeo")) return new Response("", { status: 503 });
      const file = url.includes("possession") ? "possession.xml" : url.includes("lacreole") ? "lacreole.html" : url.includes("saintemarie") ? "saintemarie.json" : url.includes("saintleu") ? "saintleu.json" : "cirest.json";
      return new Response(fixture(file));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sd = body(await coupuresEau(at(), "Saint-Denis", now));
    expect(sd.avis.length).toBeGreaterThan(0);
    expect(sd.injoignable).toEqual([{ texte: "Lu aujourd'hui à 08:00 : le site de Dionéo n'a pas répondu depuis. Ce qui suit peut avoir changé : voir son site.", court: "lu aujourd'hui à 08:00, sans réponse depuis", de: "de Dionéo", site: "https://dioneo.re/" }]);
    expect(sd.resume).toContain("Lu aujourd'hui à 08:00 : le site de Dionéo n'a pas répondu depuis. Ce qui suit peut avoir changé : voir son site.");
    // runéo had nothing for Saint-Pierre at the first read: no notice kept, its read said failed.
    const sp = body(await coupuresEau(at(), "Saint-Pierre", now));
    expect(sp.resume).not.toContain("Aucun avis");
    expect(sp.injoignable[0].texte).toBe("Le site de runéo n'a pas répondu à notre dernière lecture (aujourd'hui à 10:00) : nous ne savons pas ce qu'il annonce en ce moment.");
    // The page, the tile and the day's summary say it too.
    const coupures = { value: await buildCoupures(at(), now), fetchedAt: now };
    const page = coupuresCommunePage("https://rundata.re", pageOf("saint-pierre")!, { coupures }, now);
    expect(page).toContain("Le site de runéo n&#39;a pas répondu à notre dernière lecture");
    expect(page).not.toMatch(/Aucun avis|Aucune coupure/);
    expect(coupuresCommunePage("https://rundata.re", pageOf("saint-denis")!, { coupures }, now)).toContain('voir <a href="https://dioneo.re/" rel="noopener">son site</a>.');
    expect(waterLive(pageOf("saint-pierre")!, { coupures })).toMatchObject({ valeur: "Site sans réponse", detail: expect.stringContaining("site sans réponse à notre dernière lecture (10:00)") });
    const day = resume(pageOf("saint-pierre")!, { coupures } as never, now);
    expect(day.coupures_eau?.injoignable?.texte).toBe(sp.injoignable[0].texte);
    expect(JSON.stringify(day)).not.toContain("pas de coupure d'eau annoncée");
    // The island: both said, in a few words.
    const ile = body(await coupuresEau(at(), undefined, now));
    expect(ile.injoignable.map((f: { de: string }) => f.de)).toEqual(["de Dionéo", "de runéo"]);
    expect(ile.resume).toContain("Le site de runéo n'a pas répondu à notre dernière lecture (aujourd'hui à 10:00) : nous ne savons pas ce qu'il annonce en ce moment.");
    vi.restoreAllMocks();
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

  it("follows runéo's communes like the others, from the table of distributors: a « ne pas boire » there is said for the island and on the map", async () => {
    // Before, a hand-written list left runéo's communes out: Saint-Pierre's notice was only given when Saint-Pierre was asked.
    const item = `<item><title>Qualité de l'eau à Saint-Pierre</title><link>https://www.runeo.re/flash-infos/test</link><pubDate>Fri, 23 Oct 2026 10:00:00 +0400</pubDate>` +
      `<description>Suite à une pollution, ne pas boire l'eau du robinet à Saint-Pierre, secteur de Ravine des Cabris.</description></item>`;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("runeo")) return new Response(fixture("runeo.xml").replace("</channel>", `${item}</channel>`));
      const file = url.includes("dioneo") ? "dioneo.xml" : url.includes("possession") ? "possession.xml"
        : url.includes("lacreole") ? "lacreole.html" : url.includes("saintemarie") ? "saintemarie.json" : url.includes("saintleu") ? "saintleu.json" : "cirest.json";
      return new Response(fixture(file));
    });
    const b = body(await coupuresEau(cache(), undefined, NOW));
    expect(b.ne_pas_boire).toEqual(["La Plaine-des-Palmistes", "Saint-Pierre", "Salazie"]);
    expect(b.couverture).toBe("Avis lus pour Bras-Panon, La Plaine-des-Palmistes, La Possession, Le Port, Les Trois-Bassins, Saint-André, Saint-Benoît, Saint-Denis, Saint-Leu, Saint-Louis, Saint-Paul, Saint-Pierre, Sainte-Marie, Sainte-Rose, Sainte-Suzanne et Salazie (Dionéo, runéo, Eaux de La Possession, La Créole, la CIREST pour ses six communes, CISE Réunion par la ville de Sainte-Marie, Derichebourg Aqua OI par la commune de Saint-Leu)\u00a0: une coupure que ces sources n'annoncent pas n'apparaît pas ici. Ailleurs, voir la mairie ou le distributeur.");
    const value = await buildCoupures(cache(), NOW);
    expect(value.communes_suivies).toEqual(expect.arrayContaining(["Le Port", "Saint-Louis", "Saint-Pierre", "Sainte-Suzanne"]));
    const sp = island.paths.find((p: { nom: string }) => p.nom === "Saint-Pierre")!;
    const page = coupuresPage("https://rundata.re", { value, fetchedAt: NOW }, NOW);
    expect(page).toContain(`<path d="${sp.d}" style="fill:#f03e3e"/>`);
    // Each followed commune leads to its own page of notices.
    const links = mapLinks(page);
    expect(links).toHaveLength(value.communes_suivies.length);
    expect(links.filter((l) => !pageOf(l.href.replace("/coupures-eau/", "")))).toEqual([]);
    expect(links.find((l) => l.href === "/coupures-eau/saint-pierre")?.label).toBe("Saint-Pierre : eau à ne pas boire, voir le détail");
    // The legend never says « aucun avis » where nothing is read, and tells what the others are.
    expect(page).toContain(`<span style="color:#a5d8ff">pas d'avis lu en ce moment</span>. Les autres communes : avis non lus, voir la mairie ou le distributeur.`);
  });

  it("keeps Saint-Leu's posts about the water network, as a short extract with its link, an image as a link only", () => {
    const list = parseSaintLeu(JSON.parse(fixture("saintleu.json")));
    expect(list.map((n) => n.titre)).toEqual([
      "Coupure d’eau Pointe des Châteaux",
      "Coupure d’eau mercredi 26 août",
      "Travaux sur le réseau d’eau aux Colimaçons et à Bras Mouton les 9 et 10 juillet 2026",
      "Lavage de réservoir : perturbations d’eau ce mercredi 24 juin 2026 au Plate",
      "Travaux de maintenance : la distribution d’eau interrompue mercredi 24 juin 2026 sur plusieurs secteurs",
      "Travaux de maintenance : la distribution d’eau interrompue ce mercredi sur plusieurs secteurs",
    ]);
    expect(list[0]).toMatchObject({ forme: "image", texte: "", communes: ["Saint-Leu"], lien: "https://www.saintleu.re/actualite/coupure-deau-pointe-des-chateaux.php" });
    expect(list[2]).toMatchObject({ distributeur: "Derichebourg Aqua OI, par la commune de Saint-Leu", publie: "2026-07-08T10:30:23.000Z", secteurs: [], ne_pas_boire: false });
    // The sentence that says the cut, cut short: never the whole notice.
    // Stopped right after the colon, never in the middle of the streets: those are in the notice, its link says so.
    expect(list[2]).toMatchObject({ texte: "Cette intervention nécessite l’interruption de la distribution en eau, le jeudi 09 juillet et vendredi 10 juillet 2026 de 08h à 18h, sur les secteurs suivants : […]", extrait_coupe: true });
    for (const n of list) expect(n.texte.length).toBeLessThanOrEqual(254);
    // A sentence whose colon comes too late is cut at a word, before 250 characters.
    expect(list[3].texte).toMatch(/ \[…\]$/);
    expect(extract("Une phrase sans deux-points. Suite " + "mot ".repeat(80))).toEqual({ texte: "Une phrase sans deux-points.", coupe: false });
    expect(extract("Coupure " + "longue ".repeat(60)).texte).toMatch(/^Coupure (?:longue ){30,}\[…\]$/);
  });

  it("gives Saint-Leu's notices on its page, and for Petite-Île, Cilaos and L'Étang-Salé only a link to the mairie", async () => {
    const at = new Date("2026-08-22T04:00:00Z");
    const c = new Cache(new MemoryStore(), () => at.getTime());
    const coupures = { value: await buildCoupures(c, at), fetchedAt: at };
    const page = (slug: string) => coupuresCommunePage("https://rundata.re", pageOf(slug)!, { coupures }, at);
    const sl = page("saint-leu");
    expect(sl).toContain("Coupure d’eau mercredi 26 août");
    expect(sl).toContain(`<a href="https://www.saintleu.re/actualite/coupure-deau-mercredi-26-aout.php" rel="noopener">Les secteurs concernés dans l'avis complet →</a>`);
    expect(sl).toContain("les avis de coupure publiés sur <a href=\"https://www.saintleu.re/?s=eau\" rel=\"noopener\">le site de la commune de Saint-Leu</a>");
    expect(coupures.value.communes_suivies).toContain("Saint-Leu");
    expect(page("cilaos")).toContain(`<a href="https://ville-cilaos.fr/?s=coupure+d%27eau" rel="noopener">Les avis de coupure d&#39;eau sur le site de la ville de Cilaos →</a>`);
    expect(page("petite-ile")).toContain(`<a href="https://www.petite-ile.re/actualites/news" rel="noopener">Les avis « Coupure d&#39;eau » sur le site de la ville de <span style="white-space:nowrap">Petite-Île</span> →</a>`);
    const es = page("l-etang-sale");
    expect(es).toContain("Le distributeur de la commune n'est pas connu ici : voir la mairie. <a href=\"https://www.letangsale.fr/\" rel=\"noopener\">Le site de la mairie de L&#39;<span style=\"white-space:nowrap\">Étang-Salé</span> →</a>");
    expect(es).not.toContain("Coupure d’eau");
    expect(waterLive(pageOf("cilaos")!, { coupures })).toMatchObject({ valeur: "Coupures non publiées" });
    // No notice of Saint-Leu at the time: said of the commune that publishes them, not of its distributor.
    const later = new Date("2026-10-24T04:00:00Z");
    const now = { value: await buildCoupures(cache(), later), fetchedAt: later };
    expect(coupuresCommunePage("https://rundata.re", pageOf("saint-leu")!, { coupures: now }, later)).toMatch(/Aucun avis de coupure publié par la commune de Saint-Leu à \d\d:\d\d\./);
    expect(coupuresCommunePage("https://rundata.re", pageOf("saint-leu")!, { coupures: now }, later)).toMatch(/content="Aucune coupure d&#39;eau annoncée par la commune de Saint-Leu \(974\) à \d\d:\d\d\./);
    // The east: the CIREST publishes the notices read, not O2LEST, which the ARS names as the distributor.
    const sa = coupuresCommunePage("https://rundata.re", pageOf("saint-andre")!, { coupures: now }, later);
    expect(sa).toMatch(/content="Aucune coupure d&#39;eau annoncée par la CIREST à Saint-André \(974\) à \d\d:\d\d\./);
    expect(sa).toContain("<b>O2LEST</b> distribue l'eau à Saint-André, d'après le contrôle sanitaire de l'ARS.");
    expect(coupuresCommunePage("https://rundata.re", pageOf("sainte-marie")!, { coupures: now }, later)).toMatch(/content="Aucune coupure d&#39;eau annoncée par la ville de Sainte-Marie \(974\) à \d\d:\d\d\./);
  });

  it("gives, for a commune whose mairie is only linked to, where its notices are", async () => {
    const b = body(await coupuresEau(cache(), "Cilaos", NOW));
    expect(b.resume).toBe("Pas d'avis en ligne lisible pour Cilaos : RECIL, qui y distribue l'eau, ne publie pas ses avis de coupure dans un flux que rundata.re peut lire. Voir RECIL ou la mairie.");
    expect(b.mairie).toEqual({ libelle: "Les avis de coupure d'eau sur le site de la ville de Cilaos", lien: "https://ville-cilaos.fr/?s=coupure+d%27eau" });
    expect(body(await coupuresEau(cache(), "Saint-Leu", NOW)).mairie).toBeUndefined();
  });

  it("serves a page per commune, none for an unknown one", async () => {
    const res = await site(new Request("https://rundata.re/coupures-eau/saint-denis", { headers: { "user-agent": "Googlebot" } }), cache(), () => {}, NOW);
    expect(res!.status).toBe(200);
    expect((await site(new Request("https://rundata.re/coupures-eau/nulle-part"), cache(), () => {}, NOW))!.status).toBe(404);
  });
});
