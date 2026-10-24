import { describe, expect, it } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { weekendPage } from "../src/web/evenements.js";
import { DESCRIPTION_MAX } from "../src/web/pages.js";
import { ETATS, MAILTO, META, publierPage, render, TITLE } from "../src/web/publier.js";
import { GUIDE } from "../src/web/publier-texte.js";

const html = () => publierPage("https://rundata.re");

describe("the guide for those who publish (/publier)", () => {
  it("has marketing's title, description and heading", () => {
    const page = html();
    expect(page).toContain(`<title>${TITLE}</title>`);
    expect(page).toContain("<h1>Publiez votre agenda et vos données : le guide</h1>");
    expect(page.match(/<p class="slogan" lang="rcf">Ou organiz in kabar, in fèt, in marsé \? Mèt ali dann lagenda, tout domoun i trouv !<\/p>/g)).toHaveLength(1);
    expect(META.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(META).toBe("Mairies, associations, organisateurs : publiez votre agenda en flux ouvert, gratuitement, avec nos tutos pas à pas. Google, assistants IA, rundata.re.");
  });

  it("gives every section and tutorial its anchor, and every link inside the page lands on one", () => {
    const page = html();
    const ids = new Set([...page.matchAll(/ id="([a-z0-9-]+)"/g)].map((m) => m[1]));
    for (const id of ["pourquoi", "niveaux", "google-agenda", "outlook-nextcloud", "openagenda", "bien-remplir", "the-events-calendar", "rss", "tableur-csv", "data-gouv", "schema-org", "licence", "donnees-personnelles", "referencer", "exemples", "glossaire"]) expect(ids).toContain(id);
    for (const [, id] of page.matchAll(/href="#([a-z0-9-]+)"/g)) expect(ids, id).toContain(id);
    // The table of the levels leads to each tutorial.
    expect(page).toContain('<a href="#google-agenda">1 · Agenda Google public</a>');
  });

  it("says what rundata.re reads, from the code: iCalendar only « bientôt » until its reader is live", () => {
    const page = html();
    expect(ETATS.ics).toBe("bientot");
    expect(page.match(/Bientôt lu par rundata\.re/g)).toHaveLength(2);
    expect(page.match(/Déjà lu par rundata\.re/g)).toHaveLength(3);
    expect(page.match(/>Sur demande : écrivez-nous</g)).toHaveLength(3);
    expect(page).toContain(`<a class="etat demande" href="${MAILTO}">`);
    expect(MAILTO).toBe("mailto:contact@rundata.re?subject=Flux%20%C3%A0%20r%C3%A9f%C3%A9rencer");
    expect(page).not.toMatch(/\{\{|\*\*|\]\(/);
  });

  it("reads the guide's Markdown: lists that go on after a paragraph, a list in a list, the code, the callout", () => {
    expect(render("1. un\n2. deux\n\nÀ savoir.\n\n3. trois")).toBe("<ol><li>un</li><li>deux</li></ol>\n<p>À savoir.</p>\n<ol start=\"3\"><li>trois</li></ol>");
    expect(render("2. Deux possibilités :\n   - **la première** ;\n   - la seconde.")).toBe('<ol start="2"><li>Deux possibilités :<ul><li><strong>la première</strong> ;</li><li>la seconde.</li></ul></li></ol>');
    expect(render("```html\n<script>\n```")).toBe("<pre><code>&lt;script&gt;</code></pre>");
    expect(render("> **Titre.**\n> Texte.")).toBe('<div class="card callout"><p><strong>Titre.</strong></p>\n<p>Texte.</p></div>');
    // The Creole line is in the intro only, once.
    expect(GUIDE).not.toContain("lagenda");
  });

  it("is served with its CSV template, in the sitemap, and linked from the footer and the agenda", async () => {
    const cache = new Cache();
    const r = await handle(new Request("https://rundata.re/publier", { headers: { accept: "text/html" } }), cache);
    expect(r.status).toBe(200);
    const page = await r.text();
    expect(page).toContain('<a href="/publier">publier vos données</a>');
    const csv = await handle(new Request("https://rundata.re/publier/modele-agenda.csv"), cache);
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect((await csv.text()).split("\n")[0]).toBe("titre,date_debut,heure_debut,date_fin,heure_fin,lieu,adresse,commune,description,prix,lien,organisateur,contact_public");
    expect(page).toContain('href="/publier/modele-agenda.csv"');
    expect(await (await handle(new Request("https://rundata.re/sitemap.xml"), cache)).text()).toContain("<loc>https://rundata.re/publier</loc>");
    expect(weekendPage("https://rundata.re", null)).toContain('<a href="/publier">');
  });
});
