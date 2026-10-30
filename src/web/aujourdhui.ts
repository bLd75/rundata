/**
 * The day of one commune (/aujourdhui/<commune>): what the tool resume_du_jour answers, as a page, from the same
 * summary (tools/resume.ts) cut from the same copies. Nothing more is fetched; a part without a recent copy links to
 * the page that has it.
 */
import type { Cached } from "../cache.js";
import * as mf from "../providers/vigilance.js";
import { ACCUEILS } from "../providers/agenda.js";
import type * as annuaire from "../providers/annuaire.js";
import { mentionCourte } from "../tools/agenda.js";
import { type Resume, UPDATING } from "../tools/resume.js";
import { MARCHES } from "../vie/marches.js";
import { porte, SHEET as ALLER } from "./aller.js";
import type { Alerte } from "./data.js";
import { connectorCta, courantItem, silentItem, silentText, webPage } from "./domains.js";
import { esc, fenetre, islandMap } from "./map.js";
import { reprise } from "./ouvrir-donnees.js";
import { a, de } from "../tools/format.js";
import { ask, credits, icon, layout, officielHtml, SITE, thin } from "./pages.js";
import type { PlacePage } from "./places.js";

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 152;

/** « à Saint-Paul », « au Port », « aux Avirons », « à l'Entre-Deux ». */
export const aCommune = (nom: string) => (nom === "Entre-Deux" ? "à l'Entre-Deux" : a(nom));
export const deCommune = (nom: string) => (nom === "Entre-Deux" ? "de l'Entre-Deux" : de(nom));

// The texts of the page, worded by marketing.
export const titleOf = (p: PlacePage) =>
  [`${p.nom} aujourd'hui : météo, routes, sorties · 974`, `${p.nom} aujourd'hui : météo, sorties · 974`].find((t) => t.length <= TITLE_MAX)!;
export const H1 = (p: PlacePage) => `Aujourd'hui ${aCommune(p.nom)}`;
export const LINK = (p: PlacePage) => `Aujourd'hui ${aCommune(p.nom)} : le résumé de la journée →`;
export const HOOK = (p: PlacePage) => `Ce qui compte aujourd'hui ${aCommune(p.nom)}, sur une page : la mesure, les routes, l'actu, les coupures, les sorties et la vie pratique.`;

/** « Aujourd'hui à Saint-Paul (974) : 24,5 °C mesurés à 15:10, 12 sorties, 1 coupure d'eau. Routes, actu… », each figure only when there is one. */

type Markets = NonNullable<Resume["marches_du_jour"]>;
type Aller = ReturnType<typeof porte>["aller"];

/**
 * The commune's markets on /aujourdhui: those held today, those open all week apart (never « the market of the day »),
 * then those whose days no source gives, by name, with the town hall's page; never « no market ».
 * A town hall's market says its page and, when old, its date.
 */
function marketItems(mk: Markets | undefined, commune: string, aller: Aller): string[] {
  if (!mk) return [];
  // Its position from the bundled list, by its OpenStreetMap object: the summary does not give it. None for a market
  // only a town hall gives: no button then.
  const go = (x: { nom: string; adresse?: string; carte?: string }) => {
    const m = x.carte ? MARCHES().find((y) => y.osm === x.carte) : undefined;
    const button = m?.lat != null && m.lon != null ? aller({ nom: x.nom, lat: m.lat, lon: m.lon, adresse: x.adresse ? `${x.adresse}, ${commune}` : undefined }) : "";
    return button ? ` ${button}` : "";
  };
  const by = (x: { d_apres?: string }) => (x.d_apres ? `, d'après le ${x.d_apres}` : "");
  const name = (x: { nom: string; lien: string }) => `<a href="${esc(x.lien)}" rel="noopener"${fenetre(x.lien)}><b>${esc(x.nom)}</b></a>`;
  const townHall = mk.mairie ? `<a href="${esc(mk.mairie.site)}" rel="noopener"${fenetre(mk.mairie.site)}>${esc(mk.mairie.texte)} →</a>` : "";
  return [
    ...mk.liste.map((x) => `<li>Marché aujourd'hui : ${name(x)} <span class="note">${esc(x.horaires_aujourd_hui)}${x.adresse ? `, ${esc(x.adresse)}` : ""}${esc(by(x))}</span>${go(x)}</li>`),
    ...(mk.permanents ?? []).map((x) => `<li>Marché permanent : ${name(x)} <span class="note">${esc(x.horaires ?? "")}${x.horaires_aujourd_hui === "fermé aujourd'hui" ? ", fermé aujourd'hui" : ""}${x.adresse ? `, ${esc(x.adresse)}` : ""}${esc(by(x))}</span>${go(x)}</li>`),
    mk.jours_non_trouves
      ? `<li>Autres marchés : ${mk.jours_non_trouves.map(name).join(", ")} <span class="note">jours non trouvés</span>${townHall ? ` · ${townHall}` : ""}</li>`
      : townHall ? `<li>Marchés : ${townHall}</li>` : "",
  ];
}

export function descriptionOf(p: PlacePage, r: Resume): string {
  const m = r.meteo?.mesure;
  const t = m?.mesures.temperature;
  const events = r.evenements_du_jour ? r.evenements_du_jour.liste.length + (r.evenements_du_jour.autres ?? 0) : 0;
  const cuts = r.coupures_eau?.avis.length ?? 0;
  const figures = [
    t ? `${thin(t)} mesurés à ${m!.heure_mesure.split(" ")[1] ?? m!.heure_mesure}` : "",
    events ? plural(events, "sortie") : "",
    cuts ? plural(cuts, "coupure d'eau", "coupures d'eau") : "",
  ].filter(Boolean);
  const long = `Aujourd'hui ${aCommune(p.nom)} (974) : ${figures.length ? `${figures.join(", ")}. ` : ""}Routes, actu, vigilance, mairie : le résumé du jour.`;
  return long.length <= DESCRIPTION_MAX ? long : `Aujourd'hui ${aCommune(p.nom)} (974) : Routes, actu, vigilance, mairie : le résumé du jour.`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const card = (ic: string, title: string, body: string, href?: string, cls = "") =>
  `<div class="card${cls}">${icon(ic)}<h3>${href ? `<a href="${href}">${esc(title)}</a>` : esc(title)}</h3>${body}</div>`;
const li = (x: { titre: string; lien?: string; quand?: string; media?: string }) =>
  `<li>${x.lien ? `<a href="${esc(x.lien)}" rel="noopener"${fenetre(x.lien)}>${esc(x.titre)}</a>` : esc(x.titre)}${x.quand || x.media ? ` <span class="note">${esc([x.quand, x.media].filter(Boolean).join(" · "))}</span>` : ""}</li>`;

/**
 * `mairie`: the office as the commune's copy has it, for its position (« Y aller »), which the summary, also the tool's
 * answer, does not give.
 */
export function aujourdhuiPage(origin: string, p: PlacePage, r: Resume, at: Cached<unknown> | null, alerte?: Alerte, mairie?: annuaire.Office | null): string {
  const g = porte(alerte);
  const path = `/aujourdhui/${p.slug}`;
  const url = `${origin}${path}`;
  const m = r.meteo;
  const f = m?.prevision?.aujourd_hui;
  const dayForecast = (j?: typeof f) => (j ? `${esc(j.jour)} : ${j.temperature_min && j.temperature_max ? `${esc(thin(j.temperature_min))} à ${esc(thin(j.temperature_max))}` : ""}${j.ciel_en_journee ? `, ${esc(j.ciel_en_journee)}` : ""}${j.pluie ? `, pluie ${esc(thin(j.pluie))}` : ""}` : "");

  const weather = m
    ? card("thermo", `Météo ${p.nom}`,
        (m.mesure ? `<p><b>${esc(thin(m.mesure.mesures.temperature ?? ""))}</b> mesurés à ${esc(m.mesure.heure_mesure.split(" ")[1] ?? m.mesure.heure_mesure)} par la station ${esc(m.mesure.station)} (${m.mesure.altitude_m.toLocaleString("fr-FR")} m${m.mesure.distance_km != null ? `, à ${String(m.mesure.distance_km).replace(".", ",")} km` : ""}).</p>` : "") +
        (f ? `<p>Prévision, pas une mesure : ${dayForecast(f)}${m.prevision?.demain ? ` ; ${dayForecast(m.prevision.demain)}` : ""}.</p>` : ""),
        `/meteo/${p.slug}`)
    : "";
  const v = r.vigilance;
  const vigil = v
    ? card("alert", "Vigilance", `<p>${esc(v.maintenant)}${v.vagues_submersion ? ` ${esc(v.vagues_submersion)}.` : ""}</p>${v.alerte_cyclonique ? `<p><b>${esc(v.alerte_cyclonique)}</b></p>` : ""}${v.ecoles ? `<p><a href="/ecoles-cyclone">${esc(v.ecoles)}</a></p>` : ""}<p>${officielHtml(v.alerte_cyclonique ? mf.OFFICIEL_CYCLONE : mf.OFFICIEL_VIGILANCE)}</p>`, "/vigilance", v.alerte_cyclonique || v.au_dessus_du_vert ? " warn" : "")
    : "";
  const small = [
    r.mer ? `<li>Mer : <b>${esc(thin(r.mer.temperature_eau))}</b> <span class="note">${esc(r.mer.mesure)}</span> · <a href="/mer">la mer →</a></li>` : "",
    r.air ? `<li>Air : <b>${esc(r.air.qualite)}</b> <span class="note">indice ATMO prévu ${r.air.indice_atmo}${r.air.polluants ? `, ${esc(r.air.polluants.join(", "))}` : ""}</span> · <a href="/air">l'air →</a></li>` : "",
    r.electricite ? `<li>Électricité : <b>${String(r.electricite.renouvelable_pct).replace(".", ",")} % renouvelable</b> <span class="note">à ${esc(r.electricite.heure)}</span> · <a href="/electricite">l'électricité →</a></li>` : "",
    r.calendrier?.jour_ferie ? `<li>Jour férié : <b>${esc(r.calendrier.jour_ferie)}</b></li>` : "",
    r.calendrier?.vacances_scolaires ? `<li>${esc(r.calendrier.vacances_scolaires)} en cours · <a href="/calendrier">le calendrier →</a></li>` : "",
    `<li>Soleil : lever ${esc(r.soleil.lever)}, coucher ${esc(r.soleil.coucher)}</li>`,
    r.mairie ? `<li>Mairie : <b>${r.mairie.ouverte === null ? "horaires non publiés" : r.mairie.ouverte ? "ouverte" : "fermée"}</b>${r.mairie.horaires_aujourd_hui ? ` <span class="note">${esc(r.mairie.horaires_aujourd_hui)}</span>` : ""}${r.mairie.telephone ? ` · ${esc(r.mairie.telephone.replace(/ /g, "\u00a0"))}` : ""}${mairie ? ` ${g.aller({ nom: mairie.nom, lat: mairie.lat ?? NaN, lon: mairie.lon ?? NaN, adresse: mairie.adresse }, "mairie")}` : ""}</li>` : "",
  ].filter(Boolean).join("");

  const c = r.circulation;
  const roads = card("car", "Routes et circulation",
    (c.infos_routes?.length ? `<ul class="plain">${c.infos_routes.map(li).join("")}</ul>` : c.infos_routes ? `<p>Aucune information des médias sur les routes ou des blocages ${esc(aCommune(p.nom))} ces dernières heures.</p>` : "") +
    (c.routes_ile?.length ? `<p class="note">Ailleurs sur l'île :</p><ul class="plain">${c.routes_ile.map((x) => li({ titre: x.titre, lien: x.lien, media: x.source, quand: x.heure })).join("")}</ul>` : "") +
    (c.bus?.length ? `<p class="note">Info trafic des bus : ${c.bus.map((x) => esc(`${x.reseau} : ${x.titre}`)).join(" ; ")}</p>` : "") +
    `<p class="note">rundata.re ne mesure pas les bouchons : <a href="${esc(c.carte_officielle)}" rel="noopener">la carte officielle sur infotrafic.re ↗</a>, et <a href="/trafic">la page circulation</a>.</p>`,
    "/trafic");

  const news = r.actualites
    ? card("news", `Actualités ${deCommune(p.nom)}`, r.actualites.length ? `<ul class="plain">${r.actualites.map(li).join("")}</ul>` : `<p>Rien de nouveau qui nomme ${esc(p.nom)} ces dernières heures dans les médias lus.</p>`, "/actualites")
    : "";
  const cuts = r.coupures_eau
    ? card("drop", "Coupures d'eau",
        (r.coupures_eau.injoignable ? `<p class="note">${silentText(r.coupures_eau.injoignable)}</p>` : "") +
        (r.coupures_eau.avis.length
          ? `<ul class="plain">${r.coupures_eau.avis.map((n) => `<li>${n.ne_pas_boire ? "<b>Eau à ne pas boire</b> · " : ""}${li({ titre: n.titre, lien: n.lien }).slice(4, -5)}${n.coupure ? ` <span class="note">${esc(n.coupure.a ? `${n.coupure.de} → ${n.coupure.a}` : `à partir du ${n.coupure.de}`)}${n.coupure.etat ? `, ${esc(n.coupure.etat)}` : ""}</span>` : ""}</li>`).join("")}</ul>`
          : r.coupures_eau.injoignable ? ""
          : `<p>${esc(r.coupures_eau.note ?? `Aucune coupure annoncée${r.coupures_eau.distributeur ? ` par ${r.coupures_eau.distributeur}` : ""}.`)}</p>`),
        `/coupures-eau/${p.slug}`, r.coupures_eau.avis.some((n) => n.ne_pas_boire) ? " warn" : "")
    : "";
  const ev = r.evenements_du_jour;
  const notRead = mentionCourte(p.nom);
  const events = ev
    ? card("music", "Sortir aujourd'hui",
        (ev.liste.length
          ? `<ul class="plain">${ev.liste.map((e) => `<li>${e.statut ? `<b>${esc(e.statut)}</b> · ` : ""}${e.lien && ACCUEILS.has(e.lien) ? `<a href="${esc(e.lien)}" rel="noopener" target="_blank">${esc(e.titre)}</a>` : li({ titre: e.titre, lien: e.lien }).slice(4, -5)} <span class="note">${esc([e.quand, e.lieu, e.prix, e.source && `Source\u00a0: ${e.source}`].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul>${ev.autres ? `<p class="note">Et ${plural(ev.autres, "autre")}.</p>` : ""}`
          : `<p>Rien d'annoncé aujourd'hui ${esc(aCommune(p.nom))} dans les agendas lus.</p>`) +
        // Its site not read until it agrees: said under them, in marketing's words.
        (notRead ? `<p class="note np">${esc(notRead.ligne)}${reprise(notRead.ligne)}</p>` : ""),
        "/evenements")
    : "";
  const d = r.decheteries;
  const dFresh = d?.sites.filter((x) => x.accepte) ?? [];
  const dGreen = dFresh.filter((x) => x.accepte!.includes("déchets verts")).length;
  // Its notices of power cuts not read until it agrees: said under the list, as the agenda's under the outings.
  const powerNotRead = r.coupures_electricite?.non_repris;
  const practical = [
    ...(r.coupures_electricite?.injoignable ? [silentItem(r.coupures_electricite.injoignable)] : []),
    ...(r.coupures_electricite?.avis ?? []).map(courantItem),
    ...marketItems(r.marches_du_jour, p.nom, g.aller),
    d
      ? `<li>Déchèteries : <b>${dFresh.length ? `déchets verts acceptés dans ${dGreen} sur ${dFresh.length}` : "état des bennes à vérifier sur place"}</b> <span class="note">d'après les agents du TCO</span> · <a href="${esc(d.page.replace(/^https:\/\/rundata\.re/, ""))}">les bennes →</a></li>`
      : "",
    r.carburants?.prix_maximum ? `<li>Carburants (prix maximum du mois) : <b>${esc(r.carburants.prix_maximum)}</b> · <a href="/carburants">les prix →</a></li>` : "",
    r.collecte_dechets ? `<li>Collecte des déchets : le jour de votre rue sur <a href="${esc(r.collecte_dechets.page.replace(/^https:\/\/rundata\.re/, ""))}">rundata.re${esc(r.collecte_dechets.page.replace(/^https:\/\/rundata\.re/, ""))}</a>.</li>` : "",
    `<li>Pharmacie de garde (nuits, dimanches, jours fériés) : <a href="${esc(r.pharmacie_de_garde.site)}" rel="noopener"><b>3237.fr</b></a>, ou le 32 37 (payant)</li>`,
  ].filter(Boolean).join("");
  // A part whose copy is being built again (tools/resume.ts, `UPDATING`) says so, as the other tiles.
  const link = (x: { partie: string; page: string }) => `<a href="${esc(x.page.replace(/^https:\/\/rundata\.re/, ""))}">${esc(x.partie)}</a>`;
  const updating = r.non_inclus?.filter((x) => x.raison === UPDATING) ?? [];
  const old = r.non_inclus?.filter((x) => x.raison !== UPDATING) ?? [];
  const missing =
    (old.length ? `<p class="note">Pas de copie récente pour : ${old.map(link).join(", ")}. Ces pages les donnent à jour.</p>` : "") +
    (updating.length ? `<p class="note">${updating.map(link).join(", ")}. Se met à jour : rechargez la page dans quelques minutes.</p>` : "");

  const title = titleOf(p);
  const description = descriptionOf(p, r);
  const trail = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [[SITE, "/"], ["Communes", "/communes"], [p.nom, `/communes/${p.slug}`], ["Aujourd'hui", path]].map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: `${origin}${u}` })),
  };
  // The island situating the commune, as on its page (commune.ts). Not on a phone (nophone), where it would come under
  // the text, out of sight: drawing it there delayed the text's first paint by about 340 ms on slow 4G at 390 px, and by
  // 250 ms still with content-visibility (median of 9, 31/10/2026); hidden, nothing moved.
  const band = `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li><a href="/communes">Communes</a></li><li><a href="/communes/${p.slug}">${esc(p.nom)}</a></li><li aria-current="page">Aujourd'hui</li></ol></nav></div>
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>${esc(r.resume.split("\u00a0; ")[0])}</p>
    <h1>${esc(H1(p))}</h1>
    <p class="hook">${esc(HOOK(p))}</p>
    ${r.resume.includes("\u00a0; ") ? `<p class="lead">${esc(r.resume.split("\u00a0; ").slice(1).join("\u00a0; ").replace(/^\p{L}/u, (x) => x.toUpperCase()))}</p>` : ""}
    ${ask(`Kosa i spas ${p.nom} jordi ? Gèt si ${url} é di amwin.`, `Que se passe-t-il ${aCommune(p.nom)} aujourd'hui ? Lis ${url} et résume-moi la journée.`)}
  </div>
  <figure class="card mapcard nophone">${islandMap({ highlight: p.nom, label: `Carte de La Réunion (974) situant ${p.nom}` })}</figure>
</div>`;
  const body = `<section aria-labelledby="h-temps"><div class="sec-h"><h2 id="h-temps">Le temps</h2></div>
  <div class="two">${weather}${vigil}</div>
  <div class="card"><ul class="plain">${small}</ul></div>
</section>
<section aria-labelledby="h-routes"><div class="sec-h"><h2 id="h-routes">Routes et nouvelles</h2></div>
  <div class="two">${roads}${news}</div>
</section>
${cuts || events ? `<section aria-labelledby="h-eau-sorties"><div class="sec-h"><h2 id="h-eau-sorties">L'eau et les sorties</h2></div>
  <div class="two">${cuts}${events}</div>
</section>` : ""}
<section aria-labelledby="h-pratique"><div class="sec-h"><h2 id="h-pratique">Vie pratique</h2></div>
  <div class="card"><ul class="plain">${practical}</ul>${powerNotRead ? `<p class="note np">${esc(powerNotRead)}${reprise(powerNotRead)}</p>` : ""}</div>
</section>
<section>${missing}
  <p class="note"><a href="/communes/${p.slug}">${esc(p.nom)} en direct : les bus, la mairie, toutes les rubriques →</a></p>
  ${r.sources.length ? `<p class="sources">Sources : ${credits(r.sources)}.</p>` : ""}
</section>
${connectorCta("resume_du_jour", `la journée ${deCommune(p.nom)}`)}`;
  return layout(origin, { title, description, path, jsonld: [trail, webPage(origin, path, title, description, at)], alerte }, band, g.ligne + (body.includes('class="aller"') ? body + ALLER : body));
}
