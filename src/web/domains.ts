/**
 * One page per category of the connector besides the weather: the volcano, the air, the electricity, the calendar and
 * the buses. Each shows what the tool of the same name answers right now, so that people, search engines and the
 * assistants reading a page see it, and points to the connector for the rest. Each also says it in a few words for
 * its tile on the home page.
 */
import type { Cached } from "../cache.js";
import { normalize } from "../places/resolve.js";
import { UNPUBLISHED } from "../tools/calendrier.js";
import { de, fr } from "../tools/format.js";
import { COMMUNES as BIKE_COMMUNES } from "../tools/velos.js";
import type { AirAnswer, Alerte, BorneStation, BornesAnswer, BusData, CalendrierAnswer, EauAnswer, ElectriciteAnswer, VeloStation, VelosAnswer, VolcanAnswer } from "./data.js";
import { FAST_KW } from "../tools/bornes.js";
import island from "../places/island.json" with { type: "json" };
import { esc, islandMap } from "./map.js";
import { ask, credits, DESCRIPTION_MAX, fresh, hm, icon, ISLAND, layout, type Live, SITE } from "./pages.js";

const FOURNAISE = { lon: 55.7083, lat: -21.2444, name: "Piton de la Fournaise" };

/** `full` when it fits in what search engines show, else `short`. */
const describe = (full: string, short: string) => (full.length <= DESCRIPTION_MAX ? full : short);

function crumbs(origin: string, name: string, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE, item: `${origin}/` },
      { "@type": "ListItem", position: 2, name, item: `${origin}${path}` },
    ],
  };
}

function webPage(origin: string, path: string, title: string, description: string, data: Cached<unknown> | null) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    inLanguage: "fr-FR",
    url: `${origin}${path}`,
    ...(data ? { dateModified: data.fetchedAt.toISOString() } : {}),
    about: ISLAND,
  };
}

const crumbBar = (label: string) =>
  `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol><li><a href="/">${SITE}</a></li><li aria-current="page">${esc(label)}</li></ol></nav></div>`;

/** What to say while the data of a page is not there yet. */
const loading = (what: string) => `<p class="lead">${esc(what)} se charge : rechargez la page dans quelques secondes.</p>`;

const sourcesNote = (list: { source: string; licence: string; attribution: string }[], data: Cached<unknown>) =>
  `<p class="note">Sources : ${credits(list)}. Mis à jour à ${hm(data.fetchedAt)}.</p>`;

const warnings = (list: string[]) =>
  list.length ? `<div class="card warn">${icon("alert")}<h3>À savoir</h3><ul class="plain">${list.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : "";

/** The connector, at the end of every domain page. */
const connectorCta = (tool: string, what: string) => `<section aria-labelledby="h-ia">
  <div class="card cta"><h2 id="h-ia">Votre IA, branchée sur ${esc(what)}</h2>
  <p>Avec le connecteur, votre assistant lit lui-même ces données (outil <code>${esc(tool)}</code>), et toutes les autres de l'île : météo, mer, volcan, air, électricité, bus, services publics, terrain. Gratuit, sans compte. <a href="/#assistant">Comment le brancher</a>.</p></div>
</section>`;

// ---------------------------------------------------------------- volcan

const ACCESS: Record<string, string> = { ouvert: "ouvert", partiel: "partiellement ouvert", ferme: "fermé", fermé: "fermé" };
const md = (m: number | null) => (m == null ? "—" : fr(Math.round(m * 10) / 10));
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Indian/Reunion" });

export function volcanPage(origin: string, data: Cached<VolcanAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const e = d?.etat;
  const q = d?.seismes;
  const url = fresh(`${origin}/volcan`, now);

  const status = !d
    ? loading("L'état du volcan")
    : `<div class="status">` +
      (e
        ? `<p class="big">${e.eruption_en_cours ? "Éruption en cours" : "Pas d'éruption en cours"}</p>` +
          `<p class="lead">Niveau du dispositif ORSEC volcan : <b>${esc(e.niveau_orsec)}</b>.` +
          (!e.eruption_en_cours && e.derniere_eruption_fin ? ` Dernière éruption terminée le <b>${esc(dayOf(e.derniere_eruption_fin))}</b>.` : "") +
          (e.deformation ? ` Déformation du volcan : ${esc(e.deformation)}.` : "") + `</p>` +
          (e.acces_enclos ? `<p class="lead">Accès à l'Enclos : <b>${esc(ACCESS[e.acces_enclos.statut] ?? e.acces_enclos.statut)}</b>.</p>` : "")
        : `<p class="lead">${esc(d.resume)}</p>`) +
      (q ? `<p class="lead">Séismes sous le volcan : <b>${q.sous_le_volcan["7_jours"]}</b> en 7 jours, <b>${q.sous_le_volcan["30_jours"]}</b> en 30 jours.</p>` : "") +
      `</div>`;

  const enclos = e?.acces_enclos
    ? `<div class="card">${icon("mountain")}<h3>Accès à l'Enclos : ${esc(ACCESS[e.acces_enclos.statut] ?? e.acces_enclos.statut)}</h3>` +
      (e.acces_enclos.detail ? `<p>${esc(e.acces_enclos.detail)}</p>` : "") +
      (e.acces_enclos.source ? `<p class="note">${e.acces_enclos.lien ? `<a href="${esc(e.acces_enclos.lien)}">${esc(e.acces_enclos.source)}</a>` : esc(e.acces_enclos.source)}</p>` : "") +
      `</div>`
    : "";

  const quakes = q
    ? `<div class="card">${icon("gauge")}<h3>Séismes localisés par l'observatoire</h3>` +
      `<p class="facts"><span>Sous le volcan : <b>${q.sous_le_volcan["30_jours"]}</b> en 30 jours, magnitude max ${md(q.sous_le_volcan.magnitude_max_30j)}</span>` +
      `<span>Ailleurs sur l'île : <b>${q.ailleurs_sur_l_ile["30_jours"]}</b>, magnitude max ${md(q.ailleurs_sur_l_ile.magnitude_max_30j)}</span></p>` +
      (q.derniers.length
        ? `<ul class="rows">${q.derniers.map((s) => `<li><b>${esc(md(s.magnitude))}</b><span>${esc(s.lieu)}, ${esc(fr(Math.max(0, s.profondeur_km)))} km de profondeur</span><span class="note">${esc(s.heure.replace(" heure de La Réunion", ""))}</span></li>`).join("")}</ul>`
        : "") +
      `<p class="note">${esc(q.note)}</p></div>`
    : "";

  const posts = d?.publications_ovpf?.length
    ? `<section aria-labelledby="h-ovpf"><div class="sec-h"><p class="eyebrow">L'observatoire</p><h2 id="h-ovpf">Ce que publie l'OVPF</h2>
  <p>Les derniers messages de l'Observatoire volcanologique du Piton de la Fournaise (IPGP), repris tels quels.</p></div>
  <ul class="posts">${d.publications_ovpf.slice(0, 4).map((p) => `<li class="card"><p class="note">${esc(p.date)}</p><p>${esc(p.texte)}</p>${p.lien ? `<p><a href="${esc(p.lien)}">Lire le message →</a></p>` : ""}</li>`).join("")}</ul></section>`
    : "";

  const title = "Piton de la Fournaise en direct : éruption, Enclos, séismes · 974";
  const description = d && e
    ? describe(
        `🇷🇪 Piton de la Fournaise (La Réunion, 974) : ${e.eruption_en_cours ? "éruption en cours" : "pas d'éruption en cours"}, niveau ORSEC ${e.niveau_orsec}` +
          `${e.acces_enclos ? `, Enclos ${ACCESS[e.acces_enclos.statut] ?? e.acces_enclos.statut}` : ""}` +
          `${q ? `, ${q.sous_le_volcan["7_jours"]} séismes sous le volcan en 7 jours` : ""}.`,
        "🇷🇪 Piton de la Fournaise (La Réunion, 974) en direct : éruption ou non, accès à l'Enclos, derniers séismes de l'OVPF.",
      )
    : "🇷🇪 Piton de la Fournaise (La Réunion, 974) en direct : éruption ou non, accès à l'Enclos, derniers séismes de l'OVPF.";

  const band = `${crumbBar("Volcan")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Volcan en direct</p>
    <h1>Piton de la Fournaise <span class="n974">974</span></h1>
    ${status}
    ${ask(`Lo volkan lé an érupsion astèr ? Rogard si ${url} é di amwin si lanklo lé ouvèr.`,
      `Le Piton de la Fournaise est-il en éruption ? Lis ${url} et dis-moi aussi si l'Enclos est ouvert.`)}
  </div>
  <figure class="card mapcard">${islandMap({ pin: FOURNAISE, label: "Carte de La Réunion (974) avec le Piton de la Fournaise" })}</figure>
</div>`;

  const body = `<section aria-labelledby="h-volcan">
  <div class="sec-h"><p class="eyebrow">En ce moment</p><h2 id="h-volcan">L'Enclos et les séismes</h2></div>
  ${d ? `<div class="two">${enclos}${quakes}</div>${warnings(d.avertissements)}${data ? sourcesNote(d.sources, data) : ""}` : `<p class="card">Les données du volcan se chargent : rechargez la page dans quelques secondes.</p>`}
</section>
${posts}
${connectorCta("volcan_seismes", "le volcan")}`;

  return layout(origin, { title, description, path: "/volcan", jsonld: [crumbs(origin, "Volcan", "/volcan"), webPage(origin, "/volcan", title, description, data)], alerte }, band, body);
}

export function volcanLive(data: Cached<VolcanAnswer> | null): Live | undefined {
  const e = data?.value.etat;
  if (!e) return undefined;
  const q = data!.value.seismes;
  return {
    valeur: e.eruption_en_cours ? "Éruption en cours" : "Pas d'éruption",
    detail: [
      e.acces_enclos ? `Enclos ${esc(ACCESS[e.acces_enclos.statut] ?? e.acces_enclos.statut)}` : `ORSEC ${esc(e.niveau_orsec)}`,
      q ? `${q.sous_le_volcan["7_jours"]} séisme${q.sous_le_volcan["7_jours"] > 1 ? "s" : ""} sous le volcan en 7 jours` : undefined,
    ].filter(Boolean).join(" · "),
  };
}

// ---------------------------------------------------------------- air

const AQ_NAMES = ["", "bon", "moyen", "dégradé", "mauvais", "très mauvais", "extrêmement mauvais"];
export const aq = (n: number) => `<span class="aq aq${n >= 1 && n <= 6 ? n : 0}">${esc(AQ_NAMES[n] ?? "inconnu")}</span>`;
// The map's commune names (« L'Étang-Salé ») by their spelling in the ATMO index (« L'Etang-Salé »).
const MAP_NAME = new Map(island.paths.map((p: { nom: string }) => [normalize(p.nom), p.nom]));

export function airPage(origin: string, data: Cached<AirAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const list = [...(d?.communes ?? [])].sort((a, b) => b.niveau - a.niveau || a.commune.localeCompare(b.commune, "fr"));
  const worst = list[0]?.niveau;
  const best = list.length ? list[list.length - 1].niveau : undefined;
  const url = fresh(`${origin}/air`, now);

  const fills: Record<string, string> = {};
  for (const c of list) {
    const name = MAP_NAME.get(normalize(c.commune));
    if (name && c.niveau >= 1 && c.niveau <= 6) fills[name] = `var(--aq${c.niveau})`;
  }

  const status = !d
    ? loading("L'indice de la qualité de l'air")
    : worst != null
      ? `<div class="status"><p class="big">${esc(AQ_NAMES[worst] ?? "")}${best != null && best !== worst ? ` à ${esc(AQ_NAMES[best] ?? "")}` : ""}</p>` +
        `<p class="lead">${esc(d.resume)}</p><p class="note" style="color:var(--on-night-muted)">${esc(d.nature)}.</p></div>`
      : `<p class="lead">${esc(d.resume)}</p>`;

  const byLevel = [6, 5, 4, 3, 2, 1]
    .map((n) => ({ n, l: list.filter((c) => c.niveau === n) }))
    .filter((x) => x.l.length)
    .map((x) => `<div class="card"><h3>${aq(x.n)} ${x.l.length} commune${x.l.length > 1 ? "s" : ""}</h3><ul class="plain cols">` +
      x.l.map((c) => `<li>${esc(c.commune)}${c.polluants.length ? ` <span class="note">(${esc(c.polluants.join(", "))})</span>` : ""}</li>`).join("") + `</ul></div>`)
    .join("");

  const scale = `<ul class="scale">${[1, 2, 3, 4, 5, 6].map((n) => `<li>${aq(n)}<p>Indice ${n} sur 6.</p></li>`).join("")}</ul>`;

  const title = "Qualité de l'air à La Réunion 974 aujourd'hui, commune par commune";
  const description = d && worst != null
    ? describe(`🇷🇪 Qualité de l'air à La Réunion (974) aujourd'hui, indice ATMO d'Atmo Réunion : ${d.resume.replace(/^Qualité de l'air aujourd'hui à La Réunion : /, "")}`,
        "🇷🇪 Qualité de l'air à La Réunion (974) aujourd'hui : l'indice ATMO d'Atmo Réunion dans chaque commune, avec le polluant en cause.")
    : "🇷🇪 Qualité de l'air à La Réunion (974) aujourd'hui : l'indice ATMO d'Atmo Réunion dans chaque commune, avec le polluant en cause.";

  const band = `${crumbBar("Qualité de l'air")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Indice du jour</p>
    <h1>Qualité de l'air <span class="n974">974</span></h1>
    ${status}
    ${ask(`Lèr lé bon La Rényon zordi ? Rogard si ${url} é di amwin pou mon komine.`,
      `L'air est-il bon aujourd'hui à La Réunion ? Lis ${url} et dis-moi la qualité de l'air dans ma commune.`)}
  </div>
  <figure class="card mapcard">${islandMap({ fills, label: "Carte de La Réunion (974) colorée par l'indice de qualité de l'air de chaque commune" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Couleur de l'indice ATMO du jour dans chaque commune.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-communes-air">
  <div class="sec-h"><p class="eyebrow">Commune par commune</p><h2 id="h-communes-air">L'indice dans les 24 communes</h2>
  <p>L'indice ATMO va de 1 (bon) à 6 (extrêmement mauvais). Il est donné par le pire des polluants mesurés et prévus (ozone, dioxyde d'azote, dioxyde de soufre, particules).</p></div>
  ${d ? `<div class="levels">${byLevel}</div>${warnings(d.avertissements)}${data ? sourcesNote(d.sources, data) : ""}` : `<p class="card">L'indice se charge : rechargez la page dans quelques secondes.</p>`}
</section>
<section aria-labelledby="h-echelle-air">
  <div class="sec-h"><p class="eyebrow">Bon à savoir</p><h2 id="h-echelle-air">L'échelle de l'indice</h2></div>
  <div class="card">${scale}<p class="note">Pendant une éruption, le panache peut dégrader l'air dans le sud et l'ouest de l'île : suivez les consignes de l'ARS et de la préfecture.</p></div>
</section>
${connectorCta("qualite_air", "l'air de l'île")}`;

  return layout(origin, { title, description, path: "/air", jsonld: [crumbs(origin, "Qualité de l'air", "/air"), webPage(origin, "/air", title, description, data)], alerte }, band, body);
}

export function airLive(data: Cached<AirAnswer> | null): Live | undefined {
  const list = data?.value.communes ?? [];
  if (!list.length) return undefined;
  const worst = Math.max(...list.map((c) => c.niveau));
  const best = Math.min(...list.map((c) => c.niveau));
  const polluants = [...new Set(list.filter((c) => c.niveau === worst).flatMap((c) => c.polluants))];
  return {
    valeur: best === worst ? aq(worst) : `${aq(best)} à ${aq(worst)}`,
    detail: `indice ATMO du jour dans les 24 communes${polluants.length ? ` (${esc(polluants.join(", "))})` : ""}`,
  };
}

// ---------------------------------------------------------------- électricité

export function electricitePage(origin: string, data: Cached<ElectriciteAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const p = d?.production;
  const m = d?.meteo_electricite;
  const url = fresh(`${origin}/electricite`, now);

  const status = !d
    ? loading("La production d'électricité")
    : p
      ? `<div class="now"><span class="big">${fr(Math.round(p.renouvelable_pct))} %</span><p>de l'électricité de l'île vient en ce moment de sources <b>renouvelables</b>, sur <b>${esc(fr(Math.round(p.total_mw)))} MW</b> produits (${esc(p.heure.replace(" heure de La Réunion", ""))}).</p></div>` +
        (m?.maintenant ? `<p class="lead">Signal d'EDF en ce moment : <b>${esc(m.maintenant.signal.toLowerCase())}</b>.</p>` : "")
      : `<p class="lead">${esc(d.resume)}</p>`;

  const bars = p
    ? `<ul class="bars">${p.parts.map((x) => `<li><span>${esc(x.filiere)}</span><b>${esc(fr(x.part_pct))} %</b><i class="${x.renouvelable ? "ren" : ""}" style="width:${Math.max(1, x.part_pct)}%"></i></li>`).join("")}</ul>` +
      `<p class="note">En vert, les filières renouvelables. ${esc(p.statut[0].toUpperCase() + p.statut.slice(1))}.</p>`
    : "";

  const tension = m
    ? `<div class="card">${icon("bolt")}<h3>Quand éviter les gros usages</h3>` +
      (m.periodes_de_tension.length
        ? `<ul class="plain">${m.periodes_de_tension.map((t) => `<li><b>${esc(t.quand)}</b> : ${esc(t.signal)}${t.recharge_conseillee_pct != null ? ` (recharge d'un véhicule à ${t.recharge_conseillee_pct} %)` : ""}</li>`).join("")}</ul>`
        : `<p>Pas de période de tension prévue${m.jusqu_au ? ` d'ici le ${esc(m.jusqu_au)}` : ""}.</p>`) +
      `<p class="note">${esc(m.explication)}</p></div>`
    : "";

  const title = "Électricité à La Réunion 974 en direct : production et part renouvelable";
  const description = p
    ? describe(`🇷🇪 Électricité à La Réunion (974) à ${p.heure.split(" ")[1]} : ${fr(Math.round(p.total_mw))} MW produits, dont ${fr(Math.round(p.renouvelable_pct))} % renouvelable. Filière par filière, et les heures où le réseau est chargé.`,
        `🇷🇪 Électricité à La Réunion (974) : ${fr(Math.round(p.renouvelable_pct))} % renouvelable en ce moment. Filière par filière, et les heures où le réseau est chargé.`)
    : "🇷🇪 Électricité à La Réunion (974) en direct : d'où vient le courant, la part renouvelable et les heures où le réseau est chargé.";

  const band = `${crumbBar("Électricité")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Production en direct</p>
    <h1>Électricité <span class="n974">974</span></h1>
    ${status}
    ${ask(`Lo kouran La Rényon i sort koté astèr ? Rogard si ${url} é di amwin la par renouvlab.`,
      `D'où vient l'électricité de La Réunion en ce moment ? Lis ${url} et dis-moi la part renouvelable.`)}
  </div>
  ${p ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">Filière par filière</h3>${bars}</figure>` : ""}
</div>`;

  const body = `<section aria-labelledby="h-reseau">
  <div class="sec-h"><p class="eyebrow">Le réseau</p><h2 id="h-reseau">Une île qui produit toute son électricité</h2>
  <p>La Réunion n'est reliée à aucun autre réseau : chaque kilowatt consommé est produit sur l'île, au moment même. Le soir, quand tout le monde rentre, le réseau est le plus chargé.</p></div>
  ${d ? `<div class="two">${tension}${warnings(d.avertissements)}</div>${data ? sourcesNote(d.sources, data) : ""}` : `<p class="card">Les données d'EDF se chargent : rechargez la page dans quelques secondes.</p>`}
</section>
${connectorCta("electricite", "l'électricité de l'île")}`;

  return layout(origin, { title, description, path: "/electricite", jsonld: [crumbs(origin, "Électricité", "/electricite"), webPage(origin, "/electricite", title, description, data)], alerte }, band, body);
}

export function electriciteLive(data: Cached<ElectriciteAnswer> | null): Live | undefined {
  const p = data?.value.production;
  if (!p) return undefined;
  const signal = data!.value.meteo_electricite?.maintenant?.signal;
  return {
    valeur: `${fr(Math.round(p.renouvelable_pct))}\u202f% renouvelable`,
    detail: `${esc(fr(Math.round(p.total_mw)))} MW produits à ${esc(p.heure.split(" ")[1] ?? p.heure)}${signal ? ` · réseau ${esc(signal.toLowerCase())}` : ""}`,
  };
}

// ---------------------------------------------------------------- calendrier

export function calendrierPage(origin: string, data: Cached<CalendrierAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const v = d?.vacances_scolaires;
  const f = d?.jours_feries;
  const next = f?.prochains[0];
  const url = fresh(`${origin}/calendrier`, now);
  const today = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Indian/Reunion" });

  const status = !d
    ? loading("Le calendrier")
    : `<div class="status"><p class="big">${esc(today)}</p>` +
      (f?.aujourd_hui ? `<p class="lead">Aujourd'hui est férié : <b>${esc(f.aujourd_hui)}</b>.</p>` : "") +
      (v?.en_cours ? `<p class="lead">Vacances scolaires en cours, reprise des cours le <b>${esc(v.en_cours.reprise_des_cours)}</b>.</p>` : "") +
      (next ? `<p class="lead">Prochain jour férié : <b>${esc(next.nom)}</b>, ${esc(next.date)} (dans ${next.dans_jours} jour${next.dans_jours > 1 ? "s" : ""}).</p>` : "") +
      (d.soleil ? `<p class="lead">À ${esc(d.soleil.lieu)}, lever du soleil à <b>${esc(d.soleil.lever.replace(":", "h"))}</b>, coucher à <b>${esc(d.soleil.coucher.replace(":", "h"))}</b>.</p>` : "") +
      `</div>`;

  const holidays = f
    ? `<div class="card">${icon("calendar")}<h3>Jours fériés</h3><ul class="plain">${f.prochains.map((h) => `<li><b>${esc(h.nom)}</b> : ${esc(h.date)} <span class="note">(dans ${h.dans_jours} j)</span></li>`).join("")}</ul><p class="note">${esc(f.note)}</p></div>`
    : "";
  const school = v
    ? `<div class="card">${icon("book")}<h3>Vacances scolaires</h3><ul class="plain">` +
      [...(v.en_cours ? [{ ...v.en_cours, now: true }] : []), ...v.a_venir.map((x) => ({ ...x, now: false }))]
        .map((x) => `<li><b>${esc(x.nom)}</b>${x.now ? " (en cours)" : ""} : du ${esc(x.debut)}, ${x.reprise_des_cours === UNPUBLISHED ? "date de reprise pas encore publiée" : `reprise le ${esc(x.reprise_des_cours)}`}</li>`).join("") +
      `</ul><p class="note">${esc(v.note)}</p></div>`
    : "";
  const sun = d?.soleil
    ? `<div class="card">${icon("mountain")}<h3>Soleil à ${esc(d.soleil.lieu)}</h3><p>Lever ${esc(d.soleil.lever.replace(":", "h"))}, coucher ${esc(d.soleil.coucher.replace(":", "h"))} : ${esc(d.soleil.duree_du_jour)} de jour.</p><p class="note">${esc(d.soleil.note)}</p></div>`
    : "";

  const title = "Calendrier de La Réunion 974 : vacances scolaires, jours fériés, soleil";
  const description = next
    ? describe(`🇷🇪 Calendrier de La Réunion (974) : ${v?.en_cours ? `vacances scolaires jusqu'au ${v.en_cours.reprise_des_cours}, ` : ""}prochain jour férié ${next.nom} (${next.date}). Vacances australes, 20 décembre.`,
        `🇷🇪 Calendrier de La Réunion (974) : prochain jour férié ${next.nom}, vacances scolaires australes, 20 décembre, lever et coucher du soleil.`)
    : "🇷🇪 Calendrier de La Réunion (974) : vacances scolaires australes, jours fériés dont le 20 décembre, lever et coucher du soleil.";

  const band = `${crumbBar("Calendrier")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Aujourd'hui à La Réunion</p>
    <h1>Calendrier <span class="n974">974</span></h1>
    ${status}
    ${ask(`Kansa lé lo prochin vakans lékol é lo prochin zour férié La Rényon ? Rogard si ${url} é di amwin.`,
      `Quand sont les prochaines vacances scolaires et le prochain jour férié à La Réunion ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${sun ? `<figure class="card mapcard">${islandMap({ peaks: true, label: "Carte de La Réunion (974)" })}</figure>` : ""}
</div>`;

  const body = `<section aria-labelledby="h-cal">
  <div class="sec-h"><p class="eyebrow">L'année à La Réunion</p><h2 id="h-cal">Vacances, jours fériés, soleil</h2>
  <p>L'académie de La Réunion suit un calendrier austral : les grandes vacances tombent en décembre et janvier, pendant l'été de l'hémisphère sud.</p></div>
  ${d ? `<div class="three">${school}${holidays}${sun}</div>${data ? sourcesNote(d.sources, data) : ""}` : `<p class="card">Le calendrier se charge : rechargez la page dans quelques secondes.</p>`}
</section>
${connectorCta("calendrier", "le calendrier de l'île")}`;

  return layout(origin, { title, description, path: "/calendrier", jsonld: [crumbs(origin, "Calendrier", "/calendrier"), webPage(origin, "/calendrier", title, description, data)], alerte }, band, body);
}

export function calendrierLive(data: Cached<CalendrierAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const v = d.vacances_scolaires?.en_cours;
  const f = d.jours_feries;
  const next = f?.prochains[0];
  const valeur = f?.aujourd_hui ? `Férié : ${esc(f.aujourd_hui)}` : v ? "Vacances scolaires" : next ? `${esc(next.nom)} dans ${next.dans_jours} j` : undefined;
  if (!valeur) return undefined;
  return {
    valeur,
    detail: [
      v ? `reprise le ${esc(v.reprise_des_cours)}` : undefined,
      (f?.aujourd_hui || v) && next ? `${esc(next.nom)} dans ${next.dans_jours} j` : undefined,
      d.soleil ? `soleil ${esc(d.soleil.lever.replace(":", "h"))} – ${esc(d.soleil.coucher.replace(":", "h"))}` : undefined,
    ].filter(Boolean).join(" · "),
  };
}

// ---------------------------------------------------------------- bus

const waitText = (min: number, heure: string) =>
  heure.startsWith("demain") ? heure : min < 1 ? "maintenant" : min < 90 ? `dans ${fr(min)} min` : `à ${heure}`;

type Row = BusData["gares"][number]["departs"][number];

/** What the real-time feed says of a departure, HTML: « +5 min », « à l'heure », « 1 min d'avance », « ne passe pas à cet arrêt ». */
export function liveText(x: Row): string {
  if (x.temps_reel) return ` <b class="rt">${esc(x.temps_reel)}</b>`;
  if (x.retard_min === undefined) return "";
  const m = x.retard_min;
  return ` <b class="rt" title="Heure annoncée en temps réel par le réseau">${m === 0 ? "à l'heure" : m > 0 ? `+${fr(m)} min` : `${fr(-m)} min d'avance`}</b>`;
}

/** One departure as a row: line, direction, wait (from the real-time feed when there is one). */
export const departureLi = (x: Row, wait: string) =>
  `<li><b>${esc(x.ligne)}</b><span>vers ${esc(x.direction)} <span class="note">(${esc(x.reseau)})</span></span><span class="note">${esc(wait)}${liveText(x)}</span></li>`;

/** The traffic alerts of the networks with a real-time feed. */
export const alertList = (list: { reseau: string; lignes?: string[]; titre: string; detail?: string }[]) =>
  `<ul class="plain">${list.map((a) => `<li><b>${esc(a.reseau)}${a.lignes ? `, ligne ${esc(a.lignes.join(", "))}` : ""}</b> : ${esc(a.titre)}${a.detail && a.detail !== a.titre ? `<p class="note">${esc(a.detail)}</p>` : ""}</li>`).join("")}</ul>`;

export function busPage(origin: string, data: Cached<BusData> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = fresh(`${origin}/bus`, now);
  const lines = d?.reseaux.reduce((n, r) => n + r.lignes, 0) ?? 0;

  const status = !d
    ? loading("Les horaires")
    : `<div class="now"><span class="big">${d.reseaux.length}</span><p>réseaux de bus et le téléphérique de Saint-Denis : <b>${esc(fr(lines))} lignes</b>, de Car Jaune qui fait le tour de l'île aux bus de chaque commune.</p></div>`;

  const networks = d
    ? `<ul class="plain">${d.reseaux.map((r) => `<li><b>${esc(r.nom)}</b> : ${esc(fr(r.lignes))} ligne${r.lignes > 1 ? "s" : ""} <span class="note">(${esc(r.exploitant)})</span></li>`).join("")}</ul>`
    : "";

  const gares = d?.gares.length
    ? `<ul class="zones">${d.gares.map((g) => `<li class="card"><h3>Gare ${esc(de(g.commune))}</h3>` +
        `<p class="note">${g.arrets.map((a) => `${esc(a.reseau)} : ${esc(a.nom)}`).join(" · ")}</p>` +
        (g.departs.length
          ? `<ul class="rows">${g.departs.map((x) => departureLi(x, waitText(x.dans_min, x.heure_annoncee ?? x.heure))).join("")}</ul>`
          : `<p>Pas de départ prévu dans les prochaines heures.</p>`) +
        `</li>`).join("")}</ul>` +
      `<p class="note">${d!.temps_reel?.length ? `${esc(d!.temps_reel.map((t) => t.reseau).join(", "))} : heures annoncées en temps réel par le réseau quand le bus y figure (flux de ${esc(d!.temps_reel[0].heure)}). ` : ""}` +
      `Sinon, horaires théoriques publiés par chaque réseau, sans les retards ni les déviations. Mis à jour à ${hm(data!.fetchedAt)}.</p>`
    : `<p class="card">Les prochains départs à n'importe quel arrêt de l'île sont donnés par le connecteur : demandez à votre assistant « le prochain bus à la gare de Saint-Pierre ? ».</p>`;

  const title = "Bus à La Réunion 974 : prochains départs dans les gares routières";
  const description = "🇷🇪 Bus à La Réunion (974) : prochains départs dans les gares routières, d'après les horaires de Car Jaune, Citalis, Kar'Ouest, Alternéo, CarSud et Estival.";

  const band = `${crumbBar("Bus")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Horaires du jour</p>
    <h1>Bus et cars <span class="n974">974</span></h1>
    ${status}
    ${ask(`Kansa i pas lo prochin bis la gar Sin-Pièr ? Rogard si ${url} é di amwin.`,
      `Quand passe le prochain bus à la gare routière de Saint-Pierre ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${d ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">Les réseaux</h3>${networks}</figure>` : ""}
</div>`;

  const body = `<section aria-labelledby="h-gares">
  <div class="sec-h"><p class="eyebrow">En ce moment</p><h2 id="h-gares">Prochains départs dans les gares routières</h2>
  <p>Toutes les lignes qui partent de chaque gare, tous réseaux confondus, au plus trois départs par ligne et par direction.</p></div>
  ${gares}
  ${d ? `<p class="note">Sources : ${credits(d.sources)}.</p>` : ""}
</section>
${d?.alertes?.length ? `<section aria-labelledby="h-trafic"><h2 id="h-trafic">Info trafic</h2><div class="card">${alertList(d.alertes)}<p class="note">Publié par les réseaux dans leur flux temps réel, repris tel quel.</p></div></section>` : ""}
${connectorCta("transports", "les bus de l'île")}`;

  return layout(origin, { title, description, path: "/bus", jsonld: [crumbs(origin, "Bus", "/bus"), webPage(origin, "/bus", title, description, data)], alerte }, band, body);
}

export function busLive(data: Cached<BusData> | null): Live | undefined {
  const d = data?.value;
  const g = d?.gares.find((x) => x.departs.length);
  if (!d || !g) return undefined;
  const x = g.departs[0];
  return {
    // A time rather than « dans 3 min »: the page may be a few minutes old.
    valeur: esc(x.heure_annoncee ?? x.heure),
    detail: `prochain départ de la gare ${esc(de(g.commune))} : ligne ${esc(x.ligne)} vers ${esc(x.direction)} (${esc(x.reseau)})`,
  };
}

// ---------------------------------------------------------------- vélos

/** « 4 vélos · 6 places », « fermée ». */
export function bikeStock(s: VeloStation): string {
  if (s.etat === "fermée" || s.etat === "location impossible en ce moment") return esc(s.etat);
  const parts = [`<b>${s.velos_electriques}</b> vélo${s.velos_electriques > 1 ? "s" : ""}`];
  if (s.trottinettes) parts.push(`<b>${s.trottinettes}</b> trottinette${s.trottinettes > 1 ? "s" : ""}`);
  if (s.places_libres != null && !s.etat) parts.push(`${s.places_libres} place${s.places_libres > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

export const bikeRow = (s: VeloStation) => `<li><span>${esc(s.nom)}</span><span>${bikeStock(s)}</span></li>`;

export function velosPage(origin: string, data: Cached<VelosAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = fresh(`${origin}/velos`, now);
  const total = d?.communes?.reduce((n, c) => n + c.velos_disponibles, 0) ?? 0;

  const status = !d
    ? loading("L'état des stations")
    : `<div class="now"><span class="big">${total}</span><p>vélo${total > 1 ? "s" : ""} à assistance électrique disponible${total > 1 ? "s" : ""} en ce moment dans les <b>${d.stations.length} stations</b> Altervélo de ${esc(BIKE_COMMUNES.join(", ").replace(/, ([^,]+)$/, " et $1"))}.</p></div>`;

  const fills = Object.fromEntries(BIKE_COMMUNES.map((c) => [c, "var(--hl)"]));
  const byCommune = d
    ? `<ul class="zones">${BIKE_COMMUNES.map((c) => {
        const mine = d.stations.filter((s) => s.commune === c).sort((a, b) => b.velos_electriques + (b.trottinettes ?? 0) - (a.velos_electriques + (a.trottinettes ?? 0)) || a.nom.localeCompare(b.nom, "fr"));
        const n = d.communes?.find((x) => x.commune === c)?.velos_disponibles ?? 0;
        return `<li class="card"><h3>${esc(c)} <span class="note">${n} vélo${n > 1 ? "s" : ""}, ${mine.length} station${mine.length > 1 ? "s" : ""}</span></h3>` +
          `<ul class="rows bikes">${mine.map(bikeRow).join("")}</ul></li>`;
      }).join("")}</ul>` +
      `<p class="note">${esc(d.donnees)}</p>`
    : `<p class="card">L'état des stations se charge : rechargez la page dans quelques secondes.</p>`;

  const title = "Vélos Altervélo en direct : stations de Saint-Pierre, Saint-Louis, L'Étang-Salé";
  const description = d
    ? describe(`🇷🇪 Vélos électriques Altervélo en libre-service (974) en ce moment : ${total} vélos disponibles, et les places libres de chaque station à Saint-Pierre, Saint-Louis et L'Étang-Salé.`,
        "🇷🇪 Vélos électriques Altervélo en libre-service (974) : vélos et places libres de chaque station, en direct.")
    : "🇷🇪 Vélos électriques Altervélo en libre-service (974) : vélos et places libres de chaque station, en direct.";

  const band = `${crumbBar("Vélos")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>En direct</p>
    <h1>Vélos en libre-service <span class="n974">974</span></h1>
    ${status}
    ${ask(`Néna in vélo Altervélo i rès dan la stasion IUT ? Rogard si ${url} é di amwin.`,
      `Reste-t-il des vélos Altervélo à la station IUT de Saint-Pierre ? Lis ${url} et dis-le-moi.`)}
  </div>
  <figure class="card mapcard">${islandMap({ fills, label: "Carte de La Réunion (974) : les communes où circulent les vélos Altervélo" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Les communes desservies par Altervélo.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-stations">
  <div class="sec-h"><p class="eyebrow">Station par station</p><h2 id="h-stations">Vélos et places libres</h2>
  <p>${d ? esc(d.service) : "Altervélo : vélos à assistance électrique en libre-service de la CIVIS."}</p></div>
  ${byCommune}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("velos_libre_service", "les vélos du Sud")}`;

  return layout(origin, { title, description, path: "/velos", jsonld: [crumbs(origin, "Vélos", "/velos"), webPage(origin, "/velos", title, description, data)], alerte }, band, body);
}

export function velosLive(data: Cached<VelosAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d?.communes) return undefined;
  const total = d.communes.reduce((n, c) => n + c.velos_disponibles, 0);
  const best = [...d.stations].sort((a, b) => b.velos_electriques - a.velos_electriques)[0];
  return {
    valeur: `${total} vélo${total > 1 ? "s" : ""}`,
    detail: `disponibles dans ${d.stations.length} stations Altervélo${best?.velos_electriques ? `, dont ${best.velos_electriques} à ${esc(best.nom)} (${esc(best.commune)})` : ""}`,
  };
}

// ---------------------------------------------------------------- bornes de recharge

/** A station in a list: where it is, its power and plugs, how many points are free. */
export function borneRow(s: BorneStation): string {
  const free = s.libres ? `<b>${s.libres}</b> libre${s.libres > 1 ? "s" : ""} sur ${s.total}` : `aucun libre sur ${s.total}`;
  return `<li><span>${esc(s.station)}<small>${fr(s.puissance_max_kw)} kW · ${esc(s.prises.join(", "))}${s.horaires && s.horaires !== "24 h/24, 7 j/7" ? ` · ${esc(s.horaires)}` : ""}</small></span>` +
    `<span class="${s.libres ? "free" : "busy"}">${free}</span></li>`;
}

export function bornesPage(origin: string, data: Cached<BornesAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = fresh(`${origin}/bornes`, now);
  const libres = d?.stations.reduce((n, s) => n + s.libres, 0) ?? 0;
  const total = d?.stations.reduce((n, s) => n + s.total, 0) ?? 0;

  const status = !d
    ? loading("L'état des bornes")
    : `<div class="now"><span class="big">${libres}</span><p>point${libres > 1 ? "s" : ""} de charge libre${libres > 1 ? "s" : ""} en ce moment, sur <b>${total}</b> dans les ${d.stations.length} stations publiques de l'île.</p></div>`;

  // One marker per commune, where its stations are: how many points are free there.
  const markers = (d?.communes ?? []).map((c) => {
    const mine = d!.stations.filter((s) => s.commune === c.commune);
    const lon = mine.reduce((n, s) => n + s.lon, 0) / mine.length;
    const lat = mine.reduce((n, s) => n + s.lat, 0) / mine.length;
    const free = mine.reduce((n, s) => n + s.libres, 0);
    return { lon, lat, label: String(free), name: `${c.commune} : ${free} libre${free > 1 ? "s" : ""} sur ${c.points}`, round: true, color: free ? "#2b8a3e" : "#868e96" };
  });

  const fast = d ? d.stations.filter((s) => s.puissance_max_kw >= FAST_KW).sort((a, b) => b.libres - a.libres || b.puissance_max_kw - a.puissance_max_kw) : [];
  const byCommune = d
    ? `<ul class="zones">${d.communes.map((c) => {
        const mine = d.stations.filter((s) => s.commune === c.commune).sort((a, b) => b.libres - a.libres || b.puissance_max_kw - a.puissance_max_kw);
        const free = mine.reduce((n, s) => n + s.libres, 0);
        return `<li class="card"><h3>${esc(c.commune)} <span class="note">${free} libre${free > 1 ? "s" : ""} sur ${c.points}, ${c.stations} station${c.stations > 1 ? "s" : ""}</span></h3>` +
          `<ul class="rows bornes">${mine.map(borneRow).join("")}</ul></li>`;
      }).join("")}</ul>` +
      `<p class="note">${esc(d.donnees)}${d.avertissement ? ` ${esc(d.avertissement)}` : ""}</p>`
    : `<p class="card">L'état des bornes se charge : rechargez la page dans quelques secondes.</p>`;

  const title = "Bornes de recharge à La Réunion en direct : points libres, recharge rapide";
  const short = "🇷🇪 Bornes de recharge pour voiture électrique à La Réunion (974) : points libres, occupés ou hors service, en direct, station par station.";
  const description = d
    ? describe(`🇷🇪 Bornes de recharge à La Réunion (974) en ce moment : ${libres} points libres sur ${total}, la recharge rapide et chaque station, commune par commune.`, short)
    : short;

  const band = `${crumbBar("Recharge")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>En direct</p>
    <h1>Bornes de recharge <span class="n974">974</span></h1>
    ${status}
    ${ask(`Ousa mi pé roshar mon loto élèktrik vitman koté Sin-Pyèr ? Rogard si ${url} é di amwin.`,
      `Où recharger rapidement ma voiture électrique à Saint-Pierre ? Lis ${url} et dis-le-moi.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : les points de charge libres, commune par commune" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Points de charge libres en ce moment, par commune.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-rapide">
  <div class="sec-h"><p class="eyebrow">${fr(FAST_KW)} kW et plus</p><h2 id="h-rapide">Recharge rapide</h2>
  <p>Les stations où l'on recharge en une demi-heure à une heure, avec une prise Combo CCS ou CHAdeMO.</p></div>
  ${d ? `<div class="card"><ul class="rows bornes">${fast.map((s) => borneRow({ ...s, station: `${s.station}${s.station.endsWith(s.commune) ? "" : ` (${s.commune})`}` })).join("")}</ul></div>` : ""}
</section>
<section aria-labelledby="h-stations">
  <div class="sec-h"><p class="eyebrow">Station par station</p><h2 id="h-stations">Commune par commune</h2>
  <p>${d ? esc(d.recharge) : "Les bornes publiques de l'île et l'état de chacun de leurs points."}</p></div>
  ${byCommune}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("bornes_recharge", "les bornes de recharge")}`;

  return layout(origin, { title, description, path: "/bornes", jsonld: [crumbs(origin, "Recharge", "/bornes"), webPage(origin, "/bornes", title, description, data)], alerte }, band, body);
}

export function bornesLive(data: Cached<BornesAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d?.stations.length) return undefined;
  const libres = d.stations.reduce((n, s) => n + s.libres, 0);
  const fast = d.stations.filter((s) => s.puissance_max_kw >= FAST_KW && s.libres > 0).length;
  return {
    valeur: `${libres} point${libres > 1 ? "s" : ""} libre${libres > 1 ? "s" : ""}`,
    detail: `sur ${d.stations.reduce((n, s) => n + s.total, 0)}, dans ${d.stations.length} stations ; recharge rapide libre dans ${fast} station${fast > 1 ? "s" : ""}`,
  };
}

// ---------------------------------------------------------------- qualité de l'eau

const WATER_COLOR: Record<string, string> = { bonne: "#2b8a3e", moyenne: "#e8590c", mauvaise: "#c92a2a" };
const WATER_MARK: Record<string, string> = { bonne: "✓", moyenne: "~", mauvaise: "!" };
const dayFr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

function siteLine(s: EauAnswer["baignades"][number]): string {
  const last = s.derniers_prelevements[0];
  const q = s.qualite_dernier_prelevement;
  return `<li><span>${esc(s.site)}<small>dernier prélèvement le ${esc(s.dernier_prelevement)}` +
    (last ? ` · ${esc(last.enterocoques_100ml)} entérocoques et ${esc(last.e_coli_100ml)} E. coli pour 100 mL` : "") +
    (s.mauvais_sur_12_mois ? ` · ${s.mauvais_sur_12_mois} mauvais résultat${s.mauvais_sur_12_mois > 1 ? "s" : ""} sur 12 mois` : "") + `</small></span>` +
    `<span class="q-${q ?? "none"}">${q ? esc(q) : "pas de résultat"}</span></li>`;
}

function tapCard(c: EauAnswer["communes"][number]): string {
  const head = `<h3>${esc(c.commune)} <span class="note">${c.reseaux} réseau${c.reseaux > 1 ? "x" : ""}, ${c.analyses_6_mois} analyse${c.analyses_6_mois > 1 ? "s" : ""} en 6 mois</span></h3>`;
  if (!c.a_surveiller.length) {
    return `<li class="card">${head}<p>${c.analyses_6_mois ? "Toutes les analyses conformes" : "Pas d'analyse publiée"}${c.derniere_analyse ? ` (dernière le ${esc(dayFr(c.derniere_analyse))})` : ""}.</p></li>`;
  }
  return `<li class="card">${head}<ul class="rows eau">${c.a_surveiller.map((r) =>
    `<li><span>Réseau ${esc(r.reseau)}<small>${r.quartiers ? `${esc(r.quartiers)} · ` : ""}${(r.non_conformites ?? []).map((n) => `${esc(n.date)}${n.depassements ? ` : ${esc(n.depassements.join(", "))}` : ""}`).join(" ; ")}</small></span>` +
    `<span class="q-mauvaise">${r.non_conformes_6_mois} non conforme${r.non_conformes_6_mois > 1 ? "s" : ""}</span></li>`).join("")}</ul></li>`;
}

export function eauPage(origin: string, data: Cached<EauAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = fresh(`${origin}/eau`, now);
  const good = d?.baignades.filter((s) => s.qualite_dernier_prelevement === "bonne").length ?? 0;
  const notGood = d?.baignades.filter((s) => s.qualite_dernier_prelevement && s.qualite_dernier_prelevement !== "bonne") ?? [];
  const lastSample = d?.baignades.map((s) => s.dernier_prelevement.split("/").reverse().join("-")).sort().pop();
  const tapBad = d?.communes.filter((c) => c.non_conformes_6_mois) ?? [];

  const status = !d
    ? loading("La qualité de l'eau")
    : `<div class="now"><span class="big">${good}</span><p>plage${good > 1 ? "s" : ""} et bassin${good > 1 ? "s" : ""} sur <b>${d.baignades.length}</b> contrôlés par l'ARS en bonne qualité au dernier prélèvement` +
      `${lastSample ? ` (${esc(dayFr(lastSample))})` : ""}${notGood.length ? ` ; à surveiller : ${esc(notGood.map((s) => s.site).join(", "))}` : ""}.</p></div>`;

  const rank = (q?: string) => ["bonne", "moyenne", "mauvaise"].indexOf(q ?? "");
  // The worse last, drawn over the good ones next to them.
  const markers = [...(d?.baignades ?? [])].sort((a, b) => rank(a.qualite_dernier_prelevement) - rank(b.qualite_dernier_prelevement)).map((s) => {
    const q = s.qualite_dernier_prelevement ?? "";
    // Only the sites to watch carry their name: 26 names along the coast would cover each other.
    return { lon: s.lon, lat: s.lat, label: WATER_MARK[q] ?? "?", name: q === "bonne" ? `${s.site} : bonne` : s.site, round: true, color: WATER_COLOR[q] ?? "#868e96", quiet: q === "bonne" };
  });

  const sites = d
    ? `<ul class="zones">${[...new Set(d.baignades.map((s) => s.commune))].sort((a, b) => a.localeCompare(b, "fr")).map((c) => {
        const mine = d.baignades.filter((s) => s.commune === c);
        return `<li class="card"><h3>${esc(c)}</h3><ul class="rows eau">${mine.map(siteLine).join("")}</ul></li>`;
      }).join("")}</ul>`
    : `<p class="card">La qualité de l'eau se charge : rechargez la page dans quelques secondes.</p>`;

  const title = "Qualité de l'eau à La Réunion : plages, bassins et eau du robinet (974)";
  const short = "🇷🇪 Qualité de l'eau à La Réunion (974) : les plages et bassins contrôlés par l'ARS et l'eau du robinet de chaque commune, réseau par réseau.";
  const description = d
    ? describe(`🇷🇪 Qualité de l'eau à La Réunion (974) : ${good} plages et bassins sur ${d.baignades.length} en bonne qualité au dernier prélèvement de l'ARS, et l'eau du robinet des 24 communes, réseau par réseau.`, short)
    : short;

  const band = `${crumbBar("Qualité de l'eau")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Analyses de l'ARS</p>
    <h1>Qualité de l'eau <span class="n974">974</span></h1>
    ${status}
    ${ask(`Dlo lé bon pou bengn La Rényon ? Rogard si ${url} é di amwin pou la plaj l'Ermitaz é pou dlo robinè Sin-Pyèr.`,
      `L'eau est-elle bonne pour se baigner à La Réunion ? Lis ${url} et dis-moi pour la plage de l'Hermitage et l'eau du robinet à Saint-Pierre.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : la qualité de l'eau au dernier prélèvement de chaque plage et bassin contrôlé" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Qualité au dernier prélèvement : ✓ bonne, ~ moyenne, ! mauvaise.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-baignade">
  <div class="sec-h"><p class="eyebrow">Plages et bassins</p><h2 id="h-baignade">L'eau de baignade</h2>
  <p>${esc(EAU_TEXT.baignade)}</p></div>
  ${sites}
  ${d ? `<p class="note">${esc(d.a_savoir.eau_de_baignade)} ${esc(d.a_savoir.baignade_en_mer)}</p>` : ""}
</section>
<section aria-labelledby="h-robinet">
  <div class="sec-h"><p class="eyebrow">Commune par commune</p><h2 id="h-robinet">L'eau du robinet</h2>
  <p>${d ? `${tapBad.length ? `Des analyses non conformes en 6 mois dans ${tapBad.length} commune${tapBad.length > 1 ? "s" : ""} sur ${d.communes.length}, sur un ou deux réseaux chacune.` : "Toutes les analyses des 6 derniers mois sont conformes."} ` : ""}${esc(EAU_TEXT.robinet)}</p></div>
  ${d ? `<ul class="zones">${d.communes.map(tapCard).join("")}</ul><p class="note">${esc(d.a_savoir.eau_du_robinet)}</p>${data ? `<p class="note">Sources : ${esc(d.sources.map((x) => x.attribution).join(" ; "))}. Analyses rassemblées le ${esc(dayFr(d.lu))} à ${esc(hm(new Date(d.lu)))}.</p>` : ""}` : ""}
</section>
${connectorCta("qualite_eau", "la qualité de l'eau")}`;

  return layout(origin, { title, description, path: "/eau", jsonld: [crumbs(origin, "Qualité de l'eau", "/eau"), webPage(origin, "/eau", title, description, data)], alerte }, band, body);
}

const EAU_TEXT = {
  baignade: "Les 26 plages et bassins où l'ARS contrôle l'eau, avec le résultat de leur dernier prélèvement : bonne, moyenne ou mauvaise selon les germes trouvés (entérocoques intestinaux et E. coli).",
  robinet: "Chaque commune a plusieurs réseaux d'eau, du centre-ville aux écarts des Hauts : la qualité dépend du réseau qui dessert le quartier. Les réseaux ci-dessous ont eu au moins une analyse non conforme.",
};

export function eauLive(data: Cached<EauAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d?.baignades.length) return undefined;
  const good = d.baignades.filter((s) => s.qualite_dernier_prelevement === "bonne").length;
  return {
    valeur: `${good} site${good > 1 ? "s" : ""} sur ${d.baignades.length}`,
    detail: "plages et bassins en bonne qualité au dernier prélèvement de l'ARS ; l'eau du robinet commune par commune",
  };
}
