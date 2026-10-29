import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import * as enfants from "../src/vie/enfants.js";
import { buildDae } from "../src/web/data.js";
import { daePage } from "../src/web/domains.js";
import { enfantsCommunePage } from "../src/web/enfants.js";
import { FOLD_ROWS, folded, UNFOLD_SCRIPT } from "../src/web/pages.js";
import { pageOf } from "../src/web/places.js";

const O = "https://rundata.re";
const NOW = new Date("2026-10-29T08:00:00Z");
const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;

/** The page's script with a link to `hash`: whether the <details> it should open was opened. */
function follow(hash: string, target: { inside?: boolean; holds?: boolean } | null) {
  const d = { open: false };
  const el = target && {
    closest: (s: string) => (s === "details" && target.inside ? d : null),
    querySelector: (s: string) => (s === ":scope>details" && target.holds ? d : null),
  };
  let onHash = () => {};
  runInNewContext(UNFOLD_SCRIPT, {
    location: { hash },
    document: { getElementById: (id: string) => (id === hash.slice(1) ? el : null) },
    addEventListener: (_: string, f: () => void) => (onHash = f),
  });
  return { d, onHash };
}

describe("long lists folded by category, each opened with a tap", () => {
  it("folds a category over its rows, its line kept as it was, and leaves it as it was when not folding", () => {
    expect(folded(true, "<h3>Aires de jeux</h3>", "<ul></ul>")).toBe("<details><summary><h3>Aires de jeux</h3></summary><ul></ul></details>");
    expect(folded(false, "<h3>Aires de jeux</h3>", "<ul></ul>")).toBe("<h3>Aires de jeux</h3><ul></ul>");
  });

  it("opens the category of a row a link leads to, or the one in the card it leads to, at the load and on a new link", () => {
    expect(follow("#lieu-3", { inside: true }).d.open).toBe(true);
    expect(follow("#c-saint-pierre", { holds: true }).d.open).toBe(true);
    expect(follow("", null).d.open).toBe(false);
    const later = follow("#rien", null);
    expect(later.d.open).toBe(false);
    later.onHash();
  });

  it("folds each kind of a commune's places for children, « Aires de jeux · 11 », a short list left open", () => {
    const big = enfantsCommunePage(O, pageOf("saint-denis")!, null, NOW);
    const kinds = new Set(enfants.inCommune("Saint-Denis").map((l) => l.type)).size;
    expect(count(big, /<div class="card kind" data-k><details><summary><h3>/g)).toBe(kinds);
    const play = enfants.inCommune("Saint-Denis").filter((l) => l.type === "aire_de_jeux").length;
    expect(big).toContain(`<summary><h3>Aires de jeux <span class="note">·\u00a0${play}</span></h3></summary>`);
    // Every row still has its anchor, for the map's « Voir dans la liste ».
    expect(count(big, /<li id="lieu-\d+"/g)).toBe(enfants.inCommune("Saint-Denis").length);
    // A filter opens the kinds that keep a place.
    expect(big).toContain(`if(t)document.querySelectorAll("#ecl details").forEach((d)=>{d.open=!!d.querySelector("li[data-i]:not([hidden])")})`);

    for (const slug of ["les-avirons", "les-trois-bassins"]) {
      const c = pageOf(slug)!;
      expect(enfants.inCommune(c.nom).length).toBeLessThanOrEqual(FOLD_ROWS);
      expect(enfantsCommunePage(O, c, null, NOW)).not.toContain("<details><summary><h3>");
    }
    expect(enfantsCommunePage(O, pageOf("la-plaine-des-palmistes")!, null, NOW)).toContain("<details><summary><h3>");
  });

  it("folds each commune of /defibrillateurs, its line saying how many and how many at any hour", async () => {
    const d = await buildDae();
    const page = daePage(O, { value: d, fetchedAt: NOW, stale: false }, NOW);
    expect(count(page, /<li class="card tgt" id="c-[a-z-]+"><details><summary><h3>/g)).toBe(d.communes.length);
    const sp = d.communes.find((c) => c.commune === "Saint-Pierre")!;
    expect(page).toContain(`<summary><h3>Saint-Pierre <span class="note">·\u00a0${sp.nombre} défibrillateurs, dont ${sp.toute_heure} accessible${sp.toute_heure > 1 ? "s" : ""} à toute heure</span></h3></summary><ul class="rows eau dae">`);
  });
});
