/**
 * The paths that carry a secret, e-mailed to a club: whoever holds one acts for the club. Nothing the Worker writes
 * down keeps the secret: its log lines, Analytics Engine's points and the signals of the pages see « …/* » in its place.
 *
 * - a proposal's page (web/propositions.ts, PROPOSITION_PATH);
 * - the link confirming or removing a platform's connection (web/connecteurs.ts, CONNEXION_PATH);
 * - the link that opens a club's space, and the space itself (web/club.ts): every path under /associations/club/ but
 *   the request of a link, /associations/club/demande.
 */
const SECRETS = ["/associations/proposition/", "/associations/connexion/", "/associations/club/acces/"];
const CLUB = "/associations/club/";
const CLUB_PUBLICS = new Set(["demande"]);

/** `path` with the secret after one of these paths replaced by « * »; any other path as it is. */
export function cheminMasque(path: string): string {
  const secret = SECRETS.find((s) => path.startsWith(s) && path.length > s.length);
  if (secret) return `${secret}*`;
  if (path.startsWith(CLUB) && path.length > CLUB.length && !CLUB_PUBLICS.has(path.slice(CLUB.length))) return `${CLUB}*`;
  return path;
}
