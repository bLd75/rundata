import { describe, expect, it } from "vitest";
import { meteoPage, RELOAD_SCRIPT } from "../src/web/pages.js";

type Listener = (e: { persisted?: boolean }) => void;

// The script in a page whose measures are of `ages` (ISO), at `now`; what it does when the tab comes back.
function tab(ages: string[], now: number, opts: { storage?: Map<string, string>; noStorage?: boolean } = {}) {
  const on = new Map<string, Listener>();
  const doc = new Map<string, Listener>();
  let reloads = 0;
  const document = {
    visibilityState: "visible",
    querySelectorAll: (sel: string) => (sel === "[data-age]" ? ages.map((age) => ({ dataset: { age } })) : []),
    addEventListener: (t: string, f: Listener) => doc.set(t, f),
  };
  const storage = opts.storage ?? new Map<string, string>();
  const sessionStorage = {
    getItem: (k: string) => {
      if (opts.noStorage) throw new Error("SecurityError");
      return storage.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (opts.noStorage) throw new Error("SecurityError");
      storage.set(k, v);
    },
  };
  const location = { pathname: "/", reload: () => void reloads++ };
  const clock = { now };
  const DateLike = { now: () => clock.now, parse: Date.parse };
  new Function("document", "addEventListener", "sessionStorage", "location", "Date", RELOAD_SCRIPT)(
    document,
    (t: string, f: Listener) => on.set(t, f),
    sessionStorage,
    location,
    DateLike,
  );
  return {
    restored: () => on.get("pageshow")!({ persisted: true }),
    loaded: () => on.get("pageshow")!({ persisted: false }),
    shown: () => doc.get("visibilitychange")!({}),
    later: (ms: number) => void (clock.now += ms),
    reloads: () => reloads,
  };
}

const NOW = Date.parse("2026-10-25T22:37:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("a tab taken up again", () => {
  it("asks the page again when its newest measure is more than 15 min old, back from memory or shown again", () => {
    // The capture of 02:37: a page loaded at 23:3x, « mesuré il y a 3 h ».
    const t = tab([ago(180), ago(200)], NOW);
    t.restored();
    expect(t.reloads()).toBe(1);
    const u = tab([ago(180)], NOW);
    u.shown();
    expect(u.reloads()).toBe(1);
  });

  it("keeps a page whose newest measure is recent, or that has none, and a page just loaded", () => {
    const t = tab([ago(300), ago(12)], NOW);
    t.restored();
    t.shown();
    expect(t.reloads()).toBe(0);
    const none = tab([], NOW);
    none.shown();
    expect(none.reloads()).toBe(0);
    const fresh = tab([ago(180)], NOW);
    fresh.loaded();
    expect(fresh.reloads()).toBe(0);
  });

  it("asks again at most once per 15 min for a page, when a source that does not answer keeps the measures old", () => {
    const storage = new Map<string, string>();
    const t = tab([ago(180)], NOW, { storage });
    t.shown();
    // The page came again with the same old measure (the source still down): shown again 5 min later, kept.
    const again = tab([ago(185)], NOW + 5 * 60_000, { storage });
    again.shown();
    expect(t.reloads() + again.reloads()).toBe(1);
    again.later(11 * 60_000);
    again.shown();
    expect(again.reloads()).toBe(1);
  });

  it("still works where the browser refuses the session's storage", () => {
    const t = tab([ago(180)], NOW, { noStorage: true });
    t.shown();
    expect(t.reloads()).toBe(1);
  });

  it("is in every page", () => {
    expect(meteoPage("https://rundata.re", null, new Date(NOW))).toContain(RELOAD_SCRIPT);
  });
});
