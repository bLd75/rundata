import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import liste from "../src/dae/liste.json" with { type: "json" };
import { DAES } from "../src/providers/dae.js";
import { buildDae } from "../src/web/data.js";
import { AUTOUR_SCRIPT, daePage } from "../src/web/domains.js";

const ORIGIN = "https://rundata.re";
const NOW = new Date("2026-10-23T14:40:00Z");
const file = new URL(`../public${liste.path}`, import.meta.url);
// At sea off the west coast: no device has these figures in its coordinates, so any of them in a URL is the user's.
const ME = { latitude: -20.987654, longitude: 55.012345 };
const MINE = ["20.98", "55.01", "20,98", "55,01", "-20.9", "55.0123"];

interface Run {
  urls: string[];
  html: string;
  messages: string[];
  viewBox?: string;
}

/** The script on a page of stubs: what it fetches, writes and links, for a phone at ME (or refusing, or without). */
async function run(opts: { ua?: string; geo?: "ok" | "refus" | "aucune"; listOk?: boolean } = {}): Promise<Run> {
  const out: Run = { urls: [], html: "", messages: [] };
  const els: Record<string, Record<string, unknown>> = {};
  let click: (() => void) | undefined;
  for (const id of ["autour", "autour-btn", "autour-msg", "autour-res", "autour-list"]) {
    els[id] = { hidden: true, disabled: false, addEventListener: (_: string, f: () => void) => (click = f) };
  }
  Object.defineProperty(els["autour-msg"], "textContent", { set: (t: string) => t && out.messages.push(t) });
  Object.defineProperty(els["autour-list"], "innerHTML", { set: (h: string) => (out.html += h) });
  const svg = {
    setAttribute: (k: string, v: string) => k === "viewBox" && (out.viewBox = v),
    classList: { add: () => undefined },
    querySelector: () => null,
    insertAdjacentHTML: (_: string, h: string) => (out.html += h),
  };
  const body = readFileSync(file);
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));
  const geolocation = {
    getCurrentPosition: (ok: (p: unknown) => unknown, ko: (e: { code: number }) => void) => {
      if (opts.geo === "refus") return (ko({ code: 1 }), done());
      void Promise.resolve(ok({ coords: ME })).then(done);
    },
  };
  runInNewContext(AUTOUR_SCRIPT, {
    document: { getElementById: (id: string) => els[id], querySelector: (s: string) => (s === ".mapcard svg" ? svg : null) },
    navigator: { userAgent: opts.ua ?? "Mozilla/5.0 (Linux; Android 14)", platform: "Linux", maxTouchPoints: 5, ...(opts.geo === "aucune" ? {} : { geolocation }), sendBeacon: () => { throw new Error("sendBeacon"); } },
    fetch: async (u: string) => (out.urls.push(String(u)), opts.listOk === false ? { ok: false, status: 503 } : { ok: true, json: async () => JSON.parse(body.toString()) }),
  });
  expect(els.autour.hidden).toBe(false);
  click!();
  if (opts.geo === "aucune") done();
  await finished;
  out.urls.push(...[...out.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")));
  return out;
}

describe("« Autour de moi » on /defibrillateurs", () => {
  it("serves the compact list as a static file, with every device", () => {
    expect(liste.path).toMatch(/^\/dae\/dae\.[0-9a-f]{10}\.json$/);
    expect(existsSync(file)).toBe(true);
    const d = JSON.parse(readFileSync(file, "utf8"));
    expect(d.d.length).toBe(DAES.length);
    expect(readFileSync(new URL("../public/_headers", import.meta.url), "utf8")).toMatch(/\/dae\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/);
  });

  it("puts the button after the emergency call, and its script on the page", async () => {
    const page = daePage(ORIGIN, { value: await buildDae(), fetchedAt: NOW, stale: false } as never, NOW);
    expect(page.indexOf("appeler le 15")).toBeLessThan(page.indexOf(`id="autour-btn"`));
    expect(page).toContain(`<button type="button" class="btn sun" id="autour-btn">Autour de moi</button>`);
    expect(page).toContain("Votre position ne quitte pas votre appareil.");
    expect(page).toContain("<h3>Les 10 plus proches, à vol d'oiseau</h3>");
    expect(page).toContain(`<script>${AUTOUR_SCRIPT}</script>`);
  });

  it("never puts the user's position in a URL: one request, the list's, and routes to the device alone", async () => {
    for (const ua of ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "Mozilla/5.0 (Linux; Android 14)"]) {
      const r = await run({ ua });
      expect(r.urls.filter((u) => !u.startsWith("https://"))).toEqual([liste.path]);
      const routes = r.urls.filter((u) => u.startsWith("https://"));
      expect(routes).toHaveLength(10);
      for (const u of r.urls) for (const m of MINE) expect(u, u).not.toContain(m);
      for (const u of routes) expect(u).not.toMatch(/saddr|origin=|sll=|[?&]ll=/);
      if (ua.includes("iPhone")) for (const u of routes) expect(u).toMatch(/^https:\/\/maps\.apple\.com\/\?daddr=-?\d+\.\d+,\d+\.\d+&dirflg=w$/);
      else for (const u of routes) expect(u).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=-?\d+\.\d+,\d+\.\d+&travelmode=walking$/);
      // Each route leads to a device of the list.
      const [la, lo] = routes[0].match(/(-?\d+\.\d+),(\d+\.\d+)/)!.slice(1).map(Number);
      expect(DAES.some((d) => d.lat === la && d.lon === lo)).toBe(true);
    }
  });

  it("lists the 10 nearest with their distance alone, the access in the page's words, and a route each", async () => {
    const r = await run();
    expect(r.html.match(/<li>/g)).toHaveLength(10);
    expect(r.html).toMatch(/<small>\d+(,\d)? k?m · /);
    // The site's « Y aller » on foot (aller.ts): its sheet offers the other apps.
    expect(r.html).toMatch(/<a class="aller" href="[^"]+" rel="noopener" data-go="-?\d+\.\d+,\d+\.\d+"( data-a="[^"]+")? data-m="pied" aria-label="Y aller\u00a0: [^"]+">Y aller<\/a>/);
    expect(r.html).toMatch(/>(dehors, 24 h\/24|24 h\/24|horaires du lieu|accès réservé · demander à l&#39;accueil)</);
    expect(r.html).not.toContain("vol d'oiseau");
    expect(r.viewBox).toMatch(/^[-\d.]+ [-\d.]+ [\d.]+ [\d.]+$/);
  });

  it("says why when there is no position or no list", async () => {
    expect((await run({ geo: "refus" })).messages).toEqual(["Position non autorisée. Cherchez votre commune plus bas."]);
    expect((await run({ geo: "aucune" })).messages).toEqual(["Votre navigateur ne donne pas la position. Cherchez votre commune plus bas."]);
    expect((await run({ listOk: false })).messages).toEqual(["La liste n'a pas pu se charger. Réessayez, ou cherchez votre commune plus bas."]);
  });
});
