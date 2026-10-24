/**
 * The month's maximum fuel prices (providers/carburants.ts), answered by annuaire_services_publics when the question
 * is about fuel: the same in every station of the island, set by the prefect each month. An order read before its 1st
 * is announced, beside the month in force: nothing is said in force before the 1st at 0 h, Réunion time.
 */
import type { Cache } from "../cache.js";
import * as carburants from "../providers/carburants.js";
import { why } from "../types.js";
import { credits, text } from "./format.js";

/** Whether `quoi` asks about fuel, the pump or the gas bottle. */
export const FUEL = /carbur|essence|gazole|gasoil|diesel|sans[- ]?plomb|\bsp ?9[58]\b|super\b|\bgnr\b|p[ée]trole|bouteille de gaz|\bgaz\b|pompe|station[- ]service/i;

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
const diff = (p: carburants.Produit) =>
  p.precedent_eur == null ? undefined : p.prix_eur === p.precedent_eur ? "stable" : `${p.prix_eur > p.precedent_eur ? "+" : "−"}${eur(Math.abs(p.prix_eur - p.precedent_eur))}`;
/** « 1er octobre 2026 ». */
export const firstOf = (day: string) => `${Number(day.slice(8, 10)) === 1 ? "1er" : Number(day.slice(8, 10))} ${carburants.monthOf(day)}`;
/** « 1er novembre », « 31 octobre »: within the weeks around the 1st, the year goes without saying. */
const dayOf = (day: string) => firstOf(day).replace(/ \d{4}$/, "");
/** The day before a 1st: the last day of the month in force. */
export const eve = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** « de novembre », « d'octobre ». */
const of = (month: string) => (/^[aeiouyéè]/i.test(month) ? `d'${month}` : `de ${month}`);

/** « 2,00 €/litre », « 20,81 € la bouteille de 12,5 kg ». */
const priced = (p: carburants.Produit) => {
  const per = p.unite.replace(/^€\//, "");
  return `${eur(p.prix_eur)}${per === "litre" ? "/litre" : per ? ` la ${per}` : ""}`;
};

/** One line of a product: « sans plomb 2,00 €/litre (+0,17 €) ». */
export function priceLine(p: carburants.Produit): string {
  const d = diff(p);
  const name = carburants.label(p.produit);
  return `${name.charAt(0).toLowerCase()}${name.slice(1)} ${priced(p)}${d ? ` (${d})` : ""}${p.note ? `, ${p.note}` : ""}`;
}

const MONTH = "janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre";
/** The words not cut at the end of a line on a phone: « 1,54 € », « 12,5 kg », « 1er novembre », « 31 octobre ». */
export const keep = (s: string) =>
  s.replace(/(\d) (€|kg)/g, "$1\u00a0$2").replace(new RegExp(`(\\d|1er) (${MONTH})`, "g"), "$1\u00a0$2");

const MAIN = /^(supercarburant|gazole|gaz)$/i;
const mainLines = (m: carburants.Mois) => m.produits.filter((x) => MAIN.test(x.produit)).map(priceLine).join(" ; ");

/**
 * What is said of an order on `now`'s day, marketing's words. Before its 1st: « Prix maximum au 1er novembre, fixés
 * par la préfecture (communiqué du 31 octobre) : … » then « En vigueur jusqu'au 31 octobre : … ». From the 1st: the
 * month in force, and when the order is an older month's, that the new one is not published or not read yet.
 */
export function fuelSay(p: carburants.Prix, now: Date) {
  const { vigueur, avenir } = carburants.phases(p, now);
  const month = carburants.localDay(now).slice(0, 7);
  // The release's day, only when it came before the 1st it announces and is not ahead of today.
  const publie = avenir && p.publie && p.publie < avenir.depuis && p.publie <= carburants.localDay(now) ? p.publie : undefined;
  return {
    vigueur,
    avenir,
    annonce: avenir && `Prix maximum au ${dayOf(avenir.depuis)}, fixés par la préfecture${publie ? ` (communiqué du ${dayOf(publie)})` : ""} : ${mainLines(avenir)}`,
    jusquau: avenir && vigueur && `En vigueur jusqu'au ${dayOf(eve(avenir.depuis))} : ${mainLines(vigueur)}`,
    depuis: !avenir && vigueur ? `Prix maximum depuis le ${firstOf(vigueur.depuis)}` : undefined,
    lignes: vigueur && mainLines(vigueur),
    attente: !avenir && p.depuis.slice(0, 7) < month
      ? `Les prix maximum de ${carburants.monthOf(`${month}-01`)} ne sont pas encore publiés ou pas encore lus : voici ceux en vigueur depuis le ${firstOf(p.depuis)}.`
      : undefined,
  };
}

export async function carburantsAnswer(cache: Cache, now = new Date()) {
  let got;
  try {
    got = await carburants.prix(cache, now);
  } catch (err) {
    console.error(`source ${carburants.SOURCE.id} indisponible:`, why(err));
    return { ...text({ erreur: "Les prix des carburants ne sont pas disponibles pour le moment.", consulter: carburants.SOURCE.url, sources: credits([carburants.SOURCE]) }), isError: true };
  }
  const p = got.value;
  const local = carburants.localDay(now);
  const s = fuelSay(p, now);
  // Today's prices first, then the 1st's; before the 1st, the new order's are never said in force.
  const today = s.vigueur && (s.avenir
    ? `Prix maximum en vigueur aujourd'hui à La Réunion, jusqu'au ${dayOf(eve(s.avenir.depuis))} (arrêté du préfet) : ${s.lignes}.`
    : `Prix maximum à La Réunion depuis le ${firstOf(s.vigueur.depuis)} (arrêté du préfet) : ${s.lignes}.`);
  const resume = [today, s.annonce && `${s.annonce}.`, "Les mêmes plafonds dans toute l'île : une station peut vendre moins cher, pas plus."]
    .filter(Boolean).join(" ")
    // Once, the order's own word: an assistant links it to the user's.
    .replace("sans plomb ", "sans plomb (« supercarburant » dans l'arrêté) ");
  const rows = (m: carburants.Mois) =>
    m.produits.map((x) => ({ produit: carburants.label(x.produit), prix: priced(x), mois_precedent: x.precedent_eur != null ? eur(x.precedent_eur) : undefined, evolution: diff(x), note: x.note }));
  return text({
    resume,
    en_vigueur_depuis: s.vigueur && firstOf(s.vigueur.depuis),
    prix_maximums: s.vigueur && rows(s.vigueur),
    a_venir: s.avenir && { applicables_le: firstOf(s.avenir.depuis), prix_maximums: rows(s.avenir) },
    communique: { titre: p.titre, lien: p.lien },
    avertissements: [
      ...(p.depuis.slice(0, 7) < local.slice(0, 7) ? [`Les prix maximum ${of(carburants.monthOf(local))} ne sont pas encore lus : ce sont ceux ${of(carburants.monthOf(p.depuis))}, qui ont pu changer le 1er du mois.`] : []),
      ...(got.stale ? ["Copie de secours : la source n'a pas répondu."] : []),
    ],
    a_savoir: "Le préfet fixe chaque mois les prix maximums des carburants et de la bouteille de gaz, applicables le 1er du mois. Il n'y a pas de prix par station à La Réunion : les départements d'outre-mer ne sont pas dans le relevé national des prix par station.",
    sources: credits([carburants.SOURCE]),
  });
}
