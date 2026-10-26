import type { Cache } from "../cache.js";
import { distanceKm } from "../geo.js";
import { INSEE } from "../places/insee.js";
import { resolvePlace } from "../places/resolve.js";
import * as terrain from "../providers/terrain.js";
import * as loyers from "../vie/loyers.js";
import { why } from "../types.js";
import { a, credits, nombre, text } from "./format.js";

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
// « ravine » also comes inside a street's name or its quarter's: a kind only when it comes first.
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
 * asked (« Rue Roland Garros (Bois de Nèfles) » for « 12 rue Roland Garros Bois de Nèfles, Saint-Paul »); one letter
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
const euros = (n: number) => `${nombre(Math.round(n / 1000) * 1000)}\u00a0€`;

/**
 * Below this many sales of one kind on the street, their count alone: DVF's terms forbid making people identifiable
 * again. The same threshold as the area around (`market`), decided on 26/10.
 */
export const MEDIANE_MIN = 3;

/**
 * Aggregates only: DVF's terms forbid re-identifying people, so no single sale, address or parcel is given out.
 * Houses and flats sold alone, with a built surface, for a median price and a median price per m². As on the street: a
 * house or a flat sold with its outbuildings counts (Cerema's types 111 and 121 leave them out), off plan too, and
 * exchanges and expropriations are no sales. Unlike the street, a sale DVF records twice stays twice: Cerema gives no lot
 * numbers to tell it from two flats of one building sold at one price.
 */
export function market(sales: terrain.Sale[]) {
  const sold = sales.filter((s) => !terrain.NOT_SALES.has(s.nature));
  const pick = (code: string) => sold.filter((s) => s.code === code && s.surface_bati >= 15);
  const sum = (list: terrain.Sale[]) =>
    list.length < 3
      ? { ventes: list.length, note: "trop peu de ventes pour une médiane" }
      : {
          ventes: list.length,
          prix_median: euros(median(list.map((s) => s.valeur))!),
          prix_m2_median: `${nombre(Math.round(median(list.map((s) => s.valeur / s.surface_bati))! / 10) * 10)}\u00a0€/m²`,
          surface_mediane_m2: Math.round(median(list.map((s) => s.surface_bati))!),
        };
  const land = sold.filter((s) => s.code.startsWith("2") && s.surface_terrain > 0 && s.surface_bati === 0);
  return {
    maisons: sum(pick("111")),
    appartements: sum(pick("121")),
    terrains_nus: land.length >= 3 ? { ventes: land.length, prix_m2_median: `${nombre(Math.round(median(land.map((s) => s.valeur / s.surface_terrain))!))}\u00a0€/m²` } : { ventes: land.length },
    toutes_ventes: sold.length,
  };
}

// The area of `market`: a square, not a radius (marketing's words, 25/10).
const SECTEUR = "dans le secteur alentour (environ 600 m sur 600 m)";

/**
 * The sales on the street asked (DVF géolocalisées), aggregates only like `market`: by kind, a median per m² from
 * MEDIANE_MIN sales of that kind, the count alone below; with fewer than MEDIANE_MIN sales in all, the count alone.
 */
export function streetMarket(nom: string, depuis: number, sales: terrain.StreetSale[]) {
  const n = sales.length;
  // marketing's words (25/10): DVF comes months late, so « no sale » is DVF's, not the street's.
  if (n < MEDIANE_MIN) return { voie: nom, depuis, ventes: n, note: n ? `${enregistrees(n)} dans DVF sur la voie depuis ${depuis}, trop peu pour une médiane` : `aucune vente enregistrée dans DVF sur la voie depuis ${depuis}` };
  const built = (type: "maison" | "appartement") => {
    const list = sales.filter((s) => s.type === type && s.surface_bati >= 15);
    return list.length < MEDIANE_MIN
      ? { ventes: sales.filter((s) => s.type === type).length }
      : { ventes: list.length, prix_median: euros(median(list.map((s) => s.valeur))!), prix_m2_median: `${nombre(Math.round(median(list.map((s) => s.valeur / s.surface_bati))! / 10) * 10)}\u00a0€/m²` };
  };
  const land = sales.filter((s) => s.type === "terrain" && s.surface_terrain > 0);
  return {
    voie: nom,
    depuis,
    ventes: n,
    maisons: built("maison"),
    appartements: built("appartement"),
    terrains_nus: land.length >= MEDIANE_MIN ? { ventes: land.length, prix_m2_median: `${nombre(Math.round(median(land.map((s) => s.valeur / s.surface_terrain))!))}\u00a0€/m²` } : { ventes: sales.filter((s) => s.type === "terrain").length },
    autres_ventes: sales.filter((s) => s.type === "autre").length,
  };
}

const enregistrees = (n: number) => `${n} vente${n > 1 ? "s enregistrées" : " enregistrée"}`;

// The rents' words: marketing's (26/10). Never « médian », « moyen » nor « signé »: a rent asked in an ad, for a
// reference home, with the ANIL's mention word for word.
const ANIL = loyers.SOURCE.attribution;
const T3 = `3e trimestre ${loyers.MILLESIME}`;
const LOYERS = {
  type: { appartement: "appartement type", appartement_1_2_pieces: "appartement de 1 ou 2 pièces", appartement_3_pieces_et_plus: "appartement de 3 pièces et plus", maison: "maison type" } as Record<loyers.Kind, string>,
  ligne: (commune: string, loyer: string) => `loyer d'annonce d'un appartement type ${commune === "Entre-Deux" ? "à l'Entre-Deux" : a(commune)}\u00a0: ${loyer} charges comprises, d'après les annonces du ${T3} (${ANIL})`,
  zone: (n: number) => `estimé avec des communes voisines, faute d'annonces assez nombreuses dans la commune (${nombre(n)} annonces pour l'ensemble de ces communes)`,
  fragile: "indicateur peu fiable selon l'ANIL (moins de 30 annonces dans la commune, ou modèle peu ajusté)\u00a0: à prendre avec prudence",
  note: `Loyers demandés dans les annonces de logements non meublés, charges comprises, estimés par l'ANIL pour un logement type d'après les annonces du ${T3}. Ce ne sont ni des loyers signés, ni des loyers médians ou moyens. L'intervalle est celui que l'ANIL donne à 95\u00a0%\u00a0: le loyer estimé a 95 chances sur 100 d'y être. Le découpage de la carte change chaque année\u00a0: ne pas comparer deux années entre elles. ${ANIL}.`,
};

/** The commune's rents asked in ads (vie/loyers.ts), each kind of home with its interval and its ads. */
export function rents(insee: string) {
  const c = loyers.ofInsee(insee);
  const commune = Object.keys(INSEE).find((n) => INSEE[n] === insee);
  if (!c || !commune) return undefined;
  const kinds = loyers.KINDS.filter((k) => c[k]).map((k) => {
    const l = c[k]!;
    return [k, {
      logement: `${LOYERS.type[k]}, ${loyers.SURFACE[k]}\u00a0m²`,
      loyer_m2_charges_comprises: loyers.m2(l.loyer_m2),
      intervalle_95: `${loyers.m2(l.bas)} à ${loyers.m2(l.haut)}`,
      annonces_dans_la_commune: l.annonces,
      ...(l.zone ? { estimation: LOYERS.zone(l.annonces_zone!) } : {}),
      ...(loyers.fragile(l) ? { prudence: LOYERS.fragile } : {}),
    }] as const;
  });
  return {
    ligne: c.appartement ? LOYERS.ligne(commune, loyers.m2(c.appartement.loyer_m2)) : undefined,
    bloc: { commune, millesime: loyers.MILLESIME, ...Object.fromEntries(kinds), note: LOYERS.note },
  };
}

/** The street's line of the summary, named as the address base writes it (marketing's words, 25/10). */
export function streetLine(v: ReturnType<typeof streetMarket>): string {
  const voie = `sur la voie (${v.voie})`;
  if (!v.ventes) return `${voie}, aucune vente enregistrée dans DVF depuis ${v.depuis}`;
  if (v.note !== undefined) return `${voie}, ${enregistrees(v.ventes)} dans DVF depuis ${v.depuis}, trop peu pour une médiane`;
  const kind = (name: string, k: { ventes: number; prix_m2_median?: string } | undefined) => (k?.prix_m2_median ? `${name} ${k.prix_m2_median} en médiane (${k.ventes} ventes)` : undefined);
  const kinds = [kind("maisons", v.maisons), kind("appartements", v.appartements), kind("terrains nus", v.terrains_nus)].filter(Boolean);
  return kinds.length
    ? `${voie} depuis ${v.depuis} : ${kinds.join(", ")}`
    : `${voie}, ${enregistrees(v.ventes)} dans DVF depuis ${v.depuis}, trop peu par type de bien pour une médiane`;
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

// The commune named after the last comma, or the commune of the quarter named there (« …, Bois de Nèfles »): only that
// part, a street may carry the name of another commune (« rue de Saint-Denis, Saint-Paul »).
export function communeOf(adresse: string): string | undefined {
  const i = adresse.lastIndexOf(",");
  if (i < 0) return undefined;
  const p = resolvePlace(adresse.slice(i + 1).replace(/\b97\d{3}\b/g, " ").trim());
  return p?.correspondance === "exacte" ? INSEE[p.lieu.commune] : undefined;
}

export async function ficheLieu(cache: Cache, adresse: string, now = new Date()) {
  // A street address goes to the national address base; a place name to the gazetteer first.
  let where: { label: string; lon: number; lat: number; precision: string; insee?: string } | null = null;
  // The street asked, found in the address base with its land registry code: its own sales besides the area's.
  let voie: { nom: string; code: string; insee: string } | undefined;
  const place = resolvePlace(adresse);
  if (place?.correspondance === "coordonnees") {
    where = { label: `point ${place.lieu.nom}`, lon: place.lieu.lon, lat: place.lieu.lat, precision: "coordonnées données" };
  } else if (place && place.correspondance === "exacte" && !ADDRESS.test(adresse)) {
    where = { label: `${place.lieu.nom} (${place.lieu.type}, ${place.lieu.commune})`, lon: place.lieu.lon, lat: place.lieu.lat, precision: "centre du lieu-dit ou de la commune", insee: INSEE[place.lieu.commune] };
  } else {
    const asked = communeOf(adresse);
    const a = await settle(terrain.SOURCES.ban.id, terrain.geocode(cache, adresse, asked));
    // Another street than the one asked: no figures of it, nor of the place around; the streets of the commune whose
    // names come close instead.
    const street = a && (a.type === "street" || a.type === "housenumber") && kindOf(words(adresse)) ? a.street ?? a.label.replace(/ \d{5} .*$/, "") : undefined;
    if (a && street && !sameStreet(adresse, street)) {
      const insee = asked ?? a.insee;
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
    const code = a && street ? terrain.codeVoie(a.id) : undefined;
    if (a && street && code) voie = { nom: street, code, insee: a.insee };
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
  const year = new Date(now.getTime() + 4 * 3600_000).getUTCFullYear();
  const fromYear = year - 5;
  const known = where.insee?.startsWith("974") ? where.insee : undefined;
  const parcelP = settle(terrain.SOURCES.cadastre.id, terrain.parcel(cache, lon, lat));
  // Given coordinates name no commune: the parcel's id starts with its INSEE code.
  const inseeP = known ? Promise.resolve(known) : parcelP.then((x) => (x?.idu.startsWith("974") ? x.idu.slice(0, 5) : undefined));
  const [p, z, alt, s, ppr, cat, mvt, insee, sv] = await Promise.all([
    parcelP,
    settle(terrain.SOURCES.gpu.id, terrain.zone(cache, lon, lat)),
    settle(terrain.SOURCES.alti.id, terrain.altitude(cache, lon, lat)),
    settle(terrain.SOURCES.dvf.id, terrain.sales(cache, lon, lat, fromYear)),
    settle(terrain.SOURCES.ppr.id, terrain.plans(cache, lon, lat)),
    inseeP.then((c) => (c ? settle(terrain.SOURCES.georisques.id, terrain.catnat(cache, c)) : undefined)),
    settle(terrain.SOURCES.georisques.id, terrain.landslides(cache, lon, lat)),
    inseeP,
    voie ? settle(terrain.SOURCES.dvfVoie.id, terrain.salesOnStreet(cache, voie.insee, voie.code, fromYear, year)) : undefined,
  ]);

  const parts = [`${where.label} (${where.precision})`];
  if (alt != null) parts.push(`altitude ${nombre(alt)}\u00a0m`);
  if (p) parts.push(`parcelle cadastrale ${p.section} ${p.numero} (${nombre(p.contenance_m2)}\u00a0m²)`);
  const zt = z ? ZONE_TYPES[z.typezone] ?? (z.typezone ? `zone ${z.typezone}` : undefined) : undefined;
  if (z) parts.push(`zone ${z.libelle} du PLU${zt ? `, ${zt}` : ""}`);
  const m = s ? market(s) : null;
  const risks = ppr ? riskLine(ppr) : undefined;
  if (risks) parts.push(risks);
  const onStreet = voie && sv ? streetMarket(voie.nom, fromYear, sv.ventes) : undefined;
  if (onStreet) parts.push(streetLine(onStreet));
  if (m && "prix_m2_median" in m.maisons) parts.push(`${SECTEUR}, maisons vendues depuis ${fromYear} : ${m.maisons.prix_m2_median} en médiane (${m.maisons.ventes} ventes)`);
  if (m && "prix_m2_median" in m.appartements) parts.push(`${"prix_m2_median" in m.maisons ? "" : `${SECTEUR}, `}appartements : ${m.appartements.prix_m2_median} (${m.appartements.ventes} ventes)`);
  const r = insee ? rents(insee) : undefined;
  if (r?.ligne) parts.push(r.ligne);

  const used = [
    terrain.SOURCES.ban,
    ...(p ? [terrain.SOURCES.cadastre] : []),
    ...(z ? [terrain.SOURCES.gpu] : []),
    ...(alt != null ? [terrain.SOURCES.alti] : []),
    ...(s ? [terrain.SOURCES.dvf] : []),
    ...(onStreet ? [terrain.SOURCES.dvfVoie] : []),
    ...(ppr ? [terrain.SOURCES.ppr] : []),
    ...(cat || mvt ? [terrain.SOURCES.georisques] : []),
    ...(r ? [loyers.SOURCE] : []),
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
      ? {
          perimetre: "environ 600 m × 600 m autour du point",
          depuis: fromYear,
          ...m,
          ...(voie ? { sur_la_voie: onStreet ?? DOWN } : {}),
          note: "Médianes des ventes enregistrées (DVF), maisons et appartements vendus seuls. Aucune vente individuelle n'est donnée.",
        }
      : DOWN,
    ...(r ? { loyers_d_annonce: r.bloc } : {}),
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
