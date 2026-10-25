/**
 * Buses in real time: the GTFS-RT feeds that some networks publish (Car Jaune, Alternéo, CarSud; transport.data.gouv.fr,
 * Licence Ouverte), read at most once a minute. For each trip on the road, a feed gives the time it is now expected at
 * each of its next stops, or that it skips a stop, or that the trip is cancelled; where the bus is, when it sends its
 * position (Car Jaune, CarSud); and the traffic alerts. Only those
 * fields are decoded, by hand: protocol buffers are simple enough for that, and a library would weigh more than this
 * file. Ids are the networks' own GTFS ids, matched with the timetables through src/transit/network.json.
 */
import type { Cache, Cached } from "../cache.js";
import { getBytes } from "../http.js";
import type { SourceInfo } from "../types.js";
import { NETWORKS } from "./transit.js";

export const SOURCE: SourceInfo = {
  id: "gtfs_rt_reunion",
  nom: "Bus en direct de La Réunion (GTFS-RT)",
  organisme: "Région Réunion (Car Jaune), CIVIS (Alternéo), CASUD (CarSud)",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Réseaux de transport de La Réunion, via transport.data.gouv.fr",
  url: "https://transport.data.gouv.fr",
};

const FRESH_SECONDS = 60;
// A feed older than this is a feed that stopped: the timetables alone are given.
export const MAX_AGE_SECONDS = 15 * 60;
export const SKIPPED = -1;

export interface Alert {
  titre: string;
  texte?: string;
  /** GTFS route ids and stop ids it is about. */
  lignes: string[];
  arrets: string[];
  /** When it applies, in seconds since 1970; none: until further notice. */
  periodes: [number | null, number | null][];
}

export interface Vehicle {
  trip: string;
  /** Its GTFS route id, when the feed gives it. */
  route?: string;
  lat: number;
  lon: number;
  /** When the position was taken, in seconds since 1970: the feed's time when it gives none. */
  at: number;
  /** The stop (GTFS id) it is at or going to, and which: 0 arriving, 1 at the stop, 2 on its way (the default). */
  stop?: string;
  status?: number;
}

export interface Realtime {
  /** When the feed was produced, in seconds since 1970. */
  at: number;
  /** By trip id, the time each next stop (GTFS stop id) is expected at, in seconds since 1970; SKIPPED if it is not served. */
  trips: Record<string, Record<string, number>>;
  cancelled: string[];
  /** The buses that send their position. Absent from a feed read before they were decoded. */
  vehicles?: Vehicle[];
  alerts: Alert[];
}

/**
 * A protocol buffer message read field by field. A cursor rather than callbacks: a feed has thousands of fields, and
 * a function created for each would cost more than the reading itself.
 */
class Reader {
  /** The last field read: its number, its value (varint, or a 32-bit float) or the bounds of its bytes (length-delimited). */
  field = 0;
  value = 0;
  from = 0;
  to = 0;
  private i: number;

  constructor(
    private b: Uint8Array,
    start = 0,
    private end = b.length,
  ) {
    this.i = start;
  }

  /** The bytes of the last field, as a reader. */
  sub(): Reader {
    return new Reader(this.b, this.from, this.to);
  }

  /** Ids are short and ASCII: building the string directly is many times faster than a TextDecoder. */
  str(): string {
    let s = "";
    for (let k = this.from; k < this.to; k++) {
      if (this.b[k] >= 0x80) return utf8.decode(this.b.subarray(this.from, this.to));
      s += String.fromCharCode(this.b[k]);
    }
    return s;
  }

  text(): string {
    return utf8.decode(this.b.subarray(this.from, this.to));
  }

  private varint(): number {
    // Numbers, not bit operations: timestamps need more than 32 bits.
    let r = 0;
    let m = 1;
    let c: number;
    do {
      c = this.b[this.i++];
      r += (c & 0x7f) * m;
      m *= 128;
    } while (c >= 0x80 && this.i < this.end);
    return r;
  }

  /** Moves to the next field; false at the end of the message. */
  next(): boolean {
    for (;;) {
      if (this.i >= this.end) return false;
      const key = this.varint();
      this.field = Math.floor(key / 8);
      const type = key % 8;
      if (type === 0) {
        this.value = this.varint();
        this.from = this.to = 0;
        return true;
      }
      if (type === 2) {
        const n = this.varint();
        this.from = this.i;
        this.to = this.i += n;
        return true;
      }
      if (type === 5) {
        for (let k = 0; k < 4; k++) FLOAT.setUint8(k, this.b[this.i++]);
        this.value = FLOAT.getFloat32(0, true);
        this.from = this.to = 0;
        return true;
      }
      if (type === 1) this.i += 8;
      else throw new Error(`GTFS-RT : type de champ ${type} inconnu`);
    }
  }
}

const utf8 = new TextDecoder();
/** The 4 bytes of a float field (a position), read little-endian as the format has them. */
const FLOAT = new DataView(new ArrayBuffer(4));

/** The first translation of a TranslatedString (translation 1, its text 1). */
function translated(r: Reader): string {
  while (r.next()) {
    if (r.field !== 1) continue;
    const t = r.sub();
    while (t.next()) if (t.field === 1) return t.text().trim();
  }
  return "";
}

export function decode(b: Uint8Array): Realtime {
  const out: Realtime = { at: 0, trips: {}, cancelled: [], alerts: [] };
  const r = new Reader(b);
  while (r.next()) {
    if (r.field === 1) {
      const h = r.sub();
      while (h.next()) if (h.field === 3) out.at = h.value;
    } else if (r.field === 2) {
      const e = r.sub();
      while (e.next()) {
        if (e.field === 3) tripUpdate(e.sub(), out);
        else if (e.field === 4) vehicle(e.sub(), out);
        else if (e.field === 5) out.alerts.push(alert(e.sub()));
      }
    }
  }
  return out;
}

// TripUpdate: trip (1), stop_time_update (2). TripDescriptor: trip_id (1), schedule_relationship (4, 3 = CANCELED).
// StopTimeUpdate: arrival (2) and departure (3) with their time (2), stop_id (4), schedule_relationship (5, 1 = SKIPPED).
function tripUpdate(r: Reader, out: Realtime) {
  let id = "";
  let cancelled = false;
  let stops: Record<string, number> | undefined;
  while (r.next()) {
    if (r.field === 1) {
      const t = r.sub();
      while (t.next()) {
        if (t.field === 1 && t.to) id = t.str();
        else if (t.field === 4 && t.value === 3) cancelled = true;
      }
    } else if (r.field === 2) {
      const u = r.sub();
      let stop = "";
      let arrival = 0;
      let departure = 0;
      let skipped = false;
      while (u.next()) {
        if (u.field === 4 && u.to) stop = u.str();
        else if (u.field === 5 && u.value === 1) skipped = true;
        else if ((u.field === 2 || u.field === 3) && u.to) {
          const ev = u.sub();
          while (ev.next()) {
            if (ev.field === 2) {
              if (u.field === 2) arrival = ev.value;
              else departure = ev.value;
            }
          }
        }
      }
      if (stop) (stops ??= {})[stop] = skipped ? SKIPPED : departure || arrival;
    }
  }
  if (!id) return;
  if (cancelled) out.cancelled.push(id);
  else if (stops) out.trips[id] = stops;
}

// VehiclePosition: trip (1: trip_id 1, route_id 5), position (2: latitude 1, longitude 2), current_status (4),
// timestamp (5), stop_id (7). Not the vehicle (8): its plate is nobody's business. A position off the island is dropped.
function vehicle(r: Reader, out: Realtime) {
  let trip = "";
  let route: string | undefined;
  let lat = 0;
  let lon = 0;
  let at = 0;
  let stop: string | undefined;
  let status: number | undefined;
  while (r.next()) {
    if (r.field === 1 && r.to) {
      const t = r.sub();
      while (t.next()) {
        if (t.field === 1 && t.to) trip = t.str();
        else if (t.field === 5 && t.to) route = t.str();
      }
    } else if (r.field === 2 && r.to) {
      const p = r.sub();
      while (p.next()) {
        if (p.field === 1) lat = p.value;
        else if (p.field === 2) lon = p.value;
      }
    } else if (r.field === 4) status = r.value;
    else if (r.field === 5) at = r.value;
    else if (r.field === 7 && r.to) stop = r.str();
  }
  if (!trip || Math.abs(lat + 21.1) > 0.5 || Math.abs(lon - 55.5) > 0.5) return;
  (out.vehicles ??= []).push({ trip, ...(route ? { route } : {}), lat, lon, at: at || out.at, ...(stop ? { stop } : {}), ...(status !== undefined ? { status } : {}) });
}

// Alert: active_period (1: start 1, end 2), informed_entity (5: route_id 2, stop_id 5), header_text (10),
// description_text (11).
function alert(r: Reader): Alert {
  const a: Alert = { titre: "", lignes: [], arrets: [], periodes: [] };
  while (r.next()) {
    if (r.field === 1) {
      const p: [number | null, number | null] = [null, null];
      const t = r.sub();
      while (t.next()) {
        if (t.field === 1) p[0] = t.value;
        else if (t.field === 2) p[1] = t.value;
      }
      a.periodes.push(p);
    } else if (r.field === 5) {
      const e = r.sub();
      while (e.next()) {
        if (e.field === 2 && e.to) a.lignes.push(e.str());
        else if (e.field === 5 && e.to) a.arrets.push(e.str());
      }
    } else if (r.field === 10) a.titre = translated(r.sub());
    else if (r.field === 11) a.texte = translated(r.sub()) || undefined;
  }
  return a;
}

/** Whether an alert applies at `now` (seconds since 1970). */
export const active = (a: Alert, now: number) => !a.periodes.length || a.periodes.some(([s, e]) => (s ?? 0) <= now && now < (e ?? Infinity));

/** The networks with a real-time feed. */
export const withRealtime = () => Object.keys(NETWORKS).filter((n) => NETWORKS[n].temps_reel);

/** The last feed of a network, at most a minute old; undefined for a network without one. */
export async function realtime(cache: Cache, net: string): Promise<Cached<Realtime> | undefined> {
  const url = NETWORKS[net]?.temps_reel?.flux;
  if (!url) return undefined;
  return cache.get(`rt:${net}`, FRESH_SECONDS, async () => decode(new Uint8Array(await getBytes(SOURCE.id, url, 8000))));
}
