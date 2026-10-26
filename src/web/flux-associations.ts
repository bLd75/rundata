/**
 * The open feed of the events the clubs and associations proposed (espace-associations.md, « Licence et données
 * ouvertes »): all of them, as published, in ICS for calendars and in JSON for anyone who reuses them, the licence
 * written in both. Never the author's address; the public contact only when its author asked for one.
 */
import { count } from "../budget.js";
import { evenement } from "../providers/agenda-propositions.js";
import * as propositions from "../propositions.js";

export const ICS_PATH = "/associations/evenements.ics";
export const JSON_PATH = "/associations/evenements.json";

const LICENCE = { nom: "Licence Ouverte 2.0 (Etalab)", url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/" };
const ATTRIBUTION = "Réutilisation libre, y compris commerciale, en citant l'association organisatrice de chaque événement et la date de mise à jour.";
const PAGE = "https://rundata.re/associations";
// Read again at most every quarter of an hour, like the agenda's copy.
const MAX_AGE = 900;
// Kept this long by the data center (Cache API, s-maxage): a loop of requests costs one D1 read per data center and
// format in that time, not one per request. A change shows there 5 minutes later at most, then in the apps at their
// own pace (max-age, REFRESH-INTERVAL).
const EDGE_SECONDS = 300;

/** « 2026-11-07T18:00 », La Réunion's time, as ISO with its offset. */
const iso = (local: string) => `${local}:00+04:00`;
/** The same as an ICS UTC time: « 20261107T140000Z ». */
const utc = (local: string) => new Date(Date.parse(iso(local))).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const jour = (day: string) => day.split("-").reverse().join("/");

/** The events, as reusers get them. */
export function jsonFeed(lignes: propositions.Ligne[], now: Date): object {
  return {
    titre: "Événements proposés par les clubs et associations de La Réunion sur rundata.re",
    licence: LICENCE,
    attribution: ATTRIBUTION,
    source: PAGE,
    mis_a_jour: now.toISOString(),
    evenements: lignes.map((l) => {
      const e = evenement(l);
      return {
        id: e.id,
        titre: e.titre,
        seances: e.seances.map((s) => ({ debut: iso(s.debut), ...(s.fin ? { fin: iso(s.fin) } : {}) })),
        lieu: e.lieu,
        commune: e.commune,
        prix: e.prix,
        description: e.description,
        ...(e.lien ? { lien: e.lien } : {}),
        organisateur: e.publie_par,
        ...(e.statut ? { statut: e.statut } : {}),
        ...(e.reporte_au ? { reporte_au: e.reporte_au } : {}),
        propose_le: e.propose!.le,
        ...(e.propose!.contact ? { contact: e.propose!.contact } : {}),
        mention: `Proposé par l'organisateur sur rundata.re le ${jour(e.propose!.le)}`,
      };
    }),
  };
}

/** A text value of ICS: backslashes, commas, semicolons and line breaks escaped. */
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");

/** A content line folded at 75 octets, as RFC 5545 asks, never inside a character. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** The events as a calendar: one VEVENT per occurrence, so that each date of a repeated event can be called off alone later. */
export function icsFeed(lignes: propositions.Ligne[], now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//rundata.re//Clubs et associations//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text("Clubs et associations · rundata.re")}`,
    `X-WR-CALDESC:${text(`Événements proposés par les clubs et associations de La Réunion sur rundata.re (${PAGE}). ${LICENCE.nom}, ${LICENCE.url}\u00a0: ${ATTRIBUTION[0].toLowerCase()}${ATTRIBUTION.slice(1)}`)}`,
    "X-WR-TIMEZONE:Indian/Reunion",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const l of lignes) {
    const e = evenement(l);
    const about = [
      e.description,
      `Prix\u00a0: ${e.prix}.`,
      `Organisé par ${e.publie_par}.`,
      e.propose!.contact ? `Contact\u00a0: ${e.propose!.contact}.` : "",
      `Proposé par l'organisateur sur rundata.re le ${jour(e.propose!.le)}.`,
      `${LICENCE.nom}.`,
    ].filter(Boolean).join("\n");
    for (const s of e.seances) {
      lines.push(
        "BEGIN:VEVENT",
        `UID:${e.id}-${s.debut.slice(0, 10)}@rundata.re`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${utc(s.debut)}`,
        ...(s.fin ? [`DTEND:${utc(s.fin)}`] : []),
        // « ANNULÉ : », « REPORTÉ : » (at its new date) before the title, as calendars show no status.
        `SUMMARY:${text(e.statut ? `${e.statut.toUpperCase()}\u00a0: ${e.titre}` : e.titre)}`,
        `LOCATION:${text(`${e.lieu}, ${e.commune}`)}`,
        `DESCRIPTION:${text(about)}`,
        ...(e.lien ? [`URL:${e.lien}`] : []),
        `STATUS:${e.statut === "annulé" ? "CANCELLED" : "CONFIRMED"}`,
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** The data center's cache, none outside a Worker (tests); a cache problem must never cost an answer. */
async function edge(): Promise<Cache | undefined> {
  try {
    return typeof caches === "undefined" ? undefined : await caches.open("flux-associations");
  } catch {
    return undefined;
  }
}

/** GET /associations/evenements.ics or .json: the published events, from today on, kept EDGE_SECONDS by the data center. */
export async function flux(request: Request, path: string, now = new Date()): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("GET seulement.", { status: 405, headers: { allow: "GET, HEAD" } });
  // Without the query: a query added to each request does not get round the copy.
  const key = new Request(`https://rundata.re${path}`);
  const cache = await edge();
  const kept = await cache?.match(key).then((r) => (count(1, "read"), r)).catch(() => undefined);
  if (kept) return kept;
  const lignes = await propositions.visibles(now);
  const headers = { "cache-control": `public, max-age=${MAX_AGE}, s-maxage=${EDGE_SECONDS}`, "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };
  const r = path === ICS_PATH
    ? new Response(icsFeed(lignes, now), { headers: { ...headers, "content-type": "text/calendar; charset=utf-8" } })
    : new Response(JSON.stringify(jsonFeed(lignes, now), null, 1), { headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
  if (cache) {
    try {
      count(1, true);
      await cache.put(key, r.clone());
    } catch {
      // same
    }
  }
  return r;
}
