/**
 * The shark rule at sea: the prefect's yearly decree on bathing and wave sports in the 300 m band, and the zones
 * where they stay allowed (lagoons, rock pools, nets, the ZONEX). Fixed data in the package, read by hand: the
 * decree is signed again each February (the next one around 13 February 2027). No feed says whether a net or a
 * ZONEX is open today (the Centre Sécurité Requin tells it in Instagram stories), so an answer never says so: the
 * flag on the spot does. Once the decree has ended, nothing is said permitted or forbidden on its strength.
 */
import { distanceKm } from "../geo.js";
import type { SourceInfo } from "../types.js";

export const RAA_URL =
  "https://www.reunion.gouv.fr/Publications/Publications-administratives-et-legales/Recueil-des-actes-administratifs-RAA/" +
  "Recueil-des-actes-administratifs-2026/Special-n-35-du-13-fevrier-2026";

export const ARRETE = {
  numero: "180",
  signe: "2026-02-13",
  du: "2026-02-16",
  /** The last day it applies (article 3). */
  au: "2027-02-15",
  recueil: "recueil des actes administratifs spécial n° 35 du 13 février 2026",
  url: RAA_URL,
};

export const CSR_URL = "https://www.securite-requin.re/section/les-zones-de-pratique";

export const SOURCE: SourceInfo = {
  id: "risque_requin",
  nom: "Arrêté préfectoral n° 180 du 13 février 2026 (baignade et activités nautiques, bande des 300 m) et zones du Centre Sécurité Requin",
  organisme: "Préfecture de La Réunion\u00a0; Centre Sécurité Requin (GIP)",
  licence: "Information publique (reunion.gouv.fr, securite-requin.re)",
  attribution: "Préfecture de La Réunion, Centre Sécurité Requin",
  url: RAA_URL,
};

/** « interdit » : a pool closed by its commune, whatever the prefect's decree says. */
export type ZoneType = "lagon" | "bassin" | "filet" | "zonex" | "interdit";

export interface Zone {
  nom: string;
  type: ZoneType;
  commune: string;
  lon: number;
  lat: number;
}

/** As the Centre Sécurité Requin lists them (les-zones-de-pratique, les-lagons-et-bassins, la-water-patrol). */
export const ZONES: Zone[] = [
  { nom: "Lagon de l'Hermitage", type: "lagon", commune: "Saint-Paul", lon: 55.2265, lat: -21.0743 },
  { nom: "Lagon de Saint-Leu", type: "lagon", commune: "Saint-Leu", lon: 55.2882, lat: -21.1678 },
  { nom: "Lagon de Saint-Pierre", type: "lagon", commune: "Saint-Pierre", lon: 55.4663, lat: -21.342 },
  { nom: "Bassin de Boucan-Canot", type: "bassin", commune: "Saint-Paul", lon: 55.2239, lat: -21.0298 },
  { nom: "Bassin de Manapany", type: "bassin", commune: "Saint-Joseph", lon: 55.5882, lat: -21.3733 },
  { nom: "Bassin du Baril", type: "bassin", commune: "Saint-Philippe", lon: 55.7147, lat: -21.3707 },
  { nom: "Boucan-Canot", type: "filet", commune: "Saint-Paul", lon: 55.2239, lat: -21.0298 },
  { nom: "Roches Noires", type: "filet", commune: "Saint-Paul", lon: 55.2232, lat: -21.0529 },
  { nom: "L'Étang-Salé", type: "filet", commune: "L'Étang-Salé", lon: 55.3277, lat: -21.2605 },
  { nom: "ZONEX de Saint-Leu", type: "zonex", commune: "Saint-Leu", lon: 55.2882, lat: -21.1678 },
  { nom: "Bassin de Grand-Anse", type: "interdit", commune: "Petite-Île", lon: 55.5482, lat: -21.37 },
];

/** A beach this close to a zone is told about it. */
export const NEAR_KM = 3;

/** marketing's words, as given. */
export const T = {
  regle:
    "À La Réunion, la baignade et les activités de vague (surf, bodyboard, bodysurf, longboard, paddleboard) sont interdites dans la bande des 300 m " +
    "de tout le littoral. Exceptions, dans les conditions fixées par les communes : les lagons et platiers, les espaces aménagés et surveillés, " +
    "et les ZONEX quand elles sont ouvertes et surveillées. Arrêté préfectoral n° 180 du 13/02/2026, en vigueur jusqu'au 15/02/2027.",
  reduit: "Ces zones réduisent le risque requin, elles ne le suppriment pas.",
  intro: "Zones citées par le Centre Sécurité Requin (securite-requin.re) :",
  ouverture: "Nous ne savons pas si une zone est ouverte aujourd'hui : regardez le drapeau sur place.",
  drapeaux: "Pas de drapeau : zone non surveillée, baignade interdite. Flamme requin hissée : baignade interdite sur la zone.",
  source: "Zones d'après le Centre Sécurité Requin.",
  autres: "Le Centre Sécurité Requin ne cite pas de zone dans les autres communes.",
  echu:
    "L'arrêté préfectoral n° 180 sur la baignade et les activités de vague a pris fin le 15/02/2027. " +
    "Nous n'avons pas encore lu celui qui le remplace : vérifiez la règle en vigueur sur reunion.gouv.fr.",
  h2: "Baignade et requins",
  lien: "Toutes les zones et la règle",
};

const LINE: Record<ZoneType, (nom: string) => string> = {
  lagon: (n) => `${n} : lagon, baignade permise dans les conditions fixées par la commune (arrêté préfectoral n° 180, art. 2).`,
  bassin: (n) => `${n} : bassin aménagé, baignade permise seulement quand il est ouvert et surveillé.`,
  filet: (n) => `${n} : zone de baignade fermée par un filet, permise seulement quand elle est ouverte et surveillée.`,
  zonex: (n) => `${n} : zone où la baignade et les activités de vague sont permises seulement quand elle est ouverte et surveillée (Water Patrol).`,
  interdit: (n) => `${n} : baignade interdite par arrêté municipal depuis 2014.`,
};

/** Once the decree has ended: the kind of zone only, nothing permitted on its strength. The commune's ban stays. */
const KIND: Record<ZoneType, (nom: string) => string> = {
  lagon: (n) => `${n} : lagon.`,
  bassin: (n) => `${n} : bassin aménagé.`,
  filet: (n) => `${n} : zone de baignade fermée par un filet.`,
  zonex: (n) => `${n} : ZONEX (Water Patrol).`,
  interdit: LINE.interdit,
};

/** Up to the end of the last day of article 3, in Réunion time (UTC+4). */
export function inForce(now: Date): boolean {
  return now.getTime() < Date.parse(`${ARRETE.au}T00:00:00+04:00`) + 86_400_000;
}

/** The zones near a point, nearest first; with a commune, also every zone of that commune. */
export function zonesNear(lon: number, lat: number, commune?: string): (Zone & { km: number })[] {
  return ZONES.map((z) => ({ ...z, km: distanceKm(lon, lat, z.lon, z.lat) }))
    .filter((z) => z.km <= NEAR_KM || (!!commune && z.commune === commune))
    .sort((a, b) => a.km - b.km);
}

export function zoneLine(z: Zone, now: Date): string {
  return (inForce(now) ? LINE : KIND)[z.type](z.nom);
}

/** No zone near the place: where the list comes from, then the rule if it still applies. */
export function noneLine(nom: string, now: Date): string {
  const first = `Aucune zone du Centre Sécurité Requin près de ${nom}.`;
  return inForce(now)
    ? `${first} Hors lagon et espace aménagé et surveillé, la baignade et le surf y sont interdits dans la bande des 300 m (arrêté préfectoral n° 180).`
    : first;
}

/** The rule's paragraph: the decree and what the zones do, or that it has ended. */
export function ruleText(now: Date): string {
  return inForce(now) ? `${T.regle} ${T.reduit}` : T.echu;
}

/** The block of the answers: the rule, the zones (near the place, or all), the flags; never « open today ». */
export function requinBlock(now: Date, near?: { nom: string; lon: number; lat: number; commune?: string }) {
  const zones = near ? zonesNear(near.lon, near.lat, near.commune) : ZONES;
  return {
    regle: ruleText(now),
    zones: zones.length ? [T.intro, ...zones.map((z) => zoneLine(z, now)), T.ouverture] : noneLine(near!.nom, now),
    drapeaux: T.drapeaux,
    source_des_zones: T.source,
    arrete: inForce(now)
      ? { numero: ARRETE.numero, signe_le: ARRETE.signe, applicable_du: ARRETE.du, au: ARRETE.au, texte: ARRETE.url }
      : { consulter: "https://www.reunion.gouv.fr" },
  };
}
