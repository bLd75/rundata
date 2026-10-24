/**
 * The month's maximum fuel prices (/carburants), set by the prefect's order: the same in every station of the island.
 * Read from the stored copy of the order (providers/carburants.ts): nothing else is fetched.
 */
import type { Cached } from "../cache.js";
import * as carburants from "../providers/carburants.js";
import { firstOf, priceLine } from "../tools/carburants.js";
import { connectorCta, crumbBar, crumbs, loading, webPage } from "./domains.js";
import type { Alerte } from "./data.js";
import { esc } from "./map.js";
import { credits, DESCRIPTION_MAX, icon, layout } from "./pages.js";

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
const signed = (p: carburants.Produit) =>
  p.precedent_eur == null ? "" : p.prix_eur === p.precedent_eur ? "stable" : `${p.prix_eur > p.precedent_eur ? "+" : "−"}${eur(Math.abs(p.prix_eur - p.precedent_eur))}`;
const find = (p: carburants.Prix, re: RegExp) => p.produits.find((x) => re.test(x.produit));

// The texts of the page, worded by marketing.
export const TITLE = "Prix carburants Réunion : essence, gazole, gaz · 974";

/** « Prix maximum en octobre 2026 à La Réunion (974) : sans plomb 2,00 €/L (+0,17 €), gazole 1,80 €/L (+0,12 €), bouteille de gaz 20,81 €. … » */
export function descriptionOf(p: carburants.Prix | undefined): string {
  if (!p) return "Prix maximum des carburants à La Réunion (974), fixés chaque mois par le préfet : sans plomb, gazole, bouteille de gaz. Partout sur l'île.";
  const sp = find(p, /^supercarburant$/i);
  const go = find(p, /^gazole$/i);
  const gaz = find(p, /^gaz$/i);
  const litre = (x?: carburants.Produit) => (x ? `${eur(x.prix_eur)}/L${signed(x) ? ` (${signed(x)})` : ""}` : "");
  const head = `Prix maximum en ${carburants.monthOf(p.depuis)} à La Réunion (974) : ${[sp && `sans plomb ${litre(sp)}`, go && `gazole ${litre(go)}`, gaz && `bouteille de gaz ${eur(gaz.prix_eur)}`].filter(Boolean).join(", ")}.`;
  // What search engines show: the end goes first when it does not fit.
  return [`${head} Fixés par le préfet, partout sur l'île.`, `${head} Fixés par le préfet.`].find((x) => x.length <= DESCRIPTION_MAX) ?? head;
}

export function carburantsPage(origin: string, data: Cached<carburants.Prix> | null, now = new Date(), alerte?: Alerte): string {
  const p = data?.value;
  // Early in a month, before the new order is published or read: the order in force, said as such.
  const month = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 7);
  const pending = p && p.depuis.slice(0, 7) < month ? `<p class="note">Les prix de ${esc(carburants.monthOf(`${month}-01`))} ne sont pas encore publiés ou pas encore lus : voici ceux en vigueur depuis le ${esc(firstOf(p.depuis))}.</p>` : "";
  const path = "/carburants";
  const description = descriptionOf(p);
  const h1 = p ? `Prix des carburants à La Réunion, ${carburants.monthOf(p.depuis)}` : "Prix des carburants à La Réunion";
  const main = p?.produits.filter((x) => /^(supercarburant|gazole|gaz)$/i.test(x.produit)) ?? [];

  const band = `${crumbBar("Prix des carburants")}
<div class="wrap intro"><div class="pitch">
  <p class="pill"><span class="dot"></span>Arrêté du préfet</p>
  <h1>${esc(h1)}</h1>
  ${p ? `<p class="lead">Prix maximums depuis le ${esc(firstOf(p.depuis))} : ${main.map((x) => esc(priceLine(x))).join(" ; ")}.</p>${pending}` : loading("Les prix du mois")}
</div></div>`;

  const table = p
    ? `<section aria-labelledby="h-prix"><div class="sec-h"><h2 id="h-prix">Tous les prix maximums du mois</h2></div>
  <div class="card table-wrap"><table class="drought"><thead><tr><th scope="col">Produit</th><th scope="col">${esc(firstOf(p.depuis))}</th>${p.precedent_depuis ? `<th scope="col">${esc(firstOf(p.precedent_depuis))}</th>` : ""}<th scope="col">Écart</th></tr></thead><tbody>
  ${p.produits.map((x) => `<tr><th scope="row">${esc(x.produit)}${x.unite ? ` <span class="note">(${esc(x.unite)})</span>` : ""}${x.note ? `<br><span class="note">${esc(x.note)}</span>` : ""}</th><td><b>${esc(eur(x.prix_eur))}</b></td>${p.precedent_depuis ? `<td>${x.precedent_eur != null ? esc(eur(x.precedent_eur)) : ""}</td>` : ""}<td>${esc(signed(x))}</td></tr>`).join("\n  ")}
  </tbody></table></div>
  <p class="note">D'après <a href="${esc(p.lien)}" rel="noopener">le communiqué de la préfecture</a> : « ${esc(p.titre)} ».</p></section>`
    : "";

  const why = `<section aria-labelledby="h-savoir"><div class="card">${icon("car")}<h3 id="h-savoir">Des prix maximums, les mêmes partout</h3>
  <p>À La Réunion, le préfet fixe chaque mois les prix maximums des carburants et de la bouteille de gaz, d'après les cours internationaux, le taux de change et le fret. Ils s'appliquent le 1er du mois dans toutes les stations de l'île ; une station peut vendre moins cher, pas plus.</p>
  <p>Il n'y a pas de relevé des prix par station : les départements d'outre-mer ne sont pas dans le relevé national. <a href="/trafic">La circulation et l'état des routes →</a></p></div></section>`;

  const body = `${table}
${why}
<section>${p && data ? `<p class="note">Source : ${credits([{ source: carburants.SOURCE.nom, licence: carburants.SOURCE.licence, attribution: carburants.SOURCE.attribution }])}.</p>` : ""}</section>
${connectorCta("annuaire_services_publics", "les prix des carburants")}`;
  return layout(origin, { title: TITLE, description, path, jsonld: [crumbs(origin, "Prix des carburants", path), webPage(origin, path, TITLE, description, data)], alerte }, band, body);
}
