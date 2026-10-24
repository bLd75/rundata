import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { counted, WORKER_BUDGET } from "../src/budget.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { parsePosts, slotsOf } from "../src/providers/coupures-courant.js";
import { ahead, type CourantAnswer, courantBlock, honesty, none, sentence } from "../src/tools/courant.js";
import { electricite } from "../src/tools/electricite.js";
import { resume } from "../src/tools/resume.js";
import { aujourdhuiPage } from "../src/web/aujourdhui.js";
import { electricitePage } from "../src/web/domains.js";
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
      "Dernier avis de coupure d'électricité publié par la mairie de Sainte-Marie le 21/10 : coupure programmée le lundi 26/10 de 09:00 à 15:00, secteurs Rue des Jésuites, Rue Médard ; le mardi 27/10 de 09:30 à 12:00, secteurs Chemin Conteur.",
    );
    expect(sentence(sp, NOW)).toBe("Coupure en cours selon la mairie de Saint-Philippe (avis du 24/10) : secteurs Chemin Paul Hoareau, Chemin Ceinture.");
    // Two days later, a cut said to be happening is no longer said to be.
    const later = new Date("2026-10-26T10:00:00Z");
    expect(sentence(sp, later)).toBe("Dernier avis de coupure d'électricité publié par la mairie de Saint-Philippe le 24/10 : coupure en cours ce jour-là, secteurs Chemin Paul Hoareau, Chemin Ceinture.");
    expect(ahead(sp, later)).toBe(false);
    expect(sentence(ci, NOW)).toContain("coupure programmée du lundi 26/10 au vendredi 30/10, secteurs L’Îlet à Cordes, Mare Sèche.");
    // A notice of another year says its year.
    const old = parsePosts([post("2025-04-30T11:48:00", "Coupure d&rsquo;électricité à Sainte Suzanne", "<p>Coupure d'électricité programmée le mercredi 14 mai 2025, entre 9h30 à 13h30.</p>")], "Sainte-Suzanne")[0];
    expect(sentence(old, NOW)).toBe("Dernier avis de coupure d'électricité publié par la mairie de Sainte-Suzanne le 30/04/2025 : coupure programmée le mercredi 14/05/2025 de 09:30 à 13:30.");
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
    const run = await counted(WORKER_BUDGET, () => electricite(new Cache(store, () => NOW.getTime()), NOW, "Sainte-Marie"));
    expect(body(run.value).coupures_annoncees.indisponible).toMatch(/pas encore été lus/);
    expect(requested.filter((u) => u.includes("wp-json"))).toEqual([]);
  });
});
