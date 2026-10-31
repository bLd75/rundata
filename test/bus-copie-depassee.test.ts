import { describe, expect, it } from "vitest";
import type { Cached } from "../src/cache.js";
import { completeMinutes, type Departure, spread } from "../src/tools/transports.js";
import { communePage } from "../src/web/commune.js";
import type { BusData, CommuneData } from "../src/web/data.js";
import { busLive, busOutran, busPage, HORAIRES_CHARGENT } from "../src/web/domains.js";
import { pageOf } from "../src/web/places.js";
import { DOMAINS } from "../src/web/site.js";

const ORIGIN = "https://rundata.re";
const at = (local: string) => new Date(`${local}+04:00`);
// The copy seen on Saturday 31/10/2026 at 01:37: written on Friday at 19:45.
const READ = at("2026-10-30T19:45");
const cached = <T>(value: T): Cached<T> => ({ value, fetchedAt: READ, stale: false }) as Cached<T>;

type Row = BusData["gares"][number]["departs"][number];
const row = (heure: string, dans_min: number, ligne: string): Row =>
  ({ heure, dans_min, ligne, direction: "St-Denis", reseau: "Car Jaune", arret: "Gare" });
const card = (page: string, commune: string) => page.match(new RegExp(`<h3>Gare ${commune}</h3>(.*?)</li>`, "s"))![1];

// Saint-Pierre had 3 departures and more in 3 hours, so it looked 3 hours ahead; Le Tampon fewer, so 20 hours.
const bus = cached<BusData>({
  gares: [
    { commune: "Saint-Pierre", arrets: [], departs: [row("19:50", 5, "O2"), row("20:30", 45, "S1"), row("21:10", 85, "S3")], complet_min: 180 },
    { commune: "Le Tampon", arrets: [], departs: [row("20:05", 20, "S3"), row("demain 05:30", 585, "T06")], complet_min: 1200 },
    { commune: "Saint-Benoît", arrets: [], departs: [], complet_min: 1200 },
  ],
  reseaux: [],
  sources: [],
});

describe("a copy of /bus past what it knows of a station", () => {
  it("says the times are loading there, not « Pas de départ prévu », and keeps what the others know", () => {
    const night = busPage(ORIGIN, bus, at("2026-10-31T01:37"));
    expect(card(night, "de Saint-Pierre")).toContain(HORAIRES_CHARGENT);
    expect(card(night, "de Saint-Pierre")).not.toContain("Pas de départ");
    expect(card(night, "du Tampon")).toContain("05:30");
    // Nothing in its 20 hours: that is known.
    expect(card(night, "de Saint-Benoît")).toContain("Pas de départ prévu dans les prochaines heures.");
    // Within its 3 hours, the departures still to come.
    const evening = busPage(ORIGIN, bus, at("2026-10-30T20:40"));
    expect(card(evening, "de Saint-Pierre")).toContain("<b>S3</b>");
    expect(card(evening, "de Saint-Pierre")).not.toContain(HORAIRES_CHARGENT);
  });

  it("is refreshed before it is shown, to every visitor", () => {
    const waits = DOMAINS["/bus"].waits!;
    expect(waits("web:bus", bus.value, at("2026-10-31T01:37").getTime() - READ.getTime())).toBe(true);
    expect(waits("web:bus", bus.value, at("2026-10-30T22:44").getTime() - READ.getTime())).toBe(false);
    expect(busOutran(bus.value.gares[0], 180 * 60_000)).toBe(true);
    // A copy written before the field: taken as knowing, as before.
    expect(busOutran({}, 24 * 3600_000)).toBe(false);
  });

  it("gives the home page's tile nothing rather than « Pas de départ »", () => {
    const empty = cached<BusData>({ ...bus.value, gares: [bus.value.gares[0]] });
    expect(busLive(empty, at("2026-10-31T01:37"))).toBeUndefined();
    expect(busLive(cached<BusData>({ ...bus.value, gares: [{ ...bus.value.gares[0], complet_min: undefined }] }), at("2026-10-31T01:37"))?.valeur).toBe("Pas de départ");
  });

  it("on a commune's page, its bus tile says the same", () => {
    const p = pageOf("saint-pierre")!;
    const page = (complet_min?: number) =>
      communePage(ORIGIN, p, { place: null, commune: cached<CommuneData>({ bus: { gare: true, arrets: [], departs: bus.value.gares[0].departs, complet_min }, sources: [] }) }, at("2026-10-31T01:37"));
    const tile = (html: string) => html.match(/<h3>(?:<a href="[^"]+">)?Bus(?:<\/a>)?<\/h3>(.*?)(?=<h3>)/s)![1];
    expect(tile(page(180))).toContain(HORAIRES_CHARGENT.replace(" ", "&nbsp;").replace("&nbsp;", " "));
    expect(tile(page(180))).not.toContain("Pas de départ");
    expect(tile(page(1200))).toContain("Pas de départ");
  });
});

describe("how long a list of departures is whole", () => {
  const d = (min: number, route: number): Departure => ({ in: min * 60, at: 0, route, headsign: "x", reseau: "carjaune", arret: "Gare", trip: `${route}-${min}`, stop: 0, pattern: 0, jour: 20261031 }) as Departure;
  it("its horizon when nothing was left out, else up to the first departure left out", () => {
    const few = [d(10, 1), d(40, 2)];
    expect(completeMinutes(few, spread(few, 8), 20 * 3600)).toBe(1200);
    // A fourth departure of the same line is left out at 50 min.
    const one = [d(5, 1), d(20, 1), d(35, 1), d(50, 1), d(70, 2)];
    expect(completeMinutes(one, spread(one, 8), 3 * 3600)).toBe(50);
    // A ninth of the station, at 90 min.
    const many = Array.from({ length: 10 }, (_, i) => d(10 + i * 10, i));
    expect(completeMinutes(many, spread(many, 8), 3 * 3600)).toBe(90);
  });
});
