import { describe, expect, it } from "vitest";
import { resolvePlace } from "../src/places/resolve.js";

const name = (q: string) => resolvePlace(q)?.lieu.nom;

describe("resolvePlace", () => {
  it.each([
    ["plage de l'Hermitage", "Plage de l'Ermitage-les-Bains"],
    ["Hermitage", "Plage de l'Ermitage-les-Bains"],
    ["cilaos", "Cilaos"],
    ["St Pierre", "Saint-Pierre"],
    ["plage de Saint-Pierre", "Plage de Saint-Pierre"],
    ["Saint-Gilles", "Saint-Gilles-les-Bains"],
    ["Boucan Canot", "Boucan-Canot"],
    ["plage de Boucan Canot", "Plage de Boucan-Canot"],
    ["le Maïdo", "Maïdo"],
    ["Mafate", "La Nouvelle"],
    ["volcan", "Pas de Bellecombe - Jacob"],
    ["Le Port", "Le Port"],
    ["Etang Salé", "L'Étang-Salé"],
    ["salazie", "Salazie"],
    ["Saint-Denis", "Saint-Denis"],
  ])("%s → %s", (q, expected) => {
    expect(name(q)).toBe(expected);
  });

  it.each([
    ["Gillot", "Aéroport de la Réunion Roland-Garros", "Sainte-Marie"],
    ["aéroport de Gillot", "Aéroport de la Réunion Roland-Garros", "Sainte-Marie"],
    ["aéroport Roland Garros", "Aéroport de la Réunion Roland-Garros", "Sainte-Marie"],
    ["l'aéroport Roland-Garros", "Aéroport de la Réunion Roland-Garros", "Sainte-Marie"],
    ["aéroport de Pierrefonds", "Aéroport de Saint-Pierre - Pierrefonds", "Saint-Pierre"],
    ["aeroport pierrefonds", "Aéroport de Saint-Pierre - Pierrefonds", "Saint-Pierre"],
  ])("the airport %s → %s (%s)", (q, expected, commune) => {
    const r = resolvePlace(q)!;
    expect(r.lieu.nom).toBe(expected);
    expect(r.lieu.commune).toBe(commune);
  });

  it("keeps Pierrefonds the place apart from its airport", () => {
    expect(name("Pierrefonds")).toBe("Pierrefonds");
  });

  it("tolerates typos", () => {
    expect(name("Cilaoss")).toBe("Cilaos");
    expect(name("Sainte Suzane")).toBe("Sainte-Suzanne");
  });

  it("accepts coordinates in either order", () => {
    const a = resolvePlace("-21.05, 55.22")!;
    expect(a.correspondance).toBe("coordonnees");
    expect(a.lieu.lat).toBeCloseTo(-21.05);
    expect(resolvePlace("55.22 -21.05")!.lieu.lon).toBeCloseTo(55.22);
  });

  it("rejects places outside Réunion and nonsense", () => {
    expect(resolvePlace("48.85, 2.35")).toBeNull();
    expect(resolvePlace("zzzzqqq")).toBeNull();
  });

  it("knows the altitude, so that Cilaos is not treated as a seaside town", () => {
    expect(resolvePlace("Cilaos")!.lieu.altitude_m).toBeGreaterThan(1100);
  });
});
