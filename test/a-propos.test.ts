import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import type { Hit } from "../src/metrics.js";
import { aProposPage, llmsTxt, QUI } from "../src/web/a-propos.js";
import { homePage } from "../src/web/home.js";
import { DESCRIPTION_MAX } from "../src/web/pages.js";

const BROWSER = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const get = (path: string, accept?: string, method = "GET") =>
  new Request(`https://rundata.re${path}`, { method, headers: accept === undefined ? {} : { accept } });

describe("who makes rundata.re, the connector's page, the legal notice, the 404 and /llms.txt", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline"); // nothing of these pages is read from a source
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("tells on the home page's ChatGPT tab to name rundata.re in the question, the @ menu as the other way", async () => {
    const page = await (await handle(get("/", BROWSER), new Cache())).text();
    expect(page).toContain("Ensuite, dans une conversation (appli comprise), nommez rundata.re dans la question, par exemple <b>«\u00a0Avec rundata.re\u00a0: il fait combien à Cilaos en ce moment\u00a0?\u00a0»</b>, ou tapez <b>@</b> et choisissez rundata.re. Sinon, ChatGPT peut répondre avec sa propre météo, sans station ni heure de mesure. Testé avec l'offre ChatGPT Go.");
  });

  it("shows a browser at /mcp how to add the connector, and keeps the endpoint for the MCP clients", async () => {
    const hits: Hit[] = [];
    const r = await handle(get("/mcp", BROWSER), new Cache(), () => {}, (h) => hits.push(h));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("vary")).toBe("accept");
    const page = await r.text();
    expect(page).toContain("<h1>Ajouter rundata.re à votre assistant IA</h1>");
    expect(page).toContain('<code id="mcp-url">https://rundata.re/mcp</code>');
    for (const a of ["<h3>Claude</h3>", "<h3>ChatGPT</h3>", "<h3>Le Chat</h3>", 'datetime="2026-10-25"', 'href="/confidentialite"', 'href="/conditions"']) expect(page).toContain(a);
    expect(page.match(/<meta name="description" content="([^"]*)"/)![1].length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    // ChatGPT answers with its own weather unless rundata.re is named: the card says to name it, no-break spaces as sent.
    expect(page).toContain("<b>Plugins → Ajouter → Ajouter un serveur MCP personnalisé</b>.</p>");
    expect(page).toContain("<p><b>Ensuite\u00a0:</b> nommez rundata.re dans la question («\u00a0Avec rundata.re\u00a0: …\u00a0») ou tapez <b>@</b> et choisissez-le.</p></div>");
    expect(hits).toMatchObject([{ kind: "page", name: "/mcp", status: 200 }]);
    // HEAD from a link preview: the page too.
    expect((await handle(get("/mcp", BROWSER, "HEAD"), new Cache())).status).toBe(200);
    // The clients: the stream they ask for with GET is still refused, as before, whatever else they accept.
    for (const accept of ["text/event-stream", "application/json, text/event-stream", "text/html, text/event-stream", "application/json", ""]) {
      const refused = await handle(get("/mcp", accept), new Cache());
      expect(refused.status, accept).toBe(405);
      expect(refused.headers.get("allow")).toBe("POST, OPTIONS");
      expect(await refused.json()).toEqual({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
    }
    expect((await handle(get("/mcp", BROWSER, "DELETE"), new Cache())).status).toBe(405);
    // POST with a browser's Accept is still a message to the endpoint.
    const post = await handle(new Request("https://rundata.re/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) }), new Cache());
    expect(post.status).toBe(200);
    expect((await post.json()).result.tools.length).toBeGreaterThan(20);
  });

  it("says who makes the site, with its commitments, never a person's name, linked from the footer", async () => {
    const r = await handle(get("/a-propos", BROWSER), new Cache());
    expect(r.status).toBe(200);
    const page = await r.text();
    expect(page).toContain("<h1>Qui fait rundata.re\u00a0?</h1>");
    for (const id of ["pourquoi", "financement", "engagements", "contact"]) expect(page).toContain(`id="${id}"`);
    for (const s of ["projet personnel et bénévole", "habitant de l'île, développeur", "Cloudflare", "Il est gratuit, n'affiche aucune publicité et ne vend aucune donnée.", "Pour les associations à but non lucratif, il est gratuit à vie.", "contact@rundata.re", 'href="/conditions#mentions-legales"', 'href="/presse"', '"@type":"AboutPage"']) expect(page).toContain(s);
    for (const s of ["aucun revenu", "offres gratuites", "restera gratuit"]) expect(page).not.toContain(s);
    const main = aProposPage("https://rundata.re").split("<footer")[0];
    // No personal account: GitHub only as the project's own repository, in the bar and in the contributions sentence.
    expect(main).not.toMatch(/bLd75/i);
    expect(main.match(/github\.com\/[^"]*/gi)?.every((u) => u.startsWith("github.com/rundata-re/rundata"))).toBe(true);
    // About 300 words: the title, its sentence and the four sections, the contributions sentence among them (27/10).
    const text = (from: string, to: string) => main.slice(main.indexOf(from), main.indexOf(to, main.indexOf(from)));
    const words = (text("<h1>", "</div></div>") + text("<section style=", "</section>")).replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThan(200);
    expect(words).toBeLessThan(360);
    expect(page).toContain('<a href="/a-propos">qui fait rundata.re\u00a0?</a>');
  });

  it("sends /mentions-legales to the notice in /conditions, written as the LCEN allows an anonymous editor", async () => {
    for (const path of ["/mentions-legales", "/mentions-legales/"]) {
      const r = await handle(get(path, BROWSER), new Cache());
      expect(r.status).toBe(301);
      expect(r.headers.get("location")).toBe("/conditions#mentions-legales");
    }
    const page = await (await handle(get("/conditions", BROWSER), new Cache())).text();
    expect(page).toContain('<h2 id="mentions-legales">Mentions légales</h2>');
    expect(page).toContain("l'article 1-1, II de la loi n° 2004-575 du 21 juin 2004");
    expect(page).toContain("Ses éléments d'identification ont été communiqués à l'hébergeur.");
    expect(page).toContain("enregistré auprès de l'AFNIC (.re)");
  });

  it("sends /about to /a-propos", async () => {
    for (const path of ["/about", "/about/"]) {
      const r = await handle(get(path, BROWSER), new Cache());
      expect(r.status).toBe(301);
      expect(r.headers.get("location")).toBe("/a-propos");
    }
  });

  it("answers an unknown address with the site's page, still a 404, unless the client asks for something else", async () => {
    for (const accept of [BROWSER, "*/*", undefined]) {
      const r = await handle(get("/qui-sommes-nous", accept), new Cache());
      expect(r.status).toBe(404);
      expect(r.headers.get("content-type")).toContain("text/html");
      const page = await r.text();
      for (const a of ['href="/"', 'href="/evenements"', 'href="/randonnees"', 'href="/communes"', 'href="/a-propos"']) expect(page).toContain(a);
    }
    const json = await handle(get("/qui-sommes-nous", "application/json"), new Cache());
    expect(json.status).toBe(404);
    expect(await json.text()).toBe("Not found");
  });

  it("has a short /llms.txt, the sitemap's new pages and the home page's Organization", async () => {
    const r = await handle(get("/llms.txt"), new Cache());
    expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const txt = await r.text();
    expect(txt).toBe(llmsTxt("https://rundata.re"));
    expect(txt.trim().split("\n").filter(Boolean).length).toBeLessThanOrEqual(15);
    for (const s of ["# rundata.re", "https://rundata.re/mcp", "https://rundata.re/a-propos", "projet personnel et bénévole"]) expect(txt).toContain(s);
    const map = await (await handle(get("/sitemap.xml"), new Cache())).text();
    for (const u of ["/a-propos", "/mcp"]) expect(map).toContain(`<loc>https://rundata.re${u}</loc>`);
    expect(map).not.toContain("mentions-legales");
    const ld = JSON.parse(homePage("https://rundata.re", null).match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
    const org = ld.find((x: { "@type": string }) => x["@type"] === "Organization");
    expect(org).toMatchObject({
      description: QUI,
      foundingDate: "2026-10",
      areaServed: { "@type": "AdministrativeArea", name: "La Réunion" },
      publishingPrinciples: "https://rundata.re/a-propos#engagements",
      contactPoint: { "@type": "ContactPoint", email: "contact@rundata.re", contactType: "presse" },
    });
    expect(ld.find((x: { "@type": string }) => x["@type"] === "SoftwareApplication").url).toBe("https://rundata.re/mcp");
  });
});
