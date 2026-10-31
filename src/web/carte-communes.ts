/**
 * The names of the 24 communes on the map of /communes (the user, 31/10/2026: « il faut les noms ! »): every one, on a
 * phone as on a computer, each a link to its page. The placement of the other maps (map.ts namesLayer) keeps a name
 * only where it fits, six on a phone; here each has its place, set by hand on the map's units (1000 × 896): inside its
 * commune where it fits, else at sea off it, tied to its town by a line (the small communes of the west, the north and
 * the south). A long name goes on two lines; « Les Trois-Bassins » and « La Plaine-des-Palmistes » are shortened, their
 * full name said to screen readers and in the bubble.
 *
 * A finger on or near a name takes it (carte-points.ts: the nearest name within 22 px, a short list when several). A
 * commune hovered names itself: its name in the sun's colour, and its shape outlined when its name is hovered
 * (SURVOL_SCRIPT; CSS rules with :has() did the same, but slowed the page's first paint on a slow phone).
 */
import island from "../places/island.json" with { type: "json" };
import routes from "./routes.json" with { type: "json" };
import { esc } from "./map.js";

/** The names' size in the map's units: 12 px on a phone's map (343 px wide, its card's margin narrowed: `.mapcard.noms`), 15.8 px on a computer's (450 px). */
export const NAME_UNITS = 35;
/** About how wide a letter of a name is, in the map's units (600 weight): what the boxes below are measured with. */
const LETTER = 0.58 * NAME_UNITS;

/** Each commune's name: its middle, and its lines when not its name on one. `tie`: at sea, a line to its town. */
export const PLACES: Record<string, { x: number; y: number; lignes?: string[]; tie?: boolean }> = {
  "Saint-Denis": { x: 380, y: 150 },
  "Sainte-Marie": { x: 520, y: 50, tie: true },
  "Sainte-Suzanne": { x: 815, y: 62, tie: true },
  "Saint-André": { x: 690, y: 185 },
  "Bras-Panon": { x: 660, y: 300 },
  "Saint-Benoît": { x: 710, y: 413 },
  "Sainte-Rose": { x: 860, y: 560 },
  "Saint-Philippe": { x: 840, y: 740, lignes: ["Saint-", "Philippe"] },
  "Saint-Joseph": { x: 683, y: 760, lignes: ["Saint-", "Joseph"] },
  "Petite-Île": { x: 520, y: 858, tie: true },
  "Saint-Pierre": { x: 440, y: 765 },
  "Le Tampon": { x: 565, y: 640 },
  "La Plaine-des-Palmistes": { x: 680, y: 489, lignes: ["Plaine-des-", "Palmistes"] },
  Salazie: { x: 462, y: 340 },
  Cilaos: { x: 403, y: 467 },
  "Entre-Deux": { x: 463, y: 540, lignes: ["Entre-", "Deux"] },
  "Saint-Louis": { x: 334, y: 618, lignes: ["Saint-", "Louis"] },
  "L'Étang-Salé": { x: 190, y: 745, tie: true },
  "Les Avirons": { x: 134, y: 690, tie: true },
  "Saint-Leu": { x: 205, y: 520 },
  "Les Trois-Bassins": { x: 206, y: 425, lignes: ["Trois-Bassins"] },
  "Saint-Paul": { x: 190, y: 300 },
  "La Possession": { x: 158, y: 55, tie: true },
  "Le Port": { x: 90, y: 128, tie: true },
};

/** The communes in the order of the map's shapes, as map.ts draws their links (zoneLinks): SURVOL_SCRIPT pairs them by rank. */
const ORDER: string[] = island.paths.map((p) => p.nom);
const TOWNS = new Map((routes.noms as [string, number, number, number][]).filter((n) => n[1] === 0).map((n) => [n[0], [n[2], n[3]] as [number, number]]));

/** A name's box in the map's units, its lines measured with LETTER. */
export function nameBox(nom: string): [number, number, number, number] {
  const p = PLACES[nom];
  const lines = p.lignes ?? [nom];
  const half = (Math.max(...lines.map((l) => l.length)) * LETTER) / 2;
  const h = (lines.length * NAME_UNITS * 1.05) / 2;
  return [p.x - half, p.y - h, p.x + half, p.y + h];
}

/** The point of the box nearest `t`: where a name's line leaves it towards its town. */
const nearest = (b: [number, number, number, number], t: [number, number]): [number, number] => [Math.min(Math.max(t[0], b[0]), b[2]), Math.min(Math.max(t[1], b[1]), b[3])];

/** The layer of names, over the communes' links: `href` gives each commune's page. */
export function communeNames(href: (nom: string) => string): string {
  const ties: string[] = [];
  const names = ORDER.map((nom) => {
    const p = PLACES[nom];
    const lines = p.lignes ?? [nom];
    const b = nameBox(nom);
    if (p.tie) {
      const t = TOWNS.get(nom)!;
      const [x, y] = nearest(b, t);
      ties.push(`<path d="M${Math.round(x)} ${Math.round(y)}L${t[0]} ${t[1]}"/><circle cx="${t[0]}" cy="${t[1]}" r="7"/>`);
    }
    const first = p.y - ((lines.length - 1) * NAME_UNITS * 1.05) / 2;
    const text = lines.map((l, i) => `<tspan x="${p.x}" y="${Math.round(first + i * NAME_UNITS * 1.05)}">${esc(l)}</tspan>`).join("");
    // The box, invisible, takes the finger and the mouse between the letters; carte-points.ts reads its middle.
    return `<a class="sp" href="${esc(href(nom))}" aria-label="${esc(nom)}, voir sa page" data-pn="${esc(nom)}">` +
      `<rect class="hit" x="${Math.round(b[0])}" y="${Math.round(b[1])}" width="${Math.round(b[2] - b[0])}" height="${Math.round(b[3] - b[1])}"/><text>${text}</text></a>`;
  });
  return `<g class="cn" font-size="${NAME_UNITS}"><g class="tie" aria-hidden="true">${ties.join("")}</g>${names.join("")}</g>`;
}

/** A commune hovered lights its name (`.on`), and a name hovered its commune: the two lists in the same order (ORDER). */
export const SURVOL_SCRIPT = `(()=>{const c=document.querySelector("svg.map .cn");if(!c)return;const z=[...c.closest("svg").querySelectorAll(".zn")],n=[...c.querySelectorAll("a")],` +
  `on=(i,v)=>{z[i]?.classList.toggle("on",v);n[i]?.classList.toggle("on",v)};[z,n].forEach((l)=>l.forEach((a,i)=>{a.addEventListener("pointerenter",()=>on(i,true));a.addEventListener("pointerleave",()=>on(i,false))}))})();`;
