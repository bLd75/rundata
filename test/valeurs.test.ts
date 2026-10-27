import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { reprise } from "../src/web/ouvrir-donnees.js";
import { DESCRIPTION_MAX, GITHUB } from "../src/web/pages.js";

const BROWSER = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const get = (path: string) => new Request(`https://rundata.re${path}`, { headers: { accept: BROWSER } });
const text = async (path: string) => (await handle(get(path), new Cache())).text();

// « Nos valeurs » (26/10/2026): what an information closed in a social network costs, then what rundata.re
// does instead, each sentence backed by a page of the site.
describe("/valeurs, what rundata.re stands for", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline"); // nothing of this page is read from a source
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("welcomes contributions after the open code, on /valeurs and /a-propos, GitHub linked without its address shown", async () => {
    const welcome = `Les contributions sont les bienvenues. Vous aimez les données, le code ou La Réunion, et vous voulez faire avancer le numérique de l'île\u00a0? Proposez une source, une correction ou une amélioration sur <a href="${GITHUB}">GitHub</a>, ou écrivez à <a href="mailto:contact@rundata.re">contact@rundata.re</a>. Chaque proposition est relue avant d'être mise en ligne.`;
    const valeurs = await text("/valeurs");
    expect(valeurs).toContain(`<a href="${GITHUB}">Le code sur GitHub</a></p>\n  <p>${welcome}</p>`);
    expect(await text("/a-propos")).toContain(`Son code est libre (licence MIT). ${welcome} Les sources`);
  });

  it("has its title, its crumb, a short description and its sections", async () => {
    for (const path of ["/valeurs", "/valeurs/"]) expect((await handle(get(path), new Cache())).status).toBe(200);
    const page = await text("/valeurs");
    expect(page).toContain("<title>Nos valeurs · rundata.re</title>");
    expect(page).toContain("<h1>Nos valeurs</h1>");
    const description = page.match(/<meta name="description" content="([^"]*)"/)![1];
    expect(description).toBe("rundata.re rassemble les données publiques de La Réunion, sans compte ni publicité, avec un code ouvert. Ce qui est fermé, on ne le contourne pas\u00a0: on le dit.");
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(page).toContain(`<meta property="og:description" content="${description}">`);
    expect(page).toContain('"name":"Nos valeurs"');
    for (const id of ["enfermee", "habitudes", "sans-compte", "code", "donnees", "ferme", "reseaux-sociaux"]) expect(page).toContain(`<h2 id="${id}">`);
    expect(page).toContain("98,7\u00a0% des vues de posts sur Facebook");
  });

  it("links each claim to where the site or its source shows it", async () => {
    const page = await text("/valeurs");
    for (const href of [GITHUB, "/conditions#reutiliser", "/mcp", "/sites-sans-reponse", "/ouvrir-ses-donnees", "https://about.fb.com/news/2022/03/new-tools-for-facebook-group-admins/", "https://www.socialmediatoday.com/news/facebook-pages-get-charged-for-link-posts/830743/", "https://developers.facebook.com/docs/graph-api/changelog/version19.0/"]) {
      expect(page).toContain(`href="${href}"`);
    }
    expect(await text("/conditions")).toContain('<h2 id="reutiliser">Réutiliser les données</h2>');
  });

  it("is linked from the footer, next to the code, from /a-propos and from the sitemap", async () => {
    expect(await text("/")).toContain(`<a href="${GITHUB}">code libre (MIT)</a> · <a href="/valeurs">nos valeurs</a>`);
    expect(await text("/a-propos")).toContain('Voir aussi\u00a0: <a href="/valeurs">nos valeurs</a>,');
    expect(await text("/sitemap.xml")).toContain("<loc>https://rundata.re/valeurs</loc><changefreq>monthly</changefreq>");
  });
});

// The guide to publishing one's information openly (26/10/2026): its page, the links to it, and the link after the
// notices of a site whose terms forbid reuse, on the pages only.
describe("/ouvrir-ses-donnees, the guide to making one's information reusable", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("has its title, its crumb, a short description and its eight parts", async () => {
    for (const path of ["/ouvrir-ses-donnees", "/ouvrir-ses-donnees/"]) expect((await handle(get(path), new Cache())).status).toBe(200);
    const page = await text("/ouvrir-ses-donnees");
    expect(page).toContain("<title>Rendre ses données accessibles · rundata.re</title>");
    expect(page).toContain("<h1>Rendre ses données accessibles, à moindre coût et en toute sécurité</h1>");
    expect(page).toContain('"name":"Rendre ses données accessibles"');
    const description = page.match(/<meta name="description" content="([^"]*)"/)![1];
    expect(description).toBe("Mairie, association, salle, club\u00a0: comment publier vos informations pour que chacun puisse les lire et les reprendre, souvent sans frais et en sécurité.");
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    for (const id of ["pourquoi", "texte", "flux", "fichier", "licence", "site-d-abord", "securite", "loi", "rundata"]) expect(page).toContain(`<h2 id="${id}">`);
    // The secret address of a calendar is named, never asked for.
    expect(page).toContain("L'«\u00a0Adresse secrète au format iCal\u00a0», elle, ne se donne jamais");
    expect(page).toContain('<a href="mailto:contact@rundata.re">contact@rundata.re</a>');
  });

  it("is linked from the footer, /a-propos, /valeurs, /sites-sans-reponse and the sitemap", async () => {
    expect(await text("/")).toContain('<a href="/valeurs">nos valeurs</a> · <a href="/ouvrir-ses-donnees">ouvrir ses données</a> · ');
    expect(await text("/a-propos")).toContain('<a href="/valeurs">nos valeurs</a>, <a href="/ouvrir-ses-donnees">rendre ses données accessibles</a>, ');
    expect((await text("/valeurs")).split("<footer")[0].match(/href="\/ouvrir-ses-donnees"/g)).toHaveLength(2);
    expect(await text("/sites-sans-reponse")).toContain('Et pour rendre ses informations faciles à reprendre\u00a0: <a href="/ouvrir-ses-donnees">notre guide</a>.</p>');
    expect(await text("/sitemap.xml")).toContain("<loc>https://rundata.re/ouvrir-ses-donnees</loc><changefreq>monthly</changefreq>");
  });

  it("is linked after a notice that a site's terms forbid reuse, not after a refusal, on the pages and not in the tools", async () => {
    const link = ' <a href="/ouvrir-ses-donnees#licence">Comment permettre la reprise</a>';
    expect(reprise("Les mentions légales du site de la commune du Tampon interdisent d'en reprendre le contenu sans son accord : …")).toBe(link);
    expect(reprise("Agenda du site de la commune non repris : ses mentions légales l'interdisent sans son accord.")).toBe(link);
    expect(reprise("La commune du Tampon a refusé que rundata.re reprenne le contenu de son site : …")).toBe("");
    // reunion.fr's agenda, under the sources of /evenements.
    expect(await text("/evenements")).toMatch(/Son agenda sur reunion\.fr ↗<\/a>\u00a0·\u00a0<a href="\/ouvrir-ses-donnees#licence">Comment permettre la reprise<\/a><\/p>/);
    // The tools' answers say the notice alone: nothing under src/tools/ reaches the guide's link.
    const tools = new URL("../src/tools/", import.meta.url);
    for (const f of readdirSync(tools).filter((x) => x.endsWith(".ts"))) expect(readFileSync(new URL(f, tools), "utf8"), f).not.toMatch(/ouvrir-donnees|Comment permettre la reprise/);
  });
});
