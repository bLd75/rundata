import type { Cache } from "../cache.js";
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
  return `${when} : ${atmo.LEVELS[x.niveau] ?? `niveau ${x.niveau}`} (${x.niveau}/6)${d.length ? `, surtout ${d.join(" et ")}` : ""}`;
}

export async function qualiteAir(cache: Cache, lieu: string | undefined, now = new Date()) {
  let list: atmo.Index[];
  try {
    list = (await atmo.indices(cache)).value;
  } catch (err) {
    console.error(`source ${atmo.SOURCE.id} indisponible:`, why(err));
    return { ...text({ erreur: "L'indice de qualité de l'air ne répond pas pour le moment.", consulter: atmo.SOURCE.url }), isError: true };
  }
  const day = today(now);
  const common = {
    nature: "indice prévu pour la journée par Atmo Réunion (pas une mesure horaire)",
    echelle: "1 bon, 2 moyen, 3 dégradé, 4 mauvais, 5 très mauvais, 6 extrêmement mauvais",
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
        ? `Qualité de l'air aujourd'hui à La Réunion : au pire ${atmo.LEVELS[worst]} (${worst}/6)` +
          (atWorst.length < todays.length ? `, à ${atWorst.join(", ")}` : " dans toutes les communes") + "."
        : "L'indice du jour n'est pas encore publié (vers 12:30).",
      communes: todays.map((x) => ({ commune: x.commune, niveau: x.niveau, qualite: atmo.LEVELS[x.niveau], polluants: drivers(x) })),
      ...common,
    });
  }

  const res = resolvePlace(lieu);
  if (!res) return notFound(lieu);
  const mine = list.filter((x) => x.jour >= day && normalize(x.commune) === normalize(res.lieu.commune)).sort((a, b) => a.jour.localeCompare(b.jour));
  const now_ = mine.find((x) => x.jour === day);
  const next = mine.find((x) => x.jour > day);
  const parts = [now_ && sentence(now_, `Qualité de l'air aujourd'hui à ${res.lieu.commune}`), next && sentence(next, "demain")].filter(Boolean);
  return text({
    lieu: placeBlock(lieu, res),
    resume: parts.length ? `${parts.join("\u00a0; ")}.` : `Pas d'indice publié pour ${res.lieu.commune} aujourd'hui.`,
    indices: mine.map((x) => ({
      jour: x.jour,
      niveau: x.niveau,
      qualite: atmo.LEVELS[x.niveau],
      sous_indices: Object.fromEntries(Object.entries(x.sous_indices).map(([k, v]) => [atmo.POLLUTANTS[k], v])),
    })),
    ...common,
  });
}
