import { afterEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { cheminMasque } from "../src/chemin-secret.js";
import type { Hit } from "../src/metrics.js";
import { CONNEXION_PATH } from "../src/web/connecteurs.js";
import { PROPOSITION_PATH } from "../src/web/propositions.js";
import { lire } from "../src/web/signaux.js";
import worker from "../src/worker.js";

const SECRET = "Zq8sJ3kLw0vN5xYb2mR7tA";
const O = "https://rundata.re";
// One path of each kind that carries a secret, and how it is written down.
const SECRETS: [string, string][] = [
  [`${PROPOSITION_PATH}${SECRET}`, "/associations/proposition/*"],
  [`${CONNEXION_PATH}${SECRET}`, "/associations/connexion/*"],
  [`/associations/club/acces/${SECRET}`, "/associations/club/acces/*"],
  [`/associations/club/${SECRET}`, "/associations/club/*"],
];

describe("the paths that carry a club's secret", () => {
  it("are written without it, and every other path as it is", () => {
    for (const [path, masque] of SECRETS) expect(cheminMasque(path)).toBe(masque);
    for (const path of ["/", "/meteo", "/associations", "/associations/proposer", "/associations/proposition/", "/associations/club", "/associations/club/", "/associations/club/demande", "/associations/connexion/"]) {
      expect(cheminMasque(path)).toBe(path);
    }
  });
});

describe("the Worker's log lines", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never write the secret of a path: the response's time, its subrequests, an error", async () => {
    const lines: string[] = [];
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("")));
    for (const [path, masque] of SECRETS) {
      const after: Promise<unknown>[] = [];
      await worker.fetch(new Request(`${O}${path}`), {} as never, { waitUntil: (p) => void after.push(p) });
      await Promise.all(after);
      expect(lines.some((l) => l.includes(`(${masque})`)), path).toBe(true);
    }
    expect(lines.filter((l) => l.includes(SECRET))).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("Analytics Engine's points", () => {
  it("name the page without its secret", async () => {
    const hits: Hit[] = [];
    for (const [path] of SECRETS) await handle(new Request(`${O}${path}`, { headers: { accept: "text/html" } }), new Cache(new MemoryStore()), () => {}, (h) => hits.push(h));
    expect(JSON.stringify(hits)).not.toContain(SECRET);
    expect(hits.filter((h) => h.kind === "page").map((h) => h.name)).toEqual(expect.arrayContaining(["/associations/proposition/*"]));
  });
});

describe("the pages' signals", () => {
  it("are read without the secret of the page they come from", async () => {
    for (const [path, masque] of SECRETS) {
      expect(lire(`e=r&v=p&p=${encodeURIComponent(path)}`)).toEqual({ event: "retour", path: masque, value: "première" });
      const hits: Hit[] = [];
      const beacon = new Request(`${O}/signal`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin", origin: O }, body: `e=o&v=oui&p=${encodeURIComponent(path)}` });
      await handle(beacon, new Cache(new MemoryStore()), () => {}, (h) => hits.push(h));
      expect(hits.map((h) => h.name)).toEqual([masque]);
    }
  });
});
