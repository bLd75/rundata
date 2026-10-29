/**
 * « Y aller »: a place opened in the phone's navigation app. A page cannot know which apps are installed, so the button
 * is a link to the route in Google Maps (its address opens the app where it is, the site elsewhere), and the page's one
 * script turns it into a sheet of the apps that fit the device: Plans, Google Maps and Waze on an iPhone; on Android, the
 * system's own choice of the installed apps first (geo:), then Google Maps and Waze; Google Maps and OpenStreetMap on a
 * computer. The place alone goes into the links, never the visitor's position, and rundata.re learns nothing of the
 * click: nothing is counted. The words are marketing's.
 */
import { esc } from "./map.js";

export const MOTS = {
  bouton: "Y aller",
  label: (nom: string) => `Y aller : ${nom}`,
  titre: "Y aller : ",
  ouvrir: "Ouvrir dans :",
  choisir: "Choisir une appli du téléphone",
  copierAdresse: "Copier l'adresse",
  copierCoordonnees: "Copier les coordonnées",
  adresseCopiee: "Adresse copiée",
  coordonneesCopiees: "Coordonnées copiées",
  annuler: "Annuler",
};

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
const h=d.querySelector("h2"),ul=d.querySelector("ul"),ok=d.querySelector(".ok");let copie="",dit="";
const apps=(la,lo,n,pied)=>{const p=la+","+lo,q=encodeURIComponent(n);
const g=["Google Maps","https://www.google.com/maps/dir/?api=1&destination="+p+(pied?"&travelmode=walking":"")],w=pied?[]:[["Waze","https://waze.com/ul?ll="+p+"&navigate=yes"]];
if(ios)return[["Plans","https://maps.apple.com/?daddr="+p+"&q="+q+(pied?"&dirflg=w":"")],g,...w];
if(android)return[[T.choisir,"geo:0,0?q="+p+"("+q+")"],g,...w];
return[g,["OpenStreetMap","https://www.openstreetmap.org/?mlat="+la+"&mlon="+lo+"#map=18/"+la+"/"+lo]]};
document.addEventListener("click",(ev)=>{const a=ev.target.closest&&ev.target.closest("a.aller");if(!a)return;
const go=a.dataset.go||new URL(a.href).searchParams.get("destination"),l=a.getAttribute("aria-label")||"";if(!go||!l.startsWith(T.titre))return;ev.preventDefault();
const [la,lo]=go.split(","),n=l.slice(T.titre.length),ad=a.dataset.a;
h.textContent=T.titre+n;
ul.innerHTML=apps(la,lo,n,a.dataset.m==="pied").map(([t,u])=>"<li><a href=\\""+e(u)+"\\" rel=\\"noopener\\""+(ios||android?"":" target=\\"_blank\\"")+">"+e(t)+"<span aria-hidden=\\"true\\">↗</span></a></li>").join("")+
"<li><button type=\\"button\\" class=\\"cp\\">"+e(ad?T.copierAdresse:T.copierCoordonnees)+"</button></li>";
copie=ad||la+", "+lo;dit=ad?T.adresseCopiee:T.coordonneesCopiees;ok.textContent="";d.showModal()});
d.addEventListener("click",(ev)=>{if(ev.target===d||ev.target.closest(".x")){d.close();return}
if(ev.target.closest(".cp")){const c=navigator.clipboard;(c?c.writeText(copie):Promise.reject()).then(()=>{ok.textContent=dit},()=>{ok.textContent=copie});return}
if(ev.target.closest("a"))setTimeout(()=>d.close(),400)})})();`;

/** Once in a page that has buttons: the sheet and its script. */
export const SHEET = `<dialog id="aller" class="aller-f" aria-labelledby="aller-t"><div><h2 id="aller-t"></h2><p class="note">${esc(MOTS.ouvrir)}</p><ul></ul>` +
  `<p class="ok note" aria-live="polite"></p><button type="button" class="x">${esc(MOTS.annuler)}</button></div></dialog><script>${SCRIPT}</script>`;
