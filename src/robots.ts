/**
 * What robots.txt forbids every robot (`User-agent: *`, web/site.ts writes it from INTERDITS), and the robots that
 * name themselves but read those addresses anyway: they are answered 403 before anything is read or built.
 *
 * On 30/10/2026, meta-externalagent asked 12 285 pages in 2 hours, 9 493 of them trips (/bus/trajet/…, the same one
 * 4 times in 6 s), for 22 529 subrequests, though robots.txt forbids the trips to every robot since #356 and Meta had
 * read it that day. A browser, a link preview (facebookexternalhit) or a search engine is never refused here.
 */
import { RENDU_PATH } from "./providers/vigilance-carte.js";
import { TRIP_PATH } from "./tools/transports.js";
import { STOP_PATH } from "./web/domains.js";

/** Forbidden to every robot, as robots.txt's Disallow lines write them: the start of the path and its query. */
export const INTERDITS = [`${STOP_PATH}?q=`, `${TRIP_PATH}/`, RENDU_PATH];

/** Robots that name themselves in their User-Agent and are refused what robots.txt forbids them. */
export const ROBOTS_NOMMES = ["meta-externalagent", "GPTBot", "ClaudeBot", "Bytespider", "CCBot", "Amazonbot", "PerplexityBot"];

/** Whether robots.txt forbids `url` to every robot: its path and query start with one of INTERDITS. */
export const interdit = (url: URL) => INTERDITS.some((p) => (url.pathname + url.search).startsWith(p));

/** The robot of ROBOTS_NOMMES a User-Agent names, whatever its case. */
export const robotNomme = (ua: string) => ROBOTS_NOMMES.find((n) => ua.toLowerCase().includes(n.toLowerCase()));

/** A 403 for a named robot on an address robots.txt forbids it, with a log line to count them; undefined otherwise. */
export function refusRobot(request: Request): Response | undefined {
  const nom = robotNomme(request.headers.get("user-agent") ?? "");
  if (!nom) return undefined;
  const url = new URL(request.url);
  if (!interdit(url)) return undefined;
  console.log(`robot refusé : ${nom} (${url.pathname})`);
  return new Response(`Interdit par ${url.origin}/robots.txt\n`, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
