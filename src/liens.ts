/**
 * The sites never linked to, from a page or a tool's answer, not even by their home page, until they agree: their
 * terms submit any link to their « autorisation expresse et préalable » (Saint-Benoît's legal notice, read on
 * 25/10/2026; interne/catalogue/sources.yaml). What is not taken from them is said by the factual mention of
 * tools/non-repris.ts, which names them without a link.
 */
const SANS_LIEN = ["saint-benoit.re"];

/** Whether `url` leads to a site of SANS_LIEN, whatever its page: never given as a link. Nothing else is. */
export function sansLien(url: string | undefined): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
  return SANS_LIEN.some((h) => host === h || host.endsWith(`.${h}`));
}
