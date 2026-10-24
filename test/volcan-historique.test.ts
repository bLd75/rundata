import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeText, textOf } from "../src/providers/avis-eau.js";
import { CHAPEAU, type Communique, EPISODES, precedentes, resumeText } from "../src/tools/volcan-historique.js";
import { volcanPage } from "../src/web/domains.js";
import type { VolcanAnswer } from "../src/web/data.js";

// The prefecture's releases as their Wayback Machine copies gave them on 24/10/2026, by copy.
const FIXTURES: Record<string, string> = {
  "piton-de-la-fournaise-passage-en-alerte-1-a9890.html": "2022-09-19-alerte-1.html",
  "piton-de-la-fournaise-passage-en-alerte-2-1-a9891.html": "2022-09-19-alerte-2-1.html",
  "piton-de-la-fournaise-eruption-arretee-mais-enclos-a9951.html": "2022-10-05-eruption-arretee.html",
  "Piton-de-la-Fournaise-passage-en-alerte-1-fermeture-de-l-enclos3": "2023-07-02-alerte-1.html",
  "Eruption-le-prefet-rappelle-qu-il-est-interdit-et-dangereux-de-tenter-d-acceder-aux-coulees-de-lave": "2023-07-25-rappel.html",
  "Piton-de-la-Fournaise-reouverture-totale-de-l-enclos": "2023-08-31-reouverture-totale.html",
  "Piton-de-la-Fournaise-passage-en-alerte-1-fermeture-de-l-enclos4": "2026-01-01-alerte-1.html",
  "Piton-de-la-Fournaise-retour-en-phase-de-vigilance": "2026-01-02-vigilance.html",
  "Piton-de-la-Fournaise-eruption-dans-l-enclos": "2026-01-18-alerte-2-1.html",
  "Acces-a-l-enclos-avec-restrictions": "2026-01-27-vigilance.html",
  "Piton-de-la-Fournaise-reouverture-partielle-de-l-enclos": "2026-05-07-vigilance.html",
};
const page = (c: Communique) => {
  const f = FIXTURES[c.copie.split("/").pop()!];
  return decodeText(textOf(readFileSync(new URL(`./fixtures/volcan-historique/${f}`, import.meta.url), "utf8"))).replace(/\s+/g, " ");
};
const dd = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const moments = EPISODES.flatMap((e) => [...e.debut, e.fin]);
const NOW = new Date("2026-10-24T16:30:00Z");

describe("the alerts before this one", () => {
  it("quotes each release as written, on the day its page gives", () => {
    for (const m of moments) {
      const t = page(m.communique);
      expect(t, m.communique.copie).toContain(m.dit);
      expect(t, m.communique.copie).toContain(m.communique.mis_a_jour ? `Mis à jour le ${dd(m.communique.jour)}` : dd(m.communique.jour));
      // The day of the event: the release's own, or written in the words quoted.
      const d = new Date(`${m.jour}T12:00:00Z`);
      if (m.jour !== m.communique.jour) expect(m.dit, m.jour).toMatch(new RegExp(`\\b${d.getUTCDate()}(er)? ${MOIS[d.getUTCMonth()]}( ${d.getUTCFullYear()})?`));
    }
  });

  it("keeps the episodes since the plan of 08/11/2021, each with a start and an end, newest first", () => {
    expect(EPISODES).toHaveLength(5);
    for (const e of EPISODES) {
      expect(e.debut.length).toBeGreaterThan(0);
      expect(e.debut[0].jour >= "2021-11-08").toBe(true);
      expect(e.fin.jour >= e.debut.at(-1)!.jour).toBe(true);
    }
    expect(EPISODES.map((e) => e.debut[0].jour)).toEqual([...EPISODES.map((e) => e.debut[0].jour)].sort().reverse());
  });

  it("dates the eruption of February 2026 by the release of its end, and reads no level for that day", () => {
    const feb = EPISODES[0];
    expect(feb.debut).toEqual([expect.objectContaining({ jour: "2026-02-13", quoi: "éruption débutée (selon le communiqué du 07/05/2026)", dit: "Suite à la fin de l'éruption volcanique débutée le 13 février 2026" })]);
    expect(feb.debut[0].communique.copie).toBe(feb.fin.communique.copie);
    expect(feb.debut[0].quoi).not.toMatch(/alerte/i);
    expect(page(feb.fin.communique)).toContain("Suite à la fin de l'éruption volcanique débutée le 13 février 2026 et aux reconnaissances opérées les 30 avril et 6 mai 2026");
  });

  it("writes the end of October 2022 as the release does: the eruption stopped, the Enclos still closed", () => {
    expect(EPISODES.at(-1)!.fin).toMatchObject({ jour: "2022-10-05", quoi: "éruption arrêtée", dit: "Éruption arrêtée mais enclos toujours fermé" });
  });

  it("tells the AI and the page what the list is, with the copies' links", async () => {
    const p = precedentes();
    expect(p.note).toContain("Ce n'est pas un historique complet");
    expect(p.episodes[0].debut[0]).toBe("13/02/2026, éruption débutée (selon le communiqué du 07/05/2026) : « Suite à la fin de l'éruption volcanique débutée le 13 février 2026 » (communiqué du 07/05/2026 : https://web.archive.org/web/20260507190343/https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Piton-de-la-Fournaise-reouverture-partielle-de-l-enclos)");
    expect(resumeText()).toBe(
      "Alertes précédentes dont le début et la fin sont écrits dans un communiqué de la préfecture (liste partielle, depuis novembre 2021) : " +
        "13/02/2026 éruption débutée (selon le communiqué du 07/05/2026) → 07/05/2026 retour en phase de vigilance ; 18/01/2026 alerte 2-1 → 27/01/2026 passage en phase de vigilance ; " +
        "01/01/2026 alerte 1 → 02/01/2026 retour en phase de vigilance ; 02/07/2023 alerte 1, 02/07/2023 alerte 2-1 → 31/08/2023 retour en phase de vigilance ; " +
        "19/09/2022 alerte 1, 19/09/2022 alerte 2-1 → 05/10/2022 éruption arrêtée.",
    );
    const html = volcanPage("https://rundata.re", { value: { resume: "", sources: [], avertissements: [] } as unknown as VolcanAnswer, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain(`<h2 id="h-alertes">Les alertes précédentes</h2><p>${CHAPEAU.replace(/'/g, "&#39;")}</p>`);
    expect(html).toContain(`<li><b>05/10/2022</b>, éruption arrêtée : « Éruption arrêtée mais enclos toujours fermé » <a href="https://web.archive.org/web/20221005174746/https://www.reunion.gouv.fr/piton-de-la-fournaise-eruption-arretee-mais-enclos-a9951.html">communiqué du 05/10/2022 →</a></li>`);
    expect(html).toContain("communiqué mis à jour le 06/09/2023 →");
  });
});
