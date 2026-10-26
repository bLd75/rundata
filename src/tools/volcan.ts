import type { Cache, Cached } from "../cache.js";
import { localTime } from "../geo.js";
import * as seismes from "../providers/seismes.js";
import type * as onf from "../providers/sentiers.js";
import * as historique from "./volcan-historique.js";
import * as ocr from "../providers/ovpf-ocr.js";
import * as volcan from "../providers/volcan.js";
import { etatHote, jour as jourDe, jourHeure, type Public } from "../sans-reponse.js";
import { why } from "../types.js";
import { credits, fr, text } from "./format.js";
import { acces, definition, libelle, lineText } from "./volcan-acces.js";

const DAY = 86_400_000;
const OFFICIAL =
  "En cas d'éruption ou d'alerte, seules comptent les consignes de la préfecture (reunion.gouv.fr) et de l'OVPF-IPGP. " +
  "L'accès à l'Enclos est réglementé par arrêté préfectoral : le vérifier avant de partir.";

// Worded by marketing: what is said when the prefecture's phase could not be read, and none was kept.
const NIVEAU_INCONNU = "à vérifier sur reunion.gouv.fr";

const day = (iso: string) => localTime(new Date(iso)).split(" ")[0];
/** « 24/10 », of a day « 2026-10-24 ». */
const dayOf = (jour: string) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}`;
// Worded by marketing: what the texts read say, never that the eruption has not begun.
export const NON_ANNONCEE = "L'OVPF et la préfecture n'ont pas annoncé d'éruption dans les textes que nous avons lus.";
export const IMAGE_APRES = "La dernière publication de l'OVPF est une image que nous ne lisons pas : l'état ci-dessus peut ne pas en tenir compte.";
/**
 * After NON_ANNONCEE when the newest post is in images and newer than the release: « the texts we read » leaves it out,
 * and its time tells it is newer (marketing). Followed by « : la voir », the link. IMAGE_APRES is then not said.
 */
/** « La dernière publication de l'OVPF, le 25/10 à 08:02, est en images », on /volcan before the way to its text read. */
export const enImages = (jour: string, heure: string) => `La dernière publication de l'OVPF, le ${jour} à ${heure}, est en images`;
export const enImagesApres = (jour: string, heure: string) => `La dernière publication de l'OVPF, le ${jour} à ${heure}, est en images, que nous ne lisons pas`;
/**
 * The same, the text of its first image read by rundata.re (providers/ovpf-ocr.ts) and quoted beside: read by a
 * machine, « sans l'analyser », not one of « les textes que nous avons lus » of NON_ANNONCEE (marketing).
 */
export const enImagesLuesApres = (jour: string, heure: string) => `La dernière publication de l'OVPF, le ${jour} à ${heure}, est en images\u00a0; nous citons le texte de la première, lu automatiquement, sans l'analyser`;
/** The same where the text is not quoted (the home page's demo): where it is (marketing). */
export const enImagesLuesAilleurs = (jour: string, heure: string) => `La dernière publication de l'OVPF, le ${jour} à ${heure}, est en images\u00a0; le texte de la première, lu automatiquement, est cité sur la page Volcan`;
export const IMAGE_LUE_APRES = "La dernière publication de l'OVPF est en images : l'état ci-dessus peut ne pas en tenir compte. Nous citons le texte de la première image, lu automatiquement, sans l'analyser.";
/** Before the text read in the first image, wherever it is quoted (marketing). */
export const LU_DANS_L_IMAGE = "Texte de la première image, lu automatiquement par rundata.re (il peut contenir des erreurs)";
/** For the AI, beside the text read in the first image (marketing). */
export const A_LIRE_LU = "Ce texte a été lu automatiquement par rundata.re dans la première image de la publication\u00a0; les autres images ne sont pas lues. Il peut contenir des erreurs, surtout dans les chiffres et les heures. Citez-le comme tel, avec le lien de la publication, et renvoyez à celle-ci pour les chiffres et les heures. N'en déduisez ni le niveau d'alerte, ni le début ou la fin d'une éruption : l'état officiel est celui donné plus haut.";
// The text read, in the summary: its first words.
const EXTRAIT = 400;
/** For the AI, beside a post given in images: its content is only there, and the AI may not open it either. */
export const A_LIRE = "Le contenu de cette publication est dans ses images, que rundata.re ne lit pas : donnez le lien à l'utilisateur, et ne dites rien de ce qu'elle contient sans l'avoir lue.";

/**
 * The Enclos when it is the release's (marketing): in its title's own words, never one the release does not say; in an
 * alert whose title says nothing of it, closed by the level.
 */
export function enclosOfRelease(p: volcan.Phase): { mots?: string; niveau?: string } | undefined {
  if (!p.enclos) return undefined;
  const mots = volcan.enclosWords(p.titre);
  return mots ? { mots } : /^Alerte/.test(p.niveau) && p.enclos === "ferme" ? { niveau: p.niveau } : undefined;
}

/** « Accès à l'Enclos : « fermeture » selon le communiqué de la préfecture du 23/10 », `du` the words before the day. */
export const enclosWordsSaid = (mots: string, du: string) => `Accès à l'Enclos : « ${mots} » selon le ${du}`;
// An alert's ban when its release says nothing of the Enclos: the level the release's, the ban the plan's (marketing).
export const ORSEC_BAN = "accès à l'Enclos interdit à ce niveau (dispositif ORSEC Volcan)";

async function settle<T>(source: string, p: Promise<Cached<T>>): Promise<Cached<T> | null> {
  try {
    return await p;
  } catch (err) {
    console.error(`source ${source} indisponible:`, why(err));
    return null;
  }
}

/**
 * The OVPF-IPGP's site listed as silent (sans-reponse.ts, rechecked every morning), in marketing's words: since when,
 * the last recheck, what may be missing here. What is still read is said only of the sources whose last read answered.
 */
export function ipgpMuet(l: Public, lus: { bluesky: boolean; prefecture: boolean }, now: Date): string {
  // /sites-sans-reponse's words for a site that answers, but not to our reads (statutEnMots).
  const depuis = l.statut === "bloque" ? `répond, mais pas à nos lectures, depuis le ${jourDe(l.premier_echec)}` : `n'a pas répondu depuis le ${jourDe(l.premier_echec)}`;
  // « aujourd'hui à 06:02 » the same day, as lu_le.
  const t = l.dernier_essai;
  const essai = t ? ` (dernier essai ${jourDe(t) === jourDe(now.getTime() / 1000) ? `aujourd'hui à ${jourHeure(t).split(" à ")[1]}` : `le ${jourHeure(t)}`})` : "";
  const encore = lus.bluesky && lus.prefecture
    ? "ses publications sur Bluesky et les communiqués de la préfecture, eux, sont lus"
    : lus.bluesky ? "ses publications sur Bluesky, elles, sont lues" : lus.prefecture ? "les communiqués de la préfecture, eux, sont lus" : "";
  return `Le site de ${l.nom} ${depuis}${essai}. Un communiqué ou un bulletin de l'observatoire publié depuis peut manquer ici${encore ? `\u00a0; ${encore}` : ""}.`;
}

// Worded by marketing, under the counts: the catalogue holds the located events only, far fewer in a seismic crisis.
// What the counts are, never compared with a figure read in an image (marketing, 26/10/2026).
export const LOCALISES = "L'OVPF ne localise qu'une partie des séismes qu'il enregistre\u00a0: ses bulletins donnent le nombre enregistré, nos chiffres comptent ceux qu'il a localisés, d'après son catalogue.";
const BAR_DAYS = 30;
const localDay = (t: number) => new Date(t + 4 * 3600_000).toISOString().slice(0, 10);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** The first words of a text read in images, cut at a word: « … » quoted in the summary. */
const extrait = (paras: string[]) => {
  const t = paras.join(" ");
  return t.length <= EXTRAIT ? t : `${t.slice(0, t.lastIndexOf(" ", EXTRAIT))}…`;
};

/**
 * The events located under the summit, per day of La Réunion, the last 30 days up to today, today « en cours »: the
 * catalogue is read over 30 days back from now, so the oldest day shown is a whole one.
 */
export function perDay(volcano: seismes.Seisme[], now: Date) {
  const counts = new Map<string, number>();
  for (const s of volcano) counts.set(localDay(Date.parse(s.time)), (counts.get(localDay(Date.parse(s.time))) ?? 0) + 1);
  const today = localDay(now.getTime());
  return Array.from({ length: BAR_DAYS }, (_, i) => {
    const jour = localDay(now.getTime() - (BAR_DAYS - 1 - i) * DAY);
    return { jour, nombre: counts.get(jour) ?? 0, ...(jour === today && { en_cours: true as const }) };
  });
}

/** Counts and the most notable events of the last 30 days, under the volcano and elsewhere. */
export function quakeSummary(list: seismes.Seisme[], now: Date) {
  const recent = (s: seismes.Seisme, days: number) => now.getTime() - Date.parse(s.time) <= days * DAY;
  const volcano = list.filter(seismes.underSummit);
  const elsewhere = list.filter((s) => !seismes.underSummit(s));
  const max = (l: seismes.Seisme[]) => (l.length ? Math.max(...l.map((s) => s.magnitude)) : null);
  const one = (s: seismes.Seisme) => ({
    heure: `${localTime(new Date(s.time))} heure de La Réunion`,
    magnitude: Math.round(s.magnitude * 10) / 10,
    profondeur_km: Math.round(s.profondeur_km * 10) / 10,
    lieu: seismes.where(s.lon, s.lat),
  });
  return {
    sous_le_volcan: { "30_jours": volcano.length, "7_jours": volcano.filter((s) => recent(s, 7)).length, magnitude_max_30j: max(volcano) },
    ailleurs_sur_l_ile: { "30_jours": elsewhere.length, magnitude_max_30j: max(elsewhere) },
    par_jour_sous_le_volcan: perDay(volcano, now),
    derniers: list.slice(0, 8).map(one),
    // Nothing of what the counts may announce: only the OVPF's or the prefecture's words say that (marketing).
    note:
      "Séismes localisés par l'OVPF (magnitude de durée Md). La plupart sont trop faibles pour être ressentis " +
      `(en général pas avant magnitude 2,5 à 3). ${LOCALISES}`,
  };
}

// The ORSEC levels, lowest first, the alerts 2 by their sub-level (« Alerte 2 » unspecified as the lowest of them).
// Sauvegarde is the phase after an eruption, the Enclos still closed (DSO ORSEC « Volcan Piton de la Fournaise », 2021,
// p. 22 and 27): below the alerts, above vigilance. The plan as read on 24/10/2026 in its Wayback Machine copy of
// 05/04/2025, the prefecture refusing our machines (https://web.archive.org/web/20250405151006/https://www.reunion.gouv.fr/contenu/telechargement/31585/227969/file/dso_volcan_2021.pdf):
// to check again for a newer version once it answers (volcan-acces.ts).
const ORDER: Record<string, number> = { Vigilance: 0, "Vigilance renforcée": 1, Sauvegarde: 2, "Alerte 1": 3, "Alerte 2": 4, "Alerte 2-1": 4, "Alerte 2-2": 5, "Alerte 2-3": 6 };
const rank = (niveau: string) => ORDER[volcan.levelOf(niveau) ?? ""] ?? -1;
// The level as the release's title writes it, « alerte 1 » of « passage en alerte 1 » (marketing).
const WRITTEN: Record<string, RegExp> = {
  "Alerte 2-3": /alerte\s*2[\s.-]*3/i,
  "Alerte 2-2": /alerte\s*2[\s.-]*2/i,
  "Alerte 2-1": /alerte\s*2[\s.-]*1/i,
  "Alerte 2": /alerte\s*2/i,
  "Alerte 1": /alerte\s*1/i,
};
export const asWritten = (p: { niveau: string; titre: string }) => WRITTEN[p.niveau]?.exec(p.titre)?.[0] ?? p.niveau;

/** « 25/10 à 08:00 », Réunion time. */
export const atTime = (iso: string) => localTime(new Date(iso)).replace(" ", " à ");

// Without a phase of the prefecture, read or kept, the OVPF's texts of these last days only: an alert of April must not
// come back from an old post.
const OVPF_ALONE_MS = 3 * DAY;

/** An OVPF text post the state takes a level or the eruption from: its time and its link. */
export interface Publication {
  date: string;
  lien: string;
}

/** The state from the official texts alone (`officiel`). */
export interface Officiel {
  /** The level in force: the prefecture's, or the OVPF's when newer and higher; undefined when neither gives one. */
  niveau?: string;
  eruption: boolean;
  /** The prefecture's phase, read or kept. */
  prefecture?: volcan.Phase;
  /** The level is the OVPF's, from this post. */
  niveauOvpf?: Publication;
  /** Whether it erupts is the OVPF's, from this post: its start or its end. */
  eruptionOvpf?: Publication & { en_cours: boolean };
}

/**
 * The state from the official texts: the prefecture's phase, read or kept, for the level and the Enclos; the OVPF's
 * text posts since the release's day for a higher level (never a lower one) and for the eruption, its start or its end,
 * the newest saying it winning. Posts in images are not read here. pitonlive.com has no part in it (the user, 25/10).
 */
export function officiel(p: volcan.Phase | undefined, posts: volcan.Post[] | null, now = new Date()): Officiel {
  const since = p ? volcan.dayStart(p.jour) : now.getTime() - OVPF_ALONE_MS;
  const texts = (posts ?? []).filter((x) => !x.image && Date.parse(x.date) >= since);
  const lv = texts.map((x) => ({ x, niveau: volcan.levelSaid(x.texte) })).find((y) => y.niveau);
  const er = texts.map((x) => ({ x, en_cours: volcan.eruptionSaid(x.texte) })).find((y) => y.en_cours !== undefined);
  const higher = !!lv && (!p || rank(lv.niveau!) > rank(p.niveau));
  const niveau = higher ? lv!.niveau : p?.niveau;
  return {
    niveau,
    // Alerte 2 is the eruption under way, in the plan's own terms, until the OVPF says it stopped.
    eruption: er ? er.en_cours! : !!p?.eruption || (higher && /^Alerte 2/.test(niveau!)),
    ...(p && { prefecture: p }),
    ...(higher && { niveauOvpf: { date: lv!.x.date, lien: lv!.x.lien } }),
    ...(er && { eruptionOvpf: { date: er.x.date, lien: er.x.lien, en_cours: er.en_cours! } }),
  };
}

/** What pitonlive.com says beyond the official texts, said as a last resort, as its own (`nonOfficiel`). */
export interface NonOfficiel {
  /** Its level, as the plan names it: higher than the official one, or the only one. */
  niveau?: string;
  /** It says an eruption the official texts do not. */
  eruption?: true;
  /** When we read it, « 25/10 à 14:28 »: its own date is not one we can check (marketing). */
  lu: string;
}

/**
 * pitonlive.com, a last resort only: its alert when no official level was read, or its level when higher than the
 * official one and not older than the release's day; an eruption the official texts do not say. Lower, nothing is
 * said; logged.
 */
export function nonOfficiel(s: volcan.PitonState | null, readAt: Date | undefined, o: Officiel): NonOfficiel | undefined {
  if (!s || !readAt) return undefined;
  const niveau = volcan.levelOf(s.status.alert_level_display);
  const at = s.status.published_at ? Date.parse(s.status.published_at) : 0;
  const recent = !o.prefecture || at >= volcan.dayStart(o.prefecture.jour);
  // Alone, only an alert: pitonlive follows the prefecture by hours or days, and must never say « Vigilance » while the
  // prefecture is in alert (data-run, 24/10).
  const said = niveau && (o.niveau ? recent && rank(niveau) > rank(o.niveau) : /^Alerte/.test(niveau)) ? niveau : undefined;
  const eruption = s.status.is_erupting && !o.eruption && recent ? (true as const) : undefined;
  if (niveau && o.niveau && niveau !== o.niveau) console.error(`volcan : niveau officiel ${o.niveau}, pitonlive ${niveau} (${s.status.published_at ?? "sans date"})`);
  return said || eruption ? { ...(said && { niveau: said }), ...(eruption && { eruption }), lu: atTime(readAt.toISOString()) } : undefined;
}

// Worded by marketing: pitonlive after the official source, always « Selon pitonlive.com, site non
// officiel », with the time we read it.
export const pitonNiveau = (n: NonOfficiel) =>
  `Selon pitonlive.com, site non officiel, lu le ${n.lu} : « ${n.niveau} ». Ce niveau n'apparaît pas dans les communiqués de la préfecture que nous avons lus : vérifiez sur reunion.gouv.fr avant de monter au volcan.`;
export const pitonEruption = (n: NonOfficiel, ovpf: string) =>
  `Selon pitonlive.com, site non officiel, lu le ${n.lu}, une éruption est en cours. L'OVPF et la préfecture ne l'ont pas annoncée dans les textes que nous avons lus : suivez l'OVPF (${ovpf}) et reunion.gouv.fr.`;
export const NIVEAU_ILLISIBLE = "Nous n'avons pas pu lire le niveau d'alerte de la préfecture : vérifiez-le sur reunion.gouv.fr avant de monter au volcan.";
export const pitonSeul = (n: NonOfficiel) => `Selon pitonlive.com, site non officiel, lu le ${n.lu} : « ${n.niveau} ».`;
/** pitonlive's lines, in that order: the level alone when no official one, else a higher one; then the eruption. */
export const pitonLines = (n: NonOfficiel, alone: boolean, ovpf: string) =>
  [n.niveau ? (alone ? pitonSeul(n) : pitonNiveau(n)) : "", n.eruption ? pitonEruption(n, ovpf) : ""].filter(Boolean);
// A level from the OVPF's text, newer and higher than the release (marketing).
export const ovpfNiveau = (niveau: string, quand: string, lien: string) =>
  `${niveau}, selon l'OVPF (publication du ${quand}, ${lien}). Le communiqué de la préfecture sur ce niveau n'est pas encore dans les textes que nous avons lus.`;
/** « 25/10 à 08:00 », of a time the answer gives, « 25/10 08:00 heure de La Réunion ». */
export const givenAt = (date: string) => date.replace(" heure de La Réunion", "").replace(" ", " à ");
// Draft, to marketing: the eruption's start or end from the OVPF's text.
export const ovpfDebut = (p: Publication) => `annoncée par l'OVPF (publication du ${atTime(p.date)}, ${p.lien})`;
export const ovpfArret = (p: Publication) => `L'OVPF a annoncé l'arrêt de l'éruption (publication du ${atTime(p.date)}, ${p.lien}).`;
// Out of an alert, the Enclos in vigilance from the prefecture, its release saying nothing of it (marketing).
export const VIGILANCE_ENCLOS = "En vigilance, « l'accès du public non-accompagné est restreint aux seuls sentiers balisés et ouverts » (dispositif ORSEC Volcan, p. 23).";

/** The Enclos as the official texts say it, for the answer's `acces_enclos`; undefined when they say nothing. */
function enclosOf(o: Officiel) {
  const p = o.prefecture;
  // An alert of the OVPF's above a release out of alert: the Enclos closed at that level, by the plan.
  if (o.niveauOvpf && /^Alerte/.test(o.niveau!) && !(p && /^Alerte/.test(p.niveau))) return { ovpf: { niveau: o.niveau!, ...o.niveauOvpf } };
  const ofRelease = p && enclosOfRelease(p);
  if (ofRelease) return { communique: { ...ofRelease, jour: p!.jour, lien: p!.lien } };
  return o.niveau === "Vigilance" && p ? { vigilance: true as const } : undefined;
}

export async function volcanSeismes(cache: Cache, now = new Date()) {
  const [piton, read, seen, given0, silent] = await Promise.all([
    // With its time: pitonlive's line says when we read it (marketing).
    volcan.state(cache).catch((err: unknown) => (console.error(`source ${volcan.PITONLIVE.id} indisponible:`, why(err)), null)),
    settle(volcan.OVPF.id, volcan.posts(cache)),
    settle(seismes.SOURCE.id, seismes.seismes(cache, now)),
    settle(volcan.PREFECTURE.id, volcan.phase(cache)),
    // The IPGP's site as /sites-sans-reponse shows it, from the same copy (15 minutes): never read here.
    etatHote(cache, "ipgp.fr").catch((err: unknown) => (console.error("volcan : état du site de l'IPGP illisible:", why(err)), undefined)),
  ]);
  const [posts, quakes, phase] = [read?.value ?? null, seen?.value ?? null, given0?.value ?? null];
  // Said while it is listed, until the recheck finds it back; the table absent, nothing.
  const ipgp = silent && silent.statut !== "revenu" ? ipgpMuet(silent, { bluesky: !!read && !read.stale, prefecture: !!given0 && !given0.stale }, now) : undefined;
  // The ONF's map as another page last read it, never built here (a read).
  const carte = await cache.peek<onf.Carte>("onf:sentiers").catch(() => undefined);
  if (!piton && !posts && !quakes && !phase) {
    return {
      ...text({ erreur: "Les sources sur le volcan ne répondent pas pour le moment.", consulter: [volcan.OVPF.url, volcan.OVPF_FACEBOOK] }),
      isError: true,
    };
  }
  // The level and the eruption from the official texts alone, the prefecture's phase enough without any other source;
  // pitonlive.com only as a last resort, as its own (the user, 25/10/2026).
  const o = officiel(phase ?? undefined, posts, now);
  const niveau = o.niveau;
  const unknown = !niveau;
  const piton2 = nonOfficiel(piton?.value ?? null, piton?.fetchedAt, o);
  const given = o.prefecture;

  // « Puis-je monter au volcan ? »: the release in force, quoted from its page (volcan-acces.ts). The OVPF's level higher
  // than a release in alert: the release's lines at its own level, said so (marketing); above a release out of alert,
  // that release says nothing that stands.
  const atRelease = !!o.niveauOvpf && !!given && /^Alerte/.test(given.niveau);
  const release = o.niveauOvpf && !atRelease ? undefined : given;
  const phrases = release ? await volcan.releaseText(cache, release, now.getTime()) : undefined;
  const lines = acces(atRelease ? given!.niveau : niveau, release, phrases, carte);
  const monter = atRelease ? { ...lines, avant: `Les lignes ci-dessous citent le communiqué de la préfecture du ${dayOf(given!.jour)}, au niveau « ${asWritten(given!)} ».` } : lines;
  const defini = niveau ? definition(niveau) : undefined;
  const enclos = enclosOf(o);

  // The text read in the images of the posts shown, only when the level it gives is the one known: else the post stays
  // said as images not read, and the difference is logged.
  const known = niveau;
  const lus = new Map<string, string[]>();
  await Promise.all((posts ?? []).slice(0, 3).filter((p) => p.image).map(async (p) => {
    const r = await ocr.resultat(cache, p);
    if (r?.statut !== "lu") return;
    if (ocr.sameLevel(r.niveau_lu, known)) lus.set(p.lien, r.paragraphes);
    else console.error(`volcan : texte lu dans l'image de l'OVPF non affiché (${p.lien}) : « ${r.niveau_lu} », niveau connu ${known ?? "aucun"}`);
  }));
  const last = posts?.[0];
  const lu = last && lus.get(last.lien);
  // The observatory's newest post an image we do not read, newer than the texts the state comes from: it may announce
  // what the state does not say (an eruption, its end). Said, and nothing drawn from it (marketing). The release counts
  // from its day's start: a post of the same day, before or after it, is said.
  const told = Math.max(given ? volcan.dayStart(given.jour) : 0, ...[o.niveauOvpf, o.eruptionOvpf].map((x) => (x ? Date.parse(x.date) : 0)));
  const imageAfter = !!last?.image && Date.parse(last.date) > told;
  const [jour, heure] = last ? localTime(new Date(last.date)).split(" ") : [];
  const alerte = /^Alerte/.test(niveau ?? "");
  const stopped = o.eruptionOvpf?.en_cours === false;
  // Under an alert, said once, in the sentence on the texts read (marketing).
  const folded = imageAfter && !o.eruption && alerte && !stopped;

  const parts: string[] = [];
  parts.push(
    o.eruption
      // The day only from an official text.
      ? `ÉRUPTION EN COURS au Piton de la Fournaise${o.eruptionOvpf ? `, ${ovpfDebut(o.eruptionOvpf)}` : given?.eruption ? `, annoncée par la préfecture le ${dayOf(given.jour)}` : ""}.`
      : alerte && stopped
        ? `${niveau} au Piton de la Fournaise. ${ovpfArret(o.eruptionOvpf!)}`
        : alerte
          ? `${niveau} au Piton de la Fournaise${libelle(niveau) ? ` : « ${libelle(niveau)} » (dispositif ORSEC Volcan)` : ""}. ${NON_ANNONCEE}${folded ? ` ${(lu ? enImagesLuesApres : enImagesApres)(jour, heure)} : la voir, ${last!.lien}.` : ""}`
          // Never on our word: what the texts read say (marketing).
          : NON_ANNONCEE,
  );
  if (ipgp) parts.push(ipgp);
  if (o.niveauOvpf) parts.push(ovpfNiveau(niveau!, atTime(o.niveauOvpf.date), o.niveauOvpf.lien));
  if (given) parts.push(`Communiqué de la préfecture du ${dayOf(given.jour)} : « ${given.titre} » (${given.lien}).`);
  parts.push(unknown ? NIVEAU_ILLISIBLE : `Niveau du dispositif ORSEC volcan : ${niveau}.`);
  // pitonlive.com, after the official source, as its own (marketing).
  if (piton2) parts.push(...pitonLines(piton2, unknown, volcan.OVPF.url));
  if (defini) parts.push(`Définition : ${defini}`);
  const monterAt = parts.length;
  // The last eruption, the OVPF's dates (volcan-historique.ts), unless the OVPF has posted a newer end since: then
  // nothing until the dates are brought up to date, and check-sources says so.
  const newerEnd = posts?.find((x) => !x.image && Date.parse(x.date) > Date.parse(historique.DERNIERE_ERUPTION.publiee) && volcan.eruptionSaid(x.texte) === false);
  const ended = !o.eruption && !newerEnd;
  if (ended) parts.push(historique.derniereEruptionText());
  const du = given && dayOf(given.jour);
  if (unknown) parts.push(`Accès à l'Enclos : ${NIVEAU_INCONNU}, avant de partir.`);
  else if (enclos?.ovpf) parts.push(`${enclos.ovpf.niveau} selon l'OVPF : ${ORSEC_BAN}.`);
  else if (enclos?.communique?.mots) parts.push(`${enclosWordsSaid(enclos.communique.mots, `communiqué de la préfecture du ${du}`)}.`);
  else if (enclos?.communique?.niveau) parts.push(`Niveau : ${enclos.communique.niveau.toLowerCase()} selon le communiqué de la préfecture du ${du}. Accès à l'Enclos interdit à ce niveau du dispositif ORSEC Volcan.`);
  else if (enclos?.vigilance) parts.push(VIGILANCE_ENCLOS);
  // Under an alert, the post in images already named in the sentence on the texts read: not again (marketing).
  if (last && !folded) {
    parts.push(last.image
      // The time of the post, never the one written in the images, even when read.
      ? `Dernière publication de l'OVPF, le ${jour} à ${heure} : ${volcan.imagesSaid(last.images, last.mots, false, !!lu)}. ${lu ? `${LU_DANS_L_IMAGE} : « ${extrait(lu)} » (${last.lien}).` : `rundata.re ne lit pas les images : à voir sur ${last.lien}.`}`
      : `Dernière publication de l'OVPF sur l'activité (${day(last.date)}) : « ${last.texte.slice(0, 220)}${last.texte.length > 220 ? "…" : ""} »`);
    if (imageAfter) parts.push(lu ? IMAGE_LUE_APRES : IMAGE_APRES);
  } else if (lu) parts.push(`${LU_DANS_L_IMAGE} : « ${extrait(lu)} »`);
  const q = quakes ? quakeSummary(quakes, now) : null;
  if (q) {
    parts.push(
      `Séismes localisés par l'OVPF en 30 jours : ${q.sous_le_volcan["30_jours"]} sous le volcan` +
        (q.sous_le_volcan.magnitude_max_30j != null ? ` (magnitude max ${fr(Math.round(q.sous_le_volcan.magnitude_max_30j * 10) / 10)})` : "") +
        `, dont ${q.sous_le_volcan["7_jours"]} ces 7 derniers jours\u00a0; ${q.ailleurs_sur_l_ile["30_jours"]} ailleurs sur l'île.`,
      `Séismes localisés par l'OVPF sous le volcan, par jour (heure de La Réunion) : ${q.par_jour_sous_le_volcan.slice(-7).map((j) => `${day(`${j.jour}T12:00:00+04:00`)} ${j.nombre}${j.en_cours ? " (jour en cours)" : ""}`).join(", ")}.`,
      LOCALISES,
    );
  }
  // How the last alerts went: only those whose start and end a release writes (volcan-historique.ts).
  parts.push(historique.resumeText());

  // pitonlive.com credited only when a line of it is said, last (marketing).
  const pitonSaid = !!piton2;
  const sources = [...(given ? [volcan.PREFECTURE] : []), ...(posts ? [volcan.OVPF] : []), ...(quakes ? [seismes.SOURCE] : []), ...(pitonSaid ? [volcan.PITONLIVE] : [])];
  // Right after whether it erupts and the level: the question of the hikers, first in the answer's fields too.
  parts.splice(monterAt, 0, `${monter.titre} ${monter.avant ? `${monter.avant} ` : ""}${monter.lignes.map(lineText).join(" ")} ${monter.pied}`);
  const pub = (x: Publication) => ({ date: `${localTime(new Date(x.date))} heure de La Réunion`, lien: x.lien });
  return text({
    puis_je_monter: monter,
    resume: parts.join(" "),
    etat: {
      eruption_en_cours: o.eruption,
      niveau_orsec: niveau ?? NIVEAU_INCONNU,
      ...(defini && { niveau_definition: defini }),
      ...(unknown && { niveau_inconnu: true }),
      ...(o.niveauOvpf && { niveau_ovpf: pub(o.niveauOvpf) }),
      ...(o.eruptionOvpf && { eruption_ovpf: { en_cours: o.eruptionOvpf.en_cours, ...pub(o.eruptionOvpf) } }),
      ...(piton2 && { pitonlive_non_officiel: piton2 }),
      ...(imageAfter && { image_ovpf_plus_recente: true }),
      ...(ended && { derniere_eruption: { debut: historique.DERNIERE_ERUPTION.debut, fin: historique.DERNIERE_ERUPTION.fin, lien: historique.DERNIERE_ERUPTION.lien, source: "OVPF-IPGP" } }),
      ...(newerEnd && { derniere_eruption_a_dater: pub(newerEnd) }),
      // No word of pitonlive's on the Enclos, not even as a last resort (data-run): the release's, the plan's, or none.
      ...(enclos && { acces_enclos: enclos }),
      ...(given && { communique_prefecture: { niveau: given.niveau, titre: given.titre, lien: given.lien, jour: given.jour } }),
      source: "préfecture de La Réunion (communiqués) et OVPF-IPGP (publications)",
    },
    alertes_precedentes: historique.precedentes(),
    // The release's PDF stays out of the answer until what it is read for is shown (ovpf-pdf.ts, SHOW).
    publications_ovpf: posts
      ? posts.slice(0, 3).map(({ pdf: _, mots, ...p }) => ({
          ...p,
          date: `${localTime(new Date(p.date))} heure de La Réunion`,
          ...(p.image && (lus.has(p.lien)
            ? { texte: volcan.enImages(p.images, mots, true), texte_lu_dans_l_image: lus.get(p.lien)!.join("\n\n"), a_lire: A_LIRE_LU }
            : { a_lire: A_LIRE })),
        }))
      : "indisponible",
    seismes: q ?? "indisponible",
    ...(ipgp && { injoignable: ipgp }),
    avertissements: [OFFICIAL],
    // The IPGP's site is offline (25/10/2026): the OVPF's own accounts instead.
    consulter: ["https://www.reunion.gouv.fr", volcan.OVPF.url, volcan.OVPF_FACEBOOK],
    sources: credits(sources),
  });
}
