/**
 * Two parts of the agenda with their own page, for what people search: this weekend (/evenements/ce-week-end) and the
 * concerts (/evenements/concerts). Both are cut from the events page's copy (web:agenda): nothing more is fetched.
 */
import type { Cached } from "../cache.js";
import type { AgendaAnswer, Alerte } from "./data.js";
import { agendaEvents, agendaRow, agendaTabs, connectorCta, describe, GENRE_SCRIPT, GENRES, loading, longDay, sourcesNote, warnings, webPage } from "./domains.js";
import { occurrences } from "../tools/agenda.js";
import { forecastLinks } from "./liens.js";
import { esc } from "./map.js";
import { ask, DESCRIPTION_MAX, layout, SITE } from "./pages.js";

type Row = NonNullable<AgendaAnswer["evenements"]>[number];

export { occurrences };

const localDay = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const upper = (s: string) => s.replace(/^\p{L}/u, (c) => c.toUpperCase());

/** The public holidays of a year in La Réunion: those of France, and the 20th of December. */
export function holidays(year: number): Map<string, string> {
  // Easter Sunday (anonymous Gregorian algorithm).
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((8 * b + 13) / 25)) / 3) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const easter = `${year}-${String(month).padStart(2, "0")}-${String(((h + l - 7 * m + 114) % 31) + 1).padStart(2, "0")}`;
  return new Map([
    [`${year}-01-01`, "jour de l'an"], [addDays(easter, 1), "lundi de Pâques"], [`${year}-05-01`, "fête du Travail"], [`${year}-05-08`, "8 mai"],
    [addDays(easter, 39), "Ascension"], [addDays(easter, 50), "lundi de Pentecôte"], [`${year}-07-14`, "14 juillet"], [`${year}-08-15`, "Assomption"],
    [`${year}-11-01`, "Toussaint"], [`${year}-11-11`, "11 novembre"], [`${year}-12-20`, "Fèt Kaf"], [`${year}-12-25`, "Noël"],
  ]);
}

export interface Weekend {
  /** The days, from Friday (or the holiday before it) to Sunday (or the holiday after it), local. */
  du: string;
  au: string;
  /** From when the Friday counts: 17:00, or the whole day when it is a holiday. */
  vendredi?: string;
  /** The holidays among those days. */
  feries: Map<string, string>;
}

/**
 * The weekend people mean: Friday from 17:00 to Sunday night, the coming one from Monday on. A holiday on the Friday
 * or the Monday next to it belongs to it (the 1st of November on a Sunday already does).
 */
export function weekend(now: Date): Weekend {
  const today = localDay(now);
  const year = Number(today.slice(0, 4));
  const off = new Map([...holidays(year - 1), ...holidays(year), ...holidays(year + 1)]);
  const wd = weekday(today);
  // A holiday Monday is still the weekend that ends with it.
  const friday = wd === 1 && off.has(today) ? addDays(today, -3) : addDays(today, wd === 0 ? -2 : wd === 6 ? -1 : 5 - wd);
  const monday = addDays(friday, 3);
  const du = friday, au = off.has(monday) ? monday : addDays(friday, 2);
  const feries = new Map([...off].filter(([d]) => d >= du && d <= au));
  return { du, au, vendredi: off.has(friday) ? undefined : "17:00", feries };
}

/** The day of the weekend each occurrence of a row is listed on, with its hours; nothing when it is not that weekend. */
export function inWeekend(r: Row, w: Weekend, now: Date): { day: string; date: string; quand: string; long: boolean }[] {
  const from = [w.du, localDay(now)].sort()[1];
  return occurrences(r).flatMap((o) => {
    if (o.au < from || o.du > w.au) return [];
    // Friday daytime is not the weekend yet: a market at 08:00, a talk until 16:00.
    if (w.vendredi && o.du === w.du && o.au === w.du && o.debut && (o.fin ?? o.debut) < w.vendredi) return [];
    return [{ day: [o.du, from].sort()[1], date: `${o.du}${o.debut ? `T${o.debut}` : ""}`, quand: o.quand, long: o.du !== o.au }];
  });
}

/** « samedi 31 octobre », « dimanche 1er novembre ». */
const dayName = (day: string) => longDay(day).replace(/ 1 /, " 1er ");

/** « Samedi 31 octobre et dimanche 1er novembre (Toussaint) », from today when the weekend has begun. */
export function weekendText(w: Weekend, now: Date): string {
  const days: string[] = [];
  for (let d = [w.du, localDay(now)].sort()[1]; d <= w.au; d = addDays(d, 1)) {
    // The Friday evening is said apart (« vendredi soir »), unless it is a holiday.
    if (d === w.du && w.vendredi) continue;
    days.push(`${dayName(d)}${w.feries.has(d) ? ` (${w.feries.get(d)})` : ""}`);
  }
  if (!days.length) days.push(`${dayName(w.du)} soir`);
  return upper(days.length > 1 ? `${days.slice(0, -1).join(", ")} et ${days.at(-1)}` : days[0]);
}

// The halls whose programmes the agenda reads, for when it has no concert in its two weeks.
const HALLS: [string, string][] = [
  ["TÉAT Champ Fleuri et Plein Air", "https://www.teat.re/programmation/"], ["Cité des Arts", "https://www.citedesarts.re/Programmation"],
  ["Kabardock", "https://kabardock.com/"], ["Le Séchoir", "https://www.lesechoir.com"], ["Bisik", "https://bisik.re/agenda/"],
  ["Théâtre Luc Donat", "https://www.theatrelucdonat.re/tld_agenda"], ["CDNOI", "https://www.cdnoi.re/programmation/"], ["Léspas", "https://lespas.re/category/la-saison/"],
];

/** The trail of the page: rundata.re › Événements › this one, as links and for search engines. */
function trail(origin: string, name: string, path: string) {
  const items: [string, string][] = [[SITE, "/"], ["Événements", "/evenements"], [name, path]];
  const bar = `<div class="wrap"><nav class="crumbs" aria-label="Fil d'Ariane"><ol>${items.map(([n, p], i) =>
    i < items.length - 1 ? `<li><a href="${p}">${esc(n)}</a></li>` : `<li aria-current="page">${esc(n)}</li>`).join("")}</ol></nav></div>`;
  const jsonld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([n, p], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: `${origin}${p}` })),
  };
  return { bar, jsonld };
}

/** The genre filter and the days, as on /evenements. */
function dayList(days: Map<string, string[]>, rows: Row[], heading: (day: string) => string, after: (day: string) => string = () => ""): string {
  const present = new Set(rows.flatMap((r) => r.genres));
  const filter = present.size > 1
    ? `<form id="ef" class="card filter" hidden role="search" aria-label="Filtrer les événements par genre"><label>Genre <select name="g"><option value="">tous</option>${GENRES.filter(([g]) => present.has(g)).map(([g, nom]) => `<option value="${esc(g)}">${esc(nom)}</option>`).join("")}</select></label><p class="note" id="ef-n" aria-live="polite"></p></form>`
    : "";
  return `${filter}<div id="jours"><ul class="zones">${[...days].sort(([x], [y]) => x.localeCompare(y)).map(([day, items]) =>
    `<li class="card"><h3>${esc(heading(day))} <span class="note">${items.length} événement${items.length > 1 ? "s" : ""}</span></h3><ul class="rows eau">${items.join("")}</ul>${after(day)}</li>`).join("")}</ul></div><script>${GENRE_SCRIPT}</script>`;
}

/** The events of a page as schema.org `Event`s (domains.ts `agendaEvents`), when there are any. */
const graph = (rows: Row[], origin: string) => {
  const events = agendaEvents(rows, origin);
  return events.length ? [{ "@context": "https://schema.org", "@graph": events }] : [];
};

const CONCERT = "concert";
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

export function weekendPage(origin: string, data: Cached<AgendaAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const path = "/evenements/ce-week-end";
  const url = `${origin}${path}`;
  const w = weekend(now);
  const when = weekendText(w, now);

  const days = new Map<string, string[]>();
  const listed: Row[] = [];
  // As search engines get them: each event once, at its date that weekend.
  const dated: Row[] = [];
  const sorted: { day: string; long: boolean; time: string; html: string; commune?: string }[] = [];
  for (const r of d?.evenements ?? []) {
    const here = inWeekend(r, w, now);
    if (!here.length) continue;
    listed.push(r);
    dated.push({ ...r, date: here[0].date, quand: here[0].quand });
    for (const o of here) sorted.push({ day: o.day, long: o.long, time: o.quand, html: agendaRow({ ...r, quand: o.quand }), commune: r.commune });
  }
  // The shows of a day by their hour, the fêtes of several days after them.
  sorted.sort((x, y) => Number(x.long) - Number(y.long) || (/\d\d:\d\d/.exec(x.time)?.[0] ?? "").localeCompare(/\d\d:\d\d/.exec(y.time)?.[0] ?? ""));
  for (const s of sorted) days.set(s.day, [...(days.get(s.day) ?? []), s.html]);
  // The weather of the communes where something happens, day by day.
  const where = new Map<string, (string | undefined)[]>();
  for (const s of sorted) where.set(s.day, [...(where.get(s.day) ?? []), s.commune]);
  const n = listed.length;
  const of = (g: string) => listed.filter((r) => r.genres.includes(g)).length;

  const status = !d
    ? loading("L'agenda du week-end")
    : `<div class="now"><span class="big">${n}</span><p>événement${n > 1 ? "s" : ""} : ${esc(when)}${w.vendredi && localDay(now) <= w.du ? ", et dès le vendredi soir" : ""}.</p></div>`;

  const kinds = ([["concert", "concert"], ["festival", "fête ou festival", "fêtes ou festivals"], ["marché", "marché"], ["théâtre", "pièce de théâtre", "pièces de théâtre"], ["danse", "spectacle de danse", "spectacles de danse"], ["enfants", "sortie pour les enfants", "sorties pour les enfants"], ["sport", "rendez-vous sportif", "rendez-vous sportifs"]] as [string, string, string?][])
    .map(([g, one, many]) => [of(g), count(of(g), one, many)] as const).filter(([k]) => k > 0);
  const brief = d && kinds.length
    ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">Au programme</h3><ul class="plain">${kinds.map(([, t]) => `<li>${esc(t)}</li>`).join("")}</ul>` +
      `<p class="note" style="color:var(--on-night-muted)">D'après les agendas des salles, des mairies et de l'office de tourisme.</p></figure>`
    : "";

  const list = !d
    ? `<p class="card">L'agenda se charge : rechargez la page dans quelques secondes.</p>`
    : n
      ? dayList(days, listed, (day) => `${upper(dayName(day))}${day === w.du && w.vendredi ? " soir" : ""}${w.feries.has(day) ? ` (${w.feries.get(day)}, férié)` : ""}`, (day) => forecastLinks(where.get(day) ?? []))
      : `<p class="card">Aucun événement trouvé dans les agendas lus pour ce week-end. Voir <a href="/evenements">les deux semaines qui viennent</a>.</p>`;

  const title = "Que faire ce week-end à La Réunion ? · 974";
  const short = "🇷🇪 Que faire ce week-end à La Réunion (974) : concerts, fêtes, marchés et spectacles, commune par commune, avec le lien vers chaque organisateur.";
  const base = `🇷🇪 ${when} : ${count(n, "sortie")} à La Réunion (974), concerts, fêtes, marchés et spectacles`;
  const description = (d && [", commune par commune, avec le lien vers chaque organisateur.", ", commune par commune.", "."].map((t) => base + t).find((x) => x.length <= DESCRIPTION_MAX)) || short;
  const { bar, jsonld } = trail(origin, "Ce week-end", path);

  const band = `${bar}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Du vendredi soir au dimanche</p>
    <h1>Ce week-end à La Réunion</h1>
    ${status}
    ${ask(`Kosa néna pou fé sé wikenn la ? Rogard si ${url} é di amwin.`, `Que faire ce week-end à La Réunion ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${brief}
</div>`;

  const body = `<section aria-labelledby="h-jours">
  <div class="sec-h"><p class="eyebrow">${esc(when)}</p><h2 id="h-jours">Jour par jour</h2>
  <p>Le week-end commence le vendredi à 17 h et finit le dimanche soir ; un jour férié collé au week-end en fait partie. À partir du lundi, c'est le week-end qui vient. Chaque événement renvoie à la page de celui qui le publie ; un événement annulé ou reporté reste affiché, avec son statut.</p></div>
  ${agendaTabs(path)}
  ${list}
  ${d?.indisponible?.length ? warnings([`Agendas qui ne répondent pas en ce moment : ${d.indisponible.join(", ")}.`]) : ""}
</section>
<section aria-labelledby="h-couv">
  <div class="sec-h"><h2 id="h-couv">Ce qui est couvert</h2><p>${d ? esc(d.couverture) : ""}</p><p>${d ? esc(d.a_savoir) : ""}</p></div>
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("evenements", "les événements de l'île")}`;

  return layout(origin, { title, description, path, jsonld: [jsonld, webPage(origin, path, title, description, data), ...graph(dated, origin)], alerte }, band, body);
}

export function concertsPage(origin: string, data: Cached<AgendaAnswer> | null, now = new Date(), alerte?: Alerte): string {
  const d = data?.value;
  const path = "/evenements/concerts";
  const url = `${origin}${path}`;
  const today = localDay(now);
  const rows = (d?.evenements ?? []).filter((r) => r.genres.includes(CONCERT));
  const n = rows.length;

  const days = new Map<string, string[]>();
  for (const r of rows) {
    const day = r.date.slice(0, 10) < today ? today : r.date.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), agendaRow(r)]);
  }
  // Tonight: what starts from 17:00 today, or has no hour.
  const tonight = rows.filter((r) => r.date.slice(0, 10) === today && (r.date.length === 10 || r.date.slice(11) >= "17:00"));

  const status = !d
    ? loading("L'agenda des concerts")
    : `<div class="now"><span class="big">${n}</span><p>concert${n > 1 ? "s" : ""} dans les deux semaines qui viennent${tonight.length ? `, dont ${tonight.length} ce soir` : ""}.</p></div>`;

  const side = tonight.length
    ? `<figure class="card mapcard"><h3 style="color:var(--on-night)">Ce soir</h3><ul class="plain">${tonight.slice(0, 7).map((r) =>
        `<li><b>${esc(r.date.length > 10 ? r.date.slice(11, 16) : "")}</b> ${r.statut && r.statut !== "complet" ? `<b>${esc(r.statut)}</b> ` : ""}${esc(r.titre)}${r.commune ? ` <span class="note" style="color:var(--on-night-muted)">(${esc(r.commune)})</span>` : ""}</li>`).join("")}</ul>` +
      (tonight.length > 7 ? `<p class="note" style="color:var(--on-night-muted)">et ${tonight.length - 7} autres.</p>` : "") + `</figure>`
    : "";

  const halls = `<p>Les programmes des salles : ${HALLS.map(([nom, lien]) => `<a href="${esc(lien)}" rel="noopener">${esc(nom)}</a>`).join(", ")}.</p>`;
  const list = !d
    ? `<p class="card">L'agenda se charge : rechargez la page dans quelques secondes.</p>`
    : n
      ? dayList(days, rows, (day) => `${day === today ? "Aujourd'hui, " : ""}${dayName(day)}`.replace(/^\p{L}/u, (c) => c.toUpperCase()))
      : `<div class="card"><p>Aucun concert trouvé dans les agendas lus pour les deux semaines qui viennent. Les salles annoncent leurs dates plus loin sur leur site :</p>${halls}</div>`;

  const title = "Concerts à La Réunion : ce soir et ce week-end · 974";
  const programmes = "TÉAT, Cité des Arts, Kabardock, Séchoir et les autres salles, ce soir et ce week-end.";
  const short = `🇷🇪 Les prochains concerts à La Réunion (974) : ${programmes}`;
  const description = d && n ? describe(`🇷🇪 ${n > 1 ? `Les ${n} prochains concerts` : "Le prochain concert"} à La Réunion (974) : ${programmes}`, short) : short;
  const { bar, jsonld } = trail(origin, "Concerts", path);

  const band = `${bar}
<div class="wrap intro">
  <div class="pitch">
    <p class="pill"><span class="dot"></span>Salles de concert, mairies et festivals</p>
    <h1>Concerts à La Réunion</h1>
    ${status}
    ${ask(`Kel konsèr néna sé swar é sé wikenn la ? Rogard si ${url} é di amwin.`, `Quels concerts ce soir et ce week-end à La Réunion ? Lis ${url} et dis-le-moi.`)}
  </div>
  ${side}
</div>`;

  const body = `<section aria-labelledby="h-jours">
  <div class="sec-h"><p class="eyebrow">Deux semaines</p><h2 id="h-jours">Les concerts jour par jour</h2>
  <p>Maloya, séga, jazz, rock, reggae, électro, classique : tout ce que les salles, les mairies et l'office de tourisme annoncent comme concert. Heures de La Réunion ; chaque concert renvoie à la page de celui qui le publie, et à la billetterie quand elle est donnée.</p></div>
  ${agendaTabs(path)}
  ${list}
  ${d?.indisponible?.length ? warnings([`Agendas qui ne répondent pas en ce moment : ${d.indisponible.join(", ")}.`]) : ""}
</section>
<section aria-labelledby="h-couv">
  <div class="sec-h"><h2 id="h-couv">Ce qui est couvert</h2><p>${d ? esc(d.couverture) : ""}</p>${n ? halls : ""}</div>
  ${d && data ? sourcesNote(d.sources, data) : ""}
</section>
${connectorCta("evenements", "les concerts et les sorties de l'île")}`;

  return layout(origin, { title, description, path, jsonld: [jsonld, webPage(origin, path, title, description, data), ...graph(rows, origin)], alerte }, band, body);
}
