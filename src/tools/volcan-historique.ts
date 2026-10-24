/**
 * The alerts of the volcano before this one: « combien de temps durent les alertes, et que s'est-il passé les dernières
 * fois ? ». Only the episodes since the ORSEC plan of 08/11/2021 whose start and end are each written in a dated
 * release of the prefecture we read, quoted as written (data-run, marketing): not a complete history, and said so.
 * No duration nor share computed from them.
 *
 * The releases as read on 24/10/2026 in their Wayback Machine copies (reunion.gouv.fr refuses our machines); the copies
 * are the tests' fixtures (test/fixtures/volcan-historique), each quote checked there. Left out: the alert of April
 * 2023, its page updated after the alert was lifted (no day for its start); the alerts of 18/10/2021, 22/12/2021 and
 * 07/09/2022, no release of their end found.
 */
import { localTime } from "../geo.js";

export interface Communique {
  /** The day the page gives, ISO. */
  jour: string;
  titre: string;
  /** Its copy in the Wayback Machine. */
  copie: string;
  /** The page gives the day of an update only, after the event. */
  mis_a_jour?: true;
}

export interface Moment {
  /** The day of the event, as the release writes it, ISO. */
  jour: string;
  /** What it is, in the release's words: « alerte 1 », « éruption débutée »… */
  quoi: string;
  /** The release's words, quoted as written. */
  dit: string;
  communique: Communique;
}

export interface Episode {
  debut: Moment[];
  fin: Moment;
}

const copy = (stamp: string, url: string) => `https://web.archive.org/web/${stamp}/${url}`;
const GOUV = "https://www.reunion.gouv.fr";

const R = {
  sept2022a1: { jour: "2022-09-19", titre: "Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos.", copie: copy("20220922175546", `${GOUV}/piton-de-la-fournaise-passage-en-alerte-1-a9890.html`) },
  sept2022a21: { jour: "2022-09-19", titre: "Piton de la Fournaise : passage en alerte 2-1 Eruption dans l’enclos", copie: copy("20220922175548", `${GOUV}/piton-de-la-fournaise-passage-en-alerte-2-1-a9891.html`) },
  oct2022: { jour: "2022-10-05", titre: "Piton de la Fournaise Éruption arrêtée mais enclos toujours fermé", copie: copy("20221005174746", `${GOUV}/piton-de-la-fournaise-eruption-arretee-mais-enclos-a9951.html`) },
  juil2023a1: { jour: "2023-07-02", titre: "Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", copie: copy("20230703082127", `${GOUV}/Actualites/Communiques-de-presse/Piton-de-la-Fournaise-passage-en-alerte-1-fermeture-de-l-enclos3`) },
  juil2023rappel: { jour: "2023-07-25", titre: "Éruption Piton de la Fournaise : le préfet de La Réunion rappelle qu’il est interdit et dangereux de tenter d’accéder aux coulées de lave depuis la RN2", copie: copy("20230804121314", `${GOUV}/Actualites/Urgences/Eruption-le-prefet-rappelle-qu-il-est-interdit-et-dangereux-de-tenter-d-acceder-aux-coulees-de-lave`) },
  aout2023: { jour: "2023-09-06", titre: "Piton de la Fournaise – réouverture totale de l’enclos", copie: copy("20240528000717", `${GOUV}/Actualites/Communique-de-presse/Piton-de-la-Fournaise-reouverture-totale-de-l-enclos`), mis_a_jour: true as const },
  janv2026a1: { jour: "2026-01-01", titre: "Piton de la Fournaise : passage en alerte 1 - fermeture de l’enclos", copie: copy("20260101111021", `${GOUV}/Actualites/Communiques-de-presse/Piton-de-la-Fournaise-passage-en-alerte-1-fermeture-de-l-enclos4`) },
  janv2026v: { jour: "2026-01-02", titre: "Piton de la Fournaise : retour en phase de vigilance", copie: copy("20260102112551", `${GOUV}/Actualites/Communiques-de-presse/Piton-de-la-Fournaise-retour-en-phase-de-vigilance`) },
  janv2026a21: { jour: "2026-01-18", titre: "Piton de la Fournaise : éruption dans l’enclos", copie: copy("20260118182615", `${GOUV}/Actualites/Communiques-de-presse/Piton-de-la-Fournaise-eruption-dans-l-enclos`) },
  janv2026v2: { jour: "2026-01-27", titre: "Piton de la Fournaise : passage en phase de vigilance", copie: copy("20260129081540", `${GOUV}/Actualites/Communiques-de-presse/Acces-a-l-enclos-avec-restrictions`) },
  mai2026: { jour: "2026-05-07", titre: "Piton de la Fournaise : réouverture partielle de l’enclos", copie: copy("20260507190343", `${GOUV}/Actualites/Communiques-de-presse/Piton-de-la-Fournaise-reouverture-partielle-de-l-enclos`) },
} satisfies Record<string, Communique>;

/** Newest first. */
export const EPISODES: Episode[] = [
  {
    // The start of the eruption, not of an alert: no level read for that day, the release of 13/02 not found (data-run).
    debut: [{ jour: "2026-02-13", quoi: "éruption débutée (selon le communiqué du 07/05/2026)", dit: "Suite à la fin de l'éruption volcanique débutée le 13 février 2026", communique: R.mai2026 }],
    fin: { jour: "2026-05-07", quoi: "retour en phase de vigilance", dit: "Retour en phase de vigilance à partir de 15h", communique: R.mai2026 },
  },
  {
    debut: [{ jour: "2026-01-18", quoi: "alerte 2-1", dit: "Déclenchement du passage en alerte 2.1", communique: R.janv2026a21 }],
    fin: { jour: "2026-01-27", quoi: "passage en phase de vigilance", dit: "Les réouvertures de sentiers autorisées seront effectives à compter du mardi 27 janvier 2026 18h00", communique: R.janv2026v2 },
  },
  {
    debut: [{ jour: "2026-01-01", quoi: "alerte 1", dit: "Piton de la Fournaise : passage en alerte 1 - fermeture de l’enclos", communique: R.janv2026a1 }],
    fin: { jour: "2026-01-02", quoi: "retour en phase de vigilance", dit: "le préfet de La Réunion décide de revenir en phase de vigilance du dispositif spécifique ORSEC du volcan du Piton de la Fournaise à compter de ce vendredi 2 janvier 2026 midi", communique: R.janv2026v },
  },
  {
    debut: [
      { jour: "2023-07-02", quoi: "alerte 1", dit: "Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", communique: R.juil2023a1 },
      { jour: "2023-07-02", quoi: "alerte 2-1", dit: "Dans la matinée du 2 juillet, le préfet a déclenché la phase d’alerte 2-1", communique: R.juil2023rappel },
    ],
    fin: { jour: "2023-08-31", quoi: "retour en phase de vigilance", dit: "l’enclos est désormais accessible au public à compter de ce jeudi 31 août 2023", communique: R.aout2023 },
  },
  {
    debut: [
      { jour: "2022-09-19", quoi: "alerte 1", dit: "Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", communique: R.sept2022a1 },
      { jour: "2022-09-19", quoi: "alerte 2-1", dit: "Piton de la Fournaise : passage en alerte 2-1 Eruption dans l’enclos", communique: R.sept2022a21 },
    ],
    // Not a reopening: the eruption stopped, the Enclos still closed, as written (data-run).
    fin: { jour: "2022-10-05", quoi: "éruption arrêtée", dit: "Éruption arrêtée mais enclos toujours fermé", communique: R.oct2022 },
  },
];

// Worded by marketing.
export const TITRE = "Les alertes précédentes";
export const CHAPEAU =
  "Depuis le plan ORSEC de novembre 2021, les épisodes dont le début et la fin sont chacun écrits dans un communiqué de la préfecture que nous avons retrouvé, cités tels quels. " +
  "Ce n'est pas un historique complet : un épisode dont il manque l'un des deux communiqués n'y figure pas.";
export const NOTE = "Liens vers les copies des communiqués conservées par la Wayback Machine (archive.org).";

/** « 19/09/2022 ». */
export const date = (iso: string) => localTime(new Date(`${iso}T12:00:00+04:00`)).split(" ")[0] + `/${iso.slice(0, 4)}`;
/** « communiqué du 19/09/2022 », « communiqué mis à jour le 06/09/2023 ». */
export const label = (c: Communique) => (c.mis_a_jour ? `communiqué mis à jour le ${date(c.jour)}` : `communiqué du ${date(c.jour)}`);

/** A moment as the AI reads it: « 19/09/2022, alerte 1 : « … » (communiqué du 19/09/2022 : <copie>) ». */
export const momentText = (m: Moment) => `${date(m.jour)}, ${m.quoi} : « ${m.dit} » (${label(m.communique)} : ${m.communique.copie})`;

/** For volcan_seismes: the episodes, and what the list is. */
export function precedentes() {
  return {
    note: `${CHAPEAU} ${NOTE}`,
    episodes: EPISODES.map((e) => ({ debut: e.debut.map(momentText), fin: momentText(e.fin) })),
  };
}

/** One sentence for the summary: the days and what they were, newest first. */
export const resumeText = () =>
  `Alertes précédentes dont le début et la fin sont écrits dans un communiqué de la préfecture (liste partielle, depuis novembre 2021) : ${EPISODES.map((e) =>
    `${e.debut.map((m) => `${date(m.jour)} ${m.quoi}`).join(", ")} → ${date(e.fin.jour)} ${e.fin.quoi}`).join(" ; ")}.`;
