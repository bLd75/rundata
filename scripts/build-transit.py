#!/usr/bin/env python3
"""Build the bus timetables of La Réunion from the networks' GTFS files (transport.data.gouv.fr, Licence Ouverte).

Two outputs, made from the same build so that their ids agree:
  - src/transit/network.json, bundled with the server: networks, lines, stops (name, place, commune) and service
    calendars, enough to find a stop and to know which services run on a given day; for the networks with a real-time
    feed, its address and the GTFS ids of their stops and lines;
  - dist/transit.sql, for the D1 database: for each stop, the patterns passing there with their time offset, and for
    each pattern, its trips (service, start time). Trips sharing their stops and their running times form one pattern,
    which keeps 880 000 stop times down to about 20 000 rows.

In the database, each network's rows carry ids local to that network and a fingerprint of their content (its feed). A
network whose timetable has not changed keeps its feed, so its rows are already there and are not written again:
with --d1, the feeds the database holds are left out of dist/transit.sql, and the run stops before writing anything
when the import would take the account over D1's daily write quota. dist/transit-prune.sql deletes the feeds no
longer in use; run it once the new build is deployed, on another day if the import was a large one.

Usage: python3 -I scripts/build-transit.py [--cache DIR] [--d1 rundata-transports]
Then: npx wrangler d1 execute rundata-transports --remote --file dist/transit.sql, and deploy.
"""
import argparse
import csv
import hashlib
import io
import json
import subprocess
import tempfile
import time
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Rows D1 lets an account write per day (UTC) on the free plan.
D1_DAILY_WRITES = 100_000
UA = {"User-Agent": "reunion-temps-reel/0.2"}
COMMUNES = "https://geo.api.gouv.fr/departements/974/communes?format=geojson&geometry=contour&fields=nom,code"

# id, name, operator, GTFS (stable data.gouv.fr resource links), page of the dataset.
NETWORKS = [
    ("carjaune", "Car Jaune", "Région Réunion", "https://transport.data.gouv.fr/resources/80934/download",
     "https://transport.data.gouv.fr/datasets/horaires-theoriques-au-format-gtfs-et-horaires-temps-reel-au-format-gtfs-rt-du-reseau-car-jaune-a-la-reunion"),
    ("citalis", "Citalis", "CINOR (Saint-Denis, Sainte-Marie, Sainte-Suzanne)", "https://www.data.gouv.fr/api/1/datasets/r/fc065c47-8644-4941-a8ca-4d8322a45749",
     "https://transport.data.gouv.fr/datasets/horaire-du-reseau-citalis"),
    ("papang", "Téléphérique Papang", "CINOR (Saint-Denis)", "https://www.data.gouv.fr/api/1/datasets/r/fa444b8c-c1c6-4015-ac50-f748c12764d3",
     "https://transport.data.gouv.fr/datasets/citalis-telepherique-papang"),
    ("karouest", "Kar'Ouest", "TCO (Le Port, La Possession, Saint-Paul, Trois-Bassins, Saint-Leu)", "https://www.data.gouv.fr/api/1/datasets/r/c9c2f609-d0cd-4233-ad1b-cf86b9bf2dc8",
     "https://transport.data.gouv.fr/datasets/reseau-karouest"),
    ("alterneo", "Alternéo", "CIVIS (Saint-Pierre, Saint-Louis, Petite-Île, L'Étang-Salé, Les Avirons, Cilaos)", "https://transport.data.gouv.fr/resources/80676/download",
     "https://transport.data.gouv.fr/datasets/donnees-du-reseau-alterneo"),
    ("carsud", "CarSud", "CASUD (Le Tampon, Saint-Joseph, Entre-Deux, Saint-Philippe)", "https://www.data.gouv.fr/api/1/datasets/r/8f3642e3-9fc3-45ed-af46-8c532966ace3",
     "https://transport.data.gouv.fr/datasets/referentiel-topologique-reseau-carsud"),
    ("estival", "Estival", "CIREST (Saint-André, Saint-Benoît, Bras-Panon, Salazie, Plaine-des-Palmistes, Sainte-Rose)", "https://www.data.gouv.fr/api/1/datasets/r/3b659ebb-8c17-46f4-a8ac-78c4129a4a29",
     "https://transport.data.gouv.fr/datasets/jeu-de-donnee-spl-estival-2025"),
]

# The networks that publish their buses in real time (GTFS-RT, Licence Ouverte): the server reads the feed, and
# needs the GTFS ids of their stops and lines, which the feed gives, to match it with the timetables.
REALTIME = {
    "carjaune": "https://www.data.gouv.fr/api/1/datasets/r/c0a17be1-e89a-48a3-aca1-d8eb8e89a55e",
    "alterneo": "https://proxy.transport.data.gouv.fr/resource/alterneo-civis-gtfs-rt-trip-update",
    "carsud": "https://www.data.gouv.fr/api/1/datasets/r/146fe36f-16c5-44bc-ac1a-06c0fedcc4dd",
}


def fetch(url, cache, name):
    path = Path(cache) / name
    if not path.exists():
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=120) as r:
            path.write_bytes(r.read())
    return path.read_bytes()


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][:2]
        xj, yj = ring[j][:2]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def commune_of(lon, lat, communes):
    for c in communes:
        g = c["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        if any(point_in_ring(lon, lat, p[0]) for p in polys):
            return c["properties"]["nom"]
    def dist(c):
        g = c["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        return min((x - lon) ** 2 + (y - lat) ** 2 for poly in polys for x, y in poly[0])
    return min(communes, key=dist)["properties"]["nom"]


def seconds(t):
    h, m, s = (int(x) for x in t.strip().split(":"))
    return h * 3600 + m * 60 + s


def table(z, name):
    try:
        raw = z.read(name)
    except KeyError:
        return []
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))


def sql(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def feeds_in(database):
    """The feeds a D1 database holds in full (a read, which costs no write)."""
    out = subprocess.run(["npx", "wrangler", "d1", "execute", database, "--remote", "--json",
                          "--command", "SELECT feed FROM feeds"],
                         cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        if "no such table" in out.stdout + out.stderr:
            return set()
        raise SystemExit(f"lecture de {database} impossible :\n{out.stderr or out.stdout}")
    return {r["feed"] for r in json.loads(out.stdout)[0]["results"]}


def d1(database, *args):
    out = subprocess.run(["npx", "wrangler", "d1", *args, "--json"], cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"lecture de {database} impossible :\n{out.stderr or out.stdout}")
    return json.loads(out.stdout)


def check_quota(database, new_rows):
    """Refuse an import that would take D1 over its daily write quota: the rows to insert plus those written in the
    last 24 hours (rolling, so a little more than since midnight UTC, when the quota resets). The prune, which
    deletes rows (a deletion is a write too), is run on its own and can wait for another day."""
    used = d1(database, "info", database).get("rows_written_24h") or 0
    print(f"D1 : {used} lignes écrites sur 24 h, {new_rows} à écrire, soit {used + new_rows} sur {D1_DAILY_WRITES}")
    if new_rows and used + new_rows > D1_DAILY_WRITES * 0.95:
        raise SystemExit("import refusé : il dépasserait le quota d'écritures de D1 ; relancer quand les écritures "
                         "des dernières 24 h seront retombées. Rien n'a été modifié.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=tempfile.mkdtemp(prefix="transit-"))
    ap.add_argument("--d1", help="D1 database whose feeds are left out of the SQL, as they are already there")
    args = ap.parse_args()
    communes = json.loads(fetch(COMMUNES, args.cache, "communes.json"))["features"]

    networks, routes, stops, services = {}, [], [], {}
    route_id, stop_id = {}, {}
    passes = defaultdict(list)  # stop index -> [[pattern, offset]]
    patterns = []  # [route index, headsign, [[service, start, trip id]]]
    pattern_id = {}
    digest = hashlib.sha256()

    for net, name, operator, url, page in NETWORKS:
        first = {"first_stop": len(stops), "first_route": len(routes), "first_pattern": len(patterns)}
        blob = fetch(url, args.cache, f"{net}.zip")
        digest.update(blob)
        z = zipfile.ZipFile(io.BytesIO(blob))
        feed = table(z, "feed_info.txt")
        ends = [f.get("feed_end_date") for f in feed if f.get("feed_end_date")]

        gtfs_routes, gtfs_stops = [], []
        for r in table(z, "routes.txt"):
            gtfs_routes.append(r["route_id"])
            route_id[(net, r["route_id"])] = len(routes)
            routes.append([net, (r.get("route_short_name") or "").strip(), (r.get("route_long_name") or "").strip()])

        local_stop = {}
        for s in table(z, "stops.txt"):
            if (s.get("location_type") or "0") not in ("0", ""):
                continue  # stations and entrances: only the places where a bus stops
            lon, lat = float(s["stop_lon"]), float(s["stop_lat"])
            local_stop[s["stop_id"]] = len(stops)
            gtfs_stops.append(s["stop_id"])
            stops.append([net, s["stop_name"].strip(), round(lat, 5), round(lon, 5), commune_of(lon, lat, communes)])
        stop_id.update({(net, k): v for k, v in local_stop.items()})

        # Calendars: [days Monday first as 7 bits, start, end, added dates, removed dates].
        cal = {}
        for c in table(z, "calendar.txt"):
            days = "".join(c[d] for d in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"))
            cal[c["service_id"]] = [int(days, 2), int(c["start_date"]), int(c["end_date"]), [], []]
        for c in table(z, "calendar_dates.txt"):
            entry = cal.setdefault(c["service_id"], [0, 0, 0, [], []])
            entry[3 if c["exception_type"] == "1" else 4].append(int(c["date"]))
        service_index = {sid: i for i, sid in enumerate(sorted(cal))}
        services[net] = [cal[sid] for sid in sorted(cal)]

        trips = {t["trip_id"]: t for t in table(z, "trips.txt")}
        # A trip with frequencies (the cable car: one cabin a minute) stands for one trip per headway.
        every = defaultdict(list)
        for f in table(z, "frequencies.txt"):
            every[f["trip_id"]] += range(seconds(f["start_time"]), seconds(f["end_time"]) + 1, int(f["headway_secs"]))
        times = defaultdict(list)
        for st in table(z, "stop_times.txt"):
            t = st.get("departure_time") or st.get("arrival_time")
            if t and (net, st["stop_id"]) in stop_id:
                times[st["trip_id"]].append((int(st["stop_sequence"]), stop_id[(net, st["stop_id"])], seconds(t)))
        for trip, calls in times.items():
            info = trips.get(trip)
            if not info or info["service_id"] not in service_index or len(calls) < 2:
                continue
            calls.sort()
            start = calls[0][2]
            last_name = stops[calls[-1][1]][1]
            # Some networks put a code in the headsign (« 1800 »): the terminus says more.
            headsign = (info.get("trip_headsign") or "").strip()
            if not headsign or headsign.isdigit():
                headsign = last_name
            key = (route_id[(net, info["route_id"])], headsign,
                   tuple((s, t - start) for _, s, t in calls))
            if key not in pattern_id:
                pattern_id[key] = len(patterns)
                patterns.append([key[0], key[1], []])
                for i, (s, offset) in enumerate(key[2][:-1]):  # no departure from the terminus
                    passes[s].append([pattern_id[key], offset])
            for begin in every.get(trip) or [start]:
                patterns[pattern_id[key]][2].append([service_index[info["service_id"]], begin, trip if begin == start else f"{trip}@{begin}"])

        networks[net] = {"nom": name, "exploitant": operator, "donnees": page, "valide_jusqu_au": max(ends) if ends else None, **first}
        if net in REALTIME:
            networks[net]["temps_reel"] = {"flux": REALTIME[net], "arrets": gtfs_stops, "lignes": gtfs_routes}
        print(f"{net}: {len(local_stop)} arrêts, {len(times)} courses", flush=True)

    # Named after what was built, not only what was downloaded: a change of this script changes the ids too.
    digest.update(json.dumps([routes, stops, services, patterns, sorted(passes.items())], ensure_ascii=False).encode())
    build = digest.hexdigest()[:12]
    # The database rows of each network, with ids local to it, and their fingerprint.
    nets = list(networks)
    bounds = [(networks[n]["first_stop"], networks[n]["first_route"], networks[n]["first_pattern"]) for n in nets]
    nexts = bounds[1:] + [(len(stops), len(routes), len(patterns))]
    by_net = {}
    for net, (s0, r0, p0), (s1, _, p1) in zip(nets, bounds, nexts):
        own_passes = [(s - s0, [[p - p0, o] for p, o in passes[s]]) for s in range(s0, s1) if s in passes]
        own_patterns = [(i - p0, patterns[i][0] - r0, patterns[i][1], sorted(patterns[i][2], key=lambda t: t[1])) for i in range(p0, p1)]
        feed = hashlib.sha256(json.dumps([own_passes, own_patterns], ensure_ascii=False).encode()).hexdigest()[:12]
        networks[net]["feed"] = feed
        by_net[net] = (feed, own_passes, own_patterns)

    present = feeds_in(args.d1) if args.d1 else set()
    if args.d1:
        # Before anything is written: network.json must not name feeds the database will not get.
        check_quota(args.d1, sum(len(ps) + len(pt) + 1 for f, ps, pt in by_net.values() if f not in present))

    out = {"build": build, "networks": networks, "routes": routes, "stops": stops, "services": services}
    path = ROOT / "src" / "transit" / "network.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))

    # WITHOUT ROWID: the primary key is the table itself, so a row costs one write and not two (row and index).
    lines = [
        "CREATE TABLE IF NOT EXISTS passes (feed TEXT NOT NULL, id INTEGER NOT NULL, passes TEXT NOT NULL, PRIMARY KEY (feed, id)) WITHOUT ROWID;",
        "CREATE TABLE IF NOT EXISTS patterns (feed TEXT NOT NULL, id INTEGER NOT NULL, route INTEGER NOT NULL, headsign TEXT NOT NULL, trips TEXT NOT NULL, PRIMARY KEY (feed, id)) WITHOUT ROWID;",
        # A feed is listed here once all its rows are written, so a run cut short is done again.
        "CREATE TABLE IF NOT EXISTS feeds (feed TEXT PRIMARY KEY) WITHOUT ROWID;",
    ]
    def inserts(head, rows):
        # D1 refuses a statement over 100 KB: as many rows per INSERT as fit in 90 KB.
        batch, size = [], 0
        for r in rows:
            if batch and size + len(r) > 90_000:
                lines.append(head + ",".join(batch) + ";")
                batch, size = [], 0
            batch.append(r)
            size += len(r) + 1
        if batch:
            lines.append(head + ",".join(batch) + ";")

    written = 0
    for net, (feed, own_passes, own_patterns) in by_net.items():
        if feed in present:
            print(f"{net}: inchangé ({feed}), rien à écrire")
            continue
        lines.append(f"DELETE FROM passes WHERE feed = {sql(feed)};")
        lines.append(f"DELETE FROM patterns WHERE feed = {sql(feed)};")
        inserts("INSERT INTO passes (feed, id, passes) VALUES ",
                [f"({sql(feed)},{i},{sql(json.dumps(p, separators=(',', ':')))})" for i, p in own_passes])
        inserts("INSERT INTO patterns (feed, id, route, headsign, trips) VALUES ",
                [f"({sql(feed)},{i},{r},{sql(h)},{sql(json.dumps(t, ensure_ascii=False, separators=(',', ':')))})"
                 for i, r, h, t in own_patterns])
        lines.append(f"INSERT INTO feeds (feed) VALUES ({sql(feed)});")
        written += len(own_passes) + len(own_patterns)
        print(f"{net}: nouveau ({feed}), {len(own_passes) + len(own_patterns)} lignes à écrire")

    keep = ",".join(sql(f) for f, _, _ in by_net.values())
    prune = [f"DELETE FROM passes WHERE feed NOT IN ({keep});", f"DELETE FROM patterns WHERE feed NOT IN ({keep});",
             f"DELETE FROM feeds WHERE feed NOT IN ({keep});",
             "DROP TABLE IF EXISTS stop_passes;", "DROP TABLE IF EXISTS pattern;"]
    (ROOT / "dist").mkdir(exist_ok=True)
    (ROOT / "dist" / "transit-prune.sql").write_text("\n".join(prune) + "\n")
    # Every row as the database holds it, for tests and local checks.
    (ROOT / "dist" / "transit-rows.json").write_text(json.dumps(
        {f: {"passes": [{"id": i, "passes": json.dumps(p, separators=(",", ":"))} for i, p in ps],
             "patterns": [{"id": i, "route": r, "headsign": h, "trips": json.dumps(t, ensure_ascii=False, separators=(",", ":"))} for i, r, h, t in pt]}
         for f, ps, pt in by_net.values()}, ensure_ascii=False))

    sql_path = ROOT / "dist" / "transit.sql"
    sql_path.parent.mkdir(exist_ok=True)
    sql_path.write_text("\n".join(lines) + "\n")
    print(f"build {build} : {len(stops)} arrêts, {len(routes)} lignes, {len(patterns)} parcours, "
          f"{len(passes)} arrêts desservis ; {path.stat().st_size // 1024} Ko bundlés, {sql_path.stat().st_size // 1024} Ko de SQL, "
          f"environ {written} lignes écrites dans D1 ({time.strftime('%Y-%m-%d')})")


if __name__ == "__main__":
    main()
