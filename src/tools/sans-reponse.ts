import type { Cache } from "../cache.js";
import { constatEnMots, etat, jour, jourHeure, publiques, type Public } from "../sans-reponse.js";
import { PATH } from "../web/sans-reponse.js";
import { SITE_URL } from "./citer.js";
import { text } from "./format.js";

const STATUTS = { injoignable: "sans réponse", bloque: "répond, mais pas à nos lectures", revenu: "répond de nouveau" } as const;

const plain = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[’']/g, " ").replace(/\s+/g, " ").trim();

/** A row asked for by « volcan », « eau », « Saint-Joseph », « OVPF »: its editor, theme, host or what it is missing. */
const matches = (l: Public, quoi: string) => [l.nom, l.theme, l.hote, l.manque ?? ""].some((x) => plain(x).includes(plain(quoi)));

const accueil = (l: Public) => {
  try {
    return `${new URL(l.url).origin}/`;
  } catch {
    return `https://${l.hote}/`;
  }
};

function site(l: Public) {
  const statut = l.statut as keyof typeof STATUTS;
  return {
    site: `le site de ${l.nom}`,
    statut: STATUTS[statut],
    depuis: jour(statut === "revenu" ? (l.revenu_le ?? l.premier_echec) : l.premier_echec),
    dernier_essai: l.dernier_essai ? jourHeure(l.dernier_essai) : undefined,
    constat: statut === "injoignable" ? constatEnMots(l.constat) : undefined,
    manque_ici: statut === "revenu" ? undefined : (l.manque ?? undefined),
    lien: accueil(l),
  };
}

/** sites_sans_reponse: the public sites that do not answer, all of them or those `quoi` names. */
export async function sitesSansReponse(cache: Cache, quoi?: string, now = new Date()) {
  const { lignes } = await etat(cache);
  const all = publiques(lignes);
  const asked = quoi?.trim() ? all.filter((l) => matches(l, quoi.trim())) : all;
  const silent = asked.filter((l) => l.statut !== "revenu");
  const today = jour(Math.floor(now.getTime() / 1000));
  const oldest = silent[0];
  const resume = silent.length
    ? `${silent.length} site${silent.length > 1 ? "s" : ""} public${silent.length > 1 ? "s" : ""} sans réponse ce ${today}${quoi?.trim() ? ` pour « ${quoi.trim()} »` : ""}, revérifié${silent.length > 1 ? "s" : ""} chaque jour\u00a0; le plus ancien depuis le ${jour(oldest.premier_echec)} (le site de ${oldest.nom}).`
    : `Aucun site public sans réponse ce ${today}${quoi?.trim() ? ` pour « ${quoi.trim()} »` : ""}, d'après la revérification quotidienne.`;
  return text({ resume, sites: asked.map(site), page: `${SITE_URL}${PATH}` });
}
