import type { Cache } from "../cache.js";
import { resolvePlace } from "../places/resolve.js";
import * as terrain from "../providers/terrain.js";
import { why } from "../types.js";
import { credits, fr, text } from "./format.js";

// What a PLU zone letter means (code de l'urbanisme, articles R151-18 to R151-25).
const ZONE_TYPES: Record<string, string> = {
  U: "zone urbaine (U) : en principe constructible, selon le règlement de la zone",
  AUc: "zone à urbaniser (AU) ouverte : constructible dans le cadre d'un projet d'aménagement",
  AUs: "zone à urbaniser (AU) fermée : pas constructible avant une modification du PLU",
  AU: "zone à urbaniser (AU)",
  A: "zone agricole (A) : construction très limitée (bâtiments agricoles, extensions encadrées)",
  N: "zone naturelle et forestière (N) : construction très limitée",
};

const ADDRESS = /\d|\b(rue|chemin|allée|allee|impasse|avenue|av|boulevard|bd|route|ruelle|lotissement|résidence|residence|cité|cite|sentier|place)\b/i;

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const euros = (n: number) => `${fr(Math.round(n / 1000) * 1000).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} €`;

/**
 * Aggregates only: DVF's terms forbid re-identifying people, so no single sale, address or parcel is given out.
 * Houses and flats sold alone, with a built surface, for a median price and a median price per m².
 */
export function market(sales: terrain.Sale[]) {
  const pick = (code: string) => sales.filter((s) => s.code === code && s.lots === 1 && s.surface_bati >= 15);
  const sum = (list: terrain.Sale[]) =>
    list.length < 3
      ? { ventes: list.length, note: "trop peu de ventes pour une médiane" }
      : {
          ventes: list.length,
          prix_median: euros(median(list.map((s) => s.valeur))!),
          prix_m2_median: `${fr(Math.round(median(list.map((s) => s.valeur / s.surface_bati))! / 10) * 10)} €/m²`,
          surface_mediane_m2: Math.round(median(list.map((s) => s.surface_bati))!),
        };
  const land = sales.filter((s) => s.code.startsWith("2") && s.surface_terrain > 0 && s.surface_bati === 0);
  return {
    maisons: sum(pick("111")),
    appartements: sum(pick("121")),
    terrains_nus: land.length >= 3 ? { ventes: land.length, prix_m2_median: `${fr(Math.round(median(land.map((s) => s.valeur / s.surface_terrain))!))} €/m²` } : { ventes: land.length },
    toutes_ventes: sales.length,
  };
}

/** The value, or undefined when the source failed (null stays "nothing at this point"). */
async function settle<T>(source: string, p: Promise<{ value: T }>): Promise<T | undefined> {
  try {
    return (await p).value;
  } catch (err) {
    console.error(`source ${source} indisponible:`, why(err));
    return undefined;
  }
}

const DOWN = "service momentanément indisponible : réessayer dans un instant";

export async function ficheLieu(cache: Cache, adresse: string, now = new Date()) {
  // A street address goes to the national address base; a place name to the gazetteer first.
  let where: { label: string; lon: number; lat: number; precision: string } | null = null;
  const place = resolvePlace(adresse);
  if (place && (place.correspondance === "coordonnees" || (place.correspondance === "exacte" && !ADDRESS.test(adresse)))) {
    where = { label: `${place.lieu.nom} (${place.lieu.type}, ${place.lieu.commune})`, lon: place.lieu.lon, lat: place.lieu.lat, precision: "centre du lieu-dit ou de la commune" };
  } else {
    const a = await settle(terrain.SOURCES.ban.id, terrain.geocode(cache, adresse));
    if (a) where = { label: a.label, lon: a.lon, lat: a.lat, precision: a.type === "housenumber" ? "adresse exacte" : a.type === "street" ? "milieu de la rue" : "centre de la commune" };
    else if (place) where = { label: `${place.lieu.nom} (${place.lieu.type}, ${place.lieu.commune})`, lon: place.lieu.lon, lat: place.lieu.lat, precision: "centre du lieu-dit" };
  }
  if (!where) {
    return {
      ...text({ erreur: `Adresse ou lieu introuvable à La Réunion : « ${adresse} ».`, conseil: "Donner une adresse (numéro, rue, commune) ou un lieu-dit." }),
      isError: true,
    };
  }
  const { lon, lat } = where;
  const fromYear = new Date(now.getTime() + 4 * 3600_000).getUTCFullYear() - 5;
  const [p, z, alt, s] = await Promise.all([
    settle(terrain.SOURCES.cadastre.id, terrain.parcel(cache, lon, lat)),
    settle(terrain.SOURCES.gpu.id, terrain.zone(cache, lon, lat)),
    settle(terrain.SOURCES.alti.id, terrain.altitude(cache, lon, lat)),
    settle(terrain.SOURCES.dvf.id, terrain.sales(cache, lon, lat, fromYear)),
  ]);

  const parts = [`${where.label} (${where.precision})`];
  if (alt != null) parts.push(`altitude ${alt} m`);
  if (p) parts.push(`parcelle cadastrale ${p.section} ${p.numero} (${fr(p.contenance_m2)} m²)`);
  const zt = z ? ZONE_TYPES[z.typezone] ?? (z.typezone ? `zone ${z.typezone}` : undefined) : undefined;
  if (z) parts.push(`zone ${z.libelle} du PLU${zt ? `, ${zt}` : ""}`);
  const m = s ? market(s) : null;
  if (m && "prix_m2_median" in m.maisons) parts.push(`maisons vendues autour depuis ${fromYear} : ${m.maisons.prix_m2_median} en médiane (${m.maisons.ventes} ventes)`);
  if (m && "prix_m2_median" in m.appartements) parts.push(`appartements : ${m.appartements.prix_m2_median} (${m.appartements.ventes} ventes)`);

  const used = [
    terrain.SOURCES.ban,
    ...(p ? [terrain.SOURCES.cadastre] : []),
    ...(z ? [terrain.SOURCES.gpu] : []),
    ...(alt != null ? [terrain.SOURCES.alti] : []),
    ...(s ? [terrain.SOURCES.dvf] : []),
  ];
  return text({
    resume: `${parts.join(" ; ")}.`,
    lieu: { ...where, lon: Math.round(lon * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5 },
    altitude_m: alt ?? DOWN,
    cadastre: p === undefined ? DOWN : p ?? "aucune parcelle à ce point (domaine public, route, ou point imprécis)",
    urbanisme: z
      ? {
          zone: z.libelle,
          libelle: z.libelong || undefined,
          type: zt,
          document: z.document,
          approuve_le: z.date ? `${z.date.slice(6, 8)}/${z.date.slice(4, 6)}/${z.date.slice(0, 4)}` : undefined,
          voir_le_reglement: `https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=${lon}&lat=${lat}&zoom=18`,
        }
      : z === undefined ? DOWN : "pas de zonage publié à ce point sur le Géoportail de l'urbanisme",
    marche_immobilier: m
      ? { perimetre: "environ 600 m × 600 m autour du point", depuis: fromYear, ...m, note: "Médianes des ventes enregistrées (DVF), maisons et appartements vendus seuls. Aucune vente individuelle n'est donnée." }
      : DOWN,
    avertissements: [
      "Le cadastre est un document fiscal : il ne prouve pas la propriété ni les limites exactes (bornage par un géomètre).",
      "La zone du PLU ne dit pas tout : règlement de la zone, servitudes et plans de prévention des risques (PPR) s'ajoutent. Se renseigner auprès du service urbanisme de la mairie.",
      "Risques naturels (inondation, mouvements de terrain, cyclone, volcan) : consulter georisques.gouv.fr pour cette adresse.",
    ],
    sources: credits(used),
  });
}
