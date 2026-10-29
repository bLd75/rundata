/**
 * La Poste's postcodes of La Réunion (geo.api.gouv.fr, read on 29/10/2026): 37, each of one commune only. No CEDEX
 * among them, and never an INSEE code: 97411 is Saint-Paul's postcode, and Saint-Denis's INSEE code.
 */
import { resolvePlace } from "./resolve.js";

export const CODES_POSTAUX: Record<string, string> = { "97400": "Saint-Denis", "97410": "Saint-Pierre", "97411": "Saint-Paul", "97412": "Bras-Panon", "97413": "Cilaos", "97414": "Entre-Deux", "97416": "Saint-Leu", "97417": "Saint-Denis", "97418": "Le Tampon", "97419": "La Possession", "97420": "Le Port", "97421": "Saint-Louis", "97422": "Saint-Paul", "97423": "Saint-Paul", "97424": "Saint-Leu", "97425": "Les Avirons", "97426": "Les Trois-Bassins", "97427": "L'Étang-Salé", "97429": "Petite-Île", "97430": "Le Tampon", "97431": "La Plaine-des-Palmistes", "97432": "Saint-Pierre", "97433": "Salazie", "97434": "Saint-Paul", "97435": "Saint-Paul", "97436": "Saint-Leu", "97437": "Saint-Benoît", "97438": "Sainte-Marie", "97439": "Sainte-Rose", "97440": "Saint-André", "97441": "Sainte-Suzanne", "97442": "Saint-Philippe", "97450": "Saint-Louis", "97460": "Saint-Paul", "97470": "Saint-Benoît", "97480": "Saint-Joseph", "97490": "Saint-Denis" };

/** A commune named exactly; « SAINT CLOTILDE » read as « Sainte Clotilde » when only that is exact. */
export function communeExacte(name: string): string | undefined {
  for (const n of [name, name.replace(/^SAINT\b/i, "Sainte")]) {
    const r = resolvePlace(n);
    if (r?.correspondance === "exacte" && r.lieu.commune) return r.lieu.commune;
  }
  return undefined;
}

/**
 * The commune of an address given as its postcode and town: the postcode's when La Poste gives it to one commune and
 * the town names no other; for a CEDEX of the island, the town's when it names a commune exactly. The island's CEDEX
 * are 974xx, 977xx and 978xx (97404 and 97719 Saint-Denis, 97829 Le Port, 97864 Saint-Paul in the BOAMP's notices of
 * 29/10/2026); the other overseas departments' codes start with 971, 972, 973, 975 or 976. Never out of the island's
 * codes, whatever the town's name: « LA TRINITE », 97220, is in Martinique, and a quarter of Saint-Denis here.
 */
export function communeAdresse(cp: string | undefined, ville: string | undefined): string | undefined {
  const code = cp?.trim() ?? "";
  if (!/^97[478]\d\d$/.test(code)) return undefined;
  const nom = ville?.replace(/\bCEDEX\b.*$/i, "").replace(/\d+/g, "").trim();
  const named = nom ? communeExacte(nom) : undefined;
  const parCode = CODES_POSTAUX[code];
  if (!parCode) return named;
  return !named || named === parCode ? parCode : undefined;
}

/**
 * The commune of a place as the site writes it, only when it names one exactly: « 97408-ST DENIS CEDEX 9 » →
 * Saint-Denis, « 97438-STE MARIE » → Sainte-Marie. In an address, from its postcode when La Poste gives it to one
 * commune, and the name after it, if any, the same: « 24 avenue Georges Brassens 97400 Saint-Denis », « Rue LA
 * BOURDONNAIS 97400 ILE DE LA REUNION » → Saint-Denis. Never from a CEDEX nor a code out of La Poste's: 97408 is a CEDEX
 * of Saint-Denis, and the INSEE code of La Possession. « CHU SITES SUD » names none.
 */
export function communeDe(lieu: string | undefined): string | undefined {
  const name = lieu?.replace(/^\d{5}\s*-\s*/, "").replace(/\bCEDEX\b.*$/i, "").trim();
  if (!name) return undefined;
  const named = communeExacte(name);
  if (named || /\bCEDEX\b/i.test(lieu!)) return named;
  const m = /\b(974\d\d)\b([^\d]*)$/.exec(lieu!);
  const commune = m ? CODES_POSTAUX[m[1]] : undefined;
  if (!commune) return undefined;
  const after = m![2].replace(/\b(?:(?:[iî]le de )?la r[ée]union|france)\b/gi, "").replace(/[\s,.()-]+/g, " ").trim();
  return !after || communeExacte(after) === commune ? commune : undefined;
}
