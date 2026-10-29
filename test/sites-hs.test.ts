import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import * as sitesHs from "../src/providers/sites-hs.js";
import { REGISTRY } from "../src/registre.js";
import { absents, antennesPage, coupe, horsService, ligneSite, ligneTuile } from "../src/web/antennes.js";
import { communePage } from "../src/web/commune.js";
import { pageOf } from "../src/web/places.js";

// Six lines of the Arcep's file of 29/10/2026 (raw2026-10-29.geojson, read at 14:53): two of the Ain, a maintenance, a
// line without a reason, one of Free cut in 5G only, and La Réunion's only one, Free at Saint-Philippe.
const text = readFileSync(new URL("./fixtures/sites_indisponibles_2026-10-29.geojson", import.meta.url), "utf8");
const features = JSON.parse(text).features;
// 15:00 in La Réunion.
const NOW = new Date("2026-10-29T11:00:00Z");
const at = (copie: sitesHs.Copie) => ({ value: copie, fetchedAt: new Date(copie.lu), stale: false });

afterEach(() => {
  sitesHs.configure(undefined);
  vi.unstubAllGlobals();
});

describe("the mobile sites out of service (Arcep, sites indisponibles)", () => {
  it("keeps La Réunion's lines only, with the days and never a time: the file gives no time zone", () => {
    const kept = features.flatMap((f: never) => sitesHs.site(f) ?? []);
    expect(kept).toEqual([{
      operateur: "Free", commune: "Saint-Philippe", insee: "97417", lon: 55.8019, lat: -21.3341,
      voix: true, data: true, raison: "panne", debut: "2026-10-28", fin: "2026-11-04",
    }]);
    expect(ligneSite(kept[0])).toBe("Saint-Philippe : Free, voix, SMS et internet mobile coupés (panne), depuis le 28/10, fin prévue par Free le 04/11.");
  });

  it("names what is cut: in full by the two columns, else the generations, else « en partie »; no reason, no word", () => {
    const one = (i: number) => sitesHs.site({ ...features[i], properties: { ...features[i].properties, departement: "974" } })!;
    // Free at Ahun, cut in 5G only.
    expect(coupe(one(4))).toBe("internet mobile coupé en 5G seulement");
    // Orange at Carhaix-Plouguer: nothing said cut, no reason, no days.
    expect(ligneSite(one(3))).toBe("Carhaix-Plouguer : Orange, service coupé en partie, fin non précisée.");
    expect(coupe({ ...one(4), data_g: undefined, voix_g: "23" })).toBe("voix et SMS coupés en 2G et 3G seulement");
    expect(coupe({ ...one(4), voix: true })).toBe("voix et SMS coupés");
    expect(coupe({ ...one(4), data: true })).toBe("internet mobile coupé");
    expect(one(2).raison).toBe("maintenance");
  });

  it("reads the file of the day once, writes it even empty, and leaves the copy alone while it is not out", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => (asked.push(url), new Response(text)));
    const write = vi.fn(async () => {});
    expect(await sitesHs.collect(null, write, NOW)).toBe("fichier du 2026-10-29 : 6 sites en France, 1 à La Réunion, écrits");
    expect(asked).toEqual(["https://arcep.s3.rbx.io.cloud.ovh.net/sites-indisponibles/all/2026-10-29/raw2026-10-29.geojson"]);
    expect(write).toHaveBeenCalledWith({ fichier_du: "2026-10-29", lu: NOW.toISOString(), sites: [expect.objectContaining({ commune: "Saint-Philippe" })] });
    // Read already: nothing asked.
    const before = (write.mock.calls[0] as unknown as [sitesHs.Copie])[0];
    expect(await sitesHs.collect(before, write, NOW)).toBe("fichier du 2026-10-29 déjà lu : 1 sites");
    expect(asked).toHaveLength(1);
    // The next day, before the Arcep publishes: the copy stays.
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    expect(await sitesHs.collect(before, write, new Date("2026-10-30T10:30:00Z"))).toBe("fichier du 2026-10-30 pas encore publié");
    expect(write).toHaveBeenCalledTimes(1);
    // A file without a site at La Réunion is written too: the page says the day of the last file read.
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ type: "FeatureCollection", features: features.slice(0, 2) })));
    await sitesHs.collect(before, write, new Date("2026-10-30T11:30:00Z"));
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ fichier_du: "2026-10-30", sites: [] }));
  });

  it("runs every hour at half past from 14:30 to 23:30 in La Réunion, never with the charging points' file", () => {
    const due = (h: number, m: number) => sitesHs.refreshDue(new Date(Date.UTC(2026, 9, 29, h, m)));
    expect([due(9, 30), due(10, 30), due(10, 34), due(10, 35), due(19, 30), due(20, 30), due(10, 5)]).toEqual([false, true, true, false, true, false, false]);
    expect(REGISTRY.find((e) => e.id === "antennes:hors-service")!.run).toMatchObject({ subrequests: 3, kvReads: 1, kvWrites: 1 });
  });

  it("says on /antennes the file's day, the sites, and the networks the file does not list", () => {
    const seul = "Ce fichier de l&#39;Arcep ne liste à La Réunion que des sites déclarés par Free : aucun site de SFR Réunion, de Zeop ni d&#39;Orange à La Réunion n&#39;y figure. Une panne de leurs réseaux peut donc ne pas apparaître ici.";
    const general = "Seuls les sites que les opérateurs déclarent à l&#39;Arcep figurent dans ce fichier : une panne non déclarée n&#39;apparaît pas ici.";
    const sites = [sitesHs.site(features[5])!];
    const today = horsService(at({ fichier_du: "2026-10-29", lu: NOW.toISOString(), sites }), NOW);
    expect(today).toContain("<p>Fichier de l&#39;Arcep du 29 octobre 2026 : 1 site mobile hors service à La Réunion.</p>");
    expect(today).toContain("<li>Saint-Philippe : Free, voix, SMS et internet mobile coupés (panne), depuis le 28/10, fin prévue par Free le 04/11.</li>");
    expect(today).toContain(seul);
    const none = horsService(at({ fichier_du: "2026-10-29", lu: NOW.toISOString(), sites: [] }), NOW);
    expect(none).toContain("<p>Fichier de l&#39;Arcep du 29 octobre 2026 : aucun site mobile déclaré hors service à La Réunion.</p>");
    // None: who declares is not known from the file, said in general, so that « aucun site » never reads as « aucune panne ».
    expect(none).toContain(general);
    expect(none).not.toContain("Free");
    // The day after, before its file is read: the last one, said so.
    expect(horsService(at({ fichier_du: "2026-10-29", lu: NOW.toISOString(), sites }), new Date("2026-10-30T05:00:00Z"))).toContain("<p>Fichier de l&#39;Arcep du 29 octobre 2026, le dernier lu : 1 site mobile hors service à La Réunion.</p>");
    expect(horsService(null, NOW)).toContain("<p>Le fichier de l&#39;Arcep n&#39;a pas encore été lu.</p>");
    // Never a time, never « rétabli », never « en direct ».
    for (const html of [today, none]) expect(html).not.toMatch(/rétabli|en direct|\d\d:\d\d/);
    const page = antennesPage("https://rundata.re", at({ fichier_du: "2026-10-29", lu: NOW.toISOString(), sites }), NOW);
    expect(page.indexOf('id="h-hs"')).toBeGreaterThan(page.indexOf('id="h-carte"'));
    expect(page).toContain("Arcep, sites indisponibles (Licence Ouverte Etalab 2.0)");
  });

  it("names the networks missing from the file read, never written: none said when the four are there", () => {
    const free = sitesHs.site(features[5])!;
    const as = (operateur: string) => ({ ...free, operateur });
    expect(absents([free])).toBe("Ce fichier de l'Arcep ne liste à La Réunion que des sites déclarés par Free : aucun site de SFR Réunion, de Zeop ni d'Orange à La Réunion n'y figure. Une panne de leurs réseaux peut donc ne pas apparaître ici.");
    // SRR may be written « SFR » or « SRR »: SFR Réunion either way.
    expect(absents([free, as("Orange"), as("SRR")])).toBe("Ce fichier de l'Arcep ne liste à La Réunion que des sites déclarés par Free, SFR Réunion et Orange : aucun site de Zeop à La Réunion n'y figure. Une panne de son réseau peut donc ne pas apparaître ici.");
    expect(absents([as("Orange"), as("SFR")])).toBe("Ce fichier de l'Arcep ne liste à La Réunion que des sites déclarés par SFR Réunion et Orange : aucun site de Free ni de Zeop à La Réunion n'y figure. Une panne de leurs réseaux peut donc ne pas apparaître ici.");
    // The four there: nothing to say, and nothing said.
    const four = [free, as("SFR"), as("Zeop"), as("Orange")];
    expect(absents(four)).toBeUndefined();
    const html = horsService(at({ fichier_du: "2026-10-29", lu: NOW.toISOString(), sites: four }), NOW);
    expect(html).toContain("4 sites mobiles hors service à La Réunion.");
    expect(html).not.toContain('class="note"');
    expect(absents([])).toBe("Seuls les sites que les opérateurs déclarent à l'Arcep figurent dans ce fichier : une panne non déclarée n'apparaît pas ici.");
  });

  it("adds a line to a commune's tile only when the file has sites there", () => {
    const sites = [sitesHs.site(features[5])!];
    const hs = at({ fichier_du: "2026-10-29", lu: NOW.toISOString(), sites });
    expect(ligneTuile(hs, "97417")).toBe("1 site Free hors service (panne), d'après le fichier de l'Arcep du 29 octobre 2026");
    const two = at({ fichier_du: "2026-10-29", lu: NOW.toISOString(), sites: [sites[0], { ...sites[0], raison: "maintenance" as const }] });
    expect(ligneTuile(two, "97417")).toBe("2 sites Free hors service (1 panne, 1 maintenance), d'après le fichier de l'Arcep du 29 octobre 2026");
    expect(ligneTuile(hs, "97424")).toBeUndefined();
    const tile = (slug: string) => {
      const page = communePage("https://rundata.re", pageOf(slug)!, { place: null, hs }, NOW);
      const start = page.indexOf("<h3><a href=\"/antennes\">Antennes</a></h3>");
      return page.slice(start, page.indexOf("</li>", start));
    };
    expect(tile("saint-philippe")).toContain(" · ANFR · 1 site Free hors service (panne), d&#39;après le fichier de l&#39;Arcep du 29 octobre 2026</p>");
    expect(tile("cilaos")).not.toContain("hors service");
  });

  it("is read from KV by the page, behind the data center's cache, and nothing without the store", async () => {
    expect(await sitesHs.sites(new Cache(new MemoryStore(), () => NOW.getTime()))).toBeNull();
    const copie = { fichier_du: "2026-10-29", lu: NOW.toISOString(), sites: [] };
    const read = vi.fn(async () => copie);
    sitesHs.configure(read);
    const cache = new Cache(new MemoryStore(), () => NOW.getTime());
    expect((await sitesHs.sites(cache))!.value).toEqual(copie);
    await sitesHs.sites(cache);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
