/**
 * « Y aller »: a place opened in the phone's navigation app. A page cannot know which apps are installed, so the button
 * is a link to the route in Google Maps (its address opens the app where it is, the site elsewhere), and the page's one
 * script turns it into a sheet of the apps that fit the device: Plans, Google Maps and Waze on an iPhone; on Android, the
 * system's own choice of the installed apps first (geo:), then Google Maps and Waze; Google Maps and OpenStreetMap on a
 * computer. The place alone goes into the links, never the visitor's position, and rundata.re learns nothing of the
 * click: nothing is counted. The words are marketing's.
 */
import { ORSEC } from "../tools/ecoles.js";
import type { Alerte } from "./data.js";
import { esc } from "./map.js";
import { hash } from "./pwa.js";

export const MOTS = {
  bouton: "Y aller",
  label: (nom: string) => `Y aller : ${nom}`,
  titre: "Y aller : ",
  ouvrir: "Ouvrir dans :",
  ouvrirPied: "À pied, ouvrir dans :",
  choisir: "Choisir une appli du téléphone",
  copierAdresse: "Copier l'adresse",
  copierCoordonnees: "Copier les coordonnées",
  adresseCopiee: "Adresse copiée",
  coordonneesCopiees: "Coordonnées copiées",
  annuler: "Annuler",
};

/**
 * What a button leads to, for the cyclone alert in force: the town hall (its shelters) or a defibrillator, kept always; a
 * hike's start, a bathing site or a beach; any other place.
 */
export type Genre = "mairie" | "defibrillateur" | "randonnee" | "baignade" | "lieu";

/** The cyclone alert in force as the banner reads it (data.ts alerteOf): its code, 0 without one or when only announced. */
const cycloneOf = (a: Alerte | undefined) => (a && "cyclone" in a.court && !a.court.prevue ? a.court.cyclone : 0);

/**
 * Whether « Y aller » shows under the cyclone alert in force. Red and purple (4, 5: every outing forbidden): only the
 * town hall and a defibrillator. Orange (3): no hike, the ONF closes the trails, whatever its map says yet. The phase de
 * sauvegarde (6): neither hikes nor bathing, the trails still closed and the sea still dangerous. The pré-alerte (2)
 * changes nothing.
 */
export function permis(a: Alerte | undefined, genre: Genre = "lieu"): boolean {
  const c = cycloneOf(a);
  if (genre === "mairie" || genre === "defibrillateur") return true;
  if (c === 4 || c === 5) return false;
  if (genre === "randonnee") return c < 3;
  if (genre === "baignade") return c !== 6;
  return true;
}

/** The levels that take buttons away, as the site names them (alerte-cyclone.ts), and their step on /alerte-cyclone. */
const PHASES: Record<number, { nom: string; id: string }> = {
  3: { nom: "Alerte orange cyclonique", id: "orange" },
  4: { nom: "Alerte rouge cyclonique", id: "rouge" },
  5: { nom: "Alerte violette cyclonique", id: "violette" },
  6: { nom: "Phase de sauvegarde", id: "sauvegarde" },
};
const VERS: Record<string, string> = { mairie: "la mairie", defibrillateur: "les défibrillateurs" };

/**
 * Said once on a page whose buttons the alert took away, in their place (marketing's words): nothing left, or only the
 * places it keeps that the page has (`gardes`: the town hall, the defibrillators).
 */
export function retire(a: Alerte | undefined, gardes: Genre[] = []): string {
  const phase = PHASES[cycloneOf(a)];
  if (!phase) return "";
  const vers = gardes.map((g) => VERS[g]).filter(Boolean);
  const dit = vers.length ? `itinéraire proposé seulement vers ${vers.join(" et ")}, tant qu'elle dure` : "pas d'itinéraire proposé tant qu'elle dure";
  return `<p class="note">${esc(phase.nom)} en cours\u00a0: ${dit}. <a href="/alerte-cyclone#${phase.id}">Les consignes</a> · <a href="${ORSEC.lien}" rel="noopener">la\u00a0préfecture\u00a0↗</a></p>`;
}

/**
 * The buttons of one page under the cyclone alert in force (`permis`): those it keeps, and what the page then adds once,
 * the sheet unless every button was taken away, the line when one was. A page that keeps other buttons than the town
 * hall's or a defibrillator's has no line: none does today (hikes and bathing are never on a page with other places).
 * Without an alert, every button shows.
 */
export function porte(a?: Alerte) {
  let shown = false;
  let taken = false;
  const gardes = new Set<Genre>();
  let autres = false;
  return {
    aller(l: Lieu, genre: Genre = "lieu", pied = false): string {
      const b = aller(l, pied);
      if (b && !permis(a, genre)) {
        taken = true;
        return "";
      }
      if (b) {
        shown = true;
        if (genre in VERS) gardes.add(genre);
        else autres = true;
      }
      return b;
    },
    get feuille() {
      return taken && !shown ? "" : SHEET;
    },
    get ligne() {
      return taken && !autres ? retire(a, [...gardes]) : "";
    },
  };
}
export type Porte = ReturnType<typeof porte>;

export interface Lieu {
  nom: string;
  lat: number;
  lon: number;
  adresse?: string;
}

/** The route to a place in Google Maps: the link without the script, the same on every device. */
export const route = (lat: number, lon: number, pied = false) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}${pied ? "&travelmode=walking" : ""}`;

/**
 * The button of a place; nothing for one without a position. As small as it can be, for the 649 rows of /enfants: the
 * position is read from the link, the name from its label, and the arrow is drawn by the style sheet. On foot (`pied`):
 * no Waze, the walking route elsewhere.
 */
export function aller(l: Lieu, pied = false): string {
  if (!Number.isFinite(l.lat) || !Number.isFinite(l.lon)) return "";
  return `<a class="aller" href="${esc(route(l.lat, l.lon, pied))}" rel="noopener"${l.adresse ? ` data-a="${esc(l.adresse)}"` : ""}` +
    `${pied ? ' data-m="pied"' : ""} aria-label="${esc(MOTS.label(l.nom))}">${MOTS.bouton}</a>`;
}

/**
 * The sheet, filled from the button on each click (one listener for the whole page, so that buttons written after the
 * load, « Autour de moi »'s, have it too): the position from its route, or from data-go where the route is not Google
 * Maps' (« Autour de moi » on an iPhone). Without <dialog> (an old browser), the button stays the link.
 */
export const SCRIPT = `(()=>{const d=document.getElementById("aller");if(!d||!d.showModal)return;
const T=${JSON.stringify(MOTS)};
const ua=navigator.userAgent,ios=/iP(hone|ad|od)/.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1),android=/Android/.test(ua);
const e=(s)=>String(s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const h=d.querySelector("h2"),o=d.querySelector("h2+.note"),ul=d.querySelector("ul"),ok=d.querySelector(".ok");let copie="",dit="";
const apps=(la,lo,n,pied)=>{const p=la+","+lo,q=encodeURIComponent(n);
const g=["Google Maps","https://www.google.com/maps/dir/?api=1&destination="+p+(pied?"&travelmode=walking":"")],w=pied?[]:[["Waze","https://waze.com/ul?ll="+p+"&navigate=yes"]];
if(ios)return[["Plans","https://maps.apple.com/?daddr="+p+"&q="+q+(pied?"&dirflg=w":"")],g,...w];
if(android)return[[T.choisir,"geo:0,0?q="+p+"("+q+")"],g,...w];
return[g,["OpenStreetMap","https://www.openstreetmap.org/?mlat="+la+"&mlon="+lo+"#map=18/"+la+"/"+lo]]};
document.addEventListener("click",(ev)=>{const a=ev.target.closest&&ev.target.closest("a.aller");if(!a)return;
const go=a.dataset.go||new URL(a.href).searchParams.get("destination"),l=a.getAttribute("aria-label")||"";if(!go||!l.startsWith(T.titre))return;ev.preventDefault();
const [la,lo]=go.split(","),n=l.slice(T.titre.length),ad=a.dataset.a,pied=a.dataset.m==="pied";
h.textContent=T.titre+n;o.textContent=pied?T.ouvrirPied:T.ouvrir;
ul.innerHTML=apps(la,lo,n,pied).map(([t,u])=>"<li><a href=\\""+e(u)+"\\" rel=\\"noopener\\""+(ios||android?"":" target=\\"_blank\\"")+">"+e(t)+"<span aria-hidden=\\"true\\">↗</span></a></li>").join("")+
"<li><button type=\\"button\\" class=\\"cp\\">"+e(ad?T.copierAdresse:T.copierCoordonnees)+"</button></li>";
copie=ad||la+", "+lo;dit=ad?T.adresseCopiee:T.coordonneesCopiees;ok.textContent="";d.showModal()});
d.addEventListener("click",(ev)=>{if(ev.target===d||ev.target.closest(".x")){d.close();return}
if(ev.target.closest(".cp")){const c=navigator.clipboard;(c?c.writeText(copie):Promise.reject()).then(()=>{ok.textContent=dit},()=>{ok.textContent=copie});return}
if(ev.target.closest("a"))setTimeout(()=>d.close(),400)})})();`;

/**
 * The script's address, kept a year by the browser like the stylesheet (web/site.ts): read once for every page that has
 * buttons, the ~4 900 bus stops' among them, instead of written into each.
 */
export const SCRIPT_PATH = `/aller-${hash(SCRIPT)}.js`;

/** Once in a page that has buttons: the sheet and its script. */
export const SHEET = `<dialog id="aller" class="aller-f" aria-labelledby="aller-t"><div><h2 id="aller-t"></h2><p class="note">${esc(MOTS.ouvrir)}</p><ul></ul>` +
  `<p class="ok note" aria-live="polite"></p><button type="button" class="x">${esc(MOTS.annuler)}</button></div></dialog><script src="${SCRIPT_PATH}" defer></script>`;
