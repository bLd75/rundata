/**
 * The day of one commune (/aujourdhui/<commune>): what the tool resume_du_jour answers, as a page, from the same
 * summary (tools/resume.ts) cut from the same copies. Nothing more is fetched; a part without a recent copy links to
 * the page that has it.
 */
import type { Cached } from "../cache.js";
import type { Resume } from "../tools/resume.js";
import type { Alerte } from "./data.js";
import { connectorCta, webPage } from "./domains.js";
import { esc } from "./map.js";
import { a, de } from "../tools/format.js";
import { ask, credits, icon, layout, SITE, thin } from "./pages.js";
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
  `<li>${x.lien ? `<a href="${esc(x.lien)}" rel="noopener">${esc(x.titre)}</a>` : esc(x.titre)}${x.quand || x.media ? ` <span class="note">${esc([x.quand, x.media].filter(Boolean).join(" · "))}</span>` : ""}</li>`;

export function aujourdhuiPage(origin: string, p: PlacePage, r: Resume, at: Cached<unknown> | null, alerte?: Alerte): string {
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
    ? card("alert", "Vigilance", `<p>${esc(v.maintenant.replace(/^\p{L}/u, (c) => c.toUpperCase()))}${v.zone ? ` (zone ${esc(v.zone)})` : ""}${v.vagues_submersion ? ` · vagues-submersion : ${esc(v.vagues_submersion)}` : ""}.</p>${v.alerte_cyclonique ? `<p><b>${esc(v.alerte_cyclonique)}</b></p>` : ""}`, "/vigilance", v.alerte_cyclonique || v.maintenant !== "pas de vigilance particulière" ? " warn" : "")
    : "";
  const small = [
    r.mer ? `<li>Mer : <b>${esc(thin(r.mer.temperature_eau))}</b> <span class="note">${esc(r.mer.mesure)}</span> · <a href="/mer">la mer →</a></li>` : "",
    r.air ? `<li>Air : <b>${esc(r.air.qualite)}</b> <span class="note">indice ATMO ${r.air.indice_atmo}${r.air.polluants ? `, ${esc(r.air.polluants.join(", "))}` : ""}</span> · <a href="/air">l'air →</a></li>` : "",
    r.electricite ? `<li>Électricité : <b>${String(r.electricite.renouvelable_pct).replace(".", ",")} % renouvelable</b> <span class="note">à ${esc(r.electricite.heure)}</span> · <a href="/electricite">l'électricité →</a></li>` : "",
    r.calendrier?.jour_ferie ? `<li>Jour férié : <b>${esc(r.calendrier.jour_ferie)}</b></li>` : "",
    r.calendrier?.vacances_scolaires ? `<li>${esc(r.calendrier.vacances_scolaires)} en cours · <a href="/calendrier">le calendrier →</a></li>` : "",
    `<li>Soleil : lever ${esc(r.soleil.lever)}, coucher ${esc(r.soleil.coucher)}</li>`,
    r.mairie ? `<li>Mairie : <b>${r.mairie.ouverte === null ? "horaires non publiés" : r.mairie.ouverte ? "ouverte" : "fermée"}</b>${r.mairie.horaires_aujourd_hui ? ` <span class="note">${esc(r.mairie.horaires_aujourd_hui)}</span>` : ""}${r.mairie.telephone ? ` · ${esc(r.mairie.telephone)}` : ""}</li>` : "",
  ].filter(Boolean).join("");

  const c = r.circulation;
  const roads = card("car", "Routes et circulation",
    (c.infos_routes?.length ? `<ul class="plain">${c.infos_routes.map(li).join("")}</ul>` : c.infos_routes ? `<p>Aucune information des médias sur les routes ou des blocages ${esc(aCommune(p.nom))} ces dernières heures.</p>` : "") +
    (c.routes_ile?.length ? `<p class="note">Ailleurs sur l'île :</p><ul class="plain">${c.routes_ile.map((x) => li({ titre: x.titre, lien: x.lien, media: x.source, quand: x.heure })).join("")}</ul>` : "") +
    (c.bus?.length ? `<p class="note">Info trafic des bus : ${c.bus.map((x) => esc(`${x.reseau} : ${x.titre}`)).join(" ; ")}</p>` : "") +
    `<p class="note">rundata.re ne mesure pas les bouchons : <a href="${esc(c.waze)}" rel="noopener">la carte Waze autour de ${esc(p.nom)}</a>, <a href="https://www.infotrafic.re/" rel="noopener">infotrafic.re</a>, et <a href="/trafic">la page circulation</a>.</p>`,
    "/trafic");

  const news = r.actualites
    ? card("news", `Actualités ${deCommune(p.nom)}`, r.actualites.length ? `<ul class="plain">${r.actualites.map(li).join("")}</ul>` : `<p>Rien de nouveau qui nomme ${esc(p.nom)} ces dernières heures dans les médias lus.</p>`, "/actualites")
    : "";
  const cuts = r.coupures_eau
    ? card("drop", "Coupures d'eau",
        r.coupures_eau.avis.length
          ? `<ul class="plain">${r.coupures_eau.avis.map((n) => `<li>${n.ne_pas_boire ? "<b>Eau à ne pas boire</b> · " : ""}${li({ titre: n.titre, lien: n.lien }).slice(4, -5)}${n.coupure ? ` <span class="note">${esc([n.coupure.de, n.coupure.a].filter(Boolean).join(" → "))}${n.coupure.etat ? `, ${esc(n.coupure.etat)}` : ""}</span>` : ""}</li>`).join("")}</ul>`
          : `<p>${esc(r.coupures_eau.note ?? `Aucune coupure annoncée${r.coupures_eau.distributeur ? ` par ${r.coupures_eau.distributeur}` : ""}.`)}</p>`,
        `/coupures-eau/${p.slug}`, r.coupures_eau.avis.some((n) => n.ne_pas_boire) ? " warn" : "")
    : "";
  const ev = r.evenements_du_jour;
  const events = ev
    ? card("music", "Sortir aujourd'hui",
        ev.liste.length
          ? `<ul class="plain">${ev.liste.map((e) => `<li>${e.statut ? `<b>${esc(e.statut)}</b> · ` : ""}${li({ titre: e.titre, lien: e.lien }).slice(4, -5)} <span class="note">${esc([e.quand, e.lieu, e.prix].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul>${ev.autres ? `<p class="note">Et ${plural(ev.autres, "autre")}.</p>` : ""}`
          : `<p>Rien d'annoncé aujourd'hui ${esc(aCommune(p.nom))} dans les agendas lus.</p>`,
        "/evenements")
    : "";
  const d = r.decheteries;
  const dFresh = d?.sites.filter((x) => x.accepte) ?? [];
  const dGreen = dFresh.filter((x) => x.accepte!.includes("déchets verts")).length;
  const practical = [
    ...(r.marches_du_jour?.liste ?? []).map((x) => `<li>Marché aujourd'hui : <a href="${esc(x.carte)}" rel="noopener"><b>${esc(x.nom)}</b></a> <span class="note">${esc(x.horaires_aujourd_hui)}${x.adresse ? `, ${esc(x.adresse)}` : ""}</span></li>`),
    d
      ? `<li>Déchèteries : <b>${dFresh.length ? `déchets verts acceptés dans ${dGreen} sur ${dFresh.length}` : "état des bennes à vérifier sur place"}</b> <span class="note">d'après les agents du TCO</span> · <a href="${esc(d.page.replace(/^https:\/\/rundata\.re/, ""))}">les bennes →</a></li>`
      : "",
    r.carburants?.prix_maximum ? `<li>Carburants (prix maximum du mois) : <b>${esc(r.carburants.prix_maximum)}</b> · <a href="/carburants">les prix →</a></li>` : "",
    `<li>Pharmacie de garde (nuits, dimanches, jours fériés) : <a href="${esc(r.pharmacie_de_garde.site)}" rel="noopener"><b>3237.fr</b></a>, ou le 32 37 (payant)</li>`,
  ].filter(Boolean).join("");
  const missing = r.non_inclus?.length
    ? `<p class="note">Pas de copie récente pour : ${r.non_inclus.map((x) => `<a href="${esc(x.page.replace(/^https:\/\/rundata\.re/, ""))}">${esc(x.partie)}</a>`).join(", ")}. Ces pages les donnent à jour.</p>`
    : "";

  const title = titleOf(p);
  const description = descriptionOf(p, r);
  const trail = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [[SITE, "/"], ["Communes", "/communes"], [p.nom, `/communes/${p.slug}`], ["Aujourd'hui", path]].map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: `${origin}${u}` })),
  };
  const band = `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li><a href="/communes">Communes</a></li><li><a href="/communes/${p.slug}">${esc(p.nom)}</a></li><li aria-current="page">Aujourd'hui</li></ol></nav></div>
<div class="wrap intro"><div class="pitch">
  <p class="pill"><span class="dot"></span>${esc(r.resume.split(" ; ")[0])}</p>
  <h1>${esc(H1(p))}</h1>
  <p class="hook">${esc(HOOK(p))}</p>
  ${r.resume.includes(" ; ") ? `<p class="lead">${esc(r.resume.split(" ; ").slice(1).join(" ; ").replace(/^\p{L}/u, (x) => x.toUpperCase()))}</p>` : ""}
  ${ask(`Kosa i éspas ${p.nom} jordi ? Rogard ${url} é di amwin.`, `Que se passe-t-il ${aCommune(p.nom)} aujourd'hui ? Lis ${url} et résume-moi la journée.`)}
</div></div>`;
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
  <div class="card"><ul class="plain">${practical}</ul></div>
</section>
<section>${missing}
  <p class="note"><a href="/communes/${p.slug}">${esc(p.nom)} en direct : les bus, la mairie, toutes les rubriques →</a></p>
  ${r.sources.length ? `<p class="note">Sources : ${credits(r.sources)}.</p>` : ""}
</section>
${connectorCta("resume_du_jour", `la journée ${deCommune(p.nom)}`)}`;
  return layout(origin, { title, description, path, jsonld: [trail, webPage(origin, path, title, description, at)], alerte }, band, body);
}
