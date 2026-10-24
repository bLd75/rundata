import type { Cache } from "../cache.js";
import { distanceKm } from "../geo.js";
import { INSEE } from "../places/insee.js";
import { normalize, resolvePlace, type Resolution } from "../places/resolve.js";
import * as baignades from "../providers/baignades.js";
import * as potable from "../providers/eaupotable.js";
import { why } from "../types.js";
import { a, credits, notFound, placeBlock, text } from "./format.js";

export type Sujet = "robinet" | "baignade";

const NEAR_KM = 5;
const SHOWN = 6;
const BATHING_WORDS = /\b(plage|baignade|baigner|bassin|lagon|mer|nager|eau de mer)\b/;
const TAP_WORDS = /\b(robinet|potable|boire|buvable|eau courante|reseau)\b/;

const day = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Which water the question is about, when the caller did not say: by its words, then by the kind of place. */
export function sujetOf(lieu: string, res: Resolution | null): Sujet[] {
  const q = normalize(lieu);
  if (TAP_WORDS.test(q)) return ["robinet"];
  if (BATHING_WORDS.test(q) || res?.lieu.type === "plage" || res?.lieu.type === "bassin" || siteNamed(lieu)) return ["baignade"];
  return ["robinet", "baignade"];
}

const words = (s: string) => normalize(s).split(" ").filter((t) => t.length > 2 && !["des", "les", "reseau", "haut", "hauts", "bas"].includes(t));

/** The network serving the place asked, when its name or one of its quartiers says so. */
export function networkFor(reseaux: potable.Reseau[], place: string, commune: string): potable.Reseau | null {
  const asked = words(place).filter((t) => !words(commune).includes(t));
  if (!asked.length) return null;
  let best: potable.Reseau | null = null;
  let top = 0;
  let tie = false;
  for (const r of reseaux) {
    const have = new Set(words(`${r.nom} ${r.quartiers.join(" ")}`));
    const n = asked.filter((t) => have.has(t)).length;
    if (n > top) [best, top, tie] = [r, n, false];
    else if (n === top && n > 0) tie = true;
  }
  return top && !tie ? best : null;
}

/** The samples off the limits, one line per day: the ARS often samples several taps of a network the same day. */
function byDay(bad: potable.Prelevement[]) {
  const days = new Map<string, { date: string; prelevements: number; depassements: string[] }>();
  for (const s of bad) {
    const d = days.get(day(s.date)) ?? { date: day(s.date), prelevements: 0, depassements: [] };
    d.prelevements++;
    for (const x of s.depassements) {
      const line = `${x.parametre} : ${x.resultat} (limite ${x.limite})`;
      if (!d.depassements.includes(line)) d.depassements.push(line);
    }
    days.set(d.date, d);
  }
  return [...days.values()].map((d) => ({ ...d, depassements: d.depassements.length ? d.depassements : undefined }));
}

export function networkRow(r: potable.Reseau, samples: potable.Prelevement[]) {
  const mine = samples.filter((s) => s.reseaux.includes(r.code));
  const bad = mine.filter((s) => !s.conforme);
  const last = mine[0];
  return {
    reseau: r.nom,
    quartiers: r.quartiers.length ? r.quartiers.join(" ; ") : undefined,
    derniere_analyse: last ? day(last.date) : "aucune depuis 6 mois",
    derniere_analyse_conforme: last ? last.conforme : undefined,
    analyses_6_mois: mine.length,
    non_conformes_6_mois: bad.length,
    non_conformites: bad.length ? byDay(bad).slice(0, 4) : undefined,
  };
}

function tapSentence(row: ReturnType<typeof networkRow>, where: string): string {
  if (!row.analyses_6_mois) return `Pas d'analyse publiée depuis 6 mois pour le réseau ${row.reseau} ${where}.`;
  const last = `dernière analyse le ${row.derniere_analyse} : ${row.derniere_analyse_conforme ? "conforme" : "NON CONFORME"}`;
  const bad = row.non_conformes_6_mois
    ? `${row.non_conformes_6_mois} analyse${row.non_conformes_6_mois > 1 ? "s" : ""} non conforme${row.non_conformes_6_mois > 1 ? "s" : ""} sur ${row.analyses_6_mois} en 6 mois`
    : `toutes conformes en 6 mois (${row.analyses_6_mois})`;
  return `Eau du robinet, réseau ${row.reseau} ${where} : ${last} ; ${bad}.`;
}

async function robinet(cache: Cache, res: Resolution, now: Date) {
  const commune = res.lieu.commune;
  const insee = INSEE[commune];
  if (!insee) return { resume: "Commune introuvable pour l'eau du robinet." };
  const { value } = await potable.commune(cache, insee, now);
  const rows = value.reseaux.map((r) => networkRow(r, value.prelevements));
  const own = res.lieu.type === "commune" ? null : networkFor(value.reseaux, res.lieu.nom, commune);
  if (own) {
    const row = networkRow(own, value.prelevements);
    return { resume: tapSentence(row, a(res.lieu.nom)), reseau: row, autres_reseaux_de_la_commune: rows.length - 1 };
  }
  const ordered = rows.sort((x, y) => y.non_conformes_6_mois - x.non_conformes_6_mois || x.reseau.localeCompare(y.reseau));
  const badNets = ordered.filter((r) => r.non_conformes_6_mois);
  const total = value.prelevements.length;
  const resume = `Eau du robinet ${a(commune)} : ${value.reseaux.length} réseau${value.reseaux.length > 1 ? "x" : ""}, ${total} analyse${total > 1 ? "s" : ""} en 6 mois` +
    (badNets.length
      ? ` ; non-conformités sur ${badNets.map((r) => `${r.reseau} (${r.non_conformes_6_mois})`).join(", ")}.`
      : total ? ", toutes conformes." : ".") +
    (value.reseaux.length > 1 ? " La qualité dépend du réseau qui dessert le quartier : préciser le quartier." : "");
  return { resume, reseaux: ordered };
}

export function siteRow(r: baignades.Results, now: Date, from?: { lon: number; lat: number }) {
  const last = r.prelevements[0];
  const yearAgo = new Date(now.getTime() - 365 * 86400_000).toISOString().slice(0, 10);
  const year = r.prelevements.filter((s) => s.date >= yearAgo);
  return {
    site: r.site.nom,
    commune: r.site.commune,
    distance_km: from ? Math.round(distanceKm(from.lon, from.lat, r.site.lon, r.site.lat) * 10) / 10 : undefined,
    dernier_prelevement: last ? day(last.date) : "aucun",
    qualite_dernier_prelevement: last?.qualite ?? undefined,
    derniers_prelevements: r.prelevements.slice(0, SHOWN).map((s) => ({
      date: day(s.date),
      qualite: s.qualite ?? "non lue",
      enterocoques_100ml: s.enterocoques,
      e_coli_100ml: s.e_coli,
    })),
    mauvais_sur_12_mois: year.filter((s) => s.qualite === "mauvaise").length || undefined,
    classement: r.classement && !/non class/i.test(r.classement.texte) ? `${r.classement.texte} (saison ${r.classement.saison})` : undefined,
  };
}

function bathSentence(row: ReturnType<typeof siteRow>): string {
  if (!row.qualite_dernier_prelevement) return `${row.site} : pas de prélèvement publié.`;
  return `${row.site} : eau de ${row.qualite_dernier_prelevement} qualité au dernier prélèvement (${row.dernier_prelevement})` +
    (row.mauvais_sur_12_mois ? `, ${row.mauvais_sur_12_mois} mauvais résultat${row.mauvais_sur_12_mois > 1 ? "s" : ""} sur 12 mois` : "") + ".";
}

/** A supervised site whose name the question carries (« bassin Bleu » is the one of Saint-Benoît, not another). */
export function siteNamed(lieu: string): baignades.Site | null {
  const q = new Set(words(lieu));
  const scored = baignades.SITES.map((s) => {
    // The words of the site's own name: not « plage », not its commune (« Plage du centre-ville de Saint-Leu »).
    const common = new Set([...words(s.commune), "plage", "bassin", "saint", "sainte", "ville", "centre"]);
    const own = words(s.nom).filter((t) => !common.has(t));
    return { s, n: own.length && own.every((t) => q.has(t)) ? own.length : 0 };
  }).filter((x) => x.n).sort((x, y) => y.n - x.n);
  return scored[0]?.s ?? null;
}

async function baignade(cache: Cache, res: Resolution, now: Date, lieu: string) {
  const named = siteNamed(lieu);
  if (named) {
    const r = await baignades.results(cache, named, now);
    const row = siteRow(r.value, now);
    return { resume: bathSentence(row), sites: [row] };
  }
  const near = baignades.SITES
    .map((s) => ({ s, d: distanceKm(res.lieu.lon, res.lieu.lat, s.lon, s.lat) }))
    .sort((x, y) => x.d - y.d);
  const picked = near.filter((x) => x.d <= NEAR_KM).slice(0, 2);
  if (!picked.length) {
    return {
      resume: `Aucun site de baignade contrôlé par l'ARS à moins de ${NEAR_KM} km ${a(res.lieu.commune || res.lieu.nom)} ; le plus proche : ${near[0].s.nom} (${near[0].s.commune}, ${Math.round(near[0].d)} km).`,
      sites_controles: baignades.SITES.map((s) => `${s.nom} (${s.commune})`),
    };
  }
  const results = await Promise.all(picked.map((x) => baignades.results(cache, x.s, now)));
  const rows = results.map((r) => siteRow(r.value, now, res.lieu));
  return { resume: rows.map(bathSentence).join(" "), sites: rows };
}

export const COMMON = {
  eau_du_robinet:
    "Analyses du contrôle sanitaire de l'ARS, publiées un à deux mois après le prélèvement. Un avis temporaire « ne pas boire l'eau » " +
    "(après de fortes pluies, une eau trouble…) passe par la mairie, le distributeur et l'ARS : il n'est pas dans ces données.",
  eau_de_baignade:
    "Prélèvement toutes les deux semaines environ ; seuils par prélèvement (germes pour 100 mL) : bonne jusqu'à 100 entérocoques et 100 E. coli, " +
    "mauvaise au-delà de 370 entérocoques ou 1 000 E. coli. Après de fortes pluies, l'eau est souvent polluée pendant un à trois jours (ravines, rejets).",
  baignade_en_mer:
    "À La Réunion, la baignade en mer n'est autorisée que dans le lagon et les zones aménagées et surveillées (arrêté préfectoral, risque requin).",
};

export async function qualiteEau(cache: Cache, lieu: string | undefined, sujet?: Sujet, now = new Date()) {
  const sources = credits([potable.SOURCE, baignades.SOURCE]);
  if (!lieu?.trim()) {
    return text({
      resume: "Préciser une commune, un quartier, une plage ou un bassin : la qualité de l'eau du robinet dépend du réseau, celle de la baignade du site.",
      sites_de_baignade_controles: baignades.SITES.map((s) => `${s.nom} (${s.commune})`),
      ...COMMON,
      sources,
    });
  }
  const res = resolvePlace(lieu);
  if (!res) return notFound(lieu);
  const wanted = sujet ? [sujet] : sujetOf(lieu, res);
  const parts: Record<string, unknown> = {};
  const summary: string[] = [];
  const failed: string[] = [];
  await Promise.all(wanted.map(async (w) => {
    try {
      const part = w === "robinet" ? await robinet(cache, res, now) : await baignade(cache, res, now, lieu);
      parts[w === "robinet" ? "eau_du_robinet" : "baignade"] = part;
    } catch (err) {
      const src = w === "robinet" ? potable.SOURCE : baignades.SOURCE;
      console.error(`source ${src.id} indisponible:`, why(err));
      failed.push(w);
    }
  }));
  // Guessed, not asked: no bathing part for a place far from any site checked.
  if (!sujet && wanted.length === 2 && !(parts.baignade as { sites?: unknown[] } | undefined)?.sites) delete parts.baignade;
  for (const k of ["eau_du_robinet", "baignade"]) {
    const p = parts[k] as { resume?: string } | undefined;
    if (p?.resume) summary.push(p.resume);
  }
  if (!summary.length) {
    return {
      ...text({ erreur: "Les données de qualité de l'eau ne répondent pas pour le moment.", consulter: [potable.SOURCE.url, baignades.SOURCE.url] }),
      isError: true,
    };
  }
  return text({
    lieu: placeBlock(lieu, res),
    resume: summary.join(" "),
    ...parts,
    indisponible: failed.length ? failed.map((f) => (f === "robinet" ? "eau du robinet" : "eau de baignade")) : undefined,
    a_savoir: {
      ...(wanted.includes("robinet") ? { eau_du_robinet: COMMON.eau_du_robinet } : {}),
      ...(wanted.includes("baignade") ? { eau_de_baignade: COMMON.eau_de_baignade, baignade_en_mer: COMMON.baignade_en_mer } : {}),
    },
    consulter: wanted.map((w) => (w === "robinet" ? "https://www.reunion.ars.sante.fr" : baignades.SOURCE.url)),
    sources,
  });
}
