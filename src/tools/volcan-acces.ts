/**
 * « Puis-je monter au volcan ? »: what the official texts say, place by place, for the level in force. The prefecture's
 * release quoted as written (providers/volcan.ts `releaseText`), the ONF's map for the forest road and the trails, the
 * ORSEC plan for what it defines. Never « ouvert » by deduction: a place a text does not name is said so. Marketing's
 * words.
 *
 * The plan: « Disposition spécifique ORSEC Volcan Piton de la Fournaise », annexed to the prefect's order n° 2242 of
 * 08/11/2021, read on 24/10/2026 in its Wayback Machine copy of 05/04/2025
 * (https://web.archive.org/web/20250405151006/https://www.reunion.gouv.fr/contenu/telechargement/31585/227969/file/dso_volcan_2021.pdf):
 * reunion.gouv.fr refuses our machines. To check again for a newer version once the prefecture answers.
 */
import type { Cached } from "../cache.js";
import { localTime } from "../geo.js";
import type * as onf from "../providers/sentiers.js";
import * as traces from "../providers/traces.js";
import type * as volcan from "../providers/volcan.js";

export const TITRE = "Puis-je monter au volcan ?";
export const CHAPEAU = "Ce que disent les textes officiels, lieu par lieu.";
export const PIED = "Les interdictions peuvent changer à tout moment : seuls font foi les communiqués de la préfecture.";
const VERIFIER = "vérifiez sur reunion.gouv.fr";

const DSO = "dispositif ORSEC Volcan";
const DSO_FULL = "dispositif ORSEC Volcan, arrêté n° 2242 du 08/11/2021";

/** The levels as the plan's table names them (p. 22), lowest first. */
export const NIVEAUX: { niveau: string; libelle: string }[] = [
  { niveau: "Vigilance", libelle: "activité persistante et continue sous le massif" },
  { niveau: "Alerte 1", libelle: "éruption probable ou imminente" },
  { niveau: "Alerte 2", libelle: "éruption en cours" },
  { niveau: "Alerte 2-1", libelle: "L'éruption est située dans l'enclos (y compris dans le cratère Dolomieu) et ne présente pas de menace particulière pour la sécurité des personnes, des biens ou de l'environnement" },
  { niveau: "Alerte 2-2", libelle: "L'éruption est située dans l'enclos et présente une menace directe ou indirecte pour la sécurité des personnes, des biens ou de l'environnement (risque de coupure de la RN2, pluies acides, feux de forêt...)" },
  { niveau: "Alerte 2-3", libelle: "L'éruption est située hors de l'enclos et présente une réelle menace pour la sécurité des personnes, des biens ou de l'environnement (impact possible sur les zones habitées)." },
  { niveau: "Sauvegarde", libelle: "L'éruption est terminée, une réouverture partielle de l'enclos est possible" },
];
export const VERSION = "Version de 2021, la dernière que nous ayons lue.";

/** The plan's words for `niveau` (« éruption probable ou imminente »), undefined for a level it does not name. */
export const libelle = (niveau: string | undefined) => NIVEAUX.find((x) => x.niveau.toLowerCase() === niveau?.toLowerCase())?.libelle;

/** « Alerte 1 : « éruption probable ou imminente » (dispositif ORSEC Volcan, arrêté n° 2242 du 08/11/2021, p. 22). » */
export function definition(niveau: string): string | undefined {
  const n = NIVEAUX.find((x) => x.niveau.toLowerCase() === niveau.toLowerCase());
  return n && `${n.niveau} : « ${n.libelle} » (${DSO_FULL}, p. 22).`;
}

export interface Ligne {
  lieu: string;
  texte: string;
  /** Where it comes from, said after it, with its link: « communiqué de la préfecture du 24/10 ». */
  source?: string;
  lien?: string;
}

export interface Acces {
  titre: string;
  chapeau: string;
  lignes: Ligne[];
  pied: string;
}

// The trails of the Enclos itself (the plan's upper part), told by the Enclos' line: not « hors Enclos ».
const ENCLOS_TRAILS = /enclos|dolomieu|kapor|rivals|caubet|formica/i;
const ROAD = /Route Forestière du Volcan \(RF0?5\)/i;
const day = (iso: string) => localTime(new Date(iso)).split(" ")[0];
const fullDay = (iso: string) => `${day(iso)}/${new Date(Date.parse(iso) + 4 * 3600_000).getUTCFullYear()}`;
// A list's mark before a sentence (« → A ce stade, … »): not the release's words.
const LEAD = /^[→•▪\-–]\s*/;
// In an eruption, the bans a release may write, in this order (marketing): the Enclos, the slopes from the RN2, the
// lava flows from the road, the stops on the RN2.
const BANS = [/reste interdit jusqu.à nouvel ordre/i, /danger mortel/i, /interdit de s.écarter de la route/i, /arrêts intempestifs sur la RN ?2/i];
const hour = (d: Date) => localTime(d).split(" ")[1];
const SAID: Record<string, string> = { ferme: "interdit", fermé: "interdit", partiel: "partiellement ouvert", ouvert: "ouvert" };

/** A sentence as quoted: its linking words left out (« En conséquence, … »), no full stop inside the quotes. */
function quote(s: string): string {
  const t = s.replace(LEAD, "").replace(/^(en conséquence|par conséquent|dans ces conditions|ainsi|par ailleurs|de plus)\s*,\s*/i, "").replace(/[.\s]+$/, "");
  return `« ${t.charAt(0).toUpperCase()}${t.slice(1)} »`;
}

/**
 * The lines for `niveau`, the level in force; `p`: the prefecture's release it comes from, `phrases` its sentences;
 * `carte`: the ONF's map as last read (never built here). Undefined `niveau`: the level could not be read.
 */
export function acces(niveau: string | undefined, p: volcan.Phase | undefined, phrases: string[] | undefined, carte: Cached<onf.Carte> | undefined): Acces {
  const lignes: Ligne[] = [];
  const said = phrases ?? [];
  const release = p && { source: `communiqué de la préfecture du ${day(p.publie)}`, lien: p.lien };
  const same = p && { source: "même communiqué", lien: p.lien };

  if (!niveau) {
    lignes.push({ lieu: "Enclos", texte: `Nous n'avons pas pu lire le dernier communiqué de la préfecture : ${VERIFIER} avant de monter au volcan.` });
  } else if (/^Vigilance/i.test(niveau)) {
    lignes.push({ lieu: "Enclos", texte: "Partie haute de l'Enclos : « l'accès du public non-accompagné est restreint aux seuls sentiers balisés et ouverts »", source: `${DSO}, p. 23` });
  } else if (!p) {
    // The level is pitonlive's, newer than the last release read: that release does not tell this level's rules.
    lignes.push({ lieu: "Enclos", texte: `Le dernier communiqué de la préfecture que nous avons lu est antérieur au niveau affiché : ${VERIFIER} avant de monter au volcan.` });
  } else if (/^Sauvegarde/i.test(niveau)) {
    lignes.push({ lieu: "Enclos", texte: `Enclos : en phase de sauvegarde, « une réouverture partielle de l'enclos est possible » (${DSO}, p. 22). Ce qui est ouvert est dans le communiqué de la préfecture du ${day(p.publie)}.`, lien: p.lien });
  } else {
    const enclos = said.find((x) => /enclos/i.test(x) && /interdit|ferm|ouvert|accès/i.test(x));
    lignes.push({ lieu: "Enclos", texte: `Enclos : ${SAID[p.enclos ?? "ferme"] ?? p.enclos}${enclos ? `. ${quote(enclos)}` : ""}`, ...release });
    // The sentence that says whether the road is open, before any other naming it (« S'aventurer depuis la RN2… »).
    const rn2 = said.find((x) => /\bRN ?2\b[^.]*\b(reste|est) (ouverte|fermée)/i.test(x)) ?? said.find((x) => /\bRN ?2\b|route nationale 2/i.test(x));
    lignes.push(rn2
      ? { lieu: "RN 2", texte: `RN 2 (Grand Brûlé) : ${quote(rn2)}`, ...same }
      : { lieu: "RN 2", texte: `Le dernier communiqué ne dit rien de la RN 2 : ${VERIFIER}.` });
    // In an eruption, the bans of the release shown, quoted exactly with its day, nothing of ours around them; never a
    // former release's (marketing). A sentence already quoted above is not said twice.
    if (/^Alerte 2/i.test(niveau)) {
      const used = new Set([enclos, rn2]);
      for (const re of BANS) {
        const s = said.find((x) => re.test(x) && !used.has(x));
        if (!s) continue;
        used.add(s);
        lignes.push({ lieu: "Interdiction", texte: `« ${s.replace(LEAD, "")} »`, source: `communiqué du ${fullDay(p.publie)}`, lien: p.lien });
      }
    }
  }

  // The forest road from Bourg-Murat: the release's words if it names it, and the ONF's map; never « ouverte ».
  const road = said.find((x) => /route (forestière )?du volcan|\bRF ?0?5\b|route forestière n° ?5/i.test(x));
  const base = `Route du volcan (route forestière depuis Bourg-Murat) : ${road ? quote(road) : "le communiqué n'en dit rien"}`;
  const roads = carte?.value.routes.filter((r) => ROAD.test(r.nom)) ?? [];
  const read = carte && `carte lue à ${hour(carte.fetchedAt)}`;
  lignes.push(
    !roads.length
      ? { lieu: "Route du volcan", texte: `${base} : ${VERIFIER}.` }
      : roads.some((r) => /interdit/i.test(r.circulation))
        ? { lieu: "Route du volcan", texte: `${base}. Fermée selon l'ONF (${read}).` }
        : { lieu: "Route du volcan", texte: `${base}, et l'ONF ne la signale pas fermée (${read}).` },
  );
  // During an eruption, what the plan provides for the road (p. 34), whether the eruption is visible or not.
  if (niveau && /^Alerte 2/i.test(niveau)) {
    lignes.push({ lieu: "Route du volcan", texte: "Pendant une éruption, en cas d'affluence, le plan de la préfecture prévoit que la route du volcan puisse être fermée depuis Bourg-Murat, ou son accès filtré", source: `${DSO}, p. 34` });
  }

  if (niveau && p && !/^Vigilance/i.test(niveau)) {
    const enclos = said.find((x) => /enclos/i.test(x) && /interdit|ferm|ouvert|accès/i.test(x));
    const views = said.filter((x) => x !== enclos && /Bellecombe|belv[ée]d[èe]re|points? de vue/i.test(x));
    lignes.push(views.length
      ? { lieu: "Pas de Bellecombe", texte: `Pas de Bellecombe et points de vue : ${quote(views[0])}`, ...same }
      : enclos && /Bellecombe/i.test(enclos)
        ? { lieu: "Pas de Bellecombe", texte: "Pas de Bellecombe et points de vue : le communiqué ne les nomme que comme départ du sentier de l'Enclos, qui est interdit." }
        : { lieu: "Pas de Bellecombe", texte: `Pas de Bellecombe et points de vue : le communiqué n'en dit rien : ${VERIFIER}.` });
  }

  // The ONF's trails of the volcano's sector, the Enclos' own left to its line.
  if (carte) {
    const when = day(carte.value.mise_a_jour ?? carte.fetchedAt.toISOString());
    const sector = carte.value.sentiers.filter((t) => traces.SENTIERS[t.nom]?.secteur === "Volcan" && !ENCLOS_TRAILS.test(t.nom));
    const shut = [...new Set(sector.filter((t) => t.statut === "fermé").map((t) => t.nom))];
    const head = "Sentiers hors Enclos (Plaine des Sables, Piton Chisny, Nez Coupé de Sainte-Rose…)";
    lignes.push(shut.length
      ? { lieu: "Sentiers hors Enclos", texte: `${head} : ${shut.join(", ")} ${shut.length > 1 ? "fermés" : "fermé"} selon l'ONF (${when}).`, lien: "/sentiers" }
      : { lieu: "Sentiers hors Enclos", texte: `${head} : l'ONF ne signale pas de fermeture dans le secteur du volcan (${when}).`, lien: "/sentiers" });
    if (niveau && /^Vigilance/i.test(niveau)) {
      const open = [...new Set(carte.value.sentiers.filter((t) => ENCLOS_TRAILS.test(t.nom) && t.statut === "ouvert").map((t) => t.nom))];
      if (open.length) lignes.splice(1, 0, { lieu: "Sentiers de l'Enclos", texte: `Sentiers de l'Enclos ouverts selon l'ONF (${when}) : ${open.join(", ")}.` });
    }
  }
  return { titre: TITRE, chapeau: CHAPEAU, lignes, pied: PIED };
}

const absolute = (lien: string) => (lien.startsWith("/") ? `https://rundata.re${lien}` : lien);

/** A line as the AI reads it: its source and link after it. */
export const lineText = (l: Ligne) =>
  l.source ? `${l.texte} (${l.source}${l.lien ? ` : ${absolute(l.lien)}` : ""}).` : l.lien ? `${l.texte} ${absolute(l.lien)}` : l.texte;
