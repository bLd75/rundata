import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { counted } from "../src/budget.js";
import { configure, download, session, share, tokensIssued, type Token, type TokenStore } from "../src/providers/mf-auth.js";
import { UpstreamError } from "../src/types.js";

// The Worker's KV as seen by one isolate, while other isolates write to it too.
class Kv implements TokenStore {
  token: Token | null = null;
  ttl?: number;
  reads = 0;
  writes = 0;
  fails = false;
  async get() {
    this.reads++;
    if (this.fails) throw new Error("KV down");
    return this.token;
  }
  async put(t: Token, ttl: number) {
    this.writes++;
    this.token = t;
    this.ttl = ttl;
  }
}

const HOUR = 3600_000;
let app = 0;
let kv: Kv;
let portal: string[];
let accepted: Set<string>;
let tried: string[];
let logs: string[];

// The portal hands out the tokens of `portal` in turn; the API takes only those of `accepted`.
beforeEach(() => {
  // A new application each time: this isolate holds no token yet (configure forgets it).
  configure({ applicationId: `app${++app}` });
  kv = new Kv();
  share(kv);
  portal = [];
  accepted = new Set();
  tried = [];
  logs = [];
  vi.stubGlobal("fetch", async (url: string) => {
    expect(url).toBe("https://portail-api.meteofrance.fr/token");
    return Response.json({ access_token: portal.shift(), expires_in: 3600 });
  });
  vi.spyOn(console, "log").mockImplementation((m: string) => void logs.push(m));
});

afterEach(() => {
  share(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const get = async (_source: string, _url: string, _ms: number, headers: Record<string, string>) => {
  const token = headers.Authorization.replace("Bearer ", "");
  tried.push(token);
  if (!accepted.has(token)) throw new UpstreamError("mf_radar", "HTTP 401", 401);
  return "image";
};
/** One question: its download, the subrequests it took and the tokens it asked the portal for. */
const ask = async () => {
  const before = tokensIssued();
  const { value, used } = await counted(Infinity, () => download("https://example.test/radar", session("mf_radar"), get));
  return { value, used, issued: tokensIssued() - before };
};

describe("one Météo-France token for every isolate, kept in KV", () => {
  it("takes KV's token at the first need, and keeps it in memory", async () => {
    kv.token = { value: "k", until: Date.now() + HOUR };
    accepted.add("k");
    expect(await ask()).toEqual({ value: "image", used: 1, issued: 0 });
    // The next question in this isolate: no read of KV.
    expect(await ask()).toEqual({ value: "image", used: 0, issued: 0 });
    expect(kv.reads).toBe(1);
    expect(kv.writes).toBe(0);
    expect(logs).toEqual([]);
  });

  it("takes a new token when KV holds none, writes it there and says so", async () => {
    portal.push("n");
    accepted.add("n");
    expect(await ask()).toEqual({ value: "image", used: 3, issued: 1 });
    expect(kv.token?.value).toBe("n");
    // Kept until 5 minutes before its hour is out.
    expect(kv.ttl).toBe(3300);
    expect(logs).toEqual(["jeton Météo-France pris (aucun jeton dans KV, mf_radar)"]);
  });

  it("reads KV again once its token is out of date, and takes a new one only when KV's is too", async () => {
    kv.token = { value: "old", until: Date.now() - 1000 };
    portal.push("n");
    accepted.add("n");
    expect((await ask()).issued).toBe(1);
    expect(logs).toEqual(["jeton Météo-France pris (jeton de KV échu, mf_radar)"]);
  });

  it("after a 401, tries the token another isolate wrote to KV before taking a new one", async () => {
    kv.token = { value: "a", until: Date.now() + HOUR };
    accepted.add("a");
    await ask();
    // Another isolate took a new token: ours is void.
    kv.token = { value: "b", until: Date.now() + HOUR };
    accepted.clear();
    accepted.add("b");
    expect(await ask()).toEqual({ value: "image", used: 1, issued: 0 });
    expect(tried).toEqual(["a", "a", "b"]);
    expect(logs).toEqual(["jeton Météo-France relu dans KV après un 401 (mf_radar)"]);
    // Kept in memory for the next question.
    expect(await ask()).toEqual({ value: "image", used: 0, issued: 0 });
  });

  it("after a 401 with KV's own token, takes a new one and writes it there", async () => {
    kv.token = { value: "a", until: Date.now() + HOUR };
    portal.push("n");
    accepted.add("n");
    expect(await ask()).toEqual({ value: "image", used: 4, issued: 1 });
    expect(tried).toEqual(["a", "n"]);
    expect(kv.token?.value).toBe("n");
    expect(logs).toEqual(["jeton Météo-France pris (après un 401, mf_radar)"]);
  });

  it("tries KV's newer token, then a new one, and stops there", async () => {
    kv.token = { value: "a", until: Date.now() + HOUR };
    accepted.add("a");
    await ask();
    kv.token = { value: "b", until: Date.now() + HOUR };
    accepted.clear();
    portal.push("n");
    await expect(counted(Infinity, () => download("https://example.test/radar", session("mf_radar"), get))).rejects.toThrow("HTTP 401");
    expect(tried).toEqual(["a", "a", "b", "n"]);
    expect(tokensIssued()).toBeGreaterThan(0);
    expect(logs).toEqual(["jeton Météo-France relu dans KV après un 401 (mf_radar)", "jeton Météo-France pris (après un 401, mf_radar)"]);
  });

  it("shares the token between the sources of one question, the new one after a 401 included", async () => {
    kv.token = { value: "a", until: Date.now() + HOUR };
    portal.push("n", "m");
    accepted.add("n");
    const before = tokensIssued();
    const { value } = await counted(Infinity, () =>
      Promise.all([download("https://example.test/radar", session("mf_radar"), get), download("https://example.test/obs", session("meteofrance"), get)]),
    );
    expect(value).toEqual(["image", "image"]);
    expect(tokensIssued() - before).toBe(1);
  });

  it("takes its own token when KV does not answer", async () => {
    kv.fails = true;
    portal.push("n");
    accepted.add("n");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await ask()).value).toBe("image");
    expect(logs).toEqual(["jeton Météo-France pris (aucun jeton dans KV, mf_radar)"]);
  });

  it("without KV, keeps one token per isolate as before", async () => {
    share(undefined);
    portal.push("n");
    accepted.add("n");
    expect(await ask()).toEqual({ value: "image", used: 1, issued: 1 });
    expect(logs).toEqual(["jeton Météo-France pris (sans KV, mf_radar)"]);
  });
});
