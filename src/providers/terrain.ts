/**
 * What official registers say about a point of La Réunion, all without a key:
 * - address search: Géoplateforme geocoder (Base adresse nationale), IGN;
 * - cadastral parcel and zone of the local urban plan (PLU): API Carto, IGN (cadastre, Géoportail de l'urbanisme);
 * - ground altitude: IGN RGE ALTI;
 * - property sales around: DVF open data, Cerema API (published as "preprod", no availability promise);
 * - risk prevention plans (PPR) at the point: public-utility easements of the Géoportail de l'urbanisme, through API Carto;
 * - natural disaster decrees of the commune and landslides recorded around: Géorisques API v1 (BRGM).
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";
import { ALTIMETRIE } from "./ign.js";

export const SOURCES: Record<"ban" | "cadastre" | "gpu" | "alti" | "dvf" | "ppr" | "georisques", SourceInfo> = {
  ban: { id: "ban_geocodage", nom: "Base adresse nationale (géocodage de la Géoplateforme)", organisme: "IGN, Etalab", licence: "Licence Ouverte Etalab 2.0", attribution: "BAN, IGN", url: "https://geoservices.ign.fr/documentation/services/services-geoplateforme/geocodage" },
  cadastre: { id: "cadastre_apicarto", nom: "Plan cadastral (API Carto)", organisme: "DGFiP, IGN", licence: "Licence Ouverte Etalab 2.0", attribution: "DGFiP, IGN", url: "https://apicarto.ign.fr/api/doc/cadastre" },
  gpu: { id: "gpu_zone_urba", nom: "Zonage des plans locaux d'urbanisme (Géoportail de l'urbanisme)", organisme: "Communes, IGN", licence: "Licence Ouverte Etalab 2.0", attribution: "Géoportail de l'urbanisme", url: "https://www.geoportail-urbanisme.gouv.fr" },
  alti: ALTIMETRIE,
  ppr: { id: "gpu_ppr", nom: "Plans de prévention des risques (servitudes du Géoportail de l'urbanisme)", organisme: "DEAL Réunion, IGN", licence: "Licence Ouverte Etalab 2.0", attribution: "DEAL Réunion, Géoportail de l'urbanisme", url: "https://www.geoportail-urbanisme.gouv.fr" },
  georisques: { id: "georisques", nom: "Géorisques : arrêtés de catastrophe naturelle, mouvements de terrain recensés (BDMvt)", organisme: "Ministère de la Transition écologique, BRGM", licence: "Licence Ouverte Etalab 2.0", attribution: "Géorisques, BRGM", url: "https://www.georisques.gouv.fr" },
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
  /** The street's name, for a street or a house number: what was asked is checked against it. */
  street?: string;
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
    return {
      label: String(p.label), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], score: Number(p.score), type: String(p.type), insee: String(p.citycode),
      ...(p.street ? { street: String(p.street) } : {}),
    };
  });
}

/** Up to five streets of a commune whose names come close to `q`, best first, without the postcode: « Rue Auguste Techer ». */
export async function streets(cache: Cache, q: string, insee: string): Promise<Cached<string[]>> {
  const text = q.trim().slice(0, 200);
  return cache.get(`ban-voies:${insee}:${text.toLowerCase()}`, DAY, async () => {
    const r = await getJson<{ features: { properties: Record<string, string | number> }[] }>(
      SOURCES.ban.id,
      `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(text)}&citycode=${insee}&type=street&limit=5`,
    );
    return [...new Set(r.features.filter((x) => String(x.properties.postcode ?? "").startsWith("974")).map((x) => String(x.properties.name)))];
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

/** What a plan's file name says it covers, e.g. PM1_PPR_i_mvt_SAINT_DENIS_gen2_ass. */
const PPR_RISKS: Record<string, string> = {
  i: "inondation",
  mvt: "mouvements de terrain",
  l: "recul du trait de côte et submersion marine",
  alea_cotier: "aléa côtier",
};

export interface Plan {
  /** « naturels » (PM1) or « technologiques » (PM3). */
  famille: "naturels" | "technologiques";
  risques: string[];
  /** The servitude's own name, for a technological plan (the site it is about). */
  nom: string;
  /** The point lies in the plan's regulated zones (red or blue), not only in its perimeter. */
  zone_reglementee: boolean;
  /** Latest approval date found in the plan's files, as YYYY-MM-DD. */
  approuve_le?: string;
  document: string;
}

/** Latest valid date among the act files « …_20121017_act.pdf|… » (some carry impossible ones, such as 20221929). */
export function latestAct(fichier: string): string | undefined {
  const dates = [...fichier.matchAll(/_(\d{4})(\d{2})(\d{2})_act/g)]
    .map(([, y, m, d]) => ({ y: +y, m: +m, d: +d }))
    .filter(({ m, d }) => m >= 1 && m <= 12 && d >= 1 && d <= 31)
    .map(({ y, m, d }) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`)
    .sort();
  return dates.at(-1);
}

export function planOf(p: Record<string, string | null>): Plan | null {
  const type = (p.suptype ?? "").toLowerCase();
  if (type !== "pm1" && type !== "pm3") return null;
  const name = p.nomass ?? "";
  const m = /^PM1_PPR_(.+?)_[A-Z][A-Z_]*_gen\d/.exec(name.replace(/_MVT_/, "_mvt_"));
  const risques = type === "pm1" && m ? Object.entries(PPR_RISKS).filter(([k]) => new RegExp(`(^|_)${k}(_|$)`).test(m[1])).map(([, v]) => v) : [];
  return {
    famille: type === "pm1" ? "naturels" : "technologiques",
    risques,
    nom: type === "pm3" ? name.replace(/^PM3_\d+_/, "").replace(/_gen.*$/, "").replace(/_/g, " ") : name,
    zone_reglementee: /zonages? r[ée]glementaires?/i.test(p.typeass ?? ""),
    approuve_le: latestAct(p.fichier ?? ""),
    document: p.gpu_doc_id ? `https://www.geoportail-urbanisme.gouv.fr/document/by-id/${p.gpu_doc_id}` : "https://www.geoportail-urbanisme.gouv.fr",
  };
}

/** Risk prevention plans whose regulated area holds the point (natural PM1, technological PM3), one per plan. */
export async function plans(cache: Cache, lon: number, lat: number): Promise<Cached<Plan[]>> {
  return cache.get(`ppr:${key(lon, lat)}`, 7 * DAY, async () => {
    const r = await getJson<{ features: { properties: Record<string, string | null> }[] }>(
      SOURCES.ppr.id, `https://apicarto.ign.fr/api/gpu/assiette-sup-s?geom=${point(lon, lat)}`, 25_000);
    const seen = new Set<string>();
    return r.features.flatMap(({ properties }) => {
      const plan = planOf(properties);
      if (!plan || seen.has(plan.nom)) return [];
      seen.add(plan.nom);
      return [plan];
    });
  });
}

export interface Catnat {
  risques: string[];
  debut: string;
  fin: string;
  arrete: string;
}

const iso = (d: string) => d.split("/").reverse().join("-");

/**
 * Géorisques restricts its API by country since its attacks of September 2026, and about one call in two from a
 * Worker fails (HTTP 520 or a reset); the next one usually goes through. Answers are then cached for days.
 */
async function georisques<T>(url: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await getJson<T>(SOURCES.georisques.id, url, 15_000);
    } catch (err) {
      if (attempt >= 3) throw err;
    }
  }
}

/** Natural disaster decrees (CatNat) of a commune, one per event, newest first. */
export async function catnat(cache: Cache, insee: string): Promise<Cached<Catnat[]>> {
  return cache.get(`catnat:${insee}`, 7 * DAY, async () => {
    const r = await georisques<{ data: Record<string, string>[] }>(`https://www.georisques.gouv.fr/api/v1/gaspar/catnat?code_insee=${insee}&page_size=200`);
    const events = new Map<string, Catnat>();
    for (const d of r.data) {
      const id = `${d.code_national_catnat}:${d.date_debut_evt}`;
      const e = events.get(id) ?? { risques: [], debut: iso(d.date_debut_evt), fin: iso(d.date_fin_evt), arrete: iso(d.date_publication_arrete) };
      if (!e.risques.includes(d.libelle_risque_jo)) e.risques.push(d.libelle_risque_jo);
      events.set(id, e);
    }
    return [...events.values()].sort((a, b) => b.debut.localeCompare(a.debut));
  });
}

export interface Landslide {
  type: string;
  date?: string;
  lon: number;
  lat: number;
  fiabilite: string;
}

/** Landslides, rockfalls and the like recorded within `radiusM` (BDMvt). */
export async function landslides(cache: Cache, lon: number, lat: number, radiusM = 500): Promise<Cached<Landslide[]>> {
  return cache.get(`mvt:${key(lon, lat)}:${radiusM}`, 7 * DAY, async () => {
    const r = await georisques<{ data: Record<string, string | number | null>[] }>(`https://www.georisques.gouv.fr/api/v1/mvt?latlon=${lon},${lat}&rayon=${radiusM}&page_size=100`);
    return r.data.map((d) => ({
      type: String(d.type),
      date: d.date_debut ? String(d.date_debut) : undefined,
      lon: Number(d.longitude),
      lat: Number(d.latitude),
      fiabilite: String(d.fiabilite ?? ""),
    }));
  });
}

/**
 * Communes where the radon potential is category 2 (low, but geology may ease its way up); all others are category 1.
 * Every commune of La Réunion is in seismic zone 2 (low). Both from Géorisques, checked on 23/10/2026.
 */
export const RADON_2 = new Set(["97410", "97421", "97424"]);
