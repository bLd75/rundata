import { ageMinutes, ageText, compass, localTime, versant } from "../geo.js";
import type { Resolution } from "../places/resolve.js";
import { withMentions } from "../mentions.js";
import type { Reading, SourceInfo } from "../types.js";

/**
 * A time of day, in minutes since midnight, as every answer writes it: « 19:12 » with its minutes, « 18\u00a0h » on the
 * hour (« 24\u00a0h » for the end of a day). Never « 18h », nor « 19 h 12 ».
 */
export function heure(minutes: number): string {
  const [h, m] = [Math.floor(minutes / 60), minutes % 60];
  return m ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` : `${h}\u00a0h`;
}

/**
 * Two times said together (a span, « entre … et … »): « 18\u00a0h » and « 21\u00a0h », or both « 12:00 », « 12:54 » when
 * one has minutes, or when `minutes` says another time of the same place has some (minutees()).
 */
export function paire(de: number, a: number, minutes = de % 60 !== 0 || a % 60 !== 0): [string, string] {
  if (!minutes) return [heure(de), heure(a)];
  const hm = (x: number) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  return [hm(de), hm(a)];
}

/** A span: « 18\u00a0h–21\u00a0h », « 08:30–12:00 ». */
export const tranche = (de: number, a: number, minutes?: boolean) => paire(de, a, minutes).join("–");

/**
 * Whether the hours of one place are all written with their minutes (kit.md): as soon as one of its times has some,
 * « 06:00 à 18:30 ; le dimanche de 06:00 à 12:00 », never « de 6\u00a0h à 12\u00a0h » beside it.
 */
export const minutees = (spans: [number, number][]) => spans.some(([de, a]) => de % 60 !== 0 || a % 60 !== 0);

/** One reading as a short string a model can quote: "24 °C", "ESE (112°)", "65 % (calculée)". */
/** A number written the French way: 24,6. */
export function fr(n: number): string {
  return String(n).replace(".", ",");
}

/**
 * A quantity with its thousands, as toLocaleString("fr-FR") writes them: « 3\u202f210 », from 4 digits, a narrow
 * no-break space that never cuts the number at a line's end (marketing's kit, « Nombres »). Never for a year, a
 * postcode, an INSEE code, a parcel, a bus line or a phone number; a JSON number stays a number.
 */
export function nombre(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 20 }).replace(/\s/g, "\u202f");
}

/** « de Saint-Paul », « du Tampon », « des Avirons », « de L'Étang-Salé ». */
export function de(nom: string): string {
  return nom.replace(/^Le /, "du ").replace(/^Les /, "des ").replace(/^(?!du |des )/, "de ");
}

/** « Saint-Denis, Saint-Paul et Salazie ». */
export function enumeration(xs: string[]): string {
  return xs.length > 1 ? `${xs.slice(0, -1).join(", ")} et ${xs.at(-1)}` : xs.join("");
}

/** « à Saint-Paul », « au Tampon », « aux Avirons », « à L'Étang-Salé ». */
export function a(nom: string): string {
  return nom.replace(/^Le /, "au ").replace(/^Les /, "aux ").replace(/^(?!au |aux )/, "à ");
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

// Every source credited so far, by name: what the citation of an answer is made from (citer.ts).
const CREDITED = new Map<string, SourceInfo>();

export const credited = (nom: string) => CREDITED.get(nom);

export function credits(sources: SourceInfo[]) {
  for (const s of sources) CREDITED.set(s.nom, s);
  return sources.map((s) => ({ source: s.nom, licence: s.licence, attribution: s.attribution }));
}

/** A tool's answer, each link to a site that asks for it with its mention beside it (mentions.ts). */
export function text(payload: unknown) {
  return { content: [{ type: "text" as const, text: withMentions(payload) }] };
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
