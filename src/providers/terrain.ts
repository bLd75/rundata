/**
 * What official registers say about a point of La Réunion, all without a key:
 * - address search: Géoplateforme geocoder (Base adresse nationale), IGN;
 * - cadastral parcel and zone of the local urban plan (PLU): API Carto, IGN (cadastre, Géoportail de l'urbanisme);
 * - ground altitude: IGN RGE ALTI;
 * - property sales around: DVF open data, Cerema API (published as "preprod", no availability promise).
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCES: Record<"ban" | "cadastre" | "gpu" | "alti" | "dvf", SourceInfo> = {
  ban: { id: "ban_geocodage", nom: "Base adresse nationale (géocodage de la Géoplateforme)", organisme: "IGN, Etalab", licence: "Licence Ouverte Etalab 2.0", attribution: "BAN, IGN", url: "https://geoservices.ign.fr/documentation/services/services-geoplateforme/geocodage" },
  cadastre: { id: "cadastre_apicarto", nom: "Plan cadastral (API Carto)", organisme: "DGFiP, IGN", licence: "Licence Ouverte Etalab 2.0", attribution: "DGFiP, IGN", url: "https://apicarto.ign.fr/api/doc/cadastre" },
  gpu: { id: "gpu_zone_urba", nom: "Zonage des plans locaux d'urbanisme (Géoportail de l'urbanisme)", organisme: "Communes, IGN", licence: "Licence Ouverte Etalab 2.0", attribution: "Géoportail de l'urbanisme", url: "https://www.geoportail-urbanisme.gouv.fr" },
  alti: { id: "ign_altimetrie", nom: "Altitude du sol (RGE ALTI)", organisme: "IGN", licence: "Licence Ouverte Etalab 2.0", attribution: "IGN", url: "https://geoservices.ign.fr/documentation/services/services-geoplateforme/altimetrie" },
  dvf: { id: "dvf_cerema", nom: "Demandes de valeurs foncières (DVF open data, Cerema)", organisme: "DGFiP, Cerema", licence: "Licence Ouverte Etalab 2.0", attribution: "DGFiP, Cerema (DVF open data)", url: "https://apidf-preprod.cerema.fr" },
};

const DAY = 24 * 3600;
const point = (lon: number, lat: number) => encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [lon, lat] }));
const key = (lon: number, lat: number) => `${lon.toFixed(5)},${lat.toFixed(5)}`;

export interface Address {
  label: string;
  lon: number;
  lat: number;
  score: number;
  type: string;
  insee: string;
}

/** The best address match in La Réunion (postcodes 974xx), or null. */
export async function geocode(cache: Cache, q: string): Promise<Cached<Address | null>> {
  const text = q.trim().slice(0, 200);
  return cache.get(`ban:${text.toLowerCase()}`, DAY, async () => {
    const r = await getJson<{ features: { geometry: { coordinates: [number, number] }; properties: Record<string, string | number> }[] }>(
      SOURCES.ban.id,
      `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(`${text} La Réunion`)}&limit=5`,
    );
    const f = r.features.find((x) => String(x.properties.postcode ?? "").startsWith("974"));
    if (!f) return null;
    const p = f.properties;
    return { label: String(p.label), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], score: Number(p.score), type: String(p.type), insee: String(p.citycode) };
  });
}

export interface Parcel {
  idu: string;
  section: string;
  numero: string;
  commune: string;
  contenance_m2: number;
}

export async function parcel(cache: Cache, lon: number, lat: number): Promise<Cached<Parcel | null>> {
  return cache.get(`cadastre:${key(lon, lat)}`, DAY, async () => {
    const r = await getJson<{ features: { properties: Record<string, string | number> }[] }>(
      SOURCES.cadastre.id, `https://apicarto.ign.fr/api/cadastre/parcelle?geom=${point(lon, lat)}`, 25_000);
    const p = r.features[0]?.properties;
    return p ? { idu: String(p.idu), section: String(p.section), numero: String(p.numero), commune: String(p.nom_com), contenance_m2: Number(p.contenance) } : null;
  });
}

export interface Zone {
  libelle: string;
  libelong: string;
  typezone: string;
  date: string;
  document: string;
}

export async function zone(cache: Cache, lon: number, lat: number): Promise<Cached<Zone | null>> {
  return cache.get(`gpu:${key(lon, lat)}`, DAY, async () => {
    const r = await getJson<{ features: { properties: Record<string, string | null> }[] }>(
      SOURCES.gpu.id, `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${point(lon, lat)}`, 25_000);
    const p = r.features[0]?.properties;
    return p ? { libelle: p.libelle ?? "", libelong: p.libelong ?? "", typezone: p.typezone ?? "", date: p.datvalid ?? "", document: p.partition ?? "" } : null;
  });
}

export async function altitude(cache: Cache, lon: number, lat: number): Promise<Cached<number | null>> {
  return cache.get(`alti:${key(lon, lat)}`, 30 * DAY, async () => {
    const r = await getJson<{ elevations: number[] }>(
      SOURCES.alti.id,
      `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=${lon}&lat=${lat}&resource=ign_rge_alti_wld&zonly=true`,
    );
    const z = r.elevations[0];
    return z != null && z > -100 ? Math.round(z) : null;
  });
}

export interface Sale {
  annee: number;
  type: string;
  code: string;
  valeur: number;
  surface_bati: number;
  surface_terrain: number;
  lots: number;
}

/** Sales within about `halfSideM` metres since `fromYear`, without geometry nor parcel ids (aggregated by the tool). */
export async function sales(cache: Cache, lon: number, lat: number, fromYear: number, halfSideM = 300): Promise<Cached<Sale[]>> {
  const dLat = halfSideM / 111_320;
  const dLon = halfSideM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(5)).join(",");
  return cache.get(`dvf:${bbox}:${fromYear}`, 7 * DAY, async () => {
    const r = await getJson<{ features: { properties: Record<string, string | number> }[] }>(
      SOURCES.dvf.id,
      `https://apidf-preprod.cerema.fr/dvf_opendata/geomutations/?in_bbox=${bbox}&anneemut_min=${fromYear}&page_size=500`,
      25_000,
    );
    return r.features
      .map(({ properties: p }) => ({
        annee: Number(p.anneemut),
        type: String(p.libtypbien),
        code: String(p.codtypbien),
        valeur: Number(p.valeurfonc),
        surface_bati: Number(p.sbati),
        surface_terrain: Number(p.sterr),
        lots: Number(p.nblocmut),
      }))
      .filter((s) => s.valeur > 0 && String(s.code) !== "undefined");
  });
}
