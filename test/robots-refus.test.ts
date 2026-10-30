import { afterEach, describe, expect, it, vi } from "vitest";
import { interdit, INTERDITS, refusRobot, ROBOTS_NOMMES } from "../src/robots.js";
import worker from "../src/worker.js";
import { handle } from "../src/app.js";
import { Cache, MemoryStore } from "../src/cache.js";

// The User-Agents as these robots send them.
const UA: Record<string, string> = {
  "meta-externalagent": "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
  GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  ClaudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  Bytespider: "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
  CCBot: "CCBot/2.0 (https://commoncrawl.org/faq/)",
  Amazonbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36",
  PerplexityBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
};
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const TRIP = "https://rundata.re/bus/trajet/alterneo/84/0_5105";
const req = (url: string, ua: string) => new Request(url, { headers: { "user-agent": ua } });
const ctx = { waitUntil: () => {} };

describe("named robots on what robots.txt forbids them", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("are answered 403 by the Worker before anything is read: no fetch, no binding touched", async () => {
    expect(Object.keys(UA)).toEqual(ROBOTS_NOMMES);
    const fetch = vi.fn(async () => new Response(""));
    vi.stubGlobal("fetch", fetch);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // No binding at all: anything past the refusal would fail on it.
    const env = new Proxy({}, { get: (_, k) => { throw new Error(`binding ${String(k)} read`); } });
    for (const [nom, ua] of Object.entries(UA)) {
      const r = await worker.fetch(req(TRIP, ua), env as never, ctx);
      expect(r.status, nom).toBe(403);
      expect(await r.text()).toBe("Interdit par https://rundata.re/robots.txt\n");
      expect(log).toHaveBeenLastCalledWith(`robot refusé : ${nom} (/bus/trajet/alterneo/84/0_5105)`);
    }
    expect(fetch).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("are refused every address of robots.txt's list for every robot, and only those", () => {
    for (const p of INTERDITS) expect(refusRobot(req(`https://rundata.re${p}x`, UA.GPTBot))?.status).toBe(403);
    expect(interdit(new URL("https://rundata.re/bus/arret?q=gare"))).toBe(true);
    expect(interdit(new URL("https://rundata.re/bus/arret/gare-de-saint-pierre"))).toBe(false);
    expect(interdit(new URL("https://rundata.re/bus/trajet"))).toBe(false);
    expect(refusRobot(req("https://rundata.re/bus", UA["meta-externalagent"]))).toBeUndefined();
    expect(refusRobot(req("https://rundata.re/meteo/saint-denis", UA.ClaudeBot))).toBeUndefined();
  });

  it("leave a browser, a link preview and a search engine as they were", () => {
    for (const ua of [BROWSER, GOOGLEBOT, "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", ""]) {
      expect(refusRobot(req(TRIP, ua))).toBeUndefined();
      expect(refusRobot(req("https://rundata.re/", ua))).toBeUndefined();
    }
  });

  it("is the list robots.txt gives every robot, so that the two never part", async () => {
    const robots = await (await handle(new Request("https://rundata.re/robots.txt"), new Cache(new MemoryStore()))).text();
    const all = robots.split("\n\n").find((b) => b.startsWith("User-agent: *"))!;
    expect(all.split("\n").filter((l) => l.startsWith("Disallow: ")).map((l) => l.slice(10))).toEqual(INTERDITS);
    // The same file as before the list was shared.
    expect(robots).toBe(
      "User-agent: Googlebot\nUser-agent: GoogleOther\nUser-agent: Bingbot\nDisallow: /*?maj=\nDisallow: /bus/arret?q=\nDisallow: /bus/trajet/\nDisallow: /vigilance/bulletin-rendu\nAllow: /\n\n" +
        "User-agent: *\nDisallow: /bus/arret?q=\nDisallow: /bus/trajet/\nDisallow: /vigilance/bulletin-rendu\nAllow: /\n\nSitemap: https://rundata.re/sitemap.xml\n",
    );
  });
});
