#!/usr/bin/env python3
"""Build the bus timetables of La Réunion from the networks' GTFS files (transport.data.gouv.fr, Licence Ouverte).

Two outputs, made from the same build so that their ids agree:
  - src/transit/network.json, bundled with the server: networks, lines, stops (name, place, commune) and service
    calendars, enough to find a stop and to know which services run on a given day; the hours and services of each
    pattern, and its line, first stop and last stop; for the networks with a real-time feed, its address and the GTFS ids
    of their stops and lines;
  - dist/transit.sql, for the D1 database: for each stop, the patterns passing there with their time offset, and for
    each pattern, its trips (service, start time) and, in pattern_stops, its stops in their order. Trips sharing their
    stops and their running times form one pattern, which keeps 880 000 stop times down to about 23 000 rows.

In the database, each network's rows carry ids local to that network and a fingerprint of their content (its feed; the
patterns' stops have one of their own, stops_feed). A network whose timetable has not changed keeps its feed, so its
rows are already there and are not written again:
with --d1, the feeds the database holds are left out of dist/transit.sql, and the run stops before writing anything
when the import would take the account over D1's daily write quota. dist/transit-prune.sql deletes the feeds no
longer in use; run it once the new build is deployed, on another day if the import was a large one.

Usage: python3 -I scripts/build-transit.py [--cache DIR] [--d1 rundata-transports]
Then: npx wrangler d1 execute rundata-transports --remote --file dist/transit.sql, and deploy.
"""
import argparse
import re
import unicodedata
from datetime import date, timedelta
import csv
import hashlib
import io
import json
import os
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


def feeds_in(database, table="feeds"):
    """The feeds a D1 database holds in full (a read, which costs no write)."""
    out = subprocess.run(["npx", "wrangler", "d1", "execute", database, "--remote", "--json",
                          "--command", f"SELECT feed FROM {table}"],
                         cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        if "no such table" in out.stdout + out.stderr:
            return set()
        raise SystemExit(f"lecture de {database} impossible :\n{out.stderr or out.stdout}")
    return {r["feed"] for r in json.loads(out.stdout)[0]["results"]}


def wrangler(*args):
    out = subprocess.run(["npx", "wrangler", *args, "--json"], cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"wrangler {' '.join(args)} a échoué :\n{out.stderr or out.stdout}")
    return json.loads(out.stdout)


def rows_written_today():
    """The rows written in D1 since midnight UTC, by every database of the account together: the quota is the account's,
    and the daily climate job (rundata-climat, rundata-climat-h) counts in it as much as this database. Read from
    Cloudflare's analytics with wrangler's login; `wrangler d1 info` is no help here, as it counts one database, and
    gave 0 for rundata-climat-h on 24 October 2026, the day 20 209 rows were written in it."""
    accounts = wrangler("whoami")["accounts"]
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID") or (accounts[0]["id"] if len(accounts) == 1 else None)
    if not account:
        raise SystemExit("plusieurs comptes Cloudflare : indiquer le bon dans CLOUDFLARE_ACCOUNT_ID")
    query = """query($a: String!, $d: Date!) { viewer { accounts(filter: {accountTag: $a}) {
      d1AnalyticsAdaptiveGroups(limit: 100, filter: {date: $d}) { sum { rowsWritten } } } } }"""
    day = time.strftime("%Y-%m-%d", time.gmtime())
    req = urllib.request.Request("https://api.cloudflare.com/client/v4/graphql",
                                 data=json.dumps({"query": query, "variables": {"a": account, "d": day}}).encode(),
                                 headers={"Authorization": f"Bearer {wrangler('auth', 'token')['token']}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.load(r)
    if res.get("errors") or not res.get("data"):
        raise SystemExit(f"analytique D1 illisible : {res.get('errors')}")
    return sum(g["sum"]["rowsWritten"] for a in res["data"]["viewer"]["accounts"] for g in a["d1AnalyticsAdaptiveGroups"])


def check_quota(new_rows):
    """Refuse an import that would take D1 over its daily write quota: the rows to insert plus those the account has
    written since midnight UTC, when the quota resets. `new_rows` counts one write per row, which is what these tables
    cost, having no rowid and no other index: 16 430 rows for the whole timetable, 16 436 written on a local copy, 16 440
    counted by Cloudflare for the import of 23 October 2026 (a table with a rowid would cost one write more per row, for
    its primary key, and so would each index). The prune, which deletes rows (a deletion is a write too), is run on its
    own and can wait for another day."""
    used = rows_written_today()
    print(f"D1 : {used} lignes écrites aujourd'hui (UTC) par tout le compte, {new_rows} à écrire, soit {used + new_rows} sur {D1_DAILY_WRITES}")
    if new_rows and used + new_rows > D1_DAILY_WRITES * 0.95:
        raise SystemExit("import refusé : il dépasserait le quota d'écritures de D1 ; relancer après minuit UTC "
                         "(4 h à La Réunion), quand le quota repart à zéro. Rien n'a été modifié.")


# The stop pages (/bus/arret/…) that search engines may index: those with at least 2 lines and 60 buses on an ordinary
# Tuesday, about 730 of some 4 900, under the 1 000 the sitemap may hold (test/arret.test.ts). The others have their page
# too, not indexed: thousands of pages with a few buses a day would read as thin content.
INDEX_LINES, INDEX_PASSES = 2, 60


def name_key(name):
    """A stop's name as the server groups it (src/providers/transit.ts, `expand`): normalized, « St » and « Ste » in full."""
    s = unicodedata.normalize("NFD", re.sub(r"\s+quai\s+\S+$", "", " ".join(name.split()), flags=re.I).lower())
    s = re.sub(r"[\W_]+", " ", "".join(c for c in s if not unicodedata.category(c).startswith("M"))).strip()
    return re.sub(r"\bste\b", "sainte", re.sub(r"\bst\b", "saint", s))


def indexed_stops(stops, services, patterns, calls_of, day):
    """The stops of the groups (name and commune, all networks) busy enough to be indexed, by their buses on `day`."""
    ymd, weekday = int(day.strftime("%Y%m%d")), day.weekday()

    def runs(net, service):
        days, first, last, added, removed = services[net][service]
        if ymd in removed:
            return False
        return ymd in added or (first <= ymd <= last and (days >> (6 - weekday)) & 1 == 1)

    lines, buses = defaultdict(set), defaultdict(int)
    for i, (route, _, trips) in enumerate(patterns):
        net = stops[calls_of[i][1][0][0]][0]
        n = sum(1 for service, _, _ in trips if runs(net, service))
        if not n:
            continue  # a line that does not run that day does not serve the stop
        for stop, _ in calls_of[i][1]:
            key = (name_key(stops[stop][1]), stops[stop][4])
            lines[key].add(route)
            buses[key] += n
    busy = {k for k in lines if len(lines[k]) >= INDEX_LINES and buses[k] >= INDEX_PASSES}
    return sorted(i for i, s in enumerate(stops) if (name_key(s[1]), s[4]) in busy), len(busy)


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
    calls_of = []  # by pattern: [direction (GTFS direction_id, or None), [[stop index, offset], …] terminus included]
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
                direction = (info.get("direction_id") or "").strip()
                calls_of.append([int(direction) if direction.isdigit() else None, [list(c) for c in key[2]]])
                for i, (s, offset) in enumerate(key[2][:-1]):  # no departure from the terminus
                    passes[s].append([pattern_id[key], offset])
            for begin in every.get(trip) or [start]:
                patterns[pattern_id[key]][2].append([service_index[info["service_id"]], begin, trip if begin == start else f"{trip}@{begin}"])

        networks[net] = {"nom": name, "exploitant": operator, "donnees": page, "valide_jusqu_au": max(ends) if ends else None, **first}
        if net in REALTIME:
            networks[net]["temps_reel"] = {"flux": REALTIME[net], "arrets": gtfs_stops, "lignes": gtfs_routes}
        print(f"{net}: {len(local_stop)} arrêts, {len(times)} courses", flush=True)

    # Named after what was built, not only what was downloaded: a change of this script changes the ids too.
    digest.update(json.dumps([routes, stops, services, patterns, sorted(passes.items()), calls_of], ensure_ascii=False).encode())
    build = digest.hexdigest()[:12]
    # The database rows of each network, with ids local to it, and their fingerprint.
    nets = list(networks)
    bounds = [(networks[n]["first_stop"], networks[n]["first_route"], networks[n]["first_pattern"]) for n in nets]
    nexts = bounds[1:] + [(len(stops), len(routes), len(patterns))]
    by_net = {}
    stops_by_net = {}
    for net, (s0, r0, p0), (s1, _, p1) in zip(nets, bounds, nexts):
        own_passes = [(s - s0, [[p - p0, o] for p, o in passes[s]]) for s in range(s0, s1) if s in passes]
        own_patterns = [(i - p0, patterns[i][0] - r0, patterns[i][1], sorted(patterns[i][2], key=lambda t: t[1])) for i in range(p0, p1)]
        feed = hashlib.sha256(json.dumps([own_passes, own_patterns], ensure_ascii=False).encode()).hexdigest()[:12]
        networks[net]["feed"] = feed
        by_net[net] = (feed, own_passes, own_patterns)
        # The stops of each pattern, in their order, under a fingerprint of their own: added to a database that already
        # holds the network's passes and patterns, they cost their rows only, and a server that finds none still runs.
        own_calls = [(i - p0, calls_of[i][0], [[st - s0, o] for st, o in calls_of[i][1]]) for i in range(p0, p1)]
        stops_feed = hashlib.sha256(json.dumps(own_calls).encode()).hexdigest()[:12]
        networks[net]["stops_feed"] = stops_feed
        stops_by_net[net] = (stops_feed, own_calls)

    present = feeds_in(args.d1) if args.d1 else set()
    present_stops = feeds_in(args.d1, "stops_feeds") if args.d1 else set()
    if args.d1:
        # Before anything is written: network.json must not name feeds the database will not get.
        check_quota(sum(len(ps) + len(pt) + 1 for f, ps, pt in by_net.values() if f not in present)
                    + sum(len(c) + 1 for f, c in stops_by_net.values() if f not in present_stops))

    # For each pattern, the first and last start of its trips and their services: enough for the server to leave out,
    # before reading them, the patterns with no trip in the hours asked about (D1 counts every row read).
    spans = [[min(t[1] for t in p[2]), max(t[1] for t in p[2]), *sorted({t[0] for t in p[2]})] for p in patterns]
    # The line of each pattern, its first stop and its last: what a line is made of, and where a departure comes from and
    # goes, without reading the database.
    ends = [[p[0], calls_of[i][1][0][0], calls_of[i][1][-1][0]] for i, p in enumerate(patterns)]
    # A Tuesday, the first after the build: a working day, with the timetables of the season.
    today = date.today()
    tuesday = today + timedelta(days=(1 - today.weekday()) % 7 or 7)
    indexed, pages = indexed_stops(stops, services, patterns, calls_of, tuesday)
    out = {"build": build, "networks": networks, "routes": routes, "stops": stops, "services": services, "patterns": spans, "ends": ends, "indexes": indexed}
    path = ROOT / "src" / "transit" / "network.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))

    # WITHOUT ROWID: the primary key is the table itself, so a row costs one write and not two (row and index).
    lines = [
        "CREATE TABLE IF NOT EXISTS passes (feed TEXT NOT NULL, id INTEGER NOT NULL, passes TEXT NOT NULL, PRIMARY KEY (feed, id)) WITHOUT ROWID;",
        "CREATE TABLE IF NOT EXISTS patterns (feed TEXT NOT NULL, id INTEGER NOT NULL, route INTEGER NOT NULL, headsign TEXT NOT NULL, trips TEXT NOT NULL, PRIMARY KEY (feed, id)) WITHOUT ROWID;",
        # A feed is listed here once all its rows are written, so a run cut short is done again.
        "CREATE TABLE IF NOT EXISTS feeds (feed TEXT PRIMARY KEY) WITHOUT ROWID;",
        # The stops of each pattern in their order (sens: GTFS direction_id), by the network's stops_feed.
        "CREATE TABLE IF NOT EXISTS pattern_stops (feed TEXT NOT NULL, id INTEGER NOT NULL, sens INTEGER, stops TEXT NOT NULL, PRIMARY KEY (feed, id)) WITHOUT ROWID;",
        "CREATE TABLE IF NOT EXISTS stops_feeds (feed TEXT PRIMARY KEY) WITHOUT ROWID;",
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
    for net, (feed, own_calls) in stops_by_net.items():
        if feed in present_stops:
            print(f"{net}: arrêts des parcours inchangés ({feed})")
            continue
        lines.append(f"DELETE FROM pattern_stops WHERE feed = {sql(feed)};")
        inserts("INSERT INTO pattern_stops (feed, id, sens, stops) VALUES ",
                [f"({sql(feed)},{i},{sql(d)},{sql(json.dumps(c, separators=(',', ':')))})" for i, d, c in own_calls])
        lines.append(f"INSERT INTO stops_feeds (feed) VALUES ({sql(feed)});")
        written += len(own_calls)
        print(f"{net}: arrêts des parcours nouveaux ({feed}), {len(own_calls)} lignes à écrire")

    keep = ",".join(sql(f) for f, _, _ in by_net.values())
    keep_stops = ",".join(sql(f) for f, _ in stops_by_net.values())
    prune = [f"DELETE FROM passes WHERE feed NOT IN ({keep});", f"DELETE FROM patterns WHERE feed NOT IN ({keep});",
             f"DELETE FROM feeds WHERE feed NOT IN ({keep});",
             f"DELETE FROM pattern_stops WHERE feed NOT IN ({keep_stops});", f"DELETE FROM stops_feeds WHERE feed NOT IN ({keep_stops});",
             "DROP TABLE IF EXISTS stop_passes;", "DROP TABLE IF EXISTS pattern;"]
    (ROOT / "dist").mkdir(exist_ok=True)
    (ROOT / "dist" / "transit-prune.sql").write_text("\n".join(prune) + "\n")
    # Every row as the database holds it, for tests and local checks.
    (ROOT / "dist" / "transit-rows.json").write_text(json.dumps(
        {f: {"passes": [{"id": i, "passes": json.dumps(p, separators=(",", ":"))} for i, p in ps],
             "patterns": [{"id": i, "route": r, "headsign": h, "trips": json.dumps(t, ensure_ascii=False, separators=(",", ":"))} for i, r, h, t in pt]}
         for f, ps, pt in by_net.values()}
        | {f: {"pattern_stops": [{"id": i, "sens": d, "stops": json.dumps(c, separators=(",", ":"))} for i, d, c in calls]}
           for f, calls in stops_by_net.values()}, ensure_ascii=False))

    sql_path = ROOT / "dist" / "transit.sql"
    sql_path.parent.mkdir(exist_ok=True)
    sql_path.write_text("\n".join(lines) + "\n")
    print(f"build {build} : {len(stops)} arrêts, {len(routes)} lignes, {len(patterns)} parcours, "
          f"{len(passes)} arrêts desservis ; {path.stat().st_size // 1024} Ko bundlés, {sql_path.stat().st_size // 1024} Ko de SQL, "
          f"environ {written} lignes écrites dans D1 ({time.strftime('%Y-%m-%d')}) ; "
          f"{pages} pages d'arrêt indexables ({len(indexed)} arrêts), d'après le mardi {tuesday.isoformat()}")


if __name__ == "__main__":
    main()
