/**
 * The water of the whole island at once, for the /eau page: every bathing site the ARS checks and the tap water of each
 * commune. That is some 75 requests (two pages per site, four per commune), more than a Worker may make for one
 * page: in the Worker it is read from the KV store under `eau:ile`, where .github/workflows/eau.yml writes it
 * (scripts/eau-ile.ts). The Node server, given no reader, gathers it itself.
 */
import type { Cache, Cached } from "../cache.js";
import { INSEE } from "../places/insee.js";
import * as baignades from "../providers/baignades.js";
import * as potable from "../providers/eaupotable.js";
import { networkRow, siteRow } from "../tools/eau.js";

export interface Ile {
  /** ISO time of the gathering. */
  lu: string;
  baignades: (ReturnType<typeof siteRow> & { lon: number; lat: number })[];
  communes: {
    commune: string;
    reseaux: number;
    analyses_6_mois: number;
    non_conformes_6_mois: number;
    derniere_analyse?: string;
    /** The networks with a sample off the limits in 6 months. */
    a_surveiller: ReturnType<typeof networkRow>[];
  }[];
}

const FRESH_SECONDS = 3600;

/** Everything, read from the sources; a site or a commune that fails is left out rather than failing the rest. */
export async function gather(cache: Cache, now = new Date()): Promise<Ile> {
  const sites = await Promise.all(baignades.SITES.map(async (s) => {
    try {
      const r = await baignades.results(cache, s, now);
      return { ...siteRow(r.value, now), lon: s.lon, lat: s.lat };
    } catch {
      return null;
    }
  }));
  const communes = [];
  // A few communes at a time: Hub'Eau is a shared public service.
  const names = Object.keys(INSEE);
  for (let i = 0; i < names.length; i += 4) {
    communes.push(...await Promise.all(names.slice(i, i + 4).map(async (commune) => {
      try {
        const { value } = await potable.commune(cache, INSEE[commune], now);
        const rows = value.reseaux.map((r) => networkRow(r, value.prelevements));
        const last = value.prelevements[0];
        return {
          commune,
          reseaux: rows.length,
          analyses_6_mois: value.prelevements.length,
          non_conformes_6_mois: value.prelevements.filter((p) => !p.conforme).length,
          derniere_analyse: last ? last.date.slice(0, 10) : undefined,
          a_surveiller: rows.filter((r) => r.non_conformes_6_mois).sort((a, b) => b.non_conformes_6_mois - a.non_conformes_6_mois),
        };
      } catch {
        return null;
      }
    })));
  }
  return {
    lu: now.toISOString(),
    baignades: sites.filter((s) => s !== null),
    communes: communes.filter((c) => c !== null).sort((a, b) => a.commune.localeCompare(b.commune, "fr")),
  };
}

let reader: (() => Promise<Ile | null>) | undefined;

/** In the Worker: read the island's copy from the KV store, where the workflow writes it. */
export function configure(read: (() => Promise<Ile | null>) | undefined) {
  reader = read;
}

export async function ile(cache: Cache, now = new Date()): Promise<Cached<Ile>> {
  return cache.get("eau:ile", FRESH_SECONDS, async () => {
    if (reader) {
      const v = await reader();
      if (!v?.baignades) throw new Error("qualité de l'eau absente du stockage");
      return v;
    }
    return gather(cache, now);
  });
}
