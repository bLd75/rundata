/**
 * The sanitary control of tap water in La Réunion: the ARS samples each distribution network (« unité de
 * distribution », UDI) and publishes every analysis, which Hub'Eau serves as open data (no account). The results come
 * one to two months after the sample, once the laboratory has validated them: an answer says « dernière analyse du… »,
 * never « l'eau est buvable aujourd'hui ». A temporary « ne pas boire » notice goes through the mayor and the ARS, not
 * through this data.
 *
 * A commune has several networks (Saint-Pierre: 13, from the town centre to Mont-Vert les Hauts), each serving its
 * quartiers: the network is found from the quartier asked when its name matches.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "eau_potable",
  nom: "Contrôle sanitaire de l'eau du robinet (ARS La Réunion, via Hub'Eau)",
  organisme: "Agence régionale de santé La Réunion ; Hub'Eau (Office français de la biodiversité, BRGM)",
  licence: "Licence Ouverte 2.0",
  attribution: "ARS La Réunion, données Hub'Eau",
  url: "https://hubeau.eaufrance.fr/page/api-qualite-eau-potable",
};

const API = "https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable";
const ECOLI = "1449"; // part of every bacteriological analysis: one row per sample of that kind
const MONTHS = 6;
// New results come in batches a few times a month.
const FRESH_SECONDS = 6 * 3600;

export interface Reseau {
  code: string;
  nom: string;
  quartiers: string[];
}

export interface Depassement {
  parametre: string;
  resultat: string;
  limite: string;
}

export interface Prelevement {
  code: string;
  /** ISO date and time of the sample, UTC. */
  date: string;
  conforme: boolean;
  conclusion: string;
  reseaux: string[];
  /** The parameters above their quality limit, for a sample that is not « conforme ». */
  depassements: Depassement[];
}

export interface Commune {
  insee: string;
  reseaux: Reseau[];
  prelevements: Prelevement[];
}

interface Page<T> {
  count: number;
  data: T[];
}
interface UdiRow {
  code_reseau: string;
  nom_reseau: string;
  nom_quartier: string | null;
}
interface ResultRow {
  code_prelevement: string;
  date_prelevement: string;
  conclusion_conformite_prelevement?: string;
  conformite_limites_bact_prelevement?: string;
  conformite_limites_pc_prelevement?: string;
  libelle_parametre?: string;
  resultat_alphanumerique?: string;
  resultat_numerique?: number | null;
  libelle_unite?: string;
  limite_qualite_parametre?: string | null;
  reseaux?: { code: string; nom: string }[] | null;
}

/** « RESEAU USINE DASSY CONDE » → « Usine Dassy Condé »… as far as capitals go: the ARS writes names without accents. */
export function networkName(nom: string): string {
  return nom
    .replace(/^RESEAU\s+/i, "")
    .toLowerCase()
    .replace(/(^|[\s\-'(])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/(?<=\s)(De|Des|Du|La|Le|Les|Aux|A)(?=\s)/g, (w) => (w === "A" ? "à" : w.toLowerCase()))
    .replace(/^./, (c) => c.toUpperCase());
}

export function parseNetworks(rows: UdiRow[]): Reseau[] {
  const byCode = new Map<string, Reseau>();
  for (const r of rows) {
    const n = byCode.get(r.code_reseau) ?? { code: r.code_reseau, nom: networkName(r.nom_reseau), quartiers: [] };
    if (r.nom_quartier && !n.quartiers.includes(r.nom_quartier)) n.quartiers.push(r.nom_quartier);
    byCode.set(r.code_reseau, n);
  }
  return [...byCode.values()];
}

/** « <=0 n/(100mL) » and 4 → above the limit. */
function above(row: ResultRow): boolean {
  const m = /^<=\s*([\d,.]+)/.exec(row.limite_qualite_parametre ?? "");
  return !!m && typeof row.resultat_numerique === "number" && row.resultat_numerique > parseFloat(m[1].replace(",", "."));
}

/** The samples, from the E. coli rows (one per bacteriological sample) and the rows of the samples off the limits. */
export function parseSamples(ecoli: ResultRow[], offLimits: ResultRow[]): Prelevement[] {
  const samples = new Map<string, Prelevement>();
  const add = (r: ResultRow) => {
    const s = samples.get(r.code_prelevement) ?? {
      code: r.code_prelevement,
      date: r.date_prelevement,
      conforme: true,
      conclusion: r.conclusion_conformite_prelevement ?? "",
      reseaux: (r.reseaux ?? []).map((n) => n.code),
      depassements: [],
    };
    samples.set(r.code_prelevement, s);
    return s;
  };
  for (const r of ecoli) {
    const s = add(r);
    if (r.conformite_limites_bact_prelevement === "N" || r.conformite_limites_pc_prelevement === "N") s.conforme = false;
  }
  for (const r of offLimits) {
    const s = add(r);
    s.conforme = false;
    if (!s.conclusion) s.conclusion = "Eau d'alimentation non-conforme aux exigences de qualité.";
    if (above(r) && r.libelle_parametre && !s.depassements.some((d) => r.libelle_parametre!.startsWith(d.parametre))) {
      const unit = (u: string) => u.replace("n/(100mL)", "pour 100 mL");
      s.depassements.push({
        parametre: r.libelle_parametre.replace(/\s*\/\s*100\s*ml.*$/i, ""),
        resultat: unit(`${r.resultat_alphanumerique ?? r.resultat_numerique} ${r.libelle_unite ?? ""}`.trim()),
        limite: unit((r.limite_qualite_parametre ?? "").replace("<=", "≤ ")),
      });
    }
  }
  return [...samples.values()].sort((a, b) => b.date.localeCompare(a.date));
}

const SAMPLE_FIELDS = "code_prelevement,date_prelevement,conclusion_conformite_prelevement,conformite_limites_bact_prelevement,conformite_limites_pc_prelevement,reseaux";
const LIMIT_FIELDS = "code_prelevement,date_prelevement,libelle_parametre,resultat_alphanumerique,resultat_numerique,libelle_unite,limite_qualite_parametre,reseaux";

export async function commune(cache: Cache, insee: string, now = new Date()): Promise<Cached<Commune>> {
  return cache.get(`eau:${insee}`, FRESH_SECONDS, async () => {
    const since = new Date(now.getTime() - MONTHS * 30.5 * 86400_000).toISOString().slice(0, 10);
    const year = now.getUTCFullYear();
    // Hub'Eau answers in a second, but now and then one request hangs: a second try is quicker than a long wait.
    const q = async (path: string, params: Record<string, string>) => {
      const url = `${API}/${path}?${new URLSearchParams({ code_commune: insee, ...params })}`;
      try {
        return await getJson<Page<never>>(SOURCE.id, url, 6_000);
      } catch {
        return getJson<Page<never>>(SOURCE.id, url, 12_000);
      }
    };
    const udi = (y: number) => q("communes_udi", { annee: String(y), size: "200", fields: "code_reseau,nom_reseau,nom_quartier" });
    const [networks, ecoli, bact, pc] = await Promise.all([
      udi(year),
      q("resultats_dis", { code_parametre: ECOLI, date_min_prelevement: since, size: "1000", fields: SAMPLE_FIELDS }),
      q("resultats_dis", { conformite_limites_bact_prelevement: "N", date_min_prelevement: since, size: "1000", fields: LIMIT_FIELDS }),
      q("resultats_dis", { conformite_limites_pc_prelevement: "N", date_min_prelevement: since, size: "1000", fields: LIMIT_FIELDS }),
    ]);
    // Early in the year, the list of networks may not be out yet.
    const rows: UdiRow[] = networks.data.length ? networks.data : (await udi(year - 1)).data;
    return {
      insee,
      reseaux: parseNetworks(rows),
      prelevements: parseSamples(ecoli.data as ResultRow[], [...(bact.data as ResultRow[]), ...(pc.data as ResultRow[])]),
    };
  });
}
