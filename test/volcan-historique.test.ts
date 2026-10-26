import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeText, textOf } from "../src/providers/avis-eau.js";
import { AVANT_2021, avant2021, CHAPEAU, type Communique, DERNIERE_ERUPTION, derniereEruptionDates, derniereEruptionText, EPISODES, PLAN_2021, precedentes, resumeText } from "../src/tools/volcan-historique.js";
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
  "Piton-de-la-Fournaise-eruption-dans-l-enclos2?utm_source=chatgpt.com": "2026-02-13-alerte-2-1.html",
  "Acces-a-l-enclos-avec-restrictions": "2026-01-27-vigilance.html",
  "Piton-de-la-Fournaise-reouverture-partielle-de-l-enclos": "2026-05-07-vigilance.html",
  // The site before 2022: the breadcrumb with its title, and the article.
  "piton-de-la-fournaise-eruption-en-cours-dans-l-a1635.html": "2016-05-26-alerte-2-2.html",
  "activite-volcanique-au-piton-de-la-fournaise-phase-a1641.html": "2016-05-27-sauvegarde.html",
  "piton-de-la-fournaise-passage-en-alerte-1-eruption-a1971.html": "2016-09-11-alerte-1.html",
  "piton-de-la-fournaise-passage-en-alerte-2-2-a1972.html": "2016-09-11-alerte-2-2.html",
  "activite-volcanique-au-piton-de-la-fournaise-a2013.html": "2016-09-18-sauvegarde.html",
  "piton-de-la-fournaise-passage-en-alerte-1-eruption-a2515.html": "2017-01-31-alerte-1.html",
  "piton-de-la-fournaise-alerte-2-2-eruption-en-cours-a2516.html": "2017-01-31-alerte-2-2.html",
  "activite-volcanique-au-piton-de-la-fournaise-a2625.html": "2017-02-28-sauvegarde.html",
  "piton-de-la-fournaise-passage-en-alerte-1-eruption-a2834.html": "2017-05-17-alerte-1.html",
  "piton-de-la-fournaise-passage-en-alerte-2-2-a2837.html": "2017-05-17-alerte-2-2.html",
  "piton-de-la-fournaise-retour-en-vigilance-a2886.html": "2017-06-01-vigilance.html",
  "piton-de-la-fournaise-passage-en-alerte-2-2-a2994.html": "2017-07-14-alerte-2-2.html",
  "activite-volcanique-au-piton-de-la-fournaise-a3090.html": "2017-08-28-sauvegarde.html",
  "piton-de-la-fournaise-passage-en-alerte-1-eruption-a3747.html": "2018-04-04-alerte-1.html",
  "activite-volcanique-au-piton-de-la-fournaise-a3801.html": "2018-04-13-vigilance.html",
  "piton-de-la-fournaise-passage-en-alerte-1-eruption-a4333.html": "2018-09-15-alerte-1.html",
  "piton-de-la-fournaise-passage-en-alerte-2-2-a4334.html": "2018-09-15-alerte-2-2.html",
  "activite-volcanique-au-piton-de-la-fournaise-a4497.html": "2018-11-01-sauvegarde.html",
  "piton-de-la-fournaise-passage-en-alerte-1-eruption-a4937.html": "2019-02-16-alerte-1.html",
  "piton-de-la-fournaise-passage-en-alerte-2-2-a4938.html": "2019-02-18-alerte-2-2.html",
  "piton-de-la-fournaise-passage-en-phase-sauvegarde-a4941.html": "2019-02-19-sauvegarde.html",
  "piton-de-la-fournaise-passage-en-alerte-2-2-a4948.html": "2019-02-19-alerte-2-2.html",
  "piton-de-la-fournaise-passage-en-alerte-2-2-a5590.html": "2019-08-11-alerte-2-2.html",
  "piton-de-la-fournaise-retour-en-phase-de-vigilance-a5693.html": "2019-09-03-vigilance.html",
  "piton-de-la-fournaise-passage-en-alerte-1-eruption-a5881.html": "2019-10-21-alerte-1.html",
  "piton-de-la-fournaise-retour-en-phase-de-vigilance-a5902.html": "2019-10-22-vigilance.html",
  "piton-de-la-fournaise-passage-en-alerte-2-2-a5903.html": "2019-10-25-alerte-2-2.html",
  "activite-volcanique-au-piton-de-la-fournaise-a5915.html": "2019-10-28-sauvegarde.html",
  "piton-de-la-fournaise-passage-en-alerte-2-2-a6476.html": "2020-04-02-alerte-2-2.html",
  "activite-volcanique-au-piton-de-la-fournaise-a6487.html": "2020-04-06-sauvegarde.html",
};
const page = (c: Communique) => {
  const f = FIXTURES[c.copie.split("/").pop()!];
  return decodeText(textOf(readFileSync(new URL(`./fixtures/volcan-historique/${f}`, import.meta.url), "utf8"))).replace(/\s+/g, " ");
};
const dd = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const moments = EPISODES.flatMap((e) => [...e.debut, e.fin, ...(e.puis ? [e.puis] : [])]);
const NOW = new Date("2026-10-24T16:30:00Z");

describe("the alerts before this one", () => {
  it("quotes each release as written, on the day its page gives", () => {
    for (const m of moments) {
      const t = page(m.communique);
      // A passage left out is marked « […] »: the parts, in their order.
      const parts = m.dit.split(" […] ");
      let at = 0;
      for (const part of parts) {
        const i = t.indexOf(part, at);
        expect(i, `${m.communique.copie} : ${part}`).toBeGreaterThanOrEqual(0);
        // A cut leaves out the plan's name or an aside, never a negation, a condition or a restriction (marketing).
        if (at) expect(t.slice(at, i), m.communique.copie).not.toMatch(/\b(ne|n’|n'|pas|sauf|si|uniquement|seulement|interdite?s?|jusqu|restreinte?|limitée?)\b/i);
        at = i + part.length;
      }
      expect(t, m.communique.copie).toContain(m.communique.mis_a_jour ? `Mis à jour le ${dd(m.communique.jour)}` : dd(m.communique.jour));
      // The day of the event: the release's own, or written in the words quoted.
      const d = new Date(`${m.jour}T12:00:00Z`);
      if (m.jour !== m.communique.jour) expect(m.dit.replace(" […] ", " "), m.jour).toMatch(new RegExp(`\\b${d.getUTCDate()}(er)? ${MOIS[d.getUTCMonth()]}( ${d.getUTCFullYear()})?`));
    }
  });

  it("keeps the episodes since 2016, each with a start and an end, newest first", () => {
    expect(EPISODES).toHaveLength(17);
    expect(EPISODES.filter((e) => !avant2021(e))).toHaveLength(5);
    expect(EPISODES.at(-1)!.debut[0].jour).toBe("2016-05-26");
    for (const e of EPISODES) {
      expect(e.debut.length).toBeGreaterThan(0);
      expect(e.debut[0].jour >= "2016-01-01").toBe(true);
      expect(e.fin.jour >= e.debut.at(-1)!.jour).toBe(true);
      // No episode across the change of plan.
      expect(e.debut[0].jour < PLAN_2021).toBe(e.fin.jour < PLAN_2021);
    }
    expect(EPISODES.map((e) => e.debut[0].jour)).toEqual([...EPISODES.map((e) => e.debut[0].jour)].sort().reverse());
  });

  it("dates the eruption of February 2026 by the release of its day, quoted as written", () => {
    const feb = EPISODES[0];
    expect(feb.debut).toEqual([expect.objectContaining({ jour: "2026-02-13", quoi: "alerte 2-1", communique: expect.objectContaining({ jour: "2026-02-13" }) })]);
    // The source's typo kept: a quote, not our words.
    expect(feb.debut[0].dit).toContain("(OPVF)");
    expect(feb.debut[0].selon).toBeUndefined();
    expect(page(feb.debut[0].communique)).toContain("Déclenchement du passage en alerte 2.1");
  });

  it("never dates a start by the release of its end, nor by a release published after the end", () => {
    for (const e of EPISODES) {
      for (const m of e.debut) {
        expect(m.communique.copie, m.jour).not.toBe(e.fin.communique.copie);
        expect(m.communique.jour <= e.fin.jour, `${m.jour} : ${m.communique.copie}`).toBe(true);
      }
    }
  });

  it("names the levels before 2021 as the releases of then write them, and the end as the first release out of the alert", () => {
    const older = EPISODES.filter(avant2021);
    expect(new Set(older.flatMap((e) => e.debut.map((m) => m.quoi)))).toEqual(new Set(["alerte 1", "alerte 2-2", "éruption débutée"]));
    expect(new Set(older.map((e) => e.fin.quoi))).toEqual(new Set(["passage en phase de sauvegarde", "retour en phase de vigilance", "retour en phase de vigilance volcanique"]));
    // Each level is in the words quoted, but not the plan's name in « », never nested in our quotes.
    for (const m of older.flatMap((e) => [...e.debut, e.fin])) {
      if (m.quoi !== "éruption débutée") expect(m.dit.toLowerCase(), m.communique.copie).toContain(m.quoi.replace(/^(passage en|retour en) /, ""));
      expect(m.dit).not.toMatch(/[«»]/);
    }
    // April 2018: the start of the eruption, by the release of the next day; its alert 1 lowers the level, not a start.
    const apr = EPISODES.find((e) => e.debut[0].jour === "2018-04-03")!;
    expect(apr.debut).toEqual([expect.objectContaining({ quoi: "éruption débutée", selon: "selon le communiqué du 04/04/2018" })]);
    expect(page(apr.debut[0].communique)).toContain("le préfet de la Réunion a décidé de passer en alerte 1");
  });

  it("labels each end with what its release writes, never what we deduce", () => {
    expect(EPISODES[4].fin).toMatchObject({ jour: "2022-10-05", quoi: "éruption arrêtée", dit: "Éruption arrêtée mais enclos toujours fermé" });
    expect(EPISODES[1].fin).toMatchObject({ jour: "2026-01-27", quoi: "réouverture des sentiers" });
    expect(EPISODES[3].fin).toMatchObject({ jour: "2023-08-31", quoi: "Enclos accessible au public" });
    expect(EPISODES[2].fin.dit).toBe("le préfet de La Réunion décide de revenir en phase de vigilance […] à compter de ce vendredi 2 janvier 2026 midi");
  });

  it("tells the AI and the page what the list is, with the copies' links", async () => {
    const p = precedentes();
    expect(p.note).toContain("Ce n'est pas un historique complet");
    expect(p.note).toContain(AVANT_2021);
    expect(p.episodes[0].debut[0]).toBe("13/02/2026, alerte 2-1 : « L’observatoire volcanologique du piton de la Fournaise (OPVF) a enregistré à 09h25 une crise sismique, le trémor volcanique synonyme d’arrivée du magma à proximité de la surface a été enregistré depuis 10h00 (heure locale). » (communiqué du 13/02/2026 : https://web.archive.org/web/20260215235752/https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Piton-de-la-Fournaise-eruption-dans-l-enclos2?utm_source=chatgpt.com)");
    expect(resumeText()).toBe(
      "Alertes précédentes dont le début et la fin sont écrits dans un communiqué de la préfecture (liste partielle, depuis 2016\u00a0; avant novembre 2021, les niveaux du plan précédent) : " +
        "13/02/2026 alerte 2-1 → 07/05/2026 retour en phase de vigilance\u00a0; 18/01/2026 alerte 2-1 → 27/01/2026 réouverture des sentiers\u00a0; " +
        "01/01/2026 alerte 1 → 02/01/2026 retour en phase de vigilance\u00a0; 02/07/2023 alerte 1, 02/07/2023 alerte 2-1 → 31/08/2023 Enclos accessible au public\u00a0; " +
        "19/09/2022 alerte 1, 19/09/2022 alerte 2-1 → 05/10/2022 éruption arrêtée\u00a0; " +
        "02/04/2020 alerte 2-2 → 06/04/2020 passage en phase de sauvegarde\u00a0; 25/10/2019 alerte 2-2 → 28/10/2019 passage en phase de sauvegarde\u00a0; " +
        "21/10/2019 alerte 1 → 23/10/2019 retour en phase de vigilance\u00a0; 11/08/2019 alerte 2-2 → 04/09/2019 retour en phase de vigilance\u00a0; " +
        "16/02/2019 alerte 1, 18/02/2019 alerte 2-2 → 19/02/2019 passage en phase de sauvegarde (le même jour, nouvelle alerte 2-2 : sa fin n'est pas dans les communiqués que nous avons retrouvés)\u00a0; 15/09/2018 alerte 1, 15/09/2018 alerte 2-2 → 01/11/2018 passage en phase de sauvegarde\u00a0; " +
        "03/04/2018 éruption débutée (selon le communiqué du 04/04/2018) → 14/04/2018 retour en phase de vigilance volcanique\u00a0; 14/07/2017 alerte 2-2 → 28/08/2017 passage en phase de sauvegarde\u00a0; " +
        "17/05/2017 alerte 1, 17/05/2017 alerte 2-2 → 02/06/2017 retour en phase de vigilance\u00a0; 31/01/2017 alerte 1, 31/01/2017 alerte 2-2 → 28/02/2017 passage en phase de sauvegarde\u00a0; " +
        "11/09/2016 alerte 1, 11/09/2016 alerte 2-2 → 18/09/2016 passage en phase de sauvegarde\u00a0; 26/05/2016 alerte 2-2 → 27/05/2016 passage en phase de sauvegarde.",
    );
    const html = volcanPage("https://rundata.re", { value: { resume: "", sources: [], avertissements: [] } as unknown as VolcanAnswer, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain(`<h2 id="h-alertes">Les alertes précédentes</h2><p>${CHAPEAU.replace(/'/g, "&#39;")}</p>`);
    // Whose the end is: the prefecture's release, often weeks after the stop the OVPF announces (marketing).
    expect(CHAPEAU).toContain("Les phrases sont citées telles quelles. Leur fin est celle de la préfecture, qui lève l'alerte par un communiqué, parfois des semaines après l'arrêt de l'éruption annoncé par l'OVPF. Ce n'est pas");
    expect(html).toContain(`<li><b>05/10/2022</b>, éruption arrêtée\u00a0: «\u00a0Éruption arrêtée mais enclos toujours fermé\u00a0» <a href="https://web.archive.org/web/20221005174746/https://www.reunion.gouv.fr/piton-de-la-fournaise-eruption-arretee-mais-enclos-a9951.html">communiqué du 05/10/2022 →</a></li>`);
    expect(html).toContain("communiqué mis à jour le 06/09/2023 →");
    // February 2026 dated by the release of its day, quoted as written: no « selon », never the end's release.
    expect(html).toContain(`<li><b>13/02/2026</b>, alerte 2-1\u00a0: «\u00a0L’observatoire volcanologique du piton de la Fournaise (OPVF)`);
    expect(html).not.toContain("selon le communiqué du 07/05/2026");
    // Before 2021, folded under the note, after the five since the plan.
    const section = html.slice(html.indexOf(`<section id="alertes-precedentes"`), html.indexOf("</section>", html.indexOf(`<section id="alertes-precedentes"`)));
    const [recent, older] = section.split("<details>");
    expect(recent.match(/<li class="card">/g)).toHaveLength(5);
    expect(older).toMatch(/^<summary>De 2016 à novembre 2021 \(12\u00a0épisodes\)<\/summary><p class="note">Avant novembre 2021, les niveaux d&#39;alerte étaient ceux du plan précédent\u00a0: ils sont cités tels que les communiqués les écrivent.<\/p><ul class="posts">/);
    expect(older.match(/<li class="card">/g)).toHaveLength(12);
    // February 2019: the alert again the same day, said after the end, or the reader thinks all stopped on 19/02.
    expect(older).toContain(`<p>Le même jour, nouvelle alerte 2-2\u00a0: «\u00a0le Préfet a décidé la mise en œuvre de la phase d’alerte 2-2 […] ce mardi 19 février à 18h30\u00a0» (<a href="https://web.archive.org/web/20190222142555/http://www.reunion.gouv.fr/piton-de-la-fournaise-passage-en-alerte-2-2-a4948.html">communiqué du 19/02/2019 →</a>). Sa fin n&#39;est pas dans les communiqués que nous avons retrouvés.</p></li>`);
    expect(older.match(/Le même jour/g)).toHaveLength(1);
    const feb2019 = p.episodes.find((e) => e.fin.startsWith("19/02/2019"))!;
    expect(feb2019.puis).toBe("Le même jour, nouvelle alerte 2-2 : « le Préfet a décidé la mise en œuvre de la phase d’alerte 2-2 […] ce mardi 19 février à 18h30 » (communiqué du 19/02/2019 : https://web.archive.org/web/20190222142555/http://www.reunion.gouv.fr/piton-de-la-fournaise-passage-en-alerte-2-2-a4948.html). Sa fin n'est pas dans les communiqués que nous avons retrouvés.");
    expect(p.episodes.filter((e) => "puis" in e)).toHaveLength(1);
    expect(older).toContain(`<li><b>26/05/2016</b>, alerte 2-2\u00a0: «\u00a0le préfet de la Réunion a déclenché ce jour (jeudi 26 mai 2016) à 8h30 l’alerte 2-2\u00a0» <a href="https://web.archive.org/web/20160530083219/http://www.reunion.gouv.fr/piton-de-la-fournaise-eruption-en-cours-dans-l-a1635.html">communiqué du 26/05/2016 →</a></li>`);
  });
});

describe("the last eruption, the OVPF's dates", () => {
  it("says its days in words, the year on both when they differ, with the OVPF's post (marketing)", () => {
    expect(derniereEruptionText()).toBe("Dernière éruption : du 13 février au 12 avril 2026, selon l'OVPF (https://bsky.app/profile/ovpf.bsky.social/post/3mjdrynd4ns2g).");
    expect(derniereEruptionDates({ debut: "2026-12-28", fin: "2027-01-03" })).toBe("du 28 décembre 2026 au 3 janvier 2027");
    expect(derniereEruptionDates({ debut: "2026-04-03", fin: "2026-04-12" })).toBe("du 3 au 12 avril 2026");
    expect(derniereEruptionDates({ debut: "2026-04-03", fin: "2026-04-03" })).toBe("le 3 avril 2026");
    expect(derniereEruptionDates({ debut: "2026-10-30", fin: "2026-11-01" })).toBe("du 30 octobre au 1er novembre 2026");
    // The end post is newer than the end it tells of: posted the next morning.
    expect(Date.parse(DERNIERE_ERUPTION.publiee)).toBeGreaterThan(Date.parse(`${DERNIERE_ERUPTION.fin}T00:00:00+04:00`));
  });
});
