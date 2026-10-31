import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heure, minutees, paire, tranche } from "../src/tools/format.js";
import { hoursOn, hoursText, openNow } from "../src/tools/annuaire.js";
import { placePage } from "../src/web/pages.js";
import { pageOf } from "../src/web/places.js";

// One way to write a time in the answers (27/10/2026): « 19:12 » with its minutes, « 18 h » on the hour and
// « 18 h–21 h » for a span, a no-break space before « h ». Never « 18h », nor « 19 h 12 ».
describe("the times of the answers", () => {
  it("write « 19:12 » with minutes, « 18 h » on the hour, a span alike at both ends", () => {
    expect(heure(19 * 60 + 12)).toBe("19:12");
    expect(heure(7 * 60 + 5)).toBe("07:05");
    expect(heure(18 * 60)).toBe("18 h");
    expect(heure(0)).toBe("0 h");
    expect(heure(24 * 60)).toBe("24 h");
    expect(tranche(18 * 60, 21 * 60)).toBe("18 h–21 h");
    expect(tranche(12 * 60, 12 * 60 + 54)).toBe("12:00–12:54");
    expect(paire(8 * 60 + 30, 12 * 60)).toEqual(["08:30", "12:00"]);
  });

  it("write every hour of one place with its minutes as soon as one has some (kit.md, 30/10/2026)", () => {
    expect(minutees([[8 * 60, 12 * 60], [13 * 60 + 30, 16 * 60 + 30]])).toBe(true);
    expect(minutees([[8 * 60, 12 * 60], [14 * 60, 17 * 60]])).toBe(false);
    expect(tranche(8 * 60, 12 * 60, true)).toBe("08:00–12:00");
    expect(tranche(8 * 60, 12 * 60, false)).toBe("8 h–12 h");
    expect(paire(6 * 60, 12 * 60, true)).toEqual(["06:00", "12:00"]);
  });

  it("give a mairie's hours by the same rule, and read a copy stored before as the same hours", () => {
    const office = (plages: [string, string][]) =>
      ({ nom: "Mairie", insee: "97415", adresse: "", lon: null, lat: null, horaires: [{ de: "lundi", a: "vendredi", plages }] }) as unknown as Parameters<typeof hoursText>[0];
    expect(hoursText(office([["08:00", "12:00"], ["13:30", "16:00"]]))).toBe("lundi au vendredi 08:00–12:00 et 13:30–16:00");
    expect(hoursText(office([["08:00", "12:00"], ["14:00", "17:00"]]))).toBe("lundi au vendredi 8 h–12 h et 14 h–17 h");
    // Minutes on Friday only: Monday's hours are written with theirs too, in the week and on the day (Monday 26/10).
    const week = {
      ...office([]),
      horaires: [{ de: "lundi", a: "jeudi", plages: [["08:00", "12:00"]] }, { de: "vendredi", a: "vendredi", plages: [["07:30", "12:00"]] }],
    } as unknown as Parameters<typeof hoursText>[0];
    expect(hoursText(week)).toBe("lundi au jeudi 08:00–12:00 ; vendredi 07:30–12:00");
    expect(hoursOn(week, new Date("2026-10-26T05:15:00Z"))).toBe("08:00–12:00");
    expect(hoursOn(office([["08h00", "12h00"], ["13h30", "16h00"]]), new Date("2026-10-26T05:15:00Z"))).toBe("08:00–12:00 et 13:30–16:00");
    // Monday 27/10/2026, 09:15 in La Réunion.
    const monday = new Date("2026-10-27T05:15:00Z");
    expect(openNow(office([["08:00", "12:00"]]), monday)).toBe(true);
    expect(openNow(office([["08h00", "09h00"]]), monday)).toBe(false);
    expect(openNow(office([["08h00", "12h00"]]), monday)).toBe(true);
  });

  it("never glue an hour to its « h » in what the tools write, but in the notices they quote", () => {
    const tools = new URL("../src/tools/", import.meta.url);
    // The prefects' and the observatory's words, quoted as they were published.
    const quotes = new Set(["volcan-historique.ts"]);
    const glued: string[] = [];
    for (const f of readdirSync(tools).filter((x) => x.endsWith(".ts") && !quotes.has(x))) {
      readFileSync(new URL(f, tools), "utf8").split("\n").forEach((line, i) => {
        const code = line.trim();
        if (/^(\/\/|\*|\/\*)/.test(code)) return;
        if (/\$\{[^}]*\}h(?!\w)/.test(line) || /(?<![\w/\\])\d{1,2}h\d{0,2}(?!\w)/.test(line)) glued.push(`${f}:${i + 1}`);
      });
    }
    expect(glued).toEqual([]);
  });
});

// One way to write a date and its time on a page (kit, #575): « le 23/10 à 22:00 », never « 23/10 22:00 » beside it.
describe("the dates of the pages", () => {
  it("dates the model's run on a weather page as the confidence's note does, « du 23/10 à 22:00 »", () => {
    const now = new Date("2026-10-24T10:00:00Z");
    const prevision = { resume: "", sources: [], jours: [{ jour: "Samedi 24/10", ciel_en_journee: "ensoleillé" }], modele: { nom: "AROME outre-mer de Météo-France", maille_km: 2.5, run_du_modele: "23/10 22:00" } };
    const data = { value: { meteo: { resume: "", stations: [], sources: [] }, prevision }, fetchedAt: now, stale: false };
    expect(placePage("https://rundata.re", pageOf("cilaos")!, data as never, now)).toContain("maille de 2,5 km, calcul du 23/10 à 22:00.");
  });
});
