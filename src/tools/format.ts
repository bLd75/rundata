import { ageMinutes, ageText, compass, localTime, versant } from "../geo.js";
import type { Resolution } from "../places/resolve.js";
import type { Reading, SourceInfo } from "../types.js";

/** One reading as a short string a model can quote: "24 °C", "ESE (112°)", "65 % (calculée)". */
/** A number written the French way: 24,6. */
export function fr(n: number): string {
  return String(n).replace(".", ",");
}

/** « de Saint-Paul », « du Tampon », « des Avirons », « de L'Étang-Salé ». */
export function de(nom: string): string {
  return nom.replace(/^Le /, "du ").replace(/^Les /, "des ").replace(/^(?!du |des )/, "de ");
}

export function show(r: Reading): string {
  if (r.variable === "vent_direction" && typeof r.valeur === "number") return `${compass(r.valeur)} (${r.valeur}°)`;
  const v = typeof r.valeur === "number" ? fr(r.valeur) : r.valeur;
  const unit = r.unite ? ` ${r.unite}` : "";
  return `${v}${unit}${r.nature === "derive" ? " (calculée)" : ""}`;
}

export function when(time: Date, now: Date) {
  const age = ageMinutes(time, now);
  // Models otherwise tend to read a bare "09:00" as UTC.
  return { heure_mesure: localTime(time), fuseau: "heure de La Réunion (UTC+4)", age_min: age, age_texte: ageText(age) };
}

export function placeBlock(asked: string, r: Resolution) {
  const p = r.lieu;
  return {
    demande: asked,
    trouve: p.nom,
    type: p.type,
    commune: p.commune || undefined,
    altitude_m: p.altitude_m ?? undefined,
    versant: versant(p.lon, p.lat),
    correspondance: r.correspondance,
    autres_possibilites: r.autres.length ? r.autres.map((a) => `${a.nom} (${a.type}, ${a.commune})`) : undefined,
  };
}

export function credits(sources: SourceInfo[]) {
  return sources.map((s) => ({ source: s.nom, licence: s.licence, attribution: s.attribution }));
}

export function text(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 1) }] };
}

export function notFound(asked: string) {
  return {
    ...text({
      erreur: `Lieu introuvable à La Réunion : « ${asked} ».`,
      conseil:
        "Donner une commune (Saint-Paul, Cilaos…), une plage (Boucan Canot, l'Hermitage…), un quartier, un sommet, " +
        "ou des coordonnées « latitude, longitude » (ex. « -21.05, 55.22 »).",
    }),
    isError: true,
  };
}
