#!/usr/bin/env python3
"""Build src/historique/normales.json: the 1991-2020 monthly normals of each Météo-France station of La Réunion.

From Météo-France's « Données climatologiques de base quotidiennes » (Licence Ouverte 2.0), département 974, the long
files (1950-2024). Météo-France publishes no open file of its official normals for La Réunion, so they are computed here
the usual way, station by station and month by month over 1991-2020:
- rain: the mean of the monthly totals, counting a month only when at least 90 % of its days were measured;
- rainy days (1 mm or more): the same months;
- temperatures (mean of the daily minimum and maximum) and sunshine (minutes a day, and % of the possible where the
  station computes it): the mean of the monthly means,
  counting a month with at least 20 measured days.
A month's normal needs 10 years at least; the number of years is kept, since some stations opened late.
Values Météo-France marks doubtful (quality code 2) are left out.
Usage: python3 -I scripts/build-normales.py [--dir folder-with-the-csv.gz]
"""
import argparse
import calendar
import csv
import gzip
import io
import json
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT/"
FILES = {"rr": "Q_974_previous-1950-2024_RR-T-Vent.csv.gz", "autres": "Q_974_previous-1950-2024_autres-parametres.csv.gz"}
UA = {"User-Agent": "rundata.re (open source MCP server, real-time data for Reunion Island)"}
Y0, Y1 = 1991, 2020
MIN_YEARS = 10


def rows(name, folder):
    if folder and (Path(folder) / name).exists():
        raw = open(Path(folder) / name, "rb")
    else:
        raw = urllib.request.urlopen(urllib.request.Request(BASE + name, headers=UA), timeout=600)
    return csv.DictReader(io.TextIOWrapper(gzip.GzipFile(fileobj=raw), encoding="utf-8", newline=""), delimiter=";")


def value(r, field):
    v = (r.get(field) or "").strip()
    if not v or (r.get("Q" + field) or "").strip() == "2":
        return None
    return float(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", help="where the two long files already are")
    args = ap.parse_args()
    # (station, year, month) → lists of daily values
    days = defaultdict(lambda: defaultdict(list))
    for r in rows(FILES["rr"], args.dir):
        d = r["AAAAMMJJ"]
        y, m = int(d[:4]), int(d[4:6])
        if not Y0 <= y <= Y1:
            continue
        k = (r["NUM_POSTE"], y, m)
        for f in ("RR", "TN", "TX"):
            v = value(r, f)
            if v is not None:
                days[k][f].append(v)
    for r in rows(FILES["autres"], args.dir):
        d = r["AAAAMMJJ"]
        y, m = int(d[:4]), int(d[4:6])
        if not Y0 <= y <= Y1:
            continue
        for f in ("INST", "SIGMA"):
            v = value(r, f)
            if v is not None:
                days[(r["NUM_POSTE"], y, m)][f].append(v)

    # station → month → variable → list of monthly figures, one per year that counts
    months = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for (st, y, m), vals in days.items():
        n = calendar.monthrange(y, m)[1]
        rr = vals.get("RR", [])
        if len(rr) >= 0.9 * n:
            # Scaled to the whole month when a few days are missing.
            months[st][m]["rr"].append(sum(rr) * n / len(rr))
            months[st][m]["jours"].append(sum(1 for x in rr if x >= 1) * n / len(rr))
        for f, key in (("TN", "tn"), ("TX", "tx"), ("INST", "inst"), ("SIGMA", "sigma")):
            if len(vals.get(f, [])) >= 20:
                months[st][m][key].append(sum(vals[f]) / len(vals[f]))

    out = {}
    for st, by_month in sorted(months.items()):
        entry = {}
        for key, digits in (("rr", 0), ("jours", 1), ("tn", 1), ("tx", 1), ("inst", 0), ("sigma", 0)):
            col, years = [], []
            for m in range(1, 13):
                xs = by_month[m][key] if m in by_month else []
                if len(xs) >= MIN_YEARS:
                    mean = sum(xs) / len(xs)
                    col.append(round(mean) if digits == 0 else round(mean, digits))
                    years.append(len(xs))
                else:
                    col.append(None)
                    years.append(0)
            if any(v is not None for v in col):
                entry[key] = col
                entry[f"{key}_ans"] = min(y for y in years if y)
        if entry:
            out[st] = entry
    target = ROOT / "src/historique/normales.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps({
        "periode": f"{Y0}-{Y1}",
        "attribution": "Météo-France, données climatologiques de base quotidiennes (Licence Ouverte 2.0)\u00a0; moyennes calculées par rundata.re",
        "stations": out,
    }, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{target.relative_to(ROOT)} : {len(out)} stations, {target.stat().st_size // 1024} Ko")


if __name__ == "__main__":
    main()
