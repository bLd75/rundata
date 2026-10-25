import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parse, where } from "../src/providers/seismes.js";
import type { Info } from "../src/providers/actualites.js";
import { activityPosts, phaseOf } from "../src/providers/volcan.js";
import { A_LIRE, quakeSummary, volcanSeismes } from "../src/tools/volcan.js";
import { buildVolcan } from "../src/web/data.js";
import { volcanPage } from "../src/web/domains.js";
import { demos, type HomeLive } from "../src/web/home.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
// Samples of 23/10/2026 around 03:00 heure de La Réunion: no eruption, Enclos partly open, inflation since September.
const NOW = new Date("2026-10-22T23:20:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

function cacheWith(posts = activityPosts(JSON.parse(fixture("ovpf_bluesky.json")))) {
  const store = new MemoryStore();
  const t = NOW.getTime();
  void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
  void store.put("volcan:ovpf", { value: posts, fetchedAt: t });
  void store.put("volcan:pitonlive", { value: JSON.parse(fixture("pitonlive_state.json")), fetchedAt: t });
  void store.put("volcan:prefecture", { value: null, fetchedAt: t });
  // The last phase the prefecture declared, kept: back to vigilance in May, before pitonlive's status of October.
  const may = { titre: "Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos", lien: "https://www.reunion.gouv.fr/x", publie: "2026-05-07T08:00:00.000Z" } as Info;
  void store.put("volcan:prefecture:derniere-phase", { value: phaseOf([may]), fetchedAt: t });
  return new Cache(store, () => t);
}

describe("earthquakes", () => {
  it("reads the FDSN text, newest first, times in UTC", () => {
    const list = parse(fixture("ipgp_seismes.txt"));
    expect(list).toHaveLength(18);
    expect(list[0]).toMatchObject({ time: "2026-10-21T17:45:52.561Z", type_magnitude: "Md" });
  });

  it("says where in words", () => {
    expect(where(55.7131, -21.2391)).toBe("sous le sommet du Piton de la Fournaise");
    expect(where(55.488, -21.0)).toBe("à 6 km au nord-ouest de Salazie");
    expect(where(55.55, -21.2)).toMatch(/du Tampon$/);
  });

  it("counts under the volcano and elsewhere", () => {
    const q = quakeSummary(parse(fixture("ipgp_seismes.txt")), NOW);
    expect(q.sous_le_volcan["30_jours"]).toBe(11);
    expect(q.ailleurs_sur_l_ile["30_jours"]).toBe(7);
    expect(q.derniers[0].heure).toBe("21/10 21:45 heure de La Réunion");
  });
});

describe("volcano", () => {
  it("keeps the observatory's activity posts, not its conferences or job offers", () => {
    const posts = activityPosts(JSON.parse(fixture("ovpf_bluesky.json")));
    expect(posts[0].texte).toMatch(/^Bulletin mensuel OVPF-IPGP – Septembre 2026/);
    expect(posts.some((p) => /Offre d.emploi|Conférence/.test(p.texte))).toBe(false);
    expect(posts[0].lien).toMatch(/^https:\/\/bsky\.app\/profile\/ovpf\.bsky\.social\/post\//);
  });

  it("keeps a release given as an image alone, said as such, never a repost", async () => {
    const post = (rkey: string, createdAt: string, text: string, embed?: object, reason?: object) => ({
      ...(reason && { reason }),
      post: { uri: `at://did:plc:x/app.bsky.feed.post/${rkey}`, author: { handle: "ovpf.bsky.social" }, record: { text, createdAt }, ...(embed && { embed }) },
    });
    const image = (alt = "") => ({ $type: "app.bsky.embed.images#view", images: [{ alt, thumb: "https://cdn.bsky.app/x.jpg", fullsize: "https://cdn.bsky.app/y.jpg" }] });
    const feed = {
      feed: [
        // 24/10 at 19:46: « Arrêt crise sismique… Niveau d'alerte : Alerte 1 », as an image, no text nor alternative text.
        post("arret", "2026-10-24T15:46:00.000Z", "", image()),
        // A repost from another observatory, an image alone too: not the OVPF's.
        post("revosima", "2026-10-24T16:00:00.000Z", "", image(), { $type: "app.bsky.feed.defs#reasonRepost" }),
        // An image whose alternative text says what it is: its words, filtered as a text.
        post("alt", "2026-10-23T10:00:00.000Z", "", image("Communiqué OVPF : crise sismique en cours")),
        post("fete", "2026-10-22T10:00:00.000Z", "", image("Fête de la science à la Cité du Volcan")),
        // A link alone, no image: nothing to show.
        post("lien", "2026-10-21T10:00:00.000Z", "", { $type: "app.bsky.embed.external#view" }),
        post("bulletin", "2026-10-05T10:00:00.000Z", "Bulletin mensuel OVPF-IPGP – Septembre 2026", image()),
      ],
    };
    const posts = activityPosts(feed);
    expect(posts.map((p) => p.lien.split("/").pop())).toEqual(["arret", "alt", "bulletin"]);
    expect(posts[0]).toEqual({ date: "2026-10-24T15:46:00.000Z", texte: "Publication en une image, sans texte", lien: "https://bsky.app/profile/ovpf.bsky.social/post/arret", image: true, images: 1 });
    expect(posts[1].texte).toBe("Communiqué OVPF : crise sismique en cours");

    // The same in the answer and on /volcan: its day, the words, the link; nothing read from the image.
    const r = body(await volcanSeismes(cacheWith(posts), NOW));
    expect(r.resume).toContain("Dernière publication de l'OVPF, le 24/10 à 19:46 : une image, sans texte. rundata.re ne lit pas les images : à voir sur https://bsky.app/profile/ovpf.bsky.social/post/arret.");
    // Newer than pitonlive's status of the 19th: the state may not account for it, and nothing is drawn from it.
    expect(r.resume).toContain("La dernière publication de l'OVPF est une image que nous ne lisons pas : l'état ci-dessus peut ne pas en tenir compte.");
    expect(r.etat).toMatchObject({ image_ovpf_plus_recente: true, eruption_en_cours: false, niveau_orsec: "Vigilance" });
    expect(r.publications_ovpf[0]).toMatchObject({ texte: "Publication en une image, sans texte", image: true, lien: "https://bsky.app/profile/ovpf.bsky.social/post/arret", a_lire: A_LIRE });
    expect(r.publications_ovpf[1].a_lire).toBeUndefined();
    const html = volcanPage("https://rundata.re", { value: r, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain(`<p>Publication en une image, sans texte</p><p><a href="https://bsky.app/profile/ovpf.bsky.social/post/arret">Voir les images sur Bluesky →</a></p>`);
    expect(html).toContain(`<p class="lead">La dernière publication de l&#39;OVPF est une image que nous ne lisons pas : l&#39;état ci-dessus peut ne pas en tenir compte.</p>`);

    // An image older than what the state comes from: nothing more said.
    const older = body(await volcanSeismes(cacheWith(activityPosts({ feed: [post("ancienne", "2026-10-15T08:00:00.000Z", "", image())] })), NOW));
    expect(older.resume).toContain("une image, sans texte. rundata.re ne lit pas les images");
    expect(older.resume).not.toContain("peut ne pas en tenir compte");
    expect(older.etat.image_ovpf_plus_recente).toBeUndefined();
  });

  it("says the post of 25/10 given in three images, at the post's time, once under the alert", async () => {
    // The real post of 25/10 08:02: the release of 08:00 (an intrusion on the 24th, alert 1) as three images, no text,
    // no alternative text. Nothing is read from the images: neither the 08:00 written in them nor what they say.
    const posts = activityPosts(JSON.parse(fixture("ovpf_bluesky_2026-10-25.json")));
    const lien = "https://bsky.app/profile/ovpf.bsky.social/post/3myod6frais2s";
    expect(posts).toEqual([{ date: "2026-10-25T04:02:38.225Z", texte: "Publication en 3 images, sans texte", lien, image: true, images: 3 }]);

    // Under the prefecture's alert 1 of the 24th, read the morning after.
    const now = new Date("2026-10-25T06:20:00Z");
    const store = new MemoryStore();
    const t = now.getTime();
    void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
    void store.put("volcan:ovpf", { value: posts, fetchedAt: t });
    void store.put("volcan:pitonlive", { value: JSON.parse(fixture("pitonlive_state.json")), fetchedAt: t });
    const alerte = { titre: "Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", lien: "https://www.reunion.gouv.fr/x", publie: "2026-10-24T13:00:00.000Z" } as Info;
    void store.put("volcan:prefecture", { value: phaseOf([alerte]), fetchedAt: t });
    const cache = new Cache(store, () => t);
    const r = body(await volcanSeismes(cache, now));
    expect(r.resume).toContain(`L'OVPF et la préfecture n'ont pas annoncé d'éruption dans les textes que nous avons lus. La dernière publication de l'OVPF, le 25/10 à 08:02, est en images, que nous ne lisons pas : la voir, ${lien}.`);
    expect(r.resume).toContain(`Dernière publication de l'OVPF, le 25/10 à 08:02 : 3 images, sans texte. rundata.re ne lit pas les images : à voir sur ${lien}.`);
    expect(r.resume).not.toContain("08:00");
    // Said once under the alert: not « l'état ci-dessus peut ne pas en tenir compte » besides; the flag stays.
    expect(r.resume).not.toContain("peut ne pas en tenir compte");
    expect(r.etat.image_ovpf_plus_recente).toBe(true);
    // For the AI: the entry, and to open the link before saying anything of it.
    expect(r.publications_ovpf[0]).toEqual({ date: "25/10 08:02 heure de La Réunion", texte: "Publication en 3 images, sans texte", lien, image: true, images: 3, a_lire: A_LIRE });

    // On /volcan: under the lead, the link; the card says what it is and where to see it. And the home page's demo.
    const v = await buildVolcan(cache, now);
    const html = volcanPage("https://rundata.re", { value: v, fetchedAt: now, stale: false }, now).replace(/&#39;/g, "'");
    expect(html).toContain(`La dernière publication de l'OVPF, le 25/10 à 08:02, est en images, que nous ne lisons pas : <a href="${lien}">la voir</a>.</p>`);
    expect(html).not.toContain("peut ne pas en tenir compte");
    expect(html).toContain(`<p>Publication en 3 images, sans texte</p><p><a href="${lien}">Voir les images sur Bluesky →</a></p>`);
    const demo = demos({ volcan: { value: v, fetchedAt: now, stale: false } } as unknown as HomeLive, now).find((d) => d.call === "volcan_seismes()")!;
    expect(demo.answer.replace(/&#39;/g, "'")).toContain(`dans les textes que nous avons lus. La dernière publication de l'OVPF, le 25/10 à 08:02, est en images, que nous ne lisons pas : <a href="${lien}">la voir</a>. Le volcan est en alerte 1`);
  });

  it("keeps a release in images with a word or two as such, its words quoted, and a gallery counted", () => {
    const post = (rkey: string, text: string, embed: object) => ({ post: { uri: `at://did:plc:x/app.bsky.feed.post/${rkey}`, author: { handle: "ovpf.bsky.social" }, record: { text, createdAt: "2026-10-25T04:00:00.000Z" }, embed } });
    const images = (n: number) => ({ $type: "app.bsky.embed.images#view", images: Array.from({ length: n }, () => ({ alt: "" })) });
    const posts = activityPosts({
      feed: [
        // A word or two that the activity filter would not keep: the release is in the images.
        post("emoji", "🌋 👇", images(2)),
        post("deux", "Point situation", images(1)),
        post("galerie", "", { $type: "app.bsky.embed.gallery#view", items: [{}, {}, {}, {}] }),
        // A few words of what the filter leaves out, and a full text: as before.
        post("conference", "Conférence 14h30", images(1)),
        post("texte", "Conférence scientifique le 24 octobre à la Cité du Volcan", images(1)),
      ],
    });
    expect(posts.map((p) => [p.lien.split("/").pop(), p.texte])).toEqual([
      ["emoji", "Publication en 2 images, avec pour seul texte : « 🌋 👇 »"],
      ["deux", "Publication en une image, avec pour seul texte : « Point situation »"],
      ["galerie", "Publication en 4 images, sans texte"],
    ]);
  });

  it("sums it all up", async () => {
    const r = body(await volcanSeismes(cacheWith(), NOW));
    expect(r.resume).toContain("Pas d'éruption en cours au Piton de la Fournaise selon pitonlive.com. Niveau du dispositif ORSEC volcan : Vigilance.");
    expect(r.resume).toContain("Dernière éruption terminée le 12/04 selon pitonlive.com (il y a 193 jours).");
    expect(r.resume).toContain("Accès à l'Enclos : « partiel » selon pitonlive.com (source : Préfecture de La Réunion, arrêté n°\u00a02026-627 du 7 mai 2026).");
    expect(r.resume).toContain("11 sous le volcan (magnitude max 1)");
    expect(r.sources.map((s: { source: string }) => s.source)).toHaveLength(3);
  });
});
