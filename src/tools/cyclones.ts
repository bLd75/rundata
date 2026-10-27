import type { Cache } from "../cache.js";
import { localTime } from "../geo.js";
import * as gdacs from "../providers/cyclones.js";
import * as mf from "../providers/vigilance.js";
import { why } from "../types.js";
import { credits, text } from "./format.js";
import * as prefecture from "../providers/prefecture.js";
import { ecolesBlock, quotidienLine } from "./ecoles.js";
import { cyclone as cycloneAlert } from "./vigilance.js";
import { jourFr, kmh, mesures, PASSES, passeOf, rafale, RAIN_NOTE, records, total, type Passe } from "../historique/cyclones-passes.js";
import { SOURCE as CLIMAT } from "../providers/climat.js";

/** « 03/02 à 10:00 », heure de La Réunion. */
const at = (iso: string) => localTime(new Date(iso)).replace(" ", " à ");
/** « 03/02/2026 ». */
const date = (iso: string) => {
  const l = localTime(new Date(iso)).split(" ")[0];
  return `${l}/${new Date(new Date(iso).getTime() + 4 * 3600_000).getUTCFullYear()}`;
};
export const OFFICIAL = {
  meteo_france: mf.OFFICIEL_CYCLONE,
  vigilance: mf.SOURCE.url,
  prefecture: "https://www.reunion.gouv.fr",
};

const COMMON = {
  a_savoir:
    "Nom, stade et heure du dernier avis de chaque système, d'après le CMRS de La Réunion (Météo-France), le centre chargé des cyclones du sud-ouest de l'océan Indien, repris par GDACS toutes les 6 heures : " +
    "ils peuvent avoir quelques heures de retard. Trajectoire et bulletins officiels : consulter le site officiel de Météo-France. " +
    "Pour savoir quoi faire, seules comptent l'alerte cyclonique de la préfecture et les bulletins de Météo-France.",
  phases_alerte:
    "À La Réunion, la préfecture déclenche : la pré-alerte cyclonique (menace dans les jours à venir, s'informer), l'alerte orange (danger dans les 24 heures, se préparer), " +
    "l'alerte rouge (danger imminent, se confiner), l'alerte violette (confinement strict, même les secours ne circulent plus), puis la phase de sauvegarde (après le passage, rester prudent).",
  saison: "La saison cyclonique va de novembre à avril\u00a0; des systèmes se forment parfois hors saison.",
};

/**
 * An active system as the RSMC's last advisory names it: no position, distance, wind or forecast, which Météo-France's
 * official site gives. No stage when that advisory could not be read.
 */
export function activeRow(s: gdacs.Systeme, avis: gdacs.Avis | undefined) {
  return {
    nom: s.nom,
    stade: avis?.stade,
    dernier_avis: `${at(avis?.heure ?? s.fin)} (heure de La Réunion)`,
    centre: s.centre,
    rapport: s.rapport,
  };
}

export function seasonRow(s: gdacs.Systeme) {
  return {
    nom: s.nom,
    du: date(s.debut),
    au: date(s.fin),
    centre: s.centre,
    rapport: s.rapport,
  };
}

// reunion.gouv.fr can hang for seconds (24/10/2026): the answer does not wait for it longer than this.
const PREFECTURE_WAIT_MS = 3000;

/** The cyclone alert of the prefecture through Météo-France's vigilance, and what it means for the schools; undefined when it cannot be read. */
async function alert(cache: Cache, now: Date) {
  if (!mf.enabled()) return undefined;
  try {
    // The prefecture's last decision beside the bulletin: never more than the bulletin's wait, and none when it fails.
    const decision = prefecture.cyclone(cache).then((x) => x.value).catch(() => null);
    const [v, c] = await Promise.all([mf.vigilance(cache).then((x) => x.value), Promise.race([decision, new Promise<null>((r) => setTimeout(() => r(null), PREFECTURE_WAIT_MS))])]);
    // The cyclone's section of the prefecture not read: a decision may be missing, said beside the alert.
    const silent = await prefecture.rubriqueNonLue(cache, now).catch(() => undefined);
    return { texte: cycloneAlert(v, now), ecoles: ecolesBlock(v, now, c), vie_quotidienne: quotidienLine(v, now), injoignable: silent };
  } catch (err) {
    console.error(`source ${mf.SOURCE.id} indisponible:`, why(err));
    return undefined;
  }
}

/** The past cyclones with a page, for the tool's description. */
export const PASSES_LIST = PASSES.map((p) => `${p.nom} ${p.annee}`).join(", ");

/** A past cyclone: its passage as the named document writes it, and what Météo-France's stations measured. */
export function passe(c: Passe) {
  const { jours, stations } = mesures(c);
  const gusts = stations
    .map((s) => ({ s, g: rafale(s, jours) }))
    .filter((x): x is { s: (typeof stations)[number]; g: { ms: number; jour: string } } => !!x.g)
    .sort((a, b) => b.g.ms - a.g.ms);
  const page = `https://rundata.re/cyclones/${c.slug}`;
  return text({
    cyclone: `${c.nom} (${c.annee})`,
    passage: c.passage,
    passage_d_apres: { document: c.document.titre, auteur: c.document.auteur, lien: c.document.url },
    alerte_cyclonique: c.alerte ? `${c.alerte}, d'après le même document` : undefined,
    jours: jours.map(jourFr),
    pluie_du_jour: RAIN_NOTE,
    stations_les_plus_arrosees: stations.slice(0, 15).map((s) => ({
      station: s.station,
      altitude_m: s.alt,
      pluie_mm: Object.fromEntries(jours.map((d, i) => [jourFr(d), s.rr?.[i] ?? null])),
      total_mm: total(s.rr),
    })),
    rafales_les_plus_fortes: gusts.slice(0, 10).map(({ s, g }) => ({ station: s.station, jour: jourFr(g.jour), rafale_kmh: kmh(g.ms), rafale_ms: g.ms })),
    stations: { avec_pluie: stations.filter((s) => s.rr).length, avec_rafale: gusts.length },
    records_battus: records(c).map((r) => ({
      station: r.station,
      jour: jourFr(r.jour),
      ...(r.quoi === "pluie" ? { pluie_mm: r.mm } : { rafale_kmh: kmh(r.ms!), rafale_ms: r.ms }),
      record_de_la_station: `mesures depuis ${r.depuis}`,
    })),
    selon_meteo_france: c.extraits
      ? {
          attribution: `Citations de Météo-France, mot pour mot (${c.document.titre}, ${c.extraits.reference}) : à attribuer à Météo-France, jamais à rundata.re.`,
          // Fixed keys, for a model to read: the sentence that introduces the quotes, then the quotes.
          intro: c.extraits.intro,
          citations: c.extraits.citations,
          a_savoir: c.extraits.note,
        }
      : undefined,
    page,
    a_savoir: `Seulement ce que les stations ont mesuré et le passage tel que le document cité l'écrit : ni victimes, ni dégâts. Toutes les stations sur ${page}.`,
    sources: credits([CLIMAT]),
  });
}

/** `lieu` is still accepted, for the clients that send it, and has no effect: no distance is computed any more. */
export async function cyclones(cache: Cache, _lieu: string | undefined, now = new Date(), nom?: string) {
  if (nom?.trim()) {
    const c = passeOf(nom);
    if (c) return passe(c);
  }
  const officiel = mf.officiel(mf.OFFICIEL_CYCLONE);

  let list: gdacs.Systeme[];
  try {
    list = (await gdacs.systemes(cache, now)).value.filter((s) => s.debut <= now.toISOString());
  } catch (err) {
    console.error(`source ${gdacs.SOURCE.id} indisponible:`, why(err));
    const a = await alert(cache, now);
    return {
      ...text({ erreur: "Le suivi des systèmes tropicaux (GDACS) ne répond pas pour le moment.", alerte_cyclonique: a?.texte, injoignable: a?.injoignable, ecoles: a?.ecoles, officiel, consulter: OFFICIAL, sources: credits([gdacs.SOURCE]) }),
      isError: true,
    };
  }

  const [active, a] = await Promise.all([gdacs.actifs(cache, list, now), alert(cache, now)]);
  const alerte = a?.texte;
  const rows = active.map((x) => activeRow(x.systeme, x.avis));
  const season = gdacs.seasonOf(now);
  const previous = `${Number(season.nom.slice(0, 4)) - 1}-${season.nom.slice(0, 4)}`;
  const thisSeason = list.filter((s) => s.debut >= season.debut);
  const lastSeason = list.filter((s) => s.debut < season.debut);
  const lastOne = list[0];

  const parts: string[] = [];
  if (alerte) parts.push(alerte);
  if (a?.injoignable) parts.push(a.injoignable);
  if (rows.length) {
    parts.push(`${rows.length} système${rows.length > 1 ? "s" : ""} tropical${rows.length > 1 ? "aux" : ""} actif${rows.length > 1 ? "s" : ""} dans le sud-ouest de l'océan Indien.`);
    for (const r of rows) {
      const name = r.nom.charAt(0).toUpperCase() + r.nom.slice(1);
      const when = r.dernier_avis.replace(" (heure de La Réunion)", "");
      parts.push(r.stade ? `${name} : ${r.stade}, d'après l'avis du CMRS du ${when}.` : `${name} : dernier avis du CMRS le ${when}.`);
    }
  } else {
    parts.push("Aucun système tropical actif dans le sud-ouest de l'océan Indien.");
    parts.push(
      thisSeason.length
        ? `Saison ${season.nom} : ${thisSeason.length} système${thisSeason.length > 1 ? "s" : ""} jusqu'ici.`
        : `Saison ${season.nom} : aucun système pour le moment.`,
    );
    if (lastOne) parts.push(`Dernier système : ${lastOne.nom}, du ${date(lastOne.debut)} au ${date(lastOne.fin)}.`);
  }
  // Météo-France's link last, with no full stop after its address.
  parts.push(officiel);

  return text({
    resume: parts.join(" "),
    alerte_cyclonique: alerte,
    injoignable: a?.injoignable,
    vie_quotidienne: a?.vie_quotidienne,
    ecoles: a?.ecoles,
    systemes_actifs: rows.length ? rows : undefined,
    saison_en_cours: { nom: season.nom, systemes: thisSeason.map(seasonRow) },
    saison_precedente: rows.length ? undefined : { nom: previous, systemes: lastSeason.map(seasonRow) },
    cyclone_passe: nom?.trim()
      ? `Pas de mesures sur rundata.re pour « ${nom.trim()} »\u00a0; cyclones passés disponibles : ${PASSES_LIST}.`
      : undefined,
    ...COMMON,
    officiel,
    consulter: OFFICIAL,
    sources: credits([gdacs.SOURCE, ...(alerte ? [mf.SOURCE] : [])]),
  });
}
