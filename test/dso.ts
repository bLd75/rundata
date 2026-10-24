/**
 * The prefecture's plan (dispositif ORSEC Cyclones, arrêté 2026-182), its pages copied from the PDF tables included
 * (fixtures/cyclones/dso-2026-182.txt): every quotation on /alerte-cyclone, /ecoles-cyclone and in the tools must be
 * found, word for word, on the page(s) given next to it. Case, accents and punctuation aside: the tables set the text
 * out in cells and lines, and the headings in capitals without accents (« JE ME TIENS INFORME DES CONSIGNES »).
 */
import { readFileSync } from "node:fs";

export const DSO = new Map(
  readFileSync(new URL("./fixtures/cyclones/dso-2026-182.txt", import.meta.url), "utf8")
    .split(/^=== p\. /m)
    .slice(1)
    .map((block) => [Number(block.slice(0, block.indexOf("\n"))), block.slice(block.indexOf("\n") + 1)] as const),
);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’]/g, "'").replace(/[,.;:]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
export const onPages = (quote: string, pages: number[]) => norm(pages.map((p) => DSO.get(p) ?? "").join(" ")).includes(norm(quote));
export const quotes = (s: string) => [...s.matchAll(/« ([^«»]+) »/g)].map((m) => m[1]);

/**
 * The quotations of a sentence that gives its pages as « (p. N) » or « (p. N-M) », each closing the quotations written
 * since the previous one, with the pages they must be on; the sentence must quote at least once.
 */
export function cited(line: string): { quote: string; pages: number[] }[] {
  const out: { quote: string; pages: number[] }[] = [];
  for (const [, text, from, to] of line.matchAll(/(.*?)\(p\. (\d+)(?:-(\d+))?\)/g)) {
    const pages = Array.from({ length: Number(to ?? from) - Number(from) + 1 }, (_, i) => Number(from) + i);
    for (const quote of quotes(text)) out.push({ quote, pages });
  }
  return out;
}
