import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import * as enfants from "../src/vie/enfants.js";
import { buildDae } from "../src/web/data.js";
import { NOUVEAUTES, parJour } from "../src/nouveautes.js";
import * as col from "../src/vie/collecte.js";
import { collectePage } from "../src/web/collecte.js";
import type { AgendaAnswer, SentiersAnswer, SportAnswer } from "../src/web/data.js";
import { agendaPage, daePage, sentiersPage, sportPage } from "../src/web/domains.js";
import { enfantsCommunePage } from "../src/web/enfants.js";
import { nouveautesPage } from "../src/web/nouveautes.js";
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
    expect(big).toContain(`<summary><h3>Aires de jeux\u00a0<span class="note">·\u00a0${play}</span></h3></summary>`);
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
    expect(page).toContain(`<summary><h3>Saint-Pierre\u00a0<span class="note">·\u00a0${sp.nombre}\u00a0défibrillateurs, dont ${sp.toute_heure}\u00a0accessible${sp.toute_heure > 1 ? "s" : ""} à toute heure</span></h3></summary><ul class="rows eau dae">`);
  });
});

describe("long lists folded, the second pages", () => {
  const cached = <T>(value: T) => ({ value, fetchedAt: NOW, stale: false });

  it("folds each commune of /sentiers, its line saying how many are closed, a short list left open", () => {
    const trails = (n: number, k: string) => [...Array(n)].map((_, i) => ({ sentier: `Sentier ${k}${i}`, cause: "éboulement" }));
    const answer = (n: number) => ({
      resume: "", routes_forestieres_fermees: [], a_savoir: [], sources: [], suivis: 351, randonnees: [], points: [],
      fermes_par_commune: [{ commune: "Cilaos", sentiers_fermes: trails(n, "A") }, { commune: "Salazie", sentiers_fermes: trails(n, "B") }],
    }) as unknown as SentiersAnswer;
    const page = sentiersPage(O, cached(answer(5)), NOW);
    expect(page).toContain(`<li class="card"><details><summary><h3>Cilaos\u00a0<span class="note">·\u00a05\u00a0fermés</span></h3></summary><ul class="rows eau">`);
    // The map's cross leads to the trail's row, inside its commune: the common script opens it.
    expect(page).toMatch(/<details><summary><h3>Cilaos[^]*?<li class="tgt" id="t-sentier-a0">/);
    expect(sentiersPage(O, cached(answer(4)), NOW)).not.toContain("<details><summary><h3>");
  });

  it("folds the results and the standings of /sport, what is to come left open, a championship's page inside it", () => {
    const row = (sport: string, i: number) => ({ sport, epreuve: `Match ${i}`, quand: "samedi 24/10 à 18:00", competition: "D1", score: "25-20" });
    const rows = [...Array(6)].map((_, i) => row("handball", i)).concat([...Array(5)].map((_, i) => row("volley-ball", i)));
    const table = (competition: string) => ({ competition, lien: `https://example.org/${competition.length}`, lignes: [...Array(6)].map((_, i) => ({ place: i + 1, equipe: `Club ${i}`, joues: 5, points: 10 - i })) });
    const answer = { resume: "", non_couvert: "", sources: [], a_venir: rows, resultats: rows, classements: [table("Handball, D1 masculine"), table("Volley-ball, R1")] } as unknown as SportAnswer;
    const page = sportPage(O, cached(answer), NOW);
    const venir = page.slice(page.indexOf('id="h-venir"'), page.indexOf('id="h-res"'));
    expect(venir).not.toContain("<details><summary>");
    expect(venir).toContain(`<h3>Handball <span class="note">6\u00a0rendez-vous</span></h3>`);
    expect(page).toContain(`<li class="card"><details><summary><h3>Handball\u00a0<span class="note">·\u00a06\u00a0résultats</span></h3></summary>`);
    expect(page).toContain(`<details><summary><h3>Handball, D1 masculine\u00a0<span class="note">·\u00a06\u00a0équipes</span></h3></summary><p class="note"><a href="https://example.org/22" rel="noopener">Le classement sur le site de la fédération ↗</a></p>`);
    // One championship: as it was, its name the link.
    const one = sportPage(O, cached({ ...answer, classements: [table("Handball, D1 masculine")] }), NOW);
    expect(one).toContain(`<li class="card"><h3><a href="https://example.org/22" rel="noopener">Handball, D1 masculine</a></h3>`);
  });

  it("opens today and tomorrow on /evenements, folds the days after, and a genre opens the days that keep an event", () => {
    // Thursday 29/10/2026 at La Réunion.
    const ev = (day: string, i: number) => ({ titre: `Concert ${day} ${i}`, date: `${day}T19:00:00+04:00`, quand: "19:00", genres: ["concert"], lien: "https://example.org", publie_par: "Salle" });
    const evenements = ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"].flatMap((d) => [ev(d, 1), ev(d, 2), ev(d, 3)]);
    const answer = { resume: "", nombre: evenements.length, evenements, ce_week_end: [], couverture: "", a_savoir: "", sources: [] } as unknown as AgendaAnswer;
    const page = agendaPage(O, cached(answer), NOW);
    expect(count(page, /<details open><summary><h3>/g)).toBe(2);
    expect(count(page, /<details><summary><h3>/g)).toBe(2);
    expect(page).toContain(`<details open><summary><h3>Jeudi 29\u00a0octobre\u00a0<span class="note">·\u00a03\u00a0événements</span></h3></summary>`);
    expect(page).toContain(`if(g)document.querySelectorAll("#jours details").forEach((d)=>{if(d.querySelector("li[data-g]:not([hidden])"))d.open=true})`);
    const short = agendaPage(O, cached({ ...answer, evenements: evenements.slice(0, FOLD_ROWS), nombre: FOLD_ROWS }), NOW);
    expect(short).not.toMatch(/<details( open)?><summary><h3>/);
  });

  it("leaves the last day of /nouveautes open and folds the days before it, each day still its <h2> and its anchor", () => {
    const days = parJour();
    expect(NOUVEAUTES.length).toBeGreaterThan(FOLD_ROWS);
    const page = nouveautesPage(O);
    expect(page).toContain(`<div class="sec-h"><h2 id="h-${days[0].jour}">`);
    expect(count(page, /<div class="card"><details><summary><h2 id="h-/g)).toBe(days.length - 1);
    const d = days[1];
    expect(page).toContain(`<details><summary><h2 id="h-${d.jour}"><time datetime="${d.jour}">${d.titre.replace(/(\d) /, "$1\u00a0")}</time>\u00a0<span class="note">·\u00a0${d.textes.length}\u00a0nouveauté${d.textes.length > 1 ? "s" : ""}</span></h2></summary>`);
  });

  it("folds each group of streets of /collecte under its rhythm, and a search opens the groups it finds", () => {
    const page = collectePage(O, NOW);
    const groups = count(page, /<div class="card groupe"/g);
    expect(groups).toBeGreaterThan(100);
    expect(count(page, /<div class="card groupe"[^>]*><details><summary><h3>/g)).toBe(groups);
    expect(page).toContain(`if(t.length>=3)document.querySelectorAll(".groupe>details").forEach((d)=>{if(!d.parentNode.hidden)d.open=true})`);
    // Every street still in the page, for the search.
    expect(count(page, /<ul class="voies plain">/g)).toBe(groups);
    // Its line, the rhythm's first part; the whole rhythm the first line inside.
    const sp = collectePage(O, NOW, "Saint-Paul");
    const lines = [...sp.matchAll(/<details><summary><h3>([^<]*)\u00a0<span class="note">·\u00a0\d+\u00a0rues?<\/span><\/h3><\/summary><p>([^<]*)\.<\/p>/g)];
    expect(lines.length).toBe(count(sp, /<div class="card groupe"[^>]*><details>/g));
    for (const [, line, whole] of lines) {
      expect(line).not.toContain(";");
      expect(whole.startsWith(`${line}\u00a0; `)).toBe(true);
    }
    // On the island's page, the commune after it, its article kept with its name.
    expect(page).toMatch(/<h3>Ordures ménagères [^<]*\u00a0<span class="note">·\u00a0Le\u00a0Port, \d+\u00a0rues<\/span><\/h3>/);
    // A commune's page: its streets without a calendar in one group, not folded.
    const port = collectePage(O, NOW, "Le Port");
    expect(port).toMatch(/<div class="card groupe" data-c="Le Port" data-r="[^"]*"><ul class="voies plain">/);
    expect(col.COMMUNES).toContain("Le Port");
  });
});
