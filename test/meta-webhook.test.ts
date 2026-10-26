import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { configure, memes, resume } from "../src/meta-webhook.js";

const URL_ = "https://rundata.re/meta/webhook";
const VERIFY = "jeton-de-verification-de-test";
const SECRET = "secret-d-application-de-test";
const signed = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
const post = (body: string, signature?: string) =>
  handle(new Request(URL_, { method: "POST", headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) }, body }), new Cache());

// A comment on the Page, as Meta sends it: the words and the name are there, they must not reach the log.
const COMMENT = JSON.stringify({
  object: "page",
  entry: [{ id: "1234567890", time: 1793050000, changes: [{ field: "feed", value: { item: "comment", verb: "add", message: "Bonjour, la route est coupée ?", from: { id: "42", name: "Une Personne" } } }] }],
});

describe("/meta/webhook, what Meta tells of the Page and the Instagram account", () => {
  afterEach(() => {
    configure();
    vi.restoreAllMocks();
  });

  it("does not exist while its two secrets are not set", async () => {
    expect((await handle(new Request(`${URL_}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`), new Cache())).status).toBe(404);
    configure(VERIFY);
    expect((await post(COMMENT, signed(COMMENT))).status).toBe(404);
  });

  it("gives Meta's challenge back only with our verify token, and only a challenge", async () => {
    configure(VERIFY, SECRET);
    const check = (q: string) => handle(new Request(`${URL_}?${q}`), new Cache());
    const ok = await check(`hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1158201444");
    expect(ok.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect((await check("hub.mode=subscribe&hub.verify_token=autre&hub.challenge=1158201444")).status).toBe(403);
    expect((await check(`hub.mode=unsubscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444`)).status).toBe(403);
    expect((await check(`hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=%3Cscript%3E`)).status).toBe(403);
  });

  it("keeps a signed event as one log line, without its words nor who wrote them", async () => {
    configure(VERIFY, SECRET);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await post(COMMENT, signed(COMMENT));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("EVENT_RECEIVED");
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(line).toBe(`meta webhook : ${JSON.stringify({ objet: "page", entrees: [{ id: "1234567890", time: 1793050000, champs: ["feed comment add"] }] })}`);
    expect(line).not.toMatch(/Bonjour|Personne|"42"/);
  });

  it("refuses an event not signed with the app's secret, or too large, and any other method", async () => {
    configure(VERIFY, SECRET);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await post(COMMENT)).status).toBe(403);
    expect((await post(COMMENT, signed(COMMENT, "autre-secret"))).status).toBe(403);
    expect((await post(`${COMMENT} `, signed(COMMENT))).status).toBe(403);
    expect((await post("x".repeat(300 * 1024), signed("x".repeat(300 * 1024)))).status).toBe(413);
    expect(log).not.toHaveBeenCalled();
    expect((await handle(new Request(URL_, { method: "PUT" }), new Cache())).status).toBe(405);
  });

  it("answers 200 to a signed event it cannot read, so that Meta does not send it again", async () => {
    configure(VERIFY, SECRET);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await post("pas du json", signed("pas du json"))).status).toBe(200);
    expect(log).toHaveBeenCalledWith("meta webhook : événement illisible");
    expect(resume({ object: "instagram", entry: [{ id: "17841", time: 1, messaging: [{}, {}] }] })).toEqual({ objet: "instagram", entrees: [{ id: "17841", time: 1, champs: [], messages: 2 }] });
  });

  it("compares secrets whatever their lengths", () => {
    expect(memes("abc", "abc")).toBe(true);
    expect(memes("abc", "abd")).toBe(false);
    expect(memes("abc", "abcd")).toBe(false);
    expect(memes("", "")).toBe(true);
  });
});
