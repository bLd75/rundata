import { left } from "../budget.js";
import type { Cache } from "../cache.js";
import { ageMinutes, ageText, localTime } from "../geo.js";
import { resolvePlace } from "../places/resolve.js";
import * as cc from "../providers/coupures-courant.js";
import * as edf from "../providers/edf.js";
import { why } from "../types.js";
import { type CourantAnswer, courantBlock, courantCopy, nonReprisCourt } from "./courant.js";
import { credits, fr, notFound, paire, placeBlock, text } from "./format.js";

/**
 * EDF's columns that produce, its name for each and whether it is renewable, as EDF titles them: the columns `charbon`
 * and `diesel` kept their keys, but EDF titles them « Biomasse (MW) » and « Bioliquide (MW) », renewable (its yearly
 * balance for 2024, 92.5 % renewable). Not the batteries (`stockage`): they give back what the others produced.
 */
const SOURCES: [keyof edf.Mix, string, boolean][] = [
  ["photovoltaique", "solaire photovoltaïque", true],
  ["eolien", "éolien", true],
  ["hydraulique", "hydraulique", true],
  ["bioenergies", "bioénergies", true],
  ["charbon", "biomasse", true],
  ["diesel", "bioliquide", true],
  ["turbines_combustion", "turbines à combustion", false],
];

const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/**
 * What the shares are of: the columns that produce, the batteries left out, in charge or not, and a column's small
 * negative values (its own use, the turbines at -0.25 MW) taken as 0. The MW said stay EDF's own `total`.
 */
export function produced(m: edf.Mix): number {
  return SOURCES.reduce((s, [k]) => s + Math.max(0, m[k] as number), 0);
}

/** The share of each source and the renewable part, from one line of production, both of what produces (`produced`). */
export function breakdown(m: edf.Mix) {
  const total = produced(m);
  const parts = SOURCES.filter(([k]) => (m[k] as number) > 0.05).map(([k, nom, enr]) => ({
    filiere: nom,
    mw: Math.round((m[k] as number) * 10) / 10,
    part_pct: Math.round(((m[k] as number) / total) * 1000) / 10,
    renouvelable: enr,
  }));
  const renewable = SOURCES.filter(([, , enr]) => enr).reduce((s, [k]) => s + Math.max(0, m[k] as number), 0);
  return { parts: parts.sort((a, b) => b.mw - a.mw), renouvelable_pct: Math.round((renewable / total) * 1000) / 10 };
}

/** Hours that are not "optimal", run together per day: « jeudi 23/10 de 18h à 21h : heures de pointe (recharge conseillée 50 %) ». */
export function constraints(hours: edf.Hour[]) {
  const out: { debut: string; fin: string; signal: string; recharge_conseillee_pct: number }[] = [];
  for (const h of hours) {
    if (h.signal_horaire_texte === "Optimal") continue;
    const last = out[out.length - 1];
    const end = new Date(Date.parse(h.dateheure) + 3600_000).toISOString();
    if (last && last.signal === h.signal_horaire_texte && Date.parse(last.fin) === Date.parse(h.dateheure)) last.fin = end;
    else out.push({ debut: new Date(h.dateheure).toISOString(), fin: end, signal: h.signal_horaire_texte, recharge_conseillee_pct: h.signal_horaire_taux_recharge_conseille });
  }
  return out.map((c) => {
    const d = new Date(Date.parse(c.debut) + 4 * 3600_000);
    const m = (iso: string) => {
      const [h, mn] = localTime(new Date(iso)).split(" ")[1].split(":").map(Number);
      return h * 60 + mn;
    };
    const [start, end] = paire(m(c.debut), m(c.fin));
    return {
      quand: `${WEEKDAYS[d.getUTCDay()]} ${localTime(new Date(c.debut)).split(" ")[0]} de ${start} à ${end}`,
      signal: c.signal.toLowerCase(),
      recharge_conseillee_pct: c.recharge_conseillee_pct,
    };
  });
}

async function settle<T>(p: Promise<{ value: T }>): Promise<T | null> {
  try {
    return (await p).value;
  } catch (err) {
    console.error(`source ${edf.SOURCE.id} indisponible:`, why(err));
    return null;
  }
}

/**
 * The power cuts the mairies relay, from the copy the scheduled event keeps (web/partagees.ts): read, never fetched
 * while a call of the Worker waits. Outside the Worker (the local server, the tests), built when there is no copy.
 */
async function cuts(cache: Cache) {
  const copy = await cache.peek<CourantAnswer>("web:courant").catch(() => undefined);
  if (copy || left() !== Infinity) return copy;
  return cache.get("web:courant", 3600, () => courantCopy()).catch((err) => (console.error(`source ${cc.SOURCE.id} indisponible:`, why(err)), undefined));
}

/** « 30/10 à 22:00 », when EDF last updated the signal's dataset. */
const annonce = (iso: string) => localTime(new Date(iso)).replace(" ", " à ");

export async function electricite(cache: Cache, now = new Date(), lieu?: string) {
  const res = lieu?.trim() ? resolvePlace(lieu) : null;
  if (lieu?.trim() && !res) return notFound(lieu);
  const [m, sig, courant] = await Promise.all([settle(edf.mix(cache)), settle(edf.signal(cache, now)), cuts(cache)]);
  const hours = sig?.heures;
  const coupures = courantBlock(courant, res?.lieu.commune, now);
  if (!m && !hours && !courant) {
    return { ...text({ erreur: "EDF ne répond pas pour le moment.", consulter: edf.SOURCE.url }), isError: true };
  }
  const parts: string[] = [];
  let production;
  if (m) {
    const b = breakdown(m);
    const t = new Date(m.date);
    const age = ageMinutes(t, now);
    parts.push(
      `Production d'électricité à ${localTime(t).split(" ")[1]} (${ageText(age)}) : ${fr(Math.round(m.total))} MW, dont ${fr(b.renouvelable_pct)} % renouvelable. ` +
        `Principales filières : ${b.parts.slice(0, 4).map((p) => `${p.filiere} ${fr(p.part_pct)} %`).join(", ")}.`,
    );
    production = { heure_mesure: `${localTime(t)} heure de La Réunion`, age_min: age, total_mw: Math.round(m.total * 10) / 10, ...b, statut: m.statut === "Estimé" ? "estimé (télémesures, consolidé chaque mois)" : m.statut };
  }
  let signal;
  if (hours) {
    const nowHour = hours.find((h) => Date.parse(h.dateheure) <= now.getTime() && now.getTime() < Date.parse(h.dateheure) + 3600_000);
    const next = constraints(hours.filter((h) => Date.parse(h.dateheure) + 3600_000 > now.getTime()));
    const cyclone = hours.some((h) => h.cyclone_en_cours);
    // EDF's terms: « EDF » and the dataset's last update with its data (31/10/2026).
    // An announcement of EDF for this hour, not a measurement (31/10/2026).
    if (nowHour) parts.push(`Météo de l'électricité EDF pour cette heure : ${nowHour.signal_horaire_texte.toLowerCase()}${sig?.mis_a_jour ? ` (annoncée par EDF le ${annonce(sig.mis_a_jour)})` : ""}.`);
    parts.push(
      next.length
        ? `Moments à éviter pour les gros usages (recharge de véhicule, chauffe-eau, clim) : ${next.slice(0, 4).map((c) => `${c.quand} (${c.signal})`).join("\u00a0; ")}.`
        : "Aucune période de tension annoncée par EDF dans les jours qui viennent.",
    );
    if (cyclone) parts.push("EDF signale une situation cyclonique.");
    signal = {
      maintenant: nowHour ? { signal: nowHour.signal_horaire_texte, couleur: nowHour.signal_horaire_couleur, recharge_conseillee_pct: nowHour.signal_horaire_taux_recharge_conseille } : undefined,
      periodes_de_tension: next,
      jusqu_au: hours.length ? localTime(new Date(hours[hours.length - 1].dateheure)).split(" ")[0] : undefined,
      mis_a_jour: sig?.mis_a_jour ? localTime(new Date(sig.mis_a_jour)) : undefined,
      cyclone_en_cours: cyclone,
      explication:
        "Signal horaire d'EDF : « optimal » = réseau à l'aise\u00a0; « heures de pointe » (souvent 18\u00a0h–21\u00a0h)\u00a0; « contraint » et « très contraint » = " +
        "réseau tendu, décaler les gros usages. La recharge conseillée est la part de la puissance de recharge d'un véhicule électrique.",
    };
  }
  // A mairie's site that did not answer: in marketing's words, as in coupures_annoncees.injoignable.
  const silent = (coupures.injoignable ?? []).map((s) => s.texte);
  if (res) parts.unshift(coupures.avis?.length ? coupures.avis[0].texte : coupures.note ?? "", ...silent);
  else parts.push(...silent);
  // The island: the mairies not read until they agree, in a few words, the whole of it in coupures_annoncees.non_repris.
  const short = res ? undefined : nonReprisCourt();
  if (short) parts.push(`${short[0].toUpperCase()}${short.slice(1)}.`);
  return text({
    ...(res ? { lieu: placeBlock(lieu!, res) } : {}),
    resume: parts.filter(Boolean).join(" "),
    production,
    meteo_electricite: signal,
    coupures_annoncees: coupures,
    avertissements: [
      "La Réunion n'est pas reliée au réseau européen : toute l'électricité est produite sur l'île, d'où les périodes de tension.",
      "Les bioénergies incluent la bagasse des sucreries (en campagne sucrière, de juillet à décembre)\u00a0; la part renouvelable est celle publiée par filière, hors stockage.",
    ],
    sources: courant ? [...credits([edf.SOURCE]), ...courant.value.sources] : credits([edf.SOURCE]),
  });
}
