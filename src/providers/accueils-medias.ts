/**
 * Media whose links go to their home page, as their terms ask: Freedom's allow a link to its home page only, « dans une
 * nouvelle fenêtre ». The news (src/providers/actualites.ts) links there; a page opens it in a new window (web/map.ts).
 */
export const ACCUEIL: Record<string, string> = { Freedom: "https://www.freedom.fr/" };
export const ACCUEILS = new Set(Object.values(ACCUEIL));
