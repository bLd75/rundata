import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { counted, PAGE_BUDGET } from "../src/budget.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { coupures, namedDay, parseMedia, parsePosts, slotsOf } from "../src/providers/coupures-courant.js";
import { ahead, type CourantAnswer, courantBlock, honesty, none, sentence, shortOf } from "../src/tools/courant.js";
import { electricite } from "../src/tools/electricite.js";
import { resume } from "../src/tools/resume.js";
import { aujourdhuiPage } from "../src/web/aujourdhui.js";
import { courantItem, electricitePage } from "../src/web/domains.js";
import { SHARED } from "../src/web/partagees.js";
import { pageOf } from "../src/web/places.js";

// Saturday 24 October 2026, 14:00 at La Réunion.
const NOW = new Date("2026-10-24T10:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const post = (date: string, title: string, html: string, link = `https://example.org/${encodeURIComponent(title)}`) => ({ date, title: { rendered: title }, link, content: { rendered: html } });

// The mairies' posts, written for the tests in the shapes they publish (WordPress gives the local time, no offset).
const POSTS: Record<string, ReturnType<typeof post>[]> = {
  "ville-saintemarie.re": [
    post("2026-10-21T10:00:00", "Avis de coupure d&rsquo;électricité", "<p>Travaux d'EDF Réunion sur le réseau.</p><p><strong>Le lundi 26 octobre de 9h00 à 15h00 :</strong></p><ul><li>Rue des Jésuites</li><li>RUE MÉDARD</li></ul><p><strong>Le mardi 27 octobre de 9h30 à 12h00 :</strong></p><ul><li>Chemin Conteur</li></ul><p>Merci de votre compréhension, une phrase qui ne doit jamais être reprise.</p>"),
    post("2026-10-05T15:20:00", "Appel à candidatures pour des bornes électriques", "<p>La commune cherche un exploitant.</p>"),
    post("2026-09-02T15:31:00", "Avis de coupure d&rsquo;électricité", "<p>Travaux le Lundi 07 septembre 2026 de 14h30 à 16h00, coupures sur le réseau.</p><ul><li>Rue Aurore</li></ul>"),
  ],
  "saintphilippe.re": [
    post("2026-10-24T08:00:00", "INFORMATION EDF – COUPURE D’ÉLECTRICITÉ", "<p>Une coupure d’électricité affecte actuellement les secteurs suivants :</p><ul><li>Chemin Paul Hoareau</li><li>Chemin Ceinture</li></ul>"),
    post("2025-09-30T09:05:00", "EDF &#8211; visites des lignes par drones", "<p>Des drones survolent les lignes du réseau électrique.</p>"),
  ],
  "ville-cilaos.fr": [
    post("2026-10-21T14:33:00", "Travaux sur le réseau électrique à Cilaos", "<p>Du&nbsp;<strong>26 au 30 octobre 2026</strong>, travaux sur le réseau électrique dans les secteurs de l&rsquo;Îlet à Cordes et de Mare Sèche.</p><p>Des coupures d&rsquo;électricité ponctuelles sont possibles.</p>"),
  ],
};

describe("the power cuts the mairies relay", () => {
  it("reads the days, the hours and the streets of each cut, in the notices' shapes", () => {
    const published = new Date("2026-10-21T06:00:00Z");
    expect(slotsOf("Le lundi 26 octobre de 9h00 à 15h00 :\nRue des Jésuites\nRUE MÉDARD\nLe mardi 27 octobre de 9h30 à 12h00 :\nChemin Conteur", published)).toEqual([
      { jour: "2026-10-26", de: "09:00", a: "15:00", secteurs: ["Rue des Jésuites", "Rue Médard"] },
      { jour: "2026-10-27", de: "09:30", a: "12:00", secteurs: ["Chemin Conteur"] },
    ]);
    expect(slotsOf("Du 26 au 30 octobre 2026, travaux dans les secteurs de l’Îlet à Cordes et de Mare Sèche.", published)).toEqual([
      { jour: "2026-10-26", au: "2026-10-30", secteurs: ["L’Îlet à Cordes", "Mare Sèche"] },
    ]);
    expect(slotsOf("Coupures aux dates suivantes :\nMardi 25 novembre 2025\n– De 09h00 à 14h30\nSecteurs concernés :\n– Rue Commerson\n– impasse DES CANNELLES", published)).toEqual([
      { jour: "2025-11-25", de: "09:00", a: "14:30", secteurs: ["Rue Commerson", "Impasse des Cannelles"] },
    ]);
    // A notice of December about January is of the next year.
    expect(slotsOf("coupure le lundi 4 janvier de 8h à 12h", new Date("2026-12-20T06:00:00Z"))[0]).toMatchObject({ jour: "2027-01-04", de: "08:00", a: "12:00" });
    // Neither the day a letter was registered nor a street named after a date is a day of cut.
    expect(slotsOf("Courrier enregistré le 27 mars 2026 : coupure pour travaux – MERCREDI 29 avril 2026 – Rue Payet, du 24 septembre", published).map((s) => s.jour)).toEqual(["2026-04-29"]);
  });

  it("keeps the notices of cuts only, with their facts, never their text", () => {
    const sm = parsePosts(POSTS["ville-saintemarie.re"], "Sainte-Marie");
    expect(sm.map((a) => a.publie)).toEqual(["2026-10-21T06:00:00.000Z", "2026-09-02T11:31:00.000Z"]);
    expect(sm[0]).toMatchObject({ commune: "Sainte-Marie", titre: "Avis de coupure d’électricité", nature: "programmée" });
    const sp = parsePosts(POSTS["saintphilippe.re"], "Saint-Philippe");
    expect(sp).toHaveLength(1);
    expect(sp[0]).toMatchObject({ nature: "en cours", creneaux: [], secteurs: ["Chemin Paul Hoareau", "Chemin Ceinture"] });
    expect(JSON.stringify([...sm, ...sp])).not.toMatch(/compréhension|affecte actuellement|Travaux d'EDF/);
  });

  const copy: CourantAnswer = {
    avis: [...parsePosts(POSTS["ville-saintemarie.re"], "Sainte-Marie"), ...parsePosts(POSTS["saintphilippe.re"], "Saint-Philippe"), ...parsePosts(POSTS["ville-cilaos.fr"], "Cilaos")],
    lues: ["Sainte-Marie", "Saint-Philippe", "Cilaos", "Saint-André"],
    indisponibles: ["Sainte-Suzanne"],
    sources: [],
  };

  it("says each notice in marketing's words, and never that there is no cut", () => {
    const [sm, , sp, ci] = copy.avis;
    expect(sentence(sm, NOW)).toBe(
      "Dernier avis de coupure d'électricité publié par la mairie de Sainte-Marie le 21/10 : coupure programmée le lundi 26/10 de 09:00 à 15:00, secteurs Rue des Jésuites, Rue Médard\u00a0; le mardi 27/10 de 09:30 à 12:00, secteurs Chemin Conteur.",
    );
    expect(sentence(sp, NOW)).toBe("Coupure en cours selon la mairie de Saint-Philippe (avis du 24/10) : secteurs Chemin Paul Hoareau, Chemin Ceinture.");
    // Two days later, a cut said to be happening is no longer said to be.
    const later = new Date("2026-10-26T10:00:00Z");
    expect(sentence(sp, later)).toBe("Dernier avis de coupure d'électricité publié par la mairie de Saint-Philippe le 24/10 : coupure en cours ce jour-là, secteurs Chemin Paul Hoareau, Chemin Ceinture.");
    expect(ahead(sp, later)).toBe(false);
    expect(sentence(ci, NOW)).toContain("coupure programmée du lundi 26/10 au vendredi 30/10, secteurs L’Îlet à Cordes, Mare Sèche.");
    // A notice of another year says its year.
    const old = parsePosts([post("2025-04-30T11:48:00", "Coupure d&rsquo;électricité à Sainte Suzanne", "<p>Coupure d'électricité programmée le mercredi 14 mai 2025, entre 9h30 à 13h30.</p>")], "Sainte-Suzanne")[0];
    expect(sentence(old, NOW)).toBe("Pas d'avis récent de la mairie de Sainte-Suzanne : le dernier date du 30/04/2025. Nous ne savons pas si une coupure est prévue.");
    // Past 30 days, the same: no details of a cut long gone.
    expect(sentence(sm, new Date("2026-11-25T10:00:00Z"))).toBe("Pas d'avis récent de la mairie de Sainte-Marie : le dernier date du 21/10. Nous ne savons pas si une coupure est prévue.");
    expect(none("Le Port")).toBe("La mairie du Port ne publie pas les avis d'EDF dans un format lisible : nous ne savons pas si une coupure est prévue.");
    // The communes of the honesty line: those whose mairie relayed a notice lately, not Saint-André's of long ago.
    expect(honesty(copy, NOW)).toBe("EDF ne publie pas ses avis de coupure dans un format que nous pouvons lire. Nous reprenons ceux que relaient les mairies : aujourd'hui Sainte-Marie, Saint-Philippe et Cilaos.");
    const cached = { value: copy, fetchedAt: NOW, stale: false };
    expect(courantBlock(cached, "Le Port", NOW)).toMatchObject({ avis: [], note: none("Le Port") });
    expect(courantBlock(cached, "Sainte-Marie", NOW).avis.map((x) => x.publie_le)).toEqual(["21/10 10:00"]);
    expect(JSON.stringify(courantBlock(cached, undefined, NOW))).not.toMatch(/pas de coupure/i);
  });

  it("is in the day's summary only for a cut of today or later, and only where the mairie relays them", () => {
    const c = { value: copy, fetchedAt: NOW, stale: false };
    const sm = resume(pageOf("sainte-marie")!, { courant: c } as never, NOW);
    expect(sm.coupures_electricite!.avis).toHaveLength(1);
    expect(JSON.stringify(sm)).not.toMatch(/0800/);
    expect(sm.resume).toContain("coupure d'électricité programmée le lundi 26/10 de 09:00 à 15:00");
    expect(resume(pageOf("sainte-marie")!, { courant: c } as never, new Date("2026-10-28T10:00:00Z")).coupures_electricite).toBeUndefined();
    const port = resume(pageOf("le-port")!, { courant: c } as never, NOW);
    expect(port.coupures_electricite).toBeUndefined();
    expect(port.resume).not.toMatch(/électricité/);
    const html = aujourdhuiPage("https://rundata.re", pageOf("saint-philippe")!, resume(pageOf("saint-philippe")!, { courant: c } as never, NOW), null);
    expect(html).toContain('<li class="warn">Coupure en cours selon la mairie de Saint-Philippe');
  });

  it("is a shared copy refreshed every two hours, shown on /electricite under marketing's header", () => {
    expect(SHARED.find((s) => s.key === "web:courant")?.every).toBe(120);
    const block = courantBlock({ value: copy, fetchedAt: NOW, stale: false }, undefined, NOW);
    const html = electricitePage("https://rundata.re", { value: { resume: "", avertissements: [], sources: [], coupures_annoncees: block } as never, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain('<section id="coupures" aria-labelledby="h-coupures">');
    expect(html).toContain("Coupures d'électricité annoncées par les mairies</h2>");
    expect(html).toContain("aujourd&#39;hui Sainte-Marie, Saint-Philippe et Cilaos.");
    expect(html).toContain("<p><b>Panne chez vous ? Le service dépannage d&#39;EDF Réunion répond au 0800 333 974 (numéro vert).</b></p>");
    expect(html).toMatch(/Dernier avis de coupure d&#39;électricité publié par la mairie de Sainte-Marie le 21\/10 : .*<a href="https:\/\/example\.org\/[^"]+" rel="noopener">l'avis →<\/a>/);
  });
});

describe("the tool electricite and the cuts", () => {
  const requested: string[] = [];
  beforeEach(() => {
    requested.length = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      requested.push(u);
      const site = Object.keys(POSTS).find((s) => u.includes(s));
      return site ? Response.json(POSTS[site]) : new Response("", { status: 404 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("answers for the place's commune, and says when its mairie publishes nothing", async () => {
    const r = body(await electricite(new Cache(new MemoryStore(), () => NOW.getTime()), NOW, "Sainte-Marie"));
    expect(r.resume).toMatch(/^Dernier avis de coupure d'électricité publié par la mairie de Sainte-Marie le 21\/10 : /);
    expect(r.coupures_annoncees.a_savoir).toMatch(/^EDF ne publie pas ses avis/);
    const port = body(await electricite(new Cache(new MemoryStore(), () => NOW.getTime()), NOW, "Le Port"));
    expect(port.resume).toMatch(/^La mairie du Port ne publie pas les avis d'EDF/);
  });

  it("never reads the mairies while a call of the Worker waits: only the scheduled event's copy", async () => {
    // EDF's production as the page copies have it; no copy of the cuts yet.
    const store = new MemoryStore();
    const fixture = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8")).results;
    await store.put("edf:mix", { value: fixture("edf_mix.json")[0], fetchedAt: NOW.getTime() });
    await store.put("edf:signal", { value: fixture("edf_signal.json"), fetchedAt: NOW.getTime() });
    const run = await counted(PAGE_BUDGET, () => electricite(new Cache(store, () => NOW.getTime()), NOW, "Sainte-Marie"));
    expect(body(run.value).coupures_annoncees.indisponible).toMatch(/pas encore été lus/);
    expect(requested.filter((u) => u.includes("wp-json"))).toEqual([]);
  });
});

describe("Saint-André's PDF letters of EDF", () => {
  // Names written for the tests in the shapes the mairie gives its files; no letter is read.
  const up = (folder: string, name: string) => `https://www.saint-andre.re/wp-content/uploads/${folder}/${name}.pdf`;
  const media = (date: string, url: string, mime_type = "application/pdf") => ({ date, source_url: url, mime_type });
  const MEDIA = [
    media("2026-10-22T09:00:00", up("2026/10", "CA00000001-EDF-Coupure-de-courant-le-2-Novembre-2026")),
    media("2026-10-20T13:00:00", up("2026/10", "EDF-REUNION-OCT")),
    media("2026-10-19T08:00:00", up("2026/10", "affiche_edf"), "image/jpeg"),
    media("2026-07-06T09:30:00", up("2026/07", "CA00000002-EDF-Coupure-de-courant-le-20-Juillet-2026")),
  ];

  it("reads the day of cut in the file's name only, its year from the upload folder", () => {
    const at = new Date("2026-04-01T06:00:00Z");
    expect(namedDay(up("2026/07", "CA00000002-EDF-Coupure-de-courant-le-20-Juillet-2026"), at)).toBe("2026-07-20");
    expect(namedDay(up("2026/04", "edf21avril"), at)).toBe("2026-04-21");
    expect(namedDay(up("2026/03", "edf_16avril"), at)).toBe("2026-04-16");
    // A letter of December about January: the next year.
    expect(namedDay(up("2026/12", "edf5janvier"), at)).toBe("2027-01-05");
    expect(namedDay(up("2024/08", "EDF-COUPURES-DELECTRICITE-LE-20-08-2024-CHEMIN"), at)).toBe("2024-08-20");
    expect(namedDay(up("2024/06", "EDF-COUPURES-DE-COURANT-POUR-TRAVAUX-24062024"), at)).toBe("2024-06-24");
    for (const name of ["EDF-REUNION-MAI", "EDF-REUNION-1", "EDF-REUNIONjui", "CA26008704-EDF-Coupure-dElectricite-pour-Travaux-Mer"]) expect(namedDay(up("2026/09", name), at)).toBeUndefined();
  });

  const avis = parseMedia(MEDIA, "Saint-André");

  it("keeps the PDFs, the day of cut when named, else the day it was put online", () => {
    expect(avis).toHaveLength(3);
    expect(avis[0]).toMatchObject({ commune: "Saint-André", nature: "programmée", creneaux: [{ jour: "2026-11-02", secteurs: [] }], pdf: true, lien: MEDIA[0].source_url });
    expect(avis[1]).toMatchObject({ nature: "information", creneaux: [], publie: "2026-10-20T09:00:00.000Z" });
  });

  it("says each letter in marketing's words, the upload never as the day of cut", () => {
    expect(sentence(avis[0], NOW)).toBe("Coupure d'électricité annoncée par EDF à Saint-André le lundi 02/11 : heures et secteurs dans l'avis publié par la mairie");
    expect(sentence(avis[1], NOW)).toBe("Avis de coupure d'EDF publié par la mairie de Saint-André le 20/10 : la date, les heures et les secteurs sont dans l'avis");
    // A letter of July, its cut long gone: its upload's day only.
    expect(sentence(avis[2], NOW)).toBe("Pas d'avis récent de la mairie de Saint-André : le dernier date du 06/07. Nous ne savons pas si une coupure est prévue.");
    const old = parseMedia([media("2026-09-04T09:34:00", up("2026/09", "EDF-REUNION"))], "Saint-André")[0];
    expect(sentence(old, NOW)).toBe("Pas d'avis récent de la mairie de Saint-André : le dernier date du 04/09. Nous ne savons pas si une coupure est prévue.");
    expect(shortOf({ ...avis[0], creneaux: avis[0].creneaux }, NOW)).toBe("coupure d'électricité annoncée par EDF le lundi 02/11, heures et secteurs dans l'avis de la mairie");
  });

  const copy: CourantAnswer = {
    avis: [...parsePosts(POSTS["ville-saintemarie.re"], "Sainte-Marie"), ...parsePosts(POSTS["saintphilippe.re"], "Saint-Philippe"), ...parsePosts(POSTS["ville-cilaos.fr"], "Cilaos"), ...avis],
    lues: ["Sainte-Marie", "Saint-Philippe", "Cilaos", "Saint-André", "Sainte-Suzanne"],
    indisponibles: [],
    sources: [],
  };
  const cached = { value: copy, fetchedAt: NOW, stale: false };

  it("adds Saint-André to the honesty line, the summary and the pages, the arrow its link", () => {
    expect(honesty(copy, NOW)).toMatch(/aujourd'hui Sainte-Marie, Saint-Philippe, Cilaos et Saint-André\.$/);
    const r = resume(pageOf("saint-andre")!, { courant: cached } as never, NOW);
    expect(r.coupures_electricite!.avis.map((x) => x.texte)).toEqual([sentence(avis[0], NOW)]);
    expect(r.resume).toContain("coupure d'électricité annoncée par EDF le lundi 02/11, heures et secteurs dans l'avis de la mairie");
    // The letter without a day is not in the summary.
    expect(resume(pageOf("saint-andre")!, { courant: { ...cached, value: { ...copy, avis: [avis[1]] } } } as never, NOW).coupures_electricite).toBeUndefined();
    const arrow = `le lundi 02/11 : heures et secteurs dans <a class="tap" href="${MEDIA[0].source_url}" rel="noopener">l&#39;avis publié par la mairie (PDF) →</a></li>`;
    const block = courantBlock(cached, "Saint-André", NOW);
    expect(electricitePage("https://rundata.re", { value: { resume: "", avertissements: [], sources: [], coupures_annoncees: block } as never, fetchedAt: NOW, stale: false }, NOW)).toContain(arrow);
    expect(aujourdhuiPage("https://rundata.re", pageOf("saint-andre")!, r, null)).toContain(arrow);
    const undated = courantBlock({ ...cached, value: { ...copy, avis: [avis[1]] } }, "Saint-André", NOW).avis;
    expect(courantItem(undated[0])).toBe(`<li>Avis de coupure d&#39;EDF publié par la mairie de Saint-André le 20/10 : la date, les heures et les secteurs sont <a class="tap" href="${MEDIA[1].source_url}" rel="noopener">dans l&#39;avis (PDF) →</a></li>`);
    // A letter said by its date only keeps the link of the other notices.
    const gone = courantBlock({ ...cached, value: { ...copy, avis: [avis[2]] } }, "Saint-André", NOW).avis;
    expect(courantItem(gone[0])).toBe(`<li>${sentence(avis[2], NOW).replace(/'/g, "&#39;")} <a href="${MEDIA[3].source_url}" rel="noopener">l'avis →</a></li>`);
  });

  it("reads the mairie's list of media beside its posts, and names it unavailable when the list fails", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      asked.push(u);
      if (u.includes("saint-andre.re/wp-json/wp/v2/media")) return Response.json(MEDIA);
      const site = Object.keys(POSTS).find((x) => u.includes(x));
      return Response.json(site ? POSTS[site] : []);
    });
    try {
      const all = await coupures();
      expect(asked.filter((u) => u.includes("saint-andre.re"))).toHaveLength(2);
      expect(asked.find((u) => u.includes("/media?"))).toContain("mime_type=application/pdf");
      expect(all.lues).toContain("Saint-André");
      expect(all.avis.filter((a) => a.commune === "Saint-André")).toHaveLength(3);
      vi.stubGlobal("fetch", async (url: string) => (String(url).includes("/media?") ? new Response("", { status: 503 }) : Response.json([])));
      const half = await coupures();
      expect(half.indisponibles).toEqual(["Saint-André"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
