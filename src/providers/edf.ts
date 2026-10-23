/**
 * Electricity in La Réunion, from EDF SEI's open data portal (data-fair API, no key):
 * - the production by source every 5 minutes ("Estimé": telemetered, consolidated each month);
 * - the "météo de l'électricité": a signal per hour for the coming days (optimal, heures de pointe, contraint,
 *   très contraint), with the share of charging EDF advises for electric vehicles.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "edf_sei_reunion",
  nom: "Production d'électricité et météo de l'électricité à La Réunion (EDF SEI)",
  organisme: "EDF Systèmes énergétiques insulaires, La Réunion",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "EDF SEI Réunion",
  url: "https://opendata-reunion.edf.fr",
};

const API = "https://opendata-reunion.edf.fr/data-fair/api/v1/datasets";
const MIX = `${API}/njq-knwu0diqrdup6tya8qxi/lines?size=1&sort=-date`;
const SIGNAL = `${API}/7tgfic35sejxtbi0ose84dbx/lines?size=200&sort=dateheure`;
const MIX_FRESH_SECONDS = 4 * 60;
const SIGNAL_FRESH_SECONDS = 60 * 60;

export interface Mix {
  date: string;
  total: number;
  photovoltaique: number;
  eolien: number;
  hydraulique: number;
  bioenergies: number;
  charbon: number;
  diesel: number;
  turbines_combustion: number;
  stockage: number;
  statut: string;
}

export interface Hour {
  dateheure: string;
  signal_horaire_texte: string;
  signal_horaire_couleur: string;
  signal_horaire_taux_recharge_conseille: number;
  cyclone_en_cours: boolean;
}

export async function mix(cache: Cache): Promise<Cached<Mix>> {
  return cache.get("edf:mix", MIX_FRESH_SECONDS, async () => {
    const r = await getJson<{ results: (Mix & Record<string, unknown>)[] }>(SOURCE.id, MIX);
    if (!r.results[0]) throw new Error("edf : aucune ligne de production");
    const { _id, _i, _rand, _score, _updatedAt, jour, ...m } = r.results[0];
    return m as Mix;
  });
}

/** The hours from the start of today (local time) onwards. */
export async function signal(cache: Cache, now = new Date()): Promise<Cached<Hour[]>> {
  return cache.get("edf:signal", SIGNAL_FRESH_SECONDS, async () => {
    const today = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
    const r = await getJson<{ results: (Hour & Record<string, unknown>)[] }>(
      SOURCE.id,
      `${SIGNAL}&dateheure_gte=${encodeURIComponent(`${today}T00:00:00+04:00`)}`,
    );
    return r.results.map((h) => ({
      dateheure: h.dateheure,
      signal_horaire_texte: h.signal_horaire_texte,
      signal_horaire_couleur: h.signal_horaire_couleur,
      signal_horaire_taux_recharge_conseille: h.signal_horaire_taux_recharge_conseille,
      cyclone_en_cours: h.cyclone_en_cours,
    }));
  });
}
