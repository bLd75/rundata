import { describe, expect, it } from "vitest";
import { configurerEquipe, handle, JETON_EQUIPE } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { point, type Hit } from "../src/metrics.js";
import { connecteurPage } from "../src/web/connecteur.js";
import { CSS, legalPage } from "../src/web/pages.js";
import { lire, SIGNAL_SCRIPT, VENU } from "../src/web/signaux.js";

const O = "https://rundata.re";
const BROWSER = {
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  "accept-language": "fr-FR,fr;q=0.9",
  "sec-fetch-mode": "no-cors",
  "sec-fetch-site": "same-origin",
  origin: O,
};

const beacon = (body: string, headers: Record<string, string> = BROWSER, method = "POST") =>
  new Request(`${O}/signal`, { method, headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", ...headers }, body: method === "POST" ? body : undefined });

async function hitsOf(request: Request): Promise<{ hits: Hit[]; response: Response }> {
  const hits: Hit[] = [];
  const response = await handle(request, new Cache(), () => {}, (h) => hits.push(h));
  return { hits, response };
}

// The page's own function, as the browser runs it.
const venu = new Function(`${VENU}return venu;`)() as (m: unknown, j: string) => [string, { p: string; d: string }];

describe("What a page's browser tells, as read", () => {
  it("reads the four events, with their page and value", () => {
    expect(lire("e=a&v=&p=%2Fmeteo&t=412&l=1830")).toEqual({ event: "affichage", path: "/meteo", value: "", ttfb: 412, lcp: 1830 });
    expect(lire("e=c&v=&p=%2Fmcp")).toEqual({ event: "adresse copiée", path: "/mcp", value: "" });
    expect(lire("e=o&v=non&p=%2Fsentiers")).toEqual({ event: "aide", path: "/sentiers", value: "non" });
    expect(lire("e=r&v=l&p=%2F")).toEqual({ event: "retour", path: "/", value: "lendemain" });
    expect(["p", "j", "l", "s", "t"].map((v) => lire(`e=r&v=${v}&p=%2F`)?.value)).toEqual(["première", "même jour", "lendemain", "dans la semaine", "plus tard"]);
  });

  it("keeps nothing it does not know: no other event, value, page or time", () => {
    expect(lire("e=x&v=&p=%2F")).toBeUndefined();
    expect(lire("e=o&v=peut-etre&p=%2F")).toBeUndefined();
    expect(lire("e=r&v=2026-10-20&p=%2F")).toBeUndefined();
    expect(lire("e=a&v=quelque+chose&p=%2F")).toBeUndefined();
    expect(lire("e=o&v=oui&p=https%3A%2F%2Fexample.org%2F")).toBeUndefined();
    expect(lire("e=o&v=oui&p=%2F%2Fexample.org")).toBeUndefined();
    // The connector's address counts on its page only.
    expect(lire("e=c&v=&p=%2F")).toBeUndefined();
    // A time that is not one is left out, the rest kept.
    expect(lire("e=a&v=&p=%2F&t=-3&l=9999999")).toEqual({ event: "affichage", path: "/", value: "", ttfb: undefined, lcp: undefined });
  });
});

describe("POST /signal, as recorded", () => {
  it("records one signal point for a page of the site, never a page view", async () => {
    const { hits, response } = await hitsOf(beacon("e=o&v=oui&p=%2Fmeteo"));
    expect(response.status).toBe(204);
    expect(hits).toEqual([{ kind: "signal", name: "/meteo", detail: "aide", value: "oui", ok: true, ms: undefined, lcp: undefined }]);
    const shown = await hitsOf(beacon("e=a&v=&p=%2Fmeteo&t=380&l=1200"));
    expect(shown.hits[0]).toMatchObject({ kind: "signal", detail: "affichage", ms: 380, lcp: 1200 });
  });

  it("writes « interne » the signals of a device of the team, as its pages are", async () => {
    expect(lire("e=o&v=oui&p=%2F&i=1")).toEqual({ event: "aide", path: "/", value: "oui", team: true });
    expect(lire("e=o&v=oui&p=%2F&i=0")).toEqual({ event: "aide", path: "/", value: "oui" });
    const { hits } = await hitsOf(beacon("e=r&v=l&p=%2Fmeteo&i=1"));
    expect(hits).toEqual([{ kind: "signal", name: "/meteo", detail: "retour", value: "lendemain", ok: true, ms: undefined, lcp: undefined, team: true }]);
    const p = point(hits[0], { who: "navigateur", country: "RE", from: "", audience: "humain", language: "fr", device: "mobile" });
    expect([p.blobs[3], p.blobs[8]]).toEqual(["interne", "interne"]);
    // The page knows it by the mark of web/pwa.ts, set before its signals.
    const html = legalPage(O, "confidentialite");
    expect(SIGNAL_SCRIPT).toContain('...(typeof team!=="undefined"&&team?{i:"1"}:{})');
    expect(html.indexOf("let team=false")).toBeGreaterThan(0);
    expect(html.indexOf("let team=false")).toBeLessThan(html.indexOf("const sig="));
  });

  it("records nothing from another site, a script of the team, a body too long or a GET", async () => {
    const other = await hitsOf(beacon("e=o&v=oui&p=%2F", { ...BROWSER, "sec-fetch-site": "cross-site", origin: "https://example.org" }));
    expect(other.response.status).toBe(204);
    expect(other.hits).toEqual([]);
    expect((await hitsOf(beacon("e=o&v=oui&p=%2F", { ...BROWSER, "sec-fetch-site": "same-origin", origin: "https://example.org" }))).hits).toEqual([]);
    // The team is known by its secret, not by its User-Agent (src/app.ts).
    configurerEquipe("secret-de-test-equipe");
    try {
      expect((await hitsOf(beacon("e=o&v=oui&p=%2F", { ...BROWSER, [JETON_EQUIPE]: "secret-de-test-equipe" }))).hits).toEqual([]);
      expect((await hitsOf(beacon("e=o&v=oui&p=%2F", { ...BROWSER, "user-agent": "rundata-check/dev5" }))).hits).toHaveLength(1);
    } finally {
      configurerEquipe(undefined);
    }
    expect((await hitsOf(beacon(`e=o&v=oui&p=%2F${"a".repeat(400)}`))).hits).toEqual([]);
    const get = await hitsOf(beacon("", BROWSER, "GET"));
    expect(get.response.status).toBe(405);
    expect(get.hits).toEqual([]);
  });

  it("writes a signal as a page, with its event, its value and its times, and no referring site", () => {
    const p = point({ kind: "signal", name: "/meteo", detail: "affichage", value: "", ok: true, ms: 380, lcp: 1200 }, { who: "navigateur", country: "RE", from: "interne", audience: "humain", language: "fr", device: "mobile" });
    expect(p.indexes).toEqual(["signal"]);
    expect(p.blobs.slice(0, 12)).toEqual(["signal", "/meteo", "affichage", "navigateur", "RE", "", "meteo", "fr", "humain", "", "", "mobile"]);
    expect(p.doubles).toEqual([1, 380, 0, 0, 0, 1200]);
    const r = point({ kind: "signal", name: "/", detail: "retour", value: "dans la semaine", ok: true }, { who: "navigateur", country: "RE", from: "", audience: "humain", language: "fr" });
    expect(r.blobs[2]).toBe("retour");
    expect(r.blobs[9]).toBe("dans la semaine");
  });
});

describe("The class of a visit, from the two days kept", () => {
  const today = "2026-10-27";
  it("tells the first visit, the same day, the next day, the week and later", () => {
    expect(venu(null, today)).toEqual(["p", { p: today, d: today }]);
    expect(venu({ p: "2026-09-01", d: today }, today)).toEqual(["j", { p: "2026-09-01", d: today }]);
    expect(venu({ p: "2026-09-01", d: "2026-10-26" }, today)).toEqual(["l", { p: "2026-09-01", d: today }]);
    expect(venu({ p: "2026-09-01", d: "2026-10-25" }, today)[0]).toBe("s");
    expect(venu({ p: "2026-09-01", d: "2026-10-20" }, today)[0]).toBe("s");
    expect(venu({ p: "2026-09-01", d: "2026-10-19" }, today)[0]).toBe("t");
  });

  it("never extends the mark: 13 months after the first visit, all is wiped and the visit is the first", () => {
    // The first visit's day is kept as it was, whatever the visits since.
    expect(venu({ p: "2025-09-28", d: "2026-10-26" }, today)).toEqual(["l", { p: "2025-09-28", d: today }]);
    expect(venu({ p: "2025-09-27", d: "2026-10-26" }, today)).toEqual(["p", { p: today, d: today }]);
    expect(venu({ p: "2024-01-01", d: "2026-10-26" }, today)).toEqual(["p", { p: today, d: today }]);
  });

  it("starts again from a mark it cannot read, or from a day after today", () => {
    for (const m of [{}, "x", 42, { p: "hier", d: today }, { p: "2026-10-01" }, { p: "2026-10-01", d: "2026-11-02" }]) {
      expect(venu(m, today)).toEqual(["p", { p: today, d: today }]);
    }
  });
});

describe("The pages' part", () => {
  it("asks « Cette page vous a aidé ? » just above the feedback form, only with a script", () => {
    const html = legalPage(O, "confidentialite");
    const at = html.indexOf('<aside class="aide wrap"');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(html.indexOf('id="avis"'));
    expect(html).toContain('data-js hidden>\n<p class="q">Cette page vous a aidé ? <button type="button" data-aide="oui">Oui</button> <button type="button" data-aide="non">Non</button></p>');
    expect(html).toContain('<p data-apres="oui" role="status" hidden>Merci !</p>');
    expect(html).toContain('<p data-apres="non" role="status" hidden>Merci. Dites-nous ce qui vous a manqué : <a href="#avis">laisser un avis</a></p>');
    // The paragraphs' display must not show the hidden answers with the question (seen on phones, 29/10/2026).
    expect(CSS).toContain(".aide [hidden]{display:none}");
  });

  it("sends by beacon to this site, and keeps in the browser only the two days of the visits", () => {
    expect(SIGNAL_SCRIPT).toContain('navigator.sendBeacon("/signal"');
    expect(SIGNAL_SCRIPT.match(/localStorage\.setItem\(/g)).toHaveLength(1);
    expect(SIGNAL_SCRIPT).toContain('localStorage.setItem("venu",JSON.stringify(n));sig("r",c)');
    expect(SIGNAL_SCRIPT).not.toMatch(/sessionStorage|document\.cookie/);
  });

  it("marks the connector's copy buttons, counted on /mcp", () => {
    expect(connecteurPage(O)).toContain('data-copy="mcp-url" data-signal aria-label="Copier l\'adresse du connecteur"');
  });

  it("says on /confidentialite what is sent and what the browser keeps", () => {
    const html = legalPage(O, "confidentialite");
    expect(html).toContain("Le site ne pose aucun cookie et ne contient aucun traceur publicitaire. Dans votre navigateur, sans cookie, le site garde la date de votre première et de votre dernière visite, pour savoir s'il sert d'un jour à l'autre\u00a0; il n'en envoie qu'une catégorie (voir <a href=\"#retours\">«\u00a0Les retours\u00a0»</a>).");
    expect(html).not.toContain("Seule la vérification anti-robot");
    expect(html).toContain("La page envoie aussi, sans identifiant, le temps qu'elle a mis à s'afficher sur votre appareil ; sur la page du connecteur, le fait que son adresse a été copiée ; et votre réponse au bouton « Cette page vous a aidé ? » (la page, et oui ou non). Ces statistiques sont gardées par Cloudflare");
    expect(html).toContain('<p id="retours">Les retours. Pour savoir si le site sert d\'un jour à l\'autre, votre navigateur garde deux dates :');
    // What venu() does: past 13 months, wiped at the next visit, before anything is sent (« première »).
    expect(html).toContain("Passé 13 mois après votre première visite, il est effacé dès votre visite suivante, avant tout envoi\u00a0; il n'est jamais prolongé. Sans nouvelle visite, il reste sur votre appareil, sans être lu ni envoyé.");
    expect(html).toContain('(« Cookies : solutions pour les outils de mesure d\'audience », <a href="https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies-solutions-pour-les-outils-de-mesure-daudience">cnil.fr</a>).</p>');
  });

  it("says on /confidentialite what Cloudflare Web Analytics measures, after our own statistics", () => {
    const html = legalPage(O, "confidentialite");
    expect(html).toContain("Une mesure de Cloudflare, sans cookie, compte aussi les pages vues et leur vitesse d'affichage (voir <a href=\"#mesure-cloudflare\">«\u00a0La mesure de Cloudflare\u00a0»</a>). Rien n'est vendu");
    expect(html).toContain("trois mois au plus.</p>\n  <p id=\"mesure-cloudflare\">La mesure de Cloudflare. Chaque page charge aussi un petit script de Cloudflare Web Analytics");
    expect(html).toContain("Comme pour toute page, Cloudflare reçoit votre adresse IP\u00a0; selon sa documentation, il ne s'en sert pas, ni d'aucune autre donnée, pour suivre les visiteurs dans le temps ou d'un site à l'autre.");
    expect(html).toContain("Cloudflare garde chaque mesure 7 jours, puis un échantillon d'environ un dixième, que nous pouvons consulter pendant six mois.");
    expect(html).toContain("Mise à jour\u00a0: 28 octobre 2026.");
  });
});
