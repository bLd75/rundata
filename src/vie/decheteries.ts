/**
 * The déchèteries of the Territoire de l'Ouest (src/vie/decheteries.json, scripts/build-decheteries.py) and what
 * their skips take now (providers/tco.ts). Only the TCO publishes this: the other communes are told where to look.
 */
import { distanceKm, localTime } from "../geo.js";
import * as tco from "../providers/tco.js";
import data from "./decheteries.json" with { type: "json" };

export interface Site {
  nom: string;
  adresse: string;
  commune: string;
  lon: number;
  lat: number;
  lien: string;
}

export const SITES = data.sites as Site[];
export const TCO_COMMUNES = [...new Set(SITES.map((s) => s.commune))];

// An update older than this, or of another day, is not said to be the state now.
const STALE_HOURS = 6;

/** The intercommunalité of each commune outside the TCO, and its site. */
const EPCI: { nom: string; site: string; communes: string[] }[] = [
  { nom: "la CINOR", site: "https://www.cinor.re/", communes: ["Saint-Denis", "Sainte-Marie", "Sainte-Suzanne"] },
  { nom: "la CIREST", site: "https://www.cirest.fr/", communes: ["Saint-André", "Bras-Panon", "Saint-Benoît", "La Plaine-des-Palmistes", "Sainte-Rose", "Salazie"] },
  { nom: "la CIVIS", site: "https://www.civis.re/", communes: ["Saint-Pierre", "Saint-Louis", "Petite-Île", "L'Étang-Salé", "Les Avirons", "Cilaos"] },
  { nom: "la CASUD", site: "https://www.casud.re/", communes: ["Le Tampon", "Entre-Deux", "Saint-Joseph", "Saint-Philippe"] },
];
export const OTHERS = EPCI.map(({ nom, site }) => ({ nom, site }));
export const epciOf = (commune: string) => EPCI.find((e) => e.communes.includes(commune));

export interface SiteNow extends Site {
  /** « 24/10 17:00 », when the staff last filled it in. */
  mis_a_jour?: string;
  /** Whether that is recent enough to be the state now. */
  a_jour: boolean;
  accepte: string[];
  refuse: string[];
}

/** Each site with what its skips take, as recent as the staff's last update allows. */
export function sitesNow(etats: tco.Etat[] | undefined, now: Date): SiteNow[] {
  const byLink = new Map((etats ?? []).map((e) => [e.lien, e]));
  const day = (d: Date) => new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
  return SITES.map((s) => {
    const e = byLink.get(s.lien);
    const at = e?.maj ? new Date(e.maj) : undefined;
    const fresh = !!at && now.getTime() - at.getTime() <= STALE_HOURS * 3600_000 && day(at) === day(now);
    const kinds = Object.entries(e?.accepte ?? {});
    return {
      ...s,
      mis_a_jour: at ? localTime(at) : undefined,
      a_jour: fresh,
      accepte: kinds.filter(([, ok]) => ok).map(([k]) => tco.WASTES[k]),
      refuse: kinds.filter(([, ok]) => !ok).map(([k]) => tco.WASTES[k]),
    };
  });
}

/** The kind of waste a question names (« déchets verts », « frigo »), as the dataset calls it. */
export function wasteAsked(text: string): string | undefined {
  const t = text.toLowerCase();
  const words: [RegExp, string][] = [
    [/vert|jardin|branch|palme|tonte|v[ée]g[ée]ta/, "dechets_verts"],
    [/encombrant/, "encombrants"],
    [/gravat|d[ée]blai|b[ée]ton|parpaing/, "deblais_gravats"],
    [/placo|pl[âa]tre/, "placo"],
    [/m[ée]ta(l|ux)|ferraille/, "metaux"],
    [/meuble|mobilier|matelas|canap/, "mobilier"],
    [/frigo|r[ée]frig|cong[ée]la/, "refrigerateurs_congelateurs"],
    [/[ée]lectrom[ée]nager|machine [àa] laver|lave/, "gros_electromenager"],
    [/[ée]cran|t[ée]l[ée]|ordinateur/, "ecrans"],
    [/carton|papier/, "papiers_cartons"],
    [/verre/, "verres"],
    [/textile|v[êe]tement|chaussure/, "textiles_chaussures"],
    [/batterie/, "batteries"],
    [/\bpile/, "piles"],
    [/huile/, "huiles"],
    [/n[ée]on/, "neons"],
  ];
  return words.find(([re]) => re.test(t))?.[1];
}

export function nearest(lon: number, lat: number, sites: SiteNow[], max = 3) {
  return sites.map((s) => ({ ...s, km: distanceKm(lon, lat, s.lon, s.lat) })).sort((a, b) => a.km - b.km).slice(0, max);
}
