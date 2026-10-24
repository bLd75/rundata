#!/usr/bin/env python3
"""Build the SQL of the D1 database `rundata-climat-h`: the hourly measurements of the Météo-France stations of La Réunion.

From Météo-France's « Données climatologiques de base horaires » (Licence Ouverte 2.0), département 974: the files
2000-2009, 2010-2019, 2020-2024 and the current period (updated every morning).
Values Météo-France marks doubtful (quality code 2) are left out.

The hours of the files of La Réunion are local time (UTC+4), not UTC: the global radiation peaks at 12-13 h and the
temperature bottoms out at 5-6 h, as the sun does there. Each value is the one of the hour ending at that time (rain of
the hour before, mean wind of the last 10 minutes, strongest gust of the hour, sunshine minutes of the hour).

Tables (WITHOUT ROWID, so that a row written is one row counted by D1):
- postes: one row per station (name, position, altitude, first and last month as YYYYMM, parameters measured);
- heures: one row per station and month (`mois` = YYYYMM), `data` = JSON {field: [value of each hour, or null]}, the
  index being (day − 1) × 24 + hour; trailing nulls dropped.

Fields kept: RR1 (rain of the hour, mm), T (temperature, °C), U (relative humidity, %), FF (mean wind, m/s), DD (its
direction, degrees), FXI (strongest gust of the hour, m/s), INS (sunshine, minutes in the hour), GLO (global radiation,
J/cm²).

Usage:
  python3 -I scripts/build-climat-h.py --dir <folder of the H_974_*.csv.gz> --out dist/climat-h.sql   # everything, once
  python3 -I scripts/build-climat-h.py --recent --out climat-h-jour.sql                             # the current month
`--recent` reads the current period's file (found through data.gouv.fr) and writes the current month, and the month
before during the first days of a month: what the daily job (.github/workflows/climat.yml) imports. A row whose content
has not changed is left as it is, as D1 counts every row written, even one written again the same.
"""
import argparse
import calendar
import csv
import datetime as dt
import gzip
import io
import json
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

DATASET = "https://www.data.gouv.fr/api/2/datasets/6569b4473bedf2e7abad3b72/resources/?page_size=100&q=974"
UA = {"User-Agent": "rundata.re (open source MCP server, real-time data for Reunion Island)"}
FIELDS = ["RR1", "T", "U", "FF", "DD", "FXI", "INS", "GLO"]
FIRST_YEAR = 2000
MAX_STATEMENT = 90_000
# Corrections of the last days of a month still arrive in the first days of the next one.
BACK_DAYS = 3
MIN_RECENT = 40
SCHEMA = """CREATE TABLE IF NOT EXISTS postes (poste TEXT PRIMARY KEY, nom TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, alt INTEGER, debut INTEGER NOT NULL, fin INTEGER NOT NULL, params TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS heures (poste TEXT NOT NULL, mois INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (poste, mois)) WITHOUT ROWID;
"""
# The end of the upsert of a station: nothing written when nothing changes.
UNCHANGED = ("WHERE (nom, lat, lon, alt) IS NOT (excluded.nom, excluded.lat, excluded.lon, excluded.alt) "
             "OR excluded.debut < debut OR excluded.fin > fin")


def opened(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=900)


def latest_url():
    """The current period's file, whatever its years (2025-2026 today, 2026-2027 from January)."""
    res = json.load(opened(DATASET))["data"]
    url = next((r["url"] for r in res if "H_974_latest" in r["url"]), None)
    if not url:
        raise SystemExit("fichier horaire de la période en cours introuvable")
    return url


def rows(raw):
    return csv.DictReader(io.TextIOWrapper(gzip.GzipFile(fileobj=raw), encoding="utf-8", newline=""), delimiter=";")


def stations(raw, months=None):
    """Each station of a file, one after the other (the files are grouped by station): (station, its months, its meta),
    the months being YYYYMM → field → {hour index: value}. Streamed: the whole archive would not fit in memory."""
    cur, data, meta = None, None, None
    for r in rows(raw):
        st = r["NUM_POSTE"]
        if st != cur:
            if cur and meta:
                yield cur, data, meta
            cur, data, meta = st, defaultdict(lambda: defaultdict(dict)), None
        t = r["AAAAMMJJHH"]
        if int(t[:4]) < FIRST_YEAR:
            continue
        m = int(t[:6])
        if months and m not in months:
            continue
        i = (int(t[6:8]) - 1) * 24 + int(t[8:10])
        got = False
        for f in FIELDS:
            v = (r.get(f) or "").strip()
            if v and (r.get("Q" + f) or "").strip() != "2":
                data[m][f][i] = float(v)
                got = True
        if got and (meta is None or t >= meta[4]):
            meta = (r["NOM_USUEL"], float(r["LAT"]), float(r["LON"]), int(float(r["ALTI"] or 0)), t)
    if cur and meta:
        yield cur, data, meta


def number(v):
    return int(v) if v == int(v) else v


def month_json(m, fields):
    n = calendar.monthrange(m // 100, m % 100)[1] * 24
    out = {}
    for f in FIELDS:
        hours = fields.get(f)
        if not hours:
            continue
        col = [number(hours[i]) if i in hours else None for i in range(n)]
        while col and col[-1] is None:
            col.pop()
        if col:
            out[f] = col
    return json.dumps(out, separators=(",", ":"))


def sql(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", help="folder of the downloaded H_974_*.csv.gz")
    ap.add_argument("--recent", action="store_true", help="only the current month (and the one before in its first days)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=4)
    months = None
    if args.recent:
        back = now - dt.timedelta(days=BACK_DAYS)
        months = {now.year * 100 + now.month, back.year * 100 + back.month}
        sources = [opened(latest_url())]
    else:
        if not args.dir:
            raise SystemExit("--dir ou --recent")
        sources = (open(p, "rb") for p in sorted(Path(args.dir).glob("H_974_*.csv.gz")))
    # The day's job writes again only the rows that changed: those of the stations that measured something new.
    changed = " ON CONFLICT (poste, mois) DO UPDATE SET data = excluded.data WHERE data IS NOT excluded.data" if args.recent else ""
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    # station → name, lat, lon, alt, latest time, first month, last month, parameters
    seen = {}
    n_rows = 0
    with open(args.out, "w") as out:
        if not args.recent:
            out.write(SCHEMA)
        for raw in sources:
            for st, data, meta in stations(raw, months):
                for m in sorted(data):
                    s = f"INSERT INTO heures VALUES ({sql(st)},{m},{sql(month_json(m, data[m]))}){changed};"
                    if len(s.encode()) > MAX_STATEMENT:
                        raise SystemExit(f"ligne trop grande pour D1 : {st} {m} ({len(s)} octets)")
                    out.write(s + "\n")
                    n_rows += 1
                ms = sorted(data)
                params = {f for m in ms for f in data[m]}
                old = seen.get(st)
                if old:
                    meta = meta if meta[4] >= old[4] else old[:5]
                    ms = [min(ms[0], old[5]), max(ms[-1], old[6])]
                    params |= old[7]
                seen[st] = (*meta, ms[0], ms[-1], params)
        for st, (nom, lat, lon, alt, _, first, last, params) in sorted(seen.items()):
            name = re.sub(r"_SAPC$", "", nom).strip()
            out.write(
                f"INSERT INTO postes VALUES ({sql(st)},{sql(name)},{lat},{lon},{alt},{first},{last},{sql(','.join(sorted(params)))}) "
                f"ON CONFLICT (poste) DO UPDATE SET nom=excluded.nom, lat=excluded.lat, lon=excluded.lon, alt=excluded.alt, "
                f"debut=MIN(debut, excluded.debut), fin=MAX(fin, excluded.fin) {UNCHANGED};\n"
            )
    if args.recent and len(seen) < MIN_RECENT:
        Path(args.out).unlink()
        raise SystemExit(f"seulement {len(seen)} stations dans le fichier du jour : rien n'est écrit")
    print(f"{args.out} : {len(seen)} postes, {n_rows} mois-stations, {Path(args.out).stat().st_size // 1024} Ko")


if __name__ == "__main__":
    main()
