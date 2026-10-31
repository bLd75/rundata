/** Geography of La Réunion, as far as choosing a representative station goes. */

export const BBOX = { lonMin: 55.15, latMin: -21.45, lonMax: 55.9, latMax: -20.8 };

export function inReunion(lon: number, lat: number): boolean {
  return lon >= BBOX.lonMin && lon <= BBOX.lonMax && lat >= BBOX.latMin && lat <= BBOX.latMax;
}

export function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];

/** French compass point (O for ouest). */
export function compass(deg: number): string {
  return POINTS[Math.round(deg / 22.5) % 16];
}

/**
 * Which side of the island a point is on. The trade winds blow from the east-south-east, so the east is wet
 * and windy ("au vent") and the west is dry and sheltered ("sous le vent"); the cirques and high plains in
 * the middle have their own climate. Taken from the bearing seen from the island's centre.
 */
export type Versant = "nord" | "est (au vent)" | "sud" | "ouest (sous le vent)" | "centre (cirques, plaines)";

const CENTRE = { lon: 55.536, lat: -21.115 };

export function versant(lon: number, lat: number): Versant {
  if (distanceKm(CENTRE.lon, CENTRE.lat, lon, lat) < 15) return "centre (cirques, plaines)";
  const b = bearingDeg(CENTRE.lon, CENTRE.lat, lon, lat);
  if (b >= 330 || b < 30) return "nord";
  if (b < 160) return "est (au vent)";
  if (b < 230) return "sud";
  return "ouest (sous le vent)";
}

const LOCAL = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Indian/Reunion",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** "20/10 15:30", Réunion time (UTC+4, no daylight saving). */
export function localTime(d: Date): string {
  return LOCAL.format(d).replace(",", "").replace(" à ", " ");
}

/** Whole days from `a`'s day to `b`'s, in La Réunion: 1 from 23:59 to 00:00. */
export function daysApart(a: Date, b: Date): number {
  const day = (d: Date) => Date.parse(new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10));
  return Math.round((day(b) - day(a)) / 86_400_000);
}

/** Seconds since the last midnight in La Réunion: a copy older than that was made the day before. */
export function sinceMidnight(now: Date): number {
  return Math.floor(((now.getTime() + 4 * 3600_000) % 86_400_000) / 1000);
}

export function ageMinutes(d: Date, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000));
}

/** "il y a 25 min", "il y a 3 h", "il y a 2 jours". */
export function ageText(minutes: number): string {
  if (minutes < 90) return `il y a ${minutes} min`;
  if (minutes < 48 * 60) return `il y a ${Math.round(minutes / 60)} h`;
  return `il y a ${Math.round(minutes / 1440)} jours`;
}
