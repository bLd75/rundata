import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import * as trace from "../src/providers/cmrs-trace.js";
import type { Store } from "../src/providers/vigilance-carte.js";
import { cyclones } from "../src/tools/cyclones.js";
import { basinMap, label, W } from "../src/web/cyclones-bassin.js";
import { buildCyclones } from "../src/web/data.js";
import { cyclonesPage } from "../src/web/domains.js";

// An invented bulletin in the form of the RSMC's WTIO31 FMEE (system, name and positions made up), with forecasts
// that must never be read. GDACS as in test/cyclones.test.ts: FYTIA active on 03/02/2026.
const bulletin = (n: number, heure: string, pos: string, stade = "TEMPETE TROPICALE MODEREE", nom = " (OPALE)") => {
  const [d, h] = heure.split(" ");
  return `WTIO31 FMEE 030645
CMRS / CENTRE DES CYCLONES TROPICAUX DE LA REUNION
BULLETIN D'ANALYSE ET DE PREVISION CYCLONIQUE (SUD-OUEST OCEAN
INDIEN)

0.A NUMERO DU BULLETIN : ${n}/4/20252026
1.A ${stade} 4${nom}

2.A POSITION A ${h} UTC LE ${d} :
DANS UN RAYON DE 20 MN AUTOUR DU POINT ${pos}
(DIX-SEPT DEGRES SUD ET CINQUANTE-DEUX DEGRES EST)
DEPLACEMENT: SUD-OUEST 7 KT

4.A PRESSION AU CENTRE: 990 HPA
5.A VENT MAX (MOYEN/10 MN): 45 KT

1.B PREVISIONS (EXTENSIONS DES VENTS FORTS EN KM):
12H: 03/02/2026 18 UTC: 18.0 S / 51.0 E, VENT MAX= 055 KT, FORTE TEMPETE TROPICALE

24H: 04/02/2026 06 UTC: 19.5 S / 50.2 E, VENT MAX= 065 KT, CYCLONE TROPICAL

2.C COMMENTAIRES:
T=3.0 CI=3.0
`;
};
const B6 = bulletin(6, "03/02/2026 0000", "16.4 S / 53.1 E", "DEPRESSION TROPICALE", "");
const B7 = bulletin(7, "03/02/2026 0600", "17.0 S / 52.4 E");
const B9 = bulletin(9, "03/02/2026 1800", "18.2 S / 51.3 E", "FORTE TEMPETE TROPICALE");

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const GDACS_FILE = (url: string) => {
  if (url.includes("geteventlist")) return url.includes("pagenumber=2") ? "cyclones/liste_page2.json" : "cyclones/liste_page1.json";
  if (url.includes("getepisodedata") && url.includes("eventid=1001254")) return "cyclones/episode_fytia.json";
  if (url.includes("gettimeline?id=732239")) return "cyclones/timeline_fytia.json";
};
// FYTIA's day, in the reading window after 06 UTC; October has no active system.
const AT = new Date("2026-02-03T07:00:00Z");
const OCTOBER = new Date("2026-10-24T07:00:00Z");

class FakeKv implements Store {
  data = new Map<string, string | ArrayBuffer>();
  puts = 0;
  async json(key: string) {
    const v = this.data.get(key);
    return typeof v === "string" ? JSON.parse(v) : null;
  }
  async bytes() {
    return null;
  }
  async put(key: string, value: string | ArrayBuffer) {
    this.puts++;
    this.data.set(key, value);
  }
}

function stubFetch(wtio?: () => Response) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string | Request) => {
    const u = typeof url === "string" ? url : url.url;
    calls.push(u);
    if (u === trace.URL) return wtio?.() ?? new Response("", { status: 503 });
    const f = GDACS_FILE(u);
    return f ? new Response(fixture(f)) : new Response("", { status: 503 });
  });
  return calls;
}
const cache = (now: Date) => new Cache(new MemoryStore(), () => now.getTime());

let kv: FakeKv;
beforeEach(() => {
  kv = new FakeKv();
  trace.configure(kv);
});
afterEach(() => {
  trace.configure();
  trace.ouvrir(trace.ACCORD !== null);
  vi.unstubAllGlobals();
});

describe("the bulletin, read", () => {
  it("keeps its number, the system's stage and name, and the position of « 2.A », never a forecast", () => {
    expect(trace.parse(B7)).toEqual({
      numero: 7, systeme: 4, saison: "20252026", nom: "Opale", stade: "tempête tropicale modérée",
      heure: "2026-02-03T06:00:00.000Z", lon: 52.4, lat: -17,
    });
    expect(trace.parse(B6)).toMatchObject({ numero: 6, nom: "système n° 4 (non baptisé)", stade: "dépression tropicale", lat: -16.4 });
    expect(trace.parse(B7.replace(/\n/g, "\r\n"))).toMatchObject({ numero: 7, lat: -17 });
    expect(JSON.stringify(trace.parse(B7))).not.toMatch(/18\.0|51\.0|19\.5|PREVISION|KT/);
  });

  it("gives the RSMC's stages in its words, with their accents", () => {
    expect(trace.stade("DEPRESSION RESIDUELLE")).toBe("dépression résiduelle");
    expect(trace.stade("CYCLONE TROPICAL TRES INTENSE")).toBe("cyclone tropical très intense");
    expect(trace.stade("DEPRESSION EXTRA-TROPICALE")).toBe("dépression extratropicale");
    expect(trace.stade("STADE INCONNU")).toBe("stade inconnu");
  });

  it("reads nothing of another file, nor of a bulletin without its position or with a date that is not one", () => {
    expect(trace.parse("<html>introuvable</html>")).toBeUndefined();
    expect(trace.parse(B7.replace("WTIO31", "WTIO30"))).toBeUndefined();
    expect(trace.parse(B7.replace(/^2\.A.*\n.*\n/m, ""))).toBeUndefined();
    expect(trace.parse(B7.replace("03/02/2026 :", "30/02/2026 :"))).toBeUndefined();
    // The system's number of « 1.A » is not the bulletin's.
    expect(trace.parse(B7.replace("MODEREE 4", "MODEREE 5"))).toBeUndefined();
  });

  it("reads from 25 minutes to 2 h 30 after each synoptic hour", () => {
    const at = (h: number, m: number) => trace.due(new Date(Date.UTC(2026, 1, 3, h, m)));
    expect([[6, 20], [6, 25], [7, 0], [8, 25], [8, 30], [11, 59], [12, 30]].map(([h, m]) => at(h, m))).toEqual([false, true, true, true, false, false, true]);
  });
});

describe("the positions kept", () => {
  const e0: trace.Etat = { traces: [] };

  it("adds each advisory once, in order, named by the newest bulletin, and says the gaps by their numbers", () => {
    let e = trace.ajoute(e0, trace.parse(B7)!, AT);
    e = trace.ajoute(e, trace.parse(B6)!, AT);
    expect(trace.ajoute(e, trace.parse(B7)!, AT)).toBe(e);
    e = trace.ajoute(e, trace.parse(B9)!, AT);
    expect(e.traces).toHaveLength(1);
    expect(e.traces[0].nom).toBe("Opale");
    expect(e.traces[0].points.map((p) => p.numero)).toEqual([6, 7, 9]);
    const [p] = trace.parcours(e, new Date("2026-02-03T19:00:00Z"));
    expect(p).toEqual({
      nom: "Opale", stade: "forte tempête tropicale", heure: "2026-02-03T18:00:00.000Z",
      points: [[53.1, -16.4], [52.4, -17], [51.3, -18.2]], premier: 6, dernier: 9, manquent: 1,
    });
  });

  it("stops drawing a system 18 hours after its last advisory, and forgets it after 30 days", () => {
    const e = trace.ajoute(e0, trace.parse(B7)!, AT);
    expect(trace.parcours(e, new Date("2026-02-03T23:59:00Z"))).toHaveLength(1);
    expect(trace.parcours(e, new Date("2026-02-04T00:00:00Z"))).toEqual([]);
    const later = trace.ajoute(e, { ...trace.parse(B7)!, systeme: 5, numero: 1 }, new Date("2026-03-06T00:00:00Z"));
    expect(later.traces.map((t) => t.systeme)).toEqual([5]);
  });
});

describe("before Météo-France's agreement", () => {
  it("is off: no request, no read of KV, nothing on the page", async () => {
    expect(trace.ACCORD).toBeNull();
    expect(trace.enLigne()).toBe(false);
    const calls = stubFetch(() => new Response(B7));
    expect(await trace.passage(cache(AT), AT)).toBe("pas d'accord");
    expect(calls).toEqual([]);
    kv.data.set("cmrs:trace", JSON.stringify(trace.ajoute({ traces: [] }, trace.parse(B7)!, AT)));
    const json = vi.spyOn(kv, "json");
    expect(await trace.kept(AT)).toEqual([]);
    expect(json).not.toHaveBeenCalled();
    const a = await buildCyclones(cache(AT), AT);
    expect(a.systemes_actifs?.length).toBeGreaterThan(0);
    expect(a.parcours).toBeUndefined();
    const page = cyclonesPage("https://rundata.re", { value: a, fetchedAt: AT, stale: false }, AT);
    expect(page).not.toContain('class="cur"');
    expect(page).toContain("Cette carte ne montre aucun système, ni sa position ni sa trajectoire.");
    expect(calls.some((u) => u.includes("noaa"))).toBe(false);
  });
});

describe("once Météo-France agrees", () => {
  beforeEach(() => trace.ouvrir(true));

  it("reads nothing without an active system, outside its minutes, nor without KV", async () => {
    const calls = stubFetch(() => new Response(B7));
    expect(await trace.passage(cache(OCTOBER), OCTOBER)).toBe("aucun système actif");
    expect(await trace.passage(cache(AT), new Date("2026-02-03T08:40:00Z"))).toBe("rien à lire");
    trace.configure();
    expect(await trace.passage(cache(AT), AT)).toBe("rien à lire");
    expect(calls.some((u) => u.includes("noaa"))).toBe(false);
  });

  it("reads the bulletin once a turn, writes only a new position, and keeps the trace when the file fails", async () => {
    let body = B6;
    const calls = stubFetch(() => new Response(body));
    expect(await trace.passage(cache(AT), AT)).toBe("bulletin 6/4 (système n° 4 (non baptisé))");
    expect(calls.filter((u) => u === trace.URL)).toHaveLength(1);
    expect(await trace.passage(cache(AT), AT)).toBe("bulletin 6/4 (système n° 4 (non baptisé))");
    expect(kv.puts).toBe(1);
    body = B7;
    expect(await trace.passage(cache(AT), AT)).toBe("bulletin 7/4 (Opale)");
    expect(kv.puts).toBe(2);
    body = "<html>maintenance</html>";
    expect(await trace.passage(cache(AT), AT)).toBe("bulletin illisible");
    expect(await trace.passage(cache(AT), AT)).toBe("bulletin illisible");
    expect(kv.puts).toBe(3);
    const [p] = await trace.kept(AT);
    expect(p.points).toHaveLength(2);
  });

  it("draws the path on the basin's map under the RSMC's, its last position named, and no forecast", async () => {
    stubFetch(() => new Response(B7));
    let e = trace.ajoute({ traces: [] }, trace.parse(B6)!, AT);
    e = trace.ajoute(e, trace.parse(B7)!, AT);
    kv.data.set("cmrs:trace", JSON.stringify(e));
    const a = await buildCyclones(cache(AT), AT);
    expect(a.parcours?.[0]).toMatchObject({ nom: "Opale", premier: 6, dernier: 7, manquent: 0 });
    const page = cyclonesPage("https://rundata.re", { value: a, fetchedAt: AT, stale: false }, AT);
    expect(page).toContain('<g class="cur"><path d="M');
    expect(page).toContain('<text class="cn"');
    expect(page).toContain(">Opale</text>");
    expect(page).toContain("En trait plein, le chemin déjà parcouru : les positions du système aux avis du CMRS, la dernière plus grande, avec son nom. <b>Opale</b> : tempête tropicale modérée au dernier avis, le 03/02 à 10:00 (heure de La Réunion).");
    expect(page).not.toContain(">tempête tropicale modérée, 03/02");
    expect(page).toContain("Rien de l'avenir : la trajectoire prévue est sur la carte officielle de Météo-France.");
    expect(page).toContain("Le chemin Opale commence à l'avis n° 6, le premier lu par rundata.re.");
    expect(page).toContain("Positions : Météo-France, CMRS de La Réunion (bulletins WTIO31 FMEE), avec son accord écrit, dernier avis le 03/02 à 10:00.");
    expect(page).not.toContain("Cette carte ne montre aucun système, ni sa position ni sa trajectoire.");
    // Nothing of the bulletin's forecasts, winds or pressure, nor a distance to the island.
    expect(page).not.toMatch(/18\.0|19\.5|990 hPa|45 KT|km de La Réunion/);
    // The past tracks stay off while a system is watched.
    expect(page).not.toContain('class="trc"');
  });

  it("says the path in the map's text for screen readers, and nothing of it without a system", () => {
    const p = trace.parcours(trace.ajoute({ traces: [] }, trace.parse(B7)!, AT), AT);
    expect(label(false, p)).toContain("En trait plein, le chemin déjà parcouru, d'après les avis du CMRS : Opale, tempête tropicale modérée, avis du 03/02 à 10:00 (heure de La Réunion). Aucune trajectoire prévue.");
    expect(basinMap(true, p)).not.toContain('class="cur"');
    expect(basinMap(false, [])).not.toContain('class="cur"');
  });

  it("puts the name inside the map and clear of the islands' names", () => {
    const named = (points: [number, number][]) => {
      const svg = basinMap(false, [{ nom: "Opale", stade: "forte tempête tropicale", heure: "2026-02-03T06:00:00.000Z", points, premier: 1, dernier: points.length, manquent: 0 }]);
      const m = /<text class="cn" x="([\d.-]+)" y="([\d.-]+)"(?: style="text-anchor:(\w+)")?>Opale<\/text>/.exec(svg)!;
      const [x, y, anchor = "start"] = [+m[1], +m[2], m[3]];
      const w = 5 * 34 * 0.65, x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
      return { svg, box: [x0, y - 20, x0 + w, y + 20] };
    };
    // By the map's east edge, the name goes inside it.
    const east = named([[86, -10], [88.5, -11]]);
    expect(east.box[2]).toBeLessThanOrEqual(W - 8);
    // Just north of Maurice: not over « Maurice » nor « La Réunion ».
    const near = named([[60.9, -14.2], [59.7, -15], [56.8, -17.8]]);
    const mada = /<text class="ln" x="([\d.-]+)" y="([\d.-]+)" transform="rotate[^>]*>Madagascar<\/text>/.exec(near.svg)!;
    expect(near.box[0] >= +mada[1] + 30 || near.box[1] >= +mada[2] + 96 || near.box[3] <= +mada[2] - 96, "Madagascar").toBe(true);
    for (const nom of ["Maurice", "La Réunion"]) {
      const t = new RegExp(`<text x="([\\d.-]+)" y="([\\d.-]+)"[^>]*>${nom}</text>`).exec(near.svg)!;
      const [tx, ty] = [+t[1], +t[2]];
      const tw = nom.length * 34 * 0.6, tx0 = nom === "La Réunion" ? tx - tw / 2 : tx;
      const apart = near.box[2] <= tx0 || near.box[0] >= tx0 + tw || near.box[3] <= ty - 20 || near.box[1] >= ty + 20;
      expect(apart, nom).toBe(true);
    }
  });

  it("never gives the positions to the tool's answer", async () => {
    stubFetch();
    kv.data.set("cmrs:trace", JSON.stringify(trace.ajoute({ traces: [] }, trace.parse(B7)!, AT)));
    const r = await cyclones(cache(AT), undefined, AT);
    expect(r.content[0].text).not.toMatch(/parcours|52\.4/);
  });
});
