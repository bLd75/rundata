import { describe, expect, it } from "vitest";
import type { Cached } from "../src/cache.js";
import { communePage } from "../src/web/commune.js";
import type { BusData, CommuneData, TraficAnswer } from "../src/web/data.js";
import { busLive, busPage, saidNow, traficPage } from "../src/web/domains.js";
import { demos } from "../src/web/home.js";
import { pageOf } from "../src/web/places.js";

const ORIGIN = "https://rundata.re";
// Read on Monday 26/10/2026 at 23:50, La Réunion (UTC+4).
const READ = new Date("2026-10-26T19:50:00Z");
const at = (local: string) => new Date(`${local}+04:00`);
const cached = <T>(value: T): Cached<T> => ({ value, fetchedAt: READ, stale: false }) as Cached<T>;

type Row = BusData["gares"][number]["departs"][number];
const row = (heure: string, dans_min: number, ligne: string, more: Partial<Row> = {}): Row =>
  ({ heure, dans_min, ligne, direction: "Saint-Joseph", reseau: "Car Jaune", arret: "Gare de St-Pierre", ...more });
// As the timetables read at 23:50 give them: the departures after midnight are « demain ».
const departs = [row("23:58", 8, "S1"), row("demain 00:20", 30, "S2"), row("demain 04:30", 280, "S3")];

const p = pageOf("saint-pierre")!;
const commune = (now: Date) => communePage(ORIGIN, p, { place: null, commune: cached<CommuneData>({ bus: { gare: true, arrets: [], departs }, sources: [] }) }, now);
// Up to the next tile: the tile's own list has its rows.
const busTile = (page: string) => page.match(/<h3>(?:<a href="[^"]+">)?Bus(?:<\/a>)?<\/h3>(.*?)(?=<h3>)/s)![1];
const bus = cached<BusData>({ gares: [{ commune: "Saint-Pierre", arrets: [], departs }], reseaux: [], sources: [] });

describe("« demain » decided at the view, from the day at La Réunion, never kept from an older read", () => {
  it("takes the clock on the day nearest the departure", () => {
    expect(saidNow("demain 04:30", at("2026-10-27T04:30").getTime(), at("2026-10-27T03:00"))).toBe("04:30");
    expect(saidNow("04:30", at("2026-10-27T04:30").getTime(), at("2026-10-26T23:55"))).toBe("demain 04:30");
    // A bus late across midnight: its timetable time is today's, the announced one tomorrow's.
    expect(saidNow("23:58", at("2026-10-27T00:03").getTime(), at("2026-10-26T23:59"))).toBe("23:58");
    expect(saidNow("demain 00:03", at("2026-10-27T00:03").getTime(), at("2026-10-26T23:59"))).toBe("demain 00:03");
    expect(saidNow("demain 00:03", at("2026-10-27T00:03").getTime(), at("2026-10-27T00:01"))).toBe("00:03");
    // A round hour, as the copies write it (« 5 h »), and a copy written before kit.md's form (« 4h30 »), said in it.
    expect(saidNow("demain 5\u00a0h", at("2026-10-27T05:00").getTime(), at("2026-10-26T23:55"))).toBe("demain 5\u00a0h");
    expect(saidNow("demain 5\u00a0h", at("2026-10-27T05:00").getTime(), at("2026-10-27T03:00"))).toBe("5\u00a0h");
    expect(saidNow("4h30", at("2026-10-27T04:30").getTime(), at("2026-10-26T23:55"))).toBe("demain 04:30");
    expect(saidNow("demain 0h20", at("2026-10-27T00:20").getTime(), at("2026-10-27T00:10"))).toBe("00:20");
  });

  it("on the commune page, a view at 00:10 and at 03:00 of a read made at 23:50", () => {
    const night = busTile(commune(at("2026-10-27T00:10")));
    expect(night).toContain(`<p class="tv">00:20</p>`);
    expect(night).toContain("dans 10 min");
    expect(night).toContain("à 04:30");
    expect(night).not.toContain("demain");
    expect(night).not.toContain("<b>S1</b>");

    const early = busTile(commune(at("2026-10-27T03:00")));
    expect(early).toContain(`<p class="tv">04:30</p>`);
    expect(early).toContain("à 04:30");
    expect(early).not.toContain("demain");
    expect(early).not.toContain("<b>S2</b>");
  });

  it("before midnight, at 23:55, keeps « demain »; the next evening at 23:55, nothing is left of that read", () => {
    const evening = busTile(commune(at("2026-10-26T23:55")));
    expect(evening).toContain(`<p class="tv">23:58</p>`);
    expect(evening).toContain("dans 3 min");
    expect(evening).toContain("demain 00:20");
    expect(evening).toContain("demain 04:30");
    expect(busTile(commune(at("2026-10-27T23:55")))).toContain(`<p class="tv">Pas de départ</p>`);
  });

  it("on /bus, the home page's tile and its sample answer", () => {
    const page = busPage(ORIGIN, bus, at("2026-10-27T03:00"));
    expect(page).toContain("à 04:30");
    expect(page).not.toContain("demain 04:30");
    expect(page).not.toContain("<b>S1</b>"); // gone, though the copy still holds it
    expect(busPage(ORIGIN, bus, at("2026-10-26T23:55"))).toContain("demain 04:30");

    expect(busLive(bus, at("2026-10-27T03:00"))?.valeur).toBe("04:30");
    expect(busLive(bus, at("2026-10-26T23:55"))?.valeur).toBe("23:58");

    const sample = (now: Date) => demos({ bus }, now).find((d) => d.question.startsWith("Le prochain bus"))?.answer;
    expect(sample(at("2026-10-27T00:10"))).toBe("Ligne S2 vers Saint-Joseph à 00:20, puis ligne S3 vers Saint-Joseph à 04:30 (Car Jaune), d'après les horaires publiés.");
    expect(sample(at("2026-10-26T23:55"))).toContain("Ligne S1 vers Saint-Joseph à 23:58, puis ligne S2 vers Saint-Joseph demain à 00:20");
  });

  it("on /trafic, a late bus of the read at 23:50", () => {
    const d = {
      bus: { retards: [{ gare: "Saint-Pierre", reseau: "Car Jaune", ligne: "S2", direction: "Saint-Joseph", heure: "demain 00:05", retard_min: 6 }], suivis: 4, temps_reel: [], alertes: [] },
      routes_forestieres: null,
      sources: [],
    } as unknown as TraficAnswer;
    expect(traficPage(ORIGIN, cached(d), at("2026-10-27T00:10"))).toContain("gare de Saint-Pierre, départ prévu à 00:05");
    expect(traficPage(ORIGIN, cached(d), at("2026-10-26T23:55"))).toContain("gare de Saint-Pierre, départ prévu demain à 00:05");
  });
});
