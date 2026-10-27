/**
 * The water of one commune (/coupures-eau/<commune>): its distributor's notices of cuts, or that there are none at the
 * time of the copy, who distributes its water, its drought level and its tap water. And the same in a few words for the
 * commune's own page. Cut from the copies of /coupures-eau, /secheresse and /eau: nothing more is fetched.
 */
import type { Cached } from "../cache.js";
import { CIREST, distributeur, LIENS, MAIRIE_SAINT_LEU, MAIRIE_SAINTE_MARIE, SOURCE as DISTRIBUTEURS } from "../eau/distributeurs.js";
import { ACCUEILS } from "../providers/agenda.js";
import { CREOLE } from "../providers/avis-eau.js";
import { muetPour } from "../tools/coupures.js";
import { a } from "../tools/format.js";
import type { Alerte, CoupuresAnswer, EauAnswer, SecheresseAnswer } from "./data.js";
import { cycloneWater } from "./eau-cyclone.js";
import { connectorCta, describe, droughtBadge, loading, nobreak, noticeCard, silentText, sourcesNote, tapCard, webPage } from "./domains.js";
import { esc, islandMap } from "./map.js";
import { ask, hm, icon, layout, type Live, SITE } from "./pages.js";
import { PAGES, type PlacePage } from "./places.js";

const TITLE_MAX = 60;
const COMMUNES = PAGES.filter((p) => p.commune);

/** The copies a commune's water is cut from, each null when there is none yet. */
export interface WaterCopies {
  coupures: Cached<CoupuresAnswer> | null;
  secheresse?: Cached<SecheresseAnswer> | null;
  eau?: Cached<EauAnswer> | null;
}

/** What the copies say of one commune. */
export function waterOf(commune: string, w: WaterCopies) {
  const avis = w.coupures?.value.avis.filter((n) => n.communes.includes(commune)) ?? [];
  return {
    avis: [...avis].sort((x, y) => Number(!!y.ne_pas_boire) - Number(!!x.ne_pas_boire)),
    dry: !!w.coupures?.value.ne_pas_boire?.includes(commune) || avis.some((n) => n.ne_pas_boire),
    distributeur: distributeur(commune),
    // Its distributor's feed did not answer at the last read: never « pas de coupure annoncée » (tools/injoignable.ts).
    muet: distributeur(commune)?.avis ? muetPour(w.coupures?.value.injoignable, commune) : undefined,
    secheresse: w.secheresse?.value.communes.find((c) => c.commune === commune),
    interdits: w.secheresse?.value.interdits.find((x) => x.communes.includes(commune)),
    robinet: w.eau?.value.communes.find((c) => c.commune === commune),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** The commune's page's tile: a cut or not, its drought level, its tap water. */
export function waterLive(p: PlacePage, w: WaterCopies): Live | undefined {
  if (!w.coupures) return undefined;
  const x = waterOf(p.nom, w);
  const valeur = x.dry ? "Eau à ne pas boire" : x.avis.length ? plural(x.avis.length, "avis de coupure", "avis de coupure") : x.muet ? "Site sans réponse" : x.distributeur?.avis ? "Pas de coupure annoncée" : "Coupures non publiées";
  const detail = [
    x.muet ? esc(x.muet.court) : "",
    x.distributeur ? `distributeur ${esc(x.distributeur.nom)}` : "",
    x.secheresse ? `sécheresse : ${esc(x.secheresse.eau_du_robinet ?? "aucune restriction")}` : "",
    x.robinet ? (x.robinet.non_conformes_6_mois ? `robinet : ${plural(x.robinet.non_conformes_6_mois, "analyse non conforme", "analyses non conformes")} en 6 mois` : x.robinet.analyses_6_mois ? "robinet : analyses conformes" : "") : "",
  ].filter(Boolean).join(" · ");
  return { valeur, detail: detail || "coupures, sécheresse et eau du robinet" };
}

export function coupuresCommunePage(origin: string, p: PlacePage, w: WaterCopies, now = new Date(), alerte?: Alerte): string {
  const d = w.coupures?.value;
  const path = `/coupures-eau/${p.slug}`;
  const url = `${origin}${path}`;
  const x = waterOf(p.nom, w);
  const dist = x.distributeur;
  const at = w.coupures ? hm(w.coupures.fetchedAt) : "";
  const by = [...new Set(x.avis.map((n) => n.distributeur))].join(", ") || dist?.nom || "le distributeur";
  const where = a(p.nom);
  // Who publishes the notices read (the CIREST, a mairie), else the distributor; a mairie only linked to (LIENS).
  const publisher = dist?.par ?? dist?.nom;
  const lien = LIENS[p.nom];
  // A home page only (ACCUEILS): opened in a new window, as that site's terms ask.
  const lienA = lien ? ` <a href="${esc(lien.site)}" rel="noopener"${ACCUEILS.has(lien.site) ? ' target="_blank"' : ""}>${nobreak(lien.libelle)} →</a>` : "";

  // Its feed silent: what was read before, said with its hour, the site linked; or that its read failed.
  const silent = x.muet ? `<p class="note">${silentText(x.muet)}</p>` : "";
  const status = !d
    ? loading("Les avis des distributeurs")
    : x.muet && !x.avis.length
      ? `<p class="lead">${esc(x.muet.texte)}</p>`
      : x.avis.length
      ? `<div class="now"><span class="big">${x.avis.length}</span><p>avis de coupure ou de travaux récents ou à venir ${esc(where)}${x.dry ? ` ; <b>eau à ne pas boire</b> dans les secteurs de l'avis` : ""}.</p></div>`
      : dist?.avis
        // Worded with marketing: who publishes the notices read, without the commune when that name already says it.
        ? `<p class="lead">Aucun avis de coupure publié par ${esc(publisher!)}${publisher!.includes(p.nom) ? "" : ` ${esc(where)}`} à ${esc(at)}.</p>`
        : `<p class="lead">${esc(dist?.nom ?? "Le distributeur")} ne publie pas ses avis de coupure dans un flux que rundata.re peut lire : voir ses avis aux abonnés ou la mairie.${lienA}</p>`;

  const list = !d
    ? `<p class="card">Les avis se chargent : rechargez la page dans quelques secondes.</p>`
    : x.avis.length
      ? `${silent}<ul class="zones">${x.avis.map(noticeCard).join("")}</ul>`
      : x.muet ? ""
      : `<p class="card">${dist?.avis ? `Aucun avis publié à ${esc(at)}, ni coupure en cours ou à venir, ni avis « ne pas boire l'eau ».` : `Pas d'avis en ligne lisible pour ${esc(p.nom)}.`}</p>`;

  const distBlock = `<div class="card">${icon("drop")}<h3>Le distributeur</h3>` +
    (dist
      ? `<p><b>${esc(dist.nom)}</b> distribue l'eau ${esc(where)}, d'après le contrôle sanitaire de l'ARS.</p>` +
        (dist.avis
          ? dist.site === CIREST.site
            ? `<p>Les avis de la commune, publiés par la CIREST, sont relus au moins toutes les 30 minutes : <a href="${esc(dist.site)}" rel="noopener">les avis de la CIREST</a>.</p>`
            : dist.site === MAIRIE_SAINTE_MARIE
            ? `<p>Nous lisons, au moins toutes les 30 minutes, les communiqués de CISE Réunion publiés sur <a href="${esc(dist.site)}" rel="noopener">le site de la ville de Sainte-Marie</a> : ils s'affichent en haut de cette page. Un communiqué publié en image ou en PDF n'est pas lu : nous donnons seulement son lien.</p>`
            : dist.site === MAIRIE_SAINT_LEU
            ? `<p>Nous lisons, au moins toutes les 30 minutes, les avis de coupure publiés sur <a href="${esc(dist.site)}" rel="noopener">le site de la commune de Saint-Leu</a> : ils s'affichent en haut de cette page, avec un court extrait et le lien vers l'avis complet. Un avis publié en image n'est pas lu : nous donnons seulement son lien.</p>`
            : dist.site === CREOLE.url
            ? `<p>Nous lisons, au moins toutes les 30 minutes, les avis de <a href="${esc(dist.site)}" rel="noopener">la page « flash infos » de La Créole</a> : ils s'affichent en haut de cette page.</p>`
            : `<p>Ses avis sont relus au moins toutes les 30 minutes : <a href="${esc(dist.site!)}" rel="noopener">le site de ${esc(dist.nom)}</a>.</p>`
          : `<p>Il ne publie pas ses avis de coupure dans un flux lisible : ils sont sur ses avis aux abonnés et auprès de la mairie.${lienA}</p>`)
      : `<p>Le distributeur de la commune n'est pas connu ici : voir la mairie.${lienA}</p>`) +
    `<p class="note">Son numéro d'urgence (fuite, coupure non annoncée) est sur la facture d'eau. <a href="/communes/${p.slug}">${esc(p.nom)} en direct : la mairie, ses horaires et son téléphone →</a></p></div>`;

  const drought = x.secheresse
    ? `<div class="card">${icon("sun")}<h3>Sécheresse</h3><p>Eau du robinet : ${droughtBadge(x.secheresse.eau_du_robinet)}${x.secheresse.rivieres_et_sources ? ` · rivières et sources : ${droughtBadge(x.secheresse.rivieres_et_sources)}` : ""}${x.secheresse.nappes ? ` · nappes : ${droughtBadge(x.secheresse.nappes)}` : ""}</p>` +
      (x.interdits?.restrictions.length ? `<ul class="plain">${x.interdits.restrictions.slice(0, 6).map((r) => `<li>${esc(r.usage)} : ${esc(r.restriction)}</li>`).join("")}</ul>` : `<p>Pas d'interdiction pour un particulier : économiser l'eau.</p>`) +
      `<p class="note"><a href="/secheresse">L'arrêté sécheresse, commune par commune →</a></p></div>`
    : `<div class="card">${icon("sun")}<h3>Sécheresse</h3><p><a href="/secheresse">Les restrictions d'eau de l'arrêté en vigueur, commune par commune →</a></p></div>`;

  const tap = x.robinet
    ? `<section aria-labelledby="h-robinet"><div class="sec-h"><p class="eyebrow">Contrôle sanitaire de l'ARS</p><h2 id="h-robinet">L'eau du robinet ${esc(where)}</h2></div>
  <ul class="zones">${tapCard(x.robinet)}</ul><p class="note"><a href="/eau">L'eau du robinet de chaque commune, et la baignade →</a></p></section>`
    : `<p class="note"><a href="/eau">La qualité de l'eau du robinet, commune par commune →</a></p>`;

  const others = `<section aria-labelledby="h-autres"><div class="sec-h"><h2 id="h-autres">Les autres communes</h2></div>
  <p>${COMMUNES.filter((c) => c.slug !== p.slug).map((c) => `<a href="/coupures-eau/${c.slug}">${esc(c.nom)}</a>`).join(" · ")}</p>
  <p class="note"><a href="/coupures-eau">Tous les avis de l'île</a>, sur une carte.</p></section>`;

  const title = [`Coupure d'eau ${p.nom} aujourd'hui : avis en cours · 974`, `Coupure d'eau ${p.nom} : avis en cours · 974`, `Coupure d'eau ${p.nom} · 974`]
    .find((t) => t.length <= TITLE_MAX) ?? `Coupure d'eau ${p.nom} · 974`;
  const short = `Coupures d'eau ${where} (974) : avis du distributeur, restrictions sécheresse et qualité de l'eau du robinet.`;
  const description = !d
    ? short
    : x.avis.length
      ? describe(`${p.nom} (974) : ${x.dry ? "eau à ne pas boire ; " : ""}${plural(x.avis.length, "avis", "avis")} de ${by} en cours ou à venir, avec les rues, les heures et les consignes.`, short)
      : dist?.avis && !x.muet
        ? describe(`Aucune coupure d'eau annoncée par ${publisher}${publisher!.includes(p.nom) ? "" : ` ${where}`} (974) à ${at}. Restrictions sécheresse, qualité de l'eau du robinet et contact du distributeur.`, short)
        : short;
  const trail = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [[SITE, "/"], ["Coupures d'eau", "/coupures-eau"], [p.nom, path]].map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: `${origin}${u}` })),
  };

  const band = `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li><a href="/coupures-eau">Coupures d'eau</a></li><li aria-current="page">${esc(p.nom)}</li></ol></nav></div>
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Avis des distributeurs</p>
    <h1>Coupures d'eau ${esc(where)}</h1>
    ${status}
    ${ask(`Dolo la koupé ${p.nom} ? Kansa i rovien ? Gèt si ${url} é di amwin.`,
      `Y a-t-il une coupure d'eau ${where} ? Lis ${url} et dis-moi quand l'eau revient.`)}
  </div>
  <figure class="card mapcard">${islandMap({ highlight: p.nom, label: `Carte de La Réunion (974) situant ${p.nom}` })}</figure>
</div>`;

  // Up the page in the cyclone season, at its foot the rest of the year.
  const cyclone = cycloneWater(now, p.nom);
  const body = `<section aria-labelledby="h-avis">
  <div class="sec-h"><p class="eyebrow">Récents ou à venir</p><h2 id="h-avis">Les avis ${esc(where)}</h2></div>
  ${list}
  ${d ? `<p class="note">${esc(d.a_savoir)}</p>` : ""}
</section>
${cyclone.lead ? cyclone.html : ""}
<section aria-labelledby="h-qui"><div class="sec-h"><h2 id="h-qui">Qui distribue l'eau, et les restrictions</h2></div>
  <div class="two">${distBlock}${drought}</div>
</section>
${tap}
${others}
${cyclone.lead ? "" : cyclone.html}
<section>${d && w.coupures ? sourcesNote([...d.sources, { source: DISTRIBUTEURS, licence: "Licence Ouverte Etalab 2.0", attribution: "ARS La Réunion" }], w.coupures) : ""}</section>
${connectorCta("coupures_eau", "les coupures d'eau")}`;

  return layout(origin, { title, description, path, jsonld: [trail, webPage(origin, path, title, description, w.coupures)], alerte }, band, body);
}
