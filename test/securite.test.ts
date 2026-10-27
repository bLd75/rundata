import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { failed, handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { CSP_RAPPORT, enTetes, PERMISSIONS, politique, rapport, scriptsEnLigne, SECURITY_EXPIRES } from "../src/web/securite.js";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("base64");

describe("the pages' security headers", () => {
  it("hash exactly the inline scripts that run: not one with src, nor a JSON-LD block", async () => {
    const html = `<head><script type="application/ld+json">{"a":"<b>"}</script><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script></head>
<body><script>const a="é";</script><SCRIPT type="text/javascript">b()</SCRIPT><script type="module">c()</script></body>`;
    expect(scriptsEnLigne(html)).toEqual([`const a="é";`, "b()", "c()"]);
    const h = await enTetes(html);
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["content-security-policy-report-only"]).toBeUndefined();
    expect(h["permissions-policy"]).toBe("camera=(), microphone=(), payment=(), usb=(), geolocation=(self)");
    for (const s of [`const a="é";`, "b()", "c()"]) expect(h["content-security-policy"]).toContain(`'sha256-${sha(s)}'`);
    expect(politique([])).toMatch(/frame-src https:\/\/challenges\.cloudflare\.com https:\/\/embed\.waze\.com; .*form-action 'self'; frame-ancestors 'none'; report-uri \/csp-rapport$/);
    // Cloudflare's Web Analytics beacon, part of the site's figures: allowed; it sends them to /cdn-cgi/rum, on this site.
    expect(politique([])).toMatch(/^default-src 'self'; script-src 'self' https:\/\/challenges\.cloudflare\.com https:\/\/static\.cloudflareinsights\.com; .*connect-src 'self';/);
  });

  it("are on a page of the site, every inline script of it allowed by its hash, and on the error page", async () => {
    const r = await handle(new Request("https://rundata.re/nulle-part", { headers: { accept: "text/html" } }), new Cache());
    expect(r.status).toBe(404);
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("permissions-policy")).toBe(PERMISSIONS);
    expect(r.headers.get("content-security-policy-report-only")).toBeNull();
    const policy = r.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("frame-ancestors 'none'");
    const scripts = scriptsEnLigne(await r.text());
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(policy).toContain(`'sha256-${sha(s)}'`);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = failed("/x", new Error("x")).headers;
    expect(failure.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(failure.get("permissions-policy")).toBe(PERMISSIONS);
    error.mockRestore();
  });
});

describe("the browsers' reports, POST /csp-rapport", () => {
  afterEach(() => vi.restoreAllMocks());
  const report = (r: Record<string, unknown>) =>
    new Request(`https://rundata.re${CSP_RAPPORT}`, { method: "POST", headers: { "content-type": "application/csp-report" }, body: JSON.stringify({ "csp-report": r }) });

  it("say each directive and blocked host once an hour per isolate, without the secret of a club's link", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = Date.parse("2026-10-26T16:00:00Z");
    const one = { "document-uri": "https://rundata.re/associations/proposition/AbCdEfGhIjKlMnOpQrStUv?fait=annuler", "effective-directive": "script-src-elem", "blocked-uri": "https://tiers.example/x.js?k=1", "source-file": "https://rundata.re/associations/proposition/AbCdEfGhIjKlMnOpQrStUv", "line-number": 3 };
    expect((await rapport(report(one), t)).status).toBe(204);
    expect((await rapport(report(one), t + 60_000)).status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toBe("csp : script-src-elem a bloqué tiers.example sur /associations/proposition/… (rundata.re, ligne 3)");
    expect(line).not.toContain("AbCdEf");
    await rapport(report({ ...one, "blocked-uri": "inline", "script-sample": "alert(1)" }), t + 120_000);
    await rapport(report(one), t + 3600_000);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(String(warn.mock.calls[1][0])).toContain("a bloqué inline sur /associations/proposition/… (rundata.re, ligne 3) « alert(1) »");
  });

  it("say « bloquerait » for a page still under the report-only policy, kept by a browser or a cache", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await rapport(report({ "document-uri": "https://rundata.re/", "effective-directive": "font-src", "blocked-uri": "https://polices.example/a.woff2", disposition: "report" }));
    expect(String(warn.mock.calls[0][0])).toBe("csp (observation) : font-src bloquerait polices.example sur /");
  });

  it("take nothing else: a GET, a body that is not a report, one too large", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await handle(new Request(`https://rundata.re${CSP_RAPPORT}`), new Cache())).status).toBe(405);
    expect((await handle(new Request(`https://rundata.re${CSP_RAPPORT}`, { method: "POST", body: "pas du json" }), new Cache())).status).toBe(204);
    expect((await rapport(new Request(`https://rundata.re${CSP_RAPPORT}`, { method: "POST", body: JSON.stringify({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "x".repeat(9000) } }) }))).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("whom to tell of a security flaw, /.well-known/security.txt (RFC 9116)", () => {
  it("says the contact, the languages and its own address, in plain text kept an hour", async () => {
    const r = await handle(new Request("https://rundata.re/.well-known/security.txt"), new Cache());
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await r.text()).toBe(
      `Contact: mailto:contact@rundata.re\nExpires: ${SECURITY_EXPIRES}\nPreferred-Languages: fr, en\nCanonical: https://rundata.re/.well-known/security.txt\n`,
    );
  });

  it("expires in less than a year, and this test fails 30 days before it does: move SECURITY_EXPIRES forward", () => {
    expect(SECURITY_EXPIRES).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const left = Date.parse(SECURITY_EXPIRES) - Date.now();
    const day = 86_400_000;
    expect(left).toBeGreaterThan(30 * day);
    expect(left).toBeLessThan(365 * day);
  });

  it("is where the older address at the root leads, for good", async () => {
    const r = await handle(new Request("https://rundata.re/security.txt"), new Cache());
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("/.well-known/security.txt");
    expect(r.headers.get("cache-control")).toBe("public, max-age=3600");
  });
});
