import { afterEach, describe, expect, it, vi } from "vitest";
import { counted, PAGE_BUDGET } from "../src/budget.js";
import { getText, IN_FLIGHT, patiently } from "../src/http.js";

afterEach(() => vi.unstubAllGlobals());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The platform as it opens a Worker's connections: six at a time, the next ones queued until one is done, the fetch's
 * signal running all along. Each site answers in `ms`.
 */
function platform(ms: number) {
  let open = 0;
  let most = 0;
  const queue: (() => void)[] = [];
  const started: Record<string, number> = {};
  const t0 = Date.now();
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    const aborted = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");
    if (open >= 6) {
      await new Promise<void>((resolve, reject) => {
        queue.push(resolve);
        signal?.addEventListener("abort", () => reject(aborted()));
      });
    }
    open++;
    most = Math.max(most, open);
    started[new URL(url).hostname] = Date.now() - t0;
    try {
      await Promise.race([wait(ms), new Promise((_, reject) => signal?.addEventListener("abort", () => reject(aborted())))]);
      return new Response("ok");
    } finally {
      open--;
      queue.shift()?.();
    }
  });
  return { most: () => most, started };
}

describe("the fetches of an invocation", () => {
  const sites = Array.from({ length: 12 }, (_, i) => `https://agenda-${i}.example/`);

  it("wait for their place before their timeout starts: twelve slow sites, none cut while queued", async () => {
    // Each site answers in 60 ms, under its 100 ms timeout; twelve at once on six connections used to cut six of them.
    const p = platform(60);
    const { value } = await counted(PAGE_BUDGET, () =>
      Promise.all(sites.map((u) => getText("agenda", u, 100).then(() => "lu", (err: Error) => err.message))),
    );
    expect(value).toEqual(sites.map(() => "lu"));
    expect(p.most()).toBeLessThanOrEqual(IN_FLIGHT);
    // Read in turns, not all at the same instant.
    const starts = Object.values(p.started).sort((a, b) => a - b);
    expect(starts.at(-1)! - starts[0]).toBeGreaterThanOrEqual(100);
  });

  it("keep a place for the stores: at most IN_FLIGHT under the platform's six", () => {
    expect(IN_FLIGHT).toBeLessThan(6);
  });

  it("give their place back when a site fails or is too slow", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const host = new URL(url).hostname;
      if (host === "lent.example") {
        await new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timeout"))));
      }
      return new Response("", { status: host === "panne.example" ? 503 : 200 });
    });
    const { value } = await counted(PAGE_BUDGET, async () => {
      const bad = await Promise.allSettled([
        ...Array.from({ length: IN_FLIGHT }, () => getText("x", "https://panne.example/", 50)),
        ...Array.from({ length: IN_FLIGHT }, () => getText("x", "https://lent.example/", 20)),
      ]);
      // Every place given back: as many more fetches go through.
      const good = await Promise.all(Array.from({ length: IN_FLIGHT * 2 }, () => getText("x", "https://bon.example/", 50)));
      return { failed: bad.filter((r) => r.status === "rejected").length, read: good.length };
    });
    expect(value).toEqual({ failed: IN_FLIGHT * 2, read: IN_FLIGHT * 2 });
  });

  it("are given at least the patient delay inside `patiently`, their own delay elsewhere", async () => {
    // A site that answers in 150 ms, read with a 50 ms delay.
    platform(150);
    const read = () => getText("agenda", "https://lent.example/", 50).then(() => "lu", (err: Error) => err.message);
    const { value } = await counted(PAGE_BUDGET, async () => [await read(), await patiently(1_000, read)]);
    expect(value[0]).toMatch(/timeout/);
    expect(value[1]).toBe("lu");
  });

  it("do not wait outside a counted invocation (Node)", async () => {
    const p = platform(10);
    await Promise.all(sites.map((u) => getText("agenda", u, 1_000)));
    expect(p.most()).toBe(6);
  });
});
