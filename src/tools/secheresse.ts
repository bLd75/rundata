import type { Cache } from "../cache.js";
import { INSEE } from "../places/insee.js";
import { resolvePlace } from "../places/resolve.js";
import * as vigieau from "../providers/vigieau.js";
import { why } from "../types.js";
import { a, credits, notFound, placeBlock, text } from "./format.js";

export type Profil = "particulier" | "entreprise" | "collectivite" | "exploitation";

const COMMUNE_OF = Object.fromEntries(Object.entries(INSEE).map(([nom, code]) => [code, nom]));
const rank = (n: vigieau.Niveau) => vigieau.LEVELS.indexOf(n);
const name = (n: vigieau.Niveau) => vigieau.LEVEL_NAMES[n];
const day = (iso?: string) => iso?.split("-").reverse().join("/");
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} et ${xs.at(-1)}` : xs[0]);
const NONE = /^pas de (restriction|limitation)/i;

export function communeRow(zones: vigieau.Zone[], insee: string) {
  const of = (r: vigieau.Ressource) => zones.find((z) => z.insee === insee && z.ressource === r);
  const [aep, sup, sou] = [of("AEP"), of("SUP"), of("SOU")];
  return {
    commune: COMMUNE_OF[insee] ?? insee,
    eau_du_robinet: aep ? name(aep.niveau) : undefined,
    rivieres_et_sources: sup ? name(sup.niveau) : undefined,
    nappes: sou ? name(sou.niveau) : undefined,
    niveau_max: [aep, sup, sou].filter((z) => z).reduce((m, z) => Math.max(m, rank(z!.niveau)), -1),
  };
}

const COMMON = {
  echelle: "Du moins au plus sévère : vigilance (économiser l'eau), alerte, alerte renforcée, crise (seuls les usages prioritaires : santé, salubrité, sécurité).",
  a_savoir: "Restrictions fixées par arrêté préfectoral, commune par commune. Une mairie ou le distributeur peut ajouter des coupures ou des tours d'eau : voir leurs avis.",
};

export async function restrictionsEau(cache: Cache, lieu: string | undefined, profil: Profil = "particulier") {
  let zones: vigieau.Zone[];
  try {
    zones = (await vigieau.zones(cache)).value;
  } catch (err) {
    console.error(`source ${vigieau.SOURCE.id} indisponible:`, why(err));
    return { ...text({ erreur: "Les restrictions d'eau (VigiEau) ne répondent pas pour le moment.", consulter: vigieau.SOURCE.url }), isError: true };
  }
  const since = zones.map((z) => z.depuis).filter(Boolean).sort().pop();
  const common = { arrete_du: day(since), ...COMMON, consulter: vigieau.SOURCE.url, sources: credits([vigieau.SOURCE]) };

  if (!lieu?.trim()) {
    if (!zones.length) return text({ resume: "Aucune restriction d'eau en vigueur à La Réunion.", ...common });
    const rows = Object.values(INSEE).map((code) => communeRow(zones, code)).sort((x, y) => y.niveau_max - x.niveau_max || x.commune.localeCompare(y.commune, "fr"));
    const tap = [...vigieau.LEVELS].reverse()
      .map((lvl) => ({ lvl, list: rows.filter((r) => r.eau_du_robinet === name(lvl)).map((r) => r.commune) }))
      .filter((x) => x.list.length)
      .map((x) => `${name(x.lvl)} ${x.list.length > 4 ? `dans ${x.list.length} communes` : list(x.list.map(a))}`);
    return text({
      resume: `Sécheresse à La Réunion${since ? ` (arrêté en vigueur depuis le ${day(since)})` : ""}. Eau du robinet : ${tap.join("\u00a0; ")}.`,
      communes: rows.map(({ niveau_max: _, ...r }) => r),
      ...common,
    });
  }

  const res = resolvePlace(lieu);
  if (!res) return notFound(lieu);
  const insee = INSEE[res.lieu.commune];
  const mine = zones.filter((z) => z.insee === insee);
  const aep = mine.find((z) => z.ressource === "AEP");
  if (!mine.length) {
    return text({ lieu: placeBlock(lieu, res), resume: `Aucune restriction d'eau en vigueur ${a(res.lieu.commune)}.`, ...common });
  }
  const pick = (z?: vigieau.Zone) => (z?.usages ?? []).filter((u) => u[profil] && !NONE.test(u.restriction)).map((u) => ({ usage: u.nom, restriction: u.restriction }));
  const others = mine.filter((z) => z.ressource !== "AEP");
  const row = communeRow(zones, insee);
  return text({
    lieu: placeBlock(lieu, res),
    resume: `Restrictions d'eau ${a(res.lieu.commune)} : ${aep ? `${name(aep.niveau)} pour l'eau du robinet` : "pas de restriction sur l'eau du robinet"}` +
      (others.length ? `\u00a0; ${others.map((z) => `${name(z.niveau)} pour les ${vigieau.RESSOURCES[z.ressource]}`).join(", ")}` : "") + ".",
    niveaux: { eau_du_robinet: row.eau_du_robinet, rivieres_et_sources: row.rivieres_et_sources, nappes: row.nappes },
    profil,
    restrictions_eau_du_robinet: aep ? pick(aep) : undefined,
    // For whoever draws from a river, a spring, a well or a borehole.
    restrictions_puits_forages_rivieres: others.length ? Object.fromEntries(others.map((z) => [vigieau.RESSOURCES[z.ressource], pick(z)])) : undefined,
    arrete: aep?.arrete ?? mine[0].arrete,
    ...common,
  });
}
