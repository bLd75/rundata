import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { statusOf } from "../src/providers/agenda-mots.js";
import { parseOpenAgenda, type Evenement } from "../src/providers/agenda.js";
import { latin1, mergeTeat, parseBisik, parseCdnoi, parseCiteDesArts, parseKabardock, parseLespas, parseLucDonat, parseTeat, TEAT_VENUES, tokens } from "../src/providers/salles.js";
import { genres, matcher, unique } from "../src/tools/agenda.js";

// The halls' pages on Saturday 24/10/2026, without their scripts and images.
const bytes = (f: string) => readFileSync(new URL(`./fixtures/agenda/${f}`, import.meta.url));
const utf8 = (f: string) => bytes(f).toString("utf8");
const iso88591 = (f: string) => latin1(bytes(f).buffer.slice(bytes(f).byteOffset, bytes(f).byteOffset + bytes(f).byteLength) as ArrayBuffer);
const NOW = new Date("2026-10-24T04:00:00Z");
const ev = (titre: string, debut: string, more: Partial<Evenement> = {}): Evenement => ({ id: titre + debut, titre, seances: [{ debut }], categories: [], lien: "https://x/" + titre, publie_par: "test", ...more });

describe("halls' programmes", () => {
  it("reads a page as its texts and links, scripts left out", () => {
    expect(tokens(`<p>Le <b>Kabardock</b></p><script>var a = "<p>no</p>";</script><a href="/x?a=1&amp;b=2">Lien</a>`))
      .toEqual([{ t: "Le" }, { t: "Kabardock" }, { href: "/x?a=1&b=2" }, { t: "Lien" }]);
    expect(latin1(new Uint8Array([0x54, 0xc9, 0x41, 0x54, 0x20, 0x92]).buffer)).toBe("TÉAT ’");
  });

  it("reads the two TÉAT, a show on both stages told once", () => {
    const list = mergeTeat(TEAT_VENUES.map((v, i) => parseTeat(iso88591(i ? "teat_plein-air.html" : "teat_champ-fleuri.html"), v, NOW)));
    expect(list).toHaveLength(18);
    expect(list.find((e) => e.titre === "CALOGERO")).toMatchObject({
      seances: [{ debut: "2026-10-22" }, { debut: "2026-10-23" }, { debut: "2026-10-24" }], lieu: "TÉAT Plein Air", commune: "Saint-Paul", categories: ["Musique"],
    });
    expect(list.find((e) => e.titre === "Nawell Madani")).toMatchObject({ lieu: "TÉAT Champ Fleuri (Saint-Denis) ou TÉAT Plein Air (Saint-Paul)", commune: undefined });
    // Announced in October for May: next year.
    expect(list.find((e) => e.titre.startsWith("Edgar Yves"))?.seances[0].debut).toBe("2027-05-06");
  });

  it("reads the Cité des Arts, its halls and a typo in a span", () => {
    const list = [...parseCiteDesArts(utf8("citedesarts_1.html")), ...parseCiteDesArts(utf8("citedesarts_2.html"))];
    expect(list).toHaveLength(12);
    expect(list.find((e) => e.titre === "Ultra Vomit")).toMatchObject({ seances: [{ debut: "2026-10-30", fin: "2026-10-31" }], lieu: "Cité des Arts, Palaxa", statut: "complet", categories: ["Concert de Rock Métal"] });
    expect(list.find((e) => e.titre === "Soirée Mouvman")).toMatchObject({ lieu: "Château Morange", commune: "Saint-Denis" });
    // « Du 10 novembre au 24 octobre 2026 » on the site.
    expect(list.find((e) => e.titre.startsWith("Matinées séniors"))?.seances).toEqual([{ debut: "2026-11-10" }]);
  });

  it("reads the Kabardock's agenda, with the hours of the shows at the top", () => {
    const list = parseKabardock(utf8("kabardock.html"), NOW);
    expect(list.map((e) => e.titre)).toContain("Skarra Mucci & Manudigital");
    expect(list.find((e) => e.titre.startsWith("Teddy Baptiste"))).toMatchObject({ seances: [{ debut: "2026-10-23T20:00" }], commune: "Le Port", categories: ["Jazz"] });
    expect(list.find((e) => e.titre === "Dock Session")?.prix).toBe("Gratuit");
  });

  it("reads Bisik's agenda, in the hall of the town where it plays", () => {
    const list = parseBisik(utf8("bisik.html"));
    expect(list).toHaveLength(5);
    expect(list[0]).toMatchObject({ seances: [{ debut: "2026-10-31T19:00", fin: "2026-10-31T23:30" }], lieu: "Salle Gramoun Lélé", commune: "Saint-Benoît", categories: ["Concert"], billetterie: "https://bisik.re/kpop" });
    expect(list[1]).toMatchObject({ lieu: "Salle Guy Agénor", commune: "La Plaine-des-Palmistes", prix: "Tarif unique : 15€" });
  });

  it("reads the Théâtre Luc Donat without its school performances", () => {
    const list = parseLucDonat(iso88591("luc-donat.html"), NOW);
    const killt = list.find((e) => e.titre.startsWith("KiLLT"));
    expect(killt).toMatchObject({ lieu: "Médiathèque Centre-ville", commune: "Le Tampon" });
    // 9:30 and 13:30 are « Scolaire »: only the public ones.
    expect(killt?.seances.map((s) => s.debut)).toEqual(["2026-11-10T18:00", "2026-11-25T17:00"]);
    expect(list.find((e) => e.titre === "Le journal des voleurs")?.seances).toEqual([{ debut: "2026-11-07T20:00" }]);
  });

  it("reads the CDNOI's season, weekday mornings for schools left out", () => {
    const list = parseCdnoi(iso88591("cdnoi.html"), NOW);
    expect(list[0]).toMatchObject({ titre: "Na pwin pèrsone ?", categories: ["Théâtre"], commune: "Saint-Denis" });
    expect(list[0].seances.map((s) => s.debut)).toEqual(["2026-10-29T19:30", "2026-10-30T19:30", "2026-10-31T18:00", "2026-11-03T19:30"]);
  });

  it("reads Léspas's season, a full show marked", () => {
    const list = parseLespas(utf8("lespas.html"), NOW);
    expect(list.find((e) => e.titre === "Dovan la boutik")).toMatchObject({ seances: [{ debut: "2026-10-30T20:00" }], statut: "complet", categories: ["Théâtre"], commune: "Saint-Paul" });
    expect(list.find((e) => e.titre === "Intermèdes Nature #8")?.seances).toEqual([{ debut: "2026-11-10", fin: "2026-11-13" }]);
  });
});

describe("events' state and kind", () => {
  it("tells a cancelled or postponed event, not a past mention", () => {
    expect(statusOf("ANNULÉ – Fête du quartier")).toBe("annulé");
    expect(statusOf("Festival Mizik O Marmay", "En raison de la journée de mobilisation, le festival est annulé.")).toBe("annulé");
    expect(statusOf("Cédric « Analyse »", "Le concert est reporté au 5 décembre.")).toBe("reporté");
    expect(statusOf("Concert REPORTÉ")).toBe("reporté");
    expect(statusOf("Ultra Vomit [COMPLET]")).toBe("complet");
    expect(statusOf("Concert de Noël", "Après une première édition reportée en 2024, il revient.")).toBeUndefined();
    expect(statusOf("Annulation des frais de dossier : permanence")).toBeUndefined();
  });

  it("keeps a cancelled OpenAgenda event, with its state", () => {
    const [e] = parseOpenAgenda({ events: [{ uid: 1, title: { fr: "Bal" }, timings: [{ begin: "2026-10-24T18:00:00+04:00", end: "2026-10-24T23:00:00+04:00" }], canonicalUrl: "https://o/1", status: 6 }] }, "CINOR");
    expect(e.statut).toBe("annulé");
  });

  it("labels the genre from the title and the source's category, not the hall's name", () => {
    expect(genres(ev("Yannick Noah", "2026-10-29", { lieu: "Théâtre Luc Donat" }))).toEqual([]);
    expect(genres(ev("Malandain Ballet Biarritz", "2026-11-17"))).toEqual(["danse"]);
    expect(genres(ev("Calogero", "2026-10-24", { categories: ["Musique"] }))).toEqual(["concert"]);
    expect(matcher("théâtre")!.test(ev("Yannick Noah", "2026-10-29", { lieu: "Théâtre Luc Donat" }))).toBe(false);
    expect(matcher("spectacle")!.test(ev("Booder", "2026-10-27", { categories: ["Humour"] }))).toBe(true);
    expect(matcher("spectacle")!.test(ev("Calogero", "2026-10-24", { categories: ["Musique"] }))).toBe(false);
  });

  it("tells the same show once, whatever its spelling, and keeps what the other copy knows", () => {
    const list = unique([
      ev("CÉDRIC 'ANALYSE' & SES INVITÉS", "2026-12-05", { commune: "Le Port" }),
      ev("Cédric « Analyse » et ses invités", "2026-12-05T20:00", { commune: "Le Port", lieu: "Kabardock", statut: "reporté" }),
      ev("Le journal des voleurs", "2026-11-07T20:00", { commune: "Le Tampon", id: "luc" }),
      ev("Le journal des voleurs", "2026-11-07T20:00", { commune: "Saint-Paul", id: "lespas" }),
    ]);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ lieu: "Kabardock", statut: "reporté" });
  });
});
