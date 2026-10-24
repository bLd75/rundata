import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import type { Info } from "../src/providers/actualites.js";
import { parse, type Seisme } from "../src/providers/seismes.js";
import { activityPosts, phaseOf } from "../src/providers/volcan.js";
import { LOCALISES, perDay, volcanSeismes } from "../src/tools/volcan.js";
import { volcanLive, volcanPage } from "../src/web/domains.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
// 23/10/2026 at 03:20, heure de La Réunion.
const NOW = new Date("2026-10-22T23:20:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const quake = (time: string): Seisme => ({ id: time, time, lon: 55.71, lat: -21.24, profondeur_km: -1, magnitude: 0.8, type_magnitude: "Md" });

function cacheWith(posts = activityPosts(JSON.parse(fixture("ovpf_bluesky.json")))) {
  const store = new MemoryStore();
  const t = NOW.getTime();
  void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
  void store.put("volcan:ovpf", { value: posts, fetchedAt: t });
  void store.put("volcan:pitonlive", { value: JSON.parse(fixture("pitonlive_state.json")), fetchedAt: t });
  void store.put("volcan:prefecture", { value: null, fetchedAt: t });
  const may = { titre: "Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos", lien: "https://www.reunion.gouv.fr/x", publie: "2026-05-07T08:00:00.000Z" } as Info;
  void store.put("volcan:prefecture:derniere-phase", { value: phaseOf([may]), fetchedAt: t });
  return new Cache(store, () => t);
}

describe("the located earthquakes per day under the volcano", () => {
  it("counts by day of La Réunion, the 30 days up to today, today « en cours », the empty days at 0", () => {
    // 22/10 at 21:30 UTC is 23/10 at 01:30 in La Réunion: today's.
    const days = perDay([quake("2026-10-22T21:30:00.000Z"), quake("2026-10-22T19:00:00.000Z"), quake("2026-10-22T10:00:00.000Z"), quake("2026-09-23T22:00:00.000Z")], NOW);
    expect(days).toHaveLength(30);
    expect(days[0]).toEqual({ jour: "2026-09-24", nombre: 1 });
    expect(days.at(-2)).toEqual({ jour: "2026-10-22", nombre: 2 });
    expect(days.at(-1)).toEqual({ jour: "2026-10-23", nombre: 1, en_cours: true });
    expect(days.filter((d) => d.nombre === 0)).toHaveLength(27);
  });

  it("says « séismes localisés par l'OVPF », never what they may announce, to the AI", async () => {
    const r = body(await volcanSeismes(cacheWith(), NOW));
    expect(r.seismes.par_jour_sous_le_volcan).toHaveLength(30);
    expect(r.seismes.par_jour_sous_le_volcan.at(-1)).toMatchObject({ jour: "2026-10-23", en_cours: true });
    expect(r.resume).toMatch(/Séismes localisés par l'OVPF sous le volcan, par jour \(heure de La Réunion\) : 17\/10 \d+, .*, 23\/10 \d+ \(jour en cours\)\./);
    expect(r.resume).toContain(LOCALISES);
    expect(r.seismes.note).toContain(LOCALISES);
    expect(JSON.stringify(r)).not.toMatch(/précéder|imminente?|approche|se calme/);
  });

  it("draws the bars from 0, one event never filling the chart, and says what is counted", async () => {
    const r = body(await volcanSeismes(cacheWith(), NOW));
    const html = volcanPage("https://rundata.re", { value: r, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain(`<h3>Séismes localisés par l'OVPF</h3><figure class="qdays"><figcaption>Sous le volcan, par jour (heure de La Réunion)</figcaption><ol>`);
    expect(html.match(/<figure class="qdays">[\s\S]*?<\/ol>/)![0].match(/<li/g)).toHaveLength(30);
    expect(html).toContain(`<li class="now" aria-label="23/10 (en cours) : `);
    expect(html).toContain(`<p class="axis"><span>24/09</span><span>23/10 (en cours)</span></p>`);
    expect(html).toContain(`<p class="note">Seuls les séismes localisés par l&#39;OVPF sont comptés ici : ce n&#39;est pas le nombre total de séismes enregistrés.</p>`);
    expect(html).toContain("Séismes localisés par l'OVPF sous le volcan : <b>");
    expect(html).not.toMatch(/séismes sous le volcan/i);
    expect(html).toContain("Déformation du volcan : inflation (communiqué du 24/09).");
    // At most 10 a day, the scale stays at 10: one event is a tenth of the chart.
    const one = { ...r, seismes: { ...r.seismes, par_jour_sous_le_volcan: perDay([quake("2026-10-22T10:00:00.000Z")], NOW) } };
    const small = volcanPage("https://rundata.re", { value: one, fetchedAt: NOW, stale: false }, NOW);
    expect(small).toContain(`<li aria-label="22/10 : 1"><i style="height:10%"></i></li>`);
    expect(small).toContain(`<p>Aujourd'hui (en cours) : <b>0</b>, hier : <b>1</b>. Le plus en un jour sur 30 jours : <b>1</b>, le 22/10.</p>`);
    // Above 10, the highest day fills it.
    const many = { ...r, seismes: { ...r.seismes, par_jour_sous_le_volcan: perDay(Array.from({ length: 40 }, () => quake("2026-10-22T10:00:00.000Z")), NOW) } };
    expect(volcanPage("https://rundata.re", { value: many, fetchedAt: NOW, stale: false }, NOW)).toContain(`<li aria-label="22/10 : 40"><i style="height:100%"></i></li>`);
    expect(volcanLive({ value: r, fetchedAt: NOW, stale: false })!.detail).toMatch(/\d+ séismes? localisés? par l'OVPF sous le volcan en 7 jours/);
  });

  it("says under the bars too that the newest post of the OVPF is an image we do not read", async () => {
    const image = { feed: [{ post: { uri: "at://did:plc:x/app.bsky.feed.post/arret", author: { handle: "ovpf.bsky.social" }, record: { text: "", createdAt: "2026-10-22T20:00:00.000Z" }, embed: { $type: "app.bsky.embed.images#view", images: [{ alt: "" }] } } }] };
    const r = body(await volcanSeismes(cacheWith(activityPosts(image)), NOW));
    const html = volcanPage("https://rundata.re", { value: r, fetchedAt: NOW, stale: false }, NOW);
    const bars = html.slice(html.indexOf(`<figure class="qdays">`));
    expect(bars.slice(0, bars.indexOf(`<p class="facts">`))).toContain("La dernière publication de l&#39;OVPF est une image que nous ne lisons pas");
  });
});
