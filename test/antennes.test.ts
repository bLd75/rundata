import { describe, expect, it } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { inReunion } from "../src/geo.js";
import { antennas } from "../src/tools/terrain.js";
import * as antennes from "../src/vie/antennes.js";
import { COULEURS, LOOK, antennesPage, code, look } from "../src/web/antennes.js";
import { communePage } from "../src/web/commune.js";
import { pageOf } from "../src/web/places.js";
import { CSS } from "../src/web/pages.js";

describe("the antennas of the island (ANFR)", () => {
  it("bundles every mobile support of the island with its operators, and the FM, TNT and DAB+ supports", () => {
    // Counted on the files of 22/10/2026 (mobile) and 30/09/2026 (over 5 W), as the study of 29/10 did.
    expect(antennes.MOBILE_DU).toBe("2026-10-22");
    expect(antennes.RADIO_DU).toBe("2026-09-30");
    expect(antennes.SUPPORTS).toHaveLength(1151);
    expect(Object.fromEntries(antennes.OPERATEURS.map((o) => [o, antennes.SUPPORTS.filter((s) => s.ops[o]).length]))).toEqual({ Orange: 396, "SFR Réunion": 409, Free: 297, Zeop: 279 });
    const sum = (k: "fm" | "tnt" | "dab") => antennes.EMETTEURS.reduce((n, e) => n + (e[k] ?? 0), 0);
    expect([antennes.EMETTEURS.length, sum("fm"), sum("tnt"), sum("dab")]).toEqual([173, 276, 38, 9]);
    for (const x of [...antennes.SUPPORTS, ...antennes.EMETTEURS]) {
      expect(inReunion(x.lon, x.lat), String(x.id)).toBe(true);
      expect(x.insee).toMatch(/^974\d\d$/);
      // A place and a height: never an address.
      expect(Object.keys(x).filter((k) => /adr|adresse|lieu/.test(k))).toEqual([]);
    }
    // The ANFR never writes « en service » for the 5G, here nor in the rest of France (124 112 lines of 5G in the file of
    // 22/10/2026, none « En service »): its most advanced state there is « techniquement opérationnel », and the 2G to 4G
    // never have it. The tile and the note say so; a file that changes this must change them.
    expect(antennes.SUPPORTS.some((s) => antennes.generations(s, "service").has("5"))).toBe(false);
    expect(antennes.SUPPORTS.some((s) => [...antennes.generations(s, "operationnel")].some((g) => g !== "5"))).toBe(false);
    // Only TDF is named: never the Arcom, which assigns the frequencies, nor a private site.
    expect(new Set(antennes.EMETTEURS.flatMap((e) => e.exploitants ?? []))).toEqual(new Set(["TDF"]));
  });

  it("gives fiche_terrain the supports within 500 m, the closest first, with each operator's generations by state", () => {
    // The Barachois, Saint-Denis.
    const r = antennas(55.4481, -20.8789);
    expect(r.ligne).toBe("13 supports d'antennes mobiles à moins de 500 m, le plus proche à 170 m (ANFR)");
    expect(r.bloc.antennes_mobiles).toMatchObject({ fichier_du: "22/10/2026", supports: 13 });
    expect(r.bloc.antennes_mobiles.plus_proches[0]).toEqual({
      distance_m: 170,
      hauteur_m: 30,
      support: "bâtiment",
      operateurs: [{ operateur: "SFR Réunion", en_service: "2G, 3G, 4G", techniquement_operationnel: "5G" }],
    });
    expect(r.bloc.antennes_mobiles.plus_proches).toHaveLength(5);
    expect(r.bloc.radio_et_television).toEqual({ fichier_du: "30/09/2026", supports: 0, plus_proches: [] });
    expect(r.bloc.note).toContain("ce n'est ni l'état du réseau en ce moment, ni la couverture");
    expect(r.bloc.note).toContain("Pour la 5G, l'ANFR n'emploie pas «\u00a0en service\u00a0»\u00a0: son état le plus avancé est «\u00a0techniquement opérationnel\u00a0».");
    expect(r.bloc.note).toContain("Free et SFR Réunion sont déclarés sous les noms Telco OI et SRR.");
    expect(r.bloc.note).toContain("https://www.cartoradio.fr");
    // In the middle of the Plaine des Cafres' forest: none declared.
    expect(antennas(55.53, -21.13).ligne).toBe("aucun support d'antennes mobiles déclaré à moins de 500 m (ANFR)");
  });

  it("names the broadcast stations near the point by kind, and their operator only when it is TDF", () => {
    const e = antennes.EMETTEURS.find((x) => x.tnt && x.fm && x.exploitants?.includes("TDF"))!;
    const r = antennas(e.lon, e.lat).bloc.radio_et_television;
    expect(r.plus_proches[0]).toMatchObject({ distance_m: 0, exploitant: "TDF" });
    expect(r.plus_proches[0].emetteurs).toMatch(/^\d+ stations? FM, \d+ TNT/);
    const prive = antennes.EMETTEURS.find((x) => x.fm && !x.exploitants)!;
    expect(antennas(prive.lon, prive.lat).bloc.radio_et_television.plus_proches[0]).not.toHaveProperty("exploitant");
  });

  it("is on each commune's page, apart from the live grid: the supports by operator, the file's day, never « couverture »", () => {
    const page = communePage("https://rundata.re", pageOf("cilaos")!, { place: null });
    const start = page.indexOf('<section aria-labelledby="h-habiter">');
    const habiter = page.slice(start, page.indexOf("</section>", start));
    expect(habiter).toContain(
      '<h3><a href="/antennes">Antennes</a></h3><p class="tv">7</p><p class="td all">supports d\'antennes mobiles dans la commune, déclarés à l\'ANFR au 22 octobre 2026, dont 5 avec la 5G techniquement opérationnelle · Orange sur 2, SFR Réunion sur 4, Free sur 1, Zeop sur 1 · 6 supports d\'émetteurs de radio ou de télévision de plus de 5\u00a0W (FM, TNT, DAB+) · ANFR</p>',
    );
    expect(habiter).not.toMatch(/couvert|couverture|exposition/);
    expect(page).toContain(antennes.SOURCE_MOBILE.nom);
  });

  it("has its page, /antennes: the map filtered by operator and type, the counts read from the files, the 5G as the ANFR says it", async () => {
    const html = antennesPage("https://rundata.re");
    expect(html).toContain("<title>Antennes Réunion : 4G, 5G, TNT et radio sur la carte · 974</title>");
    // Counted from the files, never written: the next file changes them.
    expect(html).toContain("<p class=\"lead\">1\u202f151 supports d&#39;antennes mobiles déclarés à l&#39;ANFR au 22 octobre 2026, et 173 supports d&#39;émetteurs de radio et de télévision au 30 septembre 2026.</p>");
    // Two rows that combine, and the colours; their values are the page's address (« #orange-5g »).
    const row = (n: string) => [...html.matchAll(new RegExp(`<input type="radio" name="${n}" id="${n}-[a-z0-9-]+" value="([a-z0-9-]*)"`, "g"))].map((m) => m[1]);
    expect(row("ao")).toEqual(["", "orange", "sfr-reunion", "free", "zeop"]);
    expect(row("at")).toEqual(["", "2g", "3g", "4g", "5g", "tnt", "fm", "dab"]);
    expect(row("ac")).toEqual(["o", "t"]);
    // Without the script, the filters stay hidden and every mobile support is drawn, coloured by operator.
    expect(html).toContain('<div class="antf" hidden>');
    expect([...html.matchAll(/<circle class="s k[a-z0-9]( r)?" cx/g)]).toHaveLength(1151);
    expect([...html.matchAll(/<circle class="e h" cx/g)]).toHaveLength(173);
    // A count for each choice: the 25 of an operator and a generation, the 3 of the radio and the TV.
    const legends = [...html.matchAll(/<span class="lg" data-k="([a-z0-9-]+)"( hidden)?>([^<]+)<\/span>/g)].map((m) => [m[1], m[3].replace(/&#39;/g, "'")]);
    expect(legends).toHaveLength(28);
    const by = Object.fromEntries(legends);
    expect(by["tous"]).toBe("1\u202f151 supports d'antennes mobiles, dont 1\u202f134 avec au moins une antenne active.");
    expect(by["orange"]).toBe("Orange : 392 supports avec au moins une antenne active, 4 en projet seulement.");
    expect(by["5g"]).toBe("5G : 683 supports avec la 5G techniquement opérationnelle, 99 en projet, tous opérateurs.");
    expect(by["orange-5g"]).toBe("Orange, 5G : 332 supports avec la 5G techniquement opérationnelle, 19 en projet.");
    expect(by["tnt"]).toBe("TNT : 36 supports d'émetteurs de télévision, 38 stations.");
    // The filters' script, once, and it parses.
    const script = [...html.matchAll(/<script>(\(\(\)=>\{const f=document\.querySelector\("\.antf"\)[^]*?)<\/script>/g)].map((m) => m[1]);
    expect(script).toHaveLength(1);
    expect(() => new Function(script[0])).not.toThrow();
    // The radio and the TV by their list, never by the length of their name (« fm » has two letters).
    expect(script[0]).toContain('const RADIOS=["tnt","fm","dab"];');
    expect(script[0]).toContain("radio=RADIOS.includes(t);");
    expect(script[0]).not.toMatch(/t\.length/);
    expect(by["fm"]).toMatch(/^FM : \d+ supports d'émetteurs de radio FM, \d+ stations\.$/);
    expect(by["dab"]).toMatch(/^DAB\+ : \d+ supports d'émetteurs de radio numérique, \d+ stations\.$/);
    expect(html).not.toMatch(/5G en service/);
    // The commune of the tile has the same counts, its operators without « sur ».
    expect(html).toContain('<th scope="row">Cilaos</th><td data-label="Supports mobiles">7</td><td data-label="Dont 5G techniquement opérationnelle">5</td><td data-label="Supports par opérateur">Orange 2, SFR Réunion 4, Free 1, Zeop 1</td><td data-label="Supports radio et TV">6</td>');
    expect(html).toContain('<a href="https://www.cartoradio.fr" rel="noopener">cartoradio.fr</a>');
    // Served, and linked from the commune's tile.
    const res = await handle(new Request("https://rundata.re/antennes"), new Cache());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>Les antennes de La Réunion</h1>");
    expect(communePage("https://rundata.re", pageOf("cilaos")!, { place: null })).toContain('<h3><a href="/antennes">Antennes</a></h3>');
  });

  it("shows each support the same in the browser as counted on the server, for every choice", () => {
    const js = new Function(`${LOOK} return look;`)() as typeof look;
    const parse = (c: string) => [...c.matchAll(/([a-z])(\d*)(?:\+(\d+))?/g)].map((m) => [m[1], m[2], m[3] ?? ""] as [string, string, string]);
    const codes = antennes.SUPPORTS.map((s) => parse(code(s)));
    for (const o of ["", "o", "s", "f", "z"]) for (const g of ["", "2", "3", "4", "5"]) for (const m of ["o", "t"]) {
      for (const d of codes) expect(js(d, o, g, m), `${o} ${g} ${m}`).toEqual(look(d, o, g, m));
    }
    // A support shared by two operators: « plusieurs », even with one of them chosen; by type, the chosen one's newest.
    expect(look(parse("o2345 s234"), "o", "", "o")).toEqual([false, "m"]);
    expect(look(parse("o2345 s234"), "s", "", "t")).toEqual([false, "4"]);
    // On the 5G, only the operator with a 5G counts: its colour; planned only, a ring.
    expect(look(parse("o234+5 s234"), "", "5", "o")).toEqual([true, "o"]);
    expect(look(parse("o234 s234"), "", "5", "o")).toBeNull();
  });

  it("colours the dots with marketing's palette, never an operator's own colour", () => {
    expect(COULEURS).toEqual({ o: "#56b4e9", s: "#f0e442", f: "#b0508a", z: "#2563d8", m: "#0b1f36", 5: "#f0e442", 4: "#56b4e9", 2: "#b4c6d8", r: "#b0508a" });
    for (const [k, c] of Object.entries(COULEURS)) expect(CSS, k).toContain(`.antmap .k${k}{--c:${c}}`);
    // Each dot has its white edge; a ring, its night one.
    expect(CSS).toContain(".antmap .ants circle{fill:var(--c);stroke:#fff;stroke-width:8;paint-order:stroke}");
    expect(CSS).toContain("filter:drop-shadow(0 0 1.5px #0b1f36)");
  });
});
