// The links of the island's maps on a page (src/web/map.ts), for the tests of each page that has one.

/** Each marker or commune of the page's maps that leads somewhere. */
export const mapLinks = (page: string) =>
  [...(page.match(/<svg class="map[^]*?<\/svg>/g) ?? []).join("").matchAll(/<a class="(mk|zn)" href="([^"]+)" aria-label="([^"]+)"/g)]
    .map(([, kind, href, label]) => ({ kind, href, label }));

/** The maps' links within the page whose anchor is missing: a tap there would lead nowhere. */
export function deadAnchors(page: string): string[] {
  const ids = new Set([...page.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  return mapLinks(page).filter((l) => l.href.startsWith("#") && !ids.has(l.href.slice(1))).map((l) => l.href);
}

/** The ids given twice: a link would only ever reach the first. */
export function doubleIds(page: string): string[] {
  const seen = new Set<string>();
  return [...page.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]).filter((id) => seen.has(id) || !seen.add(id));
}
