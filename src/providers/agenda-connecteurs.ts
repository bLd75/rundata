/**
 * The public events of the associations linked to their platform (connecteurs/, « Relier votre plateforme »), read every
 * 6 hours by the scheduled event (connecteurs/lecture.ts) into the D1 table `evenements_connectes`: an agenda like the
 * others, read from the table rather than from a site. Each event says its association and its platform, « via
 * HelloAsso », with the hour of the last successful reading, and that the platform did not answer since, when so.
 *
 * Never in the open data (agenda ICS and JSON, web/flux-associations.ts): the platform has not allowed it in writing.
 */
import type { Cached } from "../cache.js";
import * as connexions from "../connecteurs/connexions.js";
import { HELLOASSO } from "../connecteurs/helloasso.js";
import { INSEE } from "../places/insee.js";
import { normalize } from "../places/resolve.js";
import type { SourceInfo } from "../types.js";
import { enLigne } from "../web/connecteurs-drapeau.js";
// Types only from agenda.ts, which lists this agenda: a value imported from it would be read before it is defined.
import type { Agenda, AgendaStore, Evenement } from "./agenda.js";
import { communesIn } from "./avis-eau.js";

export const SOURCE = {
  id: "helloasso_associations",
  nom: "HelloAsso, associations reliées à rundata.re",
  organisme: "Associations de La Réunion, via HelloAsso",
  licence: "Pas sous licence ouverte\u00a0: événements publics de chaque association qui a relié son compte, repris avec son accord. Ils ne font pas partie de nos données ouvertes.",
  attribution: "l'association organisatrice, via HelloAsso",
  url: "https://rundata.re/associations",
} satisfies SourceInfo;

export const ID = "connecteurs";
// Read again every quarter of an hour: a reading of the scheduled event shows within it; a withdrawal is written into
// the copy at once (tools/agenda.ts, `rafraichirConnecteurs`).
const FRESH_SECONDS = 900;

interface Ligne {
  connexion: number;
  plateforme: string;
  nom: string;
  reussi_le: number | null;
  lu_le: number | null;
  id: string;
  titre: string;
  debut: string;
  fin: string | null;
  lieu: string | null;
  commune: string | null;
  prix: string | null;
  description: string | null;
  lien: string;
}

const VISIBLES = `SELECT e.connexion, c.plateforme, c.nom, c.reussi_le, c.lu_le, e.id, e.titre, e.debut, e.fin, e.lieu, e.commune, e.prix, e.description, e.lien
FROM evenements_connectes e JOIN connexions c ON c.id = e.connexion
WHERE c.etat = 'actif' AND COALESCE(e.fin, e.debut) >= ? ORDER BY e.debut, e.connexion, e.id`;

const PLATEFORMES: Record<string, string> = { [HELLOASSO.id]: HELLOASSO.nom };
/** Local time at La Réunion, « 2026-10-24T08:00 » (agenda.ts, `toLocal`). */
const local = (t: number) => new Date(t * 1000 + 4 * 3600_000).toISOString().slice(0, 16);
const BARE = new Map(Object.keys(INSEE).map((n) => [normalize(n).replace(/^(le|la|les|l) /, ""), n]));
/** The commune as the platform writes it (« St Pierre », « SAINT-DENIS »), by its official name (agenda.ts, `communeOf`). */
function commune(text: string | null): string | undefined {
  if (!text) return undefined;
  const bare = normalize(text).replace(/\bst\b/g, "saint").replace(/\bste\b/g, "sainte").replace(/^(le|la|les|l) /, "");
  return BARE.get(bare) ?? communesIn(text)[0];
}

/** One event read on a platform, as an agenda's event. */
export function evenement(l: Ligne): Evenement {
  return {
    id: `${l.plateforme}-${l.connexion}-${l.id}`,
    titre: l.titre,
    seances: [{ debut: l.debut, ...(l.fin ? { fin: l.fin } : {}) }],
    ...(l.lieu ? { lieu: l.lieu } : {}),
    ...(commune(l.commune) ? { commune: commune(l.commune) } : {}),
    ...(l.prix ? { prix: l.prix } : {}),
    categories: [],
    ...(l.description ? { description: l.description } : {}),
    lien: l.lien,
    publie_par: l.nom,
    via: {
      plateforme: PLATEFORMES[l.plateforme] ?? l.plateforme,
      lu: local(l.reussi_le ?? 0),
      // Asked since its last good reading, without an answer: said, never read as an empty agenda.
      ...(l.lu_le && l.reussi_le && l.lu_le > l.reussi_le ? { sans_reponse: true as const } : {}),
    },
  };
}

/** The events to come of the active links; none without the database. */
export async function evenements(now: Date): Promise<Evenement[]> {
  const d = connexions.portes();
  if (!d) return [];
  const today = local(now.getTime() / 1000).slice(0, 10);
  return (await d.all<Ligne>(VISIBLES, today)).filter((l) => l.reussi_le).map(evenement);
}

export const CONNECTEURS: Agenda = {
  id: ID,
  nom: "Associations reliées à rundata.re (HelloAsso)",
  source: SOURCE,
  // Whole island: no commune is « covered » by it.
  couvre: [],
  club: true,
  // Without the database (Node, the tests) or before the flag (web/connecteurs-drapeau.ts), nothing, and no subrequest
  // taken from the others.
  load: (cache: AgendaStore, now: Date): Promise<Cached<Evenement[]>> =>
    connexions.portes() && enLigne() ? cache.get(`agenda:${ID}`, FRESH_SECONDS, () => evenements(now)) : Promise.resolve({ value: [], fetchedAt: now, stale: false }),
};
