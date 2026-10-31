import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import type { Info } from "../src/providers/actualites.js";
import { parse, type Seisme } from "../src/providers/seismes.js";
import { activityPosts, phaseOf } from "../src/providers/volcan.js";
import { BULLETIN_QUOTIDIEN, LOCALISES, perDay, volcanSeismes } from "../src/tools/volcan.js";
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
  void store.put("volcan:prefecture:phase", { value: null, fetchedAt: t });
  const may = { titre: "Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos", lien: "https://www.reunion.gouv.fr/x", publie: "2026-05-07T08:00:00.000Z" } as Info;
  void store.put("volcan:prefecture:derniere-phase", { value: phaseOf([may]), fetchedAt: t });
  return new Cache(store, () => t);
}

afterEach(() => vi.unstubAllGlobals());

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
    expect(r.seismes.note).toContain(LOCALISES);
    expect(JSON.stringify(r)).not.toMatch(/précéder|imminente?|approche|se calme/);
  });

  it("links the OVPF's daily bulletin for the events too small to be located, without reading it", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (u: string | URL | Request) => {
      asked.push(String(u instanceof Request ? u.url : u));
      throw new Error("no network in tests");
    });
    const r = body(await volcanSeismes(cacheWith(), NOW));
    const said = "Les séismes trop faibles pour être localisés ne sont pas comptés ici\u00a0: l'OVPF les compte dans son bulletin quotidien";
    expect(BULLETIN_QUOTIDIEN).toBe("https://www.ipgp.fr/volcanoweb/reunion/Bulletin_quotidien/bulletin.html");
    // In the summary, the note once, the bulletin named in it with its address (data-run).
    expect(r.resume).toContain(`L'OVPF ne localise qu'une partie des séismes qu'il enregistre\u00a0: son bulletin quotidien (${BULLETIN_QUOTIDIEN}) donne le nombre enregistré, nos chiffres comptent ceux qu'il a localisés, d'après son catalogue.`);
    expect(r.resume.split(LOCALISES)).toHaveLength(2);
    // The field `seismes.note` says the same sentence, the address after the bulletin's name (data-run).
    expect(r.seismes.note).toContain(`son bulletin quotidien (${BULLETIN_QUOTIDIEN}) donne le nombre enregistré`);
    expect(JSON.stringify(r)).not.toContain("ses bulletins donnent");
    expect(r.resume).not.toContain("ne sont pas comptés ici");
    expect(r.seismes.bulletin_quotidien).toEqual({ texte: `${said}.`, lien: BULLETIN_QUOTIDIEN });
    // A link only: the bulletin is never read, and none of its figures is taken.
    expect(asked.filter((u) => u.includes("Bulletin_quotidien"))).toEqual([]);
    expect(r.sources.map((x: { source: string }) => x.source).join(" ")).not.toMatch(/quotidien/i);
  });

  it("draws the bars from 0, one event never filling the chart, and says what is counted", async () => {
    const r = body(await volcanSeismes(cacheWith(), NOW));
    const html = volcanPage("https://rundata.re", { value: r, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain(`<h3>Séismes localisés par l'OVPF</h3><figure class="qdays"><figcaption>Sous le volcan, par jour (heure de La Réunion)</figcaption><ol>`);
    expect(html.match(/<figure class="qdays">[\s\S]*?<\/ol>/)![0].match(/<li/g)).toHaveLength(30);
    expect(html).toContain(`<li class="now" aria-label="23/10 (en cours) : `);
    expect(html).toContain(`<p class="axis"><span>24/09</span><span>23/10 (en cours)</span></p>`);
    expect(html).toContain(`<p class="note">L&#39;OVPF ne localise qu&#39;une partie des séismes qu&#39;il enregistre\u00a0: son <a href="${BULLETIN_QUOTIDIEN}">bulletin quotidien</a> donne le nombre enregistré, nos chiffres comptent ceux qu&#39;il a localisés, d&#39;après son catalogue.</p>`);
    // Said once on the page: the bulletin in the note, not a sentence more (data-run).
    expect(html).not.toContain("ne sont pas comptés ici");
    expect(html).not.toContain(`(${BULLETIN_QUOTIDIEN})`);
    expect(html).toContain("Séismes localisés par l'OVPF sous le volcan : <b>");
    expect(html).not.toMatch(/(?<!localisés )séismes sous le volcan/i);
    // pitonlive's word on the deformation is not said: on 25/10/2026 it said the opposite of the OVPF's release.
    expect(r.etat).not.toHaveProperty("deformation");
    for (const said of [JSON.stringify(r.etat), r.resume, html]) expect(said).not.toMatch(/déformation|selon pitonlive\.com\)/i);
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
