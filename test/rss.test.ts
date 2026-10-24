import { describe, expect, it } from "vitest";
import type { Cached } from "../src/cache.js";
import type * as mf from "../src/providers/vigilance.js";
import type { CoupuresAnswer, RandonneesAnswer, VolcanAnswer } from "../src/web/data.js";
import { pageOf } from "../src/web/places.js";
import { communeRss, rssItems, rssLink } from "../src/web/rss.js";

const NOW = new Date("2026-10-24T06:00:00Z");
const SAINT_PAUL = pageOf("saint-paul")!;
const CILAOS = pageOf("cilaos")!;
const copy = <T>(value: T, fetchedAt = NOW): Cached<T> => ({ value, fetchedAt, stale: false });

const vigilance = (zones: mf.Vigilance["zones"], emise = "2026-10-24T04:00:00Z"): Cached<mf.Vigilance> => copy({ emise, zones, suivi: [] });
// Heavy rain on the west, yellow tonight then orange tomorrow; waves on one coast.
const RAIN = { "VIGI974-15": { 12: [{ couleur: 1, debut: "2026-10-24T00:00:00Z", fin: "2026-10-24T14:00:00Z" }, { couleur: 2, debut: "2026-10-24T14:00:00Z", fin: "2026-10-25T02:00:00Z" }, { couleur: 3, debut: "2026-10-25T02:00:00Z" }] } };
const WAVES = { "VIGI974-55": { 9: [{ couleur: 2, debut: "2026-10-24T03:00:00Z" }] } };

const coupures = (etat: string): Cached<CoupuresAnswer> =>
  copy({
    resume: "",
    avis: [
      { titre: "Travaux sur le réseau / Bois-de-Nèfles", communes: ["Saint-Paul"], distributeur: "CISE Réunion", publie_le: "23/10/2026 à 15:30", coupure: { de: "lundi 26/10 à 08:00", a: "lundi 26/10 à 16:00", etat }, secteurs: ["Bois-de-Nèfles"], secteurs_complets: true, ne_pas_boire: undefined, texte: "", lien: "https://example.re/avis/1" },
      { titre: "Lavage de réservoir", communes: ["Le Port"], distributeur: "Dionéo", publie_le: "23/10/2026 à 15:30", coupure: undefined, secteurs: [], secteurs_complets: false, ne_pas_boire: undefined, texte: "", lien: "https://example.re/avis/2" },
    ],
    couverture: "",
    a_savoir: "",
    sources: [],
    communes_suivies: [],
  } as CoupuresAnswer);

const trail = (nom: string, commune: string, etat: "ouvert" | "fermé", cause?: string) => ({ k: nom, nom, slug: "bord-salazie", commune, km: 12, etat, cause, precision: "Réouverture 2026", boucle: false, randonnees: [] });
const randonnees = copy({
  randonnees: [],
  secteurs: [{ secteur: "Cilaos", communes: ["Cilaos"], sentiers: [trail("Bord Salazie", "Cilaos", "fermé", "Dangers majeurs, sentier dégradé"), trail("Roche Merveilleuse", "Cilaos", "ouvert")] }],
  lignes: [],
  fermes: 1,
  suivis: 2,
  sources: [],
} as RandonneesAnswer);

const volcan = (niveau_orsec: string, eruption_en_cours = false): Cached<VolcanAnswer> =>
  copy({ resume: "Résumé de l'OVPF.", etat: { eruption_en_cours, niveau_orsec, derniere_eruption_fin: "2026-04-12T19:10:00+00:00", eruption: eruption_en_cours ? { started_at: "2026-10-24T03:12:00Z" } : undefined }, avertissements: [], sources: [] });

describe("a commune's RSS feed", () => {
  it("has an item for each vigilance above green, whose guid holds while the episode lasts", () => {
    const items = rssItems(SAINT_PAUL, { vigilance: vigilance({ ...RAIN, ...WAVES }) }, NOW);
    expect(items.map((i) => i.title)).toEqual(["Vigilance orange fortes pluies / orages : zone Ouest", "Vigilance jaune vagues-submersion sur le littoral"]);
    expect(items[0].description).toContain("Saint-Paul est dans la zone Ouest : jaune du");
    // The yellow starts after the bulletin: it is dated by the bulletin until it starts.
    expect(items[0].date).toEqual(new Date("2026-10-24T04:00:00Z"));

    // The next bulletin, and later in the day: the same items for the reader.
    const later = rssItems(SAINT_PAUL, { vigilance: vigilance({ ...RAIN, ...WAVES }, "2026-10-24T10:00:00Z") }, new Date("2026-10-24T12:00:00Z"));
    expect(later.map((i) => i.guid)).toEqual(items.map((i) => i.guid));
    // Red: a new item.
    const red = { "VIGI974-15": { 12: [...RAIN["VIGI974-15"][12], { couleur: 4, debut: "2026-10-25T06:00:00Z" }] } };
    expect(rssItems(SAINT_PAUL, { vigilance: vigilance(red) }, NOW)[0].guid).not.toBe(items[0].guid);
  });

  it("leaves out the waves inland, other zones and green", () => {
    expect(rssItems(CILAOS, { vigilance: vigilance({ ...RAIN, ...WAVES }) }, NOW)).toEqual([]);
    expect(rssItems(SAINT_PAUL, { vigilance: vigilance({ "VIGI974-15": { 12: [{ couleur: 1, debut: "2026-10-24T00:00:00Z" }] } }) }, NOW)).toEqual([]);
  });

  it("says a cyclone alert to every commune", () => {
    const items = rssItems(CILAOS, { vigilance: vigilance({ VIGI974: { 10: [{ couleur: 3, debut: "2026-10-24T02:00:00Z" }] } }) }, NOW);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Alerte cyclonique orange à La Réunion");
    expect(items[0].date).toEqual(new Date("2026-10-24T02:00:00Z"));
  });

  it("has the commune's water cuts until they are over", () => {
    const [cut] = rssItems(SAINT_PAUL, { coupures: coupures("à venir") }, NOW);
    expect(cut.title).toBe("Eau : Travaux sur le réseau / Bois-de-Nèfles");
    expect(cut.description).toBe("Coupure du lundi 26/10 à 08:00 au lundi 26/10 à 16:00. Secteurs : Bois-de-Nèfles. Avis de CISE Réunion : https://example.re/avis/1");
    expect(cut.date).toEqual(new Date("2026-10-23T11:30:00Z"));
    expect(cut.path).toBe("/coupures-eau/saint-paul");
    expect(rssItems(SAINT_PAUL, { coupures: coupures("terminée") }, NOW)).toEqual([]);
  });

  it("has the commune's closed trails, undated", () => {
    const items = rssItems(CILAOS, { randonnees }, NOW);
    expect(items).toEqual([{ title: "Sentier fermé : Bord Salazie", description: "Cause : Dangers majeurs, sentier dégradé. Précision de l'ONF : Réouverture 2026. D'après la carte des sentiers de l'ONF La Réunion.", path: "/sentiers/bord-salazie", guid: "sentier/Bord Salazie/Dangers majeurs, sentier dégradé" }]);
    expect(rssItems(SAINT_PAUL, { randonnees }, NOW)).toEqual([]);
  });

  it("has the volcano only above « Vigilance »", () => {
    expect(rssItems(SAINT_PAUL, { volcan: volcan("Vigilance") }, NOW)).toEqual([]);
    const [alert] = rssItems(SAINT_PAUL, { volcan: volcan("Alerte 1") }, NOW);
    expect(alert.title).toBe("Piton de la Fournaise : Alerte 1");
    const [eruption] = rssItems(SAINT_PAUL, { volcan: volcan("Alerte 2", true) }, NOW);
    expect(eruption.title).toBe("Éruption en cours au Piton de la Fournaise (Alerte 2)");
    expect(eruption.date).toEqual(new Date("2026-10-24T03:12:00Z"));
    expect(eruption.guid).not.toBe(alert.guid);
  });

  it("is RSS 2.0 with its own address, escaped, and one item that says what it is for, shown once", () => {
    const xml = communeRss("https://rundata.re", SAINT_PAUL, { vigilance: vigilance(RAIN), coupures: coupures("en cours") }, NOW);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/);
    expect(xml).toContain("<title>Saint-Paul : alertes · rundata.re</title>");
    expect(xml).toContain('<atom:link href="https://rundata.re/communes/saint-paul.rss" rel="self" type="application/rss+xml"/>');
    expect(xml).toContain("<description>Vigilance Météo-France, coupures d&#39;eau, sentiers fermés et volcan de Saint-Paul (974) : un article seulement quand il se passe quelque chose.</description>");
    expect(xml).toContain("<item><title>Ce flux publie les alertes de Saint-Paul</title><link>https://rundata.re/communes/saint-paul</link>");
    expect(xml).toContain('<guid isPermaLink="false">rundata.re/saint-paul/flux</guid><pubDate>Sat, 24 Oct 2026 12:00:00 GMT</pubDate>');
    expect(xml.match(/<item>/g)).toHaveLength(3);
    // Nothing unescaped in the text: every & starts an entity.
    expect(xml.replace(/&(amp|lt|gt|quot|#39);/g, "")).not.toMatch(/&/);
    expect(xml).toContain(`<lastBuildDate>${NOW.toUTCString()}</lastBuildDate>`);
  });

  it("names the commune with its article", () => {
    expect(["le-port", "les-avirons", "entre-deux", "la-possession", "saint-paul"].map((s) => rssLink(pageOf(s)!))).toEqual([
      "🔔 Les alertes du Port par RSS",
      "🔔 Les alertes des Avirons par RSS",
      "🔔 Les alertes de l'Entre-Deux par RSS",
      "🔔 Les alertes de La Possession par RSS",
      "🔔 Les alertes de Saint-Paul par RSS",
    ]);
  });
});
