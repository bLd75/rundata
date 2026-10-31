/**
 * The search for a bus journey (/bus/itineraire): a start and an end (a stop, a commune or a place), a day and a time,
 * leaving then or arriving before; the answer lists the direct trips and those with one change, of every network,
 * from their timetables (tools/itineraire.ts). A form that needs no script; built at each search, never kept.
 */
import * as transit from "../providers/transit.js";
import { DAY_START_S, endOf, type End, type Journey, journeys, type Leg, type Search } from "../tools/itineraire.js";
import { dayName } from "../tools/transports.js";
import { why } from "../types.js";
import { a as aCommune, de as deCommune, fr, heure } from "../tools/format.js";
import { crumbBar, crumbs } from "./domains.js";
import { esc } from "./map.js";
import { type Alerte, credit } from "./data.js";
import { credits, layout } from "./pages.js";

export const ITINERAIRE_PATH = "/bus/itineraire";

/** What the form asks, as typed: the day as YYYY-MM-DD and the time as HH:MM, both empty for now. */
export interface Asked {
  de: string;
  a: string;
  jour: string;
  heure: string;
  arrivee: boolean;
}

/** Today in La Réunion, YYYY-MM-DD, and the time, HH:MM. */
export function nowAsked(now: Date): { jour: string; heure: string } {
  const local = new Date(now.getTime() + 4 * 3600_000).toISOString();
  return { jour: local.slice(0, 10), heure: local.slice(11, 16) };
}

/** The form, filled with what was asked. */
export function journeyForm(q: Partial<Asked> = {}): string {
  const v = (x?: string) => esc(x ?? "");
  return `<form class="card fo trajet-form" action="${ITINERAIRE_PATH}" method="get">
<div class="f"><label for="it-de">Départ</label><input id="it-de" name="de" type="text" placeholder="Petite-Île, ou un arrêt" autocomplete="off" required value="${v(q.de)}"></div>
<div class="f"><label for="it-a">Arrivée</label><input id="it-a" name="a" type="text" placeholder="Aéroport Roland-Garros" autocomplete="off" required value="${v(q.a)}"></div>
<fieldset><legend>Quand</legend><label class="case"><input type="radio" name="sens" value="depart"${q.arrivee ? "" : " checked"}> Partir à</label><label class="case"><input type="radio" name="sens" value="arrivee"${q.arrivee ? " checked" : ""}> Arriver avant</label></fieldset>
<div class="row court"><div class="f"><label for="it-jour">Date</label><input id="it-jour" name="jour" type="date" value="${v(q.jour)}"></div><div class="f"><label for="it-heure">Heure</label><input id="it-heure" name="heure" type="time" value="${v(q.heure)}"></div></div>
<p class="aide">Sans date ni heure : aujourd'hui, maintenant.</p>
<button type="submit">Chercher un trajet</button>
</form>`;
}

/** « 18:05 », « 00:20 le lendemain », of seconds after midnight of the day asked. */
const at = (s: number) => {
  const m = Math.floor((((s % 86400) + 86400) % 86400) / 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}${s >= 86400 ? " le lendemain" : s < 0 ? " la veille" : ""}`;
};
/** « 1 h 35 », « 45 min ». */
const lasting = (s: number) => {
  const m = Math.round(s / 60);
  return m < 60 ? `${fr(m)} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`;
};
const walkMin = (s: number) => Math.max(1, Math.round(s / 60));

/** « Église Petite-Île », « Mairie, Saint-Leu »: the commune said when the name does not say it. */
function stopName(id: number): string {
  const s = transit.stop(id);
  const town = transit.expand(s.commune).replace(/^(?:le|la|les|l) /, "");
  return transit.expand(s.nom).includes(town) ? s.nom : `${s.nom}, ${s.commune}`;
}

const legLi = (l: Leg) =>
  `<li><b>${esc(at(l.depart))}</b> ${esc(stopName(l.de))} : ${l.trajet ? `<a href="${esc(l.trajet)}">ligne ${esc(l.ligne)}</a>` : `ligne ${esc(l.ligne)}`} <span class="note">(${esc(l.reseau)})</span> vers ${esc(l.direction)}</li>` +
  `<li><b>${esc(at(l.arrivee))}</b> descendre à ${esc(stopName(l.a))}</li>`;

function journeyCard(j: Journey): string {
  const [first, second] = j.legs;
  const change = second
    ? j.marche_changement
      ? `<li class="note">Changement : environ ${fr(walkMin(j.marche_changement))} min à pied jusqu'à ${esc(stopName(second.de))}.</li>`
      : `<li class="note">Changement au même arrêt.</li>`
    : "";
  return `<li class="card"><h3>${esc(at(j.depart))} → ${esc(at(j.arrivee))} <span class="note">· ${esc(lasting(j.arrivee - j.depart))} · ${second ? "1 correspondance" : "direct"}</span></h3>
<ol class="plain etapes">${j.marche_depart ? `<li class="note">Environ ${fr(walkMin(j.marche_depart))} min à pied jusqu'à l'arrêt.</li>` : ""}${legLi(first)}${change}${second ? legLi(second) : ""}${j.marche_arrivee ? `<li class="note">Puis environ ${fr(walkMin(j.marche_arrivee))} min à pied.</li>` : ""}</ol></li>`;
}

/** A stop's name in our sentences: written out as people write it, « Saint-Pierre » and « Roland-Garros ». */
const prose = (name: string) =>
  name
    .replace(/\bSte[- ]/g, "Sainte-")
    .replace(/\bSt[- ]/g, "Saint-")
    .replace(/Roland Garros/g, "Roland-Garros")
    // « Chemin Des Bambous », « Pôle D'Echange » (Alternéo's capitals): « des », « d' » inside a name.
    .replace(/(?<=\S )(De|Des|Du)(?= )|(?<=\S )D'/g, (w) => w.toLowerCase());

// The common nouns that start a place's name, by gender, for « de la plage », « à l'aéroport », « du stade ».
const FEMININE = /^(plage|gare|mairie|place|église|eglise|pointe|cascade|plaine|ravine|rivière|route|rue|anse|forêt|maison|médiathèque|piscine|école|université|chapelle|case|grotte|île)\b/i;
const MASCULINE = /^(aéroport|hôpital|lycée|collège|port|stade|marché|parc|centre|cap|piton|bassin|jardin|musée|cimetière|temple|belvédère|front|boulevard|chemin|quai|village|pont|col|gîte|étang)\b/i;
/** « de la plage de l'Hermitage », « à l'aéroport Roland-Garros », « du stade de l'Est »; else the name after « de » or « à ». */
function article(name: string, to: boolean): string {
  const n = prose(name);
  const lower = n.charAt(0).toLowerCase() + n.slice(1);
  const vowel = /^[aeiouyéèêâîôûh]/i.test(n);
  if (FEMININE.test(n)) return vowel ? `${to ? "à" : "de"} l'${lower}` : `${to ? "à la" : "de la"} ${lower}`;
  if (MASCULINE.test(n)) return vowel ? `${to ? "à" : "de"} l'${lower}` : `${to ? "au" : "du"} ${lower}`;
  return `${to ? "à" : "de"} ${n}`;
}

/** An end in the sentence over the results: « de Petite-Île (principaux arrêts) », « à l'arrêt Aéroport Roland-Garros ». */
function said(e: End, to: boolean): string {
  if (e.sorte === "commune") return `${to ? aCommune(e.nom) : deCommune(e.nom)} (principaux arrêts)`;
  if (e.sorte === "lieu") return `${article(e.nom, to)} (arrêts à pied autour)`;
  return `${to ? "à" : "de"} l'arrêt ${prose(e.nom)}`;
}
const capital = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** No journey: « ce jour-là » when the whole day was looked through, else the hours that were, with what to try. */
function none(arriveBy: boolean, w: Search["fenetre"], when: string): string {
  const what = "aucun trajet direct ni avec une seule correspondance";
  if (arriveBy ? w.de <= DAY_START_S : w.a >= DAY_START_S + 86400) {
    return `${arriveBy ? `${capital(what)} ce jour-là pour arriver avant ${when}` : `Plus ${what} ce jour-là après ${when}`}, d'après les horaires prévus. Essayez une autre heure, un autre jour ou un arrêt proche.`;
  }
  return `${capital(what)} entre ${heureOf(w.de)} et ${heureOf(w.a)}. Essayez une heure plus ${arriveBy ? "tôt" : "tard"}, ou précisez le départ ou l'arrivée.`;
}
/** « 8 h », « 11:30 »: as the time asked is said. */
const heureOf = (s: number) => heure(Math.floor((((s % 86400) + 86400) % 86400) / 60));

export interface Answer {
  asked: Asked;
  /** The day and time searched, said: « lundi 2 novembre, arriver avant 18 h ». */
  quand: string;
  /** The time searched, said: « 18 h ». */
  heure?: string;
  de?: End;
  a?: End;
  search?: Search;
  /** The timetables did not answer. */
  indisponible?: boolean;
}

/** What the address asks: nothing without a start and an end; the day and time checked, now when missing or wrong. */
export function askedOf(params: URLSearchParams): Asked | undefined {
  const de = (params.get("de") ?? "").trim().slice(0, 100);
  const a = (params.get("a") ?? "").trim().slice(0, 100);
  if (!de || !a) return undefined;
  const jour = /^\d{4}-\d{2}-\d{2}$/.test(params.get("jour") ?? "") ? params.get("jour")! : "";
  const h = /^([01]\d|2[0-3]):[0-5]\d$/.test(params.get("heure") ?? "") ? params.get("heure")! : "";
  return { de, a, jour, heure: h, arrivee: params.get("sens") === "arrivee" };
}

/** The search for what was asked: its ends understood, then the journeys, read from the timetables. */
export async function answer(asked: Asked, now: Date): Promise<Answer> {
  const today = nowAsked(now);
  const jour = asked.jour || today.jour;
  const time = asked.heure || today.heure;
  const ymd = Number(jour.replace(/-/g, ""));
  const d = new Date(`${jour}T00:00:00Z`);
  const day = jour === today.jour ? "aujourd'hui" : dayName({ ymd, weekday: (d.getUTCDay() + 6) % 7 });
  const [h, m] = time.split(":").map(Number);
  const spoken = heure(h * 60 + m);
  const quand = `${day}, ${asked.arrivee ? "pour arriver avant" : "à partir de"} ${spoken}`;
  const de = endOf(asked.de);
  const a = endOf(asked.a);
  if (!de || !a) return { asked, quand, heure: spoken, de, a };
  try {
    return { asked, quand, heure: spoken, de, a, search: await journeys(de, a, ymd, h * 3600 + m * 60, asked.arrivee) };
  } catch (err) {
    console.error(`trajet ${asked.de} → ${asked.a} : horaires indisponibles`, why(err));
    return { asked, quand, heure: spoken, de, a, indisponible: true };
  }
}

export function itinerairePage(origin: string, r: Answer | undefined, alerte?: Alerte): string {
  let result = "";
  if (r) {
    const missing = [!r.de ? ["Départ", r.asked.de] : undefined, !r.a ? ["Arrivée", r.asked.a] : undefined].filter((x): x is string[] => !!x);
    if (missing.length) {
      result = missing.map(([what, text]) => `<p>${what} non ${what === "Arrivée" ? "trouvée" : "trouvé"} : « ${esc(text)} ». Donnez un arrêt, une commune ou un lieu (« Gare routière, Saint-Pierre », « aéroport »).</p>`).join("");
    } else if (r.indisponible) {
      result = `<p>Les horaires de bus ne répondent pas pour le moment. Réessayer dans un instant.</p>`;
    } else {
      const { de, a, search } = r as Required<Pick<Answer, "de" | "a" | "search">>;
      const zones = [de, a].filter((e) => e.sorte === "commune").map((e) => `<p class="note">Résultats pour les principaux arrêts de ${esc(e.nom)} : précisez l'arrêt pour un quartier.</p>`).join("");
      const found = search.trop_large
        ? `<p>Trop d'arrêts et de lignes à parcourir : précisez le départ ou l'arrivée, avec un arrêt ou un quartier.</p>`
        : search.trajets.length
          ? `<ul class="plain trajets">${search.trajets.map(journeyCard).join("")}</ul>`
          : `<p>${esc(none(r.asked.arrivee, search.fenetre, r.heure ?? ""))}</p>`;
      result = `<p>${esc(capital(said(de, false)))} ${esc(said(a, true))}, ${esc(r.quand)}.</p>${zones}${found}`;
    }
  }
  const band = `${crumbBar("Trajet en bus", { name: "Bus", path: "/bus" })}
<div class="wrap intro"><div class="pitch"><h1>Trajet en bus</h1><p class="lead">Tous les réseaux de l'île, trajets directs ou avec une correspondance.</p>${journeyForm(r?.asked)}</div></div>`;
  const body = `${result ? `<section aria-label="Trajets">${result}</section>` : ""}
<section><p class="note">Horaires prévus par les réseaux, pas la position des bus en direct : un bus peut passer en retard, ou ne pas passer un jour férié que son réseau n'a pas signalé. Pour les heures en direct, ouvrez la ligne d'un trajet.</p>
<p class="sources">Source : ${credits([credit(transit.SOURCE)])}.</p></section>`;
  const title = "Trajet en bus à La Réunion · 974";
  const description = "Préparer un trajet en bus à La Réunion (974) : départ, arrivée, date et heure, sur les horaires de tous les réseaux.";
  // Not /bus's hook (« à l'heure annoncée par le réseau »): this page reads the timetables, not the times of the moment.
  return layout(origin, { title, description, path: ITINERAIRE_PATH, noindex: !!r, hook: "", jsonld: [crumbs(origin, "Trajet en bus", ITINERAIRE_PATH, { name: "Bus", path: "/bus" })], alerte }, band, body);
}
