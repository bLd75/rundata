import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { ics, parseIcs } from "../src/providers/agenda.js";
import type { SourceInfo } from "../src/types.js";

// Saturday 24/10/2026 in the morning; the days read run to 08/12.
const NOW = new Date("2026-10-24T04:00:00Z");
const bytes = (f: string) => new Uint8Array(readFileSync(new URL(`./fixtures/agenda/${f}`, import.meta.url))).buffer;
const PAGE = "https://asso.example/agenda";
const SOURCE: SourceInfo = { id: "agenda_asso", nom: "Agenda de l'association", organisme: "Asso", licence: "Information publique", attribution: "Asso", url: PAGE };

describe("iCalendar agendas", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads The Events Calendar's export as the mairie typed it (Saint-Paul, recorded 25/10/2026)", () => {
    const events = parseIcs(bytes("ics_saint-paul.ics"), "Mairie de Saint-Paul", "https://www.mairie-saintpaul.re/evenements/", NOW, "Saint-Paul");
    expect(events.map((e) => e.titre)).toEqual([
      "La Koupe Kartié - Saint-Paul Centre",
      "La Koupe Kartié - Plateau Caillou",
      "La Koupe Kartié - Saint-Gilles-les-Bains",
      "Journée Portes Ouvertes France Services Tan Rouge",
      "Matinées agricole",
    ]);
    // TZID=Europe/Paris, but 8 h on its pages: the hour as typed.
    expect(events[0]).toMatchObject({
      seances: [{ debut: "2026-11-28T08:00", fin: "2026-11-28T15:00" }],
      lieu: "Stade Willy Aubras, 31 rue Jules Thirel, Saint-Paul",
      commune: "Saint-Paul",
      categories: ["Animations", "Jeunesse", "Proximitié", "Sport"],
      lien: "https://www.mairie-saintpaul.re/evenement/la-koupe-kartie-saint-paul-centre/",
      publie_par: "Mairie de Saint-Paul",
    });
    expect(events[0].description).toBeUndefined();
  });

  it("reads a public Google calendar: whole days, folded lines, escaped text, past days left out (recorded 25/10/2026)", () => {
    const events = parseIcs(bytes("ics_google-feries.ics"), "Google", PAGE, NOW);
    expect(events.map((e) => [e.titre, e.seances])).toEqual([
      ["L'Armistice", [{ debut: "2026-11-11" }]],
      ["La Toussaint", [{ debut: "2026-11-01" }]],
      ["Heure d'hiver", [{ debut: "2026-10-25" }]],
    ]);
    // The first line of a description folded over two lines and escaped (« \n », « \, »).
    expect(events[2].description).toBe("Journée d'observance");
    expect(events[0]).toMatchObject({ lien: PAGE, categories: [] });
  });

  it("expands the rules, takes out the days removed or moved, and says the cancelled (hand-written, Nextcloud style)", () => {
    const events = parseIcs(bytes("ics_exemple.ics"), "Asso", PAGE, NOW, "Saint-Joseph");
    const by = (t: string) => events.find((e) => e.titre === t)!;
    // Every Saturday: the 31st taken out (EXDATE), the 7th moved to the Sunday (RECURRENCE-ID).
    expect(by("Marché forain")).toMatchObject({
      id: "Asso:marche-forain@asso.example",
      seances: ["2026-10-24", "2026-11-14", "2026-11-21", "2026-11-28", "2026-12-05"].map((d) => ({ debut: `${d}T06:30`, fin: `${d}T12:00` })),
      lieu: "Place de la Mairie, 97480 Saint-Joseph",
      commune: "Saint-Joseph",
      lat: -21.3778,
      lon: 55.6192,
      categories: ["Marché", "Artisanat"],
      // The first sentence, not the alarm's « Rappel ».
      description: "Fruits, légumes et artisanat local.",
      lien: "https://asso.example/marche",
    });
    expect(by("Marché forain (dimanche exceptionnellement)")).toMatchObject({ id: "Asso:marche-forain@asso.example:2026-11-07", seances: [{ debut: "2026-11-08T06:30", fin: "2026-11-08T12:00" }], lien: PAGE });
    // The first Saturday of the month, three times from October, in UTC: 14 h UTC is 18 h here.
    expect(by("Kabar du premier samedi")).toMatchObject({ seances: [{ debut: "2026-11-07T18:00", fin: "2026-11-07T21:00" }, { debut: "2026-12-05T18:00", fin: "2026-12-05T21:00" }], commune: "Saint-Louis" });
    // Three whole days: DTEND is the day after the last. A fold cut its « é » in two.
    expect(by("Fête du goyavier")).toMatchObject({ seances: [{ debut: "2026-11-13", fin: "2026-11-15" }], description: "Trois journées autour du goyavier : marché, concours de confitures et bal la soirée du samedi." });
    expect(by("Loto de l'association")).toMatchObject({ statut: "annulé", seances: [{ debut: "2026-11-21T19:00", fin: "2026-11-21T23:00" }] });
    // A rule with BYSETPOS is not expanded: its first date only.
    expect(by("Assemblée générale").seances).toEqual([{ debut: "2026-11-28T09:00" }]);
    // Not shown: the private meeting, the busy hour without a title, last August's fête.
    expect(events.map((e) => e.titre)).not.toEqual(expect.arrayContaining(["Réunion du bureau"]));
    expect(events).toHaveLength(6);
  });

  it("expands every two weeks, the last Friday, the 31st of the months that have one, and once a year", () => {
    const cal = (rule: string, start = "DTSTART:20260904T150000Z") =>
      parseIcs(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x", "SUMMARY:Atelier", start, `RRULE:${rule}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n"), "Asso", PAGE, NOW)[0]?.seances.map((s) => s.debut) ?? [];
    expect(cal("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR")).toEqual(["2026-10-27T19:00", "2026-10-30T19:00", "2026-11-10T19:00", "2026-11-13T19:00", "2026-11-24T19:00", "2026-11-27T19:00", "2026-12-08T19:00"]);
    expect(cal("FREQ=MONTHLY;BYDAY=-1FR")).toEqual(["2026-10-30T19:00", "2026-11-27T19:00"]);
    expect(cal("FREQ=MONTHLY;BYMONTHDAY=31", "DTSTART;VALUE=DATE:20260731")).toEqual(["2026-10-31"]);
    expect(cal("FREQ=DAILY;UNTIL=20261026T235959Z")).toEqual(["2026-10-24T19:00", "2026-10-25T19:00", "2026-10-26T19:00"]);
    // Counted from the first, years ago: the 30th is past its tenth.
    expect(cal("FREQ=DAILY;COUNT=10", "DTSTART:20261017T150000Z")).toEqual(["2026-10-24T19:00", "2026-10-25T19:00", "2026-10-26T19:00"]);
    expect(cal("FREQ=YEARLY", "DTSTART;VALUE=DATE:20101101")).toEqual(["2026-11-01"]);
  });

  it("reads a webcal:// address over https, once an hour, with rundata.re's name", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      asked.push(`${url} ${new Headers(init?.headers).get("User-Agent")}`);
      return new Response(bytes("ics_exemple.ics"));
    });
    const agenda = ics("asso", "Asso", "webcal://asso.example/remote.php/dav/public-calendars/abc?export", PAGE, SOURCE, "Saint-Joseph");
    const cache = new Cache(new MemoryStore(), () => NOW.getTime());
    const first = await agenda.load(cache, NOW);
    await agenda.load(cache, NOW);
    expect(first.value).toHaveLength(6);
    expect(asked).toEqual(["https://asso.example/remote.php/dav/public-calendars/abc?export rundata.re (contact@rundata.re)"]);
  });
});
