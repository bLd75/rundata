import { describe, expect, it } from "vitest";
import { annuaireTool } from "../src/tools/annuaire.js";
import { collecteAnswer, parseLieu } from "../src/tools/collecte.js";
import { resume } from "../src/tools/resume.js";
import * as col from "../src/vie/collecte.js";
import { collectePage, communeOf } from "../src/web/collecte.js";
import { pageOf } from "../src/web/places.js";
import { Cache, MemoryStore } from "../src/cache.js";

// Saturday 24 October 2026, 14:00 at La Réunion.
const NOW = new Date("2026-10-24T10:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const day = (iso: string) => col.todayOf(new Date(`${iso}T08:00:00Z`));
const days = (...isos: string[]) => isos.map(day);
const weekdays = (from: string, step: number, n: number) => Array.from({ length: n }, (_, i) => day(from) + i * step);

describe("the bins' calendars of the West", () => {
  it("holds every calendar of the TCO with its days, and every street with its calendar", () => {
    expect(col.CALENDARS.length).toBeGreaterThan(100);
    expect(col.STREETS.length).toBeGreaterThan(3000);
    expect(col.CALENDARS.every((c) => c.OM && c.OM.length > 40 && c.pdf.startsWith("https://www.tco.re/"))).toBe(true);
    expect(col.COMMUNES).toEqual(["Saint-Paul", "La Possession", "Saint-Leu", "Le Port", "Les Trois-Bassins"]);
    expect(col.STREETS.every((s) => s.calendrier === -1 || col.CALENDARS[s.calendrier])).toBe(true);
  });

  it("says a rhythm only when the coming days keep it, else the days themselves", () => {
    const today = day("2026-10-26");
    // Every Monday and Thursday, the Thursday of a holiday moved to the Friday.
    const om = [...weekdays("2026-10-26", 7, 10), ...weekdays("2026-10-29", 7, 10).map((n) => (n === day("2026-11-12") ? day("2026-11-13") : n))].sort((x, y) => x - y);
    expect(col.rhythm(om, today)).toBe("le lundi et le jeudi");
    // Every other Wednesday, one moved to the Thursday by the holiday.
    expect(col.rhythm(days("2026-10-28", "2026-11-12", "2026-11-25", "2026-12-09"), today)).toBe("le mercredi, une semaine sur deux (prochain : 28/10)");
    expect(col.rhythm(days("2026-11-12", "2026-11-25", "2026-12-09"), today)).toBe("le mercredi, une semaine sur deux (prochain : jeudi 12/11)");
    // The third Thursday of the month.
    expect(col.rhythm(days("2026-11-19", "2026-12-17", "2027-01-21"), today)).toBe("le 3e jeudi du mois (prochain : 19/11)");
    expect(col.rhythm(days("2026-11-06", "2026-12-04"), today)).toBe("les vendredis 6/11, 4/12");
    expect(col.rhythm(days("2026-11-13", "2026-11-26", "2026-12-10", "2026-12-24"), today)).toBe("le jeudi, une semaine sur deux (prochain : vendredi 13/11)");
    expect(col.rhythm(days("2026-11-13", "2026-12-03", "2026-12-19", "2026-12-28"), today)).toBe("le vendredi 13/11, le jeudi 3/12 et le samedi 19/12…");
    // The day itself: « aujourd'hui », not its date.
    expect(col.rhythm(days("2026-10-26", "2026-11-09", "2026-11-23"), today)).toBe("le lundi, une semaine sur deux (prochain : aujourd'hui)");
    expect(col.rhythm(days("2026-01-05"), today)).toBeUndefined();
  });

  it("puts the calendar's holiday before the rule: the day it makes it up, or where to check", () => {
    const today = day("2026-11-02");
    const cs = days("2026-10-28", "2026-11-12", "2026-11-25", "2026-12-09");
    const base = { code: "TEST", pdf: "https://www.tco.re/test.pdf", OM: weekdays("2026-10-26", 7, 12), F: days("2026-11-11") };
    expect(col.holidays({ ...base, CS: cs }, today)).toEqual([{ jour: day("2026-11-11"), reportee: day("2026-11-12") }]);
    expect(col.holidayLine({ jour: day("2026-11-11"), reportee: day("2026-11-12") })).toBe("Jour férié le 11/11 : collecte reportée au jeudi 12/11, selon le calendrier du TCO.");
    // The holiday falls on its usual day and nothing makes it up: no day is guessed.
    const wednesdays = weekdays("2026-10-07", 7, 12).filter((n) => n !== day("2026-11-11"));
    expect(col.holidays({ ...base, CS: wednesdays }, today)).toEqual([{ jour: day("2026-11-11"), reportee: undefined }]);
    expect(col.holidayLine({ jour: day("2026-11-11") })).toBe("Jour férié : vérifiez le calendrier du TCO (PDF) →");
    // Not a day of collection: nothing to say.
    expect(col.holidays(base, today)).toEqual([]);
  });

  it("never says a year's days of the next one", () => {
    const victoria = col.findStreets("rue victoria", "La Possession")[0];
    expect(col.streetLine(victoria, day("2027-01-04"))).toBe("Les calendriers 2027 du TCO ne sont pas encore publiés : nous ne pouvons pas encore donner les jours de collecte.");
    expect(col.streetLine(victoria, day("2026-12-20"))).toMatch(/\. Les calendriers 2027 du TCO ne sont pas encore publiés : nous ne pouvons pas encore donner les jours de collecte\.$/);
    expect(body(collecteAnswer("rue Victoria, La Possession", new Date("2027-01-04T08:00:00Z"))).resume).toBe(col.notYet());
  });

  it("says a street without a calendar as such, inferring nothing", () => {
    const nc = col.STREETS.find((s) => s.calendrier === -1)!;
    expect(col.streetLine(nc, day("2026-10-24"))).toBe(`${col.streetName(nc)}, ${nc.commune} : le TCO ne publie pas de calendrier de collecte pour cette voie, et nous ne savons pas si elle est collectée au porte-à-porte. Renseignez-vous auprès du TCO →`);
    const page = collectePage("https://rundata.re", NOW, nc.commune);
    expect(page).toContain('<h3>Voies sans calendrier du TCO</h3><p>Le TCO ne publie pas de calendrier de collecte pour ces voies, et nous ne savons pas si elles sont collectées au porte-à-porte. <a href="https://www.tco.re/contact" rel="noopener">Renseignez-vous auprès du TCO →</a></p>');
    // After the streets that have a calendar.
    expect(page.indexOf("Voies sans calendrier du TCO")).toBeGreaterThan(page.lastIndexOf("du TCO (PDF)</a></p></div>"));
  });

  it("finds a street as people type it", () => {
    expect(col.findStreets("r. victoria", "La Possession")[0]?.nom).toBe("Rue Victoria");
    expect(col.findStreets("ru")).toEqual([]);
    expect(parseLieu("12 rue Victoria, La Possession")).toEqual({ commune: "La Possession", rue: "rue victoria" });
    expect(parseLieu("chemin Tauran 97436 Saint-Leu")).toEqual({ commune: "Saint-Leu", rue: "chemin tauran" });
  });
});

describe("the tool and the pages", () => {
  it("answers for a street, in marketing's words, with the calendar's PDF", () => {
    const r = body(collecteAnswer("12 rue Victoria, La Possession", NOW));
    expect(r.resume).toMatch(/^Rue Victoria, La Possession : ordures ménagères le lundi et le jeudi ; tri le mercredi, une semaine sur deux \(prochain : 28\/10\)/);
    expect(r.rues[0].calendrier_pdf).toMatch(/2026_POSS_01\.pdf$/);
    expect(r.a_savoir).toBe("Seulement les 5 communes de l'Ouest (TCO) pour l'instant. Calendriers 2026 publiés par le TCO (data.tco.re), mis à jour le 06/08/2026. En cas d'alerte cyclonique, la collecte peut être suspendue : suivez les annonces du TCO.");
    expect(body(collecteAnswer("rue Inexistante du Test, Saint-Paul", NOW)).resume).toBe("Rue non trouvée dans les calendriers du TCO. Vérifiez l'orthographe, ou essayez le nom du quartier.");
    expect(body(collecteAnswer("Saint-Paul", NOW)).resume).toBe("Collecte des déchets : le jour de votre rue sur rundata.re/collecte/saint-paul.");
  });

  it("is what annuaire_services_publics answers about the bins, not the déchèteries", async () => {
    const cache = new Cache(new MemoryStore(), () => NOW.getTime());
    const r = body(await annuaireTool(cache, "collecte des déchets verts", "rue Victoria, La Possession", NOW));
    expect(r.rues[0].rue).toBe("Rue Victoria");
  });

  it("gives /collecte and a page per commune, every street of it, grouped by calendar", () => {
    const all = collectePage("https://rundata.re", NOW);
    expect(all).toContain("<title>Collecte des déchets Ouest Réunion : jours par rue · 974</title>");
    expect(all).toContain("<h1>Quel jour passent les poubelles ?</h1>");
    expect(communeOf("trois-bassins")).toBe("Les Trois-Bassins");
    const sp = collectePage("https://rundata.re", NOW, "Saint-Paul");
    expect(sp).toContain("<title>Collecte des déchets à Saint-Paul : jours par rue · 974</title>");
    expect(sp).toContain("<h1>Quel jour passent les poubelles à Saint-Paul ?</h1>");
    expect(sp).toContain("Ordures Ménagères, tri et déchets verts à Saint-Paul (974)".replace("Ménagères", "ménagères"));
    expect(sp).toContain("<li>Rue Leconte Delisle</li>");
    expect(sp).not.toContain("Rue Victoria");
    expect(sp).toContain('<a href="/decheteries">');
    expect(collectePage("https://rundata.re", NOW, "Le Port")).toContain("Les rues du Port");
  });

  it("sends the day's summary of a commune of the West to its page, never a day without a street", () => {
    const sp = resume(pageOf("saint-paul")!, {} as never, NOW);
    expect(sp.collecte_dechets?.texte).toBe("Collecte des déchets : le jour de votre rue sur rundata.re/collecte/saint-paul.");
    expect(sp.resume).toContain("collecte des déchets : le jour de votre rue sur rundata.re/collecte/saint-paul");
    expect(resume(pageOf("saint-denis")!, {} as never, NOW).collecte_dechets).toBeUndefined();
  });
});
