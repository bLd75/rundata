/**
 * The month's maximum fuel prices (providers/carburants.ts), answered by annuaire_services_publics when the question
 * is about fuel: the same in every station of the island, set by the prefect each month.
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

/** « de novembre », « d'octobre ». */
const of = (month: string) => (/^[aeiouyéè]/i.test(month) ? `d'${month}` : `de ${month}`);

/** « 2,00 €/litre », « 20,81 € la bouteille de 12,5 kg ». */
const priced = (p: carburants.Produit) => {
  const per = p.unite.replace(/^€\//, "");
  return `${eur(p.prix_eur)}${per === "litre" ? "/litre" : per ? ` la ${per}` : ""}`;
};

/** One line of a product: « supercarburant 2,00 €/litre (+0,17 €) ». */
export function priceLine(p: carburants.Produit): string {
  const d = diff(p);
  return `${p.produit.charAt(0).toLowerCase()}${p.produit.slice(1)} ${priced(p)}${d ? ` (${d})` : ""}${p.note ? `, ${p.note}` : ""}`;
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
  const local = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
  const main = p.produits.filter((x) => /^(supercarburant|gazole|gaz)$/i.test(x.produit));
  return text({
    resume: `Prix maximums à La Réunion depuis le ${firstOf(p.depuis)} (arrêté du préfet) : ${main.map(priceLine).join(" ; ")}. ` +
      "Les mêmes plafonds dans toute l'île : une station peut vendre moins cher, pas plus.",
    en_vigueur_depuis: firstOf(p.depuis),
    prix_maximums: p.produits.map((x) => ({ produit: x.produit, prix: priced(x), mois_precedent: x.precedent_eur != null ? eur(x.precedent_eur) : undefined, evolution: diff(x), note: x.note })),
    communique: { titre: p.titre, lien: p.lien },
    avertissements: [
      ...(p.depuis.slice(0, 7) < local.slice(0, 7) ? [`Les prix ${of(carburants.monthOf(local))} ne sont pas encore lus : ce sont ceux ${of(carburants.monthOf(p.depuis))}, qui ont pu changer le 1er du mois.`] : []),
      ...(got.stale ? ["Copie de secours : la source n'a pas répondu."] : []),
    ],
    a_savoir: "Le préfet fixe chaque mois les prix maximums des carburants et de la bouteille de gaz, applicables le 1er du mois. Il n'y a pas de prix par station à La Réunion : les départements d'outre-mer ne sont pas dans le relevé national des prix par station.",
    sources: credits([carburants.SOURCE]),
  });
}
