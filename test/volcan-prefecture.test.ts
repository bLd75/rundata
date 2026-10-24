import { describe, expect, it, vi } from "vitest";
import { phaseOf, type PitonState } from "../src/providers/volcan.js";
import { official } from "../src/tools/volcan.js";
import type { Info } from "../src/providers/actualites.js";

const release = (titre: string, day: string): Info =>
  ({ titre, lien: `https://www.reunion.gouv.fr/x/${day}`, publie: new Date(`${day}T12:00:00+04:00`).toISOString(), media: "Préfecture de La Réunion", heure: false, communes: [], lieux: [], sujets: [] }) as Info;

const piton: PitonState = {
  status: { alert_level: "vigilance", alert_level_display: "Vigilance", is_erupting: false, published_at: "2026-10-19T12:03:16Z" },
  eruption: null,
  last_eruption_ended_at: "2026-04-12T00:00:00Z",
  access: { current: { available: true, global_status: "partiel", enclos_status: "partiel", summary: "Réouverture partielle" } },
};

describe("the prefecture's phase of the ORSEC volcano plan", () => {
  it("reads alert 1 and the closed Enclos from the newest release about the volcano", () => {
    const p = phaseOf([release("Violences urbaines : bilan de la nuit", "2026-10-24"), release("Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", "2026-10-24"), release("Piton de la Fournaise : retour en vigilance", "2026-05-07")]);
    expect(p).toMatchObject({ niveau: "Alerte 1", eruption: false, enclos: "ferme" });
  });
  it("reads an eruption from alert 2", () => {
    expect(phaseOf([release("Piton de la Fournaise : passage en alerte 2-1, éruption en cours dans l'enclos", "2026-10-25")])).toMatchObject({ niveau: "Alerte 2-1", eruption: true, enclos: "ferme" });
  });
  it("reads a partial reopening", () => {
    expect(phaseOf([release("Piton de la Fournaise : retour en phase de vigilance, réouverture partielle de l'enclos", "2026-05-07")])).toMatchObject({ niveau: "Vigilance", enclos: "partiel" });
  });
  it("skips a newer release about the volcano that declares no phase", () => {
    expect(phaseOf([release("Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", "2026-10-24"), release("Piton de la Fournaise : point de situation", "2026-10-25")])).toMatchObject({ niveau: "Alerte 1" });
  });
  it("declares nothing from a release that names no phase", () => {
    expect(phaseOf([release("Fournaise : conférence à la Cité du Volcan", "2026-10-24")])).toBeUndefined();
  });
  it("wins over pitonlive when as recent or more, and not when older", () => {
    const p = phaseOf([release("Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", "2026-10-24")])!;
    const s = official(piton, p);
    expect(s.status.alert_level_display).toBe("Alerte 1");
    expect(s.access?.current?.enclos_status).toBe("ferme");
    // An older vigilance of the prefecture: pitonlive's newer status wins, at the same level.
    const may = phaseOf([release("Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos", "2026-05-07")])!;
    expect(official(piton, may)).toBe(piton);
    // A newer status of pitonlive at a higher level wins too.
    const up = { ...piton, status: { ...piton.status, alert_level: "alerte 2-1", alert_level_display: "Alerte 2-1", is_erupting: true } };
    expect(official(up, phaseOf([release("Piton de la Fournaise : passage en alerte 1", "2026-10-10")])!).status.alert_level_display).toBe("Alerte 2-1");
  });

  it("never comes down on pitonlive's word alone: the prefecture's alert holds until its release ends it", () => {
    const alert = phaseOf([release("Piton de la Fournaise : passage en alerte 1", "2026-10-18")])!;
    // pitonlive at « Vigilance » since the 19th, a day after the release: the alert holds, nothing said beside it yet.
    const day = official(piton, alert, new Date("2026-10-20T12:00:00Z"));
    expect(day.status.alert_level_display).toBe("Alerte 1");
    expect(day.ecart).toBeUndefined();
  });

  it("says both levels once pitonlive's lower one has held more than 48 hours, and logs it", () => {
    const alert = phaseOf([release("Piton de la Fournaise : passage en alerte 1", "2026-10-18")])!;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = official(piton, alert, new Date("2026-10-21T13:00:00Z"));
    expect(s.status.alert_level_display).toBe("Alerte 1");
    expect(s.ecart).toEqual({ niveau: "Vigilance", depuis: "2026-10-19T12:03:16Z" });
    expect(logged).toHaveBeenCalledWith(expect.stringMatching(/^volcan : la préfecture dit Alerte 1 .*pitonlive Vigilance depuis 2026-10-19/));
    logged.mockRestore();
  });

  it("reads the end of an alert as a return to vigilance, never as the alert it names", () => {
    expect(phaseOf([release("Piton de la Fournaise : fin de l'alerte 1", "2026-10-30")])).toMatchObject({ niveau: "Vigilance" });
    expect(phaseOf([release("Piton de la Fournaise : fin d’alerte, l'enclos rouvert", "2026-10-30")])).toMatchObject({ niveau: "Vigilance", enclos: "ouvert" });
    expect(phaseOf([release("Volcan : levée de l'alerte 2-1", "2026-10-30")])).toMatchObject({ niveau: "Vigilance", eruption: false });
    expect(phaseOf([release("Piton de la Fournaise : retour en vigilance", "2026-10-30")])).toMatchObject({ niveau: "Vigilance" });
  });
});
