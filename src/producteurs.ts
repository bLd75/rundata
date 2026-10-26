/**
 * Who produces each source and under which licence, as /chiffres and sources_donnees count them: the definitions are
 * marketing's (25 October 2026).
 *
 * - A producer is the body that measures, decides or writes the information, not one that passes it on: Open-Meteo,
 *   NOAA relaying Météo-France, GDACS, Hub'Eau, transport.data.gouv.fr and the Géoportail de l'urbanisme do not count,
 *   the body behind them does. Each body named counts, under one canonical name: a mairie read by its agenda, its news
 *   and its water notices is one commune.
 * - A collective (communes, salles, media, water distributors, charge point operators) counts each body the code reads,
 *   from the lists it keeps (providers/agenda.ts, irve/stations.json); never 1 for the collective. The clubs on
 *   Sportsregions are read from the last copy of their calendar: counted live (chiffres.ts), not here.
 * - A licence is one of five families; the first four are open. In doubt, a source is not said open.
 *
 * Every source of toutesLesSources (server.ts) has its entry here (test/producteurs.test.ts), its producers given or
 * taken from the agendas that read it.
 */
import { normalize } from "./places/resolve.js";
import { AGENDAS, type Agenda } from "./providers/agenda.js";
import { STATIONS as BORNES } from "./providers/irve.js";
import type { SourceInfo } from "./types.js";

export type Famille = "licence_ouverte" | "odbl" | "cc_by" | "domaine_public" | "information_publique";

/** The families as the page writes them; the first four make « licence ouverte ». */
export const FAMILLES: Record<Famille, { nom: string; ouverte: boolean }> = {
  licence_ouverte: { nom: "Licence Ouverte", ouverte: true },
  odbl: { nom: "ODbL", ouverte: true },
  cc_by: { nom: "CC BY", ouverte: true },
  domaine_public: { nom: "domaine public", ouverte: true },
  information_publique: { nom: "information publique", ouverte: false },
};

/** A source's entry: its family, and its producers, or `agendas` when they are those of the agendas that read it. */
export interface Fiche {
  famille: Famille;
  producteurs?: string[];
  agendas?: true;
  /** Not counted: what rundata.re is sent, not what it reads (the clubs' proposals). */
  horsCompte?: true;
}

/** « Commune de Saint-Leu », « Commune du Port », « Commune des Trois-Bassins ». */
export function commune(nom: string): string {
  if (nom.startsWith("Le ")) return `Commune du ${nom.slice(3)}`;
  if (nom.startsWith("Les ")) return `Commune des ${nom.slice(4)}`;
  return `Commune de ${nom}`;
}

/** The charge point operators, each once whatever its spelling (« EZDrive », « Ezdrive »), as the file first writes it. */
function operateurs(): string[] {
  const seen = new Map<string, string>();
  for (const s of BORNES) if (s.reseau.trim() && !seen.has(normalize(s.reseau))) seen.set(normalize(s.reseau), s.reseau.trim());
  return [...seen.values()];
}

const MF = "Météo-France";
const ECMWF = "ECMWF";
const SANTE = "Ministère chargé de la santé";
const ARS = "Agence régionale de santé La Réunion";
const PREFECTURE = "Préfecture de La Réunion";
const MTE = "Ministère de la Transition écologique";
const OSM = "contributeurs d'OpenStreetMap";

export const FICHES: Record<string, Fiche> = {
  // Weather, sea, volcano.
  metar: { famille: "domaine_public", producteurs: [MF] },
  meteofrance: { famille: "licence_ouverte", producteurs: [MF] },
  mf_vigilance: { famille: "licence_ouverte", producteurs: [MF] },
  mf_radar: { famille: "licence_ouverte", producteurs: [MF] },
  mf_climatologie: { famille: "licence_ouverte", producteurs: [MF] },
  mf_climatologie_horaire: { famille: "licence_ouverte", producteurs: [MF] },
  arome: { famille: "licence_ouverte", producteurs: [MF] },
  gdacs_cyclones: { famille: "information_publique", producteurs: [MF] },
  pioupiou: { famille: "information_publique", producteurs: ["OpenWindMap"] },
  openmeteo: { famille: "cc_by", producteurs: [ECMWF] },
  openmeteo_ens: { famille: "cc_by", producteurs: [ECMWF] },
  openmeteo_houle: { famille: "cc_by", producteurs: [ECMWF] },
  cams_uv: { famille: "cc_by", producteurs: [ECMWF] },
  acspo: { famille: "domaine_public", producteurs: ["NOAA"] },
  modis: { famille: "domaine_public", producteurs: ["NASA"] },
  nasa_firms: { famille: "domaine_public", producteurs: ["NASA"] },
  refmar: { famille: "licence_ouverte", producteurs: ["SHOM"] },
  vigicrues: { famille: "licence_ouverte", producteurs: ["DEAL Réunion"] },
  ipgp_ovpf_seismes: { famille: "cc_by", producteurs: ["OVPF-IPGP"] },
  ovpf_bluesky: { famille: "information_publique", producteurs: ["OVPF-IPGP"] },
  pitonlive: { famille: "information_publique", producteurs: ["pitonlive.com"] },
  // Air, power, water, health.
  atmo_indice: { famille: "odbl", producteurs: ["Atmo Réunion"] },
  edf_sei_reunion: { famille: "licence_ouverte", producteurs: ["EDF"] },
  // The mairies relay EDF's notices: EDF only (they count by their agendas and news).
  mairies_edf: { famille: "information_publique", producteurs: ["EDF"] },
  eau_potable: { famille: "licence_ouverte", producteurs: [ARS] },
  eaux_baignade: { famille: "information_publique", producteurs: [ARS, SANTE] },
  vigieau: { famille: "licence_ouverte", producteurs: [MTE, PREFECTURE] },
  // providers/avis-eau.ts: Dionéo, runéo, Eaux de La Possession, La Créole, the CIREST, Sainte-Marie and Saint-Leu.
  avis_eau: { famille: "information_publique", producteurs: ["Dionéo", "runéo", "Eaux de La Possession", "La Créole", "CIREST", commune("Sainte-Marie"), commune("Saint-Leu")] },
  risque_requin: { famille: "information_publique", producteurs: [PREFECTURE, "Centre Sécurité Requin"] },
  geodae: { famille: "licence_ouverte", producteurs: [SANTE] },
  finess: { famille: "licence_ouverte", producteurs: [SANTE] },
  // Santé.fr is the ministry's public service.
  sante_fr_urgences: { famille: "information_publique", producteurs: [SANTE] },
  ars_garde: { famille: "information_publique", producteurs: [ARS] },
  // Places, land, public services.
  annuaire_administration: { famille: "licence_ouverte", producteurs: ["DILA"] },
  ban_geocodage: { famille: "licence_ouverte", producteurs: ["IGN", "Etalab"] },
  cadastre_apicarto: { famille: "licence_ouverte", producteurs: ["DGFiP", "IGN"] },
  // The Géoportail de l'urbanisme passes the communes' plans on: which communes, the code does not know.
  gpu_zone_urba: { famille: "licence_ouverte", producteurs: [] },
  // The DEAL's risk plans, passed on by the same Géoportail.
  gpu_ppr: { famille: "licence_ouverte", producteurs: ["DEAL Réunion"] },
  ign_altimetrie: { famille: "licence_ouverte", producteurs: ["IGN"] },
  georisques: { famille: "licence_ouverte", producteurs: [MTE, "BRGM"] },
  dvf_cerema: { famille: "licence_ouverte", producteurs: ["DGFiP", "Cerema"] },
  // The same sales, by street: the DGFiP's, placed on the map by Etalab.
  dvf_etalab: { famille: "licence_ouverte", producteurs: ["DGFiP", "Etalab"] },
  // The ANIL's estimates, from the ads of SeLoger and leboncoin, which write ads, not the rents.
  anil_loyers: { famille: "licence_ouverte", producteurs: ["ANIL"] },
  // The operators declare, the Arcep counts the premises and publishes.
  arcep_connexion: { famille: "licence_ouverte", producteurs: ["Arcep"] },
  prefecture_carburants: { famille: "licence_ouverte", producteurs: [PREFECTURE] },
  radars_fixes: { famille: "licence_ouverte", producteurs: ["Ministère de l'Intérieur"] },
  tco_decheteries: { famille: "licence_ouverte", producteurs: ["TCO"] },
  tco_collecte: { famille: "licence_ouverte", producteurs: ["TCO"] },
  osm_enfants: { famille: "odbl", producteurs: [OSM] },
  osm_marches: { famille: "odbl", producteurs: [OSM] },
  data_es: { famille: "licence_ouverte", producteurs: ["Ministère des Sports"] },
  basilic: { famille: "licence_ouverte", producteurs: ["Ministère de la Culture"] },
  // Calendar, transport, trails.
  education_calendrier: { famille: "licence_ouverte", producteurs: ["Ministère de l'Éducation nationale"] },
  jours_feries: { famille: "licence_ouverte", producteurs: ["Etalab"] },
  // Each organising authority of the networks.
  gtfs_reunion: { famille: "licence_ouverte", producteurs: ["Région Réunion", "CINOR", "TCO", "CIVIS", "CASUD", "CIREST"] },
  gtfs_rt_reunion: { famille: "licence_ouverte", producteurs: ["Région Réunion", "CIVIS", "CASUD"] },
  // The CIVIS decides, Ecovélo runs it.
  altervelo: { famille: "licence_ouverte", producteurs: ["CIVIS"] },
  // The operators of La Réunion's stations, from the copy of the national base bundled with the site (irve/stations.json).
  irve: { famille: "licence_ouverte", producteurs: operateurs() },
  onf_sentiers: { famille: "information_publique", producteurs: ["ONF"] },
  onf_aires_accueil: { famille: "information_publique", producteurs: ["ONF"] },
  osm_randonnees: { famille: "odbl", producteurs: [OSM] },
  // Sport.
  livetrail: { famille: "information_publique", producteurs: ["Association Grand Raid", "Livetrail"] },
  ffhb: { famille: "information_publique", producteurs: ["Fédération française de handball"] },
  ffvb: { famille: "information_publique", producteurs: ["Fédération française de volley"] },
  ffvoile: { famille: "information_publique", producteurs: ["Fédération française de voile"] },
  ffgolf: { famille: "information_publique", producteurs: ["Fédération française de golf"] },
  lrvb: { famille: "information_publique", producteurs: ["Ligue réunionnaise de volley-ball"] },
  lrvb_tournois: { famille: "information_publique", producteurs: ["Ligue réunionnaise de volley-ball"] },
  lsar: { famille: "information_publique", producteurs: ["Ligue du sport automobile de La Réunion"] },
  // A platform: the clubs it names, from its last copy, counted live.
  sportsregions: { famille: "information_publique", producteurs: [] },
  // News and events.
  medias_locaux: { famille: "information_publique", producteurs: ["Clicanoo", "Le Quotidien de La Réunion", "Imaz Press Réunion", "Freedom", "Parallèle Sud", "Témoignages"] },
  prefecture_communiques: { famille: "licence_ouverte", producteurs: [PREFECTURE] },
  openagenda: { famille: "licence_ouverte", producteurs: ["CINOR", "Office de tourisme intercommunal du Nord"] },
  agenda_oti_est: { famille: "information_publique", producteurs: ["Office de tourisme intercommunal de l'Est"] },
  agenda_mairies: { famille: "information_publique", agendas: true },
  agenda_sainte_marie: { famille: "information_publique", agendas: true },
  agenda_salazie: { famille: "information_publique", agendas: true },
  agenda_saint_louis: { famille: "information_publique", agendas: true },
  actus_saint_louis_actus: { famille: "information_publique", agendas: true },
  actus_saint_leu: { famille: "information_publique", agendas: true },
  actus_plaine_des_palmistes_agenda: { famille: "information_publique", agendas: true },
  actus_plaine_des_palmistes_actus: { famille: "information_publique", agendas: true },
  actus_sainte_marie_actus: { famille: "information_publique", agendas: true },
  actus_salazie_actus: { famille: "information_publique", agendas: true },
  salles_spectacle: { famille: "information_publique", agendas: true },
  propositions_associations: { famille: "licence_ouverte", horsCompte: true },
};

/** A body an agenda is read from: its commune for a mairie's, else its own name (a salle). */
const producteurDe = (a: Agenda) => (a.site_commune && a.commune ? commune(a.commune) : a.nom);

/** The producers of a source. */
export function producteursDe(s: SourceInfo, agendas: Agenda[] = AGENDAS): string[] {
  const f = FICHES[s.id];
  if (!f || f.horsCompte) return [];
  return f.agendas ? [...new Set(agendas.filter((a) => a.source.id === s.id).map(producteurDe))] : (f.producteurs ?? []);
}

/** What the code alone counts of the sources: how many, by how many producers, under which licences. */
export function compte(sources: SourceInfo[], agendas: Agenda[] = AGENDAS) {
  const lues = sources.filter((s) => FICHES[s.id] && !FICHES[s.id].horsCompte);
  const licences = {} as Record<Famille, number>;
  for (const s of lues) licences[FICHES[s.id].famille] = (licences[FICHES[s.id].famille] ?? 0) + 1;
  return {
    sources: lues.length,
    producteurs: [...new Set(lues.flatMap((s) => producteursDe(s, agendas)))].sort((a, b) => a.localeCompare(b, "fr")),
    licences,
    ouvertes: lues.filter((s) => FAMILLES[FICHES[s.id].famille].ouverte).length,
  };
}
