/**
 * The RSMC's forecast track map on /cyclones (providers/cmrs-carte.ts), while a system is active: the image whole, as
 * Météo-France publishes it, with its caption and the link to its site; else the line that says why there is none
 * (règle 3 ter). Marketing's words of 27/10/2026 (marketing/mf-cartes-officielles-mots.md); the image is never in the
 * og:image nor on the home page, and opens Météo-France's site, never a page of ours.
 */
import * as cmrs from "../providers/cmrs-carte.js";
import * as mf from "../providers/vigilance.js";
import { localTime } from "../geo.js";
import { esc } from "./map.js";
import { officielHtml } from "./pages.js";

/** « 17:30 » the same day as `now`, « le 26/10 à 22:10 » another day. */
const heure = (iso: string, now: Date) => {
  const [day, time] = localTime(new Date(iso)).split(" ");
  return day === localTime(now).split(" ")[0] ? time : `le ${day} à ${time}`;
};
const aOuLe = (iso: string, now: Date) => {
  const h = heure(iso, now);
  return h.startsWith("le ") ? h : `à ${h}`;
};

const officiel = () => officielHtml(mf.OFFICIEL_CYCLONE);

export function carteHtml(c: cmrs.Carte | undefined, now: Date): string {
  if (!c) return "";
  if (c.illisible) {
    return `<div class="card mf-carte"><p>La carte de prévision de trajectoire du CMRS n'a pas pu être lue ${aOuLe(c.illisible, now)}. ${officiel()}</p></div>`;
  }
  if (!c.image) {
    return c.ecartee
      ? `<div class="card mf-carte"><p>La carte de prévision de trajectoire du CMRS n'est pas affichée ici : nous n'avons pas pu vérifier qu'elle suit le dernier avis. ${officiel()}</p></div>`
      : "";
  }
  const i = c.image;
  const lue = aOuLe(i.lue, now);
  const alt = `Carte de prévision de trajectoire publiée par le CMRS de La Réunion (Météo-France), lue sur son site ${lue} (heure de La Réunion). Son heure d'émission est écrite sur l'image et n'est pas reprise ici. Le nom des systèmes suivis et l'heure du dernier avis sont écrits en texte sur cette page.`;
  const muet = c.sans_reponse ? `<p class="note">Météo-France n'a pas répondu depuis ${heure(i.lue, now)} : c'est la dernière carte que nous avons lue.</p>` : "";
  return `<figure class="card mf-carte" id="carte-cmrs"><a href="${mf.OFFICIEL_CYCLONE}" rel="noopener"><img src="${cmrs.imagePath(i.empreinte)}" width="${i.largeur}" height="${i.hauteur}" loading="lazy" decoding="async" alt="${esc(alt)}"></a>
<figcaption>Source : Météo-France. Carte de prévision de trajectoire du CMRS de La Réunion ; son heure d'émission est écrite sur la carte. Lue sur le site de Météo-France ${lue} (heure de La Réunion). ${officiel()}</figcaption>${muet}</figure>`;
}

/** A kept image, by its fingerprint (kept a year by browsers: it never changes). Null for any other address. */
export async function carteRoute(path: string): Promise<Response | null> {
  const file = cmrs.FICHIER.exec(path);
  if (!file) return null;
  const bytes = await cmrs.fichier(file[1]);
  if (!bytes) return new Response("Introuvable", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=60" } });
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
