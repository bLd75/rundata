import type { Cache } from "../cache.js";
import { distributeur } from "../eau/distributeurs.js";
import { resolvePlace } from "../places/resolve.js";
import * as notices from "../providers/avis-eau.js";
import { BACK } from "../providers/avis-eau.js";
import { why } from "../types.js";
import { a, credits, notFound, placeBlock, text } from "./format.js";

/** The communes whose distributor publishes its notices in a feed read here. */
export const COVERED = ["Saint-Denis", "La Possession", "Bras-Panon", "Saint-André", "La Plaine-des-Palmistes", "Saint-Benoît", "Sainte-Rose", "Salazie"];
const RECENT_DAYS = 5;
const QUALITY = /qualit|potab|boire|chlor|conformit|bouilli|embouteill/i;

/** « 2026-10-26T21:00 » → « lundi 26/10 à 21:00 ». */
function when(local?: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(`${local}:00Z`);
  const wd = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"][d.getUTCDay()];
  return `${wd} ${local.slice(8, 10)}/${local.slice(5, 7)} à ${local.slice(11, 16)}`;
}
const published = (n: notices.Avis) => {
  const l = new Date(new Date(n.publie).getTime() + 4 * 3600_000).toISOString();
  return `${l.slice(8, 10)}/${l.slice(5, 7)}/${l.slice(0, 4)} à ${l.slice(11, 16)}`;
};
const nowLocal = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 16);

/** The notices still worth telling: a cut not over yet, or anything published in the last few days. */
export function current(list: notices.Avis[], now: Date): notices.Avis[] {
  const here = nowLocal(now);
  const since = new Date(now.getTime() - RECENT_DAYS * 86400_000).toISOString();
  return list.filter((n) => (n.fin ? n.fin >= here : n.publie >= since));
}

/** Whether the water of a commune should not be drunk now: its latest notice about quality says so. */
export function doNotDrink(list: notices.Avis[], commune: string): notices.Avis | null {
  const latest = list.filter((n) => n.communes.includes(commune) && (QUALITY.test(n.titre + n.texte) || BACK.test(n.texte)))
    .sort((x, y) => y.publie.localeCompare(x.publie))[0];
  return latest && latest.ne_pas_boire && !BACK.test(latest.texte) ? latest : null;
}

/** `current`: whether it is the notice that says not to drink the water now; older ones are superseded. */
export function noticeRow(n: notices.Avis, now: Date, current = n.ne_pas_boire) {
  const here = nowLocal(now);
  const state = n.debut && n.fin ? (n.fin < here ? "terminée" : n.debut <= here ? "en cours" : "à venir") : undefined;
  return {
    titre: n.titre,
    communes: n.communes,
    distributeur: n.distributeur,
    publie_le: published(n),
    coupure: n.debut ? { de: when(n.debut), a: when(n.fin), etat: state } : undefined,
    secteurs: n.secteurs.length ? n.secteurs : undefined,
    ne_pas_boire: (n.ne_pas_boire && current) || undefined,
    texte: n.texte,
    lien: n.lien,
  };
}

const COMMON = {
  couverture: `Avis lus pour ${COVERED.join(", ")} (Dionéo, Eaux de La Possession, CISE Réunion par la CIREST) et pour les communes de runéo quand il en publie. Ailleurs, voir la mairie ou le distributeur.`,
  a_savoir: "Après une coupure, l'eau peut être trouble ou impropre à la boisson pendant quelques heures : la laisser couler avant de la boire. Quand un avis dit de ne pas boire l'eau, utiliser de l'eau en bouteille ou bouillie au moins 3 minutes pour boire, cuisiner et se brosser les dents.",
};

export async function coupuresEau(cache: Cache, lieu: string | undefined, now = new Date()) {
  let all: notices.Avis[];
  try {
    all = (await notices.avis(cache)).value;
  } catch (err) {
    console.error(`source ${notices.SOURCE.id} indisponible:`, why(err));
    return { ...text({ erreur: "Les avis des distributeurs d'eau ne répondent pas pour le moment.", consulter: notices.SOURCE.url }), isError: true };
  }
  const live = current(all, now);
  const common = { ...COMMON, sources: credits([notices.SOURCE]) };

  if (!lieu?.trim()) {
    const dry = COVERED.map((c) => doNotDrink(all, c) && c).filter(Boolean) as string[];
    return text({
      resume: (dry.length ? `Eau à ne pas boire en ce moment : ${dry.join(", ")}. ` : "") +
        (live.length ? `${live.length} avis des distributeurs d'eau récents ou à venir.` : "Aucun avis de coupure récent ou à venir."),
      ne_pas_boire: dry.length ? dry : undefined,
      avis: live.map((n) => noticeRow(n, now, n.communes.some((c) => doNotDrink(all, c) === n))),
      ...common,
    });
  }

  const res = resolvePlace(lieu);
  if (!res) return notFound(lieu);
  const commune = res.lieu.commune;
  const mine = live.filter((n) => n.communes.includes(commune));
  const dry = doNotDrink(all, commune);
  // Its distributor's notices are read (src/eau/distributeurs.ts), or some notice names it.
  const covered = COVERED.includes(commune) || !!distributeur(commune)?.avis || all.some((n) => n.communes.includes(commune));
  const resume = [
    dry ? `EAU À NE PAS BOIRE ${a(commune)} (secteurs dans l'avis), d'après l'avis du ${published(dry)} : « ${dry.titre} ».` : "",
    mine.length
      ? `${mine.length} avis récent${mine.length > 1 ? "s" : ""} ou à venir ${a(commune)} : ${mine.slice(0, 3).map((n) => n.titre).join(" ; ")}.`
      : covered ? `Aucun avis de coupure récent ou à venir ${a(commune)}.` : `Pas d'avis en ligne lisible pour ${commune} : voir la mairie ou le distributeur d'eau.`,
  ].filter(Boolean).join(" ");
  return text({
    lieu: placeBlock(lieu, res),
    resume,
    ne_pas_boire: dry ? noticeRow(dry, now) : undefined,
    avis: mine.map((n) => noticeRow(n, now, n === dry)),
    ...common,
  });
}
