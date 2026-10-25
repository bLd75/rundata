/**
 * The alerts of the volcano before this one: « combien de temps durent les alertes, et que s'est-il passé les dernières
 * fois ? ». Only the episodes since 2016 whose start and end are each written in a dated release of the prefecture we
 * read, quoted as written (data-run, marketing): not a complete history, and said so. Before the ORSEC plan of
 * 08/11/2021, the levels of the plan then, word for word. No duration nor share computed from them.
 *
 * The releases as read on 24/10/2026 in their Wayback Machine copies (reunion.gouv.fr refuses our machines); the copies
 * are the tests' fixtures (test/fixtures/volcan-historique), each quote checked there. Left out: the alert of April
 * 2023, its page updated after the alert was lifted (no day for its start); the alerts of 18/10/2021, 22/12/2021 and
 * 07/09/2022, no release of their end found. Before 2021, the copies of the old site read from 2016: left out the
 * eruption of 27/04/2018, the alerts of 07/07/2020, 28/09/2020, 04/12/2020 and 09/04/2021, no
 * release of their end found; the end of 13/07/2018 and 21/02/2020, no release of their start found.
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
  /** What it is, in the release's words, never what we deduce: « alerte 1 », « éruption débutée »… */
  quoi: string;
  /** Said after `quoi` where no link tells it, to the AI: the release that dates it, when not its own day's. */
  selon?: string;
  /** The release's words, quoted as written; « […] » where a passage is left out. */
  dit: string;
  communique: Communique;
}

export interface Episode {
  debut: Moment[];
  fin: Moment;
  /** A new alert the same day as the end, whose end is in no release we read: said, or the reader thinks all stopped. */
  puis?: Moment;
}

const copy = (stamp: string, url: string) => `https://web.archive.org/web/${stamp}/${url}`;
const GOUV = "https://www.reunion.gouv.fr";
// The site before 2022, as the Wayback Machine keeps it.
const AVANT = "http://www.reunion.gouv.fr";

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
  mai2016a22: { jour: "2016-05-26", titre: "Piton de la Fournaise : éruption en cours dans l’enclos, passage en alerte 2-2", copie: copy("20160530083219", `${AVANT}/piton-de-la-fournaise-eruption-en-cours-dans-l-a1635.html`) },
  mai2016s: { jour: "2016-05-27", titre: "Activité volcanique au Piton de la Fournaise : phase de sauvegarde", copie: copy("20160606055634", `${AVANT}/activite-volcanique-au-piton-de-la-fournaise-phase-a1641.html`) },
  sept2016a1: { jour: "2016-09-11", titre: "Piton de la Fournaise : passage en alerte 1 éruption probable ou imminente 11/09/2016 - 8h30", copie: copy("20170228164612", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-1-eruption-a1971.html`) },
  sept2016a22: { jour: "2016-09-11", titre: "Piton de la Fournaise : passage en alerte 2-2 éruption en cours dans l’enclos - 11/09/2016 - 8h41", copie: copy("20160918043300", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-2-2-a1972.html`) },
  sept2016s: { jour: "2016-09-18", titre: "Activité volcanique au Piton de la Fournaise : Passage en phase sauvegarde", copie: copy("20160923171048", `${AVANT}/activite-volcanique-au-piton-de-la-fournaise-a2013.html`) },
  janv2017a1: { jour: "2017-01-31", titre: "Piton de la Fournaise : passage en alerte 1 éruption probable ou imminente", copie: copy("20170204080123", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-1-eruption-a2515.html`) },
  janv2017a22: { jour: "2017-01-31", titre: "Piton de la Fournaise : alerte 2-2 éruption en cours dans l’enclos depuis le 31/01/2017", copie: copy("20170321041841", `${AVANT}/piton-de-la-fournaise-alerte-2-2-eruption-en-cours-a2516.html`) },
  fev2017s: { jour: "2017-02-28", titre: "Activité volcanique au Piton de la Fournaise : passage en phase sauvegarde 28/02/17 - 18h", copie: copy("20171104050000", `${AVANT}/activite-volcanique-au-piton-de-la-fournaise-a2625.html`) },
  mai2017a1: { jour: "2017-05-17", titre: "Piton de la Fournaise : passage en alerte 1 éruption probable ou imminente", copie: copy("20170523204344", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-1-eruption-a2834.html`) },
  mai2017a22: { jour: "2017-05-17", titre: "Piton de la Fournaise : passage en alerte 2-2 éruption en cours dans l’enclos, mercredi 17 mai 2017", copie: copy("20170603214253", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-2-2-a2837.html`) },
  juin2017v: { jour: "2017-06-01", titre: "Piton de la Fournaise : retour en vigilance volcanique à compter du vendredi 2 juin 2017 à 06h00", copie: copy("20170621004831", `${AVANT}/piton-de-la-fournaise-retour-en-vigilance-a2886.html`) },
  juil2017a22: { jour: "2017-07-14", titre: "Piton de la Fournaise : alerte 2-2 éruption en cours dans l’enclos depuis le 14 juillet 2017, 0h50", copie: copy("20170731083243", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-2-2-a2994.html`) },
  aout2017s: { jour: "2017-08-28", titre: "Activité volcanique au Piton de la Fournaise - Passage en phase sauvegarde 28/08/17", copie: copy("20170830231914", `${AVANT}/activite-volcanique-au-piton-de-la-fournaise-a3090.html`) },
  avr2018a1: { jour: "2018-04-04", titre: "Piton de la Fournaise : passage en alerte 1 éruption probable ou imminente - 4 avril 2018 - 8h30", copie: copy("20180528231259", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-1-eruption-a3747.html`) },
  avr2018v: { jour: "2018-04-13", titre: "Activité volcanique au Piton de la Fournaise : Retour en vigilance volcanique", copie: copy("20180419202214", `${AVANT}/activite-volcanique-au-piton-de-la-fournaise-a3801.html`) },
  sept2018a1: { jour: "2018-09-15", titre: "Piton de la Fournaise : passage en alerte 1 - éruption probable à brève échéance", copie: copy("20180920071255", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-1-eruption-a4333.html`) },
  sept2018a22: { jour: "2018-09-15", titre: "Piton de la Fournaise : passage en alerte 2-2 - éruption en cours dans l’enclos", copie: copy("20180918092550", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-2-2-a4334.html`) },
  nov2018s: { jour: "2018-11-01", titre: "Activité volcanique au Piton de la Fournaise : passage en phase sauvegarde jeudi 1er novembre 2018", copie: copy("20181103175201", `${AVANT}/activite-volcanique-au-piton-de-la-fournaise-a4497.html`) },
  fev2019a1: { jour: "2019-02-16", titre: "Piton de la Fournaise : passage en alerte 1 - éruption probable à brève échéance", copie: copy("20190222184929", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-1-eruption-a4937.html`) },
  fev2019a22: { jour: "2019-02-18", titre: "Piton de la Fournaise : passage en alerte 2-2, éruption en cours dans l’enclos", copie: copy("20190221071500", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-2-2-a4938.html`) },
  fev2019a22b: { jour: "2019-02-19", titre: "Piton de la Fournaise : passage en alerte 2-2 éruption en cours dans l’enclos", copie: copy("20190222142555", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-2-2-a4948.html`) },
  fev2019s: { jour: "2019-02-19", titre: "Piton de la Fournaise : passage en phase sauvegarde mardi 19 février 2019", copie: copy("20190222184934", `${AVANT}/piton-de-la-fournaise-passage-en-phase-sauvegarde-a4941.html`) },
  aout2019a22: { jour: "2019-08-11", titre: "Piton de la Fournaise : passage en alerte 2-2 éruption en cours dans l’enclos", copie: copy("20190821141522", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-2-2-a5590.html`) },
  sept2019v: { jour: "2019-09-03", titre: "Piton de la Fournaise : retour en phase de vigilance et accès restreint à partie haute de l’Enclos", copie: copy("20190919172834", `${AVANT}/piton-de-la-fournaise-retour-en-phase-de-vigilance-a5693.html`) },
  oct2019a1: { jour: "2019-10-21", titre: "Piton de la Fournaise : passage en alerte 1 éruption probable ou imminentee 21 octobre 2019 à 21h30", copie: copy("20191120145353", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-1-eruption-a5881.html`) },
  oct2019v: { jour: "2019-10-22", titre: "Piton de la Fournaise : retour en phase de vigilance et accès restreint à partie haute de l’Enclos", copie: copy("20191024185548", `${AVANT}/piton-de-la-fournaise-retour-en-phase-de-vigilance-a5902.html`) },
  oct2019a22: { jour: "2019-10-25", titre: "Piton de la Fournaise : passage en alerte 2-2 éruption en cours dans l’enclos", copie: copy("20191026230150", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-2-2-a5903.html`) },
  oct2019s: { jour: "2019-10-28", titre: "Activité volcanique au Piton de la Fournaise : passage en phase sauvegarde lundi 28 octobre 2019", copie: copy("20191030035750", `${AVANT}/activite-volcanique-au-piton-de-la-fournaise-a5915.html`) },
  avr2020a22: { jour: "2020-04-02", titre: "Piton de la Fournaise : passage en alerte 2-2 éruption en cours dans l’enclos", copie: copy("20200407092146", `${AVANT}/piton-de-la-fournaise-passage-en-alerte-2-2-a6476.html`) },
  avr2020s: { jour: "2020-04-06", titre: "Activité volcanique au Piton de la Fournaise Passage en phase de sauvegarde", copie: copy("20200411015706", `${AVANT}/activite-volcanique-au-piton-de-la-fournaise-a6487.html`) },
} satisfies Record<string, Communique>;

/** Newest first. */
export const EPISODES: Episode[] = [
  {
    // The start of the eruption, not of an alert: no level read for that day, the release of 13/02 not found (data-run).
    debut: [{ jour: "2026-02-13", quoi: "éruption débutée", selon: "selon le communiqué du 07/05/2026", dit: "Suite à la fin de l'éruption volcanique débutée le 13 février 2026", communique: R.mai2026 }],
    fin: { jour: "2026-05-07", quoi: "retour en phase de vigilance", dit: "Retour en phase de vigilance à partir de 15h", communique: R.mai2026 },
  },
  {
    debut: [{ jour: "2026-01-18", quoi: "alerte 2-1", dit: "Déclenchement du passage en alerte 2.1", communique: R.janv2026a21 }],
    fin: { jour: "2026-01-27", quoi: "réouverture des sentiers", dit: "Les réouvertures de sentiers autorisées seront effectives à compter du mardi 27 janvier 2026 18h00", communique: R.janv2026v2 },
  },
  {
    debut: [{ jour: "2026-01-01", quoi: "alerte 1", dit: "Piton de la Fournaise : passage en alerte 1 - fermeture de l’enclos", communique: R.janv2026a1 }],
    fin: { jour: "2026-01-02", quoi: "retour en phase de vigilance", dit: "le préfet de La Réunion décide de revenir en phase de vigilance […] à compter de ce vendredi 2 janvier 2026 midi", communique: R.janv2026v },
  },
  {
    debut: [
      { jour: "2023-07-02", quoi: "alerte 1", dit: "Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", communique: R.juil2023a1 },
      { jour: "2023-07-02", quoi: "alerte 2-1", dit: "Dans la matinée du 2 juillet, le préfet a déclenché la phase d’alerte 2-1", communique: R.juil2023rappel },
    ],
    fin: { jour: "2023-08-31", quoi: "Enclos accessible au public", dit: "l’enclos est désormais accessible au public à compter de ce jeudi 31 août 2023", communique: R.aout2023 },
  },
  {
    debut: [
      { jour: "2022-09-19", quoi: "alerte 1", dit: "Piton de la Fournaise : passage en alerte 1, fermeture de l’enclos", communique: R.sept2022a1 },
      { jour: "2022-09-19", quoi: "alerte 2-1", dit: "Piton de la Fournaise : passage en alerte 2-1 Eruption dans l’enclos", communique: R.sept2022a21 },
    ],
    // Not a reopening: the eruption stopped, the Enclos still closed, as written (data-run).
    fin: { jour: "2022-10-05", quoi: "éruption arrêtée", dit: "Éruption arrêtée mais enclos toujours fermé", communique: R.oct2022 },
  },
  // Before the plan of 08/11/2021: the levels of the plan then (« alerte 2-2 », « phase de sauvegarde »), as the releases
  // write them. The end is the first release that leaves the alert. The plan's name in « » is left out of the quotes.
  {
    debut: [{ jour: "2020-04-02", quoi: "alerte 2-2", dit: "le Préfet a décidé la mise en œuvre de la phase d’alerte 2-2 […] ce jeudi 2 avril 2020 à 13h", communique: R.avr2020a22 }],
    fin: { jour: "2020-04-06", quoi: "passage en phase de sauvegarde", dit: "le préfet de La Réunion a décidé le passage en phase de sauvegarde […] le lundi 6 avril 2020 à 16h", communique: R.avr2020s },
  },
  {
    debut: [{ jour: "2019-10-25", quoi: "alerte 2-2", dit: "le Préfet a décidé la mise en œuvre de la phase d’alerte 2-2 […] ce vendredi 25 octobre à 15h", communique: R.oct2019a22 }],
    fin: { jour: "2019-10-28", quoi: "passage en phase de sauvegarde", dit: "le préfet de la Réunion a décidé le passage en phase de sauvegarde […] le lundi 28 octobre 2019", communique: R.oct2019s },
  },
  {
    debut: [{ jour: "2019-10-21", quoi: "alerte 1", dit: "le préfet de la Réunion a décidé de déclencher l’alerte 1 […] à compter de ce lundi 21 octobre 2019 à 21h30", communique: R.oct2019a1 }],
    fin: { jour: "2019-10-23", quoi: "retour en phase de vigilance", dit: "le préfet de La Réunion a décidé de revenir en phase de VIGILANCE […] à compter du mercredi 23 octobre 2019 à 20h00", communique: R.oct2019v },
  },
  {
    debut: [{ jour: "2019-08-11", quoi: "alerte 2-2", dit: "le Préfet a décidé la mise en œuvre de la phase d’alerte 2-2 […] ce dimanche 11 août 2019 à 17h15", communique: R.aout2019a22 }],
    fin: { jour: "2019-09-04", quoi: "retour en phase de vigilance", dit: "le préfet de La Réunion a décidé de revenir en phase de VIGILANCE […] à compter du mercredi 4 septembre 2019 à 7h00", communique: R.sept2019v },
  },
  {
    debut: [
      { jour: "2019-02-16", quoi: "alerte 1", dit: "le préfet a décidé de mettre en œuvre la phase d’alerte 1 […] à compter de ce jour à 16h30", communique: R.fev2019a1 },
      { jour: "2019-02-18", quoi: "alerte 2-2", dit: "le Préfet a décidé la mise en œuvre de la phase d’alerte 2-2 […] ce lundi 18 février à 10h15", communique: R.fev2019a22 },
    ],
    fin: { jour: "2019-02-19", quoi: "passage en phase de sauvegarde", dit: "le préfet de La Réunion a décidé le passage en phase de sauvegarde […] à compter de 03h30 le mardi 19 février 2019", communique: R.fev2019s },
    // No release of its end found (marketing).
    puis: { jour: "2019-02-19", quoi: "alerte 2-2", dit: "le Préfet a décidé la mise en œuvre de la phase d’alerte 2-2 […] ce mardi 19 février à 18h30", communique: R.fev2019a22b },
  },
  {
    debut: [
      { jour: "2018-09-15", quoi: "alerte 1", dit: "le préfet a décidé de mettre en œuvre la phase d’alerte 1 […] à compter de ce jour à 2h30", communique: R.sept2018a1 },
      { jour: "2018-09-15", quoi: "alerte 2-2", dit: "le Préfet a décidé la mise en œuvre de la phase d’alerte 2-2", communique: R.sept2018a22 },
    ],
    fin: { jour: "2018-11-01", quoi: "passage en phase de sauvegarde", dit: "le préfet de La Réunion a décidé le passage en phase de sauvegarde […] à compter de 07H00 le jeudi 1er novembre 2018", communique: R.nov2018s },
  },
  {
    // The release of the alert of 03/04 not kept: the start of the eruption, dated by the release of the next day, which
    // lowers the level to the alert 1 (not a start, so not shown).
    debut: [{ jour: "2018-04-03", quoi: "éruption débutée", selon: "selon le communiqué du 04/04/2018", dit: "l’activité éruptive de surface débutée mardi 3 avril 2018 à 10h40 heure locale", communique: R.avr2018a1 }],
    fin: { jour: "2018-04-14", quoi: "retour en phase de vigilance volcanique", dit: "le préfet de La Réunion a décidé le retour en phase de VIGILANCE VOLCANIQUE […] à compter de 8h00 ce samedi 14 avril 2018", communique: R.avr2018v },
  },
  {
    debut: [{ jour: "2017-07-14", quoi: "alerte 2-2", dit: "le préfet de la Réunion a déclenché ce 14 juillet 2017 à 00h50, l’alerte 2-2", communique: R.juil2017a22 }],
    fin: { jour: "2017-08-28", quoi: "passage en phase de sauvegarde", dit: "le préfet de La Réunion a décidé le passage en phase de sauvegarde […] à compter de 17h00 ce lundi 28 août 2017", communique: R.aout2017s },
  },
  {
    debut: [
      { jour: "2017-05-17", quoi: "alerte 1", dit: "le préfet de La Réunion a décidé de déclencher l’alerte 1 […] à compter de ce mercredi 17 mai 2017 à 14h20", communique: R.mai2017a1 },
      { jour: "2017-05-17", quoi: "alerte 2-2", dit: "le préfet de la Réunion a déclenché ce jour à 21h, l’alerte 2-2", communique: R.mai2017a22 },
    ],
    fin: { jour: "2017-06-02", quoi: "retour en phase de vigilance", dit: "le préfet de La Réunion a décidé de revenir en phase de VIGILANCE […] à compter du vendredi 2 juin 2017 à 6H00", communique: R.juin2017v },
  },
  {
    debut: [
      { jour: "2017-01-31", quoi: "alerte 1", dit: "le préfet a décidé de mettre en œuvre la phase d’alerte 1 […] à compter de ce jour à 15h27", communique: R.janv2017a1 },
      { jour: "2017-01-31", quoi: "alerte 2-2", dit: "le préfet de la Réunion a déclenché le 31 janvier 2017 à 20h10 l’alerte 2-2", communique: R.janv2017a22 },
    ],
    fin: { jour: "2017-02-28", quoi: "passage en phase de sauvegarde", dit: "le préfet de La Réunion a décidé le passage en phase de SAUVEGARDE […] à compter de 18h00 ce mardi 28 février 2017", communique: R.fev2017s },
  },
  {
    debut: [
      { jour: "2016-09-11", quoi: "alerte 1", dit: "le préfet a décidé de mettre en œuvre la phase d’alerte 1 […] à compter de ce jour à 8h30", communique: R.sept2016a1 },
      { jour: "2016-09-11", quoi: "alerte 2-2", dit: "le préfet de la Réunion a déclenché ce jour à 8h30 l’alerte 2-2", communique: R.sept2016a22 },
    ],
    fin: { jour: "2016-09-18", quoi: "passage en phase de sauvegarde", dit: "le préfet de La Réunion a décidé le passage en phase de sauvegarde […] à compter de 8h30 ce dimanche 18 septembre 2016", communique: R.sept2016s },
  },
  {
    debut: [{ jour: "2016-05-26", quoi: "alerte 2-2", dit: "le préfet de la Réunion a déclenché ce jour (jeudi 26 mai 2016) à 8h30 l’alerte 2-2", communique: R.mai2016a22 }],
    fin: { jour: "2016-05-27", quoi: "passage en phase de sauvegarde", dit: "le préfet de La Réunion a décidé le passage en phase de sauvegarde […] à compter de 12h40 le vendredi 27 mai 2016", communique: R.mai2016s },
  },
];

/** The ORSEC plan in force today, from this day: the episodes before it are under its predecessor's levels. */
export const PLAN_2021 = "2021-11-08";
export const avant2021 = (e: Episode) => e.debut[0].jour < PLAN_2021;

// Worded by marketing.
export const TITRE = "Les alertes précédentes";
export const CHAPEAU =
  "Voici, depuis 2016, les épisodes dont le début et la fin sont chacun écrits dans un communiqué de la préfecture que nous avons retrouvé. " +
  "Les phrases sont citées telles quelles. Ce n'est pas un historique complet\u00a0: un épisode dont il manque l'un des deux communiqués n'y figure pas.";
export const NOTE = "Liens vers les copies des communiqués conservées par la Wayback Machine (archive.org).";
export const avantTitre = (n: number) => `De 2016 à novembre 2021 (${n}\u00a0épisodes)`;
export const PUIS = "Le même jour, nouvelle";
export const SANS_FIN = "Sa fin n'est pas dans les communiqués que nous avons retrouvés.";
export const AVANT_2021 = "Avant novembre 2021, les niveaux d'alerte étaient ceux du plan précédent : ils sont cités tels que les communiqués les écrivent.";

/** « 19/09/2022 ». */
export const date = (iso: string) => localTime(new Date(`${iso}T12:00:00+04:00`)).split(" ")[0] + `/${iso.slice(0, 4)}`;
/** « communiqué du 19/09/2022 », « communiqué mis à jour le 06/09/2023 ». */
export const label = (c: Communique) => (c.mis_a_jour ? `communiqué mis à jour le ${date(c.jour)}` : `communiqué du ${date(c.jour)}`);

/** A moment as the AI reads it: « 19/09/2022, alerte 1 : « … » (communiqué du 19/09/2022 : <copie>) ». */
export const momentText = (m: Moment) => `${date(m.jour)}, ${quoi(m)} : « ${m.dit} » (${label(m.communique)} : ${m.communique.copie})`;
const quoi = (m: Moment) => (m.selon ? `${m.quoi} (${m.selon})` : m.quoi);

/** For volcan_seismes: the episodes, and what the list is. */
export function precedentes() {
  return {
    note: `${CHAPEAU} ${AVANT_2021} ${NOTE}`,
    episodes: EPISODES.map((e) => ({
      debut: e.debut.map(momentText),
      fin: momentText(e.fin),
      ...(e.puis && { puis: `${PUIS} ${e.puis.quoi} : « ${e.puis.dit} » (${label(e.puis.communique)} : ${e.puis.communique.copie}). ${SANS_FIN}` }),
    })),
  };
}

/** One sentence for the summary: the days and what they were, newest first. */
export const resumeText = () =>
  `Alertes précédentes dont le début et la fin sont écrits dans un communiqué de la préfecture (liste partielle, depuis 2016 ; avant novembre 2021, les niveaux du plan précédent) : ${EPISODES.map((e) =>
    `${e.debut.map((m) => `${date(m.jour)} ${quoi(m)}`).join(", ")} → ${date(e.fin.jour)} ${e.fin.quoi}${e.puis ? ` (${PUIS.toLowerCase()} ${e.puis.quoi} : ${SANS_FIN[0].toLowerCase()}${SANS_FIN.slice(1, -1)})` : ""}`).join(" ; ")}.`;

/**
 * The last eruption, as the OVPF dates it in its posts (cam-change 251), in place of pitonlive.com's date: kept by hand,
 * read on 25/10/2026. Its start « Eruption en cours » of 13/02/2026, its end the « Arrêt de l'éruption » posted on
 * 13/04/2026 at 06:10, the tremor stopped on 12/04 around 23:10. check-sources says when the OVPF posts a newer end.
 */
export const DERNIERE_ERUPTION = {
  debut: "2026-02-13",
  fin: "2026-04-12",
  /** The post that says the end, and when it was posted: a newer end means this one is out of date. */
  lien: "https://bsky.app/profile/ovpf.bsky.social/post/3mjdrynd4ns2g",
  publiee: "2026-04-13T02:10:39Z",
};

// « 13 février », « 12 avril 2026 ».
const jourMois = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
/** « du 13 février au 12 avril 2026 », the year on both days when they differ. */
export const derniereEruptionDates = (e: { debut: string; fin: string } = DERNIERE_ERUPTION) =>
  `du ${jourMois(e.debut)}${e.debut.slice(0, 4) === e.fin.slice(0, 4) ? "" : ` ${e.debut.slice(0, 4)}`} au ${jourMois(e.fin)} ${e.fin.slice(0, 4)}`;
/** For the AI: « Dernière éruption : du 13 février au 12 avril 2026, selon l'OVPF (lien). » (marketing). */
export const derniereEruptionText = (e = DERNIERE_ERUPTION) => `Dernière éruption : ${derniereEruptionDates(e)}, selon l'OVPF (${e.lien}).`;
