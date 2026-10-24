/**
 * The day a street's bins are collected in the West (vie/collecte.ts), answered by annuaire_services_publics when the
 * question is about the collection rather than a déchèterie. The street comes from `lieu` (« 12 rue des Lilas,
 * Saint-Paul »): its words besides the commune and the number. Never a day the calendar does not give.
 */
import { normalize } from "../places/resolve.js";
import * as col from "../vie/collecte.js";
import { credits, text } from "./format.js";
const { communeSlug, honesty, NOT_FOUND } = col;

/** Whether `quoi` asks when the bins are collected. */
export const COLLECTION = /collecte|poubelle|ordures?\b|ramassage|\bbacs?\b|\btri\b|camion/i;

const page = (commune?: string) => `https://rundata.re/collecte${commune ? `/${communeSlug(commune)}` : ""}`;
// The line marketing gives for a commune, without a street.
const communeLine = (commune: string) => `Collecte des déchets : le jour de votre rue sur rundata.re/collecte/${communeSlug(commune)}.`;

/** The commune of the West `lieu` names, and the street it gives besides (number and commune left out). */
export function parseLieu(lieu: string): { commune?: string; rue: string } {
  const flat = normalize(lieu);
  const commune = col.COMMUNES.find((c) => flat.includes(normalize(c)) || flat.includes(normalize(c.replace(/^Les /, ""))));
  let rue = flat;
  if (commune) rue = rue.replace(normalize(commune), " ").replace(normalize(commune.replace(/^Les /, "")), " ");
  rue = rue.replace(/\b974\d\d\b/g, " ").replace(/^\s*\d+\s*(bis|ter)?\b/, " ").replace(/\s+/g, " ").trim();
  return { commune, rue };
}

export function collecteAnswer(lieu: string | undefined, now = new Date()) {
  const today = col.todayOf(now);
  const { commune, rue } = parseLieu(lieu ?? "");
  const base = { a_savoir: honesty(), sources: credits([col.SOURCE]) };
  if (rue.length < 3) {
    return text({
      resume: commune ? communeLine(commune) : `Le jour de collecte se donne rue par rue : précisez la rue et la commune (Saint-Paul, La Possession, Saint-Leu, Le Port ou Trois-Bassins). ${honesty()}`,
      page: page(commune),
      ...base,
    });
  }
  if (col.pastYear(today)) return text({ resume: col.notYet(), page: page(commune), ...base });
  const found = col.findStreets(rue, commune).slice(0, 5);
  if (!found.length) return text({ resume: NOT_FOUND, page: page(commune), ...base });
  const rows = found.map((s) => {
    const cal = col.CALENDARS[s.calendrier];
    return {
      rue: col.streetName(s),
      commune: s.commune,
      texte: col.streetLine(s, today),
      jours_feries: cal ? col.holidays(cal, today).map(col.holidayLine) : [],
      calendrier_pdf: cal?.pdf,
      contact: cal ? undefined : col.TCO_CONTACT,
    };
  });
  return text({
    resume: [rows[0].texte, ...rows[0].jours_feries].join(" ") + (rows.length > 1 ? ` Autres rues au nom proche : ${rows.slice(1).map((r) => `${r.rue} (${r.commune})`).join(", ")}.` : ""),
    rues: rows,
    page: page(rows[0].commune),
    ...base,
  });
}
