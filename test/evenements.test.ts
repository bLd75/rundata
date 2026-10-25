import { describe, expect, it } from "vitest";
import type { AgendaAnswer } from "../src/web/data.js";
import { agendaPage } from "../src/web/domains.js";
import { concertsPage, holidays, inWeekend, occurrences, weekend, weekendPage, weekendText } from "../src/web/evenements.js";

type Row = NonNullable<AgendaAnswer["evenements"]>[number];
const row = (titre: string, date: string, quand: string, more: Partial<Row> = {}): Row =>
  ({ titre, date, quand, genres: [], lien: `https://example.re/${encodeURIComponent(titre)}`, commune: "Saint-Paul", ...more }) as Row;

// Tuesday 27 October 2026, 10:00 in La Réunion; the weekend ahead ends with the Toussaint on the Sunday.
const TUESDAY = new Date("2026-10-27T06:00:00Z");
const ROWS: Row[] = [
  row("Marché forain", "2026-10-30T07:00", "vendredi 30/10 de 07:00 à 12:00", { genres: ["marché"] }),
  row("Concert de maloya", "2026-10-30T20:00", "vendredi 30/10 à 20:00", { genres: ["concert"], commune: "Le Port" }),
  row("Kabar du mardi", "2026-10-27T19:00", "mardi 27/10 à 19:00", { genres: ["concert"], autres_dates: ["samedi 31/10 à 19:00"] }),
  row("Fête du chouchou", "2026-10-29", "du jeudi 29/10 au lundi 02/11", { genres: ["festival"], commune: "Salazie" }),
  row("Conférence", "2026-10-28T18:00", "mercredi 28/10 à 18:00"),
  row("Théâtre", "2026-11-07T20:00", "samedi 07/11 à 20:00", { genres: ["théâtre"] }),
  row("Pique-nique créole", "2026-11-01T11:00", "dimanche 01/11 à 11:00", { genres: ["festival"] }),
];
const data = (rows: Row[], fetchedAt = TUESDAY) => ({
  value: { resume: "", nombre: rows.length, evenements: rows, couverture: "Agendas lus.", a_savoir: "Heures de La Réunion.", sources: [], ce_week_end: [] } as AgendaAnswer,
  fetchedAt,
});

describe("the weekend's events", () => {
  it("knows the holidays of La Réunion, the moving ones too", () => {
    const h = holidays(2027);
    expect(h.get("2027-03-29")).toBe("lundi de Pâques");
    expect(h.get("2027-05-06")).toBe("Ascension");
    expect(h.get("2027-05-17")).toBe("lundi de Pentecôte");
    expect(h.get("2027-12-20")).toBe("Fèt Kaf");
  });

  it("is Friday evening to Sunday, the coming one from Monday, with a holiday next to it", () => {
    expect(weekend(TUESDAY)).toMatchObject({ du: "2026-10-30", au: "2026-11-01", vendredi: "17:00" });
    expect([...weekend(TUESDAY).feries]).toEqual([["2026-11-01", "Toussaint"]]);
    // Sunday: still this one; Monday: the next.
    expect(weekend(new Date("2026-11-01T06:00:00Z")).du).toBe("2026-10-30");
    expect(weekend(new Date("2026-11-02T06:00:00Z")).du).toBe("2026-11-06");
    // Easter Monday belongs to the weekend before it, even on the day.
    expect(weekend(new Date("2027-03-24T06:00:00Z"))).toMatchObject({ du: "2027-03-26", au: "2027-03-29" });
    expect(weekend(new Date("2027-03-29T06:00:00Z")).du).toBe("2027-03-26");
    expect(weekendText(weekend(TUESDAY), TUESDAY)).toBe("Samedi 31 octobre et dimanche 1er novembre (Toussaint)");
    expect(weekendText(weekend(new Date("2026-11-01T06:00:00Z")), new Date("2026-11-01T06:00:00Z"))).toBe("Dimanche 1er novembre (Toussaint)");
  });

  it("reads the dates of a row as the agenda writes them", () => {
    expect(occurrences(ROWS[2])).toEqual([
      { du: "2026-10-27", au: "2026-10-27", debut: "19:00", fin: undefined, quand: "mardi 27/10 à 19:00" },
      { du: "2026-10-31", au: "2026-10-31", debut: "19:00", fin: undefined, quand: "samedi 31/10 à 19:00" },
    ]);
    expect(occurrences(ROWS[3])).toEqual([{ du: "2026-10-29", au: "2026-11-02", debut: undefined, fin: undefined, quand: "du jeudi 29/10 au lundi 02/11" }]);
    // Across the new year.
    expect(occurrences(row("Réveillon", "2026-12-31T21:00", "du jeudi 31/12 à 21:00 au vendredi 01/01 à 04:00"))[0]).toMatchObject({ du: "2026-12-31", au: "2027-01-01" });
  });

  it("keeps what happens that weekend: not Friday's daytime, the other dates of a row too", () => {
    const w = weekend(TUESDAY);
    const days = (r: Row) => inWeekend(r, w, TUESDAY).map((o) => o.day);
    expect(days(ROWS[0])).toEqual([]);
    expect(days(ROWS[1])).toEqual(["2026-10-30"]);
    expect(days(ROWS[2])).toEqual(["2026-10-31"]);
    expect(days(ROWS[3])).toEqual(["2026-10-30"]);
    expect(days(ROWS[4])).toEqual([]);
    expect(days(ROWS[5])).toEqual([]);
  });

  it("has its own page, title and trail, from the events page's copy", () => {
    const html = weekendPage("https://rundata.re", data(ROWS), TUESDAY);
    expect(html).toContain("<title>Que faire ce week-end à La Réunion ? · 974</title>");
    expect(html).toContain("<h1>Ce week-end à La Réunion</h1>");
    expect(html).toContain(`content="Samedi 31 octobre et dimanche 1er novembre (Toussaint)\u00a0: 4 sorties à La Réunion (974), concerts, fêtes, marchés et spectacles, commune par commune.`);
    expect(html).toContain(`<li><a href="/evenements">Événements</a></li><li aria-current="page">Ce week-end</li>`);
    expect(html).toContain(`"position":3,"name":"Ce week-end","item":"https://rundata.re/evenements/ce-week-end"`);
    expect(html).toContain("Vendredi 30 octobre soir");
    expect(html).toContain("Dimanche 1er novembre (Toussaint, férié)");
    // The other date of a row, with its hours.
    expect(html).toMatch(/Kabar du mardi<\/a>.*?<span class="q-none">19:00<\/span>/s);
    expect(html).not.toContain("Marché forain");
    expect(html).not.toContain("Conférence");
    expect(html).toContain(`<a href="/evenements/ce-week-end" aria-current="page">Ce week-end</a>`);
    // Each event once, at its date that weekend, for search engines.
    expect(html).toContain(`"@type":"Event","name":"Kabar du mardi","startDate":"2026-10-31T19:00:00+04:00"`);
    expect(html.match(/"@type":"Event"/g)).toHaveLength(4);
  });

  it("says so when the agendas have nothing for it", () => {
    expect(weekendPage("https://rundata.re", data([ROWS[5]]), TUESDAY)).toContain("Aucun événement trouvé dans les agendas lus pour ce week-end");
    expect(weekendPage("https://rundata.re", null, TUESDAY)).toContain("se charge");
  });
});

describe("the concerts", () => {
  it("are the agenda's concerts, tonight's apart", () => {
    const html = concertsPage("https://rundata.re", data(ROWS), TUESDAY);
    expect(html).toContain("<title>Concerts à La Réunion : ce soir et ce week-end · 974</title>");
    expect(html).toContain("<h1>Concerts à La Réunion</h1>");
    expect(html).toContain("dont 1 ce soir");
    expect(html).toContain("Concert de maloya");
    expect(html).not.toContain("Fête du chouchou");
    expect(html).toContain("Aujourd&#39;hui, mardi 27 octobre");
    expect(html.match(/"@type":"Event"/g)).toHaveLength(2);
    expect(html).toMatch(/<meta name="description" content="Les 2 prochains concerts à La Réunion \(974\)\u00a0: TÉAT, Cité des Arts/);
  });

  it("point to the halls' programmes when the agendas have none", () => {
    const html = concertsPage("https://rundata.re", data([ROWS[0]]), TUESDAY);
    expect(html).toContain("Aucun concert trouvé");
    expect(html).toContain(`href="https://kabardock.com/"`);
  });

  it("says, under an event from a commune's site, that site and when it was read; a link to its home page in a new window", () => {
    const html = agendaPage("https://rundata.re", data([
      row("Fête des lettres", "2026-10-30T18:00", "vendredi 30/10 à 18:00", { commune: "Le Tampon", publie_par: "Ville du Tampon", lu_le: "mardi 27/10 à 08:00", source: "site de la commune du Tampon, lu le mardi 27/10 à 08:00", lien: "https://letampon.fr/" }),
      row("Semaine créole", "2026-10-30", "vendredi 30/10", { commune: "Petite-Île", publie_par: "Ville de Petite-Île", lu_le: "mardi 27/10 à 08:00", source: "site de la commune de Petite-Île, lu le mardi 27/10 à 08:00", lien: "https://www.petite-ile.re/" }),
      row("Kabar", "2026-10-30T20:00", "vendredi 30/10 à 20:00", { publie_par: "Kabardock", lu_le: "mardi 27/10 à 08:00" }),
    ]), TUESDAY);
    expect(html).toContain("Source\u00a0: site de la commune du Tampon, lu le mardi 27/10 à 08:00");
    expect(html).not.toContain("Ville du Tampon, lu");
    expect(html).toContain("Kabardock, lu le mardi 27/10 à 08:00");
    expect(html).toContain(`<a href="https://www.petite-ile.re/" rel="noopener" target="_blank">Semaine créole</a>`);
    expect(html).not.toContain(`Kabar")}" rel="noopener" target`);
    // In the weekend's tile too.
    const tampon = row("Fête des lettres", "2026-10-30T18:00", "vendredi 30/10 à 18:00", { commune: "Le Tampon", publie_par: "Ville du Tampon", source: "site de la commune du Tampon, lu le mardi 27/10 à 08:00" });
    const tile = agendaPage("https://rundata.re", { value: { ...data([tampon]).value, ce_week_end: [tampon] }, fetchedAt: TUESDAY }, TUESDAY);
    expect(tile).toContain("Fête des lettres <span class=\"note\" style=\"color:var(--on-night-muted)\">(Le Tampon) · Source\u00a0: site de la commune du Tampon, lu le mardi 27/10 à 08:00</span>");
  });

  it("are linked from the events page", () => {
    const html = agendaPage("https://rundata.re", data(ROWS), TUESDAY);
    expect(html).toContain(`<a href="/evenements/concerts">Concerts</a>`);
    expect(html).toContain(`<a href="/evenements" aria-current="page">`);
  });
});
