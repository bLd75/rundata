/**
 * The open feed of the events the clubs and associations proposed (espace-associations.md, « Licence et données
 * ouvertes »): all of them, as published, in ICS for calendars and in JSON for anyone who reuses them, the licence
 * written in both. Never the author's address; the public contact only when its author asked for one.
 */
import { evenement } from "../providers/agenda-propositions.js";
import * as propositions from "../propositions.js";

export const ICS_PATH = "/associations/evenements.ics";
export const JSON_PATH = "/associations/evenements.json";

const LICENCE = { nom: "Licence Ouverte 2.0 (Etalab)", url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/" };
const ATTRIBUTION = "Réutilisation libre, y compris commerciale, en citant l'association organisatrice de chaque événement et la date de mise à jour.";
const PAGE = "https://rundata.re/associations";
// Read again at most every quarter of an hour, like the agenda's copy.
const MAX_AGE = 900;

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
    `X-WR-CALDESC:${text(`Événements proposés par les clubs et associations de La Réunion sur rundata.re (${PAGE}). ${LICENCE.nom}, ${LICENCE.url} : ${ATTRIBUTION}`)}`,
    "X-WR-TIMEZONE:Indian/Reunion",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const l of lignes) {
    const e = evenement(l);
    const about = [
      e.description,
      `Prix : ${e.prix}.`,
      `Organisé par ${e.publie_par}.`,
      e.propose!.contact ? `Contact : ${e.propose!.contact}.` : "",
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
        `SUMMARY:${text(e.statut ? `${e.statut.toUpperCase()} : ${e.titre}` : e.titre)}`,
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

/** GET /associations/evenements.ics or .json: the published events, from today on. */
export async function flux(request: Request, path: string, now = new Date()): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("GET seulement.", { status: 405, headers: { allow: "GET, HEAD" } });
  const lignes = await propositions.visibles(now);
  const headers = { "cache-control": `public, max-age=${MAX_AGE}`, "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };
  return path === ICS_PATH
    ? new Response(icsFeed(lignes, now), { headers: { ...headers, "content-type": "text/calendar; charset=utf-8" } })
    : new Response(JSON.stringify(jsonFeed(lignes, now), null, 1), { headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
}
