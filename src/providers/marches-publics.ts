/**
 * The public procurement notices open at La Réunion, as the BOAMP (the DILA's bulletin, under the Licence Ouverte)
 * publishes them: the island's buyers, the State, the communes, the Région, the hospitals. The Worker's scheduled
 * event reads them every hour (`collect`, worker.ts), keeps them in the KV store until their closing date, where the
 * page reads them (`avis`), never the API.
 *
 * Its field `code_departement` lists where a notice is published, not where the work is: Mayotte's, the Antilles' and
 * national buyers publish at La Réunion too. A notice is kept when it is published for La Réunion alone, when its
 * buyer's address has a postcode of the island (a CEDEX, 977xx or 978xx, with a town of the island), or when its place
 * of work is on the island (NUTS FRY40, a postcode of the island, « La Réunion » in its words). Those places are in the
 * notice's full text (`donnees`, about 35 Ko), read once, when the notice is new. A correction (« rectificatif ») takes
 * the place of the notice it corrects. A notice cancelled leaves: by a notice of cancellation (« avis d'annulation »,
 * without closing date, read in the same list), or by the notice that cancels and replaces it (its state
 * « ANNULATION »). The awards (« résultats de marché ») are not read, nor their holder, who may be a person.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import { communeAdresse, communeDe } from "../places/codes-postaux.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "boamp_api",
  nom: "Avis de marchés publics à La Réunion (BOAMP)",
  organisme: "DILA, Bulletin officiel des annonces des marchés publics",
  licence: "Licence Ouverte",
  attribution: "BOAMP (DILA)",
  url: "https://www.boamp.fr/",
};

const API = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/exports/json";
/**
 * What the list is read with: the notices open, published for La Réunion among others, and the notices of cancellation
 * of the last year, which have no closing date (a notice is open a few months at most after it is published).
 */
const ouverts = (now: Date) => {
  const an = new Date(now.getTime() - 366 * 86_400_000).toISOString().slice(0, 10);
  return `code_departement="974" and (datelimitereponse>=now() or (nature="ANNULATION" and dateparution>=date'${an}'))`;
};
const CHAMPS = "idweb,objet,nomacheteur,dateparution,datelimitereponse,type_marche,code_departement,nature,etat,annonce_lie,url_avis";

/** Written by the scheduled event (`collect`), read by worker.ts. */
export const KV_KEY = "marches-publics:avis";
/** Longer than an hour without a read: the copy stays a day after the last, and says its time. */
export const KV_TTL_SECONDS = 2 * 86_400;

export interface Avis {
  /** The BOAMP's reference: « 26-104904 ». */
  id: string;
  objet: string;
  acheteur: string;
  /** « travaux », « services », « fournitures »: one or more. */
  types: string[];
  /** The day it was published: « 2026-10-29 ». */
  parution: string;
  /**
   * The closing day of the answers: « 2026-11-30 ». Never its hour: the BOAMP's is not reliable (a European notice
   * gives La Réunion's 16:00 with Paris's offset, its own schema an hour without zone).
   */
  limite: string;
  /** Its page on boamp.fr. */
  lien: string;
  /** The commune of its place of work, when one only is given. */
  commune?: string;
  /** The commune of its buyer's address, when its place of work gives none. */
  communeAcheteur?: string;
  /** The notices it corrects, or cancels and replaces: they are not shown. */
  corrige?: string[];
}

export interface Copie {
  /** When the list was last read (ISO, UTC). */
  lu: string;
  /** Newest first, the corrected ones too (`affiches` leaves them out). */
  avis: Avis[];
  /** The open notices published at La Réunion that are not the island's: not read again. */
  ecartes: string[];
  /** The new notices of the list, whose full text the next pass reads: not shown before. */
  attente?: (Avis & { departements: string[] })[];
  /** When the list first failed to be read since `lu`; absent while it is read. */
  echec?: string;
}

/** A notice of the list, as the API gives it. */
interface Ligne {
  idweb: string;
  objet: string | null;
  nomacheteur: string | null;
  dateparution: string | null;
  datelimitereponse: string | null;
  type_marche: string[] | null;
  code_departement: string[] | null;
  /** « APPEL_OFFRE », or « ANNULATION » for a notice of cancellation. */
  nature: string | null;
  /** « INITIAL », « RECTIFICATIF », or « ANNULATION » for a notice that cancels and replaces another. */
  etat: string | null;
  annonce_lie: string[] | null;
  url_avis: string | null;
}

const url = (params: Record<string, string>) => `${API}?${new URLSearchParams(params)}`;

/** Every value of the notice's full text, with its path: « /FNSimple/organisme/cp » → « 97480 ». */
function* walk(o: unknown, path = ""): Generator<[string, string]> {
  if (Array.isArray(o)) for (const v of o) yield* walk(v, path);
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) yield* walk(v, `${path}/${k}`);
  else if (o != null) yield [path, String(o)];
}

/** Where a notice is, from its full text: its buyer's address and its places of work, as written. */
export function lieux(donnees: string): { acheteur: { cp?: string; ville?: string }; travaux: { cp?: string; ville?: string; nuts?: string; texte?: string }[] } {
  const values = [...walk(JSON.parse(donnees))];
  const get = (re: RegExp) => values.filter(([p]) => re.test(p)).map(([, v]) => v);
  if (values[0]?.[0].startsWith("/EFORMS")) {
    // eForms (the European notices): the buyer is an organisation of the list, by its identifier.
    const buyer = get(/\/cac:ContractingParty\/cac:Party\/cac:PartyIdentification\/cbc:ID(\/#text)?$/)[0];
    let acheteur = {};
    const orgs = values.filter(([p]) => p.includes("/efac:Organization/efac:Company/"));
    // The organisations come one after another, each with its identifier then its address.
    let current: { id?: string; cp?: string; ville?: string } = {};
    const all: (typeof current)[] = [];
    for (const [p, v] of orgs) {
      if (/\/cac:PartyIdentification\/cbc:ID(\/#text)?$/.test(p)) all.push((current = { id: v }));
      else if (p.endsWith("/cac:PostalAddress/cbc:PostalZone")) current.cp = v;
      else if (p.endsWith("/cac:PostalAddress/cbc:CityName")) current.ville = v;
    }
    const b = all.find((x) => x.id === buyer);
    if (b) acheteur = { ...(b.cp ? { cp: b.cp } : {}), ...(b.ville ? { ville: b.ville } : {}) };
    const travaux: { cp?: string; ville?: string; nuts?: string }[] = [];
    let place: { cp?: string; ville?: string; nuts?: string } = {};
    for (const [p, v] of values) {
      if (!p.includes("/cac:RealizedLocation/cac:Address/")) continue;
      if (p.endsWith("/cbc:PostalZone")) place.cp = v;
      else if (p.endsWith("/cbc:CityName")) place.ville = v;
      else if (p.endsWith("/cbc:CountrySubentityCode/#text")) place.nuts = v;
      else continue;
      if (place.cp && place.ville && place.nuts) travaux.push(place), (place = {});
    }
    if (Object.keys(place).length) travaux.push(place);
    return { acheteur, travaux };
  }
  // The BOAMP's own schemas (FNSimple, MAPA, DIVERS…): the buyer's address under « organisme ».
  const cp = get(/\/organisme(\/adr)?\/cp$/)[0];
  const ville = get(/\/organisme(\/adr)?\/ville$/)[0];
  const travaux = [
    ...get(/\/lieuExecution$/).map((texte) => ({ texte })),
    ...(() => {
      const cps = get(/\/lieuExecutionLivraison\/cp$/);
      const villes = get(/\/lieuExecutionLivraison\/ville$/);
      return cps.map((c, i) => ({ cp: c, ...(villes[i] ? { ville: villes[i] } : {}) }));
    })(),
  ];
  return { acheteur: { ...(cp ? { cp } : {}), ...(ville ? { ville } : {}) }, travaux };
}

const REUNION = /\br[ée]union\b/i;

/**
 * Whether a notice is the island's, and its communes: its place of work's when one only is given, else its buyer's.
 * A commune from a postcode of the island or a name exact; never from a name alone out of the island's codes.
 */
export function rattache(departements: string[], l: ReturnType<typeof lieux>): { reunion: boolean; commune?: string; communeAcheteur?: string } {
  const buyerHere = /^974\d\d$/.test(l.acheteur.cp?.trim() ?? "") || communeAdresse(l.acheteur.cp, l.acheteur.ville) !== undefined;
  const placeHere = l.travaux.some((t) => t.nuts === "FRY40" || /^974\d\d$/.test(t.cp?.trim() ?? "") || REUNION.test(t.texte ?? "") || REUNION.test(t.ville ?? ""));
  const reunion = (departements.length === 1 && departements[0] === "974") || buyerHere || placeHere;
  if (!reunion) return { reunion };
  const places = new Set(l.travaux.flatMap((t) => {
    const c = t.cp ? communeAdresse(t.cp, t.ville) : communeDe(t.texte?.replace(/\(.*?\)/g, "").replace(/^(?:commune|ville) de /i, ""));
    return c ? [c] : [];
  }));
  const commune = places.size === 1 ? [...places][0] : undefined;
  const communeAcheteur = commune ? undefined : communeAdresse(l.acheteur.cp, l.acheteur.ville);
  return { reunion, ...(commune ? { commune } : {}), ...(communeAcheteur ? { communeAcheteur } : {}) };
}

/** The types of the API (« TRAVAUX ») as the page says them. */
const TYPES: Record<string, string> = { TRAVAUX: "travaux", SERVICES: "services", FOURNITURES: "fournitures" };

/** Newest first, then by reference. */
const order = (a: Avis, b: Avis) => b.parution.localeCompare(a.parution) || b.id.localeCompare(a.id);

const localDay = (t: number) => new Date(t + 4 * 3600_000).toISOString().slice(0, 10);

/** Whether a notice is still open at `now`: until its closing day included, at La Réunion. */
export const ouvert = (a: Avis, now: Date) => a.limite >= localDay(now.getTime());

/**
 * Every hour, the list at 35 past (UTC), the full text of its new notices at 40 past: one request to the BOAMP in each
 * event, five minutes apart, never two in a minute.
 */
export const REFRESH_EVERY = 60;
export const REFRESH_OFFSET = 35;
export const TEXTES_OFFSET = 40;
const inWindow = (now: Date, offset: number) => (((now.getUTCMinutes() - offset) % REFRESH_EVERY) + REFRESH_EVERY) % REFRESH_EVERY < 5;
export const refreshDue = (now: Date) => inWindow(now, REFRESH_OFFSET) || inWindow(now, TEXTES_OFFSET);
/**
 * The next hour at 35 past, after `now`: when the scheduled event reads the notices next; at 40 past, with
 * `TEXTES_OFFSET`, when it reads the texts of the new ones.
 */
export function prochaineLecture(now: Date, offset = REFRESH_OFFSET): Date {
  const t = new Date(now);
  t.setUTCMinutes(offset, 0, 0);
  if (t.getTime() <= now.getTime()) t.setUTCHours(t.getUTCHours() + 1);
  return t;
}

/** The notices shown: a correction in the list takes the place of the notice it corrects. */
export function affiches(avis: Avis[]): Avis[] {
  const corrected = new Set(avis.flatMap((a) => a.corrige ?? []));
  return avis.filter((a) => !corrected.has(a.id));
}

/** A notice of the list, as the page keeps it. */
function fromLigne(l: Ligne, had?: Avis): (Avis & { departements: string[] }) | undefined {
  if (!l.idweb || !l.objet || !l.datelimitereponse || !l.url_avis) return undefined;
  return {
    id: l.idweb,
    objet: l.objet.replace(/\s+/g, " ").trim(),
    acheteur: (l.nomacheteur ?? "").replace(/\s+/g, " ").trim(),
    types: (l.type_marche ?? []).map((t) => TYPES[t]).filter(Boolean),
    parution: l.dateparution ?? "",
    limite: l.datelimitereponse.slice(0, 10),
    lien: l.url_avis,
    ...(had?.commune ? { commune: had.commune } : {}),
    ...(had?.communeAcheteur ? { communeAcheteur: had.communeAcheteur } : {}),
    ...((l.etat === "RECTIFICATIF" || l.etat === "ANNULATION") && l.annonce_lie?.length ? { corrige: l.annonce_lie } : {}),
    departements: l.code_departement ?? [],
  };
}

/**
 * The scheduled event's read, one request each time. At 35 past, the list of the open notices (about 80 Ko): those
 * known are kept up to date, the closed ones leave, the new ones wait for their full text. At 40 past, the full text of
 * the waiting ones (one request for all), to tell the island's and their communes. A notice cancelled leaves the copy,
 * with the corrections of it: not shown, not read. Writes the copy only when it
 * changed. When the list cannot be read, the copy stays, with when it first failed (written once), and the read fails.
 */
export async function collect(before: Copie | null, write: (copie: Copie) => Promise<void>, now = new Date()): Promise<string> {
  const said = (c: Copie, what: string) => `${c.avis.length} avis, ${what}, ${c.ecartes.length} hors de l'île`;
  const save = async (c: Copie, what: string) => {
    if (before && !before.echec && JSON.stringify(c) === JSON.stringify(before)) return `${said(c, what)} : inchangés, non réécrits`;
    await write(c);
    return `${said(c, what)} : écrits`;
  };
  if (!inWindow(now, REFRESH_OFFSET)) {
    // The full text of the notices waiting.
    const attente = before?.attente ?? [];
    if (!before || !attente.length) return "aucun avis nouveau à lire";
    const where = `idweb in (${attente.map((a) => JSON.stringify(a.id)).join(", ")})`;
    let textes: { idweb: string; donnees: string | null }[];
    try {
      textes = await getJson<{ idweb: string; donnees: string | null }[]>(SOURCE.id, url({ select: "idweb,donnees", where }), 60_000);
      if (!Array.isArray(textes)) throw new Error("textes des avis illisibles");
    } catch (err) {
      // The page says the BOAMP did not answer, not that the notices waiting do not exist.
      if (!before.echec) await write({ ...before, echec: now.toISOString() });
      throw err;
    }
    const avis = [...before.avis];
    const ecartes = new Set(before.ecartes);
    const rest: typeof attente = [];
    for (const { departements, ...a } of attente) {
      const t = textes.find((x) => x.idweb === a.id);
      if (!t?.donnees) {
        rest.push({ ...a, departements });
        continue;
      }
      const r = rattache(departements, lieux(t.donnees));
      if (!r.reunion) ecartes.add(a.id);
      else {
        // In the order of the list's pass (`fromLigne`), to compare the copies as they are written.
        const { corrige, ...base } = a;
        avis.push({ ...base, ...(r.commune ? { commune: r.commune } : {}), ...(r.communeAcheteur ? { communeAcheteur: r.communeAcheteur } : {}), ...(corrige ? { corrige } : {}) });
      }
    }
    const copie: Copie = { lu: before.lu, avis: avis.sort(order), ecartes: [...ecartes].sort(), ...(rest.length ? { attente: rest } : {}), ...(before.echec ? { echec: before.echec } : {}) };
    return save(copie, `${attente.length - rest.length} textes lus`);
  }
  let lignes: Ligne[];
  try {
    lignes = await getJson<Ligne[]>(SOURCE.id, url({ select: CHAMPS, where: ouverts(now), order_by: "dateparution desc" }), 30_000);
    if (!Array.isArray(lignes)) throw new Error("liste des avis illisible");
    // The island has notices open at every hour (122 on 29/10/2026): an empty list is a read that failed, never « no
    // notice ».
    if (!lignes.length) throw new Error("liste des avis vide");
  } catch (err) {
    if (before && !before.echec) await write({ ...before, echec: now.toISOString() });
    throw err;
  }
  const known = new Map((before?.avis ?? []).map((a) => [a.id, a]));
  const all = new Map([...(before?.avis ?? []), ...(before?.attente ?? [])].map((a) => [a.id, a]));
  const ecartes = new Set(before?.ecartes ?? []);
  const avis: Avis[] = [];
  const attente: (Avis & { departements: string[] })[] = [];
  const annules = new Set(lignes.filter((l) => l.nature === "ANNULATION" || l.etat === "ANNULATION").flatMap((l) => l.annonce_lie ?? []));
  for (const l of lignes) {
    if (ecartes.has(l.idweb) || l.nature === "ANNULATION" || annules.has(l.idweb)) continue;
    const a = fromLigne(l, known.get(l.idweb));
    // A correction of a notice cancelled leaves with it; the notice that cancels and replaces stays.
    if (!a || (l.etat === "RECTIFICATIF" && a.corrige?.some((id) => annules.has(id)))) continue;
    const { departements, ...shownA } = a;
    if (known.has(a.id)) avis.push(shownA);
    else attente.push(a);
  }
  const nouveaux = attente.filter((a) => !all.has(a.id)).length;
  const open = new Set(lignes.map((l) => l.idweb));
  const copie: Copie = { lu: now.toISOString(), avis: avis.sort(order), ecartes: [...ecartes].filter((id) => open.has(id)).sort(), ...(attente.length ? { attente } : {}) };
  // The time of the read is written only with a change: the page says the last read that changed something.
  if (before && !before.echec && JSON.stringify({ ...copie, lu: before.lu }) === JSON.stringify(before)) return `${said(copie, `${nouveaux} nouveaux`)} : inchangés, non réécrits`;
  await write(copie);
  return `${said(copie, `${nouveaux} nouveaux`)} : écrits`;
}

let reader: (() => Promise<Copie | null>) | undefined;

/** In the Worker: read the notices from the KV store, where the scheduled event writes them, and the API never. */
export function configure(read: (() => Promise<Copie | null>) | undefined) {
  reader = read;
}

/**
 * How long a copy read from the store may be served: since the last time the scheduled event may have written it, two
 * minutes after 35 and 40 past (a pass ends within a minute and a half). A copy read before is asked again, once: on
 * 29/10/2026 the copy read at 16:38, its notices being sorted, would have stayed an hour after the texts written at
 * 16:41.
 */
export function fraicheur(now: Date): number {
  const ends = [REFRESH_OFFSET + 2, TEXTES_OFFSET + 2].flatMap((m) => [0, -1].map((h) => {
    const t = new Date(now);
    t.setUTCHours(t.getUTCHours() + h, m, 0, 0);
    return t.getTime();
  })).filter((t) => t <= now.getTime());
  return Math.max(1, Math.floor((now.getTime() - Math.max(...ends)) / 1000));
}

/**
 * The stored notices still open, their time the list's last read; null where nothing is configured (a local server,
 * the tests), as the Worker alone has them.
 */
export async function avis(cache: Cache, now = new Date()): Promise<Cached<Copie> | null> {
  if (!reader) return null;
  const read = reader;
  const c = await cache.getCopy(KV_KEY, fraicheur(now), async () => {
    const v = await read();
    if (!v) throw new Error("avis de marchés absents du stockage");
    return v;
  }, (v) => v.lu);
  return { ...c, value: { ...c.value, avis: affiches(c.value.avis.filter((a) => ouvert(a, now))) }, fetchedAt: new Date(c.value.lu) };
}
