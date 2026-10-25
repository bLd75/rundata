import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "../src/cache.js";
import * as sr from "../src/sans-reponse.js";
import { sitesSansReponse } from "../src/tools/sans-reponse.js";
import { sansReponsePage } from "../src/web/sans-reponse.js";
import { typo } from "../src/web/typo.js";

const SQL = readFileSync(new URL("../scripts/sans-reponse.sql", import.meta.url), "utf8");
// 26/10/2026 06:01 in La Réunion: the morning's recheck.
const MORNING = new Date("2026-10-26T02:01:00Z");
const T = Math.floor(MORNING.getTime() / 1000);

/** The table of scripts/sans-reponse.sql in SQLite, behind the calls the Worker gives (worker.ts). */
function database(withTable = true) {
  const db = new DatabaseSync(":memory:");
  if (withTable) db.exec(SQL);
  const writes: string[] = [];
  sr.configure(
    async (sql, ...params) => (writes.push(sql), Number(db.prepare(sql).run(...(params as never[])).changes)),
    async <R>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as never[])) as R[],
    async (statements) => {
      db.exec("BEGIN");
      for (const s of statements) {
        writes.push(s.sql);
        db.prepare(s.sql).run(...(s.params as never[]));
      }
      db.exec("COMMIT");
    },
  );
  const row = (hote: string) => db.prepare("SELECT * FROM sans_reponse WHERE hote = ?").get(hote) as Record<string, unknown> | undefined;
  return { db, writes, row };
}

/** A fetch that answers each host as told. */
const answers = (by: Record<string, () => Response | Promise<Response>>): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const host = new URL(String(input)).hostname.replace(/^www\./, "");
    const a = by[host];
    if (!a) throw new Error(`unexpected ${host}`);
    return a();
  }) as typeof fetch;
const timeout = () => {
  throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
};

afterEach(() => sr.configure());

describe("what a failed read says", () => {
  it("is the site's silence only for a server error, a timeout, a refused connection or an unknown address", () => {
    expect(sr.constatDe({ status: 503 })).toBe("http_503");
    expect(sr.constatDe({ status: 530 })).toBe("http_530");
    expect(sr.constatDe({ status: 403 })).toBe("http_403");
    expect(sr.constatDe({ message: "x: The operation was aborted due to timeout" })).toBe("delai");
    expect(sr.constatDe({ message: "x: Network connection lost." })).toBe("connexion");
    // A moved address is most often ours to fix: not written down.
    expect(sr.constatDe({ status: 404 })).toBeUndefined();
    expect(sr.constatDe({ status: 400 })).toBeUndefined();
    expect(sr.constatDe({ message: "x: Unexpected token < in JSON" })).toBeUndefined();
  });
});

describe("a failed read", () => {
  it("enters an unknown host « a_verifier » once, and writes nothing more while it is listed", async () => {
    const { writes, row } = database();
    await sr.noter("salles_spectacle", "https://www.lesechoir.com/agenda", "delai", MORNING);
    await sr.noter("salles_spectacle", "https://www.lesechoir.com/autre", "delai", MORNING);
    await sr.noter("salles_spectacle", "https://lesechoir.com/", "http_503", MORNING);
    expect(writes.filter((w) => w.startsWith("INSERT"))).toHaveLength(1);
    expect(row("lesechoir.com")).toMatchObject({ statut: "a_verifier", constat: "delai", sources: '["salles_spectacle"]' });
    // A host already listed, whatever its state but « revenu », writes nothing.
    await sr.noter("ovpf_pdf", "https://www.ipgp.fr/x.pdf", "delai", MORNING);
    expect(row("ipgp.fr")).toMatchObject({ statut: "injoignable", premier_echec: 1792526400 });
    expect(writes.filter((w) => w.startsWith("INSERT"))).toHaveLength(1);
  });

  it("brings a host that had come back to « a_verifier » again, with this failure's address", async () => {
    const { row } = database();
    await sr.noter("acspo", "https://coastwatch.noaa.gov/thredds/dodsC/x.ascii", "http_500", MORNING);
    expect(row("coastwatch.noaa.gov")).toMatchObject({ statut: "a_verifier", constat: "http_500", revenu_le: null, url: "https://coastwatch.noaa.gov/thredds/dodsC/x.ascii", premier_echec: T });
  });

  it("does nothing without the table, nor without the database", async () => {
    database(false);
    await expect(sr.noter("x", "https://exemple.re/", "delai", MORNING)).resolves.toBeUndefined();
    expect(await sr.lignes()).toEqual([]);
    expect(await sr.reverifier(MORNING, answers({}))).toBeNull();
    sr.configure();
    await expect(sr.noter("x", "https://exemple.re/", "delai", MORNING)).resolves.toBeUndefined();
  });
});

describe("the morning's recheck", () => {
  const row = (statut: sr.Statut, extra: Partial<sr.Ligne> = {}): sr.Ligne => ({
    hote: "exemple.re", url: "https://exemple.re/", nom: null, theme: null, manque: null, page: null, sources: [], statut,
    premier_echec: T - 86_400, dernier_essai: null, constat: "delai", revenu_le: null, n403: 0, verifier: null, ...extra,
  });

  it("makes a row public only after two failures, the day's and the morning's", () => {
    expect(sr.suite(row("a_verifier"), { issue: "echec", constat: "http_503" }, T)).toMatchObject({ statut: "injoignable", constat: "http_503" });
    // Never shown, it is deleted when it answers.
    expect(sr.suite(row("a_verifier"), { issue: "repond" }, T)).toBeNull();
    expect(sr.suite(row("injoignable"), { issue: "repond" }, T)).toEqual({ statut: "revenu", revenu_le: T, n403: 0, dernier_essai: T });
  });

  it("says a site « bloque » only after two 403 in a row: one at night is not enough", () => {
    const once = sr.suite(row("a_verifier"), { issue: "bloque", constat: "http_403" }, T)!;
    expect(once).toEqual({ n403: 1, dernier_essai: T });
    expect(sr.suite(row("a_verifier", { n403: 1 }), { issue: "bloque", constat: "http_403" }, T)).toMatchObject({ statut: "bloque", n403: 2 });
    // Another failure in between starts the count again.
    expect(sr.suite(row("injoignable", { n403: 1 }), { issue: "echec", constat: "delai" }, T)).toMatchObject({ statut: "injoignable", n403: 0 });
  });

  it("keeps a « bloque » site so on a timeout, and makes it « injoignable » on a server error", () => {
    expect(sr.suite(row("bloque", { constat: "http_403" }), { issue: "echec", constat: "delai" }, T)).toEqual({ statut: "bloque", n403: 0, dernier_essai: T });
    expect(sr.suite(row("bloque"), { issue: "echec", constat: "maintenance" }, T)).toMatchObject({ statut: "injoignable", constat: "maintenance" });
  });

  it("reads a maintenance page answered 200 as a failure, and checks the latest datum of an empty feed", async () => {
    const html = (s: string) => () => new Response(s, { status: 200 });
    expect(await sr.essayer({ url: "https://a.re/", verifier: null }, MORNING, answers({ "a.re": html("<title>Site en maintenance | Les Services de l'État</title>") }))).toEqual({ issue: "echec", constat: "maintenance" });
    expect(await sr.essayer({ url: "https://a.re/", verifier: null }, MORNING, answers({ "a.re": html("<title>Accueil</title>") }))).toEqual({ issue: "repond" });
    expect(await sr.essayer({ url: "https://a.re/", verifier: null }, MORNING, answers({ "a.re": () => new Response("", { status: 403 }) }))).toEqual({ issue: "bloque", constat: "http_403" });
    expect(await sr.essayer({ url: "https://a.re/", verifier: null }, MORNING, answers({ "a.re": timeout }))).toEqual({ issue: "echec", constat: "delai" });
    const verifier = { date: '"date_obs":"([^"]+)"', age_max_h: 48 };
    const feed = (d: string) => html(`{"data":[{"date_obs":"${d}"}]}`);
    expect(await sr.essayer({ url: "https://hubeau.eaufrance.fr/x", verifier }, MORNING, answers({ "hubeau.eaufrance.fr": feed("2026-10-01T00:00:00Z") }))).toEqual({ issue: "echec", constat: "flux_vide" });
    expect(await sr.essayer({ url: "https://hubeau.eaufrance.fr/x", verifier }, MORNING, answers({ "hubeau.eaufrance.fr": feed("2026-10-25T20:00:00Z") }))).toEqual({ issue: "repond" });
  });

  it("asks each row not « revenu » once, writes everything in one batch and dates the pass", async () => {
    const { db, row } = database();
    const asked: string[] = [];
    const fetcher = answers({
      "ipgp.fr": () => (asked.push("ipgp"), timeout()),
      "reunion.gouv.fr": () => (asked.push("prefecture"), new Response("<title>Site en maintenance</title>")),
      "georisques.gouv.fr": () => (asked.push("georisques"), new Response('{"data":[]}')),
      "coastwatch.pfeg.noaa.gov": () => (asked.push("modis"), new Response("", { status: 403 })),
    });
    const done = await sr.reverifier(MORNING, fetcher);
    expect(asked.sort()).toEqual(["georisques", "ipgp", "modis", "prefecture"]);
    expect(done!.essayes).toBe(4);
    expect(row("ipgp.fr")).toMatchObject({ statut: "injoignable", constat: "delai", dernier_essai: T });
    expect(row("reunion.gouv.fr")).toMatchObject({ statut: "injoignable", constat: "maintenance" });
    // It answers: never shown, deleted.
    expect(row("georisques.gouv.fr")).toBeUndefined();
    expect(row("coastwatch.pfeg.noaa.gov")).toMatchObject({ statut: "a_verifier", n403: 1 });
    // Not asked: it had come back on 25/10.
    expect(row("coastwatch.noaa.gov")).toMatchObject({ statut: "revenu" });
    expect(db.prepare("SELECT t FROM sans_reponse_passage").get()).toEqual({ t: T });
    // A week later, the row come back is gone.
    await sr.reverifier(new Date(MORNING.getTime() + 8 * 86_400_000), answers({ "ipgp.fr": timeout, "reunion.gouv.fr": timeout, "coastwatch.pfeg.noaa.gov": timeout }));
    expect(row("coastwatch.noaa.gov")).toBeUndefined();
  });

  it("never shows a host for a 403 or a 429 seen in the day: only the morning's recheck, asked alone, can", async () => {
    const { db, row } = database();
    db.prepare("DELETE FROM sans_reponse").run();
    // A run of our reads turned away by the prefecture: the host is to check, nothing more, however many times.
    for (const constat of ["http_429", "http_429", "http_403"]) await sr.noter("prefecture_communiques", "https://www.reunion.gouv.fr/Actualites", constat, MORNING);
    expect(row("reunion.gouv.fr")).toMatchObject({ statut: "a_verifier", n403: 0 });
    expect(sr.publiques(await sr.lignes())).toEqual([]);
    // A host already listed keeps its state.
    db.prepare("INSERT INTO sans_reponse (hote, url, statut, premier_echec, constat) VALUES ('ipgp.fr', 'https://www.ipgp.fr/', 'injoignable', ?, 'delai')").run(T - 86_400);
    await sr.noter("ovpf_pdf", "https://www.ipgp.fr/x.pdf", "http_429", MORNING);
    expect(row("ipgp.fr")).toMatchObject({ statut: "injoignable", constat: "delai" });

    // The morning: this isolate read the prefecture a moment ago, the recheck waits a minute after that read.
    vi.useFakeTimers({ toFake: ["Date"], now: MORNING });
    try {
      const waits: number[] = [];
      const attendre = async (ms: number) => void (waits.push(ms), vi.setSystemTime(Date.now() + ms));
      const asked: number[] = [];
      const fetcher = answers({
        "reunion.gouv.fr": () => (asked.push(Date.now()), new Response("", { status: 429 })),
        "ipgp.fr": () => new Response("<title>Accueil</title>"),
      });
      sr.lu("https://www.reunion.gouv.fr/Actualites", Date.now() - 10_000);
      await sr.reverifier(MORNING, fetcher, attendre);
      expect(waits).toEqual([50_000]);
      expect(asked).toEqual([MORNING.getTime() + 50_000]);
      // One 429 in the morning is not enough either.
      expect(row("reunion.gouv.fr")).toMatchObject({ statut: "a_verifier", n403: 1 });
      // A host this isolate never leaves alone is not asked: left for the next morning, unchanged.
      asked.length = 0;
      const busy = async (ms: number) => void (vi.setSystemTime(Date.now() + ms), sr.lu("https://www.reunion.gouv.fr/", Date.now()));
      sr.lu("https://www.reunion.gouv.fr/", Date.now());
      await sr.reverifier(MORNING, fetcher, busy);
      expect(asked).toEqual([]);
      expect(row("reunion.gouv.fr")).toMatchObject({ statut: "a_verifier", n403: 1 });
    } finally {
      sr.lu("https://www.reunion.gouv.fr/", 0);
      vi.useRealTimers();
    }
  });

  it("runs at 06:00 in La Réunion only", () => {
    expect(sr.heureDuPassage(new Date("2026-10-26T02:00:00Z"))).toBe(true);
    expect(sr.heureDuPassage(new Date("2026-10-26T02:05:00Z"))).toBe(false);
    expect(sr.heureDuPassage(new Date("2026-10-26T06:00:00Z"))).toBe(false);
  });
});

describe("what is shown", () => {
  let rows: sr.Ligne[];
  beforeEach(async () => {
    database();
    rows = await sr.lignes();
  });

  it("is only what a recheck confirmed, and nothing of a commune that has not agreed to its reuse", () => {
    const saintJoseph: sr.Ligne = { ...rows[0], hote: "saintjoseph.re", url: "https://saintjoseph.re/spip.php", nom: null, sources: ["actus_saint_joseph"], statut: "bloque" };
    const shown = sr.publiques([...rows, saintJoseph]).map((l) => l.hote);
    expect(shown).toEqual(["ipgp.fr", "coastwatch.noaa.gov"]);
  });

  it("names a row without its editor from its sources", () => {
    sr.inscrire([{ id: "salles_spectacle", nom: "Programmes des salles de spectacle", organisme: "Salles de spectacle de La Réunion", licence: "", attribution: "", url: "" }]);
    const [l] = sr.publiques([{ ...rows[0], hote: "teat.re", nom: null, manque: null, theme: null, sources: ["salles_spectacle"], statut: "injoignable" }]);
    expect(l).toMatchObject({ nom: "Salles de spectacle de La Réunion", manque: "Programmes des salles de spectacle", theme: "Autres sites" });
  });

  it("says it on the page in marketing's words, never down, closed, empty or refusing", () => {
    const page = typo(sansReponsePage("https://rundata.re", rows, T));
    expect(page).toContain("<title>Sites publics de La Réunion sans réponse · rundata.re</title>");
    expect(page).toContain("<h1>Sites publics sans réponse</h1>");
    expect(page).toContain("Chaque site est revérifié chaque jour et quitte la liste dès qu'il répond.");
    expect(page).toContain('<a href="https://www.ipgp.fr/" rel="nofollow noopener">le site de l&#39;OVPF-IPGP</a> : sans réponse depuis le 21/10');
    expect(page).toContain('ce qui manque ici : <a href="/volcan">les bulletins et communiqués de l&#39;OVPF sur le Piton de la Fournaise</a>');
    expect(page).toContain('<h2 id="sans-reponse">Sans réponse</h2>');
    expect(page).toContain('<h2 id="repondent-de-nouveau">Répondent de nouveau</h2>');
    expect(page).toContain("répond de nouveau depuis le 25/10");
    expect(page).toContain("Une donnée publique déposée en fichier ouvert sur data.gouv.fr reste lisible même quand le site de son éditeur ne répond pas.");
    expect(page).toContain("Revérifié chaque jour, dernier passage le 26/10 à 06:01. Un site de cette liste répond pour vous ? Écrivez-nous : <a href=\"mailto:contact@rundata.re\">contact@rundata.re</a>");
    // The rows still to check are not there.
    expect(page).not.toContain("georisques");
    const own = page.slice(page.indexOf('<div class="band">'), page.indexOf("</main>"));
    expect(own).not.toMatch(/en panne|hors ligne|hors service|ferm[ée]|\bvide\b|refus|ne publie pas|piraté/i);
  });

  it("says when no site is listed, with the date of the last pass when there was one", () => {
    expect(typo(sansReponsePage("https://rundata.re", [], T))).toContain("<p>Aucun site public sans réponse à la revérification du 26/10.</p>");
    expect(typo(sansReponsePage("https://rundata.re", [], undefined))).toContain("<p>Aucun site public sans réponse pour l'instant.</p>");
  });

  it("gives another answer one host's state as the page shows it, none for a host still to check", async () => {
    expect(await sr.etatHote(new Cache(), "www.ipgp.fr")).toMatchObject({ hote: "ipgp.fr", statut: "injoignable", premier_echec: 1792526400, nom: "l'OVPF-IPGP" });
    expect(await sr.etatHote(new Cache(), "coastwatch.noaa.gov")).toMatchObject({ statut: "revenu" });
    expect(await sr.etatHote(new Cache(), "coastwatch.pfeg.noaa.gov")).toBeUndefined();
    expect(await sr.etatHote(new Cache(), "inconnu.re")).toBeUndefined();
  });

  it("answers the tool with the whole list, or the sites a word names", async () => {
    const all = JSON.parse((await sitesSansReponse(new Cache(), undefined, MORNING)).content[0].text);
    expect(all.resume).toBe("1 site public sans réponse ce 26/10, revérifié chaque jour\u00a0; le plus ancien depuis le 21/10 (le site de l'OVPF-IPGP).");
    expect(all.sites[0]).toEqual({ site: "le site de l'OVPF-IPGP", statut: "sans réponse", depuis: "21/10", constat: "pas de réponse dans le délai", manque_ici: "les bulletins et communiqués de l'OVPF sur le Piton de la Fournaise", lien: "https://www.ipgp.fr/" });
    expect(all.sites[1]).toMatchObject({ site: "le site de NOAA CoastWatch", statut: "répond de nouveau", depuis: "25/10" });
    expect(all.page).toBe("https://rundata.re/sites-sans-reponse");
    const volcan = JSON.parse((await sitesSansReponse(new Cache(), "volcan", MORNING)).content[0].text);
    expect(volcan.sites.map((s: { site: string }) => s.site)).toEqual(["le site de l'OVPF-IPGP"]);
    const eau = JSON.parse((await sitesSansReponse(new Cache(), "eau", MORNING)).content[0].text);
    expect(eau.resume).toBe("Aucun site public sans réponse ce 26/10 pour « eau », d'après la revérification quotidienne.");
  });
});
