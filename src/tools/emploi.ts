import type { Cache } from "../cache.js";
import { localTime } from "../geo.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import * as emploiSource from "../providers/emploi.js";
import type { Offre } from "../providers/emploi.js";
import { why } from "../types.js";
import { injoignable } from "./injoignable.js";
import { a, credits, fr, notFound, placeBlock, text } from "./format.js";

/** The sites for the companies' offers, linked and never read (marketing, 29/10/2026). */
export const ENTREPRISES = [
  { nom: "France Travail", lien: "https://www.francetravail.fr/accueil/" },
  { nom: "Mon emploi la Réunion", lien: "https://monemploi-lareunion.francetravail.fr/" },
];
/** The user's line, word for word, with no link to them. */
export const NON_REPRIS = "Les sites qui n'autorisent pas la reprise de leurs données : HelloWork, Meteojob, Domtomjob, APEC, Indeed, LinkedIn, leboncoin, Jooble.";
/** What is covered, in marketing's words; the second sentence while some offer has no closing date. */
export const COUVERTURE = "Les offres de La Réunion publiées sur Choisir le service public, lues chaque heure. Une offre reste ici jusqu'à sa date limite de candidature. Elle peut être pourvue avant : la page de l'offre fait foi.";
export const SANS_LIMITE = `Sans date limite, elle reste ${emploiSource.GARDE_JOURS} jours après sa publication, la durée médiane des offres de La Réunion en 2026.`;
// The tool's answer lists this many offers at most; the rest are counted.
const MAX = 40;

const dayMonth = (iso: string) => localTime(new Date(iso)).split(" ")[0];
/** « 2026-11-20 » → « 20/11 ». */
const limite = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const plural = (n: number, one: string, many: string) => `${fr(n)} ${n > 1 ? many : one}`;

/** One offer, as the tool and the page say it. */
export function offreRow(o: Offre) {
  return {
    intitule: o.intitule,
    ...(o.employeur ? { employeur: o.employeur } : {}),
    ...(o.commune ? { commune: o.commune } : o.lieu ? { lieu: o.lieu } : {}),
    ...(o.metier ? { metier: o.metier } : o.domaine ? { domaine: o.domaine } : {}),
    ...(o.nature ? { nature: o.nature } : {}),
    publiee_le: dayMonth(o.publiee),
    ...(o.limite ? { date_limite: limite(o.limite) } : {}),
    lien: o.lien,
  };
}
type Une = ReturnType<typeof offreRow>;
/** An offer of a line that holds several: its reference as the site writes it, its day and its page. */
export interface Reference {
  reference: string;
  publiee_le: string;
  lien: string;
}
/**
 * A line of the tool and of the page: one offer, or the offers that would read the same, each with its reference (the
 * site publishes one post under several, a reference per category at the DGAC). The day each was published does not
 * part them, as the page does not show it beside a closing date: said for each one; the closing date does.
 */
export type OffreRow = Une | (Omit<Une, "lien" | "publiee_le"> & { publiee_le?: string; nombre_offres: number; references: Reference[] });

/** The offers in lines, in the order of the first of each. */
export function lignes(offres: Offre[]): OffreRow[] {
  const groups = new Map<string, Offre[]>();
  for (const o of offres) {
    const { lien: _, publiee_le: __, ...shown } = offreRow(o);
    const key = JSON.stringify(shown);
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return [...groups.values()].map((g) => {
    const row = offreRow(g[0]);
    if (g.length === 1) return row;
    const { lien: _, publiee_le, ...shown } = row;
    const references = g.map((o) => ({ reference: o.ref, publiee_le: dayMonth(o.publiee), lien: o.lien }));
    return { ...shown, ...(references.every((r) => r.publiee_le === publiee_le) ? { publiee_le } : {}), nombre_offres: g.length, references };
  });
}

/** Whether every word asked is in the offer: its title, employer, field, job, nature or place. */
const matches = (o: Offre, words: string[]) => {
  const t = ` ${normalize([o.intitule, o.employeur, o.domaine, o.metier, o.nature, o.lieu, o.commune].filter(Boolean).join(" "))} `;
  return words.every((w) => t.includes(w));
};

/**
 * The public sector's offers open at La Réunion, newest first: the island's, a commune's (`lieu`), those that hold
 * every word of `motCle`. `max`: how many are listed (the page lists them all).
 */
export async function emploi(cache: Cache, lieu: string | undefined, motCle: string | undefined, now = new Date(), max = MAX) {
  let copie;
  try {
    copie = await emploiSource.offres(cache, now);
  } catch (err) {
    console.error(`source ${emploiSource.SOURCE.id} indisponible:`, why(err));
  }
  if (!copie) return { ...text({ erreur: "Les offres d'emploi public ne sont pas disponibles pour le moment.", consulter: emploiSource.SOURCE.url }), isError: true };
  const { value: c, fetchedAt } = copie;
  const at = localTime(fetchedAt);

  let place: ReturnType<typeof resolvePlace> = null;
  if (lieu?.trim()) {
    place = resolvePlace(lieu);
    if (!place || !place.lieu.commune) return notFound(lieu);
  }
  const commune = place?.lieu.commune;
  const words = motCle?.trim() ? normalize(motCle).split(" ").filter(Boolean) : [];
  const all = c.offres.filter((o) => (!commune || o.commune === commune) && matches(o, words));
  const sansCommune = commune ? c.offres.filter((o) => !o.commune && matches(o, words)).length : 0;
  const what = words.length ? ` pour « ${motCle!.trim()} »` : "";

  const resume = !c.offres.length
    ? `Aucune offre publiée sur Choisir le service public pour La Réunion à ${at.split(" ")[1]}.`
    : `${plural(all.length, "offre ouverte", "offres ouvertes")} à la candidature${commune ? ` ${a(commune)}` : " à La Réunion"}${what} sur Choisir le service public` +
      `${all[0] ? `, la plus récente publiée le ${dayMonth(all[0].publiee)} : ${all[0].intitule}` : ""}.` +
      (sansCommune ? ` ${plural(sansCommune, "autre offre de La Réunion ne précise pas sa commune", "autres offres de La Réunion ne précisent pas leur commune")}${what}.` : "");

  const rows = lignes(all).slice(0, max);
  const shown = rows.reduce((n, r) => n + ("nombre_offres" in r ? r.nombre_offres : 1), 0);
  return text({
    ...(place && lieu ? { lieu: placeBlock(lieu, place) } : {}),
    resume,
    nombre: all.length,
    offres: rows,
    ...(all.length > shown ? { autres: `${plural(all.length - shown, "autre offre", "autres offres")}, sur ${emploiSource.SOURCE.url}` } : {}),
    ...(c.echec ? { injoignable: injoignable("le site de Choisir le service public", at, localTime(new Date(c.echec)), now).texte } : {}),
    couverture: c.offres.some((o) => !o.limite && !emploiSource.enAttente(o)) ? `${COUVERTURE} ${SANS_LIMITE}` : COUVERTURE,
    entreprises: `Les offres des entreprises ne sont pas reprises ici : vous les trouvez sur ${ENTREPRISES.map((e) => `${e.nom} (${e.lien})`).join(" et sur ")}, le portail emploi et formation de La Réunion.`,
    non_repris: NON_REPRIS,
    donnees: `Offres lues sur Choisir le service public (lecture de ${at.split(" ")[1]} le ${at.split(" ")[0]}, heure de La Réunion)\u00a0; chaque offre dit sa date de publication et sa date limite de candidature quand le site la donne.`,
    sources: credits([emploiSource.SOURCE]),
  });
}
