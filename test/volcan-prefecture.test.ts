import { describe, expect, it, vi } from "vitest";
import { phaseOf, type PitonState } from "../src/providers/volcan.js";
import { nonOfficiel, officiel } from "../src/tools/volcan.js";
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
  it("gives the level and the Enclos alone, whatever pitonlive says (the user, 25/10/2026)", () => {
    const p = phaseOf([release("Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", "2026-10-24")])!;
    expect(officiel(p, null)).toEqual({ niveau: "Alerte 1", eruption: false, prefecture: p });
    // An older vigilance of the prefecture, pitonlive's newer status at the same level: the release's, nothing of pitonlive.
    const may = phaseOf([release("Piton de la Fournaise : retour en vigilance, réouverture partielle de l'enclos", "2026-05-07")])!;
    expect(officiel(may, null).niveau).toBe("Vigilance");
    expect(nonOfficiel(piton, new Date("2026-10-20T08:00:00Z"), officiel(may, null))).toBeUndefined();
  });

  it("never lets pitonlive's higher level win: a line of its own, read at its time", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const up = { ...piton, status: { ...piton.status, alert_level: "alerte 2-1", alert_level_display: "Alerte 2-1", is_erupting: true } };
    const o = officiel(phaseOf([release("Piton de la Fournaise : passage en alerte 1", "2026-10-10")])!, null);
    expect(o).toMatchObject({ niveau: "Alerte 1", eruption: false });
    expect(nonOfficiel(up, new Date("2026-10-20T10:28:00Z"), o)).toEqual({ niveau: "Alerte 2-1", eruption: true, lu: "20/10 à 14:28" });
    // Published before the release's day: an old status, nothing said.
    expect(nonOfficiel(up, new Date("2026-10-20T10:28:00Z"), officiel(phaseOf([release("Piton de la Fournaise : passage en alerte 1", "2026-10-20")])!, null))).toBeUndefined();
    logged.mockRestore();
  });

  it("never comes down on pitonlive's word: nothing said of its lower level, only logged", () => {
    const alert = phaseOf([release("Piton de la Fournaise : passage en alerte 1", "2026-10-18")])!;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const o = officiel(alert, null, new Date("2026-10-21T13:00:00Z"));
    expect(o.niveau).toBe("Alerte 1");
    expect(nonOfficiel(piton, new Date("2026-10-21T13:00:00Z"), o)).toBeUndefined();
    expect(logged).toHaveBeenCalledWith(expect.stringMatching(/^volcan : niveau officiel Alerte 1, pitonlive Vigilance \(2026-10-19/));
    logged.mockRestore();
  });

  it("gives pitonlive's alert, as its own, only when no official level was read nor kept; never its « Vigilance »", () => {
    const at = (alert_level_display: string) => ({ ...piton, status: { ...piton.status, alert_level_display } });
    expect(nonOfficiel(at("Alerte 1"), new Date("2026-10-21T13:00:00Z"), officiel(undefined, null))).toEqual({ niveau: "Alerte 1", lu: "21/10 à 17:00" });
    // It follows the prefecture by hours or days: « Vigilance » alone is never said.
    expect(nonOfficiel(piton, new Date("2026-10-21T13:00:00Z"), officiel(undefined, null))).toBeUndefined();
    // Its raw label, unknown to the plan: nothing.
    expect(nonOfficiel(at("niveau inconnu"), new Date("2026-10-21T13:00:00Z"), officiel(undefined, null))).toBeUndefined();
  });

  it("puts Sauvegarde below the alerts, as the plan does: the eruption over, the Enclos still closed", () => {
    const at = (alert_level_display: string, published_at = "2026-10-26T08:00:00Z") => ({ ...piton, status: { ...piton.status, alert_level: alert_level_display.toLowerCase(), alert_level_display, published_at } });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const eruption = phaseOf([release("Piton de la Fournaise : passage en alerte 2-1, éruption en cours dans l'enclos", "2026-10-25")])!;
    // pitonlive's newer « Sauvegarde » does not end the prefecture's alert 2, nor is said.
    expect(officiel(eruption, null)).toMatchObject({ niveau: "Alerte 2-1", eruption: true });
    expect(nonOfficiel(at("Sauvegarde"), new Date("2026-10-26T09:00:00Z"), officiel(eruption, null))).toBeUndefined();
    // A newer alert of pitonlive above the prefecture's Sauvegarde: said as its own, the level the prefecture's.
    const over = phaseOf([release("Piton de la Fournaise : fin de l'éruption, passage en phase de sauvegarde", "2026-10-25")])!;
    expect(over).toMatchObject({ niveau: "Sauvegarde", enclos: "ferme" });
    expect(officiel(over, null).niveau).toBe("Sauvegarde");
    expect(nonOfficiel(at("Alerte 1"), new Date("2026-10-26T09:00:00Z"), officiel(over, null))?.niveau).toBe("Alerte 1");
    expect(phaseOf([release("Piton de la Fournaise : passage en alerte 2-3, éruption hors enclos", "2026-10-25")])).toMatchObject({ niveau: "Alerte 2-3", eruption: true });
    logged.mockRestore();
  });

  it("reads the end of an alert as a return to vigilance, never as the alert it names", () => {
    expect(phaseOf([release("Piton de la Fournaise : fin de l'alerte 1", "2026-10-30")])).toMatchObject({ niveau: "Vigilance" });
    expect(phaseOf([release("Piton de la Fournaise : fin d’alerte, l'enclos rouvert", "2026-10-30")])).toMatchObject({ niveau: "Vigilance", enclos: "ouvert" });
    expect(phaseOf([release("Volcan : levée de l'alerte 2-1", "2026-10-30")])).toMatchObject({ niveau: "Vigilance", eruption: false });
    expect(phaseOf([release("Piton de la Fournaise : retour en vigilance", "2026-10-30")])).toMatchObject({ niveau: "Vigilance" });
  });
});
