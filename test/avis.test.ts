import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import * as avis from "../src/avis.js";
import { Cache, MemoryStore } from "../src/cache.js";
import type { Hit } from "../src/metrics.js";
import { parseAscii, parseCsv } from "../src/providers/acspo.js";
import { inReunionBeacons } from "../src/providers/pioupiou.js";
import { AVIS_HINT, cite } from "../src/tools/citer.js";
import { meteoActuelle } from "../src/tools/meteo.js";
import { SATELLITES, temperatureMer } from "../src/tools/mer.js";
import { insecables } from "../src/typographie.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-18T19:20:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

/** The recorded upstream answers, as in tools.test.ts: no test touches the network. */
async function offlineCache() {
  const store = new MemoryStore();
  const at = NOW.getTime();
  const beacons = inReunionBeacons(JSON.parse(fixture("pioupiou_all.json")).data);
  const live = beacons.map((b) => ({ ...b, measurements: { ...b.measurements, date: "2026-10-18T19:16:00Z" } }));
  await store.put("metar", { value: JSON.parse(fixture("metar.json")), fetchedAt: at });
  await store.put("pioupiou:all", { value: beacons, fetchedAt: at });
  await store.put("pioupiou:live", { value: live, fetchedAt: at });
  const satellites = [
    { source: "acspo", jours: [parseAscii(fixture("acspo.ascii"), "2026-10-16")], lu: at },
    { source: "modis", jours: parseCsv(fixture("modis.csv"), "sstMasked"), lu: at },
  ];
  await store.put(SATELLITES, { value: satellites, fetchedAt: at });
  return new Cache(store, () => at);
}

const mcp = (name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Request("https://rundata.re/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });

async function call(name: string, args: Record<string, unknown>, headers?: Record<string, string>) {
  const r = await (await handle(mcp(name, args, headers), new Cache())).json();
  return { isError: !!r.result?.isError, text: r.result?.content?.[0]?.text as string, error: r.error };
}

async function tools(): Promise<{ name: string; description: string; inputSchema: { properties: Record<string, unknown> } }[]> {
  const list = new Request("https://rundata.re/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  return (await (await handle(list, new Cache())).json()).result.tools;
}

describe("citation", () => {
  it("names rundata.re with the station measured, and links the place's page", async () => {
    const sp = body(cite("meteo_actuelle", await meteoActuelle(await offlineCache(), "Saint-Pierre", NOW)));
    expect(sp.citer).toBe("rundata.re, d'après Météo-France (station Saint-Pierre Pierrefonds), OpenWindMap");
    expect(sp.lien).toBe("https://rundata.re/meteo/saint-pierre?ref=mcp");
    const r = body(cite("meteo_actuelle", await meteoActuelle(await offlineCache(), "plage de l'Hermitage", NOW)));
    expect(r.citer).toMatch(/^rundata\.re, d'après /);
    expect(r.citer).toMatch(/^rundata\.re, d'après [^(]+ \((station|balise) [^)]+\)/);
    expect(r.lien).toBe("https://rundata.re/meteo/saint-paul?ref=mcp");
    expect(r.sources.length).toBeGreaterThan(0); // the producers' attribution stays
    expect(r.signaler).toBeUndefined();
  });

  it("cites the satellite of the sea temperature and links the sea page", async () => {
    const r = body(cite("temperature_mer", await temperatureMer(await offlineCache(), "Hermitage", NOW)));
    expect(r.citer).toMatch(/^rundata\.re, d'après .*(NOAA|NASA)/);
    expect(r.lien).toBe("https://rundata.re/mer?ref=mcp");
  });

  it("ends every tool's answer with it, through the MCP endpoint", async () => {
    const dae = JSON.parse((await call("defibrillateurs", { lieu: "Cilaos" })).text);
    expect(dae.citer).toBe("rundata.re, d'après Géo'DAE (ministère chargé de la santé)");
    expect(dae.lien).toBe("https://rundata.re/defibrillateurs?ref=mcp");
    const sources = JSON.parse((await call("sources_donnees", {})).text);
    expect(sources.citer).toMatch(/^rundata\.re, d'après .* et d'autres$/);
    expect(sources.lien).toBe("https://rundata.re/?ref=mcp");
  });

  it("is on errors too, with a pointer to donner_avis when the place is unknown", async () => {
    const r = await call("defibrillateurs", { lieu: "Tombouctou" });
    expect(r.isError).toBe(true);
    const p = JSON.parse(r.text);
    expect(p).toMatchObject({ citer: "rundata.re", lien: "https://rundata.re/defibrillateurs?ref=mcp", signaler: insecables(AVIS_HINT) });
  });

  it("points to donner_avis only when nothing was found", () => {
    const empty = { content: [{ type: "text" as const, text: JSON.stringify({ resume: "Aucun arrêt de bus trouvé pour « X »." }, null, 1) }] };
    expect(body(cite("transports", empty)).signaler).toBe(AVIS_HINT);
    const none = { content: [{ type: "text" as const, text: JSON.stringify({ resume: "Aucune restriction d'eau en vigueur à La Réunion." }, null, 1) }] };
    expect(body(cite("restrictions_eau", none)).signaler).toBeUndefined();
    // « Aucun » at the start says that nothing was found, whatever the verb; nothing in force or going on is an answer.
    const notYet = { content: [{ type: "text" as const, text: JSON.stringify({ resume: "Aucune borne publique connue à La Réunion." }, null, 1) }] };
    expect(body(cite("bornes_recharge", notYet)).signaler).toBe(AVIS_HINT);
    const quiet = { content: [{ type: "text" as const, text: JSON.stringify({ resume: "Rivières au vert. Aucune rivière suivie n'est en hausse sur la dernière demi-heure." }, null, 1) }] };
    expect(body(cite("crues_rivieres", quiet)).signaler).toBeUndefined();
    // Without a résumé, the first list of the answer, empty.
    const list = { content: [{ type: "text" as const, text: JSON.stringify({ lieu: { trouve: "Cilaos" }, defibrillateurs: [], sources: [] }, null, 1) }] };
    expect(body(cite("defibrillateurs", list)).signaler).toBe(AVIS_HINT);
    // The hint has its own name: an answer's `avis` (the water distributors' notices) is never overwritten.
    const notices = { content: [{ type: "text" as const, text: JSON.stringify({ resume: "Aucun avis de coupure récent.", avis: [] }, null, 1) }] };
    const n = body(cite("coupures_eau", notices));
    expect(n.avis).toEqual([]);
    expect(n.signaler).toBe(AVIS_HINT);
  });

  it("links the page the answer names, before the tool's page", () => {
    const passe = { content: [{ type: "text" as const, text: JSON.stringify({ cyclone: "Gamède", page: "https://rundata.re/cyclones/gamede-2007" }, null, 1) }] };
    expect(body(cite("cyclones", passe)).lien).toBe("https://rundata.re/cyclones/gamede-2007?ref=mcp");
    const bins = { content: [{ type: "text" as const, text: JSON.stringify({ resume: "…", page: "https://rundata.re/collecte/saint-paul#rue" }, null, 1) }] };
    expect(body(cite("annuaire_services_publics", bins)).lien).toBe("https://rundata.re/collecte/saint-paul?ref=mcp#rue");
    const elsewhere = { content: [{ type: "text" as const, text: JSON.stringify({ page: "https://www.shom.fr" }, null, 1) }] };
    expect(body(cite("maree", elsewhere)).lien).toBe("https://rundata.re/mer?ref=mcp");
  });
});

describe("donner_avis", () => {
  let rows: unknown[][];
  beforeEach(() => {
    rows = [];
    avis.configure(async (_sql, ...params) => {
      rows.push(params);
      return rows.length <= 2 ? 1 : 0; // the third is over the hourly cap
    });
  });
  afterEach(() => avis.configure(undefined));

  it("keeps the feedback with the assistant's name, without phone numbers or e-mail addresses", async () => {
    const r = await call(
      "donner_avis",
      { type: "manque", outil: "meteo_actuelle", lieu: "Mafate", message: "Pas de station à Mafate. Joindre jean@exemple.re ou 0692 12 34 56.", besoin: "la pluie à Marla" },
      { "user-agent": "Claude-User", "cf-connecting-ip": "203.0.113.7" },
    );
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text).merci).toMatch(/rundata\.re/);
    const [t, canal, type, outil, lieu, message, question, client, page, source] = rows[0];
    expect({ canal, type, outil, lieu, question, client, page }).toEqual({ canal: "mcp", type: "manque", outil: "meteo_actuelle", lieu: "Mafate", question: "la pluie à Marla", client: "Claude", page: null });
    expect(message).toBe("Pas de station à Mafate. Joindre [courriel retiré] ou [numéro retiré].");
    expect(typeof t).toBe("number");
    expect(source).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(rows[0])).not.toContain("203.0.113.7");
  });

  it("is called with the user's agreement, and keeps a short need, never the conversation", async () => {
    const tool = (await tools()).find((t) => t.name === "donner_avis")!;
    expect(tool.description).not.toMatch(/sans attendre/);
    expect(tool.description).toMatch(/accord/);
    expect(Object.keys(tool.inputSchema.properties)).not.toContain("question_utilisateur");
    await call("donner_avis", { type: "manque", message: "Pas de station à Marla.", question_utilisateur: "Il pleut à Marla ?" });
    expect(rows[0][6]).toBeNull();
    const r = await call("donner_avis", { type: "manque", message: "Pas de station à Marla.", besoin: "x".repeat(avis.BESOIN_MAX + 1) });
    expect(r.isError).toBe(true);
  });

  it("blanks the French and Réunion phone numbers, and keeps GPS coordinates and other numbers", () => {
    for (const phone of ["0692 12 34 56", "0692123456", "02.62.12.34.56", "02-62-12-34-56", "+262 692 12 34 56", "+262692123456", "00262 692 12 34 56", "+33 6 12 34 56 78", "+33 (0)6 12 34 56 78", "+44 20 7946 0958", "+1-202-555-0143"]) {
      expect(avis.nettoie(`Appeler le ${phone} svp`, 200)).toBe("Appeler le [numéro retiré] svp");
    }
    for (const kept of [
      "Position fausse, le point est à -21.0512345 55.2212345",
      "Le point est à -21,0692123 ; 55,0262123",
      "Coordonnées -21.2085, +55.5714 (WGS84) ou +55.2212345",
      "Station à 21.0692123456 S",
      "Code postal 97411, ligne 0692 du réseau",
      "Relevé 123456789012 du compteur",
    ]) {
      expect(avis.nettoie(kept, 200)).toBe(kept);
    }
  });

  it("is counted in the usage like any other tool, without its message", async () => {
    const hits: Hit[] = [];
    await (await handle(mcp("donner_avis", { type: "suggestion", message: "Ajouter la houle" }), new Cache(), () => {}, (h) => hits.push(h))).json();
    const hit = hits.find((h) => h.kind === "mcp");
    expect(hit).toMatchObject({ kind: "mcp", name: "donner_avis", ok: true });
    expect(JSON.stringify(hits)).not.toContain("houle");
  });

  it("refuses an unknown type, an empty message or one too long", async () => {
    for (const args of [{ type: "bof", message: "trop bien" }, { type: "bravo", message: "  " }, { type: "erreur", message: "x".repeat(avis.MESSAGE_MAX + 1) }]) {
      const r = await call("donner_avis", args);
      expect(r.isError || !!r.error).toBe(true);
    }
    expect(rows).toHaveLength(0);
  });

  it("says when a sender has sent too many", async () => {
    for (let i = 0; i < 2; i++) await call("donner_avis", { type: "suggestion", message: `idée ${i}` });
    const r = await call("donner_avis", { type: "suggestion", message: "encore une" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/plus tard/);
  });

  it("says where to write when the server keeps no feedback", async () => {
    avis.configure(undefined);
    const r = await call("donner_avis", { type: "bravo", message: "Merci pour le site" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/https:\/\/rundata\.re/);
  });
});

describe("the site's feedback form", () => {
  let rows: unknown[][];
  beforeEach(() => {
    rows = [];
    avis.configure(async (_sql, ...params) => (rows.push(params), 1));
  });
  afterEach(() => {
    avis.configure(undefined);
    vi.unstubAllGlobals();
  });

  const post = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
    handle(new Request("https://rundata.re/avis", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(fields).toString(),
    }), new Cache());

  it("is at the bottom of every page, without a script, with the page it is on", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const html = await (await handle(new Request("https://rundata.re/confidentialite", { headers: { accept: "text/html" } }), new Cache())).text();
    expect(html).toContain('<form class="card" method="post" action="/avis">');
    expect(html).toContain('<input type="hidden" name="page" value="/confidentialite">');
    expect(html).toContain('name="site_web"');
    expect(html).toMatch(/<h2 id="avis-donnees">Les avis que vous laissez<\/h2>[^]*12 mois/);
  });

  it("keeps the message and sends the browser back to its page with thanks", async () => {
    const r = await post({ message: "Il manque la station du Maïdo.", type: "manque", page: "/meteo/maido", site_web: "" }, { origin: "https://rundata.re", "user-agent": "Mozilla/5.0 Firefox/140.0" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("https://rundata.re/meteo/maido#avis-merci");
    const [, canal, type, outil, , message, , client, page] = rows[0];
    expect({ canal, type, outil, message, client, page }).toEqual({ canal: "site", type: "manque", outil: null, message: "Il manque la station du Maïdo.", client: null, page: "/meteo/maido" });
  });

  it("thanks the robots that fill the hidden field, and keeps nothing", async () => {
    const r = await post({ message: "Cheap pills here", page: "/", site_web: "http://spam.example" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("https://rundata.re/#avis-merci");
    expect(rows).toHaveLength(0);
  });

  it("answers a link or a robot opening it with 405, not with a failed feedback", async () => {
    for (const method of ["GET", "HEAD"]) {
      const r = await handle(new Request("https://rundata.re/avis", { method, headers: { accept: "text/html" } }), new Cache());
      expect(r.status).toBe(405);
      expect(r.headers.get("allow")).toBe("POST");
      expect(r.headers.get("location")).toBeNull();
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    expect(rows).toHaveLength(0);
  });

  it("refuses a message too long, empty, or posted from another site, and never redirects elsewhere", async () => {
    expect((await post({ message: "x".repeat(avis.MESSAGE_MAX + 1), page: "/bus" })).headers.get("location")).toBe("https://rundata.re/bus#avis-erreur");
    expect((await post({ message: " ", page: "/bus" })).headers.get("location")).toBe("https://rundata.re/bus#avis-erreur");
    expect((await post({ message: "bonjour", page: "//evil.example/x" })).headers.get("location")).toBe("https://rundata.re/#avis-merci");
    expect((await post({ message: "bonjour" }, { origin: "https://evil.example" })).status).toBe(403);
    expect(rows).toHaveLength(1);
  });
});
