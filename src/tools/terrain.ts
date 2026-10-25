import type { Cache } from "../cache.js";
import { distanceKm } from "../geo.js";
import { INSEE } from "../places/insee.js";
import { resolvePlace } from "../places/resolve.js";
import * as terrain from "../providers/terrain.js";
import { why } from "../types.js";
import { credits, fr, text } from "./format.js";

// What a PLU zone letter means (code de l'urbanisme, articles R151-18 to R151-25).
const ZONE_TYPES: Record<string, string> = {
  U: "zone urbaine (U) : en principe constructible, selon le règlement de la zone",
  AUc: "zone à urbaniser (AU) ouverte : constructible dans le cadre d'un projet d'aménagement",
  AUs: "zone à urbaniser (AU) fermée : pas constructible avant une modification du PLU",
  AU: "zone à urbaniser (AU)",
  A: "zone agricole (A) : construction très limitée (bâtiments agricoles, extensions encadrées)",
  N: "zone naturelle et forestière (N) : construction très limitée",
};

const ADDRESS = /\d|\b(rue|chemin|allée|allee|impasse|avenue|av|boulevard|bd|route|ruelle|lotissement|résidence|residence|cité|cite|sentier|place)\b/i;

// Street kinds, as people and the address base write them, to one word each.
const KINDS: Record<string, string> = {
  rue: "rue", ruelle: "ruelle", allee: "allee", all: "allee", impasse: "impasse", imp: "impasse", chemin: "chemin", ch: "chemin", chem: "chemin",
  avenue: "avenue", av: "avenue", ave: "avenue", boulevard: "boulevard", bd: "boulevard", bld: "boulevard", route: "route", rte: "route",
  sentier: "sentier", place: "place", pl: "place", lotissement: "lotissement", lot: "lotissement", residence: "residence", res: "residence",
  cite: "cite", square: "square", quai: "quai", passage: "passage", traverse: "traverse", voie: "voie", ravine: "ravine", rampe: "rampe",
};
const SMALL = new Set(["de", "des", "du", "la", "le", "les", "l", "d", "et", "a", "au", "aux", "en", "bis", "ter", "reunion"]);
const words = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean)
    .map((w) => (w === "st" ? "saint" : w === "ste" ? "sainte" : w));
/** The words of the 24 communes' names, which a question adds after the street and the address base leaves out of it. */
const COMMUNE_WORDS = new Set(Object.keys(INSEE).flatMap(words));
// « ravine » names streets too (« Ravine des Cabris »): a kind only when it comes first.
const kindOf = (w: string[]) => w.map((x, i) => (x === "ravine" && i > 0 ? undefined : KINDS[x])).find(Boolean);
const distinct = (w: string[]) => w.filter((x) => !SMALL.has(x) && !/^\d+[a-z]?$/.test(x) && !(KINDS[x] && x !== "ravine"));

/** Edit distance, for one letter off (« Lecomte », « Leconte »). */
function oneOff(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1);
}
const within = (some: string[], all: string[]) => some.every((x) => all.some((y) => oneOff(x, y)));

/**
 * Whether the street the address base found is the one asked about, by their names: the words asked, without the
 * commune's, all in its name (« rue Juliette Dodu » for « Rue Juliette Dodu »), or all of its name's words in what was
 * asked (« Rue Beaudelaire Ravine des Cabris » for « 12 rue Beaudelaire Ravine des Cabris, Saint-Pierre »); one letter
 * off allowed in a long word; and the same kind of street when both say one (an allée is not an impasse).
 */
export function sameStreet(asked: string, found: string): boolean {
  const a = words(asked);
  const f = words(found);
  const ka = kindOf(a);
  const kf = kindOf(f);
  if (ka && kf && ka !== kf) return false;
  const fd = distinct(f);
  if (!fd.length) return false;
  const street = distinct(a).filter((x) => !COMMUNE_WORDS.has(x));
  return (street.length > 0 && within(street, fd)) || within(fd, distinct(a));
}

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const euros = (n: number) => `${fr(Math.round(n / 1000) * 1000).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} €`;

/**
 * Aggregates only: DVF's terms forbid re-identifying people, so no single sale, address or parcel is given out.
 * Houses and flats sold alone, with a built surface, for a median price and a median price per m².
 */
export function market(sales: terrain.Sale[]) {
  const pick = (code: string) => sales.filter((s) => s.code === code && s.lots === 1 && s.surface_bati >= 15);
  const sum = (list: terrain.Sale[]) =>
    list.length < 3
      ? { ventes: list.length, note: "trop peu de ventes pour une médiane" }
      : {
          ventes: list.length,
          prix_median: euros(median(list.map((s) => s.valeur))!),
          prix_m2_median: `${fr(Math.round(median(list.map((s) => s.valeur / s.surface_bati))! / 10) * 10)} €/m²`,
          surface_mediane_m2: Math.round(median(list.map((s) => s.surface_bati))!),
        };
  const land = sales.filter((s) => s.code.startsWith("2") && s.surface_terrain > 0 && s.surface_bati === 0);
  return {
    maisons: sum(pick("111")),
    appartements: sum(pick("121")),
    terrains_nus: land.length >= 3 ? { ventes: land.length, prix_m2_median: `${fr(Math.round(median(land.map((s) => s.valeur / s.surface_terrain))!))} €/m²` } : { ventes: land.length },
    toutes_ventes: sales.length,
  };
}

/** The value, or undefined when the source failed (null stays "nothing at this point"). */
async function settle<T>(source: string, p: Promise<{ value: T }>): Promise<T | undefined> {
  try {
    return (await p).value;
  } catch (err) {
    console.error(`source ${source} indisponible:`, why(err));
    return undefined;
  }
}

const DOWN = "service momentanément indisponible : réessayer dans un instant";

export async function ficheLieu(cache: Cache, adresse: string, now = new Date()) {
  // A street address goes to the national address base; a place name to the gazetteer first.
  let where: { label: string; lon: number; lat: number; precision: string; insee?: string } | null = null;
  const place = resolvePlace(adresse);
  if (place?.correspondance === "coordonnees") {
    where = { label: `point ${place.lieu.nom}`, lon: place.lieu.lon, lat: place.lieu.lat, precision: "coordonnées données" };
  } else if (place && place.correspondance === "exacte" && !ADDRESS.test(adresse)) {
    where = { label: `${place.lieu.nom} (${place.lieu.type}, ${place.lieu.commune})`, lon: place.lieu.lon, lat: place.lieu.lat, precision: "centre du lieu-dit ou de la commune", insee: INSEE[place.lieu.commune] };
  } else {
    const a = await settle(terrain.SOURCES.ban.id, terrain.geocode(cache, adresse));
    // Another street than the one asked: no figures of it, nor of the place around; the streets of the commune whose
    // names come close instead.
    const street = a && (a.type === "street" || a.type === "housenumber") && kindOf(words(adresse)) ? a.street ?? a.label.replace(/ \d{5} .*$/, "") : undefined;
    if (a && street && !sameStreet(adresse, street)) {
      const insee = (place && INSEE[place.lieu.commune]) || a.insee;
      const commune = Object.keys(INSEE).find((c) => INSEE[c] === insee);
      const near = ((await settle(terrain.SOURCES.ban.id, terrain.streets(cache, adresse.split(",")[0], insee))) ?? []).filter((x) => x !== street);
      const N = "\u00a0";
      const q = (x: string) => `«${N}${x}${N}»`;
      const at = commune ? ` à ${commune}` : "";
      const one = near.length === 1;
      return {
        ...text({
          erreur: `Voie introuvable dans la Base adresse nationale${N}: ${q(adresse)}. Sa réponse la plus approchante, ${q(street)}${commune ? ` (${commune})` : ""}, est une autre voie${N}: pas de cadastre, de prix, d'urbanisme ni de risques pour une voie autre que celle demandée.`,
          ...(near.length ? { voies_proches: near.map((x) => (commune ? `${x}, ${commune}` : x)) } : {}),
          // The base's order, the closest first.
          conseil: near.length
            ? `${one ? "Voie" : "Voies"} au nom proche${at}, d'après la Base adresse nationale${N}: ${near.join(", ")}. Demander à l'utilisateur ${one ? "si c'est la bonne" : "laquelle est la bonne"}, puis redemander avec ce nom et la commune${N}; ne pas ${one ? "la choisir" : "en choisir une"} à sa place.`
            : `Aucune voie au nom proche${at} dans la Base adresse nationale. Demander à l'utilisateur de vérifier le nom de la voie, puis redemander avec la commune, ou avec un lieu-dit.`,
          sources: credits([terrain.SOURCES.ban]),
        }),
        isError: true,
      };
    }
    if (a) where = { label: a.label, lon: a.lon, lat: a.lat, precision: a.type === "housenumber" ? "adresse exacte" : a.type === "street" ? "milieu de la rue" : "centre de la commune", insee: a.insee };
    else if (place) where = { label: `${place.lieu.nom} (${place.lieu.type}, ${place.lieu.commune})`, lon: place.lieu.lon, lat: place.lieu.lat, precision: "centre du lieu-dit", insee: INSEE[place.lieu.commune] };
  }
  if (!where) {
    return {
      ...text({ erreur: `Adresse ou lieu introuvable à La Réunion : « ${adresse} ».`, conseil: "Donner une adresse (numéro, rue, commune) ou un lieu-dit." }),
      isError: true,
    };
  }
  const { lon, lat } = where;
  const fromYear = new Date(now.getTime() + 4 * 3600_000).getUTCFullYear() - 5;
  const known = where.insee?.startsWith("974") ? where.insee : undefined;
  const parcelP = settle(terrain.SOURCES.cadastre.id, terrain.parcel(cache, lon, lat));
  // Given coordinates name no commune: the parcel's id starts with its INSEE code.
  const inseeP = known ? Promise.resolve(known) : parcelP.then((x) => (x?.idu.startsWith("974") ? x.idu.slice(0, 5) : undefined));
  const [p, z, alt, s, ppr, cat, mvt, insee] = await Promise.all([
    parcelP,
    settle(terrain.SOURCES.gpu.id, terrain.zone(cache, lon, lat)),
    settle(terrain.SOURCES.alti.id, terrain.altitude(cache, lon, lat)),
    settle(terrain.SOURCES.dvf.id, terrain.sales(cache, lon, lat, fromYear)),
    settle(terrain.SOURCES.ppr.id, terrain.plans(cache, lon, lat)),
    inseeP.then((c) => (c ? settle(terrain.SOURCES.georisques.id, terrain.catnat(cache, c)) : undefined)),
    settle(terrain.SOURCES.georisques.id, terrain.landslides(cache, lon, lat)),
    inseeP,
  ]);

  const parts = [`${where.label} (${where.precision})`];
  if (alt != null) parts.push(`altitude ${alt} m`);
  if (p) parts.push(`parcelle cadastrale ${p.section} ${p.numero} (${fr(p.contenance_m2)} m²)`);
  const zt = z ? ZONE_TYPES[z.typezone] ?? (z.typezone ? `zone ${z.typezone}` : undefined) : undefined;
  if (z) parts.push(`zone ${z.libelle} du PLU${zt ? `, ${zt}` : ""}`);
  const m = s ? market(s) : null;
  const risks = ppr ? riskLine(ppr) : undefined;
  if (risks) parts.push(risks);
  if (m && "prix_m2_median" in m.maisons) parts.push(`maisons vendues autour depuis ${fromYear} : ${m.maisons.prix_m2_median} en médiane (${m.maisons.ventes} ventes)`);
  if (m && "prix_m2_median" in m.appartements) parts.push(`appartements : ${m.appartements.prix_m2_median} (${m.appartements.ventes} ventes)`);

  const used = [
    terrain.SOURCES.ban,
    ...(p ? [terrain.SOURCES.cadastre] : []),
    ...(z ? [terrain.SOURCES.gpu] : []),
    ...(alt != null ? [terrain.SOURCES.alti] : []),
    ...(s ? [terrain.SOURCES.dvf] : []),
    ...(ppr ? [terrain.SOURCES.ppr] : []),
    ...(cat || mvt ? [terrain.SOURCES.georisques] : []),
  ];
  return text({
    resume: `${parts.join("\u00a0; ")}.`,
    lieu: { ...where, lon: Math.round(lon * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5 },
    altitude_m: alt ?? DOWN,
    cadastre: p === undefined ? DOWN : p ?? "aucune parcelle à ce point (domaine public, route, ou point imprécis)",
    urbanisme: z
      ? {
          zone: z.libelle,
          libelle: z.libelong || undefined,
          type: zt,
          document: z.document,
          approuve_le: z.date ? `${z.date.slice(6, 8)}/${z.date.slice(4, 6)}/${z.date.slice(0, 4)}` : undefined,
          voir_le_reglement: `https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=${lon}&lat=${lat}&zoom=18`,
        }
      : z === undefined ? DOWN : "pas de zonage publié à ce point sur le Géoportail de l'urbanisme",
    marche_immobilier: m
      ? { perimetre: "environ 600 m × 600 m autour du point", depuis: fromYear, ...m, note: "Médianes des ventes enregistrées (DVF), maisons et appartements vendus seuls. Aucune vente individuelle n'est donnée." }
      : DOWN,
    risques: risksBlock(lon, lat, insee, ppr, cat, mvt),
    avertissements: [
      "Le cadastre est un document fiscal : il ne prouve pas la propriété ni les limites exactes (bornage par un géomètre).",
      "La zone du PLU ne dit pas tout : son règlement, les servitudes et les plans de prévention des risques (PPR) s'ajoutent. Se renseigner auprès du service urbanisme de la mairie.",
      "Ces informations sur les risques ne remplacent pas l'état des risques obligatoire pour une vente ou une location. La couleur exacte de la zone d'un PPR (rouge : construction interdite, bleue : sous conditions) se lit sur sa carte de zonage.",
    ],
    sources: credits(used),
  });
}

function planName(p: terrain.Plan): string {
  return p.famille === "naturels"
    ? `plan de prévention des risques naturels${p.risques.length ? ` (${p.risques.join(", ")})` : ""}`
    : `plan de prévention des risques technologiques (${p.nom})`;
}

/** The summary's sentence on risk plans. */
export function riskLine(plans: terrain.Plan[]): string {
  const inZone = plans.filter((p) => p.zone_reglementee);
  if (!plans.length) return "hors des zones réglementées des plans de prévention des risques";
  const listed = (inZone.length ? inZone : plans).map(planName).join(" et ");
  return inZone.length ? `dans une zone réglementée (rouge ou bleue) du ${listed}` : `dans le périmètre du ${listed}`;
}

const SINCE = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export function risksBlock(
  lon: number,
  lat: number,
  insee: string | undefined,
  ppr: terrain.Plan[] | undefined,
  cat: terrain.Catnat[] | undefined,
  mvt: terrain.Landslide[] | undefined,
) {
  const near = mvt
    ?.map((x) => ({ ...x, d: distanceKm(lon, lat, x.lon, x.lat) * 1000 }))
    .sort((a, b) => a.d - b.d);
  return {
    plans_de_prevention:
      ppr === undefined
        ? DOWN
        : ppr.length
          ? ppr.map((p) => ({
              plan: planName(p),
              au_point: p.zone_reglementee
                ? "dans une zone réglementée du plan : construction interdite (zone rouge) ou soumise à prescriptions (zone bleue), selon la carte de zonage"
                : "dans le périmètre du plan",
              approuve_ou_revise_le: p.approuve_le ? SINCE(p.approuve_le) : undefined,
              voir_sur_la_carte: `https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=${lon}&lat=${lat}&zoom=17`,
              servitudes_publiees: p.document,
            }))
          : "le point n'est dans aucune zone réglementée d'un plan de prévention des risques (la commune peut en avoir un ailleurs)",
    catastrophes_naturelles:
      insee === undefined
        ? undefined
        : cat === undefined
          ? DOWN
          : {
              arretes_dans_la_commune: cat.length,
              derniers: cat.slice(0, 5).map((c) => ({ evenement: c.risques.join(", "), du: SINCE(c.debut), au: SINCE(c.fin), arrete_publie_le: SINCE(c.arrete) })),
            },
    mouvements_de_terrain_recenses:
      near === undefined
        ? DOWN
        : {
            rayon_m: 500,
            nombre: near.length,
            plus_proches: near.slice(0, 5).map((x) => ({ type: x.type, date: x.date ? SINCE(x.date) : undefined, distance_m: Math.round(x.d / 10) * 10, fiabilite: x.fiabilite || undefined })),
          },
    seisme: "zone de sismicité 2 (faible), comme toute l'île : règles de construction parasismique pour certains bâtiments",
    radon: insee && terrain.RADON_2.has(insee)
      ? "potentiel radon de catégorie 2 : faible, mais la géologie peut faciliter sa remontée dans les bâtiments"
      : "potentiel radon de catégorie 1 (faible)",
    cyclone_et_volcan: "toute l'île est exposée aux cyclones\u00a0; les coulées du Piton de la Fournaise touchent l'Enclos et le Grand Brûlé, entre Sainte-Rose et Saint-Philippe (en 1977, une coulée sortie de l'Enclos a atteint Piton Sainte-Rose)",
    pour_aller_plus_loin: "https://www.georisques.gouv.fr/mes-risques/connaitre-les-risques-pres-de-chez-moi",
  };
}
