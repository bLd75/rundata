/**
 * The clubs behind the teams of the regional championships. The FFVB names its teams by acronyms (« VBSP 2 »,
 * « TGV 2A ») and its halls by a quarter (« 12 ÈME KM », « CENTRE VILLE »), so a question about Saint-Pierre or the
 * south finds nothing in the text of a match: the club says where it is. The table is in clubs.json.
 */
import table from "./clubs.json" with { type: "json" };
import { normalize } from "../places/resolve.js";

export interface Club {
  /** As the federation writes it in its results (volley). */
  sigle?: string;
  nom: string;
  commune: string;
  salle?: string;
  alias?: string[];
}

export type ClubSport = "volley" | "handball";
const CLUBS: Record<ClubSport, Club[]> = { volley: table.volley, handball: table.handball };
export const ZONES: Record<string, string[]> = table.zones;

const key = (s: string) => normalize(s).replace(/\bst\b/g, "saint").replace(/\bste\b/g, "sainte");

// A team is its club and a number: « VBSP 2 », « TGV 2A », « Le Port Handball 1 ».
const TEAM_NUMBER = / \d+[a-z]?$/;
const BY_TEAM: Record<ClubSport, Map<string, Club>> = {
  volley: new Map(CLUBS.volley.map((c) => [key(c.sigle ?? c.nom), c])),
  handball: new Map(CLUBS.handball.map((c) => [key(c.nom), c])),
};

/** The club of a team as the federation names it, if the table knows it. */
export function clubOf(sport: ClubSport, team: string): Club | undefined {
  const k = key(team);
  return BY_TEAM[sport].get(k) ?? BY_TEAM[sport].get(k.replace(TEAM_NUMBER, ""));
}

// Words that name no club in particular: a question « volley à Saint-Denis » is about a town, not about the VBC.
const GENERIC = new Set([
  "volley", "ball", "volleyball", "vb", "vbc", "club", "handball", "hand", "hbc", "association", "as", "us", "sportive", "sport",
  "de", "des", "du", "la", "le", "les", "l", "d", "et", "equipe", "jeunesse", "union", "athletique", "olympique",
]);
const COMMUNE_WORDS = new Set(Object.values(table.zones).flat().flatMap((c) => key(c).split(" ")));

/**
 * The clubs a question names: by acronym (« VBSP », « tgv »), by an alias (« Gecko »), or by words of the full name
 * that are neither generic nor a town's (« Phoenix », « Aigles Blancs »). A town alone names no club.
 */
export function clubsNamed(text: string, sports: ClubSport[] = ["volley", "handball"]): { sport: ClubSport; club: Club }[] {
  const q = key(text);
  if (!q) return [];
  const words = q.split(" ").filter((w) => !GENERIC.has(w));
  const asked = [q, q.replace(TEAM_NUMBER, ""), words.join(" ")];
  const out: { sport: ClubSport; club: Club }[] = [];
  for (const sport of sports) {
    for (const club of CLUBS[sport]) {
      const names = [club.sigle, ...(club.alias ?? [])].filter((x): x is string => !!x).map(key);
      if (asked.some((a) => names.includes(a))) {
        out.push({ sport, club });
        continue;
      }
      const own = new Set(key(club.nom).split(" "));
      const telling = words.filter((w) => !COMMUNE_WORDS.has(w));
      if (telling.length && words.every((w) => own.has(w))) out.push({ sport, club });
    }
  }
  return out;
}

/** « le sud », « dans l'Ouest », « Nord » → the zone and its communes. */
export function zoneOf(text: string): { nom: string; communes: string[] } | undefined {
  const q = normalize(text).replace(/^(?:dans |vers |a |au |en )?(?:le |l |la )?/, "").replace(/ (?:de l )?(?:ile|reunion|la reunion)$/, "").trim();
  const nom = Object.keys(ZONES).find((z) => normalize(z) === q);
  return nom ? { nom, communes: ZONES[nom] } : undefined;
}
