import type { Cache } from "../cache.js";
import { localTime } from "../geo.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import * as atmo from "../providers/atmo.js";
import { why } from "../types.js";
import { credits, notFound, placeBlock, text } from "./format.js";

const today = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);

/** The pollutants that set the index (the highest sub-indices), in words. */
export function drivers(x: atmo.Index): string[] {
  const top = Math.max(...Object.values(x.sous_indices));
  return Object.entries(x.sous_indices).filter(([, v]) => v === top && v >= 2).map(([k]) => atmo.POLLUTANTS[k]);
}

function sentence(x: atmo.Index, when: string): string {
  const d = drivers(x);
  return `${when} : ${atmo.level(x.niveau)} (${x.niveau}/6)${d.length ? `, surtout ${d.join(" et ")}` : ""}`;
}

/** Each pollutant's sub-index, by its name in words. */
export const subIndices = (x: atmo.Index) => Object.fromEntries(Object.entries(x.sous_indices).map(([k, v]) => [atmo.POLLUTANTS[k], v]));

/**
 * When Atmo Réunion diffused the day's forecast: « le 28/10 à 10:45 », said « la veille » when it was diffused the day
 * before, the forecast for the next day.
 */
export function diffusion(list: atmo.Index[], day: string): string | undefined {
  const at = list.filter((x) => x.jour === day && x.diffuse_le).map((x) => x.diffuse_le!).sort().pop();
  if (!at) return undefined;
  const [date, time] = localTime(new Date(at)).split(" ");
  const before = Date.parse(at) < Date.parse(`${day}T00:00:00+04:00`);
  return `Prévision diffusée par Atmo Réunion ${before ? "la veille, " : ""}le ${date} à ${time}`;
}

export async function qualiteAir(cache: Cache, lieu: string | undefined, now = new Date()) {
  let list: atmo.Index[];
  let readAt: Date;
  try {
    ({ value: list, fetchedAt: readAt } = await atmo.indices(cache));
  } catch (err) {
    console.error(`source ${atmo.SOURCE.id} indisponible:`, why(err));
    return { ...text({ erreur: "L'indice de qualité de l'air ne répond pas pour le moment.", consulter: atmo.SOURCE.url }), isError: true };
  }
  const day = today(now);
  const diffusee = diffusion(list, day);
  const common = {
    nature: "PRÉVISION du jour par commune, calculée par Atmo Réunion : pas une mesure.",
    ...(diffusee && { diffusion: `${diffusee}.` }),
    lu_par_rundata: localTime(readAt),
    echelle: "1 bon, 2 moyen, 3 dégradé, 4 mauvais, 5 très mauvais, 6 extrêmement mauvais\u00a0; pour un sous-indice, 0 indisponible, 7 événement",
    comment_c_est_fait: { etapes: atmo.METHODE, d_apres: "Guide de calcul de l'indice ATMO d'Atmo France (version du 14/12/2020)", lien: atmo.GUIDE },
    provenance: atmo.PROVENANCE,
    avertissements: [
      "Indice calculé à l'échelle de la commune : près d'une route chargée, d'une usine ou d'un feu, l'air peut être plus mauvais.",
      "Pendant une éruption du Piton de la Fournaise, le panache (dioxyde de soufre, « vog ») peut dégrader l'air dans le sud et l'ouest selon le vent.",
    ],
    consulter: atmo.SOURCE.url,
    sources: credits([atmo.SOURCE]),
  };

  if (!lieu?.trim()) {
    const todays = list.filter((x) => x.jour === day);
    const worst = Math.max(0, ...todays.map((x) => x.niveau));
    const atWorst = todays.filter((x) => x.niveau === worst).map((x) => x.commune);
    return text({
      resume: todays.length
        ? `Qualité de l'air prévue aujourd'hui à La Réunion : au pire ${atmo.level(worst)} (${worst}/6)` +
          (atWorst.length < todays.length ? `, à ${atWorst.join(", ")}` : " dans toutes les communes") + "."
        : "L'indice du jour n'est pas dans la dernière lecture de la couche d'Atmo France.",
      communes: todays.map((x) => ({ commune: x.commune, niveau: x.niveau, qualite: atmo.level(x.niveau), polluants: drivers(x), sous_indices: subIndices(x) })),
      ...common,
    });
  }

  const res = resolvePlace(lieu);
  if (!res) return notFound(lieu);
  const mine = list.filter((x) => x.jour >= day && normalize(x.commune) === normalize(res.lieu.commune)).sort((a, b) => a.jour.localeCompare(b.jour));
  const now_ = mine.find((x) => x.jour === day);
  const next = mine.find((x) => x.jour > day);
  const parts = [now_ && sentence(now_, `Qualité de l'air prévue aujourd'hui à ${res.lieu.commune}`), next && sentence(next, "demain")].filter(Boolean);
  return text({
    lieu: placeBlock(lieu, res),
    resume: parts.length ? `${parts.join("\u00a0; ")}.` : `Pas d'indice publié pour ${res.lieu.commune} aujourd'hui.`,
    indices: mine.map((x) => ({
      jour: x.jour,
      niveau: x.niveau,
      qualite: atmo.level(x.niveau),
      sous_indices: subIndices(x),
    })),
    ...common,
  });
}
