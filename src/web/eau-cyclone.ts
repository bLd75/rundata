/**
 * « Après un cyclone : l'eau du robinet », on /coupures-eau and each commune's: the prefecture's plan quoted (dispositif
 * spécifique ORSEC Cyclones, arrêté 2026-182, p. 18), and whose notices are read, commune by commune, from the ARS's
 * table of distributors (src/eau/distributeurs.ts). Never « potable », « rétabli » nor « aucun avis » where the
 * notices are not read. Up the page in the cyclone season, at its foot the rest of the year. Nothing more is fetched.
 * Worded by marketing.
 */
import { BUILT, CIREST, distributeur, plusieurs } from "../eau/distributeurs.js";
import { a } from "../tools/format.js";
import { PDF } from "./alerte-cyclone.js";
import { esc } from "./map.js";
import { PAGES } from "./places.js";

/** The plan's words, copied from the PDF (consignes of the phase de sauvegarde). */
export const CONSIGNE = "Vérifier la qualité de l'eau du robinet avant de la consommer ainsi que les aliments du réfrigérateur. Ne pas oublier que l'eau du robinet peut rester impropre à la consommation plusieurs jours après l'arrêt des pluies. En conséquence, il est impératif de la faire bouillir pendant 3 minutes avant de la boire.";
export const CONSIGNE_PAGE = 18;
const EAUDUROBINET = "https://www.eaudurobinet.re/";
const COMMUNES = PAGES.filter((p) => p.commune).map((p) => p.nom);

/** November to April, as the cyclones tool says the season (src/tools/cyclones.ts), local time. */
export function inSeason(now: Date): boolean {
  const m = new Date(now.getTime() + 4 * 3600_000).getUTCMonth() + 1;
  return m >= 11 || m <= 4;
}

/** Whose notices are read for a commune, in a sentence. */
export function coverageLine(commune: string): string {
  const d = distributeur(commune);
  const where = a(commune);
  if (!d) {
    const several = plusieurs(commune);
    return `Distributeur non identifié ${where}${several ? ` : le contrôle sanitaire de l'ARS en cite plusieurs (${several.slice(0, -1).join(", ")} et ${several.at(-1)})` : ""}. Renseignez-vous auprès de la mairie.`;
  }
  if (!d.avis) return `Nous ne lisons pas les avis de ${d.nom}, qui distribue l'eau ${where} : renseignez-vous auprès de ${d.nom} ou de la mairie.`;
  // The shared copy of the notices is rebuilt every 30 minutes at least (web/partagees.ts), more often when read.
  const by = d.site === CIREST.site ? "la CIREST" : d.nom;
  return `Nous lisons les avis publiés par ${by} pour ${commune}, au moins toutes les 30 minutes : ils s'affichent en haut de cette page.`;
}

const quote = () =>
  `<div class="card"><p>« ${esc(CONSIGNE)} »</p><p class="note">Dispositif ORSEC Cyclones de la préfecture (arrêté 2026-182), consignes de la phase de sauvegarde <span>(<a href="${PDF}#page=${CONSIGNE_PAGE}" rel="noopener">p. ${CONSIGNE_PAGE}</a>)</span></p></div>`;
const foot = `<p class="note">Distributeurs d'après le contrôle sanitaire de l'ARS (Hub'Eau), prélèvements des six derniers mois, table du ${esc(BUILT.split("-").reverse().join("/"))}. <a href="${EAUDUROBINET}" rel="noopener">La qualité de l'eau de votre réseau, sur le site de l'ARS : eaudurobinet.re →</a></p>`;

/** The section, for one commune or for the island; `now` says whether it leads (the season) or closes the page. */
export function cycloneWater(now: Date, commune?: string): { html: string; lead: boolean } {
  const lead = inSeason(now);
  let lines: string;
  if (commune) lines = `<p>${esc(coverageLine(commune))}</p>`;
  else {
    const read = COMMUNES.filter((c) => distributeur(c)?.avis);
    const unread = COMMUNES.filter((c) => distributeur(c) && !distributeur(c)!.avis);
    const unknown = COMMUNES.filter((c) => !distributeur(c));
    lines = `<ul class="plain">
  <li><b>Avis lus</b> : ${read.map(link).join(", ")}.</li>
  <li><b>Nous ne lisons pas les avis de</b> : ${[...new Set(unread.map((c) => distributeur(c)!.nom))].map((nom) => `${esc(nom)} (${unread.filter((c) => distributeur(c)!.nom === nom).map(link).join(", ")})`).join(", ")}.</li>
  ${unknown.length ? `<li><b>Distributeur non identifié</b> : ${unknown.map(link).join(", ")}.</li>` : ""}
</ul>`;
  }
  const html = `<section aria-labelledby="h-cyclone-eau">
  <div class="sec-h"><p class="eyebrow">Plan ORSEC Cyclones</p><h2 id="h-cyclone-eau">Après un cyclone : l'eau du robinet</h2></div>
  ${quote()}
  ${lines}
  ${foot}
</section>`;
  return { html, lead };
}

const link = (commune: string) => `<a href="/coupures-eau/${PAGES.find((p) => p.commune && p.nom === commune)!.slug}">${esc(commune)}</a>`;
