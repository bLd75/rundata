/** The words of the agendas, shared by the town halls' feeds and the halls' programmes. */

export const MONTHS: [RegExp, number][] = [
  [/^janv(?:ier)?$|^janvie$/, 1], [/^f[eé]v(?:rier)?$|^fevrie$/, 2], [/^mars$/, 3], [/^avr(?:il)?$/, 4], [/^mai$|^m[eé]$/, 5],
  [/^juin$|^zuin$/, 6], [/^juil(?:let)?$|^zuiy[eé]$/, 7], [/^ao[uû]t$|^out$/, 8], [/^sept(?:embre)?$|^sektanm$|^septanm$/, 9],
  [/^oct(?:obre)?$|^oktob$/, 10], [/^nov(?:embre)?$|^novanm$/, 11], [/^d[eé]c(?:embre)?$|^d[eé]sanm$/, 12],
];
/** The month a word names, French or Creole: « oct », « novembre », « désanm ». */
export const monthOf = (w: string) => MONTHS.find(([re]) => re.test(w))?.[1];

/**
 * What `quoi` can ask, and the words of an event that answer it; the same themes are the genres a row is labelled with.
 * Accents matter on the event side: « marche » is a walk. « Spectacles » takes in théâtre, danse, humour and cirque.
 */
// A word starts where letters do (« conte » is not in « post_content »); `END` closes those whose longer forms mean
// something else (« pièce », « contemporain »).
export const W = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alts})`, "iu");
const END = "(?![\\p{L}])";

/** `sauf`: words that say the event is not of the theme, though its words are there. */
export const THEMES: { nom: string; genre: string; demande: RegExp; texte: RegExp; sauf?: RegExp }[] = [
  { nom: "concerts et musique", genre: "concert", demande: /concert|musique|music|maloya|sega|seggae|kabar|jazz|rock|metal|reggae|rap|hip hop|electro|classique|recital|chanson|zouk/, texte: W(`concerts?${END}|musique|musical|maloya|s[ée]ga${END}|seggae|kabar|jazz|rock${END}|m[ée]tal${END}|reggae|dancehall|dub${END}|rap${END}|hip.hop|[ée]lectro|blues|soul${END}|funk|zouk|chansons?${END}|r[ée]cital|piano|orchestre|symphon|chant(?:eur|euse|s)?${END}|chorale|bal${END}|live${END}|plato zartis|sono mondiale`) },
  { nom: "théâtre", genre: "théâtre", demande: /theatre|piece|comedie|spectacle/, texte: W(`th[ée][âa]tre|com[ée]die|lecture${END}`) },
  { nom: "danse", genre: "danse", demande: /danse|ballet|choregraph|battle|spectacle/, texte: W(`danses?${END}|ballet|chor[ée]graph|battle`) },
  { nom: "humour", genre: "humour", demande: /humour|humoriste|stand ?up|comedy|one man|one woman|rire|spectacle/, texte: W(`humour|humoriste|stand.?up|comedy|one.(?:wo)?man|seul.en.sc[èe]ne`) },
  { nom: "cirque, contes et magie", genre: "cirque", demande: /cirque|conte|magie|marionnette|spectacle/, texte: W(`cirque|circassien|contes?${END}|conteu(?:r|se)s?${END}|magie|magicien|marionnette|clown`) },
  { nom: "soirées et clubbing", genre: "soirée", demande: /soiree|club|clubbing|\bdj\b|danser|boite|nightlife|fete ce soir/, texte: W(`clubbing|dj${END}|dj.set|club${END}|kizomba|salsa|bachata|sbk${END}|soir[ée]e (?:dansante|zouk|salsa|kizomba|clubbing|[ée]lectro|dj|sbk|ann[ée]es)|nuit du (?:zouk|s[ée]ga|maloya)|bal poussi[èe]re`) },
  { nom: "marchés", genre: "marché", demande: /marche|forain|brocante|vide grenier|braderie|foire|producteur/, texte: W(`march[ée]s? (?:de nuit|forain|artisanal|paysan|nocturne|cr[ée]ole|de no[ëe]l)|marchés?${END}|forains?${END}|brocante|vide.grenier|braderie|foire${END}|producteurs`) },
  { nom: "fêtes et festivals", genre: "festival", demande: /fete|fet\b|festival|kermesse|carnaval|feu d artifice|kabar/, texte: W(`f[êe]tes?${END}|f[èe]t${END}|festival|kermesse|carnaval|feu d.artifice|som[èe]n${END}|semaine cr[ée]ole|zourn[ée]|kabar|temps fort`) },
  { nom: "cinéma", genre: "cinéma", demande: /cinema|film|projection|cine\b|documentaire/, texte: W(`cin[ée]ma|projections?${END}|films?${END}|documentaire|court.m[ée]trage`) },
  { nom: "sport", genre: "sport", demande: /sport|course|trail|randonnee|tournoi|match|velo|dragon|rallye/, texte: W(`sports?${END}|sporti(?:f|ve)|courses?${END}|trail${END}|randonn[ée]e|tournoi|match${END}|v[ée]lo|koupe|dragon boat|nage${END}|natation|surf${END}|rallye`) },
  // « Famille » alone also names what is for parents (« village famille et jeunesse », a talk on parenting): only « en
  // famille » and « familial » say the children are welcome. An age given for them says it too (extrait()).
  { nom: "pour les enfants", genre: "enfants", demande: /enfant|marmaille|famille|kids|jeune public|ado/, texte: W(`enfants?${END}|marmailles?${END}|en famille|familia(?:l|le|ux)${END}|jeune public|escape game|ludique|jeux${END}|frissons|kids${END}`), sauf: W(`parentalit[ée]|pour les parents|collecte de jouets|dons? de jouets|sans enfants?${END}`) },
  { nom: "expositions et visites", genre: "exposition", demande: /expo|musee|patrimoine|visite|galerie/, texte: W(`expo|mus[ée]e|patrimoine|visites?${END}|galerie`) },
  { nom: "ateliers et rencontres", genre: "atelier", demande: /atelier|conference|forum|salon|formation|permanence|rencontre|reunion publique|concertation/, texte: W(`ateliers?${END}|conf[ée]rences?${END}|forum${END}|salon${END}|formation|permanences?${END}|rencontres?${END}|congr[èe]s|r[ée]unions? publiques?|concertation|enqu[êe]te publique|consultation|stage${END}|webinaire|s[ée]minaire`) },
];
/** Whether a text names a theme. */
export const names = (t: (typeof THEMES)[number], text: string) => t.texte.test(text) && !t.sauf?.test(text);
/** The genres a text names. */
export const themesIn = (text: string) => THEMES.filter((t) => names(t, text)).map((t) => t.genre);

const N = String.raw`(\d{1,2})`;
const UNIT = String.raw`(mois|ans?)`;
const AGES: RegExp[] = [
  // « de 6 mois à 6 ans », « à partir de 6 mois à 6 ans », « de 3 à 12 ans », « 3-12 ans », « pour les 6–10 ans »
  new RegExp(String.raw`(?:(?:à partir de|dès|de)\s+)?${N}\s*${UNIT}?\s*(?:à|au|-|–|—)\s*${N}\s*ans(?![\p{L}])`, "iu"),
  // « dès 10 ans », « à partir de 3 ans », « dès l'âge de 8 ans » (not « plus de 10 ans » of a festival's history)
  new RegExp(String.raw`(?:à partir de|dès(?: l['’]âge de)?)\s*${N}\s*${UNIT}(?![\p{L}])`, "iu"),
  // « jusqu'à 12 ans »
  new RegExp(String.raw`jusqu['’]à\s*${N}\s*${UNIT}(?![\p{L}])`, "iu"),
  // « 8 ans et plus »
  new RegExp(String.raw`${N}\s*${UNIT}\s*et\s*plus(?![\p{L}])`, "iu"),
];

/** The ages a child's age said in words stands for, in years: « 6 mois à 6 ans » → 0.5 to 6; « dès 10 ans » → from 10. */
export function ageRange(said: string): { min?: number; max?: number } | undefined {
  const years = (n: string, unit?: string) => (unit && /^mois/i.test(unit) ? Number(n) / 12 : Number(n));
  let m = AGES[0].exec(said);
  if (m) {
    const [min, max] = [years(m[1], m[2]), Number(m[3])];
    return min < max && max <= 18 ? { min, max } : undefined;
  }
  if ((m = AGES[1].exec(said)) || (m = AGES[3].exec(said))) {
    const min = years(m[1], m[2]);
    return min < 18 ? { min } : undefined;
  }
  if ((m = AGES[2].exec(said))) {
    const max = years(m[1], m[2]);
    return max <= 18 ? { max } : undefined;
  }
  return undefined;
}

// What a price says of an age is not who the event is for: « gratuit jusqu'à 12 ans », « tarif réduit 3-12 ans ».
const PRICE = /gratuit|tarif|réduit|€|prix|offert|entrée/i;

/**
 * The children's ages an event's text gives, in its own words (« À partir de 6 mois à 6 ans », « dès 10 ans »), or
 * undefined: never guessed. An adult's age (« dès 18 ans ») is not one, nor an age a price is given for.
 */
export function ageIn(text: string): string | undefined {
  for (const re of AGES) {
    const m = re.exec(text);
    if (m && ageRange(m[0]) && !PRICE.test(text.slice(Math.max(0, m.index - 30), m.index))) return m[0].trim();
  }
  return undefined;
}

/** At most this of a reused agenda's text: the cap of a « sentence » that has no full stop. */
export const LEAD_MAX = 200;
/**
 * The first sentence of a text, short: all a reused agenda gives of it besides the facts (« Concert gratuit de l'école
 * de musique, ouvert à tous. »), cut at a word under LEAD_MAX when it never ends.
 */
export function lead(s: string): string {
  const first = (/^.+?[.!?…](?=\s|$|\p{Lu})/u.exec(s)?.[0] ?? s).trim();
  return first.length > LEAD_MAX ? `${first.slice(0, LEAD_MAX - 1).replace(/\s+\S*$/, "")}…` : first;
}

/**
 * What is kept of an event's text: its first sentence, and the genres the rest of it names, never its words. The
 * search still finds a « concert » said in the third sentence of a programme (« Cirque et musique »).
 */
export function extrait(text: string): { description?: string; themes?: string[]; age?: string } {
  const description = lead(text) || undefined;
  if (!description) return {};
  const age = ageIn(text);
  const shown = new Set(themesIn(description));
  const themes = [...new Set([...themesIn(text), ...(age ? ["enfants"] : [])])].filter((g) => !shown.has(g));
  return { description, ...(themes.length ? { themes } : {}), ...(age ? { age } : {}) };
}

export type Statut = "annulé" | "reporté" | "complet";

/**
 * What a title says (« ANNULÉ – Fête du quartier », « [COMPLET] »), or a description that says so in so many words
 * (« est annulé », « reporté au 5 décembre »); a description that merely mentions a past postponement is not enough.
 */
// Accented words end where letters do: \b would not see the end of « annulé ».
const word = (w: string) => `(?<![\\p{L}])(?:${w})(?![\\p{L}])`;
const CANCELLED_TITLE = new RegExp(word("annul[ée]e?s?|cancel(?:l?ed)?"), "iu");
const CANCELLED_TEXT = new RegExp(`(?:est|sont|a été|ont été)\\s+annul[ée]`, "iu");
// Written in capitals in a text, it is the news itself.
const CANCELLED_CAPS = new RegExp(word("ANNUL[ÉE]E?S?"), "u");
const POSTPONED_TITLE = new RegExp(word("report[ée]e?s?"), "iu");
const POSTPONED_TEXT = new RegExp(`(?:est|sont|a été|ont été)\\s+report[ée]|${word("report[ée]e?s?")}\\s+(?:au|à)\\s+(?:une\\s+date|\\d|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)`, "iu");
const POSTPONED_CAPS = new RegExp(word("REPORT[ÉE]E?S?"), "u");
const FULL_TITLE = new RegExp(word("complet|sold.?out"), "iu");

export function statusOf(titre: string, description = ""): Statut | undefined {
  if (CANCELLED_TITLE.test(titre) || CANCELLED_TEXT.test(description) || CANCELLED_CAPS.test(description)) return "annulé";
  if (POSTPONED_TITLE.test(titre) || POSTPONED_TEXT.test(description) || POSTPONED_CAPS.test(description)) return "reporté";
  if (FULL_TITLE.test(titre)) return "complet";
  return undefined;
}
