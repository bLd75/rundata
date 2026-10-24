/**
 * The past cyclones of /cyclones/<nom>-<année> and of the cyclones tool's `nom`: what Météo-France's stations measured
 * while each went by (cyclones-passes.json, built by scripts/build-cyclones-passes.py from the daily files), and the
 * one sentence of its date and passage, quoted from a document that was read and is named. A cyclone without such a
 * document has no page. No casualty, damage or outage figure: only what the stations measured. Worded by marketing.
 */
import data from "./cyclones-passes.json" with { type: "json" };
import { stationName } from "../providers/climat.js";

/** A document that was read, quoted as it writes. */
export interface Document {
  titre: string;
  auteur: string;
  url: string;
}

export interface Passe {
  /** The page's slug and the key in cyclones-passes.json. */
  slug: string;
  nom: string;
  annee: number;
  /** The H1's « {date du passage} ». */
  date: string;
  /** The meta's « {mois année} ». */
  mois: string;
  /** Sentence 1: the date and the passage, the quotations as the document writes them. */
  passage: string;
  document: Document;
  /** The alert, only as an official document that was read says it. */
  alerte?: string;
}

export const PASSES: Passe[] = [
  {
    slug: "garance-2025",
    nom: "Garance",
    annee: 2025,
    date: "28 février 2025",
    mois: "février 2025",
    passage:
      "Le 28 février 2025, « l'œil du cyclone traverse rapidement la Réunion entre 10h et 11h », avec un « vent destructeur dans le mur qui traverse le nord et l'est de l'île » ; « secteur sud plus épargné ».",
    document: {
      titre: "Saison cyclonique 2024-2025 dans le Sud-Ouest de l'océan Indien – Retour sur Garance à La Réunion",
      auteur: "Météo-France, Direction interrégionale pour l'océan Indien",
      url: "https://www.reunion.developpement-durable.gouv.fr/IMG/pdf/1a_meteo_france_bilan_saison_cyclonique.pdf",
    },
  },
  {
    slug: "batsirai-2022",
    nom: "Batsirai",
    annee: 2022,
    date: "3 février 2022",
    mois: "février 2022",
    passage:
      "Batsirai est passé au nord de l'île : « centre du cyclone au plus près à un peu plus de 190 km au NNO de l'île, le 3 février en fin de journée », « demeuré à moins de 220 km au nord quelque 26h durant ».",
    document: {
      titre: "Bilan de la saison cyclonique 2021-2022 à La Réunion",
      auteur: "Météo-France, CMRS de La Réunion",
      url: "https://www.reunion.developpement-durable.gouv.fr/IMG/pdf/02a_saison_cyclonique_2021-2022_meteo.pdf",
    },
    alerte: "« 38h d'alerte rouge à La Réunion »",
  },
  {
    slug: "dina-2002",
    nom: "Dina",
    annee: 2002,
    date: "22 et 23 janvier 2002",
    mois: "janvier 2002",
    passage:
      "« Le cyclone Dina, qui a touché la Réunion les 22 et 23 janvier 2002 » ; « les zones de l'île où le cyclone a été le plus violent (Nord et Nord-Ouest de la Réunion, reliefs) ».",
    document: {
      titre: "Cyclone Dina à la Réunion les 22 et 23 janvier 2002 : caractérisation, conséquences et retour d'expérience (29 janvier 2003)",
      auteur: "Inspection générale de l'environnement et Conseil général des ponts et chaussées",
      url: "https://www.vie-publique.fr/files/rapport/pdf/034000505.pdf",
    },
  },
];

/** What a station measured: each day's rain (mm, 10 h to 10 h) and strongest gust (m/s, as Météo-France gives it). */
export interface Mesure {
  poste: string;
  station: string;
  alt: number;
  rr?: (number | null)[];
  fxi?: (number | null)[];
  record_rr?: { jour: string; depuis: number };
  record_fxi?: { jour: string; depuis: number };
}

type Raw = Omit<Mesure, "station"> & { nom: string };
const RAW = data.cyclones as Record<string, { jours: string[]; stations: Raw[] }>;

/** The days of the passage and every station's measures, most rain first. */
export function mesures(p: Passe): { jours: string[]; stations: Mesure[] } {
  const c = RAW[p.slug];
  return { jours: c.jours, stations: c.stations.map(({ nom, ...s }) => ({ ...s, station: stationName(s.poste, nom) })) };
}

/** marketing's note under the rain. */
export const RAIN_NOTE = "Pluie du jour : cumul mesuré de 10 h ce jour-là à 10 h le lendemain (heure de La Réunion), comme le compte Météo-France.";

/** m/s as km/h, rounded (277 km/h for 77 m/s). */
export const kmh = (ms: number) => Math.round(ms * 3.6);

/** The sum of a station's rain over the days, one decimal. */
export const total = (rr: (number | null)[] | undefined) => Math.round((rr ?? []).reduce<number>((a, x) => a + (x ?? 0), 0) * 10) / 10;

/** A station's strongest gust over the days, and its day. */
export function rafale(s: Mesure, jours: string[]): { ms: number; jour: string } | undefined {
  let best: { ms: number; jour: string } | undefined;
  (s.fxi ?? []).forEach((v, i) => {
    if (v !== null && (!best || v > best.ms)) best = { ms: v, jour: jours[i] };
  });
  return best;
}

/** The station records the passage beat: rain first, the biggest first, then the gusts. */
export function records(p: Passe): { station: string; quoi: "pluie" | "rafale"; jour: string; mm?: number; ms?: number; depuis: number }[] {
  const { jours, stations } = mesures(p);
  const rain = stations
    .filter((s) => s.record_rr)
    .map((s) => ({ station: s.station, quoi: "pluie" as const, jour: s.record_rr!.jour, mm: s.rr![jours.indexOf(s.record_rr!.jour)]!, depuis: s.record_rr!.depuis }))
    .sort((a, b) => b.mm - a.mm);
  const wind = stations
    .filter((s) => s.record_fxi)
    .map((s) => ({ station: s.station, quoi: "rafale" as const, jour: s.record_fxi!.jour, ms: s.fxi![jours.indexOf(s.record_fxi!.jour)]!, depuis: s.record_fxi!.depuis }))
    .sort((a, b) => b.ms - a.ms);
  return [...rain, ...wind];
}

/** The past cyclone a question names: « Garance », « cyclone Dina 2002 », « batsirai-2022 ». */
export function passeOf(asked: string): Passe | undefined {
  const q = asked
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const named = PASSES.filter((p) => new RegExp(`\\b${p.nom.toLowerCase()}\\b`).test(q));
  return named.find((p) => q.includes(String(p.annee))) ?? named[0];
}

/** « 28/02/2025 ». */
export const jourFr = (iso: string) => iso.split("-").reverse().join("/");
