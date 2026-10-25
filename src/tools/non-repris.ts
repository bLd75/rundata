import { type Autorisation, nonAutorisee, nonAutorisees } from "../providers/autorisations.js";
import { de, enumeration } from "./format.js";

/**
 * What is said instead of a source not read until it agrees (src/providers/autorisations.ts), in marketing's words
 * (projects/rundata/marketing/communes-mention-288.md): one commune's, then the whole island's in one block. The day it
 * was asked, or refused, only once known; nothing said of a request before it has gone.
 */

const dayMonth = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
// The notices of power cuts are still on the commune's site, where its people look: said, with no link.
const still = (au: Autorisation, many = false) => (au.publie === "avis de coupure d'électricité" ? ` ${many ? "Ils restent consultables sur leurs sites." : "Ils restent consultables sur son site."}` : "");

/** One commune's source of that kind (`agenda`, `courant`): undefined once it agreed, or for a source never asked. */
export function mention(famille: string, commune: string | undefined): string | undefined {
  const au = nonAutorisee(famille, commune);
  return au && phrase(au);
}

function phrase(au: Autorisation): string {
  const its = `les ${au.publie} qu'elle y publie`;
  if (au.etat === "refusee") return `La commune ${de(au.commune)} a refusé${au.refusee_le ? `, le ${dayMonth(au.refusee_le)},` : ""} que rundata.re reprenne le contenu de son site : ${its} ne s'affichent donc pas ici.${still(au)}`;
  const first = `Les mentions légales du site de la commune ${de(au.commune)} interdisent d'en reprendre le contenu sans son accord : rundata.re n'affiche donc pas ${its}.${still(au)}`;
  return au.etat === "demandee" ? `${first} Nous lui avons demandé cet accord${au.demandee_le ? ` le ${dayMonth(au.demandee_le)}` : ""} et attendons sa réponse.` : first;
}

/**
 * The same for the whole island: one block for the communes still waiting (with the day they were asked when it is the
 * same for all), then a line for each one asked on another day, and for each one that refused.
 */
export function mentionIle(famille: string): string[] {
  const waiting = nonAutorisees(famille).filter((a) => a.etat !== "refusee");
  const refused = nonAutorisees(famille).filter((a) => a.etat === "refusee");
  const lines: string[] = [];
  if (waiting.length === 1) lines.push(phrase(waiting[0]));
  else if (waiting.length) {
    const kinds = (["événements", "actualités", "avis de coupure d'électricité"] as const).filter((k) => waiting.some((a) => a.publie.includes(k))).join(" et ");
    const days = new Set(waiting.map((a) => (a.etat === "demandee" ? a.demandee_le ?? "" : undefined)));
    const day = days.size === 1 ? [...days][0] : undefined;
    lines.push(`Les mentions légales des sites de ${waiting.length} communes interdisent d'en reprendre le contenu sans leur accord : ${enumeration(waiting.map((a) => a.commune))}. rundata.re n'affiche donc pas les ${kinds} qu'elles y publient.${still(waiting[0], true)}` +
      (day !== undefined ? ` Nous leur avons demandé cet accord${day ? ` le ${dayMonth(day)}` : ""} et attendons leur réponse.` : ""));
    if (day === undefined) lines.push(...waiting.filter((a) => a.etat === "demandee").map(phrase));
  }
  return [...lines, ...refused.map(phrase)];
}

export { dayMonth };
