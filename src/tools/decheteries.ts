/**
 * The déchèteries of the West (vie/decheteries.ts), answered by annuaire_services_publics when the question is about
 * waste: the nearest sites and what their skips take now, or which take the kind of waste asked. A site whose staff
 * have not updated it for hours is said to be « à vérifier », never as it was. Outside the TCO, where to look.
 */
import type { Cache } from "../cache.js";
import { resolvePlace } from "../places/resolve.js";
import * as tco from "../providers/tco.js";
import { why } from "../types.js";
import * as dech from "../vie/decheteries.js";
import { a, credits, fr, notFound, placeBlock, text } from "./format.js";

/** Whether `quoi` asks about a déchèterie or getting rid of waste. */
export const WASTE = /d[ée]ch[eèé]t|encombrant|gravat|\bbenne|centre de propret/i;

const ONLY_TCO = "Seul le TCO (Ouest) publie ces données. Pour les autres communes, voir la CINOR, la CIREST, la CIVIS ou la CASUD.";
const km = (n: number) => `${fr(Math.round(n * 10) / 10)} km`;

export async function decheteriesAnswer(cache: Cache, quoi: string, lieu: string | undefined, now = new Date()) {
  const res = lieu?.trim() ? resolvePlace(lieu) : null;
  if (lieu?.trim() && !res) return notFound(lieu);
  const commune = res?.lieu.commune;
  if (commune && !dech.TCO_COMMUNES.includes(commune)) {
    const epci = dech.epciOf(commune);
    return text({
      lieu: placeBlock(lieu!, res!),
      resume: `${ONLY_TCO}${epci ? ` ${commune} est dans ${epci.nom} : ${epci.site}` : ""}`,
      autres_intercommunalites: dech.OTHERS,
      sources: credits([tco.SOURCE]),
    });
  }
  const live = await tco.meteo(cache).catch((err) => (console.error(`source ${tco.SOURCE.id} indisponible:`, why(err)), null));
  const sites = dech.sitesNow(live?.value, now);
  const kind = dech.wasteAsked(quoi);
  const label = kind ? tco.WASTES[kind] : undefined;
  const near = res ? dech.nearest(res.lieu.lon, res.lieu.lat, sites, kind ? 5 : 3) : sites.map((s) => ({ ...s, km: undefined }));
  const at = (s: dech.SiteNow) => (s.mis_a_jour ? s.mis_a_jour.split(" ")[1] : "?");
  const where = (s: dech.SiteNow & { km?: number }) => `${s.nom}${s.km != null ? ` (à ${km(s.km)})` : ` (${s.commune})`}`;
  let resume: string;
  if (!live) resume = `L'état des bennes du TCO n'est pas disponible pour le moment. Déchèteries ${res ? `les plus proches ${a(res.lieu.nom)}` : "du TCO"} : ${near.map(where).join("\u00a0; ")}.`;
  else if (label) {
    const yes = near.filter((s) => s.a_jour && s.accepte.includes(label));
    const full = near.filter((s) => s.a_jour && s.refuse.includes(label));
    const old = near.filter((s) => !s.a_jour);
    resume = [
      yes.length ? `${label.charAt(0).toUpperCase()}${label.slice(1)} acceptés en ce moment : ${yes.map((s) => `${where(s)}, mis à jour à ${at(s)}`).join("\u00a0; ")}.` : `Aucune déchèterie proche ne dit accepter les ${label} en ce moment.`,
      full.length ? `Benne pleine : ${full.map(where).join("\u00a0; ")}.` : "",
      old.length ? `À vérifier sur place (mise à jour il y a plus de 6 h) : ${old.map(where).join("\u00a0; ")}.` : "",
    ].filter(Boolean).join(" ");
  } else {
    resume = near.slice(0, 3).map((s) => s.a_jour
      ? `${where(s)} : ${s.refuse.length ? `bennes pleines pour ${s.refuse.join(", ")}` : "toutes les bennes acceptent"}, mis à jour à ${at(s)}`
      : `${where(s)} : dernière mise à jour à ${at(s)}, à vérifier`).join("\u00a0; ") + ".";
  }
  return text({
    ...(res ? { lieu: placeBlock(lieu!, res) } : {}),
    resume,
    page: "https://rundata.re/decheteries",
    decheteries: near.map((s) => ({
      nom: s.nom,
      commune: s.commune,
      adresse: s.adresse || undefined,
      distance_km: s.km != null ? Math.round(s.km * 10) / 10 : undefined,
      mis_a_jour: s.mis_a_jour,
      etat: s.a_jour ? "à jour" : s.mis_a_jour ? `dernière mise à jour à ${s.mis_a_jour}, à vérifier sur place` : "pas de mise à jour",
      accepte: s.a_jour ? s.accepte : undefined,
      benne_pleine: s.a_jour ? s.refuse : undefined,
      page: s.lien,
    })),
    avertissements: [
      "État des bennes rempli par les agents sur place, environ toutes les 2 heures : une mise à jour de plus de 6 h est à vérifier sur place.",
      "Horaires non publiés : le TCO dit ses déchèteries ouvertes 7 jours sur 7\u00a0; voir la page de chaque déchèterie.",
      ...(live?.stale ? ["Copie de secours : le TCO n'a pas répondu."] : []),
      ONLY_TCO,
    ],
    sources: credits([tco.SOURCE]),
  });
}
