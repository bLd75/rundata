import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import type { Info } from "../src/providers/actualites.js";
import * as ocr from "../src/providers/ovpf-ocr.js";
import { parse } from "../src/providers/seismes.js";
import { activityPosts, phaseOf } from "../src/providers/volcan.js";
import { A_LIRE, A_LIRE_LU, enImages, enImagesLuesAilleurs, enImagesLuesApres, IMAGE_LUE_APRES, LU_DANS_L_IMAGE, volcanSeismes } from "../src/tools/volcan.js";
import { buildVolcan } from "../src/web/data.js";
import { volcanPage } from "../src/web/domains.js";
import { demos, type HomeLive } from "../src/web/home.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
// Tesseract 5.3.4 (fra) on the real images posted by the OVPF: the release of 24/10 18:30 (one image, posted at
// 19:46), the first and second images of the release of 25/10 08:00 (posted at 08:02), the second its figure 1.
const ARRET = fixture("ovpf-ocr/2410-1.tsv");
const RETOUR = fixture("ovpf-ocr/2510-1.tsv");
const FIGURE = fixture("ovpf-ocr/2510-2.tsv");
const POSTED_24 = "2026-10-24T15:46:21.485Z";
const POSTED_25 = "2026-10-25T04:02:38.225Z";
// The TSV with every word's confidence set to `conf`, or without the words of the lines `drop` matches.
const withConf = (tsv: string, conf: number) => tsv.split("\n").map((l) => { const c = l.split("\t"); if (c[0] === "5") c[10] = String(conf); return c.join("\t"); }).join("\n");
const without = (tsv: string, drop: RegExp) => {
  const rows = tsv.split("\n").map((l) => l.split("\t"));
  const line = (c: string[]) => c.slice(2, 5).join(".");
  const lines = new Map<string, string>();
  for (const c of rows) if (c[0] === "5") lines.set(line(c), `${lines.get(line(c)) ?? ""} ${c[11]}`);
  return rows.filter((c) => !(c[0] === "5" && drop.test(lines.get(line(c))!.trim()))).map((c) => c.join("\t")).join("\n");
};

describe("the text of a release read in its first image", () => {
  it("is the release from its dated line to its signature, the logos and the footer left out", () => {
    const r = ocr.readPage(ARRET, POSTED_24);
    expect(r).toMatchObject({ statut: "lu", jour: "2026-10-24", niveau_lu: "Niveau d'alerte : Alerte 1", confiance: 93.4, mots: 330 });
    if (r.statut !== "lu") throw new Error();
    expect(r.paragraphes[0]).toBe("Arrêt crise sismique");
    expect(r.paragraphes[1]).toBe("La crise sismique débutée le 24 octobre 2026 à 16h09 heure locale (12h09 heure UTC), a fortement ralenti depuis 17h03 heure locale (13h03 heure UTC) et peut être désormais considérée comme arrêtée.");
    // The figures as written: what was checked against the image, word for word.
    const all = r.paragraphes.join(" ");
    for (const s of ["entre 1,8 et 2,3 km sous la surface", "(< à 5 micro radians)", "(146 événements)", "janvier et février-avril 2026"]) expect(all).toContain(s);
    expect(r.paragraphes.at(-1)).toBe("Niveau d'alerte : Alerte 1");
    // Neither the header nor the dated line (its 18h30 is never said), nor the signature and the footer.
    for (const s of ["Université", "Communiqué", "18h30", "La direction", "bluesky", "97418"]) expect(all).not.toContain(s);
    // The release of 25/10, its level line « en cours ».
    expect(ocr.readPage(RETOUR, POSTED_25)).toMatchObject({ statut: "lu", jour: "2026-10-25", niveau_lu: "Niveau d'alerte en cours : Alerte 1", confiance: 92.4 });
  });

  it("is nothing, with the reason, when a page reads badly or is not a release of the day", () => {
    // A figure: its axes and legends are not text.
    expect(ocr.readPage(FIGURE, POSTED_25)).toEqual({ statut: "non_lu", raison: "confiance moyenne de 82,2, sous 88", confiance: 82.2, mots: 193 });
    expect(ocr.readPage("", POSTED_25)).toMatchObject({ statut: "non_lu", raison: "0 mots lus, moins de 80" });
    expect(ocr.readPage(withConf(ARRET, 87), POSTED_24)).toMatchObject({ statut: "non_lu", raison: "confiance moyenne de 87, sous 88" });
    // A good average with too many doubtful words.
    const rows = ARRET.split("\n");
    let n = 0;
    const doubtful = rows.map((l) => { const c = l.split("\t"); if (c[0] === "5" && n++ % 15 === 0) c[10] = "40"; return c.join("\t"); }).join("\n");
    expect(ocr.readPage(doubtful, POSTED_24)).toMatchObject({ statut: "non_lu", raison: expect.stringMatching(/^\d+ % des mots lus avec une confiance sous 60$/) });
    // Posted days after the release it shows: not the release of the post.
    expect(ocr.readPage(ARRET, "2026-10-27T06:00:00Z")).toMatchObject({ statut: "non_lu", raison: "ligne datée du 2026-10-24, publication du 2026-10-27" });
    // Without its header, its dated line, its signature or its level line.
    expect(ocr.readPage(without(ARRET, /^Communiqué$/), POSTED_24)).toMatchObject({ statut: "non_lu", raison: "en-tête « Communiqué » non lu" });
    expect(ocr.readPage(without(ARRET, /heure locale/), POSTED_24)).toMatchObject({ statut: "non_lu", raison: "ligne datée non lue" });
    expect(ocr.readPage(without(ARRET, /^La direction/), POSTED_24)).toMatchObject({ statut: "non_lu", raison: "signature de la direction de l'OVPF non lue" });
    expect(ocr.readPage(without(ARRET, /^Niveau d'alerte/), POSTED_24)).toMatchObject({ statut: "non_lu", raison: "ligne du niveau d'alerte non lue" });
  });

  it("gives its level only to compare it with the one known", () => {
    expect(ocr.sameLevel("Niveau d'alerte en cours : Alerte 1", "Alerte 1")).toBe(true);
    expect(ocr.sameLevel("Niveau d'alerte : Alerte 2 – 1", "Alerte 2-1")).toBe(true);
    expect(ocr.sameLevel("Niveau d'alerte : Alerte 1", "Vigilance")).toBe(false);
    expect(ocr.sameLevel("Niveau d'alerte : Alerte 1", undefined)).toBe(false);
    expect(ocr.sameLevel("Niveau d'alerte : Alerte 1 renforcée", "Alerte 1")).toBe(false);
  });

  it("is read in the first image of the posts given in images only", () => {
    const feed = JSON.parse(fixture("ovpf_bluesky_2026-10-25.json"));
    const posts = activityPosts(feed);
    expect(ocr.toRead(feed, posts)).toEqual([{
      post: posts[0],
      id: "3myod6frais2s",
      image: "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:qzdltnkksm37jcg5jr6rkuas/bafkreifuz4fbj55wfwfopvev4u636hnlwjbvxdcfbjc36dmnbbycnyb4ve",
    }]);
    expect(ocr.toRead(feed, posts.map(({ image: _, ...p }) => p))).toEqual([]);
  });
});

describe("the text read, in the answers", () => {
  afterEach(() => ocr.configure(undefined));
  const lien = "https://bsky.app/profile/ovpf.bsky.social/post/3myod6frais2s";
  const now = new Date("2026-10-25T06:20:00Z");
  const stored = { ...ocr.readPage(RETOUR, POSTED_25), lu_a: "2026-10-25T04:05:00.000Z", outil: "tesseract 5.3.4, fra" } as ocr.Stocke;

  // The post of 25/10 08:02 under the prefecture's alert 1 of the 24th (volcan.test.ts), or back in vigilance.
  function cache(alerte = true) {
    const store = new MemoryStore();
    const t = now.getTime();
    void store.put("seismes", { value: parse(fixture("ipgp_seismes.txt")), fetchedAt: t });
    void store.put("volcan:ovpf", { value: activityPosts(JSON.parse(fixture("ovpf_bluesky_2026-10-25.json"))), fetchedAt: t });
    void store.put("volcan:pitonlive", { value: JSON.parse(fixture("pitonlive_state.json")), fetchedAt: t });
    const titre = alerte ? "Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos" : "Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos";
    void store.put("volcan:prefecture:phase", { value: phaseOf([{ titre, lien: "https://www.reunion.gouv.fr/x", publie: "2026-10-24T13:00:00.000Z" } as Info]), fetchedAt: t });
    return new Cache(store, () => t);
  }

  it("is quoted as read by a machine, with the post's time and link, on /volcan and on the home page", async () => {
    const asked: string[] = [];
    ocr.configure(async (key) => (asked.push(key), key === ocr.KEY("3myod6frais2s") ? stored : null));
    const c = cache();
    const r = body(await volcanSeismes(c, now));
    expect(asked).toEqual(["ovpf:ocr:3myod6frais2s"]);
    expect(r.resume).toContain(`${enImagesLuesApres("25/10", "08:02")} : la voir, ${lien}. `);
    expect(r.resume).toContain(`${LU_DANS_L_IMAGE} : « Retour sur l’intrusion du 24 octobre 2026. Hier, une intrusion de magma a eu lieu`);
    expect(r.resume).toMatch(/… »/);
    // The time of the post, never the one written in the image.
    expect(r.resume).not.toMatch(/08[:h]00/);
    // « sans légende »: a text is quoted (marketing).
    expect(r.publications_ovpf[0]).toMatchObject({ date: "25/10 08:02 heure de La Réunion", texte: "Publication en 3 images, sans légende", lien, image: true, a_lire: A_LIRE_LU });
    expect(r.publications_ovpf[0].texte_lu_dans_l_image.split("\n\n")).toEqual((stored as { paragraphes: string[] }).paragraphes);
    // Read once: kept in the cache, KV is not asked again.
    await volcanSeismes(c, now);
    expect(asked).toHaveLength(1);

    const v = await buildVolcan(c, now);
    const html = volcanPage("https://rundata.re", { value: v, fetchedAt: now, stale: false }, now).replace(/&#39;/g, "'");
    // The top of the page leads to the text, open on the post's card; Facebook once, in « Suivre l'OVPF ».
    expect(html).toContain(`<p class="note">${enImages("25/10", "08:02")}\u00a0: <a href="#ovpf">son texte, lu automatiquement, plus bas ↓</a></p>`);
    expect(html.split("facebook.com/ObsVolcano")).toHaveLength(2);
    expect(html).toContain(`<p>Publication en 3 images, sans légende</p><details open><summary>${LU_DANS_L_IMAGE}</summary><p>Retour sur l’intrusion du 24 octobre 2026.`);
    expect(html).toContain(`<p>Niveau d'alerte en cours : Alerte 1</p></details><p><a href="${lien}">Voir les images sur Bluesky →</a></p>`);
    const demo = demos({ volcan: { value: v, fetchedAt: now, stale: false } } as unknown as HomeLive, now).find((d) => d.call === "volcan_seismes()")!;
    // The demo does not quote the text: where it is.
    expect(demo.answer.replace(/&#39;/g, "'")).toContain(`${enImagesLuesAilleurs("25/10", "08:02")} : <a href="${lien}">la voir sur Bluesky ↗</a>, ou suivre <a href="https://www.facebook.com/ObsVolcanoPitonFournaise">l'OVPF sur Facebook ↗</a>.`);
  });

  it("is quoted after what the post is, out of an alert, cut at a word", async () => {
    // The same release, had it been given in vigilance.
    const vigilance = { ...stored, niveau_lu: "Niveau d'alerte : Vigilance", paragraphes: ["Court texte.", "Niveau d'alerte : Vigilance"] } as ocr.Stocke;
    ocr.configure(async () => vigilance);
    const r = body(await volcanSeismes(cache(false), now));
    expect(r.resume).toContain(`Dernière publication de l'OVPF, le 25/10 à 08:02 : 3 images, sans légende. ${LU_DANS_L_IMAGE} : « Court texte. Niveau d'alerte : Vigilance » (${lien}). ${IMAGE_LUE_APRES}`);
    ocr.configure(async () => stored);
    const long = body(await volcanSeismes(cache(), now)).resume as string;
    const quoted = long.slice(long.indexOf(`${LU_DANS_L_IMAGE} : « `) + LU_DANS_L_IMAGE.length + 5, long.indexOf(" »", long.indexOf(LU_DANS_L_IMAGE)));
    expect(quoted.length).toBeLessThanOrEqual(401);
    expect(quoted).toMatch(/\S…$/);
  });

  it("is not said when the level it gives is not the one known, nor when nothing was read", async () => {
    ocr.configure(async () => stored);
    const r = body(await volcanSeismes(cache(false), now));
    expect(r.etat.niveau_orsec).toBe("Vigilance");
    expect(r.publications_ovpf[0]).toEqual({ date: "25/10 08:02 heure de La Réunion", texte: "Publication en 3 images, sans texte", lien, image: true, images: 3, a_lire: A_LIRE });
    expect(r.resume).toContain(`rundata.re ne lit pas les images : à voir sur ${lien}.`);
    expect(r.resume).not.toContain(LU_DANS_L_IMAGE);

    ocr.configure(async () => ({ statut: "non_lu", raison: "confiance moyenne de 82,2, sous 88", lu_a: "2026-10-25T04:05:00.000Z", outil: "tesseract 5.3.4, fra" }));
    expect(body(await volcanSeismes(cache(), now)).publications_ovpf[0].a_lire).toBe(A_LIRE);
    ocr.configure(async () => null);
    expect(body(await volcanSeismes(cache(), now)).publications_ovpf[0].a_lire).toBe(A_LIRE);
    ocr.configure(async () => { throw new Error("KV"); });
    expect(body(await volcanSeismes(cache(), now)).publications_ovpf[0].a_lire).toBe(A_LIRE);
  });
});
