import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { DESCRIPTION_MAX } from "../src/web/pages.js";
import { SECTIONS } from "../src/web/pwa.js";

const BROWSER = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const get = (path: string) => new Request(`https://rundata.re${path}`, { headers: { accept: BROWSER } });
const text = async (path: string) => (await handle(get(path), new Cache())).text();

// /application (27/10/2026): the steps of every browser to put the site on the home screen, marketing's words.
describe("/application, rundata.re on the home screen", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline"); // nothing of this page is read from a source
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("has its title, its heading, its lead and a short description", async () => {
    for (const path of ["/application", "/application/"]) expect((await handle(get(path), new Cache())).status).toBe(200);
    const page = await text("/application");
    expect(page).toContain("<title>rundata.re sur l&#39;écran d&#39;accueil, comme une application · 974</title>");
    expect(page).toContain("<h1>rundata.re sur votre écran d'accueil</h1>");
    expect(page).toContain("Une icône sur votre téléphone, et la météo, la vigilance ou le volcan s'ouvrent d'un geste, comme une application.");
    expect(page).toContain("Pas de store, pas de compte : c'est le site lui-même.");
    const description = page.match(/<meta name="description" content="([^"]*)"/)![1].replace(/&#39;/g, "'");
    expect(description).toBe("Ajoutez rundata.re à l'écran d'accueil\u00a0: les étapes pour Safari, Chrome, Firefox, Edge et Samsung Internet, sur téléphone ou ordinateur. Sans store ni compte.");
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(page).toContain('"name":"rundata.re sur votre écran d\'accueil"');
  });

  it("gives every browser's steps under its heading, the visitor's opened first by the script", async () => {
    const page = await text("/application");
    for (const s of SECTIONS) expect(page).toContain(`<details class="card app-nav" id="${s.id}"><summary><h2>${s.nom}</h2></summary>\n    ${(s.html ?? "").slice(0, 40)}`);
    const ids = [...page.matchAll(/<details class="card app-nav" id="([^"]+)">/g)].map((m) => m[1]);
    expect(ids).toEqual(["iphone-safari", "ipad-safari", "iphone-chrome", "iphone-firefox", "iphone-autre", "application", "android", "android-firefox", "android-autre", "ordinateur", "mac-safari"]);
    expect(page).toContain('<details class="card app-nav" id="mac-safari"><summary><h2>Mac\u00a0: Safari, macOS Sonoma 14 et après</h2></summary>');
    expect(page).toContain("Pas de bouton\u00a0? Dans Chrome, touchez ⋮, à droite de la barre d'adresse, puis «\u00a0Installer et créer un raccourci\u00a0», puis «\u00a0Installer\u00a0».");
    expect(page).toContain("«\u00a0Installez ce site en tant qu'application\u00a0»");
    expect(page).toContain("<p>Selon la version de Firefox, l'option peut être ailleurs dans le menu.</p>");
    expect(page).toContain('<p><button type="button" class="go app-go" hidden>Installer</button></p>');
    expect(page).toContain("Déjà fait\u00a0? L'icône rundata.re ouvre le site comme une application. Pour la retirer, faites un appui long sur l'icône, puis supprimez-la comme une autre application.");
    expect(page).toContain("const kindOf=(ua,touch)=>");
    expect(page).toContain("d.open=true;d.parentNode.prepend(d)");
    // The install block below would repeat the steps, its link pointing to this page: only the sharing stays.
    expect(page).not.toContain('id="inst"');
    expect(page).toContain('<aside class="share wrap" aria-label="Partager et suivre">');
    expect(page).toContain(`<p id="deja" hidden>rundata.re est déjà sur votre écran d'accueil.</p>`);
  });

  it("is linked from the install block, the menu and the footer of every page, and listed in the sitemap", async () => {
    const page = await text("/valeurs");
    expect(page).toContain(`<a href="/application">Autre téléphone ou autre navigateur : les étapes pour chacun →</a>`);
    expect(page).toContain(`<p class="sheet-h">Sur votre téléphone</p>\n      <p><a class="sheet-app" href="/application">Mettre rundata.re sur l'écran d'accueil →</a></p>`);
    expect(page).toContain(`<a href="/valeurs">nos valeurs</a> · <a href="/application">sur votre écran d'accueil</a> · `);
    expect(await text("/sitemap.xml")).toContain("<loc>https://rundata.re/application</loc>");
  });
});
