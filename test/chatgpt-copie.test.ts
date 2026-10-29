import { describe, expect, it } from "vitest";
import { connectSteps, homePage } from "../src/web/home.js";
import { COPIE_SCRIPT } from "../src/web/pages.js";

const O = "https://rundata.re";
const NOW = new Date("2026-10-29T15:40:00Z");

interface Line {
  textContent: string;
  hidden: boolean;
}

// One link of copies() in a page, its script run; `tap` clicks it, and the line after its paragraph tells.
function page(link: { href: string; dataset: Record<string, string> }, opts: { coarse: boolean; clipboard?: "ok" | "refus" | "absent" }) {
  const line: Line = { textContent: "", hidden: true };
  const copied: string[] = [];
  let click: () => void = () => {};
  const a = { ...link, parentElement: { nextElementSibling: line }, addEventListener: (_: string, f: () => void) => void (click = f) };
  const document = { querySelectorAll: (sel: string) => (sel === "a[data-copie]" ? [a] : []) };
  const navigator = opts.clipboard === "absent" ? {} : {
    clipboard: { writeText: (t: string) => (opts.clipboard === "refus" ? Promise.reject(new Error("NotAllowedError")) : (copied.push(t), Promise.resolve())) },
  };
  new Function("document", "navigator", "matchMedia", COPIE_SCRIPT)(document, navigator, () => ({ matches: opts.coarse }));
  return { tap: async () => { click(); await new Promise((r) => setTimeout(r, 0)); }, line, copied };
}

const OK = "Question copiée : collez-la dans ChatGPT si elle n'y est pas.";
const NON = "Si la question n'est pas dans ChatGPT, recopiez-la ci-dessous.";
const ask = (href: string) => ({ href, dataset: { copie: "", ok: OK, non: NON } });
const Q = "Que se passe-t-il en ce moment à La Réunion ? Lis https://rundata.re/?maj=19h40";

describe("the ChatGPT buttons on a phone", () => {
  it("copy the question as the link has it, ?maj= included, and say so", async () => {
    const p = page(ask(`https://chatgpt.com/?hints=search&q=${encodeURIComponent(Q)}`), { coarse: true, clipboard: "ok" });
    await p.tap();
    expect(p.copied).toEqual([Q]);
    expect(p.line).toEqual({ textContent: OK, hidden: false });
  });

  it("point to the question below when the browser refuses or has no clipboard", async () => {
    for (const clipboard of ["refus", "absent"] as const) {
      const p = page(ask(`https://chatgpt.com/?hints=search&q=${encodeURIComponent(Q)}`), { coarse: true, clipboard });
      await p.tap();
      expect(p.line).toEqual({ textContent: NON, hidden: false });
    }
  });

  it("do nothing more than the link on a computer", async () => {
    const p = page(ask(`https://chatgpt.com/?hints=search&q=${encodeURIComponent(Q)}`), { coarse: false, clipboard: "ok" });
    await p.tap();
    expect(p.copied).toEqual([]);
    expect(p.line.hidden).toBe(true);
  });

  it("copy their own text when they have one: the connector's address of /plugins", async () => {
    const p = page({ href: "https://chatgpt.com/plugins", dataset: { copie: `${O}/mcp`, ok: "ok", non: "non" } }, { coarse: true, clipboard: "ok" });
    await p.tap();
    expect(p.copied).toEqual([`${O}/mcp`]);
  });
});

describe("the links that copy, in the pages", () => {
  it("are ChatGPT's « Domann out IA » buttons, not Claude's, each followed by its line", () => {
    const html = homePage(O, null, NOW);
    const chatgpt = html.match(/<a href="https:\/\/chatgpt\.com\/\?hints=search[^>]*>/g)!;
    expect(chatgpt.length).toBeGreaterThanOrEqual(2);
    for (const a of chatgpt) expect(a).toContain(`data-copie="" data-ok="Question copiée : collez-la dans ChatGPT si elle n&#39;y est pas." data-non="Si la question n&#39;est pas dans ChatGPT, recopiez-la ci-dessous."`);
    for (const a of html.match(/<a href="https:\/\/claude\.ai\/new[^>]*>/g)!) expect(a).not.toContain("data-copie");
    expect(html).toMatch(/Claude <svg[^]*?<\/svg><\/a><\/p><p class="copie" role="status" lang="fr" hidden><\/p><p class="askq">/);
  });

  it("include /plugins, which copies the connector's address, the line right after its paragraph", () => {
    const steps = connectSteps(O);
    expect(steps).toContain(`<a href="https://chatgpt.com/plugins" data-copie="https://rundata.re/mcp" data-ok="Adresse du connecteur copiée : collez-la dans le champ URL du serveur." data-non="Copiez l&#39;adresse avec le bouton de l&#39;étape 1.">chatgpt.com/plugins</a>`);
    expect(steps).toMatch(/Ajouter un serveur MCP personnalisé<\/b>\.<\/p><p class="copie" role="status" lang="fr" hidden><\/p>/);
  });

  it("run their script in every page, after the one that adds ?maj=", () => {
    const html = homePage(O, null, NOW);
    expect(html.indexOf(COPIE_SCRIPT)).toBeGreaterThan(html.indexOf('document.querySelectorAll("a[data-maj]")'));
  });
});
