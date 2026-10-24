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
import type { AgendaAnswer, AirAnswer, Alerte, BorneStation, BornesAnswer, BusData, CalendrierAnswer, CoupuresAnswer, CyclonesAnswer, DaeAnswer, EauAnswer, ElectriciteAnswer, HistoriqueAnswer, SecheresseAnswer, SentiersAnswer, SportAnswer, VeloStation, VelosAnswer, VolcanAnswer } from "./data.js";
import { FAST_KW } from "../tools/bornes.js";
import island from "../places/island.json" with { type: "json" };
import { esc, islandMap, oceanMap } from "./map.js";
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

// ---------------------------------------------------------------- sentiers de randonnée

export function sentiersPage(origin: string, data: Cached<SentiersAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = fresh(`${origin}/sentiers`, now);
  const closed = d?.points.length ?? 0;

  const status = !d
    ? loading("L'état des sentiers")
    : `<div class="now"><span class="big">${closed}</span><p>sentier${closed > 1 ? "s" : ""} fermé${closed > 1 ? "s" : ""} sur <b>${d.suivis}</b> suivis par l'ONF` +
      `${d.carte_mise_a_jour ? `, d'après sa carte mise à jour le ${esc(d.carte_mise_a_jour.replace(" (ONF)", ""))}` : ""}.</p></div>`;

  const markers = (d?.points ?? []).map((p) => ({ lon: p.lon, lat: p.lat, label: "×", name: `${p.nom} : fermé`, round: true, color: "#c92a2a", quiet: true }));

  const byCommune = d
    ? `<ul class="zones">${d.fermes_par_commune.map((c) =>
        `<li class="card"><h3>${esc(c.commune)} <span class="note">${c.sentiers_fermes.length} fermé${c.sentiers_fermes.length > 1 ? "s" : ""}</span></h3><ul class="rows eau">` +
        c.sentiers_fermes.map((t) => `<li><span>${esc(t.sentier)}<small>${[t.cause, t.precision].filter(Boolean).map((x) => esc(x!)).join(" · ") || "fermé"}</small></span>` +
          `<span class="q-mauvaise">fermé</span></li>`).join("") + `</ul></li>`).join("")}</ul>`
    : `<p class="card">L'état des sentiers se charge : rechargez la page dans quelques secondes.</p>`;

  const roads = d?.routes_forestieres_fermees.length
    ? `<div class="card"><h3>Routes forestières interdites à la circulation</h3><ul class="rows eau">${d.routes_forestieres_fermees.map((r) =>
        `<li><span>${esc(r.route)}<small>${[r.cause, r.precision].filter(Boolean).map((x) => esc(x!)).join(" · ")}</small></span><span class="q-mauvaise">interdite</span></li>`).join("")}</ul></div>`
    : "";

  const title = "Sentiers fermés à La Réunion aujourd'hui : la liste de l'ONF, cirque par cirque";
  const short = "🇷🇪 Sentiers de randonnée fermés à La Réunion (974) : la liste de l'ONF commune par commune, avec la cause de chaque fermeture.";
  const description = d
    ? describe(`🇷🇪 Sentiers fermés à La Réunion (974) : ${closed} sentiers fermés sur ${d.suivis} d'après la carte de l'ONF, commune par commune, avec la cause (éboulement, sentier dégradé, travaux).`, short)
    : short;

  const band = `${crumbBar("Randonnée")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Carte de l'ONF</p>
    <h1>Sentiers fermés <span class="n974">974</span></h1>
    ${status}
    ${ask(`Lo santyé Roche Plate lé ouvèr ? Rogard si ${url} é di amwin si mi pé désann Mafate.`,
      `Le sentier de Roche Plate est-il ouvert ? Lis ${url} et dis-moi si je peux descendre dans Mafate.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : les sentiers de randonnée fermés" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Chaque croix est un sentier fermé.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-fermes">
  <div class="sec-h"><p class="eyebrow">Commune par commune</p><h2 id="h-fermes">Les sentiers fermés</h2>
  <p>Les sentiers gérés par l'ONF fermés par arrêté préfectoral ou par décision de l'ONF, avec la cause et, quand elle est connue, la date de réouverture. Les autres sentiers suivis par l'ONF sont ouverts.</p></div>
  ${byCommune}
  ${roads}
  ${d ? warnings(d.a_savoir) : ""}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("sentiers_randonnee", "les sentiers de randonnée")}`;

  return layout(origin, { title, description, path: "/sentiers", jsonld: [crumbs(origin, "Randonnée", "/sentiers"), webPage(origin, "/sentiers", title, description, data)], alerte }, band, body);
}

export function sentiersLive(data: Cached<SentiersAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const n = d.points.length;
  return { valeur: `${n} sentier${n > 1 ? "s" : ""} fermé${n > 1 ? "s" : ""}`, detail: `sur ${d.suivis} suivis par l'ONF, avec la cause de chaque fermeture` };
}

// ---------------------------------------------------------------- sécheresse

const DROUGHT_COLOR: Record<string, string> = { vigilance: "#ffd43b", alerte: "#ff922b", "alerte renforcée": "#f03e3e", crise: "#862e9c" };
const DROUGHT_ORDER = ["crise", "alerte renforcée", "alerte", "vigilance"];
const droughtBadge = (n?: string) => (n ? `<span class="lvl" style="--c:${DROUGHT_COLOR[n] ?? "#868e96"}">${esc(n)}</span>` : `<span class="note">aucune</span>`);

export function secheressePage(origin: string, data: Cached<SecheresseAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = fresh(`${origin}/secheresse`, now);
  const hit = d?.communes.filter((c) => c.eau_du_robinet && c.eau_du_robinet !== "vigilance") ?? [];

  const fills: Record<string, string> = {};
  for (const c of d?.communes ?? []) {
    const nm = MAP_NAME.get(normalize(c.commune));
    if (nm && c.eau_du_robinet) fills[nm] = DROUGHT_COLOR[c.eau_du_robinet] ?? "";
  }

  const status = !d
    ? loading("Les restrictions d'eau")
    : d.communes.length
      ? `<div class="now"><span class="big">${hit.length}</span><p>commune${hit.length > 1 ? "s" : ""} sur 24 en alerte ou plus pour l'eau du robinet${d.arrete_du ? `, d'après l'arrêté préfectoral en vigueur depuis le ${esc(d.arrete_du)}` : ""}.</p></div>`
      : `<p class="lead">${esc(d.resume)}</p>`;

  const table = d?.communes.length
    ? `<div class="card table-wrap"><table class="drought"><thead><tr><th>Commune</th><th>Eau du robinet</th><th>Rivières et sources</th><th>Nappes</th></tr></thead><tbody>${d.communes.map((c) =>
        `<tr><th scope="row">${esc(c.commune)}</th><td>${droughtBadge(c.eau_du_robinet)}</td><td>${droughtBadge(c.rivieres_et_sources)}</td><td>${droughtBadge(c.nappes)}</td></tr>`).join("")}</tbody></table></div>`
    : "";

  const rules = (d?.interdits ?? []).sort((x, y) => DROUGHT_ORDER.indexOf(x.niveau) - DROUGHT_ORDER.indexOf(y.niveau)).map((x) =>
    `<li class="card"><h3>${droughtBadge(x.niveau)} <span class="note">${esc(x.communes.join(", "))}</span></h3><ul class="rows eau">` +
    (x.restrictions.length ? x.restrictions.map((r) => `<li><span>${esc(r.usage)}<small>${esc(r.restriction)}</small></span><span></span></li>`).join("") : `<li><span>Économiser l'eau : pas d'interdiction pour un particulier.</span><span></span></li>`) +
    `</ul></li>`).join("");

  const title = "Sécheresse à La Réunion : restrictions d'eau par commune (arrêté en vigueur)";
  const short = "🇷🇪 Restrictions d'eau à La Réunion (974) : le niveau de sécheresse de chaque commune et ce qui est interdit (arrosage, lavage, piscine), d'après l'arrêté préfectoral.";
  const description = d ? describe(`🇷🇪 ${d.resume}`, short) : short;

  const band = `${crumbBar("Sécheresse")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Arrêté en vigueur</p>
    <h1>Sécheresse <span class="n974">974</span></h1>
    ${status}
    ${ask(`Mi gingn arouz mon zardin Sin-Zozèf ? Rogard si ${url} é di amwin sak lé défandi.`,
      `Ai-je le droit d'arroser mon jardin à Saint-Joseph ? Lis ${url} et dis-moi ce qui est interdit.`)}
  </div>
  <figure class="card mapcard">${islandMap({ fills, label: "Carte de La Réunion (974) colorée par le niveau de restriction de l'eau du robinet de chaque commune" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Eau du robinet : <span style="color:#ffd43b">vigilance</span>, <span style="color:#ff922b">alerte</span>, <span style="color:#f03e3e">alerte renforcée</span>, <span style="color:#d0a4e0">crise</span>.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-communes-eau">
  <div class="sec-h"><p class="eyebrow">Commune par commune</p><h2 id="h-communes-eau">Les niveaux de restriction</h2>
  <p>${d ? esc(d.resume) : ""} ${d ? esc(d.echelle) : ""}</p></div>
  ${table || (d ? "" : `<p class="card">Les restrictions se chargent : rechargez la page dans quelques secondes.</p>`)}
</section>
${rules ? `<section aria-labelledby="h-interdits">
  <div class="sec-h"><p class="eyebrow">Pour un particulier</p><h2 id="h-interdits">Ce qui est interdit</h2>
  <p>Les usages de l'eau du robinet limités à chaque niveau. Les agriculteurs, entreprises et collectivités ont leurs propres règles : demandez à votre IA avec le connecteur.</p></div>
  <ul class="zones">${rules}</ul>
  ${d ? `<p class="note">${esc(d.a_savoir)}</p>` : ""}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>` : ""}
${connectorCta("restrictions_eau", "les restrictions d'eau")}`;

  return layout(origin, { title, description, path: "/secheresse", jsonld: [crumbs(origin, "Sécheresse", "/secheresse"), webPage(origin, "/secheresse", title, description, data)], alerte }, band, body);
}

export function secheresseLive(data: Cached<SecheresseAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  if (!d.communes.length) return { valeur: "aucune restriction", detail: "d'après VigiEau" };
  const worst = DROUGHT_ORDER.find((n) => d.communes.some((c) => c.eau_du_robinet === n));
  const hit = d.communes.filter((c) => c.eau_du_robinet && c.eau_du_robinet !== "vigilance").length;
  return { valeur: worst ? `jusqu'à ${worst}` : "vigilance", detail: `${hit} commune${hit > 1 ? "s" : ""} sur 24 en alerte ou plus pour l'eau du robinet` };
}

// ---------------------------------------------------------------- coupures d'eau

function noticeCard(n: CoupuresAnswer["avis"][number]): string {
  const cut = n.coupure ? `<p><b>${esc(n.coupure.de ?? "")}${n.coupure.a ? ` → ${esc(n.coupure.a)}` : ""}</b>${n.coupure.etat ? ` <span class="note">(${esc(n.coupure.etat)})</span>` : ""}</p>` : "";
  return `<li class="card${n.ne_pas_boire ? " warn" : ""}"><h3>${n.ne_pas_boire ? "Ne pas boire l'eau · " : ""}${esc(n.communes.join(", "))} <span class="note">${esc(n.distributeur)}, publié le ${esc(n.publie_le)}</span></h3>` +
    `<p>${esc(n.titre)}</p>${cut}${n.secteurs ? `<p class="note">Secteurs : ${esc(n.secteurs.join(", "))}</p>` : ""}` +
    `<p class="note">${esc(n.texte.length > 320 ? `${n.texte.slice(0, 320)}…` : n.texte)} <a href="${esc(n.lien)}" rel="noopener">L'avis complet</a></p></li>`;
}

export function coupuresPage(origin: string, data: Cached<CoupuresAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = fresh(`${origin}/coupures-eau`, now);
  const dry = d?.ne_pas_boire ?? [];

  const fills: Record<string, string> = {};
  for (const c of d?.communes_suivies ?? []) {
    const nm = MAP_NAME.get(normalize(c));
    if (!nm) continue;
    fills[nm] = dry.includes(c) ? "#f03e3e" : d!.avis.some((n) => n.communes.includes(c)) ? "#4dabf7" : "#a5d8ff";
  }

  const status = !d
    ? loading("Les avis des distributeurs")
    : `<div class="now"><span class="big">${d.avis.length}</span><p>avis de coupure ou de travaux récents ou à venir` +
      `${dry.length ? ` ; <b>eau à ne pas boire</b> : ${esc(dry.join(", "))}` : ""}.</p></div>`;

  const list = d
    ? d.avis.length
      ? `<ul class="zones">${[...d.avis].sort((x, y) => Number(!!y.ne_pas_boire) - Number(!!x.ne_pas_boire)).map(noticeCard).join("")}</ul>`
      : `<p class="card">Aucun avis de coupure récent ou à venir dans les communes suivies.</p>`
    : `<p class="card">Les avis se chargent : rechargez la page dans quelques secondes.</p>`;

  const title = "Coupure d'eau à La Réunion aujourd'hui : avis des distributeurs, eau non potable";
  const short = "🇷🇪 Coupures d'eau à La Réunion (974) : les avis de Dionéo, des Eaux de La Possession et de la CIREST, heures, rues concernées et avis « ne pas boire l'eau ».";
  const description = d ? describe(`🇷🇪 ${d.resume} Coupures d'eau à La Réunion (974) : heures, rues concernées et avis « ne pas boire l'eau ».`, short) : short;

  const band = `${crumbBar("Coupures d'eau")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Avis des distributeurs</p>
    <h1>Coupures d'eau <span class="n974">974</span></h1>
    ${status}
    ${ask(`Néna koupir dolo Sin-Dni ? Rogard si ${url} é di amwin kansa dolo i rovien.`,
      `Y a-t-il une coupure d'eau à Saint-Denis ? Lis ${url} et dis-moi quand l'eau revient.`)}
  </div>
  <figure class="card mapcard">${islandMap({ fills, label: "Carte de La Réunion (974) : les communes dont les avis de coupure d'eau sont suivis" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Communes suivies : <span style="color:#f03e3e">eau à ne pas boire</span>, <span style="color:#4dabf7">avis en cours</span>, <span style="color:#a5d8ff">aucun avis</span>.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-avis">
  <div class="sec-h"><p class="eyebrow">Récents ou à venir</p><h2 id="h-avis">Les avis</h2>
  <p>${d ? esc(d.couverture) : ""}</p></div>
  ${list}
  ${d ? `<p class="note">${esc(d.a_savoir)}</p>` : ""}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("coupures_eau", "les coupures d'eau")}`;

  return layout(origin, { title, description, path: "/coupures-eau", jsonld: [crumbs(origin, "Coupures d'eau", "/coupures-eau"), webPage(origin, "/coupures-eau", title, description, data)], alerte }, band, body);
}

export function coupuresLive(data: Cached<CoupuresAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const dry = d.ne_pas_boire ?? [];
  return {
    valeur: dry.length ? `ne pas boire : ${esc(dry.join(", "))}` : `${d.avis.length} avis`,
    detail: dry.length ? `${d.avis.length} avis de coupure ou de travaux récents ou à venir` : "de coupure ou de travaux récents ou à venir",
  };
}

// ---------------------------------------------------------------- défibrillateurs

const shortAccess = (a: string) =>
  a.includes("extérieur") ? "dehors, 24 h/24" : a.includes("24 h") ? "24 h/24" : a.includes("accès libre") ? "horaires du lieu" : "accès réservé";

export function daePage(origin: string, data: Cached<DaeAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = fresh(`${origin}/defibrillateurs`, now);
  const markers = (d?.communes ?? []).map((c) => ({ lon: c.lon, lat: c.lat, label: String(c.nombre), name: `${c.commune} : ${c.nombre} défibrillateurs`, round: true, color: "#2b8a3e", quiet: true }));

  const status = !d
    ? loading("La liste des défibrillateurs")
    : `<div class="now"><span class="big">${d.total}</span><p>défibrillateurs déclarés en service dans les 24 communes de l'île.</p></div>`;

  const list = d
    ? `<ul class="zones">${d.communes.map((c) =>
        `<li class="card"><h3>${esc(c.commune)} <span class="note">${c.nombre} défibrillateur${c.nombre > 1 ? "s" : ""}${c.toute_heure ? `, dont ${c.toute_heure} accessible${c.toute_heure > 1 ? "s" : ""} à toute heure` : ""}</span></h3><ul class="rows eau">` +
        c.liste.map((x) => `<li><span>${esc(x.lieu)}<small>${[x.adresse, x.emplacement, x.etage ? `étage ${x.etage}` : ""].filter(Boolean).map((v) => esc(v!)).join(" · ")}</small></span>` +
          `<span class="${x.acces.includes("toute heure") || x.acces.includes("24 h") ? "q-bonne" : "q-none"}">${esc(shortAccess(x.acces))}</span></li>`).join("") +
        (c.nombre > c.liste.length ? `<li><span class="note">et ${c.nombre - c.liste.length} autres : demandez le plus proche à votre IA.</span><span></span></li>` : "") +
        `</ul></li>`).join("")}</ul>`
    : "";

  const title = "Défibrillateurs à La Réunion : où trouver le plus proche (974)";
  const description = "🇷🇪 Défibrillateurs (DAE) à La Réunion (974) : plus de 1 200 appareils dans les 24 communes, d'après la base nationale Géo'DAE, et le plus proche d'un lieu avec votre IA.";

  const band = `${crumbBar("Défibrillateurs")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Base nationale Géo'DAE</p>
    <h1>Défibrillateurs <span class="n974">974</span></h1>
    ${status}
    ${d ? `<p class="lead"><b>${esc(d.urgence)}</b></p>` : ""}
    ${ask(`Ousa néna in défibrilatèr pli prés la plaj l'Ermitaz ? Rogard si ${url} é di amwin.`,
      `Où est le défibrillateur le plus proche de la plage de l'Hermitage ? Lis ${url} et dis-le-moi.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : le nombre de défibrillateurs par commune" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Nombre de défibrillateurs par commune.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-dae">
  <div class="sec-h"><p class="eyebrow">Commune par commune</p><h2 id="h-dae">Où sont les défibrillateurs</h2>
  <p>Ceux qu'on peut atteindre à toute heure d'abord (à l'extérieur ou ouverts 24 h/24), puis ceux en accès libre aux heures d'ouverture du lieu. La liste est déclarée par les exploitants : un appareil peut avoir été déplacé.</p></div>
  ${list}
  <p class="note">Source : Géo'DAE, base nationale des défibrillateurs (ministère chargé de la santé), Licence Ouverte 2.0.</p>
</section>
${connectorCta("defibrillateurs", "les défibrillateurs")}`;

  return layout(origin, { title, description, path: "/defibrillateurs", jsonld: [crumbs(origin, "Défibrillateurs", "/defibrillateurs"), webPage(origin, "/defibrillateurs", title, description, data)], alerte }, band, body);
}

// ---------------------------------------------------------------- sport

const SPORT_LISTED = 8;
const SPORT_ORDER = ["handball", "volley-ball", "voile", "golf", "sport auto"];
const sportName = (s: string) => (s === "sport auto" ? "Sport automobile" : s.charAt(0).toUpperCase() + s.slice(1));

/** « vendredi 30/10 à 20:30 » → « ven. 30/10, 20:30 » ; « du samedi 24/10 au dimanche 25/10 » → « 24/10 → 25/10 ». */
const shortWhen = (q: string) =>
  q.startsWith("du ") ? q.replace(/^du \S+ (\S+) au \S+ (\S+)$/, "$1 → $2") : q.replace(/^(\S{3})\S* /, "$1. ").replace(" à ", ", ");

function sportRow(r: SportAnswer["resultats"] extends (infer T)[] | undefined ? T : never, withScore: boolean): string {
  const small = [r.competition, withScore ? shortWhen(r.quand) : "", r.lieu, r.detail && !withScore ? r.detail : ""].filter(Boolean).map((x) => esc(x!)).join(" · ");
  const right = withScore
    ? `<span class="score">${esc(r.score ?? "")}</span>`
    : r.etat === "annulée" || r.etat === "reportée" ? `<span class="q-mauvaise">${esc(r.etat)}</span>` : `<span class="q-none">${esc(shortWhen(r.quand))}</span>`;
  // A match links nowhere of its own: its championship's page is linked once, under the standings.
  const name = r.lien && !r.competition ? `<a href="${esc(r.lien)}" rel="noopener">${esc(r.epreuve)}</a>` : esc(r.epreuve);
  return `<li><span>${name}<small>${small}${withScore && r.detail ? ` · ${esc(r.detail)}` : ""}</small></span>${right}</li>`;
}

function bySport(rows: NonNullable<SportAnswer["a_venir"]>, withScore: boolean): string {
  const groups = SPORT_ORDER.map((sp) => ({ sp, list: rows.filter((r) => r.sport === sp) })).filter((g) => g.list.length);
  return `<ul class="zones">${groups.map((g) =>
    `<li class="card"><h3>${esc(sportName(g.sp))} <span class="note">${g.list.length} ${withScore ? "résultat" : "rendez-vous"}${withScore && g.list.length > 1 ? "s" : ""}</span></h3>` +
    `<ul class="rows eau">${g.list.slice(0, SPORT_LISTED).map((r) => sportRow(r, withScore)).join("")}` +
    (g.list.length > SPORT_LISTED ? `<li><span class="note">et ${g.list.length - SPORT_LISTED} autres : demandez-les à votre IA.</span><span></span></li>` : "") +
    `</ul></li>`).join("")}</ul>`;
}

export function sportPage(origin: string, data: Cached<SportAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = fresh(`${origin}/sport`, now);
  const upcoming = (d?.a_venir ?? []).filter((r) => r.etat !== "annulée");
  const soon = upcoming.slice(0, 7);

  const status = !d
    ? loading("Le calendrier du sport")
    : `<div class="now"><span class="big">${upcoming.length}</span><p>rendez-vous officiels dans les quinze prochains jours : handball, volley, voile, golf et sport automobile.</p></div>`;

  const next = soon.length
    ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">Les prochains rendez-vous</h3><ul class="plain">${soon.map((r) =>
        `<li><b>${esc(r.quand)}</b> : ${esc(r.epreuve)} <span class="note" style="color:var(--on-night-muted)">(${esc(r.competition ? `${r.sport}, ${r.competition}` : r.sport)})</span></li>`).join("")}</ul></figure>`
    : "";

  const standings = d?.classements.length
    ? `<ul class="zones">${d.classements.map((c) =>
        `<li class="card"><h3><a href="${esc(c.lien)}" rel="noopener">${esc(c.competition)}</a></h3><ul class="rows eau">${c.lignes.map((l) =>
          `<li><span>${l.place}. ${esc(l.equipe)}<small>${l.joues} match${l.joues > 1 ? "s" : ""} joué${l.joues > 1 ? "s" : ""}</small></span><span class="score">${l.points} pts</span></li>`).join("")}</ul></li>`).join("")}</ul>`
    : "";

  const raid = d?.grand_raid
    ? `<section aria-labelledby="h-raid">
  <div class="sec-h"><p class="eyebrow">${esc(d.grand_raid.dates)}</p><h2 id="h-raid">${esc(d.grand_raid.edition)}</h2>
  <p>Les cinq courses, leurs partants, arrivants et abandons, et les podiums publiés par l'organisateur. Pendant la course, le connecteur donne qui est en tête et combien sont encore en course.</p></div>
  <ul class="zones">${d.grand_raid.courses.map((c) =>
    `<li class="card"><h3>${esc(c.course)} <span class="note">${esc(c.statut)}</span></h3><p class="note">Départ ${esc(c.depart)}${c.partants ? ` · ${c.partants} partants` : ""}${c.arrives ? `, ${c.arrives} arrivés` : ""}${c.abandons ? `, ${c.abandons} abandons` : ""}${c.en_course ? `, ${c.en_course} en course` : ""}</p>` +
    (c.podium ? `<ul class="plain">${c.podium.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "") +
    (c.podium_femmes ? `<p class="note">Femmes : ${c.podium_femmes.map((p) => esc(p)).join(" ; ")}</p>` : "") + `</li>`).join("")}</ul>
  <p class="note"><a href="${esc(d.grand_raid.lien)}" rel="noopener">Tous les classements sur Livetrail</a></p>
</section>`
    : "";

  const news = d?.actualite?.length
    ? `<section aria-labelledby="h-actu">
  <div class="sec-h"><p class="eyebrow">Réunion La 1ère</p><h2 id="h-actu">L'actualité du sport</h2>
  <p>Les derniers articles de la rédaction sport de Réunion La 1ère, dont les comptes rendus du football régional.</p></div>
  <ul class="card plain">${d.actualite.map((n) => `<li><a href="${esc(n.lien)}" rel="noopener">${esc(n.titre)}</a> <span class="note">${esc(n.publie_le)}</span></li>`).join("")}</ul>
</section>`
    : "";

  const title = "Sport à La Réunion : matchs du week-end, résultats, classements, Grand Raid (974)";
  const description = "🇷🇪 Sport à La Réunion (974) : matchs à venir et résultats du handball et du volley régionaux, classements, régates, golf, rallyes et podiums du Grand Raid.";

  const band = `${crumbBar("Sport")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Calendriers et résultats officiels</p>
    <h1>Sport <span class="n974">974</span></h1>
    ${status}
    ${ask(`Kosa néna konm match sé wikenn la ? Rogard si ${url} é di amwin.`,
      `Quels matchs et quelles compétitions ce week-end à La Réunion ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${next}
</div>`;

  const body = `<section aria-labelledby="h-venir">
  <div class="sec-h"><p class="eyebrow">Quinze prochains jours</p><h2 id="h-venir">À venir</h2>
  <p>Les matchs des championnats régionaux de handball (D1) et de volley (R1), les régates de la Ligue de voile, les compétitions des trois golfs et le calendrier de la Ligue du sport automobile. Heures de La Réunion.</p></div>
  ${d ? (d.a_venir?.length ? bySport(d.a_venir, false) : `<p class="card">Aucun rendez-vous trouvé dans les quinze prochains jours.</p>`) : `<p class="card">Le calendrier se charge : rechargez la page dans quelques secondes.</p>`}
</section>
${d?.resultats?.length ? `<section aria-labelledby="h-res">
  <div class="sec-h"><p class="eyebrow">Sept derniers jours</p><h2 id="h-res">Derniers résultats</h2></div>
  ${bySport(d.resultats, true)}
</section>` : ""}
${standings ? `<section aria-labelledby="h-class">
  <div class="sec-h"><p class="eyebrow">Championnats régionaux</p><h2 id="h-class">Classements</h2></div>
  ${standings}
</section>` : ""}
${raid}
${news}
<section aria-labelledby="h-src">
  <div class="sec-h"><h2 id="h-src">Ce qui n'est pas couvert</h2><p>${d ? esc(d.non_couvert) : ""}</p></div>
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("sport", "le sport")}`;

  return layout(origin, { title, description, path: "/sport", jsonld: [crumbs(origin, "Sport", "/sport"), webPage(origin, "/sport", title, description, data)], alerte }, band, body);
}

export function sportLive(data: Cached<SportAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const upcoming = (d.a_venir ?? []).filter((r) => r.etat !== "annulée");
  const first = upcoming[0];
  return { valeur: `${upcoming.length} rendez-vous`, detail: first ? `d'ici quinze jours ; prochain : ${esc(first.epreuve)}, ${esc(first.quand)}` : "d'ici quinze jours" };
}

// ---------------------------------------------------------------- cyclones

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function activeCard(r: NonNullable<CyclonesAnswer["systemes_actifs"]>[number]): string {
  const facts = [
    ["Position", `${r.situation}, ${r.position.heure}`],
    ["Vent moyen", r.vent_moyen_kmh ? `${r.vent_moyen_kmh} km/h${r.rafales_kmh ? `, rafales ${r.rafales_kmh} km/h` : ""}` : undefined],
    ["Pression", r.pression_hpa ? `${r.pression_hpa} hPa` : undefined],
    ["Déplacement", r.deplacement],
    ["Au plus près", r.au_plus_pres_selon_la_prevision ? `${r.au_plus_pres_selon_la_prevision.distance_km} km, ${r.au_plus_pres_selon_la_prevision.heure} (${r.au_plus_pres_selon_la_prevision.stade}), selon la prévision du CMRS` : r.s_eloigne ? "maintenant : la prévision du CMRS l'éloigne de l'île" : undefined],
  ].filter((f): f is [string, string] => !!f[1]);
  const forecast = r.prevision_cmrs?.length
    ? `<div class="table-wrap"><table class="drought"><thead><tr><th>Prévision du CMRS</th><th>Stade</th><th>Vent moyen</th><th>Distance de l'île</th></tr></thead><tbody>${r.prevision_cmrs.map((p) =>
        `<tr><th scope="row">${esc(p.heure)}</th><td>${esc(p.stade)}</td><td>${p.vent_moyen_kmh} km/h</td><td>${p.distance_km} km ${esc(p.situation)}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  return `<article class="card"><h3>${esc(capital(r.nom))} <span class="note">${esc(r.stade)}</span></h3>` +
    `<div class="table-wrap"><table class="drought"><tbody>${facts.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div>${forecast}` +
    `<p class="note">Vent le plus fort atteint : ${r.vent_max_atteint_kmh ?? "—"} km/h. Bulletins : ${esc(r.centre)}, <a href="${esc(r.rapport)}" rel="noopener">fiche GDACS</a>.</p></article>`;
}

function seasonTable(s: CyclonesAnswer["saison_en_cours"]): string {
  return s.systemes.length
    ? `<div class="card table-wrap"><table class="drought"><thead><tr><th>Système</th><th>Dates</th><th>Au plus fort</th><th>Vent moyen max.</th></tr></thead><tbody>${s.systemes.map((x) =>
        `<tr><th scope="row"><a href="${esc(x.rapport)}" rel="noopener">${esc(capital(x.nom))}</a></th><td>${esc(x.du)} – ${esc(x.au)}</td><td>${esc(x.stade_max ?? "—")}</td><td>${x.vent_max_kmh ? `${x.vent_max_kmh} km/h` : "—"}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="card">Aucun système pour le moment.</p>`;
}

export function cyclonesPage(origin: string, data: Cached<CyclonesAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = fresh(`${origin}/cyclones`, now);
  const active = d?.systemes_actifs ?? [];

  const status = !d
    ? loading("Le suivi des cyclones")
    : `<div class="now"><span class="big">${active.length}</span><p>système${active.length > 1 ? "s" : ""} tropica${active.length > 1 ? "ux" : "l"} actif${active.length > 1 ? "s" : ""} dans le sud-ouest de l'océan Indien${active.length ? `, le plus proche ${esc(active[0].situation)}` : ""}.</p></div>`;

  const tracks = (d?.traces ?? []).map((t) => ({ name: capital(t.nom), past: t.observee, forecast: t.prevue, label: t.etiquette, active: t.actif }));
  const map = d
    ? `<figure class="card mapcard">${oceanMap({ tracks, home: { lon: 55.536, lat: -21.115 }, label: active.length ? "Carte du sud-ouest de l'océan Indien : trajectoire et prévision des systèmes tropicaux actifs autour de La Réunion" : "Carte du sud-ouest de l'océan Indien : la trajectoire du dernier système tropical" })}
  <figcaption class="note" style="color:var(--on-night-muted)">${active.length ? "Trajectoire observée (trait plein) et prévue par le CMRS de La Réunion (pointillés)." : tracks.length ? `Aucun système actif. Trajectoire du dernier système, ${esc(tracks[0].name)}.` : "Aucun système actif."} Cercles à 500 et 1 000 km de l'île.</figcaption></figure>`
    : "";

  const title = "Cyclone à La Réunion en ce moment : trajectoire, distance, alerte (974)";
  const short = "🇷🇪 Cyclones autour de La Réunion (974) : systèmes tropicaux actifs, trajectoire et prévision du CMRS de Météo-France, distance de l'île, alerte cyclonique et saisons passées.";
  const description = d ? describe(`🇷🇪 ${d.resume}`, short) : short;

  const band = `${crumbBar("Cyclones")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Bulletins du CMRS de La Réunion</p>
    <h1>Cyclones <span class="n974">974</span></h1>
    ${status}
    ${d?.alerte_cyclonique ? `<p class="lead"><b>${esc(d.alerte_cyclonique)}</b></p>` : ""}
    ${ask(`Néna in siklone pa loin La Rényon ? Rogard si ${url} é di amwin ousa li lé.`,
      `Y a-t-il un cyclone près de La Réunion ? Lis ${url} et dis-moi où il est et où il va.`)}
  </div>
  ${map}
</div>`;

  const body = `<section aria-labelledby="h-actifs">
  <div class="sec-h"><p class="eyebrow">En ce moment</p><h2 id="h-actifs">Systèmes actifs</h2>
  <p>${d ? esc(d.resume) : ""}</p></div>
  ${d ? active.map(activeCard).join("") : `<p class="card">Le suivi se charge : rechargez la page dans quelques secondes.</p>`}
</section>
<section aria-labelledby="h-alerte">
  <div class="sec-h"><p class="eyebrow">Préfecture de La Réunion</p><h2 id="h-alerte">Les phases de l'alerte cyclonique</h2>
  <p>${d ? esc(d.phases_alerte) : ""}</p></div>
  <div class="card"><ul class="plain">
    <li><a href="https://meteofrance.re/fr/cyclone" rel="noopener">Activité cyclonique et bulletins de Météo-France La Réunion</a></li>
    <li><a href="https://vigilance.meteofrance.fr/fr/la-reunion" rel="noopener">Vigilance et alerte cyclonique en cours (Météo-France)</a></li>
    <li><a href="https://www.reunion.gouv.fr" rel="noopener">Consignes de la préfecture de La Réunion</a></li>
    <li><a href="${esc(origin)}/vigilance">La vigilance du moment sur rundata.re</a></li>
  </ul></div>
</section>
${d ? `<section aria-labelledby="h-saison">
  <div class="sec-h"><p class="eyebrow">Juillet à juin</p><h2 id="h-saison">Saison ${esc(d.saison_en_cours.nom)}</h2><p>${esc(d.saison)}</p></div>
  ${seasonTable(d.saison_en_cours)}
</section>` : ""}
${d?.saison_precedente ? `<section aria-labelledby="h-saison-prec">
  <div class="sec-h"><p class="eyebrow">Saison passée</p><h2 id="h-saison-prec">Saison ${esc(d.saison_precedente.nom)}</h2>
  <p>Les systèmes du bassin et le stade atteint au plus fort, d'après le vent moyen sur 10 minutes.</p></div>
  ${seasonTable(d.saison_precedente)}
</section>` : ""}
${d ? `<section aria-labelledby="h-src"><div class="sec-h"><h2 id="h-src">D'où viennent ces données</h2><p>${esc(d.a_savoir)}</p></div>${data ? sourcesNote(d.sources, data) : ""}</section>` : ""}
${connectorCta("cyclones", "les cyclones")}`;

  return layout(origin, { title, description, path: "/cyclones", jsonld: [crumbs(origin, "Cyclones", "/cyclones"), webPage(origin, "/cyclones", title, description, data)], alerte }, band, body);
}

export function cyclonesLive(data: Cached<CyclonesAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const active = d.systemes_actifs ?? [];
  if (active.length) {
    const r = active[0];
    return { valeur: `${active.length} système${active.length > 1 ? "s" : ""} actif${active.length > 1 ? "s" : ""}`, detail: `${esc(capital(r.nom))}, ${esc(r.stade)}, ${esc(r.situation)}` };
  }
  const last = d.saison_en_cours.systemes[0] ?? d.saison_precedente?.systemes[0];
  return { valeur: "aucun système actif", detail: `saison ${esc(d.saison_en_cours.nom)}${last ? ` ; dernier : ${esc(capital(last.nom))} (${esc(last.du)} – ${esc(last.au)})` : ""}` };
}

// ---------------------------------------------------------------- historique météo

const pct = (x?: string) => (x ? Number.parseInt(x, 10) : undefined);
/** A bar of the rain against the normal: 100 % is the normal. */
function rainBar(total: number, normal?: number): string {
  if (normal == null || normal <= 0) return `<b>${fr(total)} mm</b>`;
  const ratio = total / normal;
  const w = Math.min(ratio, 2) * 50;
  const c = ratio < 0.5 ? "#ff922b" : ratio > 1.5 ? "#4dabf7" : "#69db7c";
  return `<b>${fr(total)} mm</b><small class="note">normale ${normal} mm</small><span class="ratio" role="img" aria-label="${Math.round(ratio * 100)} % de la normale"><i style="width:${w}%;background:${c}"></i><s></s></span>`;
}
const vsNormal = (v?: number, n?: number, unit = " °C") =>
  v == null ? "—" : `<b>${fr(v)}${unit}</b>${n != null ? `<small class="note">normale ${fr(n)}${unit}</small>` : ""}`;

export function historiquePage(origin: string, data: Cached<HistoriqueAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = fresh(`${origin}/historique`, now);
  const rows = d?.stations ?? [];
  const below = rows.filter((r) => (pct(r.pluie?.rapport_a_la_normale) ?? 100) < 80).length;
  const withNormal = rows.filter((r) => r.pluie?.rapport_a_la_normale).length;

  const markers = rows.flatMap((r) => {
    const x = pct(r.pluie?.rapport_a_la_normale);
    return x == null ? [] : [{ lon: r.lon, lat: r.lat, label: `${x} %`, name: r.station, color: x < 50 ? "#ff922b" : x > 150 ? "#4dabf7" : "#69db7c" }];
  });

  const status = !d
    ? loading("L'historique des mesures")
    : `<div class="now"><span class="big">${below}<small>/${withNormal}</small></span><p>stations de référence ont reçu nettement moins de pluie que la normale du ${esc(d.periode.du)} au ${esc(d.periode.au)} (moins de 80 % de leur moyenne 1991-2020).</p></div>`;

  const table = rows.length
    ? `<div class="card table-wrap"><table class="drought histo"><thead><tr><th>Station</th><th>Pluie, 30 jours</th><th>Maximales</th><th>Minimales</th><th>Soleil</th></tr></thead><tbody>${rows.map((r) => {
        const e = r.ensoleillement;
        return `<tr><th scope="row">${esc(r.station)}<small class="note">${esc(r.zone)}, ${r.altitude_m} m</small></th>` +
          `<td>${r.pluie ? rainBar(r.pluie.total_mm, r.pluie.normale_mm) : "—"}</td>` +
          `<td>${vsNormal(r.temperatures?.maximales_moyenne, r.temperatures?.maximales_normale)}</td>` +
          `<td>${vsNormal(r.temperatures?.minimales_moyenne, r.temperatures?.minimales_normale)}</td>` +
          `<td>${e?.jours_mesures ? `${vsNormal(e.heures_par_jour, e.normale_heures_par_jour, " h/j")}<small class="note">${e.jours_gris} jour${e.jours_gris > 1 ? "s" : ""} gris</small>` : "—"}</td></tr>`;
      }).join("")}</tbody></table></div>`
    : "";

  const title = "Historique météo à La Réunion : pluie, températures, soleil depuis 1900";
  const short = "🇷🇪 Le temps qu'il a fait à La Réunion (974) : pluie, températures et soleil mesurés par Météo-France jour par jour depuis 1900, comparés à la normale.";
  const description = d ? describe(`🇷🇪 ${d.resume}`, short) : short;

  const band = `${crumbBar("Historique météo")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Mesures jusqu'à hier</p>
    <h1>Historique météo <span class="n974">974</span></h1>
    ${status}
    ${ask(`Lapli la tonm konbien sé dernié zour Sin-Bénoi, é lé normal ? Rogard si ${url} é di amwin.`,
      `Il a plu combien ces derniers jours à Saint-Benoît, et c'est normal ? Lis ${url} et dis-le-moi.`)}
  </div>
  <figure class="card mapcard">${islandMap({ markers, label: "Carte de La Réunion (974) : la pluie des 30 derniers jours à six stations, en pourcentage de la normale" })}
  <figcaption class="note" style="color:var(--on-night-muted)">Pluie des 30 derniers jours, en % de la normale 1991-2020 : <span style="color:#ff922b">moins de 50 %</span>, <span style="color:#69db7c">proche</span>, <span style="color:#4dabf7">plus de 150 %</span>.</figcaption></figure>
</div>`;

  const body = `<section aria-labelledby="h-trente">
  <div class="sec-h"><p class="eyebrow">Six climats, six stations</p><h2 id="h-trente">Les 30 derniers jours</h2>
  <p>${d ? esc(d.resume) : ""}</p></div>
  ${table}
</section>
<section aria-labelledby="h-archive">
  <div class="sec-h"><p class="eyebrow">Toute l'archive</p><h2 id="h-archive">N'importe quel jour depuis 1900</h2>
  <p>Avec le connecteur, votre IA lit les mesures quotidiennes de chacune des 249 stations Météo-France que l'île a connues, de la première année de chacune jusqu'à hier : « il a plu combien en janvier 2018 à Cilaos ? », « il faisait combien le jour de mes 20 ans au Tampon ? », « record de chaleur à Saint-Denis ? », « il fait plus chaud qu'avant ? ». Les normales sont les moyennes 1991-2020 de chaque station.</p></div>
  ${d ? `<ul class="plain note">${d.a_savoir.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("historique_meteo", "l'historique météo")}`;

  return layout(origin, { title, description, path: "/historique", jsonld: [crumbs(origin, "Historique météo", "/historique"), webPage(origin, "/historique", title, description, data)], alerte }, band, body);
}

export function historiqueLive(data: Cached<HistoriqueAnswer> | null): Live | undefined {
  const d = data?.value;
  const r = d?.stations.find((x) => x.pluie?.rapport_a_la_normale) ;
  if (!d || !r?.pluie) return undefined;
  return { valeur: `${r.pluie.rapport_a_la_normale} de la normale`, detail: `pluie des 30 derniers jours à ${esc(r.station)} (${fr(r.pluie.total_mm)} mm)` };
}

// ---------------------------------------------------------------- agenda

const AGENDA_WEEKEND = 7;
type AgendaRow = AgendaAnswer["ce_week_end"][number];
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** The hours of a row within its day: « 14:00 – 18:00 », « 19:30 », « jusqu'au dimanche 25/10 ». */
export function agendaHours(q: string): string {
  const span = /de (\d\d:\d\d) à (\d\d:\d\d)$/.exec(q);
  if (span) return `${span[1]} – ${span[2]}`;
  const at = /^\S+ \S+ à (\d\d:\d\d)$/.exec(q);
  if (at) return at[1];
  const until = /^du .* au (\S+ \S+)(?: à \S+)?$/.exec(q);
  return until ? `jusqu'au ${until[1]}` : "";
}

function agendaRow(r: AgendaRow): string {
  const lieu = r.lieu && r.lieu.length > 80 ? `${r.lieu.slice(0, 79)}…` : r.lieu;
  const small = [r.commune, lieu, r.prix && r.prix.length < 80 ? r.prix : undefined, r.autres_dates ? `aussi ${r.autres_dates.join(", ")}` : undefined, r.publie_par]
    .filter(Boolean).map((x) => esc(x!)).join(" · ");
  return `<li><span><a href="${esc(r.lien)}" rel="noopener">${esc(r.titre)}</a><small>${small}</small></span><span class="q-none">${esc(agendaHours(r.quand))}</span></li>`;
}

export function agendaPage(origin: string, data: Cached<AgendaAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const url = fresh(`${origin}/agenda`, now);
  const today = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);

  const days = new Map<string, AgendaRow[]>();
  for (const r of d?.evenements ?? []) {
    const day = r.date.slice(0, 10) < today ? today : r.date.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), r]);
  }

  const status = !d
    ? loading("L'agenda")
    : `<div class="now"><span class="big">${d.nombre}</span><p>événement${d.nombre > 1 ? "s" : ""} dans les deux semaines qui viennent : fêtes, concerts, marchés, festivals et animations des mairies.</p></div>`;

  const weekend = d?.ce_week_end.length
    ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">Ce week-end</h3><ul class="plain">${d.ce_week_end.slice(0, AGENDA_WEEKEND).map((r) =>
        `<li><b>${esc(r.quand)}</b> : ${esc(r.titre)}${r.commune ? ` <span class="note" style="color:var(--on-night-muted)">(${esc(r.commune)})</span>` : ""}</li>`).join("")}</ul>` +
      (d.ce_week_end.length > AGENDA_WEEKEND ? `<p class="note" style="color:var(--on-night-muted)">et ${d.ce_week_end.length - AGENDA_WEEKEND} autres.</p>` : "") + `</figure>`
    : "";

  const list = !d
    ? `<p class="card">L'agenda se charge : rechargez la page dans quelques secondes.</p>`
    : days.size
      ? `<ul class="zones">${[...days].sort(([x], [y]) => x.localeCompare(y)).map(([day, rows]) =>
          `<li class="card"><h3>${esc(longDay(day).replace(/^\p{L}/u, (c) => c.toUpperCase()))} <span class="note">${rows.length} événement${rows.length > 1 ? "s" : ""}</span></h3>` +
          `<ul class="rows eau">${rows.map(agendaRow).join("")}</ul></li>`).join("")}</ul>${d.autres ? `<p class="note">${esc(d.autres)} Demandez-les à votre IA.</p>` : ""}`
      : `<p class="card">Aucun événement trouvé dans les agendas lus pour les deux semaines qui viennent.</p>`;

  const title = "Agenda de La Réunion : que faire ce week-end ? Fêtes, concerts, marchés (974)";
  const short = "🇷🇪 Que faire à La Réunion (974) ce week-end et dans les deux semaines : fêtes, concerts, marchés, festivals et animations des mairies, avec les heures, le lieu et le lien.";
  const description = d ? describe(`🇷🇪 ${d.resume} Fêtes, concerts, marchés, festivals et animations des mairies, avec les heures, le lieu et le lien.`, short) : short;

  const band = `${crumbBar("Agenda")}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Agendas des mairies et du tourisme</p>
    <h1>Agenda <span class="n974">974</span></h1>
    ${status}
    ${ask(`Kosa néna pou fé sé wikenn la ? Rogard si ${url} é di amwin.`,
      `Que faire ce week-end à La Réunion ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${weekend}
</div>`;

  const body = `<section aria-labelledby="h-jours">
  <div class="sec-h"><p class="eyebrow">Deux semaines</p><h2 id="h-jours">Jour par jour</h2>
  <p>Chaque événement renvoie à la page de celui qui le publie. Heures de La Réunion ; un événement de plusieurs jours est rangé au jour où il commence, ou à aujourd'hui s'il a déjà commencé.</p></div>
  ${list}
  ${d?.indisponible?.length ? warnings([`Agendas qui ne répondent pas en ce moment : ${d.indisponible.join(", ")}.`]) : ""}
</section>
<section aria-labelledby="h-couv">
  <div class="sec-h"><h2 id="h-couv">Ce qui est couvert</h2><p>${d ? esc(d.couverture) : ""}</p><p>${d ? esc(d.a_savoir) : ""}</p></div>
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("agenda", "l'agenda de l'île")}`;

  return layout(origin, { title, description, path: "/agenda", jsonld: [crumbs(origin, "Agenda", "/agenda"), webPage(origin, "/agenda", title, description, data)], alerte }, band, body);
}

export function agendaLive(data: Cached<AgendaAnswer> | null): Live | undefined {
  const d = data?.value;
  if (!d) return undefined;
  const first = d.ce_week_end[0];
  return {
    valeur: `${d.nombre} événement${d.nombre > 1 ? "s" : ""}`,
    detail: first ? `d'ici quinze jours ; ce week-end : ${esc(first.titre)}${first.commune ? ` (${esc(first.commune)})` : ""}` : "d'ici quinze jours",
  };
}
