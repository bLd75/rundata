import type { Cache } from "../cache.js";
import { distanceKm } from "../geo.js";
import { INSEE } from "../places/insee.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import * as annuaire from "../providers/annuaire.js";
import { why } from "../types.js";
import { pageOf, slugify } from "../web/places.js";
import { carburantsAnswer, FUEL } from "./carburants.js";
import { credits, de, fr, notFound, text } from "./format.js";
import { COLLECTION, collecteAnswer } from "./collecte.js";
import { decheteriesAnswer, WASTE } from "./decheteries.js";
import { CHILDREN, enfantsAnswer } from "./enfants.js";
import { MARKET, marchesAnswer } from "./marches.js";
import { EMERGENCY, PHARMACY, pharmaciesAnswer, urgencesAnswer } from "./sante.js";

// Asked of the annuaire, a defibrillator is not an office: its link is the page of the devices.
const DEFIBRILLATOR = /d[ée]fibrillateur|\bdae\b/i;

const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

const short = (t: string) => t.replace(/^0/, "").replace(/h00$/, "h");

/** « lundi au jeudi 8h-16h ; vendredi 8h-15h ». */
export function hoursText(o: annuaire.Office): string | undefined {
  if (!o.horaires.length) return undefined;
  return o.horaires
    .map((h) => `${h.de === h.a ? h.de : `${h.de} au ${h.a}`} ${h.plages.map(([d, f]) => `${short(d)}-${short(f)}`).join(" et ")}${h.note ? ` (${h.note})` : ""}`)
    .join("\u00a0; ");
}

/** Open at `now` (local time), from the published hours; null when no hours are published. */
export function openNow(o: annuaire.Office, now: Date): boolean | null {
  if (!o.horaires.length) return null;
  const local = new Date(now.getTime() + 4 * 3600_000);
  const day = local.getUTCDay();
  const hm = `${String(local.getUTCHours()).padStart(2, "0")}h${String(local.getUTCMinutes()).padStart(2, "0")}`;
  return o.horaires.some((h) => {
    const [d0, d1] = [DAYS.indexOf(h.de), DAYS.indexOf(h.a)];
    if (d0 < 0 || d1 < 0) return false;
    const inRange = d0 <= d1 ? day >= d0 && day <= d1 : day >= d0 || day <= d1;
    return inRange && h.plages.some(([d, f]) => hm >= d && hm < f);
  });
}

/** The hours of `now`'s day (local time), as « 7h45-12h et 13h30-16h » ; undefined when it is closed all day. */
export function hoursOn(o: annuaire.Office, now: Date): string | undefined {
  const day = new Date(now.getTime() + 4 * 3600_000).getUTCDay();
  const h = o.horaires.find((x) => {
    const [d0, d1] = [DAYS.indexOf(x.de), DAYS.indexOf(x.a)];
    return d0 >= 0 && d1 >= 0 && (d0 <= d1 ? day >= d0 && day <= d1 : day >= d0 || day <= d1);
  });
  return h?.plages.length ? h.plages.map(([d, f]) => `${short(d)}-${short(f)}`).join(" et ") : undefined;
}

/**
 * Keeps the offices whose name holds every word asked (as a whole word, plural or not): the API's full-text search
 * also matches inside words, so « CAF » near Le Tampon finds the gendarmerie of La Plaine-des-Cafres.
 */
export function named(list: annuaire.Office[], quoi: string): annuaire.Office[] {
  const words = normalize(quoi).split(" ").filter((w) => w.length > 1).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w));
  return list.filter((o) => {
    const name = ` ${normalize(o.nom)} `;
    return words.every((w) => new RegExp(` ${w}s? `).test(name));
  });
}

export async function annuaireTool(cache: Cache, quoi: string, lieu: string | undefined, now = new Date()) {
  // Practical life, asked the same way: the pharmacies, the emergencies, the markets, the déchèteries, the fuel prices,
  // where to go with children.
  if (PHARMACY.test(quoi)) return pharmaciesAnswer(lieu);
  if (EMERGENCY.test(quoi)) return urgencesAnswer(lieu);
  if (MARKET.test(quoi)) return marchesAnswer(lieu);
  if (COLLECTION.test(quoi)) return collecteAnswer(lieu, now);
  if (WASTE.test(quoi)) return decheteriesAnswer(cache, quoi, lieu, now);
  if (FUEL.test(quoi)) return carburantsAnswer(cache, now);
  if (CHILDREN.test(quoi)) return enfantsAnswer(quoi, lieu, now);
  const res = lieu?.trim() ? resolvePlace(lieu) : null;
  if (lieu?.trim() && !res) return notFound(lieu);
  const code = res ? INSEE[res.lieu.commune] : undefined;
  let found: annuaire.Office[];
  try {
    // The place's commune first; the whole island when it has no such office (one CAF, one prefecture…).
    found = code ? named((await annuaire.search(cache, quoi, code)).value, quoi) : [];
    if (!found.length) {
      const island = (await annuaire.search(cache, quoi)).value;
      found = named(island, quoi).length ? named(island, quoi) : island;
    }
  } catch (err) {
    console.error(`source ${annuaire.SOURCE.id} indisponible:`, why(err));
    return { ...text({ erreur: "L'annuaire de l'administration ne répond pas pour le moment.", consulter: annuaire.SOURCE.url }), isError: true };
  }
  if (!found.length) {
    return text({
      resume: `Aucun service public trouvé à La Réunion pour « ${quoi} ».`,
      conseil: "Essayer un autre mot : mairie, CAF, préfecture, impôts, France Travail, tribunal, CPAM…",
      page: DEFIBRILLATOR.test(quoi) ? "https://rundata.re/defibrillateurs" : undefined,
      sources: credits([annuaire.SOURCE]),
    });
  }
  // Same commune first, then the nearest, then the search's own order.
  const p = res?.lieu;
  const dist = (o: annuaire.Office) => (p && o.lon != null && o.lat != null ? distanceKm(p.lon, p.lat, o.lon, o.lat) : null);
  const ranked = found
    .map((o, i) => ({ o, i, d: dist(o), same: code != null && o.insee === code }))
    .sort((a, b) => (p ? Number(b.same) - Number(a.same) || (a.d ?? 1e9) - (b.d ?? 1e9) : 0) || a.i - b.i)
    .slice(0, 5);
  const best = ranked[0];
  // The page of the place's commune, as the answers that carry their place link to it (citer.ts).
  const town = p && pageOf(slugify(p.commune));
  const h = hoursText(best.o);
  const open = openNow(best.o, now);
  return text({
    resume:
      `${best.o.nom}, ${best.o.adresse}` +
      (best.d != null ? ` (à ${fr(Math.round(best.d * 10) / 10)} km ${de(p!.nom)})` : "") +
      (h ? `. Horaires : ${h}` : "") +
      (open === null ? "" : open ? ". Ouvert en ce moment (d'après les horaires publiés)" : ". Fermé en ce moment (d'après les horaires publiés)") +
      (best.o.telephone ? `. Tél. ${best.o.telephone}` : "") +
      ".",
    resultats: ranked.map(({ o, d }) => ({
      nom: o.nom,
      adresse: o.adresse,
      distance_km: d != null ? Math.round(d * 10) / 10 : undefined,
      horaires: hoursText(o),
      ouvert_maintenant: openNow(o, now) ?? undefined,
      note_horaires: o.note_horaires,
      telephone: o.telephone,
      courriel: o.courriel,
      site: o.site,
      fiche: o.fiche || undefined,
    })),
    avertissements: ["Horaires publiés par chaque service sur service-public.fr : jours fériés et fermetures exceptionnelles non pris en compte."],
    page: town?.commune ? `https://rundata.re/communes/${town.slug}` : undefined,
    sources: credits([annuaire.SOURCE]),
  });
}
