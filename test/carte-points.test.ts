import { describe, expect, it } from "vitest";
import * as enfants from "../src/vie/enfants.js";
import { LIST_MAX, POINTS_CSS, POINTS_SCRIPT, TAP_PX } from "../src/web/carte-points.js";
import { enfantsCommunePage, enfantsPage } from "../src/web/enfants.js";
import { esc } from "../src/web/map.js";
import { CSS } from "../src/web/pages.js";
import { pageOf } from "../src/web/places.js";

const O = "https://rundata.re";
const NOW = new Date("2026-10-24T06:00:00Z");

describe("the points of the maps, with a mouse and with a finger", () => {
  const commune = enfantsCommunePage(O, pageOf("saint-denis")!, null, NOW);
  const dots = [...commune.matchAll(/<a class="sp" href="#lieu-(\d+)"[^>]*>/g)];

  it("names each place of a commune's map for the bubble: its name, its kind, its address", () => {
    // The page's order: kind by kind.
    const list = enfants.TYPES.flatMap((t) => enfants.inCommune("Saint-Denis").filter((l) => l.type === t.type));
    expect(dots).toHaveLength(list.length);
    const at = (l: enfants.Lieu) => dots.find(([, i]) => list[+i] === l)![0];
    const full = list.find((l) => enfants.named(l) && l.adresse)!;
    expect(at(full)).toContain(` data-pn="${esc(full.nom)}" data-p2="${esc(enfants.typeOf(full.type).un.replace(/^./, (c) => c.toUpperCase()))}" data-p3="${esc(full.adresse!)}"`);
    // An unnamed place has its kind in its name already: not said twice.
    const unnamed = list.find((l) => !enfants.named(l))!;
    expect(at(unnamed)).not.toContain(" data-p2=");
  });

  it("names each marker of the island's map by its place and its value, as said aloud", () => {
    const island = enfantsPage(O, null, NOW);
    const marks = [...island.matchAll(/<a class="mk" href="[^"]+" aria-label="([^"]+)" data-pn="([^"]+)" data-p2="([^"]+)">/g)];
    expect(marks.length).toBeGreaterThan(20);
    for (const [, said, name, value] of marks) expect(said).toBe(`${name} : ${value}, voir le détail`);
  });

  it("runs on every page, once, with its style", () => {
    expect(commune.split(POINTS_SCRIPT)).toHaveLength(2);
    expect(enfantsPage(O, null, NOW)).toContain(POINTS_SCRIPT);
    expect(CSS).toContain(POINTS_CSS);
    expect(() => new Function(POINTS_SCRIPT)).not.toThrow();
  });

  it("takes the nearest point within a finger's reach, where the finger was, never a point out of the frame", () => {
    expect(TAP_PX).toBe(22);
    expect(POINTS_SCRIPT).toContain(`const R=${TAP_PX},LIST=${LIST_MAX},`);
    // The pointer's position: the click's is moved by the browsers onto the link they guess.
    expect(POINTS_SCRIPT).toContain(`s.addEventListener("pointerup",(e)=>{if(down)up=[e.clientX,e.clientY]},true)`);
    expect(POINTS_SCRIPT).toContain("c[0]>=b.left&&c[0]<=b.right&&c[1]>=b.top&&c[1]<=b.bottom");
    // A drag or a pinch is not a tap.
    expect(POINTS_SCRIPT).toContain("if(Math.hypot(u[0]-d[0],u[1]-d[1])>10)return;");
  });

  it("zooms a commune's map on too many points under a finger, and lists them otherwise", () => {
    expect(LIST_MAX).toBe(5);
    expect(POINTS_SCRIPT).toContain(`else if(near.length<=LIST||s.dispatchEvent(new CustomEvent("pzoom",{cancelable:true,`);
    // The map says it zoomed by cancelling the event; at its closest it does not, and the list shows.
    expect(commune).toContain(`svg.addEventListener("pzoom",(e)=>{const w=v[2],c=pt(e.detail.x,e.detail.y);zoom(2.5,c[0],c[1]);if(v[2]<w)e.preventDefault()});`);
  });

  it("keeps the bubble of /meteo and of the home page, and gives their markers the tap with a finger's pointer", () => {
    expect(POINTS_SCRIPT).toContain(`const own=!!(s.closest("figure")||s.parentElement).querySelector("[data-mtip]");`);
    expect(POINTS_SCRIPT).toContain(`if(a.matches("[data-tp]"))a.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerType:"touch"}))`);
  });
});
