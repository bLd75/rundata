#!/usr/bin/env python3
"""Build the bus timetables of La Réunion from the networks' GTFS files (transport.data.gouv.fr, Licence Ouverte).

Two outputs, made from the same build so that their ids agree:
  - src/transit/network.json, bundled with the server: networks, lines, stops (name, place, commune) and service
    calendars, enough to find a stop and to know which services run on a given day;
  - dist/transit.sql, for the D1 database: for each stop, the patterns passing there with their time offset, and for
    each pattern, its trips (service, start time). Trips sharing their stops and their running times form one pattern,
    which keeps 880 000 stop times down to about 20 000 rows.

Usage: python3 -I scripts/build-transit.py [--cache DIR]
Then: npx wrangler d1 execute rundata-transports --remote --file dist/transit.sql, and deploy.
"""
import argparse
import csv
import hashlib
import io
import json
import tempfile
import time
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=tempfile.mkdtemp(prefix="transit-"))
    args = ap.parse_args()
    communes = json.loads(fetch(COMMUNES, args.cache, "communes.json"))["features"]

    networks, routes, stops, services = {}, [], [], {}
    route_id, stop_id = {}, {}
    passes = defaultdict(list)  # stop index -> [[pattern, offset]]
    patterns = []  # [route index, headsign, [[service, start, trip id]]]
    pattern_id = {}
    digest = hashlib.sha256()

    for net, name, operator, url, page in NETWORKS:
        blob = fetch(url, args.cache, f"{net}.zip")
        digest.update(blob)
        z = zipfile.ZipFile(io.BytesIO(blob))
        feed = table(z, "feed_info.txt")
        ends = [f.get("feed_end_date") for f in feed if f.get("feed_end_date")]

        for r in table(z, "routes.txt"):
            route_id[(net, r["route_id"])] = len(routes)
            routes.append([net, (r.get("route_short_name") or "").strip(), (r.get("route_long_name") or "").strip()])

        local_stop = {}
        for s in table(z, "stops.txt"):
            if (s.get("location_type") or "0") not in ("0", ""):
                continue  # stations and entrances: only the places where a bus stops
            lon, lat = float(s["stop_lon"]), float(s["stop_lat"])
            local_stop[s["stop_id"]] = len(stops)
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

        networks[net] = {"nom": name, "exploitant": operator, "donnees": page, "valide_jusqu_au": max(ends) if ends else None}
        print(f"{net}: {len(local_stop)} arrêts, {len(times)} courses", flush=True)

    # Named after what was built, not only what was downloaded: a change of this script changes the ids too.
    digest.update(json.dumps([routes, stops, services, patterns, sorted(passes.items())], ensure_ascii=False).encode())
    build = digest.hexdigest()[:12]
    out = {"build": build, "networks": networks, "routes": routes, "stops": stops, "services": services}
    path = ROOT / "src" / "transit" / "network.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))

    lines = [
        "CREATE TABLE IF NOT EXISTS stop_passes (build TEXT NOT NULL, id INTEGER NOT NULL, passes TEXT NOT NULL, PRIMARY KEY (build, id));",
        "CREATE TABLE IF NOT EXISTS pattern (build TEXT NOT NULL, id INTEGER NOT NULL, route INTEGER NOT NULL, headsign TEXT NOT NULL, trips TEXT NOT NULL, PRIMARY KEY (build, id));",
        f"DELETE FROM stop_passes WHERE build = {sql(build)};",
        f"DELETE FROM pattern WHERE build = {sql(build)};",
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

    inserts("INSERT INTO stop_passes (build, id, passes) VALUES ",
            [f"({sql(build)},{s},{sql(json.dumps(p, separators=(',', ':')))})" for s, p in sorted(passes.items())])
    inserts("INSERT INTO pattern (build, id, route, headsign, trips) VALUES ",
            [f"({sql(build)},{i},{p[0]},{sql(p[1])},{sql(json.dumps(sorted(p[2], key=lambda t: t[1]), ensure_ascii=False, separators=(',', ':')))})"
             for i, p in enumerate(patterns)])
    sql_path = ROOT / "dist" / "transit.sql"
    sql_path.parent.mkdir(exist_ok=True)
    sql_path.write_text("\n".join(lines) + "\n")
    print(f"build {build} : {len(stops)} arrêts, {len(routes)} lignes, {len(patterns)} parcours, "
          f"{len(passes)} arrêts desservis ; {path.stat().st_size // 1024} Ko bundlés, {sql_path.stat().st_size // 1024} Ko de SQL "
          f"({time.strftime('%Y-%m-%d')})")


if __name__ == "__main__":
    main()
