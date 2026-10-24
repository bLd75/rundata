import type { Cache } from "../cache.js";
import { localTime } from "../geo.js";
import * as seismes from "../providers/seismes.js";
import * as volcan from "../providers/volcan.js";
import { why } from "../types.js";
import { credits, fr, text } from "./format.js";

const DAY = 86_400_000;
const OFFICIAL =
  "En cas d'éruption ou d'alerte, seules comptent les consignes de la préfecture (reunion.gouv.fr) et de l'OVPF-IPGP. " +
  "L'accès à l'Enclos est réglementé par arrêté préfectoral : le vérifier avant de partir.";

// Worded by marketing: what is said when the prefecture's phase could not be read, and none was kept.
const NIVEAU_INCONNU = "à vérifier sur reunion.gouv.fr";

const day = (iso: string) => localTime(new Date(iso)).split(" ")[0];
const ACCESS: Record<string, string> = { ouvert: "ouvert", partiel: "partiellement ouvert", ferme: "fermé", fermé: "fermé" };

async function settle<T>(source: string, p: Promise<{ value: T }>): Promise<T | null> {
  try {
    return (await p).value;
  } catch (err) {
    console.error(`source ${source} indisponible:`, why(err));
    return null;
  }
}

/** Counts and the most notable events of the last 30 days, under the volcano and elsewhere. */
export function quakeSummary(list: seismes.Seisme[], now: Date) {
  const recent = (s: seismes.Seisme, days: number) => now.getTime() - Date.parse(s.time) <= days * DAY;
  const volcano = list.filter(seismes.underSummit);
  const elsewhere = list.filter((s) => !seismes.underSummit(s));
  const max = (l: seismes.Seisme[]) => (l.length ? Math.max(...l.map((s) => s.magnitude)) : null);
  const one = (s: seismes.Seisme) => ({
    heure: `${localTime(new Date(s.time))} heure de La Réunion`,
    magnitude: Math.round(s.magnitude * 10) / 10,
    profondeur_km: Math.round(s.profondeur_km * 10) / 10,
    lieu: seismes.where(s.lon, s.lat),
  });
  return {
    sous_le_volcan: { "30_jours": volcano.length, "7_jours": volcano.filter((s) => recent(s, 7)).length, magnitude_max_30j: max(volcano) },
    ailleurs_sur_l_ile: { "30_jours": elsewhere.length, magnitude_max_30j: max(elsewhere) },
    derniers: list.slice(0, 8).map(one),
    note:
      "Séismes localisés par l'OVPF (magnitude de durée Md). La plupart sont trop faibles pour être ressentis " +
      "(en général pas avant magnitude 2,5 à 3). Une hausse de leur nombre sous le sommet peut précéder une éruption.",
  };
}

/**
 * pitonlive's state, with the phase the prefecture declared when its release is as recent as pitonlive's status or
 * more: the prefecture declares each phase first, pitonlive follows within hours.
 */
export function official(s: volcan.PitonState, p: volcan.Phase): volcan.PitonState & { prefecture?: volcan.Phase } {
  const known = s.status.published_at ? Date.parse(s.status.published_at) : 0;
  // The release has a day, not an hour: it wins from its day on.
  if (Date.parse(p.publie) - 12 * 3600_000 < known) return s;
  const enclos = p.enclos ?? s.access?.current?.enclos_status;
  return {
    ...s,
    status: { ...s.status, alert_level_display: p.niveau, alert_level: p.niveau.toLowerCase(), is_erupting: p.eruption || s.status.is_erupting },
    access: enclos
      ? { current: { available: true, global_status: enclos, enclos_status: enclos, summary: p.titre, source_name: "Préfecture de La Réunion", source_url: p.lien } }
      : s.access,
    prefecture: p,
  };
}

/** The prefecture's release whose phase won over pitonlive's, as the answer gives it. */
function prefecture(state: volcan.PitonState & { prefecture?: volcan.Phase }) {
  const p = state.prefecture;
  return p ? { niveau: p.niveau, titre: p.titre, lien: p.lien, publie: p.publie } : undefined;
}

export async function volcanSeismes(cache: Cache, now = new Date()) {
  const [piton, posts, quakes, phase] = await Promise.all([
    settle(volcan.PITONLIVE.id, volcan.state(cache)),
    settle(volcan.OVPF.id, volcan.posts(cache)),
    settle(seismes.SOURCE.id, seismes.seismes(cache, now)),
    settle(volcan.PREFECTURE.id, volcan.phase(cache)),
  ]);
  const state = piton && phase ? official(piton, phase) : piton;
  // No phase of the prefecture, read or kept (providers/volcan.ts): pitonlive's level is said only when it is an alert.
  // It follows the prefecture by hours or days, and must never say « Vigilance » while the prefecture is in alert.
  const unknown = !!state && !phase && !/^(Alerte|Sauvegarde)/i.test(state.status.alert_level_display);
  if (!state && !posts && !quakes && !phase) {
    return {
      ...text({ erreur: "Les sources sur le volcan ne répondent pas pour le moment.", consulter: [seismes.SOURCE.url, volcan.OVPF.url] }),
      isError: true,
    };
  }

  const parts: string[] = [];
  if (state) {
    const s = state.status;
    const p = (state as { prefecture?: volcan.Phase }).prefecture;
    parts.push(
      s.is_erupting
        // The day only from an official text: pitonlive's start time is not one (the page says none either).
        ? `ÉRUPTION EN COURS au Piton de la Fournaise${p?.eruption ? `, annoncée par la préfecture le ${day(p.publie)}` : ""}.`
        : /^Alerte/.test(s.alert_level_display)
          ? `${s.alert_level_display} au Piton de la Fournaise : éruption probable à très brève échéance, pas encore commencée selon les dernières informations.`
          : unknown
            ? "Pas d'éruption en cours au Piton de la Fournaise selon pitonlive.com."
            : "Pas d'éruption en cours au Piton de la Fournaise.",
    );
    if (p) parts.push(`Communiqué de la préfecture du ${day(p.publie)} : « ${p.titre} » (${p.lien}).`);
    parts.push(`Niveau du dispositif ORSEC volcan : ${unknown ? NIVEAU_INCONNU : s.alert_level_display}.`);
    if (!s.is_erupting && state.last_eruption_ended_at) {
      parts.push(`Dernière éruption terminée le ${day(state.last_eruption_ended_at)} (il y a ${state.days_since_last_eruption} jours).`);
    }
    const a = unknown ? undefined : state.access?.current;
    if (unknown) parts.push(`Accès à l'Enclos : ${NIVEAU_INCONNU}, avant de partir.`);
    if (a?.available) parts.push(`Accès à l'Enclos : ${ACCESS[a.enclos_status] ?? a.enclos_status}${a.source_name ? ` (${a.source_name})` : ""}.`);
  }
  const last = posts?.[0];
  if (last) parts.push(`Dernière publication de l'OVPF sur l'activité (${day(last.date)}) : « ${last.texte.slice(0, 220)}${last.texte.length > 220 ? "…" : ""} »`);
  const q = quakes ? quakeSummary(quakes, now) : null;
  if (q) {
    parts.push(
      `Séismes localisés par l'OVPF en 30 jours : ${q.sous_le_volcan["30_jours"]} sous le volcan` +
        (q.sous_le_volcan.magnitude_max_30j != null ? ` (magnitude max ${fr(Math.round(q.sous_le_volcan.magnitude_max_30j * 10) / 10)})` : "") +
        `, dont ${q.sous_le_volcan["7_jours"]} ces 7 derniers jours ; ${q.ailleurs_sur_l_ile["30_jours"]} ailleurs sur l'île.`,
    );
  }

  // The prefecture is credited when its phase is the one given: a phase kept from May loses to pitonlive's of October.
  const sources = [...(phase && (!state || (state as { prefecture?: volcan.Phase }).prefecture) ? [volcan.PREFECTURE] : []), ...(state ? [volcan.PITONLIVE] : []), ...(posts ? [volcan.OVPF] : []), ...(quakes ? [seismes.SOURCE] : [])];
  return text({
    resume: parts.join(" "),
    etat: state
      ? {
          eruption_en_cours: state.status.is_erupting,
          eruption: state.eruption ?? undefined,
          niveau_orsec: unknown ? NIVEAU_INCONNU : state.status.alert_level_display,
          ...(unknown && { niveau_inconnu: true }),
          derniere_eruption_fin: state.last_eruption_ended_at ?? undefined,
          deformation: state.deformation?.available ? `${state.deformation.label} (communiqué du ${day(state.deformation.published_at!)})` : undefined,
          acces_enclos: !unknown && state.access?.current?.available
            ? {
                statut: state.access.current.enclos_status,
                detail: state.access.current.summary,
                source: state.access.current.source_name,
                lien: state.access.current.source_url,
              }
            : undefined,
          communique_prefecture: prefecture(state),
          source: (state as { prefecture?: volcan.Phase }).prefecture
            ? "préfecture de La Réunion (communiqué), complété par pitonlive.com"
            : "pitonlive.com (site indépendant, à recouper avec les sources officielles)",
        }
      : "indisponible",
    publications_ovpf: posts ? posts.slice(0, 3).map((p) => ({ ...p, date: `${localTime(new Date(p.date))} heure de La Réunion` })) : "indisponible",
    seismes: q ?? "indisponible",
    avertissements: [OFFICIAL],
    consulter: ["https://www.ipgp.fr/observation/observatoires/ovpf/", "https://www.reunion.gouv.fr", volcan.OVPF.url],
    sources: credits(sources),
  });
}
