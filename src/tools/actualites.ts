import type { Cache } from "../cache.js";
import { normalize, resolvePlace } from "../places/resolve.js";
import * as src from "../providers/actualites.js";
import { why } from "../types.js";
import { credits, notFound, placeBlock, text } from "./format.js";
import * as littoral from "./littoral.js";

const DEFAULT_HOURS = 24;
const MAX_HOURS = 72;
const ARTICLES_MAX = 15;
const LIVE_MAX = 8;
const PREFECTURE_DAYS = 3;

export const COUVERTURE =
  "Médias lus toutes les 5 minutes : Réunion La 1ère, Clicanoo (Le Journal de l'île), Le Quotidien de La Réunion, Imaz Press (et son direct « l'actu en continu » les jours de mobilisation, " +
  "de cyclone ou d'éruption), Freedom, Parallèle Sud, Témoignages, et les communiqués de la préfecture. Linfo.re et Zinfos974 ne se laissent pas lire " +
  "par un programme : ils n'y sont pas.";
export const A_SAVOIR =
  "Titres des articles, avec leur première phrase quand le média la donne, et leur lien : lire l'article pour le détail. Qu'aucune information ne mentionne un lieu ne prouve pas " +
  "qu'il ne s'y passe rien. Pour la route en direct, écouter la radio (Freedom, Réunion La 1ère) ; en cas de danger, appeler le 17 ou le 112, et suivre " +
  "les consignes de la préfecture.";

const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const local = (iso: string) => new Date(Date.parse(iso) + 4 * 3600_000);

/** « 11:33 », « hier à 18:20 », « jeudi 22/10 à 09:11 », or the day alone when the hour is not given. */
export function quand(i: Pick<src.Info, "publie" | "heure">, now: Date): string {
  const t = local(i.publie);
  const today = local(now.toISOString()).toISOString().slice(0, 10);
  const day = t.toISOString().slice(0, 10);
  const hm = t.toISOString().slice(11, 16);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const dd = `${DAYS[t.getUTCDay()]} ${day.slice(8, 10)}/${day.slice(5, 7)}`;
  if (!i.heure) return day === today ? "aujourd'hui" : day === yesterday ? "hier" : dd;
  return day === today ? `aujourd'hui à ${hm}` : day === yesterday ? `hier à ${hm}` : `${dd} à ${hm}`;
}

function ilYA(iso: string, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `il y a ${h} h${min % 60 >= 10 && h < 6 ? ` ${String(min % 60).padStart(2, "0")}` : ""}` : `il y a ${Math.round(h / 24)} jours`;
}

export function infoRow(i: src.Info, now: Date, commune?: string) {
  const said = commune ? i.extraits?.filter((e) => e.communes.includes(commune)).map((e) => e.texte) : undefined;
  return {
    quand: quand(i, now),
    /** ISO, UTC. */
    publie: i.publie,
    il_y_a: i.heure ? ilYA(i.publie, now) : undefined,
    media: i.media,
    titre: i.titre,
    resume: i.resume,
    ce_qui_est_dit_du_lieu: said?.length ? said : undefined,
    en_direct: i.direct || undefined,
    communes: i.communes.length ? i.communes : undefined,
    lieux: i.lieux.length ? i.lieux : undefined,
    sujets: i.sujets.length ? i.sujets : undefined,
    lien: i.lien,
    aussi: i.aussi,
  };
}
export type InfoRow = ReturnType<typeof infoRow>;

/** How `sujet` is understood: one of the subjects, or else words that must all be in the headline or its first lines. */
export function sujetMatcher(sujet: string | undefined): { nom: string; test: (i: src.Info) => boolean } | null {
  const q = normalize(sujet ?? "");
  if (!q) return null;
  const known = src.SUJETS.filter((s) => s.id === q || s.re.test(q) || normalize(s.nom).includes(q));
  if (known.length) return { nom: known.map((s) => s.nom).join(", "), test: (i) => known.some((s) => i.sujets.includes(s.id)) };
  const words = q.split(" ").filter((w) => w.length >= 3);
  if (!words.length) return null;
  return { nom: `« ${sujet!.trim()} »`, test: (i) => words.every((w) => normalize(`${i.titre} ${i.resume ?? ""}`).includes(w)) };
}

export async function actualites(cache: Cache, lieu?: string, sujet?: string, heures?: number, now = new Date()) {
  let res: ReturnType<typeof resolvePlace> = null;
  // « route du Littoral » asked as a place: the island's news on the roads, and the road's last announcement.
  const road = !!lieu && littoral.NAMED.test(normalize(lieu));
  if (road) {
    lieu = undefined;
    sujet ??= "route";
  }
  if (lieu?.trim()) {
    res = resolvePlace(lieu);
    if (!res) return notFound(lieu);
  }
  let data: src.Fil;
  try {
    data = (await src.fil(cache, now)).value;
  } catch (err) {
    console.error(`source ${src.SOURCES.medias.id} indisponible:`, why(err));
    return { ...text({ erreur: "Les médias ne répondent pas pour le moment.", consulter: src.SOURCES.medias.url }), isError: true };
  }

  const h = Math.min(MAX_HOURS, Math.max(1, Math.round(heures ?? DEFAULT_HOURS)));
  const since = new Date(now.getTime() - h * 3600_000).toISOString();
  const what = sujetMatcher(sujet);
  const pool = data.infos.filter((i) => i.publie >= since && (!what || what.test(i)));

  const commune = res?.lieu.commune;
  // A place inside a commune (Ravine des Cabris) is looked for by its own name too.
  const place = res && res.lieu.type !== "commune" ? normalize(res.lieu.nom).replace(/^(le|la|les|l) /, "") : undefined;
  const names = (i: src.Info) => !!commune && (i.communes.includes(commune) || (!!place && normalize(`${i.titre} ${i.resume ?? ""}`).includes(place)));
  const where = res ? (res.lieu.type === "commune" ? commune! : `${res.lieu.nom} (${commune})`) : undefined;

  const live = pool.filter((i) => i.direct).slice(0, LIVE_MAX);
  const articles = pool.filter((i) => !i.direct);
  const mine = res ? pool.filter(names) : articles;
  const prefecture = data.prefecture.filter((i) => i.publie >= new Date(now.getTime() - PREFECTURE_DAYS * 86_400_000).toISOString() && (!what || what.test(i))).slice(0, 3);

  const kind = what ? ` (${what.nom})` : "";
  const newest = mine[0];
  const latest = (i: src.Info) => `${quand(i, now)} (${i.media}${i.direct ? ", en direct" : ""}) : « ${i.titre} »`;
  // What a text says of the place asked for, when it says it past its first sentence.
  const about = (i: src.Info) => i.extraits?.find((e) => e.communes.includes(commune!))?.texte ?? (i.resume && src.placesIn(i.resume).communes.includes(commune!) ? i.resume : undefined);
  const resume = [
    res
      ? mine.length
        ? `${mine.length} information${mine.length > 1 ? "s" : ""}${kind} des dernières ${h} h mentionne${mine.length > 1 ? "nt" : ""} ${where}. ` +
          mine.slice(0, 4).map((i) => `${latest(i)}${about(i) ? ` : « ${about(i)} »` : ""}`).join(" ; ") + "."
        : `Aucune information${kind} des médias lus ne mentionne ${where} depuis ${quand({ publie: since, heure: true }, now)}.`
      : pool.length
        ? `${articles.length} information${articles.length > 1 ? "s" : ""}${kind} des médias de La Réunion depuis ${h} h ; la plus récente, ${articles[0] ? latest(articles[0]) : "—"}.`
        : `Aucune information${kind} des médias lus depuis ${h} h.`,
    live.length ? `En direct sur l'île, ${latest(live[0])}.` : "",
    prefecture.length ? `Dernier communiqué de la préfecture, ${quand(prefecture[0], now)} : « ${prefecture[0].titre} ».` : "",
  ].filter(Boolean).join(" ");

  const roadAsked = road || littoral.ENDS.includes(commune ?? "") || /\b(?:routes?|circulation|trafic|littoral)\b/.test(normalize(sujet ?? ""));
  return text({
    lieu: res && lieu ? placeBlock(lieu, res) : undefined,
    resume,
    route_du_littoral: roadAsked ? littoral.forTool(littoral.littoral(data, now), now) : undefined,
    periode: `les dernières ${h} heures`,
    infos: mine.filter((i) => !res || !i.direct).slice(0, ARTICLES_MAX).map((i) => infoRow(i, now, commune)),
    en_direct: live.length ? live.map((i) => ({ ...infoRow(i, now, commune), mentionne_le_lieu: res ? names(i) : undefined })) : undefined,
    prefecture: prefecture.length ? prefecture.map((i) => infoRow(i, now)) : undefined,
    sujet_non_compris: sujet?.trim() && !what ? `« ${sujet} » n'a pas été compris : toutes les informations sont données.` : undefined,
    sujets_possibles: src.SUJETS.map((s) => `${s.id} (${s.nom})`),
    indisponible: data.indisponible.length ? data.indisponible : undefined,
    couverture: COUVERTURE,
    a_savoir: A_SAVOIR,
    sources: credits([src.SOURCES.medias, src.SOURCES.prefecture]),
  });
}
