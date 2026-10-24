#!/usr/bin/env python3
"""Build the SQL of the D1 database `rundata-climat`: every daily measurement of every Météo-France station of La Réunion.

From Météo-France's « Données climatologiques de base quotidiennes » (Licence Ouverte 2.0), département 974: the files
before 1949, 1950-2024 and the current period (updated every morning with the day before), each in two parts
(rain, temperature and wind; other parameters). Values Météo-France marks doubtful (quality code 2) are left out.

Tables (all WITHOUT ROWID, so that a row written is one row counted by D1):
- postes: one row per station (name, position, altitude, first and last year, parameters measured);
- jours: one row per station and year, `data` = JSON {field: [value of each day of the year, or null]}, the index being
  the day of the year minus one; trailing nulls dropped;
- records: one row per station, its extremes up to the end of `jusqu_a` (the tool adds the years after from `jours`).

Fields kept: RR (rain, mm, from 06 UTC that day to 06 UTC the next), TN and TX (min and max, °C), TM (mean of the hourly
temperatures), FXI (strongest gust, m/s), INST (sunshine, minutes), SIGMA (sunshine, % of the possible), GLOT (global
radiation, J/cm²), UM (mean relative humidity, %).

Usage:
  python3 -I scripts/build-climat.py --dir <folder of the .csv.gz> --out dist/climat.sql           # everything, once
  python3 -I scripts/build-climat.py --recent --out climat-jour.sql                                 # the current year
`--recent` reads the current period's files (found through data.gouv.fr) and writes the rows of the current year, and
of the year before in January, as INSERT OR REPLACE: what the daily job (.github/workflows/climat.yml) imports.
"""
import argparse
import csv
import datetime as dt
import gzip
import io
import json
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

DATASET = "https://www.data.gouv.fr/api/2/datasets/6569b51ae64326786e4e8e1a/resources/?page_size=100&q=974"
BASE = "https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT/"
UA = {"User-Agent": "rundata.re (open source MCP server, real-time data for Reunion Island)"}
FIELDS = {"RR-T-Vent": ["RR", "TN", "TX", "TM", "FXI"], "autres-parametres": ["INST", "SIGMA", "GLOT", "UM"]}
MAX_STATEMENT = 90_000
# The current file has some 70 stations: fewer means a broken file, better keep yesterday's rows.
MIN_RECENT = 40
SCHEMA = """CREATE TABLE IF NOT EXISTS postes (poste TEXT PRIMARY KEY, nom TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, alt INTEGER, debut INTEGER NOT NULL, fin INTEGER NOT NULL, params TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS jours (poste TEXT NOT NULL, annee INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (poste, annee)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS records (poste TEXT PRIMARY KEY, jusqu_a INTEGER NOT NULL, data TEXT NOT NULL) WITHOUT ROWID;
"""


def opened(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600)


def latest_urls():
    """The current period's two files, whatever their years (2025-2026 today, 2026-2027 from January)."""
    res = json.load(opened(DATASET))["data"]
    urls = [r["url"] for r in res if "Q_974_latest" in r["url"]]
    found = {part: next((u for u in urls if u.endswith(f"_{part}.csv.gz")), None) for part in FIELDS}
    if None in found.values():
        raise SystemExit(f"fichiers de la période en cours introuvables : {urls}")
    return found


def files(folder):
    """Every file of the archive in `folder`: (part, path)."""
    for p in sorted(Path(folder).glob("Q_974_*.csv.gz")):
        part = next((k for k in FIELDS if p.name.endswith(f"_{k}.csv.gz")), None)
        if part:
            yield part, open(p, "rb")


def rows(raw):
    return csv.DictReader(io.TextIOWrapper(gzip.GzipFile(fileobj=raw), encoding="utf-8", newline=""), delimiter=";")


def read(sources, years=None):
    """station → year → field → {day of year: value}, and station → its latest name, position, altitude."""
    data = defaultdict(lambda: defaultdict(lambda: defaultdict(dict)))
    meta = {}
    for part, raw in sources:
        for r in rows(raw):
            d = r["AAAAMMJJ"]
            y = int(d[:4])
            if years and y not in years:
                continue
            doy = dt.date(y, int(d[4:6]), int(d[6:8])).timetuple().tm_yday
            st = r["NUM_POSTE"]
            got = False
            for f in FIELDS[part]:
                v = (r.get(f) or "").strip()
                if v and (r.get("Q" + f) or "").strip() != "2":
                    data[st][y][f][doy] = float(v)
                    got = True
            if got and (st not in meta or d >= meta[st][4]):
                meta[st] = (r["NOM_USUEL"], float(r["LAT"]), float(r["LON"]), int(float(r["ALTI"] or 0)), d)
    return data, meta


def number(v):
    return int(v) if v == int(v) else v


def year_json(y, fields):
    n = 366 if dt.date(y, 12, 31).timetuple().tm_yday == 366 else 365
    out = {}
    for f, days in fields.items():
        col = [number(days[i]) if i in days else None for i in range(1, n + 1)]
        while col and col[-1] is None:
            col.pop()
        if col:
            out[f] = col
    return json.dumps(out, separators=(",", ":"))


def sql(s):
    return "'" + s.replace("'", "''") + "'"


def records(years, until):
    """The extremes of a station up to the end of `until`: absolute and month by month, each with its day."""
    best = {"tx": None, "tn": None, "rr": None, "fxi": None}
    month = {k: [None] * 12 for k in ("tx", "tn", "rr")}
    higher = lambda a, b: a > b
    lower = lambda a, b: a < b
    pick = {"tx": ("TX", higher), "tn": ("TN", lower), "rr": ("RR", higher), "fxi": ("FXI", higher)}
    for y, fields in sorted(years.items()):
        if y > until:
            continue
        for key, (f, beats) in pick.items():
            for doy, v in sorted(fields.get(f, {}).items()):
                day = dt.date(y, 1, 1) + dt.timedelta(days=doy - 1)
                if best[key] is None or beats(v, best[key][0]):
                    best[key] = (v, day.isoformat())
                if key in month:
                    m = day.month - 1
                    if month[key][m] is None or beats(v, month[key][m][0]):
                        month[key][m] = (v, day.isoformat())
    out = {k: [number(v[0]), v[1]] for k, v in best.items() if v}
    out["mois"] = {k: [[number(x[0]), x[1]] if x else None for x in col] for k, col in month.items() if any(col)}
    return json.dumps(out, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", help="folder of the downloaded .csv.gz (the whole archive)")
    ap.add_argument("--recent", action="store_true", help="only the current year (and the year before in January)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    today = dt.datetime.now(dt.timezone.utc).date()
    statements = []
    if args.recent:
        years = {today.year} | ({today.year - 1} if today.month == 1 else set())
        sources = [(part, opened(url)) for part, url in latest_urls().items()]
        data, meta = read(sources, years)
        verb = "INSERT OR REPLACE"
    else:
        if not args.dir:
            raise SystemExit("--dir ou --recent")
        data, meta = read(files(args.dir))
        verb = "INSERT"
        statements.append(SCHEMA)
    for st in sorted(data):
        if st not in meta:
            continue
        nom, lat, lon, alt, _ = meta[st]
        ys = sorted(data[st])
        params = sorted({f for y in ys for f in data[st][y]})
        name = re.sub(r"_SAPC$", "", nom).strip()
        statements.append(
            f"INSERT INTO postes VALUES ({sql(st)},{sql(name)},{lat},{lon},{alt},{ys[0]},{ys[-1]},{sql(','.join(params))}) "
            f"ON CONFLICT (poste) DO UPDATE SET nom=excluded.nom, lat=excluded.lat, lon=excluded.lon, alt=excluded.alt, "
            f"debut=MIN(debut, excluded.debut), fin=MAX(fin, excluded.fin);"
        )
        for y in ys:
            s = f"{verb} INTO jours VALUES ({sql(st)},{y},{sql(year_json(y, data[st][y]))});"
            if len(s.encode()) > MAX_STATEMENT:
                raise SystemExit(f"ligne trop grande pour D1 : {st} {y} ({len(s)} octets)")
            statements.append(s)
        if not args.recent:
            until = today.year - 1
            statements.append(f"INSERT INTO records VALUES ({sql(st)},{until},{sql(records(data[st], until))});")
    if args.recent and len(meta) < MIN_RECENT:
        raise SystemExit(f"seulement {len(meta)} stations dans le fichier du jour : rien n'est écrit")
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text("\n".join(statements) + "\n")
    n_jours = sum(1 for s in statements if " INTO jours " in s)
    print(f"{args.out} : {len(meta)} postes, {n_jours} années-stations, {Path(args.out).stat().st_size // 1024} Ko")


if __name__ == "__main__":
    main()
