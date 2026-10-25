import { describe, expect, it } from "vitest";
import type { Info } from "../src/providers/actualites.js";
import { eruptionSaid, levelSaid, phaseOf, type Post } from "../src/providers/volcan.js";
import { officiel } from "../src/tools/volcan.js";

// The OVPF's own texts on Bluesky, February to April 2026, as posted.
const DEBUT = "🌋  Eruption en cours au Piton de la Fournaise Suite à la crise sismique débutée à 09h25 heure locale le 13 février 2026, le trémor volcanique est enregistré depuis 10h00 environ heure locale. Les fissure(s) éruptives se sont ouvertes proche du sommet au flanc sud du volcan. Alerte 2-1";
const SUITE = "▶ Communiqué OVPF-IPGP - 15/02/2026 - 7h15 🌋 L'éruption se poursuit. ✅ Le front de coulée à 2,2 km de la RN2. ✅ L’intensité du trémor éruptif a diminué d’un facteur 2 au cours des dernières 24. Niveau d'alerte: 2.1 Toutes les infos";
const PHASE = "Communiqué OVPF-IPGP - 12/04/2026 - 7h00 🌋 3e phase de l’éruption du Piton de la Fournaise toujours en cours ✅ Trémor en légère baisse";
const REPRISE = "Communiqué OVPF-IPGP - 08/4/2026 - 14h25 🌋 Suite à une augmentation rapide du trémor depuis ce matin, 8 avril, l'éruption au Piton de la Fournaise a repris vers 13h15 heure locale.";
const NIVEAU = "Communiqué OVPF-IPGP 02/04/2026 🌋 1 site éruptif ✅ Bras sud de coulée toujours actif ✅ Nouvelle coupure de la RN2 ▶ Niveau d’alerte : 2.2 ▶ Communiqué : www.ipgp.fr/v";
const ARRET = "Communiqué OVPF-IPGP - 13/04/2026 - 06h 🌋 Arrêt de l'éruption ✅ Arrêt du trémor le 12/004/026 vers 23h10 heure locale (19h10 UTC).";
const SANS_LIEN = "Communiqué OVPF-IPGP 03/04/2026 7h30 🫨 Séisme ressenti à 03h39 (heure locale) ✅ Sans lien avec l’éruption qui vient de se terminer";
const BULLETIN = "Bulletin mensuel OVPF-IPGP – Avril 2026 🌋Bilan de l’éruption du 13/02 au 12/04/2026 au #PitonDeLaFournaise.";

const post = (texte: string, date: string, image = false): Post => ({ texte, date, lien: `https://bsky.app/profile/ovpf.bsky.social/post/${date}`, ...(image && { image: true as const }) });
const release = (titre: string, day: string) => phaseOf([{ titre, lien: `https://www.reunion.gouv.fr/x/${day}`, publie: new Date(`${day}T12:00:00+04:00`).toISOString() } as Info])!;

describe("the OVPF's texts", () => {
  it("read the alert they name, as the plan names it, never from an end of alert", () => {
    expect(levelSaid(DEBUT)).toBe("Alerte 2-1");
    expect(levelSaid(SUITE)).toBe("Alerte 2-1");
    expect(levelSaid(NIVEAU)).toBe("Alerte 2-2");
    expect(levelSaid("🌋Le front de coulée continue sa propagation. ▶️ Alerte 2-2 en cours")).toBe("Alerte 2-2");
    expect(levelSaid("Fin de l'alerte 1 au Piton de la Fournaise")).toBeUndefined();
    expect(levelSaid(BULLETIN)).toBeUndefined();
  });

  it("read an eruption going on, its end first, and nothing from a review or a denial", () => {
    for (const t of [DEBUT, SUITE, PHASE, REPRISE]) expect(eruptionSaid(t)).toBe(true);
    for (const t of [ARRET, SANS_LIEN, "▶️ Communiqué OVPF-IPGP - 25/03/2026 - 18h30 🛑 Arrêt de l'éruption au Piton de la Fournaise ce jour vers 16h30"]) expect(eruptionSaid(t)).toBe(false);
    for (const t of [BULLETIN, NIVEAU, "Anticiper une éruption : ce que le réveil du piton de la Fournaise nous apprend", "Il n'y a pas d'éruption en cours"]) expect(eruptionSaid(t)).toBeUndefined();
  });
});

describe("the state from the official texts", () => {
  const ALERTE_1 = release("Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", "2026-02-13");

  it("takes a higher level from the OVPF's text newer than the release, with the post", () => {
    const debut = post(DEBUT, "2026-02-13T06:45:58.423Z");
    expect(officiel(ALERTE_1, [debut])).toEqual({
      niveau: "Alerte 2-1",
      eruption: true,
      prefecture: ALERTE_1,
      niveauOvpf: { date: debut.date, lien: debut.lien },
      eruptionOvpf: { date: debut.date, lien: debut.lien, en_cours: true },
    });
  });

  it("never comes down on the OVPF's word, nor reads its posts older than the release's day or in images", () => {
    const eruption = release("Piton de la Fournaise : passage en alerte 2-2, éruption en cours", "2026-03-12");
    // « Niveau d'alerte : 2.1 » after a release at 2-2: the release's level.
    expect(officiel(eruption, [post(SUITE, "2026-03-13T04:00:00Z")]).niveau).toBe("Alerte 2-2");
    expect(officiel(eruption, [post(SUITE, "2026-03-13T04:00:00Z")])).not.toHaveProperty("niveauOvpf");
    // A level the day before the release: not read.
    expect(officiel(ALERTE_1, [post(NIVEAU, "2026-02-12T04:00:00Z")])).toEqual({ niveau: "Alerte 1", eruption: false, prefecture: ALERTE_1 });
    // A post in images: not read here (OCR is another matter).
    expect(officiel(ALERTE_1, [post(DEBUT, "2026-02-13T06:45:58.423Z", true)]).niveau).toBe("Alerte 1");
  });

  it("ends the eruption on the OVPF's « arrêt de l'éruption », the level the release's until the next", () => {
    const eruption = release("Piton de la Fournaise : passage en alerte 2-2, éruption en cours", "2026-03-12");
    const arret = post(ARRET, "2026-04-13T02:10:39.411Z");
    // Newest first, as the feed gives them.
    const o = officiel(eruption, [arret, post(PHASE, "2026-04-12T03:10:00Z"), post(NIVEAU, "2026-04-02T02:37:00Z")]);
    expect(o).toMatchObject({ niveau: "Alerte 2-2", eruption: false, eruptionOvpf: { en_cours: false, date: arret.date } });
    expect(o).not.toHaveProperty("niveauOvpf");
  });

  it("without any phase of the prefecture, reads the OVPF's texts of the last three days only", () => {
    const now = new Date("2026-02-14T06:00:00Z");
    expect(officiel(undefined, [post(DEBUT, "2026-02-13T06:45:58.423Z")], now)).toMatchObject({ niveau: "Alerte 2-1", eruption: true });
    expect(officiel(undefined, [post(NIVEAU, "2026-02-01T06:00:00Z")], now)).toEqual({ niveau: undefined, eruption: false });
  });
});
