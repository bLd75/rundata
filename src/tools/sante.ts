/**
 * Pharmacies and hospitals (sante/etablissements.ts), answered by annuaire_services_publics when the question is
 * about them. The duty pharmacy is never guessed: only 3237.fr and the 32 37 know it, as the ARS La Réunion says.
 * Which hospital has an emergency department is not in FINESS either: the 15 first, which directs.
 */
import { resolvePlace } from "../places/resolve.js";
import * as sante from "../sante/etablissements.js";
import { credits, de, fr, notFound, placeBlock, text } from "./format.js";

/** Whether `quoi` asks about a pharmacy. */
export const PHARMACY = /pharmac|officine|m[ée]dicament/i;
/** Whether `quoi` asks about the emergencies or a hospital. */
export const EMERGENCY = /urgence|h[ôo]pita|clinique|\bchu\b|samu|\bsmur\b/i;

const km = (n: number) => `${fr(Math.round(n * 10) / 10)} km`;
const row = (e: sante.Etablissement & { km?: number }) => ({
  nom: e.nom,
  adresse: `${e.adresse}${e.adresse ? ", " : ""}${e.commune}`,
  distance_km: e.km != null ? Math.round(e.km * 10) / 10 : undefined,
  telephone: e.telephone ?? undefined,
});

export function pharmaciesAnswer(lieu: string | undefined) {
  const res = lieu?.trim() ? resolvePlace(lieu) : null;
  if (lieu?.trim() && !res) return notFound(lieu);
  const near = res ? sante.nearest(res.lieu.lon, res.lieu.lat, ["pharmacie"]) : [];
  const garde = `Pharmacie de garde (${sante.GARDE.quand}) : le site 3237.fr, ou le ${sante.GARDE.telephone}, d'après l'ARS La Réunion.`;
  return text({
    ...(res ? { lieu: placeBlock(lieu!, res) } : {}),
    resume: near.length
      ? `${garde} Les pharmacies les plus proches ${de(res!.lieu.nom)} : ${near.slice(0, 3).map((e) => `${e.nom} (${e.adresse}, ${e.commune}, à ${km(e.km)}${e.telephone ? `, tél. ${e.telephone}` : ""})`).join("\u00a0; ")}.`
      : `${garde} Donner un lieu pour les pharmacies les plus proches : ${sante.ETABLISSEMENTS.filter((e) => e.type === "pharmacie").length} pharmacies dans l'île.`,
    pharmacie_de_garde: { ...sante.GARDE, source: sante.ARS_GARDE.url },
    pharmacies: near.length ? near.map(row) : undefined,
    avertissements: [
      "rundata.re ne sait pas quelle pharmacie est de garde : seuls 3237.fr et le 32 37 le disent. Ne jamais en désigner une comme étant de garde.",
      "Horaires d'ouverture non publiés dans FINESS : appeler la pharmacie.",
    ],
    sources: credits([sante.FINESS, sante.ARS_GARDE]),
  });
}

export function urgencesAnswer(lieu: string | undefined) {
  const res = lieu?.trim() ? resolvePlace(lieu) : null;
  if (lieu?.trim() && !res) return notFound(lieu);
  const near = res ? sante.nearest(res.lieu.lon, res.lieu.lat, ["hopital", "clinique"], 4) : [];
  const first = "Urgence : appeler le 15 (SAMU) ou le 112. Ne pas se rendre aux urgences sans avoir appelé le 15, qui oriente vers le bon service (Santé.fr).";
  return text({
    ...(res ? { lieu: placeBlock(lieu!, res) } : {}),
    resume: near.length
      ? `${first} Hôpitaux et cliniques les plus proches ${de(res!.lieu.nom)} : ${near.slice(0, 3).map((e) => `${e.nom} (${e.commune}, à ${km(e.km)}${e.telephone ? `, standard ${e.telephone}` : ""})`).join("\u00a0; ")}.`
      : first,
    numeros: { samu: "15", europeen: "112", pompiers: "18", sourds_et_malentendants: "114" },
    urgences_pediatriques: { sites: ["CHU Nord (Saint-Denis)", "CHU Sud (Saint-Pierre)", "CHOR (Saint-Paul)"], source: sante.SANTE_FR.url },
    etablissements: near.length ? near.map((e) => ({ ...row(e), type: e.type === "hopital" ? "hôpital" : "clinique" })) : undefined,
    avertissements: ["FINESS ne dit pas quels établissements ont un service d'urgences ouvert : le 15 oriente.", "Pharmacie de garde : 3237.fr ou le 32 37 (payant)."],
    sources: credits([sante.SANTE_FR, sante.FINESS]),
  });
}
