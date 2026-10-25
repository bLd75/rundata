/**
 * The markets (vie/marches.ts), answered by annuaire_services_publics when the question is about a market: those of
 * the place's commune, else the nearest; their days when OpenStreetMap gives them. The list is not complete, and the
 * answer says so.
 */
import { resolvePlace } from "../places/resolve.js";
import * as marches from "../vie/marches.js";
import { credits, fr, notFound, placeBlock, text, a } from "./format.js";

/** Whether `quoi` asks about a market, not a supermarket. */
export const MARKET = /(?<!super|hyper)march[ée]s?(?!\p{L})|forain|halle(?!\p{L})/iu;

const NOT_ALL = "D'après OpenStreetMap, relevé par ses contributeurs : tous les marchés n'y sont pas, et les jours peuvent avoir changé. La mairie a le calendrier des marchés forains. " +
  "Vous connaissez un marché absent ? Signalez-le avec donner_avis, ou ajoutez-le vous-même sur OpenStreetMap.";

export function marchesAnswer(lieu: string | undefined) {
  const res = lieu?.trim() ? resolvePlace(lieu) : null;
  if (lieu?.trim() && !res) return notFound(lieu);
  const row = (m: ReturnType<typeof marches.MARCHES>[number] & { km?: number }) => ({
    nom: m.nom,
    commune: m.commune,
    quand: m.horaires ?? m.note ?? undefined,
    adresse: m.adresse ?? undefined,
    distance_km: m.km != null ? Math.round(m.km * 10) / 10 : undefined,
    carte: m.osm,
  });
  if (!res) {
    const all = marches.MARCHES();
    const communes = [...new Set(all.map((m) => m.commune))].sort((x, y) => x.localeCompare(y, "fr"));
    return text({
      resume: `${all.length} marchés cartographiés dans ${communes.length} communes, ${all.filter((m) => m.horaires).length} avec leurs jours. Donner une commune pour les siens.`,
      par_commune: Object.fromEntries(communes.map((c) => [c, all.filter((m) => m.commune === c).map(row)])),
      avertissements: [NOT_ALL],
      sources: credits([marches.OSM]),
    });
  }
  const commune = res.lieu.commune;
  const here = marches.inCommune(commune);
  const near = here.length ? here.map((m) => ({ ...m, km: undefined })) : marches.nearest(res.lieu.lon, res.lieu.lat, 3);
  const said = (m: marches.Marche) => `${m.nom}${m.horaires ? ` (${m.horaires})` : m.note ? ` (${m.note})` : ""}`;
  return text({
    lieu: placeBlock(lieu!, res),
    resume: here.length
      ? `Marchés ${a(commune)} d'après OpenStreetMap : ${here.map(said).join("\u00a0; ")}.`
      : `Aucun marché ${a(commune)} dans OpenStreetMap. Les plus proches : ${near.map((m) => `${said(m)}, ${a(m.commune)}, à ${fr(Math.round((m.km ?? 0) * 10) / 10)} km`).join("\u00a0; ")}.`,
    marches: near.map(row),
    avertissements: [NOT_ALL],
    sources: credits([marches.OSM]),
  });
}
