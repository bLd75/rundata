/**
 * Météo-France's official map of the vigilance on /vigilance (providers/vigilance-carte.ts): the picture of page 1 of
 * its bulletin, whole, with Météo-France's caption and the link to its site; the bulletin in PDF as it was issued; and
 * the page that draws page 1 for Cloudflare's browser only. Marketing's words of 27/10/2026
 * (marketing/mf-cartes-officielles-mots.md); the picture is never in the og:image nor on the home page.
 */
import * as carte from "../providers/vigilance-carte.js";
import * as mf from "../providers/vigilance.js";
import { localTime } from "../geo.js";
import { esc } from "./map.js";
import { officielHtml } from "./pages.js";

/** « le 27/10 à 16:00 ». */
const leA = (iso: string) => {
  const [day, time] = localTime(new Date(iso)).split(" ");
  return `le ${day} à ${time}`;
};
/** « 17:30 » the same day as `now`, « le 26/10 à 22:10 » another day. */
const aOuLe = (iso: string, now: Date) => {
  const [day, time] = localTime(new Date(iso)).split(" ");
  return day === localTime(now).split(" ")[0] ? `à ${time}` : leA(iso);
};

const pdfLink = (b: NonNullable<carte.Carte["bulletin"]>) =>
  `<p class="note"><a href="${carte.pdfPath(b.empreinte)}" type="application/pdf">Le bulletin complet de Météo-France en PDF, émis ${leA(b.emis)}</a></p>`;

/**
 * The map on /vigilance: the newest bulletin's picture with its caption; else the line that says why there is none
 * (règle 3 ter), and the newest bulletin's PDF. When the newest bulletin's time of issue could not be read, no PDF: the
 * one kept before it has been replaced (marketing, 27/10). Nothing before the first bulletin is kept.
 * The picture itself is shown here on a phone only (`mf-bas`): on a wide screen, it is in the hero (carteHero()).
 */
export function carteHtml(c: carte.Carte | undefined, now: Date): string {
  if (!c) return "";
  const b = c.bulletin;
  if (c.illisible || !b) {
    return `<div class="card mf-carte"><p>La carte officielle de Météo-France n'a pas pu être lue ${aOuLe(c.illisible ?? now.toISOString(), now)}. ${officielHtml(mf.OFFICIEL_VIGILANCE)}</p></div>`;
  }
  if (c.image?.empreinte !== b.empreinte) {
    return `<div class="card mf-carte"><p>La carte du dernier bulletin de Météo-France, émis ${leA(b.emis)} (heure de La Réunion), n'a pas pu être affichée ici. ${officielHtml(mf.OFFICIEL_VIGILANCE)}</p>${pdfLink(b)}</div>`;
  }
  return figure(b, "card mf-carte mf-bas");
}

/**
 * The same picture in the hero of /vigilance, on a wide screen only (`mf-haut`, out of sight on a phone, where the text
 * comes first): whole, scaled down and never cut, with its caption, the link to Météo-France's site and the PDF, as the
 * agreement of 27/10/2026 asks. Nothing when there is no picture of the newest bulletin: the line saying why stays
 * where it is, in the page.
 */
export function carteHero(c: carte.Carte | undefined): string {
  const b = c?.bulletin;
  return c && !c.illisible && b && c.image?.empreinte === b.empreinte ? figure(b, "card mapcard mf-carte mf-haut") : "";
}

/** The picture, lazy: one of the two is out of sight (display:none), and a browser does not fetch it then. */
function figure(b: NonNullable<carte.Carte["bulletin"]>, cls: string): string {
  const alt = `Première page du bulletin de suivi de la vigilance à La Réunion, publié par Météo-France ${leA(b.emis)} (heure de La Réunion) : carte de l'île colorée par zone, frise des 24 heures par phénomène, puis synthèse. Le niveau de chaque zone est écrit en texte sur cette page.`;
  return `<figure class="${cls}"><a href="${mf.OFFICIEL_VIGILANCE}" rel="noopener"><img src="${carte.imagePath(b.empreinte)}" width="595" height="842" loading="lazy" decoding="async" alt="${esc(alt)}"></a>
<figcaption>Source : Météo-France. Bulletin de suivi vigilance à La Réunion, émis ${leA(b.emis)} (heure de La Réunion). ${officielHtml(mf.OFFICIEL_VIGILANCE)}</figcaption>${pdfLink(b)}</figure>`;
}

/** The page Cloudflare's browser photographs: page 1 of the bulletin `empreinte`, drawn by pdf.js, nothing else. */
export function renduPage(empreinte: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Bulletin de suivi vigilance à La Réunion</title>
<style>html,body{margin:0;background:#fff}canvas{display:block}</style></head>
<body><canvas id="page1"></canvas>
<script type="module">
import { getDocument, GlobalWorkerOptions } from "${PDFJS}/pdf.min.mjs";
GlobalWorkerOptions.workerSrc = "${PDFJS}/pdf.worker.min.mjs";
const c = document.getElementById("page1");
try {
  const pdf = await getDocument({ url: "${carte.pdfPath(empreinte)}", isEvalSupported: false }).promise;
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: ${carte.SCALE} });
  c.width = vp.width;
  c.height = vp.height;
  await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  c.dataset.pret = "1";
} catch (e) {
  document.body.dataset.echec = String(e);
}
</script></body></html>`;
}

/** pdf.js 4.10.38 (Apache 2.0), its two files only: public/pdfjs/, loaded by the page above alone. */
const PDFJS = "/pdfjs/4.10.38";

const PRIVE = { "x-robots-tag": "noindex", "cache-control": "no-store" };

/**
 * The map's addresses: the bulletin and its picture by their fingerprint (kept a year by browsers, they never change),
 * the newest bulletin, and the page of the browser, with its token only. Null for any other address.
 */
export async function carteRoute(path: string, url: URL): Promise<Response | null> {
  const file = carte.FICHIER.exec(path);
  if (file) {
    const [, , empreinte, ext] = file;
    if ((file[1] === "carte") !== (ext === "png")) return null;
    const bytes = await carte.fichier(ext as "pdf" | "png", empreinte);
    if (!bytes) return new Response("Introuvable", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=60" } });
    return new Response(bytes, {
      headers: {
        "content-type": ext === "png" ? "image/png" : "application/pdf",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        ...(ext === "pdf" && { "content-disposition": `inline; filename="meteo-france-bulletin-vigilance-reunion-${empreinte}.pdf"` }),
      },
    });
  }
  if (path === carte.PDF_PATH) {
    // Météo-France's site when the newest bulletin's time of issue could not be read: the one kept before is replaced.
    const c = await carte.kept();
    const location = c?.bulletin && !c.illisible ? carte.pdfPath(c.bulletin.empreinte) : mf.OFFICIEL_VIGILANCE;
    return new Response(null, { status: 302, headers: { location, "cache-control": "public, max-age=60" } });
  }
  if (path === carte.RENDU_PATH) {
    const b = (await carte.etat())?.bulletin;
    const j = url.searchParams.get("j");
    if (!b || !j || j !== b.jeton) return new Response("Introuvable", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", ...PRIVE } });
    return new Response(renduPage(b.empreinte), { headers: { "content-type": "text/html; charset=utf-8", ...PRIVE } });
  }
  return null;
}
