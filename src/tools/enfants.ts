/**
 * The places to go with children (vie/enfants.ts), answered by annuaire_services_publics when the question is about
 * them: those of the place's commune by kind, else the nearest; a kind asked (« piscine », « aire de jeux ») alone.
 * Each place's ages: the map's when it gives them, else an indication by kind, said as rundata.re's. The activities of
 * the coming days are the agenda's (evenements, quoi = « enfants »).
 */
import { resolvePlace } from "../places/resolve.js";
import * as enfants from "../vie/enfants.js";
import { slugify } from "../web/places.js";
import { a, credits, fr, notFound, placeBlock, text } from "./format.js";

/** Whether `quoi` asks where to go with children, or for one of the kinds of place the page lists. */
export const CHILDREN = /enfant|marmaille|\bkids?\b|b[ée]b[ée]|aires? de jeux|jeux pour|ludoth[èe]que|m[ée]diath[èe]que|biblioth[èe]que|piscine|skate|city.?stade|pumptrack|escalade|\bzoo|aquarium|parcs? (?:aquatique|de loisirs|d'attraction|animalier)|trampoline|laser.?game|mus[ée]e/i;

/** The kind `quoi` names, when it names one. */
const KINDS: [RegExp, enfants.Kind][] = [
  [/aires? de jeux|jeux pour/i, "aire_de_jeux"], [/piscine/i, "piscine"], [/m[ée]diath[èe]que|biblioth[èe]que/i, "mediatheque"],
  [/ludoth[èe]que/i, "ludotheque"], [/skate|city.?stade|pumptrack/i, "sport"], [/escalade/i, "escalade"],
  [/\bzoo|aquarium|animalier/i, "animaux"], [/parcs? (?:aquatique|de loisirs|d'attraction)/i, "loisirs"],
  [/trampoline|laser.?game/i, "salle_jeux"], [/mus[ée]e/i, "musee"],
];
export const kindAsked = (quoi: string) => KINDS.find(([re]) => re.test(quoi))?.[1];

const NOT_ALL =
  "Liste d'après OpenStreetMap, Data ES et Basilic : tous les lieux n'y sont pas. Les accueils de loisirs (centres aérés), les crèches et les relais petite enfance sont publiés par la CAF sur monenfant.fr, dont les données ne peuvent pas être reprises : y renvoyer pour un mode de garde. Un lieu oublié : donner_avis, ou l'ajouter sur OpenStreetMap.";
const AGES =
  "age : celui de la carte quand elle le donne (age_d_apres_la_source = true)\u00a0; sinon une indication de rundata.re selon le type de lieu, à dire comme telle, jamais comme une règle du lieu. Aucun lieu n'est dit ouvert sans horaires de la source.";
const ACTIVITIES = "Activités et spectacles pour les enfants des deux semaines qui viennent : outil evenements, quoi = « enfants ».";

const row = (now: Date) => (l: enfants.Lieu & { km?: number }) => {
  const age = enfants.ageOf(l);
  const today = enfants.hoursToday(l, now);
  return {
    nom: enfants.nameOf(l),
    type: enfants.typeOf(l.type).nom,
    commune: l.commune,
    age: age.texte,
    age_d_apres_la_source: age.fait,
    detail: l.detail,
    adresse: l.adresse,
    horaires_aujourd_hui: today,
    distance_km: l.km != null ? Math.round(l.km * 10) / 10 : undefined,
    lien: l.site ?? l.lien,
  };
};

export function enfantsAnswer(quoi: string, lieu: string | undefined, now = new Date()) {
  const res = lieu?.trim() ? resolvePlace(lieu) : null;
  if (lieu?.trim() && !res) return notFound(lieu);
  const kind = kindAsked(quoi);
  const pool = kind ? enfants.LIEUX.filter((l) => l.type === kind) : enfants.LIEUX;
  const what = kind ? enfants.typeOf(kind).court : "lieux pour les enfants";
  const warnings = [NOT_ALL, AGES, ACTIVITIES];
  if (!res) {
    const communes = [...new Set(pool.map((l) => l.commune))].sort((x, y) => x.localeCompare(y, "fr"));
    return text({
      resume: `${what[0].toUpperCase()}${what.slice(1)} dans les sources : ${pool.length}, dans ${communes.length} communes${kind ? "" : ` (${enfants.TYPES.map((t) => enfants.counted(t.type, pool.filter((l) => l.type === t.type).length)).join(", ")})`}. Donner une commune pour sa liste.`,
      par_commune: Object.fromEntries(communes.map((c) => [c, pool.filter((l) => l.commune === c).length])),
      page: "https://rundata.re/enfants",
      avertissements: warnings,
      sources: credits(enfants.sourcesOf(pool)),
    });
  }
  const commune = res.lieu.commune;
  const here = pool.filter((l) => l.commune === commune);
  const near = here.length ? here : enfants.nearest(res.lieu.lon, res.lieu.lat, pool, 5);
  const rows = (here.length ? here.map((l) => ({ ...l, km: undefined })) : near).map(row(now));
  const byKind = enfants.TYPES.map((t) => [t.type, here.filter((l) => l.type === t.type).length] as const).filter(([, n]) => n);
  return text({
    lieu: placeBlock(lieu!, res),
    resume: here.length
      ? `${here.length} ${what} ${a(commune)} d'après les cartes ouvertes${kind ? "" : ` : ${byKind.map(([k, n]) => enfants.counted(k, n)).join(", ")}`}.`
      : `Aucun lieu de ce type ${a(commune)} dans les sources. Les plus proches : ${near.slice(0, 3).map((l) => `${enfants.nameOf(l)}, ${a(l.commune)}, à ${fr(Math.round(((l as { km?: number }).km ?? 0) * 10) / 10)} km`).join("\u00a0; ")}.`,
    lieux: rows,
    page: `https://rundata.re/enfants#c-${slugify(commune)}`,
    avertissements: warnings,
    sources: credits(enfants.sourcesOf(rows.length ? (here.length ? here : near) : pool)),
  });
}
