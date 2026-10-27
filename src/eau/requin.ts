/**
 * The shark rule at sea: the prefect's yearly decree on bathing and wave sports in the 300 m band, and the zones
 * where they stay allowed (lagoons, rock pools, nets, the ZONEX). Fixed data in the package, read by hand: the
 * decree is signed again each February (the next one around 13 February 2027). No feed says whether a net or a
 * ZONEX is open today (the GIP Centre Sécurité Requin tells it in its Instagram and Facebook stories), so an answer
 * never says so: the flag on the spot does, and the answer points to those stories. Once the decree has ended,
 * nothing is said permitted or forbidden on its strength.
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

/** The page of its map, the link its written agreement of 27/10/2026 asks for, with « Source : » its name. */
export const CSR_URL = "https://securite-requin.re/section/les-zones-de-pratique";
export const CSR = "GIP Centre Sécurité Requin";
/** Where it announces each day's nets and ZONEX, as its site links them. */
export const STORIES = {
  instagram: "https://www.instagram.com/centresecuriterequin_reunion/",
  facebook: "https://www.facebook.com/centresecuriterequin/",
};

export const SOURCE: SourceInfo = {
  id: "risque_requin",
  nom: `Arrêté préfectoral n° 180 du 13 février 2026 (baignade et activités nautiques, bande des 300 m) et zones du ${CSR}`,
  organisme: `Préfecture de La Réunion\u00a0; ${CSR}`,
  licence: `Information publique (arrêté préfectoral, reunion.gouv.fr)\u00a0; ${CSR} : zones reprises avec son accord écrit du 27/10/2026`,
  attribution: `Préfecture de La Réunion, ${CSR}`,
  url: RAA_URL,
};

/** « filet_ete » : a net put up in the summer only; « bassin_naturel » : a pool the GIP says open again, nothing more. */
export type ZoneType = "lagon" | "bassin" | "bassin_naturel" | "filet" | "filet_ete" | "zonex";

export interface Zone {
  nom: string;
  type: ZoneType;
  commune: string;
  lon: number;
  lat: number;
  /** Who keeps the ZONEX, only where the GIP says so. */
  par?: "BSAN et RESSAC";
}

/**
 * As the GIP Centre Sécurité Requin lists them: its map (les-zones-de-pratique, read on 27/10/2026) and its written
 * corrections of 27/10/2026, by commune from the north-west to the south-east, each commune's from north to south. The
 * map gives no coordinates: they are ours, from the places' gazetteer (src/places/gazetteer.json).
 */
export const ZONES: Zone[] = [
  { nom: "Filet de la baie de Saint-Paul", type: "filet_ete", commune: "Saint-Paul", lon: 55.2589, lat: -20.9868 },
  { nom: "Piscine naturelle de Boucan-Canot", type: "bassin", commune: "Saint-Paul", lon: 55.2239, lat: -21.0298 },
  { nom: "Boucan-Canot", type: "filet", commune: "Saint-Paul", lon: 55.2239, lat: -21.0298 },
  { nom: "ZONEX de Boucan-Canot", type: "zonex", commune: "Saint-Paul", lon: 55.2239, lat: -21.0298 },
  { nom: "ZONEX des Aigrettes", type: "zonex", commune: "Saint-Paul", lon: 55.217, lat: -21.0364 },
  { nom: "Roches Noires", type: "filet", commune: "Saint-Paul", lon: 55.2232, lat: -21.0529 },
  { nom: "ZONEX des Roches Noires", type: "zonex", commune: "Saint-Paul", lon: 55.2232, lat: -21.0529, par: "BSAN et RESSAC" },
  { nom: "ZONEX des Brisants", type: "zonex", commune: "Saint-Paul", lon: 55.2225, lat: -21.0568, par: "BSAN et RESSAC" },
  { nom: "Lagon de l'Hermitage", type: "lagon", commune: "Saint-Paul", lon: 55.2265, lat: -21.0743 },
  { nom: "ZONEX de l'Hermitage", type: "zonex", commune: "Saint-Paul", lon: 55.2235, lat: -21.0854 },
  { nom: "ZONEX de Trois-Bassins", type: "zonex", commune: "Les Trois-Bassins", lon: 55.2534, lat: -21.1125 },
  { nom: "Lagon de Saint-Leu", type: "lagon", commune: "Saint-Leu", lon: 55.2882, lat: -21.1678 },
  { nom: "ZONEX de Saint-Leu (spots « la passe / le port » et « la Gauche »)", type: "zonex", commune: "Saint-Leu", lon: 55.2882, lat: -21.1678, par: "BSAN et RESSAC" },
  { nom: "L'Étang-Salé", type: "filet", commune: "L'Étang-Salé", lon: 55.3277, lat: -21.2605 },
  { nom: "ZONEX de L'Étang-Salé (spot « le bord »)", type: "zonex", commune: "L'Étang-Salé", lon: 55.3277, lat: -21.2605 },
  { nom: "Lagon de Saint-Pierre", type: "lagon", commune: "Saint-Pierre", lon: 55.4663, lat: -21.342 },
  { nom: "Bassin naturel de Grand-Anse", type: "bassin_naturel", commune: "Petite-Île", lon: 55.5482, lat: -21.37 },
  { nom: "Bassin de Manapany", type: "bassin", commune: "Saint-Joseph", lon: 55.5882, lat: -21.3733 },
  { nom: "Piscine du Baril les Bains", type: "bassin", commune: "Saint-Philippe", lon: 55.7147, lat: -21.3707 },
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
  intro: `Zones citées par le ${CSR} (securite-requin.re) :`,
  ouverture: "Nous ne savons pas si une zone est ouverte aujourd'hui : regardez le drapeau sur place.",
  /** Under the zones, once one kept by the BSAN is said. */
  bsan: "BSAN : Brigade de sécurité des activités nautiques.",
  /** Instagram and Facebook carry the links of STORIES on the pages. */
  stories: `Les filets et les ZONEX déployés dans la journée sont annoncés dans les stories Instagram et Facebook du ${CSR}.`,
  drapeaux: "Pas de drapeau : zone non surveillée, baignade interdite. Flamme requin hissée : baignade interdite sur la zone.",
  source: `Source : ${CSR}`,
  autres: `Le ${CSR} ne cite pas de zone dans les autres communes.`,
  echu:
    "L'arrêté préfectoral n° 180 sur la baignade et les activités de vague a pris fin le 15/02/2027. " +
    "Nous n'avons pas encore lu celui qui le remplace : vérifiez la règle en vigueur sur reunion.gouv.fr.",
  h2: "Baignade et requins",
  lien: "Toutes les zones et la règle",
};

/** Said the same before and after the decree: it comes from the GIP, not from the decree. */
const reopened = (z: Zone) => `${z.nom} : de nouveau ouvert au public, d'après le ${CSR} (27/10/2026).`;

const LINE: Record<ZoneType, (z: Zone) => string> = {
  lagon: (z) => `${z.nom} : lagon, baignade permise dans les conditions fixées par la commune (arrêté préfectoral n° 180, art. 2).`,
  bassin: (z) => `${z.nom} : bassin, baignade permise seulement quand il est ouvert et surveillé.`,
  bassin_naturel: reopened,
  filet: (z) => `${z.nom} : zone de baignade fermée par un filet, permise seulement quand elle est ouverte et surveillée.`,
  filet_ete: (z) => `${z.nom} : filet de baignade ponctuel, déployé en été\u00a0; baignade permise seulement quand il est ouvert et surveillé.`,
  zonex: (z) => `${z.nom} : ZONEX, zone où la baignade et les activités de vague sont permises seulement quand elle est ouverte et surveillée${z.par ? ` (${z.par})` : ""}.`,
};

/** Once the decree has ended: the kind of zone only, nothing permitted on its strength. What the GIP says stays. */
const KIND: Record<ZoneType, (z: Zone) => string> = {
  lagon: (z) => `${z.nom} : lagon.`,
  bassin: (z) => `${z.nom} : bassin.`,
  bassin_naturel: reopened,
  filet: (z) => `${z.nom} : zone de baignade fermée par un filet.`,
  filet_ete: (z) => `${z.nom} : filet de baignade ponctuel, déployé en été.`,
  zonex: (z) => `${z.nom} : ZONEX.`,
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

/** Whether T.bsan goes under these zones: once one is said with the BSAN (marketing). */
export const saysBsan = (zones: Zone[], now: Date) => inForce(now) && zones.some((z) => z.par);

/** The lines of a list of zones, then T.bsan if it goes under them. */
export function zoneLines(zones: Zone[], now: Date): string[] {
  return [...zones.map((z) => zoneLine(z, now)), ...(saysBsan(zones, now) ? [T.bsan] : [])];
}

export function zoneLine(z: Zone, now: Date): string {
  return (inForce(now) ? LINE : KIND)[z.type](z);
}

/** No zone near the place: where the list comes from, then the rule if it still applies. */
export function noneLine(nom: string, now: Date): string {
  const first = `Aucune zone du ${CSR} près de ${nom}.`;
  return inForce(now)
    ? `${first} Hors lagon et espace aménagé et surveillé, la baignade et le surf y sont interdits dans la bande des 300 m (arrêté préfectoral n° 180).`
    : first;
}

/** The rule's paragraph: the decree and what the zones do, or that it has ended. */
export function ruleText(now: Date): string {
  return inForce(now) ? `${T.regle} ${T.reduit}` : T.echu;
}

/** The block of the answers: the rule, the zones (near the place, or all), where the day's zones are told, the flags; never « open today ». */
export function requinBlock(now: Date, near?: { nom: string; lon: number; lat: number; commune?: string }) {
  const zones = near ? zonesNear(near.lon, near.lat, near.commune) : ZONES;
  return {
    regle: ruleText(now),
    zones: zones.length ? [T.intro, ...zoneLines(zones, now), T.ouverture] : noneLine(near!.nom, now),
    deploiements_du_jour: { texte: T.stories, ...STORIES },
    drapeaux: T.drapeaux,
    source_des_zones: { texte: T.source, lien: CSR_URL },
    arrete: inForce(now)
      ? { numero: ARRETE.numero, signe_le: ARRETE.signe, applicable_du: ARRETE.du, au: ARRETE.au, texte: ARRETE.url }
      : { consulter: "https://www.reunion.gouv.fr" },
  };
}
