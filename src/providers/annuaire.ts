/**
 * Public services of La Réunion (town halls, prefecture, CAF, France Travail, tax offices, courts…) from the
 * Annuaire de l'administration of service-public.fr (DILA), an Opendatasoft API with no key. Full-text search over
 * the 974 entries, with opening hours, phone, address and position.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "annuaire_administration",
  nom: "Annuaire de l'administration (service-public.fr)",
  organisme: "Direction de l'information légale et administrative (DILA)",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "DILA, service-public.fr",
  url: "https://lannuaire.service-public.fr",
};

const URL = "https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records";
const FRESH_SECONDS = 24 * 3600;
const FIELDS = "nom,code_insee_commune,adresse,plage_ouverture,telephone,adresse_courriel,site_internet,url_service_public,commentaire_plage_ouverture";

export interface Office {
  nom: string;
  insee: string;
  adresse: string;
  lon: number | null;
  lat: number | null;
  /** Opening hours as given: day ranges with up to two time ranges each. */
  horaires: { de: string; a: string; plages: [string, string][]; note?: string }[];
  note_horaires?: string;
  telephone?: string;
  courriel?: string;
  site?: string;
  fiche: string;
}

const json = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== "string" || !s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

type Row = Record<string, unknown>;

export function office(r: Row): Office {
  const addrs = json<Record<string, string>[]>(r.adresse, []);
  const a = addrs.find((x) => x.type_adresse === "Adresse") ?? addrs[0] ?? {};
  const hours = json<Record<string, string>[]>(r.plage_ouverture, []);
  // "08:00:00" → "08:00", kept comparable as text by the open-now check.
  const hm = (t: string) => t.slice(0, 5);
  return {
    nom: String(r.nom),
    insee: String(r.code_insee_commune ?? ""),
    adresse: [a.numero_voie, a.complement1, `${a.code_postal ?? ""} ${a.nom_commune ?? ""}`.trim()].filter(Boolean).join(", "),
    lon: a.longitude ? Number(a.longitude) : null,
    lat: a.latitude ? Number(a.latitude) : null,
    horaires: hours.map((h) => ({
      de: h.nom_jour_debut.toLowerCase(),
      a: h.nom_jour_fin.toLowerCase(),
      plages: ([[h.valeur_heure_debut_1, h.valeur_heure_fin_1], [h.valeur_heure_debut_2, h.valeur_heure_fin_2]] as [string, string][])
        .filter(([d, f]) => d && f)
        .map(([d, f]) => [hm(d), hm(f)] as [string, string]),
      note: h.commentaire || undefined,
    })),
    note_horaires: (r.commentaire_plage_ouverture as string) || undefined,
    telephone: json<{ valeur: string }[]>(r.telephone, [])[0]?.valeur,
    courriel: (r.adresse_courriel as string) || undefined,
    site: json<{ valeur: string }[]>(r.site_internet, [])[0]?.valeur,
    fiche: String(r.url_service_public ?? ""),
  };
}

/** Up to 20 offices matching `what`, in the API's relevance order: in one commune (INSEE code), or all La Réunion. */
export async function search(cache: Cache, what: string, insee?: string): Promise<Cached<Office[]>> {
  const q = what.replace(/["\\]/g, " ").trim().slice(0, 80);
  const scope = insee && /^974\d\d$/.test(insee) ? `code_insee_commune="${insee}"` : `startswith(code_insee_commune,"974")`;
  return cache.get(`annuaire:${insee ?? "974"}:${q.toLowerCase()}`, FRESH_SECONDS, async () => {
    const where = `${scope} and search("${q}")`;
    const url = `${URL}?where=${encodeURIComponent(where)}&limit=20&select=${FIELDS}`;
    return (await getJson<{ results: Row[] }>(SOURCE.id, url)).results.map(office);
  });
}
